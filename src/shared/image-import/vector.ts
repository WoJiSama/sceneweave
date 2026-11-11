import { z } from 'zod'
import { normalizeStaticSvg, STATIC_SVG_LIMITS } from '../ai/svg.js'
import { polygonBooleanWithHoles, type PolygonWithHoles } from '../geometry/polygon-boolean.js'
import { captureJson, encodeUtf8 } from '../validation/json.js'
import { cropImageRegion, type ImagePixels } from './pixels.js'
import type { ImagePoint } from './calibration.js'

export const imageVectorOptionsSchema = z.strictObject({
  kind: z.enum(['trace', 'wood', 'rug']), colors: z.number().int().min(8).max(48).default(24),
  simplifyPx: z.number().min(0).max(2).default(.35), plankWidthPx: z.number().min(2).max(512).optional(),
  smoothingRadius: z.number().int().min(0).max(2).default(0),
  longEdgePx: z.number().int().min(64).max(4096).default(2048),
  woodZones: z.array(z.strictObject({ x: z.number().int().nonnegative(), y: z.number().int().nonnegative(),
    width: z.number().int().positive(), height: z.number().int().positive(), direction: z.enum(['horizontal', 'vertical']),
    plankWidthPx: z.number().min(2).max(512).optional() })).max(8).default([]),
  direction: z.enum(['horizontal', 'vertical']).default('horizontal'), seed: z.number().int().min(0).max(4294967295).default(1),
})
export type ImageVectorOptions = z.infer<typeof imageVectorOptionsSchema>
interface Color { rgba: number[]; count: number; keys: number[] }
interface Palette { colors: Color[]; labels: Int16Array; visiblePixels: number }
interface PathPaint { fill: string; opacity: number; rings: ImagePoint[][] }
interface PaintGroup { opacity: number; paints: PathPaint[] }
export interface ImageVectorResult {
  sourceSvg: string
  stats: { kind: ImageVectorOptions['kind']; width: number; height: number; paletteColors: number;
    pathCount: number; pathCommandCount: number; sourceBytes: number; visiblePixels: number }
}
const TRACE_PIXELS = 1_000_000
const MAX_BOUNDARY_EDGES = 300_000

function checkImage(image: ImagePixels): void {
  if (![image.width, image.height].every(Number.isSafeInteger) || image.width < 1 || image.height < 1 || image.width > 8192 || image.height > 8192
    || image.width * image.height > 32_000_000 || !(image.data instanceof Uint8ClampedArray) || image.data.length !== image.width * image.height * 4) throw new Error('矢量重建需要完整RGBA，边长最多8192且总量最多3200万像素。')
}

const colorKey = (data: Uint8ClampedArray, index: number) => (data[index] >> 3) * 16384 + (data[index + 1] >> 3) * 512
  + (data[index + 2] >> 3) * 16 + Math.round(data[index + 3] / 17)
const hex = (color: number[]) => `#${color.slice(0, 3).map(value => Math.round(value).toString(16).padStart(2, '0')).join('')}`
const number = (value: number) => String(Math.round(value * 1000) / 1000)
const area = (ring: readonly ImagePoint[]) => ring.reduce((sum, point, index) => {
  const next = ring[(index + 1) % ring.length]
  return sum + point.x * next.y - next.x * point.y
}, 0) / 2

