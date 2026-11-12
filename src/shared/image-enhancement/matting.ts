import type { ImagePixelMask, ImagePixels, PixelBounds } from '../image-import/pixels.js'
import type { CancellationSignal } from '../ports/resources.js'
import type { ImageEnhancementStrength } from './schema.js'

export interface ImageMatteOptions {
  strength?: ImageEnhancementStrength
  /** An explicit background estimate on the source grid, never evidence of hidden truth. */
  background?: ImagePixels
  bandPx?: 1 | 2
}
export interface ImageMatteMetrics {
  partialEdgePixels: number
  reconstructedPixels: number
  uncertainPixels: number
  binaryBoundaryPixels: number
  rgbChangedPixels: number
  alphaChangedPixels: 0
  coreChangedPixels: 0
  outsideBandChangedPixels: 0
  backgroundEvidence: 'visible-source' | 'explicit-estimate'
  coverageIsEstimated: true
}
export interface ImageMatteResult {
  method: 'matte-edge-v1'
  pixels: ImagePixels & { boundsPx: PixelBounds }
  metrics: ImageMatteMetrics
}

const median = (values: number[]) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)]
function cancelled(signal?: CancellationSignal): void {
  if (signal?.aborted) { const error = new Error('边带候选已取消。'); error.name = 'AbortError'; throw error }
}
function validate(image: ImagePixels): void {
  if (!image || !Number.isSafeInteger(image.width) || !Number.isSafeInteger(image.height)
    || image.width < 1 || image.height < 1 || image.width > 8192 || image.height > 8192
    || image.width * image.height > 32_000_000 || !(image.data instanceof Uint8ClampedArray)
    || image.data.length !== image.width * image.height * 4) throw new Error('边带处理需要完整源RGBA，最多3200万像素。')
}

/**
 * Explicit sRGB edge-colour inference, separate from exact source extraction.
 * Only existing fractional coverage in a one/two-pixel inner band is eligible.
 * Stable, visible outside pixels estimate B in C = alpha F + (1-alpha) B.
 * Binary coverage, thin opaque details, holes, core and alpha remain unchanged.
 * An estimated alpha or background cannot establish recovered foreground truth.
 */
export function refineImageMatte(source: ImagePixels, selection: ImagePixelMask, options: ImageMatteOptions = {}, signal?: CancellationSignal): ImageMatteResult {
  cancelled(signal); validate(source)
  const b = selection?.boundsPx
  if (!selection || !b || !Number.isSafeInteger(b.x) || !Number.isSafeInteger(b.y) || b.x < 0 || b.y < 0
    || !Number.isSafeInteger(selection.width) || !Number.isSafeInteger(selection.height) || selection.width < 1 || selection.height < 1
    || selection.width !== b.width || selection.height !== b.height || selection.width * selection.height > 1_000_000
    || !(selection.data instanceof Uint8Array) || selection.data.length !== selection.width * selection.height
    || b.x + b.width > source.width || b.y + b.height > source.height) throw new Error('边带选区须在原图内且最多100万像素。')
  const strength = options.strength ?? 'balanced', band = options.bandPx ?? 1
  if (!['gentle', 'balanced', 'strong'].includes(strength) || band !== 1 && band !== 2) throw new Error('边带强度或范围无效。')
  if (options.background) {
    validate(options.background)
    if (options.background.width !== source.width || options.background.height !== source.height) throw new Error('显式背景必须与原图同坐标同尺寸。')
  }
  const metrics: ImageMatteMetrics = { partialEdgePixels: 0, reconstructedPixels: 0, uncertainPixels: 0, binaryBoundaryPixels: 0,
    rgbChangedPixels: 0, alphaChangedPixels: 0, coreChangedPixels: 0, outsideBandChangedPixels: 0,
    backgroundEvidence: options.background ? 'explicit-estimate' : 'visible-source', coverageIsEstimated: true }
  const { width, height } = selection, data = new Uint8ClampedArray(width * height * 4)
  const coverage = (x: number, y: number) => x >= b.x && y >= b.y && x < b.x + width && y < b.y + height
    ? selection.data[(y - b.y) * width + x - b.x] : 0
  const valid = (x: number, y: number) => x >= 0 && y >= 0 && x < source.width && y < source.height
  const amount = { gentle: .5, balanced: .75, strong: 1 }[strength]
  for (let y = 0; y < height; y++) {
    if (!(y % 16)) cancelled(signal)
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 4, sx = b.x + x, sy = b.y + y, from = (sy * source.width + sx) * 4, a = selection.data[y * width + x]
      if (!a) continue
      data.set(source.data.subarray(from, from + 3), at)
      data[at + 3] = Math.round(source.data[from + 3] * a / 255)
      let nearClear = false
      for (let dy = -band; dy <= band && !nearClear; dy++) for (let dx = -band; dx <= band; dx++) {
        if (Math.abs(dx) + Math.abs(dy) > band || !valid(sx + dx, sy + dy)) continue
        if (!coverage(sx + dx, sy + dy)) { nearClear = true; break }
      }
      if (!nearClear) continue
      if (a === 255) { metrics.binaryBoundaryPixels++; continue }
      metrics.partialEdgePixels++
      // Low coverage amplifies JPEG/rounding/alpha errors; translucent source is not a known composite.
      if (a < 96 || source.data[from + 3] !== 255) { metrics.uncertainPixels++; continue }
      const samples: number[][] = []
      const background = options.background
      if (background) {
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          if (!valid(sx + dx, sy + dy)) continue
          const i = ((sy + dy) * source.width + sx + dx) * 4
          if (background.data[i + 3] === 255) samples.push([...background.data.subarray(i, i + 3)])
        }
      } else {
        for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
          if (dx * dx + dy * dy > 16 || !valid(sx + dx, sy + dy) || coverage(sx + dx, sy + dy)) continue
          const i = ((sy + dy) * source.width + sx + dx) * 4
          if (source.data[i + 3] === 255) samples.push([...source.data.subarray(i, i + 3)])
        }
      }
      if (samples.length < 6) { metrics.uncertainPixels++; continue }
      const middle = [0, 1, 2].map(c => median(samples.map(v => v[c])))
      const deviation = samples.map(v => Math.max(...v.map((value, c) => Math.abs(value - middle[c])))).sort((a, b) => a - b)
      if (deviation[Math.floor(deviation.length * .75)] > 5 || deviation.at(-1)! > 14) { metrics.uncertainPixels++; continue }
      const alpha = a / 255, candidate = middle.map((value, c) => (source.data[from + c] - (1 - alpha) * value) / alpha)
      // Out-of-gamut evidence signals a wrong alpha/background, rather than licence to clip a new colour.
      if (candidate.some(value => value < -2 || value > 257)
        || Math.hypot(...candidate.map((value, c) => value - middle[c])) < 20) { metrics.uncertainPixels++; continue }
      let changed = false
      for (let c = 0; c < 3; c++) {
        data[at + c] = source.data[from + c] + (Math.max(0, Math.min(255, candidate[c])) - source.data[from + c]) * amount
        changed ||= data[at + c] !== source.data[from + c]
      }
      metrics.reconstructedPixels++
      if (changed) metrics.rgbChangedPixels++
    }
  }
  cancelled(signal)
  return { method: 'matte-edge-v1', pixels: { width, height, data, boundsPx: { ...b } }, metrics }
}
