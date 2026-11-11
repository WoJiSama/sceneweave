import { expect, test, type Browser, type Locator, type Page, type TestInfo } from '@playwright/test'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { unzipSync, zipSync } from 'fflate'
import polygonClipping from 'polygon-clipping'
import { applyCompositionCommands } from '../src/shared/appearance/commands'
import type { SceneCommand } from '../src/shared/commands/commands'
import { pathPolygon } from '../src/shared/geometry/geometry'
import type { PointMm, SceneDocument, SurfaceStyle } from '../src/shared/model/scene'
import type { ProjectManifest } from '../src/shared/project/file'
import { canonicalJson } from '../src/shared/validation/json'
import { createKeyboardProject, keyboardProjectBackup, keyboardResourceHashes, keyboardWorkspaceSaved, selectKeyboardProp } from './keyboard-ux-helpers'
import { openGenerationTask, openTerrainTask, openWorkspaceModule } from './workspace-navigation-helpers'
import { mapExportButton, openDetailsBySummary } from './workspace-ux-helpers'

const evidenceRoot = 'work/detail-acceptance-20261110/general'
const { PNG } = createRequire(import.meta.url)('../node_modules/playwright-core/lib/utilsBundle.js')
type Backup = Awaited<ReturnType<typeof keyboardProjectBackup>>
const review = (page: Page) => page.getByRole('region', { name: '候选审阅', exact: true })
const rect = (x: number, y: number, w: number, h: number): PointMm[] => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }]
const text = (points: PointMm[]) => points.map(point => `${point.x}, ${point.y}`).join('\n')
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const world = { x: -12000, y: -8000, width: 48000, height: 36000 }
// Independent holdout: never used to tune the implementation or the previous
// rectangle-based development journeys. Freeze these values before execution.
const boundary = [{ x: -9000, y: -5000 }, { x: 28000, y: -5000 }, { x: 31000, y: 1000 }, { x: 31000, y: 23000 },
  { x: 16000, y: 23000 }, { x: 16000, y: 19000 }, { x: -7000, y: 19000 }, { x: -9000, y: 14000 }]
const naturalRegion = [{ x: -6500, y: -2500 }, { x: 3000, y: -2500 }, { x: 3000, y: 500 }, { x: 1000, y: 500 }, { x: 1000, y: 2500 }, { x: -6500, y: 2500 }]
const roadPoints = [{ x: -5000, y: 5000 }, { x: 14000, y: 5000 }, { x: 14000, y: 14000 }]
const campRegion = rect(20000, 4000, 6000, 5000)
const seed = 'formal-holdout-concave-20261110-a'
const generatedInput = { title: '正式森林生成来源留出输入', seed: 'formal-forest-outcrop-20261110-f61e', widthMm: 36000, heightMm: 28000,
  clearing: { x: 14000, y: 11000, width: 9000, height: 5500 }, entranceSide: 'south', routeWidthMm: 1800,
  // Revision 2 corrects the native percentage input's 0.1 step: the original
  // 0.15 never submitted a generation request. Seed and geometry stay fixed.
  coveragePercent: { trees: 9, shrubs: 1.5, grass: .2 }, patchRegion: rect(2400, 2200, 5000, 3600), patchSeed: 'formal-generated-rock-gap-20261110-b91a' }
