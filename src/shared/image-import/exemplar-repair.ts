import type { ImagePixelMask, ImagePixels, PixelBounds } from './pixels.js'
import { maskCoverage } from './repair-scope.js'

export interface ExemplarRepairOptions {
  surfaceMask?: ImagePixelMask
  protectionMask?: ImagePixelMask
  excludedEvidenceMask?: ImagePixelMask
}
const median = (values: number[]) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)]

/** exemplar-surface-v1: unscaled, direction-aware source patches, minimum-cut seams
 * and bounded gradient-domain colour matching, with no flat-tone substitution.
 * This infers hidden appearance. Copied ink is real donor ink, not proof of hidden topology.
 */
export function repairExemplarSurface(image: ImagePixels, mask: ImagePixelMask, donor: PixelBounds, options: ExemplarRepairOptions = {}): ImagePixels {
  if (![image.width, image.height].every(Number.isSafeInteger) || image.width < 1 || image.height < 1 || image.width > 8192 || image.height > 8192
    || image.width * image.height > 32_000_000 || !(image.data instanceof Uint8ClampedArray) || image.data.length !== image.width * image.height * 4) throw new Error('原尺寸补片需要完整有界RGBA源图。')
  const checkBounds = (b: PixelBounds) => [b.x, b.y, b.width, b.height].every(Number.isSafeInteger) && b.x >= 0 && b.y >= 0 && b.width > 0 && b.height > 0 && b.x + b.width <= image.width && b.y + b.height <= image.height
  for (const m of [mask, options.surfaceMask, options.protectionMask, options.excludedEvidenceMask]) if (m) {
    if (!checkBounds(m.boundsPx) || m.width !== m.boundsPx.width || m.height !== m.boundsPx.height || m.width * m.height > 1_000_000
      || !(m.data instanceof Uint8Array) || m.data.length !== m.width * m.height || m.data.some(v => v !== 0 && v !== 255)) throw new Error('原尺寸补片范围须为原图内的有界二值蒙版。')
  }
  if (mask.width * mask.height > 250_000 || !mask.data.some(Boolean)) throw new Error('原尺寸补片移除图框须为1至25万像素。')
  if (!checkBounds(donor) || donor.width * donor.height > 1_000_000 || donor.width < 8 || donor.height < 8) throw new Error('原尺寸补片取样须至少8×8且最多100万像素。')
  const onSurface = (x: number, y: number) => !options.surfaceMask || maskCoverage(options.surfaceMask, x, y) > 0
  const write = (x: number, y: number) => maskCoverage(mask, x, y) > 0 && onSurface(x, y) && !maskCoverage(options.protectionMask, x, y)
  const trusted = (x: number, y: number) => x >= 0 && y >= 0 && x < image.width && y < image.height && onSurface(x, y)
    && !maskCoverage(mask, x, y) && !maskCoverage(options.protectionMask, x, y) && !maskCoverage(options.excludedEvidenceMask, x, y)
    && image.data[(y * image.width + x) * 4 + 3] === 255
  for (let y = donor.y; y < donor.y + donor.height; y++) for (let x = donor.x; x < donor.x + donor.width; x++) if (!trusted(x, y)) throw new Error('原尺寸补片取样须全部为可信、未保护且不透明的同底材。')
  let gradientX = 0, gradientY = 0
  for (let y = donor.y + 1; y < donor.y + donor.height; y++) for (let x = donor.x + 1; x < donor.x + donor.width; x++) {
    const at = (y * image.width + x) * 4
    gradientX += Math.abs(image.data[at] - image.data[at - 4]); gradientY += Math.abs(image.data[at] - image.data[at - image.width * 4])
  }
  const vertical = gradientX > gradientY * 1.25
  const pw = Math.min(vertical ? 64 : 128, donor.width), ph = Math.min(vertical ? 128 : 24, donor.height)
  const overlapX = Math.max(2, Math.min(24, Math.floor(pw / 4))), overlapY = Math.max(2, Math.min(24, Math.floor(ph / 4)))
  const stepX = pw - overlapX, stepY = ph - overlapY, margin = Math.max(overlapX, overlapY)
  const bx = Math.max(0, mask.boundsPx.x - margin), by = Math.max(0, mask.boundsPx.y - margin)
  const width = Math.min(image.width, mask.boundsPx.x + mask.width + margin) - bx, height = Math.min(image.height, mask.boundsPx.y + mask.height + margin) - by
  const working = new Float32Array(width * height * 3), status = new Uint8Array(width * height), allowed = new Uint8Array(width * height)
  const sourceX = new Int16Array(width * height).fill(-1), sourceY = new Int16Array(width * height).fill(-1)
  let count = 0
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const index = y * width + x, sx = bx + x, sy = by + y
    if (write(sx, sy)) { allowed[index] = 1; count++ }
    if (trusted(sx, sy)) { status[index] = 1; for (let c = 0; c < 3; c++) working[index * 3 + c] = image.data[(sy * image.width + sx) * 4 + c] }
  }
  if (!count) throw new Error('原尺寸补片与可写底材没有交集。')
  const columns = Math.ceil(width / stepX), rows = Math.ceil(height / stepY)
  if (columns * rows > 4096) throw new Error('原尺寸补片次数超过预算，请扩大干净取样或缩小移除范围。')
  const rangeX = donor.width - pw, rangeY = donor.height - ph
  const stride = Math.max(1, Math.ceil(Math.sqrt((rangeX + 1) * (rangeY + 1) / 256)))
  const origins: Array<{ x: number; y: number }> = []
  for (let y = 0; y <= rangeY; y += stride) for (let x = 0; x <= rangeX; x += stride) origins.push({ x: donor.x + x, y: donor.y + y })
  if (rangeX % stride || rangeY % stride) origins.push({ x: donor.x + rangeX, y: donor.y + rangeY })
  const rgb = (x: number, y: number, c: number) => image.data[(y * image.width + x) * 4 + c]
  let work = 0
  const seam = (cost: Float64Array, across: number, along: number): Int16Array => {
    const distance = cost.slice(), previous = new Int16Array(cost.length)
    for (let row = 1; row < along; row++) for (let col = 0; col < across; col++) {
      let best = col
      for (let k = Math.max(0, col - 1); k <= Math.min(across - 1, col + 1); k++) if (distance[(row - 1) * across + k] < distance[(row - 1) * across + best]) best = k
      distance[row * across + col] += distance[(row - 1) * across + best]; previous[row * across + col] = best
    }
    let best = 0
    for (let col = 1; col < across; col++) if (distance[(along - 1) * across + col] < distance[(along - 1) * across + best]) best = col
    const result = new Int16Array(along)
    for (let row = along - 1; row >= 0; row--) { result[row] = best; best = previous[row * across + best] }
    return result
  }
  for (let py = 0; py < height; py += stepY) for (let px = 0; px < width; px += stepX) {
    const tw = Math.min(pw, width - px), th = Math.min(ph, height - py)
    let hasWrite = false
    const known: Array<{ x: number; y: number; index: number }> = []
    for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
      const index = (py + y) * width + px + x
      hasWrite ||= allowed[index] > 0
      if (status[index]) known.push({ x, y, index })
    }
    if (!hasWrite) continue
    const samples = Array.from({ length: Math.min(128, known.length) }, (_, i) => known[Math.floor(i * known.length / Math.min(128, known.length))])
    let best = { x: donor.x, y: donor.y, score: Infinity, offset: [0, 0, 0] }
    const consider = (x: number, y: number) => {
      work += samples.length
      if (work > 100_000_000) throw new Error('原尺寸补片搜索超过计算预算，请缩小移除范围。')
      const offsets: number[][] = [[], [], []]
      for (const sample of samples) for (let c = 0; c < 3; c++) {
        const delta = working[sample.index * 3 + c] - rgb(x + sample.x, y + sample.y, c)
        if (Math.abs(delta) <= 24) offsets[c].push(delta)
      }
      const offset = offsets.map(values => values.length >= 4 ? Math.max(-14, Math.min(14, median(values))) : 0)
      let score = 0
      for (const sample of samples) {
        const at = sample.index * 3
        for (let c = 0; c < 3; c++) {
          const delta = working[at + c] - rgb(x + sample.x, y + sample.y, c) - offset[c]
          score += Math.min(4096, delta * delta)
          if (sample.x > 0 && status[sample.index - 1]) {
            const gradient = working[at + c] - working[at - 3 + c] - rgb(x + sample.x, y + sample.y, c) + rgb(x + sample.x - 1, y + sample.y, c)
            score += .6 * Math.min(4096, gradient * gradient)
          }
          if (sample.y > 0 && status[sample.index - width]) {
            const gradient = working[at + c] - working[at - width * 3 + c] - rgb(x + sample.x, y + sample.y, c) + rgb(x + sample.x, y + sample.y - 1, c)
            score += .6 * Math.min(4096, gradient * gradient)
          }
        }
      }
      score = samples.length ? score / samples.length : 0
      // Deterministic order resolves equal scores; no stochastic retry or best-of-many run.
      if (score < best.score) best = { x, y, score, offset }
    }
    for (const origin of origins) consider(origin.x, origin.y)
    if (stride > 1) {
      const { x, y } = best
      for (let sy = Math.max(donor.y, y - stride); sy <= Math.min(donor.y + rangeY, y + stride); sy++) for (let sx = Math.max(donor.x, x - stride); sx <= Math.min(donor.x + rangeX, x + stride); sx++) consider(sx, sy)
    }
    const costAt = (x: number, y: number) => {
      const index = (py + y) * width + px + x
      if (!status[index]) return 0
      let error = 0
      for (let c = 0; c < 3; c++) { const d = working[index * 3 + c] - rgb(best.x + x, best.y + y, c) - best.offset[c]; error += d * d }
      return error
    }
    const leftWidth = Math.min(overlapX, tw), topHeight = Math.min(overlapY, th)
    let left: Int16Array | undefined, top: Int16Array | undefined
    if (px) { const costs = new Float64Array(leftWidth * th); for (let y = 0; y < th; y++) for (let x = 0; x < leftWidth; x++) costs[y * leftWidth + x] = costAt(x, y); left = seam(costs, leftWidth, th) }
    if (py) { const costs = new Float64Array(topHeight * tw); for (let x = 0; x < tw; x++) for (let y = 0; y < topHeight; y++) costs[x * topHeight + y] = costAt(x, y); top = seam(costs, topHeight, tw) }
    for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
      const index = (py + y) * width + px + x
      if (!allowed[index]) continue
      if (status[index] === 2 && (left && x < left[y] || top && y < top[x])) continue
      for (let c = 0; c < 3; c++) working[index * 3 + c] = rgb(best.x + x, best.y + y, c) + best.offset[c]
      sourceX[index] = best.x + x; sourceY[index] = best.y + y
      status[index] = 2
    }
  }
  // Keep copied source gradients, but remove artificial steps where unrelated
  // patches meet. The correction is confined to permitted pixels; its only
  // boundary observations are trusted original pixels. Excluded RGB is never read.
  const correction = new Float32Array(working.length), divergence = new Float32Array(working.length), degree = new Uint8Array(width * height)
  const directions = [[-1, 0], [1, 0], [0, -1], [0, 1]] as const
  const sourceDelta = (index: number, dx: number, dy: number, c: number) => {
    const x = sourceX[index], y = sourceY[index], nx = x + dx, ny = y + dy
    if (nx < donor.x || nx >= donor.x + donor.width || ny < donor.y || ny >= donor.y + donor.height) return 0
    return rgb(x, y, c) - rgb(nx, ny, c)
  }
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const index = y * width + x
    if (!allowed[index]) continue
    for (const [dx, dy] of directions) {
      const nx = x + dx, ny = y + dy, neighbour = ny * width + nx
      if (nx < 0 || nx >= width || ny < 0 || ny >= height || !status[neighbour]) continue
      degree[index]++
      for (let c = 0; c < 3; c++) {
        let gradient = sourceDelta(index, dx, dy, c)
        if (status[neighbour] === 2) gradient = (gradient - sourceDelta(neighbour, -dx, -dy, c)) / 2
        divergence[index * 3 + c] += gradient - working[index * 3 + c] + working[neighbour * 3 + c]
      }
    }
  }
  const iterations = Math.min(2000, Math.floor(120_000_000 / (width * height)))
  for (let iteration = 0; iteration < iterations; iteration++) for (let parity = 0; parity < 2; parity++) {
    for (let y = 0; y < height; y++) for (let x = (y + parity) % 2; x < width; x += 2) {
      const index = y * width + x
      if (!allowed[index] || !degree[index]) continue
      for (let c = 0; c < 3; c++) {
        let sum = divergence[index * 3 + c]
        for (const [dx, dy] of directions) {
          const nx = x + dx, ny = y + dy, neighbour = ny * width + nx
          if (nx >= 0 && nx < width && ny >= 0 && ny < height && allowed[neighbour]) sum += correction[neighbour * 3 + c]
        }
        const at = index * 3 + c
        correction[at] += 1.6 * (sum / degree[index] - correction[at])
      }
    }
  }
  const data = image.data.slice()
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const index = y * width + x
    if (!allowed[index]) continue
    if (status[index] !== 2) throw new Error('原尺寸补片未完整覆盖移除范围，请保留原任务。')
    const at = ((by + y) * image.width + bx + x) * 4
    for (let c = 0; c < 3; c++) data[at + c] = working[index * 3 + c] + correction[index * 3 + c]
    data[at + 3] = 255
  }
  return { ...image, data }
}
