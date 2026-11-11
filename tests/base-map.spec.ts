import { openGenerationTask, openGenerationSettings } from './workspace-navigation-helpers'
import { writeFile } from 'node:fs/promises'
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
    const paths={client:'/src/platform/browser/terrain-generation/base-map-client.ts',protocol:'/src/shared/terrain-generation/base-map-v3.ts',budget:'/src/shared/budget/task-budget.ts',blank:'/src/platform/browser/content/refined-blank.ts',sample:'/src/platform/browser/content/refined-island.ts',workspace:'/src/application/workspace/workspace.ts',repository:'/src/platform/browser/storage/repository.ts',runtime:'/src/platform/browser/runtime.ts',project:'/src/application/workspace/project.ts',hash:'/src/shared/project/validate.ts',json:'/src/shared/validation/json.ts',file:'/src/shared/project/file.ts',renderer:'/src/platform/browser/render/renderer.ts'}
    const {createBaseMapGenerationClient}=await import(paths.client),{prepareBaseMapRequestV3}=await import(paths.protocol),{taskBudgetProfile}=await import(paths.budget),{createRefinedBlankProject}=await import(paths.blank),{createRefinedIslandProject}=await import(paths.sample)
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
        const profile=taskBudgetProfile('small')
        const request=prepareBaseMapRequestV3({profile,flowId:runtime.ids.nextId(),requestId:runtime.ids.nextId(),workspaceSceneId:before.document.sceneId,checkpoint,operationEpoch:1,base:base.document,generation:composition
          ?{kind:'composition',input:{sceneId:base.document.sceneId,preset:kind,seed:'terrain-compose-0',widthMm,heightMm,recipeVersion:4,budgetProfileId:profile.profileId,quality:'standard'}}
          :{kind:'terrain',input:{sceneId:base.document.sceneId,kind,seed:'terrain-v1-0',widthMm,heightMm,algorithmVersion:4,budgetProfileId:profile.profileId,quality:'standard'}}})
        const worker=await client.generate(request),remote=await client.generate(request,{server:{baseUrl:backendUrl,token},isCurrent:()=>workspace.checkpoint()===checkpoint})
        if(canonicalJson(worker)!==canonicalJson(remote))throw new Error('Worker and HTTP results differ')
        const preview=await workspace.previewBaseMapGeneration(base,request,remote,{source:'server'})
        if(hash(workspace.getState().project)!==beforeHash)throw new Error('Preview changed current map')
        if(preview.baseMap.initialOperationCost+preview.baseMap.remainingOperationCost!==profile.semanticTargets)throw new Error('Flow budget mismatch')
        const png=base64(new Uint8Array(await(await exportPng(toBundle(preview.project),{audience:'gm',longEdgePx:1000})).arrayBuffer()))
        await workspace.adoptTerrainGeneration(preview)
        const cold=await repo.load(base.document.sceneId),savedHash=hash(workspace.getState().project)
        if(projectContentHash(cold.project)!==savedHash||preview.baseMap.projectHash!==savedHash)throw new Error('Repository cold hash mismatch')
        if(projectContentHash((await repo.load(before.document.sceneId)).project)!==beforeHash)throw new Error('Previous map was overwritten')
        const bytes=await exportProject(toBundle(workspace.getState().project),validation),round=await importProject(bytes,validation)
        if(projectContentHash(round.project)!==savedHash||Object.hasOwn(round.project,'baseMap'))throw new Error('Complete package receipt boundary changed')
        rows.push({kind,domainHash:remote.resultHash,projectHash:savedHash,version:round.project.schemaVersion,limit:profile.semanticTargets,cost:preview.cost.total,remaining:preview.baseMap.remainingOperationCost,assets:Object.keys(round.project.assets).length,png,package:base64(bytes)})
      }
      return rows
    }finally{client.dispose();await workspace.close();repo.close();await new Promise<void>((resolve,reject)=>{const request=indexedDB.deleteDatabase(name);request.onsuccess=()=>resolve();request.onerror=()=>reject(request.error)})}
  },{backendUrl,token})
  for(const row of rows){
    expect(row.limit).toBe(512);expect(row.cost).toBeLessThanOrEqual(row.limit)
    await info.attach(`base-map-${row.kind}.png`,{body:Buffer.from(row.png,'base64'),contentType:'image/png'})
    await info.attach(`base-map-${row.kind}.sceneweave`,{body:Buffer.from(row.package,'base64'),contentType:'application/zip'})
  }
  await info.attach('native-base-map-results.json',{body:JSON.stringify(rows.map(({png:_png,package:_package,...row})=>row),null,2),contentType:'application/json'})
  expect(providerCalls).toBe(0);expect(store.count()).toBe(0)
})

