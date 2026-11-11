import { expect, test, type Locator, type Page } from '@playwright/test'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { unzipSync } from 'fflate'
import type { ImageImportRecipe } from '../src/shared/image-import/recipe'
import type { SceneDocument } from '../src/shared/model/scene'
import { createKeyboardProject, keyboardProjectBackup, keyboardResourceHashes, keyboardWorkspaceSaved, openKeyboardPanel, selectKeyboardProp } from './keyboard-ux-helpers'
import { openWorkspaceModule } from './workspace-navigation-helpers'

const { PNG } = createRequire(import.meta.url)('../node_modules/playwright-core/lib/utilsBundle.js')
const width = 96, height = 64
const wood = [140, 100, 60, 255], blue = [50, 110, 150, 255], black = [25, 30, 35, 255]
const room = [{ x: 4, y: 4 }, { x: 92, y: 4 }, { x: 92, y: 60 }, { x: 4, y: 60 }]
const piano = [{ x: 36, y: 24 }, { x: 52, y: 24 }, { x: 52, y: 40 }, { x: 36, y: 40 }]
const rug = [{ x: 24, y: 16 }, { x: 64, y: 16 }, { x: 64, y: 48 }, { x: 24, y: 48 }]

/** Original CI fixture with visible rug and wood donors, independent of reference-image files. */
function sourcePng(): Buffer {
  const png = new PNG({ width, height })
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let color = wood
    if (x >= 24 && x < 64 && y >= 16 && y < 48) color = blue
    if (x >= 36 && x < 52 && y >= 24 && y < 40) color = black
    png.data.set(color, (y * width + x) * 4)
  }
  return PNG.sync.write(png)
}

async function openTool(page: Page): Promise<Locator> {
  await openWorkspaceModule(page, '场景')
  await page.getByRole('button', { name: '从图片新建场景', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '图片导入工作台', exact: true })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('group', { name: '图片导入阶段', exact: true }).getByRole('button', { name: '原图与标定', exact: true }).click()
  await dialog.getByLabel('图片转工程原图', { exact: true }).setInputFiles({ name: 'original-room.png', mimeType: 'image/png', buffer: sourcePng() })
  await expect(dialog).toContainText('96 × 64 px · 已拆 0 层')
  return dialog
}

async function mark(dialog: Locator, mode: string, points: Array<{ x: number; y: number }>): Promise<void> {
  await dialog.getByRole('group', { name: '图片标注工具', exact: true }).getByRole('button', { name: mode, exact: true }).click()
  const canvas = dialog.getByLabel('图片标注画布', { exact: true })
  const bounds = await canvas.boundingBox()
  if (!bounds) throw new Error('图片标注画布未显示。')
  for (const point of points) await canvas.click({ position: { x: point.x / width * bounds.width, y: point.y / height * bounds.height } })
}

async function setGeometry(dialog: Locator): Promise<void> {
  await mark(dialog, '房间轮廓', room)
  await mark(dialog, '比例尺', [{ x: 8, y: 8 }, { x: 28, y: 8 }])
  await dialog.getByRole('group', { name: '图片导入阶段', exact: true }).getByRole('button', { name: '结构与比例', exact: true }).click()
  await dialog.getByLabel('两点间实际距离（毫米）', { exact: true }).fill('1000')
}

async function canvasPixel(dialog: Locator, x: number, y: number): Promise<number[]> {
  return dialog.getByLabel('图片标注画布', { exact: true }).evaluate((node, point) =>
    [...(node as HTMLCanvasElement).getContext('2d')!.getImageData(point.x, point.y, 1, 1).data], { x, y })
}

async function exportRecipe(dialog: Locator, page: Page, filename: string): Promise<ImageImportRecipe> {
  await dialog.getByRole('group', { name: '图片导入阶段', exact: true }).getByRole('button', { name: '原图与标定', exact: true }).click()
  const details = dialog.locator('details').filter({ hasText: '模型拆解提案 JSON' })
  if (await details.getAttribute('open') === null) await details.locator('summary').click()
  const downloading = page.waitForEvent('download')
  await dialog.getByRole('button', { name: '导出当前拆解提案', exact: true }).click()
  await (await downloading).saveAs(filename)
  return JSON.parse(await readFile(filename, 'utf8')) as ImageImportRecipe
}

