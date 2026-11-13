import { test, expect, type Locator, type Page } from '@playwright/test'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { writeImageWorkPackage, readImageWorkPackage, type ImageWorkState } from '../src/shared/image-import/workflow'
import { sha256Bytes } from '../src/shared/project/binary'
import { decodeSelectionMask, encodeSelectionMask } from '../src/shared/image-import/selection-mask'
import { guidedImageSelection } from '../src/shared/image-import/guided-selection'
import { imagePolygonMask } from '../src/shared/image-import/pixels'

const { PNG } = createRequire(import.meta.url)('../node_modules/playwright-core/lib/utilsBundle.js')
const width = 96, height = 80
const rectangle = (x: number, y: number, w: number, h: number) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }]
async function fixture(blackOutline = false) {
  const png = new PNG({ width, height }), foreground = [25, 48, 73], background = [74, 123, 148]
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const selected = x >= 32 && x < 64 && y >= 26 && y < 54, edge = selected && (x === 32 || x === 63 || y === 26 || y === 53), alpha = selected ? edge ? .55 : 1 : 0
    const rgb = y === 26 && x >= 43 && x <= 49 ? [8, 83, 220] : foreground.map((value, c) => Math.round(value * alpha + background[c] * (1 - alpha)))
    png.data.set([...rgb, 255], (y * width + x) * 4)
  }
  if (blackOutline) for (let y = 38; y <= 40; y++) png.data.set([12, 14, 19, 255], (y * width + 32) * 4)
  const bytes = new Uint8Array(PNG.sync.write(png)), hash = sha256Bytes(bytes)
  const state: ImageWorkState = { format: 'sceneweave-image-work', version: 1, id: 'subject-edge-ui', revision: 1,
    image: { sha256: hash, pixelWidth: width, pixelHeight: height }, original: { name: 'mixed-edge.png', sha256: hash, sizeBytes: bytes.length, mimeType: 'image/png' },
    draft: { title: '主体派生与原图保真', calibration: { first: { x: 0, y: 0 }, second: { x: 50, y: 0 }, distanceMm: 1000 }, roomPointsPx: rectangle(3, 3, 90, 74),
      layers: [{ id: 'chair', name: '测试椅', polygon: rectangle(32, 26, 32, 28), donor: { x: 5, y: 5, width: 16, height: 16 }, renderLayer: 'object', blocksMovement: true, repair: 'seamless', appearanceSource: 'original', selectionMask: { x: 32, y: 26, width: 32, height: 28, runs: [896, 255] } }] },
    rights: { licenseText: 'Synthetic original pixels; embedding allowed.', attribution: 'Synthetic test', canEmbed: true }, notes: '', nextAction: '检查主体三个阶段', scaleStatus: 'provisional', journal: [], reviews: [] }
  return { bytes, state, foreground }
}
async function curvedFixture() {
  const value = await fixture(), png = new PNG({ width, height }), bounds = { x: 32, y: 26, width: 32, height: 28 }, data = new Uint8Array(bounds.width * bounds.height)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const selected = ((x - 47.5) / 15.7) ** 2 + ((y - 39.5) / 13.7) ** 2 <= 1 && x + y >= 72
    if (selected) data[(y - bounds.y) * bounds.width + x - bounds.x] = 255
    png.data.set(selected ? [18 + x % 5, 28 + y % 5, 42, 255] : [180, 85, 170, 255], (y * width + x) * 4)
  }
  const bytes = new Uint8Array(PNG.sync.write(png)), hash = sha256Bytes(bytes)
  value.state.image.sha256 = hash; value.state.original.sha256 = hash; value.state.original.sizeBytes = bytes.length
  value.state.draft.layers[0].selectionMask = encodeSelectionMask({ width: bounds.width, height: bounds.height, boundsPx: bounds, data })
  return { ...value, bytes, selectedPixels: data.reduce((n, a) => n + (a > 0 ? 1 : 0), 0) }
}
async function openWork(page: Page, file: string | { name: string; mimeType: string; buffer: Buffer }) {
  await page.goto('/')
  await page.getByRole('button', { name: '从图片新建场景', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '图片导入工作台', exact: true })
  await dialog.getByLabel('打开图片制作工作包', { exact: true }).setInputFiles(file)
  await expect(dialog.getByRole('button', { name: '精修测试椅主体边带', exact: true })).toBeEnabled()
  await dialog.getByRole('button', { name: '精修测试椅主体边带', exact: true }).click()
  return dialog
}
const pixel = (canvas: Locator, x: number, y: number) => canvas.evaluate((element: HTMLCanvasElement, point) => Array.from(element.getContext('2d')!.getImageData(point.x, point.y, 1, 1).data), { x, y })
async function exportWork(page: Page, dialog: Locator, filename: string) {
  const downloading = page.waitForEvent('download')
  await dialog.getByRole('button', { name: '导出制作工作包', exact: true }).click()
  await (await downloading).saveAs(filename)
  return readImageWorkPackage(new Uint8Array(await readFile(filename)))
}

