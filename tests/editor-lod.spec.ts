import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { expect, test, type Page, type TestInfo } from '@playwright/test'
import type { BoundsMm, PointMm } from '../src/core/v2/types'
import type { PerformanceFixtureSummaryV2 } from '../src/editor/v2/performance-fixtures'

type Sample = 'study' | 'island'
type Fixture = { bytes: Buffer; summary: PerformanceFixtureSummaryV2 }
const fixtures = new Map<Sample, Fixture>()

async function attach(testInfo: TestInfo, name: string, value: unknown) {
  await testInfo.attach(name, { body: JSON.stringify(value, null, 2), contentType: 'application/json' })
}

async function fixtureFor(page: Page, sample: Sample): Promise<Fixture> {
  const cached = fixtures.get(sample)
  if (cached) return cached
  const directory = process.env.SCENEWEAVE_B5_FIXTURE_DIR
  let result: Fixture
  if (directory) {
    const manifest = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'))
    const entry = manifest.cases.find((value: { name: string }) => value.name === `${sample}-500`)
    if (!entry) throw new Error(`Missing ${sample}-500 in supplied B5 fixture manifest.`)
    result = { bytes: await readFile(path.join(directory, 'fixtures', `${sample}-500.sceneweave`)), summary: entry.summary }
  } else {
    const generated = await page.evaluate(async sample => {
      const fixturePath = '/src/editor/v2/performance-fixtures.ts', ioPath = '/src/io/v2/project-file.ts'
      const { createPerformanceFixtureV2 } = await import(fixturePath), { exportProjectV2 } = await import(ioPath)
      const { project, summary } = await createPerformanceFixtureV2(sample, 500)
      return { bytes: [...new Uint8Array(await (await exportProjectV2(project)).arrayBuffer())], summary }
    }, sample)
    result = { bytes: Buffer.from(generated.bytes), summary: generated.summary }
  }
  fixtures.set(sample, result); return result
}

