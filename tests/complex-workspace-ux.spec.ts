// Normal production UI and downloaded complete projects; timings are diagnostics,
// including browser-driver overhead, and are not a formal performance benchmark.
import { expect, test, type Page } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { openWorkspaceModule, openTerrainTask, closeWorkspaceDrawers } from './workspace-navigation-helpers'
import { createKeyboardProject, keyboardProjectBackup, keyboardResourceHashes, keyboardWorkspaceSaved, openKeyboardPanel } from './keyboard-ux-helpers'

async function closeDrawers(page: Page) {
  await closeWorkspaceDrawers(page)
}

async function observe(page: Page, label: string, operation: () => Promise<unknown>) {
  await page.evaluate(label => {
    const records: { at: number; busy: string; save: string; generation: string }[] = []
    const started = performance.now()
    const capture = () => {
      const state = { at: performance.now() - started, busy: document.querySelector('.asset-busy')?.textContent?.trim() ?? '', save: document.querySelector('.asset-save')?.textContent?.trim() ?? '', generation: document.querySelector('[aria-label="混合场景候选状态"] strong')?.textContent?.trim() ?? '' }
      const last = records.at(-1)
      if (!last || state.busy !== last.busy || state.save !== last.save || state.generation !== last.generation) records.push(state)
    }
    const observer = new MutationObserver(capture)
    observer.observe(document.body, { childList: true, subtree: true, characterData: true })
    capture()
    Reflect.set(window, '__complexUxObservation', { label, records, started, observer })
  }, label)
  try { await operation() } finally {
    const result = await page.evaluate(() => {
      const value = Reflect.get(window, '__complexUxObservation')
      value.observer.disconnect()
      return { label: value.label, elapsedMs: performance.now() - value.started, records: value.records }
    })
    const previous = observations.get(page) ?? []
    previous.push(result); observations.set(page, previous)
  }
}
const observations = new WeakMap<Page, unknown[]>()
test.afterEach(async ({ page }, info) => {
  await writeFile(info.outputPath('waiting-observations.json'), JSON.stringify({ observations: observations.get(page) ?? [], method: 'DOM state observations and browser-driver elapsed time, not formal performance' }, null, 2))
})

