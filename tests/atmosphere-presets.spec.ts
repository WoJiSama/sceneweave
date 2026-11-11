import { expect, test, type Page } from '@playwright/test'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { visualBase } from '../src/shared/visual/base'
import { createKeyboardProject, keyboardProjectBackup, keyboardResourceHashes, keyboardWorkspaceSaved, placeKeyboardLamp } from './keyboard-ux-helpers'
import { openWorkspaceModule } from './workspace-navigation-helpers'
import { mapExportButton, reloadSaved } from './workspace-ux-helpers'

const reviewFor = (page: Page) => page.getByRole('region', { name: '候选审阅', exact: true })
async function adoptVisual(page: Page) {
  const review = reviewFor(page)
  await expect(review.getByRole('button', { name: '采用视觉修改', exact: true })).toBeDisabled()
  await review.getByLabel('确认完整影响范围', { exact: true }).check()
  await review.getByRole('button', { name: '采用视觉修改', exact: true }).click()
  await expect(review).toHaveCount(0)
  await keyboardWorkspaceSaved(page)
}
async function openPresets(page: Page) {
  const resources = await openWorkspaceModule(page, '氛围')
  await resources.getByRole('button', { name: /^氛围预设 ·/ }).click()
  const presets = page.getByTestId('workspace-inspector').getByRole('region', { name: '氛围预设', exact: true })
  await expect(presets).toBeVisible()
  return presets
}
async function canvasHash(page: Page) {
  const png = await page.getByLabel('材质场景主持人预览', { exact: true }).evaluate(node => (node as HTMLCanvasElement).toDataURL('image/png'))
  return createHash('sha256').update(png).digest('hex')
}
async function playerPngHash(page: Page, path: string) {
  const download = page.waitForEvent('download')
  await (await mapExportButton(page, 'player')).click()
  await (await download).saveAs(path)
  await keyboardWorkspaceSaved(page)
  await page.locator('.workspace-export-menu > summary').click()
  return createHash('sha256').update(await readFile(path)).digest('hex')
}

test('atmosphere comparison remains reachable without view-bar overflow at 390px', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await createKeyboardProject(page, '窄屏原色比较入口')
  const button = page.getByRole('button', { name: '对比原色（仅预览）', exact: true })
  await expect(button).toBeVisible()
  const geometry = await page.locator('.asset-view-bar').evaluate(node => {
    const bar = node.getBoundingClientRect(), actions = node.querySelector('.asset-view-actions')!.getBoundingClientRect()
    return { viewport: innerWidth, body: document.body.scrollWidth, right: actions.right, barRight: bar.right, left: actions.left, barLeft: bar.left }
  })
  expect(geometry.body).toBeLessThanOrEqual(geometry.viewport)
  expect(geometry.right).toBeLessThanOrEqual(geometry.barRight)
  expect(geometry.right).toBeLessThanOrEqual(geometry.viewport)
  expect(geometry.left).toBeGreaterThanOrEqual(geometry.barLeft)
  for (const name of ['对比原色（仅预览）', '地面查看']) {
    const bounds = await page.getByRole('button', { name, exact: true }).boundingBox()
    expect(bounds).not.toBeNull()
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(geometry.viewport)
  }
  await button.click()
  await expect(button).toHaveAttribute('aria-pressed', 'true')
  await keyboardWorkspaceSaved(page)
  await page.screenshot({ path: info.outputPath('atmosphere-comparison-390.png'), animations: 'disabled' })
})

