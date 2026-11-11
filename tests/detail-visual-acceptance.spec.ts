import { expect, test, type Browser, type Page } from '@playwright/test'
import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'
import { unzipSync } from 'fflate'
import type { BoundsMm, SceneDocument } from '../src/shared/model/scene'
import { visualBase } from '../src/shared/visual/base'
import { createKeyboardProject, keyboardProjectBackup, keyboardResourceHashes, keyboardWorkspaceSaved } from './keyboard-ux-helpers'
import { openSamples, openWorkspaceModule } from './workspace-navigation-helpers'
import { mapExportButton, openDetailsBySummary } from './workspace-ux-helpers'

// Every project/pixel below comes from the ordinary production page or its
// complete-file download. No fixture factory or hidden product API creates it.
// Automated checks cover technical facts; visible quality and P3 are reviewed
// separately from the saved full-resolution images and fixed-coordinate crops.
const { PNG } = createRequire(import.meta.url)('../node_modules/playwright-core/lib/utilsBundle.js')
type Raster = { width: number; height: number; data: Buffer }
type Backup = Awaited<ReturnType<typeof keyboardProjectBackup>>
const root = resolve(process.env.SCENEWEAVE_DETAIL_VISUAL_DIR ?? 'work/detail-acceptance-20261110/visual')
const sha = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex')
const review = (page: Page) => page.getByRole('region', { name: '候选审阅', exact: true })
const physical = (scene: SceneDocument) => Object.fromEntries((['floors', 'vertices', 'rooms', 'walls', 'openings', 'props', 'terrainAreas', 'terrainEdges', 'terrainConnections', 'paths', 'prefabInstances', 'scatterGroups', 'entityLayers', 'constraints'] as const).map(key => [key, scene[key]]))
async function adopt(page: Page, kind: '视觉修改' | '显示设置' | '组件修改') {
  const candidate = review(page), confirmation = candidate.getByLabel('确认完整影响范围', { exact: true })
  if (await confirmation.count()) await confirmation.check()
  await candidate.getByRole('button', { name: `采用${kind}`, exact: true }).click()
  await expect(candidate).toHaveCount(0); await keyboardWorkspaceSaved(page)
}
async function freshImport(browser: Browser, sourcePage: Page, filename: string) {
  const context = await browser.newContext({ viewport: { width: 1512, height: 982 } }), page = await context.newPage()
  await page.goto(new URL('./#home', sourcePage.url()).href)
  const choosing = page.waitForEvent('filechooser')
  await page.getByTestId('workspace-home').getByRole('button', { name: '打开工程文件', exact: true }).click()
  await (await choosing).setFiles(filename)
  // Full byte/pixel verification can exceed the helper's 30s import wait in
  // Firefox. This is bounded compatibility readiness, not a performance pass.
  await expect(page.locator('.asset-save')).toHaveText('本地已保存', { timeout: 90000 })
  await keyboardWorkspaceSaved(page)
  return { context, page }
}
async function runtime(page: Page) {
  const urls = await page.locator('script[src]').evaluateAll(nodes => nodes.map(node => (node as HTMLScriptElement).src))
  const scripts = []
  for (const url of urls) { const response = await page.request.get(url); expect(response.ok()).toBe(true); scripts.push({ url, sha256: sha(await response.body()) }) }
  return { url: page.url(), scripts, ...await page.evaluate(() => ({ userAgent: navigator.userAgent, dpr: devicePixelRatio, viewport: { width: innerWidth, height: innerHeight } })) }
}
async function backup(page: Page, filename: string) { return keyboardProjectBackup(page, filename) }
async function output(page: Page, audience: 'gm' | 'player', filename: string) {
  const pending = page.waitForEvent('download'); await (await mapExportButton(page, audience)).click()
  await (await pending).saveAs(filename); await keyboardWorkspaceSaved(page)
  await page.locator('.workspace-export-menu > summary').click()
  const bytes = await readFile(filename), image = PNG.sync.read(bytes) as Raster
  expect(Math.max(image.width, image.height)).toBe(4096)
  let clear = 0, partial = 0, opaque = 0
  for (let i = 3; i < image.data.length; i += 4) { if (!image.data[i]) clear++; else if (image.data[i] === 255) opaque++; else partial++ }
  return { image, fact: { filename, width: image.width, height: image.height, fileSha256: sha(bytes), rgbaSha256: sha(image.data), alpha: { clear, partial, opaque } } }
}
async function crop(image: Raster, bounds: BoundsMm, world: BoundsMm, filename: string) {
  const x = Math.floor((world.x - bounds.x) / bounds.width * image.width), y = Math.floor((world.y - bounds.y) / bounds.height * image.height)
  const right = Math.ceil((world.x + world.width - bounds.x) / bounds.width * image.width), bottom = Math.ceil((world.y + world.height - bounds.y) / bounds.height * image.height)
  expect(x).toBeGreaterThanOrEqual(0); expect(y).toBeGreaterThanOrEqual(0); expect(right).toBeLessThanOrEqual(image.width); expect(bottom).toBeLessThanOrEqual(image.height)
  const native = new PNG({ width: right - x, height: bottom - y }); PNG.bitblt(image, native, x, y, native.width, native.height, 0, 0)
  const bytes = PNG.sync.write(native); await writeFile(filename, bytes)
  return { filename, requestedWorldMm: world, sourcePixelRect: { x, y, width: native.width, height: native.height },
    actualWorldMm: { x: bounds.x + x / image.width * bounds.width, y: bounds.y + y / image.height * bounds.height, width: native.width / image.width * bounds.width, height: native.height / image.height * bounds.height },
    pxPerMeter: image.width / bounds.width * 1000, scale: '1 output pixel = 1 crop pixel; no resampling', fileSha256: sha(bytes), rgbaSha256: sha(native.data) }
}
async function atmosphere(page: Page, preset: 'neutral' | 'dusk') {
  const resources = await openWorkspaceModule(page, '氛围')
  await resources.getByRole('button', { name: /^氛围预设 ·/ }).click()
  const tools = page.getByRole('region', { name: '氛围预设', exact: true })
  await tools.getByLabel('氛围预设', { exact: true }).selectOption(preset)
  await tools.getByRole('button', { name: '预览氛围预设', exact: true }).click(); await adopt(page, '视觉修改')
}
async function comparison(page: Page, before: Backup, dir: string) {
  const canvas = page.getByLabel('材质场景主持人预览', { exact: true }), button = page.getByRole('button', { name: '对比原色（仅预览）', exact: true })
  const initial = await canvas.screenshot({ path: resolve(dir, 'preview-effect.png') })
  await button.click(); await expect(button).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(async () => sha(await canvas.screenshot())).not.toBe(sha(initial))
  const bypass = await canvas.screenshot({ path: resolve(dir, 'preview-bypass.png') })
  expect((await backup(page, resolve(dir, 'effect-bypass-readonly.sceneweave'))).hashes).toEqual(before.hashes)
  const formal = await output(page, 'player', resolve(dir, 'effect-bypass-player.png'))
  await button.click(); await expect(button).toHaveAttribute('aria-pressed', 'false')
  return { previewEffectSha256: sha(initial), previewBypassSha256: sha(bypass), formal }
}
async function matrix(page: Page, dir: string, source: Backup, crops: { name: string; bounds: BoundsMm }[]) {
  const outputs = [], closeups = [], bounds = Object.values(source.document.floors)[0].outputBoundsMm ?? source.document.exportBoundsMm
  await atmosphere(page, 'dusk')
  const effect = await backup(page, resolve(dir, 'effect.sceneweave'))
  expect(physical(effect.document)).toEqual(physical(source.document)); expect(keyboardResourceHashes(effect.hashes)).toEqual(keyboardResourceHashes(source.hashes))
  const effectGm = await output(page, 'gm', resolve(dir, 'effect-gm.png')), effectPlayer = await output(page, 'player', resolve(dir, 'effect-player.png'))
  outputs.push(effectGm.fact, effectPlayer.fact)
  const compare = await comparison(page, effect, dir)
  expect(compare.formal.fact.rgbaSha256).toBe(effectPlayer.fact.rgbaSha256)
  outputs.push(compare.formal.fact)
  await atmosphere(page, 'neutral')
  const neutral = await backup(page, resolve(dir, 'neutral.sceneweave'))
  expect(physical(neutral.document)).toEqual(physical(source.document)); expect(keyboardResourceHashes(neutral.hashes)).toEqual(keyboardResourceHashes(source.hashes))
  const neutralGm = await output(page, 'gm', resolve(dir, 'neutral-gm.png')), neutralPlayer = await output(page, 'player', resolve(dir, 'neutral-player.png'))
  outputs.push(neutralGm.fact, neutralPlayer.fact); expect(neutralPlayer.fact.rgbaSha256).not.toBe(effectPlayer.fact.rgbaSha256)
  for (const frame of crops) for (const [name, image] of [['effect', effectPlayer.image], ['neutral', neutralPlayer.image]] as const) closeups.push(await crop(image, bounds, frame.bounds, resolve(dir, `${frame.name}-${name}-native.png`)))
  expect((await backup(page, resolve(dir, 'after-outputs.sceneweave'))).hashes).toEqual(neutral.hashes)
  return { sourceHashes: source.hashes, effectHashes: effect.hashes, neutralHashes: neutral.hashes, outputBoundsMm: bounds,
    effect: visualBase(effect.document), neutral: visualBase(neutral.document), outputs, closeups,
    comparison: { previewEffectSha256: compare.previewEffectSha256, previewBypassSha256: compare.previewBypassSha256 },
    assessment: 'Technical facts only. Art quality and P3 require visual review of these images.' }
}

