import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createRefinedBlankDocument } from '../content/refined-blank.js'
import { generateTerrainDocument, TERRAIN_FIXED_SEEDS, terrainGenerationInputSchema, type TerrainGenerationResult } from '../../../shared/terrain-generation/generate.js'
import { canonicalJson, cloneJson } from '../../../shared/validation/json.js'
import { sha256Text } from '../../../shared/validation/hash.js'
import { createTerrainGenerationClient, type TerrainGenerationClient, type TerrainGenerationClientOptions,
  type TerrainGenerationRunRequest, type TerrainGenerationWorker, type TerrainWorkerRequest, type TerrainWorkerResponse } from './client.js'
import { executeTerrainGenerationRequest } from './worker.js'

const input = terrainGenerationInputSchema.parse({ sceneId: 'terrain-worker-candidate', kind: 'island', seed: TERRAIN_FIXED_SEEDS[0] })
const blank = () => createRefinedBlankDocument('island', { title: 'Worker protocol fixture', sceneId: input.sceneId,
  now: '2026-10-26T00:00:00.000Z', widthMm: 24000, heightMm: 18000, preset: 'narrative' })
const request = (changes: Partial<TerrainGenerationRunRequest> = {}): TerrainGenerationRunRequest => ({ requestId: 'worker-request',
  sceneId: 'current-workspace', checkpoint: 4, operationEpoch: 7, base: blank(), input: cloneJson(input), ...changes })
let generated: TerrainGenerationResult
beforeAll(() => { generated = generateTerrainDocument(blank(), input) }, 20_000)

class MockTerrainWorker implements TerrainGenerationWorker {
  onmessage: TerrainGenerationWorker['onmessage'] = null
  onerror: TerrainGenerationWorker['onerror'] = null
  onmessageerror: TerrainGenerationWorker['onmessageerror'] = null
  posted: TerrainWorkerRequest[] = []
  terminate = vi.fn()
  postMessage = vi.fn((message: unknown) => { this.posted.push(cloneJson(message) as TerrainWorkerRequest) })
  emit(data: unknown) { this.onmessage?.({ data } as MessageEvent<unknown>) }
}
const clients: TerrainGenerationClient[] = []
function setup(options: Pick<TerrainGenerationClientOptions, 'timeoutMs'> = {}) {
  const workers: MockTerrainWorker[] = []
  const createWorker = vi.fn(() => { const worker = new MockTerrainWorker(); workers.push(worker); return worker })
  const client = createTerrainGenerationClient({ ...options, createWorker }); clients.push(client)
  return { client, workers, createWorker }
}
function resultFor(request: TerrainWorkerRequest): Extract<TerrainWorkerResponse, { type: 'result' }> {
  return { version: 1, type: 'result', requestId: request.requestId, sceneId: request.sceneId, checkpoint: request.checkpoint,
    operationEpoch: request.operationEpoch, inputHash: request.inputHash, baseHash: request.baseHash,
    result: cloneJson(generated), resultHash: sha256Text(canonicalJson(generated)) }
}
function rehash(response: Extract<TerrainWorkerResponse, { type: 'result' }>) {
  response.resultHash = sha256Text(canonicalJson(response.result))
  return response
}
const assertReleased = (worker: MockTerrainWorker) => {
  expect(worker.terminate).toHaveBeenCalledTimes(1)
  expect(worker.onmessage).toBeNull(); expect(worker.onerror).toBeNull(); expect(worker.onmessageerror).toBeNull()
}
afterEach(() => { for (const client of clients.splice(0)) client.dispose(); vi.useRealTimers(); vi.restoreAllMocks() })