function palette(image: ImagePixels, maximum: number): Palette {
  const bins = new Map<number, { sums: number[]; count: number }>()
  let visiblePixels = 0
  for (let index = 0; index < image.data.length; index += 4) {
    if (!image.data[index + 3]) continue
    visiblePixels++
    const key = colorKey(image.data, index), bin = bins.get(key) ?? { sums: [0, 0, 0, 0], count: 0 }
    for (let channel = 0; channel < 4; channel++) bin.sums[channel] += image.data[index + channel]
    bin.count++; bins.set(key, bin)
    if (bins.size > 65536) throw new Error('源图颜色分布超过矢量计算预算，请裁切后重试。')
  }
  if (!visiblePixels) throw new Error('源图没有可见像素。')
  const colors = [...bins].sort(([a], [b]) => a - b).map(([key, bin]): Color => ({ rgba: bin.sums.map(value => value / bin.count), count: bin.count, keys: [key] }))
  const boxes = [colors]
  while (boxes.length < maximum) {
    let selected = -1, splitChannel = 0, score = -1
    for (const [index, box] of boxes.entries()) {
      if (box.length < 2) continue
      for (let channel = 0; channel < 4; channel++) {
        let low = 255, high = 0, weight = 0
        for (const color of box) { low = Math.min(low, color.rgba[channel]); high = Math.max(high, color.rgba[channel]); weight += color.count }
        const value = (high - low) * Math.sqrt(weight)
        if (value > score) { selected = index; splitChannel = channel; score = value }
      }
    }
    if (selected < 0) break
    const box = boxes[selected].slice().sort((a, b) => a.rgba[splitChannel] - b.rgba[splitChannel] || a.keys[0] - b.keys[0])
    const half = box.reduce((sum, value) => sum + value.count, 0) / 2
    let cumulative = 0, middle = 1
    for (let index = 0; index < box.length - 1; index++) { cumulative += box[index].count; middle = index + 1; if (cumulative >= half) break }
    boxes.splice(selected, 1, box.slice(0, middle), box.slice(middle))
  }
  const result = boxes.map(box => {
    const count = box.reduce((sum, color) => sum + color.count, 0)
    return { rgba: [0, 1, 2, 3].map(channel => Math.round(box.reduce((sum, color) => sum + color.rgba[channel] * color.count, 0) / count)),
      count, keys: box.flatMap(color => color.keys) }
  })
  const lookup = new Map(result.flatMap((color, index) => color.keys.map(key => [key, index] as const)))
  const labels = new Int16Array(image.width * image.height).fill(-1)
  for (let index = 0; index < labels.length; index++) if (image.data[index * 4 + 3]) labels[index] = lookup.get(colorKey(image.data, index * 4))!
  return { colors: result, labels, visiblePixels }
}

/** The explicit filter keeps transparent edges and high-contrast strokes, including narrow keys. */
function smoothImage(image: ImagePixels, radius: number): ImagePixels {
  if (!radius) return image
  const data = image.data.slice()
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
    const index = (y * image.width + x) * 4
    if (image.data[index + 3] !== 255) continue
    const channels: number[][] = [[], [], []]
    for (let ny = Math.max(0, y - radius); ny <= Math.min(image.height - 1, y + radius); ny++) {
      for (let nx = Math.max(0, x - radius); nx <= Math.min(image.width - 1, x + radius); nx++) {
        const neighbor = (ny * image.width + nx) * 4
        if (image.data[neighbor + 3] !== 255) continue
        for (let channel = 0; channel < 3; channel++) channels[channel].push(image.data[neighbor + channel])
      }
    }
    const medians = channels.map(values => { values.sort((a, b) => a - b); return values[Math.floor(values.length / 2)] })
    if (medians.some((value, channel) => Math.abs(value - image.data[index + channel]) > 18)) continue
    data.set(medians, index)
  }
  return { width: image.width, height: image.height, data }
}