test('formal visual island freezes normal import, both cliff profiles, neutral/effect audiences and actual connection/grass crops', async ({ page, browser }, info) => {
  test.setTimeout(info.project.name === 'chromium' ? 420000 : 900000)
  const dir = resolve(root, info.project.name, 'island'); await mkdir(dir, { recursive: true })
  const sourcePath = resolve(dir, 'normal-source.sceneweave')
  if (process.env.SCENEWEAVE_DETAIL_VISUAL_INPUTS) {
    // Cross-browser compatibility reuses the exact ordinary-page complete file
    // frozen by this run's Chromium matrix, including all source/PNG bytes.
    await page.goto('./#home')
    await copyFile(resolve(process.env.SCENEWEAVE_DETAIL_VISUAL_INPUTS, 'island/normal-source.sceneweave'), sourcePath)
  } else {
    await createKeyboardProject(page, '岩岛正式视觉来源')
    await openSamples(page)
    await page.getByRole('region', { name: '场景样板', exact: true }).getByRole('button', { name: '岬湾苔岛 · 自然岩阶与崖面', exact: true }).click()
    const opening = page.getByRole('dialog', { name: '确认打开工程', exact: true }); await expect(opening).toBeVisible({ timeout: 90000 })
    await opening.getByRole('button', { name: '保存并打开副本', exact: true }).click(); await keyboardWorkspaceSaved(page)
    await backup(page, sourcePath)
  }
  const imported = await freshImport(browser, page, sourcePath), errors: string[] = []; imported.page.on('pageerror', error => errors.push(error.message))
  try {
    const target = imported.page, source = await backup(target, resolve(dir, 'imported.sceneweave'))
    expect(source.document.presetSnapshot.presetId).toBe('sceneweave-natural-detail-island')
    const old = await output(target, 'player', resolve(dir, 'profile2-default-player.png')), base = visualBase(source.document)!
    const resources = await openWorkspaceModule(target, '氛围')
    await resources.getByRole('navigation', { name: '视觉工具', exact: true }).getByRole('button', { name: '边界', exact: true }).click()
    const tools = target.getByRole('region', { name: '曲线与边带', exact: true })
    for (const id of ['q1-crown-cliff', 'q1-coast-cliff']) {
      await tools.getByLabel('视觉已有曲线', { exact: true }).selectOption(base.edgeLooks[id].boundaryId)
      await tools.getByLabel('崖面层次画法', { exact: true }).selectOption('rockRelief3')
      await tools.getByRole('button', { name: '预览曲线与边带', exact: true }).click(); await adopt(target, '视觉修改')
    }
    const profile3 = await backup(target, resolve(dir, 'profile3-imported.sceneweave'))
    expect(physical(profile3.document)).toEqual(physical(source.document)); expect(keyboardResourceHashes(profile3.hashes)).toEqual(keyboardResourceHashes(source.hashes))
    const current = await output(target, 'player', resolve(dir, 'profile3-default-player.png'))
    expect(current.fact.rgbaSha256).not.toBe(old.fact.rgbaSha256)
    const connection = profile3.document.terrainConnections['q1-stairs']
    expect(connection.widthMm).toBe(1500); expect(connection.route?.renderProfile).toBe('naturalRockSteps2')
    const openingCrop = { x: 6000, y: 5800, width: 6500, height: 5400 }
    const profiles = [await crop(old.image, source.document.exportBoundsMm, openingCrop, resolve(dir, 'profile2-opening-native.png')), await crop(current.image, source.document.exportBoundsMm, openingCrop, resolve(dir, 'profile3-opening-native.png'))]
    const result = await matrix(target, dir, profile3, [{ name: 'stairs-cliff-opening', bounds: openingCrop }, { name: 'grass-rock-junction', bounds: { x: 12000, y: 2800, width: 7000, height: 6000 } }])
    await writeFile(resolve(dir, 'facts.json'), JSON.stringify({ runtime: await runtime(target), normalSourceFileSha256: sha(await readFile(sourcePath)),
      profile2SourceHashes: source.hashes, profileOutputs: [old.fact, current.fact], profiles, connection, ...result, pageErrors: errors }, null, 2))
    await target.screenshot({ path: resolve(dir, 'ordinary-page.png'), animations: 'disabled' }); expect(errors).toEqual([])
  } finally { await imported.context.close() }
})

