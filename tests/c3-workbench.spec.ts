import { test, expect, type Page, type TestInfo } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import type { WorkspaceV5 } from '../src/editor/v5/workspace'
import type { SceneRepositoryV5 } from '../src/io/v5/storage'
import type { CompleteProjectV5 } from '../src/io/v5/types'
type Dev = { workspace: WorkspaceV5; repository: SceneRepositoryV5 }
async function state(page: Page) { return page.evaluate(() => { const { project, status } = (Reflect.get(window, '__sceneweaveCompositionDev') as Dev).workspace.getState(); return { document: structuredClone(project!.document), appearance: structuredClone(project!.appearance), status } }) }
async function settled(page: Page) { await expect(page.locator('.asset-save')).toHaveText('本地已保存'); await expect(page.locator('.asset-busy')).toHaveCount(0); await expect(page.locator('.asset-map-wrap')).toHaveAttribute('aria-busy', 'false') }
async function seed(page: Page) {
  await page.goto('/#composition'); await expect(page.getByTestId('composition-workbench')).toBeVisible()
  await page.evaluate(async () => { const path = '/tests/c3-fixtures.ts'; const { createC3ProjectV5 } = await import(path) as typeof import('./c3-fixtures'); await (Reflect.get(window, '__sceneweaveCompositionDev') as Dev).workspace.adoptNew(await createC3ProjectV5()) })
  await settled(page)
}
async function choose(page: Page, id: string) {
  await page.getByRole('tab', { name: '场景', exact: true }).click()
  await page.getByRole('group', { name: '场景对象分类', exact: true }).getByRole('button', { name: '物件', exact: true }).click()
  await page.getByLabel('搜索场景物件', { exact: true }).fill(id); await page.locator(`[data-entity-id="${id}"]`).click()
}
async function adopt(page: Page) { await page.getByRole('button', { name: '采用组件修改', exact: true }).click(); await expect(page.getByRole('button', { name: '采用组件修改', exact: true })).toHaveCount(0); await settled(page) }
async function adjust(page: Page, scope: 'targets' | 'layer', kind: 'tint' | 'brightness' | 'opacity', value: string) {
  await page.getByLabel('外观调整范围', { exact: true }).selectOption(scope); await page.getByLabel('外观调整项目', { exact: true }).selectOption(kind)
  await page.getByLabel(kind === 'tint' ? '外观调色颜色' : kind === 'opacity' ? '外观透明度' : '外观亮度', { exact: true }).fill(value)
  const before = (await state(page)).document.revision
  await page.getByRole('button', { name: '预览外观调整', exact: true }).click(); await expect(page.getByRole('button', { name: '采用组件修改', exact: true })).toBeVisible(); expect((await state(page)).document.revision).toBe(before)
  await adopt(page); expect((await state(page)).document.revision).toBe(before + 1)
}
async function evidence(info: TestInfo, name: string, value: unknown) { await info.attach(name, { body: JSON.stringify(value, null, 2), contentType: 'application/json' }) }

test('C3 UI: fixed source, independent override removal, continuous layer and one-step undo', async ({ page }, info) => {
  await seed(page); await choose(page, 'c3-left'); const initial = await state(page), fixedSource = initial.appearance.propSources['c3-left']
  await adjust(page, 'targets', 'tint', '#80ff80'); let result = await state(page)
  expect(result.appearance.propSources['c3-left']).toBe(fixedSource); expect(result.document.props['c3-left'].appearance.kind).toBe('image'); expect(result.document.props['c3-left'].footprintMm).toEqual(initial.document.props['c3-left'].footprintMm)
  expect(result.document.props['c3-right']).toEqual(initial.document.props['c3-right']); expect(result.document.props['c3-secret'].visibility).toBe('gm')
  await adjust(page, 'layer', 'opacity', '0.6'); result = await state(page); expect(result.document.props['c3-left'].appearance.opacity).toBe(.6); expect(result.document.props['c3-right'].appearance.opacity).toBe(.6)
  await adjust(page, 'targets', 'opacity', '0.8'); result = await state(page); expect(result.document.props['c3-left'].appearance.opacity).toBe(.8); expect(result.document.props['c3-right'].appearance.opacity).toBe(.6)
  await page.getByRole('button', { name: '移除透明度 c3-left', exact: true }).click(); await adopt(page); expect((await state(page)).document.props['c3-left'].appearance.opacity).toBe(.6)
  const revision = (await state(page)).document.revision; await page.getByRole('button', { name: '撤销素材编辑', exact: true }).click(); await settled(page); result = await state(page); expect(result.document.revision).toBe(revision + 1); expect(result.document.props['c3-left'].appearance.opacity).toBe(.8)
  await evidence(info, 'c3-override-layer-undo', { fixedSource, initial, final: result }); await page.screenshot({ path: info.outputPath('c3-appearance-desktop.png'), fullPage: true })
})

