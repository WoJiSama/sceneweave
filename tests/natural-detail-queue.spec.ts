import { expect, test, type Page } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { unzipSync } from 'fflate'
const DETAILED_ISLAND_NAME = '岬湾苔岛 · 自然岩阶与崖面'
import { getLegacyGeneration } from '../src/shared/terrain-generation/composition-contracts'
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
  expect(saved.document.presetSnapshot).toMatchObject({ presetId: 'sceneweave-natural-detail-island', presetVersion: 1 })
  expect(Object.values(saved.document.terrainAreas).some(area => area.groundElevationMm === 2600)).toBe(true)
  expect(saved.document.terrainConnections['q1-stairs'].widthMm).toBe(1500)
  expect(saved.document.terrainConnections['q1-stairs'].route?.renderProfile).toBe('naturalRockSteps2')
  expect(visualBase(saved.document)!.edgeLooks['q1-crown-cliff'].renderProfile).toBe('rockRelief2')
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

test('natural outpost densities use six fixed variants and preserve manual edits, complete save and real PNG', async ({ page }, info) => {
  test.setTimeout(420000)
  const { OUTPOST_VEGETATION_V2_GROUP_IDS } = await import('../src/platform/browser/content/outpost-vegetation-v2')
  const { VEGETATION_DETAIL_SPECS } = await import('../src/shared/visual/vegetation-detail-art')
  const { resolveBuildingEntrancePort } = await import('../src/shared/generation/building-port')
  const { checkTerrainRoute } = await import('../src/shared/geometry/terrain-travel')
  const { selectKeyboardProp, openKeyboardPanel } = await import('./keyboard-ux-helpers')
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message))
  await createKeyboardProject(page, '自然哨站密度保全')
  const original = await keyboardProjectBackup(page, info.outputPath('original.sceneweave'))
  await openWorkspaceModule(page, '素材')
  const panel = page.getByRole('region', { name: '主题素材包', exact: true })
  await panel.locator(':scope > details > summary').click()
  await panel.getByLabel('选择主题包', { exact: true }).selectOption('wilderness')
  await openDetailsBySummary(panel, /^两份可编辑代表场景$/)
  const counts: number[] = [], ids: string[] = []
  let resources: Record<string, string> | undefined, balanced = ''
  for (const density of ['sparse', 'balanced', 'dense']) {
    await panel.getByLabel('林中哨站植被密度', { exact: true }).selectOption(density)
    const filename = info.outputPath('outpost-' + density + '.sceneweave'), downloading = page.waitForEvent('download')
    await panel.getByRole('button', { name: '下载场景 · 林中哨站 · 自然编排', exact: true }).click()
    await (await downloading).saveAs(filename)
    await expect(panel.getByLabel('林中哨站植被密度', { exact: true })).toBeEnabled({ timeout: 90000 })
    const files = unzipSync(new Uint8Array(await readFile(filename)))
    const scene = JSON.parse(new TextDecoder().decode(files['scene.json'])) as SceneDocument
    ids.push(scene.sceneId); expect(scene.presetSnapshot.presetId).toBe('sceneweave-natural-detail-outpost')
    expect(Object.keys(scene.scatterGroups)).toHaveLength(4)
    const props = OUTPOST_VEGETATION_V2_GROUP_IDS.flatMap(id => Object.values(scene.scatterGroups[id].members).map(m => scene.props[m.propId!]))
    for (const spec of VEGETATION_DETAIL_SPECS) expect(props.some(prop => prop.definitionRef?.id === spec.definitionId)).toBe(true)
    counts.push(props.length)
    const road = scene.paths['theme-sample-path-2'], port = resolveBuildingEntrancePort(scene, 'watch-entrance', road.widthMm)
    expect(checkTerrainRoute(scene, { floorId: port.floorId, pointsMm: [port.insideMm, ...road.centerlineMm], widthMm: road.widthMm }).issues).toEqual([])
    const current = Object.fromEntries(Object.entries(files).filter(([name]) => /^(assets\/|sources\/|licenses\/|sources\.json$)/.test(name))
      .map(([name, bytes]) => [name, createHash('sha256').update(bytes).digest('hex')]))
    if (resources) expect(current).toEqual(resources); resources = current
    if (density === 'balanced') balanced = filename
  }
  expect(new Set(ids).size).toBe(3); expect(counts[1]).toBeGreaterThan(counts[0]); expect(counts[2]).toBeGreaterThan(counts[1])
  expect((await keyboardProjectBackup(page, info.outputPath('original-after-downloads.sceneweave'))).hashes).toEqual(original.hashes)
  await page.goto('./#home')
  const choosing = page.waitForEvent('filechooser')
  await page.getByTestId('workspace-home').getByRole('button', { name: '打开工程文件', exact: true }).click()
  await (await choosing).setFiles(balanced); await keyboardWorkspaceSaved(page)
  const opened = await keyboardProjectBackup(page, info.outputPath('outpost-opened.sceneweave'))
  await page.goto('./#home'); await page.reload()
  await page.getByTestId('workspace-home').locator('[data-project-key="native:' + opened.document.sceneId + '"]').getByRole('button', { name: '打开', exact: true }).click()
  await keyboardWorkspaceSaved(page)
  expect((await keyboardProjectBackup(page, info.outputPath('outpost-cold.sceneweave'))).hashes).toEqual(opened.hashes)
  const group = opened.document.scatterGroups[OUTPOST_VEGETATION_V2_GROUP_IDS[0]], member = Object.values(group.members).find(m => m.propId)!, prop = opened.document.props[member.propId!]
  await selectKeyboardProp(page, prop.id)
  const inspector = await openKeyboardPanel(page, 'inspector')
  await inspector.getByLabel('物件 X', { exact: true }).fill(String((prop.positionMm.x + 1) / 1000)); await inspector.getByLabel('物件 X', { exact: true }).press('Enter')
  const review = page.getByRole('region', { name: '候选审阅', exact: true })
  await expect(review).toBeVisible(); await review.getByLabel('确认完整影响范围', { exact: true }).check()
  await review.getByRole('button', { name: '采用室外修改', exact: true }).click(); await expect(review).toHaveCount(0); await keyboardWorkspaceSaved(page)
  const edited = await keyboardProjectBackup(page, info.outputPath('outpost-edited.sceneweave'))
  expect(edited.document.props[prop.id].positionMm.x).toBe(prop.positionMm.x + 1)
  expect(Object.values(edited.document.scatterGroups[group.id].members).find(m => m.propId === prop.id)?.state).toBe('manual')
  await page.getByRole('button', { name: '撤销编辑', exact: true }).click(); await keyboardWorkspaceSaved(page)
  const undone = await keyboardProjectBackup(page, info.outputPath('outpost-undone.sceneweave'))
  expect(undone.document.props).toEqual(opened.document.props); expect(undone.document.scatterGroups).toEqual(opened.document.scatterGroups)
  expect(keyboardResourceHashes(undone.hashes)).toEqual(keyboardResourceHashes(opened.hashes))
  await exportMap(page, 'gm', info.outputPath('outpost-gm.png')); await exportMap(page, 'player', info.outputPath('outpost-player.png'))
  expect((await keyboardProjectBackup(page, info.outputPath('outpost-output-readonly.sceneweave'))).hashes).toEqual(undone.hashes)
  await writeFile(info.outputPath('facts.json'), JSON.stringify({ counts, resources, errors }, null, 2)); expect(errors).toEqual([])
})