test('formal visual outpost freezes normal sample file, four real scatter channels, static road/camp boundaries and world-scale fern', async ({ page, browser }, info) => {
  test.setTimeout(info.project.name === 'chromium' ? 420000 : 900000)
  const dir = resolve(root, info.project.name, 'outpost'); await mkdir(dir, { recursive: true })
  const sourcePath = resolve(dir, 'normal-source.sceneweave')
  if (process.env.SCENEWEAVE_DETAIL_VISUAL_INPUTS) {
    await page.goto('./#home')
    await copyFile(resolve(process.env.SCENEWEAVE_DETAIL_VISUAL_INPUTS, 'outpost/normal-source.sceneweave'), sourcePath)
  } else {
    await createKeyboardProject(page, '哨站正式视觉来源'); await openWorkspaceModule(page, '素材')
    const packs = page.getByRole('region', { name: '主题素材包', exact: true })
    await openDetailsBySummary(packs, /^主题素材包 · 场景与画风$/); await packs.getByLabel('选择主题包', { exact: true }).selectOption('wilderness')
    await openDetailsBySummary(packs, /^两份可编辑代表场景$/); await packs.getByLabel('林中哨站植被密度', { exact: true }).selectOption('balanced')
    const downloading = page.waitForEvent('download')
    await packs.getByRole('button', { name: '下载场景 · 林中哨站 · 自然编排', exact: true }).click(); await (await downloading).saveAs(sourcePath)
  }
  const imported = await freshImport(browser, page, sourcePath), errors: string[] = []; imported.page.on('pageerror', error => errors.push(error.message))
  try {
    const target = imported.page, source = await backup(target, resolve(dir, 'imported.sceneweave'))
    expect(source.document.presetSnapshot.presetId).toBe('sceneweave-natural-detail-outpost'); expect(Object.keys(source.document.scatterGroups)).toHaveLength(4)
    const original = await output(target, 'player', resolve(dir, 'default-player.png'))
    const files = unzipSync(new Uint8Array(await readFile(resolve(dir, 'imported.sceneweave')))), oldAssets = []
    for (const definition of Object.values(source.document.propDefinitions).filter(row => row.catalogId?.startsWith('prop.sceneweave.vegetation-detail-v1.'))) {
      if (definition.defaultAppearance.kind !== 'image') throw new Error('Fixed vegetation must use real image assets')
      const asset = source.document.assets[definition.defaultAppearance.assetId], bytes = files[`assets/${asset.sha256}.png`], image = PNG.sync.read(Buffer.from(bytes)) as Raster
      expect(sha(bytes)).toBe(asset.sha256); expect(image.width).toBe(512); expect(image.height).toBe(512)
      const path = resolve(dir, `${definition.catalogId.split('.').at(-1)}-512.png`); await writeFile(path, bytes)
      oldAssets.push({ definitionId: definition.id, assetId: asset.id, filename: path, fileSha256: sha(bytes), visualBoundsMm: definition.defaultVisualBoundsMm, footprintMm: definition.defaultFootprintMm })
    }
    expect(oldAssets).toHaveLength(6)
    const result = await matrix(target, dir, source, [{ name: 'road-camp-junction', bounds: { x: 17000, y: 11500, width: 13500, height: 11000 } },
      { name: 'door-road-shoulder', bounds: { x: 3500, y: 8500, width: 9000, height: 10500 } }, { name: 'fern-map-scale', bounds: { x: 20000, y: 6000, width: 6500, height: 5200 } }])
    await writeFile(resolve(dir, 'facts.json'), JSON.stringify({ runtime: await runtime(target), normalSourceFileSha256: sha(await readFile(sourcePath)),
      originalOutput: original.fact, oldAssets, groups: source.document.scatterGroups, ...result, pageErrors: errors }, null, 2))
    await target.screenshot({ path: resolve(dir, 'ordinary-page.png'), animations: 'disabled' }); expect(errors).toEqual([])
  } finally { await imported.context.close() }
})

