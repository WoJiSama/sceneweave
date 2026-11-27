import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { unzipSync } from 'fflate'
import { encodeCanonicalPng } from '../src/shared/project/png-rgba'
import { inspectImageBytes } from '../src/shared/project/image-bytes'
import { keyboardProjectBackup, keyboardWorkspaceSaved } from './keyboard-ux-helpers'
import { openExportMenu, openVttExport } from './workspace-ux-helpers'

const title = 'VTT 圆桌测试'
const sampleImage = () => encodeCanonicalPng({ width: 128, height: 96, rgba: new Uint8ClampedArray(128 * 96 * 4).fill(240) })
function uvttFile() {
  return Buffer.from(JSON.stringify({
    format: .2, resolution: { map_origin: { x: 5, y: -1 }, map_size: { x: 4, y: 3 }, pixels_per_grid: 32 },
    image: Buffer.from(sampleImage()).toString('base64'),
    line_of_sight: [[{ x: 5.5, y: 0 }, { x: 6, y: 0 }], [{ x: 7, y: 0 }, { x: 8.5, y: 0 }]],
    portals: [{ bounds: [{ x: 6, y: 0 }, { x: 7, y: 0 }], closed: true }],
    lights: [{ position: { x: 7.2, y: .6 }, range: 1, color: 'FFFFBB66', intensity: 18, shadows: true }],
  }))
}

async function openVttFixture(page: Page) {
  await page.goto('./#home')
  await page.getByTestId('native-project-file').setInputFiles({ name: `${title}.dd2vtt`, mimeType: 'application/json', buffer: uvttFile() })
  const dialog = page.getByRole('dialog', { name: '导入 VTT 地图', exact: true })
  await dialog.getByLabel('每格毫米数').fill('1000')
  await dialog.getByLabel('素材来源').fill('测试生成的自有素材')
  await dialog.getByLabel('许可或使用授权').fill('Test-owned fixture used with permission.')
  await expect(dialog.getByRole('button', { name: '导入为新工程' })).toBeDisabled()
  await dialog.getByRole('checkbox').check()
  await dialog.getByRole('button', { name: '导入为新工程' }).click()
  await expect(dialog).toBeHidden({ timeout: 30_000 })
  await keyboardWorkspaceSaved(page)
}

test('imports VTT geometry, branches out to a bounded export and removes the reviewed local project @cross-browser', async ({ page, browserName }, info) => {
  test.setTimeout(120_000)
  await openVttFixture(page)
  const actual = await keyboardProjectBackup(page, info.outputPath('imported.sceneweave'))
  const document = actual.document
  expect(document.units.gridSizeMm).toBe(1000)
  expect(Object.values(document.floors)[0].artwork?.boundsMm).toEqual({ x: 0, y: 0, width: 4000, height: 3000 })
  expect(Object.values(document.walls)).toHaveLength(3)
  expect(Object.values(document.openings)[0]).toMatchObject({ widthMm: 1000, kind: 'door', state: 'closed' })
  expect(Object.values(document.visual.base.base.lights)[0]).toMatchObject({ positionMm: { x: 2200, y: 1600 }, radiusMm: 1000, intensity: 1.8 })
  const menu = await openExportMenu(page)
  await menu.getByLabel('长边像素').selectOption('1024')
  const format = browserName === 'chromium' ? 'webp' : 'png'
  await menu.getByLabel('图片格式').selectOption(format)
  const imageEvent = page.waitForEvent('download')
  await menu.getByRole('button', { name: format === 'webp' ? '玩家地图 WebP' : '玩家地图 PNG', exact: true }).click()
  const image = await imageEvent
  expect(image.suggestedFilename()).toBe(`sceneweave-player-map.${format}`)
  const output = await image.path()
  expect(inspectImageBytes(await readFile(output!))).toEqual({ mimeType: `image/${format}`, width: 1024, height: 768 })
  await page.locator('.workspace-export-menu > summary').press('Escape')
  await openVttExport(page)
  const vtt = page.getByRole('dialog', { name: 'VTT 导出预检', exact: true })
  await vtt.getByRole('checkbox').check()
  const delivery = page.waitForEvent('download')
  await vtt.getByRole('button', { name: '下载 VTT 导入包', exact: true }).click()
  const packed = unzipSync(await readFile((await (await delivery).path())!))
  const json = (name: string) => JSON.parse(new TextDecoder().decode(packed[name]))
  expect(json('scene.dd2vtt').portals).toHaveLength(1)
  expect(json('scene.dd2vtt').lights).toEqual([expect.objectContaining({ intensity: 18 })])
  expect(json('mapping-report.json').counts).not.toHaveProperty('hiddenSecretOpenings')
  await vtt.getByRole('button', { name: '关闭', exact: true }).click()
  await page.locator('.workspace-export-menu > summary').press('Escape')
  await page.getByRole('button', { name: '回到首页', exact: true }).click()
  await page.getByRole('button', { name: '管理本地存储', exact: true }).click()
  const storage = page.getByRole('dialog', { name: '管理本地存储', exact: true })
  await storage.getByRole('button', { name: '检查本地存储用量', exact: true }).click()
  await expect(storage).toContainText('工程与历史')
  await expect(storage.getByRole('region', { name: '图片草稿占用' })).toContainText('共享图像')
  await storage.getByRole('combobox', { name: '工程', exact: true }).selectOption(document.sceneId)
  await storage.getByRole('button', { name: '检查所选工程', exact: true }).click()
  await expect(storage).toContainText('当前存档和实际资源可正常打开')
  await storage.getByRole('button', { name: '移除本地工程', exact: true }).click()
  await storage.getByRole('button', { name: '取消整理', exact: true }).click()
  await storage.getByRole('button', { name: '移除本地工程', exact: true }).click()
  await storage.getByRole('button', { name: '确认移除此工程及历史', exact: true }).click()
  await expect(storage).toContainText('已移除此工程及其历史')
  await storage.getByRole('button', { name: '回收无引用数据', exact: true }).click()
  await expect(storage).toContainText('已回收 1 份资源')
  await storage.getByRole('button', { name: '关闭', exact: true }).click()
  await expect(page.getByText('此浏览器还没有工程', { exact: true })).toBeVisible()
})

