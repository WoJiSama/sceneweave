import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createRefinedBlankDocument } from '../content/refined-blank.js'
import { generateTerrainDocument, TERRAIN_FIXED_SEEDS } from '../../../shared/terrain-generation/generate.js'
import { composeTerrainDocument } from '../../../shared/terrain-generation/compose.js'
import { prepareTerrainEdit, terrainEditRequestSchema, type TerrainEditResult } from '../../../shared/terrain-generation/edit.js'
import { canonicalJson, cloneJson } from '../../../shared/validation/json.js'
import { sha256Text } from '../../../shared/validation/hash.js'
import type { SceneDocument } from '../../../shared/model/scene.js'
import { createTerrainEditClient, type TerrainEditClient, type TerrainEditClientOptions,
  type TerrainEditRunRequest, type TerrainEditWorker, type TerrainEditWorkerRequest, type TerrainEditWorkerResponse } from './edit-client.js'
import { executeTerrainEditRequest } from './edit-worker.js'

let base: SceneDocument, generated: TerrainEditResult
let input: ReturnType<typeof terrainEditRequestSchema.parse>
beforeAll(() => {
  const blank = createRefinedBlankDocument('island', { title: 'Editing worker fixture', sceneId: 'terrain-edit-worker-scene',
    now: '2026-10-26T00:00:00.000Z', widthMm: 24000, heightMm: 18000, preset: 'narrative' })
  base = composeTerrainDocument(blank, generateTerrainDocument(blank, { sceneId: blank.sceneId, kind: 'island', seed: TERRAIN_FIXED_SEEDS[0] }), 'worker-birth').document
  input = terrainEditRequestSchema.parse({ kind: 'brush', sceneId: base.sceneId, operationId: 'edit-worker-operation',
    floorId: Object.keys(base.floors)[0], scopeMm: base.exportBoundsMm, linkMode: 'scenery', mode: 'clearArea',
    targetAreaId: 'terrain-low', materialRef: null, elevationMm: null, strokes: [{ pointsMm: [{ x: 2000, y: 2000 }], radiusMm: 300 }] })
  generated = prepareTerrainEdit(base, input)
  input = cloneJson(generated.request)
}, 30_000)
const request = (changes: Partial<TerrainEditRunRequest> = {}): TerrainEditRunRequest => ({ requestId: 'edit-worker-request',
  sceneId: base.sceneId, checkpoint: 4, operationEpoch: 7, base: cloneJson(base), input: cloneJson(input), ...changes })

class MockEditWorker implements TerrainEditWorker {
  onmessage: TerrainEditWorker['onmessage'] = null
  onerror: TerrainEditWorker['onerror'] = null
  onmessageerror: TerrainEditWorker['onmessageerror'] = null
  posted: TerrainEditWorkerRequest[] = []
  terminate = vi.fn()
  postMessage = vi.fn((message: unknown) => { this.posted.push(cloneJson(message) as TerrainEditWorkerRequest) })
  emit(data: unknown) { this.onmessage?.({ data } as MessageEvent<unknown>) }
}
const clients: TerrainEditClient[] = []
function setup(options: Pick<TerrainEditClientOptions, 'timeoutMs'> = {}) {
  const workers: MockEditWorker[] = []
  const createWorker = vi.fn(() => { const worker = new MockEditWorker(); workers.push(worker); return worker })
  const client = createTerrainEditClient({ ...options, createWorker }); clients.push(client)
  return { client, workers, createWorker }
}
function resultFor(request: TerrainEditWorkerRequest): Extract<TerrainEditWorkerResponse, { type: 'result' }> {
  return { version: 1, type: 'result', requestId: request.requestId, sceneId: request.sceneId, checkpoint: request.checkpoint,
    operationEpoch: request.operationEpoch, inputHash: request.inputHash, baseHash: request.baseHash,
    result: cloneJson(generated), resultHash: sha256Text(canonicalJson(generated)) }
}
function rehash(response: Extract<TerrainEditWorkerResponse, { type: 'result' }>) {
  const { request, document, cost, impact, steps } = response.result
  response.result.hash = sha256Text(canonicalJson({ request, document, cost, impact, steps }))
  response.resultHash = sha256Text(canonicalJson(response.result)); return response
}
const released = (worker: MockEditWorker) => {
  expect(worker.terminate).toHaveBeenCalledTimes(1)
  expect(worker.onmessage).toBeNull(); expect(worker.onerror).toBeNull(); expect(worker.onmessageerror).toBeNull()
}
afterEach(() => { for (const client of clients.splice(0)) client.dispose(); vi.useRealTimers(); vi.restoreAllMocks() })

