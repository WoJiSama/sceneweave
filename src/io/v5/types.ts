import type { SceneDocumentV3 } from '../../core/v3/types'
import type { AppearanceGraphV5, HistoryIdentityV5 } from '../../core/v5/types'
import type { AssetBlobRecord, LicenseBinding, LicenseTextRecord } from '../v3/types'
import type { MigrationSourceV4 } from '../v4/types'
export type { AssetBlobRecord, LicenseBinding, LicenseTextRecord }

/** Local-only exact v4 envelope and its complete preceding original chain. */
export interface MigrationSourceV5 {
  sourceSchemaVersion: 4
  sourceSceneId: string
  sourceRevision: number
  sourceHash: string
  migratorVersion: string
  migratedAt: string
  original: Blob
  previousSource?: MigrationSourceV4
}

/** Only this complete envelope is persisted/exported; the effective scene stays strict v3. */
export interface CompleteProjectV5 {
  document: SceneDocumentV3
  historyIdentity: HistoryIdentityV5
  appearance: AppearanceGraphV5
  assets: Record<string, AssetBlobRecord>
  licenses: Record<string, LicenseTextRecord>
  licenseBindings: LicenseBinding[]
  migrationSource?: MigrationSourceV5
}
export interface NamedSnapshotSummaryV5 {
  id: string
  sceneId: string
  lineageId: string
  sourceRevision: number
  name: string
  kind: 'named' | 'protection'
  createdAt: string
  contentHash: string
}
export interface NamedSnapshotV5 extends NamedSnapshotSummaryV5 { project: CompleteProjectV5 }
export interface HistoryArchiveV5 { project: CompleteProjectV5; snapshots: NamedSnapshotV5[] }

export interface AssetImportRequestV5 {
  file: Blob
  name: string
  kind: 'prop' | 'material'
  widthMm: number
  heightMm: number
  footprintWidthMm?: number
  footprintHeightMm?: number
  blocksMovement?: boolean
  blocksSight?: boolean
  tags?: string[]
  licenseText: string
  attribution: string
  canEmbed: true
}
