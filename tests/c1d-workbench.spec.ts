import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import type { SceneDocumentV3 } from '../src/core/v3/types'
import type { WorkspaceV4 } from '../src/editor/v4/workspace'
import type { SceneRepositoryV4 } from '../src/io/v4/storage'

type HistoryDev = { workspace: WorkspaceV4; repository: SceneRepositoryV4 }
async function scene(page: Page): Promise<SceneDocumentV3> {
  return page.evaluate(() => structuredClone((Reflect.get(window, '__sceneweaveHistoryDev') as HistoryDev).workspace.getState().project!.document))
}
async function settled(page: Page) {
  await expect(page.locator('.asset-save')).toHaveText('本地已保存')
  await expect(page.locator('.asset-map-wrap')).toHaveAttribute('aria-busy', 'false')
  await expect(page.locator('.asset-busy')).toHaveCount(0)
}
async function history(page: Page) { await page.getByRole('tab', { name: '历史', exact: true }).click() }
async function seed(page: Page, count = 2) {
  await expect(page.getByTestId('history-workbench')).toBeVisible()
  const result = await page.evaluate(async count => {
    const fixturePath = '/src/core/v3/test-fixtures.ts', identityPath = '/src/core/v4/identity.ts'
    const fixtures = await import(fixturePath) as typeof import('../src/core/v3/test-fixtures')
    const { createHistoryIdentityV4 } = await import(identityPath) as typeof import('../src/core/v4/identity')
    const { workspace } = Reflect.get(window, '__sceneweaveHistoryDev') as HistoryDev
    const document = fixtures.layerSceneV3(), layerId = document.entityLayers.item
    document.sceneId = crypto.randomUUID(); document.title = `历史交互 ${count} 件`
    document.assets = {}; document.propDefinitions = {}
    document.props = {}; delete document.entityLayers.item
    for (let i = 0; i < count; i++) {
      const id = `item-${String(i).padStart(3, '0')}`
      document.props[id] = fixtures.symbolPropV3(id, 2000 + i % 20 * 700, 2000 + Math.floor(i / 20) * 700)
      document.entityLayers[id] = layerId
    }
    await workspace.adoptNew({ document, historyIdentity: createHistoryIdentityV4(document), assets: {}, licenses: {}, licenseBindings: [] })
    return { ids: Object.keys(document.props), sceneId: document.sceneId }
  }, count)
  await settled(page)
  return result
}
async function chooseObject(page: Page, id: string) {
  await page.getByRole('tab', { name: '场景', exact: true }).click()
  await page.getByRole('group', { name: '场景对象分类', exact: true }).getByRole('button', { name: '物件', exact: true }).click()
  await page.getByLabel('搜索场景物件', { exact: true }).fill(id)
  await page.locator(`[data-entity-id="${id}"]`).click()
}
async function number(page: Page, label: string, value: number) {
  const input = page.getByRole('spinbutton', { name: label, exact: true })
  await input.fill(String(value)); await input.press('Tab')
}
async function named(page: Page, name: string) {
  await history(page)
  await page.getByRole('button', { name: '新建命名快照', exact: true }).click()
  await page.getByLabel('命名快照名称', { exact: true }).fill(name)
  await page.getByRole('button', { name: '保存快照', exact: true }).click()
  await expect(page.getByRole('button', { name: `查看快照 ${name}`, exact: true })).toBeVisible()
  await settled(page)
}
async function snapshots(page: Page) {
  return page.evaluate(async () => {
    const { workspace, repository } = Reflect.get(window, '__sceneweaveHistoryDev') as HistoryDev
    return repository.listNamedSnapshots(workspace.getState().project!.document.sceneId)
  })
}
async function evidence(info: TestInfo, name: string, value: unknown) {
  await info.attach(name, { body: JSON.stringify(value, null, 2), contentType: 'application/json' })
}
async function download(page: Page, label: string) {
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: label, exact: true }).click()
  const result = await pending, location = await result.path()
  if (!location) throw new Error(`No actual download for ${label}.`)
  await expect(page.locator('.asset-busy')).toHaveCount(0)
  return { bytes: await readFile(location), name: result.suggestedFilename() }
}
async function injectWriteFailure(page: Page, tableName: 'namedSnapshots' | 'protectionSnapshots' | 'snapshots') {
  await page.evaluate(tableName => {
    const { repository } = Reflect.get(window, '__sceneweaveHistoryDev') as HistoryDev
    const table = Reflect.get(repository, 'db').table(tableName), original = table.add
    table.add = async () => { throw new DOMException(`C1d simulated ${tableName} write failure`, 'QuotaExceededError') }
    Reflect.set(window, '__c1dWriteFailure', { restore: () => { table.add = original } })
  }, tableName)
}
async function restoreWrites(page: Page) {
  await page.evaluate(() => {
    Reflect.get(window, '__c1dWriteFailure')?.restore()
    Reflect.deleteProperty(window, '__c1dWriteFailure')
  })
}