test('atmosphere presets preview, switch without stacking, preserve independent effects and round-trip through normal project files', async ({ page, browser }, info) => {
  test.setTimeout(300000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await createKeyboardProject(page, '氛围配方与独立效果保全')
  await placeKeyboardLamp(page)
  const resources = await openWorkspaceModule(page, '氛围')
  const inspector = page.getByTestId('workspace-inspector')
  await resources.getByRole('navigation', { name: '视觉工具', exact: true }).getByRole('button', { name: '灯光', exact: true }).click()
  await inspector.getByLabel('视觉灯光强度', { exact: true }).fill('0.4')
  await inspector.getByRole('button', { name: '预览灯光', exact: true }).click()
  await adoptVisual(page)
  await resources.getByRole('navigation', { name: '视觉工具', exact: true }).getByRole('button', { name: '雾', exact: true }).click()
  await inspector.getByLabel('视觉雾透明度', { exact: true }).fill('0.08')
  await inspector.getByRole('button', { name: '预览区域雾', exact: true }).click()
  await adoptVisual(page)
  await resources.getByRole('navigation', { name: '视觉工具', exact: true }).getByRole('button', { name: '滤镜', exact: true }).click()
  await inspector.getByLabel('视觉滤镜预设', { exact: true }).selectOption('aged')
  await inspector.getByLabel('视觉饱和度', { exact: true }).fill('0.85')
  await inspector.getByRole('button', { name: '预览滤镜', exact: true }).click()
  await adoptVisual(page)
  const before = await keyboardProjectBackup(page, info.outputPath('atmosphere-before.sceneweave'))
  const manual = visualBase(before.document)!
  expect(Object.keys(manual.lights)).toHaveLength(1)
  expect(Object.keys(manual.fogs)).toHaveLength(1)
  expect(Object.keys(manual.filters)).toHaveLength(1)
  const preservedEffects = (document: typeof before.document) => {
    const base = visualBase(document)!
    expect(base.lights).toEqual(manual.lights)
    for (const [id, value] of Object.entries(manual.fogs)) expect(base.fogs[id]).toEqual(value)
    for (const [id, value] of Object.entries(manual.filters)) expect(base.filters[id]).toEqual(value)
  }

  let presets = await openPresets(page)
  await expect(presets).toContainText('环境光与调色作用于全图')
  await expect(presets).toContainText('主持人与玩家输出都会应用')
  await presets.getByRole('combobox', { name: '氛围预设', exact: true }).selectOption('dusk')
  await presets.getByRole('button', { name: '预览氛围预设', exact: true }).click()
  await expect(reviewFor(page)).toContainText('氛围预设 · 黄昏')
  await expect(page.locator('.workspace-unified')).toHaveAttribute('data-revision', String(before.document.revision))
  await reviewFor(page).getByRole('button', { name: '取消视觉预览', exact: true }).click()
  await keyboardWorkspaceSaved(page)
  expect((await keyboardProjectBackup(page, info.outputPath('atmosphere-cancelled.sceneweave'))).hashes).toEqual(before.hashes)

  presets = await openPresets(page)
  await presets.getByRole('combobox', { name: '氛围预设', exact: true }).selectOption('dusk')
  await presets.getByRole('button', { name: '预览氛围预设', exact: true }).click()
  await adoptVisual(page)
  const dusk = await keyboardProjectBackup(page, info.outputPath('atmosphere-dusk.sceneweave'))
  preservedEffects(dusk.document)
  expect(dusk.document).toEqual({ ...before.document, visual: dusk.document.visual, revision: before.document.revision + 1, updatedAt: dusk.document.updatedAt })
  expect(Object.keys(visualBase(dusk.document)!.filters)).toHaveLength(2)
  expect(Object.keys(visualBase(dusk.document)!.fogs)).toHaveLength(2)
  expect(keyboardResourceHashes(dusk.hashes)).toEqual(keyboardResourceHashes(before.hashes))

  presets = await openPresets(page)
  await expect(presets).toContainText('当前预设：黄昏')
  await presets.getByRole('combobox', { name: '氛围预设', exact: true }).selectOption('moonlit')
  await presets.getByRole('button', { name: '预览氛围预设', exact: true }).click()
  await adoptVisual(page)
  const night = await keyboardProjectBackup(page, info.outputPath('atmosphere-night.sceneweave'))
  preservedEffects(night.document)
  expect(Object.keys(visualBase(night.document)!.filters)).toEqual(Object.keys(visualBase(dusk.document)!.filters))
  expect(Object.keys(visualBase(night.document)!.fogs)).toEqual(Object.keys(visualBase(dusk.document)!.fogs))
  expect(night.document.revision).toBe(dusk.document.revision + 1)
  await page.screenshot({ path: info.outputPath('atmosphere-moonlit.png'), animations: 'disabled' })

  // Comparison changes only the same camera's editor drawing. Public PNGs and
  // complete-project backups must retain the adopted atmosphere throughout.
  const compare = page.getByRole('button', { name: '对比原色（仅预览）', exact: true })
  await expect(compare).toHaveAttribute('aria-pressed', 'false')
  const zoom = page.getByLabel('地图缩放比例', { exact: true })
  const view = { zoom: await zoom.textContent(), box: await page.getByLabel('材质场景主持人预览', { exact: true }).boundingBox() }
  const withAtmosphere = await canvasHash(page)
  const publicPng = await playerPngHash(page, info.outputPath('atmosphere-player.png'))
  await compare.click()
  await expect(compare).toHaveAttribute('aria-pressed', 'true')
  await keyboardWorkspaceSaved(page)
  await expect.poll(() => canvasHash(page)).not.toBe(withAtmosphere)
  expect(await zoom.textContent()).toBe(view.zoom)
  expect(await page.getByLabel('材质场景主持人预览', { exact: true }).boundingBox()).toEqual(view.box)
  const bypass = await keyboardProjectBackup(page, info.outputPath('atmosphere-comparison.sceneweave'))
  expect(bypass.document).toEqual(night.document)
  expect(bypass.appearance).toEqual(night.appearance)
  expect(await playerPngHash(page, info.outputPath('atmosphere-player-during-comparison.png'))).toBe(publicPng)
  await expect(compare).toHaveAttribute('aria-pressed', 'true')
  await compare.click()
  await keyboardWorkspaceSaved(page)
  await expect.poll(() => canvasHash(page)).toBe(withAtmosphere)
  expect(await zoom.textContent()).toBe(view.zoom)
  await page.getByRole('button', { name: '撤销编辑', exact: true }).click()
  await keyboardWorkspaceSaved(page)
  const undone = await keyboardProjectBackup(page, info.outputPath('atmosphere-undone.sceneweave'))
  expect(undone.document).toEqual({ ...dusk.document, revision: night.document.revision + 1, updatedAt: undone.document.updatedAt })
  await page.getByRole('button', { name: '重做编辑', exact: true }).click()
  await keyboardWorkspaceSaved(page)
  await compare.click()
  await expect(compare).toHaveAttribute('aria-pressed', 'true')
  await reloadSaved(page)
  await keyboardWorkspaceSaved(page)
  await expect(compare).toHaveAttribute('aria-pressed', 'false')
  const coldPath = info.outputPath('atmosphere-cold.sceneweave')
  const cold = await keyboardProjectBackup(page, coldPath)
  expect(cold.document.visual).toEqual(night.document.visual)
  expect(keyboardResourceHashes(cold.hashes)).toEqual(keyboardResourceHashes(before.hashes))

  const imported = await browser.newContext({ viewport: { width: 1512, height: 982 } })
  try {
    const fresh = await imported.newPage()
    fresh.on('pageerror', error => errors.push(error.message))
    await fresh.goto(new URL('./#home', page.url()).href)
    const chooser = fresh.waitForEvent('filechooser')
    await fresh.getByTestId('workspace-home').getByRole('button', { name: '打开工程文件', exact: true }).click()
    await (await chooser).setFiles(coldPath)
    await keyboardWorkspaceSaved(fresh)
    await expect(fresh.getByRole('button', { name: '对比原色（仅预览）', exact: true })).toHaveAttribute('aria-pressed', 'false')
    const copy = await keyboardProjectBackup(fresh, info.outputPath('atmosphere-imported.sceneweave'))
    expect(copy.document.visual).toEqual(cold.document.visual)
    expect(copy.appearance).toEqual(cold.appearance)
    expect(keyboardResourceHashes(copy.hashes)).toEqual(keyboardResourceHashes(cold.hashes))
    // Imported complete values still identify the same preset slots, so switching
    // to neutral must leave only the independently authored records.
    const freshPresets = await openPresets(fresh)
    await expect(freshPresets).toContainText('当前预设：月夜')
    await freshPresets.getByRole('combobox', { name: '氛围预设', exact: true }).selectOption('neutral')
    await freshPresets.getByRole('button', { name: '预览氛围预设', exact: true }).click()
    await adoptVisual(fresh)
    const neutral = await keyboardProjectBackup(fresh, info.outputPath('atmosphere-neutral.sceneweave'))
    preservedEffects(neutral.document)
    expect(visualBase(neutral.document)!.filters).toEqual(manual.filters)
    expect(visualBase(neutral.document)!.fogs).toEqual(manual.fogs)
  } finally { await imported.close() }
  expect(errors).toEqual([])
})
