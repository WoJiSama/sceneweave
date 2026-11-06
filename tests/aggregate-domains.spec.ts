import { expect, test, type Locator, type Page } from '@playwright/test'
import { createServer } from 'vite'
import { openTerrainTask } from './workspace-navigation-helpers'

const NATURAL_TITLE = '自然组整体操作开发自检'
const STRUCTURE_TITLE = '组拆合复制开发自检'
const NATURAL_NOTE = '自然组主持人线索'
const STRUCTURE_NOTE = '复制保留的主持人注记'

async function saved(page: Page) {
  await expect(page.locator('.asset-busy')).toHaveCount(0, { timeout: 30000 })
  await expect(page.locator('.asset-save')).toHaveText('本地已保存', { timeout: 30000 })
}

async function openDetails(details: Locator) {
  if (await details.getAttribute('open') === null) await details.locator('summary').first().click()
}

async function naturalTools(page: Page) {
  await openTerrainTask(page, '绘制地形')
  const tools = page.getByLabel('自然组工具', { exact: true })
  await openDetails(tools)
  await expect(tools).toBeVisible()
  return tools
}

async function structureTools(page: Page) {
  await page.getByRole('tab', { name: '建筑', exact: true }).click()
  const tools = page.getByLabel('组结构工具', { exact: true })
  await openDetails(tools)
  await expect(tools).toBeVisible()
  return tools
}

async function naturalMembers(page: Page) {
  const tools = await naturalTools(page)
  const members = tools.getByLabel('自然组内部对象', { exact: true })
  if (!await members.isVisible()) await tools.getByText('进入内部', { exact: true }).click()
  return members
}

async function structureMembers(page: Page) {
  const tools = await structureTools(page)
  const members = tools.getByLabel('结构组内部对象', { exact: true })
  if (!await members.isVisible()) await tools.getByText('进入成员与子组', { exact: true }).click()
  return members
}

async function number(scope: Locator, name: string, value: string) {
  const field = scope.getByRole('spinbutton', { name, exact: true })
  await field.fill(value)
  await field.press('Enter')
  await expect(field).toHaveValue(value)
}

async function itemCoordinates(page: Page, x: string, y: string, rotation = '0') {
  await expect(page.getByRole('heading', { name: '物件属性', exact: true })).toBeVisible()
  await expect(page.getByRole('spinbutton', { name: '物件 X', exact: true })).toHaveValue(x)
  await expect(page.getByRole('spinbutton', { name: '物件 Y', exact: true })).toHaveValue(y)
  await expect(page.getByRole('spinbutton', { name: '物件旋转', exact: true })).toHaveValue(rotation)
}

async function adopt(page: Page) {
  const review = page.getByRole('region', { name: '候选审阅', exact: true })
  await expect(review).toBeVisible()
  await review.getByLabel('确认完整影响范围', { exact: true }).check()
  await review.getByRole('button', { name: '采用结构修改', exact: true }).click()
  await saved(page)
}

async function cancel(page: Page) {
  const review = page.getByRole('region', { name: '候选审阅', exact: true })
  await review.getByRole('button', { name: '取消结构预览', exact: true }).click()
  await expect(review).toHaveCount(0)
}

async function importOrdinaryFile(page: Page, bytes: Uint8Array, name: string) {
  await page.goto('./#home')
  const chooser = page.waitForEvent('filechooser')
  await page.getByTestId('workspace-home').getByRole('button', { name: '打开工程文件', exact: true }).click()
  await (await chooser).setFiles({ name, mimeType: 'application/octet-stream', buffer: Buffer.from(bytes) })
  await expect(page.getByTestId('outdoor-workbench')).toBeVisible()
  await saved(page)
}

async function reopen(page: Page, title: string) {
  await page.reload()
  await page.goto('./#home')
  await page.locator('.home-project-row').filter({ has: page.getByRole('heading', { name: title, exact: true }) })
    .getByRole('button', { name: '打开', exact: true }).click()
  await saved(page)
}

/** SSR prepares a normal complete-project package only. All browser changes
 * below use production UI, ordinary preview/adoption and repository saves.
 */
