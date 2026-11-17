import { test, expect, type Page } from '@playwright/test'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import type { Projection } from '../src/shared/projection/types.js'
import type { Prop } from '../src/shared/model/scene.js'
import { createKeyboardProject, keyboardProjectBackup, keyboardResourceHashes, keyboardWorkspaceSaved, selectKeyboardProp } from './keyboard-ux-helpers'
import { openSamples, openSceneObjects, openOutdoorTask, openWorkspaceModule } from './workspace-navigation-helpers'
import { mapExportButton, openDetailsBySummary } from './workspace-ux-helpers'

const sampleName = '潮影航路 · 海洋成图'
async function adopt(page: Page) {
  const review = page.getByRole('region', { name: '候选审阅', exact: true })
  const confirmation = review.getByLabel('确认完整影响范围', { exact: true })
  if (await confirmation.count()) await confirmation.check()
  await review.getByRole('button', { name: /^采用/ }).click()
  await expect(review).toHaveCount(0); await keyboardWorkspaceSaved(page)
}
async function exportMap(page: Page, audience: 'gm' | 'player', file: string) {
  const downloading = page.waitForEvent('download'); await (await mapExportButton(page, audience)).click()
  await (await downloading).saveAs(file); await keyboardWorkspaceSaved(page)
  await page.locator('.workspace-export-menu > summary').click()
  return createHash('sha256').update(await readFile(file)).digest('hex')
}

