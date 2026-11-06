import { expect, test } from '@playwright/test'
import { clickKeyboardWorldPoint, createKeyboardProject, keyboardProjectBackup, keyboardResourceHashes, keyboardWorkspaceSaved, openKeyboardPanel } from './keyboard-ux-helpers'
import { openTerrainTask } from './workspace-navigation-helpers'

test('production rectangle Enter requires two corners, preserves guards and previews one undoable edit', async ({ page }, info) => {
  test.setTimeout(180000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await createKeyboardProject(page, 'Enter 矩形绘图自检')
  const original = await keyboardProjectBackup(page, info.outputPath('enter-before.sceneweave'))
  const bounds = original.document.exportBoundsMm
  const viewport = page.getByRole('group', { name: '地图视口', exact: true })
  const review = page.getByRole('region', { name: '候选审阅', exact: true })
  const unchanged = async () => {
    await expect(review).toHaveCount(0)
    await expect(page.locator('.workspace-unified')).toHaveAttribute('data-revision', String(original.document.revision))
  }

  // A menu owns its keyboard focus. Returning focus to the canvas does not turn Enter into a map write.
  await viewport.focus()
  await viewport.press('Shift+F10')
  const menu = page.getByRole('menu')
  await expect(menu).toBeVisible()
  await viewport.focus()
  await viewport.press('Enter')
  await unchanged()
  await expect(menu).toBeVisible()
  await menu.locator('[role="menuitem"]:not(:disabled)').first().press('Escape')
  await expect(menu).toHaveCount(0)

  const resources = await openKeyboardPanel(page, 'resources')
  await resources.getByRole('tab', { name: '建筑', exact: true }).click()
  await page.getByLabel('房间形状', { exact: true }).selectOption('rectangle')
  const start = page.getByRole('button', { name: '在图上画房间', exact: true })
  await start.click()
  await viewport.focus()
  await viewport.press('Enter')
  await unchanged()
  await expect(page.locator('.asset-notice')).toContainText('矩形房间需要 2 个角点，当前 0 点')
  await clickKeyboardWorldPoint(page, { x: 1000, y: 1000 }, bounds)
  await viewport.focus()
  await viewport.press('Enter')
  await unchanged()
  await expect(page.locator('.asset-notice')).toContainText('矩形房间需要 2 个角点，当前 1 点')
  await clickKeyboardWorldPoint(page, { x: 5000, y: 4000 }, bounds)
  await expect(page.getByRole('button', { name: '预览房间', exact: true })).toBeVisible()

  // Enter in a NumberInput confirms that field; it must not submit the room form or finish the canvas.
  const thickness = page.getByLabel('新房间墙厚', { exact: true })
  await thickness.focus()
  await thickness.press('Enter')
  await unchanged()
  await viewport.focus()
  for (const guard of [{ isComposing: true }, { keyCode: 229 }, { repeat: true }]) {
    await viewport.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, ...guard })
    await unchanged()
  }
  for (const combination of ['Control+Enter', 'Meta+Enter', 'Alt+Enter', 'Shift+Enter']) {
    await viewport.press(combination)
    await unchanged()
  }
  await page.locator('.workspace-help > summary').click()
  await viewport.focus()
  await viewport.press('Enter')
  await unchanged()
  await page.getByRole('button', { name: '关闭操作帮助', exact: true }).click()
  // Existing tools reject opening a context menu during drawing, retaining the current points.
  await viewport.focus()
  await viewport.press('Shift+F10')
  await expect(menu).toHaveCount(0)
  await unchanged()

  await viewport.press('Enter')
  await expect(review).toContainText('新建新房间')
  const adopt = review.getByRole('button', { name: '采用结构修改', exact: true })
  await expect(adopt).toBeDisabled()
  await expect(page.locator('.workspace-unified')).toHaveAttribute('data-revision', String(original.document.revision))
  await viewport.focus()
  await viewport.press('Enter')
  await expect(adopt).toHaveCount(1)
  await expect(adopt).toBeDisabled()
  await page.keyboard.press('Escape')
  await unchanged()
  expect((await keyboardProjectBackup(page, info.outputPath('enter-cancelled.sceneweave'))).hashes).toEqual(original.hashes)

  await start.click()
  for (const point of [{ x: 1000, y: 1000 }, { x: 5000, y: 4000 }]) await clickKeyboardWorldPoint(page, point, bounds)
  await viewport.focus()
  await viewport.press('Enter')
  await expect(review).toContainText('新建新房间')
  await keyboardWorkspaceSaved(page)
  await page.screenshot({ path: info.outputPath('enter-rectangle-preview.png') })
  await review.getByLabel('确认完整影响范围', { exact: true }).check()
  await adopt.click()
  await keyboardWorkspaceSaved(page)
  const adopted = await keyboardProjectBackup(page, info.outputPath('enter-adopted.sceneweave'))
  expect(adopted.document.revision).toBe(original.document.revision + 1)
  expect(Object.keys(adopted.document.rooms)).toHaveLength(1)
  expect(Object.keys(adopted.document.walls)).toHaveLength(4)
  const room = Object.values(adopted.document.rooms)[0]
  expect(room.boundaryVertexIds.map(id => ({ x: adopted.document.vertices[id].xMm, y: adopted.document.vertices[id].yMm }))).toEqual([
    { x: 1000, y: 1000 }, { x: 5000, y: 1000 }, { x: 5000, y: 4000 }, { x: 1000, y: 4000 },
  ])
  expect(keyboardResourceHashes(adopted.hashes)).toEqual(keyboardResourceHashes(original.hashes))
  await page.getByRole('button', { name: '撤销编辑', exact: true }).click()
  await keyboardWorkspaceSaved(page)
  const undone = await keyboardProjectBackup(page, info.outputPath('enter-undone.sceneweave'))
  expect(undone.document).toEqual({ ...original.document, revision: original.document.revision + 2, updatedAt: undone.document.updatedAt })
  expect(keyboardResourceHashes(undone.hashes)).toEqual(keyboardResourceHashes(original.hashes))
  expect(errors).toEqual([])
})

