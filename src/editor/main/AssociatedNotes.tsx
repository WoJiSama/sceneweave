import { useMemo } from 'react'
import type { SceneDocument } from '../../shared/model/scene'
import { associatedNotes, noteAnchorRoot } from './associated-notes'
import { createEntityLabeler } from './entity-label'
import './associated-notes.css'

/** Mounted only in the GM inspector, with adopted content and guarded navigation. */
export default function AssociatedNotes({ scene, selectedId, onSelect }: {
  scene: SceneDocument; selectedId: string; onSelect: (id: string) => void
}) {
  const notes = useMemo(() => associatedNotes(scene, selectedId), [scene, selectedId])
  const name = useMemo(() => createEntityLabeler(scene), [scene])
  const rootId = noteAnchorRoot(scene, selectedId)
  const door = rootId ? scene.openings[rootId] : undefined
  if (!notes.length) return null
  return <section className="associated-notes" aria-label="关联注记" key={selectedId}>
    <h2>关联注记 · {notes.length}</h2>
    <p className="asset-muted">当前已采用内容。按实际附着关系列出，展开可阅读正文。</p>
    {door?.kind === 'door' && <div className="associated-notes-door">
      {rootId !== selectedId && <button type="button" className="asset-group-link" onClick={() => onSelect(door.id)}>查看附着门：{name(door.id)}</button>}
      <p aria-label="当前已采用门状态">当前已采用门状态：{door.state === 'open' ? '开启' : '关闭'} · {door.locked ? '已锁' : '未锁'}{door.secret ? ` · 秘密门（${door.revealed ? '已揭示' : '未揭示'}）` : ' · 普通门'}</p>
      <p className="asset-muted">注记标题与正文是文字说明；修改门后不会自动改写。</p>
    </div>}
    {notes.map(note => <details className="associated-note" key={note.id} open={note.id === selectedId || note.kind !== 'label'} data-associated-note-id={note.id}>
      <summary>{note.title?.trim() || note.text.trim().split(/\r?\n/, 1)[0].slice(0, 80) || '未命名注记'}</summary>
      <p className="asset-muted">{note.kind === 'clue' ? '线索' : note.kind === 'label' ? '文字标签' : '笔记'} · 可见性设置：{note.visibility === 'gm' ? '仅主持人' : '公开'}</p>
      <p className="associated-note-text">{note.text}</p>
      <div className="associated-note-links">
        {note.id !== selectedId && <button type="button" className="asset-group-link" onClick={() => onSelect(note.id)}>查看注记：{name(note.id)}</button>}
        {note.anchor.type === 'entity' && <button type="button" className="asset-group-link" onClick={() => { if (note.anchor.type === 'entity') onSelect(note.anchor.entityId) }}>附着于：{name(note.anchor.entityId)}</button>}
      </div>
    </details>)}
    {notes.some(note => note.visibility === 'public') && <p className="asset-muted">公开注记仍受附着对象和遮罩影响，实际可见性以玩家预览为准。</p>}
  </section>
}
