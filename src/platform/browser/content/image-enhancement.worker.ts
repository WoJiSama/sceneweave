import { generateImageEnhancementCandidates } from '../../../shared/image-enhancement/index.js'
import type { ImageEnhancementWorkerRequest, ImageEnhancementWorkerResponse } from './image-enhancement-worker.js'

interface ImageWorkerScope {
  onmessage: ((event: MessageEvent<ImageEnhancementWorkerRequest>) => void) | null
  postMessage: (message: ImageEnhancementWorkerResponse, transfer?: ArrayBuffer[]) => void
  close: () => void
}
const scope = globalThis as unknown as ImageWorkerScope
if (typeof document === 'undefined' && typeof scope.postMessage === 'function' && typeof scope.close === 'function') {
  let consumed = false
  scope.onmessage = event => {
    if (consumed) return
    consumed = true
    try {
      const candidates = generateImageEnhancementCandidates(event.data.image, event.data.options)
      scope.postMessage({ ok: true, candidates }, candidates.map(candidate => candidate.pixels.data.buffer as ArrayBuffer))
    } catch (failure) {
      scope.postMessage({ ok: false, error: { name: failure instanceof Error ? failure.name : 'Error',
        message: failure instanceof Error ? failure.message.slice(0, 512) : '画质候选未能生成。' } })
    } finally { scope.close() }
  }
}
