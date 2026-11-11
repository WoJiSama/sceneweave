import { openSceneSettings, openWorkspaceModule } from './workspace-navigation-helpers'
import { expect, test, type Page } from '@playwright/test'
import { openDetailsBySummary } from './workspace-ux-helpers'

const home = (page: Page) => page.getByTestId('workspace-home')
const library = (page: Page) => page.getByRole('region', { name: '组件素材库', exact: true })
const errors = new WeakMap<Page, string[]>()
test.beforeEach(({ page }) => { const values: string[] = []; errors.set(page, values); page.on('pageerror', error => values.push(error.message)) })
test.afterEach(({ page }) => { expect(errors.get(page)).toEqual([]) })

async function state(page: Page) {
  return page.evaluate(async () => {
    const path = '/src/editor/main/Workbench.tsx'
    const { nativeWorkspace } = await import(path) as typeof import('../src/editor/main/Workbench')
    const current = nativeWorkspace.getState(), project = current.project
    if (!project) throw new Error('Expected a native main-workspace project.')
    return { document: structuredClone(project.document), canUndo: current.canUndo, canRedo: current.canRedo }
  })
}

async function settled(page: Page) {
  await expect(page.getByTestId('outdoor-workbench')).toHaveAttribute('data-native-format', 'sceneweave-complete-project@1')
  await expect(page.locator('.asset-save')).toHaveText('本地已保存', { timeout: 30_000 })
  await expect(page.locator('.asset-busy')).toHaveCount(0)
  await expect(page.locator('.asset-map-wrap')).toHaveAttribute('aria-busy', 'false', { timeout: 30_000 })
}

