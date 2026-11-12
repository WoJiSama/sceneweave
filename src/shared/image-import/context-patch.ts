import type { ImagePixelMask, ImagePixels, PixelBounds } from './pixels.js'
import { maskCoverage } from './repair-scope.js'

/** Fixed context-patch-v1: one unscaled translated patch, selected by visible boundary context.
 * Reads no removed/protected pixel as evidence. Robust low-frequency boundary colour matching
 * leaves copied texture contrast intact. No tile, mirror, warp or generated fine detail.
 */
export function repairContextPatch(image: ImagePixels, mask: ImagePixelMask, donor: PixelBounds,
  protection?: ImagePixelMask): ImagePixels {
  const { x, y, width, height } = mask.boundsPx
  if (width * height > 250_000) throw new Error('完整纹理补片最多25万像素，请缩小移除范围。')
  const margin = 2, dw = donor.width - width - margin * 2, dh = donor.height - height - margin * 2
  if (dw < 0 || dh < 0) throw new Error('完整纹理取样须比移除范围宽高各多4像素，请扩大干净木板取样。')
  const evidence: Array<{ x: number; y: number; index: number }> = []
  for (let sy = Math.max(0, y - margin); sy < Math.min(image.height, y + height + margin); sy++) {
    for (let sx = Math.max(0, x - margin); sx < Math.min(image.width, x + width + margin); sx++) {
      if (maskCoverage(mask, sx, sy) || maskCoverage(protection, sx, sy)) continue
      let near = false
      for (let dy = -margin; dy <= margin && !near; dy++) for (let dx = -margin; dx <= margin; dx++) {
        if (maskCoverage(mask, sx + dx, sy + dy)) { near = true; break }
      }
      if (near && image.data[(sy * image.width + sx) * 4 + 3] === 255) evidence.push({ x: sx, y: sy, index: (sy * image.width + sx) * 4 })
    }
  }
  if (evidence.length < 12) throw new Error('完整纹理补片缺少可信边界，需更多未遮挡且未保护的同材质上下文。')
  const samples = Array.from({ length: Math.min(256, evidence.length) }, (_, i) => evidence[Math.floor(i * evidence.length / Math.min(256, evidence.length))])
  const maxCandidates = 8192, stride = Math.max(1, Math.ceil(Math.sqrt((dw + 1) * (dh + 1) / maxCandidates)))
  let best = { dx: 0, dy: 0, score: Infinity }
  const consider = (left: number, top: number) => {
    const dx = left - x, dy = top - y
    let score = 0
    for (const point of samples) {
      const sx = point.x + dx, sy = point.y + dy
      if (maskCoverage(mask, sx, sy) || maskCoverage(protection, sx, sy)) return
      const at = (sy * image.width + sx) * 4
      if (image.data[at + 3] !== 255) return
      for (let c = 0; c < 3; c++) {
        const delta = image.data[point.index + c] - image.data[at + c]
        score += Math.min(4096, delta * delta)
      }
    }
    score /= samples.length
    // Only exact integer translation is allowed; ties keep scan-order identity.
    if (score < best.score) best = { dx, dy, score }
  }
  const left = donor.x + margin, top = donor.y + margin
  for (let sy = top; sy <= top + dh; sy += stride) for (let sx = left; sx <= left + dw; sx += stride) consider(sx, sy)
  if (stride > 1 && Number.isFinite(best.score)) {
    const bx = x + best.dx, by = y + best.dy
    for (let sy = Math.max(top, by - stride); sy <= Math.min(top + dh, by + stride); sy++) {
      for (let sx = Math.max(left, bx - stride); sx <= Math.min(left + dw, bx + stride); sx++) consider(sx, sy)
    }
  }
  if (!Number.isFinite(best.score)) throw new Error('取样没有可用的完整纹理补片。')
  // Estimate broad lighting from four visible sides. Reject large residuals (ink,
  // missing joints and other objects); they are not a lighting estimate.
  const sides: number[][][] = Array.from({ length: 4 }, () => [[], [], []])
  for (const point of evidence) {
    const from = ((point.y + best.dy) * image.width + point.x + best.dx) * 4
    if (image.data[from + 3] !== 255) continue
    const residual = [0, 1, 2].map(c => image.data[point.index + c] - image.data[from + c])
    if (residual.some(value => Math.abs(value) > 28)) continue
    const distances = [Math.abs(point.x - x), Math.abs(point.x - (x + width - 1)), Math.abs(point.y - y), Math.abs(point.y - (y + height - 1))]
    const side = distances.indexOf(Math.min(...distances))
    residual.forEach((value, c) => sides[side][c].push(value))
  }
  const offsets = sides.map(channels => channels.map(values => {
    if (values.length < 4) return 0
    values.sort((a, b) => a - b)
    return values[Math.floor(values.length / 2)]
  }))
  const data = image.data.slice()
  for (let row = 0; row < height; row++) for (let column = 0; column < width; column++) {
    if (!mask.data[row * width + column]) continue
    const sx = x + column, sy = y + row, fromX = sx + best.dx, fromY = sy + best.dy
    if (maskCoverage(mask, fromX, fromY) || maskCoverage(protection, fromX, fromY)) throw new Error('完整纹理补片与移除或保护范围相交。')
    const at = (sy * image.width + sx) * 4, from = (fromY * image.width + fromX) * 4
    if (image.data[from + 3] !== 255) throw new Error('完整纹理补片须使用不透明底材，请更换干净取样。')
    data.set(image.data.subarray(from, from + 4), at)
    const weights = [1 / (column + 1) ** 2, 1 / (width - column) ** 2, 1 / (row + 1) ** 2, 1 / (height - row) ** 2]
    const total = weights.reduce((a, b) => a + b, 0)
    for (let c = 0; c < 3; c++) data[at + c] += offsets.reduce((value, side, index) => value + side[c] * weights[index], 0) / total
  }
  return { width: image.width, height: image.height, data }
}
