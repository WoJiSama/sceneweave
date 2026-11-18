import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'vite'
import { keyboardProjectBackup, keyboardWorkspaceSaved } from './keyboard-ux-helpers'
import { openSceneObjects } from './workspace-navigation-helpers'
import { mapExportButton } from './workspace-ux-helpers'

const review = (page: Page) => page.getByRole('region', { name: '候选审阅', exact: true })
async function selectRoad(page: Page, id = 'slope-road') {
  const objects = await openSceneObjects(page, '结构')
  await objects.getByLabel('搜索场景对象', { exact: true }).fill(id)
  await objects.locator(`[data-entity-id="${id}"]`).click()
  const tools = page.locator('[data-terrain-inlay-tools]')
  if (await tools.getAttribute('open') === null) await tools.locator(':scope > summary').click()
  return tools
}
async function adopt(page: Page) {
  const candidate = review(page)
  await expect(candidate).toBeVisible()
  const confirmation = candidate.getByLabel('确认完整影响范围', { exact: true })
  if (await confirmation.count()) await confirmation.check()
  await candidate.getByRole('button', { name: /^采用(?:结构|室外|视觉|组件)修改$/ }).click()
  await keyboardWorkspaceSaved(page)
}
async function pngs(page: Page, info: TestInfo, phase: string) {
  const hashes: Record<string, string> = {}
  for (const audience of ['gm', 'player'] as const) {
    const downloading = page.waitForEvent('download')
    await (await mapExportButton(page, audience)).click()
    const path = info.outputPath(`${phase}-${audience}.png`)
    await (await downloading).saveAs(path)
    await keyboardWorkspaceSaved(page)
    await page.locator('.workspace-export-menu > summary').click()
    const bytes = await readFile(path)
    expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
    hashes[audience] = createHash('sha256').update(bytes).digest('hex')
  }
  return hashes
}

