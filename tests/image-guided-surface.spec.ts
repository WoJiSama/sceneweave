import { test, expect, type Page } from '@playwright/test'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { writeImageWorkPackage, readImageWorkPackage, type ImageWorkState } from '../src/shared/image-import/workflow'
import { sha256Bytes } from '../src/shared/project/binary'

const { PNG } = createRequire(import.meta.url)('../node_modules/playwright-core/lib/utilsBundle.js')
const width = 128, height = 96
const rectangle = (x: number, y: number, w: number, h: number) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }]
const initialGuidance = { orientation: 'soft' as const, guides: [] }
const guidance = { orientation: 'soft', guides: [{ points: [{ x: 52, y: 49 }, { x: 76, y: 49 }], reference: { x: 10, y: 46, width: 16, height: 7 }, axis: 'horizontal', reason: '左侧可见单条窄缝，人工推断它在椅子遮挡内水平延伸。' }] }

async function fixture(isolated = false) {
  const png = new PNG({ width, height })
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const object = x >= 52 && x < 76 && y >= 40 && y < 60, ink = y === 49 && (!isolated || x >= 10 && x < 26) ? -54 : 0
    png.data.set(object ? [22, 28, 33, 255] : [156 + ink + x % 3, 125 + ink + x % 3, 93 + ink + x % 3, 255], (y * width + x) * 4)
  }
  const bytes = new Uint8Array(PNG.sync.write(png)), hash = sha256Bytes(bytes)
  const state: ImageWorkState = { format: 'sceneweave-image-work', version: 1, id: 'guided-surface-ui', revision: 1,
    image: { sha256: hash, pixelWidth: width, pixelHeight: height }, original: { name: 'wood.png', sha256: hash, sizeBytes: bytes.length, mimeType: 'image/png' },
    draft: { title: '结构辅助底材', calibration: { first: { x: 0, y: 0 }, second: { x: 50, y: 0 }, distanceMm: 1000 }, roomPointsPx: rectangle(3, 3, 122, 90),
      repairSurfaces: [{ id: 'wood', name: '木板表面', kind: 'guided', mask: { x: 4, y: 4, width: 120, height: 88, runs: [10560, 255] }, donor: { x: 8, y: 8, width: 20, height: 20 }, guided: initialGuidance }],
      layers: [{ id: 'chair', name: '椅子', polygon: rectangle(52, 40, 24, 20), donor: { x: 8, y: 8, width: 20, height: 20 }, renderLayer: 'object', blocksMovement: true, repair: 'surfaces', repairSurfaceIds: ['wood'], appearanceSource: 'original', selectionMask: { x: 52, y: 40, width: 24, height: 20, runs: [480, 255] } }] },
    rights: { licenseText: 'Synthetic original test pixels', attribution: 'Synthetic test', canEmbed: true }, notes: '', nextAction: '添加显式结构辅助并检查', scaleStatus: 'provisional', journal: [], reviews: [] }
  return { bytes, state }
}
async function openWork(page: Page, file: string | { name: string; mimeType: string; buffer: Buffer }) {
  await page.goto('/')
  await page.getByRole('button', { name: '从图片新建场景', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '图片导入工作台', exact: true })
  await dialog.getByLabel('打开图片制作工作包', { exact: true }).setInputFiles(file)
  await expect(dialog.getByRole('button', { name: '分析椅子补底与邻域', exact: true })).toBeEnabled()
  await dialog.getByRole('group', { name: '图片导入阶段', exact: true }).getByRole('button', { name: '物件与补底', exact: true }).click()
  await dialog.locator('details.image-import-fill-settings > summary').click()
  return dialog
}

