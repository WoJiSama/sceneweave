import { useId, useRef } from 'react'
import { AlertTriangle, CheckCircle2, Clock3, Download, LoaderCircle } from 'lucide-react'
import type { WorkspaceState } from '../../application/workspace/workspace'
import WorkspaceHelp, { closeWorkspaceDisclosure, onWorkspaceDisclosureEscape } from './WorkspaceHelp'
import './workspace-file-actions.css'

const saveLabels = { empty: '尚未打开工程', saved: '本地已保存', unsaved: '等待保存', saving: '正在保存', error: '保存失败', conflict: '版本冲突' }

/** File operations keep the workspace's existing callbacks and session guard. */
export default function WorkspaceFileActions({ status, imageDraft, hasProject, audience, fileBlockedReason, imageImportDisabled,
  backupBlockedReason, pngBlockedReason, onNew, onImport, onImageImport, onSamples, onReload, onBackup, onPng, onVtt, onSettings }: {
  status: WorkspaceState['status']
  imageDraft: boolean
  hasProject: boolean
  audience: 'gm' | 'player'
  fileBlockedReason: string | null
  imageImportDisabled: boolean
  backupBlockedReason: string | null
  pngBlockedReason: string | null
  onNew: () => void
  onImport: () => void
  onImageImport: () => void
  onSamples: () => void
  onReload: () => void
  onBackup: () => void
  onPng: (audience: 'gm' | 'player') => void
  onVtt: () => void
  onSettings: () => void
}) {
  const disclosures = useId()
  const fileReasonId = `${disclosures}-file-reason`
  const fileBackupReasonId = `${disclosures}-file-backup-reason`
  const fileBackupId = `${disclosures}-file-backup`
  const exportReasonId = `${disclosures}-export-reason`
  const pngReasonId = `${disclosures}-png-reason`
  const playerPngId = `${disclosures}-player-png`
  const gmPngId = `${disclosures}-gm-png`
  const exportBackupId = `${disclosures}-export-backup`
  const pngDescriptionId = pngBlockedReason === backupBlockedReason ? exportReasonId : pngReasonId
  const fileMenu = useRef<HTMLDetailsElement>(null)
  const exportMenu = useRef<HTMLDetailsElement>(null)

  const runFileAction = (action: () => void) => {
    // Dialogs and drawers capture their return target when the action opens them.
    if (fileMenu.current) closeWorkspaceDisclosure(fileMenu.current)
    action()
  }
  const runDownload = (action: () => void) => {
    // The download action can be disabled during preparation. Keep focus in the menu.
    exportMenu.current?.querySelector('summary')?.focus()
    action()
  }

  return <>
    <span role="status" className={`asset-save ${status}`} title="已采用的编辑自动保存在此浏览器、此站点。需要文件时，使用「文件」中的工程备份。">
      {status === 'saving' ? <LoaderCircle aria-hidden="true" size={14} className="spin"/> : status === 'error' || status === 'conflict' ? <AlertTriangle aria-hidden="true" size={14}/>
        : status === 'unsaved' ? <Clock3 aria-hidden="true" size={14}/> : status === 'saved' ? <CheckCircle2 aria-hidden="true" size={14}/> : null}
      <span>{saveLabels[status]}{imageDraft ? ' · 图片草稿未采用' : ''}</span>
    </span>
    <details className="workspace-file-menu" name={disclosures} ref={fileMenu} onKeyDown={onWorkspaceDisclosureEscape}>
      <summary>文件</summary>
      <div className="workspace-file-surface" role="group" aria-label="文件操作">
        <p>自动保存只在此浏览器、此站点。换浏览器、设备或端口，以及清除站点数据前，请下载工程备份。</p>
        <div className="workspace-file-choice">
          <button type="button" className="secondary" disabled={!!backupBlockedReason} aria-describedby={backupBlockedReason ? `${fileBackupId} ${fileBackupReasonId}` : fileBackupId} onClick={() => runFileAction(onBackup)}>备份可编辑工程 · 含秘密</button>
          <p id={fileBackupId}>.sceneweave 含实际资源、许可和秘密，可用「打开工程文件」继续编辑。备份不包含尚未采用的草稿。</p>
          {backupBlockedReason && <p id={fileBackupReasonId} role="status">{backupBlockedReason}</p>}
        </div>
        <div className="workspace-file-secondary-actions">
          {fileBlockedReason && <p id={fileReasonId} role="status">{fileBlockedReason}草稿与候选可用页面的返回入口继续。</p>}
          <button type="button" className="secondary" disabled={!!fileBlockedReason} aria-describedby={fileBlockedReason ? fileReasonId : undefined} onClick={() => runFileAction(onNew)}>新建空白场景</button>
          <button type="button" className="secondary" disabled={!!fileBlockedReason} aria-describedby={fileBlockedReason ? fileReasonId : undefined} onClick={() => runFileAction(onImport)}>打开工程文件</button>
          <button type="button" className="secondary" disabled={imageImportDisabled} aria-describedby={imageImportDisabled && fileBlockedReason ? fileReasonId : undefined} onClick={() => runFileAction(onImageImport)}>从图片新建场景</button>
          <button type="button" className="secondary" disabled={!!fileBlockedReason} aria-describedby={fileBlockedReason ? fileReasonId : undefined} onClick={() => runFileAction(onSamples)}>从样板开始</button>
          <button type="button" className="secondary" disabled={!!fileBlockedReason || !hasProject} aria-describedby={fileBlockedReason ? fileReasonId : undefined} onClick={() => runFileAction(onReload)}>重新载入已保存版本</button>
        </div>
      </div>
    </details>
    <WorkspaceHelp disclosureGroup={disclosures}/>
    <details className="workspace-export-menu" name={disclosures} ref={exportMenu} onKeyDown={onWorkspaceDisclosureEscape}>
      <summary><Download aria-hidden="true" size={15}/>导出</summary>
      <div className="workspace-file-surface" role="group" aria-label="导出选项">
        <p>可编辑工程需下载 .sceneweave 备份。自动保存只在此浏览器，不会下载文件。</p>
        <p>导出会发起下载，请在浏览器下载列表确认。</p>
        <div className="workspace-file-choice">
          <button type="button" className="primary" disabled={!!pngBlockedReason} aria-describedby={pngBlockedReason ? `${playerPngId} ${pngDescriptionId}` : playerPngId} onClick={() => runDownload(() => onPng('player'))}>玩家地图 PNG</button>
          <p id={playerPngId}>导出当前楼层的图片，过滤秘密，可与玩家分享。</p>
        </div>
        {audience === 'gm' && <div className="workspace-file-choice">
          <button type="button" className="secondary" disabled={!!pngBlockedReason} aria-describedby={pngBlockedReason ? `${gmPngId} ${pngDescriptionId}` : gmPngId} onClick={() => runDownload(() => onPng('gm'))}>主持人地图 PNG · 含秘密</button>
          <p id={gmPngId}>导出当前楼层的完整图片，仅供主持人使用。</p>
        </div>}
        <div className="workspace-file-choice">
          <button type="button" className="secondary" disabled={!!backupBlockedReason} aria-describedby={backupBlockedReason ? `${exportBackupId} ${exportReasonId}` : exportBackupId} onClick={() => runDownload(onBackup)}>备份可编辑工程 · 含秘密</button>
          <p id={exportBackupId}>保存完整工程及实际资源和许可，供主持人恢复编辑。</p>
        </div>
        {backupBlockedReason && <p id={exportReasonId} role="status">{backupBlockedReason}</p>}
        {pngBlockedReason && pngBlockedReason !== backupBlockedReason && <p id={pngReasonId} role="status">{pngBlockedReason}</p>}
        <div className="workspace-file-secondary-actions">
          {audience === 'player' && hasProject && <p>主持人地图与 VTT 导出请先切换到主持人视图。</p>}
          <button type="button" className="secondary" disabled={!!pngBlockedReason || !hasProject || audience !== 'gm'} aria-describedby={pngBlockedReason ? pngDescriptionId : undefined} onClick={onVtt}>VTT 导出</button>
          <button type="button" className="secondary" disabled={!hasProject || audience !== 'gm'} onClick={() => {
            if (exportMenu.current) closeWorkspaceDisclosure(exportMenu.current)
            onSettings()
          }}>调整导出范围</button>
        </div>
      </div>
    </details>
  </>
}
