import { z } from 'zod'
import type { SceneDocument } from '../../../shared/model/scene.js'
import {
  terrainGenerationInputSchema, terrainGenerationResultSchema,
  type TerrainGenerationInput, type TerrainGenerationResult,
} from '../../../shared/terrain-generation/generate.js'
import { canonicalJson, captureJson, encodeUtf8, freezeJson } from '../../../shared/validation/json.js'
import { sha256Text } from '../../../shared/validation/hash.js'
import { validateSceneSnapshot } from '../../../shared/validation/snapshots.js'

const MAX_REQUEST_BYTES = 24 * 1024 * 1024
const MAX_RESULT_BYTES = 8 * 1024 * 1024
const PROTOCOL_VERSION = 1
const identifier = z.string().min(1).max(256).refine(value => value !== '__proto__')
const counter = z.number().finite().refine(value => Number.isSafeInteger(value) && value >= 0)
const digest = z.string().regex(/^[a-f0-9]{64}$/)
const contextShape = { requestId: identifier, sceneId: identifier, checkpoint: counter, operationEpoch: counter, inputHash: digest, baseHash: digest }
const requestArgumentsSchema = z.object({
  requestId: identifier.optional(), sceneId: identifier, checkpoint: counter, operationEpoch: counter,
  inputHash: digest.optional(), base: z.unknown(), input: z.unknown(),
}).strict()
const responseSchema = z.discriminatedUnion('type', [
  z.object({ version: z.literal(PROTOCOL_VERSION), type: z.literal('result'), ...contextShape, resultHash: digest, result: z.unknown() }).strict(),
  z.object({ version: z.literal(PROTOCOL_VERSION), type: z.literal('error'), ...contextShape,
    error: z.object({ code: z.enum(['invalid_request', 'generation_failed']), message: z.string().min(1).max(512) }).strict(),
  }).strict(),
])

