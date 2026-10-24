import { normalizeStaticSvg, verifyNormalizedStaticSvg, STATIC_SVG_LIMITS, STATIC_SVG_PROCESSOR_ID, STATIC_SVG_PROCESSOR_VERSION, type NormalizedStaticSvg } from '../../../shared/ai/svg.js'
import { normalizePngChunks, inspectImageBytes } from '../../../shared/project/image-bytes.js'
import { sha256Bytes } from '../../../shared/validation/hash.js'
import { checkCancelled, type CancellationSignal } from '../../../shared/ports/resources.js'

export interface SvgRasterOptions { longEdgePx: number; signal?: CancellationSignal }
export interface SvgRasterResult {
  mimeType: 'image/png'
  pngBytes: Uint8Array
  sha256: string
  pixelWidth: number
  pixelHeight: number
  normalizedSha256: string
  processorId: typeof STATIC_SVG_PROCESSOR_ID
  processorVersion: typeof STATIC_SVG_PROCESSOR_VERSION
}

const checkAborted = checkCancelled

function checkedDimensions(width: number, height: number): void {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1
    || width > STATIC_SVG_LIMITS.rasterSide || height > STATIC_SVG_LIMITS.rasterSide
    || width * height > STATIC_SVG_LIMITS.rasterPixels) throw new Error('SVG输出尺寸超出像素保护预算。')
}

async function canvasPng(canvas: OffscreenCanvas | HTMLCanvasElement): Promise<Uint8Array> {
  let blob: Blob | null
  if ('convertToBlob' in canvas && typeof canvas.convertToBlob === 'function') blob = await canvas.convertToBlob({ type: 'image/png' })
  else blob = await new Promise<Blob | null>(resolve => (canvas as HTMLCanvasElement).toBlob(resolve, 'image/png'))
  if (!blob || blob.type !== 'image/png') throw new Error('浏览器无法生成有效PNG制品。')
  if (blob.size < 1 || blob.size > STATIC_SVG_LIMITS.rasterBytes) throw new Error('PNG制品字节超过20MiB保护预算。')
  return new Uint8Array(await blob.arrayBuffer())
}

function makeCanvas(width: number, height: number): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(width, height)
  if (typeof document === 'undefined') throw new Error('SVG栅格化需要OffscreenCanvas或浏览器Canvas。')
  const canvas = document.createElement('canvas')
  canvas.width = width; canvas.height = height
  return canvas
}

type Drawable = CanvasImageSource & { width?: number; height?: number; naturalWidth?: number; naturalHeight?: number; close?: () => void }

async function decodeWithImage(blob: Blob, width: number, height: number, signal?: CancellationSignal): Promise<{ image: Drawable; dispose: () => void }> {
  if (typeof Image !== 'function' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') throw new Error('当前浏览器不支持SVG图像回退解码。')
  const url = URL.createObjectURL(blob)
  const image = new Image()
  try {
    await new Promise<void>((resolve, reject) => {
      const nativeSignal = typeof AbortSignal === 'function' && signal instanceof AbortSignal ? signal : undefined
      const abort = () => { clear(); image.src = ''; reject(new DOMException('SVG栅格化已取消。', 'AbortError')) }
      const clear = () => { image.onload = null; image.onerror = null; nativeSignal?.removeEventListener('abort', abort) }
      image.onload = () => { clear(); resolve() }
      image.onerror = () => { clear(); reject(new Error('浏览器无法解码受限SVG。')) }
      nativeSignal?.addEventListener('abort', abort, { once: true })
      checkAborted(signal)
      image.src = url
    })
    checkAborted(signal)
    if (image.naturalWidth !== width || image.naturalHeight !== height) throw new Error('浏览器SVG图像尺寸与明确输出尺寸不一致。')
    return { image, dispose: () => URL.revokeObjectURL(url) }
  } catch (error) { URL.revokeObjectURL(url); throw error }
}

async function decodeSvg(blob: Blob, width: number, height: number, signal?: CancellationSignal): Promise<{ image: Drawable; dispose: () => void }> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(blob, { imageOrientation: 'none', premultiplyAlpha: 'default', colorSpaceConversion: 'default' })
      if (signal?.aborted) { bitmap.close(); checkAborted(signal) }
      if (bitmap.width !== width || bitmap.height !== height) { bitmap.close(); throw new Error('浏览器SVG解码尺寸与明确输出尺寸不一致。') }
      return { image: bitmap, dispose: () => bitmap.close() }
    } catch (error) {
      checkAborted(signal)
      // Chromium does not currently decode SVG Blob inputs through
      // createImageBitmap in every context. The fallback remains isolated: it
      // loads a bounded owned Blob URL into a detached Image, never application DOM.
      if (typeof Image !== 'function') throw error
    }
  }
  return decodeWithImage(blob, width, height, signal)
}

