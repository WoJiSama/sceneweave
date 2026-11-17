import { test, expect, type Page } from '@playwright/test'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { createKeyboardProject, keyboardProjectBackup, keyboardWorkspaceSaved, selectKeyboardProp } from './keyboard-ux-helpers'
import { openSamples, openSceneObjects, openWorkspaceModule } from './workspace-navigation-helpers'
import { mapExportButton, openDetailsBySummary } from './workspace-ux-helpers'

async function openSample(page: Page, name: string) {
  await createKeyboardProject(page, '海洋精修前的独立工程')
  await openSamples(page); await page.getByRole('button', { name, exact: true }).click()
  const confirmation = page.getByRole('dialog', { name: '确认打开工程', exact: true })
  await expect(confirmation).toBeVisible({ timeout: 90000 })
  await confirmation.getByRole('button', { name: '保存并打开副本', exact: true }).click(); await keyboardWorkspaceSaved(page)
}
async function adopt(page: Page) {
  const review = page.getByRole('region', { name: '候选审阅', exact: true })
  const checkbox = review.getByLabel('确认完整影响范围', { exact: true }); if (await checkbox.count()) await checkbox.check()
  await review.getByRole('button', { name: /^采用/ }).click(); await expect(review).toHaveCount(0); await keyboardWorkspaceSaved(page)
}
async function png(page: Page, audience: 'gm' | 'player', path: string) {
  const download = page.waitForEvent('download'); await (await mapExportButton(page, audience)).click()
  await (await download).saveAs(path); await keyboardWorkspaceSaved(page); await page.locator('.workspace-export-menu > summary').click()
  return createHash('sha256').update(await readFile(path)).digest('hex')
}
async function deliver(files: [string, string][]) {
  const directory = process.env.SCENEWEAVE_OCEAN_DELIVERY_DIR ? join(process.env.SCENEWEAVE_OCEAN_DELIVERY_DIR, 'refinement') : join(process.cwd(), 'work', 'ocean-refinement', 'delivery'); await mkdir(directory, { recursive: true })
  for (const [source, target] of files) await writeFile(join(directory, target), await readFile(source))
}
async function publicWallPixels(page: Page, gm: string, player: string) {
  const encoded = await Promise.all([gm, player].map(async path => (await readFile(path)).toString('base64')))
  const result = await page.evaluate(async values => {
    const buffers = await Promise.all(values.map(async value => {
      const picture = new Image(); picture.src = `data:image/png;base64,${value}`; await picture.decode()
      const canvas = document.createElement('canvas'); canvas.width = picture.naturalWidth; canvas.height = picture.naturalHeight
      try { const context = canvas.getContext('2d')!; context.drawImage(picture, 0, 0); return context.getImageData(0, 0, canvas.width, canvas.height) }
      finally { canvas.width = canvas.height = 0 }
    }))
    const [a, b] = buffers; let maxDelta = 0, changedPixels = 0
    for (let i = 0; i < a.data.length; i += 4) {
      let delta = 0
      for (let c = 0; c < 4; c++) delta = Math.max(delta, Math.abs(a.data[i + c] - b.data[i + c]))
      if (delta) changedPixels++; maxDelta = Math.max(maxDelta, delta)
    }
    return { sameSize: a.width === b.width && a.height === b.height, pixels: a.width * a.height, changedPixels, maxDelta }
  }, encoded)
  // Player walls use a canonical order for privacy. At shared antialiased joins
  // this can differ by a few channel levels from GM insertion order.
  expect(result.sameSize).toBe(true)
  expect(result.maxDelta).toBeLessThanOrEqual(5)
  expect(result.changedPixels / result.pixels).toBeLessThan(.0001)
}

test('nearshore battle uses ordinary terrain feather and movable persisted wake effects', async ({ page }, info) => {
  test.setTimeout(test.info().project.name === 'chrome' ? 240000 : 900000)
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await openSample(page, '碎潮礁湾 · 近岸海战')
  const initialPath = info.outputPath('nearshore.sceneweave'), initial = await keyboardProjectBackup(page, initialPath)
  const gm = info.outputPath('nearshore-gm.png'), player = info.outputPath('nearshore-player.png')
  expect(await png(page, 'gm', gm)).toBe(await png(page, 'player', player))
  const objects = await openSceneObjects(page)
  const all = objects.getByRole('button', { name: '显示所有图层的对象', exact: true }); if (await all.isVisible()) await all.click()
  await objects.getByLabel('搜索场景对象', { exact: true }).fill('ocean-shallows')
  await objects.locator('[data-entity-id="ocean-shallows"]').click()
  const feather = page.getByLabel('地形边缘羽化宽度', { exact: true })
  await feather.fill('0.75'); await feather.press('Tab')
  await page.getByRole('button', { name: '预览对象修改', exact: true }).click(); await adopt(page)
  const edited = await keyboardProjectBackup(page, info.outputPath('nearshore-feather.sceneweave'))
  expect(edited.document.terrainAreas['ocean-shallows'].boundaryBlendMm).toBe(750)
  expect(edited.document.props).toEqual(initial.document.props)
  await page.getByRole('button', { name: '撤销编辑', exact: true }).click(); await keyboardWorkspaceSaved(page)
  expect((await keyboardProjectBackup(page, info.outputPath('nearshore-undo.sceneweave'))).document.terrainAreas).toEqual(initial.document.terrainAreas)
  await selectKeyboardProp(page, 'ocean-cutter')
  const water = page.getByLabel('物件浸水效果', { exact: true }); await openDetailsBySummary(water, /^水面与水下表现$/)
  await expect(water.getByLabel('启用水线与静态尾流', { exact: true })).toBeChecked()
  await water.getByLabel('静态尾流长度', { exact: true }).fill('3500'); await water.getByLabel('静态尾流长度', { exact: true }).press('Tab')
  await water.getByRole('button', { name: '预览浸水效果', exact: true }).click(); await adopt(page)
  const changed = await keyboardProjectBackup(page, info.outputPath('nearshore-wake.sceneweave'))
  expect(changed.document.props['ocean-cutter'].waterAppearance).toMatchObject({ surfaceEffects: { wakeLengthMm: 3500 } })
  await page.reload(); await page.getByRole('button', { name: '回到首页', exact: true }).click()
  await page.getByTestId('workspace-home').locator(`[data-project-key="native:${changed.document.sceneId}"]`).getByRole('button', { name: '打开', exact: true }).click(); await keyboardWorkspaceSaved(page)
  expect((await keyboardProjectBackup(page, info.outputPath('nearshore-cold.sceneweave'))).hashes).toEqual(changed.hashes)
  expect(errors).toEqual([])
  await deliver([[initialPath, '碎潮礁湾.sceneweave'], [gm, '碎潮礁湾-主持人.png'], [player, '碎潮礁湾-玩家.png']])
})

