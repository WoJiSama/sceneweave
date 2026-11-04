import { compositionPresetV5, materializeTerrainCompositionV5 } from '../../shared/terrain-generation/surface-generation.js'
import { compositionPresetV6, compositionPresetV6Schema, materializeTerrainCompositionV6 } from '../../shared/terrain-generation/surface-rule-generation.js'
import { measureTaskBudget, assertTaskBudget, taskSemanticTargets, type TaskBudgetProfile } from '../../shared/budget/task-budget.js'
import type { EditableProject } from './project.js'
import { captureEditableDraft, validateEditableProject } from './project.js'
import type { CompleteValidationOptions } from '../../shared/ports/resources.js'
import { checkCancelled } from '../../shared/ports/resources.js'
import type { PreparationContext } from '../../shared/ports/runtime.js'
import { createHistoryIdentity } from '../../shared/history/identity.js'
import { createCompositionContent } from '../../shared/appearance/graph.js'
import { captureJson, canonicalJson } from '../../shared/validation/json.js'
import { compositionPreset, compositionPresetV4 } from '../../shared/terrain-generation/composition-presets.js'
import { emptyCompositionDocument, materializeTerrainComposition } from '../../shared/terrain-generation/composition-materialize.js'
import { compositionOutputHash } from '../../shared/terrain-generation/composition-integrity.js'
import { assertTerrainBudget } from '../../shared/terrain-generation/cost.js'
import { materializeProject } from './prepare.js'
import type { TerrainCompositionPlan } from '../../shared/terrain-generation/composition-field.js'
import type { SceneDocument } from '../../shared/model/scene.js'
import { bindTerrainVariantPresentations } from '../../shared/visual/terrain-variant-presentations.js'

export async function prepareTerrainComposition(base:EditableProject,raw:unknown,options:{runtime:PreparationContext;validation:CompleteValidationOptions;plan?:TerrainCompositionPlan;domainDocument?:SceneDocument;budget?:TaskBudgetProfile}){
 const owned=await validateEditableProject(captureEditableDraft(base),options.validation)
 checkCancelled(options.validation.signal)
 const version=raw&&typeof raw==='object'&&'recipeVersion'in raw?raw.recipeVersion:undefined
 const preset=options.budget?(version===6?compositionPresetV6(raw):version===5?compositionPresetV5(raw):compositionPresetV4(raw)):compositionPreset(raw)
 if(options.budget&&(preset.request.recipeVersion===4||preset.request.recipeVersion===5||preset.request.recipeVersion===6)&&preset.request.budgetProfileId!==options.budget.profileId)throw new Error('组合质量输入必须与选定预算档位一致。')
 if(preset.request.sceneId!==owned.document.sceneId)throw new Error('组合候选须绑定独立空白身份。')
 const recipeVersion=preset.request.recipeVersion??1,profile=preset.request.preset==='tidalCoast'?(recipeVersion===2||recipeVersion===4||recipeVersion===5||recipeVersion===6?'tidal-v2':'tidal'):'plain'
 const generated=recipeVersion===6?materializeTerrainCompositionV6(owned.document,preset.input,preset.requirements,preset.name,profile,6,options.budget):recipeVersion===5?materializeTerrainCompositionV5(owned.document,preset.input,preset.requirements,preset.name,profile,5,options.budget):materializeTerrainComposition(owned.document,preset.input,preset.requirements,preset.name,profile,recipeVersion,options.budget)
 const {document,plan,executionUsage}=generated
 if(options.plan&&canonicalJson(plan)!==canonicalJson(options.plan))throw new Error('组合Worker结果与完整重放不同。')
 if(options.domainDocument&&canonicalJson(document)!==canonicalJson(options.domainDocument))throw new Error('组合领域文档与完整重放不同。')
 const content=recipeVersion===6?bindTerrainVariantPresentations(createCompositionContent(document,options.runtime)):createCompositionContent(document,options.runtime)
 if(recipeVersion!==6){
  if(content.document.generation?.version!==5)throw new Error('组合候选版本无效。')
  for(const row of Object.values(content.document.generation.compositions))row.outputHash=compositionOutputHash(content.document,row,content.historyIdentity)
 }
 const project=await materializeProject({...owned,schemaVersion:recipeVersion===6?8:4,...content},{runtime:options.runtime,validation:options.validation})
 const usage=options.budget?assertTaskBudget(options.budget,measureTaskBudget(owned.document,project.document,{before:owned,after:project},executionUsage)):undefined
 const targets=options.budget?taskSemanticTargets(owned.document,project.document):[]
 const cost=options.budget?{items:Object.fromEntries(targets.map(target=>[target,1])),total:targets.length,limit:options.budget.semanticTargets}:assertTerrainBudget(owned.document,project.document,{before:owned,after:project})
 return {project,plan,cost,...(usage?{usage}:{}),request:preset.request,input:{sceneId:preset.request.sceneId,seed:preset.request.seed,widthMm:preset.request.widthMm,heightMm:preset.request.heightMm,kind:'mixed' as const},result:{plan},composition:preset.request}
}
export async function prepareCompositionUpgrade(source:EditableProject,options:{runtime:PreparationContext;validation:CompleteValidationOptions}){
 if(source.schemaVersion!==3)throw new Error('请从完整v3创建独立组合副本。')
 const owned=await validateEditableProject(source,options.validation),document=emptyCompositionDocument(owned.document),now=options.runtime.clock.now()
 document.sceneId=options.runtime.ids.nextId();document.title+=' · 地貌组合副本';document.revision=0;document.createdAt=now;document.updatedAt=now
 const historyIdentity={...captureJson(owned.historyIdentity),version:3 as const,lineageId:options.runtime.ids.nextId(),rootSceneId:document.sceneId,terrainTokens:{}}
 return validateEditableProject({...owned,schemaVersion:4,document,historyIdentity},options.validation)
}