async function importFixture(page: Page, bytes: Buffer, name: string) {
  await page.getByLabel('选择完整素材工程', { exact: true }).setInputFiles({ name, mimeType: 'application/x-sceneweave', buffer: bytes })
  await page.getByRole('button', { name: '保存并打开副本', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('.asset-save')).toHaveText('本地已保存')
  await expect(page.getByLabel('材质场景主持人预览', { exact: true })).toBeVisible()
  await expect(page.locator('.asset-map-wrap')).toHaveAttribute('aria-busy', 'false')
}

async function refinementCount(page: Page) {
  return Number(await page.getByLabel('地图视口', { exact: true }).getAttribute('data-refinement-count'))
}

async function cropObservation(page: Page, world: BoundsMm) {
  return page.getByLabel('地图视口', { exact: true }).evaluate((viewport, world) => {
    const base = viewport.querySelector<HTMLCanvasElement>('canvas:not([aria-hidden="true"])')!
    const detail = viewport.querySelector<HTMLCanvasElement>('.asset-detail-preview')!
    const baseBox = base.getBoundingClientRect(), box = detail.getBoundingClientRect(), viewBox = viewport.getBoundingClientRect()
    const left = Math.max(baseBox.left, viewBox.left + viewport.clientLeft), top = Math.max(baseBox.top, viewBox.top + viewport.clientTop)
    const right = Math.min(baseBox.right, viewBox.left + viewport.clientLeft + viewport.clientWidth), bottom = Math.min(baseBox.bottom, viewBox.top + viewport.clientTop + viewport.clientHeight)
    const percent = (text: string) => Number.parseFloat(text) / 100
    const crop = { x: world.x + percent(detail.style.left) * world.width, y: world.y + percent(detail.style.top) * world.height,
      width: percent(detail.style.width) * world.width, height: percent(detail.style.height) * world.height }
    const center = { x: crop.x + crop.width / 2, y: crop.y + crop.height / 2 }
    const viaBase = { x: baseBox.left + (center.x - world.x) / world.width * baseBox.width, y: baseBox.top + (center.y - world.y) / world.height * baseBox.height }
    const viaCrop = { x: box.left + (center.x - crop.x) / crop.width * box.width, y: box.top + (center.y - crop.y) / crop.height * box.height }
    return { count: Number(viewport.getAttribute('data-refinement-count')), zoom: Number(viewport.getAttribute('data-zoom')),
      visible: getComputedStyle(detail).display !== 'none' && getComputedStyle(detail).visibility === 'visible',
      width: detail.width, height: detail.height, crop,
      placementErrorPx: Math.max(Math.abs(box.left - left), Math.abs(box.top - top), Math.abs(box.right - right), Math.abs(box.bottom - bottom)),
      worldPositionErrorPx: Math.max(Math.abs(viaBase.x - viaCrop.x), Math.abs(viaBase.y - viaCrop.y)),
      aspectError: Math.abs(detail.width / detail.height - crop.width / crop.height) }
  }, world)
}

async function settledCrop(page: Page, world: BoundsMm, after = 0) {
  await expect.poll(async () => {
    const value = await cropObservation(page, world)
    return value.count > after && value.visible && value.width > 0 && value.height > 0 && Number.isFinite(value.placementErrorPx) && value.placementErrorPx < 2
  }).toBe(true)
  const value = await cropObservation(page, world)
  expect(Math.max(value.width, value.height)).toBeLessThanOrEqual(2048)
  expect(value.worldPositionErrorPx).toBeLessThan(1)
  expect(value.aspectError).toBeLessThan(.01)
  return value
}

async function clickWorld(page: Page, point: PointMm, bounds: BoundsMm) {
  const canvas = await page.getByLabel('材质场景主持人预览', { exact: true }).boundingBox()
  if (!canvas) throw new Error('No actual product canvas for world selection.')
  await page.mouse.click(canvas.x + (point.x - bounds.x) / bounds.width * canvas.width, canvas.y + (point.y - bounds.y) / bounds.height * canvas.height)
}

for (const sample of ['study', 'island'] as const) {
  test(`Editor LOD ${sample}: settled zoom uses a bounded aligned crop and tiny marker picking stays exact`, async ({ page }, testInfo) => {
    test.setTimeout(120_000)
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
    await page.goto('/#assets'); const fixture = await fixtureFor(page, sample)
    await importFixture(page, fixture.bytes, `${sample}-500.sceneweave`)
    const initial = await settledCrop(page, fixture.summary.worldBoundsMm)
    const before = await page.evaluate(async () => {
      const { workspace, repository } = Reflect.get(window, '__sceneweaveAssetsDev'), state = workspace.getState()
      return { document: JSON.stringify(state.project.document), stored: JSON.stringify((await repository.load(state.project.document.sceneId)).document), canUndo: state.canUndo, canRedo: state.canRedo }
    })
    const viewport = page.getByLabel('地图视口', { exact: true })
    await viewport.focus()
    for (let step = 0; step < 10; step++) await viewport.press('+')
    await expect(viewport).toHaveAttribute('data-zoom', '8')
    const zoomed = await settledCrop(page, fixture.summary.worldBoundsMm, initial.count)
    expect(zoomed.crop.width).toBeLessThan(fixture.summary.worldBoundsMm.width)
    expect(zoomed.crop.height).toBeLessThan(fixture.summary.worldBoundsMm.height)
    await viewport.press('ArrowRight'); await viewport.press('ArrowDown')
    const panned = await settledCrop(page, fixture.summary.worldBoundsMm, zoomed.count)
    expect(panned.crop).not.toEqual(zoomed.crop)
    await page.getByRole('button', { name: '适应全图', exact: true }).click(); await viewport.focus()
    for (let step = 0; step < 7; step++) await viewport.press('-')
    await expect(viewport).toHaveAttribute('data-zoom', '0.25')
    const miniature = await settledCrop(page, fixture.summary.worldBoundsMm, panned.count)
    await clickWorld(page, fixture.summary.selectionPointMm, fixture.summary.worldBoundsMm)
    await expect.poll(async () => JSON.parse((await viewport.getAttribute('data-selected-ids'))!)).toEqual([fixture.summary.editablePropId])
    const after = await page.evaluate(async () => {
      const { workspace, repository } = Reflect.get(window, '__sceneweaveAssetsDev'), state = workspace.getState()
      return { document: JSON.stringify(state.project.document), stored: JSON.stringify((await repository.load(state.project.document.sceneId)).document), canUndo: state.canUndo, canRedo: state.canRedo }
    })
    expect(after).toEqual(before); expect(errors).toEqual([])
    await attach(testInfo, `editor-lod-${sample}-viewport.json`, { fixture: fixture.summary, initial, zoomed, panned, miniature, exactMarkerSelection: true,
      unchangedDocumentHistoryAndStorage: true, scope: 'Real UI geometry and picking regression only. The existing C0 product PNG test covers fixed-range export; no performance acceptance is inferred.' })
  })
}

test('Editor LOD crop restores full image detail, verifies offscreen resources and closes cancelled bitmaps', async ({ page }, testInfo) => {
  test.setTimeout(120_000)
  await page.goto('/#assets')
  const result = await page.evaluate(async () => {
    const blankPath = '/src/editor/v2/blank-project.ts', renderPath = '/src/render/v2/renderer.ts'
    const { createBlankProjectV2, createPlacedPropV2 } = await import(blankPath), { renderEditorProjectV2, renderProjectV2 } = await import(renderPath)
    const project = await createBlankProjectV2({ title: 'Editor crop verification', widthMm: 16000, heightMm: 12000, preset: 'narrative', gridVisible: false })
    const scene = structuredClone(project.document), crop = { x: 4000, y: 3000, width: 8000, height: 6000 }
    const visible = createPlacedPropV2(scene, 'b2-p-03', { x: 6000, y: 5500 }, { id: 'lod-visible' })
    // The rock is outside the crop while its complete visual rectangle remains
    // inside the Floor; a broadleaf tree here would overhang the world boundary.
    const offscreen = createPlacedPropV2(scene, 'b3-p-05', { x: 14500, y: 10500 }, { id: 'lod-offscreen' })
    visible.shadowClass = 'none'; offscreen.shadowClass = 'none'; scene.props = { [visible.id]: visible, [offscreen.id]: offscreen }
    const complete = { ...project, document: scene }, before = JSON.stringify(scene)
    const pixels = (canvas: HTMLCanvasElement) => new Uint8Array(canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data)
    const digest = async (data: Uint8Array<ArrayBuffer>) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', data))].map(n => n.toString(16).padStart(2, '0')).join('')
    const full = await renderEditorProjectV2(complete, { audience: 'gm', longEdgePx: 1000, viewBoundsMm: crop, screenScalePxPerMm: 1 })
    const formalDocument = structuredClone(scene); formalDocument.exportBoundsMm = crop
    const formal = await renderProjectV2({ ...complete, document: formalDocument }, { audience: 'gm', longEdgePx: 1000 })
    const low = await renderEditorProjectV2(complete, { audience: 'gm', longEdgePx: 1000, viewBoundsMm: crop, screenScalePxPerMm: .001 })
    const fullPixels = pixels(full), formalPixels = pixels(formal), lowPixels = pixels(low)
    let differentChannels = 0, totalError = 0, significantPixels = 0
    for (let i = 0; i < fullPixels.length; i += 4) {
      let significant = false
      for (let c = 0; c < 4; c++) { const delta = Math.abs(fullPixels[i + c] - formalPixels[i + c]); totalError += delta; if (delta) differentChannels++; if (delta > 12) significant = true }
      if (significant) significantPixels++
    }
    const comparison = { width: full.width, height: full.height, formalWidth: formal.width, formalHeight: formal.height,
      fullHash: await digest(fullPixels), formalHash: await digest(formalPixels), lowHash: await digest(lowPixels), differentChannels,
      meanAbsoluteError: totalError / fullPixels.length, significantPixelFraction: significantPixels / (full.width * full.height) }
    full.width = full.height = formal.width = formal.height = low.width = low.height = 0
    const hash = scene.assets[offscreen.appearance.assetId].sha256, missing = { ...complete, assets: { ...complete.assets } }
    delete missing.assets[hash]
    let missingError = '', corruptError = '', cancelName = '', decoded = 0, closed = 0
    try { await renderEditorProjectV2(missing, { audience: 'gm', longEdgePx: 512, viewBoundsMm: crop, screenScalePxPerMm: .001 }) } catch (error) { missingError = String(error) }
    const broken = { ...complete, assets: { ...complete.assets } }, badBlob = new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' })
    broken.assets[hash] = { ...broken.assets[hash], blob: badBlob, sizeBytes: badBlob.size }
    try { await renderEditorProjectV2(broken, { audience: 'gm', longEdgePx: 512, viewBoundsMm: crop, screenScalePxPerMm: .001 }) } catch (error) { corruptError = String(error) }
    const original = window.createImageBitmap.bind(window), controller = new AbortController()
    window.createImageBitmap = (async (source: ImageBitmapSource, options?: ImageBitmapOptions) => {
      const bitmap = await original(source, options), close = bitmap.close.bind(bitmap); decoded++
      bitmap.close = () => { closed++; close() }; controller.abort(); return bitmap
    }) as typeof createImageBitmap
    try { await renderEditorProjectV2(complete, { audience: 'gm', longEdgePx: 512, viewBoundsMm: crop, signal: controller.signal }) }
    catch (error) { cancelName = error instanceof DOMException ? error.name : String(error) }
    finally { window.createImageBitmap = original }
    return { crop, comparison, offscreenId: offscreen.id, offscreenOutsideCrop: offscreen.positionMm.x + offscreen.visualBoundsMm.x > crop.x + crop.width,
      missingError, corruptError, cancelName, decoded, closed, sourceUnchanged: JSON.stringify(scene) === before }
  })
  expect(result.comparison.width).toBe(1000); expect(result.comparison.height).toBe(750)
  expect(result.comparison.formalWidth).toBe(1000); expect(result.comparison.formalHeight).toBe(750)
  expect(result.comparison.fullHash).not.toBe(result.comparison.lowHash)
  // Padded crop copies may resample edge pixels. Compare the actual RGBA error,
  // including alpha, with the independently cropped formal document.
  expect(result.comparison.meanAbsoluteError).toBeLessThan(.25)
  expect(result.comparison.significantPixelFraction).toBeLessThan(.005)
  expect(result.offscreenOutsideCrop).toBe(true); expect(result.missingError).toContain('缺失')
  expect(result.corruptError).toMatch(/PNG|格式|无效|损坏|完整性/)
  expect(result.cancelName).toBe('AbortError'); expect(result.decoded).toBe(1); expect(result.closed).toBe(1); expect(result.sourceUnchanged).toBe(true)
  await attach(testInfo, 'editor-lod-crop-resource-cleanup.json', result)
})

for (const name of ['VIS-01-S01', 'VIS-02-S02'] as const) {
  test(`Editor LOD ${name}: player crops isolate private images, shadows and dependent geometry`, async ({ page }, testInfo) => {
    test.setTimeout(120_000)
    await page.goto('/#assets')
    const result = await page.evaluate(async name => {
      const fixturePath = '/tests/b4-privacy-fixtures.ts', renderPath = '/src/render/v2/renderer.ts', projectionPath = '/src/render/v2/projection.ts'
      const { createPrivacyPairB4 } = await import(fixturePath), { renderEditorProjectV2 } = await import(renderPath), { projectSceneV2 } = await import(projectionPath)
      const pair = await createPrivacyPairB4(name), before = [JSON.stringify(pair.a.document), JSON.stringify(pair.b.document)]
      const mask = pair.a.document.regions['b4-fixed-mask'].boundaryMm, x = Math.min(...mask.map((p: PointMm) => p.x)), y = Math.min(...mask.map((p: PointMm) => p.y))
      const width = Math.max(...mask.map((p: PointMm) => p.x)) - x, height = Math.max(...mask.map((p: PointMm) => p.y)) - y
      const crop = { x: x - 300, y: y - 300, width: width + 600, height: height + 600 }, observations = []
      const digest = async (bytes: Uint8Array<ArrayBuffer>) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2, '0')).join('')
      for (const [variant, audience] of [['a', 'player'], ['a', 'gm'], ['b', 'player'], ['b', 'gm'], ['a', 'player']] as const) {
        const project = pair[variant], decodedHashes: string[] = [], original = window.createImageBitmap.bind(window); let closed = 0
        window.createImageBitmap = (async (source: ImageBitmapSource, options?: ImageBitmapOptions) => {
          if (!(source instanceof Blob)) throw new Error('Expected the editor to decode adopted Blob bytes.')
          decodedHashes.push(await digest(new Uint8Array(await source.arrayBuffer())))
          const bitmap = await original(source, options), close = bitmap.close.bind(bitmap); bitmap.close = () => { closed++; close() }; return bitmap
        }) as typeof createImageBitmap
        let canvas: HTMLCanvasElement
        try { canvas = await renderEditorProjectV2(project, { audience, longEdgePx: 640, viewBoundsMm: crop, screenScalePxPerMm: 1 }) }
        finally { window.createImageBitmap = original }
        const ctx = canvas.getContext('2d')!, rgba = new Uint8Array(ctx.getImageData(0, 0, canvas.width, canvas.height).data)
        const center = [...ctx.getImageData(Math.floor(width / 2 / crop.width * canvas.width + 300 / crop.width * canvas.width), Math.floor(height / 2 / crop.height * canvas.height + 300 / crop.height * canvas.height), 1, 1).data]
        const expectedHashes = [...new Set(projectSceneV2(project.document, audience).assetIds.map((id: string) => project.document.assets[id].sha256))].sort()
        observations.push({ variant, audience, width: canvas.width, height: canvas.height, hash: await digest(rgba), center, decodedHashes: decodedHashes.sort(), expectedHashes, closed,
          privateHashesDecoded: pair.secretAssetIds.filter((id: string) => decodedHashes.includes(project.document.assets[id].sha256)) })
        canvas.width = canvas.height = 0
      }
      return { name, crop, observations, sourceUnchanged: before[0] === JSON.stringify(pair.a.document) && before[1] === JSON.stringify(pair.b.document) }
    }, name)
    const player = result.observations.filter(value => value.audience === 'player'), gm = result.observations.filter(value => value.audience === 'gm')
    expect(new Set(player.map(value => value.hash)).size).toBe(1); expect(gm[0].hash).not.toBe(gm[1].hash)
    for (const value of result.observations) {
      expect(Math.max(value.width, value.height)).toBe(640); expect(value.decodedHashes).toEqual(value.expectedHashes); expect(value.closed).toBe(value.decodedHashes.length)
      if (value.audience === 'player') { expect(value.center).toEqual([216, 213, 197, 255]); expect(value.privateHashesDecoded).toEqual([]) }
      else expect(value.privateHashesDecoded).toEqual(['b4-private-object-image', 'b4-private-texture-image'])
    }
    expect(result.sourceUnchanged).toBe(true)
    await attach(testInfo, `editor-lod-${name}-private-crop.json`, result)
  })
}

