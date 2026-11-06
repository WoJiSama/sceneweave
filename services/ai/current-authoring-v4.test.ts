import { toCurrentSceneDocument } from '../../src/shared/model/current-scene.js'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { continuationFixtureV3 } from '../../tests/helpers/continuation-v3-fixture.js'
import { emptyTerrainDocument } from '../../src/shared/terrain-generation/compose.js'
import { emptyVisualSystem } from '../../src/shared/visual/types.js'
import { createCompositionContent } from '../../src/shared/appearance/graph.js'
import { validateProjectData } from '../../src/shared/project/validate.js'
import { svgProjectFixture, svgFixturePng } from '../../tests/helpers/m24-svg-fixtures.js'
import { createPublicVisionInput } from '../../src/shared/ai/vision.js'
import { authoringDraftStamp, authoringProjectHash, createCurrentAuthoringStartV4, createGeneratedAuthoringStartV4, replayAuthoring } from '../../src/shared/ai/authoring.js'
import type { AuthoringStartV4 } from '../../src/shared/ai/authoring-protocol-v4.js'
import { canonicalJson, cloneJson } from '../../src/shared/validation/json.js'
import { connectionInfo, createAiApp } from './app.js'
import { loadAiConfig } from './config.js'
import { TaskEngine } from './engine.js'
import { TaskStore, type StoredTask } from './store.js'
import { executeAuthoringTool, getAuthoringTools, initialAuthoringContext } from './authoring-tools.js'
import { publicScreenshotReference } from './visual-review.js'
import { assertPersistedAuthoringV4 } from './persisted-authoring.js'
import type { ProviderAdapter, ProviderCompletion, ProviderInput, ProviderToolCall } from './provider-types.js'

const token = 'a'.repeat(40), origin = 'https://editor.example.test', cleanups: (() => void)[] = []
let generated: ReturnType<typeof continuationFixtureV3>
beforeAll(() => { generated = continuationFixtureV3() })
afterEach(() => { vi.useRealTimers(); for (const cleanup of cleanups.splice(0).reverse()) cleanup() })
function source(): AuthoringStartV4 {
  const project = cloneJson(generated.project), hash = authoringProjectHash(project)
  return createCurrentAuthoringStartV4({ project, scope: cloneJson(generated.scope), seed: randomUUID(), flowId: randomUUID(),
    preparedAt: '2026-10-31T00:00:00.000Z', preservation: { sceneId: project.document.sceneId, revision: project.document.revision, contentHash: hash, checkpoint: 1 },
    brief: { recipe: 'custom', requirements: ['保留实际地形和有限编辑', '外观仍须独立审阅'] } })
}
function taskFixture(start = source()): StoredTask {
  return { owner: 'test', fingerprint: 'test', calls: {}, runtimeMs: 0, runStartedAt: null, outputBytes: 0, toolAttempts: 0, completedRequests: 0, pendingText: '', messages: [],
    authoring: { start, state: replayAuthoring(start, []).state }, snapshot: { schemaVersion: 1, id: randomUUID(), clientRequestId: randomUUID(), context: {
      sceneId: start.source.preservation.sceneId!, revision: start.source.preservation.revision!, audience: 'public' }, status: 'running', generation: 1, lastSequence: 0,
      text: '', tools: [], usage: { requests: 0, inputTokens: null, outputTokens: null, unknown: true }, error: null, createdAt: 1, updatedAt: 1, expiresAt: 100000 } }
}
function generatedTaskWithNarrowScope(): StoredTask {
  const input = cloneJson(generated), scene = input.scope.scene!
  input.scope.targetIds = input.scope.targetIds.slice(0, 1)
  input.scope.scene = null
  input.scope.visual = { floorId: scene.floorId, layerId: scene.layerId, boundsMm: scene.boundsMm, entityIds: [], definitionIds: [], materialIds: [], operations: ['visualLight'] }
  input.brief = { recipe: 'custom', requirements: ['仅修改明确选择的物件及新建局部灯光'] }
  return taskFixture(createGeneratedAuthoringStartV4(input))
}
const call = (name: string, args: unknown, id = randomUUID()): ProviderToolCall => ({ id, name, arguments: JSON.stringify(args) })
function tool(task: StoredTask, name: string, args: unknown, id = randomUUID()) {
  const result = executeAuthoringTool(task, call(name, args, id), args)
  return { result, output: JSON.parse(result.output) as Record<string, any> }
}
const completion = (toolCalls: ProviderToolCall[] = []): ProviderCompletion => ({ text: '', toolCalls, finishReason: toolCalls.length ? 'tool_calls' : 'stop', usage: { inputTokens: 10, outputTokens: 8 }, requestId: 'unit-only' })
function setup(provider: ProviderAdapter, limits?: Partial<ReturnType<TaskStore['limits']>>) {
  const directory = mkdtempSync(join(tmpdir(), 'sceneweave-authoring4-'))
  const config = loadAiConfig({ SCENEWEAVE_AI_DATA_DIR: directory, SCENEWEAVE_AI_ALLOWED_ORIGINS: origin, SCENEWEAVE_AI_ACCESS_TOKEN: token,
    SCENEWEAVE_AI_PROVIDER_BASE_URL: 'http://127.0.0.1:9999/v1', SCENEWEAVE_AI_PROVIDER_API_KEY: 'unit-only-private', SCENEWEAVE_AI_PROVIDER_MODEL: 'mock' })
  const store = new TaskStore(directory), engine = new TaskEngine(store, provider, connectionInfo(config))
  if (limits) { const defaults = store.limits.bind(store); vi.spyOn(store, 'limits').mockImplementation(task => ({ ...defaults(task), ...limits })) }
  const app = createAiApp(config, { store, engine })
  const request = (path: string, method = 'GET', body?: unknown) => app.request(path, { method, headers: {
    Authorization: `Bearer ${token}`, Origin: origin, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) })
  const create = (start = source()) => request('/v1/tasks?authoringVersion=4', 'POST', { schemaVersion: 1, clientRequestId: randomUUID(), prompt: '仅调整明确授予的物件。',
    context: { sceneId: start.source.preservation.sceneId, revision: start.source.preservation.revision, audience: 'public' }, authoring: start })
  let closed = false
  const shutdown = () => { if (!closed) { closed = true; engine.close(); store.close() } }
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }), shutdown)
  return { store, engine, request, create, directory, shutdown }
}

