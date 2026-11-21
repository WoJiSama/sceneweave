import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { createKeyboardProject, keyboardProjectBackup, keyboardResourceHashes, keyboardWorkspaceSaved, openKeyboardPanel } from './keyboard-ux-helpers'
import { closeWorkspaceDrawers, openSamples, openSceneObjects } from './workspace-navigation-helpers'
import { mapExportButton } from './workspace-ux-helpers'

test.use({ actionTimeout: 15000 })

const review = (page: Page) => page.getByRole('region', { name: '候选审阅', exact: true }).and(page.locator('.workspace-candidate-review'))
async function select(page: Page, id: string) {
  const panel = await openSceneObjects(page, '结构')
  const all = panel.getByRole('button', { name: '显示所有图层的对象', exact: true })
  if (await all.isVisible()) await all.click()
  await panel.getByLabel('搜索场景对象', { exact: true }).fill(id)
  await panel.locator(`[data-entity-id="${id}"]`).click()
  return openKeyboardPanel(page, 'inspector')
}
async function checkPreview(page: Page) {
  await closeWorkspaceDrawers(page); await openKeyboardPanel(page, 'inspector')
  for (const name of ['候选主持人地图', '候选玩家地图']) {
    const image = review(page).getByRole('img', { name, exact: true })
    await expect(image).toBeVisible({ timeout: 60000 })
    expect(await image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0)).toBe(true)
  }
  await review(page).getByLabel('确认完整影响范围', { exact: true }).check()
  const collateral = review(page).getByLabel('确认遮罩对公开内容的影响', { exact: true })
  if (await collateral.count()) {
    await expect(review(page).getByRole('button', { name: '采用结构修改', exact: true })).toBeDisabled()
    await collateral.check()
  }
}
async function adopt(page: Page) {
  await checkPreview(page)
  await review(page).getByRole('button', { name: '采用结构修改', exact: true }).click()
  await expect(review(page)).toHaveCount(0); await keyboardWorkspaceSaved(page)
}

