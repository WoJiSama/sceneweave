import { expect, test, type Locator, type Page } from '@playwright/test'
import { createRequire } from 'node:module'
import { readFile, writeFile } from 'node:fs/promises'
import { unzipSync } from 'fflate'
import type { ImageImportRecipe } from '../src/shared/image-import/recipe'
import type { PointMm, SceneDocument } from '../src/shared/model/scene'
import { checkTerrainRoute } from '../src/shared/geometry/terrain-travel.js'
import { projectScene } from '../src/shared/projection/projection.js'
import { createKeyboardProject, keyboardProjectBackup, keyboardResourceHashes, keyboardWorkspaceSaved, openKeyboardPanel, selectKeyboardProp } from './keyboard-ux-helpers'
import { openBuildingTask, openSceneObjects, openWorkspaceModule } from './workspace-navigation-helpers'
import { mapExportButton, openDetailsBySummary } from './workspace-ux-helpers'

const { PNG } = createRequire(import.meta.url)('../node_modules/playwright-core/lib/utilsBundle.js')
const width = 96, height = 64
const wood = [140, 100, 60, 255], blue = [50, 110, 150, 255], black = [25, 30, 35, 255]
const room = [{ x: 4, y: 4 }, { x: 92, y: 4 }, { x: 92, y: 60 }, { x: 4, y: 60 }]
const piano = [{ x: 36, y: 24 }, { x: 52, y: 24 }, { x: 52, y: 40 }, { x: 36, y: 40 }]
const rug = [{ x: 24, y: 16 }, { x: 64, y: 16 }, { x: 64, y: 48 }, { x: 24, y: 48 }]

/** Original CI fixture with visible rug and wood donors, independent of reference-image files. */
function sourcePng(withSecret = false): Buffer {
  const png = new PNG({ width, height })
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let color = wood
    if (x >= 24 && x < 64 && y >= 16 && y < 48) color = blue
    if (x >= 36 && x < 52 && y >= 24 && y < 40) color = black
    if (withSecret) {
      if (color === wood && y % 6 === 0) color = [112, 82, 54, 255]
      if (color === blue && (x === 25 || x === 62 || y === 17 || y === 46)) color = [160, 151, 116, 255]
      if (color === black && y === 26 && ((x >= 39 && x <= 41) || (x >= 47 && x <= 49))) color = [186, 148, 94, 255]
      const paintedWall = x >= 65 && x <= 90 && y >= 7 && y <= 29 && (x === 65 || x === 90 || y <= 9 || y === 29)
      if (paintedWall) color = [61, 55, 51, 255]
      if (x >= 76 && x < 82 && y >= 17 && y < 23) color = [207, 31, 97, 255]
    }
    png.data.set(color, (y * width + x) * 4)
  }
  return PNG.sync.write(png)
}

