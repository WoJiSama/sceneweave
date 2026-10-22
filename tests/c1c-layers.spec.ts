import { expect, test, type Page } from '@playwright/test'
import type { SceneDocumentV3 } from '../src/core/v3/types'

async function scene(page: Page): Promise<SceneDocumentV3> {
  return page.evaluate(() => structuredClone(Reflect.get(window, '__sceneweaveLayersDev').workspace.getState().project.document))
}
async function settled(page: Page) {
  await expect(page.locator('.asset-save')).toHaveText('本地已保存')
  await expect(page.locator('.asset-map-wrap')).toHaveAttribute('aria-busy', 'false')
}
async function revision(page: Page, value: number) { await expect(page.getByTestId('layer-workbench')).toHaveAttribute('data-revision', String(value)) }
async function addLayer(page: Page, name: string) {
  await page.getByRole('button', { name: '新建用户图层', exact: true }).click()
  await page.getByRole('textbox', { name: '新图层名称', exact: true }).fill(name)
  await page.getByRole('button', { name: '创建图层', exact: true }).click()
  await expect(page.getByRole('button', { name: `设为当前图层 ${name}`, exact: true })).toBeVisible()
  return Object.values((await scene(page)).userLayers).find(layer => layer.name === name)!.id
}
async function chooseObject(page: Page, id: string) {
  await page.getByRole('group', { name: '场景对象分类', exact: true }).getByRole('button', { name: '物件', exact: true }).click()
  await page.getByLabel('搜索场景物件', { exact: true }).fill(id)
  await page.locator(`[data-entity-id="${id}"]`).click()
}
async function number(page: Page, label: string, value: number) {
  const input = page.getByRole('spinbutton', { name: label, exact: true }); await input.fill(String(value)); await input.press('Tab')
}
async function createBlank(page: Page) {
  await page.goto('/#layers')
  await page.getByRole('button', { name: '新建空白场景', exact: true }).first().click()
  const dialog = page.getByRole('dialog', { name: '新建空白场景', exact: true })
  await dialog.getByLabel('场景名称').fill('图层与物件')
  await dialog.getByLabel('画布宽度', { exact: true }).fill('14000'); await dialog.getByLabel('画布高度', { exact: true }).fill('10000')
  await dialog.getByRole('button', { name: '创建空白场景', exact: true }).click()
  await expect(dialog).toHaveCount(0); await settled(page)
}
async function placeChair(page: Page, x = 3500) {
  const before = await scene(page), definition = before.propDefinitions['b2-p-03']
  await page.getByRole('group', { name: '场景对象分类', exact: true }).getByRole('button', { name: '放置', exact: true }).click()
  await page.getByRole('button', { name: `放置${definition.name}`, exact: true }).click()
  await expect(page.getByRole('button', { name: '在此放置', exact: true })).toBeEnabled()
  await number(page, '放置 X', x); await number(page, '放置 Y', 3000)
  await page.getByRole('button', { name: '在此放置', exact: true }).click()
  await revision(page, before.revision + 1); await settled(page)
  return Object.keys((await scene(page)).props).find(id => !before.props[id])!
}

