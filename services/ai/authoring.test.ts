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
import { AUTHORING_LIMITS, type AuthoringDraft, type AuthoringStart, type DraftClaim } from '../../src/shared/ai/authoring-protocol.js'
import { AI_LIMITS, utf8Size, type TaskSnapshot } from '../../src/shared/ai/protocol.js'
import { createAiApp, connectionInfo } from './app.js'
import { loadAiConfig } from './config.js'
import { TaskFault, TaskStore } from './store.js'
import { TaskEngine, type TaskEngineOptions } from './engine.js'
import { executeAuthoringTool } from './authoring-tools.js'
import { emptyVisualSystem } from '../../src/shared/visual/types.js'
import { PROVIDER_REASONING_BYTES, type ProviderAdapter, type ProviderCompletion, type ProviderInput, type ProviderToolCall } from './provider-types.js'

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
function connectionSource(hidden: 'none' | 'ungranted' | 'private' = 'none'): AuthoringStart {
  const source = start(), boundsMm = { x: 5000, y: 500, width: 14000, height: 10000 }
  source.project.schemaVersion = 2; source.project.document.schemaVersion = 2; source.project.document.visual = emptyVisualSystem()
  let sequence = 0
  const context = { ids: { nextId: () => `connection-fixture-${++sequence}` }, clock: { now: () => stamp } }
  Object.assign(source.project, applyCompositionCommands({ document: source.project.document, historyIdentity: source.project.historyIdentity, appearance: source.project.appearance }, [
    { type: 'createTerrainArea', id: 'low-land', floorId: 'blank-floor', layerId: 'layer-default-0', boundaryMm: [{ x: 6000, y: 1000 }, { x: 18000, y: 1000 }, { x: 18000, y: 10000 }, { x: 6000, y: 10000 }], groundElevationMm: 800, coveragePriority: 10 },
    { type: 'createTerrainArea', id: 'high-land', floorId: 'blank-floor', layerId: 'layer-default-0', boundaryMm: [{ x: 9000, y: 3000 }, { x: 15000, y: 3000 }, { x: 15000, y: 8000 }, { x: 9000, y: 8000 }], groundElevationMm: 2600, coveragePriority: 20 },
    { type: 'createTerrainConnection', id: 'land-stairs', floorId: 'blank-floor', layerId: 'layer-default-0', kind: 'stairs',
      from: { surfaceRef: { kind: 'terrainArea', id: 'high-land' }, positionMm: { x: 12000, y: 3200 } },
      to: { surfaceRef: { kind: 'terrainArea', id: 'low-land' }, positionMm: { x: 12000, y: 2800 } }, widthMm: 1200, openingId: null },
  ], context))
  if (hidden === 'private') source.project.document.terrainConnections['land-stairs'].visibility = 'gm'
  source.project = validateProjectData(source.project)
  source.skill = { id: 'sceneweave-scene-authoring', version: 1 }
  const entityIds = ['low-land', 'high-land', ...(hidden === 'none' ? ['land-stairs'] : [])]
  source.scope.scene = { floorId: 'blank-floor', layerId: 'layer-default-0', boundsMm, entityIds, definitionIds: [], prefabDefinitionIds: [], materialIds: [], operations: ['terrain', 'connection'] }
  source.scope.visual = { floorId: 'blank-floor', layerId: 'layer-default-0', boundsMm, entityIds, definitionIds: [], materialIds: [], operations: ['visualBoundary'] }
  source.baseContentHash = authoringProjectHash(source.project)
  return source
}
const done = (calls: ProviderToolCall[] = []): ProviderCompletion => ({ text: '', toolCalls: calls, finishReason: calls.length ? 'tool_calls' : 'stop', usage: { inputTokens: 10, outputTokens: 8 }, requestId: 'test' })
const call = (id: string, name: string, args: unknown): ProviderToolCall => ({ id, name, arguments: JSON.stringify(args) })
const edit = (id = 'edit') => call(id, 'sceneweave_edit_props', { operations: [{ kind: 'opacity', id: 'target', value: .5 }] })
function setup(provider: ProviderAdapter, now = { value: 1000 }, limits?: Partial<ReturnType<TaskStore['limits']>>, engineOptions: TaskEngineOptions = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'sceneweave-authoring-'))
  const config = loadAiConfig({ SCENEWEAVE_AI_DATA_DIR: directory, SCENEWEAVE_AI_ALLOWED_ORIGINS: 'https://editor.example.test', SCENEWEAVE_AI_ACCESS_TOKENS: JSON.stringify({ alice: token, bob: tokenB }),
    SCENEWEAVE_AI_PROVIDER_BASE_URL: 'http://127.0.0.1:9999/v1', SCENEWEAVE_AI_PROVIDER_API_KEY: 'private', SCENEWEAVE_AI_PROVIDER_MODEL: 'test' })
  const options: TaskEngineOptions = { now: () => now.value, ...engineOptions }
  const store = new TaskStore(directory, { now: () => now.value }), engine = new TaskEngine(store, provider, connectionInfo(config), options)
  if (limits) {
    const defaults = store.limits.bind(store)
    vi.spyOn(store, 'limits').mockImplementation(task => ({ ...defaults(task), ...limits }))
  }
  const app = createAiApp(config, { engine, store })
  let closed = false
  const shutdown = () => { if (!closed) { closed = true; engine.close(); store.close() } }
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }), shutdown)
  const request = (path: string, method = 'GET', body?: unknown, other = false) => app.request(path, { method, headers: { Authorization: `Bearer ${other ? tokenB : token}`, Origin: 'https://editor.example.test', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  const create = (authoring = start(), overrides: Record<string, unknown> = {}) => request('/v1/tasks', 'POST', { schemaVersion: 1, clientRequestId: randomUUID(), prompt: 'Please adjust this explicit draft only.', context: { sceneId: authoring.project.document.sceneId, revision: authoring.project.document.revision, audience: 'public' }, authoring, ...overrides })
  return { store, engine, request, create, now, directory, shutdown, config, options }
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
  it('keeps ordinary conversation at 1024 tokens while capturing a server-selected 4096-token authoring budget for every round', async () => {
    const inputs: ProviderInput[] = []
    const subject = setup({ complete: async input => {
      inputs.push(input)
      return done(input.tools.some(tool => tool.name === 'sceneweave_edit_props') && !input.messages.some(message => message.role === 'tool')
        ? [call('invalid-edit', 'sceneweave_edit_props', { operations: [{ kind: 'opacity', id: 'ungranted', value: .5 }] }), edit()] : [])
    } }, { value: 1000 }, undefined, { authoringOutputTokens: 4096 })
    subject.options.authoringOutputTokens = 8192
    const plain = await (await subject.request('/v1/tasks', 'POST', { schemaVersion: 1, clientRequestId: randomUUID(), prompt: 'Check the connection.', context: null })).json() as TaskSnapshot
    await wait(subject.store, plain.id, 'completed')
    const source = start(); source.brief = { recipe: 'interior', requirements: ['Review and edit only the authorized target.'] }
    const created = await (await subject.create(source)).json() as TaskSnapshot
    await wait(subject.store, created.id)
    expect(inputs.map(input => input.maxOutputTokens)).toEqual([1024, 4096, 4096])
    expect((await (await subject.request('/v1/capabilities')).json()).authoringOutputTokens).toBe(4096)
    expect(subject.engine.connectionInfo.authoringOutputTokens).toBe(4096)
    const snapshot = subject.store.read(created.id).snapshot
    expect(snapshot.usage.requests).toBe(2)
    expect(snapshot.tools.map(tool => tool.success)).toEqual([false, true])
    expect(snapshot.tools.map(tool => JSON.parse(tool.output).maxOutputTokens)).toEqual([4096, 4096])
  })
  it('passes the configured authoring budget through the application factory and keeps its capability snapshot fixed', async () => {
    const source = setup({ complete: async () => done() }), inputs: ProviderInput[] = []
    source.engine.close()
    source.config.authoringOutputTokens = 4096
    source.config.provider.preserveReasoning = 'enabled'
    const app = createAiApp(source.config, { store: source.store, provider: { complete: async input => { inputs.push(input); return { ...done(), reasoningContent: 'PRIVATE_FACTORY_REASONING' } } } })
    source.config.authoringOutputTokens = 8192
    source.config.provider.preserveReasoning = 'disabled'
    const authoring = start(), headers = { Authorization: `Bearer ${token}`, Origin: 'https://editor.example.test', 'Content-Type': 'application/json' }
    const created = await (await app.request('/v1/tasks', { method: 'POST', headers, body: JSON.stringify({ schemaVersion: 1, clientRequestId: randomUUID(), prompt: 'Review the authorized draft.', context: { sceneId: authoring.project.document.sceneId, revision: authoring.project.document.revision, audience: 'public' }, authoring }) })).json() as TaskSnapshot
    await wait(source.store, created.id, 'completed')
    expect(inputs).toHaveLength(1); expect(inputs[0].maxOutputTokens).toBe(4096)
    expect((await (await app.request('/v1/capabilities', { headers })).json()).authoringOutputTokens).toBe(4096)
    expect(source.store.read(created.id).messages.find(message => message.role === 'assistant')?.reasoningContent).toBe('PRIVATE_FACTORY_REASONING')
  })
  it('uses the original 1024 authoring default and rejects invalid constructor budgets before any task starts', async () => {
    const complete = vi.fn<ProviderAdapter['complete']>(async () => done()), subject = setup({ complete })
    for (const authoringOutputTokens of [0, -1, NaN, Infinity, 1.5, AUTHORING_LIMITS.maxOutputTokensPerRequest + 1]) {
      expect(() => new TaskEngine(subject.store, { complete }, connectionInfo(subject.config), { authoringOutputTokens })).toThrow('Invalid server configuration: AUTHORING_OUTPUT_TOKENS')
    }
    expect(complete).not.toHaveBeenCalled()
    const created = await (await subject.create()).json() as TaskSnapshot
    await wait(subject.store, created.id, 'completed')
    expect(complete).toHaveBeenCalledOnce(); expect(complete.mock.calls[0][0].maxOutputTokens).toBe(1024)
  })
  it('keeps provider reasoning private while preserving it only for an explicitly enabled tool continuation', async () => {
    const privateReasoning = 'PRIVATE_REASONING\n\t{"do_not_execute":true}🌋', inputs: ProviderInput[] = [], completions: ProviderCompletion[] = []
    const subject = setup({ complete: async input => {
      inputs.push(input)
      const completion = inputs.length === 1 ? done([edit()]) : done()
      const withReasoning = { ...completion, reasoningContent: privateReasoning }
      completions.push(withReasoning)
      return withReasoning
    } }, { value: 1000 }, undefined, { preserveReasoning: 'enabled' })
    subject.options.preserveReasoning = 'disabled'
    const snapshot = await (await subject.create()).json() as TaskSnapshot
    await wait(subject.store, snapshot.id)
    const task = subject.store.read(snapshot.id), assistant = task.messages.find(message => message.role === 'assistant')
    expect(inputs).toHaveLength(2)
    expect(inputs[1].messages.find(message => message.role === 'assistant')?.reasoningContent).toBe(privateReasoning)
    expect(assistant?.reasoningContent).toBe(privateReasoning)
    expect(JSON.stringify(task.snapshot)).not.toContain('PRIVATE_REASONING')
    expect(JSON.stringify(subject.store.events(snapshot.id, 0))).not.toContain('PRIVATE_REASONING')
    expect(task.snapshot.text).not.toContain(privateReasoning)
    expect(JSON.stringify(task.snapshot.tools)).not.toContain('PRIVATE_REASONING')
    expect(JSON.stringify(await (await subject.request(`/v1/tasks/${snapshot.id}`)).json())).not.toContain('PRIVATE_REASONING')
    expect(JSON.stringify(task.snapshot)).not.toContain('reasoningContent')
    expect(completions).toHaveLength(2)
    const events = await subject.request(`/v1/tasks/${snapshot.id}/events?after=0`), wire = events.text()
    subject.shutdown()
    expect(await wire).not.toContain('PRIVATE_REASONING')
    const reopened = new TaskStore(subject.directory, { now: () => subject.now.value })
    cleanups.push(() => reopened.close())
    expect(reopened.read(snapshot.id).messages.filter(message => message.role === 'assistant').every(message => message.reasoningContent === privateReasoning)).toBe(true)
    expect(JSON.stringify(reopened.read(snapshot.id).snapshot)).not.toContain('PRIVATE_REASONING')
  })
  it('does not save or pass provider reasoning when preservation remains disabled', async () => {
    const privateReasoning = 'PRIVATE_REASONING_DISABLED', inputs: ProviderInput[] = []
    const subject = setup({ complete: async input => { inputs.push(input); return { ...done(), reasoningContent: privateReasoning } } })
    const snapshot = await (await subject.request('/v1/tasks', 'POST', { schemaVersion: 1, clientRequestId: randomUUID(), prompt: 'Check the connection.', context: null })).json() as TaskSnapshot
    await wait(subject.store, snapshot.id, 'completed')
    const task = subject.store.read(snapshot.id)
    expect(task.messages.some(message => message.reasoningContent)).toBe(false)
    expect(inputs[0].messages.some(message => message.reasoningContent)).toBe(false)
    expect(JSON.stringify(task.snapshot)).not.toContain(privateReasoning)
    expect(JSON.stringify(subject.store.events(snapshot.id, 0))).not.toContain(privateReasoning)
  })
  it('does not replay or keep saved private reasoning after restarting in default-disabled mode', async () => {
    const privateReasoning = 'PRIVATE_REASONING_BEFORE_RESTART', subject = setup({ complete: async () => ({ ...done(), reasoningContent: privateReasoning }) }, { value: 1000 }, undefined, { preserveReasoning: 'enabled' })
    const snapshot = await (await subject.request('/v1/tasks', 'POST', { schemaVersion: 1, clientRequestId: randomUUID(), prompt: 'Check the connection.', context: null })).json() as TaskSnapshot
    await wait(subject.store, snapshot.id, 'completed')
    subject.store.change(snapshot.id, snapshot.generation, task => { task.snapshot.status = 'paused'; return [] })
    subject.shutdown()
    const reopened = new TaskStore(subject.directory, { now: () => subject.now.value }), inputs: ProviderInput[] = []
    const engine = new TaskEngine(reopened, { complete: async input => { inputs.push(input); return { ...done(), reasoningContent: 'PRIVATE_NEW_DISABLED' } } }, connectionInfo(subject.config), { now: () => subject.now.value })
    cleanups.push(() => reopened.close(), () => engine.close())
    const current = reopened.read(snapshot.id)
    engine.control('alice', snapshot.id, { schemaVersion: 1, expectedGeneration: current.snapshot.generation, action: 'resume' })
    await wait(reopened, snapshot.id, 'completed')
    expect(inputs).toHaveLength(1)
    expect(inputs[0].messages.every(message => message.reasoningContent === undefined)).toBe(true)
    expect(reopened.read(snapshot.id).messages.every(message => message.reasoningContent === undefined)).toBe(true)
    expect(JSON.stringify(reopened.read(snapshot.id).snapshot)).not.toContain('PRIVATE_')
    expect(JSON.stringify(reopened.events(snapshot.id, 0))).not.toContain('PRIVATE_')
  })
  it('rejects malformed, oversized or invalidly configured private reasoning without leaking it to snapshots or events', async () => {
    for (const reasoningContent of [128 as unknown as string, '🌋'.repeat(PROVIDER_REASONING_BYTES / 4 + 1)]) {
      const subject = setup({ complete: async () => ({ ...done(), reasoningContent }) }, { value: 1000 }, undefined, { preserveReasoning: 'enabled' })
      const snapshot = await (await subject.create()).json() as TaskSnapshot, failed = await wait(subject.store, snapshot.id, 'failed')
      expect(failed.error?.code).toBe(typeof reasoningContent === 'string' ? 'provider_limit' : 'provider_protocol')
      expect(subject.store.read(snapshot.id).messages.some(message => message.reasoningContent !== undefined)).toBe(false)
      expect(JSON.stringify(failed)).not.toContain('reasoningContent')
      expect(JSON.stringify(subject.store.events(snapshot.id, 0))).not.toContain('reasoningContent')
    }
    const subject = setup({ complete: async () => done() })
    for (const preserveReasoning of ['', 'true', 128, null]) {
      expect(() => new TaskEngine(subject.store, { complete: async () => done() }, connectionInfo(subject.config), { preserveReasoning } as unknown as TaskEngineOptions)).toThrow('Invalid server configuration: PROVIDER_PRESERVE_REASONING')
    }
  })
  it('includes preserved reasoning in the existing total task storage budget and leaves the old checkpoint intact on overflow', async () => {
    let resolve!: (value: ProviderCompletion) => void
    const subject = setup({ complete: async () => new Promise<ProviderCompletion>(done => { resolve = done }) }, { value: 1000 }, undefined, { preserveReasoning: 'enabled' })
    const snapshot = await (await subject.request('/v1/tasks', 'POST', { schemaVersion: 1, clientRequestId: randomUUID(), prompt: 'Check the connection.', context: null })).json() as TaskSnapshot
    await vi.waitFor(() => expect(resolve).toBeDefined())
    subject.store.change(snapshot.id, snapshot.generation, task => {
      const remaining = AI_LIMITS.taskBytes - utf8Size(JSON.stringify(task)) - utf8Size(JSON.stringify(subject.store.events(snapshot.id, 0))) - 4096
      task.messages.push({ role: 'assistant', content: 'x'.repeat(remaining) })
      return []
    })
    resolve({ ...done(), reasoningContent: 'x'.repeat(PROVIDER_REASONING_BYTES) })
    const failed = await wait(subject.store, snapshot.id, 'failed')
    expect(failed.error?.code).toBe('task_storage_limit')
    expect(subject.store.read(snapshot.id).messages.every(message => message.reasoningContent === undefined)).toBe(true)
    expect(JSON.stringify(subject.store.events(snapshot.id, 0))).not.toContain('reasoningContent')
  }, 20000)
  it('reports only authorised connection codes for a rejected curve and can repair it by shrinking the bulge', async () => {
    const source = connectionSource(), subject = setup(editProvider()), snapshot = await (await subject.create(source)).json() as TaskSnapshot
    await wait(subject.store, snapshot.id)
    const task = subject.store.read(snapshot.id), before = cloneJson(task.authoring!.state)
    const query = { areaId: 'high-land', boundaryId: 'high-rim' }
    const refused = executeAuthoringTool(task, call('curve-proposal', 'sceneweave_propose_boundary', query), query)
    expect(refused.success).toBe(false)
    const receipt = JSON.parse(refused.output)
    expect(receipt.error).toMatchObject({ code: 'invalid_geometry', operationIndex: 0, hint: expect.stringContaining('Reduce smoothness') })
    expect(receipt.error.domainIssues).toContainEqual({ code: 'CONNECTION_ENDPOINT', entityId: 'land-stairs' })
    expect(receipt.error.domainIssues.every((issue: { code: string; entityId: string }) => ['CONNECTION_ENDPOINT', 'CONNECTION_CORRIDOR', 'CONNECTION_TRANSITIONS'].includes(issue.code) && issue.entityId === 'land-stairs')).toBe(true)
    expect(refused.output).not.toContain('sceneweave_probe_placement')
    expect(refused.output).not.toContain('PRIVATE_')
    expect(task.authoring!.state).toEqual(before)
    const repaired = { ...query, smoothness: .1 }
    const proposal = executeAuthoringTool(task, call('smaller-curve', 'sceneweave_propose_boundary', repaired), repaired)
    expect(proposal.success).toBe(true)
    expect(task.authoring!.state).toEqual(before)
    const edit = { operations: [JSON.parse(proposal.output).candidateOperation] }
    expect(executeAuthoringTool(task, call('adopt-smaller-curve', 'sceneweave_edit_scene', edit), edit).success).toBe(true)
    const replayed = replayAuthoring(task.authoring!.start, task.authoring!.state.steps)
    expect(replayed.project.document.terrainConnections['land-stairs']).toEqual(source.project.document.terrainConnections['land-stairs'])
  })
  it.each(['ungranted', 'private'] as const)('redacts %s connection identities when a curve proposal fails', async hidden => {
    const source = connectionSource(hidden), subject = setup(editProvider()), snapshot = await (await subject.create(source)).json() as TaskSnapshot
    await wait(subject.store, snapshot.id)
    const task = subject.store.read(snapshot.id), before = cloneJson(task.authoring!.state), query = { areaId: 'high-land', boundaryId: 'high-rim' }
    const refused = executeAuthoringTool(task, call('hidden-connection', 'sceneweave_propose_boundary', query), query)
    expect(refused.success).toBe(false)
    expect(JSON.parse(refused.output).error).not.toHaveProperty('domainIssues')
    expect(refused.output).not.toContain('sceneweave_probe_placement')
    for (const forbidden of ['land-stairs', 'CONNECTION_', 'PRIVATE_', 'SECRET_GM_PROP']) expect(refused.output).not.toContain(forbidden)
    expect(task.authoring!.state).toEqual(before)
  })
  it('previews a real authorised terrain curve through the full ledger without installing or spending the proposed step', async () => {
    const source = start(), boundsMm = { x: 11000, y: 1000, width: 8000, height: 8000 }
    source.project.schemaVersion = 2; source.project.document.schemaVersion = 2; source.project.document.visual = emptyVisualSystem()
    source.baseContentHash = authoringProjectHash(source.project)
    source.scope.scene = { floorId: 'blank-floor', layerId: 'layer-default-0', boundsMm,
      entityIds: [], definitionIds: [], prefabDefinitionIds: [], materialIds: [], operations: ['terrain'] }
    source.scope.visual = { floorId: 'blank-floor', layerId: 'layer-default-0', boundsMm,
      entityIds: [], definitionIds: [], materialIds: [], operations: ['visualBoundary'] }
    const subject = setup(editProvider()), snapshot = await (await subject.create(source)).json() as TaskSnapshot
    await wait(subject.store, snapshot.id)
    const task = subject.store.read(snapshot.id)
    const args = { operations: [{ kind: 'terrain', id: 'public-land', boundaryMm: [{ x: 12000, y: 5000 }, { x: 15000, y: 2000 }, { x: 18000, y: 5000 }, { x: 15000, y: 8000 }], groundElevationMm: 800 }] }
    expect(executeAuthoringTool(task, call('land', 'sceneweave_edit_scene', args), args).success).toBe(true)
    const before = cloneJson(task.authoring!.state), query = { areaId: 'public-land', boundaryId: 'land-rim' }
    const proposed = executeAuthoringTool(task, call('proposal', 'sceneweave_propose_boundary', query), query)
    expect(proposed.success).toBe(true)
    expect(Buffer.byteLength(proposed.output)).toBeLessThan(8192)
    const receipt = JSON.parse(proposed.output)
    expect(receipt).toMatchObject({ previewValid: true, atDraftRevision: before.draftRevision, atContentHash: before.contentHash, fitsReservedBudget: true, candidateConcaveCorners: 0 })
    expect(task.authoring!.state).toEqual(before)
    expect(proposed.output).not.toContain('PRIVATE_')
    const forbidden = { ...query, areaId: 'SECRET_GM_PROP' }
    const refused = executeAuthoringTool(task, call('private-proposal', 'sceneweave_propose_boundary', forbidden), forbidden)
    expect(refused.success).toBe(false); expect(refused.output).not.toContain('SECRET_GM_PROP')
    expect(task.authoring!.state).toEqual(before)
    const edit = { operations: [receipt.candidateOperation] }
    expect(executeAuthoringTool(task, call('adopt-proposal', 'sceneweave_edit_scene', edit), edit).success).toBe(true)
    expect(task.authoring!.state.operationCost - before.operationCost).toBe(receipt.actualOperationCost)
    expect(256 - task.authoring!.state.operationCost).toBe(receipt.remainingOperationsAfterEdit)
  })
  it('returns bounded terrain summaries and exact persisted anchor pages without relaxing the receipt budget', async () => {
    const source = start()
    source.scope.scene = { floorId: 'blank-floor', layerId: 'layer-default-0', boundsMm: { x: 11000, y: 1000, width: 8000, height: 8000 },
      entityIds: [], definitionIds: [], prefabDefinitionIds: [], materialIds: [], operations: ['terrain'] }
    const subject = setup(editProvider())
    const snapshot = await (await subject.create(source)).json() as TaskSnapshot
    await wait(subject.store, snapshot.id)
    const task = subject.store.read(snapshot.id)
    const boundaryMm = Array.from({ length: 80 }, (_, index) => ({ x: Math.round(15000 + 2500 * Math.cos(index * Math.PI / 40)), y: Math.round(5000 + 2500 * Math.sin(index * Math.PI / 40)) }))
    const args = { operations: [{ kind: 'terrain', id: 'detailed-public-terrain', boundaryMm, groundElevationMm: 0 }] }
    expect(executeAuthoringTool(task, call('terrain', 'sceneweave_edit_scene', args), args).success).toBe(true)
    const read = { section: 'scene', ids: ['detailed-public-terrain'] }
    const summary = executeAuthoringTool(task, call('large-terrain', 'sceneweave_read_scene', read), read)
    expect(summary.success).toBe(true)
    expect(Buffer.byteLength(summary.output)).toBeLessThan(8192)
    expect(JSON.parse(summary.output).entities[0]).toMatchObject({ id: 'detailed-public-terrain', geometryOmitted: true, boundaryPointCount: 80 })
    expect(JSON.parse(summary.output).entities[0].boundaryMm).toBeUndefined()
    const anchors = { section: 'anchors', ids: ['detailed-public-terrain'], offset: 16, limit: 16 }
    const page = executeAuthoringTool(task, call('anchor-page', 'sceneweave_read_scene', anchors), anchors)
    expect(page.success).toBe(true)
    expect(Buffer.byteLength(page.output)).toBeLessThan(8192)
    const persisted = replayAuthoring(task.authoring!.start, task.authoring!.state.steps).project.document.terrainAreas['detailed-public-terrain'].boundaryMm
    expect(JSON.parse(page.output)).toMatchObject({ actualPersistedAnchors: true, total: 80, nextOffset: 32, boundaryMm: persisted.slice(16, 32) })
    const forbidden = { section: 'anchors', ids: ['SECRET_GM_PROP'] }
    const refused = executeAuthoringTool(task, call('forbidden-anchors', 'sceneweave_read_scene', forbidden), forbidden)
    expect(refused.success).toBe(false); expect(refused.output).not.toContain('SECRET_GM_PROP')
  })
  it('records claims only against the immutable brief and reports unverified prose, missing furniture and finite budget', async () => {
    const source = start(); source.brief = { recipe: 'interior', requirements: ['Warm, furnished room'], requiredDefinitionIds: ['definition'] }
    let round = 0
    const subject = setup({ complete: async () => ++round === 1 ? done([edit()]) : done() })
    const snapshot = await (await subject.create(source)).json() as TaskSnapshot
    await wait(subject.store, snapshot.id)
    const task = subject.store.read(snapshot.id)
    const plan = { phase: 'review', requirements: [{ index: 0, state: 'claimed', evidenceIds: ['target'] }] }
    const planned = executeAuthoringTool(task, call('plan', 'sceneweave_plan_draft', plan), plan)
    expect(planned.success).toBe(true)
    expect(task.snapshot.authoring?.plan).toEqual(plan)
    const materialEvidence = { ...plan, requirements: [{ ...plan.requirements[0], evidenceIds: ['target', 'definition'] }] }
    expect(executeAuthoringTool(task, call('plan-definition', 'sceneweave_plan_draft', materialEvidence), materialEvidence).success).toBe(true)
    const before = cloneJson(task.authoring!.plan)
    for (const requirements of [[{ index: 1, state: 'claimed', evidenceIds: ['target'] }], [{ index: 0, state: 'claimed', evidenceIds: ['SECRET_GM_PROP'] }], [{ index: 0, state: 'claimed', evidenceIds: [] }]]) {
      const args = { phase: 'review', requirements }
      const result = executeAuthoringTool(task, call('invalid-plan', 'sceneweave_plan_draft', args), args)
      expect(result.success).toBe(false); expect(result.output).not.toContain('SECRET_GM_PROP')
      expect(task.authoring!.plan).toEqual(before)
    }
    const diagnosed = executeAuthoringTool(task, call('diagnose', 'sceneweave_diagnose_draft', {}), {})
    expect(diagnosed.success).toBe(true)
    expect(JSON.parse(diagnosed.output)).toMatchObject({ requirements: [{ status: 'needs_human_review' }], remaining: { operations: 255 }, visionImages: 0 })
    expect(diagnosed.output).not.toContain('PRIVATE_GM_PROJECT_TITLE')
    const bad = cloneJson(source); bad.brief!.requiredDefinitionIds = ['ungranted']
    expect((await subject.create(bad)).status).toBe(400)
  })
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
  it('browses the granted multilingual palette by bounded pages after an empty exact search', async () => {
    const subject = setup({ complete: () => new Promise<ProviderCompletion>(() => {}) }), authoring = start()
    authoring.project.document.propDefinitions.definition.name = '铜色桌灯'
    authoring.project.document.propDefinitions.definition.tags = ['原创']
    const other = cloneJson(authoring.project.document.propDefinitions.definition)
    other.id = 'unauthorised-lamp'; other.catalogId = 'test.authoring.other'; other.name = 'PRIVATE_PALETTE_LAMP'
    authoring.project.document.propDefinitions[other.id] = other
    authoring.project.licenseBindings.push({ ...authoring.project.licenseBindings[0], subjectId: other.id })
    authoring.baseContentHash = authoringProjectHash(authoring.project)
    const response = await subject.create(authoring)
    expect(response.status).toBe(201)
    const created = await response.json() as TaskSnapshot, task = subject.store.read(created.id)
    const run = (args: unknown) => executeAuthoringTool(task, call('find', 'sceneweave_find_assets', args), args)
    const missing = run({ query: 'lamp', limit: 1 })
    expect(JSON.parse(missing.output)).toMatchObject({ assets: [], total: 0, nextOffset: null, hint: expect.stringContaining('query empty') })
    const first = run({ query: '', limit: 1 })
    expect(JSON.parse(first.output)).toMatchObject({ assets: [{ id: 'definition', name: '铜色桌灯' }], total: 1, nextOffset: null })
    expect(JSON.parse(run({ query: '', limit: 1, offset: 1 }).output).assets).toEqual([])
    expect(run({ query: '', limit: 1, offset: 1024 }).success).toBe(true)
    expect(run({ query: '', limit: 1, offset: 1025 }).success).toBe(false)
    const lateRead = { section: 'targets', offset: 768, limit: 16 }
    expect(executeAuthoringTool(task, call('read-late', 'sceneweave_read_scene', lateRead), lateRead).success).toBe(true)
    expect(first.output).not.toContain('PRIVATE_PALETTE_LAMP')
    expect(JSON.parse(run({ query: 'definition', limit: 1 }).output).assets).toHaveLength(1)
    const invalid = run({ query: '', limit: 1, offset: -1 })
    expect(invalid.success).toBe(false)
    expect(JSON.parse(invalid.output)).toMatchObject({ error: { code: 'invalid_arguments', issues: [{ path: 'offset' }] } })
  })
  it('identifies the failing scene recipe with a fixed boundary hint and keeps the whole step atomic', async () => {
    const subject = setup({ complete: () => new Promise<ProviderCompletion>(() => {}) }), authoring = start()
    const boundsMm = cloneJson(authoring.project.document.floors['blank-floor'].boundsMm)
    authoring.skill = { id: 'sceneweave-scene-authoring', version: 1 }
    authoring.scope.scene = { floorId: 'blank-floor', layerId: 'layer-default-0', boundsMm, entityIds: [], definitionIds: ['definition'], prefabDefinitionIds: [], materialIds: [], operations: ['furnish'] }
    const response = await subject.create(authoring)
    expect(response.status).toBe(201)
    const created = await response.json() as TaskSnapshot, task = subject.store.read(created.id), before = cloneJson(task.authoring!.state)
    const operations = [
      { kind: 'furnish', id: 'valid-furniture', definitionId: 'definition', positionMm: { x: 6000, y: 6000 }, supportRef: { kind: 'floor', id: 'blank-floor' } },
      { kind: 'furnish', id: 'SUBMITTED_ID_MUST_NOT_BE_ECHOED', definitionId: 'definition', positionMm: { x: boundsMm.x + boundsMm.width - 10, y: 6000 }, rotationDeg: 45, supportRef: { kind: 'floor', id: 'blank-floor' } },
    ]
    const failed = executeAuthoringTool(task, call('bad-boundary', 'sceneweave_edit_scene', { operations }), { operations })
    expect(failed.success).toBe(false)
    expect(JSON.parse(failed.output)).toMatchObject({ error: { code: 'invalid_geometry', operationIndex: 1, hint: expect.stringContaining('whole rotated footprint') } })
    for (const forbidden of ['SUBMITTED_ID_MUST_NOT_BE_ECHOED', 'PRIVATE_GM_PROJECT_TITLE', 'SECRET_GM_PROP', '实际几何']) expect(failed.output).not.toContain(forbidden)
    expect(task.authoring!.state).toEqual(before)
    operations[1].positionMm.x -= 500
    const repaired = executeAuthoringTool(task, call('repaired-boundary', 'sceneweave_edit_scene', { operations }), { operations })
    expect(repaired.success).toBe(true)
    expect(task.authoring!.state).toMatchObject({ draftRevision: 1, operationCost: 2 })
    expect(task.authoring!.state.steps[0].operations).toHaveLength(2)
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
  it('keeps cancellation terminal when an expired adoption claim is later released', async () => {
    const complete = vi.fn(editProvider().complete), subject = setup({ complete }), { id, stamp } = await ready(subject)
    const path = `/v1/tasks/${id}/draft`, claim = { ...stamp, claimId: randomUUID() }
    expect((await subject.request(`${path}/claim`, 'POST', claim)).status).toBe(200)
    subject.now.value += 30001
    const cancellation = await subject.request(`/v1/tasks/${id}/control`, 'POST', { schemaVersion: 1, expectedGeneration: stamp.expectedGeneration, action: 'cancel' })
    expect(cancellation.status).toBe(200)
    const cancelled = await cancellation.json() as TaskSnapshot
    expect(cancelled).toMatchObject({ status: 'cancelled', generation: stamp.expectedGeneration + 1 })
    const currentClaim = { ...claim, expectedGeneration: cancelled.generation }, before = subject.store.read(id)
    expect((await subject.request(`${path}/release`, 'POST', currentClaim)).status).toBe(409)
    expect((await subject.request(`${path}/validate`, 'POST', { ...stamp, expectedGeneration: cancelled.generation, valid: true })).status).toBe(409)
    expect((await subject.request(`/v1/tasks/${id}/control`, 'POST', { schemaVersion: 1, expectedGeneration: cancelled.generation, action: 'resume' })).status).toBe(409)
    const doc = before.authoring!.start.project.document
    expect((await subject.request(`${path}/applied`, 'POST', { ...currentClaim, sceneId: doc.sceneId, revision: doc.revision + 1 })).status).toBe(409)
    expect(subject.store.read(id)).toEqual(before)
    expect(complete).toHaveBeenCalledTimes(2)
  })
  it('releases an expired claim while paused and runs again only after explicit continuation', async () => {
    const complete = vi.fn(editProvider().complete), subject = setup({ complete }), { id, stamp } = await ready(subject)
    const path = `/v1/tasks/${id}/draft`, claim = { ...stamp, claimId: randomUUID() }
    await subject.request(`${path}/claim`, 'POST', claim)
    subject.now.value += 30001
    const before = subject.store.read(id)
    const released = await subject.request(`${path}/release`, 'POST', claim)
    expect(released.status).toBe(200)
    expect(await released.json()).toMatchObject({ status: 'paused', generation: stamp.expectedGeneration, authoring: { claim: null } })
    expect(complete).toHaveBeenCalledTimes(2)
    expect(subject.store.read(id).authoring!.state).toEqual(before.authoring!.state)
    const doc = before.authoring!.start.project.document
    expect((await subject.request(`${path}/applied`, 'POST', { ...claim, sceneId: doc.sceneId, revision: doc.revision + 1 })).status).toBe(409)
    const resumed = await subject.request(`/v1/tasks/${id}/control`, 'POST', { schemaVersion: 1, expectedGeneration: stamp.expectedGeneration, action: 'resume' })
    expect(resumed.status).toBe(200)
    await wait(subject.store, id)
    expect(complete).toHaveBeenCalledTimes(3)
    expect(subject.store.read(id).authoring!.state).toEqual(before.authoring!.state)
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
  it('lets a failed generation review its last valid draft without another provider request', async () => {
    let round = 0
    const complete = vi.fn(async () => ++round === 1 ? done([edit()]) : done([call(`check-${round}`, 'sceneweave_check_draft', {})]))
    const subject = setup({ complete }), created = await (await subject.create()).json() as TaskSnapshot
    const failed = await wait(subject.store, created.id, 'failed')
    expect(failed.error?.code).toBe('request_limit')
    expect(failed.error?.requestState).toBe('finished')
    const before = subject.store.read(created.id), stamp = { expectedGeneration: failed.generation, draftRevision: before.authoring!.state.draftRevision, contentHash: before.authoring!.state.contentHash }
    const response = await subject.request(`/v1/tasks/${created.id}/draft/validate`, 'POST', { ...stamp, valid: true })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ status: 'ready', error: null })
    expect(complete).toHaveBeenCalledTimes(16)
    expect(subject.store.read(created.id).authoring!.state).toEqual(before.authoring!.state)
    expect(subject.store.read(created.id).snapshot.usage).toEqual(failed.usage)
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
    const apply = vi.spyOn(authoringCore, 'applyAuthoringStep').mockReturnValue({ project: task.authoring!.start.project, state: resultState, visualInvalidatedIds: [] })
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
      expect(JSON.parse(checked.output)).toEqual({ valid: true, operationCost: 128, changedCount: 128,
        remainingOperations: 128, requirementClaims: [], appearanceReview: 'unconfirmed' })
      expect(checked.output).not.toContain('PRIVATE_ROOT_ID')
    } finally { apply.mockRestore(); check.mockRestore() }
  })
  it('withholds private dependency counts when an unrelated GM mask is added outside the grant', async () => {
    const subject = setup({ complete: () => new Promise<ProviderCompletion>(() => {}) })
    const source = start(), snapshot = await (await subject.create(source)).json() as TaskSnapshot
    const task = subject.store.read(snapshot.id), checked = executeAuthoringTool(task, call('before-mask', 'sceneweave_check_draft', {}), {})
    const masked = cloneJson(source)
    masked.project.document.regions['PRIVATE_MASK'] = { id: 'PRIVATE_MASK', floorId: 'blank-floor', editLocked: false, visibility: 'gm', kind: 'manualMask',
      boundaryMm: [{ x: 14000, y: 14000 }, { x: 15000, y: 14000 }, { x: 15000, y: 15000 }, { x: 14000, y: 15000 }], blocksMovement: false, movementCostMultiplier: 1 }
    masked.project.document.entityLayers.PRIVATE_MASK = 'layer-default-0'
    masked.project = validateProjectData(masked.project); masked.baseContentHash = authoringProjectHash(masked.project)
    task.authoring = { start: masked, state: replayAuthoring(masked, []).state }
    const after = executeAuthoringTool(task, call('after-mask', 'sceneweave_check_draft', {}), {})
    expect(after.success).toBe(true); expect(checked.success).toBe(true)
    expect(after.output).toBe(checked.output)
    expect(after.output).not.toContain('PRIVATE_MASK'); expect(JSON.parse(after.output).readDependencyCount).toBeUndefined()
    expect(task.authoring.state.readIds).toContain('PRIVATE_MASK')
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
    expect(complete).toHaveBeenCalledTimes(16); expect(failed.error?.code).toBe('request_limit'); expect(failed.tools).toHaveLength(15)
  })
  it.each([2, 4])('reserves the last of %i actual requests for an honest text-only finish and reports the effective budget', async modelRequests => {
    const inputs: ProviderInput[] = [], finalText = '已调整授权目标；其他场景需求仍未完成，草稿未采用。'
    const source = start(); source.brief = { recipe: 'interior', requirements: ['Create a complete furnished interior'] }
    const subject = setup({ complete: async input => {
      inputs.push(input)
      if (inputs.length === modelRequests) { input.onText(finalText); return { ...done(), text: finalText } }
      return done([inputs.length === 1 ? edit() : call(`check-${inputs.length}`, 'sceneweave_diagnose_draft', {})])
    } }, { value: 1000 }, { modelRequests, toolCalls: 9 })
    const snapshot = await (await subject.create(source)).json() as TaskSnapshot
    const waiting = await wait(subject.store, snapshot.id), task = subject.store.read(snapshot.id)
    expect(waiting.usage).toMatchObject({ requests: modelRequests, inputTokens: modelRequests * 10, outputTokens: modelRequests * 8, unknown: false })
    expect(waiting.text).toBe(finalText); expect(waiting.error).toBeNull()
    expect(inputs.at(-1)!.tools).toEqual([])
    expect(inputs.at(-1)!.messages.at(-1)).toMatchObject({ role: 'system', content: expect.stringContaining('unmet requirements') })
    expect(inputs[0].tools.length).toBeGreaterThan(0)
    expect(JSON.parse(waiting.tools[0].output)).toMatchObject({ remainingModelRequests: modelRequests - 1, remainingToolCalls: 8, remainingExecutionMs: 300000 })
    expect(task.authoring!.state.steps).toHaveLength(1)
    expect(task.snapshot.authoring!.claim).toBeNull()
  })
  it('records completed usage but refuses all final-round tools without changing the prior draft or retrying', async () => {
    const inputs: ProviderInput[] = []
    const subject = setup({ complete: async input => {
      inputs.push(input)
      return done([inputs.length === 1 ? edit() : call('forbidden-final-edit', 'sceneweave_edit_props', { operations: [{ kind: 'opacity', id: 'target', value: .1 }] })])
    } }, { value: 1000 }, { modelRequests: 2 })
    const snapshot = await (await subject.create()).json() as TaskSnapshot
    const failed = await wait(subject.store, snapshot.id, 'failed'), task = subject.store.read(snapshot.id)
    expect(inputs).toHaveLength(2); expect(inputs[1].tools).toEqual([])
    expect(failed.error).toMatchObject({ code: 'request_limit', requestState: 'finished' })
    expect(failed.usage).toMatchObject({ requests: 2, inputTokens: 20, outputTokens: 16, unknown: false })
    expect(failed.tools).toHaveLength(1); expect(task.authoring!.state.steps).toHaveLength(1)
    expect(replayAuthoring(task.authoring!.start, task.authoring!.state.steps).project.document.props.target.appearance.opacity).toBe(.5)
    expect(task.messages.filter(message => message.role === 'tool')).toHaveLength(1)
    expect(subject.store.events(snapshot.id, 0).filter(event => event.type === 'draft_updated')).toHaveLength(1)
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
