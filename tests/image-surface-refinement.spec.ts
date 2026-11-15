import { test, expect, type Page, type Locator } from '@playwright/test'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { writeImageWorkPackage, readImageWorkPackage, type ImageWorkState } from '../src/shared/image-import/workflow'
import { sha256Bytes } from '../src/shared/project/binary'

const { PNG } = createRequire(import.meta.url)('../node_modules/playwright-core/lib/utilsBundle.js')
async function clothWork() {
  const width = 64, height = 64, png = new PNG({ width, height })
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) png.data.set([95 - (x > 26 && y > 26 ? 16 : 0), 119, 123, 255], (y * width + x) * 4)
  const bytes = new Uint8Array(PNG.sync.write(png)), hash = sha256Bytes(bytes)
  const selectionMask = { x: 10, y: 10, width: 40, height: 40, runs: [1600, 255] }
  const state: ImageWorkState = { format: 'sceneweave-image-work', version: 1, id: 'cloth-ui', revision: 1,
    image: { sha256: hash, pixelWidth: width, pixelHeight: height }, original: { name: 'cloth.png', sha256: hash, sizeBytes: bytes.length, mimeType: 'image/png' },
    rights: { attribution: 'Synthetic cloth', licenseText: 'Original synthetic test pixels; embedding permitted.', canEmbed: true },
    draft: { title: '净毯表面接续', calibration: { first: { x: 0, y: 0 }, second: { x: 50, y: 0 }, distanceMm: 1000 },
      roomPointsPx: [{ x: 2, y: 2 }, { x: 62, y: 2 }, { x: 62, y: 62 }, { x: 2, y: 62 }],
      repairSurfaces: [{ id: 'cloth-material', name: '布料', kind: 'soft', mask: selectionMask, donor: { x: 16, y: 16, width: 6, height: 6 } }],
      layers: [{ id: 'cloth', name: '蓝毯', renderLayer: 'ground', blocksMovement: false, selectionMask,
        polygon: [{ x: 10, y: 10 }, { x: 50, y: 10 }, { x: 50, y: 50 }, { x: 10, y: 50 }], donor: { x: 2, y: 2, width: 6, height: 6 },
        surfaceRefinement: { method: 'cloth-surface-v1', materialSurfaceId: 'cloth-material', donor: { x: 16, y: 16, width: 6, height: 6 },
          seed: 3, reason: 'Synthetic cloth shadow; inferred interior appearance.', strokes: [] } }] },
    notes: '', nextAction: '保留配方并复查原表面恢复', scaleStatus: 'provisional', journal: [], reviews: [] }
  return { state, archive: await writeImageWorkPackage(state, bytes, bytes) }
}
async function open(page: Page, file: { name: string; mimeType: string; buffer: Buffer }) {
  await page.goto('/')
  await page.getByRole('button', { name: '从图片新建场景', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '图片导入工作台', exact: true })
  await dialog.getByLabel('打开图片制作工作包', { exact: true }).setInputFiles(file)
  await expect(dialog.getByRole('button', { name: '恢复蓝毯原始表面', exact: true })).toBeEnabled()
  return dialog
}
async function exported(page: Page, dialog: Locator, filename: string) {
  const downloading = page.waitForEvent('download')
  await dialog.getByRole('button', { name: '导出制作工作包', exact: true }).click()
  await (await downloading).saveAs(filename)
  return readImageWorkPackage(new Uint8Array(await readFile(filename)))
}
test('cloth work survives ordinary item edits and a fresh page, and can restore its original surface independently', async ({ page, browser }, info) => {
  test.setTimeout(120000)
  const { state, archive } = await clothWork()
  const dialog = await open(page, { name: 'cloth.sceneweave-image-work', mimeType: 'application/zip', buffer: Buffer.from(archive) })
  await dialog.getByRole('button', { name: '精修蓝毯轮廓', exact: true }).click()
  await dialog.getByLabel('物件名称', { exact: true }).fill('改名蓝毯')
  await dialog.getByRole('button', { name: '应用物件修正并补底', exact: true }).click()
  await expect(dialog.getByRole('button', { name: '恢复改名蓝毯原始表面', exact: true })).toBeEnabled()
  const saved = await exported(page, dialog, info.outputPath('edited.sceneweave-image-work'))
  expect(saved.state.draft.layers[0].surfaceRefinement).toEqual(state.draft.layers[0].surfaceRefinement)
  expect(saved.state.original.sha256).toBe(state.original.sha256)
  expect(saved.state.draft.layers[0].selectionMask).toEqual(state.draft.layers[0].selectionMask)
  const context = await browser.newContext()
  try {
    const cold = await context.newPage()
    await cold.goto('/')
    await cold.getByRole('button', { name: '从图片新建场景', exact: true }).click()
    const next = cold.getByRole('dialog', { name: '图片导入工作台', exact: true })
    await next.getByLabel('打开图片制作工作包', { exact: true }).setInputFiles(info.outputPath('edited.sceneweave-image-work'))
    await next.getByRole('button', { name: '恢复改名蓝毯原始表面', exact: true }).click()
    const restored = await exported(cold, next, info.outputPath('restored.sceneweave-image-work'))
    const { surfaceRefinement: ignored, ...original } = saved.state.draft.layers[0]
    expect(restored.state.draft.layers[0]).toEqual(original)
    expect(restored.state.draft.repairSurfaces).toEqual(saved.state.draft.repairSurfaces)
    expect(restored.normalized).toEqual(saved.normalized)
  } finally { await context.close() }
})
