import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { unzipSync } from 'fflate'
import type { SceneDocument, PointMm } from '../src/shared/model/scene'
import { pathPolygon, polygonDistance, propFootprint, roomPoints } from '../src/shared/geometry/geometry'
import { wallEnvelopePolygons } from '../src/shared/geometry/doorway-clearance'
import { propPaintPolygon, propPresentation } from '../src/shared/appearance/presentation'
import { keyboardProjectBackup, keyboardResourceHashes, keyboardWorkspaceSaved } from './keyboard-ux-helpers'
import { openTerrainTask, openWorkspaceModule } from './workspace-navigation-helpers'
import { mapExportButton, openDetailsBySummary } from './workspace-ux-helpers'

const root = 'work/general-provenance'
const artifactPath = process.env.SCENEWEAVE_DETAIL_ARTIFACT ?? 'work/detail-acceptance-20261110/final-artifact.json'
const { PNG } = createRequire(import.meta.url)('../node_modules/playwright-core/lib/utilsBundle.js')
type Backup = Awaited<ReturnType<typeof keyboardProjectBackup>>
type Mode = 'natural' | 'shoulder' | 'camp'
type StaticStep = { key: string; mode: Mode; areaId: string; materialId: string; region?: PointMm[]; pathIds?: string[]; supportIds?: string[]; profile?: 'grassOnRock' | 'rockOnGrass' }
type Community = { areaId: string; layerId: string; seed: string; clearing: PointMm[]; avoid: { kind: 'path' | 'room'; id: string }[] }
type Journey = { key: string; source: string; staticSteps: StaticStep[]; community?: Omit<Community, 'areaId' | 'layerId'> }
const rect = (x: number, y: number, w: number, h: number): PointMm[] => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }]
const pointsText = (points: PointMm[]) => points.map(point => `${point.x}, ${point.y}`).join('\n')
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const review = (page: Page) => page.getByRole('region', { name: '候选审阅', exact: true })
const palettes = [{ key: 'mainTrees', channel: '主树群', name: '裂叶阔冠栎', cellM: '6.5' }, { key: 'secondaryTrees', channel: '次树与林缘', name: '窄冠碎叶桦', cellM: '7' },
  { key: 'shrubs', channel: '灌木与蕨', name: '缺口低灌丛', cellM: '5' }, { key: 'grass', channel: '草簇', name: '弯叶疏草簇', cellM: '4.5' }]