test('a smaller material can be inspected alone without persisting analysis choices or changing repair pixels', async ({ page, browser }, info) => {
  const input = await fixture(), original = input.state.draft.repairSurfaces![0]
  input.state.draft.repairSurfaces = [
    { ...original, id: 'first', name: '左侧底材', mask: { x: 4, y: 4, width: 62, height: 88, runs: [5456, 255] } },
    { ...original, id: 'second', name: '右侧底材' },
  ]
  input.state.draft.layers[0].repairSurfaceIds = ['first', 'second']
  const pack = await writeImageWorkPackage(input.state, input.bytes, input.bytes)
  const dialog = await openWork(page, { name: 'focus.sceneweave-image-work', mimeType: 'application/octet-stream', buffer: Buffer.from(pack) })
  const download = async (name: string) => {
    const pending = page.waitForEvent('download'); await dialog.getByRole('button', { name: '导出制作工作包', exact: true }).click()
    const file = info.outputPath(name); await (await pending).saveAs(file); return { file, pack: await readImageWorkPackage(new Uint8Array(await readFile(file))) }
  }
  const before = await download('before.sceneweave-image-work')
  await dialog.getByRole('button', { name: '分析椅子补底与邻域', exact: true }).click()
  const analysis = dialog.getByRole('region', { name: '补底与邻域分析', exact: true }), select = analysis.getByLabel('单独检查底材', { exact: true })
  await expect(select).toHaveValue('')
  await expect(analysis.locator('[aria-label="邻域底材 左侧底材"]')).toContainText('实际移除最多的结构辅助表面')
  await select.selectOption('second')
  await expect(select).toHaveValue('second')
  await expect(analysis.locator('[aria-label="邻域底材 右侧底材"]')).toContainText('本次指定的结构辅助表面')
  await expect(analysis.locator('[aria-label="邻域底材 左侧底材"]')).toContainText('此表面未执行该项检查')
  await analysis.scrollIntoViewIfNeeded(); await page.screenshot({ path: info.outputPath('selected-smaller-material.png') })
  await select.selectOption(''); await expect(select).toHaveValue('')
  await expect(analysis.locator('[aria-label="邻域底材 左侧底材"]')).toContainText('实际移除最多的结构辅助表面')
  const after = await download('after.sceneweave-image-work')
  expect({ ...after.pack.state, revision: 0 }).toEqual({ ...before.pack.state, revision: 0 })
  expect(after.pack.original).toEqual(before.pack.original); expect(after.pack.normalized).toEqual(before.pack.normalized)
  const context = await browser.newContext()
  try {
    const cold = await context.newPage(), restored = await openWork(cold, after.file)
    await restored.getByRole('button', { name: '分析椅子补底与邻域', exact: true }).click()
    await expect(restored.getByLabel('单独检查底材', { exact: true })).toHaveValue('')
    await restored.getByLabel('单独检查底材', { exact: true }).selectOption('second')
    await expect(restored.locator('[aria-label="邻域底材 右侧底材"]')).toContainText('本次指定的结构辅助表面')
  } finally { await context.close() }
})

