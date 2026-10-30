import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { continuationFixture } from '../../tests/helpers/continuation-fixture.js'
import { cloneJson } from '../../src/shared/validation/json.js'
import { authoringDraftStamp, authoringSummary, replayAuthoring } from '../../src/shared/ai/authoring.js'
import { AuthoringDraftSchema, type AuthoringStartV2 } from '../../src/shared/ai/authoring-protocol.js'
import { CONTINUATION_POLICY } from '../../src/shared/ai/budget-policy.js'
import { TaskSnapshotSchema, type CreateTaskRequest } from '../../src/shared/ai/protocol.js'
import { connectionInfo, createAiApp } from './app.js'
import { loadAiConfig } from './config.js'
import { TaskEngine } from './engine.js'
import { TaskStore } from './store.js'
import type { ProviderAdapter, ProviderCompletion, ProviderInput } from './provider-types.js'
import { reduceTaskEvent } from '../../src/platform/browser/ai/client.js'
import { recordAuthoringExecution } from './execution-checkpoint.js'

const cleanups: (() => void)[] = [], token = 'a'.repeat(40), origin = 'https://editor.example.test'
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup() })
const completion = (calls: ProviderCompletion['toolCalls'] = []): ProviderCompletion => ({ text: '', toolCalls: calls,
  finishReason: calls.length ? 'tool_calls' : 'stop', usage: { inputTokens: 10, outputTokens: 8 }, requestId: 'continuation-test' })

function setup(source: AuthoringStartV2, enabled = true, streamFirst = false, twoEdits = false) {
  const directory = mkdtempSync(join(tmpdir(), 'sceneweave-classified-'))
  const config = loadAiConfig({ SCENEWEAVE_AI_DATA_DIR: directory, SCENEWEAVE_AI_ALLOWED_ORIGINS: origin,
    SCENEWEAVE_AI_ACCESS_TOKEN: token, SCENEWEAVE_AI_PROVIDER_BASE_URL: 'http://127.0.0.1:9999/v1',
    SCENEWEAVE_AI_PROVIDER_API_KEY: 'test-only-private', SCENEWEAVE_AI_PROVIDER_MODEL: 'test-model' })
  const info = connectionInfo(config)
  if (!enabled) info.capabilities = { ...info.capabilities, authoringVersions: [1], baseMapVersions: [1], budgetPolicyHashes: [] }
  let round = 0
  const provider: ProviderAdapter = { complete: vi.fn(async (input: ProviderInput) => {
    const first = ++round === 1
    if (first && streamFirst) input.onText('正在修改。')
    const edits = [{ id: 'classified-edit', name: 'sceneweave_edit_props', arguments: JSON.stringify({ operations: [{ kind: 'opacity', id: source.scope.targetIds[0], value: .5 }] }) },
      ...(twoEdits ? [{ id: 'classified-edit-2', name: 'sceneweave_edit_props', arguments: JSON.stringify({ operations: [{ kind: 'opacity', id: source.scope.targetIds[0], value: .75 }] }) }] : [])]
    const result = first ? completion(edits) : completion()
    return { ...result, text: first && streamFirst ? '正在修改。' : '' }
  }) }
  let store = new TaskStore(directory), engine = new TaskEngine(store, provider, info)
  let app = createAiApp(config, { store, engine }), closed = false
  const request = (path: string, method = 'GET', body?: unknown) => app.request(path, { method,
    headers: { Authorization: `Bearer ${token}`, Origin: origin, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  const createBody = (): CreateTaskRequest => ({ schemaVersion: 1, clientRequestId: randomUUID(), prompt: '调整已授权底图物件。',
    context: { sceneId: source.source.preservation.sceneId!, revision: source.source.preservation.revision!, audience: 'public' }, authoring: source })
  const restart = () => { engine.close(); store.close(); store = new TaskStore(directory); engine = new TaskEngine(store, provider, info); app = createAiApp(config, { store, engine }) }
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }), () => { if (!closed) { closed = true; engine.close(); store.close() } })
  return { request, createBody, restart, provider, owner: config.accessTokens.get(token)!, get store() { return store } }
}
async function waiting(subject: ReturnType<typeof setup>, id: string) {
  await vi.waitFor(() => expect(subject.store.read(id).snapshot.status).toBe('waiting_browser'), { timeout: 30_000, interval: 25 })
  return TaskSnapshotSchema.parse(await (await subject.request(`/v1/tasks/${id}`)).json())
}

