import { test, expect, type Locator } from '@playwright/test'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { writeImageWorkPackage, readImageWorkPackage, type ImageWorkState } from '../src/shared/image-import/workflow'
import { sha256Bytes } from '../src/shared/project/binary'
const { PNG } = createRequire(import.meta.url)('../node_modules/playwright-core/lib/utilsBundle.js')
const width = 96, height = 80
const rectangle = (x: number, y: number, w: number, h: number) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }]
async function points(dialog: Locator, tool: string, values: { x: number; y: number }[]) {
  await dialog.getByRole('button', { name: tool, exact: true }).click()
  const canvas = dialog.getByLabel('图片标注画布', { exact: true }), box = await canvas.boundingBox()
  if (!box) throw new Error('Missing canvas')
  for (const value of values) await canvas.click({ position: { x: value.x / width * box.width, y: value.y / height * box.height } })
}
test('shared material geometry, evidence exclusions and explicit extraction source survive page editing and empty-storage resume', async ({ page, browser }, info) => {
  test.setTimeout(180000)
  const png = new PNG({ width, height })
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) png.data.set(x >= 40 && x < 50 && y >= 30 && y < 42 ? [25, 32, 40, 255] : [90 + x % 3, 120 + y % 3, 135, 255], (y * width + x) * 4)
  const bytes = new Uint8Array(PNG.sync.write(png)), hash = sha256Bytes(bytes)
  const state: ImageWorkState = { format: 'sceneweave-image-work', version: 1, id: 'shared-surface-ui', revision: 1,
    image: { sha256: hash, pixelWidth: width, pixelHeight: height }, original: { name: 'source.png', sha256: hash, sizeBytes: bytes.length, mimeType: 'image/png' },
    draft: { title: '共用材质与原图来源', calibration: { first: { x: 0, y: 0 }, second: { x: 50, y: 0 }, distanceMm: 1000 }, roomPointsPx: rectangle(3, 3, 90, 74), layers: [] },
    active: { name: '测试椅', polygon: rectangle(40, 30, 10, 12), donor: [{ x: 8, y: 8 }, { x: 28, y: 25 }], renderLayer: 'object', blocksMovement: true, appearanceSource: 'original', selectionMask: { x: 40, y: 30, width: 10, height: 12, runs: [120, 255] } },
    rights: { licenseText: 'Synthetic original test pixels', attribution: 'Synthetic test', canEmbed: true }, notes: '', nextAction: '建立共用底材', scaleStatus: 'provisional', journal: [], reviews: [] }
  await page.goto('/')
  await page.getByRole('button', { name: '从图片新建场景', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '图片导入工作台', exact: true })
  await dialog.getByLabel('打开图片制作工作包', { exact: true }).setInputFiles({ name: 'surface.sceneweave-image-work', mimeType: 'application/octet-stream', buffer: Buffer.from(await writeImageWorkPackage(state, bytes, bytes)) })
  await expect(dialog.getByLabel('裁片来源', { exact: true })).toHaveValue('original')
  await dialog.locator('details.image-import-fill-settings > summary').click()
  await points(dialog, '画补底分区', [{ x: 5, y: 5 }, { x: 90, y: 8 }, { x: 90, y: 73 }, { x: 5, y: 73 }])
  await points(dialog, '分区取样', [{ x: 8, y: 10 }, { x: 28, y: 25 }])
  await points(dialog, '画保护范围', rectangle(70, 40, 8, 8))
  await dialog.getByLabel('共用底材名称', { exact: true }).fill('蓝色织物')
  await dialog.getByRole('button', { name: '保存为共用底材表面', exact: true }).click()
  const surface = dialog.getByRole('group', { name: '底材表面 蓝色织物', exact: true })
  await expect(surface).toContainText('已有取证排除')
  await dialog.getByRole('button', { name: '拆出物件并补底', exact: true }).click()
  await expect(dialog).toContainText('已拆出原始像素')
  if (await dialog.locator('details.image-import-fill-settings').getAttribute('open') === null) await dialog.locator('details.image-import-fill-settings > summary').click()
  await surface.getByRole('button', { name: '删除表面', exact: true }).click()
  await expect(dialog.getByRole('alert').filter({ hasText: '已有物件正在使用此表面' })).toBeVisible()
  const download = page.waitForEvent('download')
  await dialog.getByRole('button', { name: '导出制作工作包', exact: true }).click()
  const filename = info.outputPath('surface.sceneweave-image-work'); await (await download).saveAs(filename)
  const saved = await readImageWorkPackage(new Uint8Array(await readFile(filename)))
  expect(saved.state.draft.repairSurfaces).toHaveLength(1)
  expect(saved.state.draft.repairSurfaces![0].excludedEvidenceMask).toMatchObject({ x: 70, y: 40, width: 8, height: 8 })
  expect(saved.state.draft.layers[0]).toMatchObject({ appearanceSource: 'original', repair: 'surfaces', repairSurfaceIds: [saved.state.draft.repairSurfaces![0].id] })
  const context = await browser.newContext()
  try {
    const cold = await context.newPage(); await cold.goto('/')
    await cold.getByRole('button', { name: '从图片新建场景', exact: true }).click()
    const restored = cold.getByRole('dialog', { name: '图片导入工作台', exact: true })
    await restored.getByLabel('打开图片制作工作包', { exact: true }).setInputFiles(filename)
    await expect(restored.getByRole('button', { name: '分析测试椅补底与邻域', exact: true })).toBeEnabled()
    await restored.getByRole('group', { name: '图片导入阶段', exact: true }).getByRole('button', { name: '物件与补底', exact: true }).click()
    await restored.getByLabel('绘制位置', { exact: true }).selectOption('ground')
    await expect(restored.getByLabel('裁片来源', { exact: true })).toHaveValue('working')
    const exported = cold.waitForEvent('download'); await restored.getByRole('button', { name: '导出制作工作包', exact: true }).click()
    const coldFile = info.outputPath('cold.sceneweave-image-work'); await (await exported).saveAs(coldFile)
    const back = await readImageWorkPackage(new Uint8Array(await readFile(coldFile)))
    expect(back.state.draft.repairSurfaces).toEqual(saved.state.draft.repairSurfaces)
    expect(back.state.draft.layers).toEqual(saved.state.draft.layers)
  } finally { await context.close() }
})
