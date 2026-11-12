import { z } from 'zod'
import { captureJson } from '../validation/json.js'
import { imagePointSchema, type ImagePoint } from './calibration.js'
import type { ImagePixelMask, ImagePixels, PixelBounds } from './pixels.js'
import { cutImageGrid } from './graph-cut.js'

export const GUIDED_SELECTION_LIMITS = Object.freeze({ pixels: 250_000, strokes: 32, pointsPerStroke: 512, paintWork: 4_000_000 })
const strokeSchema = z.strictObject({ points: z.array(imagePointSchema).min(1).max(GUIDED_SELECTION_LIMITS.pointsPerStroke),
  radiusPx: z.number().finite().min(.5).max(64) })
/** Coordinates and radii use the original pixel grid, independently of viewport zoom. */
export const guidedSelectionSchema = z.strictObject({
  bounds: z.strictObject({ x: z.number().int().nonnegative(), y: z.number().int().nonnegative(),
    width: z.number().int().positive().max(8192), height: z.number().int().positive().max(8192) }),
  foreground: z.array(strokeSchema).min(1).max(GUIDED_SELECTION_LIMITS.strokes),
  background: z.array(strokeSchema).min(1).max(GUIDED_SELECTION_LIMITS.strokes),
  edgeRadiusPx: z.number().int().min(0).max(3).optional(),
  /** Keep colour-line alpha on the actual outer edge; absence preserves saved replay. */
  edgeCoverage: z.literal('boundary').optional(),
  // Missing version deliberately replays the original algorithm. New callers
  // opt into 2 explicitly so an old saved recipe never changes its pixels.
  algorithmVersion: z.union([z.literal(1), z.literal(2)]).optional(),
  /** Coarse possibly concave upper bound, never a final object silhouette. */
  boundaryPx: z.array(imagePointSchema).min(3).max(256).optional(),
  /** Optional local ink recovery; explicit so existing saved results remain unchanged. */
  outlineRadiusPx: z.number().int().min(0).max(3).optional(),
}).superRefine((value, context) => {
  if (value.bounds.width * value.bounds.height > GUIDED_SELECTION_LIMITS.pixels) context.addIssue({ code: 'custom', message: '辅助分割范围最多25万像素，请缩小到单个物件。' })
  if (value.boundaryPx) {
    if (value.algorithmVersion !== 2) context.addIssue({ code: 'custom', message: '粗范围boundaryPx只支持显式辅助算法2；算法1与缺省版本不能使用此参数。' })
    for (const point of value.boundaryPx) if (point.x < value.bounds.x || point.y < value.bounds.y
      || point.x > value.bounds.x + value.bounds.width || point.y > value.bounds.y + value.bounds.height) {
      context.addIssue({ code: 'custom', message: '粗范围顶点超出辅助分割bounds。' }); break
    }
  }
  if (value.outlineRadiusPx && value.algorithmVersion !== 2) context.addIssue({ code: 'custom', message: '描边保留需要显式辅助算法2。' })
  if (value.edgeCoverage && value.algorithmVersion !== 2) context.addIssue({ code: 'custom', message: '外缘透明过渡需要显式辅助算法2。' })
})
export type GuidedSelectionInput = z.infer<typeof guidedSelectionSchema>
export interface GuidedSelectionDiagnostics {
  algorithmId: 'seeded-geodesic-colour' | 'seeded-graphcut-colour'
  algorithmVersion: 1 | 2
  foregroundSeedPixels: number
  backgroundSeedPixels: number
  selectedPixels: number
  uncertainPixels: number
  fractionalPixels: number
  touchesBounds: boolean
  warnings: string[]
  iterations?: number
  unseededComponentPixels?: number
  touchesCoarseBoundary?: boolean
}

