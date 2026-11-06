import { visualBase } from '../src/shared/visual/base.js'
import { expect, test, type Page } from '@playwright/test'
import type { Workspace } from '../src/application/workspace/workspace'

const errors = new WeakMap<Page, string[]>()
test.beforeEach(({ page }) => { const values: string[] = []; errors.set(page, values); page.on('pageerror', error => values.push(error.message)) })
test.afterEach(({ page }) => { expect(errors.get(page)).toEqual([]) })

async function current(page: Page) {
  return page.evaluate(async () => {
    const { workspace } = Reflect.get(window, '__sceneweaveOutdoorDev') as { workspace: Workspace }
    const value = workspace.getState().project
    if (!value) throw new Error('Expected an active project.')
    return structuredClone(value.document)
  })
}
async function settled(page: Page) {
  await expect(page.locator('.asset-save')).toHaveText('本地已保存', { timeout: 30_000 })
  await expect(page.locator('.asset-busy')).toHaveCount(0)
  await expect(page.locator('.asset-map-wrap')).toHaveAttribute('aria-busy', 'false', { timeout: 30_000 })
}
async function number(page: Page, name: string, value: number) {
  const field = page.getByLabel(name, { exact: true }); await field.fill(String(value)); await field.press('Tab')
}
async function createBlank(page: Page) {
  await page.goto('/#home')
  await page.getByTestId('workspace-home').getByRole('button', { name: '新建场景', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '新建空白场景', exact: true })
  await dialog.getByLabel('场景名称', { exact: true }).fill('建筑编辑自检')
  await dialog.getByLabel('画布宽度', { exact: true }).fill('18')
  await dialog.getByLabel('画布高度', { exact: true }).fill('12')
  await dialog.getByRole('button', { name: '创建空白场景', exact: true }).click()
  await expect(dialog).toHaveCount(0); await settled(page)
  await page.getByRole('tab', { name: '建筑', exact: true }).click()
}
async function adopt(page: Page) {
  await page.getByLabel('确认完整影响范围', { exact: true }).check()
  await page.getByRole('button', { name: '采用结构修改', exact: true }).click()
  await settled(page)
}
async function undo(page: Page) {
  await page.getByRole('button', { name: '撤销编辑', exact: true }).click(); await settled(page)
}
async function rectangle(page: Page, name: string, x: number, y: number, width: number, height: number) {
  await page.getByLabel('房间形状', { exact: true }).selectOption('rectangle')
  await page.getByLabel('房间名称', { exact: true }).fill(name)
  for (const [label, value] of [['房间起点 X', x], ['房间起点 Y', y], ['房间宽度', width], ['房间高度', height]] as const) await number(page, label, value / 1000)
  await page.getByRole('button', { name: '预览新房间', exact: true }).click(); await adopt(page)
  return Object.values((await current(page)).rooms).find(room => room.purpose === name)!.id
}
async function selectRoom(page: Page, roomId: string) {
  await page.locator(`[data-building-room-id="${roomId}"]`).getByRole('button').first().click()
  await expect(page.getByLabel('建筑属性', { exact: true })).toBeVisible()
}
async function selectWall(page: Page, roomId: string, wallId: string) {
  const room = page.locator(`[data-building-room-id="${roomId}"]`)
  if (!await room.evaluate(element => (element as HTMLDetailsElement).open)) await room.locator('summary').click()
  await room.locator(`[data-building-wall-id="${wallId}"]`).click()
}
async function openDetail(page: Page, name: string) {
  const detail = page.getByLabel('建筑属性', { exact: true }).locator('details').filter({ has: page.getByText(name, { exact: true }) })
  if (!await detail.evaluate(element => (element as HTMLDetailsElement).open)) await detail.locator('summary').click()
}
async function worldPoint(page: Page, point: { x: number; y: number }) {
  const box = await page.getByLabel('材质场景主持人预览', { exact: true }).boundingBox()
  if (!box) throw new Error('Expected a real native canvas.')
  return { x: box.x + box.width * point.x / 18000, y: box.y + box.height * point.y / 12000 }
}
async function dragWall(page: Page, dx: number, dy: number) {
  const handle = await page.getByTestId('wall-drag-handle').boundingBox()
  const box = await page.getByLabel('材质场景主持人预览', { exact: true }).boundingBox()
  if (!handle || !box) throw new Error('Expected the wall handle on the real canvas.')
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
  await page.mouse.down()
  await page.mouse.move(handle.x + handle.width / 2 + box.width * dx / 18000, handle.y + handle.height / 2 + box.height * dy / 12000, { steps: 6 })
}
function contents(document: Awaited<ReturnType<typeof current>>) {
  const { revision: _revision, updatedAt: _time, ...value } = document
  return value
}

