import type { EditableProject } from '../../application/workspace/project'

export type WorkspaceBackupAttempt = {
  sceneId: string
  baseline: WeakRef<EditableProject>
  kind: 'download-started' | 'failed' | 'cancelled'
  detail: string
}

/** Immutable identity binds the export; a weak reference avoids retaining an old resource closure. */
export default function WorkspaceBackupFeedback({ project, attempt }: {
  project: EditableProject | null
  attempt: WorkspaceBackupAttempt | null
}) {
  if (!project || !attempt || project.document.sceneId !== attempt.sceneId) return null
  const changed = project !== attempt.baseline.deref()
  return <p className="workspace-backup-feedback" role="status" aria-label="工程备份状态" data-state={attempt.kind === 'download-started' ? changed ? 'stale' : 'started' : attempt.kind}>
    {attempt.kind === 'cancelled'
      ? <strong>已取消工程备份，尚未发起本次文件下载。</strong>
      : attempt.kind === 'failed'
      ? <><strong>备份生成失败，尚未发起本次文件下载。</strong>{attempt.detail}{changed ? ' 工程随后已有变化，请重新下载当前版本。' : ''}</>
      : changed
        ? <><strong>工程在发起下载后已有变化。</strong>上次下载不包含后续修改，请重新下载当前版本。</>
        : <><strong>已发起此工程的文件下载{attempt.detail}。</strong>请在浏览器下载列表确认文件。页面无法确认文件已写入磁盘。</>}
  </p>
}