function checkImage(image: ImagePixels): void {
  if (!Number.isSafeInteger(image.width) || !Number.isSafeInteger(image.height) || image.width < 1 || image.height < 1
    || image.width > 8192 || image.height > 8192 || image.width * image.height > 32_000_000
    || !(image.data instanceof Uint8ClampedArray) || image.data.length !== image.width * image.height * 4) {
    throw new Error('辅助分割需要完整RGBA原图，边长不超过8192且总量不超过3200万像素。')
  }
}

function squaredDistance(x: number, y: number, a: ImagePoint, b: ImagePoint): number {
  const dx = b.x - a.x, dy = b.y - a.y, length = dx * dx + dy * dy
  const t = length ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / length)) : 0
  return (x - a.x - dx * t) ** 2 + (y - a.y - dy * t) ** 2
}

/** Pixel-centre even-odd scan conversion supports concave coarse envelopes. */
function coarseBoundaryLabels(input: GuidedSelectionInput): Int8Array {
  const { bounds, boundaryPx } = input, labels = new Int8Array(bounds.width * bounds.height)
  if (!boundaryPx) return labels
  labels.fill(-1)
  let inside = 0
  for (let row = 0; row < bounds.height; row++) {
    const y = bounds.y + row + .5, crossings: number[] = []
    for (let index = 0; index < boundaryPx.length; index++) {
      const a = boundaryPx[index], b = boundaryPx[(index + 1) % boundaryPx.length]
      if ((a.y > y) !== (b.y > y)) crossings.push(a.x + (y - a.y) * (b.x - a.x) / (b.y - a.y))
    }
    crossings.sort((a, b) => a - b)
    for (let index = 0; index + 1 < crossings.length; index += 2) {
      const first = Math.max(0, Math.ceil(crossings[index] - bounds.x - .5))
      const last = Math.min(bounds.width, Math.ceil(crossings[index + 1] - bounds.x - .5))
      labels.fill(0, row * bounds.width + first, row * bounds.width + last)
      inside += last - first
    }
  }
  if (!inside) throw new Error('粗范围没有覆盖任何原图像素，请扩大或重新圈选。')
  return labels
}

/** Seed coverage is hard, including thin .5px strokes. Contradictory labels are refused. */
function seedLabels(input: GuidedSelectionInput): Int8Array {
  const { bounds } = input, labels = coarseBoundaryLabels(input)
  let work = 0
  for (const [strokes, label] of [[input.foreground, 1], [input.background, -1]] as const) for (const stroke of strokes) {
    for (const point of stroke.points) if (point.x < bounds.x || point.y < bounds.y || point.x > bounds.x + bounds.width || point.y > bounds.y + bounds.height) {
      throw new Error('前景或背景笔迹超出本次辅助分割范围。')
    }
    let painted = false
    const capsule = (a: ImagePoint, b: ImagePoint) => {
      const left = Math.max(bounds.x, Math.floor(Math.min(a.x, b.x) - stroke.radiusPx))
      const top = Math.max(bounds.y, Math.floor(Math.min(a.y, b.y) - stroke.radiusPx))
      const right = Math.min(bounds.x + bounds.width, Math.ceil(Math.max(a.x, b.x) + stroke.radiusPx))
      const bottom = Math.min(bounds.y + bounds.height, Math.ceil(Math.max(a.y, b.y) + stroke.radiusPx))
      work += (right - left) * (bottom - top)
      if (work > GUIDED_SELECTION_LIMITS.paintWork) throw new Error('辅助笔迹计算超过预算，请缩短笔迹或缩小画笔。')
      for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
        if (squaredDistance(x + .5, y + .5, a, b) > stroke.radiusPx ** 2) continue
        const index = (y - bounds.y) * bounds.width + x - bounds.x
        if (labels[index] && labels[index] !== label) throw new Error(input.boundaryPx && label === 1
          ? '前景笔迹与粗范围外部或背景标记冲突，请扩大粗范围或修正前景笔迹。'
          : '同一像素同时标为前景和背景，请修正冲突笔迹。')
        labels[index] = label; painted = true
      }
    }
    if (stroke.points.length === 1) capsule(stroke.points[0], stroke.points[0])
    for (let index = 1; index < stroke.points.length; index++) {
      const a = stroke.points[index - 1], b = stroke.points[index]
      const count = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / Math.max(4, stroke.radiusPx * 2)))
      for (let segment = 0; segment < count; segment++) capsule(
        { x: a.x + (b.x - a.x) * segment / count, y: a.y + (b.y - a.y) * segment / count },
        { x: a.x + (b.x - a.x) * (segment + 1) / count, y: a.y + (b.y - a.y) * (segment + 1) / count })
    }
    if (!painted) throw new Error('有辅助笔迹未覆盖任何像素，请移入范围内或稍增画笔半径。')
  }
  return labels
}

