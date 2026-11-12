import type { SvgProcessingPort } from '../../../shared/ports/resources.js'
import { checkCancelled } from '../../../shared/ports/resources.js'
import { CANONICAL_SVG_PROCESSOR, LEGACY_SVG_PROCESSOR } from '../../../shared/ai/svg.js'
import { createBrowserImagePort } from '../images/index.js'
import { rasterizeCanonicalSvgInWorker } from './svg-worker-client.js'
import { rasterizeLegacyNormalizedSvg } from './svg-raster-legacy.js'

/** Actual isolated SVG -> PNG -> pixels; no persistent image or DOM SVG. */
export function createBrowserSvgPort(): SvgProcessingPort {
  return {
    processor: CANONICAL_SVG_PROCESSOR,
    validationConcurrency: 2,
    rasterize(source, dimensions, options = {}) { return rasterizeCanonicalSvgInWorker(source, dimensions, options.signal) },
  }
}

/** Explicit legacy recovery only. Success still requires exact original pixels. */
export function createLegacyBrowserSvgPort(): SvgProcessingPort {
  const images = createBrowserImagePort()
  return {
    processor: LEGACY_SVG_PROCESSOR,
    validationConcurrency: 2,
    async rasterize(source, dimensions, options = {}) {
      checkCancelled(options.signal)
      const output = await rasterizeLegacyNormalizedSvg(source, { longEdgePx: Math.max(dimensions.width, dimensions.height), signal: options.signal })
      if (output.pixelWidth !== dimensions.width || output.pixelHeight !== dimensions.height) throw new Error('SVG PNG尺寸必须保持规范化viewBox比例。')
      checkCancelled(options.signal)
      return images.decode(output.pngBytes, { sha256: output.sha256, mimeType: output.mimeType, sizeBytes: output.pngBytes.length,
        pixelWidth: output.pixelWidth, pixelHeight: output.pixelHeight }, options)
    },
  }
}
