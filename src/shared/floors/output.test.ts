import { describe, expect, it } from 'vitest'
import type { BoundsMm, PointMm, SceneDocument, TerrainArea } from '../model/scene.js'
import type { TerrainComposition } from '../terrain-generation/composition-contracts.js'
import { toCurrentSceneDocument } from '../model/current-scene.js'
import { emptyVisualSystem } from '../visual/types.js'
import { visualBase } from '../visual/base.js'
import { canonicalJson, cloneJson } from '../validation/json.js'
import { validateSceneDocument } from '../validation/scene.js'
import { validateGeometry } from '../geometry/geometry.js'
import { validateCompositionContracts } from '../terrain-generation/composition-integrity.js'
import { resolveFloorOutput, validateFloorSettings } from './output.js'

const rect=(x:number,y:number,w:number,h:number):PointMm[]=>[{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}]
const bounds:BoundsMm={x:0,y:0,width:24000,height:18000}
function blank():SceneDocument {
  const now='2026-11-10T00:00:00.000Z'
  return toCurrentSceneDocument({format:'sceneweave-scene',schemaVersion:1,sceneId:'complete-floors',revision:0,title:'Independent Floors',createdAt:now,updatedAt:now,
    units:{world:'mm',display:'m',gridSizeMm:1000,snapMm:100,gridVisible:false},exportBoundsMm:{...bounds},floors:{A:{id:'A',name:'First',boundsMm:{...bounds}}},
    userLayers:{'layer-A':{id:'layer-A',floorId:'A',name:'A ground',order:0,editLocked:false}},entityLayers:{},vertices:{},rooms:{},walls:{},openings:{},props:{},regions:{},notes:{},
    assets:{},propDefinitions:{},materials:{},terrainAreas:{},terrainEdges:{},terrainConnections:{},paths:{},prefabDefinitions:{},prefabInstances:{},scatterGroups:{},styleThemes:{},activeStyleThemeRef:null,
    presetSnapshot:{presetId:'independent-floor-fixture',presetVersion:1,distanceMode:'metric',source:'Original test geometry',gridSizeMm:1000},constraints:{entranceOpeningIds:[],wallEndClearanceMm:100,pathChecks:[]},visual:emptyVisualSystem()})
}
function second(source=blank(),world:BoundsMm={...bounds}):SceneDocument {
  const scene=cloneJson(source);scene.floors.A.outputBoundsMm={...scene.exportBoundsMm}
  scene.floors.B={id:'B',name:'Second',boundsMm:{...world},outputBoundsMm:{...world}}
  scene.userLayers['layer-B']={id:'layer-B',floorId:'B',name:'B ground',order:0,editLocked:false}
  return scene
}
function terrain(scene:SceneDocument,id:string,floorId:string,points:PointMm[],height:number):TerrainArea {
  const area:TerrainArea={id,floorId,editLocked:false,visibility:'public',boundaryMm:points.map((positionMm,i)=>({id:`${id}-point-${i}`,segmentId:`${id}-segment-${i}`,positionMm})),
    groundElevationMm:height,coveragePriority:1,surfaceStyle:null,blocksMovement:false,blocksSight:false,movementCostMultiplier:1}
  scene.terrainAreas[id]=area;scene.entityLayers[id]=`layer-${floorId}`;return area
}
function physical(scene:SceneDocument,floorId:'A'|'B',height:number):void {
  terrain(scene,`high-${floorId}`,floorId,rect(12000,0,12000,18000),height)
  scene.terrainEdges[`edge-${floorId}`]={id:`edge-${floorId}`,floorId,editLocked:false,visibility:'public',source:{areaId:`high-${floorId}`,segmentId:`high-${floorId}-segment-3`},neighborAreaId:null,
    kind:'cliff',shoreline:false,blocksMovement:true,blocksSight:true,surfaceStyle:null,styleOverride:null};scene.entityLayers[`edge-${floorId}`]=`layer-${floorId}`
  const pts=floorId==='A'?[{x:2000,y:3000},{x:10000,y:3000}]:[{x:6000,y:1500},{x:6000,y:7500}]
  for(const [i,p] of pts.entries()){const id=`vertex-${floorId}-${i}`;scene.vertices[id]={id,floorId,xMm:p.x,yMm:p.y,editLocked:false};scene.entityLayers[id]=`layer-${floorId}`}
  const wallId=`wall-${floorId}`;scene.walls[wallId]={id:wallId,floorId,editLocked:false,startVertexId:`vertex-${floorId}-0`,endVertexId:`vertex-${floorId}-1`,thicknessMm:500,blocksMovement:true,blocksSight:true,topStyle:null};scene.entityLayers[wallId]=`layer-${floorId}`
  const connectionId=`ramp-${floorId}`;scene.terrainConnections[connectionId]={id:connectionId,floorId,editLocked:false,visibility:'public',kind:'ramp',from:{surfaceRef:{kind:'floor',id:floorId},positionMm:{x:11000,y:9000}},
    to:{surfaceRef:{kind:'terrainArea',id:`high-${floorId}`},positionMm:{x:13000,y:9000}},widthMm:1500,openingId:null,blocksMovement:false,movementCostMultiplier:1,surfaceStyle:null};scene.entityLayers[connectionId]=`layer-${floorId}`
  const pathId=`path-${floorId}`;scene.paths[pathId]={id:pathId,floorId,editLocked:false,visibility:'public',centerlineMm:[{x:2000,y:9000},{x:21000,y:9000}],widthMm:1000,supportRefs:[{kind:'floor',id:floorId},{kind:'terrainArea',id:`high-${floorId}`}],surfaceStyle:null,movementCostMultiplier:1,renderOrder:0};scene.entityLayers[pathId]=`layer-${floorId}`
}
function composition(scene:SceneDocument,floorId:string,center:PointMm,scope:BoundsMm):void {
  const g=scene.generation,id=`composition-${floorId}`,featureId=`feature-${floorId}`
  g.features[featureId]={id:featureId,floorId,layerId:`layer-${floorId}`,visibility:'public',editLocked:false,kind:'landmass',shape:{kind:'ellipse',centerMm:center,radiusXMm:1000,radiusYMm:1000,rotationMilliDeg:0},elevationMm:500,roughnessPpm:0,seedKey:'fixed'}
  g.legacy.recipes.recipe={id:'recipe',recipeVersion:1,algorithmId:'terrain-compose',algorithmVersion:1,mapMode:'scene',seed:'scope',parameters:{terrainKind:'mixed',seaElevationMm:0,landElevationMm:500,plateauElevationMm:1000,roughness:0,densityFactor:0,baySide:'west'},materials:[],props:[],precision:{sampleSpacingMm:2000,toleranceMm:100,noiseCellMm:2000}}
  const row:TerrainComposition={id,floorId,layerId:`layer-${floorId}`,visibility:'public',editLocked:false,recipeRef:{id:'recipe',version:1},seed:'scope',boundsMm:scope,algorithmId:'terrain-compose',algorithmVersion:1,
    precision:{sampleSpacingMm:2000,toleranceMm:100,noiseCellMm:2000},baseElevationMm:500,members:[{featureId,field:'land',operation:'add',weightPpm:1000000}],thresholdIds:[],requirementIds:[],outputRefs:[],state:'paused',inputHash:'0'.repeat(64),outputHash:'0'.repeat(64)}
  g.compositions[id]=row
}

