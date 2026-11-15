// Explicit frozen-input configuration supplies independently preserved complete works.
// Page interaction and downloads only: no runtime imports or database/API patches.
import {expect,test,type Page} from '@playwright/test'
import {readFileSync} from 'node:fs'
import {writeFile} from 'node:fs/promises'
import {keyboardProjectBackup,keyboardResourceHashes,keyboardWorkspaceSaved,openKeyboardPanel} from './keyboard-ux-helpers'
import {closeWorkspaceDrawers,openSceneObjects,openWorkspaceModule,openVisualTask} from './workspace-navigation-helpers'
import {mapExportButton} from './workspace-ux-helpers'

type Input={input:string;roomId:string;materialId:string;materialName:string;target:string;outside:string;deleted:string;props:number}
const cases:Record<string,Input>=process.env.SCENEWEAVE_HISTORY_CASES?JSON.parse(readFileSync(process.env.SCENEWEAVE_HISTORY_CASES,'utf8')):{}
const content=(document:object)=>{
  const {revision:_revision,updatedAt:_updatedAt,...rest}=document as Record<string,unknown>
  return rest
}
async function select(page:Page,id:string){
  const panel=await openSceneObjects(page)
  const all=panel.getByRole('button',{name:'显示所有图层的对象',exact:true})
  if(await all.isVisible())await all.click()
  await panel.getByLabel('搜索场景对象',{exact:true}).fill(id)
  await panel.locator(`[data-entity-id="${id}"]`).click()
  await openKeyboardPanel(page,'inspector')
}
async function number(page:Page,label:string,value:number){
  const field=page.getByLabel(label,{exact:true})
  await field.fill(String(value))
  await field.press('Tab')
}
async function history(page:Page){
  const panel=(await openWorkspaceModule(page,'历史')).getByRole('region',{name:'命名历史',exact:true})
  await expect(panel.getByLabel('完整保存版本',{exact:true})).toBeEnabled()
  await expect(panel).toHaveAttribute('aria-busy','false')
  return panel
}
async function restorePreview(page:Page,name:string,id:string,mode:'transform'|'entity'){
  const panel=await history(page)
  await panel.getByRole('button',{name:`查看快照 ${name}`,exact:true}).click()
  const details=(await openKeyboardPanel(page,'inspector')).getByRole('region',{name:'历史详情',exact:true})
  await details.getByLabel('恢复对象类型',{exact:true}).selectOption('props')
  await details.getByLabel('局部恢复模式',{exact:true}).selectOption(mode)
  await details.getByLabel('搜索历史物件',{exact:true}).fill(id)
  await details.getByLabel(`恢复物件 ${id}`,{exact:true}).check()
  await details.getByRole('button',{name:'预览局部恢复 · 1 件',exact:true}).click()
  await expect(page.getByRole('status',{name:'局部恢复候选',exact:true})).toBeVisible()
}
async function restoreAdopt(page:Page){
  await openKeyboardPanel(page,'inspector')
  await page.getByLabel('确认恢复完整影响范围',{exact:true}).check()
  await page.getByRole('button',{name:'保护当前并采用',exact:true}).click()
  await keyboardWorkspaceSaved(page)
}
async function picture(page:Page,path:string,audience:'gm'|'player'){
  await closeWorkspaceDrawers(page)
  const download=page.waitForEvent('download')
  await(await mapExportButton(page,audience)).click()
  await(await download).saveAs(path)
  await keyboardWorkspaceSaved(page)
  await page.locator('.workspace-export-menu > summary').click()
}

