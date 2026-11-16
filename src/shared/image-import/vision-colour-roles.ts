import { z } from 'zod'
import { captureJson } from '../validation/json.js'
import { imagePointSchema, type ImagePoint } from './calibration.js'
import type { GuidedSelectionInput } from './guided-selection.js'
import type { ImagePixels, PixelBounds } from './pixels.js'

type Rgb = [number, number, number]
type Pair = [number, number]
interface HistogramBin { key: number; sum: Rgb; count: number; inside: number; outside: number }
interface ColourCluster extends HistogramBin {
  rgb: Rgb
  insideCenter: Pair
  outsideCenter: Pair
  enrichment: number
  excess: number
}
export interface VisionColourRepresentative {
  point: ImagePoint
  rgb: Rgb
  paletteIndex: number
  enrichment: number
}
export interface VisionColourRoleProposal {
  algorithmId: 'polygon-rgb-roles'
  algorithmVersion: 1
  foreground: VisionColourRepresentative[]
  background: VisionColourRepresentative[]
  guide: GuidedSelectionInput
  diagnostics: {
    insidePixels: number
    outsidePixels: number
    palette: Omit<ColourCluster, 'sum' | 'insideCenter' | 'outsideCenter'>[]
    manualGuidanceUsed: false
    groundTruthRead: false
    adopted: false
    visualQualityPassed: false
  }
}

const inputSchema = z.strictObject({
  bounds: z.strictObject({ x: z.number().int().nonnegative(), y: z.number().int().nonnegative(),
    width: z.number().int().positive().max(8192), height: z.number().int().positive().max(8192) }),
  boundaryPx: z.array(imagePointSchema).min(3).max(256),
})
const dimensionsSchema = z.strictObject({ width: z.number().int().positive().max(8192), height: z.number().int().positive().max(8192) })
const typedArrayPrototype = Object.getPrototypeOf(Uint8ClampedArray.prototype)
const nativeLength = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'length')!.get!
const nativeBuffer = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'buffer')!.get!
const nativeByteOffset = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'byteOffset')!.get!
const nativeBufferLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!

/** Capture the explicit native byte handle without reading caller getters or
 * methods. Only the bounded context is copied; no whole-image duplicate is kept. */
function captureContext(rawImage: ImagePixels, rawBounds: PixelBounds, rawBoundary: readonly ImagePoint[]) {
  if (!rawImage || typeof rawImage !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(rawImage))) throw new Error('颜色角色需要普通RGBA图片对象。')
  const descriptors = Object.getOwnPropertyDescriptors(rawImage)
  const keys = Reflect.ownKeys(rawImage)
  if (keys.length !== 3 || keys.some(key => typeof key !== 'string' || !['width', 'height', 'data'].includes(key))
    || ['width', 'height', 'data'].some(key => !descriptors[key] || !('value' in descriptors[key]) || !descriptors[key].enumerable)) {
    throw new Error('RGBA图片只能包含width、height和data，不接受访问器、隐藏或额外字段。')
  }
  const dimensions = dimensionsSchema.parse(captureJson({ width: descriptors.width.value, height: descriptors.height.value }))
  const { bounds, boundaryPx } = inputSchema.parse(captureJson({ bounds: rawBounds, boundaryPx: rawBoundary }))
  if (dimensions.width * dimensions.height > 32_000_000) throw new Error('颜色角色原图最多3200万像素。')
  if (bounds.width * bounds.height > 250_000) throw new Error('颜色角色上下文最多25万像素。')
  if (bounds.x + bounds.width > dimensions.width || bounds.y + bounds.height > dimensions.height) throw new Error('颜色角色上下文必须留在原图内。')
  for (const p of boundaryPx) if (p.x < bounds.x || p.y < bounds.y || p.x > bounds.x + bounds.width || p.y > bounds.y + bounds.height) throw new Error('颜色角色粗范围顶点超出上下文。')
  checkPolygon(boundaryPx)
  const bytes: unknown = descriptors.data.value
  if (!bytes || !ArrayBuffer.isView(bytes) || Object.getPrototypeOf(bytes) !== Uint8ClampedArray.prototype) throw new Error('颜色角色需要原生Uint8ClampedArray RGBA字节。')
  let buffer: ArrayBuffer, byteOffset: number
  try {
    if (nativeLength.call(bytes) !== dimensions.width * dimensions.height * 4) throw new Error('length')
    buffer = nativeBuffer.call(bytes) as ArrayBuffer
    byteOffset = nativeByteOffset.call(bytes) as number
    // Reject SharedArrayBuffer: another agent must not race the context capture.
    nativeBufferLength.call(buffer)
  } catch { throw new Error('颜色角色RGBA字节长度、原生容器或独立缓冲无效。') }
  const data = new Uint8ClampedArray(bounds.width * bounds.height * 4)
  for (let row = 0; row < bounds.height; row++) {
    const offset = byteOffset + ((bounds.y + row) * dimensions.width + bounds.x) * 4
    data.set(new Uint8ClampedArray(buffer, offset, bounds.width * 4), row * bounds.width * 4)
  }
  return { data, bounds, boundaryPx }
}