const matrix = {
  status: 'declared before execution; results are per case, not blanket acceptance',
  artifactFingerprint: '75c9d96e042e362f303d46fb79ec69c0f9d4322a1a87473812a9df38c2d25290',
  sources: 'normal blank UI export, native complete composition commands, manifest-updated complete-file import; independent normal manual terrain and catalogue adoption',
  inputs: { world, boundary, naturalRegion, roadPoints, campRegion, seed, material: { tileWidthMm: 2750, tileHeightMm: 1250, originMm: { x: -1147, y: 2383 }, rotationDeg: 76, opacity: .72, blendWidthMm: 180 } },
  cases: [
    'holdout rockOnGrass + finite grass edges: cancel/adopt/undo/redo/cold/full source ancestry/GM and player PNG',
    'grassOnRock semantic invariance after fresh legal IDs and renamed project',
    'bent road shoulder: complete square-cap/miter physical band, source append, cancel/one undo/redo/cold',
    'camp patch: world paint, prior manual overlay/source ancestry, one undo/redo/cold',
    'noninteger clipping refusal without partial writes', 'hole clipping refusal without partial writes', 'target edit lock refusal without partial writes',
    'normal manual terrain + explicit four-channel palettes: real review/cancel/adopt/one undo/redo/cold, manual member deletion then native regeneration',
    'four-channel compact budget refusal without partial writes', 'two normal tabs: stale candidate cannot overwrite other persisted branch',
    'normal forest generation with a new frozen seed and bounds: save new complete project, append ordinary rock gap, one undo/cold read/actual player PNG',
  ],
  generatedInput,
  notCoveredHere: ['sample-specific visual acceptance', 'AI/Worker/CLI authority matrix', 'performance', 'cross-browser', 'P3 user sign-off'],
}
test.use({ actionTimeout: 15_000 })
test.beforeAll(async () => {
  await mkdir(evidenceRoot, { recursive: true })
  const artifactPath = process.env.SCENEWEAVE_DETAIL_ARTIFACT ?? 'work/detail-acceptance-20261110/frozen-artifact.json'
  const artifact = JSON.parse(await readFile(artifactPath, 'utf8')), specBytes = await readFile('tests/detail-general-acceptance.spec.ts'), specSha256 = digest(specBytes)
  const declaration = JSON.stringify({ ...matrix, artifactFingerprint: artifact.artifactFingerprint, artifactPath, artifact, specSha256, frozenAt: new Date().toISOString() }, null, 2) + '\n'
  await writeFile(`${evidenceRoot}/matrix-${specSha256}.json`, declaration, { flag: 'wx' }).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error })
  await writeFile(`${evidenceRoot}/spec-${specSha256}.ts`, specBytes, { flag: 'wx' }).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error })
})
async function number(scope: Locator, label: string, value: string) { const input = scope.getByLabel(label, { exact: true }); await input.fill(value); await input.press('Tab') }
async function adopt(page: Page, kind: '视觉' | '室外') {
  await expect(review(page)).toBeVisible(); await review(page).getByLabel('确认完整影响范围', { exact: true }).check()
  await review(page).getByRole('button', { name: `采用${kind}修改`, exact: true }).click()
  await expect(review(page)).toHaveCount(0); await keyboardWorkspaceSaved(page)
}
async function cold(page: Page, sceneId: string) {
  await page.reload(); await page.getByRole('button', { name: '回到首页', exact: true }).click()
  await page.getByTestId('workspace-home').locator(`[data-project-key="native:${sceneId}"]`).getByRole('button', { name: '打开', exact: true }).click()
  await keyboardWorkspaceSaved(page)
}
async function backup(page: Page, info: TestInfo, name: string) { return keyboardProjectBackup(page, info.outputPath(`${name}.sceneweave`)) }
async function png(page: Page, audience: 'gm' | 'player', info: TestInfo, name: string) {
  const download = page.waitForEvent('download'); await (await mapExportButton(page, audience)).click()
  await (await download).saveAs(info.outputPath(`${name}.png`)); await keyboardWorkspaceSaved(page)
  await page.locator('.workspace-export-menu > summary').click()
  const image = PNG.sync.read(await readFile(info.outputPath(`${name}.png`))) as { width: number; height: number; data: Uint8Array }
  return { hash: digest(image.data), width: image.width, height: image.height }
}
function physical(scene: SceneDocument) {
  return { ...scene, revision: 0, updatedAt: '', visual: undefined,
    terrainAreas: Object.fromEntries(Object.entries(scene.terrainAreas).map(([id, { surfaceStyle: _surface, ...area }]) => [id, area])) }
}
function style(scene: SceneDocument, id: string): SurfaceStyle { return scene.terrainAreas[id].surfaceStyle! }
function sourceAppend(before: Backup, after: Backup, id: string) {
  const oldId = before.appearance.surfaceSources[id], next = after.appearance.surfaceSources[id]
  expect(next).not.toBe(oldId); expect(after.appearance.sources[next].parentSourceId).toBe(oldId)
  for (const [key, value] of Object.entries(before.appearance.sources)) expect(after.appearance.sources[key]).toEqual(value)
  for (const [key, value] of Object.entries(before.identity.presentationTokens ?? {})) expect(after.identity.presentationTokens?.[key]).toEqual(value)
  expect(keyboardResourceHashes(after.hashes)).toEqual(keyboardResourceHashes(before.hashes))
}
async function historyRoundTrip(page: Page, info: TestInfo, before: Backup, adopted: Backup, areaId: string, prefix: string) {
  await page.getByRole('button', { name: '撤销编辑', exact: true }).click(); await keyboardWorkspaceSaved(page)
  const undone = await backup(page, info, `${prefix}-undo`)
  expect(undone.document.terrainAreas).toEqual(before.document.terrainAreas)
  expect(undone.document.paths).toEqual(before.document.paths)
  expect(undone.appearance.surfaceSources[areaId]).toBe(before.appearance.surfaceSources[areaId])
  await page.getByRole('button', { name: '重做编辑', exact: true }).click(); await keyboardWorkspaceSaved(page)
  const redone = await backup(page, info, `${prefix}-redo`)
  expect(redone.document.terrainAreas).toEqual(adopted.document.terrainAreas)
  expect(redone.appearance.surfaceSources[areaId]).toBe(adopted.appearance.surfaceSources[areaId])
  await cold(page, adopted.document.sceneId)
  expect((await backup(page, info, `${prefix}-cold`)).hashes).toEqual(redone.hashes)
}
async function fixture(page: Page, info: TestInfo, options: { suffix?: string; locked?: boolean; hole?: boolean } = {}) {
  await createKeyboardProject(page, '正式独立普通输入')
  const plainPath = info.outputPath(`blank-${options.suffix ?? 'a'}.sceneweave`), blank = await keyboardProjectBackup(page, plainPath)
  const floorId = Object.keys(blank.document.floors)[0], layerId = Object.keys(blank.document.userLayers)[0]
  const suffix = options.suffix ?? 'cobalt', areaId = `ordinary-${suffix}-moor`, pathId = `ordinary-${suffix}-bend`, obstacleId = `ordinary-${suffix}-lamp`
  const materials = Object.values(blank.document.materials).filter(row => row.applicableSurfaces.includes('terrain'))
  const baseMaterial = materials.find(row => /岩/.test(row.name))!, paintMaterial = materials.find(row => /草/.test(row.name))!
  expect(baseMaterial).toBeTruthy(); expect(paintMaterial).toBeTruthy()
  const base = { materialRef: { id: baseMaterial.id, version: baseMaterial.version }, tileSizeMm: { width: 2860, height: 1490 }, alignment: 'world' as const,
    originMm: { x: -435, y: 271 }, rotationDeg: 31, tint: null, opacity: 1 }
  const manual = { id: `manual-${suffix}-keep`, boundaryMm: rect(-7000, 10000, 1200, 700), paint: { ...base, opacity: .48 }, blendWidthMm: 93, renderOrder: 2 }
  const runtime = { ids: { nextId: () => randomUUID() }, clock: { now: () => '2026-11-10T08:00:00.000Z' } }
  const commands: SceneCommand[] = [
    { type: 'createTerrainArea', id: areaId, floorId, layerId, boundaryMm: boundary, groundElevationMm: 0, surfaceStyle: { base, overlays: [manual] } },
    { type: 'createPath', id: pathId, floorId, layerId, centerlineMm: roadPoints, widthMm: 1400, supportRefs: [{ kind: 'terrainArea', id: areaId }], surfaceStyle: { base, overlays: [] } },
  ]
  const lamp = Object.values(blank.document.propDefinitions).find(row => /旧铜灯架/.test(row.name))!
  commands.push({ type: 'addProp', id: obstacleId, floorId, layerId, definitionRef: { id: lamp.id, version: lamp.version }, positionMm: { x: -5000, y: 15000 }, supportRef: { kind: 'terrainArea', id: areaId } })
  if (options.hole) commands.push({ type: 'createTerrainArea', id: `islet-${suffix}`, floorId, layerId, boundaryMm: rect(22000, 5500, 1600, 1600), groundElevationMm: 0, coveragePriority: 9, surfaceStyle: { base, overlays: [] } })
  let project = applyCompositionCommands({ document: blank.document, appearance: blank.appearance, historyIdentity: blank.identity }, [{ type: 'renameScene', title: `正式留出输入 ${suffix}` }], runtime)
  project = applyCompositionCommands(project, [{ type: 'setCanvasBounds', floorId, floorBoundsMm: world, exportBoundsMm: world }], runtime)
  project = applyCompositionCommands(project, commands, runtime)
  if (options.locked) project = applyCompositionCommands(project, [{ type: 'setEditLock', kind: 'terrainArea', id: areaId, locked: true }], runtime)
  const files = unzipSync(new Uint8Array(await readFile(plainPath))), manifest = JSON.parse(new TextDecoder().decode(files['manifest.json'])) as ProjectManifest
  files['scene.json'] = new TextEncoder().encode(canonicalJson(project.document)); files['identity.json'] = new TextEncoder().encode(canonicalJson(project.historyIdentity)); files['appearance.json'] = new TextEncoder().encode(canonicalJson(project.appearance))
  for (const name of ['scene.json', 'identity.json', 'appearance.json']) { const row = manifest.entries.find(row => row.path === name)!; row.sha256 = digest(files[name]); row.sizeBytes = files[name].length }
  files['manifest.json'] = new TextEncoder().encode(canonicalJson(manifest))
  const filename = info.outputPath(`frozen-${suffix}.sceneweave`), bytes = zipSync(files); await writeFile(filename, bytes)
  await writeFile(info.outputPath(`frozen-${suffix}.json`), JSON.stringify({ inputSha256: digest(bytes), ids: { floorId, layerId, areaId, pathId, obstacleId }, ...matrix.inputs,
    projectHashes: Object.fromEntries(Object.entries(files).map(([path, value]) => [path, digest(value)])), options }, null, 2))
  return { filename, areaId, pathId, obstacleId, floorId, layerId, paintId: paintMaterial.id, base, manual }
}
type Fixture = Awaited<ReturnType<typeof fixture>>
async function imported(browser: Browser, sourcePage: Page, input: Fixture) {
  const context = await browser.newContext(), page = await context.newPage()
  await page.goto(new URL('./#home', sourcePage.url()).href)
  const chooser = page.waitForEvent('filechooser'); await page.getByTestId('workspace-home').getByRole('button', { name: '打开工程文件', exact: true }).click()
  await (await chooser).setFiles(input.filename); await keyboardWorkspaceSaved(page)
  return { context, page }
}
async function details(page: Page, input: Pick<Fixture, 'areaId' | 'pathId' | 'paintId'>, mode: 'natural' | 'shoulder' | 'camp', region = naturalRegion, profile: 'grassOnRock' | 'rockOnGrass' = 'rockOnGrass') {
  const resources = await openWorkspaceModule(page, '氛围')
  await resources.getByRole('navigation', { name: '视觉工具', exact: true }).getByRole('button', { name: '铺装', exact: true }).click()
  await openDetailsBySummary(page.getByTestId('workspace-inspector'), /^自然地表细节 · 草岩、路肩与营地$/)
  const tools = page.getByRole('region', { name: '自然地表细节', exact: true })
  await tools.getByLabel('地表细节用途', { exact: true }).selectOption(mode)
  await tools.getByLabel('细节目标地形', { exact: true }).selectOption(input.areaId)
  await tools.getByLabel('细节覆盖材质', { exact: true }).selectOption(input.paintId)
  if (mode === 'shoulder') {
    await tools.getByLabel('细节道路', { exact: true }).selectOption(input.pathId); await tools.getByLabel('路肩地形支撑', { exact: true }).selectOption(input.areaId)
    await number(tools, '自然路肩宽度', '.75')
  } else {
    await openDetailsBySummary(tools, /^精确坐标 · 细节覆盖范围$/)
    await tools.getByLabel('细节覆盖范围坐标', { exact: true }).fill(text(region))
    if (mode === 'natural') await tools.getByLabel('草岩细节风格', { exact: true }).selectOption(profile)
  }
  await number(tools, '细节边缘羽化', '.18')
  if (mode !== 'camp') await tools.getByLabel('地表细节种子', { exact: true }).fill(seed)
  await openDetailsBySummary(tools, /^世界材质尺度与相位$/)
  for (const [label, value] of [['细节纹理宽', '2.75'], ['细节纹理高', '1.25'], ['细节世界原点X', '-1.147'], ['细节世界原点Y', '2.383']]) await number(tools, label, value)
  await tools.getByLabel('细节纹理方向', { exact: true }).fill('76'); await tools.getByLabel('细节覆盖透明度', { exact: true }).fill('.72')
  return tools
}
async function submit(page: Page, tools: Locator) { await tools.getByRole('button', { name: '预览自然地表细节', exact: true }).click(); await expect(review(page)).toBeVisible() }
function verifyPatch(before: Backup, after: Backup, input: Fixture) {
  expect(physical(after.document)).toEqual(physical(before.document)); expect(style(after.document, input.areaId).base).toEqual(input.base)
  expect(style(after.document, input.areaId).overlays[0]).toEqual(input.manual)
  const added = style(after.document, input.areaId).overlays.slice(1); expect(added.length).toBeGreaterThan(0)
  for (const patch of added) {
    expect(patch.paint).toEqual({ materialRef: { id: input.paintId, version: 1 }, alignment: 'world', originMm: { x: -1147, y: 2383 }, tileSizeMm: { width: 2750, height: 1250 }, rotationDeg: 76, opacity: .72, tint: null })
    expect(patch.blendWidthMm).toBe(180); expect(patch.boundaryMm.every(point => Number.isSafeInteger(point.x) && Number.isSafeInteger(point.y))).toBe(true)
    expect(after.identity.presentationTokens?.[patch.id]?.kind).toBe('surfaceOverlay')
  }
  sourceAppend(before, after, input.areaId)
}

