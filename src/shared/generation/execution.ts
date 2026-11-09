import { z } from 'zod'
import type { SceneDocument } from '../model/scene.js'
import { assertTaskBudget, parseTaskBudgetProfile, type TaskBudgetProfile } from '../budget/task-budget.js'
import { captureJson, canonicalJson, encodeUtf8, freezeJson } from '../validation/json.js'
import { validateSceneDocument } from '../validation/scene.js'
import { checkCancelled, type CancellationSignal } from '../ports/resources.js'
import { parseGenerationArtifactReceipt, hashGenerationValue } from './contracts.js'
import { generationDomains as domains, domainGenerationKinds, type DomainGenerationKind, type DomainGenerationResults } from './domains/registry.js'
export type { DomainGenerationKind, DomainGenerationResults } from './domains/registry.js'

export const DOMAIN_GENERATION_LIMITS = Object.freeze({ requestBytes: 8 * 1024 * 1024, resultBytes: 16 * 1024 * 1024, maxTimeoutMs: 60000 })
export interface DomainGenerationOptions { profile: TaskBudgetProfile; nowMilliseconds: () => number; signal?: CancellationSignal }
export function runDomainGeneration<K extends DomainGenerationKind>(domain: K, base: SceneDocument, input: unknown, options: DomainGenerationOptions): DomainGenerationResults[K] {
  checkCancelled(options.signal)
  if (!Object.hasOwn(domains, domain)) throw new Error('此生成领域尚未支持。')
  return domains[domain].run(base, input, options) as DomainGenerationResults[K]
}
export function domainGenerationCapabilities(executor: 'direct' | 'worker' | 'server') {
  return freezeJson({ protocolVersion: 1 as const, executor,
    domains: domainGenerationKinds.map(domain => ({ domain, algorithm: { ...domains[domain].algorithm }, target: 'new-project' as const })),
    localOperations: executor === 'direct' ? domainGenerationKinds.flatMap(domain => [...domains[domain].localOperations]) : [],
    aiTools: [],
  })
}
export function parseDomainGenerationCapabilities(raw: unknown, executor: 'direct' | 'worker' | 'server') {
  const expected = domainGenerationCapabilities(executor)
  if (canonicalJson(captureJson(raw)) !== canonicalJson(expected)) throw new Error('生成能力与当前支持范围不符。')
  return expected
}
const id = z.string().min(1).max(256).refine(value => value !== '__proto__')
const hash = z.string().regex(/^[a-f0-9]{64}$/)
const integer = z.number().int().safe()
const count = integer.nonnegative()
const contextSchema = z.object({ workspaceId: id, checkpoint: count, epoch: count }).strict()
const requestSchema = z.object({ protocolVersion: z.literal(1), requestId: id, context: contextSchema,
  domain: z.enum(domainGenerationKinds), base: z.unknown(), input: z.unknown(), profile: z.unknown(), requestHash: hash,
}).strict()
export interface DomainExecutionRequest<K extends DomainGenerationKind = DomainGenerationKind> {
  protocolVersion: 1; requestId: string; context: z.infer<typeof contextSchema>; domain: K
  base: SceneDocument; input: DomainGenerationResults[K]['input']; profile: TaskBudgetProfile; requestHash: string
}
export interface DomainExecutionResponse<K extends DomainGenerationKind = DomainGenerationKind> {
  protocolVersion: 1; requestId: string; context: DomainExecutionRequest['context']; domain: K; requestHash: string; result: DomainGenerationResults[K]
}
function captureBounded(raw: unknown, limit: number): unknown {
  const owned = captureJson(raw)
  if (encodeUtf8(JSON.stringify(owned)).byteLength > limit) throw new Error('生成协议数据超过字节限制。')
  return owned
}
export function createDomainExecutionRequest<K extends DomainGenerationKind>(raw: {
  requestId: string; context: DomainExecutionRequest['context']; domain: K; base: SceneDocument; input: unknown; profile: TaskBudgetProfile
}): DomainExecutionRequest<K> {
  const owned = captureBounded(raw, DOMAIN_GENERATION_LIMITS.requestBytes) as typeof raw
  if (!Object.hasOwn(domains, owned.domain)) throw new Error('此生成领域尚未支持。')
  const body = { protocolVersion: 1 as const, requestId: owned.requestId, context: owned.context, domain: owned.domain,
    base: owned.base, input: domains[owned.domain].normalize(owned.input), profile: parseTaskBudgetProfile(owned.profile) }
  return parseDomainExecutionRequest({ ...body, requestHash: hashGenerationValue(body) }) as DomainExecutionRequest<K>
}
export function parseDomainExecutionRequest(raw: unknown): DomainExecutionRequest {
  const owned = requestSchema.parse(captureBounded(raw, DOMAIN_GENERATION_LIMITS.requestBytes))
  if (!validateSceneDocument(owned.base).ok) throw new Error('生成基底不是合法完整场景。')
  const input = domains[owned.domain].normalize(owned.input), profile = parseTaskBudgetProfile(owned.profile)
  if (canonicalJson(input) !== canonicalJson(owned.input)) throw new Error('生成请求须使用规范化输入。')
  const { requestHash, ...body } = owned
  if (requestHash !== hashGenerationValue(body)) throw new Error('生成请求摘要不符。')
  return freezeJson({ ...owned, base: owned.base as SceneDocument, input, profile })
}