function mergeSmallRegions(image: ImagePixels, sampled: Palette, radius: number): void {
  if (!radius) return
  const seen = new Uint8Array(sampled.labels.length), queue = new Uint32Array(sampled.labels.length), minimum = radius * radius * 2
  for (let start = 0; start < seen.length; start++) {
    const label = sampled.labels[start]
    if (seen[start] || label < 0) continue
    let head = 0, count = 1
    queue[0] = start; seen[start] = 1
    const adjacent = new Map<number, number>()
    while (head < count) {
      const pixel = queue[head++], x = pixel % image.width, y = Math.floor(pixel / image.width)
      for (const neighbor of [x > 0 ? pixel - 1 : -1, x + 1 < image.width ? pixel + 1 : -1,
        y > 0 ? pixel - image.width : -1, y + 1 < image.height ? pixel + image.width : -1]) {
        if (neighbor < 0 || sampled.labels[neighbor] < 0) continue
        const next = sampled.labels[neighbor]
        if (next !== label) { adjacent.set(next, (adjacent.get(next) ?? 0) + 1); continue }
        if (!seen[neighbor]) { seen[neighbor] = 1; queue[count++] = neighbor }
      }
    }
    if (count > minimum) continue
    const original = sampled.colors[label].rgba
    const replacement = [...adjacent].filter(([candidate]) => sampled.colors[candidate].rgba.every((value, channel) => Math.abs(value - original[channel]) <= (channel === 3 ? 1 : 18)))
      .sort(([a, countA], [b, countB]) => countB - countA || a - b)[0]?.[0]
    if (replacement === undefined) continue
    for (let index = 0; index < count; index++) sampled.labels[queue[index]] = replacement
  }
}

/** Directed grid edges form genuine connected outlines, including oppositely oriented holes. */
function contours(image: ImagePixels, labels: Int16Array): Map<number, ImagePoint[][]> {
  const stride = image.width + 1, sets = new Map<number, Set<number>>()
  let edgeCount = 0
  const labelAt = (x: number, y: number) => x >= 0 && y >= 0 && x < image.width && y < image.height ? labels[y * image.width + x] : -1
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
    const label = labelAt(x, y)
    if (label < 0) continue
    let edges = sets.get(label)
    if (!edges) { edges = new Set(); sets.set(label, edges) }
    if (labelAt(x, y - 1) !== label) { edges.add((y * stride + x) * 4); edgeCount++ }
    if (labelAt(x + 1, y) !== label) { edges.add((y * stride + x + 1) * 4 + 1); edgeCount++ }
    if (labelAt(x, y + 1) !== label) { edges.add(((y + 1) * stride + x + 1) * 4 + 2); edgeCount++ }
    if (labelAt(x - 1, y) !== label) { edges.add(((y + 1) * stride + x) * 4 + 3); edgeCount++ }
    if (edgeCount > MAX_BOUNDARY_EDGES) throw new Error('矢量轮廓超过计算预算，请减少分色或缩小选区。')
  }
  const result = new Map<number, ImagePoint[][]>(), steps = [1, stride, -1, -stride]
  for (const [label, edges] of sets) {
    const rings: ImagePoint[][] = []
    while (edges.size) {
      const first = edges.values().next().value!, start = Math.floor(first / 4)
      let edge = first, previousDirection = -1
      const ring: ImagePoint[] = []
      do {
        const vertex = Math.floor(edge / 4), direction = edge % 4
        if (direction !== previousDirection) ring.push({ x: vertex % stride, y: Math.floor(vertex / stride) })
        edges.delete(edge); previousDirection = direction
        const next = vertex + steps[direction]
        if (next === start) break
        const nextDirection = [(direction + 1) % 4, direction, (direction + 3) % 4, (direction + 2) % 4].find(value => edges.has(next * 4 + value))
        if (nextDirection === undefined) throw new Error('矢量轮廓无法闭合，请校正选区。')
        edge = next * 4 + nextDirection
      } while (edges.size)
      if (ring.length < 3 || !area(ring)) throw new Error('矢量轮廓包含退化区域。')
      rings.push(ring)
    }
    result.set(label, rings)
  }
  return result
}

function simplifyOpen(points: ImagePoint[], tolerance: number): ImagePoint[] {
  const keep = new Uint8Array(points.length), stack: Array<[number, number]> = [[0, points.length - 1]]
  keep[0] = keep[points.length - 1] = 1
  while (stack.length) {
    const [first, last] = stack.pop()!, start = points[first], end = points[last], dx = end.x - start.x, dy = end.y - start.y
    let furthest = -1, maximum = tolerance * tolerance
    for (let index = first + 1; index < last; index++) {
      const point = points[index], length = dx * dx + dy * dy
      const t = length ? Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / length)) : 0
      const distance = (point.x - start.x - t * dx) ** 2 + (point.y - start.y - t * dy) ** 2
      if (distance > maximum) { maximum = distance; furthest = index }
    }
    if (furthest < 0) continue
    keep[furthest] = 1; stack.push([first, furthest], [furthest, last])
  }
  return points.filter((_point, index) => keep[index])
}

