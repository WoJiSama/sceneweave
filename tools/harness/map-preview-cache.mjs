import path from 'node:path'
import { cachePreviews, PREVIEW_CACHE_BYTES, readCachedPreview } from './preview-cache.mjs'

const folderName = 'sceneweave-map-previews-v1'
export { describePreview as describeMapArtifact, PREVIEW_CACHE_BYTES as MAP_PREVIEW_CACHE_BYTES } from './preview-cache.mjs'

export function cacheMapPreviews(output, images, ceiling = PREVIEW_CACHE_BYTES) {
  return cachePreviews(path.dirname(output), folderName, images, ceiling)
}

export async function readCachedMapPreview(output, record) {
  try { return await readCachedPreview(path.dirname(output), folderName, record) }
  catch (error) {
    if (error.code === 'preview_cache_corrupt') error.code = 'map_preview_corrupt'
    if (error.code !== 'ENOENT') throw error
    throw Object.assign(new Error(record.file === 'overlay.png' ? '缓存中的叠图已回收。请用原图重新提取轮廓。'
      : '缓存中的草稿预览已回收。请复验或重绘该候选。'), { code: 'map_preview_evicted' })
  }
}