async function adopt(dialog: Locator, page: Page): Promise<void> {
  await dialog.getByRole('group', { name: '图片导入阶段', exact: true }).getByRole('button', { name: '总览与采用', exact: true }).click()
  await dialog.getByLabel('署名与来源', { exact: true }).fill('Sceneweave CI original fixture')
  await dialog.getByRole('group', { name: '图片导入阶段', exact: true }).getByRole('button', { name: '总览与采用', exact: true }).click()
  await dialog.getByLabel('完整许可', { exact: true }).fill('CC0 1.0 Universal. Original programmatically drawn test fixture.')
  await dialog.getByRole('group', { name: '图片导入阶段', exact: true }).getByRole('button', { name: '总览与采用', exact: true }).click()
  await dialog.getByRole('checkbox', { name: '我确认有权将这些像素和派生素材嵌入工程及个人素材库', exact: true }).check()
  await dialog.getByRole('button', { name: '预览可编辑新工程', exact: true }).click()
  const candidate = page.getByRole('button', { name: '保存并打开副本', exact: true })
  await expect(candidate).toBeVisible({ timeout: 60000 })
  await candidate.click()
  await keyboardWorkspaceSaved(page)
}

async function assertSavedLayers(filename: string, document: SceneDocument): Promise<void> {
  const files = unzipSync(new Uint8Array(await readFile(filename)))
  const raster = (assetId: string) => {
    const asset = document.assets[assetId]
    return PNG.sync.read(Buffer.from(files[`assets/${asset.sha256}.png`])) as { width: number; height: number; data: Uint8Array }
  }
  const color = (image: { width: number; data: Uint8Array }, x: number, y: number) => [...image.data.slice((y * image.width + x) * 4, (y * image.width + x) * 4 + 4)]
  expect(Object.values(document.rooms)).toHaveLength(1)
  expect(Object.values(document.walls)).toHaveLength(4)
  expect(Object.values(document.props).filter(prop => !prop.definitionRef || !document.propDefinitions[prop.definitionRef.id].tags.includes('source-building-art'))).toHaveLength(2)
  const definition = (name: string) => Object.values(document.propDefinitions).find(item => item.name === name)!
  for (const [name, expected] of [['钢琴', black], ['蓝毯', blue]] as const) {
    const appearance = definition(name).defaultAppearance
    expect(appearance.kind).toBe('image')
    if (appearance.kind !== 'image') throw new Error('拆出的物件缺少真实图片。')
    expect(color(raster(appearance.assetId), 4, 4)).toEqual(expected)
  }
  const floor = Object.values(document.rooms)[0].floorStyle!
  const floorAsset = document.materials[floor.base.materialRef.id].textureAssetId
  expect(color(raster(floorAsset), 40, 28)).toEqual(wood)
  expect(color(raster(floorAsset), 60, 44)).toEqual(wood)
  const rugProp = Object.values(document.props).find(item => item.definitionRef?.id === definition('蓝毯').id)!
  expect(rugProp.renderLayer).toBe('ground')
  expect(rugProp.blocksMovement).toBe(false)
}

async function assertPersonalLibrary(page: Page): Promise<void> {
  await openWorkspaceModule(page, '素材')
  const library = page.getByRole('region', { name: '组件素材库', exact: true })
  await library.getByLabel('素材来源', { exact: true }).selectOption('mine')
  await expect.poll(async () => (await library.locator('.catalog-item-copy strong').allTextContents()).sort(), { timeout: 60000 }).toEqual(['图片地板 · 遮挡补全', '蓝毯', '钢琴'])
}

async function coldOpen(page: Page, sceneId: string): Promise<void> {
  await page.reload()
  await page.getByRole('button', { name: '回到首页', exact: true }).click()
  await page.getByTestId('workspace-home').locator(`[data-project-key="native:${sceneId}"]`).getByRole('button', { name: '打开', exact: true }).click()
  await keyboardWorkspaceSaved(page)
}

