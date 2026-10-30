import {
  BASE_MAP_LIMITS, prepareBaseMapRequest, parseBaseMapResponse, type BaseMapRequest, type BaseMapResponse,
} from '../../../shared/terrain-generation/base-map.js'
import { parseBaseMapRequestV2, parseBaseMapResponseV2, type BaseMapRequestV2, type BaseMapResponseV2 } from '../../../shared/terrain-generation/base-map-v2.js'
import { canonicalJson, captureJson, encodeUtf8, freezeJson } from '../../../shared/validation/json.js'
import { AiClient, normalizeAiBaseUrl, supportsContinuation } from '../ai/client.js'

const MAX_RESPONSE_BYTES = BASE_MAP_LIMITS.resultBytes + 4096

export interface BaseMapWorker {
  onmessage: ((event: MessageEvent<unknown>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null
  postMessage: (message: unknown) => void
  terminate: () => void
}
export interface BaseMapGenerationClientOptions {
  createWorker?: () => BaseMapWorker
  fetcher?: typeof fetch
  timeoutMs?: number
}
export interface BaseMapGenerationRunOptions {
  signal?: AbortSignal
  isCurrent?: (request: BaseMapRequest | BaseMapRequestV2) => boolean
  onExecution?: (execution: BaseMapGenerationExecution) => void
  /** Used only for this explicit request; never persisted or used as a fallback. */
  server?: { baseUrl: string; token: string }
}
export interface BaseMapGenerationExecution { startedAt: string; activeRuntimeMs: number; generationCalls: number }
export interface BaseMapGenerationClient {
  generate: (request: BaseMapRequest | BaseMapRequestV2, options?: BaseMapGenerationRunOptions) => Promise<BaseMapResponse | BaseMapResponseV2>
  cancel: () => void
  dispose: () => void
}
export class BaseMapGenerationClientError extends Error {
  constructor(public readonly code: 'invalid_input' | 'configuration' | 'protocol' | 'generation_failed' | 'stale' | 'unavailable' | 'network' | 'timeout' | 'disposed', message: string) {
    super(message); this.name = 'BaseMapGenerationClientError'
  }
}
const abortError = () => new DOMException('已取消程序底图生成。', 'AbortError')
const protocolError = () => new BaseMapGenerationClientError('protocol', '程序底图响应格式或身份校验失败，当前工程保持。')
const generationError = () => new BaseMapGenerationClientError('generation_failed', '程序底图生成失败，请检查输入或缩小范围。')
const staleError = () => new BaseMapGenerationClientError('stale', '当前工程或生成设置已经变化，已丢弃过期程序底图。')
const serverError = (status: number) => new BaseMapGenerationClientError('generation_failed',
  status === 401 || status === 403 ? '后端拒绝访问，请检查应用凭据和允许的站点 Origin。'
    : status === 404 ? '后端尚未提供程序底图接口，请升级后端后再生成。'
      : status === 413 ? '程序底图请求、结果或操作预算超过上限，请缩小范围。'
        : status === 429 ? '程序底图服务当前繁忙，请稍后手动重试；未自动重发。'
          : status >= 500 ? '程序底图服务暂时不可用，请检查后端状态；未自动重发。'
            : '后端未接受程序底图请求，请检查输入和连接配置。')

function captureRequest(raw: BaseMapRequest | BaseMapRequestV2): BaseMapRequest | BaseMapRequestV2 {
  const captured = captureJson(raw)
  const text = canonicalJson(captured)
  if (encodeUtf8(text).byteLength > BASE_MAP_LIMITS.requestBytes) throw new Error('request limit')
  const request = captured.version === 2 ? parseBaseMapRequestV2(captured) : prepareBaseMapRequest({ requestId: captured.requestId, workspaceSceneId: captured.workspaceSceneId,
    checkpoint: captured.checkpoint, operationEpoch: captured.operationEpoch, base: captured.base, generation: captured.generation })
  // Rebuilding only verifies an already prepared envelope: it must not silently
  // repair an old hash, change an algorithm selector, or ignore extra fields.
  if (canonicalJson(request) !== text) throw new Error('request identity')
  return freezeJson(request)
}

/** Count received bytes, including UTF-8 and whitespace, rather than trusting a header or decoded string length. */
async function boundedResponseText(response: Response, signal: AbortSignal): Promise<string> {
  const reader = response.body?.getReader()
  if (!reader) throw protocolError()
  const chunks: Uint8Array[] = []; let size = 0
  const cancel = () => { void reader.cancel().catch(() => undefined) }
  signal.addEventListener('abort', cancel, { once: true })
  try {
    if (signal.aborted) throw abortError()
    for (;;) {
      const part = await reader.read()
      if (signal.aborted) throw abortError()
      if (part.done) break
      size += part.value.byteLength
      if (size > MAX_RESPONSE_BYTES) throw protocolError()
      chunks.push(part.value)
    }
    const bytes = new Uint8Array(size); let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } finally {
    signal.removeEventListener('abort', cancel)
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}

/** One transport per request. Both paths return unadopted metadata, never a resource or workspace certificate. */
export function createBaseMapGenerationClient(options: BaseMapGenerationClientOptions = {}): BaseMapGenerationClient {
  const timeoutMs = options.timeoutMs ?? 30_000
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) throw new Error('程序底图等待时间须为1–60000毫秒。')
  const createWorker = options.createWorker ?? (() => new Worker(new URL('./base-map-worker.ts', import.meta.url), { type: 'module', name: 'sceneweave-base-map' }))
  const fetcher = options.fetcher ?? fetch
  let disposed = false, active: { cancel: () => void } | null = null
  const executions = new Map<string, BaseMapGenerationExecution>()
  const cancel = () => active?.cancel()
  const generate: BaseMapGenerationClient['generate'] = async (raw, runOptions = {}) => {
    cancel()
    if (disposed) throw new BaseMapGenerationClientError('disposed', '程序底图生成面板已关闭。')
    if (runOptions.signal?.aborted) throw abortError()
    let request: BaseMapRequest | BaseMapRequestV2
    try { request = captureRequest(raw) }
    catch { throw new BaseMapGenerationClientError('invalid_input', '程序底图请求或基线无效，请重新准备预览。') }
    const current = () => {
      try { return !runOptions.signal?.aborted && (runOptions.isCurrent?.(request) ?? true) }
      catch { return false }
    }
    if (!current()) throw staleError()
    let server: { baseUrl: string; token: string } | undefined
    if (runOptions.server !== undefined) {
      try {
        const { baseUrl, token } = runOptions.server
        if (typeof token !== 'string' || !token.trim() || token.length > 4096 || /[\r\n\x00-\x1f\x7f]/.test(token)) throw new Error('token')
        server = { baseUrl: normalizeAiBaseUrl(baseUrl), token: token.trim() }
      } catch { throw new BaseMapGenerationClientError('configuration', '请填写有效的后端地址和应用凭据。') }
    }
    const flow = request.version === 2 ? request.flowId : request.requestId
    const startedAt = new Date().toISOString(), startedAtMs = performance.now()
    const execution = executions.get(flow) ?? { startedAt, activeRuntimeMs: 0, generationCalls: 0 }
    executions.set(flow, execution)
    return new Promise<BaseMapResponse | BaseMapResponseV2>((resolve, reject) => {
      let settled = false, worker: BaseMapWorker | undefined, timer: ReturnType<typeof setTimeout> | undefined
      const controller = new AbortController(), job = { cancel: () => finish(abortError()) }
      function finish(failure?: Error, response?: BaseMapResponse | BaseMapResponseV2): void {
        if (settled) return
        settled = true
        if (active === job) active = null
        if (timer !== undefined) clearTimeout(timer)
        runOptions.signal?.removeEventListener('abort', job.cancel)
        controller.abort()
        if (worker) {
          worker.onmessage = null; worker.onerror = null; worker.onmessageerror = null
          try { worker.terminate() } catch { /* Already terminated; settlement must still complete. */ }
        }
        execution.activeRuntimeMs += Math.max(1, Math.ceil(performance.now() - startedAtMs))
        try { runOptions.onExecution?.(Object.freeze({ ...execution })) } catch { /* Observation cannot change transport settlement. */ }
        if (failure) reject(failure)
        else if (response) resolve(response)
        else reject(protocolError())
      }
      function accept(rawResponse: unknown): void {
        if (settled || active !== job) return
        if (!current()) { finish(staleError()); return }
        try {
          const captured = captureJson(rawResponse)
          if (encodeUtf8(canonicalJson(captured)).byteLength > MAX_RESPONSE_BYTES) throw protocolError()
          if (captured && typeof captured === 'object' && 'type' in captured && captured.type === 'error') { finish(generationError()); return }
          const response = freezeJson(request.version === 2 ? parseBaseMapResponseV2(request, captured) : parseBaseMapResponse(request, captured))
          if (!current()) throw staleError()
          finish(undefined, response)
        } catch (error) { finish(error instanceof BaseMapGenerationClientError ? error : protocolError()) }
      }
      active = job
      runOptions.signal?.addEventListener('abort', job.cancel, { once: true })
      if (runOptions.signal?.aborted) { job.cancel(); return }
      timer = setTimeout(() => finish(new BaseMapGenerationClientError('timeout', '程序底图生成等待超时，已停止等待；当前工程保持。')), timeoutMs)
      if (server) {
        const connection = server
        void (async () => {
          let response: Response
          try {
            if (request.version === 2) {
              const info = await new AiClient(connection.baseUrl, connection.token, fetcher).capabilities(controller.signal)
              if (settled || active !== job) return
              if (!current()) { finish(staleError()); return }
              if (!supportsContinuation(info, 'baseMap')) { finish(new BaseMapGenerationClientError('unavailable', '后端尚未支持可接 AI 的程序底图策略，请升级后端；未降级或重发。')); return }
            }
            execution.generationCalls++
            response = await fetcher.call(globalThis, `${connection.baseUrl}/v1/terrain/basemap`, {
              method: 'POST', headers: { Authorization: `Bearer ${connection.token}`, 'Content-Type': 'application/json' },
              body: canonicalJson(request), signal: controller.signal, credentials: 'omit', cache: 'no-store', redirect: 'error',
            })
          } catch { if (!settled) finish(new BaseMapGenerationClientError('network', '无法取得后端程序底图，请检查连接配置；未自动重发。')); return }
          if (settled || active !== job) { await response.body?.cancel().catch(() => undefined); return }
          if (!current()) { await response.body?.cancel().catch(() => undefined); finish(staleError()); return }
          if (!response.ok) { await response.body?.cancel().catch(() => undefined); finish(serverError(response.status)); return }
          if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get('Content-Type')?.trim() ?? '')) {
            await response.body?.cancel().catch(() => undefined); finish(protocolError()); return
          }
          try { accept(JSON.parse(await boundedResponseText(response, controller.signal))) }
          catch { if (!settled) finish(protocolError()) }
        })().catch(() => { if (!settled) finish(protocolError()) })
      } else {
        try { worker = createWorker() }
        catch { finish(new BaseMapGenerationClientError('unavailable', '无法启动本机程序底图生成，请重新打开面板后重试。')); return }
        worker.onmessage = event => accept(event.data)
        worker.onerror = event => { event.preventDefault(); finish(generationError()) }
        worker.onmessageerror = () => finish(protocolError())
        try { execution.generationCalls++; worker.postMessage(request) } catch { finish(protocolError()) }
      }
    })
  }
  return { generate, cancel, dispose: () => { disposed = true; cancel() } }
}
