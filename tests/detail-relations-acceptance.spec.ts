import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { unzipSync, zipSync } from 'fflate'
import { applyCompositionCommands } from '../src/shared/appearance/commands'
import { resolveBuildingStructurePort } from '../src/shared/generation/building-port'
import { canonicalJson } from '../src/shared/validation/json'
import type { ProjectManifest } from '../src/shared/project/file'
import { keyboardProjectBackup, keyboardResourceHashes, keyboardWorkspaceSaved, openKeyboardPanel } from './keyboard-ux-helpers'
import { openWorkspaceModule } from './workspace-navigation-helpers'
import { mapExportButton, openDetailsBySummary, reloadSaved } from './workspace-ux-helpers'

const { PNG } = createRequire(import.meta.url)('../node_modules/playwright-core/lib/utilsBundle.js')
const ids = { area: '坡地/验收 甲', room: '西门屋 Δ', door: '验收外门:西', road: '人工道路/终点', link: '原已保存关系 Δ' }
const rect = (x: number, y: number, w: number, h: number) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }]
const review = (page: Page) => page.getByRole('region', { name: '候选审阅', exact: true })
test.use({ actionTimeout: 15_000 })
async function number(scope: Locator, label: string, value: string) { const input = scope.getByLabel(label, { exact: true }); await input.fill(value); await input.press('Tab') }
async function adopt(page: Page, kind: '结构修改' | '室外修改' = '结构修改') {
  await expect(review(page).getByLabel('确认完整影响范围', { exact: true })).toBeVisible()
  await review(page).getByLabel('确认完整影响范围', { exact: true }).check()
  await review(page).getByRole('button', { name: `采用${kind}`, exact: true }).click()
  await expect(review(page)).toHaveCount(0); await keyboardWorkspaceSaved(page)
}
async function inspect(page: Page, id: string) {
  const scene = await openWorkspaceModule(page, '场景'), all = scene.getByRole('button', { name: '显示所有图层的对象', exact: true })
  if (await all.isVisible()) await all.click()
  await scene.getByRole('group', { name: '场景对象分类', exact: true }).getByRole('button', { name: '结构', exact: true }).click()
  await scene.getByLabel('搜索场景对象', { exact: true }).fill(id)
  await scene.locator(`[data-entity-id="${id}"]`).click()
  return (await openKeyboardPanel(page, 'inspector')).getByLabel('建筑属性', { exact: true })
}

