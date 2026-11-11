import { normalizeStaticSvg, STATIC_SVG_LIMITS } from '../../../shared/ai/svg.js'
import type { SvgAuthoringSource } from '../../../shared/model/project.js'
import { encodeUtf8 } from '../../../shared/validation/json.js'
import { rasterizeNormalizedSvg } from '../ai/svg-raster.js'

export const IMAGE_IMPORT_VECTOR_LONG_EDGE = 2048
export interface MaterializedImageImportSvg {
  pngBytes: Uint8Array
  pixelWidth: number
  pixelHeight: number
  sha256: string
  authoringSource: SvgAuthoringSource
  resourceBytes: Map<string, Uint8Array>
}

/** Always derives canonical PNG bytes from the safe source, never a caller-supplied raster. */
export async function materializeImageImportSvg(sourceSvg: string, targetLongEdgePx = IMAGE_IMPORT_VECTOR_LONG_EDGE,
  signal?: AbortSignal): Promise<MaterializedImageImportSvg> {
  signal?.throwIfAborted()
  if (!Number.isSafeInteger(targetLongEdgePx) || targetLongEdgePx < 1 || targetLongEdgePx > STATIC_SVG_LIMITS.rasterSide) throw new Error('矢量输出长边须为1–4096像素。')
  const normalized = normalizeStaticSvg(sourceSvg), output = await rasterizeNormalizedSvg(normalized, { longEdgePx: targetLongEdgePx, signal })
  signal?.throwIfAborted()
  return { pngBytes: output.pngBytes, pixelWidth: output.pixelWidth, pixelHeight: output.pixelHeight, sha256: output.sha256,
    authoringSource: { kind: 'svg', sourceSha256: normalized.sourceSha256, normalizedSha256: normalized.normalizedSha256,
      sourceSizeBytes: normalized.sourceSizeBytes, normalizedSizeBytes: normalized.normalizedSizeBytes, rasterSha256: output.sha256,
      processorId: output.processorId, processorVersion: output.processorVersion, rasterizer: output.rasterizer, pixelFormat: output.pixelFormat },
    resourceBytes: new Map([[output.sha256, output.pngBytes], [normalized.sourceSha256, encodeUtf8(normalized.sourceSvg)],
      [normalized.normalizedSha256, encodeUtf8(normalized.normalizedSource)]]) }
}