test('ocean raster orders waves and submersion, rotates one waterline, clips land and preserves crop pixels', async ({ page }) => {
  await page.goto('/')
  const pixels = await page.evaluate(async () => {
    const rendererPath = '/src/platform/browser/render/canvas-renderer.ts'
    const { renderRasterProjection } = await import(rendererPath) as typeof import('../src/platform/browser/render/canvas-renderer')
    const texture = document.createElement('canvas'); texture.width = texture.height = 64
    const ctx = texture.getContext('2d')!; ctx.fillStyle = '#FF0000'; ctx.fillRect(0, 0, 64, 64)
    const imageBytesPath = '/src/shared/project/image-bytes.ts'
    const { normalizePngChunks } = await import(/* @vite-ignore */ imageBytesPath)
    const blob = await new Promise<Blob>(resolve => texture.toBlob(value => resolve(value!))), bytes = normalizePngChunks(new Uint8Array(await blob.arrayBuffer()))
    const sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('')
    const ref = { id: 'red', sha256, mimeType: 'image/png' as const, pixelWidth: 64, pixelHeight: 64, logicalSizeMm: { width: 4000, height: 4000 }, licenseRef: 'test', origin: { kind: 'original' as const, attribution: 'Generated test square', canEmbed: true } }
    const sources = { assetRefs: { red: ref }, assets: { [sha256]: { sha256, mimeType: ref.mimeType, pixelWidth: 64, pixelHeight: 64, sizeBytes: bytes.length } }, resources: { read: async () => bytes } }
    const rectangle = (x: number, y: number, right: number, bottom: number) => [{ x, y }, { x: right, y }, { x: right, y: bottom }, { x, y: bottom }]
    const prop: Prop = { id: 'creature', floorId: 'sea', editLocked: false, visibility: 'public', definitionRef: null, appearance: { kind: 'image', assetId: 'red', opacity: 1, tint: null },
      visualBoundsMm: { x: -2000, y: -2000, width: 4000, height: 4000 }, footprintMm: { width: 1000, height: 1000 }, footprintOffsetMm: { x: 0, y: 0 },
      positionMm: { x: 5000, y: 5000 }, rotationDeg: 0, supportRef: { kind: 'terrainArea', id: 'water' }, blocksMovement: false, blocksSight: false,
      renderLayer: 'object', renderOrder: 0, shadowClass: 'none', shadowOverride: null, waterAppearance: { mode: 'surface' } }
    const water = { version: 1 as const, color: '#204080', highlightColor: '#FFFFFF', clarity: 1, waveSpacingMm: 600, waveDirectionDeg: 12, waveStrength: 0, seed: 'pixel-sea' }
    const base: Projection = { audience: 'gm', sourceRevision: 0, bounds: { x: 0, y: 0, width: 10000, height: 10000 }, gridSizeMm: null,
      terrain: [{ id: 'water', points: rectangle(0, 0, 10000, 10000), style: null, elevationMm: 0, priority: 0, waterSurface: water }],
      rooms: [], walls: [], props: [prop], edges: [], paths: [], connections: [], notes: [], regions: [], masks: [], theme: null, materials: {}, assetIds: ['red'], limitations: [], diagnostics: [] }
    const render = async (projection: Projection, crop = false) => {
      const options = { audience: 'gm' as const, longEdgePx: crop ? 256 : 512 }
      const canvas = await renderRasterProjection(sources, projection, options, undefined, undefined, crop ? { x: 2500, y: 2500, width: 5000, height: 5000 } : undefined)
      try { return { data: canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data, width: canvas.width } }
      finally { canvas.width = canvas.height = 0 }
    }
    const at = (image: Awaited<ReturnType<typeof render>>, x: number, y: number) => [...image.data.slice((Math.floor(y * image.width / 10000) * image.width + Math.floor(x * image.width / 10000)) * 4, (Math.floor(y * image.width / 10000) * image.width + Math.floor(x * image.width / 10000)) * 4 + 4)]
    const surface = await render(base)
    const under = structuredClone(base); under.props[0].waterAppearance = { mode: 'submerged', depth: .5 }
    const submerged = await render(under)
    const opaque = structuredClone(under); opaque.terrain[0].waterSurface!.clarity = 0
    const invisible = await render(opaque)
    const partial = structuredClone(base); partial.props[0].waterAppearance = { mode: 'partial', depth: .5, submergedFraction: .5 }
    const split = await render(partial); partial.props[0].rotationDeg = 90
    const rotated = await render(partial)
    const waves = structuredClone(under); waves.terrain[0].waterSurface!.waveStrength = 1
    const underWaves = await render(waves), aboveWaves = await render({ ...waves, props: base.props })
    let underChanged = 0, aboveChanged = 0
    for (let y = 210; y < 300; y++) for (let x = 210; x < 300; x++) {
      const offset = (y * 512 + x) * 4
      if (submerged.data[offset] !== underWaves.data[offset]) underChanged++
      if (surface.data[offset] !== aboveWaves.data[offset]) aboveChanged++
    }
    const land = structuredClone(waves); land.terrain.push({ id: 'land', points: rectangle(5500, 0, 10000, 10000), style: null, elevationMm: 0, priority: 1 })
    const covered = await render(land), withoutCreature = await render({ ...land, props: [] })
    const crop = await render(waves, true)
    let cropDifferences = 0
    for (let y = 2; y < 254; y++) for (let x = 2; x < 254; x++) for (let c = 0; c < 4; c++) if (crop.data[(y * 256 + x) * 4 + c] !== underWaves.data[((y + 128) * 512 + x + 128) * 4 + c]) cropDifferences++
    const paint = { materialRef: { id: 'red-paint', version: 1 }, tileSizeMm: { width: 4000, height: 4000 }, rotationDeg: 0, alignment: 'world' as const, originMm: { x: 0, y: 0 }, tint: null, opacity: 1 }
    const painted = structuredClone(base); painted.props = []; painted.materials = { 'red-paint': { id: 'red-paint', version: 1, textureAssetId: 'red' } }
    painted.terrain[0].style = { base: paint, overlays: [{ id: 'saved-overlay', boundaryMm: rectangle(3500, 3500, 6500, 6500), paint, blendWidthMm: 250, renderOrder: 0 }] }
    const overlay = await render(painted)
    const feathered = structuredClone(painted); feathered.terrain[0].style = null
    feathered.terrain.push({ id: 'dry', points: rectangle(2500, 2500, 7500, 7500), style: { base: paint, overlays: [] }, elevationMm: 0, priority: 2, boundaryBlendMm: 300,
      regionsMm: [{ outerMm: rectangle(2500, 2500, 7500, 7500), holesMm: [rectangle(4500, 4500, 5500, 5500)] }] })
    const feather = await render(feathered), featherCrop = await render(feathered, true)
    let featherCropDifferences = 0
    for (let y = 2; y < 254; y++) for (let x = 2; x < 254; x++) for (let c = 0; c < 4; c++) if (featherCrop.data[(y * 256 + x) * 4 + c] !== feather.data[((y + 128) * 512 + x + 128) * 4 + c]) featherCropDifferences++
    const wake = structuredClone(base); wake.props[0].waterAppearance = { mode: 'surface', surfaceEffects: { ripples: .8, wakeLengthMm: 2000 } }
    const wakePaint = await render(wake)
    let wakePixels = 0
    for (let y = 370; y < 455; y++) for (let x = 160; x < 350; x++) if (wakePaint.data[(y * 512 + x) * 4] !== surface.data[(y * 512 + x) * 4]) wakePixels++
    return { surface: at(surface, 5000, 5000), submerged: at(submerged, 5000, 5000), invisible: at(invisible, 5000, 5000),
      splitTop: at(split, 5000, 4000), splitBottom: at(split, 5000, 6000), rotateLeft: at(rotated, 4000, 5000), rotateRight: at(rotated, 6000, 5000),
      underChanged, aboveChanged, cover: at(covered, 6000, 5000), landOnly: at(withoutCreature, 6000, 5000), cropDifferences,
      overlayCenter: at(overlay, 5000, 5000), overlayOutside: at(overlay, 2000, 2000), featherEdge: at(feather, 2520, 4000), featherMiddle: at(feather, 2950, 4000), featherInside: at(feather, 3800, 4000), featherHole: at(feather, 5000, 5000), featherCropDifferences, wakePixels }
  })
  expect(pixels.surface).toEqual([255, 0, 0, 255])
  expect(pixels.submerged).not.toEqual(pixels.surface)
  expect(pixels.invisible).toEqual([32, 64, 128, 255])
  expect(pixels.splitTop).toEqual(pixels.surface); expect(pixels.splitBottom).toEqual(pixels.submerged)
  // Rotating a premultiplied tinted canvas can round a channel by one on
  // Firefox; the submerged half must still match the same physical effect.
  expect(pixels.rotateLeft.every((value, i) => Math.abs(value - pixels.submerged[i]) <= 1)).toBe(true)
  expect(pixels.rotateRight).toEqual(pixels.surface)
  expect(pixels.underChanged).toBeGreaterThan(0); expect(pixels.aboveChanged).toBe(0)
  expect(pixels.cover).toEqual(pixels.landOnly)
  expect(pixels.cropDifferences).toBe(0)
  expect(pixels.overlayCenter).toEqual([255, 0, 0, 255]); expect(pixels.overlayOutside).toEqual([32, 64, 128, 255])
  expect(pixels.featherEdge[0]).toBeLessThan(pixels.featherMiddle[0]); expect(pixels.featherMiddle[0]).toBeLessThan(pixels.featherInside[0])
  expect(pixels.featherHole).toEqual([32, 64, 128, 255]); expect(pixels.featherCropDifferences).toBe(0)
  expect(pixels.wakePixels).toBeGreaterThan(20)
})

