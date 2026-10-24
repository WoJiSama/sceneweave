import { z } from 'zod'
import { LAYER_ENTITY_COLLECTIONS, type BoundsMm, type SceneDocument } from '../model/scene.js'

export type CanvasBoundsCommand = { type: 'setCanvasBounds'; floorId: string; floorBoundsMm: BoundsMm; exportBoundsMm: BoundsMm }
const id = z.string().min(1).max(256).refine(value => value !== '__proto__')
const integer = z.number().finite().refine(Number.isSafeInteger)
const bounds = z.object({ x: integer, y: integer, width: integer.min(1000).max(200_000), height: integer.min(1000).max(200_000) }).strict().refine(b => Math.max(b.width, b.height) / Math.min(b.width, b.height) <= 20, '范围长宽比不得超过20')
export const canvasBoundsCommandSchema = z.object({ type: z.literal('setCanvasBounds'), floorId: id, floorBoundsMm: bounds, exportBoundsMm: bounds }).strict()

/** Changes existing world/export fields; complete native validation checks every retained entity. */
export function applyCanvasBoundsCommand(scene: SceneDocument, command: CanvasBoundsCommand): { affectedIds: string[]; commandCost: number } {
  const floor = Object.hasOwn(scene.floors, command.floorId) ? scene.floors[command.floorId] : null
  if (!floor) throw new Error('画布所在 Floor 不存在。')
  const entities = LAYER_ENTITY_COLLECTIONS.flatMap(key => Object.values(scene[key])).filter(entity => entity.floorId === floor.id)
  const locked = entities.filter(entity => entity.editLocked || scene.userLayers[scene.entityLayers[entity.id]]?.editLocked)
  if (locked.length) throw new Error(`调整世界范围涉及已锁定实体或图层：${locked.map(entity => entity.id).join('、')}。`)
  floor.boundsMm = { ...command.floorBoundsMm }
  scene.exportBoundsMm = { ...command.exportBoundsMm }
  return { affectedIds: entities.map(entity => entity.id), commandCost: entities.length + 1 }
}
