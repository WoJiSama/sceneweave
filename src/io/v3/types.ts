import type { SceneDocumentV3 } from '../../core/v3/types'
import type { AssetBlobRecord, LicenseBinding, LicenseSubject, LicenseSubjectKind, LicenseTextRecord, MigrationSourceV2 } from '../v2/types'

export type { AssetBlobRecord, LicenseBinding, LicenseSubject, LicenseSubjectKind, LicenseTextRecord }

/** Local-only complete v2 original and the preceding M0 provenance, if any. */
export interface MigrationSourceV3 {
  sourceSchemaVersion: 2
  sourceSceneId: string
  sourceRevision: number
  sourceHash: string
  migratorVersion: string
  migratedAt: string
  original: Blob
  previousSource?: MigrationSourceV2
}

/** Complete strict v3 project; no editor-hidden state or decoded bitmap cache. */
export interface CompleteProjectV3 {
  document: SceneDocumentV3
  assets: Record<string, AssetBlobRecord>
  licenses: Record<string, LicenseTextRecord>
  licenseBindings: LicenseBinding[]
  migrationSource?: MigrationSourceV3
}