test('six fixed vegetation variants use ordinary catalog review, real raster bytes, undo and cold adoption', async ({ page }, info) => {
  test.setTimeout(240000)
  const { VEGETATION_DETAIL_SPECS } = await import('../src/shared/visual/vegetation-detail-art')
  const { acknowledgeAssetQuality } = await import('./asset-quality-helpers')
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message))
  await createKeyboardProject(page, '六件植被目录整合')
  const before = await keyboardProjectBackup(page, info.outputPath('before.sceneweave'))
  await openWorkspaceModule(page, '素材')
  const panel = page.getByRole('region', { name: '主题素材包', exact: true })
  await panel.locator(':scope > details > summary').click()
  await openDetailsBySummary(panel, /^植被细节 · 六件独立变体$/)
  await panel.getByRole('button', { name: '预览添加六件植被细节变体', exact: true }).click()
  await expect(page.getByRole('button', { name: '采用组件修改', exact: true })).toBeVisible({ timeout: 90000 })
  await acknowledgeAssetQuality(page)
  await page.getByRole('button', { name: '采用组件修改', exact: true }).click(); await keyboardWorkspaceSaved(page)
  const added = await keyboardProjectBackup(page, info.outputPath('added.sceneweave'))
  const files = unzipSync(new Uint8Array(await readFile(info.outputPath('added.sceneweave'))))
  for (const spec of VEGETATION_DETAIL_SPECS) {
    const asset = added.document.assets[spec.assetId], definition = added.document.propDefinitions[spec.definitionId]
    expect(definition.defaultVisualBoundsMm).toEqual(spec.visualBoundsMm); expect(definition.defaultFootprintMm).toEqual(spec.footprintMm)
    const entry = Object.entries(files).find(([name]) => name.startsWith('assets/') && name.includes(asset.sha256))
    expect(entry).toBeTruthy()
    const image = PNG.sync.read(Buffer.from(entry![1])); expect(image.width).toBe(512); expect(image.height).toBe(512)
    let opaque = 0, clear = 0
    for (let i = 3; i < image.data.length; i += 4) { if (image.data[i]) opaque++; else clear++ }
    expect(opaque).toBeGreaterThan(5000); expect(clear).toBeGreaterThan(5000)
    await writeFile(info.outputPath(spec.key + '.png'), entry![1])
  }
  await page.getByRole('button', { name: '撤销编辑', exact: true }).click(); await keyboardWorkspaceSaved(page)
  const undone = await keyboardProjectBackup(page, info.outputPath('undone.sceneweave'))
  expect(undone.document.propDefinitions).toEqual(before.document.propDefinitions); expect(undone.document.props).toEqual(before.document.props)
  await page.getByRole('button', { name: '重做编辑', exact: true }).click(); await keyboardWorkspaceSaved(page)
  const redone = await keyboardProjectBackup(page, info.outputPath('redone.sceneweave'))
  await page.goto('./#home'); await page.reload()
  await page.getByTestId('workspace-home').locator('[data-project-key="native:' + redone.document.sceneId + '"]').getByRole('button', { name: '打开', exact: true }).click()
  await keyboardWorkspaceSaved(page)
  expect((await keyboardProjectBackup(page, info.outputPath('cold.sceneweave'))).hashes).toEqual(redone.hashes)
  expect(keyboardResourceHashes(redone.hashes)).toEqual(keyboardResourceHashes(added.hashes)); expect(errors).toEqual([])
})

