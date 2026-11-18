import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'vite'
import type { TerrainConnection } from '../src/shared/model/scene'
import { keyboardProjectBackup, keyboardResourceHashes, keyboardWorkspaceSaved } from './keyboard-ux-helpers'
import { openSceneObjects, openTerrainTask } from './workspace-navigation-helpers'
import { mapExportButton, openDetailsBySummary, reloadSaved } from './workspace-ux-helpers'

const review = (page: Page) => page.getByRole('region', { name: '候选审阅', exact: true })
const stairLength = (connection: TerrainConnection) => {
  const points = connection.route?.centerlineMm ?? [connection.from.positionMm, connection.to.positionMm]
  return points.slice(1).reduce((sum, point, index) => sum + Math.hypot(point.x - points[index].x, point.y - points[index].y), 0)
}
const physical = (connection: TerrainConnection) => { const { staircase: _staircase, ...rest } = connection; return rest }
async function adopt(page: Page) {
  await expect(review(page)).toBeVisible()
  const confirmation = review(page).getByLabel('确认完整影响范围', { exact: true })
  if (await confirmation.count()) await confirmation.check()
  await review(page).getByRole('button', { name: /^采用(?:结构|室外|视觉|组件)修改$/ }).click()
  await keyboardWorkspaceSaved(page)
}
async function cancel(page: Page) {
  await review(page).getByRole('button', { name: /^取消(?:视觉|组件|室外|结构)预览$/ }).click()
  await keyboardWorkspaceSaved(page)
}
async function selectStair(page: Page, id: string) {
  const objects = await openSceneObjects(page, '结构')
  await objects.getByLabel('搜索场景对象', { exact: true }).fill(id)
  await objects.locator(`[data-entity-id="${id}"]`).click()
  const tools = page.locator('[data-staircase-tools]')
  await expect(tools).toBeVisible()
  return tools
}
async function shape(page: Page, id: string) {
  const tools = await selectStair(page, id)
  await openDetailsBySummary(tools, /^长度、宽度、旋转与弯曲$/)
  return tools
}
async function picture(page: Page, info: TestInfo, phase: string, audience: 'gm' | 'player') {
  const downloading = page.waitForEvent('download')
  await (await mapExportButton(page, audience)).click()
  const path = info.outputPath(`${phase}-${audience}.png`)
  await (await downloading).saveAs(path)
  await keyboardWorkspaceSaved(page)
  await page.locator('.workspace-export-menu > summary').click()
  const bytes = await readFile(path)
  expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
  expect(Math.max(bytes.readUInt32BE(16), bytes.readUInt32BE(20))).toBe(4096)
  return createHash('sha256').update(bytes).digest('hex')
}
async function drawCover(page: Page, tools: Locator) {
  const board = tools.getByTestId('staircase-cover-board')
  await board.scrollIntoViewIfNeeded()
  // Read the rendered SVG transform only; edits are actual pointer input.
  const [start, end] = await board.evaluate(node => {
    const matrix = (node as SVGSVGElement).getScreenCTM()
    if (!matrix) throw new Error('Expected the real unfolded stair cover board.')
    return [{ x: 260, y: 47 }, { x: 548, y: 143 }].map(point => {
      const result = new DOMPoint(point.x, point.y).matrixTransform(matrix)
      return { x: result.x, y: result.y }
    })
  })
  await page.mouse.move(start.x, start.y); await page.mouse.down()
  await page.mouse.move(end.x, end.y, { steps: 4 }); await page.mouse.up()
}

