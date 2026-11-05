import type { ReadableStreamReadResult } from 'node:stream/web'
import { DOMAIN_GENERATION_LIMITS, executeDomainExecutionRequest, parseDomainExecutionRequest, type DomainExecutionResponse } from '../../src/shared/generation/execution.js'
import { InteriorGenerationError } from '../../src/shared/generation/domains/interior/layout.js'
import { ForestGenerationError } from '../../src/shared/generation/domains/forest/contracts.js'
import { VolcanoGenerationError } from '../../src/shared/generation/domains/volcano/contracts.js'
import { GenerationError } from '../../src/shared/generation/orchestrator.js'
import { TaskFault } from './store.js'

export type DomainGenerationExecutor = (raw: unknown, options: Parameters<typeof executeDomainExecutionRequest>[1]) => DomainExecutionResponse
interface DomainGenerationServiceOptions {
  maxConcurrent: number
  timeoutMs?: number
  execute?: DomainGenerationExecutor
}

/** Only fixed, public explanations cross the HTTP boundary. Domain errors may
 * include request values or internal geometry, so their raw messages stay local. */
export class GenerationServiceFault extends TaskFault {
  constructor(code: string, status: 400 | 409 | 503, readonly safeMessage: string) { super(code, status) }
}

const cancelled = () => new TaskFault('request_cancelled', 409)
const timeout = () => new TaskFault('request_timeout', 503)
const abortFault = (signal: AbortSignal) => signal.reason instanceof TaskFault ? signal.reason : cancelled()

function publicExecutionFault(error: unknown): TaskFault {
  if (error instanceof TaskFault) return error
  const code = error instanceof InteriorGenerationError ? error.reason
    : error instanceof ForestGenerationError || error instanceof VolcanoGenerationError || error instanceof GenerationError ? error.code : undefined
  switch (code) {
    case 'unsupported': return new GenerationServiceFault('generation_unsupported', 400, '当前生成器暂不支持这组要求，请调整范围、支撑或参数。')
    case 'contradiction': return new GenerationServiceFault('generation_contradiction', 400, '生成要求存在冲突，请调整范围、尺寸、关系或通路后再生成。')
    case 'search-exhausted': return new GenerationServiceFault('generation_search_exhausted', 409, '本次有限搜索未找到满足要求的结果；可调整参数，这不代表需求不可行。')
    case 'budget-exceeded': return new GenerationServiceFault('generation_budget_exceeded', 409, '本次生成已达到预算上限，未交付部分结果。')
    case 'cancelled': return cancelled()
    case 'candidate-invalid':
    case 'operator-failed': return new GenerationServiceFault('generation_failed', 409, '生成结果未通过完整检查，请调整参数后重新生成。')
    default: return new TaskFault('invalid_request', 400)
  }
}

function nextChunk(reader: ReadableStreamDefaultReader<Uint8Array>, signal: AbortSignal): Promise<ReadableStreamReadResult<Uint8Array>> {
  return new Promise((resolve, reject) => {
    const cleanup = () => signal.removeEventListener('abort', abort)
    const abort = () => { cleanup(); void reader.cancel().catch(() => {}); reject(abortFault(signal)) }
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) { abort(); return }
    reader.read().then(value => { cleanup(); resolve(value) }, error => { cleanup(); reject(error) })
  })
}

async function readGenerationJson(request: Request, signal: AbortSignal): Promise<unknown> {
  if ((request.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase() !== 'application/json'
    || [...new URL(request.url).searchParams.keys()].length) throw new TaskFault('invalid_request', 400)
  const declared = request.headers.get('content-length')
  if (declared !== null && (!/^\d+$/.test(declared) || !Number.isSafeInteger(Number(declared)) || Number(declared) > DOMAIN_GENERATION_LIMITS.requestBytes)) throw new TaskFault('request_limit', 413)
  if (!request.body) throw new TaskFault('invalid_request', 400)
  const reader = request.body.getReader(), bytes = new Uint8Array(DOMAIN_GENERATION_LIMITS.requestBytes)
  let size = 0
  try {
    while (true) {
      const chunk = await nextChunk(reader, signal)
      if (signal.aborted) throw abortFault(signal)
      if (chunk.done) break
      if (size + chunk.value.byteLength > bytes.byteLength) { void reader.cancel().catch(() => {}); throw new TaskFault('request_limit', 413) }
      bytes.set(chunk.value, size); size += chunk.value.byteLength
    }
    if (declared !== null && Number(declared) !== size) throw new TaskFault('invalid_request', 400)
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, size))) }
    catch { throw new TaskFault('invalid_request', 400) }
  } catch (error) {
    if (signal.aborted) throw abortFault(signal)
    if (error instanceof TaskFault) throw error
    throw new TaskFault('invalid_request', 400)
  } finally { reader.releaseLock() }
}

/** Programmatic generation owns no model requests, AI tasks or continuation
 * ledger. Its exact shared request and result remain subject to host adoption. */
export function createDomainGenerationService(options: DomainGenerationServiceOptions) {
  const { maxConcurrent, timeoutMs = DOMAIN_GENERATION_LIMITS.maxTimeoutMs, execute = executeDomainExecutionRequest } = options
  if (!Number.isSafeInteger(maxConcurrent) || maxConcurrent < 1 || maxConcurrent > 4
    || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > DOMAIN_GENERATION_LIMITS.maxTimeoutMs) throw new Error('Invalid generation service limits')
  let active = 0
  return {
    async generate(request: Request): Promise<string> {
      if (request.signal.aborted) throw cancelled()
      // Occupy a slot before consuming a body, including a stalled stream.
      if (active >= maxConcurrent) throw new TaskFault('request_limit', 429)
      active++
      const controller = new AbortController(), started = performance.now()
      const abort = () => controller.abort(cancelled())
      const check = () => {
        if (performance.now() - started >= timeoutMs && !controller.signal.aborted) controller.abort(timeout())
        if (controller.signal.aborted) throw abortFault(controller.signal)
      }
      const nowMilliseconds = () => { check(); return Math.floor(performance.now()) }
      const timer = setTimeout(() => controller.abort(timeout()), timeoutMs)
      timer.unref?.()
      request.signal.addEventListener('abort', abort, { once: true })
      try {
        if (request.signal.aborted) abort()
        check()
        const raw = await readGenerationJson(request, controller.signal)
        check()
        let result: DomainExecutionResponse
        try {
          const prepared = parseDomainExecutionRequest(raw)
          result = execute(prepared, { nowMilliseconds, signal: controller.signal })
        } catch (error) {
          check()
          throw publicExecutionFault(error)
        }
        // Shared execution cooperatively checks the clock/signal. A synchronous
        // executor cannot be forcibly preempted; a late result is discarded.
        check()
        let body: string
        try { body = JSON.stringify(result); if (typeof body !== 'string') throw new Error('Invalid result') }
        catch { throw new TaskFault('invalid_result', 503) }
        if (Buffer.byteLength(body, 'utf8') > DOMAIN_GENERATION_LIMITS.resultBytes) throw new TaskFault('result_limit', 413)
        check()
        return body
      } finally {
        clearTimeout(timer); request.signal.removeEventListener('abort', abort); active--
      }
    },
  }
}
