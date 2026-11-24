import type { AssetRecord } from '../../../shared/model/project.js'
import type { CancellationSignal } from '../../../shared/ports/resources.js'
import { checkCancelled } from '../../../shared/ports/resources.js'
import { PACKAGE_LIMITS } from '../../../shared/project/limits.js'
import { readFixedImage } from './fixed-image-cache.js'
export { boundedResponseBytes } from './bounded-response.js'

export interface ContentLoadProgress { phase: 'resources' | 'validation'; completed: number; total: number }
export interface ContentLoadOptions { signal?: CancellationSignal; onProgress?: (progress: ContentLoadProgress) => void; requireStored?: boolean }
export const CONTENT_FETCH_CONCURRENCY = 4
const fixedPath = /^assets\/sceneweave-handdrawn(?:-outdoor|-outpost|-content)?\/[a-z0-9-]+\.png$/

/** Four bounded byte readers only; actual hashes, headers and pixels remain a complete validation step. */
export async function loadFixedResources(assets: Readonly<Record<string, AssetRecord>>, paths: Readonly<Record<string, string>>,
  embedded: Readonly<Record<string, string>>, options: ContentLoadOptions = {}): Promise<Map<string, Uint8Array>> {
  checkCancelled(options.signal)
  let totalBytes = 0, totalPixels = 0
  const entries = Object.entries(assets).map(([hash, record]) => {
    const path = paths[hash], encoded = embedded[hash], size = record.sizeBytes
    if (!/^[a-f0-9]{64}$/.test(hash) || !Number.isSafeInteger(size) || size < 1 || size > PACKAGE_LIMITS.imageBytes
      || (totalBytes += size) > PACKAGE_LIMITS.expandedBytes) throw new Error('内置素材字节超过保护预算。')
    if (!Number.isSafeInteger(record.pixelWidth) || !Number.isSafeInteger(record.pixelHeight) || record.pixelWidth < 1 || record.pixelHeight < 1
      || record.pixelWidth > PACKAGE_LIMITS.imageSide || record.pixelHeight > PACKAGE_LIMITS.imageSide
      || record.pixelWidth * record.pixelHeight > PACKAGE_LIMITS.imagePixels
      || (totalPixels += record.pixelWidth * record.pixelHeight) > PACKAGE_LIMITS.totalImagePixels) throw new Error('内置素材像素超过保护预算。')
    if (path !== undefined) {
      if (!fixedPath.test(path) || encoded !== undefined) throw new Error('内置资源路径无效或重复。')
    } else if (!encoded || encoded.length !== Math.ceil(size / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)
      || Math.floor(encoded.length * 3 / 4) - (encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0) !== size) throw new Error('样板缺少有效实际图片，未创建空图替代。')
    return { hash, path, encoded, size }
  })
  if (entries.length > PACKAGE_LIMITS.uniqueImages) throw new Error('内置素材图片数量超过保护预算。')

  const controller = new AbortController(), external = typeof AbortSignal !== 'undefined' && options.signal instanceof AbortSignal ? options.signal : undefined
  const abort = () => controller.abort()
  external?.addEventListener('abort', abort, { once: true })
  let next = 0, completed = 0, failed = false, failure: unknown
  const results = new Map<string, Uint8Array>()
  const checkpoint = () => { checkCancelled(options.signal); checkCancelled(controller.signal) }
  const report = () => options.onProgress?.({ phase: 'resources', completed, total: entries.length })
  const worker = async () => {
    try {
      while (!failed) {
        checkpoint()
        const index = next++
        if (index >= entries.length) return
        const { hash, path, encoded, size } = entries[index]
        let value: Uint8Array
        if (path) value = await readFixedImage(hash, path, size, controller.signal, options.requireStored === true)
        else value = Uint8Array.from(atob(encoded!), character => character.charCodeAt(0))
        checkpoint()
        if (value.length !== size) throw new Error('内置素材实际字节长度不匹配。')
        results.set(hash, value); completed++; report()
      }
    } catch (error) {
      if (!failed) { failed = true; failure = error; controller.abort() }
    }
  }
  try {
    checkpoint(); report()
    await Promise.allSettled(Array.from({ length: Math.min(CONTENT_FETCH_CONCURRENCY, entries.length) }, worker))
    if (failed) throw failure
    checkpoint()
    return new Map(entries.map(({ hash }) => [hash, results.get(hash)!]))
  } finally { external?.removeEventListener('abort', abort) }
}