for (const width of [1512, 390]) test(`mixed-map editing, layer movement and waiting feedback at ${width}px`, async ({ page, browser }, info) => {
  test.setTimeout(360000)
  page.setDefaultTimeout(15000)
  await page.setViewportSize({ width, height: width === 390 ? 844 : 982 })
  const errors: string[] = [], requests: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => { if (/\/v1\//.test(request.url())) requests.push(request.url()) })
  await createKeyboardProject(page, `复杂地图原工程 ${width}`)
  const resources = await openWorkspaceModule(page, '生成')
  await resources.getByRole('group', { name: '生成场景类型', exact: true }).getByRole('button', { name: /混合场景/ }).click()
  const mixed = resources.getByRole('region', { name: '混合场景生成', exact: true })
  const mixedCandidate = page.getByTestId('workspace-inspector').getByLabel('混合候选摘要', { exact: true })
  await mixed.getByLabel('混合工程名称', { exact: true }).fill(`林中建筑操作检查 ${width}`)
  await mixed.getByLabel('混合建筑房间数量', { exact: true }).fill('2')
  await observe(page, 'generate mixed map', async () => {
    await mixed.getByRole('button', { name: '预览混合场景', exact: true }).click()
    await expect(mixedCandidate).toBeVisible({ timeout: 90000 })
  })
  await observe(page, 'save generated map', async () => {
    await mixedCandidate.getByRole('button', { name: '保存混合场景为新工程', exact: true }).click()
    await expect(page.locator('.asset-busy')).toContainText('正在保存混合场景并准备打开…')
    await page.screenshot({ path: info.outputPath('00-saving-generated-map.png') })
    await expect(page.locator('.asset-busy')).toHaveCount(0, { timeout: 90000 })
    await keyboardWorkspaceSaved(page)
  })
  await closeDrawers(page)
  const initial = await keyboardProjectBackup(page, info.outputPath('generated.sceneweave'))
  expect(Object.keys(initial.document.rooms)).toHaveLength(2)
  expect(Object.keys(initial.document.terrainAreas).length).toBeGreaterThan(0)
  expect(Object.keys(initial.document.paths).length).toBeGreaterThan(0)
  const furniture = Object.values(initial.document.props).filter(prop => prop.supportRef.kind === 'room')
  expect(furniture.length).toBeGreaterThanOrEqual(2)
  await page.screenshot({ path: info.outputPath('01-mixed-map.png') })

  // Read-only panel switching must retain both kinds of draft and the map.
  await openWorkspaceModule(page, '建筑')
  await resources.getByRole('group', { name: '建筑任务', exact: true }).getByRole('button', { name: /^绘制房间/ }).click()
  await page.getByLabel('房间名称', { exact: true }).fill('跨模块保留的房间草稿')
  for (const module of ['地形', '素材', '建筑'] as const) await openWorkspaceModule(page, module)
  await openKeyboardPanel(page, 'inspector')
  await expect(page.getByLabel('房间名称', { exact: true })).toHaveValue('跨模块保留的房间草稿')
  await page.getByRole('button', { name: '取消建筑草稿', exact: true }).click()
  await openTerrainTask(page, '绘制地形')
  const elevation = page.getByLabel('地形高程', { exact: true })
  await elevation.fill('1.2'); await elevation.press('Tab')
  for (const module of ['建筑', '氛围', '地形'] as const) await openWorkspaceModule(page, module)
  await openKeyboardPanel(page, 'inspector')
  await expect(elevation).toHaveValue('1.2')
  await page.getByRole('button', { name: '取消室外草稿', exact: true }).click()
  await closeDrawers(page)
  expect((await keyboardProjectBackup(page, info.outputPath('after-browsing.sceneweave'))).hashes).toEqual(initial.hashes)

  // Place the same fixed furniture on its explicit original room support.
  await openWorkspaceModule(page, '素材')
  const prop = furniture[0], definition = initial.document.propDefinitions[prop.definitionRef!.id]
  const library = page.getByRole('region', { name: '组件素材库', exact: true })
  await library.getByLabel('搜索组件素材', { exact: true }).fill(definition.name)
  await library.getByRole('button', { name: `放置组件 ${definition.name}`, exact: true }).click()
  const inspector = await openKeyboardPanel(page, 'inspector')
  await inspector.getByLabel('放置表面', { exact: true }).selectOption(`${prop.supportRef.kind}:${prop.supportRef.id}`)
  for (const [axis, value] of [['X', prop.positionMm.x], ['Y', prop.positionMm.y]] as const) {
    const field = inspector.getByLabel(`放置 ${axis}`, { exact: true })
    await field.fill(String(value / 1000)); await field.press('Tab')
  }
  await observe(page, 'place furniture and save', async () => {
    await inspector.getByRole('button', { name: '在此放置', exact: true }).click()
    await closeDrawers(page)
    await page.getByRole('button', { name: '选择地图对象', exact: true }).click()
    await keyboardWorkspaceSaved(page)
  })
  await closeDrawers(page)
  const placed = await keyboardProjectBackup(page, info.outputPath('placed.sceneweave'))
  expect(Object.keys(placed.document.props)).toHaveLength(Object.keys(initial.document.props).length + 1)
  expect(keyboardResourceHashes(placed.hashes)).toEqual(keyboardResourceHashes(initial.hashes))

  let navigation = await openKeyboardPanel(page, 'navigation')
  await navigation.getByRole('button', { name: '新建用户图层', exact: true }).click()
  await navigation.getByLabel('新图层名称', { exact: true }).fill('手工家具整理')
  await observe(page, 'create layer and save', async () => {
    await navigation.getByRole('button', { name: '创建图层', exact: true }).click()
    await expect(navigation.getByRole('button', { name: '查看图层 手工家具整理', exact: true })).toBeVisible({ timeout: 30000 })
    await keyboardWorkspaceSaved(page)
  })
  await closeDrawers(page)
  const beforeMove = await keyboardProjectBackup(page, info.outputPath('before-move.sceneweave'))
  const layer = Object.values(beforeMove.document.userLayers).find(layer => layer.name === '手工家具整理')!
  expect(layer).toBeTruthy()
  const ids = furniture.slice(0, 2).map(prop => prop.id)
  for (const [index, id] of ids.entries()) {
    navigation = await openKeyboardPanel(page, 'navigation')
    await navigation.getByRole('group', { name: '场景对象分类', exact: true }).getByRole('button', { name: '物件与装饰', exact: true }).click()
    await navigation.getByLabel('搜索场景对象', { exact: true }).fill(id)
    await navigation.locator(`[data-entity-id="${id}"]`).click({ modifiers: index ? ['Shift'] : [] })
    if (width === 390) await expect(page.getByTestId('workspace-inspector')).toHaveAttribute('data-open', 'true')
  }
  await expect((await openKeyboardPanel(page, 'inspector')).getByRole('heading', { name: '已选择 2 个对象', exact: true })).toBeVisible()
  await page.screenshot({ path: info.outputPath('02-multi-selection.png') })
  const previewMove = async () => {
    navigation = await openKeyboardPanel(page, 'navigation')
    await navigation.getByRole('button', { name: '移动所选到图层 · 2', exact: true }).click()
    await navigation.getByLabel('图层操作目标', { exact: true }).selectOption(layer.id)
    await navigation.getByRole('button', { name: '预览图层修改', exact: true }).click()
    await openKeyboardPanel(page, 'inspector')
    await expect(page.getByTestId('workspace-inspector').getByRole('region', { name: '候选审阅', exact: true })).toBeVisible()
    await expect(page.locator('.asset-map-wrap')).toHaveAttribute('aria-busy', 'false', { timeout: 30000 })
  }
  await previewMove()
  await page.getByRole('button', { name: '取消图层预览', exact: true }).click()
  expect((await keyboardProjectBackup(page, info.outputPath('cancelled-move.sceneweave'))).hashes).toEqual(beforeMove.hashes)
  await previewMove()
  await page.screenshot({ path: info.outputPath('03-layer-preview.png') })
  await observe(page, 'adopt layer move and save', async () => {
    await page.getByRole('button', { name: '采用图层修改', exact: true }).click()
    await keyboardWorkspaceSaved(page)
  })
  const moved = await keyboardProjectBackup(page, info.outputPath('moved.sceneweave'))
  for (const id of ids) expect(moved.document.entityLayers[id]).toBe(layer.id)
  expect(moved.document.props).toEqual(beforeMove.document.props)
  expect(moved.document.terrainAreas).toEqual(beforeMove.document.terrainAreas)
  expect(moved.document.rooms).toEqual(beforeMove.document.rooms)
  await page.getByRole('button', { name: '撤销编辑', exact: true }).click(); await keyboardWorkspaceSaved(page)
  expect((await keyboardProjectBackup(page, info.outputPath('undone.sceneweave'))).document.entityLayers).toEqual(beforeMove.document.entityLayers)
  await page.getByRole('button', { name: '重做编辑', exact: true }).click(); await keyboardWorkspaceSaved(page)
  const redone = await keyboardProjectBackup(page, info.outputPath('redone.sceneweave'))
  expect(redone.document.entityLayers).toEqual(moved.document.entityLayers)
  await observe(page, 'read history', async () => {
    navigation = await openWorkspaceModule(page, '历史')
    await navigation.getByRole('button', { name: /^查看版本与恢复详情 · r\d+$/ }).click()
    const history = page.getByTestId('workspace-inspector').getByRole('region', { name: '历史详情', exact: true })
    await expect(history.getByRole('button', { name: /^上一个版本(?: · r\d+)?$/ })).toBeVisible({ timeout: 30000 })
  })
  await page.screenshot({ path: info.outputPath('04-history.png') })
  await closeDrawers(page)
  // Navigation replaces the document; it cannot share the old DOM observer.
  const reloadStarted = Date.now()
  await page.reload()
  await page.getByRole('button', { name: '回到首页', exact: true }).click()
  await page.getByTestId('workspace-home').locator(`[data-project-key="native:${redone.document.sceneId}"]`).getByRole('button', { name: '打开', exact: true }).click()
  await keyboardWorkspaceSaved(page)
  observations.set(page, [...(observations.get(page) ?? []), { label: 'reload saved project', elapsedMs: Date.now() - reloadStarted, method: 'driver elapsed time across navigation; no continuous DOM observation' }])
  expect((await keyboardProjectBackup(page, info.outputPath('cold.sceneweave'))).hashes).toEqual(redone.hashes)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
  expect(errors).toEqual([]); expect(requests).toEqual([])
  await writeFile(info.outputPath('complex-ux-facts.json'), JSON.stringify({ width, browser: browser.version(), errors, requests, rooms: Object.keys(initial.document.rooms).length, props: Object.keys(initial.document.props).length, terrain: Object.keys(initial.document.terrainAreas).length, paths: Object.keys(initial.document.paths).length, selected: ids.length, cancelledMoveUnchanged: true, coldHashUnchanged: true, observations: observations.get(page), method: 'normal production UI; DOM state observations and driver elapsed time only, not formal performance' }, null, 2))
})
