import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test'
import type { PerformanceFixtureSummaryV2 } from '../src/editor/v2/performance-fixtures'

type Sample = 'study' | 'island'
type Count = 500 | 2000
type Fixture = { bytes: Buffer; summary: PerformanceFixtureSummaryV2 }
type ViewState = { zoom: number; panX: number; panY: number; renderCount: number }
const fixtures = new Map<string, Fixture>()

async function fixtureFor(page: Page, sample: Sample, count: Count): Promise<Fixture> {
  const key = `${sample}-${count}`, cached = fixtures.get(key)
  if (cached) return cached
  const directory = process.env.SCENEWEAVE_B5_FIXTURE_DIR
  let result: Fixture
  if (directory) {
    const manifest = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'))
    const entry = manifest.cases.find((value: { name: string }) => value.name === key)
    if (!entry) throw new Error(`Missing ${key} in the supplied B5 fixture manifest`)
    result = { bytes: await readFile(path.join(directory, 'fixtures', `${key}.sceneweave`)), summary: entry.summary }
  } else {
    const generated = await page.evaluate(async ({ sample, count }) => {
      const fixturePath = '/src/editor/v2/performance-fixtures.ts', ioPath = '/src/io/v2/project-file.ts'
      const { createPerformanceFixtureV2 } = await import(fixturePath), { exportProjectV2 } = await import(ioPath)
      const { project, summary } = await createPerformanceFixtureV2(sample, count)
      return { bytes: [...new Uint8Array(await (await exportProjectV2(project)).arrayBuffer())], summary }
    }, { sample, count })
    result = { bytes: Buffer.from(generated.bytes), summary: generated.summary }
  }
  fixtures.set(key, result)
  return result
}

