import { describe, expect, it } from 'vitest'
import { createRefinedBlankDocument } from '../../platform/browser/content/refined-blank.js'
import { createCompositionContent } from '../appearance/graph.js'
import { applyCompositionCommands } from '../appearance/commands.js'
import { applyCommands } from '../commands/commands.js'
import { outdoorCommandSchema } from '../commands/outdoor.js'
import type { PropDefinition, ScatterGroup, SceneDocument } from '../model/scene.js'
import { emptyCompositionDocument } from '../terrain-generation/composition-materialize.js'
import { terrainCommandCost } from '../terrain-generation/cost.js'
import { canonicalJson } from '../validation/json.js'
import { validateSceneDocument } from '../validation/scene.js'
import { applySceneryCandidate, prepareSceneryRegeneration } from '../visual/scenery.js'
import { polygonDistance, polygonInside, propFootprint, terrainPoints, validateGeometry } from './geometry.js'
import * as scatter from './scatter.js'
import type { ScatterAlgorithmVersion } from './scatter-algorithm.js'
import { buildScatterRegenerationV2 } from '../../core/v2/scatter.js'

let sequence=0
const runtime={ids:{nextId:()=>`scatter-test-${++sequence}`},clock:{now:()=> '2026-10-29T00:00:00.000Z'}}
function fixture():SceneDocument {
 const scene=createRefinedBlankDocument('island',{title:'scatter version fixture',sceneId:'scatter-versions',now:runtime.clock.now(),widthMm:24000,heightMm:18000,preset:'narrative'})
 const definition:PropDefinition={id:'tree',catalogId:'scatter-test-tree',version:1,name:'tree',licenseRef:'MIT',origin:{kind:'original',attribution:'Sceneweave test',canEmbed:true},tags:[],defaultAppearance:{kind:'symbol',symbol:'crate',opacity:1,tint:null},defaultVisualBoundsMm:{x:-100,y:-100,width:200,height:200},defaultFootprintMm:{width:100,height:100},defaultFootprintOffsetMm:{x:0,y:0},defaultBlocksMovement:false,defaultBlocksSight:false,defaultRenderLayer:'canopy',defaultShadowClass:'none'}
 scene.assets={};scene.materials={};scene.propDefinitions={tree:definition,shrub:{...structuredClone(definition),id:'shrub',catalogId:'scatter-test-shrub'}};scene.styleThemes={};scene.activeStyleThemeRef=null
 const ring=[{x:1000,y:1000},{x:23000,y:1000},{x:23000,y:17000},{x:1000,y:17000}]
 scene.terrainAreas.meadow={id:'meadow',floorId:'visual-floor',editLocked:false,visibility:'public',boundaryMm:ring.map((positionMm,i)=>({id:`meadow-p${i}`,segmentId:`meadow-s${i}`,positionMm})),groundElevationMm:800,coveragePriority:1,surfaceStyle:null,blocksMovement:false,blocksSight:false,movementCostMultiplier:1};scene.entityLayers.meadow='visual-layer-ground'
 return scene
}
const create=(algorithmVersion?:ScatterAlgorithmVersion)=>({type:'createScatter' as const,id:'trees',floorId:'visual-floor',layerId:'visual-layer-props',domain:{kind:'area' as const,areaId:'meadow'},palette:[{key:'z-tree',propDefinitionRef:{id:'tree',version:1},weight:3},{key:'a-shrub',propDefinitionRef:{id:'shrub',version:1},weight:1}],seed:'礁岸-织境',gridOriginMm:{x:123,y:-456},cellSizeMm:2200,densityFactor:.7,minDistanceMm:100,rotationRangeDeg:{min:10,max:350},...(algorithmVersion?{algorithmVersion}:{})})
function populated(version:ScatterAlgorithmVersion='scatter-cell-v2') {
 return applyCommands(fixture(),[create(version),{type:'regenerateScatter',id:'trees'}],runtime)
}
function vectorGroup():ScatterGroup {
 return {...create(),algorithmVersion:'scatter-cell-v1',editLocked:false,visibility:'public',cellSizeMm:1600,members:{},exclusions:[]} as ScatterGroup
}
const sampleV2=scatter.sampleScatterCellV2

