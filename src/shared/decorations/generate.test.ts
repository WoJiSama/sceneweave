import { describe, expect, it } from 'vitest'
import type { DecorationCluster, PropDefinition, SceneDocument } from '../model/scene.js'
import { createEmptyGeneration5 } from '../terrain-generation/composition-contracts.js'
import { constraintInputHash } from '../terrain-generation/integrity.js'
import { emptyVisualSystem } from '../visual/types.js'
import { TERRAIN_VARIANT_ART } from '../visual/terrain-variant-art.js'
import { applyCommands } from '../commands/commands.js'
import { terrainCommandCost } from '../terrain-generation/cost.js'
import { isEntityEditLocked } from '../commands/base.js'
import { layerMoveClosure, previewLayerRemoval } from '../commands/layers.js'
import { validateSceneDocument } from '../validation/scene.js'
import { cloneJson } from '../validation/json.js'
import { buildDecorationRegeneration, decorationProtectedGeometry, estimateSurfaceRegionInstances } from './generate.js'
import { decorationAsProp, conservativePropPaintEnvelope } from './geometry.js'
import { inspectDecorationChanges, type DecorationCommand } from './commands.js'
import { polygonDistance } from '../geometry/geometry.js'
import { sampleConnectionRoute } from '../geometry/connection-route.js'

const p = (x: number, y: number) => ({ x, y })
const context = () => { let id = 0; return { ids: { nextId: () => `decor-generated-${++id}` }, clock: { now: () => '2026-10-31T00:00:00.000Z' } } }
function fixture(): SceneDocument {
  const bounds = { x: 0, y: 0, width: 48000, height: 36000 }, origin = { kind: 'original' as const, attribution: 'geometry-only fixture; no real pixel proof', canEmbed: true }
  const scene: SceneDocument = { format: 'sceneweave-scene', schemaVersion: 6, sceneId: 'decor-fixture', revision: 0, title: 'Decor fixture', createdAt: '2026-10-31T00:00:00.000Z', updatedAt: '2026-10-31T00:00:00.000Z',
    units: { world:'mm',display:'m',gridSizeMm:1000,snapMm:100,gridVisible:false }, exportBoundsMm: bounds, floors: { floor: { id:'floor',name:'Ground',boundsMm:bounds } },
    vertices:{},rooms:{},walls:{},openings:{},props:{},regions:{},notes:{},assets:{},propDefinitions:{},materials:{},terrainAreas:{},terrainEdges:{},terrainConnections:{},paths:{},prefabDefinitions:{},prefabInstances:{},scatterGroups:{},styleThemes:{},activeStyleThemeRef:null,
    userLayers: { layer:{id:'layer',floorId:'floor',name:'Ground',order:0,editLocked:false}, extra:{id:'extra',floorId:'floor',name:'Other',order:1,editLocked:false} },entityLayers:{},
    presetSnapshot:{presetId:'test',presetVersion:1,distanceMode:'metric',source:'geometry only',gridSizeMm:1000},constraints:{entranceOpeningIds:[],wallEndClearanceMm:100,pathChecks:[]},
    mapMode:'scene',regional:null,generation:createEmptyGeneration5(),visual:{version:3,base:{version:2,base:emptyVisualSystem(),materializedEdges:{}},transitions:{}},decorations:{},decorationClusters:{} }
  for (const art of TERRAIN_VARIANT_ART) {
    const id = `def-${art.key}`, assetId = `asset-${art.key}`
    scene.assets[assetId] = { id:assetId,sha256:'0'.repeat(64),mimeType:'image/png',pixelWidth:1,pixelHeight:1,logicalSizeMm:{width:art.widthMm,height:art.heightMm},licenseRef:'fixture-license',origin }
    scene.propDefinitions[id] = { id,catalogId:id,version:1,name:art.name,tags:art.tags!,licenseRef:'fixture-license',origin,defaultAppearance:{kind:'image',assetId,tint:null,opacity:1},
      defaultVisualBoundsMm:{x:-Math.round(art.widthMm/2),y:-Math.round(art.heightMm/2),width:art.widthMm,height:art.heightMm},defaultFootprintMm:art.footprintMm!,defaultFootprintOffsetMm:p(0,0),defaultBlocksMovement:art.blocksMovement!,defaultBlocksSight:art.blocksSight!,defaultRenderLayer:art.renderLayer!,defaultShadowClass:art.shadowClass! } satisfies PropDefinition
  }
  return scene
}
function cluster(scene: SceneDocument): DecorationCluster {
  return { id:'cluster',floorId:'floor',editLocked:false,visibility:'public',supportRef:{kind:'floor',id:'floor'},boundsMm:{x:3000,y:3000,width:42000,height:30000},seed:'decor-clusters-fixed',algorithmVersion:'cluster-v1',
    palette:Object.values(scene.propDefinitions).map(def=>({key:def.id,definitionRef:{id:def.id,version:1},kind:def.defaultBlocksMovement||def.defaultBlocksSight?'prop' as const:'decoration' as const,weight:1})),maxInstances:16,spacingMm:350,clusterRadiusMm:6000,clearanceMm:600,members:{} }
}
function create(scene: SceneDocument): DecorationCommand { const { members: _members, editLocked: _locked, algorithmVersion: _algorithm, ...fields } = cluster(scene); return { type:'createDecorationCluster',...fields,layerId:'layer' } }
function generated() { const before=fixture(), next=applyCommands(before,[create(before)],context()); return {before,next} }

