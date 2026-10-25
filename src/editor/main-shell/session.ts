import type { EditableProject } from '../../application/workspace/project'

export type WorkspaceRequest =
  | { type: 'new' }
  | { type: 'import' }
  | { type: 'sample'; sample: 'study' | 'island' | 'outpost' | 'calibration' | 'graveyard' | 'volcano' }
  | { type: 'open'; sceneId: string }
  | { type: 'open-project'; project: EditableProject; saved?: boolean; reload?: boolean }
  | { type: 'reload' }

export type WorkspaceSessionSummary = { sceneId: string; title: string; revision: number; status: string }
export interface WorkspaceController {
  leave(): Promise<boolean>
  request(request: WorkspaceRequest): void
}
