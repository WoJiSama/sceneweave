import { checkCancelled } from '../../../shared/ports/resources.js'

const WEAK_EDGE = 2.2
const STRONG_EDGE = 5.3
const LINK_STEPS = 12
const STRIPE_ROWS = 96
const REFERENCE_LONG_EDGE = 1440
const MAX_SCALE = 4096 / REFERENCE_LONG_EDGE
const GAUSSIAN_RADII = [[1, 1], [2, 2, 3]] as const
const strokeNormals = [[1, 0], [1, 1], [0, 1], [-1, 1]] as const
const MIN_STROKE_CONTRAST = 2.5
const MIN_JOIN_CONTRAST = 1.25
const STRONG_STROKE_INK = 32
export const BITMAP_LINE_ORIGINAL_INK = 128
const pencil = Uint8Array.from({ length: 512 }, (_, i) => Math.round(127 * (1 - Math.exp(-i / 30.4))))

function bitmapLineScale(referenceLongEdge: number): number {
  return Math.min(MAX_SCALE, Math.max(1, referenceLongEdge / REFERENCE_LONG_EDGE))
}

function sampling(referenceLongEdge: number) {
  const scale = bitmapLineScale(referenceLongEdge)
  const radii = GAUSSIAN_RADII.map(pass => pass.map(radius => Math.round(radius * scale)))
  const softRadius = Math.max(1, Math.round(scale))
  const inkRadius = Math.round(4 * scale), paperStep = Math.round(2 * scale)
  const maskMargin = radii[1].reduce((sum, radius) => sum + radius, 1)
  const inkGuard = inkRadius + maskMargin
  // Account for detection on both sides of a stripe, including the guarded
  // ink neighborhood, linking and the final softening pass.
  const overlap = inkGuard + Math.max(inkRadius, paperStep) + LINK_STEPS + softRadius + 2
  return { scale, radii, softRadius, inkRadius, paperStep, maskMargin, inkGuard, overlap }
}

function contourSampling(scale: number, sourceScale: number) {
  const radius = Math.round(scale), shoulder = Math.round(scale * 3), diagonal = Math.round(scale * 2)
  const step = Math.round(sourceScale * 12), spread = Math.round(sourceScale * 4)
  const join = Math.round(sourceScale * 7)
  return { radius, shoulder, diagonal, step, spread, guard: radius + shoulder + 1, join }
}

export function bitmapLineSamplingPadding(referenceLongEdge: number, preserveContours = false, minimumStrokeScale = 1): number {
  const { overlap, scale } = sampling(referenceLongEdge)
  return preserveContours ? Math.max(overlap, contourSamplingPadding(scale, Math.max(scale, minimumStrokeScale))) : overlap
}

function contourSamplingPadding(scale: number, sourceScale: number): number {
  const { step, spread, join, radius, guard } = contourSampling(scale, sourceScale)
  return step + spread + join + Math.max(radius, Math.round(join * .32)) + guard + radius + 2
}

function blur(source: Float32Array, horizontal: Float32Array, output: Float32Array, width: number, height: number, radius: number) {
  const size = radius * 2 + 1
  for (let y = 0; y < height; y++) {
    const row = y * width
    let sum = source[row] * radius
    for (let x = 0; x <= radius; x++) sum += source[row + Math.min(x, width - 1)]
    for (let x = 0; x < width; x++) {
      horizontal[row + x] = sum / size
      sum += source[row + Math.min(width - 1, x + radius + 1)] - source[row + Math.max(0, x - radius)]
    }
  }
  for (let x = 0; x < width; x++) {
    let sum = horizontal[x] * radius
    for (let y = 0; y <= radius; y++) sum += horizontal[Math.min(y, height - 1) * width + x]
    for (let y = 0; y < height; y++) {
      output[y * width + x] = sum / size
      sum += horizontal[Math.min(height - 1, y + radius + 1) * width + x] - horizontal[Math.max(0, y - radius) * width + x]
    }
  }
}

function expandDistances(distance: Uint8Array, width: number, height: number): void {
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x
    if (x) distance[i] = Math.min(distance[i], distance[i - 1] + 1)
    if (y) distance[i] = Math.min(distance[i], distance[i - width] + 1,
      x ? distance[i - width - 1] + 1 : 255, x + 1 < width ? distance[i - width + 1] + 1 : 255)
  }
  for (let y = height - 1; y >= 0; y--) for (let x = width - 1; x >= 0; x--) {
    const i = y * width + x
    if (x + 1 < width) distance[i] = Math.min(distance[i], distance[i + 1] + 1)
    if (y + 1 < height) distance[i] = Math.min(distance[i], distance[i + width] + 1,
      x ? distance[i + width - 1] + 1 : 255, x + 1 < width ? distance[i + width + 1] + 1 : 255)
  }
}

