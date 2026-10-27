import { expect, test } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { generateTerrainDocument } from '../src/shared/terrain-generation/generate.js'
import { canonicalJson } from '../src/shared/validation/json.js'
import { sha256Text } from '../src/shared/validation/hash.js'
import type { SceneDocument } from '../src/shared/model/scene.js'
import type { Workspace } from '../src/application/workspace/workspace.js'

type Dev={workspace:Workspace}
test('T0 v2 copy keeps source pixels and complete originals downloadable and importable',async({page},info)=>{
  test.setTimeout(180000)
  await page.goto('/#workspace')
  await page.waitForFunction(()=>Boolean(Reflect.get(window,'__sceneweaveOutdoorDev')))
  const before=await page.evaluate(async()=>{
    const runtimePath='/src/platform/browser/runtime.ts',samplePath='/src/platform/browser/content/refined-island.ts',projectPath='/src/application/workspace/project.ts',renderPath='/src/platform/browser/render/renderer.ts',binaryPath='/src/shared/project/binary.ts',validatePath='/src/shared/project/validate.ts'
    const {projectRepository}=await import(runtimePath) as typeof import('../src/platform/browser/runtime')
    const {createRefinedIslandProject}=await import(samplePath) as typeof import('../src/platform/browser/content/refined-island')
    const {toBundle}=await import(projectPath) as typeof import('../src/application/workspace/project')
    const {exportPng}=await import(renderPath) as typeof import('../src/platform/browser/render/renderer')
    const {sha256Bytes}=await import(binaryPath) as typeof import('../src/shared/project/binary')
    const {projectContentHash}=await import(validatePath) as typeof import('../src/shared/project/validate')
    const workspace=(Reflect.get(window,'__sceneweaveOutdoorDev') as Dev).workspace,source=await createRefinedIslandProject()
    await projectRepository.save(toBundle(source),null);await workspace.openPersisted(source)
    await workspace.createNamedSnapshot('升级前完整样板')
    const png=await exportPng(toBundle(source),{audience:'gm',longEdgePx:1024})
    return {sourceId:source.document.sceneId,contentHash:projectContentHash(toBundle(source).project),pngHash:sha256Bytes(new Uint8Array(await png.arrayBuffer()))}
  })
  await page.getByRole('tab',{name:'工程',exact:true}).click()
  await page.getByRole('button',{name:'保存独立地形副本',exact:true}).click()
  await expect(page.getByRole('button',{name:'保存独立地形副本',exact:true})).toHaveCount(0,{timeout:60000})
  const after=await page.evaluate(async(before)=>{
    const runtimePath='/src/platform/browser/runtime.ts',projectPath='/src/application/workspace/project.ts',renderPath='/src/platform/browser/render/renderer.ts',binaryPath='/src/shared/project/binary.ts',validatePath='/src/shared/project/validate.ts'
    const {projectRepository}=await import(runtimePath) as typeof import('../src/platform/browser/runtime')
    const {toBundle}=await import(projectPath) as typeof import('../src/application/workspace/project')
    const {exportPng}=await import(renderPath) as typeof import('../src/platform/browser/render/renderer')
    const {sha256Bytes}=await import(binaryPath) as typeof import('../src/shared/project/binary')
    const {projectContentHash}=await import(validatePath) as typeof import('../src/shared/project/validate')
    const workspace=(Reflect.get(window,'__sceneweaveOutdoorDev') as Dev).workspace,target=workspace.getState().project!,source=(await projectRepository.load(before.sourceId))!
    const png=await exportPng(toBundle(target),{audience:'gm',longEdgePx:1024}),originals=await projectRepository.exportNativeUpgradeCapsule(target.document.sceneId)
    return {targetId:target.document.sceneId,schemaVersion:target.schemaVersion,pngHash:sha256Bytes(new Uint8Array(await png.arrayBuffer())),sourceHash:projectContentHash(source.project),
      capsuleHash:originals.capsule.contentHash,named:originals.capsule.family.snapshots.filter(row=>row.kind==='named').length}
  },before)
  expect(after.schemaVersion).toBe(3);expect(after.targetId).not.toBe(before.sourceId);expect(after.sourceHash).toBe(before.contentHash);expect(after.pngHash).toBe(before.pngHash);expect(after.named).toBe(1)
  await page.getByRole('tab',{name:'历史',exact:true}).click()
  const downloadEvent=page.waitForEvent('download')
  await page.getByRole('button',{name:'下载完整升级原件归档',exact:true}).click()
  const download=await downloadEvent,path=info.outputPath('source.sceneweave-originals.zip');await download.saveAs(path)
  await page.getByLabel('选择升级原件归档',{exact:true}).setInputFiles(path)
  await expect(page.getByRole('button',{name:'下载完整升级原件归档',exact:true})).toBeEnabled({timeout:60000})
  expect(await page.evaluate(async()=>{
    const path='/src/platform/browser/runtime.ts',{projectRepository}=await import(path) as typeof import('../src/platform/browser/runtime')
    const workspace=(Reflect.get(window,'__sceneweaveOutdoorDev') as Dev).workspace
    return (await projectRepository.exportNativeUpgradeCapsule(workspace.getDocument()!.sceneId)).capsule.contentHash
  })).toBe(after.capsuleHash)
  await info.attach('upgrade-source-pixel-baseline.json',{body:JSON.stringify({before,after}),contentType:'application/json'})
})
test('T0 Node and real browser Worker replay exactly the same frozen input',async({page},info)=>{
  test.setTimeout(120000)
  await page.goto('/')
  const result=await page.evaluate(async()=>{
    const blankPath='/src/platform/browser/content/refined-blank.ts',clientPath='/src/platform/browser/terrain-generation/client.ts',jsonPath='/src/shared/validation/json.ts',hashPath='/src/shared/validation/hash.ts'
    const {createRefinedBlankDocument}=await import(blankPath) as typeof import('../src/platform/browser/content/refined-blank')
    const {createTerrainGenerationClient}=await import(clientPath) as typeof import('../src/platform/browser/terrain-generation/client')
    const {canonicalJson}=await import(jsonPath) as typeof import('../src/shared/validation/json')
    const {sha256Text}=await import(hashPath) as typeof import('../src/shared/validation/hash')
    const base=createRefinedBlankDocument('island',{sceneId:'terrain-browser-parity',title:'固定重放向量',widthMm:24000,heightMm:18000,preset:'narrative',now:'2026-10-26T00:00:00.000Z'})
    const input={sceneId:base.sceneId,kind:'island' as const,seed:'terrain-v1-0'},client=createTerrainGenerationClient()
    try {const result=await client.generate({sceneId:'current-workspace',checkpoint:7,operationEpoch:3,base,input});return {base,input,resultHash:sha256Text(canonicalJson(result))}}
    finally{client.dispose()}
  })
  const nodeResult=generateTerrainDocument(result.base as SceneDocument,result.input)
  expect(sha256Text(canonicalJson(nodeResult))).toBe(result.resultHash)
  await info.attach('node-browser-determinism.json',{body:JSON.stringify({hash:result.resultHash,seed:result.input.seed,cost:nodeResult.cost}),contentType:'application/json'})
})