test('orthogonal drawing and shared-wall dragging preview dependencies before one adoption and undo', async ({ page }, info) => {
  test.setTimeout(120_000)
  await createBlank(page)
  await page.getByLabel('房间形状', { exact: true }).selectOption('orthogonal')
  await page.getByLabel('房间名称', { exact: true }).fill('正交房间')
  await page.getByRole('button', { name: '在图上画房间', exact: true }).click()
  for (const point of [{ x: 1000, y: 1000 }, { x: 5000, y: 1100 }, { x: 4900, y: 4000 }]) {
    const at = await worldPoint(page, point); await page.mouse.click(at.x, at.y)
  }
  await expect(page.getByLabel('房间多边形顶点', { exact: true })).toHaveValue('1000,1000\n5000,1000\n5000,4000')
  expect(Object.keys((await current(page)).rooms)).toHaveLength(0)
  await page.getByRole('button', { name: '预览新房间', exact: true }).click(); await adopt(page)
  const leftId = Object.keys((await current(page)).rooms)[0]
  const rightId = await rectangle(page, '相邻房间', 5000, 1000, 4000, 3000)
  const document = await current(page)
  const wall = Object.values(document.walls).find(wall => document.vertices[wall.startVertexId].xMm === 5000 && document.vertices[wall.endVertexId].xMm === 5000)!
  expect(Object.keys(document.walls)).toHaveLength(7)
  await selectWall(page, leftId, wall.id)
  await page.getByRole('button', { name: '预览新增门窗', exact: true }).click(); await adopt(page)
  await openDetail(page, '附着线索 / 文字')
  await page.getByLabel('附着线索内容', { exact: true }).fill('墙体附属线索')
  await page.getByRole('button', { name: '预览附着线索', exact: true }).click(); await adopt(page)
  const before = await current(page)
  const opening = Object.values(before.openings)[0], note = Object.values(before.notes)[0]
  await dragWall(page, 500, 0)
  expect(await current(page)).toEqual(before)
  await page.keyboard.press('Escape'); await page.mouse.up()
  await expect(page.getByRole('button', { name: '采用结构修改', exact: true })).toHaveCount(0)
  await dragWall(page, 500, 0); await page.mouse.up()
  await expect(page.getByRole('button', { name: '采用结构修改', exact: true })).toBeDisabled()
  const scope = page.getByLabel('待采用建筑操作 ID', { exact: true })
  for (const id of [leftId, rightId, wall.id, opening.id, note.id]) await expect(scope).toHaveValue(new RegExp(id))
  expect(await current(page)).toEqual(before)
  await page.screenshot({ path: info.outputPath('shared-wall-preview.png') })
  await adopt(page)
  const after = await current(page)
  expect(after.revision).toBe(before.revision + 1)
  expect(after.vertices[wall.startVertexId].xMm).toBe(5500)
  expect(after.vertices[wall.endVertexId].xMm).toBe(5500)
  expect(after.openings[opening.id]).toEqual(opening)
  expect(after.notes[note.id]).toEqual(note)
  await undo(page)
  const undone = await current(page)
  expect(contents(undone)).toEqual(contents(before)); expect(undone.revision).toBe(before.revision + 2)
})

