import { initializeCanonicalSvgRasterizer, rasterizeCanonicalSvgPixels } from './svg-raster.js'
import type { NormalizedStaticSvg } from '../../../shared/ai/svg.js'

export interface CanonicalSvgWorkerRequest {
  source: NormalizedStaticSvg
  dimensions: { width: number; height: number }
  moduleBytes?: Uint8Array<ArrayBuffer>
  output?: 'verified-png' | 'paint-layer'
}

// Bundled application worker. It returns pixels only; all project/permission,
// byte closure and expected-PNG checks remain with the calling validator.
self.onmessage = async (event: MessageEvent<CanonicalSvgWorkerRequest>) => {
  try {
    const { source, dimensions, moduleBytes, output } = event.data
    if (moduleBytes) await initializeCanonicalSvgRasterizer(moduleBytes)
    const image = await rasterizeCanonicalSvgPixels(source, dimensions, undefined, output)
    self.postMessage({ ok: true, width: image.width, height: image.height, rgba: image.rgba }, { transfer: [image.rgba.buffer] })
  } catch (error) {
    self.postMessage({ ok: false, message: error instanceof Error ? error.message : '固定SVG后台栅格化失败。' })
  }
}
