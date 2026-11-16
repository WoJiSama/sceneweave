import type { SceneDocument } from '../model/scene.js'
import type { Attachment, AttachmentSurface } from './contracts.js'
import { canonicalJson } from '../validation/json.js'
import { sha256Text } from '../validation/hash.js'

export type AttachmentScene = SceneDocument & { attachmentSurfaces?: Record<string, AttachmentSurface>; attachments?: Record<string, Attachment> }
export const attachmentHash = (value: unknown): string => sha256Text(canonicalJson(value))
/** Logical faces own continuity; editing measurements does not change birth.
 * Retriangulating an existing walk surface does not create a new logical face. */
export function attachmentSurfaceTopology(surface: AttachmentSurface): unknown {
  const f = surface.feature
  return [surface.owner, [...surface.capabilities].sort(), f.kind,
    f.kind === 'propTop' ? f.polygonLocalMm.length : f.kind === 'wallSide' ? [f.referenceVertexId, f.side] : f.kind === 'rockSourceFace' ? f.sourceSegmentIds : null]
}
export function attachmentTopology(row: Attachment): unknown {
  return [row.mode, row.child, row.mode === 'embed' ? row.surfaceIds : [row.surfaceId], row.anchor.kind,
    row.anchor.kind === 'rockEdgeChain' ? [row.anchor.sourceSegmentIds, row.anchor.cutSide] : row.anchor.kind === 'vertical' ? row.anchor.referenceVertexId : null]
}
