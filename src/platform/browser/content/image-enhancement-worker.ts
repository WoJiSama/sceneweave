import type { ImagePixels } from '../../../shared/image-import/pixels.js'
import { IMAGE_ENHANCEMENT_LIMITS, parseImageEnhancementRecipe, type ImageEnhancementCandidate, type ImageEnhancementOptions } from '../../../shared/image-enhancement/index.js'

export interface ImageEnhancementWorkerRequest { image: ImagePixels; options: ImageEnhancementOptions }
export type ImageEnhancementWorkerResponse = { ok: true; candidates: ImageEnhancementCandidate[] } | { ok: false; error: { name: string; message: string } }

/** Each review group owns a disposable worker; cancellation interrupts CPU work immediately. */
export async function generateImageEnhancementCandidatesAsync(image: ImagePixels, options: ImageEnhancementOptions,
  signal?: AbortSignal): Promise<ImageEnhancementCandidate[]> {
  signal?.throwIfAborted()
  const limits = IMAGE_ENHANCEMENT_LIMITS
  if (!image || !Number.isSafeInteger(image.width) || !Number.isSafeInteger(image.height) || image.width < 1 || image.height < 1
    || image.width > limits.inputEdge || image.height > limits.inputEdge || image.width * image.height > limits.inputPixels
    || !(image.data instanceof Uint8ClampedArray) || image.data.length !== image.width * image.height * 4) throw new Error('画质处理需要完整RGBA图像，最多400万像素。')
  if (!options || options.count !== 2 && options.count !== 3) throw new Error('每组画质候选需要2或3个结果。')
  const recipe = parseImageEnhancementRecipe({ version: 1, direction: options.direction, strength: 'gentle', scale: options.scale ?? (options.direction === 'clarity' ? 2 : 1) })
  const outputPixels = image.width * image.height * recipe.scale * recipe.scale
  if (image.width * recipe.scale > limits.outputEdge || image.height * recipe.scale > limits.outputEdge || outputPixels > limits.outputPixels
    || outputPixels * options.count > limits.candidatePixels) throw new Error('画质候选超过PNG边长4096、单张800万或整组1600万像素，请降低倍率或缩小范围。')
  if (options.scopeMask !== undefined && (!(options.scopeMask instanceof Uint8Array) || options.scopeMask.length !== image.width * image.height
    || !options.scopeMask.some(value => value > 0))) throw new Error('处理选区须与源图尺寸一致，并包含要处理的像素。')
  if (typeof Worker === 'undefined') throw new Error('此浏览器不支持后台画质处理。')
  // Transfer owned copies so the review baseline remains readable by the UI and preparation witness.
  const request: ImageEnhancementWorkerRequest = { image: { width: image.width, height: image.height, data: image.data.slice() },
    options: { direction: recipe.direction, count: options.count, scale: recipe.scale,
      ...(options.scopeMask ? { scopeMask: options.scopeMask.slice() } : {}) } }
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./image-enhancement.worker.ts', import.meta.url), { type: 'module' })
    let settled = false
    const finish = (result: ImageEnhancementCandidate[] | undefined, error?: unknown) => {
      if (settled) return
      settled = true; signal?.removeEventListener('abort', abort)
      worker.onmessage = null; worker.onerror = null; worker.onmessageerror = null; worker.terminate()
      if (result) resolve(result); else reject(error)
    }
    const abort = () => finish(undefined, new DOMException('画质候选已取消。', 'AbortError'))
    worker.onmessage = (event: MessageEvent<ImageEnhancementWorkerResponse>) => {
      const value = event.data
      if (value?.ok === true && Array.isArray(value.candidates) && value.candidates.length === request.options.count) finish(value.candidates)
      else if (value?.ok === false && typeof value.error?.message === 'string') {
        const error = new Error(value.error.message); error.name = value.error.name; finish(undefined, error)
      } else finish(undefined, new Error('后台画质处理返回了无效候选。'))
    }
    worker.onerror = event => finish(undefined, new Error(event.message || '后台画质处理失败，请重新生成。'))
    worker.onmessageerror = () => finish(undefined, new Error('后台画质候选无法读取，请重新生成。'))
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) { abort(); return }
    try {
      const transfer = [request.image.data.buffer as ArrayBuffer]
      if (request.options.scopeMask) transfer.push(request.options.scopeMask.buffer as ArrayBuffer)
      worker.postMessage(request, transfer)
    } catch (error) { finish(undefined, error) }
  })
}
