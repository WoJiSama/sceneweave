import {expect,test} from '@playwright/test'
import {readFile} from 'node:fs/promises'
import {createKeyboardProject,keyboardProjectBackup,keyboardWorkspaceSaved,selectKeyboardProp,openKeyboardPanel} from './keyboard-ux-helpers'
import {openWorkspaceModule} from './workspace-navigation-helpers'
import {mapExportButton} from './workspace-ux-helpers'
test('three living scenes download, explicit tabletop contents follow their host, undo, export and cold reopen normally',async({page,browser},info)=>{
 test.setTimeout(600000)
 await createKeyboardProject(page,'厨房与卫浴样板');await openWorkspaceModule(page,'素材与布景')
 const panel=page.getByRole('region',{name:'全场景素材系列',exact:true});await panel.locator(':scope > details > summary').click()
 await panel.getByLabel('全场景用途大类',{exact:true}).selectOption('kitchen')
 for(const id of ['medieval-kitchen-wash','fantasy-kitchen-wash','period-kitchen-wash']){
  await panel.getByLabel('厨房与卫浴配套场景',{exact:true}).selectOption(id)
  const download=page.waitForEvent('download');await panel.getByRole('button',{name:'下载厨房与卫浴场景',exact:true}).click()
  const file=info.outputPath(`${id}.sceneweave`);await(await download).saveAs(file)
  await expect(panel.getByRole('button',{name:'下载厨房与卫浴场景',exact:true})).toBeEnabled({timeout:120000})
  const context=await browser.newContext()
  try{
   const target=await context.newPage();await target.goto(new URL('./#home',page.url()).href)
   const choose=target.waitForEvent('filechooser');await target.getByTestId('workspace-home').getByRole('button',{name:'打开工程文件',exact:true}).click();await(await choose).setFiles(file);await keyboardWorkspaceSaved(target)
   const opened=await keyboardProjectBackup(target,info.outputPath(`${id}-opened.sceneweave`))
   expect(Object.keys(opened.document.attachments??{})).toHaveLength(5);expect(Object.keys(opened.document.props)).toHaveLength(36)
   const host=Object.values(opened.document.props).find(row=>row.definitionRef?.id.includes('prep-counter'))!
   const child=Object.values(opened.document.props).find(row=>row.definitionRef?.id.includes('-prop-pot-'))!
   await selectKeyboardProp(target,host.id);const inspector=await openKeyboardPanel(target,'inspector')
   await inspector.getByLabel('物件 X',{exact:true}).fill(String((host.positionMm.x+100)/1000));await inspector.getByLabel('物件 X',{exact:true}).press('Enter');await keyboardWorkspaceSaved(target)
   const moved=await keyboardProjectBackup(target,info.outputPath(`${id}-moved.sceneweave`))
   expect(moved.document.props[host.id].positionMm.x).toBe(host.positionMm.x+100);expect(moved.document.props[child.id].positionMm.x).toBe(child.positionMm.x+100)
   await target.getByRole('button',{name:'撤销编辑',exact:true}).click();await keyboardWorkspaceSaved(target)
   expect((await keyboardProjectBackup(target,info.outputPath(`${id}-undo.sceneweave`))).document.props).toEqual(opened.document.props)
   const render=async(suffix:string)=>{
    const download=target.waitForEvent('download');await(await mapExportButton(target,'gm')).click();const png=info.outputPath(`${id}-${suffix}.png`);await(await download).saveAs(png);await target.locator('.workspace-export-menu > summary').click()
    return target.evaluate(async bytes=>{const bitmap=await createImageBitmap(new Blob([new Uint8Array(bytes)])),canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;const ctx=canvas.getContext('2d')!;ctx.drawImage(bitmap,0,0);bitmap.close();return[...new Uint8Array(await crypto.subtle.digest('SHA-256',ctx.getImageData(0,0,canvas.width,canvas.height).data))]},[...await readFile(png)])
   }
   const gm=await render('gm');await target.reload();await target.getByRole('button',{name:'回到首页',exact:true}).click()
   await target.getByTestId('workspace-home').locator(`[data-project-key="native:${opened.document.sceneId}"]`).getByRole('button',{name:'打开',exact:true}).click();await keyboardWorkspaceSaved(target)
   expect(await render('cold')).toEqual(gm);await target.screenshot({path:info.outputPath(`${id}-browser.png`)})
  }finally{await context.close()}
 }
})