test('T3 Node and real Worker replay the same explicit route for all five recipes',async({page},info)=>{
  test.setTimeout(180000)
  await page.goto('/')
  const results=await page.evaluate(async()=>{
    const blankPath='/src/platform/browser/content/refined-blank.ts',clientPath='/src/platform/browser/terrain-generation/client.ts',jsonPath='/src/shared/validation/json.ts',hashPath='/src/shared/validation/hash.ts'
    const {createRefinedBlankDocument}=await import(blankPath) as typeof import('../src/platform/browser/content/refined-blank')
    const {createTerrainGenerationClient}=await import(clientPath) as typeof import('../src/platform/browser/terrain-generation/client')
    const {canonicalJson}=await import(jsonPath) as typeof import('../src/shared/validation/json')
    const {sha256Text}=await import(hashPath) as typeof import('../src/shared/validation/hash')
    const outputs=[]
    for(const kind of ['river','lake','forest','hill','mixed'] as const){
      const base=createRefinedBlankDocument('island',{sceneId:`t3-parity-${kind}`,title:'T3固定路线',widthMm:24000,heightMm:18000,preset:'narrative',now:'2026-10-26T00:00:00.000Z'})
      const input={sceneId:base.sceneId,kind,seed:'terrain-v1-0',route:{from:{x:3000,y:13500},to:{x:21000,y:13500},widthMm:1000,crossing:'ford' as const}},client=createTerrainGenerationClient()
      try{const result=await client.generate({sceneId:'current-workspace',checkpoint:7,operationEpoch:3,base,input});outputs.push({base,input,resultHash:sha256Text(canonicalJson(result))})}
      finally{client.dispose()}
    }
    return outputs
  })
  const facts=[]
  for(const result of results){
    const nodeResult=generateTerrainDocument(result.base as SceneDocument,result.input)
    expect(sha256Text(canonicalJson(nodeResult))).toBe(result.resultHash)
    facts.push({kind:result.input.kind,hash:result.resultHash,cost:nodeResult.cost,route:nodeResult.route})
  }
  await info.attach('t3-node-browser-determinism.json',{body:JSON.stringify(facts),contentType:'application/json'})
})

