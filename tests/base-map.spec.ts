import { test, expect, type Page } from '@playwright/test'
import { serve } from '@hono/node-server'
import { randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import { loadAiConfig } from '../services/ai/config'
import { createAiApp, connectionInfo } from '../services/ai/app'
import { TaskStore } from '../services/ai/store'
import { TaskEngine } from '../services/ai/engine'

let backendUrl:string,token:string,directory:string,store:TaskStore,engine:TaskEngine,server:ReturnType<typeof serve>,providerCalls=0

test.beforeAll(async()=>{
  directory=mkdtempSync(join(tmpdir(),'sceneweave-base-map-browser-'));token=randomBytes(24).toString('hex')
  const config=loadAiConfig({SCENEWEAVE_AI_DATA_DIR:directory,SCENEWEAVE_AI_ALLOWED_ORIGINS:new URL(process.env.SCENEWEAVE_TEST_BASE_URL??'http://127.0.0.1:5173').origin,
    SCENEWEAVE_AI_ACCESS_TOKEN:token,SCENEWEAVE_AI_PROVIDER_BASE_URL:'http://127.0.0.1:9999/v1',SCENEWEAVE_AI_PROVIDER_API_KEY:'base-map-test-not-a-live-key',SCENEWEAVE_AI_PROVIDER_MODEL:'test-model'})
  store=new TaskStore(directory)
  engine=new TaskEngine(store,{async complete(){providerCalls++;throw new Error('Program generation must never call a provider')}},connectionInfo(config))
  server=serve({fetch:createAiApp(config,{store,engine}).fetch,hostname:'127.0.0.1',port:0})
  await new Promise<void>(resolve=>{if(server.listening)resolve();else server.once('listening',resolve)})
  backendUrl=`http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
test.afterAll(async()=>{engine?.close();if(server&&'closeAllConnections'in server)server.closeAllConnections();await new Promise<void>(resolve=>server?.close(()=>resolve()));store?.close();if(directory)rmSync(directory,{recursive:true,force:true})})

async function current(page:Page){return page.evaluate(async()=>{
  const workspacePath='/src/editor/main/Workbench.tsx',projectPath='/src/application/workspace/project.ts',hashPath='/src/shared/project/validate.ts',runtimePath='/src/platform/browser/runtime.ts'
  const {nativeWorkspace}=await import(workspacePath),{toBundle}=await import(projectPath),{projectContentHash}=await import(hashPath),{projectRepository}=await import(runtimePath)
  const project=nativeWorkspace.getState().project
  if(!project)return null
  const cold=await projectRepository.load(project.document.sceneId)
  return {sceneId:project.document.sceneId,version:project.schemaVersion,hash:projectContentHash(toBundle(project).project),coldHash:cold?projectContentHash(cold.project):null}
})}

test('actual Worker and HTTP produce the same four base maps with real images, complete cold reads and no provider calls',async({page},info)=>{
  test.setTimeout(300_000)
  await page.goto('/')
  const rows=await page.evaluate(async({backendUrl,token})=>{
    const paths={client:'/src/platform/browser/terrain-generation/base-map-client.ts',protocol:'/src/shared/terrain-generation/base-map.ts',blank:'/src/platform/browser/content/refined-blank.ts',sample:'/src/platform/browser/content/refined-island.ts',workspace:'/src/application/workspace/workspace.ts',repository:'/src/platform/browser/storage/repository.ts',runtime:'/src/platform/browser/runtime.ts',project:'/src/application/workspace/project.ts',hash:'/src/shared/project/validate.ts',json:'/src/shared/validation/json.ts',file:'/src/shared/project/file.ts',renderer:'/src/platform/browser/render/renderer.ts'}
    const {createBaseMapGenerationClient}=await import(paths.client),{prepareBaseMapRequest}=await import(paths.protocol),{createRefinedBlankProject}=await import(paths.blank),{createRefinedIslandProject}=await import(paths.sample)
    const {Workspace}=await import(paths.workspace),{ProjectRepository}=await import(paths.repository),{runtime,validation}=await import(paths.runtime),{toBundle}=await import(paths.project),{projectContentHash}=await import(paths.hash),{canonicalJson}=await import(paths.json),{exportProject,importProject}=await import(paths.file),{exportPng}=await import(paths.renderer)
    const name=`base-map-browser-proof-${crypto.randomUUID()}`,repo=new ProjectRepository({name,runtime,validation}),workspace=new Workspace(repo,{runtime,validation}),client=createBaseMapGenerationClient(),rows=[]
    const hash=(project:any)=>projectContentHash(toBundle(project).project)
    const base64=(bytes:Uint8Array)=>{let result='';for(let i=0;i<bytes.length;i+=32768)result+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(result)}
    try{
      await workspace.adoptNew(await createRefinedIslandProject())
      for(const kind of ['island','coast','archipelago','tidalCoast']){
        const composition=kind==='archipelago'||kind==='tidalCoast',widthMm=composition?48000:24000,heightMm=composition?36000:18000
        const base=await createRefinedBlankProject(kind==='coast'?'coast':'island',{sceneId:runtime.ids.nextId(),title:'Native base-map proof',now:'2026-10-29T07:00:00.000Z',widthMm,heightMm,preset:'narrative',gridVisible:false})
        const before=workspace.getState().project,beforeHash=hash(before),checkpoint=workspace.checkpoint()
        const request=prepareBaseMapRequest({requestId:runtime.ids.nextId(),workspaceSceneId:before.document.sceneId,checkpoint,operationEpoch:1,base:base.document,generation:composition
          ?{kind:'composition',input:{sceneId:base.document.sceneId,preset:kind,seed:'terrain-compose-0',widthMm,heightMm,recipeVersion:2}}
          :{kind:'terrain',input:{sceneId:base.document.sceneId,kind,seed:'terrain-v1-0',widthMm,heightMm,algorithmVersion:2}}})
        const worker=await client.generate(request),remote=await client.generate(request,{server:{baseUrl:backendUrl,token},isCurrent:()=>workspace.checkpoint()===checkpoint})
        if(canonicalJson(worker)!==canonicalJson(remote))throw new Error('Worker and HTTP results differ')
        const preview=await workspace.previewBaseMapGeneration(base,request,remote,{source:'server'})
        if(hash(workspace.getState().project)!==beforeHash)throw new Error('Preview changed current map')
        if(preview.baseMap.initialOperationCost+preview.baseMap.remainingOperationCost!==256)throw new Error('Flow budget mismatch')
        const png=base64(new Uint8Array(await(await exportPng(toBundle(preview.project),{audience:'gm',longEdgePx:1000})).arrayBuffer()))
        await workspace.adoptTerrainGeneration(preview)
        const cold=await repo.load(base.document.sceneId),savedHash=hash(workspace.getState().project)
        if(projectContentHash(cold.project)!==savedHash||preview.baseMap.projectHash!==savedHash)throw new Error('Repository cold hash mismatch')
        if(projectContentHash((await repo.load(before.document.sceneId)).project)!==beforeHash)throw new Error('Previous map was overwritten')
        const bytes=await exportProject(toBundle(workspace.getState().project),validation),round=await importProject(bytes,validation)
        if(projectContentHash(round.project)!==savedHash||Object.hasOwn(round.project,'baseMap'))throw new Error('Complete package receipt boundary changed')
        rows.push({kind,domainHash:remote.resultHash,projectHash:savedHash,version:round.project.schemaVersion,cost:preview.cost.total,remaining:preview.baseMap.remainingOperationCost,assets:Object.keys(round.project.assets).length,png,package:base64(bytes)})
      }
      return rows
    }finally{client.dispose();await workspace.close();repo.close();await new Promise<void>((resolve,reject)=>{const request=indexedDB.deleteDatabase(name);request.onsuccess=()=>resolve();request.onerror=()=>reject(request.error)})}
  },{backendUrl,token})
  for(const row of rows){
    expect(row.cost).toBeLessThanOrEqual(256)
    await info.attach(`base-map-${row.kind}.png`,{body:Buffer.from(row.png,'base64'),contentType:'image/png'})
    await info.attach(`base-map-${row.kind}.sceneweave`,{body:Buffer.from(row.package,'base64'),contentType:'application/zip'})
  }
  await info.attach('native-base-map-results.json',{body:JSON.stringify(rows.map(({png:_png,package:_package,...row})=>row),null,2),contentType:'application/json'})
  expect(providerCalls).toBe(0);expect(store.count()).toBe(0)
})

test('the UI explicitly selects server generation, cancels without changing the current map and adopts independently',async({page})=>{
  test.setTimeout(240_000)
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message))
  const sent:any[]=[];page.on('request',request=>{if(request.url()===`${backendUrl}/v1/terrain/basemap`&&request.method()==='POST')sent.push(request.postDataJSON())})
  await page.goto('/#workspace');await page.getByRole('tab',{name:'工程',exact:true}).click()
  const before=await current(page)
  await page.getByLabel('程序底图生成位置',{exact:true}).selectOption('server')
  await page.getByLabel('程序底图后端地址',{exact:true}).fill(backendUrl)
  await page.getByLabel('程序底图应用访问凭据',{exact:true}).fill(token)
  await page.getByRole('button',{name:'预览地貌组合',exact:true}).click()
  const candidate=page.getByRole('article',{name:'地貌组合候选',exact:true})
  await expect(candidate).toBeVisible({timeout:90000});await expect(page.getByLabel('程序底图本次预算',{exact:true})).toContainText('服务端程序生成')
  expect(await current(page)).toEqual(before)
  await candidate.getByRole('button',{name:'取消组合预览',exact:true}).click();expect(await current(page)).toEqual(before)
  await page.getByRole('button',{name:'预览地貌组合',exact:true}).click();await expect(candidate).toBeVisible({timeout:90000})
  await candidate.getByRole('button',{name:'采用地貌组合',exact:true}).click()
  await expect(candidate).toBeHidden({timeout:90000})
  await expect.poll(async()=>(await current(page))?.version,{timeout:90000}).toBe(4)
  await expect(page.locator('.asset-save')).toHaveText('本地已保存',{timeout:90000})
  const after=await current(page);expect(after!.hash).toBe(after!.coldHash);expect(after!.sceneId).not.toBe(before?.sceneId)
  expect(sent).toHaveLength(2)
  for(const request of sent){expect(request.generation.kind).toBe('composition');expect(request.base.props).toEqual({});expect(request.base.notes).toEqual({});expect(request.base.schemaVersion).toBe(2);expect(request).not.toHaveProperty('historyIdentity');expect(request).not.toHaveProperty('resources')}
  expect(providerCalls).toBe(0);expect(store.count()).toBe(0);expect(errors).toEqual([])
})
