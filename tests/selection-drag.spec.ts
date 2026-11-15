import { test, expect, type Page } from '@playwright/test'
import { createKeyboardProject, keyboardProjectBackup, keyboardWorkspaceSaved, placeKeyboardLamp } from './keyboard-ux-helpers'
import { closeWorkspaceDrawers, openSamples, openSceneObjects } from './workspace-navigation-helpers'

async function sample(page: Page) {
  await createKeyboardProject(page, '真实选择拖动')
  await openSamples(page)
  await page.getByTestId('workspace-inspector').getByRole('region', { name: '场景样板', exact: true }).getByRole('button', { name: '海岸哨所', exact: true }).click()
  await page.getByRole('dialog', { name: '确认打开工程', exact: true }).getByRole('button', { name: '保存并打开副本', exact: true }).click()
  await keyboardWorkspaceSaved(page)
}
async function select(page: Page, id: string, category: '组合' | '物件与装饰') {
  const nav = await openSceneObjects(page, category)
  await nav.getByLabel('搜索场景对象', { exact: true }).fill(id)
  await nav.locator(`[data-entity-id="${id}"]`).click()
  await closeWorkspaceDrawers(page)
}
async function begin(page: Page, point: { x: number; y: number }, bounds: { x: number; y: number; width: number; height: number }, dx: number, dy = 0) {
  await closeWorkspaceDrawers(page)
  // Export notices can resize the narrow viewport; start only after its geometry settles.
  let previous = ''
  await expect.poll(async () => {
    const next = JSON.stringify(await page.getByLabel('材质场景主持人预览', { exact: true }).boundingBox())
    const stable = next !== 'null' && next === previous; previous = next; return stable
  }).toBe(true)
  const box = await page.getByLabel('材质场景主持人预览', { exact: true }).boundingBox()
  if (!box) throw Error('Expected the real canvas')
  const a = { x: box.x + (point.x - bounds.x) / bounds.width * box.width, y: box.y + (point.y - bounds.y) / bounds.height * box.height }
  const b = { x: a.x + dx / bounds.width * box.width, y: a.y + dy / bounds.height * box.height }
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 8 })
  return { a, b, box }
}
async function adopt(page: Page) {
  await page.getByRole('button', { name: '采用批量修改', exact: true }).click()
  await keyboardWorkspaceSaved(page)
}
async function noCandidate(page: Page) {
  await expect(page.getByTestId('selection-drag-preview')).toHaveCount(0)
  await expect(page.getByTestId('selection-drag-status')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '采用批量修改', exact: true })).toHaveCount(0)
}

