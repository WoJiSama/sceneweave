import { expect, test, type Page } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { createKeyboardProject, keyboardProjectBackup, keyboardWorkspaceSaved, openKeyboardPanel } from './keyboard-ux-helpers'
import { openGenerationTask, openTerrainTask } from './workspace-navigation-helpers'
import { visualBase } from '../src/shared/visual/base'
import { getLegacyGeneration } from '../src/shared/terrain-generation/composition-contracts'

async function closeDrawers(page: Page) {
  if (await page.getByTestId('workspace-layout').getAttribute('data-narrow') !== 'true') return
  for (const [id, name] of [['resources', '资源面板'], ['inspector', '属性面板'], ['navigation', '场景导航']] as const) {
    const panel = page.getByTestId(`workspace-${id}`)
    if (await panel.getAttribute('data-open') === 'true') {
      await panel.getByRole('button', { name: `关闭${name}`, exact: true }).click()
      await expect(panel).toHaveAttribute('data-open', 'false')
    }
  }
}

async function selectCurve(page: Page, expand: boolean) {
  await openKeyboardPanel(page, 'resources')
  await openTerrainTask(page, '修改地形')
  await page.getByLabel('地形编辑轮廓', { exact: true }).selectOption('terrain-coast-curve')
  if (expand) await page.getByRole('button', { name: '按完整曲线扩大范围', exact: true }).click()
  await closeDrawers(page)
  await page.getByRole('button', { name: '适应全图', exact: true }).click()
}

async function dragCurve(page: Page) {
  const handle = page.getByTestId('curve-handle-0-control1'), box = (await handle.boundingBox())!
  const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  expect(await handle.evaluate((node, point) => document.elementFromPoint(point.x, point.y) === node, point)).toBe(true)
  await page.mouse.move(point.x, point.y); await page.mouse.down()
  await page.mouse.move(point.x + 2, point.y + 1, { steps: 2 })
  const next = { x: Number(await handle.getAttribute('cx')), y: Number(await handle.getAttribute('cy')) }
  await page.mouse.up()
  await openKeyboardPanel(page, 'resources')
  await expect(page.locator('.terrain-editing-panel fieldset').first()).toBeEnabled({ timeout: 90_000 })
  return next
}

for (const width of [1512, 390]) test(`production curve scope recovery, preview, adoption and cold read at ${width}px`, async ({ page }, info) => {
  test.setTimeout(240_000)
  await page.setViewportSize({ width, height: width === 390 ? 844 : 982 })
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await createKeyboardProject(page, `曲线提交 ${width}`)
  await openKeyboardPanel(page, 'resources'); await openGenerationTask(page, '自然地形')
  await page.getByRole('button', { name: '生成地形预览', exact: true }).click()
  await expect(page.getByRole('button', { name: '采用当前地形方案', exact: true })).toBeEnabled({ timeout: 90_000 })
  await page.getByRole('button', { name: '采用当前地形方案', exact: true }).click()
  await keyboardWorkspaceSaved(page); await closeDrawers(page)
  const before = await keyboardProjectBackup(page, info.outputPath('curve-before.sceneweave'))
  const revision = page.locator('.workspace-unified'), impact = page.getByRole('article', { name: '本次地形影响', exact: true })
  await selectCurve(page, false)
  await dragCurve(page)
  await expect(page.locator('.terrain-editing-panel [role="alert"]')).toContainText('实际写入超出冻结范围')
  await expect(impact).toHaveCount(0)
  await expect(revision).toHaveAttribute('data-revision', String(before.document.revision))
  await page.getByRole('button', { name: '按完整曲线扩大范围', exact: true }).click()
  await page.getByRole('button', { name: '预览局部地形修改', exact: true }).click()
  await expect(impact).toBeVisible({ timeout: 90_000 })
  await expect(page.getByRole('button', { name: '保护并采用地形修改', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: '取消本次地形修改', exact: true }).click()
  await keyboardWorkspaceSaved(page); await closeDrawers(page)
  expect((await keyboardProjectBackup(page, info.outputPath('curve-cancelled.sceneweave'))).hashes).toEqual(before.hashes)

  await selectCurve(page, true)
  const point = await dragCurve(page)
  await expect(impact).toBeVisible({ timeout: 90_000 })
  await impact.getByRole('checkbox', { name: '确认本次地形影响范围', exact: true }).check()
  await page.getByRole('button', { name: '保护并采用地形修改', exact: true }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: info.outputPath('curve-review.png') })
  const summary = await impact.ariaSnapshot()
  await page.getByRole('button', { name: '保护并采用地形修改', exact: true }).click()
  await keyboardWorkspaceSaved(page); await closeDrawers(page)
  const adopted = await keyboardProjectBackup(page, info.outputPath('curve-adopted.sceneweave'))
  expect(visualBase(adopted.document)!.boundaries['terrain-coast-curve'].segments[0].control1).toEqual(point)
  expect(adopted.document.terrainAreas['terrain-low'].boundaryMm).not.toEqual(before.document.terrainAreas['terrain-low'].boundaryMm)
  expect(adopted.document.revision).toBe(before.document.revision + 1)
  expect(Object.values(getLegacyGeneration(adopted.document)!.ownership).some(owner => owner.manualFields.includes('geometry'))).toBe(true)
  for (const [id, source] of Object.entries(before.appearance.sources)) expect(adopted.appearance.sources[id]).toEqual(source)
  await page.getByRole('button', { name: '撤销编辑', exact: true }).click(); await keyboardWorkspaceSaved(page)
  const undone = await keyboardProjectBackup(page, info.outputPath('curve-undone.sceneweave'))
  expect(undone.document.terrainAreas).toEqual(before.document.terrainAreas)
  expect(undone.document.generation).toEqual(before.document.generation)
  expect(undone.appearance).toEqual(before.appearance)
  await page.getByRole('button', { name: '重做编辑', exact: true }).click(); await keyboardWorkspaceSaved(page)
  const redone = await keyboardProjectBackup(page, info.outputPath('curve-redone.sceneweave'))
  expect(redone.document.terrainAreas).toEqual(adopted.document.terrainAreas)
  expect(redone.appearance).toEqual(adopted.appearance)
  await page.reload(); await expect(page.locator('.asset-save')).toHaveText('尚未打开工程')
  await page.getByRole('button', { name: '回到首页', exact: true }).click()
  await page.getByTestId('workspace-home').locator(`[data-project-key="native:${before.document.sceneId}"]`).getByRole('button', { name: '打开', exact: true }).click()
  await keyboardWorkspaceSaved(page); await closeDrawers(page)
  expect((await keyboardProjectBackup(page, info.outputPath('curve-cold.sceneweave'))).hashes).toEqual(redone.hashes)
  expect(errors).toEqual([])
  await writeFile(info.outputPath('curve-submit-facts.json'), JSON.stringify({ width, point, summary, revision: redone.document.revision, errors }, null, 2))
})
