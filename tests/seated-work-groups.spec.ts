import {test,expect} from '@playwright/test'
import {writeFile} from 'node:fs/promises'
import {openGenerationTask} from './workspace-navigation-helpers'
import {keyboardWorkspaceSaved,keyboardProjectBackup,keyboardResourceHashes,selectKeyboardProp} from './keyboard-ux-helpers'
import {polygonDistance,propFootprint} from '../src/shared/geometry/geometry'
import {getLegacyGeneration} from '../src/shared/terrain-generation/composition-contracts'

for(const domain of ['interior','mixed'] as const)test(`${domain} seated work units use the current recipe and preserve manual edits through cold saving`,async({page},info)=>{
  test.setTimeout(180000)
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message))
  await page.goto('./#home')
  await page.getByTestId('workspace-home').getByRole('button',{name:'新建场景',exact:true}).click()
  const dialog=page.getByRole('dialog',{name:'新建空白场景',exact:true})
  await dialog.getByLabel('场景名称',{exact:true}).fill(`办公接待单元原工程-${domain}`)
  await dialog.getByRole('button',{name:'创建空白场景',exact:true}).click()
  await expect(dialog).toHaveCount(0);await keyboardWorkspaceSaved(page)
  await openGenerationTask(page,domain==='interior'?'室内布局':'混合场景')
  const inspector=page.getByTestId('workspace-inspector'),title=`办公接待单元-${domain}`
  if(domain==='interior'){
    const panel=page.getByRole('region',{name:'室内布局生成',exact:true})
    await panel.getByLabel('室内工程名称',{exact:true}).fill(title)
    await panel.getByLabel('室内建筑宽米',{exact:true}).fill('14')
    await panel.getByLabel('室内建筑高米',{exact:true}).fill('10')
    await panel.getByLabel('房间1用途',{exact:true}).fill('研究办公室')
    await panel.getByLabel('房间2用途',{exact:true}).fill('接待会客室')
    await panel.getByRole('button',{name:'预览室内布局',exact:true}).click()
    const candidate=inspector.getByLabel('室内布局候选摘要',{exact:true})
    await expect(candidate).toBeVisible({timeout:60000})
    await candidate.getByRole('button',{name:'保存为新工程',exact:true}).click()
    await expect(page.getByRole('alert').filter({hasText:'室内布局已完整保存'})).toBeVisible({timeout:60000})
  }else{
    const panel=page.getByRole('region',{name:'混合场景生成',exact:true,includeHidden:true})
    await expect(panel.getByLabel('混合接路算法版本',{exact:true})).toHaveValue('19')
    await panel.getByLabel('混合工程名称',{exact:true}).fill(title)
    await panel.getByLabel('混合建筑房间用途',{exact:true}).fill('研究办公室')
    await panel.getByRole('button',{name:'预览混合场景',exact:true}).click()
    const candidate=inspector.getByLabel('混合候选摘要',{exact:true})
    await expect(candidate).toBeVisible({timeout:90000})
    await candidate.getByRole('button',{name:'保存混合场景为新工程',exact:true}).click()
    await expect(page.getByRole('alert').filter({hasText:'混合场景已完整保存并打开'})).toBeVisible({timeout:90000})
  }
  await keyboardWorkspaceSaved(page)
  const generated=await keyboardProjectBackup(page,info.outputPath(`${domain}-generated.sceneweave`))
  const recipes=Object.values(getLegacyGeneration(generated.document)!.recipes)
  expect(recipes.find(r=>r.algorithmId===(domain==='interior'?'interior-layout':'supported-interior'))).toMatchObject({recipeVersion:19,algorithmVersion:19})
  if(domain==='mixed')expect(recipes.find(r=>r.algorithmId==='mixed-layout')).toMatchObject({recipeVersion:19,algorithmVersion:19})
  const furniture=Object.values(generated.document.props).filter(p=>p.supportRef.kind==='room')
  expect(furniture.length).toBeGreaterThan(2)
  const source=recipes.find(r=>r.algorithmId===(domain==='interior'?'interior-layout':'supported-interior'))!
  const palette=(source.parameters as {arrangement:{palette:{role:string;ref:{id:string;version:number}}[]}}).arrangement.palette
  const role=(p:typeof furniture[number])=>palette.find(r=>r.ref.id===p.definitionRef?.id&&r.ref.version===p.definitionRef.version)?.role
  const seats=furniture.filter(p=>role(p)==='seat'),surfaces=furniture.filter(p=>['work','table'].includes(role(p)??''))
  expect(seats.length).toBeGreaterThan(0);expect(surfaces.length).toBeGreaterThan(0)
  expect(seats.some(seat=>surfaces.some(surface=>seat.roomId===surface.roomId&&polygonDistance(propFootprint(seat),propFootprint(surface))<800))).toBe(true)

  const target=furniture[0]
  await selectKeyboardProp(page,target.id)
  await page.getByRole('button',{name:'删除物件',exact:true}).click();await keyboardWorkspaceSaved(page)
  const edited=await keyboardProjectBackup(page,info.outputPath('deleted.sceneweave'))
  expect(edited.document.props[target.id]).toBeUndefined()
  expect(edited.document.revision).toBe(generated.document.revision+1)
  expect(keyboardResourceHashes(edited.hashes)).toEqual(keyboardResourceHashes(generated.hashes))
  await page.getByRole('button',{name:'撤销编辑',exact:true}).click();await keyboardWorkspaceSaved(page)
  const undone=await keyboardProjectBackup(page,info.outputPath('undone.sceneweave'))
  expect(undone.document.props).toEqual(generated.document.props)
  await page.getByRole('button',{name:'重做编辑',exact:true}).click();await keyboardWorkspaceSaved(page)
  const redone=await keyboardProjectBackup(page,info.outputPath('redone.sceneweave'))
  expect(redone.document.props).toEqual(edited.document.props)
  await page.reload()
  await page.getByRole('button',{name:'回到首页',exact:true}).click()
  await page.getByTestId('workspace-home').locator(`[data-project-key="native:${redone.document.sceneId}"]`).getByRole('button',{name:'打开',exact:true}).click()
  await keyboardWorkspaceSaved(page)
  const cold=await keyboardProjectBackup(page,info.outputPath('cold.sceneweave'))
  expect(cold.hashes).toEqual(redone.hashes)
  expect(cold.document.props[target.id]).toBeUndefined()
  expect(errors).toEqual([])
  await page.screenshot({path:info.outputPath('cold.png')})
  await writeFile(info.outputPath('facts.json'),JSON.stringify({domain,recipes:recipes.map(r=>({id:r.algorithmId,version:r.algorithmVersion})),furniture:furniture.length,deletedId:target.id,revision:cold.document.revision,errors},null,2))
})