async function createBlank(page: Page) {
  await page.goto('/#home')
  await home(page).getByRole('button', { name: '新建场景', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '新建空白场景', exact: true })
  await dialog.getByLabel('场景名称', { exact: true }).fill('子格与填充复制')
  await dialog.getByLabel('画布宽度', { exact: true }).fill('18')
  await dialog.getByLabel('画布高度', { exact: true }).fill('12')
  await dialog.getByRole('button', { name: '创建空白场景', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await settled(page)
}

async function placeLamp(page: Page, at?: { x: number; y: number }) {
  await openWorkspaceModule(page, '素材')
  await library(page).getByLabel('搜索组件素材', { exact: true }).fill('铜色桌灯')
  await library(page).getByRole('button', { name: '放置组件 铜色桌灯', exact: true }).click()
  if (at) {
    const canvas = page.getByLabel('材质场景主持人预览', { exact: true }), box = await canvas.boundingBox()
    if (!box) throw new Error('Expected a real native canvas.')
    await page.mouse.click(box.x + box.width * at.x / 18000, box.y + box.height * at.y / 12000)
  } else await page.getByRole('button', { name: '在此放置', exact: true }).click()
  await settled(page)
  const current = await state(page)
  return Object.keys(current.document.props).at(-1)!
}

async function chooseProp(page: Page, id: string) {
  await openWorkspaceModule(page, '场景')
  await page.getByRole('group', { name: '场景对象分类', exact: true }).getByRole('button', { name: '物件与装饰', exact: true }).click()
  await page.getByLabel('搜索场景对象', { exact: true }).fill(id)
  await page.locator(`.asset-entity-list [data-entity-id="${id}"]`).click()
}

test('subgrid placement and fill-copy candidates remain session-only until one atomic adoption', async ({ page }) => {
  test.setTimeout(120_000)
  await createBlank(page)
  await placeLamp(page)

  await page.getByLabel('子格细分', { exact: true }).selectOption('4')
  await page.getByLabel('吸附锚点', { exact: true }).selectOption('center')
  const placedId = await placeLamp(page, { x: 3600, y: 6600 })
  const positioned = await state(page)
  expect(positioned.document.props[placedId].positionMm).toEqual({ x: 3625, y: 6625 })
  const before = positioned.document
  await page.getByRole('button', { name: '选择地图对象', exact: true }).click()
  await settled(page)

  await chooseProp(page, placedId)
  await openDetailsBySummary(page, /^填充复制$/)
  await page.getByLabel('填充副本数量', { exact: true }).fill('2')
  await page.getByRole('button', { name: '拖拽填充柄', exact: true }).click()
  const canvas = page.getByLabel('材质场景主持人预览', { exact: true }), canvasBox = await canvas.boundingBox()
  if (!canvasBox) throw new Error('Expected a real native canvas.')
  let handle = await page.getByTestId('fill-copy-handle').boundingBox()
  if (!handle) throw new Error('Expected the fill handle.')
  const hit = await page.getByTestId('fill-copy-handle').evaluate(element => {
    const box = element.getBoundingClientRect(), target = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)
    return { targetTag: target?.tagName, targetTestId: target?.getAttribute('data-testid'), ownPointerEvents: getComputedStyle(element).pointerEvents,
      parentPointerEvents: getComputedStyle(element.parentElement!).pointerEvents }
  })
  expect(hit.targetTestId, JSON.stringify(hit)).toBe('fill-copy-handle')
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
  await page.mouse.down()
  await page.mouse.move(canvasBox.x + canvasBox.width + 30, canvasBox.y + canvasBox.height / 2, { steps: 5 })
  await page.mouse.up()
  await expect(page.locator('.asset-selection-notice')).toContainText('地图范围内松开')
  await expect(page.getByLabel('填充复制参数')).toHaveCount(0)
  expect((await state(page)).document).toEqual(before)
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('fill-copy-overlay')).toHaveCount(0)
  expect((await state(page)).document).toEqual(before)

  await openDetailsBySummary(page, /^填充复制$/)
  await page.getByRole('button', { name: '拖拽填充柄', exact: true }).click()
  handle = await page.getByTestId('fill-copy-handle').boundingBox()
  if (!handle) throw new Error('Expected the fill handle after restarting the preview.')
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
  await page.mouse.down()
  await page.mouse.move(handle.x + handle.width / 2 + 60, handle.y + handle.height / 2, { steps: 5 })
  await page.mouse.up()
  await expect(page.getByLabel('填充复制参数')).toBeVisible()
  expect((await state(page)).document).toEqual(before)
  await page.getByRole('button', { name: '取消填充复制预览', exact: true }).click()
  await expect(page.getByLabel('填充复制参数')).toHaveCount(0)
  expect((await state(page)).document).toEqual(before)

  await openDetailsBySummary(page, /^填充复制$/)
  await openDetailsBySummary(page.locator('[data-fill-copy-settings]'), /^用数值设置间距$/)
  await expect(page.getByRole('group', { name: '填充间距', exact: true }).locator('.asset-number small')).toHaveText(['m', 'm'])
  await page.getByLabel('填充间距 X', { exact: true }).fill('1')
  await page.getByLabel('填充间距 X', { exact: true }).press('Tab')
  await page.getByLabel('填充间距 Y', { exact: true }).fill('0.25')
  await page.getByLabel('填充间距 Y', { exact: true }).press('Tab')
  await page.getByRole('button', { name: '预览数值填充', exact: true }).click()
  const candidate = page.getByLabel('填充复制参数')
  await expect(candidate).toBeVisible()
  await expect(candidate).toContainText('新增 2 份')
  await expect(candidate).toContainText('每份偏移 1.000 m, 0.250 m')
  expect((await state(page)).document).toEqual(before)
  await page.getByRole('button', { name: '采用填充复制', exact: true }).click()
  await settled(page)

  const adopted = await state(page), copies = Object.keys(adopted.document.props).filter(id => !Object.hasOwn(before.props, id))
  expect(copies).toHaveLength(2)
  expect(adopted.document.revision).toBe(before.revision + 1)
  expect(adopted.document.props[copies[0]].positionMm).toEqual({ x: 4625, y: 6875 })
  expect(adopted.document.props[copies[1]].positionMm).toEqual({ x: 5625, y: 7125 })
  await page.getByRole('button', { name: '撤销编辑', exact: true }).click()
  await settled(page)
  const undone = (await state(page)).document
  expect({ ...undone, updatedAt: before.updatedAt }).toEqual({ ...before, revision: before.revision + 2 })

  await openSceneSettings(page)
  await page.getByText('单位与格线', { exact: true }).click()
  await page.getByLabel('场景格距', { exact: true }).fill('1')
  await page.getByRole('button', { name: '预览显示设置', exact: true }).click()
  await page.getByRole('button', { name: '采用显示设置', exact: true }).click()
  await settled(page)
  const subdivisions = page.getByLabel('子格细分', { exact: true })
  await expect(subdivisions.locator('option[value="8"]')).toHaveJSProperty('disabled', true)
  await expect(subdivisions).toHaveValue('0')
  expect((await state(page)).document.units.gridSizeMm).toBe(1)
})

