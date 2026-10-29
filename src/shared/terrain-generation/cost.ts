import { legacyTerrainView, terrainIdentityDescriptors } from './composition-integrity.js'
import { outdoorIdentityDescriptors } from '../history/identity.js'
import { extendedIdentityDescriptors } from './identities.js'
import type { SceneDocument } from '../model/scene.js'
import type { CompositionContent } from '../model/appearance.js'
import { visualCommandCost } from '../visual/commands.js'
import { canonicalJson } from '../validation/json.js'
import type { GenerationSystem3, GenerationSystem4 } from './contracts.js'
const recordDiff = (a:Record<string,unknown>,b:Record<string,unknown>, extra:(v:unknown)=>number=()=>0) => [...new Set([...Object.keys(a),...Object.keys(b)])].reduce((sum,id)=>canonicalJson(a[id]??null)===canonicalJson(b[id]??null)?sum:sum+1+Math.max(extra(a[id]),extra(b[id])),0)
const geometry = (value:unknown):number => {
  if(!value||typeof value!=='object') return 0
  const row=value as Record<string,unknown>
  let cost=0
  for(const key of ['boundaryMm','pointsMm','skeleton','inherited','polygons','strokes']) {
    const values=row[key]
    if(Array.isArray(values)) {
      if(key==='boundaryMm') cost+=values.length*2
      else if(key==='pointsMm') cost+=Math.max(0,values.length*2-1)
      else for(const value of values) cost+=Array.isArray(value)?value.length*2:1+geometry(value)
    }
  }
  return cost
}
export interface TerrainCostMetadata {
  before: Pick<CompositionContent, 'historyIdentity' | 'appearance'>
  after: Pick<CompositionContent, 'historyIdentity' | 'appearance'>
}
const IDENTITY_POOLS = ['propTokens','prefabTokens','outdoorTokens','generationTokens','regionalTokens','presentationTokens','terrainTokens'] as const
const APPEARANCE_RECORDS = ['sources','propSources','surfaceSources','instanceAdjustments','layerAdjustments','variants','prefabAppearanceTemplates','presentations'] as const
const FIXED_SOURCE_COLLECTIONS = ['assets','materials','propDefinitions','prefabDefinitions','styleThemes'] as const
/** Full materialized delta, never seed-only or one-operation island accounting. */
export function terrainCommandCost(before:SceneDocument,after:SceneDocument,metadata?:TerrainCostMetadata) {
  const originalBefore=before,originalAfter=after
  const beforeLegacy=legacyTerrainView(before),afterLegacy=legacyTerrainView(after)
  const items:Record<string,number>={physicalAndVisual:visualCommandCost(originalBefore,originalAfter)}
  // References are finite closed-over dependencies, not free opaque arrays.
  const ruleGeometry=(v:unknown)=>geometry(v)+((v as {inputs?:unknown[];outputs?:unknown[]}|undefined)?.inputs?.length??0)+((v as {outputs?:unknown[]}|undefined)?.outputs?.length??0)
  for(const key of ['recipes','intents','rules','ownership','exclusions','constraints','checks','sourceLinks'] as const) items[`generation.${key}`]=recordDiff(beforeLegacy.generation?.[key]??{},afterLegacy.generation?.[key]??{},key==='rules'?ruleGeometry:geometry)
  if(beforeLegacy.generation?.version!==afterLegacy.generation?.version) items['generation.version']=1
  const strokes=(scene:ReturnType<typeof legacyTerrainView>)=>scene.generation && scene.generation.version!==1?scene.generation.strokes:{}
  items['generation.strokes']=recordDiff(strokes(beforeLegacy),strokes(afterLegacy),geometry)
  const surroundings=(scene:ReturnType<typeof legacyTerrainView>)=>scene.generation && scene.generation.version>=3?(scene.generation as GenerationSystem3|GenerationSystem4).surroundings:{}
  items['generation.surroundings']=recordDiff(surroundings(beforeLegacy),surroundings(afterLegacy),value=>{const row=value as {boundaryIds?:unknown[];preserved?:unknown[]}|undefined;return (row?.boundaryIds?.length??0)+(row?.preserved?.length??0)})
  items['generation.topology']=recordDiff(beforeLegacy.generation?.version===4?beforeLegacy.generation.topology:{},afterLegacy.generation?.version===4?afterLegacy.generation.topology:{},value=>{const row=value as {outputAreaIds?:unknown[];inputs?:{boundaryMm:unknown[]}[];request?:{clip:unknown[][];rebindings:unknown[]}}|undefined;return (row?.outputAreaIds?.length??0)+(row?.inputs?.reduce((sum,input)=>sum+1+input.boundaryMm.length*2,0)??0)+(row?.request?.clip.reduce((sum,ring)=>sum+ring.length*2,0)??0)+(row?.request?.rebindings.length??0)})
  if(beforeLegacy.visual?.version===2 || afterLegacy.visual?.version===2) items.materializedEdges=recordDiff(beforeLegacy.visual?.version===2?beforeLegacy.visual.materializedEdges:{},afterLegacy.visual?.version===2?afterLegacy.visual.materializedEdges:{},geometry)
  for(const key of ['areas','lines','landmarks','symbols','symbolDefinitions'] as const) items[`regional.${key}`]=recordDiff(beforeLegacy.regional?.[key]??{},afterLegacy.regional?.[key]??{},geometry)
  if(canonicalJson(beforeLegacy.regional?.profile??null)!==canonicalJson(afterLegacy.regional?.profile??null))items.regionalProfile=1
  if(originalBefore.schemaVersion===4||originalAfter.schemaVersion===4){
    const a=originalBefore.generation?.version===5?originalBefore.generation:undefined,b=originalAfter.generation?.version===5?originalAfter.generation:undefined
    for(const key of ['features','compositions','requirements','checks','thresholds','dependencies'] as const)items[`composition.${key}`]=recordDiff(a?.[key]??{},b?.[key]??{},compositionRecordExpansion)
    if(metadata){
      for(const key of IDENTITY_POOLS)items[`composition.identity.actual.${key}`]=recordDiff(metadata.before.historyIdentity[key]??{},metadata.after.historyIdentity[key]??{})
      for(const key of APPEARANCE_RECORDS)items[`composition.appearance.${key}`]=recordDiff(metadata.before.appearance[key]??{},metadata.after.appearance[key]??{},compositionRecordExpansion)
      for(const key of FIXED_SOURCE_COLLECTIONS)items[`composition.resources.${key}`]=recordDiff(originalBefore[key]??{},originalAfter[key]??{},compositionRecordExpansion)
      if(metadata.before.historyIdentity.version!==metadata.after.historyIdentity.version)items['composition.identity.version']=1
      if(metadata.before.historyIdentity.lineageId!==metadata.after.historyIdentity.lineageId||metadata.before.historyIdentity.rootSceneId!==metadata.after.historyIdentity.rootSceneId)items['composition.identity.lineage']=1
      if(metadata.before.appearance.version!==metadata.after.appearance.version)items['composition.appearance.version']=1
    }else{
      // Draft-only estimates cannot see retained tombstones, changed tokens or fixed sources.
      items['composition.identity.estimate.outdoor']=recordDiff(outdoorIdentityDescriptors(originalBefore),outdoorIdentityDescriptors(originalAfter))
      items['composition.identity.estimate.legacy']=recordDiff(extendedIdentityDescriptors(originalBefore),extendedIdentityDescriptors(originalAfter))
      items['composition.identity.estimate.terrain']=recordDiff(terrainIdentityDescriptors(originalBefore),terrainIdentityDescriptors(originalAfter))
      items['composition.identity.estimate.props']=recordDiff(originalBefore.props,originalAfter.props)
      items['composition.identity.estimate.prefabs']=recordDiff(originalBefore.prefabInstances,originalAfter.prefabInstances)
    }
    if(originalBefore.generation?.version!==originalAfter.generation?.version)items['composition.version']=1
    if(originalBefore.visual?.version!==originalAfter.visual?.version)items['composition.visualVersion']=1
    if(originalBefore.schemaVersion!==originalAfter.schemaVersion)items['composition.projectVersion']=1
  }
  const total=Object.values(items).reduce((a,b)=>a+b,0)
  return {items,total,limit:256}
}
export function assertTerrainBudget(before:SceneDocument,after:SceneDocument,metadata?:TerrainCostMetadata) {
  if((before.schemaVersion===4||after.schemaVersion===4)&&!metadata)throw new Error('完整v4采用预算缺少真实历史身份与外观来源；仅SceneDocument草稿估算不能用于安装。')
  const cost=terrainCommandCost(before,after,metadata)
  if(cost.total>256)throw new Error(`地形候选实际展开${cost.total}，超过256；请减少细节或缩小范围。`)
  return cost
}

