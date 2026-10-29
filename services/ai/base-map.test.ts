import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { connectionInfo, createAiApp } from './app.js'
import { loadAiConfig } from './config.js'
import { TaskEngine } from './engine.js'
import { TaskFault, TaskStore } from './store.js'
import { createBaseMapService } from './base-map.js'
import { BASE_MAP_LIMITS, executeBaseMapRequest, prepareBaseMapRequest, type BaseMapResponse } from '../../src/shared/terrain-generation/base-map.js'
import { createRefinedBlankDocument } from '../../src/platform/browser/content/refined-blank.js'
import { TERRAIN_FIXED_SEEDS } from '../../src/shared/terrain-generation/generate.js'
import { canonicalJson } from '../../src/shared/validation/json.js'
import { AI_LIMITS } from '../../src/shared/ai/protocol.js'

const accessToken = 'a'.repeat(40), origin = 'https://editor.example.test', path = '/v1/terrain/basemap'
const cleanups: (() => void)[] = []
afterEach(() => { for (const clean of cleanups.splice(0).reverse()) clean(); vi.restoreAllMocks() })
function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'sceneweave-base-map-test-'))
  const config = loadAiConfig({ SCENEWEAVE_AI_DATA_DIR: directory, SCENEWEAVE_AI_ALLOWED_ORIGINS: origin,
    SCENEWEAVE_AI_ACCESS_TOKEN: accessToken, SCENEWEAVE_AI_PROVIDER_BASE_URL: 'http://127.0.0.1:9999/v1',
    SCENEWEAVE_AI_PROVIDER_API_KEY: 'private-provider-key', SCENEWEAVE_AI_PROVIDER_MODEL: 'test-model' })
  config.maxConcurrent = 1
  const complete = vi.fn(async () => { throw new Error('The base-map route must never invoke a provider') })
  const store = new TaskStore(directory), engine = new TaskEngine(store, { complete }, connectionInfo(config))
  const app = createAiApp(config, { store, engine })
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }), () => store.close(), () => engine.close())
  const headers = { Authorization: `Bearer ${accessToken}`, Origin: origin, 'Content-Type': 'application/json' }
  const send = (body: unknown) => app.request(path, { method: 'POST', headers, body: JSON.stringify(body) })
  return { app, store, engine, complete, headers, send }
}
function fixture() {
  const sceneId = 'base-map-http-fixture'
  const base = createRefinedBlankDocument('island', { sceneId, title: 'Base-map fixture', now: '2026-10-29T00:00:00.000Z', widthMm: 24000, heightMm: 18000, preset: 'narrative' })
  return prepareBaseMapRequest({ requestId: 'base-map-http-request', workspaceSceneId: 'current-workspace', checkpoint: 4, operationEpoch: 7,
    base, generation: { kind: 'terrain', input: { sceneId, kind: 'island', seed: TERRAIN_FIXED_SEEDS[0], algorithmVersion: 2, widthMm: 24000, heightMm: 18000 } } })
}
function streamedRequest(body: ReadableStream<Uint8Array>, headers: Record<string, string>, signal?: AbortSignal) {
  return new Request(`http://localhost${path}`, { method: 'POST', headers, body, signal, duplex: 'half' } as RequestInit & { duplex: 'half' })
}

