import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'vite'
import { clickKeyboardWorldPoint, keyboardProjectBackup, keyboardResourceHashes, keyboardWorkspaceSaved } from './keyboard-ux-helpers'
import { openBuildingTask, openSceneObjects } from './workspace-navigation-helpers'
import { mapExportButton } from './workspace-ux-helpers'

const { PNG } = createRequire(import.meta.url)('../node_modules/playwright-core/lib/utilsBundle.js')
type Backup = Awaited<ReturnType<typeof keyboardProjectBackup>>

function contents(document: Backup['document']) {
  const { revision: _revision, updatedAt: _updatedAt, ...value } = document
  return value
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
  await page.getByLabel('确认完整影响范围', { exact: true }).check()
  await page.getByRole('button', { name: '采用结构修改', exact: true }).click()
  await keyboardWorkspaceSaved(page)
}
async function select(page: Page, id: string) {
  const objects = await openSceneObjects(page, '结构')
  await objects.getByLabel('搜索场景对象', { exact: true }).fill(id)
  await objects.locator(`.asset-entity-list [data-entity-id="${id}"]`).click()
}
async function detail(page: Page, name: string) {
  const target = page.getByLabel('建筑属性', { exact: true }).locator('details').filter({ has: page.getByText(name, { exact: true }) })
  if (await target.getAttribute('open') === null) await target.locator('summary').click()
}
async function exportPictures(page: Page, info: TestInfo, phase: string) {
  const pictures = []
  for (const audience of ['gm', 'player'] as const) {
    const downloading = page.waitForEvent('download'); await (await mapExportButton(page, audience)).click()
    const path = info.outputPath(`${phase}-${audience}-4096.png`)
    await (await downloading).saveAs(path); await keyboardWorkspaceSaved(page)
    await page.locator('.workspace-export-menu > summary').click()
    const png = PNG.sync.read(await readFile(path))
    expect(Math.max(png.width, png.height)).toBe(4096)
    pictures.push({ audience, width: png.width, height: png.height, rgbaSha256: createHash('sha256').update(png.data).digest('hex') })
  }
  return pictures
}

