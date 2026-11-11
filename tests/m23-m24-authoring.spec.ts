import { openWorkspaceModule } from './workspace-navigation-helpers'
import { reloadSaved } from './workspace-ux-helpers'
import { test, expect, type Page } from '@playwright/test'
import { serve } from '@hono/node-server'
import { randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import { loadAiConfig } from '../services/ai/config'
import { createAiApp, connectionInfo } from '../services/ai/app'
import { TaskStore } from '../services/ai/store'
import { TaskEngine } from '../services/ai/engine'
import type { ProviderAdapter, ProviderCompletion, ProviderToolCall } from '../services/ai/provider-types'

let url: string, token: string, directory: string, store: TaskStore, engine: TaskEngine, server: ReturnType<typeof serve>
const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80"><path d="M40 2 L75 70 L5 70 Z" fill="#a95629" stroke="#3b241f" stroke-width="3"/><circle cx="40" cy="48" r="12" fill="#ffd36a"/></svg>'
const call = (id: string, operations: unknown[]): ProviderToolCall => ({ id, name: 'sceneweave_edit_scene', arguments: JSON.stringify({ operations }) })
const done = (toolCalls: ProviderToolCall[] = []): ProviderCompletion => ({ text: toolCalls.length ? '' : '小屋与院落草稿已完成，请检查。', toolCalls, finishReason: toolCalls.length ? 'tool_calls' : 'stop', usage: { inputTokens: 20, outputTokens: 30 }, requestId: 'controlled-m23-m24' })
test.beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), 'sceneweave-m234-')); token = randomBytes(24).toString('hex')
  const config = loadAiConfig({ SCENEWEAVE_AI_DATA_DIR: directory, SCENEWEAVE_AI_ALLOWED_ORIGINS: new URL(process.env.SCENEWEAVE_TEST_BASE_URL ?? 'http://127.0.0.1:5173').origin, SCENEWEAVE_AI_ACCESS_TOKEN: token, SCENEWEAVE_AI_PROVIDER_BASE_URL: 'http://127.0.0.1:9999/v1', SCENEWEAVE_AI_PROVIDER_API_KEY: 'no-network-controlled-provider', SCENEWEAVE_AI_PROVIDER_MODEL: 'controlled-m234' })
  const provider: ProviderAdapter = { async complete(input) {
    const receipt = (id: string) => input.messages.some(m => m.role === 'tool' && m.toolCallId === id)
    const authorization = JSON.parse(input.messages.find(m => m.role === 'user' && m.content?.startsWith('Authorized public'))!.content!.split('\n').slice(1).join('\n'))
    const floor = authorization.worldBoundsMm[0].floorId
    if (!receipt('rooms')) return done([call('rooms', [
      { kind: 'room', id: 'ai-room-one', boundaryMm: [{ x: 2000, y: 2000 }, { x: 6000, y: 2000 }, { x: 6000, y: 6000 }, { x: 2000, y: 6000 }], thicknessMm: 100, purpose: '起居室' },
      { kind: 'room', id: 'ai-room-two', boundaryMm: [{ x: 6000, y: 2000 }, { x: 10000, y: 2000 }, { x: 10000, y: 6000 }, { x: 6000, y: 6000 }], thicknessMm: 100, purpose: '卧室' },
      { kind: 'terrain', id: 'ai-yard', boundaryMm: [{ x: 1500, y: 6800 }, { x: 16000, y: 6800 }, { x: 16000, y: 11000 }, { x: 1500, y: 11000 }], groundElevationMm: 0 },
      { kind: 'path', id: 'ai-road', centerlineMm: [{ x: 4000, y: 6500 }, { x: 4000, y: 10500 }], widthMm: 900, supportRefs: [{ kind: 'floor', id: floor }, { kind: 'terrainArea', id: 'ai-yard' }] },
    ])])
    if (!receipt('read-build')) return done([{ id: 'read-build', name: 'sceneweave_read_scene', arguments: JSON.stringify({ section: 'scene', limit: 16 }) }])
    const scene = JSON.parse(input.messages.find(m => m.role === 'tool' && m.toolCallId === 'read-build')!.content!)
    if (!receipt('door')) {
      const vertices = scene.entities.filter((e: { entityKind: string }) => e.entityKind === 'vertex')
      const bottom = scene.entities.find((e: { entityKind: string; startVertexId: string; endVertexId: string }) => e.entityKind === 'wall' && vertices.some((v: { id: string; yMm: number }) => v.id === e.startVertexId && v.yMm === 6000) && vertices.some((v: { id: string; yMm: number }) => v.id === e.endVertexId && v.yMm === 6000))
      return done([call('door', [{ kind: 'opening', id: 'ai-door', wallId: bottom.id, offsetReferenceVertexId: bottom.startVertexId, offsetMm: 1200, widthMm: 1000, openingKind: 'door', state: 'open' }, { kind: 'entrance', openingIds: ['ai-door'] }])])
    }
    if (!receipt('find')) return done([{ id: 'find', name: 'sceneweave_find_assets', arguments: JSON.stringify({ query: '铜色桌灯', limit: 1 }) }])
    const definition = JSON.parse(input.messages.find(m => m.role === 'tool' && m.toolCallId === 'find')!.content!).assets[0].id
    if (!receipt('furnish')) return done([call('furnish', [{ kind: 'furnish', id: 'ai-lamp', definitionId: definition, positionMm: { x: 3500, y: 3500 }, supportRef: { kind: 'room', id: 'ai-room-one' } }, { kind: 'gmNote', id: 'ai-clue', anchor: { type: 'entity', entityKind: 'room', entityId: 'ai-room-one' }, noteKind: 'clue', title: '来客', text: '桌上有一封没有署名的信。' }])])
    if (!receipt('check')) return done([{ id: 'check', name: 'sceneweave_check_draft', arguments: '{}' }])
    const completion = done()
    input.onText(completion.text)
    return completion
  } }
  store = new TaskStore(directory); engine = new TaskEngine(store, provider, connectionInfo(config))
  server = serve({ fetch: createAiApp(config, { store, engine }).fetch, hostname: '127.0.0.1', port: 0 })
  await new Promise<void>(resolve => server.listening ? resolve() : server.once('listening', resolve))
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
test.afterAll(async () => { engine?.close(); if (server && 'closeAllConnections' in server) server.closeAllConnections(); await new Promise<void>(resolve => server?.close(() => resolve())); store?.close(); if (directory) rmSync(directory, { recursive: true, force: true }) })

