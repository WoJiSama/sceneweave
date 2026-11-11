// Normal production UI journeys. Complete facts come from actual project/PNG
// downloads; no editor test API or direct browser workspace mutation is used.
import { expect, test, type Locator, type Page } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { unzipSync, zipSync } from 'fflate'
import { applyCompositionCommands } from '../src/shared/appearance/commands'
import { resolveBuildingStructurePort } from '../src/shared/generation/building-port'
import { canonicalJson } from '../src/shared/validation/json'
import { visualBase } from '../src/shared/visual/base'
import type { ProjectManifest } from '../src/shared/project/file'
import type { SceneDocument } from '../src/shared/model/scene'
import { createKeyboardProject, keyboardProjectBackup, keyboardResourceHashes, keyboardWorkspaceSaved, openKeyboardPanel } from './keyboard-ux-helpers'
import { openWorkspaceModule } from './workspace-navigation-helpers'
import { mapExportButton, openDetailsBySummary, reloadSaved } from './workspace-ux-helpers'

const { PNG } = createRequire(import.meta.url)('../node_modules/playwright-core/lib/utilsBundle.js')
test.use({ actionTimeout: 15_000 })
type Image = { width: number; height: number; data: Uint8Array }
type Backup = Awaited<ReturnType<typeof keyboardProjectBackup>>
const review = (page: Page) => page.getByRole('region', { name: '候选审阅', exact: true })
const rect = (x: number, y: number, width: number, height: number) => [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }]

async function number(scope: Page | Locator, label: string, value: string) {
  const input = scope.getByLabel(label, { exact: true })
  await input.fill(value); await input.press('Tab')
}
async function adopt(page: Page, kind: '结构修改' | '视觉修改') {
  await expect(review(page)).toBeVisible()
  await expect(review(page).getByLabel('确认完整影响范围', { exact: true })).toBeVisible()
  await review(page).getByLabel('确认完整影响范围', { exact: true }).check()
  await review(page).getByRole('button', { name: `采用${kind}`, exact: true }).click()
  await expect(review(page)).toHaveCount(0); await keyboardWorkspaceSaved(page)
}
async function png(page: Page, audience: 'gm' | 'player', filename: string) {
  const pending = page.waitForEvent('download')
  await (await mapExportButton(page, audience)).click(); await (await pending).saveAs(filename)
  await keyboardWorkspaceSaved(page); await page.locator('.workspace-export-menu > summary').click()
  const image = PNG.sync.read(await readFile(filename)) as Image
  return { image, hash: createHash('sha256').update(image.data).digest('hex') }
}
function dimensions(image: Image, bounds: SceneDocument['exportBoundsMm']) {
  const scale = 4096 / Math.max(bounds.width, bounds.height)
  expect(image.width).toBe(Math.max(1, Math.round(bounds.width * scale)))
  expect(image.height).toBe(Math.max(1, Math.round(bounds.height * scale)))
}
function samePublicPixels(actual: Image, expected: Image) {
  expect(actual.width).toBe(expected.width); expect(actual.height).toBe(expected.height)
  let differentPixels = 0, maxRgbDifference = 0, maxAlphaDifference = 0
  for (let i = 0; i < actual.data.length; i += 4) {
    let different = false
    for (let channel = 0; channel < 3; channel++) {
      const difference = Math.abs(actual.data[i + channel] - expected.data[i + channel])
      maxRgbDifference = Math.max(maxRgbDifference, difference); different ||= difference !== 0
    }
    maxAlphaDifference = Math.max(maxAlphaDifference, Math.abs(actual.data[i + 3] - expected.data[i + 3]))
    if (different) differentPixels++
  }
  // Independent Chromium canvases can round a few wall-edge shadow/AA RGB
  // samples by one byte. Geometry, alpha and every other pixel stay equal.
  expect(maxAlphaDifference).toBe(0)
  expect(maxRgbDifference).toBeLessThanOrEqual(1)
  expect(differentPixels).toBeLessThanOrEqual(256)
}
function pixel(image: Image, world: { x: number; y: number }, bounds: SceneDocument['exportBoundsMm']) {
  const x = Math.floor((world.x - bounds.x) / bounds.width * image.width), y = Math.floor((world.y - bounds.y) / bounds.height * image.height)
  expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThan(image.width)
  expect(y).toBeGreaterThanOrEqual(0); expect(y).toBeLessThan(image.height)
  return Array.from(image.data.slice((y * image.width + x) * 4, (y * image.width + x) * 4 + 4))
}
async function inspectDoor(page: Page, id: string) {
  const scene = await openWorkspaceModule(page, '场景')
  const all = scene.getByRole('button', { name: '显示所有图层的对象', exact: true })
  if (await all.isVisible()) await all.click()
  await scene.getByRole('group', { name: '场景对象分类', exact: true }).getByRole('button', { name: '结构', exact: true }).click()
  await scene.getByLabel('搜索场景对象', { exact: true }).fill(id)
  await scene.locator(`[data-entity-id="${id}"]`).click()
  return (await openKeyboardPanel(page, 'inspector')).getByLabel('建筑属性', { exact: true })
}
async function importFile(page: Page, filename: string, homeUrl: string) {
  await page.goto(homeUrl)
  const choosing = page.waitForEvent('filechooser')
  await page.getByTestId('workspace-home').getByRole('button', { name: '打开工程文件', exact: true }).click()
  await (await choosing).setFiles(filename)
  await keyboardWorkspaceSaved(page)
}

