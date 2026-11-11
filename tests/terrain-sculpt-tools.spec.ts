import { expect, test, type Locator, type Page } from '@playwright/test'
import { createKeyboardProject, keyboardProjectBackup, keyboardResourceHashes, keyboardWorkspaceSaved } from './keyboard-ux-helpers'
import { openWorkspaceModule } from './workspace-navigation-helpers'
import { openDetailsBySummary } from './workspace-ux-helpers'

type Point = { x: number; y: number }
type Bounds = Point & { width: number; height: number }
const reviewFor = (page: Page) => page.getByRole('region', { name: '候选审阅', exact: true })

async function commitNumber(scope: Locator, label: string, value: string): Promise<void> {
  const input = scope.getByLabel(label, { exact: true })
  await input.fill(value); await input.press('Tab')
}

async function adoptOutdoor(page: Page): Promise<void> {
  const review = reviewFor(page)
  await expect(review).toBeVisible()
  await review.getByLabel('确认完整影响范围', { exact: true }).check()
  await review.getByRole('button', { name: '采用室外修改', exact: true }).click()
  await expect(review).toHaveCount(0)
  await keyboardWorkspaceSaved(page)
}

async function startSculpt(page: Page, areaId: string): Promise<Locator> {
  const scene = await openWorkspaceModule(page, '场景')
  const allLayers = scene.getByRole('button', { name: '显示所有图层的对象', exact: true })
  if (await allLayers.isVisible()) await allLayers.click()
  await scene.getByRole('group', { name: '场景对象分类', exact: true }).getByRole('button', { name: '结构', exact: true }).click()
  await scene.getByLabel('搜索场景对象', { exact: true }).fill(areaId)
  await scene.locator(`[data-entity-id="${areaId}"]`).click()
  const resources = await openWorkspaceModule(page, '地形')
  await resources.getByRole('button', { name: '开始局部台地 / 洼地', exact: true }).click()
  const tools = page.getByTestId('workspace-inspector').getByRole('region', { name: '局部地形塑形工具', exact: true })
  await expect(tools).toBeVisible()
  return tools
}

async function clickScope(page: Page, points: Point[], bounds: Bounds): Promise<void> {
  const canvas = page.getByLabel('材质场景主持人预览', { exact: true })
  await expect(canvas).toBeVisible()
  for (const world of points) {
    const target = await canvas.evaluate((node, { world, bounds }) => {
      const box = node.getBoundingClientRect(), x = box.x + (world.x - bounds.x) / bounds.width * box.width, y = box.y + (world.y - bounds.y) / bounds.height * box.height
      return { x, y, hitCanvas: document.elementFromPoint(x, y) === node }
    }, { world, bounds })
    expect(target.hitCanvas, `Scope point ${JSON.stringify(world)} must reach the actual canvas`).toBe(true)
    await page.mouse.click(target.x, target.y)
  }
}

