import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Archive, ArrowLeft, CheckCircle2, Download, Layers3, LoaderCircle, Move, Redo2, RotateCw, Undo2, Upload, X } from 'lucide-react'
import { SceneRepositoryV4 } from '../../io/v4/storage'
import { importProjectV3 } from '../../io/v3/project-file'
import type { CompleteProjectV2 } from '../../io/v2/types'
import { importProjectV2 } from '../../io/v2/project-file'
import type { CompleteProjectV3 } from '../../io/v3/types'
import { createLayerProject } from '../../io/v3/migration'
import { migrateProjectV3ToV4, migrationOriginalV4 } from '../../io/v4/migration'
import { exportProjectV4, exportHistoryArchiveV4, importProjectV4, importHistoryArchiveV4, inspectPackageModeV4, inspectProjectVersionV4, toCompleteProjectV3, validateCompleteProjectV4 } from '../../io/v4/project-file'
import type { CompleteProjectV4, HistoryArchiveV4 } from '../../io/v4/types'
import { toGeometryDocumentV2 } from '../../core/v3/geometry-view'
import type { SceneCommandV3 } from '../../core/v3/commands'
import type { SceneDocumentV3 } from '../../core/v3/types'
import UserLayerPanel from '../v3/UserLayerPanel'
import { domainProjectV3, hiddenEntitiesV3, scopedHiddenEntitiesV3, hitTestLayersV3, selectInBoundsLayersV3, selectionGeometryLayersV3, summarizeSelectionLayersV3 } from '../v3/layer-view'

import { SceneRepository } from '../../io/storage'
import { bootEditor, flushSave, useEditorStore } from '../store'
import { createCalibrationProject } from '../v2/calibration'
import { validateStudyEditsV2 } from '../v2/study-constraints'
import { validateIslandEditsV2 } from '../v2/island-constraints'
import { createPlacedPropV3 } from '../../core/v3/commands'
import type { PointMm, PropV2 } from '../../core/v2/types'
import { exportPngV3, renderEditorProjectV3 } from '../../render/v3/renderer'
import { NumberInput } from '../v2/controls'
import SceneInspector from '../v2/SceneInspector'
import SceneLibrary from '../v2/SceneLibrary'
import TerrainTravelPanel from '../v2/TerrainTravelPanel'
import { migrateProjectV1, prepareProjectFile } from '../v2/migration-project'
import { WorkspaceV4, type RestorePreviewV4 } from './workspace'
import HistoryPanel, { RestoreChangesPanel } from './HistoryPanel'
import AssetCanvas from '../v2/AssetCanvas'
import NewSceneForm, { type NewSceneOptionsV2 } from '../v2/NewSceneForm'
import PlacementInspector from '../v2/PlacementInspector'
import SelectionInspector from '../v2/SelectionInspector'
import SceneContextMenu, { type SceneMenuV2 } from '../v2/SceneContextMenu'
import { normalizeSelectionV2 } from '../v2/selection'
import { selectionCommandsV2, type SelectionActionV2 } from '../v2/selection-actions'
import { SelectionSessionV2 } from '../v2/selection-session'
import { SelectionSubscriber } from '../v2/SelectionSubscriber'
import '../v2/assets.css'
import '../v3/layers.css'
import './history.css'

const repository = new SceneRepositoryV4()
export const historyWorkspace = new WorkspaceV4(repository, document => { const geometry = toGeometryDocumentV2(document); validateStudyEditsV2(geometry); validateIslandEditsV2(geometry) })
const createStudyProject = async (signal: AbortSignal) => (await import('../v2/study-sample')).createStudyProject(signal)
const createIslandProject = async (signal: AbortSignal) => (await import('../v2/island-sample')).createIslandProject(signal)
let opened: Promise<void> | undefined
const ready = () => opened ??= repository.open().catch(error => { opened = undefined; throw error })
const bytesLabel = (bytes: number) => `${(bytes / 1024).toFixed(1)} KiB`
const download = (blob: Blob, name: string) => {
  const url = URL.createObjectURL(blob), anchor = document.createElement('a')
  anchor.href = url; anchor.download = name; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 30_000)
}
type Candidate = { project: CompleteProjectV4; checkpoint: number; description: string; archive?: HistoryArchiveV4 }
type StructurePreview = { checkpoint: number; commands: SceneCommandV3[]; document: SceneDocumentV3; description: string; kind?: 'batch' | 'layer'; scopeIds?: string[] }

