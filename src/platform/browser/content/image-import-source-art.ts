import type { CompleteValidationOptions } from '../../../shared/ports/resources.js'
import type { ImagePoint } from '../../../shared/image-import/calibration.js'
import { imagePolygonMask } from '../../../shared/image-import/pixels.js'
import { sha256Bytes } from '../../../shared/validation/hash.js'
import type { ImageImportRaster } from './image-import-project.js'

export const SOURCE_BUILDING_ART_ID = 'image-import-source-building-art'

/** Preserve only the original artwork beyond the physical room boundary.
 * This is derived from the repaired floor, never a flattened furniture layer.
 * Native wall thickness remains physical geometry, independent of drawn ink. */
export async function prepareSourceBuildingArt(floor: ImageImportRaster, roomBoundaryPx: ImagePoint[],
  capabilities: CompleteValidationOptions, signal?: AbortSignal): Promise<ImageImportRaster> {
  signal?.throwIfAborted()
  const decoded = await capabilities.images.decode(floor.pngBytes, { sha256: sha256Bytes(floor.pngBytes), mimeType: 'image/png',
    sizeBytes: floor.pngBytes.length, pixelWidth: floor.pixelWidth, pixelHeight: floor.pixelHeight }, { signal })
  if (decoded.width !== floor.pixelWidth || decoded.height !== floor.pixelHeight) throw new Error('原图墙沿解码尺寸不一致。')
  const points = roomBoundaryPx.map(point => ({ x: (point.x - floor.boundsPx.x) * decoded.width / floor.boundsPx.width,
    y: (point.y - floor.boundsPx.y) * decoded.height / floor.boundsPx.height }))
  const mask = imagePolygonMask({ width: decoded.width, height: decoded.height, data: decoded.rgba }, points)
  const rgba = decoded.rgba.slice()
  for (let y = 0; y < mask.height; y++) for (let x = 0; x < mask.width; x++) if (mask.data[y * mask.width + x] === 255) {
    const index = ((y + mask.boundsPx.y) * decoded.width + x + mask.boundsPx.x) * 4
    rgba.fill(0, index, index + 4)
  }
  signal?.throwIfAborted()
  const pngBytes = await capabilities.images.encodePng({ width: decoded.width, height: decoded.height, rgba }, { signal })
  signal?.throwIfAborted()
  return { pngBytes, pixelWidth: decoded.width, pixelHeight: decoded.height, boundsPx: { ...floor.boundsPx } }
}