test('C3 UI: custom image import is previewed and packaged with license; search uses tags', async ({ page }, info) => {
  await seed(page); await page.getByRole('tab', { name: '素材库', exact: true }).click(); await page.getByText('导入自有素材', { exact: true }).click()
  const bytes = await page.evaluate(async () => { const path = '/tests/c3-fixtures.ts'; const { c3ImageBlob } = await import(path) as typeof import('./c3-fixtures'); return Array.from(new Uint8Array(await (await c3ImageBlob()).arrayBuffer())) })
  await page.getByLabel('素材图片', { exact: true }).setInputFiles({ name: 'c3-own.png', mimeType: 'image/png', buffer: Buffer.from(bytes) }); await page.getByLabel('素材名称', { exact: true }).fill('自绘苔石'); await page.getByLabel('素材标签', { exact: true }).fill('苔石,冬季'); await page.getByLabel('素材署名与来源', { exact: true }).fill('Sceneweave original integration fixture'); await page.getByLabel('素材完整许可', { exact: true }).fill('CC0-1.0. Original integration test image.'); await page.getByLabel('确认素材可嵌入工程', { exact: true }).check()
  const count = Object.keys((await state(page)).document.propDefinitions).length; await page.getByRole('button', { name: '预览素材导入', exact: true }).click(); await expect(page.getByRole('button', { name: '采用组件修改', exact: true })).toBeVisible(); expect(Object.keys((await state(page)).document.propDefinitions)).toHaveLength(count); await adopt(page)
  await page.getByLabel('搜索组件素材', { exact: true }).fill('冬季'); await expect(page.locator('.composition-catalog article')).toHaveCount(1); await page.getByRole('button', { name: '查看素材 自绘苔石', exact: true }).click(); await page.getByText('完整许可与署名', { exact: true }).click(); await expect(page.locator('.composition-source pre')).toContainText('CC0-1.0')
  const pending = page.waitForEvent('download'); await page.getByRole('button', { name: '完整工程', exact: true }).click(); const download = await pending; const path = await download.path(); expect(path).toBeTruthy(); const file = await readFile(path!); expect(file.length).toBeGreaterThan(1000)
  await evidence(info, 'c3-ui-import', { definitions: (await state(page)).document.propDefinitions, archiveBytes: file.length }); await page.screenshot({ path: info.outputPath('c3-library.png'), fullPage: true })
})

test('C3 UI: save private selection as fixed prefab, duplicate actual edits, unpack safely', async ({ page }, info) => {
  await seed(page); await choose(page, 'c3-secret'); await page.getByLabel('新组合名称', { exact: true }).fill('秘密叶片组合'); await page.getByRole('button', { name: '预览保存组合 · 1 件', exact: true }).click(); await adopt(page)
  let current = await state(page); const groupId = Object.keys(current.document.prefabInstances)[0]; expect(current.document.prefabInstances[groupId].visibility).toBe('gm')
  await page.getByRole('group', { name: '场景对象分类', exact: true }).getByRole('button', { name: '组合', exact: true }).click(); await page.locator(`[data-entity-id="${groupId}"]`).click(); await page.getByRole('button', { name: '预览复制整个组合', exact: true }).click(); await adopt(page); current = await state(page)
  expect(Object.keys(current.document.prefabInstances)).toHaveLength(2); const duplicate = Object.values(current.document.prefabInstances).find(item => item.id !== groupId)!; expect(duplicate.visibility).toBe('gm'); const duplicateProp = Object.values(duplicate.members)[0].propId!; expect(current.document.props[duplicateProp].visibility).toBe('gm')
  await page.getByRole('button', { name: '预览拆开组合', exact: true }).click(); await adopt(page); current = await state(page); expect(current.document.prefabInstances[groupId]).toBeUndefined(); expect(current.document.props['c3-secret'].visibility).toBe('gm'); await evidence(info, 'c3-private-prefab', current)
})