test('whole-building transform preserves shared structure and legal deletion retains a neighbour', async ({ page }, info) => {
  test.setTimeout(120_000)
  await createBlank(page)
  const leftId = await rectangle(page, '左室', 2000, 2000, 3000, 3000)
  const rightId = await rectangle(page, '右室', 5000, 2000, 3000, 3000)
  await selectRoom(page, leftId); await openDetail(page, '整栋建筑变换')
  await number(page, '建筑平移 X', 4000); await number(page, '建筑平移 Y', 1000)
  await number(page, '建筑旋转中心 X', 5000); await number(page, '建筑旋转中心 Y', 3500)
  await page.getByLabel('建筑旋转', { exact: true }).selectOption('1')
  const before = await current(page)
  await page.getByRole('button', { name: '预览整栋变换', exact: true }).click()
  const scope = page.getByLabel('待采用建筑操作 ID', { exact: true })
  await expect(scope).toHaveValue(new RegExp(rightId))
  expect(await current(page)).toEqual(before)
  await page.screenshot({ path: info.outputPath('building-transform-preview.png') }); await adopt(page)
  const after = await current(page)
  for (const vertex of Object.values(before.vertices)) expect(after.vertices[vertex.id]).toEqual({ ...vertex, xMm: 9000 - (vertex.yMm - 3500), yMm: 4500 + (vertex.xMm - 5000) })
  expect(after.rooms).toEqual(before.rooms)
  await undo(page)
  expect(contents(await current(page))).toEqual(contents(before))
  await selectRoom(page, leftId); await openDetail(page, '删除房间')
  await page.getByLabel('同时删除无邻室外墙', { exact: true }).check()
  const deletionBaseline = await current(page)
  await page.getByRole('button', { name: '预览删除房间', exact: true }).click()
  expect(await current(page)).toEqual(deletionBaseline)
  await adopt(page)
  const deleted = await current(page)
  expect(Object.keys(deleted.rooms)).toEqual([rightId]); expect(Object.keys(deleted.walls)).toHaveLength(4)
  expect(deleted.rooms[rightId]).toEqual(before.rooms[rightId])
  await undo(page); expect(contents(await current(page))).toEqual(contents(before))
  await selectRoom(page, leftId); await openDetail(page, '删除房间')
  await page.getByRole('button', { name: '预览删除房间', exact: true }).click(); await adopt(page)
  const roomOnlyDeleted = await current(page)
  expect(Object.keys(roomOnlyDeleted.walls)).toHaveLength(7)
  const orphan = Object.values(roomOnlyDeleted.walls).find(wall => !roomOnlyDeleted.rooms[rightId].boundaryVertexIds.includes(wall.startVertexId))!
  await page.locator(`[data-building-wall-id="${orphan.id}"]`).click(); await openDetail(page, '删除墙体')
  await page.getByRole('button', { name: '预览删除墙体', exact: true }).click(); await adopt(page)
  expect(Object.keys((await current(page)).walls)).toHaveLength(6)
})

test('building review includes a room-supported path curve and its unchanged edge look on another layer', async ({ page }) => {
  test.setTimeout(120_000)
  await createBlank(page)
  const roomId = await rectangle(page, '带路径房间', 2000, 2000, 6000, 5000)
  // Only the fixture uses the DEV workspace; preview and adoption use the real UI.
  await page.evaluate(async roomId => {
    const { workspace } = Reflect.get(window, '__sceneweaveOutdoorDev') as { workspace: Workspace }
    const scene = workspace.getDocument()!, floorId = scene.rooms[roomId].floorId
    const start = { x: 3000, y: 4000 }, end = { x: 6000, y: 4000 }
    await workspace.execute([{ type: 'createLayer', id: 'review-effects', floorId, name: '曲线与边带' }])
    await workspace.execute([
      { type: 'createPath', id: 'review-road', floorId, centerlineMm: [start, end], widthMm: 200, supportRefs: [{ kind: 'room', id: roomId }] },
      { type: 'upsertVisualBoundary', boundary: { id: 'review-curve', floorId, layerId: 'review-effects', visibility: 'public', editLocked: false,
        closed: false, sampleSpacingMm: 20000, toleranceMm: 100, binding: { kind: 'path', pathId: 'review-road' },
        segments: [{ id: 'review-segment', start, control1: start, control2: end, end }] } },
      { type: 'upsertVisualEdgeLook', edgeLook: { id: 'review-look', floorId, layerId: 'review-effects', visibility: 'public', editLocked: false,
        boundaryId: 'review-curve', kind: 'path', side: 'both', widthMm: 100, color: '#112233', accentColor: '#445566', opacity: 1, intensity: 1, seed: 'fixed', repeatMm: 500, enabled: true } },
    ])
    await workspace.flush()
  }, roomId)
  await settled(page)
  await selectRoom(page, roomId); await openDetail(page, '整栋建筑变换')
  await number(page, '建筑平移 X', 1000)
  const before = await current(page)
  await page.getByRole('button', { name: '预览整栋变换', exact: true }).click()
  const scope = page.getByLabel('待采用建筑操作 ID', { exact: true })
  for (const id of ['review-road', 'review-curve', 'review-look']) await expect(scope).toHaveValue(new RegExp(id))
  await expect(page.locator('.asset-structure-preview').first()).toContainText('曲线与边带')
  expect(await current(page)).toEqual(before)
  await adopt(page)
  const after = await current(page)
  expect(visualBase(after)!.boundaries['review-curve'].segments[0].start).toEqual({ x: 4000, y: 4000 })
  expect(visualBase(after)!.edgeLooks['review-look']).toEqual(visualBase(before)!.edgeLooks['review-look'])
  await undo(page); expect(contents(await current(page))).toEqual(contents(before))
})

