import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { unzipSync } from 'fflate'
import { decodeSelectionMask, encodeSelectionMask } from '../src/shared/image-import/selection-mask'
import { createKeyboardProject, keyboardProjectBackup, keyboardResourceHashes, keyboardWorkspaceSaved, openKeyboardPanel, selectKeyboardProp } from './keyboard-ux-helpers'
import { openWorkspaceModule } from './workspace-navigation-helpers'

const { PNG } = createRequire(import.meta.url)('../node_modules/playwright-core/lib/utilsBundle.js')
const width = 96, height = 64
type Point = { x: number; y: number }
type Backup = Awaited<ReturnType<typeof keyboardProjectBackup>>
const box = (x: number, y: number, w: number, h: number): Point[] => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }]
const contaminatedSelection = () => {
  const data = new Uint8Array(28 * 24)
  for (let y = 2; y < 22; y++) for (let x = 2; x < 26; x++) data[y * 28 + x] = x === 2 || x === 25 || y === 2 || y === 21 ? 128 : 255
  return encodeSelectionMask({ width: 28, height: 24, boundsPx: { x: 30, y: 20, width: 28, height: 24 }, data })
}
const contourSelection = () => {
  const data = new Uint8Array(28 * 24)
  for (let y = 2; y < 22; y++) for (let x = 2; x < 26; x++) if (x + y >= 14) data[y * 28 + x] = 255
  return encodeSelectionMask({ width: 28, height: 24, boundsPx: { x: 30, y: 20, width: 28, height: 24 }, data })
}

/** Original hand-mark fixture: sharp dark lines, restrained grain and a separate editable stool. */
function sourcePng(contaminatedEdge = false, contour = false): Buffer {
  const png = new PNG({ width, height })
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let color = [140 + x % 3, 102, 65, 255]
    if (x >= 30 && x < 58 && y >= 20 && y < 44) color = [55 + (x + y) % 5 * 3, 71 + (x * 3 + y) % 5 * 3, 84 + (x + y) % 5 * 3, 255]
    if (x >= 34 && x < 38 && y >= 23 && y < 40 || x >= 34 && x < 54 && y === 23) color = [18, 23, 28, 255]
    if (contour && x >= 30 && x < 58 && y >= 20 && y < 44 &&
      (x < 32 || x >= 56 || y < 22 || y >= 42 || x - 30 + y - 20 < 14)) color = [140 + x % 3, 102, 65, 255]
    if (contaminatedEdge && x >= 30 && x < 58 && y >= 20 && y < 44) {
      // Keep real clear pixels inside the cropped PNG. A cropped opaque edge
      // alone cannot establish that a neighbouring colour came from outside.
      const distance = Math.min(x - 32, 55 - x, y - 22, 41 - y)
      color = distance < 0 ? [0, 0, 0, 0] : distance === 0 ? [50, 75, 100, 255] : [40, 40, 40, 255]
      if (x >= 38 && x < 48 && y === 28) color = [5, 5, 5, 255]
    }
    if (x >= 70 && x < 80 && y >= 38 && y < 48) color = [51 + y % 3, 67, 77, 255]
    png.data.set(color, (y * width + x) * 4)
  }
  return PNG.sync.write(png)
}

async function mark(dialog: Locator, mode: string, points: Point[]): Promise<void> {
  await dialog.getByRole('group', { name: '图片标注工具', exact: true }).getByRole('button', { name: mode, exact: true }).click()
  const canvas = dialog.getByLabel('图片标注画布', { exact: true })
  await canvas.scrollIntoViewIfNeeded()
  const bounds = await canvas.boundingBox()
  if (!bounds) throw new Error('图片标注画布未显示。')
  for (const point of points) await canvas.click({ position: { x: point.x / width * bounds.width, y: point.y / height * bounds.height } })
}

