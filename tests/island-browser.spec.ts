import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'

async function saved(page: Page) { await expect(page.locator('.asset-save')).toHaveText('本地已保存') }
async function scene(page: Page) { return page.evaluate(() => structuredClone(Reflect.get(window, '__sceneweaveAssetsDev').workspace.getState().project.document)) }
async function number(page: Page, label: string, value: number) {
  const input = page.getByRole('spinbutton', { name: label, exact: true })
  await input.fill(String(value)); await input.press('Tab')
}
async function tab(page: Page, name: string) { await page.getByRole('group', { name: '场景对象分类' }).getByRole('button', { name, exact: true }).click() }
async function select(page: Page, id: string) { await page.locator(`[data-entity-id="${id}"]`).click() }
async function adopt(page: Page) { await page.getByRole('button', { name: '采用结构修改', exact: true }).click() }
async function undo(page: Page) { await page.getByRole('button', { name: '撤销素材编辑', exact: true }).click() }
async function openIsland(page: Page) {
  await page.goto('/#assets')
  await page.locator('.asset-island-card').click()
  await page.getByRole('button', { name: '保存并打开副本', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: '双层岩岛 · 墨绘原野', exact: true })).toBeVisible()
  await saved(page); await expect(page.getByLabel('材质场景主持人预览')).toBeVisible()
}

test('VIS-02 coast, height, grass-rock overlay candidates are atomic and all saved paint parameters reopen exactly', async ({ page }, testInfo) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await openIsland(page)
  const original = await scene(page)
  expect(Object.keys(original.props)).toHaveLength(39)
  await tab(page, '结构'); await select(page, 'island-low-v0')
  await number(page, '轮廓点 X', 3800)
  expect(await scene(page)).toEqual(original)
  await page.getByRole('button', { name: '取消结构预览', exact: true }).click()
  await expect(page.getByRole('spinbutton', { name: '轮廓点 X', exact: true })).toHaveValue('4000')
  expect(await scene(page)).toEqual(original)
  await number(page, '轮廓点 X', 3800); await adopt(page)
  let edited = await scene(page)
  expect(edited.revision).toBe(original.revision + 1)
  expect(edited.terrainAreas['island-low'].boundaryMm[0].positionMm.x).toBe(3800)
  expect(edited.terrainAreas['island-water'].surfaceStyle.overlays[0].boundaryMm).not.toEqual(original.terrainAreas['island-water'].surfaceStyle.overlays[0].boundaryMm)
  await undo(page)
  expect((await scene(page)).terrainAreas).toEqual(original.terrainAreas)
  const beforeInvalid = await scene(page)
  await number(page, '轮廓点 X', 100000)
  await expect(page.getByRole('alert')).toContainText('候选未通过')
  expect(await scene(page)).toEqual(beforeInvalid)
  await select(page, 'island-high'); await number(page, '地面高程', 4000)
  expect((await scene(page)).terrainAreas['island-high'].groundElevationMm).toBe(3000)
  await adopt(page)
  expect((await scene(page)).terrainAreas['island-high'].groundElevationMm).toBe(4000)
  await undo(page)
  await page.getByText('灰绿裸岩覆盖边界', { exact: true }).click()
  await number(page, '覆盖点 1 X', 17900)
  expect((await scene(page)).terrainAreas['island-high'].surfaceStyle.overlays[0].boundaryMm[0].x).toBe(18000)
  await adopt(page)
  expect((await scene(page)).terrainAreas['island-high'].surfaceStyle.overlays[0].boundaryMm[0].x).toBe(17900)
  await undo(page)
  const grass = Object.values(original.materials).find((material: any) => material.catalogId === 'material.sw.grass') as any
  await select(page, 'island-low'); await page.getByLabel('地面材质', { exact: true }).selectOption(grass.id)
  await page.getByText('铺装尺寸与锚点', { exact: true }).click()
  await number(page, '铺装宽度', 3000); await number(page, '铺装长度', 3000)
  await saved(page); edited = await scene(page)
  expect(edited.terrainAreas['island-low'].surfaceStyle.base.tileSizeMm).toEqual({ width: 3000, height: 3000 })
  expect(edited.props).toEqual(original.props); expect(edited.terrainConnections).toEqual(original.terrainConnections)
  await page.reload(); await saved(page)
  expect(await scene(page)).toEqual(edited)
  expect(errors).toEqual([])
  await testInfo.attach('b3-terrain-editing.json', { body: JSON.stringify({ coastCancelUnchanged: true, coastAndShallowAtomic: true, height4000ThenUndo: true, overlayThenUndo: true, persistedBasePaint: edited.terrainAreas['island-low'].surfaceStyle.base, reloadExact: true, sourceProps: 39 }, null, 2), contentType: 'application/json' })
})