/** A bounded deterministic colour mixture retains several seed colours rather than one RGB mean. */
function colourModel(rgb: Uint8Array, labels: Int8Array, target: number): number[][] {
  let count = 0
  for (const label of labels) if (label === target) count++
  const stride = Math.max(1, Math.ceil(count / 4096)), samples: number[][] = []
  for (let index = 0, seen = 0; index < labels.length; index++) {
    if (labels[index] !== target || seen++ % stride) continue
    samples.push([rgb[index * 3], rgb[index * 3 + 1], rgb[index * 3 + 2]])
  }
  const centers = [samples[0]], distance = (a: number[], b: number[]) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2
  while (centers.length < 16) {
    let farthest = -1, separation = 36
    for (let index = 0; index < samples.length; index++) {
      let closest = Infinity
      for (const center of centers) closest = Math.min(closest, distance(samples[index], center))
      if (closest > separation) { separation = closest; farthest = index }
    }
    if (farthest < 0) break
    centers.push(samples[farthest])
  }
  for (let pass = 0; pass < 3; pass++) {
    const sums = centers.map(() => [0, 0, 0, 0])
    for (const sample of samples) {
      let best = 0, cost = Infinity
      for (let index = 0; index < centers.length; index++) {
        const next = distance(sample, centers[index])
        if (next < cost) { cost = next; best = index }
      }
      const sum = sums[best]; sum[0] += sample[0]; sum[1] += sample[1]; sum[2] += sample[2]; sum[3]++
    }
    for (let index = 0; index < centers.length; index++) if (sums[index][3]) centers[index] = sums[index].slice(0, 3).map(value => value / sums[index][3])
  }
  return centers
}

/** Indexed heap limits each Dijkstra pass to one queue record per local pixel. */
class PixelQueue {
  private size = 0
  private readonly heap: Int32Array
  private readonly position: Int32Array
  constructor(private readonly distance: Float64Array) {
    this.heap = new Int32Array(distance.length); this.position = new Int32Array(distance.length).fill(-1)
  }
  private less(a: number, b: number): boolean { return this.distance[a] < this.distance[b] || this.distance[a] === this.distance[b] && a < b }
  private swap(a: number, b: number): void {
    const pixel = this.heap[a]; this.heap[a] = this.heap[b]; this.heap[b] = pixel
    this.position[this.heap[a]] = a; this.position[this.heap[b]] = b
  }
  offer(pixel: number): void {
    let current = this.position[pixel]
    if (current === -2) return
    if (current < 0) { current = this.size++; this.heap[current] = pixel; this.position[pixel] = current }
    while (current > 0) {
      const parent = (current - 1) >> 1
      if (!this.less(this.heap[current], this.heap[parent])) break
      this.swap(current, parent); current = parent
    }
  }
  take(): number {
    if (!this.size) return -1
    const pixel = this.heap[0]; this.position[pixel] = -2
    if (--this.size) {
      this.heap[0] = this.heap[this.size]; this.position[this.heap[0]] = 0
      let current = 0
      for (;;) {
        const left = current * 2 + 1, right = left + 1
        if (left >= this.size) break
        const next = right < this.size && this.less(this.heap[right], this.heap[left]) ? right : left
        if (!this.less(this.heap[next], this.heap[current])) break
        this.swap(current, next); current = next
      }
    }
    return pixel
  }
}

