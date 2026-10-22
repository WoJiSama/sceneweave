import { chromium, expect } from '@playwright/test'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { unzipSync, strFromU8 } from 'fflate'
const output = process.env.SCENEWEAVE_C1A_EVIDENCE_DIR ?? `performance-results/c1a-production-${Date.now()}`
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
  await dialog.getByLabel('场景名称', { exact: true }).fill('空白营地 · C1a')
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
  await place(indoor[0], 7000, 5000)
  await place(indoor[2], 5500, 5500, 30)
  await place(outdoor[0], 10500, 3000)
  await page.getByRole('group', { name: '场景对象分类', exact: true }).getByRole('button', { name: '放置', exact: true }).click()
  await page.getByRole('button', { name: `放置${indoor[2].name}`, exact: true }).click()
  const map = await page.getByLabel('材质场景主持人预览', { exact: true }).boundingBox()
  await page.mouse.move(map.x + map.width * .6, map.y + map.height * .7)
  await page.waitForTimeout(150)
  await page.screenshot({ path: `${output}/production-placement.png`, fullPage: true })
  await page.getByRole('button', { name: '取消放置', exact: true }).click()
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: '完整工程', exact: true }).click()
  const download = await pending, bytes = await readFile(await download.path())
  const files = unzipSync(bytes), document = JSON.parse(strFromU8(files['scene.json']))
  if (Object.keys(document.props).length !== 3 || Object.keys(document.propDefinitions).length !== 18 || document.revision !== 3) throw new Error('Unexpected production project content')
  await writeFile(`${output}/production-complete.sceneweave`, bytes)
  run.results.completeProject = { schemaVersion: document.schemaVersion, revision: document.revision, props: Object.keys(document.props).length, adoptedDefinitions: Object.keys(document.propDefinitions).length, resourceEntries: Object.keys(files).length, packageBytes: bytes.length }
  await page.reload()
  await expect(page.getByRole('heading', { name: '空白营地 · C1a', exact: true })).toBeVisible()
  await expect(page.locator('.asset-save')).toHaveText('本地已保存')
  await expect(page.getByTestId('asset-workbench')).toHaveAttribute('data-revision', '3')
  await expect(page.locator('.asset-map-wrap')).toHaveAttribute('aria-busy', 'false')
  run.results.reloadRetainedRevision = 3
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
