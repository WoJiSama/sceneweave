import { z } from 'zod'
import type { ImagePixels } from '../image-import/pixels.js'
import { checkCancelled, type CancellationSignal } from '../ports/resources.js'
import { IMAGE_EDIT_LIMITS } from './model-protocol.js'

export const modelPatchSchema = z.strictObject({
  x: z.int().min(0).max(4095),
  y: z.int().min(0).max(4095),
  width: z.int().min(16).max(4096),
  height: z.int().min(16).max(4096),
})
export type ModelPatch = z.infer<typeof modelPatchSchema>

/** Give the model surrounding pixels while keeping the write area explicit. */
export function modelPatchContext(image: Pick<ImagePixels, 'width' | 'height'>, patch: ModelPatch): ModelPatch {
  if (Math.max(image.width, image.height) > 4096 || image.width * image.height > IMAGE_EDIT_LIMITS.outputPixels) {
    throw new Error('局部补画保存的图片需在4096边长及800万像素以内。')
  }
  if (patch.x + patch.width > image.width || patch.y + patch.height > image.height) throw new Error('补画选区超出原图。')
  const pad = Math.min(128, Math.max(12, Math.round(Math.min(patch.width, patch.height) * .32)))
  const x = Math.max(0, patch.x - pad), y = Math.max(0, patch.y - pad)
  const width = Math.min(image.width, patch.x + patch.width + pad) - x
  const height = Math.min(image.height, patch.y + patch.height + pad) - y
  if (Math.max(width, height) > IMAGE_EDIT_LIMITS.side || width * height > IMAGE_EDIT_LIMITS.inputPixels) {
    throw new Error('裁片超过补画服务的尺寸，请缩小框选范围。')
  }
  if (width > height * 3 || height > width * 3) throw new Error('请把选区画得更接近方形，补画服务支持最宽 3:1。')
  return { x, y, width, height }
}

export function cropModelPatch(image: ImagePixels, { x, y, width, height }: ModelPatch): ImagePixels {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let row = 0; row < height; row++) {
    const start = ((y + row) * image.width + x) * 4
    data.set(image.data.subarray(start, start + width * 4), row * width * 4)
  }
  return { width, height, data }
}

/** Map the returned context to source coordinates and feather only inwards. */
export function mergeModelPatch(input: ImagePixels, replacement: ImagePixels, patch: ModelPatch, bounds: ModelPatch, signal?: CancellationSignal): ImagePixels {
  const data = input.data.slice()
  const feather = Math.min(10, Math.min(patch.width, patch.height) / 5)
  for (let y = 0; y < patch.height; y++) {
    checkCancelled(signal)
    for (let x = 0; x < patch.width; x++) {
      const index = ((patch.y + y) * input.width + patch.x + x) * 4
      if (!data[index + 3]) continue
      const u = Math.min(replacement.width - 1, Math.floor((patch.x + x - bounds.x + .5) * replacement.width / bounds.width))
      const v = Math.min(replacement.height - 1, Math.floor((patch.y + y - bounds.y + .5) * replacement.height / bounds.height))
      const sample = (v * replacement.width + u) * 4
      const edge = Math.min(x, y, patch.width - 1 - x, patch.height - 1 - y)
      const amount = Math.min(1, edge / feather) * replacement.data[sample + 3] / 255
      for (let channel = 0; channel < 3; channel++) data[index + channel] += (replacement.data[sample + channel] - data[index + channel]) * amount
    }
  }
  return { ...input, data }
}

export function assertLocalModelPatch(input: ImagePixels, output: ImagePixels, patch: ModelPatch, signal?: CancellationSignal): void {
  modelPatchContext(input, patch)
  if (input.width !== output.width || input.height !== output.height) throw new Error('局部补画必须保存原图尺寸。')
  let changed = false
  for (let y = 0; y < input.height; y++) {
    checkCancelled(signal)
    for (let x = 0; x < input.width; x++) {
      const index = (y * input.width + x) * 4
      const inside = x > patch.x && x < patch.x + patch.width - 1 && y > patch.y && y < patch.y + patch.height - 1 && input.data[index + 3] > 0
      if (output.data[index + 3] !== input.data[index + 3]) throw new Error('局部补画改变了原图透明轮廓。')
      for (let channel = 0; channel < 3; channel++) if (input.data[index + channel] !== output.data[index + channel]) {
        if (!inside) throw new Error('局部补画改变了选区之外的像素。')
        changed = true
      }
    }
  }
  if (!changed) throw new Error('模型返回的选区内没有可见的新像素。')
}
