import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import native from '../../src/platform/browser/content/scenes-data.json'
import { createCompositionContent } from '../../src/shared/appearance/graph.js'
import { applyCompositionCommands } from '../../src/shared/appearance/commands.js'
import type { ProjectData } from '../../src/shared/model/project.js'
import type { SceneDocument } from '../../src/shared/model/scene.js'
import { validateProjectData } from '../../src/shared/project/validate.js'
import { sha256Text } from '../../src/shared/validation/hash.js'
import { cloneJson } from '../../src/shared/validation/json.js'
import { authoringProjectHash, replayAuthoring } from '../../src/shared/ai/authoring.js'
import * as authoringCore from '../../src/shared/ai/authoring.js'
import type { AuthoringDraft, AuthoringStart, DraftClaim } from '../../src/shared/ai/authoring-protocol.js'
import type { TaskSnapshot } from '../../src/shared/ai/protocol.js'
import { createAiApp, connectionInfo } from './app.js'
import { loadAiConfig } from './config.js'
import { TaskFault, TaskStore } from './store.js'
import { TaskEngine } from './engine.js'
import { executeAuthoringTool } from './authoring-tools.js'
import type { ProviderAdapter, ProviderCompletion, ProviderInput, ProviderToolCall } from './provider-types.js'

const stamp = '2026-10-24T00:00:00.000Z', token = 'a'.repeat(40), tokenB = 'b'.repeat(40)
const cleanups: (() => void)[] = []
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup() })
function start(): AuthoringStart {
  const document = cloneJson(native.scenes.blank.document) as unknown as SceneDocument
  document.title = 'PRIVATE_GM_PROJECT_TITLE'
  document.assets = {}; document.propDefinitions = {}; document.materials = {}; document.prefabDefinitions = {}; document.styleThemes = {}; document.activeStyleThemeRef = null
  document.propDefinitions.definition = { id: 'definition', catalogId: 'test.authoring', version: 1, licenseRef: 'MIT', origin: { kind: 'original', attribution: 'Sceneweave test symbols', canEmbed: true },
    name: 'public table', tags: ['table'], defaultAppearance: { kind: 'symbol', symbol: 'table', tint: null, opacity: 1 },
    defaultVisualBoundsMm: { x: -200, y: -100, width: 400, height: 200 }, defaultFootprintMm: { width: 300, height: 100 }, defaultFootprintOffsetMm: { x: 0, y: 0 },
    defaultBlocksMovement: false, defaultBlocksSight: false, defaultRenderLayer: 'object', defaultShadowClass: 'none' }
  let sequence = 0
  const context = { ids: { nextId: () => `fixture-${++sequence}` }, clock: { now: () => stamp } }
  const content = applyCompositionCommands(createCompositionContent(document, context), [{ type: 'addProp', id: 'target', floorId: 'blank-floor', layerId: 'layer-default-0', definitionRef: { id: 'definition', version: 1 }, positionMm: { x: 4000, y: 4000 }, supportRef: { kind: 'floor', id: 'blank-floor' } },
    { type: 'addProp', id: 'SECRET_GM_PROP', floorId: 'blank-floor', layerId: 'layer-default-0', definitionRef: { id: 'definition', version: 1 }, positionMm: { x: 12000, y: 12000 }, supportRef: { kind: 'floor', id: 'blank-floor' } }], context)
  content.document.props.SECRET_GM_PROP.visibility = 'gm'
  const text = 'PRIVATE_LICENSE_TEXT_MUST_NOT_ENTER_MODEL', hash = sha256Text(text)
  const project: ProjectData = validateProjectData({ ...content, format: 'sceneweave-complete-project', schemaVersion: 1, assets: {}, licenses: { [hash]: { sha256: hash, text } },
    licenseBindings: [{ subjectKind: 'propDefinition', subjectId: 'definition', licenseRef: 'MIT', licensePath: `licenses/${hash}.txt`, embedding: 'allowed' }], authoringSources: {} })
  return { schemaVersion: 1, project, baseContentHash: authoringProjectHash(project), seed: randomUUID(), preparedAt: stamp,
    skill: { id: 'sceneweave-prop-authoring', version: 1 }, disclosure: 'complete-metadata/public-model',
    scope: { targetIds: ['target'], operations: ['place', 'transform', 'opacity'], placement: { floorId: 'blank-floor', layerId: 'layer-default-0', supportRef: { kind: 'floor', id: 'blank-floor' },
      boundsMm: { x: 1000, y: 1000, width: 8000, height: 8000 }, definitionIds: ['definition'] } } }
}
const done = (calls: ProviderToolCall[] = []): ProviderCompletion => ({ text: '', toolCalls: calls, finishReason: calls.length ? 'tool_calls' : 'stop', usage: { inputTokens: 10, outputTokens: 8 }, requestId: 'test' })
const call = (id: string, name: string, args: unknown): ProviderToolCall => ({ id, name, arguments: JSON.stringify(args) })
const edit = (id = 'edit') => call(id, 'sceneweave_edit_props', { operations: [{ kind: 'opacity', id: 'target', value: .5 }] })
function setup(provider: ProviderAdapter, now = { value: 1000 }) {
  const directory = mkdtempSync(join(tmpdir(), 'sceneweave-authoring-'))
  const config = loadAiConfig({ SCENEWEAVE_AI_DATA_DIR: directory, SCENEWEAVE_AI_ALLOWED_ORIGINS: 'https://editor.example.test', SCENEWEAVE_AI_ACCESS_TOKENS: JSON.stringify({ alice: token, bob: tokenB }),
    SCENEWEAVE_AI_PROVIDER_BASE_URL: 'http://127.0.0.1:9999/v1', SCENEWEAVE_AI_PROVIDER_API_KEY: 'private', SCENEWEAVE_AI_PROVIDER_MODEL: 'test' })
  const store = new TaskStore(directory, { now: () => now.value }), engine = new TaskEngine(store, provider, connectionInfo(config), { now: () => now.value })
  const app = createAiApp(config, { engine, store })
  let closed = false
  const shutdown = () => { if (!closed) { closed = true; engine.close(); store.close() } }
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }), shutdown)
  const request = (path: string, method = 'GET', body?: unknown, other = false) => app.request(path, { method, headers: { Authorization: `Bearer ${other ? tokenB : token}`, Origin: 'https://editor.example.test', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  const create = (authoring = start(), overrides: Record<string, unknown> = {}) => request('/v1/tasks', 'POST', { schemaVersion: 1, clientRequestId: randomUUID(), prompt: 'Please adjust this explicit draft only.', context: { sceneId: authoring.project.document.sceneId, revision: authoring.project.document.revision, audience: 'public' }, authoring, ...overrides })
  return { store, engine, request, create, now, directory, shutdown }
}
async function wait(store: TaskStore, id: string, status = 'waiting_browser') {
  await vi.waitFor(() => expect(store.read(id).snapshot.status).toBe(status), { timeout: 5000, interval: 10 })
  return store.read(id).snapshot
}
function editProvider() { let calls = 0; return { complete: async () => ++calls === 1 ? done([edit()]) : done() } }
async function ready(subject: ReturnType<typeof setup>) {
  const snapshot = await (await subject.create()).json() as TaskSnapshot
  const waiting = await wait(subject.store, snapshot.id)
  const stamp = { expectedGeneration: waiting.generation, draftRevision: waiting.authoring!.draftRevision, contentHash: waiting.authoring!.contentHash }
  expect((await subject.request(`/v1/tasks/${snapshot.id}/draft/validate`, 'POST', { ...stamp, valid: true })).status).toBe(200)
  return { id: snapshot.id, stamp }
}

describe('isolated AI prop authoring backend', () => {
  it('requires full valid metadata, exact base/context and disclosure before any provider call', async () => {
    const complete = vi.fn(async () => done()), subject = setup({ complete })
    const source = start()
    for (const bad of [{ ...source, baseContentHash: 'a'.repeat(64) }, { ...source, disclosure: 'public-only' }, { ...source, scope: { ...source.scope, targetIds: ['SECRET_GM_PROP'] } }]) expect((await subject.create(bad as AuthoringStart)).status).toBe(400)
    expect((await subject.create(source, { context: null })).status).toBe(400)
    expect((await subject.create(source, { context: { sceneId: source.project.document.sceneId, revision: 99, audience: 'public' } })).status).toBe(400)
    expect(complete).not.toHaveBeenCalled()
    expect(subject.store.count()).toBe(0)
  })
  it('keeps private project data off provider messages and persists successful/failed tool steps with the whole round', async () => {
    const observed: string[] = [], complete = vi.fn(async (input: ProviderInput) => {
      observed.push(JSON.stringify(input.messages))
      if (complete.mock.calls.length === 1) return done([call('read', 'sceneweave_read_scene', { section: 'targets' }), call('find', 'sceneweave_find_assets', { query: 'table', limit: 5 }),
        call('bad', 'sceneweave_edit_props', { operations: [{ kind: 'opacity', id: 'SECRET_GM_PROP', value: .2 }] }), edit()])
      expect(input.messages.filter(message => message.role === 'tool')).toHaveLength(4)
      return done([call('check', 'sceneweave_check_draft', {})])
    })
    // Stop the third round, so all five receipts can be checked without hitting request limit.
    const provider = { complete: async (input: ProviderInput) => complete.mock.calls.length < 2 ? complete(input) : done() }
    const subject = setup(provider), snapshot = await (await subject.create()).json() as TaskSnapshot
    const waiting = await wait(subject.store, snapshot.id)
    expect(waiting.authoring).toMatchObject({ draftRevision: 1, operationCost: 1, changedIds: ['target'] })
    expect(waiting.tools.map(tool => tool.success)).toEqual([true, true, false, true, true])
    for (const forbidden of ['PRIVATE_GM_PROJECT_TITLE', 'PRIVATE_LICENSE_TEXT', 'SECRET_GM_PROP', 'historyIdentity', 'licenseBindings']) expect(observed[0]).not.toContain(forbidden)
    // The provider itself supplied a private guessed ID; the server feedback never echoes it.
    expect(waiting.tools[2].output).not.toContain('SECRET_GM_PROP')
    const stored = subject.store.read(snapshot.id), draft = await (await subject.request(`/v1/tasks/${snapshot.id}/draft`)).json() as AuthoringDraft
    expect(replayAuthoring(draft.start, draft.state.steps).project.document.props.target.appearance.opacity).toBe(.5)
    expect(stored.authoring!.start.project.document.props.target.appearance.opacity).toBe(1)
    const events = subject.store.events(snapshot.id, 0)
    expect(events.filter(event => event.type === 'draft_updated')).toHaveLength(1)
    expect(events.map(event => event.sequence)).toEqual(events.map((_, i) => i + 1))
    expect((await subject.request(`/v1/tasks/${snapshot.id}/draft`, 'GET', undefined, true)).status).toBe(404)
  })
  it('requires matching browser validation before claim; claims and applied receipts are idempotent', async () => {
    const subject = setup(editProvider()), snapshot = await (await subject.create()).json() as TaskSnapshot
    const waiting = await wait(subject.store, snapshot.id), base = { expectedGeneration: 1, draftRevision: 1, contentHash: waiting.authoring!.contentHash }
    const claim: DraftClaim = { ...base, claimId: randomUUID() }, path = `/v1/tasks/${snapshot.id}/draft`
    expect((await subject.request(`${path}/claim`, 'POST', claim)).status).toBe(409)
    expect((await subject.request(`${path}/validate`, 'POST', { ...base, expectedGeneration: 2, valid: true })).status).toBe(409)
    expect((await subject.request(`${path}/validate`, 'POST', { ...base, contentHash: 'a'.repeat(64), valid: true })).status).toBe(409)
    expect((await subject.request(`${path}/validate`, 'POST', { ...base, valid: true })).status).toBe(200)
    const lease = await (await subject.request(`${path}/claim`, 'POST', claim)).json()
    expect(lease).toMatchObject({ claimId: claim.claimId, serverNow: 1000, expiresAt: 31000 })
    expect(await (await subject.request(`${path}/claim`, 'POST', claim)).json()).toEqual(lease)
    expect((await subject.request(`${path}/claim`, 'POST', { ...claim, claimId: randomUUID() })).status).toBe(409)
    for (const action of ['pause', 'cancel']) expect((await subject.request(`/v1/tasks/${snapshot.id}/control`, 'POST', { schemaVersion: 1, expectedGeneration: 1, action })).status).toBe(409)
    expect((await subject.request(`/v1/tasks/${snapshot.id}`, 'DELETE')).status).toBe(409)
    const document = subject.store.read(snapshot.id).authoring!.start.project.document
    const applied = { ...claim, sceneId: document.sceneId, revision: document.revision + 1 }
    expect((await subject.request(`${path}/applied`, 'POST', { ...applied, revision: document.revision + 2 })).status).toBe(409)
    expect(await (await subject.request(`${path}/applied`, 'POST', applied)).json()).toMatchObject({ status: 'applied' })
    expect(await (await subject.request(`${path}/applied`, 'POST', applied)).json()).toMatchObject({ status: 'applied' })
    expect((await subject.request(`${path}/release`, 'POST', claim)).status).toBe(409)
    expect(subject.store.read(snapshot.id).authoring!.start.project.document.revision).toBe(document.revision)
  })
  it('pauses an expired lease without granting another commit, permits only its matching late applied receipt', async () => {
    const subject = setup(editProvider()), { id, stamp } = await ready(subject), path = `/v1/tasks/${id}/draft`, claim = { ...stamp, claimId: randomUUID() }
    await subject.request(`${path}/claim`, 'POST', claim)
    subject.now.value += 30001
    expect(await (await subject.request(`/v1/tasks/${id}`)).json()).toMatchObject({ status: 'paused', generation: stamp.expectedGeneration })
    expect((await subject.request(`${path}/claim`, 'POST', claim)).status).toBe(409)
    expect((await subject.request(`${path}/validate`, 'POST', { ...stamp, valid: true })).status).toBe(409)
    expect((await subject.request(`/v1/tasks/${id}/control`, 'POST', { schemaVersion: 1, action: 'resume', expectedGeneration: 1 })).status).toBe(409)
    const doc = subject.store.read(id).authoring!.start.project.document
    expect(await (await subject.request(`${path}/applied`, 'POST', { ...claim, sceneId: doc.sceneId, revision: doc.revision + 1 })).json()).toMatchObject({ status: 'applied' })
  })
  it('releases an unsuccessful lease and keeps browser failure draft available for explicit continuation', async () => {
    const subject = setup(editProvider()), { id, stamp } = await ready(subject), path = `/v1/tasks/${id}/draft`, claim = { ...stamp, claimId: randomUUID() }
    await subject.request(`${path}/claim`, 'POST', claim)
    expect(await (await subject.request(`${path}/release`, 'POST', claim)).json()).toMatchObject({ status: 'ready', authoring: { claim: null } })
    expect((await subject.request(`${path}/applied`, 'POST', { ...claim, sceneId: 'wrong', revision: 1 })).status).toBe(409)
    await subject.request(`/v1/tasks/${id}/control`, 'POST', { schemaVersion: 1, action: 'pause', expectedGeneration: 1 })
    expect(subject.store.read(id).snapshot.generation).toBe(2)
    expect(subject.store.read(id).authoring!.state.draftRevision).toBe(1)
  })
  it('keeps a rejected browser draft paused and retains its ledger and private metadata', async () => {
    const subject = setup(editProvider()), created = await (await subject.create()).json() as TaskSnapshot
    const waiting = await wait(subject.store, created.id), stamp = { expectedGeneration: 1, draftRevision: 1, contentHash: waiting.authoring!.contentHash }
    const rejected = await (await subject.request(`/v1/tasks/${created.id}/draft/validate`, 'POST', { ...stamp, valid: false })).json() as TaskSnapshot
    expect(rejected).toMatchObject({ status: 'paused', error: { code: 'browser_validation_failed' } })
    expect(subject.store.read(created.id).authoring!.state.steps).toHaveLength(1)
    expect((await subject.request(`/v1/tasks/${created.id}/draft/claim`, 'POST', { ...stamp, claimId: randomUUID() })).status).toBe(409)
    expect((await subject.create()).status).toBe(409)
    const resumed = await (await subject.request(`/v1/tasks/${created.id}/control`, 'POST', { schemaVersion: 1, expectedGeneration: 1, action: 'resume', prompt: 'Keep the existing valid adjustment.' })).json() as TaskSnapshot
    expect(resumed.generation).toBe(2)
    await wait(subject.store, created.id)
    expect(subject.store.read(created.id).authoring!.state.draftRevision).toBe(1)
  })
  it('ends a paused generation at its last valid draft for review without another provider request', async () => {
    const complete = vi.fn(async () => complete.mock.calls.length === 1 ? done([edit()]) : new Promise<ProviderCompletion>(() => {}))
    const subject = setup({ complete }), snapshot = await (await subject.create()).json() as TaskSnapshot
    await vi.waitFor(() => { expect(complete).toHaveBeenCalledTimes(2); expect(subject.store.read(snapshot.id).authoring!.state.draftRevision).toBe(1) })
    const paused = subject.engine.control('alice', snapshot.id, { schemaVersion: 1, expectedGeneration: 1, action: 'pause' })
    const before = subject.store.read(snapshot.id), stamp = { expectedGeneration: paused.generation, draftRevision: before.authoring!.state.draftRevision, contentHash: before.authoring!.state.contentHash }
    const ready = await (await subject.request(`/v1/tasks/${snapshot.id}/draft/validate`, 'POST', { ...stamp, valid: true })).json() as TaskSnapshot
    expect(ready).toMatchObject({ status: 'ready', generation: paused.generation, error: null })
    expect(complete).toHaveBeenCalledTimes(2)
    const after = subject.store.read(snapshot.id)
    expect(after.authoring!.state).toEqual(before.authoring!.state)
    expect(after.snapshot.usage.requests).toBe(before.snapshot.usage.requests)
    expect(after.runStartedAt).toBeNull()
  })
  it('does not duplicate successful draft call IDs, and cannot change an existing call identity', async () => {
    let rounds = 0
    const subject = setup({ complete: async () => ++rounds < 3 ? done([edit('same')]) : done([call('same', 'sceneweave_edit_props', { operations: [{ kind: 'opacity', id: 'target', value: .3 }] })]) })
    const snapshot = await (await subject.create()).json() as TaskSnapshot
    const failed = await wait(subject.store, snapshot.id, 'failed')
    expect(failed.error?.code).toBe('provider_protocol')
    expect(failed.tools).toHaveLength(1)
    expect(subject.store.read(snapshot.id).authoring!.state.steps).toHaveLength(1)
    expect(subject.store.read(snapshot.id).authoring!.state.operationCost).toBe(1)
  })
  it('bounds large verified-step receipts to this step and sends only dependency counts to the model', async () => {
    // This boundary check supplies the result of the separately tested pure validator.
    // It makes no claim that a synthetic 128-prop scene was validated here.
    const subject = setup({ complete: () => new Promise<ProviderCompletion>(() => {}) })
    const snapshot = await (await subject.create()).json() as TaskSnapshot, task = subject.store.read(snapshot.id)
    const changedIds = Array.from({ length: 128 }, (_, index) => `ai-${index.toString().padStart(64, '0')}`)
    task.authoring!.state = { ...task.authoring!.state, changedIds: changedIds.slice(0, 112), operationCost: 112, draftRevision: 7 }
    const resultState = { ...task.authoring!.state, changedIds, operationCost: 128, draftRevision: 8 }
    const apply = vi.spyOn(authoringCore, 'applyAuthoringStep').mockReturnValue({ project: task.authoring!.start.project, state: resultState })
    const check = vi.spyOn(authoringCore, 'checkAuthoringDraft').mockReturnValue({ valid: true, operationCost: 128, changedIds,
      readIds: ['PRIVATE_ROOT_ID', ...Array.from({ length: 4095 }, (_, index) => `dependency-${index}`)], writeIds: changedIds })
    try {
      const operations = Array.from({ length: 16 }, () => ({ kind: 'place', definitionId: 'definition', positionMm: { x: 6000, y: 6000 } }))
      const edited = executeAuthoringTool(task, call('edit', 'sceneweave_edit_props', { operations }), { operations })
      expect(edited.success).toBe(true); expect(Buffer.byteLength(edited.output)).toBeLessThanOrEqual(8192)
      const receipt = JSON.parse(edited.output)
      expect(receipt).toMatchObject({ changedCount: 128, remainingOperations: 128 })
      expect(receipt.affectedIds).toHaveLength(16); expect(receipt.changedIds).toBeUndefined()
      const checked = executeAuthoringTool(task, call('check', 'sceneweave_check_draft', {}), {})
      expect(checked.success).toBe(true); expect(Buffer.byteLength(checked.output)).toBeLessThanOrEqual(8192)
      expect(JSON.parse(checked.output)).toEqual({ valid: true, operationCost: 128, changedCount: 128, readDependencyCount: 4096, writeDependencyCount: 128 })
      expect(checked.output).not.toContain('PRIVATE_ROOT_ID')
    } finally { apply.mockRestore(); check.mockRestore() }
  })
  it('enforces 64 cumulative authoring tool attempts, with a complete final round rollback', async () => {
    let rounds = 0
    const subject = setup({ complete: async () => { rounds++; return done(Array.from({ length: 8 }, (_, index) => call(`round-${rounds}-${index}`, 'sceneweave_check_draft', {}))) } })
    const snapshot = await (await subject.create()).json() as TaskSnapshot
    const failed = await wait(subject.store, snapshot.id, 'failed')
    expect(failed.error?.code).toBe('tool_limit'); expect(failed.tools).toHaveLength(64); expect(rounds).toBe(9)
    expect(subject.store.read(snapshot.id).messages.filter(message => message.role === 'tool')).toHaveLength(64)
  })
  it('does not spend execution time waiting for the browser and enforces authoring round/tool budgets independently of M2-1', async () => {
    const subject = setup(editProvider()), snapshot = await (await subject.create()).json() as TaskSnapshot
    await wait(subject.store, snapshot.id)
    const before = subject.store.remaining(subject.store.read(snapshot.id)); subject.now.value += 600000
    expect(subject.store.remaining(subject.store.read(snapshot.id))).toBe(before)
    expect(before).toBe(300000)
    const complete = vi.fn(async () => done([call(`call-${complete.mock.calls.length}`, 'sceneweave_check_draft', {})]))
    const budget = setup({ complete }), created = await (await budget.create()).json() as TaskSnapshot
    const failed = await wait(budget.store, created.id, 'failed')
    expect(complete).toHaveBeenCalledTimes(16); expect(failed.error?.code).toBe('request_limit'); expect(failed.tools).toHaveLength(16)
  })
  it('rolls back the complete draft round if a later invalid provider call prevents its checkpoint', async () => {
    const subject = setup({ complete: async () => done([edit(), call('invalid id', 'sceneweave_check_draft', {})]) })
    const snapshot = await (await subject.create()).json() as TaskSnapshot
    await wait(subject.store, snapshot.id, 'failed')
    const task = subject.store.read(snapshot.id)
    expect(task.authoring!.state.steps).toHaveLength(0); expect(task.snapshot.tools).toHaveLength(0)
    expect(task.messages.filter(message => message.role === 'tool' || message.toolCalls)).toHaveLength(0)
    expect(subject.store.events(snapshot.id, 0).filter(event => event.type === 'draft_updated')).toHaveLength(0)
  })
  it('keeps the previous draft and emits no draft event if its whole-round checkpoint cannot fit storage', async () => {
    let resolve!: (value: ProviderCompletion) => void
    const subject = setup({ complete: async () => new Promise<ProviderCompletion>(done => { resolve = done }) })
    const snapshot = await (await subject.create()).json() as TaskSnapshot
    await vi.waitFor(() => expect(resolve).toBeDefined())
    const change = subject.store.change.bind(subject.store)
    vi.spyOn(subject.store, 'change').mockImplementation((id, generation, mutate, skipExpiry) => change(id, generation, task => {
      const events = mutate(task)
      if (task.authoring!.state.draftRevision) throw new TaskFault('storage_limit', 503)
      return events
    }, skipExpiry))
    resolve(done([edit()]))
    const failed = await wait(subject.store, snapshot.id, 'failed')
    expect(failed.error?.code).toBe('storage_limit')
    expect(failed.tools).toHaveLength(0)
    expect(subject.store.read(snapshot.id).authoring!.state.steps).toHaveLength(0)
    expect(subject.store.events(snapshot.id, 0).filter(event => event.type === 'draft_updated')).toHaveLength(0)
  })
  it('restart preserves a pending claim and requires explicit resolution without automatically running model requests', async () => {
    const subject = setup(editProvider()), { id, stamp } = await ready(subject), claim = { ...stamp, claimId: randomUUID() }
    await subject.request(`/v1/tasks/${id}/draft/claim`, 'POST', claim)
    subject.shutdown()
    const reopened = new TaskStore(subject.directory, { now: () => subject.now.value })
    cleanups.push(() => reopened.close())
    expect(reopened.read(id).snapshot).toMatchObject({ status: 'paused', generation: stamp.expectedGeneration, authoring: { claim: { claimId: claim.claimId } } })
    expect(reopened.read(id).authoring!.state.steps).toHaveLength(1)
  })
})
