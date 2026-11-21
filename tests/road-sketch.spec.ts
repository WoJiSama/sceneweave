import { expect, test, type Page } from '@playwright/test'
import { createServer } from 'vite'
import type { BoundsMm, PointMm } from '../src/shared/model/scene'
import { createRouteSupportCheck, pathPolygon } from '../src/shared/geometry/geometry'
import { checkTerrainRoute } from '../src/shared/geometry/terrain-travel'
import { planStaircase } from '../src/shared/stairs/geometry'
import { projectScene } from '../src/shared/projection/projection'
import { keyboardProjectBackup, keyboardWorkspaceSaved } from './keyboard-ux-helpers'
import { openSceneObjects, openTerrainTask } from './workspace-navigation-helpers'
import { openDetailsBySummary } from './workspace-ux-helpers'

const review = (page: Page) => page.getByRole('region', { name: '候选审阅', exact: true })

async function importRoadProject(page: Page, archive: string | Uint8Array) {
  const choosing = page.waitForEvent('filechooser')
  await page.getByTestId('workspace-home').getByRole('button', { name: '打开工程文件', exact: true }).click()
  await (await choosing).setFiles(typeof archive === 'string'
    ? archive : { name: 'terraces.sceneweave', mimeType: 'application/octet-stream', buffer: Buffer.from(archive) })
  await keyboardWorkspaceSaved(page)
}

async function roadTools(page: Page) {
  await openTerrainTask(page, '绘制地形')
  await page.getByRole('group', { name: '室外任务', exact: true }).getByRole('button', { name: /^道路/ }).click()
  return page.getByRole('region', { name: '道路参数', exact: true })
}

async function dragRoad(page: Page, bounds: BoundsMm, points: PointMm[], during?: () => Promise<void>) {
  await page.getByRole('button', { name: '在画布拖画道路', exact: true }).click()
  const canvas = page.getByLabel('材质场景主持人预览', { exact: true })
  const box = await canvas.boundingBox()
  if (!box) throw new Error('Road sketch requires the visible map canvas')
  for (const [index, point] of points.entries()) {
    const x = box.x + (point.x - bounds.x) * box.width / bounds.width
    const y = box.y + (point.y - bounds.y) * box.height / bounds.height
    await page.mouse.move(x, y, { steps: index ? 5 : 1 })
    if (!index) await page.mouse.down()
  }
  await during?.()
  await page.mouse.up()
}

async function adoptRoad(page: Page) {
  await expect(review(page)).toBeVisible()
  await review(page).getByLabel('确认完整影响范围', { exact: true }).check()
  await review(page).getByRole('button', { name: '采用室外修改', exact: true }).click()
  await keyboardWorkspaceSaved(page)
}

