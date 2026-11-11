import { expect, test, type Page } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { unzipSync } from 'fflate'
const DETAILED_ISLAND_NAME = '岬湾苔岛 · 地表细化'
import { visualBase } from '../src/shared/visual/base'
import type { SceneDocument } from '../src/shared/model/scene'
import { createKeyboardProject, keyboardProjectBackup, keyboardResourceHashes, keyboardWorkspaceSaved } from './keyboard-ux-helpers'
import { openWorkspaceModule } from './workspace-navigation-helpers'
import { mapExportButton, openDetailsBySummary } from './workspace-ux-helpers'

const { PNG } = createRequire(import.meta.url)('../node_modules/playwright-core/lib/utilsBundle.js')
async function exportMap(page: Page, audience: 'gm' | 'player', filename: string) {
  const downloading = page.waitForEvent('download'); await (await mapExportButton(page, audience)).click()
  await (await downloading).saveAs(filename); await keyboardWorkspaceSaved(page)
  await page.locator('.workspace-export-menu > summary').click()
  const bytes = await readFile(filename), image = PNG.sync.read(bytes)
  return { image, hash: createHash('sha256').update(image.data).digest('hex') }
}
async function adoptVisual(page: Page) {
  const review = page.getByRole('region', { name: '候选审阅', exact: true })
  await review.getByLabel('确认完整影响范围', { exact: true }).check()
  await review.getByRole('button', { name: '采用视觉修改', exact: true }).click()
  await expect(review).toHaveCount(0); await keyboardWorkspaceSaved(page)
}
const physical = (document: SceneDocument) => {
  const scene = structuredClone(document)
  for (const area of Object.values(scene.terrainAreas)) area.surfaceStyle = null
  return Object.fromEntries((['floors', 'vertices', 'rooms', 'walls', 'openings', 'terrainAreas', 'terrainEdges', 'terrainConnections', 'paths', 'props', 'entityLayers', 'constraints'] as const).map(key => [key, scene[key]]))
}

test('new island layout delivers saved surfaces, neutral/effect paired PNGs, real crops and cold-editable content', async ({ page }, info) => {
  test.setTimeout(300000)
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await createKeyboardProject(page, '新地表样板整合')
  const original = await keyboardProjectBackup(page, info.outputPath('original.sceneweave'))
  await page.locator('.workspace-file-menu > summary').click()
  await page.getByRole('group', { name: '文件操作', exact: true }).getByRole('button', { name: '从样板开始', exact: true }).click()
  const samples = page.getByRole('region', { name: '场景样板', exact: true })
  await openDetailsBySummary(samples, /^从样板开始$/)
  await samples.getByRole('button', { name: DETAILED_ISLAND_NAME, exact: true }).click()
  const opening = page.getByRole('dialog', { name: '确认打开工程', exact: true })
  await expect(opening).toBeVisible({ timeout: 90000 })
  await opening.getByRole('button', { name: '保存并打开副本', exact: true }).click()
  await expect(opening).toHaveCount(0)
  await keyboardWorkspaceSaved(page)
  await expect(page.getByRole('heading', { name: DETAILED_ISLAND_NAME, exact: true })).toBeVisible()
  const saved = await keyboardProjectBackup(page, info.outputPath('island-surface.sceneweave'))
  expect(saved.document.presetSnapshot).toMatchObject({ presetId: 'sceneweave-detailed-island', presetVersion: 1 })
  expect(Object.values(saved.document.terrainAreas).some(area => area.groundElevationMm === 2600)).toBe(true)
  expect(saved.document.terrainConnections['q1-stairs'].widthMm).toBe(1500)
  expect(Object.values(saved.document.terrainAreas).flatMap(area => area.surfaceStyle?.overlays ?? []).filter(patch => patch.id.startsWith('detail-island-'))).toHaveLength(5)
  expect(Object.keys(visualBase(saved.document)!.filters)).toHaveLength(0)
  expect(Object.keys(visualBase(saved.document)!.fogs)).toHaveLength(0)
  const effect = await exportMap(page, 'gm', info.outputPath('island-effect-gm.png'))
  await exportMap(page, 'player', info.outputPath('island-effect-player.png'))
  for (const [name, x, y] of [['stairs-cliff', 1024, 1024], ['grass-rock', 2048, 512]] as const) {
    const image = new PNG({ width: 1024, height: 1024 })
    PNG.bitblt(effect.image, image, x, y, 1024, 1024, 0, 0)
    await writeFile(info.outputPath(`island-${name}-native.png`), PNG.sync.write(image))
  }
  await page.reload(); await page.getByRole('button', { name: '回到首页', exact: true }).click()
  await page.getByTestId('workspace-home').locator(`[data-project-key="native:${saved.document.sceneId}"]`).getByRole('button', { name: '打开', exact: true }).click()
  await keyboardWorkspaceSaved(page)
  expect((await keyboardProjectBackup(page, info.outputPath('island-cold.sceneweave'))).hashes).toEqual(saved.hashes)
  const visual = await openWorkspaceModule(page, '氛围')
  await visual.getByRole('button', { name: /^氛围预设 ·/ }).click()
  const presets = page.getByRole('region', { name: '氛围预设', exact: true })
  await presets.getByLabel('氛围预设', { exact: true }).selectOption('neutral')
  await presets.getByRole('button', { name: '预览氛围预设', exact: true }).click(); await adoptVisual(page)
  const neutral = await keyboardProjectBackup(page, info.outputPath('island-neutral.sceneweave'))
  expect(physical(neutral.document)).toEqual(physical(saved.document))
  expect(keyboardResourceHashes(neutral.hashes)).toEqual(keyboardResourceHashes(saved.hashes))
  const neutralGm = await exportMap(page, 'gm', info.outputPath('island-neutral-gm.png'))
  await exportMap(page, 'player', info.outputPath('island-neutral-player.png'))
  expect(neutralGm.hash).not.toBe(effect.hash)
  await page.getByRole('button', { name: '撤销编辑', exact: true }).click(); await keyboardWorkspaceSaved(page)
  const undone = await keyboardProjectBackup(page, info.outputPath('island-undone.sceneweave'))
  expect(visualBase(undone.document)).toEqual(visualBase(saved.document))
  expect(physical(undone.document)).toEqual(physical(saved.document))
  await page.getByRole('button', { name: '回到首页', exact: true }).click()
  await page.getByTestId('workspace-home').locator(`[data-project-key="native:${original.document.sceneId}"]`).getByRole('button', { name: '打开', exact: true }).click()
  await keyboardWorkspaceSaved(page)
  expect((await keyboardProjectBackup(page, info.outputPath('original-preserved.sceneweave'))).hashes).toEqual(original.hashes)
  expect(errors).toEqual([])
})