test('production staircase creation, independent appearance, repeat/stretch, bend, cover, history and complete cold import', async ({ page, browser }, info) => {
  test.setTimeout(300000)
  // Node SSR prepares only the input archive. Every scene edit below uses the
  // production UI; a real bitmap stays in the complete project throughout.
  const vite = await createServer({ configFile: false, logLevel: 'error', cacheDir: info.outputPath('ssr-cache'),
    server: { middlewareMode: true, hmr: false, watch: { ignored: ['**/*'] } }, optimizeDeps: { noDiscovery: true } })
  let archive: Uint8Array
  try {
    const { fixture, runtime, validation } = await vite.ssrLoadModule('/src/application/workspace/test-fixtures.ts')
    const { createCompositionContent } = await vite.ssrLoadModule('/src/shared/appearance/graph.ts')
    const { applyCompositionDraftCommands } = await vite.ssrLoadModule('/src/shared/appearance/commands.ts')
    const { exportProject } = await vite.ssrLoadModule('/src/shared/project/file.ts')
    const source = fixture({ image: true }), scene = source.project.document
    scene.title = '独立阶梯工具完整旅程'; scene.units.display = 'm'
    scene.props.item.positionMm = { x: 14000, y: 14000 }; scene.props.other.positionMm = { x: 16000, y: 16000 }
    const area = (id: string, left: number, right: number, top: number, bottom: number, z: number, priority: number) => ({
      type: 'createTerrainArea', id, floorId: 'blank-floor', boundaryMm: [{ x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom }],
      groundElevationMm: z, coveragePriority: priority, visibility: 'public', surfaceStyle: null,
    })
    Object.assign(source.project, applyCompositionDraftCommands(createCompositionContent(scene, runtime), [
      area('stairs-low', 1000, 11000, 1000, 11000, 1000, 1), area('stairs-high', 5500, 10500, 2000, 10000, 3000, 2),
    ], runtime))
    archive = await exportProject(source, validation)
  } finally { await vite.close() }
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await page.goto('./#home')
  const choosing = page.waitForEvent('filechooser')
  await page.getByTestId('workspace-home').getByRole('button', { name: '打开工程文件', exact: true }).click()
  await (await choosing).setFiles({ name: 'staircase-input.sceneweave', mimeType: 'application/octet-stream', buffer: Buffer.from(archive) })
  await keyboardWorkspaceSaved(page)
  let serial = 0
  const backup = (label: string) => keyboardProjectBackup(page, info.outputPath(`${++serial}-${label}.sceneweave`))
  const before = await backup('before')
  const configureCreation = async () => {
    await openTerrainTask(page, '绘制地形')
    await page.getByTestId('workspace-resources').getByRole('group', { name: '室外任务', exact: true }).getByRole('button', { name: /^阶梯工具/ }).click()
    const tools = page.getByRole('region', { name: '阶梯工具参数', exact: true })
    await expect(tools.getByLabel('阶梯样式', { exact: true }).locator('option')).toHaveCount(10)
    await expect(tools.getByLabel('阶梯材质', { exact: true }).locator('option')).toHaveCount(10)
    await tools.getByLabel('连接起点表面', { exact: true }).selectOption('terrainArea:stairs-low')
    await tools.getByLabel('连接终点表面', { exact: true }).selectOption('terrainArea:stairs-high')
    await tools.getByLabel('室外通路净宽', { exact: true }).fill('1')
    await tools.getByLabel('室外通路净宽', { exact: true }).press('Tab')
    await openDetailsBySummary(tools, /^精确坐标 · 连接路线节点$/)
    await tools.getByLabel('室外坐标', { exact: true }).fill('2000,6000\n9000,6000')
    await tools.getByRole('button', { name: '预览室外修改', exact: true }).click()
    await expect(review(page)).toContainText('创建独立阶梯')
  }
  await configureCreation(); await cancel(page)
  expect((await backup('cancelled-create')).hashes).toEqual(before.hashes)
  await configureCreation(); await adopt(page)
  const created = await backup('created'), [connection] = Object.values(created.document.terrainConnections), id = connection.id
  expect(Object.keys(created.document.terrainConnections)).toHaveLength(1)
  expect(connection).toMatchObject({ kind: 'stairs', widthMm: 1000, staircase: { preset: 'cut-stone', material: 'limestone', layout: { kind: 'repeat', treadDepthMm: 300 }, covers: [] } })
  expect(stairLength(connection)).toBe(7000)
  const initialPicture = await picture(page, info, 'cut-stone', 'gm')

  let tools = await selectStair(page, id)
  await tools.getByLabel('阶梯样式', { exact: true }).selectOption('timber')
  await tools.getByLabel('阶梯材质', { exact: true }).selectOption('oak')
  await tools.getByLabel('阶梯纹理尺度毫米', { exact: true }).fill('280')
  await tools.getByRole('button', { name: '预览阶梯外观', exact: true }).click(); await adopt(page)
  const appearance = await backup('oak')
  expect(physical(appearance.document.terrainConnections[id])).toEqual(physical(connection))
  expect(appearance.document.terrainConnections[id].staircase).toMatchObject({ preset: 'timber', material: 'oak', textureScaleMm: 280 })
  expect(await picture(page, info, 'oak', 'gm')).not.toBe(initialPicture)

  tools = await shape(page, id)
  await tools.getByLabel('阶梯总长度毫米', { exact: true }).fill('7500')
  await tools.getByRole('button', { name: '预览阶梯形状', exact: true }).click(); await adopt(page)
  const repeated = await backup('repeated'), repeatConnection = repeated.document.terrainConnections[id]
  expect(repeatConnection.staircase!.layout).toEqual({ kind: 'repeat', treadDepthMm: 300 })
  expect(stairLength(repeatConnection)).toBeCloseTo(7500, 0)
  expect(Math.ceil(stairLength(repeatConnection) / 300)).toBe(25)
  expect(repeatConnection.staircase!.textureScaleMm).toBe(280)
  tools = await shape(page, id)
  await tools.getByLabel('阶梯续接方式', { exact: true }).selectOption('stretch')
  await expect(tools.getByLabel('阶梯固定级数', { exact: true })).toHaveValue('25')
  await tools.getByLabel('阶梯总长度毫米', { exact: true }).fill('7800')
  await tools.getByRole('button', { name: '预览阶梯形状', exact: true }).click(); await adopt(page)
  const stretched = await backup('stretched'), stretchedConnection = stretched.document.terrainConnections[id]
  expect(stretchedConnection.staircase!.layout).toEqual({ kind: 'stretch', stepCount: 25 })
  expect(stairLength(stretchedConnection)).toBeCloseTo(7800, 0)
  expect(stretchedConnection.staircase!.textureScaleMm).toBe(280)

  tools = await shape(page, id)
  await tools.getByLabel('阶梯旋转角度', { exact: true }).fill('2')
  await tools.getByLabel('阶梯净宽毫米', { exact: true }).fill('1200')
  await tools.getByRole('button', { name: '预览阶梯形状', exact: true }).click(); await adopt(page)
  const rotated = await backup('rotated'), rotatedConnection = rotated.document.terrainConnections[id]
  expect(rotatedConnection.from).toEqual(stretchedConnection.from)
  expect(rotatedConnection.to.positionMm.y).toBeGreaterThan(stretchedConnection.to.positionMm.y)
  expect(rotatedConnection.widthMm).toBe(1200)
  expect(Math.abs(stairLength(rotatedConnection) - 7800)).toBeLessThan(2)
  tools = await shape(page, id)
  await tools.getByLabel('连接路线形态', { exact: true }).selectOption('polyline')
  await openDetailsBySummary(tools, /^精确坐标 · 阶梯路线$/)
  await tools.getByLabel('阶梯路线节点', { exact: true }).fill('2000,6000\n5000,6150\n9800,6272')
  await tools.getByRole('button', { name: '预览阶梯形状', exact: true }).click(); await adopt(page)
  const bent = await backup('bent'), bentConnection = bent.document.terrainConnections[id]
  expect(bentConnection.route).toMatchObject({ kind: 'polyline', segments: [{ end: { x: 5000, y: 6150 } }, { end: { x: 9800, y: 6272 } }] })
  expect(bentConnection.staircase!.layout).toEqual({ kind: 'stretch', stepCount: 25 })

  tools = await selectStair(page, id)
  await openDetailsBySummary(tools, /^局部覆盖与露出底层/)
  // A pointer-only draft must participate in the normal departure/history
  // guard even though it never dispatches a form input change event.
  await drawCover(page, tools)
  await expect(page.getByRole('button', { name: '撤销编辑', exact: true })).toBeDisabled()
  await tools.getByRole('button', { name: '预览阶梯外观', exact: true }).click(); await cancel(page)
  expect((await backup('cancelled-pointer-draft')).hashes).toEqual(bent.hashes)
  tools = await selectStair(page, id)
  await openDetailsBySummary(tools, /^局部覆盖与露出底层/)
  await tools.getByLabel('阶梯覆盖方式', { exact: true }).selectOption('grass')
  await openDetailsBySummary(tools, /^用百分比添加覆盖$/)
  await tools.getByRole('button', { name: '添加矩形覆盖', exact: true }).click()
  await expect(tools.getByRole('button', { name: '移除第1处阶梯覆盖', exact: true })).toBeVisible()
  await tools.getByRole('button', { name: '撤回刚加的覆盖', exact: true }).click()
  await expect(tools.getByRole('button', { name: '移除第1处阶梯覆盖', exact: true })).toHaveCount(0)
  await drawCover(page, tools)
  await expect(tools.getByRole('button', { name: '移除第1处阶梯覆盖', exact: true })).toBeVisible()
  await page.screenshot({ path: info.outputPath('cover-editor.png') })
  await tools.getByRole('button', { name: '预览阶梯外观', exact: true }).click(); await adopt(page)
  const covered = await backup('covered'), coveredConnection = covered.document.terrainConnections[id]
  expect(physical(coveredConnection)).toEqual(physical(bentConnection))
  expect(coveredConnection.staircase!.covers).toHaveLength(1)
  expect(coveredConnection.staircase!.covers[0]).toMatchObject({ kind: 'grass' })
  expect(new Set(coveredConnection.staircase!.covers[0].pointsPpm.map(point => `${point.x},${point.y}`)).size).toBe(4)
  tools = await selectStair(page, id)
  await openDetailsBySummary(tools, /^局部覆盖与露出底层/)
  await tools.getByRole('button', { name: '清除覆盖，恢复阶梯', exact: true }).click()
  await tools.getByRole('button', { name: '预览阶梯外观', exact: true }).click(); await cancel(page)
  expect((await backup('cancelled-clear')).hashes).toEqual(covered.hashes)
  await page.getByRole('button', { name: '撤销编辑', exact: true }).click(); await keyboardWorkspaceSaved(page)
  expect((await backup('undone-cover')).document.terrainConnections[id]).toEqual(bentConnection)
  await page.getByRole('button', { name: '重做编辑', exact: true }).click(); await keyboardWorkspaceSaved(page)
  const finalPath = info.outputPath('complete-staircase.sceneweave'), finished = await keyboardProjectBackup(page, finalPath)
  expect(finished.document.terrainConnections[id]).toEqual(coveredConnection)
  expect(finished.document.terrainAreas).toEqual(before.document.terrainAreas)
  expect(finished.document.props).toEqual(before.document.props)
  expect(finished.document.assets).toEqual(before.document.assets)
  expect(keyboardResourceHashes(finished.hashes)).toEqual(keyboardResourceHashes(before.hashes))
  const pictures = { gm: await picture(page, info, 'finished', 'gm'), player: await picture(page, info, 'finished', 'player') }
  await page.screenshot({ path: info.outputPath('finished.png') })

  // A fresh context proves the downloaded archive carries the stair, covers,
  // identities and real resource bytes without the original IndexedDB/cache.
  const coldContext = await browser.newContext({ viewport: { width: 1512, height: 982 } })
  let coldPictures: typeof pictures
  try {
    const coldPage = await coldContext.newPage(); coldPage.on('pageerror', error => errors.push(error.message))
    await coldPage.goto(new URL('./#home', page.url()).href)
    const opening = coldPage.waitForEvent('filechooser')
    await coldPage.getByTestId('workspace-home').getByRole('button', { name: '打开工程文件', exact: true }).click()
    await (await opening).setFiles(finalPath); await keyboardWorkspaceSaved(coldPage)
    const cold = await keyboardProjectBackup(coldPage, info.outputPath('cold.sceneweave'))
    // File import intentionally creates a separate project with fresh metadata.
    expect(cold.document.sceneId).not.toBe(finished.document.sceneId)
    expect(cold.document.revision).toBe(0)
    expect(cold.document).toEqual({ ...finished.document, sceneId: cold.document.sceneId,
      revision: 0, createdAt: cold.document.createdAt, updatedAt: cold.document.updatedAt })
    expect(cold.identity).toEqual(finished.identity)
    expect(cold.appearance).toEqual(finished.appearance)
    expect(keyboardResourceHashes(cold.hashes)).toEqual(keyboardResourceHashes(finished.hashes))
    await reloadSaved(coldPage); await keyboardWorkspaceSaved(coldPage)
    expect((await keyboardProjectBackup(coldPage, info.outputPath('reopened.sceneweave'))).hashes).toEqual(cold.hashes)
    coldPictures = { gm: await picture(coldPage, info, 'cold', 'gm'), player: await picture(coldPage, info, 'cold', 'player') }
    expect(coldPictures).toEqual(pictures)
    await selectStair(coldPage, id)
    await expect(coldPage.locator('[data-staircase-tools]').getByLabel('阶梯固定级数', { exact: true })).toHaveValue('25')
    await coldPage.screenshot({ path: info.outputPath('cold.png') })
  } finally { await coldContext.close() }
  expect(errors).toEqual([])
  await writeFile(info.outputPath('result.json'), JSON.stringify({ ordinaryProductionUI: true, userVisualAcceptance: false,
    directory: { presets: 10, materials: 10 }, initialLengthMm: 7000, repeat: { lengthMm: stairLength(repeatConnection), treadDepthMm: 300 },
    stretch: { lengthMm: stairLength(stretchedConnection), stepCount: 25 }, independentTextureScaleMm: 280,
    rotationDeg: 2, widthMm: 1200, bendSegments: 2, coverCount: 1, pointerCover: true, undoRedo: true,
    sourceTerrainAndRealResourceBytesPreserved: true, freshContextArchiveExact: true, pngHashes: pictures, coldPngHashes: coldPictures, errors }, null, 2))
})

