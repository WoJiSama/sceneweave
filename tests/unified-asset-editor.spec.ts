import { expect, test, type Locator, type Page } from '@playwright/test'
import { createRequire } from 'node:module'
import { imageEditCapabilities } from '../src/shared/asset-refinement/model-protocol'
import { createKeyboardProject, keyboardProjectBackup, keyboardResourceHashes, keyboardWorkspaceSaved, openKeyboardPanel } from './keyboard-ux-helpers'
import { openWorkspaceModule } from './workspace-navigation-helpers'

const { PNG } = createRequire(import.meta.url)('../node_modules/playwright-core/lib/utilsBundle.js')
const sourceWidth = 400, sourceHeight = 240
type Point = { x: number; y: number }
const rectangle = (x: number, y: number, width: number, height: number): Point[] => [
  { x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height },
]

/** Original fixture, deliberately larger than the workbench viewport at 400%. */
function sourcePng(): Buffer {
  const png = new PNG({ width: sourceWidth, height: sourceHeight })
  for (let y = 0; y < sourceHeight; y++) for (let x = 0; x < sourceWidth; x++) {
    const object = x >= 140 && x < 220 && y >= 80 && y < 160
      || x >= 280 && x < 320 && y >= 80 && y < 140
    png.data.set(object ? [35, 48 + y % 4, 57, 255] : [143 + x % 5, 106, 71, 255], (y * sourceWidth + x) * 4)
  }
  return PNG.sync.write(png)
}

async function mark(dialog: Locator, mode: string, points: Point[]) {
  await dialog.getByRole('group', { name: '图片标注工具', exact: true }).getByRole('button', { name: mode, exact: true }).click()
  const canvas = dialog.getByLabel('图片标注画布', { exact: true })
  await canvas.scrollIntoViewIfNeeded()
  const bounds = await canvas.boundingBox()
  if (!bounds) throw new Error('图片标注画布未显示。')
  for (const point of points) await canvas.click({ position: {
    x: point.x / sourceWidth * bounds.width, y: point.y / sourceHeight * bounds.height,
  } })
}

function fact(details: Locator, label: string) {
  return details.locator('dt').filter({ hasText: new RegExp(`^${label}$`) }).locator('xpath=following-sibling::dd[1]')
}

async function viewCatalogItem(page: Page, scope: 'builtin' | 'mine', name: string) {
  await openWorkspaceModule(page, '素材')
  const library = page.getByRole('region', { name: '组件素材库', exact: true })
  await library.getByLabel('素材来源', { exact: true }).selectOption(scope)
  await library.getByLabel('搜索组件素材', { exact: true }).fill(name)
  await library.getByRole('button', { name: `查看素材 ${name}`, exact: true }).click()
  await openKeyboardPanel(page, 'inspector')
  const details = page.locator('section.catalog-library[aria-label="素材详情面板"]')
  await expect(details.getByRole('heading', { name, exact: true })).toBeVisible()
  await expect(details.getByRole('button', { name: '编辑素材副本', exact: true })).toBeEnabled()
  return details
}

