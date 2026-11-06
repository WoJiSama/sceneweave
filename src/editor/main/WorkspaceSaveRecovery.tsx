import { useId } from 'react'
import type { WorkspaceState } from '../../application/workspace/workspace'

export default function WorkspaceSaveRecovery({ status, error, busy, copyBlockedReason, backupBlockedReason, onRetry, onCopy, onBackup }: {
  status: WorkspaceState['status']
  error: string | null
  busy: boolean
  copyBlockedReason: string | null
  backupBlockedReason: string | null
  onRetry: () => void
  onCopy: () => void
  onBackup: () => void
}) {
  const helpId = useId()
  const quotaExceeded = error?.startsWith('浏览器存储空间不足：')
  if (status !== 'error' && status !== 'conflict') return null
  return <section className="asset-notice workspace-save-recovery" role="alert" aria-label="保存恢复选项">
    <div className="workspace-save-recovery-copy">
      <strong>{status === 'conflict' ? '保存版本发生冲突' : '本机保存未完成'}</strong>
      <p>{status === 'conflict'
        ? '当前编辑仍保留在此页面。请先下载工程备份，或另存副本后继续；另一版本不会被覆盖。'
        : quotaExceeded
          ? '浏览器存储空间不足，当前编辑仍保留在此页面。请先下载工程备份，释放可用空间后再重试；另存副本也需要此浏览器的可用空间。'
          : '当前编辑仍保留在此页面，尚未保存到此浏览器。请先下载工程备份，再重试保存；也可另存副本。'}</p>
      <p className="asset-muted">备份包含已采用的编辑和秘密内容，不包含尚未采用的草稿。</p>
      {error && <details><summary>查看具体原因</summary><p>{error}</p></details>}
      {(copyBlockedReason || backupBlockedReason) && <p id={helpId}>{copyBlockedReason ?? backupBlockedReason}</p>}
    </div>
    <div className="workspace-save-recovery-actions">
      <button className="secondary" disabled={busy || !!backupBlockedReason} aria-describedby={backupBlockedReason ? helpId : undefined} onClick={onBackup}>下载当前工程备份</button>
      {status === 'error' && <button className="secondary" disabled={busy} onClick={onRetry}>重试保存</button>}
      <button className="secondary" disabled={busy || !!copyBlockedReason} aria-describedby={copyBlockedReason ? helpId : undefined} onClick={onCopy}>另存副本</button>
    </div>
  </section>
}
