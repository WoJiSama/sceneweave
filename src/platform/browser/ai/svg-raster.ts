import { initWasm, Resvg } from '@resvg/resvg-wasm'
import wasmUrl from '@resvg/resvg-wasm/index_bg.wasm?url'
import { CANONICAL_SVG_PROCESSOR, STATIC_SVG_LIMITS, verifyNormalizedStaticSvg, type NormalizedStaticSvg, type CanonicalSvgProcessor } from '../../../shared/ai/svg.js'
import { sha256Bytes } from '../../../shared/validation/hash.js'
import { captureBytes } from '../../../shared/project/binary.js'
import { checkCancelled, type CancellationSignal, type RasterImage } from '../../../shared/ports/resources.js'
import { decodeCanonicalPng, encodeCanonicalPng } from '../../../shared/project/png-rgba.js'

export interface SvgRasterOptions { longEdgePx: number; signal?: CancellationSignal }
export type SvgRasterResult = CanonicalSvgProcessor & {
  mimeType: 'image/png'; pngBytes: Uint8Array; sha256: string
  pixelWidth: number; pixelHeight: number; normalizedSha256: string
}
const wasmByteLength = 2_478_606
let initialized: Promise<void> | undefined

/** A bounded owned module must match the immutable profile before execution. */
export function initializeCanonicalSvgRasterizer(input: Uint8Array): Promise<void> {
  const bytes = captureBytes(input, wasmByteLength)
  if (bytes.length !== wasmByteLength) throw new Error('固定SVG栅格器模块长度不符。')
  if (sha256Bytes(bytes) !== CANONICAL_SVG_PROCESSOR.rasterizer.moduleSha256) throw new Error('固定SVG栅格器模块SHA256不符。')
  if (!initialized) initialized = initWasm(bytes).catch(error => { initialized = undefined; throw error })
  return initialized
}
let loading: Promise<void> | undefined
async function ensureRasterizer(): Promise<void> {
  if (initialized) return initialized
  if (!loading) loading = (async () => {
    const response = await fetch(wasmUrl)
    if (!response.ok) throw new Error('固定SVG栅格器模块无法载入。')
    // The module is a bundled same-origin application asset, never a project URL.
    const declared = response.headers.get('content-length')
    if (declared && Number(declared) > wasmByteLength) throw new Error('固定SVG栅格器模块超过保护大小。')
    if (!response.body) throw new Error('固定SVG栅格器模块为空。')
    const reader = response.body.getReader(), bytes = new Uint8Array(wasmByteLength)
    let length = 0
    try {
      while (true) {
        const part = await reader.read()
        if (part.done) break
        if (length + part.value.length > wasmByteLength) { await reader.cancel(); throw new Error('固定SVG栅格器模块超过保护大小。') }
        bytes.set(part.value, length); length += part.value.length
      }
    } finally { reader.releaseLock() }
    await initializeCanonicalSvgRasterizer(bytes.subarray(0, length))
  })().finally(() => { loading = undefined })
  return loading
}

/** Fixed WASM SVG rasterization and software PNG readback; no native image APIs. */
export async function rasterizeCanonicalSvgPixels(input: NormalizedStaticSvg, dimensions: { width: number; height: number }, signal?: CancellationSignal): Promise<RasterImage> {
  checkCancelled(signal)
  const normalized = verifyNormalizedStaticSvg(input), { width, height } = dimensions
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1
    || width > STATIC_SVG_LIMITS.rasterSide || height > STATIC_SVG_LIMITS.rasterSide
    || width * height > STATIC_SVG_LIMITS.rasterPixels) throw new Error('SVG输出尺寸超出像素保护预算。')
  const scale = Math.max(width, height) / Math.max(normalized.viewBox.width, normalized.viewBox.height)
  if (Math.max(1, Math.round(normalized.viewBox.width * scale)) !== width || Math.max(1, Math.round(normalized.viewBox.height * scale)) !== height) throw new Error('SVG PNG尺寸必须保持规范化viewBox比例。')
  await ensureRasterizer(); checkCancelled(signal)
  const source = normalized.normalizedSource.replace(/^<svg\s/, `<svg height="${height}" width="${width}" `)
  const renderer = new Resvg(source, { fitTo: { mode: 'original' }, dpi: 96,
    font: { fontBuffers: [] }, shapeRendering: 2, textRendering: 2, imageRendering: 0 })
  try {
    if (renderer.width !== width || renderer.height !== height || renderer.imagesToResolve().length) throw new Error('固定SVG栅格器尺寸或外部资源不符。')
    const rendered = renderer.render()
    try {
      checkCancelled(signal)
      // Independently decode the actual PNG, including its RGBA8/noninterlaced
      // contract. The browser's image decoder never defines canonical pixels.
      const image = decodeCanonicalPng(rendered.asPng())
      if (image.width !== width || image.height !== height) throw new Error('固定SVG实际PNG尺寸不符。')
      checkCancelled(signal)
      return image
    } finally { rendered.free() }
  } finally { renderer.free() }
}

export async function rasterizeNormalizedSvg(input: NormalizedStaticSvg, options: SvgRasterOptions): Promise<SvgRasterResult> {
  if (!Number.isSafeInteger(options.longEdgePx) || options.longEdgePx < 1 || options.longEdgePx > STATIC_SVG_LIMITS.rasterSide) throw new Error('SVG输出长边超出4096像素保护预算。')
  checkCancelled(options.signal)
  const normalized = verifyNormalizedStaticSvg(input), scale = options.longEdgePx / Math.max(normalized.viewBox.width, normalized.viewBox.height)
  const image = await rasterizeCanonicalSvgPixels(normalized, { width: Math.max(1, Math.round(normalized.viewBox.width * scale)), height: Math.max(1, Math.round(normalized.viewBox.height * scale)) }, options.signal)
  const pngBytes = encodeCanonicalPng(image)
  checkCancelled(options.signal)
  return Object.freeze({ ...CANONICAL_SVG_PROCESSOR, mimeType: 'image/png', pngBytes, sha256: sha256Bytes(pngBytes),
    pixelWidth: image.width, pixelHeight: image.height, normalizedSha256: normalized.normalizedSha256 })
}
