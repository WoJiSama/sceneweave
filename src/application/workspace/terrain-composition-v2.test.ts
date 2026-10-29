import { describe, expect, it } from 'vitest'
import { createRefinedBlankDocument } from '../../platform/browser/content/refined-blank.js'
import { createCompositionContent } from '../../shared/appearance/graph.js'
import { inspectDependencies } from '../../shared/geometry/dependencies.js'
import { polygonInside } from '../../shared/geometry/geometry.js'
import { sha256Bytes } from '../../shared/project/binary.js'
import { exportProject, importProject } from '../../shared/project/file.js'
import { createMemoryResources } from '../../shared/project/resources.js'
import { projectContentHash } from '../../shared/project/validate.js'
import { compositionPreset } from '../../shared/terrain-generation/composition-presets.js'
import { materializeTerrainComposition } from '../../shared/terrain-generation/composition-materialize.js'
import { planTerrainComposition } from '../../shared/terrain-generation/composition-field.js'
import { terrainCommandCost } from '../../shared/terrain-generation/cost.js'
import { canonicalJson, captureJson, encodeUtf8 } from '../../shared/validation/json.js'
import { fromBundle, toBundle } from './project.js'
import { NOW, pixelPng, runtime, validation } from './test-fixtures.js'
import { prepareTerrainComposition } from './terrain-composition.js'

const seeds=['terrain-compose-0','terrain-compose-1','terrain-compose-2'] as const
const presets=['archipelago','tidalCoast'] as const
const blank=(widthMm=48000,heightMm=36000)=>createRefinedBlankDocument('island',{title:'frozen composition',sceneId:'frozen-composition',now:'2026-10-29T00:00:00.000Z',widthMm,heightMm,preset:'narrative'})
const request=(preset:typeof presets[number],seed:string='terrain-compose-0',widthMm=48000,heightMm=36000,islandCount=3)=>({sceneId:'frozen-composition',seed,preset,widthMm,heightMm,islandCount,recipeVersion:2 as const})
const hash=(value:unknown)=>sha256Bytes(encodeUtf8(canonicalJson(value)))
function freeze<T>(value:T):T {if(value&&typeof value==='object'){for(const item of Object.values(value))freeze(item);Object.freeze(value)}return value}
function concave(points:{x:number;y:number}[]){
 const turns=points.map((a,i)=>{const b=points[(i+1)%points.length],c=points[(i+2)%points.length];return Math.sign((b.x-a.x)*(c.y-b.y)-(b.y-a.y)*(c.x-b.x))})
 return turns.includes(-1)&&turns.includes(1)
}
const frozenV1=[
 {preset:'archipelago',input:'88621bc33beae4a6dbb370695f7dbb85a3651801ed3b11616d6204d69a4fcd93',document:'0bb29035596e793d10ad4e6927f647476378e24e4e994bac247b4bd1e1594365',plan:'b972cd90cf916fbec7e9bea319f7feeeb642f65d1ecf86c82c9f5b65ad770c3a'},
 {preset:'tidalCoast',input:'18f02ef0c53ab252280f8be83bc18cd8d6ae08fbff9f81a6d6a768e996970b1d',document:'5b76d1fde0e810e1e8f3c7d0995159640992395d9184a0781b2cf78d60181242',plan:'aa5e4cebe75f005eaf8d5c41c4a19a6d47c3b36b093e77d7a07a85fee35e68e2'},
 {preset:'forestValley',input:'c8458603d689c5e487db7587bcb20cef12cc33e38f8fbe8bb9211c1c942974b8',document:'17a77218121b9258f2dcdf4e63a12908f101b957f25ce41197c19091fa0682e8',plan:'0754ec5aa5cd9899c6c35635ab9fdf0cc99db4fca0beaafbf11feca7a5a3e1a6'},
 {preset:'grassRidge',input:'e16aea4b3401eaa50580eb28265dfebf4cfd9fa607f37fe29c81913d8b4c8866',document:'af093b5f29e90dba983e80d78ac8dccef28981d8d0a35c532a3fe2d5a11c8356',plan:'c4e19f26ff21547151f3db68c45ca9e1c3abf5c01338793072859691474c8421'},
] as const

