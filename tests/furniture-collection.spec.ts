import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { FURNITURE_CATEGORIES, FURNITURE_STYLES } from '../src/shared/assets/furniture-collection'
import { createKeyboardProject, keyboardProjectBackup, keyboardWorkspaceSaved, selectKeyboardProp, openKeyboardPanel } from './keyboard-ux-helpers'
import { openWorkspaceModule } from './workspace-navigation-helpers'
import { mapExportButton } from './workspace-ux-helpers'
import { acknowledgeAssetQuality } from './asset-quality-helpers'

async function furniturePanel(page: Page) {
  await openWorkspaceModule(page, '素材与布景')
  const panel = page.getByRole('region', { name: '风格家具系列', exact: true })
  const details = panel.locator(':scope > details')
  if (await details.getAttribute('open') === null) await details.locator(':scope > summary').click()
  return panel
}
async function images(page: Page, info: TestInfo, name: string) {
  const results: Record<string, { width: number; height: number; rgbaSha256: string }> = {}
  for (const audience of ['gm', 'player'] as const) {
    const downloading = page.waitForEvent('download'); await (await mapExportButton(page, audience)).click()
    const path = info.outputPath(`${name}-${audience}.png`); await (await downloading).saveAs(path)
    await page.locator('.workspace-export-menu > summary').click()
    const bytes = [...await readFile(path)]
    results[audience] = await page.evaluate(async png => {
      const image = await createImageBitmap(new Blob([new Uint8Array(png)])), canvas = document.createElement('canvas')
      canvas.width = image.width; canvas.height = image.height
      const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0); image.close()
      const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', rgba))).map(value => value.toString(16).padStart(2, '0')).join('')
      return { width: canvas.width, height: canvas.height, rgbaSha256: hash }
    }, bytes)
  }
  return results
}

for (const category of FURNITURE_CATEGORIES) test(`ordinary ${category.id} catalogue loads 24 real images and preserves selection, cancel, adopt, undo and cold content`, async ({ page }, info) => {
  test.setTimeout(300000)
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await createKeyboardProject(page, `${category.name}24款目录`)
  const before = await keyboardProjectBackup(page, info.outputPath('before.sceneweave')), panel = await furniturePanel(page)
  await expect(panel.locator('img')).toHaveCount(0)
  await panel.getByLabel('家具类别', { exact: true }).selectOption(category.id)
  await panel.getByRole('button', { name: '加载所选类别24款', exact: true }).click()
  await expect(panel.locator('img')).toHaveCount(24, { timeout: 120000 })
  expect(await panel.locator('img').evaluateAll(images => images.every(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0))).toBe(true)
  await panel.getByLabel('家具年代', { exact: true }).selectOption('fantasy'); await expect(panel.locator('img')).toHaveCount(8)
  await panel.getByLabel('家具配套风格', { exact: true }).selectOption('elven'); await expect(panel.locator('img')).toHaveCount(1)
  await panel.getByLabel('查找风格家具', { exact: true }).fill('no-match-fixture'); await expect(panel.locator('img')).toHaveCount(0)
  await panel.getByLabel('查找风格家具', { exact: true }).fill(''); await panel.getByLabel('家具年代', { exact: true }).selectOption('all')
  await expect(panel.locator('img')).toHaveCount(24)
  await page.screenshot({ path: info.outputPath(`${category.id}-browser.png`) })
  await panel.getByRole('button', { name: '选择当前筛选结果', exact: true }).click()
  await panel.getByRole('button', { name: '预览添加所选24件家具', exact: true }).click()
  await expect(page.getByRole('button', { name: '采用组件修改', exact: true })).toBeVisible({ timeout: 120000 })
  await page.getByRole('button', { name: '取消组件预览', exact: true }).click(); await keyboardWorkspaceSaved(page)
  expect((await keyboardProjectBackup(page, info.outputPath('cancelled.sceneweave'))).hashes).toEqual(before.hashes)
  // A successful preview clears the explicit selection; select it again.
  await panel.getByRole('button', { name: '选择当前筛选结果', exact: true }).click()
  await panel.getByRole('button', { name: '预览添加所选24件家具', exact: true }).click()
  await expect(page.getByRole('button', { name: '采用组件修改', exact: true })).toBeVisible({ timeout: 120000 })
  await acknowledgeAssetQuality(page)
  await page.getByRole('button', { name: '采用组件修改', exact: true }).click(); await keyboardWorkspaceSaved(page)
  const adopted = await keyboardProjectBackup(page, info.outputPath(`${category.id}-24.sceneweave`))
  expect(Object.keys(adopted.document.propDefinitions).filter(id => id.startsWith(`furniture-collection-v1-prop-${category.id}-`))).toHaveLength(24)
  await page.getByRole('button', { name: '撤销编辑', exact: true }).click(); await keyboardWorkspaceSaved(page)
  expect((await keyboardProjectBackup(page, info.outputPath('undone.sceneweave'))).document.propDefinitions).toEqual(before.document.propDefinitions)
  await page.getByRole('button', { name: '重做编辑', exact: true }).click(); await keyboardWorkspaceSaved(page)
  await page.reload(); await page.getByRole('button', { name: '回到首页', exact: true }).click()
  await page.getByTestId('workspace-home').locator(`[data-project-key="native:${adopted.document.sceneId}"]`).getByRole('button', { name: '打开', exact: true }).click()
  await keyboardWorkspaceSaved(page)
  const cold = await keyboardProjectBackup(page, info.outputPath('cold.sceneweave'))
  expect(cold.document.propDefinitions).toEqual(adopted.document.propDefinitions)
  expect(cold.hashes['sources.json']).toBe(adopted.hashes['sources.json'])
  expect(errors).toEqual([]); await writeFile(info.outputPath('page-errors.json'), JSON.stringify(errors))
})

