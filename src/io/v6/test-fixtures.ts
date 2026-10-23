import { createAppearanceGraphV6 } from '../../core/v6/graph'
import { createHistoryIdentityV6 } from '../../core/v6/identity'
import { createCompositionContentV6 } from '../../core/v6/graph'
import { scatterLayerSceneV3 } from '../../core/v3/test-fixtures'
import { sha256Bytes } from '../v3/resources'
import { emptyProject as emptyV3, imageProject as imageV3 } from '../v3/test-fixtures'
import { hashValidatedProjectV6 } from './project-file'
import type { CompleteProjectV6, NamedSnapshotV6 } from './types'
export { imageRecord, pixelPng, pngChunk, concatBytes } from '../v3/test-fixtures'

/** Native history envelopes keep v3 scene semantics intact and avoid provenance-only test cost. */
export function emptyProject(): CompleteProjectV6 {
  const source = emptyV3()
  return { document: source.document, assets: source.assets, licenses: source.licenses, licenseBindings: source.licenseBindings,
    historyIdentity: createHistoryIdentityV6(source.document), appearance: createAppearanceGraphV6(source.document) }
}
export async function imageProject(): Promise<CompleteProjectV6> {
  const source = await imageV3()
  return { document: source.document, assets: source.assets, licenses: source.licenses, licenseBindings: source.licenseBindings,
    historyIdentity: createHistoryIdentityV6(source.document), appearance: createAppearanceGraphV6(source.document) }
}
/** Actual licensed symbol palette and durable outdoor records; no image decoder double needed. */
export async function outdoorProject(memberCount = 2): Promise<CompleteProjectV6> {
  const document = scatterLayerSceneV3(memberCount)
  document.assets = {}; document.propDefinitions = { 'scatter-definition': document.propDefinitions['scatter-definition'] }
  document.scatterGroups.scatter.visibility = 'public'
  const text = 'MIT\nCopyright Sceneweave test fixture. Permission is hereby granted to use, copy, modify and distribute this original test symbol.', sha256 = await sha256Bytes(new TextEncoder().encode(text))
  return { ...createCompositionContentV6(document), assets: {}, licenses: { [sha256]: { sha256, text } },
    licenseBindings: [{ subjectKind: 'propDefinition', subjectId: 'scatter-definition', licenseRef: 'MIT', licensePath: `licenses/${sha256}.txt`, embedding: 'allowed' }] }
}
export function revision(project: CompleteProjectV6, value: number): CompleteProjectV6 {
  const copy = structuredClone(project)
  copy.document.revision = value; copy.document.title = `History revision ${value}`
  return copy
}
export async function namedSnapshot(project: CompleteProjectV6, id = 'fixed-snapshot', kind: NamedSnapshotV6['kind'] = 'named'): Promise<NamedSnapshotV6> {
  const captured = structuredClone(project)
  return { id, sceneId: captured.document.sceneId, lineageId: captured.historyIdentity.lineageId, sourceRevision: captured.document.revision,
    name: `Snapshot ${id}`, kind, createdAt: '2026-10-22T00:00:00.000Z', contentHash: await hashValidatedProjectV6(captured), project: captured }
}
