import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'

async function ready(page: Page) {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '雾灯宅', exact: true })).toBeVisible()
  await expect(page.getByText('本地已保存', { exact: true })).toBeVisible()
}
async function changeNumber(page:Page,label:string,value:string) {
  await page.getByRole('spinbutton',{name:label,exact:true}).fill(value)
  await page.getByRole('spinbutton',{name:label,exact:true}).press('Tab')
}
async function point(page:Page,x:number,y:number) {
  const locator=page.getByTestId('scene-canvas'),box=(await locator.boundingBox())!
  const scale=Number(await locator.getAttribute('data-scale')),vx=Number(await locator.getAttribute('data-view-x')),vy=Number(await locator.getAttribute('data-view-y'))
  return {x:box.x+vx+x*scale,y:box.y+vy+y*scale}
}

test('property edits, atomic rejection, undo/redo, and reopening remain consistent', async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message))
  await ready(page)
  await changeNumber(page,'X 坐标','5.4')
  await expect(page.getByTestId('document-revision')).toHaveText('r1')
  await expect(page.getByRole('spinbutton',{name:'X 坐标',exact:true})).toHaveValue('5.4')
  await page.getByRole('button',{name:'撤销 调整家具位置',exact:true}).click()
  await expect(page.getByTestId('document-revision')).toHaveText('r2')
  await expect(page.getByRole('spinbutton',{name:'X 坐标',exact:true})).toHaveValue('5')
  await page.getByRole('button',{name:'重做 调整家具位置',exact:true}).click()
  await expect(page.getByTestId('document-revision')).toHaveText('r3')
  await changeNumber(page,'X 坐标','1000')
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page.getByTestId('document-revision')).toHaveText('r3')
  await expect(page.getByRole('spinbutton',{name:'X 坐标',exact:true})).toHaveValue('5.4')
  await expect(page.getByText('本地已保存',{exact:true})).toBeVisible()
  await page.reload()
  await expect(page.getByRole('spinbutton',{name:'X 坐标',exact:true})).toHaveValue('5.4')
  await expect(page.getByTestId('document-revision')).toHaveText('r3')
  await expect(page.getByRole('button',{name:'撤销',exact:true})).toBeDisabled()
  expect(errors).toEqual([])
})

test('one drag is one command, Escape cancels, and undo invalidates an in-flight drag',async({page})=>{
  await ready(page)
  let start=await point(page,5000,7600),end=await point(page,5500,7900)
  await page.mouse.move(start.x,start.y);await page.mouse.down();await page.mouse.move(end.x,end.y,{steps:8})
  await expect(page.getByTestId('document-revision')).toHaveText('r0')
  await page.mouse.up()
  await expect(page.getByTestId('document-revision')).toHaveText('r1')
  await expect(page.getByRole('spinbutton',{name:'X 坐标',exact:true})).toHaveValue('5.5')
  start=await point(page,5500,7900);end=await point(page,5900,8200)
  await page.mouse.move(start.x,start.y);await page.mouse.down();await page.mouse.move(end.x,end.y,{steps:5});await page.keyboard.press('Escape');await page.mouse.up()
  await expect(page.getByTestId('document-revision')).toHaveText('r1')
  await expect(page.getByRole('spinbutton',{name:'X 坐标',exact:true})).toHaveValue('5.5')
  await page.mouse.move(start.x,start.y);await page.mouse.down();await page.mouse.move(end.x,end.y,{steps:5})
  await page.keyboard.press('ControlOrMeta+z');await page.mouse.up()
  await expect(page.getByTestId('document-revision')).toHaveText('r2')
  await expect(page.getByRole('spinbutton',{name:'X 坐标',exact:true})).toHaveValue('5')
  const before=await page.getByTestId('scene-canvas').getAttribute('data-scale')
  const center=await point(page,7000,7500)
  await page.mouse.move(center.x,center.y);await page.mouse.wheel(0,-120)
  await expect.poll(()=>page.getByTestId('scene-canvas').getAttribute('data-scale')).not.toBe(before)
  await expect(page.getByTestId('document-revision')).toHaveText('r2')
})