test('normal ocean sample edits survive cancel, undo, redo, cold load and fresh package import', async ({ page, browser }, info) => {
  test.setTimeout(test.info().project.name === 'chrome' ? 300000 : 900000)
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await createKeyboardProject(page, '海洋接入前的工程')
  const original = await keyboardProjectBackup(page, info.outputPath('original.sceneweave'))
  await openSamples(page); await page.getByRole('button', { name: sampleName, exact: true }).click()
  const opening = page.getByRole('dialog', { name: '确认打开工程', exact: true })
  await expect(opening).toBeVisible({ timeout: 90000 })
  await opening.getByRole('button', { name: '保存并打开副本', exact: true }).click(); await keyboardWorkspaceSaved(page)
  await expect(page.getByRole('heading', { name: sampleName, exact: true })).toBeVisible()
  const initial = await keyboardProjectBackup(page, info.outputPath('ocean-initial.sceneweave'))
  expect(Object.keys(initial.document.props)).toHaveLength(8)
  const gmFile = info.outputPath('ocean-gm.png'), playerFile = info.outputPath('ocean-player.png')
  const gmHash = await exportMap(page, 'gm', gmFile), playerHash = await exportMap(page, 'player', playerFile)
  expect(playerHash).toBe(gmHash)
  await selectKeyboardProp(page, 'ocean-kraken')
  const waterProp = page.getByLabel('物件浸水效果', { exact: true })
  await openDetailsBySummary(waterProp, /^水面与水下表现$/)
  await waterProp.getByLabel('视觉深度', { exact: true }).fill('0.8')
  await waterProp.getByRole('button', { name: '预览浸水效果', exact: true }).click(); await adopt(page)
  const edited = await keyboardProjectBackup(page, info.outputPath('ocean-edited.sceneweave'))
  expect(edited.document.props['ocean-kraken'].waterAppearance).toEqual({ mode: 'partial', depth: .8, submergedFraction: .5 })
  expect(edited.document.props['ocean-kraken'].positionMm).toEqual(initial.document.props['ocean-kraken'].positionMm)
  expect(keyboardResourceHashes(edited.hashes)).toEqual(keyboardResourceHashes(initial.hashes))
  await page.getByRole('button', { name: '撤销编辑', exact: true }).click(); await keyboardWorkspaceSaved(page)
  expect((await keyboardProjectBackup(page, info.outputPath('ocean-undo.sceneweave'))).document.props).toEqual(initial.document.props)
  await page.getByRole('button', { name: '重做编辑', exact: true }).click(); await keyboardWorkspaceSaved(page)
  const redone = await keyboardProjectBackup(page, info.outputPath('ocean-redo.sceneweave'))
  expect(redone.document.props).toEqual(edited.document.props)
  const navigation = await openSceneObjects(page)
  const all = navigation.getByRole('button', { name: '显示所有图层的对象', exact: true }); if (await all.isVisible()) await all.click()
  await navigation.getByLabel('搜索场景对象', { exact: true }).fill('ocean-open-water')
  await navigation.locator('[data-entity-id="ocean-open-water"]').click()
  const waterSurface = page.getByLabel('水面外观', { exact: true })
  await openDetailsBySummary(waterSurface, /^水面与静态浪纹/)
  await waterSurface.getByLabel('水体清澈度', { exact: true }).fill('0.3')
  await waterSurface.getByRole('button', { name: '预览水面外观', exact: true }).click()
  const review = page.getByRole('region', { name: '候选审阅', exact: true })
  await review.getByRole('button', { name: '取消视觉预览', exact: true }).click(); await keyboardWorkspaceSaved(page)
  const cancelled = await keyboardProjectBackup(page, info.outputPath('ocean-cancel.sceneweave'))
  expect(cancelled.document).toEqual(redone.document)
  await openDetailsBySummary(waterSurface, /^水面与静态浪纹/)
  await waterSurface.getByLabel('水体清澈度', { exact: true }).fill('0.6')
  await waterSurface.getByLabel('浪纹强度', { exact: true }).fill('0.6')
  await waterSurface.getByRole('button', { name: '预览水面外观', exact: true }).click(); await adopt(page)
  const waterEdited = await keyboardProjectBackup(page, info.outputPath('ocean-water-edited.sceneweave'))
  expect(waterEdited.document.terrainAreas['ocean-open-water'].waterSurface).toMatchObject({ clarity: .6, waveStrength: .6 })
  expect(waterEdited.document.props).toEqual(edited.document.props)
  await page.reload(); await page.getByRole('button', { name: '回到首页', exact: true }).click()
  await page.getByTestId('workspace-home').locator(`[data-project-key="native:${edited.document.sceneId}"]`).getByRole('button', { name: '打开', exact: true }).click()
  await keyboardWorkspaceSaved(page)
  const cold = await keyboardProjectBackup(page, info.outputPath('ocean-cold.sceneweave'))
  expect(cold.hashes).toEqual(waterEdited.hashes)
  const fresh = await browser.newContext()
  try {
    const imported = await fresh.newPage(); await imported.goto(new URL('./#home', page.url()).href)
    const choosing = imported.waitForEvent('filechooser')
    await imported.getByTestId('workspace-home').getByRole('button', { name: '打开工程文件', exact: true }).click()
    await (await choosing).setFiles(info.outputPath('ocean-cold.sceneweave')); await keyboardWorkspaceSaved(imported)
    const importedSaved = await keyboardProjectBackup(imported, info.outputPath('ocean-imported.sceneweave'))
    expect(importedSaved.document.props).toEqual(edited.document.props)
    expect(importedSaved.document.terrainAreas).toEqual(waterEdited.document.terrainAreas)
    await exportMap(imported, 'player', info.outputPath('ocean-imported-player.png'))
  } finally { await fresh.close() }
  await page.getByRole('button', { name: '回到首页', exact: true }).click()
  await page.getByTestId('workspace-home').locator(`[data-project-key="native:${original.document.sceneId}"]`).getByRole('button', { name: '打开', exact: true }).click(); await keyboardWorkspaceSaved(page)
  expect((await keyboardProjectBackup(page, info.outputPath('original-preserved.sceneweave'))).hashes).toEqual(original.hashes)
  const deliver = process.env.SCENEWEAVE_OCEAN_DELIVERY_DIR ? join(process.env.SCENEWEAVE_OCEAN_DELIVERY_DIR, 'initial') : join(process.cwd(), 'work', 'ocean-development'); await mkdir(deliver, { recursive: true })
  for (const [source, name] of [[gmFile, '潮影航路-主持人.png'], [playerFile, '潮影航路-玩家.png'], [info.outputPath('ocean-initial.sceneweave'), '潮影航路.sceneweave']]) await writeFile(join(deliver, name), await readFile(source))
  expect(errors).toEqual([])
})

