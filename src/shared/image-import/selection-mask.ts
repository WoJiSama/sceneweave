import { z } from 'zod'
import type { ImagePixelMask } from './pixels.js'
import { captureJson } from '../validation/json.js'

/** Selection geometry, not replacement colour or a caller-supplied fidelity waiver. */
export const IMAGE_SELECTION_LIMITS = Object.freeze({ pixels: 1_000_000, runEntries: 200_000,
  recipePixels: 8_000_000, recipeRunEntries: 500_000, recipeBytes: 8 * 1024 * 1024 })

export const imageSelectionMaskSchema = z.strictObject({
  x: z.number().int().nonnegative().max(8192), y: z.number().int().nonnegative().max(8192),
  width: z.number().int().positive().max(8192), height: z.number().int().positive().max(8192),
  runs: z.array(z.number().int().nonnegative().max(IMAGE_SELECTION_LIMITS.pixels)).min(2).max(IMAGE_SELECTION_LIMITS.runEntries),
}).superRefine((mask, context) => {
  const size = mask.width * mask.height
  if (size > IMAGE_SELECTION_LIMITS.pixels) context.addIssue({ code: 'custom', message: '精细选区最多100万像素，请收窄选区。' })
  if (mask.runs.length % 2) context.addIssue({ code: 'custom', message: '精细选区需要完整的长度与透明度配对。' })
  let total = 0, visible = false
  for (let index = 0; index < mask.runs.length; index += 2) {
    const count = mask.runs[index], alpha = mask.runs[index + 1]
    if (count < 1 || alpha === undefined || alpha > 255) context.addIssue({ code: 'custom', message: '精细选区的段长或透明度无效。' })
    total += count
    visible ||= alpha > 0
  }
  if (total !== size) context.addIssue({ code: 'custom', message: '精细选区长度与尺寸不一致。' })
  if (!visible) context.addIssue({ code: 'custom', message: '精细选区没有可提取像素。' })
})
export type ImageSelectionMask = z.infer<typeof imageSelectionMaskSchema>

export function assertSelectionMaskBudget(masks: readonly (ImageSelectionMask | undefined)[]): void {
  let pixels = 0, runs = 0
  for (const mask of masks) if (mask) {
    pixels += mask.width * mask.height; runs += mask.runs.length
    if (pixels > IMAGE_SELECTION_LIMITS.recipePixels || runs > IMAGE_SELECTION_LIMITS.recipeRunEntries) throw new Error('拆解提案精细选区累计超过800万像素或25万段，请收窄采用范围。')
  }
}

/** Decode a strictly captured, bounded row-major RLE on the original pixel grid. */
export function decodeSelectionMask(input: ImageSelectionMask, image: { width: number; height: number }): ImagePixelMask {
  const value = imageSelectionMaskSchema.parse(captureJson(input))
  if (!Number.isSafeInteger(image.width) || !Number.isSafeInteger(image.height) || image.width < 1 || image.height < 1
    || value.x + value.width > image.width || value.y + value.height > image.height) throw new Error('精细选区超出原图范围。')
  const data = new Uint8Array(value.width * value.height)
  let offset = 0
  for (let index = 0; index < value.runs.length; index += 2) {
    data.fill(value.runs[index + 1], offset, offset + value.runs[index])
    offset += value.runs[index]
  }
  return { width: value.width, height: value.height, data,
    boundsPx: { x: value.x, y: value.y, width: value.width, height: value.height } }
}

/** Lossless encoding preserves holes, disconnected details and source-grid alpha. */
export function encodeSelectionMask(mask: ImagePixelMask): ImageSelectionMask {
  if (!Number.isSafeInteger(mask.width) || !Number.isSafeInteger(mask.height) || mask.width < 1 || mask.height < 1
    || mask.width * mask.height > IMAGE_SELECTION_LIMITS.pixels || !(mask.data instanceof Uint8Array)
    || mask.data.length !== mask.width * mask.height || mask.boundsPx.width !== mask.width || mask.boundsPx.height !== mask.height) {
    throw new Error('精细选区需要完整蒙版，且最多100万像素。')
  }
  const runs: number[] = []
  let alpha = mask.data[0], count = 1
  for (let index = 1; index < mask.data.length; index++) {
    if (mask.data[index] === alpha) count++
    else {
      runs.push(count, alpha)
      if (runs.length >= IMAGE_SELECTION_LIMITS.runEntries) throw new Error('精细选区边缘过于复杂，超过10万段；请收窄范围，不能丢弃细节。')
      alpha = mask.data[index]; count = 1
    }
  }
  runs.push(count, alpha)
  return imageSelectionMaskSchema.parse({ x: mask.boundsPx.x, y: mask.boundsPx.y, width: mask.width, height: mask.height, runs })
}
