import type { ImagePixels } from './pixels.js'

/** Integer replication preserves every source RGBA and invents no texture or palette. */
export function scaleSourcePixels(image: ImagePixels, scale: 1 | 2 | 4): ImagePixels {
  if (![1, 2, 4].includes(scale) || !Number.isSafeInteger(image.width) || !Number.isSafeInteger(image.height)
    || image.width < 1 || image.height < 1 || !(image.data instanceof Uint8ClampedArray) || image.data.length !== image.width * image.height * 4) throw new Error('原色输出需要完整RGBA与1/2/4整数倍率。')
  const width = image.width * scale, height = image.height * scale
  if (width > 8192 || height > 8192 || width * height > 32_000_000) throw new Error('原色放大超过8192边长或3200万像素，请缩小原图保留范围或降低倍率。')
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
    const source = (y * image.width + x) * 4
    for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) data.set(image.data.subarray(source, source + 4), ((y * scale + dy) * width + x * scale + dx) * 4)
  }
  return { width, height, data }
}
