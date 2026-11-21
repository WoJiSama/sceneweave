import type { ImagePixelMask, ImagePixels, PixelBounds } from './pixels.js'
import { imageNeighborhoodExcludedEvidence, type ImageNeighborhoodSignal } from './neighborhood-evidence.js'
import { selectContextPatch } from './context-patch.js'
import { maskCoverage } from './repair-scope.js'

interface ContextEvidence {
  priorInference?: Uint8Array
  objectEvidence?: readonly ImagePixelMask[]
  signal?: ImageNeighborhoodSignal
  trustedSource?: (x: number, y: number) => boolean
}

const MAX_PIXEL_ITERATIONS_PER_CHANNEL = 50_000_000
const MAX_ITERATIONS = 2048
const RESIDUAL_RMS = 0.00001

/** MIC(0) on the masked five-point stencil, following Bridson's SIGGRAPH 2007
 * course notes, section 4.3.4. Accumulate discarded diagonal-neighbour couplings
 * into the pivots to approximate the low-frequency colour correction.
 */
function contextPreconditioner(degree: Uint8Array, neighbors: Int32Array, signal?: ImageNeighborhoodSignal): Float64Array {
  const inverse = new Float64Array(degree.length), weight = 0.97
  for (let i = 0; i < degree.length; i++) {
    if (i % 4096 === 0) signal?.throwIfAborted()
    const left = neighbors[i * 4], up = neighbors[i * 4 + 2]
    let pivot = degree[i]
    if (left >= 0) pivot -= inverse[left] * (1 + (neighbors[left * 4 + 3] >= 0 ? weight : 0))
    if (up >= 0) pivot -= inverse[up] * (1 + (neighbors[up * 4 + 1] >= 0 ? weight : 0))
    // Near an irregular or excluded edge, keep a positive triangular factor.
    inverse[i] = 1 / (pivot >= degree[i] * 0.25 ? pivot : degree[i])
  }
  return inverse
}

function preconditionResidual(residual: Float64Array, neighbors: Int32Array, inverse: Float64Array, output: Float64Array): number {
  for (let i = 0; i < residual.length; i++) {
    const left = neighbors[i * 4], up = neighbors[i * 4 + 2]
    output[i] = (residual[i] + (left >= 0 ? output[left] : 0) + (up >= 0 ? output[up] : 0)) * inverse[i]
  }
  let product = 0
  for (let i = residual.length - 1; i >= 0; i--) {
    const right = neighbors[i * 4 + 1], down = neighbors[i * 4 + 3]
    output[i] += ((right >= 0 ? output[right] : 0) + (down >= 0 ? output[down] : 0)) * inverse[i]
    product += residual[i] * output[i]
  }
  return product
}

/** One translated source patch supplies the gradients;
 * harmonic RGB correction uses the actual writable outline, never the rectangle's sides.
 * Protected/unknown edges have zero flux. Every connected component needs real boundary
 * evidence. Neither a failed solve nor an exhausted budget returns a usable image.
 */
