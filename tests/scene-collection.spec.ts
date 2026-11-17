import { expect, test, type Page } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import { STORAGE_CATEGORIES, STORAGE_DESIGNS } from '../src/shared/assets/storage-collection'
import { TRADE_CATEGORIES, TRADE_DESIGNS } from '../src/shared/assets/trade-collection'
import { createKeyboardProject, keyboardProjectBackup, keyboardWorkspaceSaved, selectKeyboardProp, openKeyboardPanel } from './keyboard-ux-helpers'
import { openWorkspaceModule } from './workspace-navigation-helpers'
import { acknowledgeAssetQuality } from './asset-quality-helpers'
import { mapExportButton } from './workspace-ux-helpers'

async function panel(page: Page) {
  await openWorkspaceModule(page, '素材与布景')
  const section = page.getByRole('region', { name: '全场景素材系列', exact: true })
  const details = section.locator(':scope > details')
  if (await details.getAttribute('open') === null) await details.locator(':scope > summary').click()
  return section
}
for (const category of [...STORAGE_CATEGORIES.map(row => ({ ...row, family: 'storage', designs: STORAGE_DESIGNS.filter(item => item.category === row.id) })),
  ...TRADE_CATEGORIES.map(row => ({ ...row, family: 'trade', designs: TRADE_DESIGNS.filter(item => item.category === row.id) }))]) test(`${category.id}: ordinary discovery, real images, filtered selection, cancel, adopt, place, undo and cold read`, async ({ page }, info) => {
  test.setTimeout(360000)
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  const count = category.designs.length
  await createKeyboardProject(page, `${category.name}系列`)
  const before = await keyboardProjectBackup(page, info.outputPath('before.sceneweave')), library = await panel(page)
  await expect(library.getByLabel('全场景用途大类', { exact: true }).locator('option')).toHaveCount(14)
  await library.getByLabel('全场景用途大类', { exact: true }).selectOption('storage')
  await library.getByLabel('全场景物件类别', { exact: true }).selectOption(category.id)
  await library.getByRole('button', { name: '加载所选物件类别', exact: true }).click()
  await expect(library.locator('img')).toHaveCount(count, { timeout: 120000 })
  expect(await library.locator('img').evaluateAll(images => images.every(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0))).toBe(true)
  await library.getByLabel('全场景素材年代', { exact: true }).selectOption('fantasy'); await expect(library.locator('img')).toHaveCount(category.designs.filter(row => row.era === 'fantasy').length)
  await library.getByLabel('查找全场景素材', { exact: true }).fill('no-result-fixture'); await expect(library.locator('img')).toHaveCount(0)
  await library.getByLabel('查找全场景素材', { exact: true }).fill(''); await library.getByLabel('全场景素材年代', { exact: true }).selectOption('all')
  await page.screenshot({ path: info.outputPath(`${category.id}-browser.png`) })
  // The 24 stalls contain 264 actual new records. Keep the transaction guard:
  // prove the rejected complete selection preserves the project, then choose
  // one explicit era in the normal browser instead of silently splitting it.
  const scope = category.id === 'market-stall' ? category.designs.filter(row => row.era === 'medieval') : category.designs
  if (category.id === 'market-stall') {
    await library.getByRole('button', { name: '选择当前素材结果', exact: true }).click()
    await library.getByRole('button', { name: `预览添加所选${count}件素材`, exact: true }).click()
    await expect(library.getByRole('alert').filter({ hasText: '实际新增记录264，超过256' })).toBeVisible({ timeout: 120000 })
    expect((await keyboardProjectBackup(page, info.outputPath('over-budget-preserved.sceneweave'))).hashes).toEqual(before.hashes)
    await library.getByLabel('全场景素材年代', { exact: true }).selectOption('medieval')
    await expect(library.locator('img')).toHaveCount(scope.length)
  }
  const preview = async () => {
    await library.getByRole('button', { name: '选择当前素材结果', exact: true }).click()
    await library.getByRole('button', { name: `预览添加所选${scope.length}件素材`, exact: true }).click()
    await expect(page.getByRole('button', { name: '采用组件修改', exact: true })).toBeVisible({ timeout: 120000 })
  }
  await preview(); await page.getByRole('button', { name: '取消组件预览', exact: true }).click(); await keyboardWorkspaceSaved(page)
  expect((await keyboardProjectBackup(page, info.outputPath('cancelled.sceneweave'))).hashes).toEqual(before.hashes)
  await preview(); await acknowledgeAssetQuality(page); await page.getByRole('button', { name: '采用组件修改', exact: true }).click(); await keyboardWorkspaceSaved(page)
  const adopted = await keyboardProjectBackup(page, info.outputPath(`${category.id}-${scope.length}.sceneweave`))
  expect(Object.keys(adopted.document.propDefinitions).filter(id => id.startsWith(`${category.family}-collection-v1-prop-${category.id}-`))).toHaveLength(scope.length)
  await page.getByRole('button', { name: '撤销编辑', exact: true }).click(); await keyboardWorkspaceSaved(page)
  expect((await keyboardProjectBackup(page, info.outputPath('undone.sceneweave'))).document.propDefinitions).toEqual(before.document.propDefinitions)
  await page.getByRole('button', { name: '重做编辑', exact: true }).click(); await keyboardWorkspaceSaved(page)
  await page.reload(); await page.getByRole('button', { name: '回到首页', exact: true }).click()
  await page.getByTestId('workspace-home').locator(`[data-project-key="native:${adopted.document.sceneId}"]`).getByRole('button', { name: '打开', exact: true }).click(); await keyboardWorkspaceSaved(page)
  const cold = await keyboardProjectBackup(page, info.outputPath('cold.sceneweave'))
  expect(cold.document.propDefinitions).toEqual(adopted.document.propDefinitions)
  expect(cold.hashes['sources.json']).toBe(adopted.hashes['sources.json'])
  const design = category.designs[0]
  await openWorkspaceModule(page, '素材与布景')
  const componentLibrary = page.getByRole('region', { name: '组件素材库', exact: true })
  await componentLibrary.getByLabel('搜索组件素材', { exact: true }).fill(design.name)
  await componentLibrary.getByRole('button', { name: `放置组件 ${design.name}`, exact: true }).click(); await openKeyboardPanel(page, 'inspector')
  for (const axis of ['X', 'Y']) { await page.getByLabel(`放置 ${axis}`, { exact: true }).fill('4'); await page.getByLabel(`放置 ${axis}`, { exact: true }).press('Tab') }
  await page.getByRole('button', { name: '在此放置', exact: true }).click(); await keyboardWorkspaceSaved(page)
  const placed = await keyboardProjectBackup(page, info.outputPath('placed.sceneweave'))
  expect(Object.values(placed.document.props).some(prop => prop.definitionRef?.id === `${category.family}-collection-v1-prop-${design.key}`)).toBe(true)
  expect(errors).toEqual([]); await writeFile(info.outputPath('page-errors.json'), JSON.stringify(errors))
})

