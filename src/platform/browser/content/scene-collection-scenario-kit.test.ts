import { describe, expect, it, vi } from 'vitest'
import { createSceneCollectionScenarioDocument, type ScenarioSpec } from './scene-collection-scenario-kit.js'
import { createFurnitureCollectionDocument } from './furniture-collection-catalog.js'
import { applyCommands } from '../../../shared/commands/commands.js'
import { validateSceneDocument } from '../../../shared/validation/scene.js'
import { surfacesTracesDefinitionId } from '../../../shared/assets/surfaces-traces-collection.js'
import { createSceneCollectionSelectionDocument } from './scene-collection-catalog.js'
vi.mock('../runtime.js',()=>({runtime:{ids:{nextId:()=> 'scenario-test'},clock:{now:()=> '2026-11-17T00:00:00.000Z'}},validation:{}}))
const example:ScenarioSpec={id:'kit-check',name:'中世纪小屋与庭院',era:'medieval',widthMm:20000,heightMm:16000,
 grounds:[{id:'yard',name:'庭院',bounds:[1000,1000,18000,14000]}],
 rooms:[{id:'home',name:'起居',bounds:[2000,2000,10000,10000],support:'yard'}],
 openings:[{id:'front',axis:'y',lineMm:12000,atMm:7000,widthMm:1600,kind:'door',entrance:true}],
 props:[{id:'bed',category:'bed',style:'peasant',x:4000,y:4500,support:'home'},{id:'table',category:'table',style:'peasant',x:8000,y:6500,support:'home'},{id:'chair',category:'chair',style:'peasant',x:8000,y:7600,support:'home'},{id:'well',category:'well',x:15500,y:6000,support:'yard'}],
 groups:[{id:'dining',name:'就餐桌椅',members:['table','chair']}],lights:[{id:'lamp',x:8000,y:6500}]}
describe('representative scenario kit',()=>{
 it('retains the original furniture definition and source, explicit supports and unpackable independent members',()=>{
  const scene=createSceneCollectionScenarioDocument(example)
  expect(validateSceneDocument(scene).ok).toBe(true)
  const source=createFurnitureCollectionDocument({styleId:'peasant'})
  for(const id of ['table','chair','bed']){
   const ref=scene.props[id].definitionRef!.id
   expect(scene.propDefinitions[ref]).toEqual(source.propDefinitions[ref])
   expect(scene.props[id].footprintMm).toEqual(scene.propDefinitions[ref].defaultFootprintMm)
  }
  expect(scene.props.well.supportRef).toEqual({kind:'terrainArea',id:'yard'})
  const unpacked=applyCommands(scene,[{type:'unpackPrefab',id:'dining'}],{ids:{nextId:()=> 'unpack'},clock:{now:()=>scene.updatedAt}})
  expect(unpacked.prefabInstances.dining).toBeUndefined()
  expect(unpacked.props).toEqual(scene.props)
 })
 it('rejects cross-era furniture and missing real walls',()=>{
  expect(()=>createSceneCollectionScenarioDocument({...example,era:'1920s'})).toThrow('同年代')
  expect(()=>createSceneCollectionScenarioDocument({...example,openings:[{...example.openings[0],lineMm:13000}]})).toThrow('实际墙面')
 })
 it('keeps the exact new surface definitions, dimensions and source license',()=>{
  const keys=['wood-surface-oak-wide','earth-surface-trodden-loam','stone-surface-slate-cleavage']
  const scene=createSceneCollectionScenarioDocument({...example,wallMaterial:keys[2],rooms:[{...example.rooms[0],material:keys[0]}],grounds:[{...example.grounds![0],material:keys[1]}]})
  const original=createSceneCollectionSelectionDocument(keys.map(surfacesTracesDefinitionId))
  expect(Object.keys(scene.materials).sort()).toEqual(keys.map(surfacesTracesDefinitionId).sort())
  for(const key of keys){const id=surfacesTracesDefinitionId(key);expect(scene.materials[id]).toEqual(original.materials[id]);const assetId=scene.materials[id].textureAssetId!;expect(scene.assets[assetId]).toEqual(original.assets[assetId])}
  expect(()=>createSceneCollectionScenarioDocument({...example,wallMaterial:'stone-surface-invented'})).toThrow('未知场景地材')
 })
 it('creates narrow real paths with explicit ground supports and exact surface paint',()=>{
  const scene=createSceneCollectionScenarioDocument({...example,paths:[{id:'rail',centerlineMm:[{x:14000,y:10000},{x:17500,y:10000}],widthMm:70,supportRefs:[{kind:'terrainArea',id:'yard'}],material:'stone-surface-slate-cleavage',tint:'#6D767B'}]})
  expect(scene.paths.rail.widthMm).toBe(70)
  expect(scene.paths.rail.supportRefs).toEqual([{kind:'terrainArea',id:'yard'}])
  expect(scene.paths.rail.surfaceStyle!.base.materialRef.id).toBe(surfacesTracesDefinitionId('stone-surface-slate-cleavage'))
  expect(validateSceneDocument(scene).ok).toBe(true)
 })
})