test('C1c real v2 entry preserves its source, reviews complete group membership, and saves monotonic layer undo', async ({ page }, testInfo) => {
  test.slow()
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await page.goto('/#assets')
  await page.getByRole('button', { name: /书房与露台/ }).click(); await page.getByRole('button', { name: '保存并打开副本', exact: true }).click(); await settled(page)
  const original = await page.evaluate(async () => {
    const { workspace, repository } = Reflect.get(window, '__sceneweaveAssetsDev'), project = workspace.getState().project
    return { document: structuredClone(project.document), snapshots: await repository.listSnapshots(project.document.sceneId) }
  })
  await page.getByRole('button', { name: '用户图层', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '确认打开素材工程', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '取消', exact: true }).click()
  expect(await page.evaluate(() => Reflect.get(window, '__sceneweaveLayersDev').workspace.getState().project)).toBeNull()
  await page.locator('.asset-brand').click()
  await expect(page.getByTestId('asset-workbench')).toBeVisible()
  await page.getByRole('button', { name: '用户图层', exact: true }).click(); await page.getByRole('button', { name: '保存并打开副本', exact: true }).click(); await settled(page)
  const initial = await scene(page)
  expect(initial.schemaVersion).toBe(3); expect(initial.sceneId).not.toBe(original.document.sceneId); expect(initial.revision).toBe(0)
  expect(initial.props).toEqual(original.document.props)
  const target = await addLayer(page, '家具与陈设'), defaultLayer = Object.keys(initial.userLayers)[0]
  await chooseObject(page, 'study-chair')
  await page.getByRole('button', { name: '更多操作', exact: true }).click()
  await page.getByRole('menuitem', { name: '移动所选到图层…', exact: true }).click()
  await page.getByLabel('图层操作目标', { exact: true }).selectOption(target)
  const expected = ['study-group', ...Object.values(initial.prefabInstances['study-group'].members).flatMap(member => member.propId ? [member.propId] : [])].sort()
  expect((await page.getByLabel('图层操作完整 ID', { exact: true }).inputValue()).split('\n').sort()).toEqual(expected)
  const before = await scene(page)
  await page.getByRole('button', { name: '预览图层修改', exact: true }).click()
  await expect(page.getByLabel('待采用图层操作 ID', { exact: true })).toHaveValue(expected.length ? new RegExp('study-group') : '')
  expect(await scene(page)).toEqual(before)
  await page.getByRole('button', { name: '采用图层修改', exact: true }).click(); await revision(page, 2); await settled(page)
  const moved = await scene(page)
  for (const id of expected) expect(moved.entityLayers[id]).toBe(target)
  expect(moved.props).toEqual(initial.props)
  await page.getByRole('button', { name: '锁定图层 家具与陈设', exact: true }).click(); await revision(page, 3)
  await chooseObject(page, 'study-chair')
  await expect(page.getByRole('spinbutton', { name: '物件 X', exact: true })).toBeDisabled()
  const refusal = await page.evaluate(() => {
    const workspace = Reflect.get(window, '__sceneweaveLayersDev').workspace, before = workspace.getState()
    let error = ''; try { workspace.execute([{ type: 'setEditLock', kind: 'prop', id: 'study-chair', locked: false }]) } catch (reason) { error = String(reason) }
    return { error, same: before === workspace.getState(), actual: workspace.getState().project.document.props['study-chair'].editLocked }
  })
  expect(refusal.error).toMatch(/锁/); expect(refusal.same).toBe(true); expect(refusal.actual).toBe(initial.props['study-chair'].editLocked)
  await page.getByRole('button', { name: '撤销素材编辑', exact: true }).click(); await revision(page, 4)
  await page.getByRole('button', { name: '撤销素材编辑', exact: true }).click(); await revision(page, 5)
  expect((await scene(page)).entityLayers['study-chair']).toBe(defaultLayer)
  await page.getByRole('button', { name: '重做素材编辑', exact: true }).click(); await revision(page, 6); await settled(page)
  await page.reload(); await settled(page)
  expect((await scene(page)).entityLayers['study-chair']).toBe(target)
  const sourceAfter = await page.evaluate(async sourceId => {
    const path = '/src/io/v2/storage.ts', { SceneRepositoryV2 } = await import(path), old = new SceneRepositoryV2()
    try { await old.open(); return { document: (await old.load(sourceId))!.document, snapshots: await old.listSnapshots(sourceId) } } finally { old.close() }
  }, original.document.sceneId)
  expect(sourceAfter).toEqual(original)
  expect(errors).toEqual([])
  await testInfo.attach('group-migration-and-source.json', { body: JSON.stringify({ original, initial, moved, expected, refusal, sourceAfter }, null, 2), contentType: 'application/json' })
})