describe('bounded terrain editing Worker protocol', () => {
  it('runs the pure editing core and independently freezes a fully validated result', async () => {
    const { client, workers } = setup(), source = request(), before = canonicalJson(source)
    const pending = client.edit(source), worker = workers[0], envelope = worker.posted[0]
    expect(envelope.sceneId).toBe(base.sceneId); expect(envelope.base.sceneId).toBe(base.sceneId)
    expect(envelope.inputHash).toBe(sha256Text(canonicalJson(input)))
    const response = executeTerrainEditRequest(envelope)
    expect(response.type).toBe('result'); worker.emit(response)
    const result = await pending
    expect(canonicalJson(result)).toBe(canonicalJson(generated)); expect(canonicalJson(source)).toBe(before)
    expect(Object.isFrozen(result)).toBe(true); expect(Object.isFrozen(result.document.generation)).toBe(true)
    released(worker)
  }, 30_000)

  it('captures before dispatch and never accepts a later caller mutation as part of the result', async () => {
    const { client, workers } = setup(), source = request(), pending = client.edit(source), worker = workers[0]
    const sent = canonicalJson(worker.posted[0]), response = resultFor(worker.posted[0])
    source.base.title = 'changed after posting'
    expect(canonicalJson(worker.posted[0])).toBe(sent)
    worker.emit(response); const result = await pending
    response.result.document.title = 'changed after delivery'
    expect(result.document.title).toBe(generated.document.title); released(worker)
  })

  it.each([
    ['request', 'requestId', 'foreign-request'], ['scene', 'sceneId', 'foreign-scene'],
    ['checkpoint', 'checkpoint', 5], ['epoch', 'operationEpoch', 8],
    ['input hash', 'inputHash', 'f'.repeat(64)], ['base hash', 'baseHash', 'e'.repeat(64)],
  ] as const)('refuses a different %s even with a valid document and result hash', async (_label, key, value) => {
    const { client, workers } = setup(), pending = client.edit(request()), worker = workers[0]
    worker.emit({ ...resultFor(worker.posted[0]), [key]: value })
    await expect(pending).rejects.toMatchObject({ code: 'stale' }); released(worker)
  })

  it('checks checkpoint guards at dispatch and receipt, including throwing guards', async () => {
    const { client, workers } = setup(); let current = 4
    const pending = client.edit(request(), { isCurrent: context => context.checkpoint === current })
    current = 5; workers[0].emit(resultFor(workers[0].posted[0]))
    await expect(pending).rejects.toMatchObject({ code: 'stale' }); released(workers[0])
    await expect(client.edit(request(), { isCurrent: () => { throw new Error('unmounted') } })).rejects.toMatchObject({ code: 'stale' })
    expect(workers).toHaveLength(1)
  })

  it('rejects modified hashes, forged validation flags and rehashed invalid documents or budgets', async () => {
    const { client, workers } = setup()
    const corruptions: ((response: Extract<TerrainEditWorkerResponse, { type: 'result' }>) => unknown)[] = [
      response => { response.result.document.title += 'tampered'; return response },
      response => ({ ...response, validated: true }),
      response => { response.result.hash = '0'.repeat(64); response.resultHash = sha256Text(canonicalJson(response.result)); return response },
      response => { response.result.request.operationId = 'different-operation'; return rehash(response) },
      response => { response.result.document.sceneId = 'foreign-scene'; return rehash(response) },
      response => { response.result.document.revision++; return rehash(response) },
      response => { response.result.document.createdAt = '2026-10-27T00:00:00.000Z'; return rehash(response) },
      response => { response.result.cost.total = 257; return rehash(response) },
      response => { response.result.cost.total = 0; return rehash(response) },
      response => { response.result.document.terrainConnections['terrain-stairs'].from.surfaceRef = { kind: 'terrainArea', id: 'missing-support' }; return rehash(response) },
    ]
    for (const [index, corrupt] of corruptions.entries()) {
      const pending = client.edit(request({ requestId: `tamper-${index}` })), worker = workers.at(-1)!
      worker.emit(corrupt(resultFor(worker.posted[0])))
      await expect(pending).rejects.toMatchObject({ code: 'protocol' }); released(worker)
    }
  })

  it('rejects foreign base identities, accessors and oversized responses without reading getters', async () => {
    const { client, workers, createWorker } = setup(), source = request(), getter = vi.fn(() => input)
    Object.defineProperty(source, 'input', { enumerable: true, get: getter })
    await expect(client.edit(source)).rejects.toMatchObject({ code: 'invalid_input' })
    expect(getter).not.toHaveBeenCalled(); expect(createWorker).not.toHaveBeenCalled()
    await expect(client.edit(request({ sceneId: 'different-scene' }))).rejects.toMatchObject({ code: 'invalid_input' })
    expect(createWorker).not.toHaveBeenCalled()
    const first = client.edit(request()), response = resultFor(workers[0].posted[0]), read = vi.fn(() => generated)
    Object.defineProperty(response, 'result', { enumerable: true, get: read }); workers[0].emit(response)
    await expect(first).rejects.toMatchObject({ code: 'protocol' }); expect(read).not.toHaveBeenCalled(); released(workers[0])
    const second = client.edit(request({ requestId: 'oversized' })), large = resultFor(workers[1].posted[0])
    large.result.document.title = 'x'.repeat(24 * 1024 * 1024 + 4096); workers[1].emit(large)
    await expect(second).rejects.toMatchObject({ code: 'protocol' }); released(workers[1])
  })

  it('cancels immediately and ignores a valid callback queued before cancellation', async () => {
    const { client, workers } = setup(), pending = client.edit(request()), worker = workers[0]
    const queued = worker.onmessage!, response = resultFor(worker.posted[0])
    client.cancel(); queued({ data: response } as MessageEvent<unknown>)
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' }); released(worker)
  })

  it('honors pre-abort without allocation and terminates an aborted live request', async () => {
    const { client, workers, createWorker } = setup(), aborted = new AbortController(); aborted.abort()
    await expect(client.edit(request(), { signal: aborted.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(createWorker).not.toHaveBeenCalled()
    const live = new AbortController(), pending = client.edit(request(), { signal: live.signal }); live.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' }); released(workers[0])
  })

  it('times out and ignores late results while clearing its pending timer', async () => {
    vi.useFakeTimers()
    const { client, workers } = setup({ timeoutMs: 50 }), pending = client.edit(request()), worker = workers[0]
    const failed = expect(pending).rejects.toMatchObject({ code: 'timeout' }), queued = worker.onmessage!, response = resultFor(worker.posted[0])
    await vi.advanceTimersByTimeAsync(50); await failed; queued({ data: response } as MessageEvent<unknown>)
    expect(vi.getTimerCount()).toBe(0); released(worker)
  })

  it('replaces an identical request and settles each request only once', async () => {
    const { client, workers } = setup(), first = client.edit(request()), failed = expect(first).rejects.toMatchObject({ name: 'AbortError' })
    const oldCallback = workers[0].onmessage!, oldResponse = resultFor(workers[0].posted[0])
    const second = client.edit(request()), resolved = vi.fn(); void second.then(resolved, () => undefined)
    oldCallback({ data: oldResponse } as MessageEvent<unknown>); await failed
    expect(resolved).not.toHaveBeenCalled(); released(workers[0])
    const callback = workers[1].onmessage!, response = resultFor(workers[1].posted[0])
    callback({ data: response } as MessageEvent<unknown>); callback({ data: response } as MessageEvent<unknown>)
    await second; expect(resolved).toHaveBeenCalledOnce(); released(workers[1])
  })

  it('releases Worker errors, unreadable messages and disposal, and refuses allocation afterward', async () => {
    const { client, workers } = setup(), pending = client.edit(request()), worker = workers[0], preventDefault = vi.fn()
    worker.onerror!({ preventDefault } as unknown as ErrorEvent)
    await expect(pending).rejects.toMatchObject({ code: 'generation_failed' }); expect(preventDefault).toHaveBeenCalledOnce(); released(worker)
    const unreadable = client.edit(request({ requestId: 'unreadable' })); workers[1].onmessageerror!({ data: undefined } as MessageEvent<unknown>)
    await expect(unreadable).rejects.toMatchObject({ code: 'protocol' }); released(workers[1]); client.dispose()
    await expect(client.edit(request())).rejects.toMatchObject({ code: 'disposed' }); expect(workers).toHaveLength(2)
  })

  it('keeps invalid Worker-side requests correlated without exposing a successful result', () => {
    const source = request(), envelope: TerrainEditWorkerRequest = { version: 1, type: 'edit', requestId: source.requestId!,
      sceneId: source.sceneId, checkpoint: source.checkpoint, operationEpoch: source.operationEpoch, base: source.base,
      input: cloneJson(input), inputHash: 'f'.repeat(64), baseHash: sha256Text(canonicalJson(source.base)) }
    expect(executeTerrainEditRequest(envelope)).toMatchObject({ type: 'error', requestId: source.requestId,
      checkpoint: source.checkpoint, operationEpoch: source.operationEpoch, error: { code: 'invalid_request' } })
  })
})
