import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateImageEnhancementCandidates } from '../../../shared/image-enhancement/index.js'
import { generateImageEnhancementCandidatesAsync, type ImageEnhancementWorkerRequest, type ImageEnhancementWorkerResponse } from './image-enhancement-worker.js'

class TestWorker {
  static instances: TestWorker[] = []
  onmessage: ((event: { data: ImageEnhancementWorkerResponse }) => void) | null = null
  onerror: ((event: { message: string }) => void) | null = null
  onmessageerror: (() => void) | null = null
  request?: ImageEnhancementWorkerRequest
  terminated = false
  constructor() { TestWorker.instances.push(this) }
  postMessage(value: ImageEnhancementWorkerRequest, transfer: ArrayBuffer[]) { this.request = structuredClone(value, { transfer }) }
  terminate() { this.terminated = true }
  complete() {
    const request = this.request!
    this.onmessage?.({ data: { ok: true, candidates: generateImageEnhancementCandidates(request.image, request.options) } })
  }
}
const image = () => ({ width: 2, height: 2, data: new Uint8ClampedArray([100, 80, 60, 255, 20, 20, 20, 255, 90, 70, 50, 128, 0, 0, 0, 0]) })
function install() { TestWorker.instances = []; vi.stubGlobal('Worker', TestWorker) }
afterEach(() => vi.unstubAllGlobals())

describe('disposable image enhancement worker', () => {
  it('transfers owned copies and releases the worker after all alternatives return', async () => {
    install()
    const source = image(), before = source.data.slice(), scopeMask = new Uint8Array([255, 0, 255, 0])
    const options = { direction: 'clarity' as const, count: 3 as 2 | 3, scopeMask }
    const pending = generateImageEnhancementCandidatesAsync(source, options)
    options.count = 2
    const worker = TestWorker.instances[0]
    expect(source.data).toEqual(before); expect(scopeMask).toEqual(new Uint8Array([255, 0, 255, 0]))
    expect(worker.request?.options.count).toBe(3)
    worker.complete()
    const candidates = await pending
    expect(candidates).toHaveLength(3); expect(worker.terminated).toBe(true); expect(worker.onmessage).toBeNull()
    expect(source.data).toEqual(before)
  })

  it('interrupts CPU work on cancellation and does not start a pre-cancelled request', async () => {
    install()
    const controller = new AbortController(), pending = generateImageEnhancementCandidatesAsync(image(), { direction: 'edge', count: 2 }, controller.signal)
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(TestWorker.instances[0].terminated).toBe(true)
    await expect(generateImageEnhancementCandidatesAsync(image(), { direction: 'edge', count: 2 }, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(TestWorker.instances).toHaveLength(1)
  })

  it('releases failed workers and rejects incomplete alternatives', async () => {
    install()
    const pending = generateImageEnhancementCandidatesAsync(image(), { direction: 'edge', count: 2 })
    TestWorker.instances[0].onerror?.({ message: 'failed to load worker' })
    await expect(pending).rejects.toThrow('failed to load worker')
    expect(TestWorker.instances[0].terminated).toBe(true)
    const malformed = generateImageEnhancementCandidatesAsync(image(), { direction: 'edge', count: 2 })
    TestWorker.instances[1].onmessage?.({ data: { ok: true, candidates: [] } })
    await expect(malformed).rejects.toThrow('无效候选')
    expect(TestWorker.instances[1].terminated).toBe(true)
  })

  it('rejects output budgets and unsupported browsers before starting any worker', async () => {
    install()
    const long = { width: 2049, height: 1, data: new Uint8ClampedArray(2049 * 4) }
    await expect(generateImageEnhancementCandidatesAsync(long, { direction: 'clarity', count: 2 })).rejects.toThrow('4096')
    expect(TestWorker.instances).toHaveLength(0)
    vi.stubGlobal('Worker', undefined)
    await expect(generateImageEnhancementCandidatesAsync(image(), { direction: 'edge', count: 2 })).rejects.toThrow('不支持')
  })
})
