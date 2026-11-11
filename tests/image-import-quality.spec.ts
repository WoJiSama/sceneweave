import { expect, test, type Locator, type Page } from '@playwright/test'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { unzipSync } from 'fflate'
import type { ImageImportRecipe } from '../src/shared/image-import/recipe'
import { createKeyboardProject, keyboardProjectBackup, keyboardResourceHashes, keyboardWorkspaceSaved } from './keyboard-ux-helpers'
import { openWorkspaceModule } from './workspace-navigation-helpers'

const { PNG } = createRequire(import.meta.url)('../node_modules/playwright-core/lib/utilsBundle.js')
const width = 400, height = 240
const blue = [50, 110, 150, 255], wood = [140, 100, 60, 255], black = [25, 30, 35, 255]
const room = [{ x: 20, y: 20 }, { x: 380, y: 20 }, { x: 380, y: 220 }, { x: 20, y: 220 }]

function sourcePng(): Buffer {
  const png = new PNG({ width, height })
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const object = x >= 180 && x < 220 && y >= 80 && y < 140
    png.data.set(object ? black : x < 200 ? blue : wood, (y * width + x) * 4)
  }
  return PNG.sync.write(png)
}

async function clickPoints(dialog: Locator, points: Array<{ x: number; y: number }>): Promise<void> {
  const canvas = dialog.getByLabel('图片标注画布', { exact: true })
  const bounds = await canvas.boundingBox()
  if (!bounds) throw new Error('图片画布未显示。')
  for (const point of points) await canvas.click({ position: { x: point.x / width * bounds.width, y: point.y / height * bounds.height } })
}

async function mark(dialog: Locator, mode: string, points: Array<{ x: number; y: number }>): Promise<void> {
  await dialog.getByRole('group', { name: '图片标注工具', exact: true }).getByRole('button', { name: mode, exact: true }).click()
  await clickPoints(dialog, points)
}

async function downloadRecipe(dialog: Locator, page: Page, file: string): Promise<ImageImportRecipe> {
  await dialog.getByRole('group', { name: '图片导入阶段', exact: true }).getByRole('button', { name: '原图与标定', exact: true }).click()
  const details = dialog.locator('details').filter({ hasText: '模型拆解提案 JSON' })
  if (await details.getAttribute('open') === null) await details.locator('summary').click()
  const pending = page.waitForEvent('download')
  await dialog.getByRole('button', { name: '导出当前拆解提案', exact: true }).click()
  await (await pending).saveAs(file)
  return JSON.parse(await readFile(file, 'utf8')) as ImageImportRecipe
}