test('manual source polygons produce editable piano, rug and floor with persistent personal assets', async ({ page }, info) => {
  test.setTimeout(180000)
  page.setDefaultTimeout(15000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await createKeyboardProject(page, '图片导入前的工程')
  const before = await keyboardProjectBackup(page, info.outputPath('before.sceneweave'))
  const dialog = await openTool(page)
  await setGeometry(dialog)
  await dialog.getByRole('group', { name: '图片导入阶段', exact: true }).getByRole('button', { name: '物件与补底', exact: true }).click()
  await dialog.getByLabel('物件名称', { exact: true }).fill('钢琴')
  await mark(dialog, '物件轮廓', piano)
  await mark(dialog, '补底取样', [{ x: 24, y: 16 }, { x: 32, y: 24 }])
  await dialog.getByRole('button', { name: '拆出物件并补底', exact: true }).click()
  await expect(dialog.locator('.image-import-stat').filter({ hasText: '已拆物件与装饰' })).toContainText('1 层')
  await dialog.getByRole('checkbox', { name: '显示钢琴', exact: true }).uncheck()
  await expect.poll(() => canvasPixel(dialog, 40, 28)).toEqual(blue)
  await dialog.getByRole('checkbox', { name: '显示钢琴', exact: true }).check()
  await dialog.getByRole('group', { name: '图片导入阶段', exact: true }).getByRole('button', { name: '物件与补底', exact: true }).click()
  await dialog.getByLabel('物件名称', { exact: true }).fill('蓝毯')
  await dialog.getByRole('combobox', { name: '绘制位置', exact: true }).selectOption('ground')
  await mark(dialog, '物件轮廓', rug)
  await mark(dialog, '补底取样', [{ x: 8, y: 8 }, { x: 16, y: 16 }])
  await dialog.getByRole('button', { name: '拆出物件并补底', exact: true }).click()
  await expect(dialog.locator('.image-import-stat').filter({ hasText: '已拆物件与装饰' })).toContainText('2 层')
  await dialog.getByRole('button', { name: '只看补底', exact: true }).click()
  await expect.poll(() => canvasPixel(dialog, 40, 28)).toEqual(wood)
  await exportRecipe(dialog, page, info.outputPath('manual-recipe.json'))
  await adopt(dialog, page)
  const filename = info.outputPath('manual.sceneweave'), saved = await keyboardProjectBackup(page, filename)
  expect(saved.document.sceneId).not.toBe(before.document.sceneId)
  await assertSavedLayers(filename, saved.document)
  await assertPersonalLibrary(page)
  await coldOpen(page, saved.document.sceneId)
  const reopened = await keyboardProjectBackup(page, info.outputPath('cold.sceneweave'))
  expect(keyboardResourceHashes(reopened.hashes)).toEqual(keyboardResourceHashes(saved.hashes))
  await assertPersonalLibrary(page)
  const prop = Object.values(reopened.document.props).find(item => reopened.document.propDefinitions[item.definitionRef!.id].name === '钢琴')!
  await selectKeyboardProp(page, prop.id)
  const inspector = await openKeyboardPanel(page, 'inspector')
  await inspector.getByLabel('物件 X', { exact: true }).fill(String((prop.positionMm.x + 100) / 1000))
  await inspector.getByLabel('物件 X', { exact: true }).press('Enter')
  await keyboardWorkspaceSaved(page)
  const edited = await keyboardProjectBackup(page, info.outputPath('edited.sceneweave'))
  expect(edited.document.props[prop.id].positionMm.x).toBe(prop.positionMm.x + 100)
  await assertPersonalLibrary(page)
  const library = page.getByRole('region', { name: '组件素材库', exact: true })
  const details = page.getByRole('region', { name: '素材详情面板', exact: true })
  await library.getByRole('button', { name: '查看素材 钢琴', exact: true }).click()
  await details.getByRole('button', { name: '编辑素材副本', exact: true }).click()
  const itemEditor = page.getByRole('form', { name: '编辑素材副本', exact: true })
  await expect(itemEditor.getByLabel('素材副本名称', { exact: true })).toBeEnabled()
  await itemEditor.getByLabel('素材副本名称', { exact: true }).fill('钢琴编辑副本')
  await itemEditor.getByLabel('图片宽度毫米', { exact: true }).fill('600')
  await itemEditor.getByLabel('占地宽度毫米', { exact: true }).fill('500')
  await page.getByRole('button', { name: '保存编辑副本到我的素材', exact: true }).click()
  await expect(itemEditor).toHaveCount(0)
  await expect.poll(async () => (await library.locator('.catalog-item-copy strong').allTextContents()).sort()).toEqual(['图片地板 · 遮挡补全', '蓝毯', '钢琴', '钢琴编辑副本'])
  await coldOpen(page, edited.document.sceneId)
  await openWorkspaceModule(page, '素材')
  await library.getByLabel('素材来源', { exact: true }).selectOption('mine')
  await expect.poll(async () => (await library.locator('.catalog-item-copy strong').allTextContents()).sort()).toEqual(['图片地板 · 遮挡补全', '蓝毯', '钢琴', '钢琴编辑副本'])
  await library.getByRole('button', { name: '查看素材 钢琴编辑副本', exact: true }).click()
  await details.getByRole('button', { name: '编辑素材副本', exact: true }).click()
  await expect(itemEditor.getByLabel('图片宽度毫米', { exact: true })).toHaveValue('600')
  await expect(itemEditor.getByLabel('占地宽度毫米', { exact: true })).toHaveValue('500')
  await page.getByRole('button', { name: '取消编辑副本', exact: true }).click()
  await expect(library.getByRole('button', { name: '放置组件 钢琴', exact: true })).toBeEnabled()
  await expect(library.getByRole('button', { name: '放置组件 蓝毯', exact: true })).toBeEnabled()
  await expect(library.getByRole('button', { name: '添加并放置 钢琴编辑副本', exact: true })).toBeEnabled()
  expect(errors).toEqual([])
})

test('strict model recipe uses the same source-pixel split and refuses a different source identity', async ({ page }, info) => {
  test.setTimeout(180000)
  page.setDefaultTimeout(15000)
  await createKeyboardProject(page, '提案导入前的工程')
  const dialog = await openTool(page)
  await setGeometry(dialog)
  const base = await exportRecipe(dialog, page, info.outputPath('empty-recipe.json'))
  const recipe: ImageImportRecipe = { ...base, title: '提案重建房间', layers: [
    { id: 'recipe-piano', name: '钢琴', polygon: piano, donor: { x: 24, y: 16, width: 8, height: 8 }, renderLayer: 'object', blocksMovement: true },
    { id: 'recipe-rug', name: '蓝毯', polygon: rug, donor: { x: 8, y: 8, width: 8, height: 8 }, renderLayer: 'ground', blocksMovement: false },
  ] }
  await dialog.getByRole('group', { name: '图片导入阶段', exact: true }).getByRole('button', { name: '原图与标定', exact: true }).click()
  const upload = async (value: ImageImportRecipe) => dialog.getByLabel('载入提案', { exact: true }).setInputFiles({
    name: 'recipe.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value)),
  })
  await upload({ ...recipe, image: { ...recipe.image, sha256: '0'.repeat(64) } })
  await expect(dialog.getByRole('alert')).toContainText('原图摘要或尺寸不同')
  await expect(dialog.locator('.image-import-stat').filter({ hasText: '已拆物件与装饰' })).toContainText('0 层')
  await upload(recipe)
  await expect(dialog.locator('.image-import-stat').filter({ hasText: '已拆物件与装饰' })).toContainText('2 层')
  await expect(dialog.getByRole('alert')).toHaveCount(0)
  await dialog.getByRole('checkbox', { name: '显示钢琴', exact: true }).uncheck()
  await expect.poll(() => canvasPixel(dialog, 40, 28)).toEqual(blue)
  await dialog.getByRole('checkbox', { name: '显示蓝毯', exact: true }).uncheck()
  await expect.poll(() => canvasPixel(dialog, 40, 28)).toEqual(wood)
  await adopt(dialog, page)
  const filename = info.outputPath('recipe.sceneweave'), saved = await keyboardProjectBackup(page, filename)
  await assertSavedLayers(filename, saved.document)
  await assertPersonalLibrary(page)
  await coldOpen(page, saved.document.sceneId)
  const reopened = await keyboardProjectBackup(page, info.outputPath('recipe-cold.sceneweave'))
  expect(keyboardResourceHashes(reopened.hashes)).toEqual(keyboardResourceHashes(saved.hashes))
})
