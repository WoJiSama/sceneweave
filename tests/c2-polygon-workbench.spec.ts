import { expect, test, type Page } from '@playwright/test'
import type { PointMm, SceneDocumentV3 } from '../src/core/v3/types'
import type { WorkspaceV4 } from '../src/editor/v4/workspace'

async function scene(page: Page): Promise<SceneDocumentV3> {
  return page.evaluate(() => structuredClone((Reflect.get(window, '__sceneweaveHistoryDev') as { workspace: WorkspaceV4 }).workspace.getState().project!.document))
}
async function settled(page: Page) {
  await expect(page.locator('.asset-save')).toHaveText('本地已保存')
  await expect(page.locator('.asset-map-wrap')).toHaveAttribute('aria-busy', 'false')
  await expect(page.locator('.asset-busy')).toHaveCount(0)
}
async function number(page: Page, label: string, value: number) {
  const input = page.getByRole('spinbutton', { name: label, exact: true })
  await input.fill(String(value)); await input.press('Tab')
}
async function adopt(page: Page) {
  await expect(page.getByRole('button', { name: '采用结构修改', exact: true })).toBeDisabled()
  await page.getByRole('checkbox', { name: '确认建筑完整影响范围', exact: true }).check()
  await page.getByRole('button', { name: '采用结构修改', exact: true }).click(); await settled(page)
}
async function selectWall(page: Page, roomId: string, wallId: string) {
  const details = page.locator(`[data-building-room-id="${roomId}"]`)
  if (await details.getAttribute('open') === null) {
    const summary = details.locator(':scope > summary'); await summary.focus(); await summary.press('Enter')
  }
  await details.locator(`[data-building-wall-id="${wallId}"]`).click()
  await expect(page.locator('.building-stable-id')).toHaveText(wallId)
}
function openingEndpoints(document: SceneDocumentV3, id: string): PointMm[] {
  const opening = document.openings[id], wall = document.walls[opening.wallId]
  const a = document.vertices[opening.offsetReferenceVertexId], b = document.vertices[opening.offsetReferenceVertexId === wall.startVertexId ? wall.endVertexId : wall.startVertexId]
  const dx = b.xMm - a.xMm, dy = b.yMm - a.yMm, length = Math.hypot(dx, dy)
  return [opening.offsetMm, opening.offsetMm + opening.widthMm].map(distance => ({ x: a.xMm + distance / length * dx, y: a.yMm + distance / length * dy }))
}