test('reference island adds crisp independent stairs over the saved complete slope and cold-opens unchanged', async ({ page }, info) => {
  const sourcePath = process.env.SCENEWEAVE_STAIRCASE_REFERENCE
  test.skip(!sourcePath, 'Optional private complete-slope reference; portable checks use the fixture above.')
  test.setTimeout(600000); page.setDefaultTimeout(180000)
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await page.goto('./#home')
  const choosing = page.waitForEvent('filechooser')
  await page.getByTestId('workspace-home').getByRole('button', { name: '打开工程文件', exact: true }).click()
  await (await choosing).setFiles(sourcePath!); await keyboardWorkspaceSaved(page)
  const before = await keyboardProjectBackup(page, info.outputPath('reference-before.sceneweave'))
  const id = 'tidal-north-stair', original = before.document.terrainConnections[id]
  expect(original.terrainInlay).toBeDefined()
  expect(original.widthMm).toBe(1500)
  const beforePicture = await picture(page, info, 'reference-before', 'gm')
  let tools = await selectStair(page, id)
  await tools.getByLabel('阶梯样式', { exact: true }).selectOption('carved-rock')
  await tools.getByLabel('阶梯材质', { exact: true }).selectOption('granite')
  await tools.getByLabel('阶梯踏面深度毫米', { exact: true }).fill('350')
  await tools.getByRole('button', { name: '预览阶梯外观', exact: true }).click(); await adopt(page)
  const complete = await keyboardProjectBackup(page, info.outputPath('reference-staircase.sceneweave'))
  expect(physical(complete.document.terrainConnections[id])).toEqual(physical(original))
  const completePicture = await picture(page, info, 'reference-staircase', 'gm')
  expect(completePicture).not.toBe(beforePicture)
  tools = await selectStair(page, id)
  await openDetailsBySummary(tools, /^局部覆盖与露出底层/)
  await tools.getByLabel('阶梯覆盖方式', { exact: true }).selectOption('reveal-ground')
  await openDetailsBySummary(tools, /^用百分比添加覆盖$/)
  await tools.getByLabel('阶梯覆盖路线起点百分比', { exact: true }).fill('30')
  await tools.getByLabel('阶梯覆盖路线终点百分比', { exact: true }).fill('70')
  await tools.getByLabel('阶梯覆盖横向终点百分比', { exact: true }).fill('15')
  await tools.getByRole('button', { name: '添加矩形覆盖', exact: true }).click()
  await tools.getByRole('button', { name: '预览阶梯外观', exact: true }).click(); await adopt(page)
  const finished = await keyboardProjectBackup(page, info.outputPath('reference-covered.sceneweave'))
  expect(physical(finished.document.terrainConnections[id])).toEqual(physical(original))
  expect(finished.document.terrainConnections[id].staircase!.covers).toHaveLength(1)
  for (const key of ['terrainAreas', 'props', 'visual', 'materials', 'assets'] as const) expect(finished.document[key]).toEqual(before.document[key])
  expect(keyboardResourceHashes(finished.hashes)).toEqual(keyboardResourceHashes(before.hashes))
  const pictures = { gm: await picture(page, info, 'reference-covered', 'gm'), player: await picture(page, info, 'reference-covered', 'player') }
  await page.screenshot({ path: info.outputPath('reference-editor.png') })
  await reloadSaved(page); await keyboardWorkspaceSaved(page)
  const cold = await keyboardProjectBackup(page, info.outputPath('reference-cold.sceneweave'))
  expect(cold.hashes).toEqual(finished.hashes)
  expect(await picture(page, info, 'reference-cold', 'gm')).toBe(pictures.gm)
  expect(errors).toEqual([])
  await writeFile(info.outputPath('reference-result.json'), JSON.stringify({ ordinaryProductionUI: true, userVisualAcceptance: false,
    staircase: finished.document.terrainConnections[id].staircase, physicalSlopeAndAllSourcesUnchanged: true,
    coldArchiveExact: true, coldGmPngExact: true, beforePicture, completePicture, pictures, errors }, null, 2))
})
