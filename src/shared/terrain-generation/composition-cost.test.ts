import { describe, expect, it } from 'vitest'
import { layerSceneV3 } from '../../core/v3/test-fixtures.js'
import type { CompositionContent } from '../model/appearance.js'
import type { SceneDocument } from '../model/scene.js'
import { cloneJson } from '../validation/json.js'
import { emptyVisualSystem } from '../visual/types.js'
import { createEmptyGeneration5, type GenerationSystem5, type TerrainDependency } from './composition-contracts.js'
import { assertTerrainBudget, compositionRecordExpansion, terrainCommandCost, type TerrainCostMetadata } from './cost.js'

type Scene4=SceneDocument&{schemaVersion:4;generation:GenerationSystem5}
const p=(x:number,y:number)=>({x,y})
function scene():Scene4 {
  return {...cloneJson(layerSceneV3()),format:'sceneweave-scene',schemaVersion:4,mapMode:'scene',regional:null,
    generation:createEmptyGeneration5(),visual:{version:3,base:{version:2,base:emptyVisualSystem(),materializedEdges:{}},transitions:{}}}
}
function content():Pick<CompositionContent,'historyIdentity'|'appearance'> {
  return {historyIdentity:{version:3,lineageId:'cost-lineage',rootSceneId:'layer-copy',propTokens:{item:'item-token'},prefabTokens:{},outdoorTokens:{},generationTokens:{},regionalTokens:{},presentationTokens:{},terrainTokens:{}},
    appearance:{version:2,sources:{},propSources:{},surfaceSources:{},instanceAdjustments:{},layerAdjustments:{},variants:{},prefabAppearanceTemplates:{},presentations:{}}}
}
function metadata():TerrainCostMetadata { const before=content();return {before,after:cloneJson(before)} }
const target={kind:'terrainArea' as const,entityId:'old-land',parentId:null,fieldGroup:'geometry' as const}
const token=(kind:'terrainDependency'|'terrainFeature',suffix:string)=>({kind,token:`birth-${suffix}`,topologyToken:`topology-${suffix}`,topologyHash:'a'.repeat(64)})