test('subject refinement compares three actual stages, adopts an explicit derivative, preserves the source, restores it and cold-replays settings', async ({ page, browser }, info) => {
  test.setTimeout(180000)
  const input = await fixture()
  const dialog = await openWork(page, { name: 'subject.sceneweave-image-work', mimeType: 'application/octet-stream', buffer: Buffer.from(await writeImageWorkPackage(input.state, input.bytes, input.bytes)) })
  const panel = dialog.getByRole('region', { name: '主体边带精修', exact: true })
  await panel.getByLabel('主体精修方式', { exact: true }).selectOption('subject-matte-v1')
  await expect(panel).toContainText('当前使用原始裁片')
  await panel.getByLabel('主体精修强度', { exact: true }).selectOption('strong')
  await panel.getByRole('button', { name: '生成主体精修候选', exact: true }).click()
  const original = panel.getByLabel('原始裁片 · 未精修', { exact: true }), coverage = panel.getByLabel('覆盖度阶段 · 仅调整透明度', { exact: true }), refined = panel.getByLabel('去混色阶段 · 派生结果', { exact: true })
  await expect(refined).toBeVisible()
  const captured = await pixel(original, 0, 13), alphaStage = await pixel(coverage, 0, 13), finalStage = await pixel(refined, 0, 13)
  expect(captured[3]).toBe(255)
  expect(alphaStage.slice(0, 3)).toEqual(captured.slice(0, 3))
  expect(alphaStage[3]).toBeLessThan(200)
  expect(finalStage[3]).toBe(alphaStage[3])
  for (let c = 0; c < 3; c++) expect(Math.abs(finalStage[c] - input.foreground[c])).toBeLessThanOrEqual(2)
  expect(await pixel(refined, 15, 13)).toEqual(await pixel(original, 15, 13))
  for (const background of ['black', 'white', 'checker']) {
    await panel.getByLabel('主体精修检查背景', { exact: true }).selectOption(background)
    await expect(panel.locator(`.image-subject-pixels[data-background="${background}"]`)).toHaveCount(3)
    for (const canvas of [original, coverage, refined]) expect(await canvas.evaluate((element: HTMLCanvasElement) => element.getBoundingClientRect().width / element.width)).toBe(4)
    expect(await pixel(refined, 0, 13)).toEqual(finalStage)
  }
  const beforeAdoption = await exportWork(page, dialog, info.outputPath('readonly.sceneweave-image-work'))
  expect(beforeAdoption.state.draft.layers).toEqual(input.state.draft.layers)
  expect(beforeAdoption.state.journal).toEqual([])
  await panel.getByRole('button', { name: '定位主体待判断区域', exact: true }).first().click()
  const located = JSON.parse((await dialog.getByLabel('图片标注画布', { exact: true }).getAttribute('data-neighborhood-bounds'))!)
  expect(located.x).toBeGreaterThanOrEqual(32); expect(located.y).toBeGreaterThanOrEqual(26)
  await panel.getByRole('heading', { name: '测试椅 · 主体边带精修', exact: true }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: info.outputPath('subject-staged-candidate.png') })
  await panel.getByRole('button', { name: '采用此主体精修', exact: true }).click()
  await expect(panel).toContainText('当前已采用派生：1px · 较强')
  await expect(dialog).toContainText('合成预览含已采用主体派生外观')
  await expect(panel.getByRole('button', { name: '采用此主体精修', exact: true })).toBeDisabled()
  const filename = info.outputPath('adopted.sceneweave-image-work'), adopted = await exportWork(page, dialog, filename)
  expect(adopted.state.draft.layers[0].subjectRefinement).toEqual({ method: 'subject-matte-v1', bandPx: 1, strength: 'strong' })
  const { subjectRefinement, ...sameOriginal } = adopted.state.draft.layers[0]
  expect(sameOriginal).toEqual(input.state.draft.layers[0])
  expect(adopted.original).toEqual(input.bytes); expect(adopted.normalized).toEqual(input.bytes)
  expect(adopted.state.journal.at(-1)?.action).toBe('adopt-subject-refinement')
  await dialog.getByRole('group', { name: '图片导入阶段', exact: true }).getByRole('button', { name: '总览与采用', exact: true }).click()
  const fidelity = dialog.getByRole('region', { name: '原图保真对照', exact: true })
  await expect(fidelity).toContainText('仅原始裁片与补底校验，主体边带派生另审')
  await expect(fidelity).toContainText('同坐标像素检查通过')
  await dialog.getByRole('group', { name: '图片导入阶段', exact: true }).getByRole('button', { name: '物件与补底', exact: true }).click()
  await panel.locator('details').first().locator('summary').click()
  await panel.getByLabel('主体保护蒙版JSON', { exact: true }).fill('{"x":95,"y":79,"width":4,"height":4,"runs":[16,255]}')
  await panel.getByRole('button', { name: '生成主体精修候选', exact: true }).click()
  await expect(panel.getByRole('alert')).toBeVisible()
  await expect(panel.getByRole('button', { name: '采用此主体精修', exact: true })).toBeDisabled()
  const afterFailure = await exportWork(page, dialog, info.outputPath('failed-preserved.sceneweave-image-work'))
  expect(afterFailure.state.draft).toEqual(adopted.state.draft)
  expect(afterFailure.state.journal).toEqual(adopted.state.journal)
  await panel.getByLabel('主体保护蒙版JSON', { exact: true }).fill('')
  await panel.getByRole('button', { name: '生成主体精修候选', exact: true }).click()
  await expect(refined).toBeVisible()
  await panel.getByLabel('主体精修边带', { exact: true }).selectOption('2')
  await expect(refined).toHaveCount(0)
  await expect(panel.getByRole('button', { name: '采用此主体精修', exact: true })).toBeDisabled()
  await panel.getByRole('button', { name: '恢复原始裁片', exact: true }).click()
  await expect(panel).toContainText('当前使用原始裁片')
  const restored = await exportWork(page, dialog, info.outputPath('restored-original.sceneweave-image-work'))
  expect(restored.state.draft.layers).toEqual(input.state.draft.layers)
  expect(restored.state.journal.at(-1)?.action).toBe('restore-subject-source')
  const context = await browser.newContext()
  try {
    const cold = await context.newPage(), coldDialog = await openWork(cold, filename), coldPanel = coldDialog.getByRole('region', { name: '主体边带精修', exact: true })
    await expect(coldPanel).toContainText('当前已采用派生：1px · 较强')
    await expect(coldPanel.getByLabel('主体精修强度', { exact: true })).toHaveValue('strong')
    await expect(coldPanel.getByLabel('主体精修方式', { exact: true })).toHaveValue('subject-matte-v1')
    await coldPanel.getByRole('button', { name: '生成主体精修候选', exact: true }).click()
    expect(await pixel(coldPanel.getByLabel('去混色阶段 · 派生结果', { exact: true }), 0, 13)).toEqual(finalStage)
    expect(await pixel(coldPanel.getByLabel('原始裁片 · 未精修', { exact: true }), 0, 13)).toEqual(captured)
    await coldDialog.getByRole('button', { name: '精修测试椅轮廓', exact: true }).click()
    await coldDialog.getByRole('button', { name: '应用物件修正并补底', exact: true }).click()
    const afterContourEdit = await exportWork(cold, coldDialog, info.outputPath('cold-contour-preserves-subject.sceneweave-image-work'))
    expect(afterContourEdit.state.draft.layers[0].subjectRefinement).toEqual(adopted.state.draft.layers[0].subjectRefinement)
    expect(afterContourEdit.state.draft.layers[0].selectionMask).toEqual(input.state.draft.layers[0].selectionMask)
  } finally { await context.close() }
})

