import { createHistoryIdentityV4 } from '../../core/v4/identity'
import { emptyProject as emptyV3, imageProject as imageV3 } from '../v3/test-fixtures'
import { hashValidatedProjectV4 } from './project-file'
import type { CompleteProjectV4, NamedSnapshotV4 } from './types'
export { imageRecord, pixelPng, pngChunk, concatBytes } from '../v3/test-fixtures'

/** Native history envelopes keep v3 scene semantics intact and avoid provenance-only test cost. */
export function emptyProject(): CompleteProjectV4 {
  const source = emptyV3()
  return { document: source.document, assets: source.assets, licenses: source.licenses, licenseBindings: source.licenseBindings,
    historyIdentity: createHistoryIdentityV4(source.document) }
}
export async function imageProject(): Promise<CompleteProjectV4> {
  const source = await imageV3()
  return { document: source.document, assets: source.assets, licenses: source.licenses, licenseBindings: source.licenseBindings,
    historyIdentity: createHistoryIdentityV4(source.document) }
}
export function revision(project: CompleteProjectV4, value: number): CompleteProjectV4 {
  const copy = structuredClone(project)
  copy.document.revision = value; copy.document.title = `History revision ${value}`
  return copy
}
export async function namedSnapshot(project: CompleteProjectV4, id = 'fixed-snapshot', kind: NamedSnapshotV4['kind'] = 'named'): Promise<NamedSnapshotV4> {
  const captured = structuredClone(project)
  return { id, sceneId: captured.document.sceneId, lineageId: captured.historyIdentity.lineageId, sourceRevision: captured.document.revision,
    name: `Snapshot ${id}`, kind, createdAt: '2026-10-22T00:00:00.000Z', contentHash: await hashValidatedProjectV4(captured), project: captured }
}