test('C1d preview and cancel preserve the scene; applying protects the current state and restores only the explicit scope', async ({ page }, info) => {
  test.slow()
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await page.goto('/#history'); const { ids } = await seed(page)
  const initial = await scene(page)
  await named(page, '位置初稿')
  expect((await scene(page)).revision).toBe(initial.revision)
  await chooseObject(page, ids[0]); await number(page, '物件 X', 4400); await number(page, '物件旋转', 35)
  await chooseObject(page, ids[1]); await number(page, '物件 X', 7300); await settled(page)
  const before = await scene(page)
  await history(page)
  await page.getByRole('button', { name: '查看快照 位置初稿', exact: true }).click()
  await page.getByLabel('局部恢复模式', { exact: true }).selectOption('transform')
  await page.getByRole('checkbox', { name: `恢复物件 ${ids[0]}`, exact: true }).check()
  await page.getByText('完整恢复范围 · 1 件', { exact: true }).click()
  await expect(page.getByLabel('局部恢复完整 ID', { exact: true })).toHaveValue(ids[0])
  await page.getByRole('button', { name: '预览局部恢复 · 1 件', exact: true }).click()
  await expect(page.getByRole('status', { name: '局部恢复候选', exact: true })).toBeVisible()
  expect(await scene(page)).toEqual(before)
  const difference = page.locator(`[data-restore-change-id="${ids[0]}"]`)
  await expect(difference.locator('[data-change-field="positionMm"]')).toContainText('4400')
  await expect(difference.locator('[data-change-field="rotationDeg"]')).toContainText('35')
  await page.getByText('完整请求 ID', { exact: true }).click()
  await expect(page.getByLabel('待采用局部恢复 ID', { exact: true })).toHaveValue(ids[0])
  await info.attach('c1d-restore-preview.png', { body: await page.screenshot(), contentType: 'image/png' })
  await page.getByRole('button', { name: '取消局部恢复', exact: true }).click()
  expect(await scene(page)).toEqual(before); expect(await snapshots(page)).toHaveLength(1)
  await page.getByRole('button', { name: '预览局部恢复 · 1 件', exact: true }).click()
  await page.getByRole('button', { name: '保护当前并采用', exact: true }).click(); await settled(page)
  const adopted = await scene(page), entries = await snapshots(page)
  expect(adopted.revision).toBe(before.revision + 1)
  expect(adopted.props[ids[0]]).toEqual(initial.props[ids[0]])
  expect(adopted.props[ids[1]]).toEqual(before.props[ids[1]])
  const protection = await page.evaluate(async () => {
    const { workspace, repository } = Reflect.get(window, '__sceneweaveHistoryDev') as HistoryDev
    const sceneId = workspace.getState().project!.document.sceneId
    const saved = (await repository.listNamedSnapshots(sceneId)).find(item => item.kind === 'protection')!
    return (await repository.loadNamedSnapshot(saved.id, sceneId))!.project.document
  })
  expect(protection).toEqual(before)
  await page.getByRole('button', { name: '撤销素材编辑', exact: true }).click(); await settled(page)
  const undone = await scene(page)
  expect(undone.revision).toBe(adopted.revision + 1); expect(undone.props).toEqual(before.props)
  await page.getByRole('button', { name: '重做素材编辑', exact: true }).click(); await settled(page)
  const redone = await scene(page)
  expect(redone.revision).toBe(undone.revision + 1); expect(redone.props).toEqual(adopted.props)
  expect(errors).toEqual([])
  await evidence(info, 'c1d-scoped-restore.json', { before, adopted, entries, protection, undone, redone, errors })
})

