import type { ReactNode } from 'react'
import './asset-editor.css'

/** Shared content layout; each host retains its own dialog and draft lifecycle. */
export default function AssetEditorLayout({ title, subtitle, scopeLabel, navigation, canvas, inspector, overview, actions, onClose, closeLabel = '关闭编辑', closeAriaLabel, headingId, className = '' }: {
  title: string
  subtitle?: string
  scopeLabel: string
  navigation: ReactNode
  canvas: ReactNode
  inspector: ReactNode
  overview?: ReactNode
  actions?: ReactNode
  onClose?: () => void
  closeLabel?: string
  closeAriaLabel?: string
  headingId?: string
  className?: string
}) {
  return <div className={`asset-editor-layout ${className}`}>
    <header className="asset-editor-header"><div><span className="asset-editor-eyebrow">{scopeLabel}</span><h2 id={headingId}>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><div className="asset-editor-header-actions">{actions}{onClose && <button type="button" className="secondary" aria-label={closeAriaLabel} onClick={onClose}>{closeLabel}</button>}</div></header>
    {overview && <section className="asset-editor-overview" aria-label="编辑总览">{overview}</section>}
    <div className="asset-editor-columns"><nav className="asset-editor-navigation" aria-label="编辑内容">{navigation}</nav><main className="asset-editor-canvas">{canvas}</main><aside className="asset-editor-inspector" aria-label="当前编辑属性">{inspector}</aside></div>
  </div>
}
