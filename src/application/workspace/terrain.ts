import { getLegacyGeneration } from '../../shared/terrain-generation/composition-contracts.js'
import type { EditableProject } from './project.js'
import { captureEditableDraft, validateEditableProject } from './project.js'
import type { CompleteValidationOptions } from '../../shared/ports/resources.js'
import type { PreparationContext } from '../../shared/ports/runtime.js'
import { createHistoryIdentity } from '../../shared/history/identity.js'
import { createCompositionContent } from '../../shared/appearance/graph.js'
import { materializeProject } from './prepare.js'
import { constraintInputHash, generationInputHash, managedOutputHash } from '../../shared/terrain-generation/integrity.js'
import { canonicalJson, captureJson, freezeJson } from '../../shared/validation/json.js'
import { generateTerrainDocument, terrainGenerationInputSchema, terrainGenerationResultSchema, type TerrainGenerationResult } from '../../shared/terrain-generation/generate.js'
import { composeTerrainDocument, emptyTerrainDocument } from '../../shared/terrain-generation/compose.js'
import type { terrainCommandCost } from '../../shared/terrain-generation/cost.js'
import { assertTerrainBudget } from '../../shared/terrain-generation/cost.js'
import { emptyVisualSystem } from '../../shared/visual/types.js'
export interface TerrainPreviewBase {
  project:EditableProject; input:TerrainGenerationResult['input']
  cost:ReturnType<typeof terrainCommandCost>; checkpoint:number; currentSceneId:string|null; currentRevision:number|null
}
export type TerrainPreview=TerrainPreviewBase & ({result:TerrainGenerationResult;composition?:undefined}|{result:{plan:import('../../shared/terrain-generation/composition-field.js').TerrainCompositionPlan;route?:undefined};composition:import('../../shared/terrain-generation/composition-presets.js').CompositionPresetInput})
export async function prepareTerrainProject(base:EditableProject,input:unknown,options:{runtime:PreparationContext;validation:CompleteValidationOptions;result?:TerrainGenerationResult}) {
  const owned=await validateEditableProject(captureEditableDraft(base),options.validation), request=terrainGenerationInputSchema.parse(captureJson(input))
  const result=generateTerrainDocument(owned.document,request)
  if(options.result && canonicalJson(result)!==canonicalJson(terrainGenerationResultSchema.parse(captureJson(options.result))))throw new Error('地形计算结果与确定性重放不符。')
  const {document,cost}=composeTerrainDocument(owned.document,result,options.runtime.ids.nextId())
  const labels = { island: '岩岛', coast: '海岸', river: '河谷', lake: '内湖', forest: '森林', hill: '丘陵', mixed: '混合地貌' } as const
  document.title=`${labels[request.kind]} · ${result.skeleton.name}`
  const content=createCompositionContent(document,options.runtime)
  // Instance paints can require real fixed bitmap derivatives. Materialize
  // them before the new candidate is made adoptable, just like normal edits.
  const materialized=await materializeProject({...owned,schemaVersion:3,...content},{runtime:options.runtime,validation:options.validation})
  const candidate=captureEditableDraft(materialized)
  // Appearance resolution is part of this initial generation, not a later
  // manual edit. Rebind the newly born ownership to the actual adopted paints.
  candidate.document.generation=captureJson(document.generation!)
  if(candidate.document.generation.version===5)throw new Error('旧生成路径不接受generation5。')
  for(const rule of Object.values(getLegacyGeneration(candidate.document)!.rules)){
    rule.inputHash=generationInputHash(candidate.document,rule)
    rule.managedOutputHash=managedOutputHash(candidate.document,rule)
  }
  for(const check of Object.values(candidate.document.generation.checks))check.inputHash=constraintInputHash(candidate.document,check.constraintId)
  const empty=emptyTerrainDocument(owned.document);empty.visual={version:2,base:emptyVisualSystem(),materializedEdges:{}}
  if(assertTerrainBudget(empty,candidate.document).total!==cost.total)throw new Error('真实派生资源采用后的地形展开成本与已审阅结果不同。')
  const project=await validateEditableProject(candidate,options.validation)
  return {project,cost,result:freezeJson(result),input:freezeJson(request)}
}
/** Independent copy contract. Full source remains owned by its original project family. */
export async function prepareTerrainUpgrade(source:EditableProject,options:{runtime:PreparationContext;validation:CompleteValidationOptions}) {
  if(source.schemaVersion!==2)throw new Error('请先建立完整v2视觉副本，再升级地形工程。')
  const owned=await validateEditableProject(source,options.validation),document=emptyTerrainDocument(owned.document),now=options.runtime.clock.now()
  document.sceneId=options.runtime.ids.nextId();document.revision=0;document.createdAt=now;document.updatedAt=now;document.title+=' · 地形副本'
  return validateEditableProject({...owned,schemaVersion:3,document,historyIdentity:createHistoryIdentity(document,options.runtime),appearance:{...captureJson(owned.appearance),version:2,presentations:Object.fromEntries(Object.values(owned.appearance.sources).filter(source=>source.kind==='prop').map(source=>[source.id,{mode:'topDown',rootAnchorMm:{x:0,y:0},orientation:'rotateWithGround',groundShadowMm:null}]))}},options.validation)
}
