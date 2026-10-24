import { expect, test, type Page } from '@playwright/test'
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
import type { AuthoringOperation } from '../src/shared/ai/authoring-protocol'

// This suite uses a deterministic provider and real HTTP/SSE, native commands,
// Chromium SVG/Canvas pixels and IndexedDB. It does not call a paid model.
const SOURCE = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80"><path d="M40 4 L70 62 L60 76 L20 76 L10 62 Z" fill="#173f39" stroke="#0d241f" stroke-width="4"/><circle cx="40" cy="44" r="13" fill="#c99948"/></svg>'
let url: string, token: string, directory: string, store: TaskStore, engine: TaskEngine, server: ReturnType<typeof serve>
const complete = (toolCalls: ProviderToolCall[] = []): ProviderCompletion => ({ text: toolCalls.length ? '' : '已按本批冻结目标协调外观；请检查源与实际图片。', toolCalls,
  finishReason: toolCalls.length ? 'tool_calls' : 'stop', usage: { inputTokens: 1, outputTokens: 1 }, requestId: 'deterministic-assimilation' })
test.beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), 'sceneweave-assimilation-')); token = randomBytes(24).toString('hex')
  const origin = new URL(process.env.SCENEWEAVE_TEST_BASE_URL ?? 'http://127.0.0.1:5173').origin
  const config = loadAiConfig({ SCENEWEAVE_AI_DATA_DIR: directory, SCENEWEAVE_AI_ALLOWED_ORIGINS: origin, SCENEWEAVE_AI_ACCESS_TOKEN: token,
    SCENEWEAVE_AI_PROVIDER_BASE_URL: 'http://127.0.0.1:1/v1', SCENEWEAVE_AI_PROVIDER_API_KEY: 'deterministic-provider-no-network', SCENEWEAVE_AI_PROVIDER_MODEL: 'deterministic-assimilation' })
  const provider: ProviderAdapter = { async complete(input) {
    const context = JSON.parse(input.messages.find(m => m.role === 'user' && m.content?.startsWith('Authorized public'))!.content!.split('\n').slice(1).join('\n'))
    const prompt = input.messages.filter(m => m.role === 'user').at(-1)!.content!
    const receipt = (id: string) => input.messages.some(m => m.role === 'tool' && m.toolCallId === id)
    if (!receipt('edit')) {
      const ids = context.artwork.targetIds as string[]
      const operations: AuthoringOperation[] = prompt.includes('单件') ? [{ kind: 'svg', id: ids[0], sourceSvg: SOURCE, longEdgePx: 96, name: '阴绿铜灯固定新版本' }]
        : [{ kind: 'style', ids,
          ...(prompt.includes('组合') ? { brightness: .85, opacity: .8 } : prompt.includes('第一批') ? { tint: '#627b6b', opacity: .65 } : { brightness: .7, opacity: .45 }) }]
      if (prompt.includes('越权')) operations.push({ kind: 'style', ids: ['outside-same'], brightness: .7, opacity: .45 })
      return complete([{ id: 'edit', name: 'sceneweave_edit_scene', arguments: JSON.stringify({ operations }) }])
    }
    if (!receipt('check')) return complete([{ id: 'check', name: 'sceneweave_check_draft', arguments: '{}' }])
    const result = complete(); await input.onText(result.text); return result
  } }
  store = new TaskStore(directory); engine = new TaskEngine(store, provider, connectionInfo(config))
  server = serve({ fetch: createAiApp(config, { store, engine }).fetch, hostname: '127.0.0.1', port: 0 })
  await new Promise<void>(resolve => server.listening ? resolve() : server.once('listening', resolve))
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
test.afterAll(async () => { engine?.close(); if ('closeAllConnections' in server) server.closeAllConnections(); await new Promise<void>(resolve => server?.close(() => resolve())); store?.close(); if (directory) rmSync(directory, { recursive: true, force: true }) })