async function openFixture(page: Page, sample: Sample, count: Count) {
  await page.goto('/#assets')
  const fixture = await fixtureFor(page, sample, count)
  await page.getByLabel('选择完整素材工程').setInputFiles({ name: `${sample}-${count}.sceneweave`, mimeType: 'application/x-sceneweave', buffer: fixture.bytes })
  await page.getByRole('button', { name: '保存并打开副本', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('.asset-save')).toHaveText('本地已保存')
  await expect(page.getByLabel('材质场景主持人预览', { exact: true })).toBeVisible()
  await expect(page.getByTestId('asset-workbench')).toHaveAttribute('data-revision', '0')
  await expect.poll(async () => (await viewState(page)).renderCount).toBeGreaterThan(0)
  await settle(page)
  expect(await page.evaluate(() => Reflect.has(window, '__sceneweavePerformance'))).toBe(false)
  return fixture
}

async function settle(page: Page) {
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
}

async function viewState(page: Page): Promise<ViewState> {
  return page.locator('.asset-viewport').evaluate(viewport => {
    const value = (name: string) => {
      const text = viewport.getAttribute(name), number = Number(text)
      if (text === null || !Number.isFinite(number)) throw new Error(`Missing finite viewport observation ${name}`)
      return number
    }
    return { zoom: value('data-zoom'), panX: value('data-pan-x'), panY: value('data-pan-y'), renderCount: value('data-render-count') }
  })
}

async function expectSameView(page: Page, expected: ViewState) {
  const actual = await viewState(page)
  expect(actual.zoom).toBeCloseTo(expected.zoom, 5)
  expect(actual.panX).toBeCloseTo(expected.panX, 3)
  expect(actual.panY).toBeCloseTo(expected.panY, 3)
}

async function expectFit(page: Page) {
  await expect.poll(async () => {
    const state = await viewState(page)
    return { zoom: state.zoom, panX: Math.round(state.panX * 1000), panY: Math.round(state.panY * 1000) }
  }).toEqual({ zoom: 1, panX: 0, panY: 0 })
  await settle(page)
  const viewport = await page.locator('.asset-viewport').boundingBox()
  const canvas = await page.locator('.asset-viewport canvas:not([aria-hidden="true"])').boundingBox()
  if (!viewport || !canvas) throw new Error('No fitted product viewport and canvas')
  expect(canvas.x).toBeGreaterThanOrEqual(viewport.x - 2)
  expect(canvas.y).toBeGreaterThanOrEqual(viewport.y - 2)
  expect(canvas.x + canvas.width).toBeLessThanOrEqual(viewport.x + viewport.width + 2)
  expect(canvas.y + canvas.height).toBeLessThanOrEqual(viewport.y + viewport.height + 2)
}

async function relativeView(page: Page) {
  const state = await viewState(page), canvas = await page.locator('.asset-viewport canvas:not([aria-hidden="true"])').boundingBox()
  if (!canvas) throw new Error('No visible map for relative viewport observation')
  // Fixed export bounds: actual canvas size measures px/mm, and normalized
  // pan measures the world centre independently of the changing fit scale.
  return { width: canvas.width, height: canvas.height, x: state.panX / canvas.width, y: state.panY / canvas.height }
}

async function expectSameRelativeView(page: Page, expected: Awaited<ReturnType<typeof relativeView>>) {
  await settle(page)
  const actual = await relativeView(page)
  expect(actual.width).toBeCloseTo(expected.width, 3)
  expect(actual.height).toBeCloseTo(expected.height, 3)
  expect(actual.x).toBeCloseTo(expected.x, 4)
  expect(actual.y).toBeCloseTo(expected.y, 4)
}

async function markerPosition(page: Page, summary: PerformanceFixtureSummaryV2) {
  const box = await page.getByLabel('材质场景主持人预览', { exact: true }).boundingBox()
  if (!box) throw new Error('No actual product map canvas')
  const point = summary.selectionPointMm, bounds = summary.worldBoundsMm
  return { x: box.x + (point.x - bounds.x) / bounds.width * box.width, y: box.y + (point.y - bounds.y) / bounds.height * box.height }
}

async function selectMarker(page: Page, summary: PerformanceFixtureSummaryV2) {
  const point = await markerPosition(page, summary)
  await page.mouse.click(point.x, point.y)
  await expect(page.getByRole('heading', { name: '物件属性', exact: true })).toBeVisible()
  await expectSelectedMarkerRow(page, summary)
  await expect(page.getByLabel('物件旋转', { exact: true })).toHaveValue('0')
}

async function expectSelectedMarkerRow(page: Page, summary: PerformanceFixtureSummaryV2) {
  const search = page.getByRole('searchbox', { name: '搜索场景物件', exact: true })
  await search.fill(summary.editablePropId)
  await expect(page.locator(`[data-entity-id="${summary.editablePropId}"]`)).toHaveClass(/selected/)
  await search.clear()
}

async function changeNumber(input: Locator, value: string) {
  await input.fill(value); await input.press('Enter')
}

async function pngFromUi(page: Page) {
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: '4K PNG', exact: true }).click()
  const download = await pending, file = await download.path()
  if (!file) throw new Error('No real product PNG download')
  const bytes = await readFile(file)
  expect(bytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  await expect(page.locator('.asset-busy')).toHaveCount(0)
  await expect(page.getByLabel('材质场景主持人预览', { exact: true })).toBeVisible()
  return { sha256: createHash('sha256').update(bytes).digest('hex'), width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), bytes: bytes.length }
}

