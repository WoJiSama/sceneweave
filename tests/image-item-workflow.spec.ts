import { expect, test, type Locator } from '@playwright/test'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { readImageWorkPackage, writeImageWorkPackage, type ImageWorkState } from '../src/shared/image-import/workflow'
import { sha256Bytes } from '../src/shared/project/binary'
import { sha256Text } from '../src/shared/validation/hash'
import { encodeSelectionMask } from '../src/shared/image-import/selection-mask'
import { createKeyboardProject } from './keyboard-ux-helpers'
import { openWorkspaceModule } from './workspace-navigation-helpers'

const { PNG } = createRequire(import.meta.url)('../node_modules/playwright-core/lib/utilsBundle.js')
const width = 96, height = 64
function image(): Buffer {
  const png = new PNG({ width, height })
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const object = x >= 30 && x < 58 && y >= 20 && y < 44 && Math.hypot(x - 44, y - 32) > 3
    png.data.set(object ? [25, 31, 35, 255] : [75, 120, 150, 255], (y * width + x) * 4)
  }
  return PNG.sync.write(png)
}
async function point(dialog: Locator, tool: string, x: number, y: number) {
  const group = ['前景标记', '背景标记', '排除画笔', '保留画笔'].includes(tool) ? '物件选区工具' : '图片标注工具'
  await dialog.getByRole('group', { name: group, exact: true }).getByRole('button', { name: tool, exact: true }).click()
  const canvas = dialog.getByLabel('图片标注画布', { exact: true }), bounds = await canvas.boundingBox()
  if (!bounds) throw new Error('Missing canvas')
  await canvas.click({ position: { x: x / width * bounds.width, y: y / height * bounds.height } })
}

test('portable model provenance survives browser refinement and another empty storage import', async ({ page, browser }, info) => {
  const bytes = new Uint8Array(image()), hash = sha256Bytes(bytes)
  const selectionOrigin: NonNullable<NonNullable<ImageWorkState['active']>['selectionOrigin']> = {
    method: 'local-slimsam', sourceSha256: hash, inputSha256: hash, priorLayersHash: sha256Text('[]'),
    modelId: 'Xenova/slimsam-77-uniform', modelRevision: 'a'.repeat(40),
    modelFiles: [{ name: 'vision_encoder.onnx', sha256: 'b'.repeat(64) }, { name: 'prompt_encoder_mask_decoder.onnx', sha256: 'c'.repeat(64) }],
    contextBounds: { x: 0, y: 0, width, height }, targetBounds: { x: 24, y: 14, width: 52, height: 36 },
    points: [{ x: 36, y: 28, label: 1 }], candidateIndex: 1, cleanup: { fillHoles: 0, removeIslands: 0 },
  }
  const mask = { width: 52, height: 36, boundsPx: selectionOrigin.targetBounds, data: new Uint8Array(52 * 36) }
  for (let y = 20; y < 44; y++) for (let x = 30; x < 58; x++) if (Math.hypot(x - 44, y - 32) > 3) mask.data[(y - 14) * 52 + x - 24] = 255
  const state: ImageWorkState = { format: 'sceneweave-image-work', version: 1, id: 'synthetic-model-provenance', revision: 1,
    image: { sha256: hash, pixelWidth: width, pixelHeight: height },
    original: { name: 'synthetic.png', sha256: hash, sizeBytes: bytes.length, mimeType: 'image/png' },
    rights: { attribution: 'Synthetic fixture; no model invocation', licenseText: 'Synthetic fixture', canEmbed: false },
    draft: { title: '本机候选来源恢复', calibration: null, roomPointsPx: [], layers: [] },
    active: { name: '模型候选', polygon: [{ x: 24, y: 14 }, { x: 76, y: 14 }, { x: 76, y: 50 }, { x: 24, y: 50 }], donor: [],
      renderLayer: 'object', blocksMovement: false, selectionMask: encodeSelectionMask(mask), selectionOrigin },
    notes: 'Synthetic provenance transport test only.', nextAction: '查看孔洞并局部修正', scaleStatus: 'provisional', journal: [], reviews: [] }
  const pack = await writeImageWorkPackage(state, bytes, bytes)
  await page.goto('/')
  await page.getByRole('button', { name: '从图片新建场景', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '图片导入工作台', exact: true })
  await dialog.getByLabel('打开图片制作工作包', { exact: true }).setInputFiles({ name: 'model.sceneweave-image-work', mimeType: 'application/octet-stream', buffer: Buffer.from(pack) })
  await expect(dialog.getByLabel('物件名称', { exact: true })).toHaveValue('模型候选')
  await dialog.getByLabel('选区画笔半径', { exact: true }).fill('0.5')
  await point(dialog, '排除画笔', 36.5, 28.5)
  const downloadEvent = page.waitForEvent('download')
  await dialog.getByRole('button', { name: '导出制作工作包', exact: true }).click()
  const download = await downloadEvent, filename = info.outputPath('refined-model.sceneweave-image-work')
  await download.saveAs(filename)
  const refined = await readImageWorkPackage(new Uint8Array(await readFile(filename)))
  expect(refined.state.active?.selectionOrigin).toEqual(selectionOrigin)
  expect(refined.state.active?.selectionMask).not.toEqual(state.active!.selectionMask)
  const context = await browser.newContext()
  try {
    const fresh = await context.newPage()
    await fresh.goto('/')
    await fresh.getByRole('button', { name: '从图片新建场景', exact: true }).click()
    const restored = fresh.getByRole('dialog', { name: '图片导入工作台', exact: true })
    await restored.getByLabel('打开图片制作工作包', { exact: true }).setInputFiles(filename)
    await expect(restored.getByLabel('物件名称', { exact: true })).toHaveValue('模型候选')
    const exported = fresh.waitForEvent('download')
    await restored.getByRole('button', { name: '导出制作工作包', exact: true }).click()
    const back = await exported, backFile = info.outputPath('cold-model.sceneweave-image-work')
    await back.saveAs(backFile)
    expect((await readImageWorkPackage(new Uint8Array(await readFile(backFile)))).state.active).toEqual(refined.state.active)
  } finally { await context.close() }
})

