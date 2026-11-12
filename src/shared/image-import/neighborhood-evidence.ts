import type { ImagePixelMask, ImagePixels, PixelBounds } from './pixels.js'
import type { ImageReplayLayer } from './layer-replay.js'
import { decodeSelectionMask } from './selection-mask.js'

export interface ImageNeighborhoodSignal { readonly aborted: boolean; throwIfAborted(): void }

/** Later object silhouettes are still present. Ground items can be the material being
 * repaired (for example the rug below a chair), so their surface is explicitly chosen. */
export function imageNeighborhoodObjectEvidence(image: ImagePixels, layers: readonly ImageReplayLayer[]): ImagePixelMask[] {
  return layers.filter(layer => layer.renderLayer !== 'ground').flatMap(layer => {
    const explicit = [layer.removalMask, layer.selectionMask].filter(value => value !== undefined)
    if (explicit.length) return explicit.map(mask => decodeSelectionMask(mask, image))
    // A rough outline/guide has no confirmed silhouette. Conservatively exclude its
    // entire bounds instead of trusting RGB between unconfirmed outline vertices.
    const guide = layer.guidedSelection?.bounds
    const x = Math.max(0, Math.floor(Math.min(...layer.polygon.map(p => p.x), guide?.x ?? image.width)))
    const y = Math.max(0, Math.floor(Math.min(...layer.polygon.map(p => p.y), guide?.y ?? image.height)))
    const right = Math.min(image.width, Math.ceil(Math.max(...layer.polygon.map(p => p.x), guide ? guide.x + guide.width : 0)))
    const bottom = Math.min(image.height, Math.ceil(Math.max(...layer.polygon.map(p => p.y), guide ? guide.y + guide.height : 0)))
    const width = right - x, height = bottom - y
    if (width < 1 || height < 1 || width * height > 1_000_000) throw new Error('未确认物件的取证排除框无效或超过100万像素，请收窄范围。')
    return [{ width, height, boundsPx: { x, y, width, height }, data: new Uint8Array(width * height).fill(255) }]
  })
}

/** Temporary union is clipped to the bounded declared surface; never serialized as a
 * larger replacement mask and never changes a user's protection/write permission. */
export function imageNeighborhoodExcludedEvidence(bounds: PixelBounds, masks: readonly (ImagePixelMask | undefined)[]): ImagePixelMask | undefined {
  if (!masks.some(Boolean)) return undefined
  const data = new Uint8Array(bounds.width * bounds.height)
  for (const mask of masks) if (mask) {
    const x0 = Math.max(bounds.x, mask.boundsPx.x), y0 = Math.max(bounds.y, mask.boundsPx.y)
    const x1 = Math.min(bounds.x + bounds.width, mask.boundsPx.x + mask.width), y1 = Math.min(bounds.y + bounds.height, mask.boundsPx.y + mask.height)
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      if (mask.data[(y - mask.boundsPx.y) * mask.width + x - mask.boundsPx.x]) data[(y - bounds.y) * bounds.width + x - bounds.x] = 255
    }
  }
  return { width: bounds.width, height: bounds.height, boundsPx: { ...bounds }, data }
}
