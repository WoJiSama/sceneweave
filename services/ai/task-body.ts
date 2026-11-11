import type { ReadableStreamReadResult } from 'node:stream/web'
import { AI_LIMITS } from '../../src/shared/ai/protocol.js'
import { TaskFault } from './store.js'

interface TaskBodyOptions { maxConcurrent: number; maxBytes: number; timeoutMs?: number }
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

/** Upload admission belongs to the app, before task creation or provider billing.
 * Reserve the full bounded buffer so concurrent uploads share a real byte cap. */
export function createTaskBodyReader({ maxConcurrent, maxBytes, timeoutMs = 30_000 }: TaskBodyOptions) {
  if (!Number.isSafeInteger(maxConcurrent) || maxConcurrent < 1 || maxConcurrent > 4
    || !Number.isSafeInteger(maxBytes) || maxBytes < 1
    || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) throw new Error('Invalid task upload limits')
  let active = 0, reservedBytes = 0
  return async function boundedJson(request: Request, limit: number = AI_LIMITS.requestBytes): Promise<unknown> {
    if (request.signal.aborted) throw cancelled()
    if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('Invalid task upload byte limit')
    if ((request.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase() !== 'application/json') throw new TaskFault('invalid_request', 400)
    const declared = request.headers.get('content-length')
    if (declared !== null && (!/^\d+$/.test(declared) || !Number.isSafeInteger(Number(declared)) || Number(declared) > limit)) throw new TaskFault('request_limit', 413)
    if (!request.body) throw new TaskFault('invalid_request', 400)
    if (active >= maxConcurrent || limit > maxBytes - reservedBytes) {
      void request.body.cancel().catch(() => {})
      throw new TaskFault('request_limit', 429)
    }
    active++; reservedBytes += limit
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined, timer: ReturnType<typeof setTimeout> | undefined
    const controller = new AbortController(), abort = () => controller.abort(cancelled())
    try {
      reader = request.body.getReader()
      request.signal.addEventListener('abort', abort, { once: true })
      timer = setTimeout(() => controller.abort(new TaskFault('request_timeout', 503)), timeoutMs)
      timer.unref?.()
      const bytes = new Uint8Array(limit)
      let size = 0
      if (request.signal.aborted) abort()
      while (true) {
        const chunk = await nextChunk(reader, controller.signal)
        if (controller.signal.aborted) throw abortFault(controller.signal)
        if (chunk.done) break
        if (size + chunk.value.byteLength > bytes.byteLength) { void reader.cancel().catch(() => {}); throw new TaskFault('request_limit', 413) }
        bytes.set(chunk.value, size); size += chunk.value.byteLength
      }
      if (declared !== null && Number(declared) !== size) throw new TaskFault('invalid_request', 400)
      let value: unknown
      try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, size))) }
      catch { throw new TaskFault('invalid_request', 400) }
      if (size > AI_LIMITS.requestBytes && (!value || typeof value !== 'object' || (!Object.hasOwn(value, 'authoring') && !Object.hasOwn(value, 'vision')))) throw new TaskFault('request_limit', 413)
      return value
    } catch (error) {
      if (controller.signal.aborted) throw abortFault(controller.signal)
      if (error instanceof TaskFault) throw error
      throw new TaskFault('invalid_request', 400)
    } finally {
      clearTimeout(timer); request.signal.removeEventListener('abort', abort); reader?.releaseLock()
      active--; reservedBytes -= limit
    }
  }
}
