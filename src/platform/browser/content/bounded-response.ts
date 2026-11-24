import { checkCancelled, type CancellationSignal } from '../../../shared/ports/resources.js'
import { PACKAGE_LIMITS } from '../../../shared/project/limits.js'

/** Enforce the declared byte budget while reading either a network or a cached response. */
export async function boundedResponseBytes(response: Response, limit: number, options: { signal?: CancellationSignal }): Promise<Uint8Array> {
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
