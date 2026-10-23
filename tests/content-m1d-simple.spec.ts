import { expect, test, type Page } from '@playwright/test'
import type { WorkspaceV6 } from '../src/editor/v6/workspace'
import type { SceneRepositoryV6 } from '../src/io/v6/storage'

// Bounded feature checks, not the postponed full regression/4K/performance matrix.
type Dev = { workspace: WorkspaceV6; repository: SceneRepositoryV6 }
const home = (page: Page) => page.getByTestId('workspace-home')
const library = (page: Page) => page.getByRole('region', { name: '组件素材库', exact: true })
async function settled(page: Page) {
  await expect(page.getByTestId('outdoor-workbench')).toBeVisible()
  await expect(page.locator('.asset-busy')).toHaveCount(0, { timeout: 30000 })
  await expect(page.locator('.asset-save')).toHaveText('本地已保存', { timeout: 30000 })
  await expect(page.locator('.asset-map-wrap')).toHaveAttribute('aria-busy', 'false', { timeout: 30000 })
}
async function current(page: Page) {
  return page.evaluate(async () => {
    const { workspace, repository } = Reflect.get(window, '__sceneweaveOutdoorDev') as Dev
    const state = workspace.getState(), project = state.project
    if (!project) throw new Error('Expected real UI-created project')
    const saved = await repository.load(project.document.sceneId)
    return { document: structuredClone(project.document), assetCount: Object.keys(project.assets).length,
      persisted: saved ? structuredClone(saved.document) : null, canUndo: state.canUndo }
  })
}
async function blank(page: Page, recipe: string) {
  await page.goto('/#home')
  await home(page).getByRole('button', { name: '新建场景', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '新建空白场景', exact: true })
  await dialog.getByLabel('场景名称', { exact: true }).fill(`M1-D 分步制作 ${recipe}`)
  await dialog.getByRole('button', { name: '创建空白场景', exact: true }).click()
  await expect(dialog).toHaveCount(0); await settled(page)
}
async function adopt(page: Page) {
  const button = page.getByRole('button', { name: /^采用(?:组件修改|结构修改|室外修改|显示设置)$/ })
  await expect(button).toBeVisible({ timeout: 30000 })
  const confirmation = page.getByRole('checkbox', { name: '确认完整影响范围', exact: true })
  if (await confirmation.count()) await confirmation.check()
  await expect(button).toBeEnabled({ timeout: 30000 }); await button.click(); await settled(page)
}

for (const sample of [{ name: '苔石墓园', kind: 'graveyard' }, { name: '灰烬熔脉', kind: 'volcano' }]) {
  test(`content simple: ${sample.name} opens a real editable sample and saves a property edit`, async ({ page }, info) => {
    test.setTimeout(90000)
    await page.goto('/#home')
    await home(page).getByRole('button', { name: sample.name, exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '确认打开室外工程', exact: true })
    await expect(dialog).toBeVisible({ timeout: 30000 })
    await dialog.getByRole('button', { name: '保存并打开副本', exact: true }).click()
    await expect(dialog).toHaveCount(0); await settled(page)
    const before = await current(page)
    expect(before.persisted).toEqual(before.document)
    expect(before.assetCount).toBe(57)
    expect(Object.keys(before.document.prefabInstances)).toHaveLength(sample.kind === 'graveyard' ? 4 : 2)
    if (sample.kind === 'volcano') {
      expect(before.document.terrainAreas['volcano-lava-visual'].blocksMovement).toBe(false)
      expect(before.document.regions['volcano-lava-hazard']).toMatchObject({ kind: 'hazard', blocksMovement: true })
      expect(before.document.terrainConnections['volcano-access-ramp'].kind).toBe('ramp')
    }
    await page.getByRole('tab', { name: '对象', exact: true }).click()
    await page.getByRole('group', { name: '场景对象分类', exact: true }).getByRole('button', { name: '物件', exact: true }).click()
    const id = sample.kind === 'graveyard' ? 'graveyard-tree-west' : 'volcano-refined-rock'
    await page.getByLabel('搜索场景物件', { exact: true }).fill(id)
    await page.locator(`.asset-entity-list [data-entity-id="${id}"]`).click()
    const field = page.getByRole('spinbutton', { name: '物件旋转', exact: true })
    await field.fill('25'); await field.press('Tab'); await settled(page)
    const after = await current(page)
    expect(after.document.props[id].rotationDeg).toBe(25)
    expect(after.document.revision).toBe(before.document.revision + 1)
    expect(after.persisted).toEqual(after.document)
    await page.getByRole('button', { name: '撤销素材编辑', exact: true }).click(); await settled(page)
    expect((await current(page)).document.props[id]).toEqual(before.document.props[id])
    await page.getByRole('button', { name: '返回工程信息', exact: true }).click()
    await info.attach(`${sample.kind}.png`, { body: await page.screenshot(), contentType: 'image/png' })
    await info.attach(`${sample.kind}.json`, { body: JSON.stringify({ method: 'Home review, actual PNG render, normal property edit, native save and undo; DEV observation only.', before, after }), contentType: 'application/json' })
  })
}

