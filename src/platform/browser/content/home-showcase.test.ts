import { afterEach, describe, expect, it, vi } from 'vitest'
import manifest from './home-showcase-manifest.json'
import { createHomeShowcaseProject } from './home-showcase.js'

vi.mock('../runtime.js', () => ({ runtime: { ids: { nextId: () => 'unused' }, clock: { now: () => '2026-11-12T00:00:00.000Z' } }, validation: {} }))
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('homepage fixed archive admission', () => {
  it('rejects unknown selection or an already cancelled operation without fetching resources', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
    await expect(createHomeShowcaseProject('__proto__' as never)).rejects.toThrow('未知')
    const controller = new AbortController(); controller.abort()
    await expect(createHomeShowcaseProject('volcano', controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('rejects unavailable or truncated archives before returning a project', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response('not found', { status: 404 }))
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3])))
    vi.stubGlobal('fetch', fetcher)
    await expect(createHomeShowcaseProject('volcano')).rejects.toThrow('404')
    await expect(createHomeShowcaseProject('volcano')).rejects.toThrow('摘要不同')
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('refuses same-length corrupted bytes and an oversized streaming response', async () => {
    const expected = manifest.entries.volcano.archiveBytes
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(new Uint8Array(expected)))
      .mockResolvedValueOnce(new Response(new Uint8Array(expected + 1))))
    await expect(createHomeShowcaseProject('volcano')).rejects.toThrow('摘要不同')
    await expect(createHomeShowcaseProject('volcano')).rejects.toThrow('固定字节预算')
  })

  it('cancels an in-flight archive reader without publishing a candidate or validation progress', async () => {
    const controller = new AbortController(), cancel = vi.fn(), progress = vi.fn()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new ReadableStream<Uint8Array>({
      cancel,
    }))))
    const pending = createHomeShowcaseProject('volcano', controller.signal, progress)
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    await new Promise<void>(resolve => setTimeout(resolve, 0))
    controller.abort()
    await rejected
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(progress.mock.calls.map(([value]) => value.phase)).toEqual(['resources'])
  })
})
