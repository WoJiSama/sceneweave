import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createRefinedBlankDocument } from '../content/refined-blank.js'
import { executeBaseMapRequest, prepareBaseMapRequest, type BaseMapRequest, type BaseMapResponse } from '../../../shared/terrain-generation/base-map.js'
import { canonicalJson, cloneJson } from '../../../shared/validation/json.js'
import { createBaseMapGenerationClient, type BaseMapGenerationClient, type BaseMapGenerationClientOptions, type BaseMapWorker } from './base-map-client.js'
import { executeBaseMapWorkerRequest } from './base-map-worker.js'
import { prepareBaseMapRequestV2, executeBaseMapRequestV2, type BaseMapRequestV2, type BaseMapResponseV2 } from '../../../shared/terrain-generation/base-map-v2.js'
import { CONTINUATION_POLICY } from '../../../shared/ai/budget-policy.js'
import type { ConnectionInfo } from '../../../shared/ai/protocol.js'
import type { BaseMapGenerationExecution } from './base-map-client.js'

let terrainRequest: BaseMapRequest, terrainResponse: BaseMapResponse, compositionRequest: BaseMapRequest, compositionResponse: BaseMapResponse
beforeAll(() => {
  const base = createRefinedBlankDocument('island', { title: '程序底图传输夹具', sceneId: 'base-map-candidate',
    now: '2026-10-29T00:00:00.000Z', widthMm: 48000, heightMm: 36000, preset: 'narrative' })
  const stamp = { requestId: 'base-map-request', workspaceSceneId: 'current-workspace', checkpoint: 4, operationEpoch: 7, base }
  terrainRequest = prepareBaseMapRequest({ ...stamp, generation: { kind: 'terrain', input: {
    sceneId: base.sceneId, kind: 'island', seed: 'terrain-v1-0', widthMm: 48000, heightMm: 36000, algorithmVersion: 2,
  } } })
  terrainResponse = executeBaseMapRequest(terrainRequest)
  compositionRequest = prepareBaseMapRequest({ ...stamp, requestId: 'composition-base-map', generation: { kind: 'composition', input: {
    sceneId: base.sceneId, preset: 'archipelago', seed: 'terrain-compose-0', widthMm: 48000, heightMm: 36000, islandCount: 3, recipeVersion: 2,
  } } })
  compositionResponse = executeBaseMapRequest(compositionRequest)
}, 30_000)

class MockWorker implements BaseMapWorker {
  onmessage: BaseMapWorker['onmessage'] = null
  onerror: BaseMapWorker['onerror'] = null
  onmessageerror: BaseMapWorker['onmessageerror'] = null
  posted: BaseMapRequest[] = []
  terminate = vi.fn()
  postMessage = vi.fn((value: unknown) => { this.posted.push(cloneJson(value) as BaseMapRequest) })
  emit(value: unknown) { this.onmessage?.({ data: value } as MessageEvent<unknown>) }
}
const clients: BaseMapGenerationClient[] = []
const server = { baseUrl: ' https://AI.example.test:443/ ', token: ' application-token-fixture ' }
function setup(options: Omit<BaseMapGenerationClientOptions, 'createWorker'> = {}) {
  const workers: MockWorker[] = [], createWorker = vi.fn(() => { const worker = new MockWorker(); workers.push(worker); return worker })
  const fetcher = options.fetcher ?? vi.fn<typeof fetch>().mockRejectedValue(new Error('Unexpected network'))
  const client = createBaseMapGenerationClient({ ...options, createWorker, fetcher }); clients.push(client)
  return { client, workers, createWorker, fetcher }
}
const released = (worker: MockWorker) => {
  expect(worker.terminate).toHaveBeenCalledTimes(1)
  expect(worker.onmessage).toBeNull(); expect(worker.onerror).toBeNull(); expect(worker.onmessageerror).toBeNull()
}
const jsonResponse = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } })
afterEach(() => { for (const client of clients.splice(0)) client.dispose(); vi.useRealTimers(); vi.restoreAllMocks() })

