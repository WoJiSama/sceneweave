import type { SvgProcessingPort } from '../../../shared/ports/resources.js'
import { checkCancelled } from '../../../shared/ports/resources.js'
import { CANONICAL_SVG_PROCESSOR, LEGACY_SVG_PROCESSOR } from '../../../shared/ai/svg.js'
import { createBrowserImagePort } from '../images/index.js'

/** Actual isolated SVG -> PNG -> pixels; no persistent image or DOM SVG. */
export function createBrowserSvgPort(): SvgProcessingPort {
  return {
    processor: CANONICAL_SVG_PROCESSOR,
    validationConcurrency: 2,
    async rasterize(source, dimensions, { signal } = {}) {
      checkCancelled(signal)
      const { rasterizeCanonicalSvgInWorker } = await import('./svg-worker-client.js')
      return rasterizeCanonicalSvgInWorker(source, dimensions, signal)
    },
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
      const { rasterizeLegacyNormalizedSvg } = await import('./svg-raster-legacy.js')
      const output = await rasterizeLegacyNormalizedSvg(source, { longEdgePx: Math.max(dimensions.width, dimensions.height), signal: options.signal })
      if (output.pixelWidth !== dimensions.width || output.pixelHeight !== dimensions.height) throw new Error('SVG PNG尺寸必须保持规范化viewBox比例。')
      checkCancelled(options.signal)
      return images.decode(output.pngBytes, { sha256: output.sha256, mimeType: output.mimeType, sizeBytes: output.pngBytes.length,
        pixelWidth: output.pixelWidth, pixelHeight: output.pixelHeight }, options)
    },
  }
}