test('topology repair merges a redundant wall joint and rejects deleting a referenced wall', async ({ page }) => {
  test.setTimeout(120_000)
  await createBlank(page)
  await page.getByLabel('房间形状', { exact: true }).selectOption('polygon')
  await page.getByLabel('房间名称', { exact: true }).fill('冗余接点房间')
  await page.getByText('精确输入顶点坐标', { exact: true }).click()
  await page.getByLabel('房间多边形顶点', { exact: true }).fill('2000,2000\n5000,2000\n8000,2000\n8000,6000\n2000,6000')
  await page.getByRole('button', { name: '预览新房间', exact: true }).click(); await adopt(page)
  const baseline = await current(page), roomId = Object.keys(baseline.rooms)[0]
  await selectRoom(page, roomId); await openDetail(page, '拓扑修复')
  await page.getByRole('button', { name: '预览合并共线墙', exact: true }).click()
  expect(await current(page)).toEqual(baseline)
  await adopt(page)
  const repaired = await current(page)
  expect(repaired.rooms[roomId].boundaryVertexIds).toHaveLength(4)
  expect(Object.keys(repaired.walls)).toHaveLength(4); expect(Object.keys(repaired.vertices)).toHaveLength(4)
  await undo(page); expect(contents(await current(page))).toEqual(contents(baseline))
  const wallId = Object.keys(baseline.walls)[0]
  await selectWall(page, roomId, wallId); await openDetail(page, '删除墙体')
  const before = await current(page)
  await page.getByRole('button', { name: '预览删除墙体', exact: true }).click()
  await expect(page.locator('.asset-notice')).toContainText('房间边界')
  await expect(page.getByRole('button', { name: '采用结构修改', exact: true })).toHaveCount(0)
  expect(await current(page)).toEqual(before)
})

test('explicit junction repair splits a contacted room wall and preserves an opening in the same candidate', async ({ page }) => {
  test.setTimeout(120_000)
  await createBlank(page)
  const targetId = await rectangle(page, '接入目标', 2000, 2000, 6000, 4000)
  const sourceId = await rectangle(page, '待拆独立墙', 10000, 4000, 3000, 3000)
  let document = await current(page)
  const targetWall = Object.values(document.walls).find(wall => document.vertices[wall.startVertexId].xMm === 8000 && document.vertices[wall.endVertexId].xMm === 8000)!
  const sourceWall = Object.values(document.walls).find(wall => document.vertices[wall.startVertexId].xMm === 10000 && document.vertices[wall.startVertexId].yMm === 4000 && document.vertices[wall.endVertexId].xMm === 13000)!
  await selectWall(page, targetId, targetWall.id)
  await number(page, '开口近端偏移', 2.5)
  await page.getByRole('button', { name: '预览新增门窗', exact: true }).click(); await adopt(page)
  await selectRoom(page, sourceId); await openDetail(page, '删除房间')
  await page.getByRole('button', { name: '预览删除房间', exact: true }).click(); await adopt(page)
  await page.locator(`[data-building-wall-id="${sourceWall.id}"]`).click(); await openDetail(page, '平移整面墙')
  await number(page, '墙平移 X', -2)
  const before = await current(page), opening = Object.values(before.openings)[0]
  await page.getByRole('button', { name: '预览平移并修复接点', exact: true }).click()
  expect(await current(page)).toEqual(before)
  await expect(page.getByLabel('待采用建筑操作 ID', { exact: true })).toHaveValue(new RegExp(targetId))
  await adopt(page)
  document = await current(page)
  expect(document.rooms[targetId].boundaryVertexIds).toHaveLength(5)
  const mapped = document.openings[opening.id], mappedWall = document.walls[mapped.wallId]
  expect(mapped.wallId).not.toBe(opening.wallId)
  expect(mapped.offsetReferenceVertexId).toBe(sourceWall.startVertexId)
  expect(mapped.offsetMm).toBe(500)
  expect(mappedWall.startVertexId).toBe(sourceWall.startVertexId)
  expect(mapped.widthMm).toBe(opening.widthMm)
  expect(document.revision).toBe(before.revision + 1)
  await undo(page); expect(contents(await current(page))).toEqual(contents(before))
})
