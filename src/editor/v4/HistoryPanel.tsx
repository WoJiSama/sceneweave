import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { KeyboardEvent } from 'react'
import { Archive, Check, Download, Pencil, Plus, RefreshCw, Search, ShieldCheck, Trash2, X } from 'lucide-react'
import type { SceneDocumentV3, PropV2 } from '../../core/v3/types'
import { HISTORY_LIMITS_V4, type RestoreModeV4 } from '../../core/v4/types'
import type { SceneRepositoryV4 } from '../../io/v4/storage'
import type { CompleteProjectV4, NamedSnapshotSummaryV4, NamedSnapshotV4 } from '../../io/v4/types'
import type { SelectionSessionV2 } from '../v2/selection-session'
import type { RestorePreviewV4, WorkspaceV4 } from './workspace'
import { projectSceneV3 } from '../../render/v3/projection'

type Props = {
  project: CompleteProjectV4
  repository: SceneRepositoryV4
  workspace: WorkspaceV4
  session: SelectionSessionV2
  disabled: boolean
  refreshKey: number
  onAction: (run: () => Promise<void>, source?: string) => Promise<void>
  onPreview: (preview: RestorePreviewV4) => void
  onBackup: (snapshotIds: string[] | undefined, sceneId: string) => void
}
type Usage = Awaited<ReturnType<SceneRepositoryV4['usage']>>
const modes: { id: RestoreModeV4; label: string }[] = [{ id: 'appearance', label: '外观' }, { id: 'transform', label: '位置角度' }, { id: 'entity', label: '完整物件' }]
const dateLabel = (stamp: string) => new Date(stamp).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
const bytes = (value: number) => `${(value / 1024 / 1024).toFixed(1)} MiB`
function memberIds(scene: SceneDocumentV3): Set<string> {
  return new Set([...Object.values(scene.prefabInstances), ...Object.values(scene.scatterGroups)].flatMap(group => Object.values(group.members).flatMap(member => member.propId ? [member.propId] : [])))
}
function propLabel(scene: SceneDocumentV3, prop: PropV2): string {
  return prop.definitionRef ? scene.propDefinitions[prop.definitionRef.id]?.name ?? prop.id : prop.id
}

