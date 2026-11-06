import { selectManualTransactionBudget } from '../../shared/budget/command-budget'
import { visualBase } from '../../shared/visual/base.js'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { KeyboardEvent } from 'react'
import { Archive, Check, Download, Pencil, Plus, RefreshCw, Search, ShieldCheck, Trash2, X } from 'lucide-react'
import type { SceneDocument } from '../../shared/model/scene'
import { HISTORY_LIMITS } from '../../shared/model/history'
import type { RestoreChange, RestoreMode } from '../../shared/history/restore'
import type { WorkspaceRepository } from './repository'
import type { EditableProject } from '../../application/workspace/project'
import type { SnapshotSummary } from '../../shared/model/project'
import type { LegacySource } from '../../shared/migration/types'
import type { SelectionSession } from '../native-canvas/selection-session'
import type { EditableSnapshot, RestorePreview, StructureRestorePreview, Workspace } from '../../application/workspace/workspace'
import StructureHistoryPanel from './StructureHistoryPanel'
import { projectScene } from '../../shared/projection/projection'
import { prepareOriginalDownload } from './legacy-original-download'
import { VISUAL_ENTITY_COLLECTIONS } from '../../shared/visual/diagnostics'
import { createEntityLabeler } from './entity-label'

type Props = {
  active: boolean
  project: EditableProject
  repository: WorkspaceRepository
  workspace: Workspace
  session: SelectionSession
  disabled: boolean
  refreshBlocked: boolean
  refreshKey: number
  onAction: (run: () => Promise<void>, source?: string) => Promise<void>
  onPreview: (preview: RestorePreview) => void
  onStructurePreview: (preview: StructureRestorePreview) => void
  onBackup: (snapshotIds: string[] | undefined, sceneId: string) => void
}
type Usage = Awaited<ReturnType<WorkspaceRepository['usage']>>
type VersionHistory = Awaited<ReturnType<WorkspaceRepository['listHistoryVersions']>>
const modes: { id: RestoreMode; label: string }[] = [{ id: 'appearance', label: '历史有效外观（保留当前层）' }, { id: 'source', label: '历史源与参数（跟随当前层）' }, { id: 'transform', label: '位置角度' }, { id: 'entity', label: '完整独立物件' }, { id: 'relationship', label: '整组关系与成员' }, { id: 'layer', label: '持续图层规则' }, { id: 'outdoorGeometry', label: '地形与通路几何（保留当前拓扑）' }, { id: 'outdoorProperties', label: '室外几何与业务属性' }, { id: 'scatterMembers', label: '显式历史散布成员与抑制记录' }, { id: 'visual', label: '本会话视觉参数与环境（保留绑定拓扑）' }]
const dateLabel = (stamp: string) => new Date(stamp).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
const bytes = (value: number) => `${(value / 1024 / 1024).toFixed(1)} MiB`
function memberIds(scene: SceneDocument): Set<string> {
  return new Set([...Object.values(scene.prefabInstances), ...Object.values(scene.scatterGroups)].flatMap(group => Object.values(group.members).flatMap(member => member.propId ? [member.propId] : [])))
}
export default function HistoryPanel({ active, project, repository, workspace, session, disabled, refreshBlocked, refreshKey, onAction, onPreview, onStructurePreview, onBackup }: Props) {
  const sceneId = project.document.sceneId, canvasIds = useSyncExternalStore(session.subscribe, session.getSnapshot)
  const [summaries, setSummaries] = useState<SnapshotSummary[]>([]), [usage, setUsage] = useState<Usage | null>(null)
  const [legacySources, setLegacySources] = useState<LegacySource[]>([])
  const [versionHistory, setVersionHistory] = useState<VersionHistory | null>(null), [versionId, setVersionId] = useState('')
  const [name, setName] = useState(''), [creating, setCreating] = useState(false), [snapshot, setSnapshot] = useState<EditableSnapshot | null>(null)
  const [rename, setRename] = useState<{ snapshot: SnapshotSummary; name: string } | null>(null), [deleting, setDeleting] = useState<SnapshotSummary | null>(null)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set()), [mode, setMode] = useState<RestoreMode>('appearance')
  const [query, setQuery] = useState(''), [scrollTop, setScrollTop] = useState(0), [activeId, setActiveId] = useState<string | null>(null), [focusRequest, setFocusRequest] = useState(0), [includeHistory, setIncludeHistory] = useState(false)
  const [backupIds, setBackupIds] = useState<ReadonlySet<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [historyError, setHistoryError] = useState<string | null>(null), [loadingHistory, setLoadingHistory] = useState(false)
  const [restoreResult, setRestoreResult] = useState<string | null>(null), [restoreError, setRestoreError] = useState<string | null>(null)
  const [scopeType, setScopeType] = useState<'props' | 'structure'>('props')
  const request = useRef(0), viewport = useRef<HTMLDivElement>(null), pendingFocus = useRef<string | null>(null), focusFrame = useRef<number | null>(null)
  const completedRefresh = useRef<string | null>(null)
  const refreshStamp = `${sceneId}:${project.document.revision}:${refreshKey}`
  const refresh = async () => {
    const ticket = ++request.current
    setLoadingHistory(true)
    try {
      const overview = await repository.historyOverview(sceneId)
      if (ticket !== request.current) return
      completedRefresh.current = refreshStamp
      setSummaries(overview.snapshots); setUsage(overview.usage); setLegacySources(overview.legacySources)
      setVersionHistory(overview.history); setHistoryError(null); setError(null)
      setVersionId(current => overview.history.versions.some(version => version.id === current && version.automatic) ? current : overview.history.activeVersionId ?? '')
      setSnapshot(current => current && overview.snapshots.some(item => item.id === current.id) ? current : null)
      setBackupIds(current => new Set([...current].filter(id => overview.snapshots.some(item => item.id === id))))
    } catch (failure) {
      if (ticket === request.current) setHistoryError(failure instanceof Error ? failure.message : String(failure))
      throw failure
    } finally {
      if (ticket === request.current) setLoadingHistory(false)
    }
  }
  useEffect(() => {
    completedRefresh.current = null
    setSummaries([]); setUsage(null); setLegacySources([]); setVersionHistory(null); setVersionId(''); setSnapshot(null); setSelected(new Set()); setBackupIds(new Set()); setIncludeHistory(false); setName(''); setRename(null); setDeleting(null); setCreating(false); setError(null); setHistoryError(null); setLoadingHistory(false); setRestoreResult(null); setRestoreError(null); setActiveId(null); pendingFocus.current = null
    return () => { request.current++ }
  }, [sceneId])
  useEffect(() => {
    if (!active) { completedRefresh.current = null; setLoadingHistory(false); return }
    // Revision and protection notifications can arrive before the save finishes.
    // Read the persisted history once after that write, rather than competing
    // with validation/rendering and immediately repeating the same full scan.
    if (refreshBlocked || completedRefresh.current === refreshStamp) { setLoadingHistory(false); return }
    void refresh().catch(() => {})
    return () => { request.current++ }
  }, [active, sceneId, project.document.revision, refreshKey, refreshBlocked])
  const historicalMembers = useMemo(() => snapshot ? memberIds(snapshot.project.document) : new Set<string>(), [snapshot])
  const currentMembers = useMemo(() => memberIds(project.document), [project.document])
  const rows = useMemo(() => {
    if (!snapshot) return []
    const historic = snapshot.project.document
    const label = createEntityLabeler(historic)
    if (mode === 'visual') return historic.visual ? [{ id: historic.sceneId, name: '全图环境与接触阴影', deleted: !project.document.visual, managed: false }, ...VISUAL_ENTITY_COLLECTIONS.flatMap(collection => Object.values(visualBase(historic)![collection]).map(entity => ({ id: entity.id, name: label(entity.id), deleted: !visualBase(project.document)?.[collection][entity.id], managed: false })))] : []
    if (mode === 'layer') return Object.values(historic.userLayers).map(layer => ({ id: layer.id, name: `图层 · ${layer.name}`, deleted: !project.document.userLayers[layer.id], managed: false }))
    if (mode === 'outdoorGeometry' || mode === 'outdoorProperties') return (['terrainAreas', 'terrainEdges', 'terrainConnections', 'paths'] as const).flatMap(collection => Object.values(historic[collection]).map(entity => ({ id: entity.id, name: label(entity.id), deleted: !project.document[collection][entity.id], managed: false })))
    if (mode === 'scatterMembers') {
      const ids = new Set(Object.values(historic.scatterGroups).flatMap(group => Object.values(group.members).flatMap(member => member.propId ? [member.propId] : [])))
      return Object.values(historic.props).filter(prop => ids.has(prop.id)).map(prop => ({ id: prop.id, name: `散布成员 · ${label(prop.id)}`, deleted: !project.document.props[prop.id], managed: false }))
    }
    const groups = Object.values(historic.prefabInstances).map(group => ({ id: group.id, name: `组合 · ${historic.prefabDefinitions[group.definitionRef.id].name}`, deleted: !project.document.prefabInstances[group.id], managed: false }))
    if (mode === 'relationship') return groups
    const props = Object.values(historic.props).filter(prop => mode !== 'entity' || !historicalMembers.has(prop.id)).map(prop => ({ id: prop.id, name: label(prop.id), deleted: !project.document.props[prop.id], managed: mode === 'entity' && currentMembers.has(prop.id) }))
    const surfaces = ['appearance', 'source'].includes(mode) ? Object.keys(snapshot.project.appearance.surfaceSources).map(id => ({ id, name: `表面 · ${historic.rooms[id]?.purpose || id}`, deleted: !project.appearance.surfaceSources[id], managed: false })) : []
    return [...props, ...(mode === 'entity' ? [] : groups), ...surfaces]
  }, [snapshot, historicalMembers, currentMembers, project.document, project.appearance, mode])
  const rowIds = useMemo(() => new Set(rows.filter(row => !row.managed).map(row => row.id)), [rows])
  const filtered = useMemo(() => {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
    return terms.length ? rows.filter(row => terms.every(term => `${row.name}\n${row.id}`.toLowerCase().includes(term))) : rows
  }, [rows, query])
  const invalidCanvas = canvasIds.filter(id => !rowIds.has(id)), deletedCount = rows.filter(row => selected.has(row.id) && row.deleted).length
  const budget = workspace.getManualBudget(selected.size)
  const overBudget = selected.size > budget.semanticTargets, needsRecreation = !['entity', 'relationship', 'scatterMembers'].includes(mode) && deletedCount > 0
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
  const chooseSnapshot = (summary: SnapshotSummary) => void onAction(async () => {
    const checkpoint = workspace.checkpoint(), loaded = await repository.loadNamedSnapshot(summary.id, sceneId)
    if (!loaded) throw new Error('快照已不存在。')
    workspace.assertCheckpoint(checkpoint)
    setSnapshot(loaded); setSelected(new Set()); setQuery(''); setScrollTop(0); setActiveId(null); pendingFocus.current = null; setRename(null); setDeleting(null); setError(null)
    if (viewport.current) viewport.current.scrollTop = 0
  }, '打开历史快照')
  const downloadOriginal = (source: LegacySource) => void onAction(async () => {
    const checkpoint = workspace.checkpoint()
    const original = await repository.loadLegacyOriginal(sceneId, source.nodeId)
    workspace.assertCheckpoint(checkpoint)
    if (original.source.sourceHash !== source.sourceHash || original.source.nodeId !== source.nodeId) throw new Error('迁移来源已变化，请刷新历史列表。')
    const prepared = prepareOriginalDownload(original.source, original.bytes)
    const url = URL.createObjectURL(prepared.blob), anchor = document.createElement('a')
    try { anchor.href = url; anchor.download = prepared.filename; anchor.click() }
    finally { window.setTimeout(() => URL.revokeObjectURL(url), 30_000) }
  }, '下载迁移原件')
  const selectProp = (id: string, checked: boolean) => { setSelected(current => { const next = new Set(current); if (checked) next.add(id); else next.delete(id); return next }); setError(null) }
  const available = summaries.filter(item => item.ownerSceneId === sceneId), backupAvailable = available.filter(item => item.kind !== 'imported-auto'), backupSnapshots = backupAvailable.filter(item => backupIds.has(item.id))
  const namedCount = available.filter(item => item.kind === 'named').length, protectionCount = available.filter(item => item.kind === 'protection').length
  const versions = versionHistory?.versions.filter(version => version.automatic && version.ownerSceneId === sceneId) ?? []
  const versionById = new Map(versions.map(version => [version.id, version])), selectedVersion = versionById.get(versionId)
  const parentVersion = selectedVersion?.parentId ? versionById.get(selectedVersion.parentId) : undefined
  const childVersions = selectedVersion ? versions.filter(version => version.parentId === selectedVersion.id) : []
  const historyPending = loadingHistory || !versionHistory && !historyError
  const historyReady = versionHistory !== null && !historyPending && !historyError
  const restoreVersion = () => selectedVersion && void onAction(async () => {
    const before = workspace.getState().project
    setError(null); setRestoreResult(null); setRestoreError(null)
    try {
      const protection = await workspace.navigateHistoryVersion(selectedVersion.id)
      const restored = workspace.getState().project
      setVersionId('')
      setRestoreResult(`已恢复整个工程的 r${selectedVersion.revision} 内容，此次生成 r${restored?.document.revision ?? project.document.revision}。恢复前内容已保留为「${protection.name}」，也可使用顶部撤销返回。`)
    } catch (failure) {
      const state = workspace.getState(), adopted = state.project
      const message = failure instanceof Error ? failure.message : String(failure)
      setRestoreError(adopted?.document.sceneId === sceneId && adopted.document.revision > (before?.document.revision ?? project.document.revision)
        ? `完整版本已在当前页面采用为 r${adopted.document.revision}，但保存未完成：${message}。可使用顶部撤销返回，或按保存提示重试；请勿直接关闭页面。`
        : `完整版本恢复未完成：${message}`)
      throw failure
    }
  }, '恢复完整版本')
  return <section className="history-panel" aria-label="命名历史" aria-busy={loadingHistory}>
    {historyPending && <p className="asset-muted" role="status">{versionHistory ? '正在刷新历史，暂时显示上次读取的记录…' : refreshBlocked ? '当前操作完成后读取历史…' : '正在读取历史…'}</p>}
    {historyError && <div className="history-limit" role="alert"><p>{versionHistory ? '历史刷新失败，下面保留上次读取的记录。' : '历史读取失败，尚不能确定是否有保存版本或快照。'} {historyError}</p><button className="secondary" disabled={disabled || refreshBlocked || loadingHistory} onClick={() => void onAction(refresh, '重试读取历史')}>重试读取历史</button></div>}
    {restoreResult && <p className="asset-muted" role="status">{restoreResult}</p>}
    {restoreError && <p role="alert" className="history-limit">{restoreError}</p>}
    {error && <p role="alert" className="history-limit">{error}</p>}
    <section className="history-list-section" aria-label="完整版本历史">
      <h3><Archive size={12}/> 完整版本历史<small>{versionHistory ? `${versions.length} 个版本` : '待读取'}</small></h3>
      <p className="asset-muted">完整恢复会采用所选保存版本中整个工程的内容；如只想恢复部分对象，请使用下方快照的局部恢复。操作前会保留当前保护点，原来的后续版本仍可选择。</p>
      <label className="history-mode">保存版本<select aria-label="完整保存版本" disabled={disabled || refreshBlocked || !historyReady || !versions.length} value={versionId} onChange={event => { setVersionId(event.target.value); setRestoreResult(null) }}>
        {!versions.length && <option value="">{historyPending ? '正在读取保存版本…' : historyError ? '保存版本读取失败' : '暂无保存版本'}</option>}
        {versions.map(version => <option value={version.id} key={version.id}>r{version.revision} · {dateLabel(version.savedAt)}{version.parentId && versionById.has(version.parentId) ? ` · 接续 r${versionById.get(version.parentId)!.revision}` : ' · 起始版本'}{version.id === versionHistory?.activeVersionId ? ' · 当前' : ''}</option>)}
      </select></label>
      {selectedVersion && <>
        <div className="history-scope-tools"><button className="secondary" disabled={disabled || refreshBlocked || !parentVersion} onClick={() => parentVersion && setVersionId(parentVersion.id)}>上一个版本{parentVersion ? ` · r${parentVersion.revision}` : ''}</button>
          {childVersions.length === 1 && <button className="secondary" disabled={disabled || refreshBlocked} onClick={() => setVersionId(childVersions[0].id)}>后续版本 · r{childVersions[0].revision}</button>}
          {childVersions.length > 1 && <label className="history-mode">后续分支<select aria-label="选择后续分支" disabled={disabled || refreshBlocked} value="" onChange={event => { if (event.target.value) setVersionId(event.target.value) }}><option value="">选择 {childVersions.length} 个后续版本</option>{childVersions.map(version => <option value={version.id} key={version.id}>r{version.revision} · {dateLabel(version.savedAt)}</option>)}</select></label>}
        </div>
        <button className="secondary asset-wide" aria-label={`恢复整个版本 · r${selectedVersion.revision}`} disabled={disabled || refreshBlocked || !historyReady || selectedVersion.id === versionHistory?.activeVersionId || protectionCount >= HISTORY_LIMITS.protectionPerScene} onClick={restoreVersion}>恢复整个工程至 r{selectedVersion.revision} 的内容</button>
      </>}
      {protectionCount >= HISTORY_LIMITS.protectionPerScene && <p className="history-limit">保护点已满，请先整理保护快照，再恢复完整版本。</p>}
    </section>
    <div className="asset-section-heading"><Archive size={16}/><h2>命名历史</h2><span>{versionHistory ? `${namedCount}/${HISTORY_LIMITS.namedPerScene}` : '待读取'}</span><button type="button" title="新建命名快照" aria-label="新建命名快照" disabled={disabled || namedCount >= HISTORY_LIMITS.namedPerScene} onClick={() => { setCreating(value => !value); setError(null) }}><Plus size={16}/></button><button type="button" title="刷新历史" aria-label="刷新历史" disabled={disabled || refreshBlocked || loadingHistory} onClick={() => void onAction(refresh, '刷新历史')}><RefreshCw size={14}/></button></div>
    {creating && <form className="history-name-form" onSubmit={event => { event.preventDefault(); if (!name.trim()) return; void onAction(async () => { const created = await workspace.createNamedSnapshot(name.trim()); setName(''); setCreating(false); await refresh(); setSnapshot(created); setSelected(new Set()); setQuery(''); setScrollTop(0); setActiveId(null); pendingFocus.current = null }, '新建命名快照') }}><label>快照名称<input autoFocus aria-label="命名快照名称" value={name} maxLength={80} disabled={disabled} onChange={event => setName(event.target.value)}/></label><button className="primary" disabled={disabled || !name.trim()}><Check size={13}/>保存快照</button><button type="button" title="取消创建快照" aria-label="取消创建快照" disabled={disabled} onClick={() => setCreating(false)}><X size={14}/></button></form>}
    {(['named', 'protection', 'imported-auto'] as const).map(kind => <div className="history-list-section" key={kind}>
      <h3>{kind === 'named' ? <Archive size={12}/> : <ShieldCheck size={12}/>} {kind === 'named' ? '命名快照' : kind === 'protection' ? '恢复前保护' : '旧自动保存（只读）'}<small>{!versionHistory ? '待读取' : kind === 'named' ? namedCount : kind === 'protection' ? `${protectionCount}/${HISTORY_LIMITS.protectionPerScene}` : available.filter(item => item.kind === kind).length}</small></h3>
      <div className="history-snapshot-list" aria-label={kind === 'named' ? '命名快照列表' : kind === 'protection' ? '保护快照列表' : '旧自动保存列表'}>{available.filter(item => item.kind === kind).map(summary => <div className={`history-snapshot-row${snapshot?.id === summary.id ? ' selected' : ''}`} data-snapshot-id={summary.id} key={summary.id}>
        <button className="history-snapshot-open" aria-label={`查看快照 ${summary.name}`} aria-pressed={snapshot?.id === summary.id} disabled={disabled} onClick={() => chooseSnapshot(summary)}><strong>{summary.name}</strong><small>r{summary.sourceRevision} · {dateLabel(summary.createdAt)}</small></button>
        {kind === 'named' && <button title="重命名快照" aria-label={`重命名快照 ${summary.name}`} disabled={disabled} onClick={() => { setRename({ snapshot: summary, name: summary.name }); setDeleting(null) }}><Pencil size={13}/></button>}
        {kind !== 'imported-auto' && <button title="删除快照" aria-label={`删除快照 ${summary.name}`} disabled={disabled} onClick={() => { setDeleting(summary); setRename(null) }}><Trash2 size={13}/></button>}
      </div>)}{historyReady && !available.some(item => item.kind === kind) && <p className="history-empty">{kind === 'named' ? '暂无命名快照' : kind === 'protection' ? '暂无恢复前保护快照' : '暂无旧自动保存'}</p>}</div>
    </div>)}
    {rename && <form className="history-name-form" onSubmit={event => { event.preventDefault(); if (!rename.name.trim()) return; void onAction(async () => { await repository.renameNamedSnapshot(rename.snapshot.id, rename.name.trim(), rename.snapshot.contentHash, usage?.metadataVersion, sceneId); if (snapshot?.id === rename.snapshot.id) setSnapshot(await repository.loadNamedSnapshot(rename.snapshot.id, sceneId)); setRename(null); await refresh() }, '重命名快照') }}><label>快照名称<input autoFocus aria-label="修改快照名称" value={rename.name} maxLength={80} disabled={disabled} onChange={event => setRename({ ...rename, name: event.target.value })}/></label><button className="secondary" disabled={disabled || !rename.name.trim()}>保存名称</button><button type="button" aria-label="取消快照改名" disabled={disabled} onClick={() => setRename(null)}><X size={13}/></button></form>}
    {deleting && <div className="history-delete-confirm" role="group" aria-label="删除快照确认"><strong>删除「{deleting.name}」？</strong><span>此快照将从本工程历史移除</span><button className="secondary" disabled={disabled} onClick={() => setDeleting(null)}>取消删除</button><button className="history-danger" disabled={disabled} onClick={() => void onAction(async () => { await repository.deleteNamedSnapshot(deleting.id, deleting.contentHash, usage?.metadataVersion, sceneId); setDeleting(null); await refresh() }, '删除快照')}><Trash2 size={13}/>确认删除快照</button></div>}
    {snapshot && <label className="history-mode history-scope-type">恢复对象<select aria-label="恢复对象类型" disabled={disabled} value={scopeType} onChange={event => setScopeType(event.target.value as typeof scopeType)}><option value="props">组件、地形、外观与图层规则</option><option value="structure">建筑结构与注记</option></select></label>}
    {snapshot && scopeType === 'structure' && <StructureHistoryPanel key={snapshot.id} project={project} snapshot={snapshot} workspace={workspace} session={session} disabled={disabled} onAction={onAction} onPreview={onStructurePreview}/>}
    {snapshot && scopeType === 'props' && <div className="history-scope" aria-label="局部恢复范围">
      <h3>{snapshot.name}<small>r{snapshot.sourceRevision} · {rows.length} 项历史对象</small></h3>
      <label className="history-mode">恢复属性<select aria-label="局部恢复模式" value={mode} disabled={disabled} onChange={event => { setMode(event.target.value as RestoreMode); setSelected(new Set()); setScrollTop(0); setError(null) }}>{modes.map(item => <option value={item.id} key={item.id}>{item.label}</option>)}</select></label>
      <div className="history-scope-tools"><button className="secondary" disabled={disabled || !canvasIds.length || invalidCanvas.length > 0} onClick={() => { setSelected(new Set(canvasIds)); setError(null) }}>使用画布所选 · {canvasIds.length}</button><button type="button" title="清空恢复范围" aria-label="清空恢复范围" disabled={disabled || !selected.size} onClick={() => setSelected(new Set())}><X size={13}/></button></div>
      {invalidCanvas.length > 0 && <p className="history-limit">画布所选中 {invalidCanvas.length} 项不在此恢复模式的历史范围内</p>}
      <label className="history-search"><Search size={13}/><input type="search" aria-label="搜索历史物件" value={query} placeholder="名称或完整 ID" disabled={disabled} onChange={event => { setQuery(event.target.value); setActiveId(null); pendingFocus.current = null; setScrollTop(0); if (viewport.current) viewport.current.scrollTop = 0 }} onKeyDown={event => {
        if (event.nativeEvent.isComposing || (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') || !filtered.length) return
        event.preventDefault(); reveal(event.key === 'ArrowDown' ? 0 : filtered.length - 1, true, event.key === 'ArrowDown' ? 1 : -1)
      }}/></label>
      <div className="history-picker-count"><span>{query.trim() ? `${filtered.length} / ${rows.length}` : rows.length} 件</span><span aria-live="polite">已选 {selected.size} / {budget.semanticTargets}</span></div>
      {filtered.length > 0 ? <div className="history-prop-viewport" ref={viewport} role="group" aria-label="历史对象列表" aria-describedby="history-picker-key-hint" tabIndex={-1} data-total-rows={filtered.length} data-mounted-rows={end - first} style={{ height: viewHeight }} onKeyDown={navigate} onScroll={event => {
        const node = event.currentTarget, top = node.scrollTop
        if (document.activeElement instanceof HTMLInputElement && node.contains(document.activeElement)) {
          const index = Number(document.activeElement.dataset.rowIndex), start = Math.max(0, Math.floor(top / rowHeight) - 3), finish = Math.min(filtered.length, Math.ceil((top + viewHeight) / rowHeight) + 3)
          if (index < start || index >= finish) { node.focus({ preventScroll: true }); const next = nearestNavigable(Math.floor(top / rowHeight), 1); setActiveId(next < 0 ? null : filtered[next].id) }
        }
        setScrollTop(top)
      }}><div style={{ height: filtered.length * rowHeight, position: 'relative' }}>{filtered.slice(first, end).map((row, offset) => <label className={`history-prop-row${selected.has(row.id) ? ' selected' : ''}`} style={{ top: (first + offset) * rowHeight }} data-history-prop-id={row.id} key={row.id}><input type="checkbox" data-row-index={first + offset} data-history-row-id={row.id} tabIndex={first + offset === tabStopIndex ? 0 : -1} aria-label={`恢复物件 ${row.id}`} checked={selected.has(row.id)} disabled={disabled || row.managed} onFocus={() => { pendingFocus.current = null; setActiveId(row.id) }} onChange={event => selectProp(row.id, event.target.checked)}/><span><strong>{row.name}</strong><small title={row.id}>{row.id}</small></span><em>{row.managed ? '现属组合' : row.deleted ? '已删除' : '现有'}</em></label>)}</div></div> : <p className="history-empty">{rows.length ? '没有匹配物件' : '此模式没有可恢复的历史对象'}</p>}
      {filtered.length > 0 && <p className="history-picker-key-hint" id="history-picker-key-hint">↑↓ / Home / End / Page Up / Page Down 浏览 · 空格勾选</p>}
      {selected.size > 0 && <details className="history-selected-ids"><summary>完整恢复范围 · {selected.size} 件</summary><textarea aria-label="局部恢复完整 ID" readOnly rows={Math.min(6, selected.size)} value={[...selected].join('\n')}/></details>}
      {overBudget && <p role="alert" className="history-limit">已选 {selected.size} 件，超过单次 {budget.semanticTargets} 件上限；未截断范围</p>}
      {needsRecreation && <p role="alert" className="history-limit">所选含 {deletedCount} 件已删除物件，须使用完整物件或整组关系模式</p>}
      <button className="primary asset-wide" disabled={disabled || !selected.size || overBudget || needsRecreation} onClick={() => void onAction(async () => { const next = await workspace.prepareRestore(snapshot.id, { ids: [...selected], mode }); onPreview(next); setError(null) }, '预览局部恢复')}>预览局部恢复 · {selected.size} 件</button>
    </div>}
    {legacySources.length > 0 && <section className="history-originals" aria-label="迁移原件">
      <h3>迁移原件 <small>{legacySources.length} 份</small></h3>
      <p className="asset-muted">保留转换前的确切原件。下载不改变当前工程或历史。</p>
      {legacySources.map(source => <article className="composition-diff-item" data-legacy-source-node={source.nodeId} key={source.nodeId}>
        <strong>旧 v{source.sourceSchemaVersion} · r{source.sourceRevision}</strong>
        <details><summary>来源与完整摘要</summary><dl className="asset-facts">
          <dt>来源工程</dt><dd>{source.sourceSceneId}</dd>
          <dt>原件摘要</dt><dd className="catalog-hash">{source.sourceHash}</dd>
          <dt>来源节点</dt><dd>{source.nodeId}</dd>
          <dt>前序节点</dt><dd>{source.previousNodeId ?? '无'}</dd>
          <dt>转换器</dt><dd>{source.migratorVersion}</dd>
          <dt>保留时间</dt><dd>{dateLabel(source.migratedAt)}</dd>
        </dl></details>
        <button className="secondary asset-wide" disabled={disabled} onClick={() => downloadOriginal(source)}><Download size={14}/>下载迁移原件 v{source.sourceSchemaVersion} · r{source.sourceRevision}</button>
      </article>)}
    </section>}
    {usage && <dl className="history-usage"><dt>资源</dt><dd>{bytes(usage.resourceBytes)} / {bytes(usage.limits.storedResourceBytes)}</dd><dt>场景与历史</dt><dd>{bytes(usage.documentBytes)} / {bytes(usage.limits.storedDocumentBytes)}</dd><dt>迁移原件</dt><dd>{bytes(usage.originalBytes)} / {bytes(usage.limits.storedOriginalBytes)}</dd></dl>}
    <div className="history-backup"><label><input type="checkbox" aria-label="备份携带所选快照" checked={includeHistory} disabled={disabled} onChange={event => setIncludeHistory(event.target.checked)}/>携带所选命名与保护快照</label>
      {includeHistory && <div className="history-backup-scope" aria-label="历史备份范围">
        <div className="history-backup-tools"><span aria-live="polite">已选 {backupSnapshots.length} / {backupAvailable.length} 份</span><button type="button" disabled={disabled || !backupAvailable.length} onClick={() => setBackupIds(new Set(backupAvailable.map(item => item.id)))}>全选</button><button type="button" disabled={disabled || !backupSnapshots.length} onClick={() => setBackupIds(new Set())}>清空</button></div>
        <div className="history-backup-list">{backupAvailable.map(item => <label data-backup-snapshot-id={item.id} key={item.id}><input type="checkbox" aria-label={`备份快照 ${item.name}`} checked={backupIds.has(item.id)} disabled={disabled} onChange={event => { const checked = event.target.checked; setBackupIds(current => { const next = new Set(current); if (checked) next.add(item.id); else next.delete(item.id); return next }) }}/><span><strong>{item.name}</strong><small>{item.kind === 'named' ? '命名' : '保护'} · r{item.sourceRevision} · {dateLabel(item.createdAt)}</small></span></label>)}</div>
        {historyReady && !backupAvailable.length && <p className="history-empty">先创建快照，再选择需要携带的历史</p>}
        {backupSnapshots.length > 0 && <details className="history-selected-ids"><summary>完整备份范围 · {backupSnapshots.length} 份</summary><textarea aria-label="历史备份完整范围" readOnly rows={Math.min(6, backupSnapshots.length * 2)} value={backupSnapshots.map(item => `${item.name} · ${item.kind === 'named' ? '命名' : '保护'} · r${item.sourceRevision}\n${item.id}`).join('\n')}/></details>}
      </div>}
      <button className="secondary asset-wide" disabled={disabled || includeHistory && !backupSnapshots.length} onClick={() => onBackup(includeHistory ? backupSnapshots.map(item => item.id) : undefined, sceneId)}><Download size={14}/>{includeHistory ? `下载工程与所选历史 · ${backupSnapshots.length} 份` : '下载完整工程'}</button>
    </div>
  </section>
}

const modeLabels: Record<RestoreMode, string> = { appearance: '历史有效外观，保留当前层规则', source: '历史固定源与参数，跟随当前层效果', transform: '位置与角度', entity: '完整独立物件', relationship: '整组关系与实际成员', layer: '持续图层规则及当前成员', outdoorGeometry: '现存室外几何，保留当前拓扑', outdoorProperties: '现存室外几何与业务属性', scatterMembers: '显式历史散布成员及明确抑制记录', visual: '本会话视觉参数，保持当前绑定与采样拓扑' }
const json = (value: unknown) => value === undefined ? '无' : JSON.stringify(value, null, 2)
const changeKinds: Record<RestoreChange['kind'], string> = { prop: '物件', prefabInstance: '组合', surface: '表面', layer: '图层规则', outdoor: '地形与通路', scatterGroup: '散布组', visual: '视觉效果', generation: '生成规则' }
const restoreFields: Record<string, string> = {
  id: '对象标识', floorId: '基础地面', roomId: '所属房间', supportRef: '支撑表面', definitionRef: '固定素材', positionMm: '位置', anchorMm: '组合位置', rotationDeg: '角度', scale: '缩放',
  appearance: '外观', visualBoundsMm: '图像尺寸', footprintMm: '物理占地', widthMm: '宽度', heightMm: '高度', elevationMm: '高程', groundElevationMm: '地面高程',
  visibility: '玩家可见性', editLocked: '编辑锁', blocksMovement: '阻挡通行', blocksSight: '阻挡视线', shadowClass: '阴影类别', shadowOverride: '阴影覆盖',
  entity: '完整物件', membership: '成员关系', members: '成员关系', selectedMembership: '所选成员关系', selectedMember: '所选散布成员', selectedDeleteExclusions: '所选删除排除记录',
  sourceId: '固定来源', adjustments: '外观调整', layerAdjustments: '持续图层规则', surfaceStyle: '表面材质', boundaryMm: '地形轮廓', centerlineMm: '路线轮廓',
  kind: '类型', route: '高差连接路线', from: '连接起点', to: '连接终点', shoreline: '岸线', source: '来源边段', traversable: '允许通行',
  controlPointsMm: '曲线控制点', samples: '曲线采样', smoothing: '曲线平滑', binding: '几何绑定', opacity: '透明度', color: '颜色', tint: '色调',
  intensity: '强度', radiusMm: '半径', blurMm: '模糊范围', falloff: '衰减', enabled: '启用状态', preset: '预设', target: '作用范围', environment: '环境',
  ambient: '环境光', contactShadows: '接触阴影', generation: '生成关联', ownership: '生成归属', rules: '生成规则', checks: '生成检查', exclusions: '排除记录',
  closed: '闭合曲线', segments: '曲线段', sampleSpacingMm: '采样间距', toleranceMm: '曲线容差', boundaryId: '来源曲线', side: '作用侧', accentColor: '强调色',
  seed: '随机种子', repeatMm: '重复间距', wallOcclusion: '墙体遮光', directionDeg: '方向', scaleMm: '效果尺度', exposure: '曝光', saturation: '饱和度', contrast: '对比度', vignette: '暗角', grain: '颗粒',
  ambientColor: '环境光颜色', ambientOpacity: '环境光透明度', lightDirectionDeg: '光照方向', contactShadowMm: '接触阴影范围', contactShadowOpacity: '接触阴影透明度',
  coveragePriority: '地形覆盖顺序', movementCostMultiplier: '移动成本倍率', styleOverride: '边缘外观覆盖', renderOrder: '显示顺序',
}
const restoreFieldLabel = (field: string) => restoreFields[field] ?? field
const recordValue = (value: unknown): Record<string, unknown> | undefined => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
function changeFieldValue(value: unknown, field: string): unknown {
  const record = recordValue(value)
  if (!record) return value
  if (Object.hasOwn(record, field)) return record[field]
  if (field === 'selectedMember') return record.member
  if (field === 'selectedDeleteExclusions') return record.exclusions
  const entity = recordValue(record.entity)
  return entity && Object.hasOwn(entity, field) ? entity[field] : value
}
function restoreValueLabel(value: unknown, field: string, label: (id: string) => string): string {
  if (value == null) return '无'
  if (typeof value === 'boolean') return value ? '是' : '否'
  if (value === 'gm') return '仅主持人可见'
  if (value === 'public') return '玩家可见'
  if (typeof value === 'number') return field.endsWith('Mm') ? `${Number((value / 1000).toFixed(3))} m` : field === 'rotationDeg' ? `${value}°` : String(value)
  if (typeof value === 'string') return label(value)
  if (Array.isArray(value)) return `${value.length} 项`
  const record = recordValue(value)!
  if (typeof record.x === 'number' && typeof record.y === 'number') return `${Number((record.x / 1000).toFixed(3))} m, ${Number((record.y / 1000).toFixed(3))} m`
  if (typeof record.id === 'string' && Object.keys(record).length <= 3) return label(record.id)
  if (field === 'members' || field === 'layerAdjustments') return `${Object.keys(record).length} 项`
  return '已设置'
}
export function RestoreChangesPanel({ preview, current }: { preview: RestorePreview; current: EditableProject }) {
  const publicIds = (scene: SceneDocument) => {
    const projection = projectScene(scene, 'player')
    return new Set([...projection.rooms, ...projection.terrain, ...projection.walls, ...projection.props, ...projection.edges, ...projection.paths, ...projection.connections, ...projection.notes, ...projection.regions, ...projection.walls.flatMap(wall => wall.openings)].map(entity => entity.id))
  }
  const playerBefore = publicIds(current.document), playerAfter = publicIds(preview.project.document)
  const newlyPublic = [...playerAfter].filter(id => !playerBefore.has(id))
  const beforeLabel = createEntityLabeler(current.document), afterLabel = createEntityLabeler(preview.project.document)
  const name = (id: string) => id === current.document.sceneId ? '全图环境与接触阴影' : afterLabel(id) !== id ? afterLabel(id) : beforeLabel(id)
  const scope = (ids: string[]) => ids.map(id => `${name(id)}\n${id}`).join('\n\n')
  return <section className="history-changes" aria-label="局部恢复差异"><div className="asset-section-heading"><Archive size={16}/><h2>局部恢复差异</h2></div>
    <dl className="asset-facts"><dt>历史快照</dt><dd>{preview.snapshot.name} · r{preview.snapshot.sourceRevision}</dd><dt>当前修订</dt><dd>r{preview.currentRevision}</dd><dt>恢复属性</dt><dd>{modeLabels[preview.plan.request.mode]}</dd><dt>请求 / 实际变化</dt><dd>{preview.plan.request.ids.length} / {preview.plan.changes.length} 项</dd><dt>独立编辑对象</dt><dd>{preview.plan.commandCost} / {(preview.budgetProfile ?? selectManualTransactionBudget(current.document, preview.plan.request.ids.length)).semanticTargets}</dd></dl>
    <p className="asset-muted">采用前先保存当前保护点。范围外的新编辑、当前编辑锁和未明确请求的图层规则保留。</p>
    {preview.plan.request.mode === 'source' && <p className="history-limit">恢复历史来源和实例参数后，会重新继承当前图层；实际结果可能与快照中的有效外观不同，请核对画布。</p>}
    {preview.plan.request.mode === 'scatterMembers' && <p className="history-limit">本次可重建明确选择的历史成员。请逐项核对成员、删除/退出与排除记录变化；后续人工和入口保留区保持。</p>}
    {preview.plan.request.mode === 'layer' && <p className="history-limit">本次恢复持续图层规则，会影响该层当前成员及后续移入对象；下方列出当前实际范围。</p>}
    {newlyPublic.length > 0 && <p role="alert" className="history-privacy-review">{newlyPublic.length} 项恢复可能新增玩家可见内容，采用前请核对可见性及玩家输出。</p>}
    <details className="history-selected-ids"><summary>完整实际范围 · {preview.plan.affectedIds.length} 项</summary><textarea readOnly aria-label="局部恢复完整实际范围" rows={5} value={scope(preview.plan.affectedIds)}/></details>
    {preview.plan.inapplicableIds.length > 0 && <details className="history-selected-ids"><summary>本次不适用 · {preview.plan.inapplicableIds.length} 项</summary><textarea readOnly aria-label="恢复不适用对象" rows={4} value={scope(preview.plan.inapplicableIds)}/></details>}
    {!preview.plan.changed && <p className="history-empty">所选属性与当前一致，无需恢复。</p>}
    {preview.plan.changes.map(change => <article className="composition-diff-item" key={`${change.kind}-${change.id}`} data-restore-change-id={change.id}>
      <h3>{name(change.id) === change.id ? change.name : name(change.id)}<small>{change.action === 'recreate' ? '重建' : change.action === 'delete' ? '删除' : '更新'} · {changeKinds[change.kind]}</small></h3>
      <p className="asset-muted">图层：{current.document.userLayers[change.beforeLayerId ?? '']?.name ?? change.beforeLayerId ?? '无'} → {preview.project.document.userLayers[change.layerId]?.name ?? (change.layerId || '无')}</p>
      <dl className="asset-facts">{change.fields.map(field => {
        const before = changeFieldValue(change.before, field), after = changeFieldValue(change.after, field)
        const beforeText = restoreValueLabel(before, field, beforeLabel), afterText = restoreValueLabel(after, field, afterLabel)
        const contentChanged = beforeText === afterText && json(before) !== json(after)
        return <div key={field}><dt>{restoreFieldLabel(field)}</dt><dd>{beforeText} → {afterText}{contentChanged ? '（内容已变化，展开查看）' : ''}</dd></div>
      })}</dl>
      {change.historicalEditLocked !== undefined && <p className="asset-muted">历史{change.historicalEditLocked ? '曾锁定' : '未锁定'} · {change.action === 'recreate' ? '重建默认未锁' : '保留当前编辑锁'}</p>}
      <details><summary>完整 ID 与原始值 · 当前 → 采用</summary><code>{change.id}</code><pre>{json(change.before)}{'\n↓\n'}{json(change.after)}</pre></details>
    </article>)}
  </section>
}
