import type { AssetRef } from '../../core/types'
import type { SceneDocumentV2 } from '../../core/v2/types'

export type LicenseSubjectKind = 'asset' | 'material' | 'propDefinition' | 'prefabDefinition' | 'styleTheme'
export interface LicenseSubject {
  subjectKind: LicenseSubjectKind
  subjectId: string
  licenseRef: string
}
export interface LicenseBinding extends LicenseSubject {
  licensePath: string
  embedding: 'allowed'
}
export interface AssetBlobRecord {
  sha256: string
  blob: Blob
  mimeType: AssetRef['mimeType']
  sizeBytes: number
  pixelWidth: number
  pixelHeight: number
}
export interface LicenseTextRecord { sha256: string; text: string }
export interface MigrationSourceV2 {
  sourceSchemaVersion: 1
  sourceSceneId: string
  sourceRevision: number
  sourceHash: string
  migratorVersion: string
  migratedAt: string
  original: Blob
}
/** A complete editable project. Decoded bitmaps are disposable, not persistence. */
export interface CompleteProjectV2 {
  document: SceneDocumentV2
  assets: Record<string, AssetBlobRecord>
  licenses: Record<string, LicenseTextRecord>
  licenseBindings: LicenseBinding[]
  migrationSource?: MigrationSourceV2
}