for (const sample of ['study', 'island'] as const) for (const count of [500, 2000] as const) {
  test(`C0 ${sample} ${count}: pointer-anchored zoom, actual transformed selection and pan reuse the raster`, async ({ page }, testInfo) => {
    test.setTimeout(90_000)
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
    const { summary } = await openFixture(page, sample, count)
    await expectFit(page)
    const initial = await viewState(page), originalPoint = await markerPosition(page, summary)
    await page.mouse.move(originalPoint.x, originalPoint.y); await page.mouse.wheel(0, -180)
    await expect.poll(async () => (await viewState(page)).zoom).toBeGreaterThan(1)
    const anchoredPoint = await markerPosition(page, summary)
    expect(Math.abs(anchoredPoint.x - originalPoint.x)).toBeLessThan(2)
    expect(Math.abs(anchoredPoint.y - originalPoint.y)).toBeLessThan(2)
    await selectMarker(page, summary)
    const selectedView = await viewState(page)
    await page.getByRole('button', { name: '平移地图', exact: true }).click()
    const viewport = await page.locator('.asset-viewport').boundingBox()
    if (!viewport) throw new Error('No map viewport')
    const centre = { x: viewport.x + viewport.width / 2, y: viewport.y + viewport.height / 2 }

    // This local observer exists only inside the test. Trusted browser input and rAF
    // spacing are scheduling observations, never GPU or physical-display latency.
    const observation = page.evaluate(() => new Promise<{ trustedInputCount: number; pointerMoves: number; frameGapMs: number[]; elapsedMs: number; timedOut: boolean }>(resolve => {
      const viewport = document.querySelector('.asset-viewport')!
      const start = performance.now(), frameGapMs: number[] = []
      let last = 0, frame = 0, trustedInputCount = 0, pointerMoves = 0, finished = false
      const input = (event: Event) => { if (event.isTrusted) trustedInputCount++; if (event.type === 'pointermove') pointerMoves++ }
      const tick = (time: number) => { if (last) frameGapMs.push(time - last); last = time; frame = requestAnimationFrame(tick) }
      const finish = (timedOut: boolean) => {
        if (finished) return
        finished = true; clearTimeout(timer); cancelAnimationFrame(frame)
        viewport.removeEventListener('pointerdown', input, true); viewport.removeEventListener('pointermove', input, true)
        viewport.removeEventListener('pointerup', stop, true)
        resolve({ trustedInputCount, pointerMoves, frameGapMs, elapsedMs: performance.now() - start, timedOut })
      }
      const stop = () => finish(false), timer = setTimeout(() => finish(true), 10_000)
      viewport.addEventListener('pointerdown', input, true); viewport.addEventListener('pointermove', input, true)
      viewport.addEventListener('pointerup', stop, true); frame = requestAnimationFrame(tick)
    }))
    await settle(page)
    await page.mouse.move(centre.x, centre.y); await page.mouse.down()
    for (let i = 1; i <= 24; i++) {
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())))
      await page.mouse.move(centre.x + i, centre.y + i * .5)
    }
    await page.mouse.up()
    const inputObservation = await observation
    expect(inputObservation.timedOut).toBe(false)
    expect(inputObservation.pointerMoves).toBeGreaterThanOrEqual(24)
    expect(inputObservation.trustedInputCount).toBeGreaterThanOrEqual(25)
    expect(inputObservation.frameGapMs.length).toBeGreaterThan(0)
    const panned = await viewState(page)
    expect(panned.panX - selectedView.panX).toBeCloseTo(24, 0)
    expect(panned.panY - selectedView.panY).toBeCloseTo(12, 0)
    await expectSelectedMarkerRow(page, summary)
    await page.getByRole('button', { name: '选择地图对象', exact: true }).click()
    await selectMarker(page, summary)
    await page.getByRole('button', { name: '适应全图', exact: true }).click()
    await expectFit(page)
    await selectMarker(page, summary)
    await settle(page)
    expect((await viewState(page)).renderCount).toBe(initial.renderCount)
    await expect(page.getByTestId('asset-workbench')).toHaveAttribute('data-revision', '0')
    await expect(page.locator('.asset-save')).toHaveText('本地已保存')
    expect(errors).toEqual([])
    await testInfo.attach(`${sample}-${count}-viewport.json`, { body: JSON.stringify({ sample, count, initial, zoomed: selectedView, panned, inputObservation, limitations: ['Trusted pointer input and requestAnimationFrame intervals are browser scheduling observations.', 'No GPU completion, physical display latency, or full QA-PERF-01 drag target is inferred.'] }, null, 2), contentType: 'application/json' })
  })
}