test('holdout concave negative-coordinate terrain: rock gaps and finite grass edges preserve ordinary history and both output audiences', async ({ page, browser }, info) => {
  test.setTimeout(240_000)
  const input = await fixture(page, info), target = await imported(browser, page, input)
  try {
    const before = await backup(target.page, info, 'before')
    const gmBefore = await png(target.page, 'gm', info, 'before-gm'), playerBefore = await png(target.page, 'player', info, 'before-player')
    const tools = await details(target.page, input, 'natural')
    await tools.getByLabel('添加断续草沿', { exact: true }).check(); await submit(target.page, tools)
    await review(target.page).getByRole('button', { name: '取消视觉预览', exact: true }).click(); await keyboardWorkspaceSaved(target.page)
    expect((await backup(target.page, info, 'cancelled')).hashes).toEqual(before.hashes)
    const again = await details(target.page, input, 'natural'); await again.getByLabel('添加断续草沿', { exact: true }).check()
    await submit(target.page, again); await adopt(target.page, '视觉')
    const after = await backup(target.page, info, 'adopted'); verifyPatch(before, after, input)
    const gm = await png(target.page, 'gm', info, 'adopted-gm'), player = await png(target.page, 'player', info, 'adopted-player')
    expect(gm.width).toBe(4096); expect(player.width).toBe(4096); expect(player.height).toBe(3072)
    expect(gm.hash).not.toBe(gmBefore.hash); expect(player.hash).not.toBe(playerBefore.hash)
    await historyRoundTrip(target.page, info, before, after, input.areaId, 'surface')
  } finally { await target.context.close() }
})

