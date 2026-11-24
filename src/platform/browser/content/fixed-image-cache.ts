import { sha256Bytes } from '../../../shared/project/binary.js'
import { boundedResponseBytes } from './bounded-response.js'

const cacheName = 'sceneweave-fixed-images-v1:' + import.meta.env.BASE_URL
const cacheKey = (hash: string) => import.meta.env.BASE_URL + '.sceneweave-fixed-images/' + hash
const storageError = () => new Error('无法将素材保存在此浏览器。请检查站点存储权限和剩余空间后重试。')

export async function openFixedImageCache(): Promise<Cache> {
  try { return await caches.open(cacheName) } catch { throw storageError() }
}

export async function storedFixedHashes(cache: Cache) {
  const prefix = new URL(cacheKey(''), location.href).href
  return new Set((await cache.keys()).filter(request => request.url.startsWith(prefix)).map(request => request.url.slice(prefix.length)))
}

export const fixedImageChanges = new EventTarget()

export async function storeFixedImage(cache: Cache, hash: string, bytes: Uint8Array) {
  try { await cache.put(cacheKey(hash), new Response(bytes.slice(), { headers: { 'Content-Type': 'image/png' } })) }
  catch { throw storageError() }
  fixedImageChanges.dispatchEvent(new CustomEvent('stored', { detail: hash }))
}

async function readOrFetch(hash: string, path: string, size: number, signal: AbortSignal, predownload: boolean) {
  const cache = typeof caches === 'undefined' ? undefined : await openFixedImageCache().catch(() => undefined)
  signal.throwIfAborted()
  if (cache) {
    const cached = await cache.match(cacheKey(hash)).catch(() => undefined)
    if (cached) {
      const bytes = await boundedResponseBytes(cached, size, { signal }).catch(() => undefined)
      signal.throwIfAborted()
      if (bytes?.length === size && sha256Bytes(bytes) === hash) return { bytes, stored: true }
      await cache.delete(cacheKey(hash)).catch(() => false)
      fixedImageChanges.dispatchEvent(new CustomEvent('removed', { detail: hash }))
    }
  }
  signal.throwIfAborted()
  const response = await fetch(import.meta.env.BASE_URL + path, { signal, priority: predownload ? 'low' : 'auto' })
  if (!response.ok) {
    void response.body?.cancel().catch(() => undefined)
    throw new Error(`内置素材读取失败：${path} (${response.status})。`)
  }
  const bytes = await boundedResponseBytes(response, size, { signal })
  if (bytes.length !== size) throw new Error('内置素材实际字节长度不匹配。')
  if (sha256Bytes(bytes) !== hash) throw new Error('固定素材图片摘要不一致（SHA256）。')
  // A full or unavailable cache must not prevent ordinary editing with verified bytes.
  const stored = cache ? await storeFixedImage(cache, hash, bytes).then(() => true, () => false) : false
  return { bytes, stored }
}

type ImageRead = { controller: AbortController; result: ReturnType<typeof readOrFetch>; readers: number }
const inFlight = new Map<string, ImageRead>()

/** A thumbnail, an edit and a predownload can share the same request. Cancelling
 * a scene stops its readers without cancelling another consumer's transfer. */
export function readFixedImage(hash: string, path: string, size: number, signal: AbortSignal, requireStored: boolean) {
  signal.throwIfAborted()
  let read = inFlight.get(hash)
  if (!read) {
    const controller = new AbortController()
    read = { controller, result: readOrFetch(hash, path, size, controller.signal, requireStored), readers: 0 }
    inFlight.set(hash, read)
  }
  const shared = read
  shared.readers++
  return new Promise<Uint8Array>((resolve, reject) => {
    const cancel = () => reject(signal.reason)
    signal.addEventListener('abort', cancel, { once: true })
    shared.result.then(({ bytes, stored }) => {
      if (bytes.length !== size) reject(new Error('内置素材实际字节长度不匹配。'))
      else if (requireStored && !stored) reject(storageError())
      else resolve(bytes.slice())
    }, reject).finally(() => signal.removeEventListener('abort', cancel))
  }).finally(() => {
    if (--shared.readers === 0) {
      inFlight.delete(hash)
      shared.controller.abort()
    }
  })
}
