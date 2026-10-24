import type { AssetRecord } from '../../../shared/model/project.js'
import type { CancellationSignal } from '../../../shared/ports/resources.js'
import { checkCancelled } from '../../../shared/ports/resources.js'
import { PACKAGE_LIMITS } from '../../../shared/project/limits.js'

export interface ContentLoadProgress { phase: 'resources' | 'validation'; completed: number; total: number }
export interface ContentLoadOptions { signal?: CancellationSignal; onProgress?: (progress: ContentLoadProgress) => void }
export const CONTENT_FETCH_CONCURRENCY = 4
const fixedPath = /^assets\/sceneweave-handdrawn(?:-outdoor|-outpost|-content)?\/[a-z0-9-]+\.png$/

/** Capture every response chunk under its declared bound, including while cancellation is pending. */
export async function boundedResponseBytes(response: Response, limit: number, options: Pick<ContentLoadOptions, 'signal'>): Promise<Uint8Array> {
  checkCancelled(options.signal)
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > PACKAGE_LIMITS.imageBytes) throw new Error('内置素材响应超过固定字节预算。')
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer())
    checkCancelled(options.signal)
    if (bytes.byteLength > limit) throw new Error('内置素材响应超过固定字节预算。')
    return bytes
  }
  const reader = response.body.getReader(), chunks: Uint8Array[] = []
  const signal = typeof AbortSignal !== 'undefined' && options.signal instanceof AbortSignal ? options.signal : undefined
  const abortRead = () => { void reader.cancel().catch(() => undefined) }
  signal?.addEventListener('abort', abortRead, { once: true })
  let total = 0
  try {
    for (;;) {
      checkCancelled(options.signal)
      const { done, value } = await reader.read()
      checkCancelled(options.signal)
      if (done) break
      total += value.byteLength
      if (total > limit) throw new Error('内置素材响应超过固定字节预算。')
      chunks.push(value.slice())
    }
  } catch (error) { await reader.cancel().catch(() => undefined); throw error }
  finally { signal?.removeEventListener('abort', abortRead); reader.releaseLock() }
  const bytes = new Uint8Array(total); let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  return bytes
}

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
        if (path) {
          const response = await fetch(`${import.meta.env.BASE_URL}${path}`, { signal: controller.signal })
          checkpoint()
          if (!response.ok) { void response.body?.cancel().catch(() => undefined); throw new Error(`内置素材读取失败：${path} (${response.status})。`) }
          value = await boundedResponseBytes(response, size, { signal: controller.signal })
        } else value = Uint8Array.from(atob(encoded!), character => character.charCodeAt(0))
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