describe('classified generated-map continuation service', () => {
  it('retains executed tool attempts and completed provider usage after a later tool limit without publishing a partial draft', async () => {
    const source = continuationFixture(), subject = setup(source, true, false, true), defaults = subject.store.limits.bind(subject.store)
    // Initialization consumes one execution attempt, leaving one of these two
    // model tools executable. The second causes a post-first-tool round failure.
    vi.spyOn(subject.store, 'limits').mockImplementation(task => ({ ...defaults(task), toolCalls: 2 }))
    const response = await subject.request('/v1/tasks', 'POST', subject.createBody())
    expect(response.status).toBe(201)
    const id = (await response.json()).id
    await vi.waitFor(() => expect(subject.store.read(id).snapshot.status).toBe('failed'), { timeout: 30_000, interval: 25 })
    const saved = subject.store.read(id), snapshot = TaskSnapshotSchema.parse(saved.snapshot)
    expect(snapshot.error?.code).toBe('tool_limit')
    expect(snapshot.error?.requestState).toBe('finished')
    expect(saved.toolAttempts).toBe(2)
    expect(saved.completedRequests).toBe(1)
    expect(snapshot.usage).toMatchObject({ requests: 1, inputTokens: 10, outputTokens: 8, unknown: false })
    expect(snapshot.executionCheckpoint).toMatchObject({ toolAttempts: 2, modelRequests: 1, completedRequests: 1, uncertain: false })
    expect(snapshot.executionCheckpoint!.outputBytes).toBeGreaterThan(0)
    expect(snapshot.authoring).toMatchObject({ draftRevision: 0, budget: { aiCost: 0 } })
    expect(saved.authoring!.state.steps).toHaveLength(0)
    expect(snapshot.tools).toHaveLength(0)
    expect(saved.messages.some(message => message.role === 'assistant' || message.role === 'tool')).toBe(false)
    expect(subject.provider.complete).toHaveBeenCalledTimes(1)
    expect((await subject.request('/v1/tasks', 'POST', subject.createBody())).status).toBe(409)
  }, 60_000)
  it('marks unexpected running-flow restart uncertain and cannot resume from an unproven execution remainder', async () => {
    const source = continuationFixture(), subject = setup(source)
    const created = subject.store.create(subject.owner, subject.createBody(), 1).task
    subject.restart()
    const saved = TaskSnapshotSchema.parse(await (await subject.request(`/v1/tasks/${created.snapshot.id}`)).json())
    expect(saved.status).toBe('paused')
    expect(saved.error?.code).toBe('execution_unknown')
    expect(saved.executionCheckpoint?.uncertain).toBe(true)
    expect(saved.authoring).toMatchObject({ budget: { aiCost: 0 } })
    const resume = await subject.request(`/v1/tasks/${saved.id}/control`, 'POST', { schemaVersion: 1, expectedGeneration: saved.generation, action: 'resume' })
    expect(resume.status).toBe(409)
    expect(await resume.json()).toMatchObject({ error: { code: 'execution_unknown' } })
    expect(subject.provider.complete).not.toHaveBeenCalled()
  }, 60_000)
  it('rejects an oversized recent-task aggregate explicitly while preserving a valid per-ID response', async () => {
    const source = continuationFixture(), subject = setup(source), state = replayAuthoring(source, []).state
    if (state.schemaVersion !== 2) throw new Error('Expected classified fixture')
    // Wire-boundary fixture only: these summaries do not prove a corresponding
    // large scene was generated, rendered, persisted or replayed in this test.
    const changedIds = Array.from({ length: 8192 }, (_, i) => `${i}-` + '地'.repeat(250))
    const snapshots = Array.from({ length: 3 }, () => {
      const id = randomUUID(), executionCheckpoint = recordAuthoringExecution({ schemaVersion: 2, flowId: source.source.flowId,
        taskId: id, generation: 1, policyHash: state.policyHash, sourceHash: state.sourceHash, ledgerHeadHash: state.ledgerHeadHash,
        budgetStateHash: state.budgetStateHash, activeRuntimeMs: 1, initializationMs: 1, modelRequests: 0, completedRequests: 0, toolAttempts: 1, outputBytes: 0 })
      return TaskSnapshotSchema.parse({ schemaVersion: 1, id, clientRequestId: randomUUID(), context: subject.createBody().context,
        status: 'paused', generation: 1, lastSequence: 1, text: '', tools: [], usage: { inputTokens: null, outputTokens: null, requests: 0, unknown: true },
        error: null, createdAt: 1, updatedAt: 1, expiresAt: 2, authoring: { ...authoringSummary(source, state, null), changedIds }, executionCheckpoint })
    })
    vi.spyOn(subject.store, 'list').mockReturnValue(snapshots)
    const list = await subject.request('/v1/tasks')
    expect(list.status).toBe(413)
    expect(await list.json()).toMatchObject({ error: { code: 'task_list_limit', retryable: false } })
    vi.spyOn(subject.store, 'read').mockReturnValue({ owner: 'wire-fixture', fingerprint: 'wire-fixture', snapshot: snapshots[0],
      messages: [], calls: {}, runtimeMs: 1, runStartedAt: null, outputBytes: 0, toolAttempts: 1, completedRequests: 0, pendingText: '' })
    const single = await subject.request(`/v1/tasks/${snapshots[0].id}`)
    expect(single.status).toBe(200)
    expect(TaskSnapshotSchema.parse(await single.json()).authoring?.changedIds).toHaveLength(8192)
  }, 30_000)
  it('reduces the exact persisted SSE sequence without splitting budget, request usage and execution identities', async () => {
    const source = continuationFixture(), subject = setup(source, true, true, true)
    const created = await subject.request('/v1/tasks', 'POST', subject.createBody())
    expect(created.status).toBe(201)
    let projected = TaskSnapshotSchema.parse(await created.json())
    const saved = await waiting(subject, projected.id), events = subject.store.events(projected.id, projected.lastSequence)
    expect(events.some(event => event.type === 'authoring_checkpoint')).toBe(true)
    expect(events.some(event => event.type === 'text_delta')).toBe(true)
    expect(events.filter(event => event.type === 'tool_result')).toHaveLength(2)
    expect(events.some(event => event.type === 'draft_updated' || event.type === 'usage')).toBe(false)
    for (const event of events) projected = reduceTaskEvent(projected, event)
    expect(projected.usage).toEqual(saved.usage)
    expect(projected.authoring).toEqual(saved.authoring)
    expect(projected.executionCheckpoint).toEqual(saved.executionCheckpoint)
    expect(projected.text).toBe('正在修改。')
    expect(projected.status).toBe('waiting_browser')
    expect(projected.authoring).toMatchObject({ draftRevision: 2, budget: { aiCost: 2 } })
    const first = events.find(event => event.type === 'authoring_checkpoint')!
    if (first.type !== 'authoring_checkpoint') throw new Error('Expected atomic checkpoint')
    expect(() => reduceTaskEvent(projected, { ...first, sequence: projected.lastSequence + 1,
      data: { ...first.data, usage: { ...first.data.usage, requests: 999 } } })).toThrow()
  }, 60_000)
  it('negotiates v2 explicitly and binds the preservation context rather than the generated scene', async () => {
    const source = continuationFixture(), old = setup(source, false), input = old.createBody()
    expect((await old.request('/v1/tasks', 'POST', input)).status).toBe(400)
    expect(old.provider.complete).not.toHaveBeenCalled()
    const subject = setup(source)
    const changed = subject.createBody(); changed.context!.revision++
    expect((await subject.request('/v1/tasks', 'POST', changed)).status).toBe(400)
    expect(subject.provider.complete).not.toHaveBeenCalled()
  })

  it('preserves G/A and server execution work, rejects forged budget claims and prevents a second task for the same flow', async () => {
    const source = cloneJson(continuationFixture()); source.source.execution.executor = 'server'
    const subject = setup(source)
    const missing = await subject.request('/v1/tasks', 'POST', subject.createBody())
    expect(missing.status).toBe(409)
    expect(subject.provider.complete).not.toHaveBeenCalled()
    for (let i = 0; i < 2; i++) {
      const generated = await subject.request('/v1/terrain/basemap', 'POST', source.source.request)
      expect(generated.status).toBe(200)
      expect((await generated.json()).resultHash).toBe(source.source.response.resultHash)
    }
    const input = subject.createBody(), created = await subject.request('/v1/tasks', 'POST', input)
    expect(created.status).toBe(201)
    const id = (await created.json()).id, snapshot = await waiting(subject, id)
    const draft = AuthoringDraftSchema.parse(await (await subject.request(`/v1/tasks/${id}/draft`)).json())
    if (draft.state.schemaVersion !== 2 || !snapshot.authoring || !('schemaVersion' in snapshot.authoring) || snapshot.authoring.schemaVersion !== 2) throw new Error('Expected classified draft')
    expect(draft.state.budget.generationCost).toBeGreaterThan(0)
    expect(draft.state.budget.aiCost).toBe(1)
    expect(snapshot.executionCheckpoint!.toolAttempts).toBeGreaterThanOrEqual(4)
    expect(snapshot.executionCheckpoint!.initializationMs).toBeGreaterThan(0)
    expect(snapshot.executionCheckpoint!.budgetStateHash).toBe(draft.state.budgetStateHash)
    const stamp = authoringDraftStamp(draft.state, draft.generation), bad = { ...stamp, ledgerHeadHash: 'f'.repeat(64) }
    expect((await subject.request(`/v1/tasks/${id}/draft/validate`, 'POST', { ...bad, valid: true })).status).toBe(409)
    expect((await subject.request(`/v1/tasks/${id}/draft/validate`, 'POST', { ...stamp, valid: true })).status).toBe(200)
    expect((await subject.request(`/v1/tasks/${id}/draft/claim`, 'POST', { ...bad, claimId: randomUUID() })).status).toBe(409)
    const claimId = randomUUID(), lease = await (await subject.request(`/v1/tasks/${id}/draft/claim`, 'POST', { ...stamp, claimId })).json()
    expect(lease).toMatchObject({ schemaVersion: 2, policyHash: draft.state.policyHash, sourceHash: draft.state.sourceHash,
      ledgerHeadHash: draft.state.ledgerHeadHash, budgetStateHash: draft.state.budgetStateHash })
    expect((await subject.request('/v1/tasks', 'POST', input)).status).toBe(201)
    expect((await subject.request('/v1/tasks', 'POST', subject.createBody())).status).toBe(409)
    expect((await subject.request('/v1/terrain/basemap', 'POST', source.source.request)).status).toBe(409)
    const before = snapshot.executionCheckpoint!
    subject.restart()
    const resumed = TaskSnapshotSchema.parse(await (await subject.request(`/v1/tasks/${id}`)).json())
    expect(resumed.status).toBe('paused')
    expect(resumed.authoring).toMatchObject({ budget: draft.state.budget, ledgerHeadHash: draft.state.ledgerHeadHash })
    expect(resumed.executionCheckpoint!.activeRuntimeMs).toBeGreaterThanOrEqual(before.activeRuntimeMs)
    expect(resumed.executionCheckpoint!.modelRequests).toBe(before.modelRequests)
    expect((await subject.request(`/v1/tasks/${id}/draft/applied`, 'POST', { ...bad, claimId, sceneId: source.project.document.sceneId, revision: source.project.document.revision + 1 })).status).toBe(409)
    expect((await subject.request(`/v1/tasks/${id}/draft/applied`, 'POST', { ...stamp, claimId, sceneId: source.project.document.sceneId, revision: source.project.document.revision + 1 })).status).toBe(200)
  }, 60_000)

  it('keeps failed initialization work and rejects changed frozen generation input', async () => {
    const source = cloneJson(continuationFixture()), subject = setup(source)
    const bad = subject.createBody()
    if (bad.authoring?.schemaVersion !== 2) throw new Error('Expected classified request')
    bad.authoring.source.identityAllocation[0] += '-forged'
    expect((await subject.request('/v1/tasks', 'POST', bad)).status).toBe(400)
    const original = continuationFixture(), input = subject.createBody(); input.authoring = original
    const created = await subject.request('/v1/tasks', 'POST', input)
    expect(created.status).toBe(201)
    const snapshot = await waiting(subject, (await created.json()).id)
    expect(snapshot.executionCheckpoint!.toolAttempts).toBeGreaterThanOrEqual(3)
    expect(snapshot.executionCheckpoint!.initializationMs).toBeGreaterThan(0)
    const changed = cloneJson(original.source.request); changed.requestId += '-other'
    expect((await subject.request('/v1/terrain/basemap', 'POST', changed)).status).toBe(409)
  }, 60_000)
})
