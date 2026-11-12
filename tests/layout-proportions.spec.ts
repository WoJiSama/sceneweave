import { test, expect } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { openGenerationTask } from './workspace-navigation-helpers'
import { keyboardWorkspaceSaved, keyboardProjectBackup } from './keyboard-ux-helpers'
import { getLegacyGeneration } from '../src/shared/terrain-generation/composition-contracts'
import { roomPoints } from '../src/shared/geometry/geometry'
import { interiorEntityId, checkInteriorLayout } from '../src/shared/generation/domains/interior/index'
import { interiorLayoutParametersSchema, type InteriorGenerationInput, type InteriorLayout } from '../src/shared/generation/domains/interior/contracts'

test('normal five-room request keeps a shortened real corridor through saving and cold opening', async ({ page }, info) => {
  test.setTimeout(180000)
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await page.goto('./#home')
  await page.getByTestId('workspace-home').getByRole('button', { name: '新建场景', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '新建空白场景', exact: true })
  await dialog.getByLabel('场景名称', { exact: true }).fill('布局比例原工程')
  await dialog.getByRole('button', { name: '创建空白场景', exact: true }).click()
  await expect(dialog).toHaveCount(0); await keyboardWorkspaceSaved(page)
  await openGenerationTask(page, '室内布局')
  const panel = page.getByRole('region', { name: '室内布局生成', exact: true })
  await panel.getByLabel('室内工程名称', { exact: true }).fill('五房间短走廊')
  await panel.getByLabel('室内建筑宽米', { exact: true }).fill('20')
  await panel.getByLabel('室内建筑高米', { exact: true }).fill('16')
  await panel.getByLabel('室内生成种子', { exact: true }).fill('production-layout-independent-17')
  const rooms = [
    ['旅舍餐厅', 48, 140, 4.5], ['东客房', 16, 42, 3], ['西客房', 16, 42, 3], ['厨房', 18, 55, 3.2], ['储藏室', 10, 30, 2.5],
  ] as const
  for (let count = 2; count < rooms.length; count++) await panel.getByRole('button', { name: '增加房间', exact: true }).click()
  for (const [index, [purpose, min, max, side]] of rooms.entries()) {
    await panel.getByLabel(`房间${index + 1}用途`, { exact: true }).fill(purpose)
    await panel.getByLabel(`房间${index + 1}最小面积`, { exact: true }).fill(String(min))
    await panel.getByLabel(`房间${index + 1}最大面积`, { exact: true }).fill(String(max))
    await panel.getByLabel(`房间${index + 1}最小净边长`, { exact: true }).fill(String(side))
  }
  await panel.getByLabel('室内走廊方向', { exact: true }).selectOption('horizontal')
  await panel.getByLabel('室内走廊净宽米', { exact: true }).fill('1.6')
  await panel.getByRole('button', { name: '预览室内布局', exact: true }).click()
  const candidate = page.getByTestId('workspace-inspector').getByLabel('室内布局候选摘要', { exact: true })
  await expect(candidate).toBeVisible({ timeout: 90000 })
  await candidate.getByRole('button', { name: '保存为新工程', exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: '室内布局已完整保存' })).toBeVisible({ timeout: 60000 })
  await keyboardWorkspaceSaved(page)
  const generated = await keyboardProjectBackup(page, info.outputPath('generated.sceneweave'))
  const d = generated.document
  const recipe = Object.values(getLegacyGeneration(d)!.recipes).find(row => row.algorithmId === 'interior-layout')!
  expect(recipe).toMatchObject({ recipeVersion: 10, algorithmVersion: 10 })
  if (recipe.algorithmId !== 'interior-layout') throw Error('Missing interior recipe')
  const parameters = interiorLayoutParametersSchema.parse(recipe.parameters)
  const input: InteriorGenerationInput = { version: 1, algorithmVersion: 10, seed: recipe.seed, parameters }
  const actual = Object.values(d.rooms).map(room => {
    const points = roomPoints(d, room), x = Math.min(...points.map(p => p.x)), y = Math.min(...points.map(p => p.y))
    return { roomId: room.id, boundsMm: { x, y, width: Math.max(...points.map(p => p.x)) - x, height: Math.max(...points.map(p => p.y)) - y } }
  })
  const layout: InteriorLayout = {
    rooms: parameters.rooms.map(requirement => {
      const row = actual.find(r => r.roomId === interiorEntityId(d.sceneId, recipe.seed, `room:${requirement.id}`))!
      return { ...row, requirementId: requirement.id, clearAreaMm2: (row.boundsMm.width - parameters.wallThicknessMm) * (row.boundsMm.height - parameters.wallThicknessMm) }
    }),
    corridors: actual.filter(row => row.roomId === interiorEntityId(d.sceneId, recipe.seed, 'corridor')),
  }
  expect(checkInteriorLayout(input, layout)).toEqual([])
  expect(layout.corridors).toHaveLength(1)
  expect(layout.corridors[0].boundsMm.width).toBeLessThan(parameters.boundsMm.width * .8)
  await page.reload()
  await page.getByRole('button', { name: '回到首页', exact: true }).click()
  await page.getByTestId('workspace-home').locator(`[data-project-key="native:${d.sceneId}"]`).getByRole('button', { name: '打开', exact: true }).click()
  await keyboardWorkspaceSaved(page)
  const cold = await keyboardProjectBackup(page, info.outputPath('cold.sceneweave'))
  expect(cold.hashes).toEqual(generated.hashes)
  expect(errors).toEqual([])
  await writeFile(info.outputPath('layout.json'), JSON.stringify({ layout, recipe, errors }, null, 2))
  await page.screenshot({ path: info.outputPath('cold.png') })
})