test('production mixed v3 persists a full-width normal door approach through the Worker and cold read', async ({ page }, info) => {
  test.setTimeout(300000)
  const { openGenerationTask } = await import('./workspace-navigation-helpers')
  const { resolveBuildingEntrancePort } = await import('../src/shared/generation/building-port')
  const { checkTerrainRoute } = await import('../src/shared/geometry/terrain-travel')
  const workers: string[] = [], errors: string[] = []
  page.on('worker', w => workers.push(w.url())); page.on('pageerror', e => errors.push(e.message))
  await createKeyboardProject(page, '生成器接门原工程')
  const original = await keyboardProjectBackup(page, info.outputPath('original.sceneweave'))
  await openGenerationTask(page, '混合场景')
  const panel = page.getByRole('region', { name: '混合场景生成', exact: true })
  await expect(panel.getByLabel('混合接路算法版本', { exact: true })).toHaveValue('3')
  await panel.getByLabel('混合工程名称', { exact: true }).fill('第3版门前直入')
  await panel.getByLabel('混合建筑房间数量', { exact: true }).fill('2')
  await panel.getByRole('button', { name: '预览混合场景', exact: true }).click()
  const candidate = page.getByTestId('workspace-inspector').getByLabel('混合候选摘要', { exact: true })
  await expect(candidate).toBeVisible({ timeout: 90000 })
  await expect(page.locator('.workspace-unified')).toHaveAttribute('data-revision', String(original.document.revision))
  await candidate.getByRole('button', { name: '保存混合场景为新工程', exact: true }).click()
  await expect(page.getByRole('heading', { name: '第3版门前直入', level: 1, exact: true })).toBeVisible({ timeout: 90000 })
  await expect(page.locator('.asset-busy')).toHaveCount(0, { timeout: 90000 })
  await keyboardWorkspaceSaved(page)
  const generated = await keyboardProjectBackup(page, info.outputPath('mixed-v3.sceneweave'))
  // Validate the saved strict recipe itself, rather than a UI report.
  const mixedRecipe = Object.values(getLegacyGeneration(generated.document)!.recipes).find(recipe => recipe.algorithmId === 'mixed-layout')!
  expect(mixedRecipe).toMatchObject({ algorithmId: 'mixed-layout', algorithmVersion: 3, recipeVersion: 3 })
  const matches = Object.values(generated.document.paths).flatMap(path => Object.values(generated.document.openings).flatMap(opening => {
    try {
      const port = resolveBuildingEntrancePort(generated.document, opening.id, path.widthMm), end = path.centerlineMm.at(-1)!
      return end.x === port.outsideMm.x && end.y === port.outsideMm.y ? [{ path, port }] : []
    } catch { return [] }
  }))
  expect(matches).toHaveLength(1)
  const { path, port } = matches[0], end = path.centerlineMm.at(-1)!, lead = path.centerlineMm.at(-2)!
  const dx = end.x - lead.x, dy = end.y - lead.y, normal = { x: port.outsideMm.x - port.positionMm.x, y: port.outsideMm.y - port.positionMm.y }
  expect(dx * normal.y - dy * normal.x).toBe(0); expect(dx * normal.x + dy * normal.y).toBeLessThan(0)
  expect(checkTerrainRoute(generated.document, { floorId: port.floorId, pointsMm: [...path.centerlineMm, port.insideMm], widthMm: path.widthMm }).issues).toEqual([])
  await page.goto('./#home'); await page.reload()
  await page.getByTestId('workspace-home').locator('[data-project-key="native:' + generated.document.sceneId + '"]').getByRole('button', { name: '打开', exact: true }).click()
  await keyboardWorkspaceSaved(page)
  expect((await keyboardProjectBackup(page, info.outputPath('mixed-cold.sceneweave'))).hashes).toEqual(generated.hashes)
  await exportMap(page, 'player', info.outputPath('mixed-player.png'))
  await page.goto('./#home')
  await page.getByTestId('workspace-home').locator('[data-project-key="native:' + original.document.sceneId + '"]').getByRole('button', { name: '打开', exact: true }).click()
  await keyboardWorkspaceSaved(page)
  expect((await keyboardProjectBackup(page, info.outputPath('original-preserved.sceneweave'))).hashes).toEqual(original.hashes)
  expect(workers.some(url => /\/worker-[^/]+\.js/.test(url))).toBe(true); expect(errors).toEqual([])
  await writeFile(info.outputPath('facts.json'), JSON.stringify({ algorithmVersion: 3, route: path.centerlineMm, port, workers, errors }, null, 2))
})
