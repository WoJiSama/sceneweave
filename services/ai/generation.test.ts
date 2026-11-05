import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { connectionInfo, createAiApp } from './app.js'
import { loadAiConfig } from './config.js'
import { TaskEngine } from './engine.js'
import { TaskFault, TaskStore } from './store.js'
import { createDomainGenerationService, type DomainGenerationExecutor } from './generation.js'
import { DOMAIN_GENERATION_LIMITS, createDomainExecutionRequest, domainGenerationCapabilities, executeDomainExecutionRequest, parseDomainExecutionResponse, type DomainExecutionResponse, type DomainGenerationKind } from '../../src/shared/generation/execution.js'
import { InteriorGenerationError } from '../../src/shared/generation/domains/interior/layout.js'
import { ForestGenerationError } from '../../src/shared/generation/domains/forest/contracts.js'
import { VolcanoGenerationError } from '../../src/shared/generation/domains/volcano/contracts.js'
import { canonicalJson } from '../../src/shared/validation/json.js'
import { domainExecutionFixture } from '../../tools/testing/domain-execution-fixtures.js'

const accessToken = 'a'.repeat(40), origin = 'https://editor.example.test', path = '/v1/generation'
const cleanups: (() => void)[] = []
afterEach(() => { for (const clean of cleanups.splice(0).reverse()) clean(); vi.restoreAllMocks() })
function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'sceneweave-generation-test-'))
  const config = loadAiConfig({ SCENEWEAVE_AI_DATA_DIR: directory, SCENEWEAVE_AI_ALLOWED_ORIGINS: origin,
    SCENEWEAVE_AI_ACCESS_TOKEN: accessToken, SCENEWEAVE_AI_PROVIDER_BASE_URL: 'http://127.0.0.1:9999/v1',
    SCENEWEAVE_AI_PROVIDER_API_KEY: 'private-provider-key', SCENEWEAVE_AI_PROVIDER_MODEL: 'test-model' })
  config.maxConcurrent = 1
  const complete = vi.fn(async () => { throw new Error('Programmatic generation must never invoke a provider') })
  const store = new TaskStore(directory), engine = new TaskEngine(store, { complete }, connectionInfo(config))
  const beginBaseMap = vi.spyOn(store, 'beginBaseMap'), app = createAiApp(config, { store, engine })
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }), () => store.close(), () => engine.close())
  const headers = { Authorization: `Bearer ${accessToken}`, Origin: origin, 'Content-Type': 'application/json' }
  const send = (body: unknown) => app.request(path, { method: 'POST', headers, body: JSON.stringify(body) })
  return { app, store, engine, complete, beginBaseMap, headers, send }
}
function prepared(domain: DomainGenerationKind = 'interior') {
  return createDomainExecutionRequest({ requestId: `d7-service-${domain}`, context: { workspaceId: 'current-workspace', checkpoint: 4, epoch: 7 }, domain, ...domainExecutionFixture(domain) })
}
function request(body: unknown = prepared(), signal?: AbortSignal) {
  return new Request(`http://localhost${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal })
}
function streamedRequest(body: ReadableStream<Uint8Array>, headers: Record<string, string>, signal?: AbortSignal) {
  return new Request(`http://localhost${path}`, { method: 'POST', headers, body, signal, duplex: 'half' } as RequestInit & { duplex: 'half' })
}

describe('programmatic domain generation HTTP service', () => {
  it('authenticates its own exact capability route without widening AI capabilities or tools', async () => {
    const { app, store, complete, beginBaseMap, headers } = setup()
    expect((await app.request(`${path}/capabilities`)).status).toBe(401)
    expect((await app.request(path, { method: 'POST', body: '{}' })).status).toBe(401)
    expect((await app.request(path, { method: 'POST', headers: { ...headers, Origin: `${origin}.evil` }, body: '{}' })).status).toBe(403)
    const capability = await app.request(`${path}/capabilities`, { headers })
    expect(capability.status).toBe(200)
    expect(await capability.json()).toEqual(domainGenerationCapabilities('server'))
    expect(capability.headers.get('Cache-Control')).toBe('no-store')
    for (const query of ['domain=forest', 'executor=server&executor=server', 'unknown=1']) expect((await app.request(`${path}/capabilities?${query}`, { headers })).status).toBe(400)
    const existing = await (await app.request('/v1/capabilities', { headers })).json()
    expect(existing.capabilities).not.toHaveProperty('domains')
    expect(existing.capabilities).not.toHaveProperty('localOperations')
    expect(existing.capabilities).not.toHaveProperty('aiTools')
    expect(complete).not.toHaveBeenCalled(); expect(beginBaseMap).not.toHaveBeenCalled(); expect(store.count()).toBe(0)
  })

  for (const domain of ['interior', 'forest', 'volcano'] as const) it(`returns the exact shared ${domain} result without a model, AI task or base-map ledger`, async () => {
    vi.spyOn(performance, 'now').mockReturnValue(0)
    const { store, complete, beginBaseMap, send } = setup(), input = prepared(domain)
    const expected = executeDomainExecutionRequest(input, { nowMilliseconds: () => 0 })
    const response = await send(input)
    expect(response.status).toBe(200)
    const actual = parseDomainExecutionResponse(await response.json(), input)
    expect(canonicalJson(actual)).toBe(canonicalJson(expected))
    expect(complete).not.toHaveBeenCalled(); expect(beginBaseMap).not.toHaveBeenCalled(); expect(store.count()).toBe(0)
  }, 20000)

  it('rejects forged protocols, selectors, profiles and hashes before execution', async () => {
    const { app, headers, store, complete, send } = setup(), input = prepared()
    const cases = [{}, { ...input, extra: true }, { ...input, protocolVersion: 2 }, { ...input, domain: 'ocean' },
      { ...input, input: { ...input.input, algorithmVersion: 99 } }, { ...input, requestHash: 'f'.repeat(64) },
      { ...input, profile: { ...input.profile, semanticTargets: 8192 } }]
    for (const body of cases) expect((await send(body)).status).toBe(400)
    for (const query of ['domain=interior', 'version=1&version=1', 'unknown=1']) expect((await app.request(`${path}?${query}`, { method: 'POST', headers, body: JSON.stringify(input) })).status).toBe(400)
    expect(complete).not.toHaveBeenCalled(); expect(store.count()).toBe(0)
  })

  it('returns a fixed public explanation for a supported refusal without exposing domain internals', async () => {
    const { send, complete, store } = setup(), fixture = domainExecutionFixture('interior')
    fixture.base.userLayers['visual-layer-ground'].editLocked = true
    const input = createDomainExecutionRequest({ requestId: 'd7-unsupported', context: { workspaceId: 'current-workspace', checkpoint: 4, epoch: 7 }, domain: 'interior', ...fixture })
    const response = await send(input)
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: { code: 'generation_unsupported', message: '当前生成器暂不支持这组要求，请调整范围、支撑或参数。', retryable: false, requestState: 'not_sent' } })
    expect(complete).not.toHaveBeenCalled(); expect(store.count()).toBe(0)
  })

  it('enforces exact JSON, UTF-8, declared and actual body bytes', async () => {
    const { app, headers, send, complete, store } = setup()
    const cases: [BodyInit, Record<string, string>, number][] = [
      ['{}', { 'Content-Type': 'application/jsonp' }, 400],
      [new Uint8Array([0x7b, 0x22, 0xff, 0x22, 0x3a, 0x31, 0x7d]), {}, 400],
      ['{}', { 'Content-Length': '-1' }, 413],
      ['{}', { 'Content-Length': String(DOMAIN_GENERATION_LIMITS.requestBytes + 1) }, 413],
      ['{}', { 'Content-Length': '9007199254740992' }, 413],
      ['{}', { 'Content-Length': '1' }, 400],
    ]
    for (const [body, extra, status] of cases) expect((await app.request(path, { method: 'POST', headers: { ...headers, ...extra }, body })).status).toBe(status)
    const cancel = vi.fn(), oversized = new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(new Uint8Array(DOMAIN_GENERATION_LIMITS.requestBytes)); controller.enqueue(new Uint8Array([32]))
    }, cancel })
    expect((await app.request(streamedRequest(oversized, headers))).status).toBe(413)
    expect(cancel).toHaveBeenCalledTimes(1)
    expect((await send({})).status).toBe(400)
    expect(complete).not.toHaveBeenCalled(); expect(store.count()).toBe(0)
  })

  it('reserves capacity before a stalled body and releases it after cancellation', async () => {
    const { app, headers, send, store, complete } = setup(), abort = new AbortController(), cancel = vi.fn()
    const pending = app.request(streamedRequest(new ReadableStream<Uint8Array>({ cancel }), headers, abort.signal))
    expect((await send({})).status).toBe(429)
    abort.abort()
    const response = await pending
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ error: { code: 'request_cancelled', requestState: 'not_sent' } })
    expect(cancel).toHaveBeenCalledTimes(1)
    expect((await send({})).status).toBe(400)
    expect((await app.request(new Request(request({}), { headers, signal: abort.signal }))).status).toBe(409)
    expect((await send({})).status).toBe(400)
    expect(complete).not.toHaveBeenCalled(); expect(store.count()).toBe(0)
  })

  it('retains the application storage-availability guard before programmatic work', async () => {
    const { engine, send, complete, store } = setup()
    vi.spyOn(engine, 'assertStorageAvailable').mockImplementation(() => { throw new TaskFault('storage_unavailable', 503) })
    expect((await send({})).status).toBe(503)
    expect(complete).not.toHaveBeenCalled(); expect(store.count()).toBe(0)
  })
})

