import { z } from 'zod'
import type { HistoryIdentity } from '../model/history.js'
import type { SceneDocument } from '../model/scene.js'
import { id, nonnegative, positive } from '../validation/primitives.js'
import { createPathAttachmentPlan } from './state.js'

export const pathAttachmentCommandSchemas = [
  z.object({ type: z.literal('bindPathAttachment'), id, pathId: id, openingId: id, end: z.enum(['start', 'end']), leadLengthMm: positive, maxDisplacementMm: nonnegative }).strict(),
  z.object({ type: z.literal('detachPathAttachment'), id }).strict(),
] as const
export type PathAttachmentCommand = z.infer<typeof pathAttachmentCommandSchemas[number]>
export const isPathAttachmentCommand = (command: { type: string }): command is PathAttachmentCommand => command.type === 'bindPathAttachment' || command.type === 'detachPathAttachment'

/** Finite native mutation. Binding owns both geometry and proof fields; callers
 * supply only intent and cannot insert a serialized witness as permission. */
export function applyPathAttachmentCommand(scene: SceneDocument, command: PathAttachmentCommand, identity?: HistoryIdentity): { commandCost: number; dependencyIds: string[] } {
  if (command.type === 'bindPathAttachment') {
    if (!identity) throw new Error('门路绑定必须从完整工程的当前历史身份准备。')
    const { type: _type, ...request } = command
    const plan = createPathAttachmentPlan({ document: scene, historyIdentity: identity }, request)
    scene.paths[plan.path.id] = plan.path
    ;(scene.pathAttachments ??= {})[plan.attachment.id] = plan.attachment
    return { commandCost: 2, dependencyIds: plan.dependencyIds }
  }
  const row = scene.pathAttachments?.[command.id]
  if (!row) throw new Error('门路附着不存在。')
  if (row.editLocked) throw new Error('门路附着已锁定，请先单独解锁。')
  const dependencies = new Set([row.pathId, row.openingId, row.anchor.wallId, row.anchor.roomId, ...row.anchor.wallVertexIds, ...row.anchor.roomBoundaryVertexIds])
  let changed = true
  while (changed) {
    changed = false
    for (const note of Object.values(scene.notes)) if (note.anchor.type === 'entity' && dependencies.has(note.anchor.entityId) && !dependencies.has(note.id)) { dependencies.add(note.id); changed = true }
  }
  const entities = new Map([...Object.values(scene.paths), ...Object.values(scene.openings), ...Object.values(scene.walls), ...Object.values(scene.rooms), ...Object.values(scene.vertices), ...Object.values(scene.notes)].map(entity => [entity.id, entity]))
  for (const entityId of dependencies) if (entities.get(entityId)?.editLocked || scene.userLayers[scene.entityLayers[entityId]]?.editLocked) throw new Error(`解除附着涉及锁定实体或图层：${entityId}。`)
  delete scene.pathAttachments![command.id]
  return { commandCost: 1, dependencyIds: [...dependencies] }
}