async function createSourceProject(page: Page, info: TestInfo, contaminatedEdge = false, contour = false) {
  await createKeyboardProject(page, '画质候选前的工程')
  await openWorkspaceModule(page, '场景')
  await page.getByRole('button', { name: '从图片新建场景', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '图片导入工作台', exact: true })
  await dialog.getByRole('group', { name: '图片导入阶段', exact: true }).getByRole('button', { name: '原图与标定', exact: true }).click()
  await dialog.getByLabel('图片转工程原图', { exact: true }).setInputFiles({ name: 'quality-source.png', mimeType: 'image/png', buffer: sourcePng(contaminatedEdge, contour) })
  await expect(dialog).toContainText('96 × 64 px · 已拆 0 层')
  await mark(dialog, '房间轮廓', box(4, 4, 88, 56))
  await mark(dialog, '比例尺', [{ x: 8, y: 8 }, { x: 28, y: 8 }])
  await dialog.getByRole('group', { name: '图片导入阶段', exact: true }).getByRole('button', { name: '结构与比例', exact: true }).click()
  await dialog.getByLabel('两点间实际距离（毫米）', { exact: true }).fill('1000')
  for (const [name, polygon] of [['待增强钢琴', box(30, 20, 28, 24)], ['独立琴凳', box(70, 38, 10, 10)]] as const) {
    await dialog.getByRole('group', { name: '图片导入阶段', exact: true }).getByRole('button', { name: '物件与补底', exact: true }).click()
    await dialog.getByLabel('物件名称', { exact: true }).fill(name)
    await mark(dialog, '物件轮廓', polygon)
    await mark(dialog, '补底取样', [{ x: 8, y: 8 }, { x: 16, y: 16 }])
    await dialog.getByRole('button', { name: '拆出物件并补底', exact: true }).click()
  }
  await expect(dialog.locator('.image-import-stat').filter({ hasText: '已拆物件与装饰' })).toContainText('2 层')
  if (contaminatedEdge || contour) {
    // The explicit selection excludes the source's clear padding from repair;
    // partial coverage is confined to the edge beside real unselected pixels.
    await dialog.getByRole('group', { name: '图片导入阶段', exact: true }).getByRole('button', { name: '原图与标定', exact: true }).click()
    const details = dialog.locator('details').filter({ hasText: '模型拆解提案 JSON' })
    if (await details.getAttribute('open') === null) await details.locator('summary').click()
    const downloading = page.waitForEvent('download')
    await dialog.getByRole('button', { name: '导出当前拆解提案', exact: true }).click()
    const path = info.outputPath('contaminated-edge-selection.json')
    await (await downloading).saveAs(path)
    const recipe = JSON.parse(await readFile(path, 'utf8'))
    recipe.layers[0].selectionMask = contour ? contourSelection() : contaminatedSelection()
    await dialog.getByRole('group', { name: '图片导入阶段', exact: true }).getByRole('button', { name: '原图与标定', exact: true }).click()
    await dialog.getByLabel('载入提案', { exact: true }).setInputFiles({ name: 'contaminated-edge-selection.json',
      mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(recipe)) })
    await expect(dialog.getByRole('status').filter({ hasText: '已载入同一原图' })).toBeVisible()
  }
  await dialog.getByRole('group', { name: '图片导入阶段', exact: true }).getByRole('button', { name: '总览与采用', exact: true }).click()
  await dialog.getByLabel('署名与来源', { exact: true }).fill('Sceneweave original image enhancement browser fixture')
  await dialog.getByRole('group', { name: '图片导入阶段', exact: true }).getByRole('button', { name: '总览与采用', exact: true }).click()
  await dialog.getByLabel('完整许可', { exact: true }).fill('CC0 1.0 Universal. Original synthetic pixels.')
  await dialog.getByRole('group', { name: '图片导入阶段', exact: true }).getByRole('button', { name: '总览与采用', exact: true }).click()
  await dialog.getByRole('checkbox', { name: '我确认有权将这些像素和派生素材嵌入工程及个人素材库', exact: true }).check()
  await dialog.getByRole('button', { name: '预览可编辑新工程', exact: true }).click()
  await expect(page.getByRole('button', { name: '保存并打开副本', exact: true })).toBeVisible({ timeout: 60000 })
  await page.getByRole('button', { name: '保存并打开副本', exact: true }).click()
  await keyboardWorkspaceSaved(page)
  const filename = info.outputPath('original.sceneweave'), saved = await keyboardProjectBackup(page, filename)
  const propFor = (name: string) => {
    const definition = Object.values(saved.document.propDefinitions).find(row => row.name === name)!
    return Object.values(saved.document.props).find(prop => prop.definitionRef?.id === definition.id)!
  }
  return { saved, filename, piano: propFor('待增强钢琴'), stool: propFor('独立琴凳') }
}

