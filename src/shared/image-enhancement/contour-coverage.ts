import type { ImagePixelMask, ImagePixels, PixelBounds } from '../image-import/pixels.js'
import type { CancellationSignal } from '../ports/resources.js'

export interface ImageContourOptions {
  strength: 'gentle' | 'balanced' | 'strong'
  foregroundProtectionMask?: ImagePixelMask
  /** Blocks geometric writes and RGB extension; it is not a colour reference. */
  excludedEvidenceMask?: ImagePixelMask
}
export interface ImageContourMetrics {
  candidatePixels: number
  alphaChangedPixels: number
  rgbChangedPixels: number
  originalSelectedRgbChangedPixels: 0
  originalSupportRemovedPixels: number
  outerSupportAddedPixels: number
  outerCoverageAreaPx: number
  originalCoverageAreaPx: number
  coverageAreaPx: number
  areaDeltaPx: number
  areaPreserved: boolean
  protectedPixels: number
  uncertainPixels: number
  coreChangedPixels: 0
  holeChangedPixels: 0
  thinChangedPixels: 0
  maxVertexMovePx: number
  normalOffsetPx: number
  comparisons: number
  coverageIsEstimated: true
  foregroundIsEstimated: false
  outerPlacementIsInferred: true
  colorSpace: 'captured-srgb'
}
export type ImageContourIssueReason = 'coverage-estimate' | 'inferred-outer-coverage' | 'area-constraint'
export interface ImageContourResult {
  method: 'subject-contour-v1'
  pixels: ImagePixels & { boundsPx: PixelBounds }
  /** Identical to pixels: this method estimates geometry, without decontamination. */
  coveragePixels: ImagePixels & { boundsPx: PixelBounds }
  uncertaintyMask: ImagePixelMask
  metrics: ImageContourMetrics
  issues: Array<{ boundsPx: PixelBounds; reason: ImageContourIssueReason; message: string }>
  /** Each new outer pixel explicitly extends one captured foreground colour. */
  outerRgbSources: Array<{ x: number; y: number; sourceX: number; sourceY: number; alpha: number }>
}
type Point = [number, number]
interface Shape { original: Point[]; fitted: Point[]; normals: Point[]; movable: Uint8Array; sign: number }
const messages: Record<ImageContourIssueReason, string> = {
  'coverage-estimate': '根据原选区的局部几何估计覆盖；没有恢复描边归属或清晰度，仍需换底审核。',
  'inferred-outer-coverage': '此处是1像素内的轮廓推断，RGB延拓自相邻原前景；不是原选区或捕获真值。',
  'area-constraint': '局部保护限制了面积补偿，保留未决；面积接近也不代表每处描边正确。',
}
function signedArea(poly: Point[]): number {
  let sum = 0
  for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length]; sum += a[0] * b[1] - b[0] * a[1] }
  return sum / 2
}

/** A one-pixel geometric coverage candidate from a binary opaque cutout.
 * Local unit-cell contours are fitted, then clipped exactly to pixel squares.
 * Convex removal and inferred outer coverage balance area; RGB is never blurred.
 * This does not decide object ownership, recover detail, or decontaminate colour. */