export interface TerrainGenerationContext {
  requestId: string
  /** Current workspace identity; input.sceneId is the independent candidate identity. */
  sceneId: string
  checkpoint: number
  operationEpoch: number
  inputHash: string
  baseHash: string
}
export interface TerrainWorkerRequest extends TerrainGenerationContext {
  version: 1
  type: 'generate'
  base: SceneDocument
  input: TerrainGenerationInput
}
export type TerrainWorkerResponse = TerrainGenerationContext & ({
  version: 1; type: 'result'; resultHash: string; result: TerrainGenerationResult
} | {
  version: 1; type: 'error'; error: { code: 'invalid_request' | 'generation_failed'; message: string }
})
export interface TerrainGenerationRunRequest {
  requestId?: string
  sceneId: string
  checkpoint: number
  operationEpoch: number
  inputHash?: string
  base: SceneDocument
  input: unknown
}
export interface TerrainGenerationRunOptions {
  signal?: AbortSignal
  /** The host must reject results from a changed workspace, checkpoint or operation. */
  isCurrent?: (context: Readonly<TerrainGenerationContext>) => boolean
}
export interface TerrainGenerationWorker {
  onmessage: ((event: MessageEvent<unknown>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null
  postMessage: (message: unknown) => void
  terminate: () => void
}
export interface TerrainGenerationClientOptions {
  createWorker?: () => TerrainGenerationWorker
  timeoutMs?: number
}
export interface TerrainGenerationClient {
  generate: (request: TerrainGenerationRunRequest, options?: TerrainGenerationRunOptions) => Promise<TerrainGenerationResult>
  cancel: () => void
  dispose: () => void
}

export class TerrainGenerationClientError extends Error {
  constructor(public readonly code: 'invalid_input' | 'protocol' | 'generation_failed' | 'stale' | 'unavailable' | 'timeout' | 'disposed', message: string) {
    super(message); this.name = 'TerrainGenerationClientError'
  }
}
const abortError = () => new DOMException('已取消地形生成。', 'AbortError')
const boundedCanonical = (value: unknown, maximum: number) => {
  const text = canonicalJson(value)
  if (encodeUtf8(text).byteLength > maximum) throw new TerrainGenerationClientError('protocol', '地形生成内容超过允许大小，请缩小范围。')
  return text
}
const contextMatches = (left: TerrainGenerationContext, right: TerrainGenerationContext) =>
  left.requestId === right.requestId && left.sceneId === right.sceneId && left.checkpoint === right.checkpoint
  && left.operationEpoch === right.operationEpoch && left.inputHash === right.inputHash && left.baseHash === right.baseHash

/** The frozen envelope certifies transport identity only; adoption still requires host replay and resource validation. */
function prepareRequest(raw: TerrainGenerationRunRequest): TerrainWorkerRequest {
  const request = requestArgumentsSchema.parse(captureJson(raw))
  const input = terrainGenerationInputSchema.parse(request.input)
  const checked = validateSceneSnapshot(request.base)
  if (!checked.ok || checked.document.schemaVersion !== 2) throw new TerrainGenerationClientError('invalid_input', '地形生成需要有效的视觉场景基础。')
  const inputHash = sha256Text(canonicalJson(input))
  if (request.inputHash !== undefined && request.inputHash !== inputHash) throw new TerrainGenerationClientError('invalid_input', '地形生成设置已改变，请重新准备预览。')
  const base = checked.document
  const result: TerrainWorkerRequest = {
    version: PROTOCOL_VERSION, type: 'generate', requestId: request.requestId ?? crypto.randomUUID(), sceneId: request.sceneId,
    checkpoint: request.checkpoint, operationEpoch: request.operationEpoch, inputHash,
    baseHash: sha256Text(boundedCanonical(base, MAX_REQUEST_BYTES)), base, input,
  }
  boundedCanonical(result, MAX_REQUEST_BYTES)
  return freezeJson(result)
}

export function createTerrainGenerationClient(options: TerrainGenerationClientOptions = {}): TerrainGenerationClient {
  const timeoutMs = options.timeoutMs ?? 30_000
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) throw new Error('地形生成等待时间须为1–60000毫秒。')
  const createWorker = options.createWorker ?? (() => new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'sceneweave-terrain-generation' }))
  let disposed = false
  let active: { cancel: () => void } | null = null

  const cancel = () => active?.cancel()
  const generate: TerrainGenerationClient['generate'] = async (raw, runOptions = {}) => {
    cancel()
    if (disposed) throw new TerrainGenerationClientError('disposed', '地形生成面板已关闭。')
    if (runOptions.signal?.aborted) throw abortError()
    let request: TerrainWorkerRequest
    try { request = prepareRequest(raw) }
    catch (failure) {
      if (failure instanceof TerrainGenerationClientError) throw failure
      throw new TerrainGenerationClientError('invalid_input', '地形生成设置或场景内容无效，请重新准备预览。')
    }
    const context: Readonly<TerrainGenerationContext> = Object.freeze({ requestId: request.requestId, sceneId: request.sceneId,
      checkpoint: request.checkpoint, operationEpoch: request.operationEpoch, inputHash: request.inputHash, baseHash: request.baseHash })
    const current = () => {
      try { return !runOptions.signal?.aborted && (runOptions.isCurrent?.(context) ?? true) }
      catch { return false }
    }
    if (!current()) throw new TerrainGenerationClientError('stale', '当前工程已经变化，请重新生成预览。')
    let worker: TerrainGenerationWorker
    try { worker = createWorker() }
    catch { throw new TerrainGenerationClientError('unavailable', '无法启动地形生成，请重新打开面板后重试。') }

    return new Promise<TerrainGenerationResult>((resolve, reject) => {
      let settled = false
      let timer: ReturnType<typeof setTimeout> | undefined
      const job = { cancel: () => finish(abortError()) }
      function finish(failure?: Error, result?: TerrainGenerationResult) {
        if (settled) return
        settled = true
        if (active === job) active = null
        if (timer !== undefined) clearTimeout(timer)
        runOptions.signal?.removeEventListener('abort', job.cancel)
        worker.onmessage = null; worker.onerror = null; worker.onmessageerror = null
        worker.terminate()
        if (failure) reject(failure)
        else if (result) resolve(result)
        else reject(new TerrainGenerationClientError('protocol', '地形生成没有返回完整候选。'))
      }
      active = job
      worker.onmessage = event => {
        if (settled || active !== job) return
        if (!current()) { finish(new TerrainGenerationClientError('stale', '当前工程已经变化，已丢弃过期预览。')); return }
        try {
          const rawResponse = captureJson(event.data)
          boundedCanonical(rawResponse, MAX_RESULT_BYTES + 4096)
          const response = responseSchema.parse(rawResponse)
          if (!contextMatches(context, response)) throw new TerrainGenerationClientError('stale', '地形预览与当前请求不符，已丢弃该结果。')
          if (response.type === 'error') {
            finish(new TerrainGenerationClientError(response.error.code === 'generation_failed' ? 'generation_failed' : 'protocol', response.error.message)); return
          }
          const resultText = boundedCanonical(response.result, MAX_RESULT_BYTES)
          if (sha256Text(resultText) !== response.resultHash) throw new TerrainGenerationClientError('protocol', '地形预览内容校验不一致，请重新生成。')
          const result = terrainGenerationResultSchema.parse(response.result)
          if (canonicalJson(result) !== resultText || sha256Text(canonicalJson(result.input)) !== context.inputHash
            || result.document.sceneId !== request.input.sceneId || result.document.schemaVersion !== 2
            || !Number.isSafeInteger(result.cost.total) || result.cost.total < 0 || result.cost.total > 256) {
            throw new TerrainGenerationClientError('protocol', '地形预览的设置、成本或场景身份不一致。')
          }
          const checked = validateSceneSnapshot(result.document)
          if (!checked.ok) throw new TerrainGenerationClientError('protocol', '地形预览没有通过完整几何检查。')
          if (!current()) throw new TerrainGenerationClientError('stale', '当前工程已经变化，已丢弃过期预览。')
          finish(undefined, freezeJson({ ...result, document: checked.document }))
        } catch (failure) {
          finish(failure instanceof TerrainGenerationClientError ? failure : new TerrainGenerationClientError('protocol', '地形预览格式不符合要求，请重新生成。'))
        }
      }
      worker.onerror = event => { event.preventDefault(); finish(new TerrainGenerationClientError('generation_failed', '地形生成未完成，请调整设置后重试。')) }
      worker.onmessageerror = () => finish(new TerrainGenerationClientError('protocol', '地形预览无法读取，请重新生成。'))
      runOptions.signal?.addEventListener('abort', job.cancel, { once: true })
      if (runOptions.signal?.aborted) { job.cancel(); return }
      timer = setTimeout(() => finish(new TerrainGenerationClientError('timeout', '地形生成等待超时，已停止计算；可缩小范围后重试。')), timeoutMs)
      try { worker.postMessage(request) }
      catch { finish(new TerrainGenerationClientError('protocol', '地形生成内容无法传递，请重新准备预览。')) }
    })
  }
  return { generate, cancel, dispose: () => { disposed = true; cancel() } }
}