function imageAsset(saved: Backup, id: string) {
  const prop = saved.document.props[id]
  if (prop.appearance.kind !== 'image') throw new Error('物件没有图片外观。')
  return saved.document.assets[prop.appearance.assetId]
}

async function decodedAsset(filename: string, hash: string) {
  const files = unzipSync(new Uint8Array(await readFile(filename)))
  return PNG.sync.read(Buffer.from(files[`assets/${hash}.png`]))
}

async function openEnhancement(page: Page, id: string): Promise<Locator> {
  await selectKeyboardProp(page, id)
  const inspector = await openKeyboardPanel(page, 'inspector')
  await inspector.getByRole('button', { name: '编辑素材', exact: true }).click()
  await page.getByTestId('scene-asset-editor').getByRole('button', { name: '图像处理', exact: true }).click()
  const panel = page.getByRole('region', { name: '画质候选编辑', exact: true, includeHidden: true })
  await panel.locator('xpath=..').locator('summary').click()
  await expect(panel.getByLabel('画质原图与范围画布', { exact: true })).toBeVisible()
  return panel
}

async function generate(panel: Locator, count: 2 | 3 = 2) {
  await panel.getByLabel('画质候选数量', { exact: true }).selectOption(String(count))
  await panel.getByRole('button', { name: `生成 ${count} 个候选`, exact: true }).click()
  const candidates = panel.getByRole('group', { name: '画质候选列表', exact: true }).getByRole('button')
  await expect(candidates).toHaveCount(count, { timeout: 60000 })
  await expect(panel.getByRole('alert')).toHaveCount(0)
  return candidates
}

async function adopt(page: Page, panel: Locator) {
  await panel.getByRole('button', { name: '在场景中预览', exact: true }).click()
  await expect(page.getByRole('button', { name: '采用图像候选', exact: true })).toBeVisible({ timeout: 60000 })
  await page.getByRole('button', { name: '采用图像候选', exact: true }).click()
  await keyboardWorkspaceSaved(page)
}

async function closeEnhancement(panel: Locator) {
  const page = panel.page()
  await page.getByTestId('scene-asset-editor').getByRole('button', { name: '关闭素材编辑', exact: true }).click()
  const confirmation = page.getByRole('alertdialog', { name: '关闭素材编辑确认', exact: true })
  if (await confirmation.isVisible()) await confirmation.getByRole('button', { name: '丢弃本页草稿并关闭', exact: true }).click()
  await expect(page.getByTestId('scene-asset-editor')).toHaveCount(0)
}

async function moveProp(page: Page, id: string, xMm: number) {
  await selectKeyboardProp(page, id)
  const inspector = await openKeyboardPanel(page, 'inspector')
  await inspector.getByLabel('物件 X', { exact: true }).fill(String(xMm / 1000))
  await inspector.getByLabel('物件 X', { exact: true }).press('Enter')
  await keyboardWorkspaceSaved(page)
}

async function paintScope(page: Page, panel: Locator, points: Point[], cancel = false) {
  const canvas = panel.getByLabel('画质原图与范围画布', { exact: true })
  await canvas.scrollIntoViewIfNeeded()
  const bounds = await canvas.boundingBox(), w = Number(await canvas.getAttribute('width')), h = Number(await canvas.getAttribute('height'))
  if (!bounds) throw new Error('画质范围画布未显示。')
  const at = (point: Point) => ({ x: bounds.x + point.x * bounds.width / w, y: bounds.y + point.y * bounds.height / h })
  const first = at(points[0]); await page.mouse.move(first.x, first.y); await page.mouse.down()
  for (const point of points.slice(1)) { const next = at(point); await page.mouse.move(next.x, next.y, { steps: 5 }) }
  if (cancel) await canvas.dispatchEvent('pointercancel', { pointerId: 1, pointerType: 'mouse', isPrimary: true })
  await page.mouse.up()
}

