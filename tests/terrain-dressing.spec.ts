import { expect, test, type Page } from '@playwright/test'
import type { Workspace } from '../src/application/workspace/workspace.js'

async function state(page:Page){
  return page.evaluate(async()=>{
    const path='/src/application/workspace/project.ts',hashPath='/src/shared/project/validate.ts',runtimePath='/src/platform/browser/runtime.ts'
    const {toBundle}=await import(path),{projectContentHash}=await import(hashPath),{projectRepository}=await import(runtimePath)
    const workspace=(Reflect.get(window,'__sceneweaveOutdoorDev') as {workspace:Workspace}).workspace,project=workspace.getState().project!
    const cold=await projectRepository.load(project.document.sceneId)
    return {document:project.document,hash:projectContentHash(toBundle(project).project),coldHash:cold?projectContentHash(cold.project):null}
  })
}

test('dressing UI cancels safely and adopts all sources and editable groups as one undo unit',async({page})=>{
  test.setTimeout(240_000)
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message))
  await page.goto('/#workspace')
  await page.getByRole('tab',{name:'工程',exact:true}).click()
  await page.getByRole('button',{name:'生成地形预览',exact:true}).click()
  await expect(page.getByRole('button',{name:'采用当前地形方案',exact:true})).toBeEnabled({timeout:90000})
  await page.getByRole('button',{name:'采用当前地形方案',exact:true}).click()
  await expect(page.locator('.asset-save')).toHaveText('本地已保存',{timeout:90000})
  const before=await state(page),preview=page.getByRole('button',{name:'预览地形层次与布景',exact:true})
  await preview.click()
  await expect(page.getByLabel('确认完整影响范围',{exact:true})).toBeVisible({timeout:90000})
  expect((await state(page)).hash).toBe(before.hash)
  await expect(page.getByRole('button',{name:'采用视觉修改',exact:true})).toBeDisabled()
  await page.getByRole('button',{name:'取消视觉预览',exact:true}).click()
  expect((await state(page)).hash).toBe(before.hash)
  await preview.click()
  await expect(page.getByLabel('确认完整影响范围',{exact:true})).toBeVisible({timeout:90000})
  await page.getByLabel('确认完整影响范围',{exact:true}).check()
  await page.getByRole('button',{name:'采用视觉修改',exact:true}).click()
  await expect(page.getByLabel('确认完整影响范围',{exact:true})).toBeHidden({timeout:90000})
  await expect.poll(async()=>(await state(page)).document.revision,{timeout:90000}).toBe(before.document.revision+1)
  await expect(page.locator('.asset-save')).toHaveText('本地已保存',{timeout:90000})
  const after=await state(page)
  expect(after.document.revision).toBe(before.document.revision+1)
  expect(after.hash).toBe(after.coldHash)
  expect(Object.values(after.document.scatterGroups).some(group=>group.algorithmVersion==='scatter-cell-v2')).toBe(true)
  expect(Object.values(after.document.propDefinitions).filter(def=>def.catalogId.startsWith('prop.sceneweave.terrain-dressing.'))).toHaveLength(6)
  expect(after.document.terrainAreas).toEqual(before.document.terrainAreas)
  for(const prop of Object.values(before.document.props))expect(after.document.props[prop.id]).toEqual(prop)
  await page.getByRole('button',{name:'撤销素材编辑',exact:true}).click()
  await expect.poll(async()=>(await state(page)).document.revision).toBe(after.document.revision+1)
  const undone=await state(page)
  expect(undone.document.props).toEqual(before.document.props)
  expect(undone.document.propDefinitions).toEqual(before.document.propDefinitions)
  expect(errors).toEqual([])
})
