import { expect, test, type Locator } from '@playwright/test'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { unzipSync } from 'fflate'
import type { ImageImportRecipe } from '../src/shared/image-import/recipe'
import { createKeyboardProject, keyboardProjectBackup, keyboardWorkspaceSaved } from './keyboard-ux-helpers'
import { openWorkspaceModule } from './workspace-navigation-helpers'
import { mapExportButton } from './workspace-ux-helpers'

const { PNG } = createRequire(import.meta.url)('../node_modules/playwright-core/lib/utilsBundle.js')
const width = 96, height = 64
const ink = [22, 19, 24, 255], wood = [127, 97, 69, 255], piano = [34, 51, 72, 255]

function fixture(): Buffer {
  const png = new PNG({ width, height })
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const wall = x < 6 || x >= 90 || y < 6 || y >= 58
    const key = y === 12 + Math.floor(x / 15) && x > 16 && x < 78
    const furniture = x >= 36 && x < 52 && y >= 24 && y < 40
    png.data.set(wall || key ? ink : furniture ? piano : wood, (y * width + x) * 4)
  }
  return PNG.sync.write(png)
}

async function mark(dialog: Locator, mode: string, points: number[][]): Promise<void> {
  await dialog.getByRole('group', { name: '图片标注工具', exact: true }).getByRole('button', { name: mode, exact: true }).click()
  const canvas = dialog.getByLabel('图片标注画布', { exact: true })
  const bounds = await canvas.boundingBox()
  if (!bounds) throw new Error('图片标注画布未显示。')
  for (const [x, y] of points) await canvas.click({ position: { x: x / width * bounds.width, y: y / height * bounds.height } })
}

function pixel(image: { width: number; data: Uint8Array }, x: number, y: number): number[] {
  const offset = (y * image.width + x) * 4
  return [...image.data.slice(offset, offset + 4)]
}

