import type { EditableProject } from './project.js'
import { captureEditableDraft, toBundle, validateEditableProject } from './project.js'
import { prepareTerrainProject, type BaseMapGenerationReceipt } from './terrain.js'
import { prepareTerrainComposition } from './terrain-composition.js'
import type { PreparationContext } from '../../shared/ports/runtime.js'
import type { CompleteValidationOptions } from '../../shared/ports/resources.js'
import { checkCancelled } from '../../shared/ports/resources.js'
import { canonicalJson, captureJson } from '../../shared/validation/json.js'
import { projectContentHash } from '../../shared/project/validate.js'
import { prepareBaseMapRequest, parseBaseMapResponse, type BaseMapRequest } from '../../shared/terrain-generation/base-map.js'

/** A transport result never becomes a credential: replay it with owned bytes,
 * then bind the session receipt to the fully materialized complete project. */
export async function prepareBaseMapProject(
  inputBase: EditableProject,
  rawRequest: BaseMapRequest,
  rawResponse: unknown,
  options: { runtime: PreparationContext; validation: CompleteValidationOptions; source?: 'worker' | 'server' },
) {
  checkCancelled(options.validation.signal)
  const capturedRequest = captureJson(rawRequest), capturedResponse = captureJson(rawResponse)
  const request = prepareBaseMapRequest({ requestId: capturedRequest.requestId, workspaceSceneId: capturedRequest.workspaceSceneId,
    checkpoint: capturedRequest.checkpoint, operationEpoch: capturedRequest.operationEpoch, base: capturedRequest.base, generation: capturedRequest.generation })
  if (canonicalJson(request) !== canonicalJson(capturedRequest)) throw new Error('底图生成请求或版本回执已改变。')
  const response = parseBaseMapResponse(request, capturedResponse)
  const base = await validateEditableProject(captureEditableDraft(inputBase), options.validation)
  checkCancelled(options.validation.signal)
  if (canonicalJson(base.document) !== canonicalJson(request.base)) throw new Error('底图固定素材或基础文档与生成请求不符。')
  let prepared
  if (request.generation.kind === 'terrain' && response.result.kind === 'terrain') {
    prepared = await prepareTerrainProject(base, request.generation.input, { ...options, result: response.result.terrain })
  } else if (request.generation.kind === 'composition' && response.result.kind === 'composition') {
    prepared = await prepareTerrainComposition(base, request.generation.input, { ...options, plan: response.result.plan, domainDocument: response.result.document })
  } else throw new Error('底图生成类型与请求不符。')
  checkCancelled(options.validation.signal)
  if (prepared.cost.total !== response.domainCost.total) throw new Error('完整物化后的底图操作量与领域回执不同。')
  const baseMap: BaseMapGenerationReceipt = {
    version: 1, source: options.source ?? 'worker', requestId: request.requestId, workspaceSceneId: request.workspaceSceneId,
    checkpoint: request.checkpoint, operationEpoch: request.operationEpoch,
    inputHash: request.inputHash, baseHash: request.baseHash, paletteHash: request.paletteHash,
    algorithm: request.algorithm, generation: request.generation, resultHash: response.resultHash,
    projectHash: projectContentHash(toBundle(prepared.project).project),
    initialOperationCost: prepared.cost.total, operationLimit: 256, remainingOperationCost: 256 - prepared.cost.total,
  }
  return { ...prepared, baseMap }
}
