// Normal production UI only. Project facts come from actual downloaded archives.
import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { unzipSync, strFromU8 } from 'fflate'
import { keyboardProjectBackup, keyboardResourceHashes, keyboardWorkspaceSaved, openKeyboardPanel } from './keyboard-ux-helpers'
import { mapExportButton, openDetailsBySummary } from './workspace-ux-helpers'
import { openWorkspaceModule } from './workspace-navigation-helpers'

test.use({ actionTimeout: 15_000 })
const review = (page: Page) => page.getByRole('region', { name: '候选审阅', exact: true }).and(page.locator('.workspace-candidate-review'))

async function closeDrawers(page: Page) {
  if (await page.getByTestId('workspace-layout').getAttribute('data-narrow') !== 'true') return
  for (const [id, name] of [['resources', '内容面板'], ['inspector', '当前详情']] as const) {
    const panel = page.getByTestId(`workspace-${id}`)
    if (await panel.getAttribute('data-open') === 'true') await panel.getByRole('button', { name: `关闭${name}`, exact: true }).click()
  }
}

async function number(page: Page, name: string, value: number) {
  if (name.startsWith('房间起点')) {
    const details = page.locator('.building-panel form details').filter({ has: page.getByLabel(name, { exact: true }) })
    if (await details.getAttribute('open') === null) await details.locator('summary').click()
  }
  const input = page.getByLabel(name, { exact: true })
  await input.fill(String(value)); await input.press('Tab')
}

async function adopt(page: Page) {
  await closeDrawers(page)
  await openKeyboardPanel(page, 'inspector')
  await review(page).getByLabel('确认完整影响范围', { exact: true }).check()
  await review(page).getByRole('button', { name: '采用结构修改', exact: true }).click()
  await expect(review(page)).toHaveCount(0); await keyboardWorkspaceSaved(page)
}

async function building(page: Page) {
  return openWorkspaceModule(page, '建筑')
}

async function selectStructure(page: Page, id: string) {
  const scene = await openWorkspaceModule(page, '场景')
  const allLayers = scene.getByRole('button', { name: '显示所有图层的对象', exact: true })
  if (await allLayers.isVisible()) await allLayers.click()
  await scene.getByRole('group', { name: '场景对象分类', exact: true }).getByRole('button', { name: '结构', exact: true }).click()
  await scene.getByLabel('搜索场景对象', { exact: true }).fill(id)
  await scene.locator(`[data-entity-id="${id}"]`).click()
  return openKeyboardPanel(page, 'inspector')
}

async function room(page: Page, name: string, x: number, y: number, width: number, height: number) {
  const resources = await building(page)
  await resources.getByRole('group', { name: '建筑任务', exact: true }).getByRole('button', { name: /^绘制房间/ }).click()
  await page.getByLabel('房间形状', { exact: true }).selectOption('rectangle')
  await page.getByLabel('房间名称', { exact: true }).fill(name)
  for (const [label, value] of [['房间起点 X', x], ['房间起点 Y', y], ['房间宽度', width], ['房间高度', height]] as const) await number(page, label, value)
  await page.getByRole('button', { name: '预览新房间', exact: true }).click(); await adopt(page)
}

async function selectRoom(page: Page, id: string) {
  return selectStructure(page, id)
}

async function note(page: Page, text: string, visibility: 'public' | 'gm', x: number, y: number) {
  await building(page)
  await closeDrawers(page)
  await page.getByRole('button', { name: '工具：注记', exact: true }).click()
  await openKeyboardPanel(page, 'inspector')
  await page.getByLabel('新注记内容', { exact: true }).fill(text)
  await page.getByLabel('新注记可见性', { exact: true }).selectOption(visibility)
  await number(page, '新注记 X', x); await number(page, '新注记 Y', y)
  await page.getByRole('button', { name: '预览新增注记', exact: true }).click(); await adopt(page)
}

