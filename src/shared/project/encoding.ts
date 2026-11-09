import type { ProjectData } from '../model/project.js'
import { canonicalProjectCoordinates } from '../aggregates/scene-coordinates.js'
import { encodeUtf8, freezeJson } from '../validation/json.js'
import { sha256Bytes } from '../validation/hash.js'

/** Actual canonical bytes have been encoded and hashed by this owner. This is
 * neither domain validation nor evidence about the freshness of a DB record. */
export interface OwnedProjectEncoding {
  readonly canonical: string
  readonly contentHash: string
  readonly byteLength: number
  readonly stored: ProjectData
}
const sources = new WeakMap<OwnedProjectEncoding, ProjectData>()

/** Encode once, owning the complete immutable at-rest JSON representation.
 * Mutable sources are allowed at this boundary, but their reference alone can
 * never certify a later value; consumers must prove immutable source identity
 * independently (for example with an executor-issued transaction receipt). */
export function encodeProjectContentData(project: ProjectData): OwnedProjectEncoding {
  const canonical = canonicalProjectCoordinates(project), bytes = encodeUtf8(canonical)
  const encoding = Object.freeze({ canonical, contentHash: sha256Bytes(bytes), byteLength: bytes.length,
    stored: freezeJson(JSON.parse(canonical) as ProjectData) })
  sources.set(encoding, project)
  return encoding
}

/** Public lookalikes, copied encodings and caller-declared hashes have no
 * registration. Source matching is only identity, never a mutable-data proof. */
export function getOwnedProjectEncoding(input: unknown, source?: ProjectData): OwnedProjectEncoding | undefined {
  if (!input || typeof input !== 'object') return
  const encoding = input as OwnedProjectEncoding, original = sources.get(encoding)
  return original && (source === undefined || original === source) ? encoding : undefined
}
