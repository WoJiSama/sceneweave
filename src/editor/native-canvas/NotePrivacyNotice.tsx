import { useMemo } from 'react'
import type { EditableProject } from '../../application/workspace/project'
import { notePrivacySummary } from './note-privacy'
import './note-privacy.css'

/** Mounted only by the GM canvas. No notice content enters player DOM or PNG. */
export default function NotePrivacyNotice({ project, floorId, disabled, onSelect }: {
  project: EditableProject; floorId: string; disabled: boolean; onSelect: (id: string) => void
}) {
  const summary = useMemo(() => notePrivacySummary(project.document, floorId, project.appearance), [project.document, project.appearance, floorId])
  if (!summary.outputError && !summary.hidden.length) return null
  return <details className="asset-note-privacy" data-testid="note-privacy-notice" aria-label="玩家注记可见性提示">
    <summary>{summary.outputError ? '暂时无法核对玩家注记' : `${summary.hidden.length} 条公开注记未向玩家显示`}</summary>
    {summary.outputError ? <p>{summary.outputError}</p> : <>
      <p>这些文字附着于未公开的对象，或位于遮罩中。可选择注记检查附着对象，或把文字移到明确公开的位置。</p>
      <ul>{summary.hidden.map(note => <li key={note.id}><button type="button" disabled={disabled} onClick={() => onSelect(note.id)}>{note.label}</button></li>)}</ul>
    </>}
  </details>
}
