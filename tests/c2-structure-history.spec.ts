import { expect, test, type Page, type TestInfo } from '@playwright/test'
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
async function number(page: Page, label: string, value: number) {
  const input = page.getByRole('spinbutton', { name: label, exact: true })
  await input.fill(String(value)); await input.press('Tab')
}
async function evidence(info: TestInfo, name: string, value: unknown) {
  await info.attach(name, { body: JSON.stringify(value, null, 2), contentType: 'application/json' })
}
async function building(page: Page) { await page.getByRole('tab', { name: '建筑', exact: true }).click() }
async function history(page: Page) { await page.getByRole('tab', { name: '历史', exact: true }).click() }
async function blank(page: Page, name: string) {
  await page.goto('/#history'); await expect(page.getByTestId('history-workbench')).toBeVisible()
  await page.getByRole('button', { name: '新建空白场景', exact: true }).first().click()
  const dialog = page.getByRole('dialog', { name: '新建空白场景', exact: true })
  await dialog.getByLabel('场景名称', { exact: true }).fill(name)
  await dialog.getByLabel('画布宽度', { exact: true }).fill('18000')
  await dialog.getByLabel('画布高度', { exact: true }).fill('12000')
  await dialog.getByRole('button', { name: '创建空白场景', exact: true }).click()
  await expect(dialog).toHaveCount(0); await settled(page); await building(page)
}
async function adoptBuilding(page: Page) {
  await expect(page.getByRole('button', { name: '采用结构修改', exact: true })).toBeDisabled()
  await page.getByRole('checkbox', { name: '确认建筑完整影响范围', exact: true }).check()
  await page.getByRole('button', { name: '采用结构修改', exact: true }).click(); await settled(page)
}
async function room(page: Page, purpose: string, x: number) {
  await page.getByLabel('房间名称', { exact: true }).fill(purpose)
  for (const [label, value] of [['房间起点 X', x], ['房间起点 Y', 2000], ['房间宽度', 4000], ['房间高度', 4000]] as const) await number(page, label, value)
  await page.getByRole('button', { name: '预览新房间', exact: true }).click(); await adoptBuilding(page)
  return Object.values((await scene(page)).rooms).find(item => item.purpose === purpose)!
}
async function chooseRoom(page: Page, id: string) {
  await page.locator(`[data-building-room-id="${id}"]`).locator(':scope > summary').getByRole('button').click()
  await expect(page.locator('.building-stable-id')).toHaveText(id)
}
async function chooseWall(page: Page, roomId: string, wallId: string) {
  const details = page.locator(`[data-building-room-id="${roomId}"]`)
  if (await details.getAttribute('open') === null) {
    const summary = details.locator(':scope > summary'); await summary.focus(); await summary.press('Enter')
  }
  await details.locator(`[data-building-wall-id="${wallId}"]`).click()
  await expect(page.locator('.building-stable-id')).toHaveText(wallId)
}
async function thickness(page: Page, roomId: string, wallId: string, value: number) {
  await chooseWall(page, roomId, wallId); await number(page, '编辑墙厚', value)
  await page.getByRole('button', { name: '预览墙厚修改', exact: true }).click(); await adoptBuilding(page)
}
async function named(page: Page, name: string) {
  await history(page); await page.getByRole('button', { name: '新建命名快照', exact: true }).click()
  await page.getByLabel('命名快照名称', { exact: true }).fill(name)
  await page.getByRole('button', { name: '保存快照', exact: true }).click()
  await expect(page.getByRole('button', { name: `查看快照 ${name}`, exact: true })).toBeVisible(); await settled(page)
}
async function chooseRestore(page: Page, name: string, kind: string, id: string, mode = 'geometry') {
  await history(page); await page.getByRole('button', { name: `查看快照 ${name}`, exact: true }).click()
  await page.getByLabel('恢复对象类型', { exact: true }).selectOption('structure')
  await page.getByLabel('结构恢复模式', { exact: true }).selectOption(mode)
  await page.getByLabel('历史建筑对象类型', { exact: true }).selectOption(kind)
  await page.getByLabel('搜索场景建筑对象', { exact: true }).fill(id)
  await page.locator(`.structure-history-scope [data-entity-id="${id}"]`).click()
  await expect(page.locator(`.structure-history-scope [data-entity-id="${id}"]`)).toHaveAttribute('aria-pressed', 'true')
}
async function inspect(page: Page) {
  await page.getByRole('button', { name: '检查完整结构依赖', exact: true }).click()
  await expect(page.getByLabel('结构恢复完整影响', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '预览结构局部恢复', exact: true })).toBeDisabled()
}
async function confirmPreview(page: Page) {
  await page.getByRole('checkbox', { name: '确认结构恢复全部依赖', exact: true }).check()
  const crossLayer = page.getByRole('checkbox', { name: '确认结构恢复跨层影响', exact: true })
  if (await crossLayer.count()) {
    await expect(page.getByRole('button', { name: '预览结构局部恢复', exact: true })).toBeDisabled()
    await crossLayer.check()
  }
  await page.getByRole('button', { name: '预览结构局部恢复', exact: true }).click()
  await expect(page.getByRole('status', { name: '结构恢复候选', exact: true })).toBeVisible()
}
async function snapshots(page: Page) {
  return page.evaluate(async () => {
    const { workspace, repository } = Reflect.get(window, '__sceneweaveHistoryDev') as HistoryDev
    return repository.listNamedSnapshots(workspace.getState().project!.document.sceneId)
  })
}
function sharedWall(document: SceneDocumentV3) {
  return Object.values(document.walls).find(wall => document.vertices[wall.startVertexId].xMm === 6000 && document.vertices[wall.endVertexId].xMm === 6000)!
}