describe('bounded native terrain Worker protocol', () => {
  it('round trips a real deterministic candidate without confusing current and candidate scene identities', async () => {
    const { client, workers } = setup(), source = request(), before = canonicalJson(source)
    const pending = client.generate(source), worker = workers[0], envelope = worker.posted[0]
    expect(envelope.sceneId).toBe('current-workspace')
    expect(envelope.base.sceneId).toBe(input.sceneId); expect(envelope.input.sceneId).toBe(input.sceneId)
    expect(envelope.inputHash).toBe(sha256Text(canonicalJson(input)))
    const response = executeTerrainGenerationRequest(envelope)
    expect(response.type).toBe('result')
    worker.emit(response)
    const result = await pending
    expect(canonicalJson(result)).toBe(canonicalJson(generated))
    expect(Object.isFrozen(result)).toBe(true); expect(Object.isFrozen(result.document.terrainAreas)).toBe(true)
    expect(canonicalJson(source)).toBe(before); assertReleased(worker)
  }, 20_000)

  it('independently captures inputs before posting and validates a result independently of later caller edits', async () => {
    const { client, workers } = setup(), source = request(), pending = client.generate(source), worker = workers[0]
    const sent = canonicalJson(worker.posted[0]), response = resultFor(worker.posted[0])
    source.base.title = 'changed after dispatch'; (source.input as typeof input).seed = 'changed-after-dispatch'
    expect(canonicalJson(worker.posted[0])).toBe(sent)
    worker.emit(response)
    const result = await pending
    response.result.document.title = 'changed after delivery'
    expect(result.document.title).toBe(generated.document.title); assertReleased(worker)
  })

  it.each([
    ['request identity', 'requestId', 'foreign-request'], ['workspace identity', 'sceneId', 'foreign-workspace'],
    ['checkpoint', 'checkpoint', 5], ['operation epoch', 'operationEpoch', 8],
    ['input hash', 'inputHash', 'f'.repeat(64)], ['base hash', 'baseHash', 'e'.repeat(64)],
  ] as const)('rejects a stale %s even when the candidate and its hash are valid', async (_label, key, value) => {
    const { client, workers } = setup(), pending = client.generate(request()), worker = workers[0]
    const response = { ...resultFor(worker.posted[0]), [key]: value }
    worker.emit(response)
    await expect(pending).rejects.toMatchObject({ code: 'stale' }); assertReleased(worker)
  })

  it('checks the host checkpoint again at receipt and rejects throwing host guards', async () => {
    const { client, workers } = setup()
    let current = 4
    const pending = client.generate(request(), { isCurrent: context => context.checkpoint === current })
    current = 5; workers[0].emit(resultFor(workers[0].posted[0]))
    await expect(pending).rejects.toMatchObject({ code: 'stale' }); assertReleased(workers[0])
    await expect(client.generate(request(), { isCurrent: () => { throw new Error('unmounted') } })).rejects.toMatchObject({ code: 'stale' })
    expect(workers).toHaveLength(1)
  })

  it('rejects a modified result hash and unknown response fields', async () => {
    const { client, workers } = setup()
    const first = client.generate(request()), response = resultFor(workers[0].posted[0])
    response.result.document.title += 'tampered'; workers[0].emit(response)
    await expect(first).rejects.toMatchObject({ code: 'protocol' }); assertReleased(workers[0])
    const second = client.generate(request({ requestId: 'second' }))
    workers[1].emit({ ...resultFor(workers[1].posted[0]), validated: true })
    await expect(second).rejects.toMatchObject({ code: 'protocol' }); assertReleased(workers[1])
  })

  it('rejects rehashed candidates whose input, identity, cost or geometry is invalid', async () => {
    const corruptions: ((result: TerrainGenerationResult) => void)[] = [
      result => { result.input.seed = TERRAIN_FIXED_SEEDS[1] },
      result => { result.document.sceneId = 'different-candidate' },
      result => { result.cost.total = 257 },
      result => { result.document.terrainConnections['terrain-stairs'].from.surfaceRef = { kind: 'terrainArea', id: 'missing-support' } },
    ]
    for (const [index, corrupt] of corruptions.entries()) {
      const { client, workers } = setup(), pending = client.generate(request({ requestId: `tamper-${index}` }))
      const response = resultFor(workers[0].posted[0]); corrupt(response.result); workers[0].emit(rehash(response))
      await expect(pending).rejects.toMatchObject({ code: 'protocol' }); assertReleased(workers[0])
    }
  })

  it('rejects oversized payloads and accessors without accepting a validation flag or reading getters', async () => {
    const { client, workers, createWorker } = setup(), hostile = request(), getter = vi.fn(() => input)
    Object.defineProperty(hostile, 'input', { enumerable: true, get: getter })
    await expect(client.generate(hostile)).rejects.toMatchObject({ code: 'invalid_input' })
    expect(getter).not.toHaveBeenCalled(); expect(createWorker).not.toHaveBeenCalled()
    const pending = client.generate(request()), response = resultFor(workers[0].posted[0]), read = vi.fn(() => generated)
    Object.defineProperty(response, 'result', { enumerable: true, get: read })
    workers[0].emit(response)
    await expect(pending).rejects.toMatchObject({ code: 'protocol' }); expect(read).not.toHaveBeenCalled(); assertReleased(workers[0])
    const oversized = client.generate(request({ requestId: 'oversized' })), large = resultFor(workers[1].posted[0])
    large.result.document.title = 'x'.repeat(8 * 1024 * 1024 + 4096)
    workers[1].emit(large)
    await expect(oversized).rejects.toMatchObject({ code: 'protocol' }); assertReleased(workers[1])
  })

  it('cancels the active worker immediately and ignores a callback already queued before cancellation', async () => {
    const { client, workers } = setup(), pending = client.generate(request()), worker = workers[0]
    const queued = worker.onmessage!, response = resultFor(worker.posted[0])
    client.cancel(); queued({ data: response } as MessageEvent<unknown>)
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' }); assertReleased(worker)
  })

  it('honors a pre-aborted signal without allocation and releases a worker aborted after dispatch', async () => {
    const { client, workers, createWorker } = setup(), controller = new AbortController()
    controller.abort()
    await expect(client.generate(request(), { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(createWorker).not.toHaveBeenCalled()
    const live = new AbortController(), pending = client.generate(request(), { signal: live.signal })
    live.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' }); assertReleased(workers[0])
  })

  it('terminates after timeout, clears the timer and ignores a late valid result', async () => {
    vi.useFakeTimers()
    const { client, workers } = setup({ timeoutMs: 50 }), pending = client.generate(request()), worker = workers[0]
    const failure = expect(pending).rejects.toMatchObject({ code: 'timeout' }), queued = worker.onmessage!, response = resultFor(worker.posted[0])
    await vi.advanceTimersByTimeAsync(50); await failure
    queued({ data: response } as MessageEvent<unknown>)
    assertReleased(worker); expect(vi.getTimerCount()).toBe(0)
  })

  it('replaces even an identical request with a new worker and settles each request only once', async () => {
    const { client, workers } = setup(), first = client.generate(request()), firstFailure = expect(first).rejects.toMatchObject({ name: 'AbortError' })
    const oldCallback = workers[0].onmessage!, oldResponse = resultFor(workers[0].posted[0])
    const second = client.generate(request()), resolved = vi.fn(); void second.then(resolved, () => undefined)
    oldCallback({ data: oldResponse } as MessageEvent<unknown>)
    await firstFailure; expect(resolved).not.toHaveBeenCalled(); assertReleased(workers[0])
    const callback = workers[1].onmessage!, response = resultFor(workers[1].posted[0])
    callback({ data: response } as MessageEvent<unknown>); callback({ data: response } as MessageEvent<unknown>)
    await second; expect(resolved).toHaveBeenCalledTimes(1); assertReleased(workers[1])
  })

  it('releases errors and refuses to allocate after disposal', async () => {
    const { client, workers } = setup(), pending = client.generate(request()), worker = workers[0], preventDefault = vi.fn()
    worker.onerror!({ preventDefault } as unknown as ErrorEvent)
    await expect(pending).rejects.toMatchObject({ code: 'generation_failed' }); expect(preventDefault).toHaveBeenCalledOnce(); assertReleased(worker)
    const unreadable = client.generate(request({ requestId: 'unreadable' }))
    workers[1].onmessageerror!({ data: undefined } as MessageEvent<unknown>)
    await expect(unreadable).rejects.toMatchObject({ code: 'protocol' }); assertReleased(workers[1])
    client.dispose()
    await expect(client.generate(request())).rejects.toMatchObject({ code: 'disposed' }); expect(workers).toHaveLength(2)
  })

  it('keeps worker-side invalid input failures correlated with the request', () => {
    const source = request(), envelope: TerrainWorkerRequest = { version: 1, type: 'generate', requestId: source.requestId!,
      sceneId: source.sceneId, checkpoint: source.checkpoint, operationEpoch: source.operationEpoch,
      base: source.base, input: cloneJson(input), inputHash: 'f'.repeat(64), baseHash: sha256Text(canonicalJson(source.base)) }
    expect(executeTerrainGenerationRequest(envelope)).toMatchObject({ type: 'error', requestId: source.requestId,
      checkpoint: source.checkpoint, operationEpoch: source.operationEpoch, error: { code: 'invalid_request' } })
  })
})