test('a slanted curved contour uses a shared padded source grid, adopts inferred outer alpha and cold-restores the explicit method', async ({ page, browser }, info) => {
  test.setTimeout(180000)
  const input = await curvedFixture()
  const dialog = await openWork(page, { name: 'curved.sceneweave-image-work', mimeType: 'application/octet-stream', buffer: Buffer.from(await writeImageWorkPackage(input.state, input.bytes, input.bytes)) })
  const panel = dialog.getByRole('region', { name: '主体边带精修', exact: true }), method = panel.getByLabel('主体精修方式', { exact: true })
  const original = panel.getByLabel('原始裁片 · 未精修', { exact: true }), coverage = panel.getByLabel('覆盖度阶段 · 轮廓抗锯齿', { exact: true }), refined = panel.getByLabel('轮廓派生结果 · 尚未去混色', { exact: true })
  const readPixels = (target: Locator) => target.evaluate((element: HTMLCanvasElement) => ({ width: element.width, height: element.height, data: Array.from(element.getContext('2d')!.getImageData(0, 0, element.width, element.height).data), grid: JSON.parse(element.dataset.sourceGrid!), bounds: JSON.parse(element.dataset.stageBounds!) }))
  await expect(method).toHaveValue('subject-contour-v1')
  await expect(panel.getByLabel('主体精修边带', { exact: true })).toBeDisabled()
  await expect(panel.getByLabel('主体精修边带', { exact: true })).toHaveValue('1')
  await panel.getByLabel('主体精修强度', { exact: true }).selectOption('strong')
  await panel.getByRole('button', { name: '生成主体精修候选', exact: true }).click()
  await expect(refined).toBeVisible()
  await expect(panel).toContainText('下面两个派生阶段相同')
  await expect(panel).toContainText('轮廓范围可能扩大')
  const sourceStage = await readPixels(original), derived = await readPixels(refined)
  expect(sourceStage.grid).toEqual({ x: 31, y: 25, width: 34, height: 30 })
  expect(sourceStage.bounds).toEqual({ x: 32, y: 26, width: 32, height: 28 })
  expect(derived.bounds).toEqual(sourceStage.grid)
  expect(await readPixels(coverage)).toEqual(derived)
  let originalArea = 0, derivedArea = 0, changed = 0, added = 0, protectedIndex = -1, core = 0
  for (let i = 0; i < sourceStage.width * sourceStage.height; i++) {
    const alpha = sourceStage.data[i * 4 + 3], next = derived.data[i * 4 + 3]
    originalArea += alpha; derivedArea += next
    if (alpha !== next) changed++
    if (alpha === 0 && next > 0) { added++; expect(next).toBeLessThan(255) }
    if (alpha === 255 && next > 0 && next < 255) protectedIndex = i
    if (alpha === 255 && next === 255) { core++; expect(derived.data.slice(i * 4, i * 4 + 4)).toEqual(sourceStage.data.slice(i * 4, i * 4 + 4)) }
  }
  expect(originalArea).toBe(input.selectedPixels * 255); expect(derivedArea).toBe(originalArea)
  expect(changed).toBeGreaterThan(10); expect(added).toBeGreaterThan(0); expect(core).toBeGreaterThan(100); expect(protectedIndex).toBeGreaterThanOrEqual(0)
  for (const scale of ['100', '200', '400']) {
    await panel.getByLabel('主体精修对照倍率', { exact: true }).selectOption(String(Number(scale) / 100))
    for (const target of [original, coverage, refined]) {
      expect(await target.evaluate((element: HTMLCanvasElement) => ({ width: element.width, height: element.height, ratio: element.getBoundingClientRect().width / element.width }))).toEqual({ width: 34, height: 30, ratio: Number(scale) / 100 })
      expect(JSON.parse((await target.getAttribute('data-source-grid'))!)).toEqual(sourceStage.grid)
    }
  }
  await expect(panel.locator('.image-subject-issues')).toContainText('轮廓外覆盖推断')
  await panel.getByText('实际变化与依据', { exact: true }).click()
  const metrics = panel.getByText('实际变化与依据', { exact: true }).locator('..')
  await expect(metrics).toContainText('轮廓外新增覆盖像素'); await expect(metrics).toContainText('总覆盖面积保持：是')
  expect(await metrics.innerText()).not.toMatch(/outerSupport|areaPreserved|captured-srgb|true|false/)
  await method.selectOption('subject-matte-v1')
  await expect(refined).toHaveCount(0); await expect(panel.getByRole('button', { name: '采用此主体精修', exact: true })).toBeDisabled()
  await panel.getByLabel('主体精修边带', { exact: true }).selectOption('2')
  await panel.getByRole('button', { name: '生成主体精修候选', exact: true }).click()
  await expect(panel.getByLabel('去混色阶段 · 派生结果', { exact: true })).toBeVisible()
  await method.selectOption('subject-contour-v1')
  await expect(panel.getByLabel('去混色阶段 · 派生结果', { exact: true })).toHaveCount(0)
  await expect(panel.getByLabel('主体精修边带', { exact: true })).toHaveValue('1')
  await panel.getByLabel('主体保护画笔半径', { exact: true }).fill('0.5')
  await panel.getByRole('button', { name: '保护主体描边', exact: true }).click()
  const sourceCanvas = dialog.getByLabel('图片标注画布', { exact: true }), gx = protectedIndex % sourceStage.width + sourceStage.grid.x, gy = Math.floor(protectedIndex / sourceStage.width) + sourceStage.grid.y
  await sourceCanvas.scrollIntoViewIfNeeded()
  const box = (await sourceCanvas.boundingBox())!
  await page.mouse.click(box.x + (gx + .1) * box.width / width, box.y + (gy + .1) * box.height / height)
  await expect(panel).toContainText('主体保护 · 1 个原图像素')
  await panel.getByRole('button', { name: '生成主体精修候选', exact: true }).click()
  const protectedPixels = await readPixels(refined)
  expect(protectedPixels.data.slice(protectedIndex * 4, protectedIndex * 4 + 4)).toEqual(sourceStage.data.slice(protectedIndex * 4, protectedIndex * 4 + 4))
  expect(await readPixels(coverage)).toEqual(protectedPixels)
  const readonly = await exportWork(page, dialog, info.outputPath('contour-readonly.sceneweave-image-work'))
  expect(readonly.state.draft.layers).toEqual(input.state.draft.layers)
  await panel.getByRole('button', { name: '采用此主体精修', exact: true }).click()
  const filename = info.outputPath('contour-adopted.sceneweave-image-work'), adopted = await exportWork(page, dialog, filename)
  expect(adopted.state.draft.layers[0].subjectRefinement).toMatchObject({ method: 'subject-contour-v1', bandPx: 1, strength: 'strong' })
  expect(adopted.state.draft.layers[0].selectionMask).toEqual(input.state.draft.layers[0].selectionMask)
  const context = await browser.newContext()
  try {
    const cold = await context.newPage(), coldDialog = await openWork(cold, filename), coldPanel = coldDialog.getByRole('region', { name: '主体边带精修', exact: true })
    await expect(coldPanel.getByLabel('主体精修方式', { exact: true })).toHaveValue('subject-contour-v1')
    await coldPanel.getByRole('button', { name: '生成主体精修候选', exact: true }).click()
    expect(await readPixels(coldPanel.getByLabel('轮廓派生结果 · 尚未去混色', { exact: true }))).toEqual(protectedPixels)
    await coldPanel.getByRole('button', { name: '恢复原始裁片', exact: true }).click()
    const restored = await exportWork(cold, coldDialog, info.outputPath('contour-cold-restored.sceneweave-image-work'))
    expect(restored.state.draft.layers).toEqual(input.state.draft.layers)
    expect(restored.original).toEqual(input.bytes); expect(restored.normalized).toEqual(input.bytes)
  } finally { await context.close() }
})

