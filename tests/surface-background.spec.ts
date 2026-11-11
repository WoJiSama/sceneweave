import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { unzipSync, zipSync } from 'fflate'
import { applyCompositionCommands } from '../src/shared/appearance/commands'
import { createCompositionContent } from '../src/shared/appearance/graph'
import { canonicalJson } from '../src/shared/validation/json'
import { visualBase } from '../src/shared/visual/base'
import type { SceneDocument, Prop } from '../src/shared/model/scene'
import type { ProjectManifest } from '../src/shared/project/file'
import { createKeyboardProject, keyboardProjectBackup, keyboardResourceHashes, keyboardWorkspaceSaved } from './keyboard-ux-helpers'
import { openWorkspaceModule } from './workspace-navigation-helpers'
import { mapExportButton, openDetailsBySummary } from './workspace-ux-helpers'

const { PNG } = createRequire(import.meta.url)('../node_modules/playwright-core/lib/utilsBundle.js')
const review = (page: Page) => page.getByRole('region', { name: '候选审阅', exact: true })
async function background(page: Page) {
  const panel = await openWorkspaceModule(page, '氛围')
  await panel.getByRole('navigation', { name: '视觉工具', exact: true }).getByRole('button', { name: '背景', exact: true }).click()
  return page.getByTestId('workspace-inspector').getByRole('region', { name: '输出背景', exact: true })
}
async function adopt(page: Page, kind: '显示设置' | '视觉修改') {
  const candidate = review(page), confirm = candidate.getByLabel('确认完整影响范围', { exact: true })
  if (await confirm.count()) await confirm.check()
  await candidate.getByRole('button', { name: `采用${kind}`, exact: true }).click()
  await expect(candidate).toHaveCount(0); await keyboardWorkspaceSaved(page)
}
async function png(page: Page, audience: 'gm' | 'player', filename: string) {
  const pending = page.waitForEvent('download')
  await (await mapExportButton(page, audience)).click(); await (await pending).saveAs(filename)
  await keyboardWorkspaceSaved(page); await page.locator('.workspace-export-menu > summary').click()
  return PNG.sync.read(await readFile(filename)) as { width: number; height: number; data: Uint8Array }
}
function pixel(image: { width: number; height: number; data: Uint8Array }, world: { x: number; y: number }, bounds: SceneDocument['exportBoundsMm']) {
  const x = Math.floor((world.x - bounds.x) / bounds.width * image.width), y = Math.floor((world.y - bounds.y) / bounds.height * image.height)
  return Array.from(image.data.slice((y * image.width + x) * 4, (y * image.width + x) * 4 + 4))
}
async function importFile(page: Page, filename: string, home: string) {
  await page.goto(home)
  const pending = page.waitForEvent('filechooser')
  await page.getByTestId('workspace-home').getByRole('button', { name: '打开工程文件', exact: true }).click()
  await (await pending).setFiles(filename); await keyboardWorkspaceSaved(page)
}
async function cold(page: Page, sceneId: string) {
  await page.reload(); await page.getByRole('button', { name: '回到首页', exact: true }).click()
  await page.getByTestId('workspace-home').locator(`[data-project-key="native:${sceneId}"]`).getByRole('button', { name: '打开', exact: true }).click()
  await keyboardWorkspaceSaved(page)
}