test('catalog image editing preserves one draft across pages and saves a new personal copy without replacing its source', async ({ page }, info) => {
  test.setTimeout(180000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await createKeyboardProject(page, '统一素材编辑前的工程')
  const before = await keyboardProjectBackup(page, info.outputPath('before.sceneweave'))
  let details = await viewCatalogItem(page, 'builtin', '铜色桌灯')
  const original = {
    id: await fact(details, '固定 ID').textContent(),
    identity: await fact(details, '目录身份').textContent(),
    hash: await fact(details, '完整摘要').textContent(),
    bounds: await fact(details, '物理范围').textContent(),
  }
  await details.getByRole('button', { name: '编辑素材副本', exact: true }).click()
  const editor = page.locator('dialog.asset-item-editor-dialog')
  await expect(editor).toBeVisible()
  expect(await editor.evaluate(node => node.matches(':modal'))).toBe(true)
  const pixelSize = (await editor.locator('.asset-item-caption').textContent())?.match(/· (\d+) × (\d+) px/)
  expect(pixelSize).not.toBeNull()
  const copyName = '个人桌灯 · 统一编辑旅程'
  await editor.getByLabel('素材副本名称', { exact: true }).fill(copyName)
  for (const [label, value] of [['图片宽度毫米', '720'], ['图片高度毫米', '640'], ['占地宽度毫米', '260'], ['占地高度毫米', '220']]) {
    await editor.getByLabel(label, { exact: true }).fill(value)
  }
  await editor.getByRole('button', { name: '图像处理', exact: true }).click()
  const enhancement = editor.getByRole('region', { name: '画质候选编辑', exact: true })
  await editor.locator('summary').filter({ hasText: '基础处理 · 插值放大、降噪与边缘' }).click()
  await expect(enhancement.getByLabel('画质原图与范围画布', { exact: true })).toBeVisible()
  await enhancement.getByLabel('画质候选数量', { exact: true }).selectOption('2')
  await enhancement.getByRole('button', { name: '生成 2 个候选', exact: true }).click()
  const candidates = enhancement.getByRole('group', { name: '画质候选列表', exact: true }).getByRole('button')
  await expect(candidates).toHaveCount(2, { timeout: 60000 })
  await candidates.nth(1).click()
  await enhancement.getByLabel('画质检查背景', { exact: true }).selectOption('black')
  await enhancement.getByLabel('画质对照缩放', { exact: true }).selectOption('200')
  const candidatePixels = await enhancement.getByLabel('画质候选对照画布', { exact: true }).evaluate(node => (node as HTMLCanvasElement).toDataURL())
  await expect(editor.getByRole('button', { name: '保存编辑副本到我的素材', exact: true })).toBeDisabled()
  for (const section of ['名称与尺寸', '来源与许可']) {
    await editor.getByRole('button', { name: section, exact: true }).click()
    await expect(editor.getByLabel('素材副本名称', { exact: true })).toHaveValue(copyName)
    await expect(editor.getByLabel('图片宽度毫米', { exact: true })).toHaveValue('720')
    await expect(editor.getByLabel('占地高度毫米', { exact: true })).toHaveValue('220')
  }
  await editor.getByRole('button', { name: '图像处理', exact: true }).click()
  await expect(candidates).toHaveCount(2)
  await expect(candidates.nth(1)).toHaveAttribute('aria-pressed', 'true')
  await expect(enhancement.getByLabel('画质检查背景', { exact: true })).toHaveValue('black')
  await expect(enhancement.getByLabel('画质对照缩放', { exact: true })).toHaveValue('200')
  expect(await enhancement.getByLabel('画质候选对照画布', { exact: true }).evaluate(node => (node as HTMLCanvasElement).toDataURL())).toBe(candidatePixels)
  await enhancement.getByRole('button', { name: '放入编辑草稿', exact: true }).click()
  await editor.getByRole('alertdialog', { name: '加入图像候选确认', exact: true }).getByRole('button', { name: '清理图像草稿并加入候选', exact: true }).click()
  await editor.getByRole('button', { name: '名称与尺寸', exact: true }).click()
  await expect(editor).toContainText('图像候选已加入当前草稿')
  await expect(editor.getByLabel('素材副本名称', { exact: true })).toHaveValue(copyName)
  await expect(editor.locator('.asset-item-caption')).toContainText(`720 × 640 mm · ${Number(pixelSize![1]) * 2} × ${Number(pixelSize![2]) * 2} px`)
  await expect(editor.getByRole('button', { name: '保存编辑副本到我的素材', exact: true })).toBeEnabled()
  await editor.getByRole('button', { name: '保存编辑副本到我的素材', exact: true }).click()
  await expect(editor).toHaveCount(0, { timeout: 60000 })
  const library = page.getByRole('region', { name: '组件素材库', exact: true })
  await expect(library.getByLabel('素材来源', { exact: true })).toHaveValue('mine')
  // Saving selects the new entry while the original search remains in place.
  await library.getByLabel('搜索组件素材', { exact: true }).fill(copyName)
  await expect(library.getByRole('button', { name: `查看素材 ${copyName}`, exact: true })).toBeVisible()
  details = page.locator('section.catalog-library[aria-label="素材详情面板"]')
  await expect(details.getByRole('heading', { name: copyName, exact: true })).toBeVisible()
  await expect(fact(details, '完整摘要')).not.toHaveText(original.hash!)
  await expect(fact(details, '固定 ID')).not.toHaveText(original.id!)
  await details.getByRole('button', { name: '编辑素材副本', exact: true }).click()
  await expect(editor.getByLabel('素材副本名称', { exact: true })).toHaveValue(copyName)
  for (const [label, value] of [['图片宽度毫米', '720'], ['图片高度毫米', '640'], ['占地宽度毫米', '260'], ['占地高度毫米', '220']]) {
    await expect(editor.getByLabel(label, { exact: true })).toHaveValue(value)
  }
  await expect(editor.locator('.asset-item-caption')).toContainText(`${Number(pixelSize![1]) * 2} × ${Number(pixelSize![2]) * 2} px`)
  await editor.getByRole('button', { name: '取消编辑副本', exact: true }).click()
  await expect(editor).toHaveCount(0)
  details = await viewCatalogItem(page, 'builtin', '铜色桌灯')
  for (const [label, value] of [['固定 ID', original.id], ['目录身份', original.identity], ['完整摘要', original.hash], ['物理范围', original.bounds]]) {
    await expect(fact(details, label!)).toHaveText(value!)
  }
  await keyboardWorkspaceSaved(page)
  const after = await keyboardProjectBackup(page, info.outputPath('after.sceneweave'))
  expect(after.document).toEqual(before.document)
  expect(after.identity).toEqual(before.identity)
  expect(after.appearance).toEqual(before.appearance)
  expect(keyboardResourceHashes(after.hashes)).toEqual(keyboardResourceHashes(before.hashes))
  expect(errors).toEqual([])
})

test('catalog candidate adoption confirms clearing other image drafts and cancellation preserves all routes and item fields', async ({ page }) => {
  test.setTimeout(180000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  let unknownRequestId = '', modelPosts = 0
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' }
  await page.route('https://unknown-image-edit.example.test/v1/image-edit**', async route => {
    if (route.request().method() === 'OPTIONS') { await route.fulfill({ status: 204, headers: cors }); return }
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(imageEditCapabilities('browser-configured-image-model')) })
      return
    }
    modelPosts++; unknownRequestId = (route.request().postDataJSON() as { clientRequestId: string }).clientRequestId
    await route.abort('connectionreset')
  })
  await createKeyboardProject(page, '跨路线图像草稿保护')
  const details = await viewCatalogItem(page, 'builtin', '铜色桌灯')
  const originalHash = await fact(details, '完整摘要').textContent()
  await details.getByRole('button', { name: '编辑素材副本', exact: true }).click()
  const editor = page.locator('dialog.asset-item-editor-dialog')
  await editor.getByLabel('素材副本名称', { exact: true }).fill('保留名称与尺寸的桌灯')
  await editor.getByLabel('图片宽度毫米', { exact: true }).fill('720')
  await editor.getByLabel('图片高度毫米', { exact: true }).fill('640')
  await editor.getByLabel('占地宽度毫米', { exact: true }).fill('260')
  await editor.getByLabel('占地高度毫米', { exact: true }).fill('220')
  await editor.getByRole('button', { name: '图像处理', exact: true }).click()
  const refinement = editor.getByRole('region', { name: '素材图像精修', exact: true })
  await refinement.getByLabel('SVG重建方式', { exact: true }).selectOption('vector')
  await refinement.getByRole('button', { name: '生成矢量候选', exact: true }).click()
  const vector = refinement.getByLabel('精修候选对照画布', { exact: true })
  await expect(vector).toBeVisible({ timeout: 60000 })
  const vectorPixels = await vector.evaluate(node => (node as HTMLCanvasElement).toDataURL())
  await refinement.getByRole('button', { name: '模型补画', exact: true }).click()
  const prompt = '保留透明孔洞与原有描边，仅用于本地失败回归。'
  await refinement.getByLabel('模型补画要求', { exact: true }).fill(prompt)
  await refinement.getByLabel('补画应用服务地址', { exact: true }).fill('https://unknown-image-edit.example.test')
  await refinement.getByLabel('补画应用访问凭据', { exact: true }).fill('browser-fixture-application-token')
  await refinement.getByRole('button', { name: '检查补画服务', exact: true }).click()
  await expect(refinement).toContainText('补画服务可用')
  await refinement.getByLabel('同意本次图片上传与可能计费', { exact: true }).check()
  await refinement.getByRole('button', { name: '上传并生成一次补画候选', exact: true }).click()
  await expect(refinement.getByRole('alert')).toContainText('补画结果未知')
  const unknownSummary = editor.getByRole('region', { name: '素材编辑中的补画请求记录', exact: true })
  await expect(unknownSummary).toContainText(unknownRequestId)
  expect(unknownRequestId).not.toBe('')
  expect(modelPosts).toBe(1)
  await refinement.getByRole('button', { name: '矢量重建', exact: true }).click()
  const enhancement = editor.getByRole('region', { name: '画质候选编辑', exact: true })
  await editor.locator('summary').filter({ hasText: '基础处理 · 插值放大、降噪与边缘' }).click()
  await enhancement.getByRole('button', { name: '生成 2 个候选', exact: true }).click()
  await expect(enhancement.getByRole('group', { name: '画质候选列表', exact: true }).getByRole('button')).toHaveCount(2, { timeout: 60000 })
  const basicPixels = await enhancement.getByLabel('画质候选对照画布', { exact: true }).evaluate(node => (node as HTMLCanvasElement).toDataURL())
  const confirmation = editor.getByRole('alertdialog', { name: '加入图像候选确认', exact: true })
  await enhancement.getByRole('button', { name: '放入编辑草稿', exact: true }).click()
  await expect(confirmation).toContainText('模型补画')
  await expect(confirmation).toContainText('名称、图片尺寸、物理占地、阻挡设置和未确认请求记录保留')
  await confirmation.getByRole('button', { name: '继续当前图像草稿', exact: true }).click()
  await expect(confirmation).toHaveCount(0)
  await expect(enhancement.getByRole('button', { name: '放入编辑草稿', exact: true })).toBeEnabled()
  expect(await enhancement.getByLabel('画质候选对照画布', { exact: true }).evaluate(node => (node as HTMLCanvasElement).toDataURL())).toBe(basicPixels)
  expect(await vector.evaluate(node => (node as HTMLCanvasElement).toDataURL())).toBe(vectorPixels)
  await refinement.getByRole('button', { name: '模型补画', exact: true }).click()
  await expect(refinement.getByLabel('模型补画要求', { exact: true })).toHaveValue(prompt)
  await refinement.getByRole('button', { name: '矢量重建', exact: true }).click()
  await refinement.getByRole('button', { name: '放入编辑草稿', exact: true }).click()
  await expect(confirmation).toBeVisible()
  await editor.press('Escape')
  await expect(confirmation).toHaveCount(0)
  await expect(editor).toBeVisible()
  await expect(refinement.getByRole('button', { name: '放入编辑草稿', exact: true })).toBeEnabled()
  expect(await vector.evaluate(node => (node as HTMLCanvasElement).toDataURL())).toBe(vectorPixels)
  await refinement.getByRole('button', { name: '放入编辑草稿', exact: true }).click()
  await expect(confirmation).toBeVisible()
  await editor.getByRole('button', { name: '取消当前处理', exact: true }).click()
  await expect(confirmation).toHaveCount(0)
  await expect(refinement.getByRole('button', { name: '放入编辑草稿', exact: true })).toBeEnabled()
  expect(await enhancement.getByLabel('画质候选对照画布', { exact: true }).evaluate(node => (node as HTMLCanvasElement).toDataURL())).toBe(basicPixels)
  // Only this explicit choice may consume the current candidate and clear the other drafts.
  await refinement.getByRole('button', { name: '放入编辑草稿', exact: true }).click()
  await confirmation.getByRole('button', { name: '清理图像草稿并加入候选', exact: true }).click()
  await expect(confirmation).toHaveCount(0)
  await expect(refinement.getByLabel('精修候选对照画布', { exact: true })).toHaveCount(0)
  await expect(unknownSummary).toContainText(unknownRequestId)
  await refinement.getByRole('button', { name: '模型补画', exact: true }).click()
  await expect(refinement.getByLabel('模型补画要求', { exact: true })).toHaveValue('')
  await expect(refinement.locator('[aria-label="结果未确认的补画请求"]')).toContainText(unknownRequestId)
  expect(modelPosts).toBe(1)
  await editor.getByRole('button', { name: '名称与尺寸', exact: true }).click()
  for (const [label, value] of [['素材副本名称', '保留名称与尺寸的桌灯'], ['图片宽度毫米', '720'], ['图片高度毫米', '640'], ['占地宽度毫米', '260'], ['占地高度毫米', '220']]) {
    await expect(editor.getByLabel(label, { exact: true })).toHaveValue(value)
  }
  await expect(editor).toContainText('图像候选已加入当前草稿')
  await expect(editor.getByRole('button', { name: '保存编辑副本到我的素材', exact: true })).toBeEnabled()
  await editor.getByRole('button', { name: '取消编辑副本', exact: true }).click()
  await editor.getByRole('group', { name: '确认丢弃素材编辑草稿', exact: true }).getByRole('button', { name: '丢弃草稿并关闭', exact: true }).click()
  await expect(editor).toHaveCount(0)
  await expect(fact(details, '完整摘要')).toHaveText(originalHash!)
  await keyboardWorkspaceSaved(page)
  expect(errors).toEqual([])
})