describe('program base-map transport uses one explicit offline or server path', () => {
  it.each(['terrain', 'composition'] as const)('round trips the exact %s request through the offline Worker without network', async kind => {
    const request = kind === 'terrain' ? terrainRequest : compositionRequest, expected = kind === 'terrain' ? terrainResponse : compositionResponse
    const { client, workers, fetcher } = setup(), before = canonicalJson(request), pending = client.generate(request)
    expect(workers[0].posted[0]).toEqual(request)
    workers[0].emit(executeBaseMapWorkerRequest(workers[0].posted[0]))
    const response = await pending
    expect(response).toEqual(expected); expect(Object.isFrozen(response)).toBe(true)
    expect(canonicalJson(request)).toBe(before); expect(fetcher).not.toHaveBeenCalled(); released(workers[0])
  })

  it.each(['terrain', 'composition'] as const)('posts the complete %s metadata once with in-memory authentication and no Worker fallback', async kind => {
    const request = kind === 'terrain' ? terrainRequest : compositionRequest, expected = kind === 'terrain' ? terrainResponse : compositionResponse
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(expected)), { client, createWorker } = setup({ fetcher })
    expect(await client.generate(request, { server })).toEqual(expected)
    expect(fetcher).toHaveBeenCalledTimes(1); expect(createWorker).not.toHaveBeenCalled()
    const [url, init] = fetcher.mock.calls[0]
    expect(url).toBe('https://ai.example.test/v1/terrain/basemap')
    expect(init).toMatchObject({ method: 'POST', credentials: 'omit', cache: 'no-store', redirect: 'error', body: canonicalJson(request) })
    const headers = new Headers(init!.headers)
    expect(headers.get('Authorization')).toBe('Bearer application-token-fixture'); expect(headers.get('Content-Type')).toBe('application/json')
    expect(String(url)).not.toContain('application-token-fixture')
  })

  it('captures request and response ownership rather than trusting mutable callers', async () => {
    const { client, workers } = setup(), request = cloneJson(terrainRequest), before = canonicalJson(request), pending = client.generate(request)
    request.base.title = 'changed after dispatch'
    expect(canonicalJson(workers[0].posted[0])).toBe(before)
    const response = cloneJson(terrainResponse); workers[0].emit(response)
    const result = await pending
    expect(result).toEqual(terrainResponse); expect(result).not.toBe(response); released(workers[0])
  })

  it.each(['requestId', 'workspaceSceneId', 'checkpoint', 'operationEpoch', 'inputHash', 'baseHash', 'paletteHash', 'algorithm'] as const)('rejects a mismatched %s despite an intact result', async key => {
    const { client, workers } = setup(), pending = client.generate(terrainRequest)
    workers[0].emit({ ...cloneJson(terrainResponse), [key]: key === 'checkpoint' || key === 'operationEpoch' ? 99 : 'foreign-context' })
    await expect(pending).rejects.toMatchObject({ code: 'protocol' }); released(workers[0])
  })

  it('rejects bad hashes, extra fields and unsafe worker failures without disclosing their raw messages', async () => {
    for (const raw of [{ ...cloneJson(terrainResponse), resultHash: '0'.repeat(64) }, { ...cloneJson(terrainResponse), validated: true },
      { type: 'error', message: 'sensitive fixture diagnostic' }]) {
      const { client, workers } = setup(), pending = client.generate(terrainRequest)
      workers[0].emit(raw)
      await expect(pending).rejects.not.toThrow('sensitive fixture diagnostic'); released(workers[0])
    }
    expect(executeBaseMapWorkerRequest({ invalid: true })).toEqual({ type: 'error', message: '程序底图生成失败，请检查输入或缩小范围。' })
  })

  it('checks baseline guards before allocation and after receiving a valid result', async () => {
    const { client, workers, createWorker } = setup()
    await expect(client.generate(terrainRequest, { isCurrent: () => false })).rejects.toMatchObject({ code: 'stale' })
    await expect(client.generate(terrainRequest, { isCurrent: () => { throw new Error('unmounted') } })).rejects.toMatchObject({ code: 'stale' })
    expect(createWorker).not.toHaveBeenCalled()
    let checkpoint = 4
    const pending = client.generate(terrainRequest, { isCurrent: request => request.checkpoint === checkpoint })
    checkpoint++; workers[0].emit(terrainResponse)
    await expect(pending).rejects.toMatchObject({ code: 'stale' }); released(workers[0])
  })

  it('rejects oversized UTF-8 requests, stale stamps and accessors before dispatch', async () => {
    const { client, createWorker, fetcher } = setup(), request = cloneJson(terrainRequest), getter = vi.fn(() => request.base)
    Object.defineProperty(request, 'base', { enumerable: true, get: getter })
    await expect(client.generate(request)).rejects.toMatchObject({ code: 'invalid_input' }); expect(getter).not.toHaveBeenCalled()
    await expect(client.generate({ ...terrainRequest, baseHash: 'f'.repeat(64) })).rejects.toMatchObject({ code: 'invalid_input' })
    const oversized = { ...terrainRequest, padding: '海'.repeat(1500000) } as BaseMapRequest
    await expect(client.generate(oversized, { server })).rejects.toMatchObject({ code: 'invalid_input' })
    expect(createWorker).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled()
  })

  it('rejects accessor and oversized UTF-8 Worker responses without invoking getters', async () => {
    const { client, workers } = setup(), response = cloneJson(terrainResponse), getter = vi.fn(() => 'safe')
    Object.defineProperty(response, 'resultHash', { enumerable: true, get: getter })
    const pending = client.generate(terrainRequest); workers[0].emit(response)
    await expect(pending).rejects.toMatchObject({ code: 'protocol' }); expect(getter).not.toHaveBeenCalled(); released(workers[0])
    const next = client.generate(terrainRequest); workers[1].emit({ padding: '海'.repeat(3000000) })
    await expect(next).rejects.toMatchObject({ code: 'protocol' }); released(workers[1])
  })

  it.each(['network', 'status', 'hash', 'json', 'utf8'] as const)('does not retry or fall back after a server %s failure', async failure => {
    const fetcher = vi.fn<typeof fetch>()
    if (failure === 'network') fetcher.mockRejectedValue(new Error(`fixture secret ${server.token}`))
    else if (failure === 'status') fetcher.mockResolvedValue(new Response('private server diagnostic', { status: 500 }))
    else if (failure === 'hash') fetcher.mockResolvedValue(jsonResponse({ ...terrainResponse, resultHash: '0'.repeat(64) }))
    else if (failure === 'json') fetcher.mockResolvedValue(new Response('{invalid', { headers: { 'Content-Type': 'application/json' } }))
    else fetcher.mockResolvedValue(new Response(new Uint8Array([0xc3, 0x28]), { headers: { 'Content-Type': 'application/json' } }))
    const { client, createWorker } = setup({ fetcher })
    await expect(client.generate(terrainRequest, { server })).rejects.not.toThrow('fixture secret')
    expect(fetcher).toHaveBeenCalledTimes(1); expect(createWorker).not.toHaveBeenCalled()
  })

  it('counts streamed bytes despite a lying Content-Length and cancels an oversized multibyte response', async () => {
    const cancelled = vi.fn(), chunk = new TextEncoder().encode('海'.repeat(1500000))
    const response = new Response(new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(chunk); controller.enqueue(chunk) }, cancel: cancelled }), { headers: { 'Content-Length': '2', 'Content-Type': 'application/json' } })
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response), { client, createWorker } = setup({ fetcher })
    await expect(client.generate(terrainRequest, { server })).rejects.toMatchObject({ code: 'protocol' })
    expect(cancelled).toHaveBeenCalled(); expect(createWorker).not.toHaveBeenCalled(); expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it.each([[401, '应用凭据'], [403, 'Origin'], [404, '升级后端'], [413, '预算超过上限'], [429, '繁忙'], [503, '暂时不可用']] as const)('uses a safe actionable message for HTTP %s without reading server diagnostics', async (status, message) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('private server diagnostic', { status })), { client, createWorker } = setup({ fetcher })
    await expect(client.generate(terrainRequest, { server })).rejects.toThrow(message)
    expect(fetcher).toHaveBeenCalledTimes(1); expect(createWorker).not.toHaveBeenCalled()
  })

  it('requires a JSON success Content-Type even when the body is a valid protocol result', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(terrainResponse), { headers: { 'Content-Type': 'text/plain' } }))
    const { client, createWorker } = setup({ fetcher })
    await expect(client.generate(terrainRequest, { server })).rejects.toMatchObject({ code: 'protocol' })
    expect(fetcher).toHaveBeenCalledTimes(1); expect(createWorker).not.toHaveBeenCalled()
  })

  it.each([{ baseUrl: 'http://remote.example.test', token: 'token' }, { baseUrl: 'https://u:p@example.test', token: 'token' },
    { baseUrl: 'https://example.test/path', token: 'token' }, { baseUrl: 'https://example.test', token: '' },
    { baseUrl: 'https://example.test', token: 'bad\ntoken' }, { baseUrl: 'https://example.test', token: 'x'.repeat(4097) }])('rejects invalid server configuration without allocating either transport', async configuration => {
    const { client, createWorker, fetcher } = setup()
    await expect(client.generate(terrainRequest, { server: configuration })).rejects.toMatchObject({ code: 'configuration' })
    expect(createWorker).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled()
  })

  it('cancels, replaces and disposes Workers, clears every handler, and ignores callbacks already queued', async () => {
    const { client, workers, createWorker } = setup(), first = client.generate(terrainRequest), firstFailure = expect(first).rejects.toMatchObject({ name: 'AbortError' })
    const oldCallback = workers[0].onmessage!, second = client.generate(terrainRequest)
    oldCallback({ data: terrainResponse } as MessageEvent<unknown>); await firstFailure; released(workers[0])
    client.cancel(); await expect(second).rejects.toMatchObject({ name: 'AbortError' }); released(workers[1])
    const third = client.generate(terrainRequest); client.dispose()
    await expect(third).rejects.toMatchObject({ name: 'AbortError' }); released(workers[2])
    await expect(client.generate(terrainRequest)).rejects.toMatchObject({ code: 'disposed' }); expect(createWorker).toHaveBeenCalledTimes(3)
  })

  it('honors abort before allocation and during Worker execution', async () => {
    const { client, workers, createWorker, fetcher } = setup(), abort = new AbortController(); abort.abort()
    await expect(client.generate(terrainRequest, { signal: abort.signal, server })).rejects.toMatchObject({ name: 'AbortError' })
    expect(createWorker).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled()
    const live = new AbortController(), pending = client.generate(terrainRequest, { signal: live.signal }); live.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' }); released(workers[0])
  })

  it('aborts pending server fetches on cancel and ignores a valid late response without fallback', async () => {
    let deliver!: (response: Response) => void
    const fetcher = vi.fn<typeof fetch>().mockImplementation(() => new Promise(resolve => { deliver = resolve }))
    const { client, createWorker } = setup({ fetcher }), pending = client.generate(terrainRequest, { server })
    const signal = fetcher.mock.calls[0][1]!.signal!
    client.cancel(); await expect(pending).rejects.toMatchObject({ name: 'AbortError' }); expect(signal.aborted).toBe(true)
    deliver(jsonResponse(terrainResponse)); await Promise.resolve(); await Promise.resolve()
    expect(fetcher).toHaveBeenCalledTimes(1); expect(createWorker).not.toHaveBeenCalled()
  })

  it('rechecks the host baseline after a server response and cancels a streaming body on external abort', async () => {
    let deliver!: (response: Response) => void, current = true
    const fetcher = vi.fn<typeof fetch>().mockImplementation(() => new Promise(resolve => { deliver = resolve }))
    const { client } = setup({ fetcher }), stale = client.generate(terrainRequest, { server, isCurrent: () => current })
    current = false; deliver(jsonResponse(terrainResponse)); await expect(stale).rejects.toMatchObject({ code: 'stale' })
    const cancelled = vi.fn(), body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode('{')) }, cancel: cancelled })
    fetcher.mockResolvedValueOnce(new Response(body, { headers: { 'Content-Type': 'application/json' } }))
    const abort = new AbortController(), pending = client.generate(terrainRequest, { server, signal: abort.signal })
    await Promise.resolve(); await Promise.resolve(); abort.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' }); expect(cancelled).toHaveBeenCalled()
  })

  it.each(['worker', 'server'] as const)('enforces one bounded timeout for %s and clears the timer', async transport => {
    vi.useFakeTimers()
    const fetcher = vi.fn<typeof fetch>().mockImplementation(() => new Promise(() => {})), { client, workers } = setup({ fetcher, timeoutMs: 50 })
    const pending = client.generate(terrainRequest, transport === 'server' ? { server } : {}), failed = expect(pending).rejects.toMatchObject({ code: 'timeout' })
    await vi.advanceTimersByTimeAsync(50); await failed
    if (transport === 'worker') released(workers[0])
    else expect(fetcher.mock.calls[0][1]!.signal!.aborted).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('cleans up Worker errors and never exposes diagnostic event text', async () => {
    const { client, workers } = setup(), pending = client.generate(terrainRequest), preventDefault = vi.fn()
    workers[0].onerror!({ message: 'private worker trace', preventDefault } as unknown as ErrorEvent)
    await expect(pending).rejects.not.toThrow('private worker trace'); expect(preventDefault).toHaveBeenCalled(); released(workers[0])
    const next = client.generate(terrainRequest); workers[1].onmessageerror!({} as MessageEvent<unknown>)
    await expect(next).rejects.toMatchObject({ code: 'protocol' }); released(workers[1])
  })
})