const responseSchema = z.object({ protocolVersion: z.literal(1), requestId: id, context: contextSchema, domain: z.enum(domainGenerationKinds), requestHash: hash, result: z.unknown() }).strict()
/** Transport data is a preview only. Even a self-consistent digest is not an
 * adoption certificate: Workspace replays locally with real resources and CAS. */
export function parseDomainExecutionResponse<K extends DomainGenerationKind>(raw: unknown, request: DomainExecutionRequest<K>): DomainExecutionResponse<K> {
  const expected = parseDomainExecutionRequest(request), owned = responseSchema.parse(captureBounded(raw, DOMAIN_GENERATION_LIMITS.resultBytes))
  if (owned.requestId !== expected.requestId || owned.requestHash !== expected.requestHash || owned.domain !== expected.domain
    || canonicalJson(owned.context) !== canonicalJson(expected.context)) throw new Error('生成结果的请求、代次或基线不符。')
  const result = domains[owned.domain].resultSchema.parse(owned.result), candidate = result.candidate
  if (canonicalJson(result.input) !== canonicalJson(expected.input)) throw new Error('生成结果输入不符。')
  if (!validateSceneDocument(candidate.document).ok || hashGenerationValue(candidate.document) !== candidate.documentHash
    || (candidate.document as SceneDocument).sceneId !== expected.base.sceneId || candidate.sourceHash !== hashGenerationValue(expected.base)) throw new Error('生成候选场景或来源摘要不符。')
  const outputs = candidate.outputs.map(parseGenerationArtifactReceipt)
  if (new Set(outputs.map(row => row.id)).size !== outputs.length || candidate.outputHash !== hashGenerationValue(outputs.map(row => [row.kind, row.id, row.contentHash]))) throw new Error('生成产物集合摘要不符。')
  if (candidate.stages[0].beforeHash !== candidate.sourceHash || candidate.stages.at(-1)!.afterHash !== candidate.documentHash
    || candidate.stages.some((stage, index) => index > 0 && stage.beforeHash !== candidate.stages[index - 1].afterHash)) throw new Error('生成阶段场景链不符。')
  const { input, report } = result
  if (result.resultHash !== hashGenerationValue({ input, ...('layout' in result ? { layout: result.layout } : {}), report, documentHash: candidate.documentHash, outputHash: candidate.outputHash, stages: candidate.stages })) throw new Error('生成领域结果摘要不符。')
  assertTaskBudget(expected.profile, candidate.usage)
  return freezeJson({ ...owned, result: { ...result, candidate: { ...candidate, outputs } } }) as unknown as DomainExecutionResponse<K>
}
type DomainRequestExecutionOptions = { nowMilliseconds: () => number; signal?: CancellationSignal }
export function executeDomainExecutionRequest<K extends DomainGenerationKind>(raw: DomainExecutionRequest<K>, options: DomainRequestExecutionOptions): DomainExecutionResponse<K>
export function executeDomainExecutionRequest(raw: unknown, options: DomainRequestExecutionOptions): DomainExecutionResponse
export function executeDomainExecutionRequest(raw: unknown, options: DomainRequestExecutionOptions): DomainExecutionResponse {
  checkCancelled(options.signal)
  const request = parseDomainExecutionRequest(raw)
  const result = runDomainGeneration(request.domain, request.base, request.input, { ...options, profile: request.profile })
  checkCancelled(options.signal)
  return parseDomainExecutionResponse({ protocolVersion: 1, requestId: request.requestId, context: request.context, domain: request.domain, requestHash: request.requestHash, result }, request)
}
