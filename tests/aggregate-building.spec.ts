import { expect, test, type Locator, type Page } from '@playwright/test'
import { openSceneObjects, openBuildingTask } from './workspace-navigation-helpers'
import { createServer } from 'vite'

const TITLE = '建筑组整体操作开发自检'
const ROOM = '建筑组测试房间'
const NOTE = '建筑组主持人线索'

async function saved(page: Page) {
  await expect(page.locator('.asset-busy')).toHaveCount(0, { timeout: 30000 })
  await expect(page.locator('.asset-save')).toHaveText('本地已保存', { timeout: 30000 })
}

async function buildingTools(page: Page) {
  await openBuildingTask(page, '建筑组')
  const tools = page.getByLabel('建筑组工具', { exact: true })
  await expect(tools).toBeVisible()
  if (await tools.getAttribute('open') === null) await tools.locator('summary').first().click()
  return tools
}

async function insideBuilding(page: Page) {
  const tools = await buildingTools(page)
  const members = tools.getByLabel('建筑组内部对象', { exact: true })
  if (!await members.isVisible()) await tools.getByText('进入内部', { exact: true }).click()
  await expect(members).toBeVisible()
  return members
}

async function commitNumber(scope: Locator, name: string, value: string) {
  const field = scope.getByRole('spinbutton', { name, exact: true })
  await field.fill(value)
  await field.press('Enter')
  await expect(field).toHaveValue(value)
}

async function itemCoordinates(page: Page, x: string, y: string, rotation: string) {
  if (!await page.getByRole('heading', { name: '物件属性', exact: true }).isVisible()) await page.getByRole('button', { name: '返回所选对象', exact: true }).click()
  await expect(page.getByRole('heading', { name: '物件属性', exact: true })).toBeVisible()
  await expect(page.getByRole('spinbutton', { name: '物件 X', exact: true })).toHaveValue(x)
  await expect(page.getByRole('spinbutton', { name: '物件 Y', exact: true })).toHaveValue(y)
  await expect(page.getByRole('spinbutton', { name: '物件旋转', exact: true })).toHaveValue(rotation)
}