test('content simple: supplemental tags and refined comparison leave the original blank unchanged until explicit adoption', async ({ page }, info) => {
  test.setTimeout(90000)
  await blank(page, '目录与精修'); const before = await current(page)
  expect(before.assetCount).toBe(34)
  const lib = library(page)
  await lib.getByRole('button', { name: '内置素材', exact: true }).click()
  await expect(lib.getByRole('button', { name: '刷新素材库', exact: true })).toBeEnabled({ timeout: 30000 })
  await lib.getByLabel('搜索组件素材', { exact: true }).fill('阔叶树冠·精修')
  const row = lib.locator('.catalog-entries article')
  await expect(row).toHaveCount(1)
  await expect(row).toContainText('目录补充：')
  await row.getByRole('button', { name: /^查看素材/ }).click()
  const comparison = lib.getByRole('group', { name: '精修素材与旧版对照', exact: true })
  await expect(comparison).toBeVisible()
  await expect.poll(() => comparison.locator('img').evaluateAll(images => images.length === 2 && images.every(img => (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth > 0))).toBe(true)
  expect(await current(page)).toEqual(before)
  await info.attach('refined-comparison.png', { body: await page.screenshot(), contentType: 'image/png' })
  await row.getByRole('checkbox').check()
  await lib.getByRole('button', { name: '预览采用到本工程', exact: true }).click()
  await expect(page.getByRole('button', { name: '取消组件预览', exact: true })).toBeVisible()
  expect(await current(page)).toEqual(before)
  await adopt(page)
  const after = await current(page)
  expect(after.assetCount).toBe(35)
  expect(after.document.props).toEqual(before.document.props)
  expect(Object.values(after.document.propDefinitions).filter(item => item.catalogId.endsWith('tree-broadleaf.refined'))).toHaveLength(1)
  await lib.getByRole('button', { name: '放置组件 阔叶树冠·精修', exact: true }).click()
  await page.getByRole('button', { name: '在此放置', exact: true }).click()
  await expect.poll(async () => Object.keys((await current(page)).document.props).length).toBe(1)
  await settled(page)
  const placed = await current(page), id = Object.keys(placed.document.props)[0]
  const choice = page.getByLabel('物件外观变体', { exact: true })
  await choice.selectOption('b2-p-06')
  await expect(page.locator('.asset-inspector')).toContainText('图片比例可能变化')
  await page.getByRole('button', { name: '回到首页', exact: true }).click()
  await expect(home(page)).toBeHidden()
  await expect(page.getByRole('button', { name: '取消换图草稿', exact: true })).toBeVisible()
  expect((await current(page)).document).toEqual(placed.document)
  await page.getByRole('button', { name: '预览外观替换', exact: true }).click()
  await expect(page.getByRole('button', { name: '取消组件预览', exact: true })).toBeVisible()
  expect((await current(page)).document).toEqual(placed.document)
  await adopt(page)
  const replaced = await current(page)
  expect(replaced.document.props[id].definitionRef?.id).toBe('b2-p-06')
  for (const key of ['footprintMm', 'footprintOffsetMm', 'visualBoundsMm', 'positionMm', 'rotationDeg', 'blocksMovement', 'blocksSight', 'supportRef', 'visibility'] as const) expect(replaced.document.props[id][key]).toEqual(placed.document.props[id][key])
  await info.attach('appearance-swap.json', { body: JSON.stringify({ method: 'Real selected prop: source/mapping warning, pending form guards Home, preview has no mutation, ordinary adoption preserves physical and privacy fields.', placed, replaced }), contentType: 'application/json' })
  await info.attach('curation-and-adoption.json', { body: JSON.stringify({ method: 'Actual fixed old/refined PNG comparison and explicit preview/adopt; no scene mutation while browsing.', before, after }), contentType: 'application/json' })
})

for (const recipe of ['scn-01', 'scn-04'] as const) test(`M1-D simple: ${recipe} ordinary staged UI authoring from blank`, async ({ page }, info) => {
  test.setTimeout(240000)
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await blank(page, recipe)
  const initial = await current(page)
  expect(Object.keys(initial.document.rooms)).toHaveLength(0)
  expect(Object.keys(initial.document.terrainAreas)).toHaveLength(0)
  await page.getByTestId('workspace-resources').getByRole('tab', { name: '工程', exact: true }).click()
  await page.locator('.workspace-authoring-details > summary').click()
  const guide = page.getByRole('region', { name: '场景分步制作', exact: true })
  await guide.getByLabel('制作基线', { exact: true }).selectOption(recipe)
  if (recipe === 'scn-01') {
    await guide.getByRole('button', { name: '预览采用缺少的室内素材', exact: true }).click()
    await adopt(page)
    expect((await current(page)).assetCount).toBe(41)
  }
  const stages: { id: string | null; revision: number }[] = []
  for (let step = 0; step < 35; step++) {
    const ready = guide.locator('li[data-status="ready"]')
    if (!await ready.count()) break
    const id = await ready.getAttribute('data-authoring-stage'), before = await current(page)
    console.log(`${recipe}: preview ${id} at r${before.document.revision}`)
    await ready.getByRole('button', { name: /^预览本步/ }).click()
    await adopt(page)
    await expect(guide.locator(`li[data-authoring-stage="${id}"]`)).toHaveAttribute('data-status', 'complete')
    const after = await current(page)
    expect(after.document.revision).toBe(before.document.revision + 1)
    stages.push({ id, revision: after.document.revision })
  }
  await expect(guide.locator('li:not([data-status="complete"])')).toHaveCount(0)
  const result = await current(page)
  expect(result.persisted).toEqual(result.document)
  expect(stages.length).toBeGreaterThan(10)
  if (recipe === 'scn-01') {
    expect(Object.keys(result.document.rooms)).toHaveLength(7)
    expect(Object.values(result.document.openings).filter(item => item.kind === 'door')).toHaveLength(9)
    expect(Object.values(result.document.openings).filter(item => item.kind === 'window')).toHaveLength(3)
    expect(Object.keys(result.document.props)).toHaveLength(19)
  } else {
    expect(Object.keys(result.document.rooms)).toHaveLength(2)
    expect(Object.keys(result.document.scatterGroups)).toHaveLength(3)
    expect(Object.keys(result.document.prefabInstances)).toHaveLength(2)
  }
  await info.attach(`${recipe}.png`, { body: await page.screenshot(), contentType: 'image/png' })
  await info.attach(`${recipe}.json`, { body: JSON.stringify({ method: 'Actual Home blank, ordinary finite preview/explicit dependency confirmation/adopt/native save for every guide stage. Not unassisted manual SCN acceptance or 4K/full regression.', initial, stages, result, errors }), contentType: 'application/json' })
  expect(errors).toEqual([])
})
