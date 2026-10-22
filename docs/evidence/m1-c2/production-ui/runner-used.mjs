import { chromium, expect } from '@playwright/test'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { strFromU8, unzipSync } from 'fflate'

const output = path.resolve('docs/evidence/m1-c2/production-ui')
await fs.mkdir(output, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const report = { url: 'http://127.0.0.1:4173/sceneweave/#history', browser: browser.version(), viewport: { width: 1512, height: 982 }, errors: [], consoleErrors: [], httpErrors: [], screenshots: [] }
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
let page
try {
  page = await browser.newPage({ viewport: report.viewport, deviceScaleFactor: 1 })
  page.on('pageerror', error => report.errors.push(error.message))
  page.on('console', event => { if (event.type() === 'error') report.consoleErrors.push({ text: event.text(), url: event.location().url }) })
  page.on('response', response => { if (response.status() >= 400) report.httpErrors.push({ url: response.url(), status: response.status() }) })
  const settled = async () => {
    await expect(page.locator('.asset-busy')).toHaveCount(0)
    await expect(page.locator('.asset-save')).toHaveText('本地已保存')
    await expect(page.locator('.asset-map-wrap')).toHaveAttribute('aria-busy', 'false')
  }
  const revision = async () => Number(await page.getByTestId('history-workbench').getAttribute('data-revision'))
  const number = async (label, value) => { const input = page.getByRole('spinbutton', { name: label, exact: true }); await input.fill(String(value)); await input.press('Tab') }
  const shot = async (name, fullPage = false) => { await page.screenshot({ path: path.join(output, name), fullPage }); report.screenshots.push(name) }
  const adopt = async () => {
    await expect(page.getByRole('button', { name: '采用结构修改', exact: true })).toBeDisabled()
    await page.getByRole('checkbox', { name: '确认建筑完整影响范围', exact: true }).check()
    await page.getByRole('button', { name: '采用结构修改', exact: true }).click(); await settled()
  }
  const download = async label => {
    const pending = page.waitForEvent('download')
    await page.getByRole('button', { name: label, exact: true }).click()
    const downloaded = await pending, bytes = await fs.readFile(await downloaded.path())
    await expect(page.locator('.asset-busy')).toHaveCount(0)
    return { name: downloaded.suggestedFilename(), bytes }
  }
  const archive = async label => {
    const downloaded = await download(label), files = unzipSync(downloaded.bytes)
    const manifest = JSON.parse(strFromU8(files['manifest.json'])), document = JSON.parse(strFromU8(files['scene.json']))
    for (const entry of manifest.entries) { expect(files[entry.path].length).toBe(entry.sizeBytes); expect(hash(files[entry.path])).toBe(entry.sha256) }
    expect(manifest.containerVersion).toBe(4); expect(manifest.documentSchemaVersion).toBe(3); expect(manifest.profile).toBe('m1-history')
    return { files, document, manifest, data: downloaded.bytes, bytes: downloaded.bytes.length, sha256: hash(downloaded.bytes) }
  }
  const room = async (purpose, x) => {
    await page.getByLabel('房间名称', { exact: true }).fill(purpose)
    for (const [label, value] of [['房间起点 X', x], ['房间起点 Y', 2000], ['房间宽度', 4000], ['房间高度', 4000]]) await number(label, value)
    await page.getByRole('button', { name: '预览新房间', exact: true }).click(); await adopt()
    const details = page.locator('.building-entity-list > details').filter({ has: page.getByRole('button', { name: purpose, exact: true }) })
    return details.getAttribute('data-building-room-id')
  }
  const details = id => page.locator(`[data-building-room-id="${id}"]`)
  const expand = async id => { if (await details(id).getAttribute('open') === null) { await details(id).locator(':scope > summary').focus(); await details(id).locator(':scope > summary').press('Enter') } }
  const wall = async (roomId, wallId) => { await expand(roomId); await details(roomId).locator(`[data-building-wall-id="${wallId}"]`).click(); await expect(page.locator('.building-stable-id')).toHaveText(wallId) }
  await page.goto(report.url)
  report.productDevApiKeys = await page.evaluate(() => Object.getOwnPropertyNames(window).filter(key => key.startsWith('__sceneweave')))
  expect(report.productDevApiKeys).toEqual([])
  await page.getByRole('button', { name: '新建空白场景', exact: true }).first().click()
  const dialog = page.getByRole('dialog', { name: '新建空白场景', exact: true })
  await dialog.getByLabel('场景名称', { exact: true }).fill('C2 正式页面 · 双室')
  await dialog.getByLabel('画布宽度', { exact: true }).fill('18000')
  await dialog.getByLabel('画布高度', { exact: true }).fill('12000')
  await dialog.getByRole('button', { name: '创建空白场景', exact: true }).click(); await expect(dialog).toHaveCount(0); await settled()
  await page.getByRole('tab', { name: '建筑', exact: true }).click()
  const leftId = await room('左室初稿', 2000), rightId = await room('右室初稿', 6000)
  await expand(leftId); await expand(rightId)
  const leftWalls = await details(leftId).locator('[data-building-wall-id]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-building-wall-id')))
  const rightWalls = await details(rightId).locator('[data-building-wall-id]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-building-wall-id')))
  const common = leftWalls.filter(id => rightWalls.includes(id)); expect(common).toHaveLength(1)
  const sharedId = common[0]
  await wall(leftId, sharedId)
  await number('开口近端偏移', 1000); await number('开口净宽', 900)
  await page.getByRole('button', { name: '预览新增门窗', exact: true }).click(); await adopt()
  await wall(leftId, leftWalls.find(id => id !== sharedId))
  await page.getByLabel('开口类型', { exact: true }).selectOption('window')
  await number('开口近端偏移', 1000); await number('开口净宽', 800)
  await page.getByRole('button', { name: '预览新增门窗', exact: true }).click(); await adopt()
  const initial = await archive('完整工程')
  expect(Object.keys(initial.document.rooms)).toHaveLength(2); expect(Object.keys(initial.document.walls)).toHaveLength(7)
  expect(Object.keys(initial.document.vertices)).toHaveLength(6); expect(Object.keys(initial.document.openings)).toHaveLength(2)
  expect(initial.document.walls[sharedId].thicknessMm).toBe(100)
  report.geometry = { roomIds: [leftId, rightId], sharedWallId: sharedId, rooms: 2, uniqueWalls: 7, vertices: 6, doors: 1, windows: 1 }
  report.initialRevision = await revision()
  await page.getByRole('button', { name: '命名历史快照', exact: true }).click()
  await page.getByRole('button', { name: '新建命名快照', exact: true }).click()
  await page.getByLabel('命名快照名称', { exact: true }).fill('双室 · 初稿')
  await page.getByRole('button', { name: '保存快照', exact: true }).click()
  await expect(page.getByRole('button', { name: '查看快照 双室 · 初稿', exact: true })).toBeVisible(); await settled()
  expect(await revision()).toBe(report.initialRevision)
  await page.getByRole('tab', { name: '建筑', exact: true }).click()
  await wall(leftId, sharedId); await number('编辑墙厚', 180)
  await page.getByRole('button', { name: '预览墙厚修改', exact: true }).click(); await adopt()
  await details(rightId).locator(':scope > summary').getByRole('button').click()
  await page.getByLabel('编辑房间名称', { exact: true }).fill('右室后续编辑')
  await page.getByRole('button', { name: '预览房间属性', exact: true }).click(); await adopt()
  report.beforeRestoreRevision = await revision()
  const before = await archive('完整工程')
  expect(before.document.walls[sharedId].thicknessMm).toBe(180)
  await page.getByRole('tab', { name: '历史', exact: true }).click()
  await page.getByRole('button', { name: '查看快照 双室 · 初稿', exact: true }).click()
  await page.getByLabel('恢复对象类型', { exact: true }).selectOption('structure')
  await page.getByLabel('历史建筑对象类型', { exact: true }).selectOption('wall')
  await page.getByLabel('搜索场景建筑对象', { exact: true }).fill(sharedId)
  await page.locator(`.structure-history-scope [data-entity-id="${sharedId}"]`).click()
  await page.getByRole('button', { name: '检查完整结构依赖', exact: true }).click()
  const scope = await page.getByLabel('结构恢复完整影响', { exact: true }).inputValue()
  for (const id of [leftId, rightId, sharedId]) expect(scope).toContain(id)
  report.restoredScope = scope
  await expect(page.getByRole('button', { name: '预览结构局部恢复', exact: true })).toBeDisabled()
  await page.getByRole('checkbox', { name: '确认结构恢复全部依赖', exact: true }).check()
  await page.getByRole('button', { name: '预览结构局部恢复', exact: true }).click()
  await expect(page.getByRole('status', { name: '结构恢复候选', exact: true })).toBeVisible()
  const difference = page.locator(`[data-structure-restore-change-id="${sharedId}"] [data-change-field="thicknessMm"]`)
  await expect(difference).toContainText('180'); await expect(difference).toContainText('100')
  await shot('structure-preview-desktop.png')
  await page.setViewportSize({ width: 390, height: 844 }); await page.evaluate(() => window.scrollTo(0, 0))
  report.narrowDocumentWidth = await page.evaluate(() => document.documentElement.scrollWidth)
  expect(report.narrowDocumentWidth).toBeLessThanOrEqual(390)
  await shot('structure-preview-narrow.png', true)
  await page.getByRole('button', { name: '取消结构恢复', exact: true }).click()
  expect(await revision()).toBe(report.beforeRestoreRevision)
  await expect(page.locator('.history-snapshot-row')).toHaveCount(1)
  report.cancelPreservesRevisionAndHistory = true
  await page.setViewportSize(report.viewport)
  await page.getByRole('button', { name: '预览结构局部恢复', exact: true }).click()
  await page.getByRole('button', { name: '保护当前并采用结构恢复', exact: true }).click(); await settled()
  report.adoptedRevision = await revision(); expect(report.adoptedRevision).toBe(report.beforeRestoreRevision + 1)
  await expect(page.locator('.history-snapshot-row')).toHaveCount(2)
  await page.getByRole('button', { name: '撤销素材编辑', exact: true }).click(); await settled()
  report.undoneRevision = await revision(); expect(report.undoneRevision).toBe(report.adoptedRevision + 1)
  const undone = await archive('完整工程'); expect(undone.document.walls[sharedId]).toEqual(before.document.walls[sharedId])
  await page.getByRole('button', { name: '重做素材编辑', exact: true }).click(); await settled()
  report.redoneRevision = await revision(); expect(report.redoneRevision).toBe(report.undoneRevision + 1)
  await page.getByRole('checkbox', { name: '备份携带所选快照', exact: true }).check()
  await page.getByRole('checkbox', { name: '备份快照 双室 · 初稿', exact: true }).check()
  const complete = await archive('下载工程与所选历史 · 1 份'), history = JSON.parse(strFromU8(complete.files['history.json']))
  expect(complete.manifest.packageMode).toBe('history')
  expect(history.snapshots.map(item => item.summary.name)).toEqual(['双室 · 初稿'])
  expect(complete.document.walls[sharedId]).toEqual(initial.document.walls[sharedId])
  expect(complete.document.rooms[rightId]).toEqual(before.document.rooms[rightId])
  expect(complete.document.vertices).toEqual(before.document.vertices)
  expect(complete.document.openings).toEqual(before.document.openings)
  expect(complete.document.entityLayers).toEqual(before.document.entityLayers)
  expect(complete.document.revision).toBe(report.redoneRevision)
  const historic = JSON.parse(strFromU8(complete.files[history.snapshots[0].scenePath]))
  expect(historic).toEqual(initial.document)
  const resources = item => item.manifest.entries.filter(entry => entry.role === 'asset' || entry.role === 'license').map(entry => [entry.path, entry.sizeBytes, entry.sha256])
  expect(resources(complete)).toEqual(resources(initial))
  await fs.writeFile(path.join(output, 'double-room-history.sceneweave'), complete.data)
  report.backup = { bytes: complete.bytes, sha256: complete.sha256, manifest: complete.manifest, selectedNames: history.snapshots.map(item => item.summary.name), currentRevision: complete.document.revision, laterRoomNameRetained: complete.document.rooms[rightId].purpose, allEntryHashesVerified: true }
  await page.getByRole('tab', { name: '建筑', exact: true }).click(); await wall(leftId, sharedId)
  await page.evaluate(() => window.scrollTo(0, 0)); await shot('building-adopted-desktop.png')
  await page.setViewportSize({ width: 390, height: 844 }); await page.evaluate(() => window.scrollTo(0, 0))
  report.narrowBuildingDocumentWidth = await page.evaluate(() => document.documentElement.scrollWidth)
  expect(report.narrowBuildingDocumentWidth).toBeLessThanOrEqual(390)
  await shot('building-narrow.png', true)
  expect(report.errors).toEqual([])
  expect(report.consoleErrors.filter(event => !event.url.endsWith('/favicon.ico'))).toEqual([])
  expect(report.httpErrors.filter(event => !event.url.endsWith('/favicon.ico') || event.status !== 404)).toEqual([])
  report.status = 'passed'
} catch (error) {
  report.status = 'failed'; report.failure = String(error)
  if (page) { await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {}); await fs.writeFile(path.join(output, 'failure-ui.txt'), await page.locator('body').innerText().catch(() => '')) }
  throw error
} finally {
  report.finishedAt = new Date().toISOString()
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2))
  await browser.close()
}