test('formal visual leafy fern uses ordinary catalogue, exact source/permission closure and transparent map-scale pixels', async ({ page }, info) => {
  test.setTimeout(info.project.name === 'chromium' ? 300000 : 900000)
  const dir = resolve(root, info.project.name, 'leafy-fern'); await mkdir(dir, { recursive: true })
  await page.goto('./#home')
  await page.getByTestId('workspace-home').getByRole('button', { name: '新建场景', exact: true }).click()
  const creating = page.getByRole('dialog', { name: '新建空白场景', exact: true })
  await creating.getByLabel('场景名称', { exact: true }).fill('羽叶蕨实际尺度与透明度')
  // Match the outpost's real 36×28m / 4096px scale; retain the initial 14m
  // capture separately instead of presenting a larger sprite as the same scale.
  await creating.getByLabel('画布宽度', { exact: true }).fill('36')
  await creating.getByLabel('画布高度', { exact: true }).fill('28')
  await creating.getByRole('button', { name: '创建空白场景', exact: true }).click()
  await expect(creating).toHaveCount(0); await keyboardWorkspaceSaved(page)
  const before = await backup(page, resolve(dir, 'before.sceneweave'))
  await openWorkspaceModule(page, '素材')
  const packs = page.getByRole('region', { name: '主题素材包', exact: true }); await openDetailsBySummary(packs, /^主题素材包 · 场景与画风$/)
  await openDetailsBySummary(packs, /^羽叶蕨 · 清晰叶面变体$/); await packs.getByRole('button', { name: '预览添加清晰羽叶蕨', exact: true }).click()
  await expect(review(page).getByRole('img', { name: '待入库素材预览 舒叶羽状蕨', exact: true })).toBeVisible({ timeout: 90000 })
  // This acknowledges technical fixture review only; it does not grant P3.
  for (const choice of await review(page).getByRole('checkbox', { name: /^复核并保留素材 / }).all()) await choice.check()
  await adopt(page, '组件修改')
  const adopted = await backup(page, resolve(dir, 'adopted.sceneweave'))
  for (const [id, definition] of Object.entries(before.document.propDefinitions)) expect(adopted.document.propDefinitions[id]).toEqual(definition)
  const definition = Object.values(adopted.document.propDefinitions).find(row => row.catalogId === 'prop.sceneweave.leafy-fern-v1.shrub-splayed-fern-leafy')!
  expect(definition).toBeTruthy(); expect(definition.defaultVisualBoundsMm).toEqual({ x: -600, y: -703, width: 1200, height: 1250 })
  if (definition.defaultAppearance.kind !== 'image') throw new Error('Expected a real fixed fern PNG')
  const files = unzipSync(new Uint8Array(await readFile(resolve(dir, 'adopted.sceneweave')))), asset = adopted.document.assets[definition.defaultAppearance.assetId]
  const sourceIndex = JSON.parse(new TextDecoder().decode(files['sources.json'])), source = sourceIndex[asset.id]
  const pngBytes = files[`assets/${asset.sha256}.png`], raster = PNG.sync.read(Buffer.from(pngBytes)) as Raster
  expect(raster.width).toBe(512); expect(raster.height).toBe(512); expect(sha(pngBytes)).toBe(asset.sha256)
  const svg = files[`sources/${source.sourceSha256}.svg`]; expect(sha(svg)).toBe('20449908d2d00457c4df2cf3dc06f66c6ad0f837298c0822fcb5e15066d06b79')
  await writeFile(resolve(dir, 'leafy-fern-512.png'), pngBytes); await writeFile(resolve(dir, 'original.svg'), svg)
  const manifest = JSON.parse(new TextDecoder().decode(files['manifest.json']))
  const license = manifest.licenseBindings.find((row: { subjectId: string }) => row.subjectId === definition.id)
  expect(license.embedding).toBe('allowed'); expect(files[license.licensePath]).toBeTruthy()
  await writeFile(resolve(dir, 'license.txt'), files[license.licensePath])
  const library = page.getByRole('region', { name: '组件素材库', exact: true })
  await library.getByLabel('搜索组件素材', { exact: true }).fill('舒叶羽状蕨')
  await library.getByRole('button', { name: '放置组件 舒叶羽状蕨', exact: true }).click()
  for (const axis of ['X', 'Y']) { const input = page.getByLabel(`放置 ${axis}`, { exact: true }); await input.fill(axis === 'X' ? '8' : '8'); await input.press('Tab') }
  await page.getByRole('button', { name: '在此放置', exact: true }).click(); await keyboardWorkspaceSaved(page)
  await page.getByRole('button', { name: '选择地图对象', exact: true }).click()
  const resources = await openWorkspaceModule(page, '氛围')
  await resources.getByRole('navigation', { name: '视觉工具', exact: true }).getByRole('button', { name: '背景', exact: true }).click()
  const background = page.getByRole('region', { name: '输出背景', exact: true }); await background.getByLabel('输出背景方式', { exact: true }).selectOption('transparent')
  await background.getByRole('button', { name: '预览输出背景', exact: true }).click(); await adopt(page, '显示设置')
  const complete = await backup(page, resolve(dir, 'transparent.sceneweave')), gm = await output(page, 'gm', resolve(dir, 'transparent-gm.png')), player = await output(page, 'player', resolve(dir, 'transparent-player.png'))
  expect(Object.values(complete.document.props).filter(prop => prop.definitionRef?.id === definition.id)).toHaveLength(1)
  expect(complete.document.exportBoundsMm).toEqual({ x: 0, y: 0, width: 36000, height: 28000 })
  expect(player.fact.alpha.clear).toBeGreaterThan(0); expect(player.fact.alpha.partial).toBeGreaterThan(0)
  const closeup = await crop(player.image, complete.document.exportBoundsMm, { x: 6600, y: 6600, width: 2800, height: 2800 }, resolve(dir, 'leafy-fern-map-native.png'))
  expect((await backup(page, resolve(dir, 'after-outputs.sceneweave'))).hashes).toEqual(complete.hashes)
  await writeFile(resolve(dir, 'facts.json'), JSON.stringify({ runtime: await runtime(page), hashes: complete.hashes, asset, definition, source, license,
    sourceSha256: sha(svg), originalPngSha256: sha(pngBytes), outputs: [gm.fact, player.fact], closeup,
    assessment: 'Alpha, immutable sources and actual map scale checked technically; art readability and P3 reviewed separately.' }, null, 2))
  await page.screenshot({ path: resolve(dir, 'ordinary-page.png'), animations: 'disabled' })
})