test('a real pointer stroke protects black subject outlines, supports erasing and cancellation, and survives adoption and a cold work-package read', async ({ page, browser }, info) => {
  test.setTimeout(180000)
  const input = await fixture(true)
  const dialog = await openWork(page, { name: 'black-outline.sceneweave-image-work', mimeType: 'application/octet-stream', buffer: Buffer.from(await writeImageWorkPackage(input.state, input.bytes, input.bytes)) })
  const panel = dialog.getByRole('region', { name: '主体边带精修', exact: true }), canvas = dialog.getByLabel('图片标注画布', { exact: true })
  const refined = panel.getByLabel('去混色阶段 · 派生结果', { exact: true }), original = panel.getByLabel('原始裁片 · 未精修', { exact: true }), coverage = panel.getByLabel('覆盖度阶段 · 仅调整透明度', { exact: true })
  await panel.getByLabel('主体精修方式', { exact: true }).selectOption('subject-matte-v1')
  await panel.getByLabel('主体精修强度', { exact: true }).selectOption('strong')
  await panel.getByRole('button', { name: '生成主体精修候选', exact: true }).click()
  await expect(refined).toBeVisible()
  await panel.getByLabel('主体保护画笔半径', { exact: true }).fill('0.5')
  const stroke = async (from: { x: number; y: number }, to: { x: number; y: number }) => {
    await canvas.scrollIntoViewIfNeeded()
    const bounds = (await canvas.boundingBox())!, sx = bounds.width / width, sy = bounds.height / height
    await page.mouse.move(bounds.x + (from.x + .1) * sx, bounds.y + (from.y + .1) * sy)
    await page.mouse.down()
    await page.mouse.move(bounds.x + (to.x + .1) * sx, bounds.y + (to.y + .1) * sy, { steps: 4 })
    await page.mouse.up()
  }
  await panel.getByRole('button', { name: '保护主体描边', exact: true }).click()
  expect(JSON.parse((await canvas.getAttribute('data-neighborhood-bounds'))!)).toEqual({ x: 32, y: 26, width: 32, height: 28 })
  await stroke({ x: 32, y: 38 }, { x: 32, y: 40 })
  await expect(panel).toContainText('主体保护 · 3 个原图像素')
  const cancelBounds = (await canvas.boundingBox())!
  await page.mouse.move(cancelBounds.x + 40.1 * cancelBounds.width / width, cancelBounds.y + 26.1 * cancelBounds.height / height)
  await page.mouse.down()
  await canvas.dispatchEvent('pointercancel', { pointerId: 1 })
  await page.mouse.up()
  await expect(panel).toContainText('主体保护 · 3 个原图像素')
  await expect(refined).toHaveCount(0)
  await expect(panel.getByRole('button', { name: '采用此主体精修', exact: true })).toBeDisabled()
  const marked = await pixel(canvas, 32, 39)
  expect(marked[0]).toBeGreaterThan(100); expect(marked[1]).toBeGreaterThan(100)
  await panel.getByRole('button', { name: '擦除主体保护', exact: true }).click()
  await stroke({ x: 32, y: 38 }, { x: 32, y: 38 })
  await expect(panel).toContainText('主体保护 · 2 个原图像素')
  await panel.getByRole('button', { name: '保护主体描边', exact: true }).click()
  await stroke({ x: 32, y: 38 }, { x: 32, y: 38 })
  await expect(panel).toContainText('主体保护 · 3 个原图像素')
  const beforeAdoption = await exportWork(page, dialog, info.outputPath('brush-readonly.sceneweave-image-work'))
  expect(beforeAdoption.state.draft.layers).toEqual(input.state.draft.layers)
  expect(beforeAdoption.state.journal).toEqual([])
  await panel.getByRole('button', { name: '结束主体保护画笔', exact: true }).click()
  await panel.getByRole('button', { name: '生成主体精修候选', exact: true }).click()
  for (let y = 12; y <= 14; y++) {
    const captured = await pixel(original, 0, y)
    expect(captured).toEqual([12, 14, 19, 255])
    expect(await pixel(coverage, 0, y)).toEqual(captured)
    expect(await pixel(refined, 0, y)).toEqual(captured)
  }
  await panel.getByRole('button', { name: '采用此主体精修', exact: true }).click()
  const filename = info.outputPath('brush-adopted.sceneweave-image-work'), adopted = await exportWork(page, dialog, filename)
  const mask = adopted.state.draft.layers[0].subjectRefinement!.foregroundProtectionMask!
  expect(mask.runs.every((value, index) => index % 2 === 0 || value === 0 || value === 255)).toBe(true)
  expect(mask.x).toBeLessThanOrEqual(32); expect(mask.y).toBeLessThanOrEqual(38)
  const { subjectRefinement, ...sameOriginal } = adopted.state.draft.layers[0]
  expect(sameOriginal).toEqual(input.state.draft.layers[0]); expect(adopted.state.journal.at(-1)?.action).toBe('adopt-subject-refinement')
  await panel.getByRole('button', { name: '清空主体保护', exact: true }).click()
  await expect(panel).toContainText('主体保护 · 0 个原图像素')
  await panel.getByRole('button', { name: '取消本次保护修改', exact: true }).click()
  await expect(panel).toContainText('主体保护 · 3 个原图像素')
  await expect(panel.getByLabel('主体精修强度', { exact: true })).toHaveValue('strong')
  const context = await browser.newContext()
  try {
    const cold = await context.newPage(), coldDialog = await openWork(cold, filename), coldPanel = coldDialog.getByRole('region', { name: '主体边带精修', exact: true })
    await expect(coldPanel).toContainText('主体保护 · 3 个原图像素')
    await coldPanel.getByRole('button', { name: '生成主体精修候选', exact: true }).click()
    expect(await pixel(coldPanel.getByLabel('去混色阶段 · 派生结果', { exact: true }), 0, 13)).toEqual([12, 14, 19, 255])
    const coldExport = await exportWork(cold, coldDialog, info.outputPath('brush-cold.sceneweave-image-work'))
    expect(coldExport.state.draft.layers).toEqual(adopted.state.draft.layers)
    expect(coldExport.original).toEqual(input.bytes); expect(coldExport.normalized).toEqual(input.bytes)
  } finally { await context.close() }
})

