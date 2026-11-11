import { expect, test, type Locator, type Page } from '@playwright/test'
import { createRequire } from 'node:module'

const { PNG } = createRequire(import.meta.url)('../node_modules/playwright-core/lib/utilsBundle.js')
const width = 96, height = 64
function sourcePng(): Buffer {
  const png = new PNG({ width, height })
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) png.data.set([140 + x % 8, 100, 60, 255], (y * width + x) * 4)
  return PNG.sync.write(png)
}
async function createProject(page: Page, title: string) {
  await page.goto('./#home')
  await page.getByTestId('workspace-home').getByRole('button', { name: '新建场景', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '新建空白场景', exact: true })
  await dialog.getByLabel('场景名称', { exact: true }).fill(title)
  await dialog.getByRole('button', { name: '创建空白场景', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.locator('.asset-save')).toHaveText('本地已保存', { timeout: 30000 })
}
async function openTool(page: Page) {
  await page.getByTestId('workspace-module-navigation').getByRole('button', { name: '场景', exact: true }).click()
  await page.getByRole('button', { name: '从图片新建场景', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '图片导入工作台', exact: true })
  await expect(dialog).toBeVisible()
  return dialog
}
async function loadSource(dialog: Locator) {
  await dialog.getByRole('group', { name: '图片导入阶段', exact: true }).getByRole('button', { name: '原图与标定', exact: true }).click()
  await dialog.getByLabel('图片转工程原图', { exact: true }).setInputFiles({ name: 'draft-original.png', mimeType: 'image/png', buffer: sourcePng() })
  await expect(dialog).toContainText('96 × 64 px · 已拆 0 层')
}
async function mark(dialog: Locator, mode: string, points: Array<{ x: number; y: number }>) {
  await dialog.getByRole('group', { name: '图片标注工具', exact: true }).getByRole('button', { name: mode, exact: true }).click()
  const canvas = dialog.getByLabel('图片标注画布', { exact: true }), box = await canvas.boundingBox()
  if (!box) throw new Error('图片标注画布未显示。')
  for (const point of points) await canvas.click({ position: { x: point.x / width * box.width, y: point.y / height * box.height } })
}
async function beforeUnloadBlocked(page: Page) {
  return page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)
    return event.defaultPrevented
  })
}