async function fixtureFile(kind: 'natural' | 'structure'): Promise<Uint8Array> {
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' })
  try {
    const { fixture, runtime, validation } = await vite.ssrLoadModule('/src/application/workspace/test-fixtures.ts')
    const { createCompositionContent } = await vite.ssrLoadModule('/src/shared/appearance/graph.ts')
    const { exportProject } = await vite.ssrLoadModule('/src/shared/project/file.ts')
    const source = fixture(), scene = source.project.document, floorId = 'blank-floor', layerId = scene.entityLayers.item
    scene.units.display = 'm'
    scene.props.other.appearance.symbol = 'crate'
    if (kind === 'natural') {
      scene.title = NATURAL_TITLE
      scene.terrainAreas.ground = { id: 'ground', floorId, editLocked: false, visibility: 'public',
        boundaryMm: [{ x: 3000, y: 3000 }, { x: 13000, y: 3000 }, { x: 13000, y: 13000 }, { x: 3000, y: 13000 }]
          .map((positionMm, index) => ({ id: `ground-p${index}`, segmentId: `ground-s${index}`, positionMm })),
        groundElevationMm: 0, coveragePriority: 1, surfaceStyle: null, blocksMovement: false, blocksSight: false, movementCostMultiplier: 1 }
      scene.props.item.positionMm = { x: 6000, y: 6000 }
      scene.props.item.supportRef = { kind: 'terrainArea', id: 'ground' }
      scene.props.other.positionMm = { x: 18000, y: 18000 }
      scene.paths.road = { id: 'road', floorId, editLocked: false, visibility: 'public',
        centerlineMm: [{ x: 5000, y: 9000 }, { x: 10000, y: 9000 }], widthMm: 400,
        supportRefs: [{ kind: 'terrainArea', id: 'ground' }], surfaceStyle: null, movementCostMultiplier: 1, renderOrder: 0 }
      scene.notes.clue = { id: 'clue', floorId, editLocked: false, kind: 'note', text: NATURAL_NOTE, visibility: 'gm',
        anchor: { type: 'entity', entityKind: 'prop', entityId: 'item' } }
      for (const id of ['ground', 'road', 'clue']) scene.entityLayers[id] = layerId
    } else {
      scene.title = STRUCTURE_TITLE
      scene.notes.clue = { id: 'clue', floorId, editLocked: false, kind: 'note', text: STRUCTURE_NOTE, visibility: 'gm',
        anchor: { type: 'entity', entityKind: 'prop', entityId: 'item' } }
      scene.entityLayers.clue = layerId
      scene.aggregateCoordinates = { encoding: 'world', groups: { original: { id: 'original', floorId, parentId: null,
        frame: { translationMm: { x: 5000, y: 5000 }, quarterTurns: 1 }, editLocked: false,
        members: [{ kind: 'prop', id: 'item' }, { kind: 'prop', id: 'other' }, { kind: 'note', id: 'clue' }] } } }
    }
    Object.assign(source.project, createCompositionContent(scene, runtime))
    return await exportProject(source, validation)
  } finally { await vite.close() }
}