test('ordinary complete-slope tools cancel, adopt, undo/redo, change finish, cold-open and restore the original connection', async ({ page }, info) => {
  test.setTimeout(300000)
  // SSR only prepares an ordinary input archive; every scene edit uses public UI.
  const vite = await createServer({ configFile: false, logLevel: 'error', cacheDir: info.outputPath('ssr-cache'),
    server: { middlewareMode: true, hmr: false, watch: { ignored: ['**/*'] } }, optimizeDeps: { noDiscovery: true } })
  let archive: Uint8Array
  try {
    const { fixture, runtime, validation } = await vite.ssrLoadModule('/src/application/workspace/test-fixtures.ts')
    const { createCompositionContent } = await vite.ssrLoadModule('/src/shared/appearance/graph.ts')
    const { applyCompositionDraftCommands } = await vite.ssrLoadModule('/src/shared/appearance/commands.ts')
    const { exportProject } = await vite.ssrLoadModule('/src/shared/project/file.ts')
    const source = fixture(), scene = source.project.document
    scene.title = '完整坡体与石质踏步 UI 自检'; scene.units.display = 'm'; scene.props = {}
    delete scene.entityLayers.item; delete scene.entityLayers.other
    const initial = createCompositionContent(scene, runtime)
    const area = (id: string, left: number, right: number, top: number, bottom: number, z: number, priority: number) => ({
      type: 'createTerrainArea', id, floorId: 'blank-floor', boundaryMm: [{ x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom }],
      groundElevationMm: z, coveragePriority: priority, visibility: 'public', surfaceStyle: null,
    })
    Object.assign(source.project, applyCompositionDraftCommands(initial, [
      area('slope-low', 1000, 11000, 1000, 11000, 1000, 1), area('slope-high', 5500, 10500, 2000, 10000, 3000, 2),
      { type: 'createTerrainConnection', id: 'slope-road', floorId: 'blank-floor', kind: 'stairs',
        from: { surfaceRef: { kind: 'terrainArea', id: 'slope-low' }, positionMm: { x: 2000, y: 6000 } },
        to: { surfaceRef: { kind: 'terrainArea', id: 'slope-high' }, positionMm: { x: 9000, y: 6000 } },
        widthMm: 1000, openingId: null, visibility: 'public', surfaceStyle: null },
    ], runtime))
    archive = await exportProject(source, validation)
  } finally { await vite.close() }
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await page.goto('./#home')
  const choosing = page.waitForEvent('filechooser')
  await page.getByTestId('workspace-home').getByRole('button', { name: '打开工程文件', exact: true }).click()
  await (await choosing).setFiles({ name: 'complete-slope.sceneweave', mimeType: 'application/octet-stream', buffer: Buffer.from(archive) })
  await keyboardWorkspaceSaved(page)
  const before = await keyboardProjectBackup(page, info.outputPath('before.sceneweave'))
  let tools = await selectRoad(page)
  const slopeTools = () => tools.locator('[data-terrain-slope-tools]')
  await expect(slopeTools().getByLabel('路线左侧坡体延伸（毫米）', { exact: true })).toHaveValue('1000')
  await expect(slopeTools().getByLabel('路线右侧坡体延伸（毫米）', { exact: true })).toHaveValue('1000')
  await slopeTools().getByRole('button', { name: '预览完整坡体', exact: true }).click()
  const scope = review(page).getByRole('region', { name: '山路填切影响范围', exact: true })
  await expect(scope).toContainText('形成完整坡体')
  await expect(scope).toContainText('slope-low'); await expect(scope).toContainText('slope-high')
  await page.screenshot({ path: info.outputPath('slope-candidate.png') })
  await review(page).getByRole('button', { name: /^取消(?:视觉|组件|室外|结构)预览$/ }).click()
  await keyboardWorkspaceSaved(page)
  expect((await keyboardProjectBackup(page, info.outputPath('cancelled.sceneweave'))).hashes).toEqual(before.hashes)
  tools = await selectRoad(page)
  await slopeTools().getByRole('button', { name: '预览完整坡体', exact: true }).click(); await adopt(page)
  const adopted = await keyboardProjectBackup(page, info.outputPath('adopted.sceneweave'))
  const inlay = adopted.document.terrainConnections['slope-road'].terrainInlay!
  expect(inlay).toMatchObject({ appearance: 'source-ground', finish: { kind: 'slope' }, originalConnection: before.document.terrainConnections['slope-road'] })
  expect(adopted.document.terrainAreas).toEqual(before.document.terrainAreas)
  const footprint = inlay.geometry.footprintVertexIds.map(id => inlay.geometry.verticesMm[id])
  expect(Math.max(...footprint.map(p => p.y)) - Math.min(...footprint.map(p => p.y))).toBe(3004)
  await page.getByRole('button', { name: '撤销编辑', exact: true }).click(); await keyboardWorkspaceSaved(page)
  expect((await keyboardProjectBackup(page, info.outputPath('undone.sceneweave'))).document.terrainConnections['slope-road']).toEqual(before.document.terrainConnections['slope-road'])
  await page.getByRole('button', { name: '重做编辑', exact: true }).click(); await keyboardWorkspaceSaved(page)
  expect((await keyboardProjectBackup(page, info.outputPath('redone.sceneweave'))).document.terrainConnections['slope-road'].terrainInlay).toEqual(inlay)
  tools = await selectRoad(page)
  const stairTools = page.locator('[data-staircase-tools]')
  await stairTools.getByLabel('阶梯踏面深度毫米', { exact: true }).fill('350')
  await stairTools.getByRole('button', { name: '预览阶梯外观', exact: true }).click()
  await expect(review(page)).toContainText('阶梯')
  await adopt(page)
  const finished = await keyboardProjectBackup(page, info.outputPath('steps.sceneweave'))
  expect(finished.document.terrainConnections['slope-road'].terrainInlay).toEqual(inlay)
  expect(finished.document.terrainConnections['slope-road'].staircase?.layout).toEqual({ kind: 'repeat', treadDepthMm: 350 })
  expect(finished.document.terrainAreas).toEqual(before.document.terrainAreas)
  const pictures = await pngs(page, info, 'steps')
  await page.reload(); await page.getByRole('button', { name: '回到首页', exact: true }).click()
  await page.getByTestId('workspace-home').locator(`[data-project-key="native:${finished.document.sceneId}"]`).getByRole('button', { name: '打开', exact: true }).click()
  await keyboardWorkspaceSaved(page)
  const cold = await keyboardProjectBackup(page, info.outputPath('cold.sceneweave'))
  expect(cold.hashes).toEqual(finished.hashes)
  expect(await pngs(page, info, 'cold')).toEqual(pictures)
  await page.screenshot({ path: info.outputPath('cold.png') })
  tools = await selectRoad(page)
  await tools.getByRole('button', { name: '预览恢复原连接和地形', exact: true }).click(); await adopt(page)
  const restored = await keyboardProjectBackup(page, info.outputPath('restored.sceneweave'))
  expect(restored.document.terrainConnections['slope-road']).toEqual({ ...before.document.terrainConnections['slope-road'], staircase: finished.document.terrainConnections['slope-road'].staircase })
  expect(restored.document.terrainAreas).toEqual(before.document.terrainAreas)
  expect(errors).toEqual([])
  await writeFile(info.outputPath('result.json'), JSON.stringify({ formalAcceptance: false, ordinaryProductionUI: true,
    previewCancellationExact: true, sourceAreasPreserved: true, bankWidthMm: 1000, footprintWidthMm: 3004,
    undoRedo: true, staircase: { kind: 'repeat', treadDepthMm: 350 }, actualGeometryPreservedByFinish: true,
    completeColdArchiveExact: true, coldPngExact: true, explicitRestore: true,
    actualVertices: Object.keys(inlay.geometry.verticesMm).length, actualFaces: Object.keys(inlay.geometry.faces).length,
    pngHashes: pictures, errors }, null, 2))
})