describe('domain generation resource boundaries', () => {
  it('times out a stalled body, cancels its reader and releases capacity', async () => {
    vi.spyOn(performance, 'now').mockReturnValue(0)
    const execute = vi.fn<DomainGenerationExecutor>().mockReturnValue({} as DomainExecutionResponse)
    const service = createDomainGenerationService({ maxConcurrent: 1, timeoutMs: 10, execute }), cancel = vi.fn()
    await expect(service.generate(streamedRequest(new ReadableStream<Uint8Array>({ cancel }), { 'Content-Type': 'application/json' }))).rejects.toMatchObject({ code: 'request_timeout', status: 503 })
    expect(cancel).toHaveBeenCalledTimes(1); expect(execute).not.toHaveBeenCalled()
    await expect(service.generate(request())).resolves.toBe('{}')
  })

  it('bounds serialized results and releases slots after unknown execution or serialization errors', async () => {
    const circular: Record<string, unknown> = {}; circular.self = circular
    const execute = vi.fn<DomainGenerationExecutor>()
      .mockImplementationOnce(() => { throw new Error('private-domain-geometry-and-key') })
      .mockReturnValueOnce({ padding: '中'.repeat(Math.ceil(DOMAIN_GENERATION_LIMITS.resultBytes / 3)) } as unknown as DomainExecutionResponse)
      .mockReturnValueOnce(circular as unknown as DomainExecutionResponse)
      .mockReturnValue({} as DomainExecutionResponse)
    const service = createDomainGenerationService({ maxConcurrent: 1, execute })
    await expect(service.generate(request())).rejects.toMatchObject({ code: 'invalid_request', status: 400, message: 'invalid_request' })
    await expect(service.generate(request())).rejects.toMatchObject({ code: 'result_limit', status: 413 })
    await expect(service.generate(request())).rejects.toMatchObject({ code: 'invalid_result', status: 503 })
    await expect(service.generate(request())).resolves.toBe('{}')
  })

  it('maps only known domain failures to fixed public text', async () => {
    const execute = vi.fn<DomainGenerationExecutor>()
      .mockImplementationOnce(() => { throw new InteriorGenerationError('contradiction', 'private-room-id') })
      .mockImplementationOnce(() => { throw new ForestGenerationError('search-exhausted', 'private-forest-id') })
      .mockImplementationOnce(() => { throw new VolcanoGenerationError('budget-exceeded', 'private-volcano-id') })
      .mockReturnValue({} as DomainExecutionResponse)
    const service = createDomainGenerationService({ maxConcurrent: 1, execute })
    for (const code of ['generation_contradiction', 'generation_search_exhausted', 'generation_budget_exceeded']) {
      try { await service.generate(request()); throw new Error('Expected a known refusal') } catch (error) {
        expect(error).toMatchObject({ code })
        expect((error as Error).message).not.toContain('private-')
        expect((error as { safeMessage?: string }).safeMessage).toBeTruthy()
      }
    }
    await expect(service.generate(request())).resolves.toBe('{}')
  })

  it('discards cancellation or an elapsed deadline after synchronous execution', async () => {
    const abort = new AbortController(), execute = vi.fn<DomainGenerationExecutor>()
      .mockImplementationOnce(() => { abort.abort(); return {} as DomainExecutionResponse })
      .mockReturnValue({} as DomainExecutionResponse)
    const service = createDomainGenerationService({ maxConcurrent: 1, execute })
    await expect(service.generate(request(prepared(), abort.signal))).rejects.toMatchObject({ code: 'request_cancelled', status: 409 })
    await expect(service.generate(request())).resolves.toBe('{}')
    const now = vi.spyOn(performance, 'now').mockReturnValue(0)
    const expired = createDomainGenerationService({ maxConcurrent: 1, timeoutMs: 10, execute: vi.fn<DomainGenerationExecutor>().mockImplementation(() => { now.mockReturnValue(10); return {} as DomainExecutionResponse }) })
    await expect(expired.generate(request())).rejects.toMatchObject({ code: 'request_timeout', status: 503 })
  })
})
