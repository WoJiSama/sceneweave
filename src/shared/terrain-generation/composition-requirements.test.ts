import { describe, expect, it } from 'vitest'
import { createRefinedBlankDocument } from '../../platform/browser/content/refined-blank.js'
import { symbolPropV3 } from '../../core/v3/test-fixtures.js'
import type { PointMm, SceneDocument } from '../model/scene.js'
import { canonicalJson } from '../validation/json.js'
import { sha256Text } from '../validation/hash.js'
import { createEmptyGeneration5, type GenerationSystem5, type TerrainRequirement } from './composition-contracts.js'
import { emptyCompositionDocument } from './composition-materialize.js'
import { resolveGenerationEntity, resolveGenerationTarget } from './integrity.js'
import { evaluateTerrainRequirement } from './composition-requirements.js'

type Fixture = SceneDocument & { generation: GenerationSystem5 }
const floorId='visual-floor',layerId='visual-layer-ground',compositionId='requirement-composition'
const rectangle=(x:number,y:number,width:number,height:number):PointMm[]=>[{x,y},{x:x+width,y},{x:x+width,y:y+height},{x,y:y+height}]
// These typed fixtures isolate the physical requirement predicates; they do not
// provide complete-project, resource-byte, or identity validation evidence.
function fixture(water=true):Fixture {
  const scene=emptyCompositionDocument(createRefinedBlankDocument('island',{sceneId:'requirements-fixture',title:'Physical requirement fixture',widthMm:24000,heightMm:18000,preset:'narrative',now:'2026-10-29T00:00:00.000Z'}))
  scene.generation=createEmptyGeneration5()
  const generation=scene.generation,waterMaterial='refined-material-island-material-shallows'
  generation.legacy.recipes.recipe={id:'recipe',recipeVersion:1,algorithmId:'terrain-compose',algorithmVersion:1,mapMode:'scene',seed:'requirements',parameters:{terrainKind:'mixed',seaElevationMm:0,landElevationMm:600,plateauElevationMm:3200,roughness:0,densityFactor:0,baySide:'west'},materials:[{role:'water',ref:{id:waterMaterial,version:1}}],props:[],precision:{sampleSpacingMm:1000,toleranceMm:100,noiseCellMm:2000}}
  generation.compositions[compositionId]={id:compositionId,floorId,layerId,visibility:'public',editLocked:false,recipeRef:{id:'recipe',version:1},seed:'requirements',boundsMm:{...scene.exportBoundsMm},algorithmId:'terrain-compose',algorithmVersion:1,precision:{sampleSpacingMm:1000,toleranceMm:100,noiseCellMm:2000},baseElevationMm:600,members:[],thresholdIds:[],requirementIds:[],outputRefs:[],state:'active',inputHash:'0'.repeat(64),outputHash:'0'.repeat(64)}
  const material=scene.materials[waterMaterial]
  scene.terrainAreas.surface={id:'surface',floorId,visibility:'public',editLocked:false,boundaryMm:rectangle(0,0,24000,18000).map((positionMm,i)=>({id:`surface-p${i}`,segmentId:`surface-s${i}`,positionMm})),groundElevationMm:0,coveragePriority:0,
    surfaceStyle:water?{base:{materialRef:{id:material.id,version:material.version},tileSizeMm:{...material.defaultTileSizeMm},rotationDeg:0,alignment:'world',originMm:{x:0,y:0},tint:null,opacity:1},overlays:[]}:null,blocksMovement:water,blocksSight:false,movementCostMultiplier:1}
  scene.entityLayers.surface=layerId
  return scene as Fixture
}
const channel:TerrainRequirement={id:'channel',compositionId,kind:'channelWidth',strength:'hard',pointsMm:[{x:3000,y:9000},{x:21000,y:9000}],minWidthMm:2000}
const evaluate=(scene:SceneDocument)=>evaluateTerrainRequirement(scene,channel)
function prop(scene:SceneDocument,x=12000,y=9000){
  scene.props.blocker={...symbolPropV3('blocker',x,y),floorId,supportRef:{kind:'terrainArea',id:'surface'},blocksMovement:true}
  scene.entityLayers.blocker=layerId
  return scene.props.blocker
}
function wall(scene:SceneDocument,y1=4000,y2=14000){
  scene.vertices.start={id:'start',floorId,editLocked:false,xMm:12000,yMm:y1};scene.vertices.end={id:'end',floorId,editLocked:false,xMm:12000,yMm:y2}
  scene.walls.wall={id:'wall',floorId,editLocked:false,startVertexId:'start',endVertexId:'end',thicknessMm:400,blocksMovement:true,blocksSight:true,topStyle:null}
}
function connection(scene:SceneDocument,y=9000){
  scene.terrainConnections.connection={id:'connection',floorId,visibility:'public',editLocked:false,kind:'ramp',from:{surfaceRef:{kind:'terrainArea',id:'surface'},positionMm:{x:10000,y}},to:{surfaceRef:{kind:'terrainArea',id:'surface'},positionMm:{x:14000,y}},widthMm:1000,openingId:null,blocksMovement:true,movementCostMultiplier:1,surfaceStyle:null}
  return scene.terrainConnections.connection
}
const legacy:TerrainRequirement={id:'legacy',compositionId,kind:'legacyConstraint',constraintId:'legacy-constraint',strength:'hard'}
function routeFixture(algorithmId='terrain-route',algorithmVersion=1):Fixture{
  const scene=fixture(false)
  scene.generation.legacy.constraints['legacy-constraint']={id:'legacy-constraint',floorId,visibility:'public',strength:'hard',kind:'route',pointsMm:[{x:3000,y:9000},{x:21000,y:9000}],minWidthMm:2000}
  scene.generation.legacy.checks.receipt={id:'receipt',constraintId:'legacy-constraint',state:'passed',algorithmId,algorithmVersion,inputHash:'0'.repeat(64),issues:[]}
  return scene
}