function simplifyRing(ring: ImagePoint[], tolerance: number): ImagePoint[] {
  if (!tolerance || ring.length < 5) return ring
  let opposite = 1, maximum = 0
  for (let index = 1; index < ring.length; index++) {
    const distance = (ring[index].x - ring[0].x) ** 2 + (ring[index].y - ring[0].y) ** 2
    if (distance > maximum) { maximum = distance; opposite = index }
  }
  const result = [...simplifyOpen(ring.slice(0, opposite + 1), tolerance).slice(0, -1),
    ...simplifyOpen([...ring.slice(opposite), ring[0]], tolerance).slice(0, -1)]
  return result.length >= 3 && area(result) * area(ring) > 0 ? result : ring
}

function contains(ring: ImagePoint[], point: ImagePoint): boolean {
  let inside = false
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const a = ring[index], b = ring[previous]
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

function silhouette(image: ImagePixels, labels: Int16Array): PolygonWithHoles[] {
  const binary = new Int16Array(labels.length)
  for (let index = 0; index < binary.length; index++) binary[index] = labels[index] < 0 ? -1 : 0
  const rings = contours(image, binary).get(0)!, outers = rings.filter(ring => area(ring) > 0)
  return outers.map(outer => ({ outer, holes: rings.filter(ring => area(ring) < 0 && contains(outer, ring[0])) }))
}

function procedural(image: ImagePixels, sampled: Palette, options: ImageVectorOptions): PathPaint[] {
  const mask = silhouette(image, sampled.labels), dominant = [...sampled.colors].sort((a, b) => b.count - a.count)[0]
  const paints: PathPaint[] = [{ fill: hex(dominant.rgba), opacity: dominant.rgba[3] / 255, rings: mask.flatMap(polygon => [polygon.outer, ...polygon.holes]) }]
  let state = options.seed || 1
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296 }
  const clip = (ring: ImagePoint[], fill: string, opacity = 1) => {
    const result = polygonBooleanWithHoles({ operation: 'intersection', subject: mask, clip: [{ outer: ring, holes: [] }] })
    if (result.polygons.length) paints.push({ fill, opacity, rings: result.polygons.flatMap(polygon => [polygon.outer, ...polygon.holes]) })
  }
  const horizontal = options.direction === 'horizontal', across = horizontal ? image.height : image.width, along = horizontal ? image.width : image.height
  const mapped = (x: number, y: number): ImagePoint => horizontal ? { x, y } : { x: y, y: x }
  const rectangle = (x: number, y: number, width: number, height: number) => [mapped(x, y), mapped(x + width, y), mapped(x + width, y + height), mapped(x, y + height)]
  const tinted = (delta: number) => hex(dominant.rgba.map((value, index) => index < 3 ? Math.max(0, Math.min(255, value + delta)) : value))
  if (options.kind === 'wood') {
    const profile = new Float64Array(across), counts = new Uint32Array(across)
    for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
      const pixel = y * image.width + x
      if (sampled.labels[pixel] < 0) continue
      const row = horizontal ? y : x, index = pixel * 4
      profile[row] += (image.data[index] + image.data[index + 1] + image.data[index + 2]) / 3; counts[row]++
    }
    for (let row = 0; row < across; row++) profile[row] /= Math.max(1, counts[row])
    const seams: number[] = []
    for (let row = 2; row < across - 2; row++) if (profile[row] < profile[row - 2] - 3 && profile[row] <= profile[row - 1] && profile[row] < profile[row + 1]
      && (!seams.length || row - seams.at(-1)! >= 4)) seams.push(row)
    const gaps = seams.slice(1).map((value, index) => value - seams[index]).sort((a, b) => a - b)
    const plankWidth = options.plankWidthPx ?? (gaps.length ? gaps[Math.floor(gaps.length / 2)] : Math.max(8, Math.round(across / 8)))
    const rows = options.plankWidthPx || seams.length < 2 ? Array.from({ length: Math.ceil(across / plankWidth) }, (_value, index) => Math.round(index * plankWidth)) : [0, ...seams]
    const boundaries = [...rows, across]
    if (rows.length > 60) throw new Error('木板接缝超过矢量预算，请增大板宽或缩小选区。')
    for (let row = 0; row < boundaries.length - 1; row++) {
      const top = boundaries[row], bottom = boundaries[row + 1], band = bottom - top
      if (band < 1) continue
      clip(rectangle(0, top, along, band), tinted((random() - .5) * 12))
      if (top > 0) clip(rectangle(0, top, along, 1), tinted(-30), .85)
      const joint = Math.max(1, Math.min(along - 1, Math.round(along * (.2 + random() * .6))))
      clip(rectangle(joint, top, 1, band), tinted(-26), .8)
      for (let grain = 0; grain < 2; grain++) {
        const start = Math.round(along * random() * .35), y = Math.min(bottom - 1, top + Math.max(1, Math.round(band * (.25 + grain * .4))))
        clip(rectangle(start, y, Math.max(1, Math.round(along * (.3 + random() * .45))), 1), tinted(grain ? 12 : -12), .45)
      }
    }
  } else {
    const spacing = Math.max(4, Math.round(Math.min(image.width, image.height) / 10)), border = Math.max(1, Math.round(Math.min(image.width, image.height) / 35))
    for (let y = 0; y < image.height; y += spacing) clip([{ x: 0, y }, { x: image.width, y }, { x: image.width, y: Math.min(image.height, y + 1) }, { x: 0, y: Math.min(image.height, y + 1) }], tinted(-8 - random() * 12), .5)
    for (let x = 0; x < image.width; x += spacing) clip([{ x, y: 0 }, { x: Math.min(image.width, x + 1), y: 0 }, { x: Math.min(image.width, x + 1), y: image.height }, { x, y: image.height }], tinted(4 + random() * 8), .5)
    for (const ring of [rectangle(0, 0, along, border), rectangle(0, across - border, along, border), rectangle(0, 0, border, across), rectangle(along - border, 0, border, across)]) clip(ring, tinted(-24), .8)
  }
  return paints
}

