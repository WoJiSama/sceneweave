import { expect, test, type Locator } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { createKeyboardProject, keyboardProjectBackup, keyboardWorkspaceSaved } from './keyboard-ux-helpers'
import { closeWorkspaceDrawers, openSceneSettings } from './workspace-navigation-helpers'
import { mapExportButton, openDetailsBySummary } from './workspace-ux-helpers'

async function metres(scope: Locator, name: string, millimetres: number) {
  const field = scope.getByLabel(name, { exact: true })
  await field.fill(String(millimetres / 1000))
  await field.press('Tab')
}

test('expanding the map includes the new space in PNG while a deliberate crop stays editable', async ({ page }, info) => {
  test.setTimeout(120_000)
  await createKeyboardProject(page, '旅店新增小院')
  const before = await keyboardProjectBackup(page, info.outputPath('original.sceneweave'))
  const floorId = Object.keys(before.document.floors)[0]
  const world = before.document.floors[floorId].boundsMm
  const expanded = { ...world, x: world.x - 5000, width: world.width + 5000 }
  const review = page.getByRole('region', { name: '候选审阅', exact: true }).and(page.locator('.workspace-candidate-review'))
  const settings = await openSceneSettings(page)
  await openDetailsBySummary(settings, /^世界与导出范围$/)
  const fields = settings.locator('.scene-bounds-settings')
  const wholeMap = fields.getByLabel('导出整张地图', { exact: true })
  const preview = fields.getByRole('button', { name: '预览画布范围', exact: true })
  await expect(wholeMap).toBeChecked()
  await expect(fields.getByLabel('导出宽度', { exact: true })).toHaveCount(0)
  await metres(fields, '世界起点 X', expanded.x)
  await metres(fields, '世界宽度', expanded.width)
  await preview.click()
  await review.getByRole('button', { name: '取消结构预览', exact: true }).click()
  await expect(fields.getByLabel('世界起点 X', { exact: true })).toHaveValue(String(expanded.x / 1000))
  const adopt = async () => {
    await preview.click()
    await review.getByLabel('确认完整影响范围', { exact: true }).check()
    await review.getByRole('button', { name: '采用结构修改', exact: true }).click()
    await keyboardWorkspaceSaved(page)
  }
  await adopt()
  await closeWorkspaceDrawers(page)
  const after = await keyboardProjectBackup(page, info.outputPath('expanded.sceneweave'))
  expect(after.document.floors[floorId].boundsMm).toEqual(expanded)
  expect(after.document.floors[floorId].outputBoundsMm ?? after.document.exportBoundsMm).toEqual(expanded)
  const downloading = page.waitForEvent('download')
  await (await mapExportButton(page, 'player')).click()
  const path = info.outputPath('full-map.png')
  await (await downloading).saveAs(path)
  const png = await readFile(path)
  expect(png.readUInt32BE(16)).toBe(4096)
  expect(png.readUInt32BE(20)).toBe(Math.round(4096 * expanded.height / expanded.width))
  await keyboardWorkspaceSaved(page)
  await page.locator('.workspace-export-menu > summary').click()

  await openSceneSettings(page)
  await openDetailsBySummary(settings, /^世界与导出范围$/)
  await wholeMap.uncheck()
  await metres(fields, '导出宽度', world.width)
  await adopt()
  await closeWorkspaceDrawers(page)
  const cropped = await keyboardProjectBackup(page, info.outputPath('cropped.sceneweave'))
  expect(cropped.document.floors[floorId].boundsMm).toEqual(expanded)
  expect(cropped.document.floors[floorId].outputBoundsMm ?? cropped.document.exportBoundsMm).toEqual({ ...expanded, width: world.width })
  await openSceneSettings(page)
  await openDetailsBySummary(settings, /^世界与导出范围$/)
  await expect(wholeMap).not.toBeChecked()
  await expect(fields.getByLabel('导出宽度', { exact: true })).toHaveValue(String(world.width / 1000))
})
