import type { EditableProject } from '../../application/workspace/project'
import { checkCancelled } from '../../shared/ports/resources.js'
import { PACKAGE_LIMITS } from '../../shared/project/limits.js'
import { inspectImageBytes } from '../../shared/project/image-bytes.js'
import { captureBytes, sha256Bytes } from '../../shared/project/binary.js'
import { withRenderDecoderSlot } from '../../platform/browser/render/image-decoder'

/** The one placement preview owns its returned bitmap, independently of the persisted source bytes. */
export async function decodePlacementPreviewV2(project: Pick<EditableProject, 'assets' | 'document' | 'resources'>, assetId: string, signal?: AbortSignal): Promise<ImageBitmap> {
  checkCancelled(signal)
  const ref = Object.hasOwn(project.document.assets, assetId) ? { ...project.document.assets[assetId] } : undefined
  const resource = ref && Object.hasOwn(project.assets, ref.sha256) ? { ...project.assets[ref.sha256] } : undefined
  const read = project.resources.read.bind(project.resources)
  if (!ref || !resource) throw new Error(`放置预览所需素材 ${assetId} 缺失。`)
  if (ref.id !== assetId || ref.sha256 !== resource.sha256 || ref.mimeType !== resource.mimeType || ref.pixelWidth !== resource.pixelWidth || ref.pixelHeight !== resource.pixelHeight) throw new Error(`素材 ${assetId} 的字节记录与工程不一致。`)
  if (!Number.isSafeInteger(resource.sizeBytes) || resource.sizeBytes < 1 || resource.sizeBytes > PACKAGE_LIMITS.imageBytes
    || !Number.isSafeInteger(ref.pixelWidth) || !Number.isSafeInteger(ref.pixelHeight) || ref.pixelWidth < 1 || ref.pixelHeight < 1
    || ref.pixelWidth > PACKAGE_LIMITS.imageSide || ref.pixelHeight > PACKAGE_LIMITS.imageSide || ref.pixelWidth * ref.pixelHeight > PACKAGE_LIMITS.imagePixels) throw new Error(`素材 ${assetId} 超过单图预览预算。`)
  const bytes = captureBytes(await read(ref.sha256), resource.sizeBytes)
  checkCancelled(signal)
  const header = inspectImageBytes(bytes)
  if (bytes.length !== resource.sizeBytes || header.mimeType !== ref.mimeType || header.width !== ref.pixelWidth || header.height !== ref.pixelHeight || sha256Bytes(bytes) !== ref.sha256) throw new Error(`素材 ${assetId} 的实际格式、尺寸或 hash 不匹配。`)
  let bitmap: ImageBitmap
  try {
    bitmap = await withRenderDecoderSlot(signal, async () => {
      if (typeof createImageBitmap !== 'function') throw new Error('当前环境缺少真实位图解码能力。')
      return createImageBitmap(new Blob([bytes.slice().buffer], { type: resource.mimeType }), { imageOrientation: 'from-image', colorSpaceConversion: 'default', premultiplyAlpha: 'default' })
    })
  } catch { checkCancelled(signal); throw new Error(`素材 ${assetId} 实际解码失败，无法显示放置预览。`) }
  try {
    checkCancelled(signal)
    if (bitmap.width !== ref.pixelWidth || bitmap.height !== ref.pixelHeight) throw new Error(`素材 ${assetId} 的实际解码尺寸不符。`)
    return bitmap
  } catch (error) { bitmap.close(); throw error }
}

export { decodePlacementPreviewV2 as decodePlacementPreview }
