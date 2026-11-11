import { captureBytes } from '../../../shared/project/binary.js'
import { IMAGE_EDIT_LIMITS, ImageEditCapabilitiesSchema, ImageEditErrorSchema, ImageEditRequestSchema, ImageEditResponseSchema,
  chooseImageEditSize, decodeImageEditBase64, encodeImageEditBase64, imageEditInputHash, inspectImageEditPng, sha256Bytes,
  type ImageEditCapabilities } from '../../../shared/asset-refinement/model-protocol.js'

export interface ImageEditConnection { baseUrl: string; token: string }
export type ImageEditRequestStateEvent = { clientRequestId: string; state: 'not_sent' | 'unknown' | 'finished' }
export class ImageEditClientError extends Error {
  constructor(readonly code: string, readonly requestState: 'not_sent' | 'unknown' | 'finished' = 'not_sent', readonly clientRequestId?: string, detail?: string) {
    super((detail ?? (code === 'image_edit_unavailable' ? '图像补画服务尚未配置。'
      : requestState === 'unknown' ? '本次补画结果未知，服务可能仍在处理。不会自动重发。'
        : requestState === 'finished' ? '此请求已处理，不会重复提交。'
          : code === 'image_edit_cancelled' ? '已取消，尚未发送补画请求。' : '图像补画请求未完成，请检查连接、输入和服务配置。'))
      + (clientRequestId && requestState !== 'not_sent' ? ` 请求 ID：${clientRequestId}` : ''))
    this.name = 'ImageEditClientError'
  }
}
function connectionDetails(connection: ImageEditConnection) {
  let url: URL
  try { url = new URL(connection.baseUrl.trim()) } catch { throw new ImageEditClientError('image_edit_configuration') }
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
    || url.username || url.password || url.search || url.hash || url.pathname !== '/' || !connection.token.trim()
    || connection.token.length > 4096 || /[\x00-\x1f\x7f]/.test(connection.token)) throw new ImageEditClientError('image_edit_configuration')
  return { baseUrl: url.origin, token: connection.token.trim() }
}
async function jsonResponse(response: Response, signal: AbortSignal, maximum: number): Promise<unknown> {
  if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '') || !response.body) throw new Error('Invalid JSON response')
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0
  const cancel = () => { void reader.cancel().catch(() => {}) }
  signal.addEventListener('abort', cancel, { once: true })
  try {
    for (;;) {
      signal.throwIfAborted(); const part = await reader.read(); signal.throwIfAborted()
      if (part.done) break
      size += part.value.length; if (size > maximum) throw new Error('Response limit')
      chunks.push(part.value)
    }
    const bytes = new Uint8Array(size); let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown
  } finally { signal.removeEventListener('abort', cancel); await reader.cancel().catch(() => {}); reader.releaseLock() }
}
/** One HTTP attempt only. Caller retains the ID after any sent/unknown result and must not automatically resend. */
async function request(connection: ImageEditConnection, method: 'GET' | 'POST', body: unknown, signal?: AbortSignal, onDispatch?: () => void): Promise<unknown> {
  const details = connectionDetails(connection)
  if (signal?.aborted) throw new ImageEditClientError('image_edit_cancelled')
  const timeout = AbortSignal.timeout(method === 'GET' ? 20_000 : IMAGE_EDIT_LIMITS.timeoutMs + 5000)
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout
  let sent = false
  try {
    combined.throwIfAborted()
    if (method === 'POST') { onDispatch?.(); sent = true }
    const response = await fetch(`${details.baseUrl}/v1/image-edit${method === 'GET' ? '/capabilities' : ''}`, { method,
      headers: { Authorization: `Bearer ${details.token}`, ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}) },
      body: method === 'POST' ? JSON.stringify(body) : undefined, credentials: 'omit', redirect: 'error', cache: 'no-store', signal: combined })
    if (!response.ok) {
      const error = ImageEditErrorSchema.safeParse(await jsonResponse(response, combined, 4096))
      if (error.success) throw new ImageEditClientError(error.data.error.code, error.data.error.requestState)
      throw new ImageEditClientError('image_edit_http_error', sent ? 'unknown' : 'not_sent')
    }
    return await jsonResponse(response, combined, method === 'GET' ? 8192 : IMAGE_EDIT_LIMITS.responseBytes)
  } catch (error) {
    if (error instanceof ImageEditClientError) throw error
    throw new ImageEditClientError(combined.aborted ? signal?.aborted ? 'image_edit_cancelled' : 'image_edit_timeout' : 'image_edit_connection', sent ? 'unknown' : 'not_sent')
  }
}
export async function getImageEditCapabilities(connection: ImageEditConnection, signal?: AbortSignal): Promise<ImageEditCapabilities> {
  const parsed = ImageEditCapabilitiesSchema.safeParse(await request(connection, 'GET', undefined, signal))
  if (!parsed.success) throw new ImageEditClientError('image_edit_protocol')
  return parsed.data
}
export interface ImageEditModelInput { clientRequestId: string; sourceSha256: string; pngBytes: Uint8Array; prompt: string }
export interface ImageEditModelResult { pngBytes: Uint8Array; model: string; requestId: string; clientRequestId: string; sourceSha256: string; inputHash: string; outputHash: string }
/** Host owns real pixel decoding, source license, consent, silhouette review and transactional adoption. No alpha mask is imposed. */
export async function requestImageEdit(connection: ImageEditConnection, input: ImageEditModelInput, signal?: AbortSignal,
  onRequestState?: (event: ImageEditRequestStateEvent) => void): Promise<ImageEditModelResult> {
  let bytes: Uint8Array, body: ReturnType<typeof ImageEditRequestSchema.parse>
  try {
    bytes = captureBytes(input.pngBytes, IMAGE_EDIT_LIMITS.inputBytes)
    inspectImageEditPng(bytes, 'input')
    if (sha256Bytes(bytes) !== input.sourceSha256) throw new Error('Source hash mismatch')
    body = ImageEditRequestSchema.parse({ schemaVersion: 1, clientRequestId: input.clientRequestId, sourceSha256: input.sourceSha256,
      prompt: input.prompt, pngBase64: encodeImageEditBase64(bytes) })
  } catch { throw new ImageEditClientError('image_edit_invalid_source') }
  let dispatched = false
  try {
    const response = await request(connection, 'POST', body, signal, () => {
      dispatched = true; onRequestState?.({ clientRequestId: body.clientRequestId, state: 'unknown' })
    })
    const parsed = ImageEditResponseSchema.safeParse(response)
    if (!parsed.success) throw new ImageEditClientError('image_edit_protocol', 'unknown')
    const result = parsed.data
    const dimensions = inspectImageEditPng(bytes, 'input'), size = chooseImageEditSize(dimensions.width, dimensions.height)
    if (result.sourceSha256 !== body.sourceSha256 || result.requestedSize.width !== size.width || result.requestedSize.height !== size.height
      || result.inputHash !== imageEditInputHash(body, result.model, result.requestedSize)) throw new Error('Source identity mismatch')
    const pngBytes = decodeImageEditBase64(result.pngBase64, IMAGE_EDIT_LIMITS.outputBytes)
    if (sha256Bytes(pngBytes) !== result.outputHash) throw new Error('Output hash mismatch')
    inspectImageEditPng(pngBytes, 'output')
    onRequestState?.({ clientRequestId: body.clientRequestId, state: 'finished' })
    return { pngBytes, model: result.model, requestId: result.requestId, clientRequestId: body.clientRequestId,
      sourceSha256: result.sourceSha256, inputHash: result.inputHash, outputHash: result.outputHash }
  } catch (error) {
    const failure = error instanceof ImageEditClientError ? error : new ImageEditClientError('image_edit_protocol', dispatched ? 'unknown' : 'not_sent')
    if (dispatched) onRequestState?.({ clientRequestId: body.clientRequestId, state: failure.requestState })
    throw new ImageEditClientError(failure.code, failure.requestState, body.clientRequestId)
  }
}
