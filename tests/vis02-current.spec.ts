import { expect, test, type Page } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import { createKeyboardProject, keyboardProjectBackup, keyboardResourceHashes, keyboardWorkspaceSaved } from './keyboard-ux-helpers'
import { closeWorkspaceDrawers, openSceneObjects, openSamples, openVisualTask, openSceneSettings } from './workspace-navigation-helpers'
import { mapExportButton } from './workspace-ux-helpers'

const content = (scene: object) => {
  const { revision: _revision, updatedAt: _updatedAt, ...rest } = scene as Record<string, unknown>
  return rest
}
async function select(page: Page, id: string, category: Parameters<typeof openSceneObjects>[1] = '全部') {
  const panel = await openSceneObjects(page, category)
  await panel.getByLabel('搜索场景对象', { exact: true }).fill(id)
  await panel.locator(`[data-entity-id="${id}"]`).click()
}
async function number(page: Page, label: string, value: string) {
  const field = page.getByLabel(label, { exact: true })
  await field.fill(value); await field.press('Tab')
}
async function adopt(page: Page, kind: 'component' | 'outdoor' | 'visual' = 'outdoor') {
  const review = page.getByRole('region', { name: '候选审阅', exact: true })
  await expect(review).toBeVisible()
  if (kind !== 'component') await review.getByLabel('确认完整影响范围', { exact: true }).check()
  await review.getByRole('button', { name: { component: '采用组件修改', outdoor: '采用室外修改', visual: '采用视觉修改' }[kind], exact: true }).click()
  await keyboardWorkspaceSaved(page)
}
async function undo(page: Page) {
  await page.getByRole('button', { name: '撤销编辑', exact: true }).click(); await keyboardWorkspaceSaved(page)
}
async function picture(page: Page, path: string, audience: 'gm' | 'player') {
  const pending = page.waitForEvent('download')
  await (await mapExportButton(page, audience)).click()
  await (await pending).saveAs(path)
  await keyboardWorkspaceSaved(page)
  await page.locator('.workspace-export-menu > summary').click()
}

