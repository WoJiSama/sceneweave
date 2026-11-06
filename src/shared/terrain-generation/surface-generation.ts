import { z } from 'zod'
import type { SceneDocument, SurfaceStyle } from '../model/scene.js'
import { LAYER_ENTITY_COLLECTIONS } from '../model/scene.js'
import { canonicalJson, captureJson, cloneJson } from '../validation/json.js'
import { validateSceneDocument } from '../validation/scene.js'
import { BUDGET_DIMENSIONS, BudgetUsageSchema, assertTaskBudget, captureExecutionBudget, emptyBudgetUsage,
  measureTaskBudget, taskBudgetProfile, type BudgetUsage, type TaskBudgetProfile } from '../budget/task-budget.js'
import { visualBase } from '../visual/base.js'
import { emptyVisualSystem } from '../visual/types.js'
import { visualCommandCost } from '../visual/commands.js'
import { SHORE_MATERIAL_IDS } from '../visual/shore-art.js'
import { applyShoreSurfaceRecipe } from '../visual/shore-surfaces.js'
import { generateTerrainDocumentV4, terrainGenerationInputV4Schema, terrainGenerationResultV4Schema,
  type TerrainGenerationInputV5, type TerrainGenerationResult, type TerrainManagedTarget } from './generate.js'
import { compositionPresetV4, compositionPresetV4Schema } from './composition-presets.js'
import { materializeTerrainComposition } from './composition-materialize.js'
import type { TerrainCompositionInput } from './composition-field.js'
import type { TerrainRequirement } from './composition-contracts.js'
import { compositionInputHash, compositionOutputHash, dependencyInputHash, terrainRequirementInputHash } from './composition-integrity.js'
import { evaluateTerrainRequirement } from './composition-requirements.js'
import { generationInputHash, managedOutputHash } from './integrity.js'

/** A new selector owns the new surfaces; algorithms 1–4 keep their exact result. */
export const terrainGenerationInputV5Schema = z.object({ ...terrainGenerationInputV4Schema.shape, algorithmVersion:z.literal(5) }).strict()
  .refine(value=>value.widthMm/value.heightMm>=1&&value.widthMm/value.heightMm<=1.8,'首批地形范围宽高比须为1–1.8。')
export const terrainGenerationResultV5Schema = z.object({ ...terrainGenerationResultV4Schema.shape, input:terrainGenerationInputV5Schema,
  cost:terrainGenerationResultV4Schema.shape.cost.extend({environmentChanges:z.union([z.literal(0),z.literal(1)])}).strict() }).strict()
  .superRefine((result,context)=>{
    // Reuse the complete geometry/route/cost contract under its frozen v4
    // physical selector. The v5 envelope itself remains independently strict.
    const physical=cloneJson(result.document)
    visualBase(physical)!.environment=emptyVisualSystem().environment
    const {environmentChanges:_environment,...cost}=resultCost(physical,result,result.managedTargets)
    const checked=terrainGenerationResultV4Schema.safeParse({...result,input:{...result.input,algorithmVersion:4},document:physical,cost})
    if(!checked.success)for(const issue of checked.error.issues)context.addIssue({code:'custom',path:issue.path,message:issue.message})
    if(!same(result.cost,resultCost(result.document,result,result.managedTargets)))context.addIssue({code:'custom',path:['cost'],message:'岸面配方5实际完整成本与回执不同。'})
  })
export type TerrainGenerationResultV5 = z.infer<typeof terrainGenerationResultV5Schema>
export type { TerrainGenerationInputV5 }
export const compositionPresetV5Schema = z.object({...compositionPresetV4Schema.shape,recipeVersion:z.literal(5)}).strict()
  .refine(value=>value.widthMm/value.heightMm>=1&&value.widthMm/value.heightMm<=1.8,'宽高比须为1–1.8。')