describe('explicit scatter-cell-v2 contract',()=>{
 it('retains exact old UTF-8 signed-grid streams and complete v1 geometry',()=>{
  const group=vectorGroup()
  expect(scatter.sampleScatterCellV1(group,-2,3)).toEqual({candidateKey:'3166fdff089b32a745565df6c8265347407b34cfbb8579052c3671e92dbdcb96',density:.3329892946460864,positionMm:{x:-2711,y:5691},rotationDeg:207.281,paletteKey:'a-shrub',definitionRef:{id:'shrub',version:1}})
  group.seed='sceneweave'
  expect(scatter.sampleScatterCellV1(group,0,0)).toEqual({candidateKey:'90350e626162e91578ab5f3d421f58232ac7e8261f5e94aeac7777c6cc53b07f',density:.3719807300694229,positionMm:{x:819,y:-402},rotationDeg:172.826,paletteKey:'z-tree',definitionRef:{id:'tree',version:1}})
  const scene=applyCommands(fixture(),[create() as never],runtime)
  expect(canonicalJson(scatter.buildScatterRegeneration(scene,'trees'))).toBe(canonicalJson(buildScatterRegenerationV2(scene as never,'trees')))
  expect(applyCommands(scene,[{type:'regenerateScatter',id:'trees'}],runtime).scatterGroups.trees.algorithmVersion).toBe('scatter-cell-v1')
 })
 it('requires a new-group selector, defaults to v1, and refuses version replacement or unknown creation',()=>{
  const omitted=applyCommands(fixture(),[create() as never],runtime),explicit=applyCommands(fixture(),[create('scatter-cell-v1') as never],runtime),next=applyCommands(fixture(),[create('scatter-cell-v2') as never],runtime)
  expect(omitted).toEqual(explicit);expect(next.scatterGroups.trees.algorithmVersion).toBe('scatter-cell-v2')
  expect(outdoorCommandSchema.safeParse({...create(),algorithmVersion:'future-version'}).success).toBe(false)
  expect(outdoorCommandSchema.safeParse({type:'configureScatter',id:'trees',changes:{algorithmVersion:'scatter-cell-v2'}}).success).toBe(false)
  expect(outdoorCommandSchema.safeParse({...create('scatter-cell-v2'),clusterScale:4}).success).toBe(false)
  expect(validateSceneDocument(next).ok).toBe(true)
  expect(validateGeometry(next).warnings.some(issue=>issue.code==='UNSUPPORTED_SCATTER_ALGORITHM')).toBe(false)
 })
 it('freezes v2 signed-grid density vectors independently of cell position, palette and rotation',()=>{
  const group={...vectorGroup(),algorithmVersion:'scatter-cell-v2'}
  expect(sampleV2(group,-2,3).densityThreshold).toBe(.4410904399409873)
  expect(sampleV2(group,0,0).densityThreshold).toBe(.5577553294523878)
  expect(sampleV2(group,4,-4).densityThreshold).toBe(.5841141713319989)
  const changed={...group,gridOriginMm:{x:-1000,y:2000},cellSizeMm:900,palette:group.palette.slice().reverse(),rotationRangeDeg:{min:0,max:0}}
  expect(sampleV2(changed,-2,3).densityThreshold).toBe(sampleV2(group,-2,3).densityThreshold)
 })
 it.each(['clusters-0','clusters-1','clusters-2'])('uses smooth coarse density while leaving every independent stream intact: %s',seed=>{
  const group={...vectorGroup(),algorithmVersion:'scatter-cell-v2',seed,densityFactor:.6},before=canonicalJson(group),thresholds:number[]=[]
  let near=0,far=0,pairs=0
  for(let row=-16;row<16;row++)for(let column=-16;column<16;column++){
   const a=sampleV2(group,column,row),{densityThreshold,...cell}=a
   expect(cell).toEqual(scatter.sampleScatterCellV1(group,column,row));expect(sampleV2(group,column,row)).toEqual(a)
   expect(densityThreshold).toBeGreaterThanOrEqual(group.densityFactor*.2);expect(densityThreshold).toBeLessThanOrEqual(group.densityFactor)
   thresholds.push(densityThreshold)
   near+=Math.abs(densityThreshold-sampleV2(group,column+1,row).densityThreshold)
   far+=Math.abs(densityThreshold-sampleV2(group,column+8,row).densityThreshold);pairs++
  }
  expect(Math.max(...thresholds)-Math.min(...thresholds)).toBeGreaterThan(.3)
  expect(near/pairs).toBeLessThan(far/pairs*.65)
  expect(canonicalJson(group)).toBe(before)
  expect(sampleV2({...group,densityFactor:0},0,0).densityThreshold).toBe(0)
  expect(()=>sampleV2(group,.5,0)).toThrow(/整数/)
 })
 it('shares concrete support, exclusion, spacing, immutability and unknown-version rejection',()=>{
  const scene=applyCommands(fixture(),[create('scatter-cell-v2') as never],runtime),group=scene.scatterGroups.trees
  group.exclusions=[{id:'entrance',boundaryMm:[{x:6000,y:6000},{x:18000,y:6000},{x:18000,y:9000},{x:6000,y:9000}],reason:'entrance',sourceCandidateKey:null}]
  const before=canonicalJson(scene),proposal=scatter.buildScatterRegeneration(scene,'trees')
  expect(proposal.props.length).toBeGreaterThan(5);expect(canonicalJson(scene)).toBe(before)
  for(const [index,prop] of proposal.props.entries()){
   expect(polygonInside(propFootprint(prop),terrainPoints(scene.terrainAreas.meadow))).toBe(true)
   expect(polygonDistance(propFootprint(prop),group.exclusions[0].boundaryMm)).toBeGreaterThan(0)
   for(const previous of proposal.props.slice(0,index))expect(polygonDistance(propFootprint(prop),propFootprint(previous))).toBeGreaterThanOrEqual(group.minDistanceMm-1e-7)
  }
  const oversized=structuredClone(scene)
  for(const definition of Object.values(oversized.propDefinitions))definition.defaultVisualBoundsMm={x:-15000,y:-10000,width:30000,height:20000}
  expect(scatter.buildScatterRegeneration(oversized,'trees').props).toEqual([])
  group.algorithmVersion='future-scatter-v9';expect(validateSceneDocument(scene).ok).toBe(true)
  expect(()=>scatter.buildScatterRegeneration(scene,'trees')).toThrow(/不可重新生成/)
 })
 it('preserves manual appearance, delete suppression, detached props and entity/layer locks',()=>{
  let scene=populated(),members=Object.entries(scene.scatterGroups.trees.members).filter(([,member])=>member.propId!==null)
  expect(members.length).toBeGreaterThanOrEqual(6)
  const [[manualKey,manual],[deletedKey,deleted],[detachedKey,detached],[lockedKey,locked],[layerKey,layerLocked]]=members
  scene=applyCommands(scene,[{type:'updateProp',id:manual.propId!,changes:{rotationDeg:22.123}},{type:'deleteProp',id:deleted.propId!},{type:'detachScatterMember',groupId:'trees',propId:detached.propId!}],runtime)
  scene=applyCommands(scene,[{type:'setEditLock',kind:'prop',id:locked.propId!,locked:true}],runtime)
  scene.userLayers['retained-layer']={id:'retained-layer',floorId:'visual-floor',name:'Locked retained',order:Math.max(...Object.values(scene.userLayers).map(layer=>layer.order))+1,editLocked:true}
  scene.entityLayers[layerLocked.propId!]='retained-layer'
  scene.scatterGroups.trees.densityFactor=1
  const before=structuredClone(scene),candidate=prepareSceneryRegeneration(scene,'trees'),next=applySceneryCandidate(scene,candidate)
  for(const id of [manual.propId!,detached.propId!,locked.propId!,layerLocked.propId!])expect(next.props[id]).toEqual(before.props[id])
  for(const key of [manualKey,deletedKey,detachedKey,lockedKey,layerKey])expect(next.scatterGroups.trees.members[key]).toEqual(before.scatterGroups.trees.members[key])
  expect(next.props[deleted.propId!]).toBeUndefined();expect(next.scatterGroups.trees.exclusions).toEqual(before.scatterGroups.trees.exclusions)
  expect(()=>applySceneryCandidate({...scene,revision:scene.revision+1},candidate)).toThrow(/基线/)
  const groupLocked=structuredClone(scene);groupLocked.scatterGroups.trees.editLocked=true
  expect(()=>prepareSceneryRegeneration(groupLocked,'trees')).toThrow(/锁/)
  const layerLock=structuredClone(scene);layerLock.userLayers['visual-layer-props'].editLocked=true
  expect(()=>prepareSceneryRegeneration(layerLock,'trees')).toThrow(/锁/)
 })
 it('keeps surviving managed adopted sources and allocates fresh IDs after density-zero removal',()=>{
  const scene=populated(),managed=Object.values(scene.scatterGroups.trees.members).find(member=>member.propId)!,id=managed.propId!
  scene.props[id].visualBoundsMm={x:-120,y:-130,width:240,height:260}
  const candidate=prepareSceneryRegeneration(scene,'trees'),next=applySceneryCandidate(scene,candidate)
  expect(next.props[id]).toEqual(scene.props[id])
  const zero=applyCommands(next,[{type:'regenerateScatter',id:'trees',densityFactor:0}],runtime)
  const rebound=applyCommands(zero,[{type:'regenerateScatter',id:'trees',densityFactor:.7}],runtime)
  expect(rebound.props[id]).toBeUndefined()
  expect(Object.keys(rebound.props).length).toBeGreaterThan(5)
 })
 it('uses the unchanged full metadata 256 gate for v2 and retains oversized source atomically',()=>{
  const base=emptyCompositionDocument(fixture()),content=createCompositionContent(base,runtime)
  const small=applyCompositionCommands(content,[create('scatter-cell-v2') as never,{type:'regenerateScatter',id:'trees'}],runtime)
  const cost=terrainCommandCost(content.document,small.document,{before:content,after:small})
  expect(cost.total).toBeLessThanOrEqual(256);expect(cost.items['composition.identity.actual.propTokens']).toBeGreaterThan(0);expect(cost.items['composition.appearance.propSources']).toBeGreaterThan(0)
  const before=canonicalJson(content)
  expect(()=>applyCompositionCommands(content,[{...create('scatter-cell-v2'),cellSizeMm:600,densityFactor:1} as never,{type:'regenerateScatter',id:'trees'}],runtime)).toThrow(/256/)
  expect(canonicalJson(content)).toBe(before)
 })
})
