import type { ImagePixels } from '../image-import/pixels.js'
import type { CancellationSignal } from '../ports/resources.js'
import type { ImageEnhancementStrength } from './schema.js'

const luminance = (red: number, green: number, blue: number) => red * .2126 + green * .7152 + blue * .0722
const median = (values: number[]) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)]
const directions = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1]] as const
const strengthIndex = { gentle: 0, balanced: 1, strong: 2 } as const

function cancelled(signal?: CancellationSignal): void {
  if (signal?.aborted) { const error = new Error('画质候选已取消。'); error.name = 'AbortError'; throw error }
}

/** Distance from actual clear pixels, capped at the required inner evidence depth. */
function innerDepth(image: ImagePixels, signal?: CancellationSignal): Uint8Array {
  const { width, height, data } = image, depth = new Uint8Array(width * height).fill(7)
  for (let y = 0; y < height; y++) {
    if (!(y % 16)) cancelled(signal)
    for (let x = 0; x < width; x++) {
      const at = y * width + x
      if (!data[at * 4 + 3]) { depth[at] = 0; continue }
      depth[at] = Math.min(7, x ? depth[at - 1] + 1 : 7, y ? depth[at - width] + 1 : 7)
    }
  }
  for (let y = height - 1; y >= 0; y--) {
    if (!(y % 16)) cancelled(signal)
    for (let x = width - 1; x >= 0; x--) {
      const at = y * width + x
      depth[at] = Math.min(depth[at],
        x + 1 < width ? depth[at + 1] + 1 : 7, y + 1 < height ? depth[at + width] + 1 : 7)
    }
  }
  return depth
}

/**
 * Explicit, bounded colour-fringe estimate from stable opaque inner pixels, not recovered background.
 * A crop need not retain hidden background RGB. Never use its clear RGB as foreground evidence.
 * Only excess chroma in a two-pixel outer band is reduced; alpha and luminance stay unchanged.
 */
export function decontaminateImageEdges(image: ImagePixels, strength: ImageEnhancementStrength, signal?: CancellationSignal): ImagePixels {
  const { width, height, data } = image, output = data.slice(), depth = innerDepth(image, signal)
  const level = strengthIndex[strength], mix = [.25, .5, .75][level], limit = [6, 12, 20][level]
  for (let y = 0; y < height; y++) {
    if (!(y % 16)) cancelled(signal)
    for (let x = 0; x < width; x++) {
      const index = y * width + x, at = index * 4
      if (!depth[index] || depth[index] > 2 || !data[at + 3]) continue
      const light = luminance(data[at], data[at + 1], data[at + 2])
      const chroma = [data[at] - light, data[at + 1] - light, data[at + 2] - light]
      const saturation = Math.max(...chroma) - Math.min(...chroma)
      if (saturation < 12) continue
      const references: number[][] = []
      const seen = new Set<number>()
      for (const [dx, dy] of directions) {
        for (let distance = 1; distance <= 6; distance++) {
          const nx = x + dx * distance, ny = y + dy * distance
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) break
          const neighbor = ny * width + nx, from = neighbor * 4
          if (!depth[neighbor]) break // A hole or outside is not a route to the same foreground.
          if (depth[neighbor] < 3 || data[from + 3] !== 255) continue
          if (!seen.has(neighbor)) {
            const luma = luminance(data[from], data[from + 1], data[from + 2])
            references.push([data[from] - luma, data[from + 1] - luma, data[from + 2] - luma])
            seen.add(neighbor)
          }
          break
        }
      }
      if (references.length < 3) continue
      const middle = [0, 1, 2].map(channel => median(references.map(value => value[channel])))
      // Multicolour inner detail is ambiguous; retaining it is preferable to guessing a new colour.
      const spreads = references.map(value => Math.max(...value.map((channel, i) => Math.abs(channel - middle[i])))).sort((a, b) => a - b)
      if (spreads[Math.floor(spreads.length * .75)] > 10) continue
      const innerSaturation = Math.max(...middle) - Math.min(...middle)
      if (saturation < innerSaturation + 8) continue
      const length = Math.hypot(...chroma), innerLength = Math.hypot(...middle)
      const alignment = innerLength ? chroma.reduce((sum, value, i) => sum + value * middle[i], 0) / (length * innerLength) : 0
      // Blue/green/other coloured material continuing into the core is not evidence of contamination.
      if (innerSaturation >= 24 && alignment > .9) continue
      const referenceLight = luminance(middle[0], middle[1], middle[2])
      const delta = middle.map((value, channel) => value - referenceLight - chroma[channel])
      let amount = Math.min(mix, limit / Math.max(...delta.map(Math.abs)))
      for (let channel = 0; channel < 3; channel++) {
        if (delta[channel] > 0) amount = Math.min(amount, (255 - data[at + channel]) / delta[channel])
        else if (delta[channel] < 0) amount = Math.min(amount, -data[at + channel] / delta[channel])
      }
      for (let channel = 0; channel < 3; channel++) output[at + channel] = Math.round(data[at + channel] + delta[channel] * amount)
    }
  }
  cancelled(signal)
  return { width, height, data: output }
}