test('create and transform a natural group through production preview, undo and saved cold open', async ({ page }, info) => {
  test.setTimeout(150000)
  page.setDefaultTimeout(15000)
  const bytes = await fixtureFile('natural'), errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await importOrdinaryFile(page, bytes, 'aggregate-natural.sceneweave')
  const workbench = page.getByTestId('outdoor-workbench'), review = page.getByRole('region', { name: '候选审阅', exact: true })
  await expect(workbench).toHaveAttribute('data-revision', '0')
  const tools = await naturalTools(page)
  await tools.getByRole('button', { name: '创建自然组', exact: true }).click()
  await expect(review).toBeVisible()
  await expect(review.getByLabel('关联对象', { exact: true })).toContainText(NATURAL_NOTE)
  await expect(review.getByLabel('关联对象', { exact: true })).not.toContainText('木箱')
  await expect(review.getByRole('button', { name: '采用结构修改', exact: true })).toBeDisabled()
  await page.screenshot({ path: info.outputPath('aggregate-natural-create-preview.png'), fullPage: true })
  await adopt(page)
  await expect(workbench).toHaveAttribute('data-revision', '1')
  const members = await naturalMembers(page)
  await expect(members.getByRole('button', { name: '木箱', exact: true })).toHaveCount(0)
  await members.getByRole('button', { name: '桌子', exact: true }).click()
  await itemCoordinates(page, '6', '6')

  const prepareTransform = async () => {
    const current = await naturalTools(page)
    await number(current, '自然组偏移 X', '1')
    await number(current, '自然组偏移 Y', '0')
    await current.getByRole('combobox', { name: '自然组旋转', exact: true }).selectOption('1')
    await number(current, '自然组旋转支点 X', '8')
    await number(current, '自然组旋转支点 Y', '8')
    await current.getByRole('button', { name: '预览自然组变换', exact: true }).click()
    await expect(review).toBeVisible()
    await expect(review).toContainText('自然组整体变换')
  }
  await prepareTransform()
  await expect(workbench).toHaveAttribute('data-revision', '1')
  await page.screenshot({ path: info.outputPath('aggregate-natural-transform-preview.png'), fullPage: true })
  await cancel(page)
  await expect(workbench).toHaveAttribute('data-revision', '1')
  await itemCoordinates(page, '6', '6')
  await prepareTransform()
  await adopt(page)
  await expect(workbench).toHaveAttribute('data-revision', '2')
  await itemCoordinates(page, '11', '6', '90')
  await page.getByRole('button', { name: '撤销编辑', exact: true }).click()
  await saved(page)
  await expect(workbench).toHaveAttribute('data-revision', '3')
  await itemCoordinates(page, '6', '6')
  await page.getByRole('button', { name: '重做编辑', exact: true }).click()
  await saved(page)
  await expect(workbench).toHaveAttribute('data-revision', '4')
  await itemCoordinates(page, '11', '6', '90')

  await reopen(page, NATURAL_TITLE)
  await expect(workbench).toHaveAttribute('data-revision', '4')
  const reopened = await naturalMembers(page)
  await reopened.getByRole('button', { name: '桌子', exact: true }).click()
  await itemCoordinates(page, '11', '6', '90')
  await reopened.getByRole('button', { name: NATURAL_NOTE, exact: true }).click()
  const inspector = page.getByLabel('建筑属性', { exact: true })
  await expect(inspector.getByRole('textbox', { name: '编辑注记内容', exact: true })).toHaveValue(NATURAL_NOTE)
  await expect(inspector.getByRole('combobox', { name: '注记可见性', exact: true })).toHaveValue('gm')
  await expect(inspector.getByRole('combobox', { name: '注记附着对象', exact: true })).toHaveValue('item')
  await reopened.getByRole('button', { name: '道路 · 宽 0.4 m', exact: true }).click()
  await expect(page.getByRole('listbox', { name: '对象道路支撑', exact: true })).toHaveValues(['terrainArea:ground'])
  await page.getByText('精确坐标 · 道路中心线', { exact: true }).click()
  await expect(page.getByRole('textbox', { name: '室外对象坐标', exact: true })).toHaveValue('8000, 5000\n8000, 10000')
  await page.screenshot({ path: info.outputPath('aggregate-natural-cold-open.png'), fullPage: true })
  await page.getByRole('tab', { name: '对象', exact: true }).click()
  await page.locator('[data-entity-id="other"]').click()
  await itemCoordinates(page, '18', '18')
  expect(errors).toEqual([])
})