test('compatibility viewport wheel, space-pan and Chinese numeric controls preserve ordinary saved output', async ({ page }, info) => {
  test.setTimeout(info.project.name === 'chromium' ? 180000 : 900000)
  const dir = resolve(root, info.project.name, 'input-compatibility'); await mkdir(dir, { recursive: true })
  await createKeyboardProject(page, '跨浏览器输入与画布')
  const before = await backup(page, resolve(dir, 'before.sceneweave'))
  const initial = await output(page, 'player', resolve(dir, 'before-player.png'))
  const viewport = page.getByRole('group', { name: '地图视口', exact: true }), box = await viewport.boundingBox()
  if (!box) throw new Error('The ordinary viewport must have actual pointer bounds')
  const read = async () => ({ zoom: Number(await viewport.getAttribute('data-zoom')), panX: Number(await viewport.getAttribute('data-pan-x')), panY: Number(await viewport.getAttribute('data-pan-y')) })
  const fit = await read(), x = box.x + box.width * .55, y = box.y + box.height * .55
  await page.mouse.move(x, y); await page.mouse.wheel(0, -200)
  await expect.poll(async () => (await read()).zoom).toBeGreaterThan(fit.zoom)
  const zoomed = await read()
  await viewport.focus(); await page.keyboard.down('Space'); await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 45, y + 24, { steps: 5 }); await page.mouse.up(); await page.keyboard.up('Space')
  await expect.poll(async () => (await read()).panX).not.toBe(zoomed.panX)
  const panned = await read()
  await page.getByRole('button', { name: '适应全图', exact: true }).click()
  await keyboardWorkspaceSaved(page)
  expect((await backup(page, resolve(dir, 'after-view.sceneweave'))).hashes).toEqual(before.hashes)
  const after = await output(page, 'player', resolve(dir, 'after-player.png'))
  expect(after.fact.rgbaSha256).toBe(initial.fact.rgbaSha256)
  await writeFile(resolve(dir, 'facts.json'), JSON.stringify({ runtime: await runtime(page), fit, zoomed, panned, reset: await read(), input: 'Real mouse wheel and Space + pointer drag; no synthetic hidden API', hashes: before.hashes, outputs: [initial.fact, after.fact] }, null, 2))
  await page.screenshot({ path: resolve(dir, 'ordinary-page.png'), animations: 'disabled' })
})