async function saved(page: Page) {
  await expect(page.locator('.asset-busy')).toHaveCount(0)
  await expect(page.locator('.asset-save')).toHaveText('本地已保存')
  await expect(page.locator('.asset-map-wrap')).toHaveAttribute('aria-busy', 'false')
}
async function createBlank(page: Page, name: string) {
  await page.goto('/#home'); await page.getByTestId('workspace-home').getByRole('button', { name: '新建场景', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '新建空白场景', exact: true })
  await dialog.getByLabel('场景名称', { exact: true }).fill(name)
  await dialog.getByLabel('画布宽度', { exact: true }).fill('18'); await dialog.getByLabel('画布高度', { exact: true }).fill('12')
  await dialog.getByRole('button', { name: '创建空白场景', exact: true }).click(); await expect(dialog).toHaveCount(0)
  await saved(page)
}
async function read(page: Page) {
  return page.evaluate(async () => {
    const path = '/src/editor/main/Workbench.tsx'
    const { nativeWorkspace } = await import(path) as typeof import('../src/editor/main/Workbench')
    const p = nativeWorkspace.getState().project!
    return { document: p.document, sources: p.authoringSources, appearance: p.appearance }
  })
}

// Current authoring4 can create a scene with fixed assets. SVG resource creation
// is deliberately absent from that public task; retained artwork is tested below.
test('authoring4 scene recipes survive real HTTP review, protected adoption, undo and native reopen', async ({ page }) => {
  test.setTimeout(120_000)
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message))
  await createBlank(page, 'M2-3 当前协议小屋')
  const before = await read(page)
  expect(before.document.revision).toBe(0)
  await openWorkspaceModule(page, 'AI')
  const panel = page.getByRole('region', { name: 'AI 对话面板', exact: true }), authoring = page.getByRole('region', { name: 'AI 场景草稿', exact: true })
  const review = page.getByTestId('workspace-inspector').getByRole('region', { name: 'AI 草稿审阅', exact: true })
  await panel.getByLabel('AI 后端地址', { exact: true }).fill(url); await panel.getByLabel('AI 应用凭据', { exact: true }).fill(token)
  await panel.getByRole('button', { name: '连接 AI 后端', exact: true }).click(); await expect(panel.getByRole('button', { name: '查询最近任务', exact: true })).toBeEnabled()
  await authoring.getByLabel('AI 完整场景创作', { exact: true }).check()
  await authoring.getByText('授权本工程素材（0）', { exact: true }).click(); await authoring.getByRole('checkbox', { name: '铜色桌灯', exact: true }).check()
  await expect(authoring.getByLabel('AI 素材创作和同化', { exact: true })).toBeDisabled()
  await expect(authoring.getByLabel('AI 素材创作和同化', { exact: true })).not.toBeChecked()
  await authoring.getByLabel('AI 草稿要求', { exact: true }).fill('制作两间小屋、入口、道路与院落，放一盏固定桌灯并添加GM线索。')
  await authoring.getByRole('checkbox', { name: '同意向自有后端发送上述完整元数据，并向模型发送授权的公开内容', exact: true }).check()
  const creation = page.waitForResponse(response => new URL(response.url()).origin === url
    && new URL(response.url()).pathname === '/v1/tasks' && response.request().method() === 'POST')
  await authoring.getByRole('button', { name: '创建独立草稿任务', exact: true }).click()
  const response = await creation
  expect(response.status()).toBe(201)
  expect(response.request().postDataJSON()).toMatchObject({ authoring: { schemaVersion: 4,
    capability: 'sceneweave-current-authoring@1', source: { version: 4, kind: 'current-baseline' },
    scope: { artwork: null }, project: { format: 'sceneweave-complete-project', schemaVersion: 1 } } })
  await expect(panel.locator('.ai-task-heading > strong')).toHaveText('草稿可审阅采用', { timeout: 60_000 })
  const snapshot = store.list('maintainer')[0]
  expect(snapshot).toBeDefined()
  expect(store.read(snapshot.id).authoring?.start).toMatchObject({ schemaVersion: 4, scope: { artwork: null } })
  await expect(review.getByLabel('AI 草稿差异')).toBeVisible()
  await expect(review.getByLabel('AI 草稿差异')).not.toContainText('SVG来源')
  expect(await read(page)).toEqual(before)
  await review.getByRole('checkbox', { name: '已检查范围和差异，采用前创建保护快照', exact: true }).check(); await review.getByRole('button', { name: '保护当前并一次采用 AI 草稿', exact: true }).click()
  await expect(panel.locator('.ai-task-heading > strong')).toHaveText('已采用', { timeout: 60_000 }); await expect(page.locator('.asset-save')).toHaveText('本地已保存')
  const adopted = await read(page)
  expect(Object.keys(adopted.document.rooms)).toHaveLength(2); expect(Object.keys(adopted.document.walls)).toHaveLength(7)
  expect(adopted.document.constraints.entranceOpeningIds).toEqual(['ai-door']); expect(adopted.document.notes['ai-clue'].visibility).toBe('gm')
  expect(adopted.document.openings['ai-door']).toMatchObject({ kind: 'door', state: 'open', widthMm: 1000 })
  expect(adopted.document.terrainAreas['ai-yard'].groundElevationMm).toBe(0)
  expect(adopted.document.paths['ai-road']).toMatchObject({ widthMm: 900, supportRefs: expect.arrayContaining([{ kind: 'terrainArea', id: 'ai-yard' }]) })
  expect(adopted.document.props['ai-lamp'].supportRef).toEqual({ kind: 'room', id: 'ai-room-one' }); expect(adopted.document.props['ai-lamp'].appearance.opacity).toBe(1)
  expect(Object.keys(adopted.sources)).toHaveLength(0)
  const verification = await page.evaluate(async () => {
    const wp = '/src/editor/main/Workbench.tsx', rp = '/src/platform/browser/runtime.ts'
    const fp = '/src/shared/project/file.ts', pp = '/src/application/workspace/project.ts'
    const { nativeWorkspace } = await import(wp) as typeof import('../src/editor/main/Workbench')
    const { validation, projectRepository } = await import(rp) as typeof import('../src/platform/browser/runtime')
    const { exportHistoryArchive, importHistoryArchive } = await import(fp) as typeof import('../src/shared/project/file')
    const { toBundle } = await import(pp) as typeof import('../src/application/workspace/project')
    const project = nativeWorkspace.getState().project!, snapshots = await projectRepository.listSnapshots(project.document.sceneId)
    const archive = { current: toBundle(project), snapshots: [] }
    const bytes = await exportHistoryArchive(archive, validation), imported = await importHistoryArchive(bytes, validation)
    return { sourceCount: Object.keys(imported.current.project.authoringSources).length,
      document: imported.current.project.document, protections: snapshots.map(item => ({ kind: item.kind, sourceRevision: item.sourceRevision })) }
  })
  expect(verification).toEqual({ sourceCount: 0, document: adopted.document, protections: [{ kind: 'protection', sourceRevision: 0 }] })
  await page.getByRole('button', { name: '撤销编辑', exact: true }).click(); await saved(page)
  const undone = await read(page)
  for (const kind of ['rooms', 'walls', 'openings', 'terrainAreas', 'paths', 'props', 'notes'] as const) expect(undone.document[kind]).toEqual(before.document[kind])
  expect(undone.document.revision).toBe(adopted.document.revision + 1)
  await page.getByRole('button', { name: '重做编辑', exact: true }).click(); await saved(page)
  const redone = await read(page)
  expect(redone.document).toEqual({ ...adopted.document, revision: redone.document.revision, updatedAt: redone.document.updatedAt })
  expect(redone.document.revision).toBe(undone.document.revision + 1)
  await reloadSaved(page); await saved(page)
  const reopened = await read(page); expect(reopened).toEqual(redone)
  expect(errors).toEqual([])
})