async function prepareWestEndFixture(page: Page, info: TestInfo) {
  await page.goto('./#home'); await page.getByTestId('workspace-home').getByRole('button', { name: '新建场景', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '新建空白场景', exact: true })
  await dialog.getByLabel('场景名称', { exact: true }).fill('正式验收 · 门路失败保全组合')
  await dialog.getByLabel('画布宽度', { exact: true }).fill('32'); await dialog.getByLabel('画布高度', { exact: true }).fill('24')
  await dialog.getByRole('button', { name: '创建空白场景', exact: true }).click(); await expect(dialog).toHaveCount(0); await keyboardWorkspaceSaved(page)
  const source = info.outputPath('ordinary-source.sceneweave'), plain = await keyboardProjectBackup(page, source), files = unzipSync(new Uint8Array(await readFile(source)))
  const floorId = Object.keys(plain.document.floors)[0], layerId = Object.values(plain.document.userLayers).find(layer => layer.floorId === floorId)!.id
  const material = Object.values(plain.document.materials).find(value => value.applicableSurfaces.includes('terrain'))!, roadMaterial = Object.values(plain.document.materials).find(value => value.id !== material.id && value.applicableSurfaces.includes('path'))!
  const roomMaterial = Object.values(plain.document.materials).find(value => value.applicableSurfaces.includes('room'))!, runtime = { ids: { nextId: () => randomUUID() }, clock: { now: () => plain.document.updatedAt } }
  let content = applyCompositionCommands({ document: plain.document, historyIdentity: plain.identity, appearance: plain.appearance }, [
    { type: 'createTerrainArea', id: ids.area, floorId, layerId, boundaryMm: rect(6000, 4000, 22000, 18000), groundElevationMm: 0, coveragePriority: 0, materialRef: { id: material.id, version: material.version } },
    { type: 'createRoom', id: ids.room, floorId, layerId, boundaryMm: rect(14000, 9000, 6000, 5000), thicknessMm: 400, supportRef: { kind: 'terrainArea', id: ids.area }, materialRef: { id: roomMaterial.id, version: roomMaterial.version } },
  ], runtime)
  const wall = Object.values(content.document.walls).find(w => content.document.vertices[w.startVertexId].xMm === 14000 && content.document.vertices[w.endVertexId].xMm === 14000)!
  content = applyCompositionCommands(content, [{ type: 'addOpening', id: ids.door, wallId: wall.id, offsetReferenceVertexId: wall.startVertexId, offsetMm: 1600, widthMm: 2000, kind: 'door', state: 'closed', locked: true }], runtime)
  const port = resolveBuildingStructurePort(content.document, ids.door, 1000)
  content = applyCompositionCommands(content, [{ type: 'createPath', id: ids.road, floorId, layerId, centerlineMm: [{ x: 8000, y: 17000 }, { x: 10000, y: 17000 }, { x: 10000, y: port.outsideMm.y }, port.outsideMm],
    widthMm: 1000, supportRefs: [port.supportRef], materialRef: { id: roadMaterial.id, version: roadMaterial.version }, movementCostMultiplier: 1.4, renderOrder: 7 }], runtime)
  content = applyCompositionCommands(content, [{ type: 'bindPathAttachment', id: ids.link, pathId: ids.road, openingId: ids.door, end: 'end', leadLengthMm: 1000, maxDisplacementMm: 1000 }], runtime)
  const manifest = JSON.parse(new TextDecoder().decode(files['manifest.json'])) as ProjectManifest
  for (const [name, value] of [['scene.json', content.document], ['identity.json', content.historyIdentity], ['appearance.json', content.appearance]] as const) {
    files[name] = new TextEncoder().encode(canonicalJson(value)); const entry = manifest.entries.find(entry => entry.path === name)!
    entry.sha256 = createHash('sha256').update(files[name]).digest('hex'); entry.sizeBytes = files[name].length
  }
  files['manifest.json'] = new TextEncoder().encode(canonicalJson(manifest))
  const fixture = info.outputPath('west-end-bound-fixture.sceneweave'); await writeFile(fixture, zipSync(files))
  return { fixture, plain, wall }
}