test('VIS02 current complete sample keeps shoreline, elevation, real connection and manual scatter edits through cold import', async ({ page, browser }, info) => {
  test.setTimeout(300000)
  const errors: string[] = [], events: unknown[] = []
  page.on('pageerror', error => errors.push(error.message))
  const backup = async (label: string) => {
    const path = info.outputPath(label+'.sceneweave'), saved = await keyboardProjectBackup(page,path)
    events.push({ label, path, revision: saved.document.revision })
    return saved
  }
  await createKeyboardProject(page, 'VIS02样板前当前工程')
  await openSamples(page)
  await page.getByRole('region', { name: '场景样板', exact: true }).getByRole('button', { name: '双层岩岛', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '确认打开工程', exact: true })
  await dialog.getByRole('button', { name: '保存并打开副本', exact: true }).click()
  await expect(dialog).toHaveCount(0); await keyboardWorkspaceSaved(page)
  const initial = await backup('initial'), scene = initial.document
  expect(scene.exportBoundsMm).toEqual({x:0,y:0,width:30000,height:27000})
  expect(Object.keys(scene.terrainAreas)).toHaveLength(3)
  expect(Object.keys(scene.props)).toHaveLength(39)
  expect(['island-trees','island-shrubs','island-rocks'].map(id => Object.values(scene.scatterGroups[id].members).filter(m=>m.propId).length)).toEqual([6,12,18])
  expect(scene.terrainAreas['island-low'].groundElevationMm).toBe(1000)
  expect(scene.terrainAreas['island-high'].groundElevationMm).toBe(3000)
  expect(scene.terrainConnections['island-stairs']).toMatchObject({widthMm:2000,from:{positionMm:{x:12500,y:10000}},to:{positionMm:{x:15500,y:10000}}})
  for(const audience of ['gm','player']as const)await picture(page,info.outputPath(`initial-${audience}-4096.png`),audience)

  await openSceneSettings(page)
  await page.getByRole('button',{name:'检查台阶通路',exact:true}).click()
  await expect(page.locator('.asset-travel-ok')).toContainText('2 m')
  await page.getByRole('button',{name:'检查崖边直行',exact:true}).click()
  await expect(page.locator('.asset-travel-blocked')).toBeVisible()
  await select(page,'island-low-v0','顶点与边缘')
  await number(page,'轮廓点 X','3800')
  const review=page.getByRole('region',{name:'候选审阅',exact:true})
  await review.getByRole('button',{name:'取消组件预览',exact:true}).click()
  expect((await backup('shore-cancelled')).hashes).toEqual(initial.hashes)
  await number(page,'轮廓点 X','3800');await adopt(page,'component')
  const shore=await backup('shore-edited')
  expect(shore.document.terrainAreas['island-low'].boundaryMm[0].positionMm.x).toBe(3800)
  expect(shore.document.terrainAreas['island-water'].surfaceStyle!.overlays[0].boundaryMm).not.toEqual(scene.terrainAreas['island-water'].surfaceStyle!.overlays[0].boundaryMm)
  expect(shore.document.props).toEqual(scene.props)
  await undo(page)
  expect(content((await backup('shore-undone')).document)).toEqual(content(scene))

  await select(page,'island-high','结构')
  await number(page,'对象地形高程','4')
  await page.getByRole('button',{name:'预览对象修改',exact:true}).click();await adopt(page)
  const high=await backup('high-raised')
  expect(high.document.terrainAreas['island-high'].groundElevationMm).toBe(4000)
  expect(high.document.terrainConnections).toEqual(scene.terrainConnections)
  for(const audience of ['gm','player']as const)await picture(page,info.outputPath(`raised-${audience}-4096.png`),audience)
  await undo(page)
  const beforeDelete=await backup('height-undone')
  expect(content(beforeDelete.document)).toEqual(content(scene))

  await select(page,'island-stairs','结构')
  await page.getByRole('button',{name:'删除此对象',exact:true}).click()
  await page.getByRole('button',{name:'预览删除室外对象',exact:true}).click()
  await expect(page.locator('.asset-notice')).toContainText(/台阶|通路|连接/)
  expect((await backup('connection-delete-rejected')).hashes).toEqual(beforeDelete.hashes)
  expect((await backup('after-rejection')).document.terrainConnections).toEqual(scene.terrainConnections)

  await openVisualTask(page,'铺装')
  await page.getByLabel('视觉铺装对象',{exact:true}).selectOption('island-high')
  await page.getByRole('button',{name:'重新读取此对象的已保存铺装',exact:true}).click()
  await page.getByText('局部材质覆盖 · 1',{exact:true}).click()
  await page.getByLabel('视觉覆盖1点8x',{exact:true}).fill('17700')
  await page.getByRole('button',{name:'预览铺装',exact:true}).click();await adopt(page,'visual')
  expect((await backup('rock-cover-edited')).document.terrainAreas['island-high'].surfaceStyle!.overlays[0].boundaryMm[7].x).toBe(17700)
  await undo(page)

  const treeId=Object.values(scene.scatterGroups['island-trees'].members).find(m=>m.propId)!.propId!
  await select(page,treeId,'物件与装饰')
  await number(page,'物件 X',String((scene.props[treeId].positionMm.x+100)/1000));await adopt(page)
  await page.getByRole('button',{name:'固定此物件',exact:true}).click();await keyboardWorkspaceSaved(page)
  const fixed=await backup('tree-moved-fixed')
  expect(fixed.document.props[treeId]).toMatchObject({positionMm:{x:scene.props[treeId].positionMm.x+100,y:scene.props[treeId].positionMm.y},editLocked:true})
  const shrubId=Object.values(scene.scatterGroups['island-shrubs'].members).find(m=>m.propId)!.propId!
  await select(page,shrubId,'物件与装饰')
  await page.getByRole('button',{name:'删除并保留排除区',exact:true}).click();await adopt(page)
  const deleted=await backup('shrub-deleted')
  expect(deleted.document.props[shrubId]).toBeUndefined()
  const deletion=deleted.document.scatterGroups['island-shrubs'].exclusions.filter(e=>e.reason==='delete')
  expect(deletion).toHaveLength(1)
  await select(page,'island-shrubs','组合')
  await page.getByLabel('对象散布密度',{exact:true}).fill('.5')
  await page.getByRole('button',{name:'预览重新散布',exact:true}).click()
  await review.getByRole('button',{name:'取消室外预览',exact:true}).click()
  expect((await backup('scatter-cancelled')).hashes).toEqual(deleted.hashes)
  await page.getByRole('button',{name:'预览重新散布',exact:true}).click();await adopt(page)
  const scattered=await backup('scatter-regenerated')
  expect(scattered.document.props[treeId]).toEqual(fixed.document.props[treeId])
  expect(scattered.document.props[shrubId]).toBeUndefined()
  expect(scattered.document.scatterGroups['island-shrubs'].exclusions).toEqual(deleted.document.scatterGroups['island-shrubs'].exclusions)
  expect(scattered.document.scatterGroups['island-shrubs'].densityFactor).toBe(.5)
  await undo(page)
  expect((await backup('scatter-undone')).document.props).toEqual(deleted.document.props)
  await page.getByRole('button',{name:'重做编辑',exact:true}).click();await keyboardWorkspaceSaved(page)

  await openVisualTask(page,'铺装')
  await page.getByLabel('视觉铺装对象',{exact:true}).selectOption('island-high')
  await page.getByRole('button',{name:'重新读取此对象的已保存铺装',exact:true}).click()
  await page.getByLabel('视觉铺装底材',{exact:true}).selectOption('b3-m-03')
  await page.getByLabel('视觉纹理宽 mm',{exact:true}).fill('3000')
  await page.getByLabel('视觉纹理高 mm',{exact:true}).fill('3000')
  await page.getByRole('button',{name:'预览铺装',exact:true}).click();await adopt(page,'visual')
  const final=await backup('final')
  expect(final.document.terrainAreas['island-high'].surfaceStyle!.base).toMatchObject({materialRef:{id:'b3-m-03'},tileSizeMm:{width:3000,height:3000}})
  expect(final.document.terrainConnections).toEqual(scene.terrainConnections)
  expect(keyboardResourceHashes(final.hashes)).toEqual(keyboardResourceHashes(initial.hashes))
  for(const audience of ['gm','player']as const)await picture(page,info.outputPath(`final-${audience}-4096.png`),audience)
  await page.getByRole('button',{name:'回到首页',exact:true}).click();await page.reload()
  await page.locator(`[data-project-key="native:${final.document.sceneId}"]`).getByRole('button',{name:'打开',exact:true}).click();await keyboardWorkspaceSaved(page)
  const cold=await backup('cold');expect(cold.hashes).toEqual(final.hashes)
  await page.setViewportSize({width:390,height:844});await select(page,'island-stairs','结构')
  await expect(page.getByLabel('对象通路净宽',{exact:true})).toBeVisible()
  await closeWorkspaceDrawers(page);await page.screenshot({path:info.outputPath('narrow-390.png')})
  const context=await browser.newContext()
  try{
    const other=await context.newPage();other.on('pageerror',e=>errors.push(e.message))
    await other.goto('./#home')
    await other.getByTestId('native-project-file').setInputFiles(info.outputPath('cold.sceneweave'));await keyboardWorkspaceSaved(other)
    const imported=await keyboardProjectBackup(other,info.outputPath('independent.sceneweave'))
    const audit=(s:object)=>Object.fromEntries(Object.entries(s).filter(([k])=>!['sceneId','revision','createdAt','updatedAt'].includes(k)))
    expect(audit(imported.document)).toEqual(audit(final.document))
    expect(imported.identity).toEqual(final.identity);expect(imported.appearance).toEqual(final.appearance)
    expect(keyboardResourceHashes(imported.hashes)).toEqual(keyboardResourceHashes(final.hashes))
    await select(other,'island-stairs','结构');await number(other,'对象通路净宽','2.1')
    await other.getByRole('button',{name:'预览对象修改',exact:true}).click()
    // The fixed tree remains a protected dependency after import, even though the
    // connection itself is editable. Keep that refusal and edit a free reef.
    await expect(other.locator('.asset-notice').first()).toContainText('锁定')
    expect((await keyboardProjectBackup(other,info.outputPath('independent-stairs-lock-rejected.sceneweave'))).hashes).toEqual(imported.hashes)
    await other.getByRole('button',{name:'取消室外属性草稿',exact:true}).click()
    const scatteredIds=new Set(Object.values(scene.scatterGroups).flatMap(g=>Object.values(g.members).flatMap(m=>m.propId?[m.propId]:[])))
    const reef=Object.values(scene.props).find(p=>!scatteredIds.has(p.id))!
    await select(other,reef.id,'物件与装饰')
    await number(other,'物件 X',String((reef.positionMm.x+100)/1000));await keyboardWorkspaceSaved(other)
    expect((await keyboardProjectBackup(other,info.outputPath('independent-edited.sceneweave'))).document.props[reef.id].positionMm.x).toBe(reef.positionMm.x+100)
    await undo(other)
    for(const audience of ['gm','player']as const){
      await picture(other,info.outputPath(`independent-${audience}-4096.png`),audience)
      expect(await readFile(info.outputPath(`independent-${audience}-4096.png`))).toEqual(await readFile(info.outputPath(`final-${audience}-4096.png`)))
    }
  }finally{await context.close()}
  expect(errors).toEqual([])
  await writeFile(info.outputPath('facts.json'),JSON.stringify({browserVersion:browser.version(),events,treeId,shrubId,deletion,errors},null,2))
})