test('C3 UI: scoped effective appearance restore preserves current layer and unselected edits', async ({ page }, info) => {
  await seed(page); await choose(page, 'c3-left'); await adjust(page, 'targets', 'tint', '#80ff80')
  await page.getByRole('tab', { name: '历史', exact: true }).click(); await page.getByRole('button', { name: '新建命名快照', exact: true }).click(); await page.getByLabel('命名快照名称', { exact: true }).fill('C3 外观基线'); await page.getByRole('button', { name: '保存快照', exact: true }).click(); await settled(page)
  await adjust(page, 'layer', 'brightness', '0.6'); await adjust(page, 'targets', 'tint', '#ff8080')
  const before = await state(page); await page.getByRole('button', { name: '查看快照 C3 外观基线', exact: true }).click(); await page.getByLabel('局部恢复模式', { exact: true }).selectOption('appearance'); await page.getByRole('checkbox', { name: '恢复物件 c3-left', exact: true }).check(); await page.getByRole('button', { name: '预览局部恢复 · 1 件', exact: true }).click(); await expect(page.getByLabel('局部恢复差异', { exact: true })).toBeVisible(); expect((await state(page)).document.revision).toBe(before.document.revision)
  await page.getByRole('button', { name: '保护当前并采用', exact: true }).click(); await settled(page); const after = await state(page); expect(after.appearance.layerAdjustments).toEqual(before.appearance.layerAdjustments); expect(after.document.props['c3-right']).toEqual(before.document.props['c3-right']); expect(after.document.revision).toBe(before.document.revision + 1)
  const protection = await page.evaluate(async () => { const { repository, workspace } = Reflect.get(window, '__sceneweaveCompositionDev') as Dev; return (await repository.listNamedSnapshots(workspace.getState().project!.document.sceneId)).filter(item => item.kind === 'protection') }); expect(protection).toHaveLength(1); await evidence(info, 'c3-effective-restore', { before, after, protection })
})

test('C3 UI: locked targets reject whole appearance batch; preview cancel keeps revision', async ({ page }, info) => {
  await seed(page); await choose(page, 'c3-left'); await page.evaluate(async () => { const { workspace } = Reflect.get(window, '__sceneweaveCompositionDev') as Dev; await workspace.execute([{ type: 'setEditLock', kind: 'prop', id: 'c3-left', locked: true }]) }); await settled(page)
  const before = await state(page); await page.getByLabel('外观调整项目', { exact: true }).selectOption('opacity'); await page.getByLabel('外观透明度', { exact: true }).fill('0.2'); await page.getByRole('button', { name: '预览外观调整', exact: true }).click(); await expect(page.locator('.asset-notice')).toContainText('锁'); expect(await state(page)).toEqual(before); await expect(page.getByRole('button', { name: '采用组件修改', exact: true })).toHaveCount(0)
  await choose(page, 'c3-right'); await page.getByRole('button', { name: '预览外观调整', exact: true }).click(); await expect(page.getByRole('button', { name: '采用组件修改', exact: true })).toBeVisible(); await page.getByRole('button', { name: '取消组件预览', exact: true }).click(); expect((await state(page)).document.revision).toBe(before.document.revision); await evidence(info, 'c3-lock-cancel', await state(page))
})

test('C3 entry migrates current V4 as independent copy and preserves exact original and old named history', async ({ page }, info) => {
  await page.goto('/#history'); await expect(page.getByTestId('history-workbench')).toBeVisible()
  const before = await page.evaluate(async () => {
    const fixturePath = '/tests/c3-fixtures.ts', identityPath = '/src/core/v4/identity.ts', exportPath = '/src/io/v4/project-file.ts'
    const { createC3ProjectV5 } = await import(fixturePath) as typeof import('./c3-fixtures'), { createHistoryIdentityV4 } = await import(identityPath) as typeof import('../src/core/v4/identity'), { hashValidatedProjectV4 } = await import(exportPath) as typeof import('../src/io/v4/project-file')
    const candidate = await createC3ProjectV5({ title: 'C3 迁移来源' }), { appearance: _appearance, historyIdentity: _identity, migrationSource: _source, ...rest } = candidate
    const project = { ...rest, historyIdentity: createHistoryIdentityV4(candidate.document) }
    const old = Reflect.get(window, '__sceneweaveHistoryDev') as { workspace: import('../src/editor/v4/workspace').WorkspaceV4; repository: import('../src/io/v4/storage').SceneRepositoryV4 }
    await old.workspace.adoptNew(project); await old.workspace.createNamedSnapshot('保留旧仓库快照'); await old.workspace.flush()
    const hash = await hashValidatedProjectV4(old.workspace.getState().project!)
    return { hash, sceneId: project.document.sceneId, propTokens: project.historyIdentity.propTokens }
  })
  await settled(page); await page.getByRole('button', { name: '组件与外观', exact: true }).click(); const modal = page.getByRole('dialog', { name: '确认打开组件工程', exact: true }); await expect(modal).toContainText('原自动、命名和保护历史继续留在原仓库'); await modal.getByRole('button', { name: '保存并打开副本', exact: true }).click(); await expect(modal).toHaveCount(0); await settled(page)
  const result = await page.evaluate(async before => {
    const { workspace, repository } = Reflect.get(window, '__sceneweaveCompositionDev') as Dev, project = workspace.getState().project!
    const bytes = new Uint8Array(await project.migrationSource!.original.arrayBuffer()); const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map(value => value.toString(16).padStart(2, '0')).join('')
    const path = '/src/io/v4/storage.ts', { SceneRepositoryV4 } = await import(path) as typeof import('../src/io/v4/storage'); const old = new SceneRepositoryV4(); await old.open()
    const ioPath = '/src/io/v4/project-file.ts', { importProjectV4, hashValidatedProjectV4 } = await import(ioPath) as typeof import('../src/io/v4/project-file'); const originalContentHash = await hashValidatedProjectV4(await importProjectV4(project.migrationSource!.original))
    try { return { hash, declaredHash: project.migrationSource!.sourceHash, originalContentHash, sceneId: project.document.sceneId, revision: project.document.revision, tokens: project.historyIdentity.propTokens, oldProject: !!await old.load(before.sceneId), oldHistory: await old.listNamedSnapshots(before.sceneId), newHistory: await repository.listNamedSnapshots(project.document.sceneId) } } finally { old.close() }
  }, before)
  expect(result.hash).toBe(result.declaredHash); expect(result.originalContentHash).toBe(before.hash); expect(result.sceneId).not.toBe(before.sceneId); expect(result.revision).toBe(0); expect(result.tokens).toEqual(before.propTokens); expect(result.oldProject).toBe(true); expect(result.oldHistory.map(item => item.name)).toEqual(['保留旧仓库快照']); expect(result.newHistory).toEqual([]); await evidence(info, 'c3-v4-copy-entry', { before, result })
})