test('fresh legal area and path IDs and a renamed project retain grass-tongue semantic geometry', async ({ page, browser }, info) => {
  test.setTimeout(240_000)
  const results: unknown[] = []
  for (const suffix of ['juniper-holdout', 'clockwork-renamed']) {
    const input = await fixture(page, info, { suffix }), target = await imported(browser, page, input)
    try {
      const before = await backup(target.page, info, `${suffix}-before`), tools = await details(target.page, input, 'natural', naturalRegion, 'grassOnRock')
      await submit(target.page, tools); await adopt(target.page, '视觉')
      const after = await backup(target.page, info, `${suffix}-adopted`); verifyPatch(before, after, input)
      results.push(style(after.document, input.areaId).overlays.slice(1).map(({ id: _id, ...overlay }) => overlay))
    } finally { await target.context.close() }
  }
  expect(results[1]).toEqual(results[0])
})

test('bent-road static shoulder covers the entire real band and survives a single undo, redo and cold read', async ({ page, browser }, info) => {
  test.setTimeout(240_000)
  const input = await fixture(page, info), target = await imported(browser, page, input)
  try {
    const before = await backup(target.page, info, 'before'), beforePng = await png(target.page, 'player', info, 'before-player')
    const tools = await details(target.page, input, 'shoulder')
    await submit(target.page, tools); await review(target.page).getByRole('button', { name: '取消视觉预览', exact: true }).click(); await keyboardWorkspaceSaved(target.page)
    expect((await backup(target.page, info, 'cancelled')).hashes).toEqual(before.hashes)
    await submit(target.page, await details(target.page, input, 'shoulder')); await adopt(target.page, '视觉')
    const after = await backup(target.page, info, 'adopted'); verifyPatch(before, after, input)
    const band: polygonClipping.Polygon = [pathPolygon(before.document.paths[input.pathId]).map(point => [point.x, point.y])]
    const cover: polygonClipping.Polygon[] = style(after.document, input.areaId).overlays.slice(1).map(patch => [patch.boundaryMm.map(point => [point.x, point.y])])
    expect(polygonClipping.difference(band, ...cover)).toEqual([])
    expect((await png(target.page, 'player', info, 'shoulder-player')).hash).not.toBe(beforePng.hash)
    await historyRoundTrip(target.page, info, before, after, input.areaId, 'shoulder')
  } finally { await target.context.close() }
})