test('C0 keyboard focus, cancelled pan, candidate/undo retention, audience reset and window resize remain safe', async ({ page }, testInfo) => {
  test.setTimeout(90_000)
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  const { summary } = await openFixture(page, 'study', 500), viewport = page.getByLabel('地图视口', { exact: true })
  await viewport.focus(); await expect(viewport).toBeFocused()
  await viewport.press('+')
  await expect.poll(async () => (await viewState(page)).zoom).toBeGreaterThan(1)
  const zoomed = await viewState(page)
  await viewport.press('ArrowRight')
  await expect.poll(async () => (await viewState(page)).panX).not.toBe(zoomed.panX)
  const moved = await viewState(page)

  await page.getByRole('group', { name: '场景对象分类', exact: true }).getByRole('button', { name: '物件', exact: true }).click()
  await page.getByRole('searchbox', { name: '搜索场景物件', exact: true }).fill(summary.editablePropId)
  await page.locator(`[data-entity-id="${summary.editablePropId}"]`).click()
  const rotation = page.getByLabel('物件旋转', { exact: true })
  await rotation.focus(); await rotation.press('ArrowRight'); await rotation.press('0'); await rotation.press('Escape')
  await expect(rotation).toHaveValue('0'); await expectSameView(page, moved)
  await expect(page.getByTestId('asset-workbench')).toHaveAttribute('data-revision', '0')
  await changeNumber(rotation, '15')
  await expect(page.getByTestId('asset-workbench')).toHaveAttribute('data-revision', '1')
  await expect(page.locator('.asset-save')).toHaveText('本地已保存')
  await expect(page.getByLabel('材质场景主持人预览', { exact: true })).toBeVisible()
  await expectSameView(page, moved)
  await page.getByRole('button', { name: '撤销素材编辑', exact: true }).click()
  await expect(page.getByLabel('物件旋转', { exact: true })).toHaveValue('0')
  await expect(page.getByTestId('asset-workbench')).toHaveAttribute('data-revision', '2')
  await expect(page.locator('.asset-save')).toHaveText('本地已保存')
  await expectSameView(page, moved)

  await page.getByRole('button', { name: '素材历史快照', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '素材历史快照', exact: true })
  await expect(dialog).toBeVisible()
  await page.keyboard.press('0'); await page.keyboard.press('ArrowRight')
  await expectSameView(page, moved)
  await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0)
  await expect(page.getByRole('button', { name: '素材历史快照', exact: true })).toBeFocused()
  await page.keyboard.press('0'); await expectSameView(page, moved)

  await page.getByRole('group', { name: '场景对象分类', exact: true }).getByRole('button', { name: '结构', exact: true }).click()
  if (summary.contourEditTarget.kind !== 'vertex') throw new Error('Expected study vertex fixture')
  await page.locator(`[data-entity-id="${summary.contourEditTarget.id}"]`).click()
  const x = page.getByLabel('顶点 X', { exact: true })
  const beforeCandidate = await relativeView(page)
  await changeNumber(x, String(summary.contourEditTarget.positionMm.x + 1))
  await expect(page.getByRole('button', { name: '取消结构预览', exact: true })).toBeVisible()
  await expect(page.getByLabel('材质场景主持人预览', { exact: true })).toBeVisible()
  // The candidate bar changes fit size. Preserve world centre and actual px/mm;
  // relative fit zoom must compensate rather than remaining constant.
  await expectSameRelativeView(page, beforeCandidate)
  await page.getByRole('button', { name: '取消结构预览', exact: true }).click()
  await expect(x).toHaveValue(String(summary.contourEditTarget.positionMm.x))
  // Cancellation restores DOM layout first; ResizeObserver then schedules the
  // ephemeral pan restoration in rAF, as it does when the candidate opens.
  await settle(page)
  await expectSameView(page, moved)
  await expect(page.getByTestId('asset-workbench')).toHaveAttribute('data-revision', '2')

  await viewport.focus()
  const box = await viewport.boundingBox()
  if (!box) throw new Error('No keyboard map viewport')
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  await page.keyboard.down('Space'); await page.mouse.move(centre.x, centre.y); await page.mouse.down()
  await page.mouse.move(centre.x + 20, centre.y + 10)
  await expect.poll(async () => (await viewState(page)).panX).not.toBe(moved.panX)
  await page.keyboard.press('Escape')
  await settle(page)
  const stopped = await viewState(page)
  await page.mouse.move(centre.x + 50, centre.y + 30); await page.mouse.up(); await page.keyboard.up('Space')
  await expectSameView(page, stopped)

  await page.getByRole('group', { name: '预览受众', exact: true }).getByRole('button', { name: '玩家', exact: true }).click()
  await expect(page.getByLabel('材质场景玩家预览', { exact: true })).toBeVisible(); await expectFit(page)
  await expect(page.getByRole('heading', { name: '物件属性', exact: true })).toHaveCount(0)
  const playerInitial = await viewState(page)
  await page.getByRole('button', { name: '放大地图', exact: true }).click()
  await expect.poll(async () => (await viewState(page)).zoom).toBeGreaterThan(1)
  expect((await viewState(page)).renderCount).toBe(playerInitial.renderCount)
  await page.getByRole('group', { name: '预览受众', exact: true }).getByRole('button', { name: '主持人', exact: true }).click()
  await expect(page.getByLabel('材质场景主持人预览', { exact: true })).toBeVisible(); await expectFit(page)
  const beforeResize = await relativeView(page)
  for (const size of [{ width: 1100, height: 820 }, { width: 1920, height: 1200 }]) {
    await page.setViewportSize(size); await expectSameRelativeView(page, beforeResize)
  }
  await viewport.focus(); await viewport.press('0'); await expectFit(page)
  await viewport.focus()
  for (let i = 0; i < 24; i++) await viewport.press('+')
  await expect.poll(async () => (await viewState(page)).zoom).toBe(8)
  for (let i = 0; i < 48; i++) await viewport.press('-')
  await expect.poll(async () => (await viewState(page)).zoom).toBe(.25)
  await viewport.press('0'); await expectFit(page)
  const middleBefore = await viewState(page), middleBox = await viewport.boundingBox()
  if (!middleBox) throw new Error('No resized map viewport')
  await page.mouse.move(middleBox.x + middleBox.width / 2, middleBox.y + middleBox.height / 2)
  await page.mouse.down({ button: 'middle' })
  await page.mouse.move(middleBox.x + middleBox.width / 2 + 12, middleBox.y + middleBox.height / 2 + 6)
  await expect.poll(async () => (await viewState(page)).panX).not.toBe(middleBefore.panX)
  await page.mouse.wheel(0, -120)
  await expect.poll(async () => (await viewState(page)).zoom).toBeGreaterThan(middleBefore.zoom)
  const zoomDuringPan = await viewState(page)
  await page.mouse.move(middleBox.x - 10, middleBox.y + middleBox.height / 2, { steps: 5 })
  await page.mouse.up({ button: 'middle' }); await settle(page)
  const middleAfter = await viewState(page)
  expect(middleAfter.zoom).toBeCloseTo(zoomDuringPan.zoom, 5)
  expect(middleAfter.panX).not.toBe(middleBefore.panX)
  await page.mouse.move(middleBox.x + middleBox.width / 2, middleBox.y + middleBox.height / 2)
  await settle(page); await expectSameView(page, middleAfter)
  expect((await viewState(page)).renderCount).toBe(middleBefore.renderCount)
  await expect(page.getByTestId('asset-workbench')).toHaveAttribute('data-revision', '2')
  await page.getByRole('button', { name: '适应全图', exact: true }).click(); await expectFit(page)
  const beforeScene = await viewState(page)
  await page.getByRole('button', { name: '放大地图', exact: true }).click()
  await expect.poll(async () => (await viewState(page)).zoom).toBeGreaterThan(1)
  const replacement = await fixtureFor(page, 'island', 500)
  await page.getByLabel('选择完整素材工程').setInputFiles({ name: 'island-500.sceneweave', mimeType: 'application/x-sceneweave', buffer: replacement.bytes })
  await page.getByRole('button', { name: '保存并打开副本', exact: true }).click()
  await expect(page.locator('.asset-save')).toHaveText('本地已保存')
  await expect(page.getByLabel('材质场景主持人预览', { exact: true })).toBeVisible(); await expectFit(page)
  await expect(page.getByTestId('asset-workbench')).toHaveAttribute('data-revision', '0')
  expect(errors).toEqual([])
  await testInfo.attach('focus-candidate-resize.json', { body: JSON.stringify({ zoomed, moved, stopped, playerInitial, middleBefore, zoomDuringPan, middleAfter, beforeScene, final: await viewState(page), keyboardScopedToViewport: true, zoomBounds: [.25, 8], outsideReleaseStoppedPan: true, cancelledNumberUnchanged: true, candidateCancelled: true, audienceAndSceneResetFit: true }, null, 2), contentType: 'application/json' })
})

test('C0 a cropped and zoomed viewport leaves the real fixed-range 4K product PNG unchanged', async ({ page }, testInfo: TestInfo) => {
  test.setTimeout(90_000)
  await openFixture(page, 'island', 500)
  const before = await pngFromUi(page)
  await page.getByRole('button', { name: '放大地图', exact: true }).click()
  await page.getByRole('button', { name: '放大地图', exact: true }).click()
  const viewport = page.getByLabel('地图视口', { exact: true })
  await viewport.focus(); await viewport.press('ArrowRight'); await viewport.press('ArrowDown')
  const cropped = await viewState(page)
  expect(cropped.zoom).toBeGreaterThan(1)
  const after = await pngFromUi(page)
  expect(before.width).toBe(4096); expect(before.height).toBe(3686)
  expect(after).toEqual(before)
  await expect(page.getByTestId('asset-workbench')).toHaveAttribute('data-revision', '0')
  await expect(page.locator('.asset-save')).toHaveText('本地已保存')
  await testInfo.attach('fixed-range-export.json', { body: JSON.stringify({ before, after, viewport: cropped, exactEncodedPngMatch: true }, null, 2), contentType: 'application/json' })
})
