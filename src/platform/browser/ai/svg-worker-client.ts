import { verifyNormalizedStaticSvg, STATIC_SVG_LIMITS, type NormalizedStaticSvg } from '../../../shared/ai/svg.js'
import { CancelledOperationError, checkCancelled, type CancellationSignal, type RasterImage } from '../../../shared/ports/resources.js'
import { WeightedTaskQueue } from '../../../shared/project/task-queue.js'
import { rasterizeCanonicalSvgPixels } from './svg-raster.js'

interface Slot { worker: Worker; busy: boolean; cancel?: () => void; idle?: ReturnType<typeof setTimeout> }
// Bound the worker count and active raster pixels independently of the outer
// resource validator. No RGBA survives a completed task; idle WASM is released.
const queue = new WeightedTaskQueue(2, 16_000_000), slots = new Set<Slot>()
let generation = 0
const release = (slot: Slot) => { clearTimeout(slot.idle); slot.worker.terminate(); slots.delete(slot) }
/** Closing a document cancels active and queued work, including bfcache entry. */
export function disposeCanonicalSvgWorkers(): void {
  generation++
  for (const slot of slots) { if (slot.cancel) slot.cancel(); else release(slot) }
}
if (typeof window !== 'undefined') window.addEventListener('pagehide', disposeCanonicalSvgWorkers)

export async function rasterizeCanonicalSvgInWorker(input: NormalizedStaticSvg, dimensions: { width: number; height: number }, signal?: CancellationSignal): Promise<RasterImage> {
  checkCancelled(signal)
  // Keep the nonbrowser/explicit legacy test environment on the same engine.
  if (typeof Worker === 'undefined') return rasterizeCanonicalSvgPixels(input, dimensions, signal)
  const source = verifyNormalizedStaticSvg(input), { width, height } = dimensions
  if (![width, height].every(value => Number.isSafeInteger(value) && value > 0 && value <= STATIC_SVG_LIMITS.rasterSide)
    || width * height > STATIC_SVG_LIMITS.rasterPixels) throw new Error('SVG输出尺寸超出像素保护预算。')
  const admittedGeneration = generation
  const cancellation: CancellationSignal = { get aborted() { return generation !== admittedGeneration || signal?.aborted === true },
    addEventListener: signal?.addEventListener?.bind(signal), removeEventListener: signal?.removeEventListener?.bind(signal) }
  return queue.run(width * height, cancellation, () => new Promise<RasterImage>((resolve, reject) => {
    checkCancelled(cancellation)
    let slot = [...slots].find(value => !value.busy)
    if (!slot) { slot = { worker: new Worker(new URL('./svg-worker.ts', import.meta.url), { type: 'module' }), busy: false }; slots.add(slot) }
    const active = slot; clearTimeout(active.idle); active.busy = true
    let settled = false
    const finish = (error?: unknown, image?: RasterImage) => {
      if (settled) return
      settled = true; clearInterval(poll); clearTimeout(timeout)
      signal?.removeEventListener?.('abort', cancel)
      active.worker.onmessage = active.worker.onerror = active.worker.onmessageerror = null
      active.busy = false; active.cancel = undefined
      if (error) { release(active); reject(error) }
      else { active.idle = setTimeout(() => release(active), 5000); resolve(image!) }
    }
    const cancel = () => { try { checkCancelled(cancellation) } catch (error) { finish(error) } }
    // Flag-only cancellation is used by the resource queue. It must terminate
    // an admitted worker as well as remove its abort listener on all paths.
    const poll = setInterval(cancel, 50), timeout = setTimeout(() => finish(new Error('固定SVG后台栅格化超时。')), 120_000)
    active.cancel = () => finish(new CancelledOperationError())
    signal?.addEventListener?.('abort', cancel, { once: true })
    active.worker.onerror = event => { event.preventDefault(); finish(new Error('固定SVG后台栅格器执行失败。')) }
    active.worker.onmessageerror = () => finish(new Error('固定SVG后台像素无法读取。'))
    active.worker.onmessage = event => {
      try {
        checkCancelled(cancellation)
        const result = event.data
        if (!result?.ok) throw new Error(typeof result?.message === 'string' ? result.message : '固定SVG后台栅格化失败。')
        if (result.width !== width || result.height !== height || !(result.rgba instanceof Uint8ClampedArray)
          || result.rgba.length !== width * height * 4) throw new Error('固定SVG后台实际像素与尺寸不符。')
        finish(undefined, { width, height, rgba: result.rgba })
      } catch (error) { finish(error) }
    }
    try { active.worker.postMessage({ source, dimensions: { width, height } }); cancel() } catch (error) { finish(error) }
  }))
}
