/** Formal technical evidence from normal production UI and actual delivered files. */
import { expect, test, type Browser, type BrowserContext, type Page, type TestInfo } from '@playwright/test'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { unzipSync, strFromU8 } from 'fflate'
import { openKeyboardPanel } from './keyboard-ux-helpers'
import { mapExportButton, projectBackupButton } from './workspace-ux-helpers'
import type { SceneDocument, BoundsMm } from '../src/shared/model/scene'
import { visualBase } from '../src/shared/visual/base'
import { detachChangedOutputs } from '../src/shared/terrain-generation/integrity'
import { pauseChangedCompositions } from '../src/shared/terrain-generation/composition-lifecycle'
import { getLegacyGeneration } from '../src/shared/terrain-generation/composition-contracts'
import { projectScene } from '../src/shared/projection/projection'
import { terrainVariantV2DefinitionId } from '../src/shared/visual/terrain-variant-v2-specs'
import { FormalVisualProgress } from '../tools/testing/formal-visual-progress'

interface PackageInput { file: string; sha256: string }
interface FixtureCase {
  name: string; kind: 'interior' | 'island' | 'coast' | 'mixed' | 'current-island'
  variants: Record<'art' | 'artNeutral' | 'effect' | 'neutral' | 'privatePair', PackageInput>
  controls: { editablePropId: string; privatePropId: string; privateMaskId: string; privateNoteId: string;
    structure: { kind: 'wall' | 'connection' | 'visualBoundary'; id: string; beforeMm: number; afterMm: number; segmentIndex?: number; expectedDocument?: SceneDocument } }
  views: (PackageInput & { name: string; boundsMm: BoundsMm; cropBoundsMm: BoundsMm; method: string; targetIds: string[]; framingBasis: string;
    pixelAlignment: { worldPeriodMm: number; pixelsPerPeriod: number; sourceRectPx: number[] };
    provenance: { beforeGenerationSha256: string; afterGenerationSha256: string; method: string } })[]
  summary: { exportBoundsMm: BoundsMm; [key: string]: unknown }
}
const fixtureRoot = resolve(process.env.SCENEWEAVE_FORMAL_VISUAL_FIXTURES ?? 'work/missing-formal-visual-fixtures')
const manifest = JSON.parse(readFileSync(resolve(fixtureRoot, 'formal-visual-fixtures.json'), 'utf8')) as { format: string; version: number; cases: FixtureCase[] }
if (manifest.format !== 'sceneweave-formal-visual-fixtures' || manifest.version !== 1
  || manifest.cases.length !== 5 || new Set(manifest.cases.map(row => row.kind)).size !== 5
  || !manifest.cases.some(row => row.kind === 'current-island')) throw new Error('Expected the four original regression fixtures plus the separate current-island algorithm7 production input.')
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const review = (page: Page) => page.getByRole('region', { name: '候选审阅', exact: true })
const progressByTest = new Map<string, FormalVisualProgress>()
const progressByPage = new WeakMap<Page, FormalVisualProgress>()
function measure<T>(page: Page, name: string, run: () => Promise<T>, summarize?: (result: T) => unknown): Promise<T> {
  const progress = progressByPage.get(page)
  return progress ? progress.measure(name, run, summarize) : run()
}
test.afterEach(async ({}, info) => {
  const progress = progressByTest.get(info.testId)
  if (!progress) return
  try {
    progress.finish(info.status ?? 'interrupted', info.errors)
    await info.attach('formal-visual-progress', { path: info.outputPath('formal-visual-progress.json'), contentType: 'application/json' })
  } catch (error) {
    // Preserve the runner's first failure/timeout if diagnostic persistence or
    // attachment also fails. Successful tests must surface a recorder failure.
    if (info.status === 'passed' && !info.errors.length) throw error
    console.error('Formal visual progress finalization failed; the prior checkpoint and original test error remain:', error)
  } finally { progressByTest.delete(info.testId) }
})
function containsEntityId(value: unknown, id: string): boolean {
  if (value === null || typeof value !== 'object') return false
  if (Array.isArray(value)) return value.some(row => containsEntityId(row, id))
  const row = value as Record<string, unknown>
  return row.id === id || Object.keys(row).includes(id) || Object.values(row).some(child => containsEntityId(child, id))
}