test('near-view vertex edits preserve image coordinates and explicit repair regions survive adoption', async ({ page }, info) => {
  test.setTimeout(180000)
  page.setDefaultTimeout(15000)
  await createKeyboardProject(page, '近景修边前工程')
  await openWorkspaceModule(page, '场景')
  await page.getByRole('button', { name: '从图片新建场景', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '图片导入工作台', exact: true })
  await dialog.getByRole('group', { name: '图片导入阶段', exact: true }).getByRole('button', { name: '原图与标定', exact: true }).click()
  await dialog.getByLabel('图片转工程原图', { exact: true }).setInputFiles({ name: 'two-surfaces.png', mimeType: 'image/png', buffer: sourcePng() })
  await expect(dialog).toContainText('400 × 240 px · 已拆 0 层')
  await mark(dialog, '房间轮廓', room)
  await mark(dialog, '比例尺', [{ x: 40, y: 40 }, { x: 140, y: 40 }])
  await dialog.getByRole('group', { name: '图片导入阶段', exact: true }).getByRole('button', { name: '结构与比例', exact: true }).click()
  await dialog.getByLabel('两点间实际距离（毫米）', { exact: true }).fill('1000')
  await dialog.getByRole('button', { name: '房间轮廓', exact: true }).click()
  await dialog.getByLabel('图片缩放', { exact: true }).selectOption('400')
  const canvas = dialog.getByLabel('图片标注画布', { exact: true })
  await canvas.evaluate(node => { node.parentElement!.scrollLeft = 0; node.parentElement!.scrollTop = 0 })
  const bounds = await canvas.boundingBox()
  if (!bounds) throw new Error('放大的图片画布未显示。')
  expect(bounds.width).toBe(width * 4)
  await page.mouse.move(bounds.x + 20 * 4, bounds.y + 20 * 4)
  await page.mouse.down()
  await page.mouse.move(bounds.x + 28 * 4, bounds.y + 24 * 4, { steps: 5 })
  await page.mouse.up()
  const moved = await downloadRecipe(dialog, page, info.outputPath('moved-vertex.json'))
  expect(moved.roomPointsPx).toEqual([{ x: 28, y: 24 }, ...room.slice(1)])
  await dialog.getByRole('button', { name: '撤销标注', exact: true }).click()
  const restored = await downloadRecipe(dialog, page, info.outputPath('restored-vertex.json'))
  expect(restored.roomPointsPx).toEqual(room)
  const scrollPosition = () => canvas.evaluate(node => ({ left: node.parentElement!.scrollLeft, top: node.parentElement!.scrollTop }))
  await canvas.evaluate(node => { node.parentElement!.scrollLeft = 160; node.parentElement!.scrollTop = 80 })
  const scrolled = await scrollPosition()
  for (const name of ['只看补底', '拆层合成', '原图']) {
    await dialog.getByRole('button', { name, exact: true }).click()
    expect(await scrollPosition()).toEqual(scrolled)
  }
  await dialog.getByLabel('图片缩放', { exact: true }).selectOption('fit')
  await dialog.getByRole('group', { name: '图片导入阶段', exact: true }).getByRole('button', { name: '物件与补底', exact: true }).click()
  await dialog.getByLabel('物件名称', { exact: true }).fill('跨界钢琴')
  await mark(dialog, '物件轮廓', [{ x: 180, y: 80 }, { x: 220, y: 80 }, { x: 220, y: 140 }, { x: 180, y: 140 }])
  await mark(dialog, '补底取样', [{ x: 80, y: 40 }, { x: 120, y: 60 }])
  const fillSettings = dialog.locator('details').filter({ hasText: '分区补底' })
  await fillSettings.locator('summary').click()
  await fillSettings.getByRole('button', { name: '画补底分区', exact: true }).click()
  await clickPoints(dialog, [{ x: 200, y: 80 }, { x: 220, y: 80 }, { x: 220, y: 140 }, { x: 200, y: 140 }])
  await fillSettings.getByRole('button', { name: '分区取样', exact: true }).click()
  await clickPoints(dialog, [{ x: 280, y: 40 }, { x: 320, y: 60 }])
  await fillSettings.getByRole('button', { name: '添加补底分区', exact: true }).click()
  await dialog.getByRole('button', { name: '拆出物件并补底', exact: true }).click()
  await expect(dialog.locator('.image-import-stat').filter({ hasText: '已拆物件与装饰' })).toContainText('1 层')
  await dialog.getByRole('checkbox', { name: '显示跨界钢琴', exact: true }).uncheck()
  const pixel = (x: number) => canvas.evaluate((node, x) => [...(node as HTMLCanvasElement).getContext('2d')!.getImageData(x, 110, 1, 1).data], x)
  await expect.poll(() => pixel(190)).toEqual(blue)
  await expect.poll(() => pixel(210)).toEqual(wood)
  const recipe = await downloadRecipe(dialog, page, info.outputPath('repair-regions.json'))
  expect(recipe.layers[0].repair).toBe('seamless')
  expect(recipe.layers[0].cleanupPx).toBe(0)
  expect(recipe.layers[0].fills).toEqual([{ polygon: [{ x: 200, y: 80 }, { x: 220, y: 80 }, { x: 220, y: 140 }, { x: 200, y: 140 }], donor: { x: 280, y: 40, width: 40, height: 20 } }])
  await dialog.getByRole('group', { name: '图片导入阶段', exact: true }).getByRole('button', { name: '总览与采用', exact: true }).click()
  await dialog.getByLabel('署名与来源', { exact: true }).fill('Sceneweave original synthetic quality fixture')
  await dialog.getByRole('group', { name: '图片导入阶段', exact: true }).getByRole('button', { name: '总览与采用', exact: true }).click()
  await dialog.getByLabel('完整许可', { exact: true }).fill('CC0 1.0 Universal. Synthetic test fixture.')
  await dialog.getByRole('group', { name: '图片导入阶段', exact: true }).getByRole('button', { name: '总览与采用', exact: true }).click()
  await dialog.getByRole('checkbox', { name: '我确认有权将这些像素和派生素材嵌入工程及个人素材库', exact: true }).check()
  await dialog.getByRole('button', { name: '预览可编辑新工程', exact: true }).click()
  await page.getByRole('button', { name: '保存并打开副本', exact: true }).click()
  await keyboardWorkspaceSaved(page)
  const file = info.outputPath('repair-regions.sceneweave')
  const saved = await keyboardProjectBackup(page, file)
  const floor = Object.values(saved.document.rooms)[0].floorStyle!
  const material = saved.document.materials[floor.base.materialRef.id]
  const hash = saved.document.assets[material.textureAssetId].sha256
  const files = unzipSync(new Uint8Array(await readFile(file)))
  const png = PNG.sync.read(Buffer.from(files[`assets/${hash}.png`]))
  const savedPixel = (x: number) => {
    const px = Math.round((x * 10 - floor.base.originMm.x) / floor.base.tileSizeMm.width * png.width)
    const py = Math.round((110 * 10 - floor.base.originMm.y) / floor.base.tileSizeMm.height * png.height)
    return [...png.data.slice((py * png.width + px) * 4, (py * png.width + px) * 4 + 4)]
  }
  expect(savedPixel(190)).toEqual(blue)
  expect(savedPixel(210)).toEqual(wood)
})