test('image workbench issues and totals locate their controls while stage changes retain canvas, viewport and object drafts', async ({ page }, info) => {
  test.setTimeout(120000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await createKeyboardProject(page, '统一图片导入工作台旅程')
  await openWorkspaceModule(page, '场景')
  await page.getByRole('button', { name: '从图片新建场景', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '图片导入工作台', exact: true })
  const stages = dialog.getByRole('group', { name: '图片导入阶段', exact: true })
  const issues = dialog.getByRole('region', { name: '导入待处理问题', exact: true })
  const overview = dialog.getByRole('region', { name: '编辑总览', exact: true })
  await stages.getByRole('button', { name: '原图与标定', exact: true }).click()
  await dialog.getByLabel('图片转工程原图', { exact: true }).setInputFiles({ name: 'unified-editor-original.png', mimeType: 'image/png', buffer: sourcePng() })
  await expect(overview).toContainText('400 × 240')
  await expect(overview).toContainText('0 层')
  await expect(overview).toContainText('房间 0 点 · 标尺 0/2')
  await issues.getByRole('button', { name: /标注房间内边界/ }).click()
  await expect(stages.getByRole('button', { name: '结构与比例', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(dialog.getByRole('button', { name: '编辑房间轮廓', exact: true })).toBeFocused()
  await mark(dialog, '房间轮廓', rectangle(20, 20, 360, 200))
  await issues.getByRole('button', { name: /完成两点标尺与实际距离/ }).click()
  await expect(dialog.getByLabel('两点间实际距离（毫米）', { exact: true })).toBeFocused()
  await mark(dialog, '比例尺', [{ x: 40, y: 30 }, { x: 140, y: 30 }])
  await dialog.getByLabel('两点间实际距离（毫米）', { exact: true }).fill('1000')
  await expect(overview).toContainText('房间 4 点 · 标尺 2/2')
  await dialog.getByRole('region', { name: '图片对象清单', exact: true }).getByRole('button', { name: '＋ 拆出新物件', exact: true }).click()
  await dialog.getByLabel('物件名称', { exact: true }).fill('已拆椅子')
  await mark(dialog, '物件轮廓', rectangle(140, 80, 80, 80))
  await mark(dialog, '补底取样', [{ x: 40, y: 40 }, { x: 80, y: 60 }])
  await dialog.getByRole('button', { name: '拆出物件并补底', exact: true }).click()
  await expect(overview).toContainText('1 层')
  await expect(dialog.getByRole('region', { name: '图片对象清单', exact: true })).toContainText('1 / 64')
  await dialog.getByRole('button', { name: '＋ 拆出新物件', exact: true }).click()
  await dialog.getByLabel('物件名称', { exact: true }).fill('未采用花盆')
  await mark(dialog, '物件轮廓', rectangle(280, 80, 40, 60))
  await mark(dialog, '补底取样', [{ x: 40, y: 160 }, { x: 80, y: 190 }])
  await dialog.getByLabel('图片缩放', { exact: true }).selectOption('400')
  const canvas = dialog.getByLabel('图片标注画布', { exact: true })
  const originalCanvas = await canvas.elementHandle()
  expect(originalCanvas).not.toBeNull()
  await canvas.evaluate(node => { node.parentElement!.scrollLeft = 160; node.parentElement!.scrollTop = 100 })
  const viewport = () => canvas.evaluate(node => ({
    left: node.parentElement!.scrollLeft, top: node.parentElement!.scrollTop, width: (node as HTMLCanvasElement).style.width,
  }))
  const before = await viewport()
  expect(before.left).toBeGreaterThan(0)
  expect(before.top).toBeGreaterThan(0)
  for (const stage of ['原图与标定', '结构与比例', '总览与采用', '物件与补底']) {
    await stages.getByRole('button', { name: stage, exact: true }).click()
    expect(await canvas.evaluate((node, original) => node === original, originalCanvas)).toBe(true)
    await expect(dialog.getByLabel('图片缩放', { exact: true })).toHaveValue('400')
    await expect.poll(viewport).toEqual(before)
    await expect(overview).toContainText('1 层')
    if (stage === '结构与比例') {
      await expect(dialog).toContainText('当前物件 4 点 · 取样 2/2 点')
      await expect(dialog.getByLabel('两点间实际距离（毫米）', { exact: true })).toHaveValue('1000')
    }
  }
  await expect(dialog.getByLabel('物件名称', { exact: true })).toHaveValue('未采用花盆')
  await expect(dialog.getByRole('button', { name: '拆出物件并补底', exact: true })).toBeEnabled()
  await issues.getByRole('button', { name: /填写来源、许可并确认嵌入权限/ }).click()
  await expect(stages.getByRole('button', { name: '总览与采用', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(dialog.locator('[data-import-target="rights"]')).toBeFocused()
  await dialog.getByLabel('署名与来源', { exact: true }).fill('Sceneweave original unified asset editor fixture')
  await dialog.getByLabel('完整许可', { exact: true }).fill('CC0 1.0 Universal. Original synthetic pixels.')
  await dialog.getByRole('checkbox', { name: '我确认有权将这些像素和派生素材嵌入工程及个人素材库', exact: true }).check()
  await expect(issues.getByRole('button', { name: /填写来源、许可并确认嵌入权限/ })).toHaveCount(0)
  await issues.getByRole('button', { name: /拆出或取消当前物件标注/ }).click()
  await expect(dialog.getByLabel('物件名称', { exact: true })).toBeFocused()
  await expect(dialog.getByLabel('物件名称', { exact: true })).toHaveValue('未采用花盆')
  await expect(dialog.getByRole('button', { name: '预览可编辑新工程', exact: true })).toBeDisabled()
  await dialog.screenshot({ path: info.outputPath('unified-image-workbench.png') })
  await dialog.getByRole('button', { name: '关闭图片拆解', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  await expect(page.locator('.asset-save')).toContainText('图片草稿未采用')
  await page.getByRole('button', { name: '从图片新建场景', exact: true }).click()
  await expect(dialog).toBeVisible()
  await stages.getByRole('button', { name: '物件与补底', exact: true }).click()
  await expect(dialog.getByLabel('物件名称', { exact: true })).toHaveValue('未采用花盆')
  await expect(overview).toContainText('1 层')
  await stages.getByRole('button', { name: '结构与比例', exact: true }).click()
  await expect(dialog).toContainText('当前物件 4 点 · 取样 2/2 点')
  await stages.getByRole('button', { name: '总览与采用', exact: true }).click()
  await expect(dialog.getByLabel('署名与来源', { exact: true })).toHaveValue('Sceneweave original unified asset editor fixture')
  await dialog.getByRole('button', { name: '丢弃图片草稿', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  await keyboardWorkspaceSaved(page)
  await originalCanvas?.dispose()
  expect(errors).toEqual([])
})
