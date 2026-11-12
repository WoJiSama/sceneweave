import type { ImagePixels } from '../image-import/pixels.js'
import type { CancellationSignal } from '../ports/resources.js'
import { parseImageEnhancementRecipe, type ImageEnhancementDirection, type ImageEnhancementRecipe, type ImageEnhancementStrength } from './schema.js'
import { decontaminateImageEdges } from './decontaminate.js'
import { softenImageContour } from './contour.js'

export const IMAGE_ENHANCEMENT_LIMITS = Object.freeze({ inputPixels: 4_000_000, outputPixels: 8_000_000,
  candidatePixels: 16_000_000, inputEdge: 8192, outputEdge: 4096 })
export interface ImageEnhancementMetrics {
  /** Compared with a nearest-neighbour copy at the same output scale, not a quality score. */
  changedPixels: number
  maxChannelDelta: number
  meanChannelDelta: number
  alphaChangedPixels: number
}
export interface ImageEnhancementCandidate {
  id: string
  label: string
  description: string
  recipe: ImageEnhancementRecipe
  pixels: ImagePixels
  metrics: ImageEnhancementMetrics
  duplicateOf?: string
}
export interface ImageEnhancementOptions {
  direction: ImageEnhancementDirection
  count: 2 | 3
  scopeMask?: Uint8Array
  scale?: 1 | 2
}

const strengthValue = { gentle: 0, balanced: 1, strong: 2 } as const
const linear = new Float64Array(256).map((_, value) => value <= 10 ? value / 3294.6 : ((value / 255 + .055) / 1.055) ** 2.4)
const clamp = (value: number, minimum: number, maximum: number) => Math.max(minimum, Math.min(maximum, value))
const srgb = (value: number) => Math.round(clamp(value <= .0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - .055, 0, 1) * 255)

function cancelled(signal?: CancellationSignal): void {
  if (signal?.aborted) { const error = new Error('画质候选已取消。'); error.name = 'AbortError'; throw error }
}
function validate(image: ImagePixels, scale: 1 | 2, scope?: Uint8Array, count = 1): void {
  if (!image || !Number.isSafeInteger(image.width) || !Number.isSafeInteger(image.height) || image.width < 1 || image.height < 1
    || image.width > IMAGE_ENHANCEMENT_LIMITS.inputEdge || image.height > IMAGE_ENHANCEMENT_LIMITS.inputEdge
    || image.width * image.height > IMAGE_ENHANCEMENT_LIMITS.inputPixels || !(image.data instanceof Uint8ClampedArray)
    || image.data.length !== image.width * image.height * 4) throw new Error('画质处理需要完整RGBA图像，最多400万像素。请缩小处理范围。')
  const pixels = image.width * image.height * scale * scale
  if (image.width * scale > IMAGE_ENHANCEMENT_LIMITS.outputEdge || image.height * scale > IMAGE_ENHANCEMENT_LIMITS.outputEdge
    || pixels > IMAGE_ENHANCEMENT_LIMITS.outputPixels || pixels * count > IMAGE_ENHANCEMENT_LIMITS.candidatePixels) {
    throw new Error('画质候选超过边长4096、单张800万或整组1600万像素，请缩小范围或降低倍率。')
  }
  if (scope !== undefined && (!(scope instanceof Uint8Array) || scope.length !== image.width * image.height || !scope.some(value => value > 0))) {
    throw new Error('处理选区须与源图尺寸一致，并包含要处理的像素。')
  }
}

/** Keys cubic kernel. Negative lobes are bounded by the adjacent source sample range below. */
function cubic(distance: number, sharpness: number): number {
  const x = Math.abs(distance)
  return x < 1 ? (sharpness + 2) * x ** 3 - (sharpness + 3) * x ** 2 + 1
    : x < 2 ? sharpness * x ** 3 - 5 * sharpness * x ** 2 + 8 * sharpness * x - 4 * sharpness : 0
}