describe('complete physical channel width requirements',()=>{
  it('accepts water without obstacles and ignores remote blockers of every supported kind',()=>{
    const scene=fixture();expect(evaluate(scene).state).toBe('passed')
    prop(scene,12000,3000);wall(scene,1000,4000)
    scene.regions.region={id:'region',floorId,visibility:'gm',editLocked:false,kind:'hazard',boundaryMm:rectangle(16000,2000,1000,1000),blocksMovement:true,movementCostMultiplier:1}
    connection(scene,3000)
    expect(evaluate(scene).state).toBe('passed')
  })
  it.each(['prop','wall','region','connection'] as const)('rejects an actual intersecting %s and names that blocker',kind=>{
    const scene=fixture()
    if(kind==='prop')prop(scene)
    if(kind==='wall')wall(scene)
    if(kind==='region')scene.regions.region={id:'region',floorId,visibility:'gm',editLocked:false,kind:'hazard',boundaryMm:rectangle(11000,8500,2000,1000),blocksMovement:true,movementCostMultiplier:1}
    if(kind==='connection')connection(scene)
    expect(evaluate(scene)).toMatchObject({state:'failed',issues:[{code:'CHANNEL_OBSTACLE',entityId:kind==='prop'?'blocker':kind}]})
  })
  it('uses the rotated footprint and its offset rather than the image or entity centre',()=>{
    const scene=fixture(),item=prop(scene,12000,10600)
    item.footprintMm={width:1800,height:200};item.visualBoundsMm={x:-8000,y:-8000,width:16000,height:16000}
    expect(evaluate(scene).state).toBe('passed')
    item.rotationDeg=45;expect(evaluate(scene).state).toBe('failed')
    item.rotationDeg=0;item.positionMm.y=15000;item.footprintOffsetMm.y=-6000
    expect(evaluate(scene).state).toBe('failed')
  })
  it('includes the full width and square end caps and allows exact boundary touching',()=>{
    const scene=fixture(),item=prop(scene,2500,9000)
    expect(evaluate(scene).state).toBe('failed')
    item.positionMm={x:12000,y:10100};expect(evaluate(scene).state).toBe('passed')
    item.positionMm.y=10099;expect(evaluate(scene).state).toBe('failed')
  })
  it('checks actual door aperture and current open/locked state',()=>{
    const scene=fixture();wall(scene)
    scene.openings.door={id:'door',floorId,editLocked:false,wallId:'wall',offsetReferenceVertexId:'start',offsetMm:3500,widthMm:3000,kind:'door',state:'open',locked:false,secret:false,revealed:true}
    expect(evaluate(scene).state).toBe('passed')
    scene.openings.door.state='closed';expect(evaluate(scene).state).toBe('failed')
    scene.openings.door.state='open';scene.openings.door.locked=true;expect(evaluate(scene).state).toBe('failed')
    scene.openings.door.locked=false;scene.openings.door.kind='window';expect(evaluate(scene).state).toBe('failed')
  })
  it('ignores nonblocking or other-Floor entities but never ignores a hidden physical blocker',()=>{
    const scene=fixture(),item=prop(scene);item.blocksMovement=false
    const link=connection(scene);link.blocksMovement=false
    expect(evaluate(scene).state).toBe('passed')
    item.blocksMovement=true;item.floorId='other-floor';link.blocksMovement=true;link.floorId='other-floor'
    expect(evaluate(scene).state).toBe('passed')
    item.floorId=floorId;item.visibility='gm';expect(evaluate(scene).state).toBe('failed')
  })
})

