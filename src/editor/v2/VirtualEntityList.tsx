import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { LocateFixed, Move, Search } from 'lucide-react'
import './virtual-entity-list.css'

export interface VirtualEntityItem { id: string; label: string; detail?: string }
type SelectionOperation = 'replace' | 'add' | 'subtract'
type Props = {
  items: readonly VirtualEntityItem[]
  selectedIds: ReadonlySet<string>
  locateId: string | null
  busy: boolean
  onSelect: (id: string, operation?: SelectionOperation) => void
  noun?: string
  selectionHint?: string
}

const ROW_HEIGHT = 40
const VIEW_HEIGHT = 320
const OVERSCAN = 3
const VIRTUAL_THRESHOLD = 48

const VirtualRow = memo(function VirtualRow({ item, index, selected, busy, tabStop, onSelect, onFocus }: {
  item: VirtualEntityItem; index: number; selected: boolean; busy: boolean; tabStop: boolean
  onSelect: Props['onSelect']; onFocus: (id: string) => void
}) {
  return <button type="button" data-entity-id={item.id} data-virtual-index={index}
    className={`asset-virtual-row${selected ? ' selected' : ''}`} style={{ top: index * ROW_HEIGHT }}
    disabled={busy} tabIndex={tabStop ? 0 : -1} aria-pressed={selected} title={`${item.label}\n${item.id}`}
    onFocus={() => onFocus(item.id)}
    onClick={event => onSelect(item.id, event.altKey ? 'subtract' : event.shiftKey ? 'add' : 'replace')}
    onKeyDown={event => {
      if (['Enter', ' '].includes(event.key) && (event.shiftKey || event.altKey)) {
        event.preventDefault(); onSelect(item.id, event.altKey ? 'subtract' : 'add')
      }
    }}><Move size={14}/><span>{item.label}</span>{item.detail && <small>{item.detail}</small>}</button>
})