test('create a building group, transform its members, undo and reopen the saved production project', async ({ page }, info) => {
  test.setTimeout(120000)
  page.setDefaultTimeout(15000)
  // SSR only prepares an ordinary complete-project file. Browser operations use
  // the production homepage, candidate review and repository-backed workspace.
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' })
  let bytes: Uint8Array
  try {
    const { fixture, runtime, validation } = await vite.ssrLoadModule('/src/application/workspace/test-fixtures.ts')
    const { createCompositionContent } = await vite.ssrLoadModule('/src/shared/appearance/graph.ts')
    const { exportProject } = await vite.ssrLoadModule('/src/shared/project/file.ts')
    const source = fixture({ building: true }), scene = source.project.document
    scene.title = TITLE
    scene.units.display = 'm'
    scene.rooms.room.purpose = ROOM
    scene.props.item.positionMm = { x: 4500, y: 4500 }
    scene.props.item.supportRef = { kind: 'room', id: 'room' }
    scene.props.item.roomId = 'room'
    scene.props.other.positionMm = { x: 16000, y: 16000 }
    // Distinct readable names also expose an accidental inclusion of the
    // unrelated Floor-supported object in the building's moving closure.
    scene.props.other.appearance.symbol = 'crate'
    scene.openings.door = { id: 'door', floorId: 'blank-floor', editLocked: false, wallId: 'wall-0',
      offsetReferenceVertexId: 'vertex-0', offsetMm: 1000, widthMm: 1200,
      kind: 'door', state: 'closed', locked: true, secret: true, revealed: false }
    scene.paths['room-path'] = { id: 'room-path', floorId: 'blank-floor', editLocked: false,
      visibility: 'public', centerlineMm: [{ x: 4500, y: 7000 }, { x: 7500, y: 7000 }],
      widthMm: 400, supportRefs: [{ kind: 'room', id: 'room' }], surfaceStyle: null,
      movementCostMultiplier: 1, renderOrder: 0 }
    scene.notes['item-note'] = { id: 'item-note', floorId: 'blank-floor', editLocked: false,
      kind: 'note', text: NOTE, visibility: 'gm', anchor: { type: 'entity', entityKind: 'prop', entityId: 'item' } }
    for (const id of ['door', 'room-path', 'item-note']) scene.entityLayers[id] = scene.entityLayers.room
    // New entities receive real history identities; the imported fixture has no
    // aggregate group so creation itself must pass through the normal UI.
    Object.assign(source.project, createCompositionContent(scene, runtime))
    bytes = await exportProject(source, validation)
  } finally { await vite.close() }

  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('./#home')
  const chooser = page.waitForEvent('filechooser')
  await page.getByTestId('workspace-home').getByRole('button', { name: '打开工程文件', exact: true }).click()
  await (await chooser).setFiles({ name: 'aggregate-building.sceneweave', mimeType: 'application/octet-stream', buffer: Buffer.from(bytes) })
  const workbench = page.getByTestId('outdoor-workbench')
  const review = page.getByRole('region', { name: '候选审阅', exact: true })
  await expect(workbench).toBeVisible()
  await saved(page)
  await expect(workbench).toHaveAttribute('data-revision', '0')

  const tools = await buildingTools(page)
  await tools.getByRole('button', { name: '创建建筑组', exact: true }).click()
  await expect(review).toBeVisible()
  await expect(review.getByLabel('分组变化', { exact: true })).toContainText('创建分组 · 13 个直接成员')
  const scope = review.getByLabel('关联对象', { exact: true })
  await expect(scope).toContainText(ROOM)
  await expect(scope).toContainText('桌子')
  await expect(scope).toContainText(NOTE)
  await expect(scope).toContainText('道路 · 宽 0.4 m')
  await expect(scope).not.toContainText('木箱')
  await expect(review.getByRole('button', { name: '采用结构修改', exact: true })).toBeDisabled()
  await expect(workbench).toHaveAttribute('data-revision', '0')
  await page.screenshot({ path: info.outputPath('aggregate-building-create-preview.png'), fullPage: true })
  await review.getByRole('button', { name: '取消结构预览', exact: true }).click()
  await expect(review).toHaveCount(0)
  await expect(workbench).toHaveAttribute('data-revision', '0')
  await expect(tools.getByRole('combobox', { name: '建筑组', exact: true })).toHaveCount(0)

  await tools.getByRole('button', { name: '创建建筑组', exact: true }).click()
  await review.getByLabel('确认完整影响范围', { exact: true }).check()
  await review.getByRole('button', { name: '采用结构修改', exact: true }).click()
  await saved(page)
  await expect(workbench).toHaveAttribute('data-revision', '1')
  await expect(tools.getByRole('combobox', { name: '建筑组', exact: true }).locator('option')).toHaveCount(1)
  await expect(tools.getByRole('button', { name: '创建建筑组', exact: true })).toBeDisabled()
  await tools.getByRole('button', { name: '选择整栋', exact: true }).click()
  await page.getByRole('button', { name: '返回所选对象', exact: true }).click()
  await expect(page.getByRole('heading', { name: '多选属性', exact: true })).toBeVisible()
  const members = await insideBuilding(page)
  await expect(members.getByRole('button', { name: '桌子', exact: true })).toHaveCount(1)
  await expect(members.getByRole('button', { name: NOTE, exact: true })).toBeVisible()
  await expect(members.getByRole('button', { name: '木箱', exact: true })).toHaveCount(0)
  await members.getByRole('button', { name: '桌子', exact: true }).click()
  await itemCoordinates(page, '4.5', '4.5', '0')

  await buildingTools(page)
  await commitNumber(tools, '整栋偏移 X', '1')
  await commitNumber(tools, '整栋偏移 Y', '0')
  await tools.getByRole('combobox', { name: '整栋旋转', exact: true }).selectOption('1')
  await commitNumber(tools, '整栋旋转支点 X', '6.5')
  await commitNumber(tools, '整栋旋转支点 Y', '6.5')
  await tools.getByRole('button', { name: '预览整栋变换', exact: true }).click()
  await expect(review).toBeVisible()
  await expect(review).toContainText('整栋建筑变换')
  await expect(review.getByLabel('关联对象', { exact: true })).toContainText('桌子')
  const actualChanges = review.locator('.composition-preview-details')
  await actualChanges.locator(':scope > summary').click()
  const budget = review.getByLabel('普通事务保护详情', { exact: true })
  await budget.locator('summary').click()
  await expect(budget).toContainText('编辑目标1 / 256')
  await expect(budget).toContainText('组内影响13 / 4096')
  await expect(budget).toContainText('组外依赖')
  await expect(workbench).toHaveAttribute('data-revision', '1')
  await expect(review.getByRole('button', { name: '采用结构修改', exact: true })).toBeDisabled()
  await page.screenshot({ path: info.outputPath('aggregate-building-transform-preview.png'), fullPage: true })
  await review.getByRole('button', { name: '取消结构预览', exact: true }).click()
  await expect(review).toHaveCount(0)
  await expect(workbench).toHaveAttribute('data-revision', '1')
  await itemCoordinates(page, '4.5', '4.5', '0')
  await buildingTools(page)
  await tools.getByRole('button', { name: '预览整栋变换', exact: true }).click()
  await review.getByLabel('确认完整影响范围', { exact: true }).check()
  await review.getByRole('button', { name: '采用结构修改', exact: true }).click()
  await saved(page)
  await expect(workbench).toHaveAttribute('data-revision', '2')
  await itemCoordinates(page, '9.5', '4.5', '90')
  await page.getByRole('button', { name: '撤销编辑', exact: true }).click()
  await saved(page)
  await expect(workbench).toHaveAttribute('data-revision', '3')
  await itemCoordinates(page, '4.5', '4.5', '0')
  await page.getByRole('button', { name: '重做编辑', exact: true }).click()
  await saved(page)
  await expect(workbench).toHaveAttribute('data-revision', '4')
  await itemCoordinates(page, '9.5', '4.5', '90')

  await page.reload()
  await page.goto('./#home')
  await page.locator('.home-project-row').filter({ has: page.getByRole('heading', { name: TITLE, exact: true }) })
    .getByRole('button', { name: '打开', exact: true }).click()
  await saved(page)
  await expect(workbench).toHaveAttribute('data-revision', '4')
  const reopenedMembers = await insideBuilding(page)
  await reopenedMembers.getByRole('button', { name: '桌子', exact: true }).click()
  await itemCoordinates(page, '9.5', '4.5', '90')
  await page.screenshot({ path: info.outputPath('aggregate-building-cold-open.png'), fullPage: true })

  // The attached opening retains its physical and confidentiality fields.
  await insideBuilding(page)
  await reopenedMembers.getByRole('button', { name: `${ROOM} · 墙 1 · 门 1`, exact: true }).click()
  const inspector = page.getByLabel('建筑属性', { exact: true })
  await expect(inspector.getByRole('combobox', { name: '门窗状态', exact: true })).toHaveValue('closed')
  await expect(inspector.getByRole('checkbox', { name: '门通行锁', exact: true })).toBeChecked()
  await expect(inspector.getByRole('checkbox', { name: '秘密开口', exact: true })).toBeChecked()
  await expect(inspector.getByRole('checkbox', { name: '揭示秘密开口', exact: true })).not.toBeChecked()
  await expect(inspector.getByRole('spinbutton', { name: '开口净宽', exact: true })).toHaveValue('1.2')
  await expect(inspector.getByRole('spinbutton', { name: '开口近端偏移', exact: true })).toHaveValue('1')
  await expect(inspector.getByRole('combobox', { name: '开口基准端点', exact: true })).toHaveValue('vertex-0')
  await insideBuilding(page)
  await reopenedMembers.getByRole('button', { name: NOTE, exact: true }).click()
  await expect(inspector.getByRole('textbox', { name: '编辑注记内容', exact: true })).toHaveValue(NOTE)
  await expect(inspector.getByRole('combobox', { name: '注记可见性', exact: true })).toHaveValue('gm')
  await expect(inspector.getByRole('combobox', { name: '注记附着对象', exact: true })).toHaveValue('item')
  await insideBuilding(page)
  await reopenedMembers.getByRole('button', { name: '道路 · 宽 0.4 m', exact: true }).click()
  await expect(page.getByRole('spinbutton', { name: '对象通路净宽', exact: true })).toHaveValue('0.4')
  await expect(page.getByRole('listbox', { name: '对象道路支撑', exact: true })).toHaveValues(['room:room'])
  await page.getByText('精确坐标 · 道路中心线', { exact: true }).click()
  await expect(page.getByRole('textbox', { name: '室外对象坐标', exact: true })).toHaveValue('7000, 4500\n7000, 7500')
  await openSceneObjects(page)
  await page.locator('[data-entity-id="other"]').click()
  await itemCoordinates(page, '16', '16', '0')
  await expect(workbench).toHaveAttribute('data-revision', '4')
  expect(errors).toEqual([])
})