test('C2 numeric concave polygon UI rejects malformed and crossing boundaries, cancels cleanly and preserves attached diagonal openings when reversing a wall', async ({ page }, info) => {
  test.setTimeout(150_000)
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await page.goto('/#history'); await expect(page.getByTestId('history-workbench')).toBeVisible()
  await page.getByRole('button', { name: '新建空白场景', exact: true }).first().click()
  const dialog = page.getByRole('dialog', { name: '新建空白场景', exact: true })
  await dialog.getByLabel('场景名称', { exact: true }).fill('C2 多边形斜墙')
  await dialog.getByLabel('画布宽度', { exact: true }).fill('18000')
  await dialog.getByLabel('画布高度', { exact: true }).fill('14000')
  await dialog.getByRole('button', { name: '创建空白场景', exact: true }).click()
  await expect(dialog).toHaveCount(0); await settled(page)
  await page.getByRole('tab', { name: '建筑', exact: true }).click()
  await page.getByLabel('房间名称', { exact: true }).fill('折角斜墙室')
  await page.getByLabel('房间形状', { exact: true }).selectOption('polygon')
  const boundary = page.getByLabel('房间多边形顶点', { exact: true }), baseline = await scene(page)
  await boundary.fill('2000,2000\n7000.5,2000\n7000,7000')
  await page.getByRole('button', { name: '预览新房间', exact: true }).click()
  await expect(page.getByRole('region', { name: '建筑工具', exact: true }).getByRole('alert')).toContainText('整数毫米坐标')
  expect(await scene(page)).toEqual(baseline)
  await boundary.fill('2000,2000\n9000,9000\n2000,9000\n9000,2000')
  await page.getByRole('button', { name: '预览新房间', exact: true }).click()
  await expect(page.locator('.asset-notice')).toContainText(/自交|简单多边形/)
  await expect(page.getByRole('button', { name: '采用结构修改', exact: true })).toHaveCount(0)
  expect(await scene(page)).toEqual(baseline)
  const points = [{ x: 2000, y: 2000 }, { x: 8000, y: 2000 }, { x: 11000, y: 6000 }, { x: 8000, y: 6000 }, { x: 8000, y: 10000 }, { x: 2000, y: 10000 }]
  await boundary.fill(points.map(point => `${point.x},${point.y}`).join('\n'))
  await page.getByRole('button', { name: '预览新房间', exact: true }).click()
  await expect(page.getByRole('checkbox', { name: '确认建筑完整影响范围', exact: true })).toBeVisible()
  expect(await scene(page)).toEqual(baseline)
  await page.getByRole('button', { name: '取消结构预览', exact: true }).click()
  expect(await scene(page)).toEqual(baseline)
  await page.getByRole('button', { name: '预览新房间', exact: true }).click(); await adopt(page)
  const created = await scene(page), room = Object.values(created.rooms)[0]
  expect(created.revision).toBe(baseline.revision + 1)
  expect(Object.keys(created.vertices)).toHaveLength(6); expect(Object.keys(created.walls)).toHaveLength(6)
  const actualPoints = room.boundaryVertexIds.map(id => ({ x: created.vertices[id].xMm, y: created.vertices[id].yMm }))
  expect(new Set(actualPoints.map(point => `${point.x},${point.y}`))).toEqual(new Set(points.map(point => `${point.x},${point.y}`)))
  const diagonal = Object.values(created.walls).find(wall => {
    const a = created.vertices[wall.startVertexId], b = created.vertices[wall.endVertexId]
    return a.xMm !== b.xMm && a.yMm !== b.yMm
  })!
  expect(diagonal).toBeDefined(); await selectWall(page, room.id, diagonal.id)
  await page.getByLabel('开口类型', { exact: true }).selectOption('window')
  await page.getByLabel('开口基准端点', { exact: true }).selectOption(diagonal.startVertexId)
  await number(page, '开口近端偏移', 1000); await number(page, '开口净宽', 1000)
  await page.getByRole('button', { name: '预览新增门窗', exact: true }).click(); await adopt(page)
  const opened = await scene(page), opening = Object.values(opened.openings)[0], endpoints = openingEndpoints(opened, opening.id)
  expect(opening).toMatchObject({ wallId: diagonal.id, kind: 'window', offsetReferenceVertexId: diagonal.startVertexId, offsetMm: 1000, widthMm: 1000 })
  await selectWall(page, room.id, diagonal.id)
  await page.getByRole('button', { name: '反转方向', exact: true }).click()
  expect(await scene(page)).toEqual(opened); await adopt(page)
  const reversed = await scene(page), reverseEndpoints = openingEndpoints(reversed, opening.id)
  expect(reversed.walls[diagonal.id].startVertexId).toBe(diagonal.endVertexId)
  expect(reversed.walls[diagonal.id].endVertexId).toBe(diagonal.startVertexId)
  for (let i = 0; i < endpoints.length; i++) {
    expect(reverseEndpoints[i].x).toBeCloseTo(endpoints[i].x, 8)
    expect(reverseEndpoints[i].y).toBeCloseTo(endpoints[i].y, 8)
  }
  expect(reversed.openings[opening.id]).toEqual(opened.openings[opening.id])
  expect(reversed.revision).toBe(opened.revision + 1)
  await page.getByRole('button', { name: '撤销素材编辑', exact: true }).click(); await settled(page)
  const undone = await scene(page)
  expect(undone.revision).toBe(reversed.revision + 1); expect(undone.walls).toEqual(opened.walls)
  expect(undone.openings).toEqual(opened.openings); expect(errors).toEqual([])
  await info.attach('c2-ui-polygon-diagonal.png', { body: await page.screenshot(), contentType: 'image/png' })
  await info.attach('c2-ui-polygon-diagonal.json', { body: JSON.stringify({ method: 'Actual empty-project numeric UI; six-vertex concave polygon with a 3:4 diagonal; malformed and self-crossing candidates rejected without mutation; valid preview canceled; attached diagonal window and direction reversal adopted atomically. No document injection.', baseline, created, opened, endpoints, reversed, reverseEndpoints, undone, errors }, null, 2), contentType: 'application/json' })
})
