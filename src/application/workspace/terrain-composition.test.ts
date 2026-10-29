import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Workspace } from './workspace.js'
import { fromBundle, toBundle, type EditableProject } from './project.js'
import { fixture, NOW, pixelPng, runtime, validation } from './test-fixtures.js'
import { ProjectRepository } from '../../platform/browser/storage/repository.js'
import { createRefinedBlankDocument } from '../../platform/browser/content/refined-blank.js'
import { createCompositionContent } from '../../shared/appearance/graph.js'
import { inspectDependencies } from '../../shared/geometry/dependencies.js'
import { sha256Bytes } from '../../shared/project/binary.js'
import { createMemoryResources } from '../../shared/project/resources.js'
import { projectContentHash } from '../../shared/project/validate.js'
import { captureJson, encodeUtf8 } from '../../shared/validation/json.js'
import { prepareTerrainComposition } from './terrain-composition.js'
import { exportProject, importProject } from '../../shared/project/file.js'
import { compositionPreset } from '../../shared/terrain-generation/composition-presets.js'
import { materializeTerrainComposition } from '../../shared/terrain-generation/composition-materialize.js'
import { terrainCommandCost } from '../../shared/terrain-generation/cost.js'
import { supportSurfaceAt } from '../../shared/geometry/geometry.js'
import { validateSceneDocument } from '../../shared/validation/scene.js'