describe('stateless deterministic base-map HTTP service', () => {
  it('keeps authentication, exact Origin and safe error responses without starting a task', async () => {
    const { app, store, complete, headers, send } = setup()
    expect((await app.request(path, { method: 'POST', body: '{}' })).status).toBe(401)
    expect((await app.request(path, { method: 'POST', headers: { ...headers, Origin: `${origin}.evil` }, body: '{}' })).status).toBe(403)
    const invalid = await send({})
    expect(invalid.status).toBe(400)
    expect(invalid.headers.get('Cache-Control')).toBe('no-store')
    expect(await invalid.json()).toMatchObject({ error: { code: 'invalid_request', retryable: false, requestState: 'not_sent' } })
    expect(complete).not.toHaveBeenCalled(); expect(store.count()).toBe(0)
  })

  it('returns the exact shared deterministic result and accepts its dedicated body limit without a provider or task', async () => {
    const { app, send, headers, store, complete } = setup(), prepared = fixture(), expected = executeBaseMapRequest(prepared)
    const first = await send(prepared)
    expect(first.status).toBe(200)
    expect(first.headers.get('Content-Type')).toBe('application/json; charset=utf-8')
    const result = await first.json()
    expect(canonicalJson(result)).toBe(canonicalJson(expected))
    expect(result.domainCost.finalAdoptionCostChecked).toBe(false)
    const json = JSON.stringify(prepared), padded = json + ' '.repeat(BASE_MAP_LIMITS.requestBytes - Buffer.byteLength(json))
    const second = await app.request(path, { method: 'POST', headers, body: padded })
    expect(second.status).toBe(200)
    expect((await second.json()).resultHash).toBe(expected.resultHash)
    expect(complete).not.toHaveBeenCalled(); expect(store.count()).toBe(0)
  }, 20_000)

  it('rejects unknown versions, fields and input/hash mismatches with no source content in the error', async () => {
    const { send, store, complete } = setup(), prepared = fixture()
    const changed = structuredClone(prepared)
    changed.generation.input.seed = 'changed-after-hash'
    for (const body of [{ ...prepared, version: 99 },
      { ...prepared, generation: { ...prepared.generation, input: { ...prepared.generation.input, algorithmVersion: 99 } } },
      { ...prepared, owner: 'private-owner-marker' }, { ...prepared, inputHash: 'f'.repeat(64) }, { ...prepared, baseHash: 'f'.repeat(64) }, changed]) {
      const response = await send(body)
      expect(response.status).toBe(400)
      const error = await response.text()
      expect(error).not.toContain('private-owner-marker'); expect(error).not.toContain('changed-after-hash'); expect(error).not.toContain('ZodError')
      expect(JSON.parse(error)).toMatchObject({ error: { code: 'invalid_request', retryable: false } })
    }
    expect(complete).not.toHaveBeenCalled(); expect(store.count()).toBe(0)
  })

  it('rejects false MIME types, invalid UTF-8, malformed lengths and excessive actual streamed bytes', async () => {
    const { app, headers, send, store, complete } = setup()
    const cases: [BodyInit, Record<string, string>, number][] = [
      ['{}', { 'Content-Type': 'application/jsonp' }, 400],
      [new Uint8Array([0x7b, 0x22, 0xff, 0x22, 0x3a, 0x31, 0x7d]), {}, 400],
      ['{}', { 'Content-Length': '-1' }, 413],
      ['{}', { 'Content-Length': String(BASE_MAP_LIMITS.requestBytes + 1) }, 413],
      ['{}', { 'Content-Length': '1' }, 400],
    ]
    for (const [body, extraHeaders, status] of cases) expect((await app.request(path, { method: 'POST', headers: { ...headers, ...extraHeaders }, body })).status).toBe(status)
    const cancel = vi.fn(), oversized = new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(new Uint8Array(BASE_MAP_LIMITS.requestBytes)); controller.enqueue(new Uint8Array([32]))
    }, cancel })
    const response = await app.request(streamedRequest(oversized, headers))
    expect(response.status).toBe(413); expect(cancel).toHaveBeenCalledTimes(1)
    expect((await send({})).status).toBe(400)
    expect(complete).not.toHaveBeenCalled(); expect(store.count()).toBe(0)
  })

  it('reserves capacity before reading a stalled body, aborts it and releases the slot', async () => {
    const { app, headers, send, store, complete } = setup(), controller = new AbortController(), cancel = vi.fn()
    const stalled = new ReadableStream<Uint8Array>({ cancel })
    const pending = app.request(streamedRequest(stalled, headers, controller.signal))
    expect((await send({})).status).toBe(429)
    controller.abort()
    const aborted = await pending
    expect(aborted.status).toBe(409)
    expect(await aborted.json()).toMatchObject({ error: { code: 'request_cancelled', requestState: 'not_sent' } })
    expect(cancel).toHaveBeenCalledTimes(1)
    expect((await send({})).status).toBe(400)
    const alreadyAborted = await app.request(new Request(`http://localhost${path}`, { method: 'POST', headers, body: '{}', signal: controller.signal }))
    expect(alreadyAborted.status).toBe(409)
    expect((await send({})).status).toBe(400)
    expect(complete).not.toHaveBeenCalled(); expect(store.count()).toBe(0)
  })

  it('preserves the storage-availability guard before any base-map work', async () => {
    const { engine, send, complete, store } = setup()
    vi.spyOn(engine, 'assertStorageAvailable').mockImplementation(() => { throw new TaskFault('storage_unavailable', 503) })
    expect((await send({})).status).toBe(503)
    expect(complete).not.toHaveBeenCalled(); expect(store.count()).toBe(0)
  })

  it('leaves the existing conversation 32KiB actual-byte guard unchanged', async () => {
    const { app, headers, complete, store } = setup()
    const response = await app.request('/v1/tasks', { method: 'POST', headers, body: '{}' + ' '.repeat(AI_LIMITS.requestBytes) })
    expect(response.status).toBe(413)
    expect(complete).not.toHaveBeenCalled(); expect(store.count()).toBe(0)
  })
})