test('aligned repair remains explicit across recipe reload, two-material extraction, adoption and cold open', async ({ page }, info) => {
  test.setTimeout(180000)
  page.setDefaultTimeout(15000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await createKeyboardProject(page, '纹理接缝对齐前工程')
  await openWorkspaceModule(page, '场景')
  await page.getByRole('button', { name: '从图片新建场景', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '图片导入工作台', exact: true })
  await dialog.getByRole('group', { name: '图片导入阶段', exact: true }).getByRole('button', { name: '原图与标定', exact: true }).click()
  await dialog.getByLabel('图片转工程原图', { exact: true }).setInputFiles({ name: 'aligned-two-surfaces.png', mimeType: 'image/png', buffer: sourcePng() })
  await expect(dialog).toContainText('400 × 240 px · 已拆 0 层')
  await mark(dialog, '房间轮廓', room)
  await mark(dialog, '比例尺', [{ x: 40, y: 40 }, { x: 140, y: 40 }])
  await dialog.getByRole('group', { name: '图片导入阶段', exact: true }).getByRole('button', { name: '结构与比例', exact: true }).click()
  await dialog.getByLabel('两点间实际距离（毫米）', { exact: true }).fill('1000')
  await dialog.getByRole('group', { name: '图片导入阶段', exact: true }).getByRole('button', { name: '物件与补底', exact: true }).click()
  await dialog.getByLabel('物件名称', { exact: true }).fill('对齐补底跨界钢琴')
  await dialog.getByRole('combobox', { name: /^补底方式/ }).selectOption('aligned')
  await mark(dialog, '物件轮廓', [{ x: 180, y: 80 }, { x: 220, y: 80 }, { x: 220, y: 140 }, { x: 180, y: 140 }])
  await mark(dialog, '补底取样', [{ x: 80, y: 40 }, { x: 120, y: 60 }])
  const fillSettings = dialog.locator('details').filter({ hasText: '分区补底' })
  await fillSettings.locator('summary').click()
  await fillSettings.getByRole('button', { name: '画补底分区', exact: true }).click()
  await clickPoints(dialog, [{ x: 200, y: 80 }, { x: 220, y: 80 }, { x: 220, y: 140 }, { x: 200, y: 140 }])
  await fillSettings.getByRole('button', { name: '分区取样', exact: true }).click()
  await clickPoints(dialog, [{ x: 280, y: 40 }, { x: 320, y: 60 }])
  await fillSettings.getByRole('button', { name: '添加补底分区', exact: true }).click()
  await dialog.getByRole('button', { name: '拆出物件并补底', exact: true }).click()
  await expect(dialog.locator('.image-import-stat').filter({ hasText: '已拆物件与装饰' })).toContainText('1 层')
  const recipeFile = info.outputPath('aligned-repair.json'), recipe = await downloadRecipe(dialog, page, recipeFile)
  expect(recipe.layers[0].repair).toBe('aligned')
  expect(recipe.layers[0].cleanupPx).toBe(0)
  expect(recipe.layers[0].fills).toHaveLength(1)
  await dialog.getByRole('group', { name: '图片导入阶段', exact: true }).getByRole('button', { name: '原图与标定', exact: true }).click()
  await dialog.getByLabel('载入提案', { exact: true }).setInputFiles(recipeFile)
  await expect(dialog.getByRole('status').filter({ hasText: '已载入同一原图' })).toBeVisible()
  const replayed = await downloadRecipe(dialog, page, info.outputPath('aligned-reloaded.json'))
  expect(replayed).toEqual(recipe)
  await dialog.getByRole('button', { name: '只看补底', exact: true }).click()
  const canvas = dialog.getByLabel('图片标注画布', { exact: true })
  const pixel = (x: number) => canvas.evaluate((node, x) => [...(node as HTMLCanvasElement).getContext('2d')!.getImageData(x, 110, 1, 1).data], x)
  await expect.poll(() => pixel(190)).toEqual(blue)
  await expect.poll(() => pixel(210)).toEqual(wood)
  await dialog.getByRole('group', { name: '图片导入阶段', exact: true }).getByRole('button', { name: '总览与采用', exact: true }).click()
  await dialog.getByLabel('署名与来源', { exact: true }).fill('Sceneweave original aligned two-material browser fixture')
  await dialog.getByRole('group', { name: '图片导入阶段', exact: true }).getByRole('button', { name: '总览与采用', exact: true }).click()
  await dialog.getByLabel('完整许可', { exact: true }).fill('CC0 1.0 Universal. Original synthetic test pixels.')
  await dialog.getByRole('group', { name: '图片导入阶段', exact: true }).getByRole('button', { name: '总览与采用', exact: true }).click()
  await dialog.getByRole('checkbox', { name: '我确认有权将这些像素和派生素材嵌入工程及个人素材库', exact: true }).check()
  await dialog.getByRole('button', { name: '预览可编辑新工程', exact: true }).click()
  await page.getByRole('button', { name: '保存并打开副本', exact: true }).click()
  await keyboardWorkspaceSaved(page)
  const file = info.outputPath('aligned-repair.sceneweave'), saved = await keyboardProjectBackup(page, file)
  const floor = Object.values(saved.document.rooms)[0].floorStyle!
  const material = saved.document.materials[floor.base.materialRef.id]
  const asset = saved.document.assets[material.textureAssetId]
  const files = unzipSync(new Uint8Array(await readFile(file)))
  const output = PNG.sync.read(Buffer.from(files[`assets/${asset.sha256}.png`])), source = PNG.sync.read(sourcePng())
  // The saved floor texture is cropped to the marked room, whose origin is
  // (20, 20) on the source grid. Check every saved pixel in that source frame.
  const crop = { x: 20, y: 20, width: 360, height: 200 }
  expect([output.width, output.height]).toEqual([crop.width, crop.height])
  const expected = Buffer.alloc(crop.width * crop.height * 4)
  for (let y = 0; y < crop.height; y++) for (let x = 0; x < crop.width; x++) {
    const sx = x + crop.x, sy = y + crop.y, from = (sy * width + sx) * 4
    const repaired = sx >= 180 && sx < 220 && sy >= 80 && sy < 140
    expected.set(repaired ? sx < 200 ? blue : wood : source.data.subarray(from, from + 4), (y * crop.width + x) * 4)
  }
  expect(output.data).toEqual(expected)
  await page.reload()
  await page.getByRole('button', { name: '回到首页', exact: true }).click()
  await page.getByTestId('workspace-home').locator(`[data-project-key="native:${saved.document.sceneId}"]`).getByRole('button', { name: '打开', exact: true }).click()
  await keyboardWorkspaceSaved(page)
  const cold = await keyboardProjectBackup(page, info.outputPath('aligned-repair-cold.sceneweave'))
  expect(keyboardResourceHashes(cold.hashes)).toEqual(keyboardResourceHashes(saved.hashes))
  expect(errors).toEqual([])
})

test('source diagnostics distinguish prior repairs from original evidence without changing the recipe', async ({ page }, info) => {
  test.setTimeout(120000)
  page.setDefaultTimeout(15000)
  await createKeyboardProject(page, '拆层来源检查')
  await openWorkspaceModule(page, '场景')
  await page.getByRole('button', { name: '从图片新建场景', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '图片导入工作台', exact: true })
  await dialog.getByRole('group', { name: '图片导入阶段', exact: true }).getByRole('button', { name: '原图与标定', exact: true }).click()
  await dialog.getByLabel('图片转工程原图', { exact: true }).setInputFiles({ name: 'source-evidence.png', mimeType: 'image/png', buffer: sourcePng() })
  await expect(dialog).toContainText('400 × 240 px · 已拆 0 层')
  await mark(dialog, '房间轮廓', room)
  await mark(dialog, '比例尺', [{ x: 40, y: 40 }, { x: 140, y: 40 }])
  await dialog.getByRole('group', { name: '图片导入阶段', exact: true }).getByRole('button', { name: '结构与比例', exact: true }).click()
  await dialog.getByLabel('两点间实际距离（毫米）', { exact: true }).fill('1000')
  const proposal = await downloadRecipe(dialog, page, info.outputPath('before-source-evidence.json'))
  proposal.layers = [
    { id: 'first', name: '前层物件', polygon: [{ x: 80, y: 80 }, { x: 100, y: 80 }, { x: 100, y: 100 }, { x: 80, y: 100 }],
      donor: { x: 40, y: 40, width: 10, height: 10 }, renderLayer: 'object', blocksMovement: false, repair: 'tile' },
    { id: 'second', name: '后层物件', polygon: [{ x: 90, y: 80 }, { x: 110, y: 80 }, { x: 110, y: 100 }, { x: 90, y: 100 }],
      donor: { x: 80, y: 80, width: 5, height: 10 }, renderLayer: 'object', blocksMovement: false, repair: 'tile' },
  ]
  await dialog.getByRole('group', { name: '图片导入阶段', exact: true }).getByRole('button', { name: '原图与标定', exact: true }).click()
  await dialog.getByLabel('载入提案', { exact: true }).setInputFiles({ name: 'layer-sources.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(proposal)) })
  await dialog.getByRole('group', { name: '图片导入阶段', exact: true }).getByRole('button', { name: '总览与采用', exact: true }).click()
  const diagnostics = dialog.getByLabel('拆层来源检查', { exact: true })
  await expect(diagnostics).toContainText('200 个像素来自前序补底')
  await expect(diagnostics).toContainText('框内 50 个像素来自前序补底')
  await expect(diagnostics).toContainText('尚未统计算法实际读取量')
  expect(await downloadRecipe(dialog, page, info.outputPath('after-source-evidence.json'))).toEqual(proposal)
  await dialog.getByRole('group', { name: '图片导入阶段', exact: true }).getByRole('button', { name: '总览与采用', exact: true }).click()
  await diagnostics.scrollIntoViewIfNeeded()
  await page.screenshot({ path: info.outputPath('source-evidence-diagnostics.png') })
})