test('real prefab drag is transient, cancelable and adopted as one complete undoable move', async ({ page }, info) => {
  test.setTimeout(120_000)
  await sample(page)
  const original = await keyboardProjectBackup(page, info.outputPath('original.sceneweave'))
  const id = 'outpost-supplies-group', group = original.document.prefabInstances[id]
  const members = Object.values(group.members).flatMap(m => m.propId ?? [])
  const point = original.document.props[members[0]].positionMm, bounds = original.document.exportBoundsMm
  await select(page, id, '组合'); await page.getByRole('button', { name: '适应全图', exact: true }).click()
  // Keep the same 400mm move above the 4px click/drag threshold on narrow screens.
  for (let i = 0; i < 4; i++) {
    const box = await page.getByLabel('材质场景主持人预览', { exact: true }).boundingBox()
    if (box && box.width * 400 / bounds.width >= 6) break
    await page.getByRole('button', { name: '放大地图', exact: true }).click()
  }
  await begin(page, point, bounds, 400)
  await expect(page.getByTestId('selection-drag-preview')).toBeVisible()
  await expect(page.getByTestId('selection-drag-status')).toContainText('当前工程未修改')
  await page.screenshot({ path: info.outputPath('transient.png') })
  await page.keyboard.press('Escape'); await page.mouse.up(); await noCandidate(page)
  expect((await keyboardProjectBackup(page, info.outputPath('escape.sceneweave'))).hashes).toEqual(original.hashes)
  const repeated = await begin(page, point, bounds, 400)
  await expect(page.getByTestId('selection-drag-preview')).toBeVisible()
  expect(await page.getByLabel('材质场景主持人预览', { exact: true }).boundingBox()).toEqual(repeated.box)
  await page.mouse.up()
  await expect(page.getByRole('button', { name: '采用批量修改', exact: true })).toBeVisible()
  await expect(page.locator('.workspace-unified')).toHaveAttribute('data-revision', String(original.document.revision))
  await page.getByRole('button', { name: '取消批量预览', exact: true }).click(); await keyboardWorkspaceSaved(page)
  expect((await keyboardProjectBackup(page, info.outputPath('cancel.sceneweave'))).hashes).toEqual(original.hashes)
  await begin(page, point, bounds, 400); await page.mouse.up(); await adopt(page)
  const moved = await keyboardProjectBackup(page, info.outputPath('moved.sceneweave'))
  expect(moved.document.revision).toBe(original.document.revision + 1)
  expect(moved.document.prefabInstances[id].anchorMm).toEqual({ x: group.anchorMm.x + 400, y: group.anchorMm.y })
  for (const member of members) expect(moved.document.props[member]).toEqual({ ...original.document.props[member], positionMm: { x: original.document.props[member].positionMm.x + 400, y: original.document.props[member].positionMm.y } })
  for (const [key, prop] of Object.entries(original.document.props)) if (!members.includes(key)) expect(moved.document.props[key]).toEqual(prop)
  await page.getByRole('button', { name: '撤销编辑', exact: true }).click(); await keyboardWorkspaceSaved(page)
  const undone = await keyboardProjectBackup(page, info.outputPath('undone.sceneweave'))
  expect(undone.document.props).toEqual(original.document.props); expect(undone.document.prefabInstances).toEqual(original.document.prefabInstances)
  await page.getByRole('button', { name: '重做编辑', exact: true }).click(); await keyboardWorkspaceSaved(page)
  expect((await keyboardProjectBackup(page, info.outputPath('redone.sceneweave'))).document.props).toEqual(moved.document.props)
  await page.getByRole('button', { name: '回到首页', exact: true }).click(); await page.reload()
  await page.locator(`[data-project-key="native:${original.document.sceneId}"]`).getByRole('button', { name: '打开', exact: true }).click(); await keyboardWorkspaceSaved(page)
  expect((await keyboardProjectBackup(page, info.outputPath('cold.sceneweave'))).document.props).toEqual(moved.document.props)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('unselected prop drag preserves clicks and interruption, lock and canvas bounds guards', async ({ page }, info) => {
  test.setTimeout(120_000)
  await createKeyboardProject(page, '独立物件拖动'); await placeKeyboardLamp(page)
  const original = await keyboardProjectBackup(page, info.outputPath('original.sceneweave'))
  const prop = Object.values(original.document.props)[0], bounds = original.document.exportBoundsMm
  // A stationary click still selects and creates no candidate.
  await begin(page, prop.positionMm, bounds, 0); await page.mouse.up(); await noCandidate(page)
  await expect(page.getByRole('group', { name: '地图视口', exact: true })).toHaveAttribute('data-selected-ids', JSON.stringify([prop.id]))
  for (const interruption of ['capture', 'focus', 'window-blur-handler', 'pointercancel-handler', 'zoom'] as const) {
    await begin(page, prop.positionMm, bounds, 600); await expect(page.getByTestId('selection-drag-preview')).toBeVisible()
    if (interruption === 'capture') await page.getByRole('group', { name: '地图视口', exact: true }).evaluate(node => { for (let i = 1; i < 16; i++) if (node.hasPointerCapture(i)) node.releasePointerCapture(i) })
    else if (interruption === 'focus') await page.getByRole('button', { name: '适应全图', exact: true }).focus()
    else if (interruption === 'window-blur-handler') await page.evaluate(() => window.dispatchEvent(new Event('blur')))
    else if (interruption === 'pointercancel-handler') await page.getByRole('group', { name: '地图视口', exact: true }).dispatchEvent('pointercancel', { pointerId: 1 })
    else await page.mouse.wheel(0, -100)
    await page.mouse.up(); await noCandidate(page)
    await page.getByRole('button', { name: '适应全图', exact: true }).click()
  }
  expect((await keyboardProjectBackup(page, info.outputPath('interrupted.sceneweave'))).hashes).toEqual(original.hashes)
  await begin(page, prop.positionMm, bounds, bounds.width); await page.mouse.up(); await noCandidate(page)
  expect((await keyboardProjectBackup(page, info.outputPath('outside.sceneweave'))).hashes).toEqual(original.hashes)
  // An unselected object can start a move; a blank click retains its selection semantics.
  await begin(page, { x: bounds.x + 1000, y: bounds.y + 1000 }, bounds, 0); await page.mouse.up()
  await expect(page.getByRole('group', { name: '地图视口', exact: true })).toHaveAttribute('data-selected-ids', '[]')
  await begin(page, prop.positionMm, bounds, 600); await page.mouse.up(); await adopt(page)
  const moved = await keyboardProjectBackup(page, info.outputPath('moved.sceneweave'))
  expect(moved.document.props[prop.id]).toEqual({ ...prop, positionMm: { x: prop.positionMm.x + 600, y: prop.positionMm.y } })
  await select(page, prop.id, '物件与装饰')
  await page.getByRole('button', { name: '锁定物件编辑', exact: true }).click(); await keyboardWorkspaceSaved(page)
  const locked = await keyboardProjectBackup(page, info.outputPath('locked.sceneweave'))
  await begin(page, moved.document.props[prop.id].positionMm, bounds, 600); await page.mouse.up(); await noCandidate(page)
  expect((await keyboardProjectBackup(page, info.outputPath('lock-rejected.sceneweave'))).hashes).toEqual(locked.hashes)
})
