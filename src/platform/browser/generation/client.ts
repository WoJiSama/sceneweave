import { z } from 'zod'
import {
  DOMAIN_GENERATION_LIMITS, parseDomainGenerationCapabilities,
  parseDomainExecutionRequest, parseDomainExecutionResponse,
  type DomainExecutionRequest, type DomainExecutionResponse,
} from '../../../shared/generation/execution.js'
import { canonicalJson, captureJson, encodeUtf8 } from '../../../shared/validation/json.js'

const MAX_CAPABILITY_BYTES = 64 * 1024
const workerErrorSchema = z.object({ protocolVersion: z.literal(1), type: z.literal('error'), requestId: z.string(),
  context: z.unknown(), requestHash: z.string(), domain: z.enum(['interior', 'forest', 'volcano']),
  error: z.object({ code: z.literal('generation_failed'), message: z.string().min(1).max(512) }).strict(),
}).strict()
const serverErrorSchema = z.object({ schemaVersion: z.literal(1), error: z.object({
  code: z.enum(['generation_unsupported', 'generation_contradiction', 'generation_search_exhausted', 'generation_budget_exceeded', 'generation_failed', 'request_cancelled', 'request_timeout']),
  message: z.string().min(1).max(512), retryable: z.literal(false), requestState: z.literal('not_sent'),
}).strict() }).strict()

export interface DomainGenerationWorker {
  onmessage: ((event: MessageEvent<unknown>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null
  postMessage: (message: unknown) => void
  terminate: () => void
}
export interface DomainGenerationClientOptions {
  createWorker?: () => DomainGenerationWorker
  fetch?: typeof globalThis.fetch
}
export interface DomainGenerationRunOptions {
  signal?: AbortSignal
  timeoutMs?: number
  isCurrent?: (request: Readonly<DomainExecutionRequest>) => boolean
  /** Explicit per-request transport choice; never persisted or used as a fallback. */
  server?: { baseUrl: string; token: string }
}
export interface DomainGenerationClient {
  execute: (request: DomainExecutionRequest, options?: DomainGenerationRunOptions) => Promise<DomainExecutionResponse>
  cancel: () => void
  dispose: () => void
}
export class DomainGenerationClientError extends Error {
  constructor(public readonly code: 'invalid_input' | 'configuration' | 'protocol' | 'generation_failed' | 'stale' | 'unavailable' | 'network' | 'timeout' | 'disposed', message: string) {
    super(message); this.name = 'DomainGenerationClientError'
  }
}
const abortError = () => new DOMException('已取消地图生成。', 'AbortError')
const protocolError = () => new DomainGenerationClientError('protocol', '生成响应格式或身份校验失败，请重新预览。')
const staleError = () => new DomainGenerationClientError('stale', '当前工程或生成设置已经变化，已丢弃过期候选。')
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const identityMatches = (value: Record<string, unknown>, request: DomainExecutionRequest) => value.requestId === request.requestId
  && value.requestHash === request.requestHash && value.domain === request.domain && canonicalJson(value.context) === canonicalJson(request.context)

function serverConnection(raw: DomainGenerationRunOptions['server']): DomainGenerationRunOptions['server'] {
  if (!raw) return undefined
  if (typeof raw.baseUrl !== 'string' || typeof raw.token !== 'string' || !raw.token.trim() || /[\r\n]/.test(raw.token)) {
    throw new DomainGenerationClientError('configuration', '请填写有效的后端地址和应用凭据。')
  }
  let url: URL
  try { url = new URL(raw.baseUrl.trim()) } catch { throw new DomainGenerationClientError('configuration', '后端地址须为完整的 HTTPS 地址，或本机 HTTP 地址。') }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) || url.username || url.password
    || url.pathname !== '/' || url.search || url.hash) throw new DomainGenerationClientError('configuration', '后端地址只填写 HTTPS 域名和端口；本地开发可用 HTTP。')
  return { baseUrl: url.origin, token: raw.token.trim() }
}

/** Limit actual received bytes, including whitespace and multi-byte UTF-8. */
async function readJson(response: Response, signal: AbortSignal, maximumBytes: number): Promise<unknown> {
  if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get('Content-Type')?.trim() ?? '')) {
    await response.body?.cancel().catch(() => undefined); throw protocolError()
  }
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
      if (size > maximumBytes) throw protocolError()
      chunks.push(part.value)
    }
    const bytes = new Uint8Array(size); let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch {
    if (signal.aborted) throw abortError()
    throw protocolError()
  } finally {
    signal.removeEventListener('abort', cancel)
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}