test('ordinary multi-Floor UI keeps independent room/environment data, real audience PNG bounds and cold history', async ({ page }, info) => {
  test.setTimeout(360_000)
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await createKeyboardProject(page, '普通多楼层独立输出')
  const original = await keyboardProjectBackup(page, info.outputPath('floors-original.sceneweave'))
  const floorA = Object.keys(original.document.floors)[0], originalA = original.document.floors[floorA]
  const originalPng = await png(page, 'player', info.outputPath('floor-a-original-player.png'))
  dimensions(originalPng.image, original.document.exportBoundsMm)

  const scenePanel = await openWorkspaceModule(page, '场景')
  await scenePanel.getByRole('button', { name: '场景设置', exact: true }).click()
  const settings = page.getByTestId('workspace-inspector').getByRole('region', { name: '场景设置', exact: true })
  await openDetailsBySummary(settings, /^楼层管理 ·/)
  const floors = settings.getByLabel('楼层管理', { exact: true })
  await floors.getByLabel('新楼层名称', { exact: true }).fill('B · 阁楼')
  await number(floors, '新楼层宽度', '12'); await number(floors, '新楼层高度', '15')
  await floors.getByRole('button', { name: '预览新建楼层', exact: true }).click()
  await expect(review(page)).toContainText('新建独立楼层')
  await adopt(page, '结构修改')
  const created = await keyboardProjectBackup(page, info.outputPath('floors-created.sceneweave'))
  const floorB = Object.values(created.document.floors).find(floor => floor.name === 'B · 阁楼')!.id
  expect(created.document.floors[floorB].boundsMm).toEqual({ x: 0, y: 0, width: 12000, height: 15000 })
  expect(created.document.floors[floorB].outputBoundsMm).toEqual(created.document.floors[floorB].boundsMm)
  expect(created.document.floors[floorA]).toEqual({ ...originalA, outputBoundsMm: original.document.exportBoundsMm })
  expect(created.document.props).toEqual(original.document.props); expect(created.document.rooms).toEqual(original.document.rooms)
  expect(Object.values(created.document.userLayers).some(layer => layer.floorId === floorB)).toBe(true)
  await page.getByRole('combobox', { name: '当前楼层', exact: true }).selectOption(floorB)

  const building = await openWorkspaceModule(page, '建筑')
  await building.getByRole('group', { name: '建筑任务', exact: true }).getByRole('button', { name: /^绘制房间/ }).click()
  const room = page.getByTestId('workspace-inspector').getByRole('region', { name: '房间参数', exact: true })
  await room.getByLabel('房间形状', { exact: true }).selectOption('rectangle')
  await room.getByLabel('房间名称', { exact: true }).fill('B层手工房间')
  await openDetailsBySummary(room, /^精确位置$/)
  for (const [label, value] of [['房间起点 X', '2'], ['房间起点 Y', '2'], ['房间宽度', '4'], ['房间高度', '3']] as const) await number(room, label, value)
  await room.getByRole('button', { name: '预览新房间', exact: true }).click(); await adopt(page, '结构修改')
  const roomSaved = await keyboardProjectBackup(page, info.outputPath('floor-b-room.sceneweave'))
  const roomB = Object.values(roomSaved.document.rooms).find(value => value.purpose === 'B层手工房间')!
  expect(roomB.floorId).toBe(floorB); expect(roomB.supportRef).toEqual({ kind: 'floor', id: floorB })
  expect(roomSaved.document.floors[floorA]).toEqual(created.document.floors[floorA])

  const atmosphere = await openWorkspaceModule(page, '氛围')
  await atmosphere.getByRole('navigation', { name: '视觉工具', exact: true }).getByRole('button', { name: '环境', exact: true }).click()
  const visual = page.getByTestId('workspace-inspector').locator('.visual-panel.workspace-tool-parameters')
  await expect(visual).toContainText('作用范围：当前楼层环境')
  await visual.getByLabel('视觉环境色', { exact: true }).fill('#aabbcc')
  await visual.getByLabel('视觉环境强度', { exact: true }).fill('0.35')
  await visual.getByLabel('视觉环境曝光', { exact: true }).fill('0.8')
  await visual.getByRole('button', { name: '预览环境', exact: true }).click()
  await expect(review(page).getByLabel('确认完整影响范围', { exact: true })).toBeVisible()
  await page.screenshot({ path: info.outputPath('floor-b-environment-candidate.png'), animations: 'disabled' })
  await adopt(page, '视觉修改')
  const withEnvironment = await keyboardProjectBackup(page, info.outputPath('floor-b-environment.sceneweave'))
  expect(withEnvironment.document.floors[floorB].environment).toMatchObject({ ambientColor: '#aabbcc', ambientOpacity: .35, exposure: .8 })
  expect(withEnvironment.document.floors[floorA]).toEqual(created.document.floors[floorA])
  expect(visualBase(withEnvironment.document)!.environment).toEqual(visualBase(original.document)!.environment)
  expect(keyboardResourceHashes(withEnvironment.hashes)).toEqual(keyboardResourceHashes(original.hashes))

  const bGm = await png(page, 'gm', info.outputPath('floor-b-gm.png')), bPlayer = await png(page, 'player', info.outputPath('floor-b-player.png'))
  for (const image of [bGm.image, bPlayer.image]) dimensions(image, withEnvironment.document.floors[floorB].outputBoundsMm!)
  samePublicPixels(bGm.image, bPlayer.image)
  expect(pixel(bPlayer.image, { x: 3125, y: 3125 }, withEnvironment.document.floors[floorB].outputBoundsMm!)[3]).toBe(255)
  expect(pixel(bPlayer.image, { x: 3125, y: 3125 }, withEnvironment.document.floors[floorB].outputBoundsMm!))
    .not.toEqual(pixel(bPlayer.image, { x: 1125, y: 1125 }, withEnvironment.document.floors[floorB].outputBoundsMm!))
  await page.getByRole('combobox', { name: '当前楼层', exact: true }).selectOption(floorA)
  const aGm = await png(page, 'gm', info.outputPath('floor-a-gm.png')), aPlayer = await png(page, 'player', info.outputPath('floor-a-player.png'))
  for (const image of [aGm.image, aPlayer.image]) dimensions(image, original.document.exportBoundsMm)
  expect(aGm.hash).toBe(originalPng.hash); expect(aPlayer.hash).toBe(originalPng.hash)

  await page.getByRole('button', { name: '撤销编辑', exact: true }).click(); await keyboardWorkspaceSaved(page)
  const undone = await keyboardProjectBackup(page, info.outputPath('floor-environment-undone.sceneweave'))
  expect(undone.document.floors[floorB].environment).toEqual(roomSaved.document.floors[floorB].environment)
  expect(undone.document.rooms).toEqual(roomSaved.document.rooms)
  await page.getByRole('button', { name: '重做编辑', exact: true }).click(); await keyboardWorkspaceSaved(page)
  const redone = await keyboardProjectBackup(page, info.outputPath('floor-environment-redone.sceneweave'))
  await reloadSaved(page); await keyboardWorkspaceSaved(page)
  const cold = await keyboardProjectBackup(page, info.outputPath('floors-cold.sceneweave'))
  expect(cold.hashes).toEqual(redone.hashes)
  await page.getByRole('combobox', { name: '当前楼层', exact: true }).selectOption(floorB)
  await expect(page.getByLabel('材质场景主持人预览', { exact: true })).toBeVisible()
  await page.screenshot({ path: info.outputPath('floor-b-cold-ui.png'), animations: 'disabled' })
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByTestId('workspace-layout')).toHaveAttribute('data-narrow', 'true')
  for (const label of ['关闭内容面板', '关闭当前详情']) {
    const close = page.getByRole('button', { name: label, exact: true })
    if (await close.isVisible()) await close.click()
  }
  for (const panel of ['resources', 'inspector']) await expect(page.getByTestId(`workspace-${panel}`)).toHaveAttribute('data-open', 'false')
  const floorSelect = page.getByRole('combobox', { name: '当前楼层', exact: true })
  await expect(floorSelect).toBeVisible(); await expect(floorSelect).toHaveValue(floorB)
  const controls = page.locator('.asset-header button:visible, .asset-header summary:visible, .asset-view-bar button:visible, .workspace-floor-switch select')
  for (const control of await controls.all()) {
    const bounds = await control.boundingBox()
    expect(bounds).not.toBeNull()
    expect(bounds!.x).toBeGreaterThanOrEqual(-.5)
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390.5)
  }
  const widths = await page.evaluate(() => ({ viewport: innerWidth, body: document.body.scrollWidth, root: document.documentElement.scrollWidth }))
  expect(widths.body).toBeLessThanOrEqual(widths.viewport); expect(widths.root).toBeLessThanOrEqual(widths.viewport)
  await page.screenshot({ path: info.outputPath('floor-b-narrow-390.png'), animations: 'disabled' })
  expect(errors).toEqual([])
})