export type CompositionPresetInputV5 = z.infer<typeof compositionPresetV5Schema>
export function compositionPresetV5(raw:unknown) {
  const request=compositionPresetV5Schema.parse(captureJson(raw))
  const result=compositionPresetV4({...request,recipeVersion:4})
  return {...result,request}
}
const same=(a:unknown,b:unknown)=>canonicalJson(a)===canonicalJson(b)
const byId=(a:string,b:string)=>a<b?-1:a>b?1:0
const withoutSurface=<T extends Record<string,unknown>>(row:T)=>Object.fromEntries(Object.entries(row).filter(([key])=>!['surfaceStyle','floorStyle','topStyle'].includes(key)))
/** Appearance may add visual decoration; every persisted physical field stays
 * identical to the independently generated v4 result, including privacy. */
export function terrainPhysicalProjection(document:SceneDocument):unknown {
  const surfaces=(rows:Record<string,unknown>)=>Object.fromEntries(Object.entries(rows).map(([id,row])=>[id,withoutSurface(row as Record<string,unknown>)]))
  return {sceneId:document.sceneId,revision:document.revision,units:document.units,exportBoundsMm:document.exportBoundsMm,floors:document.floors,
    vertices:document.vertices,rooms:surfaces(document.rooms),walls:surfaces(document.walls),openings:document.openings,props:document.props,
    terrainAreas:surfaces(document.terrainAreas),terrainEdges:surfaces(document.terrainEdges),terrainConnections:surfaces(document.terrainConnections),
    paths:surfaces(document.paths),regions:document.regions,notes:document.notes,prefabInstances:document.prefabInstances,scatterGroups:document.scatterGroups,
    userLayers:document.userLayers,entityLayers:document.entityLayers,regional:document.regional??null}
}
function assertPhysicalPreservation(before:SceneDocument,after:SceneDocument):void {
  if(!same(terrainPhysicalProjection(before),terrainPhysicalProjection(after)))throw new Error('岸面配方5不能改变物理几何、支撑、通行或隐私。')
  for(const [id,boundary]of Object.entries(visualBase(before)?.boundaries??{}))if(!same(boundary,visualBase(after)?.boundaries[id]))throw new Error('岸面配方5不能修改已有物理绑定曲线。')
}
function addExecutionUsage(first:BudgetUsage|undefined,second:BudgetUsage):BudgetUsage {
  const usage=emptyBudgetUsage()
  for(const key of BUDGET_DIMENSIONS)usage[key]=(first?.[key]??0)+second[key]
  return BudgetUsageSchema.parse(usage)
}
function sortedManagedTargets(document:SceneDocument):TerrainManagedTarget[] {
  const visual=visualBase(document)!
  const collection=<T>(items:Record<string,T>,kind:TerrainManagedTarget['kind'])=>Object.keys(items).sort(byId).map(id=>({kind,id}))
  for(const key of ['terrainAreas','terrainConnections','paths','props'] as const)Object.assign(document,{[key]:Object.fromEntries(Object.entries(document[key]).sort(([a],[b])=>byId(a,b)))})
  visual.boundaries=Object.fromEntries(Object.entries(visual.boundaries).sort(([a],[b])=>byId(a,b)))
  visual.edgeLooks=Object.fromEntries(Object.entries(visual.edgeLooks).sort(([a],[b])=>byId(a,b)))
  return [...collection(document.terrainAreas,'terrainArea'),...collection(document.terrainConnections,'terrainConnection'),...collection(document.paths,'path'),
    ...collection(document.props,'prop'),...collection(visual.boundaries,'visualBoundary'),...collection(visual.edgeLooks,'visualEdgeLook')]
}
function resultCost(document:SceneDocument,result:TerrainGenerationResult,managedTargets:TerrainManagedTarget[]):TerrainGenerationResult['cost']&{environmentChanges:0|1} {
  const blank=cloneJson(document)
  for(const key of LAYER_ENTITY_COLLECTIONS)Object.assign(blank,{[key]:{}})
  blank.entityLayers={};blank.visual={version:3,base:{version:2,base:emptyVisualSystem(),materializedEdges:{}},transitions:{}}
  const visual=visualBase(document)!,terrainPoints=Object.values(document.terrainAreas).reduce((sum,row)=>sum+row.boundaryMm.length,0)
  const legacyTotal=visualCommandCost(blank,document)
  const recommendedGenerationRecords=1+(1+2)+(1+managedTargets.length)+managedTargets.length+(1+result.activity.boundaryMm.length*2)+1+(result.route?result.route.pointsMm.length*2+1:0)
  return {physicalEntities:LAYER_ENTITY_COLLECTIONS.reduce((sum,key)=>sum+Object.keys(document[key]).length,0),terrainPoints,terrainSegments:terrainPoints,
    pathPoints:Object.values(document.paths).reduce((sum,row)=>sum+row.centerlineMm.length,0),
    visualEntities:(['boundaries','edgeLooks','lights','fogs','filters'] as const).reduce((sum,key)=>sum+Object.keys(visual[key]).length,0),
    curveSegments:Object.values(visual.boundaries).reduce((sum,row)=>sum+row.segments.length,0),
    overlays:Object.values(document.terrainAreas).reduce((sum,row)=>sum+(row.surfaceStyle?.overlays.length??0),0),
    environmentChanges:same(visual.environment,emptyVisualSystem().environment)?0:1,legacyTotal,recommendedGenerationRecords,total:legacyTotal+recommendedGenerationRecords}
}
const shoreIds=new Set<string>(Object.values(SHORE_MATERIAL_IDS))
function ancillaryMaterial(document:SceneDocument,id:string):string {
  if(shoreIds.has(id))return id
  const material=document.materials[id]
  if(!material)throw new Error('岸面配方5缺少辅助表面固定材质。')
  const tags=`${id} ${material.tags.join(' ')}`.toLowerCase()
  if(tags.includes('water')||tags.includes('水'))return tags.includes('shallow')?SHORE_MATERIAL_IDS.waterShallow:SHORE_MATERIAL_IDS.waterDeep
  if(tags.includes('sand')||tags.includes('沙'))return tags.includes('wet')?SHORE_MATERIAL_IDS.sandWet:SHORE_MATERIAL_IDS.sandDry
  if(tags.includes('grass')||tags.includes('moss')||tags.includes('草'))return SHORE_MATERIAL_IDS.grass
  return SHORE_MATERIAL_IDS.rockDry
}
function restyleAncillary(document:SceneDocument):void {
  const paint=(style:SurfaceStyle|null)=>{
    if(!style)return
    for(const row of [style.base,...style.overlays.map(overlay=>overlay.paint)]){
      const id=ancillaryMaterial(document,row.materialRef.id),material=document.materials[id]
      if(!material)throw new Error('岸面配方5辅助表面没有新固定材质。')
      row.materialRef={id,version:material.version}
    }
  }
  for(const collection of [document.terrainEdges,document.terrainConnections,document.paths])for(const row of Object.values(collection))paint(row.surfaceStyle)
}
function checkedSurfaceDocument(original:SceneDocument,seed:string,meter:ReturnType<typeof captureExecutionBudget>):SceneDocument {
  const document=cloneJson(applyShoreSurfaceRecipe(original,seed,{meter}))
  restyleAncillary(document);assertPhysicalPreservation(original,document)
  return document
}
export function generateTerrainDocumentV5(base:SceneDocument,raw:unknown):TerrainGenerationResultV5 {
  const input=terrainGenerationInputV5Schema.parse(captureJson(raw)),profile=taskBudgetProfile(input.budgetProfileId)
  const physical=generateTerrainDocumentV4(base,{...input,algorithmVersion:4}),meter=captureExecutionBudget(profile)
  const document=checkedSurfaceDocument(physical.document,input.seed,meter),managedTargets=sortedManagedTargets(document)
  const executionUsage=addExecutionUsage(physical.executionUsage,meter.snapshot())
  assertTaskBudget(profile,measureTaskBudget(base,document,undefined,executionUsage))
  return terrainGenerationResultV5Schema.parse({...physical,input,document,managedTargets,executionUsage,cost:resultCost(document,physical,managedTargets)})
}
function actualRecipeMaterials(document:SceneDocument) {
  const used=new Set([...Object.values(document.terrainAreas),...Object.values(document.terrainEdges),...Object.values(document.terrainConnections),...Object.values(document.paths)]
    .flatMap(row=>row.surfaceStyle?[row.surfaceStyle.base.materialRef.id,...row.surfaceStyle.overlays.map(overlay=>overlay.paint.materialRef.id)]:[]))
  return [...used].sort(byId).map(id=>{
    const material=document.materials[id]
    if(!material||!shoreIds.has(id))throw new Error('岸面配方5只能使用其确切的新固定表面。')
    const role=material.tags.includes('water')?'water':material.tags.includes('sand')?'sand':material.tags.includes('grass')?'grass':'rock'
    return {role:role as 'water'|'sand'|'grass'|'rock',ref:{id,version:material.version}}
  })
}
/** Native composition outputRefs/dependency writes remain the sole writer;
 * adding legacy rule ownership to those fields would create two writers. */