test('C3 V5 layer movement re-resolves appearance and keeps source, identity and physical semantics', async ({ page }, info) => {
  await seed(page); await choose(page, 'c3-left'); await adjust(page, 'layer', 'tint', '#80ff80'); const before = await state(page)
  await page.evaluate(async () => { const { workspace } = Reflect.get(window, '__sceneweaveCompositionDev') as Dev; await workspace.execute([{ type: 'createLayer', id: 'c3-destination', floorId: 'blank-floor', name: '无调色层' }]); await workspace.execute([{ type: 'moveEntitiesToLayer', ids: ['c3-left'], layerId: 'c3-destination' }]); await workspace.flush() }); await settled(page); const after = await state(page)
  expect(after.document.entityLayers['c3-left']).toBe('c3-destination'); expect(after.appearance.propSources['c3-left']).toBe(before.appearance.propSources['c3-left']); expect(after.document.props['c3-right']).toEqual(before.document.props['c3-right']); expect(after.document.props['c3-left'].footprintMm).toEqual(before.document.props['c3-left'].footprintMm); expect(after.document.props['c3-left'].supportRef).toEqual(before.document.props['c3-left'].supportRef)
  expect(after.document.props['c3-left'].appearance).not.toEqual(before.document.props['c3-left'].appearance); await evidence(info, 'c3-layer-move', { before, after })
})

test('C3 returning to history consumes the old V3 migration handoff once', async ({ page }, info) => {
  await page.goto('/#layers'); await expect(page.getByTestId('layer-workbench')).toBeVisible()
  await page.evaluate(async () => {
    const path = '/tests/c3-fixtures.ts', { createC3ProjectV5 } = await import(path) as typeof import('./c3-fixtures'), full = await createC3ProjectV5()
    const { document, assets, licenses, licenseBindings } = full
    const legacy = Reflect.get(window, '__sceneweaveLayersDev') as { workspace: import('../src/editor/v3/workspace').WorkspaceV3 }
    await legacy.workspace.adoptNew({ document, assets, licenses, licenseBindings })
  })
  await settled(page); await page.getByRole('button', { name: '命名快照与恢复', exact: true }).click()
  const oldDialog = page.getByRole('dialog', { name: '确认打开历史工程', exact: true }); await expect(oldDialog).toBeVisible(); await oldDialog.getByRole('button', { name: '保存并打开副本', exact: true }).click(); await expect(oldDialog).toHaveCount(0); await settled(page)
  const oldId = await page.evaluate(() => (Reflect.get(window, '__sceneweaveHistoryDev') as { workspace: import('../src/editor/v4/workspace').WorkspaceV4 }).workspace.getState().project!.document.sceneId)
  await page.getByRole('button', { name: '组件与外观', exact: true }).click(); const dialog = page.getByRole('dialog', { name: '确认打开组件工程', exact: true }); await dialog.getByRole('button', { name: '保存并打开副本', exact: true }).click(); await expect(dialog).toHaveCount(0); await settled(page)
  await page.locator('.asset-brand').click(); await expect(page.getByTestId('history-workbench')).toBeVisible(); await settled(page)
  await expect(page.getByRole('dialog')).toHaveCount(0); expect(await page.evaluate(() => (Reflect.get(window, '__sceneweaveHistoryDev') as { workspace: import('../src/editor/v4/workspace').WorkspaceV4 }).workspace.getState().project!.document.sceneId)).toBe(oldId)
  await evidence(info, 'c3-one-shot-handoff-return', { preservedHistorySceneId: oldId, noRepeatedMigrationDialog: true })
})
