import { terrainGenerationInputV5Schema, terrainGenerationResultV5Schema, generateTerrainDocumentV5, type TerrainGenerationResultV5 } from '../../shared/terrain-generation/surface-generation.js'
import { terrainGenerationInputV6Schema, terrainGenerationResultV6Schema, generateTerrainDocumentV6, type TerrainGenerationResultV6,
  compositionPresetV6Schema } from '../../shared/terrain-generation/surface-rule-generation.js'
import { terrainGenerationInputV7Schema, terrainGenerationResultV7Schema, generateTerrainDocumentV7, type TerrainGenerationResultV7,
  compositionPresetV7Schema } from '../../shared/terrain-generation/surface-rule-generation-v7.js'
import { terrainMapOrder } from '../../shared/terrain-generation/base-map.js'
import { measureTaskBudget, assertTaskBudget, taskSemanticTargets, type TaskBudgetProfile } from '../../shared/budget/task-budget.js'
import { getLegacyGeneration } from '../../shared/terrain-generation/composition-contracts.js'
import type { EditableProject } from './project.js'
import { captureEditableDraft, validateEditableProject } from './project.js'
import type { CompleteValidationOptions } from '../../shared/ports/resources.js'
import type { PreparationContext } from '../../shared/ports/runtime.js'
import { createCompositionContent } from '../../shared/appearance/graph.js'
import { materializeProject } from './prepare.js'
import { constraintInputHash, generationInputHash, managedOutputHash } from '../../shared/terrain-generation/integrity.js'
import { canonicalJson, captureJson, freezeJson } from '../../shared/validation/json.js'
import { generateTerrainDocument, generateTerrainDocumentV4, terrainGenerationInputV4Schema, terrainGenerationResultV4Schema, terrainGenerationInputSchema, terrainGenerationResultSchema, type TerrainGenerationResult } from '../../shared/terrain-generation/generate.js'
import { composeTerrainDocument, emptyTerrainDocument } from '../../shared/terrain-generation/compose.js'
import type { terrainCommandCost } from '../../shared/terrain-generation/cost.js'
import { assertTerrainBudget } from '../../shared/terrain-generation/cost.js'
import { emptyVisualSystem } from '../../shared/visual/types.js'
import { bindTerrainVariantPresentations, bindTerrainVariantV2Presentations } from '../../shared/visual/terrain-variant-presentations.js'
import type { BaseMapRequest } from '../../shared/terrain-generation/base-map.js'
export interface BaseMapGenerationReceipt {
  version: 1 | 2 | 3; source: 'worker' | 'server'; requestId: string; workspaceSceneId: string
  checkpoint: number; operationEpoch: number; inputHash: string; baseHash: string; paletteHash: string
  algorithm: BaseMapRequest['algorithm'] | import('../../shared/terrain-generation/base-map-v3.js').BaseMapRequestV3['algorithm']; generation: BaseMapRequest['generation'] | import('../../shared/terrain-generation/base-map-v3.js').BaseMapRequestV3['generation']; resultHash: string; projectHash: string
  initialOperationCost: number; operationLimit: number; remainingOperationCost: number
  budgetProfile?: import('../../shared/budget/task-budget.js').TaskBudgetProfile
  budgetUsage?: import('../../shared/budget/task-budget.js').BudgetUsage
}
export interface TerrainPreviewBase {
  project:EditableProject; input:TerrainGenerationResult['input'] | TerrainGenerationResultV5['input'] | TerrainGenerationResultV6['input'] | TerrainGenerationResultV7['input']
  cost:ReturnType<typeof terrainCommandCost>; checkpoint:number; currentSceneId:string|null; currentRevision:number|null
  /** Session-only flow accounting. Never a field in the persisted complete project. */
  baseMap?: BaseMapGenerationReceipt
  /** Full task provenance stays in this session, outside saved project data. */
  continuationSource?: import('../../shared/ai/continuation-protocol.js').BaseMapSource | import('../../shared/ai/continuation-protocol-v3.js').BaseMapSourceV3
  continuationError?: string
}
export type TerrainPreview=TerrainPreviewBase & ({result:TerrainGenerationResult | TerrainGenerationResultV5 | TerrainGenerationResultV6 | TerrainGenerationResultV7;composition?:undefined}|{result:{plan:import('../../shared/terrain-generation/composition-field.js').TerrainCompositionPlan;route?:undefined};composition:import('../../shared/terrain-generation/composition-presets.js').CompositionPresetInput | import('../../shared/terrain-generation/surface-generation.js').CompositionPresetInputV5 | import('../../shared/terrain-generation/surface-rule-generation.js').CompositionPresetInputV6 | import('../../shared/terrain-generation/surface-rule-generation-v7.js').CompositionPresetInputV7})
export async function prepareTerrainProject(base:EditableProject,input:unknown,options:{runtime:PreparationContext;validation:CompleteValidationOptions;result?:TerrainGenerationResult | TerrainGenerationResultV5 | TerrainGenerationResultV6 | TerrainGenerationResultV7;budget?:TaskBudgetProfile;birthToken?:string}) {
  const owned=await validateEditableProject(captureEditableDraft(base),options.validation), raw=captureJson(input)
  const version=options.budget&&raw&&typeof raw==='object'&&'algorithmVersion'in raw?raw.algorithmVersion:undefined
  const request=options.budget?(version===7?terrainGenerationInputV7Schema:version===6?terrainGenerationInputV6Schema:version===5?terrainGenerationInputV5Schema:terrainGenerationInputV4Schema).parse(raw):terrainGenerationInputSchema.parse(raw)
  if (options.budget && request.algorithmVersion===7) {
    if (options.budget.profileId!==request.budgetProfileId) throw new Error('自动地表配方7与选定预算档位不同。')
    const result=terrainGenerationResultV7Schema.parse(generateTerrainDocumentV7(owned.document,request,options.birthToken))
    if (options.result && canonicalJson(result)!==canonicalJson(terrainGenerationResultV7Schema.parse(captureJson(options.result)))) throw new Error('自动地表7计算结果与确定性重放不符。')
    const document=captureJson(result.document) as TerrainGenerationResultV7['document']; document.title=`${request.kind==='island'?'岩岛':request.kind==='coast'?'海岸':'地形'} · ${result.skeleton.name}`
    const content=bindTerrainVariantV2Presentations(bindTerrainVariantPresentations(createCompositionContent(document,options.runtime)))
    const materialized=await materializeProject({...owned,schemaVersion:1,...content},{runtime:options.runtime,validation:options.validation})
    const candidate=captureEditableDraft(materialized),usage=assertTaskBudget(options.budget,measureTaskBudget(owned.document,candidate.document,{before:owned,after:candidate},result.executionUsage))
    const targets=taskSemanticTargets(owned.document,candidate.document),cost={items:Object.fromEntries(targets.map(target=>[target,1])),total:targets.length,limit:options.budget.semanticTargets}
    if(cost.total!==result.cost.total)throw new Error('完整工程资源与历史物化后的自动地表成本不同。')
    return {project:materialized,cost,result:freezeJson(result),input:freezeJson(request),usage}
  }
  if (options.budget && request.algorithmVersion===6) {
    if (options.budget.profileId!==request.budgetProfileId) throw new Error('自动地表配方6与选定预算档位不同。')
    const result=terrainGenerationResultV6Schema.parse(generateTerrainDocumentV6(owned.document,request,options.birthToken))
    if (options.result && canonicalJson(result)!==canonicalJson(terrainGenerationResultV6Schema.parse(captureJson(options.result)))) throw new Error('自动地表6计算结果与确定性重放不符。')
    const document=captureJson(result.document) as TerrainGenerationResultV6['document']; document.title=`${request.kind==='island'?'岩岛':request.kind==='coast'?'海岸':'地形'} · ${result.skeleton.name}`
    const content=bindTerrainVariantPresentations(createCompositionContent(document,options.runtime))
    const materialized=await materializeProject({...owned,schemaVersion:1,...content},{runtime:options.runtime,validation:options.validation})
    const candidate=captureEditableDraft(materialized),usage=assertTaskBudget(options.budget,measureTaskBudget(owned.document,candidate.document,{before:owned,after:candidate},result.executionUsage))
    const targets=taskSemanticTargets(owned.document,candidate.document),cost={items:Object.fromEntries(targets.map(target=>[target,1])),total:targets.length,limit:options.budget.semanticTargets}
    if(cost.total!==result.cost.total)throw new Error('完整工程资源与历史物化后的自动地表成本不同。')
    return {project:materialized,cost,result:freezeJson(result),input:freezeJson(request),usage}
  }
  const generated=options.budget?(request.algorithmVersion===5?generateTerrainDocumentV5(owned.document,request):generateTerrainDocumentV4(owned.document,request)):generateTerrainDocument(owned.document,request)
  // Match the new transport's strict managed-map boundary. The composer owns
  // stable recipe-array order; legacy algorithms retain their original path.
  const result=options.budget?(request.algorithmVersion===5?terrainGenerationResultV5Schema:terrainGenerationResultV4Schema).parse(terrainMapOrder(generated)):generated
  if(options.result && canonicalJson(result)!==canonicalJson((options.budget?(request.algorithmVersion===5?terrainGenerationResultV5Schema:terrainGenerationResultV4Schema):terrainGenerationResultSchema).parse(captureJson(options.result))))throw new Error('地形计算结果与确定性重放不符。')
  const {document,cost}=composeTerrainDocument(owned.document,result,options.runtime.ids.nextId(),options.budget)
  const labels = { island: '岩岛', coast: '海岸', river: '河谷', lake: '内湖', forest: '森林', hill: '丘陵', mixed: '混合地貌' } as const
  document.title=`${labels[request.kind]} · ${result.skeleton.name}`
  const content=createCompositionContent(document,options.runtime)
  // Instance paints can require real fixed bitmap derivatives. Materialize
  // them before the new candidate is made adoptable, just like normal edits.
  const materialized=await materializeProject({...owned,schemaVersion:1,...content},{runtime:options.runtime,validation:options.validation})
  const candidate=captureEditableDraft(materialized)
  // Appearance resolution is part of this initial generation, not a later
  // manual edit. Rebind the newly born ownership to the actual adopted paints.
  candidate.document.generation=captureJson(document.generation!)
  for(const rule of Object.values(getLegacyGeneration(candidate.document)!.rules)){
    rule.inputHash=generationInputHash(candidate.document,rule)
    rule.managedOutputHash=managedOutputHash(candidate.document,rule)
  }
  for(const check of Object.values(getLegacyGeneration(candidate.document)!.checks))check.inputHash=constraintInputHash(candidate.document,check.constraintId)
  const empty=emptyTerrainDocument(owned.document);empty.visual={version:3,base:{version:2,base:emptyVisualSystem(),materializedEdges:{}},transitions:{}}
  const usage=options.budget?assertTaskBudget(options.budget,measureTaskBudget(empty,candidate.document,{before:owned,after:candidate},result.executionUsage)):undefined
  const total=usage?usage.semanticTargets:assertTerrainBudget(empty,candidate.document, { before: owned, after: candidate }).total
  if(total!==cost.total)throw new Error('真实派生资源采用后的地形成本与已审阅结果不同。')
  const project=await validateEditableProject(candidate,options.validation)
  return {project,cost,result:freezeJson(result),input:freezeJson(request),...(usage?{usage}:{})}
}