test('background controls preserve cancellation, one undo, cold files, empty alpha and narrow-screen access', async ({ page }, info) => {
  test.setTimeout(180000)
  await page.setViewportSize({ width: 390, height: 844 })
  await createKeyboardProject(page, '透明与纯色输出')
  await page.getByRole('button', { name: /^米 · 格线.*吸附/ }).click()
  const scene = page.getByRole('region', { name: '场景设置', exact: true })
  await openDetailsBySummary(scene, /^单位与格线$/)
  await scene.getByLabel('场景显示格线', { exact: true }).uncheck()
  await scene.getByRole('button', { name: '预览显示设置', exact: true }).click(); await adopt(page, '显示设置')
  const before = await keyboardProjectBackup(page, info.outputPath('background-before.sceneweave'))
  let tools = await background(page)
  await tools.getByLabel('输出背景方式', { exact: true }).selectOption('solid')
  await tools.getByLabel('输出背景颜色', { exact: true }).fill('#fff0')
  await tools.getByRole('button', { name: '预览输出背景', exact: true }).click()
  await expect(tools.getByRole('alert')).toBeVisible(); await expect(review(page)).toHaveCount(0)
  await tools.getByLabel('输出背景颜色', { exact: true }).fill('#345678')
  await tools.getByRole('button', { name: '预览输出背景', exact: true }).click()
  await expect(review(page).getByRole('article', { name: '输出背景变化', exact: true })).toContainText('默认背景 → 纯色 #345678')
  await review(page).getByRole('button', { name: '取消显示预览', exact: true }).click(); await keyboardWorkspaceSaved(page)
  expect((await keyboardProjectBackup(page, info.outputPath('background-cancelled.sceneweave'))).hashes).toEqual(before.hashes)
  tools = await background(page)
  await tools.getByLabel('输出背景方式', { exact: true }).selectOption('solid')
  await tools.getByLabel('输出背景颜色', { exact: true }).fill('#345678')
  await tools.getByRole('button', { name: '预览输出背景', exact: true }).click(); await adopt(page, '显示设置')
  const solid = await keyboardProjectBackup(page, info.outputPath('background-solid.sceneweave'))
  expect(solid.document.outputBackground).toEqual({ mode: 'solid', color: '#345678' })
  const solidPng = await png(page, 'player', info.outputPath('background-solid.png'))
  expect(pixel(solidPng, { x: 1000, y: 1000 }, solid.document.exportBoundsMm)).toEqual([52, 86, 120, 255])
  await page.getByRole('button', { name: '撤销编辑', exact: true }).click(); await keyboardWorkspaceSaved(page)
  expect((await keyboardProjectBackup(page, info.outputPath('background-undo.sceneweave'))).document.outputBackground).toBeUndefined()
  await page.getByRole('button', { name: '重做编辑', exact: true }).click(); await keyboardWorkspaceSaved(page)
  const redone = await keyboardProjectBackup(page, info.outputPath('background-redone.sceneweave'))
  expect(redone.document.outputBackground).toEqual(solid.document.outputBackground)
  expect(redone.document.revision).toBeGreaterThan(solid.document.revision)
  await cold(page, solid.document.sceneId)
  expect((await keyboardProjectBackup(page, info.outputPath('background-cold.sceneweave'))).hashes).toEqual(redone.hashes)
  tools = await background(page)
  await tools.getByLabel('输出背景方式', { exact: true }).selectOption('transparent')
  await tools.getByRole('button', { name: '预览输出背景', exact: true }).click(); await adopt(page, '显示设置')
  const transparent = await keyboardProjectBackup(page, info.outputPath('background-transparent.sceneweave'))
  expect(transparent.document.outputBackground).toEqual({ mode: 'transparent' })
  expect(keyboardResourceHashes(transparent.hashes)).toEqual(keyboardResourceHashes(before.hashes))
  const empty = await png(page, 'player', info.outputPath('background-empty-transparent.png'))
  expect(empty.data.every(value => value === 0)).toBe(true)
  await expect(page.locator('.asset-viewport-image')).toHaveAttribute('data-transparent', 'true')
  expect(await page.evaluate(() => document.body.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: info.outputPath('background-390.png'), animations: 'disabled' })
})

/** A fresh complete fixture uses real downloaded assets. Content/appearance and
 * identity are constructed together, then the ordinary importer validates it. */
