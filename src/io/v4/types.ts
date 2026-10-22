import type { SceneDocumentV3 } from '../../core/v3/types'
import type { HistoryIdentityV4 } from '../../core/v4/types'
import type { AssetBlobRecord, LicenseBinding, LicenseTextRecord, MigrationSourceV3 } from '../v3/types'
export type { AssetBlobRecord, LicenseBinding, LicenseTextRecord }

export interface MigrationSourceV4 {
  sourceSchemaVersion: 3
  sourceSceneId: string
  sourceRevision: number
  sourceHash: string
  migratorVersion: string
  migratedAt: string
  original: Blob
  previousSource?: MigrationSourceV3
}
export interface CompleteProjectV4 {
  document: SceneDocumentV3
  historyIdentity: HistoryIdentityV4
  assets: Record<string, AssetBlobRecord>
  licenses: Record<string, LicenseTextRecord>
  licenseBindings: LicenseBinding[]
  migrationSource?: MigrationSourceV4
}
export interface NamedSnapshotSummaryV4 {
  id: string
  sceneId: string
  lineageId: string
  sourceRevision: number
  name: string
  kind: 'named' | 'protection'
  createdAt: string
  contentHash: string
}
export interface NamedSnapshotV4 extends NamedSnapshotSummaryV4 { project: CompleteProjectV4 }
export interface HistoryArchiveV4 { project: CompleteProjectV4; snapshots: NamedSnapshotV4[] }
