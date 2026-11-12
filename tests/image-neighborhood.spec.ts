import { test, expect, type Locator } from '@playwright/test'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { writeImageWorkPackage, readImageWorkPackage, type ImageWorkState } from '../src/shared/image-import/workflow'
import { sha256Bytes } from '../src/shared/project/binary'

const { PNG } = createRequire(import.meta.url)('../node_modules/playwright-core/lib/utilsBundle.js')
const width = 320, height = 240
const rectangle = (x: number, y: number, w: number, h: number) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }]

async function fixture() {
  const png = new PNG({ width, height })
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const object = x >= 210 && x < 236 && y >= 120 && y < 148 || x >= 265 && x < 283 && y >= 80 && y < 100
    const seam = x % 24 < 2 ? -35 : 0, grain = ((x * 7 + y * 3) % 7) - 3
    png.data.set(object ? [20, 25, 30, 255] : [151 + seam + grain, 118 + seam + grain, 85 + seam + grain, 255], (y * width + x) * 4)
  }
  const bytes = new Uint8Array(PNG.sync.write(png)), hash = sha256Bytes(bytes)
  const state: ImageWorkState = {
    format: 'sceneweave-image-work', version: 1, id: 'neighborhood-ui', revision: 1,
    image: { sha256: hash, pixelWidth: width, pixelHeight: height }, original: { name: 'wood-floor.png', sha256: hash, sizeBytes: bytes.length, mimeType: 'image/png' },
    draft: { title: '邻域解释与人工辅助', calibration: { first: { x: 0, y: 0 }, second: { x: 50, y: 0 }, distanceMm: 1000 }, roomPointsPx: rectangle(3, 3, 314, 234),
      repairSurfaces: [{ id: 'wood', name: '木板地面', kind: 'planks', mask: { x: 8, y: 8, width: 304, height: 224, runs: [68096, 255] }, donor: { x: 32, y: 32, width: 48, height: 48 } }],
      layers: [
        { id: 'chair', name: '椅子', polygon: rectangle(210, 120, 26, 28), donor: { x: 32, y: 32, width: 48, height: 48 }, renderLayer: 'object', blocksMovement: true, appearanceSource: 'original', repair: 'surfaces', repairSurfaceIds: ['wood'], selectionMask: { x: 210, y: 120, width: 26, height: 28, runs: [728, 255] } },
        { id: 'desk', name: '小桌', polygon: rectangle(265, 80, 18, 20), donor: { x: 32, y: 32, width: 48, height: 48 }, renderLayer: 'object', blocksMovement: true, appearanceSource: 'original', repair: 'surfaces', repairSurfaceIds: ['wood'], selectionMask: { x: 265, y: 80, width: 18, height: 20, runs: [360, 255] } },
      ] },
    rights: { licenseText: 'Synthetic original test pixels', attribution: 'Synthetic test', canEmbed: true }, notes: '', nextAction: '审阅同组候选与局部冲突', scaleStatus: 'provisional', journal: [], reviews: [],
  }
  return { bytes, state, data: png.data as Uint8Array }
}

async function openWork(page: import('@playwright/test').Page, file: string | { name: string; mimeType: string; buffer: Buffer }) {
  await page.goto('/')
  await page.getByRole('button', { name: '从图片新建场景', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '图片导入工作台', exact: true })
  await dialog.getByLabel('打开图片制作工作包', { exact: true }).setInputFiles(file)
  await expect(dialog.getByRole('button', { name: '分析椅子补底与邻域', exact: true })).toBeEnabled()
  return dialog
}

async function analyze(dialog: Locator) {
  await dialog.getByRole('button', { name: '分析椅子补底与邻域', exact: true }).click()
  const report = dialog.getByRole('region', { name: '补底与邻域分析', exact: true })
  await expect(report).toBeVisible()
  return report
}

