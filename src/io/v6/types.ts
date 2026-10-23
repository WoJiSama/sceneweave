import type { SceneDocumentV3 } from '../../core/v3/types'
import type { AppearanceGraphV6, HistoryIdentityV6 } from '../../core/v6/types'
import type { AssetBlobRecord, LicenseBinding, LicenseTextRecord } from '../v3/types'
import type { MigrationSourceV5 } from '../v5/types'
export type { AssetBlobRecord, LicenseBinding, LicenseTextRecord }

/** Local-only exact v5 envelope and its complete preceding original chain. */
export interface MigrationSourceV6 {
  sourceSchemaVersion: 5
  sourceSceneId: string
  sourceRevision: number
  sourceHash: string
  migratorVersion: string
  migratedAt: string
  original: Blob
  previousSource?: MigrationSourceV5
}

/** Only this complete envelope is persisted/exported; the effective scene stays strict v3. */
export interface CompleteProjectV6 {
  document: SceneDocumentV3
  historyIdentity: HistoryIdentityV6
  appearance: AppearanceGraphV6
  assets: Record<string, AssetBlobRecord>
  licenses: Record<string, LicenseTextRecord>
  licenseBindings: LicenseBinding[]
  migrationSource?: MigrationSourceV6
}
export interface NamedSnapshotSummaryV6 {
  id: string
  sceneId: string
  lineageId: string
  sourceRevision: number
  name: string
  kind: 'named' | 'protection'
  createdAt: string
  contentHash: string
}
export interface NamedSnapshotV6 extends NamedSnapshotSummaryV6 { project: CompleteProjectV6 }
export interface HistoryArchiveV6 { project: CompleteProjectV6; snapshots: NamedSnapshotV6[] }

export interface AssetImportRequestV6 {
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