export function materializeTerrainCompositionV5(base:SceneDocument,input:TerrainCompositionInput,requirements:TerrainRequirement[],title:string,
  profile:'plain'|'tidal'|'tidal-v2'='plain',recipeVersion:5=5,budget?:TaskBudgetProfile) {
  if(recipeVersion!==5||!budget)throw new Error('岸面组合5需要显式版本5与注册预算。')
  const physical=materializeTerrainComposition(base,input,requirements,title,profile,4,budget),meter=captureExecutionBudget(budget)
  const document=checkedSurfaceDocument(physical.document,input.seed,meter),system=document.generation
  if(system?.version!==5)throw new Error('岸面组合5需要严格generation5。')
  const visual=visualBase(document)!,materials=actualRecipeMaterials(document)
  for(const composition of Object.values(system.compositions)){
    const recipe=system.legacy.recipes[composition.recipeRef.id]
    recipe.recipeVersion=5;recipe.materials=cloneJson(materials);composition.recipeRef.version=5
    const refs=Object.keys(document.terrainAreas).sort(byId).flatMap(entityId=>(['geometry','properties','surface'] as const).map(fieldGroup=>({kind:'terrainArea' as const,entityId,parentId:null,fieldGroup})))
    const boundaries=Object.keys(visual.boundaries).sort(byId).flatMap(entityId=>(['geometry','properties','source'] as const).map(fieldGroup=>({kind:'visualBoundary' as const,entityId,parentId:null,fieldGroup})))
    const looks=Object.keys(visual.edgeLooks).sort(byId).flatMap(entityId=>(['geometry','properties','appearance','source'] as const).map(fieldGroup=>({kind:'visualEdgeLook' as const,entityId,parentId:null,fieldGroup})))
    composition.outputRefs=[...refs,...boundaries,...looks]
    for(const dependency of Object.values(system.dependencies).filter(row=>row.compositionId===composition.id)){
      dependency.writes=cloneJson(composition.outputRefs);dependency.inputHash=dependencyInputHash(document,dependency)
    }
    for(const check of Object.values(system.checks).filter(row=>composition.requirementIds.includes(row.requirementId))){
      const requirement=system.requirements[check.requirementId],evaluation=evaluateTerrainRequirement(document,requirement,meter)
      if(evaluation.state!=='passed')throw new Error(`岸面组合5不能改变硬要求：${evaluation.issues.map(row=>row.message).join('；')}`)
      Object.assign(check,evaluation,{inputHash:terrainRequirementInputHash(document,requirement)})
    }
    for(const rule of Object.values(system.legacy.rules)){
      if(rule.recipeRef.id===recipe.id)rule.recipeRef.version=5
      rule.inputHash=generationInputHash(document,rule);rule.managedOutputHash=managedOutputHash(document,rule)
    }
    composition.inputHash=compositionInputHash(document,composition);composition.outputHash=compositionOutputHash(document,composition)
  }
  const checked=validateSceneDocument(document)
  if(!checked.ok)throw new Error(`岸面组合5完整校验失败：${checked.errors.map(row=>`${row.entityId??''}:${row.code}`).join('；')}`)
  const executionUsage=addExecutionUsage(physical.executionUsage,meter.snapshot())
  assertTaskBudget(budget,measureTaskBudget(base,checked.document,undefined,executionUsage))
  return {document:checked.document,plan:physical.plan,executionUsage}
}
