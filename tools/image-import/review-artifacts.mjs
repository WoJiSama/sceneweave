import path from 'node:path'
import { assert, writeVerified } from '../harness/io.mjs'
import { cachePreviews, describePreview, PREVIEW_CACHE_BYTES } from '../harness/preview-cache.mjs'

/** Preserve exact review pixels. Very large reviews can still be viewed in
 * the response, and the caller can request a standalone set of files. */
export async function saveReviewImages(directory, images, saveImages) {
  const files = {}, paths = {}, cached = {}, included = new Set()
  let remaining = PREVIEW_CACHE_BYTES
  for (const [key, { bytes, sha256 }] of Object.entries(images)) {
    const record = describePreview(key + '.png', bytes)
    assert(bytes.length > 0 && (sha256 === undefined || record.sha256 === sha256), `图片与审阅摘要不一致：${record.file}。`)
    files[key] = record
  }
  if (saveImages) {
    for (const [key, record] of Object.entries(files)) {
      await writeVerified(directory, record.file, images[key].bytes)
      paths[key] = path.join(directory, record.file)
    }
    return { files, paths }
  }
  for (const [key, record] of Object.entries(files)) {
    const size = included.has(record.sha256) ? 0 : record.byteLength
    if (size > remaining) { record.storage = 'uncached'; continue }
    included.add(record.sha256)
    remaining -= size
    cached[key] = images[key].bytes
  }
  if (Object.keys(cached).length) {
    const stored = await cachePreviews(path.dirname(directory), 'sceneweave-image-previews-v1', cached)
    for (const [key, item] of Object.entries(stored.images)) {
      files[key] = item.record
      paths[key] = item.path
    }
  }
  return { files, paths }
}
