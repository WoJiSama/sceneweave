import { normalizeStaticSvg, STATIC_SVG_LIMITS } from '../../../shared/ai/svg.js'
import { inspectImageBytes, type ImageHeader } from '../../../shared/project/image-bytes.js'
import { PACKAGE_LIMITS } from '../../../shared/project/limits.js'
import { WeightedTaskQueue } from '../../../shared/project/task-queue.js'

// Rapid file reselection cannot leave several large native decodes active.
const hints = new WeightedTaskQueue(1, 16_000_000)

/** Calibration only. Native oriented dimensions are not a resource-validation proof. */
export async function assetImageDimensions(file: Blob): Promise<{ width: number; height: number }> {
  const size = Object.getOwnPropertyDescriptor(Blob.prototype, 'size')!.get!.call(file) as number
  if (!size || size > 20 * 1024 * 1024) throw new Error('单项素材须非空且不超过20 MiB。')
  const copy = Blob.prototype.slice.call(file, 0, size)
  const bytes = new Uint8Array(await Blob.prototype.arrayBuffer.call(copy))
  let header: ImageHeader
  try { header = inspectImageBytes(bytes, false) }
  catch (imageError) {
    if (bytes.length > STATIC_SVG_LIMITS.sourceBytes) throw imageError
    let source: string
    try { source = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes) } catch { throw imageError }
    if (!/^\s*(?:<\?xml[^>]*>\s*)?<svg[\s>]/i.test(source)) throw imageError
    const svg = normalizeStaticSvg(source)
    return { width: svg.viewBox.width, height: svg.viewBox.height }
  }
  // Header inspection bounds format, side and pixel count before native decode.
  return hints.run(header.width * header.height, undefined, async () => {
    if (typeof createImageBitmap !== 'function') throw new Error('当前环境不能读取实际图片方向；请在规范预览后核对尺寸。')
    let bitmap: ImageBitmap | undefined
    try {
      try { bitmap = await createImageBitmap(Blob.prototype.slice.call(copy, 0, size, header.mimeType), {
        imageOrientation: 'from-image', colorSpaceConversion: 'default', premultiplyAlpha: 'none',
      }) } catch { throw new Error('图片实际解码失败，无法读取比例。') }
      const { width, height } = bitmap
      if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1
        || width > PACKAGE_LIMITS.imageSide || height > PACKAGE_LIMITS.imageSide || width * height > PACKAGE_LIMITS.imagePixels
        || !(width === header.width && height === header.height || width === header.height && height === header.width)) throw new Error('图片实际方向或尺寸与来源头部不一致。')
      return { width, height }
    } finally { bitmap?.close() }
  })
}
