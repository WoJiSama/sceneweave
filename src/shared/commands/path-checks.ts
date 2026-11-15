import {z} from 'zod'
import {pathCheckSchema,PATH_CHECK_LIMITS} from '../geometry/path-check-contracts.js'
import {geometryIdentityIds} from './domain.js'
import {canonicalJson,captureJson} from '../validation/json.js'
import {id} from '../validation/primitives.js'
import type {SceneDocument} from '../model/scene.js'
export const pathCheckCommandSchemas=[
 z.object({type:z.literal('upsertPathCheck'),check:pathCheckSchema}).strict(),
 z.object({type:z.literal('deletePathCheck'),id}).strict(),
]as const
export type PathCheckCommand=z.infer<typeof pathCheckCommandSchemas[number]>
const schema=z.union(pathCheckCommandSchemas)
export const isPathCheckCommand=(command:{type:string}):command is PathCheckCommand=>command.type==='upsertPathCheck'||command.type==='deletePathCheck'
/** Explicit constraint edits form their own transaction category; they cannot
 * silently relax a guard inside the same physical edit. The complete owning
 * transaction validates the resulting declarations before publication. */
export function applyPathCheckCommand(scene:SceneDocument,input:PathCheckCommand):{commandCost:number}{
 const command=schema.parse(captureJson(input)),rows=scene.constraints.pathChecks
 if(command.type==='deletePathCheck'){
  if(!rows.some(r=>r.id===command.id))throw Error('要移除的通路声明不存在。')
  scene.constraints={...scene.constraints,pathChecks:rows.filter(r=>r.id!==command.id)};return{commandCost:1}
 }
 const previous=rows.find(r=>r.id===command.check.id)
 if(!previous&&(geometryIdentityIds(scene).has(command.check.id)||Object.hasOwn(scene.userLayers,command.check.id)))throw Error('通路声明须使用未被其他内容占用的ID。')
 if(!previous&&rows.length>=PATH_CHECK_LIMITS.checks)throw Error(`最多保存${PATH_CHECK_LIMITS.checks}条明确通路声明。`)
 if(previous&&canonicalJson(previous)===canonicalJson(command.check))return{commandCost:0}
 const pathChecks=previous?rows.map(r=>r.id===previous.id?command.check:r):[...rows,command.check]
 scene.constraints={...scene.constraints,pathChecks}
 return{commandCost:1+(command.check.routeHintMm?.length??0)+command.check.assumedOpenDoorIds.length}
}