export function refineImageContour(source: ImagePixels, selection: ImagePixelMask, options: ImageContourOptions,
  signal?: CancellationSignal): ImageContourResult {
  const cancel = () => { if (signal?.aborted) { const error = new Error('几何边缘候选已取消。'); error.name = 'AbortError'; throw error } }
  let comparisons = 0
  const spend = (n: number) => { comparisons += n; if (comparisons > 45_000_000) throw new Error('几何边缘超过4500万次计算预算，请缩小物件或简化选区。'); cancel() }
  cancel()
  if (!source || !Number.isSafeInteger(source.width) || !Number.isSafeInteger(source.height) || source.width < 1 || source.height < 1
    || source.width > 8192 || source.height > 8192 || source.width * source.height > 32_000_000
    || !(source.data instanceof Uint8ClampedArray) || source.data.length !== source.width * source.height * 4) throw new Error('几何边缘需要完整原图RGBA，最多3200万像素。')
  const checkMask = (mask: ImagePixelMask | undefined, required = false) => {
    if (!mask) { if (required) throw new Error('几何边缘缺少选区。'); return }
    const b = mask.boundsPx
    if (!b || ![b.x, b.y, b.width, b.height, mask.width, mask.height].every(Number.isSafeInteger) || b.x < 0 || b.y < 0
      || b.width < 1 || b.height < 1 || b.width !== mask.width || b.height !== mask.height || b.x + b.width > source.width || b.y + b.height > source.height
      || b.width * b.height > 1_000_000 || !(mask.data instanceof Uint8Array) || mask.data.length !== mask.width * mask.height
      || mask.data.some(a => a !== 0 && a !== 255)) throw new Error('几何边缘只接收原图内、最多100万像素的二值选区及保护范围。')
  }
  checkMask(selection, true); checkMask(options?.foregroundProtectionMask); checkMask(options?.excludedEvidenceMask)
  if (!options || !['gentle', 'balanced', 'strong'].includes(options.strength)) throw new Error('几何边缘需要明确强度。')
  const sb = selection.boundsPx
  const coverage = (mask: ImagePixelMask | undefined, x: number, y: number): number => mask && x >= mask.boundsPx.x && y >= mask.boundsPx.y
    && x < mask.boundsPx.x + mask.width && y < mask.boundsPx.y + mask.height ? mask.data[(y - mask.boundsPx.y) * mask.width + x - mask.boundsPx.x] : 0
  let left = false, right = false, top = false, bottom = false
  for (let y = 0; y < selection.height; y++) { left ||= selection.data[y * selection.width] > 0; right ||= selection.data[y * selection.width + selection.width - 1] > 0 }
  for (let x = 0; x < selection.width; x++) { top ||= selection.data[x] > 0; bottom ||= selection.data[(selection.height - 1) * selection.width + x] > 0 }
  const x0 = sb.x - (left && sb.x > 0 ? 1 : 0), y0 = sb.y - (top && sb.y > 0 ? 1 : 0)
  const x1 = sb.x + sb.width + (right && sb.x + sb.width < source.width ? 1 : 0), y1 = sb.y + sb.height + (bottom && sb.y + sb.height < source.height ? 1 : 0)
  const width = x1 - x0, height = y1 - y0, size = width * height, boundsPx = { x: x0, y: y0, width, height }
  if (size > 1_000_000) throw new Error('几何边缘外圈超过100万像素，请缩小物件。')
  spend(size * 4)
  const binary = new Uint8Array(size), explicit = new Uint8Array(size), blocked = new Uint8Array(size), original = new Uint8ClampedArray(size * 4)
  let originalArea = 0
  for (let y = 0; y < height; y++) {
    if (!(y % 16)) cancel()
    for (let x = 0; x < width; x++) {
      const i = y * width + x, sx = x + x0, sy = y + y0, from = (sy * source.width + sx) * 4
      binary[i] = coverage(selection, sx, sy) ? 1 : 0; originalArea += binary[i]
      explicit[i] = coverage(options.foregroundProtectionMask, sx, sy) ? 1 : 0
      blocked[i] = coverage(options.excludedEvidenceMask, sx, sy) ? 1 : 0
      // The cutout carries captured RGB only where the original foreground was
      // selected. Clear pixels must not serialize hidden background colours.
      if (binary[i]) original.set(source.data.subarray(from, from + 3), i * 4)
      original[i * 4 + 3] = binary[i] * 255
      if (binary[i] && source.data[from + 3] !== 255) throw new Error('几何边缘要求选中原像素不透明；半透明源须保留原版或另行处理。')
    }
  }
  const morph = (a: Uint8Array, r: number, grow: boolean): Uint8Array => {
    spend(size * (r * 2 + 1) ** 2)
    const out = new Uint8Array(size)
    for (let y = 0; y < height; y++) {
      if (!(y % 16)) cancel()
      for (let x = 0; x < width; x++) {
        let result = grow ? 0 : 1
        outer: for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
          const xx = x + dx, yy = y + dy, v = xx >= 0 && yy >= 0 && xx < width && yy < height ? a[yy * width + xx] : 0
          if (grow && v) { result = 1; break outer } else if (!grow && !v) { result = 0; break outer }
        }
        out[y * width + x] = result
      }
    }
    return out
  }
  const exterior = new Uint8Array(size), queue = new Uint32Array(size); let head = 0, tail = 0
  const enqueue = (i: number) => { if (!binary[i] && !exterior[i]) { exterior[i] = 1; queue[tail++] = i } }
  for (let y = 0; y < height; y++) { enqueue(y * width); enqueue(y * width + width - 1) }
  for (let x = 0; x < width; x++) { enqueue(x); enqueue((height - 1) * width + x) }
  while (head < tail) {
    if (!(head % 4096)) spend(4096)
    const i = queue[head++], x = i % width, y = Math.floor(i / width)
    if (x) enqueue(i - 1); if (x + 1 < width) enqueue(i + 1); if (y) enqueue(i - width); if (y + 1 < height) enqueue(i + width)
  }
  const holes = new Uint8Array(size), thin = new Uint8Array(size), locked = new Uint8Array(size)
  const thickWitness = morph(morph(binary, 2, false), 2, true)
  for (let i = 0; i < size; i++) { holes[i] = !binary[i] && !exterior[i] ? 1 : 0; thin[i] = binary[i] && !thickWitness[i] ? 1 : 0 }
  const holeBand = morph(holes, 1, true), lockedSelected = new Uint8Array(size)
  for (let i = 0; i < size; i++) { locked[i] = explicit[i] || blocked[i] || thin[i] || holeBand[i] ? 1 : 0; lockedSelected[i] = locked[i] && binary[i] ? 1 : 0 }
  const lockedOuter = morph(lockedSelected, 1, true), grown = morph(binary, 1, true), core = morph(binary, 1, false), eligible: number[] = []
  for (let i = 0; i < size; i++) if (grown[i] && !core[i] && !locked[i] && (binary[i] || !lockedOuter[i])) eligible.push(i)
  const edges: Array<[Point, Point]> = [], outgoing = new Map<number, number[]>(), vertexKey = (p: Point) => p[1] * (width + 1) + p[0]
  const add = (a: Point, b: Point) => {
    if (edges.length >= 200_000) throw new Error('几何边缘轮廓超过20万条边，请简化选区。')
    const key = vertexKey(a), list = outgoing.get(key) ?? []; list.push(edges.length); outgoing.set(key, list); edges.push([a, b])
  }
  for (let y = 0; y < height; y++) {
    cancel()
    for (let x = 0; x < width; x++) if (binary[y * width + x]) {
      if (!y || !binary[(y - 1) * width + x]) add([x, y], [x + 1, y])
      if (x + 1 === width || !binary[y * width + x + 1]) add([x + 1, y], [x + 1, y + 1])
      if (y + 1 === height || !binary[(y + 1) * width + x]) add([x + 1, y + 1], [x, y + 1])
      if (!x || !binary[y * width + x - 1]) add([x, y + 1], [x, y])
    }
  }
  // Reserve a lower bound for 19 exact clipping passes before fitting anything.
  if (eligible.length * edges.length * 19 + comparisons > 45_000_000) throw new Error('几何边缘超过4500万次计算预算，请缩小物件或简化选区。')
  const used = new Uint8Array(edges.length), shapes: Shape[] = []
  const direction = (a: Point, b: Point) => b[0] > a[0] ? 0 : b[1] > a[1] ? 1 : b[0] < a[0] ? 2 : 3
  for (let first = 0; first < edges.length; first++) {
    if (used[first]) continue
    const points: Point[] = [], start = vertexKey(edges[first][0]); let current = first
    for (;;) {
      if (!(points.length % 1024)) spend(1024)
      used[current] = 1; const [a, b] = edges[current]; points.push(a)
      if (vertexKey(b) === start) break
      const previousDirection = direction(a, b), options = (outgoing.get(vertexKey(b)) ?? []).filter(i => !used[i])
      if (!options.length) throw new Error('几何边缘轮廓无法闭合。')
      options.sort((a, z) => [1, 0, 3, 2].indexOf((direction(...edges[a]) - previousDirection + 4) % 4)
        - [1, 0, 3, 2].indexOf((direction(...edges[z]) - previousDirection + 4) % 4))
      current = options[0]
    }
    const n = points.length, sign = signedArea(points) > 0 ? 1 : -1, movable = new Uint8Array(n).fill(sign > 0 ? 1 : 0)
    const index = (i: number) => (i + n * 3) % n, dirs = points.map((p, i) => direction(p, points[index(i + 1)]))
    for (let i = 0; i < n; i++) {
      const [x, y] = points[i]
      if (dirs[index(i - 1)] !== dirs[i] && dirs[index(i - 2)] === dirs[index(i - 1)] && dirs[index(i + 1)] === dirs[i]) for (let j = -2; j <= 2; j++) movable[index(i + j)] = 0
      for (let yy = y - 1; yy <= y; yy++) for (let xx = x - 1; xx <= x; xx++) if (xx >= 0 && yy >= 0 && xx < width && yy < height && locked[yy * width + xx]) movable[i] = 0
    }
    const fitted: Point[] = points.map((p, i) => movable[i] ? [0, 1].map(c => {
      let sum = 0; for (let j = -2; j <= 2; j++) sum += points[index(i + j)][c] * [1, 4, 6, 4, 1][j + 2]; return sum / 16
    }) as Point : [...p])
    const normals: Point[] = fitted.map((p, i) => {
      const a = fitted[index(i - 1)], b = fitted[index(i + 1)], dx = b[0] - a[0], dy = b[1] - a[1], length = Math.hypot(dx, dy)
      return length ? [dy / length, -dx / length] : [0, 0]
    })
    shapes.push({ original: points, fitted, normals, movable, sign })
  }
  const clipArea = (poly: Point[], x: number, y: number): number => {
    let p = poly
    for (const [axis, bound, low] of [[0, x, 1], [0, x + 1, 0], [1, y, 1], [1, y + 1, 0]]) {
      if (!p.length) return 0
      spend(p.length)
      const out: Point[] = []; let prev = p[p.length - 1], pin = low ? prev[axis] >= bound : prev[axis] <= bound
      for (let i = 0; i < p.length; i++) {
        if (!(i % 1024)) cancel()
        const curr = p[i], cin = low ? curr[axis] >= bound : curr[axis] <= bound
        if (cin !== pin) { const t = (bound - prev[axis]) / (curr[axis] - prev[axis]); out.push([prev[0] + t * (curr[0] - prev[0]), prev[1] + t * (curr[1] - prev[1])]) }
        if (cin) out.push(curr)
        prev = curr; pin = cin
      }
      p = out
    }
    return p.length >= 3 ? Math.abs(signedArea(p)) : 0
  }
  const render = (offset: number) => {
    let maxMove = 0
    const polygons = shapes.map(shape => ({ sign: shape.sign, points: shape.fitted.map(([x, y], i): Point => {
      const [nx, ny] = shape.normals[i], [ox, oy] = shape.original[i]
      let px = shape.movable[i] ? x + offset * nx : x, py = shape.movable[i] ? y + offset * ny : y
      const move = Math.hypot(px - ox, py - oy)
      if (move > .75) { px = ox + (px - ox) * .75 / move; py = oy + (py - oy) * .75 / move }
      maxMove = Math.max(maxMove, Math.hypot(px - ox, py - oy)); return [px, py]
    }) }))
    const alpha = Float64Array.from(binary)
    for (const i of eligible) { const x = i % width, y = Math.floor(i / width); let sum = 0; for (const polygon of polygons) sum += polygon.sign * clipArea(polygon.points, x, y); alpha[i] = Math.min(1, Math.max(0, sum)) }
    let area = 0; for (const a of alpha) area += a
    return { alpha, area, maxMove }
  }
  let low = -.3, high = .3
  const lowResult = render(low), highResult = render(high), bracketed = lowResult.area <= originalArea && originalArea <= highResult.area
  let offset: number
  if (bracketed) {
    for (let step = 0; step < 15; step++) { const mid = (low + high) / 2, result = render(mid); if (result.area < originalArea) low = mid; else high = mid }
    offset = (low + high) / 2
  } else offset = Math.abs(lowResult.area - originalArea) < Math.abs(highResult.area - originalArea) ? low : high
  const fitted = render(offset), amount = { gentle: .45, balanced: .7, strong: 1 }[options.strength]
  const quantized = new Uint8Array(size), fractions: Array<{ i: number; fraction: number }> = []
  let total = 0, integerTotal = 0
  for (let i = 0; i < size; i++) {
    const value = (binary[i] + amount * (fitted.alpha[i] - binary[i])) * 255
    quantized[i] = Math.floor(value); total += value; integerTotal += quantized[i]
    if (value - quantized[i] > 0) fractions.push({ i, fraction: value - quantized[i] })
  }
  const remaining = Math.round(total) - integerTotal
  fractions.sort((a, b) => b.fraction - a.fraction || b.i - a.i)
  for (let j = 0; j < remaining; j++) quantized[fractions[j].i]++
  const data = original.slice(), uncertainty = new Uint8Array(size), issues: ImageContourResult['issues'] = [], issueKeys = new Map<string, number>()
  const outerRgbSources: ImageContourResult['outerRgbSources'] = []
  const metrics: ImageContourMetrics = { candidatePixels: eligible.length, alphaChangedPixels: 0, rgbChangedPixels: 0, originalSelectedRgbChangedPixels: 0,
    originalSupportRemovedPixels: 0, outerSupportAddedPixels: 0, outerCoverageAreaPx: 0, originalCoverageAreaPx: originalArea, coverageAreaPx: 0, areaDeltaPx: 0,
    areaPreserved: false, protectedPixels: 0, uncertainPixels: 0, coreChangedPixels: 0, holeChangedPixels: 0, thinChangedPixels: 0,
    maxVertexMovePx: fitted.maxMove, normalOffsetPx: offset, comparisons: 0, coverageIsEstimated: true, foregroundIsEstimated: false, outerPlacementIsInferred: true, colorSpace: 'captured-srgb' }
  const mark = (i: number, reason: ImageContourIssueReason) => {
    if (!uncertainty[i]) { uncertainty[i] = 255; metrics.uncertainPixels++ }
    const sx = i % width + x0, sy = Math.floor(i / width) + y0, key = `${reason}:${Math.floor(sx / 12)}:${Math.floor(sy / 12)}`, old = issueKeys.get(key)
    if (old !== undefined) { const b = issues[old].boundsPx, r = Math.max(b.x + b.width, sx + 1), bottom = Math.max(b.y + b.height, sy + 1); b.x = Math.min(b.x, sx); b.y = Math.min(b.y, sy); b.width = r - b.x; b.height = bottom - b.y }
    else if (issues.length < 32) { issueKeys.set(key, issues.length); issues.push({ boundsPx: { x: sx, y: sy, width: 1, height: 1 }, reason, message: messages[reason] }) }
  }
  let areaUnits = 0, outerUnits = 0
  for (let y = 0; y < height; y++) {
    cancel()
    for (let x = 0; x < width; x++) {
      const i = y * width + x, at = i * 4, a = quantized[i]
      data[at + 3] = a; areaUnits += a
      if (locked[i]) metrics.protectedPixels++
      if (a !== original[at + 3]) { metrics.alphaChangedPixels++; mark(i, binary[i] ? 'coverage-estimate' : 'inferred-outer-coverage') }
      if (binary[i] && !a) metrics.originalSupportRemovedPixels++
      if (!binary[i] && a) {
        let best = -1, distance = Infinity
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy, candidate = yy * width + xx, d = dx * dx + dy * dy
          if (xx >= 0 && yy >= 0 && xx < width && yy < height && binary[candidate] && !blocked[candidate] && d < distance) { best = candidate; distance = d }
        }
        if (best < 0) throw new Error('外圈推断缺少邻接的原前景颜色；保持原候选。')
        data.set(original.subarray(best * 4, best * 4 + 3), at)
        if (data[at] !== original[at] || data[at + 1] !== original[at + 1] || data[at + 2] !== original[at + 2]) metrics.rgbChangedPixels++
        metrics.outerSupportAddedPixels++; outerUnits += a
        outerRgbSources.push({ x: x + x0, y: y + y0, sourceX: best % width + x0, sourceY: Math.floor(best / width) + y0, alpha: a })
      }
    }
  }
  metrics.coverageAreaPx = areaUnits / 255; metrics.areaDeltaPx = (areaUnits - originalArea * 255) / 255
  metrics.outerCoverageAreaPx = outerUnits / 255; metrics.areaPreserved = areaUnits === originalArea * 255
  if (!metrics.areaPreserved) for (const i of eligible) mark(i, 'area-constraint')
  metrics.comparisons = comparisons; cancel()
  const pixels = { width, height, data, boundsPx }
  return { method: 'subject-contour-v1', pixels, coveragePixels: pixels, uncertaintyMask: { width, height, data: uncertainty, boundsPx }, metrics, issues, outerRgbSources }
}
