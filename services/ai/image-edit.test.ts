import { afterEach, describe, expect, it, vi } from 'vitest'
import { deflateSync } from 'node:zlib'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { crc32 } from '../../src/shared/project/binary.js'
import { chooseImageEditSize, encodeImageEditBase64, IMAGE_EDIT_LIMITS, sha256Bytes } from '../../src/shared/asset-refinement/model-protocol.js'
import { createImageEditService } from './image-edit.js'
import { createAiApp, connectionInfo } from './app.js'
import { loadAiConfig } from './config.js'
import { TaskEngine } from './engine.js'
import { TaskStore } from './store.js'

const cleanups: (() => void)[] = []
afterEach(() => { vi.restoreAllMocks(); for (const clean of cleanups.splice(0).reverse()) clean() })
function temporary() { const directory = mkdtempSync(join(tmpdir(), 'sceneweave-image-edit-')); cleanups.push(() => rmSync(directory, { recursive: true, force: true })); return directory }
function chunk(type: string, data: Uint8Array) {
  const bytes = new Uint8Array(data.length + 12), view = new DataView(bytes.buffer)
  view.setUint32(0, data.length); bytes.set(new TextEncoder().encode(type), 4); bytes.set(data, 8)
  view.setUint32(data.length + 8, crc32(bytes.subarray(4, data.length + 8))); return bytes
}
function png(width = 64, height = 48, broken = false) {
  const header = new Uint8Array(13), view = new DataView(header.buffer)
  view.setUint32(0, width); view.setUint32(4, height); header[8] = 8; header[9] = 6
  const raw = new Uint8Array((width * 4 + 1) * height)
  for (let row = 0; row < height; row++) for (let x = 0; x < width; x++) raw[row * (width * 4 + 1) + 1 + x * 4 + 3] = 128
  if (broken) raw[0] = 5
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', new Uint8Array())]
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0)); let offset = 0
  for (const part of parts) { result.set(part, offset); offset += part.length } return result
}
const provider = { baseUrl: 'https://images.example.test/v1', apiKey: 'private-image-edit-test-key', model: 'configured-image-model' }
function input(clientRequestId = 'request-one', bytes = png()) { return { schemaVersion: 1, clientRequestId, sourceSha256: sha256Bytes(bytes), prompt: 'Refine the existing piano keys', pngBase64: encodeImageEditBase64(bytes) } }
function request(body = input(), signal?: AbortSignal) { return new Request('http://app.test/v1/image-edit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal }) }
const response = (bytes = png()) => Response.json({ data: [{ b64_json: encodeImageEditBase64(bytes) }] }, { headers: { 'x-request-id': 'provider-request-1' } })

describe('bounded single-request image editing', () => {
  it('does not inherit chat configuration and validates the separate server-only tuple without exposing values', () => {
    const env = { SCENEWEAVE_AI_ACCESS_TOKEN: 't'.repeat(40), SCENEWEAVE_AI_PROVIDER_BASE_URL: 'https://chat.example.test/v1', SCENEWEAVE_AI_PROVIDER_API_KEY: 'private-chat-key', SCENEWEAVE_AI_PROVIDER_MODEL: 'text-only' }
    expect(loadAiConfig(env).imageEdit).toBeUndefined()
    expect(createImageEditService({}).capabilities).toMatchObject({ available: false, model: null })
    expect(() => loadAiConfig({ ...env, SCENEWEAVE_AI_IMAGE_EDIT_MODEL: 'image' })).toThrow('Invalid server configuration: IMAGE_EDIT_PROVIDER')
    const valid = { ...env, SCENEWEAVE_AI_IMAGE_EDIT_BASE_URL: provider.baseUrl, SCENEWEAVE_AI_IMAGE_EDIT_API_KEY: provider.apiKey, SCENEWEAVE_AI_IMAGE_EDIT_MODEL: provider.model }
    expect(loadAiConfig(valid).imageEdit).toEqual(provider)
    expect(() => loadAiConfig({ ...valid, SCENEWEAVE_AI_IMAGE_EDIT_BASE_URL: 'https://private:secret@images.example.test/v1' })).toThrow('Invalid server configuration: IMAGE_EDIT_PROVIDER')
  })
  it('sends one real multipart PNG edit with explicit aligned size, fixed model, one candidate and no forced alpha', async () => {
    const bytes = png(), fetcher = vi.fn<typeof fetch>(async (url, init) => {
      expect(url).toBe(provider.baseUrl + '/images/edits'); expect(init?.redirect).toBe('error')
      expect(init?.headers).toMatchObject({ Authorization: `Bearer ${provider.apiKey}` })
      const form = init!.body as FormData, file = form.get('image') as File
      expect(file.type).toBe('image/png'); expect(new Uint8Array(await file.arrayBuffer())).toEqual(bytes)
      expect(form.get('model')).toBe(provider.model); expect(form.get('n')).toBe('1')
      expect(form.get('size')).toBe('944x704'); expect(form.get('background')).toBe('transparent'); expect(form.get('output_format')).toBe('png')
      expect(form.get('input_fidelity')).toBeNull(); expect(form.get('response_format')).toBeNull(); expect(form.get('mask')).toBeNull()
      expect(String(form.get('prompt'))).toContain('Refine the existing piano keys')
      return response(bytes)
    })
    const service = createImageEditService({ provider, fetcher, dataDir: temporary() })
    const result = await service.edit(request(), 'alice')
    expect(result).toMatchObject({ model: provider.model, requestId: 'provider-request-1', sourceSha256: sha256Bytes(bytes), outputHash: sha256Bytes(bytes), pngBase64: encodeImageEditBase64(bytes) })
    expect(result.inputHash).toMatch(/^[a-f0-9]{64}$/); expect(fetcher).toHaveBeenCalledOnce()
    await expect(service.edit(request(), 'alice')).rejects.toMatchObject({ code: 'image_edit_duplicate_request', requestState: 'finished' })
    expect(fetcher).toHaveBeenCalledOnce()
  })
  it('rejects bad source hash, CRC, decoded PNG rows and source aspect ratio before any request', async () => {
    const fetcher = vi.fn<typeof fetch>(), service = createImageEditService({ provider, fetcher })
    await expect(service.edit(request({ ...input(), sourceSha256: 'a'.repeat(64) }), 'alice')).rejects.toMatchObject({ code: 'image_edit_invalid_source', requestState: 'not_sent' })
    const crcBroken = png(); crcBroken[crcBroken.length - 1] ^= 1
    for (const bytes of [crcBroken, png(64, 48, true), png(100, 1)]) await expect(service.edit(request(input('invalid', bytes)), 'alice')).rejects.toMatchObject({ code: 'image_edit_invalid_source', requestState: 'not_sent' })
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('keeps the size policy bounded, aligned and proportionate without substituting another model', () => {
    for (const [width, height] of [[100, 100], [400, 300], [2048, 1024], [3000, 3000], [800, 2400]]) {
      const size = chooseImageEditSize(width, height)
      expect(size.width % 16).toBe(0); expect(size.height % 16).toBe(0)
      expect(size.width * size.height).toBeGreaterThanOrEqual(655360); expect(size.width * size.height).toBeLessThanOrEqual(8_000_000)
      expect(Math.max(size.width, size.height)).toBeLessThanOrEqual(3840); expect(Math.min(size.width, size.height)).toBeLessThanOrEqual(2160)
      expect(Math.abs(size.width / size.height / (width / height) - 1)).toBeLessThanOrEqual(.02)
    }
    expect(() => chooseImageEditSize(400, 10)).toThrow()
  })
  it('never retries an unknown paid request and retains only hashes/state across service restart and owner isolation', async () => {
    const directory = temporary(), fetcher = vi.fn<typeof fetch>(async () => { throw new Error('unsafe private provider response') })
    const service = createImageEditService({ provider, fetcher, dataDir: directory })
    await expect(service.edit(request(), 'alice')).rejects.toMatchObject({ code: 'image_edit_provider_network', requestState: 'unknown' })
    await expect(service.edit(request(), 'alice')).rejects.toMatchObject({ code: 'image_edit_duplicate_request', requestState: 'unknown' })
    const restarted = createImageEditService({ provider, fetcher, dataDir: directory })
    await expect(restarted.edit(request(), 'alice')).rejects.toMatchObject({ code: 'image_edit_duplicate_request', requestState: 'unknown' })
    await expect(restarted.edit(request({ ...input(), prompt: 'different' }), 'alice')).rejects.toMatchObject({ code: 'image_edit_request_conflict' })
    await expect(restarted.edit(request(), 'bob')).rejects.toMatchObject({ requestState: 'unknown' })
    expect(fetcher).toHaveBeenCalledTimes(2)
    for (const file of readdirSync(join(directory, 'image-edit-requests'))) {
      const receipt = readFileSync(join(directory, 'image-edit-requests', file), 'utf8')
      expect(Object.keys(JSON.parse(receipt))).toEqual(['inputHash', 'state'])
      expect(receipt).not.toContain(provider.apiKey); expect(receipt).not.toContain(input().pngBase64); expect(receipt).not.toContain('piano')
    }
  })
  it.each([
    { data: [{ url: 'https://private.example.test/image.png' }] },
    { data: [{ b64_json: encodeImageEditBase64(png()) }, { b64_json: encodeImageEditBase64(png()) }] },
    { data: [{ b64_json: encodeImageEditBase64(png(10, 20)) }] },
  ])('rejects URL, multiple candidates and drifting output without fetching URLs or retrying', async payload => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json(payload, { headers: { 'x-request-id': 'request-1' } }))
    const service = createImageEditService({ provider, fetcher })
    await expect(service.edit(request(), 'alice')).rejects.toMatchObject({ requestState: 'unknown' })
    expect(fetcher).toHaveBeenCalledOnce()
  })
  it('bounds concurrency before upload, cancels the fetch and prevents reusing its sent ID', async () => {
    let started!: () => void
    const began = new Promise<void>(resolve => { started = resolve })
    let providerSignal: AbortSignal | undefined
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => { providerSignal = init?.signal ?? undefined; started(); return new Promise<Response>(() => {}) })
    const service = createImageEditService({ provider, fetcher, maxConcurrent: 1 }), abort = new AbortController()
    const pending = service.edit(request(input(), abort.signal), 'alice'); await began
    await expect(service.edit(request(input('second')), 'alice')).rejects.toMatchObject({ code: 'image_edit_concurrency_limit', requestState: 'not_sent' })
    abort.abort(); await expect(pending).rejects.toMatchObject({ code: 'image_edit_cancelled', requestState: 'unknown' }); expect(providerSignal?.aborted).toBe(true)
    await expect(service.edit(request(), 'alice')).rejects.toMatchObject({ code: 'image_edit_duplicate_request' }); expect(fetcher).toHaveBeenCalledOnce()
  })
  it('times out a sent request without retry and rejects oversized upload before calling the provider', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Promise<Response>(() => {})), service = createImageEditService({ provider, fetcher, timeoutMs: 20 })
    await expect(service.edit(request(), 'alice')).rejects.toMatchObject({ code: 'image_edit_timeout', requestState: 'unknown' })
    const oversized = request(); oversized.headers.set('content-length', String(IMAGE_EDIT_LIMITS.requestBytes + 1))
    await expect(service.edit(oversized, 'alice')).rejects.toMatchObject({ code: 'image_edit_byte_limit', requestState: 'not_sent' }); expect(fetcher).toHaveBeenCalledOnce()
  })
  it('guards the app endpoints with normal auth/origin and reports unavailable without falling back to chat', async () => {
    const directory = temporary(), token = 't'.repeat(40), origin = 'https://editor.example.test'
    const config = loadAiConfig({ SCENEWEAVE_AI_DATA_DIR: directory, SCENEWEAVE_AI_ALLOWED_ORIGINS: origin, SCENEWEAVE_AI_ACCESS_TOKEN: token,
      SCENEWEAVE_AI_PROVIDER_BASE_URL: 'https://chat.example.test/v1', SCENEWEAVE_AI_PROVIDER_API_KEY: 'private-chat', SCENEWEAVE_AI_PROVIDER_MODEL: 'text-model' })
    const store = new TaskStore(directory), complete = vi.fn(), engine = new TaskEngine(store, { complete }, connectionInfo(config))
    cleanups.push(() => store.close(), () => engine.close())
    const imageEditFetch = vi.fn<typeof fetch>(), app = createAiApp(config, { store, engine, imageEditFetch })
    expect((await app.request('/v1/image-edit/capabilities')).status).toBe(401)
    expect((await app.request('/v1/image-edit/capabilities', { headers: { Authorization: `Bearer ${token}`, Origin: 'https://evil.test' } })).status).toBe(403)
    const headers = { Authorization: `Bearer ${token}`, Origin: origin, 'Content-Type': 'application/json' }
    expect(await (await app.request('/v1/image-edit/capabilities', { headers })).json()).toMatchObject({ available: false, model: null })
    const unavailable = await app.request('/v1/image-edit', { method: 'POST', headers, body: JSON.stringify(input()) })
    expect(unavailable.status).toBe(503); expect(await unavailable.json()).toMatchObject({ error: { code: 'image_edit_unavailable', requestState: 'not_sent', retryable: false } })
    expect(complete).not.toHaveBeenCalled(); expect(imageEditFetch).not.toHaveBeenCalled()
  })
})
