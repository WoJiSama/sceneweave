import { rasterizeCanonicalSvgPixels } from './svg-raster.js'
import type { NormalizedStaticSvg } from '../../../shared/ai/svg.js'

// Bundled application worker. It returns pixels only; all project/permission,
// byte closure and expected-PNG checks remain with the calling validator.
self.onmessage = async (event: MessageEvent<{ source: NormalizedStaticSvg; dimensions: { width: number; height: number } }>) => {
  try {
    const image = await rasterizeCanonicalSvgPixels(event.data.source, event.data.dimensions)
    self.postMessage({ ok: true, width: image.width, height: image.height, rgba: image.rgba }, { transfer: [image.rgba.buffer] })
  } catch (error) {
    self.postMessage({ ok: false, message: error instanceof Error ? error.message : '固定SVG后台栅格化失败。' })
  }
}
