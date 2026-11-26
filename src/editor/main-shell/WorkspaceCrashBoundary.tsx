import { Component, useState, type ReactNode } from 'react'
import { downloadWorkspaceRecovery } from './recovery-file'

export const ISSUE_LINK = 'https://github.com/WoJiSama/sceneweave/issues/new'

export class WorkspaceCrashBoundary extends Component<{ children: ReactNode; onCrash?: () => void; fallback: ReactNode }, { crashed: boolean }> {
  state = { crashed: false }
  static getDerivedStateFromError() { return { crashed: true } }
  componentDidCatch() { this.props.onCrash?.() }
  render() { return this.state.crashed ? this.props.fallback : this.props.children }
}

export function WorkspaceCrashRecovery({ onHome, onRetry }: { onHome: () => void; onRetry?: () => void }) {
  const [busy, setBusy] = useState(false), [feedback, setFeedback] = useState<string>()
  const backup = async () => {
    setBusy(true); setFeedback(undefined)
    try {
      await downloadWorkspaceRecovery()
      setFeedback('已发起工程备份下载。文件包含已采用的编辑和主持人信息，请在下载列表确认。')
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : '工作台恢复备份失败。')
    } finally { setBusy(false) }
  }
  return <section className="workspace-crash-recovery" aria-label="工作台恢复">
    <h1>工作台发生异常</h1>
    <p>可以尝试下载当前页面里的工程，或从首页重新打开上次保存的版本。</p>
    <div className="workspace-crash-actions">
      <button className="primary" disabled={busy} onClick={() => void backup()}>{busy ? '正在准备备份…' : '下载当前工程备份 · 含秘密'}</button>
      {onRetry && <button className="secondary" disabled={busy} onClick={onRetry}>重新打开工作台</button>}
      <button className="secondary" disabled={busy} onClick={onHome}>回到首页</button>
      <a href={ISSUE_LINK} target="_blank" rel="noreferrer">反馈问题</a>
    </div>
    {feedback && <p role="status">{feedback}</p>}
  </section>
}
