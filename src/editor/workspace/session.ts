import type { ProjectReference } from './project-registry'

export type WorkspaceRequest =
  | { type: 'new' }
  | { type: 'import' }
  | { type: 'sample'; sample: 'study' | 'island' | 'outpost' | 'calibration' | 'graveyard' | 'volcano' }
  | { type: 'open'; reference: ProjectReference }
  | { type: 'reload' }

export type WorkspaceSessionSummary = {
  sceneId: string
  title: string
  revision: number
  status: string
}

export interface WorkspaceController {
  /** Passive Home keeps the mounted session; legacy closes it only after a successful save. */
  leave(destination: 'home' | 'legacy'): Promise<boolean>
  request(request: WorkspaceRequest): void
}
