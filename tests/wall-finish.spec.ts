import { test, expect } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { createKeyboardProject, keyboardProjectBackup, keyboardWorkspaceSaved, keyboardResourceHashes } from './keyboard-ux-helpers'
import { openWorkspaceModule, openBuildingTask, openSceneObjects } from './workspace-navigation-helpers'
import { acknowledgeAssetQuality } from './asset-quality-helpers'
import { architecturalWallDefinitionId } from '../src/shared/visual/architectural-wall-surfaces'

const physical = (document: Awaited<ReturnType<typeof keyboardProjectBackup>>['document']) => {
  const scene = structuredClone(document)
  for (const wall of Object.values(scene.walls)) wall.topStyle = null
  return Object.fromEntries((['floors', 'vertices', 'rooms', 'walls', 'openings', 'props', 'terrainAreas', 'entityLayers', 'constraints'] as const).map(key => [key, scene[key]]))
}
async function number(page: Parameters<typeof keyboardWorkspaceSaved>[0], name: string, value: string) {
  const field = page.getByLabel(name, { exact: true }); await field.fill(value); await field.press('Tab')
}
async function adopt(page: Parameters<typeof keyboardWorkspaceSaved>[0]) {
  await page.getByLabel('确认完整影响范围', { exact: true }).check()
  await page.getByRole('button', { name: '采用结构修改', exact: true }).click(); await keyboardWorkspaceSaved(page)
}

test('ordinary wall material adoption, real paint scale/direction, undo/redo and saved cold reopen preserve structure', async ({ page }, info) => {
  test.setTimeout(240000)
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await createKeyboardProject(page, '墙顶材质与真实平铺自检')
  await openBuildingTask(page)
  await page.getByLabel('房间形状', { exact: true }).selectOption('rectangle')
  await page.getByLabel('房间名称', { exact: true }).fill('墙顶材质审阅室')
  const settings = page.locator('.building-panel form details').filter({ has: page.getByLabel('房间起点 X', { exact: true }) })
  if (await settings.getAttribute('open') === null) await settings.locator('summary').click()
  for (const [label, value] of [['房间起点 X', '2'], ['房间起点 Y', '2'], ['房间宽度', '6'], ['房间高度', '5']]) await number(page, label, value)
  await page.getByRole('button', { name: '预览新房间', exact: true }).click(); await adopt(page)
  const original = await keyboardProjectBackup(page, info.outputPath('original.sceneweave'))
  await openWorkspaceModule(page, '素材与布景')
  const panel = page.getByRole('region', { name: '主题素材包', exact: true })
  await panel.locator(':scope > details > summary').click()
  await panel.getByText('墙顶材质 · 砖墙、混凝土与砌石', { exact: true }).click()
  await panel.getByRole('button', { name: '预览添加四种墙顶材质', exact: true }).click()
  await expect(page.getByRole('button', { name: '采用组件修改', exact: true })).toBeVisible({ timeout: 90000 })
  await acknowledgeAssetQuality(page)
  await page.screenshot({ path: info.outputPath('wall-library-candidate.png') })
  await page.getByRole('button', { name: '采用组件修改', exact: true }).click(); await keyboardWorkspaceSaved(page)
  const adopted = await keyboardProjectBackup(page, info.outputPath('adopted.sceneweave'))
  const definitionId = architecturalWallDefinitionId('tavern-warm-masonry')
  expect(adopted.document.materials[definitionId]).toMatchObject({ applicableSurfaces: ['wall'], defaultTileSizeMm: { width: 1440, height: 1440 } })
  const wallId = Object.keys(adopted.document.walls)[0]
  const objects = await openSceneObjects(page, '结构')
  await objects.locator(`[data-entity-id="${wallId}"]`).click()
  await page.getByLabel('编辑墙面材质', { exact: true }).selectOption(definitionId)
  await page.getByRole('button', { name: '预览墙面材质', exact: true }).click(); await adopt(page)
  const material = await keyboardProjectBackup(page, info.outputPath('material.sceneweave'))
  expect(material.document.walls[wallId].topStyle!.base.materialRef.id).toBe(definitionId)
  await page.getByText('墙顶纹理方向与尺寸', { exact: true }).click()
  await number(page, '墙顶纹理方向', '90')
  await number(page, '墙顶平铺宽度', '1.6')
  await number(page, '墙顶平铺长度', '1.44')
  await page.getByRole('button', { name: '预览墙顶铺装修改', exact: true }).click(); await adopt(page)
  const painted = await keyboardProjectBackup(page, info.outputPath('painted.sceneweave'))
  expect(painted.document.walls[wallId].topStyle!.base).toMatchObject({ rotationDeg: 90, tileSizeMm: { width: 1600, height: 1440 } })
  expect(physical(painted.document)).toEqual(physical(original.document))
  expect(painted.identity).toEqual(original.identity)
  await page.getByText('墙顶纹理方向与尺寸', { exact: true }).click()
  await page.getByLabel('墙顶平铺长度', { exact: true }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: info.outputPath('wall-painted.png') })
  await page.getByRole('button', { name: '撤销编辑', exact: true }).click(); await keyboardWorkspaceSaved(page)
  const undone = await keyboardProjectBackup(page, info.outputPath('undone.sceneweave'))
  expect(undone.document.walls[wallId].topStyle).toEqual(material.document.walls[wallId].topStyle)
  await page.getByRole('button', { name: '重做编辑', exact: true }).click(); await keyboardWorkspaceSaved(page)
  const redone = await keyboardProjectBackup(page, info.outputPath('redone.sceneweave'))
  expect(redone.document.walls[wallId].topStyle).toEqual(painted.document.walls[wallId].topStyle)
  await page.reload(); await page.getByRole('button', { name: '回到首页', exact: true }).click()
  await page.getByTestId('workspace-home').locator(`[data-project-key="native:${redone.document.sceneId}"]`).getByRole('button', { name: '打开', exact: true }).click(); await keyboardWorkspaceSaved(page)
  const cold = await keyboardProjectBackup(page, info.outputPath('cold.sceneweave'))
  expect(cold.hashes).toEqual(redone.hashes)
  expect(keyboardResourceHashes(cold.hashes)).toEqual(keyboardResourceHashes(adopted.hashes))
  const reopenedObjects = await openSceneObjects(page, '结构')
  await reopenedObjects.locator(`[data-entity-id="${wallId}"]`).click()
  await page.getByText('墙顶纹理方向与尺寸', { exact: true }).click()
  await expect(page.getByLabel('墙顶纹理方向', { exact: true })).toHaveValue('90')
  await expect(page.getByLabel('墙顶平铺宽度', { exact: true })).toHaveValue('1.6')
  await page.getByLabel('墙顶平铺长度', { exact: true }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: info.outputPath('wall-cold.png') })
  await writeFile(info.outputPath('result.json'), JSON.stringify({ passed: true, formalAcceptance: false, ordinaryUI: true, adoptedDefinitionId: definitionId, wallId, preservedGeometry: true, preservedIdentity: true, undoRedo: true, coldExactArchiveEntries: true, errors }, null, 2))
  expect(errors).toEqual([])
})