// State assertions use actual UI downloads. No DEV handles, source imports in
// the page, or database fixture writes are needed by this production journey.
test('normal building junction repair preserves a real door through preview, atomic adoption, undo, redo and cold reopen', async ({ page }, info) => {
  test.setTimeout(240_000)
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  let serial = 0
  const backup = (label: string) => keyboardProjectBackup(page, info.outputPath(`${++serial}-${label}.sceneweave`))
  await page.goto('./#home')
  await page.getByTestId('workspace-home').getByRole('button', { name: '新建场景', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '新建空白场景', exact: true })
  await dialog.getByLabel('场景名称', { exact: true }).fill('建筑接点与真实门洞 · 生产入口核对')
  await dialog.getByLabel('画布宽度', { exact: true }).fill('18')
  await dialog.getByLabel('画布高度', { exact: true }).fill('12')
  await dialog.getByRole('button', { name: '创建空白场景', exact: true }).click()
  await keyboardWorkspaceSaved(page); await expect(dialog).toHaveCount(0)

  async function rectangle(name: string, x: number, y: number, width: number, height: number) {
    await openBuildingTask(page)
    await page.getByLabel('房间形状', { exact: true }).selectOption('rectangle')
    await page.getByLabel('房间名称', { exact: true }).fill(name)
    for (const [label, value] of [['房间起点 X', x], ['房间起点 Y', y], ['房间宽度', width], ['房间高度', height]] as const) await number(page, label, value / 1000)
    await page.getByRole('button', { name: '预览新房间', exact: true }).click(); await adopt(page)
    const state = await backup(name)
    return Object.values(state.document.rooms).find(room => room.purpose === name)!.id
  }
  const targetId = await rectangle('接入目标', 2000, 2000, 6000, 4000)
  const sourceId = await rectangle('待拆独立墙', 10000, 4000, 3000, 3000)
  const drawn = await backup('two-rooms'), document = drawn.document
  const targetWall = Object.values(document.walls).find(wall => document.vertices[wall.startVertexId].xMm === 8000 && document.vertices[wall.endVertexId].xMm === 8000)!
  const sourceWall = Object.values(document.walls).find(wall => document.vertices[wall.startVertexId].xMm === 10000 && document.vertices[wall.startVertexId].yMm === 4000 && document.vertices[wall.endVertexId].xMm === 13000)!
  expect(targetWall).toBeTruthy(); expect(sourceWall).toBeTruthy()
  await select(page, targetWall.id)
  await number(page, '开口近端偏移', 2.5)
  await page.getByRole('button', { name: '预览新增门窗', exact: true }).click(); await adopt(page)
  await select(page, sourceId); await detail(page, '删除房间')
  await page.getByRole('button', { name: '预览删除房间', exact: true }).click(); await adopt(page)
  await select(page, sourceWall.id); await detail(page, '平移整面墙')
  await number(page, '墙平移 X', -2)
  const before = await backup('before-repair'), opening = Object.values(before.document.openings)[0]
  expect(opening).toBeTruthy()
  expect(before.document.rooms[targetId].boundaryVertexIds).toHaveLength(4)
  await page.getByRole('button', { name: '预览平移并修复接点', exact: true }).click()
  await expect(page.getByLabel('待采用建筑操作 ID', { exact: true })).toHaveValue(new RegExp(targetId))
  await expect(page.locator('.workspace-unified')).toHaveAttribute('data-revision', String(before.document.revision))
  await page.getByRole('button', { name: '取消结构预览', exact: true }).click()
  await keyboardWorkspaceSaved(page)
  expect((await backup('preview-cancelled')).hashes).toEqual(before.hashes)
  await page.getByRole('button', { name: '预览平移并修复接点', exact: true }).click()
  await expect(page.getByLabel('待采用建筑操作 ID', { exact: true })).toHaveValue(new RegExp(targetId))
  await adopt(page)
  const adopted = await backup('adopted'), mapped = adopted.document.openings[opening.id]
  expect(adopted.document.revision).toBe(before.document.revision + 1)
  expect(adopted.document.rooms[targetId].boundaryVertexIds).toHaveLength(5)
  expect(mapped.wallId).not.toBe(opening.wallId)
  expect(mapped.offsetReferenceVertexId).toBe(sourceWall.startVertexId)
  expect(mapped.offsetMm).toBe(500)
  expect(mapped.widthMm).toBe(opening.widthMm)
  expect(adopted.document.walls[mapped.wallId].startVertexId).toBe(sourceWall.startVertexId)
  expect(keyboardResourceHashes(adopted.hashes)).toEqual(keyboardResourceHashes(before.hashes))

  await page.getByRole('button', { name: '撤销编辑', exact: true }).click(); await keyboardWorkspaceSaved(page)
  const undone = await backup('undone')
  expect(undone.document.revision).toBe(adopted.document.revision + 1)
  expect(contents(undone.document)).toEqual(contents(before.document))
  await page.getByRole('button', { name: '重做编辑', exact: true }).click(); await keyboardWorkspaceSaved(page)
  const redone = await backup('redone')
  expect(redone.document.revision).toBe(undone.document.revision + 1)
  expect(contents(redone.document)).toEqual(contents(adopted.document))
  const beforeColdPictures = await exportPictures(page, info, 'redone')

  await page.goto('./#home'); await page.reload()
  await page.getByTestId('workspace-home').locator(`[data-project-key="native:${redone.document.sceneId}"]`).getByRole('button', { name: '打开', exact: true }).click()
  await keyboardWorkspaceSaved(page)
  const cold = await backup('cold')
  expect(cold.hashes).toEqual(redone.hashes)
  const coldPictures = await exportPictures(page, info, 'cold')
  expect(coldPictures).toEqual(beforeColdPictures)
  await writeFile(info.outputPath('facts.json'), JSON.stringify({ sceneId: cold.document.sceneId, targetId, sourceWallId: sourceWall.id,
    openingId: opening.id, beforeRevision: before.document.revision, adoptedRevision: adopted.document.revision,
    coldRevision: cold.document.revision, beforeColdPictures, coldPictures, errors }, null, 2))
  expect(errors).toEqual([])
})

