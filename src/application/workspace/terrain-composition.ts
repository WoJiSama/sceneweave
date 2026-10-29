import type { EditableProject } from './project.js'
import { captureEditableDraft, validateEditableProject } from './project.js'
import type { CompleteValidationOptions } from '../../shared/ports/resources.js'
import { checkCancelled } from '../../shared/ports/resources.js'
import type { PreparationContext } from '../../shared/ports/runtime.js'
import { createHistoryIdentity } from '../../shared/history/identity.js'
import { createCompositionContent } from '../../shared/appearance/graph.js'
import { captureJson, canonicalJson } from '../../shared/validation/json.js'
import { compositionPreset } from '../../shared/terrain-generation/composition-presets.js'
import { emptyCompositionDocument, materializeTerrainComposition } from '../../shared/terrain-generation/composition-materialize.js'
import { compositionOutputHash } from '../../shared/terrain-generation/composition-integrity.js'
import { assertTerrainBudget } from '../../shared/terrain-generation/cost.js'
import { materializeProject } from './prepare.js'
import type { TerrainCompositionPlan } from '../../shared/terrain-generation/composition-field.js'
import type { SceneDocument } from '../../shared/model/scene.js'

export async function prepareTerrainComposition(base:EditableProject,raw:unknown,options:{runtime:PreparationContext;validation:CompleteValidationOptions;plan?:TerrainCompositionPlan;domainDocument?:SceneDocument}){
 const owned=await validateEditableProject(captureEditableDraft(base),options.validation)
 checkCancelled(options.validation.signal)
 const preset=compositionPreset(raw)
 if(preset.request.sceneId!==owned.document.sceneId)throw new Error('组合候选须绑定独立空白身份。')
 const recipeVersion=preset.request.recipeVersion??1,profile=preset.request.preset==='tidalCoast'?(recipeVersion===2?'tidal-v2':'tidal'):'plain'
 const {document,plan}=materializeTerrainComposition(owned.document,preset.input,preset.requirements,preset.name,profile,recipeVersion)
 if(options.plan&&canonicalJson(plan)!==canonicalJson(options.plan))throw new Error('组合Worker结果与完整重放不同。')
 if(options.domainDocument&&canonicalJson(document)!==canonicalJson(options.domainDocument))throw new Error('组合领域文档与完整重放不同。')
 const content=createCompositionContent(document,options.runtime)
 if(content.document.generation?.version!==5)throw new Error('组合候选版本无效。')
 for(const row of Object.values(content.document.generation.compositions))row.outputHash=compositionOutputHash(content.document,row,content.historyIdentity)
 const project=await materializeProject({...owned,schemaVersion:4,...content},{runtime:options.runtime,validation:options.validation})
 const cost=assertTerrainBudget(owned.document,project.document,{before:owned,after:project})
 return {project,plan,cost,request:preset.request,input:{sceneId:preset.request.sceneId,seed:preset.request.seed,widthMm:preset.request.widthMm,heightMm:preset.request.heightMm,kind:'mixed' as const},result:{plan},composition:preset.request}
}
export async function prepareCompositionUpgrade(source:EditableProject,options:{runtime:PreparationContext;validation:CompleteValidationOptions}){
 if(source.schemaVersion!==3)throw new Error('请从完整v3创建独立组合副本。')
 const owned=await validateEditableProject(source,options.validation),document=emptyCompositionDocument(owned.document),now=options.runtime.clock.now()
 document.sceneId=options.runtime.ids.nextId();document.title+=' · 地貌组合副本';document.revision=0;document.createdAt=now;document.updatedAt=now
 const historyIdentity={...captureJson(owned.historyIdentity),version:3 as const,lineageId:options.runtime.ids.nextId(),rootSceneId:document.sceneId,terrainTokens:{}}
 return validateEditableProject({...owned,schemaVersion:4,document,historyIdentity},options.validation)
}