function archive(bytes: Uint8Array) {
  const files = unzipSync(bytes)
  for (const required of ['scene.json', 'identity.json', 'appearance.json', 'manifest.json', 'sources.json']) if (!files[required]) throw new Error(`Complete project missing ${required}.`)
  const json = (name: string) => JSON.parse(strFromU8(files[name]))
  const document = json('scene.json') as SceneDocument
  expect(document.format).toBe('sceneweave-scene'); expect(document.schemaVersion).toBe(1)
  return { document, identity: json('identity.json'), appearance: json('appearance.json'), sources: json('sources.json'),
    hashes: Object.fromEntries(Object.entries(files).map(([name, body]) => [name, digest(body)])), packageSha256: digest(bytes) }
}
type Archive = ReturnType<typeof archive>
function currentVisualConsumption(input: Archive) {
  const recipes = Object.values(getLegacyGeneration(input.document)?.recipes ?? {}).filter(row => row.algorithmId === 'terrain-scene')
  expect(recipes.length).toBeGreaterThan(0)
  for (const recipe of recipes) expect(recipe).toMatchObject({ algorithmVersion: 7, recipeVersion: 7 })
  const projection = projectScene(input.document, 'gm', input.appearance)
  const stairs = projection.connections.filter(row => row.kind === 'stairs')
  expect(stairs.length).toBeGreaterThan(0)
  for (const stair of stairs) {
    expect(stair.route?.stairStyle).toBe('naturalRock')
    expect(stair.route!.centerlineMm.length).toBeGreaterThanOrEqual(2)
    expect(stair.surfaceIds).toHaveLength(2)
  }
  const trees = projection.props.filter(row => row.definitionRef?.id === terrainVariantV2DefinitionId('tree-highland-copse'))
  expect(trees.length).toBeGreaterThan(0)
  const consumed = trees.map(tree => {
    const sourceId = input.appearance.propSources[tree.id], source = input.appearance.sources[sourceId], presentation = input.appearance.presentations[sourceId]
    expect(source).toMatchObject({ kind: 'prop', snapshot: { definitionRef: tree.definitionRef } })
    expect(presentation.mode).toBe('nearSide')
    expect(projection.propPresentations?.[tree.id]?.mode).toBe('nearSide')
    expect(tree.appearance.kind).toBe('image')
    if (tree.appearance.kind !== 'image') throw new Error('Current highland tree has no actual image.')
    const asset = input.document.assets[tree.appearance.assetId]
    expect(asset).toBeDefined(); expect(projection.assetIds).toContain(asset.id)
    expect(input.hashes[`assets/${asset.sha256}.png`]).toBe(asset.sha256)
    expect(asset.licenseRef).toContain('Terrain-Variants-2')
    return { id: tree.id, definitionRef: tree.definitionRef, sourceId, presentation, assetId: asset.id, assetSha256: asset.sha256, licenseRef: asset.licenseRef }
  })
  expect(projection.assetIds.some(id => id.startsWith('shore-v1-'))).toBe(true)
  return { algorithmVersion: 7, rendererBranch: 'drawRoutedConnectionBody/naturalRock',
    recipes: recipes.map(row => ({ id: row.id, algorithmId: row.algorithmId, algorithmVersion: row.algorithmVersion, recipeVersion: row.recipeVersion })),
    stairs: stairs.map(row => ({ id: row.id, route: row.route, surfaceIds: row.surfaceIds, widthMm: row.widthMm })), trees: consumed }
}
const fixedFiles = (value: Archive) => Object.fromEntries(Object.entries(value.hashes).filter(([name]) => !['scene.json', 'manifest.json', 'identity.json'].includes(name)))
const stableFiles = (value: Archive) => Object.fromEntries(Object.entries(value.hashes).filter(([name]) => !['scene.json', 'manifest.json'].includes(name)))
const resourceFiles = (value: Archive) => Object.fromEntries(Object.entries(value.hashes).filter(([name]) => /^(assets\/|sources\/|licenses\/|sources\.json$)/.test(name)))
const withoutRoot = (document: SceneDocument) => {
  const { sceneId: _id, revision: _revision, createdAt: _created, updatedAt: _updated, ...content } = document
  return content
}
function physics(document: SceneDocument) {
  // Include physical/public/privacy fields, organization and fixed definitions; omit only visual atmosphere and generation bookkeeping.
  const keys = ['exportBoundsMm', 'floors', 'vertices', 'rooms', 'walls', 'openings', 'props', 'regions', 'notes', 'terrainAreas', 'terrainEdges',
    'terrainConnections', 'paths', 'prefabInstances', 'scatterGroups', 'decorations', 'decorationClusters', 'surfaceRules', 'userLayers', 'entityLayers',
    'constraints', 'propDefinitions', 'prefabDefinitions', 'materials', 'styleThemes', 'activeStyleThemeRef'] as const
  return Object.fromEntries(keys.map(key => [key, document[key]]))
}
function sampledPhysics(document: SceneDocument) {
  const result = physics(document)
  // The same bound-curve command legitimately allocates fresh IDs for newly sampled points.
  return { ...result, terrainAreas: Object.fromEntries(Object.entries(document.terrainAreas).map(([id, row]) => [id,
    { ...row, boundaryMm: row.boundaryMm.map(point => point.positionMm) }])) }
}
async function saved(page: Page) {
  await expect(page.locator('.asset-save')).toHaveText('本地已保存', { timeout: 120_000 })
  await expect(page.locator('.asset-busy')).toHaveCount(0, { timeout: 120_000 })
  await expect(page.locator('.asset-map-wrap')).toHaveAttribute('aria-busy', 'false', { timeout: 120_000 })
}
async function backup(page: Page, path: string) {
  return measure(page, `backup ${basename(path)}`, () => backupUnchecked(page, path), value => ({ packageSha256: value.packageSha256, revision: value.document.revision }))
}
async function backupUnchecked(page: Page, path: string) {
  const event = page.waitForEvent('download', { timeout: 120_000 })
  await (await projectBackupButton(page)).click()
  await (await event).saveAs(path)
  await expect(page.locator('.asset-busy')).toHaveCount(0, { timeout: 120_000 })
  await page.locator('.workspace-export-menu > summary').click()
  return archive(new Uint8Array(await readFile(path)))
}
async function load(page: Page, input: PackageInput) {
  return measure(page, `import ${input.file}`, () => loadUnchecked(page, input), value => ({ inputSha256: input.sha256, packageSha256: value.packageSha256 }))
}
async function loadUnchecked(page: Page, input: PackageInput) {
  const path = resolve(fixtureRoot, input.file), bytes = new Uint8Array(await readFile(path))
  expect(digest(bytes)).toBe(input.sha256)
  const original = archive(bytes)
  const response = await page.goto('./#home')
  expect(response?.ok()).toBe(true)
  expect(await response!.text()).not.toContain('/@vite/client')
  const chooser = page.waitForEvent('filechooser')
  await page.getByTestId('workspace-home').getByRole('button', { name: '打开工程文件', exact: true }).click()
  await (await chooser).setFiles(path)
  await saved(page)
  await expect(page.getByLabel('材质场景主持人预览', { exact: true })).toBeVisible()
  return original
}
async function reopen(page: Page, sceneId: string) {
  return measure(page, 'cold reopen', () => reopenUnchecked(page, sceneId))
}
async function reopenUnchecked(page: Page, sceneId: string) {
  await page.reload(); await expect(page.locator('.asset-save')).toHaveText('尚未打开工程')
  await page.getByRole('button', { name: '回到首页', exact: true }).click()
  await page.locator(`[data-project-key="native:${sceneId}"]`).getByRole('button', { name: '打开', exact: true }).click()
  await saved(page)
}
async function select(page: Page, id: string, kind: '物件' | '结构') {
  const navigation = await openKeyboardPanel(page, 'navigation')
  await navigation.getByRole('tab', { name: '对象', exact: true }).click()
  await navigation.getByRole('group', { name: '场景对象分类', exact: true }).getByRole('button', { name: kind, exact: true }).click()
  await navigation.getByLabel(`搜索场景${kind}`, { exact: true }).fill(id)
  await navigation.locator(`.asset-virtual-row[data-entity-id="${id}"]`).click()
  return openKeyboardPanel(page, 'inspector')
}
async function adopt(page: Page, kind: 'prop' | 'wall' | 'connection' | 'visualBoundary') {
  if (kind !== 'prop') await review(page).getByLabel('确认完整影响范围', { exact: true }).check()
  await review(page).getByRole('button', { name: kind === 'prop' ? '采用组件修改' : kind === 'wall' ? '采用结构修改' : kind === 'visualBoundary' ? '采用视觉修改' : '采用室外修改', exact: true }).click()
  await expect(review(page)).toHaveCount(0); await saved(page)
}
async function png(page: Page, audience: 'player' | 'gm', path: string, bounds: BoundsMm, crop?: BoundsMm) {
  return measure(page, `PNG ${basename(path)}`, () => pngUnchecked(page, audience, path, bounds, crop), value => value)
}
async function pngUnchecked(page: Page, audience: 'player' | 'gm', path: string, bounds: BoundsMm, crop?: BoundsMm) {
  const download = page.waitForEvent('download', { timeout: 120_000 })
  await (await mapExportButton(page, audience)).click()
  const result = await download
  expect(result.suggestedFilename()).toBe(`sceneweave-${audience}-map.png`)
  await result.saveAs(path)
  await expect(page.locator('.asset-busy')).toHaveCount(0, { timeout: 120_000 })
  await page.locator('.workspace-export-menu > summary').click()
  const bytes = await readFile(path), chunks: string[] = []
  expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
  let offset = 8
  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset), name = bytes.toString('ascii', offset + 4, offset + 8)
    chunks.push(name)
    // Actual user PNG must have no text/profile/exif/project metadata.
    expect(['IHDR', 'PLTE', 'tRNS', 'IDAT', 'IEND', 'sRGB']).toContain(name)
    offset += length + 12
    if (name === 'IEND') break
  }
  expect(offset).toBe(bytes.length)
  const pixels = await measure(page, `decode/hash/crop ${basename(path)}`, () => page.evaluate(async ({ base64, bounds, crop }) => {
    const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(base64), char => char.charCodeAt(0))], { type: 'image/png' }))
    const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height
    const context = canvas.getContext('2d', { willReadFrequently: true })!; context.drawImage(bitmap, 0, 0); bitmap.close()
    const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', rgba))].map(byte => byte.toString(16).padStart(2, '0')).join('')
    let closeup: { width: number; height: number; base64: string; sourceRectPx: number[] } | null = null
    if (crop) {
      const scale = canvas.width / bounds.width
      const exactSourceRectPx = [(crop.x - bounds.x) * scale, (crop.y - bounds.y) * scale, crop.width * scale, crop.height * scale]
      if (exactSourceRectPx.some(value => Math.abs(value - Math.round(value)) > 1e-9)) throw new Error('Frozen world crop is not aligned to native PNG pixels.')
      const sourceRectPx = exactSourceRectPx.map(Math.round)
      const out = document.createElement('canvas'); out.width = sourceRectPx[2]; out.height = sourceRectPx[3]
      // getImageData/putImageData copies exact native pixels; no scaling/interpolation.
      out.getContext('2d')!.putImageData(context.getImageData(sourceRectPx[0], sourceRectPx[1], out.width, out.height), 0, 0)
      closeup = { width: out.width, height: out.height, base64: out.toDataURL('image/png').split(',')[1], sourceRectPx }
    }
    return { width: canvas.width, height: canvas.height, rgbaSha256: hash, closeup }
  }, { base64: bytes.toString('base64'), bounds, crop }))
  const long = Math.max(bounds.width, bounds.height)
  expect(pixels.width).toBe(Math.round(4096 * bounds.width / long)); expect(pixels.height).toBe(Math.round(4096 * bounds.height / long))
  const { closeup, ...facts } = pixels
  if (crop) {
    expect(bounds.width).toBe(16000); expect(bounds.height).toBe(12000)
    expect(closeup?.width).toBe(1024); expect(closeup?.height).toBe(768)
    await writeFile(path.replace(/\.png$/, '-100percent.png'), Buffer.from(closeup!.base64, 'base64'))
  }
  return { ...facts, chunks, byteSha256: digest(bytes), ...(closeup ? { sourceRectPx: closeup.sourceRectPx, cropBoundsMm: crop, cropPixelsPerMetre: 256 } : {}) }
}