async function resourceBlank(){
 const document=captureJson(blank()),bytes=pixelPng([74,108,61,255]),assetHash=sha256Bytes(bytes)
 for(const asset of Object.values(document.assets))Object.assign(asset,{sha256:assetHash,mimeType:'image/png',pixelWidth:1,pixelHeight:1})
 const content=createCompositionContent(document,runtime),text='Sceneweave original composition V2 fixture',licenseHash=sha256Bytes(encodeUtf8(text))
 return fromBundle({project:{format:'sceneweave-complete-project',schemaVersion:2,...content,assets:{[assetHash]:{sha256:assetHash,mimeType:'image/png',sizeBytes:bytes.length,pixelWidth:1,pixelHeight:1}},licenses:{[licenseHash]:{sha256:licenseHash,text}},licenseBindings:inspectDependencies(content.document).subjects.map(subject=>({...subject,licensePath:`licenses/${licenseHash}.txt`,embedding:'allowed' as const})),authoringSources:{}},resources:createMemoryResources(new Map([[assetHash,bytes]]))},validation)
}

describe('explicit shoreline composition recipe 2',()=>{
 it.each(frozenV1)('keeps omitted and explicit recipe 1 $preset input, geometry and plan byte-identical',row=>{
  for(const recipeVersion of [undefined,1] as const){
   const spec=compositionPreset({sceneId:'frozen-composition',seed:'terrain-compose-0',preset:row.preset,widthMm:48000,heightMm:36000,islandCount:3,...(recipeVersion?{recipeVersion}:{})})
   if(recipeVersion===undefined)expect(Object.hasOwn(spec.request,'recipeVersion')).toBe(false)
   const raw=materializeTerrainComposition(blank(),spec.input,spec.requirements,spec.name,row.preset==='tidalCoast'?'tidal':'plain')
   expect(hash(spec.input)).toBe(row.input);expect(hash(raw.document)).toBe(row.document);expect(hash(raw.plan)).toBe(row.plan)
  }
 })
 it('rejects unsupported version 2 presets and unknown recipe versions',()=>{
  for(const preset of ['forestValley','grassRidge'])expect(()=>compositionPreset({...request('archipelago'),preset})).toThrow('组合配方2仅支持')
  expect(()=>compositionPreset({...request('archipelago'),recipeVersion:3})).toThrow()
 })
 const cases=presets.flatMap(preset=>seeds.flatMap(seed=>([[24000,18000],[48000,36000],[120000,90000]] as const).flatMap(([w,h])=>(preset==='archipelago'?[2,3]:[3]).map(islandCount=>({preset,seed,w,h,islandCount})))))
 it.each(cases)('keeps $preset $islandCount / $seed / $w × $h within the unchanged full metadata budget',({preset,seed,w,h,islandCount})=>{
  const rawRequest=freeze(request(preset,seed,w,h,islandCount)),spec=compositionPreset(rawRequest),before=createCompositionContent(blank(w,h),runtime)
  const unchanged=canonicalJson({request:rawRequest,input:spec.input,requirements:spec.requirements,base:before.document})
  freeze(spec.input);freeze(spec.requirements);freeze(before.document)
  const raw=materializeTerrainComposition(before.document,spec.input,spec.requirements,spec.name,preset==='tidalCoast'?'tidal-v2':'plain',2),after=createCompositionContent(raw.document,runtime)
  const cost=terrainCommandCost(before.document,after.document,{before,after})
  expect(cost.total).toBeLessThanOrEqual(256)
  expect(cost.items['composition.identity.actual.outdoorTokens']).toBeGreaterThan(0)
  expect(cost.items['composition.appearance.sources']).toBeGreaterThan(0)
  expect(raw.document.generation?.version).toBe(5)
  if(raw.document.generation?.version!==5)throw new Error('generation5 required')
  const composition=raw.document.generation.compositions['t9-composition']
  expect(composition.recipeRef).toEqual({id:'t9-recipe',version:2});expect(composition.algorithmVersion).toBe(1)
  expect(raw.document.generation.legacy.recipes['t9-recipe'].recipeVersion).toBe(2)
  expect(Object.values(raw.document.generation.checks).every(check=>check.state==='passed')).toBe(true)
  expect(raw.plan.fields.land.polygons).toHaveLength(preset==='archipelago'?islandCount:1)
  if(preset==='tidalCoast'){
   expect([...new Set(Object.values(raw.document.terrainAreas).map(area=>area.groundElevationMm))].sort((a,b)=>a-b)).toEqual([0,200,800,1800])
   const land=raw.document.terrainAreas['t9-land-0'].boundaryMm.map(point=>point.positionMm),shallow=raw.document.terrainAreas['t9-shallow-0'].boundaryMm.map(point=>point.positionMm)
   expect(concave(land)).toBe(true);expect(polygonInside(land,shallow)).toBe(true)
   expect(raw.document.terrainAreas['t9-shallow-0'].blocksMovement).toBe(false)
   expect(Object.keys(raw.document.terrainAreas).some(id=>id.startsWith('t9-lowland'))).toBe(false)
  }else if(islandCount===3)expect(raw.plan.fields.land.polygons.some(poly=>concave(poly.outer))).toBe(true)
  if(w===48000){
   const reference=planTerrainComposition({...spec.input,precision:{...spec.input.precision,toleranceMm:1}})
   expect(Math.abs(raw.plan.fields.land.areaMm2/reference.fields.land.areaMm2-1)).toBeLessThan(.1)
  }
  expect(canonicalJson({request:rawRequest,input:spec.input,requirements:spec.requirements,base:before.document})).toBe(unchanged)
 })
 it('rejects a non-containing concave shallow envelope and keeps the input unchanged',()=>{
  const spec=compositionPreset(request('tidalCoast')),bay=spec.input.features['v2-tidal-bay']
  if(bay.shape.kind!=='corridor')throw new Error('corridor required')
  bay.shape.pointsMm[1]={x:33600,y:19800}
  const snapshot=canonicalJson(spec.input)
  expect(()=>materializeTerrainComposition(blank(),freeze(spec.input),[],spec.name,'tidal-v2',2)).toThrow('浅滩包络未完整包含陆地或超出世界范围')
  expect(canonicalJson(spec.input)).toBe(snapshot)
 })
 it('requires explicit version 2 and its real 800 mm base for the new tidal profile',()=>{
  const spec=compositionPreset(request('tidalCoast'))
  expect(()=>materializeTerrainComposition(blank(),spec.input,[],spec.name,'tidal-v2')).toThrow('显式保存版本2')
  expect(()=>materializeTerrainComposition(blank(),{...spec.input,baseElevationMm:600},[],spec.name,'tidal-v2',2)).toThrow('800毫米基底')
 })
 it.each(presets)('fully prepares and cold-reads recipe 2 %s with real fixture bytes and matching Worker plan',async preset=>{
  const base=await resourceBlank(),rawRequest=request(preset),snapshot=projectContentHash(toBundle(base).project),spec=compositionPreset(rawRequest)
  const prepared=await prepareTerrainComposition(base,freeze(rawRequest),{runtime,validation,plan:planTerrainComposition(spec.input)})
  expect(prepared.cost.total).toBeLessThanOrEqual(256)
  const bundle=toBundle(prepared.project),loaded=await importProject(await exportProject(bundle,validation),validation)
  expect(projectContentHash(loaded.project)).toBe(projectContentHash(bundle.project))
  if(loaded.project.document.generation?.version!==5)throw new Error('generation5 required')
  expect(loaded.project.document.generation.compositions['t9-composition'].recipeRef.version).toBe(2)
  expect(loaded.project.document.generation.legacy.recipes['t9-recipe'].recipeVersion).toBe(2)
  expect(projectContentHash(toBundle(base).project)).toBe(snapshot)
 })
})