test('C2 structure UI confirms the complete shared and moved-layer scope, cancels safely, and protects one monotonic scoped restore', async ({ page }, info) => {
  test.setTimeout(180_000)
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await blank(page, 'C2 结构局部恢复')
  const left = await room(page, '左室初稿', 2000), right = await room(page, '右室初稿', 6000)
  const initial = await scene(page), wall = sharedWall(initial)
  await named(page, '共墙初稿'); await building(page)
  await thickness(page, left.id, wall.id, 180)
  await chooseRoom(page, right.id)
  await page.getByLabel('编辑房间名称', { exact: true }).fill('右室后续编辑')
  await page.getByRole('button', { name: '预览房间属性', exact: true }).click(); await adoptBuilding(page)
  await page.getByRole('button', { name: '新建用户图层', exact: true }).click()
  await page.getByLabel('新图层名称', { exact: true }).fill('后期建筑')
  await page.getByRole('button', { name: '创建图层', exact: true }).click(); await settled(page)
  const layerId = Object.values((await scene(page)).userLayers).find(layer => layer.name === '后期建筑')!.id
  await chooseWall(page, left.id, wall.id)
  await page.getByRole('button', { name: '移动所选到图层 · 1', exact: true }).click()
  await page.getByLabel('图层操作目标', { exact: true }).selectOption(layerId)
  await page.getByRole('button', { name: '预览图层修改', exact: true }).click()
  await page.getByRole('button', { name: '采用图层修改', exact: true }).click(); await settled(page)
  const before = await scene(page)
  expect(before.entityLayers[wall.id]).toBe(layerId)
  await chooseRestore(page, '共墙初稿', 'wall', wall.id); await inspect(page)
  const scope = await page.getByLabel('结构恢复完整影响', { exact: true }).inputValue()
  for (const id of [left.id, right.id, wall.id, wall.startVertexId, wall.endVertexId]) expect(scope).toContain(id)
  expect(scope).toContain('后期建筑'); expect(scope).toContain('保留业务属性')
  await expect(page.getByRole('checkbox', { name: '确认结构恢复跨层影响', exact: true })).toBeVisible()
  await confirmPreview(page)
  expect(await scene(page)).toEqual(before)
  const difference = page.locator(`[data-structure-restore-change-id="${wall.id}"] [data-change-field="thicknessMm"]`)
  await expect(difference).toContainText('180'); await expect(difference).toContainText('100')
  await expect(page.locator(`[data-structure-restore-change-id="${right.id}"]`)).toHaveCount(0)
  await info.attach('c2-structure-restore-preview.png', { body: await page.screenshot(), contentType: 'image/png' })
  await page.getByRole('button', { name: '取消结构恢复', exact: true }).click()
  expect(await scene(page)).toEqual(before); expect(await snapshots(page)).toHaveLength(1)
  await page.getByRole('button', { name: '预览结构局部恢复', exact: true }).click()
  await page.getByRole('button', { name: '保护当前并采用结构恢复', exact: true }).click(); await settled(page)
  const adopted = await scene(page), entries = await snapshots(page)
  expect(adopted.revision).toBe(before.revision + 1)
  expect(adopted.walls[wall.id]).toEqual(initial.walls[wall.id])
  expect(adopted.rooms[right.id]).toEqual(before.rooms[right.id])
  expect(adopted.entityLayers).toEqual(before.entityLayers)
  expect(adopted.vertices).toEqual(before.vertices)
  expect(entries.filter(item => item.kind === 'protection')).toHaveLength(1)
  const protection = await page.evaluate(async () => {
    const { workspace, repository } = Reflect.get(window, '__sceneweaveHistoryDev') as HistoryDev
    const id = workspace.getState().project!.document.sceneId, item = (await repository.listNamedSnapshots(id)).find(item => item.kind === 'protection')!
    return (await repository.loadNamedSnapshot(item.id, id))!.project.document
  })
  expect(protection).toEqual(before)
  await page.getByRole('button', { name: '撤销素材编辑', exact: true }).click(); await settled(page)
  const undone = await scene(page)
  expect(undone.revision).toBe(adopted.revision + 1); expect(undone.walls).toEqual(before.walls)
  expect(undone.rooms).toEqual(before.rooms); expect(undone.entityLayers).toEqual(before.entityLayers)
  await page.getByRole('button', { name: '重做素材编辑', exact: true }).click(); await settled(page)
  const redone = await scene(page)
  expect(redone.revision).toBe(undone.revision + 1); expect(redone.walls).toEqual(adopted.walls)
  expect(redone.rooms[right.id]).toEqual(before.rooms[right.id]); expect(errors).toEqual([])
  await evidence(info, 'c2-ui-structure-scoped-restore.json', { method: 'Real blank UI, two rooms, named snapshot, current wall edit and neighbor rename, explicit single-wall layer move and cross-layer restore. No document injection.', initial, before, scope, adopted, entries, protection, undone, redone, errors })
})

