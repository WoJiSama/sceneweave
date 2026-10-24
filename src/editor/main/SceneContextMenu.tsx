import { useLayoutEffect, useRef, useState } from 'react'
import type { EditableProject } from '../../application/workspace/project'
import type { PointMm } from '../../shared/model/scene'
import { propName, groupName } from './SceneInspector'
import { selectionActionReason, type SelectionAction } from '../native-canvas/selection-actions'

export type SceneMenu = { x: number; y: number; point: PointMm; hits: string[]; ids: string[]; checkpoint: number; origin: HTMLElement | null; blank: boolean }
export function entityLabel(project: EditableProject, id: string): string {
  const s = project.document
  return s.props[id] ? `${propName(project, id)} · 物件` : s.prefabInstances[id] ? `${groupName(project, id)} · 组合` : s.rooms[id] ? `${s.rooms[id].purpose || '房间'} · 地面` : s.walls[id] ? `墙体 · ${id}` : s.terrainAreas[id] ? `开放表面 · ${id}` : `场景对象 · ${id}`
}
export default function SceneContextMenu({ project, menu, onClose, onAction, onSelect, onFit, onPlace, onEdit, onMoveToLayer }: { project: EditableProject; menu: SceneMenu; onClose: (restore?: boolean) => void; onAction: (action: SelectionAction) => void; onSelect: (id: string | null) => void; onFit: () => void; onPlace: (id: string, point: PointMm) => void; onEdit: () => void; onMoveToLayer?: () => void }) {
  const ref = useRef<HTMLDivElement>(null), [definition, setDefinition] = useState(Object.keys(project.document.propDefinitions)[0] ?? '')
  useLayoutEffect(() => {
    const node = ref.current!; const b = node.getBoundingClientRect()
    node.style.left = `${Math.max(8, Math.min(menu.x, window.innerWidth - b.width - 8))}px`; node.style.top = `${Math.max(8, Math.min(menu.y, window.innerHeight - b.height - 8))}px`
    node.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')?.focus()
    const outside = (event: PointerEvent) => { if (!node.contains(event.target as Node)) onClose(false) }
    const dismiss = () => onClose(false)
    document.addEventListener('pointerdown', outside); window.addEventListener('blur', dismiss); window.addEventListener('resize', dismiss)
    return () => { document.removeEventListener('pointerdown', outside); window.removeEventListener('blur', dismiss); window.removeEventListener('resize', dismiss) }
  }, [])
  const invoke = (run: () => void) => { onClose(true); run() }
  return <div ref={ref} className="asset-context-menu" role="menu" aria-label="场景操作" style={{ left: menu.x, top: menu.y }} onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(true); return }
    if (event.key === 'Tab') { event.preventDefault(); const items = [...ref.current!.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled),select:not(:disabled)')], index = items.indexOf(event.target as HTMLElement); items[(index + (event.shiftKey ? -1 : 1) + items.length) % items.length]?.focus(); return }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) && (event.target as HTMLElement).getAttribute('role') === 'menuitem') {
      event.preventDefault(); const items = [...ref.current!.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled),select:not(:disabled)')], index = items.indexOf(event.target as HTMLElement)
      items[event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus()
    }
  }}>
    <strong>{menu.blank ? '此处空白' : `已选 ${menu.ids.length} 个对象`}</strong><small>{menu.blank ? `世界坐标 ${menu.point.x}, ${menu.point.y} mm` : menu.ids.length === 1 ? entityLabel(project, menu.ids[0]) : '对当前选择执行操作'}</small>
    {!menu.blank && <><button role="menuitem" onClick={() => invoke(onEdit)}>属性 / 编辑</button>{(['copy', 'delete', 'lock', 'unlock'] as const).map(action => { const reason = selectionActionReason(project.document, menu.ids, action), label = { copy: '复制所选', delete: '删除所选', lock: '锁定所选', unlock: '解锁所选' }[action]; return <div key={action}><button role="menuitem" disabled={!!reason} aria-describedby={reason ? `menu-reason-${action}` : undefined} onClick={() => invoke(() => onAction(action))}>{label}</button>{reason && <small id={`menu-reason-${action}`}>{reason}</small>}</div> })}</>}
    {!menu.blank && onMoveToLayer && <button role="menuitem" onClick={() => invoke(onMoveToLayer)}>移动所选到图层…</button>}
    {menu.hits.length > 1 && <><strong>选择此处对象</strong>{menu.hits.map(id => <button role="menuitem" key={id} data-entity-id={id} onClick={() => invoke(() => onSelect(id))}>{entityLabel(project, id)}</button>)}</>}
    <button role="menuitem" disabled={!menu.ids.length} onClick={() => invoke(() => onSelect(null))}>清空选择</button><button role="menuitem" onClick={() => invoke(onFit)}>适应全图</button>
    {menu.blank && !!Object.keys(project.document.propDefinitions).length && <><label>现有素材<select aria-label="右键放置素材" value={definition} onChange={event => setDefinition(event.target.value)}>{Object.values(project.document.propDefinitions).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><button role="menuitem" onClick={() => invoke(() => onPlace(definition, menu.point))}>在此预览放置</button></>}
  </div>
}