test('production polygon, terrain and path Enter use their original candidates and incomplete connections retain the draft', async ({ page }, info) => {
  test.setTimeout(180000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await createKeyboardProject(page, 'Enter 多边形与室外绘图自检')
  const original = await keyboardProjectBackup(page, info.outputPath('enter-outdoor-before.sceneweave'))
  const bounds = original.document.exportBoundsMm
  const viewport = page.getByRole('group', { name: '地图视口', exact: true })
  const review = page.getByRole('region', { name: '候选审阅', exact: true })
  const resources = await openKeyboardPanel(page, 'resources')
  await resources.getByRole('tab', { name: '建筑', exact: true }).click()
  await page.getByLabel('房间形状', { exact: true }).selectOption('polygon')
  await page.getByRole('button', { name: '在图上画房间', exact: true }).click()
  for (const point of [{ x: 1000, y: 1000 }, { x: 5000, y: 1000 }]) await clickKeyboardWorldPoint(page, point, bounds)
  await viewport.focus()
  await viewport.press('Enter')
  await expect(review).toHaveCount(0)
  await expect(page.locator('.asset-notice')).toContainText('多边形房间至少需要 3 个顶点')
  await clickKeyboardWorldPoint(page, { x: 5000, y: 4000 }, bounds)
  await viewport.focus()
  await viewport.press('Enter')
  await expect(review.getByRole('button', { name: '采用结构修改', exact: true })).toBeDisabled()
  await expect(review).toContainText('新建新房间')
  await review.getByRole('button', { name: '取消结构预览', exact: true }).click()

  await openTerrainTask(page, '绘制地形')
  const tool = page.getByRole('combobox', { name: '室外制作工具', exact: true })
  for (const [kind, points, label] of [
    ['terrain', [{ x: 1000, y: 1000 }, { x: 5000, y: 1000 }, { x: 5000, y: 4000 }], '新建地形'],
    ['path', [{ x: 3000, y: 3000 }, { x: 7000, y: 3000 }], '铺设道路'],
  ] as const) {
    await tool.selectOption(kind)
    await page.getByRole('button', { name: '在画布逐点绘制', exact: true }).click()
    for (const point of points.slice(0, -1)) await clickKeyboardWorldPoint(page, point, bounds)
    await viewport.focus()
    await viewport.press('Enter')
    await expect(review).toHaveCount(0)
    await expect(page.locator('.asset-notice')).toContainText(kind === 'terrain' ? '地形和区域至少需要 3 个顶点' : '道路和连接至少需要 2 个点')
    await clickKeyboardWorldPoint(page, points.at(-1)!, bounds)
    await viewport.focus()
    await viewport.press('Enter')
    await expect(review).toContainText(label)
    await expect(review.getByRole('button', { name: '采用室外修改', exact: true })).toBeDisabled()
    await expect(page.locator('.workspace-unified')).toHaveAttribute('data-revision', String(original.document.revision))
    await review.getByRole('button', { name: '取消室外预览', exact: true }).click()
  }

  await tool.selectOption('connection')
  await page.getByRole('button', { name: '在画布逐点绘制', exact: true }).click()
  await clickKeyboardWorldPoint(page, { x: 3000, y: 3000 }, bounds)
  await viewport.focus()
  await viewport.press('Enter')
  await expect(review).toHaveCount(0)
  await expect(page.locator('.asset-notice')).toContainText('道路和连接至少需要 2 个点')
  await expect(page.getByRole('button', { name: '结束画布取点', exact: true })).toBeVisible()
  await viewport.press('Escape')
  await page.getByRole('button', { name: '取消室外草稿', exact: true }).click()
  expect((await keyboardProjectBackup(page, info.outputPath('enter-outdoor-cancelled.sceneweave'))).hashes).toEqual(original.hashes)
  expect(errors).toEqual([])
})
