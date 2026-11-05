import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { continuationFixture as continuationFixtureV2 } from '../../tests/helpers/continuation-fixture.js'
import { continuationFixtureV3 } from '../../tests/helpers/continuation-v3-fixture.js'
import { emptyBudgetUsage } from '../../src/shared/budget/task-budget.js'
import { canonicalJson, cloneJson } from '../../src/shared/validation/json.js'
import { authoringSummary, applyAuthoringStep, replayAuthoring, checkAuthoringDraft } from '../../src/shared/ai/authoring.js'
import type { AuthoringStartV2, AuthoringStartV3 } from '../../src/shared/ai/authoring-protocol.js'
import { TaskSnapshotSchema, type CreateTaskRequest } from '../../src/shared/ai/protocol.js'
import { connectionInfo, createAiApp } from './app.js'
import { loadAiConfig } from './config.js'
import { TaskEngine } from './engine.js'
import { TaskStore } from './store.js'
import type { ProviderAdapter } from './provider-types.js'
import { reduceTaskEvent } from '../../src/platform/browser/ai/client.js'
import { executeAuthoringTool } from './authoring-tools.js'
import { recordAuthoringExecution } from './execution-checkpoint.js'

const cleanups: (() => void)[] = [], token = 'a'.repeat(40), origin = 'https://editor.example.test'
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup() })
function setup(source: AuthoringStartV2 | AuthoringStartV3) {
  const directory = mkdtempSync(join(tmpdir(), 'sceneweave-classified-'))
  const config = loadAiConfig({ SCENEWEAVE_AI_DATA_DIR: directory, SCENEWEAVE_AI_ALLOWED_ORIGINS: origin,
    SCENEWEAVE_AI_ACCESS_TOKEN: token, SCENEWEAVE_AI_PROVIDER_BASE_URL: 'http://127.0.0.1:9999/v1',
    SCENEWEAVE_AI_PROVIDER_API_KEY: 'test-only-private', SCENEWEAVE_AI_PROVIDER_MODEL: 'test-model' })
  const info = connectionInfo(config)
  const provider: ProviderAdapter = { complete: vi.fn(async () => { throw new Error('Retained artifact must not send a new provider request') }) }
  let store = new TaskStore(directory), engine = new TaskEngine(store, provider, info)
  let app = createAiApp(config, { store, engine }), closed = false
  const request = (path: string, method = 'GET', body?: unknown) => {
    const value = body as { authoring?: { schemaVersion: number }; version?: number } | undefined
    const route = path === '/v1/tasks' && method === 'POST' && value?.authoring?.schemaVersion === 3 ? `${path}?authoringVersion=3`
      : path === '/v1/terrain/basemap' && value?.version === 3 ? `${path}?baseMapVersion=3` : path
    return app.request(route, { method,
    headers: { Authorization: `Bearer ${token}`, Origin: origin, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  }
  const createBody = (): CreateTaskRequest => ({ schemaVersion: 1, clientRequestId: randomUUID(), prompt: '调整已授权底图物件。',
    context: { sceneId: source.source.preservation.sceneId!, revision: source.source.preservation.revision!, audience: 'public' }, authoring: source })
  const restart = () => { engine.close(); store.close(); store = new TaskStore(directory); engine = new TaskEngine(store, provider, info); app = createAiApp(config, { store, engine }) }
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }), () => { if (!closed) { closed = true; engine.close(); store.close() } })
  return { request, createBody, restart, provider, owner: config.accessTokens.get(token)!, get store() { return store }, get engine() { return engine } }
}
describe.each([2, 3] as const)('retained generated-map continuation service protocol %s', version => {
  const continuationFixture = () => version === 2 ? continuationFixtureV2() : continuationFixtureV3()
  // Internal persistence fixture for a previously verified source. The public
  // engine/HTTP entrance remains protocol4-only and never calls this helper.
  const retain = (subject: ReturnType<typeof setup>) => subject.store.create(subject.owner, subject.createBody(), 1).task

  it('refuses fresh old-protocol tasks at HTTP and engine boundaries without calling the provider or registering a flow', async () => {
    const subject = setup(continuationFixture()), input = subject.createBody()
    for (const path of ['/v1/tasks', '/v1/tasks?authoringVersion=3', '/v1/tasks?authoringVersion=4']) {
      const response = await subject.request(path, 'POST', input)
      expect(response.status).toBe(400)
    }
    expect(() => subject.engine.create(subject.owner, input)).toThrow('unsupported_authoring_version')
    expect(subject.store.list(subject.owner)).toEqual([])
    expect(subject.provider.complete).not.toHaveBeenCalled()
  }, 60000)

  it('keeps the exact retained source, budget and idempotent ledger instead of rewriting them to protocol4', () => {
    const source = continuationFixture(), subject = setup(source), saved = retain(subject)
    const id = source.scope.targetIds[0], initial = saved.authoring!.state
    if (initial.schemaVersion !== 2 && initial.schemaVersion !== 3) throw new Error('Expected retained state')
    const operation = { kind: 'opacity' as const, id, value: .5 }
    const edited = replayAuthoring(source, [{ index: 1, stepId: 'retained-edit', operations: [operation] }])
    if (edited.state.schemaVersion !== 2 && edited.state.schemaVersion !== 3) throw new Error('Expected retained edit')
    expect(edited.state.schemaVersion).toBe(version)
    expect(checkAuthoringDraft(source, edited.state).valid).toBe(true)
    expect(applyAuthoringStep(source, edited.state, [operation], 'retained-edit').state).toEqual(edited.state)
    expect(edited.state.ledger[0]).toEqual(initial.ledger[0])
    expect(edited.state.budget.aiCost).toBe(1)
    expect(subject.store.read(saved.snapshot.id).authoring!.state).toEqual(initial)
    expect(subject.provider.complete).not.toHaveBeenCalled()
  }, 60000)

  it('marks unexpected running-flow restart uncertain and cannot resume from an unproven execution remainder', async () => {
    const source = continuationFixture(), subject = setup(source)
    const created = retain(subject)
    const initialCheckpoint = created.snapshot.executionCheckpoint
    let workBeforeRestart = initialCheckpoint?.schemaVersion === 3 ? initialCheckpoint.workUsage : undefined
    if (version === 3) {
      const priorState = canonicalJson(created.authoring!.state), initialWork = { ...workBeforeRestart! }
      subject.store.change(created.snapshot.id, created.snapshot.generation, current => {
        expect(executeAuthoringTool(current, { id: 'readonly-replay', name: 'sceneweave_read_scene', arguments: '{"section":"summary"}' }, { section: 'summary' }).success).toBe(true)
        return []
      })
      const read = subject.store.read(created.snapshot.id)
      expect(canonicalJson(read.authoring!.state)).toBe(priorState)
      if (read.snapshot.executionCheckpoint?.schemaVersion !== 3) throw new Error('Expected work checkpoint')
      expect(read.snapshot.executionCheckpoint.workUsage.fieldEvaluations).toBeGreaterThan(initialWork.fieldEvaluations)
      const afterRead = { ...read.snapshot.executionCheckpoint.workUsage }
      expect(() => subject.store.change(created.snapshot.id, created.snapshot.generation, current => {
        executeAuthoringTool(current, { id: 'failed-round-read', name: 'sceneweave_read_scene', arguments: '{"section":"summary"}' }, { section: 'summary' })
        throw new Error('reject round after actual replay')
      })).toThrow('reject round')
      const failed = subject.store.read(created.snapshot.id)
      expect(canonicalJson(failed.authoring!.state)).toBe(priorState)
      if (failed.snapshot.executionCheckpoint?.schemaVersion !== 3) throw new Error('Expected preserved work checkpoint')
      expect(failed.snapshot.executionCheckpoint.workUsage.fieldEvaluations).toBeGreaterThan(afterRead.fieldEvaluations)
      workBeforeRestart = failed.snapshot.executionCheckpoint.workUsage
      expect(subject.store.events(created.snapshot.id, created.snapshot.lastSequence).some(event => event.type === 'authoring_checkpoint')).toBe(true)
    }
    subject.restart()
    const saved = TaskSnapshotSchema.parse(await (await subject.request(`/v1/tasks/${created.snapshot.id}`)).json())
    expect(saved.status).toBe('paused')
    expect(saved.error?.code).toBe('execution_unknown')
    expect(saved.executionCheckpoint?.uncertain).toBe(true)
    if (saved.executionCheckpoint?.schemaVersion === 3) expect(saved.executionCheckpoint.workUsage).toEqual(workBeforeRestart)
    expect(saved.authoring).toMatchObject({ budget: { aiCost: 0 } })
    const resume = await subject.request(`/v1/tasks/${saved.id}/control`, 'POST', { schemaVersion: 1, expectedGeneration: saved.generation, action: 'resume' })
    expect(resume.status).toBe(409)
    expect(await resume.json()).toMatchObject({ error: { code: 'execution_unknown' } })
    expect(subject.provider.complete).not.toHaveBeenCalled()
  }, 60_000)
  it('rejects an oversized recent-task aggregate explicitly while preserving a valid per-ID response', async () => {
    const source = continuationFixture(), subject = setup(source), state = replayAuthoring(source, []).state
    if (state.schemaVersion !== 2 && state.schemaVersion !== 3) throw new Error('Expected retained fixture')
    if (state.schemaVersion !== version) throw new Error('Expected matching retained version')
    // Wire-boundary fixture only: these summaries do not prove a corresponding
    // large scene was generated, rendered, persisted or replayed in this test.
    const changedIds = Array.from({ length: 8192 }, (_, i) => `${i}-` + '地'.repeat(250))
    const snapshots = Array.from({ length: 3 }, () => {
      const id = randomUUID(), executionCheckpoint = recordAuthoringExecution({ ...(version === 3 ? { schemaVersion: 3 as const, workUsage: emptyBudgetUsage() } : { schemaVersion: 2 as const }), flowId: source.source.flowId,
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
  it('reads persisted atomic checkpoints with exact usage and rejects a forged SSE execution identity', () => {
    const source = continuationFixture(), subject = setup(source), created = retain(subject), id = created.snapshot.id
    const operation = { kind: 'opacity' as const, id: source.scope.targetIds[0], value: .5 }
    subject.store.change(id, 1, current => {
      const edited = applyAuthoringStep(source, current.authoring!.state, [operation], 'stored-edit')
      current.authoring!.state = edited.state
      current.snapshot.authoring = authoringSummary(source, edited.state, null)
      current.snapshot.usage = { requests: 1, inputTokens: 10, outputTokens: 8, unknown: false }
      current.completedRequests = 1; current.toolAttempts++
      current.snapshot.text = '已保全的草稿。'; current.snapshot.status = 'waiting_browser'
      return [{ type: 'text_delta', data: { text: current.snapshot.text } }, { type: 'draft_updated', data: current.snapshot.authoring },
        { type: 'usage', data: current.snapshot.usage }, { type: 'status', data: { status: 'waiting_browser', reason: null } }]
    })
    const saved = subject.store.read(id), events = subject.store.events(id, created.snapshot.lastSequence)
    let projected = created.snapshot
    expect(events.some(event => event.type === 'authoring_checkpoint')).toBe(true)
    expect(events.some(event => event.type === 'draft_updated' || event.type === 'usage')).toBe(false)
    for (const event of events) projected = reduceTaskEvent(projected, event)
    expect(projected).toMatchObject({ status: 'waiting_browser', text: '已保全的草稿。' })
    expect(projected.usage).toEqual(saved.snapshot.usage)
    expect(projected.authoring).toEqual(saved.snapshot.authoring)
    expect(projected.executionCheckpoint).toEqual(saved.snapshot.executionCheckpoint)
    const checkpoint = events.find(event => event.type === 'authoring_checkpoint')!
    if (checkpoint.type !== 'authoring_checkpoint') throw new Error('Expected atomic checkpoint')
    expect(() => reduceTaskEvent(projected, { ...checkpoint, sequence: projected.lastSequence + 1,
      data: { ...checkpoint.data, usage: { ...checkpoint.data.usage, requests: 999 } } })).toThrow()
    expect(subject.provider.complete).not.toHaveBeenCalled()
  }, 60000)

  it('retains verified generation execution and rejects a changed exact source or a second flow', async () => {
    const source = cloneJson(continuationFixture()); source.source.execution.executor = 'server'
    const subject = setup(source)
    expect(() => retain(subject)).toThrow('execution_checkpoint_missing')
    for (let index = 0; index < 2; index++) {
      const generated = await subject.request('/v1/terrain/basemap', 'POST', source.source.request)
      expect(generated.status).toBe(200)
      expect((await generated.json()).resultHash).toBe(source.source.response.resultHash)
    }
    const saved = retain(subject)
    expect(saved.snapshot.executionCheckpoint!.toolAttempts).toBeGreaterThanOrEqual(3)
    expect(saved.snapshot.executionCheckpoint!.initializationMs).toBeGreaterThanOrEqual(0)
    const before = canonicalJson(saved.authoring!.state), bad = cloneJson(subject.createBody())
    if (!bad.authoring || bad.authoring.schemaVersion !== version) throw new Error('Expected retained source')
    bad.authoring.source.identityAllocation[0] += '-forged'
    bad.clientRequestId = randomUUID()
    expect(() => subject.store.create(subject.owner, bad, 2)).toThrow()
    expect(canonicalJson(subject.store.read(saved.snapshot.id).authoring!.state)).toBe(before)
    expect(() => subject.store.create(subject.owner, subject.createBody(), 2)).toThrow('flow_already_started')
    expect(subject.provider.complete).not.toHaveBeenCalled()
  }, 60000)
})