test('corrected connection cheeks re-export exact frozen inputs and preserve maps without connections', async ({ page, browser }, info) => {
  test.skip(process.env.SCENEWEAVE_DETAIL_CONNECTION_RECHECK !== '1', 'Run only against the explicitly frozen corrected production artifact.')
  test.setTimeout(info.project.name === 'chromium' ? 300000 : 900000)
  const dir = resolve(root, info.project.name, 'corrected-connection'); await mkdir(dir, { recursive: true })
  const baseline = resolve(process.env.SCENEWEAVE_DETAIL_VISUAL_BASELINE ?? root, 'chromium')
  const sources: { key: string; file: string; png: string; changed: boolean; requiresDiff?: boolean }[] = [
    { key: 'island', file: resolve(baseline, 'island/profile3-imported.sceneweave'), png: resolve(baseline, 'island/profile3-default-player.png'), changed: true },
    { key: 'outpost', file: resolve(baseline, 'outpost/imported.sceneweave'), png: resolve(baseline, 'outpost/default-player.png'), changed: false },
    { key: 'leafy-fern', file: resolve(baseline, 'leafy-fern/transparent.sceneweave'), png: resolve(baseline, 'leafy-fern/transparent-player.png'), changed: false },
  ]
  if (process.env.SCENEWEAVE_DETAIL_WIDE_RECHECK === '1') sources.push({ key: 'wide-cliff', file: resolve(baseline, 'wide-cliff-fixture/wide.sceneweave'), png: resolve(baseline, 'wide-cliff-fixture/wide-player.png'), changed: true, requiresDiff: true })
  const facts = []
  await page.goto('./#home')
  for (const source of sources) {
    const imported = await freshImport(browser, page, source.file)
    try {
      const target = imported.page, before = await backup(target, resolve(dir, `${source.key}-imported.sceneweave`))
      const previous = PNG.sync.read(await readFile(source.png)) as Raster
      const actual = await output(target, 'player', resolve(dir, `${source.key}-player.png`))
      expect(actual.image.width).toBe(previous.width); expect(actual.image.height).toBe(previous.height)
      let pixels = 0, left = previous.width, top = previous.height, right = -1, bottom = -1
      for (let y = 0; y < previous.height; y++) for (let x = 0; x < previous.width; x++) {
        const i = (y * previous.width + x) * 4
        if ([0, 1, 2, 3].some(channel => previous.data[i + channel] !== actual.image.data[i + channel])) { pixels++; left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y) }
      }
      if (source.changed) {
        if (source.requiresDiff) expect(pixels).toBeGreaterThan(0)
        const bounds = before.document.exportBoundsMm, frame = { x: 6000, y: 5800, width: 6500, height: 5400 }
        if (pixels) {
        expect(left / previous.width * bounds.width + bounds.x).toBeGreaterThanOrEqual(frame.x)
        expect(top / previous.height * bounds.height + bounds.y).toBeGreaterThanOrEqual(frame.y)
        expect((right + 1) / previous.width * bounds.width + bounds.x).toBeLessThanOrEqual(frame.x + frame.width)
        expect((bottom + 1) / previous.height * bounds.height + bounds.y).toBeLessThanOrEqual(frame.y + frame.height)
        }
        await crop(actual.image, bounds, frame, resolve(dir, `${source.key}-opening-after-native.png`))
        await crop(previous, bounds, frame, resolve(dir, `${source.key}-opening-before-native.png`))
      } else expect(pixels, `${source.key} has no connection; public renderer fix must preserve every actual RGBA pixel`).toBe(0)
      expect((await backup(target, resolve(dir, `${source.key}-after-output.sceneweave`))).hashes).toEqual(before.hashes)
      facts.push({ key: source.key, runtime: await runtime(target), exactInput: source.file, inputFileSha256: sha(await readFile(source.file)), importedHashes: before.hashes,
        previousPng: source.png, previousRgbaSha256: sha(previous.data), output: actual.fact, changedPixelCount: pixels,
        changedPixelBounds: pixels ? { x: left, y: top, width: right - left + 1, height: bottom - top + 1 } : null })
    } finally { await imported.context.close() }
  }
  await writeFile(resolve(dir, 'facts.json'), JSON.stringify(facts, null, 2))
})