test('shared wall movement and a single-room split preserve opening identity and audience-filtered sight', async ({ page, browser }, info) => {
  test.setTimeout(180_000)
  const vite = await createServer({ configFile: false, logLevel: 'error', cacheDir: info.outputPath('ssr-cache'),
    server: { middlewareMode: true, hmr: false, watch: { ignored: ['**/*'] } }, optimizeDeps: { noDiscovery: true } })
  let archive: Uint8Array
  try {
    const { fixture, runtime, validation } = await vite.ssrLoadModule('/src/application/workspace/test-fixtures.ts')
    const { createCompositionContent } = await vite.ssrLoadModule('/src/shared/appearance/graph.ts')
    const { fromBundle, toBundle } = await vite.ssrLoadModule('/src/application/workspace/project.ts')
    const { prepareCompositionCommands } = await vite.ssrLoadModule('/src/application/workspace/prepare.ts')
    const { exportProject } = await vite.ssrLoadModule('/src/shared/project/file.ts')
    const bundle = fixture({ building: true }), scene = bundle.project.document, layerId = scene.entityLayers.room, floorId = 'blank-floor'
    scene.title = '厨房与餐厅共墙'; scene.units.display = 'm'; scene.rooms.room.purpose = '厨房'
    scene.props.item.supportRef = { kind: 'room', id: 'room' }; scene.props.item.roomId = 'room'
    Object.assign(bundle.project, createCompositionContent(scene, runtime))
    const base = await fromBundle(bundle, validation)
    const staged = await prepareCompositionCommands(base, [
      { type: 'createRoom', id: 'dining', floorId, layerId, purpose: '餐厅', thicknessMm: 200,
        boundaryMm: [{ x: 10000, y: 3000 }, { x: 17000, y: 3000 }, { x: 17000, y: 10000 }, { x: 10000, y: 10000 }] },
      { type: 'addOpening', id: 'shared-door', wallId: 'wall-1', offsetReferenceVertexId: 'vertex-1', offsetMm: 2000, widthMm: 1200, kind: 'door' },
      { type: 'addOpening', id: 'shared-window', wallId: 'wall-1', offsetReferenceVertexId: 'vertex-1', offsetMm: 4800, widthMm: 1000, kind: 'window' },
      { type: 'createNote', id: 'hidden-clue', floorId, layerId, anchor: { type: 'entity', entityKind: 'room', entityId: 'room' }, kind: 'clue', visibility: 'gm', text: '仅主持人可见的厨房线索' },
    ], { runtime, validation })
    archive = await exportProject(toBundle(staged), validation)
  } finally { await vite.close() }

  async function importFile(target: Page, bytes: Uint8Array) {
    const chooser = target.waitForEvent('filechooser')
    await target.getByTestId('workspace-home').getByRole('button', { name: '打开工程文件', exact: true }).click()
    await (await chooser).setFiles({ name: 'adjacent-rooms.sceneweave', mimeType: 'application/octet-stream', buffer: Buffer.from(bytes) })
    await keyboardWorkspaceSaved(target)
  }
  const backup = (phase: string) => keyboardProjectBackup(page, info.outputPath(`${phase}.sceneweave`))
  await page.goto('./#home')
  const homeUrl = page.url()
  await importFile(page, archive)
  const initial = await backup('initial'), bounds = initial.document.exportBoundsMm
  const view = page.getByRole('group', { name: '预览受众', exact: true })
  const sight = page.getByTestId('sight-preview-boundary')
  const acrossDoor = { x: 12000, y: 5600 }
  const canSeeAcross = () => sight.evaluate((polygon, point) => (polygon as unknown as SVGPolygonElement).isPointInFill(new DOMPoint(point.x, point.y)), acrossDoor)
  await page.getByRole('button', { name: '临时视野', exact: true }).click()
  await clickKeyboardWorldPoint(page, { x: 8000, y: 5600 }, bounds)
  await expect.poll(canSeeAcross).toBe(false)
  await select(page, 'wall-1')
  await detail(page, '通行与视线')
  await page.getByRole('button', { name: '预览允许视线穿过', exact: true }).click(); await adopt(page)
  await expect.poll(canSeeAcross).toBe(true)
  const glass = await backup('glass-wall')
  expect(glass.document.walls['wall-1']).toMatchObject({ blocksMovement: true, blocksSight: false })
  await page.getByRole('button', { name: '撤销编辑', exact: true }).click(); await keyboardWorkspaceSaved(page)
  await expect.poll(canSeeAcross).toBe(false)
  await select(page, 'shared-door')
  await page.getByLabel('门窗状态', { exact: true }).selectOption('open')
  await page.getByRole('button', { name: '预览门窗修改', exact: true }).click(); await adopt(page)
  await expect.poll(canSeeAcross).toBe(true)
  await view.getByRole('button', { name: '玩家', exact: true }).click()
  await expect.poll(canSeeAcross).toBe(true)
  await view.getByRole('button', { name: '主持人', exact: true }).click()
  await select(page, 'shared-door')
  await page.getByLabel('秘密开口', { exact: true }).check()
  await page.getByLabel('门通行锁', { exact: true }).check()
  await page.getByRole('button', { name: '预览门窗修改', exact: true }).click(); await adopt(page)
  await expect.poll(canSeeAcross).toBe(true)
  const secretOpen = await backup('secret-open')
  await view.getByRole('button', { name: '玩家', exact: true }).click()
  await expect.poll(canSeeAcross).toBe(false)
  await page.getByRole('button', { name: '退出临时视野', exact: true }).click()
  await expect(sight).toHaveCount(0)
  expect((await backup('sight-closed')).hashes).toEqual(secretOpen.hashes)
  await view.getByRole('button', { name: '主持人', exact: true }).click()

  async function drag(from: { x: number; y: number }, to: { x: number; y: number }) {
    const canvas = await page.getByLabel('材质场景主持人预览', { exact: true }).boundingBox()
    if (!canvas) throw new Error('Map canvas must be visible.')
    const screen = ({ x, y }: typeof from) => ({ x: canvas.x + (x - bounds.x) * canvas.width / bounds.width, y: canvas.y + (y - bounds.y) * canvas.height / bounds.height })
    const a = screen(from), b = screen(to)
    await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 5 })
  }
  await select(page, 'wall-1')
  await expect(page.getByTestId('wall-drag-handle')).toBeVisible()
  await drag({ x: 10000, y: 6500 }, { x: 9500, y: 6500 })
  await page.mouse.up(); await adopt(page)
  const shared = await backup('shared-wall-moved')
  expect(Object.keys(shared.document.walls).sort()).toEqual(Object.keys(initial.document.walls).sort())
  expect(shared.document.vertices['vertex-1'].xMm).toBe(9500)
  expect(shared.document.rooms.room.boundaryVertexIds).toContain('vertex-1')
  expect(shared.document.rooms.dining.boundaryVertexIds).toContain('vertex-1')
  expect(shared.document.openings).toEqual(secretOpen.document.openings)

  await select(page, 'room')
  await drag({ x: 6000, y: 6500 }, { x: 6000, y: 14500 })
  await expect(page.getByTestId('room-shared-wall-split')).toHaveAttribute('stroke', '#c83d36')
  await expect(page.getByTestId('selection-drag-status')).toContainText('门窗留在原墙')
  await page.keyboard.press('Escape'); await page.mouse.up()
  await expect(page.getByRole('region', { name: '候选审阅', exact: true })).toHaveCount(0)
  await detail(page, '移动这一间房')
  await number(page, '房间平移 Y', 8)
  await page.getByRole('checkbox', { name: '门 · shared-door · 秘密', exact: true }).check()
  await page.getByRole('button', { name: '预览移动这间房', exact: true }).click(); await adopt(page)
  const splitPath = info.outputPath('split.sceneweave')
  const split = await keyboardProjectBackup(page, splitPath)
  const wallId = split.document.openings['shared-door'].wallId, newWall = split.document.walls[wallId]
  expect(wallId).not.toBe('wall-1')
  expect(split.document.rooms.room.boundaryVertexIds).toEqual(expect.arrayContaining([newWall.startVertexId, newWall.endVertexId]))
  expect(split.document.openings['shared-door']).toMatchObject({ kind: 'door', offsetMm: 2000, widthMm: 1200, state: 'open', secret: true, locked: true })
  expect(split.document.openings['shared-window']).toEqual(shared.document.openings['shared-window'])
  expect(split.document.rooms.dining).toEqual(shared.document.rooms.dining)
  expect(split.document.notes['hidden-clue']).toEqual(shared.document.notes['hidden-clue'])
  expect(split.document.props.item.positionMm.y).toBe(shared.document.props.item.positionMm.y + 8000)
  await page.getByRole('button', { name: '撤销编辑', exact: true }).click(); await keyboardWorkspaceSaved(page)
  expect(contents((await backup('undo')).document)).toEqual(contents(shared.document))
  await page.getByRole('button', { name: '重做编辑', exact: true }).click(); await keyboardWorkspaceSaved(page)
  const redone = await backup('redone')
  expect(contents(redone.document)).toEqual(contents(split.document))
  await page.goto('./#home'); await page.reload()
  await page.getByTestId('workspace-home').locator(`[data-project-key="native:${redone.document.sceneId}"]`).getByRole('button', { name: '打开', exact: true }).click()
  await keyboardWorkspaceSaved(page)
  expect((await backup('reopened')).hashes).toEqual(redone.hashes)

  const fresh = await browser.newPage()
  try {
    await fresh.goto(homeUrl); await importFile(fresh, await readFile(splitPath))
    await select(fresh, 'shared-door')
    await fresh.getByLabel('门窗状态', { exact: true }).selectOption('closed')
    await fresh.getByRole('button', { name: '预览门窗修改', exact: true }).click(); await adopt(fresh)
    const reedited = await keyboardProjectBackup(fresh, info.outputPath('reimport-edited.sceneweave'))
    expect(reedited.document.openings['shared-door']).toEqual({ ...split.document.openings['shared-door'], state: 'closed' })
  } finally { await fresh.close() }
})