export interface LineArtPixels {
  canvas: { width: number; height: number }
  getImageData(x: number, y: number, width: number, height: number): ImageData
}

function strokeNeighbor(x: number, y: number, distance: number, span: number, direction: number, width: number, rows: number,
  strengths: Float32Array, directions: Int8Array, support?: Int8Array, ink?: Float32Array): boolean {
  const [nx, ny] = strokeNormals[direction]
  for (let cross = -span; cross <= span; cross++) {
    const px = x - ny * distance + nx * cross, py = y + nx * distance + ny * cross
    if (px <= 0 || py <= 0 || px >= width - 1 || py >= rows - 1) continue
    const other = py * width + px
    const angle = Math.abs(direction - directions[other])
    if (angle === 2) continue
    if (support && ink) {
      if (strengths[other] && (support[other] || ink[other] >= STRONG_STROKE_INK)) return true
    } else if (strengths[other] >= MIN_STROKE_CONTRAST * (angle === 0 ? 1 : 1.2)) return true
  }
  return false
}

/** Keep weak existing strokes that continue along a narrow corridor of nearby pixels. */
function preserveWeakStrokes(light: Float32Array, horizontal: Float32Array, softened: Float32Array, ink: Float32Array, restored: Float32Array,
  strengths: Float32Array, directions: Int8Array, support: Int8Array, width: number, rows: number, scale: number, strokeScale: number,
  inkDistance: Uint8Array, maskedDistance: Uint8Array | undefined, signal?: AbortSignal) {
  const { radius, shoulder, diagonal, step, spread, guard, join } = contourSampling(scale, strokeScale)
  blur(light, horizontal, softened, width, rows, radius)
  const rise = (i: number, offset: number) => Math.min(softened[i - offset], softened[i + offset]) - softened[i]
  strengths.fill(0)
  const reach = shoulder + 1
  for (let y = reach; y < rows - reach; y++) {
    if (y % 32 === 0) checkCancelled(signal)
    for (let x = reach, i = y * width + x; x < width - reach; x++, i++) {
      if (inkDistance[i] <= guard || (maskedDistance?.[i] ?? 255) <= guard) continue
      for (let direction = 0; direction < strokeNormals.length; direction++) {
        const [nx, ny] = strokeNormals[direction]
        const normal = nx + ny * width
        const offset = normal * (nx && ny ? diagonal : shoulder)
        const value = rise(i, offset)
        if (value < MIN_JOIN_CONTRAST || value <= strengths[i]
          || value < rise(i - normal, offset) - .65 || value < rise(i + normal, offset) - .65) continue
        strengths[i] = value
        directions[i] = direction
      }
    }
  }

  const near = Math.round(7 * scale), nearVotes = Math.ceil(8 * scale), farVotes = Math.ceil(9 * scale)
  const maxGap = Math.round(strokeScale) + 1
  for (let y = 1; y < rows - 1; y++) {
    if (y % 32 === 0) checkCancelled(signal)
    for (let x = 1, i = y * width + x; x < width - 1; x++, i++) {
      const value = strengths[i]
      if (value < MIN_STROKE_CONTRAST || ink[i] >= STRONG_STROKE_INK) continue
      const direction = directions[i]
      // Separated texture flecks don't vote through an empty stretch.
      let close = 0, longest = 0
      for (const sign of [-1, 1]) {
        let count = 0, gap = 0
        for (let distance = 1; distance <= step; distance++) {
          const span = Math.min(spread, Math.max(radius, Math.round(distance * .32)))
          if (!strokeNeighbor(x, y, sign * distance, span, direction, width, rows, strengths, directions)) {
            if (++gap > maxGap) break
            continue
          }
          gap = 0
          count++
          if (distance <= near) close++
        }
        longest = Math.max(longest, count)
        if (longest >= farVotes) break
      }
      if (close < nearVotes && longest < farVotes) continue
      restored[i] = Math.min(44, (16 + value * 2.6) * Math.min(1.22, Math.sqrt(scale)))
    }
  }

  for (let i = 0; i < width * rows; i++) support[i] = restored[i] > 0 ? 1 : 0
  // Short joins stay on a ridge still present in the source. Strong or
  // already supported marks on both sides supply the evidence to keep it.
  for (let y = 1; y < rows - 1; y++) {
    if (y % 32 === 0) checkCancelled(signal)
    for (let x = 1, i = y * width + x; x < width - 1; x++, i++) {
      if (!strengths[i] || restored[i] || ink[i] >= STRONG_STROKE_INK) continue
      const direction = directions[i]
      let sides = 0
      for (const sign of [-1, 1]) {
        let found = false
        for (let distance = 1; distance <= join && !found; distance++) {
          const span = Math.max(radius, Math.round(distance * .32))
          found = strokeNeighbor(x, y, sign * distance, span, direction, width, rows, strengths, directions, support, ink)
        }
        if (!found) break
        sides++
      }
      if (sides === 2) restored[i] = Math.min(32, 18 + strengths[i] * 3.5)
    }
  }
}