test('imports a Foundry square-grid scene with an explicit background origin and retains the hidden door for the GM', async ({ page }, info) => {
  test.setTimeout(90_000)
  const data = {
    name: 'Foundry fixture', width: 128, height: 96, padding: .25, grid: { type: 1, size: 32, distance: 5 },
    walls: [{ c: [64, 64, 96, 64], door: 2, ds: 2, move: 1, sight: 1 }],
    lights: [{ x: 80, y: 96, hidden: true, walls: true, config: { dim: 5, bright: 2.5, alpha: .4 } }],
    journal: [{ text: 'private-source-text' }],
  }
  await page.goto('./#home')
  await page.getByTestId('native-project-file').setInputFiles({ name: 'synthetic-foundry.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) })
  const dialog = page.getByRole('dialog', { name: '导入 VTT 地图', exact: true })
  await dialog.getByLabel('本地底图').setInputFiles({ name: 'background.png', mimeType: 'image/png', buffer: Buffer.from(sampleImage()) })
  await dialog.getByLabel('底图原点 X（像素）').fill('32')
  await dialog.getByLabel('底图原点 Y（像素）').fill('32')
  await dialog.getByLabel('每格毫米数').fill('1000')
  await dialog.getByLabel('素材来源').fill('Placeholder created by the test')
  await dialog.getByLabel('许可或使用授权').fill('Test-owned backdrop')
  await dialog.getByRole('checkbox').check()
  await dialog.getByRole('button', { name: '导入为新工程' }).click()
  await expect(dialog).toBeHidden({ timeout: 30_000 })
  await keyboardWorkspaceSaved(page)
  const { document } = await keyboardProjectBackup(page, info.outputPath('foundry.sceneweave'))
  expect(Object.values(document.openings)[0]).toMatchObject({ secret: true, revealed: false, locked: true, widthMm: 1000 })
  expect(Object.values(document.vertices).map(vertex => [vertex.xMm, vertex.yMm])).toEqual([[1000, 1000], [2000, 1000]])
  expect(Object.values(document.visual.base.base.lights)[0]).toMatchObject({ visibility: 'gm', positionMm: { x: 1500, y: 2000 }, radiusMm: 1000 })
  expect(JSON.stringify(document)).not.toContain('private-source-text')
})

test('recovers a workbench effect failure and delivers the in-memory project backup', async ({ page }) => {
  test.setTimeout(120_000)
  await page.addInitScript(() => {
    const BrowserObserver = window.ResizeObserver
    window.ResizeObserver = class extends BrowserObserver {
      observe(target: Element, options?: ResizeObserverOptions) {
        if (target.classList.contains('asset-viewport') && sessionStorage.getItem('test-workbench-failure') === 'armed') {
          throw new Error('Workbench viewport test failure')
        }
        super.observe(target, options)
      }
    }
  })
  await openVttFixture(page)
  await page.getByRole('button', { name: '回到首页', exact: true }).click()
  await page.evaluate(() => sessionStorage.setItem('test-workbench-failure', 'armed'))
  await page.reload()
  await page.getByTestId('workspace-home').getByRole('button', { name: '打开', exact: true }).click()
  const recovery = page.getByRole('region', { name: '工作台恢复', exact: true })
  await expect(recovery).toBeVisible({ timeout: 30_000 })
  const received = page.waitForEvent('download')
  await recovery.getByRole('button', { name: '下载当前工程备份 · 含秘密', exact: true }).click()
  const backup = await received
  const files = unzipSync(await readFile((await backup.path())!))
  expect(JSON.parse(new TextDecoder().decode(files['scene.json'])).title).toBe(title)
  await page.evaluate(() => sessionStorage.removeItem('test-workbench-failure'))
  await recovery.getByRole('button', { name: '重新打开工作台', exact: true }).click()
  await keyboardWorkspaceSaved(page)
  await expect(recovery).toBeHidden()
})