test('VIS02 regenerating the fixed canopy group retains its own moved and fixed tree', async ({page},info)=>{
  test.setTimeout(120000)
  await createKeyboardProject(page,'VIS02同组固定成员')
  await openSamples(page)
  await page.getByRole('region',{name:'场景样板',exact:true}).getByRole('button',{name:'双层岩岛',exact:true}).click()
  await page.getByRole('dialog',{name:'确认打开工程',exact:true}).getByRole('button',{name:'保存并打开副本',exact:true}).click()
  await keyboardWorkspaceSaved(page)
  const initial=await keyboardProjectBackup(page,info.outputPath('initial.sceneweave'))
  const groupId='island-trees',treeId=Object.values(initial.document.scatterGroups[groupId].members).find(m=>m.propId)!.propId!
  await select(page,treeId,'物件与装饰')
  await number(page,'物件 X',String((initial.document.props[treeId].positionMm.x+100)/1000));await adopt(page)
  await page.getByRole('button',{name:'固定此物件',exact:true}).click();await keyboardWorkspaceSaved(page)
  const fixed=await keyboardProjectBackup(page,info.outputPath('fixed.sceneweave'))
  await select(page,groupId,'组合')
  await page.getByLabel('对象散布密度',{exact:true}).fill('.5')
  await page.getByRole('button',{name:'预览重新散布',exact:true}).click()
  await page.getByRole('button',{name:'取消室外预览',exact:true}).click()
  expect((await keyboardProjectBackup(page,info.outputPath('cancelled.sceneweave'))).hashes).toEqual(fixed.hashes)
  await page.getByRole('button',{name:'预览重新散布',exact:true}).click();await adopt(page)
  const regenerated=await keyboardProjectBackup(page,info.outputPath('regenerated.sceneweave'))
  expect(regenerated.document.props[treeId]).toEqual(fixed.document.props[treeId])
  const key=Object.entries(fixed.document.scatterGroups[groupId].members).find(([,m])=>m.propId===treeId)![0]
  expect(regenerated.document.scatterGroups[groupId].members[key]).toEqual(fixed.document.scatterGroups[groupId].members[key])
  expect(regenerated.document.scatterGroups[groupId].densityFactor).toBe(.5)
  await undo(page)
  const undone=await keyboardProjectBackup(page,info.outputPath('undone.sceneweave'))
  expect(undone.document.props).toEqual(fixed.document.props)
  expect(undone.document.scatterGroups).toEqual(fixed.document.scatterGroups)
  await page.getByRole('button',{name:'重做编辑',exact:true}).click();await keyboardWorkspaceSaved(page)
  const final=await keyboardProjectBackup(page,info.outputPath('final.sceneweave'))
  await page.getByRole('button',{name:'回到首页',exact:true}).click();await page.reload()
  await page.locator(`[data-project-key="native:${final.document.sceneId}"]`).getByRole('button',{name:'打开',exact:true}).click();await keyboardWorkspaceSaved(page)
  expect((await keyboardProjectBackup(page,info.outputPath('cold.sceneweave'))).hashes).toEqual(final.hashes)
  await writeFile(info.outputPath('facts.json'),JSON.stringify({treeId,groupId,initialCount:Object.values(initial.document.scatterGroups[groupId].members).filter(m=>m.propId).length,regeneratedCount:Object.values(regenerated.document.scatterGroups[groupId].members).filter(m=>m.propId).length,fixedMemberRetained:true},null,2))
})