test('image quality candidates retain original lineage, undo, cold-open editing and continued enhancement', async ({ page }, info) => {
  test.setTimeout(180000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const { saved: original, filename: originalFile, piano } = await createSourceProject(page, info)
  const originalAsset = imageAsset(original, piano.id)
  let panel = await openEnhancement(page, piano.id)
  await (await generate(panel)).nth(1).click()
  await panel.getByLabel('画质检查背景', { exact: true }).selectOption('white')
  await panel.getByLabel('画质对照缩放', { exact: true }).selectOption('200')
  await panel.screenshot({ path: info.outputPath('clarity-candidates.png') })
  await adopt(page, panel)
  await closeEnhancement(panel)
  const enhancedFile = info.outputPath('enhanced.sceneweave'), enhanced = await keyboardProjectBackup(page, enhancedFile)
  const firstAsset = imageAsset(enhanced, piano.id), first = enhanced.document.props[piano.id]
  expect(firstAsset.imageEnhancement).toMatchObject({ version: 1, sourceAssetId: originalAsset.id, originalAssetId: originalAsset.id, recipe: { direction: 'clarity', scale: 2 } })
  expect([firstAsset.pixelWidth, firstAsset.pixelHeight]).toEqual([originalAsset.pixelWidth * 2, originalAsset.pixelHeight * 2])
  expect(enhanced.document.assets[originalAsset.id]).toEqual(originalAsset)
  expect(first.positionMm).toEqual(piano.positionMm)
  expect(first.rotationDeg).toBe(piano.rotationDeg)
  expect(first.visualBoundsMm).toEqual(piano.visualBoundsMm)
  expect(first.footprintMm).toEqual(piano.footprintMm)
  expect(first.blocksMovement).toBe(piano.blocksMovement)
  const oldPixels = await decodedAsset(originalFile, originalAsset.sha256), firstPixels = await decodedAsset(enhancedFile, firstAsset.sha256)
  let differsFromPixelReplication = false
  for (let y = 0; y < firstPixels.height; y++) for (let x = 0; x < firstPixels.width; x++) {
    const a = (y * firstPixels.width + x) * 4, b = (Math.floor(y / 2) * oldPixels.width + Math.floor(x / 2)) * 4
    if ([0, 1, 2, 3].some(channel => firstPixels.data[a + channel] !== oldPixels.data[b + channel])) differsFromPixelReplication = true
  }
  expect(differsFromPixelReplication).toBe(true)
  await page.getByRole('button', { name: '撤销编辑', exact: true }).click(); await keyboardWorkspaceSaved(page)
  expect(imageAsset(await keyboardProjectBackup(page, info.outputPath('undone.sceneweave')), piano.id).id).toBe(originalAsset.id)
  await page.getByRole('button', { name: '重做编辑', exact: true }).click(); await keyboardWorkspaceSaved(page)
  expect(imageAsset(await keyboardProjectBackup(page, info.outputPath('redone.sceneweave')), piano.id).id).toBe(firstAsset.id)
  await page.reload()
  await page.getByRole('button', { name: '回到首页', exact: true }).click()
  await page.getByTestId('workspace-home').locator(`[data-project-key="native:${enhanced.document.sceneId}"]`).getByRole('button', { name: '打开', exact: true }).click()
  await keyboardWorkspaceSaved(page)
  const cold = await keyboardProjectBackup(page, info.outputPath('cold.sceneweave'))
  expect(keyboardResourceHashes(cold.hashes)).toEqual(keyboardResourceHashes(enhanced.hashes))
  await moveProp(page, piano.id, piano.positionMm.x + 100)
  const inspector = await openKeyboardPanel(page, 'inspector')
  await inspector.getByLabel('物件旋转', { exact: true }).fill('13')
  await inspector.getByLabel('物件旋转', { exact: true }).press('Enter'); await keyboardWorkspaceSaved(page)
  panel = await openEnhancement(page, piano.id)
  await expect(panel.getByLabel('画质原图与范围画布', { exact: true })).toHaveAttribute('width', String(firstAsset.pixelWidth))
  await panel.getByLabel('画质改善方向', { exact: true }).selectOption('denoise')
  await (await generate(panel)).nth(1).click()
  await adopt(page, panel); await closeEnhancement(panel)
  const continued = await keyboardProjectBackup(page, info.outputPath('continued.sceneweave')), secondAsset = imageAsset(continued, piano.id)
  expect(secondAsset.imageEnhancement).toMatchObject({ sourceAssetId: firstAsset.id, originalAssetId: originalAsset.id, recipe: { direction: 'denoise', scale: 1 } })
  expect(continued.document.props[piano.id].positionMm.x).toBe(piano.positionMm.x + 100)
  expect(continued.document.props[piano.id].rotationDeg).toBe(13)
  panel = await openEnhancement(page, piano.id)
  await panel.getByLabel('画质处理依据', { exact: true }).selectOption('original')
  await expect(panel.getByLabel('画质原图与范围画布', { exact: true })).toHaveAttribute('width', String(originalAsset.pixelWidth))
  await panel.getByLabel('画质改善方向', { exact: true }).selectOption('edge')
  await generate(panel)
  await panel.getByRole('button', { name: '都不采用', exact: true }).click(); await closeEnhancement(panel)
  expect(imageAsset(await keyboardProjectBackup(page, info.outputPath('original-basis-discarded.sceneweave')), piano.id).id).toBe(secondAsset.id)
  expect(errors).toEqual([])
})

test('local quality scopes survive review while stale candidates cannot replace newer target edits', async ({ page }, info) => {
  test.setTimeout(180000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const { saved: original, filename: originalFile, piano, stool } = await createSourceProject(page, info)
  const originalAsset = imageAsset(original, piano.id)
  const panel = await openEnhancement(page, piano.id)
  await panel.getByLabel('画质改善方向', { exact: true }).selectOption('denoise')
  await panel.getByLabel('画质处理范围', { exact: true }).selectOption('local')
  await panel.getByLabel('画质范围画笔半径', { exact: true }).fill('3')
  await paintScope(page, panel, [{ x: 15, y: 12 }, { x: 21, y: 16 }], true)
  await expect(panel.getByRole('status').filter({ hasText: '已涂' })).toHaveText('已涂 0 个像素')
  await paintScope(page, panel, [{ x: 15, y: 12 }, { x: 21, y: 16 }])
  await expect(panel.getByRole('status').filter({ hasText: '已涂' })).not.toHaveText('已涂 0 个像素')
  await panel.getByRole('button', { name: '撤销范围笔画', exact: true }).click()
  await expect(panel.getByRole('status').filter({ hasText: '已涂' })).toHaveText('已涂 0 个像素')
  await paintScope(page, panel, [{ x: 15, y: 12 }, { x: 21, y: 16 }])
  const workerUrl = /image-enhancement\.worker[^/]*(?:\.ts|\.js)/
  let releaseWorker!: () => void, workerRequested!: () => void, workerReleased!: () => void
  const heldWorker = new Promise<void>(resolve => { releaseWorker = resolve })
  const requestedWorker = new Promise<void>(resolve => { workerRequested = resolve })
  const releasedWorker = new Promise<void>(resolve => { workerReleased = resolve })
  await page.route(workerUrl, async route => {
    workerRequested(); await heldWorker
    try { await route.continue() }
    catch (error) {
      // Terminating the held worker can already complete its cancelled route.
      if (!(error instanceof Error) || !error.message.includes('Route is already handled')) throw error
    } finally { workerReleased() }
  })
  await panel.getByRole('button', { name: '生成 2 个候选', exact: true }).click()
  await requestedWorker
  await page.getByTestId('scene-asset-editor').getByRole('button', { name: '返回场景（保留编辑）', exact: true }).click()
  await moveProp(page, stool.id, stool.positionMm.x + 25)
  await expect(panel).not.toContainText('旧候选仅供对照')
  await page.getByTestId('scene-asset-editor').getByRole('button', { name: '继续编辑素材', exact: true }).click()
  await panel.getByRole('button', { name: '取消处理', exact: true }).click()
  releaseWorker(); await releasedWorker; await page.unroute(workerUrl)
  await expect(panel).toContainText('已取消本次处理')
  await expect(panel.getByRole('group', { name: '画质候选列表', exact: true })).toHaveCount(0)
  await (await generate(panel, 3)).nth(2).click()
  await page.setViewportSize({ width: 390, height: 844 })
  await panel.getByLabel('画质检查背景', { exact: true }).selectOption('black')
  const layout = await panel.evaluate(element => ({ width: element.clientWidth, content: element.scrollWidth }))
  expect(layout.content).toBeLessThanOrEqual(layout.width + 1)
  await panel.screenshot({ path: info.outputPath('local-three-candidates-390.png') })
  await page.setViewportSize({ width: 1512, height: 982 })
  await panel.getByRole('button', { name: '都不采用', exact: true }).click()
  await expect(panel.getByRole('group', { name: '画质候选列表', exact: true })).toHaveCount(0)
  await generate(panel, 3)
  await page.getByTestId('scene-asset-editor').getByRole('button', { name: '返回场景（保留编辑）', exact: true }).click()
  await moveProp(page, stool.id, stool.positionMm.x + 50)
  await expect(panel).not.toContainText('旧候选仅供对照')
  await moveProp(page, piano.id, piano.positionMm.x + 100)
  await expect(panel).toContainText('旧候选仅供对照')
  await page.getByTestId('scene-asset-editor').getByRole('button', { name: '继续编辑素材', exact: true }).click()
  await expect(panel.getByRole('button', { name: '在场景中预览', exact: true })).toBeDisabled()
  await panel.getByRole('button', { name: '读取当前版本', exact: true }).click()
  await expect(panel).not.toContainText('旧候选仅供对照')
  await expect(panel.getByLabel('画质原图与范围画布', { exact: true })).toBeVisible()
  await paintScope(page, panel, [{ x: 15, y: 12 }, { x: 21, y: 16 }])
  await (await generate(panel, 3)).nth(2).click()
  await panel.getByRole('button', { name: '在场景中预览', exact: true }).click()
  await expect(page.getByRole('button', { name: '取消图像预览', exact: true })).toBeVisible({ timeout: 60000 })
  await page.getByRole('button', { name: '取消图像预览', exact: true }).click()
  await page.getByTestId('scene-asset-editor').getByRole('button', { name: '继续编辑素材', exact: true }).click()
  await adopt(page, panel); await closeEnhancement(panel)
  const filename = info.outputPath('local-enhanced.sceneweave'), enhanced = await keyboardProjectBackup(page, filename)
  const asset = imageAsset(enhanced, piano.id), metadata = asset.imageEnhancement!
  expect(metadata.scopeMask).toBeDefined()
  expect(enhanced.document.props[piano.id].positionMm.x).toBe(piano.positionMm.x + 100)
  expect(enhanced.document.props[stool.id].positionMm.x).toBe(stool.positionMm.x + 50)
  const before = await decodedAsset(originalFile, originalAsset.sha256), after = await decodedAsset(filename, asset.sha256)
  const mask = decodeSelectionMask(metadata.scopeMask!, before)
  let changedInside = 0
  for (let y = 0; y < before.height; y++) for (let x = 0; x < before.width; x++) {
    const mx = x - mask.boundsPx.x, my = y - mask.boundsPx.y
    const covered = mx >= 0 && my >= 0 && mx < mask.width && my < mask.height && mask.data[my * mask.width + mx] > 0
    const index = (y * before.width + x) * 4
    const left = [...before.data.slice(index, index + 4)], right = [...after.data.slice(index, index + 4)]
    if (!covered) expect(right).toEqual(left)
    else if (right.some((value, channel) => value !== left[channel])) changedInside++
  }
  expect(changedInside).toBeGreaterThan(0)
  expect(errors).toEqual([])
})

test('explicit edge decontamination keeps alpha, physical semantics and original pixels through adoption and cold open', async ({ page }, info) => {
  test.setTimeout(180000)
  page.setDefaultTimeout(15000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const { saved: original, filename: originalFile, piano, stool } = await createSourceProject(page, info, true)
  const originalAsset = imageAsset(original, piano.id)
  const before = await decodedAsset(originalFile, originalAsset.sha256)
  expect(before.data.some((value: number, index: number) => index % 4 === 3 && value === 0)).toBe(true)
  expect(before.data.some((value: number, index: number) => index % 4 === 3 && value > 0 && value < 255)).toBe(true)
  let panel = await openEnhancement(page, piano.id)
  await panel.getByLabel('画质改善方向', { exact: true }).selectOption('decontaminate')
  await (await generate(panel, 3)).nth(2).click()
  await panel.getByLabel('画质检查背景', { exact: true }).selectOption('white')
  await panel.screenshot({ path: info.outputPath('decontamination-three-candidates.png') })
  await adopt(page, panel); await closeEnhancement(panel)
  const enhancedFile = info.outputPath('decontaminated.sceneweave'), enhanced = await keyboardProjectBackup(page, enhancedFile)
  const asset = imageAsset(enhanced, piano.id), after = await decodedAsset(enhancedFile, asset.sha256)
  expect(asset.imageEnhancement).toMatchObject({ sourceAssetId: originalAsset.id, originalAssetId: originalAsset.id,
    recipe: { direction: 'decontaminate', scale: 1 } })
  expect([after.width, after.height]).toEqual([before.width, before.height])
  let changedRgb = 0, darkLinePixels = 0
  for (let index = 0; index < before.data.length; index += 4) {
    expect(after.data[index + 3]).toBe(before.data[index + 3])
    const rgb = [...before.data.slice(index, index + 3)]
    if (rgb.every(value => value === 5) && before.data[index + 3] === 255) {
      darkLinePixels++
      expect([...after.data.slice(index, index + 3)]).toEqual(rgb)
    }
    if ([0, 1, 2].some(channel => after.data[index + channel] !== before.data[index + channel])) changedRgb++
  }
  expect(changedRgb).toBeGreaterThan(0)
  expect(darkLinePixels).toBeGreaterThan(0)
  const { definitionRef: oldDefinition, appearance: oldAppearance, ...originalSemantics } = piano
  const { definitionRef: newDefinition, appearance: newAppearance, ...enhancedSemantics } = enhanced.document.props[piano.id]
  expect(newDefinition).not.toEqual(oldDefinition)
  expect(newAppearance).not.toEqual(oldAppearance)
  expect(enhancedSemantics).toEqual(originalSemantics)
  expect(enhanced.document.props[stool.id]).toEqual(original.document.props[stool.id])
  expect(enhanced.document.assets[originalAsset.id]).toEqual(originalAsset)
  await page.getByRole('button', { name: '撤销编辑', exact: true }).click(); await keyboardWorkspaceSaved(page)
  expect(imageAsset(await keyboardProjectBackup(page, info.outputPath('decontamination-undone.sceneweave')), piano.id).id).toBe(originalAsset.id)
  await page.getByRole('button', { name: '重做编辑', exact: true }).click(); await keyboardWorkspaceSaved(page)
  expect(imageAsset(await keyboardProjectBackup(page, info.outputPath('decontamination-redone.sceneweave')), piano.id).id).toBe(asset.id)
  await page.reload()
  await page.getByRole('button', { name: '回到首页', exact: true }).click()
  await page.getByTestId('workspace-home').locator(`[data-project-key="native:${enhanced.document.sceneId}"]`).getByRole('button', { name: '打开', exact: true }).click()
  await keyboardWorkspaceSaved(page)
  const coldFile = info.outputPath('decontamination-cold.sceneweave'), cold = await keyboardProjectBackup(page, coldFile)
  expect(keyboardResourceHashes(cold.hashes)).toEqual(keyboardResourceHashes(enhanced.hashes))
  expect((await decodedAsset(coldFile, originalAsset.sha256)).data).toEqual(before.data)
  panel = await openEnhancement(page, piano.id)
  await panel.getByLabel('画质处理依据', { exact: true }).selectOption('original')
  await panel.getByLabel('画质改善方向', { exact: true }).selectOption('decontaminate')
  await generate(panel, 3)
  await panel.getByRole('button', { name: '都不采用', exact: true }).click(); await closeEnhancement(panel)
  expect(imageAsset(await keyboardProjectBackup(page, info.outputPath('decontamination-original-discarded.sceneweave')), piano.id).id).toBe(asset.id)
  expect(errors).toEqual([])
})

test('binary contour candidates preserve colour and support through page adoption, undo and cold open', async ({ page }, info) => {
  test.setTimeout(180000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const { saved: original, filename: originalFile, piano, stool } = await createSourceProject(page, info, false, true)
  const source = imageAsset(original, piano.id), before = await decodedAsset(originalFile, source.sha256)
  let panel = await openEnhancement(page, piano.id)
  await panel.getByLabel('画质改善方向', { exact: true }).selectOption('contour')
  await (await generate(panel, 3)).nth(1).click()
  await panel.getByLabel('画质检查背景', { exact: true }).selectOption('black')
  await panel.getByLabel('画质对照缩放', { exact: true }).selectOption('400')
  await panel.screenshot({ path: info.outputPath('binary-contour-candidates.png') })
  await adopt(page, panel); await closeEnhancement(panel)
  const enhancedFile = info.outputPath('contour.sceneweave'), enhanced = await keyboardProjectBackup(page, enhancedFile)
  const asset = imageAsset(enhanced, piano.id), after = await decodedAsset(enhancedFile, asset.sha256)
  expect(asset.imageEnhancement).toMatchObject({ sourceAssetId: source.id, originalAssetId: source.id,
    recipe: { direction: 'contour', strength: 'balanced', scale: 1 } })
  expect([after.width, after.height]).toEqual([before.width, before.height])
  let changedAlpha = 0
  for (let index = 0; index < before.data.length; index += 4) {
    expect([...after.data.slice(index, index + 3)]).toEqual([...before.data.slice(index, index + 3)])
    expect(after.data[index + 3] > 0).toBe(before.data[index + 3] > 0)
    if (after.data[index + 3] !== before.data[index + 3]) changedAlpha++
  }
  expect(changedAlpha).toBeGreaterThan(0)
  const { definitionRef: oldDefinition, appearance: oldAppearance, ...oldSemantics } = piano
  const { definitionRef: newDefinition, appearance: newAppearance, ...newSemantics } = enhanced.document.props[piano.id]
  expect(newDefinition).not.toEqual(oldDefinition)
  expect(newAppearance).not.toEqual(oldAppearance)
  expect(newSemantics).toEqual(oldSemantics)
  expect(enhanced.document.props[stool.id]).toEqual(original.document.props[stool.id])
  expect(enhanced.document.assets[source.id]).toEqual(source)
  await page.getByRole('button', { name: '撤销编辑', exact: true }).click(); await keyboardWorkspaceSaved(page)
  expect(imageAsset(await keyboardProjectBackup(page, info.outputPath('contour-undone.sceneweave')), piano.id).id).toBe(source.id)
  await page.getByRole('button', { name: '重做编辑', exact: true }).click(); await keyboardWorkspaceSaved(page)
  expect(imageAsset(await keyboardProjectBackup(page, info.outputPath('contour-redone.sceneweave')), piano.id).id).toBe(asset.id)
  await page.reload()
  await page.getByRole('button', { name: '回到首页', exact: true }).click()
  await page.getByTestId('workspace-home').locator(`[data-project-key="native:${enhanced.document.sceneId}"]`).getByRole('button', { name: '打开', exact: true }).click()
  await keyboardWorkspaceSaved(page)
  const coldFile = info.outputPath('contour-cold.sceneweave'), cold = await keyboardProjectBackup(page, coldFile)
  expect(keyboardResourceHashes(cold.hashes)).toEqual(keyboardResourceHashes(enhanced.hashes))
  expect((await decodedAsset(coldFile, source.sha256)).data).toEqual(before.data)
  expect((await decodedAsset(coldFile, asset.sha256)).data).toEqual(after.data)
  panel = await openEnhancement(page, piano.id)
  await panel.getByLabel('画质处理依据', { exact: true }).selectOption('original')
  await panel.getByLabel('画质改善方向', { exact: true }).selectOption('contour')
  await generate(panel, 3)
  await panel.getByRole('button', { name: '都不采用', exact: true }).click(); await closeEnhancement(panel)
  expect(imageAsset(await keyboardProjectBackup(page, info.outputPath('contour-discarded.sceneweave')), piano.id).id).toBe(asset.id)
  expect(errors).toEqual([])
})
