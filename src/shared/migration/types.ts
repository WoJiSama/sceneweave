import type { ProjectBundle } from '../model/project.js'
import type { SnapshotBundle } from '../project/history.js'

export const CONVERTER_VERSION = 'm20-converter-1' as const
export const TARGET_FORMAT = 'sceneweave-complete-project@1' as const
export interface MigrationScope { kind: 'project-family' | 'catalog'; repository: string; sourceSceneId: string | null }
export type PreservationRole = 'current' | 'automatic' | 'named' | 'protection' | 'resource' | 'license'
  | 'resource-binding' | 'history-metadata' | 'legacy-source' | 'legacy-blob'
  | 'catalog-entry' | 'catalog-organization' | 'catalog-metadata'
export interface PreservationRecordInput { role: PreservationRole; recordKey: string; sourceFormat: string; contentHash: string; bytes: Uint8Array }
export interface BackupReceiptSummary { setId: string; sourceFingerprint: string; indexHash: string; volumeHashes: { path: string; sha256: string }[] }
export type ConversionStage = 'captured' | 'backup-verified' | 'prepared' | 'committed' | 'verified' | 'failed' | 'cancelled'
/** Journal IDs are reserved once. Caller timestamps are supplied by the runtime port. */
export interface ConversionJob {
  jobId: string; jobKey: string; sourceRepository: string; scopeId: string; sourceFingerprint: string
  converterVersion: typeof CONVERTER_VERSION; targetFormat: typeof TARGET_FORMAT
  targetSceneId: string; snapshotIds: Record<string, string>
  stage: ConversionStage; jobVersion: number; createdAt: string; updatedAt: string
  backupReceipt: BackupReceiptSummary | null
  sourceContentHashes: Record<string, string>; targetContentHashes: Record<string, string>
  contentHash: string | null; metadataVersion: number | null; failure: string | null
}
export interface LegacyBlob { sha256: string; bytes: Uint8Array }
export interface LegacySource {
  ownerSceneId: string; nodeId: string; previousNodeId: string | null
  sourceSchemaVersion: 1 | 2 | 3 | 4 | 5 | 6
  sourceSceneId: string; sourceRevision: number; sourceHash: string
  migratorVersion: string; migratedAt: string
}
export interface ConvertedFamily {
  current: ProjectBundle; snapshots: SnapshotBundle[]; importedSnapshots: SnapshotBundle[]
  legacySources: LegacySource[]; legacyBlobs: LegacyBlob[]
  sourceContentHashes: Record<string, string>
}
