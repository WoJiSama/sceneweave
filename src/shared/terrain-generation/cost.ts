import type { SceneDocument } from '../model/scene.js'
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
/** Full materialized delta, never seed-only or one-operation island accounting. */
export function terrainCommandCost(before:SceneDocument,after:SceneDocument) {
  const items:Record<string,number>={physicalAndVisual:visualCommandCost(before,after)}
  // References are finite closed-over dependencies, not free opaque arrays.
  const ruleGeometry=(v:unknown)=>geometry(v)+((v as {inputs?:unknown[];outputs?:unknown[]}|undefined)?.inputs?.length??0)+((v as {outputs?:unknown[]}|undefined)?.outputs?.length??0)
  for(const key of ['recipes','intents','rules','ownership','exclusions','constraints','checks','sourceLinks'] as const) items[`generation.${key}`]=recordDiff(before.generation?.[key]??{},after.generation?.[key]??{},key==='rules'?ruleGeometry:geometry)
  if(before.generation?.version!==after.generation?.version) items['generation.version']=1
  const strokes=(scene:SceneDocument)=>scene.generation && scene.generation.version!==1?scene.generation.strokes:{}
  items['generation.strokes']=recordDiff(strokes(before),strokes(after),geometry)
  const surroundings=(scene:SceneDocument)=>scene.generation && scene.generation.version>=3?(scene.generation as GenerationSystem3|GenerationSystem4).surroundings:{}
  items['generation.surroundings']=recordDiff(surroundings(before),surroundings(after),value=>{const row=value as {boundaryIds?:unknown[];preserved?:unknown[]}|undefined;return (row?.boundaryIds?.length??0)+(row?.preserved?.length??0)})
  items['generation.topology']=recordDiff(before.generation?.version===4?before.generation.topology:{},after.generation?.version===4?after.generation.topology:{},value=>{const row=value as {outputAreaIds?:unknown[];inputs?:{boundaryMm:unknown[]}[];request?:{clip:unknown[][];rebindings:unknown[]}}|undefined;return (row?.outputAreaIds?.length??0)+(row?.inputs?.reduce((sum,input)=>sum+1+input.boundaryMm.length*2,0)??0)+(row?.request?.clip.reduce((sum,ring)=>sum+ring.length*2,0)??0)+(row?.request?.rebindings.length??0)})
  if(before.visual?.version===2 || after.visual?.version===2) items.materializedEdges=recordDiff(before.visual?.version===2?before.visual.materializedEdges:{},after.visual?.version===2?after.visual.materializedEdges:{},geometry)
  for(const key of ['areas','lines','landmarks','symbols','symbolDefinitions'] as const) items[`regional.${key}`]=recordDiff(before.regional?.[key]??{},after.regional?.[key]??{},geometry)
  if(canonicalJson(before.regional?.profile??null)!==canonicalJson(after.regional?.profile??null))items.regionalProfile=1
  const total=Object.values(items).reduce((a,b)=>a+b,0)
  return {items,total,limit:256}
}
export function assertTerrainBudget(before:SceneDocument,after:SceneDocument) {
  const cost=terrainCommandCost(before,after)
  if(cost.total>256)throw new Error(`地形候选实际展开${cost.total}，超过256；请减少细节或缩小范围。`)
  return cost
}
