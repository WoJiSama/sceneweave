import type { ImagePixels, PixelBounds } from './pixels.js'
import type { ImageSurfaceStructureGuide } from './guided-surface-repair.js'
import type { ImageNeighborhoodSignal } from './neighborhood-evidence.js'

export interface StructureReferenceObservation {
  algorithm: 'structure-reference-observations-v1'
  /** Zero-based index of the exact persisted guide. */
  guideIndex: number
  referenceBoundsPx: PixelBounds
  axis: 'horizontal' | 'vertical'
  reason: string
  status: 'needs-review' | 'needs-judgment' | 'unavailable'
  sampledPixels: number
  metrics?: { peakDisplacementPx: number; widthRangePx: number; medianWidthPx: number; medianContrast: number }
  warnings: string[]
}

const quantile = (values: number[], fraction: number) => values.sort((a, b) => a - b)[Math.floor((values.length - 1) * fraction)]

/** Optional read-only observations, never a new repair recipe or a classifier.
 * The caller supplies the actual replay's original-evidence predicate. An
 * unavailable reference is checked in full before any of its RGB is read. */
export function inspectImageStructureReferences(image: ImagePixels, guides: readonly ImageSurfaceStructureGuide[], trusted: (x: number, y: number) => boolean, signal?: ImageNeighborhoodSignal): StructureReferenceObservation[] {
  const cancel = () => { signal?.throwIfAborted?.(); if (signal?.aborted) throw new Error('结构参考检查已取消。') }
  cancel()
  if (![image.width, image.height].every(Number.isSafeInteger) || image.width < 1 || image.height < 1 || image.width > 8192 || image.height > 8192 || image.width * image.height > 32_000_000
    || !(image.data instanceof Uint8ClampedArray) || image.data.length !== image.width * image.height * 4 || guides.length > 32) throw new Error('结构参考检查需要完整有界原图及最多32条参考。')
  return guides.map((guide, guideIndex) => {
    cancel()
    const r = guide.reference, horizontal = guide.axis === 'horizontal', length = horizontal ? r.width : r.height, across = horizontal ? r.height : r.width
    if (guide.axis !== 'horizontal' && guide.axis !== 'vertical' || ![r.x, r.y, r.width, r.height].every(Number.isSafeInteger) || r.x < 0 || r.y < 0 || length < 3 || across < 5 || r.width * r.height > 4096
      || r.x + r.width > image.width || r.y + r.height > image.height) throw new Error('结构参考检查需要原图内至少3×5、最多4096像素的参考。')
    const base = { algorithm: 'structure-reference-observations-v1' as const, guideIndex, referenceBoundsPx: { ...r }, axis: guide.axis, reason: guide.reason }
    for (let y = r.y; y < r.y + r.height; y++) {
      cancel()
      for (let x = r.x; x < r.x + r.width; x++) if (!trusted(x, y) || image.data[(y * image.width + x) * 4 + 3] !== 255) return {
        ...base, status: 'unavailable' as const, sampledPixels: 0, warnings: ['参考整块尚不属于可信原像素，本次不读取其颜色，也不判断线宽。'],
      }
    }
    const peaks: number[] = [], widths: number[] = [], contrasts: number[] = []
    let edgePeaks = 0, weakSlices = 0
    for (let u = 0; u < length; u++) {
      cancel()
      const values: number[] = []
      for (let v = 0; v < across; v++) {
        const at = ((r.y + (horizontal ? v : u)) * image.width + r.x + (horizontal ? u : v)) * 4
        values.push((image.data[at] + image.data[at + 1] + image.data[at + 2]) / 3)
      }
      const background = quantile([...values], .8), depths = values.map(value => Math.max(0, background - value))
      let peak = 0
      for (let v = 1; v < across; v++) if (depths[v] > depths[peak]) peak = v
      const contrast = depths[peak]
      contrasts.push(contrast)
      if (contrast < 5) { weakSlices++; continue }
      let first = peak, last = peak
      while (first > 0 && depths[first - 1] >= contrast * .5) first--
      while (last + 1 < across && depths[last + 1] >= contrast * .5) last++
      peaks.push(peak); widths.push(last - first + 1)
      if (first === 0 || last === across - 1) edgePeaks++
    }
    const span = (values: number[]) => values.length ? Math.max(...values) - Math.min(...values) : 0
    const metrics = { peakDisplacementPx: span(peaks), widthRangePx: span(widths), medianWidthPx: widths.length ? quantile(widths, .5) : 0,
      medianContrast: Math.round(quantile(contrasts, .5) * 10) / 10 }
    const warnings: string[] = []
    if (metrics.peakDisplacementPx >= 3) warnings.push(`参考内最暗线位置横跳${metrics.peakDisplacementPx}px，可能含曲线、斜线或相邻线；请确认是否适合沿此路径延伸。`)
    if (metrics.widthRangePx >= 3) warnings.push(`参考内半深度线宽相差${metrics.widthRangePx}px，可能含交叉线、装饰或阴影；整条复制可能形成粗带。`)
    if (metrics.medianWidthPx >= 5) warnings.push(`参考的半深度线宽中位数为${metrics.medianWidthPx}px，请与目标两侧可见窄缝对照。`)
    if (edgePeaks) warnings.push(`${edgePeaks}/${length}个截面的深色带触及参考边缘，可能没有包含完整线条和两侧底色。`)
    if (weakSlices) warnings.push(`${weakSlices}/${length}个截面明暗差不足5级，不能据此确认稳定接缝。`)
    return { ...base, status: warnings.length ? 'needs-judgment' as const : 'needs-review' as const, sampledPixels: r.width * r.height, metrics, warnings }
  })
}