test('registered budget profiles materialize richer maps across actual Worker and HTTP, preserve resources and cold packages',async({page},info)=>{
  test.setTimeout(300_000)
  await page.goto('/')
  const rows=await page.evaluate(async({backendUrl,token})=>{
    const paths={client:'/src/platform/browser/terrain-generation/base-map-client.ts',protocol:'/src/shared/terrain-generation/base-map-v3.ts',budget:'/src/shared/budget/task-budget.ts',blank:'/src/platform/browser/content/refined-blank.ts',sample:'/src/platform/browser/content/refined-island.ts',workspace:'/src/application/workspace/workspace.ts',repository:'/src/platform/browser/storage/repository.ts',runtime:'/src/platform/browser/runtime.ts',project:'/src/application/workspace/project.ts',hash:'/src/shared/project/validate.ts',json:'/src/shared/validation/json.ts',file:'/src/shared/project/file.ts',renderer:'/src/platform/browser/render/renderer.ts'}
    const {createBaseMapGenerationClient}=await import(paths.client),{prepareBaseMapRequestV3}=await import(paths.protocol),{taskBudgetProfile}=await import(paths.budget),{createRefinedBlankProject}=await import(paths.blank),{createRefinedIslandProject}=await import(paths.sample)
    const {Workspace}=await import(paths.workspace),{ProjectRepository}=await import(paths.repository),{runtime,validation}=await import(paths.runtime),{toBundle}=await import(paths.project),{projectContentHash}=await import(paths.hash),{canonicalJson}=await import(paths.json),{exportProject,importProject}=await import(paths.file),{exportPng}=await import(paths.renderer)
    const name=`base-map-browser-proof-${crypto.randomUUID()}`,repo=new ProjectRepository({name,runtime,validation}),workspace=new Workspace(repo,{runtime,validation}),client=createBaseMapGenerationClient(),rows=[]
    const hash=(project:any)=>projectContentHash(toBundle(project).project)
    const base64=(bytes:Uint8Array)=>{let result='';for(let i=0;i<bytes.length;i+=32768)result+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(result)}
    try{
      await workspace.adoptNew(await createRefinedIslandProject())
      for(const [kind,profileId] of [['island','small'],['island','standard'],['island','expanded'],['archipelago','expanded']]){
        const profile=taskBudgetProfile(profileId)
        const composition=kind==='archipelago'||kind==='tidalCoast',widthMm=composition?48000:24000,heightMm=composition?36000:18000
        const base=await createRefinedBlankProject(kind==='coast'?'coast':'island',{sceneId:runtime.ids.nextId(),title:'Native base-map proof',now:'2026-10-29T07:00:00.000Z',widthMm,heightMm,preset:'narrative',gridVisible:false})
        const before=workspace.getState().project,beforeHash=hash(before),checkpoint=workspace.checkpoint()
        const request=prepareBaseMapRequestV3({profile,flowId:runtime.ids.nextId(),requestId:runtime.ids.nextId(),workspaceSceneId:before.document.sceneId,checkpoint,operationEpoch:1,base:base.document,generation:composition
          ?{kind:'composition',input:{sceneId:base.document.sceneId,preset:kind,seed:'terrain-compose-0',widthMm,heightMm,recipeVersion:4,budgetProfileId:profileId,quality:'standard'}}
          :{kind:'terrain',input:{sceneId:base.document.sceneId,kind,seed:'terrain-v1-0',widthMm,heightMm,algorithmVersion:4,budgetProfileId:profileId,quality:'standard'}}})
        const worker=await client.generate(request),remote=await client.generate(request,{server:{baseUrl:backendUrl,token},isCurrent:()=>workspace.checkpoint()===checkpoint})
        if(canonicalJson(worker)!==canonicalJson(remote))throw new Error('Worker and HTTP results differ')
        const preview=await workspace.previewBaseMapGeneration(base,request,remote,{source:'server',generationExecution:{startedAt:new Date().toISOString(),activeRuntimeMs:1,generationCalls:1}})
        if(hash(workspace.getState().project)!==beforeHash)throw new Error('Preview changed current map')
        if(preview.baseMap.initialOperationCost+preview.baseMap.remainingOperationCost!==profile.semanticTargets)throw new Error('Flow budget mismatch')
        if(preview.baseMap.budgetProfile?.profileHash!==profile.profileHash||preview.baseMap.budgetUsage.assetBytes<=0)throw new Error('Real resource budget missing')
        if(!preview.continuationSource)throw new Error(preview.continuationError??'Source3 missing')
        const legacyExpanded=worker.result.kind==='terrain'?worker.result.terrain.cost.total:null
        if(legacyExpanded!==null&&legacyExpanded<=256)throw new Error('Expected richer candidate beyond legacy mixed256')
        const png=base64(new Uint8Array(await(await exportPng(toBundle(preview.project),{audience:'gm',longEdgePx:1000})).arrayBuffer()))
        await workspace.adoptTerrainGeneration(preview)
        const cold=await repo.load(base.document.sceneId),savedHash=hash(workspace.getState().project)
        if(projectContentHash(cold.project)!==savedHash||preview.baseMap.projectHash!==savedHash)throw new Error('Repository cold hash mismatch')
        if(projectContentHash((await repo.load(before.document.sceneId)).project)!==beforeHash)throw new Error('Previous map was overwritten')
        const bytes=await exportProject(toBundle(workspace.getState().project),validation),round=await importProject(bytes,validation)
        if(projectContentHash(round.project)!==savedHash||Object.hasOwn(round.project,'baseMap'))throw new Error('Complete package receipt boundary changed')
        rows.push({kind,profileId,profileHash:profile.profileHash,limit:profile.semanticTargets,usage:preview.baseMap.budgetUsage,legacyExpanded,domainHash:remote.resultHash,projectHash:savedHash,version:round.project.schemaVersion,cost:preview.cost.total,remaining:preview.baseMap.remainingOperationCost,assets:Object.keys(round.project.assets).length,png,package:base64(bytes)})
      }
      return rows
    }finally{client.dispose();await workspace.close();repo.close();await new Promise<void>((resolve,reject)=>{const request=indexedDB.deleteDatabase(name);request.onsuccess=()=>resolve();request.onerror=()=>reject(request.error)})}
  },{backendUrl,token})
  for(const row of rows){
    expect(row.cost).toBeLessThanOrEqual(row.limit)
    const imageName=`dynamic-budget-${row.profileId}-${row.kind}.png`, projectName=`dynamic-budget-${row.profileId}-${row.kind}.sceneweave`
    await writeFile(info.outputPath(imageName),Buffer.from(row.png,'base64'))
    await writeFile(info.outputPath(projectName),Buffer.from(row.package,'base64'))
    await info.attach(imageName,{path:info.outputPath(imageName),contentType:'image/png'})
    await info.attach(projectName,{path:info.outputPath(projectName),contentType:'application/zip'})
  }
  await writeFile(info.outputPath('dynamic-budget-results.json'),JSON.stringify(rows.map(({png:_png,package:_package,...row})=>row),null,2))
  await info.attach('dynamic-budget-results.json',{path:info.outputPath('dynamic-budget-results.json'),contentType:'application/json'})
  expect(providerCalls).toBe(0);expect(store.count()).toBe(0)
})