test('Editor LOD late GM refinement cannot replace a newer player canvas after rapid zoom and audience switches', async ({ page }, testInfo) => {
  test.setTimeout(120_000)
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await page.goto('/#assets')
  const fixture = await page.evaluate(async () => {
    const fixturePath = '/tests/b4-privacy-fixtures.ts', ioPath = '/src/io/v2/project-file.ts'
    const { createPrivacyPairB4 } = await import(fixturePath), { exportProjectV2 } = await import(ioPath)
    const pair = await createPrivacyPairB4('VIS-01-S01'), project = pair.a
    return { bytes: [...new Uint8Array(await (await exportProjectV2(project)).arrayBuffer())], bounds: project.document.exportBoundsMm, maskCenter: { x: 3000, y: 2700 } }
  })
  await importFixture(page, Buffer.from(fixture.bytes), 'lod-private-race.sceneweave')
  const initial = await settledCrop(page, fixture.bounds), viewport = page.getByLabel('地图视口', { exact: true })
  await page.evaluate(({ bounds, maskCenter }) => {
    const original = window.createImageBitmap.bind(window), gate = { started: false, released: false, closed: 0, playerFrames: 0, checkedCanvases: 0, failures: [] as { canvas: string; pixel: number[] }[], frame: 0,
      release: () => {}, restore: () => { window.createImageBitmap = original } }
    const held = new Promise<void>(resolve => { gate.release = () => { gate.released = true; resolve() } })
    window.createImageBitmap = (async (source: ImageBitmapSource, options?: ImageBitmapOptions) => {
      const bitmap = await original(source, options)
      if (!gate.started) { gate.started = true; const close = bitmap.close.bind(bitmap); bitmap.close = () => { gate.closed++; close() }; await held }
      return bitmap
    }) as typeof createImageBitmap
    const inspect = () => {
      const audience = document.querySelector('[aria-label="预览受众"] button[aria-pressed="true"]')?.textContent
      const image = document.querySelector<HTMLElement>('.asset-viewport-image')
      if (audience?.includes('玩家') && image && getComputedStyle(image).visibility === 'visible') {
        gate.playerFrames++
        for (const canvas of image.querySelectorAll<HTMLCanvasElement>('canvas:not(.asset-selection-overlay)')) {
          if (getComputedStyle(canvas).display === 'none' || !canvas.width || !canvas.height) continue
          const detail = canvas.classList.contains('asset-detail-preview'), fraction = (text: string) => Number.parseFloat(text) / 100
          const crop = detail ? { x: bounds.x + fraction(canvas.style.left) * bounds.width, y: bounds.y + fraction(canvas.style.top) * bounds.height,
            width: fraction(canvas.style.width) * bounds.width, height: fraction(canvas.style.height) * bounds.height } : bounds
          if (maskCenter.x < crop.x || maskCenter.x >= crop.x + crop.width || maskCenter.y < crop.y || maskCenter.y >= crop.y + crop.height) continue
          const pixel = [...canvas.getContext('2d')!.getImageData(Math.floor((maskCenter.x - crop.x) / crop.width * canvas.width), Math.floor((maskCenter.y - crop.y) / crop.height * canvas.height), 1, 1).data]
          gate.checkedCanvases++
          if (pixel.some((value, i) => value !== [216, 213, 197, 255][i])) gate.failures.push({ canvas: detail ? 'detail' : 'base', pixel })
        }
      }
      gate.frame = requestAnimationFrame(inspect)
    }
    gate.frame = requestAnimationFrame(inspect); Reflect.set(window, '__editorLodDecodeGate', gate)
  }, fixture)
  try {
    await viewport.focus(); await viewport.press('+')
    await expect.poll(async () => page.evaluate(() => Reflect.get(window, '__editorLodDecodeGate').started)).toBe(true)
    const audience = page.getByRole('group', { name: '预览受众', exact: true }), player = audience.getByRole('button', { name: '玩家', exact: true }), gm = audience.getByRole('button', { name: '主持人', exact: true })
    await player.click()
    await page.evaluate(() => Reflect.get(window, '__editorLodDecodeGate').release())
    await expect(page.getByLabel('材质场景玩家预览', { exact: true })).toBeVisible()
    await settledCrop(page, fixture.bounds, initial.count)
    for (let round = 0; round < 3; round++) { await gm.click(); await player.click() }
    await expect(page.getByLabel('材质场景玩家预览', { exact: true })).toBeVisible()
    const afterSwitches = await refinementCount(page)
    await viewport.focus(); await viewport.press('+'); await viewport.press('+'); await viewport.press('-')
    const finalCrop = await settledCrop(page, fixture.bounds, afterSwitches)
    const result = await page.evaluate(async bounds => {
      const gate = Reflect.get(window, '__editorLodDecodeGate'), project = Reflect.get(window, '__sceneweaveAssetsDev').workspace.getState().project
      const renderPath = '/src/render/v2/renderer.ts', { renderEditorProjectV2 } = await import(renderPath)
      const hash = async (canvas: HTMLCanvasElement) => {
        const rgba = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data
        return [...new Uint8Array(await crypto.subtle.digest('SHA-256', rgba))].map(n => n.toString(16).padStart(2, '0')).join('')
      }
      const base = document.querySelector<HTMLCanvasElement>('[aria-label="材质场景玩家预览"]')!, detail = document.querySelector<HTMLCanvasElement>('.asset-detail-preview')!
      const fraction = (text: string) => Number.parseFloat(text) / 100
      const crop = { x: bounds.x + fraction(detail.style.left) * bounds.width, y: bounds.y + fraction(detail.style.top) * bounds.height,
        width: fraction(detail.style.width) * bounds.width, height: fraction(detail.style.height) * bounds.height }
      const expectedBase = await renderEditorProjectV2(project, { audience: 'player', longEdgePx: Math.max(base.width, base.height) })
      const expectedDetail = await renderEditorProjectV2(project, { audience: 'player', longEdgePx: Math.max(detail.width, detail.height), viewBoundsMm: crop, screenScalePxPerMm: base.getBoundingClientRect().width / bounds.width })
      const values = { actualBase: await hash(base), expectedBase: await hash(expectedBase), actualDetail: await hash(detail), expectedDetail: await hash(expectedDetail),
        heldBitmapClosed: gate.closed, playerFrames: gate.playerFrames, checkedCanvases: gate.checkedCanvases, playerMaskFailures: gate.failures }
      expectedBase.width = expectedBase.height = expectedDetail.width = expectedDetail.height = 0
      return values
    }, fixture.bounds)
    expect(result.actualBase).toBe(result.expectedBase); expect(result.actualDetail).toBe(result.expectedDetail)
    expect(result.heldBitmapClosed).toBe(1); expect(result.playerFrames).toBeGreaterThan(0); expect(result.checkedCanvases).toBeGreaterThan(0); expect(result.playerMaskFailures).toEqual([]); expect(errors).toEqual([])
    await attach(testInfo, 'editor-lod-late-gm-player-race.json', { initial, finalCrop, ...result, scope: 'One held real bitmap decode, trusted UI zoom/audience changes, player mask samples during visible animation frames and final independent renderer RGBA hashes. No exhaustive race or performance claim.' })
  } finally {
    await page.evaluate(() => { const gate = Reflect.get(window, '__editorLodDecodeGate'); gate.release(); gate.restore(); cancelAnimationFrame(gate.frame); Reflect.deleteProperty(window, '__editorLodDecodeGate') })
  }
})
