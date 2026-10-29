import { afterEach, describe, expect, it, vi } from 'vitest'
import { computeTerrainComposition } from './composition-client.js'
import type { TerrainCompositionInput, TerrainCompositionPlan } from '../../../shared/terrain-generation/composition-field.js'

const input = (): TerrainCompositionInput => ({ seed: 'worker-composition', boundsMm: { x: 0, y: 0, width: 12000, height: 12000 },
  precision: { sampleSpacingMm: 2000, toleranceMm: 100, noiseCellMm: 2000 }, baseElevationMm: 0, landCoveragePpm: 300000, elevationCoveragePpm: 0,
  features: { land: { id: 'land', floorId: 'floor', layerId: 'layer', visibility: 'public', editLocked: false, kind: 'landmass', shape: { kind: 'ellipse', centerMm: { x: 6000, y: 6000 }, radiusXMm: 3000, radiusYMm: 2500, rotationMilliDeg: 0 }, elevationMm: 500, roughnessPpm: 0, seedKey: 'stable' } },
  members: [{ featureId: 'land', field: 'land', operation: 'add', weightPpm: 1_000_000 }] })

class MockWorker {
  static workers: MockWorker[] = []
  static postError: unknown = undefined
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null
  posted: unknown[] = []
  terminated = false
  constructor() { MockWorker.workers.push(this) }
  postMessage(value: unknown): void { if (MockWorker.postError !== undefined) throw MockWorker.postError; this.posted.push(value) }
  terminate(): void { this.terminated = true }
}
const latest = (): MockWorker => MockWorker.workers.at(-1)!
const deliver = (worker: MockWorker, value: unknown): void => worker.onmessage?.({ data: value } as MessageEvent<unknown>)

afterEach(() => {
  vi.useRealTimers(); vi.unstubAllGlobals(); MockWorker.workers = []; MockWorker.postError = undefined
})

describe('terrain composition Worker lifecycle', () => {
  it('rejects a pre-aborted request before constructing a Worker', async () => {
    vi.stubGlobal('Worker', MockWorker)
    const controller = new AbortController(); controller.abort()
    await expect(computeTerrainComposition(input(), controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(MockWorker.workers).toHaveLength(0)
  })

  it('terminates an in-flight request on abort and ignores a late success', async () => {
    vi.stubGlobal('Worker', MockWorker)
    const controller = new AbortController(), pending = computeTerrainComposition(input(), controller.signal), worker = latest(), late = worker.onmessage!
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(worker.terminated).toBe(true)
    late({ data: { ok: true, plan: {} as TerrainCompositionPlan } } as MessageEvent<unknown>)
    expect(worker.terminated).toBe(true)
  })

  it('times out at the hard 30 second bound and discards a delayed result', async () => {
    vi.useFakeTimers(); vi.stubGlobal('Worker', MockWorker)
    const pending = computeTerrainComposition(input(), new AbortController().signal), failure = expect(pending).rejects.toThrow('超过30秒'), worker = latest(), late = worker.onmessage!
    await vi.advanceTimersByTimeAsync(30_000)
    await failure
    late({ data: { ok: true, plan: {} as TerrainCompositionPlan } } as MessageEvent<unknown>)
    expect(worker.terminated).toBe(true)
  })

  it.each([
    ['worker error', (worker: MockWorker) => worker.onerror?.({ message: 'boom' } as ErrorEvent), 'boom'],
    ['messageerror', (worker: MockWorker) => worker.onmessageerror?.({ data: null } as MessageEvent<unknown>), '无法解码'],
  ])('cleans up on %s', async (_label, fail, message) => {
    vi.stubGlobal('Worker', MockWorker)
    const pending = computeTerrainComposition(input(), new AbortController().signal), failure = expect(pending).rejects.toThrow(message), worker = latest()
    fail(worker)
    await failure
    expect(worker.terminated).toBe(true)
  })

  it('cleans up when posting to the Worker fails', async () => {
    vi.stubGlobal('Worker', MockWorker); MockWorker.postError = new Error('post failed')
    const pending = computeTerrainComposition(input(), new AbortController().signal), failure = expect(pending).rejects.toThrow('post failed'), worker = latest()
    await failure
    expect(worker.terminated).toBe(true)
  })

  it('accepts one valid response and releases all handlers', async () => {
    vi.stubGlobal('Worker', MockWorker)
    const pending = computeTerrainComposition(input(), new AbortController().signal), worker = latest(), callback = worker.onmessage!
    const plan = { algorithmId: 'terrain-compose', algorithmVersion: 1 } as TerrainCompositionPlan
    const resolved = expect(pending).resolves.toEqual(plan)
    deliver(worker, { ok: true, plan })
    await resolved
    callback({ data: { ok: true, plan: { bogus: true } } } as MessageEvent<unknown>)
    expect(worker.terminated).toBe(true)
  })
})
