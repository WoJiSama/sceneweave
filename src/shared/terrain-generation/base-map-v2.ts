import { z } from 'zod'
import { BudgetPolicySchema } from '../ai/budget-policy.js'
import { semanticChangedDocumentTargets } from '../ai/semantic-budget.js'
import { canonicalJson, captureJson, encodeUtf8, freezeJson } from '../validation/json.js'
import { sha256Text } from '../validation/hash.js'
import { BASE_MAP_LIMITS, BaseMapRequestV1Schema, BaseMapResponseV1Schema, prepareBaseMapRequest, executeBaseMapRequest, parseBaseMapResponse,
  type BaseMapRequest, type BaseMapResponse } from './base-map.js'

const id = z.string().min(1).max(256).refine(value => value !== '__proto__')
const hash = z.string().regex(/^[a-f0-9]{64}$/)
export const BaseMapRequestV2Schema = BaseMapRequestV1Schema.omit({ version: true }).extend({
  version: z.literal(2), flowId: id, policy: BudgetPolicySchema, policyHash: hash,
}).strict()
export type BaseMapRequestV2 = z.infer<typeof BaseMapRequestV2Schema>
export const BaseMapResponseV2Schema = BaseMapResponseV1Schema.omit({ version: true, resultHash: true }).extend({
  version: z.literal(2), flowId: id, policyHash: hash, resultHash: hash,
  generationBudget: z.object({ semanticTargets: z.array(z.string().min(1).max(512)).max(256), semanticCost: z.number().int().min(0).max(256),
    complexityCost: z.number().int().min(0).max(256) }).strict(),
}).strict()
export type BaseMapResponseV2 = z.infer<typeof BaseMapResponseV2Schema>

const digest = (value: unknown) => sha256Text(canonicalJson(value))
function bounded(input: unknown, bytes: number) {
  const owned = captureJson(input)
  if (encodeUtf8(canonicalJson(owned)).length > bytes) throw new Error('程序底图v2协议超过字节预算。')
  return owned
}
function legacyRequest(input: BaseMapRequestV2): BaseMapRequest {
  const { flowId: _flow, policy: _policy, policyHash: _hash, ...request } = input
  return { ...request, version: 1 }
}
export function parseBaseMapRequestV2(input: unknown): BaseMapRequestV2 {
  const owned = bounded(input, BASE_MAP_LIMITS.requestBytes), request = BaseMapRequestV2Schema.parse(owned)
  if (canonicalJson(owned) !== canonicalJson(request) || request.policyHash !== request.policy.policyHash) throw new Error('程序底图v2策略或规范化输入不同。')
  const expected = prepareBaseMapRequest({ requestId: request.requestId, workspaceSceneId: request.workspaceSceneId,
    checkpoint: request.checkpoint, operationEpoch: request.operationEpoch, base: request.base, generation: request.generation })
  if (canonicalJson(expected) !== canonicalJson(legacyRequest(request))) throw new Error('程序底图v2完整输入指纹不同。')
  return freezeJson(request)
}
export function prepareBaseMapRequestV2(input: unknown): BaseMapRequestV2 {
  const owned = captureJson(input) as Record<string, unknown>, { flowId, policy, ...generation } = owned
  const frozen = BudgetPolicySchema.parse(policy), legacy = prepareBaseMapRequest(generation)
  return parseBaseMapRequestV2({ ...legacy, version: 2, flowId, policy: frozen, policyHash: frozen.policyHash })
}
function generationBudget(request: BaseMapRequestV2, response: BaseMapResponse) {
  const document = response.result.kind === 'terrain' ? response.result.terrain.document : response.result.document
  const semanticTargets = semanticChangedDocumentTargets(request.base, document)
  return { semanticTargets, semanticCost: semanticTargets.length, complexityCost: response.domainCost.total }
}
function resultHash(request: BaseMapRequestV2, response: BaseMapResponse): string {
  return digest({ version: 2, flowId: request.flowId, policyHash: request.policyHash, generation: response.generation,
    result: response.result, domainCost: response.domainCost, generationBudget: generationBudget(request, response) })
}
export function executeBaseMapRequestV2(input: unknown): BaseMapResponseV2 {
  const request = parseBaseMapRequestV2(input), result = executeBaseMapRequest(legacyRequest(request))
  return parseBaseMapResponseV2(request, { ...result, version: 2, flowId: request.flowId, policyHash: request.policyHash,
    generationBudget: generationBudget(request, result), resultHash: resultHash(request, result) })
}
export function parseBaseMapResponseV2(input: BaseMapRequestV2, raw: unknown): BaseMapResponseV2 {
  const request = parseBaseMapRequestV2(input), owned = bounded(raw, BASE_MAP_LIMITS.resultBytes), response = BaseMapResponseV2Schema.parse(owned)
  if (canonicalJson(owned) !== canonicalJson(response) || response.flowId !== request.flowId || response.policyHash !== request.policyHash) throw new Error('程序底图v2流程或策略不同。')
  const { flowId: _flow, policyHash: _policy, generationBudget: _budget, ...legacy } = response
  const legacyHash = digest({ generation: response.generation, result: response.result, domainCost: response.domainCost })
  const checked = parseBaseMapResponse(legacyRequest(request), { ...legacy, version: 1, resultHash: legacyHash })
  if (response.resultHash !== resultHash(request, checked) || canonicalJson(response.generationBudget) !== canonicalJson(generationBudget(request, checked))) throw new Error('程序底图v2结果或分类成本指纹不同。')
  return freezeJson(response)
}