async function image(page: Page, audience: 'player' | 'gm', path: string) {
  const download = page.waitForEvent('download')
  await (await mapExportButton(page, audience)).click()
  const actual = await download
  expect(actual.suggestedFilename()).toBe(`sceneweave-${audience}-map.png`)
  await actual.saveAs(path); await expect(page.locator('.asset-busy')).toHaveCount(0)
  await page.locator('.workspace-export-menu > summary').click()
  const bytes = await readFile(path), chunks: string[] = []
  expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
  let offset = 8
  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset), kind = bytes.toString('ascii', offset + 4, offset + 8)
    chunks.push(kind); expect(['IHDR', 'PLTE', 'tRNS', 'IDAT', 'IEND', 'sRGB']).toContain(kind)
    offset += length + 12
    if (kind === 'IEND') break
  }
  expect(offset).toBe(bytes.length)
  const pixels = await page.evaluate(async base64 => {
    const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(base64), char => char.charCodeAt(0))], { type: 'image/png' }))
    const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!; ctx.drawImage(bitmap, 0, 0); bitmap.close()
    const rgba = ctx.getImageData(0, 0, canvas.width, canvas.height).data
    const digest = await crypto.subtle.digest('SHA-256', rgba)
    // Every interior pixel of the fixed 9,1--17,9 m mask, excluding its raster edge.
    let masked = 0, unexpected = 0
    for (let y = Math.ceil(canvas.height / 12) + 2; y < Math.floor(canvas.height * 9 / 12) - 2; y++) {
      for (let x = Math.ceil(canvas.width * 9 / 18) + 2; x < Math.floor(canvas.width * 17 / 18) - 2; x++) {
        const i = (y * canvas.width + x) * 4; masked++
        if (rgba[i] !== 216 || rgba[i + 1] !== 213 || rgba[i + 2] !== 197 || rgba[i + 3] !== 255) unexpected++
      }
    }
    return { width: canvas.width, height: canvas.height, rgbaSha256: [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join(''), masked, unexpected }
  }, bytes.toString('base64'))
  expect(pixels.width).toBe(4096); expect(pixels.height).toBe(Math.round(4096 * 12 / 18))
  if (audience === 'player') { expect(pixels.masked).toBeGreaterThan(3_000_000); expect(pixels.unexpected).toBe(0) }
  return { ...pixels, chunks, byteSha256: createHash('sha256').update(bytes).digest('hex') }
}

async function reopen(page: Page, sceneId: string) {
  await page.reload(); await expect(page.locator('.asset-save')).toHaveText('尚未打开工程')
  await page.getByRole('button', { name: '回到首页', exact: true }).click()
  await page.locator(`[data-project-key="native:${sceneId}"]`).getByRole('button', { name: '打开', exact: true }).click()
  await keyboardWorkspaceSaved(page)
}