/** Only visible object rows are mounted for long scenes; the complete data stays searchable. */
export default function VirtualEntityList({ items, selectedIds, locateId, busy, onSelect, noun = '物件', selectionHint = 'Enter 选择' }: Props) {
  const [query, setQuery] = useState(''), [scrollTop, setScrollTop] = useState(0), [activeId, setActiveId] = useState<string | null>(null), [focusRequest, setFocusRequest] = useState(0)
  const viewport = useRef<HTMLDivElement>(null), pendingFocus = useRef<string | null>(null), pendingLocate = useRef<string | null>(null)
  const focusFrame = useRef<number | null>(null)
  const searchable = useMemo(() => items.map(item => ({ item, text: `${item.label}\n${item.id}`.toLowerCase() })), [items])
  const filtered = useMemo(() => {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
    return terms.length ? searchable.filter(value => terms.every(term => value.text.includes(term))).map(value => value.item) : items
  }, [items, searchable, query])
  const positions = useMemo(() => new Map(filtered.map((item, index) => [item.id, index])), [filtered])
  const height = Math.min(VIEW_HEIGHT, Math.max(1, filtered.length) * ROW_HEIGHT)
  const virtual = filtered.length > VIRTUAL_THRESHOLD
  const first = virtual ? Math.max(0, Math.min(Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN, filtered.length - 1)) : 0
  const end = virtual ? Math.min(filtered.length, Math.ceil((scrollTop + height) / ROW_HEIGHT) + OVERSCAN) : filtered.length
  const activeIndex = activeId ? positions.get(activeId) ?? 0 : 0
  const tabIndex = activeIndex >= first && activeIndex < end ? activeIndex : first
  const focusRow = useCallback((id: string) => setActiveId(id), [])
  const reveal = useCallback((index: number, focus: boolean) => {
    const node = viewport.current, item = filtered[index]
    if (!node || !item) return
    const top = index * ROW_HEIGHT, bottom = top + ROW_HEIGHT
    if (top < node.scrollTop) node.scrollTop = top
    else if (bottom > node.scrollTop + node.clientHeight) node.scrollTop = bottom - node.clientHeight
    if (focus) { pendingFocus.current = item.id; setFocusRequest(value => value + 1) }
    setScrollTop(node.scrollTop); setActiveId(item.id)
  }, [filtered])
  // Search and explicit location can mount a previously absent row before focus moves.
  useLayoutEffect(() => {
    if (pendingLocate.current) {
      const index = positions.get(pendingLocate.current)
      if (index !== undefined) { pendingLocate.current = null; reveal(index, true) }
    }
    const id = pendingFocus.current, index = id ? positions.get(id) : undefined
    if (index === undefined || index < first || index >= end) return
    if (focusFrame.current !== null) cancelAnimationFrame(focusFrame.current)
    focusFrame.current = requestAnimationFrame(() => {
      focusFrame.current = null
      if (pendingFocus.current !== id) return
      const row = viewport.current?.querySelector<HTMLButtonElement>(`[data-virtual-index="${index}"]`)
      if (row?.dataset.entityId === id && !row.disabled) { pendingFocus.current = null; row.focus({ preventScroll: true }) }
    })
    return () => { if (focusFrame.current !== null) { cancelAnimationFrame(focusFrame.current); focusFrame.current = null } }
  }, [activeId, end, first, filtered, focusRequest, positions, reveal])
  const navigate = (event: KeyboardEvent<HTMLDivElement>) => {
    if (busy || !filtered.length || event.metaKey || event.ctrlKey || event.nativeEvent.isComposing) return
    const page = Math.max(1, Math.floor((viewport.current?.clientHeight ?? height) / ROW_HEIGHT))
    const next = event.key === 'ArrowDown' ? activeIndex + 1 : event.key === 'ArrowUp' ? activeIndex - 1
      : event.key === 'Home' ? 0 : event.key === 'End' ? filtered.length - 1
        : event.key === 'PageDown' ? activeIndex + page : event.key === 'PageUp' ? activeIndex - page : null
    if (next !== null) { event.preventDefault(); event.stopPropagation(); reveal(Math.max(0, Math.min(filtered.length - 1, next)), true) }
  }
  return <div className="asset-object-browser">
    <label className="asset-object-search"><Search size={13}/><input type="search" aria-label={`搜索场景${noun}`} placeholder="搜索名称或 ID" value={query} disabled={busy} autoComplete="off" spellCheck={false}
      onChange={event => { setQuery(event.target.value); setActiveId(null); pendingFocus.current = null; setScrollTop(0); if (viewport.current) viewport.current.scrollTop = 0 }}
      onKeyDown={event => {
        if (event.nativeEvent.isComposing) return
        if (event.key === 'Escape' && query) { event.preventDefault(); event.stopPropagation(); setQuery(''); setScrollTop(0); if (viewport.current) viewport.current.scrollTop = 0 }
        else if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && filtered.length) { event.preventDefault(); reveal(event.key === 'ArrowDown' ? 0 : filtered.length - 1, true) }
      }}/></label>
    <div className="asset-object-list-tools"><span aria-live="polite">{query.trim() ? `${filtered.length} / ${items.length}` : items.length} {noun === '物件' ? '件' : '项'}{noun}</span><button type="button" aria-label="定位所选对象" disabled={busy || !locateId} onClick={() => {
      if (!locateId) return
      const index = positions.get(locateId)
      if (index !== undefined) reveal(index, true)
      else { pendingLocate.current = locateId; setQuery(''); setScrollTop(0); if (viewport.current) viewport.current.scrollTop = 0 }
    }}><LocateFixed size={12}/>定位所选</button></div>
    {filtered.length ? <div ref={viewport} className="asset-object-viewport" role="group" aria-label={`场景${noun}列表`} tabIndex={-1} style={{ height }}
      data-total-rows={filtered.length} data-mounted-rows={end - first}
      onKeyDown={navigate} onScroll={event => {
        const node = event.currentTarget, top = node.scrollTop
        setScrollTop(top)
        const focused = document.activeElement
        if (virtual && focused instanceof HTMLButtonElement && node.contains(focused)) {
          const index = Number(focused.dataset.virtualIndex), nextFirst = Math.max(0, Math.floor(top / ROW_HEIGHT) - OVERSCAN), nextEnd = Math.min(filtered.length, Math.ceil((top + height) / ROW_HEIGHT) + OVERSCAN)
          if (index < nextFirst || index >= nextEnd) {
            // Keep keyboard navigation in the list when wheel scrolling unmounts its focused row.
            node.focus({ preventScroll: true }); setActiveId(filtered[Math.min(filtered.length - 1, Math.floor(top / ROW_HEIGHT))].id)
          }
        }
      }}>
      <div className="asset-object-spacer" style={{ height: filtered.length * ROW_HEIGHT }}>{filtered.slice(first, end).map((item, offset) => <VirtualRow key={item.id} item={item} index={first + offset} selected={selectedIds.has(item.id)} busy={busy} tabStop={first + offset === tabIndex} onSelect={onSelect} onFocus={focusRow}/>)}</div>
    </div> : <p className="asset-muted asset-object-empty">{items.length ? `没有匹配的${noun}。可按名称或完整 ID 搜索。` : `场景中还没有${noun}。`}</p>}
    <p className="asset-object-key-hint">↑↓ / Home / End / Page 浏览 · {selectionHint}</p>
  </div>
}
