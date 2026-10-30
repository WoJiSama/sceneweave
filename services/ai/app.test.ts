import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, truncateSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { AI_LIMITS, ConnectionInfoSchema, TaskEventSchema, TaskSnapshotSchema } from '../../src/shared/ai/protocol.js'
import type { TaskSnapshot } from '../../src/shared/ai/protocol.js'
import { connectionInfo, createAiApp } from './app.js'
import { loadAiConfig } from './config.js'
import { TaskEngine } from './engine.js'
import { TaskFault, TaskStore } from './store.js'
import { ProviderFailure } from './provider-types.js'
import { AUTHORING_LIMITS } from '../../src/shared/ai/authoring-protocol.js'
import { CONTINUATION_POLICY } from '../../src/shared/ai/budget-policy.js'
import type { ProviderAdapter, ProviderCompletion, ProviderInput, ProviderToolCall } from './provider-types.js'

const tokenA = 'a'.repeat(40), tokenB = 'b'.repeat(40), origin = 'https://editor.example.test'
const cleanups: (() => void)[] = []
afterEach(() => { for (const clean of cleanups.splice(0).reverse()) clean() })
function setup(provider?: ProviderAdapter, now?: () => number) {
  const directory = mkdtempSync(join(tmpdir(), 'sceneweave-ai-test-'))
  const config = loadAiConfig({ SCENEWEAVE_AI_DATA_DIR: directory, SCENEWEAVE_AI_ALLOWED_ORIGINS: origin, SCENEWEAVE_AI_ACCESS_TOKENS: JSON.stringify({ alice: tokenA, bob: tokenB }), SCENEWEAVE_AI_PROVIDER_BASE_URL: 'http://127.0.0.1:9999/v1', SCENEWEAVE_AI_PROVIDER_API_KEY: 'private-provider-key', SCENEWEAVE_AI_PROVIDER_MODEL: 'test-model' })
  const store = new TaskStore(directory, { now })
  const providerImpl = provider ?? { complete: () => new Promise<ProviderCompletion>(() => {}) }
  const engine = new TaskEngine(store, providerImpl, connectionInfo(config), { now })
  const app = createAiApp(config, { store, engine })
  cleanups.push(() => { rmSync(directory, { recursive: true, force: true }) }, () => store.close(), () => engine.close())
  const request = (path: string, method = 'GET', body?: unknown, options: { token?: string; origin?: string | null; headers?: Record<string, string> } = {}) => app.request(path, { method, headers: { Authorization: `Bearer ${options.token ?? tokenA}`, ...(options.origin === null ? {} : { Origin: options.origin ?? origin }), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...options.headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  const create = (context: { sceneId: string; revision: number; audience: 'public' } | null = null) => request('/v1/tasks', 'POST', taskRequest(context))
  return { directory, config, store, engine, app, request, create }
}
const taskRequest = (context: { sceneId: string; revision: number; audience: 'public' } | null = null) => ({ schemaVersion: 1 as const, clientRequestId: randomUUID(), prompt: '请先检查连接能力。', context })
const done = (text = '', toolCalls: ProviderToolCall[] = []): ProviderCompletion => ({ text, toolCalls, finishReason: toolCalls.length ? 'tool_calls' : 'stop', usage: { inputTokens: 4, outputTokens: 3 }, requestId: 'request-test' })
async function waitStatus(store: TaskStore, id: string, status: string) { await vi.waitFor(() => expect(store.read(id).snapshot.status).toBe(status), { timeout: 3000, interval: 5 }); return store.read(id).snapshot }

describe('private AI task HTTP service', () => {
  it('requires a distinct bearer, exact Origin and restrictive preflight; health never reveals configuration', async () => {
    const { app, request } = setup()
    expect(await (await app.request('/healthz')).json()).toEqual({ ok: true })
    expect((await app.request('/v1/capabilities')).status).toBe(401)
    const advertised = ConnectionInfoSchema.parse(await (await request('/v1/capabilities')).json())
    expect(advertised.capabilities).toMatchObject({ sceneDraft: true, svg: true, vision: 'unverified' })
    expect(ConnectionInfoSchema.safeParse({ ...advertised, capabilities: { ...advertised.capabilities, svg: false } }).success).toBe(false)
    for (const value of ['null', 'https://editor.example.test.evil', `${origin}/`, 'http://editor.example.test']) expect((await request('/v1/capabilities', 'GET', undefined, { origin: value })).status).toBe(403)
    expect((await request('/v1/capabilities', 'GET', undefined, { origin: null })).status).toBe(200)
    const valid = await app.request('/v1/tasks', { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type' } })
    expect(valid.status).toBe(204); expect(valid.headers.get('Access-Control-Allow-Origin')).toBe(origin)
    expect((await app.request('/v1/tasks', { method: 'OPTIONS', headers: { Origin: 'null', 'Access-Control-Request-Method': 'POST' } })).status).toBe(403)
    expect((await app.request('/v1/tasks', { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'x-custom' } })).status).toBe(403)
  })
  it('preserves the strict cached-client capability response and advertises v2 only after explicit negotiation', async () => {
    const { engine, request } = setup()
    const legacySchema = ConnectionInfoSchema.extend({ capabilities: ConnectionInfoSchema.shape.capabilities.omit({
      authoringVersions: true, baseMapVersions: true, budgetPolicyHashes: true }).strict() }).strict()
    const bare = await (await request('/v1/capabilities')).json()
    expect(legacySchema.parse(bare)).toEqual(bare)
    expect(bare.capabilities).not.toHaveProperty('authoringVersions')
    expect(bare.capabilities).not.toHaveProperty('baseMapVersions')
    expect(bare.capabilities).not.toHaveProperty('budgetPolicyHashes')
    const negotiated = ConnectionInfoSchema.parse(await (await request('/v1/capabilities?authoringVersion=2')).json())
    expect(negotiated.capabilities).toMatchObject({ authoringVersions: [1, 2], baseMapVersions: [1, 2], budgetPolicyHashes: [CONTINUATION_POLICY.policyHash] })
    expect(negotiated).toEqual(engine.connectionInfo)
    expect(legacySchema.safeParse(negotiated).success).toBe(false)
    for (const query of ['authoringVersion=1', 'authoringVersion=3', 'authoringVersion=']) {
      const response = await request(`/v1/capabilities?${query}`)
      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({ error: { code: 'unsupported_authoring_version' } })
    }
    for (const query of ['unknown=2', 'authoringVersion=2&authoringVersion=2', 'authoringVersion=2&unknown=1']) {
      const response = await request(`/v1/capabilities?${query}`)
      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({ error: { code: 'invalid_request' } })
    }
  })
  it('rejects unknown request fields, scene contents, GM contexts and excessive actual bytes before model requests', async () => {
    const complete = vi.fn(() => new Promise<ProviderCompletion>(() => {}))
    const { request, app } = setup({ complete })
    for (const body of [{ ...taskRequest(), owner: 'alice' }, { ...taskRequest(), document: {} }, { ...taskRequest(), context: { sceneId: 'scene', revision: 1, audience: 'gm' } }, { ...taskRequest(), prompt: '中'.repeat(6000) }]) expect((await request('/v1/tasks', 'POST', body)).status).toBe(400)
    expect((await request('/v1/tasks', 'POST', { ...taskRequest(), prompt: 'a'.repeat(40000) })).status).toBe(413)
    expect((await app.request('/v1/tasks', { method: 'POST', headers: { Authorization: `Bearer ${tokenA}`, 'Content-Type': 'text/plain' }, body: '{}' })).status).toBe(400)
    expect(complete).not.toHaveBeenCalled()
  })
  it('counts valid JSON whitespace toward the exact 32KiB conversation request limit', async () => {
    const complete = vi.fn(() => new Promise<ProviderCompletion>(() => {}))
    const { app, store } = setup({ complete })
    const send = (size: number) => {
      const json = JSON.stringify(taskRequest()), padding = size - Buffer.byteLength(json)
      return app.request('/v1/tasks', { method: 'POST', headers: { Authorization: `Bearer ${tokenA}`, Origin: origin, 'Content-Type': 'application/json' }, body: json + ' '.repeat(padding) })
    }
    expect((await send(AI_LIMITS.requestBytes)).status).toBe(201)
    const rejected = await send(AI_LIMITS.requestBytes + 1)
    expect(rejected.status).toBe(413)
    expect(await rejected.json()).toMatchObject({ error: { code: 'request_limit' } })
    expect(store.count()).toBe(1)
    expect(complete).toHaveBeenCalledTimes(1)
  })
  it('persists one idempotent task and prevents cross-owner access and a second active task for one scene', async () => {
    const { request, store } = setup()
    const body = taskRequest({ sceneId: 'scene-1', revision: 1, audience: 'public' })
    const first = await request('/v1/tasks', 'POST', body), snapshot = TaskSnapshotSchema.parse(await first.json())
    expect(first.status).toBe(201)
    expect((await (await request('/v1/tasks', 'POST', body)).json()).id).toBe(snapshot.id)
    expect((await request('/v1/tasks', 'POST', { ...body, prompt: 'changed' })).status).toBe(409)
    expect((await request('/v1/tasks', 'POST', taskRequest(body.context))).status).toBe(409)
    for (const suffix of ['', '/events?after=0', '/control']) expect((await request(`/v1/tasks/${snapshot.id}${suffix}`, suffix === '/control' ? 'POST' : 'GET', suffix === '/control' ? { schemaVersion: 1, expectedGeneration: 1, action: 'cancel' } : undefined, { token: tokenB })).status).toBe(404)
    expect((await request(`/v1/tasks/${snapshot.id}`, 'DELETE', undefined, { token: tokenB })).status).toBe(404)
    expect(await (await request('/v1/tasks', 'GET', undefined, { token: tokenB })).json()).toEqual({ schemaVersion: 1, tasks: [] })
    expect((await (await request('/v1/tasks?sceneId=scene-1')).json()).tasks).toHaveLength(1)
    expect(store.count()).toBe(1)
    expect(JSON.stringify(await (await request(`/v1/tasks/${snapshot.id}`)).json())).not.toContain('system')
  })
  it('streams ordered real tool results, passes them back to the model, and replays events without tool reexecution', async () => {
    const complete = vi.fn(async (input: ProviderInput) => {
      if (complete.mock.calls.length === 1) {
        await input.onText('检查连接。')
        return done('检查连接。', [{ id: 'call_1', name: 'sceneweave_connection_info', arguments: '{"topic":"connection"}' }])
      }
      expect(input.messages.at(-1)).toMatchObject({ role: 'tool', toolCallId: 'call_1' })
      expect(JSON.parse(input.messages.at(-1)!.content!)).toMatchObject({ capabilities: { sceneDraft: true, svg: true } })
      await input.onText('当前支持流式对话。')
      return done('当前支持流式对话。')
    })
    const { create, request, store } = setup({ complete })
    const snapshot = await (await create()).json() as TaskSnapshot
    const completed = await waitStatus(store, snapshot.id, 'completed')
    expect(completed.text).toBe('检查连接。当前支持流式对话。')
    expect(completed.usage).toEqual({ inputTokens: 8, outputTokens: 6, requests: 2, unknown: false })
    const stream = await request(`/v1/tasks/${snapshot.id}/events?after=0`)
    const wire = await stream.text()
    const events = wire.split('\n').filter(line => line.startsWith('data: ')).map(line => TaskEventSchema.parse(JSON.parse(line.slice(6))))
    expect(events.map(event => event.sequence)).toEqual(events.map((_, index) => index + 1))
    expect(events.filter(event => event.type === 'tool_result')).toHaveLength(1)
    const last = await request(`/v1/tasks/${snapshot.id}/events?after=${completed.lastSequence}`)
    expect(await last.text()).toBe('')
    expect((await request(`/v1/tasks/${snapshot.id}/events?after=${completed.lastSequence + 1}`)).status).toBe(409)
    expect(complete).toHaveBeenCalledTimes(2)
  })
  it('keeps invalid/unknown tools as structured failures and limits model rounds to four without retry', async () => {
    const complete = vi.fn(async () => done('', [{ id: `call_${complete.mock.calls.length}`, name: complete.mock.calls.length === 1 ? 'shell' : 'sceneweave_connection_info', arguments: '{"topic":"connection","extra":true}' }]))
    const { create, store } = setup({ complete })
    const snapshot = await (await create()).json() as TaskSnapshot
    const failed = await waitStatus(store, snapshot.id, 'failed')
    expect(failed.error?.code).toBe('request_limit')
    expect(failed.tools).toHaveLength(4)
    expect(failed.tools.every(tool => !tool.success)).toBe(true)
    expect(complete).toHaveBeenCalledTimes(4)
  })
  it('does not duplicate an identical call ID and rejects reusing an ID for different arguments', async () => {
    const complete = vi.fn(async () => done('', [{ id: 'same', name: 'sceneweave_connection_info', arguments: complete.mock.calls.length < 3 ? '{"topic":"connection"}' : '{}' }]))
    const { create, store } = setup({ complete })
    const snapshot = await (await create()).json() as TaskSnapshot
    const failed = await waitStatus(store, snapshot.id, 'failed')
    expect(failed.error?.code).toBe('provider_protocol')
    expect(failed.tools).toHaveLength(1)
    expect(store.events(snapshot.id, 0).filter(event => event.type === 'tool_result')).toHaveLength(1)
  })
  it('pause invalidates and aborts a generation; explicit resume preserves unknown usage and late results cannot publish', async () => {
    let pending!: ProviderInput, resolve!: (value: ProviderCompletion) => void
    const complete = vi.fn(async (input: ProviderInput) => {
      if (complete.mock.calls.length === 1) { pending = input; await input.onText('保留的进度'); return new Promise<ProviderCompletion>(done => { resolve = done }) }
      expect(input.messages.some(message => message.role === 'assistant' && message.content === '保留的进度')).toBe(true)
      await input.onText('继续完成'); return done('继续完成')
    })
    const { create, request, store } = setup({ complete })
    const snapshot = await (await create()).json() as TaskSnapshot
    await vi.waitFor(() => expect(pending).toBeDefined())
    const pausedResponse = await request(`/v1/tasks/${snapshot.id}/control`, 'POST', { schemaVersion: 1, expectedGeneration: 1, action: 'pause' })
    const paused = await pausedResponse.json() as TaskSnapshot
    expect(paused.status).toBe('paused'); expect(pending.signal.aborted).toBe(true)
    expect(() => pending.onText('迟到')).toThrow()
    resolve(done('保留的进度'))
    expect((await request(`/v1/tasks/${snapshot.id}/control`, 'POST', { schemaVersion: 1, expectedGeneration: 1, action: 'resume' })).status).toBe(409)
    expect((await request(`/v1/tasks/${snapshot.id}/control`, 'POST', { schemaVersion: 1, expectedGeneration: paused.generation, action: 'resume', prompt: '请继续。' })).status).toBe(200)
    const completed = await waitStatus(store, snapshot.id, 'completed')
    expect(completed.text).toBe('保留的进度继续完成')
    expect(completed.usage).toEqual({ requests: 2, inputTokens: null, outputTokens: null, unknown: true })
  })
  it('an SSE reader disconnect does not cancel a task; delete aborts execution and removes only its private data', async () => {
    let pending!: ProviderInput
    const { create, request, store, directory } = setup({ complete: async input => { pending = input; return new Promise<ProviderCompletion>(() => {}) } })
    const snapshot = await (await create()).json() as TaskSnapshot
    await vi.waitFor(() => expect(pending).toBeDefined())
    const events = await request(`/v1/tasks/${snapshot.id}/events?after=0`)
    const reader = events.body!.getReader(); await reader.read(); await reader.cancel()
    expect(store.read(snapshot.id).snapshot.status).toBe('running'); expect(pending.signal.aborted).toBe(false)
    const dir = join(directory, 'artifacts', snapshot.id); mkdirSync(dir); writeFileSync(join(dir, 'private.tmp'), 'private')
    const unrelated = join(directory, 'unrelated.sceneweave'); writeFileSync(unrelated, 'unchanged')
    expect((await request(`/v1/tasks/${snapshot.id}`, 'DELETE')).status).toBe(204)
    expect(pending.signal.aborted).toBe(true); expect(() => store.read(snapshot.id)).toThrow(TaskFault)
    expect(() => statSync(dir)).toThrow(); expect(statSync(unrelated).size).toBe(9)
    expect(() => pending.onText('late')).toThrow()
  })
  it('sanitizes provider failures, and never retries an unknown paid request or treats missing usage as zero', async () => {
    const complete = vi.fn(async (input: ProviderInput) => { await input.onText('部分'); throw new ProviderFailure('provider_network', 'secret key private-provider-key prompt content') })
    const { create, request, store } = setup({ complete })
    const snapshot = await (await create()).json() as TaskSnapshot
    const failed = await waitStatus(store, snapshot.id, 'failed')
    expect(failed.usage).toEqual({ inputTokens: null, outputTokens: null, requests: 1, unknown: true })
    const body = await (await request(`/v1/tasks/${snapshot.id}`)).text()
    expect(body).not.toContain('private-provider-key'); expect(body).not.toContain('prompt content'); expect(complete).toHaveBeenCalledTimes(1)
  })
  it('enforces cumulative output and event budgets before publishing oversized data', async () => {
    let input!: ProviderInput
    const { create, store } = setup({ complete: async value => { input = value; return new Promise<ProviderCompletion>(() => {}) } })
    const snapshot = await (await create()).json() as TaskSnapshot
    await vi.waitFor(() => expect(input).toBeDefined())
    store.change(snapshot.id, 1, task => { task.outputBytes = AI_LIMITS.outputBytes - 2; return [] })
    expect(() => input.onText('中')).toThrow('output_limit')
    expect(store.read(snapshot.id).snapshot.text).toBe('')
    // A reserved error/status allowance remains available even after display events reach their ceiling.
    store.change(snapshot.id, 1, task => { task.outputBytes = 0; task.snapshot.lastSequence = AI_LIMITS.events - 4; return [] })
    expect(() => input.onText('x')).toThrow('event_limit')
    expect(store.read(snapshot.id).snapshot.text).toBe('')
  })
  it('limits SSE subscriptions per owner and globally, and releases a slot after cancel', async () => {
    const { create, request, config, engine } = setup()
    const snapshot = await (await create()).json() as TaskSnapshot
    const urls: Response[] = []
    for (let owner = 0; owner < 4; owner++) {
      const access = String(owner).repeat(40)
      ;(config.accessTokens as Map<string, string>).set(access, `owner-${owner}`)
      const task = await (await request('/v1/tasks', 'POST', taskRequest(), { token: access })).json() as TaskSnapshot
      // maxConcurrent=4: the initial task consumes one slot, so use its owner for the first two streams instead.
      const id = owner === 3 ? snapshot.id : task.id
      const auth = owner === 3 ? tokenA : access
      for (let stream = 0; stream < 2; stream++) urls.push(await request(`/v1/tasks/${id}/events?after=0`, 'GET', undefined, { token: auth }))
    }
    expect(urls.every(response => response.status === 200)).toBe(true)
    expect((await request(`/v1/tasks/${snapshot.id}/events?after=0`)).status).toBe(429)
    const extraToken = 'extra'.repeat(8)
    ;(config.accessTokens as Map<string, string>).set(extraToken, 'extra')
    // An owner without a task cannot borrow another owner's stream slot or task identity.
    expect((await request(`/v1/tasks/${snapshot.id}/events?after=0`, 'GET', undefined, { token: extraToken })).status).toBe(404)
    engine.control('alice', snapshot.id, { schemaVersion: 1, action: 'pause', expectedGeneration: 1 })
    const extraTask = await (await request('/v1/tasks', 'POST', taskRequest(), { token: extraToken })).json() as TaskSnapshot
    expect((await request(`/v1/tasks/${extraTask.id}/events?after=0`, 'GET', undefined, { token: extraToken })).status).toBe(429)
    await urls.at(-1)!.body!.cancel()
    const reopened = await request(`/v1/tasks/${snapshot.id}/events?after=0`)
    expect(reopened.status).toBe(200)
    await reopened.body!.cancel()
    for (const response of urls.slice(0, -1)) await response.body!.cancel()
  })
  it('commits an assistant tool round and all receipts atomically, including when a later call is invalid', async () => {
    const complete = vi.fn(async () => done('', [{ id: 'valid', name: 'sceneweave_connection_info', arguments: '{"topic":"connection"}' }, { id: 'bad id', name: 'sceneweave_connection_info', arguments: '{"topic":"connection"}' }]))
    const { create, store } = setup({ complete })
    const snapshot = await (await create()).json() as TaskSnapshot
    await waitStatus(store, snapshot.id, 'failed')
    const privateTask = store.read(snapshot.id)
    expect(privateTask.messages.filter(message => message.toolCalls || message.role === 'tool')).toHaveLength(0)
    expect(privateTask.snapshot.tools).toHaveLength(0)
    expect(store.events(snapshot.id, 0).filter(event => ['tool_started', 'tool_result', 'usage'].includes(event.type))).toHaveLength(0)
  })
  it('backs off a slow SSE reader and later replays every event in order from the durable checkpoint', async () => {
    let input!: ProviderInput, resolve!: (value: ProviderCompletion) => void
    const { create, request, store } = setup({ complete: async value => { input = value; return new Promise<ProviderCompletion>(done => { resolve = done }) } })
    const snapshot = await (await create()).json() as TaskSnapshot
    await vi.waitFor(() => expect(input).toBeDefined())
    const events = vi.spyOn(store, 'events')
    const response = await request(`/v1/tasks/${snapshot.id}/events?after=0`)
    const text = 'a'.repeat(8192)
    for (let index = 0; index < 7; index++) input.onText(text)
    const cursors = events.mock.calls.filter(call => call[2] === 64).map(call => call[1])
    // Once its bounded queue is full, further notifications retain the same durable cursor.
    expect(cursors.at(-1)).toBe(cursors.at(-2))
    resolve(done(text.repeat(7)))
    await waitStatus(store, snapshot.id, 'completed')
    const wire = await response.text()
    const replay = wire.split('\n').filter(line => line.startsWith('data: ')).map(line => TaskEventSchema.parse(JSON.parse(line.slice(6))))
    expect(replay.map(event => event.sequence)).toEqual(replay.map((_, index) => index + 1))
    expect(replay.at(-1)?.type).toBe('status')
    expect(replay.filter(event => event.type === 'text_delta').map(event => event.data.text).join('')).toBe(text.repeat(7))
  })
  it('enforces eight cumulative tool attempts even across multiple model requests', async () => {
    const complete = vi.fn(async () => done('', Array.from({ length: complete.mock.calls.length === 1 ? 8 : 1 }, (_, index) => ({ id: `call_${complete.mock.calls.length}_${index}`, name: 'sceneweave_connection_info', arguments: '{"topic":"connection"}' }))))
    const { create, store } = setup({ complete })
    const snapshot = await (await create()).json() as TaskSnapshot
    const failed = await waitStatus(store, snapshot.id, 'failed')
    expect(failed.tools).toHaveLength(8)
    expect(failed.error?.code).toBe('tool_limit')
    expect(complete).toHaveBeenCalledTimes(2)
    const messages = store.read(snapshot.id).messages
    expect(messages.filter(message => message.role === 'tool')).toHaveLength(8)
    expect(messages.filter(message => message.toolCalls)).toHaveLength(1)
  })
  it('returns explicit storage-unavailable responses if the failure checkpoint itself cannot be persisted', async () => {
    let fail!: (error: Error) => void
    let input!: ProviderInput
    const { create, request, store } = setup({ complete: async value => { input = value; return new Promise<ProviderCompletion>((_, reject) => { fail = reject }) } })
    const snapshot = await (await create()).json() as TaskSnapshot
    await vi.waitFor(() => expect(input).toBeDefined())
    const original = store.change.bind(store)
    vi.spyOn(store, 'change').mockImplementation(() => { throw new Error('SQLITE_FULL private details') })
    fail(new ProviderFailure('provider_network', 'secret body'))
    await vi.waitFor(() => expect(input.signal.aborted).toBe(true))
    const response = await request(`/v1/tasks/${snapshot.id}`)
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ schemaVersion: 1, error: { code: 'storage_unavailable' } })
    expect(await (await request('/healthz')).json()).toEqual({ ok: true })
    vi.mocked(store.change).mockImplementation(original)
  })
  it('shutdown checkpoints a running task as paused, aborts its request and closes its SSE subscriptions', async () => {
    let input!: ProviderInput
    const { engine, store, create, request } = setup({ complete: async value => { input = value; return new Promise<ProviderCompletion>(() => {}) } })
    const snapshot = await (await create()).json() as TaskSnapshot
    await vi.waitFor(() => expect(input).toBeDefined())
    const response = await request(`/v1/tasks/${snapshot.id}/events?after=0`)
    engine.close()
    const wire = await response.text()
    expect(wire).toContain('"status":"paused"')
    expect(store.read(snapshot.id).snapshot.status).toBe('paused')
    expect(input.signal.aborted).toBe(true)
  })
})

describe('task lifecycle and physical private storage', () => {
  it('refuses a second service instance before it can alter the first service running checkpoint', () => {
    const { directory, store } = setup()
    const task = store.create('alice', taskRequest(), 4).task
    expect(() => new TaskStore(directory)).toThrow('already in use')
    expect(store.read(task.snapshot.id).snapshot.status).toBe('running')
    expect(store.read(task.snapshot.id).snapshot.generation).toBe(1)
  })
  it('restores running tasks as paused + unknown after restart and never invokes the provider automatically', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'sceneweave-ai-restart-'))
    let now = 1000
    let store = new TaskStore(directory, { now: () => now })
    const created = store.create('alice', taskRequest(), 4).task
    store.change(created.snapshot.id, 1, task => { task.snapshot.usage.requests = 1; task.pendingText = 'partial'; return [] })
    store.close(); now += 2000
    store = new TaskStore(directory, { now: () => now })
    cleanups.push(() => { rmSync(directory, { recursive: true, force: true }) }, () => store.close())
    const recovered = store.read(created.snapshot.id)
    expect(recovered.snapshot.status).toBe('paused'); expect(recovered.snapshot.error?.code).toBe('service_restarted'); expect(recovered.snapshot.generation).toBe(2)
    expect(recovered.runtimeMs).toBe(2000); expect(recovered.messages.at(-2)).toMatchObject({ role: 'assistant', content: 'partial' })
    expect(recovered.snapshot.usage.inputTokens).toBeNull()
  })
  it('limits cumulative running time while pause freezes its clock and requires an explicit new generation', () => {
    let now = 1000
    const { engine, store } = setup(undefined, () => now)
    const created = engine.create('alice', taskRequest())
    now += 30000
    const paused = engine.control('alice', created.id, { schemaVersion: 1, action: 'pause', expectedGeneration: 1 })
    now += 600000
    expect(store.remaining(store.read(created.id))).toBe(90000)
    const resumed = engine.control('alice', created.id, { schemaVersion: 1, action: 'resume', expectedGeneration: paused.generation })
    now += 90000
    engine.control('alice', created.id, { schemaVersion: 1, action: 'pause', expectedGeneration: resumed.generation })
    expect(() => engine.control('alice', created.id, { schemaVersion: 1, action: 'resume', expectedGeneration: resumed.generation + 1 })).toThrow('execution_limit')
  })
  it('cleans expired tasks and orphan artifacts; private directories/files use restrictive modes', () => {
    let now = 1000
    const { directory, store } = setup(undefined, () => now)
    const created = store.create('alice', taskRequest(), 4).task
    const artifacts = join(directory, 'artifacts', created.snapshot.id); mkdirSync(artifacts); writeFileSync(join(artifacts, 'temp'), 'private')
    expect(statSync(directory).mode & 0o777).toBe(0o700); expect(statSync(join(directory, 'tasks.sqlite')).mode & 0o777).toBe(0o600)
    now += AI_LIMITS.retentionDays * 86400000 + 1; store.sweep()
    expect(store.count()).toBe(0); expect(() => statSync(artifacts)).toThrow()
    const orphan = join(directory, 'artifacts', randomUUID()); mkdirSync(orphan); writeFileSync(join(orphan, 'temp'), 'private')
    store.artifacts.cleanOrphans(new Set()); expect(() => statSync(orphan)).toThrow()
  })
  it('aborts an expired running task and isolates its late response from newer tasks', async () => {
    let now = 1000
    const pending: { input: ProviderInput; resolve: (value: ProviderCompletion) => void }[] = []
    const complete = vi.fn((input: ProviderInput) => new Promise<ProviderCompletion>(resolve => { pending.push({ input, resolve }) }))
    const { engine, store, create, request, directory } = setup({ complete }, () => now)
    const old = await (await create()).json() as TaskSnapshot
    await vi.waitFor(() => expect(pending).toHaveLength(1))
    const paused = engine.control('alice', old.id, { schemaVersion: 1, expectedGeneration: old.generation, action: 'pause' })
    now = old.expiresAt - 500
    engine.control('alice', old.id, { schemaVersion: 1, expectedGeneration: paused.generation, action: 'resume' })
    await vi.waitFor(() => expect(pending).toHaveLength(2))
    const survivor = await (await create()).json() as TaskSnapshot
    await vi.waitFor(() => expect(pending).toHaveLength(3))
    const artifacts = join(directory, 'artifacts', old.id); mkdirSync(artifacts); writeFileSync(join(artifacts, 'private'), 'expired')
    const stream = await request(`/v1/tasks/${old.id}/events?after=0`)
    now = old.expiresAt + 1
    store.sweep()
    expect(pending[1].input.signal.aborted).toBe(true)
    expect(pending[2].input.signal.aborted).toBe(false)
    expect(() => store.read(old.id)).toThrow('not_found')
    expect(() => statSync(artifacts)).toThrow()
    expect(() => pending[1].input.onText('迟到文本')).toThrow('Execution interrupted')
    pending[0].resolve(done()); pending[1].resolve(done())
    await new Promise<void>(resolve => setImmediate(resolve))
    expect((await request(`/v1/tasks/${survivor.id}`)).status).toBe(200)
    expect(pending[2].input.signal.aborted).toBe(false)
    pending[2].resolve(done())
    expect((await request('/v1/capabilities')).status).toBe(200)
    await stream.text()
    expect(complete).toHaveBeenCalledTimes(3)
    await waitStatus(store, survivor.id, 'completed')
  })
  it('counts actual SQLite/private files toward the service budget and task artifacts toward its own budget', () => {
    const { directory, store } = setup()
    const task = store.create('alice', taskRequest(), 4).task
    const artifactDir = join(directory, 'artifacts', task.snapshot.id); mkdirSync(artifactDir)
    const taskFile = join(artifactDir, 'large'); writeFileSync(taskFile, ''); truncateSync(taskFile, AI_LIMITS.taskBytes)
    expect(() => store.change(task.snapshot.id, 1, () => [])).toThrow('task_storage_limit')
    rmSync(taskFile)
    const serviceFile = join(directory, 'residual'); writeFileSync(serviceFile, ''); truncateSync(serviceFile, AI_LIMITS.storageBytes)
    expect(() => store.create('bob', taskRequest(), 4)).toThrow('storage_limit')
    expect(store.count()).toBe(1)
  })
  it('removes deleted private request text from the live SQLite file and retained rollback journal', () => {
    const { store, directory } = setup()
    const text = 'unique-private-task-content-中文'
    const task = store.create('alice', { ...taskRequest(), prompt: text }, 4).task
    store.delete(task.snapshot.id, 'alice')
    for (const name of readdirSync(directory).filter(name => name.startsWith('tasks.sqlite'))) expect(readFileSync(join(directory, name)).includes(Buffer.from(text))).toBe(false)
    expect(statSync(join(directory, 'tasks.sqlite-journal')).size).toBe(0)
  })
  it('refuses excess concurrent tasks and a 257th retained task before starting work', () => {
    const { store } = setup()
    for (let index = 0; index < 4; index++) store.create('alice', taskRequest(), 4)
    expect(() => store.create('alice', taskRequest(), 4)).toThrow('concurrency_limit')
    for (const task of store.list('alice')) store.change(task.id, 1, current => { current.snapshot.status = 'completed'; current.runStartedAt = null; return [] })
    for (let index = 4; index < AI_LIMITS.tasks; index++) {
      const task = store.create('alice', taskRequest(), 4).task
      store.change(task.snapshot.id, 1, current => { current.snapshot.status = 'completed'; current.runStartedAt = null; return [] })
    }
    expect(() => store.create('alice', taskRequest(), 4)).toThrow('task_limit')
  })
})