test('ordinary camp selection appends fixed world paint without changing physical support or prior manual coverage', async ({ page, browser }, info) => {
  test.setTimeout(240_000)
  const input = await fixture(page, info), target = await imported(browser, page, input)
  try {
    const before = await backup(target.page, info, 'before'), gmBefore = await png(target.page, 'gm', info, 'before-gm'), playerBefore = await png(target.page, 'player', info, 'before-player')
    await submit(target.page, await details(target.page, input, 'camp', campRegion)); await adopt(target.page, '视觉')
    const after = await backup(target.page, info, 'adopted'); verifyPatch(before, after, input)
    expect((await png(target.page, 'gm', info, 'camp-gm')).hash).not.toBe(gmBefore.hash)
    expect((await png(target.page, 'player', info, 'camp-player')).hash).not.toBe(playerBefore.hash)
    await historyRoundTrip(target.page, info, before, after, input.areaId, 'camp')
  } finally { await target.context.close() }
})

for (const invalid of ['fractional', 'hole', 'locked'] as const) test(`ordinary patch ${invalid} rejection preserves the entire saved project`, async ({ page, browser }, info) => {
  test.setTimeout(180_000)
  const input = await fixture(page, info, { suffix: invalid, hole: invalid === 'hole', locked: invalid === 'locked' }), target = await imported(browser, page, input)
  try {
    const before = await backup(target.page, info, 'before')
    const tools = await details(target.page, input, invalid === 'hole' ? 'camp' : 'natural', invalid === 'fractional' ? rect(27000, -2001, 5000, 4000) : invalid === 'hole' ? campRegion : naturalRegion)
    await tools.getByRole('button', { name: '预览自然地表细节', exact: true }).click()
    await expect(tools.getByRole('alert')).toContainText(invalid === 'fractional' ? /整数|小数/ : invalid === 'hole' ? /洞|孔/ : /锁/)
    await expect(review(target.page)).toHaveCount(0)
    expect((await backup(target.page, info, 'refused')).hashes).toEqual(before.hashes)
    await cold(target.page, before.document.sceneId)
    expect((await backup(target.page, info, 'cold')).hashes).toEqual(before.hashes)
  } finally { await target.context.close() }
})