test('C1d renames and deletes snapshots and downloads exactly the explicitly checked history subset', async ({ page }, info) => {
  test.slow()
  await page.goto('/#history'); const { ids } = await seed(page, 1)
  await named(page, '初稿')
  await chooseObject(page, ids[0]); await number(page, '物件旋转', 20); await settled(page); await named(page, '中稿')
  await chooseObject(page, ids[0]); await number(page, '物件 X', 5100); await settled(page); await named(page, '定稿')
  await page.getByRole('button', { name: '重命名快照 中稿', exact: true }).click()
  await page.getByLabel('修改快照名称', { exact: true }).fill('中稿留档')
  await page.getByRole('button', { name: '保存名称', exact: true }).click()
  await expect(page.getByRole('button', { name: '查看快照 中稿留档', exact: true })).toBeVisible()
  const entries = await snapshots(page), expected = entries.filter(item => item.name === '初稿' || item.name === '定稿').map(item => item.id).sort()
  await page.getByRole('checkbox', { name: '备份携带所选快照', exact: true }).check()
  await expect(page.getByRole('button', { name: '下载工程与所选历史 · 0 份', exact: true })).toBeDisabled()
  await page.getByRole('checkbox', { name: '备份快照 初稿', exact: true }).check()
  await page.getByRole('checkbox', { name: '备份快照 定稿', exact: true }).check()
  await expect(page.getByRole('checkbox', { name: '备份快照 中稿留档', exact: true })).not.toBeChecked()
  await page.getByText('完整备份范围 · 2 份', { exact: true }).click()
  const fullScope = await page.getByLabel('历史备份完整范围', { exact: true }).inputValue()
  for (const id of expected) expect(fullScope).toContain(id)
  const current = await scene(page), packed = await download(page, '下载工程与所选历史 · 2 份')
  const archive = await page.evaluate(async bytes => {
    const path = '/src/io/v4/project-file.ts', io = await import(path) as typeof import('../src/io/v4/project-file')
    const blob = new Blob([Uint8Array.from(bytes)]), archive = await io.importHistoryArchiveV4(blob)
    return { mode: await io.inspectPackageModeV4(blob), document: archive.project.document, snapshots: archive.snapshots.map(item => ({ id: item.id, name: item.name })) }
  }, Array.from(packed.bytes))
  expect(archive.mode).toBe('history'); expect(archive.document).toEqual(current)
  expect(archive.snapshots.map(item => item.id).sort()).toEqual(expected)
  await page.getByRole('button', { name: '删除快照 定稿', exact: true }).click()
  await page.getByRole('button', { name: '确认删除快照', exact: true }).click()
  await expect(page.getByRole('checkbox', { name: '备份快照 定稿', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '下载工程与所选历史 · 1 份', exact: true })).toBeEnabled()
  await page.getByRole('checkbox', { name: '备份携带所选快照', exact: true }).uncheck()
  const complete = await download(page, '下载完整工程')
  const completeMode = await page.evaluate(async bytes => {
    const path = '/src/io/v4/project-file.ts', io = await import(path) as typeof import('../src/io/v4/project-file')
    return io.inspectPackageModeV4(new Blob([Uint8Array.from(bytes)]))
  }, Array.from(complete.bytes))
  expect(completeMode).toBe('complete')
  await seed(page, 1); await history(page)
  await expect(page.getByRole('checkbox', { name: '备份携带所选快照', exact: true })).not.toBeChecked()
  await page.getByRole('checkbox', { name: '备份携带所选快照', exact: true }).check()
  await expect(page.getByRole('button', { name: '下载工程与所选历史 · 0 份', exact: true })).toBeDisabled()
  await expect(page.locator('[data-backup-snapshot-id]')).toHaveCount(0)
  await evidence(info, 'c1d-explicit-backup-subset.json', { entries, expected, fullScope, current, archive, completeMode, archiveBytes: packed.bytes.length })
})

