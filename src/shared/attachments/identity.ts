import type { HistoryIdentity } from '../model/history.js'
import type { Issue } from '../model/scene.js'
import { structureIdentityDescriptors } from '../history/structure-identity.js'
import { outdoorIdentityDescriptors } from '../history/identity.js'
import type { Attachment, AttachmentBirthProof, AttachmentOwner, AttachmentSurface } from './contracts.js'
import { attachmentHash, type AttachmentScene } from './topology.js'

export function attachmentOwnerProof(scene: AttachmentScene, identity: HistoryIdentity, ref: AttachmentOwner): AttachmentBirthProof {
  const owner = ref.kind === 'prop' ? scene.props[ref.id] : ref.kind === 'wall' ? scene.walls[ref.id] : ref.kind === 'terrainArea' ? scene.terrainAreas[ref.id] : scene.terrainConnections[ref.id]
  if (!owner) throw new Error(`附着宿主或child已不存在：${ref.id}。`)
  if (ref.kind === 'prop') {
    const token = Object.hasOwn(identity.propTokens, ref.id) ? identity.propTokens[ref.id] : undefined
    if (!token) throw new Error(`宿主或子物件没有真实出生证明：${ref.id}。`)
    return { birthToken: token }
  }
  const structural = ref.kind === 'wall', descriptor = structural ? structureIdentityDescriptors(scene)[ref.id] : outdoorIdentityDescriptors(scene)[ref.id]
  const record = structural ? identity.structureTokens?.[ref.id] : identity.outdoorTokens[ref.id]
  if (!record || !descriptor || record.kind !== ref.kind || record.topologyHash !== descriptor.topologyHash) throw new Error(`宿主或子物件缺少真实当前拓扑证明：${ref.id}。`)
  return { birthToken: record.token, topologyToken: record.topologyToken, topologyHash: record.topologyHash }
}
export function readAttachmentSurfaceProofs(scene: AttachmentScene, identity: HistoryIdentity, surface: AttachmentSurface): AttachmentSurface['proofs'] {
  return { lineageId: identity.lineageId, owner: attachmentOwnerProof(scene, identity, surface.owner) }
}
export function readAttachmentProofs(scene: AttachmentScene, identity: HistoryIdentity, row: Attachment): Attachment['proofs'] {
  const descriptors = structureIdentityDescriptors(scene)
  return { lineageId: identity.lineageId, child: attachmentOwnerProof(scene, identity, row.child),
    surfaces: (row.mode === 'embed' ? row.surfaceIds : [row.surfaceId]).map(surfaceId => {
      const surface = scene.attachmentSurfaces?.[surfaceId], record = identity.structureTokens?.[surfaceId], descriptor = descriptors[surfaceId]
      if (!surface || !record || !descriptor || record.kind !== 'attachmentSurface' || record.topologyHash !== descriptor.topologyHash) throw new Error(`附着面没有真实独立出生/拓扑证明：${surfaceId}。`)
      return { surfaceId, birthToken: record.token, topologyToken: record.topologyToken, topologyHash: record.topologyHash }
    }) }
}
export function validateAttachmentProofs(scene: AttachmentScene, identity: HistoryIdentity): Issue[] {
  const result: Issue[] = []
  for (const surface of Object.values(scene.attachmentSurfaces ?? {})) try {
    if (attachmentHash(surface.proofs) !== attachmentHash(readAttachmentSurfaceProofs(scene, identity, surface))) throw new Error('附着表面宿主已退休、换生或拓扑连续性失效。')
  } catch (error) { result.push({ code: 'ATTACHMENT_SURFACE_PROOF', entityId: surface.id, message: error instanceof Error ? error.message : String(error) }) }
  for (const row of Object.values(scene.attachments ?? {})) try {
    if (attachmentHash(row.proofs) !== attachmentHash(readAttachmentProofs(scene, identity, row))) throw new Error('附着关系的子物件/表面出生拓扑证明已陈旧。')
  } catch (error) { result.push({ code: 'ATTACHMENT_PROOF', entityId: row.id, message: error instanceof Error ? error.message : String(error) }) }
  return result
}
/** Only newly created rows may acquire a witness after the real identity owner
 * has observed the native draft. Existing claims are validated, never refreshed. */
export function syncNewAttachmentProofs(before: AttachmentScene, after: AttachmentScene, identity: HistoryIdentity): void {
  for (const surface of Object.values(after.attachmentSurfaces ?? {})) if (!before.attachmentSurfaces?.[surface.id]) surface.proofs = readAttachmentSurfaceProofs(after, identity, surface)
  for (const row of Object.values(after.attachments ?? {})) if (!before.attachments?.[row.id]) row.proofs = readAttachmentProofs(after, identity, row)
  const issues = validateAttachmentProofs(after, identity)
  if (issues.length) throw new Error(issues.map(issue => issue.message).join('；'))
}