test('partial saved, guided and polygon coverage defaults to matte without replacing alpha or adopting a candidate', async ({ browser }, info) => {
  test.setTimeout(180000)
  for (const kind of ['saved', 'guided', 'polygon', 'transparent-source'] as const) {
    const input = await fixture(), layer = input.state.draft.layers[0]
    const decoded = PNG.sync.read(Buffer.from(input.bytes)), source = { width, height, data: new Uint8ClampedArray(decoded.data) }
    if (kind === 'saved') {
      const data = new Uint8Array(32 * 28).fill(255)
      for (let y = 0; y < 28; y++) for (let x = 0; x < 32; x++) if (!x || !y || x === 31 || y === 27) data[y * 32 + x] = 128
      layer.selectionMask = encodeSelectionMask({ width: 32, height: 28, boundsPx: { x: 32, y: 26, width: 32, height: 28 }, data })
    } else if (kind === 'guided') {
      delete layer.selectionMask
      layer.polygon = rectangle(27, 21, 42, 38)
      layer.guidedSelection = { bounds: { x: 27, y: 21, width: 42, height: 38 }, boundaryPx: layer.polygon, algorithmVersion: 2, edgeCoverage: 'boundary', edgeRadiusPx: 1,
        foreground: [{ points: [{ x: 44.5, y: 38.5 }], radiusPx: 1 }], background: [{ points: [{ x: 28.5, y: 22.5 }], radiusPx: 1 }] }
    } else if (kind === 'polygon') {
      delete layer.selectionMask
      layer.polygon = [{ x: 32.25, y: 26.25 }, { x: 63.25, y: 27.25 }, { x: 61.75, y: 53.25 }, { x: 32.25, y: 51.75 }]
    } else {
      source.data[(39 * width + 48) * 4 + 3] = 128
      decoded.data.set(source.data)
      input.bytes = new Uint8Array(PNG.sync.write(decoded))
      const hash = sha256Bytes(input.bytes)
      input.state.image.sha256 = hash; input.state.original.sha256 = hash; input.state.original.sizeBytes = input.bytes.length
    }
    const mask = layer.selectionMask ? decodeSelectionMask(layer.selectionMask, source)
      : layer.guidedSelection ? guidedImageSelection(source, layer.guidedSelection).mask : imagePolygonMask(source, layer.polygon)
    if (kind !== 'transparent-source') expect(mask.data.some(alpha => alpha > 0 && alpha < 255)).toBe(true)
    const context = await browser.newContext()
    try {
      const page = await context.newPage(), dialog = await openWork(page, { name: `${kind}.sceneweave-image-work`, mimeType: 'application/octet-stream', buffer: Buffer.from(await writeImageWorkPackage(input.state, input.bytes, input.bytes)) })
      const panel = dialog.getByRole('region', { name: '主体边带精修', exact: true }), method = panel.getByLabel('主体精修方式', { exact: true })
      await expect(method).toHaveValue('subject-matte-v1')
      await expect(panel).toContainText(kind === 'transparent-source' ? '选中原图像素含透明度' : '当前选区已有半透明覆盖')
      await expect(panel).toContainText('默认使用颜色混合估计')
      await panel.getByRole('button', { name: '生成主体精修候选', exact: true }).click()
      const original = panel.getByLabel('原始裁片 · 未精修', { exact: true })
      await expect(original).toBeVisible(); await expect(panel.getByLabel('覆盖度阶段 · 仅调整透明度', { exact: true })).toBeVisible(); await expect(panel.getByLabel('去混色阶段 · 派生结果', { exact: true })).toBeVisible()
      const actual = await original.evaluate((element: HTMLCanvasElement) => Array.from(element.getContext('2d')!.getImageData(0, 0, element.width, element.height).data).filter((_, index) => index % 4 === 3))
      const expected = Array.from(mask.data, (alpha, index) => Math.round(alpha * source.data[((mask.boundsPx.y + Math.floor(index / mask.width)) * width + mask.boundsPx.x + index % mask.width) * 4 + 3] / 255))
      expect(actual).toEqual(expected)
      expect(actual.some(alpha => alpha > 0 && alpha < 255)).toBe(true)
      const readonly = await exportWork(page, dialog, info.outputPath(`${kind}-readonly.sceneweave-image-work`))
      expect(readonly.state.draft.layers).toEqual(input.state.draft.layers); expect(readonly.state.journal).toEqual([])
      expect(readonly.original).toEqual(input.bytes); expect(readonly.normalized).toEqual(input.bytes)
      await method.selectOption('subject-contour-v1')
      await expect(panel.getByRole('button', { name: '采用此主体精修', exact: true })).toBeDisabled()
      await panel.getByRole('button', { name: '生成主体精修候选', exact: true }).click()
      await expect(panel.getByRole('alert')).toContainText(kind === 'transparent-source' ? '不透明' : '二值')
      await expect(method).toHaveValue('subject-contour-v1')
      const rejected = await exportWork(page, dialog, info.outputPath(`${kind}-rejected.sceneweave-image-work`))
      expect(rejected.state.draft.layers).toEqual(input.state.draft.layers); expect(rejected.state.journal).toEqual([])
    } finally { await context.close() }
  }
})