/** One active request, one explicit transport, no fallback or automatic retry. */
export function createDomainGenerationClient(options: DomainGenerationClientOptions = {}): DomainGenerationClient {
  const createWorker = options.createWorker ?? (() => new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'sceneweave-domain-generation' }))
  const fetcher = options.fetch ?? globalThis.fetch
  let disposed = false, active: { cancel: () => void } | null = null
  const cancel = () => active?.cancel()
  const execute: DomainGenerationClient['execute'] = async (raw, runOptions = {}) => {
    cancel()
    if (disposed) throw new DomainGenerationClientError('disposed', '地图生成入口已关闭。')
    if (runOptions.signal?.aborted) throw abortError()
    const timeoutMs = runOptions.timeoutMs ?? 30_000
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > DOMAIN_GENERATION_LIMITS.maxTimeoutMs) {
      throw new DomainGenerationClientError('configuration', '地图生成等待时间须为1–60000毫秒。')
    }
    let request: DomainExecutionRequest
    try { request = parseDomainExecutionRequest(raw) }
    catch { throw new DomainGenerationClientError('invalid_input', '生成设置或场景内容无效，请重新准备预览。') }
    const server = serverConnection(runOptions.server)
    const current = () => {
      try { return !runOptions.signal?.aborted && (runOptions.isCurrent?.(request) ?? true) }
      catch { return false }
    }
    if (!current()) throw staleError()
    return new Promise<DomainExecutionResponse>((resolve, reject) => {
      const controller = new AbortController()
      let worker: DomainGenerationWorker | undefined, settled = false
      let timer: ReturnType<typeof setTimeout> | undefined
      const job = { cancel: () => finish(abortError()) }
      function finish(failure?: Error, response?: DomainExecutionResponse): void {
        if (settled) return
        settled = true
        if (active === job) active = null
        if (timer !== undefined) clearTimeout(timer)
        runOptions.signal?.removeEventListener('abort', job.cancel)
        controller.abort()
        if (worker) {
          worker.onmessage = null; worker.onerror = null; worker.onmessageerror = null
          try { worker.terminate() } catch { /* Cleanup failure cannot keep a request pending. */ }
        }
        if (failure) reject(failure)
        else if (response) resolve(response)
        else reject(protocolError())
      }
      function accept(rawResponse: unknown): void {
        if (settled || active !== job) return
        if (!current()) { finish(staleError()); return }
        try {
          const captured = captureJson(rawResponse)
          if (encodeUtf8(canonicalJson(captured)).byteLength > DOMAIN_GENERATION_LIMITS.resultBytes) throw protocolError()
          if (isRecord(captured) && 'requestId' in captured && 'requestHash' in captured && 'domain' in captured && 'context' in captured
            && !identityMatches(captured, request)) throw staleError()
          if (isRecord(captured) && captured.type === 'error') {
            const error = workerErrorSchema.parse(captured)
            if (!identityMatches(error, request)) throw staleError()
            finish(new DomainGenerationClientError('generation_failed', error.error.message)); return
          }
          const response = parseDomainExecutionResponse(captured, request)
          if (!current()) throw staleError()
          finish(undefined, response)
        } catch (failure) { finish(failure instanceof DomainGenerationClientError ? failure : protocolError()) }
      }
      active = job
      runOptions.signal?.addEventListener('abort', job.cancel, { once: true })
      if (runOptions.signal?.aborted) { job.cancel(); return }
      timer = setTimeout(() => finish(new DomainGenerationClientError('timeout', '生成等待超时，已停止等待；可缩小范围后重新预览。')), timeoutMs)
      if (server) {
        const connection = server
        void (async () => {
          const init = { headers: { Authorization: `Bearer ${connection.token}` }, signal: controller.signal,
            credentials: 'omit', cache: 'no-store', redirect: 'error' } as const
          const get = await fetcher.call(globalThis, `${connection.baseUrl}/v1/generation/capabilities`, { ...init, method: 'GET' })
          if (settled || active !== job) { await get.body?.cancel().catch(() => undefined); return }
          if (!current()) { await get.body?.cancel().catch(() => undefined); finish(staleError()); return }
          if (!get.ok) { await get.body?.cancel().catch(() => undefined); finish(new DomainGenerationClientError('unavailable', '后端尚未提供所需的地图生成能力，请检查连接；未自动重发。')); return }
          const capabilities = await readJson(get, controller.signal, MAX_CAPABILITY_BYTES)
          try { parseDomainGenerationCapabilities(capabilities, 'server') } catch { throw protocolError() }
          if (settled || active !== job) return
          if (!current()) { finish(staleError()); return }
          const response = await fetcher.call(globalThis, `${connection.baseUrl}/v1/generation`, { ...init, method: 'POST',
            headers: { ...init.headers, 'Content-Type': 'application/json' }, body: canonicalJson(request) })
          if (settled || active !== job) { await response.body?.cancel().catch(() => undefined); return }
          if (!current()) { await response.body?.cancel().catch(() => undefined); finish(staleError()); return }
          if (!response.ok) {
            let message: string | undefined
            if (response.status !== 401 && response.status !== 403 && response.status !== 429) {
              try { message = serverErrorSchema.parse(await readJson(response, controller.signal, MAX_CAPABILITY_BYTES)).error.message }
              catch { /* Unknown server failures use a local message, never an unvalidated body. */ }
            } else await response.body?.cancel().catch(() => undefined)
            finish(new DomainGenerationClientError('generation_failed', response.status === 401 || response.status === 403
              ? '后端拒绝访问，请检查应用凭据和允许的站点 Origin。' : response.status === 429
                ? '地图生成服务当前繁忙，请稍后手动重试；未自动重发。' : message ?? '后端未完成地图生成，请检查设置；未自动重发。')); return
          }
          accept(await readJson(response, controller.signal, DOMAIN_GENERATION_LIMITS.resultBytes))
        })().catch(failure => {
          if (!settled) finish(failure instanceof DomainGenerationClientError ? failure
            : new DomainGenerationClientError('network', '无法取得后端生成结果，请检查连接；未自动重发。'))
        })
      } else {
        try { worker = createWorker() }
        catch { finish(new DomainGenerationClientError('unavailable', '无法启动本机地图生成，请重新打开入口后重试。')); return }
        worker.onmessage = event => accept(event.data)
        worker.onerror = event => { event.preventDefault(); finish(new DomainGenerationClientError('generation_failed', '生成未完成，请调整设置后重新预览。')) }
        worker.onmessageerror = () => finish(protocolError())
        try { worker.postMessage(request) } catch { finish(protocolError()) }
      }
    })
  }
  return { execute, cancel, dispose: () => { disposed = true; cancel() } }
}