test('prefab fill uses actual members and adopts or undoes the whole row once', async ({ page }, testInfo) => {
  test.setTimeout(120_000)
  await createBlank(page)
  await placeLamp(page, { x: 3500, y: 4000 })
  const memberId = await placeLamp(page, { x: 3500, y: 5500 })
  await page.getByRole('button', { name: '选择地图对象', exact: true }).click()
  await settled(page)
  await page.getByRole('button', { name: '全选可编辑对象', exact: true }).click()
  const inspector = page.getByTestId('workspace-inspector')
  await expect(inspector.getByRole('heading', { name: '已选择 2 个对象', exact: true })).toBeVisible()
  await openDetailsBySummary(inspector, /^组合与重复布置$/)
  const prefabTools = inspector.getByRole('region', { name: '固定组合工具', exact: true })
  await prefabTools.getByLabel('新组合名称', { exact: true }).fill('双灯填充组合')
  await prefabTools.getByRole('button', { name: '预览保存组合 · 2 件', exact: true }).click()
  await page.getByRole('button', { name: '采用组件修改', exact: true }).click()
  await settled(page)

  const before = (await state(page)).document
  const source = Object.values(before.prefabInstances)[0]
  expect(Object.values(source.members).filter(member => member.propId)).toHaveLength(2)
  await chooseProp(page, memberId)
  await page.getByRole('button', { name: '选择整个双灯填充组合', exact: true }).click()
  await openDetailsBySummary(page, /^填充复制$/)
  await page.getByLabel('填充副本数量', { exact: true }).fill('2')
  await page.getByRole('button', { name: '拖拽填充柄', exact: true }).click()
  const canvas = await page.getByLabel('材质场景主持人预览', { exact: true }).boundingBox()
  const handle = await page.getByTestId('fill-copy-handle').boundingBox()
  if (!canvas || !handle) throw new Error('Expected the prefab handle on the real canvas.')
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
  await page.mouse.down()
  await page.mouse.move(canvas.x + canvas.width * (source.anchorMm.x + 2000) / 18000,
    canvas.y + canvas.height * source.anchorMm.y / 12000, { steps: 5 })
  await page.mouse.up()
  const candidate = page.getByLabel('填充复制参数', { exact: true })
  await expect(candidate).toContainText('组合 · 新增 2 份')
  await expect(candidate).toContainText('每份偏移 2.000 m, 0.000 m')
  expect((await state(page)).document).toEqual(before)
  await page.screenshot({ path: testInfo.outputPath('prefab-fill-preview.png') })
  await page.getByRole('button', { name: '采用填充复制', exact: true }).click()
  await settled(page)

  const adopted = (await state(page)).document
  const copies = Object.values(adopted.prefabInstances).filter(group => group.id !== source.id)
  expect(adopted.revision).toBe(before.revision + 1)
  expect(copies).toHaveLength(2)
  expect(Object.keys(adopted.props)).toHaveLength(Object.keys(before.props).length + 4)
  for (const [index, copy] of copies.entries()) {
    const dx = (index + 1) * 2000
    expect(copy.definitionRef).toEqual(source.definitionRef)
    expect(copy.anchorMm).toEqual({ x: source.anchorMm.x + dx, y: source.anchorMm.y })
    for (const [key, member] of Object.entries(source.members)) {
      const original = before.props[member.propId!], copied = adopted.props[copy.members[key].propId!]
      expect(copied.id).not.toBe(original.id)
      expect(copy.members[key].overrideFields).toEqual(member.overrideFields)
      expect(copied).toEqual({ ...original, id: copied.id, renderOrder: copied.renderOrder,
        positionMm: { x: original.positionMm.x + dx, y: original.positionMm.y } })
    }
  }
  await page.getByRole('button', { name: '撤销编辑', exact: true }).click()
  await settled(page)
  const undone = (await state(page)).document
  expect({ ...undone, updatedAt: before.updatedAt }).toEqual({ ...before, revision: before.revision + 2 })
  await page.getByRole('button', { name: '重做编辑', exact: true }).click()
  await settled(page)
  const redone = (await state(page)).document
  expect({ ...redone, updatedAt: adopted.updatedAt }).toEqual({ ...adopted, revision: before.revision + 3 })
})
