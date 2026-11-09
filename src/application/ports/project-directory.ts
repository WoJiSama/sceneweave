import type { SnapshotSummary } from '../../shared/model/project.js'
import type { HistoryVersionSummary, ProjectSummary } from './project-store.js'

/** Navigation data never certifies unread project, history or resource bytes. */
export interface DirectoryIssue { key: string; message: string }
export interface ProjectDirectoryEntry {
  sceneId: string
  summary: ProjectSummary | null
  issue: string | null
  contentStatus: 'not-checked'
}
export interface ProjectDirectoryCursor { savedAt: string; sceneId: string }
export interface ProjectDirectoryPage {
  entries: ProjectDirectoryEntry[]
  next: ProjectDirectoryCursor | null
  total: number
}
export interface ProjectDirectoryQuery { limit?: number; after?: ProjectDirectoryCursor; query?: string }
export interface HistoryDirectory {
  contentStatus: 'not-checked'
  metadataVersion: number
  historyState: 'ready' | 'legacy'
  snapshots: SnapshotSummary[]
  history: { activeVersionId: string | null; versions: HistoryVersionSummary[] }
  issues: DirectoryIssue[]
}
export interface ProjectDirectoryStore {
  projectDirectory(query?: ProjectDirectoryQuery): Promise<ProjectDirectoryPage>
  historyDirectory(ownerSceneId: string): Promise<HistoryDirectory>
}
