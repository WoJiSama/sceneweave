import type { AssetRecord } from '../../../shared/model/project.js'
import type { CancellationSignal, ImageProcessingPort, RasterImage, ResourceOptions } from '../../../shared/ports/resources.js'
import { checkCancelled, ImageCapabilityError } from '../../../shared/ports/resources.js'
import { captureBytes, sha256Bytes } from '../../../shared/project/binary.js'
import { inspectImageBytes, normalizePngChunks, type ImageHeader } from '../../../shared/project/image-bytes.js'
import { transformRgba } from '../../../shared/project/pixels.js'
import { PACKAGE_LIMITS } from '../../../shared/project/limits.js'

// Every native-v1 adapter instance shares this slot. No decoded bitmap or Canvas survives it.
let imageQueue: Promise<void> = Promise.resolve()
async function withImageSlot<T>(signal: CancellationSignal | undefined, action: () => Promise<T> | T): Promise<T> {
  checkCancelled(signal)
  const previous = imageQueue
  let release!: () => void
  imageQueue = new Promise<void>(resolve => { release = resolve })
  await previous
  try { checkCancelled(signal); return await action() }
  finally { release() }
}

function validateDimensions(width: number, height: number): void {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1
    || width > PACKAGE_LIMITS.imageSide || height > PACKAGE_LIMITS.imageSide
    || width * height > PACKAGE_LIMITS.imagePixels) throw new Error('位图尺寸或像素超过候选保护值。')
}

function captureRaster(image: RasterImage): RasterImage {
  validateDimensions(image.width, image.height)
  if (!(image.rgba instanceof Uint8ClampedArray) || image.rgba.length !== image.width * image.height * 4) throw new Error('RGBA像素长度与尺寸不匹配。')
  return { width: image.width, height: image.height, rgba: image.rgba.slice() }
}

function canvasFor(width: number, height: number) {
  validateDimensions(width, height)
  if (typeof document === 'undefined') throw new ImageCapabilityError()
  const canvas = document.createElement('canvas')
  canvas.width = width; canvas.height = height
  try {
    const context = canvas.getContext('2d', { colorSpace: 'srgb', willReadFrequently: true })
    if (!context) throw new ImageCapabilityError()
    return { canvas, context }
  } catch (error) { canvas.width = 0; canvas.height = 0; throw error }
}

function placeRaster(image: RasterImage) {
  const { canvas, context } = canvasFor(image.width, image.height)
  try {
    const data = context.createImageData(image.width, image.height)
    data.data.set(image.rgba)
    context.putImageData(data, 0, 0)
    return { canvas, context }
  } catch (error) { canvas.width = 0; canvas.height = 0; throw error }
}

async function withDecodedRaster<T>(bytes: Uint8Array, header: ImageHeader, signal: CancellationSignal | undefined,
  allowOrientedDimensions: boolean, action: (image: RasterImage) => Promise<T> | T): Promise<T> {
  return withImageSlot(signal, async () => {
    let bitmap: ImageBitmap | undefined
    try {
      checkCancelled(signal)
      if (typeof createImageBitmap !== 'function') throw new ImageCapabilityError()
      const blob = new Blob([bytes.slice().buffer], { type: header.mimeType })
      try { bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image', colorSpaceConversion: 'default', premultiplyAlpha: 'none' }) }
      catch { checkCancelled(signal); throw new Error('位图实际解码失败。') }
      checkCancelled(signal)
      validateDimensions(bitmap.width, bitmap.height)
      if (!(bitmap.width === header.width && bitmap.height === header.height)
        && !(allowOrientedDimensions && bitmap.width === header.height && bitmap.height === header.width)) throw new Error('实际解码尺寸与位图记录不一致。')
      const { canvas, context } = canvasFor(bitmap.width, bitmap.height)
      let image: RasterImage
      try {
        context.drawImage(bitmap, 0, 0)
        image = { width: bitmap.width, height: bitmap.height, rgba: context.getImageData(0, 0, bitmap.width, bitmap.height).data.slice() }
      } finally { canvas.width = 0; canvas.height = 0 }
      bitmap.close(); bitmap = undefined
      checkCancelled(signal)
      return await action(image)
    } finally { bitmap?.close() }
  })
}

async function encodeCanvasPng(canvas: HTMLCanvasElement, signal?: CancellationSignal): Promise<Uint8Array> {
  checkCancelled(signal)
  let blob: Blob
  try {
    blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(value => value ? resolve(value) : reject(new Error('位图PNG编码失败。')), 'image/png')
    })
  } catch (error) { checkCancelled(signal); throw error }
  checkCancelled(signal)
  if (!blob.size || blob.size > PACKAGE_LIMITS.imageBytes) throw new Error('规范化PNG超过20MiB或为空。')
  const bytes = new Uint8Array(await blob.arrayBuffer())
  checkCancelled(signal)
  const adopted = normalizePngChunks(bytes), header = inspectImageBytes(adopted)
  if (header.mimeType !== 'image/png' || header.width !== canvas.width || header.height !== canvas.height) throw new Error('规范化PNG与实际画布尺寸不一致。')
  checkCancelled(signal)
  return adopted
}

