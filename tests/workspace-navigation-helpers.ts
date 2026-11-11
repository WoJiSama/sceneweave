import { expect, type Locator, type Page } from '@playwright/test'

export type WorkspaceModule = '场景' | '生成' | '地形' | '建筑' | '素材与布景' | '素材' | '氛围' | 'AI' | '历史'

type GenerationTask = '室内布局' | '森林与营地' | '火山' | '混合场景' | '自然地形' | '组合地貌' | '区域地图'
type TerrainTask = '绘制地形' | '修改地形' | '布置植被' | '局部重生成'
type BuildingTask = '绘制房间' | '文字与线索' | '固定玩家遮罩' | '建筑组' | '拆分与组合结构'
type OutdoorTask = '地形与高程' | '用途 / 危险区域' | '道路' | '台阶 / 坡道' | '可控散布'
type SceneObjectCategory = '全部' | '物件与装饰' | '组合' | '结构' | '顶点与边缘'

/** Direct module navigation opens the left content pane without changing the active canvas tool. */
export async function openWorkspaceModule(page: Page, name: WorkspaceModule): Promise<Locator> {
  const label = name === '素材' ? '素材与布景' : name
  const choice = page.getByTestId('workspace-module-navigation').getByRole('button', { name: label, exact: true })
  await choice.click()
  await expect(choice).toHaveAttribute('aria-current', 'page')
  const panel = page.getByTestId('workspace-resources')
  await expect(panel).toHaveAttribute('data-open', 'true')
  return panel
}

async function openDetails(details: Locator): Promise<void> {
  if (await details.getAttribute('open') === null) await details.locator('summary').click()
}

export async function openGenerationTask(page: Page, task: GenerationTask): Promise<void> {
  const panel = await openWorkspaceModule(page, '生成')
  const choice = panel.getByRole('group', { name: '生成场景类型', exact: true }).getByRole('button', { name: new RegExp(`^${task}`) })
  await choice.click()
  await expect(choice).toHaveAttribute('aria-pressed', 'true')
}

export async function openGenerationSettings(page: Page): Promise<void> {
  await openDetails(page.getByTestId('workspace-resources').locator('details.workspace-generation-settings'))
}

export async function openTerrainTask(page: Page, task: TerrainTask): Promise<void> {
  const panel = await openWorkspaceModule(page, '地形')
  const choice = panel.getByRole('group', { name: '地形任务', exact: true, includeHidden: true }).getByRole('button', { name: new RegExp(`^${task}`), includeHidden: true })
  await choice.click()
  await expect(choice).toHaveAttribute('aria-pressed', 'true')
  if (task === '绘制地形') await panel.getByRole('group', { name: '室外任务', exact: true }).getByRole('button', { name: /^地形与高程/ }).click()
}

/** Current two-pane layout: dismiss only narrow-screen drawers through their native close buttons. */
export async function closeWorkspaceDrawers(page: Page): Promise<void> {
  if (await page.getByTestId('workspace-layout').getAttribute('data-narrow') !== 'true') return
  for (const [id, label] of [['resources', '内容面板'], ['inspector', '当前详情']] as const) {
    const panel = page.getByTestId(`workspace-${id}`)
    if (await panel.getAttribute('data-open') !== 'true') continue
    await panel.getByRole('button', { name: `关闭${label}`, exact: true }).click()
    await expect(panel).toHaveAttribute('data-open', 'false')
    await expect(panel.locator(':focus')).toHaveCount(0)
    await expect(page.locator(':focus')).toBeVisible()
  }
}

/** The Scene module owns every object category and one search field. */
export async function openSceneObjects(page: Page, category: SceneObjectCategory = '全部'): Promise<Locator> {
  const panel = await openWorkspaceModule(page, '场景')
  await panel.getByRole('group', { name: '场景对象分类', exact: true }).getByRole('button', { name: category, exact: true }).click()
  return panel
}

export async function openBuildingTask(page: Page, task: BuildingTask = '绘制房间'): Promise<Locator> {
  if (task === '文字与线索' || task === '固定玩家遮罩') {
    await closeWorkspaceDrawers(page)
    await page.getByRole('toolbar', { name: '画布工具', exact: true }).getByRole('button', { name: task === '文字与线索' ? '工具：注记' : '工具：遮罩', exact: true }).click()
  } else {
    const panel = await openWorkspaceModule(page, '建筑')
    await panel.getByRole('group', { name: '建筑任务', exact: true }).getByRole('button', { name: new RegExp(`^${task}`) }).click()
  }
  const label = { 绘制房间: '房间参数', 文字与线索: '文字与线索', 固定玩家遮罩: '固定玩家遮罩', 建筑组: '建筑组', 拆分与组合结构: '组合结构' }[task]
  const parameters = page.getByTestId('workspace-inspector').getByRole('region', { name: label, exact: true })
  await expect(parameters).toBeVisible()
  return parameters
}

export async function openOutdoorTask(page: Page, task: OutdoorTask = '地形与高程'): Promise<Locator> {
  await openTerrainTask(page, '绘制地形')
  if (task !== '地形与高程') {
    const panel = await openWorkspaceModule(page, '地形')
    await panel.getByRole('group', { name: '室外任务', exact: true }).getByRole('button', { name: new RegExp(`^${task}`) }).click()
  }
  const parameters = page.getByTestId('workspace-inspector').getByRole('region', { name: `${task}参数`, exact: true })
  await expect(parameters).toBeVisible()
  return parameters
}

export async function openSceneSettings(page: Page): Promise<Locator> {
  const panel = await openWorkspaceModule(page, '场景')
  await panel.getByRole('button', { name: '场景设置', exact: true }).click()
  const settings = page.getByTestId('workspace-inspector').getByRole('region', { name: '场景设置', exact: true }).and(page.locator('.workspace-project-tools'))
  await expect(settings).toBeVisible()
  return settings
}

export async function openVisualTask(page: Page, task: '边界' | '铺装' | '背景' | '环境' | '灯光' | '雾' | '滤镜' = '边界'): Promise<Locator> {
  const panel = await openWorkspaceModule(page, '氛围')
  await panel.getByRole('navigation', { name: '视觉工具', exact: true }).getByRole('button', { name: task, exact: true }).click()
  const parameters = page.getByTestId('workspace-inspector').getByRole('region', { name: '外观与氛围参数', exact: true })
  await expect(parameters).toBeVisible()
  return parameters
}

export async function openSamples(page: Page): Promise<void> {
  const menu = page.locator('details.workspace-file-menu')
  await openDetails(menu)
  await menu.getByRole('button', { name: '从样板开始', exact: true }).click()
  if (await menu.getAttribute('open') !== null) await menu.locator('summary').click()
  const panel = page.getByTestId('workspace-inspector')
  await expect(panel).toHaveAttribute('data-open', 'true')
  await openDetails(panel.getByRole('region', { name: '场景样板', exact: true }).locator('details'))
}