test('prepare fixed 3000mm cliff fixture through ordinary panel before observing cap repair', async ({ page, browser }, info) => {
  test.skip(process.env.SCENEWEAVE_DETAIL_PREPARE_WIDE !== '1', 'One explicit pre-frozen visual diagnostic fixture; not a recipe search.')
  test.setTimeout(info.project.name === 'chromium' ? 180000 : 900000)
  const dir = resolve(root, info.project.name, 'wide-cliff-fixture'); await mkdir(dir, { recursive: true })
  const baseline = resolve(process.env.SCENEWEAVE_DETAIL_VISUAL_BASELINE ?? root, 'chromium/island/profile3-imported.sceneweave')
  await page.goto('./#home')
  const imported = await freshImport(browser, page, baseline)
  try {
    const target = imported.page, before = await backup(target, resolve(dir, 'before.sceneweave')), base = visualBase(before.document)!, look = base.edgeLooks['q1-crown-cliff']
    const resources = await openWorkspaceModule(target, '氛围')
    await resources.getByRole('navigation', { name: '视觉工具', exact: true }).getByRole('button', { name: '边界', exact: true }).click()
    const tools = target.getByRole('region', { name: '曲线与边带', exact: true })
    await tools.getByLabel('视觉已有曲线', { exact: true }).selectOption(look.boundaryId)
    // Freeze this one declared value before capturing any output. No iteration.
    await tools.getByLabel('视觉边带宽 mm', { exact: true }).fill('3000')
    await tools.getByRole('button', { name: '预览曲线与边带', exact: true }).click(); await adopt(target, '视觉修改')
    const wide = await backup(target, resolve(dir, 'wide.sceneweave'))
    expect(physical(wide.document)).toEqual(physical(before.document)); expect(keyboardResourceHashes(wide.hashes)).toEqual(keyboardResourceHashes(before.hashes))
    expect(visualBase(wide.document)!.edgeLooks).toEqual({ ...base.edgeLooks, [look.id]: { ...look, widthMm: 3000 } })
    expect(visualBase(wide.document)!.boundaries).toEqual(base.boundaries)
    const png = await output(target, 'player', resolve(dir, 'wide-player.png'))
    const native = await crop(png.image, wide.document.exportBoundsMm, { x: 6000, y: 5800, width: 6500, height: 5400 }, resolve(dir, 'wide-opening-before-native.png'))
    await writeFile(resolve(dir, 'facts.json'), JSON.stringify({ runtime: await runtime(target), exactBaseInput: baseline, inputSha256: sha(await readFile(baseline)),
      declaredChange: { id: look.id, field: 'widthMm', before: look.widthMm, after: 3000, chosenBeforeCapture: true, noParameterSearch: true },
      hashes: wide.hashes, output: png.fact, native, physicalPreserved: true, fixedResourcesPreserved: true }, null, 2))
  } finally { await imported.context.close() }
})
