import type { ImagePixelMask, ImagePixels, PixelBounds } from './pixels.js'
import { maskCoverage } from './repair-scope.js'

interface Stroke { centre: number; first: number; last: number; depth: number; profile: number[] }
const median = (values: number[]) => { values.sort((a, b) => a - b); return values[Math.floor(values.length / 2)] }

/** structure-surface-v1. Separate paper tone, copied fine grain and visible ink.
 * Only two-sided, nearby endpoints may bridge a hole; unilateral strokes taper.
 * This is inferred appearance, not recovery of hidden board topology.
 * Called only after extractImageLayer validates source, masks and disjoint donors.
 */
export function repairStructuredSurface(image: ImagePixels, mask: ImagePixelMask, donor: PixelBounds,
  protection?: ImagePixelMask): ImagePixels {
  if (mask.width * mask.height > 250_000) throw new Error('结构补底最多25万像素，请缩小移除范围。')
  if (donor.width * donor.height > 1_000_000) throw new Error('结构补底取样最多100万像素，请收窄干净底材。')
  const valid = (x: number, y: number) => x >= 0 && y >= 0 && x < image.width && y < image.height
    && !maskCoverage(mask, x, y) && !maskCoverage(protection, x, y) && image.data[(y * image.width + x) * 4 + 3] === 255
  const rgb = (x: number, y: number, c: number) => image.data[(y * image.width + x) * 4 + c]
  // Dominant ink orientation comes from this declared material, never hidden pixels.
  let gx = 0, gy = 0
  for (let y = donor.y + 1; y < donor.y + donor.height - 1; y++) for (let x = donor.x + 1; x < donor.x + donor.width - 1; x++) {
    if (!valid(x - 1, y) || !valid(x + 1, y) || !valid(x, y - 1) || !valid(x, y + 1)) continue
    gx += Math.abs(rgb(x + 1, y, 0) - rgb(x - 1, y, 0)); gy += Math.abs(rgb(x, y + 1, 0) - rgb(x, y - 1, 0))
  }
  const vertical = gx > gy * 1.25
  const left = vertical ? mask.boundsPx.y : mask.boundsPx.x, top = vertical ? mask.boundsPx.x : mask.boundsPx.y
  const width = vertical ? mask.height : mask.width, height = vertical ? mask.width : mask.height
  const point = (u: number, v: number) => vertical ? { x: v, y: u } : { x: u, y: v }
  const sample = (u: number, v: number, c: number) => { const p = point(u, v); return rgb(p.x, p.y, c) }
  const trusted = (u: number, v: number) => { const p = point(u, v); return valid(p.x, p.y) }
  const missing = (u: number, v: number) => { const p = point(u, v); return maskCoverage(mask, p.x, p.y) > 0 }
  const channels: number[][] = [[], [], []]
  for (let y = donor.y; y < donor.y + donor.height; y++) for (let x = donor.x; x < donor.x + donor.width; x++) {
    if (!valid(x, y)) throw new Error('结构补底取样须为未保护、不透明的干净底材。')
    for (let c = 0; c < 3; c++) channels[c].push(rgb(x, y, c))
  }
  const base = channels.map(median), paperCache = new Map<number, number[]>()
  const paper = (u: number, v: number): number[] => {
    const key = v * (image.width + image.height) + u, cached = paperCache.get(key)
    if (cached) return cached
    const values: Array<{ value: number; rgb: number[] }> = []
    for (let dv = -5; dv <= 5; dv++) for (let du = -3; du <= 3; du++) {
      if (!trusted(u + du, v + dv)) continue
      const color = [0, 1, 2].map(c => sample(u + du, v + dv, c))
      values.push({ value: color.reduce((a, b) => a + b, 0), rgb: color })
    }
    values.sort((a, b) => a.value - b.value)
    const result = values.length >= 4 ? values[Math.floor(values.length * .7)].rgb : base
    paperCache.set(key, result); return result
  }
  const margin = 2, stride = width + margin * 2, rows = height + margin * 2
  const tones = new Float32Array(stride * rows * 3), active = new Uint8Array(stride * rows)
  let evidence = 0
  for (let row = 0; row < rows; row++) for (let col = 0; col < stride; col++) {
    const u = left + col - margin, v = top + row - margin, index = row * stride + col
    active[index] = missing(u, v) ? 1 : 0
    const color = trusted(u, v) ? paper(u, v) : base
    if (!active[index] && trusted(u, v)) evidence++
    tones.set(color, index * 3)
  }
  if (evidence < 12) throw new Error('结构补底缺少可信可见边界。')
  // Harmonic low-frequency colour; finite fixed work, with no target from the hole.
  const iterations = Math.min(400, 40 + Math.max(width, height) * 4)
  if (stride * rows * iterations > 100_000_000) throw new Error('结构补底超过计算预算，请缩小范围。')
  for (let iteration = 0; iteration < iterations; iteration++) for (let parity = 0; parity < 2; parity++) {
    for (let row = 1; row < rows - 1; row++) for (let col = 1 + (row + parity) % 2; col < stride - 1; col += 2) {
      const index = row * stride + col
      if (!active[index]) continue
      for (let c = 0; c < 3; c++) {
        const at = index * 3 + c, average = (tones[at - 3] + tones[at + 3] + tones[at - stride * 3] + tones[at + stride * 3]) / 4
        tones[at] += 1.6 * (average - tones[at])
      }
    }
  }
  // Side strips are independent trusted observations. Never skip through a protected neighbour.
  const depths: number[][] = [[], []]
  for (let row = -5; row < height + 5; row++) {
    const v = top + row
    for (const side of [0, 1]) {
      let u = side ? left + width : left - 1, found: number[] = []
      // Follow actual mask edge on rows intersecting the hole, not a stale rectangle.
      if (row >= 0 && row < height) {
        const occupied = Array.from({ length: width }, (_, col) => col).filter(col => missing(left + col, v))
        if (occupied.length) u = left + (side ? occupied.at(-1)! + 1 : occupied[0] - 1)
      }
      for (let offset = 0; offset < 3; offset++) {
        const sx = u + (side ? offset : -offset)
        if (!trusted(sx, v)) break
        found.push([0, 1, 2].reduce((sum, c) => sum + sample(sx, v, c), 0) / 3)
      }
      const tone = paper(u, v).reduce((sum, c) => sum + c, 0) / 3
      const luminance = found.length >= 2 ? found.reduce((a, b) => a + b, 0) / found.length : tone
      depths[side].push(Math.max(0, tone - luminance))
    }
  }
  const strokes = (side: number): Stroke[] => {
    const values = depths[side], result: Stroke[] = []
    for (let i = 0; i < values.length; i++) {
      if (values[i] < 8) continue
      const first = i
      while (i + 1 < values.length && values[i + 1] >= 5) i++
      const last = i, depth = Math.max(...values.slice(first, last + 1))
      if (last - first > 8) continue // Broad shadow is not a narrow board seam.
      let total = 0, position = 0
      for (let j = first; j <= last; j++) { total += values[j]; position += values[j] * j }
      result.push({ first: first - 5, last: last - 5, centre: position / total - 5, depth, profile: values })
    }
    return result
  }
  const a = strokes(0), b = strokes(1), used = new Set<number>(), lines: Array<{ a?: Stroke; b?: Stroke }> = []
  for (const stroke of a) {
    const candidates = b.map((other, index) => ({ other, index })).filter(({ other, index }) => !used.has(index)
      && Math.abs(other.centre - stroke.centre) <= 5 && Math.min(other.depth, stroke.depth) / Math.max(other.depth, stroke.depth) >= .35)
    candidates.sort((x, y) => Math.abs(x.other.centre - stroke.centre) - Math.abs(y.other.centre - stroke.centre))
    if (candidates.length) { used.add(candidates[0].index); lines.push({ a: stroke, b: candidates[0].other }) }
    else lines.push({ a: stroke })
  }
  b.forEach((stroke, index) => { if (!used.has(index)) lines.push({ b: stroke }) })
  const profileAt = (stroke: Stroke, displacement: number) => {
    const at = stroke.centre + displacement + 5, first = Math.floor(at), t = at - first
    return (stroke.profile[first] ?? 0) * (1 - t) + (stroke.profile[first + 1] ?? 0) * t
  }
  const data = image.data.slice()
  for (let row = 0; row < height; row++) for (let col = 0; col < width; col++) {
    const u = left + col, v = top + row
    if (!missing(u, v)) continue
    const t = (col + 1) / (width + 1), p = point(u, v), at = (p.y * image.width + p.x) * 4
    let ink = 0
    for (const line of lines) {
      const centre = line.a && line.b ? line.a.centre * (1 - t) + line.b.centre * t : (line.a ?? line.b)!.centre
      if (Math.abs(row - centre) > 6) continue
      const strength = line.a && line.b ? profileAt(line.a, row - centre) * (1 - t) + profileAt(line.b, row - centre) * t
        : profileAt((line.a ?? line.b)!, row - centre) * Math.max(0, 1 - (line.a ? col : width - 1 - col) / 5)
      ink = Math.max(ink, strength)
    }
    // Small source grain only: large dark donor strokes must never reappear as invented joints.
    const dx = donor.x + col % donor.width, dy = donor.y + row % donor.height
    const donorTone = [0, 1, 2].map(c => rgb(dx, dy, c)), smooth: number[] = []
    for (let c = 0; c < 3; c++) {
      const values: number[] = []
      for (let oy = -2; oy <= 2; oy++) for (let ox = -2; ox <= 2; ox++) {
        const sx = dx + ox, sy = dy + oy
        if (sx >= donor.x && sy >= donor.y && sx < donor.x + donor.width && sy < donor.y + donor.height) values.push(rgb(sx, sy, c))
      }
      smooth[c] = median(values)
      const grain = Math.max(-2, Math.min(2, donorTone[c] - smooth[c])) * .5
      data[at + c] = tones[((row + margin) * stride + col + margin) * 3 + c] - ink + grain
    }
    data[at + 3] = 255
  }
  return { width: image.width, height: image.height, data }
}
