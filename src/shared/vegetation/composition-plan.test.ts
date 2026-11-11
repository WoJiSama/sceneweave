import { describe, expect, it } from 'vitest'
import type { PointMm, Prop, SceneDocument } from '../model/scene.js'
import { applyCommands } from '../commands/commands.js'
import { applyCompositionCommands } from '../appearance/commands.js'
import { addPropAppearanceSource, createAppearanceGraph, createCompositionContent } from '../appearance/graph.js'
import { definitionPresentation, propPaintPolygon, propPresentation } from '../appearance/presentation.js'
import { pathPolygon, polygonDistance, polygonInside, propFootprint, supportedPolygon, terrainPoints } from '../geometry/geometry.js'
import { wallEnvelopePolygons } from '../geometry/doorway-clearance.js'
import { MANUAL_TRANSACTION_BUDGET } from '../budget/command-budget.js'
import { canonicalJson, cloneJson } from '../validation/json.js'
import { validateCompositionContent } from '../validation/content.js'
import { validateSceneDocument } from '../validation/scene.js'
import { createVegetationDetailCatalogDocument } from '../../platform/browser/content/vegetation-detail-catalog.js'
import { vegetationDetailDefinitionId } from '../visual/vegetation-detail-art.js'
import { buildVegetationCompositionPlan, VEGETATION_COMPOSITION_CHANNELS, type VegetationCompositionRequest } from './composition-plan.js'

const rect = (x: number,y: number,w: number,h: number): PointMm[] => [{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}]
let runtimeNumber=0
const runtime = () => { let n=0;const owner=++runtimeNumber;return {ids:{nextId:()=>`ordinary-native-${owner}-${++n}`},clock:{now:()=> '2026-11-10T00:00:00.000Z'}} }
function fixture(x=-5000,y=-3000,w=24000,h=20000): SceneDocument {
  const source=createVegetationDetailCatalogDocument({sceneId:'composition-anywhere'}), floor=Object.values(source.floors)[0], layer=Object.values(source.userLayers)[0]
  delete source.floors[floor.id];floor.id='arbitrary-floor';floor.boundsMm={x,y,width:w,height:h};source.floors[floor.id]=floor
  delete source.userLayers[layer.id];layer.id='arbitrary-plant-layer';layer.floorId=floor.id;source.userLayers[layer.id]=layer;source.exportBoundsMm={...floor.boundsMm}
  source.terrainAreas['any-ground']={id:'any-ground',floorId:floor.id,editLocked:false,visibility:'public',boundaryMm:rect(x,y,w,h).map((positionMm,i)=>({id:`world-point-${i}`,segmentId:`world-segment-${i}`,positionMm})),
    groundElevationMm:650,coveragePriority:2,surfaceStyle:null,blocksMovement:false,blocksSight:false,movementCostMultiplier:1}
  source.entityLayers['any-ground']=layer.id
  expect(validateSceneDocument(source).ok).toBe(true)
  return source
}
function request(): VegetationCompositionRequest {
  const config=(key:string,cellSizeMm=3000)=>({enabled:true as const,palette:[{key,propDefinitionRef:{id:vegetationDetailDefinitionId(key),version:1},weight:1}],densityFactor:1,cellSizeMm,minDistanceMm:120})
  return {version:1,operationId:'first-explicit-community',floorId:'arbitrary-floor',areaId:'any-ground',layerId:'arbitrary-plant-layer',visibility:'public',seed:'community-6',
    channels:{mainTrees:config('tree-spreading-oak'),secondaryTrees:config('tree-narrow-birch'),shrubs:config('shrub-splayed-fern',2400),grass:config('grass-bent-verge',2400)},clearings:[],avoidances:[]}
}
function plan(scene:SceneDocument,req=request(),appearance=createAppearanceGraph(scene)) {return buildVegetationCompositionPlan(scene,req,{...runtime(),appearance})}
function materialize(scene:SceneDocument,req=request(),appearance=createAppearanceGraph(scene)) {
  const proposed=plan(scene,req,appearance),result=applyCommands(scene,proposed.commands,runtime(),{appearance,budget:MANUAL_TRANSACTION_BUDGET})
  return {proposed,result}
}
function newProps(scene:SceneDocument,proposed:ReturnType<typeof plan>):Prop[] {return proposed.channelSummary.flatMap(row=>row.groupId ? Object.values(scene.scatterGroups[row.groupId].members).flatMap(m=>m.propId ? [scene.props[m.propId]]:[]):[])}