async function doorFixture(sourcePath: string, plain: Backup, outputPath: string) {
  const files = unzipSync(new Uint8Array(await readFile(sourcePath))), floorId = Object.keys(plain.document.floors)[0]
  const layerId = Object.values(plain.document.userLayers).find(layer => layer.floorId === floorId)!.id
  const material = Object.values(plain.document.materials).find(value => value.applicableSurfaces.includes('terrain'))!
  const roadMaterial = Object.values(plain.document.materials).find(value => value.id !== material.id && value.applicableSurfaces.includes('path'))!
  const roomMaterial = Object.values(plain.document.materials).find(value => value.applicableSurfaces.includes('room'))!
  expect(material).toBeDefined(); expect(roadMaterial).toBeDefined(); expect(roomMaterial).toBeDefined()
  const runtime = { ids: { nextId: () => randomUUID() }, clock: { now: () => plain.document.updatedAt } }
  let content = applyCompositionCommands({ document: plain.document, historyIdentity: plain.identity, appearance: plain.appearance }, [
    { type: 'createTerrainArea', id: 'ui-yard', floorId, layerId, boundaryMm: rect(1000, 1000, 10000, 11000), groundElevationMm: 0, coveragePriority: 0, materialRef: { id: material.id, version: material.version } },
    { type: 'createRoom', id: 'ui-hut', floorId, layerId, boundaryMm: rect(4000, 6000, 4000, 4000), thicknessMm: 200,
      supportRef: { kind: 'terrainArea', id: 'ui-yard' }, materialRef: { id: roomMaterial.id, version: roomMaterial.version }, purpose: '可关闭上锁的门路测试房间' },
  ], runtime)
  const wall = Object.values(content.document.walls).find(value => content.document.vertices[value.startVertexId].yMm === 6000 && content.document.vertices[value.endVertexId].yMm === 6000)!
  content = applyCompositionCommands(content, [{ type: 'addOpening', id: 'ui-locked-door', wallId: wall.id, offsetReferenceVertexId: wall.startVertexId,
    offsetMm: 1400, widthMm: 1200, kind: 'door', state: 'closed', locked: true }], runtime)
  const port = resolveBuildingStructurePort(content.document, 'ui-locked-door', 800)
  content = applyCompositionCommands(content, [{ type: 'createPath', id: 'ui-road', floorId, layerId, centerlineMm: [port.outsideMm, { x: port.outsideMm.x, y: 3500 }, { x: 9500, y: 3500 }],
    widthMm: 800, supportRefs: [port.supportRef], materialRef: { id: roadMaterial.id, version: roadMaterial.version } }], runtime)
  for (const [name, value] of [['scene.json', content.document], ['identity.json', content.historyIdentity], ['appearance.json', content.appearance]] as const) files[name] = new TextEncoder().encode(canonicalJson(value))
  const manifest = JSON.parse(new TextDecoder().decode(files['manifest.json'])) as ProjectManifest
  for (const name of ['scene.json', 'identity.json', 'appearance.json']) {
    const entry = manifest.entries.find(entry => entry.path === name)!
    entry.sha256 = createHash('sha256').update(files[name]).digest('hex'); entry.sizeBytes = files[name].length
  }
  files['manifest.json'] = new TextEncoder().encode(canonicalJson(manifest))
  await writeFile(outputPath, zipSync(files))
}

