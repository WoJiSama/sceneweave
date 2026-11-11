import { expect, test, type Browser, type Locator, type Page, type TestInfo } from '@playwright/test'
import { createHash, randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { unzipSync, zipSync } from 'fflate'
import { applyCompositionCommands } from '../src/shared/appearance/commands'
import type { MaterialPaint, PointMm, SceneDocument } from '../src/shared/model/scene'
import type { SvgAuthoringSource } from '../src/shared/model/project'
import type { ProjectManifest } from '../src/shared/project/file'
import { canonicalJson } from '../src/shared/validation/json'
import { visualBase } from '../src/shared/visual/base'
import { LEAFY_FERN_LICENSE } from '../src/shared/visual/leafy-fern-art'
import { createKeyboardProject, keyboardProjectBackup, keyboardResourceHashes, keyboardWorkspaceSaved } from './keyboard-ux-helpers'
import { openTerrainTask, openWorkspaceModule } from './workspace-navigation-helpers'
import { mapExportButton, openDetailsBySummary } from './workspace-ux-helpers'

const { PNG } = createRequire(import.meta.url)('../node_modules/playwright-core/lib/utilsBundle.js')
const reviewFor = (page: Page) => page.getByRole('region', { name: '候选审阅', exact: true })
const rect = (x: number, y: number, width: number, height: number): PointMm[] => [
  { x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height },
]
const coordinateText = (points: PointMm[]) => points.map(point => `${point.x}, ${point.y}`).join('\n')
const fixedContent = (backup: Awaited<ReturnType<typeof keyboardProjectBackup>>) => ({ document: backup.document, historyIdentity: backup.identity, appearance: backup.appearance })

async function commitNumber(scope: Locator, label: string, value: string): Promise<void> {
  const input = scope.getByLabel(label, { exact: true }); await input.fill(value); await input.press('Tab')
}
async function adopt(page: Page, kind: '视觉' | '室外'): Promise<void> {
  const review = reviewFor(page)
  await expect(review).toBeVisible(); await review.getByLabel('确认完整影响范围', { exact: true }).check()
  await review.getByRole('button', { name: `采用${kind}修改`, exact: true }).click()
  await expect(review).toHaveCount(0); await keyboardWorkspaceSaved(page)
}
async function coldReopen(page: Page, sceneId: string): Promise<void> {
  await page.reload(); await page.getByRole('button', { name: '回到首页', exact: true }).click()
  await page.getByTestId('workspace-home').locator(`[data-project-key="native:${sceneId}"]`).getByRole('button', { name: '打开', exact: true }).click()
  await keyboardWorkspaceSaved(page)
}
async function playerPng(page: Page, path: string) {
  const downloading = page.waitForEvent('download'); await (await mapExportButton(page, 'player')).click()
  await (await downloading).saveAs(path); await keyboardWorkspaceSaved(page)
  await page.locator('.workspace-export-menu > summary').click()
  const bytes = await readFile(path), image = PNG.sync.read(bytes)
  expect(image.width).toBeGreaterThan(0); expect(image.height).toBeGreaterThan(0)
  return { image, hash: createHash('sha256').update(image.data).digest('hex') }
}
async function pngCrop(image: any, path: string): Promise<void> {
  const size = Math.min(1024, image.width, image.height), crop = new PNG({ width: size, height: size })
  PNG.bitblt(image, crop, Math.floor((image.width - size) / 2), Math.floor((image.height - size) / 2), size, size, 0, 0)
  await writeFile(path, PNG.sync.write(crop))
}

/** Build through ordinary shared commands, then enter through a real complete
 * file import. No sample factory, browser test API or hidden editor mutation. */
async function ordinaryGroundFixture(page: Page, info: TestInfo, size = { widthM: 24, heightM: 18 }) {
  await page.goto('./#home')
  await page.getByTestId('workspace-home').getByRole('button', { name: '新建场景', exact: true }).click()
  const creating = page.getByRole('dialog', { name: '新建空白场景', exact: true })
  await creating.getByLabel('场景名称', { exact: true }).fill('任意地形上的自然细节')
  await creating.getByLabel('画布宽度', { exact: true }).fill(String(size.widthM))
  await creating.getByLabel('画布高度', { exact: true }).fill(String(size.heightM))
  await creating.getByRole('button', { name: '创建空白场景', exact: true }).click()
  await expect(creating).toHaveCount(0); await keyboardWorkspaceSaved(page)
  const sourcePath = info.outputPath('ordinary-source.sceneweave'), blank = await keyboardProjectBackup(page, sourcePath)
  const scene = blank.document, floorId = Object.keys(scene.floors)[0], layerId = Object.keys(scene.userLayers)[0]
  const bounds = scene.floors[floorId].boundsMm
  const x = bounds.x + 1500, y = bounds.y + 1500, width = bounds.width - 3000, height = bounds.height - 3000
  expect(width).toBeGreaterThan(9000); expect(height).toBeGreaterThan(7000)
  const areaId = `ordinary-ground-${randomUUID()}`, pathId = `ordinary-path-${randomUUID()}`, propId = `ordinary-obstacle-${randomUUID()}`
  const materials = Object.values(scene.materials).filter(material => material.applicableSurfaces.includes('terrain'))
  expect(materials.length).toBeGreaterThanOrEqual(2)
  const rock = materials.find(material => /岩|石|rock|stone/i.test(`${material.name} ${material.tags.join(' ')}`)) ?? materials[0]
  const grass = materials.find(material => material.id !== rock.id && /草|苔|grass|moss/i.test(`${material.name} ${material.tags.join(' ')}`))
    ?? materials.find(material => material.id !== rock.id)!
  const paint: MaterialPaint = { materialRef: { id: rock.id, version: rock.version }, tileSizeMm: { width: 1730, height: 2270 },
    alignment: 'world', originMm: { x: 37, y: -81 }, rotationDeg: 17, tint: null, opacity: 1 }
  const manual = { id: `hand-painted-${randomUUID()}`, boundaryMm: rect(x + 500, y + 500, 800, 600),
    paint: { ...paint, opacity: .6 }, blendWidthMm: 80, renderOrder: 0 }
  const context = { ids: { nextId: () => randomUUID() }, clock: { now: () => scene.updatedAt } }
  let prepared = applyCompositionCommands(fixedContent(blank), [
    { type: 'createTerrainArea', id: areaId, floorId, layerId, boundaryMm: rect(x, y, width, height), groundElevationMm: 0,
      surfaceStyle: { base: paint, overlays: [manual] } },
    { type: 'createPath', id: pathId, floorId, layerId, centerlineMm: [{ x: x + 2000, y: y + Math.floor(height / 2) },
      { x: x + width - 2000, y: y + Math.floor(height / 2) }], widthMm: 1200, supportRefs: [{ kind: 'terrainArea', id: areaId }],
      surfaceStyle: { base: { ...paint, materialRef: { id: grass.id, version: grass.version } }, overlays: [] } },
  ], context)
  const definition = Object.values(prepared.document.propDefinitions).sort((a, b) =>
    a.defaultFootprintMm.width * a.defaultFootprintMm.height - b.defaultFootprintMm.width * b.defaultFootprintMm.height)[0]
  expect(definition).toBeTruthy()
  prepared = applyCompositionCommands(prepared, [{ type: 'addProp', id: propId, floorId, layerId,
    definitionRef: { id: definition.id, version: definition.version }, positionMm: { x: x + width - 2000, y: y + height - 2000 },
    supportRef: { kind: 'terrainArea', id: areaId } }], context)
  const archive = unzipSync(new Uint8Array(await readFile(sourcePath)))
  archive['scene.json'] = new TextEncoder().encode(canonicalJson(prepared.document))
  archive['identity.json'] = new TextEncoder().encode(canonicalJson(prepared.historyIdentity))
  archive['appearance.json'] = new TextEncoder().encode(canonicalJson(prepared.appearance))
  const manifest = JSON.parse(new TextDecoder().decode(archive['manifest.json'])) as ProjectManifest
  for (const path of ['scene.json', 'identity.json', 'appearance.json']) {
    const entry = manifest.entries.find(entry => entry.path === path)!
    entry.sha256 = createHash('sha256').update(archive[path]).digest('hex'); entry.sizeBytes = archive[path].length
  }
  archive['manifest.json'] = new TextEncoder().encode(canonicalJson(manifest))
  const path = info.outputPath('ordinary-ready.sceneweave'); await writeFile(path, zipSync(archive))
  return { path, areaId, pathId, propId, floorId, layerId, grassId: grass.id, paint, manual,
    region: rect(x + 2000, y + 1800, Math.min(width - 4000, 7500), Math.min(Math.floor(height / 2) - 2500, 3500)),
    clearing: rect(x + Math.floor(width / 2) - 1000, y + 2000, 2000, 1500) }
}
async function importOrdinary(browser: Browser, page: Page, path: string) {
  const context = await browser.newContext(), target = await context.newPage()
  await target.goto(new URL('./#home', page.url()).href)
  const choosing = target.waitForEvent('filechooser')
  await target.getByTestId('workspace-home').getByRole('button', { name: '打开工程文件', exact: true }).click()
  await (await choosing).setFiles(path); await keyboardWorkspaceSaved(target)
  return { context, target }
}
async function surfaceDetails(page: Page, fixture: Awaited<ReturnType<typeof ordinaryGroundFixture>>, mode: 'natural' | 'shoulder') {
  await openWorkspaceModule(page, '氛围')
  await page.getByRole('navigation', { name: '视觉工具', exact: true }).getByRole('button', { name: '铺装', exact: true }).click()
  const inspector = page.getByTestId('workspace-inspector')
  await openDetailsBySummary(inspector, /^自然地表细节 · 草岩、路肩与营地$/)
  const tools = inspector.getByRole('region', { name: '自然地表细节', exact: true })
  await tools.getByLabel('地表细节用途', { exact: true }).selectOption(mode)
  await tools.getByLabel('细节目标地形', { exact: true }).selectOption(fixture.areaId)
  await tools.getByLabel('细节覆盖材质', { exact: true }).selectOption(fixture.grassId)
  await expect(tools.getByLabel('细节边缘羽化', { exact: true })).toHaveValue('0.12')
  if (mode === 'natural') {
    await tools.getByLabel('草岩细节风格', { exact: true }).selectOption('grassOnRock')
    await openDetailsBySummary(tools, /^精确坐标 · 细节覆盖范围$/)
    await tools.getByLabel('细节覆盖范围坐标', { exact: true }).fill(coordinateText(fixture.region))
  } else {
    await tools.getByLabel('细节道路', { exact: true }).selectOption(fixture.pathId)
    await tools.getByLabel('路肩地形支撑', { exact: true }).selectOption(fixture.areaId)
    await commitNumber(tools, '自然路肩宽度', '0.5')
  }
  await openDetailsBySummary(tools, /^世界材质尺度与相位$/)
  await commitNumber(tools, '细节纹理宽', '1.37'); await commitNumber(tools, '细节纹理高', '2.11')
  await commitNumber(tools, '细节世界原点X', '0.317'); await commitNumber(tools, '细节世界原点Y', '-0.223')
  await tools.getByLabel('细节纹理方向', { exact: true }).fill('23')
  return tools
}
function physical(scene: SceneDocument) {
  return { ...scene, revision: 0, updatedAt: '', terrainAreas: Object.fromEntries(Object.entries(scene.terrainAreas)
    .map(([id, { surfaceStyle: _style, ...area }]) => [id, area])), visual: undefined }
}

test('ordinary arbitrary terrain appends grass and road patches through review, source ancestry, undo and cold save', async ({ page, browser }, info) => {
  test.setTimeout(300_000)
  const fixture = await ordinaryGroundFixture(page, info), { context, target } = await importOrdinary(browser, page, fixture.path)
  const errors: string[] = []; target.on('pageerror', error => errors.push(error.message))
  try {
    const before = await keyboardProjectBackup(target, info.outputPath('surface-before.sceneweave'))
    expect(before.document.presetSnapshot.presetId).not.toContain('island')
    const originalPng = await playerPng(target, info.outputPath('surface-before-player.png'))
    let tools = await surfaceDetails(target, fixture, 'natural')
    await tools.getByRole('button', { name: '预览自然地表细节', exact: true }).click()
    await expect(reviewFor(target)).toContainText('自然草岩覆盖')
    await reviewFor(target).getByRole('button', { name: '取消视觉预览', exact: true }).click()
    await keyboardWorkspaceSaved(target)
    expect((await keyboardProjectBackup(target, info.outputPath('surface-cancelled.sceneweave'))).hashes).toEqual(before.hashes)
    tools = await surfaceDetails(target, fixture, 'natural')
    await tools.getByRole('button', { name: '预览自然地表细节', exact: true }).click(); await adopt(target, '视觉')
    const natural = await keyboardProjectBackup(target, info.outputPath('surface-grass.sceneweave'))
    const style = natural.document.terrainAreas[fixture.areaId].surfaceStyle!
    expect(style.base).toEqual(fixture.paint); expect(style.overlays[0]).toEqual(fixture.manual)
    expect(style.overlays.length).toBeGreaterThan(1)
    for (const overlay of style.overlays.slice(1)) expect(overlay.paint).toMatchObject({ alignment: 'world', originMm: { x: 317, y: -223 },
      tileSizeMm: { width: 1370, height: 2110 }, rotationDeg: 23, materialRef: { id: fixture.grassId } })
    expect(physical(natural.document)).toEqual(physical(before.document))
    expect(keyboardResourceHashes(natural.hashes)).toEqual(keyboardResourceHashes(before.hashes))
    const firstSourceId = natural.appearance.surfaceSources[fixture.areaId]
    expect(natural.appearance.sources[firstSourceId].parentSourceId).toBe(before.appearance.surfaceSources[fixture.areaId])
    tools = await surfaceDetails(target, fixture, 'shoulder')
    await tools.getByRole('button', { name: '预览自然地表细节', exact: true }).click()
    await expect(reviewFor(target)).toContainText('自然路肩'); await adopt(target, '视觉')
    const shoulder = await keyboardProjectBackup(target, info.outputPath('surface-road.sceneweave'))
    expect(shoulder.document.terrainAreas[fixture.areaId].surfaceStyle!.overlays.length).toBeGreaterThan(style.overlays.length)
    expect(shoulder.appearance.sources[shoulder.appearance.surfaceSources[fixture.areaId]].parentSourceId).toBe(firstSourceId)
    for (const [id, source] of Object.entries(natural.appearance.sources)) expect(shoulder.appearance.sources[id]).toEqual(source)
    expect(physical(shoulder.document)).toEqual(physical(before.document))
    const resultPng = await playerPng(target, info.outputPath('surface-road-player.png'))
    expect(resultPng.hash).not.toBe(originalPng.hash); await pngCrop(resultPng.image, info.outputPath('surface-road-player-crop.png'))
    await target.getByRole('button', { name: '撤销编辑', exact: true }).click(); await keyboardWorkspaceSaved(target)
    const undone = await keyboardProjectBackup(target, info.outputPath('surface-undone.sceneweave'))
    expect(undone.document.terrainAreas).toEqual(natural.document.terrainAreas)
    expect(undone.appearance.surfaceSources[fixture.areaId]).toBe(firstSourceId)
    await coldReopen(target, before.document.sceneId)
    expect((await keyboardProjectBackup(target, info.outputPath('surface-cold.sceneweave'))).hashes).toEqual(undone.hashes)
    expect(errors).toEqual([])
  } finally { await context.close() }
})

test('independent leafy fern catalogue feeds two ordinary vegetation channels with real reviewed members and player pixels', async ({ page, browser }, info) => {
  test.setTimeout(300_000)
  // Leave enough space for the palette's complete 4.5 m rotating tree crown,
  // conservative road clearance and explicit clearing to produce both channels.
  const fixture = await ordinaryGroundFixture(page, info, { widthM: 36, heightM: 24 }), { context, target } = await importOrdinary(browser, page, fixture.path)
  const errors: string[] = []; target.on('pageerror', error => errors.push(error.message))
  try {
    const before = await keyboardProjectBackup(target, info.outputPath('fern-before.sceneweave'))
    await openWorkspaceModule(target, '素材')
    const catalogue = target.getByRole('region', { name: '主题素材包', exact: true })
    await openDetailsBySummary(catalogue, /^主题素材包 · 场景与画风$/)
    await openDetailsBySummary(catalogue, /^羽叶蕨 · 清晰叶面变体$/)
    await catalogue.getByRole('button', { name: '预览添加清晰羽叶蕨', exact: true }).click()
    const review = reviewFor(target)
    await expect(review).toContainText('舒叶羽状蕨', { timeout: 90_000 })
    await expect(review.getByRole('img', { name: '待入库素材预览 舒叶羽状蕨', exact: true })).toBeVisible()
    const acknowledgments = review.getByRole('checkbox', { name: /^复核并保留素材 / })
    for (const checkbox of await acknowledgments.all()) await checkbox.check()
    await review.getByRole('button', { name: '采用组件修改', exact: true }).click()
    await expect(review).toHaveCount(0); await keyboardWorkspaceSaved(target)
    const adoptedAsset = await keyboardProjectBackup(target, info.outputPath('fern-adopted.sceneweave'))
    const fern = Object.values(adoptedAsset.document.propDefinitions).find(definition => !before.document.propDefinitions[definition.id] && definition.name === '舒叶羽状蕨')!
    expect(fern).toBeTruthy(); expect(fern.defaultAppearance.kind).toBe('image')
    expect(adoptedAsset.document.props).toEqual(before.document.props)
    for (const [id, definition] of Object.entries(before.document.propDefinitions)) expect(adoptedAsset.document.propDefinitions[id]).toEqual(definition)
    // The source index legitimately gains this new fixed SVG record. Its old
    // entries and every old resource file must still remain exact.
    for (const [path, hash] of Object.entries(keyboardResourceHashes(before.hashes))) if (path !== 'sources.json') expect(adoptedAsset.hashes[path]).toBe(hash)
    const beforeFiles = unzipSync(new Uint8Array(await readFile(info.outputPath('fern-before.sceneweave'))))
    const adoptedFiles = unzipSync(new Uint8Array(await readFile(info.outputPath('fern-adopted.sceneweave'))))
    const oldSources = JSON.parse(new TextDecoder().decode(beforeFiles['sources.json'])) as Record<string, unknown>
    const newSources = JSON.parse(new TextDecoder().decode(adoptedFiles['sources.json'])) as Record<string, SvgAuthoringSource>
    for (const [id, source] of Object.entries(oldSources)) expect(newSources[id]).toEqual(source)
    for (const [id, source] of Object.entries(before.appearance.sources)) expect(adoptedAsset.appearance.sources[id]).toEqual(source)
    if (fern.defaultAppearance.kind !== 'image') throw new Error('Expected a real independently adopted fern image')
    const fernAssetId = fern.defaultAppearance.assetId
    expect(newSources[fernAssetId]).toMatchObject({ kind: 'svg', rasterSha256: adoptedAsset.document.assets[fernAssetId].sha256 })
    const fernSource = newSources[fernAssetId]
    for (const [hash, size] of [[fernSource.sourceSha256, fernSource.sourceSizeBytes], [fernSource.normalizedSha256, fernSource.normalizedSizeBytes]] as const) {
      const bytes = adoptedFiles[`sources/${hash}.svg`]
      expect(bytes.length).toBe(size); expect(createHash('sha256').update(bytes).digest('hex')).toBe(hash)
    }
    const fernPixels = adoptedFiles[`assets/${fernSource.rasterSha256}.png`]
    expect(createHash('sha256').update(fernPixels).digest('hex')).toBe(fernSource.rasterSha256)
    const manifest = JSON.parse(new TextDecoder().decode(adoptedFiles['manifest.json'])) as ProjectManifest
    for (const subjectId of [fern.id, fernAssetId]) {
      const binding = manifest.licenseBindings.find(row => row.subjectId === subjectId)!
      expect(binding).toMatchObject({ licenseRef: fern.licenseRef, embedding: 'allowed' })
      const bytes = adoptedFiles[binding.licensePath]
      expect(new TextDecoder().decode(bytes)).toBe(LEAFY_FERN_LICENSE)
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(binding.licensePath.replace(/^licenses\//, '').replace(/\.txt$/, ''))
    }
    const originalPng = await playerPng(target, info.outputPath('fern-before-community-player.png'))
    await openTerrainTask(target, '布置植被')
    const inspector = target.getByTestId('workspace-inspector')
    await openDetailsBySummary(inspector, /^植被群落编排 · 主树、林缘与草灌$/)
    const tools = inspector.getByRole('region', { name: '植被群落编排', exact: true })
    await tools.getByLabel('群落适植地形', { exact: true }).selectOption(fixture.areaId)
    const tree = Object.values(adoptedAsset.document.propDefinitions).find(definition => /树冠|tree/i.test(`${definition.name} ${definition.tags.join(' ')}`))
    expect(tree, 'The ordinary blank palette must expose an explicit tree definition').toBeTruthy()
    await tools.getByLabel('主树群素材', { exact: true }).selectOption(tree!.id)
    await tools.getByLabel('启用灌木与蕨', { exact: true }).check(); await tools.getByLabel('灌木与蕨素材', { exact: true }).selectOption(fern.id)
    await commitNumber(tools, '主树群采样间隔', '3'); await commitNumber(tools, '灌木与蕨采样间隔', '4')
    await tools.getByLabel('群落密度倍率', { exact: true }).fill('1')
    await tools.getByLabel('群落编排种子', { exact: true }).fill('ordinary-fern-two-channels-1')
    await tools.getByLabel('群落明确避让', { exact: true }).selectOption([
      JSON.stringify({ kind: 'path', id: fixture.pathId }), JSON.stringify({ kind: 'prop', id: fixture.propId }),
    ])
    await openDetailsBySummary(tools, /^精确坐标 · 活动空地/)
    await tools.getByLabel('群落活动空地坐标', { exact: true }).fill(coordinateText(fixture.clearing))
    await tools.getByRole('button', { name: '预览植被群落编排', exact: true }).click()
    await expect(reviewFor(target)).toContainText('植被群落')
    await openDetailsBySummary(reviewFor(target), /^核对实际变化 ·/)
    await expect(reviewFor(target)).toContainText('成员映射及人工记录')
    const reviewedProps = (await reviewFor(target).locator('.composition-diff-item > strong').allTextContents()).filter(value => value.startsWith('新增物件 ·'))
    expect(reviewedProps.length).toBeGreaterThan(1)
    await target.screenshot({ path: info.outputPath('fern-community-review.png') })
    await adopt(target, '室外')
    const community = await keyboardProjectBackup(target, info.outputPath('fern-community.sceneweave'))
    const groups = Object.values(community.document.scatterGroups).filter(group => !adoptedAsset.document.scatterGroups[group.id])
    expect(groups).toHaveLength(2)
    const createdProps = Object.values(community.document.props).filter(prop => !adoptedAsset.document.props[prop.id])
    expect(createdProps).toHaveLength(reviewedProps.length)
    for (const group of groups) {
      const members = Object.values(group.members); expect(members.length).toBeGreaterThan(0)
      for (const member of members) {
        expect(member.state).toBe('managed')
        expect(community.document.props[member.propId!].supportRef).toEqual({ kind: 'terrainArea', id: fixture.areaId })
      }
    }
    expect(createdProps.some(prop => prop.definitionRef?.id === fern.id)).toBe(true)
    expect(createdProps.some(prop => prop.definitionRef?.id === tree!.id)).toBe(true)
    expect(community.document.props[fixture.propId]).toEqual(adoptedAsset.document.props[fixture.propId])
    expect(community.document.paths).toEqual(adoptedAsset.document.paths)
    expect(keyboardResourceHashes(community.hashes)).toEqual(keyboardResourceHashes(adoptedAsset.hashes))
    const output = await playerPng(target, info.outputPath('fern-community-player.png'))
    expect(output.hash).not.toBe(originalPng.hash); await pngCrop(output.image, info.outputPath('fern-community-player-crop.png'))
    await target.getByRole('button', { name: '撤销编辑', exact: true }).click(); await keyboardWorkspaceSaved(target)
    const undone = await keyboardProjectBackup(target, info.outputPath('fern-community-undone.sceneweave'))
    expect(undone.document.props).toEqual(adoptedAsset.document.props)
    expect(undone.document.scatterGroups).toEqual(adoptedAsset.document.scatterGroups)
    expect(undone.document.propDefinitions[fern.id]).toEqual(fern)
    await coldReopen(target, before.document.sceneId)
    expect((await keyboardProjectBackup(target, info.outputPath('fern-community-cold.sceneweave'))).hashes).toEqual(undone.hashes)
    expect(errors).toEqual([])
  } finally { await context.close() }
})

test('ordinary cliff profile select adopts rockRelief3 while the existing rockRelief2 sample remains independently editable', async ({ page }, info) => {
  test.setTimeout(300_000)
  await createKeyboardProject(page, '普通崖面画法选择')
  await page.locator('.workspace-file-menu > summary').click()
  await page.getByRole('group', { name: '文件操作', exact: true }).getByRole('button', { name: '从样板开始', exact: true }).click()
  const samples = page.getByRole('region', { name: '场景样板', exact: true })
  await openDetailsBySummary(samples, /^从样板开始$/)
  await samples.getByRole('button', { name: '岬湾苔岛 · 自然岩阶与崖面', exact: true }).click()
  const opening = page.getByRole('dialog', { name: '确认打开工程', exact: true })
  await expect(opening).toBeVisible({ timeout: 90_000 })
  await opening.getByRole('button', { name: '保存并打开副本', exact: true }).click(); await keyboardWorkspaceSaved(page)
  const before = await keyboardProjectBackup(page, info.outputPath('cliff-v2-before.sceneweave'))
  const base = visualBase(before.document)!, look = base.edgeLooks['q1-crown-cliff']
  expect(look.renderProfile).toBe('rockRelief2')
  const oldPng = await playerPng(page, info.outputPath('cliff-v2-player.png'))
  await openWorkspaceModule(page, '氛围')
  await page.getByRole('navigation', { name: '视觉工具', exact: true }).getByRole('button', { name: '边界', exact: true }).click()
  const tools = page.getByTestId('workspace-inspector').getByRole('region', { name: '曲线与边带', exact: true })
  await tools.getByLabel('视觉已有曲线', { exact: true }).selectOption(look.boundaryId)
  await tools.getByLabel('崖面层次画法', { exact: true }).selectOption('rockRelief3')
  await tools.getByRole('button', { name: '预览曲线与边带', exact: true }).click(); await adopt(page, '视觉')
  const after = await keyboardProjectBackup(page, info.outputPath('cliff-v3.sceneweave'))
  expect(visualBase(after.document)!.edgeLooks[look.id]).toEqual({ ...look, renderProfile: 'rockRelief3' })
  expect(visualBase(after.document)!.boundaries).toEqual(base.boundaries)
  expect(physical(after.document)).toEqual(physical(before.document))
  expect(keyboardResourceHashes(after.hashes)).toEqual(keyboardResourceHashes(before.hashes))
  const output = await playerPng(page, info.outputPath('cliff-v3-player.png'))
  expect(output.hash).not.toBe(oldPng.hash); await pngCrop(output.image, info.outputPath('cliff-v3-player-crop.png'))
  await page.getByRole('button', { name: '撤销编辑', exact: true }).click(); await keyboardWorkspaceSaved(page)
  const undone = await keyboardProjectBackup(page, info.outputPath('cliff-v3-undone.sceneweave'))
  expect(visualBase(undone.document)).toEqual(base)
  await coldReopen(page, before.document.sceneId)
  expect((await keyboardProjectBackup(page, info.outputPath('cliff-v3-cold.sceneweave'))).hashes).toEqual(undone.hashes)
})