describe('complete independent Floor output settings and geometry',()=>{
  it('preserves the exact legacy single-Floor global crop and returns independent complete environment values',()=>{
    const scene=blank();scene.exportBoundsMm={x:-1000,y:-2000,width:26000,height:22000};const before=canonicalJson(scene)
    const output=resolveFloorOutput(scene,'A')
    expect(output.boundsMm).toEqual(scene.exportBoundsMm);expect(output.environment).toEqual(visualBase(scene)!.environment)
    output.boundsMm.x++;output.environment.exposure=.5
    expect(canonicalJson(scene)).toBe(before);expect(validateGeometry(scene)).toEqual({errors:[],warnings:[]})
    expect(()=>resolveFloorOutput(scene,undefined as never)).toThrow(/明确/)
  })

  it('uses each explicit fixed crop and whole environment override, with deletion reverting to the global default',()=>{
    const scene=second(blank(),{x:-30000,y:-20000,width:24000,height:18000})
    scene.floors.B.outputBoundsMm={x:-28000,y:-19000,width:12000,height:10000}
    scene.floors.B.environment={ambientColor:'#AABBCC',ambientOpacity:.2,exposure:.8,lightDirectionDeg:300,contactShadowMm:150,contactShadowOpacity:.25}
    expect(validateFloorSettings(scene)).toEqual([]);expect(resolveFloorOutput(scene,'B')).toEqual({floorId:'B',boundsMm:scene.floors.B.outputBoundsMm,environment:scene.floors.B.environment})
    expect(resolveFloorOutput(scene,'A').environment).toEqual(visualBase(scene)!.environment)
    const changed=resolveFloorOutput(scene,'B');changed.environment.ambientColor='#FFFFFF';expect(scene.floors.B.environment.ambientColor).toBe('#AABBCC')
    delete scene.floors.B.environment;expect(resolveFloorOutput(scene,'B').environment).toEqual(visualBase(scene)!.environment)
  })

  it('rejects missing multi-Floor crops, foreign/unsafe crop bounds, partial environments, no Floors and regional multi-Floor',()=>{
    const source=second()
    for(const mutate of [
      (s:SceneDocument)=>{delete s.floors.B.outputBoundsMm},
      (s:SceneDocument)=>{s.floors.B.outputBoundsMm={x:-1,y:0,width:1000,height:1000}},
      (s:SceneDocument)=>{s.floors.B.outputBoundsMm={x:0,y:0,width:0,height:1000}},
      (s:SceneDocument)=>{s.floors.B.outputBoundsMm={x:Number.MAX_SAFE_INTEGER,y:0,width:1000,height:1000}},
      (s:SceneDocument)=>{Object.assign(s.floors.B,{environment:{exposure:1}})},
      (s:SceneDocument)=>{Object.assign(s.floors.B,{environment:null})},
    ]){const scene=cloneJson(source);mutate(scene);expect(validateFloorSettings(scene).length).toBeGreaterThan(0);expect(()=>resolveFloorOutput(scene,'A')).toThrow();expect(validateSceneDocument(scene).ok).toBe(false)}
    const noFloors=blank();noFloors.floors={};expect(validateFloorSettings(noFloors).some(e=>e.code==='UNSUPPORTED_FLOORS')).toBe(true)
    const regional=second();regional.mapMode='regional';expect(validateFloorSettings(regional).some(e=>e.code==='UNSUPPORTED_FLOORS')).toBe(true)
  })

  it('validates same-XY different-Floor terrain, crossing walls, full-width roads and distinct height connections together',()=>{
    const scene=second();physical(scene,'A',500);physical(scene,'B',1700)
    const before=canonicalJson(scene),checked=validateSceneDocument(scene)
    expect(checked.ok,JSON.stringify(checked.ok?[]:checked.errors)).toBe(true)
    expect(validateGeometry(scene).errors).toEqual([])
    expect(canonicalJson(scene)).toBe(before)
  })

  it('does not let a foreign near-collinear edge change another Floor edge probe or support subdivision',()=>{
    const original=blank();physical(original,'A',500)
    expect(validateGeometry(original).errors).toEqual([])
    const scene=second(original,{x:0,y:0,width:6000000,height:6000000})
    terrain(scene,'foreign-thin-face','B',[{x:12000,y:8999},{x:12001,y:5008999},{x:0,y:5008999}],900)
    expect(validateSceneDocument(scene).ok).toBe(true)
    expect(validateGeometry(scene).errors).toEqual([])
  })

  it('still rejects out-of-bounds data on a non-target Floor and every cross-Floor wall/support/connection reference',()=>{
    const original=second();physical(original,'A',500);physical(original,'B',1700)
    original.openings.door={id:'door',floorId:'A',editLocked:false,wallId:'wall-A',offsetReferenceVertexId:'vertex-A-0',offsetMm:1000,widthMm:1000,kind:'door',state:'open',locked:false,secret:false,revealed:false};original.entityLayers.door='layer-A'
    const mutations:[(s:SceneDocument)=>void,string][]=[
      [s=>{s.vertices['vertex-B-1'].xMm=30000},'OUTSIDE_FLOOR'],
      [s=>{s.walls['wall-A'].startVertexId='vertex-B-0'},'CROSS_FLOOR_REFERENCE'],
      [s=>{s.openings.door.floorId='B';s.entityLayers.door='layer-B'},'CROSS_FLOOR_REFERENCE'],
      [s=>{s.paths['path-A'].supportRefs=[{kind:'terrainArea',id:'high-B'}]},'CROSS_FLOOR_REFERENCE'],
      [s=>{s.terrainConnections['ramp-A'].to.surfaceRef={kind:'terrainArea',id:'high-B'}},'CROSS_FLOOR_REFERENCE'],
    ]
    for(const [mutate,code] of mutations){const scene=cloneJson(original);mutate(scene);const result=validateSceneDocument(scene);expect(result.ok).toBe(false);if(!result.ok)expect(result.errors.some(e=>e.code===code),JSON.stringify(result.errors)).toBe(true)}
  })

  it('keeps prefab and scatter members in their own Floor even when their world rectangles are identical',()=>{
    const source=second(),origin={kind:'original' as const,attribution:'Original test symbol',canEmbed:true},appearance={kind:'symbol' as const,symbol:'table' as const,tint:null,opacity:1}
    for(const floorId of ['A','B'])terrain(source,`ground-${floorId}`,floorId,rect(0,0,24000,18000),0)
    source.propDefinitions.symbol={id:'symbol',catalogId:'test.symbol',version:1,name:'Test symbol',tags:[],licenseRef:'test-mit',origin,
      defaultAppearance:appearance,defaultVisualBoundsMm:{x:-100,y:-100,width:200,height:200},defaultFootprintMm:{width:100,height:100},defaultFootprintOffsetMm:{x:0,y:0},defaultBlocksMovement:false,defaultBlocksSight:false,defaultRenderLayer:'ground',defaultShadowClass:'none'}
    const template={definitionRef:{id:'symbol',version:1},appearance,visualBoundsMm:{x:-100,y:-100,width:200,height:200},footprintMm:{width:100,height:100},footprintOffsetMm:{x:0,y:0},positionMm:{x:0,y:0},rotationDeg:0,
      blocksMovement:false,blocksSight:false,renderLayer:'ground' as const,renderOrder:0,shadowClass:'none' as const,shadowOverride:null}
    source.props.member={...template,id:'member',floorId:'B',editLocked:false,visibility:'public',positionMm:{x:4000,y:4000},supportRef:{kind:'terrainArea',id:'ground-B'}};source.entityLayers.member='layer-B'
    source.prefabDefinitions.fixed={id:'fixed',catalogId:'test.fixed',version:1,name:'Fixed one',tags:[],licenseRef:'test-mit',origin,members:[{key:'one',propTemplate:template}]}
    const prefab=cloneJson(source);prefab.prefabInstances.group={id:'group',floorId:'B',editLocked:false,visibility:'public',definitionRef:{id:'fixed',version:1},anchorMm:{x:4000,y:4000},rotationDeg:0,members:{one:{propId:'member',overrideFields:[]}}};prefab.entityLayers.group='layer-B'
    expect(validateSceneDocument(prefab).ok).toBe(true)
    prefab.prefabInstances.group.floorId='A';prefab.entityLayers.group='layer-A'
    const invalidPrefab=validateSceneDocument(prefab);expect(invalidPrefab.ok).toBe(false);if(!invalidPrefab.ok)expect(invalidPrefab.errors.some(e=>e.code==='CROSS_FLOOR_REFERENCE')).toBe(true)
    const scatter=cloneJson(source);scatter.scatterGroups.group={id:'group',floorId:'B',editLocked:false,visibility:'public',domain:{kind:'area',areaId:'ground-B'},palette:[{key:'symbol',propDefinitionRef:{id:'symbol',version:1},weight:1}],seed:'group',algorithmVersion:'scatter-cell-v2',gridOriginMm:{x:0,y:0},cellSizeMm:1000,densityFactor:0,minDistanceMm:1,rotationRangeDeg:{min:0,max:359},members:{['f'.repeat(64)]:{propId:'member',state:'managed',overrideFields:[]}},exclusions:[]};scatter.entityLayers.group='layer-B'
    expect(validateSceneDocument(scatter).ok).toBe(true)
    scatter.scatterGroups.group.floorId='A';scatter.scatterGroups.group.domain={kind:'area',areaId:'ground-A'};scatter.entityLayers.group='layer-A'
    const invalidScatter=validateSceneDocument(scatter);expect(invalidScatter.ok).toBe(false);if(!invalidScatter.ok)expect(invalidScatter.errors.some(e=>e.code==='CROSS_FLOOR_REFERENCE')).toBe(true)
  })

  it('scopes multi-Floor generation controls to their own world while preserving the original single-Floor export constraint',()=>{
    const multi=second(blank(),{x:30000,y:-10000,width:20000,height:22000})
    composition(multi,'B',{x:36000,y:-3000},{x:32000,y:-8000,width:12000,height:12000})
    expect(validateCompositionContracts(multi)).toEqual([]);expect(validateSceneDocument(multi).ok).toBe(true)
    const bad=cloneJson(multi);const feature=bad.generation.features['feature-B'];if(feature.shape.kind==='ellipse')feature.shape.centerMm.x=55000
    expect(validateCompositionContracts(bad).some(e=>e.code==='COMPOSITION_FEATURE_BOUNDS')).toBe(true)
    const badScope=cloneJson(multi);badScope.generation.compositions['composition-B'].boundsMm.x=49000
    expect(validateCompositionContracts(badScope).some(e=>e.code==='COMPOSITION_BOUNDS')).toBe(true)
    const legacy=blank();legacy.exportBoundsMm={x:-10000,y:-10000,width:60000,height:60000}
    composition(legacy,'A',{x:30000,y:5000},{x:2000,y:2000,width:6000,height:6000})
    expect(validateCompositionContracts(legacy)).toEqual([])
    legacy.exportBoundsMm={...bounds};expect(validateCompositionContracts(legacy).some(e=>e.code==='COMPOSITION_FEATURE_BOUNDS')).toBe(true)
  })
})