describe('legacy hard requirements require actual recomputation',()=>{
  it.each([['future-route',1],['terrain-route',2]] as const)('refuses unknown %s version %s despite a stored passed receipt',(algorithmId,version)=>{
    const scene=routeFixture(algorithmId,version)
    expect(evaluateTerrainRequirement(scene,legacy)).toMatchObject({state:'failed',issues:[{code:'LEGACY_CHECK_UNSUPPORTED'}]})
  })
  it('does not allow a known receipt to hide an additional unknown checking algorithm',()=>{
    const scene=routeFixture()
    scene.generation.legacy.checks.future={...scene.generation.legacy.checks.receipt,id:'future',algorithmId:'future-route'}
    expect(evaluateTerrainRequirement(scene,legacy).state).toBe('failed')
  })
  it.each(['terrain-route','terrain-route-ground'])('recomputes %s from current physical geometry rather than receipt state',algorithmId=>{
    const scene=routeFixture(algorithmId)
    scene.generation.legacy.checks.receipt.state='failed'
    expect(evaluateTerrainRequirement(scene,legacy).state).toBe('passed')
    expect(scene.generation.legacy.checks.receipt.state).toBe('failed')
    prop(scene)
    scene.generation.legacy.checks.receipt.state='passed'
    expect(evaluateTerrainRequirement(scene,legacy)).toMatchObject({state:'failed',issues:expect.arrayContaining([expect.objectContaining({code:'TERRAIN_TRAVEL_OBSTACLE',entityId:'blocker'})])})
    expect(scene.generation.legacy.checks.receipt.state).toBe('passed')
  })
  it('preserves the known ground-only mode when an otherwise walkable route enters terrain-shallow',()=>{
    const scene=routeFixture('terrain-route-ground'),area=scene.terrainAreas.surface
    delete scene.terrainAreas.surface;area.id='terrain-shallow';scene.terrainAreas[area.id]=area
    expect(evaluateTerrainRequirement(scene,legacy)).toMatchObject({state:'failed',issues:[{code:'LEGACY_ROUTE_GROUND'}]})
    scene.generation.legacy.checks.receipt.algorithmId='terrain-route'
    expect(evaluateTerrainRequirement(scene,legacy).state).toBe('passed')
  })
  it.each(['activityArea','port'] as const)('explicitly refuses unsupported %s semantics',kind=>{
    const scene=routeFixture()
    const common={id:'legacy-constraint',floorId,visibility:'public' as const,strength:'hard' as const}
    scene.generation.legacy.constraints['legacy-constraint']=kind==='activityArea'?{...common,kind,boundaryMm:rectangle(3000,3000,1000,1000),clearanceMm:0}:{...common,kind,positionMm:{x:3000,y:3000},directionDeg:0,widthMm:1000}
    expect(evaluateTerrainRequirement(scene,legacy)).toMatchObject({state:'failed',issues:[{code:'LEGACY_CHECK_UNSUPPORTED'}]})
  })
  it.each(['preserveGeometry','preserveEntity'] as const)('recomputes the complete explicit %s target hash and refuses deletion',kind=>{
    const scene=fixture(false),target={kind:'terrainArea' as const,entityId:'surface',parentId:null,fieldGroup:'geometry' as const}
    const value=kind==='preserveGeometry'?resolveGenerationTarget(scene,target):resolveGenerationEntity(scene,target)
    const hash=sha256Text(canonicalJson(value)),common={id:'legacy-constraint',floorId,visibility:'public' as const,strength:'hard' as const,target}
    scene.generation.legacy.constraints['legacy-constraint']=kind==='preserveGeometry'?{...common,kind,geometryHash:hash}:{...common,kind,contentHash:hash}
    expect(evaluateTerrainRequirement(scene,legacy).state).toBe('passed')
    scene.terrainAreas.surface.groundElevationMm=10;expect(evaluateTerrainRequirement(scene,legacy).state).toBe('failed')
    scene.terrainAreas.surface.groundElevationMm=0;expect(evaluateTerrainRequirement(scene,legacy).state).toBe('passed')
    delete scene.terrainAreas.surface;expect(evaluateTerrainRequirement(scene,legacy).state).toBe('failed')
  })
  it('refuses missing, soft or cross-Floor legacy constraints',()=>{
    const scene=routeFixture(),constraint=scene.generation.legacy.constraints['legacy-constraint']
    constraint.strength='soft';expect(evaluateTerrainRequirement(scene,legacy).state).toBe('failed')
    constraint.strength='hard';constraint.floorId='other-floor';expect(evaluateTerrainRequirement(scene,legacy).state).toBe('failed')
    delete scene.generation.legacy.constraints['legacy-constraint'];expect(evaluateTerrainRequirement(scene,legacy).state).toBe('failed')
  })
})