function geodesic(rgb: Uint8Array, labels: Int8Array, width: number, height: number, target: number, colourCost: Float32Array): Float64Array {
  const distance = new Float64Array(labels.length).fill(Infinity), queue = new PixelQueue(distance)
  for (let index = 0; index < labels.length; index++) if (labels[index] === target) { distance[index] = 0; queue.offer(index) }
  for (let pixel = queue.take(); pixel >= 0; pixel = queue.take()) {
    const x = pixel % width, y = Math.floor(pixel / width), first = pixel * 3
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if ((!dx && !dy) || x + dx < 0 || x + dx >= width || y + dy < 0 || y + dy >= height) continue
      const next = pixel + dy * width + dx
      if (labels[next] === -target) continue
      const second = next * 3
      const colourEdge = ((rgb[first] - rgb[second]) ** 2 + (rgb[first + 1] - rgb[second + 1]) ** 2 + (rgb[first + 2] - rgb[second + 2]) ** 2) / 3
      // Edges cost substantially more than uniform travel, so a nearby matching-colour
      // distractor still has to cross the actual intervening background and outlines.
      const cost = distance[pixel] + (dx && dy ? Math.SQRT2 : 1) * (1 + colourCost[next]) + Math.min(160, colourEdge * .035)
      if (cost < distance[next]) { distance[next] = cost; queue.offer(next) }
    }
  }
  return distance
}

function maskResult(bounds: PixelBounds, data: Uint8Array): ImagePixelMask {
  return { width: bounds.width, height: bounds.height, boundsPx: { ...bounds }, data }
}

interface ColourGaussian { mean: number[]; variance: number[]; logScale: number }

/** Finite diagonal mixtures are refitted from the current cut, not from one seed colour. */
function fitColourMixture(rgb: Uint8Array, assigned: Int8Array, target: number, hardSeeds: Int8Array): ColourGaussian[] {
  const centres = colourModel(rgb, assigned, target), buckets = centres.map(() => [0, 0, 0, 0, 0, 0, 0])
  let count = 0
  for (const label of assigned) if (label === target) count++
  const stride = Math.max(1, Math.ceil(count / 4096))
  let seen = 0, total = 0
  for (let pixel = 0; pixel < assigned.length; pixel++) {
    if (assigned[pixel] !== target) continue
    const seed = hardSeeds[pixel] === target
    if (seen++ % stride && !seed) continue
    let chosen = 0, closest = Infinity
    for (let component = 0; component < centres.length; component++) {
      const centre = centres[component]
      const squared = (rgb[pixel * 3] - centre[0]) ** 2 + (rgb[pixel * 3 + 1] - centre[1]) ** 2 + (rgb[pixel * 3 + 2] - centre[2]) ** 2
      if (squared < closest) { closest = squared; chosen = component }
    }
    const sum = buckets[chosen], weight = seed ? 4 : 1
    for (let channel = 0; channel < 3; channel++) {
      const value = rgb[pixel * 3 + channel]
      sum[channel] += value * weight; sum[channel + 3] += value * value * weight
    }
    sum[6] += weight; total += weight
  }
  return buckets.flatMap(sum => {
    if (!sum[6]) return []
    const mean = sum.slice(0, 3).map(value => value / sum[6])
    // A variance floor prevents a one-pixel seed or perfectly flat patch from
    // claiming infinite evidence against all unseen texture/shading colours.
    const variance = sum.slice(3, 6).map((value, channel) => Math.max(144, value / sum[6] - mean[channel] ** 2))
    return [{ mean, variance, logScale: .5 * Math.log(variance[0] * variance[1] * variance[2]) - Math.log(sum[6] / total) }]
  })
}

function colourLikelihood(rgb: Uint8Array, pixel: number, components: ColourGaussian[]): number {
  let best = Infinity
  for (const component of components) {
    let cost = component.logScale
    for (let channel = 0; channel < 3; channel++) cost += .5 * (rgb[pixel * 3 + channel] - component.mean[channel]) ** 2 / component.variance[channel]
    best = Math.min(best, cost)
  }
  return best
}