/** Linear-light, premultiplied-alpha interpolation avoids colour from fully transparent pixels. */
function upscale(image: ImagePixels, strength: ImageEnhancementStrength, signal?: CancellationSignal): ImagePixels {
  const width = image.width * 2, height = image.height * 2, data = new Uint8ClampedArray(width * height * 4)
  const sharpness = [-.15, -.5, -.85][strengthValue[strength]]
  for (let y = 0; y < height; y++) {
    if (!(y % 16)) cancelled(signal)
    const sy = (y + .5) / 2 - .5, top = Math.floor(sy)
    for (let x = 0; x < width; x++) {
      const sx = (x + .5) / 2 - .5, left = Math.floor(sx)
      let alpha = 0, red = 0, green = 0, blue = 0, minA = 1, maxA = 0
      let minR = 1, minG = 1, minB = 1, maxR = 0, maxG = 0, maxB = 0
      for (let dy = -1; dy <= 2; dy++) for (let dx = -1; dx <= 2; dx++) {
        const index = (clamp(top + dy, 0, image.height - 1) * image.width + clamp(left + dx, 0, image.width - 1)) * 4
        const a = image.data[index + 3] / 255, weight = cubic(sx - left - dx, sharpness) * cubic(sy - top - dy, sharpness)
        alpha += a * weight
        red += linear[image.data[index]] * a * weight; green += linear[image.data[index + 1]] * a * weight; blue += linear[image.data[index + 2]] * a * weight
        if (dx >= 0 && dx <= 1 && dy >= 0 && dy <= 1) {
          minA = Math.min(minA, a); maxA = Math.max(maxA, a)
          if (a > 0) {
            minR = Math.min(minR, linear[image.data[index]]); maxR = Math.max(maxR, linear[image.data[index]])
            minG = Math.min(minG, linear[image.data[index + 1]]); maxG = Math.max(maxG, linear[image.data[index + 1]])
            minB = Math.min(minB, linear[image.data[index + 2]]); maxB = Math.max(maxB, linear[image.data[index + 2]])
          }
        }
      }
      const out = (y * width + x) * 4, rawAlpha = alpha
      alpha = clamp(alpha, minA, maxA)
      data[out + 3] = Math.round(alpha * 255)
      if (data[out + 3] && rawAlpha > 1e-8 && minR <= maxR) {
        data[out] = srgb(clamp(red / rawAlpha, minR, maxR)); data[out + 1] = srgb(clamp(green / rawAlpha, minG, maxG)); data[out + 2] = srgb(clamp(blue / rawAlpha, minB, maxB))
      }
    }
  }
  return { width, height, data }
}