test('shared-wall edits preserve its door; indirect edit locks reject the whole move',async({page})=>{
  await ready(page)
  await page.getByRole('button',{name:'选择书房',exact:true}).click()
  await page.getByRole('button',{name:'锁定编辑',exact:true}).click()
  await expect(page.getByTestId('document-revision')).toHaveText('r1')
  await page.getByRole('button',{name:'选择会客厅 / 书房共用墙',exact:true}).click()
  await changeNumber(page,'墙线 X 坐标','8.4')
  await expect(page.getByTestId('document-revision')).toHaveText('r1')
  await expect(page.getByRole('spinbutton',{name:'墙线 X 坐标',exact:true})).toHaveValue('8')
  await page.getByRole('button',{name:'选择书房',exact:true}).click()
  await page.getByRole('button',{name:'解锁编辑',exact:true}).click()
  await page.getByRole('button',{name:'选择会客厅 / 书房共用墙',exact:true}).click()
  await changeNumber(page,'墙线 X 坐标','8.4')
  await expect(page.getByTestId('document-revision')).toHaveText('r3')
  const relations=await page.evaluate(async()=>{
    const d=(window as any).__sceneweaveDev.store.getState().document
    return {x:d.vertices['v-b2'].xMm,endX:d.vertices['v-e5'].xMm,wall:d.openings['o-b2'].wallId,offset:d.openings['o-b2'].offsetMm,wallCount:Object.keys(d.walls).length}
  })
  expect(relations).toEqual({x:8400,endX:8400,wall:'w-6a',offset:3500,wallCount:10})
})

test('player preview, PNG download, and GM project import complete through the UI',async({page},testInfo)=>{
  await ready(page)
  await page.getByRole('button',{name:'玩家预览',exact:true}).click()
  await expect(page.getByText('玩家会看到的世界',{exact:true})).toBeVisible()
  await expect(page.getByRole('button',{name:'选择书架后的暗门',exact:true})).toHaveCount(0)
  await expect(page.getByRole('button',{name:'选择未寄出的信',exact:true})).toHaveCount(0)
  await page.getByRole('button',{name:'导出地图',exact:true}).click()
  const imageDownload=page.waitForEvent('download')
  await page.getByRole('button',{name:'生成 PNG',exact:true}).click()
  const image=await imageDownload
  expect(image.suggestedFilename()).toBe('sceneweave-player-map.png')
  const imagePath=testInfo.outputPath('player-ui-4k.png');await image.saveAs(imagePath)
  const data=await readFile(imagePath)
  expect(data.subarray(1,4).toString()).toBe('PNG')
  expect([data.readUInt32BE(16),data.readUInt32BE(20)]).toEqual([4096,3234])
  await page.getByRole('button',{name:'主持人',exact:true}).click()
  if(await page.getByRole('button',{name:'关闭提示',exact:true}).isVisible())await page.getByRole('button',{name:'关闭提示',exact:true}).click()
  await page.screenshot({path:testInfo.outputPath('sceneweave-editor.png')})
  const projectDownload=page.waitForEvent('download')
  await page.getByRole('button',{name:'主持人工程',exact:true}).click()
  const project=await projectDownload
  const projectPath=testInfo.outputPath('house.sceneweave');await project.saveAs(projectPath)
  await page.locator('input[type=file]').setInputFiles(projectPath)
  await expect(page.getByRole('dialog',{name:'打开主持人工程'})).toBeVisible()
  await page.getByRole('button',{name:'打开副本',exact:true}).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('button',{name:'选择书架后的暗门',exact:true})).toBeVisible()
  await expect(page.getByTestId('document-revision')).toHaveText('r0')
  await expect(page.getByText('本地已保存',{exact:true})).toBeVisible()
})

test('two editor tabs surface a conflict and preserve the losing branch as a copy',async({page,context})=>{
  await ready(page)
  const second=await context.newPage();await ready(second)
  await changeNumber(page,'X 坐标','5.2')
  await expect(page.getByText('本地已保存',{exact:true})).toBeVisible()
  await changeNumber(second,'Y 坐标','7.9')
  await expect(second.getByText('另一标签已保存此场景。这里的修改已保留，自动写入已暂停。',{exact:true})).toBeVisible()
  await expect(second.getByRole('spinbutton',{name:'Y 坐标',exact:true})).toHaveValue('7.9')
  await second.getByRole('button',{name:'另存副本',exact:true}).click()
  await expect(second.getByRole('heading',{name:'雾灯宅 · 副本',exact:true})).toBeVisible()
  await expect(second.getByText('本地已保存',{exact:true})).toBeVisible()
  await expect(second.getByRole('spinbutton',{name:'Y 坐标',exact:true})).toHaveValue('7.9')
  await expect(page.getByRole('spinbutton',{name:'X 坐标',exact:true})).toHaveValue('5.2')
  const ids=await Promise.all([page,second].map(p=>p.evaluate(()=>(window as any).__sceneweaveDev.store.getState().document.sceneId)))
  expect(ids[0]).not.toBe(ids[1])
  await second.close()
})