test('all six storage and trade scenes download, open, edit, undo, render and cold reopen through normal UI', async ({ page, browser }, info) => {
  test.setTimeout(600000)
  await createKeyboardProject(page, '配套仓房'); const library = await panel(page)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  for (const id of ['medieval-store', 'fantasy-store', 'period-store', 'medieval-market', 'fantasy-market', 'period-wholesale']) {
    await library.getByLabel('全场景配套仓房', { exact: true }).selectOption(id)
    const downloading = page.waitForEvent('download'); await library.getByRole('button', { name: '下载可编辑仓储场景', exact: true }).click()
    const file = info.outputPath(`${id}.sceneweave`); await (await downloading).saveAs(file)
    await expect(library.getByRole('button', { name: '下载可编辑仓储场景', exact: true })).toBeEnabled({ timeout: 90000 })
    const context = await browser.newContext()
    try {
      const target = await context.newPage(); target.on('pageerror', error => errors.push(error.message)); await target.goto(new URL('./#home', page.url()).href)
      const choose = target.waitForEvent('filechooser'); await target.getByTestId('workspace-home').getByRole('button', { name: '打开工程文件', exact: true }).click()
      await (await choose).setFiles(file); await keyboardWorkspaceSaved(target)
      const opened = await keyboardProjectBackup(target, info.outputPath(`${id}-opened.sceneweave`))
      expect(Object.keys(opened.document.props)).toHaveLength(id.endsWith('-store') ? 12 : 22); expect(Object.keys(opened.document.prefabInstances)).toHaveLength(id.endsWith('-store') ? 1 : 0)
      const prop = Object.values(opened.document.props)[4]
      await selectKeyboardProp(target, prop.id); const inspector = await openKeyboardPanel(target, 'inspector')
      await inspector.getByLabel('物件 X', { exact: true }).fill(String((prop.positionMm.x + 100) / 1000))
      await inspector.getByLabel('物件 X', { exact: true }).press('Enter'); await keyboardWorkspaceSaved(target)
      expect((await keyboardProjectBackup(target, info.outputPath(`${id}-edited.sceneweave`))).document.props[prop.id].positionMm.x).toBe(prop.positionMm.x + 100)
      await target.getByRole('button', { name: '撤销编辑', exact: true }).click(); await keyboardWorkspaceSaved(target)
      expect((await keyboardProjectBackup(target, info.outputPath(`${id}-undone.sceneweave`))).document.props).toEqual(opened.document.props)
      const render = async (suffix: string) => {
        const downloading = target.waitForEvent('download'); await (await mapExportButton(target, 'gm')).click()
        const png = info.outputPath(`${id}-${suffix}.png`); await (await downloading).saveAs(png); await target.locator('.workspace-export-menu > summary').click()
        return target.evaluate(async bytes => {
          const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)])), canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height
          const context = canvas.getContext('2d')!; context.drawImage(bitmap, 0, 0); bitmap.close()
          return [...new Uint8Array(await crypto.subtle.digest('SHA-256', context.getImageData(0, 0, canvas.width, canvas.height).data))]
        }, [...await readFile(png)])
      }
      const rendered = await render('gm')
      await target.reload(); await target.getByRole('button', { name: '回到首页', exact: true }).click()
      await target.getByTestId('workspace-home').locator(`[data-project-key="native:${opened.document.sceneId}"]`).getByRole('button', { name: '打开', exact: true }).click(); await keyboardWorkspaceSaved(target)
      expect(await render('cold')).toEqual(rendered)
      await target.screenshot({ path: info.outputPath(`${id}-browser.png`) })
    } finally { await context.close() }
  }
  expect(errors).toEqual([]); await writeFile(info.outputPath('page-errors.json'), JSON.stringify(errors))
})