describe('new native four-channel vegetation composition plan',()=>{
  it('uses arbitrary IDs, dimensions and negative world coordinates with four persisted native groups and deterministic commands',()=>{
    for(const source of [fixture(),fixture(-23000,-18000,31000,23000)]) {
      const before=canonicalJson(source),first=plan(source),second=plan(source)
      expect(first).toEqual(second)
      const {result}=materialize(source)
      expect(first.channelSummary.map(row=>row.key)).toEqual([...VEGETATION_COMPOSITION_CHANNELS])
      expect(first.channelSummary.every(row=>row.createdMembers>0)).toBe(true)
      for(const row of first.channelSummary) {
        expect(result.scatterGroups[row.groupId!].algorithmVersion).toBe('scatter-cell-v2')
        expect(Object.values(result.scatterGroups[row.groupId!].members).filter(m=>m.propId).length).toBe(row.createdMembers)
      }
      for(const prop of newProps(result,first)) expect(supportedPolygon(result,propFootprint(prop),{kind:'terrainArea',id:'any-ground'},'arbitrary-floor')).toBe(true)
      expect(canonicalJson(source)).toBe(before)
      expect(()=>plan(result)).toThrow(/身份已被占用/)
    }
  },15_000)

  it('protects full-width roads and clearings separately from actual rotated canopy and footprint, retaining fixed near-side roots',()=>{
    let source=fixture(-8000,-6000,36000,28000)
    source=applyCommands(source,[{type:'createPath',id:'real-path',floorId:'arbitrary-floor',layerId:'arbitrary-plant-layer',centerlineMm:[{x:8000,y:-3000},{x:8000,y:19000}],widthMm:1800,supportRefs:[{kind:'terrainArea',id:'any-ground'}]}],runtime())
    const req=request();req.clearings=[{boundaryMm:rect(-2000,3000,2500,3000),footprintMarginMm:120,paintMarginMm:350}]
    req.avoidances=[{ref:{kind:'path',id:'real-path'},footprintMarginMm:170,paintMarginMm:420}]
    const appearance=createAppearanceGraph(source),definition=source.propDefinitions[vegetationDetailDefinitionId('tree-narrow-birch')]
    addPropAppearanceSource(appearance,{definitionRef:{id:definition.id,version:definition.version},appearance:definition.defaultAppearance,visualBoundsMm:definition.defaultVisualBoundsMm,shadowClass:definition.defaultShadowClass,shadowOverride:null},null,
      {mode:'nearSide',rootAnchorMm:{x:300,y:800},orientation:'fixedUpright',fixedRotationDeg:0,footprintAxes:'world',groundShadowMm:null})
    const {proposed,result}=materialize(source,req,appearance)
    expect(newProps(result,proposed).length).toBeGreaterThan(0)
    for(const prop of newProps(result,proposed)) {
      const image=propPaintPolygon(prop,definitionPresentation(appearance,prop.definitionRef)),footprint=propFootprint(prop)
      expect(polygonDistance(image,pathPolygon(result.paths['real-path']))).toBeGreaterThanOrEqual(420)
      expect(polygonDistance(footprint,pathPolygon(result.paths['real-path']))).toBeGreaterThanOrEqual(170)
      expect(polygonDistance(image,req.clearings[0].boundaryMm)).toBeGreaterThanOrEqual(350)
      expect(polygonDistance(footprint,req.clearings[0].boundaryMm)).toBeGreaterThanOrEqual(120)
      expect(polygonInside(image,terrainPoints(result.terrainAreas['any-ground']))).toBe(true)
    }
  },15_000)

  it('does not let an unrelated secret prop alter public commands or members and refuses an explicit private avoidance',()=>{
    const source=fixture(),privateScene=cloneJson(source),definition=source.propDefinitions[vegetationDetailDefinitionId('grass-bent-verge')]
    const changed=applyCommands(privateScene,[{type:'addProp',id:'private-grass',floorId:'arbitrary-floor',definitionRef:{id:definition.id,version:1},positionMm:{x:4000,y:4000},supportRef:{kind:'terrainArea',id:'any-ground'},layerId:'arbitrary-plant-layer'}],runtime())
    changed.props['private-grass'].visibility='gm';changed.props['private-grass'].editLocked=true
    const a=materialize(source),b=materialize(changed)
    expect(a.proposed).toEqual(b.proposed)
    const semantic=(props:Prop[])=>props.map(p=>({position:p.positionMm,rotation:p.rotationDeg,definition:p.definitionRef}))
    expect(semantic(newProps(a.result,a.proposed))).toEqual(semantic(newProps(b.result,b.proposed)))
    const req=request();req.avoidances=[{ref:{kind:'prop',id:'private-grass'},footprintMarginMm:100,paintMarginMm:100}]
    expect(()=>plan(changed,req)).toThrow(/私密|未揭示/)
    expect(b.result.props['private-grass']).toEqual(changed.props['private-grass'])
  },15_000)

  it('reads real room-wall joins and current instance paint, rejecting a locked geometric dependency of an explicit avoidance',()=>{
    const source=applyCommands(fixture(0,0,32000,26000),[{type:'createRoom',id:'real-lodge',floorId:'arbitrary-floor',layerId:'arbitrary-plant-layer',boundaryMm:rect(12000,10000,6000,5000),thicknessMm:800,supportRef:{kind:'terrainArea',id:'any-ground'}},
      {type:'addProp',id:'source-pine',floorId:'arbitrary-floor',layerId:'arbitrary-plant-layer',definitionRef:{id:vegetationDetailDefinitionId('tree-broken-fan-pine'),version:1},positionMm:{x:26000,y:19000},supportRef:{kind:'terrainArea',id:'any-ground'}}],runtime(),{budget:MANUAL_TRANSACTION_BUDGET})
    const appearance=createAppearanceGraph(source)
    appearance.propSources['source-pine']=addPropAppearanceSource(appearance,source.props['source-pine'],appearance.propSources['source-pine'],
      {mode:'nearSide',rootAnchorMm:{x:-500,y:1200},orientation:'fixedUpright',fixedRotationDeg:0,footprintAxes:'world',groundShadowMm:null})
    const req=request();req.avoidances=[{ref:{kind:'room',id:'real-lodge'},footprintMarginMm:100,paintMarginMm:250},
      {ref:{kind:'prop',id:'source-pine'},footprintMarginMm:80,paintMarginMm:220}]
    const {proposed,result}=materialize(source,req,appearance),walls=wallEnvelopePolygons(source)
    expect(newProps(result,proposed).length).toBeGreaterThan(0)
    for(const prop of newProps(result,proposed)) for(const wall of walls) expect(polygonDistance(propPaintPolygon(prop),wall.polygon)).toBeGreaterThanOrEqual(250)
    for(const prop of newProps(result,proposed)) expect(polygonDistance(propPaintPolygon(prop),propPaintPolygon(source.props['source-pine'],propPresentation(appearance,'source-pine')))).toBeGreaterThanOrEqual(220)
    const locked=cloneJson(source);locked.vertices[locked.rooms['real-lodge'].boundaryVertexIds[0]].editLocked=true
    expect(()=>plan(locked,req)).toThrow(/依赖已锁定/)
  },15_000)

  it('retains old managed/manual/deleted/detached slots, existing groups and an unrelated locked prop through ordinary composition adoption',()=>{
    let source=fixture()
    const grass=vegetationDetailDefinitionId('grass-bent-verge')
    source=applyCommands(source,[{type:'createScatter',id:'old-group',floorId:'arbitrary-floor',layerId:'arbitrary-plant-layer',domain:{kind:'area',areaId:'any-ground'},algorithmVersion:'scatter-cell-v2',palette:[{key:'grass',propDefinitionRef:{id:grass,version:1},weight:1}],seed:'old-user-group',cellSizeMm:2600,densityFactor:1,minDistanceMm:80},
      {type:'regenerateScatter',id:'old-group'}],runtime(),{budget:MANUAL_TRANSACTION_BUDGET})
    const ids=Object.values(source.scatterGroups['old-group'].members).flatMap(member=>member.propId ? [member.propId]:[])
    expect(ids.length).toBeGreaterThan(3)
    source=applyCommands(source,[{type:'updateProp',id:ids[0],changes:{positionMm:{x:source.props[ids[0]].positionMm.x+50,y:source.props[ids[0]].positionMm.y}}},
      {type:'deleteProp',id:ids[1]},{type:'detachScatterMember',groupId:'old-group',propId:ids[2]}],runtime(),{budget:MANUAL_TRANSACTION_BUDGET})
    source=applyCommands(source,[{type:'setEditLock',kind:'prop',id:ids[3],locked:true}],runtime())
    const before=canonicalJson(source),proposed=plan(source),content=createCompositionContent(source,runtime())
    const adopted=applyCompositionCommands(content,proposed.commands,runtime(),{budget:MANUAL_TRANSACTION_BUDGET})
    expect(validateCompositionContent(adopted).document).toEqual(adopted.document)
    expect(adopted.document.scatterGroups['old-group']).toEqual(source.scatterGroups['old-group'])
    for(const [id,prop] of Object.entries(source.props)) expect(adopted.document.props[id]).toEqual(prop)
    expect(canonicalJson(source)).toBe(before)
  },15_000)

  it('requires explicit applicable channels and exact fixed palette while allowing an explicitly disabled channel',()=>{
    const source=fixture(),req=request();req.channels.secondaryTrees={enabled:false}
    const proposed=plan(source,req)
    expect(proposed.channelSummary.find(row=>row.key==='secondaryTrees')).toEqual({key:'secondaryTrees',groupId:null,densityFactor:0,exclusionCount:0,createdMembers:0})
    expect(proposed.commands.filter(c=>c.type==='createScatter')).toHaveLength(3)
    const empty=request();if(empty.channels.grass.enabled) empty.channels.grass.palette=[]
    expect(()=>plan(source,empty)).toThrow()
    const missing=request();if(missing.channels.mainTrees.enabled) missing.channels.mainTrees.palette[0].propDefinitionRef.version=2
    expect(()=>plan(source,missing)).toThrow(/确切版本/)
    const none=request();for(const key of VEGETATION_COMPOSITION_CHANNELS) none.channels[key]={enabled:false}
    expect(()=>plan(source,none)).toThrow(/至少/)
  })

  it('keeps new groups editable by ordinary regeneration without reviving manual deletion or detached slots',()=>{
    const source=fixture(),req=request();req.channels.mainTrees={enabled:false};req.channels.secondaryTrees={enabled:false};req.channels.shrubs={enabled:false}
    const {proposed,result}=materialize(source,req),groupId=proposed.channelSummary.find(row=>row.key==='grass')!.groupId!
    const ids=Object.values(result.scatterGroups[groupId].members).flatMap(member=>member.propId ? [member.propId]:[])
    expect(ids.length).toBeGreaterThan(3)
    let changed=applyCommands(result,[{type:'updateProp',id:ids[0],changes:{positionMm:{x:result.props[ids[0]].positionMm.x+40,y:result.props[ids[0]].positionMm.y}}},
      {type:'deleteProp',id:ids[1]},{type:'detachScatterMember',groupId,propId:ids[2]}],runtime(),{budget:MANUAL_TRANSACTION_BUDGET})
    changed=applyCommands(changed,[{type:'setEditLock',kind:'prop',id:ids[3],locked:true}],runtime())
    const before=cloneJson(changed),regenerated=applyCommands(changed,[{type:'regenerateScatter',id:groupId,densityFactor:.2}],runtime(),{budget:MANUAL_TRANSACTION_BUDGET})
    for(const id of [ids[0],ids[2],ids[3]]) expect(regenerated.props[id]).toEqual(before.props[id])
    expect(regenerated.props[ids[1]]).toBeUndefined()
    for(const [key,member] of Object.entries(before.scatterGroups[groupId].members)) if(member.state!=='managed'||member.propId===ids[3]) expect(regenerated.scatterGroups[groupId].members[key]).toEqual(member)
    expect(changed).toEqual(before)
  })

  it('rejects target/support/explicit dependency locks, malformed or cross-floor requests and cancellation without mutating source',()=>{
    const original=fixture(),prepared=plan(original)
    for(const mutate of [(s:SceneDocument)=>{s.userLayers['arbitrary-plant-layer'].editLocked=true},(s:SceneDocument)=>{s.terrainAreas['any-ground'].editLocked=true}]) {
      const source=cloneJson(original);mutate(source);const before=canonicalJson(source)
      expect(()=>plan(source)).toThrow(/锁/);expect(canonicalJson(source)).toBe(before)
      expect(()=>applyCommands(source,prepared.commands,runtime(),{budget:MANUAL_TRANSACTION_BUDGET})).toThrow(/锁/)
      expect(canonicalJson(source)).toBe(before)
    }
    const road=applyCommands(original,[{type:'createPath',id:'locked-road',floorId:'arbitrary-floor',layerId:'arbitrary-plant-layer',centerlineMm:[{x:2000,y:1000},{x:2000,y:10000}],widthMm:1200,supportRefs:[{kind:'terrainArea',id:'any-ground'}]}],runtime())
    road.paths['locked-road'].editLocked=true
    const req=request();req.avoidances=[{ref:{kind:'path',id:'locked-road'},footprintMarginMm:0,paintMarginMm:0}]
    expect(()=>plan(road,req)).toThrow(/依赖已锁定/)
    expect(()=>plan(original,{...request(),floorId:'other-floor'})).toThrow(/同Floor/)
    const malformed=request();malformed.clearings=[{boundaryMm:[{x:0,y:0},{x:2000,y:2000},{x:0,y:2000},{x:2000,y:0}],footprintMarginMm:0,paintMarginMm:0}]
    expect(()=>plan(original,malformed)).toThrow(/曲线/)
    expect(()=>buildVegetationCompositionPlan(original,request(),{...runtime(),appearance:createAppearanceGraph(original),signal:{aborted:true}})).toThrow(/取消/)
    expect(()=>buildVegetationCompositionPlan(original,request(),{...runtime(),appearance:null as never})).toThrow()
  })

  it('accounts for real expanded members and grid work at compact256, refusing the complete plan on a late failure',()=>{
    const source=fixture(0,0,40000,40000),before=canonicalJson(source),req=request()
    req.channels.mainTrees={enabled:false};req.channels.secondaryTrees={enabled:false};req.channels.shrubs={enabled:false}
    if(req.channels.grass.enabled) req.channels.grass.cellSizeMm=900
    expect(()=>plan(source,req)).toThrow(/预算|256/)
    expect(canonicalJson(source)).toBe(before)
    if(req.channels.grass.enabled) req.channels.grass.cellSizeMm=100
    expect(()=>plan(source,req)).toThrow(/网格/)
    expect(canonicalJson(source)).toBe(before)
    const duplicate=request();duplicate.clearings=Array.from({length:16},()=>({boundaryMm:rect(10000,10000,1000,1000),footprintMarginMm:0,paintMarginMm:0}));duplicate.avoidances=Array.from({length:32},()=>({ref:{kind:'terrainArea' as const,id:'any-ground'},footprintMarginMm:0,paintMarginMm:0}))
    expect(()=>plan(source,duplicate)).toThrow(/重复/)
  },15_000)
})