test('split, merge and copy an existing prop and note group using normal production review and cold open', async ({ page }, info) => {
  test.setTimeout(150000)
  page.setDefaultTimeout(15000)
  const bytes = await fixtureFile('structure'), errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await importOrdinaryFile(page, bytes, 'aggregate-structure.sceneweave')
  const workbench = page.getByTestId('outdoor-workbench'), review = page.getByRole('region', { name: '候选审阅', exact: true })
  const tools = await structureTools(page), choices = tools.getByRole('combobox', { name: '结构操作组', exact: true })
  await expect(choices.locator('option')).toHaveCount(1)
  const prepareSplit = async () => {
    await structureTools(page)
    const checkbox = tools.getByRole('checkbox', { name: '拆出 桌子', exact: true })
    if (!await checkbox.isVisible()) await tools.getByText('拆成两组', { exact: true }).click()
    await checkbox.check()
    await tools.getByRole('button', { name: '预览拆分组', exact: true }).click()
    await expect(review).toBeVisible()
  }
  await prepareSplit()
  await expect(workbench).toHaveAttribute('data-revision', '0')
  await page.screenshot({ path: info.outputPath('aggregate-structure-split-preview.png'), fullPage: true })
  await cancel(page)
  await expect(choices.locator('option')).toHaveCount(1)
  await prepareSplit()
  await adopt(page)
  await expect(workbench).toHaveAttribute('data-revision', '1')
  await expect(choices.locator('option')).toHaveCount(2)
  await choices.selectOption({ index: 0 })
  await tools.getByText('合并同级组', { exact: true }).click()
  await tools.getByRole('checkbox', { name: /^合并 / }).check()
  await tools.getByRole('button', { name: '预览合并组', exact: true }).click()
  await adopt(page)
  await expect(workbench).toHaveAttribute('data-revision', '2')
  await expect(choices.locator('option')).toHaveCount(1)
  const originalGroupId = await choices.inputValue()
  const members = await structureMembers(page)
  await members.getByRole('button', { name: '桌子', exact: true }).click()
  await itemCoordinates(page, '4', '4')
  await members.getByRole('button', { name: '木箱', exact: true }).click()
  await itemCoordinates(page, '9', '9')

  const prepareCopy = async () => {
    await structureTools(page)
    const confirmation = tools.getByRole('checkbox', { name: '确认组复制外部引用', exact: true })
    if (!await confirmation.isVisible()) await tools.getByText('复制物件与注记组', { exact: true }).click()
    await number(tools, '组复制偏移 X', '1')
    await number(tools, '组复制偏移 Y', '0')
    await confirmation.uncheck()
    await expect(tools.getByRole('button', { name: '预览复制组', exact: true })).toBeDisabled()
    await confirmation.check()
    await tools.getByRole('button', { name: '预览复制组', exact: true }).click()
    await expect(review).toBeVisible()
  }
  await prepareCopy()
  await expect(workbench).toHaveAttribute('data-revision', '2')
  await page.screenshot({ path: info.outputPath('aggregate-structure-copy-preview.png'), fullPage: true })
  await cancel(page)
  await expect(choices.locator('option')).toHaveCount(1)
  await prepareCopy()
  await adopt(page)
  await expect(workbench).toHaveAttribute('data-revision', '3')
  await expect(choices.locator('option')).toHaveCount(2)
  const copiedGroupId = (await choices.locator('option').evaluateAll(options => options.map(option => (option as HTMLOptionElement).value)))
    .find(id => id !== originalGroupId)!
  expect(copiedGroupId).toBeTruthy()
  await page.getByRole('button', { name: '撤销编辑', exact: true }).click()
  await saved(page)
  await expect(choices.locator('option')).toHaveCount(1)
  await expect(workbench).toHaveAttribute('data-revision', '4')
  await page.getByRole('button', { name: '重做编辑', exact: true }).click()
  await saved(page)
  await expect(choices.locator('option')).toHaveCount(2)
  await expect(workbench).toHaveAttribute('data-revision', '5')

  await reopen(page, STRUCTURE_TITLE)
  await expect(workbench).toHaveAttribute('data-revision', '5')
  const coldTools = await structureTools(page), coldChoices = coldTools.getByRole('combobox', { name: '结构操作组', exact: true })
  await expect(coldChoices.locator('option')).toHaveCount(2)
  await coldChoices.selectOption(copiedGroupId)
  const copied = await structureMembers(page)
  await copied.getByRole('button', { name: '桌子', exact: true }).click()
  await itemCoordinates(page, '5', '4')
  await copied.getByRole('button', { name: '木箱', exact: true }).click()
  await itemCoordinates(page, '10', '9')
  await copied.getByRole('button', { name: STRUCTURE_NOTE, exact: true }).click()
  const inspector = page.getByLabel('建筑属性', { exact: true })
  await expect(inspector.getByRole('textbox', { name: '编辑注记内容', exact: true })).toHaveValue(STRUCTURE_NOTE)
  await expect(inspector.getByRole('combobox', { name: '注记可见性', exact: true })).toHaveValue('gm')
  await expect(inspector.getByRole('combobox', { name: '注记附着对象', exact: true })).not.toHaveValue('item')
  await expect(inspector.getByRole('combobox', { name: '注记附着对象', exact: true }).locator('option:checked')).toHaveText(/^现有附着对象 · /)
  await page.screenshot({ path: info.outputPath('aggregate-structure-cold-open.png'), fullPage: true })
  await coldChoices.selectOption(originalGroupId)
  const original = await structureMembers(page)
  await original.getByRole('button', { name: '桌子', exact: true }).click()
  await itemCoordinates(page, '4', '4')
  await expect(workbench).toHaveAttribute('data-revision', '5')
  expect(errors).toEqual([])
})
