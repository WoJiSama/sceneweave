import { z } from 'zod'
import { id } from '../validation/primitives.js'
import type { HistoryIdentity } from '../model/history.js'
import type { PreparationContext } from '../ports/runtime.js'
import { geometryIdentityIds } from '../commands/domain.js'
import { furnitureRoom } from '../geometry/furniture-room.js'
import { createPublicVisibility } from '../geometry/visibility.js'
import { attachmentAnchorSchema, attachmentSurfaceIntentSchema, type AttachmentSurface, type PropAttachment } from './contracts.js'
import { attachmentOwnerProof, readAttachmentProofs, readAttachmentSurfaceProofs } from './identity.js'
import { attachmentDependencyIds, assertAttachmentLocks } from './dependencies.js'
import { attachmentOwner, normalizeAttachmentAngle, propAttachmentMaterialized, resolvePropContact, roundAttachmentMm, transformAttachmentPoint, wallAttachmentFrame } from './contact.js'
import { inspectAttachmentSurface } from './validation.js'
import { captureJson } from '../validation/json.js'
import type { AttachmentScene } from './topology.js'

export const attachmentCommandSchemas = [
  z.object({ type: z.literal('addAttachmentSurface'), ...attachmentSurfaceIntentSchema.shape }).strict(),
  z.object({ type: z.literal('removeAttachmentSurface'), id }).strict(),
  z.object({ type: z.literal('bindPropAttachment'), id, childId: id, surfaceId: id, mode: z.enum(['support', 'hang']),
    follow: z.enum(['fixed', 'follow']), anchorState: z.enum(['managed', 'manual']), anchor: attachmentAnchorSchema }).strict(),
  z.object({ type: z.literal('detachPropAttachment'), id }).strict(),
] as const
export type AttachmentCommand = z.infer<typeof attachmentCommandSchemas[number]>
export const isAttachmentCommand = (command: { type: string }): command is AttachmentCommand => attachmentCommandSchemas.some(schema => schema.shape.type.value === command.type)
function fresh(scene: AttachmentScene, identity: HistoryIdentity, id: string): void {
  if (geometryIdentityIds(scene).has(id) || Object.hasOwn(scene.userLayers, id) || Object.values(identity).some(v => v && typeof v === 'object' && Object.hasOwn(v, id))) throw new Error('附着ID已占用或退休，不能复用。')
}
export function attachmentAnchorPose(scene: AttachmentScene, row: PropAttachment) {
  const surface = scene.attachmentSurfaces?.[row.surfaceId], child = scene.props[row.child.id]
  if (!surface || !child) throw new Error('附着宿主面或child已删除，不能暗脱落。')
  if (row.anchor.kind === 'horizontal' && surface.owner.kind === 'prop') {
    const host = scene.props[surface.owner.id]
    if (!host) throw new Error('承托宿主已删除。')
    const expected = transformAttachmentPoint(row.anchor.localMm, host.positionMm, host.rotationDeg)
    return { positionMm: { x: roundAttachmentMm(expected.x), y: roundAttachmentMm(expected.y) },
      rotationDeg: normalizeAttachmentAngle(host.rotationDeg + row.anchor.rotationOffsetDeg) }
  } else if (row.anchor.kind === 'vertical') {
    const frame = wallAttachmentFrame(scene, surface), anchor = row.anchor, n = frame.wall.thicknessMm / 2 + anchor.normalOffsetMm
    return { positionMm: { x: roundAttachmentMm(frame.a.x + frame.u.x * anchor.alongMm + frame.n.x * n), y: roundAttachmentMm(frame.a.y + frame.u.y * anchor.alongMm + frame.n.y * n) },
      rotationDeg: normalizeAttachmentAngle(frame.angleDeg + anchor.rotationOffsetDeg) }
  } else throw new Error('附着模式与锚点种类不相容。')
}

export function placePropAtAttachmentAnchor(scene: AttachmentScene, row: PropAttachment): void {
  Object.assign(scene.props[row.child.id], attachmentAnchorPose(scene, row))
}

/** The selected prop owns its surfaces. Other props survive and keep their
 * world placement when their relation to one of those surfaces is removed. */
export function removePropAttachmentBindings(scene: AttachmentScene, propId: string, context: PreparationContext, identity?: HistoryIdentity): number {
  const surfaces = Object.values(scene.attachmentSurfaces ?? {}).filter(surface => surface.owner.kind === 'prop' && surface.owner.id === propId)
  const owned = new Set(surfaces.map(surface => surface.id))
  let cost = 0
  for (const row of Object.values(scene.attachments ?? {})) {
    if (row.mode !== 'embed' && (row.child.id === propId || owned.has(row.surfaceId))) {
      cost += applyAttachmentCommand(scene, { type: 'detachPropAttachment', id: row.id }, context, identity).commandCost
    }
  }
  for (const surface of surfaces) cost += applyAttachmentCommand(scene, { type: 'removeAttachmentSurface', id: surface.id }, context, identity).commandCost
  return cost
}
/** Native mutator: the caller owns its draft and publishes only after full
 * dependency, identity, budget and scene validation. Public intents carry no proof. */
