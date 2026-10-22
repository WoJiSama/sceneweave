import { createAppearanceGraphV5 } from '../../core/v5/graph'
import { createHistoryIdentityV5 } from '../../core/v5/identity'
import { emptyProject as emptyV3, imageProject as imageV3 } from '../v3/test-fixtures'
import { hashValidatedProjectV5 } from './project-file'
import type { CompleteProjectV5, NamedSnapshotV5 } from './types'
export { imageRecord, pixelPng, pngChunk, concatBytes } from '../v3/test-fixtures'

/** Native history envelopes keep v3 scene semantics intact and avoid provenance-only test cost. */
export function emptyProject(): CompleteProjectV5 {
  const source = emptyV3()
  return { document: source.document, assets: source.assets, licenses: source.licenses, licenseBindings: source.licenseBindings,
    historyIdentity: createHistoryIdentityV5(source.document), appearance: createAppearanceGraphV5(source.document) }
}
export async function imageProject(): Promise<CompleteProjectV5> {
  const source = await imageV3()
  return { document: source.document, assets: source.assets, licenses: source.licenses, licenseBindings: source.licenseBindings,
    historyIdentity: createHistoryIdentityV5(source.document), appearance: createAppearanceGraphV5(source.document) }
}
export function revision(project: CompleteProjectV5, value: number): CompleteProjectV5 {
  const copy = structuredClone(project)
  copy.document.revision = value; copy.document.title = `History revision ${value}`
  return copy
}
export async function namedSnapshot(project: CompleteProjectV5, id = 'fixed-snapshot', kind: NamedSnapshotV5['kind'] = 'named'): Promise<NamedSnapshotV5> {
  const captured = structuredClone(project)
  return { id, sceneId: captured.document.sceneId, lineageId: captured.historyIdentity.lineageId, sourceRevision: captured.document.revision,
    name: `Snapshot ${id}`, kind, createdAt: '2026-10-22T00:00:00.000Z', contentHash: await hashValidatedProjectV5(captured), project: captured }
}