function filter(image: ImagePixels, recipe: ImageEnhancementRecipe, signal?: CancellationSignal): ImagePixels {
  const { width, height } = image, data = image.data.slice(), level = strengthValue[recipe.strength]
  if (recipe.direction === 'clarity' && recipe.scale === 2) return { width, height, data }
  const sigma = [12, 20, 30][level], mix = [.25, .5, .75][level], limit = [3, 6, 10][level]
  for (let y = 0; y < height; y++) {
    if (!(y % 16)) cancelled(signal)
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 4, a = image.data[at + 3]
      if (!a) continue
      if (recipe.direction === 'edge' && a === 255) continue
      if (recipe.direction !== 'edge' && a < 64) continue
      let weights = 0, red = 0, green = 0, blue = 0, alpha = 0, minimum = 255, maximum = 0
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (x + dx < 0 || y + dy < 0 || x + dx >= width || y + dy >= height) continue
        const from = ((y + dy) * width + x + dx) * 4, otherAlpha = image.data[from + 3]
        if (recipe.direction === 'edge') {
          const w = dx === 0 && dy === 0 ? 4 : dx === 0 || dy === 0 ? 2 : 1
          weights += w; alpha += otherAlpha * w
          minimum = Math.min(minimum, otherAlpha); maximum = Math.max(maximum, otherAlpha)
        } else {
          // Exclude transparent samples and cross-alpha boundaries from colour reconstruction.
          if (Math.abs(a - otherAlpha) > 24 || !otherAlpha) continue
          let delta = 0
          for (let channel = 0; channel < 3; channel++) delta += (image.data[from + channel] - image.data[at + channel]) ** 2 / 3
          if (delta > 48 ** 2) continue
          const spatial = dx === 0 && dy === 0 ? 4 : dx === 0 || dy === 0 ? 2 : 1
          const w = spatial / (1 + delta / (sigma * sigma)) ** 2
          weights += w; red += image.data[from] * w; green += image.data[from + 1] * w; blue += image.data[from + 2] * w
        }
      }
      if (recipe.direction === 'edge') {
        // Only an existing transition beside clear outside and solid inside is eligible.
        // Never erase a retained opaque tip, create pixels outside, or fill a transparent hole.
        if (minimum !== 0 || maximum !== 255 || !weights) continue
        const amount = [8, 16, 28][level]
        data[at + 3] = Math.round(clamp(a + clamp((alpha / weights - a) * mix, -amount, amount), 1, 254))
      } else if (weights) {
        const average = [red / weights, green / weights, blue / weights]
        if (recipe.direction === 'denoise') {
          for (let channel = 0; channel < 3; channel++) data[at + channel] = Math.round(image.data[at + channel]
            + clamp((average[channel] - image.data[at + channel]) * mix, -limit, limit))
        } else {
          // At 1x, clarity is a bounded luminance-only local contrast change, preserving chroma.
          const delta = ((image.data[at] - average[0]) * .2126 + (image.data[at + 1] - average[1]) * .7152
            + (image.data[at + 2] - average[2]) * .0722) * mix
          for (let channel = 0; channel < 3; channel++) data[at + channel] = Math.round(clamp(image.data[at + channel] + clamp(delta, -limit, limit), 0, 255))
        }
      }
    }
  }
  return { width, height, data }
}

function scopeOutput(original: ImagePixels, output: ImagePixels, scale: 1 | 2, scope: Uint8Array | undefined, signal?: CancellationSignal): void {
  if (!scope) return
  for (let y = 0; y < output.height; y++) {
    if (!(y % 32)) cancelled(signal)
    for (let x = 0; x < output.width; x++) {
      const source = Math.floor(y / scale) * original.width + Math.floor(x / scale), amount = scope[source] / 255
      if (amount === 1) continue
      const from = source * 4, to = (y * output.width + x) * 4
      if (!amount) { output.data.set(original.data.subarray(from, from + 4), to); continue }
      const beforeAlpha = original.data[from + 3] / 255, afterAlpha = output.data[to + 3] / 255
      const alpha = beforeAlpha * (1 - amount) + afterAlpha * amount
      for (let channel = 0; channel < 3; channel++) output.data[to + channel] = alpha ? srgb((linear[original.data[from + channel]] * beforeAlpha * (1 - amount)
        + linear[output.data[to + channel]] * afterAlpha * amount) / alpha) : original.data[from + channel]
      output.data[to + 3] = Math.round(alpha * 255)
    }
  }
}

/** Deterministic derived pixels. The captured original and every previous candidate remain untouched. */
export function applyImageEnhancement(image: ImagePixels, input: ImageEnhancementRecipe, scopeMask?: Uint8Array, signal?: CancellationSignal): ImagePixels {
  cancelled(signal)
  const recipe = parseImageEnhancementRecipe(input)
  validate(image, recipe.scale, scopeMask)
  const filtered = recipe.direction === 'decontaminate' ? decontaminateImageEdges(image, recipe.strength, signal)
    : recipe.direction === 'contour' ? softenImageContour(image, recipe.strength, signal) : filter(image, recipe, signal)
  const result = recipe.scale === 2 ? upscale(filtered, recipe.strength, signal) : filtered
  scopeOutput(image, result, recipe.scale, scopeMask, signal)
  cancelled(signal)
  return result
}