test('closed locked doorway binds through ordinary UI and preserves real road tail through movement, undo and cold PNG output', async ({ page, browser }, info) => {
  test.setTimeout(360_000)
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await page.goto('./#home')
  await page.getByTestId('workspace-home').getByRole('button', { name: '新建场景', exact: true }).click()
  const creating = page.getByRole('dialog', { name: '新建空白场景', exact: true })
  await creating.getByLabel('场景名称', { exact: true }).fill('真实门路附着文件准备')
  await creating.getByLabel('画布宽度', { exact: true }).fill('20')
  await creating.getByLabel('画布高度', { exact: true }).fill('18')
  await creating.getByRole('button', { name: '创建空白场景', exact: true }).click()
  await expect(creating).toHaveCount(0); await keyboardWorkspaceSaved(page)
  const sourcePath = info.outputPath('attachment-source.sceneweave'), plain = await keyboardProjectBackup(page, sourcePath)
  const fixturePath = info.outputPath('attachment-fixture.sceneweave')
  await doorFixture(sourcePath, plain, fixturePath)
  const context = await browser.newContext({ viewport: { width: 1512, height: 982 } })
  try {
    const target = await context.newPage(); target.on('pageerror', error => errors.push(error.message))
    await importFile(target, fixturePath, new URL('./#home', page.url()).href)
    const imported = await keyboardProjectBackup(target, info.outputPath('attachment-imported.sceneweave'))
    expect(imported.document.openings['ui-locked-door']).toMatchObject({ state: 'closed', locked: true })
    expect(keyboardResourceHashes(imported.hashes)).toEqual(keyboardResourceHashes(plain.hashes))
    let inspector = await inspectDoor(target, 'ui-locked-door')
    let tools = target.getByRole('region', { name: '门口持续道路关系', exact: true })
    await expect(tools).toContainText('门当前关闭且已上锁')
    const initialize = tools.getByRole('button', { name: '预览建立当前结构身份', exact: true })
    if (await initialize.isVisible()) { await initialize.click(); await adopt(target, '结构修改'); inspector = await inspectDoor(target, 'ui-locked-door'); tools = target.getByRole('region', { name: '门口持续道路关系', exact: true }) }
    await tools.getByRole('combobox', { name: '门路附着道路', exact: true }).selectOption('ui-road')
    await tools.getByRole('combobox', { name: '门路附着端点', exact: true }).selectOption('start')
    await number(tools, '门前直入段长度', '1'); await number(tools, '最大端点位移', '1')
    await tools.getByRole('button', { name: '预览绑定门路', exact: true }).click()
    await expect(review(target)).toBeVisible()
    await target.screenshot({ path: info.outputPath('attachment-bind-candidate.png'), animations: 'disabled' })
    await adopt(target, '结构修改')
    const bound = await keyboardProjectBackup(target, info.outputPath('attachment-bound.sceneweave'))
    const relation = Object.values(bound.document.pathAttachments!)[0]
    expect(relation.pathId).toBe('ui-road'); expect(relation.openingId).toBe('ui-locked-door')
    expect(bound.document.paths['ui-road'].centerlineMm.slice(2)).toEqual(imported.document.paths['ui-road'].centerlineMm.slice(1))
    const { centerlineMm: importedLine, ...importedPathProperties } = imported.document.paths['ui-road']
    const { centerlineMm: boundLine, ...boundPathProperties } = bound.document.paths['ui-road']
    expect(boundPathProperties).toEqual(importedPathProperties)
    expect(boundLine.length).toBe(importedLine.length + 1)
    expect(bound.document.openings['ui-locked-door']).toEqual(imported.document.openings['ui-locked-door'])
    expect(bound.identity.structureTokens![relation.id].kind).toBe('pathAttachment')
    expect(relation.proofs.opening.birthToken).toBe(bound.identity.structureTokens!['ui-locked-door'].token)

    inspector = await inspectDoor(target, 'ui-locked-door')
    await number(inspector, '开口近端偏移', '1.6')
    await inspector.getByRole('button', { name: '预览门窗修改', exact: true }).click(); await adopt(target, '结构修改')
    const moved = await keyboardProjectBackup(target, info.outputPath('attachment-moved.sceneweave'))
    expect(moved.document.openings['ui-locked-door']).toMatchObject({ offsetMm: 1600, state: 'closed', locked: true })
    expect(moved.document.paths['ui-road'].centerlineMm.slice(2)).toEqual(bound.document.paths['ui-road'].centerlineMm.slice(2))
    expect(moved.document.paths['ui-road'].centerlineMm[0]).not.toEqual(bound.document.paths['ui-road'].centerlineMm[0])
    expect(moved.document.paths['ui-road'].centerlineMm[0]).toEqual(resolveBuildingStructurePort(moved.document, 'ui-locked-door', 800).outsideMm)
    const { centerlineMm: movedLine, ...movedPathProperties } = moved.document.paths['ui-road']
    expect(movedPathProperties).toEqual(boundPathProperties)
    expect(movedLine.length).toBe(boundLine.length)
    expect(moved.document.pathAttachments![relation.id].proofs).toEqual(relation.proofs)
    await target.getByRole('button', { name: '撤销编辑', exact: true }).click(); await keyboardWorkspaceSaved(target)
    const undone = await keyboardProjectBackup(target, info.outputPath('attachment-undone.sceneweave'))
    expect(undone.document.paths['ui-road']).toEqual(bound.document.paths['ui-road'])
    await target.getByRole('button', { name: '重做编辑', exact: true }).click(); await keyboardWorkspaceSaved(target)
    const redone = await keyboardProjectBackup(target, info.outputPath('attachment-redone.sceneweave'))
    await reloadSaved(target); await keyboardWorkspaceSaved(target)
    const cold = await keyboardProjectBackup(target, info.outputPath('attachment-cold.sceneweave'))
    expect(cold.hashes).toEqual(redone.hashes)
    expect(cold.document.pathAttachments![relation.id].anchor).toEqual(moved.document.pathAttachments![relation.id].anchor)
    expect(cold.document.paths['ui-road'].centerlineMm.slice(2)).toEqual(bound.document.paths['ui-road'].centerlineMm.slice(2))
    const gm = await png(target, 'gm', info.outputPath('attachment-cold-gm.png')), player = await png(target, 'player', info.outputPath('attachment-cold-player.png'))
    for (const image of [gm.image, player.image]) {
      dimensions(image, cold.document.exportBoundsMm)
      expect(pixel(image, { x: 6125, y: 8125 }, cold.document.exportBoundsMm)[3]).toBe(255)
      expect(pixel(image, { x: 6125, y: 8125 }, cold.document.exportBoundsMm)).not.toEqual(pixel(image, { x: 525, y: 525 }, cold.document.exportBoundsMm))
      expect(pixel(image, { x: 8125, y: 3500 }, cold.document.exportBoundsMm))
        .not.toEqual(pixel(image, { x: 8125, y: 4500 }, cold.document.exportBoundsMm))
    }
    samePublicPixels(gm.image, player.image)
    await target.screenshot({ path: info.outputPath('attachment-cold-ui.png'), animations: 'disabled' })
    expect(errors).toEqual([])
  } finally { await context.close() }
})
