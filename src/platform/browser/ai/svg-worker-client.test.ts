import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { normalizeStaticSvg } from '../../../shared/ai/svg.js'
import { disposeCanonicalSvgWorkers, rasterizeCanonicalSvgInWorker } from './svg-worker-client.js'
import { copyCanonicalSvgModule } from './svg-raster.js'
import type { CanonicalSvgWorkerRequest } from './svg-worker.js'

vi.mock('./svg-raster.js', () => ({ copyCanonicalSvgModule: vi.fn() }))

class FakeWorker {
  static instances: FakeWorker[] = []
  static failPost = false
  onmessage: ((event: { data: unknown }) => void) | null = null
  onerror: ((event: { preventDefault(): void }) => void) | null = null
  onmessageerror: (() => void) | null = null
  terminate = vi.fn()
  postMessage = vi.fn((_request: CanonicalSvgWorkerRequest, _transfer: Transferable[]) => {
    if (FakeWorker.failPost) throw new Error('posting failed')
  })
  constructor() { FakeWorker.instances.push(this) }
  reply(width = 4, height = 2) { this.onmessage?.({ data: { ok: true, width, height, rgba: new Uint8ClampedArray(width * height * 4) } }) }
}
const source = normalizeStaticSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 2"><rect x="0" y="0" width="4" height="2" fill="#804020"/></svg>')
const run = (signal?: AbortSignal | { aborted: boolean }) => rasterizeCanonicalSvgInWorker(source, { width: 4, height: 2 }, signal)
const drain = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }

describe('bounded fixed SVG worker lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers(); FakeWorker.instances = []; FakeWorker.failPost = false
    vi.stubGlobal('Worker', FakeWorker)
    vi.mocked(copyCanonicalSvgModule).mockReset().mockImplementation(async () => Uint8Array.of(1, 2, 3))
  })
  afterEach(async () => { disposeCanonicalSvgWorkers(); await drain(); vi.unstubAllGlobals(); vi.useRealTimers() })

  it('serializes canonical WASM work, reuses one idle instance and releases it', async () => {
    const first = run(), second = run(), third = run()
    await drain(); expect(FakeWorker.instances).toHaveLength(1)
    const worker = FakeWorker.instances[0]
    const [request, transfer] = worker.postMessage.mock.calls[0]
    expect(request.moduleBytes).toEqual(Uint8Array.of(1, 2, 3))
    expect(transfer).toEqual([request.moduleBytes!.buffer])
    worker.reply(); expect((await first).rgba).toHaveLength(32)
    await drain(); expect(FakeWorker.instances).toHaveLength(1)
    expect(worker.postMessage).toHaveBeenCalledTimes(2)
    worker.reply(); await second; await drain()
    expect(worker.postMessage).toHaveBeenCalledTimes(3)
    expect(worker.postMessage.mock.calls.slice(1).map(([message, buffers]) => [message.moduleBytes, buffers])).toEqual([[undefined, []], [undefined, []]])
    expect(copyCanonicalSvgModule).toHaveBeenCalledOnce()
    worker.reply(); await third; await vi.advanceTimersByTimeAsync(5000)
    expect(worker.terminate).toHaveBeenCalledOnce()
  })

  it('cancels an in-flight module load and ignores its late result', async () => {
    let loaded!: (bytes: Uint8Array<ArrayBuffer>) => void
    vi.mocked(copyCanonicalSvgModule).mockImplementationOnce(() => new Promise(resolve => { loaded = resolve }))
    const controller = new AbortController(), task = run(controller.signal)
    const rejected = expect(task).rejects.toMatchObject({ name: 'AbortError' })
    await drain()
    const worker = FakeWorker.instances[0], loadSignal = vi.mocked(copyCanonicalSvgModule).mock.calls[0][0]
    controller.abort(); await rejected
    expect(loadSignal?.aborted).toBe(true)
    expect(worker.terminate).toHaveBeenCalledOnce()
    loaded(Uint8Array.of(1, 2, 3)); await drain()
    expect(worker.postMessage).not.toHaveBeenCalled()
    const next = run(); await drain(); FakeWorker.instances.at(-1)!.reply(); await next
  })

  it('rejects malformed dimensions and worker messages before returning usable pixels', async () => {
    await expect(rasterizeCanonicalSvgInWorker(source, { width: 4097, height: 2 })).rejects.toThrow(/保护预算/)
    expect(FakeWorker.instances).toHaveLength(0)
    const task = run(), rejected = expect(task).rejects.toThrow(/实际像素/)
    await drain(); FakeWorker.instances[0].reply(3, 2); await rejected
    expect(FakeWorker.instances[0].terminate).toHaveBeenCalledOnce()
  })

  it('terminates cancelled admitted work immediately and removes listeners', async () => {
    const controller = new AbortController(), remove = vi.spyOn(controller.signal, 'removeEventListener')
    const task = run(controller.signal), rejected = expect(task).rejects.toMatchObject({ name: 'AbortError' })
    await drain(); const worker = FakeWorker.instances[0], late = worker.onmessage
    controller.abort(); await rejected
    expect(worker.terminate).toHaveBeenCalledOnce(); expect(worker.onmessage).toBeNull()
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function))
    late?.({ data: { ok: true, width: 4, height: 2, rgba: new Uint8ClampedArray(32) } })
    expect(worker.terminate).toHaveBeenCalledOnce()
  })

  it('observes flag-only cancellation, rejects queued page work and can restart after pagehide', async () => {
    const signal = { aborted: false }, first = run(signal), second = run(), third = run()
    const rejected = [first, second, third].map(task => expect(task).rejects.toMatchObject({ name: 'AbortError' }))
    await drain(); signal.aborted = true; await vi.advanceTimersByTimeAsync(50)
    disposeCanonicalSvgWorkers(); await Promise.all(rejected); await drain()
    expect(FakeWorker.instances.every(worker => worker.terminate.mock.calls.length === 1)).toBe(true)
    const restarted = run(); await drain(); FakeWorker.instances.at(-1)!.reply(); await restarted
  })

  it.each(['error', 'messageerror', 'timeout', 'postMessage'] as const)('releases queue capacity after %s', async kind => {
    FakeWorker.failPost = kind === 'postMessage'
    const first = run(), rejected = expect(first).rejects.toThrow()
    // A synchronous posting error still has to remove all listeners/timers.
    await drain(); const worker = FakeWorker.instances[0]
    if (kind === 'error') worker.onerror?.({ preventDefault() {} })
    if (kind === 'messageerror') worker.onmessageerror?.()
    if (kind === 'timeout') await vi.advanceTimersByTimeAsync(120_000)
    await rejected; expect(worker.terminate).toHaveBeenCalledOnce()
    FakeWorker.failPost = false
    const next = run(); await drain(); FakeWorker.instances.at(-1)!.reply(); await next
  })
})
