import { effectiveEditLocked } from '../commands/layers.js'
import { polygonInside, propFootprint } from '../geometry/geometry.js'
import type { PointMm, Prop, SceneDocument, SurfaceRef } from '../model/scene.js'
import { attachmentLocalPoint, normalizeAttachmentAngle, resolvePropContact, roundAttachmentMm, transformAttachmentPoint } from './contact.js'
import { createPublicVisibility } from '../geometry/visibility.js'
import type { AttachmentCommand } from './commands.js'

export function propTopSnap(scene: SceneDocument, child: Prop, center: PointMm, excluded: ReadonlySet<string>, support?: SurfaceRef) {
  const childPresent = Object.hasOwn(scene.props, child.id)
  if (childPresent && (effectiveEditLocked(scene, child.id) || Object.values(scene.attachments ?? {}).some(row => row.child.id === child.id))) return
  const footprint = propFootprint({ ...child, positionMm: center })
  const visible = createPublicVisibility(scene)
  const publicChild = (!childPresent ? child.visibility === 'public' : visible.prop(child)) && (!support || visible.surface(support))
  const root = support ?? (childPresent ? child.supportRef : undefined)
  let best: { surfaceId: string; polygon: PointMm[]; contactMm: number; positionMm: PointMm; supportRef: SurfaceRef;
    anchor: Extract<Extract<AttachmentCommand, { type: 'bindPropAttachment' }>['anchor'], { kind: 'horizontal' }> } | undefined
  for (const surface of Object.values(scene.attachmentSurfaces ?? {})) {
    if (surface.feature.kind !== 'propTop' || !surface.capabilities.includes('support') || surface.owner.kind !== 'prop') continue
    const host = scene.props[surface.owner.id]
    if (!host || host.id === child.id || host.floorId !== child.floorId || excluded.has(host.id) || publicChild && !visible.prop(host)) continue
    if (root && (host.supportRef.kind !== root.kind || host.supportRef.id !== root.id)) {
      const ground = root.kind === 'room' && scene.rooms[root.id]?.supportRef
      if (!ground || !visible.surface(root) || host.supportRef.kind !== ground.kind || host.supportRef.id !== ground.id) continue
    }
    const polygon = surface.feature.polygonLocalMm.map(p => transformAttachmentPoint(p, host.positionMm, host.rotationDeg))
    if (!polygonInside(footprint, polygon) || effectiveEditLocked(scene, host.id)) continue
    const localMm = attachmentLocalPoint(center, host), point = transformAttachmentPoint(localMm, host.positionMm, host.rotationDeg)
    const positionMm = { x: roundAttachmentMm(point.x), y: roundAttachmentMm(point.y) }
    if ((center.x !== positionMm.x || center.y !== positionMm.y) && !polygonInside(propFootprint({ ...child, positionMm }), polygon)) continue
    let contact: ReturnType<typeof resolvePropContact>
    try { contact = resolvePropContact(scene, host.id, new Set([child.id])) }
    catch { continue }
    const contactMm = contact.contactElevationMm + surface.feature.heightLocalMm
    if (best && best.contactMm >= contactMm) continue
    best = { surfaceId: surface.id, polygon, contactMm, positionMm, supportRef: contact.rootSupportRef, anchor: { kind: 'horizontal', localMm, heightOffsetMm: 0,
      rotationOffsetDeg: normalizeAttachmentAngle(child.rotationDeg - host.rotationDeg) } }
  }
  return best
}

export function bindPropTopSnap(snap: NonNullable<ReturnType<typeof propTopSnap>>, childId: string, id: string): AttachmentCommand {
  return { type: 'bindPropAttachment', id, childId, surfaceId: snap.surfaceId, mode: 'support', follow: 'follow', anchorState: 'manual', anchor: snap.anchor }
}