test('T3 real browser mixed terrain preview, adoption and cold persistence',async({page})=>{
  test.setTimeout(240000)
  const errors:string[]=[]
  page.on('pageerror',error=>errors.push(error.message))
  await page.goto('/#workspace')
  await page.getByRole('tab',{name:'工程',exact:true}).click()
  await page.getByRole('button',{name:'选择混合地形',exact:true}).click()
  await page.getByLabel('生成指定路线',{exact:true}).check()
  await page.getByRole('button',{name:'生成地形预览',exact:true}).click()
  await expect(page.getByRole('article',{name:'当前地形候选'})).toBeVisible({timeout:60000})
  await expect(page.getByRole('article',{name:'当前地形候选'})).toContainText('混合地貌')
  await expect(page.getByText('指定路线与完整转角净宽',{exact:true})).toBeVisible()
  await expect(page.getByText('地形分区',{exact:true})).toBeVisible()
  await expect(page.getByRole('button',{name:'采用当前地形方案',exact:true})).toBeEnabled({timeout:60000})
  await page.getByRole('button',{name:'采用当前地形方案',exact:true}).click()
  await expect(page.locator('.asset-save')).toHaveText('本地已保存',{timeout:60000})
  const persisted=await page.evaluate(async()=>{
    const runtimePath='/src/platform/browser/runtime.ts'
    const {projectRepository}=await import(runtimePath) as typeof import('../src/platform/browser/runtime')
    const workspace=(Reflect.get(window,'__sceneweaveOutdoorDev') as Dev).workspace
    await workspace.flush()
    const project=workspace.getState().project
    if(!project)throw new Error('T3采用后缺少当前工程。')
    const cold=await projectRepository.load(project.document.sceneId)
    if(!cold)throw new Error('T3采用后冷读工程失败。')
    return {sceneId:project.document.sceneId,revision:cold.project.document.revision,terrainAreas:Object.keys(cold.project.document.terrainAreas),connections:Object.keys(cold.project.document.terrainConnections),generation:!!cold.project.document.generation,route:cold.project.document.paths['terrain-route'],routeCheck:cold.project.document.generation!.checks['terrain-route-check'],variants:Object.values(cold.project.appearance.variants),assets:Object.keys(cold.project.assets),rules:Object.values(cold.project.document.generation!.rules),ownership:Object.values(cold.project.document.generation!.ownership)}
  })
  expect(persisted.revision).toBeGreaterThanOrEqual(0)
  expect(persisted.route.widthMm).toBe(1000)
  expect(persisted.routeCheck.state).toBe('passed')
  expect(persisted.variants).toHaveLength(2)
  expect(persisted.assets).toHaveLength(15)
  expect(persisted.rules.every(rule=>rule.state==='active')).toBe(true)
  expect(persisted.ownership.every(row=>row.state==='managed')).toBe(true)
  expect(persisted.generation).toBe(true)
  expect(persisted.terrainAreas).toEqual(expect.arrayContaining(['terrain-water-north','terrain-water-south','terrain-shallow','terrain-forest']))
  expect(persisted.connections).toEqual(expect.arrayContaining(['terrain-stairs','terrain-shallow-left','terrain-shallow-right']))
  expect(errors).toEqual([])
})