/** New v4 metadata expands snapshots and references independently, including repeated geometry. */
export function compositionRecordExpansion(value:unknown):number {
  return expandCompositionValue(value)
}
const pointAndSegments=(length:number,closed:boolean)=>length+(closed?length:Math.max(0,length-1))
function expandCompositionValue(value:unknown,closedPoints=false):number {
  if(!value||typeof value!=='object')return 0
  if(Array.isArray(value))return value.reduce((sum,row)=>sum+1+expandCompositionValue(row),0)
  const row=value as Record<string,unknown>
  // One centre and four persisted axis endpoints, each with its geometric segment.
  if(row.kind==='ellipse')return 10
  let count=0
  for(const [key,item] of Object.entries(row)){
    if(!item||typeof item!=='object') { if(key==='haloMm')count++;continue }
    if(key==='features'||key==='members'&&!Array.isArray(item)){
      count+=Object.values(item).reduce((sum:number,member)=>sum+1+expandCompositionValue(member),0)
    }else if(['outputRefs','writes','featureIds','thresholdIds','requirementIds','transitionIds'].includes(key)&&Array.isArray(item))count+=item.length
    else if(['boundaryMm','groundShadowMm'].includes(key)&&Array.isArray(item))count+=pointAndSegments(item.length,true)
    else if(['pointsMm','centerlineMm'].includes(key)&&Array.isArray(item))count+=pointAndSegments(item.length,closedPoints)
    else if(key==='polygons'&&Array.isArray(item))count+=item.reduce((sum,polygon)=>sum+1+(Array.isArray(polygon)?pointAndSegments(polygon.length,true):expandCompositionValue(polygon,true)),0)
    else if(['segments','strokes','reads','members','overlays','exclusions','skeleton','inherited'].includes(key)&&Array.isArray(item))count+=item.reduce((sum,entry)=>sum+1+expandCompositionValue(entry),0)
    else if(key==='clip'&&Array.isArray(item))count+=item.reduce((sum,ring)=>sum+1+(Array.isArray(ring)?pointAndSegments(ring.length,true):expandCompositionValue(ring)),0)
    else if(['sourceInput','snapshot','grid'].includes(key))count+=1+expandCompositionValue(item)
    else if(['scopeMm','boundsMm','clipMm','visualBoundsMm','footprintMm','sizeMm'].includes(key))count++
    else if(['positionMm','centerMm','anchorMm','originMm','gridOriginMm','footprintOffsetMm','rootAnchorMm','start','end','control1','control2'].includes(key))count++
    else if(Array.isArray(item))count+=item.reduce((sum,entry)=>sum+1+expandCompositionValue(entry),0)
    else count+=expandCompositionValue(item)
  }
  return count
}
