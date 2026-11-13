import { test, expect, type Locator, type Page } from '@playwright/test'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { writeImageWorkPackage, readImageWorkPackage, type ImageWorkState } from '../src/shared/image-import/workflow'
import { sha256Bytes } from '../src/shared/project/binary'
import { decodeSelectionMask } from '../src/shared/image-import/selection-mask'

const { PNG } = createRequire(import.meta.url)('../node_modules/playwright-core/lib/utilsBundle.js')
const width = 96, height = 80
const rectangle = (x: number, y: number, w: number, h: number) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }]
async function openWork(page: Page, file: string | { name: string; mimeType: string; buffer: Buffer }) {
  await page.goto('/')
  await page.getByRole('button', { name: '从图片新建场景', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '图片导入工作台', exact: true })
  await dialog.getByLabel('打开图片制作工作包', { exact: true }).setInputFiles(file)
  await expect(dialog.getByRole('button', { name: '分析测试椅补底与邻域', exact: true })).toBeEnabled()
  await dialog.getByRole('group', { name: '图片导入阶段', exact: true }).getByRole('button', { name: '物件与补底', exact: true }).click()
  await dialog.locator('details.image-import-fill-settings > summary').click()
  return dialog
}
async function drawProtection(dialog: Locator, bounds: { x: number; y: number; width: number; height: number }) {
  await dialog.getByRole('button', { name: '清除保护范围', exact: true }).click()
  await dialog.getByRole('button', { name: '画保护范围', exact: true }).click()
  const canvas = dialog.getByLabel('图片标注画布', { exact: true }), box = (await canvas.boundingBox())!
  for (const point of rectangle(bounds.x, bounds.y, bounds.width, bounds.height)) await canvas.click({ position: { x: point.x / width * box.width, y: point.y / height * box.height } })
}
async function exportWork(page: Page, dialog: Locator, filename: string) {
  const downloading = page.waitForEvent('download')
  await dialog.getByRole('button', { name: '导出制作工作包', exact: true }).click()
  await (await downloading).saveAs(filename)
  return readImageWorkPackage(new Uint8Array(await readFile(filename)))
}

test('appending a local evidence exclusion preserves the old region, cold-replays, rejects an invalid append atomically and clears only explicitly', async ({ page, browser }, info) => {
  test.setTimeout(180000)
  const png = new PNG({ width, height })
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) png.data.set(x >= 40 && x < 50 && y >= 30 && y < 42 ? [25, 32, 40, 255] : [90 + x % 3, 120 + y % 3, 135, 255], (y * width + x) * 4)
  const bytes = new Uint8Array(PNG.sync.write(png)), hash = sha256Bytes(bytes)
  const state: ImageWorkState = { format: 'sceneweave-image-work', version: 1, id: 'surface-exclusion-append', revision: 1,
    image: { sha256: hash, pixelWidth: width, pixelHeight: height }, original: { name: 'source.png', sha256: hash, sizeBytes: bytes.length, mimeType: 'image/png' },
    draft: { title: '局部追加取证排除', calibration: { first: { x: 0, y: 0 }, second: { x: 50, y: 0 }, distanceMm: 1000 }, roomPointsPx: rectangle(3, 3, 90, 74),
      repairSurfaces: [{ id: 'fabric', name: '织物底材', kind: 'soft', mask: { x: 4, y: 4, width: 88, height: 72, runs: [6336, 255] }, donor: { x: 8, y: 8, width: 16, height: 16 }, excludedEvidenceMask: { x: 68, y: 48, width: 6, height: 6, runs: [36, 255] } }],
      layers: [{ id: 'chair', name: '测试椅', polygon: rectangle(40, 30, 10, 12), donor: { x: 8, y: 8, width: 16, height: 16 }, renderLayer: 'object', blocksMovement: true, appearanceSource: 'original', repair: 'surfaces', repairSurfaceIds: ['fabric'],
        selectionMask: { x: 40, y: 30, width: 10, height: 12, runs: [120, 255] }, removalMask: { x: 39, y: 29, width: 12, height: 14, runs: [168, 255] }, protectionMask: { x: 80, y: 20, width: 6, height: 6, runs: [36, 255] } }] },
    rights: { licenseText: 'Synthetic original pixels, embedding permitted.', attribution: 'Synthetic test', canEmbed: true }, notes: '', nextAction: '只追加一小处排除', scaleStatus: 'provisional', journal: [], reviews: [] }
  const dialog = await openWork(page, { name: 'append.sceneweave-image-work', mimeType: 'application/octet-stream', buffer: Buffer.from(await writeImageWorkPackage(state, bytes, bytes)) })
  const surface = dialog.getByRole('group', { name: '底材表面 织物底材', exact: true })
  await drawProtection(dialog, { x: 72, y: 52, width: 8, height: 6 })
  await surface.getByRole('button', { name: '把保护范围追加到取证排除', exact: true }).click()
  await expect(dialog).toContainText('原有排除区域已保留')
  const filename = info.outputPath('appended.sceneweave-image-work'), appended = await exportWork(page, dialog, filename)
  const union = decodeSelectionMask(appended.state.draft.repairSurfaces![0].excludedEvidenceMask!, { width, height })
  let count = 0
  for (let y = 0; y < union.height; y++) for (let x = 0; x < union.width; x++) {
    const sx = union.boundsPx.x + x, sy = union.boundsPx.y + y
    const expected = sx >= 68 && sx < 74 && sy >= 48 && sy < 54 || sx >= 72 && sx < 80 && sy >= 52 && sy < 58
    expect(union.data[y * union.width + x]).toBe(expected ? 255 : 0); count += expected ? 1 : 0
  }
  expect(count).toBe(80)
  expect(appended.state.draft.layers).toEqual(state.draft.layers)
  const { excludedEvidenceMask: beforeExcluded, ...beforeSurface } = state.draft.repairSurfaces![0], { excludedEvidenceMask: nextExcluded, ...nextSurface } = appended.state.draft.repairSurfaces![0]
  expect(nextSurface).toEqual(beforeSurface)
  const context = await browser.newContext()
  try {
    const cold = await context.newPage(), coldDialog = await openWork(cold, filename)
    const coldSurface = coldDialog.getByRole('group', { name: '底材表面 织物底材', exact: true })
    const restored = await exportWork(cold, coldDialog, info.outputPath('cold-appended.sceneweave-image-work'))
    expect(restored.state.draft).toEqual(appended.state.draft)
    await drawProtection(coldDialog, { x: 10, y: 10, width: 4, height: 4 })
    await coldSurface.getByRole('button', { name: '把保护范围追加到取证排除', exact: true }).click()
    await expect(coldDialog.getByRole('alert').filter({ hasText: '取样必须位于可信同材质范围' })).toBeVisible()
    const rejected = await exportWork(cold, coldDialog, info.outputPath('rejected-preserved.sceneweave-image-work'))
    expect(rejected.state.draft).toEqual(appended.state.draft); expect(rejected.state.journal).toEqual(restored.state.journal)
    await coldSurface.getByRole('button', { name: '清除取证排除', exact: true }).click()
    await expect(coldSurface).toContainText('尚无取证排除')
    const cleared = await exportWork(cold, coldDialog, info.outputPath('explicit-cleared.sceneweave-image-work'))
    expect(cleared.state.draft.repairSurfaces![0]).toEqual(beforeSurface)
    expect(cleared.state.draft.layers).toEqual(state.draft.layers)
    expect(cleared.original).toEqual(bytes); expect(cleared.normalized).toEqual(bytes)
  } finally { await context.close() }
})