/** Actual browser pixels, without a persistent bitmap/pixel cache or a trust flag. */
export function createBrowserImagePort(): ImageProcessingPort {
  return {
    async decode(input, record, options = {}) {
      checkCancelled(options.signal)
      const bytes = captureBytes(input, PACKAGE_LIMITS.imageBytes), header = inspectImageBytes(bytes)
      if (record.sizeBytes !== bytes.length || record.mimeType !== header.mimeType
        || record.pixelWidth !== header.width || record.pixelHeight !== header.height) throw new Error('位图实际类型、字节数或头部尺寸与记录不一致。')
      return withDecodedRaster(bytes, header, options.signal, false, image => image)
    },
    async transform(input, parameters, options = {}) {
      checkCancelled(options.signal)
      const image = captureRaster(input)
      const pixels = transformRgba(image.rgba, parameters.tint, parameters.brightness)
      return withImageSlot(options.signal, () => {
        const { canvas, context } = placeRaster({ ...image, rgba: pixels })
        try {
          // Canvas alpha premultiplication/rounding is part of the established fixed variant contract.
          const result = { width: image.width, height: image.height, rgba: context.getImageData(0, 0, image.width, image.height).data.slice() }
          checkCancelled(options.signal)
          return result
        } finally { canvas.width = 0; canvas.height = 0 }
      })
    },
    async encodePng(input, options = {}) {
      checkCancelled(options.signal)
      const image = captureRaster(input)
      return withImageSlot(options.signal, async () => {
        const { canvas } = placeRaster(image)
        try { return await encodeCanvasPng(canvas, options.signal) }
        finally { canvas.width = 0; canvas.height = 0 }
      })
    },
  }
}

/** Raw external PNG/JPEG/WebP metadata is decoded once and never adopted into the project. */
export async function normalizeBrowserImage(input: Uint8Array, declaredMime = '', options: ResourceOptions = {}): Promise<{ record: AssetRecord; bytes: Uint8Array }> {
  checkCancelled(options.signal)
  const bytes = captureBytes(input, PACKAGE_LIMITS.imageBytes), header = inspectImageBytes(bytes, false)
  if (declaredMime && declaredMime !== 'application/octet-stream' && declaredMime !== header.mimeType) throw new Error('图片声明MIME与实际格式不一致。')
  return withDecodedRaster(bytes, header, options.signal, true, async image => {
    const { canvas } = placeRaster(image)
    try {
      const adopted = await encodeCanvasPng(canvas, options.signal), checked = inspectImageBytes(adopted)
      const record: AssetRecord = { sha256: sha256Bytes(adopted), mimeType: 'image/png', sizeBytes: adopted.length, pixelWidth: checked.width, pixelHeight: checked.height }
      checkCancelled(options.signal)
      return { record, bytes: adopted }
    } finally { canvas.width = 0; canvas.height = 0 }
  })
}