const forestArea = 'forest-26e0c4728c70337ec9d4252b13df6013', forestPath = 'forest-86ae1351896c404bca4d578c5d15f8b7'
const manualArea = 'terrain-8825c7ea-fdb4-4986-8127-70b13ca4d0e0', manualPath = 'path-85060f2b-cc3a-483d-9422-2cd5e019503d'
const journeys: Journey[] = [
  { key: 'generated-forest', source: 'work/detail-acceptance-20261110/general/generated-ui-step-recheck-results/detail-general-acceptance--2681e-undo-and-cold-player-pixels-chromium/frozen-generated-forest.sceneweave', staticSteps: [
    { key: 'shoulder', mode: 'shoulder', areaId: forestArea, materialId: 'shore-v1-material-sand-dry', pathIds: [forestPath], supportIds: [forestArea] },
    { key: 'camp', mode: 'camp', areaId: forestArea, materialId: 'shore-v1-material-rock-dry', region: rect(15000, 12000, 6000, 3000) },
  ], community: { seed: 'provenance-generated-community-1', clearing: rect(14000, 11000, 9000, 5500), avoid: [{ kind: 'path', id: forestPath }] } },
  { key: 'manual-import', source: 'work/detail-acceptance-20261110/general/fix-candidate-final-two-results/detail-general-acceptance--92cd6--regeneration-and-cold-save-chromium/frozen-manual-community.sceneweave', staticSteps: [
    { key: 'grass', mode: 'natural', areaId: manualArea, materialId: 'b3-m-01', region: rect(31000, 7000, 6000, 3500), profile: 'grassOnRock' },
    { key: 'shoulder', mode: 'shoulder', areaId: manualArea, materialId: 'b3-m-04', pathIds: [manualPath], supportIds: [manualArea] },
    { key: 'camp', mode: 'camp', areaId: manualArea, materialId: 'b3-m-02', region: rect(9000, 9000, 7000, 4000) },
  ], community: { seed: 'provenance-manual-community-1', clearing: rect(16000, 13000, 5000, 3500), avoid: [{ kind: 'path', id: manualPath }] } },
  { key: 'sample-outpost', source: 'work/detail-acceptance-20261110/visual/chromium/outpost/normal-source.sceneweave', staticSteps: [
    { key: 'grass', mode: 'natural', areaId: 'sample-ground', materialId: 'theme-pack-wilderness-material-hill-rock-v2', region: rect(1000, 1000, 4000, 3500), profile: 'rockOnGrass' },
    { key: 'shoulder', mode: 'shoulder', areaId: 'sample-ground', materialId: 'theme-pack-wilderness-material-river-gravel-v2', pathIds: ['theme-sample-path-2'], supportIds: ['sample-ground'] },
    { key: 'camp', mode: 'camp', areaId: 'sample-camp', materialId: 'theme-pack-wilderness-material-river-gravel-v2', region: rect(20000, 16000, 3500, 3000) },
  ], community: { seed: 'provenance-outpost-community-1', clearing: rect(19000, 15500, 7000, 5000),
    // The request explicitly protects the door branch and the two buildings.
    // It does not claim to provide canopy clearance for unselected roads.
    avoid: [{ kind: 'path', id: 'theme-sample-path-2' }, { kind: 'room', id: 'watch-record-room' }, { kind: 'room', id: 'watch-rest-room' }] } },
  { key: 'sample-island', source: 'work/detail-acceptance-20261110/visual/chromium/island/normal-source.sceneweave', staticSteps: [
    { key: 'grass', mode: 'natural', areaId: 'q1-high', materialId: 'refined-material-island-material-moss', region: rect(12000, 8000, 1800, 1200), profile: 'grassOnRock' },
  ] },
]
const paint = { tileWidthM: '2.41', tileHeightM: '1.63', originXM: '-.319', originYM: '.857', rotationDeg: '29', opacity: '.82', blendM: '.1', shoulderM: '.25', variationM: '0' }
const communityParameters = { palettes, density: '.4', minSpacingM: '.4', clearanceM: '.15' }
const runtimeErrors = new WeakMap<Page, string[]>()
test.use({ actionTimeout: 15_000 })
test.beforeEach(async ({ page }) => { const errors: string[] = []; runtimeErrors.set(page, errors); page.on('pageerror', error => errors.push(error.message)) })
test.afterEach(async ({ page }) => { expect(runtimeErrors.get(page) ?? [], 'Normal UI source journeys must not emit uncaught page errors').toEqual([]) })
test.beforeAll(async () => {
  await mkdir(root, { recursive: true })
  const spec = await readFile('tests/detail-provenance-acceptance.spec.ts'), hash = sha(spec), artifact = JSON.parse(await readFile(artifactPath, 'utf8'))
  const inputs = await Promise.all(journeys.map(async journey => ({ ...journey, inputSha256: sha(await readFile(journey.source)) })))
  const declaration = { status: 'frozen before browser operations; positive steps and explicit refusals reported separately', artifactPath, artifact,
    specSha256: hash, inputs, paint, communityParameters, noSeedSearch: true, permissions: 'ordinary manual tools only; no new AI rights', P3: false }
  await writeFile(`${root}/matrix-${hash}.json`, JSON.stringify(declaration, null, 2), { flag: 'wx' }).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error })
  await writeFile(`${root}/spec-${hash}.ts`, spec, { flag: 'wx' }).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error })
})
async function backup(page: Page, info: TestInfo, name: string) { return keyboardProjectBackup(page, info.outputPath(`${name}.sceneweave`)) }
const normalized = (scene: SceneDocument) => ({ ...scene, revision: 0, updatedAt: '' })
async function number(scope: Locator, label: string, value: string) { const input = scope.getByLabel(label, { exact: true }); await input.fill(value); await input.press('Tab') }
async function cold(page: Page, sceneId: string) {
  await page.reload(); await page.getByRole('button', { name: '回到首页', exact: true }).click()
  await page.getByTestId('workspace-home').locator(`[data-project-key="native:${sceneId}"]`).getByRole('button', { name: '打开', exact: true }).click(); await keyboardWorkspaceSaved(page)
}
async function output(page: Page, info: TestInfo, name: string) {
  const download = page.waitForEvent('download'); await (await mapExportButton(page, 'player')).click(); await (await download).saveAs(info.outputPath(`${name}.png`))
  await keyboardWorkspaceSaved(page); await page.locator('.workspace-export-menu > summary').click()
  const image = PNG.sync.read(await readFile(info.outputPath(`${name}.png`))) as { width: number; height: number; data: Uint8Array }
  return { path: info.outputPath(`${name}.png`), width: image.width, height: image.height, pixelSha256: sha(image.data) }
}
function preservedSources(before: Backup, after: Backup) {
  for (const [id, source] of Object.entries(before.appearance.sources)) expect(after.appearance.sources[id]).toEqual(source)
  for (const [id, source] of Object.entries(before.appearance.propSources)) expect(after.appearance.propSources[id]).toBe(source)
  for (const kind of ['propTokens', 'prefabTokens', 'outdoorTokens', 'terrainTokens', 'decorationTokens', 'surfaceRuleTokens', 'generationTokens', 'regionalTokens', 'aggregateTokens', 'structureTokens', 'presentationTokens'] as const)
    for (const [id, token] of Object.entries(before.identity[kind] ?? {})) expect(after.identity[kind]?.[id]).toEqual(token)
  expect(keyboardResourceHashes(after.hashes)).toEqual(keyboardResourceHashes(before.hashes))
}
function managedPreserved(before: SceneDocument, after: SceneDocument, areaIds: string[]) {
  const a = structuredClone(before.generation), b = structuredClone(after.generation)
  if (!a || !b) { expect(b).toEqual(a); return }
  const old = a.legacy, current = b.legacy
  const allowedRules = new Set<string>()
  for (const [id, owner] of Object.entries(old.ownership)) if (areaIds.includes(owner.target.entityId)) {
    const next = current.ownership[id]; expect(next).toBeTruthy()
    expect(next.managedFields.filter(field => field !== 'surface')).toEqual(owner.managedFields.filter(field => field !== 'surface'))
    expect(next.manualFields.filter(field => field !== 'surface')).toEqual(owner.manualFields.filter(field => field !== 'surface'))
    expect(['manual', owner.state]).toContain(next.state)
    allowedRules.add(owner.ruleId)
    owner.managedFields = next.managedFields; owner.manualFields = next.manualFields; owner.state = next.state
  }
  for (const id of allowedRules) {
    expect(current.rules[id]).toBeTruthy(); expect(['paused', old.rules[id].state]).toContain(current.rules[id].state)
    old.rules[id].state = current.rules[id].state; old.rules[id].managedOutputHash = current.rules[id].managedOutputHash
  }
  expect(b).toEqual(a)
}
async function history(page: Page, info: TestInfo, before: Backup, after: Backup, key: string) {
  await page.getByRole('button', { name: '撤销编辑', exact: true }).click(); await keyboardWorkspaceSaved(page)
  const undo = await backup(page, info, `${key}-undo`); expect(normalized(undo.document)).toEqual(normalized(before.document))
  expect(undo.appearance.surfaceSources).toEqual(before.appearance.surfaceSources)
  await page.getByRole('button', { name: '重做编辑', exact: true }).click(); await keyboardWorkspaceSaved(page)
  const redo = await backup(page, info, `${key}-redo`); expect(normalized(redo.document)).toEqual(normalized(after.document))
  await cold(page, after.document.sceneId)
  expect((await backup(page, info, `${key}-cold`)).hashes).toEqual(redo.hashes)
}
async function importExact(page: Page, info: TestInfo, journey: Journey) {
  const bytes = await readFile(journey.source), filename = info.outputPath('frozen-input.sceneweave'); await writeFile(filename, bytes)
  await writeFile(info.outputPath('frozen-input.json'), JSON.stringify({ journey, sourceSha256: sha(bytes), frozenCopySha256: sha(await readFile(filename)), paint, communityParameters }, null, 2))
  await page.goto('./#home'); const choosing = page.waitForEvent('filechooser')
  await page.getByTestId('workspace-home').getByRole('button', { name: '打开工程文件', exact: true }).click(); await (await choosing).setFiles(filename); await keyboardWorkspaceSaved(page)
  const current = await backup(page, info, 'imported')
  const files = unzipSync(new Uint8Array(bytes)), expected = JSON.parse(new TextDecoder().decode(files['scene.json'])) as SceneDocument
  // Ordinary import creates a fresh project copy. The complete content,
  // generation provenance, immutable source graph and birth tables stay exact.
  expect(current.document.sceneId).not.toBe(expected.sceneId); expect(current.document.revision).toBe(0)
  expect(current.document).toEqual({ ...expected, sceneId: current.document.sceneId, revision: 0, createdAt: current.document.createdAt, updatedAt: current.document.updatedAt })
  expect(current.identity).toEqual(JSON.parse(new TextDecoder().decode(files['identity.json'])))
  expect(current.appearance).toEqual(JSON.parse(new TextDecoder().decode(files['appearance.json'])))
  const hashes = Object.fromEntries(Object.entries(files).map(([path, data]) => [path, sha(data)]))
  expect(keyboardResourceHashes(current.hashes)).toEqual(keyboardResourceHashes(hashes))
  await writeFile(info.outputPath('import-facts.json'), JSON.stringify({ sourceSceneId: expected.sceneId, importedSceneId: current.document.sceneId,
    sourceRevision: expected.revision, importedRevision: current.document.revision, onlyCopyMetadataChanged: true,
    identityPreserved: true, appearancePreserved: true, sourceResourceHashes: keyboardResourceHashes(hashes) }, null, 2))
  return current
}
async function selectLayer(page: Page, project: Backup, layerId: string) {
  const scene = await openWorkspaceModule(page, '场景'), layer = project.document.userLayers[layerId]
  await scene.getByRole('button', { name: `查看图层 ${layer.name}`, exact: true }).click()
  const button = scene.getByRole('button', { name: `设为绘制图层 ${layer.name}`, exact: true })
  if (await button.isEnabled()) await button.click()
  await expect(button).toHaveAttribute('aria-pressed', 'true')
}
async function palette(page: Page, info: TestInfo, before: Backup) {
  if (palettes.every(row => Object.values(before.document.propDefinitions).some(definition => definition.name === row.name))) return before
  await openWorkspaceModule(page, '素材'); const catalogue = page.getByRole('region', { name: '主题素材包', exact: true })
  await openDetailsBySummary(catalogue, /^主题素材包 · 场景与画风$/); await openDetailsBySummary(catalogue, /^植被细节 · 六件独立变体$/)
  await catalogue.getByRole('button', { name: '预览添加六件植被细节变体', exact: true }).click()
  await expect(review(page)).toContainText('弯叶疏草簇', { timeout: 90_000 })
  for (const box of await review(page).getByRole('checkbox', { name: /^复核并保留素材 / }).all()) await box.check()
  await review(page).getByRole('button', { name: '采用组件修改', exact: true }).click(); await keyboardWorkspaceSaved(page)
  const after = await backup(page, info, 'palette-adopted')
  for (const [id, value] of Object.entries(before.document.props)) expect(after.document.props[id]).toEqual(value)
  for (const [id, value] of Object.entries(before.document.propDefinitions)) expect(after.document.propDefinitions[id]).toEqual(value)
  for (const [id, value] of Object.entries(before.appearance.sources)) expect(after.appearance.sources[id]).toEqual(value)
  for (const [path, hash] of Object.entries(keyboardResourceHashes(before.hashes))) if (path !== 'sources.json') expect(after.hashes[path]).toBe(hash)
  const oldFiles = unzipSync(new Uint8Array(await readFile(info.outputPath('imported.sceneweave')))), newFiles = unzipSync(new Uint8Array(await readFile(info.outputPath('palette-adopted.sceneweave'))))
  const oldIndex = JSON.parse(new TextDecoder().decode(oldFiles['sources.json'])) as Record<string, unknown>, newIndex = JSON.parse(new TextDecoder().decode(newFiles['sources.json'])) as Record<string, unknown>
  for (const [id, value] of Object.entries(oldIndex)) expect(newIndex[id]).toEqual(value)
  return after
}
async function staticTools(page: Page, step: StaticStep) {
  const resources = await openWorkspaceModule(page, '氛围')
  await resources.getByRole('navigation', { name: '视觉工具', exact: true }).getByRole('button', { name: '铺装', exact: true }).click()
  await openDetailsBySummary(page.getByTestId('workspace-inspector'), /^自然地表细节 · 草岩、路肩与营地$/)
  const tools = page.getByRole('region', { name: '自然地表细节', exact: true })
  await tools.getByLabel('地表细节用途', { exact: true }).selectOption(step.mode); await tools.getByLabel('细节目标地形', { exact: true }).selectOption(step.areaId)
  await tools.getByLabel('细节覆盖材质', { exact: true }).selectOption(step.materialId)
  if (step.mode === 'shoulder') {
    await tools.getByLabel('细节道路', { exact: true }).selectOption(step.pathIds!); await tools.getByLabel('路肩地形支撑', { exact: true }).selectOption(step.supportIds!)
    await number(tools, '自然路肩宽度', paint.shoulderM)
  } else {
    await openDetailsBySummary(tools, /^精确坐标 · 细节覆盖范围$/); await tools.getByLabel('细节覆盖范围坐标', { exact: true }).fill(pointsText(step.region!))
    if (step.mode === 'natural') await tools.getByLabel('草岩细节风格', { exact: true }).selectOption(step.profile!)
  }
  await number(tools, '细节边缘羽化', paint.blendM)
  if (step.mode !== 'camp') { await number(tools, '细节轮廓起伏', paint.variationM); await tools.getByLabel('地表细节种子', { exact: true }).fill(`provenance-${step.key}-static-1`) }
  await openDetailsBySummary(tools, /^世界材质尺度与相位$/)
  for (const [label, value] of [['细节纹理宽', paint.tileWidthM], ['细节纹理高', paint.tileHeightM], ['细节世界原点X', paint.originXM], ['细节世界原点Y', paint.originYM]]) await number(tools, label, value)
  await tools.getByLabel('细节纹理方向', { exact: true }).fill(paint.rotationDeg); await tools.getByLabel('细节覆盖透明度', { exact: true }).fill(paint.opacity)
  return tools
}
async function submit(page: Page, info: TestInfo, before: Backup, tools: Locator, button: string, key: string) {
  // The complex sample's synchronous rehearsal completed after the original
  // 15 s click deadline. Preserve that failure; this is a bounded functional
  // wait, not a performance claim or a change to the request/algorithm budget.
  await tools.getByRole('button', { name: button, exact: true }).click({ timeout: 60_000 })
  await expect.poll(async () => await review(page).isVisible() ? 'candidate' : await tools.getByRole('alert').count() ? 'refusal' : 'waiting', { timeout: 30_000 }).not.toBe('waiting')
  if (!await review(page).isVisible()) {
    const reason = await tools.getByRole('alert').allTextContents(), refused = await backup(page, info, `${key}-refused`)
    expect(refused.hashes).toEqual(before.hashes)
    await writeFile(info.outputPath(`${key}-explicit-refusal.json`), JSON.stringify({ reason, savedProjectUnchanged: true, beforeHashes: before.hashes, afterHashes: refused.hashes,
      contract: 'docs/04-scene-document.md ordinary surface/community contracts: exact integer clipping, no holes, complete support, locks and compact budget; no input alteration or partial adoption' }, null, 2))
    throw new Error(`Explicit planner refusal; frozen input unchanged: ${reason.join('；')}`)
  }
}
async function adopt(page: Page, kind: '视觉' | '室外') {
  await review(page).getByLabel('确认完整影响范围', { exact: true }).check(); await review(page).getByRole('button', { name: `采用${kind}修改`, exact: true }).click()
  await expect(review(page)).toHaveCount(0); await keyboardWorkspaceSaved(page)
}
async function staticStep(page: Page, info: TestInfo, before: Backup, step: StaticStep, previous: Awaited<ReturnType<typeof output>>) {
  const tools = await staticTools(page, step); await submit(page, info, before, tools, '预览自然地表细节', step.key); await adopt(page, '视觉')
  const after = await backup(page, info, `${step.key}-adopted`), allowed = step.supportIds ?? [step.areaId]
  const a = structuredClone(before.document), b = structuredClone(after.document)
  for (const id of allowed) {
    const old = a.terrainAreas[id].surfaceStyle!, current = b.terrainAreas[id].surfaceStyle!
    expect(current.base).toEqual(old.base); expect(current.overlays.slice(0, old.overlays.length)).toEqual(old.overlays)
    expect(current.overlays.length).toBeGreaterThan(old.overlays.length)
    for (const overlay of current.overlays.slice(old.overlays.length)) expect(after.identity.presentationTokens?.[overlay.id]?.kind).toBe('surfaceOverlay')
    expect(after.appearance.sources[after.appearance.surfaceSources[id]].parentSourceId).toBe(before.appearance.surfaceSources[id])
    a.terrainAreas[id].surfaceStyle = null; b.terrainAreas[id].surfaceStyle = null
  }
  managedPreserved(before.document, after.document, allowed); b.generation = a.generation
  expect(normalized(b)).toEqual(normalized(a)); preservedSources(before, after)
  const currentPng = await output(page, info, `${step.key}-player`); expect(currentPng.pixelSha256).not.toBe(previous.pixelSha256)
  await history(page, info, before, after, step.key)
  await writeFile(info.outputPath(`${step.key}-facts.json`), JSON.stringify({ status: 'adopted, outside records/old managed records and fixed ancestors preserved; one undo/redo/cold and actual player pixels checked', step, beforeHashes: before.hashes, afterHashes: after.hashes, output: currentPng }, null, 2))
  return { project: await backup(page, info, `${step.key}-current`), png: currentPng }
}
async function communityStep(page: Page, info: TestInfo, before: Backup, request: Community, previous: Awaited<ReturnType<typeof output>>) {
  await selectLayer(page, before, request.layerId); await openTerrainTask(page, '布置植被')
  await openDetailsBySummary(page.getByTestId('workspace-inspector'), /^植被群落编排 · 主树、林缘与草灌$/)
  const tools = page.getByRole('region', { name: '植被群落编排', exact: true })
  await tools.getByLabel('群落适植地形', { exact: true }).selectOption(request.areaId)
  for (const row of palettes) {
    const definition = Object.values(before.document.propDefinitions).find(item => item.name === row.name)!; expect(definition).toBeTruthy()
    await tools.getByLabel(`启用${row.channel}`, { exact: true }).check(); await tools.getByLabel(`${row.channel}素材`, { exact: true }).selectOption(definition.id)
    await number(tools, `${row.channel}采样间隔`, row.cellM)
  }
  await tools.getByLabel('群落密度倍率', { exact: true }).fill(communityParameters.density); await tools.getByLabel('群落编排种子', { exact: true }).fill(request.seed)
  await number(tools, '群落最小间距', communityParameters.minSpacingM); await number(tools, '群落避让余量', communityParameters.clearanceM)
  await tools.getByLabel('群落明确避让', { exact: true }).selectOption(request.avoid.map(row => JSON.stringify(row)))
  await openDetailsBySummary(tools, /^精确坐标 · 活动空地/); await tools.getByLabel('群落活动空地坐标', { exact: true }).fill(pointsText(request.clearing))
  await submit(page, info, before, tools, '预览植被群落编排', 'community'); await openDetailsBySummary(review(page), /^核对实际变化 ·/)
  const heading = review(page).locator('strong').first(), caption = await heading.innerText()
  const counts = Object.fromEntries(palettes.map(row => {
    const match = caption.match(new RegExp(`${row.channel}[：:]\\s*(\\d+)\\s*件`))
    expect(match, `The normal review must disclose the actual ${row.channel} count, including zero`).toBeTruthy()
    const count = Number(match![1])
    if (count === 0) expect(caption).toContain(`${row.channel}：0 件（本次未生成）`)
    return [row.key, count]
  }))
  const countSum = Object.values(counts).reduce((sum, count) => sum + count, 0)
  expect(caption).toContain(`本次新增 ${countSum} 件 · 4 组`)
  const reviewed = (await review(page).locator('.composition-diff-item > strong').allTextContents()).filter(value => value.startsWith('新增物件 ·')).length
  expect(reviewed).toBe(countSum)
  let narrow: unknown = null
  if (info.title.includes('generated-forest')) {
    const desktop = page.viewportSize()!
    await page.setViewportSize({ width: 390, height: 844 })
    if (!await heading.isVisible()) await page.locator('.workspace-layout-actions').getByRole('button', { name: '当前详情', exact: true }).click()
    await heading.scrollIntoViewIfNeeded(); await expect(heading).toBeVisible(); expect(await heading.innerText()).toBe(caption)
    const geometry = await heading.evaluate(node => {
      const range = document.createRange(); range.selectNodeContents(node)
      return { viewport: innerWidth, body: document.documentElement.scrollWidth, lines: [...range.getClientRects()].map(box => ({ left: box.left, right: box.right })) }
    })
    expect(geometry.body).toBeLessThanOrEqual(geometry.viewport)
    for (const line of geometry.lines) { expect(line.left).toBeGreaterThanOrEqual(0); expect(line.right).toBeLessThanOrEqual(geometry.viewport) }
    await page.screenshot({ path: info.outputPath('community-review-390.png') }); narrow = geometry
    await page.setViewportSize(desktop); expect(await heading.innerText()).toBe(caption)
  }
  await adopt(page, '室外'); const after = await backup(page, info, 'community-adopted')
  const groups = Object.values(after.document.scatterGroups).filter(group => !before.document.scatterGroups[group.id]), props = Object.values(after.document.props).filter(prop => !before.document.props[prop.id])
  expect(groups).toHaveLength(4); expect(props).toHaveLength(reviewed); expect(props.length).toBeGreaterThan(0)
  const memberIds: string[] = []
  for (const row of palettes) {
    const definition = Object.values(before.document.propDefinitions).find(item => item.name === row.name)!, group = groups.find(item => item.palette[0]?.propDefinitionRef.id === definition.id)!
    expect(group).toBeTruthy(); expect(group.algorithmVersion).toBe('scatter-cell-v2')
    expect(group.palette).toEqual([{ key: definition.id, propDefinitionRef: { id: definition.id, version: definition.version }, weight: 1 }])
    expect(group.seed).toBe(sha(new TextEncoder().encode(JSON.stringify([request.seed, row.key]))))
    expect(group.cellSizeMm).toBe(Number(row.cellM) * 1000); expect(group.densityFactor).toBe(Number(communityParameters.density))
    expect(group.minDistanceMm).toBe(Number(communityParameters.minSpacingM) * 1000); expect(group.gridOriginMm).toEqual({ x: 0, y: 0 })
    expect(group.domain).toEqual({ kind: 'area', areaId: request.areaId }); expect(group.floorId).toBe(before.document.terrainAreas[request.areaId].floorId)
    expect(group.visibility).toBe('public'); expect(after.document.entityLayers[group.id]).toBe(request.layerId)
    expect(group.exclusions).toHaveLength(4 + 1 + request.avoid.length)
    expect(Object.keys(group.members)).toHaveLength(counts[row.key])
    for (const member of Object.values(group.members)) {
      expect(member.state).toBe('managed'); expect(member.propId).toBeTruthy(); memberIds.push(member.propId!)
      const prop = after.document.props[member.propId!]
      expect(prop.supportRef).toEqual({ kind: 'terrainArea', id: request.areaId }); expect(prop.definitionRef).toEqual(group.palette[0].propDefinitionRef)
      expect(prop.floorId).toBe(group.floorId); expect(after.document.entityLayers[prop.id]).toBe(request.layerId)
    }
  }
  expect(memberIds.sort()).toEqual(props.map(prop => prop.id).sort())
  const protectedPolygons = [request.clearing, ...request.avoid.map(ref => ref.kind === 'path' ? pathPolygon(before.document.paths[ref.id]) : roomPoints(before.document, before.document.rooms[ref.id]))]
  const selectedWalls = new Set(request.avoid.filter(ref => ref.kind === 'room').flatMap(ref => {
    const room = before.document.rooms[ref.id]
    return Object.values(before.document.walls).filter(wall => room.boundaryVertexIds.some((id, index, ids) =>
      id === wall.startVertexId && ids[(index + 1) % ids.length] === wall.endVertexId || id === wall.endVertexId && ids[(index + 1) % ids.length] === wall.startVertexId)).map(wall => wall.id)
  }))
  protectedPolygons.push(...wallEnvelopePolygons(before.document).filter(shape => shape.entityId.split('、').some(id => selectedWalls.has(id))).map(shape => shape.polygon))
  const clearance = Number(communityParameters.clearanceM) * 1000
  for (const prop of props) for (const boundary of protectedPolygons) {
    expect(polygonDistance(propFootprint(prop), boundary)).toBeGreaterThanOrEqual(clearance)
    expect(polygonDistance(propPaintPolygon(prop, propPresentation(after.appearance, prop.id)), boundary)).toBeGreaterThanOrEqual(clearance)
  }
  const a = structuredClone(after.document)
  for (const value of [...groups, ...props]) { delete a.entityLayers[value.id]; if (a.props[value.id]) delete a.props[value.id]; else delete a.scatterGroups[value.id] }
  expect(normalized(a)).toEqual(normalized(before.document)); preservedSources(before, after)
  const currentPng = await output(page, info, 'community-player'); expect(currentPng.pixelSha256).not.toBe(previous.pixelSha256)
  await history(page, info, before, after, 'community')
  await writeFile(info.outputPath('community-facts.json'), JSON.stringify({ request, candidateCaption: caption, disclosedCounts: counts, disclosedSum: countSum, narrow,
    actualNewGroups: groups, actualNewProps: props.length, existingGroupsKept: Object.keys(before.document.scatterGroups), existingPropsKept: Object.keys(before.document.props), output: currentPng, oldSourceHashes: before.hashes, adoptedHashes: after.hashes }, null, 2))
}

for (const journey of journeys) test(`provenance ${journey.key}: ordinary planners append to the exact frozen source with per-adoption history, cold read and pixels`, async ({ page }, info) => {
  test.setTimeout(600_000)
  let project = await importExact(page, info, journey)
  if (journey.community) project = await palette(page, info, project)
  let currentPng = await output(page, info, 'baseline-player')
  for (const step of journey.staticSteps) { const result = await staticStep(page, info, project, step, currentPng); project = result.project; currentPng = result.png }
  if (journey.community) {
    const areaId = journey.staticSteps[0].areaId, layerId = Object.values(project.document.userLayers).find(layer => /家具与植被|主题物件/.test(layer.name))?.id ?? project.document.entityLayers[areaId]
    await communityStep(page, info, project, { ...journey.community, areaId, layerId }, currentPng)
  }
})
