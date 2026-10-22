import { chromium, expect } from '@playwright/test'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { unzipSync, strFromU8 } from 'fflate'
const output = process.env.SCENEWEAVE_C1B_EVIDENCE_DIR ?? `performance-results/c1b-production-${Date.now()}`
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const context = await browser.newContext({ viewport: { width: 1512, height: 982 } })
const page = await context.newPage(), errors = []
page.on('pageerror', error => errors.push(error.message))
const run = { startedAt: new Date().toISOString(), browser: browser.version(), viewport: { width: 1512, height: 982 }, origin: 'production preview on loopback', results: {} }
try {
  await page.goto('http://127.0.0.1:4173/#assets')
  await expect(page.getByTestId('asset-workbench')).toBeVisible()
  run.results.developmentApisAbsent = await page.evaluate(() => !Reflect.has(window, '__sceneweaveAssetsDev') && !Reflect.has(window, '__sceneweavePerformance'))
  if (!run.results.developmentApisAbsent) throw new Error('Development API exposed by production build')
  await page.getByRole('button', { name: '新建空白场景', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '新建空白场景', exact: true })
  await dialog.getByLabel('场景名称', { exact: true }).fill('框选创作 · C1b')
  await dialog.getByLabel('使用预设', { exact: true }).selectOption('tactical')
  await page.screenshot({ path: `${output}/production-new-scene.png`, fullPage: true })
  await dialog.getByRole('button', { name: '创建空白场景', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.locator('.asset-save')).toHaveText('本地已保存')
  await expect(page.locator('.asset-map-wrap')).toHaveAttribute('aria-busy', 'false')
  const indoor = JSON.parse(await readFile('assets/sceneweave-handdrawn/manifest.json', 'utf8')).assets.filter(value => value.kind === 'prop')
  const outdoor = JSON.parse(await readFile('assets/sceneweave-handdrawn-outdoor/manifest.json', 'utf8')).assets.filter(value => value.kind === 'prop')
  const place = async (definition, x, y, rotation = 0) => {
    await page.getByRole('group', { name: '场景对象分类', exact: true }).getByRole('button', { name: '放置', exact: true }).click()
    await page.getByRole('button', { name: `放置${definition.name}`, exact: true }).click()
    for (const [label, value] of [['放置 X', x], ['放置 Y', y], ['放置旋转', rotation]]) {
      const input = page.getByRole('spinbutton', { name: label, exact: true })
      await input.fill(String(value)); await input.press('Tab')
    }
    await page.getByRole('button', { name: '在此放置', exact: true }).click()
    await expect(page.getByRole('heading', { name: '物件属性', exact: true })).toBeVisible()
    await expect(page.locator('.asset-save')).toHaveText('本地已保存')
    await expect(page.locator('.asset-map-wrap')).toHaveAttribute('aria-busy', 'false')
  }
  await place(indoor[2], 3500, 3500)
  await place(indoor[2], 5500, 3500, 30)
  await place(outdoor[0], 10500, 7000)
  const viewport = page.getByLabel('地图视口', { exact: true })
  const beforeRenderCount = Number(await viewport.getAttribute('data-render-count'))
  await page.getByRole('button', { name: '全选可编辑对象', exact: true }).click()
  const selected = JSON.parse(await viewport.getAttribute('data-selected-ids'))
  if (selected.length !== 3) throw new Error('Production select-all did not select all three editable props')
  await expect(page.getByRole('heading', { name: '多选属性', exact: true })).toBeVisible()
  await expect(page.getByTestId('asset-workbench')).toHaveAttribute('data-revision', '3')
  if (Number(await viewport.getAttribute('data-render-count')) !== beforeRenderCount) throw new Error('Selection regenerated the base image')
  await page.screenshot({ path: `${output}/production-multiselect.png`, fullPage: true })
  for (const [name, value] of [['批量位移 X', 200], ['批量位移 Y', 100]]) {
    const input = page.getByRole('spinbutton', { name, exact: true }); await input.fill(String(value)); await input.press('Tab')
  }
  await page.getByRole('button', { name: '预览批量移动', exact: true }).click()
  await expect(page.getByTestId('asset-workbench')).toHaveAttribute('data-revision', '3')
  await page.getByRole('button', { name: '取消批量预览', exact: true }).click()
  await expect(page.getByTestId('asset-workbench')).toHaveAttribute('data-revision', '3')
  await page.getByRole('button', { name: '预览批量移动', exact: true }).click()
  await expect(page.locator('.asset-map-wrap')).toHaveAttribute('aria-busy', 'false')
  await page.screenshot({ path: `${output}/production-batch-preview.png`, fullPage: true })
  await page.getByRole('button', { name: '采用批量修改', exact: true }).click()
  await expect(page.getByTestId('asset-workbench')).toHaveAttribute('data-revision', '4')
  await expect(page.locator('.asset-save')).toHaveText('本地已保存')
  await expect(page.locator('.asset-map-wrap')).toHaveAttribute('aria-busy', 'false')
  await viewport.focus(); await page.keyboard.press('Shift+F10')
  const menu = page.getByRole('menu', { name: '场景操作', exact: true })
  await expect(menu).toContainText('已选 3 个对象')
  await page.screenshot({ path: `${output}/production-context-menu.png`, fullPage: true })
  await page.keyboard.press('Escape'); await expect(menu).toHaveCount(0); await expect(viewport).toBeFocused()
  run.results.selectionAndBatch = { selectedCount: selected.length, selectionDidNotRenderBase: true, cancelRevision: 3, adoptedRevision: 4, offsetMm: { x: 200, y: 100 }, keyboardMenuAndFocusReturn: true }
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: '完整工程', exact: true }).click()
  const download = await pending, bytes = await readFile(await download.path())
  const files = unzipSync(bytes), document = JSON.parse(strFromU8(files['scene.json']))
  if (Object.keys(document.props).length !== 3 || Object.keys(document.propDefinitions).length !== 18 || document.revision !== 4) throw new Error('Unexpected production project content')
  await writeFile(`${output}/production-complete.sceneweave`, bytes)
  run.results.completeProject = { schemaVersion: document.schemaVersion, revision: document.revision, props: Object.keys(document.props).length, adoptedDefinitions: Object.keys(document.propDefinitions).length, resourceEntries: Object.keys(files).length, packageBytes: bytes.length }
  await page.reload()
  await expect(page.getByRole('heading', { name: '框选创作 · C1b', exact: true })).toBeVisible()
  await expect(page.locator('.asset-save')).toHaveText('本地已保存')
  await expect(page.getByTestId('asset-workbench')).toHaveAttribute('data-revision', '4')
  await expect(page.locator('.asset-map-wrap')).toHaveAttribute('aria-busy', 'false')
  await expect(viewport).toHaveAttribute('data-selected-ids', '[]')
  run.results.reloadRetainedRevision = 4
  run.results.selectionWasNotPersisted = true
  run.results.browserErrors = errors
  if (errors.length) throw new Error(errors.join('; '))
  run.status = 'passed'
} catch (error) { run.status = 'failed'; run.error = String(error); throw error }
finally {
  run.finishedAt = new Date().toISOString()
  await writeFile(`${output}/production-smoke.json`, JSON.stringify(run, null, 2) + '\n')
  await context.close(); await browser.close()
}
console.log(JSON.stringify(run))