test('dragged roads preserve a supported stroke and keep an excavated switchback and its stairs through undo and backup import', async ({ page }, info) => {
  test.setTimeout(240000)
  page.setDefaultTimeout(12000)
  const vite = await createServer({ configFile: false, logLevel: 'error', cacheDir: info.outputPath('ssr-cache'),
    server: { middlewareMode: true, hmr: false, watch: { ignored: ['**/*'] } }, optimizeDeps: { noDiscovery: true } })
  let archive: Uint8Array
  try {
    const { fixture, runtime, validation } = await vite.ssrLoadModule('/src/application/workspace/test-fixtures.ts')
    const { createCompositionContent } = await vite.ssrLoadModule('/src/shared/appearance/graph.ts')
    const { applyCompositionDraftCommands } = await vite.ssrLoadModule('/src/shared/appearance/commands.ts')
    const { exportProject } = await vite.ssrLoadModule('/src/shared/project/file.ts')
    const bundle = fixture()
    const scene = bundle.project.document
    scene.title = '折返山路'
    scene.units.display = 'm'
    scene.props = {}
    delete scene.entityLayers.item
    delete scene.entityLayers.other
    const area = (id: string, left: number, right: number, top: number, bottom: number, height: number, priority: number) => ({
      type: 'createTerrainArea', id, floorId: 'blank-floor', visibility: 'public', groundElevationMm: height,
      coveragePriority: priority, boundaryMm: [{ x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom }],
    })
    Object.assign(bundle.project, applyCompositionDraftCommands(createCompositionContent(scene, runtime), [
      area('low', 1000, 11500, 1000, 11800, 1000, 1),
      area('high', 5500, 10900, 2000, 11200, 3000, 2),
      { type: 'createTerrainArea', id: 'narrow', floorId: 'blank-floor', visibility: 'public', groundElevationMm: 700, coveragePriority: 3,
        boundaryMm: [{ x: 12400, y: 2000 }, { x: 18800, y: 2000 }, { x: 18800, y: 6000 }, { x: 15500, y: 6000 },
          { x: 15500, y: 4600 }, { x: 13800, y: 4600 }, { x: 13800, y: 6000 }, { x: 12400, y: 6000 }] },
    ], runtime))
    archive = await exportProject(bundle, validation)
  } finally {
    await vite.close()
  }

  await page.goto('./#home')
  await importRoadProject(page, archive)
  const original = await keyboardProjectBackup(page, info.outputPath('terraces.sceneweave'))
  const bounds = original.document.exportBoundsMm
  let tools = await roadTools(page)
  await dragRoad(page, bounds, [{ x: 13500, y: 3850 }, { x: 16900, y: 3850 }], async () => {
    await expect(page.locator('.asset-selection-notice')).toContainText('已按承托收窄受限路段')
  })
  await page.getByRole('group', { name: '地图视口', exact: true }).press('Enter')
  await adoptRoad(page)
  const automatic = (await keyboardProjectBackup(page, info.outputPath('automatic-width.sceneweave'))).document
  const narrowRoad = Object.values(automatic.paths)[0]
  expect(narrowRoad.widthMm).toBe(2000)
  expect(narrowRoad.widthSections?.every(section => section.widthMm < narrowRoad.widthMm)).toBe(true)
  expect(narrowRoad.supportRefs).toEqual([{ kind: 'terrainArea', id: 'narrow' }])
  await page.getByRole('button', { name: '撤销编辑', exact: true }).click()
  await keyboardWorkspaceSaved(page)
  tools = await roadTools(page)
  const width = tools.getByLabel('室外通路净宽', { exact: true })
  await width.fill('1')
  await width.press('Tab')
  await expect(tools.getByLabel('遇到窄地形时允许收窄默认宽度')).not.toBeChecked()
  await dragRoad(page, bounds, [{ x: 3000, y: 5000 }, { x: 3000, y: 2700 }, { x: 3000, y: 750 }], async () => {
    await expect(page.getByTestId('road-width-preview')).toBeAttached()
    await expect(page.getByTestId('road-outside-support')).toBeAttached()
  })
  await page.getByRole('group', { name: '地图视口', exact: true }).press('Enter')
  await adoptRoad(page)
  const supported = await keyboardProjectBackup(page, info.outputPath('supported.sceneweave'))
  const flatRoad = Object.values(supported.document.paths)[0]
  expect(flatRoad.supportRefs).toEqual([{ kind: 'terrainArea', id: 'low' }])
  expect(flatRoad.centerlineMm.at(-1)!.y).toBeGreaterThanOrEqual(1500)
  const objects = await openSceneObjects(page, '结构')
  await objects.getByLabel('搜索场景对象', { exact: true }).fill(flatRoad.id)
  await objects.locator(`[data-entity-id="${flatRoad.id}"]`).click()
  await page.getByText('局部路宽', { exact: true }).click()
  await page.getByRole('button', { name: '添加局部路宽', exact: true }).click()
  const localWidth = page.getByLabel('路段 1 净宽', { exact: true })
  await localWidth.fill('1.5')
  await localWidth.press('Tab')
  await page.getByRole('button', { name: '预览对象修改', exact: true }).click()
  await adoptRoad(page)
  const profiled = (await keyboardProjectBackup(page, info.outputPath('profiled.sceneweave'))).document.paths[flatRoad.id]
  expect(profiled).toEqual({ ...flatRoad, widthSections: [{ startPpm: 250_000, endPpm: 750_000, widthMm: 1500 }] })
  await page.getByText('沿线铺设构件', { exact: true }).click()
  const assembly = page.getByRole('group', { name: '沿线构件参数', exact: true })
  await assembly.getByLabel('重复源节', { exact: true }).selectOption('timber')
  await assembly.getByLabel('铺设侧', { exact: true }).selectOption('left')
  await assembly.getByRole('button', { name: '预览更新沿线构件', exact: true }).click()
  await adoptRoad(page)
  const fenced = (await keyboardProjectBackup(page, info.outputPath('fenced.sceneweave'))).document
  const rail = Object.values(fenced.paths[flatRoad.id].assembly!.members).find(member => member.state === 'placed')!
  if (rail.state !== 'placed') throw Error('The road should have a rail')
  expect(fenced.paths[flatRoad.id].widthSections).toEqual(profiled.widthSections)
  const fencedWidth = assembly.getByLabel('路段 1 净宽', { exact: true })
  await fencedWidth.fill('1.35')
  await fencedWidth.press('Tab')
  await assembly.getByRole('button', { name: '预览更新沿线构件', exact: true }).click()
  await adoptRoad(page)
  const adjusted = (await keyboardProjectBackup(page, info.outputPath('fenced-width.sceneweave'))).document
  expect(adjusted.paths[flatRoad.id].widthSections?.[0].widthMm).toBe(1350)
  expect(adjusted.props[rail.propId].positionMm).not.toEqual(fenced.props[rail.propId].positionMm)
  await page.getByText('沿道路铺阶', { exact: true }).click()
  await page.getByLabel('只铺路线的一段', { exact: true }).check()
  await page.getByRole('button', { name: '预览道路铺阶', exact: true }).click(); await adoptRoad(page)
  const paved = await keyboardProjectBackup(page, info.outputPath('road-stairs.sceneweave'))
  const stairsOnPath = paved.document.paths[flatRoad.id]
  expect(stairsOnPath.widthSections).toEqual(adjusted.paths[flatRoad.id].widthSections)
  expect(stairsOnPath.staircase?.range).toEqual({ startPpm: 250000, endPpm: 750000 })
  expect(projectScene(paved.document, 'player', paved.appearance).paths.find(path => path.id === flatRoad.id)?.stairs?.widthSections).toEqual(stairsOnPath.widthSections)
  for (let step = 0; step < 5; step++) {
    await page.getByRole('button', { name: '撤销编辑', exact: true }).click()
    await keyboardWorkspaceSaved(page)
  }

  tools = await roadTools(page)
  await tools.getByLabel('室外通路净宽', { exact: true }).fill('1')
  await tools.getByLabel('室外通路净宽', { exact: true }).press('Tab')
  await tools.getByLabel('自动圆滑道路', { exact: true }).check()
  await openDetailsBySummary(tools, /^道路沿边构件$/)
  await tools.getByLabel('重复源节', { exact: true }).selectOption('profile:ironPickets')
  await tools.getByLabel('铺设侧', { exact: true }).selectOption('left')
  await dragRoad(page, bounds, [{ x: 2100, y: 3500 }, { x: 3300, y: 5400 }, { x: 4300, y: 7400 }])
  await page.getByRole('group', { name: '地图视口', exact: true }).press('Enter'); await adoptRoad(page)
  const smoothed = (await keyboardProjectBackup(page, info.outputPath('smoothed.sceneweave'))).document
  const curve = Object.values(smoothed.paths)[0]
  expect(curve.centerlineMm.length).toBeGreaterThan(3)
  expect(curve.assembly?.recipe).toMatchObject({ section: { kind: 'profile', profile: 'ironPickets' }, sides: 'left' })
  expect(Object.keys(curve.assembly!.members).every(key => key.startsWith('left:'))).toBe(true)
  expect(createRouteSupportCheck(smoothed, curve.floorId, curve.supportRefs).band(pathPolygon(curve))).toBe(true)
  await page.getByRole('button', { name: '撤销编辑', exact: true }).click(); await keyboardWorkspaceSaved(page)

  tools = await roadTools(page)
  await tools.getByLabel('自动圆滑道路', { exact: true }).uncheck()
  await tools.getByLabel('室外通路净宽', { exact: true }).fill('1')
  await tools.getByLabel('室外通路净宽', { exact: true }).press('Tab')
  await tools.getByLabel('开凿山路', { exact: true }).check()
  await tools.getByLabel('铺设台阶', { exact: true }).check()
  await tools.getByLabel('只铺路线的一段', { exact: true }).check()
  await dragRoad(page, bounds, [
    { x: 2000, y: 3000 }, { x: 3900, y: 3000 }, { x: 3900, y: 10500 },
    { x: 6100, y: 10500 }, { x: 6100, y: 3000 }, { x: 7000, y: 3000 },
  ])
  await page.getByRole('group', { name: '地图视口', exact: true }).press('Enter')
  await expect(review(page).getByRole('region', { name: '山路填切影响范围', exact: true })).toBeVisible()
  await expect(review(page)).toContainText('开凿山路并局部铺阶')
  await adoptRoad(page)
  const backupPath = info.outputPath('switchback.sceneweave')
  const adopted = await keyboardProjectBackup(page, backupPath)
  const road = Object.values(adopted.document.terrainConnections)[0]
  expect(road).toMatchObject({ widthMm: 1000, staircase: { layout: { kind: 'repeat' }, range: { startPpm: 250_000, endPpm: 750_000 } } })
  const cut = road.terrainInlay!
  const points = cut.centerlineVertexIds.map(id => cut.geometry.verticesMm[id])
  const length = points.slice(1).reduce((sum, p, index) => sum + Math.hypot(p.x - points[index].x, p.y - points[index].y), 0)
  expect(length).toBeGreaterThan(19500)
  expect(Math.hypot(points[0].x - points.at(-1)!.x, points[0].y - points.at(-1)!.y)).toBeLessThan(5200)
  expect(points.some(point => point.y > 10200)).toBe(true)
  expect(adopted.document.terrainAreas).toEqual(original.document.terrainAreas)
  const travel = checkTerrainRoute(adopted.document, { floorId: road.floorId, pointsMm: points.map(({ x, y }) => ({ x, y })), widthMm: road.widthMm })
  expect(travel.issues).toEqual([])
  const stairs = planStaircase(points, road.widthMm, road.staircase!)
  expect(stairs.lengthMm).toBeCloseTo(length / 2, 2)
  expect(stairs.treads.at(-1)!.endMm).toBe(stairs.lengthMm)
  expect(stairs.footprintMm.some(point => point.y > 10200)).toBe(true)

  await page.getByRole('button', { name: '撤销编辑', exact: true }).click()
  await keyboardWorkspaceSaved(page)
  const undone = await keyboardProjectBackup(page, info.outputPath('undone.sceneweave'))
  expect(undone.document.terrainConnections).toEqual(original.document.terrainConnections)
  await page.reload()
  await page.getByRole('button', { name: '回到首页', exact: true }).click()
  await importRoadProject(page, backupPath)
  const imported = await keyboardProjectBackup(page, info.outputPath('imported.sceneweave'))
  expect(imported.document.terrainConnections[road.id]).toEqual(road)
})