test('C1c current layer placement, session eye/solo/scope and layer menu do not write geometry or hidden state', async ({ page }, testInfo) => {
  test.slow()
  await createBlank(page)
  const defaultLayer = Object.keys((await scene(page)).userLayers)[0], target = await addLayer(page, '家具')
  await page.getByRole('button', { name: '设为当前图层 家具', exact: true }).click()
  const id = await placeChair(page), stored = await scene(page)
  expect(stored.entityLayers[id]).toBe(target)
  await chooseObject(page, id)
  await page.getByRole('button', { name: '隐藏图层 家具', exact: true }).click(); await settled(page)
  const viewport = page.getByLabel('地图视口', { exact: true })
  await expect(viewport).toHaveAttribute('data-selected-ids', '[]')
  await page.getByRole('button', { name: '全选可编辑对象', exact: true }).click(); await expect(viewport).toHaveAttribute('data-selected-ids', '[]')
  await chooseObject(page, id); await expect(page.getByRole('alert')).toContainText('隐藏图层')
  expect(await scene(page)).toEqual(stored)
  await page.getByRole('button', { name: '显示图层 家具', exact: true }).click(); await settled(page)
  await page.getByRole('button', { name: '设为当前图层 默认图层', exact: true }).click()
  await page.getByLabel('图层选择范围', { exact: true }).selectOption('current')
  await page.getByRole('button', { name: '全选可编辑对象', exact: true }).click(); await expect(viewport).toHaveAttribute('data-selected-ids', '[]')
  await page.getByLabel('图层选择范围', { exact: true }).selectOption('all')
  await page.getByRole('button', { name: '全选可编辑对象', exact: true }).click(); await expect(viewport).toHaveAttribute('data-selected-ids', JSON.stringify([id]))
  await page.getByRole('button', { name: '选择图层成员 默认图层', exact: true }).click(); await expect(viewport).toHaveAttribute('data-selected-ids', '[]')
  const row = page.locator(`[data-layer-id="${target}"]`)
  await row.click({ button: 'right' }); const menu = page.getByRole('menu', { name: '图层菜单', exact: true }); await expect(menu).toBeVisible()
  await menu.getByRole('menuitem', { name: '选择图层成员', exact: true }).click(); await expect(viewport).toHaveAttribute('data-selected-ids', JSON.stringify([id]))
  await expect(page.getByRole('button', { name: '设为当前图层 家具', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await row.click({ button: 'right' }); await expect(menu).toBeVisible()
  await menu.getByRole('menuitem', { name: '独显图层', exact: true }).click()
  await expect(page.getByRole('button', { name: '退出独显 家具', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: '设为当前图层 家具', exact: true }).focus(); await page.keyboard.press('Shift+F10'); await expect(menu).toBeVisible(); await page.keyboard.press('Escape'); await expect(menu).toHaveCount(0)
  expect(await scene(page)).toEqual(stored)
  await page.reload(); await settled(page)
  await expect(page.getByRole('button', { name: '隐藏图层 家具', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByLabel('图层选择范围', { exact: true })).toHaveValue('all')
  await expect(page.getByRole('button', { name: '设为当前图层 默认图层', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: '独显图层 家具', exact: true })).toHaveAttribute('aria-pressed', 'false')
  expect(await scene(page)).toEqual(stored)
  expect(stored.userLayers[defaultLayer].floorId).toBe(stored.userLayers[target].floorId)
  await testInfo.attach('session-state-unchanged.json', { body: JSON.stringify({ stored, after: await scene(page) }, null, 2), contentType: 'application/json' })
})

test('C1c rename/reorder and whole-layer deletion use one previewed transaction and undo restores all membership', async ({ page }) => {
  test.slow()
  await createBlank(page)
  const target = await addLayer(page, '待整理')
  await page.getByRole('button', { name: '设为当前图层 待整理', exact: true }).click()
  const id = await placeChair(page), initial = await scene(page), defaultLayer = Object.keys(initial.userLayers).find(layer => layer !== target)!
  await page.getByRole('button', { name: '改名', exact: true }).click(); await page.getByLabel('修改图层名称', { exact: true }).fill('前景家具'); await page.getByRole('button', { name: '保存名称', exact: true }).click()
  await page.getByRole('button', { name: '下移图层 前景家具', exact: true }).click()
  const reordered = await scene(page); expect(reordered.userLayers[target].order).toBe(0); expect(reordered.props).toEqual(initial.props)
  await page.getByRole('button', { name: '删除图层 前景家具', exact: true }).click()
  await expect(page.getByRole('button', { name: '预览图层修改', exact: true })).toBeDisabled()
  await page.getByLabel('图层操作目标', { exact: true }).selectOption(defaultLayer)
  await expect(page.getByLabel('图层操作完整 ID', { exact: true })).toHaveValue(id)
  await page.getByRole('button', { name: '预览图层修改', exact: true }).click(); expect(await scene(page)).toEqual(reordered)
  await page.getByRole('button', { name: '采用图层修改', exact: true }).click(); await settled(page)
  const removed = await scene(page); expect(removed.userLayers[target]).toBeUndefined(); expect(removed.entityLayers[id]).toBe(defaultLayer); expect(removed.props).toEqual(initial.props)
  await page.getByRole('button', { name: '撤销素材编辑', exact: true }).click(); await settled(page)
  const restored = await scene(page); expect(restored.userLayers).toEqual(reordered.userLayers); expect(restored.entityLayers).toEqual(reordered.entityLayers); expect(restored.revision).toBe(removed.revision + 1)
})
