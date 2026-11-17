import { expect, test } from '@playwright/test'
import { FURNITURE_CATEGORIES, furnitureDefinitionId } from '../src/shared/assets/furniture-collection'
import { createKeyboardProject, keyboardProjectBackup, keyboardWorkspaceSaved, openKeyboardPanel } from './keyboard-ux-helpers'
import { openWorkspaceModule } from './workspace-navigation-helpers'
import { acknowledgeAssetQuality } from './asset-quality-helpers'

for (const category of FURNITURE_CATEGORIES) test(`${category.id}: material edition is explicit, preserves original and survives cancellation, undo, placement and cold read`, async ({page},info)=>{
  test.setTimeout(360000)
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message))
  await createKeyboardProject(page,`${category.name}原图与材质版`);await openWorkspaceModule(page,'素材与布景')
  const panel=page.getByRole('region',{name:'全场景素材系列',exact:true});await panel.locator(':scope > details > summary').click()
  await panel.getByLabel('全场景用途大类',{exact:true}).selectOption('furnishing');await panel.getByLabel('全场景物件类别',{exact:true}).selectOption(category.id)
  const adopt=async()=>{await panel.getByRole('button',{name:'预览添加所选1件素材',exact:true}).click();await expect(page.getByRole('button',{name:'采用组件修改',exact:true})).toBeVisible({timeout:120000});await acknowledgeAssetQuality(page);await page.getByRole('button',{name:'采用组件修改',exact:true}).click();await keyboardWorkspaceSaved(page)}
  await panel.getByRole('button',{name:'加载所选物件类别',exact:true}).click();await expect(panel.locator('img')).toHaveCount(24,{timeout:120000})
  await panel.getByLabel('查找全场景素材',{exact:true}).fill('乡野粗木');await expect(panel.locator('img')).toHaveCount(1)
  await panel.getByRole('checkbox').check();await adopt()
  const original=await keyboardProjectBackup(page,info.outputPath('original.sceneweave')),originalId=furnitureDefinitionId(`${category.id}-peasant`)
  await panel.getByLabel('家具绘制版本',{exact:true}).selectOption('material');await expect(panel.locator('img')).toHaveCount(0)
  await panel.getByRole('button',{name:'加载所选物件类别',exact:true}).click();await expect(panel.locator('img')).toHaveCount(1,{timeout:120000})
  await panel.getByLabel('全场景素材年代',{exact:true}).selectOption('fantasy');await expect(panel.locator('img')).toHaveCount(0)
  await panel.getByLabel('全场景素材年代',{exact:true}).selectOption('medieval');await expect(panel.locator('img')).toHaveCount(1)
  expect(await panel.locator('img').evaluateAll(rows=>rows.every(row=>(row as HTMLImageElement).naturalWidth>0))).toBe(true)
  await panel.getByRole('checkbox').check();await panel.getByRole('button',{name:'预览添加所选1件素材',exact:true}).click()
  await expect(page.getByRole('button',{name:'取消组件预览',exact:true})).toBeVisible({timeout:120000});await page.getByRole('button',{name:'取消组件预览',exact:true}).click();await keyboardWorkspaceSaved(page)
  expect((await keyboardProjectBackup(page,info.outputPath('cancelled.sceneweave'))).hashes).toEqual(original.hashes)
  await panel.getByRole('checkbox').check();await adopt()
  const material=await keyboardProjectBackup(page,info.outputPath('material.sceneweave')),materialId=furnitureDefinitionId(`${category.id}-peasant-material-study-1`)
  expect(material.document.propDefinitions[originalId]).toEqual(original.document.propDefinitions[originalId]);expect(material.document.propDefinitions[materialId]).toBeDefined()
  for(const[id,asset]of Object.entries(original.document.assets))expect(material.document.assets[id]).toEqual(asset)
  await page.getByRole('button',{name:'撤销编辑',exact:true}).click();await keyboardWorkspaceSaved(page)
  expect((await keyboardProjectBackup(page,info.outputPath('undo.sceneweave'))).document.propDefinitions[materialId]).toBeUndefined()
  await page.getByRole('button',{name:'重做编辑',exact:true}).click();await keyboardWorkspaceSaved(page)
  const library=page.getByRole('region',{name:'组件素材库',exact:true}),name=material.document.propDefinitions[materialId].name
  await library.getByLabel('搜索组件素材',{exact:true}).fill(name);await library.getByRole('button',{name:`放置组件 ${name}`,exact:true}).click();await openKeyboardPanel(page,'inspector')
  for(const axis of ['X','Y']){await page.getByLabel(`放置 ${axis}`,{exact:true}).fill('4');await page.getByLabel(`放置 ${axis}`,{exact:true}).press('Tab')}
  await page.getByRole('button',{name:'在此放置',exact:true}).click();await keyboardWorkspaceSaved(page)
  const placed=await keyboardProjectBackup(page,info.outputPath('placed.sceneweave'));await page.reload();await page.getByRole('button',{name:'回到首页',exact:true}).click()
  await page.getByTestId('workspace-home').locator(`[data-project-key="native:${placed.document.sceneId}"]`).getByRole('button',{name:'打开',exact:true}).click();await keyboardWorkspaceSaved(page)
  const cold=await keyboardProjectBackup(page,info.outputPath('cold.sceneweave'))
  expect(cold.document.propDefinitions).toEqual(placed.document.propDefinitions);expect(cold.document.props).toEqual(placed.document.props);expect(cold.hashes['sources.json']).toBe(placed.hashes['sources.json']);expect(errors).toEqual([])
})
