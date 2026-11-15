import { expect, test } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import type { SceneDocument } from '../src/shared/model/scene'
import { createEmptyGeneration5 } from '../src/shared/terrain-generation/composition-contracts'
import { emptyVisualSystem } from '../src/shared/visual/types'
import { createCompositionContent } from '../src/shared/appearance/graph'
import { exportProject } from '../src/shared/project/file'
import { keyboardProjectBackup, keyboardResourceHashes, keyboardWorkspaceSaved, selectKeyboardProp } from './keyboard-ux-helpers'
import { closeWorkspaceDrawers, openSceneSettings } from './workspace-navigation-helpers'

const content = (scene:object) => { const {revision:_revision,updatedAt:_time,...rest}=scene as Record<string,unknown>;return rest }
test('explicit path declarations protect normal edits and survive cancellation, undo and cold import',async({page,browser},info)=>{
  test.setTimeout(180000)
  const errors:string[]=[],events:unknown[]=[];page.on('pageerror',error=>errors.push(error.message))
  const now='2026-11-13T00:00:00.000Z',runtime={ids:{nextId:()=>crypto.randomUUID()},clock:{now:()=>now}}
  const document:SceneDocument={format:'sceneweave-scene',schemaVersion:1,sceneId:'path-fixture',revision:0,title:'保持明确通路',createdAt:now,updatedAt:now,
    units:{world:'mm',display:'m',gridSizeMm:1000,snapMm:100,gridVisible:false},exportBoundsMm:{x:0,y:3000,width:14000,height:2000},floors:{'blank-floor':{id:'blank-floor',name:'ground',boundsMm:{x:0,y:3000,width:14000,height:2000}}},
    vertices:{},walls:{},rooms:{},openings:{},regions:{},notes:{},assets:{},propDefinitions:{},materials:{},terrainAreas:{},terrainEdges:{},terrainConnections:{},paths:{},prefabDefinitions:{},prefabInstances:{},scatterGroups:{},styleThemes:{},activeStyleThemeRef:null,
    props:{item:{id:'item',floorId:'blank-floor',editLocked:false,definitionRef:null,appearance:{kind:'symbol',symbol:'crate',tint:null,opacity:1},positionMm:{x:6000,y:4000},rotationDeg:0,footprintMm:{width:200,height:200},footprintOffsetMm:{x:0,y:0},visualBoundsMm:{x:-100,y:-100,width:200,height:200},blocksMovement:false,blocksSight:false,visibility:'public',supportRef:{kind:'floor',id:'blank-floor'},renderLayer:'object',renderOrder:0,shadowClass:'none',shadowOverride:null}},
    userLayers:{ground:{id:'ground',floorId:'blank-floor',name:'ground',order:0,editLocked:false}},entityLayers:{item:'ground'},
    presetSnapshot:{presetId:'test',presetVersion:1,distanceMode:'metric',source:'original fixture',gridSizeMm:1000},constraints:{entranceOpeningIds:[],wallEndClearanceMm:0,pathChecks:[]},mapMode:'scene',regional:null,
    generation:createEmptyGeneration5(),visual:{version:3,base:{version:2,base:emptyVisualSystem(),materializedEdges:{}},transitions:{}},decorations:{},decorationClusters:{},surfaceRules:{}}
  const bundle={project:{format:'sceneweave-complete-project' as const,schemaVersion:1 as const,...createCompositionContent(document,runtime),assets:{},licenses:{},licenseBindings:[],authoringSources:{}},resources:{async read(){throw Error('No bitmap resources in this fixture')}}}
  const unused=async():Promise<never>=>{throw Error('No bitmap resources in this fixture')},validation={images:{decode:unused,transform:unused,encodePng:unused}}
  await page.goto('./#home')
  await page.getByTestId('native-project-file').setInputFiles({name:'path-draft.sceneweave',mimeType:'application/octet-stream',buffer:Buffer.from(await exportProject(bundle,validation))})
  await keyboardWorkspaceSaved(page)
  const backup=async(label:string)=>{const path=info.outputPath(label+'.sceneweave'),b=await keyboardProjectBackup(page,path);events.push({label,path,revision:b.document.revision,checks:b.document.constraints.pathChecks});return b}
  const initial=await backup('initial')
  const fill=async()=>{
    const settings=await openSceneSettings(page);const panel=settings.locator('.path-checks-panel');if(await panel.getAttribute('open')===null)await panel.locator('summary').click()
    await panel.getByLabel('通路名称',{exact:true}).fill('入口到活动区')
    for(const[label,value]of [['通路起点X','2000'],['通路起点Y','4000'],['通路终点X','12000'],['通路终点Y','4000'],['通路净宽','2000']])await panel.getByLabel(label,{exact:true}).fill(value)
    await panel.getByLabel('通路路线提示',{exact:true}).fill('2000,4000\n12000,4000')
    await panel.getByRole('button',{name:'预览通路声明',exact:true}).click()
    await expect(page.getByLabel('采用后通路声明',{exact:true})).toHaveValue(/2000/)
  }
  await fill();await page.getByRole('button',{name:'取消通路预览',exact:true}).click();await keyboardWorkspaceSaved(page)
  expect((await backup('cancelled')).hashes).toEqual(initial.hashes)
  await fill();await page.getByRole('button',{name:'采用通路声明',exact:true}).click();await keyboardWorkspaceSaved(page)
  const guarded=await backup('guarded');expect(guarded.document.constraints.pathChecks).toHaveLength(1);expect(guarded.document.revision).toBe(initial.document.revision+1)
  expect(guarded.document.constraints.pathChecks[0].name).toBe('入口到活动区')
  expect(content(guarded.document)).toEqual(content({...initial.document,constraints:guarded.document.constraints}))
  expect(keyboardResourceHashes(guarded.hashes)).toEqual(keyboardResourceHashes(initial.hashes))
  await selectKeyboardProp(page,'item');await page.getByRole('button',{name:'预览改为阻挡移动',exact:true}).click()
  await expect(page.locator('.asset-notice')).toContainText('未能证明');await expect(page.locator('.asset-notice')).toContainText('item')
  await expect(page.locator('.asset-notice')).toContainText('入口到活动区')
  await keyboardWorkspaceSaved(page);expect((await backup('blocked-rejected')).hashes).toEqual(guarded.hashes)
  await page.getByRole('button',{name:'撤销编辑',exact:true}).click();await keyboardWorkspaceSaved(page)
  expect(content((await backup('undo')).document)).toEqual(content(initial.document))
  await page.getByRole('button',{name:'重做编辑',exact:true}).click();await keyboardWorkspaceSaved(page)
  const redone=await backup('redo');expect(content(redone.document)).toEqual(content(guarded.document))
  await closeWorkspaceDrawers(page);await page.getByRole('button',{name:'回到首页',exact:true}).click();await page.reload()
  await page.locator(`[data-project-key="native:${redone.document.sceneId}"]`).getByRole('button',{name:'打开',exact:true}).click();await keyboardWorkspaceSaved(page)
  const cold=await backup('cold');expect(cold.hashes).toEqual(redone.hashes)
  await page.setViewportSize({width:390,height:844});const narrow=await openSceneSettings(page)
  const paths=narrow.locator('.path-checks-panel');if(await paths.getAttribute('open')===null)await paths.locator('summary').click();await expect(paths.getByLabel('通路声明',{exact:true})).toBeVisible()
  await paths.getByLabel('通路声明',{exact:true}).selectOption(guarded.document.constraints.pathChecks[0].id)
  await expect(paths.getByLabel('通路名称',{exact:true})).toHaveValue('入口到活动区')
  await expect(paths.getByLabel('通路声明',{exact:true}).locator('option:checked')).toHaveText(/入口到活动区/)
  await page.screenshot({path:info.outputPath('narrow-path-settings.png')})
  const context=await browser.newContext(),independent=await context.newPage()
  try{
    await independent.goto('./#home');await independent.getByTestId('native-project-file').setInputFiles(info.outputPath('cold.sceneweave'));await keyboardWorkspaceSaved(independent)
    const imported=await keyboardProjectBackup(independent,info.outputPath('independent.sceneweave'))
    expect(imported.document.constraints.pathChecks).toEqual(cold.document.constraints.pathChecks)
    expect(keyboardResourceHashes(imported.hashes)).toEqual(keyboardResourceHashes(cold.hashes))
    await selectKeyboardProp(independent,'item');await independent.getByRole('button',{name:'预览改为阻挡移动',exact:true}).click()
    await expect(independent.locator('.asset-notice')).toContainText('未能证明')
  }finally{await context.close()}
  expect(errors).toEqual([]);await writeFile(info.outputPath('facts.json'),JSON.stringify({browserVersion:browser.version(),events,errors},null,2)+'\n')
})