test('the UI explicitly selects server generation, cancels without changing the current map and adopts independently',async({page})=>{
  test.setTimeout(240_000)
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message))
  const sent:any[]=[];page.on('request',request=>{if(request.url()===`${backendUrl}/v1/terrain/basemap?baseMapVersion=3`&&request.method()==='POST')sent.push(request.postDataJSON())})
  await page.goto('/#workspace');await openGenerationTask(page, '组合地貌'); await openGenerationSettings(page)
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
  await expect.poll(async()=>(await current(page))?.version,{timeout:90000}).toBe(1)
  await expect(page.locator('.asset-save')).toHaveText('本地已保存',{timeout:90000})
  const after=await current(page);expect(after!.hash).toBe(after!.coldHash);expect(after!.sceneId).not.toBe(before?.sceneId)
  expect(sent).toHaveLength(2)
  for(const request of sent){expect(request).toMatchObject({protocol:'sceneweave-base-map',version:3,type:'generate'});expect(request.generation.kind).toBe('composition');expect(request.base.props).toEqual({});expect(request.base.notes).toEqual({});expect(request.base.schemaVersion).toBe(1);expect(request).not.toHaveProperty('historyIdentity');expect(request).not.toHaveProperty('resources')}
  expect(providerCalls).toBe(0);expect(store.count()).toBe(0);expect(errors).toEqual([])
})