describe('explicit authoring4 stage and review tools (metadata fixtures, no real image/model claim)', () => {
  it('publishes only explicitly negotiated stage/review recipes and provides exact generation/budget stamps', () => {
    const task = taskFixture(), old = getAuthoringTools(generated.scope, 3)
    expect(old.some(tool => tool.name === 'sceneweave_apply_stage' || tool.name === 'sceneweave_visual_review')).toBe(false)
    const current = getAuthoringTools(task.authoring!.start.scope, 4)
    expect(current.map(tool => tool.name)).toContain('sceneweave_apply_stage')
    expect(current.map(tool => tool.name)).toContain('sceneweave_visual_review')
    expect(initialAuthoringContext(task)).toMatchObject({ expected: authoringDraftStamp(task.authoring!.state, 1) })
    const target = task.authoring!.start.scope.targetIds[0]
    expect(tool(task, 'sceneweave_edit_props', { operations: [{ kind: 'opacity', id: target, value: .6 }] }).output.expected)
      .toEqual(authoringDraftStamp(task.authoring!.state, 1))
  })
  // Seventeen real recipes cross two internal steps and repeatedly replay/validate the complete generated project.
  it('installs a 17-recipe stage once after both internal steps pass and refuses a stale budget identity', () => {
    const task = taskFixture(), expected = authoringDraftStamp(task.authoring!.state, 1), id = task.authoring!.start.scope.targetIds[0]
    const operations = Array.from({ length: 17 }, (_, index) => ({ kind: 'opacity', id, value: .3 + index / 100 }))
    const applied = tool(task, 'sceneweave_apply_stage', { stage: 'furnishing', expected, operations })
    expect(applied.result.success).toBe(true)
    expect(applied.output).toMatchObject({ atomic: true, stepsApplied: 2, draftRevision: 2 })
    expect(applied.output.actualOperationCost).toBeGreaterThan(17)
    expect(task.authoring!.state.steps).toHaveLength(2)
    const unchanged = canonicalJson(task.authoring!.state)
    expect(tool(task, 'sceneweave_apply_stage', { stage: 'review', expected, operations: operations.slice(0, 1) }).result.success).toBe(false)
    expect(canonicalJson(task.authoring!.state)).toBe(unchanged)
  }, 20000)
  // The rejected second step still performs the preceding recipes' complete project and cumulative ledger checks.
  it('rejects a failure in the second internal step with no partial state, plan or artifact install', () => {
    const task = taskFixture(), before = canonicalJson(task), expected = authoringDraftStamp(task.authoring!.state, 1), id = task.authoring!.start.scope.targetIds[0]
    const operations = [...Array.from({ length: 16 }, () => ({ kind: 'opacity', id, value: .4 })), { kind: 'opacity', id: 'PRIVATE_UNGRANTED', value: .5 }]
    const failed = tool(task, 'sceneweave_apply_stage', { stage: 'review', expected, operations })
    expect(failed.result.success).toBe(false); expect(canonicalJson(task)).toBe(before)
    expect(failed.result.output).not.toContain('PRIVATE_UNGRANTED')
  }, 20000)
  it('binds compact review to latest image and exact ledger, then requires a successful prior proposal before explicit apply', () => {
    const task = taskFixture(), start = task.authoring!.start, id = start.scope.targetIds[0]
    const image = createPublicVisionInput(svgFixturePng(), { sceneId: start.project.document.sceneId, revision: start.project.document.revision,
      boundsMm: start.scope.scene!.boundsMm, draft: { draftRevision: 0, contentHash: start.baseContentHash } })
    task.messages.push({ role: 'user', content: 'Explicit test PNG', images: [image] })
    const screenshotRef = publicScreenshotReference(task)!, before = canonicalJson(task)
    const args = { screenshotRef, issues: [{ observation: '检查该物件的明暗', uncertainty: '测试图片不证明真实外观质量', target: { kind: 'entities', ids: [id] } }], candidateOperations: [{ kind: 'opacity', id, value: .5 }] }
    const proposed = tool(task, 'sceneweave_visual_review', args)
    expect(proposed.result.success).toBe(true); expect(canonicalJson(task)).toBe(before)
    expect(proposed.output).toMatchObject({ appearance: 'unconfirmed', observation: 'unverified', applied: false, omissions: [{ status: 'unreviewed' }, { status: 'unreviewed' }] })
    expect(proposed.result.output).not.toContain('pngBase64')
    const applyArgs = { ...args, expected: proposed.output.expected, candidateHash: proposed.output.candidateHash }
    expect(tool(task, 'sceneweave_apply_visual_correction', applyArgs).result.success).toBe(false)
    task.snapshot.tools.push(proposed.result)
    expect(tool(task, 'sceneweave_apply_visual_correction', applyArgs).result.success).toBe(true)
    expect(task.authoring!.state.draftRevision).toBe(1)
    expect(publicScreenshotReference(task)).toBeNull()
    expect(tool(task, 'sceneweave_visual_review', args).result.success).toBe(false)
  })
})