test('local terrain scope creates real heights and cliff edges, adopts once, undoes and redoes once, and survives backup import and cold reopen', async ({ page, browser }, info) => {
  test.setTimeout(300000)
  await page.setViewportSize({ width: 1440, height: 1000 })
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await createKeyboardProject(page, '局部台地完整保存与撤销')
  const resources = await openWorkspaceModule(page, '地形')
  await resources.getByRole('group', { name: '室外任务', exact: true }).getByRole('button', { name: /^地形与高程/ }).click()
  const outdoor = page.getByTestId('workspace-inspector').locator('.outdoor-panel.workspace-tool-parameters')
  await openDetailsBySummary(outdoor, /^精确坐标 · 区域轮廓$/)
  await outdoor.getByLabel('室外坐标', { exact: true }).fill('3000,3000\n7000,3000\n7000,7000\n3000,7000')
  await commitNumber(outdoor, '地形高程', '1')
  await outdoor.getByRole('button', { name: '预览室外修改', exact: true }).click()
  await adoptOutdoor(page)
  const before = await keyboardProjectBackup(page, info.outputPath('sculpt-before.sceneweave'))
  expect(Object.keys(before.document.terrainAreas)).toHaveLength(1)
  const source = Object.values(before.document.terrainAreas)[0]
  expect(source.groundElevationMm).toBe(1000)
  const points = [{ x: 4000, y: 4000 }, { x: 6000, y: 4000 }, { x: 6000, y: 6000 }, { x: 4000, y: 6000 }]
  let tools = await startSculpt(page, source.id)
  await commitNumber(tools, '局部目标高程', '2.5')
  await tools.getByRole('button', { name: '在画布画局部范围', exact: true }).click()
  await page.getByRole('button', { name: '适应全图', exact: true }).click()
  await clickScope(page, points, before.document.exportBoundsMm)
  await expect(tools).toContainText('已取 4 个点')
  await openWorkspaceModule(page, '场景')
  await clickScope(page, [{ x: 5000, y: 5000 }], before.document.exportBoundsMm)
  await page.getByRole('button', { name: '返回当前工具与草稿', exact: true }).click()
  await expect(tools).toBeVisible()
  await expect(tools).toContainText('已取 4 个点')
  await expect(page.locator('.workspace-unified')).toHaveAttribute('data-revision', String(before.document.revision))
  const viewport = page.getByRole('group', { name: '地图视口', exact: true })
  await viewport.focus(); await viewport.press('Enter')
  const review = reviewFor(page)
  await expect(review).toContainText('新增局部台地')
  await expect(review.getByRole('button', { name: '采用室外修改', exact: true })).toBeDisabled()
  await expect(page.locator('.workspace-unified')).toHaveAttribute('data-revision', String(before.document.revision))
  await page.screenshot({ path: info.outputPath('sculpt-candidate.png'), animations: 'disabled' })
  await review.getByRole('button', { name: '取消室外预览', exact: true }).click()
  await keyboardWorkspaceSaved(page)
  expect((await keyboardProjectBackup(page, info.outputPath('sculpt-cancelled.sceneweave'))).hashes).toEqual(before.hashes)

  tools = await startSculpt(page, source.id)
  await commitNumber(tools, '局部目标高程', '2.5')
  await tools.getByRole('button', { name: '在画布画局部范围', exact: true }).click()
  await clickScope(page, points, before.document.exportBoundsMm)
  // Ordinary DOM actions in the same task exercise cancellation before the
  // awaited candidate continuation, without replacing a Workspace API.
  await tools.evaluate(node => {
    const buttons = [...node.querySelectorAll<HTMLButtonElement>('button')]
    const preview = buttons.find(button => button.textContent?.trim() === '预览局部高程与崖边')
    const cancel = buttons.find(button => button.textContent?.trim() === '取消局部塑形草稿')
    if (!preview || !cancel || preview.disabled || cancel.disabled) throw new Error('Expected enabled sculpt preview/cancel controls.')
    preview.click(); cancel.click()
  })
  await keyboardWorkspaceSaved(page)
  await expect(review).toHaveCount(0)
  expect((await keyboardProjectBackup(page, info.outputPath('sculpt-pending-cancelled.sceneweave'))).hashes).toEqual(before.hashes)

  tools = await startSculpt(page, source.id)
  await commitNumber(tools, '局部目标高程', '2.5')
  await tools.getByRole('button', { name: '在画布画局部范围', exact: true }).click()
  await clickScope(page, points, before.document.exportBoundsMm)
  await tools.getByRole('button', { name: '预览局部高程与崖边', exact: true }).click()
  await adoptOutdoor(page)
  const adopted = await keyboardProjectBackup(page, info.outputPath('sculpt-adopted.sceneweave'))
  const created = Object.values(adopted.document.terrainAreas).filter(area => area.id !== source.id)
  expect(created).toHaveLength(1)
  const local = created[0]
  expect(local.groundElevationMm).toBe(2500); expect(local.coveragePriority).toBe(source.coveragePriority + 1)
  expect(local.boundaryMm.map(point => point.positionMm)).toEqual(points)
  expect(adopted.document.terrainAreas[source.id]).toEqual(source)
  expect(adopted.document.entityLayers[local.id]).toBe(before.document.entityLayers[source.id])
  expect(adopted.document.revision).toBe(before.document.revision + 1)
  expect(Object.values(adopted.document.terrainEdges)).toHaveLength(4)
  for (const edge of Object.values(adopted.document.terrainEdges)) expect(edge).toMatchObject({ source: { areaId: local.id }, neighborAreaId: source.id, kind: 'cliff', blocksMovement: true })
  for (const [id, token] of Object.entries(before.identity.outdoorTokens)) expect(adopted.identity.outdoorTokens[id]).toEqual(token)
  expect(keyboardResourceHashes(adopted.hashes)).toEqual(keyboardResourceHashes(before.hashes))
  await page.screenshot({ path: info.outputPath('sculpt-adopted.png'), animations: 'disabled' })

  await page.getByRole('button', { name: '撤销编辑', exact: true }).click()
  await keyboardWorkspaceSaved(page)
  const undone = await keyboardProjectBackup(page, info.outputPath('sculpt-undone.sceneweave'))
  expect(undone.document).toEqual({ ...before.document, revision: before.document.revision + 2, updatedAt: undone.document.updatedAt })
  await page.getByRole('button', { name: '重做编辑', exact: true }).click()
  await keyboardWorkspaceSaved(page)
  const backupPath = info.outputPath('sculpt-redone.sceneweave')
  const redone = await keyboardProjectBackup(page, backupPath)
  expect(redone.document).toEqual({ ...adopted.document, revision: before.document.revision + 3, updatedAt: redone.document.updatedAt })

  const freshContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  try {
    const fresh = await freshContext.newPage()
    fresh.on('pageerror', error => errors.push(error.message))
    await fresh.goto(new URL('./#home', page.url()).href)
    const choosing = fresh.waitForEvent('filechooser')
    await fresh.getByTestId('workspace-home').getByRole('button', { name: '打开工程文件', exact: true }).click()
    await (await choosing).setFiles(backupPath)
    await keyboardWorkspaceSaved(fresh)
    const imported = await keyboardProjectBackup(fresh, info.outputPath('sculpt-imported.sceneweave'))
    expect(imported.document).toEqual({ ...redone.document, sceneId: imported.document.sceneId, revision: 0, createdAt: imported.document.createdAt, updatedAt: imported.document.updatedAt })
    expect(imported.identity).toEqual(redone.identity); expect(imported.appearance).toEqual(redone.appearance)
    expect(keyboardResourceHashes(imported.hashes)).toEqual(keyboardResourceHashes(redone.hashes))
    await fresh.reload()
    await fresh.goto(new URL('./#home', fresh.url()).href)
    const saved = fresh.getByTestId('workspace-home').locator(`[data-project-key="native:${imported.document.sceneId}"]`)
    await saved.getByRole('button', { name: '打开', exact: true }).click()
    await keyboardWorkspaceSaved(fresh)
    const cold = await keyboardProjectBackup(fresh, info.outputPath('sculpt-cold.sceneweave'))
    expect(cold.hashes).toEqual(imported.hashes)
  } finally {
    await freshContext.close()
  }
  expect(errors).toEqual([])
})
