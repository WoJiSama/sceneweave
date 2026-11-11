import { constants, closeSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { inflateSync } from 'node:zlib'
import { ImageEditRequestSchema, ImageEditResponseSchema, IMAGE_EDIT_LIMITS, chooseImageEditSize, decodeImageEditBase64,
  imageEditCapabilities, imageEditInputHash, inspectImageEditPng, sha256Bytes, type ImageEditResponse } from '../../src/shared/asset-refinement/model-protocol.js'
import { sha256Text } from '../../src/shared/validation/hash.js'

export interface ImageEditProviderConfig { baseUrl: string; apiKey: string; model: string }
export class ImageEditFault extends Error {
  constructor(readonly code: string, readonly status: 400 | 409 | 413 | 429 | 502 | 503, readonly requestState: 'not_sent' | 'unknown' | 'finished' = 'not_sent') {
    super('Image editing request was not completed'); this.name = 'ImageEditFault'
  }
}
export function validateImageEditConfig(config: ImageEditProviderConfig): ImageEditProviderConfig {
  const invalid = () => { throw new Error('Invalid server configuration: IMAGE_EDIT_PROVIDER') }
  let url: URL
  try { url = new URL(config.baseUrl) } catch { return invalid() }
  if (url.username || url.password || url.search || url.hash || !(url.protocol === 'https:' || url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
    || !config.apiKey || config.apiKey.length > 4096 || /[\x00-\x20\x7f]/.test(config.apiKey)
    || !/^[^\s\x00-\x1f\x7f]{1,128}$/.test(config.model)) return invalid()
  return Object.freeze({ baseUrl: url.href.replace(/\/+$/, ''), apiKey: config.apiKey, model: config.model })
}
function check(signal: AbortSignal) { if (signal.aborted) throw signal.reason }
function abortable<T>(promise: Promise<T>, signal: AbortSignal, cancel?: () => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => { cancel?.(); reject(signal.reason) }
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
    promise.then(value => { signal.removeEventListener('abort', abort); resolve(value) }, error => { signal.removeEventListener('abort', abort); reject(error) })
  })
}
async function readJson(body: ReadableStream<Uint8Array> | null, maximum: number, signal: AbortSignal): Promise<unknown> {
  if (!body) throw new ImageEditFault('image_edit_invalid_request', 400)
  const reader = body.getReader(), chunks: Uint8Array[] = []; let size = 0
  try {
    for (;;) {
      check(signal)
      const chunk = await abortable(reader.read(), signal, () => { void reader.cancel().catch(() => {}) })
      check(signal); if (chunk.done) break
      size += chunk.value.length
      if (size > maximum) throw new ImageEditFault('image_edit_byte_limit', 413)
      chunks.push(chunk.value)
    }
    const bytes = new Uint8Array(size); let offset = 0
    for (const part of chunks) { bytes.set(part, offset); offset += part.length }
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) } catch { throw new ImageEditFault('image_edit_invalid_json', 400) }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
}
/** Decode the entire zlib stream in addition to the CRC/container checks; no DOM or image data is logged. */
function validatedPng(bytes: Uint8Array, direction: 'input' | 'output') {
  const header = inspectImageEditPng(bytes, direction), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const chunks: Uint8Array[] = []
  for (let offset = 8; offset < bytes.length;) {
    const length = view.getUint32(offset)
    if (String.fromCharCode(...bytes.subarray(offset + 4, offset + 8)) === 'IDAT') chunks.push(bytes.subarray(offset + 8, offset + 8 + length))
    offset += length + 12
  }
  const compressed = new Uint8Array(chunks.reduce((sum, part) => sum + part.length, 0)); let offset = 0
  for (const part of chunks) { compressed.set(part, offset); offset += part.length }
  const stride = header.width * (bytes[25] === 6 ? 4 : 3) + 1, expected = stride * header.height
  const result = inflateSync(compressed, { maxOutputLength: expected, info: true }) as unknown as { buffer: Uint8Array; engine: { bytesWritten: number } }
  if (result.buffer.length !== expected || result.engine.bytesWritten !== compressed.length) throw new Error('Invalid PNG compressed payload')
  for (let row = 0; row < header.height; row++) if (result.buffer[row * stride] > 4) throw new Error('Invalid PNG row filter')
  return header
}
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const safeId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/.test(value)
interface Receipt { inputHash: string; state: 'unknown' | 'finished' }
interface ImageEditServiceOptions { provider?: ImageEditProviderConfig; dataDir?: string; fetcher?: typeof fetch; maxConcurrent?: number; timeoutMs?: number; bodyTimeoutMs?: number }
export function createImageEditService(options: ImageEditServiceOptions) {
  const provider = options.provider && validateImageEditConfig(options.provider), fetcher = options.fetcher ?? fetch
  const maximum = Math.min(options.maxConcurrent ?? IMAGE_EDIT_LIMITS.maxConcurrent, IMAGE_EDIT_LIMITS.maxConcurrent)
  const timeoutMs = options.timeoutMs ?? IMAGE_EDIT_LIMITS.timeoutMs
  if (!Number.isInteger(maximum) || maximum < 1 || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > IMAGE_EDIT_LIMITS.timeoutMs) throw new Error('Invalid image editing service limits')
  const receipts = new Map<string, Receipt>(), directory = options.dataDir && join(options.dataDir, 'image-edit-requests')
  let active = 0
  const ensureDirectory = () => {
    if (!directory) return
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    const stat = lstatSync(directory)
    if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077)) throw new ImageEditFault('image_edit_storage_unavailable', 503)
  }
  const claim = (key: string, inputHash: string) => {
    const duplicate = (receipt: Receipt): never => { throw new ImageEditFault(receipt.inputHash === inputHash ? 'image_edit_duplicate_request' : 'image_edit_request_conflict', 409, receipt.state) }
    const existing = receipts.get(key); if (existing) duplicate(existing)
    const receipt: Receipt = { inputHash, state: 'unknown' }
    if (directory) {
      ensureDirectory()
      let fd: number | undefined
      try {
        const path = join(directory, key + '.json')
        // A durable claim precedes the only paid request; restart never turns unknown into permission to resend.
        if (readdirSync(directory).length >= 10000) throw new ImageEditFault('image_edit_receipt_limit', 503)
        try { fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600) }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
          const stat = lstatSync(path)
          if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 512) throw new Error('Invalid receipt')
          const saved: unknown = JSON.parse(readFileSync(path, 'utf8'))
          if (!object(saved) || typeof saved.inputHash !== 'string' || !/^[a-f0-9]{64}$/.test(saved.inputHash) || !['unknown', 'finished'].includes(String(saved.state))) throw new Error('Invalid receipt')
          duplicate(saved as unknown as Receipt)
        }
        writeFileSync(fd!, JSON.stringify(receipt)); fsyncSync(fd!)
      } catch (error) { if (error instanceof ImageEditFault) throw error; throw new ImageEditFault('image_edit_storage_unavailable', 503) }
      finally { if (fd !== undefined) closeSync(fd) }
    } else if (receipts.size >= 10000) throw new ImageEditFault('image_edit_receipt_limit', 503)
    receipts.set(key, receipt)
  }
  const finish = (key: string, inputHash: string) => {
    const receipt: Receipt = { inputHash, state: 'finished' }
    if (directory) {
      let fd: number | undefined
      try { fd = openSync(join(directory, key + '.json'), constants.O_WRONLY | constants.O_TRUNC | constants.O_NOFOLLOW); writeFileSync(fd, JSON.stringify(receipt)); fsyncSync(fd) }
      catch { throw new ImageEditFault('image_edit_storage_unavailable', 503, 'finished') }
      finally { if (fd !== undefined) closeSync(fd) }
    }
    receipts.set(key, receipt)
  }
  return {
    capabilities: imageEditCapabilities(provider?.model),
    async edit(request: Request, owner: string): Promise<ImageEditResponse> {
      if (!provider) throw new ImageEditFault('image_edit_unavailable', 503)
      if (request.signal.aborted) throw new ImageEditFault('image_edit_cancelled', 409)
      if (active >= maximum) { void request.body?.cancel().catch(() => {}); throw new ImageEditFault('image_edit_concurrency_limit', 429) }
      if ((request.headers.get('content-type') ?? '').split(';')[0] !== 'application/json' || new URL(request.url).search) throw new ImageEditFault('image_edit_invalid_request', 400)
      const declared = request.headers.get('content-length')
      if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > IMAGE_EDIT_LIMITS.requestBytes)) throw new ImageEditFault('image_edit_byte_limit', 413)
      active++
      const controller = new AbortController(); let sent = false
      const abort = () => controller.abort(new ImageEditFault('image_edit_cancelled', 409, sent ? 'unknown' : 'not_sent'))
      request.signal.addEventListener('abort', abort, { once: true })
      const timer = setTimeout(() => controller.abort(new ImageEditFault('image_edit_timeout', 503, sent ? 'unknown' : 'not_sent')), timeoutMs)
      const uploadTimer = setTimeout(() => controller.abort(new ImageEditFault('image_edit_upload_timeout', 503)), options.bodyTimeoutMs ?? 30_000)
      timer.unref?.(); uploadTimer.unref?.()
      try {
        if (request.signal.aborted) abort()
        const parsed = ImageEditRequestSchema.safeParse(await readJson(request.body, IMAGE_EDIT_LIMITS.requestBytes, controller.signal))
        clearTimeout(uploadTimer)
        if (!parsed.success) throw new ImageEditFault('image_edit_invalid_request', 400)
        const input = parsed.data
        let bytes: Uint8Array, source: ReturnType<typeof validatedPng>, size: { width: number; height: number }
        try {
          bytes = decodeImageEditBase64(input.pngBase64, IMAGE_EDIT_LIMITS.inputBytes)
          if (sha256Bytes(bytes) !== input.sourceSha256) throw new Error('Source hash mismatch')
          source = validatedPng(bytes, 'input'); size = chooseImageEditSize(source.width, source.height)
        } catch { throw new ImageEditFault('image_edit_invalid_source', 400) }
        check(controller.signal)
        const inputHash = imageEditInputHash(input, provider.model, size), key = sha256Text(JSON.stringify([owner, input.clientRequestId]))
        const body = new FormData()
        body.set('model', provider.model); body.set('n', '1'); body.set('size', `${size.width}x${size.height}`)
        body.set('output_format', 'png'); body.set('background', 'transparent')
        body.set('image', new Blob([new Uint8Array(bytes)], { type: 'image/png' }), 'source.png')
        body.set('prompt', 'Refine only the provided object. Preserve its identity, proportions, outline, pose, viewpoint and existing details. Keep a transparent background, do not add objects or shadows outside its original silhouette, do not crop or reframe. Do not replace the object with a different design. Requested refinement: ' + input.prompt)
        claim(key, inputHash); check(controller.signal); sent = true
        let response: Response
        try { response = await abortable(fetcher.call(globalThis, provider.baseUrl + '/images/edits', { method: 'POST', headers: { Authorization: `Bearer ${provider.apiKey}`, Accept: 'application/json' }, body, redirect: 'error', signal: controller.signal }), controller.signal) }
        catch { check(controller.signal); throw new ImageEditFault('image_edit_provider_network', 502, 'unknown') }
        check(controller.signal)
        if (!response.ok || !/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) {
          void response.body?.cancel().catch(() => {}); throw new ImageEditFault('image_edit_provider_response', 502, 'unknown')
        }
        let result: unknown
        try { result = await readJson(response.body, IMAGE_EDIT_LIMITS.responseBytes, controller.signal) }
        catch { check(controller.signal); throw new ImageEditFault('image_edit_provider_protocol', 502, 'unknown') }
        if (!object(result) || !Array.isArray(result.data) || result.data.length !== 1 || !object(result.data[0]) || Object.hasOwn(result.data[0], 'url') || typeof result.data[0].b64_json !== 'string') throw new ImageEditFault('image_edit_provider_protocol', 502, 'unknown')
        const requestId = response.headers.get('x-request-id') ?? result.id
        if (!safeId(requestId)) throw new ImageEditFault('image_edit_provider_request_id', 502, 'unknown')
        let output: Uint8Array
        try {
          output = decodeImageEditBase64(result.data[0].b64_json, IMAGE_EDIT_LIMITS.outputBytes)
          const outputSize = validatedPng(output, 'output')
          if (Math.abs(outputSize.width / outputSize.height / (source.width / source.height) - 1) > .02) throw new Error('Output aspect ratio drift')
        } catch { throw new ImageEditFault('image_edit_invalid_output', 502, 'unknown') }
        check(controller.signal)
        const value = ImageEditResponseSchema.parse({ schemaVersion: 1, sourceSha256: input.sourceSha256, inputHash, outputHash: sha256Bytes(output),
          model: provider.model, requestId, requestedSize: size, pngBase64: result.data[0].b64_json })
        finish(key, inputHash); return value
      } catch (error) {
        if (controller.signal.aborted) throw controller.signal.reason
        if (error instanceof ImageEditFault) throw error
        throw new ImageEditFault('image_edit_failed', 503, sent ? 'unknown' : 'not_sent')
      } finally { clearTimeout(timer); clearTimeout(uploadTimer); request.signal.removeEventListener('abort', abort); active-- }
    },
  }
}
