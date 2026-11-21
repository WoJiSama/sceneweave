import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { createServer } from 'vite'
import type { PointMm } from '../src/shared/model/scene'
import { createKeyboardProject, keyboardProjectBackup, keyboardWorkspaceSaved } from './keyboard-ux-helpers'
import { openOutdoorTask, openSceneObjects, openWorkspaceModule } from './workspace-navigation-helpers'
import { openDetailsBySummary } from './workspace-ux-helpers'

async function openBackup(page: Page, bytes: Uint8Array) {
  const choosing = page.waitForEvent('filechooser')
  await page.getByTestId('workspace-home').getByRole('button', { name: '打开工程文件', exact: true }).click()
  await (await choosing).setFiles({ name: 'bridge-link.sceneweave', mimeType: 'application/octet-stream', buffer: Buffer.from(bytes) })
  await keyboardWorkspaceSaved(page)
}

test('dragging a bridge snaps one road, follows its end, and previews a reversible broken link', async ({ page, browser }, info) => {
  test.setTimeout(120000)
  page.setDefaultTimeout(12000)
  const vite = await createServer({ configFile: false, logLevel: 'error', cacheDir: info.outputPath('ssr-cache'),
    server: { middlewareMode: true, hmr: false, watch: { ignored: ['**/*'] } }, optimizeDeps: { noDiscovery: true } })
  let archive: Uint8Array
  try {
    const { fixture, runtime, validation } = await vite.ssrLoadModule('/src/application/workspace/test-fixtures.ts')
    const { prepareCompositionCommands } = await vite.ssrLoadModule('/src/application/workspace/prepare.ts')
    const { fromBundle, toBundle } = await vite.ssrLoadModule('/src/application/workspace/project.ts')
    const { exportProject } = await vite.ssrLoadModule('/src/shared/project/file.ts')
    const project = await fromBundle(fixture(), validation), layerId = project.document.entityLayers.item, floorId = 'blank-floor'
    const floor = { kind: 'floor', id: floorId }, p = (x: number, y: number) => ({ x, y })
    const bridge = { type: 'setPathAssembly', id: 'bridge', layerId, floorId, centerlineMm: [p(6800, 6850), p(13200, 6850)], widthMm: 1500,
      recipe: { section: { kind: 'timber', lengthMm: 1600 }, sides: 'both', shoulderMm: 600, endClearanceMm: 0 },
      bridge: { finish: 'timber', elevationMm: 0, visibility: 'public' } }
    const road = (id: string, centerlineMm: PointMm[]) => ({ type: 'createPath', id, layerId, floorId, centerlineMm, widthMm: 1600, supportRefs: [floor] })
    const staged = await prepareCompositionCommands(project, [bridge,
      road('west-road', [p(1000, 7200), p(3300, 7200), p(5997, 7200)]),
      road('east-road', [p(14003, 7800), p(18400, 7800)])], { runtime, validation })
    archive = await exportProject(toBundle(staged), validation)
  } finally { await vite.close() }

  await page.goto('./#home')
  const homeUrl = page.url()
  await openBackup(page, archive)
  const before = await keyboardProjectBackup(page, info.outputPath('before.sceneweave'))
  const bounds = before.document.exportBoundsMm
  async function drag(from: PointMm, to: PointMm) {
    const map = await page.getByLabel('材质场景主持人预览', { exact: true }).boundingBox()
    if (!map) throw Error('Missing canvas')
    const screen = (point: PointMm) => ({ x: map.x + (point.x - bounds.x) * map.width / bounds.width,
      y: map.y + (point.y - bounds.y) * map.height / bounds.height })
    const a = screen(from), b = screen(to)
    await page.mouse.move(a.x, a.y)
    await page.mouse.down()
    await page.mouse.move(b.x, b.y, { steps: 5 })
  }
  const review = page.getByRole('region', { name: '候选审阅', exact: true })
  async function adopt() {
    await page.mouse.up()
    await review.getByLabel('确认完整影响范围', { exact: true }).check()
    await review.getByRole('button', { name: '采用室外修改', exact: true }).click()
    await keyboardWorkspaceSaved(page)
  }
  await drag({ x: 10200, y: 6850 }, { x: 10200, y: 7150 })
  await expect(page.getByTestId('bridge-link-attach')).toBeAttached()
  await expect(page.getByTestId('selection-drag-status')).toContainText('放下将建立桥路链接')
  await adopt()
  const linked = await keyboardProjectBackup(page, info.outputPath('linked.sceneweave'))
  expect(linked.document.paths.bridge.assembly!.bridge!.roadLinks).toEqual({ start: { pathId: 'west-road', end: 'end', restMm: { x: 5997, y: 7200 } } })
  expect(linked.document.paths['east-road']).toEqual(before.document.paths['east-road'])

  await drag({ x: 10200, y: 7200 }, { x: 10200, y: 6700 })
  await expect(page.getByTestId('bridge-link-follow').locator('polygon')).toBeAttached()
  await adopt()
  const followed = await keyboardProjectBackup(page, info.outputPath('followed.sceneweave'))
  expect(followed.document.paths['west-road'].centerlineMm.slice(0, 2)).toEqual(linked.document.paths['west-road'].centerlineMm.slice(0, 2))
  expect(followed.document.paths['west-road'].centerlineMm.at(-1)!.y).toBe(6700)
  expect(followed.document.paths['east-road']).toEqual(linked.document.paths['east-road'])

  await drag({ x: 10200, y: 6700 }, { x: 10200, y: 3100 })
  await expect(page.getByTestId('bridge-link-break')).toHaveAttribute('stroke', '#c83d36')
  await expect(page.getByTestId('selection-drag-status')).toContainText('放下时断开')
  await page.keyboard.press('Escape')
  await page.mouse.up()
  await expect(review).toHaveCount(0)
  expect((await keyboardProjectBackup(page, info.outputPath('cancelled.sceneweave'))).document.paths).toEqual(followed.document.paths)

  await drag({ x: 10200, y: 6700 }, { x: 10200, y: 3100 })
  await expect(page.getByTestId('bridge-link-break')).toBeAttached()
  await adopt()
  const broken = await keyboardProjectBackup(page, info.outputPath('broken.sceneweave'))
  expect(broken.document.paths.bridge.assembly!.bridge!.roadLinks).toBeUndefined()
  expect(broken.document.paths['west-road']).toEqual(followed.document.paths['west-road'])
  await page.getByRole('button', { name: '撤销编辑', exact: true }).click()
  await keyboardWorkspaceSaved(page)
  const undoPath = info.outputPath('undone.sceneweave')
  expect((await keyboardProjectBackup(page, undoPath)).document.paths).toEqual(followed.document.paths)

  const section = Object.values(followed.document.paths.bridge.assembly!.members).find(member => member.state === 'placed')!
  if (section.state !== 'placed') throw new Error('Bridge has no placed railing')
  const member = followed.document.props[section.propId]
  const map = await page.getByLabel('材质场景主持人预览', { exact: true }).boundingBox()
  if (!map) throw new Error('Missing canvas')
  const x = map.x + (member.positionMm.x - bounds.x) * map.width / bounds.width
  const y = map.y + (member.positionMm.y - bounds.y) * map.height / bounds.height
  const viewport = page.getByRole('group', { name: '地图视口', exact: true })
  await page.mouse.click(x, y)
  await expect(viewport).toHaveAttribute('data-selected-ids', '["bridge"]')
  await page.mouse.dblclick(x, y)
  await expect(viewport).toHaveAttribute('data-selected-ids', JSON.stringify([section.propId]))
  await viewport.press('Escape')
  await expect(viewport).toHaveAttribute('data-selected-ids', '["bridge"]')

  const fresh = await browser.newPage()
  try {
    await fresh.goto(homeUrl)
    await openBackup(fresh, await readFile(undoPath))
    expect((await keyboardProjectBackup(fresh, info.outputPath('reimported.sceneweave'))).document.paths).toEqual(followed.document.paths)
  } finally { await fresh.close() }
})

