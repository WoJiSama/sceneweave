import { expect, test, type Page } from '@playwright/test'
import { createKeyboardProject, keyboardProjectBackup, keyboardWorkspaceSaved, openKeyboardPanel } from './keyboard-ux-helpers'
import { closeWorkspaceDrawers } from './workspace-navigation-helpers'
import type { BoundsMm, PointMm } from '../src/shared/model/scene'

async function screenPoint(page: Page, bounds: BoundsMm, x: number, y: number): Promise<PointMm> {
  const canvas = page.getByLabel('材质场景主持人预览', { exact: true })
  await expect(canvas).toBeVisible()
  const box = (await canvas.boundingBox())!
  return { x: box.x + (x - bounds.x) * box.width / bounds.width, y: box.y + (y - bounds.y) * box.height / bounds.height }
}

for (const touch of [false, true]) test.describe(touch ? '窄屏触摸' : '桌面鼠标', () => {
  test.use({ hasTouch: touch, actionTimeout: 15000, viewport: touch ? { width: 390, height: 844 } : { width: 1440, height: 900 } })
  test('从空白手绘共墙房间、开门并放置房内家具', async ({ page }, info) => {
    test.setTimeout(150000)
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto('./#home')
    const home = page.getByTestId('workspace-home')
    await expect(home.locator('.home-main-action')).toHaveAccessibleName('新建场景')
    await home.getByRole('link', { name: '从样板开始', exact: true }).click()
    await expect(home.getByRole('heading', { name: '从样板开始' })).toBeFocused()
    await createKeyboardProject(page, '手绘共墙旅舍', { widthMeters: 18, heightMeters: 12 })
    const original = await keyboardProjectBackup(page, info.outputPath('blank.sceneweave'))
    const bounds = original.document.exportBoundsMm
    const tap = async (x: number, y: number) => {
      const p = await screenPoint(page, bounds, x, y)
      if (touch) await page.touchscreen.tap(p.x, p.y)
      else await page.mouse.click(p.x, p.y)
    }
    const starter = touch ? page.getByRole('region', { name: '场景画布', exact: true }) : page.getByTestId('workspace-inspector')
    if (touch) await page.screenshot({ path: info.outputPath('empty-floor.png'), animations: 'disabled' })
    await starter.getByRole('button', { name: '画第一间房', exact: true }).click()
    await tap(3000, 3000); await tap(9000, 8000)
    await page.getByRole('button', { name: '完成房间', exact: true }).click()
    const actions = page.getByRole('group', { name: '房间操作', exact: true })
    await expect(actions).toBeVisible()
    await keyboardWorkspaceSaved(page)
    const first = await keyboardProjectBackup(page, info.outputPath('first-room.sceneweave'))
    expect(Object.keys(first.document.rooms)).toHaveLength(1)
    expect(first.document.revision).toBe(original.document.revision + 1)
    const initialWalls = Object.values(first.document.walls)
    const right = initialWalls.find(w => first.document.vertices[w.startVertexId].xMm === first.document.vertices[w.endVertexId].xMm &&
      first.document.vertices[w.startVertexId].xMm > 6000)!
    const a = first.document.vertices[right.startVertexId], b = first.document.vertices[right.endVertexId]
    const x = a.xMm, y = (a.yMm + b.yMm) / 2
    const review = page.getByRole('region', { name: '候选审阅', exact: true })
    const adopt = review.getByRole('button', { name: '采用结构修改', exact: true })
    if (!touch) {
      await page.getByRole('button', { name: '工具：画房间', exact: true }).click()
      await tap(x, Math.min(a.yMm, b.yMm)); await tap(x + 4000, Math.max(a.yMm, b.yMm))
      await page.getByRole('button', { name: '完成房间', exact: true }).click()
      await expect(adopt).toBeDisabled()
      await review.getByRole('button', { name: '取消结构预览' }).click()
      await tap(x - 2500, y)
    }
    await actions.getByRole('button', { name: '沿墙扩建' }).click()
    if (touch) { await tap(x, y); await tap(x + 4000, y) }
    else {
      const start = await screenPoint(page, bounds, x, y), end = await screenPoint(page, bounds, x + 4000, y)
      await page.mouse.move(start.x, start.y); await page.mouse.down()
      await page.mouse.move(end.x, end.y, { steps: 8 })
      await expect(page.getByTestId('room-extension-outline')).toContainText('进深')
      await page.screenshot({ path: info.outputPath('extension.png'), animations: 'disabled' })
      await page.mouse.up()
    }
    await expect(adopt).toBeDisabled()
    await review.getByRole('button', { name: '取消结构预览' }).click()
    const extension = page.getByRole('region', { name: '沿墙扩建房间', exact: true })
    if (touch) {
      await closeWorkspaceDrawers(page)
      const start = await screenPoint(page, bounds, x, y), end = await screenPoint(page, bounds, x + 4000, y)
      const input = await page.context().newCDPSession(page)
      try {
        await input.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] })
        await input.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [end] })
        await input.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      } finally { await input.detach() }
      await expect(adopt).toBeDisabled()
      await review.getByRole('button', { name: '取消结构预览' }).click()
    }
    await extension.getByLabel('新房间名称').fill('储藏室')
    await extension.getByLabel('扩建进深').fill('4')
    await extension.getByLabel('扩建进深').press('Tab')
    await extension.getByRole('button', { name: '预览相邻房间' }).click()
    await review.getByLabel('确认完整影响范围').check(); await adopt.click()
    await expect(actions).toBeVisible()
    await keyboardWorkspaceSaved(page)
    await actions.getByRole('button', { name: '放置门窗' }).click()
    await tap(x, y)
    await review.getByLabel('确认完整影响范围').check(); await adopt.click()
    await expect(actions).toBeVisible()
    await actions.getByRole('button', { name: '按用途布置房间' }).click()
    await expect(page.getByLabel('用途布置目标房间')).toHaveValue(/.+/)
    await openKeyboardPanel(page, 'inspector')
    await actions.getByRole('button', { name: '摆放单件' }).click()
    const library = page.getByRole('region', { name: '组件素材库', exact: true })
    await library.getByLabel('搜索组件素材').fill('铜色桌灯')
    await library.getByRole('button', { name: '放置组件 铜色桌灯' }).click()
    await expect(page.getByRole('button', { name: '取消当前放置工具', exact: true })).toBeVisible()
    await closeWorkspaceDrawers(page)
    await tap(x + 2000, y)
    await keyboardWorkspaceSaved(page)
    const result = await keyboardProjectBackup(page, info.outputPath('furnished.sceneweave'))
    const rooms = Object.values(result.document.rooms), store = rooms.find(room => room.purpose === '储藏室')!
    expect(rooms).toHaveLength(2)
    expect(Object.keys(result.document.walls)).toHaveLength(7)
    expect(rooms.every(room => [a.id, b.id].every(id => room.boundaryVertexIds.includes(id)))).toBe(true)
    expect(Object.values(result.document.openings).map(door => door.wallId)).toEqual([right.id])
    expect(Object.values(result.document.props).map(prop => prop.supportRef)).toEqual([{ kind: 'room', id: store.id }])
    await page.getByRole('button', { name: '撤销编辑', exact: true }).click()
    await keyboardWorkspaceSaved(page)
    const undone = await keyboardProjectBackup(page, info.outputPath('undone.sceneweave'))
    expect(Object.keys(undone.document.props)).toHaveLength(0)
    expect(undone.document.rooms).toEqual(result.document.rooms)
    await page.getByRole('button', { name: '重做编辑', exact: true }).click()
    await keyboardWorkspaceSaved(page)
    await closeWorkspaceDrawers(page)
    if (!touch) {
      const lamp = Object.values(result.document.props)[0], hall = Object.values(first.document.rooms)[0]
      const start = await screenPoint(page, bounds, lamp.positionMm.x, lamp.positionMm.y)
      const end = await screenPoint(page, bounds, x - 1500, y)
      await page.mouse.move(start.x, start.y); await page.mouse.down()
      await page.mouse.move(end.x, end.y, { steps: 10 })
      await expect(page.getByTestId('selection-drag-status')).toContainText('储藏室 →')
      await expect(page.locator('[data-room-drop-outline]')).toBeVisible()
      await page.mouse.up()
      await review.getByRole('button', { name: '采用批量修改' }).click()
      await keyboardWorkspaceSaved(page)
      const moved = await keyboardProjectBackup(page, info.outputPath('moved-lamp.sceneweave'))
      expect(moved.document.props[lamp.id].roomId).toBe(hall.id)
      await page.getByRole('button', { name: '撤销编辑', exact: true }).click()
      await keyboardWorkspaceSaved(page)
      const restored = await keyboardProjectBackup(page, info.outputPath('restored-lamp.sceneweave'))
      expect(restored.document.props[lamp.id]).toEqual(lamp)
    }
    await tap(x - 2500, y)
    await openKeyboardPanel(page, 'inspector')
    await actions.getByRole('button', { name: '摆放组合' }).click()
    await expect(page.getByRole('group', { name: '素材类型' }).getByRole('button', { name: '组合', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(library.getByLabel('搜索组件素材')).toHaveValue('')
    await library.getByRole('button', { name: '放置组件 露台一桌两椅', exact: true }).click()
    const placement = page.getByRole('region', { name: '放置固定组合', exact: true })
    const hall = Object.values(first.document.rooms)[0]
    await expect(placement.getByLabel('组合支撑表面')).toHaveValue('')
    await placement.getByLabel('组合放置角度').fill('90')
    await placement.getByRole('button', { name: '预览放置组合' }).click()
    await review.getByRole('button', { name: '取消组件预览' }).click()
    await expect(placement.getByLabel('组合放置角度')).toHaveValue('90')
    await placement.getByRole('button', { name: '预览放置组合' }).click()
    await review.getByRole('button', { name: '采用组件修改' }).click()
    await keyboardWorkspaceSaved(page)
    const members = page.getByRole('group', { name: '选择组合中的单件', exact: true })
    await expect(members.getByRole('button')).toHaveCount(3)
    const furnished = await keyboardProjectBackup(page, info.outputPath('hand-drawn.sceneweave'))
    const groups = Object.values(furnished.document.prefabInstances)
    expect(groups).toHaveLength(1)
    expect(groups[0].rotationDeg).toBe(90)
    expect(Object.values(groups[0].members).map(member => furnished.document.props[member.propId!].supportRef)).toEqual(
      Array(3).fill({ kind: 'room', id: hall.id }))
    await members.getByRole('button', { name: /chair-north/ }).click()
    await expect(page.getByRole('heading', { name: '物件属性', exact: true })).toBeVisible()
    await closeWorkspaceDrawers(page)
    await page.screenshot({ path: info.outputPath('furnished.png'), animations: 'disabled' })
    expect(errors).toEqual([])
  })
})
