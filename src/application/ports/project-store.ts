import type { ProjectBundle, SnapshotSummary } from '../../shared/model/project.js'
import type { LegacySource } from '../../shared/migration/types.js'
import type { ResourceOptions } from '../../shared/ports/resources.js'
import type { HistoryArchive, SnapshotBundle } from '../../shared/project/history.js'

export interface ProjectSummary { sceneId: string; title: string; revision: number; savedAt: string; conversionJobId: string | null }
export interface AutomaticSummary { ownerSceneId: string; revision: number; savedAt: string; contentHash: string }
export interface StorageUsage { resourceBytes: number; documentBytes: number; legacyBytes: number; metadataVersion: number; namedCount: number; protectionCount: number; importedCount: number }
export interface HistoryVersionSummary {
  id: string
  ownerSceneId: string
  revision: number
  savedAt: string
  contentHash: string
  parentId: string | null
  checkpoint: boolean
  automatic: boolean
}
export interface HistoryOverview {
  snapshots: SnapshotSummary[]
  usage: StorageUsage
  legacySources: LegacySource[]
  history: { activeVersionId: string | null; versions: HistoryVersionSummary[] }
}

/** One restoration operation; close in finally. Public snapshot reads stay full-validation reads. */
export interface SnapshotReadSession {
  load(ownerSceneId: string, snapshotId: string, options?: ResourceOptions): Promise<SnapshotBundle | null>
  close(): void
}
export interface CreateSnapshotOptions extends ResourceOptions {
  id?: string
  kind?: 'named' | 'protection'
  expectedRevision: number
  expectedMetadataVersion: number
  sourceSnapshot?: { id: string; contentHash: string }
  readSession?: SnapshotReadSession
}
/** Checked in the very same write transaction as the new current revision. */
export interface ProjectSaveGuard {
  expectedMetadataVersion: number
  protection: { id: string; contentHash: string }
}
export interface SourcePreservationGuard {
  sceneId: string
  revision: number
  contentHash: string
  guard: ProjectSaveGuard
}
export interface SaveProjectOptions extends ResourceOptions {
  guard?: ProjectSaveGuard
  preservation?: SourcePreservationGuard
  historyParentId?: string
  historyParentHash?: string
}

/**
 * Persistence required by an editing session. Implementations own validation,
 * resource integrity and the final atomic revision/protection checks. Optional
 * capabilities preserve the existing limited adapters; callers must continue
 * to reject unsupported operations or use their explicit full-validation path.
 */
export interface ProjectStore {
  save(input: ProjectBundle, expectedRevision: number | null, options?: SaveProjectOptions): Promise<void>
  loadSnapshot(ownerSceneId: string, snapshotId: string, options?: ResourceOptions): Promise<SnapshotBundle | null>
  createSnapshot(input: ProjectBundle, snapshotName: string, options: CreateSnapshotOptions): Promise<SnapshotBundle>
  usage(ownerSceneId: string): Promise<StorageUsage>
  importArchive(input: HistoryArchive, options?: ResourceOptions): Promise<{ project: ProjectBundle; snapshots: SnapshotSummary[] }>
  checkProtection(owner: string, expectedRevision: number, expectedContentHash: string, guard: ProjectSaveGuard, options?: ResourceOptions): Promise<void>
  /** Only privately authenticated snapshots may reuse proofs; all others receive full validation. */
  saveSnapshot?(input: ProjectBundle, expectedRevision: number | null, options?: SaveProjectOptions): Promise<void>
  load?(sceneId: string, options?: ResourceOptions): Promise<ProjectBundle | null>
  historyMetadataVersion?(ownerSceneId: string, options?: ResourceOptions): Promise<number>
  listHistoryVersions?(owner: string): Promise<{ activeVersionId: string | null; versions: HistoryVersionSummary[] }>
  loadHistoryVersion?(owner: string, versionId: string, options?: ResourceOptions): Promise<ProjectBundle | null>
  beginSnapshotRead?(): SnapshotReadSession
}