const pane = (page: Page) => page.getByRole('region', { name: 'AI 场景草稿', exact: true })
const panel = (page: Page) => page.getByRole('region', { name: 'AI 对话面板', exact: true })
async function read(page: Page) {
  return page.evaluate(async () => {
    const wp = '/src/editor/main/Workbench.tsx', helper = '/tests/helpers/m2-assimilation-browser.ts'
    const { nativeWorkspace } = await import(wp) as typeof import('../src/editor/main/Workbench')
    const { assimilationState } = await import(helper) as typeof import('./helpers/m2-assimilation-browser')
    return assimilationState(nativeWorkspace.getState().project!)
  })
}
async function commands(page: Page, commands: import('../src/shared/model/appearance').CompositionCommand[]) {
  await page.evaluate(async values => {
    const path = '/src/editor/main/Workbench.tsx', { nativeWorkspace } = await import(path) as typeof import('../src/editor/main/Workbench')
    await nativeWorkspace.execute(values); await nativeWorkspace.flush()
  }, commands)
  await saved(page)
}
async function saved(page: Page) {
  await expect(page.locator('.asset-busy')).toHaveCount(0, { timeout: 30_000 })
  await expect(page.locator('.asset-save')).toHaveText('本地已保存', { timeout: 30_000 })
  await expect(page.locator('.asset-map-wrap')).toHaveAttribute('aria-busy', 'false', { timeout: 30_000 })
}
async function create(page: Page) {
  await page.goto('/#home'); await page.getByTestId('workspace-home').getByRole('button', { name: '新建场景', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '新建空白场景', exact: true })
  await dialog.getByLabel('场景名称', { exact: true }).fill('M2 冻结范围渐进同化验收')
  await dialog.getByLabel('画布宽度', { exact: true }).fill('18000'); await dialog.getByLabel('画布高度', { exact: true }).fill('12000')
  await dialog.getByRole('button', { name: '创建空白场景', exact: true }).click(); await expect(dialog).toHaveCount(0); await saved(page)
  await page.evaluate(async () => {
    const path = '/src/editor/main/Workbench.tsx', helper = '/tests/helpers/m2-assimilation-browser.ts'
    const { nativeWorkspace } = await import(path) as typeof import('../src/editor/main/Workbench')
    const { seedAssimilation } = await import(helper) as typeof import('./helpers/m2-assimilation-browser')
    return seedAssimilation(nativeWorkspace)
  }); await saved(page)
  await page.getByRole('tab', { name: 'AI对话', exact: true }).click()
  await panel(page).getByLabel('AI 后端地址', { exact: true }).fill(url); await panel(page).getByLabel('AI 应用凭据', { exact: true }).fill(token)
  await panel(page).getByRole('button', { name: '连接 AI 后端', exact: true }).click()
  await expect(panel(page).getByRole('button', { name: '查询最近任务', exact: true })).toBeEnabled()
  await pane(page).getByLabel('AI 素材创作和同化', { exact: true }).check()
  await pane(page).getByRole('checkbox', { name: '移动 / 旋转', exact: true }).uncheck()
  await pane(page).getByRole('checkbox', { name: '透明度', exact: true }).uncheck()
  await pane(page).getByRole('checkbox', { name: '同意向自有后端发送上述完整元数据，并向模型发送授权的公开内容', exact: true }).check()
}
async function select(page: Page, ids: string[], kind: '物件' | '组合' = '物件') {
  await page.getByTestId('workspace-navigation').getByRole('tab', { name: '对象', exact: true }).click()
  await page.getByRole('group', { name: '场景对象分类', exact: true }).getByRole('button', { name: kind, exact: true }).click()
  if (kind === '物件') await page.getByLabel('搜索场景物件', { exact: true }).fill('')
  for (let index = 0; index < ids.length; index++) await page.locator(`.asset-entity-list [data-entity-id="${ids[index]}"]`).click({ modifiers: index ? ['Shift'] : [] })
  await page.getByRole('tab', { name: 'AI对话', exact: true }).click()
}
async function scope(page: Page, mode: 'single' | 'prefab' | 'range', ids: string[], bounds?: { x: number; y: number; width: number; height: number }) {
  await select(page, ids, mode === 'prefab' ? '组合' : '物件')
  const details = pane(page).locator(':scope > details').first()
  if (await details.getAttribute('open') === null) await pane(page).getByText('新任务的授权范围', { exact: true }).click()
  await pane(page).getByLabel('AI 素材范围', { exact: true }).selectOption(mode)
  await pane(page).getByRole('button', { name: '使用画布选中的素材', exact: true }).click()
  if (bounds) {
    await pane(page).getByText('明确创作范围（整数毫米）', { exact: true }).click()
    for (const [key, value] of Object.entries(bounds)) await pane(page).getByLabel(`AI 范围 ${key}`, { exact: true }).fill(String(value))
    await pane(page).getByText('明确创作范围（整数毫米）', { exact: true }).click()
  }
}
async function draft(page: Page, prompt: string) {
  await pane(page).getByLabel('AI 草稿要求', { exact: true }).fill(prompt)
  await pane(page).getByRole('button', { name: '创建独立草稿任务', exact: true }).click()
  await expect(panel(page).locator('.ai-task-heading > strong')).toHaveText('草稿可审阅采用', { timeout: 60_000 })
  const id = /任务 ([A-Za-z0-9-]+) · 发起修订/.exec(await panel(page).getByRole('article', { name: 'AI 当前任务', exact: true }).innerText())![1]
  return store.read(id, 'maintainer')
}
async function adopt(page: Page) {
  await pane(page).getByRole('checkbox', { name: '已检查范围和差异，采用前创建保护快照', exact: true }).check()
  await pane(page).getByRole('button', { name: '保护当前并一次采用 AI 草稿', exact: true }).click()
  await expect(panel(page).locator('.ai-task-heading > strong')).toHaveText('已采用', { timeout: 60_000 }); await saved(page)
}
const physical = (prop: import('../src/shared/model/scene').Prop) => {
  const { appearance: _appearance, definitionRef: _definitionRef, ...rest } = prop; return rest
}