async function manualCommunity(page: Page, info: TestInfo) {
  // Use the normal new-scene UI for its larger bounds, keeping this independent
  // of shared-command fixture construction and previous sample geometry.
  await page.goto('./#home')
  await page.getByTestId('workspace-home').getByRole('button', { name: '新建场景', exact: true }).click()
  const creating = page.getByRole('dialog', { name: '新建空白场景', exact: true })
  await creating.getByLabel('场景名称', { exact: true }).fill('正式手工四通道留出输入')
  await creating.getByLabel('画布宽度', { exact: true }).fill('48'); await creating.getByLabel('画布高度', { exact: true }).fill('36')
  await creating.getByRole('button', { name: '创建空白场景', exact: true }).click(); await keyboardWorkspaceSaved(page)
  await openWorkspaceModule(page, '素材'); const catalogue = page.getByRole('region', { name: '主题素材包', exact: true })
  await openDetailsBySummary(catalogue, /^主题素材包 · 场景与画风$/); await openDetailsBySummary(catalogue, /^植被细节 · 六件独立变体$/)
  await catalogue.getByRole('button', { name: '预览添加六件植被细节变体', exact: true }).click()
  await expect(review(page)).toContainText('弯叶疏草簇', { timeout: 90_000 })
  for (const box of await review(page).getByRole('checkbox', { name: /^复核并保留素材 / }).all()) await box.check()
  await review(page).getByRole('button', { name: '采用组件修改', exact: true }).click(); await keyboardWorkspaceSaved(page)
  await openTerrainTask(page, '绘制地形')
  const tools = page.getByTestId('workspace-inspector').locator('.outdoor-panel.workspace-tool-parameters')
  await openDetailsBySummary(tools, /^精确坐标 · 区域轮廓$/)
  await tools.getByLabel('室外坐标', { exact: true }).fill(text([{ x: 2500, y: 3500 }, { x: 43500, y: 3500 }, { x: 43500, y: 31000 }, { x: 29000, y: 31000 }, { x: 29000, y: 28000 }, { x: 2500, y: 28000 }]))
  await tools.getByRole('button', { name: '预览室外修改', exact: true }).click(); await adopt(page, '室外')
  const terrain = await backup(page, info, 'manual-terrain-before-road'), terrainId = Object.keys(terrain.document.terrainAreas)[0]
  const resources = await openWorkspaceModule(page, '地形')
  await resources.getByRole('group', { name: '室外任务', exact: true }).getByRole('button', { name: /^道路/ }).click()
  await number(tools, '室外通路净宽', '1.6')
  await tools.getByLabel('道路支撑表面', { exact: true }).selectOption(`terrainArea:${terrainId}`)
  await openDetailsBySummary(tools, /^精确坐标 · 道路中心线$/)
  await tools.getByLabel('室外坐标', { exact: true }).fill(text([{ x: 6500, y: 20500 }, { x: 36000, y: 20500 }, { x: 36000, y: 26000 }]))
  await tools.getByRole('button', { name: '预览室外修改', exact: true }).click(); await adopt(page, '室外')
  const before = await backup(page, info, 'frozen-manual-community'), areaId = Object.keys(before.document.terrainAreas)[0]
  await writeFile(info.outputPath('frozen-manual-community.json'), JSON.stringify({ hashes: before.hashes, areaId, seed: 'formal-four-channels-20261110-independent', channels: ['mainTrees', 'secondaryTrees', 'shrubs', 'grass'], cellsMm: [6500, 7000, 5000, 4500], density: .65 }, null, 2))
  return { before, areaId }
}
async function communityTools(page: Page, before: Backup, areaId: string, dense = false) {
  await openTerrainTask(page, '布置植被'); await openDetailsBySummary(page.getByTestId('workspace-inspector'), /^植被群落编排 · 主树、林缘与草灌$/)
  const tools = page.getByRole('region', { name: '植被群落编排', exact: true })
  await tools.getByLabel('群落适植地形', { exact: true }).selectOption(areaId)
  for (const [label, name, cell] of [['主树群', '裂叶阔冠栎', '6.5'], ['次树与林缘', '窄冠碎叶桦', '7'], ['灌木与蕨', '缺口低灌丛', '5'], ['草簇', '弯叶疏草簇', '4.5']]) {
    const definition = Object.values(before.document.propDefinitions).find(row => row.name === name)!
    expect(definition, `Explicit fixed palette ${name}`).toBeTruthy()
    await tools.getByLabel(`启用${label}`, { exact: true }).check(); await tools.getByLabel(`${label}素材`, { exact: true }).selectOption(definition.id)
    await number(tools, `${label}采样间隔`, dense ? '1' : cell)
  }
  await tools.getByLabel('群落密度倍率', { exact: true }).fill(dense ? '1' : '.65')
  await tools.getByLabel('群落编排种子', { exact: true }).fill('formal-four-channels-20261110-independent')
  await tools.getByLabel('群落明确避让', { exact: true }).selectOption(Object.keys(before.document.paths).map(id => JSON.stringify({ kind: 'path', id })))
  await openDetailsBySummary(tools, /^精确坐标 · 活动空地/)
  await tools.getByLabel('群落活动空地坐标', { exact: true }).fill(text(rect(16000, 13000, 5000, 3500)))
  return tools
}

test('ordinary manually drawn terrain supports four explicit channels, cancel, one undo and redo, manual deletion, native regeneration and cold save', async ({ page }, info) => {
  test.setTimeout(360_000)
  const { before, areaId } = await manualCommunity(page, info)
  let tools = await communityTools(page, before, areaId)
  await tools.getByRole('button', { name: '预览植被群落编排', exact: true }).click(); await expect(review(page)).toBeVisible()
  await review(page).getByRole('button', { name: '取消室外预览', exact: true }).click(); await keyboardWorkspaceSaved(page)
  expect((await backup(page, info, 'community-cancelled')).hashes).toEqual(before.hashes)
  tools = await communityTools(page, before, areaId)
  await tools.getByRole('button', { name: '预览植被群落编排', exact: true }).click(); await openDetailsBySummary(review(page), /^核对实际变化 ·/)
  const reviewed = (await review(page).locator('.composition-diff-item > strong').allTextContents()).filter(value => value.startsWith('新增物件 ·')).length
  expect(reviewed).toBeGreaterThan(4); await page.screenshot({ path: info.outputPath('four-channel-review.png') }); await adopt(page, '室外')
  const adopted = await backup(page, info, 'community-adopted'), groups = Object.values(adopted.document.scatterGroups)
  expect(groups).toHaveLength(4); expect(Object.keys(adopted.document.props)).toHaveLength(reviewed)
  for (const group of groups) { expect(Object.keys(group.members).length).toBeGreaterThan(0); expect(group.algorithmVersion).toBe('scatter-cell-v2') }
  expect(keyboardResourceHashes(adopted.hashes)).toEqual(keyboardResourceHashes(before.hashes))
  await page.getByRole('button', { name: '撤销编辑', exact: true }).click(); await keyboardWorkspaceSaved(page)
  expect((await backup(page, info, 'community-undo')).document.props).toEqual(before.document.props)
  await page.getByRole('button', { name: '重做编辑', exact: true }).click(); await keyboardWorkspaceSaved(page)
  expect((await backup(page, info, 'community-redo')).document.scatterGroups).toEqual(adopted.document.scatterGroups)
  const group = groups.find(row => row.palette[0].propDefinitionRef.id.includes('grass-bent-verge'))!, deletedId = Object.values(group.members).find(row => row.propId)!.propId!
  await selectKeyboardProp(page, deletedId)
  await page.getByTestId('workspace-inspector').getByRole('button', { name: '删除并保留排除区', exact: true }).click(); await adopt(page, '室外')
  const manual = await backup(page, info, 'community-manual-delete')
  expect(manual.document.props[deletedId]).toBeUndefined()
  const scenePanel = await openWorkspaceModule(page, '场景')
  await scenePanel.getByRole('group', { name: '场景对象分类', exact: true }).getByRole('button', { name: '组合', exact: true }).click()
  await scenePanel.getByLabel('搜索场景对象', { exact: true }).fill(group.id); await scenePanel.locator(`[data-entity-id="${group.id}"]`).click()
  await page.getByTestId('workspace-inspector').getByLabel('对象散布密度', { exact: true }).fill('.9')
  await page.getByTestId('workspace-inspector').getByRole('button', { name: '预览重新散布', exact: true }).click(); await adopt(page, '室外')
  const regenerated = await backup(page, info, 'community-regenerated')
  expect(regenerated.document.props[deletedId]).toBeUndefined()
  expect(Object.values(regenerated.document.scatterGroups[group.id].members).some(row => row.state === 'deleted')).toBe(true)
  await png(page, 'gm', info, 'four-channel-gm'); await png(page, 'player', info, 'four-channel-player')
  await cold(page, regenerated.document.sceneId); expect((await backup(page, info, 'community-cold')).hashes).toEqual(regenerated.hashes)
})