export function applyAttachmentCommand(scene: AttachmentScene, raw: AttachmentCommand, _context: PreparationContext, identity?: HistoryIdentity): { commandCost: number; dependencyIds: string[]; affectedIds: string[] } {
  const schema = attachmentCommandSchemas.find(s => s.shape.type.value === raw.type)
  if (!schema) throw new Error('未知附着命令。')
  const command = schema.parse(captureJson(raw)) as AttachmentCommand
  if (!identity) throw new Error('附着命令须由完整工程真实历史身份准备。')
  if (command.type === 'addAttachmentSurface') {
    fresh(scene, identity, command.id)
    const { type: _type, ...intent } = command
    const surface = intent as AttachmentSurface
    attachmentOwner(scene, surface.owner); inspectAttachmentSurface(scene, surface)
    surface.proofs = readAttachmentSurfaceProofs(scene, identity, surface)
    const dependencies = attachmentDependencyIds(scene, surface); assertAttachmentLocks(scene, dependencies)
    ;(scene.attachmentSurfaces ??= {})[surface.id] = surface
    return { commandCost: 1, dependencyIds: dependencies, affectedIds: [surface.id] }
  }
  if (command.type === 'removeAttachmentSurface') {
    const surface = scene.attachmentSurfaces?.[command.id]
    if (!surface) throw new Error('待删除附着面不存在。')
    if (Object.values(scene.attachments ?? {}).some(row => (row.mode === 'embed' ? row.surfaceIds : [row.surfaceId]).includes(surface.id))) throw new Error('表面仍有真实附着依赖，须先明确解除。')
    if (surface.feature.kind === 'carvedWalk' && scene.terrainConnections[surface.owner.id]?.carvedStrip) throw new Error('实际路面不能在切削仍存时单独删除。')
    const dependencies = attachmentDependencyIds(scene, surface); assertAttachmentLocks(scene, dependencies)
    delete scene.attachmentSurfaces![surface.id]
    return { commandCost: 1, dependencyIds: dependencies, affectedIds: [surface.id] }
  }
  if (command.type === 'detachPropAttachment') {
    const row = scene.attachments?.[command.id]
    if (!row || row.mode === 'embed') throw new Error('物件附着不存在；岩体切削不能以普通解绑静默回填。')
    const dependencies = attachmentDependencyIds(scene, row); assertAttachmentLocks(scene, dependencies)
    delete scene.attachments![row.id]
    resolvePropContact(scene, row.child.id)
    return { commandCost: 1, dependencyIds: dependencies, affectedIds: [row.id] }
  }
  fresh(scene, identity, command.id)
  const surface = scene.attachmentSurfaces?.[command.surfaceId], child = scene.props[command.childId]
  if (!surface || !child) throw new Error('绑定须明确选择现存子物件与实例表面。')
  if (Object.values(scene.attachments ?? {}).some(row => row.child.id === child.id)) throw new Error('子物件已附着，须先明确解绑。')
  attachmentOwnerProof(scene, identity, { kind: 'prop', id: child.id })
  const row = { id: command.id, mode: command.mode, child: { kind: 'prop' as const, id: child.id }, surfaceId: surface.id, anchor: command.anchor,
    follow: command.follow, managedScope: 'placement' as const, anchorState: command.anchorState } as PropAttachment
  const dependencies = attachmentDependencyIds(scene, row); assertAttachmentLocks(scene, dependencies)
  const host = row.mode === 'support' && row.follow === 'follow' && surface.owner.kind === 'prop' ? scene.props[surface.owner.id] : undefined
  const changeRoom = host && furnitureRoom(host) !== furnitureRoom(child)
  const keepPrivate = changeRoom && !createPublicVisibility(scene).prop(child)
  placePropAtAttachmentAnchor(scene, row)
  ;(scene.attachments ??= {})[row.id] = row
  // Check the original child's audience and physical root before the new
  // relationship can grant it the host's room (e.g. a table at a doorway).
  row.materialized = propAttachmentMaterialized(scene, row)
  if (changeRoom) {
    const roomId = furnitureRoom(host)
    if (roomId) child.roomId = roomId
    else delete child.roomId
    if (keepPrivate) child.visibility = 'gm'
    row.materialized = propAttachmentMaterialized(scene, row)
  }
  row.proofs = readAttachmentProofs(scene, identity, row)
  return { commandCost: 2, dependencyIds: dependencies, affectedIds: [row.id, child.id] }
}