for (const width of [1512, 390]) test(`room privacy is atomic, diagnoses failed edits, and previews real audiences at ${width}px`, async ({ page, browser }, info) => {
  test.setTimeout(300000)
  await page.setViewportSize({ width, height: width === 390 ? 844 : 982 })
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await createKeyboardProject(page, '秘密房间验收')
  await openSamples(page); await page.getByRole('button', { name: '灰橡小旅舍 · 完整可编辑', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '确认打开工程', exact: true })
  await dialog.getByRole('button', { name: '保存并打开副本', exact: true }).click(); await keyboardWorkspaceSaved(page)
  await closeWorkspaceDrawers(page)
  const before = await keyboardProjectBackup(page, info.outputPath('before.sceneweave'))
  const room = before.document.rooms['inn-linen']
  let inspector = await select(page, room.id)
  await inspector.getByLabel('房间可见性', { exact: true }).selectOption('gm')
  await inspector.getByLabel(/^同时设为秘密入口 /).first().check()
  await inspector.getByLabel('秘密房间线索', { exact: true }).fill('CANARY 私藏的账簿')
  await inspector.getByRole('button', { name: '预览房间属性', exact: true }).click()
  await checkPreview(page)
  const maskControls = review(page).getByRole('region', { name: '候选遮罩调整', exact: true })
  const candidateWidth = maskControls.getByLabel('候选遮罩 1 宽度', { exact: true }), initialWidth = await candidateWidth.inputValue()
  const oldPlayer = await review(page).getByRole('img', { name: '候选玩家地图', exact: true }).getAttribute('src')
  await candidateWidth.fill('0.5'); await candidateWidth.press('Tab')
  await maskControls.getByRole('button', { name: '更新遮罩并重检', exact: true }).click()
  await expect(maskControls.getByRole('region', { name: '保密覆盖诊断', exact: true })).toBeVisible()
  await expect(candidateWidth).toHaveValue('0.5')
  await expect(review(page).getByRole('button', { name: '采用结构修改', exact: true })).toBeDisabled()
  expect(await review(page).getByRole('img', { name: '候选玩家地图', exact: true }).getAttribute('src')).toBe(oldPlayer)
  await candidateWidth.fill(initialWidth); await candidateWidth.press('Tab')
  for (const details of await maskControls.locator('details').all()) {
    if (!await details.evaluate(node => node.hasAttribute('open'))) await details.locator('summary').click()
    await details.getByRole('checkbox').uncheck()
  }
  await maskControls.getByRole('button', { name: '更新遮罩并重检', exact: true }).click()
  await expect(review(page).getByRole('img', { name: '候选玩家地图', exact: true })).not.toHaveAttribute('src', oldPlayer!)
  await checkPreview(page)
  const impacts = review(page).getByRole('region', { name: '遮罩对公开内容的影响', exact: true })
  await impacts.getByRole('button', { name: /^定位 / }).first().click()
  const focused = page.getByRole('dialog', { name: '放大玩家与主持人对照', exact: true })
  await expect(focused.getByRole('img', { name: '玩家地图局部', exact: true })).toBeVisible()
  await focused.getByRole('button', { name: '查看整层', exact: true }).click()
  await expect(focused.getByRole('img', { name: '候选玩家地图', exact: true })).toBeVisible()
  await focused.getByRole('button', { name: '关闭放大预览', exact: true }).click()
  for (const details of await review(page).getByRole('region', { name: '候选遮罩调整', exact: true }).locator('details').all()) {
    if (!await details.evaluate(node => node.hasAttribute('open'))) await details.locator('summary').click()
    await details.getByRole('checkbox').check()
  }
  const solidPlayer = await review(page).getByRole('img', { name: '候选玩家地图', exact: true }).getAttribute('src')
  await review(page).getByRole('button', { name: '更新遮罩并重检', exact: true }).click()
  await expect(review(page).getByRole('img', { name: '候选玩家地图', exact: true })).not.toHaveAttribute('src', solidPlayer!)
  await checkPreview(page)
  await review(page).getByRole('button', { name: '放大对照预览', exact: true }).click()
  const comparison = page.getByRole('dialog', { name: '放大玩家与主持人对照', exact: true })
  await expect(comparison).toBeVisible()
  expect(await comparison.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
  await comparison.screenshot({ path: info.outputPath('privacy-comparison.png') })
  await comparison.getByRole('button', { name: '关闭放大预览', exact: true }).click()
  await page.screenshot({ path: info.outputPath('privacy-candidate.png') })
  await review(page).getByRole('button', { name: '返回调整秘密设置', exact: true }).click()
  await expect(review(page)).toHaveCount(0)
  inspector = await openKeyboardPanel(page, 'inspector')
  await expect(inspector.getByLabel('秘密房间线索', { exact: true })).toHaveValue('CANARY 私藏的账簿')
  await expect(inspector.getByLabel(/^同时设为秘密入口 /).first()).toBeChecked()
  await inspector.getByRole('button', { name: '预览房间属性', exact: true }).click(); await adopt(page)
  await closeWorkspaceDrawers(page)
  const secret = await keyboardProjectBackup(page, info.outputPath('secret.sceneweave'))
  expect(secret.document.revision).toBe(before.document.revision + 1)
  expect(secret.document.rooms[room.id].visibility).toBe('gm')
  expect(Object.values(secret.document.openings).filter(value => value.secret && !before.document.openings[value.id].secret)).toHaveLength(1)
  expect(Object.values(secret.document.notes).find(value => value.text === 'CANARY 私藏的账簿')?.visibility).toBe('gm')
  expect(secret.document.props).toEqual(before.document.props)
  expect(keyboardResourceHashes(secret.hashes)).toEqual(keyboardResourceHashes(before.hashes))
  const masks = Object.values(secret.document.regions).filter(value => value.kind === 'manualMask' && !before.document.regions[value.id])
  const widthMm = (region: typeof masks[number]) => Math.max(...region.boundaryMm.map(point => point.x)) - Math.min(...region.boundaryMm.map(point => point.x))
  // Select the main mask by geometry. Archive key order follows random IDs.
  const widest = (regions: typeof masks) => regions.toSorted((a, b) => widthMm(b) - widthMm(a))[0]
  let mask = widest(masks)
  expect(widthMm(mask)).toBeGreaterThan(500)
  await page.getByRole('button', { name: '撤销编辑', exact: true }).click(); await keyboardWorkspaceSaved(page)
  const undone = await keyboardProjectBackup(page, info.outputPath('undone.sceneweave'))
  expect(undone.document.rooms[room.id]).toEqual(before.document.rooms[room.id])
  expect(undone.document.openings).toEqual(before.document.openings)
  expect(undone.document.notes).toEqual(before.document.notes)
  expect(undone.document.regions).toEqual(before.document.regions)
  await page.getByRole('button', { name: '重做编辑', exact: true }).click(); await keyboardWorkspaceSaved(page)
  inspector = await select(page, mask.id)
  if (width === 1512) {
    const xs = mask.boundaryMm.map(point => point.x)
    await inspector.getByLabel('编辑遮罩宽度', { exact: true }).fill(String((Math.max(...xs) - Math.min(...xs)) / 1000 + 1))
    await inspector.getByLabel('编辑遮罩宽度', { exact: true }).press('Tab')
    await inspector.getByRole('button', { name: '预览遮罩修改', exact: true }).click(); await adopt(page)
    inspector = await select(page, mask.id)
    await inspector.getByRole('button', { name: '预览收紧遮罩', exact: true }).click(); await adopt(page)
    await closeWorkspaceDrawers(page)
    const refitted = await keyboardProjectBackup(page, info.outputPath('refitted.sceneweave'))
    expect(refitted.document.regions[mask.id].preservePublicRooms).toBe(true)
    expect(refitted.document.rooms).toEqual(secret.document.rooms)
    expect(refitted.document.props).toEqual(secret.document.props)
    mask = widest(Object.values(refitted.document.regions).filter(value => value.kind === 'manualMask'))
    inspector = await select(page, mask.id)
  }
  await inspector.getByLabel('编辑遮罩宽度', { exact: true }).fill('0.5')
  await inspector.getByLabel('编辑遮罩宽度', { exact: true }).press('Tab')
  await inspector.getByRole('button', { name: '预览遮罩修改', exact: true }).click()
  const diagnostic = inspector.getByRole('region', { name: '保密覆盖诊断', exact: true })
  await expect(diagnostic).toBeVisible(); await expect(diagnostic).toContainText('需补齐：X')
  await expect(inspector.getByLabel('编辑遮罩宽度', { exact: true })).toHaveValue('0.5')
  await expect(review(page)).toHaveCount(0)
  await diagnostic.getByRole('button', { name: '补齐遮罩并重试', exact: true }).click(); await adopt(page)
  await closeWorkspaceDrawers(page)
  const repaired = await keyboardProjectBackup(page, info.outputPath('repaired.sceneweave'))
  expect(repaired.document.regions[mask.id].boundaryMm[1].x - repaired.document.regions[mask.id].boundaryMm[0].x).toBe(500)
  expect(Object.values(repaired.document.regions).filter(value => value.kind === 'manualMask').length).toBeGreaterThan(masks.length)
  for (const audience of ['gm', 'player'] as const) {
    const pending = page.waitForEvent('download'); await (await mapExportButton(page, audience)).click()
    const file = info.outputPath(`${audience}.png`); await (await pending).saveAs(file)
    const bytes = await readFile(file)
    expect(bytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    if (audience === 'player') {
      const roomRing = (value: typeof room) => value.boundaryVertexIds.map(id => ({ x: repaired.document.vertices[id].xMm, y: repaired.document.vertices[id].yMm }))
      const pixels = await page.evaluate(async ({ base64, masks, bounds, publicRooms, privateRoom }) => {
        const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(base64), char => char.charCodeAt(0))], { type: 'image/png' }))
        const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height
        const context = canvas.getContext('2d', { willReadFrequently: true })!; context.drawImage(bitmap, 0, 0); bitmap.close()
        const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data
        const inside = (x: number, y: number, polygon: { x: number; y: number }[]) => {
          let value = false
          for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
            const a = polygon[i], b = polygon[j]
            if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) value = !value
          }
          return value
        }
        const interior = (ring: { x: number; y: number }[]) => {
          const xs = ring.map(p => p.x), ys = ring.map(p => p.y)
          return {
            left: Math.max(0, Math.ceil((Math.min(...xs) - bounds.x) / bounds.width * canvas.width) + 2),
            right: Math.min(canvas.width, Math.floor((Math.max(...xs) - bounds.x) / bounds.width * canvas.width) - 2),
            top: Math.max(0, Math.ceil((Math.min(...ys) - bounds.y) / bounds.height * canvas.height) + 2),
            bottom: Math.min(canvas.height, Math.floor((Math.max(...ys) - bounds.y) / bounds.height * canvas.height) - 2),
          }
        }
        const isMaskColor = (x: number, y: number) => {
          const i = (y * canvas.width + x) * 4
          return rgba[i] === 216 && rgba[i + 1] === 213 && rgba[i + 2] === 197 && rgba[i + 3] === 255
        }
        let sampled = 0, unexpected = 0, preserved = 0
        for (const mask of masks) {
          const { left, right, top, bottom } = interior(mask.boundaryMm)
          for (let y = top; y < bottom; y += 2) for (let x = left; x < right; x += 2) {
            const wx = bounds.x + (x + .5) / canvas.width * bounds.width, wy = bounds.y + (y + .5) / canvas.height * bounds.height
            const beige = isMaskColor(x, y)
            if (mask.preservePublicRooms && publicRooms.some(room => inside(wx, wy, room) && Math.min(...room.map(p => Math.hypot(p.x - wx, p.y - wy))) > 30)) {
              if (!beige) preserved++
              continue
            }
            // Ignore anti-aliased public-room boundary pixels, but never a private interior.
            if (mask.preservePublicRooms && publicRooms.some(room => room.some((a, index) => {
              const b = room[(index + 1) % room.length], length = Math.hypot(b.x - a.x, b.y - a.y)
              return Math.abs((b.x - a.x) * (wy - a.y) - (b.y - a.y) * (wx - a.x)) / length < 30
            }))) continue
            sampled++; if (!beige) unexpected++
          }
        }
        // The fixture's rectangular private room crosses multiple masks.
        // Scan its entire interior, including the individual mask borders.
        const { left, right, top, bottom } = interior(privateRoom)
        let privateUnexpected = 0
        for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) if (!isMaskColor(x, y)) privateUnexpected++
        return { sampled, unexpected, preserved, privateUnexpected, privateSampled: (right - left) * (bottom - top) }
      }, { base64: bytes.toString('base64'), masks: Object.values(repaired.document.regions).filter(value => value.kind === 'manualMask'), bounds: repaired.document.exportBoundsMm,
        publicRooms: Object.values(repaired.document.rooms).filter(room => room.visibility === 'public').map(roomRing), privateRoom: roomRing(repaired.document.rooms[room.id]) })
      expect(pixels.sampled).toBeGreaterThan(100000); expect(pixels.unexpected).toBe(0); expect(pixels.preserved).toBeGreaterThan(10000)
      expect(pixels.privateSampled).toBeGreaterThan(100000); expect(pixels.privateUnexpected).toBe(0)
    }
    await keyboardWorkspaceSaved(page); await page.locator('.workspace-export-menu > summary').click()
  }
  await page.reload(); await page.getByRole('button', { name: '回到首页', exact: true }).click()
  await page.locator(`[data-project-key="native:${repaired.document.sceneId}"]`).getByRole('button', { name: '打开', exact: true }).click()
  await keyboardWorkspaceSaved(page)
  const reopened = await keyboardProjectBackup(page, info.outputPath('reopened.sceneweave'))
  expect(reopened.document).toEqual(repaired.document)
  expect(keyboardResourceHashes(reopened.hashes)).toEqual(keyboardResourceHashes(before.hashes))
  const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 982 } })
  try {
    const importedPage = await context.newPage(); importedPage.on('pageerror', error => errors.push(error.message))
    await importedPage.goto(new URL('./#home', page.url()).href)
    const chooser = importedPage.waitForEvent('filechooser')
    await importedPage.getByTestId('workspace-home').getByRole('button', { name: '打开工程文件', exact: true }).click()
    await (await chooser).setFiles(info.outputPath('repaired.sceneweave'))
    await keyboardWorkspaceSaved(importedPage)
    const imported = await keyboardProjectBackup(importedPage, info.outputPath('fresh-import.sceneweave'))
    expect(imported.document.sceneId).not.toBe(repaired.document.sceneId)
    expect(imported.document.regions).toEqual(repaired.document.regions)
    expect(imported.identity).toEqual(repaired.identity)
    expect(imported.appearance).toEqual(repaired.appearance)
    expect(keyboardResourceHashes(imported.hashes)).toEqual(keyboardResourceHashes(repaired.hashes))
    const download = importedPage.waitForEvent('download'); await (await mapExportButton(importedPage, 'player')).click()
    const path = info.outputPath('fresh-import-player.png'); await (await download).saveAs(path)
    const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
    expect(hash(await readFile(path))).toBe(hash(await readFile(info.outputPath('player.png'))))
  } finally { await context.close() }
  expect(errors).toEqual([])
})
