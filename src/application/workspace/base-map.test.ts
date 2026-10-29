import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import { Workspace } from './workspace.js'
import { fromBundle, toBundle, type EditableProject } from './project.js'
import { prepareBaseMapProject } from './base-map.js'
import { fixture, NOW, pixelPng, runtime, validation } from './test-fixtures.js'
import { createRefinedBlankDocument } from '../../platform/browser/content/refined-blank.js'
import { ProjectRepository } from '../../platform/browser/storage/repository.js'
import { createCompositionContent } from '../../shared/appearance/graph.js'
import { inspectDependencies } from '../../shared/geometry/dependencies.js'
import { exportProject, importProject } from '../../shared/project/file.js'
import { sha256Bytes } from '../../shared/project/binary.js'
import { createMemoryResources } from '../../shared/project/resources.js'
import { projectContentHash } from '../../shared/project/validate.js'
import { canonicalJson, captureJson, encodeUtf8 } from '../../shared/validation/json.js'
import { sha256Text } from '../../shared/validation/hash.js'
import { prepareBaseMapRequest, executeBaseMapRequest, type BaseMapRequest, type BaseMapResponse } from '../../shared/terrain-generation/base-map.js'

const repos: ProjectRepository[] = [], sessions: Workspace[] = []
afterEach(async()=>{for(const session of sessions.splice(0))await session.close().catch(()=>{});for(const repo of repos.splice(0)){const name=repo.database.name;repo.close();await Dexie.delete(name)}})
async function blank(palette:'island'|'coast'='island',composition=false):Promise<EditableProject>{
  const document=createRefinedBlankDocument(palette,{title:'Base map fixed source fixture',sceneId:runtime.ids.nextId(),now:NOW,widthMm:composition?48000:24000,heightMm:composition?36000:18000,preset:'narrative'})
  const bytes=pixelPng([74,108,61,255]),hash=sha256Bytes(bytes)
  for(const asset of Object.values(document.assets))Object.assign(asset,{sha256:hash,mimeType:'image/png',pixelWidth:1,pixelHeight:1})
  const content=createCompositionContent(document,runtime),text='Sceneweave original program base-map test',licenseHash=sha256Bytes(encodeUtf8(text))
  return fromBundle({project:{format:'sceneweave-complete-project',schemaVersion:2,...content,assets:{[hash]:{sha256:hash,mimeType:'image/png',sizeBytes:bytes.length,pixelWidth:1,pixelHeight:1}},licenses:{[licenseHash]:{sha256:licenseHash,text}},licenseBindings:inspectDependencies(content.document).subjects.map(subject=>({...subject,licensePath:`licenses/${licenseHash}.txt`,embedding:'allowed' as const})),authoringSources:{}},resources:createMemoryResources(new Map([[hash,bytes]]))},validation)
}
function request(base:EditableProject,kind:'island'|'coast'|'archipelago'|'tidalCoast'='island',context={workspaceSceneId:'current-map',checkpoint:0}){
  const composition=kind==='archipelago'||kind==='tidalCoast'
  return prepareBaseMapRequest({requestId:'base-map-request',...context,operationEpoch:3,base:base.document,generation:composition
    ?{kind:'composition',input:{sceneId:base.document.sceneId,preset:kind,seed:'terrain-compose-0',widthMm:48000,heightMm:36000,recipeVersion:2}}
    :{kind:'terrain',input:{sceneId:base.document.sceneId,kind,seed:'terrain-v1-0',widthMm:24000,heightMm:18000,algorithmVersion:2}}})
}
function rehash(response:BaseMapResponse){response.resultHash=sha256Text(canonicalJson({generation:response.generation,result:response.result,domainCost:response.domainCost}));return response}

