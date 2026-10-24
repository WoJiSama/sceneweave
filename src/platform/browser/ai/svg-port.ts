import type { SvgProcessingPort } from '../../../shared/ports/resources.js'
import { checkCancelled } from '../../../shared/ports/resources.js'
import { createBrowserImagePort } from '../images/index.js'
import { rasterizeNormalizedSvg } from './svg-raster.js'

/** Actual isolated SVG -> PNG -> pixels; no persistent image or DOM SVG. */
export function createBrowserSvgPort(): SvgProcessingPort {
  const images = createBrowserImagePort()
  return {
    async rasterize(source, dimensions, options = {}) {
      checkCancelled(options.signal)
      const output = await rasterizeNormalizedSvg(source, { longEdgePx: Math.max(dimensions.width, dimensions.height), signal: options.signal })
      if (output.pixelWidth !== dimensions.width || output.pixelHeight !== dimensions.height) throw new Error('SVG PNG尺寸必须保持规范化viewBox比例。')
      checkCancelled(options.signal)
      return images.decode(output.pngBytes, { sha256: output.sha256, mimeType: output.mimeType, sizeBytes: output.pngBytes.length,
        pixelWidth: output.pixelWidth, pixelHeight: output.pixelHeight }, options)
    },
  }
}
