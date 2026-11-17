import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'vite'
import { keyboardProjectBackup, keyboardWorkspaceSaved } from './keyboard-ux-helpers'
import { openSceneObjects } from './workspace-navigation-helpers'
import { mapExportButton } from './workspace-ux-helpers'

const review = (page: Page) => page.getByRole('region', { name: '候选审阅', exact: true })
async function selectRoad(page: Page, id = 'inlay-road') {
  const objects = await openSceneObjects(page, '结构')
  await objects.getByLabel('搜索场景对象', { exact: true }).fill(id)
  await objects.locator(`[data-entity-id=${JSON.stringify(id)}]`).click()
  const tools = page.locator('[data-terrain-inlay-tools]')
  if (await tools.getAttribute('open') === null) await tools.locator(':scope > summary').click()
  return tools
}
async function adopt(page: Page) {
  const candidate = review(page)
  await expect(candidate).toBeVisible()
  await candidate.getByLabel('确认完整影响范围', { exact: true }).check()
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

test('ordinary cross-terrace tools review both sources, cancel, adopt, undo/redo, cold-open and explicitly restore the original', async ({ page }, info) => {
  test.setTimeout(300000)
  // Only prepare an ordinary archive in Node; all edits run through the public UI.
  const vite = await createServer({ configFile: false, logLevel: 'error', cacheDir: info.outputPath('ssr-cache'),
    server: { middlewareMode: true, hmr: false, watch: { ignored: ['**/*'] } }, optimizeDeps: { noDiscovery: true } })
  let archive: Uint8Array
  try {
    const { fixture, runtime, validation } = await vite.ssrLoadModule('/src/application/workspace/test-fixtures.ts')
    const { createCompositionContent } = await vite.ssrLoadModule('/src/shared/appearance/graph.ts')
    const { applyCompositionDraftCommands } = await vite.ssrLoadModule('/src/shared/appearance/commands.ts')
    const { exportProject } = await vite.ssrLoadModule('/src/shared/project/file.ts')
    const source = fixture(), scene = source.project.document
    scene.title = '跨台连续填切山路 UI 自检'; scene.units.display = 'm'; scene.props = {}
    delete scene.entityLayers.item; delete scene.entityLayers.other
    const initial = createCompositionContent(scene, runtime)
    const area = (id: string, left: number, right: number, top: number, bottom: number, z: number, priority: number) => ({
      type: 'createTerrainArea', id, floorId: 'blank-floor', boundaryMm: [{ x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom }],
      groundElevationMm: z, coveragePriority: priority, visibility: 'public', surfaceStyle: null,
    })
    Object.assign(source.project, applyCompositionDraftCommands(initial, [area('inlay-low', 1000, 10000, 1000, 9000, 1000, 1), area('inlay-high', 5000, 9500, 2000, 8000, 3000, 2),
      { type: 'createTerrainConnection', id: 'inlay-road', floorId: 'blank-floor', kind: 'stairs',
        from: { surfaceRef: { kind: 'terrainArea', id: 'inlay-low' }, positionMm: { x: 2500, y: 4801 } },
        to: { surfaceRef: { kind: 'terrainArea', id: 'inlay-high' }, positionMm: { x: 8000, y: 5107 } },
        widthMm: 1500, openingId: null, visibility: 'public', surfaceStyle: null }], runtime))
    archive = await exportProject(source, validation)
  } finally { await vite.close() }
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await page.goto('./#home')
  const choosing = page.waitForEvent('filechooser')
  await page.getByTestId('workspace-home').getByRole('button', { name: '打开工程文件', exact: true }).click()
  await (await choosing).setFiles({ name: 'cross-terrace.sceneweave', mimeType: 'application/octet-stream', buffer: Buffer.from(archive) })
  await keyboardWorkspaceSaved(page)
  const before = await keyboardProjectBackup(page, info.outputPath('before.sceneweave'))
  let tools = await selectRoad(page)
  await tools.getByRole('button', { name: '预览连续山路', exact: true }).click()
  await expect(review(page)).toBeVisible()
  const scope = review(page).getByRole('region', { name: '山路填切影响范围', exact: true })
  await expect(scope).toContainText('inlay-low')
  await expect(scope).toContainText('inlay-high')
  await scope.getByText(/^只读依赖与局部覆盖/).click()
  const dependencies = await scope.getByLabel('山路只读依赖与局部覆盖', { exact: true }).inputValue()
  expect(dependencies).toContain('inlay-low'); expect(dependencies).toContain('inlay-high')
  await page.screenshot({ path: info.outputPath('candidate.png') })
  await review(page).getByRole('button', { name: /^取消(?:视觉|组件|室外|结构)预览$/ }).click()
  await keyboardWorkspaceSaved(page)
  expect((await keyboardProjectBackup(page, info.outputPath('cancelled.sceneweave'))).hashes).toEqual(before.hashes)
  tools = await selectRoad(page)
  await tools.getByRole('button', { name: '预览连续山路', exact: true }).click(); await adopt(page)
  const adopted = await keyboardProjectBackup(page, info.outputPath('adopted.sceneweave'))
  const connection = adopted.document.terrainConnections['inlay-road'], inlay = connection.terrainInlay!
  expect(connection.kind).toBe('ramp'); expect(connection.route).toBeUndefined()
  expect(inlay).toMatchObject({ algorithmId: 'terrain-inlay1', algorithmVersion: 1, originalConnection: before.document.terrainConnections['inlay-road'] })
  expect(adopted.document.terrainAreas).toEqual(before.document.terrainAreas)
  expect(Object.keys(inlay.geometry.verticesMm).length).toBeGreaterThan(6)
  await page.getByRole('button', { name: '撤销编辑', exact: true }).click(); await keyboardWorkspaceSaved(page)
  expect((await keyboardProjectBackup(page, info.outputPath('undone.sceneweave'))).document.terrainConnections['inlay-road']).toEqual(before.document.terrainConnections['inlay-road'])
  await page.getByRole('button', { name: '重做编辑', exact: true }).click(); await keyboardWorkspaceSaved(page)
  const redone = await keyboardProjectBackup(page, info.outputPath('redone.sceneweave'))
  expect(redone.document.terrainConnections['inlay-road'].terrainInlay).toEqual(inlay)
  const pictures = await pngs(page, info, 'redone')
  await page.reload(); await page.getByRole('button', { name: '回到首页', exact: true }).click()
  await page.getByTestId('workspace-home').locator(`[data-project-key="native:${redone.document.sceneId}"]`).getByRole('button', { name: '打开', exact: true }).click()
  await keyboardWorkspaceSaved(page)
  const cold = await keyboardProjectBackup(page, info.outputPath('cold.sceneweave'))
  expect(cold.hashes).toEqual(redone.hashes)
  expect(await pngs(page, info, 'cold')).toEqual(pictures)
  await page.screenshot({ path: info.outputPath('cold.png') })
  tools = await selectRoad(page)
  await tools.getByRole('button', { name: '预览恢复原连接和地形', exact: true }).click(); await adopt(page)
  const restored = await keyboardProjectBackup(page, info.outputPath('restored.sceneweave'))
  expect(restored.document.terrainConnections['inlay-road']).toEqual(before.document.terrainConnections['inlay-road'])
  expect(restored.document.terrainAreas).toEqual(before.document.terrainAreas)
  await page.getByRole('button', { name: '撤销编辑', exact: true }).click(); await keyboardWorkspaceSaved(page)
  expect((await keyboardProjectBackup(page, info.outputPath('restore-undone.sceneweave'))).document.terrainConnections['inlay-road'].terrainInlay).toEqual(inlay)
  expect(errors).toEqual([])
  await writeFile(info.outputPath('result.json'), JSON.stringify({ formalAcceptance: false, ordinaryProductionUI: true,
    previewCancellationExact: true, bothSourcesDisclosed: true, originalSourceAreasPreserved: true, explicitRestore: true,
    actualVertices: Object.keys(inlay.geometry.verticesMm).length, actualFaces: Object.keys(inlay.geometry.faces).length,
    undoRedo: true, completeColdArchiveExact: true, pngHashes: pictures, errors }, null, 2))
})

test('real reference cross-terrace route preserves all stations and resources through ordinary adoption and cold open', async ({ page }, info) => {
  const sourcePath = process.env.SCENEWEAVE_REAL_INLAY_SOURCE
  test.skip(!sourcePath, 'Explicit local reference archive; absent from ordinary portable test runs.')
  test.setTimeout(900000)
  page.setDefaultTimeout(180000)
  const sourceBytes = await readFile(sourcePath!)
  expect(createHash('sha256').update(sourceBytes).digest('hex')).toBe('4b52770c3c616d759d4f00baa0ed24039949c50e6a9ad2ffa97f1ec7fd0a17e9')
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  const settled = async () => {
    await expect(page.locator('.asset-save')).toHaveText('本地已保存', { timeout: 180000 })
    await expect(page.locator('.asset-busy')).toHaveCount(0, { timeout: 180000 })
    await expect(page.locator('.asset-map-wrap')).toHaveAttribute('aria-busy', 'false', { timeout: 180000 })
  }
  await page.goto('./#home')
  const choosing = page.waitForEvent('filechooser')
  await page.getByTestId('workspace-home').getByRole('button', { name: '打开工程文件', exact: true }).click()
  await (await choosing).setFiles({ name: 'reference-original.sceneweave', mimeType: 'application/octet-stream', buffer: sourceBytes })
  await settled()
  const before = await keyboardProjectBackup(page, info.outputPath('reference-before.sceneweave'))
  const connectionId = 'tidal-north-stair', original = before.document.terrainConnections[connectionId]
  expect(original.route!.centerlineMm).toHaveLength(33); expect(original.widthMm).toBe(1500)
  const baselinePictures = await pngs(page, info, 'reference-before')
  const tools = await selectRoad(page, connectionId)
  await tools.getByRole('checkbox', { name: '同时打开一侧崖壁', exact: true }).check()
  await tools.getByRole('combobox', { name: '开口朝向', exact: true }).selectOption('right')
  await tools.getByLabel('开口从路线第几个点开始', { exact: true }).fill('18')
  await tools.getByLabel('开口到路线第几个点结束', { exact: true }).fill('33')
  await tools.getByRole('combobox', { name: '连接到源崖', exact: true }).selectOption('tidal-northeast-plateau')
  await tools.getByLabel('源崖起点序号', { exact: true }).fill('209')
  await tools.getByLabel('源崖终点序号', { exact: true }).fill('1')
  await tools.getByLabel('开口末端连接点（可选，每行 X Y，毫米）', { exact: true }).fill('21800 4633')
  await tools.getByRole('button', { name: '预览连续山路', exact: true }).click()
  await expect(review(page)).toBeVisible({ timeout: 240000 })
  const scope = review(page).getByRole('region', { name: '山路填切影响范围', exact: true })
  await expect(scope).toContainText('局部覆盖的原有岸线')
  await scope.getByText(/^只读依赖与局部覆盖/).click()
  const dependencies = await scope.getByLabel('山路只读依赖与局部覆盖', { exact: true }).inputValue()
  for (const id of ['tidal-main-rock', 'tidal-northeast-plateau', 'tidal-main-rock-curve-60-shore']) expect(dependencies).toContain(id)
  await page.screenshot({ path: info.outputPath('reference-candidate.png') })
  await review(page).getByLabel('确认完整影响范围', { exact: true }).check()
  await review(page).getByRole('button', { name: /^采用(?:结构|室外|视觉|组件)修改$/ }).click(); await settled()
  const adopted = await keyboardProjectBackup(page, info.outputPath('reference-adopted.sceneweave'))
  const inlay = adopted.document.terrainConnections[connectionId].terrainInlay!
  expect(inlay.originalConnection).toEqual(original)
  expect(inlay.centerlineVertexIds.map(id => { const p = inlay.geometry.verticesMm[id]; return { x: p.x, y: p.y } })).toEqual(original.route!.centerlineMm)
  expect(Object.keys(inlay.geometry.verticesMm)).toHaveLength(117)
  expect(Object.keys(inlay.geometry.faces)).toHaveLength(165)
  expect(adopted.document.terrainAreas).toEqual(before.document.terrainAreas)
  expect(adopted.document.props).toEqual(before.document.props)
  expect(adopted.document.visual).toEqual(before.document.visual)
  const resourceHashes = (hashes: Record<string, string>) => Object.fromEntries(Object.entries(hashes).filter(([name]) => /^(assets\/|licenses\/|sources\/|sources\.json$)/.test(name)))
  expect(resourceHashes(adopted.hashes)).toEqual(resourceHashes(before.hashes))
  const pictures = await pngs(page, info, 'reference-adopted')
  await page.reload(); await page.getByRole('button', { name: '回到首页', exact: true }).click()
  await page.getByTestId('workspace-home').locator(`[data-project-key="native:${adopted.document.sceneId}"]`).getByRole('button', { name: '打开', exact: true }).click(); await settled()
  const cold = await keyboardProjectBackup(page, info.outputPath('reference-cold.sceneweave'))
  expect(cold.hashes).toEqual(adopted.hashes)
  expect(await pngs(page, info, 'reference-cold')).toEqual(pictures)
  await page.screenshot({ path: info.outputPath('reference-cold.png') })
  expect(errors).toEqual([])
  await writeFile(info.outputPath('reference-result.json'), JSON.stringify({ formalAcceptance: false, naturalVisualAcceptance: false,
    ordinaryProductionUI: true, originalStations: 33, requestedWidthMm: 1500, actualVertices: 117, actualFaces: 165,
    sourceAreasPropsAndSavedVisualPreserved: true, resourceBytesPreserved: true, completeColdArchiveExact: true,
    baselinePngHashes: baselinePictures, pngHashes: pictures, errors }, null, 2))
})
