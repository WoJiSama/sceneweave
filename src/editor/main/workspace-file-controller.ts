import { toBundle, type EditableProject } from '../../application/workspace/project'
import type { WorkspaceState } from '../../application/workspace/workspace'
import type { ProjectBundle } from '../../shared/model/project'
import type { HistoryArchive } from '../../shared/project/history'
import { CancelledOperationError, checkCancelled } from '../../shared/ports/resources'
import { projectContentHash } from '../../shared/project/validate'
import type { WorkspaceBackupAttempt } from './WorkspaceBackupFeedback'
import { resolvePartitionOutput } from '../../shared/geometry/partitions'

export interface WorkspaceFilePorts {
  workspace: {
    getState(): Pick<WorkspaceState, 'project' | 'status'>
    checkpoint(): number
    assertCheckpoint(checkpoint: number): void
    flush(): Promise<void>
  }
  exportArchive(sceneId: string, snapshotIds: readonly string[], signal?: AbortSignal): Promise<HistoryArchive>
  exportProject(bundle: ProjectBundle, signal?: AbortSignal): Promise<Blob>
  exportHistoryArchive(archive: HistoryArchive, signal?: AbortSignal): Promise<Blob>
  exportPng(bundle: ProjectBundle, options: { audience: 'gm' | 'player'; floorId: string; longEdgePx: number; partitionId?: string }): Promise<Blob>
  download(blob: Blob, name: string): void
}

function waitForBackupSave(save: Promise<void>, signal?: AbortSignal) {
  if (!signal) return save
  // The autosave belongs to the editing session and may finish even if its backup is cancelled.
  let cancel: () => void
  return new Promise<void>((resolve, reject) => {
    cancel = () => reject(new CancelledOperationError())
    signal.addEventListener('abort', cancel, { once: true })
    save.then(resolve, reject)
    if (signal.aborted) cancel()
  }).finally(() => signal.removeEventListener('abort', cancel))
}

export function createWorkspaceFileController(ports: WorkspaceFilePorts) {
  const { workspace } = ports

  function requireBackupScene(project: EditableProject | null, sceneId: string) {
    if (project?.document.sceneId !== sceneId) throw new Error('备份所属工程已切换，请重新选择备份范围。')
    return project
  }

  async function backup(
    { project, sceneId, snapshotIds }: { project: EditableProject; sceneId: string; snapshotIds?: readonly string[] },
    onAttempt: (attempt: WorkspaceBackupAttempt) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    let attemptedProject = project
    let attempt: WorkspaceBackupAttempt
    try {
      const checkpoint = workspace.checkpoint()
      const state = workspace.getState()
      attemptedProject = state.project ?? project
      checkCancelled(signal)
      requireBackupScene(state.project, sceneId)
      const selected = snapshotIds === undefined ? undefined : [...snapshotIds]
      if (selected && selected.length === 0) throw new Error('请先明确勾选需要携带的历史快照。')

      const assertBaseline = () => {
        checkCancelled(signal)
        workspace.assertCheckpoint(checkpoint)
        return requireBackupScene(workspace.getState().project, sceneId)
      }

      const saveBlocked = () => ['error', 'conflict'].includes(workspace.getState().status)
      // History uses a stored baseline. A complete backup can use the exact current project from memory.
      if (selected) await waitForBackupSave(workspace.flush(), signal)
      else if (!saveBlocked()) {
        try { await waitForBackupSave(workspace.flush(), signal) }
        catch (error) {
          assertBaseline()
          if (!saveBlocked()) throw error
        }
      }
      const current = assertBaseline()
      const backedUpFromMemory = saveBlocked()
      const bundle = toBundle(current)
      let file: Blob
      if (selected) {
        const archive = await ports.exportArchive(sceneId, selected, signal)
        assertBaseline()
        if (projectContentHash(archive.current.project) !== projectContentHash(bundle.project)) {
          throw new Error('此浏览器中的已保存版本已变化，尚未下载历史备份。请先下载当前工程备份保留此页编辑，再重新载入并选择历史。')
        }
        file = await ports.exportHistoryArchive(archive, signal)
      } else {
        file = await ports.exportProject(bundle, signal)
      }
      assertBaseline()
      ports.download(file, selected ? 'sceneweave-history.sceneweave' : 'sceneweave-complete.sceneweave')
      attempt = {
        sceneId, baseline: new WeakRef(current), kind: 'download-started',
        detail: selected ? `（含秘密及所选 ${selected.length} 份历史快照）`
          : backedUpFromMemory ? '（含全部资源、许可和秘密，以及当前页面的最新编辑）' : '（含全部资源、许可和秘密）',
      }
    } catch (error) {
      const cancelled = signal?.aborted === true
      attempt = { sceneId: attemptedProject.document.sceneId, baseline: new WeakRef(attemptedProject),
        kind: cancelled ? 'cancelled' : 'failed', detail: cancelled ? '' : error instanceof Error ? error.message : String(error) }
    }
    onAttempt(attempt)
  }

  async function exportImage(
    { project, audience, floorId, partitionId }: { project: EditableProject; audience: 'gm' | 'player'; floorId: string; partitionId?: string },
    onSuccess: (message: string) => void,
  ): Promise<void> {
    const checkpoint = workspace.checkpoint()
    if (workspace.getState().project !== project) throw new Error('导出所属工程已有变化，请重新导出地图。')
    const { document } = project
    const partition = partitionId ? resolvePartitionOutput(document, partitionId, audience) : undefined
    const longEdgePx = partition ? 3840 : 4096
    const blob = await ports.exportPng(toBundle(project), { audience, floorId, longEdgePx, ...(partitionId ? { partitionId } : {}) })
    workspace.assertCheckpoint(checkpoint)
    if (workspace.getState().project?.document.sceneId !== document.sceneId) throw new Error('导出所属工程已切换，请重新导出地图。')
    const range = partition ? `分区 ${partition.region.name}` : `${document.floors[floorId].name}固定范围`
    const message = `${audience === 'gm' ? '主持人' : '玩家'} PNG 已生成 · r${document.revision} · ${range} · 长边 ${longEdgePx} px`
    ports.download(blob, `sceneweave-${audience}-${partition ? 'partition' : 'map'}.png`)
    onSuccess(message)
  }

  return { backup, exportImage }
}
