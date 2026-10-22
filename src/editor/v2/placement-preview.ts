import { checkCancelled, hasExactKeys, isSha256, PROJECT_LIMITS_V2 } from '../../io/v2/limits'
import { inspectImageBytes, sha256Bytes, withImageDecoderSlotV2 } from '../../io/v2/resources'
import type { CompleteProjectV2 } from '../../io/v2/types'

/** Verify each disposable preview decode; the caller owns close() only after success. */
export async function decodePlacementPreviewV2(project: Pick<CompleteProjectV2, 'assets'> & { document: Pick<CompleteProjectV2['document'], 'assets'> }, assetId: string, signal?: AbortSignal): Promise<ImageBitmap> {
  checkCancelled(signal)
  const ref = Object.hasOwn(project.document.assets, assetId) ? project.document.assets[assetId] : undefined
  const resource = ref && Object.hasOwn(project.assets, ref.sha256) ? project.assets[ref.sha256] : undefined
  if (!ref || !resource || !(resource.blob instanceof Blob)) throw new Error(`放置预览所需素材 ${assetId} 缺失。`)
  // Capture primitive metadata and the immutable Blob before asynchronous reads/queueing.
  const { sha256, mimeType, pixelWidth, pixelHeight } = ref, blob = resource.blob
  if (ref.id !== assetId || !isSha256(sha256)
    || !hasExactKeys(resource, ['sha256', 'blob', 'mimeType', 'sizeBytes', 'pixelWidth', 'pixelHeight'])
    || resource.sha256 !== sha256 || resource.mimeType !== mimeType || resource.pixelWidth !== pixelWidth || resource.pixelHeight !== pixelHeight
    || blob.size !== resource.sizeBytes || blob.type && blob.type !== mimeType) throw new Error(`素材 ${assetId} 的字节记录与工程不一致。`)
  if (!Number.isSafeInteger(resource.sizeBytes) || resource.sizeBytes < 1 || resource.sizeBytes > PROJECT_LIMITS_V2.imageBytes
    || !Number.isSafeInteger(pixelWidth) || !Number.isSafeInteger(pixelHeight) || pixelWidth < 1 || pixelHeight < 1
    || pixelWidth > PROJECT_LIMITS_V2.imageSide || pixelHeight > PROJECT_LIMITS_V2.imageSide
    || pixelWidth * pixelHeight > PROJECT_LIMITS_V2.imagePixels) throw new Error(`素材 ${assetId} 超过单图预览预算。`)
  const bytes = new Uint8Array(await blob.arrayBuffer())
  checkCancelled(signal)
  const header = inspectImageBytes(bytes)
  if (header.mimeType !== mimeType || header.width !== pixelWidth || header.height !== pixelHeight
    || await sha256Bytes(bytes) !== sha256) throw new Error(`素材 ${assetId} 的实际格式、尺寸或 hash 不匹配。`)
  checkCancelled(signal)

  let bitmap: ImageBitmap
  try {
    bitmap = await withImageDecoderSlotV2(signal, async () => {
      if (typeof createImageBitmap !== 'function') throw new Error('当前环境缺少真实位图解码能力。')
      return createImageBitmap(blob, { imageOrientation: 'from-image', colorSpaceConversion: 'default', premultiplyAlpha: 'default' })
    })
  } catch {
    checkCancelled(signal)
    throw new Error(`素材 ${assetId} 实际解码失败，无法显示放置预览。`)
  }
  try {
    checkCancelled(signal)
    if (bitmap.width !== pixelWidth || bitmap.height !== pixelHeight) throw new Error(`素材 ${assetId} 的实际解码尺寸不符。`)
    return bitmap
  } catch (error) {
    bitmap.close()
    throw error
  }
}