function tracedGroups(image: ImagePixels, sampled: Palette, options: ImageVectorOptions): PaintGroup[] {
  const regions = contours(image, sampled.labels)
  const alphaLabels = new Int16Array(sampled.labels.length)
  for (let index = 0; index < alphaLabels.length; index++) alphaLabels[index] = sampled.labels[index] < 0 ? -1 : sampled.colors[sampled.labels[index]].rgba[3]
  const masks = contours(image, alphaLabels), groups: PaintGroup[] = []
  for (const [alpha, rings] of masks) {
    const indexes = [...regions.keys()].filter(index => sampled.colors[index].rgba[3] === alpha)
    const base = indexes.slice().sort((a, b) => sampled.colors[b].count - sampled.colors[a].count || a - b)[0]
    const paints: PathPaint[] = [{ fill: hex(sampled.colors[base].rgba), opacity: 1,
      rings: rings.map(ring => simplifyRing(ring, options.simplifyPx)) }]
    for (const index of indexes) {
      if (index === base) continue
      paints.push({ fill: hex(sampled.colors[index].rgba), opacity: 1,
        rings: regions.get(index)!.map(ring => simplifyRing(ring, options.simplifyPx)) })
    }
    groups.push({ opacity: alpha / 255, paints })
  }
  return groups
}

