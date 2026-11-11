import { describe, expect, it } from 'vitest'
import { toCurrentSceneDocument } from '../model/current-scene.js'
import type { SceneDocument } from '../model/scene.js'
import { createAppearanceGraph } from '../appearance/graph.js'
import { emptyVisualSystem } from '../visual/types.js'
import { visualBase } from '../visual/base.js'
import { cloneJson, canonicalJson } from '../validation/json.js'
import { validateSceneDocument } from '../validation/scene.js'
import { applyFloorCommand, isFloorCommand, type FloorCommand } from './commands.js'

const rect=(x:number,y:number,w:number,h:number)=>[{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}]
function blank():SceneDocument {
  const now='2026-11-10T00:00:00.000Z',bounds={x:0,y:0,width:24000,height:18000}
  return toCurrentSceneDocument({format:'sceneweave-scene',schemaVersion:1,sceneId:'floor-command-fixture',revision:0,title:'Floor command fixture',createdAt:now,updatedAt:now,
    units:{world:'mm',display:'m',gridSizeMm:1000,snapMm:100,gridVisible:false},exportBoundsMm:bounds,floors:{A:{id:'A',name:'First',boundsMm:bounds}},
    userLayers:{'layer-A':{id:'layer-A',floorId:'A',name:'First layer',order:0,editLocked:false}},entityLayers:{},vertices:{},rooms:{},walls:{},openings:{},props:{},regions:{},notes:{},
    terrainAreas:{},terrainEdges:{},terrainConnections:{},paths:{},prefabDefinitions:{},prefabInstances:{},scatterGroups:{},assets:{},propDefinitions:{},materials:{},styleThemes:{},activeStyleThemeRef:null,
    presetSnapshot:{presetId:'floor-command-fixture',presetVersion:1,distanceMode:'metric',source:'Original empty test project',gridSizeMm:1000},constraints:{entranceOpeningIds:[],wallEndClearanceMm:100,pathChecks:[]},visual:emptyVisualSystem()})
}
const create:FloorCommand={type:'createFloor',id:'B',name:'Second',boundsMm:{x:-24000,y:-18000,width:24000,height:18000},outputBoundsMm:{x:-22000,y:-16000,width:20000,height:14000},newLayerId:'layer-B',layerName:'Second layer'}
const two=()=>{const scene=blank();applyFloorCommand(scene,create);return scene}