function graphCutSelection(rgb: Uint8Array, seeds: Int8Array, width: number, height: number,
  initial: Uint8Array, fDistance: Float64Array, bDistance: Float64Array) {
  const size = seeds.length, horizontal = new Float64Array(size), vertical = new Float64Array(size)
  const squaredDifference = (first: number, second: number) => {
    let squared = 0
    for (let channel = 0; channel < 3; channel++) squared += (rgb[first * 3 + channel] - rgb[second * 3 + channel]) ** 2
    return squared
  }
  let squaredSum = 0, edges = 0
  for (let pixel = 0; pixel < size; pixel++) {
    if (pixel % width + 1 < width) { squaredSum += squaredDifference(pixel, pixel + 1); edges++ }
    if (pixel + width < size) { squaredSum += squaredDifference(pixel, pixel + width); edges++ }
  }
  const beta = squaredSum > 0 ? edges / (2 * squaredSum) : 0
  for (let pixel = 0; pixel < size; pixel++) {
    if (pixel % width + 1 < width) horizontal[pixel] = .08 + 16 * Math.exp(-beta * squaredDifference(pixel, pixel + 1))
    if (pixel + width < size) vertical[pixel] = .08 + 16 * Math.exp(-beta * squaredDifference(pixel, pixel + width))
  }
  let binary: Uint8Array = initial.slice(), iterations = 0
  const foregroundCost = new Float64Array(size), backgroundCost = new Float64Array(size), modelUncertainty = new Uint8Array(size)
  for (; iterations < 4; iterations++) {
    const assigned = Int8Array.from(binary, value => value ? 1 : -1)
    const foreground = fitColourMixture(rgb, assigned, 1, seeds), background = fitColourMixture(rgb, assigned, -1, seeds)
    for (let pixel = 0; pixel < size; pixel++) {
      const f = colourLikelihood(rgb, pixel, foreground), b = colourLikelihood(rgb, pixel, background)
      // Saturated data terms leave a real role for shared boundaries. Unseen
      // colours cannot overwhelm the whole graph through an unbounded Gaussian.
      let difference = Math.max(-6, Math.min(6, f - b)) * .5
      const sum = fDistance[pixel] + bDistance[pixel]
      const prior = Number.isFinite(sum) && sum > 0 ? (fDistance[pixel] - bDistance[pixel]) / sum : binary[pixel] ? -1 : 1
      difference += .7 * prior
      const x = pixel % width, y = Math.floor(pixel / width)
      if (x < 2 || y < 2 || x + 2 >= width || y + 2 >= height) difference += .35
      foregroundCost[pixel] = .01 + Math.max(0, difference)
      backgroundCost[pixel] = .01 + Math.max(0, -difference)
      modelUncertainty[pixel] = !seeds[pixel] && Math.abs(f - b) < .8 ? 255 : 0
    }
    const next = cutImageGrid(width, height, foregroundCost, backgroundCost, horizontal, vertical, seeds)
    let changed = 0
    for (let pixel = 0; pixel < size; pixel++) if (next[pixel] !== binary[pixel]) changed++
    binary = next
    if (!changed) { iterations++; break }
  }
  // A matching-colour wall or neighbour can be a separate minimum-cut island.
  // Only components anchored by an explicit foreground hint are adopted. Other
  // islands are retained in uncertainty, so disconnected real details can be
  // recovered with one foreground mark rather than silently declared background.
  const reached = new Uint8Array(size), queue = new Int32Array(size)
  let first = 0, last = 0
  for (let pixel = 0; pixel < size; pixel++) if (seeds[pixel] === 1) { reached[pixel] = 1; queue[last++] = pixel }
  while (first < last) {
    const pixel = queue[first++], x = pixel % width, y = Math.floor(pixel / width)
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if ((!dx && !dy) || x + dx < 0 || x + dx >= width || y + dy < 0 || y + dy >= height) continue
      const next = pixel + dy * width + dx
      if (binary[next] && !reached[next]) { reached[next] = 1; queue[last++] = next }
    }
  }
  let unseededComponentPixels = 0
  for (let pixel = 0; pixel < size; pixel++) if (binary[pixel] && !reached[pixel]) {
    binary[pixel] = 0; modelUncertainty[pixel] = 255; unseededComponentPixels++
  }
  return { binary, modelUncertainty, iterations, unseededComponentPixels }
}