test('terrain algorithm7 finds supported highland plants and closes the same island without changing physical corridors', async ({ page }, info) => {
  test.setTimeout(360_000)
  await page.goto('/')
  const proof = await page.evaluate(async ({ backendUrl, token }: { backendUrl: string; token: string }) => {
    const paths = {
      client: '/src/platform/browser/terrain-generation/base-map-client.ts', protocol: '/src/shared/terrain-generation/base-map-v3.ts',
      blank: '/src/platform/browser/content/shore-blank.ts', sample: '/src/platform/browser/content/refined-island.ts',
      workspace: '/src/application/workspace/workspace.ts', repository: '/src/platform/browser/storage/repository.ts', runtime: '/src/platform/browser/runtime.ts',
      project: '/src/application/workspace/project.ts', hash: '/src/shared/project/validate.ts', json: '/src/shared/validation/json.ts',
      file: '/src/shared/project/file.ts', renderer: '/src/platform/browser/render/renderer.ts', visual: '/src/shared/visual/base.ts',
      geometry: '/src/shared/geometry/geometry.ts', decorationGeometry: '/src/shared/decorations/geometry.ts',
      decorationGeneration: '/src/shared/decorations/generate.ts', projection: '/src/shared/projection/projection.ts',
      landings: '/src/shared/geometry/connection-landings.ts', pixelHash: '/src/shared/validation/hash.ts', budget: '/src/shared/budget/task-budget.ts',
      prepare: '/src/application/workspace/base-map.ts',
    }
    const { createBaseMapGenerationClient } = await import(paths.client)
    const { prepareBaseMapRequestV3 } = await import(paths.protocol)
    const { createShoreBlankProject } = await import(paths.blank)
    const { createRefinedIslandProject } = await import(paths.sample)
    const { Workspace } = await import(paths.workspace), { ProjectRepository } = await import(paths.repository)
    const { runtime, validation } = await import(paths.runtime)
    const { toBundle } = await import(paths.project), { projectContentHash } = await import(paths.hash), { canonicalJson } = await import(paths.json)
    const { exportProject, importProject } = await import(paths.file), { renderProject } = await import(paths.renderer)
    const { visualBase } = await import(paths.visual), { pointOnSurface, propFootprint, supportedPolygon, polygonDistance, connectionFootprint } = await import(paths.geometry)
    const { decorationFootprint } = await import(paths.decorationGeometry), { decorationProtectedGeometry } = await import(paths.decorationGeneration)
    const { projectScene } = await import(paths.projection), { connectionLandingBlend } = await import(paths.landings)
    const { sha256Bytes } = await import(paths.pixelHash), { taskBudgetProfile } = await import(paths.budget)
    const name = `terrain-v7-island-${crypto.randomUUID()}`
    const repo = new ProjectRepository({ name, runtime, validation }), workspace = new Workspace(repo, { runtime, validation }), client = createBaseMapGenerationClient()
    let workspaceClosed = false, repoClosed = false
    const profile = taskBudgetProfile('standard'), base = await createShoreBlankProject('island', { sceneId: runtime.ids.nextId(), title: '高台植被与崖缘 v7 同图',
      now: '2026-11-04T00:00:00.000Z', widthMm: 24000, heightMm: 18000, preset: 'narrative', gridVisible: false }, undefined, true, true)
    const hash = (project: any) => projectContentHash(toBundle(project).project)
    const base64 = (bytes: Uint8Array) => { let result = ''; for (let i = 0; i < bytes.length; i += 32768) result += String.fromCharCode(...bytes.subarray(i, i + 32768)); return btoa(result) }
    const image = async (project: any, audience: 'gm' | 'player', includePng = false) => {
      const canvas = await renderProject(toBundle(project), { audience, longEdgePx: 1600 }), pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data
      return { width: canvas.width, height: canvas.height, pixelHash: sha256Bytes(new Uint8Array(pixels.buffer)),
        ...(includePng ? { png: base64(new Uint8Array(await (await import(paths.renderer)).exportPng(toBundle(project), { audience, longEdgePx: 1600 }).then((blob: Blob) => blob.arrayBuffer()))) } : {}) }
    }
    const requestFor = (algorithmVersion: 6 | 7) => prepareBaseMapRequestV3({ requestId: runtime.ids.nextId(), flowId: runtime.ids.nextId(),
      workspaceSceneId: workspace.getState().project!.document.sceneId, checkpoint: workspace.checkpoint(), operationEpoch: algorithmVersion, profile, base: base.document,
      generation: { kind: 'terrain', input: { sceneId: base.document.sceneId, kind: 'island', seed: 'terrain-v6-closure-20261104',
        widthMm: 24000, heightMm: 18000, algorithmVersion, budgetProfileId: profile.profileId, quality: 'standard' } } })
    try {
      await workspace.adoptNew(await createRefinedIslandProject())
      const originalHash = hash(workspace.getState().project)
      const v6Request = requestFor(6), v6Worker = await client.generate(v6Request)
      const v6Server = await client.generate(v6Request, { server: { baseUrl: backendUrl, token }, isCurrent: () => workspace.checkpoint() === v6Request.checkpoint })
      if (canonicalJson(v6Worker) !== canonicalJson(v6Server)) throw new Error('v6 Worker/HTTP replay differs')
      const { prepareBaseMapProject } = await import(paths.prepare)
      const v6Project = await prepareBaseMapProject(base, v6Request, v6Server, { runtime, validation })
      const v7Request = requestFor(7), v7Worker = await client.generate(v7Request)
      const v7Server = await client.generate(v7Request, { server: { baseUrl: backendUrl, token }, isCurrent: () => workspace.checkpoint() === v7Request.checkpoint })
      if (canonicalJson(v7Worker) !== canonicalJson(v7Server)) throw new Error('v7 Worker/HTTP replay differs')
      const preview = await workspace.previewBaseMapGeneration(base, v7Request, v7Server, { source: 'server', generationExecution: { startedAt: new Date().toISOString(), activeRuntimeMs: 1, generationCalls: 1 } })
      if (hash(workspace.getState().project) !== originalHash) throw new Error('Preview changed the current project')

      const v6Document: any = v6Project.project.document, document: any = preview.project.document
      const highest = (Object.values(document.terrainAreas as Record<string, any>) as any[]).filter(area => area.visibility === 'public' && !area.blocksMovement).sort((a, b) => b.groundElevationMm - a.groundElevationMm)[0]
      const highRules = (Object.values(document.surfaceRules ?? {}) as any[]).filter(rule => rule.field === 'trees' || rule.field === 'shrubs').filter(rule => rule.supportRef.id === highest.id)
      const members = highRules.map(rule => {
        const cluster = document.decorationClusters[rule.clusterId], protectedRows = decorationProtectedGeometry(document, cluster)
        const rows = (Object.values(cluster.members) as any[]).filter(member => member.entityId && member.state === 'managed').map(member => {
          const row = member.kind === 'prop' ? document.props[member.entityId!] : document.decorations[member.entityId!]
          const footprint = member.kind === 'prop' ? propFootprint(row) : decorationFootprint(document, row)
          return { kind: member.kind, support: pointOnSurface(document, row.positionMm, row.supportRef, row.floorId)
            && supportedPolygon(document, footprint, row.supportRef, row.floorId), clear: protectedRows.every((protectedRow: any) => polygonDistance(footprint, protectedRow.polygon) >= protectedRow.marginMm) }
        })
        return { field: rule.field, count: rows.length, valid: rows.every(row => row.support && row.clear), rows }
      })
      const connection = (Object.values(document.terrainConnections) as any[]).find(row => row.kind === 'stairs')!
      const oldConnection = (Object.values(v6Document.terrainConnections) as any[]).find(row => row.kind === 'stairs'
        && canonicalJson([row.from.surfaceRef.id, row.to.surfaceRef.id].sort()) === canonicalJson([connection.from.surfaceRef.id, connection.to.surfaceRef.id].sort()))!
      const ringKey = (ring: { x: number; y: number }[]) => canonicalJson(ring.map(point => [point.x, point.y]).sort((a, b) => a[0] - b[0] || a[1] - b[1]))
      const sameCorridor = ringKey(connectionFootprint(oldConnection)) === ringKey(connectionFootprint(connection))
      const oldArea = Object.fromEntries(Object.entries(v6Document.terrainAreas as Record<string, any>).map(([id, area]) => [id, area.boundaryMm]))
      const newArea = Object.fromEntries(Object.entries(document.terrainAreas as Record<string, any>).map(([id, area]) => [id, area.boundaryMm]))
      const oldConnections = (Object.values(v6Document.terrainConnections) as any[]).map(row => ({ floorId: row.floorId, kind: row.kind, from: row.from, to: row.to,
        widthMm: row.widthMm, openingId: row.openingId, blocksMovement: row.blocksMovement, movementCostMultiplier: row.movementCostMultiplier }))
      const newConnections = (Object.values(document.terrainConnections) as any[]).map(row => ({ floorId: row.floorId, kind: row.kind, from: row.from, to: row.to,
        widthMm: row.widthMm, openingId: row.openingId, blocksMovement: row.blocksMovement, movementCostMultiplier: row.movementCostMultiplier }))
      const physicalMatch = canonicalJson(oldArea) === canonicalJson(newArea) && canonicalJson(oldConnections) === canonicalJson(newConnections) && sameCorridor
      const projection = projectScene(document, 'gm')
      const stair = projection.connections.find((row: any) => row.id === connection.id)
      const landings = (['start', 'end'] as const).map(end => ({ end, depthMm: connectionLandingBlend(stair, end)?.depthMm ?? 0 }))
      const v6Png = await image(v6Project.project, 'gm', true), v7Gm = await image(preview.project, 'gm', true), v7Player = await image(preview.project, 'player')
      await workspace.adoptTerrainGeneration(preview)
      const saved = workspace.getState().project!, savedHash = hash(saved)
      await workspace.close(); workspaceClosed = true; repo.close(); repoClosed = true
      const coldRepo = new ProjectRepository({ name, runtime, validation })
      const cold = await coldRepo.load(base.document.sceneId)
      if (!cold || projectContentHash(cold.project) !== savedHash) throw new Error('v7 cold read hash differs')
      const bytes = await exportProject(cold, validation), round = await importProject(bytes, validation)
      if (projectContentHash(round.project) !== savedHash) throw new Error('v7 complete package cold import hash differs')
      const coldCanvas = await renderProject(cold, { audience: 'gm', longEdgePx: 1600 })
      const coldPixels = coldCanvas.getContext('2d')!.getImageData(0, 0, coldCanvas.width, coldCanvas.height).data
      const v7Cold = { width: coldCanvas.width, height: coldCanvas.height, pixelHash: sha256Bytes(new Uint8Array(coldPixels.buffer)) }
      coldRepo.close()
      return { schemaVersion: round.project.schemaVersion, projectHash: savedHash, v6ResultHash: v6Server.resultHash, v7ResultHash: v7Server.resultHash,
        rules: members, physicalMatch, route: { style: connection.route?.stairStyle ?? null, segmentId: connection.route?.segments[0]?.id ?? null,
          sameCorridor, supportedEnds: [pointOnSurface(document, connection.from.positionMm, connection.from.surfaceRef, connection.floorId),
            pointOnSurface(document, connection.to.positionMm, connection.to.surfaceRef, connection.floorId)], landings },
        images: { v6: v6Png, v7Gm, v7Player, v7Cold } }
    } finally {
      client.dispose()
      if (!workspaceClosed) await workspace.close().catch(() => undefined)
      if (!repoClosed) repo.close()
      await new Promise<void>((resolve, reject) => { const request = indexedDB.deleteDatabase(name); request.onsuccess = () => resolve(); request.onerror = () => reject(request.error) })
    }
  }, { backendUrl, token })

  expect(proof.schemaVersion).toBe(1)
  expect(proof.physicalMatch).toBe(true)
  expect(proof.rules).toHaveLength(2)
  expect(proof.rules.every(rule => rule.count > 0 && rule.valid)).toBe(true)
  expect(proof.route.style).toBe('naturalRock')
  expect(proof.route.sameCorridor).toBe(true)
  expect(proof.route.supportedEnds.every(Boolean)).toBe(true)
  expect(proof.route.landings.every(row => row.depthMm > 0)).toBe(true)
  expect(proof.images.v7Gm.pixelHash).toBe(proof.images.v7Player.pixelHash)
  expect(proof.images.v7Gm.pixelHash).toBe(proof.images.v7Cold.pixelHash)
  for (const [name, row] of Object.entries({ 'terrain-v6-island.png': proof.images.v6, 'terrain-v7-island-gm.png': proof.images.v7Gm })) {
    await info.attach(name, { body: Buffer.from(row.png!, 'base64'), contentType: 'image/png' })
  }
  const report = { ...proof, images: Object.fromEntries(Object.entries(proof.images).map(([key, row]) => [key, { ...row, png: undefined }])) }
  await info.attach('terrain-v7-island-proof.json', { body: JSON.stringify(report, null, 2), contentType: 'application/json' })
  expect(providerCalls).toBe(0)
  expect(store.count()).toBe(0)
})

