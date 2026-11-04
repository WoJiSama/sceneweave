import { terrainGenerationInputV5Schema, terrainGenerationResultV5Schema, generateTerrainDocumentV5, compositionPresetV5Schema, compositionPresetV5, materializeTerrainCompositionV5 } from './surface-generation.js'
import { terrainGenerationInputV6Schema, terrainGenerationResultV6Schema, generateTerrainDocumentV6,
  compositionPresetV6Schema, compositionPresetV6, materializeTerrainCompositionV6 } from './surface-rule-generation.js'
import { z } from 'zod'
import { createCompositionContent } from '../appearance/graph.js'
import { nativeSceneSchema, sceneDocumentSchema } from '../validation/scene.js'
import { captureJson, canonicalJson, encodeUtf8, freezeJson } from '../validation/json.js'
import { sha256Text } from '../validation/hash.js'
import { TaskBudgetProfileSchema, BudgetUsageSchema, assertTaskBudget, measureTaskBudget, taskSemanticTargets } from '../budget/task-budget.js'
import { terrainGenerationInputV4Schema, terrainGenerationResultV4Schema, generateTerrainDocumentV4 } from './generate.js'
import { compositionPresetV4Schema, compositionPresetV4 } from './composition-presets.js'
import { materializeTerrainComposition } from './composition-materialize.js'
import { composeTerrainDocument } from './compose.js'
import { assertBaseMapBlank, baseMapPalette, compositionPlanSchema, terrainMapOrder } from './base-map.js'
import { bindTerrainVariantPresentations } from '../visual/terrain-variant-presentations.js'

export const BASE_MAP_V3_LIMITS = Object.freeze({ requestBytes:24*1024*1024, resultBytes:32*1024*1024 })
const id=z.string().min(1).max(256).refine(v=>v!=='__proto__'),hash=z.string().regex(/^[a-f0-9]{64}$/),count=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const generationSchema=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('terrain'),input:z.union([terrainGenerationInputV4Schema,terrainGenerationInputV5Schema,terrainGenerationInputV6Schema])}).strict(),
 z.object({kind:z.literal('composition'),input:z.union([compositionPresetV4Schema,compositionPresetV5Schema,compositionPresetV6Schema])}).strict(),
])
const algorithmSchema=z.object({id:z.enum(['terrain-scene','terrain-scene-t3','terrain-compose']),version:z.union([z.literal(1),z.literal(4),z.literal(5),z.literal(6)]),recipeVersion:z.union([z.literal(4),z.literal(5),z.literal(6)])}).strict()
const context={requestId:id,workspaceSceneId:id,checkpoint:count,operationEpoch:count,flowId:id}
const stamp={...context,inputHash:hash,baseHash:hash,paletteHash:hash,profileHash:hash,algorithm:algorithmSchema}
export const BaseMapRequestV3Schema=z.object({protocol:z.literal('sceneweave-base-map'),version:z.literal(3),type:z.literal('generate'),...stamp,profile:TaskBudgetProfileSchema,base:sceneDocumentSchema,generation:generationSchema}).strict()
export type BaseMapRequestV3=z.infer<typeof BaseMapRequestV3Schema>
const resultSchema=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('terrain'),terrain:z.preprocess(terrainMapOrder,z.union([terrainGenerationResultV4Schema,terrainGenerationResultV5Schema,terrainGenerationResultV6Schema]))}).strict(),
 z.object({kind:z.literal('composition'),document:nativeSceneSchema,plan:compositionPlanSchema}).strict(),
])
const domainCost=z.object({items:z.record(z.string().min(1).max(768),z.literal(1)),total:count.max(2048),limit:z.union([z.literal(512),z.literal(1024),z.literal(2048)]),finalAdoptionCostChecked:z.literal(false)}).strict()
export const BaseMapResponseV3Schema=z.object({protocol:z.literal('sceneweave-base-map'),version:z.literal(3),type:z.literal('result'),...stamp,generation:generationSchema,result:resultSchema,domainCost,
 generationBudget:z.object({semanticTargets:z.array(z.string().min(1).max(768)).max(2048),semanticCost:count.max(2048),usage:BudgetUsageSchema}).strict(),resultHash:hash}).strict()
