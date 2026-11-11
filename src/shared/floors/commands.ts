import { z } from 'zod'
import type { AppearanceGraph } from '../model/appearance.js'
import type { Floor, SceneDocument, UserLayer } from '../model/scene.js'
import { geometryIdentityIds } from '../commands/domain.js'
import { bounds, id } from '../validation/primitives.js'
import { canonicalJson, captureJson } from '../validation/json.js'
import { visualEnvironmentSchema } from '../visual/schema.js'
import { resolveFloorOutput, validateFloorSettings } from './output.js'

const name=z.string().min(1).max(80).refine(value=>value.trim()===value,'名称须去除首尾空白且非空')
export const floorCommandSchemas = [
  z.object({type:z.literal('createFloor'),id,name,boundsMm:bounds,outputBoundsMm:bounds,newLayerId:id,layerName:name}).strict(),
  z.object({type:z.literal('renameFloor'),id,name}).strict(),
  z.object({type:z.literal('setFloorOutputBounds'),id,outputBoundsMm:bounds}).strict(),
  z.object({type:z.literal('setFloorEnvironment'),id,environment:visualEnvironmentSchema.nullable()}).strict(),
  z.object({type:z.literal('deleteEmptyFloor'),id}).strict(),
] as const
export type FloorCommand = z.infer<typeof floorCommandSchemas[number]>
export interface FloorCommandOptions { appearance?: AppearanceGraph }
const schema=z.union(floorCommandSchemas),types=new Set(floorCommandSchemas.map(row=>row.shape.type.value))
export const isFloorCommand = (command:{type:string}):command is FloorCommand=>types.has(command.type as FloorCommand['type'])
const same=(a:unknown,b:unknown)=>canonicalJson(a??null)===canonicalJson(b??null)
const contains=(outer:Floor['boundsMm'],inner:Floor['boundsMm'])=>inner.x>=outer.x&&inner.y>=outer.y&&inner.x+inner.width<=outer.x+outer.width&&inner.y+inner.height<=outer.y+outer.height

/** Complete domain records only. The caller owns strict project validation,
 * native structure birth/tombstone advancement, resource closure and adoption. */
function assertFloorUnlocked(scene:SceneDocument,floorId:string):void {
  const locked=new Set<string>(),visited=new Set<object>()
  const visit=(value:unknown):void=>{
    if(!value||typeof value!=='object'||visited.has(value))return
    visited.add(value)
    const row=value as Record<string,unknown>
    if(row.floorId===floorId) {
      const owner=typeof row.id==='string'?row.id:floorId,layerId=typeof row.layerId==='string'?row.layerId:scene.entityLayers[owner]
      if(row.editLocked===true||layerId&&scene.userLayers[layerId]?.editLocked)locked.add(owner)
    }
    Object.values(row).forEach(visit)
  }
  visit(scene)
  if(locked.size)throw new Error(`Floor事务涉及该层锁定实体、图层或视觉依赖：${[...locked].sort().join('、')}。`)
}
function assertEmpty(scene:SceneDocument,floorId:string,appearance:AppearanceGraph|undefined):string[] {
  if(!appearance)throw new Error('删除空Floor必须提供完整外观图以检查图层外观依赖。')
  const layers=Object.values(scene.userLayers).filter(layer=>layer.floorId===floorId).map(layer=>layer.id),layerIds=new Set(layers)
  if(Object.values(scene.entityLayers).some(layerId=>layerIds.has(layerId)))throw new Error('Floor仍有实体图层归属，不能作为空层删除。')
  if(layers.some(layerId=>Object.hasOwn(appearance.layerAdjustments,layerId)))throw new Error('Floor仍有图层外观记录，不能删除。')
  const {floors:_floors,userLayers:_layers,entityLayers:_members,...content}=scene
  const visited=new Set<object>()
  const references=(value:unknown):boolean=>{
    if(!value||typeof value!=='object'||visited.has(value))return false
    visited.add(value)
    const row=value as Record<string,unknown>
    if(row.floorId===floorId||row.kind==='floor'&&row.id===floorId)return true
    return Object.values(row).some(references)
  }
  if(references(content))throw new Error('Floor仍有物理、视觉、注记、生成或聚合依赖，不能作为空层删除。')
  return layers
}

