import { expect, test } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { SCENE_COLLECTION_AVAILABLE_CATEGORIES, SCENE_COLLECTION_ITEMS } from '../src/shared/assets/scene-collection'
import { acknowledgeAssetQuality } from './asset-quality-helpers'
import { createKeyboardProject, keyboardProjectBackup, keyboardWorkspaceSaved, openKeyboardPanel } from './keyboard-ux-helpers'
import { openBuildingTask, openSceneObjects, openWorkspaceModule } from './workspace-navigation-helpers'

for (const group of ['kitchen','wash','lighting','farm','workshop','adventure','ritual','furnishing','period-equipment','architecture','nature','transport','surfaces-traces']) test(`${group}: every category loads real art and an explicit filtered item survives adoption, placement and cold read`, async ({ page }, info) => {
  test.setTimeout(900000)
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await createKeyboardProject(page, `${group}独立素材`)
  await openWorkspaceModule(page, '素材与布景')
  const panel = page.getByRole('region', {name:'全场景素材系列',exact:true}), details = panel.locator(':scope > details')
  if (await details.getAttribute('open') === null) await details.locator(':scope > summary').click()
  await panel.getByLabel('全场景用途大类',{exact:true}).selectOption(group)
  const categories = SCENE_COLLECTION_AVAILABLE_CATEGORIES.filter(row => row.group === group), selected = []
  const baseline = await keyboardProjectBackup(page, info.outputPath('baseline.sceneweave'))
  for (const [index, category] of categories.entries()) {
    await panel.getByLabel('全场景物件类别',{exact:true}).selectOption(category.id)
    await panel.getByLabel('全场景素材年代',{exact:true}).selectOption('all')
    await panel.getByLabel('查找全场景素材',{exact:true}).fill('')
    await panel.getByRole('button',{name:'加载所选物件类别',exact:true}).click()
    await expect(panel.locator('img')).toHaveCount(category.count,{timeout:120000})
    expect(await panel.locator('img').evaluateAll(images => images.every(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth>0))).toBe(true)
    const preferredEra = group==='period-equipment'?'1920s':(['medieval','fantasy','1920s'] as const)[index%3]
    const design = SCENE_COLLECTION_ITEMS.find(row => row.category===category.id && row.era===preferredEra)
      ?? SCENE_COLLECTION_ITEMS.find(row => row.category===category.id)!
    const era = design.era
    selected.push(design)
    await panel.getByLabel('全场景素材年代',{exact:true}).selectOption(era)
    await panel.getByLabel('查找全场景素材',{exact:true}).fill(design.name)
    await expect(panel.locator('img')).toHaveCount(1)
    await page.screenshot({path:info.outputPath(`${category.id}.png`)})
    const preview = async () => {
      await panel.getByRole('checkbox',{name:`选择素材 ${design.name}`,exact:true}).check()
      await panel.getByRole('button',{name:'预览添加所选1件素材',exact:true}).click()
      await expect(page.getByRole('button',{name:'采用组件修改',exact:true})).toBeVisible({timeout:120000})
    }
    if (!index) {
      await preview(); await page.getByRole('button',{name:'取消组件预览',exact:true}).click(); await keyboardWorkspaceSaved(page)
      expect((await keyboardProjectBackup(page, info.outputPath('cancelled.sceneweave'))).hashes).toEqual(baseline.hashes)
    }
    await preview(); await acknowledgeAssetQuality(page); await page.getByRole('button',{name:'采用组件修改',exact:true}).click(); await keyboardWorkspaceSaved(page)
  }
  const adopted = await keyboardProjectBackup(page,info.outputPath('all-explicit-choices.sceneweave'))
  for (const design of selected) expect(adopted.document.propDefinitions[design.definitionId] ?? adopted.document.materials[design.definitionId]).toBeDefined()
  await page.getByRole('button',{name:'撤销编辑',exact:true}).click(); await keyboardWorkspaceSaved(page)
  expect((await keyboardProjectBackup(page,info.outputPath('undo-last.sceneweave'))).document.propDefinitions[selected.at(-1)!.definitionId]).toBeUndefined()
  await page.getByRole('button',{name:'重做编辑',exact:true}).click(); await keyboardWorkspaceSaved(page)
  await openWorkspaceModule(page, '素材与布景')
  const library=page.getByRole('region',{name:'组件素材库',exact:true}), design=selected.find(row=>adopted.document.propDefinitions[row.definitionId])!
  await library.getByLabel('搜索组件素材',{exact:true}).fill(design.name)
  await library.getByRole('button',{name:`放置组件 ${design.name}`,exact:true}).click(); await openKeyboardPanel(page,'inspector')
  for (const axis of ['X','Y']) {await page.getByLabel(`放置 ${axis}`,{exact:true}).fill('4');await page.getByLabel(`放置 ${axis}`,{exact:true}).press('Tab')}
  await page.getByRole('button',{name:'在此放置',exact:true}).click();await keyboardWorkspaceSaved(page)
  if(group==='surfaces-traces') {
    const material=selected.find(row=>adopted.document.materials[row.definitionId])!
    await openBuildingTask(page)
    await page.getByLabel('房间形状',{exact:true}).selectOption('rectangle')
    await page.getByRole('region',{name:'房间参数',exact:true}).locator('details').filter({has:page.locator('summary').filter({hasText:'精确位置'})}).locator('summary').click()
    for(const[label,value]of [['房间起点 X','7'],['房间起点 Y','6'],['房间宽度','5'],['房间高度','3']]) {
      await page.getByLabel(label,{exact:true}).fill(value);await page.getByLabel(label,{exact:true}).press('Tab')
    }
    await page.getByRole('button',{name:'预览新房间',exact:true}).click()
    await page.getByLabel('确认完整影响范围',{exact:true}).check()
    await page.getByRole('button',{name:'采用结构修改',exact:true}).click();await keyboardWorkspaceSaved(page)
    const room=Object.values((await keyboardProjectBackup(page,info.outputPath('material-room.sceneweave'))).document.rooms)[0]
    const objects=await openSceneObjects(page,'结构');await objects.locator(`[data-entity-id="${room.id}"]`).click()
    await openWorkspaceModule(page,'素材与布景')
    await library.getByLabel('搜索组件素材',{exact:true}).fill(material.name)
    await library.getByRole('button',{name:`应用材质 ${material.name}`,exact:true}).click();await openKeyboardPanel(page,'inspector')
    const review=page.getByRole('region',{name:'候选审阅',exact:true})
    await review.getByLabel('确认完整影响范围',{exact:true}).check()
    await review.getByRole('button',{name:'采用视觉修改',exact:true}).click();await keyboardWorkspaceSaved(page)
    expect((await keyboardProjectBackup(page,info.outputPath('material-painted.sceneweave'))).document.rooms[room.id].floorStyle?.base.materialRef.id).toBe(material.definitionId)
  }
  const placed=await keyboardProjectBackup(page,info.outputPath('placed.sceneweave'))
  expect(Object.values(placed.document.props).some(prop=>prop.definitionRef?.id===design.definitionId)).toBe(true)
  await page.reload();await page.getByRole('button',{name:'回到首页',exact:true}).click()
  await page.getByTestId('workspace-home').locator(`[data-project-key="native:${placed.document.sceneId}"]`).getByRole('button',{name:'打开',exact:true}).click();await keyboardWorkspaceSaved(page)
  const cold=await keyboardProjectBackup(page,info.outputPath('cold.sceneweave'))
  expect(cold.document.propDefinitions).toEqual(placed.document.propDefinitions);expect(cold.document.props).toEqual(placed.document.props)
  expect(cold.document.materials).toEqual(placed.document.materials);expect(cold.document.rooms).toEqual(placed.document.rooms)
  expect(cold.hashes['sources.json']).toEqual(placed.hashes['sources.json'])
  expect(errors).toEqual([]);await writeFile(info.outputPath('page-errors.json'),JSON.stringify(errors))
})