describe('authoring4 service budget finish and persisted proof', () => {
  it('negotiates new fields only on version4 and rejects a new task through an old route', async () => {
    const subject = setup({ complete: vi.fn(async () => completion()) })
    for (const path of ['/v1/capabilities', '/v1/capabilities?authoringVersion=2', '/v1/capabilities?authoringVersion=3&surfaceVersion=1']) {
      const value = await (await subject.request(path)).json() as any
      expect(value.capabilities.currentAuthoring).toBeUndefined(); expect(value.capabilities.authoringVersions ?? []).not.toContain(4)
    }
    expect(await (await subject.request('/v1/capabilities?authoringVersion=4')).json()).toMatchObject({ capabilities: {
      currentAuthoring: 'sceneweave-current-authoring@1', authoringVersions: [4], completeProjectVersions: [1], visualReviewVersions: [1] } })
    const start = source()
    expect((await subject.request('/v1/tasks', 'POST', { schemaVersion: 1, clientRequestId: randomUUID(), prompt: 'test', context: {
      sceneId: start.project.document.sceneId, revision: start.project.document.revision, audience: 'public' }, authoring: start })).status).toBe(400)
  })
  it('preserves the valid generated baseline when A=0 at the tool boundary and permits its exact-stamped local validation', async () => {
    const start = createGeneratedAuthoringStartV4(cloneJson(generated)), provider = { complete: vi.fn(async () => completion()) }
    const subject = setup(provider, { toolCalls: 0 }), response = await subject.create(start)
    expect(response.status).toBe(201)
    const snapshot = await response.json() as any
    await vi.waitFor(() => expect(subject.store.read(snapshot.id).snapshot.status).toBe('waiting_browser'))
    const task = subject.store.read(snapshot.id)
    expect(task.authoring!.state.draftRevision).toBe(0)
    expect(task.snapshot.authoring).toMatchObject({ schemaVersion: 4, closeout: { reason: 'tool_budget', reviewable: true, requestOutcome: 'not_sent' } })
    expect(provider.complete).not.toHaveBeenCalled()
    const validated = await subject.request(`/v1/tasks/${snapshot.id}/draft/validate`, 'POST', { ...authoringDraftStamp(task.authoring!.state, task.snapshot.generation), valid: true })
    expect(validated.status).toBe(200); expect(await validated.json()).toMatchObject({ status: 'ready' })
  })
  it('finishes an unchanged current baseline without manufacturing an adoptable draft', async () => {
    const provider = { complete: vi.fn(async () => completion()) }, subject = setup(provider, { toolCalls: 0 }), response = await subject.create()
    expect(response.status).toBe(201)
    const snapshot = await response.json() as any
    await vi.waitFor(() => expect(subject.store.read(snapshot.id).snapshot.status).toBe('failed'))
    expect(subject.store.read(snapshot.id).snapshot.authoring).toMatchObject({ closeout: { reviewable: false, remainingOperations: 256, requirements: [{ status: 'pending' }, { status: 'pending' }] } })
    expect(provider.complete).not.toHaveBeenCalled()
  })
  it('uses the real cumulative ordinary limit across four stages of at most 64 recipes without resetting it', async () => {
    const raw = cloneJson(svgProjectFixture().bundle.project)
    raw.document = toCurrentSceneDocument(raw.document)
    let sequence = 0
    const content = createCompositionContent(emptyTerrainDocument(raw.document), { ids: { nextId: () => `small-${++sequence}` }, clock: { now: () => '2026-10-31T00:00:00.000Z' } })
    const project = validateProjectData({ ...raw, ...content, schemaVersion: 1 }), hash = authoringProjectHash(project)
    const floorId = Object.keys(project.document.floors)[0]
    const start = createCurrentAuthoringStartV4({ project, scope: { targetIds: ['item'], operations: ['opacity'], placement: { floorId, layerId: project.document.entityLayers.item, supportRef: { kind: 'floor', id: floorId }, boundsMm: project.document.exportBoundsMm, definitionIds: ['definition'] } },
      seed: randomUUID(), flowId: randomUUID(), preparedAt: '2026-10-31T00:00:00.000Z', preservation: { sceneId: project.document.sceneId, revision: project.document.revision, contentHash: hash, checkpoint: 1 } }), id = 'item'
    const provider: ProviderAdapter = { complete: vi.fn(async (input: ProviderInput) => {
      const latest = input.messages.filter(message => message.role === 'tool').at(-1)
      const initial = input.messages.find(message => message.role === 'user' && message.content?.startsWith('Authorized public scene data'))!
      const receipt = latest ? JSON.parse(latest.content!) : JSON.parse(initial.content!.slice(initial.content!.indexOf('\n') + 1))
      const expected = receipt.expected
      return completion([call('sceneweave_apply_stage', { stage: 'review', expected,
        operations: Array.from({ length: Math.min(64, receipt.remainingOperations) }, () => ({ kind: 'opacity', id, value: .6 })) })])
    }) }
    const subject = setup(provider), response = await subject.create(start), snapshot = await response.json() as any
    await vi.waitFor(() => expect(subject.store.read(snapshot.id).snapshot.status).toBe('waiting_browser'), { timeout: 15000 })
    const task = subject.store.read(snapshot.id)
    expect(task.authoring!.state).toMatchObject({ operationCost: 256, draftRevision: 16 })
    expect(task.snapshot.authoring).toMatchObject({ closeout: { reason: 'operation_budget', reviewable: true, remainingOperations: 0 } })
    expect(provider.complete).toHaveBeenCalledTimes(4)
  }, 20000)
  it('ends generation on cancel but allows the exact saved legal draft to complete local validation', async () => {
    const start = source(), id = start.scope.targetIds[0]
    let round = 0
    const provider: ProviderAdapter = { complete: vi.fn(async (input: ProviderInput) => {
      if (++round === 1) return completion([call('sceneweave_edit_props', { operations: [{ kind: 'opacity', id, value: .6 }] })])
      return new Promise<ProviderCompletion>((_resolve, reject) => input.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true }))
    }) }
    const subject = setup(provider), response = await subject.create(start), snapshot = await response.json() as any
    await vi.waitFor(() => expect(provider.complete).toHaveBeenCalledTimes(2))
    const cancelled = await subject.request(`/v1/tasks/${snapshot.id}/control`, 'POST', { schemaVersion: 1, action: 'cancel', expectedGeneration: 1 })
    expect(cancelled.status).toBe(200)
    const task = subject.store.read(snapshot.id)
    expect(task.snapshot).toMatchObject({ status: 'cancelled', generation: 2, usage: { requests: 2, unknown: true } })
    const validated = await subject.request(`/v1/tasks/${snapshot.id}/draft/validate`, 'POST', { ...authoringDraftStamp(task.authoring!.state, 2), valid: true })
    expect(validated.status).toBe(200); expect(await validated.json()).toMatchObject({ status: 'ready', usage: { requests: 2, unknown: true } })
    expect(provider.complete).toHaveBeenCalledTimes(2)
  })
  it('rolls back an over-budget provider round but keeps actual attempts/completed usage and the prior legal draft', async () => {
    const start = source(), id = start.scope.targetIds[0]
    let round = 0
    const provider: ProviderAdapter = { complete: vi.fn(async () => ++round === 1 ? completion([call('sceneweave_edit_props', { operations: [{ kind: 'opacity', id, value: .6 }] })])
      : completion([call('sceneweave_edit_props', { operations: [{ kind: 'opacity', id, value: .4 }] }), call('sceneweave_edit_props', { operations: [{ kind: 'opacity', id, value: .3 }] })])) }
    const subject = setup(provider, { toolCalls: 2 }), response = await subject.create(start), snapshot = await response.json() as any
    expect(response.status).toBe(201)
    await vi.waitFor(() => expect(subject.store.read(snapshot.id).snapshot.status).toBe('waiting_browser'))
    const task = subject.store.read(snapshot.id)
    expect(task.authoring!.state.draftRevision).toBe(1)
    expect(task.toolAttempts).toBe(2); expect(task.completedRequests).toBe(2)
    expect(task.snapshot.usage).toMatchObject({ requests: 2, inputTokens: 20, outputTokens: 16, unknown: false })
    expect(task.snapshot.authoring).toMatchObject({ closeout: { reason: 'tool_budget', reviewable: true, requestOutcome: 'finished' } })
    expect(task.snapshot.tools).toHaveLength(1)
    assertPersistedAuthoringV4(task)
  })
  it('preserves a legal draft on an in-flight timeout with unknown billing and never sends a retry', async () => {
    vi.useFakeTimers()
    const start = source(), id = start.scope.targetIds[0]
    let round = 0
    const provider: ProviderAdapter = { complete: vi.fn(async (input: ProviderInput) => {
      if (++round === 1) return completion([call('sceneweave_edit_props', { operations: [{ kind: 'opacity', id, value: .6 }] })])
      return new Promise<ProviderCompletion>((_resolve, reject) => input.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true }))
    }) }
    const subject = setup(provider), response = await subject.create(start), snapshot = await response.json() as any
    await vi.waitFor(() => expect(provider.complete).toHaveBeenCalledTimes(2))
    await vi.advanceTimersByTimeAsync(300000)
    const task = subject.store.read(snapshot.id)
    expect(task.snapshot.status).toBe('waiting_browser')
    expect(task.snapshot.authoring).toMatchObject({ closeout: { reason: 'time', reviewable: true, requestOutcome: 'unknown' } })
    expect(task.snapshot.error).toMatchObject({ requestState: 'unknown', retryable: false })
    expect(task.snapshot.executionCheckpoint).toMatchObject({ uncertain: true, modelRequests: 2, completedRequests: 1 })
    expect(task.authoring!.state.draftRevision).toBe(1)
    await vi.advanceTimersByTimeAsync(300000)
    expect(provider.complete).toHaveBeenCalledTimes(2)
  })
  it('rejects corrupt persisted state before accepting a client valid:true or issuing a lease', async () => {
    const start = source(), id = start.scope.targetIds[0]
    let round = 0
    const subject = setup({ complete: async () => ++round === 1 ? completion([call('sceneweave_edit_props', { operations: [{ kind: 'opacity', id, value: .6 }] })]) : completion() })
    const response = await subject.create(start), snapshot = await response.json() as any
    await vi.waitFor(() => expect(subject.store.read(snapshot.id).snapshot.status).toBe('waiting_browser'))
    const task = subject.store.read(snapshot.id), stamp = authoringDraftStamp(task.authoring!.state, task.snapshot.generation)
    const path = join(subject.directory, 'tasks.sqlite')
    // Release the deliberate exclusive owner before emulating offline corruption.
    subject.shutdown()
    const db = new DatabaseSync(path), row = db.prepare('SELECT data FROM tasks WHERE id=?').get(snapshot.id) as { data: string }
    const corrupt = JSON.parse(row.data); corrupt.authoring.state.steps[0].operations[0].value = .7
    db.prepare('UPDATE tasks SET data=? WHERE id=?').run(JSON.stringify(corrupt), snapshot.id); db.close()
    const reopened = new TaskStore(subject.directory)
    try { expect(() => reopened.read(snapshot.id)).toThrow('invalid_authoring_checkpoint') }
    finally { reopened.close() }
    expect(stamp.contentHash).toBe(task.authoring!.state.contentHash)
  })
})