test('turns the middle of a road into a real bridge with two reversible approaches', async ({ page }, info) => {
  test.setTimeout(90_000)
  await createKeyboardProject(page, '将已有道路选段改成桥', { widthMeters: 22, heightMeters: 20 })
  const tools = await openOutdoorTask(page, '道路')
  await openDetailsBySummary(tools, /^精确坐标 · 道路中心线$/)
  await tools.getByLabel('室外坐标', { exact: true }).fill('1500,5500\n6200,5500\n7300,6000\n11000,6000\n15500,6000')
  const supports = tools.getByLabel('道路支撑表面', { exact: true })
  const floor = await supports.locator('option[value^="floor:"]').getAttribute('value')
  if (!floor) throw new Error('Missing floor support')
  await supports.selectOption(floor)
  const review = page.getByRole('region', { name: '候选审阅', exact: true })
  async function adopt() {
    await review.getByLabel('确认完整影响范围', { exact: true }).check()
    await review.getByRole('button', { name: '采用室外修改', exact: true }).click()
    await keyboardWorkspaceSaved(page)
  }
  await tools.getByRole('button', { name: '预览室外修改', exact: true }).click(); await adopt()
  const before = await keyboardProjectBackup(page, info.outputPath('plain-road.sceneweave')), original = Object.values(before.document.paths)[0]
  const objects = await openSceneObjects(page, '结构')
  await objects.getByLabel('搜索场景对象', { exact: true }).fill(original.id)
  await objects.locator(`[data-entity-id=${JSON.stringify(original.id)}]`).click()
  const inspector = page.getByRole('region', { name: '室外对象属性', exact: true })
  await openDetailsBySummary(inspector, /^将道路选段改成桥$/)
  await inspector.getByRole('button', { name: '预览将选段改成桥', exact: true }).click(); await adopt()
  const converted = await keyboardProjectBackup(page, info.outputPath('converted.sceneweave'))
  const bridge = converted.document.paths[original.id], assembly = bridge.assembly!.bridge!
  const { start, end } = assembly.roadLinks!
  expect(Object.keys(converted.document.paths)).toHaveLength(3)
  expect(bridge.centerlineMm).toEqual(expect.arrayContaining([{ x: 6200, y: 5500 }, { x: 7300, y: 6000 }]))
  expect(bridge.supportRefs).toEqual([{ kind: 'terrainArea', id: assembly.deckId }])
  expect(converted.document.paths[start!.pathId].centerlineMm[0]).toEqual(original.centerlineMm[0])
  expect(converted.document.paths[end!.pathId].centerlineMm.at(-1)).toEqual(original.centerlineMm.at(-1))
  await page.getByRole('button', { name: '撤销编辑', exact: true }).click(); await keyboardWorkspaceSaved(page)
  const undone = await keyboardProjectBackup(page, info.outputPath('conversion-undone.sceneweave'))
  expect(undone.document.paths).toEqual(before.document.paths)
  expect(undone.document.terrainAreas).toEqual(before.document.terrainAreas)
})

