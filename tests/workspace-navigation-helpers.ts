import { expect, type Locator, type Page } from '@playwright/test'

export type WorkspaceModule = '场景' | '素材' | '建筑' | '地形' | '氛围' | '生成' | 'AI' | '历史'

type GenerationTask = '室内布局' | '森林与营地' | '火山' | '自然地形' | '组合地貌' | '区域地图'
type TerrainTask = '绘制地形' | '修改地形' | '布置植被' | '局部重生成'

/** Direct module navigation opens the left content pane without changing the active canvas tool. */
export async function openWorkspaceModule(page: Page, name: WorkspaceModule): Promise<Locator> {
  const choice = page.getByTestId('workspace-module-navigation').getByRole('button', { name, exact: true })
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

export async function openSamples(page: Page): Promise<void> {
  const menu = page.locator('details.workspace-file-menu')
  await openDetails(menu)
  await menu.getByRole('button', { name: '从样板开始', exact: true }).click()
  if (await menu.getAttribute('open') !== null) await menu.locator('summary').click()
  const panel = page.getByTestId('workspace-inspector')
  await expect(panel).toHaveAttribute('data-open', 'true')
  await openDetails(panel.getByRole('region', { name: '场景样板', exact: true }).locator('details'))
}