test('loaded image annotations survive closing, navigation and a dismissed refresh until explicitly discarded', async ({ page }) => {
  await createProject(page, '图片草稿保护')
  let dialog = await openTool(page)
  await loadSource(dialog)
  await mark(dialog, '房间轮廓', [{ x: 4, y: 4 }, { x: 92, y: 4 }, { x: 92, y: 60 }, { x: 4, y: 60 }])
  await dialog.getByRole('button', { name: '关闭图片拆解', exact: true }).click()
  expect(await beforeUnloadBlocked(page)).toBe(true)
  await expect(page.locator('.asset-save')).toContainText('图片草稿未采用')
  await page.getByRole('button', { name: '回到首页', exact: true }).click()
  await expect(page.getByTestId('workspace-home')).not.toBeVisible()
  await expect(page.locator('.workspace-project-title')).toContainText('图片草稿保护')
  await page.locator('.workspace-file-menu > summary').click()
  await expect(page.getByRole('button', { name: '新建空白场景', exact: true })).toBeDisabled()
  await page.locator('.workspace-file-menu > summary').click()
  const refreshDialog = page.waitForEvent('dialog')
  // Trigger the browser's actual refresh without a Playwright navigation wait:
  // dismissing beforeunload intentionally prevents any navigation from committing.
  await page.evaluate(() => { setTimeout(() => window.location.reload(), 0) })
  const prompt = await refreshDialog
  expect(prompt.type()).toBe('beforeunload')
  await prompt.dismiss()
  dialog = await openTool(page)
  await expect(dialog).toContainText('房间 4 点')
  await dialog.getByRole('group', { name: '图片导入阶段', exact: true }).getByRole('button', { name: '原图与标定', exact: true }).click()
  await expect(dialog.getByLabel('图片转工程原图', { exact: true })).toBeDisabled()
  await dialog.getByRole('button', { name: '丢弃图片草稿', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  await expect(page.locator('.asset-save')).toHaveText('本地已保存')
  expect(await beforeUnloadBlocked(page)).toBe(false)
  dialog = await openTool(page)
  await expect(dialog).not.toContainText('96 × 64 px')
  await dialog.getByRole('group', { name: '图片导入阶段', exact: true }).getByRole('button', { name: '原图与标定', exact: true }).click()
  await expect(dialog.getByLabel('图片转工程原图', { exact: true })).toBeEnabled()
})

test('image preparation failures and cancelled or failed adoption keep the source until matching adoption succeeds', async ({ page }) => {
  test.setTimeout(90000)
  await createProject(page, '图片草稿原工程')
  let dialog = await openTool(page)
  await loadSource(dialog)
  await dialog.getByRole('group', { name: '图片导入阶段', exact: true }).getByRole('button', { name: '原图与标定', exact: true }).click()
  await dialog.getByLabel('工程名称', { exact: true }).fill('图片草稿采用结果')
  // The strict recipe accepts point coordinates; the complete preparation must
  // reject this crossing room geometry without losing its editable annotations.
  await mark(dialog, '房间轮廓', [{ x: 4, y: 4 }, { x: 92, y: 60 }, { x: 92, y: 4 }, { x: 4, y: 60 }])
  await mark(dialog, '比例尺', [{ x: 8, y: 8 }, { x: 28, y: 8 }])
  await dialog.getByRole('group', { name: '图片导入阶段', exact: true }).getByRole('button', { name: '结构与比例', exact: true }).click()
  await dialog.getByLabel('两点间实际距离（毫米）', { exact: true }).fill('1000')
  await dialog.getByRole('group', { name: '图片导入阶段', exact: true }).getByRole('button', { name: '总览与采用', exact: true }).click()
  await dialog.getByLabel('署名与来源', { exact: true }).fill('Sceneweave original draft protection fixture')
  await dialog.getByRole('group', { name: '图片导入阶段', exact: true }).getByRole('button', { name: '总览与采用', exact: true }).click()
  await dialog.getByLabel('完整许可', { exact: true }).fill('CC0 1.0 Universal. Original programmatically drawn test fixture.')
  await dialog.getByRole('group', { name: '图片导入阶段', exact: true }).getByRole('button', { name: '总览与采用', exact: true }).click()
  await dialog.getByRole('checkbox', { name: '我确认有权将这些像素和派生素材嵌入工程及个人素材库', exact: true }).check()
  await dialog.getByRole('button', { name: '预览可编辑新工程', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  await expect(page.locator('.asset-notice')).toContainText('准备打开工程', { timeout: 30000 })
  await expect(page.getByRole('dialog', { name: '确认打开工程', exact: true })).toHaveCount(0)
  await expect(page.locator('.workspace-project-title')).toContainText('图片草稿原工程')
  expect(await beforeUnloadBlocked(page)).toBe(true)
  dialog = await openTool(page)
  await expect(dialog).toContainText('房间 4 点')
  await dialog.getByRole('group', { name: '图片导入阶段', exact: true }).getByRole('button', { name: '结构与比例', exact: true }).click()
  await expect(dialog.getByLabel('两点间实际距离（毫米）', { exact: true })).toHaveValue('1000')
  await dialog.getByRole('group', { name: '图片标注工具', exact: true }).getByRole('button', { name: '房间轮廓', exact: true }).click()
  await dialog.getByRole('button', { name: '清空当前标注', exact: true }).click()
  await mark(dialog, '房间轮廓', [{ x: 4, y: 4 }, { x: 92, y: 4 }, { x: 92, y: 60 }, { x: 4, y: 60 }])
  await dialog.getByRole('button', { name: '预览可编辑新工程', exact: true }).click()
  let candidate = page.getByRole('dialog', { name: '确认打开工程', exact: true })
  await expect(candidate).toBeVisible({ timeout: 30000 })
  await candidate.getByRole('button', { name: '取消', exact: true }).click()
  expect(await beforeUnloadBlocked(page)).toBe(true)
  dialog = await openTool(page)
  await expect(dialog).toContainText('房间 4 点')
  await expect(dialog).toContainText('比例尺 2/2 点')
  await dialog.getByRole('group', { name: '图片导入阶段', exact: true }).getByRole('button', { name: '总览与采用', exact: true }).click()
  await expect(dialog.getByLabel('署名与来源', { exact: true })).toHaveValue('Sceneweave original draft protection fixture')
  await dialog.getByRole('button', { name: '预览可编辑新工程', exact: true }).click()
  candidate = page.getByRole('dialog', { name: '确认打开工程', exact: true })
  await expect(candidate).toBeVisible({ timeout: 30000 })
  // Exercise a real IndexedDB write failure at the adoption boundary. Restore
  // immediately so the same unchanged candidate can be retried normally.
  await page.evaluate(() => {
    const add = IDBObjectStore.prototype.add
    IDBObjectStore.prototype.add = function (value: unknown, key?: IDBValidKey) {
      if (this.name === 'projects') {
        IDBObjectStore.prototype.add = add
        throw new DOMException('image draft adoption failure', 'QuotaExceededError')
      }
      return key === undefined ? add.call(this, value) : add.call(this, value, key)
    }
  })
  await candidate.getByRole('button', { name: '保存并打开副本', exact: true }).click()
  await expect(candidate).toBeVisible()
  await expect(candidate).toContainText('image draft adoption failure', { timeout: 30000 })
  await expect(page.locator('.asset-save')).toContainText('图片草稿未采用')
  await expect(page.locator('.workspace-project-title')).toContainText('图片草稿原工程')
  await candidate.getByRole('button', { name: '保存并打开副本', exact: true }).click()
  await expect(candidate).toHaveCount(0)
  await expect(page.locator('.workspace-project-title')).toContainText('图片草稿采用结果')
  await expect(page.locator('.asset-save')).toHaveText('本地已保存', { timeout: 30000 })
  expect(await beforeUnloadBlocked(page)).toBe(false)
  dialog = await openTool(page)
  await expect(dialog).not.toContainText('96 × 64 px')
  await dialog.getByRole('group', { name: '图片导入阶段', exact: true }).getByRole('button', { name: '原图与标定', exact: true }).click()
  await expect(dialog.getByLabel('工程名称', { exact: true })).toHaveValue('图片重建场景')
  await dialog.getByRole('group', { name: '图片导入阶段', exact: true }).getByRole('button', { name: '总览与采用', exact: true }).click()
  await expect(dialog.getByLabel('完整许可', { exact: true })).toHaveValue('')
})

test('text edits before loading an image remain resumable and explicit discard resets the open request', async ({ page }) => {
  await createProject(page, '未载图草稿保护')
  let dialog = await openTool(page)
  await dialog.getByRole('group', { name: '图片导入阶段', exact: true }).getByRole('button', { name: '原图与标定', exact: true }).click()
  await dialog.getByLabel('工程名称', { exact: true }).fill('尚未载入原图的草稿')
  await dialog.getByRole('button', { name: '关闭图片拆解', exact: true }).click()
  expect(await beforeUnloadBlocked(page)).toBe(true)
  await page.getByRole('button', { name: '返回当前工具与草稿', exact: true }).click()
  dialog = page.getByRole('dialog', { name: '图片导入工作台', exact: true })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('group', { name: '图片导入阶段', exact: true }).getByRole('button', { name: '原图与标定', exact: true }).click()
  await expect(dialog.getByLabel('工程名称', { exact: true })).toHaveValue('尚未载入原图的草稿')
  await dialog.getByRole('button', { name: '丢弃图片草稿', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  await expect(page.locator('.asset-save')).toHaveText('本地已保存')
  expect(await beforeUnloadBlocked(page)).toBe(false)
  // An old requestKey must not reopen a fresh native modal after the reset.
  await page.locator('.workspace-file-menu > summary').click()
  await expect(page.getByRole('button', { name: '新建空白场景', exact: true })).toBeEnabled()
})