describe('authoring4 generated baseline is not an AI permission grant', () => {
  it('keeps unselected G entities out of read, plan evidence and diagnosis while retaining the complete G ledger', () => {
    const task = generatedTaskWithNarrowScope(), authoring = task.authoring!
    const unselected = Object.keys(authoring.start.project.document.terrainAreas)[0]
    expect(authoring.state.changedIds).toContain(unselected)
    const before = canonicalJson(authoring.state)
    const read = tool(task, 'sceneweave_read_scene', { section: 'scene', ids: [unselected] })
    expect(read.result.success).toBe(false); expect(read.result.output).not.toContain(unselected)
    const plan = tool(task, 'sceneweave_plan_draft', { phase: 'review', requirements: [{ index: 0, state: 'claimed', evidenceIds: [unselected] }] })
    expect(plan.result.success).toBe(false); expect(plan.result.output).not.toContain(unselected)
    const diagnosis = tool(task, 'sceneweave_diagnose_draft', {})
    expect(diagnosis.result.success).toBe(true)
    expect(diagnosis.output.counts).toMatchObject({ terrain: 0, props: 1, paths: 0, boundaries: 0, edgeLooks: 0 })
    expect(diagnosis.result.output).not.toContain(unselected)
    expect(canonicalJson(authoring.state)).toBe(before)
  })
  it('admits actual AI-created visual evidence but rejects an unselected G target in PNG review', () => {
    const task = generatedTaskWithNarrowScope(), authoring = task.authoring!, unselected = Object.keys(authoring.start.project.document.terrainAreas)[0]
    const generationCost = 'budget' in authoring.state ? authoring.state.budget.generationCost : 0
    const lightId = 'new-ai-light'
    const edited = tool(task, 'sceneweave_edit_scene', { operations: [{ kind: 'visualLight', id: lightId, positionMm: { x: 6000, y: 6000 }, radiusMm: 1000,
      color: '#FFD080', intensity: .5, wallOcclusion: true, enabled: true }] })
    expect(edited.result.success).toBe(true)
    expect(tool(task, 'sceneweave_plan_draft', { phase: 'review', requirements: [{ index: 0, state: 'claimed', evidenceIds: [lightId] }] }).result.success).toBe(true)
    expect(authoring.state.changedIds).toContain(unselected); expect(authoring.state.changedIds).toContain(lightId)
    expect('budget' in authoring.state && authoring.state.budget.generationCost).toBe(generationCost)
    task.messages.push({ role: 'user', content: 'explicit metadata PNG fixture', images: [createPublicVisionInput(svgFixturePng(), {
      sceneId: authoring.start.project.document.sceneId, revision: authoring.start.project.document.revision, boundsMm: authoring.start.scope.visual!.boundsMm,
      draft: { draftRevision: authoring.state.draftRevision, contentHash: authoring.state.contentHash } })] })
    const reviewed = tool(task, 'sceneweave_visual_review', { screenshotRef: publicScreenshotReference(task),
      issues: [{ observation: '未经选择的生成地形', uncertainty: '无权把生成结果当作任务新增授权', target: { kind: 'entities', ids: [unselected] } }],
      candidateOperations: [{ kind: 'opacity', id: authoring.start.scope.targetIds[0], value: .5 }] })
    expect(reviewed.result.success).toBe(false)
    expect(reviewed.output.error.code).toBe('outside_scope'); expect(reviewed.result.output).not.toContain(unselected)
  })
})