for(const [key,width] of [['fantasy',1512],['modern',390]] as const)test(`complete ${key} project: material, layer, scoped history and cold continuation at ${width}px`,async({page,browser},info)=>{
  test.skip(!cases[key],'Requires explicit local frozen complete-project inputs')
  test.setTimeout(300000)
  await page.setViewportSize({width,height:width===390?844:982})
  const fixture=cases[key],errors:string[]=[],events:{label:string;revision:number}[]=[]
  page.on('pageerror',error=>errors.push(error.message))
  const backup=async(label:string)=>{
    await closeWorkspaceDrawers(page)
    const saved=await keyboardProjectBackup(page,info.outputPath(label+'.sceneweave'))
    events.push({label,revision:saved.document.revision})
    return saved
  }
  const undo=async()=>{
    await closeWorkspaceDrawers(page)
    await page.getByRole('button',{name:'撤销编辑',exact:true}).click()
    await keyboardWorkspaceSaved(page)
  }
  const redo=async()=>{
    await closeWorkspaceDrawers(page)
    await page.getByRole('button',{name:'重做编辑',exact:true}).click()
    await keyboardWorkspaceSaved(page)
  }
  await page.goto('./#home')
  await page.getByTestId('native-project-file').setInputFiles(fixture.input)
  await keyboardWorkspaceSaved(page)
  const initial=await backup('initial')
  expect(Object.keys(initial.document.props)).toHaveLength(fixture.props)
  expect(Object.keys(initial.document.rooms)).toHaveLength(5)

  // Catalog use retains the selected room; cancellation cannot change the project.
  await select(page,fixture.roomId)
  const useMaterial=async()=>{
    const library=await openWorkspaceModule(page,'素材与布景')
    await library.getByLabel('素材来源',{exact:true}).selectOption('project')
    await library.getByLabel('搜索组件素材',{exact:true}).fill(fixture.materialName)
    await library.getByRole('button',{name:`应用材质 ${fixture.materialName}`,exact:true}).click()
    await openKeyboardPanel(page,'inspector')
    await expect(page.getByRole('region',{name:'候选审阅',exact:true})).toBeVisible()
  }
  await useMaterial()
  await page.getByRole('button',{name:'取消视觉预览',exact:true}).click()
  expect((await backup('material-cancelled')).hashes).toEqual(initial.hashes)
  await useMaterial()
  await page.getByLabel('确认完整影响范围',{exact:true}).check()
  await page.getByRole('button',{name:'采用视觉修改',exact:true}).click()
  await keyboardWorkspaceSaved(page)
  const material=await backup('material-applied')
  expect(material.document.rooms[fixture.roomId].floorStyle?.base.materialRef.id).toBe(fixture.materialId)
  expect(material.document.props).toEqual(initial.document.props)
  await undo()
  expect(content((await backup('material-undone')).document)).toEqual(content(initial.document))
  await redo()
  expect(content((await backup('material-redone')).document)).toEqual(content(material.document))

  await select(page,fixture.roomId)
  const visual=await openVisualTask(page,'铺装')
  await expect(visual.getByLabel('视觉铺装对象',{exact:true})).toHaveValue(fixture.roomId)
  await visual.getByLabel('视觉纹理方向 °',{exact:true}).fill('30')
  await visual.getByRole('button',{name:'预览铺装',exact:true}).click()
  await page.getByLabel('确认完整影响范围',{exact:true}).check()
  await page.getByRole('button',{name:'采用视觉修改',exact:true}).click()
  await keyboardWorkspaceSaved(page)
  const floorEdited=await backup('floor-edited')
  expect(floorEdited.document.rooms[fixture.roomId].floorStyle?.base.rotationDeg).toBe(30)

  // This real named snapshot precedes the containing-layer change and outside edits.
  const snapshotName='完整作品位置与实体基线'
  let panel=await history(page)
  await panel.getByRole('button',{name:'新建命名快照',exact:true}).click()
  await panel.getByLabel('命名快照名称',{exact:true}).fill(snapshotName)
  await panel.getByRole('button',{name:'保存快照',exact:true}).click()
  await expect(page.locator('.asset-busy')).toHaveCount(0)
  panel=await history(page)
  await expect(panel.getByRole('button',{name:`查看快照 ${snapshotName}`,exact:true})).toBeVisible()
  expect((await backup('snapshot-created')).hashes).toEqual(floorEdited.hashes)
  let navigation=await openWorkspaceModule(page,'场景')
  const layerName='继续编辑保全层'
  await navigation.getByRole('button',{name:'新建用户图层',exact:true}).click()
  await navigation.getByLabel('新图层名称',{exact:true}).fill(layerName)
  await navigation.getByRole('button',{name:'创建图层',exact:true}).click()
  await keyboardWorkspaceSaved(page)
  const layerCreated=await backup('layer-created')
  const layer=Object.values(layerCreated.document.userLayers).find(layer=>layer.name===layerName)!
  expect(layer).toBeTruthy()
  await select(page,fixture.target)
  const layerPreview=async()=>{
    navigation=await openWorkspaceModule(page,'场景')
    await navigation.getByRole('button',{name:'移动所选到图层 · 1',exact:true}).click()
    await navigation.getByLabel('图层操作目标',{exact:true}).selectOption(layer.id)
    await navigation.getByRole('button',{name:'预览图层修改',exact:true}).click()
    await openKeyboardPanel(page,'inspector')
    await expect(page.getByRole('region',{name:'候选审阅',exact:true})).toBeVisible()
  }
  await layerPreview()
  await page.getByRole('button',{name:'取消图层预览',exact:true}).click()
  expect((await backup('layer-cancelled')).hashes).toEqual(layerCreated.hashes)
  await layerPreview()
  await page.getByRole('button',{name:'采用图层修改',exact:true}).click()
  await keyboardWorkspaceSaved(page)
  const layered=await backup('layer-moved')
  expect(layered.document.entityLayers[fixture.target]).toBe(layer.id)
  expect(layered.document.props).toEqual(floorEdited.document.props)
  await select(page,fixture.target)
  await number(page,'物件 X',(initial.document.props[fixture.target].positionMm.x+100)/1000)
  await keyboardWorkspaceSaved(page)
  await select(page,fixture.outside)
  await number(page,'物件 X',(initial.document.props[fixture.outside].positionMm.x+50)/1000)
  await keyboardWorkspaceSaved(page)
  const tip=await backup('before-restore')
  await picture(page,info.outputPath('before-restore-gm.png'),'gm')

  await restorePreview(page,snapshotName,fixture.target,'transform')
  await openKeyboardPanel(page,'inspector')
  await page.getByRole('button',{name:'取消局部恢复',exact:true}).click()
  expect((await backup('restore-cancelled')).hashes).toEqual(tip.hashes)
  await restorePreview(page,snapshotName,fixture.target,'transform')
  await page.screenshot({path:info.outputPath('restore-candidate.png')})
  await restoreAdopt(page)
  const restored=await backup('transform-restored')
  expect(restored.document.revision).toBe(tip.document.revision+1)
  const expectedProps={...tip.document.props,[fixture.target]:{...tip.document.props[fixture.target],positionMm:floorEdited.document.props[fixture.target].positionMm,rotationDeg:floorEdited.document.props[fixture.target].rotationDeg}}
  expect(content(restored.document)).toEqual(content({...tip.document,props:expectedProps}))
  expect(restored.identity).toEqual(tip.identity)
  expect(restored.appearance).toEqual(tip.appearance)
  expect(keyboardResourceHashes(restored.hashes)).toEqual(keyboardResourceHashes(initial.hashes))
  panel=await history(page)
  await expect(panel.getByLabel('保护快照列表',{exact:true}).locator('.history-snapshot-row')).toHaveCount(1)
  await undo()
  expect(content((await backup('transform-undone')).document)).toEqual(content(tip.document))
  await redo()
  const redone=await backup('transform-redone')
  expect(content(redone.document)).toEqual(content(restored.document))
  await picture(page,info.outputPath('before-delete-gm.png'),'gm')
  await picture(page,info.outputPath('before-delete-player.png'),'player')

  // A second, independent object is deleted and explicitly reconstructed from the
  // actual snapshot. Current outside movement, floor and layer must all survive.
  await select(page,fixture.deleted)
  await page.getByRole('button',{name:'删除物件',exact:true}).click()
  await keyboardWorkspaceSaved(page)
  const deleted=await backup('deleted')
  expect(deleted.document.props[fixture.deleted]).toBeUndefined()
  expect(Object.keys(deleted.document.props)).toHaveLength(fixture.props-1)
  await restorePreview(page,snapshotName,fixture.deleted,'entity')
  await restoreAdopt(page)
  const rebuilt=await backup('entity-restored')
  expect(rebuilt.document.revision).toBe(deleted.document.revision+1)
  expect(rebuilt.document.props[fixture.deleted]).toEqual(floorEdited.document.props[fixture.deleted])
  expect(content(rebuilt.document)).toEqual(content(redone.document))
  // Default entity recovery freezes historical effective appearance to this
  // object. Its new derived source is allowed; all other graph records stay exact.
  const oldSource=redone.appearance.propSources[fixture.deleted]
  const newSource=rebuilt.appearance.propSources[fixture.deleted]
  expect(newSource).not.toBe(oldSource)
  expect(rebuilt.appearance.sources[newSource].parentSourceId).toBe(oldSource)
  expect(Object.keys(rebuilt.appearance.sources).filter(id=>!redone.appearance.sources[id])).toEqual([newSource])
  for(const [id,source]of Object.entries(redone.appearance.sources))expect(rebuilt.appearance.sources[id]).toEqual(source)
  const except=(values:object,id:string)=>Object.fromEntries(Object.entries(values).filter(([key])=>key!==id))
  expect(except(rebuilt.appearance.propSources,fixture.deleted)).toEqual(except(redone.appearance.propSources,fixture.deleted))
  expect(except(rebuilt.appearance.instanceAdjustments,fixture.deleted)).toEqual(except(redone.appearance.instanceAdjustments,fixture.deleted))
  expect(rebuilt.appearance.layerAdjustments).toEqual(redone.appearance.layerAdjustments)
  expect(rebuilt.appearance.surfaceSources).toEqual(redone.appearance.surfaceSources)
  expect(rebuilt.appearance.prefabAppearanceTemplates).toEqual(redone.appearance.prefabAppearanceTemplates)
  expect(keyboardResourceHashes(rebuilt.hashes)).toEqual(keyboardResourceHashes(initial.hashes))
  panel=await history(page)
  await expect(panel.getByLabel('保护快照列表',{exact:true}).locator('.history-snapshot-row')).toHaveCount(2)
  await undo()
  expect(content((await backup('entity-undone')).document)).toEqual(content(deleted.document))
  await redo()
  const final=await backup('final')
  expect(content(final.document)).toEqual(content(rebuilt.document))
  await picture(page,info.outputPath('final-gm.png'),'gm')
  await picture(page,info.outputPath('final-player.png'),'player')
  await closeWorkspaceDrawers(page)
  await page.getByRole('button',{name:'回到首页',exact:true}).click()
  await page.reload()
  await page.locator(`[data-project-key="native:${final.document.sceneId}"]`).getByRole('button',{name:'打开',exact:true}).click()
  await keyboardWorkspaceSaved(page)
  const cold=await backup('cold')
  expect(cold.hashes).toEqual(final.hashes)
  panel=await history(page)
  await expect(panel.getByRole('button',{name:`查看快照 ${snapshotName}`,exact:true})).toBeVisible()
  await expect(panel.getByLabel('保护快照列表',{exact:true}).locator('.history-snapshot-row')).toHaveCount(2)
  await panel.getByLabel('备份携带所选快照',{exact:true}).check()
  await panel.getByRole('button',{name:'全选',exact:true}).click()
  await expect(panel.getByLabel('历史备份完整范围',{exact:true})).toHaveCount(1)
  const historyDownload=page.waitForEvent('download',{timeout:60000})
  await panel.getByRole('button',{name:'下载工程与所选历史 · 3 份',exact:true}).click()
  await(await historyDownload).saveAs(info.outputPath('with-history.sceneweave'))
  await keyboardWorkspaceSaved(page)
  await select(page,fixture.outside)
  await expect(page.getByLabel('物件 X',{exact:true})).toHaveValue(String((initial.document.props[fixture.outside].positionMm.x+50)/1000))
  await page.screenshot({path:info.outputPath('cold-continued.png')})
  await number(page,'物件 X',(initial.document.props[fixture.outside].positionMm.x+75)/1000)
  await keyboardWorkspaceSaved(page)
  const continued=await backup('cold-continued')
  expect(continued.document.revision).toBe(cold.document.revision+1)
  await undo()
  expect(content((await backup('cold-continued-undo')).document)).toEqual(content(cold.document))
  await picture(page,info.outputPath('cold-gm.png'),'gm')
  await picture(page,info.outputPath('cold-player.png'),'player')
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
  expect(errors).toEqual([])
  await writeFile(info.outputPath('facts.json'),JSON.stringify({key,width,input:fixture,snapshotName,layerId:layer.id,browserVersion:browser.version(),events,errors,excludes:['all restore modes and dependencies','cross-tab failure matrix','full QA-REC','human and user P3']},null,2)+'\n')
})
