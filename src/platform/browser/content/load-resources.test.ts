import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AssetRecord } from '../../../shared/model/project.js'
import { PACKAGE_LIMITS } from '../../../shared/project/limits.js'
import { CONTENT_FETCH_CONCURRENCY, boundedResponseBytes, loadFixedResources, type ContentLoadProgress } from './load-resources.js'

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })
const hash = (index: number) => (index + 1).toString(16).padStart(64, '0')
function fixture(count: number) {
  const assets: Record<string, AssetRecord> = {}, paths: Record<string, string> = {}
  for (let index = 0; index < count; index++) {
    assets[hash(index)] = { sha256: hash(index), mimeType: 'image/png', sizeBytes: 1, pixelWidth: 1, pixelHeight: 1 }
    paths[hash(index)] = `assets/sceneweave-handdrawn/test-${index}.png`
  }
  return { assets, paths }
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { resolve, promise } }
const tick = () => new Promise<void>(resolve => queueMicrotask(resolve))

describe('bounded fixed content byte loading', () => {
  it('runs at most four reads, preserves deterministic hash order and reports resource progress', async () => {
    const { assets, paths } = fixture(9), gates: ReturnType<typeof deferred<Response>>[] = [], progress: ContentLoadProgress[] = []
    let active = 0, peak = 0
    const fetcher = vi.fn(async () => {
      active++; peak = Math.max(peak, active)
      const gate = deferred<Response>(); gates.push(gate)
      try { return await gate.promise } finally { active-- }
    })
    vi.stubGlobal('fetch', fetcher)
    const pending = loadFixedResources(assets, paths, {}, { onProgress: value => progress.push(value) })
    expect(fetcher).toHaveBeenCalledTimes(CONTENT_FETCH_CONCURRENCY)
    let released = 0
    while (released < 9) {
      for (const gate of gates.slice(released)) { gate.resolve(new Response(new Uint8Array([released++]))); }
      await tick(); await tick(); await tick(); await tick()
    }
    const result = await pending
    expect(peak).toBe(4); expect(fetcher).toHaveBeenCalledTimes(9)
    expect([...result.keys()]).toEqual(Object.keys(assets))
    expect(progress.map(value => value.completed)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(progress.every(value => value.phase === 'resources' && value.total === 9)).toBe(true)
  })

  it('closes the queue on the first failure, aborts other readers and rejects without publishing partial bytes', async () => {
    const { assets, paths } = fixture(12), gates: ReturnType<typeof deferred<Response>>[] = [], signals: AbortSignal[] = []
    const fetcher = vi.fn(async (_path: string, options: RequestInit) => {
      const signal = options.signal as AbortSignal; signals.push(signal)
      const gate = deferred<Response>(); gates.push(gate)
      return new Promise<Response>((resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
        void gate.promise.then(resolve)
      })
    })
    vi.stubGlobal('fetch', fetcher)
    const pending = loadFixedResources(assets, paths, {})
    const rejected = expect(pending).rejects.toThrow('404')
    expect(fetcher).toHaveBeenCalledTimes(4)
    gates[0].resolve(new Response(null, { status: 404 }))
    await rejected
    expect(fetcher).toHaveBeenCalledTimes(4); expect(signals.every(signal => signal.aborted)).toBe(true)
  })

  it('cancels a stalled response stream immediately and does not dispatch the remaining requests', async () => {
    const { assets, paths } = fixture(8), abort = new AbortController(), cancelled = vi.fn()
    const fetcher = vi.fn(async () => new Response(new ReadableStream<Uint8Array>({ cancel: cancelled })))
    vi.stubGlobal('fetch', fetcher)
    const pending = loadFixedResources(assets, paths, {}, { signal: abort.signal })
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    await tick(); abort.abort(); await rejected
    expect(fetcher).toHaveBeenCalledTimes(4); expect(cancelled).toHaveBeenCalledTimes(4)
  })

  it('checks all fixed paths and cumulative protection budgets before any fetch, including structural cancellation', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
    const invalid = fixture(5); invalid.paths[hash(4)] = '../private.png'
    await expect(loadFixedResources(invalid.assets, invalid.paths, {})).rejects.toThrow('路径无效')
    const oversized = fixture(16)
    for (const record of Object.values(oversized.assets)) record.sizeBytes = PACKAGE_LIMITS.imageBytes
    await expect(loadFixedResources(oversized.assets, oversized.paths, {})).rejects.toThrow('字节超过保护预算')
    const excessiveCount = fixture(PACKAGE_LIMITS.uniqueImages + 1)
    await expect(loadFixedResources(excessiveCount.assets, excessiveCount.paths, {})).rejects.toThrow('图片数量')
    await expect(loadFixedResources(fixture(1).assets, fixture(1).paths, {}, { signal: { aborted: true } })).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('retains exact lengths and owned bytes for embedded images and cancels oversized streams', async () => {
    const { assets } = fixture(1), value = new Uint8Array([7])
    const result = await loadFixedResources(assets, {}, { [hash(0)]: btoa(String.fromCharCode(...value)) })
    expect(result.get(hash(0))).toEqual(value)
    await expect(loadFixedResources(assets, {}, { [hash(0)]: 'AAAA' })).rejects.toThrow('实际图片')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([1, 2]))))
    await expect(loadFixedResources(assets, fixture(1).paths, {})).rejects.toThrow('固定字节预算')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array())))
    await expect(loadFixedResources(assets, fixture(1).paths, {})).rejects.toThrow('实际字节长度')
    const cancelled = vi.fn(), oversized = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array([1, 2])) }, cancel: cancelled })
    await expect(boundedResponseBytes(new Response(oversized), 1, {})).rejects.toThrow('固定字节预算')
    expect(cancelled).toHaveBeenCalledOnce()
  })
})