test('real island rebuilds a complete slope with preserved grass, then changes only its finish and cold-opens exactly', async ({ page }, info) => {
  const sourcePath = process.env.SCENEWEAVE_REAL_SLOPE_SOURCE
  test.skip(!sourcePath, 'Explicit private reference archive; not required by portable test runs.')
  test.setTimeout(900000); page.setDefaultTimeout(180000)
  const bytes = await readFile(sourcePath!)
  expect(createHash('sha256').update(bytes).digest('hex')).toBe('ffbdb4799b05beaae822c5335188ec4ccc348fc69280bd8c458f3152b6fe3cb0')
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await page.goto('./#home')
  const choosing = page.waitForEvent('filechooser')
  await page.getByTestId('workspace-home').getByRole('button', { name: '打开工程文件', exact: true }).click()
  await (await choosing).setFiles({ name: 'reference-island.sceneweave', mimeType: 'application/octet-stream', buffer: bytes })
  await keyboardWorkspaceSaved(page)
  const before = await keyboardProjectBackup(page, info.outputPath('reference-before.sceneweave'))
  const baselinePictures = await pngs(page, info, 'reference-before')
  const id = 'tidal-north-stair', original = before.document.terrainConnections[id].terrainInlay!.originalConnection
  expect(original.route!.centerlineMm).toHaveLength(33); expect(original.widthMm).toBe(1500)
  let tools = await selectRoad(page, id)
  const slopeTools = () => tools.locator('[data-terrain-slope-tools]')
  await slopeTools().getByLabel('路线右侧坡体延伸（毫米）', { exact: true }).fill('750')
  await slopeTools().getByRole('button', { name: '预览重建完整坡体', exact: true }).click()
  await expect(review(page)).toContainText('随坡面保留的原有草带')
  await page.screenshot({ path: info.outputPath('reference-slope-candidate.png') })
  await adopt(page)
  const adopted = await keyboardProjectBackup(page, info.outputPath('reference-slope.sceneweave'))
  const inlay = adopted.document.terrainConnections[id].terrainInlay!
  expect(inlay.originalConnection).toEqual(original)
  expect(inlay.finish).toEqual({ kind: 'slope' }); expect(inlay.appearance).toBe('source-ground')
  expect(inlay.centerlineVertexIds.map(id => { const p = inlay.geometry.verticesMm[id]; return { x: p.x, y: p.y } })).toEqual(original.route!.centerlineMm)
  for (const key of ['terrainAreas', 'props', 'visual', 'materials'] as const) expect(adopted.document[key]).toEqual(before.document[key])
  const resourceHashes = (hashes: Record<string, string>) => Object.fromEntries(Object.entries(hashes).filter(([name]) => /^(assets\/|licenses\/|sources\/|sources\.json$)/.test(name)))
  expect(resourceHashes(adopted.hashes)).toEqual(resourceHashes(before.hashes))
  const slopePictures = await pngs(page, info, 'reference-slope')
  tools = await selectRoad(page, id)
  const stairTools = page.locator('[data-staircase-tools]')
  await stairTools.getByLabel('阶梯踏面深度毫米', { exact: true }).fill('350')
  await stairTools.getByRole('button', { name: '预览阶梯外观', exact: true }).click(); await adopt(page)
  const finished = await keyboardProjectBackup(page, info.outputPath('reference-steps.sceneweave'))
  expect(finished.document.terrainConnections[id].terrainInlay).toEqual(inlay)
  expect(finished.document.terrainConnections[id].staircase?.layout).toEqual({ kind: 'repeat', treadDepthMm: 350 })
  const pictures = await pngs(page, info, 'reference-steps')
  expect(pictures.gm).not.toBe(slopePictures.gm)
  await page.reload(); await page.getByRole('button', { name: '回到首页', exact: true }).click()
  await page.getByTestId('workspace-home').locator(`[data-project-key="native:${finished.document.sceneId}"]`).getByRole('button', { name: '打开', exact: true }).click()
  await keyboardWorkspaceSaved(page)
  const cold = await keyboardProjectBackup(page, info.outputPath('reference-cold.sceneweave'))
  expect(cold.hashes).toEqual(finished.hashes)
  expect(await pngs(page, info, 'reference-cold')).toEqual(pictures)
  expect(errors).toEqual([])
  await writeFile(info.outputPath('reference-result.json'), JSON.stringify({ ordinaryProductionUI: true, naturalVisualAcceptance: false,
    originalStations: 33, originalWidthMm: 1500, bankWidthMm: { left: 1000, right: 750 },
    actualVertices: Object.keys(inlay.geometry.verticesMm).length, actualFaces: Object.keys(inlay.geometry.faces).length,
    sourceAreasPropsMaterialsAndSavedVisualPreserved: true, resourceBytesPreserved: true, finishOnlyPreservesActualGeometry: true,
    coldArchiveAndPngExact: true, baselinePngHashes: baselinePictures, slopePngHashes: slopePictures, stepPngHashes: pictures, errors }, null, 2))
})
