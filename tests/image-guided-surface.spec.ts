import { test, expect, type Page } from '@playwright/test'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { writeImageWorkPackage, readImageWorkPackage, type ImageWorkState } from '../src/shared/image-import/workflow'
import { sha256Bytes } from '../src/shared/project/binary'

const { PNG } = createRequire(import.meta.url)('../node_modules/playwright-core/lib/utilsBundle.js')
const width = 128, height = 96
const rectangle = (x: number, y: number, w: number, h: number) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }]
const initialGuidance = { orientation: 'soft' as const, guides: [] }
const guidance = { orientation: 'soft', guides: [{ points: [{ x: 52, y: 49 }, { x: 76, y: 49 }], reference: { x: 10, y: 46, width: 16, height: 7 }, axis: 'horizontal', reason: '左侧可见单条窄缝，人工推断它在椅子遮挡内水平延伸。' }] }

async function fixture() {
  const png = new PNG({ width, height })
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const object = x >= 52 && x < 76 && y >= 40 && y < 60, ink = y === 49 ? -54 : 0
    png.data.set(object ? [22, 28, 33, 255] : [156 + ink + x % 3, 125 + ink + x % 3, 93 + ink + x % 3, 255], (y * width + x) * 4)
  }
  const bytes = new Uint8Array(PNG.sync.write(png)), hash = sha256Bytes(bytes)
  const state: ImageWorkState = { format: 'sceneweave-image-work', version: 1, id: 'guided-surface-ui', revision: 1,
    image: { sha256: hash, pixelWidth: width, pixelHeight: height }, original: { name: 'wood.png', sha256: hash, sizeBytes: bytes.length, mimeType: 'image/png' },
    draft: { title: '结构辅助底材', calibration: { first: { x: 0, y: 0 }, second: { x: 50, y: 0 }, distanceMm: 1000 }, roomPointsPx: rectangle(3, 3, 122, 90),
      repairSurfaces: [{ id: 'wood', name: '木板表面', kind: 'guided', mask: { x: 4, y: 4, width: 120, height: 88, runs: [10560, 255] }, donor: { x: 8, y: 8, width: 20, height: 20 }, guided: initialGuidance }],
      layers: [{ id: 'chair', name: '椅子', polygon: rectangle(52, 40, 24, 20), donor: { x: 8, y: 8, width: 20, height: 20 }, renderLayer: 'object', blocksMovement: true, repair: 'surfaces', repairSurfaceIds: ['wood'], appearanceSource: 'original', selectionMask: { x: 52, y: 40, width: 24, height: 20, runs: [480, 255] } }] },
    rights: { licenseText: 'Synthetic original test pixels', attribution: 'Synthetic test', canEmbed: true }, notes: '', nextAction: '添加显式结构辅助并检查', scaleStatus: 'provisional', journal: [], reviews: [] }
  return { bytes, state }
}
async function openWork(page: Page, file: string | { name: string; mimeType: string; buffer: Buffer }) {
  await page.goto('/')
  await page.getByRole('button', { name: '从图片新建场景', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '图片导入工作台', exact: true })
  await dialog.getByLabel('打开图片制作工作包', { exact: true }).setInputFiles(file)
  await expect(dialog.getByRole('button', { name: '分析椅子补底与邻域', exact: true })).toBeEnabled()
  await dialog.getByRole('group', { name: '图片导入阶段', exact: true }).getByRole('button', { name: '物件与补底', exact: true }).click()
  await dialog.locator('details.image-import-fill-settings > summary').click()
  return dialog
}