test('C1d virtual history picker retains keyboard focus and exposes complete stable IDs', async ({ page }, info) => {
  await page.goto('/#history'); const { ids } = await seed(page, 180)
  await named(page, '大量独立物件')
  const before = await scene(page), picker = page.getByRole('group', { name: '历史独立物件列表', exact: true })
  await expect(picker).toHaveAttribute('data-total-rows', '180')
  expect(Number(await picker.getAttribute('data-mounted-rows'))).toBeLessThanOrEqual(12)
  await page.getByLabel('搜索历史物件', { exact: true }).focus(); await page.keyboard.press('ArrowDown')
  await expect(page.getByRole('checkbox', { name: `恢复物件 ${ids[0]}`, exact: true })).toBeFocused()
  await page.keyboard.press('End')
  const last = page.getByRole('checkbox', { name: `恢复物件 ${ids.at(-1)}`, exact: true })
  await expect(last).toBeFocused(); await page.keyboard.press('Space'); await expect(last).toBeChecked()
  await page.keyboard.press('PageUp')
  await expect(page.getByRole('checkbox', { name: `恢复物件 ${ids[173]}`, exact: true })).toBeFocused()
  await page.keyboard.press('Home')
  await expect(page.getByRole('checkbox', { name: `恢复物件 ${ids[0]}`, exact: true })).toBeFocused()
  await page.keyboard.press('PageDown')
  await expect(page.getByRole('checkbox', { name: `恢复物件 ${ids[6]}`, exact: true })).toBeFocused()
  await page.keyboard.press('ArrowUp')
  await expect(page.getByRole('checkbox', { name: `恢复物件 ${ids[5]}`, exact: true })).toBeFocused()
  await picker.evaluate(node => { node.scrollTop = 120 * 48 })
  await expect(picker).toBeFocused()
  await page.keyboard.press('End'); await expect(last).toBeFocused()
  expect(await picker.locator('[data-history-prop-id]').count()).toBeLessThanOrEqual(12)
  await page.getByText('完整恢复范围 · 1 件', { exact: true }).click()
  await expect(page.getByLabel('局部恢复完整 ID', { exact: true })).toHaveValue(ids.at(-1)!)
  expect(await scene(page)).toEqual(before)
  await evidence(info, 'c1d-history-picker.json', { totalRows: ids.length, mountedRows: await picker.locator('[data-history-prop-id]').count(), selectedId: ids.at(-1), revision: before.revision })
})

test('C1d complete-entity recreation explicitly reviews newly visible player content', async ({ page }, info) => {
  await page.goto('/#history'); const { ids } = await seed(page, 1)
  const initial = await scene(page); await named(page, '公开陈设')
  await chooseObject(page, ids[0]); await page.getByRole('button', { name: '删除物件', exact: true }).click(); await settled(page)
  const before = await scene(page)
  await history(page); await page.getByRole('button', { name: '查看快照 公开陈设', exact: true }).click()
  await page.getByRole('checkbox', { name: `恢复物件 ${ids[0]}`, exact: true }).check()
  await expect(page.getByRole('button', { name: '预览局部恢复 · 1 件', exact: true })).toBeDisabled()
  await expect(page.getByText(/所选含 1 件已删除物件/)).toBeVisible()
  await page.getByLabel('局部恢复模式', { exact: true }).selectOption('entity')
  await page.getByRole('button', { name: '预览局部恢复 · 1 件', exact: true }).click()
  await expect(page.getByText('恢复后 1 件物件将对玩家可见', { exact: true })).toBeVisible()
  await expect(page.locator(`[data-restore-change-id="${ids[0]}"] [data-player-visibility="visible"]`)).toHaveText('玩家视图：隐藏 → 可见')
  await page.getByText('新增玩家可见范围 · 1 件', { exact: true }).click()
  await expect(page.getByLabel('恢复后新增玩家可见 ID', { exact: true })).toHaveValue(ids[0])
  await expect(page.getByTestId(`history-lock-review-${ids[0]}`)).toContainText('重建物件未锁定')
  expect(await scene(page)).toEqual(before)
  await info.attach('c1d-player-visibility-review.png', { body: await page.screenshot(), contentType: 'image/png' })
  await page.getByRole('button', { name: '保护当前并采用', exact: true }).click(); await settled(page)
  const after = await scene(page)
  expect(after.props[ids[0]]).toEqual(initial.props[ids[0]])
  expect(after.revision).toBe(before.revision + 1)
  await evidence(info, 'c1d-player-visibility-review.json', { id: ids[0], before, after })
})