test('original 2D ink assistance preserves a long seam, rejects hidden references and cold replays exactly', async ({ page, browser }, info) => {
  test.setTimeout(180000)
  const input = await fixture()
  const png = PNG.sync.read(Buffer.from(input.bytes))
  for (const [x, y] of [[12, 21], [13, 21], [12, 22], [23, 22]]) png.data.set([62, 47, 33, 255], (y * width + x) * 4)
  const bytes = new Uint8Array(PNG.sync.write(png)), hash = sha256Bytes(bytes)
  input.state.image.sha256 = hash; input.state.original.sha256 = hash; input.state.original.sizeBytes = bytes.length
  const dialog = await openWork(page, { name: 'ink.sceneweave-image-work', mimeType: 'application/octet-stream', buffer: Buffer.from(await writeImageWorkPackage(input.state, bytes, bytes)) })
  const surface = dialog.getByRole('group', { name: '底材表面 木板表面', exact: true }), json = dialog.getByLabel('结构辅助JSON', { exact: true })
  const detailPatches = [{ role: 'nails', reference: { x: 8, y: 18, width: 20, height: 15 }, target: { x: 54, y: 42 }, reason: '以完整二维钉点辅助局部；目标位置是人工推断，长缝应保持。' }]
  const combined = { ...guidance, detailPatches }
  await surface.getByRole('button', { name: '载入结构辅助到编辑框', exact: true }).click()
  await json.fill(JSON.stringify(guidance)); await surface.getByRole('button', { name: '应用结构辅助并重放', exact: true }).click()
  const canvas = dialog.getByLabel('图片标注画布', { exact: true })
  const pixel = async (x: number, y: number) => {
    await dialog.getByRole('button', { name: '只看补底', exact: true }).click()
    return canvas.evaluate((c: HTMLCanvasElement, p) => Array.from(c.getContext('2d')!.getImageData(p.x, p.y, 1, 1).data), { x, y })
  }
  const baseNail = await pixel(58, 45), baseSeam = await pixel(64, 49)
  await json.fill(JSON.stringify(combined)); await surface.getByRole('button', { name: '应用结构辅助并重放', exact: true }).click()
  await expect(surface).toContainText('二维笔迹1 · nails')
  // Sample from the background without the source/target annotation rectangles.
  expect((await pixel(58, 45))[0]).toBeLessThan(baseNail[0] - 30)
  expect(await pixel(64, 49)).toEqual(baseSeam)
  await dialog.getByRole('button', { name: '分析椅子补底与邻域', exact: true }).click()
  await expect(dialog.getByRole('region', { name: '补底与邻域分析', exact: true })).toContainText('只在当前获准补区合入深色笔触')
  const pending = page.waitForEvent('download'); await dialog.getByRole('button', { name: '导出制作工作包', exact: true }).click()
  const file = info.outputPath('ink.sceneweave-image-work'); await (await pending).saveAs(file)
  const saved = await readImageWorkPackage(new Uint8Array(await readFile(file)))
  expect(saved.state.version).toBe(1); expect(saved.state.draft.repairSurfaces![0].guided).toEqual(combined)
  expect(saved.original).toEqual(bytes); expect(saved.normalized).toEqual(bytes)
  await json.fill(JSON.stringify({ ...combined, detailPatches: [{ ...detailPatches[0], reference: { x: 54, y: 42, width: 20, height: 15 } }] }))
  await surface.getByRole('button', { name: '应用结构辅助并重放', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('二维笔迹参考整块须为可信原图')
  expect(await pixel(64, 49)).toEqual(baseSeam)
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
  try {
    const cold = await context.newPage(), restored = await openWork(cold, file)
    await restored.getByRole('group', { name: '底材表面 木板表面', exact: true }).getByRole('button', { name: '载入结构辅助到编辑框', exact: true }).click()
    expect(JSON.parse(await restored.getByLabel('结构辅助JSON', { exact: true }).inputValue())).toEqual(combined)
    const coldCanvas = restored.getByLabel('图片标注画布', { exact: true })
    await restored.getByRole('button', { name: '只看补底', exact: true }).click()
    expect(await coldCanvas.evaluate((c: HTMLCanvasElement) => Array.from(c.getContext('2d')!.getImageData(64, 49, 1, 1).data))).toEqual(baseSeam)
    await cold.screenshot({ path: info.outputPath('ink-cold-390.png') })
  } finally { await context.close() }
})

test('finite original seam columns are explicit, cold-replayable, and reject a short source atomically', async ({ page, browser }, info) => {
  test.setTimeout(180000)
  const input = await fixture()
  const png = PNG.sync.read(Buffer.from(input.bytes))
  // The 32 source columns have visible displacement and a real two-column gap.
  for (let y = 44; y < 55; y++) for (let x = 8; x < 40; x++) png.data.set([157 - (y - 44) * 2, 126 - (y - 44) * 2, 94 - (y - 44) * 2, 255], (y * width + x) * 4)
  for (let x = 8; x < 40; x++) if (x !== 29 && x !== 30) png.data.set([80, 63, 46, 255], ((x >= 18 && x < 26 ? 50 : 49) * width + x) * 4)
  const bytes = new Uint8Array(PNG.sync.write(png)), hash = sha256Bytes(bytes)
  input.state.image.sha256 = hash; input.state.original.sha256 = hash; input.state.original.sizeBytes = bytes.length
  const dialog = await openWork(page, { name: 'original-seam.sceneweave-image-work', mimeType: 'application/octet-stream', buffer: Buffer.from(await writeImageWorkPackage(input.state, bytes, bytes)) })
  const surface = dialog.getByRole('group', { name: '底材表面 木板表面', exact: true }), json = dialog.getByLabel('结构辅助JSON', { exact: true })
  const legacy = { orientation: 'soft', guides: [{ ...guidance.guides[0], stroke: 'original-segment', reference: { x: 8, y: 44, width: 32, height: 11 } }] }
  const native = { ...legacy, guides: [{ ...legacy.guides[0], paper: 'two-sided' }] }
  await surface.getByRole('button', { name: '载入结构辅助到编辑框', exact: true }).click(); await json.fill(JSON.stringify(legacy))
  await surface.getByRole('button', { name: '应用结构辅助并重放', exact: true }).click()
  await dialog.getByRole('button', { name: '只看补底', exact: true }).click()
  const oldPaper = await dialog.getByLabel('图片标注画布', { exact: true }).evaluate((c: HTMLCanvasElement) => Array.from(c.getContext('2d')!.getImageData(55, 46, 18, 8).data))
  await surface.getByRole('button', { name: '载入结构辅助到编辑框', exact: true }).click(); await json.fill(JSON.stringify(native))
  await surface.getByRole('button', { name: '应用结构辅助并重放', exact: true }).click()
  await expect(surface).toContainText('原尺寸二维接缝')
  await expect(surface).toContainText('两侧底色取墨')
  await dialog.getByRole('button', { name: '只看补底', exact: true }).click()
  const canvas = dialog.getByLabel('图片标注画布', { exact: true }), before = await canvas.evaluate((c: HTMLCanvasElement) => Array.from(c.getContext('2d')!.getImageData(55, 46, 18, 8).data))
  expect(before).not.toEqual(oldPaper)
  await dialog.getByRole('button', { name: '分析椅子补底与邻域', exact: true }).click()
  await expect(dialog.getByRole('region', { name: '补底与邻域分析', exact: true })).toContainText('完整原来源')
  await expect(dialog.getByRole('region', { name: '补底与邻域分析', exact: true })).toContainText('每列两端各2行拟合底色')
  const pending = page.waitForEvent('download'); await dialog.getByRole('button', { name: '导出制作工作包', exact: true }).click()
  const file = info.outputPath('original-seam.sceneweave-image-work'); await (await pending).saveAs(file)
  const saved = await readImageWorkPackage(new Uint8Array(await readFile(file))); expect(saved.state.draft.repairSurfaces![0].guided).toEqual(native)
  const short = { ...native, guides: [{ ...native.guides[0], reference: { x: 8, y: 44, width: 10, height: 11 } }] }
  await json.fill(JSON.stringify(short)); await surface.getByRole('button', { name: '应用结构辅助并重放', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('超过可信原参考')
  await dialog.getByRole('button', { name: '只看补底', exact: true }).click()
  expect(await canvas.evaluate((c: HTMLCanvasElement) => Array.from(c.getContext('2d')!.getImageData(55, 46, 18, 8).data))).toEqual(before)
  const context = await browser.newContext()
  try {
    const cold = await context.newPage(), restored = await openWork(cold, file)
    const restoredSurface = restored.getByRole('group', { name: '底材表面 木板表面', exact: true })
    await restoredSurface.getByRole('button', { name: '载入结构辅助到编辑框', exact: true }).click()
    expect(JSON.parse(await restored.getByLabel('结构辅助JSON', { exact: true }).inputValue())).toEqual(native)
    await restored.getByRole('button', { name: '只看补底', exact: true }).click()
    expect(await restored.getByLabel('图片标注画布', { exact: true }).evaluate((c: HTMLCanvasElement) => Array.from(c.getContext('2d')!.getImageData(55, 46, 18, 8).data))).toEqual(before)
    await cold.screenshot({ path: info.outputPath('original-seam-cold.png') })
  } finally { await context.close() }
})

test('a declared source gap replaces only generated ink, survives cold replay and rejects an implicit erase', async ({ page, browser }, info) => {
  test.setTimeout(180000)
  const input = await fixture(), dialog = await openWork(page, { name: 'gap.sceneweave-image-work', mimeType: 'application/octet-stream', buffer: Buffer.from(await writeImageWorkPackage(input.state, input.bytes, input.bytes)) })
  const surface = dialog.getByRole('group', { name: '底材表面 木板表面', exact: true }), json = dialog.getByLabel('结构辅助JSON', { exact: true })
  await surface.getByRole('button', { name: '载入结构辅助到编辑框', exact: true }).click()
  await json.fill(JSON.stringify(guidance)); await surface.getByRole('button', { name: '应用结构辅助并重放', exact: true }).click()
  const canvas = dialog.getByLabel('图片标注画布', { exact: true })
  const pixel = async (x: number, y: number) => {
    await dialog.getByRole('button', { name: '只看补底', exact: true }).click()
    return canvas.evaluate((c: HTMLCanvasElement, p) => Array.from(c.getContext('2d')!.getImageData(p.x, p.y, 1, 1).data), { x, y })
  }
  const seam = await pixel(64, 49), outside = await pixel(55, 49), paper = await pixel(64, 54)
  const replacement = { role: 'gap', mode: 'replace-ink', blendPx: 3, reference: { x: 8, y: 8, width: 10, height: 11 }, target: { x: 59, y: 44 }, reason: '此小段留原图同材质断口，隐藏位置属于人工推断，底色和细纹独立保持。' }
  const combined = { ...guidance, detailPatches: [replacement] }
  await json.fill(JSON.stringify(combined)); await surface.getByRole('button', { name: '应用结构辅助并重放', exact: true }).click()
  await expect(surface).toContainText('替换生成笔迹，保留底色与细纹')
  await expect(surface).toContainText('过渡3px')
  const gap = await pixel(64, 49)
  expect(gap[0]).toBeGreaterThan(seam[0] + 30); expect(await pixel(55, 49)).toEqual(outside); expect(await pixel(64, 54)).toEqual(paper)
  await dialog.getByRole('button', { name: '分析椅子补底与邻域', exact: true }).click()
  await expect(dialog.getByRole('region', { name: '补底与邻域分析', exact: true })).toContainText('仅替换本次生成笔迹')
  const pending = page.waitForEvent('download'); await dialog.getByRole('button', { name: '导出制作工作包', exact: true }).click()
  const file = info.outputPath('gap.sceneweave-image-work'); await (await pending).saveAs(file)
  const saved = await readImageWorkPackage(new Uint8Array(await readFile(file)))
  expect(saved.state.draft.repairSurfaces![0].guided).toEqual(combined); expect(saved.original).toEqual(input.bytes)
  await json.fill(JSON.stringify({ ...combined, detailPatches: [{ ...replacement, mode: undefined }] })); await surface.getByRole('button', { name: '应用结构辅助并重放', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('断口必须显式替换')
  expect(await pixel(64, 49)).toEqual(gap)
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
  try {
    const cold = await context.newPage(), restored = await openWork(cold, file)
    await restored.getByRole('group', { name: '底材表面 木板表面', exact: true }).getByRole('button', { name: '载入结构辅助到编辑框', exact: true }).click()
    expect(JSON.parse(await restored.getByLabel('结构辅助JSON', { exact: true }).inputValue())).toEqual(combined)
    await restored.getByRole('button', { name: '只看补底', exact: true }).click()
    expect(await restored.getByLabel('图片标注画布', { exact: true }).evaluate((c: HTMLCanvasElement) => Array.from(c.getContext('2d')!.getImageData(64, 49, 1, 1).data))).toEqual(gap)
    await cold.screenshot({ path: info.outputPath('gap-cold-390.png') })
  } finally { await context.close() }
})

test('explicit structure JSON survives atomic replay, rejected references and cold work-package restoration', async ({ page, browser }, info) => {
  test.setTimeout(180000)
  const input = await fixture()
  const dialog = await openWork(page, { name: 'guided.sceneweave-image-work', mimeType: 'application/octet-stream', buffer: Buffer.from(await writeImageWorkPackage(input.state, input.bytes, input.bytes)) })
  const surface = dialog.getByRole('group', { name: '底材表面 木板表面', exact: true })
  await surface.getByRole('button', { name: '载入结构辅助到编辑框', exact: true }).click()
  const json = dialog.getByLabel('结构辅助JSON', { exact: true })
  expect(JSON.parse(await json.inputValue())).toEqual(initialGuidance)
  await dialog.getByLabel('载入结构辅助JSON', { exact: true }).setInputFiles({ name: 'guide.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(guidance)) })
  expect(JSON.parse(await json.inputValue())).toEqual(guidance)
  await surface.getByRole('button', { name: '应用结构辅助并重放', exact: true }).click()
  await expect(surface).toContainText('左侧可见单条窄缝')
  await expect(surface).toContainText('已采用结构辅助 · soft · 1条')
  await dialog.getByRole('button', { name: '分析椅子补底与邻域', exact: true }).click()
  const report = dialog.getByRole('region', { name: '补底与邻域分析', exact: true })
  await expect(report).toContainText('改变隐藏区域的推断结构')
  const main = dialog.getByLabel('图片标注画布', { exact: true })
  const rgba = (x: number, y: number) => main.evaluate((canvas: HTMLCanvasElement, { x, y }) => Array.from(canvas.getContext('2d')!.getImageData(x, y, 1, 1).data), { x, y })
  const line = await rgba(64, 49), floor = await rgba(64, 54)
  expect(line[0]).toBeLessThan(floor[0] - 20)
  const downloading = page.waitForEvent('download')
  await dialog.getByRole('button', { name: '导出制作工作包', exact: true }).click()
  const filename = info.outputPath('guided.sceneweave-image-work'); await (await downloading).saveAs(filename)
  const saved = await readImageWorkPackage(new Uint8Array(await readFile(filename)))
  expect(saved.state.version).toBe(1)
  expect(saved.state.draft.repairSurfaces![0].guided).toEqual(guidance)
  // A deliberately shortened line is a local judgment, independent of the
  // reference stroke's suitability. Locating it must not silently extend it.
  const shortened = { ...guidance, guides: [{ ...guidance.guides[0], points: [{ x: 52, y: 49 }, { x: 70, y: 49 }] }] }
  await json.fill(JSON.stringify(shortened))
  await surface.getByRole('button', { name: '应用结构辅助并重放', exact: true }).click()
  await dialog.getByRole('button', { name: '分析椅子补底与邻域', exact: true }).click()
  const endpoints = report.locator('[aria-label="结构端点依据 木板表面"]')
  await endpoints.locator(':scope > summary').click()
  await expect(endpoints).toContainText('不自动延长')
  await expect(endpoints).toContainText('板头')
  await endpoints.getByRole('button', { name: '定位结构端点', exact: true }).click()
  expect(JSON.parse((await main.getAttribute('data-neighborhood-bounds'))!)).toEqual({ x: 66, y: 45, width: 9, height: 9 })
  await surface.getByRole('button', { name: '载入结构辅助到编辑框', exact: true }).click()
  expect(JSON.parse(await json.inputValue())).toEqual(shortened)
  await json.fill(JSON.stringify(guidance))
  await surface.getByRole('button', { name: '应用结构辅助并重放', exact: true }).click()
  await dialog.getByRole('button', { name: '分析椅子补底与邻域', exact: true }).click()
  await expect(endpoints).toHaveCount(0)
  // Editing a proposed JSON invalidates the old report; a bad reference cannot replace the surface.
  const invalid = { ...guidance, guides: [{ ...guidance.guides[0], reference: { x: 56, y: 46, width: 16, height: 7 } }] }
  await json.fill(JSON.stringify(invalid))
  await expect(report).toHaveCount(0)
  await surface.getByRole('button', { name: '应用结构辅助并重放', exact: true }).click()
  await expect(dialog.getByRole('alert').filter({ hasText: '结构参考' })).toBeVisible()
  await surface.getByRole('button', { name: '载入结构辅助到编辑框', exact: true }).click()
  expect(JSON.parse(await json.inputValue())).toEqual(guidance)
  await dialog.getByRole('button', { name: '分析椅子补底与邻域', exact: true }).click()
  expect(await rgba(64, 49)).toEqual(line)
  await report.getByRole('heading', { name: '椅子 · 补底与邻域', exact: true }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: info.outputPath('guided-structure-review.png') })
  await dialog.getByRole('group', { name: '图片预览方式', exact: true }).getByRole('button', { name: '原图', exact: true }).click()
  await json.scrollIntoViewIfNeeded()
  await page.screenshot({ path: info.outputPath('guided-structure-json-and-source.png') })
  const context = await browser.newContext()
  try {
    const cold = await context.newPage(), restored = await openWork(cold, filename)
    const coldSurface = restored.getByRole('group', { name: '底材表面 木板表面', exact: true })
    await coldSurface.getByRole('button', { name: '载入结构辅助到编辑框', exact: true }).click()
    expect(JSON.parse(await restored.getByLabel('结构辅助JSON', { exact: true }).inputValue())).toEqual(guidance)
    await restored.getByRole('button', { name: '分析椅子补底与邻域', exact: true }).click()
    await expect(restored.getByRole('region', { name: '补底与邻域分析', exact: true })).toContainText('改变隐藏区域的推断结构')
    const repeated = await restored.getByLabel('图片标注画布', { exact: true }).evaluate((canvas: HTMLCanvasElement) => Array.from(canvas.getContext('2d')!.getImageData(64, 49, 1, 1).data))
    expect(repeated).toEqual(line)
  } finally { await context.close() }
})

test('inferred dark motifs get local judgment without changing repair state and repeat after cold restore', async ({ page, browser }, info) => {
  test.setTimeout(180000)
  const input = await fixture(true)
  input.state.draft.repairSurfaces![0].guided = { orientation: 'horizontal', guides: [{ ...guidance.guides[0], axis: 'horizontal', points: [{ x: 57, y: 49 }, { x: 67, y: 49 }] }] }
  const dialog = await openWork(page, { name: 'motif.sceneweave-image-work', mimeType: 'application/octet-stream', buffer: Buffer.from(await writeImageWorkPackage(input.state, input.bytes, input.bytes)) })
  const download = async (name: string) => {
    const pending = page.waitForEvent('download')
    await dialog.getByRole('button', { name: '导出制作工作包', exact: true }).click()
    const file = info.outputPath(name); await (await pending).saveAs(file)
    return { file, parsed: await readImageWorkPackage(new Uint8Array(await readFile(file))) }
  }
  const before = await download('motif-before.sceneweave-image-work')
  await dialog.getByRole('button', { name: '分析椅子补底与邻域', exact: true }).click()
  const group = dialog.locator('[aria-label="补图笔迹角色 木板表面"]')
  await group.locator(':scope > summary').click()
  await expect(group.locator(':scope > summary')).toContainText('1 组需要局部判断')
  await expect(group).toContainText('不自动补线或擦除')
  await expect(group).toContainText('完全隐藏且未生成的原板头')
  const site = group.locator('article').first(), canvas = dialog.getByLabel('图片标注画布', { exact: true })
  await site.getByRole('button', { name: '定位待判断笔迹', exact: true }).click()
  const bounds = JSON.parse((await canvas.getAttribute('data-neighborhood-bounds'))!)
  expect(bounds.x).toBeGreaterThanOrEqual(52); expect(bounds.x + bounds.width).toBeLessThanOrEqual(76)
  await site.getByRole('button', { name: '对照笔迹原遮挡', exact: true }).click()
  expect(JSON.parse((await canvas.getAttribute('data-neighborhood-bounds'))!)).toEqual(bounds)
  await group.scrollIntoViewIfNeeded(); await page.screenshot({ path: info.outputPath('motif-local-judgment.png') })
  const after = await download('motif-after.sceneweave-image-work')
  expect({ ...after.parsed.state, revision: 0 }).toEqual({ ...before.parsed.state, revision: 0 })
  expect(after.parsed.original).toEqual(before.parsed.original); expect(after.parsed.normalized).toEqual(before.parsed.normalized)
  const context = await browser.newContext()
  try {
    const cold = await context.newPage(), restored = await openWork(cold, after.file)
    await restored.getByRole('button', { name: '分析椅子补底与邻域', exact: true }).click()
    await expect(restored.locator('[aria-label="补图笔迹角色 木板表面"] > summary')).toContainText('1 组需要局部判断')
  } finally { await context.close() }
})

test('inferred repair boundaries locate earlier steps and remain read-only through cold work-package restoration', async ({ page, browser }, info) => {
  test.setTimeout(180000)
  const input = await fixture()
  const { repairSurfaceIds: _surfaces, ...originalLayer } = input.state.draft.layers[0]
  const prior = { ...originalLayer, id: 'prior', name: '先移走的小物件', polygon: rectangle(48, 40, 4, 20), repair: 'tile' as const,
    selectionMask: { x: 48, y: 40, width: 4, height: 20, runs: [80, 255] } }
  input.state.draft.layers = [prior, ...input.state.draft.layers]
  const before = await writeImageWorkPackage(input.state, input.bytes, input.bytes)
  const dialog = await openWork(page, { name: 'boundary.sceneweave-image-work', mimeType: 'application/octet-stream', buffer: Buffer.from(before) })
  const initialDownloading = page.waitForEvent('download')
  await dialog.getByRole('button', { name: '导出制作工作包', exact: true }).click()
  const initialFile = info.outputPath('boundary-before.sceneweave-image-work'); await (await initialDownloading).saveAs(initialFile)
  const initial = await readImageWorkPackage(new Uint8Array(await readFile(initialFile)))
  await dialog.getByRole('button', { name: '分析椅子补底与邻域', exact: true }).click()
  const evidence = dialog.locator('[aria-label="补区接头依据 木板表面"]')
  await evidence.locator(':scope > summary').click()
  await expect(evidence).toContainText('20 px来自前序补底')
  await expect(evidence).toContainText('前面第1步')
  await expect(evidence).toContainText('不能作为新的原图依据')
  const site = evidence.locator('article').first()
  await site.getByRole('button', { name: '定位前序补底接头', exact: true }).click()
  const canvas = dialog.getByLabel('图片标注画布', { exact: true }), bounds = JSON.parse((await canvas.getAttribute('data-neighborhood-bounds'))!)
  expect(bounds.x).toBe(51); expect(bounds.width).toBe(1)
  await site.getByRole('button', { name: '对照原图遮挡', exact: true }).click()
  expect(JSON.parse((await canvas.getAttribute('data-neighborhood-bounds'))!)).toEqual(bounds)
  await evidence.scrollIntoViewIfNeeded(); await page.screenshot({ path: info.outputPath('repair-boundary-evidence.png') })
  const downloading = page.waitForEvent('download')
  await dialog.getByRole('button', { name: '导出制作工作包', exact: true }).click()
  const filename = info.outputPath('boundary.sceneweave-image-work'); await (await downloading).saveAs(filename)
  const saved = await readImageWorkPackage(new Uint8Array(await readFile(filename)))
  expect({ ...saved.state, revision: 0 }).toEqual({ ...initial.state, revision: 0 })
  expect(saved.original).toEqual(initial.original)
  expect(saved.normalized).toEqual(initial.normalized)
  const context = await browser.newContext()
  try {
    const cold = await context.newPage(), restored = await openWork(cold, filename)
    await restored.getByRole('button', { name: '分析椅子补底与邻域', exact: true }).click()
    const repeated = restored.locator('[aria-label="补区接头依据 木板表面"]')
    await repeated.locator(':scope > summary').click()
    await expect(repeated).toContainText('20 px来自前序补底')
    await expect(repeated).toContainText('前面第1步')
  } finally { await context.close() }
})