describe('versioned continuation base-map transport', () => {
  let request: BaseMapRequestV2, response: BaseMapResponseV2
  const capabilities = (changes: Partial<ConnectionInfo['capabilities']> = {}): ConnectionInfo => ({ schemaVersion: 1, model: 'test-model', protocol: 'chat-completions',
    capabilities: { conversation: true, connectionTool: true, sceneDraft: true, svg: true, vision: 'disabled', authoringVersions: [1, 2], baseMapVersions: [1, 2], budgetPolicyHashes: [CONTINUATION_POLICY.policyHash], ...changes },
    retentionDays: 7, limits: { modelRequests: 4, toolCalls: 8, executionMs: 120000, promptBytes: 16384, outputBytes: 65536 } })
  beforeAll(() => {
    const { requestId, workspaceSceneId, checkpoint, operationEpoch, base, generation } = terrainRequest
    request = prepareBaseMapRequestV2({ requestId, workspaceSceneId, checkpoint, operationEpoch, base, generation, flowId: 'transport-flow', policy: CONTINUATION_POLICY })
    response = executeBaseMapRequestV2(request)
  }, 30000)

  it('dispatches the original v2 envelope to the Worker and records actual per-flow attempts', async () => {
    const records: BaseMapGenerationExecution[] = [], { client, workers, fetcher } = setup()
    const pending = client.generate(request, { onExecution: value => records.push(value) })
    expect(workers[0].posted[0]).toEqual(request)
    workers[0].emit(executeBaseMapWorkerRequest(workers[0].posted[0]))
    await expect(pending).resolves.toEqual(response)
    expect(records[0]).toMatchObject({ generationCalls: 1 })
    expect(records[0].activeRuntimeMs).toBeGreaterThan(0)
    const again = client.generate(request, { onExecution: value => records.push(value) })
    workers[1].emit(response); await again
    expect(records[1].startedAt).toBe(records[0].startedAt)
    expect(records[1].generationCalls).toBe(2)
    expect(records[1].activeRuntimeMs).toBeGreaterThan(records[0].activeRuntimeMs)
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('negotiates exact v2 policy before posting to the server', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(url => Promise.resolve(jsonResponse(String(url).endsWith('/capabilities?authoringVersion=2') ? capabilities() : response)))
    const { client, createWorker } = setup({ fetcher })
    await expect(client.generate(request, { server })).resolves.toEqual(response)
    expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual(['https://ai.example.test/v1/capabilities?authoringVersion=2', 'https://ai.example.test/v1/terrain/basemap'])
    expect(fetcher.mock.calls[0][1]?.method).toBe('GET')
    expect(fetcher.mock.calls[1][1]?.body).toBe(canonicalJson(request))
    expect(createWorker).not.toHaveBeenCalled()
  })
  it.each([{ baseMapVersions: [1] as [1] }, { budgetPolicyHashes: ['f'.repeat(64)] },
    { authoringVersions: undefined, baseMapVersions: undefined, budgetPolicyHashes: undefined }])('refuses incompatible servers, including old servers ignoring the opt-in query, before sending candidate metadata', async changes => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(capabilities(changes))), { client, createWorker } = setup({ fetcher })
    await expect(client.generate(request, { server })).rejects.toMatchObject({ code: 'unavailable' })
    expect(fetcher).toHaveBeenCalledTimes(1); expect(createWorker).not.toHaveBeenCalled()
    expect(String(fetcher.mock.calls[0][0])).toBe('https://ai.example.test/v1/capabilities?authoringVersion=2')
  })
  it('rejects v1 downgrade, foreign flow and changed policy instead of repairing responses', async () => {
    for (const invalid of [terrainResponse, { ...response, flowId: 'other-flow' }, { ...response, policyHash: 'f'.repeat(64) }]) {
      const { client, workers } = setup(), pending = client.generate(request)
      workers[0].emit(invalid)
      await expect(pending).rejects.toMatchObject({ code: 'protocol' }); released(workers[0])
    }
  })
  it('retains cancelled execution in the same flow and does not start another attempt itself', async () => {
    const records: BaseMapGenerationExecution[] = [], { client, workers, createWorker } = setup()
    const pending = client.generate(request, { onExecution: value => records.push(value) }), failed = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    client.cancel(); await failed
    expect(createWorker).toHaveBeenCalledTimes(1); expect(records[0].generationCalls).toBe(1)
    const retried = client.generate(request, { onExecution: value => records.push(value) }); workers[1].emit(response); await retried
    expect(records[1].generationCalls).toBe(2)
  })
})