const repos:ProjectRepository[]=[],sessions:Workspace[]=[]
async function blank():Promise<EditableProject>{
 const document=captureJson(createRefinedBlankDocument('island',{title:'T9 transaction fixture',sceneId:runtime.ids.nextId(),now:NOW,widthMm:48000,heightMm:36000,preset:'narrative'})),bytes=pixelPng([74,108,61,255]),hash=sha256Bytes(bytes)
 for(const asset of Object.values(document.assets))Object.assign(asset,{sha256:hash,mimeType:'image/png',pixelWidth:1,pixelHeight:1})
 const content=createCompositionContent(document,runtime),text='Sceneweave original T9 fixture',lh=sha256Bytes(encodeUtf8(text))
 return fromBundle({project:{format:'sceneweave-complete-project',schemaVersion:2,...content,assets:{[hash]:{sha256:hash,mimeType:'image/png',sizeBytes:bytes.length,pixelWidth:1,pixelHeight:1}},licenses:{[lh]:{sha256:lh,text}},licenseBindings:inspectDependencies(content.document).subjects.map(subject=>({...subject,licensePath:`licenses/${lh}.txt`,embedding:'allowed' as const})),authoringSources:{}},resources:createMemoryResources(new Map([[hash,bytes]]))},validation)
}
const request=(base:EditableProject,preset:'archipelago'|'forestValley'|'grassRidge'|'tidalCoast'='archipelago')=>({sceneId:base.document.sceneId,seed:'terrain-compose-0',preset,widthMm:48000,heightMm:36000,islandCount:3})
afterEach(async()=>{vi.restoreAllMocks();for(const w of sessions.splice(0))await w.close().catch(()=>{});for(const r of repos.splice(0)){const n=r.database.name;r.close();await Dexie.delete(n)}})
describe('T9 complete composition path',()=>{
 it.each(['archipelago','forestValley','grassRidge','tidalCoast'] as const)('materializes %s with truthful full cost',async preset=>{
  const base=await blank(),spec=compositionPreset(request(base,preset)),raw=materializeTerrainComposition(base.document,spec.input,spec.requirements,spec.name,preset==='tidalCoast'?'tidal':'plain')
  const cost=terrainCommandCost(base.document,raw.document)
  expect(cost.total).toBeLessThanOrEqual(256)
  const prepared=await prepareTerrainComposition(base,request(base,preset),{runtime,validation})
  expect(prepared.project.schemaVersion).toBe(4);expect(prepared.cost.total).toBeLessThanOrEqual(256)
  expect(prepared.project.historyIdentity.version).toBe(3)
  const exported=await exportProject(toBundle(prepared.project),validation),loaded=await importProject(exported,validation)
  expect(projectContentHash(loaded.project)).toBe(projectContentHash(toBundle(prepared.project).project))
 })
 it('preserves real lake water and high-ground elevation under overlapping forest and clearings',async()=>{
  const base=await blank(),spec=compositionPreset(request(base,'grassRidge'))
  const bare=materializeTerrainComposition(base.document,spec.input,[],spec.name).document
  spec.input.features.forest={id:'forest',kind:'forest',floorId:'visual-floor',layerId:'visual-layer-ground',visibility:'public',editLocked:false,elevationMm:600,roughnessPpm:0,seedKey:'forest',shape:{kind:'ellipse',centerMm:{x:24000,y:18000},radiusXMm:28000,radiusYMm:23000,rotationMilliDeg:0}}
  spec.input.features.clearing={...spec.input.features.forest,id:'clearing',kind:'clearing',seedKey:'clearing',shape:{kind:'ellipse',centerMm:{x:16000,y:16000},radiusXMm:1800,radiusYMm:1800,rotationMilliDeg:0}}
  spec.input.members.push({featureId:'forest',field:'vegetation',operation:'add',weightPpm:1000000},{featureId:'clearing',field:'vegetation',operation:'subtract',weightPpm:1000000})
  const forested=materializeTerrainComposition(base.document,spec.input,[],spec.name).document
  expect(validateSceneDocument(forested)).toMatchObject({ok:true})
  let highForest=0,lakeSamples=0
  for(let x=1500;x<48000;x+=3000)for(let y=1500;y<36000;y+=3000){
   const before= supportSurfaceAt(bare,{x,y},'visual-floor'),after=supportSurfaceAt(forested,{x,y},'visual-floor')
   expect(before?.kind).toBe('terrainArea');expect(after?.kind).toBe('terrainArea')
   if(before?.kind!=='terrainArea'||after?.kind!=='terrainArea')continue
   const a=bare.terrainAreas[before.id],b=forested.terrainAreas[after.id]
   expect(b.groundElevationMm).toBe(a.groundElevationMm);expect(b.blocksMovement).toBe(a.blocksMovement)
   if(a.groundElevationMm===0){lakeSamples++;expect(b.surfaceStyle).toEqual(a.surfaceStyle)}
   if(a.groundElevationMm===3200&&after.id.startsWith('t9-vegetation'))highForest++
  }
  expect(lakeSamples).toBeGreaterThan(0);expect(highForest).toBeGreaterThan(0)
 })
 it('previews without save, rejects cancelled/forged candidates and cold-reads authentic adoption once',async()=>{
  const repo=new ProjectRepository({name:`t9-${crypto.randomUUID()}`,runtime,validation});repos.push(repo)
  const workspace=new Workspace(repo,{runtime,validation});sessions.push(workspace);await workspace.adoptNew(await fromBundle(fixture({image:true}),validation))
  const before=workspace.getState().project!,hash=projectContentHash(toBundle(before).project),base=await blank(),saving=vi.spyOn(repo,'save')
  const preview=await workspace.previewTerrainComposition(base,request(base));expect(saving).not.toHaveBeenCalled();expect(workspace.getState().project).toBe(before)
  await expect(workspace.adoptTerrainGeneration({...preview})).rejects.toThrow()
  workspace.cancelTerrainGeneration(preview);await expect(workspace.adoptTerrainGeneration(preview)).rejects.toThrow()
  const next=await workspace.previewTerrainComposition(base,request(base));await workspace.adoptTerrainGeneration(next)
  expect(workspace.getState().project!.schemaVersion).toBe(4)
  expect(projectContentHash((await repo.load(base.document.sceneId))!.project)).toBe(projectContentHash(toBundle(next.project).project))
  expect(projectContentHash((await repo.load(before.document.sceneId))!.project)).toBe(hash)
  await expect(workspace.adoptTerrainGeneration(next)).rejects.toThrow()
 })
})
