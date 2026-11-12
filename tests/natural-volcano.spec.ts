import { expect, test } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import { unzipSync } from 'fflate'
import { createKeyboardProject, keyboardProjectBackup, keyboardResourceHashes, keyboardWorkspaceSaved } from './keyboard-ux-helpers'
import { openSceneObjects, openWorkspaceModule } from './workspace-navigation-helpers'
import { openDetailsBySummary } from './workspace-ux-helpers'

test('ordinary natural volcano download, import, rock colour edit and cold reopen preserve real geometry and resource closure', async ({ page }, info) => {
  test.setTimeout(240_000)
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await createKeyboardProject(page, '火山下载前的原工程')
  const original = await keyboardProjectBackup(page, info.outputPath('original.sceneweave'))
  await openWorkspaceModule(page, '素材与布景')
  const panel = page.getByRole('region', { name: '主题素材包', exact: true })
  await panel.locator(':scope > details > summary').click()
  await panel.getByText('火山 · 灰岩、冷壳与熔岩', { exact: true }).click()
  const downloadStarted = Date.now()
  const downloaded = page.waitForEvent('download', { timeout: 120_000 })
  await panel.getByRole('button', { name: '下载场景 · 自然火口与熔岩池', exact: true }).click()
  const file = await downloaded, filePath = info.outputPath('natural-volcano.sceneweave')
  const downloadMs = Date.now() - downloadStarted
  expect(file.suggestedFilename()).toBe('natural-volcano.sceneweave'); await file.saveAs(filePath)
  await keyboardWorkspaceSaved(page)
  expect((await keyboardProjectBackup(page, info.outputPath('after-download.sceneweave'))).hashes).toEqual(original.hashes)
  const entries = unzipSync(new Uint8Array(await readFile(filePath)))
  const source = JSON.parse(new TextDecoder().decode(entries['scene.json'])) as typeof original.document
  expect(Object.values(source.materials).filter(material => material.id.startsWith('volcanic-surfaces-v1-material-'))).toHaveLength(5)
  expect(Object.values(source.props)).toHaveLength(24)
  const hazard = source.regions['natural-volcano-lava-hazard'], lava = source.terrainAreas['natural-volcano-lava-area']
  expect(hazard.blocksMovement).toBe(true); expect(hazard.boundaryMm).toEqual(lava.boundaryMm.map(point => point.positionMm))
  await page.getByRole('button', { name: '回到首页', exact: true }).click()
  const chooser = page.waitForEvent('filechooser')
  await page.getByTestId('workspace-home').getByRole('button', { name: '打开工程文件', exact: true }).click()
  await (await chooser).setFiles(filePath); await keyboardWorkspaceSaved(page)
  const imported = await keyboardProjectBackup(page, info.outputPath('imported.sceneweave'))
  expect(imported.document.terrainAreas).toEqual(source.terrainAreas)
  expect(imported.document.props).toEqual(source.props)
  const id = Object.keys(imported.document.terrainConnections)[0]
  expect(imported.document.terrainConnections[id].route?.renderProfile).toBe('naturalRockSteps4')
  const objects = await openSceneObjects(page, '结构')
  await objects.locator(`[data-entity-id="${id}"]`).click()
  const inspector = page.getByRole('region', { name: '室外对象属性', exact: true })
  await openDetailsBySummary(inspector, /^路线形态与踏面$/)
  await inspector.getByLabel('岩阶色调', { exact: true }).selectOption('naturalRockSteps2')
  await inspector.getByRole('button', { name: '预览对象修改', exact: true }).click()
  await page.getByLabel('确认完整影响范围', { exact: true }).check()
  await page.getByRole('button', { name: '采用室外修改', exact: true }).click(); await keyboardWorkspaceSaved(page)
  const edited = await keyboardProjectBackup(page, info.outputPath('edited.sceneweave'))
  expect(edited.document.terrainConnections[id].route?.renderProfile).toBe('naturalRockSteps2')
  const connection = structuredClone(edited.document.terrainConnections[id]); connection.route!.renderProfile = 'naturalRockSteps4'
  expect(connection).toEqual(imported.document.terrainConnections[id])
  expect(edited.document.terrainAreas).toEqual(imported.document.terrainAreas)
  expect(edited.document.paths).toEqual(imported.document.paths)
  expect(edited.document.props).toEqual(imported.document.props)
  expect(keyboardResourceHashes(edited.hashes)).toEqual(keyboardResourceHashes(imported.hashes))
  await page.getByRole('button', { name: '撤销编辑', exact: true }).click(); await keyboardWorkspaceSaved(page)
  expect((await keyboardProjectBackup(page, info.outputPath('undone.sceneweave'))).document.terrainConnections).toEqual(imported.document.terrainConnections)
  await page.getByRole('button', { name: '重做编辑', exact: true }).click(); await keyboardWorkspaceSaved(page)
  const redone = await keyboardProjectBackup(page, info.outputPath('redone.sceneweave'))
  expect(redone.document.terrainConnections).toEqual(edited.document.terrainConnections)
  await page.reload(); await page.getByRole('button', { name: '回到首页', exact: true }).click()
  await page.getByTestId('workspace-home').locator(`[data-project-key="native:${redone.document.sceneId}"]`).getByRole('button', { name: '打开', exact: true }).click(); await keyboardWorkspaceSaved(page)
  const cold = await keyboardProjectBackup(page, info.outputPath('cold.sceneweave'))
  expect(cold.hashes).toEqual(redone.hashes)
  await page.screenshot({ path: info.outputPath('natural-volcano-cold.png') })
  await writeFile(info.outputPath('result.json'), JSON.stringify({ ordinaryUI: true, formalAcceptance: false, geometryPreserved: true, resourceClosurePreserved: true, downloadPreservedCurrent: true, undoRedo: true, coldExactArchiveEntries: true, downloadMs, errors }, null, 2))
  expect(errors).toEqual([])
})
