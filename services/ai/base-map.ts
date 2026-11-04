import type { ReadableStreamReadResult } from 'node:stream/web'
import { BASE_MAP_LIMITS, executeBaseMapRequest, type BaseMapResponse } from '../../src/shared/terrain-generation/base-map.js'
import { executeBaseMapRequestV2, parseBaseMapRequestV2, type BaseMapRequestV2, type BaseMapResponseV2 } from '../../src/shared/terrain-generation/base-map-v2.js'
import { BASE_MAP_V3_LIMITS, executeBaseMapRequestV3, parseBaseMapRequestV3, type BaseMapRequestV3, type BaseMapResponseV3 } from '../../src/shared/terrain-generation/base-map-v3.js'
import { TaskFault, type BaseMapExecutionToken } from './store.js'

interface BaseMapServiceOptions {
  maxConcurrent: number
  bodyTimeoutMs?: number
  execute?: (raw: unknown) => BaseMapResponse | BaseMapResponseV2 | BaseMapResponseV3
  execution?: {
    begin(owner: string, request: BaseMapRequestV2 | BaseMapRequestV3): BaseMapExecutionToken
    measure?<T>(token: BaseMapExecutionToken, run: () => T): T
    finish(token: BaseMapExecutionToken, elapsedMs: number, resultHash?: string): void
  }
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
  const params = new URL(request.url).searchParams
  const version = params.get('baseMapVersion')
  if ([...params.keys()].some(key => key !== 'baseMapVersion') || params.getAll('baseMapVersion').length > 1) throw new TaskFault('invalid_request', 400)
  if (version !== null && version !== '3') throw new TaskFault('unsupported_authoring_version', 400)
  const maximumBytes = version === '3' ? BASE_MAP_V3_LIMITS.requestBytes : BASE_MAP_LIMITS.requestBytes
  const declared = request.headers.get('content-length')
  if (declared !== null && (!/^\d+$/.test(declared) || !Number.isSafeInteger(Number(declared)) || Number(declared) > maximumBytes)) throw new TaskFault('request_limit', 413)
  if (!request.body) throw new TaskFault('invalid_request', 400)
  const reader = request.body.getReader(), bodyAbort = new AbortController()
  const abort = () => bodyAbort.abort(cancelled())
  request.signal.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(() => bodyAbort.abort(new TaskFault('request_timeout', 503)), timeoutMs)
  timer.unref?.()
  // A fixed buffer also bounds bookkeeping when a sender splits JSON into tiny chunks.
  const bytes = new Uint8Array(maximumBytes)
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
    let value: unknown
    try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, size))) }
    catch { throw new TaskFault('invalid_request', 400) }
    if (version === '3' && (!value || typeof value !== 'object' || !('version' in value) || value.version !== 3)) throw new TaskFault('invalid_request', 400)
    return value
  } catch (error) {
    if (bodyAbort.signal.aborted) throw abortFault(bodyAbort.signal)
    if (error instanceof TaskFault) throw error
    throw new TaskFault('invalid_request', 400)
  } finally {
    clearTimeout(timer); request.signal.removeEventListener('abort', abort); reader.releaseLock()
  }
}

/** v1 remains stateless. Classified v2/v3 bind actual generation work to their frozen flow. */
export function createBaseMapService(options: BaseMapServiceOptions) {
  const { maxConcurrent, execute = (raw: unknown) => raw && typeof raw === 'object' && 'version' in raw && raw.version === 3
    ? executeBaseMapRequestV3(raw) : raw && typeof raw === 'object' && 'version' in raw && raw.version === 2 ? executeBaseMapRequestV2(raw) : executeBaseMapRequest(raw), bodyTimeoutMs = 30_000 } = options
  if (!Number.isSafeInteger(maxConcurrent) || maxConcurrent < 1 || maxConcurrent > 4
    || !Number.isSafeInteger(bodyTimeoutMs) || bodyTimeoutMs < 1 || bodyTimeoutMs > 60_000) throw new Error('Invalid base-map service limits')
  let active = 0
  return {
    async generate(request: Request, owner?: string): Promise<string> {
      if (request.signal.aborted) throw cancelled()
      // Reserve before awaiting any bytes, including stalled request bodies.
      if (active >= maxConcurrent) throw new TaskFault('request_limit', 429)
      active++
      const started = performance.now()
      let token: BaseMapExecutionToken | undefined, result: BaseMapResponse | BaseMapResponseV2 | BaseMapResponseV3 | undefined
      try {
        const raw = await readBaseMapJson(request, bodyTimeoutMs)
        if (request.signal.aborted) throw cancelled()
        if (raw && typeof raw === 'object' && 'version' in raw && (raw.version === 2 || raw.version === 3)) {
          let prepared: BaseMapRequestV2 | BaseMapRequestV3
          try { prepared = raw.version === 3 ? parseBaseMapRequestV3(raw) : parseBaseMapRequestV2(raw) } catch { throw new TaskFault('invalid_request', 400) }
          if (!owner || !options.execution) throw new TaskFault('execution_checkpoint_missing')
          token = options.execution.begin(owner, prepared)
        }
        try { result = token && options.execution?.measure ? options.execution.measure(token, () => execute(raw)) : execute(raw) } catch (error) { if (error instanceof TaskFault) throw error; throw new TaskFault('invalid_request', 400) }
        // Synchronous execution has internal hard budgets; it is not preemptible.
        if (request.signal.aborted) throw cancelled()
        let body: string
        try { body = JSON.stringify(result) } catch { throw new TaskFault('invalid_result', 503) }
        if (Buffer.byteLength(body, 'utf8') > (result.version === 3 ? BASE_MAP_V3_LIMITS.resultBytes : BASE_MAP_LIMITS.resultBytes)) throw new TaskFault('result_limit', 413)
        return body
      } finally {
        active--
        if (token) options.execution!.finish(token, performance.now() - started, result?.resultHash)
      }
    },
  }
}