test('single SVG, fixed prefab and two frozen range batches keep manual edits, cancel safely and restore only one prior object offline', async ({ page }, info) => {
  test.setTimeout(240_000)
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await create(page); const initial = await read(page), audit = []
  await scope(page, 'single', ['assim-a']); const single = await draft(page, '单件：把选中的铜灯改成阴绿铜色。')
  expect((await read(page)).document).toEqual(initial.document); await adopt(page)
  const afterSingle = await read(page)
  expect(Object.keys(afterSingle.sources)).toHaveLength(1)
  expect(physical(afterSingle.document.props['assim-a'])).toEqual(physical(initial.document.props['assim-a']))
  expect(afterSingle.document.props['outside-same']).toEqual(initial.document.props['outside-same'])
  await commands(page, [{ type: 'createPrefab', id: 'assim-group', definitionId: 'assim-fixed', name: '验收铜灯组合', ids: ['assim-a', 'assim-b', 'assim-delete', 'assim-detach'], anchorMm: { x: 3500, y: 3500 } }])
  await commands(page, [{ type: 'setAppearanceAdjustment', scope: { kind: 'targets', ids: ['assim-b'] }, adjustment: { id: 'manual-shadow', kind: 'shadowClass', value: 'none', enabled: true } },
    { type: 'setAppearanceAdjustment', scope: { kind: 'targets', ids: ['assim-b'] }, adjustment: { id: 'disabled-manual-opacity', kind: 'opacity', value: .9, enabled: false } }])
  const beforeGroup = await read(page)
  await scope(page, 'prefab', ['assim-group']); const group = await draft(page, '组合：逐成员协调亮度和透明度。'); await adopt(page)
  const afterGroup = await read(page)
  expect(afterGroup.document.prefabDefinitions['assim-fixed']).toEqual(beforeGroup.document.prefabDefinitions['assim-fixed'])
  expect(afterGroup.appearance.instanceAdjustments['assim-b']).toEqual(expect.arrayContaining(beforeGroup.appearance.instanceAdjustments['assim-b']))
  for (const id of ['assim-a', 'assim-b', 'assim-delete', 'assim-detach']) {
    expect(physical(afterGroup.document.props[id])).toEqual(physical(beforeGroup.document.props[id]))
    expect(afterGroup.document.props[id].appearance.opacity).toBe(.8)
  }
  // Human movement, deletion and exit are interleaved with accepted AI batches.
  await commands(page, [{ type: 'updateProp', id: 'assim-b', changes: { positionMm: { x: 4600, y: 2600 } } },
    { type: 'deleteProp', id: 'assim-delete' }])
  await commands(page, [{ type: 'detachPrefabMember', groupId: 'assim-group', propId: 'assim-detach' }])
  const manualGroup = await read(page), keptMembers = manualGroup.document.prefabInstances['assim-group'].members
  expect(Object.values(keptMembers).filter(member => member.propId === null)).toHaveLength(2)
  await scope(page, 'range', ['assim-a', 'assim-b', 'range-a'], { x: 1000, y: 1000, width: 6500, height: 5000 })
  // New same-layer/same-definition content is added after the UI target set was frozen.
  const definition = initial.document.props['range-a'].definitionRef!
  await commands(page, [{ type: 'addProp', id: 'after-freeze-a', floorId: initial.document.props['range-a'].floorId,
    definitionRef: definition, layerId: initial.document.entityLayers['range-a'], positionMm: { x: 6500, y: 4500 } }])
  const beforeFirst = await read(page), first = await draft(page, '第一批：只同化明确选择的三个物件。')
  expect(first.authoring!.start.scope.artwork!.targetIds).toEqual(['assim-a', 'assim-b', 'range-a'])
  expect(first.snapshot.context!.revision).toBe(beforeFirst.document.revision)
  await adopt(page); const afterFirst = await read(page)
  expect(afterFirst.document.props['after-freeze-a']).toEqual(beforeFirst.document.props['after-freeze-a'])
  expect(afterFirst.document.props['assim-detach']).toEqual(beforeFirst.document.props['assim-detach'])
  expect(afterFirst.document.props['outside-same']).toEqual(initial.document.props['outside-same'])
  expect(afterFirst.document.props['assim-delete']).toBeUndefined()
  for (const [key, member] of Object.entries(keptMembers)) {
    expect(afterFirst.document.prefabInstances['assim-group'].members[key].propId).toBe(member.propId)
    expect(afterFirst.document.prefabInstances['assim-group'].members[key].overrideFields).toEqual(expect.arrayContaining(member.overrideFields))
  }
  await page.getByRole('tab', { name: '历史', exact: true }).click()
  await page.getByRole('button', { name: '新建命名快照', exact: true }).click()
  await page.getByLabel('命名快照名称', { exact: true }).fill('第一批已采用')
  await page.getByRole('button', { name: '保存快照', exact: true }).click(); await saved(page)
  // Terrace edit is outside both AI property scopes and must survive all later work.
  await commands(page, [{ type: 'setTerrainElevation', id: 'later-terrace', groundElevationMm: 300 },
    { type: 'updateProp', id: 'outside-same', changes: { rotationDeg: 35 } }])
  await scope(page, 'range', ['range-b'], { x: 8500, y: 1000, width: 4500, height: 5000 })
  await commands(page, [{ type: 'addProp', id: 'after-freeze-b', floorId: initial.document.props['range-b'].floorId,
    definitionRef: definition, layerId: initial.document.entityLayers['range-b'], positionMm: { x: 11500, y: 4500 } }])
  const beforeSecond = await read(page), canceled = await draft(page, '第二批取消演练：协调右侧范围。')
  await panel(page).getByRole('button', { name: '取消任务', exact: true }).click()
  await expect(panel(page).locator('.ai-task-heading > strong')).toHaveText('已取消')
  expect((await read(page)).document).toEqual(beforeSecond.document)
  expect((await read(page)).appearance).toEqual(beforeSecond.appearance)
  // The second independent batch starts with a fresh baseline/grant and protection point.
  const second = await draft(page, '第二批：仅协调右侧选中的物件。'); await adopt(page)
  const afterSecond = await read(page)
  expect(second.authoring!.start.seed).not.toBe(first.authoring!.start.seed)
  expect(second.snapshot.context!.revision).toBe(beforeSecond.document.revision)
  expect(second.authoring!.start.scope.artwork!.targetIds).toEqual(['range-b'])
  expect(afterSecond.document.props['range-b'].appearance.opacity).toBe(.45)
  for (const id of ['assim-a', 'assim-b', 'range-a', 'assim-detach', 'after-freeze-a', 'after-freeze-b', 'outside-same']) expect(afterSecond.document.props[id]).toEqual(beforeSecond.document.props[id])
  expect(afterSecond.document.terrainAreas).toEqual(beforeSecond.document.terrainAreas)
  // Change one first-batch item again, then restore only its prior effective appearance.
  await commands(page, [{ type: 'setAppearanceAdjustment', scope: { kind: 'targets', ids: ['assim-a'] }, adjustment: { id: 'manual-later-opacity', kind: 'opacity', value: .2, enabled: true } }])
  await commands(page, [{ type: 'updateProp', id: 'assim-a', changes: { positionMm: { x: 2700, y: 2500 } } },
    { type: 'updateProp', id: 'outside-same', changes: { rotationDeg: 55 } }])
  const beforeRestore = await read(page)
  await page.getByRole('tab', { name: '历史', exact: true }).click()
  await page.getByRole('button', { name: '查看快照 第一批已采用', exact: true }).click()
  await page.getByLabel('局部恢复模式', { exact: true }).selectOption('appearance')
  await page.getByRole('checkbox', { name: '恢复物件 assim-a', exact: true }).check()
  await page.getByRole('button', { name: '预览局部恢复 · 1 件', exact: true }).click()
  expect((await read(page)).document).toEqual(beforeRestore.document)
  await page.getByRole('checkbox', { name: '确认恢复完整影响范围', exact: true }).check()
  await page.getByRole('button', { name: '保护当前并采用', exact: true }).click(); await saved(page)
  const restored = await read(page)
  expect(restored.document.props['assim-a'].appearance).toEqual(afterFirst.document.props['assim-a'].appearance)
  expect(restored.document.props['assim-a'].positionMm).toEqual({ x: 2700, y: 2500 })
  for (const id of Object.keys(beforeRestore.document.props).filter(id => id !== 'assim-a')) expect(restored.document.props[id]).toEqual(beforeRestore.document.props[id])
  expect(restored.document.terrainAreas).toEqual(beforeRestore.document.terrainAreas)
  expect(restored.document.revision).toBe(beforeRestore.document.revision + 1)
  // Cold reload and complete selected-history archive retain real SVG/PNG/licence bytes offline.
  await page.getByRole('button', { name: '重新载入已保存版本', exact: true }).click(); await saved(page)
  expect(await read(page)).toEqual(restored)
  await page.context().setOffline(true)
  const closure = await page.evaluate(async () => {
    const wp = '/src/editor/main/Workbench.tsx', hp = '/tests/helpers/m2-assimilation-browser.ts', rp = '/src/platform/browser/runtime.ts'
    const fp = '/src/shared/project/file.ts', pp = '/src/application/workspace/project.ts', render = '/src/platform/browser/render/renderer.ts'
    const { nativeWorkspace } = await import(wp) as typeof import('../src/editor/main/Workbench')
    const { verifyResourceClosure } = await import(hp) as typeof import('./helpers/m2-assimilation-browser')
    const { projectRepository, validation } = await import(rp) as typeof import('../src/platform/browser/runtime')
    const { exportHistoryArchive, importHistoryArchive } = await import(fp) as typeof import('../src/shared/project/file')
    const { toBundle, fromBundle } = await import(pp) as typeof import('../src/application/workspace/project')
    const { exportPng } = await import(render) as typeof import('../src/platform/browser/render/renderer')
    const current = nativeWorkspace.getState().project!, before = await verifyResourceClosure(current)
    const snapshots = await projectRepository.listSnapshots(current.document.sceneId)
    const selected = (await Promise.all(snapshots.filter(item => item.name === '第一批已采用').map(item => projectRepository.loadSnapshot(current.document.sceneId, item.id)))).filter(item => item !== null)
    const bytes = await exportHistoryArchive({ current: toBundle(current), snapshots: selected }, validation)
    const archive = await importHistoryArchive(bytes, validation), imported = await fromBundle(archive.current, validation)
    const png = await exportPng(archive.current, { audience: 'gm', longEdgePx: 512 }), bitmap = await createImageBitmap(png), dimensions = { width: bitmap.width, height: bitmap.height }; bitmap.close()
    return { before, after: await verifyResourceClosure(imported), histories: archive.snapshots.length,
      historyClosure: await verifyResourceClosure(await fromBundle(archive.snapshots[0].bundle, validation)),
      protectionCount: snapshots.filter(item => item.kind === 'protection').length, sourceCount: Object.keys(imported.authoringSources).length,
      document: imported.document, bytes: bytes.length, png: { type: png.type, size: png.size, ...dimensions } }
  })
  expect(closure.before).toEqual(closure.after); expect(closure.sourceCount).toBe(1); expect(closure.histories).toBe(1)
  expect(closure.before.sourceTexts[0].original).toBe(SOURCE); expect(closure.historyClosure.sourceTexts[0].original).toBe(SOURCE)
  expect(closure.protectionCount).toBe(5); expect(closure.document).toEqual(restored.document)
  expect(closure.png).toMatchObject({ type: 'image/png', width: 512, height: 341 }); expect(closure.png.size).toBeGreaterThan(1000)
  expect(errors).toEqual([])
  await page.context().setOffline(false)
  for (const task of [single, group, first, canceled, second]) audit.push({ revision: task.snapshot.context!.revision, mode: task.authoring!.start.scope.artwork!.mode, targets: task.authoring!.start.scope.artwork!.targetIds, cost: task.authoring!.state.operationCost })
  await info.attach('progressive-assimilation.json', { body: JSON.stringify({ provider: 'deterministic; no paid model', audit, finalRevision: restored.document.revision, closure }), contentType: 'application/json' })
})