describe('base-map request resource boundaries', () => {
  const request = () => new Request('http://localhost/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })

  it('times out a stalled body and releases capacity without calling the executor', async () => {
    const execute = vi.fn(() => ({} as BaseMapResponse)), service = createBaseMapService({ maxConcurrent: 1, bodyTimeoutMs: 10, execute })
    const cancel = vi.fn(), pending = service.generate(streamedRequest(new ReadableStream({ cancel }), { 'Content-Type': 'application/json' }))
    await expect(pending).rejects.toMatchObject({ code: 'request_timeout', status: 503 })
    expect(cancel).toHaveBeenCalledTimes(1); expect(execute).not.toHaveBeenCalled()
    await expect(service.generate(request())).resolves.toBe('{}')
  })

  it('bounds serialized results and releases capacity after both executor and serialization failures', async () => {
    const circular: Record<string, unknown> = {}; circular.self = circular
    const execute = vi.fn<(_: unknown) => BaseMapResponse>()
      .mockImplementationOnce(() => { throw new Error('private-domain-geometry-and-key') })
      .mockReturnValueOnce({ padding: '中'.repeat(Math.ceil(BASE_MAP_LIMITS.resultBytes / 3)) } as unknown as BaseMapResponse)
      .mockReturnValueOnce(circular as unknown as BaseMapResponse)
      .mockReturnValue({} as BaseMapResponse)
    const service = createBaseMapService({ maxConcurrent: 1, execute })
    await expect(service.generate(request())).rejects.toMatchObject({ code: 'invalid_request', status: 400, message: 'invalid_request' })
    await expect(service.generate(request())).rejects.toMatchObject({ code: 'result_limit', status: 413 })
    await expect(service.generate(request())).rejects.toMatchObject({ code: 'invalid_result', status: 503 })
    await expect(service.generate(request())).resolves.toBe('{}')
  })

  it('discards an abort observed after synchronous execution without delivering a result', async () => {
    const abort = new AbortController(), execute = vi.fn(() => { abort.abort(); return {} as BaseMapResponse })
    const service = createBaseMapService({ maxConcurrent: 1, execute })
    await expect(service.generate(new Request(request(), { signal: abort.signal }))).rejects.toMatchObject({ code: 'request_cancelled', status: 409 })
    await expect(service.generate(request())).resolves.toBe('{}')
    expect(execute).toHaveBeenCalledTimes(2)
  })
})