/** Mutate a detached complete draft only. All validation/lock/dependency/budget
 * checks finish before publishing these dictionary changes, so failure does
 * not leave a partially created/deleted Floor even outside Workspace. */
export function applyFloorCommand(scene:SceneDocument,input:FloorCommand,options:FloorCommandOptions={}):{commandCost:number} {
  const command=schema.parse(captureJson(input)),baseline=validateFloorSettings(scene)
  if(baseline.length)throw new Error(`当前Floor设置无效：${baseline.map(issue=>issue.message).join('；')}`)
  const floors:Record<string,Floor>={...scene.floors},layers:Record<string,UserLayer>={...scene.userLayers}
  let commandCost=0
  if(command.type==='createFloor') {
    if(scene.mapMode!=='scene')throw new Error('区域地图仍只支持单Floor，不能创建多层。')
    const occupied=geometryIdentityIds(scene);Object.keys(scene.userLayers).forEach(value=>occupied.add(value))
    if(command.id===command.newLayerId||occupied.has(command.id)||occupied.has(command.newLayerId))throw new Error('新Floor与默认图层必须使用两个未占用的独立ID。')
    const existing=Object.values(scene.floors)
    if(existing.length===1&&!existing[0].outputBoundsMm) {
      const old=existing[0],actual=resolveFloorOutput(scene,old.id).boundsMm
      if(!contains(old.boundsMm,actual))throw new Error('旧全景输出范围超出原Floor世界范围；请先显式设置合法输出范围，不能暗改旧图。')
      assertFloorUnlocked(scene,old.id)
      floors[old.id]={...old,outputBoundsMm:{...actual}};commandCost++
    }
    floors[command.id]={id:command.id,name:command.name,boundsMm:{...command.boundsMm},outputBoundsMm:{...command.outputBoundsMm}}
    layers[command.newLayerId]={id:command.newLayerId,floorId:command.id,name:command.layerName,order:0,editLocked:false}
    commandCost+=2
  } else {
    const floor=scene.floors[command.id]
    if(!floor)throw new Error('目标Floor不存在。')
    assertFloorUnlocked(scene,floor.id)
    switch(command.type) {
      case 'renameFloor':if(floor.name!==command.name){floors[floor.id]={...floor,name:command.name};commandCost++}break
      case 'setFloorOutputBounds':if(!same(floor.outputBoundsMm,command.outputBoundsMm)){floors[floor.id]={...floor,outputBoundsMm:{...command.outputBoundsMm}};commandCost++}break
      case 'setFloorEnvironment':
        if(!same(floor.environment,command.environment)) {
          const changed={...floor}
          if(command.environment===null)delete changed.environment
          else changed.environment={...command.environment}
          floors[floor.id]=changed;commandCost++
        }
        break
      case 'deleteEmptyFloor': {
        if(Object.keys(floors).length<=1)throw new Error('至少须保留一个Floor。')
        const removedLayers=assertEmpty(scene,floor.id,options.appearance)
        delete floors[floor.id];for(const layerId of removedLayers)delete layers[layerId]
        commandCost+=1+removedLayers.length
      }
    }
  }
  if(commandCost>256)throw new Error('Floor实际变更超过compact256预算，未采用。')
  const errors=validateFloorSettings({...scene,floors,userLayers:layers})
  if(errors.length)throw new Error(`Floor候选无效：${errors.map(issue=>issue.message).join('；')}`)
  if(commandCost){scene.floors=floors;scene.userLayers=layers}
  return {commandCost}
}