async function openTool(page: Page, buffer = sourcePng(), filename = 'original-room.png'): Promise<Locator> {
  await openWorkspaceModule(page, '场景')
  await page.getByRole('button', { name: '从图片新建场景', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '图片导入工作台', exact: true })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('group', { name: '图片导入阶段', exact: true }).getByRole('button', { name: '原图与标定', exact: true }).click()
  await dialog.getByLabel('图片转工程原图', { exact: true }).setInputFiles({ name: filename, mimeType: 'image/png', buffer })
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

async function readMapPng(page: Page, audience: 'gm' | 'player', output: string, bounds: SceneDocument['exportBoundsMm']) {
  const downloading = page.waitForEvent('download')
  await (await mapExportButton(page, audience)).click()
  await (await downloading).saveAs(output)
  const bytes = await readFile(output)
  const raster = PNG.sync.read(bytes)
  expect(Math.max(raster.width, raster.height)).toBe(4096)
  for (let offset = 8; offset < bytes.length; offset += 12 + bytes.readUInt32BE(offset)) {
    expect(['IHDR', 'IDAT', 'IEND', 'PLTE', 'tRNS', 'sRGB']).toContain(bytes.toString('ascii', offset + 4, offset + 8))
  }
  await page.locator('details.workspace-export-menu > summary').click()
  return (point: PointMm) => {
    const x = Math.floor((point.x - bounds.x) * raster.width / bounds.width)
    const y = Math.floor((point.y - bounds.y) * raster.height / bounds.height)
    const index = (y * raster.width + x) * 4
    return [...raster.data.subarray(index, index + 4)]
  }
}

test('calibrates an unstructured map, extracts one item, and adds playable structure and privacy on demand', async ({ page, browser }, info) => {
  test.setTimeout(180000)
  page.setDefaultTimeout(15000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await createKeyboardProject(page, '图片底图验收')
  const source = sourcePng(true)
  await writeFile(info.outputPath('00-source-map.png'), source)
  const dialog = await openTool(page, source, '酒馆旧底图.png')
  const stages = dialog.getByRole('group', { name: '图片导入阶段', exact: true })
  await mark(dialog, '比例尺', [{ x: 8, y: 8 }, { x: 28, y: 8 }])
  await stages.getByRole('button', { name: '结构与比例', exact: true }).click()
  await dialog.getByLabel('两点间实际距离（毫米）', { exact: true }).fill('2000')
  await stages.getByRole('button', { name: '物件与补底', exact: true }).click()
  await dialog.getByLabel('物件名称', { exact: true }).fill('酒馆立柜')
  await expect(dialog.getByLabel('阻挡移动', { exact: true })).not.toBeChecked()
  await mark(dialog, '物件轮廓', piano)
  await mark(dialog, '补底取样', [{ x: 27, y: 19 }, { x: 35, y: 27 }])
  await dialog.getByRole('button', { name: '拆出物件并补底', exact: true }).click()
  await expect(dialog.locator('.image-import-stat').filter({ hasText: '已拆物件与装饰' })).toContainText('1 层')
  await adopt(dialog, page)
  const initial = await keyboardProjectBackup(page, info.outputPath('01-bottom-and-item.sceneweave'))
  const floor = Object.values(initial.document.floors)[0], art = floor.artwork!
  expect(art.boundsMm).toEqual({ x: 0, y: 0, width: 9600, height: 6400 })
  expect(Object.keys(initial.document.rooms)).toEqual([])
  expect(Object.keys(initial.document.walls)).toEqual([])
  expect(Object.keys(initial.document.terrainAreas)).toEqual([])
  const [prop] = Object.values(initial.document.props)
  expect(prop).toMatchObject({ blocksMovement: false, blocksSight: false, supportRef: { kind: 'floor', id: floor.id } })
  expect(prop.roomId).toBeUndefined()
  expect(initial.document.assets[art.assetId]).toMatchObject({ pixelWidth: 96, pixelHeight: 64 })
  const cabinetRoute = { floorId: floor.id, widthMm: 350, pointsMm: [{ x: 2500, y: 3250 }, { x: 6000, y: 3250 }] }
  const doorwayRoute = { floorId: floor.id, widthMm: 350, pointsMm: [{ x: 7750, y: 300 }, { x: 7750, y: 2600 }] }
  expect(checkTerrainRoute(initial.document, cabinetRoute)).toMatchObject({ ok: true })
  expect(checkTerrainRoute(initial.document, doorwayRoute)).toMatchObject({ ok: true })

  await selectKeyboardProp(page, prop.id)
  const posX = page.getByLabel('物件 X', { exact: true })
  await posX.fill('1.4'); await posX.press('Enter'); await keyboardWorkspaceSaved(page)
  const moved = await readMapPng(page, 'gm', info.outputPath('02-item-moved.png'), art.boundsMm)
  expect(moved({ x: 4450, y: 3250 })).toEqual(blue)
  expect(moved({ x: 1450, y: 3250 })).toEqual(black)
  expect(moved({ x: 7750, y: 850 })).toEqual([61, 55, 51, 255])

  const review = page.getByRole('region', { name: '候选审阅', exact: true }).and(page.locator('.workspace-candidate-review'))
  const adoptStructure = async () => {
    await review.getByLabel('确认完整影响范围', { exact: true }).check()
    const collateral = review.getByLabel('确认遮罩对公开内容的影响', { exact: true })
    if (await collateral.count()) await collateral.check()
    await review.getByRole('button', { name: '采用结构修改', exact: true }).click()
    await keyboardWorkspaceSaved(page)
  }
  const selectStructure = async (id: string) => {
    const objects = await openSceneObjects(page, '结构')
    const all = objects.getByRole('button', { name: '显示所有图层的对象', exact: true })
    if (await all.isVisible()) await all.click()
    await objects.getByLabel('搜索场景对象', { exact: true }).fill(id)
    await objects.locator('[data-entity-id=' + JSON.stringify(id) + ']').click()
    return openKeyboardPanel(page, 'inspector')
  }
  const setMetres = async (form: Locator, label: string, value: string) => {
    const field = form.getByLabel(label, { exact: true })
    await field.fill(value); await field.press('Tab')
  }
  const roomForm = await openBuildingTask(page)
  await roomForm.getByLabel('房间名称', { exact: true }).fill('库房')
  await openDetailsBySummary(roomForm, /^精确位置$/)
  for (const [label, value] of [['房间起点 X', '6.5'], ['房间起点 Y', '0.8'], ['房间宽度', '2.5'], ['房间高度', '2.1']]) {
    await setMetres(roomForm, label, value)
  }
  await roomForm.getByRole('button', { name: '预览新房间', exact: true }).click()
  await adoptStructure()
  const withRoom = (await keyboardProjectBackup(page, info.outputPath('03-room.sceneweave'))).document
  expect(checkTerrainRoute(withRoom, doorwayRoute).issues.map(issue => issue.code)).toContain('TERRAIN_TRAVEL_WALL')
  const [room] = Object.values(withRoom.rooms)
  const wall = Object.values(withRoom.walls).find(value => withRoom.vertices[value.startVertexId].yMm === 800 && withRoom.vertices[value.endVertexId].yMm === 800)!
  let inspector = await selectStructure(wall.id)
  await setMetres(inspector, '开口近端偏移', '0.75')
  await setMetres(inspector, '开口净宽', '1')
  await inspector.getByLabel('门窗状态', { exact: true }).selectOption('open')
  await inspector.getByRole('button', { name: '预览新增门窗', exact: true }).click()
  await adoptStructure()
  const withDoor = (await keyboardProjectBackup(page, info.outputPath('04-door.sceneweave'))).document
  expect(checkTerrainRoute(withDoor, doorwayRoute)).toMatchObject({ ok: true })

  inspector = await selectStructure(room.id)
  await inspector.getByLabel('房间可见性', { exact: true }).selectOption('gm')
  await inspector.getByLabel(/^同时设为秘密入口 /).check()
  await inspector.getByLabel('秘密房间线索', { exact: true }).fill('底图验收 · 私藏账簿')
  await inspector.getByRole('button', { name: '预览房间属性', exact: true }).click()
  for (const audience of ['主持人', '玩家']) await expect(review.getByRole('img', { name: '候选' + audience + '地图', exact: true })).toBeVisible()
  await adoptStructure()
  const file = info.outputPath('05-ready-for-table.sceneweave')
  const saved = await keyboardProjectBackup(page, file)
  expect(saved.document.floors[floor.id].artwork).toEqual(art)
  expect(saved.document.props[prop.id].positionMm).toEqual({ x: 1400, y: prop.positionMm.y })
  expect(Object.values(saved.document.openings)).toEqual([expect.objectContaining({ wallId: wall.id, secret: true, revealed: false })])
  const publicView = projectScene(saved.document, 'player', undefined, { floorId: floor.id })
  expect(publicView.rooms).toHaveLength(0)
  expect(publicView.notes).toHaveLength(0)
  expect(publicView.walls.flatMap(row => row.openings)).toHaveLength(0)
  const publicPoint = { x: 4450, y: 3250 }, secretPoint = { x: 7950, y: 2050 }
  const gm = await readMapPng(page, 'gm', info.outputPath('06-gm.png'), art.boundsMm)
  const player = await readMapPng(page, 'player', info.outputPath('07-player.png'), art.boundsMm)
  expect(gm(secretPoint)).toEqual([207, 31, 97, 255])
  expect(player(secretPoint)).toEqual([216, 213, 197, 255])
  expect(player(publicPoint)).toEqual(blue)
  expect(player({ x: 1450, y: 3250 })).toEqual(black)

  const empty = await browser.newContext()
  try {
    const fresh = await empty.newPage()
    fresh.on('pageerror', error => errors.push(error.message))
    await fresh.goto(new URL('./#home', page.url()).href)
    const chooser = fresh.waitForEvent('filechooser')
    await fresh.getByTestId('workspace-home').getByRole('button', { name: '打开工程文件', exact: true }).click()
    await (await chooser).setFiles(file)
    await keyboardWorkspaceSaved(fresh)
    const reloaded = await keyboardProjectBackup(fresh, info.outputPath('08-cold-open.sceneweave'))
    for (const key of ['floors', 'walls', 'openings', 'rooms', 'props', 'notes', 'regions'] as const) {
      expect(reloaded.document[key]).toEqual(saved.document[key])
    }
    expect(keyboardResourceHashes(reloaded.hashes)).toEqual(keyboardResourceHashes(saved.hashes))
    await fresh.getByRole('button', { name: '玩家', exact: true }).click()
    await expect(fresh.getByLabel('材质场景玩家预览', { exact: true })).toBeVisible()
    await keyboardWorkspaceSaved(fresh)
    await fresh.screenshot({ path: info.outputPath('09-cold-player-canvas.png') })
    await readMapPng(fresh, 'player', info.outputPath('10-cold-player.png'), art.boundsMm)
    expect(await readFile(info.outputPath('10-cold-player.png'))).toEqual(await readFile(info.outputPath('07-player.png')))
  } finally { await empty.close() }
  expect(errors).toEqual([])
})
