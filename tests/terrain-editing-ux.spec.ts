import { expect, test, type Page } from '@playwright/test'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { unzipSync } from 'fflate'
import type { SceneDocument } from '../src/shared/model/scene'
import { getLegacyGeneration } from '../src/shared/terrain-generation/composition-contracts'
import { openGenerationTask, openSceneSettings, openTerrainTask } from './workspace-navigation-helpers'
import { openDetailsBySummary, projectBackupButton, reloadSaved } from './workspace-ux-helpers'

async function saved(page: Page) {
  await expect(page.locator('.asset-save')).toHaveText('本地已保存', { timeout: 90000 })
  await expect(page.locator('.asset-busy')).toHaveCount(0)
  await expect(page.locator('.asset-map-wrap')).toHaveAttribute('aria-busy', 'false', { timeout: 90000 })
}

async function backup(page: Page, path: string) {
  const downloaded = page.waitForEvent('download')
  await (await projectBackupButton(page)).click()
  await (await downloaded).saveAs(path)
  await expect(page.locator('.asset-busy')).toHaveCount(0)
  await page.locator('.workspace-export-menu > summary').click()
  const files = unzipSync(new Uint8Array(await readFile(path)))
  return {
    document: JSON.parse(new TextDecoder().decode(files['scene.json'])) as SceneDocument,
    hashes: Object.fromEntries(Object.entries(files).map(([path, bytes]) => [path, createHash('sha256').update(bytes).digest('hex')])),
  }
}

