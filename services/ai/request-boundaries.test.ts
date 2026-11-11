import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { connectionInfo, createAiApp } from './app.js'
import { loadAiConfig } from './config.js'
import { TaskEngine } from './engine.js'
import { TaskStore } from './store.js'
import { ProviderFailure, type ProviderAdapter, type ProviderCompletion, type ProviderInput } from './provider-types.js'

const token = 'd'.repeat(40), origin = 'https://request-boundary.test'
const cleanups: (() => void | Promise<void>)[] = []
afterEach(async () => { for (const clean of cleanups.splice(0).reverse()) await clean() })
function setup(provider: ProviderAdapter, maxConcurrent = 1) {
  const directory = mkdtempSync(join(tmpdir(), 'sceneweave-request-boundary-'))
  const config = loadAiConfig({ SCENEWEAVE_AI_DATA_DIR: directory, SCENEWEAVE_AI_ALLOWED_ORIGINS: origin,
    SCENEWEAVE_AI_ACCESS_TOKEN: token, SCENEWEAVE_AI_PROVIDER_BASE_URL: 'http://127.0.0.1:9999/v1',
    SCENEWEAVE_AI_PROVIDER_API_KEY: 'local-stub-provider-key', SCENEWEAVE_AI_PROVIDER_MODEL: 'test-model' })
  config.maxConcurrent = maxConcurrent
  const store = new TaskStore(directory)
  const engine = new TaskEngine(store, provider, connectionInfo(config), { maxConcurrent })
  const app = createAiApp(config, { store, engine, bodyTimeoutMs: 25 })
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }), () => store.close(), () => engine.close())
  return { app, engine, store }
}
const headers = { Authorization: `Bearer ${token}`, Origin: origin, 'Content-Type': 'application/json' }
const task = () => ({ schemaVersion: 1, clientRequestId: randomUUID(), prompt: 'Local boundary regression', context: null })
function streamRequest(path: string, signal?: AbortSignal) {
  let stream!: ReadableStreamDefaultController<Uint8Array>
  const cancel = vi.fn()
  const body = new ReadableStream<Uint8Array>({ start(controller) { stream = controller; controller.enqueue(new TextEncoder().encode('{')) }, cancel })
  const request = new Request(`http://local.test${path}`, { method: 'POST', headers, body, signal, duplex: 'half' } as RequestInit)
  return { request, stream, cancel }
}
const noProvider = () => ({ complete: vi.fn(async (): Promise<ProviderCompletion> => { throw new Error('partial upload must not call provider') }) })
async function promptly<T>(value: T | PromiseLike<T>): Promise<T | 'not-settled'> {
  return Promise.race([Promise.resolve(value), new Promise<'not-settled'>(resolve => setTimeout(() => resolve('not-settled'), 500))])
}

describe('task runner and upload boundaries', () => {
  it('contains a failed error-handler read, aborts every active request and exposes storage unavailable without replay', async () => {
    const inputs: ProviderInput[] = [], rejections: ((error: Error) => void)[] = []
    const complete = vi.fn(async (input: ProviderInput) => {
      inputs.push(input)
      return new Promise<ProviderCompletion>((_, reject) => rejections.push(reject))
    })
    const { app, store, engine } = setup({ complete }, 2)
    const snapshots = []
    for (let i = 0; i < 2; i++) snapshots.push(await (await app.request('/v1/tasks', { method: 'POST', headers, body: JSON.stringify(task()) })).json() as { id: string })
    await vi.waitFor(() => expect(inputs).toHaveLength(2))
    const originalRead = store.read.bind(store), observed = vi.fn()
    const unlistenBroken = engine.onStorageUnavailable(() => { throw new Error('broken subscription cleanup') })
    const unlistenObserved = engine.onStorageUnavailable(observed)
    vi.spyOn(store, 'read').mockImplementation(() => { throw new Error('SQLITE_IOERR injected read failure') })
    rejections[0](new ProviderFailure('provider_network', 'local provider failed'))
    try {
      await vi.waitFor(() => expect(inputs.every(input => input.signal.aborted)).toBe(true), { timeout: 1000 })
      expect(observed).toHaveBeenCalledTimes(1)
      expect(() => engine.assertStorageAvailable()).toThrow('storage_unavailable')
      const response = await app.request(`/v1/tasks/${snapshots[0].id}`, { headers })
      expect(response.status).toBe(503)
      expect(await response.json()).toMatchObject({ error: { code: 'storage_unavailable', retryable: false } })
      expect((await app.request('/healthz')).status).toBe(200)
      expect(complete).toHaveBeenCalledTimes(2)
      for (const snapshot of snapshots) expect(originalRead(snapshot.id).snapshot.usage.requests).toBe(1)
    } finally { vi.mocked(store.read).mockImplementation(originalRead); unlistenBroken(); unlistenObserved() }
  })

  it('admits a body before reading, rejects excess task and action uploads and frees capacity on cancellation', async () => {
    const provider = noProvider(), { app, store } = setup(provider)
    const abort = new AbortController(), held = streamRequest('/v1/tasks', abort.signal)
    const pending = app.fetch(held.request)
    const overflow = streamRequest('/v1/tasks'), action = streamRequest('/v1/tasks/no-task/control')
    const second = app.fetch(overflow.request), third = app.fetch(action.request)
    try {
      const responses = await Promise.all([promptly(second), promptly(third)])
      expect(responses.map(value => value === 'not-settled' ? value : value.status)).toEqual([429, 429])
      abort.abort()
      const cancelled = await promptly(pending)
      expect(cancelled === 'not-settled' ? cancelled : cancelled.status).toBe(409)
      expect(held.cancel).toHaveBeenCalledOnce()
      const next = await app.request('/v1/tasks', { method: 'POST', headers, body: '{}' })
      expect(next.status).toBe(400)
      expect(store.count()).toBe(0)
      expect(provider.complete).not.toHaveBeenCalled()
    } finally {
      for (const value of [held, overflow, action]) { try { value.stream.error(new Error('test stream cleanup')) } catch { /* Already closed. */ } }
      await Promise.all([pending, second, third])
    }
  })

  it('times out an incomplete upload, cancels its stream and lets a subsequent request through', async () => {
    const provider = noProvider(), { app, store } = setup(provider), held = streamRequest('/v1/tasks?authoringVersion=4')
    const pending = app.fetch(held.request)
    try {
      const response = await promptly(pending)
      expect(response === 'not-settled' ? response : response.status).toBe(503)
      if (response !== 'not-settled') expect(await response.json()).toMatchObject({ error: { code: 'request_timeout', requestState: 'not_sent' } })
      expect(held.cancel).toHaveBeenCalledOnce()
      expect((await app.request('/v1/tasks', { method: 'POST', headers, body: '{}' })).status).toBe(400)
      expect(store.count()).toBe(0)
      expect(provider.complete).not.toHaveBeenCalled()
    } finally { try { held.stream.error(new Error('test stream cleanup')) } catch { /* Already closed. */ }; await pending }
  })
})