test('acceptance: imported west-door end attachment rejects a locked wall edit, cancels safely and follows a real thickness transaction through cold PNG output', async ({ page, browser }, info) => {
  test.setTimeout(240_000)
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  const { fixture, plain, wall } = await prepareWestEndFixture(page, info)
  const context = await browser.newContext({ viewport: { width: 1512, height: 982 } })
  try {
    const target = await context.newPage(); target.on('pageerror', error => errors.push(error.message))
    await target.goto(new URL('./#home', page.url()).href)
    const chooser = target.waitForEvent('filechooser'); await target.getByTestId('workspace-home').getByRole('button', { name: '打开工程文件', exact: true }).click()
    await (await chooser).setFiles(fixture); await keyboardWorkspaceSaved(target)
    const imported = await keyboardProjectBackup(target, info.outputPath('imported-bound.sceneweave'))
    expect(imported.document.pathAttachments![ids.link].end).toBe('end')
    expect(imported.document.openings[ids.door]).toMatchObject({ state: 'closed', locked: true })
    expect(keyboardResourceHashes(imported.hashes)).toEqual(keyboardResourceHashes(plain.hashes))
    await inspect(target, ids.door)
    const tools = target.getByRole('region', { name: '门口持续道路关系', exact: true })
    await expect(tools).toContainText('门当前关闭且已上锁')
    await tools.getByRole('button', { name: '锁定附着关系', exact: true }).click(); await adopt(target)
    const locked = await keyboardProjectBackup(target, info.outputPath('relation-locked.sceneweave'))
    let wallInspector = await inspect(target, wall.id)
    await number(wallInspector, '编辑墙厚', '80'); await wallInspector.getByRole('button', { name: '预览墙厚修改', exact: true }).click()
    await expect(target.locator('.asset-notice[role="alert"]')).toContainText('锁定')
    await expect(review(target)).toHaveCount(0)
    await target.screenshot({ path: info.outputPath('locked-wall-refusal.png'), animations: 'disabled' })
    expect((await keyboardProjectBackup(target, info.outputPath('after-locked-refusal.sceneweave'))).hashes).toEqual(locked.hashes)
    await target.getByRole('button', { name: '取消建筑属性草稿', exact: true }).click()
    await inspect(target, ids.door); await tools.getByRole('button', { name: '解锁附着关系', exact: true }).click(); await adopt(target)
    const unlocked = await keyboardProjectBackup(target, info.outputPath('relation-unlocked.sceneweave'))
    wallInspector = await inspect(target, wall.id); await number(wallInspector, '编辑墙厚', '80')
    await wallInspector.getByRole('button', { name: '预览墙厚修改', exact: true }).click()
    await expect(review(target)).toContainText('调整墙厚')
    await target.screenshot({ path: info.outputPath('wall-thickness-candidate.png'), animations: 'disabled' })
    await review(target).getByRole('button', { name: '取消结构预览', exact: true }).click(); await keyboardWorkspaceSaved(target)
    expect((await keyboardProjectBackup(target, info.outputPath('after-cancel.sceneweave'))).hashes).toEqual(unlocked.hashes)
    wallInspector = await inspect(target, wall.id); await number(wallInspector, '编辑墙厚', '80')
    await wallInspector.getByRole('button', { name: '预览墙厚修改', exact: true }).click(); await adopt(target)
    const moved = await keyboardProjectBackup(target, info.outputPath('wall-thickness-adopted.sceneweave'))
    expect(moved.document.walls[wall.id].thicknessMm).toBe(800)
    expect(moved.document.paths[ids.road].centerlineMm.slice(0, -2)).toEqual(unlocked.document.paths[ids.road].centerlineMm.slice(0, -2))
    expect(moved.document.pathAttachments![ids.link].anchor.port).toEqual(resolveBuildingStructurePort(moved.document, ids.door, 1000))
    expect(moved.document.openings[ids.door]).toEqual(unlocked.document.openings[ids.door])
    expect(moved.document.paths[ids.road].surfaceStyle).toEqual(unlocked.document.paths[ids.road].surfaceStyle)
    await target.getByRole('button', { name: '撤销编辑', exact: true }).click(); await keyboardWorkspaceSaved(target)
    const undone = await keyboardProjectBackup(target, info.outputPath('wall-thickness-undone.sceneweave'))
    expect(undone.document.paths[ids.road]).toEqual(unlocked.document.paths[ids.road]); expect(undone.document.walls).toEqual(unlocked.document.walls)
    await target.getByRole('button', { name: '重做编辑', exact: true }).click(); await keyboardWorkspaceSaved(target)
    const redone = await keyboardProjectBackup(target, info.outputPath('wall-thickness-redone.sceneweave'))
    await reloadSaved(target); await keyboardWorkspaceSaved(target)
    const cold = await keyboardProjectBackup(target, info.outputPath('cold.sceneweave')); expect(cold.hashes).toEqual(redone.hashes)
    const outputFacts = []
    for (const audience of ['gm', 'player'] as const) {
      const pending = target.waitForEvent('download'); await (await mapExportButton(target, audience)).click()
      const filename = info.outputPath(`cold-${audience}.png`); await (await pending).saveAs(filename); await keyboardWorkspaceSaved(target); await target.locator('.workspace-export-menu > summary').click()
      const image = PNG.sync.read(await readFile(filename)) as { width: number; height: number; data: Uint8Array }
      expect([image.width, image.height]).toEqual([4096, 3072])
      const pixel = (x: number, y: number) => { const index = (Math.floor(y / 24000 * image.height) * image.width + Math.floor(x / 32000 * image.width)) * 4; return Array.from(image.data.slice(index, index + 4)) }
      expect(pixel(10000, 15000)[3]).toBe(255); expect(pixel(10000, 15000)).not.toEqual(pixel(11000, 15000))
      expect(pixel(17000, 11000)).not.toEqual(pixel(11000, 15000))
      outputFacts.push({ audience, width: image.width, height: image.height, rgbaSha256: createHash('sha256').update(image.data).digest('hex'), roadPixel: pixel(10000, 15000), groundPixel: pixel(11000, 15000), roomPixel: pixel(17000, 11000) })
    }
    await target.screenshot({ path: info.outputPath('cold-ui.png'), animations: 'disabled' })
    await writeFile(info.outputPath('facts.json'), canonicalJson({ browser: browser.version(), ids, widthMm: 32000, heightMm: 24000, end: 'end', closed: true, doorLocked: true, thicknessBeforeMm: 400, thicknessAfterMm: 800, outputFacts, errors }))
    expect(errors).toEqual([])
  } finally { await context.close() }
})