test('nearby material reasoning uses actual pixels, locates conflicts, preserves drafts, invalidates changes and recomputes after cold resume', async ({ page, browser }, info) => {
  test.setTimeout(180000)
  const input = await fixture()
  const dialog = await openWork(page, { name: 'neighbors.sceneweave-image-work', mimeType: 'application/octet-stream', buffer: Buffer.from(await writeImageWorkPackage(input.state, input.bytes, input.bytes)) })
  await dialog.getByRole('group', { name: '图片导入阶段', exact: true }).getByRole('button', { name: '物件与补底', exact: true }).click()
  await dialog.locator('details.image-import-fill-settings > summary').click()
  await dialog.getByLabel('底材类型', { exact: true }).selectOption('neighbors-planks')
  const surface = dialog.getByRole('group', { name: '底材表面 木板地面', exact: true })
  await surface.getByRole('button', { name: '改为所选底材类型', exact: true }).click()
  await expect(surface).toContainText('同组邻域 · 木板结构')
  const report = await analyze(dialog)
  await expect(report).toContainText('这块为什么合适')
  await expect(report).toContainText('与周围的冲突')
  const targetPatch = report.getByLabel('小块1当前补底', { exact: true })
  const repaired = await targetPatch.evaluate((canvas: HTMLCanvasElement) => Array.from(canvas.getContext('2d')!.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data))
  expect(repaired.slice(0, 3)).not.toEqual([20, 25, 30])
  const reference = report.getByLabel('小块1同组参考1', { exact: true })
  const originalPatch = await reference.evaluate((canvas: HTMLCanvasElement) => ({ width: canvas.width, cssWidth: canvas.getBoundingClientRect().width, rgba: Array.from(canvas.getContext('2d')!.getImageData(0, 0, 1, 1).data) }))
  expect(originalPatch.cssWidth).toBe(originalPatch.width * 4)
  expect(originalPatch.rgba[3]).toBe(255)
  expect(originalPatch.rgba.slice(0, 3)).not.toEqual([20, 25, 30])
  const sourceBounds = JSON.parse((await reference.getAttribute('data-source-bounds'))!)
  const sourceAt = (sourceBounds.y * width + sourceBounds.x) * 4
  expect(originalPatch.rgba).toEqual(Array.from(input.data.subarray(sourceAt, sourceAt + 4)))
  const reasonText = await report.innerText()
  await report.getByRole('button', { name: '定位当前小块', exact: true }).first().click()
  const mainCanvas = dialog.getByLabel('图片标注画布', { exact: true })
  const bounds = JSON.parse((await mainCanvas.getAttribute('data-neighborhood-bounds'))!)
  expect(bounds.x).toBeGreaterThanOrEqual(210)
  expect(bounds.y).toBeGreaterThanOrEqual(120)
  await expect(dialog.getByLabel('图片缩放', { exact: true })).toHaveValue('400')
  await expect.poll(() => dialog.locator('.image-import-canvas').evaluate(element => element.scrollLeft)).toBeGreaterThan(0)
  const rawPatch = await targetPatch.evaluate((canvas: HTMLCanvasElement) => Array.from(canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data))
  const located = await mainCanvas.evaluate((canvas: HTMLCanvasElement, { b, expected }) => {
    const pixels = canvas.getContext('2d')!.getImageData(b.x, b.y, b.width, b.height).data
    let differences = 0
    for (let index = 0; index < pixels.length; index++) if (pixels[index] !== expected[index]) differences++
    return differences
  }, { b: bounds, expected: rawPatch })
  expect(located).toBeGreaterThan(0)
  await page.screenshot({ path: info.outputPath('neighborhood-review.png') })
  const conflicts = report.getByRole('button', { name: '定位冲突区域', exact: true })
  expect(await conflicts.count()).toBeGreaterThan(0)
  await conflicts.first().click()
  await expect(dialog.getByLabel('邻域定位范围', { exact: true })).toBeVisible()
  const assistance = report.locator('.image-neighborhood-conflicts > details').first().getByRole('button').last()
  const assistanceName = await assistance.innerText()
  await assistance.click()
  const toolName = assistanceName.includes('不可信') ? '画保护范围' : assistanceName.includes('底材范围') ? '画补底分区' : '分区取样'
  await expect(dialog.getByRole('button', { name: toolName, exact: true })).toHaveAttribute('aria-pressed', 'true')
  await report.getByRole('button', { name: '以此处为起点重新取样', exact: true }).first().click()
  await expect(dialog.getByRole('button', { name: '分区取样', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(dialog).toContainText('尚未采用')
  await dialog.getByRole('group', { name: '图片导入阶段', exact: true }).getByRole('button', { name: '物件与补底', exact: true }).click()
  await expect(dialog.getByLabel('底材类型', { exact: true }).locator('option[value="neighbors-soft"]')).toHaveCount(1)
  await expect(dialog.getByLabel('底材类型', { exact: true }).locator('option[value="neighbors-planks"]')).toHaveCount(1)
  // A real sample edit invalidates the report, and applying it uses the normal replay path.
  await dialog.getByLabel('图片缩放', { exact: true }).selectOption('fit')
  const canvasBox = await mainCanvas.boundingBox()
  if (!canvasBox) throw new Error('Missing source canvas')
  await mainCanvas.click({ position: { x: 32 / width * canvasBox.width, y: 32 / height * canvasBox.height } })
  await expect(report).toHaveCount(0)
  await mainCanvas.click({ position: { x: 80 / width * canvasBox.width, y: 80 / height * canvasBox.height } })
  await surface.getByRole('button', { name: '仅更新干净取样', exact: true }).click()
  await expect(dialog).toContainText('已更新补底表面并重放物件')
  expect(await (await analyze(dialog)).innerText()).toBe(reasonText)
  // A draft change hides the report and cannot be discarded by analyzing another item.
  await dialog.getByRole('button', { name: '精修椅子轮廓', exact: true }).click()
  await expect(report).toHaveCount(0)
  const name = dialog.locator('[data-import-target="current-object"]')
  await name.fill('椅子未应用修正')
  await dialog.getByRole('button', { name: '分析小桌补底与邻域', exact: true }).click()
  await expect(name).toHaveValue('椅子未应用修正')
  await expect(dialog).toContainText('当前标注已保留')
  await dialog.getByRole('button', { name: '取消当前物件标注', exact: true }).click()
  await analyze(dialog)
  const downloading = page.waitForEvent('download')
  await dialog.getByRole('button', { name: '导出制作工作包', exact: true }).click()
  const filename = info.outputPath('neighbors.sceneweave-image-work'); await (await downloading).saveAs(filename)
  const saved = await readImageWorkPackage(new Uint8Array(await readFile(filename)))
  expect(saved.state.draft.repairSurfaces).toEqual(input.state.draft.repairSurfaces!.map(surface => ({ ...surface, kind: 'neighbors-planks' })))
  expect(saved.state.draft.layers).toEqual(input.state.draft.layers)
  expect(JSON.stringify(saved.state)).not.toContain('neighborhood-surface-v1')
  const context = await browser.newContext()
  try {
    const cold = await context.newPage(), restored = await openWork(cold, filename)
    await expect(restored.getByRole('region', { name: '补底与邻域分析', exact: true })).toHaveCount(0)
    const repeated = await analyze(restored)
    expect(await repeated.innerText()).toBe(reasonText)
    const repeatedPixels = await repeated.getByLabel('小块1当前补底', { exact: true }).evaluate((canvas: HTMLCanvasElement) => Array.from(canvas.getContext('2d')!.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data))
    expect(repeatedPixels).toEqual(repaired)
  } finally { await context.close() }
})