test('production terrain lengths and collapsed scope preserve integer-mm strokes, cancellation and protected undo', async ({ page }, info) => {
  test.setTimeout(300000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('./#workspace')
  await openGenerationTask(page, '自然地形')
  await page.getByRole('button', { name: '生成地形预览', exact: true }).click()
  await expect(page.getByRole('button', { name: '采用当前地形方案', exact: true })).toBeEnabled({ timeout: 90000 })
  await page.getByRole('button', { name: '采用当前地形方案', exact: true }).click()
  await saved(page)

  for (const unit of ['m', 'ft'] as const) {
    if (unit === 'ft') {
      const settings = await openSceneSettings(page)
      await openDetailsBySummary(settings, /^单位与格线$/)
      await settings.getByLabel('场景显示单位', { exact: true }).selectOption(unit)
      await settings.getByRole('button', { name: '预览显示设置', exact: true }).click()
      await page.getByRole('button', { name: '采用显示设置', exact: true }).click()
      await saved(page)
    }
    const original = await backup(page, info.outputPath(`terrain-${unit}-before.sceneweave`))
    expect(original.document.units.display).toBe(unit)
    const bounds = { ...original.document.exportBoundsMm, width: original.document.exportBoundsMm.width - 1000 }
    const input = (mm: number) => String(Number((mm / (unit === 'm' ? 1000 : 304.8)).toFixed(3)))
    const distance = (mm: number) => `${(mm / (unit === 'm' ? 1000 : 304.8)).toFixed(3)} ${unit}`
    await openTerrainTask(page, '修改地形')
    const panel = page.getByRole('region', { name: '局部地形编辑', exact: true }), scope = panel.locator('.terrain-editing-scope details')
    const impact = page.getByTestId('workspace-inspector').getByRole('article', { name: '本次地形影响', exact: true })
    await expect(scope).not.toHaveAttribute('open')
    await expect(panel.getByLabel('本次可写范围摘要', { exact: true })).toContainText(distance(original.document.exportBoundsMm.width))
    await expect(panel.getByRole('button', { name: '在地图框定范围', exact: true })).toBeVisible()
    await panel.getByRole('button', { name: '清出空地', exact: true }).click()
    await panel.getByLabel('地形编辑作用地形', { exact: true }).selectOption('terrain-low')
    await expect(panel.getByLabel('地形编辑目标高程', { exact: true })).toHaveValue(input(original.document.terrainAreas['terrain-low'].groundElevationMm))
    const radius = panel.getByLabel('地形编辑笔刷半径', { exact: true })
    await expect(radius.locator('..').locator('small')).toHaveText(unit)
    await radius.fill('0')
    await radius.press('Tab')
    await expect(panel.getByRole('alert')).toContainText('笔刷半径须在')
    await expect(panel.getByRole('button', { name: '预览局部地形修改', exact: true })).toBeDisabled()
    const radiusMm = unit === 'm' ? 300 : 381
    await radius.fill(unit === 'm' ? '0.3' : '1.25')
    await radius.press('Tab')
    await radius.fill('9')
    await radius.press('Escape')
    await expect(radius).toHaveValue(unit === 'm' ? '0.3' : '1.25')
    await scope.locator('summary').click()
    const width = scope.getByLabel('地形编辑范围宽', { exact: true })
    await width.fill('0')
    await width.press('Tab')
    await expect(panel.getByRole('alert')).toContainText('宽和高须大于零')
    await width.fill(input(bounds.width))
    await width.press('Tab')
    await expect(panel.getByLabel('本次可写范围摘要', { exact: true })).toContainText(`${distance(bounds.width)} × ${distance(bounds.height)}`)
    await scope.locator('summary').click()
    await scope.locator('summary').click()
    await expect(width).toHaveValue(input(bounds.width))
    await scope.locator('summary').click()
    await panel.getByText('键盘落笔', { exact: true }).click()
    await panel.getByLabel('地形编辑落笔 X mm', { exact: true }).fill('2000')
    await panel.getByLabel('地形编辑落笔 Y mm', { exact: true }).fill('2000')
    const preview = async () => {
      await panel.getByRole('button', { name: '添加落笔并预览', exact: true }).click()
      await expect(impact).toBeVisible({ timeout: 90000 })
      await expect(impact).toContainText(`范围 ${distance(bounds.width)} × ${distance(bounds.height)}`)
      await expect(impact.getByRole('button', { name: '保护并采用地形修改', exact: true })).toBeDisabled()
      await expect(page.locator('.workspace-unified')).toHaveAttribute('data-revision', String(original.document.revision))
    }
    await preview()
    await page.screenshot({ path: info.outputPath(`terrain-${unit}-preview.png`) })
    await impact.getByRole('button', { name: '取消本次地形修改', exact: true }).click()
    expect((await backup(page, info.outputPath(`terrain-${unit}-cancelled.sceneweave`))).hashes).toEqual(original.hashes)
    await panel.getByRole('button', { name: '清出空地', exact: true }).click()
    // Cancelling ends this editing session and resets its form along with the strokes.
    await panel.getByLabel('地形编辑作用地形', { exact: true }).selectOption('terrain-low')
    await radius.fill(unit === 'm' ? '0.3' : '1.25')
    await radius.press('Tab')
    await scope.locator('summary').click()
    await width.fill(input(bounds.width))
    await width.press('Tab')
    await panel.getByText('键盘落笔', { exact: true }).click()
    await panel.getByLabel('地形编辑落笔 X mm', { exact: true }).fill('2000')
    await panel.getByLabel('地形编辑落笔 Y mm', { exact: true }).fill('2000')
    await preview()
    await impact.getByLabel('确认本次地形影响范围', { exact: true }).check()
    await impact.getByRole('button', { name: '保护并采用地形修改', exact: true }).click()
    await expect(impact).toHaveCount(0, { timeout: 90000 })
    await saved(page)
    const adopted = await backup(page, info.outputPath(`terrain-${unit}-adopted.sceneweave`))
    expect(adopted.document.revision).toBe(original.document.revision + 1)
    const generation = getLegacyGeneration(adopted.document)
    const strokes = generation && generation.version !== 1 ? Object.values(generation.strokes) : []
    expect(strokes).toHaveLength(1)
    expect(strokes[0]).toMatchObject({ radiusMm, pointsMm: [{ x: 2000, y: 2000 }], scopeMm: bounds })
    await page.getByRole('button', { name: '撤销编辑', exact: true }).click()
    await saved(page)
    const undone = await backup(page, info.outputPath(`terrain-${unit}-undone.sceneweave`))
    expect(undone.document).toEqual({ ...original.document, revision: original.document.revision + 2, updatedAt: undone.document.updatedAt })
    await page.getByRole('button', { name: '重做编辑', exact: true }).click()
    await saved(page)
    const redone = await backup(page, info.outputPath(`terrain-${unit}-redone.sceneweave`))
    expect(redone.document).toEqual({ ...adopted.document, revision: original.document.revision + 3, updatedAt: redone.document.updatedAt })
    await reloadSaved(page)
    await saved(page)
    expect((await backup(page, info.outputPath(`terrain-${unit}-reloaded.sceneweave`))).document).toEqual(redone.document)
    // Reload clears in-memory undo, so test the next unit from a fresh generated baseline.
    if (unit === 'm') {
      await openGenerationTask(page, '自然地形')
      await page.getByRole('button', { name: '生成地形预览', exact: true }).click()
      await expect(page.getByRole('button', { name: '采用当前地形方案', exact: true })).toBeEnabled({ timeout: 90000 })
      await page.getByRole('button', { name: '采用当前地形方案', exact: true }).click()
      await saved(page)
    }
  }
  expect(errors).toEqual([])
})
