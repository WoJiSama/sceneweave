import { migrateSceneV2 } from '../../core/v3/migration'
import { emptyProject as emptyV2, imageProject as imageV2 } from '../v2/test-fixtures'
import type { CompleteProjectV3 } from './types'
export { imageRecord, pixelPng, pngChunk, concatBytes } from '../v2/test-fixtures'

/** Owned v3 fixtures exercise its native IO; no v3 document passes a v2 reader. */
export function emptyProject(): CompleteProjectV3 {
  const source = emptyV2()
  return { document: migrateSceneV2(source.document, { sceneId: 'package-v3', now: '2026-10-21T00:00:00.000Z' }), assets: source.assets, licenses: source.licenses, licenseBindings: source.licenseBindings }
}
export async function imageProject(): Promise<CompleteProjectV3> {
  const source = await imageV2()
  return { document: migrateSceneV2(source.document, { sceneId: 'image-v3', now: '2026-10-21T00:00:00.000Z' }), assets: source.assets, licenses: source.licenses, licenseBindings: source.licenseBindings }
}
