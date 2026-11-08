import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { unzipSync } from 'fflate'
import { keyboardProjectBackup, keyboardResourceHashes, keyboardWorkspaceSaved, openKeyboardPanel, selectKeyboardProp } from './keyboard-ux-helpers'
import { mapExportButton, openExportMenu } from './workspace-ux-helpers'
import { openWorkspaceModule } from './workspace-navigation-helpers'

async function closeDrawers(page: Page) {
  if (await page.getByTestId('workspace-layout').getAttribute('data-narrow') !== 'true') return
  for (const [id, name] of [['resources', '内容面板'], ['inspector', '当前详情']] as const) {
    const panel = page.getByTestId(`workspace-${id}`)
    if (await panel.getAttribute('data-open') === 'true') await panel.getByRole('button', { name: `关闭${name}`, exact: true }).click()
  }
}

async function screenshot(page: Page, info: TestInfo, name: string) {
  const dimensions = await page.evaluate(() => ({ viewport: innerWidth, root: document.documentElement.scrollWidth, body: document.body.scrollWidth }))
  expect(dimensions.root).toBeLessThanOrEqual(dimensions.viewport)
  expect(dimensions.body).toBeLessThanOrEqual(dimensions.viewport)
  await page.screenshot({ path: info.outputPath(`${name}.png`) })
}

