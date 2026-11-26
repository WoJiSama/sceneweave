import { useId, useState } from 'react'
import type { WorkspaceState } from '../../application/workspace/workspace'
import { onWorkspaceDisclosureEscape } from './WorkspaceHelp'
import { ProjectStorageDialog } from '../main-shell/ProjectStorageDialog'

export default function WorkspaceSaveRecovery({ status, error, busy, copyBlockedReason, backupBlockedReason, onRetry, onCopy, onBackup, sceneId, storageLow }: {
  status: WorkspaceState['status']
  error: string | null
  busy: boolean
  copyBlockedReason: string | null
  backupBlockedReason: string | null
  onRetry: () => void
  onCopy: () => void
  onBackup: () => void
  sceneId?: string
  storageLow?: boolean
}) {
  const helpId = useId()
  const [storage, setStorage] = useState(false)
  const copyHelpId = `${helpId}-copy`, backupHelpId = `${helpId}-backup`, backupContentsId = `${helpId}-contents`
  const quotaExceeded = /^(浏览器存储空间不足|整个新工程库超过资源或文档累计预算)/.test(error ?? '')
  const manager = storage && <ProjectStorageDialog activeSceneId={sceneId} onClose={() => setStorage(false)}/>
  if (status !== 'error' && status !== 'conflict') return <>{storageLow && <div className="asset-notice project-storage-actions" role="status">
    <span>工程库接近上限，请下载备份并整理本地存储。</span>
    <button className="secondary small" type="button" onClick={() => setStorage(true)}>管理本地存储</button>
  </div>}{manager}</>
  return <section className="asset-notice workspace-save-recovery" role="alert" aria-label="保存恢复选项">
    <div className="workspace-save-recovery-copy">
      <strong>{status === 'conflict' ? '保存版本发生冲突' : '本机保存未完成'}</strong>
      <p>当前编辑仍保留在此页面。{status === 'conflict'
        ? '请先下载工程备份，或另存副本后继续。另一版本不会被覆盖。'
        : quotaExceeded
          ? '本地存储空间不足。请先下载备份，通过「管理本地存储」整理后再重试。'
          : '请先下载工程备份，再重试保存到浏览器。也可另存副本。'}</p>
      <p id={backupContentsId} className="asset-muted">.sceneweave 备份含实际资源和秘密，不包含尚未采用的草稿。请在浏览器下载列表确认文件。</p>
      {error && <details onKeyDown={onWorkspaceDisclosureEscape}><summary>查看具体原因</summary><p>{error}</p></details>}
      {backupBlockedReason && <p id={backupHelpId}>工程备份暂不可用：{backupBlockedReason}</p>}
      {copyBlockedReason && <p id={copyHelpId}>另存副本暂不可用：{copyBlockedReason}</p>}
      {(copyBlockedReason || backupBlockedReason) && <p className="asset-muted">有草稿或候选时，可用「返回当前工具与草稿」或「返回候选审阅」继续处理。</p>}
    </div>
    <div className="workspace-save-recovery-actions">
      <button type="button" className="secondary" disabled={busy || !!backupBlockedReason} aria-describedby={backupBlockedReason ? `${backupContentsId} ${backupHelpId}` : backupContentsId} onClick={onBackup}>下载当前工程备份</button>
      {status === 'error' && <button type="button" className="secondary" disabled={busy} onClick={onRetry}>重试保存</button>}
      <button type="button" className="secondary" disabled={busy} onClick={() => setStorage(true)}>管理本地存储</button>
      <button type="button" className="secondary" disabled={busy || !!copyBlockedReason} aria-describedby={copyBlockedReason ? copyHelpId : undefined} onClick={onCopy}>另存副本</button>
    </div>
    {manager}
  </section>
}