describe('finite detached Floor commands',()=>{
  it('creates a real independent empty Floor/default layer and freezes the exact previous crop without changing global values',()=>{
    const scene=blank();scene.exportBoundsMm={x:1000,y:2000,width:20000,height:14000}
    const global=cloneJson(scene.exportBoundsMm),environment=cloneJson(visualBase(scene)!.environment),layer=cloneJson(scene.userLayers['layer-A'])
    expect(applyFloorCommand(scene,create)).toEqual({commandCost:3})
    expect(scene.floors.A.outputBoundsMm).toEqual(global);expect(scene.exportBoundsMm).toEqual(global);expect(visualBase(scene)!.environment).toEqual(environment)
    expect(scene.userLayers['layer-A']).toEqual(layer);expect(scene.floors.B.environment).toBeUndefined()
    expect(Object.values(scene.userLayers).filter(row=>row.floorId==='B')).toEqual([{id:'layer-B',floorId:'B',name:'Second layer',order:0,editLocked:false}])
    expect(validateSceneDocument(scene).ok).toBe(true)
    expect(isFloorCommand(create)).toBe(true);expect(isFloorCommand({type:'createLayer'})).toBe(false)
  })

  it('refuses an out-of-world legacy crop rather than silently changing it before creating a second Floor',()=>{
    const scene=blank();scene.exportBoundsMm={x:-1000,y:-1000,width:26000,height:20000};const before=canonicalJson(scene)
    expect(()=>applyFloorCommand(scene,create)).toThrow(/先显式设置/);expect(canonicalJson(scene)).toBe(before)
    expect(applyFloorCommand(scene,{type:'setFloorOutputBounds',id:'A',outputBoundsMm:{...scene.floors.A.boundsMm}}).commandCost).toBe(1)
    expect(applyFloorCommand(scene,create).commandCost).toBe(2)
    expect(scene.exportBoundsMm).toEqual({x:-1000,y:-1000,width:26000,height:20000})
  })

  it('stores whole per-Floor environment and output values, removes overrides explicitly and reports no-op costs',()=>{
    const scene=two(),global=cloneJson(visualBase(scene)!.environment),second=cloneJson(scene.floors.B)
    const environment={...global,exposure:.7,ambientColor:'#AABBCC'}
    expect(applyFloorCommand(scene,{type:'renameFloor',id:'A',name:'Ground'}).commandCost).toBe(1)
    expect(applyFloorCommand(scene,{type:'renameFloor',id:'A',name:'Ground'}).commandCost).toBe(0)
    expect(applyFloorCommand(scene,{type:'setFloorEnvironment',id:'A',environment}).commandCost).toBe(1)
    environment.exposure=.5;expect(scene.floors.A.environment!.exposure).toBe(.7)
    expect(applyFloorCommand(scene,{type:'setFloorEnvironment',id:'A',environment:{...environment,exposure:.7}}).commandCost).toBe(0)
    expect(applyFloorCommand(scene,{type:'setFloorEnvironment',id:'A',environment:null}).commandCost).toBe(1)
    expect(scene.floors.A).not.toHaveProperty('environment');expect(applyFloorCommand(scene,{type:'setFloorEnvironment',id:'A',environment:null}).commandCost).toBe(0)
    expect(visualBase(scene)!.environment).toEqual(global);expect(scene.floors.B).toEqual(second)
    const before=canonicalJson(scene)
    expect(()=>applyFloorCommand(scene,{type:'setFloorEnvironment',id:'A',environment:{exposure:1}} as FloorCommand)).toThrow()
    expect(()=>applyFloorCommand(scene,{type:'setFloorOutputBounds',id:'B',outputBoundsMm:{x:0,y:0,width:1000,height:1000}})).toThrow(/候选无效/)
    expect(canonicalJson(scene)).toBe(before)
  })

  it('checks all locks in the target Floor including visual entities and never unlocks a prior Floor to freeze its crop',()=>{
    for(const mutate of [
      (scene:SceneDocument)=>{scene.userLayers['layer-A'].editLocked=true},
      (scene:SceneDocument)=>{scene.notes.locked={id:'locked',floorId:'A',editLocked:true,visibility:'gm',anchor:{type:'point',positionMm:{x:1000,y:1000}},kind:'note',text:'locked'};scene.entityLayers.locked='layer-A'},
      (scene:SceneDocument)=>{visualBase(scene)!.fogs.locked={id:'locked',floorId:'A',layerId:'layer-A',editLocked:true,visibility:'public',enabled:true,boundaryMm:rect(1000,1000,2000,2000),color:'#CCDDEE',opacity:.1,directionDeg:0,scaleMm:1000,seed:'fog'}},
    ]) {
      const scene=blank();mutate(scene);const before=canonicalJson(scene)
      for(const command of [{type:'renameFloor',id:'A',name:'Renamed'},{type:'setFloorOutputBounds',id:'A',outputBoundsMm:{...scene.floors.A.boundsMm}},{type:'setFloorEnvironment',id:'A',environment:emptyVisualSystem().environment},create] as FloorCommand[])expect(()=>applyFloorCommand(scene,command)).toThrow(/锁/)
      expect(canonicalJson(scene)).toBe(before)
    }
    const independent=blank();independent.floors.A.outputBoundsMm={...independent.exportBoundsMm};independent.userLayers['layer-A'].editLocked=true
    expect(applyFloorCommand(independent,create).commandCost).toBe(2);expect(independent.userLayers['layer-A'].editLocked).toBe(true)
  })

  it('deletes only a completely empty Floor with its actual layers and requires complete appearance dependency inspection',()=>{
    const scene=two();scene.userLayers['extra-B']={id:'extra-B',floorId:'B',name:'Another empty layer',order:1,editLocked:false}
    const before=canonicalJson(scene)
    expect(()=>applyFloorCommand(scene,{type:'deleteEmptyFloor',id:'B'})).toThrow(/外观图/);expect(canonicalJson(scene)).toBe(before)
    const appearance=createAppearanceGraph(scene);appearance.layerAdjustments['extra-B']=[]
    expect(()=>applyFloorCommand(scene,{type:'deleteEmptyFloor',id:'B'},{appearance})).toThrow(/图层外观/);expect(canonicalJson(scene)).toBe(before)
    delete appearance.layerAdjustments['extra-B']
    expect(applyFloorCommand(scene,{type:'deleteEmptyFloor',id:'B'},{appearance})).toEqual({commandCost:3})
    expect(scene.floors.B).toBeUndefined();expect(scene.userLayers['layer-B']).toBeUndefined();expect(scene.userLayers['extra-B']).toBeUndefined();expect(validateSceneDocument(scene).ok).toBe(true)
    expect(()=>applyFloorCommand(scene,{type:'deleteEmptyFloor',id:'A'},{appearance:createAppearanceGraph(scene)})).toThrow(/至少/)
  })

  it('refuses remaining point notes, visual effects, generation reservations and locked empty layers without partial deletion',()=>{
    for(const mutate of [
      (scene:SceneDocument)=>{scene.notes.note={id:'note',floorId:'B',editLocked:false,visibility:'public',anchor:{type:'point',positionMm:{x:-10000,y:-10000}},kind:'note',text:'preserve'};scene.entityLayers.note='layer-B'},
      (scene:SceneDocument)=>{visualBase(scene)!.fogs.fog={id:'fog',floorId:'B',layerId:'layer-B',editLocked:false,visibility:'public',enabled:false,boundaryMm:rect(-20000,-14000,1000,1000),color:'#CCDDEE',opacity:.1,directionDeg:0,scaleMm:1000,seed:'fog'}},
      (scene:SceneDocument)=>{scene.generation.legacy.constraints.activity={id:'activity',floorId:'B',kind:'activityArea',visibility:'public',strength:'soft',boundaryMm:rect(-20000,-14000,1000,1000),clearanceMm:0}},
      (scene:SceneDocument)=>{scene.userLayers['layer-B'].editLocked=true},
    ]) {
      const scene=two();mutate(scene);expect(validateSceneDocument(scene).ok).toBe(true);const before=canonicalJson(scene)
      expect(()=>applyFloorCommand(scene,{type:'deleteEmptyFloor',id:'B'},{appearance:createAppearanceGraph(scene)})).toThrow(/归属|依赖|锁/)
      expect(canonicalJson(scene)).toBe(before)
    }
  })

  it('refuses duplicate identities, invalid endpoints, unknown fields and regional multi-Floor creation atomically',()=>{
    for(const command of [{...create,id:'layer-A'},{...create,newLayerId:'A'},{...create,newLayerId:'B'},{...create,outputBoundsMm:{x:Number.MAX_SAFE_INTEGER,y:0,width:1000,height:1000}},{...create,extra:true}] as FloorCommand[]) {
      const scene=blank(),before=canonicalJson(scene);expect(()=>applyFloorCommand(scene,command)).toThrow();expect(canonicalJson(scene)).toBe(before)
    }
    const regional=blank();regional.mapMode='regional';const before=canonicalJson(regional)
    expect(()=>applyFloorCommand(regional,create)).toThrow(/区域/);expect(canonicalJson(regional)).toBe(before)
  })
})