describe('server-only fixed configuration', () => {
  it('rejects credentials in origins, weak tokens, path origins, remote HTTP providers, and request-tunable provider configuration', () => {
    const valid = { SCENEWEAVE_AI_ACCESS_TOKEN: tokenA, SCENEWEAVE_AI_ALLOWED_ORIGINS: origin, SCENEWEAVE_AI_PROVIDER_BASE_URL: 'https://provider.example.test/v1', SCENEWEAVE_AI_PROVIDER_API_KEY: 'private', SCENEWEAVE_AI_PROVIDER_MODEL: 'model' }
    expect(loadAiConfig(valid).host).toBe('127.0.0.1')
    for (const override of [{ SCENEWEAVE_AI_ACCESS_TOKEN: 'weak' }, { SCENEWEAVE_AI_PROVIDER_API_KEY: tokenA }, { SCENEWEAVE_AI_ALLOWED_ORIGINS: `${origin}/sceneweave` }, { SCENEWEAVE_AI_ALLOWED_ORIGINS: 'null' }, { SCENEWEAVE_AI_PROVIDER_BASE_URL: 'http://provider.example.test/v1' }, { SCENEWEAVE_AI_PROVIDER_BASE_URL: 'https://user:secret@provider.example.test/v1' }, { SCENEWEAVE_AI_PROVIDER_BASE_URL: 'https://provider.example.test/v1?key=secret' }]) expect(() => loadAiConfig({ ...valid, ...override })).toThrow('Invalid server configuration')
  })
  it('loads an optional fixed visual model without changing existing single-model configuration', () => {
    const valid = { SCENEWEAVE_AI_ACCESS_TOKEN: tokenA, SCENEWEAVE_AI_ALLOWED_ORIGINS: origin, SCENEWEAVE_AI_PROVIDER_BASE_URL: 'https://provider.example.test/v1', SCENEWEAVE_AI_PROVIDER_API_KEY: 'private', SCENEWEAVE_AI_PROVIDER_MODEL: 'glm-5.3' }
    const single = loadAiConfig(valid), split = loadAiConfig({ ...valid, SCENEWEAVE_AI_PROVIDER_VISION_MODEL: 'glm-5.3-flash' })
    expect(single.provider).not.toHaveProperty('visionModel')
    expect(split.provider).toMatchObject({ model: 'glm-5.3', visionModel: 'glm-5.3-flash', vision: 'unverified' })
    expect(connectionInfo(single)).not.toHaveProperty('visionModel')
    expect(ConnectionInfoSchema.parse(connectionInfo(split))).toMatchObject({ model: 'glm-5.3', visionModel: 'glm-5.3-flash', capabilities: { vision: 'unverified' } })
    for (const field of ['SCENEWEAVE_AI_PROVIDER_MODEL', 'SCENEWEAVE_AI_PROVIDER_VISION_MODEL'] as const) {
      for (const value of ['', ' ', 'glm 5.3', 'glm-5.3\t', 'glm-5.3\x7f', 'x'.repeat(129)]) {
        expect(() => loadAiConfig({ ...valid, [field]: value })).toThrow('Invalid server configuration')
      }
    }
  })
  it('accepts only a bounded server-selected authoring output budget and reports its actual default', () => {
    const valid = { SCENEWEAVE_AI_ACCESS_TOKEN: tokenA, SCENEWEAVE_AI_ALLOWED_ORIGINS: origin, SCENEWEAVE_AI_PROVIDER_BASE_URL: 'https://provider.example.test/v1', SCENEWEAVE_AI_PROVIDER_API_KEY: 'private', SCENEWEAVE_AI_PROVIDER_MODEL: 'model' }
    const fallback = loadAiConfig(valid)
    expect(fallback.authoringOutputTokens).toBe(AI_LIMITS.maxOutputTokensPerRequest)
    expect(connectionInfo(fallback).authoringOutputTokens).toBe(1024)
    expect(connectionInfo({ ...fallback, authoringOutputTokens: undefined }).authoringOutputTokens).toBe(1024)
    for (const authoringOutputTokens of [1, 4096, AUTHORING_LIMITS.maxOutputTokensPerRequest]) {
      const configured = loadAiConfig({ ...valid, SCENEWEAVE_AI_AUTHORING_OUTPUT_TOKENS: String(authoringOutputTokens) })
      expect(configured.authoringOutputTokens).toBe(authoringOutputTokens)
      expect(ConnectionInfoSchema.parse(connectionInfo(configured)).authoringOutputTokens).toBe(authoringOutputTokens)
    }
    for (const value of ['', ' ', '0', '-1', '1.5', 'NaN', 'Infinity', '1e3', '0x1000', ' 4096', '4096\n', String(AUTHORING_LIMITS.maxOutputTokensPerRequest + 1)]) {
      expect(() => loadAiConfig({ ...valid, SCENEWEAVE_AI_AUTHORING_OUTPUT_TOKENS: value })).toThrow('Invalid server configuration: AUTHORING_OUTPUT_TOKENS')
    }
  })
  it('enables private reasoning continuation only through explicit fixed server configuration', () => {
    const valid = { SCENEWEAVE_AI_ACCESS_TOKEN: tokenA, SCENEWEAVE_AI_ALLOWED_ORIGINS: origin, SCENEWEAVE_AI_PROVIDER_BASE_URL: 'https://provider.example.test/v1', SCENEWEAVE_AI_PROVIDER_API_KEY: 'private', SCENEWEAVE_AI_PROVIDER_MODEL: 'model' }
    expect(loadAiConfig(valid).provider.preserveReasoning).toBe('disabled')
    for (const preserveReasoning of ['enabled', 'disabled'] as const) {
      const config = loadAiConfig({ ...valid, SCENEWEAVE_AI_PROVIDER_PRESERVE_REASONING: preserveReasoning })
      expect(config.provider.preserveReasoning).toBe(preserveReasoning)
      expect(connectionInfo(config)).not.toHaveProperty('preserveReasoning')
    }
    for (const value of ['', 'true', '1', 'enabled ', 'ENABLED']) {
      expect(() => loadAiConfig({ ...valid, SCENEWEAVE_AI_PROVIDER_PRESERVE_REASONING: value })).toThrow('Invalid server configuration: PROVIDER_PRESERVE_REASONING')
    }
  })
})