describe('complete-v4 expanded terrain transaction cost',()=>{
  it('charges every copy of a native terrain ring including its closing segment',()=>{
    const snapshot={boundaryMm:[p(0,0),p(4000,0),p(4000,4000),p(0,4000)].map((positionMm,i)=>({id:`p${i}`,segmentId:`s${i}`,positionMm})),groundElevationMm:500}
    expect(compositionRecordExpansion(snapshot)).toBe(8)
    const read={target,role:'baseline',contentHash:'a'.repeat(64),snapshot}
    // Each Ref and each frozen snapshot costs one, in addition to all 4 points + 4 segments.
    expect(compositionRecordExpansion({reads:[read]})).toBe(10)
    expect(compositionRecordExpansion({reads:[read,read]})).toBe(20)
  })
  it('charges complete open paths and corridor shapes rather than only their snapshot envelope',()=>{
    const points=[p(0,0),p(4000,0),p(4000,4000),p(8000,4000)]
    expect(compositionRecordExpansion({snapshot:{centerlineMm:points,widthMm:1000}})).toBe(8)
    expect(compositionRecordExpansion({kind:'corridor',pointsMm:points,widthMm:1000})).toBe(7)
    expect(compositionRecordExpansion({pointsMm:points})).toBe(7)
    expect(compositionRecordExpansion({boundaryMm:points})).toBe(8)
  })
  it('charges cubic segment records and each repeated persisted control point',()=>{
    const segment={id:'curve',start:p(0,0),control1:p(1000,0),control2:p(2000,3000),end:p(4000,4000)}
    expect(compositionRecordExpansion({snapshot:{closed:true,segments:[segment]}})).toBe(6)
    expect(compositionRecordExpansion({snapshot:{closed:true,segments:[segment,segment]}})).toBe(11)
    expect(compositionRecordExpansion({polygons:[{id:'band',pointsMm:[p(0,0),p(4000,0),p(4000,4000)]}]})).toBe(7)
  })
  it('charges complete ellipse sources independently in every frozen threshold',()=>{
    const feature={id:'feature',shape:{kind:'ellipse',centerMm:p(5000,5000),radiusXMm:2000,radiusYMm:1000,rotationMilliDeg:0}}
    const threshold={grid:{originMm:p(0,0),columns:4,rows:4,spacingMm:1000},sourceInput:{features:{feature},members:[{featureId:'feature',field:'land',operation:'add',weightPpm:1000000}]}}
    expect(compositionRecordExpansion(feature)).toBe(10)
    // sourceInput + feature record + 10 geometric units + member + grid + grid origin.
    expect(compositionRecordExpansion(threshold)).toBe(15)
    expect(compositionRecordExpansion([threshold,threshold])).toBe(32)
  })
  it('uses actual seven-pool identity deltas including tombstones and changed-back topology tokens',()=>{
    const before=scene(),after=cloneJson(before),state=metadata()
    state.after.historyIdentity.propTokens.tombstone='removed-prop-birth'
    state.after.historyIdentity.prefabTokens.tombstonePrefab='removed-prefab-birth'
    state.after.historyIdentity.outdoorTokens!['old-outdoor']={kind:'path',token:'path-birth',topologyToken:'path-new-topology',topologyHash:'b'.repeat(64)}
    state.after.historyIdentity.generationTokens!['old-rule']={kind:'generationRule',token:'rule-birth',topologyToken:'rule-topology',topologyHash:'b'.repeat(64)}
    state.after.historyIdentity.regionalTokens!['old-regional']={kind:'regionalArea',token:'regional-birth',topologyToken:'regional-topology',topologyHash:'b'.repeat(64)}
    state.after.historyIdentity.presentationTokens!['old-presentation']={kind:'materializedEdge',token:'presentation-birth',topologyToken:'presentation-topology',topologyHash:'b'.repeat(64)}
    state.after.historyIdentity.terrainTokens!['old-feature']=token('terrainFeature','feature')
    const cost=terrainCommandCost(before,after,state)
    expect(cost.total).toBe(7)
    expect(Object.keys(cost.items).some(key=>key.includes('.estimate.'))).toBe(false)
    expect(cost.items['composition.identity.actual.prefabTokens']).toBe(1)
    const traced=metadata();traced.before.historyIdentity.terrainTokens!['feature']=token('terrainFeature','kept')
    traced.after=cloneJson(traced.before);traced.after.historyIdentity.terrainTokens!.feature.topologyToken='changed-back-token'
    expect(terrainCommandCost(before,after,traced).total).toBe(1)
  })
  it('counts fixed appearance records, target mappings and duplicated source geometry',()=>{
    const before=scene(),after=cloneJson(before),state=metadata(),points=[p(0,0),p(4000,0),p(4000,4000),p(0,4000)]
    const paint={materialRef:{id:'material',version:1},tileSizeMm:{width:1000,height:1000},rotationDeg:0,alignment:'world' as const,originMm:p(0,0),tint:null,opacity:1}
    state.after.appearance.sources.source={id:'source',kind:'surface',parentSourceId:null,snapshot:{base:paint,overlays:[{id:'overlay',boundaryMm:points,paint,blendWidthMm:0,renderOrder:1}]}}
    state.after.appearance.surfaceSources.land='source'
    const cost=terrainCommandCost(before,after,state)
    expect(cost.items['composition.appearance.sources']).toBe(13)
    expect(cost.items['composition.appearance.surfaceSources']).toBe(1)
    expect(cost.total).toBe(14)
    state.after.appearance.sources.copy={...cloneJson(state.after.appearance.sources.source),id:'copy'}
    expect(terrainCommandCost(before,after,state).items['composition.appearance.sources']).toBe(26)
  })
  it('charges fixed source definitions and resource metadata when their content changes',()=>{
    const before=scene(),after=cloneJson(before),state=metadata()
    after.materials.material={id:'material',catalogId:'terrain.material',version:1,licenseRef:'license',origin:{kind:'original',attribution:'test',canEmbed:true},name:'Material',tags:[],textureAssetId:'texture',defaultTileSizeMm:{width:1000,height:1000},applicableSurfaces:['terrain']}
    after.assets.texture={id:'texture',sha256:'a'.repeat(64),mimeType:'image/png',pixelWidth:1,pixelHeight:1,logicalSizeMm:{width:1000,height:1000},licenseRef:'license',origin:{kind:'original',attribution:'test',canEmbed:true}}
    const cost=terrainCommandCost(before,after,state)
    expect(cost.items['composition.resources.materials']).toBeGreaterThan(0)
    expect(cost.items['composition.resources.assets']).toBeGreaterThan(0)
  })
  it('requires complete metadata for the v4 adoption gate and charges every version conversion',()=>{
    const after=scene(),before=cloneJson(after) as SceneDocument
    before.schemaVersion=3;before.generation=createEmptyGeneration5().legacy;before.visual={version:2,base:emptyVisualSystem(),materializedEdges:{}}
    const state=metadata();state.before.historyIdentity.version=2;delete state.before.historyIdentity.terrainTokens;state.before.appearance.version=1;delete state.before.appearance.presentations
    expect(()=>assertTerrainBudget(before,after)).toThrow(/真实历史身份与外观来源/)
    const cost=assertTerrainBudget(before,after,state)
    expect(cost.items.physicalAndVisual).toBe(1)
    expect(cost.items['composition.projectVersion']).toBe(1)
    expect(cost.items['composition.version']).toBe(1)
    expect(cost.items['composition.visualVersion']).toBe(1)
    expect(cost.items['composition.identity.version']).toBe(1)
    expect(cost.items['composition.appearance.version']).toBe(1)
    expect(cost.total).toBe(6)
  })
  it('accepts exactly 256 actual expanded records and refuses the next retained birth without dropping snapshot geometry',()=>{
    const before=scene(),after=cloneJson(before),state=metadata()
    const snapshot={boundaryMm:Array.from({length:125},(_,i)=>({id:`saved-p${i}`,segmentId:`saved-s${i}`,positionMm:p(Math.round(6000+2000*Math.cos(i*2*Math.PI/125)),Math.round(6000+2000*Math.sin(i*2*Math.PI/125)))})),groundElevationMm:500}
    const dependency:TerrainDependency={id:'dependency',compositionId:'composition',featureIds:[],thresholdIds:[],reads:[{target,role:'preserve',contentHash:'a'.repeat(64),snapshot}],writes:[],transitionIds:[],scopeMm:{x:0,y:0,width:10000,height:10000},haloMm:1000,algorithmId:'terrain-dependencies',algorithmVersion:1,inputHash:'b'.repeat(64)}
    after.generation.dependencies.dependency=dependency;state.after.historyIdentity.terrainTokens!.dependency=token('terrainDependency','dependency')
    expect(assertTerrainBudget(before,after,state).total).toBe(256)
    state.after.historyIdentity.propTokens.retainedDeletion='new-tombstone'
    expect(terrainCommandCost(before,after,state).total).toBe(257)
    expect(()=>assertTerrainBudget(before,after,state)).toThrow(/257.*256/)
    expect(before.generation.dependencies).toEqual({})
  })
})