test('retained SVG keeps real source pixels and licences through protected CAS, archive, cold reopen and later-edit undo', async ({ page }, info) => {
  test.setTimeout(120_000)
  const errors: string[] = [], taskPosts: string[] = []
  page.on('pageerror', e => errors.push(e.message))
  page.on('request', request => { if (request.method() === 'POST' && new URL(request.url()).pathname === '/v1/tasks') taskPosts.push(request.url()) })
  await createBlank(page, 'M2-4 内部素材保全回放')
  const originalBinding = await page.evaluate(async () => {
    const path = '/src/editor/main/Workbench.tsx'
    const { nativeWorkspace } = await import(path) as typeof import('../src/editor/main/Workbench')
    const project = nativeWorkspace.getState().project!, scene = project.document
    const floorId = Object.keys(scene.floors)[0], layerId = Object.keys(scene.userLayers)[0]
    const definition = Object.values(scene.propDefinitions).find(item => item.name === '铜色桌灯')
    if (!definition) throw new Error('Required built-in lamp missing')
    const binding = project.licenseBindings.find(item => item.subjectKind === 'propDefinition' && item.subjectId === definition.id)
    if (!binding) throw new Error('Required original lamp licence missing')
    await nativeWorkspace.execute([{ type: 'addProp', id: 'retained-lamp', floorId, layerId,
      definitionRef: { id: definition.id, version: definition.version }, positionMm: { x: 3500, y: 3500 }, supportRef: { kind: 'floor', id: floorId } }])
    await nativeWorkspace.flush()
    return { licenseRef: binding.licenseRef, licensePath: binding.licensePath, embedding: binding.embedding }
  })
  await saved(page)
  await openWorkspaceModule(page, 'AI')
  await expect(page.getByRole('region', { name: 'AI 场景草稿', exact: true }).getByLabel('AI 素材创作和同化', { exact: true })).toBeDisabled()
  const before = await read(page)
  const preparation = await page.evaluate(async sourceSvg => {
    const wp = '/src/editor/main/Workbench.tsx', hp = '/tests/helpers/m2-assimilation-browser.ts'
    const { nativeWorkspace } = await import(wp) as typeof import('../src/editor/main/Workbench')
    const { freezeRetainedArtwork, prepareRetainedArtwork, retainedPublicationState } = await import(hp) as typeof import('./helpers/m2-assimilation-browser')
    const baseline = await retainedPublicationState(nativeWorkspace)
    freezeRetainedArtwork(nativeWorkspace, { mode: 'single', targetIds: ['retained-lamp'], operations: ['svg', 'style'] })
    const audit = await prepareRetainedArtwork(nativeWorkspace, [
      { kind: 'svg', id: 'retained-lamp', sourceSvg, longEdgePx: 96, name: '铜色营灯保全变体' },
      { kind: 'style', ids: ['retained-lamp'], brightness: .8, opacity: .7 },
    ])
    return { baseline, afterPreview: await retainedPublicationState(nativeWorkspace), audit }
  }, svg)
  expect(preparation.afterPreview).toEqual(preparation.baseline)
  expect(await read(page)).toEqual(before)
  expect(preparation.audit).toMatchObject({ revision: before.document.revision,
    artwork: { mode: 'single', targetIds: ['retained-lamp'], operations: ['svg', 'style'] },
    processor: { processorId: 'sceneweave-static-svg', processorVersion: 2 } })
  expect(preparation.audit.operationCost).toBeGreaterThan(0)
  expect(preparation.audit.assessments.length).toBeGreaterThan(0)
  expect(preparation.audit.assessments.every(item => item.status !== 'blocked')).toBe(true)
  const publication = await page.evaluate(async () => {
    const wp = '/src/editor/main/Workbench.tsx', hp = '/tests/helpers/m2-assimilation-browser.ts'
    const { nativeWorkspace } = await import(wp) as typeof import('../src/editor/main/Workbench')
    const { publishRetainedArtwork, retainedPublicationState } = await import(hp) as typeof import('./helpers/m2-assimilation-browser')
    const result = await publishRetainedArtwork(nativeWorkspace)
    return { result, state: await retainedPublicationState(nativeWorkspace), canUndo: nativeWorkspace.getState().canUndo }
  })
  await saved(page)
  const adopted = await read(page)
  expect(publication.result.revision).toBe(before.document.revision + 1)
  expect(publication.state.hash).toBe(publication.state.coldHash)
  expect(publication.state.snapshots).toEqual([{ id: publication.result.protectionId, kind: 'protection', contentHash: preparation.baseline.hash }])
  // Publication cold-opens the retained result; it is not an AI adoption and
  // does not promise an undo entry. Ordinary later edits remain undoable.
  expect(publication.canUndo).toBe(false)
  expect(adopted.document.props['retained-lamp'].appearance.opacity).toBe(.7)
  for (const field of ['positionMm', 'rotationDeg', 'visualBoundsMm', 'footprintMm', 'footprintOffsetMm', 'supportRef', 'visibility', 'blocksMovement', 'blocksSight'] as const) {
    expect(adopted.document.props['retained-lamp'][field]).toEqual(before.document.props['retained-lamp'][field])
  }
  const pixels = await page.evaluate(async () => {
    const wp = '/src/editor/main/Workbench.tsx', rp = '/src/platform/browser/runtime.ts', gp = '/src/shared/appearance/graph.ts'
    const { nativeWorkspace } = await import(wp) as typeof import('../src/editor/main/Workbench')
    const { validation } = await import(rp) as typeof import('../src/platform/browser/runtime')
    const { effectiveAdjustments } = await import(gp) as typeof import('../src/shared/appearance/graph')
    const project = nativeWorkspace.getState().project!, prop = project.document.props['retained-lamp']
    const entries = Object.entries(project.authoringSources)
    if (entries.length !== 1 || prop.appearance.kind !== 'image') throw new Error('Expected one retained SVG and an actual image appearance')
    const [sourceAssetId, source] = entries[0], image = project.document.assets[prop.appearance.assetId]
    const sourcePixels = await validation.images.decode(await project.resources.read(source.rasterSha256), project.assets[source.rasterSha256])
    const effectivePixels = await validation.images.decode(await project.resources.read(image.sha256), project.assets[image.sha256])
    const sample = (raster: typeof sourcePixels, x: number, y: number) => Array.from(raster.rgba.slice((y * raster.width + x) * 4, (y * raster.width + x) * 4 + 4))
    const root = project.appearance.sources[project.appearance.propSources[prop.id]]
    if (root.kind !== 'prop' || !root.snapshot.definitionRef) throw new Error('Retained SVG fixed source missing')
    return { dimensions: [sourcePixels.width, sourcePixels.height, effectivePixels.width, effectivePixels.height],
      transparent: sample(sourcePixels, 0, 0), triangle: sample(sourcePixels, 48, 30), circle: sample(sourcePixels, 48, 58),
      dimmedCircle: sample(effectivePixels, 48, 58), adjustments: effectiveAdjustments(project, prop.id),
      assetBinding: project.licenseBindings.find(item => item.subjectKind === 'asset' && item.subjectId === sourceAssetId),
      definitionBinding: project.licenseBindings.find(item => item.subjectKind === 'propDefinition' && item.subjectId === root.snapshot.definitionRef!.id) }
  })
  expect(pixels).toMatchObject({ dimensions: [96, 96, 96, 96], transparent: [0, 0, 0, 0], triangle: [169, 86, 41, 255],
    circle: [255, 211, 106, 255], dimmedCircle: [204, 169, 85, 255], adjustments: { brightness: .8, opacity: .7 },
    assetBinding: originalBinding, definitionBinding: originalBinding })
  const staleSave = await page.evaluate(async expectedRevision => {
    const wp = '/src/editor/main/Workbench.tsx', hp = '/tests/helpers/m2-assimilation-browser.ts'
    const rp = '/src/platform/browser/runtime.ts', pp = '/src/application/workspace/project.ts', sp = '/src/platform/browser/storage/repository.ts'
    const { nativeWorkspace } = await import(wp) as typeof import('../src/editor/main/Workbench')
    const { retainedPublicationState } = await import(hp) as typeof import('./helpers/m2-assimilation-browser')
    const { projectRepository } = await import(rp) as typeof import('../src/platform/browser/runtime')
    const { toBundle } = await import(pp) as typeof import('../src/application/workspace/project')
    const { ProjectConflictError } = await import(sp) as typeof import('../src/platform/browser/storage/repository')
    const before = await retainedPublicationState(nativeWorkspace)
    let rejected = false
    try { await projectRepository.save(toBundle(nativeWorkspace.getState().project!), expectedRevision) }
    catch (failure) { if (!(failure instanceof ProjectConflictError)) throw failure; rejected = true }
    return { rejected, before, after: await retainedPublicationState(nativeWorkspace) }
  }, before.document.revision)
  expect(staleSave.rejected).toBe(true); expect(staleSave.after).toEqual(staleSave.before)
  await page.evaluate(async () => {
    const path = '/src/editor/main/Workbench.tsx'
    const { nativeWorkspace } = await import(path) as typeof import('../src/editor/main/Workbench')
    await nativeWorkspace.execute([{ type: 'setAppearanceAdjustment', scope: { kind: 'targets', ids: ['retained-lamp'] },
      adjustment: { id: 'retained-later-opacity', kind: 'opacity', value: .25, enabled: true } }])
    await nativeWorkspace.flush()
  })
  await saved(page)
  const edited = await read(page)
  expect(edited.document.props['retained-lamp'].appearance.opacity).toBe(.25)
  await page.getByRole('button', { name: '撤销编辑', exact: true }).click(); await saved(page)
  const undone = await read(page)
  expect(undone.document.props['retained-lamp']).toEqual(adopted.document.props['retained-lamp']); expect(undone.sources).toEqual(adopted.sources)
  await page.getByRole('button', { name: '重做编辑', exact: true }).click(); await saved(page)
  const redone = await read(page)
  expect(redone.document.props['retained-lamp']).toEqual(edited.document.props['retained-lamp']); expect(redone.sources).toEqual(adopted.sources)
  const closure = await page.evaluate(async () => {
    const wp = '/src/editor/main/Workbench.tsx', hp = '/tests/helpers/m2-assimilation-browser.ts', rp = '/src/platform/browser/runtime.ts'
    const fp = '/src/shared/project/file.ts', pp = '/src/application/workspace/project.ts'
    const { nativeWorkspace } = await import(wp) as typeof import('../src/editor/main/Workbench')
    const { verifyResourceClosure } = await import(hp) as typeof import('./helpers/m2-assimilation-browser')
    const { validation, projectRepository } = await import(rp) as typeof import('../src/platform/browser/runtime')
    const { exportHistoryArchive, importHistoryArchive } = await import(fp) as typeof import('../src/shared/project/file')
    const { toBundle, fromBundle } = await import(pp) as typeof import('../src/application/workspace/project')
    const project = nativeWorkspace.getState().project!, snapshots = await projectRepository.listSnapshots(project.document.sceneId)
    const protections = await Promise.all(snapshots.map(item => projectRepository.loadSnapshot(project.document.sceneId, item.id)))
    if (protections.some(item => !item)) throw new Error('Retained protection cold-read missing')
    const archive = await importHistoryArchive(await exportHistoryArchive({ current: toBundle(project), snapshots: protections.filter(item => item !== null) }, validation), validation)
    const imported = await fromBundle(archive.current, validation)
    return { before: await verifyResourceClosure(project), after: await verifyResourceClosure(imported), sourceCount: Object.keys(imported.authoringSources).length,
      document: imported.document, protection: archive.snapshots.map(item => ({ kind: item.kind, sourceRevision: item.sourceRevision, props: Object.keys(item.bundle.project.document.props) })) }
  })
  expect(closure.before).toEqual(closure.after); expect(closure.sourceCount).toBe(1)
  expect(closure.before.sourceTexts[0].original).toBe(svg); expect(closure.document).toEqual(redone.document)
  expect(closure.protection).toEqual([{ kind: 'protection', sourceRevision: before.document.revision, props: ['retained-lamp'] }])
  await reloadSaved(page); await saved(page)
  expect(await read(page)).toEqual(redone)
  expect(taskPosts).toEqual([]); expect(errors).toEqual([])
  await info.attach('retained-svg-protected-persistence.json', { body: JSON.stringify({ preparation: preparation.audit, publication, pixels, closure }), contentType: 'application/json' })
})