interface BitmapLineArtOptions {
  signal?: AbortSignal
  mask?: LineArtPixels
  referenceLongEdge?: number
  preserveContours?: boolean
  minimumStrokeScale?: number
}

/** High bit marks original ink. Low seven bits hold the strength of extracted contours. */
export function captureBitmapLineArt(ctx: LineArtPixels, {
  signal, mask, referenceLongEdge = Math.max(ctx.canvas.width, ctx.canvas.height), preserveContours = false, minimumStrokeScale = 1,
}: BitmapLineArtOptions = {}): Uint8Array {
  checkCancelled(signal)
  const { width, height } = ctx.canvas
  // A 4K export should not turn texture that was suppressed in the preview into new strokes.
  const { scale, radii, softRadius, inkRadius, paperStep, maskMargin, inkGuard, overlap: baseOverlap } = sampling(referenceLongEdge)
  const strokeScale = Math.max(scale, minimumStrokeScale)
  const overlap = preserveContours ? Math.max(baseOverlap, contourSamplingPadding(scale, strokeScale)) : baseOverlap
  const edges = new Uint8Array(width * height)
  const capacity = width * Math.min(height, STRIPE_ROWS + 2 * overlap)
  const planes = [new Float32Array(capacity), new Float32Array(capacity), new Float32Array(capacity)]
  const horizontal = new Float32Array(capacity), filtered = new Float32Array(capacity)
  const scores = [new Float32Array(capacity), new Float32Array(capacity)]
  const directions = [new Int8Array(capacity), new Int8Array(capacity)]
  const maskedDistance = mask && new Uint8Array(capacity)
  const neighborhood = [1, width + 1, width, width - 1]
  const paperOffsets = [-paperStep, paperStep, -paperStep * width, paperStep * width]
  const adjacent = [-width - 1, -width, -width + 1, -1, 1, width - 1, width, width + 1]
  const queue = new Int32Array(capacity)
  // The linking queue is dead before the supported-stroke pass.
  const strokeSupport = new Int8Array(queue.buffer, 0, capacity)
  const inkDistance = new Uint8Array(capacity)
  for (let from = 0; from < height; from += STRIPE_ROWS) {
    checkCancelled(signal)
    const start = Math.max(0, from - overlap), end = Math.min(height, from + STRIPE_ROWS + overlap)
    const rows = end - start, count = width * rows
    const { data } = ctx.getImageData(0, start, width, rows)
    const coverage = mask?.getImageData(0, start, width, rows).data
    const [light, blue, red] = planes
    maskedDistance?.fill(255, 0, count)
    for (let i = 0, p = 0; i < count; i++, p += 4) {
      if (coverage?.[p + 3]) {
        light[i] = 255; blue[i] = red[i] = 0
        maskedDistance![i] = 0
        continue
      }
      const alpha = data[p + 3] / 255
      const r = data[p], g = data[p + 1], b = data[p + 2]
      const y = r * .299 + g * .587 + b * .114
      light[i] = 255 - (255 - y) * alpha
      blue[i] = (b - y) * .406 * alpha
      red[i] = (r - y) * .514 * alpha
    }

    if (maskedDistance) expandDistances(maskedDistance, width, rows)

    // Keep the original ink and its antialiasing near neutral paper. The
    // surrounding band prevents tracing both sides of an existing pen stroke.
    inkDistance.fill(255, 0, count)
    blur(light, horizontal, filtered, width, rows, inkRadius)
    let hasInk = false
    for (let y = paperStep; y + paperStep < rows; y++) for (let x = paperStep, i = y * width + paperStep; x + paperStep < width; x++, i++) {
      if (light[i] > 222 || filtered[i] < 164 || filtered[i] - light[i] < 13 || (maskedDistance?.[i] ?? 255) <= inkRadius) continue
      const p = i * 4
      if (Math.max(data[p], data[p + 1], data[p + 2]) - Math.min(data[p], data[p + 1], data[p + 2]) > 18) continue
      let paper = 0
      for (const offset of paperOffsets) {
        const at = i + offset
        if (light[at] > 219 && Math.abs(red[at]) + Math.abs(blue[at]) < 8) paper++
      }
      if (paper >= 2) { inkDistance[i] = 0; hasInk = true }
    }
    if (hasInk) expandDistances(inkDistance, width, rows)

    for (let band = 0; band < radii.length; band++) {
      const magnitude = scores[band], direction = directions[band]
      magnitude.fill(0, 0, count)
      for (const plane of planes) {
        checkCancelled(signal)
        let source = plane
        for (const radius of radii[band]) {
          blur(source, horizontal, filtered, width, rows, radius)
          source = filtered
        }
        // Sobel magnitudes without square roots until the color channels are combined.
        for (let y = 1; y + 1 < rows; y++) for (let x = 1, i = y * width + 1; x + 1 < width; x++, i++) {
          if ((maskedDistance?.[i] ?? 255) <= maskMargin || inkDistance[i] <= inkGuard) continue
          const a = i - width, b = i + width
          const dx = filtered[a + 1] + 2 * filtered[i + 1] + filtered[b + 1] - filtered[a - 1] - 2 * filtered[i - 1] - filtered[b - 1]
          const dy = filtered[b - 1] + 2 * filtered[b] + filtered[b + 1] - filtered[a - 1] - 2 * filtered[a] - filtered[a + 1]
          const square = dx * dx + dy * dy
          if (square <= magnitude[i]) continue
          magnitude[i] = square
          const across = Math.abs(dx), down = Math.abs(dy)
          direction[i] = down <= across * .414 ? 0 : across <= down * .414 ? 2 : dx * dy > 0 ? 1 : 3
        }
      }
    }
    const [fine, broad] = scores
    const [direction, broadDirection] = directions
    for (let i = 0; i < count; i++) {
      const support = Math.sqrt(broad[i]) * scale / 8
      const detail = Math.sqrt(fine[i]) * scale / 8 * Math.max(0, Math.min(1, (support - .9) / 1.6))
      const outline = support * 1.55
      if (outline > detail) direction[i] = broadDirection[i]
      fine[i] = Math.max(detail, outline)
    }
    const linked = directions[1]
    linked.fill(0, 0, count)
    let last = 0
    for (let y = 1; y + 1 < rows; y++) for (let x = 1, i = y * width + 1; x + 1 < width; x++, i++) {
      const strength = fine[i], offset = neighborhood[direction[i]]
      if (strength < WEAK_EDGE || strength < fine[i - offset] || strength <= fine[i + offset]) continue
      if (strength < STRONG_EDGE) linked[i] = -1
      else { linked[i] = 1; queue[last++] = i }
    }
    for (let next = 0; next < last; next++) {
      const i = queue[next], distance = linked[i]
      if (distance > LINK_STEPS) continue
      for (const offset of adjacent) {
        const at = i + offset
        if (linked[at] !== -1) continue
        linked[at] = distance + 1
        queue[last++] = at
      }
    }
    filtered.fill(0, 0, count)
    for (let i = 0; i < count; i++) if (linked[i] > 0) {
      filtered[i] = pencil[Math.min(pencil.length - 1, Math.round(fine[i] * 4))]
    }
    if (preserveContours) {
      red.fill(0, 0, count)
      preserveWeakStrokes(light, horizontal, blue, filtered, red, broad, direction, strokeSupport, width, rows, scale, strokeScale, inkDistance, maskedDistance, signal)
      for (let i = 0; i < count; i++) filtered[i] = Math.max(filtered[i], red[i])
    }
    // A small soft shoulder keeps diagonal strokes readable when they are scaled.
    blur(filtered, horizontal, filtered, width, rows, softRadius)
    const first = from - start, after = Math.min(rows, first + STRIPE_ROWS)
    for (let y = first; y < after; y++) for (let x = 0, i = y * width, out = (start + y) * width; x < width; x++, i++, out++) {
      if ((maskedDistance?.[i] ?? 255) <= maskMargin) continue
      const core = Math.max(
        linked[i] > 0 ? pencil[Math.min(pencil.length - 1, Math.round(fine[i] * 4))] * .70 : 0,
        preserveContours ? red[i] * .88 : 0,
      )
      edges[out] = inkDistance[i] <= inkRadius ? BITMAP_LINE_ORIGINAL_INK : Math.min(127, Math.round(Math.max(core, filtered[i] * 1.25)))
    }
  }
  return edges
}