const cross = (a: ImagePoint, b: ImagePoint, c: ImagePoint) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
function checkPolygon(points: readonly ImagePoint[]): void {
  const area = points.reduce((sum, p, i) => sum + p.x * points[(i + 1) % points.length].y - points[(i + 1) % points.length].x * p.y, 0)
  if (area === 0) throw new Error('颜色角色粗范围需要非退化简单多边形。')
  const onSegment = (p: ImagePoint, a: ImagePoint, b: ImagePoint) => cross(a, b, p) === 0
    && p.x >= Math.min(a.x, b.x) && p.x <= Math.max(a.x, b.x) && p.y >= Math.min(a.y, b.y) && p.y <= Math.max(a.y, b.y)
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length]
    if (a.x === b.x && a.y === b.y) throw new Error('颜色角色粗范围不能包含零长边。')
    for (let j = i + 1; j < points.length; j++) {
      if (j === i + 1 || i === 0 && j === points.length - 1) continue
      const c = points[j], d = points[(j + 1) % points.length]
      if (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0
        || onSegment(c, a, b) || onSegment(d, a, b) || onSegment(a, c, d) || onSegment(b, c, d)) throw new Error('颜色角色粗范围不能自交或重叠。')
    }
  }
}

const distanceSquared = (a: Rgb, b: Rgb) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2
function contains(polygon: readonly ImagePoint[], x: number, y: number): boolean {
  let yes = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j]
    if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) yes = !yes
  }
  return yes
}

/** Explicit v1 proposal, never a final silhouette or semantic certificate.
 * The actual guide is replayed by existing graph-cut2; its pixels are unchanged. */