describe('verified program base-map preparation',()=>{
  it.each(['island','coast','archipelago','tidalCoast'] as const)('replays %s with actual resources and binds a complete-project receipt',async kind=>{
    const composition=kind==='archipelago'||kind==='tidalCoast',base=await blank(kind==='coast'?'coast':'island',composition),input=request(base,kind),response=executeBaseMapRequest(input)
    const before=canonicalJson({base:toBundle(base).project,input,response}),prepared=await prepareBaseMapProject(base,input,response,{runtime,validation,source:'server'})
    expect(prepared.cost.total).toBe(response.domainCost.total)
    expect(prepared.baseMap.initialOperationCost).toBe(prepared.cost.total)
    expect(prepared.baseMap.remainingOperationCost+prepared.baseMap.initialOperationCost).toBe(256)
    expect(prepared.baseMap.projectHash).toBe(projectContentHash(toBundle(prepared.project).project))
    expect(prepared.project.schemaVersion).toBe(composition?4:3)
    const cold=await importProject(await exportProject(toBundle(prepared.project),validation),validation)
    expect(projectContentHash(cold.project)).toBe(prepared.baseMap.projectHash)
    expect(canonicalJson({base:toBundle(base).project,input,response})).toBe(before)
    expect(Object.hasOwn(cold.project,'baseMap')).toBe(false)
  })
  it.each(['island','archipelago'] as const)('rejects a validly rehashed foreign %s domain result',async kind=>{
    const base=await blank('island',kind==='archipelago'),input=request(base,kind),response=captureJson(executeBaseMapRequest(input))
    if(response.result.kind==='terrain')response.result.terrain.document.title='foreign valid document'
    else response.result.document.title='foreign valid document'
    await expect(prepareBaseMapProject(base,input,rehash(response),{runtime,validation})).rejects.toThrow(/重放/)
  })
  it('rejects a changed owned source base and cannot accept transport cost as final adoption proof',async()=>{
    const base=await blank(),input=request(base),response=executeBaseMapRequest(input),changed=await blank()
    await expect(prepareBaseMapProject(changed,input,response,{runtime,validation})).rejects.toThrow(/基础文档|素材/)
    const tampered=captureJson(response);tampered.domainCost.total=0;rehash(tampered)
    await expect(prepareBaseMapProject(base,input,tampered,{runtime,validation})).rejects.toThrow()
  })
  it('cancels before resource preparation and rejects accessor-bearing requests without invoking them',async()=>{
    const base=await blank(),input=request(base),response=executeBaseMapRequest(input),controller=new AbortController();controller.abort()
    await expect(prepareBaseMapProject(base,input,response,{runtime,validation:{...validation,signal:controller.signal}})).rejects.toMatchObject({name:'AbortError'})
    let called=false;const accessor=Object.defineProperty({...input},'checkpoint',{get(){called=true;return 0},enumerable:true}) as BaseMapRequest
    await expect(prepareBaseMapProject(base,accessor,response,{runtime,validation})).rejects.toThrow()
    expect(called).toBe(false)
  })
  it('previews without changing the current project, preserves cancellation and cold-adopts exactly once',async()=>{
    const repo=new ProjectRepository({name:`base-map-${crypto.randomUUID()}`,runtime,validation});repos.push(repo)
    const workspace=new Workspace(repo,{runtime,validation});sessions.push(workspace)
    await workspace.adoptNew(await fromBundle(fixture({image:true}),validation))
    const before=workspace.getState().project!,beforeHash=projectContentHash(toBundle(before).project),base=await blank('island',true)
    const input=request(base,'archipelago',{workspaceSceneId:before.document.sceneId,checkpoint:workspace.checkpoint()}),response=executeBaseMapRequest(input)
    const first=await workspace.previewBaseMapGeneration(base,input,response,{source:'server'})
    expect(workspace.getState().project).toBe(before)
    workspace.cancelTerrainGeneration(first);await expect(workspace.adoptTerrainGeneration(first)).rejects.toThrow()
    const second=await workspace.previewBaseMapGeneration(base,input,response,{source:'server'})
    await workspace.adoptTerrainGeneration(second)
    expect(projectContentHash((await repo.load(base.document.sceneId))!.project)).toBe(second.baseMap!.projectHash)
    expect(projectContentHash((await repo.load(before.document.sceneId))!.project)).toBe(beforeHash)
    await expect(workspace.adoptTerrainGeneration(second)).rejects.toThrow()
    await expect(workspace.previewBaseMapGeneration(base,input,response)).rejects.toThrow(/过期/)
  })
})