test('ordinary four-channel compact overflow refuses the entire candidate and preserves the saved manual scene', async ({ page }, info) => {
  test.setTimeout(240_000)
  const { before, areaId } = await manualCommunity(page, info), tools = await communityTools(page, before, areaId, true)
  await tools.getByRole('button', { name: '预览植被群落编排', exact: true }).click()
  await expect(tools.getByRole('alert')).toContainText(/预算|256|超/); await expect(review(page)).toHaveCount(0)
  expect((await backup(page, info, 'budget-refused')).hashes).toEqual(before.hashes)
  await cold(page, before.document.sceneId); expect((await backup(page, info, 'budget-cold')).hashes).toEqual(before.hashes)
})

test('a grass candidate from an old persisted baseline cannot replace the second tab branch and both complete projects remain recoverable', async ({ page, browser }, info) => {
  test.setTimeout(240_000)
  const input = await fixture(page, info, { suffix: 'stale-branch' }), target = await imported(browser, page, input)
  try {
    const before = await backup(target.page, info, 'before')
    await submit(target.page, await details(target.page, input, 'natural'))
    await expect(target.page.getByRole('button', { name: '撤销编辑', exact: true })).toBeDisabled()
    const other = await target.context.newPage()
    await other.goto(new URL('./#home', target.page.url()).href)
    await other.getByTestId('workspace-home').locator(`[data-project-key="native:${before.document.sceneId}"]`).getByRole('button', { name: '打开', exact: true }).click()
    await keyboardWorkspaceSaved(other)
    const scenePanel = await openWorkspaceModule(other, '场景')
    await scenePanel.getByRole('button', { name: '场景设置', exact: true }).click()
    const settings = other.getByTestId('workspace-inspector').getByRole('region', { name: '场景设置', exact: true }).and(other.locator('.workspace-project-tools'))
    await settings.getByLabel('工程名称', { exact: true }).and(settings.locator('input:enabled')).fill('正式另标签页已保存的新成果')
    await settings.getByRole('button', { name: '保存名称', exact: true }).and(settings.locator('button:enabled')).click(); await keyboardWorkspaceSaved(other)
    const external = await backup(other, info, 'external-before-conflict')
    await review(target.page).getByLabel('确认完整影响范围', { exact: true }).check()
    await review(target.page).getByRole('button', { name: '采用视觉修改', exact: true }).click()
    const recovery = target.page.getByRole('alert', { name: '保存恢复选项', exact: true })
    await expect(recovery).toContainText('保存版本发生冲突'); await expect(recovery).toContainText('另一版本不会被覆盖')
    await expect(recovery.getByRole('button', { name: '重试保存', exact: true })).toHaveCount(0)
    const retained = await backup(target.page, info, 'candidate-retained-locally')
    expect(style(retained.document, input.areaId).overlays.length).toBeGreaterThan(style(before.document, input.areaId).overlays.length)
    expect(retained.document.title).toBe(before.document.title)
    expect((await backup(other, info, 'external-after-conflict')).hashes).toEqual(external.hashes)
    await recovery.getByRole('button', { name: '另存副本', exact: true }).click(); await keyboardWorkspaceSaved(target.page)
    const copy = await backup(target.page, info, 'candidate-saved-separately')
    expect(copy.document.sceneId).not.toBe(external.document.sceneId)
    expect(copy.document.terrainAreas).toEqual(retained.document.terrainAreas)
    await cold(other, external.document.sceneId); expect((await backup(other, info, 'external-cold')).hashes).toEqual(external.hashes)
    await cold(target.page, copy.document.sceneId); expect((await backup(target.page, info, 'candidate-copy-cold')).hashes).toEqual(copy.hashes)
  } finally { await target.context.close() }
})