async function paintedFixture(page: Page, info: TestInfo) {
  const source = info.outputPath('pixel-source.sceneweave'), plain = await keyboardProjectBackup(page, source)
  const runtime = { ids: { nextId: () => randomUUID() }, clock: { now: () => plain.document.updatedAt } }
  let content = { document: plain.document, historyIdentity: plain.identity, appearance: plain.appearance }
  const floorId = Object.keys(plain.document.floors)[0], layerId = Object.keys(plain.document.userLayers)[0]
  const rect = (x: number, y: number, w: number, h: number) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }]
  content = applyCompositionCommands(content, [{ type: 'setSceneDisplay', display: 'm', distanceMode: 'metric', gridSizeMm: 1000, snapMm: 100, gridVisible: false }], runtime)
  const mat = Object.values(content.document.materials).find(value => value.applicableSurfaces.includes('terrain'))!
  content = applyCompositionCommands(content, [
    { type: 'createTerrainArea', id: 'public-paint', floorId, layerId, boundaryMm: rect(2000, 2000, 4000, 3500), materialRef: { id: mat.id, version: mat.version } },
    { type: 'createRoom', id: 'private-room', floorId, layerId, boundaryMm: rect(8500, 4000, 3000, 3000), thicknessMm: 150, visibility: 'gm' },
    { type: 'upsertManualMask', id: 'private-mask', floorId, layerId, boundsMm: { x: 7800, y: 3300, width: 4500, height: 4500 } },
  ], runtime)
  const document = structuredClone(content.document)
  for (const [id, x, opacity] of [['opaque-chair', 2500, 1], ['faded-chair', 4500, .25]] as const) {
    document.props[id] = { id, floorId, editLocked: false, visibility: 'public', definitionRef: null,
      appearance: { kind: 'symbol', symbol: 'chair', tint: null, opacity }, positionMm: { x, y: 7500 }, rotationDeg: 0,
      visualBoundsMm: { x: -400, y: -400, width: 800, height: 800 }, footprintMm: { width: 800, height: 800 }, footprintOffsetMm: { x: 0, y: 0 },
      blocksMovement: false, blocksSight: false, supportRef: { kind: 'floor', id: floorId }, renderLayer: 'object', renderOrder: 0, shadowClass: 'none', shadowOverride: null } satisfies Prop
    document.entityLayers[id] = layerId
  }
  content = createCompositionContent(document, runtime)
  content = applyCompositionCommands(content, [{ type: 'setSceneBackground', background: { mode: 'transparent' } }], runtime)
  const archive = unzipSync(new Uint8Array(await readFile(source)))
  async function save(value: typeof content, filename: string) {
    const files = { ...archive }
    for (const [name, entry] of [['scene.json', value.document], ['identity.json', value.historyIdentity], ['appearance.json', value.appearance]] as const) files[name] = new TextEncoder().encode(canonicalJson(entry))
    const manifest = JSON.parse(new TextDecoder().decode(files['manifest.json'])) as ProjectManifest
    for (const entry of manifest.entries) if (['scene.json', 'identity.json', 'appearance.json'].includes(entry.path)) { entry.sizeBytes = files[entry.path].length; entry.sha256 = createHash('sha256').update(files[entry.path]).digest('hex') }
    files['manifest.json'] = new TextEncoder().encode(canonicalJson(manifest)); await writeFile(filename, zipSync(files))
  }
  const baseline = info.outputPath('pixel-fixture.sceneweave'); await save(content, baseline)
  const visual = visualBase(content.document)!
  const effects = applyCompositionCommands(content, [
    { type: 'setVisualEnvironment', environment: { ...visual.environment, ambientColor: '#000000', ambientOpacity: .5, exposure: 1 } },
    { type: 'upsertVisualLight', light: { id: 'pixel-light', floorId, layerId, visibility: 'public', editLocked: false, positionMm: { x: 1000, y: 1000 }, radiusMm: 800, color: '#FFFFFF', intensity: .4, wallOcclusion: false, enabled: true } },
    { type: 'upsertVisualFog', fog: { id: 'pixel-fog', floorId, layerId, visibility: 'public', editLocked: false, boundaryMm: rect(0, 0, 6000, 3000), color: '#AABBCC', opacity: .1, directionDeg: 0, scaleMm: 2500, seed: 'alpha-fog-1', enabled: true } },
    { type: 'upsertVisualFilter', filter: { id: 'pixel-filter', floorId, layerId, visibility: 'public', editLocked: false, target: { kind: 'scene' }, preset: 'warm', exposure: 1, saturation: 1, contrast: 1, grain: 0, vignette: 0, seed: 'alpha-filter-1', enabled: true } },
  ], runtime)
  const effectFile = info.outputPath('pixel-effects.sceneweave'); await save(effects, effectFile)
  const secret = applyCompositionCommands(effects, [{ type: 'transformBuilding', id: 'private-room', offsetMm: { x: 300, y: 200 }, pivotMm: { x: 0, y: 0 }, quarterTurns: 0 }], runtime)
  const secretFile = info.outputPath('pixel-secret-variant.sceneweave'); await save(secret, secretFile)
  return { baseline, effectFile, secretFile }
}

