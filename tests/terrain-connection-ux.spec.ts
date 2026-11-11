import { expect, test, type Page } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { checkTerrainTravel } from '../src/shared/geometry/terrain-travel'
import { clickKeyboardWorldPoint, createKeyboardProject, keyboardProjectBackup, keyboardResourceHashes, keyboardWorkspaceSaved } from './keyboard-ux-helpers'
import { openOutdoorTask, closeWorkspaceDrawers } from './workspace-navigation-helpers'
import { openDetailsBySummary, reloadSaved } from './workspace-ux-helpers'

async function closeDrawers(page: Page): Promise<void> {
  await closeWorkspaceDrawers(page)
}

for (const scenario of [
  { kind: 'stairs', label: '台阶', size: { width: 1512, height: 982 } },
  { kind: 'ramp', label: '坡道', size: { width: 390, height: 844 } },
] as const) test(`production ${scenario.label} Enter preview, cancellation, adoption, single undo and cold-read at ${scenario.size.width}px`, async ({ page, browser }, info) => {
  test.setTimeout(180000)
  await page.setViewportSize(scenario.size)
  const errors: string[] = [], focus: unknown[] = [], drawingPoints: unknown[] = []
  page.on('pageerror', error => errors.push(error.message))
  const key = async (value: string, step: string) => {
    await page.keyboard.press(value)
    focus.push({ key: value, step, ...await page.evaluate(() => {
      const node = document.activeElement
      return { tag: node?.tagName, name: node?.getAttribute('aria-label') ?? node?.textContent?.trim().slice(0, 80) }
    }) })
  }
  await createKeyboardProject(page, `高差连接 ${scenario.label} ${scenario.size.width}`)
  const tools = await openOutdoorTask(page, '地形与高程')
  const review = page.getByRole('region', { name: '候选审阅', exact: true })
  const revision = page.locator('.workspace-unified')
  const viewport = page.getByRole('group', { name: '地图视口', exact: true })
  await openDetailsBySummary(tools, /^精确坐标 · 区域轮廓$/)
  await tools.getByLabel('室外坐标', { exact: true }).fill('7300,1000\n12500,1000\n12500,9000\n7300,9000')
  await tools.getByLabel('地形高程', { exact: true }).fill('1.2')
  await tools.getByLabel('地形高程', { exact: true }).press('Tab')
  await openDetailsBySummary(tools, /^重叠地形的显示顺序$/)
  await tools.getByLabel('地形覆盖优先级', { exact: true }).fill('1')
  await tools.getByRole('button', { name: '预览室外修改', exact: true }).click()
  await expect(review).toContainText('新建地形')
  await review.getByLabel('确认完整影响范围', { exact: true }).check()
  await review.getByRole('button', { name: '采用室外修改', exact: true }).click()
  await expect(review).toHaveCount(0)
  await keyboardWorkspaceSaved(page)
  const before = await keyboardProjectBackup(page, info.outputPath('connection-before.sceneweave'))
  const [high] = Object.values(before.document.terrainAreas)
  expect(Object.keys(before.document.terrainAreas)).toHaveLength(1)
  expect(high.groundElevationMm).toBe(1200)
  expect(Object.keys(before.document.terrainConnections)).toHaveLength(0)
  const floorId = high.floorId
  const from = { x: 4000, y: 5000 }, to = { x: 9000, y: 5000 }
  const travelRequest = { floorId, from, to, widthMm: 800 }
  const beforeTravel = checkTerrainTravel(before.document, travelRequest)
  expect(beforeTravel.ok).toBe(false)
  expect(beforeTravel.issues.some(issue => issue.code === 'TERRAIN_HEIGHT_CONNECTION')).toBe(true)

  const configureAndPreview = async () => {
    const tools = await openOutdoorTask(page, '台阶 / 坡道')
    await tools.getByLabel('连接起点表面', { exact: true }).selectOption(`floor:${floorId}`)
    await tools.getByLabel('连接终点表面', { exact: true }).selectOption(`terrainArea:${high.id}`)
    await tools.getByLabel('高差连接类型', { exact: true }).selectOption(scenario.kind)
    await tools.getByLabel('室外通路净宽', { exact: true }).fill('0.9')
    await tools.getByLabel('室外通路净宽', { exact: true }).press('Tab')
    await tools.getByRole('button', { name: '在画布逐点绘制', exact: true }).click()
    await closeDrawers(page)
    await keyboardWorkspaceSaved(page)
    await page.getByRole('button', { name: '适应全图', exact: true }).click()
    await expect(page.getByLabel('地图缩放比例', { exact: true })).toHaveText('100%')
    const canvas = page.getByLabel('材质场景主持人预览', { exact: true })
    await expect(canvas).toBeInViewport()
    // Verify the actual click targets; a fractional canvas edge can lie outside
    // the scrollport even when both drawing points are visible and unobscured.
    const targets = await canvas.evaluate((node, { points, bounds }) => {
      const box = node.getBoundingClientRect()
      return points.map(point => {
        const x = box.x + (point.x - bounds.x) / bounds.width * box.width
        const y = box.y + (point.y - bounds.y) / bounds.height * box.height
        return { world: point, x, y, hitCanvas: document.elementFromPoint(x, y) === node }
      })
    }, { points: [from, to], bounds: before.document.exportBoundsMm })
    expect(targets.every(point => point.hitCanvas), JSON.stringify(targets)).toBe(true)
    drawingPoints.push(targets)
    await clickKeyboardWorldPoint(page, from, before.document.exportBoundsMm)
    await clickKeyboardWorldPoint(page, to, before.document.exportBoundsMm)
    await viewport.focus()
    await key('Enter', 'finish actual two-point connection into original review')
    await expect(review).toContainText('创建高差连接')
    await keyboardWorkspaceSaved(page)
    await expect(revision).toHaveAttribute('data-revision', String(before.document.revision))
    await expect(review.getByRole('button', { name: '采用室外修改', exact: true })).toBeDisabled()
    await viewport.focus()
    await key('Enter', 'Enter cannot adopt existing connection candidate')
    await expect(review.getByRole('button', { name: '采用室外修改', exact: true })).toBeDisabled()
  }
  await configureAndPreview()
  const changes = review.locator('details.composition-preview-details')
  await changes.locator(':scope > summary').focus()
  await key('Enter', 'expand actual connection changes')
  await expect(changes).toHaveAttribute('open', '')
  const cancel = review.getByRole('button', { name: '取消室外预览', exact: true })
  const adopt = review.getByRole('button', { name: '采用室外修改', exact: true })
  await cancel.scrollIntoViewIfNeeded()
  await expect(cancel).toBeInViewport({ ratio: 1 })
  await page.screenshot({ path: info.outputPath('connection-preview.png') })
  const candidateSemantics = await review.ariaSnapshot()
  await cancel.focus()
  await key('Enter', 'cancel candidate using actual button keyboard action')
  await expect(review).toHaveCount(0)
  await keyboardWorkspaceSaved(page)
  expect((await keyboardProjectBackup(page, info.outputPath('connection-cancelled.sceneweave'))).hashes).toEqual(before.hashes)

  await configureAndPreview()
  await viewport.focus()
  await key('Escape', 'cancel second candidate from canvas')
  await expect(review).toHaveCount(0)
  await keyboardWorkspaceSaved(page)
  expect((await keyboardProjectBackup(page, info.outputPath('connection-escaped.sceneweave'))).hashes).toEqual(before.hashes)

  await configureAndPreview()
  await review.getByLabel('确认完整影响范围', { exact: true }).focus()
  await key('Space', 'confirm complete connection scope')
  await expect(adopt).toBeEnabled()
  await key('Tab', 'reach connection cancel')
  await expect(cancel).toBeFocused()
  await key('Tab', 'reach connection adopt')
  await expect(adopt).toBeFocused()
  await expect(adopt).toBeInViewport({ ratio: 1 })
  await key('Enter', 'adopt connection as one edit')
  await expect(review).toHaveCount(0)
  await keyboardWorkspaceSaved(page)
  const adopted = await keyboardProjectBackup(page, info.outputPath('connection-adopted.sceneweave'))
  const [connection] = Object.values(adopted.document.terrainConnections)
  expect(Object.keys(adopted.document.terrainConnections)).toHaveLength(1)
  expect(connection).toMatchObject({
    kind: scenario.kind, floorId, from: { surfaceRef: { kind: 'floor', id: floorId }, positionMm: from },
    to: { surfaceRef: { kind: 'terrainArea', id: high.id }, positionMm: to }, widthMm: 900,
    visibility: 'public', editLocked: false, openingId: null, blocksMovement: false, movementCostMultiplier: 1,
  })
  expect(connection.route).toBeUndefined()
  expect(adopted.document.revision).toBe(before.document.revision + 1)
  expect(adopted.document.terrainAreas).toEqual(before.document.terrainAreas)
  expect(adopted.document.entityLayers[connection.id]).toBe(before.document.entityLayers[high.id])
  expect(adopted.identity.outdoorTokens[connection.id]).toBeTruthy()
  expect(keyboardResourceHashes(adopted.hashes)).toEqual(keyboardResourceHashes(before.hashes))
  const adoptedTravel = checkTerrainTravel(adopted.document, travelRequest)
  expect(adoptedTravel.ok, JSON.stringify(adoptedTravel.issues)).toBe(true)
  const tooWide = checkTerrainTravel(adopted.document, { ...travelRequest, widthMm: 1000 })
  expect(tooWide.ok).toBe(false)
  expect(tooWide.issues.some(issue => issue.code === 'TERRAIN_HEIGHT_CONNECTION')).toBe(true)
  await page.getByRole('button', { name: '适应全图', exact: true }).click()
  await page.screenshot({ path: info.outputPath('connection-adopted.png') })

  await viewport.focus()
  await key('ControlOrMeta+Z', 'undo complete connection transaction')
  await keyboardWorkspaceSaved(page)
  const undone = await keyboardProjectBackup(page, info.outputPath('connection-undone.sceneweave'))
  expect(undone.document).toEqual({ ...before.document, revision: before.document.revision + 2, updatedAt: undone.document.updatedAt })
  expect(keyboardResourceHashes(undone.hashes)).toEqual(keyboardResourceHashes(before.hashes))
  expect(checkTerrainTravel(undone.document, travelRequest).ok).toBe(false)
  await viewport.focus()
  await key('ControlOrMeta+Shift+Z', 'redo complete connection transaction')
  await keyboardWorkspaceSaved(page)
  const redone = await keyboardProjectBackup(page, info.outputPath('connection-redone.sceneweave'))
  expect(redone.document).toEqual({ ...adopted.document, revision: before.document.revision + 3, updatedAt: redone.document.updatedAt })
  expect(checkTerrainTravel(redone.document, travelRequest).ok).toBe(true)
  await reloadSaved(page)
  await keyboardWorkspaceSaved(page)
  const reloaded = await keyboardProjectBackup(page, info.outputPath('connection-reloaded.sceneweave'))
  expect(reloaded.hashes).toEqual(redone.hashes)
  expect(reloaded.document).toEqual(redone.document)
  expect(reloaded.identity).toEqual(redone.identity)
  expect(reloaded.appearance).toEqual(redone.appearance)
  expect(checkTerrainTravel(reloaded.document, travelRequest).ok).toBe(true)
  // A full page reload also discards the in-memory workspace and validators.
  await page.reload()
  await expect(page.locator('.asset-save')).toHaveText('尚未打开工程')
  await page.getByRole('button', { name: '回到首页', exact: true }).click()
  const savedRow = page.getByTestId('workspace-home').locator(`[data-project-key="native:${before.document.sceneId}"]`)
  await expect(savedRow.getByRole('heading', { name: before.document.title, exact: true })).toBeVisible()
  await savedRow.getByRole('button', { name: '打开', exact: true }).click()
  await keyboardWorkspaceSaved(page)
  const cold = await keyboardProjectBackup(page, info.outputPath('connection-cold.sceneweave'))
  expect(cold.hashes).toEqual(redone.hashes)
  expect(cold.document).toEqual(redone.document)
  expect(cold.identity).toEqual(redone.identity)
  expect(cold.appearance).toEqual(redone.appearance)
  expect(checkTerrainTravel(cold.document, travelRequest).ok).toBe(true)
  const dimensions = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, root: document.documentElement.scrollWidth, body: document.body.scrollWidth }))
  expect(dimensions.root).toBeLessThanOrEqual(dimensions.width)
  expect(dimensions.body).toBeLessThanOrEqual(dimensions.width)
  expect(errors).toEqual([])
  const facts = { kind: scenario.kind, size: scenario.size, browserVersion: browser.version(), dimensions, high, connection, beforeTravel, adoptedTravel, tooWide, drawingPoints, focus, candidateSemantics, coldRead: 'normal reload-saved UI, full page reload, then open the persisted project from the home recent list', revisions: [before.document.revision, adopted.document.revision, undone.document.revision, redone.document.revision, reloaded.document.revision, cold.document.revision], errors, excluded: ['full traversal/pathfinding acceptance', 'curved or room-attached connections', 'all locks and failure matrix', 'real IME or screen-reader speech', 'visual P3'] }
  const path = info.outputPath('connection-facts.json')
  await writeFile(path, JSON.stringify(facts, null, 2))
  await info.attach('connection-facts.json', { path, contentType: 'application/json' })
})
