import type { ReadableStreamReadResult } from 'node:stream/web'
import { BASE_MAP_LIMITS, executeBaseMapRequest, type BaseMapResponse } from '../../src/shared/terrain-generation/base-map.js'
import { TaskFault } from './store.js'

interface BaseMapServiceOptions {
  maxConcurrent: number
  bodyTimeoutMs?: number
  execute?: (raw: unknown) => BaseMapResponse
}

const cancelled = () => new TaskFault('request_cancelled', 409)
const abortFault = (signal: AbortSignal) => signal.reason instanceof TaskFault ? signal.reason : cancelled()
function nextChunk(reader: ReadableStreamDefaultReader<Uint8Array>, signal: AbortSignal): Promise<ReadableStreamReadResult<Uint8Array>> {
  return new Promise((resolve, reject) => {
    const cleanup = () => signal.removeEventListener('abort', abort)
    const abort = () => { cleanup(); void reader.cancel().catch(() => {}); reject(abortFault(signal)) }
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) { abort(); return }
    reader.read().then(value => { cleanup(); resolve(value) }, error => { cleanup(); reject(error) })
  })
}

/** This reader has its own fixed limit; the conversation reader's 32KiB policy stays separate. */
async function readBaseMapJson(request: Request, timeoutMs: number): Promise<unknown> {
  if ((request.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase() !== 'application/json') throw new TaskFault('invalid_request', 400)
  const declared = request.headers.get('content-length')
  if (declared !== null && (!/^\d+$/.test(declared) || !Number.isSafeInteger(Number(declared)) || Number(declared) > BASE_MAP_LIMITS.requestBytes)) throw new TaskFault('request_limit', 413)
  if (!request.body) throw new TaskFault('invalid_request', 400)
  const reader = request.body.getReader(), bodyAbort = new AbortController()
  const abort = () => bodyAbort.abort(cancelled())
  request.signal.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(() => bodyAbort.abort(new TaskFault('request_timeout', 503)), timeoutMs)
  timer.unref?.()
  // A fixed buffer also bounds bookkeeping when a sender splits JSON into tiny chunks.
  const bytes = new Uint8Array(BASE_MAP_LIMITS.requestBytes)
  let size = 0
  try {
    if (request.signal.aborted) abort()
    while (true) {
      const chunk = await nextChunk(reader, bodyAbort.signal)
      if (bodyAbort.signal.aborted) throw abortFault(bodyAbort.signal)
      if (chunk.done) break
      if (size + chunk.value.byteLength > bytes.byteLength) { void reader.cancel().catch(() => {}); throw new TaskFault('request_limit', 413) }
      bytes.set(chunk.value, size); size += chunk.value.byteLength
    }
    if (declared !== null && Number(declared) !== size) throw new TaskFault('invalid_request', 400)
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, size))) as unknown }
    catch { throw new TaskFault('invalid_request', 400) }
  } catch (error) {
    if (bodyAbort.signal.aborted) throw abortFault(bodyAbort.signal)
    if (error instanceof TaskFault) throw error
    throw new TaskFault('invalid_request', 400)
  } finally {
    clearTimeout(timer); request.signal.removeEventListener('abort', abort); reader.releaseLock()
  }
}

/** Stateless CPU work: no TaskStore writes, model requests, detached retries or adoption. */
export function createBaseMapService(options: BaseMapServiceOptions) {
  const { maxConcurrent, execute = executeBaseMapRequest, bodyTimeoutMs = 30_000 } = options
  if (!Number.isSafeInteger(maxConcurrent) || maxConcurrent < 1 || maxConcurrent > 4
    || !Number.isSafeInteger(bodyTimeoutMs) || bodyTimeoutMs < 1 || bodyTimeoutMs > 60_000) throw new Error('Invalid base-map service limits')
  let active = 0
  return {
    async generate(request: Request): Promise<string> {
      if (request.signal.aborted) throw cancelled()
      // Reserve before awaiting any bytes, including stalled request bodies.
      if (active >= maxConcurrent) throw new TaskFault('request_limit', 429)
      active++
      try {
        const raw = await readBaseMapJson(request, bodyTimeoutMs)
        if (request.signal.aborted) throw cancelled()
        let result: BaseMapResponse
        try { result = execute(raw) } catch { throw new TaskFault('invalid_request', 400) }
        // Synchronous execution has internal hard budgets; it is not preemptible.
        if (request.signal.aborted) throw cancelled()
        let body: string
        try { body = JSON.stringify(result) } catch { throw new TaskFault('invalid_result', 503) }
        if (Buffer.byteLength(body, 'utf8') > BASE_MAP_LIMITS.resultBytes) throw new TaskFault('result_limit', 413)
        return body
      } finally { active-- }
    },
  }
}