export function repairContextBlend(image: ImagePixels, mask: ImagePixelMask, donor: PixelBounds,
  protection?: ImagePixelMask, evidence: ContextEvidence = {}, version: 1 | 2 = 1): ImagePixels {
  if (![image.width, image.height].every(Number.isSafeInteger) || image.width < 1 || image.height < 1
    || image.width > 8192 || image.height > 8192 || image.width * image.height > 32_000_000
    || !(image.data instanceof Uint8ClampedArray) || image.data.length !== image.width * image.height * 4) throw new Error('边界衔接需要完整原图RGBA。')
  const { x, y, width, height } = mask.boundsPx, area = width * height
  if (![x, y, width, height].every(Number.isSafeInteger) || width < 1 || height < 1 || area > 250_000 || mask.width !== width || mask.height !== height
    || !(mask.data instanceof Uint8Array)
    || mask.data.length !== area || x < 0 || y < 0 || x + width > image.width || y + height > image.height
    || mask.data.some(value => value !== 0 && value !== 255)) throw new Error('边界衔接需要25万像素以内的二值移除范围。')
  if (![donor.x, donor.y, donor.width, donor.height].every(Number.isSafeInteger) || donor.x < 0 || donor.y < 0
    || donor.width < width + 4 || donor.height < height + 4 || donor.width * donor.height > 1_000_000
    || donor.x + donor.width > image.width || donor.y + donor.height > image.height) throw new Error('边界衔接取样须在原图内，宽高各多4像素且最多100万像素。')
  if (evidence.priorInference && evidence.priorInference.length !== image.width * image.height) throw new Error('补底来源记录与原图尺寸不符。')
  if ((evidence.objectEvidence?.length ?? 0) > 128) throw new Error('边界衔接最多接收128个物件排除范围。')
  evidence.signal?.throwIfAborted()
  const boundaryX = Math.max(0, x - 2), boundaryY = Math.max(0, y - 2)
  const boundaryBounds = { x: boundaryX, y: boundaryY, width: Math.min(image.width, x + width + 2) - boundaryX,
    height: Math.min(image.height, y + height + 2) - boundaryY }
  const excludedDonor = imageNeighborhoodExcludedEvidence(donor, evidence.objectEvidence ?? [])
  const excludedBoundary = imageNeighborhoodExcludedEvidence(boundaryBounds, evidence.objectEvidence ?? [])
  const excluded = (sx: number, sy: number) => !!evidence.priorInference?.[sy * image.width + sx]
    || !!maskCoverage(excludedDonor, sx, sy) || !!maskCoverage(excludedBoundary, sx, sy)
    || (evidence.trustedSource !== undefined && !evidence.trustedSource(sx, sy))
  const forbidden = (sx: number, sy: number) => !!maskCoverage(mask, sx, sy) || !!maskCoverage(protection, sx, sy) || excluded(sx, sy)
  // The whole declared source is evidence, including its two-pixel context margin.
  for (let sy = donor.y; sy < donor.y + donor.height; sy++) {
    evidence.signal?.throwIfAborted()
    for (let sx = donor.x; sx < donor.x + donor.width; sx++) {
      if (forbidden(sx, sy) || image.data[(sy * image.width + sx) * 4 + 3] !== 255) {
        throw new Error('完整补片来源须为可信不透明原图，不能含移除、保护、前序推断或未移走的物件。')
      }
    }
  }
  const patch = selectContextPatch(image, mask, donor, protection, excluded, evidence.signal)
  const indices = new Int32Array(area).fill(-1), positions: number[] = []
  for (let i = 0; i < area; i++) if (mask.data[i]) { indices[i] = positions.length; positions.push(i) }
  const count = positions.length
  if (!count) throw new Error('边界衔接没有可写像素。')
  const neighbors = new Int32Array(count * 4).fill(-1), degree = new Uint8Array(count), anchored = new Uint8Array(count)
  const rhs = new Float64Array(count * 3)
  for (let i = 0; i < count; i++) {
    if (i % 4096 === 0) evidence.signal?.throwIfAborted()
    const at = positions[i], sx = x + at % width, sy = y + Math.floor(at / width)
    for (const [d, dx, dy] of [[0, -1, 0], [1, 1, 0], [2, 0, -1], [3, 0, 1]]) {
      const nx = sx + dx, ny = sy + dy
      if (nx < 0 || ny < 0 || nx >= image.width || ny >= image.height) continue
      if (maskCoverage(mask, nx, ny)) {
        degree[i]++; neighbors[i * 4 + d] = indices[(ny - y) * width + nx - x]
      } else if (!forbidden(nx, ny) && image.data[(ny * image.width + nx) * 4 + 3] === 255) {
        degree[i]++; anchored[i] = 1
        const target = (ny * image.width + nx) * 4, from = ((ny + patch.dy) * image.width + nx + patch.dx) * 4
        for (let c = 0; c < 3; c++) rhs[i * 3 + c] += image.data[target + c] - image.data[from + c]
      }
    }
  }
  // A protected hole is not a source of RGB. Reject isolated unanchored islands
  // rather than quietly choosing an arbitrary colour for their singular system.
  const visited = new Uint8Array(count), queue = new Int32Array(count)
  for (let start = 0; start < count; start++) {
    if (visited[start]) continue
    let head = 0, tail = 1, hasBoundary = false
    queue[0] = start; visited[start] = 1
    while (head < tail) {
      if (head % 4096 === 0) evidence.signal?.throwIfAborted()
      const i = queue[head++]; hasBoundary ||= !!anchored[i]
      for (let d = 0; d < 4; d++) {
        const next = neighbors[i * 4 + d]
        if (next >= 0 && !visited[next]) { visited[next] = 1; queue[tail++] = next }
      }
    }
    if (!hasBoundary) throw new Error('移除范围有缺少可信原图边界的独立部分，请补充同材质依据或缩小范围。')
  }
  const correction = new Float64Array(count * 3)
  // Charge the two additional triangular sweeps at twice the original per-iteration cost.
  const limit = Math.min(MAX_ITERATIONS, Math.floor(MAX_PIXEL_ITERATIONS_PER_CHANNEL / (count * version)))
  const inverse = version === 2 ? contextPreconditioner(degree, neighbors, evidence.signal) : undefined
  const conditioned = inverse ? new Float64Array(count) : undefined
  // The versions share the same Laplacian, trusted boundary and residual threshold.
  const residual = new Float64Array(count), direction = new Float64Array(count), product = new Float64Array(count)
  for (let c = 0; c < 3; c++) {
    let rz = 0, norm = 0
    for (let i = 0; i < count; i++) {
      residual[i] = rhs[i * 3 + c]; direction[i] = residual[i] / degree[i]
      rz += residual[i] * direction[i]; norm += residual[i] ** 2
    }
    if (inverse && conditioned) {
      rz = preconditionResidual(residual, neighbors, inverse, conditioned)
      direction.set(conditioned)
    }
    let iteration = 0
    while (norm > count * RESIDUAL_RMS ** 2) {
      evidence.signal?.throwIfAborted()
      if (iteration++ >= limit) throw new Error('边界衔接在计算预算内未收敛，请缩小移除范围；未返回部分补图。')
      let denominator = 0
      for (let i = 0; i < count; i++) {
        let value = degree[i] * direction[i]
        for (let d = 0; d < 4; d++) { const next = neighbors[i * 4 + d]; if (next >= 0) value -= direction[next] }
        product[i] = value; denominator += direction[i] * value
      }
      if (!(denominator > 0) || !Number.isFinite(denominator)) throw new Error('边界衔接求解失败，旧结果保持。')
      const alpha = rz / denominator
      let nextRz = 0; norm = 0
      for (let i = 0; i < count; i++) {
        correction[i * 3 + c] += alpha * direction[i]; residual[i] -= alpha * product[i]
        nextRz += residual[i] ** 2 / degree[i]; norm += residual[i] ** 2
      }
      if (inverse && conditioned) nextRz = preconditionResidual(residual, neighbors, inverse, conditioned)
      const beta = nextRz / rz
      for (let i = 0; i < count; i++) direction[i] = (conditioned ? conditioned[i] : residual[i] / degree[i]) + beta * direction[i]
      rz = nextRz
      if (!Number.isFinite(norm) || !Number.isFinite(rz)) throw new Error('边界衔接求解失败，旧结果保持。')
    }
  }
  evidence.signal?.throwIfAborted()
  const data = image.data.slice()
  for (let i = 0; i < count; i++) {
    const at = positions[i], sx = x + at % width, sy = y + Math.floor(at / width)
    const target = (sy * image.width + sx) * 4, from = ((sy + patch.dy) * image.width + sx + patch.dx) * 4
    for (let c = 0; c < 3; c++) data[target + c] = Math.round(image.data[from + c] + correction[i * 3 + c])
    data[target + 3] = 255
  }
  return { width: image.width, height: image.height, data }
}
