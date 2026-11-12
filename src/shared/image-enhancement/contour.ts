import type { ImagePixels } from '../image-import/pixels.js'
import type { CancellationSignal } from '../ports/resources.js'
import type { ImageEnhancementStrength } from './schema.js'

function cancelled(signal?: CancellationSignal): void {
  if (signal?.aborted) { const error = new Error('画质候选已取消。'); error.name = 'AbortError'; throw error }
}

/**
 * Explicit coverage estimate for supported diagonal steps in a binary cutout.
 * No RGB is reconstructed and the nonzero support never expands or disappears.
 * Axis-aligned edges, fractional coverage and details without an opaque inner
 * 3x3 patch remain untouched. This softens some steps, not semantic cut errors.
 */
export function softenImageContour(image: ImagePixels, strength: ImageEnhancementStrength, signal?: CancellationSignal): ImagePixels {
  const { width, height, data } = image, output = data.slice()
  const coverage = { gentle: 224, balanced: 192, strong: 160 }[strength]
  const alpha = (x: number, y: number) => data[(y * width + x) * 4 + 3]
  const opaquePatch = (x: number, y: number): boolean => {
    if (x < 1 || y < 1 || x + 1 >= width || y + 1 >= height) return false
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (alpha(x + dx, y + dy) !== 255) return false
    return true
  }
  for (let y = 1; y + 1 < height; y++) {
    if (!(y % 16)) cancelled(signal)
    for (let x = 1; x + 1 < width; x++) {
      if (alpha(x, y) !== 255) continue
      const left = alpha(x - 1, y), right = alpha(x + 1, y), up = alpha(x, y - 1), down = alpha(x, y + 1)
      // The two clear neighbours must form a corner, not the sides of a thin line.
      const inwardX = left === 0 && right === 255 ? 1 : right === 0 && left === 255 ? -1 : 0
      const inwardY = up === 0 && down === 255 ? 1 : down === 0 && up === 255 ? -1 : 0
      // Both tangent steps must exist: an isolated right-angle rectangle corner
      // is intentional geometry, not sufficient evidence of a diagonal edge.
      if (inwardX && inwardY && alpha(x + inwardX, y - inwardY) === 255 && alpha(x - inwardX, y + inwardY) === 255
        && opaquePatch(x + inwardX, y + inwardY)) output[(y * width + x) * 4 + 3] = coverage
    }
  }
  cancelled(signal)
  return { width, height, data: output }
}
