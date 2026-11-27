import type { PointMm, SceneDocument } from '../../shared/model/scene'
import { wallOpeningAtPoint } from '../../shared/geometry/opening-placement'

/** Resolve only a wall the user actually clicked. Domain preview remains authoritative. */
export function openingAtPoint(scene: SceneDocument, point: PointMm, widthMm: number, hiddenIds: ReadonlySet<string> = new Set()) {
  if (!Number.isSafeInteger(widthMm) || widthMm < 400) throw new Error('门窗净宽至少为 0.4 米。')
  const result = wallOpeningAtPoint(scene, point, widthMm, wall => !hiddenIds.has(wall.id))
  const wall = scene.walls[result.wallId]
  if (wall.editLocked || scene.userLayers[scene.entityLayers[wall.id]]?.editLocked) throw new Error('这面墙或所在图层已锁定。请先在属性或图层中解除编辑锁。')
  return result
}