function metrics(image: ImagePixels, result: ImagePixels, scale: 1 | 2, signal?: CancellationSignal): ImageEnhancementMetrics {
  let changedPixels = 0, maxChannelDelta = 0, total = 0, alphaChangedPixels = 0
  for (let y = 0; y < result.height; y++) {
    if (!(y % 32)) cancelled(signal)
    for (let x = 0; x < result.width; x++) {
      const from = (Math.floor(y / scale) * image.width + Math.floor(x / scale)) * 4, to = (y * result.width + x) * 4
      let changed = false
      for (let channel = 0; channel < 4; channel++) {
        const delta = Math.abs(image.data[from + channel] - result.data[to + channel])
        changed ||= delta > 0; maxChannelDelta = Math.max(maxChannelDelta, delta); total += delta
        if (channel === 3 && delta) alphaChangedPixels++
      }
      if (changed) changedPixels++
    }
  }
  return { changedPixels, maxChannelDelta, meanChannelDelta: total / (result.width * result.height * 4), alphaChangedPixels }
}

const descriptions: Record<ImageEnhancementDirection, readonly [string, string, string]> = {
  clarity: ['柔和过渡，减轻放大后的方块感。', '兼顾曲线平顺与现有细线。', '更鲜明地呈现现有边缘，需核对手绘笔触。'],
  edge: ['轻调已有半透明边缘，保留实心细节和孔洞。', '平衡边缘透明度，原有颜色保持。', '加强已有边缘的透明度过渡，需检查细小轮廓。'],
  denoise: ['轻减局部杂点，优先保留笔触。', '减弱相近颜色中的噪点，保留高反差线。', '更明显地减弱局部噪点，需检查木纹细节。'],
  decontaminate: ['轻减窄边带超出的色度，保留亮度和透明度。', '按稳定内侧颜色估计色边，原图真实颜色仍需对照。', '加强局部色边估计，需检查固有彩色边饰；证据不足处不改。'],
  contour: ['轻调有实心支撑的二值斜角，保留原色和细部。', '减轻部分斜向阶梯，原有透明孔洞与内部实心保持。', '更明显地软化受支撑斜角，需核对描边是否变淡；不恢复未知轮廓。'],
}
const labels = { clarity: ['柔和插值', '平衡插值', '较强插值'], edge: ['轻调边缘', '平衡边缘', '加强边缘'], denoise: ['保留笔触', '平衡降噪', '加强降噪'], decontaminate: ['轻减色边', '平衡色边', '加强色边'], contour: ['轻调斜角', '平衡斜角', '加强斜角'] } as const

/** All alternatives use the same supplied baseline; none consumes a sibling candidate's pixels. */
export function generateImageEnhancementCandidates(image: ImagePixels, options: ImageEnhancementOptions, signal?: CancellationSignal): ImageEnhancementCandidate[] {
  cancelled(signal)
  if (!options || options.count !== 2 && options.count !== 3) throw new Error('每组画质候选需要2或3个结果。')
  const scale = options.scale ?? (options.direction === 'clarity' ? 2 : 1)
  const firstRecipe = parseImageEnhancementRecipe({ version: 1, direction: options.direction, strength: 'gentle', scale })
  validate(image, firstRecipe.scale, options.scopeMask, options.count)
  const strengths: ImageEnhancementStrength[] = options.count === 2 ? ['gentle', 'strong'] : ['gentle', 'balanced', 'strong']
  const candidates: ImageEnhancementCandidate[] = []
  for (const strength of strengths) {
    cancelled(signal)
    const recipe = parseImageEnhancementRecipe({ ...firstRecipe, strength }), value = strengthValue[strength]
    const pixels = applyImageEnhancement(image, recipe, options.scopeMask, signal)
    const previous = candidates.find(candidate => candidate.pixels.data.every((byte, index) => byte === pixels.data[index]))
    candidates.push({ id: `${recipe.direction}-${strength}-${scale}x`, label: labels[recipe.direction][value],
      description: descriptions[recipe.direction][value], recipe, pixels, metrics: metrics(image, pixels, scale, signal),
      ...(previous ? { duplicateOf: previous.id } : {}) })
  }
  return candidates
}