function proceduralGroups(image: ImagePixels, sampled: Palette, options: ImageVectorOptions): PaintGroup[] {
  const alphas = new Set<number>()
  for (let index = 3; index < image.data.length; index += 4) if (image.data[index]) alphas.add(image.data[index])
  if (alphas.size !== 1) throw new Error('程序化材质要求统一的非零透明度；混合透明度请使用原图描摹。')
  const paints = procedural(image, sampled, options)
  paints[0].opacity = 1
  let zonePixels = 0
  for (const [index, zone] of options.woodZones.entries()) {
    if (options.kind !== 'wood') throw new Error('铺板分区仅用于木板重建。')
    zonePixels += zone.width * zone.height
    if (zone.x + zone.width > image.width || zone.y + zone.height > image.height || zonePixels > TRACE_PIXELS) throw new Error('铺板分区超出原图或计算预算。')
    const cropped = cropImageRegion(image, [{ x: zone.x, y: zone.y }, { x: zone.x + zone.width, y: zone.y },
      { x: zone.x + zone.width, y: zone.y + zone.height }, { x: zone.x, y: zone.y + zone.height }])
    if (!cropped.data.some((_value, offset) => offset % 4 === 3 && cropped.data[offset] > 0)) throw new Error('铺板分区没有可见表面。')
    const local = procedural(cropped, palette(cropped, options.colors), { ...options, woodZones: [], direction: zone.direction,
      plankWidthPx: zone.plankWidthPx ?? options.plankWidthPx, seed: (options.seed + index + 1) >>> 0 })
    local[0].opacity = 1
    for (const paint of local) paints.push({ ...paint, rings: paint.rings.map(ring => ring.map(point => ({ x: point.x + zone.x, y: point.y + zone.y }))) })
  }
  return [{ opacity: [...alphas][0] / 255, paints }]
}

/** Produces source paths. SVG validation and actual rasterization retain their existing boundaries. */
export function vectorizeImageLayer(image: ImagePixels, input: ImageVectorOptions): ImageVectorResult {
  checkImage(image)
  const options = imageVectorOptionsSchema.parse(captureJson(input))
  if (image.width * image.height > TRACE_PIXELS) throw new Error('本次矢量重建最多处理100万像素，请先裁切目标区域。')
  const working = smoothImage(image, options.smoothingRadius), sampled = palette(working, options.colors)
  mergeSmallRegions(working, sampled, options.smoothingRadius)
  if (options.kind !== 'wood' && options.woodZones.length) throw new Error('铺板分区仅用于木板重建。')
  const groups = options.kind === 'trace' ? tracedGroups(image, sampled, options) : proceduralGroups(image, sampled, options)
  let commands = 0
  const pathCount = groups.reduce((sum, group) => sum + group.paints.length, 0)
  const serialize = (paint: PathPaint) => {
    const d = paint.rings.map(ring => {
      commands += ring.length + 1
      if (commands > STATIC_SVG_LIMITS.pathCommands) throw new Error('矢量路径命令超过16384，未丢弃细节；请减少分色、提高简化容差或缩小选区。')
      return ring.map((point, index) => `${index ? 'L' : 'M'}${number(point.x)} ${number(point.y)}`).join('') + 'Z'
    }).join('')
    return `<path d="${d}" fill="${paint.fill}" fill-rule="evenodd" opacity="${number(paint.opacity)}"/>`
  }
  if (pathCount > STATIC_SVG_LIMITS.paths) throw new Error('矢量路径数量超过256，请调整重建参数。')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${image.width} ${image.height}">${groups.map(group => `<g opacity="${number(group.opacity)}">${group.paints.map(serialize).join('')}</g>`).join('')}</svg>`
  const checked = normalizeStaticSvg(svg), sourceSvg = checked.normalizedSource
  return { sourceSvg, stats: { kind: options.kind, width: image.width, height: image.height, paletteColors: sampled.colors.length,
    pathCount: checked.pathCount, pathCommandCount: checked.pathCommandCount, sourceBytes: encodeUtf8(sourceSvg).length, visiblePixels: sampled.visiblePixels } }
}
