import { expect, test } from '@playwright/test'
import { createKeyboardProject, keyboardProjectBackup, keyboardWorkspaceSaved } from './keyboard-ux-helpers'
import { openGenerationTask } from './workspace-navigation-helpers'

for (const domain of ['forest', 'mixed'] as const) test(`${domain} copse choice saves exact finite regions and cold reopens`, async ({ page }, info) => {
  test.setTimeout(180_000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await createKeyboardProject(page, `${domain} distribution original`)
  const original = await keyboardProjectBackup(page, info.outputPath('original.sceneweave'))
  await openGenerationTask(page, domain === 'forest' ? '森林与营地' : '混合场景')
  const panel = page.getByTestId('workspace-resources').getByRole('region', { name: domain === 'forest' ? '森林与营地生成' : '混合场景生成', exact: true, includeHidden: true })
  const title = `${domain} copse delivery`
  await panel.getByLabel(domain === 'forest' ? '森林工程名称' : '混合工程名称', { exact: true }).fill(title)
  const choice = panel.getByLabel(domain === 'forest' ? '森林植被分布' : '混合森林植被分布', { exact: true })
  await expect(choice).toHaveValue('uniform')
  await choice.selectOption('copses')
  if (domain === 'mixed') await panel.getByLabel('混合森林密度倍率', { exact: true }).fill('0.5')
  await panel.getByRole('button', { name: domain === 'forest' ? '预览森林与营地' : '预览混合场景', exact: true }).click()
  const candidate = page.getByTestId('workspace-inspector').getByLabel(domain === 'forest' ? '森林与营地候选摘要' : '混合候选摘要', { exact: true })
  await expect(candidate).toBeVisible({ timeout: 30000 })
  await candidate.getByRole('button', { name: domain === 'forest' ? '保存为新工程' : '保存混合场景为新工程', exact: true }).click()
  await keyboardWorkspaceSaved(page)
  const adopted = await keyboardProjectBackup(page, info.outputPath('adopted.sceneweave'))
  expect(adopted.document.sceneId).not.toBe(original.document.sceneId)
  const recipe = Object.values(adopted.document.generation!.legacy!.recipes).find(row => row.algorithmId === 'forest-layout')!
  if (!recipe || !('zones' in recipe.parameters)) throw new Error('Expected the saved forest recipe')
  const zones = recipe.parameters.zones as { boundaryMm: { x: number; y: number }[]; vegetation: { role: string }[] }[]
  expect(zones).toHaveLength(4)
  expect(zones.every(zone => zone.boundaryMm.length === 12)).toBe(true)
  expect(zones.filter(zone => zone.vegetation.some(row => row.role === 'tree'))).toHaveLength(2)
  expect(zones.filter(zone => zone.vegetation.some(row => row.role === 'shrub'))).toHaveLength(2)
  await page.goto('./#home')
  await page.reload()
  const home = page.getByTestId('workspace-home')
  await expect(home.locator(`[data-project-key="native:${original.document.sceneId}"]`)).toHaveCount(1)
  await home.locator(`[data-project-key="native:${adopted.document.sceneId}"]`).getByRole('button', { name: '打开', exact: true }).click()
  await keyboardWorkspaceSaved(page)
  const cold = await keyboardProjectBackup(page, info.outputPath('cold.sceneweave'))
  expect(cold.hashes).toEqual(adopted.hashes)
  await page.screenshot({ path: info.outputPath('cold.png') })
  expect(errors).toEqual([])
})