/**
 * Local seeded colour/geodesic selection. It estimates a candidate mask, never replaces
 * source RGB and never certifies an object's semantic boundary or hidden appearance.
 * Narrow-band alpha uses local colour-line evidence; it does not globally blur or erode.
 */
export function guidedImageSelection(image: ImagePixels, rawInput: GuidedSelectionInput) {
  checkImage(image)
  const input = guidedSelectionSchema.parse(captureJson(rawInput)), { bounds } = input
  if (bounds.x + bounds.width > image.width || bounds.y + bounds.height > image.height) throw new Error('辅助分割范围超出原图。')
  const labels = seedLabels(input), size = labels.length, rgb = new Uint8Array(size * 3)
  let foregroundSeedPixels = 0, backgroundSeedPixels = 0
  for (let y = 0; y < bounds.height; y++) for (let x = 0; x < bounds.width; x++) {
    const local = y * bounds.width + x, source = ((bounds.y + y) * image.width + bounds.x + x) * 4
    rgb.set(image.data.subarray(source, source + 3), local * 3)
    if (!image.data[source + 3]) {
      if (labels[local] === 1) throw new Error('前景笔迹覆盖完全透明的原图像素，请修正笔迹。')
      labels[local] = -1
    }
    if (labels[local] === 1) foregroundSeedPixels++
    if (labels[local] === -1) backgroundSeedPixels++
  }
  const foreground = colourModel(rgb, labels, 1), background = colourModel(rgb, labels, -1)
  const colourDistance = (pixel: number, model: number[][]) => {
    let minimum = Infinity
    for (const colour of model) minimum = Math.min(minimum, (rgb[pixel * 3] - colour[0]) ** 2 + (rgb[pixel * 3 + 1] - colour[1]) ** 2 + (rgb[pixel * 3 + 2] - colour[2]) ** 2)
    return Math.sqrt(minimum / 3)
  }
  const foregroundCost = new Float32Array(size), backgroundCost = new Float32Array(size), colourMargin = new Float32Array(size)
  for (let index = 0; index < size; index++) {
    const f = colourDistance(index, foreground), b = colourDistance(index, background)
    foregroundCost[index] = Math.min(2.4, f / 40); backgroundCost[index] = Math.min(2.4, b / 40)
    colourMargin[index] = Math.abs(f - b)
  }
  const fDistance = geodesic(rgb, labels, bounds.width, bounds.height, 1, foregroundCost)
  const bDistance = geodesic(rgb, labels, bounds.width, bounds.height, -1, backgroundCost)
  const binary = new Uint8Array(size), uncertain = new Uint8Array(size), margin = new Float32Array(size)
  for (let index = 0; index < size; index++) {
    binary[index] = labels[index] === 1 || !labels[index] && fDistance[index] < bDistance[index] ? 255 : 0
    margin[index] = Math.abs(fDistance[index] - bDistance[index]) / Math.max(1, fDistance[index] + bDistance[index])
    if (!labels[index] && (margin[index] < .18 || colourMargin[index] < 6)) uncertain[index] = 255
  }
  const graphCut = input.algorithmVersion === 2 ? graphCutSelection(rgb, labels, bounds.width, bounds.height, binary, fDistance, bDistance) : undefined
  if (graphCut) {
    binary.set(graphCut.binary)
    for (let index = 0; index < size; index++) if (graphCut.modelUncertainty[index]) uncertain[index] = 255
  }
  if (input.outlineRadiusPx) {
    // Dark ink can share the background model when the room also has black
    // walls. Recover only a narrow band next to an already selected lighter
    // core; never follow an attached line beyond that band or override a seed.
    const radius = input.outlineRadiusPx, core = binary.slice()
    for (let pixel = 0; pixel < size; pixel++) {
      if (core[pixel] || labels[pixel]) continue
      const offset = pixel * 3, light = (rgb[offset] + rgb[offset + 1] + rgb[offset + 2]) / 3
      if (light > 96 || Math.max(rgb[offset], rgb[offset + 1], rgb[offset + 2]) - Math.min(rgb[offset], rgb[offset + 1], rgb[offset + 2]) > 60) continue
      const x = pixel % bounds.width, y = Math.floor(pixel / bounds.width)
      let near = false, lighterCore = false
      for (let dy = -radius - 1; dy <= radius + 1; dy++) for (let dx = -radius - 1; dx <= radius + 1; dx++) {
        if (x + dx < 0 || y + dy < 0 || x + dx >= bounds.width || y + dy >= bounds.height) continue
        const next = pixel + dy * bounds.width + dx
        if (!core[next]) continue
        if (Math.max(Math.abs(dx), Math.abs(dy)) <= radius) near = true
        const target = next * 3
        if ((rgb[target] + rgb[target + 1] + rgb[target + 2]) / 3 > light + 12) lighterCore = true
      }
      if (near && lighterCore) { binary[pixel] = 255; uncertain[pixel] = 255 }
    }
  }
  const neighbours = (pixel: number): number[] => {
    const x = pixel % bounds.width, y = Math.floor(pixel / bounds.width), result: number[] = []
    if (x) result.push(pixel - 1)
    if (x + 1 < bounds.width) result.push(pixel + 1)
    if (y) result.push(pixel - bounds.width)
    if (y + 1 < bounds.height) result.push(pixel + bounds.width)
    return result
  }
  const stable = new Uint8Array(size)
  for (let index = 0; index < size; index++) stable[index] = neighbours(index).every(next => binary[index] === binary[next]) ? 1 : 0
  const alpha = binary.slice(), radius = input.edgeRadiusPx ?? 1
  if (radius) for (let index = 0; index < size; index++) {
    if (labels[index]) continue
    const x = index % bounds.width, y = Math.floor(index / bounds.width)
    let boundary = false
    for (let dy = -radius; dy <= radius && !boundary; dy++) for (let dx = -radius; dx <= radius; dx++) {
      if (x + dx >= 0 && x + dx < bounds.width && y + dy >= 0 && y + dy < bounds.height
        && binary[index + dy * bounds.width + dx] !== binary[index]) { boundary = true; break }
    }
    if (!boundary) continue
    uncertain[index] = 255
    let first = -1, second = -1, fCost = Infinity, bCost = Infinity
    const reach = radius + 2
    for (let dy = -reach; dy <= reach; dy++) for (let dx = -reach; dx <= reach; dx++) {
      if (x + dx < 0 || x + dx >= bounds.width || y + dy < 0 || y + dy >= bounds.height || !dx && !dy) continue
      const next = index + dy * bounds.width + dx
      if (!stable[next]) continue
      const cost = dx * dx + dy * dy
      if (binary[next] && cost < fCost) { first = next; fCost = cost }
      if (!binary[next] && cost < bCost) { second = next; bCost = cost }
    }
    // With no stable core (e.g. a one-pixel stem), retain the selected structure.
    if (first < 0 || second < 0) continue
    let numerator = 0, denominator = 0
    for (let channel = 0; channel < 3; channel++) {
      const vector = rgb[first * 3 + channel] - rgb[second * 3 + channel]
      numerator += (rgb[index * 3 + channel] - rgb[second * 3 + channel]) * vector
      denominator += vector * vector
    }
    if (denominator < 24 * 24 * 3) continue
    const fraction = Math.max(0, Math.min(1, numerator / denominator))
    let residual = 0
    for (let channel = 0; channel < 3; channel++) {
      const predicted = rgb[first * 3 + channel] * fraction + rgb[second * 3 + channel] * (1 - fraction)
      residual += (rgb[index * 3 + channel] - predicted) ** 2
    }
    // Small texture/noise variations close to a local endpoint are not evidence
    // of transparency. Keep opaque ink and empty background at those endpoints.
    if (residual <= 10 * 10 * 3 && fraction > .04 && fraction < .96) alpha[index] = Math.round(fraction * 255)
  }
  if (input.edgeCoverage === 'boundary') {
    // A colour-line fit can also explain an opaque interior shade as alpha.
    // Keep it only next to an actually empty pixel, as required by source
    // reconstruction. Test against the fixed candidate so traversal order
    // cannot grow a band, change a hole, or propagate transparency inwards.
    const candidate = alpha.slice()
    for (let index = 0; index < size; index++) {
      if (!candidate[index] || candidate[index] === 255 || labels[index]) continue
      const x = index % bounds.width, y = Math.floor(index / bounds.width)
      let outside = false
      for (let dy = -1; dy <= 1 && !outside; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy
        if (nx < 0 || ny < 0 || nx >= bounds.width || ny >= bounds.height || candidate[ny * bounds.width + nx] === 0) { outside = true; break }
      }
      if (!outside) alpha[index] = binary[index]
    }
  }
  let selectedPixels = 0, uncertainPixels = 0, fractionalPixels = 0, touchesBounds = false
  for (let index = 0; index < size; index++) {
    if (alpha[index]) {
      selectedPixels++
      const x = index % bounds.width, y = Math.floor(index / bounds.width)
      if (x === 0 || y === 0 || x === bounds.width - 1 || y === bounds.height - 1) touchesBounds = true
    }
    if (uncertain[index]) uncertainPixels++
    if (alpha[index] && alpha[index] !== 255) fractionalPixels++
  }
  const warnings = ['辅助选区仍需查看黑底、白底、棋盘背景及移开后的补底；低对比和遮挡不能由颜色路径证明。']
  let touchesCoarseBoundary = false
  if (input.boundaryPx) {
    const envelope = coarseBoundaryLabels(input)
    for (let pixel = 0; pixel < size && !touchesCoarseBoundary; pixel++) if (binary[pixel] && neighbours(pixel).some(next => envelope[next] === -1)) touchesCoarseBoundary = true
    if (touchesCoarseBoundary) warnings.push('选区触及粗轮廓上限，可能削掉描边或叶尖；请向外放宽这段粗范围后重算，不要把截断误当真实物体边缘。')
  }
  if (touchesBounds) warnings.push('选区接触计算范围边缘，请核对是否截断物件或泄漏到背景。')
  if (uncertainPixels > size * .25) warnings.push('超过四分之一的计算范围缺少确定边界证据，请在问题处补充前景或背景笔迹。')
  if (graphCut?.unseededComponentPixels) warnings.push(`${graphCut.unseededComponentPixels} 个同色独立候选像素没有前景笔迹，已列为不确定并暂不采用；真实分离细节须补前景标记。`)
  const diagnostics: GuidedSelectionDiagnostics = { algorithmId: graphCut ? 'seeded-graphcut-colour' : 'seeded-geodesic-colour', algorithmVersion: graphCut ? 2 : 1,
    foregroundSeedPixels, backgroundSeedPixels, selectedPixels, uncertainPixels, fractionalPixels, touchesBounds, warnings,
    ...(graphCut ? { iterations: graphCut.iterations, unseededComponentPixels: graphCut.unseededComponentPixels } : {}),
    ...(input.boundaryPx ? { touchesCoarseBoundary } : {}) }
  return { mask: maskResult(bounds, alpha), uncertainMask: maskResult(bounds, uncertain), diagnostics }
}
