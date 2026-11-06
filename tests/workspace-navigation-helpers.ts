import { expect, type Locator, type Page } from '@playwright/test'

type GenerationTask = '室内布局' | '森林与营地' | '火山' | '自然地形' | '组合地貌' | '区域地图'
type TerrainTask = '绘制地形' | '修改地形' | '布置植被' | '局部重生成'

async function openResourceTab(page: Page, name: string): Promise<Locator> {
  const panel = page.getByTestId('workspace-resources')
  await panel.getByRole('tab', { name, exact: true }).click()
  return panel
}

async function openDetails(details: Locator): Promise<void> {
  if (await details.getAttribute('open') === null) await details.locator('summary').click()
}

export async function openGenerationTask(page: Page, task: GenerationTask): Promise<void> {
  const panel = await openResourceTab(page, '生成')
  const choice = panel.getByRole('group', { name: '生成场景类型', exact: true }).getByRole('button', { name: new RegExp(`^${task}`) })
  await choice.click()
  await expect(choice).toHaveAttribute('aria-pressed', 'true')
}

export async function openGenerationSettings(page: Page): Promise<void> {
  await openDetails(page.getByTestId('workspace-resources').locator('details.workspace-generation-settings'))
}

export async function openTerrainTask(page: Page, task: TerrainTask): Promise<void> {
  const panel = await openResourceTab(page, '地形')
  const choice = panel.getByRole('group', { name: '地形任务', exact: true }).getByRole('button', { name: new RegExp(`^${task}`) })
  await choice.click()
  await expect(choice).toHaveAttribute('aria-pressed', 'true')
}

export async function openSamples(page: Page): Promise<void> {
  const panel = await openResourceTab(page, '工程')
  await openDetails(panel.locator('details').filter({ has: page.locator('summary').filter({ hasText: /^从样板开始$/ }) }))
}