export function proposeVisionColourRoles(image: ImagePixels, rawBounds: PixelBounds, rawBoundary: readonly ImagePoint[]): VisionColourRoleProposal {
  const { data, bounds, boundaryPx } = captureContext(image, rawBounds, rawBoundary)
  const size = bounds.width * bounds.height, inside = new Uint8Array(size), histogram = new Map<number, HistogramBin>()
  let insidePixels = 0, outsidePixels = 0
  for (let y = 0; y < bounds.height; y++) for (let x = 0; x < bounds.width; x++) {
    const p = y * bounds.width + x, offset = p * 4
    if (data[offset + 3] < 128) continue
    const isInside = contains(boundaryPx, bounds.x + x + .5, bounds.y + y + .5)
    inside[p] = isInside ? 1 : 2
    if (isInside) insidePixels++; else outsidePixels++
    const rgb: Rgb = [data[offset], data[offset + 1], data[offset + 2]]
    const key = (rgb[0] >> 4) * 256 + (rgb[1] >> 4) * 16 + (rgb[2] >> 4)
    let bin = histogram.get(key)
    if (!bin) { bin = { key, sum: [0, 0, 0], count: 0, inside: 0, outside: 0 }; histogram.set(key, bin) }
    bin.count++; bin[isInside ? 'inside' : 'outside']++
    for (let k = 0; k < 3; k++) bin.sum[k] += rgb[k]
  }
  if (insidePixels < 9 || outsidePixels < 4) throw new Error('颜色角色需要至少9个内部和4个外部不透明原图像素，请调整粗范围或上下文。')
  const palette: ColourCluster[] = []
  for (const bin of [...histogram.values()].sort((a, b) => b.count - a.count || a.key - b.key)) {
    const rgb = bin.sum.map(v => v / bin.count) as Rgb
    let closest = -1, distance = Infinity
    for (let i = 0; i < palette.length; i++) {
      const d = distanceSquared(rgb, palette[i].rgb)
      if (d < distance) { distance = d; closest = i }
    }
    if (distance > 32 ** 2 && palette.length < 24) palette.push({ ...bin, sum: [...bin.sum], rgb, insideCenter: [0, 0], outsideCenter: [0, 0], enrichment: 0, excess: 0 })
    else {
      const p = palette[closest]
      p.count += bin.count; p.inside += bin.inside; p.outside += bin.outside
      for (let k = 0; k < 3; k++) p.sum[k] += bin.sum[k]
      p.rgb = p.sum.map(v => v / p.count) as Rgb
    }
  }
  const assignment = new Int16Array(size).fill(-1)
  for (let p = 0; p < size; p++) {
    if (!inside[p]) continue
    const rgb: Rgb = [data[p * 4], data[p * 4 + 1], data[p * 4 + 2]]
    let best = -1, distance = Infinity
    for (let k = 0; k < palette.length; k++) {
      const d = distanceSquared(rgb, palette[k].rgb)
      if (d < distance) { best = k; distance = d }
    }
    assignment[p] = best
  }
  // Recount actual nearest-centre membership rather than quantizer bins.
  for (const p of palette) { p.inside = 0; p.outside = 0 }
  for (let p = 0; p < size; p++) {
    if (assignment[p] < 0) continue
    const cluster = palette[assignment[p]], role = inside[p] === 1 ? 'inside' : 'outside', center = role === 'inside' ? cluster.insideCenter : cluster.outsideCenter
    cluster[role]++; center[0] += p % bounds.width + .5; center[1] += Math.floor(p / bounds.width) + .5
  }
  for (const p of palette) {
    p.enrichment = ((p.inside + 1) / (insidePixels + 2)) / ((p.outside + 1) / (outsidePixels + 2))
    p.excess = p.inside * (1 - 1 / Math.max(1, p.enrichment))
    for (const role of ['inside', 'outside'] as const) if (p[role]) {
      const key = role === 'inside' ? 'insideCenter' : 'outsideCenter'
      p[key] = p[key].map(v => v / p[role]) as Pair
    }
  }
  const choose = (input: number[], count: number, mass: (p: ColourCluster) => number) => {
    let candidates = input
    const chosen: number[] = []
    while (chosen.length < count && candidates.length) {
      let best = -1, score = -Infinity
      for (const k of candidates) {
        const diversity = chosen.length ? Math.min(...chosen.map(j => distanceSquared(palette[k].rgb, palette[j].rgb))) : 1
        const value = Math.sqrt(mass(palette[k])) * diversity
        if (value > score) { best = k; score = value }
      }
      chosen.push(best); candidates = candidates.filter(k => k !== best)
    }
    return chosen
  }
  const positiveRoles = choose(palette.map((_, i) => i).filter(i => palette[i].inside >= 8 && palette[i].enrichment >= 1.6), 3, p => p.excess)
  const negativeRoles = choose(palette.map((_, i) => i).filter(i => palette[i].outside >= 4), 4, p => p.outside)
  if (!positiveRoles.length || !negativeRoles.length) throw new Error('颜色角色缺少可分离的内外颜色依据，请补充人工语义辅助。')
  const representative = (k: number, label: 1 | 2): VisionColourRepresentative => {
    const center = palette[k][label === 1 ? 'insideCenter' : 'outsideCenter']
    let best = -1, score = -Infinity
    for (let p = 0; p < size; p++) {
      if (inside[p] !== label || assignment[p] !== k) continue
      const x = p % bounds.width, y = Math.floor(p / bounds.width)
      let same = 0
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (x + dx >= 0 && x + dx < bounds.width && y + dy >= 0 && y + dy < bounds.height
          && assignment[(y + dy) * bounds.width + x + dx] === k && inside[(y + dy) * bounds.width + x + dx] === label) same++
      }
      const value = same * 100000 - ((x + .5 - center[0]) ** 2 + (y + .5 - center[1]) ** 2)
      if (value > score) { score = value; best = p }
    }
    if (best < 0) throw new Error('颜色角色没有可用的原图代表像素。')
    const x = best % bounds.width, y = Math.floor(best / bounds.width), offset = best * 4
    return { point: { x: bounds.x + x + .5, y: bounds.y + y + .5 }, rgb: [data[offset], data[offset + 1], data[offset + 2]], paletteIndex: k, enrichment: palette[k].enrichment }
  }
  const foreground = positiveRoles.map(k => representative(k, 1)), background = negativeRoles.map(k => representative(k, 2))
  return {
    algorithmId: 'polygon-rgb-roles', algorithmVersion: 1, foreground, background,
    guide: { bounds, boundaryPx, foreground: foreground.map(p => ({ points: [p.point], radiusPx: .5 })), background: background.map(p => ({ points: [p.point], radiusPx: .5 })), algorithmVersion: 2, edgeCoverage: 'boundary' },
    diagnostics: { insidePixels, outsidePixels, palette: palette.map(({ sum: _sum, insideCenter: _inside, outsideCenter: _outside, ...p }) => p), manualGuidanceUsed: false, groundTruthRead: false, adopted: false, visualQualityPassed: false },
  }
}