test('transparent production PNG preserves real surfaces, fractional color, effect alpha and opaque player secrets', async ({ page, browser }, info) => {
  test.setTimeout(240000)
  await createKeyboardProject(page, '透明像素与秘密保全')
  const files = await paintedFixture(page, info), home = new URL('./#home', page.url()).href
  const images = []
  for (const [name, file] of [['baseline', files.baseline], ['effects', files.effectFile], ['secret-variant', files.secretFile]] as const) {
    const context = await browser.newContext()
    try {
      const target = await context.newPage(); await importFile(target, file, home)
      const saved = await keyboardProjectBackup(target, info.outputPath(`pixel-${name}-opened.sceneweave`))
      const player = await png(target, 'player', info.outputPath(`pixel-${name}-player.png`))
      expect(pixel(player, { x: 500, y: 500 }, saved.document.exportBoundsMm)).toEqual([0, 0, 0, 0])
      expect(pixel(player, { x: 4000, y: 4000 }, saved.document.exportBoundsMm)[3]).toBe(255)
      expect(pixel(player, { x: 10000, y: 5000 }, saved.document.exportBoundsMm)).toEqual([216, 213, 197, 255])
      if (name === 'effects') {
        const full = pixel(player, { x: 2500, y: 7500 }, saved.document.exportBoundsMm), faded = pixel(player, { x: 4500, y: 7500 }, saved.document.exportBoundsMm)
        expect(full[3]).toBe(255); expect(faded[3]).toBeGreaterThanOrEqual(63); expect(faded[3]).toBeLessThanOrEqual(64)
        // An 8-bit premultiplied canvas has a 255/A straight-RGB quantum.
        // Bound error to one stored color byte, rather than assuming equal
        // integer RGB can be represented at both alpha=255 and alpha=64.
        for (let channel = 0; channel < 3; channel++) expect(Math.abs(full[channel] - faded[channel]) * faded[3] / 255).toBeLessThanOrEqual(1)
        const gm = await png(target, 'gm', info.outputPath('pixel-effects-gm.png'))
        expect(pixel(gm, { x: 10000, y: 5000 }, saved.document.exportBoundsMm)).not.toEqual([216, 213, 197, 255])
        await cold(target, saved.document.sceneId)
        expect((await keyboardProjectBackup(target, info.outputPath('pixel-effects-cold.sceneweave'))).hashes).toEqual(saved.hashes)
      }
      images.push(player)
    } finally { await context.close() }
  }
  const [original, graded, secret] = images
  let fractions = 0, changedAlpha = 0
  for (let i = 3; i < original.data.length; i += 4) { if (graded.data[i] !== original.data[i]) changedAlpha++; if (original.data[i] > 0 && original.data[i] < 255) fractions++ }
  expect(changedAlpha).toBe(0)
  expect(fractions).toBeGreaterThan(1000)
  expect(createHash('sha256').update(secret.data).digest('hex')).toBe(createHash('sha256').update(graded.data).digest('hex'))
  await writeFile(info.outputPath('alpha-facts.json'), JSON.stringify({ fractionalPixels: fractions, alphaUnchanged: true, privateGeometryPlayerInvariant: true, fractionalColorInvariant: true }, null, 2))
})