test('explicit daylight outpost keeps the original recipe, assets and current project intact', async ({ page, browser }, info) => {
  test.setTimeout(240000)
  await createKeyboardProject(page, '哨站氛围独立样板')
  const before = await keyboardProjectBackup(page, info.outputPath('outpost-current-before.sceneweave'))
  await openWorkspaceModule(page, '素材')
  const panel = page.getByRole('region', { name: '主题素材包', exact: true })
  await panel.locator(':scope > details > summary').click()
  await panel.getByLabel('选择主题包', { exact: true }).selectOption('wilderness')
  await openDetailsBySummary(panel, /^两份可编辑代表场景$/)
  const documents: SceneDocument[] = [], resources: Record<string, string>[] = []
  let daylightFile = ''
  for (const name of ['下载场景 · 林中哨站', '下载场景 · 林中哨站 · 清朗白昼']) {
    const output = info.outputPath(documents.length ? 'outpost-daylight.sceneweave' : 'outpost-original.sceneweave')
    const downloading = page.waitForEvent('download')
    const button = documents.length ? panel.getByRole('button', { name, exact: true }) : panel.getByRole('button', { name: /^下载场景 ·/ }).first()
    await button.click(); await (await downloading).saveAs(output)
    await expect(button).toBeEnabled()
    const files = unzipSync(new Uint8Array(await readFile(output)))
    documents.push(JSON.parse(new TextDecoder().decode(files['scene.json'])))
    resources.push(keyboardResourceHashes(Object.fromEntries(Object.entries(files).map(([key, bytes]) => [key, createHash('sha256').update(bytes).digest('hex')]))))
    daylightFile = output
  }
  expect(documents[0].presetSnapshot.presetId).toBe('sceneweave-outpost-layout')
  expect(documents[1].presetSnapshot.presetId).toBe('sceneweave-outpost-daylight')
  expect(physical(documents[1])).toEqual(physical(documents[0]))
  expect(resources[1]).toEqual(resources[0])
  expect(visualBase(documents[1])!.environment.ambientOpacity).toBe(.018)
  expect((await keyboardProjectBackup(page, info.outputPath('outpost-current-after.sceneweave'))).hashes).toEqual(before.hashes)
  const context = await browser.newContext()
  try {
    const target = await context.newPage(); await target.goto(new URL('./#home', page.url()).href)
    const choosing = target.waitForEvent('filechooser')
    await target.getByTestId('workspace-home').getByRole('button', { name: '打开工程文件', exact: true }).click()
    await (await choosing).setFiles(daylightFile); await keyboardWorkspaceSaved(target)
    await exportMap(target, 'gm', info.outputPath('outpost-daylight-gm.png'))
    await exportMap(target, 'player', info.outputPath('outpost-daylight-player.png'))
  } finally { await context.close() }
})