test('a newly seeded ordinary forest generation saves real managed ground and permits one reviewed rock patch with undo and cold player pixels', async ({ page }, info) => {
  test.setTimeout(300_000)
  // Written before invoking the generator. This seed/layout is never selected
  // by looking for an attractive or unusually easy generated result.
  await writeFile(info.outputPath('generation-request-before-run.json'), JSON.stringify(generatedInput, null, 2))
  await createKeyboardProject(page, '正式森林生成来源的原工程')
  await openGenerationTask(page, '森林与营地')
  const panel = page.getByRole('region', { name: '森林与营地生成', exact: true })
  for (const [label, value] of [
    ['森林工程名称', generatedInput.title], ['森林生成种子', generatedInput.seed], ['森林地图宽米', String(generatedInput.widthMm / 1000)], ['森林地图高米', String(generatedInput.heightMm / 1000)],
    ['空地1横向位置米', String(generatedInput.clearing.x / 1000)], ['空地1纵向位置米', String(generatedInput.clearing.y / 1000)],
    ['空地1宽米', String(generatedInput.clearing.width / 1000)], ['空地1高米', String(generatedInput.clearing.height / 1000)],
    ['森林路线净宽米', String(generatedInput.routeWidthMm / 1000)], ['森林树木覆盖百分比', String(generatedInput.coveragePercent.trees)],
    ['森林灌木覆盖百分比', String(generatedInput.coveragePercent.shrubs)], ['森林草簇覆盖百分比', String(generatedInput.coveragePercent.grass)],
  ]) await panel.getByLabel(label, { exact: true }).fill(value)
  await panel.getByLabel('森林入口方向', { exact: true }).selectOption(generatedInput.entranceSide)
  const invalidInputs = await panel.locator('input[type="number"]').evaluateAll(inputs => inputs.flatMap(node => {
    const input = node as HTMLInputElement
    return input.validity.valid ? [] : [{ label: input.getAttribute('aria-label'), value: input.value, step: input.step, reason: input.validationMessage }]
  }))
  expect(invalidInputs, 'The frozen generation request must fit the normal UI numeric contract before submitting').toEqual([])
  await panel.getByRole('button', { name: '预览森林与营地', exact: true }).click()
  const generated = page.getByTestId('workspace-inspector').getByLabel('森林与营地候选摘要', { exact: true })
  await expect(generated).toBeVisible({ timeout: 60_000 })
  await generated.getByRole('button', { name: '保存为新工程', exact: true }).click()
  await expect(generated).toHaveCount(0); await keyboardWorkspaceSaved(page)
  await page.getByRole('button', { name: '回到首页', exact: true }).click()
  await page.reload()
  await page.getByTestId('workspace-home').locator('.home-project-row').filter({ hasText: generatedInput.title }).getByRole('button', { name: '打开', exact: true }).click()
  await keyboardWorkspaceSaved(page)
  const before = await backup(page, info, 'frozen-generated-forest')
  expect(JSON.stringify(before.document.generation)).toContain(generatedInput.seed)
  const ground = Object.values(before.document.terrainAreas).sort((a, b) => a.coveragePriority - b.coveragePriority)[0]
  expect(ground).toBeTruthy(); expect(ground.editLocked).toBe(false); expect(ground.surfaceStyle).toBeTruthy()
  expect(Object.keys(before.document.paths).length).toBeGreaterThan(0)
  const rock = Object.values(before.document.materials).find(row => row.applicableSurfaces.includes('terrain') && /岩/.test(row.name))!
  expect(rock).toBeTruthy()
  await writeFile(info.outputPath('frozen-generated-forest.json'), JSON.stringify({ request: generatedInput, hashes: before.hashes, sceneId: before.document.sceneId,
    groundId: ground.id, layerId: before.document.entityLayers[ground.id], materialId: rock.id, generation: before.document.generation }, null, 2))
  const beforePng = await png(page, 'player', info, 'generated-before-player')
  const tools = await details(page, { areaId: ground.id, pathId: '', paintId: rock.id }, 'natural', generatedInput.patchRegion, 'rockOnGrass')
  await tools.getByLabel('地表细节种子', { exact: true }).fill(generatedInput.patchSeed)
  await submit(page, tools); await adopt(page, '视觉')
  const after = await backup(page, info, 'generated-patch-adopted')
  expect({ ...physical(after.document), generation: undefined }).toEqual({ ...physical(before.document), generation: undefined })
  expect(style(after.document, ground.id).base).toEqual(ground.surfaceStyle!.base)
  expect(style(after.document, ground.id).overlays.slice(0, ground.surfaceStyle!.overlays.length)).toEqual(ground.surfaceStyle!.overlays)
  expect(style(after.document, ground.id).overlays.length).toBeGreaterThan(ground.surfaceStyle!.overlays.length)
  sourceAppend(before, after, ground.id)
  expect((await png(page, 'player', info, 'generated-adopted-player')).hash).not.toBe(beforePng.hash)
  await page.getByRole('button', { name: '撤销编辑', exact: true }).click(); await keyboardWorkspaceSaved(page)
  const undone = await backup(page, info, 'generated-patch-undo')
  expect({ ...undone.document, revision: 0, updatedAt: '' }).toEqual({ ...before.document, revision: 0, updatedAt: '' })
  expect(undone.appearance.surfaceSources[ground.id]).toBe(before.appearance.surfaceSources[ground.id])
  await cold(page, before.document.sceneId)
  expect((await backup(page, info, 'generated-patch-cold')).hashes).toEqual(undone.hashes)
  expect((await png(page, 'player', info, 'generated-undo-cold-player')).hash).toBe(beforePng.hash)
})