test('three ship Floors expand in the common overview, edit independently and survive a fresh import', async ({ page, browser }, info) => {
  test.setTimeout(test.info().project.name === 'chrome' ? 300000 : 900000)
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await openSample(page, '逐潮号 · 三层船图')
  const initialPath = info.outputPath('ship.sceneweave'), initial = await keyboardProjectBackup(page, initialPath)
  await openWorkspaceModule(page, '场景')
  const overview = page.getByLabel('楼层地图总览', { exact: true }); await openDetailsBySummary(overview, /^展开楼层地图/)
  await expect(overview.locator('img')).toHaveCount(3, { timeout: 60000 })
  await expect.poll(() => overview.locator('img').evaluateAll(images => images.every(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0))).toBe(true)
  const files: [string, string][] = [[initialPath, '逐潮号.sceneweave']]
  for (const [floorId, name] of [['collection-floor', '甲板'], ['ship-cabin', '船舱'], ['ship-hold', '底舱']]) {
    await overview.getByRole('button', { name: `进入楼层 ${name}`, exact: true }).click(); await keyboardWorkspaceSaved(page)
    await expect(page.getByLabel('当前楼层', { exact: true })).toHaveValue(floorId)
    const gm = info.outputPath(`ship-${floorId}-gm.png`), player = info.outputPath(`ship-${floorId}-player.png`)
    const gmHash = await png(page, 'gm', gm), playerHash = await png(page, 'player', player)
    if (floorId === 'collection-floor') expect(gmHash).toBe(playerHash)
    else await publicWallPixels(page, gm, player)
    files.push([gm, `逐潮号-${name}-主持人.png`], [player, `逐潮号-${name}-玩家.png`])
  }
  await page.getByLabel('当前楼层', { exact: true }).selectOption('ship-cabin'); await keyboardWorkspaceSaved(page)
  await selectKeyboardProp(page, 'ship-captain-chair')
  const turn = page.getByLabel('物件旋转', { exact: true })
  if (await turn.isVisible()) { await turn.fill('90'); await turn.press('Tab') }
  else {
    await page.getByRole('button', { name: '顺时针旋转90°', exact: true }).click()
  }
  await keyboardWorkspaceSaved(page)
  const changed = await keyboardProjectBackup(page, info.outputPath('ship-edited.sceneweave'))
  expect(changed.document.props['ship-captain-chair'].rotationDeg).not.toBe(initial.document.props['ship-captain-chair'].rotationDeg)
  for (const [id, prop] of Object.entries(initial.document.props)) if (prop.floorId !== 'ship-cabin') expect(changed.document.props[id]).toEqual(prop)
  await page.getByRole('button', { name: '撤销编辑', exact: true }).click(); await keyboardWorkspaceSaved(page)
  expect((await keyboardProjectBackup(page, info.outputPath('ship-undo.sceneweave'))).document.props).toEqual(initial.document.props)
  await page.reload(); await page.getByRole('button', { name: '回到首页', exact: true }).click()
  await page.getByTestId('workspace-home').locator(`[data-project-key="native:${initial.document.sceneId}"]`).getByRole('button', { name: '打开', exact: true }).click(); await keyboardWorkspaceSaved(page)
  expect((await keyboardProjectBackup(page, info.outputPath('ship-cold.sceneweave'))).document.props).toEqual(initial.document.props)
  const fresh = await browser.newContext()
  try {
    const imported = await fresh.newPage(); await imported.goto(new URL('./#home', page.url()).href)
    const choosing = imported.waitForEvent('filechooser'); await imported.getByTestId('workspace-home').getByRole('button', { name: '打开工程文件', exact: true }).click()
    await (await choosing).setFiles(initialPath); await keyboardWorkspaceSaved(imported)
    const saved = await keyboardProjectBackup(imported, info.outputPath('ship-imported.sceneweave'))
    expect(saved.document.sceneId).not.toBe(initial.document.sceneId)
    expect({ ...saved.document, sceneId: initial.document.sceneId, createdAt: initial.document.createdAt, updatedAt: initial.document.updatedAt }).toEqual(initial.document)
    await imported.getByLabel('当前楼层', { exact: true }).selectOption('ship-hold'); await keyboardWorkspaceSaved(imported)
    expect(await png(imported, 'player', info.outputPath('ship-imported-player.png'))).toBe(createHash('sha256').update(await readFile(info.outputPath('ship-ship-hold-player.png'))).digest('hex'))
  } finally { await fresh.close() }
  expect(errors).toEqual([])
  await deliver(files)
})
