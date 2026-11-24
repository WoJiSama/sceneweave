import { expect, test, type Page } from '@playwright/test'
import { createKeyboardProject, keyboardProjectBackup, keyboardWorkspaceSaved } from './keyboard-ux-helpers'
import { openGenerationTask, openTerrainTask, openWorkspaceModule } from './workspace-navigation-helpers'

async function clickMap(page: Page, x: number, y: number, width: number, height: number) {
  const canvas = page.getByLabel('材质场景主持人预览', { exact: true })
  await expect(canvas).toBeVisible()
  const box = (await canvas.boundingBox())!
  await page.mouse.click(box.x + box.width * x / width, box.y + box.height * y / height)
}

test('新建平地可直接画房，室内生成在选定范围预览、选中并一次撤销', async ({ page }, info) => {
  test.setTimeout(120_000)
  await createKeyboardProject(page, '同一画布', { widthMeters: 24, heightMeters: 18 })
  const blank = await keyboardProjectBackup(page, info.outputPath('blank.sceneweave'))
  const [ground] = Object.values(blank.document.terrainAreas)
  expect(ground).toMatchObject({ floorId: Object.keys(blank.document.floors)[0], groundElevationMm: 0, blocksMovement: false })
  expect(ground.boundaryMm.map(point => point.positionMm)).toEqual([
    { x: 0, y: 0 }, { x: 24000, y: 0 }, { x: 24000, y: 18000 }, { x: 0, y: 18000 },
  ])

  await openTerrainTask(page, '布置植被')
  const inspector = page.getByTestId('workspace-inspector')
  const resources = page.getByTestId('workspace-resources')
  await expect(resources.getByLabel('地表规则支撑地形面')).toHaveValue(ground.id)
  await expect(resources.getByRole('button', { name: '开始地表涂绘' })).toBeEnabled()
  await expect(inspector.getByLabel('地表规则支撑地形面')).toHaveCount(0)
  await page.getByRole('button', { name: '工具：画房间', exact: true }).click()
  await clickMap(page, 1, 1, 24, 18)
  await clickMap(page, 5, 5, 24, 18)
  await page.getByRole('button', { name: '完成房间', exact: true }).click()
  await keyboardWorkspaceSaved(page)
  const drawn = await keyboardProjectBackup(page, info.outputPath('drawn.sceneweave'))
  expect(Object.keys(drawn.document.rooms)).toHaveLength(1)

  await openGenerationTask(page, '室内布局')
  const dialog = page.getByRole('dialog', { name: '室内布局', exact: true })
  const viewport = page.getByRole('group', { name: '地图视口', exact: true })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: '移除房间 2', exact: true }).click()
  await dialog.getByLabel('房间1用途').fill('会客厅')
  await dialog.locator('summary').filter({ hasText: '详细设置' }).click()
  await dialog.getByLabel('房间1最大面积').fill('80')
  await expect(dialog.getByText(/净面积 88.2 平方米/)).toBeVisible()
  await dialog.getByLabel('房间1最大面积').clear()
  await dialog.getByLabel('自动安排用途家具').uncheck()
  await dialog.getByRole('button', { name: '预览室内布局', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('与已有房间重叠', { timeout: 30_000 })
  await dialog.getByRole('button', { name: '关闭生成设置' }).click()
  await expect(page.getByRole('button', { name: '选择地图对象', exact: true })).toBeEnabled()
  await expect(page.getByRole('button', { name: '工具：画房间', exact: true })).toBeEnabled()

  await openGenerationTask(page, '室内布局')
  await expect(dialog.getByLabel('房间1用途')).toHaveValue('会客厅')
  await dialog.getByRole('button', { name: '在画布框选' }).click()
  await clickMap(page, 9, 6, 24, 18)
  await clickMap(page, 21, 14, 24, 18)
  await expect(dialog.getByLabel('左上 X（米）')).toHaveValue('9')
  await dialog.getByRole('button', { name: '预览室内布局', exact: true }).click()
  const review = page.getByRole('group', { name: '当前画布生成预览' })
  await expect(review).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('outdoor-workbench')).toHaveAttribute('data-revision', String(drawn.document.revision))
  await openWorkspaceModule(page, '建筑')
  await expect(resources.getByRole('status')).toContainText('采用或放弃')
  await expect(page.getByRole('button', { name: '选择地图对象', exact: true })).toBeEnabled()
  await clickMap(page, 15, 10, 24, 18)
  await expect(inspector.getByLabel('候选对象详情')).toContainText('会客厅')
  const ids = await viewport.getAttribute('data-selected-ids')
  expect(ids).toMatch(/^\["generated-/)

  await review.getByRole('button', { name: '加入当前画布' }).click()
  await keyboardWorkspaceSaved(page)
  await expect(viewport).toHaveAttribute('data-selected-ids', ids!)
  await expect(inspector).toContainText('会客厅')
  const adopted = await keyboardProjectBackup(page, info.outputPath('adopted.sceneweave'))
  expect(adopted.document).toMatchObject({
    sceneId: drawn.document.sceneId, title: drawn.document.title, revision: drawn.document.revision + 1,
    floors: drawn.document.floors, exportBoundsMm: drawn.document.exportBoundsMm, terrainAreas: drawn.document.terrainAreas,
  })
  expect(Object.keys(adopted.document.rooms)).toHaveLength(2)
  expect(adopted.document.rooms).toMatchObject(drawn.document.rooms)
  await page.getByRole('button', { name: '撤销编辑', exact: true }).click()
  await keyboardWorkspaceSaved(page)
  const undone = await keyboardProjectBackup(page, info.outputPath('undone.sceneweave'))
  expect(undone.document.rooms).toEqual(drawn.document.rooms)
  expect(undone.document.terrainAreas).toEqual(drawn.document.terrainAreas)
})

test('森林候选可放弃，随后加入小画布并冷打开同一工程', async ({ page }, info) => {
  test.setTimeout(120_000)
  await createKeyboardProject(page, '小画布森林')
  const blank = await keyboardProjectBackup(page, info.outputPath('small-blank.sceneweave'))
  const review = page.getByRole('group', { name: '当前画布生成预览' })
  for (const action of ['放弃生成', '加入当前画布']) {
    await openGenerationTask(page, '森林与营地')
    await page.getByRole('dialog', { name: '森林与营地', exact: true }).getByRole('button', { name: '预览森林与营地' }).click()
    await expect(review).toBeVisible({ timeout: 30_000 })
    await review.getByRole('button', { name: action, exact: true }).click()
    await expect(review).toHaveCount(0, { timeout: 30_000 })
    await keyboardWorkspaceSaved(page)
    await expect(page.getByTestId('outdoor-workbench')).toHaveAttribute('data-revision', action === '放弃生成' ? '0' : '1')
  }
  await page.goto('./#home')
  await page.reload()
  const row = page.getByTestId('workspace-home').locator('.home-project-row').filter({ hasText: '小画布森林' })
  await expect(row).toHaveCount(1)
  await row.getByRole('button', { name: '打开', exact: true }).click()
  await keyboardWorkspaceSaved(page)
  const adopted = await keyboardProjectBackup(page, info.outputPath('small-forest.sceneweave'))
  expect(adopted.document.sceneId).toBe(blank.document.sceneId)
  expect(adopted.document.floors).toEqual(blank.document.floors)
  expect(Object.keys(adopted.document.terrainAreas).length).toBeGreaterThan(1)
  expect(Object.keys(adopted.document.paths).length).toBeGreaterThan(0)
})

test('窄屏可从左栏直接在新画布涂绘地表', async ({ page }, info) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 390, height: 844 })
  await createKeyboardProject(page, '手工地表')
  await openTerrainTask(page, '布置植被')
  const resources = page.getByTestId('workspace-resources')
  const support = await resources.getByLabel('地表规则支撑地形面').inputValue()
  expect(support).toMatch(/^canvas-ground-/)
  await resources.getByRole('button', { name: '材质', exact: true }).click()
  await resources.getByRole('button', { name: '开始地表涂绘' }).click()
  await expect(resources).toHaveAttribute('data-open', 'false')
  await expect(page.getByRole('status').filter({ hasText: '地表规则 · 材质' })).toBeVisible()

  const canvas = page.getByLabel('材质场景主持人预览', { exact: true })
  const box = (await canvas.boundingBox())!
  await page.mouse.move(box.x + box.width * .24, box.y + box.height * .4)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * .6, box.y + box.height * .4, { steps: 8 })
  await page.mouse.up()
  const review = page.getByRole('region', { name: '候选审阅', exact: true })
  await review.getByLabel('确认完整影响范围').check()
  await review.getByRole('button', { name: '采用室外修改', exact: true }).click()
  await keyboardWorkspaceSaved(page)
  const adopted = await keyboardProjectBackup(page, info.outputPath('painted-ground.sceneweave'))
  expect(Object.values(adopted.document.surfaceRules)).toMatchObject([
    { field: 'material', supportRef: { kind: 'terrainArea', id: support } },
  ])
})