test('blank scene creates water then places a catalog fish on an explicitly selected water support', async ({ page }, info) => {
  test.setTimeout(test.info().project.name === 'chrome' ? 180000 : 900000)
  await createKeyboardProject(page, '手工海洋成图')
  const terrain = await openOutdoorTask(page)
  await openDetailsBySummary(terrain, /^海面与浪纹$/)
  await terrain.getByRole('button', { name: '预览铺设海面', exact: true }).click(); await adopt(page)
  const sea = await keyboardProjectBackup(page, info.outputPath('new-water.sceneweave'))
  const supportId = Object.keys(sea.document.terrainAreas)[0]
  expect(sea.document.terrainAreas[supportId].waterSurface).toBeTruthy()
  await openWorkspaceModule(page, '素材')
  const collection = page.getByRole('region', { name: '全场景素材系列', exact: true })
  await openDetailsBySummary(collection, /^全场景素材 ·/)
  await collection.getByLabel('全场景用途大类', { exact: true }).selectOption('nature')
  await collection.getByLabel('全场景物件类别', { exact: true }).selectOption('marine-life')
  await collection.getByRole('button', { name: '加载所选物件类别', exact: true }).click()
  await collection.getByLabel('选择素材 银鳞鱼群', { exact: true }).check({ timeout: 60000 })
  await collection.getByRole('button', { name: '预览添加所选1件素材', exact: true }).click(); await adopt(page)
  const library = page.getByRole('region', { name: '组件素材库', exact: true })
  await library.getByLabel('搜索组件素材', { exact: true }).fill('银鳞鱼群')
  await library.getByRole('button', { name: '放置组件 银鳞鱼群', exact: true }).click()
  await page.getByLabel('放置表面', { exact: true }).selectOption(`terrainArea:${supportId}`)
  await page.getByRole('button', { name: '在此放置', exact: true }).click(); await keyboardWorkspaceSaved(page)
  const placed = await keyboardProjectBackup(page, info.outputPath('placed-fish.sceneweave'))
  const fish = Object.values(placed.document.props).find(prop => prop.definitionRef?.id.includes('silver-school'))!
  expect(fish.supportRef).toEqual({ kind: 'terrainArea', id: supportId })
  await page.getByRole('button', { name: '选择地图对象', exact: true }).click()
  await selectKeyboardProp(page, fish.id)
  const waterProp = page.getByLabel('物件浸水效果', { exact: true }); await openDetailsBySummary(waterProp, /^水面与水下表现$/)
  await waterProp.getByLabel('浸水方式', { exact: true }).selectOption('submerged')
  await waterProp.getByRole('button', { name: '预览浸水效果', exact: true }).click(); await adopt(page)
  expect((await keyboardProjectBackup(page, info.outputPath('submerged-fish.sceneweave'))).document.props[fish.id].waterAppearance).toMatchObject({ mode: 'submerged' })
})
