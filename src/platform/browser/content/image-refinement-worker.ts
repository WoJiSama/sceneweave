import type { VectorRefinementOptions, VectorRefinementResult } from '../../../shared/asset-refinement/vector.js'
import { CURRENT_VECTOR_ALGORITHM, replayVectorRefinement } from '../../../shared/asset-refinement/algorithms.js'
import type { ImagePixels } from '../../../shared/image-import/pixels.js'

export async function refineImageToVectorAsync(pixels: ImagePixels, options: VectorRefinementOptions, signal?: AbortSignal): Promise<VectorRefinementResult> {
  signal?.throwIfAborted()
  if (typeof Worker === 'undefined') return replayVectorRefinement(CURRENT_VECTOR_ALGORITHM, pixels, options, signal)
  const worker = new Worker(new URL('./image-refinement.worker.ts', import.meta.url), { type: 'module' })
  return new Promise((resolve, reject) => {
    const finish = () => { signal?.removeEventListener('abort', cancel); worker.terminate() }
    const cancel = () => { finish(); reject(signal?.reason ?? new DOMException('处理已取消', 'AbortError')) }
    signal?.addEventListener('abort', cancel, { once: true })
    worker.onerror = () => { finish(); reject(new Error('矢量重建Worker未完成，请检查输入或重试。')) }
    worker.onmessage = (event: MessageEvent) => {
      finish()
      if (event.data.error) reject(new Error(event.data.error))
      else resolve(event.data.result)
    }
    const copy = { ...pixels, data: pixels.data.slice() }
    worker.postMessage({ pixels: copy, options }, [copy.data.buffer])
  })
}