test('24 coordinated rooms download through normal UI; three eras import, edit, undo and preserve actual double-audience images on cold reopen', async ({ page, browser }, info) => {
  test.setTimeout(600000)
  const errors: string[] = [], manifest: unknown[] = []
  page.on('pageerror', error => errors.push(error.message))
  await createKeyboardProject(page, '24风格房间交付'); const panel = await furniturePanel(page)
  for (const style of FURNITURE_STYLES) {
    await panel.getByLabel('家具配套风格', { exact: true }).selectOption(style.id)
    const downloading = page.waitForEvent('download'); await panel.getByRole('button', { name: '下载所选风格配套房间', exact: true }).click()
    const path = info.outputPath(`${style.id}.sceneweave`); await (await downloading).saveAs(path)
    await expect(panel.getByRole('button', { name: '下载所选风格配套房间', exact: true })).toBeEnabled({ timeout: 90000 })
    const file = await readFile(path), record: Record<string, unknown> = { id: style.id, era: style.era, sizeBytes: file.length, sha256: createHash('sha256').update(file).digest('hex') }
    if (['wayside-inn', 'elven', 'art-deco'].includes(style.id)) {
      const context = await browser.newContext()
      try {
        const target = await context.newPage(); target.on('pageerror', error => errors.push(error.message)); await target.goto(new URL('./#home', page.url()).href)
        const choose = target.waitForEvent('filechooser'); await target.getByTestId('workspace-home').getByRole('button', { name: '打开工程文件', exact: true }).click()
        await (await choose).setFiles(path); await keyboardWorkspaceSaved(target)
        const opened = await keyboardProjectBackup(target, info.outputPath(`${style.id}-opened.sceneweave`))
        expect(Object.keys(opened.document.props)).toHaveLength(4)
        const bed = Object.values(opened.document.props).find(prop => prop.id === 'furniture-room-bed')!
        await selectKeyboardProp(target, bed.id); const inspector = await openKeyboardPanel(target, 'inspector')
        await inspector.getByLabel('物件 X', { exact: true }).fill(String((bed.positionMm.x + 100) / 1000))
        await inspector.getByLabel('物件 X', { exact: true }).press('Enter'); await keyboardWorkspaceSaved(target)
        const edited = await keyboardProjectBackup(target, info.outputPath(`${style.id}-edited.sceneweave`))
        expect(edited.document.props[bed.id].positionMm.x).toBe(bed.positionMm.x + 100)
        await target.getByRole('button', { name: '撤销编辑', exact: true }).click(); await keyboardWorkspaceSaved(target)
        const undone = await keyboardProjectBackup(target, info.outputPath(`${style.id}-undone.sceneweave`)); expect(undone.document.props).toEqual(opened.document.props)
        const initialImages = await images(target, info, style.id)
        await target.reload(); await target.getByRole('button', { name: '回到首页', exact: true }).click()
        await target.getByTestId('workspace-home').locator(`[data-project-key="native:${opened.document.sceneId}"]`).getByRole('button', { name: '打开', exact: true }).click(); await keyboardWorkspaceSaved(target)
        const coldImages = await images(target, info, `${style.id}-cold`); expect(coldImages).toEqual(initialImages)
        record.images = initialImages; record.coldImages = coldImages
        await target.screenshot({ path: info.outputPath(`${style.id}-room-browser.png`) })
      } finally { await context.close() }
    }
    manifest.push(record)
  }
  await writeFile(info.outputPath('rooms-manifest.json'), JSON.stringify({ rooms: manifest, errors }, null, 2)); expect(errors).toEqual([])
})
