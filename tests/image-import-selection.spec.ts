import { expect, test, type Locator, type Page } from '@playwright/test'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { unzipSync } from 'fflate'
import { decodeSelectionMask } from '../src/shared/image-import/selection-mask'
import type { ImageImportRecipe } from '../src/shared/image-import/recipe'
import { createKeyboardProject, keyboardProjectBackup, keyboardResourceHashes, keyboardWorkspaceSaved, openKeyboardPanel, selectKeyboardProp } from './keyboard-ux-helpers'
import { openWorkspaceModule } from './workspace-navigation-helpers'

const { PNG } = createRequire(import.meta.url)('../node_modules/playwright-core/lib/utilsBundle.js')
const width = 96, height = 64
type Point = { x: number; y: number }
const box = (x: number, y: number, w: number, h: number): Point[] => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }]

/** Original pixel fixture: dark object, blue hole and a narrow diagonal extension. */
function sourcePng(): Buffer {
  const png = new PNG({ width, height })
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let color = [140 + x % 3, 100, 60, 255]
    if (x >= 24 && x < 76 && y >= 14 && y < 50) color = [50, 110, 150, 255]
    if (x >= 30 && x < 58 && y >= 20 && y < 44) color = [25, 30 + y % 3, 35, 255]
    if (x >= 56 && x <= 68 && Math.abs(y - (86 - x)) <= 2) color = [25, 31, 35, 255]
    if (Math.hypot(x + .5 - 44, y + .5 - 32) < 4) color = [50, 110, 150, 255]
    png.data.set(color, (y * width + x) * 4)
  }
  return PNG.sync.write(png)
}

async function openTool(page: Page): Promise<Locator> {
  await createKeyboardProject(page, '精细选区前的工程')
  await openWorkspaceModule(page, '场景')
  await page.getByRole('button', { name: '从图片新建场景', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '从图片新建可编辑场景', exact: true })
  await dialog.getByLabel('图片转工程原图', { exact: true }).setInputFiles({ name: 'fine-selection.png', mimeType: 'image/png', buffer: sourcePng() })
  await expect(dialog).toContainText('96 × 64 px · 已拆 0 层')
  await mark(dialog, '房间轮廓', box(4, 4, 88, 56))
  await mark(dialog, '比例尺', [{ x: 8, y: 8 }, { x: 28, y: 8 }])
  await dialog.getByLabel('两点间实际距离（毫米）', { exact: true }).fill('1000')
  await dialog.getByLabel('物件名称', { exact: true }).fill('钢琴与细叶')
  return dialog
}

async function mark(dialog: Locator, mode: string, points: Point[]): Promise<void> {
  await dialog.getByRole('group', { name: '图片标注工具', exact: true }).getByRole('button', { name: mode, exact: true }).click()
  const canvas = dialog.getByLabel('图片标注画布', { exact: true })
  await canvas.scrollIntoViewIfNeeded()
  const bounds = await canvas.boundingBox()
  if (!bounds) throw new Error('图片标注画布未显示。')
  for (const point of points) await canvas.click({ position: { x: point.x / width * bounds.width, y: point.y / height * bounds.height } })
}

async function stroke(page: Page, dialog: Locator, mode: string, points: Point[], cancel?: 'pointer' | 'blur'): Promise<void> {
  await dialog.getByRole('group', { name: '物件选区工具', exact: true }).getByRole('button', { name: mode, exact: true }).click()
  const canvas = dialog.getByLabel('图片标注画布', { exact: true })
  await canvas.scrollIntoViewIfNeeded()
  const bounds = await canvas.boundingBox()
  if (!bounds) throw new Error('图片标注画布未显示。')
  const position = (point: Point) => ({ x: bounds.x + point.x / width * bounds.width, y: bounds.y + point.y / height * bounds.height })
  const first = position(points[0])
  await page.mouse.move(first.x, first.y)
  await page.mouse.down()
  for (const point of points.slice(1)) { const next = position(point); await page.mouse.move(next.x, next.y, { steps: 5 }) }
  if (cancel === 'pointer') await canvas.dispatchEvent('pointercancel', { pointerId: 1, pointerType: 'mouse', isPrimary: true })
  if (cancel === 'blur') await page.evaluate(() => window.dispatchEvent(new Event('blur')))
  await page.mouse.up()
}