test('T1 retains all five untouched island and coast packages, neutral whole views and identical closeup regions',async({page},info)=>{
  test.setTimeout(600000)
  await page.goto('/')
  for(const kind of ['island','coast'] as const){
    const output=await page.evaluate(async(kind)=>{
      const blankPath='/src/platform/browser/content/refined-blank.ts',corePath='/src/shared/terrain-generation/generate.ts',preparePath='/src/application/workspace/terrain.ts',runtimePath='/src/platform/browser/runtime.ts',filePath='/src/shared/project/file.ts',rendererPath='/src/platform/browser/render/renderer.ts',projectPath='/src/application/workspace/project.ts',validatePath='/src/shared/project/validate.ts'
      const {createRefinedBlankProject}=await import(blankPath) as typeof import('../src/platform/browser/content/refined-blank')
      const {TERRAIN_FIXED_SEEDS}=await import(corePath) as typeof import('../src/shared/terrain-generation/generate')
      const {prepareTerrainProject}=await import(preparePath) as typeof import('../src/application/workspace/terrain')
      const {runtime,validation}=await import(runtimePath) as typeof import('../src/platform/browser/runtime')
      const {exportProject,importProject}=await import(filePath) as typeof import('../src/shared/project/file')
      const {exportPng,exportPublicViewportPng}=await import(rendererPath) as typeof import('../src/platform/browser/render/renderer')
      const {toBundle,captureEditableDraft}=await import(projectPath) as typeof import('../src/application/workspace/project')
      const {projectContentHash}=await import(validatePath) as typeof import('../src/shared/project/validate')
      const base=await createRefinedBlankProject(kind,{sceneId:`terrain-review-${kind}`,title:'未修图固定组',widthMm:24000,heightMm:18000,preset:'narrative',now:'2026-10-26T00:00:00.000Z'})
      const encode=(bytes:Uint8Array)=>{let value='';for(let i=0;i<bytes.length;i+=32768)value+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(value)}
      const outputs=[]
      for(const seed of TERRAIN_FIXED_SEEDS){
        const independent=captureEditableDraft(base);independent.document.sceneId=`terrain-review-${kind}-${seed}`;independent.historyIdentity.rootSceneId=independent.document.sceneId;independent.historyIdentity.lineageId=`terrain-review-lineage-${kind}-${seed}`
        const prepared=await prepareTerrainProject(independent,{sceneId:independent.document.sceneId,kind,seed},{runtime,validation})
        const bundle=toBundle(prepared.project),bytes=await exportProject(bundle,validation),cold=await importProject(bytes,validation)
        if(projectContentHash(cold.project)!==projectContentHash(bundle.project))throw new Error('Cold roundtrip hash mismatch')
        const full=await exportPng(cold,{audience:'gm',longEdgePx:2048}),close=await exportPublicViewportPng(cold,{x:6000,y:4500,width:12000,height:9000},1024)
        outputs.push({seed,kind,cost:prepared.cost,coreCost:prepared.result.cost,skeleton:prepared.result.skeleton,activity:prepared.result.activity,
          props:Object.keys(cold.project.document.props).length,stairs:cold.project.document.terrainConnections['terrain-stairs'],checks:cold.project.document.generation!.checks,
          hash:projectContentHash(cold.project),package:encode(bytes),full:encode(new Uint8Array(await full.arrayBuffer())),close:encode(new Uint8Array(await close.arrayBuffer()))})
      }
      return outputs
    },kind)
    for(const item of output){
      expect(item.cost.total).toBeLessThanOrEqual(256);expect(item.props).toBeGreaterThanOrEqual(4);expect(item.stairs.widthMm).toBe(1500)
      const name=`${item.kind}-${item.seed}`
      await writeFile(info.outputPath(`${name}.sceneweave`),Buffer.from(item.package,'base64'))
      await writeFile(info.outputPath(`${name}-whole.png`),Buffer.from(item.full,'base64'))
      await writeFile(info.outputPath(`${name}-close.png`),Buffer.from(item.close,'base64'))
      const {package:_package,full:_full,close:_close,...facts}=item
      await writeFile(info.outputPath(`${name}.json`),JSON.stringify(facts,null,2))
    }
  }
})

