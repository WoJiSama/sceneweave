import type { ImagePixelMask, ImagePixels } from './pixels.js'

/** Exact source RGB on three contrasting backgrounds; nearest sampling exposes the source grid. */
export function imageItemReviewSheet(image: ImagePixels, mask: ImagePixelMask, scale: 1 | 2 | 4 = 4): ImagePixels {
  if (![1, 2, 4].includes(scale)) throw new Error('边缘预览倍率只能为1、2或4。')
  const padding = 8, width = (mask.width * scale + padding) * 3 + padding, height = mask.height * scale + padding * 2
  if (width * height > 16_000_000) throw new Error('边缘预览超过1600万像素，请缩小物件范围。')
  const data = new Uint8ClampedArray(width * height * 4).fill(255)
  for (let panel = 0; panel < 3; panel++) for (let y = 0; y < mask.height * scale; y++) for (let x = 0; x < mask.width * scale; x++) {
    const mx = Math.floor(x / scale), my = Math.floor(y / scale), coverage = mask.data[my * mask.width + mx] / 255
    const source = ((my + mask.boundsPx.y) * image.width + mx + mask.boundsPx.x) * 4
    const alpha = coverage * image.data[source + 3] / 255
    const background = panel === 0 ? 0 : panel === 1 ? 255 : (Math.floor(x / 16) + Math.floor(y / 16)) % 2 ? 220 : 255
    const target = ((y + padding) * width + panel * (mask.width * scale + padding) + padding + x) * 4
    for (let channel = 0; channel < 3; channel++) data[target + channel] = Math.round(image.data[source + channel] * alpha + background * (1 - alpha))
  }
  return { width, height, data }
}