test('C1d injected IndexedDB repository write failures roll back named and protection metadata and preserve both scene branches', async ({ page }, info) => {
  test.slow()
  await page.goto('/#history'); const { ids } = await seed(page, 1)
  await named(page, '故障前基线')
  await chooseObject(page, ids[0]); await number(page, '物件旋转', 30); await settled(page)
  const before = await scene(page)
  const durable = () => page.evaluate(async () => {
    const { workspace, repository } = Reflect.get(window, '__sceneweaveHistoryDev') as HistoryDev, sceneId = workspace.getState().project!.document.sceneId
    return { document: (await repository.load(sceneId))!.document, usage: await repository.usage(sceneId), snapshots: await repository.listNamedSnapshots(sceneId) }
  })
  const stored = await durable()
  try {
    await history(page); await injectWriteFailure(page, 'namedSnapshots')
    await page.getByRole('button', { name: '新建命名快照', exact: true }).click()
    await page.getByLabel('命名快照名称', { exact: true }).fill('不应出现的快照')
    await page.getByRole('button', { name: '保存快照', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('C1d simulated namedSnapshots write failure')
    expect(await scene(page)).toEqual(before); expect(await durable()).toEqual(stored)
    await restoreWrites(page); await page.getByRole('button', { name: '取消创建快照', exact: true }).click()
    await page.getByRole('button', { name: '查看快照 故障前基线', exact: true }).click()
    await page.getByLabel('局部恢复模式', { exact: true }).selectOption('transform')
    await page.getByRole('checkbox', { name: `恢复物件 ${ids[0]}`, exact: true }).check()
    await page.getByRole('button', { name: '预览局部恢复 · 1 件', exact: true }).click()
    await injectWriteFailure(page, 'protectionSnapshots')
    await page.getByRole('button', { name: '保护当前并采用', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('C1d simulated protectionSnapshots write failure')
    await expect(page.getByRole('status', { name: '局部恢复候选', exact: true })).toHaveCount(0)
    expect(await scene(page)).toEqual(before); expect(await durable()).toEqual(stored)
    await restoreWrites(page); await injectWriteFailure(page, 'snapshots')
    await chooseObject(page, ids[0]); await number(page, '物件 X', 5900)
    await expect(page.locator('.asset-save')).toHaveText('保存失败')
    const branch = await scene(page)
    expect(branch.revision).toBe(before.revision + 1); expect(branch.props[ids[0]].positionMm.x).toBe(5900)
    expect(await durable()).toEqual(stored)
    await history(page); await page.getByRole('button', { name: '新建命名快照', exact: true }).click()
    await page.getByLabel('命名快照名称', { exact: true }).fill('未保存修订不建快照')
    await page.getByRole('button', { name: '保存快照', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('C1d simulated snapshots write failure')
    expect(await scene(page)).toEqual(branch); expect(await durable()).toEqual(stored)
    await restoreWrites(page)
    await page.getByRole('button', { name: '重试保存', exact: true }).click(); await settled(page)
    expect((await durable()).document).toEqual(branch)
    expect(await snapshots(page)).toHaveLength(1)
    await evidence(info, 'c1d-write-failure-rollback.json', { before, stored, branch, recovered: await durable(), realQuotaExhaustionTested: false })
  } finally { await restoreWrites(page) }
})

test('C1d v3 file migration requires adoption, retains exact source bytes and rejects a strict-schema violation without changing the current project', async ({ page }, info) => {
  test.slow()
  await page.goto('/#history'); await seed(page, 1)
  const current = await scene(page)
  const source = await page.evaluate(async () => {
    const fixturePath = '/src/core/v3/test-fixtures.ts', filePath = '/src/io/v3/project-file.ts', storagePath = '/src/io/v3/storage.ts'
    const { layerSceneV3 } = await import(fixturePath) as typeof import('../src/core/v3/test-fixtures')
    const io = await import(filePath) as typeof import('../src/io/v3/project-file')
    const { SceneRepositoryV3 } = await import(storagePath) as typeof import('../src/io/v3/storage')
    const document = layerSceneV3(); document.sceneId = crypto.randomUUID(); document.title = '完整 v3 来源'
    document.assets = {}; document.propDefinitions = {}
    const project = { document, assets: {}, licenses: {}, licenseBindings: [] }, repository = new SceneRepositoryV3('c1d-ui-migration-source')
    try {
      await repository.save(project, null)
      const bytes = new Uint8Array(await (await io.exportProjectV3(project)).arrayBuffer())
      return { document, bytes: Array.from(bytes), saved: (await repository.load(document.sceneId))!.document }
    } finally { repository.close() }
  })
  const file = page.getByLabel('选择完整历史工程', { exact: true })
  await file.setInputFiles({ name: 'source-v3.sceneweave', mimeType: 'application/octet-stream', buffer: Buffer.from(source.bytes) })
  const dialog = page.getByRole('dialog', { name: '确认打开历史工程', exact: true })
  await expect(dialog).toBeVisible(); expect(await scene(page)).toEqual(current)
  await dialog.getByRole('button', { name: '取消', exact: true }).click()
  expect(await scene(page)).toEqual(current)
  await file.setInputFiles({ name: 'source-v3.sceneweave', mimeType: 'application/octet-stream', buffer: Buffer.from(source.bytes) })
  await expect(dialog).toBeVisible(); await dialog.getByRole('button', { name: '保存并打开副本', exact: true }).click(); await settled(page)
  const migrated = await scene(page)
  expect(migrated.schemaVersion).toBe(3); expect(migrated.sceneId).not.toBe(source.document.sceneId); expect(migrated.revision).toBe(0)
  for (const key of ['props', 'userLayers', 'entityLayers', 'floors', 'rooms', 'walls', 'terrainAreas'] as const) expect(migrated[key]).toEqual(source.document[key])
  const original = await download(page, '下载 v3 迁移原件')
  expect(Array.from(original.bytes)).toEqual(source.bytes)
  const sourceAfter = await page.evaluate(async sceneId => {
    const path = '/src/io/v3/storage.ts', { SceneRepositoryV3 } = await import(path) as typeof import('../src/io/v3/storage')
    const repository = new SceneRepositoryV3('c1d-ui-migration-source')
    try { return (await repository.load(sceneId))!.document } finally { repository.close() }
  }, source.document.sceneId)
  expect(sourceAfter).toEqual(source.saved)
  const files = unzipSync(Uint8Array.from(source.bytes)), malformed = JSON.parse(strFromU8(files['scene.json']))
  malformed.unexpectedHistory = { snapshots: ['must-not-be-accepted'] }
  files['scene.json'] = strToU8(JSON.stringify(malformed))
  const manifest = JSON.parse(strFromU8(files['manifest.json'])), entry = manifest.entries.find((entry: { path: string }) => entry.path === 'scene.json')
  entry.sizeBytes = files['scene.json'].length; entry.sha256 = createHash('sha256').update(files['scene.json']).digest('hex')
  files['manifest.json'] = strToU8(JSON.stringify(manifest))
  await file.setInputFiles({ name: 'strict-v3-violation.sceneweave', mimeType: 'application/octet-stream', buffer: Buffer.from(zipSync(files)) })
  await expect(page.getByRole('alert')).toContainText('准备打开工程')
  await expect(dialog).toHaveCount(0); expect(await scene(page)).toEqual(migrated)
  await evidence(info, 'c1d-v3-ui-migration.json', { current, source: source.document, migrated, sourceAfter, originalBytes: original.bytes.length, exactOriginal: true, strictUnknownFieldRejected: true })
})