test('refuses a legacy redraw, retains its annotations and saves source colors and black wall art', async ({ page }, info) => {
  test.setTimeout(120_000)
  await createKeyboardProject(page, '保真导入前工程')
  await openWorkspaceModule(page, '场景')
  await page.getByRole('button', { name: '从图片新建场景', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '图片导入工作台', exact: true })
  await dialog.getByRole('group', { name: '图片导入阶段', exact: true }).getByRole('button', { name: '原图与标定', exact: true }).click()
  await dialog.getByLabel('图片转工程原图', { exact: true }).setInputFiles({ name: 'original.png', mimeType: 'image/png', buffer: fixture() })
  await expect(dialog).toContainText('96 × 64 px · 已拆 0 层')
  await mark(dialog, '原图保留范围', [[2, 2], [94, 2], [94, 62], [2, 62]])
  await mark(dialog, '房间轮廓', [[6, 6], [90, 6], [90, 58], [6, 58]])
  await mark(dialog, '比例尺', [[8, 8], [28, 8]])
  await dialog.getByRole('group', { name: '图片导入阶段', exact: true }).getByRole('button', { name: '结构与比例', exact: true }).click()
  await dialog.getByLabel('两点间实际距离（毫米）', { exact: true }).fill('1000')
  await dialog.getByRole('group', { name: '图片导入阶段', exact: true }).getByRole('button', { name: '总览与采用', exact: true }).click()
  await dialog.getByLabel('署名与来源', { exact: true }).fill('Sceneweave synthetic image')
  await dialog.getByRole('group', { name: '图片导入阶段', exact: true }).getByRole('button', { name: '总览与采用', exact: true }).click()
  await dialog.getByLabel('完整许可', { exact: true }).fill('CC0 1.0 Universal. Original synthetic fixture.')
  await dialog.getByRole('group', { name: '图片导入阶段', exact: true }).getByRole('button', { name: '总览与采用', exact: true }).click()
  await dialog.getByRole('checkbox', { name: '我确认有权将这些像素和派生素材嵌入工程及个人素材库', exact: true }).check()
  await dialog.getByRole('group', { name: '图片导入阶段', exact: true }).getByRole('button', { name: '原图与标定', exact: true }).click()
  await dialog.locator('details').filter({ hasText: '模型拆解提案 JSON' }).locator('summary').click()
  const download = page.waitForEvent('download')
  await dialog.getByRole('button', { name: '导出当前拆解提案', exact: true }).click()
  const recipeFile = info.outputPath('source-recipe.json')
  await (await download).saveAs(recipeFile)
  const recipe = JSON.parse(await readFile(recipeFile, 'utf8')) as ImageImportRecipe
  const vector = { kind: 'trace', colors: 8, simplifyPx: 0, smoothingRadius: 0, longEdgePx: 512 }
  const legacy = { ...recipe, floorVector: { ...vector, kind: 'wood' }, layers: [{ id: 'piano', name: '原图钢琴',
    polygon: [{ x: 36, y: 24 }, { x: 52, y: 24 }, { x: 52, y: 40 }, { x: 36, y: 40 }],
    donor: { x: 10, y: 28, width: 8, height: 8 }, renderLayer: 'object', blocksMovement: true, vector }] }
  await dialog.getByRole('group', { name: '图片导入阶段', exact: true }).getByRole('button', { name: '原图与标定', exact: true }).click()
  await dialog.getByLabel('载入提案', { exact: true }).setInputFiles({ name: 'legacy.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(legacy)) })
  await dialog.getByRole('group', { name: '图片导入阶段', exact: true }).getByRole('button', { name: '总览与采用', exact: true }).click()
  await expect(dialog.getByText('旧提案含矢量描摹或材质重绘，会改变原画，采用已暂停。', { exact: true })).toBeVisible()
  const prepare = dialog.getByRole('button', { name: '预览可编辑新工程', exact: true })
  await expect(prepare).toBeDisabled()
  await dialog.getByRole('button', { name: '恢复原图外观', exact: true }).click()
  await expect(dialog.locator('.image-import-stat').filter({ hasText: '已拆物件与装饰' })).toContainText('1 层')
  await dialog.getByRole('group', { name: '图片导入阶段', exact: true }).getByRole('button', { name: '结构与比例', exact: true }).click()
  await expect(dialog).toContainText('保留范围 4 点 · 房间 4 点')
  await expect(prepare).toBeEnabled()
  await dialog.getByRole('group', { name: '图片导入阶段', exact: true }).getByRole('button', { name: '原图与标定', exact: true }).click()
  await dialog.getByLabel('原色像素放大倍数', { exact: true }).selectOption('2')
  await dialog.getByRole('group', { name: '图片导入阶段', exact: true }).getByRole('button', { name: '总览与采用', exact: true }).click()
  const report = dialog.getByRole('region', { name: '原图保真对照', exact: true })
  await expect(report).toContainText('同坐标像素检查通过')
  await expect(report).toContainText('改变 0 像素')
  await expect(report).toContainText('遮挡 256 像素')
  await dialog.getByRole('button', { name: '推断区', exact: true }).click()
  const canvas = dialog.getByLabel('图片标注画布', { exact: true })
  const readPiano = () => canvas.evaluate(node => [...(node as HTMLCanvasElement).getContext('2d')!.getImageData(44, 32, 1, 1).data])
  await expect.poll(readPiano).not.toEqual(piano)
  await dialog.getByRole('button', { name: '原图', exact: true }).click()
  await dialog.getByRole('checkbox', { name: '显示标注', exact: true }).uncheck()
  await expect.poll(readPiano).toEqual(piano)
  await prepare.click()
  await page.getByRole('button', { name: '保存并打开副本', exact: true }).click({ timeout: 60_000 })
  await keyboardWorkspaceSaved(page)

  const projectFile = info.outputPath('source-faithful.sceneweave')
  const { document } = await keyboardProjectBackup(page, projectFile)
  const files = unzipSync(new Uint8Array(await readFile(projectFile)))
  const raster = (assetId: string) => PNG.sync.read(Buffer.from(files[`assets/${document.assets[assetId].sha256}.png`]))
  const paint = Object.values(document.rooms)[0].floorStyle!
  const floor = raster(document.materials[paint.base.materialRef.id].textureAssetId)
  expect([floor.width, floor.height]).toEqual([184, 120])
  expect(pixel(floor, (32 - 2) * 2, (14 - 2) * 2)).toEqual(ink)
  expect(pixel(floor, (32 - 2) * 2 + 1, (14 - 2) * 2 + 1)).toEqual(ink)
  expect(pixel(floor, (44 - 2) * 2, (32 - 2) * 2)).toEqual(wood)
  for (const wall of Object.values(document.walls)) {
    expect(wall.topStyle).toEqual(paint)
    expect(wall.thicknessMm).toBe(250)
  }
  const theme = document.styleThemes[document.activeStyleThemeRef!.id]
  expect(theme.outline.widthMm).toBe(0)
  expect(Object.values(theme.shadowPresets).every(preset => preset.opacity === 0)).toBe(true)
  const art = Object.values(document.props).find(prop => document.propDefinitions[prop.definitionRef!.id].tags.includes('source-building-art'))!
  expect(art).toMatchObject({ editLocked: true, blocksMovement: false, roomId: Object.keys(document.rooms)[0], appearance: { kind: 'image' } })
  if (art.appearance.kind !== 'image') throw new Error('缺少原图墙沿。')
  expect(pixel(raster(art.appearance.assetId), 2, 2)).toEqual(ink)
  expect(pixel(raster(art.appearance.assetId), 84, 60)[3]).toBe(0)

  const pngDownload = page.waitForEvent('download')
  await (await mapExportButton(page, 'player')).click()
  const nativeFile = info.outputPath('source-faithful-native.png')
  await (await pngDownload).saveAs(nativeFile)
  const native = PNG.sync.read(await readFile(nativeFile))
  const bounds = document.exportBoundsMm
  // The physical inner wall edge crosses plain wood at x=8.5 source pixels.
  // A zero-width silhouette must not darken that antialiased edge.
  const edgeX = Math.floor((8.5 * 50 - bounds.x) * native.width / bounds.width)
  const edgeY = Math.floor((30 * 50 - bounds.y) * native.height / bounds.height)
  for (let x = edgeX - 2; x <= edgeX + 2; x++) {
    const color = pixel(native, x, edgeY)
    expect(Math.max(...color.map((channel, index) => Math.abs(channel - wood[index])))).toBeLessThanOrEqual(1)
  }
})