for (const width of [1512, 390]) test(`production generation, edit, cold open and delivery at ${width}px preserves export Escape scope`, async ({ page, browser }, info) => {
  test.setTimeout(300_000)
  await page.setViewportSize({ width, height: width === 390 ? 844 : 982 })
  const errors: string[] = [], generationRequests: string[] = [], workers: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('worker', worker => workers.push(worker.url()))
  page.on('request', request => { if (/\/v1\/(?:generation|tasks)/.test(request.url())) generationRequests.push(request.url()) })
  const response = await page.goto('./#home')
  expect(response?.ok()).toBe(true)
  expect(await response!.text()).not.toContain('/@vite/client')
  await screenshot(page, info, '01-home')
  await page.getByTestId('workspace-home').getByRole('button', { name: '新建场景', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '新建空白场景', exact: true })
  const name = dialog.getByLabel('场景名称', { exact: true })
  await name.fill(`走查原工程 ${width}`)
  // These synthetic events check handler ownership, not a native IME session.
  for (const state of [{ isComposing: true }, { keyCode: 229 }]) {
    await name.dispatchEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, ...state })
    await expect(dialog).toBeVisible()
    await expect(name).toHaveValue(`走查原工程 ${width}`)
  }
  await screenshot(page, info, '02-new-project')
  await dialog.getByRole('button', { name: '创建空白场景', exact: true }).click()
  await keyboardWorkspaceSaved(page)
  const original = await keyboardProjectBackup(page, info.outputPath('original.sceneweave'))

  const fileMenu = page.locator('.workspace-file-menu')
  await fileMenu.locator('summary').click()
  await fileMenu.getByRole('button', { name: '新建空白场景', exact: true }).click()
  await dialog.getByLabel('场景名称', { exact: true }).fill('取消的新建草稿')
  await dialog.getByLabel('场景名称', { exact: true }).press('Escape')
  await expect(dialog).toHaveCount(0)
  if (await fileMenu.getAttribute('open') !== null) await fileMenu.locator('summary').click()
  await expect(page.getByRole('heading', { name: `走查原工程 ${width}`, exact: true, level: 1 })).toBeVisible()
  await expect(page.locator('.workspace-unified')).toHaveAttribute('data-revision', String(original.document.revision))
  const resources = await openWorkspaceModule(page, '生成')
  await resources.getByRole('group', { name: '生成场景类型', exact: true }).getByRole('button', { name: /^室内布局/ }).click()
  const interior = page.getByRole('region', { name: '室内布局生成', exact: true, includeHidden: true })
  const title = `完整旅程室内 ${width}`
  await interior.getByLabel('室内工程名称', { exact: true }).fill(title)
  await screenshot(page, info, '03-generation-form')
  await interior.getByRole('button', { name: '预览室内布局', exact: true }).click()
  const candidate = page.getByTestId('workspace-inspector').getByLabel('室内布局候选摘要', { exact: true })
  await expect(candidate).toBeVisible({ timeout: 90_000 })
  await screenshot(page, info, '04-generation-candidate')
  await closeDrawers(page)

  const help = page.locator('.workspace-help'), helpSummary = help.locator('summary')
  await helpSummary.click()
  for (const state of [{ isComposing: true }, { keyCode: 229 }]) {
    await helpSummary.dispatchEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, ...state })
    await expect(help).toHaveAttribute('open', '')
    await expect(candidate).toHaveCount(1)
  }
  await helpSummary.press('Escape')
  await expect(help).not.toHaveAttribute('open')
  await expect(helpSummary).toBeFocused()
  await expect(candidate).toHaveCount(1)

  // Escape belongs to the innermost disclosure, even while global candidate
  // cancellation is available. Composition events are handler checks only.
  const menu = page.locator('.workspace-export-menu'), summary = menu.locator('summary')
  await openExportMenu(page)
  await expect(menu.getByRole('button', { name: '玩家地图 PNG', exact: true })).toBeDisabled()
  await summary.focus()
  await summary.press('Escape')
  await expect(menu).not.toHaveAttribute('open')
  await expect(summary).toBeFocused()
  await expect(candidate).toHaveCount(1)
  await expect(page.locator('.workspace-unified')).toHaveAttribute('data-revision', String(original.document.revision))
  await openExportMenu(page)
  await summary.dispatchEvent('keydown', { key: 'Escape', code: 'Escape', isComposing: true, bubbles: true })
  await expect(menu).toHaveAttribute('open', '')
  await expect(candidate).toHaveCount(1)
  await summary.dispatchEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 229, bubbles: true })
  await expect(menu).toHaveAttribute('open', '')
  await expect(candidate).toHaveCount(1)
  await summary.press('Escape')
  await expect(menu).not.toHaveAttribute('open')
  await openKeyboardPanel(page, 'inspector')
  await expect(candidate).toBeVisible()
  await candidate.getByRole('button', { name: '保存为新工程', exact: true }).click()
  // The saved label can appear before full-project preparation has released
  // its busy state. Wait for that state explicitly before inspecting the map.
  await expect(page.locator('.asset-busy')).toHaveCount(0, { timeout: 30000 })
  await keyboardWorkspaceSaved(page)
  const generated = await keyboardProjectBackup(page, info.outputPath('generated.sceneweave'))
  expect(generated.document.sceneId).not.toBe(original.document.sceneId)
  expect(Object.keys(generated.document.rooms)).toHaveLength(2)
  expect(Object.keys(generated.document.props).length).toBeGreaterThan(0)
  expect(workers.some(url => /\/worker-[^/]+\.js(?:\?|$)/.test(url))).toBe(true)
  await closeDrawers(page)
  await screenshot(page, info, '05-generated-map')

  const prop = Object.values(generated.document.props)[0]
  await selectKeyboardProp(page, prop.id)
  const inspector = await openKeyboardPanel(page, 'inspector')
  const x = inspector.getByLabel('物件 X', { exact: true })
  await x.fill(String((prop.positionMm.x + 1) / 1000)); await x.press('Enter')
  await keyboardWorkspaceSaved(page)
  const edited = await keyboardProjectBackup(page, info.outputPath('edited.sceneweave'))
  expect(edited.document.props[prop.id].positionMm).toEqual({ ...prop.positionMm, x: prop.positionMm.x + 1 })
  expect(edited.document.revision).toBe(generated.document.revision + 1)
  expect(keyboardResourceHashes(edited.hashes)).toEqual(keyboardResourceHashes(generated.hashes))
  await closeDrawers(page)
  await page.getByRole('button', { name: '撤销编辑', exact: true }).click()
  await keyboardWorkspaceSaved(page)
  expect((await keyboardProjectBackup(page, info.outputPath('undone.sceneweave'))).document.props).toEqual(generated.document.props)
  await page.getByRole('button', { name: '重做编辑', exact: true }).click()
  await keyboardWorkspaceSaved(page)
  const redone = await keyboardProjectBackup(page, info.outputPath('redone.sceneweave'))
  expect(redone.document.props).toEqual(edited.document.props)

  for (const module of ['场景', '素材', '建筑', '地形', '氛围', '生成', 'AI', '历史'] as const) {
    await openWorkspaceModule(page, module)
    await screenshot(page, info, `panel-${module}`)
  }
  await closeDrawers(page)
  await page.reload()
  await page.getByRole('button', { name: '回到首页', exact: true }).click()
  const home = page.getByTestId('workspace-home')
  await expect(home.locator(`[data-project-key="native:${original.document.sceneId}"]`)).toContainText(`走查原工程 ${width}`)
  await home.locator(`[data-project-key="native:${redone.document.sceneId}"]`).getByRole('button', { name: '打开', exact: true }).click()
  await keyboardWorkspaceSaved(page)
  const cold = await keyboardProjectBackup(page, info.outputPath('cold.sceneweave'))
  expect(cold.hashes).toEqual(redone.hashes)
  await closeDrawers(page)
  await openExportMenu(page)
  await screenshot(page, info, '06-export-menu')
  await menu.getByRole('button', { name: '玩家地图 PNG', exact: true }).focus()
  await page.keyboard.press('Escape')
  await expect(menu).not.toHaveAttribute('open')
  await expect(summary).toBeFocused()
  const images = []
  for (const audience of ['player', 'gm'] as const) {
    const event = page.waitForEvent('download', { timeout: 60_000 })
    await (await mapExportButton(page, audience)).click()
    const output = info.outputPath(`${audience}.png`)
    await (await event).saveAs(output)
    await expect(page.locator('.asset-busy')).toHaveCount(0)
    const bytes = await readFile(output)
    expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
    expect(bytes.readUInt32BE(16)).toBe(4096)
    images.push({ audience, sha256: createHash('sha256').update(bytes).digest('hex'), width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) })
    await summary.click()
  }
  const imported = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 982 } })
  try {
    const fresh = await imported.newPage()
    fresh.on('pageerror', error => errors.push(error.message))
    await fresh.goto(new URL('./#home', page.url()).href)
    const chooser = fresh.waitForEvent('filechooser')
    await fresh.getByTestId('workspace-home').getByRole('button', { name: '打开工程文件', exact: true }).click()
    await (await chooser).setFiles(info.outputPath('cold.sceneweave'))
    await keyboardWorkspaceSaved(fresh)
    const copy = await keyboardProjectBackup(fresh, info.outputPath('imported.sceneweave'))
    expect(copy.document.sceneId).not.toBe(cold.document.sceneId)
    expect(copy.document).toEqual({ ...cold.document, sceneId: copy.document.sceneId, revision: 0, createdAt: copy.document.createdAt, updatedAt: copy.document.updatedAt })
    expect(copy.appearance).toEqual(cold.appearance)
    expect(copy.identity).toEqual(cold.identity)
    expect(keyboardResourceHashes(copy.hashes)).toEqual(keyboardResourceHashes(cold.hashes))
    const manifest = async (path: string) => JSON.parse(new TextDecoder().decode(unzipSync(new Uint8Array(await readFile(path)))['manifest.json']))
    const sourceManifest = await manifest(info.outputPath('cold.sceneweave'))
    const importedManifest = await manifest(info.outputPath('imported.sceneweave'))
    expect(importedManifest.assetRecords).toEqual(sourceManifest.assetRecords)
    expect(importedManifest.licenseBindings).toEqual(sourceManifest.licenseBindings)
    await screenshot(fresh, info, '07-imported-project')
  } finally { await imported.close() }
  expect(errors).toEqual([])
  expect(generationRequests).toEqual([])
  await writeFile(info.outputPath('journey-facts.json'), JSON.stringify({ width, errors, workers, generationRequests, source: original.document.sceneId,
    generated: generated.document.sceneId, revision: cold.document.revision, rooms: Object.keys(cold.document.rooms).length,
    props: Object.keys(cold.document.props).length, images, nativeImeOrScreenReaderEvidence: false }, null, 2))
})