test('places complete bridge templates and syncs new lamps to one extended bridge while retaining its missing rail', async ({ page, browser }, info) => {
  test.setTimeout(180_000)
  await createKeyboardProject(page, '桥梁模块来源', { widthMeters: 22, heightMeters: 20 })
  const form = await openOutdoorTask(page, '桥梁')
  await openDetailsBySummary(form, /^精确坐标 · 桥梁路线$/)
  await form.getByLabel('沿线构件坐标', { exact: true }).fill('3000,6000\n16000,6000')
  await form.getByLabel('重复源节', { exact: true }).selectOption('timber')
  const length = form.getByLabel('源节长度', { exact: true })
  await length.fill('2'); await length.press('Tab')
  await openDetailsBySummary(form, /^边带与入口留空$/)
  const clearance = form.getByLabel('两端留空长度', { exact: true })
  await clearance.fill('0'); await clearance.press('Tab')
  const review = page.getByRole('region', { name: '候选审阅', exact: true })
  const adopt = async (type: '室外' | '结构' | '批量') => {
    const confirm = review.getByLabel('确认完整影响范围', { exact: true })
    await expect(review).toBeVisible()
    if (await confirm.isVisible()) await confirm.check()
    await review.getByRole('button', { name: `采用${type}修改`, exact: true }).click(); await keyboardWorkspaceSaved(page)
  }
  await form.getByRole('button', { name: '预览桥梁', exact: true }).click(); await adopt('室外')
  const created = await keyboardProjectBackup(page, info.outputPath('bridge-source.sceneweave'))
  const bridge = Object.values(created.document.paths)[0]
  expect(Object.values(bridge.assembly!.members).filter(member => member.state === 'placed')).toHaveLength(12)
  const select = async (id: string, category: '物件与装饰' | '结构') => {
    const list = await openSceneObjects(page, category)
    await list.getByLabel('搜索场景对象', { exact: true }).fill(id)
    await list.locator(`[data-entity-id=${JSON.stringify(id)}]`).click()
  }
  const rail = bridge.assembly!.members['left:0:3:section:body']
  if (rail.state !== 'placed') throw new Error('Missing fourth rail')
  await select(rail.propId, '物件与装饰')
  await page.getByRole('group', { name: '地图视口', exact: true }).press('Delete'); await adopt('批量')
  await select(bridge.id, '结构')
  await openWorkspaceModule(page, '素材')
  const library = page.getByRole('region', { name: '房间与建筑模板', exact: true })
  await openDetailsBySummary(library, /^保存当前整座桥$/)
  await library.getByLabel('桥梁模板名称', { exact: true }).fill('保留登船口木桥')
  await library.getByRole('button', { name: '将整座桥保存到模板库', exact: true }).click()
  await expect(library.getByLabel('我的场景模板')).toContainText('保留登船口木桥')

  await createKeyboardProject(page, '桥梁模块放置目标', { widthMeters: 22, heightMeters: 24 })
  await openWorkspaceModule(page, '素材')
  await library.getByLabel('我的场景模板').selectOption({ label: '保留登船口木桥' })
  await library.getByLabel('场景模板X米', { exact: true }).fill('9')
  await library.getByLabel('场景模板Y米', { exact: true }).fill('3')
  await library.getByLabel('场景模板朝向', { exact: true }).selectOption('1')
  await library.getByRole('button', { name: '预览放置场景模板', exact: true }).click(); await adopt('结构')
  const placed = await keyboardProjectBackup(page, info.outputPath('bridge-placed.sceneweave'))
  const copy = Object.values(placed.document.paths)[0]
  expect(copy.id).not.toBe(bridge.id)
  expect(copy.assembly!.bridge!.deckId).not.toBe(bridge.assembly!.bridge!.deckId)
  const templateKey = copy.assembly!.bridge!.templateKey
  expect(templateKey).toMatch(/^[a-f0-9]{64}$/)
  expect(copy.assembly!.members['left:0:3:section:body']).toEqual({ state: 'removed' })
  expect(Object.keys(placed.document.props)).toHaveLength(11)
  expect(copy.centerlineMm[0].x).toBe(copy.centerlineMm[1].x)
  expect(copy.centerlineMm[1].y - copy.centerlineMm[0].y).toBe(13000)
  await select(copy.id, '结构')
  const inspector = page.getByRole('region', { name: '室外对象属性', exact: true })
  await inspector.getByLabel('桥梁结构饰面', { exact: true }).selectOption('timber')
  await inspector.getByLabel('沿线灯具', { exact: true }).selectOption('default')
  await inspector.getByLabel('每隔几节放灯', { exact: true }).fill('1')
  const railWidth = inspector.getByLabel('外观横向宽度', { exact: true })
  await railWidth.fill('0.24'); await railWidth.press('Tab')
  await inspector.getByRole('button', { name: '预览更新沿线构件', exact: true }).click(); await adopt('室外')
  const edited = await keyboardProjectBackup(page, info.outputPath('bridge-edited.sceneweave'))
  expect(edited.document.paths[copy.id].assembly!.bridge!.finish).toBe('timber')
  expect(edited.document.paths[copy.id].assembly!.members['left:0:3:section:body']).toEqual({ state: 'removed' })
  await openWorkspaceModule(page, '素材')
  await openDetailsBySummary(library, /^桥梁模板版本$/)
  await library.getByRole('button', { name: '比较原桥梁模板', exact: true }).click()
  await expect(library.getByRole('checkbox', { name: '桥体饰面', exact: true })).not.toBeChecked()
  await library.getByRole('checkbox', { name: '沿线灯具', exact: true }).check()
  await library.getByRole('checkbox', { name: '构件尺寸', exact: true }).check()
  const revisionName = '保留登船口木桥 · 加灯'
  await library.getByLabel('桥梁新版名称', { exact: true }).fill(revisionName)
  await library.getByRole('button', { name: '发布桥梁模板新版', exact: true }).click()
  await expect(library.getByLabel('我的场景模板').locator('option:checked')).toHaveText(revisionName)

  await library.getByLabel('我的场景模板').selectOption({ label: '保留登船口木桥' })
  await library.getByLabel('场景模板X米', { exact: true }).fill('16')
  await library.getByRole('button', { name: '预览放置场景模板', exact: true }).click(); await adopt('结构')
  const two = await keyboardProjectBackup(page, info.outputPath('two-bridges.sceneweave'))
  const target = Object.values(two.document.paths).find(path => path.id !== copy.id)!
  const [a, b] = target.centerlineMm
  await select(target.id, '结构')
  await openDetailsBySummary(inspector, /^精确坐标 · 桥梁路线$/)
  await inspector.getByLabel('沿线构件坐标', { exact: true }).fill(`${a.x},${a.y}\n${b.x},${b.y + 4000}`)
  await railWidth.fill('0.27'); await railWidth.press('Tab')
  await inspector.getByRole('button', { name: '预览更新沿线构件', exact: true }).click(); await adopt('室外')
  const extended = await keyboardProjectBackup(page, info.outputPath('bridge-extended.sceneweave'))
  const extendedBridge = extended.document.paths[target.id], expected = extendedBridge.assembly!
  expect(extendedBridge.centerlineMm[1].y - extendedBridge.centerlineMm[0].y).toBe(17000)
  for (const slot of [0, 1, 2, 4, 5, 6, 7]) expect(expected.members[`left:0:${slot}:section:body`].state).toBe('placed')
  expect(expected.members['left:0:3:section:body']).toEqual({ state: 'removed' })
  expect(expected.members['left:0:8:section:body']).toBeUndefined()

  await select(target.id, '结构')
  await openWorkspaceModule(page, '素材')
  await library.getByLabel('我的场景模板').selectOption({ label: revisionName })
  await openDetailsBySummary(library, /^桥梁模板版本$/)
  await library.getByRole('button', { name: `预览同步「${revisionName}」`, exact: true }).click()
  await expect(review).toContainText('采用沿线灯具')
  await expect(review).toContainText('保留手设构件尺寸')
  await adopt('室外')
  const syncedPath = info.outputPath('bridge-synced.sceneweave'), synced = await keyboardProjectBackup(page, syncedPath)
  const upgraded = synced.document.paths[target.id]
  expect(upgraded.centerlineMm).toEqual(extendedBridge.centerlineMm)
  expect(upgraded.assembly!.bridge!.finish).toBe(target.assembly!.bridge!.finish)
  expect(upgraded.assembly!.recipe.dimensions?.visualWidthMm).toBe(270)
  expect(upgraded.assembly!.bridge!.templateKey).not.toBe(templateKey)
  expect(upgraded.assembly!.members['left:0:3:section:body']).toEqual({ state: 'removed' })
  expect(upgraded.assembly!.members['left:0:3:lamp']).toBeUndefined()
  expect(Object.entries(upgraded.assembly!.members).some(([key, member]) => key.endsWith(':lamp') && member.state === 'placed')).toBe(true)
  expect(synced.document.paths[copy.id]).toEqual(extended.document.paths[copy.id])
  await page.getByRole('button', { name: '撤销编辑', exact: true }).click(); await keyboardWorkspaceSaved(page)
  expect((await keyboardProjectBackup(page, info.outputPath('bridge-undo.sceneweave'))).document.paths).toEqual(extended.document.paths)

  const reopened = await browser.newPage()
  try {
    await reopened.goto(new URL('./#home', page.url()).href)
    await openBackup(reopened, await readFile(syncedPath))
    const cold = await keyboardProjectBackup(reopened, info.outputPath('bridge-cold.sceneweave'))
    expect(cold.document.paths).toEqual(synced.document.paths)
    expect(cold.document.props).toEqual(synced.document.props)
  } finally { await reopened.close() }
})