describe('strict6 actual clustered dressing and manual lifecycle', () => {
  it('generates deterministic mixed actual instances with fixed source duties and varied compact scales', () => {
    const scene=fixture(), source=cluster(scene), a=buildDecorationRegeneration(scene,source,context()), b=buildDecorationRegeneration(scene,source,context())
    expect(a).toEqual(b); expect(scene.props).toEqual({});expect(scene.decorations).toEqual({})
    expect(a.props.length).toBeGreaterThan(0);expect(a.decorations.length).toBeGreaterThan(0)
    expect(a.props.length+a.decorations.length).toBe(16)
    expect(new Set(a.decorations.map(row=>row.scalePpm)).size).toBeGreaterThan(1)
    expect([...a.props,...a.decorations].every(row=>Number.isSafeInteger(row.positionMm.x)&&Number.isSafeInteger(row.positionMm.y)&&row.rotationDeg===0)).toBe(true)
    expect(a.props.some(row=>row.blocksMovement)).toBe(true)
    expect(a.decorations.every(row=>!decorationAsProp(scene,row).blocksMovement&&!decorationAsProp(scene,row).blocksSight)).toBe(true)
  })
  it('uses actual full curved stairs, paths and activity geometry to preserve paint clearance', () => {
    const scene=fixture(), group=cluster(scene)
    scene.paths.road={id:'road',floorId:'floor',editLocked:false,visibility:'public',centerlineMm:[p(24000,2000),p(24000,34000)],widthMm:1800,supportRefs:[{kind:'floor',id:'floor'}],surfaceStyle:null,movementCostMultiplier:1,renderOrder:0};scene.entityLayers.road='layer'
    scene.terrainAreas.high={id:'high',floorId:'floor',editLocked:false,visibility:'public',boundaryMm:[p(35000,8000),p(46000,8000),p(46000,30000),p(35000,30000)].map((positionMm,i)=>({id:`high-p${i}`,segmentId:`high-s${i}`,positionMm})),groundElevationMm:1200,coveragePriority:1,surfaceStyle:null,blocksMovement:false,blocksSight:false,movementCostMultiplier:1};scene.entityLayers.high='layer'
    const points=[p(28000,12000),p(32000,12000),p(32000,20000),p(41000,20000)],segments=points.slice(1).map((end,i)=>({id:`route-${i}`,start:points[i],control1:points[i],control2:end,end})),route={version:1 as const,kind:'polyline' as const,segments,sampleSpacingMm:1000,toleranceMm:20,stairStyle:'stone' as const,treadDepthMm:300}
    scene.terrainConnections.stair={id:'stair',floorId:'floor',editLocked:false,visibility:'public',kind:'stairs',from:{surfaceRef:{kind:'floor',id:'floor'},positionMm:points[0]},to:{surfaceRef:{kind:'terrainArea',id:'high'},positionMm:points.at(-1)!},widthMm:1800,openingId:null,blocksMovement:false,movementCostMultiplier:1,surfaceStyle:null,route:{...route,centerlineMm:sampleConnectionRoute(route)}};scene.entityLayers.stair='layer'
    if(scene.generation?.version!==5)throw new Error('generation5')
    scene.generation.legacy.constraints.activity={id:'activity',floorId:'floor',visibility:'public',strength:'hard',kind:'activityArea',boundaryMm:[p(4000,10000),p(14000,10000),p(14000,20000),p(4000,20000)],clearanceMm:400}
    const result=buildDecorationRegeneration(scene,group,context()), protectedGeometry=decorationProtectedGeometry(scene,group)
    expect(new Set(protectedGeometry.map(row=>row.id))).toEqual(new Set(['road','stair','activity']))
    expect(result.props.length+result.decorations.length).toBeGreaterThan(0)
    for(const row of [...result.props,...result.decorations]) {
      const prop='scalePpm' in row?decorationAsProp(scene,row):row, paint=conservativePropPaintEnvelope(prop)
      expect(protectedGeometry.every(record=>polygonDistance(paint,record.polygon)>=record.marginMm)).toBe(true)
    }
  })
  it('preserves moved/deleted/locked compact results and full Prop manual edits on regeneration', () => {
    const {before,next}=generated(), compact=Object.values(next.decorations!), prop=Object.values(next.props)[0]
    const moved=compact[0], deleted=compact[1]
    let edited=applyCommands(next,[{type:'updateDecoration',id:moved.id,changes:{positionMm:{x:moved.positionMm.x+100,y:moved.positionMm.y}}},{type:'deleteDecoration',id:deleted.id},{type:'updateProp',id:prop.id,changes:{positionMm:{x:prop.positionMm.x+100,y:prop.positionMm.y}}}],context())
    const locked=Object.values(edited.decorations!).find(row=>row.id!==moved.id)!
    edited=applyCommands(edited,[{type:'setEditLock',kind:'decoration',id:locked.id,locked:true}],context())
    const frozen=cloneJson(edited), rerun=applyCommands(edited,[{type:'regenerateDecorationCluster',id:'cluster'}],context())
    expect(rerun.decorations![moved.id]).toEqual(frozen.decorations![moved.id]);expect(rerun.props[prop.id]).toEqual(frozen.props[prop.id]);expect(rerun.decorations![locked.id]).toEqual(frozen.decorations![locked.id]);expect(rerun.decorations![deleted.id]).toBeUndefined()
    expect(Object.values(rerun.decorationClusters!.cluster.members).some(row=>row.state==='deleted'&&row.entityId===null)).toBe(true)
    expect(next).not.toEqual(edited);expect(before.decorations).toEqual({})
    const unlocked=applyCommands(edited,[{type:'setEditLock',kind:'decoration',id:locked.id,locked:false}],context())
    expect(unlocked.decorations![locked.id].editLocked).toBe(false)
  })
  it('refuses source downgrades, support/group/layer locks and old formats without changing the baseline', () => {
    const {next}=generated(), row=Object.values(next.decorations!)[0], original=cloneJson(next)
    const locked=applyCommands(next,[{type:'setEditLock',kind:'decorationCluster',id:'cluster',locked:true}],context())
    expect(isEntityEditLocked(locked,row.id)).toBe(true)
    expect(()=>applyCommands(locked,[{type:'updateDecoration',id:row.id,changes:{scalePpm:900000}}],context())).toThrow(/锁/)
    expect(()=>applyCommands(locked,[{type:'updateProp',id:Object.keys(locked.props)[0],changes:{positionMm:p(8000,8000)}}],context())).toThrow(/锁/)
    const downgrade=cloneJson(next);downgrade.decorations![row.id].definitionRef=Object.values(next.props)[0].definitionRef!
    expect(validateSceneDocument(downgrade).ok).toBe(false)
    const old=fixture();old.schemaVersion=5;delete old.decorations;delete old.decorationClusters
    expect(()=>applyCommands(old,[create(fixture())],context())).toThrow(/v6/)
    const bad=fixture();bad.userLayers.layer.editLocked=true
    expect(()=>applyCommands(bad,[create(fixture())],context())).toThrow(/锁/)
    expect(next).toEqual(original)
  })
  it('invalidates a real checked constraint receipt after mixed native6 dressing without changing its frozen recipe', () => {
    const before=fixture()
    if(before.generation?.version!==5)throw new Error('generation5')
    const legacy=before.generation.legacy
    legacy.constraints.activity={id:'activity',floorId:'floor',visibility:'public',strength:'hard',kind:'activityArea',boundaryMm:[p(0,0),p(2000,0),p(2000,2000),p(0,2000)],clearanceMm:200}
    legacy.recipes.frozen={id:'frozen',recipeVersion:1,algorithmId:'terrain-scene',algorithmVersion:5,mapMode:'scene',seed:'fixed-original-recipe',parameters:{terrainKind:'island',seaElevationMm:0,landElevationMm:400,plateauElevationMm:1200,roughness:.5,densityFactor:.3,baySide:'east'},materials:[],props:[{role:'tree',ref:{id:'def-tree-wind-oak',version:1}}],precision:{sampleSpacingMm:500,toleranceMm:100,noiseCellMm:3000}}
    legacy.checks.receipt={id:'receipt',constraintId:'activity',state:'passed',algorithmId:'terrain-activity',algorithmVersion:1,inputHash:constraintInputHash(before,'activity'),issues:[]}
    const constraint=cloneJson(legacy.constraints.activity),recipe=cloneJson(legacy.recipes.frozen),hash=legacy.checks.receipt.inputHash
    expect(validateSceneDocument(before).ok).toBe(true)
    const after=applyCommands(before,[create(before)],context())
    if(after.generation?.version!==5)throw new Error('generation5')
    expect(Object.keys(after.props).length).toBeGreaterThan(0)
    expect(constraintInputHash(after,'activity')).not.toBe(hash)
    expect(after.generation.legacy.checks.receipt.state).toBe('unchecked')
    expect(after.generation.legacy.constraints.activity).toEqual(constraint)
    expect(after.generation.legacy.recipes.frozen).toEqual(recipe)
    expect(legacy.checks.receipt.state).toBe('passed')
  })
  it('charges each actual decoration and member expansion once across the native command observer', () => {
    const before=fixture(), observed:number[]=[]
    const after=applyCommands(before,[create(before)],context(),{onSceneDraft:(_draft,_command,cost)=>observed.push(cost)})
    const expanded=terrainCommandCost(before,after)
    expect(observed).toEqual([expanded.total])
    expect(expanded.total).toBeGreaterThanOrEqual(inspectDecorationChanges(before,after).commandCost)
  })
  it('checks explicit support locks and rejects combined expansion above256 atomically', () => {
    const scene=fixture(), command=create(scene)
    if(command.type!=='createDecorationCluster')throw new Error('create')
    scene.terrainAreas.ground={id:'ground',floorId:'floor',editLocked:true,visibility:'public',boundaryMm:[p(0,0),p(48000,0),p(48000,36000),p(0,36000)].map((positionMm,i)=>({id:`ground-p${i}`,segmentId:`ground-s${i}`,positionMm})),groundElevationMm:0,coveragePriority:1,surfaceStyle:null,blocksMovement:false,blocksSight:false,movementCostMultiplier:1};scene.entityLayers.ground='layer'
    expect(()=>applyCommands(scene,[{...command,supportRef:{kind:'terrainArea',id:'ground'}}],context())).toThrow(/锁/)
    const blank=fixture(), first=create(blank)
    if(first.type!=='createDecorationCluster')throw new Error('create')
    const grass=first.palette.find(row=>row.definitionRef.id.includes('grass-sedge'))!
    const large={...first,palette:[grass],maxInstances:64,spacingMm:1}
    expect(()=>applyCommands(blank,[large,{...large,id:'second-cluster',seed:'second-seed'}],context())).toThrow(/256/)
    expect(blank.decorations).toEqual({});expect(blank.decorationClusters).toEqual({})
  })
  it('preserves exact adopted fields of surviving managed outputs and ignores private layout in public generation', () => {
    const {next}=generated(), prop=Object.values(next.props)[0]
    prop.appearance.opacity=.7;prop.renderOrder=17
    const group=next.decorationClusters!.cluster, result=buildDecorationRegeneration(next,group,context())
    expect(result.props.find(row=>row.id===prop.id)?.appearance).toEqual(prop.appearance)
    expect(result.props.find(row=>row.id===prop.id)?.renderOrder).toBe(17)
    const blank=fixture(), a=buildDecorationRegeneration(blank,cluster(blank),context()), secret=cloneJson(blank)
    secret.regions.hidden={id:'hidden',floorId:'floor',editLocked:false,visibility:'gm',kind:'hazard',boundaryMm:[p(0,0),p(48000,0),p(48000,36000),p(0,36000)],blocksMovement:true,movementCostMultiplier:1};secret.entityLayers.hidden='layer'
    expect(buildDecorationRegeneration(secret,cluster(secret),context())).toEqual(a)
  })
  it('keeps canopy slot centers stable when the coverage target grows', () => {
    const scene = fixture(); scene.schemaVersion = 7
    scene.terrainAreas.high = { id:'high',floorId:'floor',editLocked:false,visibility:'public',boundaryMm:[p(0,0),p(48000,0),p(48000,36000),p(0,36000)].map((positionMm,i)=>({id:`high-p${i}`,segmentId:`high-s${i}`,positionMm})),groundElevationMm:1200,coveragePriority:1,surfaceStyle:null,blocksMovement:false,blocksSight:false,movementCostMultiplier:1 }
    scene.entityLayers.high = 'layer'
    const tree = Object.values(scene.propDefinitions).find(definition => definition.tags.includes('tree'))!
    const rule: DecorationCluster = { id:'canopy',floorId:'floor',editLocked:false,visibility:'public',supportRef:{kind:'terrainArea',id:'high'},boundsMm:{x:4000,y:4000,width:40000,height:28000},seed:'stable-canopy-seed',algorithmVersion:'cluster-v1',
      palette:[{key:'tree',definitionRef:{id:tree.id,version:tree.version},kind:'prop',weight:1}],maxInstances:64,spacingMm:900,clusterRadiusMm:6500,clearanceMm:100,members:{},
      canopyRule:{regionsMm:[[p(4000,4000),p(44000,4000),p(44000,32000),p(4000,32000)]],channel:'trees',paintOrder:1,mode:'plant',canopyCoveragePpm:100000} }
    const first = buildDecorationRegeneration(scene,rule,context())
    scene.decorationClusters!.canopy = first.cluster
    for (const prop of first.props) { scene.props[prop.id] = prop; scene.entityLayers[prop.id] = 'layer' }
    let addedId = 0
    const grown = buildDecorationRegeneration(scene, { ...first.cluster, canopyRule: { ...first.cluster.canopyRule!, canopyCoveragePpm: 250_000 } },
      { ids: { nextId: () => `grown-tree-${++addedId}` }, clock: context().clock })
    const after = new Map(grown.props.map(prop => [prop.id,prop]))
    expect(first.props.length).toBeGreaterThan(0)
    expect(first.props.every(prop => after.has(prop.id))).toBe(true)
    for (const prop of first.props) expect(after.get(prop.id)?.positionMm).toEqual(prop.positionMm)
    expect(grown.props.length).toBeGreaterThanOrEqual(first.props.length)
  })
  it('keeps v8 vegetation roots inside a painted region while validating the full physical footprint on its support', () => {
    const scene = fixture(); scene.schemaVersion = 8; scene.surfaceRules = {}
    scene.terrainAreas.high = { id:'high',floorId:'floor',editLocked:false,visibility:'public',boundaryMm:[p(0,0),p(48000,0),p(48000,36000),p(0,36000)].map((positionMm,i)=>({id:`high-p${i}`,segmentId:`high-s${i}`,positionMm})),groundElevationMm:1200,coveragePriority:1,surfaceStyle:null,blocksMovement:false,blocksSight:false,movementCostMultiplier:1 }
    scene.entityLayers.high = 'layer'
    const tree = Object.values(scene.propDefinitions).find(definition => definition.tags.includes('tree'))!
    const source = { ...cluster(scene), supportRef: { kind:'terrainArea' as const,id:'high' }, boundsMm:{x:10900,y:10900,width:2200,height:2200},
      seed:'v8-root-selected-tree-overhang', palette:[{key:'tree',definitionRef:{id:tree.id,version:tree.version},kind:'prop' as const,weight:1}],
      maxInstances:64,spacingMm:200,clusterRadiusMm:1,clearanceMm:0,members:{} }
    const region = { outer:p(10900,10900), right:p(13100,10900), lowerRight:p(13100,13100), lowerLeft:p(10900,13100) }
    const generated = buildDecorationRegeneration(scene,source,context(),undefined,{polygons:[{outer:[region.outer,region.right,region.lowerRight,region.lowerLeft],holes:[]}],coveragePpm:1_000_000})
    expect(generated.props).toHaveLength(1)
    const selected = generated.props[0], visual = conservativePropPaintEnvelope(selected)
    expect(selected.positionMm.x).toBeGreaterThanOrEqual(10900)
    expect(selected.positionMm.x).toBeLessThanOrEqual(13100)
    expect(selected.positionMm.y).toBeGreaterThanOrEqual(10900)
    expect(selected.positionMm.y).toBeLessThanOrEqual(13100)
    expect(visual.some(point => point.x < 10900 || point.x > 13100 || point.y < 10900 || point.y > 13100)).toBe(true)
  })
  it('fills a v8 surface target outside protected activity space after local cluster attempts fail', () => {
    const scene = fixture(); scene.schemaVersion = 8
    const highPoints = [p(6000, 6000), p(18000, 6000), p(18000, 18000), p(6000, 18000)]
    scene.terrainAreas.high = { id: 'high', floorId: 'floor', editLocked: false, visibility: 'public',
      boundaryMm: highPoints.map((positionMm, index) => ({ id: `high-p${index}`, segmentId: `high-s${index}`, positionMm })),
      groundElevationMm: 1200, coveragePriority: 1, surfaceStyle: null, blocksMovement: false, blocksSight: false, movementCostMultiplier: 1 }
    scene.entityLayers.high = 'layer'
    scene.regions.activity = { id: 'activity', floorId: 'floor', editLocked: false, visibility: 'public', kind: 'hazard',
      boundaryMm: [p(8000, 8000), p(16000, 8000), p(16000, 16000), p(8000, 16000)], blocksMovement: true, movementCostMultiplier: 1 }
    scene.entityLayers.activity = 'layer'
    if (scene.generation?.version !== 5) throw new Error('generation5')
    scene.generation.legacy.constraints.activity = { id: 'activity', floorId: 'floor', visibility: 'public', strength: 'hard', kind: 'activityArea',
      boundaryMm: [p(8000, 8000), p(16000, 8000), p(16000, 16000), p(8000, 16000)], clearanceMm: 0 }
    const grass = Object.values(scene.propDefinitions).find(definition => definition.tags.includes('grass'))!
    const source = { ...cluster(scene), supportRef: { kind: 'terrainArea' as const, id: 'high' }, boundsMm: { x: 6000, y: 6000, width: 12000, height: 12000 },
      seed: 'v8-activity-clearance-region-fallback', palette: [{ key: 'grass', definitionRef: { id: grass.id, version: grass.version }, kind: 'decoration' as const, weight: 1 }],
      maxInstances: 64, spacingMm: 100, clusterRadiusMm: 250, clearanceMm: 100, members: {} }
    const surfaceRegion = { polygons: [{ outer: highPoints, holes: [] }], coveragePpm: 18_000 }

    expect(estimateSurfaceRegionInstances(scene, source.palette, surfaceRegion)).toBe(4)
    const generated = buildDecorationRegeneration(scene, source, context(), undefined, surfaceRegion)
    const replay = buildDecorationRegeneration(scene, source, context(), undefined, surfaceRegion)
    expect(replay).toEqual(generated)
    expect(generated.decorations).toHaveLength(4)
    expect(generated.decorations.every(row => !decorationProtectedGeometry(scene, source).some(record =>
      polygonDistance(conservativePropPaintEnvelope(decorationAsProp(scene, row)), record.polygon) < record.marginMm))).toBe(true)
  })
  it('moves complete owned layer closure, preserves detached members and exposes actual changed scope', () => {
    const {before,next}=generated(), row=Object.values(next.decorations!)[0]
    const closure=layerMoveClosure(next,[row.id]);expect(closure).toContain('cluster');expect(closure.length).toBe(Object.values(next.props).length+Object.keys(next.decorations!).length+1)
    expect(previewLayerRemoval(next,'layer').reason).toMatch(/仍有内容/)
    const detached=applyCommands(next,[{type:'detachDecorationMember',clusterId:'cluster',entityId:row.id}],context()), deleted=applyCommands(detached,[{type:'deleteDecorationCluster',id:'cluster'}],context())
    expect(deleted.decorations![row.id]).toEqual(detached.decorations![row.id]);expect(Object.keys(deleted.decorations!)).toEqual([row.id]);expect(deleted.props).toEqual({});expect(deleted.decorationClusters).toEqual({})
    const detachedLocked=applyCommands(detached,[{type:'setEditLock',kind:'decorationCluster',id:'cluster',locked:true}],context()), independentlyDeleted=applyCommands(detachedLocked,[{type:'deleteDecoration',id:row.id}],context())
    expect(independentlyDeleted.decorations![row.id]).toBeUndefined();expect(Object.values(independentlyDeleted.decorationClusters!.cluster.members).some(member=>member.state==='detached'&&member.entityId===null)).toBe(true)
    const impact=inspectDecorationChanges(before,next);expect(impact.changedIds).toContain('cluster');expect(impact.affectedIds).toContain('floor');expect(impact.commandCost).toBe(33)
    const moved=applyCommands(next,[{type:'moveEntitiesToLayer',ids:[row.id],layerId:'extra'}],context())
    expect(closure.every(id=>moved.entityLayers[id]==='extra')).toBe(true)
  })
})
