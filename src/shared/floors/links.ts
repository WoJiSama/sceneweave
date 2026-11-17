import { z } from 'zod'
import type { Floor, PointMm, SceneDocument } from '../model/scene.js'
import { id, point } from '../validation/primitives.js'

/** Editor navigation metadata. A link never grants physical passage or player knowledge. */
export const floorLinkSchema = z.object({
  id, name: z.string().min(1).max(80).refine(value => value.trim() === value, '入口名称须去除首尾空白'), targetFloorId: id, fromMm: point, toMm: point,
}).strict()
export type FloorLink = z.infer<typeof floorLinkSchema>
export const floorLinksSchema = z.array(floorLinkSchema).max(64)
export const floorContainsPoint = (floor: Floor, p: PointMm) => p.x >= floor.boundsMm.x && p.y >= floor.boundsMm.y
  && p.x <= floor.boundsMm.x + floor.boundsMm.width && p.y <= floor.boundsMm.y + floor.boundsMm.height

export function floorEntrances(scene: SceneDocument, floorId: string) {
  return Object.values(scene.floors).flatMap(owner => (owner.links ?? []).flatMap(link =>
    owner.id === floorId ? [{ ownerFloorId: owner.id, link, positionMm: link.fromMm, targetFloorId: link.targetFloorId, targetMm: link.toMm }]
      : link.targetFloorId === floorId ? [{ ownerFloorId: owner.id, link, positionMm: link.toMm, targetFloorId: owner.id, targetMm: link.fromMm }] : []))
}