test('shore surface recipe 5 preserves terrain and resources across Worker HTTP cold packages and original tile pixels', async ({page},info) => {
  test.setTimeout(300_000)
  await page.goto('/')
  const proof = await page.evaluate(async ({backendUrl,token}) => {
    const paths={client:'/src/platform/browser/terrain-generation/base-map-client.ts',protocol:'/src/shared/terrain-generation/base-map-v3.ts',blank:'/src/platform/browser/content/shore-blank.ts',sample:'/src/platform/browser/content/refined-island.ts',workspace:'/src/application/workspace/workspace.ts',repository:'/src/platform/browser/storage/repository.ts',runtime:'/src/platform/browser/runtime.ts',project:'/src/application/workspace/project.ts',hash:'/src/shared/project/validate.ts',json:'/src/shared/validation/json.ts',file:'/src/shared/project/file.ts',renderer:'/src/platform/browser/render/renderer.ts',budget:'/src/shared/budget/task-budget.ts',art:'/src/shared/visual/shore-art.ts',surface:'/src/shared/terrain-generation/surface-generation.ts',prepare:'/src/application/workspace/base-map.ts',visual:'/src/shared/visual/base.ts',types:'/src/shared/visual/types.ts'}
    const {createBaseMapGenerationClient}=await import(paths.client),{prepareBaseMapRequestV3,executeBaseMapRequestV3}=await import(paths.protocol),{createShoreBlankProject}=await import(paths.blank),{createRefinedIslandProject}=await import(paths.sample)
    const {Workspace}=await import(paths.workspace),{ProjectRepository}=await import(paths.repository),{runtime,validation}=await import(paths.runtime),{toBundle,captureEditableDraft}=await import(paths.project),{projectContentHash}=await import(paths.hash),{canonicalJson}=await import(paths.json),{exportProject,importProject}=await import(paths.file),{exportPng}=await import(paths.renderer)
    const {taskBudgetProfile}=await import(paths.budget),{SHORE_MATERIAL_IDS}=await import(paths.art),{terrainPhysicalProjection}=await import(paths.surface),{prepareBaseMapProject}=await import(paths.prepare),{visualBase}=await import(paths.visual),{emptyVisualSystem}=await import(paths.types)
    const name=`shore-surface-proof-${crypto.randomUUID()}`,repo=new ProjectRepository({name,runtime,validation}),workspace=new Workspace(repo,{runtime,validation}),client=createBaseMapGenerationClient(),rows:any[]=[],tiles:any[]=[]
    const hash=(project:any)=>projectContentHash(toBundle(project).project)
    const base64=(bytes:Uint8Array)=>{let result='';for(let i=0;i<bytes.length;i+=32768)result+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(result)}
    const png=async(project:any)=>base64(new Uint8Array(await(await exportPng(toBundle(project),{audience:'gm',longEdgePx:1000})).arrayBuffer()))
    try {
      await workspace.adoptNew(await createRefinedIslandProject())
      for(const kind of ['island','coast','archipelago','tidalCoast']) {
        const composition=kind==='archipelago'||kind==='tidalCoast',widthMm=composition?48000:24000,heightMm=composition?36000:18000
        const base=await createShoreBlankProject(kind==='coast'?'coast':'island',{sceneId:runtime.ids.nextId(),title:'岸崖原生证据',now:'2026-10-30T00:00:00.000Z',widthMm,heightMm,preset:'narrative',gridVisible:false})
        if(!tiles.length)for(const [role,id] of Object.entries(SHORE_MATERIAL_IDS) as [string,string][]) {
          const definition=base.document.materials[id],asset=base.document.assets[definition.textureAssetId],raw=await base.resources.read(asset.sha256),bytes=raw instanceof Blob?new Uint8Array(await raw.arrayBuffer()):raw
          const bitmap=await createImageBitmap(new Blob([bytes],{type:'image/png'}))
          const tile=document.createElement('canvas');tile.width=bitmap.width;tile.height=bitmap.height
          const context=tile.getContext('2d')!;context.drawImage(bitmap,0,0)
          const pixels=context.getImageData(0,0,tile.width,tile.height).data
          let minAlpha=255,maxSeamDelta=0,seamSum=0,count=0
          for(let i=3;i<pixels.length;i+=4)minAlpha=Math.min(minAlpha,pixels[i])
          for(let axis=0;axis<2;axis++)for(let n=0;n<tile.width;n++)for(let channel=0;channel<3;channel++) {
            const a=axis?n*4+channel:n*tile.width*4+channel,b=axis?((tile.height-1)*tile.width+n)*4+channel:(n*tile.width+tile.width-1)*4+channel
            const delta=Math.abs(pixels[a]-pixels[b]);maxSeamDelta=Math.max(maxSeamDelta,delta);seamSum+=delta;count++
          }
          if(minAlpha!==255||seamSum/count>8)throw new Error(`Tile opacity/seam failed: ${role}`)
          const sheet=document.createElement('canvas');sheet.width=tile.width*2;sheet.height=tile.height*2;const paint=sheet.getContext('2d')!
          for(let y=0;y<2;y++)for(let x=0;x<2;x++)paint.drawImage(bitmap,x*tile.width,y*tile.height)
          const data=await new Promise<Blob>(resolve=>sheet.toBlob(value=>resolve(value!),'image/png'));bitmap.close()
          tiles.push({role,id,hash:asset.sha256,width:tile.width,height:tile.height,minAlpha,meanSeamDelta:seamSum/count,maxSeamDelta,png:base64(new Uint8Array(await data.arrayBuffer()))})
        }
        const profile=taskBudgetProfile('standard'),before=workspace.getState().project,beforeHash=hash(before),checkpoint=workspace.checkpoint()
        const generation=composition?{kind:'composition',input:{sceneId:base.document.sceneId,preset:kind,seed:'terrain-compose-0',widthMm,heightMm,recipeVersion:5,budgetProfileId:profile.profileId,quality:'standard'}}:{kind:'terrain',input:{sceneId:base.document.sceneId,kind,seed:'terrain-v1-0',widthMm,heightMm,algorithmVersion:5,budgetProfileId:profile.profileId,quality:'standard'}}
        const request=prepareBaseMapRequestV3({requestId:runtime.ids.nextId(),flowId:runtime.ids.nextId(),workspaceSceneId:before.document.sceneId,checkpoint,operationEpoch:1,profile,base:base.document,generation})
        const worker=await client.generate(request),remote=await client.generate(request,{server:{baseUrl:backendUrl,token},isCurrent:()=>workspace.checkpoint()===checkpoint})
        if(canonicalJson(worker)!==canonicalJson(remote))throw new Error('Surface5 Worker HTTP mismatch')
        const preview=await workspace.previewBaseMapGeneration(base,request,remote,{source:'server',generationExecution:{startedAt:new Date().toISOString(),activeRuntimeMs:1,generationCalls:1}})
        if(!preview.continuationSource)throw new Error(preview.continuationError??'Missing surface5 source')
        if(hash(workspace.getState().project)!==beforeHash)throw new Error('Surface preview changed current map')
        const classicGeneration=composition?{kind:'composition',input:{...generation.input,recipeVersion:4}}:{kind:'terrain',input:{...generation.input,algorithmVersion:4}}
        const classicRequest=prepareBaseMapRequestV3({requestId:runtime.ids.nextId(),flowId:runtime.ids.nextId(),workspaceSceneId:before.document.sceneId,checkpoint,operationEpoch:2,profile,base:base.document,generation:classicGeneration})
        const classic=await prepareBaseMapProject(base,classicRequest,executeBaseMapRequestV3(classicRequest),{runtime,validation})
        if(canonicalJson(terrainPhysicalProjection(classic.project.document))!==canonicalJson(terrainPhysicalProjection(preview.project.document)))throw new Error('Surface recipe changed physical fields')
        const neutral=captureEditableDraft(preview.project);Object.assign(visualBase(neutral.document).environment,emptyVisualSystem().environment)
        const effectPng=await png(preview.project),neutralPng=await png(neutral),classicPng=await png(classic.project)
        await workspace.adoptTerrainGeneration(preview)
        const savedHash=hash(workspace.getState().project),cold=await repo.load(base.document.sceneId)
        if(projectContentHash(cold.project)!==savedHash||projectContentHash((await repo.load(before.document.sceneId)).project)!==beforeHash)throw new Error('Surface5 cold/original mismatch')
        const bytes=await exportProject(toBundle(workspace.getState().project),validation),round=await importProject(bytes,validation)
        if(projectContentHash(round.project)!==savedHash)throw new Error('Surface5 package mismatch')
        const surfaces=Object.values(round.project.document.terrainAreas) as any[],visual=visualBase(round.project.document)
        rows.push({kind,sceneId:base.document.sceneId,hash:savedHash,sourceHash:preview.continuationSource.projectHash,version:round.project.schemaVersion,assets:Object.keys(round.project.assets).length,sourceCount:Object.keys(round.project.authoringSources).length,licenseCount:Object.keys(round.project.licenses).length,overlays:surfaces.reduce((n,a)=>n+(a.surfaceStyle?.overlays.length??0),0),looks:Object.keys(visual.edgeLooks).length,usage:preview.baseMap.budgetUsage,effectPng,neutralPng,classicPng,package:base64(bytes)})
      }
      return {rows,tiles}
    } finally {client.dispose();await workspace.close();repo.close();await new Promise<void>((resolve,reject)=>{const request=indexedDB.deleteDatabase(name);request.onsuccess=()=>resolve();request.onerror=()=>reject(request.error)})}
  },{backendUrl,token})
  for(const row of proof.rows) {
    expect(row.assets).toBeGreaterThan(13);expect(row.overlays).toBeGreaterThan(0)
    for(const mode of ['effect','neutral','classic'] as const) {const name=`shore-${row.kind}-${mode}.png`;await writeFile(info.outputPath(name),Buffer.from(row[`${mode}Png`],'base64'));await info.attach(name,{path:info.outputPath(name),contentType:'image/png'})}
    await writeFile(info.outputPath(`shore-${row.kind}.sceneweave`),Buffer.from(row.package,'base64'))
  }
  for(const tile of proof.tiles)await writeFile(info.outputPath(`tile-${tile.role}-2x2.png`),Buffer.from(tile.png,'base64'))
  const report={rows:proof.rows.map(({effectPng:_e,neutralPng:_n,classicPng:_c,package:_p,...row})=>row),tiles:proof.tiles.map(({png:_p,...tile})=>tile)}
  await writeFile(info.outputPath('shore-results.json'),JSON.stringify(report,null,2));await info.attach('shore-results.json',{path:info.outputPath('shore-results.json'),contentType:'application/json'})
  expect(providerCalls).toBe(0)
})