test('C2 structure UI refuses old structure snapshots after reopening and accepts a newly established session snapshot', async ({ page }, info) => {
  test.setTimeout(120_000)
  await blank(page, 'C2 重开恢复边界')
  const created = await room(page, '重开测试室', 2000), initial = await scene(page), wall = Object.values(initial.walls)[0]
  await named(page, '旧会话建筑'); await building(page); await thickness(page, created.id, wall.id, 160)
  const before = await scene(page), storedSnapshots = await snapshots(page)
  await page.reload(); await settled(page); expect(await scene(page)).toEqual(before)
  await chooseRestore(page, '旧会话建筑', 'wall', wall.id)
  await page.getByRole('button', { name: '检查完整结构依赖', exact: true }).click()
  await expect(page.locator('.asset-notice')).toContainText(/本会话|本次打开|连续性|重新建立.*快照/)
  await expect(page.getByLabel('结构恢复完整影响', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('status', { name: '结构恢复候选', exact: true })).toHaveCount(0)
  expect(await scene(page)).toEqual(before); expect(await snapshots(page)).toEqual(storedSnapshots)
  await named(page, '新会话建筑'); await building(page); await thickness(page, created.id, wall.id, 210)
  const changed = await scene(page)
  await chooseRestore(page, '新会话建筑', 'wall', wall.id); await inspect(page); await confirmPreview(page)
  await page.getByRole('button', { name: '保护当前并采用结构恢复', exact: true }).click(); await settled(page)
  const restored = await scene(page)
  expect(restored.revision).toBe(changed.revision + 1); expect(restored.walls[wall.id].thicknessMm).toBe(160)
  await evidence(info, 'c2-ui-reopened-structure-boundary.json', { before, storedSnapshots, changed, restored, refusedOldSessionWithoutMutation: true })
})

test('C2 structure protection write failure leaves the current durable scene and undo branch available', async ({ page }, info) => {
  test.setTimeout(120_000)
  await blank(page, 'C2 保护点失败')
  const created = await room(page, '保护点测试室', 2000), initial = await scene(page), wall = Object.values(initial.walls)[0]
  await named(page, '保护前基线'); await building(page); await thickness(page, created.id, wall.id, 180)
  const before = await scene(page), beforeSnapshots = await snapshots(page)
  await chooseRestore(page, '保护前基线', 'wall', wall.id); await inspect(page); await confirmPreview(page)
  await page.evaluate(() => {
    const { repository } = Reflect.get(window, '__sceneweaveHistoryDev') as HistoryDev
    const table = Reflect.get(repository, 'db').table('protectionSnapshots'), original = table.add
    table.add = async () => { throw new DOMException('C2 simulated protection write failure', 'QuotaExceededError') }
    Reflect.set(window, '__c2RestoreWriteFailure', { restore: () => { table.add = original } })
  })
  try {
    await page.getByRole('button', { name: '保护当前并采用结构恢复', exact: true }).click()
    await expect(page.locator('.asset-notice')).toContainText('C2 simulated protection write failure')
    await expect(page.getByRole('status', { name: '结构恢复候选', exact: true })).toHaveCount(0)
    expect(await scene(page)).toEqual(before); expect(await snapshots(page)).toEqual(beforeSnapshots)
    const durable = await page.evaluate(async () => {
      const { workspace, repository } = Reflect.get(window, '__sceneweaveHistoryDev') as HistoryDev
      return (await repository.load(workspace.getState().project!.document.sceneId))!.document
    })
    expect(durable).toEqual(before)
    await evidence(info, 'c2-ui-structure-protection-failure.json', { before, durable, beforeSnapshots, noProtectionCommitted: true, currentBranchPreserved: true })
  } finally {
    await page.evaluate(() => { Reflect.get(window, '__c2RestoreWriteFailure')?.restore(); Reflect.deleteProperty(window, '__c2RestoreWriteFailure') })
  }
  await page.getByRole('button', { name: '撤销素材编辑', exact: true }).click(); await settled(page)
  const undone = await scene(page)
  expect(undone.revision).toBe(before.revision + 1); expect(undone.walls[wall.id]).toEqual(initial.walls[wall.id])
})

test('C2 structure business-property preview explicitly reviews a private note becoming visible and preserves other later notes', async ({ page }, info) => {
  test.setTimeout(120_000)
  await blank(page, 'C2 注记属性恢复')
  await room(page, '注记测试室', 2000)
  await page.getByText('文字与线索', { exact: true }).click()
  await page.getByLabel('新注记内容', { exact: true }).fill('公开初稿：破碎灯罩')
  await page.getByLabel('新注记可见性', { exact: true }).selectOption('public')
  await page.getByRole('button', { name: '预览新增注记', exact: true }).click(); await adoptBuilding(page)
  const initial = await scene(page), note = Object.values(initial.notes)[0]
  await named(page, '注记公开初稿'); await building(page)
  await page.locator('.building-entity-list').getByRole('button', { name: `注记 · ${note.text.slice(0, 18)}`, exact: true }).click()
  await page.getByLabel('编辑注记内容', { exact: true }).fill('后续秘密注记')
  await page.getByLabel('注记可见性', { exact: true }).selectOption('gm')
  await number(page, '注记 X', 3600)
  await page.getByRole('button', { name: '预览注记修改', exact: true }).click(); await adoptBuilding(page)
  await page.getByText('文字与线索', { exact: true }).click()
  await page.getByLabel('新注记内容', { exact: true }).fill('范围外后续注记')
  await page.getByRole('button', { name: '预览新增注记', exact: true }).click(); await adoptBuilding(page)
  const before = await scene(page), laterId = Object.keys(before.notes).find(id => id !== note.id)!
  await chooseRestore(page, '注记公开初稿', 'note', note.id, 'properties'); await inspect(page); await confirmPreview(page)
  await expect(page.getByRole('region', { name: '结构局部恢复差异', exact: true })).toContainText('1 项恢复会改变玩家可见性或秘密揭示')
  await expect(page.locator(`[data-structure-restore-change-id="${note.id}"] [data-change-field="visibility"]`)).toContainText('仅主持人')
  await expect(page.locator(`[data-structure-restore-change-id="${note.id}"] [data-change-field="visibility"]`)).toContainText('玩家可见')
  expect(await scene(page)).toEqual(before)
  await page.getByRole('button', { name: '保护当前并采用结构恢复', exact: true }).click(); await settled(page)
  const adopted = await scene(page)
  expect(adopted.notes[note.id]).toEqual(initial.notes[note.id]); expect(adopted.notes[laterId]).toEqual(before.notes[laterId])
  expect(adopted.revision).toBe(before.revision + 1)
  await evidence(info, 'c2-ui-structure-note-privacy-review.json', { initial, before, adopted, laterId, explicitBusinessPropertyAndVisibilityReview: true })
})