/**
 * Re-validates the closed normalized record, decodes it as an isolated image,
 * and emits actual PNG bytes. No SVG is inserted into the application DOM.
 */
export async function rasterizeNormalizedSvg(input: NormalizedStaticSvg, options: SvgRasterOptions): Promise<SvgRasterResult> {
  if (!Number.isSafeInteger(options.longEdgePx) || options.longEdgePx < 1 || options.longEdgePx > STATIC_SVG_LIMITS.rasterSide) throw new Error('SVG输出长边超出4096像素保护预算。')
  checkAborted(options.signal)
  const normalized = verifyNormalizedStaticSvg(input)
  const scale = options.longEdgePx / Math.max(normalized.viewBox.width, normalized.viewBox.height)
  const width = Math.max(1, Math.round(normalized.viewBox.width * scale)), height = Math.max(1, Math.round(normalized.viewBox.height * scale))
  checkedDimensions(width, height)
  // Inject only bounded decimal dimensions into the already-normalized root.
  // The SVG is supplied to the image decoder through an owned Blob, never DOM.
  const rasterSource = normalized.normalizedSource.replace(/^<svg\s/, `<svg height="${height}" width="${width}" `)
  if (rasterSource === normalized.normalizedSource) throw new Error('规范化SVG根节点无效。')
  const rasterCheck = normalizeStaticSvg(rasterSource)
  if (rasterCheck.normalizedSource !== normalized.normalizedSource) throw new Error('栅格化源与规范化SVG不一致。')
  const svgBlob = new Blob([rasterSource], { type: 'image/svg+xml;charset=utf-8' })
  let decoded: { image: Drawable; dispose: () => void } | undefined, canvas: OffscreenCanvas | HTMLCanvasElement | undefined, completed = false
  try {
    decoded = await decodeSvg(svgBlob, width, height, options.signal)
    checkAborted(options.signal)
    canvas = makeCanvas(width, height)
    const context = canvas.getContext('2d', { alpha: true, colorSpace: 'srgb' })
    if (!context) throw new Error('浏览器Canvas 2D上下文不可用。')
    context.clearRect(0, 0, width, height)
    context.drawImage(decoded.image, 0, 0, width, height)
    checkAborted(options.signal)
    const encoded = await canvasPng(canvas)
    checkAborted(options.signal)
    const pngBytes = normalizePngChunks(encoded)
    const header = inspectImageBytes(pngBytes)
    if (header.mimeType !== 'image/png' || header.width !== width || header.height !== height) throw new Error('实际PNG尺寸与输出预算不一致。')
    completed = true
    return Object.freeze({ mimeType: 'image/png', pngBytes, sha256: sha256Bytes(pngBytes), pixelWidth: header.width, pixelHeight: header.height,
      normalizedSha256: normalized.normalizedSha256, processorId: STATIC_SVG_PROCESSOR_ID, processorVersion: STATIC_SVG_PROCESSOR_VERSION })
  } finally {
    decoded?.dispose()
    if (canvas) { canvas.width = 0; canvas.height = 0 }
    if (!completed) checkAborted(options.signal)
  }
}
