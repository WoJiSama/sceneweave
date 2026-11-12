import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { auditHistoryInWorker, disposeHistoryAudits } from './history-audit-client.js'

class FakeWorker {
  static instances: FakeWorker[] = []
  static failPost = false
  onmessage: ((event: { data: unknown }) => void) | null = null
  onerror: ((event: { preventDefault(): void }) => void) | null = null
  onmessageerror: (() => void) | null = null
  terminate = vi.fn()
  postMessage = vi.fn(() => { if (FakeWorker.failPost) throw new Error('posting failed') })
  constructor() { FakeWorker.instances.push(this) }
  reply(data: unknown = { ok: true, documentBytes: 0 }) { this.onmessage?.({ data }) }
}
const drain = async () => { for (let i = 0; i < 20; i++) await Promise.resolve() }
const run = (signal?: AbortSignal | { aborted: boolean }) => auditHistoryInWorker('owner', null, [], [], signal)

describe('transaction-bound complete history worker lifecycle', () => {
  beforeEach(() => { vi.useFakeTimers(); FakeWorker.instances = []; FakeWorker.failPost = false; vi.stubGlobal('Worker', FakeWorker) })
  afterEach(async () => { disposeHistoryAudits(); await drain(); vi.unstubAllGlobals(); vi.useRealTimers() })

  it('runs only one complete graph at a time and terminates each worker on success', async () => {
    const first = run(), second = run(); await drain()
    expect(FakeWorker.instances).toHaveLength(1)
    const worker = FakeWorker.instances[0]
    expect(worker.postMessage).toHaveBeenCalledWith({ owner: 'owner', head: null, versions: [], pins: [] })
    worker.reply(); await expect(first).resolves.toEqual({ documentBytes: 0 }); await drain()
    expect(worker.terminate).toHaveBeenCalledOnce(); expect(FakeWorker.instances).toHaveLength(2)
    FakeWorker.instances[1].reply(); await second
    expect(FakeWorker.instances[1].terminate).toHaveBeenCalledOnce()
  })

  it.each([-1, 1.5, NaN, Number.MAX_SAFE_INTEGER + 1, '12', undefined])('rejects malformed accounting result %s', async value => {
    const task = run(), rejected = expect(task).rejects.toThrow(/计量结果/)
    await drain(); FakeWorker.instances[0].reply({ ok: true, documentBytes: value }); await rejected
    expect(FakeWorker.instances[0].terminate).toHaveBeenCalledOnce()
  })

  it('propagates complete validation failure and never turns it into an empty-graph success', async () => {
    const task = run(), rejected = expect(task).rejects.toThrow('inactive branch corrupt')
    await drain(); FakeWorker.instances[0].reply({ ok: false, message: 'inactive branch corrupt' }); await rejected
  })

  it('observes transaction/flag cancellation, ignores late results and frees the queue', async () => {
    const signal = { aborted: false }, first = run(signal), rejected = expect(first).rejects.toMatchObject({ name: 'AbortError' })
    await drain(); const worker = FakeWorker.instances[0], late = worker.onmessage
    signal.aborted = true; await vi.advanceTimersByTimeAsync(50); await rejected
    late?.({ data: { ok: true, documentBytes: 0 } })
    expect(worker.terminate).toHaveBeenCalledOnce(); expect(worker.onmessage).toBeNull()
    const next = run(); await drain(); FakeWorker.instances[1].reply(); await next
  })

  it('cancels active and queued page work and admits fresh work after restore', async () => {
    const first = run(), second = run()
    const rejected = [first, second].map(task => expect(task).rejects.toMatchObject({ name: 'AbortError' }))
    await drain(); disposeHistoryAudits(); await Promise.all(rejected)
    expect(FakeWorker.instances).toHaveLength(1)
    const restored = run(); await drain(); FakeWorker.instances[1].reply(); await restored
  })

  it.each(['error', 'messageerror', 'post', 'timeout'] as const)('rejects and terminates on %s without bypassing the audit', async kind => {
    FakeWorker.failPost = kind === 'post'
    const first = run(), rejected = expect(first).rejects.toThrow(); await drain()
    const worker = FakeWorker.instances[0]
    if (kind === 'error') worker.onerror?.({ preventDefault() {} })
    if (kind === 'messageerror') worker.onmessageerror?.()
    if (kind === 'timeout') await vi.advanceTimersByTimeAsync(120_000)
    await rejected; expect(worker.terminate).toHaveBeenCalledOnce()
    FakeWorker.failPost = false
    const next = run(); await drain(); FakeWorker.instances[1].reply(); await next
  })
})