test('T1 manual preview cancellation, independent adoption, tree and coast edits survive cold storage, undo and complete dual4K export',async({page},info)=>{
  test.setTimeout(300000)
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message))
  await page.goto('/#workspace');await page.getByRole('tab',{name:'工程',exact:true}).click()
  await page.getByRole('button',{name:'生成地形预览',exact:true}).click()
  await expect(page.getByRole('article',{name:'当前地形候选'})).toBeVisible({timeout:60000})
  await page.getByRole('button',{name:'取消当前地形候选',exact:true}).click()
  await expect(page.getByRole('article',{name:'当前地形候选'})).toHaveCount(0)
  await page.getByRole('button',{name:'生成地形预览',exact:true}).click()
  await expect(page.getByRole('button',{name:'采用当前地形方案',exact:true})).toBeEnabled({timeout:60000})
  await page.getByRole('button',{name:'采用当前地形方案',exact:true}).click()
  await expect(page.locator('.asset-save')).toHaveText('本地已保存',{timeout:60000})
  const result=await page.evaluate(async()=>{
    const workspace=(Reflect.get(window,'__sceneweaveOutdoorDev') as Dev).workspace
    const runtimePath='/src/platform/browser/runtime.ts',projectPath='/src/application/workspace/project.ts',filePath='/src/shared/project/file.ts',renderPath='/src/platform/browser/render/renderer.ts',basePath='/src/shared/visual/base.ts',jsonPath='/src/shared/validation/json.ts',validatePath='/src/shared/project/validate.ts'
    const {projectRepository,validation}=await import(runtimePath) as typeof import('../src/platform/browser/runtime')
    const {toBundle,fromBundle}=await import(projectPath) as typeof import('../src/application/workspace/project')
    const {exportProject,importProject}=await import(filePath) as typeof import('../src/shared/project/file')
    const {exportPng}=await import(renderPath) as typeof import('../src/platform/browser/render/renderer')
    const {visualBase}=await import(basePath) as typeof import('../src/shared/visual/base')
    const {cloneJson}=await import(jsonPath) as typeof import('../src/shared/validation/json')
    const {projectContentHash}=await import(validatePath) as typeof import('../src/shared/project/validate')
    const original=workspace.getState().project!,tree=Object.values(original.document.props).find(p=>p.definitionRef?.id.includes('tree-'))!
    await workspace.updateProp(tree.id,{positionMm:{x:tree.positionMm.x+50,y:tree.positionMm.y}})
    const curve=cloneJson(visualBase(workspace.getDocument()!)!.boundaries['terrain-coast-curve'])
    curve.segments[0].control1.y+=50
    await workspace.execute([{type:'upsertVisualBoundary',boundary:curve}]);await workspace.flush()
    const changed=workspace.getState().project!,changedHash=projectContentHash(toBundle(changed).project),sceneId=changed.document.sceneId
    workspace.undo();workspace.redo();await workspace.flush()
    const cold=(await projectRepository.load(sceneId))!,coldEditable=await fromBundle(cold,validation)
    await workspace.openPersisted(coldEditable)
    const bytes=await exportProject(toBundle(workspace.getState().project!),validation),imported=await importProject(bytes,validation)
    const encode=(bytes:Uint8Array)=>{let value='';for(let i=0;i<bytes.length;i+=32768)value+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(value)}
    const pngs=[]
    for(const audience of ['gm','player'] as const){const blob=await exportPng(imported,{audience,longEdgePx:4096});pngs.push({audience,png:encode(new Uint8Array(await blob.arrayBuffer()))})}
    return {schemaVersion:imported.project.schemaVersion,changedHash,contentHash:projectContentHash(imported.project),tree:imported.project.document.props[tree.id],originalTree:tree,
      ownership:imported.project.document.generation!.ownership,rules:imported.project.document.generation!.rules,checks:imported.project.document.generation!.checks,revision:imported.project.document.revision,
      package:encode(bytes),pngs}
  })
  expect(result.schemaVersion).toBe(3);expect(result.tree.positionMm.x).toBe(result.originalTree.positionMm.x+50)
  expect(Object.values(result.ownership).some(row=>row.target.entityId===result.tree.id&&row.manualFields.includes('geometry'))).toBe(true)
  expect(Object.values(result.rules).every(rule=>rule.state==='paused')).toBe(true)
  expect(Object.values(result.checks).every(check=>check.state==='unchecked')).toBe(true)
  for(const png of result.pngs)await writeFile(info.outputPath(`edited-${png.audience}-4096.png`),Buffer.from(png.png,'base64'))
  await writeFile(info.outputPath('edited.sceneweave'),Buffer.from(result.package,'base64'))
  expect(errors).toEqual([])
})