test('VIS-02 scatter preview preserves manual tree, locked member and permanent shrub deletion through regeneration and history', async ({ page }, testInfo) => {
  await openIsland(page)
  const initial = await scene(page), treeEntry = Object.entries(initial.scatterGroups['island-trees'].members).find(([, value]: any) => value.propId) as [string, any]
  const shrubEntry = Object.entries(initial.scatterGroups['island-shrubs'].members).find(([, value]: any) => value.propId) as [string, any]
  await select(page, treeEntry[1].propId)
  await number(page, '物件 X', initial.props[treeEntry[1].propId].positionMm.x + 100)
  let current = await scene(page)
  expect(current.scatterGroups['island-trees'].members[treeEntry[0]].state).toBe('manual')
  await page.getByRole('button', { name: '固定此物件', exact: true }).click()
  const fixed = (await scene(page)).props[treeEntry[1].propId]
  expect(fixed.editLocked).toBe(true)
  await select(page, shrubEntry[1].propId)
  await page.getByRole('button', { name: '删除并保留排除区', exact: true }).click()
  const deleted = await scene(page), shrubRecord = deleted.scatterGroups['island-shrubs'].members[shrubEntry[0]]
  expect(shrubRecord).toMatchObject({ propId: null, state: 'deleted' })
  expect(deleted.scatterGroups['island-shrubs'].exclusions.some((item: any) => item.reason === 'delete' && item.sourceCandidateKey === shrubEntry[0])).toBe(true)
  await tab(page, '组合'); await select(page, 'island-trees')
  await number(page, '散布密度', 100)
  expect(await scene(page)).toEqual(deleted)
  await page.getByRole('button', { name: '取消结构预览', exact: true }).click()
  expect(await scene(page)).toEqual(deleted)
  await number(page, '散布密度', 100); await adopt(page)
  current = await scene(page)
  expect(current.revision).toBe(deleted.revision + 1)
  expect(current.props[fixed.id]).toEqual(fixed)
  const beforeShrub = current
  await select(page, 'island-shrubs'); await number(page, '散布密度', 100); await adopt(page)
  current = await scene(page)
  expect(current.scatterGroups['island-shrubs'].members[shrubEntry[0]]).toEqual(shrubRecord)
  expect(current.scatterGroups['island-shrubs'].exclusions).toEqual(deleted.scatterGroups['island-shrubs'].exclusions)
  await undo(page)
  expect((await scene(page)).props).toEqual(beforeShrub.props)
  await page.getByRole('button', { name: '重做素材编辑', exact: true }).click(); await saved(page)
  const final = await scene(page)
  await page.reload(); await saved(page)
  expect(await scene(page)).toEqual(final)
  await testInfo.attach('b3-scatter-editing.json', { body: JSON.stringify({ treeCandidate: treeEntry[0], preservedManualLockedTree: fixed, shrubDeletedCandidate: shrubEntry[0], exclusion: deleted.scatterGroups['island-shrubs'].exclusions.find((item: any) => item.reason === 'delete'), cancelUnchanged: true, atomicRegeneration: true, deletionNeverRevived: true, historyAndReloadExact: true, finalRevision: final.revision }, null, 2), contentType: 'application/json' })
})

