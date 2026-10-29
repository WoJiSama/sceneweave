import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { TaskSnapshotSchema, type CreateTaskRequest, type ReasoningEffort } from '../../src/shared/ai/protocol.js'
import { connectionInfo, createAiApp } from './app.js'
import { loadAiConfig } from './config.js'
import { TaskEngine } from './engine.js'
import { TaskStore } from './store.js'
import type { ProviderAdapter, ProviderCompletion, ProviderInput } from './provider-types.js'

const tokenA = 'a'.repeat(40), tokenB = 'b'.repeat(40), origin = 'https://editor.example.test'
const cleanups: (() => void)[] = []
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup() })

const request = (reasoningEffort?: ReasoningEffort): CreateTaskRequest => ({ schemaVersion: 1, clientRequestId: randomUUID(),
  prompt: '请检查连接能力。', context: null, ...(reasoningEffort ? { reasoningEffort } : {}) })
const completion = (text = ''): ProviderCompletion => ({ text, toolCalls: [], finishReason: 'stop', usage: { inputTokens: 4, outputTokens: 3 }, requestId: 'reasoning-test' })

function setup(provider: ProviderAdapter, defaultEffort?: ReasoningEffort) {
  const directory = mkdtempSync(join(tmpdir(), 'sceneweave-ai-reasoning-'))
  const env = { SCENEWEAVE_AI_DATA_DIR: directory, SCENEWEAVE_AI_ALLOWED_ORIGINS: origin,
    SCENEWEAVE_AI_ACCESS_TOKENS: JSON.stringify({ alice: tokenA, bob: tokenB }),
    SCENEWEAVE_AI_PROVIDER_BASE_URL: 'http://127.0.0.1:9999/v1', SCENEWEAVE_AI_PROVIDER_API_KEY: 'private-test-provider-key',
    SCENEWEAVE_AI_PROVIDER_MODEL: 'test-model', ...(defaultEffort ? { SCENEWEAVE_AI_PROVIDER_REASONING_EFFORT: defaultEffort } : {}) }
  const config = loadAiConfig(env), store = new TaskStore(directory)
  const engine = new TaskEngine(store, provider, connectionInfo(config))
  const app = createAiApp(config, { store, engine })
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }), () => store.close(), () => engine.close())
  const call = (path: string, method = 'GET', body?: unknown, asBob = false) => app.request(path, {
    method, headers: { Authorization: `Bearer ${asBob ? tokenB : tokenA}`, Origin: origin,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  return { directory, config, store, engine, call }
}

async function waitStatus(store: TaskStore, id: string, status: string) {
  await vi.waitFor(() => expect(store.read(id).snapshot.status).toBe(status), { timeout: 3000, interval: 5 })
  return store.read(id).snapshot
}

describe('per-task reasoning effort', () => {
  it('advertises task-level selection, accepts only supported values, and does not allow a control request to change it', async () => {
    const complete = vi.fn(async () => completion())
    const { call, store } = setup({ complete }, 'max')
    const capabilities = await (await call('/v1/capabilities')).json() as Record<string, unknown>
    expect(capabilities).toMatchObject({ reasoningEffort: 'max', capabilities: { taskReasoningEffort: true } })

    const body = request('low'), created = await call('/v1/tasks', 'POST', body)
    expect(created.status).toBe(201)
    const snapshot = TaskSnapshotSchema.parse(await created.json())
    expect(snapshot.reasoningEffort).toBe('low')
    expect(await waitStatus(store, snapshot.id, 'completed')).toMatchObject({ reasoningEffort: 'low' })
    expect(complete).toHaveBeenCalledOnce()
    expect(JSON.stringify(snapshot)).not.toContain('private-test-provider-key')

    for (const invalid of ['medium', 'xhigh', null, [], {}]) {
      expect((await call('/v1/tasks', 'POST', { ...request(), reasoningEffort: invalid })).status).toBe(400)
    }
    expect((await call(`/v1/tasks/${snapshot.id}/control`, 'POST', {
      schemaVersion: 1, expectedGeneration: snapshot.generation, action: 'resume', reasoningEffort: 'high',
    })).status).toBe(400)
    expect((await call(`/v1/tasks/${snapshot.id}`, 'GET', undefined, true)).status).toBe(404)
    expect(complete).toHaveBeenCalledOnce()
  })

  it('freezes the service default at creation while preserving request-id idempotency', async () => {
    const inputs: ProviderInput[] = []
    const complete = vi.fn(async (input: ProviderInput) => { inputs.push(input); return completion() })
    const { call, store } = setup({ complete }, 'max')
    const body = request()
    const first = await call('/v1/tasks', 'POST', body), original = TaskSnapshotSchema.parse(await first.json())
    expect(original.reasoningEffort).toBe('max')
    await waitStatus(store, original.id, 'completed')

    const retry = await call('/v1/tasks', 'POST', body), replayed = TaskSnapshotSchema.parse(await retry.json())
    expect(replayed.id).toBe(original.id)
    expect(replayed.reasoningEffort).toBe('max')
    expect((await call('/v1/tasks', 'POST', { ...body, reasoningEffort: 'low' })).status).toBe(409)
    expect(inputs).toHaveLength(1)
    expect(inputs[0].reasoningEffort).toBe('max')
    expect(store.count()).toBe(1)
  })

  it('keeps the captured effort across pause and explicit resume', async () => {
    const inputs: ProviderInput[] = []
    const complete = vi.fn(async (input: ProviderInput) => {
      inputs.push(input)
      if (inputs.length === 1) return new Promise<ProviderCompletion>(() => {})
      await input.onText('续答完成。')
      return completion('续答完成。')
    })
    const { call, store } = setup({ complete }, 'max')
    const created = await call('/v1/tasks', 'POST', request('low')), snapshot = TaskSnapshotSchema.parse(await created.json())
    await vi.waitFor(() => expect(inputs).toHaveLength(1), { timeout: 3000, interval: 5 })
    const paused = TaskSnapshotSchema.parse(await (await call(`/v1/tasks/${snapshot.id}/control`, 'POST', {
      schemaVersion: 1, expectedGeneration: snapshot.generation, action: 'pause',
    })).json())
    expect(paused.status).toBe('paused')
    expect(paused.reasoningEffort).toBe('low')
    const resumed = await call(`/v1/tasks/${snapshot.id}/control`, 'POST', {
      schemaVersion: 1, expectedGeneration: paused.generation, action: 'resume', prompt: '请继续。',
    })
    expect(resumed.status).toBe(200)
    expect(await waitStatus(store, snapshot.id, 'completed')).toMatchObject({ reasoningEffort: 'low', text: '续答完成。' })
    expect(inputs.map(input => input.reasoningEffort)).toEqual(['low', 'low'])
  })

  it.each([
    { label: 'server max', defaultEffort: 'max' as ReasoningEffort | null, selected: undefined, expected: 'max' },
    { label: 'model default', defaultEffort: null, selected: undefined, expected: null },
    { label: 'explicit low', defaultEffort: 'max' as ReasoningEffort | null, selected: 'low' as ReasoningEffort, expected: 'low' },
  ])('retains $label through storage recovery and ignores a changed default on resume', async ({ defaultEffort, selected, expected }) => {
    const directory = mkdtempSync(join(tmpdir(), 'sceneweave-ai-reasoning-restart-'))
    let store = new TaskStore(directory), engine: TaskEngine | undefined
    cleanups.push(() => rmSync(directory, { recursive: true, force: true }), () => { engine?.close(); store.close() })

    const body = request(selected)
    const created = store.create('alice', body, 4, defaultEffort).task
    store.close()
    store = new TaskStore(directory)
    const duplicate = store.create('alice', body, 4, 'low')
    expect(duplicate.created).toBe(false)
    expect(duplicate.task.snapshot.reasoningEffort).toBe(expected)
    expect(duplicate.task.snapshot.status).toBe('paused')

    const inputs: ProviderInput[] = []
    const config = loadAiConfig({ SCENEWEAVE_AI_DATA_DIR: directory, SCENEWEAVE_AI_ALLOWED_ORIGINS: origin,
      SCENEWEAVE_AI_ACCESS_TOKEN: tokenA, SCENEWEAVE_AI_PROVIDER_BASE_URL: 'http://127.0.0.1:9999/v1',
      SCENEWEAVE_AI_PROVIDER_API_KEY: 'private-test-provider-key', SCENEWEAVE_AI_PROVIDER_MODEL: 'test-model',
      SCENEWEAVE_AI_PROVIDER_REASONING_EFFORT: 'low' })
    engine = new TaskEngine(store, { complete: async input => { inputs.push(input); return completion() } }, connectionInfo(config))
    const resumed = engine.control('alice', created.snapshot.id, { schemaVersion: 1, expectedGeneration: duplicate.task.snapshot.generation, action: 'resume' })
    expect(resumed.reasoningEffort).toBe(expected)
    await waitStatus(store, created.snapshot.id, 'completed')
    expect(inputs).toHaveLength(1)
    expect(inputs[0].reasoningEffort).toBe(expected)
    expect(JSON.stringify(store.read(created.snapshot.id).snapshot)).not.toContain('private-test-provider-key')
  })
})