export default function HistoryWorkbench({ onBack, source }: { onBack: () => void; source?: CompleteProjectV3 | null }) {
  const state = useSyncExternalStore(historyWorkspace.subscribe, historyWorkspace.getState), completeProject = state.project
  const project = useMemo(() => completeProject ? domainProjectV3(toCompleteProjectV3(completeProject)) : null, [completeProject])
  const [currentLayerId, setCurrentLayerId] = useState(''), [hiddenLayerIds, setHiddenLayerIds] = useState<ReadonlySet<string>>(new Set()), [soloLayerId, setSoloLayerId] = useState<string | null>(null), [currentOnly, setCurrentOnly] = useState(false)
  const effectiveHiddenLayers = useMemo(() => new Set(completeProject ? Object.keys(completeProject.document.userLayers).filter(id => hiddenLayerIds.has(id) || soloLayerId !== null && soloLayerId !== id) : []), [completeProject?.document, hiddenLayerIds, soloLayerId])
  const hiddenIds = useMemo(() => completeProject ? hiddenEntitiesV3(completeProject.document, effectiveHiddenLayers) : new Set<string>(), [completeProject?.document, effectiveHiddenLayers])
  const scopedHiddenIds = useMemo(() => completeProject ? scopedHiddenEntitiesV3(completeProject.document, hiddenIds, currentOnly ? currentLayerId : null) : hiddenIds, [completeProject?.document, hiddenIds, currentOnly, currentLayerId])
  const selectionOptions = useMemo(() => ({ hiddenIds: scopedHiddenIds }), [scopedHiddenIds])
  const [recent, setRecent] = useState<Awaited<ReturnType<SceneRepositoryV4['list']>>>([])
  const [busy, setBusy] = useState(false), [message, setMessage] = useState<string | null>(null)
  const [selectionSession] = useState(() => new SelectionSessionV2())
  const setSelected = (id: string | null) => selectionSession.set(id ? [id] : [])
  const [layerMoveRequest, setLayerMoveRequest] = useState(0)
  const [memberMode, setMemberMode] = useState(false), [menu, setMenu] = useState<SceneMenuV2 | null>(null), [fitRequest, setFitRequest] = useState(0)
  const [candidate, setCandidate] = useState<Candidate | null>(null)
  const [sidebar, setSidebar] = useState<'scene' | 'history'>('scene'), [historyRefresh, setHistoryRefresh] = useState(0)
  const [restore, setRestore] = useState<RestorePreviewV4 | null>(null)
  const restoreRef = useRef<RestorePreviewV4 | null>(null)
  restoreRef.current = restore
  const [structure, setStructure] = useState<StructurePreview | null>(null), [audience, setAudience] = useState<'gm' | 'player'>('gm')
  const [newScene, setNewScene] = useState(false)
  const [creatingStage, setCreatingStage] = useState<'preparing' | 'saving' | null>(null)
  const creatingStageRef = useRef<'preparing' | 'saving' | null>(null)
  const [placement, setPlacement] = useState<{ prop: PropV2; checkpoint: number } | null>(null)
  const [placementReady, setPlacementReady] = useState(false)
  const previewRef = useRef(false)
  previewRef.current = !!structure || !!restore
  const editingBlocked = !!structure || !!restore
  const placingRef = useRef(false)
  placingRef.current = !!placement
  const file = useRef<HTMLInputElement>(null), controller = useRef<AbortController | null>(null), shell = useRef<HTMLDivElement>(null), dialog = useRef<HTMLDivElement>(null)
  const modalOrigin = useRef<HTMLElement | null>(null)
  const actionPending = useRef(false)
  const refresh = async () => { await ready(); setRecent(await repository.list()) }
  const action = async (run: () => Promise<void>, failureSource = '工程操作') => {
    if (actionPending.current) return
    actionPending.current = true
    if (!candidate && !newScene && !document.activeElement?.closest('[role="dialog"]')) modalOrigin.current = document.activeElement as HTMLElement | null
    setBusy(true); setMessage(null)
    try { await run() } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') setMessage('准备已取消，当前工程和本地存档未改变。')
      else setMessage(`${failureSource}：${error instanceof Error ? error.message : String(error)}`)
    }
    finally { actionPending.current = false; setBusy(false) }
  }
  useEffect(() => { void refresh().catch(error => setMessage(String(error))); return () => { controller.current?.abort() } }, [])
  useEffect(() => {
    // Remembering the selection is optional; IndexedDB owns the complete project.
    try { if (project) localStorage.setItem('sceneweave.historySceneId', project.document.sceneId) } catch { /* The recent list still permits reopening. */ }
    setSelected(null)
    setStructure(null); setRestore(null); setAudience('gm'); setMemberMode(false); setHiddenLayerIds(new Set()); setSoloLayerId(null); setCurrentOnly(false); setLayerMoveRequest(0); setCurrentLayerId(Object.keys(completeProject?.document.userLayers ?? {})[0] ?? '')
    if (project) void refresh().catch(() => {})
  }, [project?.document.sceneId])
  useEffect(() => { if (state.status === 'saved') void refresh().catch(() => {}) }, [state.status, project?.document.revision])
  useEffect(() => { if (restoreRef.current) historyWorkspace.cancelRestore(restoreRef.current); setRestore(null) }, [project?.document.sceneId, project?.document.revision])
  useEffect(() => { setPlacement(null); setMenu(null); if (project) selectionSession.set(normalizeSelectionV2(project.document, selectionSession.getSnapshot(), true).filter(id => !scopedHiddenIds.has(id))) }, [project, audience, scopedHiddenIds])
  useEffect(() => {
    if (import.meta.env.DEV) Reflect.set(window, '__sceneweaveHistoryDev', { workspace: historyWorkspace, repository })
    const unload = (event: BeforeUnloadEvent) => { if (!['empty', 'saved'].includes(historyWorkspace.getState().status)) { event.preventDefault(); event.returnValue = '' } }
    const key = (event: KeyboardEvent) => {
      if (actionPending.current) return
      if (previewRef.current) { if (event.key === 'Escape' && !(event.target as HTMLElement)?.closest('input,textarea,select,[contenteditable]')) { event.preventDefault(); setStructure(null); if (restoreRef.current) historyWorkspace.cancelRestore(restoreRef.current); setRestore(null) }; return }
      if ((event.target as HTMLElement)?.closest('input,textarea,select,[contenteditable]') || event.isComposing || document.querySelector('[role="dialog"],[role="menu"]')) return
      if (event.key === 'Escape' && placingRef.current) { event.preventDefault(); setPlacement(null); return }
      if ((event.metaKey || event.ctrlKey) && ['z', 'y', 's'].includes(event.key.toLowerCase())) {
        event.preventDefault()
        try {
          if (event.key.toLowerCase() === 's') void action(() => historyWorkspace.flush())
          else if (event.key.toLowerCase() === 'y' || event.shiftKey) historyWorkspace.redo()
          else historyWorkspace.undo()
        } catch (error) { setMessage(String(error)) }
      }
    }
    window.addEventListener('beforeunload', unload); window.addEventListener('keydown', key)
    return () => { if (restoreRef.current) historyWorkspace.cancelRestore(restoreRef.current); window.removeEventListener('beforeunload', unload); window.removeEventListener('keydown', key) }
  }, [])
  useEffect(() => {
    if (!candidate && !newScene) return
    const prior = modalOrigin.current, background = shell.current
    if (background) background.inert = true
    dialog.current?.querySelector<HTMLButtonElement>('button')?.focus()
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (newScene && creatingStageRef.current === 'preparing') { controller.current?.abort(); setNewScene(false) }
        else if (!busy) { setCandidate(null); setNewScene(false) }
      }
      if (event.key === 'Tab') {
        const controls = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),a[href]') ?? [])
        if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1)?.focus() }
        if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0]?.focus() }
      }
    }
    window.addEventListener('keydown', key)
    return () => { if (background) background.inert = false; window.removeEventListener('keydown', key); requestAnimationFrame(() => { if (prior?.isConnected) prior.focus() }) }
  }, [candidate, newScene, busy])
  // Reopen the last successful asset scene without changing M0's database or selection.
  useEffect(() => {
    if (source || historyWorkspace.getState().project) return
    let id: string | null = null
    try { id = localStorage.getItem('sceneweave.historySceneId') } catch { /* Preferences may be unavailable independently of IndexedDB. */ }
    if (!id) return
    const checkpoint = historyWorkspace.checkpoint()
    void action(async () => { await ready(); const saved = await repository.load(id); if (saved) await historyWorkspace.openPersisted(saved, checkpoint) })
  }, [])
  const prepare = (factory: (signal: AbortSignal) => Promise<CompleteProjectV2 | CompleteProjectV3 | CompleteProjectV4 | HistoryArchiveV4>, description: string) => void action(async () => {
    setAudience('gm')
    controller.current?.abort(); const abort = new AbortController(); controller.current = abort
    const checkpoint = historyWorkspace.checkpoint()
    try {
      const input = await factory(abort.signal), archive = 'snapshots' in input ? input : undefined
      const supplied = archive ? archive.project : input as CompleteProjectV2 | CompleteProjectV3 | CompleteProjectV4
      const prepared = 'historyIdentity' in supplied ? supplied : await migrateProjectV3ToV4(supplied.document.schemaVersion === 3 ? supplied as CompleteProjectV3 : await createLayerProject(supplied as CompleteProjectV2, { signal: abort.signal }), { signal: abort.signal })
      abort.signal.throwIfAborted(); historyWorkspace.assertCheckpoint(checkpoint)
      setCandidate({ project: prepared, checkpoint, description, ...(archive ? { archive } : {}) })
    } finally { if (controller.current === abort) controller.current = null }
  }, '准备打开工程')
  const migrateCurrent = () => prepare(async signal => {
    await bootEditor(); await flushSave(); signal.throwIfAborted()
    const current = useEditorStore.getState().document
    if (!current) throw new Error('尚无可迁移的 M0 场景。')
    const old = new SceneRepository()
    try {
      const persisted = await old.load(current.sceneId)
      if (!persisted) throw new Error('M0 场景尚未成功保存。请返回几何工坊完成保存。')
      signal.throwIfAborted()
      return await migrateProjectV1(persisted)
    } finally { old.close() }
  }, '从 M0 已保存修订创建独立副本，保留原工程及迁移来源。')
  const openNewScene = () => {
    modalOrigin.current = document.activeElement as HTMLElement | null
    setPlacement(null); setMessage(null); setNewScene(true)
  }
  const createScene = (options: NewSceneOptionsV2) => void action(async () => {
    controller.current?.abort(); const abort = new AbortController(); controller.current = abort
    creatingStageRef.current = 'preparing'; setCreatingStage('preparing')
    const checkpoint = historyWorkspace.checkpoint()
    try {
      await ready(); await historyWorkspace.flush(); abort.signal.throwIfAborted()
      const { createBlankProjectV2 } = await import('../v2/blank-project')
      abort.signal.throwIfAborted()
      const prepared = await createBlankProjectV2(options, abort.signal)
      abort.signal.throwIfAborted(); historyWorkspace.assertCheckpoint(checkpoint)
      creatingStageRef.current = 'saving'; setCreatingStage('saving')
      const layered = await createLayerProject(prepared, { signal: abort.signal }), historical = await migrateProjectV3ToV4(layered, { signal: abort.signal })
      abort.signal.throwIfAborted(); await historyWorkspace.adoptNew(historical, checkpoint)
      setNewScene(false); setSelected(null); setAudience('gm'); await refresh()
    } finally { if (controller.current === abort) controller.current = null; creatingStageRef.current = null; setCreatingStage(null) }
  }, '创建空白场景')
  const cancelNewScene = () => {
    if (actionPending.current && creatingStageRef.current !== 'preparing') return
    if (creatingStageRef.current === 'preparing') controller.current?.abort()
    setNewScene(false)
  }
  useEffect(() => {
    let disposed = false
    queueMicrotask(() => { if (!disposed && source) prepare(async signal => migrateProjectV3ToV4(source, { signal }), '从当前 v3 工程创建独立历史副本；原件保留，原自动 20 次保存记录不迁移。') })
    return () => { disposed = true }
  }, [source])
  useEffect(() => {
    if (completeProject && !completeProject.document.userLayers[currentLayerId]) setCurrentLayerId(Object.keys(completeProject.document.userLayers)[0] ?? '')
  }, [completeProject?.document, currentLayerId])
  const choosePlacement = (definitionId: string, position?: PointMm) => {
    if (!project || !completeProject || busy || editingBlocked || audience !== 'gm') return
    try {
      const layer = completeProject.document.userLayers[currentLayerId]
      if (!layer || layer.editLocked || effectiveHiddenLayers.has(layer.id)) throw new Error('请先选择可见且未锁定的当前图层。')
      const b = project.document.exportBoundsMm
      const prop = createPlacedPropV3(completeProject.document, definitionId, position ?? { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) }, { layerId: currentLayerId })
      setPlacementReady(false); setPlacement({ prop, checkpoint: historyWorkspace.checkpoint() }); setSelected(null); setMessage(null)
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)) }
  }
  const placeAt = (positionMm: PointMm) => {
    if (!placement || busy || editingBlocked || audience !== 'gm') return
    if (!placementReady) return
    try {
      historyWorkspace.assertCheckpoint(placement.checkpoint)
      const prop = placement.prop
      historyWorkspace.execute([{ type: 'addProp', id: prop.id, floorId: prop.floorId, definitionRef: prop.definitionRef!, positionMm, rotationDeg: prop.rotationDeg, supportRef: prop.supportRef, layerId: currentLayerId }])
      setPlacement(null); setSelected(prop.id); setMessage(null)
    } catch (error) { setMessage(`未放置：${error instanceof Error ? error.message : String(error)}`) }
  }
  const downloadOriginal = (schema: 1 | 2 | 3) => void action(async () => { if (!completeProject) return; const blob = await migrationOriginalV4(completeProject, schema); if (!blob) throw new Error('本地没有此版本的迁移原件。'); download(blob, `sceneweave-original-v${schema}.sceneweave`) })
  const backup = (snapshotIds?: readonly string[], sceneId = completeProject?.document.sceneId) => {
    if (!completeProject || !sceneId) return
    const selected = snapshotIds === undefined ? undefined : [...snapshotIds]
    void action(async () => {
      const checkpoint = historyWorkspace.checkpoint()
      if (historyWorkspace.getState().project?.document.sceneId !== sceneId) throw new Error('备份所属工程已切换，请重新选择备份范围。')
      if (selected && !selected.length) throw new Error('请先明确勾选需要携带的历史快照。')
      await historyWorkspace.flush(); historyWorkspace.assertCheckpoint(checkpoint)
      const current = historyWorkspace.getState().project!
      if (current.document.sceneId !== sceneId) throw new Error('备份所属工程已切换，请重新选择备份范围。')
      const blob = selected
        ? await exportHistoryArchiveV4(await repository.exportArchive(sceneId, selected))
        : await exportProjectV4(current)
      historyWorkspace.assertCheckpoint(checkpoint)
      if (historyWorkspace.getState().project?.document.sceneId !== sceneId) throw new Error('备份所属工程已切换，请重新选择备份范围。')
      download(blob, selected ? 'sceneweave-history.sceneweave' : 'sceneweave-complete.sceneweave')
      setMessage(selected ? `已生成当前完整工程与所选 ${selected.length} 份快照备份。` : '已生成当前完整工程，含全部资源、许可和秘密。')
    }, '下载工程备份')
  }
  const commit = (run: () => void) => { try { if (editingBlocked) throw new Error('请先采用或取消当前预览。'); run(); setMessage(null) } catch (error) { setMessage(error instanceof Error ? error.message : String(error)) } }
  const preview = (input: SceneCommandV3[] | (() => SceneCommandV3[]), description: string, scopeIds?: string[]) => {
    if (!project || restore) return
    try {
      const commands = typeof input === 'function' ? input() : input
      const checkpoint = structure?.checkpoint ?? historyWorkspace.checkpoint()
      historyWorkspace.assertCheckpoint(checkpoint)
      const document = historyWorkspace.preview(commands)
      setStructure({ checkpoint, commands, document, description, scopeIds, ...(scopeIds ? { kind: 'layer' as const } : {}) }); setMessage(null)
    } catch (error) { setMessage(`候选未通过，工程未修改：${error instanceof Error ? error.message : String(error)}`) }
  }
  const select = (id: string | null, operation: 'replace' | 'add' | 'subtract' = 'replace') => { if (editingBlocked) return; if (id && scopedHiddenIds.has(id)) { setMessage('该对象在隐藏图层或当前选择范围外，请先调整图层。'); return } setPlacement(null); setMenu(null); if (id && project?.document.props[id] && Object.values(project.document.prefabInstances).some(group => Object.values(group.members).some(member => member.propId === id))) setMemberMode(true); else if (id && project?.document.prefabInstances[id]) setMemberMode(false); selectionSession.set(!id ? [] : normalizeSelectionV2(project!.document, operation === 'replace' ? [id] : operation === 'add' ? [...selectionSession.getSnapshot(), id] : selectionSession.getSnapshot().filter(current => current !== id), true)) }
  const selectMany = (ids: readonly string[]) => { if (editingBlocked) return; setPlacement(null); setMenu(null); selectionSession.set(ids.filter(id => !scopedHiddenIds.has(id))) }
  const batchAction = (action: SelectionActionV2, values?: { dx?: number; dy?: number; angle?: number }, ids = selectionSession.getSnapshot(), checkpoint = historyWorkspace.checkpoint()) => {
    if (!project || busy || editingBlocked || audience !== 'gm') return
    try {
      historyWorkspace.assertCheckpoint(checkpoint)
      const commands = selectionCommandsV2(project.document, ids, action, values)
      if (action === 'lock' || action === 'unlock') { historyWorkspace.execute(commands); setMessage(null); return }
      const document = historyWorkspace.preview(commands)
      setStructure({ checkpoint, commands, document, kind: 'batch', description: `${{ move: '批量移动', rotate: '批量旋转', delete: '删除所选', copy: '复制所选' }[action]} · ${ids.length} 个选择单元${action === 'move' ? ` · 位移 ${values?.dx ?? 0}, ${values?.dy ?? 0} mm` : action === 'rotate' ? ` · 旋转 ${values?.angle ?? 0}°` : action === 'copy' ? ' · 副本偏移 300, 300 mm' : ''}` }); setMessage(null)
    } catch (error) { setMessage(`整批未采用，工程未修改：${error instanceof Error ? error.message : String(error)}`) }
  }
  const openMenu = (point: PointMm, hits: string[], position: { x: number; y: number }, origin: HTMLElement) => {
    if (!project || editingBlocked || busy || audience !== 'gm') return
    const currentIds = selectionSession.getSnapshot(), retained = !!hits[0] && currentIds.includes(hits[0]), ids = hits.length && !retained ? [hits[0]] : [...currentIds]
    if (!retained && hits.length) selectionSession.set(ids)
    setMenu({ ...position, point, hits, ids, checkpoint: historyWorkspace.checkpoint(), origin, blank: !hits.length })
  }
  const closeMenu = (restore = false) => { const origin = menu?.origin; setMenu(null); if (restore) requestAnimationFrame(() => origin?.isConnected && origin.focus({ preventScroll: true })) }
  const visibleCompleteProject = useMemo(() => restore?.project ?? (completeProject && structure ? { ...completeProject, document: structure.document } : completeProject), [completeProject, structure, restore])
  const renderProject = useMemo(() => visibleCompleteProject ? toCompleteProjectV3(visibleCompleteProject) : null, [visibleCompleteProject])
  const visibleProject = useMemo(() => renderProject ? domainProjectV3(renderProject) : null, [renderProject])
  const editorRenderer = useMemo(() => renderProject ? (options: Parameters<typeof renderEditorProjectV3>[1]) => renderEditorProjectV3(renderProject, { ...options, hiddenLayerIds: effectiveHiddenLayers }) : undefined, [renderProject, effectiveHiddenLayers])
  const pointHitTest = useMemo(() => visibleCompleteProject ? hitTestLayersV3(visibleCompleteProject.document, hiddenIds) : undefined, [visibleCompleteProject?.document, hiddenIds])
  const boundsSelector = useMemo(() => visibleCompleteProject ? selectInBoundsLayersV3(visibleCompleteProject.document, hiddenIds) : undefined, [visibleCompleteProject?.document, hiddenIds])
  const selectionGeometry = useMemo(() => visibleCompleteProject ? selectionGeometryLayersV3(visibleCompleteProject.document, hiddenIds) : undefined, [visibleCompleteProject?.document, hiddenIds])
  const selectionSummaryReader = useMemo(() => visibleCompleteProject ? summarizeSelectionLayersV3(visibleCompleteProject.document, hiddenIds) : undefined, [visibleCompleteProject?.document, hiddenIds])
  const selectLayer = (layerId: string) => {
    if (!completeProject || !project || !boundsSelector || busy || editingBlocked || audience !== 'gm' || effectiveHiddenLayers.has(layerId)) return
    const boxes = [project.document.exportBoundsMm, ...Object.values(project.document.floors).map(floor => floor.boundsMm)]
    const x = Math.min(...boxes.map(box => box.x)), y = Math.min(...boxes.map(box => box.y))
    const right = Math.max(...boxes.map(box => box.x + box.width)), bottom = Math.max(...boxes.map(box => box.y + box.height))
    const found = boundsSelector(project.document, { x, y, width: right - x, height: bottom - y }, 'intersect', { hiddenIds: scopedHiddenEntitiesV3(completeProject.document, hiddenIds, layerId), memberMode })
    setCurrentLayerId(layerId); setPlacement(null); setMenu(null); selectionSession.set(found.ids)
    setMessage(`已选择本层 ${found.ids.length} 个对象；排除锁定 ${found.excludedLocked} 个。`)
  }
  const exportImage = () => { if (completeProject) void action(async () => {
    // Capture the complete immutable project and audience at the click boundary.
    const blob = await exportPngV3(toCompleteProjectV3(completeProject), { audience, longEdgePx: 4096 })
    download(blob, `sceneweave-${audience}-map.png`)
    setMessage(`${audience === 'gm' ? '主持人' : '玩家'} PNG 已生成 · r${completeProject.document.revision} · 固定工程范围 · 长边 4096 px`)
  }) }
  const saveLabels = { empty: '尚未打开工程', saved: '本地已保存', unsaved: '等待保存', saving: '正在保存', error: '保存失败', conflict: '版本冲突' }
  return <>
    <div className="asset-shell history-shell" ref={shell} data-testid="history-workbench" data-revision={project?.document.revision}>
      <header className="asset-header"><button className="asset-brand" disabled={busy || editingBlocked} onClick={() => void action(async () => { await historyWorkspace.flush(); onBack() })}><ArrowLeft size={18}/><span>织境<small>Sceneweave</small></span></button><div className="asset-header-title"><Archive size={20}/><span>历史工坊</span><b>命名快照</b></div><div className="asset-header-actions"><span role="status" className={`asset-save ${state.status}`}>{state.status === 'saving' ? <LoaderCircle size={14} className="spin"/> : <CheckCircle2 size={14}/>} {saveLabels[state.status]}</span><button className="secondary" disabled={busy || editingBlocked} onClick={() => file.current?.click()}><Upload size={15}/>打开工程</button><button className="primary" disabled={busy || editingBlocked || !project} onClick={() => backup()}><Download size={15}/>完整工程</button><button className="secondary" disabled={busy || editingBlocked || !project} onClick={exportImage}><Download size={15}/>4K PNG</button></div></header>
      <div className="asset-phase-note">命名历史 · 局部恢复<span>独立物件 · 外观 / 位置角度 / 完整物件</span></div>
      {(state.error || message) && <div className="asset-notice" role="alert"><span>{message ?? state.error}</span>{state.status === 'error' && <button onClick={() => void action(() => historyWorkspace.retry())}>重试保存</button>}{['conflict', 'error'].includes(state.status) && <button onClick={() => void action(async () => { await historyWorkspace.saveAsCopy(); await refresh() })}>另存副本</button>}<button aria-label="关闭工坊提示" onClick={() => setMessage(null)}><X size={16}/></button></div>}
      <div className="asset-layout">
        <div className="layer-library-stack history-library-stack"><div className="history-sidebar-tabs" role="tablist" aria-label="工坊侧栏"><button role="tab" aria-selected={sidebar === 'scene' || audience === 'player'} disabled={busy || editingBlocked} onClick={() => setSidebar('scene')}><Layers3 size={14}/>场景</button><button role="tab" aria-selected={sidebar === 'history' && audience === 'gm'} disabled={!completeProject || busy || editingBlocked || audience === 'player'} onClick={() => { setSidebar('history'); setPlacement(null) }}><Archive size={14}/>历史</button></div>{sidebar === 'history' && completeProject && audience === 'gm' ? <HistoryPanel project={completeProject} repository={repository} workspace={historyWorkspace} session={selectionSession} disabled={busy || editingBlocked} refreshKey={historyRefresh} onAction={action} onPreview={next => { setPlacement(null); setRestore(next) }} onBackup={backup}/> : <>{completeProject && audience === 'gm' && <UserLayerPanel scene={completeProject.document} session={selectionSession} currentLayerId={currentLayerId} hiddenLayerIds={hiddenLayerIds} soloLayerId={soloLayerId} currentOnly={currentOnly} disabled={busy || editingBlocked} onCurrent={id => { setPlacement(null); setCurrentLayerId(id) }} onHidden={id => setHiddenLayerIds(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next })} onSolo={id => setSoloLayerId(current => current === id ? null : id)} onScope={setCurrentOnly} moveRequest={layerMoveRequest} onSelectLayer={selectLayer} onCommand={commands => commit(() => historyWorkspace.execute(commands))} onPreview={preview}/> }<SelectionSubscriber session={selectionSession}>{ids => <SceneLibrary project={project} selected={ids.length === 1 ? ids[0] : null} selectedIds={[...ids]} busy={busy || editingBlocked} recent={recent} onSelect={select} onNew={openNewScene} onPlace={choosePlacement} placingId={placement?.prop.definitionRef?.id ?? null} canPlace={audience === 'gm' && !!completeProject?.document.userLayers[currentLayerId] && !completeProject.document.userLayers[currentLayerId].editLocked && !effectiveHiddenLayers.has(currentLayerId)}
          onIsland={() => prepare(createIslandProject, '原创室外样板：双层岩岛、草岩浅水、高差台阶与可保留人工调整的散布。')}
          onStudy={() => prepare(createStudyProject, '原创室内建筑样板：书房与露台、厚墙与斜窗、墨绘原野材质及可拆分组合。')}
          onCalibration={() => prepare(createCalibrationProject, 'B1 原创程序校样：重复木纹、透明书桌与椅子，用于验证素材和工程保存。')}
          onMigrate={migrateCurrent} onOpen={id => void action(async () => {
            setAudience('gm')
            const checkpoint = historyWorkspace.checkpoint(); await ready(); const saved = await repository.load(id)
            if (!saved) throw new Error('工程不存在。')
            await historyWorkspace.openPersisted(saved, checkpoint); setSelected(null)
          }, '打开本地工程')}/>}</SelectionSubscriber></>}</div>
        <main className="asset-center"><div className="asset-scene-bar"><div><small>{audience === 'gm' ? '主持人场景' : '玩家场景'}</small><h1>{project?.document.title ?? '织境场景'}</h1></div><div className="asset-toolbar"><button aria-label="撤销素材编辑" title="撤销" disabled={!state.canUndo || busy || editingBlocked} onClick={() => commit(() => historyWorkspace.undo())}><Undo2 size={17}/></button><button aria-label="重做素材编辑" title="重做" disabled={!state.canRedo || busy || editingBlocked} onClick={() => commit(() => historyWorkspace.redo())}><Redo2 size={17}/></button><button aria-label="命名历史快照" title="命名历史快照" disabled={!project || busy || editingBlocked || audience === 'player'} onClick={() => { setSidebar('history'); setPlacement(null) }}><Archive size={17}/></button></div></div>
          <div className="asset-view-bar"><div role="group" aria-label="预览受众" className="asset-audience"><button disabled={busy || editingBlocked} aria-pressed={audience === 'gm'} onClick={() => setAudience('gm')}>主持人</button><button disabled={busy || editingBlocked} aria-pressed={audience === 'player'} onClick={() => { setAudience('player'); setSelected(null) }}>玩家</button></div><span>{project ? `${(project.document.exportBoundsMm.width / 1000).toFixed(1)} × ${(project.document.exportBoundsMm.height / 1000).toFixed(1)} m · 固定范围` : '二维俯视 · 毫米世界坐标'}</span></div>
          {structure && <div className="asset-structure-preview" role="status"><div><strong>{structure.description} · 候选预览</strong><span>尚未写入工程，采用后作为一次编辑保存</span>{structure.scopeIds && <details className="layer-preview-scope"><summary>实际操作范围 · {structure.scopeIds.length} 项</summary><textarea readOnly aria-label="待采用图层操作 ID" rows={4} value={structure.scopeIds.join('\n')}/></details>}</div><button className="secondary" onClick={() => setStructure(null)}>{structure.kind === 'batch' ? '取消批量预览' : structure.kind === 'layer' ? '取消图层预览' : '取消结构预览'}</button><button className="primary" onClick={() => {
            try { historyWorkspace.assertCheckpoint(structure.checkpoint); historyWorkspace.execute(structure.commands); setStructure(null); setMessage(null) }
            catch (error) { setStructure(null); setMessage(error instanceof Error ? error.message : String(error)) }
          }}>{structure.kind === 'batch' ? '采用批量修改' : structure.kind === 'layer' ? '采用图层修改' : '采用结构修改'}</button></div>}
          {restore && <div className="asset-structure-preview history-restore-banner" role="status" aria-label="局部恢复候选"><div><strong>{restore.snapshot.name} · 局部恢复预览</strong><span>{restore.plan.request.ids.length} 件请求 · {restore.plan.changes.length} 件变化 · 当前 r{restore.currentRevision}</span></div><button className="secondary" disabled={busy} onClick={() => { historyWorkspace.cancelRestore(restore); setRestore(null) }}>取消局部恢复</button><button className="primary" disabled={busy || !restore.plan.changed} onClick={() => void action(async () => { try { await historyWorkspace.applyRestore(restore); setSelected(null); await refresh() } finally { setRestore(null); setHistoryRefresh(value => value + 1) } }, '采用局部恢复')}>保护当前并采用</button></div>}
          <div className="asset-stage">{visibleProject ? <AssetCanvas project={visibleProject} editorRenderer={editorRenderer} selectionOptions={selectionOptions} pointHitTest={pointHitTest} boundsSelector={boundsSelector} selectionGeometry={selectionGeometry} selectionSummaryReader={selectionSummaryReader} selected={null} selectionSession={selectionSession} onSelect={select} onSelectMany={selectMany} onContext={openMenu} memberMode={memberMode} onMemberMode={setMemberMode} fitRequest={fitRequest} audience={audience} disabled={busy || editingBlocked || audience === 'player'} placement={placement?.prop} onPlacementMove={positionMm => setPlacement(current => current ? { ...current, prop: { ...current.prop, positionMm } } : null)} onPlace={placeAt} onPlacementReady={setPlacementReady} onPlacementError={error => { setPlacement(null); setMessage(error) }} onCancelPlacement={() => setPlacement(null)}/> : <div className="asset-empty"><div className="asset-empty-icon"><Layers3 size={36}/></div><span>从一张空白画布开始</span><p>选择画布范围与使用预设，逐件放入素材。<br/>也可从左侧打开书房或岩岛样板。</p><button className="primary" disabled={busy} onClick={openNewScene}>新建场景</button></div>}</div><footer className="asset-canvas-footer"><span>{audience === 'gm' ? '主持人视图 · 工程可能包含秘密' : '玩家视图 · 已过滤私密内容'}</span>{project && <span>{Object.keys(project.assets).length} 张位图 · {Object.keys(project.document.props).length} 件物件 · r{project.document.revision}</span>}</footer>
        </main>
        <SelectionSubscriber session={selectionSession}>{ids => { const selectedIds = ids, selected = ids.length === 1 ? ids[0] : null; return <aside className="asset-inspector">{!restore && project && selectedIds.length > 0 && audience === 'gm' && !placement && <button className="secondary asset-wide" disabled={busy || editingBlocked} onClick={event => { const b = event.currentTarget.getBoundingClientRect(), bounds = project.document.exportBoundsMm; openMenu(project.document.props[selectedIds[0]]?.positionMm ?? { x: Math.round(bounds.x + bounds.width / 2), y: Math.round(bounds.y + bounds.height / 2) }, [...selectedIds], { x: b.left, y: b.bottom }, event.currentTarget) }}>更多操作</button>}{restore ? <RestoreChangesPanel preview={restore} current={completeProject!}/> : project && placement && audience === 'gm' ? <PlacementInspector scene={project.document} prop={placement.prop} busy={busy} ready={placementReady} onChange={changes => setPlacement(current => current ? { ...current, prop: { ...current.prop, ...changes } } : null)} onPlace={() => placeAt(placement.prop.positionMm)} onCancel={() => setPlacement(null)}/> : visibleProject && selectedIds.length > 1 && audience === 'gm' ? <SelectionInspector scene={project!.document} ids={selectedIds} summaryReader={selectionSummaryReader} busy={busy || editingBlocked} onAction={batchAction} onClear={() => select(null)}/> : visibleProject && selected && audience === 'gm' ? <SceneInspector project={visibleProject} selected={selected} busy={busy || editingBlocked} workspace={historyWorkspace} onSelect={select} onCommit={commit} onPreview={preview}/> : <>
          <div className="asset-section-heading"><Move size={16}/><h2>{audience === 'player' ? '玩家输出' : '工程信息'}</h2></div>
          {project ? <><h3>{project.document.activeStyleThemeRef ? '墨绘原野 · v1' : '用户图层 · 完整工程'}</h3><p className="asset-muted">{audience === 'player' ? '预览与 PNG 使用同一投影和绘制流程，私密内容在材质与阴影派生前过滤。' : '选择画面中的物件，或从左侧切换组合、散布与场景结构。全部素材、定义和许可随工程保存。'}</p>
            <dl className="asset-facts"><dt>场景修订</dt><dd>r{project.document.revision}</dd><dt>素材字节</dt><dd>{bytesLabel(Object.values(project.assets).reduce((sum, asset) => sum + asset.sizeBytes, 0))}</dd><dt>定义快照</dt><dd>{Object.keys(project.document.propDefinitions).length} 件物件 / {Object.keys(project.document.materials).length} 种材质</dd><dt>许可绑定</dt><dd>{project.licenseBindings.length} 条</dd></dl>
            {audience === 'gm' && <><h3>地面材质</h3>{Object.values(project.document.rooms).filter(room => room.floorStyle).map(room => <fieldset key={room.id} disabled={busy || editingBlocked || room.editLocked}><NumberInput label="木纹方向" value={room.floorStyle!.base.rotationDeg} unit="°" onCommit={rotation => commit(() => historyWorkspace.rotateRoomMaterial(room.id, rotation))}/></fieldset>)}<button className="secondary asset-wide" disabled={busy || editingBlocked} onClick={() => void action(async () => {
              await validateCompleteProjectV4(completeProject!)
              setMessage('完整工程校验通过：格式、历史身份、位图与许可一致。')
            }, '当前工程完整性检查')}><CheckCircle2 size={15}/>校验完整工程</button></>}
            {audience === 'gm' && project.document.presetSnapshot.presetId === 'sceneweave-vis02' && <TerrainTravelPanel scene={project.document} disabled={busy || editingBlocked}/>}
            {completeProject?.migrationSource && <div className="asset-provenance"><strong>v3 历史迁移副本</strong><p>来源 r{completeProject.migrationSource.sourceRevision} · 原自动 20 次保存记录未迁移</p><button onClick={() => downloadOriginal(3)}>下载 v3 迁移原件</button>{completeProject.migrationSource.previousSource && <button onClick={() => downloadOriginal(2)}>下载 v2 迁移原件</button>}{completeProject.migrationSource.previousSource?.previousSource && <button onClick={() => downloadOriginal(1)}>下载 M0 迁移原件</button>}</div>}
          </> : <p className="asset-muted">新建空白场景，打开室内外样板，或导入完整工程。</p>}
          <div className="asset-next"><RotateCw size={16}/><strong>把场景保存完整</strong><p>工程文件携带素材、材质与许可。定期下载备份，继续编辑前可检查工程完整性。</p></div>
        </>}</aside> }}</SelectionSubscriber>
      </div>
      <input hidden ref={file} type="file" accept=".sceneweave" aria-label="选择完整历史工程" onChange={event => { const selected = event.target.files?.[0]; event.target.value = ''; if (selected) prepare(async signal => {
        const version = await inspectProjectVersionV4(selected, { signal })
        if (version === 4) return await inspectPackageModeV4(selected, { signal }) === 'history' ? importHistoryArchiveV4(selected, { signal }) : { project: await importProjectV4(selected, { signal }), snapshots: [] }
        if (version === 3) return migrateProjectV3ToV4(await importProjectV3(selected, { signal }), { original: selected, signal })
        const old = version === 2 ? await importProjectV2(selected, { signal }) : await prepareProjectFile(selected, signal)
        return createLayerProject(old, { original: version === 2 ? selected : undefined, signal })
      }, '打开为独立历史副本；保留完整工程与随包命名、保护快照。旧版自动保存记录不迁移。') }}/>
      {busy && <div className="asset-busy" role="status"><LoaderCircle size={17} className="spin"/>正在处理完整工程…{controller.current && <button onClick={() => controller.current?.abort()}>取消准备</button>}</div>}
    </div>
    {menu && project && <SceneContextMenu key={`${menu.checkpoint}-${menu.x}-${menu.y}-${menu.ids.join('|')}`} project={project} menu={menu} onMoveToLayer={() => { try { historyWorkspace.assertCheckpoint(menu.checkpoint); selectionSession.set(menu.ids); setLayerMoveRequest(value => value + 1) } catch (error) { setMessage(String(error)) } }} onClose={closeMenu} onAction={action => batchAction(action, undefined, menu.ids, menu.checkpoint)} onSelect={select} onFit={() => setFitRequest(value => value + 1)} onPlace={(id, point) => { try { historyWorkspace.assertCheckpoint(menu.checkpoint); choosePlacement(id, point) } catch (error) { setMessage(String(error)) } }} onEdit={() => requestAnimationFrame(() => { const input = shell.current?.querySelector<HTMLElement>('.asset-inspector input:not(:disabled)') ?? shell.current?.querySelector<HTMLElement>('.asset-inspector button:not(:disabled)'); input?.focus() })}/>}
    {(candidate || newScene) && <div className="modal-scrim"><div ref={dialog} className="modal" role="dialog" aria-modal="true" aria-label={newScene ? '新建空白场景' : '确认打开历史工程'}><div className="modal-heading"><h2>{newScene ? '新建空白场景' : '确认打开历史工程'}</h2><button className="icon-button" disabled={busy && !(newScene && creatingStage === 'preparing')} aria-label={newScene ? '取消新建场景' : '取消打开历史工程'} onClick={() => { if (newScene) cancelNewScene(); else setCandidate(null) }}><X size={18}/></button></div>{newScene ? <NewSceneForm busy={busy} cancellable={creatingStage === 'preparing'} failure={message ?? state.error} onCreate={createScene} onCancel={cancelNewScene}/> : candidate && <><p>{candidate.description}</p><div className="asset-candidate"><strong>{candidate.project.document.title}</strong><span>{Object.keys(candidate.project.assets).length} 张位图 · {Object.keys(candidate.project.document.props).length} 件物件 · 完整历史工程</span><span>随包历史：{candidate.archive?.snapshots.filter(snapshot => snapshot.kind === 'named').length ?? 0} 个命名 / {candidate.archive?.snapshots.filter(snapshot => snapshot.kind === 'protection').length ?? 0} 个保护快照</span>{candidate.project.migrationSource && <span>实际来源修订 r{candidate.project.migrationSource.sourceRevision} · 原自动 20 次保存记录未迁移</span>}</div>{message && <p role="alert" className="asset-form-error">{message}</p>}<div className="modal-actions"><button className="secondary" disabled={busy} onClick={() => setCandidate(null)}>取消</button><button className="primary" disabled={busy} onClick={() => void action(async () => { await ready(); if (candidate.archive) await historyWorkspace.adoptArchive(candidate.archive, candidate.checkpoint); else await historyWorkspace.adoptNew(candidate.project, candidate.checkpoint); setCandidate(null); setSelected(null); await refresh() })}>保存并打开副本</button></div></>}</div></div>}
  </>
}
