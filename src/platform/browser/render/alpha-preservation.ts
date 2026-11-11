import { checkCancelled } from '../../../shared/ports/resources.js'

/** Color and atmosphere may change RGB, but cannot turn empty background into
 * painted pixels. Capture only alpha; bounded RGBA strips avoid a second full
 * 4K image allocation and preserve fractional shadow/feather coverage exactly. */
export function paintWithPreservedAlpha(ctx: CanvasRenderingContext2D, paint: () => void, signal?: AbortSignal): void {
  const width = ctx.canvas.width, height = ctx.canvas.height
  const alpha = new Uint8Array(width * height)
  for (let y = 0; y < height; y += 128) {
    checkCancelled(signal)
    const rows = Math.min(128, height - y), image = ctx.getImageData(0, y, width, rows)
    for (let p = 0; p < width * rows; p++) {
      const offset = p * 4 + 3
      alpha[y * width + p] = image.data[offset]
      // Grade straight RGB at full coverage. Compositing a color wash over a
      // fractional alpha first would otherwise darken feather/shadow edges
      // differently from the same RGB at full opacity.
      if (image.data[offset]) image.data[offset] = 255
    }
    ctx.putImageData(image, 0, y)
  }
  paint()
  for (let y = 0; y < height; y += 128) {
    checkCancelled(signal)
    const rows = Math.min(128, height - y), image = ctx.getImageData(0, y, width, rows)
    for (let p = 0; p < width * rows; p++) {
      const offset = p * 4, coverage = alpha[y * width + p]
      image.data[offset + 3] = coverage
      if (!coverage) image.data[offset] = image.data[offset + 1] = image.data[offset + 2] = 0
    }
    ctx.putImageData(image, 0, y)
  }
}
