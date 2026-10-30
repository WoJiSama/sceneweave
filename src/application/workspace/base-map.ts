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
import { parseBaseMapRequestV2, parseBaseMapResponseV2, type BaseMapRequestV2 } from '../../shared/terrain-generation/base-map-v2.js'
import { baseMapResourceClosureHash, captureBaseMapSource } from '../../shared/ai/continuation.js'
import type { BaseMapSource } from '../../shared/ai/continuation-protocol.js'

export interface BaseMapPreparationOptions {
  runtime: PreparationContext
  validation: CompleteValidationOptions
  source?: 'worker' | 'server'
  preservation?: BaseMapSource['preservation']
  generationExecution?: { startedAt: string; activeRuntimeMs: number; generationCalls: number }
}

/** A transport result never becomes a credential: replay it with owned bytes,
 * then bind the session receipt to the fully materialized complete project. */
export async function prepareBaseMapProject(
  inputBase: EditableProject,
  rawRequest: BaseMapRequest | BaseMapRequestV2,
  rawResponse: unknown,
  options: BaseMapPreparationOptions,
) {
  const started = performance.now()
  checkCancelled(options.validation.signal)
  const capturedRequest = captureJson(rawRequest), capturedResponse = captureJson(rawResponse)
  const request = capturedRequest.version === 2 ? parseBaseMapRequestV2(capturedRequest) : prepareBaseMapRequest({ requestId: capturedRequest.requestId, workspaceSceneId: capturedRequest.workspaceSceneId,
    checkpoint: capturedRequest.checkpoint, operationEpoch: capturedRequest.operationEpoch, base: capturedRequest.base, generation: capturedRequest.generation })
  if (canonicalJson(request) !== canonicalJson(capturedRequest)) throw new Error('底图生成请求或版本回执已改变。')
  const response = request.version === 2 ? parseBaseMapResponseV2(request, capturedResponse) : parseBaseMapResponse(request, capturedResponse)
  const preparedAt = options.runtime.clock.now(), identityAllocation: string[] = []
  const runtime = request.version === 2 ? { clock: { now: () => preparedAt }, ids: { nextId: () => {
    const id = options.runtime.ids.nextId(); identityAllocation.push(id); return id
  } } } : options.runtime
  const base = await validateEditableProject(captureEditableDraft(inputBase), options.validation)
  checkCancelled(options.validation.signal)
  if (canonicalJson(base.document) !== canonicalJson(request.base)) throw new Error('底图固定素材或基础文档与生成请求不符。')
  let prepared
  if (request.generation.kind === 'terrain' && response.result.kind === 'terrain') {
    prepared = await prepareTerrainProject(base, request.generation.input, { ...options, runtime, result: response.result.terrain })
  } else if (request.generation.kind === 'composition' && response.result.kind === 'composition') {
    prepared = await prepareTerrainComposition(base, request.generation.input, { ...options, runtime, plan: response.result.plan, domainDocument: response.result.document })
  } else throw new Error('底图生成类型与请求不符。')
  checkCancelled(options.validation.signal)
  if (prepared.cost.total !== response.domainCost.total) throw new Error('完整物化后的底图操作量与领域回执不同。')
  const baseMap: BaseMapGenerationReceipt = {
    version: request.version, source: options.source ?? 'worker', requestId: request.requestId, workspaceSceneId: request.workspaceSceneId,
    checkpoint: request.checkpoint, operationEpoch: request.operationEpoch,
    inputHash: request.inputHash, baseHash: request.baseHash, paletteHash: request.paletteHash,
    algorithm: request.algorithm, generation: request.generation, resultHash: response.resultHash,
    projectHash: projectContentHash(toBundle(prepared.project).project),
    initialOperationCost: prepared.cost.total, operationLimit: 256, remainingOperationCost: 256 - prepared.cost.total,
  }
  let continuationSource: BaseMapSource | undefined
  let continuationError: string | undefined
  if (request.version === 2 && response.version === 2) {
    try {
    if (!options.preservation || !options.generationExecution) throw new Error('可接续底图缺少真实保护基线或生成执行记录。')
    const generation = options.generationExecution, project = toBundle(prepared.project).project
    continuationSource = captureBaseMapSource({ version: 2, flowId: request.flowId, blank: toBundle(base).project,
      preservation: options.preservation, request, response, preparedAt, identityAllocation, project,
      projectHash: baseMap.projectHash, resourceClosureHash: baseMapResourceClosureHash(project),
      execution: { executor: options.source ?? 'worker', startedAt: generation.startedAt, completedAt: options.runtime.clock.now(),
        activeRuntimeMs: Math.ceil(generation.activeRuntimeMs + performance.now() - started), generationCalls: generation.generationCalls, materializationCalls: 1 } })
    } catch (error) {
      checkCancelled(options.validation.signal)
      continuationError = error instanceof Error ? error.message : String(error)
    }
  }
  return { ...prepared, baseMap, ...(continuationSource ? { continuationSource } : {}), ...(continuationError ? { continuationError } : {}) }
}