export default function HistoryPanel({ project, repository, workspace, session, disabled, refreshKey, onAction, onPreview, onBackup }: Props) {
  const sceneId = project.document.sceneId, canvasIds = useSyncExternalStore(session.subscribe, session.getSnapshot)
  const [summaries, setSummaries] = useState<NamedSnapshotSummaryV4[]>([]), [usage, setUsage] = useState<Usage | null>(null)
  const [name, setName] = useState(''), [creating, setCreating] = useState(false), [snapshot, setSnapshot] = useState<NamedSnapshotV4 | null>(null)
  const [rename, setRename] = useState<{ snapshot: NamedSnapshotSummaryV4; name: string } | null>(null), [deleting, setDeleting] = useState<NamedSnapshotSummaryV4 | null>(null)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set()), [mode, setMode] = useState<RestoreModeV4>('appearance')
  const [query, setQuery] = useState(''), [scrollTop, setScrollTop] = useState(0), [activeId, setActiveId] = useState<string | null>(null), [focusRequest, setFocusRequest] = useState(0), [includeHistory, setIncludeHistory] = useState(false)
  const [backupIds, setBackupIds] = useState<ReadonlySet<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const request = useRef(0), viewport = useRef<HTMLDivElement>(null), pendingFocus = useRef<string | null>(null), focusFrame = useRef<number | null>(null)
  const refresh = async () => {
    const ticket = ++request.current, [items, nextUsage] = await Promise.all([repository.listNamedSnapshots(sceneId), repository.usage(sceneId)])
    if (ticket !== request.current) return
    setSummaries(items); setUsage(nextUsage)
    setSnapshot(current => current && items.some(item => item.id === current.id) ? current : null)
    setBackupIds(current => new Set([...current].filter(id => items.some(item => item.id === id))))
  }
  useEffect(() => {
    setSummaries([]); setUsage(null); setSnapshot(null); setSelected(new Set()); setBackupIds(new Set()); setIncludeHistory(false); setName(''); setRename(null); setDeleting(null); setCreating(false); setError(null); setActiveId(null); pendingFocus.current = null
    return () => { request.current++ }
  }, [sceneId])
  useEffect(() => { void refresh().catch(failure => setError(failure instanceof Error ? failure.message : String(failure))) }, [sceneId, project.document.revision, refreshKey])
  const historicalMembers = useMemo(() => snapshot ? memberIds(snapshot.project.document) : new Set<string>(), [snapshot])
  const currentMembers = useMemo(() => memberIds(project.document), [project.document])
  const rows = useMemo(() => snapshot ? Object.values(snapshot.project.document.props).filter(prop => !historicalMembers.has(prop.id)).map(prop => ({
    id: prop.id, name: propLabel(snapshot.project.document, prop), deleted: !project.document.props[prop.id], managed: currentMembers.has(prop.id),
  })) : [], [snapshot, historicalMembers, currentMembers, project.document])
  const rowIds = useMemo(() => new Set(rows.filter(row => !row.managed).map(row => row.id)), [rows])
  const filtered = useMemo(() => {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
    return terms.length ? rows.filter(row => terms.every(term => `${row.name}\n${row.id}`.toLowerCase().includes(term))) : rows
  }, [rows, query])
  const invalidCanvas = canvasIds.filter(id => !rowIds.has(id)), deletedCount = rows.filter(row => selected.has(row.id) && row.deleted).length
  const overBudget = selected.size > 256, needsRecreation = mode !== 'entity' && deletedCount > 0
  const rowHeight = 48, viewHeight = Math.min(288, Math.max(1, filtered.length) * rowHeight)
  const first = filtered.length > 48 ? Math.max(0, Math.min(filtered.length - 1, Math.floor(scrollTop / rowHeight) - 3)) : 0
  const end = filtered.length > 48 ? Math.min(filtered.length, Math.ceil((scrollTop + viewHeight) / rowHeight) + 3) : filtered.length
  const navigable = useMemo(() => disabled ? [] : filtered.flatMap((row, index) => row.managed ? [] : [index]), [disabled, filtered])
  const activeIndex = activeId ? filtered.findIndex(row => row.id === activeId) : -1
  const focusIndex = navigable.includes(activeIndex) ? activeIndex : navigable[0] ?? -1
  const tabStopIndex = focusIndex >= first && focusIndex < end ? focusIndex : navigable.find(index => index >= first && index < end) ?? -1
  const nearestNavigable = useCallback((target: number, direction: 1 | -1) => {
    if (!filtered.length || !navigable.length) return -1
    const start = Math.max(0, Math.min(filtered.length - 1, target))
    for (let index = start; index >= 0 && index < filtered.length; index += direction) if (navigable.includes(index)) return index
    return -1
  }, [filtered.length, navigable])
  const reveal = useCallback((target: number, focus: boolean, direction: 1 | -1 = 1) => {
    const index = nearestNavigable(target, direction), node = viewport.current, row = filtered[index]
    if (!node || !row || index < 0) return
    const top = index * rowHeight, bottom = top + rowHeight
    if (top < node.scrollTop) node.scrollTop = top
    else if (bottom > node.scrollTop + node.clientHeight) node.scrollTop = bottom - node.clientHeight
    setScrollTop(node.scrollTop); setActiveId(row.id)
    if (focus) { pendingFocus.current = row.id; setFocusRequest(value => value + 1) }
  }, [filtered, nearestNavigable])
  useLayoutEffect(() => {
    const id = pendingFocus.current
    if (!id) return
    const index = filtered.findIndex(row => row.id === id)
    if (index < first || index >= end) return
    if (focusFrame.current !== null) cancelAnimationFrame(focusFrame.current)
    focusFrame.current = requestAnimationFrame(() => {
      focusFrame.current = null
      if (pendingFocus.current !== id) return
      const input = viewport.current?.querySelector<HTMLInputElement>(`input[data-row-index="${index}"]`)
      if (input?.dataset.historyRowId === id && !input.disabled) { pendingFocus.current = null; input.focus({ preventScroll: true }) }
    })
    return () => { if (focusFrame.current !== null) { cancelAnimationFrame(focusFrame.current); focusFrame.current = null } }
  }, [end, filtered, first, focusRequest])
  const navigate = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled || !filtered.length || event.metaKey || event.ctrlKey || event.nativeEvent.isComposing) return
    const current = focusIndex >= 0 ? focusIndex : 0, page = Math.max(1, Math.floor((viewport.current?.clientHeight ?? viewHeight) / rowHeight))
    const target = event.key === 'ArrowDown' ? current + 1 : event.key === 'ArrowUp' ? current - 1
      : event.key === 'Home' ? 0 : event.key === 'End' ? filtered.length - 1
        : event.key === 'PageDown' ? current + page : event.key === 'PageUp' ? current - page : null
    if (target === null) return
    event.preventDefault(); event.stopPropagation()
    reveal(Math.max(0, Math.min(filtered.length - 1, target)), true, event.key === 'ArrowUp' || event.key === 'PageUp' || event.key === 'End' ? -1 : 1)
  }
  const chooseSnapshot = (summary: NamedSnapshotSummaryV4) => void onAction(async () => {
    const checkpoint = workspace.checkpoint(), loaded = await repository.loadNamedSnapshot(summary.id, sceneId)
    if (!loaded) throw new Error('快照已不存在。')
    workspace.assertCheckpoint(checkpoint)
    setSnapshot(loaded); setSelected(new Set()); setQuery(''); setScrollTop(0); setActiveId(null); pendingFocus.current = null; setRename(null); setDeleting(null); setError(null)
    if (viewport.current) viewport.current.scrollTop = 0
  }, '打开历史快照')
  const selectProp = (id: string, checked: boolean) => { setSelected(current => { const next = new Set(current); if (checked) next.add(id); else next.delete(id); return next }); setError(null) }
  const available = summaries.filter(item => item.sceneId === sceneId), backupSnapshots = available.filter(item => backupIds.has(item.id))
  const namedCount = available.filter(item => item.kind === 'named').length, protectionCount = available.filter(item => item.kind === 'protection').length
  return <section className="history-panel" aria-label="命名历史">
    <div className="asset-section-heading"><Archive size={16}/><h2>命名历史</h2><span>{namedCount}/{HISTORY_LIMITS_V4.namedPerScene}</span><button type="button" title="新建命名快照" aria-label="新建命名快照" disabled={disabled || namedCount >= HISTORY_LIMITS_V4.namedPerScene} onClick={() => { setCreating(value => !value); setError(null) }}><Plus size={16}/></button><button type="button" title="刷新历史" aria-label="刷新历史" disabled={disabled} onClick={() => void onAction(refresh, '刷新历史')}><RefreshCw size={14}/></button></div>
    {creating && <form className="history-name-form" onSubmit={event => { event.preventDefault(); if (!name.trim()) return; void onAction(async () => { const created = await workspace.createNamedSnapshot(name.trim()); setName(''); setCreating(false); await refresh(); setSnapshot(created); setSelected(new Set()); setQuery(''); setScrollTop(0); setActiveId(null); pendingFocus.current = null }, '新建命名快照') }}><label>快照名称<input autoFocus aria-label="命名快照名称" value={name} maxLength={80} disabled={disabled} onChange={event => setName(event.target.value)}/></label><button className="primary" disabled={disabled || !name.trim()}><Check size={13}/>保存快照</button><button type="button" title="取消创建快照" aria-label="取消创建快照" disabled={disabled} onClick={() => setCreating(false)}><X size={14}/></button></form>}
    {(['named', 'protection'] as const).map(kind => <div className="history-list-section" key={kind}>
      <h3>{kind === 'named' ? <Archive size={12}/> : <ShieldCheck size={12}/>} {kind === 'named' ? '命名快照' : '恢复前保护'}<small>{kind === 'named' ? namedCount : `${protectionCount}/${HISTORY_LIMITS_V4.protectionPerScene}`}</small></h3>
      <div className="history-snapshot-list" aria-label={kind === 'named' ? '命名快照列表' : '保护快照列表'}>{available.filter(item => item.kind === kind).map(summary => <div className={`history-snapshot-row${snapshot?.id === summary.id ? ' selected' : ''}`} data-snapshot-id={summary.id} key={summary.id}>
        <button className="history-snapshot-open" aria-label={`查看快照 ${summary.name}`} aria-pressed={snapshot?.id === summary.id} disabled={disabled} onClick={() => chooseSnapshot(summary)}><strong>{summary.name}</strong><small>r{summary.sourceRevision} · {dateLabel(summary.createdAt)}</small></button>
        {kind === 'named' && <button title="重命名快照" aria-label={`重命名快照 ${summary.name}`} disabled={disabled} onClick={() => { setRename({ snapshot: summary, name: summary.name }); setDeleting(null) }}><Pencil size={13}/></button>}
        <button title="删除快照" aria-label={`删除快照 ${summary.name}`} disabled={disabled} onClick={() => { setDeleting(summary); setRename(null) }}><Trash2 size={13}/></button>
      </div>)}{!available.some(item => item.kind === kind) && <p className="history-empty">{kind === 'named' ? '暂无命名快照' : '暂无恢复前保护快照'}</p>}</div>
    </div>)}
    {rename && <form className="history-name-form" onSubmit={event => { event.preventDefault(); if (!rename.name.trim()) return; void onAction(async () => { await repository.renameNamedSnapshot(rename.snapshot.id, rename.name.trim(), rename.snapshot.contentHash, usage?.metadataVersion, sceneId); if (snapshot?.id === rename.snapshot.id) setSnapshot(await repository.loadNamedSnapshot(rename.snapshot.id, sceneId)); setRename(null); await refresh() }, '重命名快照') }}><label>快照名称<input autoFocus aria-label="修改快照名称" value={rename.name} maxLength={80} disabled={disabled} onChange={event => setRename({ ...rename, name: event.target.value })}/></label><button className="secondary" disabled={disabled || !rename.name.trim()}>保存名称</button><button type="button" aria-label="取消快照改名" disabled={disabled} onClick={() => setRename(null)}><X size={13}/></button></form>}
    {deleting && <div className="history-delete-confirm" role="group" aria-label="删除快照确认"><strong>删除「{deleting.name}」？</strong><span>此快照将从本工程历史移除</span><button className="secondary" disabled={disabled} onClick={() => setDeleting(null)}>取消删除</button><button className="history-danger" disabled={disabled} onClick={() => void onAction(async () => { await repository.deleteNamedSnapshot(deleting.id, deleting.contentHash, usage?.metadataVersion, sceneId); setDeleting(null); await refresh() }, '删除快照')}><Trash2 size={13}/>确认删除快照</button></div>}
    {snapshot && <div className="history-scope" aria-label="局部恢复范围">
      <h3>{snapshot.name}<small>r{snapshot.sourceRevision} · {rows.length} 件独立物件</small></h3>
      <label className="history-mode">恢复属性<select aria-label="局部恢复模式" value={mode} disabled={disabled} onChange={event => { setMode(event.target.value as RestoreModeV4); setError(null) }}>{modes.map(item => <option value={item.id} key={item.id}>{item.label}</option>)}</select></label>
      <div className="history-scope-tools"><button className="secondary" disabled={disabled || !canvasIds.length || invalidCanvas.length > 0} onClick={() => { setSelected(new Set(canvasIds)); setError(null) }}>使用画布所选 · {canvasIds.length}</button><button type="button" title="清空恢复范围" aria-label="清空恢复范围" disabled={disabled || !selected.size} onClick={() => setSelected(new Set())}><X size={13}/></button></div>
      {invalidCanvas.length > 0 && <p className="history-limit">画布所选中 {invalidCanvas.length} 项不在此快照的独立物件内</p>}
      <label className="history-search"><Search size={13}/><input type="search" aria-label="搜索历史物件" value={query} placeholder="名称或完整 ID" disabled={disabled} onChange={event => { setQuery(event.target.value); setActiveId(null); pendingFocus.current = null; setScrollTop(0); if (viewport.current) viewport.current.scrollTop = 0 }} onKeyDown={event => {
        if (event.nativeEvent.isComposing || (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') || !filtered.length) return
        event.preventDefault(); reveal(event.key === 'ArrowDown' ? 0 : filtered.length - 1, true, event.key === 'ArrowDown' ? 1 : -1)
      }}/></label>
      <div className="history-picker-count"><span>{query.trim() ? `${filtered.length} / ${rows.length}` : rows.length} 件</span><span aria-live="polite">已选 {selected.size} / 256</span></div>
      {filtered.length > 0 ? <div className="history-prop-viewport" ref={viewport} role="group" aria-label="历史独立物件列表" aria-describedby="history-picker-key-hint" tabIndex={-1} data-total-rows={filtered.length} data-mounted-rows={end - first} style={{ height: viewHeight }} onKeyDown={navigate} onScroll={event => {
        const node = event.currentTarget, top = node.scrollTop
        if (document.activeElement instanceof HTMLInputElement && node.contains(document.activeElement)) {
          const index = Number(document.activeElement.dataset.rowIndex), start = Math.max(0, Math.floor(top / rowHeight) - 3), finish = Math.min(filtered.length, Math.ceil((top + viewHeight) / rowHeight) + 3)
          if (index < start || index >= finish) { node.focus({ preventScroll: true }); const next = nearestNavigable(Math.floor(top / rowHeight), 1); setActiveId(next < 0 ? null : filtered[next].id) }
        }
        setScrollTop(top)
      }}><div style={{ height: filtered.length * rowHeight, position: 'relative' }}>{filtered.slice(first, end).map((row, offset) => <label className={`history-prop-row${selected.has(row.id) ? ' selected' : ''}`} style={{ top: (first + offset) * rowHeight }} data-history-prop-id={row.id} key={row.id}><input type="checkbox" data-row-index={first + offset} data-history-row-id={row.id} tabIndex={first + offset === tabStopIndex ? 0 : -1} aria-label={`恢复物件 ${row.id}`} checked={selected.has(row.id)} disabled={disabled || row.managed} onFocus={() => { pendingFocus.current = null; setActiveId(row.id) }} onChange={event => selectProp(row.id, event.target.checked)}/><span><strong>{row.name}</strong><small title={row.id}>{row.id}</small></span><em>{row.managed ? '现属组合' : row.deleted ? '已删除' : '现有'}</em></label>)}</div></div> : <p className="history-empty">{rows.length ? '没有匹配物件' : '此快照没有可恢复的独立物件'}</p>}
      {filtered.length > 0 && <p className="history-picker-key-hint" id="history-picker-key-hint">↑↓ / Home / End / Page 浏览 · 空格勾选</p>}
      {selected.size > 0 && <details className="history-selected-ids"><summary>完整恢复范围 · {selected.size} 件</summary><textarea aria-label="局部恢复完整 ID" readOnly rows={Math.min(6, selected.size)} value={[...selected].join('\n')}/></details>}
      {overBudget && <p role="alert" className="history-limit">已选 {selected.size} 件，超过单次 256 件上限；未截断范围</p>}
      {needsRecreation && <p role="alert" className="history-limit">所选含 {deletedCount} 件已删除物件，须选择完整物件模式</p>}
      <button className="primary asset-wide" disabled={disabled || !selected.size || overBudget || needsRecreation} onClick={() => void onAction(async () => { const next = await workspace.prepareRestore(snapshot.id, { ids: [...selected], mode }); onPreview(next); setError(null) }, '预览局部恢复')}>预览局部恢复 · {selected.size} 件</button>
    </div>}
    {usage && <dl className="history-usage"><dt>资源</dt><dd>{bytes(usage.resourceBytes)} / {bytes(usage.limits.storedResourceBytes)}</dd><dt>场景与历史</dt><dd>{bytes(usage.documentBytes)} / {bytes(usage.limits.storedDocumentBytes)}</dd><dt>迁移原件</dt><dd>{bytes(usage.originalBytes)} / {bytes(usage.limits.storedOriginalBytes)}</dd></dl>}
    <div className="history-backup"><label><input type="checkbox" aria-label="备份携带所选快照" checked={includeHistory} disabled={disabled} onChange={event => setIncludeHistory(event.target.checked)}/>携带所选命名与保护快照</label>
      {includeHistory && <div className="history-backup-scope" aria-label="历史备份范围">
        <div className="history-backup-tools"><span aria-live="polite">已选 {backupSnapshots.length} / {available.length} 份</span><button type="button" disabled={disabled || !available.length} onClick={() => setBackupIds(new Set(available.map(item => item.id)))}>全选</button><button type="button" disabled={disabled || !backupSnapshots.length} onClick={() => setBackupIds(new Set())}>清空</button></div>
        <div className="history-backup-list">{available.map(item => <label data-backup-snapshot-id={item.id} key={item.id}><input type="checkbox" aria-label={`备份快照 ${item.name}`} checked={backupIds.has(item.id)} disabled={disabled} onChange={event => { const checked = event.target.checked; setBackupIds(current => { const next = new Set(current); if (checked) next.add(item.id); else next.delete(item.id); return next }) }}/><span><strong>{item.name}</strong><small>{item.kind === 'named' ? '命名' : '保护'} · r{item.sourceRevision} · {dateLabel(item.createdAt)}</small></span></label>)}</div>
        {!available.length && <p className="history-empty">先创建快照，再选择需要携带的历史</p>}
        {backupSnapshots.length > 0 && <details className="history-selected-ids"><summary>完整备份范围 · {backupSnapshots.length} 份</summary><textarea aria-label="历史备份完整范围" readOnly rows={Math.min(6, backupSnapshots.length * 2)} value={backupSnapshots.map(item => `${item.name} · ${item.kind === 'named' ? '命名' : '保护'} · r${item.sourceRevision}\n${item.id}`).join('\n')}/></details>}
      </div>}
      <button className="secondary asset-wide" disabled={disabled || includeHistory && !backupSnapshots.length} onClick={() => onBackup(includeHistory ? backupSnapshots.map(item => item.id) : undefined, sceneId)}><Download size={14}/>{includeHistory ? `下载工程与所选历史 · ${backupSnapshots.length} 份` : '下载完整工程'}</button>
    </div>
    {error && <p role="alert" className="history-limit">{error}</p>}
  </section>
}

const propertyNames: Record<string, string> = {
  definitionRef: '固定定义', appearance: '外观', visualBoundsMm: '图像范围', shadowClass: '阴影类别', shadowOverride: '阴影覆盖',
  positionMm: '位置', rotationDeg: '角度', visibility: '可见性', supportRef: '支撑', roomId: '房间归属',
  footprintMm: '物理占地', footprintOffsetMm: '占地偏移', blocksMovement: '阻挡移动', blocksSight: '阻挡视线',
  renderLayer: '系统绘制带', renderOrder: '物件排序', floorId: 'Floor', id: '稳定 ID', editLocked: '编辑锁',
}
function valueLabel(value: unknown): string {
  if (value === undefined) return '无'
  if (value === null) return '无'
  if (typeof value === 'boolean') return value ? '是' : '否'
  if (value === 'public') return '公开'
  if (value === 'gm') return '仅主持人'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}
export function RestoreChangesPanel({ preview, current }: { preview: RestorePreviewV4; current: CompleteProjectV4 }) {
  const name = modes.find(mode => mode.id === preview.plan.request.mode)!.label
  const playerVisibility = useMemo(() => ({ before: new Set(projectSceneV3(current.document, 'player').props.map(prop => prop.id)), after: new Set(projectSceneV3(preview.project.document, 'player').props.map(prop => prop.id)) }), [current.document, preview.project.document])
  const newlyVisible = preview.plan.changes.filter(change => !playerVisibility.before.has(change.id) && playerVisibility.after.has(change.id))
  return <section className="history-changes" aria-label="局部恢复差异">
    <div className="asset-section-heading"><Archive size={16}/><h2>局部恢复差异</h2></div>
    <dl className="asset-facts"><dt>历史快照</dt><dd>{preview.snapshot.name}</dd><dt>历史修订</dt><dd>r{preview.snapshot.sourceRevision}</dd><dt>当前修订</dt><dd>r{preview.currentRevision}</dd><dt>恢复属性</dt><dd>{name}</dd><dt>明确范围</dt><dd>{preview.plan.request.ids.length} 件</dd><dt>实际变化</dt><dd>{preview.plan.changes.length} 件</dd></dl>
    <details className="history-selected-ids"><summary>完整请求 ID</summary><textarea aria-label="待采用局部恢复 ID" readOnly rows={Math.min(6, preview.plan.request.ids.length)} value={preview.plan.request.ids.join('\n')}/></details>
    {newlyVisible.length > 0 && <div className="history-privacy-review" role="alert"><strong>恢复后 {newlyVisible.length} 件物件将对玩家可见</strong><p>请核对下方物件及玩家输出。</p><details className="history-selected-ids"><summary>新增玩家可见范围 · {newlyVisible.length} 件</summary><textarea aria-label="恢复后新增玩家可见 ID" readOnly rows={Math.min(6, newlyVisible.length)} value={newlyVisible.map(change => change.id).join('\n')}/></details></div>}
    {!preview.plan.changed && <p className="history-empty">所选属性与当前一致，无需恢复</p>}
    {preview.plan.changes.map(change => {
      const before = change.before ?? {}, after = change.after
      const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(key => JSON.stringify(before[key as keyof PropV2]) !== JSON.stringify(after[key as keyof PropV2]))
      return <article className="history-change" data-restore-change-id={change.id} key={change.id}>
        <h3>{change.name}<small>{change.action === 'recreate' ? '重建已删除物件' : '更新现有物件'}</small></h3><code>{change.id}</code>
        {(preview.plan.request.mode === 'entity' || playerVisibility.before.has(change.id) !== playerVisibility.after.has(change.id)) && <p className={`history-player-note${!playerVisibility.before.has(change.id) && playerVisibility.after.has(change.id) ? ' newly-visible' : ''}`} data-player-visibility={playerVisibility.after.has(change.id) ? 'visible' : 'hidden'}>玩家视图：{playerVisibility.before.has(change.id) ? '可见' : '隐藏'} → {playerVisibility.after.has(change.id) ? '可见' : '隐藏'}</p>}
        {preview.plan.request.mode === 'entity' && change.historicalEditLocked !== undefined && <p className="history-lock-note" data-testid={`history-lock-review-${change.id}`}>{change.historicalEditLocked ? '历史快照曾锁定' : '历史快照未锁定'} · {change.action === 'recreate' ? '重建物件未锁定。' : '保留当前编辑锁。'}</p>}
        <dl>{preview.plan.request.mode === 'entity' && <div data-change-field="userLayer"><dt>用户图层</dt><dd><span>{change.beforeLayerId ? current.document.userLayers[change.beforeLayerId]?.name ?? change.beforeLayerId : '已删除'}</span><b>→</b><span>{preview.project.document.userLayers[change.layerId]?.name ?? change.layerId}</span></dd></div>}
          {keys.map(key => <div key={key} data-change-field={key}><dt>{propertyNames[key] ?? key}</dt><dd><span>{valueLabel(before[key as keyof PropV2])}</span><b>→</b><span>{valueLabel(after[key as keyof PropV2])}</span></dd></div>)}
        </dl>
      </article>
    })}
  </section>
}