test('frozen artwork rejects a locked member and provider range escape without touching the project', async ({ page }, info) => {
  test.setTimeout(120_000)
  await create(page)
  await commands(page, [{ type: 'createPrefab', id: 'assim-group', definitionId: 'assim-fixed', name: '锁定测试组合', ids: ['assim-a', 'assim-b'], anchorMm: { x: 3500, y: 2500 } }])
  await scope(page, 'prefab', ['assim-group'])
  await commands(page, [{ type: 'setEditLock', kind: 'prop', id: 'assim-b', locked: true }])
  const locked = await read(page), taskCount = store.list('maintainer').length
  await pane(page).getByLabel('AI 草稿要求', { exact: true }).fill('组合：协调当前成员。')
  await pane(page).getByRole('button', { name: '创建独立草稿任务', exact: true }).click()
  await expect(pane(page).getByRole('alert')).toContainText('锁定')
  expect(await read(page)).toEqual(locked); expect(store.list('maintainer')).toHaveLength(taskCount)
  await commands(page, [{ type: 'setEditLock', kind: 'prop', id: 'assim-b', locked: false }])
  await scope(page, 'range', ['range-a'], { x: 5000, y: 1000, width: 3000, height: 5000 })
  const before = await read(page)
  await pane(page).getByLabel('AI 草稿要求', { exact: true }).fill('越权探针：尝试修改未选同素材对象。')
  await pane(page).getByRole('button', { name: '创建独立草稿任务', exact: true }).click()
  await expect(panel(page).getByLabel('AI 工具进度')).toContainText('失败')
  await expect(panel(page).locator('.ai-task-heading > strong')).toHaveText('已完成', { timeout: 30_000 })
  expect(await read(page)).toEqual(before)
  await expect(pane(page).getByRole('button', { name: '保护当前并一次采用 AI 草稿', exact: true })).toHaveCount(0)
  // Inject a byte read failure into an independent bundle; no persisted resource is removed.
  const missingResource = await page.evaluate(async () => {
    const wp = '/src/editor/main/Workbench.tsx', pp = '/src/application/workspace/project.ts', rp = '/src/platform/browser/runtime.ts', vp = '/src/shared/project/resources.ts'
    const { nativeWorkspace } = await import(wp) as typeof import('../src/editor/main/Workbench')
    const { toBundle } = await import(pp) as typeof import('../src/application/workspace/project')
    const { validation } = await import(rp) as typeof import('../src/platform/browser/runtime')
    const { validateProjectBundle } = await import(vp) as typeof import('../src/shared/project/resources')
    const bundle = toBundle(nativeWorkspace.getState().project!), prop = bundle.project.document.props['range-a']
    if (prop.appearance.kind !== 'image') throw new Error('Expected a real image asset')
    const missing = bundle.project.document.assets[prop.appearance.assetId].sha256
    try { await validateProjectBundle({ project: bundle.project, resources: { async read(hash) { if (hash === missing) throw new Error('Injected missing member bitmap'); return bundle.resources.read(hash) } } }, validation); return false }
    catch (error) { return String(error).includes('Injected missing member bitmap') }
  })
  expect(missingResource).toBe(true); expect(await read(page)).toEqual(before)
  await info.attach('artwork-guards.json', { body: JSON.stringify({ provider: 'deterministic; no paid model', lockedMemberRejectedBeforeNetwork: true, laterFailedOperationKeptEarlierMemberUnchanged: true, missingMemberBitmapRejected: missingResource, outsideTargetRejectedByTool: true, unchangedRevision: before.document.revision }), contentType: 'application/json' })
})