test('unfinished seeds survive reload and a portable package opens in empty browser storage', async ({ page, browser }, info) => {
  test.setTimeout(180_000)
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await createKeyboardProject(page, '制作草稿独立保存')
  await openWorkspaceModule(page, '场景')
  await page.getByRole('button', { name: '从图片新建场景', exact: true }).click()
  let dialog = page.getByRole('dialog', { name: '图片导入工作台', exact: true })
  await dialog.getByRole('button', { name: '原图与标定', exact: true }).click()
  await dialog.getByLabel('图片转工程原图', { exact: true }).setInputFiles({ name: 'source.png', mimeType: 'image/png', buffer: image() })
  await expect(dialog).toContainText('96 × 64 px')
  for (const [x, y] of [[24, 14], [76, 14], [76, 50], [24, 50]]) await point(dialog, '物件轮廓', x, y)
  await dialog.getByLabel('选区画笔半径', { exact: true }).fill('0.5')
  await point(dialog, '前景标记', 36, 28)
  await point(dialog, '背景标记', 27, 17)
  await dialog.getByLabel('图片制作下一步', { exact: true }).fill('给中央孔洞补背景，然后生成选区。')
  await expect(dialog.getByRole('status').filter({ hasText: '制作进度已保存' })).toBeVisible({ timeout: 20000 })
  const downloadEvent = page.waitForEvent('download')
  await dialog.getByRole('button', { name: '导出制作工作包', exact: true }).click()
  const download = await downloadEvent, filename = info.outputPath('unfinished.sceneweave-image-work')
  await download.saveAs(filename)
  const work = await readImageWorkPackage(new Uint8Array(await readFile(filename)))
  expect(work.state.active?.guided?.foreground).toHaveLength(1)
  expect(work.state.active?.guided?.background).toHaveLength(1)
  expect(work.state.active?.guided?.foreground[0].radiusPx).toBe(.5)
  expect(work.state.active?.guided?.boundaryPx).toHaveLength(4)
  expect(work.state.active?.guided?.edgeCoverage).toBe('boundary')
  expect(work.state.draft.calibration).toBeNull()
  expect(work.state.scaleStatus).toBe('provisional')
  expect(work.state.nextAction).toContain('中央孔洞')

  await page.reload()
  await page.getByRole('button', { name: '从图片新建场景', exact: true }).click()
  dialog = page.getByRole('dialog', { name: '图片导入工作台', exact: true })
  await dialog.getByRole('button', { name: '继续上次拆分', exact: true }).click()
  await expect(dialog).toContainText('前景 1 笔 · 背景 1 笔')
  await expect(dialog.getByLabel('图片制作下一步', { exact: true })).toHaveValue('给中央孔洞补背景，然后生成选区。')
  await point(dialog, '背景标记', 44, 32)
  await dialog.getByRole('button', { name: '生成辅助选区', exact: true }).click()
  await expect(dialog.getByRole('status').filter({ hasText: '精细选区' })).toBeVisible()
  await expect(dialog.getByRole('region', { name: '物件边缘检查', exact: true })).toBeVisible()
  await expect(dialog.getByRole('checkbox', { name: '显示橙色待判断区域', exact: true })).toBeChecked()
  expect(errors).toEqual([])

  await dialog.getByLabel('选区画笔半径', { exact: true }).fill('32')
  await point(dialog, '排除画笔', 44, 32)
  await expect(dialog.getByRole('status').filter({ hasText: '精细选区 · 0 个原图像素' })).toBeVisible()
  await expect(dialog.getByRole('status').filter({ hasText: '制作进度已保存' })).toBeVisible({ timeout: 20000 })
  const emptyDownloadEvent = page.waitForEvent('download')
  await dialog.getByRole('button', { name: '导出制作工作包', exact: true }).click()
  const emptyDownload = await emptyDownloadEvent, emptyFile = info.outputPath('empty-selection.sceneweave-image-work')
  await emptyDownload.saveAs(emptyFile)
  const emptyWork = await readImageWorkPackage(new Uint8Array(await readFile(emptyFile)))
  expect(emptyWork.state.active?.selectionMask).toBeUndefined()
  expect(emptyWork.state.active?.emptySelectionBounds).toBeDefined()
  expect(errors).toEqual([])

  const context = await browser.newContext()
  try {
    const fresh = await context.newPage()
    await fresh.goto('/')
    await fresh.getByRole('button', { name: '从图片新建场景', exact: true }).click()
    const editor = fresh.getByRole('dialog', { name: '图片导入工作台', exact: true })
    await editor.getByLabel('打开图片制作工作包', { exact: true }).setInputFiles(filename)
    await expect(editor).toContainText('前景 1 笔 · 背景 1 笔')
    await expect(editor.getByLabel('图片制作下一步', { exact: true })).toHaveValue('给中央孔洞补背景，然后生成选区。')
    await editor.screenshot({ path: info.outputPath('restored-work.png') })
  } finally { await context.close() }
})