async function isolated(browser: Browser, sourcePage: Page, errors: string[], phase: string, run: (page: Page) => Promise<void>) {
  const progress = progressByPage.get(sourcePage)
  progress?.begin(phase)
  const context: BrowserContext = await measure(sourcePage, 'create isolated context', () => browser.newContext({ viewport: { width: 1512, height: 982 }, baseURL: new URL('./', sourcePage.url()).href }))
  let failed = false
  try {
    const page = await measure(sourcePage, 'create isolated page', () => context.newPage()); page.on('pageerror', error => errors.push(error.message))
    if (progress) progressByPage.set(page, progress)
    await run(page)
  } catch (error) { failed = true; progress?.failed(error); throw error }
  finally {
    try {
      if (progress) await progress.cleanup('close isolated context', () => context.close())
      else await context.close()
    } catch (error) { if (!failed) throw error }
  }
}

for (const fixture of manifest.cases) test(`${fixture.kind}: frozen current-v1 production visual, edit, privacy, cold read and native crops`, async ({ page, browser }, info: TestInfo) => {
  const progress = new FormalVisualProgress(info.outputPath('formal-visual-progress.json'), {
    case: fixture.name, kind: fixture.kind, engine: info.project.name, browserVersion: browser.version(),
    testId: info.testId, retry: info.retry, timeoutMs: info.timeout,
    frozenInputs: { variants: fixture.variants, views: fixture.views.map(({ name, file, sha256 }) => ({ name, file, sha256 })) },
  })
  progressByTest.set(info.testId, progress); progressByPage.set(page, progress)
  const errors: string[] = [], developmentRequests: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => { if (/\/(?:@vite|src|tools\/testing)\//.test(new URL(request.url()).pathname)) developmentRequests.push(request.url()) })
  progress.begin('effect baseline and dual audience PNGs')
  const original = await load(page, fixture.variants.effect)
  const baselinePath = info.outputPath('effect-baseline.sceneweave')
  const baseline = await backup(page, baselinePath)
  expect(withoutRoot(baseline.document)).toEqual(withoutRoot(original.document))
  expect(stableFiles(baseline)).toEqual(stableFiles(original))
  expect(baseline.document.revision).toBe(0)
  const gm = await png(page, 'gm', info.outputPath('effect-gm-4k.png'), baseline.document.exportBoundsMm)
  const player = await png(page, 'player', info.outputPath('effect-player-4k.png'), baseline.document.exportBoundsMm)
  await page.screenshot({ path: info.outputPath('effect-workbench.png') })
  progress.complete({ packageSha256: baseline.packageSha256, hashes: baseline.hashes, revision: baseline.document.revision, gm, player })
  progress.begin('baseline cold read')
  await reopen(page, baseline.document.sceneId)
  const cold = await backup(page, info.outputPath('effect-cold.sceneweave'))
  expect(cold.hashes).toEqual(baseline.hashes)
  const coldGm = await png(page, 'gm', info.outputPath('effect-cold-gm-4k.png'), cold.document.exportBoundsMm)
  expect(coldGm).toEqual(gm)
  progress.complete({ packageSha256: cold.packageSha256, allEntryHashesEqual: true, gm: coldGm })

  // Real user Prop edit, a single transaction, then undo/redo and complete archives.
  progress.begin('Prop edit undo redo')
  await select(page, fixture.controls.editablePropId, '物件')
  const prop = baseline.document.props[fixture.controls.editablePropId]
  expect(Object.values(baseline.document.aggregateCoordinates?.groups ?? {}).some(group => group.members.some(member => member.id === prop.id))).toBe(false)
  expect(Object.values(baseline.document.prefabInstances).some(group => Object.values(group.members).some(member => member.propId === prop.id))).toBe(false)
  expect(Object.values(baseline.document.scatterGroups).some(group => Object.values(group.members).some(member => member.propId === prop.id))).toBe(false)
  expect(Object.values(baseline.document.decorationClusters).some(group => Object.values(group.members).some(member => member.kind === 'prop' && member.entityId === prop.id))).toBe(false)
  const propX = page.getByRole('spinbutton', { name: '物件 X', exact: true })
  // Independent Prop commits immediately through the finite command entry.
  // Group-owned Props use a separate preview path, excluded explicitly above.
  await propX.fill(String((prop.positionMm.x + 1) / 1000)); await propX.press('Enter')
  await saved(page); await expect(review(page)).toHaveCount(0)
  const propEdited = await backup(page, info.outputPath('prop-edited.sceneweave'))
  const expectedProp = structuredClone(baseline.document); expectedProp.props[prop.id].positionMm.x++
  expect(physics(propEdited.document)).toEqual(physics(expectedProp)); expect(fixedFiles(propEdited)).toEqual(fixedFiles(baseline))
  expect(propEdited.document.revision).toBe(baseline.document.revision + 1)
  await page.getByRole('button', { name: '撤销编辑', exact: true }).click(); await saved(page)
  const propUndo = await backup(page, info.outputPath('prop-undo.sceneweave'))
  expect(physics(propUndo.document)).toEqual(physics(baseline.document))
  await page.getByRole('button', { name: '重做编辑', exact: true }).click(); await saved(page)
  const propRedo = await backup(page, info.outputPath('prop-redo.sceneweave'))
  expect(physics(propRedo.document)).toEqual(physics(propEdited.document)); expect(propRedo.document.revision).toBe(propEdited.document.revision + 2)
  await png(page, 'gm', info.outputPath('prop-edited-gm-4k.png'), propRedo.document.exportBoundsMm)
  await page.getByRole('button', { name: '撤销编辑', exact: true }).click(); await saved(page)
  progress.complete({ editedPackageSha256: propEdited.packageSha256, undoPackageSha256: propUndo.packageSha256, redoPackageSha256: propRedo.packageSha256 })

  // A real structural/connection geometry change is distinct from the Prop edit.
  progress.begin('structure edit undo redo and cold read')
  const structureBefore = await backup(page, info.outputPath('structure-before.sceneweave'))
  const structure = fixture.controls.structure
  if (structure.kind === 'visualBoundary') {
    const resources = await openKeyboardPanel(page, 'resources')
    await resources.getByRole('tab', { name: '外观', exact: true }).click()
    const panel = page.getByRole('region', { name: '视觉场景创作', exact: true })
    await panel.getByLabel('视觉已有曲线', { exact: true }).selectOption(structure.id)
    await panel.locator('summary').filter({ hasText: /^控制点坐标 · / }).click()
    await panel.locator('.visual-segment').nth(structure.segmentIndex!).getByLabel('视觉控制1y', { exact: true }).fill(String(structure.afterMm))
    await panel.getByRole('button', { name: '预览曲线与边带', exact: true }).click()
  } else {
    await select(page, structure.id, '结构')
    const structureField = page.getByRole('spinbutton', { name: structure.kind === 'wall' ? '编辑墙厚' : '对象通路净宽', exact: true })
    await structureField.fill(String(structure.afterMm / (structure.kind === 'wall' ? 10 : 1000))); await structureField.press('Tab')
    await page.getByRole('button', { name: structure.kind === 'wall' ? '预览墙厚修改' : '预览对象修改', exact: true }).click()
  }
  await expect(review(page)).toBeVisible()
  await page.screenshot({ path: info.outputPath('structure-review.png') })
  await adopt(page, structure.kind)
  const structureEdited = await backup(page, info.outputPath('structure-edited.sceneweave'))
  const expectedStructure = structuredClone(structure.expectedDocument ?? structureBefore.document)
  if (structure.kind === 'wall') expectedStructure.walls[structure.id].thicknessMm = structure.afterMm
  else if (structure.kind === 'connection') expectedStructure.terrainConnections[structure.id].widthMm = structure.afterMm
  if (structure.kind === 'visualBoundary') {
    expect(sampledPhysics(structureEdited.document)).toEqual(sampledPhysics(expectedStructure))
    expect(visualBase(structureEdited.document)!.boundaries).toEqual(visualBase(expectedStructure)!.boundaries)
  } else expect(physics(structureEdited.document)).toEqual(physics(expectedStructure))
  expect(resourceFiles(structureEdited)).toEqual(resourceFiles(structureBefore))
  const structureGm = await png(page, 'gm', info.outputPath('structure-edited-gm-4k.png'), structureEdited.document.exportBoundsMm)
  expect(structureGm.rgbaSha256).not.toBe(gm.rgbaSha256)
  const structurePlayer = await png(page, 'player', info.outputPath('structure-edited-player-4k.png'), structureEdited.document.exportBoundsMm)
  await page.getByRole('button', { name: '撤销编辑', exact: true }).click(); await saved(page)
  const structureUndo = await backup(page, info.outputPath('structure-undo.sceneweave'))
  expect(physics(structureUndo.document)).toEqual(physics(structureBefore.document))
  await page.getByRole('button', { name: '重做编辑', exact: true }).click(); await saved(page)
  const structureRedo = await backup(page, info.outputPath('structure-redo.sceneweave'))
  expect(physics(structureRedo.document)).toEqual(physics(structureEdited.document))
  expect(structureRedo.document.revision).toBe(structureEdited.document.revision + 2)
  expect(await png(page, 'gm', info.outputPath('structure-redo-gm-4k.png'), structureRedo.document.exportBoundsMm)).toEqual(structureGm)
  await reopen(page, structureRedo.document.sceneId)
  const structureCold = await backup(page, info.outputPath('structure-cold.sceneweave'))
  expect(structureCold.hashes).toEqual(structureRedo.hashes)
  expect(await png(page, 'gm', info.outputPath('structure-cold-gm-4k.png'), structureCold.document.exportBoundsMm)).toEqual(structureGm)
  expect(await png(page, 'player', info.outputPath('structure-cold-player-4k.png'), structureCold.document.exportBoundsMm)).toEqual(structurePlayer)
  progress.complete({ structure: { kind: structure.kind, id: structure.id, beforeMm: structure.beforeMm, afterMm: structure.afterMm },
    gm: structureGm, player: structurePlayer, coldPackageSha256: structureCold.packageSha256, allEntryHashesEqual: true })

  const variantFacts: Record<string, unknown> = {}
  for (const variant of ['neutral', 'privatePair'] as const) await isolated(browser, page, errors, `${variant} comparison`, async variantPage => {
    const input = await load(variantPage, fixture.variants[variant])
    const current = await backup(variantPage, info.outputPath(`${variant}.sceneweave`))
    expect(withoutRoot(current.document)).toEqual(withoutRoot(input.document)); expect(stableFiles(current)).toEqual(stableFiles(input))
    expect(fixedFiles(current)).toEqual(fixedFiles(baseline))
    if (variant === 'neutral') expect(physics(current.document)).toEqual(physics(baseline.document))
    else {
      const expected = structuredClone(baseline.document)
      expected.props[fixture.controls.privatePropId].positionMm = input.document.props[fixture.controls.privatePropId].positionMm
      expect(physics(current.document)).toEqual(physics(expected))
      expect(current.document.regions[fixture.controls.privateMaskId]).toEqual(baseline.document.regions[fixture.controls.privateMaskId])
    }
    const variantGm = await png(variantPage, 'gm', info.outputPath(`${variant}-gm-4k.png`), current.document.exportBoundsMm)
    const variantPlayer = await png(variantPage, 'player', info.outputPath(`${variant}-player-4k.png`), current.document.exportBoundsMm)
    if (variant === 'privatePair') {
      expect(variantGm.rgbaSha256).not.toBe(gm.rgbaSha256)
      expect(variantPlayer.rgbaSha256).toBe(player.rgbaSha256); expect(variantPlayer.byteSha256).toBe(player.byteSha256)
    }
    await variantPage.screenshot({ path: info.outputPath(`${variant}-workbench.png`) })
    variantFacts[variant] = { gm: variantGm, player: variantPlayer, packageSha256: current.packageSha256 }
    progress.complete(variantFacts[variant])
  })

  // Actual complete output imported into a genuinely empty IndexedDB context, then cold read.
  await isolated(browser, page, errors, 'empty storage import and cold read', async freshPage => {
    const actualInput = { file: baselinePath, sha256: digest(new Uint8Array(await readFile(baselinePath))) }
    await load(freshPage, actualInput)
    const fresh = await backup(freshPage, info.outputPath('fresh-import.sceneweave'))
    expect(withoutRoot(fresh.document)).toEqual(withoutRoot(baseline.document)); expect(stableFiles(fresh)).toEqual(stableFiles(baseline))
    await reopen(freshPage, fresh.document.sceneId)
    const freshCold = await backup(freshPage, info.outputPath('fresh-import-cold.sceneweave'))
    expect(freshCold.hashes).toEqual(fresh.hashes)
    expect(await png(freshPage, 'gm', info.outputPath('fresh-cold-gm-4k.png'), freshCold.document.exportBoundsMm)).toEqual(gm)
    expect(await png(freshPage, 'player', info.outputPath('fresh-cold-player-4k.png'), freshCold.document.exportBoundsMm)).toEqual(player)
    progress.complete({ importedPackageSha256: fresh.packageSha256, coldPackageSha256: freshCold.packageSha256, allEntryHashesEqual: true, dualAudiencePngsEqual: true })
  })

  let artOriginal: Archive | undefined
  let artFacts: Record<string, unknown> = {}
  await isolated(browser, page, errors, 'ordinary art and cold read', async artPage => {
    const input = await load(artPage, fixture.variants.art)
    const consumption = fixture.kind === 'current-island' ? currentVisualConsumption(input) : undefined
    artOriginal = input
    const current = await backup(artPage, info.outputPath('art.sceneweave'))
    expect(withoutRoot(current.document)).toEqual(withoutRoot(input.document)); expect(stableFiles(current)).toEqual(stableFiles(input))
    expect(resourceFiles(current)).toEqual(resourceFiles(baseline))
    expect(current.document.regions[fixture.controls.privateMaskId]).toBeUndefined()
    expect(current.document.notes[fixture.controls.privateNoteId]).toBeUndefined()
    const artGm = await png(artPage, 'gm', info.outputPath('art-gm-4k.png'), current.document.exportBoundsMm)
    const artPlayer = await png(artPage, 'player', info.outputPath('art-player-4k.png'), current.document.exportBoundsMm)
    await artPage.screenshot({ path: info.outputPath('art-workbench.png') })
    await reopen(artPage, current.document.sceneId)
    const artCold = await backup(artPage, info.outputPath('art-cold.sceneweave'))
    if (consumption) expect(currentVisualConsumption(artCold)).toEqual(consumption)
    expect(artCold.hashes).toEqual(current.hashes)
    expect(await png(artPage, 'gm', info.outputPath('art-cold-gm-4k.png'), artCold.document.exportBoundsMm)).toEqual(artGm)
    expect(await png(artPage, 'player', info.outputPath('art-cold-player-4k.png'), artCold.document.exportBoundsMm)).toEqual(artPlayer)
    artFacts = { ...(consumption ? { currentVisualConsumption: consumption } : {}), inputSha256: fixture.variants.art.sha256, packageSha256: current.packageSha256, hashes: current.hashes,
      gm: artGm, player: artPlayer, coldRead: 'Complete archive and both actual audience PNGs unchanged',
      scope: 'Ordinary original benchmark. Privacy QA mask and sentinel are absent; human art review remains required.' }
    progress.complete(artFacts)
  })
  await isolated(browser, page, errors, 'ordinary art neutral comparison', async artNeutralPage => {
    const input = await load(artNeutralPage, fixture.variants.artNeutral)
    const current = await backup(artNeutralPage, info.outputPath('art-neutral.sceneweave'))
    expect(withoutRoot(current.document)).toEqual(withoutRoot(input.document)); expect(stableFiles(current)).toEqual(stableFiles(input))
    expect(physics(current.document)).toEqual(physics(artOriginal!.document))
    expect(fixedFiles(current)).toEqual(fixedFiles(artOriginal!))
    expect(current.document.regions[fixture.controls.privateMaskId]).toBeUndefined()
    expect(current.document.notes[fixture.controls.privateNoteId]).toBeUndefined()
    const gm = await png(artNeutralPage, 'gm', info.outputPath('art-neutral-gm-4k.png'), current.document.exportBoundsMm)
    const player = await png(artNeutralPage, 'player', info.outputPath('art-neutral-player-4k.png'), current.document.exportBoundsMm)
    await artNeutralPage.screenshot({ path: info.outputPath('art-neutral-workbench.png') })
    artFacts.neutral = { inputSha256: fixture.variants.artNeutral.sha256, packageSha256: current.packageSha256, gm, player,
      scope: 'Ordinary art neutral comparison: lights/fog/filters disabled, ambientOpacity=0 and exposure=1; contact shadows and physical fields preserved. Pixel difference is not required when the art source has no active effects.' }
    progress.complete(artFacts.neutral)
  })
  expect(fixture.views).toHaveLength(4)
  const views: unknown[] = []
  for (const view of fixture.views) await isolated(browser, page, errors, `native crop ${view.name}`, async viewPage => {
    const input = await load(viewPage, view)
    expect(view.targetIds.length).toBeGreaterThan(0)
    expect(view.framingBasis.length).toBeGreaterThan(0)
    for (const id of view.targetIds) expect(containsEntityId(input.document, id), `Fixed crop target ${id} must exist in its actual input`).toBe(true)
    const expected = structuredClone(artOriginal!.document); expected.exportBoundsMm = view.boundsMm
    // A real manual crop can invalidate saved generation receipts. Permit only
    // the exact production lifecycle result, never an ignored generation branch.
    detachChangedOutputs(artOriginal!.document, expected)
    pauseChangedCompositions(artOriginal!.document, expected)
    expect(withoutRoot(input.document)).toEqual(withoutRoot(expected)); expect(stableFiles(input)).toEqual(stableFiles(artOriginal!))
    const result = await png(viewPage, 'gm', info.outputPath(`view-${view.name}.png`), view.boundsMm, view.cropBoundsMm)
    expect(result.sourceRectPx).toEqual(view.pixelAlignment.sourceRectPx)
    views.push({ name: view.name, inputSha256: view.sha256, boundsMm: view.boundsMm, cropBoundsMm: view.cropBoundsMm,
      targetIds: view.targetIds, framingBasis: view.framingBasis, pixelAlignment: view.pixelAlignment, method: view.method, provenance: view.provenance, result })
    progress.complete(views.at(-1))
  })
  progress.begin('final assertions and full facts publication')
  expect(errors).toEqual([]); expect(developmentRequests).toEqual([])
  const facts = { case: fixture.name, kind: fixture.kind, engine: info.project.name, browserVersion: browser.version(),
    frozenInputs: fixture, actualBaseline: { packageSha256: baseline.packageSha256, hashes: baseline.hashes, revision: baseline.document.revision },
    art: artFacts, privacyQa: { gm, player, coldGm, structure, structureGm, structurePlayer,
      structureCold: { packageSha256: structureCold.packageSha256, allEntryHashesEqual: true, dualAudiencePngsEqual: true }, variants: variantFacts }, views, errors, developmentRequests,
    verdict: 'Automated technical assertions passed; art review and user P3 remain separate.',
    excluded: ['Real model generation', 'Six terrain families x five seeds x three region inputs', 'External VTT software import', 'Human six-dimension art approval', 'User P3 signoff'] }
  const factsPath = info.outputPath('formal-visual-facts.json')
  await writeFile(factsPath, JSON.stringify(facts, null, 2)); progress.factsWritten('formal-visual-facts.json')
  await info.attach('formal-visual-facts', { path: factsPath, contentType: 'application/json' })
  progress.complete({ artifact: 'formal-visual-facts.json', errors, developmentRequests })
})
