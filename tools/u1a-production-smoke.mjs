import { chromium, expect as playwrightExpect } from '@playwright/test'
const expect = playwrightExpect.configure({ timeout: 30_000 })
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { strFromU8, unzipSync } from 'fflate'

// Root runs this serially after a normal production build is served; no DEV API, source import or IDB injection.
const base = path.resolve(process.env.SCENEWEAVE_U1A_OUTPUT ?? 'work/u1a-20261023/production-ui')
const output = path.join(base, `run-${new Date().toISOString().replace(/[:.]/g, '-')}`)
await fs.mkdir(output, { recursive: true })
await fs.copyFile(fileURLToPath(import.meta.url), path.join(output, 'runner-used.mjs'))
const report = { status: 'running', startedAt: new Date().toISOString(), url: process.env.SCENEWEAVE_PRODUCTION_URL ?? 'http://127.0.0.1:4173/sceneweave/#home',
  method: 'Normal production UI only: Home, blank creation, actual stock placement/rotation, passive Home Continue, native persisted reopen. Downloaded v6 container entries hashed and bitmap dimensions decoded independently. No DEV API/source import/IDB fixture.',
  viewport: { width: 1512, height: 982 }, output, steps: [], screenshots: [], dialogs: [], pageErrors: [], consoleErrors: [], httpErrors: [] }
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
let browser, context, page
try {
  browser = await chromium.launch({ channel: process.env.SCENEWEAVE_BROWSER_CHANNEL ?? 'chrome', headless: true })
  report.browserVersion = browser.version()
  context = await browser.newContext({ viewport: report.viewport, acceptDownloads: true })
  page = await context.newPage()
  page.setDefaultTimeout(30_000)
  page.on('dialog', async dialog => { report.dialogs.push({ type: dialog.type(), message: dialog.message() }); await dialog.dismiss() })
  page.on('pageerror', error => report.pageErrors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') report.consoleErrors.push(message.text()) })
  page.on('response', response => { if (response.status() >= 400) report.httpErrors.push({ status: response.status(), url: response.url() }) })
  const step = name => { report.steps.push({ name, at: new Date().toISOString() }); process.stdout.write(`${name}\n`) }
  const shot = async name => { const file = path.join(output, name); await page.screenshot({ path: file, fullPage: true }); report.screenshots.push(file) }
  const home = () => page.getByTestId('workspace-home')
  const settled = async () => {
    await expect(page.getByTestId('outdoor-workbench')).toBeVisible()
    await expect(page.locator('.asset-busy')).toHaveCount(0)
    await expect(page.locator('.asset-map-wrap')).toHaveAttribute('aria-busy', 'false')
    await expect(page.locator('.asset-save')).toHaveText('本地已保存')
  }
  const number = async (name, value) => { const field = page.getByRole('spinbutton', { name, exact: true }); await field.fill(String(value)); await field.press('Tab') }
  const noDev = async () => {
    const keys = await page.evaluate(() => Object.getOwnPropertyNames(window).filter(key => key.startsWith('__sceneweave')))
    expect(keys).toEqual([]); return keys
  }
  const archive = async fileName => {
    const pending = page.waitForEvent('download')
    await page.getByRole('button', { name: '完整工程', exact: true }).click()
    const download = await pending, downloadedPath = await download.path()
    if (!downloadedPath) throw new Error('Complete project download did not produce bytes')
    const data = await fs.readFile(downloadedPath), files = unzipSync(data)
    const manifest = JSON.parse(strFromU8(files['manifest.json'])), document = JSON.parse(strFromU8(files['scene.json']))
    const identity = JSON.parse(strFromU8(files['identity.json'])), appearance = JSON.parse(strFromU8(files['appearance.json']))
    expect(manifest).toMatchObject({ containerVersion: 6, documentSchemaVersion: 3, profile: 'm1-outdoor', packageMode: 'complete' })
    expect(identity.version).toBe(3); expect(appearance.version).toBe(1); expect(document.schemaVersion).toBe(3)
    expect(manifest.sceneId).toBe(document.sceneId); expect(manifest.revision).toBe(document.revision)
    expect(Object.keys(files).sort()).toEqual(['manifest.json', ...manifest.entries.map(entry => entry.path)].sort())
    for (const entry of manifest.entries) { expect(files[entry.path].length).toBe(entry.sizeBytes); expect(hash(files[entry.path])).toBe(entry.sha256) }
    for (const binding of manifest.licenseBindings) {
      expect(manifest.entries.find(entry => entry.path === binding.licensePath)?.role).toBe('license')
      expect(files[binding.licensePath]?.length).toBeGreaterThan(0)
    }
    const images = manifest.entries.filter(entry => entry.role === 'asset')
    const decoded = await page.evaluate(async images => {
      const result = []
      for (const image of images) {
        const bitmap = await createImageBitmap(new Blob([Uint8Array.from(image.bytes)], { type: image.mimeType }))
        try { result.push({ sha256: image.sha256, width: bitmap.width, height: bitmap.height }) } finally { bitmap.close() }
      }
      return result
    }, images.map(entry => ({ sha256: entry.sha256, mimeType: entry.mimeType, bytes: Array.from(files[entry.path]) })))
    for (const asset of Object.values(document.assets)) expect(decoded.find(image => image.sha256 === asset.sha256)).toMatchObject({ width: asset.pixelWidth, height: asset.pixelHeight })
    if (fileName) await fs.writeFile(path.join(output, fileName), data)
    return { document, identity, appearance, manifest, sha256: hash(data), bytes: data.length, decoded,
      resources: manifest.entries.filter(entry => ['asset', 'license'].includes(entry.role)).map(entry => ({ path: entry.path, sha256: entry.sha256, sizeBytes: entry.sizeBytes })) }
  }

  step('Home default production entry and no development API')
  await page.goto(report.url); await expect(page.getByRole('heading', { level: 1, name: '把故事画成可以探索的地方', exact: true })).toBeVisible()
  report.devApiAtHome = await noDev(); await shot('home-desktop.png')
  await page.setViewportSize({ width: 390, height: 844 })
  // Wait for fonts and compositor frames after resizing before full-page capture.
  // Actual scrolling is audited separately if the browser capture tiles repeat.
  await page.evaluate(async () => { await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))) })
  report.homeNarrowWidth = await page.evaluate(() => document.documentElement.scrollWidth)
  expect(report.homeNarrowWidth).toBeLessThanOrEqual(390); await shot('home-390.png'); await page.setViewportSize(report.viewport)

  step('Create a native complete blank project from Home')
  await home().getByRole('button', { name: '新建场景', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '新建空白场景', exact: true })
  await dialog.getByLabel('场景名称', { exact: true }).fill('U1a 生产统一工作区')
  await dialog.getByLabel('画布宽度', { exact: true }).fill('18000'); await dialog.getByLabel('画布高度', { exact: true }).fill('12000')
  await dialog.getByRole('button', { name: '创建空白场景', exact: true }).click(); await expect(dialog).toHaveCount(0); await settled()
  report.devApiAtWorkspace = await noDev()
  const blank = await archive('blank.sceneweave')
  expect(Object.keys(blank.document.props)).toHaveLength(0); expect(Object.keys(blank.document.propDefinitions)).toHaveLength(23)
  expect(Object.keys(blank.document.materials)).toHaveLength(11); expect(Object.keys(blank.document.prefabDefinitions)).toHaveLength(3); expect(blank.decoded).toHaveLength(34)
  report.blank = { sceneId: blank.document.sceneId, revision: blank.document.revision, bytes: blank.bytes, sha256: blank.sha256, decodedImages: blank.decoded.length }

  step('Place an actual fixed stock object and edit its rotation')
  const definition = Object.values(blank.document.propDefinitions).find(item => item.defaultAppearance.kind === 'image')
  expect(definition).toBeDefined()
  await page.getByRole('tab', { name: '素材库', exact: true }).click()
  await page.getByLabel('搜索组件素材', { exact: true }).fill(definition.id)
  await page.getByRole('button', { name: `放置组件 ${definition.name}`, exact: true }).click()
  await number('放置 X', 5000); await number('放置 Y', 4500)
  await page.getByLabel('放置表面', { exact: true }).selectOption(`floor:${Object.keys(blank.document.floors)[0]}`)
  await page.getByRole('button', { name: '在此放置', exact: true }).click(); await settled()
  const placed = await archive(), propId = Object.keys(placed.document.props)[0]
  expect(Object.keys(placed.document.props)).toHaveLength(1)
  await page.getByTestId('workspace-navigation').getByRole('tab', { name: '对象', exact: true }).click()
  await page.getByRole('group', { name: '场景对象分类', exact: true }).getByRole('button', { name: '物件', exact: true }).click()
  await page.getByLabel('搜索场景物件', { exact: true }).fill(propId)
  await page.locator(`.asset-entity-list [data-entity-id="${propId}"]`).click()
  await number('物件旋转', 25); await settled()
  const edited = await archive('edited.sceneweave')
  expect(edited.document.props[propId].rotationDeg).toBe(25); expect(edited.document.revision).toBe(placed.document.revision + 1)
  expect(edited.identity).toEqual(placed.identity); expect(edited.resources).toEqual(blank.resources)
  expect(edited.manifest.licenseBindings).toEqual(blank.manifest.licenseBindings)
  const viewport = page.getByRole('group', { name: '地图视口', exact: true })
  const beforeZoom = Number(await viewport.getAttribute('data-zoom'))
  await page.getByRole('button', { name: '放大地图', exact: true }).click()
  await expect.poll(async () => Number(await viewport.getAttribute('data-zoom'))).toBeGreaterThan(beforeZoom)
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  const selected = await viewport.getAttribute('data-selected-ids'), zoom = await viewport.getAttribute('data-zoom')
  await expect(page.getByRole('button', { name: '撤销素材编辑', exact: true })).toBeEnabled(); await shot('workspace-edited-desktop.png')

  step('Home Continue preserves the visible editing session and undo')
  await page.getByRole('button', { name: '回到首页', exact: true }).click(); await expect(home()).toBeVisible()
  await page.locator(`[data-project-key="v6:${edited.document.sceneId}"]`).getByRole('button', { name: '继续编辑', exact: true }).click(); await settled()
  await expect(viewport).toHaveAttribute('data-selected-ids', selected); await expect(viewport).toHaveAttribute('data-zoom', zoom)
  await expect(page.getByRole('button', { name: '撤销素材编辑', exact: true })).toBeEnabled()
  const continued = await archive('continued.sceneweave')
  expect(continued.document).toEqual(edited.document); expect(continued.identity).toEqual(edited.identity); expect(continued.appearance).toEqual(edited.appearance)
  expect(continued.resources).toEqual(edited.resources); expect(continued.manifest.licenseBindings).toEqual(edited.manifest.licenseBindings)

  step('Refresh Home and explicitly reopen the same persisted v6 project')
  await page.getByRole('button', { name: '回到首页', exact: true }).click(); await expect(home()).toBeVisible(); await page.reload()
  await expect(home()).toBeVisible(); await home().getByRole('button', { name: '刷新工程列表', exact: true }).click()
  await page.locator(`[data-project-key="v6:${edited.document.sceneId}"]`).getByRole('button', { name: '打开', exact: true }).click(); await settled()
  const reopened = await archive('reopened.sceneweave')
  expect(reopened.document).toEqual(edited.document); expect(reopened.identity).toEqual(edited.identity); expect(reopened.appearance).toEqual(edited.appearance); expect(reopened.resources).toEqual(edited.resources)
  expect(reopened.manifest.licenseBindings).toEqual(edited.manifest.licenseBindings)
  report.reopen = { sceneId: reopened.document.sceneId, revision: reopened.document.revision, propId, rotationDeg: reopened.document.props[propId].rotationDeg, bytes: reopened.bytes, sha256: reopened.sha256,
    sameDocumentIdentityAppearanceAndResources: true, sameSessionSelectionAndZoom: { selected, zoom } }
  await shot('workspace-reopened-desktop.png'); report.devApiAtEnd = await noDev()
  expect(report.dialogs).toEqual([]); expect(report.pageErrors).toEqual([]); expect(report.consoleErrors).toEqual([]); expect(report.httpErrors).toEqual([])
  report.status = 'passed'
} catch (error) {
  report.status = 'failed'; report.error = error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : { message: String(error) }
  if (page) await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {})
  process.exitCode = 1
} finally {
  report.finishedAt = new Date().toISOString()
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2))
  await context?.close().catch(() => {}); await browser?.close().catch(() => {})
  process.stdout.write(`U1a production smoke ${report.status}: ${path.join(output, 'report.json')}\n`)
}