test('explicit structure JSON survives atomic replay, rejected references and cold work-package restoration', async ({ page, browser }, info) => {
  test.setTimeout(180000)
  const input = await fixture()
  const dialog = await openWork(page, { name: 'guided.sceneweave-image-work', mimeType: 'application/octet-stream', buffer: Buffer.from(await writeImageWorkPackage(input.state, input.bytes, input.bytes)) })
  const surface = dialog.getByRole('group', { name: '底材表面 木板表面', exact: true })
  await surface.getByRole('button', { name: '载入结构辅助到编辑框', exact: true }).click()
  const json = dialog.getByLabel('结构辅助JSON', { exact: true })
  expect(JSON.parse(await json.inputValue())).toEqual(initialGuidance)
  await dialog.getByLabel('载入结构辅助JSON', { exact: true }).setInputFiles({ name: 'guide.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(guidance)) })
  expect(JSON.parse(await json.inputValue())).toEqual(guidance)
  await surface.getByRole('button', { name: '应用结构辅助并重放', exact: true }).click()
  await expect(surface).toContainText('左侧可见单条窄缝')
  await expect(surface).toContainText('已采用结构辅助 · soft · 1条')
  await dialog.getByRole('button', { name: '分析椅子补底与邻域', exact: true }).click()
  const report = dialog.getByRole('region', { name: '补底与邻域分析', exact: true })
  await expect(report).toContainText('改变隐藏区域的推断结构')
  const main = dialog.getByLabel('图片标注画布', { exact: true })
  const rgba = (x: number, y: number) => main.evaluate((canvas: HTMLCanvasElement, { x, y }) => Array.from(canvas.getContext('2d')!.getImageData(x, y, 1, 1).data), { x, y })
  const line = await rgba(64, 49), floor = await rgba(64, 54)
  expect(line[0]).toBeLessThan(floor[0] - 20)
  const downloading = page.waitForEvent('download')
  await dialog.getByRole('button', { name: '导出制作工作包', exact: true }).click()
  const filename = info.outputPath('guided.sceneweave-image-work'); await (await downloading).saveAs(filename)
  const saved = await readImageWorkPackage(new Uint8Array(await readFile(filename)))
  expect(saved.state.version).toBe(1)
  expect(saved.state.draft.repairSurfaces![0].guided).toEqual(guidance)
  // Editing a proposed JSON invalidates the old report; a bad reference cannot replace the surface.
  const invalid = { ...guidance, guides: [{ ...guidance.guides[0], reference: { x: 56, y: 46, width: 16, height: 7 } }] }
  await json.fill(JSON.stringify(invalid))
  await expect(report).toHaveCount(0)
  await surface.getByRole('button', { name: '应用结构辅助并重放', exact: true }).click()
  await expect(dialog.getByRole('alert').filter({ hasText: '结构参考' })).toBeVisible()
  await surface.getByRole('button', { name: '载入结构辅助到编辑框', exact: true }).click()
  expect(JSON.parse(await json.inputValue())).toEqual(guidance)
  await dialog.getByRole('button', { name: '分析椅子补底与邻域', exact: true }).click()
  expect(await rgba(64, 49)).toEqual(line)
  await report.getByRole('heading', { name: '椅子 · 补底与邻域', exact: true }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: info.outputPath('guided-structure-review.png') })
  await dialog.getByRole('group', { name: '图片预览方式', exact: true }).getByRole('button', { name: '原图', exact: true }).click()
  await json.scrollIntoViewIfNeeded()
  await page.screenshot({ path: info.outputPath('guided-structure-json-and-source.png') })
  const context = await browser.newContext()
  try {
    const cold = await context.newPage(), restored = await openWork(cold, filename)
    const coldSurface = restored.getByRole('group', { name: '底材表面 木板表面', exact: true })
    await coldSurface.getByRole('button', { name: '载入结构辅助到编辑框', exact: true }).click()
    expect(JSON.parse(await restored.getByLabel('结构辅助JSON', { exact: true }).inputValue())).toEqual(guidance)
    await restored.getByRole('button', { name: '分析椅子补底与邻域', exact: true }).click()
    await expect(restored.getByRole('region', { name: '补底与邻域分析', exact: true })).toContainText('改变隐藏区域的推断结构')
    const repeated = await restored.getByLabel('图片标注画布', { exact: true }).evaluate((canvas: HTMLCanvasElement) => Array.from(canvas.getContext('2d')!.getImageData(64, 49, 1, 1).data))
    expect(repeated).toEqual(line)
  } finally { await context.close() }
})
