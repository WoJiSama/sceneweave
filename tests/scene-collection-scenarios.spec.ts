import {expect,test} from '@playwright/test'
import {readFile,writeFile} from 'node:fs/promises'
import {SCENE_COLLECTION_SCENARIOS} from '../src/shared/assets/scene-collection-plan'
import {createKeyboardProject,keyboardProjectBackup,keyboardWorkspaceSaved,selectKeyboardProp,openKeyboardPanel} from './keyboard-ux-helpers'
import {openSceneObjects,openWorkspaceModule} from './workspace-navigation-helpers'
import {mapExportButton} from './workspace-ux-helpers'

for(const scenario of SCENE_COLLECTION_SCENARIOS) test(`${scenario.id}: normal scenario download, editing, independent members, export and cold reopen`,async({page,browser},info)=>{
  test.setTimeout(480000)
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message))
  await createKeyboardProject(page,`${scenario.name}下载入口`)
  await openWorkspaceModule(page,'素材与布景')
  const panel=page.getByRole('region',{name:'全场景素材系列',exact:true})
  await panel.locator(':scope > details > summary').click()
  await panel.getByLabel('用途场景年代',{exact:true}).selectOption(scenario.era)
  await panel.getByLabel('可编辑用途场景',{exact:true}).selectOption(scenario.id)
  const download=page.waitForEvent('download')
  await panel.getByRole('button',{name:'下载可编辑用途场景',exact:true}).click()
  const file=info.outputPath(`${scenario.id}.sceneweave`);await(await download).saveAs(file)
  const context=await browser.newContext()
  try {
    const target=await context.newPage();target.on('pageerror',error=>errors.push(error.message))
    await target.goto(new URL('./#home',page.url()).href)
    const chooser=target.waitForEvent('filechooser')
    await target.getByTestId('workspace-home').getByRole('button',{name:'打开工程文件',exact:true}).click();await(await chooser).setFiles(file)
    await keyboardWorkspaceSaved(target)
    const opened=await keyboardProjectBackup(target,info.outputPath('opened.sceneweave'))
    expect(opened.document.title).toBe(scenario.name)
    expect(Object.keys(opened.document.props).length).toBeGreaterThanOrEqual(20)
    expect(Object.keys(opened.document.prefabInstances).length).toBeGreaterThanOrEqual(1)
    const group=Object.values(opened.document.prefabInstances)[0]
    const objects=await openSceneObjects(target,'组合')
    await objects.getByLabel('搜索场景对象',{exact:true}).fill(group.id)
    await objects.locator(`[data-entity-id="${group.id}"]`).click();await openKeyboardPanel(target,'inspector')
    await target.getByRole('button',{name:'拆开组合',exact:true}).click();await keyboardWorkspaceSaved(target)
    const unpacked=await keyboardProjectBackup(target,info.outputPath('unpacked.sceneweave'))
    expect(unpacked.document.prefabInstances[group.id]).toBeUndefined();expect(unpacked.document.props).toEqual(opened.document.props)
    await target.getByRole('button',{name:'撤销编辑',exact:true}).click();await keyboardWorkspaceSaved(target)
    expect((await keyboardProjectBackup(target,info.outputPath('undo-unpack.sceneweave'))).document.prefabInstances).toEqual(opened.document.prefabInstances)
    // A 1mm move checks the ordinary edit transaction without changing a route
    // or crossing an adjacent footprint. The editable source is never rescaled.
    const grouped=new Set(Object.values(opened.document.prefabInstances).flatMap(row=>Object.values(row.members).map(member=>member.propId)))
    const attached=new Set(Object.values(opened.document.attachments??{}).flatMap(row=>row.mode==='embed'?[]:[row.child.id]))
    const prop=Object.values(opened.document.props).find(row=>!grouped.has(row.id)&&!attached.has(row.id))!
    expect(prop).toBeDefined();await selectKeyboardProp(target,prop.id)
    const inspector=await openKeyboardPanel(target,'inspector')
    await inspector.getByLabel('物件 X',{exact:true}).fill(String((prop.positionMm.x+1)/1000));await inspector.getByLabel('物件 X',{exact:true}).press('Enter');await keyboardWorkspaceSaved(target)
    expect((await keyboardProjectBackup(target,info.outputPath('moved.sceneweave'))).document.props[prop.id].positionMm.x).toBe(prop.positionMm.x+1)
    await target.getByRole('button',{name:'撤销编辑',exact:true}).click();await keyboardWorkspaceSaved(target)
    expect((await keyboardProjectBackup(target,info.outputPath('undo-move.sceneweave'))).document.props).toEqual(opened.document.props)
    const render=async(suffix:string)=>{
      const pending=target.waitForEvent('download');await(await mapExportButton(target,'gm')).click()
      const png=info.outputPath(`${scenario.id}-${suffix}.png`);await(await pending).saveAs(png);await target.locator('.workspace-export-menu > summary').click()
      return target.evaluate(async bytes=>{
        const bitmap=await createImageBitmap(new Blob([new Uint8Array(bytes)])),canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height
        const ctx=canvas.getContext('2d')!;ctx.drawImage(bitmap,0,0);bitmap.close()
        return [...new Uint8Array(await crypto.subtle.digest('SHA-256',ctx.getImageData(0,0,canvas.width,canvas.height).data))]
      },[...await readFile(png)])
    }
    const gm=await render('gm');await target.reload();await target.getByRole('button',{name:'回到首页',exact:true}).click()
    await target.getByTestId('workspace-home').locator(`[data-project-key="native:${opened.document.sceneId}"]`).getByRole('button',{name:'打开',exact:true}).click();await keyboardWorkspaceSaved(target)
    const cold=await keyboardProjectBackup(target,info.outputPath('cold.sceneweave'))
    for(const key of ['props','rooms','walls','openings','terrainAreas','prefabInstances','attachments','materials'] as const)expect(cold.document[key]).toEqual(opened.document[key])
    expect(cold.hashes['sources.json']).toBe(opened.hashes['sources.json']);expect(await render('cold')).toEqual(gm)
    await target.screenshot({path:info.outputPath(`${scenario.id}-browser.png`)})
    expect(errors).toEqual([]);await writeFile(info.outputPath('facts.json'),JSON.stringify({scenario:scenario.id,sceneId:opened.document.sceneId,props:Object.keys(opened.document.props).length,coldGmPixelsEqual:true,errors},null,2))
  } finally {await context.close()}
})