test('acceptance: ordinary deletion of a bound road respects relation locks, reviews both removals and preserves tombstones through undo redo cold output', async ({ page, browser }, info) => {
  test.setTimeout(240_000)
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  // The formal repair rerun supplies the exact earlier frozen ZIP. A regular
  // repository run recreates that same declared geometry via normal UI/export.
  // A supplied file is mandatory input: read/import failure never falls back.
  const frozenInput = process.env.SCENEWEAVE_RELATIONS_FIXTURE
  const fixture = frozenInput ? info.outputPath('west-end-frozen-input.sceneweave') : (await prepareWestEndFixture(page, info)).fixture
  if (frozenInput) await writeFile(fixture, await readFile(frozenInput))
  const inputSha256 = createHash('sha256').update(await readFile(fixture)).digest('hex')
  const context = await browser.newContext({ viewport: { width: 1512, height: 982 } })
  try {
    const target = await context.newPage(); target.on('pageerror', error => errors.push(error.message))
    const home = frozenInput ? new URL('./#home', process.env.SCENEWEAVE_TEST_BASE_URL ?? 'http://127.0.0.1:5173/sceneweave/').href : new URL('./#home', page.url()).href
    await target.goto(home)
    const chooser = target.waitForEvent('filechooser'); await target.getByTestId('workspace-home').getByRole('button', { name: '打开工程文件', exact: true }).click()
    await (await chooser).setFiles(fixture); await keyboardWorkspaceSaved(target)
    const imported = await keyboardProjectBackup(target, info.outputPath('delete-imported.sceneweave'))
    expect(imported.document.pathAttachments![ids.link].end).toBe('end')
    expect(imported.document.openings[ids.door]).toMatchObject({ state: 'closed', locked: true })
    const wallId = imported.document.openings[ids.door].wallId
    const playerImage = async (name: string) => {
      const pending = target.waitForEvent('download'); await (await mapExportButton(target, 'player')).click()
      const filename = info.outputPath(name); await (await pending).saveAs(filename); await keyboardWorkspaceSaved(target)
      await target.locator('.workspace-export-menu > summary').click()
      const image = PNG.sync.read(await readFile(filename)) as { width: number; height: number; data: Uint8Array }
      expect([image.width, image.height]).toEqual([4096, 3072])
      const pixel = (x: number, y: number) => { const index = (Math.floor(y / 24000 * image.height) * image.width + Math.floor(x / 32000 * image.width)) * 4; return Array.from(image.data.slice(index, index + 4)) }
      return { hash: createHash('sha256').update(image.data).digest('hex'), road: pixel(10000, 15000), room: pixel(17000, 11000) }
    }
    const beforePng = await playerImage('delete-before-player.png')
    await inspect(target, ids.door)
    const tools = target.getByRole('region', { name: '门口持续道路关系', exact: true })
    await tools.getByRole('button', { name: '锁定附着关系', exact: true }).click(); await adopt(target)
    const locked = await keyboardProjectBackup(target, info.outputPath('delete-relation-locked.sceneweave'))
    await inspect(target, ids.road)
    const outdoor = target.getByRole('region', { name: '室外对象属性', exact: true })
    await outdoor.getByRole('button', { name: '删除此对象', exact: true }).click()
    await outdoor.getByRole('button', { name: '预览删除室外对象', exact: true }).click()
    await expect(target.locator('.asset-notice[role="alert"]')).toContainText('锁定')
    await expect(review(target)).toHaveCount(0)
    await target.screenshot({ path: info.outputPath('delete-locked-refusal.png'), animations: 'disabled' })
    expect((await keyboardProjectBackup(target, info.outputPath('delete-after-refusal.sceneweave'))).hashes).toEqual(locked.hashes)
    await inspect(target, ids.door)
    await tools.getByRole('button', { name: '解锁附着关系', exact: true }).click(); await adopt(target)
    const unlocked = await keyboardProjectBackup(target, info.outputPath('delete-relation-unlocked.sceneweave'))
    await inspect(target, ids.road)
    await outdoor.getByRole('button', { name: '删除此对象', exact: true }).click()
    await outdoor.getByRole('button', { name: '预览删除室外对象', exact: true }).click()
    await expect(review(target)).toContainText('门路关联')
    await expect(review(target)).toContainText('道路')
    await openDetailsBySummary(review(target), /^实际操作范围/)
    const scope = (await review(target).getByLabel('待采用室外操作 ID', { exact: true }).inputValue()).split('\n')
    expect(scope).toEqual(expect.arrayContaining([ids.road, ids.link, ids.door, ids.room, wallId]))
    await target.screenshot({ path: info.outputPath('delete-road-and-relation-candidate.png'), animations: 'disabled' })
    await adopt(target, '室外修改')
    const deleted = await keyboardProjectBackup(target, info.outputPath('delete-adopted.sceneweave'))
    expect(deleted.document.paths[ids.road]).toBeUndefined(); expect(deleted.document.pathAttachments).toEqual({})
    expect(deleted.document.openings).toEqual(unlocked.document.openings); expect(deleted.document.walls).toEqual(unlocked.document.walls)
    expect(deleted.document.rooms).toEqual(unlocked.document.rooms); expect(deleted.document.terrainAreas).toEqual(unlocked.document.terrainAreas)
    expect(deleted.identity.outdoorTokens[ids.road]).toEqual(unlocked.identity.outdoorTokens[ids.road])
    expect(deleted.identity.structureTokens![ids.link]).toEqual(unlocked.identity.structureTokens![ids.link])
    for (const [id, source] of Object.entries(unlocked.appearance.sources)) expect(deleted.appearance.sources[id]).toEqual(source)
    expect(keyboardResourceHashes(deleted.hashes)).toEqual(keyboardResourceHashes(unlocked.hashes))
    await target.getByRole('button', { name: '撤销编辑', exact: true }).click(); await keyboardWorkspaceSaved(target)
    const restored = await keyboardProjectBackup(target, info.outputPath('delete-undone.sceneweave'))
    expect(restored.document.paths[ids.road]).toEqual(unlocked.document.paths[ids.road])
    expect(restored.document.pathAttachments![ids.link].anchor).toEqual(unlocked.document.pathAttachments![ids.link].anchor)
    expect(restored.document.pathAttachments![ids.link].proofs.path.topologyToken).toBe(restored.identity.outdoorTokens[ids.road].topologyToken)
    expect(restored.identity.outdoorTokens[ids.road].topologyToken).not.toBe(unlocked.identity.outdoorTokens[ids.road].topologyToken)
    expect(restored.identity.structureTokens![ids.link].topologyToken).not.toBe(unlocked.identity.structureTokens![ids.link].topologyToken)
    await target.getByRole('button', { name: '重做编辑', exact: true }).click(); await keyboardWorkspaceSaved(target)
    const redone = await keyboardProjectBackup(target, info.outputPath('delete-redone.sceneweave'))
    expect(redone.document.paths[ids.road]).toBeUndefined(); expect(redone.document.pathAttachments).toEqual({})
    await reloadSaved(target); await keyboardWorkspaceSaved(target)
    const cold = await keyboardProjectBackup(target, info.outputPath('delete-cold.sceneweave')); expect(cold.hashes).toEqual(redone.hashes)
    const afterPng = await playerImage('delete-cold-player.png')
    expect(afterPng.hash).not.toBe(beforePng.hash); expect(afterPng.road).not.toEqual(beforePng.road)
    expect(afterPng.road[3]).toBe(255); expect(afterPng.room).toEqual(beforePng.room)
    await target.screenshot({ path: info.outputPath('delete-cold-ui.png'), animations: 'disabled' })
    await writeFile(info.outputPath('delete-facts.json'), canonicalJson({ browser: browser.version(), inputSource: frozenInput ?? 'normal-ui-reproduction', inputSha256,
      ids, scope, beforePng, afterPng, deletedPathBirth: cold.identity.outdoorTokens[ids.road].token, deletedRelationBirth: cold.identity.structureTokens![ids.link].token, errors }))
    expect(errors).toEqual([])
  } finally { await context.close() }
})