export type BaseMapResponseV3=z.infer<typeof BaseMapResponseV3Schema>
const digest=(value:unknown)=>sha256Text(canonicalJson(value)),same=(a:unknown,b:unknown)=>canonicalJson(a)===canonicalJson(b)
function capture(raw:unknown,maximum:number){const value=captureJson(raw);if(encodeUtf8(canonicalJson(value)).length>maximum)throw new Error('程序底图3传输超过字节预算。');return value}
function algorithm(generation:BaseMapRequestV3['generation']):BaseMapRequestV3['algorithm']{return generation.kind==='composition'?{id:'terrain-compose',version:1,recipeVersion:generation.input.recipeVersion}:{id:['island','coast'].includes(generation.input.kind)?'terrain-scene':'terrain-scene-t3',version:generation.input.algorithmVersion,recipeVersion:generation.input.algorithmVersion}}
export function parseBaseMapRequestV3(raw:unknown):BaseMapRequestV3{
 const value=capture(raw,BASE_MAP_V3_LIMITS.requestBytes),request=BaseMapRequestV3Schema.parse(value)
 if(!same(value,request))throw new Error('程序底图3传输必须已规范化。')
 assertBaseMapBlank(request.base,request.generation)
 if(request.profileHash!==request.profile.profileHash||request.generation.input.budgetProfileId!==request.profile.profileId
  ||request.inputHash!==digest({generation:request.generation,profileHash:request.profileHash})||request.baseHash!==digest(request.base)
  ||request.paletteHash!==digest(baseMapPalette(request.base))||!same(request.algorithm,algorithm(request.generation)))throw new Error('程序底图3预算、输入、素材或算法指纹不同。')
 return freezeJson(request)
}
export function prepareBaseMapRequestV3(raw:unknown):BaseMapRequestV3{
 const schema=z.object({...context,profile:TaskBudgetProfileSchema,base:sceneDocumentSchema,generation:generationSchema}).strict()
 const input=schema.parse(capture(raw,BASE_MAP_V3_LIMITS.requestBytes)),profileHash=input.profile.profileHash
 return parseBaseMapRequestV3({...input,protocol:'sceneweave-base-map',version:3,type:'generate',profileHash,inputHash:digest({generation:input.generation,profileHash}),baseHash:digest(input.base),paletteHash:digest(baseMapPalette(input.base)),algorithm:algorithm(input.generation)})
}
function countContext(prefix:string,now:string){let serial=0;return{ids:{nextId:()=>`${prefix}-${++serial}`},clock:{now:()=>now}}}
function evaluate(request:BaseMapRequestV3):BaseMapResponseV3{
 let result:BaseMapResponseV3['result'],document,execution
 if(request.generation.kind==='terrain'){
  const version=request.generation.input.algorithmVersion
  if(version===6){
   const terrain=generateTerrainDocumentV6(request.base,request.generation.input,`base-map3-${request.inputHash}`)
   result={kind:'terrain',terrain:terrainGenerationResultV6Schema.parse(terrain)}
   document=terrain.document;execution=terrain.executionUsage
  }else{
   const terrain=version===5?generateTerrainDocumentV5(request.base,request.generation.input):generateTerrainDocumentV4(request.base,request.generation.input)
   result={kind:'terrain',terrain:(version===5?terrainGenerationResultV5Schema:terrainGenerationResultV4Schema).parse(terrainMapOrder(terrain))}
   document=composeTerrainDocument(request.base,terrain,`base-map3-${request.inputHash}`,request.profile).document;execution=terrain.executionUsage
  }
 }else{
  const version=request.generation.input.recipeVersion,profileName=request.generation.input.preset==='tidalCoast'?'tidal-v2':'plain'
  if(version===6){
   const preset=compositionPresetV6(request.generation.input)
   const materialized=materializeTerrainCompositionV6(request.base,preset.input,preset.requirements,preset.name,profileName,6,request.profile)
   result={kind:'composition',document:nativeSceneSchema.parse(materialized.document),plan:materialized.plan};document=materialized.document;execution=materialized.executionUsage
  }else{
   const preset=version===5?compositionPresetV5(request.generation.input):compositionPresetV4(request.generation.input)
   const materialized=version===5?materializeTerrainCompositionV5(request.base,preset.input,preset.requirements,preset.name,profileName,5,request.profile):materializeTerrainComposition(request.base,preset.input,preset.requirements,preset.name,profileName,4,request.profile)
   result={kind:'composition',document:nativeSceneSchema.parse(materialized.document),plan:materialized.plan};document=materialized.document;execution=materialized.executionUsage
  }
 }
 const before=createCompositionContent(request.base,countContext('budget3-before',request.base.updatedAt)),after=createCompositionContent(document,countContext('budget3-after',request.base.updatedAt))
 if (request.generation.kind==='terrain'&&request.generation.input.algorithmVersion===6
  || request.generation.kind==='composition'&&request.generation.input.recipeVersion===6) bindTerrainVariantPresentations(after)
 const usage=assertTaskBudget(request.profile,measureTaskBudget(before.document,after.document,{before,after},execution)),targets=taskSemanticTargets(before.document,after.document)
 const cost={items:Object.fromEntries(targets.map(target=>[target,1 as const])),total:targets.length,limit:request.profile.semanticTargets,finalAdoptionCostChecked:false as const}
 const payload={generation:request.generation,result,domainCost:cost,generationBudget:{semanticTargets:targets,semanticCost:targets.length,usage}}
 return freezeJson(BaseMapResponseV3Schema.parse({protocol:request.protocol,version:3,type:'result',requestId:request.requestId,workspaceSceneId:request.workspaceSceneId,checkpoint:request.checkpoint,operationEpoch:request.operationEpoch,flowId:request.flowId,inputHash:request.inputHash,baseHash:request.baseHash,paletteHash:request.paletteHash,profileHash:request.profileHash,algorithm:request.algorithm,...payload,resultHash:digest({profileHash:request.profileHash,flowId:request.flowId,...payload})}))
}
export const executeBaseMapRequestV3=(raw:unknown):BaseMapResponseV3=>evaluate(parseBaseMapRequestV3(raw))
/** A changed receipt is never sufficient: independently replay all geometry and counters. */
export function parseBaseMapResponseV3(input:BaseMapRequestV3,raw:unknown):BaseMapResponseV3{
 const request=parseBaseMapRequestV3(input),owned=capture(raw,BASE_MAP_V3_LIMITS.resultBytes),response=BaseMapResponseV3Schema.parse(owned)
 if(!same(owned,response)||!same(response,evaluate(request)))throw new Error('程序底图3结果、预算向量或完整重放不同。')
 return freezeJson(response)
}