for (const width of [1512, 390]) test(`complete export journey and actual secret pixels survive fresh import at ${width}px`, async ({ page, browser }, info: TestInfo) => {
  test.setTimeout(300_000)
  await page.setViewportSize({ width, height: width === 390 ? 844 : 982 })
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await page.goto('./#home')
  await page.getByTestId('workspace-home').getByRole('button', { name: '新建场景', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '新建空白场景', exact: true })
  await dialog.getByLabel('场景名称', { exact: true }).fill(`含秘密交付 ${width}`)
  await dialog.getByLabel('画布宽度', { exact: true }).fill('18'); await dialog.getByLabel('画布高度', { exact: true }).fill('12')
  await dialog.getByRole('button', { name: '创建空白场景', exact: true }).click(); await keyboardWorkspaceSaved(page)
  await room(page, '玩家大厅', 1, 1, 5, 4)
  await note(page, 'PUBLIC LABEL', 'public', 2, 8)
  await building(page)
  await closeDrawers(page)
  await page.getByRole('button', { name: '工具：遮罩', exact: true }).click()
  await openKeyboardPanel(page, 'inspector')
  for (const [label, value] of [['遮罩 X', 9], ['遮罩 Y', 1], ['遮罩宽度', 8], ['遮罩高度', 8]] as const) await number(page, label, value)
  await page.getByRole('button', { name: '预览新增遮罩', exact: true }).click(); await adopt(page)
  await closeDrawers(page)
  const baseline = await keyboardProjectBackup(page, info.outputPath('public-control.sceneweave'))
  const control = await image(page, 'player', info.outputPath('player-control.png'))
  const publicRoom = Object.values(baseline.document.rooms)[0]

  await room(page, 'SECRET ROOM CANARY', 11, 3, 4, 4)
  const twoRooms = await keyboardProjectBackup(page, info.outputPath('two-rooms.sceneweave'))
  const privateRoom = Object.values(twoRooms.document.rooms).find(row => row.id !== publicRoom.id)!
  let inspector = await selectRoom(page, privateRoom.id)
  await inspector.getByLabel('房间可见性', { exact: true }).selectOption('gm')
  await inspector.getByRole('button', { name: '预览房间属性', exact: true }).click(); await adopt(page)
  await openWorkspaceModule(page, '素材')
  const components = page.getByRole('region', { name: '组件素材库', exact: true })
  await components.getByLabel('搜索组件素材', { exact: true }).fill('铜色桌灯')
  await components.getByRole('button', { name: '放置组件 铜色桌灯', exact: true }).click()
  inspector = await openKeyboardPanel(page, 'inspector')
  await inspector.getByLabel('放置表面', { exact: true }).selectOption(`room:${privateRoom.id}`)
  await number(page, '放置 X', 13); await number(page, '放置 Y', 5)
  await inspector.getByRole('button', { name: '在此放置', exact: true }).click(); await keyboardWorkspaceSaved(page)
  await note(page, 'GM NOTE CANARY', 'gm', 2, 7)

  // Public text attached to private geometry must also disappear from player output.
  inspector = await selectRoom(page, privateRoom.id)
  await openDetailsBySummary(inspector, /^附着线索 \/ 文字$/)
  await inspector.getByLabel('附着线索内容', { exact: true }).fill('PRIVATE ANCHOR CANARY')
  await inspector.getByLabel('附着线索可见性', { exact: true }).selectOption('public')
  await inspector.getByRole('button', { name: '预览附着线索', exact: true }).click(); await adopt(page)

  const wall = Object.values(baseline.document.walls).find(row => baseline.document.vertices[row.startVertexId].yMm === 1000 && baseline.document.vertices[row.endVertexId].yMm === 1000)!
  inspector = await selectStructure(page, wall.id)
  await number(page, '开口近端偏移', 1.5); await number(page, '开口净宽', 0.9)
  await inspector.getByLabel('秘密开口', { exact: true }).check()
  await expect(inspector.getByLabel('揭示秘密开口', { exact: true })).not.toBeChecked()
  await inspector.getByRole('button', { name: '预览新增门窗', exact: true }).click(); await adopt(page)
  await closeDrawers(page)
  const backupPath = info.outputPath('complete-secret.sceneweave')
  const complete = await keyboardProjectBackup(page, backupPath)
  const prop = Object.values(complete.document.props)[0]
  expect(prop.visibility).toBe('gm'); expect(prop.supportRef).toEqual({ kind: 'room', id: privateRoom.id })
  expect(complete.document.rooms[privateRoom.id].visibility).toBe('gm')
  expect(Object.values(complete.document.openings)).toEqual([expect.objectContaining({ secret: true, revealed: false })])
  expect(Object.values(complete.document.notes).map(row => row.text).sort()).toEqual(['GM NOTE CANARY', 'PRIVATE ANCHOR CANARY', 'PUBLIC LABEL'])
  const files = unzipSync(new Uint8Array(await readFile(backupPath)))
  expect(strFromU8(files['scene.json'])).toContain('SECRET ROOM CANARY')
  expect(Object.keys(keyboardResourceHashes(complete.hashes)).length).toBeGreaterThan(0)
  const player = await image(page, 'player', info.outputPath('player-secret.png'))
  const gm = await image(page, 'gm', info.outputPath('gm-secret.png'))
  expect(player.rgbaSha256).toBe(control.rgbaSha256)
  expect(player.byteSha256).toBe(control.byteSha256)
  expect(gm.rgbaSha256).not.toBe(player.rgbaSha256)

  // Removing the only safety mask is already rejected at the real candidate boundary.
  const mask = Object.values(complete.document.regions).find(region => region.kind === 'manualMask')!
  inspector = await selectStructure(page, mask.id)
  let unexpectedDownloads = 0; const record = () => unexpectedDownloads++
  page.on('download', record)
  await inspector.getByRole('button', { name: '预览删除遮罩', exact: true }).click()
  await expect(page.locator('.asset-busy')).toHaveCount(0)
  await expect(page.getByRole('alert').filter({ hasText: '玩家输出不安全' })).toContainText('固定遮罩未覆盖')
  await expect(review(page)).toHaveCount(0)
  page.off('download', record); expect(unexpectedDownloads).toBe(0)
  await closeDrawers(page)
  const refused = await keyboardProjectBackup(page, info.outputPath('refused-unchanged.sceneweave'))
  expect(refused.hashes).toEqual(complete.hashes)
  const restored = await image(page, 'player', info.outputPath('player-after-refusal.png'))
  expect(restored.rgbaSha256).toBe(player.rgbaSha256)

  // A genuinely empty browser storage context imports the actual complete download.
  const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 982 } })
  try {
    const importedPage = await context.newPage(); importedPage.on('pageerror', error => errors.push(error.message))
    await importedPage.goto(new URL('./#home', page.url()).href)
    const chooser = importedPage.waitForEvent('filechooser')
    await importedPage.getByTestId('workspace-home').getByRole('button', { name: '打开工程文件', exact: true }).click()
    await (await chooser).setFiles(backupPath)
    await keyboardWorkspaceSaved(importedPage)
    const imported = await keyboardProjectBackup(importedPage, info.outputPath('fresh-import.sceneweave'))
    expect(imported.document.sceneId).not.toBe(complete.document.sceneId)
    expect(imported.document.revision).toBe(0)
    expect(imported.document).toEqual({ ...complete.document, sceneId: imported.document.sceneId, revision: 0, createdAt: imported.document.createdAt, updatedAt: imported.document.updatedAt })
    expect(imported.identity).toEqual(complete.identity); expect(imported.appearance).toEqual(complete.appearance)
    expect(keyboardResourceHashes(imported.hashes)).toEqual(keyboardResourceHashes(complete.hashes))
    const stableFiles = (hashes: Record<string, string>) => Object.fromEntries(Object.entries(hashes).filter(([name]) => name !== 'scene.json' && name !== 'manifest.json'))
    expect(stableFiles(imported.hashes)).toEqual(stableFiles(complete.hashes))
    await reopen(importedPage, imported.document.sceneId)
    const cold = await keyboardProjectBackup(importedPage, info.outputPath('fresh-import-cold.sceneweave'))
    expect(cold.hashes).toEqual(imported.hashes)
    const coldPlayer = await image(importedPage, 'player', info.outputPath('player-import-cold.png'))
    const coldGm = await image(importedPage, 'gm', info.outputPath('gm-import-cold.png'))
    expect(coldPlayer).toEqual(player); expect(coldGm).toEqual(gm)
    await importedPage.screenshot({ path: info.outputPath('export-import-journey.png') })
    const dimensions = await importedPage.evaluate(() => ({ viewport: innerWidth, root: document.documentElement.scrollWidth, body: document.body.scrollWidth }))
    expect(dimensions.root).toBeLessThanOrEqual(width); expect(dimensions.body).toBeLessThanOrEqual(width)
    await writeFile(info.outputPath('export-privacy-facts.json'), JSON.stringify({ width, browserVersion: browser.version(), control, player, gm, coldPlayer, coldGm, files: complete.hashes, dimensions, unexpectedDownloads, errors, excluded: ['all terrain privacy variants', 'VTT software import', 'user visual P3'] }, null, 2))
  } finally { await context.close() }
  expect(errors).toEqual([])
})