async function exportRecipe(page: Page, dialog: Locator, filename: string): Promise<ImageImportRecipe> {
  const details = dialog.locator('details').filter({ hasText: '模型拆解提案 JSON' })
  if (await details.getAttribute('open') === null) await details.locator('summary').click()
  const downloading = page.waitForEvent('download')
  await dialog.getByRole('button', { name: '导出当前拆解提案', exact: true }).click()
  await (await downloading).saveAs(filename)
  return JSON.parse(await readFile(filename, 'utf8'))
}

async function applySelection(dialog: Locator): Promise<void> {
  await mark(dialog, '补底取样', [{ x: 8, y: 8 }, { x: 16, y: 16 }])
  await dialog.getByRole('button', { name: '拆出物件并补底', exact: true }).click()
  await expect(dialog).toContainText('已拆 1 层')
}

test('fine brush masks preserve holes and thin tips in recipe, real PNG assets and cold-open editing', async ({ page }, info) => {
  test.setTimeout(180000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const dialog = await openTool(page)
  await mark(dialog, '物件轮廓', box(30, 20, 28, 24))
  await dialog.getByLabel('选区画笔半径', { exact: true }).fill('2')
  await stroke(page, dialog, '保留画笔', [{ x: 57, y: 29 }, { x: 66, y: 20 }])
  const selectionStatus = dialog.getByRole('status').filter({ hasText: '精细选区 ·' })
  const beforeRemoval = await selectionStatus.textContent()
  await dialog.getByLabel('选区画笔半径', { exact: true }).fill('4')
  await stroke(page, dialog, '排除画笔', [{ x: 44, y: 32 }])
  await expect(selectionStatus).not.toHaveText(beforeRemoval!)
  await dialog.getByRole('button', { name: '撤销标注', exact: true }).click()
  await expect(selectionStatus).toHaveText(beforeRemoval!)
  await stroke(page, dialog, '排除画笔', [{ x: 44, y: 32 }])
  await applySelection(dialog)
  const recipe = await exportRecipe(page, dialog, info.outputPath('fine-selection.json'))
  expect(recipe.layers).toHaveLength(1)
  expect(recipe.layers[0].selectionMask).toBeDefined()
  const mask = decodeSelectionMask(recipe.layers[0].selectionMask!, { width, height })
  const alpha = (x: number, y: number) => mask.data[(y - mask.boundsPx.y) * mask.width + x - mask.boundsPx.x]
  expect(alpha(44, 32)).toBe(0)
  expect(alpha(64, 22)).toBeGreaterThan(0)
  expect(alpha(35, 25)).toBe(255)
  const upload = dialog.getByLabel('载入提案', { exact: true })
  await upload.setInputFiles({ name: 'fine-selection.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(recipe)) })
  await expect(dialog.getByRole('alert')).toHaveCount(0)
  expect(await exportRecipe(page, dialog, info.outputPath('replayed-selection.json'))).toEqual(recipe)
  await dialog.getByLabel('署名与来源', { exact: true }).fill('Sceneweave original selection test')
  await dialog.getByLabel('完整许可', { exact: true }).fill('CC0 1.0 Universal. Original synthetic pixels.')
  await dialog.getByRole('checkbox', { name: '我确认有权将这些像素和派生素材嵌入工程及个人素材库', exact: true }).check()
  await dialog.getByRole('button', { name: '预览可编辑新工程', exact: true }).click()
  await expect(page.getByRole('button', { name: '保存并打开副本', exact: true })).toBeVisible({ timeout: 60000 })
  await page.getByRole('button', { name: '保存并打开副本', exact: true }).click()
  await keyboardWorkspaceSaved(page)
  const filename = info.outputPath('fine-selection.sceneweave'), saved = await keyboardProjectBackup(page, filename)
  const definition = Object.values(saved.document.propDefinitions).find(row => row.name === '钢琴与细叶')!
  expect(definition.defaultAppearance.kind).toBe('image')
  if (definition.defaultAppearance.kind !== 'image') throw new Error('精细选区未生成真实PNG。')
  const asset = saved.document.assets[definition.defaultAppearance.assetId]
  const files = unzipSync(new Uint8Array(await readFile(filename)))
  const pixels = PNG.sync.read(Buffer.from(files[`assets/${asset.sha256}.png`]))
  expect([pixels.width, pixels.height]).toEqual([mask.width, mask.height])
  const original = PNG.sync.read(sourcePng())
  for (let y = 0; y < mask.height; y++) for (let x = 0; x < mask.width; x++) {
    const index = y * mask.width + x, sourceIndex = ((y + mask.boundsPx.y) * width + x + mask.boundsPx.x) * 4
    expect(pixels.data[index * 4 + 3]).toBe(mask.data[index])
    if (mask.data[index]) expect([...pixels.data.slice(index * 4, index * 4 + 3)]).toEqual([...original.data.slice(sourceIndex, sourceIndex + 3)])
  }
  await page.reload()
  await page.getByRole('button', { name: '回到首页', exact: true }).click()
  await page.getByTestId('workspace-home').locator(`[data-project-key="native:${saved.document.sceneId}"]`).getByRole('button', { name: '打开', exact: true }).click()
  await keyboardWorkspaceSaved(page)
  const cold = await keyboardProjectBackup(page, info.outputPath('fine-selection-cold.sceneweave'))
  expect(keyboardResourceHashes(cold.hashes)).toEqual(keyboardResourceHashes(saved.hashes))
  const prop = Object.values(cold.document.props).find(row => row.definitionRef?.id === definition.id)!
  await selectKeyboardProp(page, prop.id)
  const inspector = await openKeyboardPanel(page, 'inspector')
  await inspector.getByLabel('物件 X', { exact: true }).fill(String((prop.positionMm.x + 100) / 1000))
  await inspector.getByLabel('物件 X', { exact: true }).press('Enter')
  await keyboardWorkspaceSaved(page)
  const edited = await keyboardProjectBackup(page, info.outputPath('fine-selection-edited.sceneweave'))
  expect(edited.document.props[prop.id].positionMm.x).toBe(prop.positionMm.x + 100)
  expect(keyboardResourceHashes(edited.hashes)).toEqual(keyboardResourceHashes(saved.hashes))
  expect(errors).toEqual([])
})

test('freehand selection, cancelled strokes, zoom and edge inspection preserve the accepted recipe', async ({ page }, info) => {
  test.setTimeout(120000)
  const dialog = await openTool(page)
  await dialog.getByRole('checkbox', { name: '吸附到图像边缘', exact: true }).uncheck()
  await stroke(page, dialog, '磁性套索', [...box(30, 20, 28, 24), { x: 30, y: 20 }])
  await expect(dialog.getByRole('status').filter({ hasText: '精细选区 ·' })).toBeVisible()
  await applySelection(dialog)
  const before = await exportRecipe(page, dialog, info.outputPath('before-inspection.json'))
  await dialog.getByRole('button', { name: '精修钢琴与细叶轮廓', exact: true }).click()
  const status = dialog.getByRole('status').filter({ hasText: '精细选区 ·' }), originalStatus = await status.textContent()
  await dialog.getByLabel('选区画笔半径', { exact: true }).fill('4')
  await stroke(page, dialog, '排除画笔', [{ x: 38, y: 28 }, { x: 45, y: 35 }], 'pointer')
  await expect(status).toHaveText(originalStatus!)
  await stroke(page, dialog, '排除画笔', [{ x: 38, y: 28 }, { x: 45, y: 35 }], 'blur')
  await expect(status).toHaveText(originalStatus!)
  await dialog.getByLabel('图片缩放', { exact: true }).selectOption('400')
  await dialog.getByRole('button', { name: '检查物件边缘', exact: true }).click()
  const review = dialog.getByRole('region', { name: '物件边缘检查', exact: true })
  await expect(review.getByLabel('物件透明边缘预览', { exact: true })).toBeVisible()
  await review.getByLabel('物件检查背景', { exact: true }).selectOption('white')
  await review.getByLabel('物件检查背景', { exact: true }).selectOption('black')
  await review.getByLabel('物件检查旋转角度', { exact: true }).fill('37')
  await review.screenshot({ path: info.outputPath('black-background-rotated.png') })
  await review.getByLabel('物件检查背景', { exact: true }).selectOption('checker')
  await dialog.getByLabel('图片缩放', { exact: true }).selectOption('fit')
  await dialog.getByRole('button', { name: '应用物件修正并补底', exact: true }).click()
  expect(await exportRecipe(page, dialog, info.outputPath('after-inspection.json'))).toEqual(before)
})