test('VIS-02 finite UI passage checks explain cliffs and required connection edits cannot consume history or saving', async ({ page }, testInfo) => {
  await openIsland(page)
  await page.getByRole('button', { name: '检查台阶通路', exact: true }).click()
  await expect(page.locator('.asset-travel-panel [role=status]')).toContainText('可通行')
  await page.getByRole('button', { name: '检查崖边直行', exact: true }).click()
  await expect(page.locator('.asset-travel-panel [role=status]')).toContainText('高差')
  const firstId = (await scene(page)).sceneId
  await page.locator('.asset-island-card').click()
  await page.getByRole('button', { name: '保存并打开副本', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0); await saved(page)
  const before = await scene(page)
  expect(before.sceneId).not.toBe(firstId); expect(before.revision).toBe(0)
  await expect(page.locator('.asset-travel-panel [role=status]')).toHaveCount(0)
  await tab(page, '结构'); await select(page, 'island-stairs')
  await page.getByRole('button', { name: '预览移除连接', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('候选未通过')
  expect(await scene(page)).toEqual(before)
  await expect(page.getByRole('button', { name: '采用结构修改', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '撤销素材编辑', exact: true })).toBeDisabled()
  const persisted = await page.evaluate(async () => {
    const { workspace, repository } = Reflect.get(window, '__sceneweaveAssetsDev')
    await workspace.flush(); return (await repository.load(workspace.getState().project.document.sceneId)).document
  })
  expect(persisted).toEqual(before)
  await testInfo.attach('b3-required-passage.json', { body: JSON.stringify({ finiteStairsWidthMm: 2000, stairPassable: true, elsewhereCliffBlocked: true, requiredConnectionRemovalRejected: true, revisionHistorySaveUnchanged: true, sameRevisionOtherSceneClearsStaleResult: true }, null, 2), contentType: 'application/json' })
})

test('VIS-02 complete package and GM/player 4K export reopen in fresh offline storage and remain editable', async ({ page, browser }, testInfo) => {
  test.setTimeout(120_000)
  await openIsland(page)
  const original = await scene(page)
  await page.screenshot({ path: testInfo.outputPath('vis02-workbench.png'), fullPage: true })
  await testInfo.attach('vis02-workbench.png', { path: testInfo.outputPath('vis02-workbench.png'), contentType: 'image/png' })
  const packageEvent = page.waitForEvent('download')
  await page.getByRole('button', { name: '完整工程', exact: true }).click()
  const packageBytes = await readFile((await (await packageEvent).path())!)
  await testInfo.attach('vis02-complete.sceneweave', { body: packageBytes, contentType: 'application/zip' })
  const images: Record<string, number> = {}
  for (const audience of ['gm', 'player'] as const) {
    if (audience === 'player') await page.getByRole('group', { name: '预览受众' }).getByRole('button', { name: '玩家', exact: true }).click()
    await expect(page.getByLabel(audience === 'gm' ? '材质场景主持人预览' : '材质场景玩家预览')).toBeVisible()
    const event = page.waitForEvent('download')
    await page.getByRole('button', { name: '4K PNG', exact: true }).click()
    const bytes = await readFile((await (await event).path())!)
    expect(bytes.readUInt32BE(16)).toBe(4096); expect(bytes.readUInt32BE(20)).toBe(3686)
    images[audience] = bytes.length
    await testInfo.attach(`vis02-${audience}-4k.png`, { body: bytes, contentType: 'image/png' })
  }
  const freshContext = await browser.newContext({ viewport: { width: 1512, height: 982 } })
  try {
    const fresh = await freshContext.newPage(); await fresh.goto('/#assets')
    await expect(fresh.getByTestId('asset-workbench')).toBeVisible(); await freshContext.setOffline(true)
    await fresh.getByLabel('选择完整素材工程').setInputFiles({ name: 'portable-island.sceneweave', mimeType: 'application/zip', buffer: packageBytes })
    await fresh.getByRole('button', { name: '保存并打开副本' }).click()
    await expect(fresh.getByRole('dialog')).toHaveCount(0); await saved(fresh)
    await expect(fresh.getByLabel('材质场景主持人预览')).toBeVisible()
    const imported = await scene(fresh)
    expect(imported.sceneId).not.toBe(original.sceneId)
    for (const key of ['terrainAreas', 'terrainEdges', 'terrainConnections', 'scatterGroups', 'props', 'materials', 'propDefinitions', 'assets', 'styleThemes', 'presetSnapshot']) expect(imported[key]).toEqual(original[key])
    await tab(fresh, '结构'); await select(fresh, 'island-high'); await number(fresh, '地面高程', 4000); await adopt(fresh); await saved(fresh)
    expect((await scene(fresh)).terrainAreas['island-high'].groundElevationMm).toBe(4000)
    await testInfo.attach('b3-complete-portability.json', { body: JSON.stringify({ packageBytes: packageBytes.length, pngBytes: images, dimensions: [4096, 3686], originalProps: Object.keys(original.props).length, freshStorage: true, importedWithoutAssetNetwork: true, persistedCollectionsExact: true, continuedEdit: true, sourceUnchanged: true, browser: await browser.version() }, null, 2), contentType: 'application/json' })
  } finally { await freshContext.close() }
  expect(await scene(page)).toEqual(original)
})
