import {
  executeDomainExecutionRequest, parseDomainExecutionRequest,
  type DomainExecutionRequest, type DomainExecutionResponse,
} from '../../../shared/generation/execution.js'

export interface DomainGenerationWorkerError {
  protocolVersion: 1
  type: 'error'
  requestId: string
  context: DomainExecutionRequest['context']
  requestHash: string
  domain: DomainExecutionRequest['domain']
  error: { code: 'generation_failed'; message: string }
}
export type DomainGenerationWorkerResponse = DomainExecutionResponse | DomainGenerationWorkerError

/** Only generation runs here. Resource validation and adoption remain host-owned. */
export function executeDomainGenerationWorkerRequest(raw: unknown): DomainGenerationWorkerResponse {
  // Invalid correlation data must never be echoed as a usable response.
  const request = parseDomainExecutionRequest(raw)
  try {
    return executeDomainExecutionRequest(request, { nowMilliseconds: () => Math.floor(performance.now()) })
  } catch (failure) {
    const message = failure instanceof Error ? failure.message.slice(0, 512) : ''
    return { protocolVersion: 1, type: 'error', requestId: request.requestId, context: request.context,
      requestHash: request.requestHash, domain: request.domain,
      error: { code: 'generation_failed', message: message || '生成未完成，请调整设置后重新预览。' } }
  }
}

interface DomainWorkerScope {
  onmessage: ((event: MessageEvent<unknown>) => void) | null
  postMessage: (message: DomainGenerationWorkerResponse) => void
  close: () => void
}
const scope = globalThis as unknown as DomainWorkerScope
if (typeof document === 'undefined' && typeof scope.postMessage === 'function' && typeof scope.close === 'function') {
  let consumed = false
  scope.onmessage = event => {
    if (consumed) return
    consumed = true
    try { scope.postMessage(executeDomainGenerationWorkerRequest(event.data)) }
    finally { scope.close() }
  }
}
