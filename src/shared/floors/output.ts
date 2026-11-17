import type { BoundsMm, Issue, SceneDocument } from '../model/scene.js'
import type { VisualEnvironment } from '../visual/types.js'
import { visualEnvironmentSchema } from '../visual/schema.js'
import { visualBase } from '../visual/base.js'
import { floorContainsPoint } from './links.js'

export interface FloorOutput {
  floorId: string
  boundsMm: BoundsMm
  environment: VisualEnvironment
}
const validBounds = (bounds: BoundsMm): boolean => !!bounds && typeof bounds==='object' && [bounds.x,bounds.y,bounds.width,bounds.height,bounds.x+bounds.width,bounds.y+bounds.height].every(Number.isSafeInteger)
  && bounds.width>0 && bounds.height>0
const contains = (outer: BoundsMm, inner: BoundsMm): boolean => inner.x>=outer.x && inner.y>=outer.y
  && inner.x+inner.width<=outer.x+outer.width && inner.y+inner.height<=outer.y+outer.height

/** Domain settings only, after strict shape capture. This neither validates a
 * sliced scene nor grants a geometry/resource/snapshot certificate. */
export function validateFloorSettings(scene: SceneDocument): Issue[] {
  const errors: Issue[] = [], floors=Object.values(scene.floors), multiple=floors.length>1
  const error=(code:string,message:string,entityId?:string)=>errors.push({code,message,...(entityId?{entityId}:{})})
  if(!floors.length || scene.mapMode==='regional' && multiple) error('UNSUPPORTED_FLOORS','独立场景至少须有一个Floor；区域地图仍只支持单Floor。')
  for(const floor of floors) {
    if(!validBounds(floor.boundsMm)) error('FLOOR_WORLD_BOUNDS','Floor世界边界须为正尺寸、安全整数毫米及安全端点。',floor.id)
    if(multiple && !floor.outputBoundsMm) error('FLOOR_OUTPUT_REQUIRED','多Floor的每层须明确保存固定输出范围，不能回退全景范围。',floor.id)
    if(floor.outputBoundsMm!==undefined && (!validBounds(floor.outputBoundsMm)||!validBounds(floor.boundsMm)||!contains(floor.boundsMm,floor.outputBoundsMm))) {
      error('FLOOR_OUTPUT_BOUNDS','Floor固定输出范围须为正尺寸、安全整数端点且完整位于自身世界边界内。',floor.id)
    }
    if(floor.environment!==undefined && !visualEnvironmentSchema.safeParse(floor.environment).success) error('FLOOR_ENVIRONMENT','Floor环境覆盖须为完整且严格的六字段环境值。',floor.id)
    const ids = new Set<string>()
    for (const link of floor.links ?? []) {
      const target = scene.floors[link.targetFloorId]
      if (ids.has(link.id) || !target || target.id === floor.id || !floorContainsPoint(floor, link.fromMm) || !floorContainsPoint(target, link.toMm))
        error('FLOOR_LINK', '入口须使用层内唯一ID、两个不同且现存的楼层及各自边界内的整数毫米坐标。', floor.id)
      ids.add(link.id)
    }
  }
  if (floors.reduce((sum, floor) => sum + (floor.links?.length ?? 0), 0) > 256) error('FLOOR_LINK_BUDGET', '跨层入口总数超过256。')
  return errors
}

/** Resolve only from a complete scene. The owner must first validate that whole
 * scene/project, including every Floor and actual resources. No first-Floor or
 * multi-Floor global-bounds fallback is permitted. */
export function resolveFloorOutput(scene: SceneDocument, floorId: string): FloorOutput {
  if(typeof floorId!=='string'||!Object.hasOwn(scene.floors,floorId)) throw new Error('必须明确选择现存目标Floor。')
  const errors=validateFloorSettings(scene)
  if(errors.length) throw new Error(`Floor输出设置无效：${errors.map(issue=>`${issue.entityId??''}:${issue.message}`).join('；')}`)
  const floor=scene.floors[floorId],boundsMm=floor.outputBoundsMm??scene.exportBoundsMm
  if(!validBounds(boundsMm)) throw new Error('Floor输出范围须为正尺寸、安全整数毫米及安全端点。')
  const environment=visualEnvironmentSchema.safeParse(floor.environment??visualBase(scene)?.environment)
  if(!environment.success) throw new Error('Floor输出需要完整且严格的有效环境。')
  return {floorId,boundsMm:{...boundsMm},environment:{...environment.data}}
}
