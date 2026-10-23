import { useLegacyNavigationGuard } from '../workspace/legacy-navigation'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Archive, ArrowLeft, CheckCircle2, Download, FolderOpen, Layers3, LoaderCircle, Move, Redo2, RotateCw, Undo2, Upload, X } from 'lucide-react'
import { SceneRepositoryV3 } from '../../io/v3/storage'
import { diagnoseCompleteProjectV3, exportProjectV3, ProjectValidationErrorV3 } from '../../io/v3/project-file'
import type { CompleteProjectV2 } from '../../io/v2/types'
import { importProjectV2 } from '../../io/v2/project-file'
import type { CompleteProjectV3 } from '../../io/v3/types'
import { createLayerProject } from '../../io/v3/migration'
import { importProjectV3, inspectProjectVersionV3 } from '../../io/v3/project-file'
import { toGeometryDocumentV2 } from '../../core/v3/geometry-view'
import type { SceneCommandV3 } from '../../core/v3/commands'
import type { SceneDocumentV3 } from '../../core/v3/types'
import UserLayerPanel from './UserLayerPanel'
import { domainProjectV3, hiddenEntitiesV3, scopedHiddenEntitiesV3, hitTestLayersV3, selectInBoundsLayersV3, selectionGeometryLayersV3, summarizeSelectionLayersV3 } from './layer-view'

import { SceneRepository } from '../../io/storage'
import { bootEditor, flushSave, useEditorStore } from '../store'
import { createCalibrationProject } from '../v2/calibration'
import { validateStudyEditsV2 } from '../v2/study-constraints'
import { validateIslandEditsV2 } from '../v2/island-constraints'
import { createPlacedPropV3 } from '../../core/v3/commands'
import { migrationOriginalV3 } from '../../io/v3/migration'
import type { PointMm, PropV2 } from '../../core/v2/types'
import { exportPngV3, renderEditorProjectV3 } from '../../render/v3/renderer'
import { NumberInput } from '../v2/controls'
import SceneInspector from '../v2/SceneInspector'
import SceneLibrary from '../v2/SceneLibrary'
import TerrainTravelPanel from '../v2/TerrainTravelPanel'
import { migrateProjectV1, prepareProjectFile } from '../v2/migration-project'
import { forkProjectV3, WorkspaceV3 } from './workspace'
import AssetCanvas from '../v2/AssetCanvas'
import ProjectDiagnostics from '../v2/ProjectDiagnostics'
import type { ProjectDiagnosticsNoticeV2 } from '../v2/ProjectDiagnostics'
import NewSceneForm, { type NewSceneOptionsV2 } from '../v2/NewSceneForm'
import PlacementInspector from '../v2/PlacementInspector'
import SelectionInspector from '../v2/SelectionInspector'
import SceneContextMenu, { type SceneMenuV2 } from '../v2/SceneContextMenu'
import { normalizeSelectionV2 } from '../v2/selection'
import { selectionCommandsV2, type SelectionActionV2 } from '../v2/selection-actions'
import { SelectionSessionV2 } from '../v2/selection-session'
import { SelectionSubscriber } from '../v2/SelectionSubscriber'
import '../v2/assets.css'
import './layers.css'

const repository = new SceneRepositoryV3()
export const layerWorkspace = new WorkspaceV3(repository, document => { const geometry = toGeometryDocumentV2(document); validateStudyEditsV2(geometry); validateIslandEditsV2(geometry) })
const createStudyProject = async (signal: AbortSignal) => (await import('../v2/study-sample')).createStudyProject(signal)
const createIslandProject = async (signal: AbortSignal) => (await import('../v2/island-sample')).createIslandProject(signal)
let opened: Promise<void> | undefined
const ready = () => opened ??= repository.open().catch(error => { opened = undefined; throw error })
const bytesLabel = (bytes: number) => `${(bytes / 1024).toFixed(1)} KiB`
const download = (blob: Blob, name: string) => {
  const url = URL.createObjectURL(blob), anchor = document.createElement('a')
  anchor.href = url; anchor.download = name; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 30_000)
}
type Candidate = { project: CompleteProjectV3; checkpoint: number; description: string }
type StructurePreview = { checkpoint: number; commands: SceneCommandV3[]; document: SceneDocumentV3; description: string; kind?: 'batch' | 'layer'; scopeIds?: string[] }

export default function LayerWorkbench({ onBack, source, onOpenHistory }: { onBack: () => void; source?: CompleteProjectV2 | null; onOpenHistory?: (project: CompleteProjectV3) => void }) {
  const state = useSyncExternalStore(layerWorkspace.subscribe, layerWorkspace.getState), completeProject = state.project
  const project = useMemo(() => completeProject ? domainProjectV3(completeProject) : null, [completeProject])
  const [currentLayerId, setCurrentLayerId] = useState(''), [hiddenLayerIds, setHiddenLayerIds] = useState<ReadonlySet<string>>(new Set()), [soloLayerId, setSoloLayerId] = useState<string | null>(null), [currentOnly, setCurrentOnly] = useState(false)
  const effectiveHiddenLayers = useMemo(() => new Set(completeProject ? Object.keys(completeProject.document.userLayers).filter(id => hiddenLayerIds.has(id) || soloLayerId !== null && soloLayerId !== id) : []), [completeProject?.document, hiddenLayerIds, soloLayerId])
  const hiddenIds = useMemo(() => completeProject ? hiddenEntitiesV3(completeProject.document, effectiveHiddenLayers) : new Set<string>(), [completeProject?.document, effectiveHiddenLayers])
  const scopedHiddenIds = useMemo(() => completeProject ? scopedHiddenEntitiesV3(completeProject.document, hiddenIds, currentOnly ? currentLayerId : null) : hiddenIds, [completeProject?.document, hiddenIds, currentOnly, currentLayerId])
  const selectionOptions = useMemo(() => ({ hiddenIds: scopedHiddenIds }), [scopedHiddenIds])
  const [recent, setRecent] = useState<Awaited<ReturnType<SceneRepositoryV3['list']>>>([])
  const [busy, setBusy] = useState(false), [message, setMessage] = useState<string | null>(null)
  const [selectionSession] = useState(() => new SelectionSessionV2())
  const setSelected = (id: string | null) => selectionSession.set(id ? [id] : [])
  const [layerMoveRequest, setLayerMoveRequest] = useState(0)
  const [memberMode, setMemberMode] = useState(false), [menu, setMenu] = useState<SceneMenuV2 | null>(null), [fitRequest, setFitRequest] = useState(0)
  const [candidate, setCandidate] = useState<Candidate | null>(null), [snapshots, setSnapshots] = useState<Awaited<ReturnType<SceneRepositoryV3['listSnapshots']>> | null>(null)
  const [structure, setStructure] = useState<StructurePreview | null>(null), [audience, setAudience] = useState<'gm' | 'player'>('gm')
  const [diagnostics, setDiagnostics] = useState<ProjectDiagnosticsNoticeV2 | null>(null)
  const [newScene, setNewScene] = useState(false)
  const [creatingStage, setCreatingStage] = useState<'preparing' | 'saving' | null>(null)
  const creatingStageRef = useRef<'preparing' | 'saving' | null>(null)
  const [placement, setPlacement] = useState<{ prop: PropV2; checkpoint: number } | null>(null)
  const [placementReady, setPlacementReady] = useState(false)
  const previewRef = useRef(false)
  previewRef.current = !!structure
  const placingRef = useRef(false)
  placingRef.current = !!placement
  const file = useRef<HTMLInputElement>(null), controller = useRef<AbortController | null>(null), shell = useRef<HTMLDivElement>(null), dialog = useRef<HTMLDivElement>(null)
  const modalOrigin = useRef<HTMLElement | null>(null)
  const actionPending = useRef(false)
  useLegacyNavigationGuard(async internal => {
    if (!internal && (busy || actionPending.current || controller.current)) throw new Error('工程操作仍在进行，请完成或取消后再离开。')
    if (candidate || newScene || placement || structure || snapshots) throw new Error('请先采用或明确取消当前草稿、放置、预览或对话框，再离开工程。')
    await layerWorkspace.close()
  }, true, !!(busy || candidate || newScene || placement || structure || snapshots), state.project?.document.revision)
  const refresh = async () => { await ready(); setRecent(await repository.list()) }
  const action = async (run: () => Promise<void>, failureSource = '工程操作') => {
    if (actionPending.current) return
    actionPending.current = true
    if (!candidate && !snapshots && !newScene && !document.activeElement?.closest('[role="dialog"]')) modalOrigin.current = document.activeElement as HTMLElement | null
    setBusy(true); setMessage(null)
    try { await run() } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') setMessage('准备已取消，当前工程和本地存档未改变。')
      else if (error instanceof ProjectValidationErrorV3) {
        setDiagnostics({ source: failureSource, report: { complete: false, issues: error.issues, summary: null } })
        setMessage('完整工程检查未通过，请查看问题清单。')
      } else setMessage(error instanceof Error ? error.message : String(error))
    }
    finally { actionPending.current = false; setBusy(false) }
  }
  useEffect(() => { void refresh().catch(error => setMessage(String(error))); return () => { controller.current?.abort() } }, [])
  useEffect(() => {
    // Remembering the selection is optional; IndexedDB owns the complete project.
    try { if (project) localStorage.setItem('sceneweave.layerSceneId', project.document.sceneId) } catch { /* The recent list still permits reopening. */ }
    setSelected(null)
    setStructure(null); setAudience('gm'); setMemberMode(false); setHiddenLayerIds(new Set()); setSoloLayerId(null); setCurrentOnly(false); setLayerMoveRequest(0); setCurrentLayerId(Object.keys(completeProject?.document.userLayers ?? {})[0] ?? '')
    if (project) void refresh().catch(() => {})
  }, [project?.document.sceneId])
  useEffect(() => { if (state.status === 'saved') void refresh().catch(() => {}) }, [state.status, project?.document.revision])
  useEffect(() => { setDiagnostics(null) }, [project?.document.sceneId, project?.document.revision, audience])
  useEffect(() => { setPlacement(null); setMenu(null); if (project) selectionSession.set(normalizeSelectionV2(project.document, selectionSession.getSnapshot(), true).filter(id => !scopedHiddenIds.has(id))) }, [project, audience, scopedHiddenIds])
  useEffect(() => {
    if (import.meta.env.DEV) Reflect.set(window, '__sceneweaveLayersDev', { workspace: layerWorkspace, repository })
    const unload = (event: BeforeUnloadEvent) => { if (!['empty', 'saved'].includes(layerWorkspace.getState().status)) { event.preventDefault(); event.returnValue = '' } }
    const key = (event: KeyboardEvent) => {
      if (actionPending.current) return
      if (previewRef.current) { if (event.key === 'Escape' && !(event.target as HTMLElement)?.closest('input,textarea,select,[contenteditable]')) { event.preventDefault(); setStructure(null) }; return }
      if ((event.target as HTMLElement)?.closest('input,textarea,select,[contenteditable]') || event.isComposing || document.querySelector('[role="dialog"],[role="menu"]')) return
      if (event.key === 'Escape' && placingRef.current) { event.preventDefault(); setPlacement(null); return }
      if ((event.metaKey || event.ctrlKey) && ['z', 'y', 's'].includes(event.key.toLowerCase())) {
        event.preventDefault()
        try {
          if (event.key.toLowerCase() === 's') void action(() => layerWorkspace.flush())
          else if (event.key.toLowerCase() === 'y' || event.shiftKey) layerWorkspace.redo()
          else layerWorkspace.undo()
        } catch (error) { setMessage(String(error)) }
      }
    }
    window.addEventListener('beforeunload', unload); window.addEventListener('keydown', key)
    return () => { window.removeEventListener('beforeunload', unload); window.removeEventListener('keydown', key) }
  }, [])
  useEffect(() => {
    if (!candidate && !snapshots && !newScene) return
    const prior = modalOrigin.current, background = shell.current
    if (background) background.inert = true
    dialog.current?.querySelector<HTMLButtonElement>('button')?.focus()
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (newScene && creatingStageRef.current === 'preparing') { controller.current?.abort(); setNewScene(false) }
        else if (!busy) { setCandidate(null); setSnapshots(null); setNewScene(false) }
      }
      if (event.key === 'Tab') {
        const controls = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),a[href]') ?? [])
        if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1)?.focus() }
        if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0]?.focus() }
      }
    }
    window.addEventListener('keydown', key)
    return () => { if (background) background.inert = false; window.removeEventListener('keydown', key); requestAnimationFrame(() => { if (prior?.isConnected) prior.focus() }) }
  }, [candidate, snapshots, newScene, busy])
  // Reopen the last successful asset scene without changing M0's database or selection.
  useEffect(() => {
    if (source || layerWorkspace.getState().project) return
    let id: string | null = null
    try { id = localStorage.getItem('sceneweave.layerSceneId') } catch { /* Preferences may be unavailable independently of IndexedDB. */ }
    if (!id) return
    const checkpoint = layerWorkspace.checkpoint()
    void action(async () => { await ready(); const saved = await repository.load(id); if (saved) await layerWorkspace.openPersisted(saved, checkpoint) })
  }, [])
  const prepare = (factory: (signal: AbortSignal) => Promise<CompleteProjectV2 | CompleteProjectV3>, description: string) => void action(async () => {
    // Preparing a host project leaves player preview so failures can show their dependency report.
    setAudience('gm'); setDiagnostics(null)
    controller.current?.abort(); const abort = new AbortController(); controller.current = abort
    const checkpoint = layerWorkspace.checkpoint()
    try {
      const input = await factory(abort.signal)
      const prepared = input.document.schemaVersion === 3 ? input as CompleteProjectV3 : await createLayerProject(input as CompleteProjectV2, { signal: abort.signal })
      abort.signal.throwIfAborted(); layerWorkspace.assertCheckpoint(checkpoint)
      setCandidate({ project: prepared, checkpoint, description })
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
    const checkpoint = layerWorkspace.checkpoint()
    try {
      await ready(); await layerWorkspace.flush(); abort.signal.throwIfAborted()
      const { createBlankProjectV2 } = await import('../v2/blank-project')
      abort.signal.throwIfAborted()
      const prepared = await createBlankProjectV2(options, abort.signal)
      abort.signal.throwIfAborted(); layerWorkspace.assertCheckpoint(checkpoint)
      creatingStageRef.current = 'saving'; setCreatingStage('saving')
      const layered = await createLayerProject(prepared, { signal: abort.signal })
      abort.signal.throwIfAborted(); await layerWorkspace.adoptNew(layered, checkpoint)
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
    queueMicrotask(() => { if (!disposed && source) prepare(async signal => createLayerProject(source, { signal }), '为当前完整场景启用用户图层。先保存独立副本，原 v2 工程及历史继续保留。') })
    return () => { disposed = true }
  }, [source])
  useEffect(() => {
    if (completeProject && !completeProject.document.userLayers[currentLayerId]) setCurrentLayerId(Object.keys(completeProject.document.userLayers)[0] ?? '')
  }, [completeProject?.document, currentLayerId])
  const choosePlacement = (definitionId: string, position?: PointMm) => {
    if (!project || !completeProject || busy || structure || audience !== 'gm') return
    try {
      const layer = completeProject.document.userLayers[currentLayerId]
      if (!layer || layer.editLocked || effectiveHiddenLayers.has(layer.id)) throw new Error('请先选择可见且未锁定的当前图层。')
      const b = project.document.exportBoundsMm
      const prop = createPlacedPropV3(completeProject.document, definitionId, position ?? { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) }, { layerId: currentLayerId })
      setPlacementReady(false); setPlacement({ prop, checkpoint: layerWorkspace.checkpoint() }); setSelected(null); setMessage(null)
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)) }
  }
  const placeAt = (positionMm: PointMm) => {
    if (!placement || busy || structure || audience !== 'gm') return
    if (!placementReady) return
    try {
      layerWorkspace.assertCheckpoint(placement.checkpoint)
      const prop = placement.prop
      layerWorkspace.execute([{ type: 'addProp', id: prop.id, floorId: prop.floorId, definitionRef: prop.definitionRef!, positionMm, rotationDeg: prop.rotationDeg, supportRef: prop.supportRef, layerId: currentLayerId }])
      setPlacement(null); setSelected(prop.id); setMessage(null)
    } catch (error) { setMessage(`未放置：${error instanceof Error ? error.message : String(error)}`) }
  }
  const downloadOriginal = (schema: 1 | 2) => void action(async () => { if (!completeProject) return; const blob = await migrationOriginalV3(completeProject, schema); if (!blob) throw new Error('本地没有此版本的迁移原件。'); download(blob, `sceneweave-original-v${schema}.sceneweave`) })
  const backup = () => { if (completeProject) void action(async () => { download(await exportProjectV3(completeProject), 'sceneweave-layers.sceneweave'); setMessage('完整主持人工程已生成，包含全部资源、许可和秘密。') }) }
  const commit = (run: () => void) => { try { if (structure) throw new Error('请先采用或取消结构预览。'); run(); setMessage(null) } catch (error) { setMessage(error instanceof Error ? error.message : String(error)) } }
  const preview = (input: SceneCommandV3[] | (() => SceneCommandV3[]), description: string, scopeIds?: string[]) => {
    if (!project) return
    try {
      const commands = typeof input === 'function' ? input() : input
      const checkpoint = structure?.checkpoint ?? layerWorkspace.checkpoint()
      layerWorkspace.assertCheckpoint(checkpoint)
      const document = layerWorkspace.preview(commands)
      setStructure({ checkpoint, commands, document, description, scopeIds, ...(scopeIds ? { kind: 'layer' as const } : {}) }); setMessage(null)
    } catch (error) { setMessage(`候选未通过，工程未修改：${error instanceof Error ? error.message : String(error)}`) }
  }
  const select = (id: string | null, operation: 'replace' | 'add' | 'subtract' = 'replace') => { if (structure) return; if (id && scopedHiddenIds.has(id)) { setMessage('该对象在隐藏图层或当前选择范围外，请先调整图层。'); return } setPlacement(null); setMenu(null); if (id && project?.document.props[id] && Object.values(project.document.prefabInstances).some(group => Object.values(group.members).some(member => member.propId === id))) setMemberMode(true); else if (id && project?.document.prefabInstances[id]) setMemberMode(false); selectionSession.set(!id ? [] : normalizeSelectionV2(project!.document, operation === 'replace' ? [id] : operation === 'add' ? [...selectionSession.getSnapshot(), id] : selectionSession.getSnapshot().filter(current => current !== id), true)) }
  const selectMany = (ids: readonly string[]) => { if (structure) return; setPlacement(null); setMenu(null); selectionSession.set(ids.filter(id => !scopedHiddenIds.has(id))) }
  const batchAction = (action: SelectionActionV2, values?: { dx?: number; dy?: number; angle?: number }, ids = selectionSession.getSnapshot(), checkpoint = layerWorkspace.checkpoint()) => {
    if (!project || busy || structure || audience !== 'gm') return
    try {
      layerWorkspace.assertCheckpoint(checkpoint)
      const commands = selectionCommandsV2(project.document, ids, action, values)
      if (action === 'lock' || action === 'unlock') { layerWorkspace.execute(commands); setMessage(null); return }
      const document = layerWorkspace.preview(commands)
      setStructure({ checkpoint, commands, document, kind: 'batch', description: `${{ move: '批量移动', rotate: '批量旋转', delete: '删除所选', copy: '复制所选' }[action]} · ${ids.length} 个选择单元${action === 'move' ? ` · 位移 ${values?.dx ?? 0}, ${values?.dy ?? 0} mm` : action === 'rotate' ? ` · 旋转 ${values?.angle ?? 0}°` : action === 'copy' ? ' · 副本偏移 300, 300 mm' : ''}` }); setMessage(null)
    } catch (error) { setMessage(`整批未采用，工程未修改：${error instanceof Error ? error.message : String(error)}`) }
  }
  const openMenu = (point: PointMm, hits: string[], position: { x: number; y: number }, origin: HTMLElement) => {
    if (!project || structure || busy || audience !== 'gm') return
    const currentIds = selectionSession.getSnapshot(), retained = !!hits[0] && currentIds.includes(hits[0]), ids = hits.length && !retained ? [hits[0]] : [...currentIds]
    if (!retained && hits.length) selectionSession.set(ids)
    setMenu({ ...position, point, hits, ids, checkpoint: layerWorkspace.checkpoint(), origin, blank: !hits.length })
  }
  const closeMenu = (restore = false) => { const origin = menu?.origin; setMenu(null); if (restore) requestAnimationFrame(() => origin?.isConnected && origin.focus({ preventScroll: true })) }
  const visibleCompleteProject = useMemo(() => completeProject && structure ? { ...completeProject, document: structure.document } : completeProject, [completeProject, structure])
  const visibleProject = useMemo(() => visibleCompleteProject ? domainProjectV3(visibleCompleteProject) : null, [visibleCompleteProject])
  const editorRenderer = useMemo(() => visibleCompleteProject ? (options: Parameters<typeof renderEditorProjectV3>[1]) => renderEditorProjectV3(visibleCompleteProject, { ...options, hiddenLayerIds: effectiveHiddenLayers }) : undefined, [visibleCompleteProject, effectiveHiddenLayers])
  const pointHitTest = useMemo(() => visibleCompleteProject ? hitTestLayersV3(visibleCompleteProject.document, hiddenIds) : undefined, [visibleCompleteProject?.document, hiddenIds])
  const boundsSelector = useMemo(() => visibleCompleteProject ? selectInBoundsLayersV3(visibleCompleteProject.document, hiddenIds) : undefined, [visibleCompleteProject?.document, hiddenIds])
  const selectionGeometry = useMemo(() => visibleCompleteProject ? selectionGeometryLayersV3(visibleCompleteProject.document, hiddenIds) : undefined, [visibleCompleteProject?.document, hiddenIds])
  const selectionSummaryReader = useMemo(() => visibleCompleteProject ? summarizeSelectionLayersV3(visibleCompleteProject.document, hiddenIds) : undefined, [visibleCompleteProject?.document, hiddenIds])
  const selectLayer = (layerId: string) => {
    if (!completeProject || !project || !boundsSelector || busy || structure || audience !== 'gm' || effectiveHiddenLayers.has(layerId)) return
    const boxes = [project.document.exportBoundsMm, ...Object.values(project.document.floors).map(floor => floor.boundsMm)]
    const x = Math.min(...boxes.map(box => box.x)), y = Math.min(...boxes.map(box => box.y))
    const right = Math.max(...boxes.map(box => box.x + box.width)), bottom = Math.max(...boxes.map(box => box.y + box.height))
    const found = boundsSelector(project.document, { x, y, width: right - x, height: bottom - y }, 'intersect', { hiddenIds: scopedHiddenEntitiesV3(completeProject.document, hiddenIds, layerId), memberMode })
    setCurrentLayerId(layerId); setPlacement(null); setMenu(null); selectionSession.set(found.ids)
    setMessage(`已选择本层 ${found.ids.length} 个对象；排除锁定 ${found.excludedLocked} 个。`)
  }
  const exportImage = () => { if (completeProject) void action(async () => {
    // Capture the complete immutable project and audience at the click boundary.
    const blob = await exportPngV3(completeProject, { audience, longEdgePx: 4096 })
    download(blob, `sceneweave-${audience}-map.png`)
    setMessage(`${audience === 'gm' ? '主持人' : '玩家'} PNG 已生成 · r${completeProject.document.revision} · 固定工程范围 · 长边 4096 px`)
  }) }
  const saveLabels = { empty: '尚未打开工程', saved: '本地已保存', unsaved: '等待保存', saving: '正在保存', error: '保存失败', conflict: '版本冲突' }
  const openHistory = () => void action(async () => {
    const checkpoint = layerWorkspace.checkpoint()
    await layerWorkspace.flush()
    layerWorkspace.assertCheckpoint(checkpoint)
    const current = layerWorkspace.getState().project
    if (!current) throw new Error('尚未打开工程。')
    onOpenHistory?.(current)
  })
  return <>
    <div className="asset-shell" ref={shell} data-testid="layer-workbench" data-revision={project?.document.revision}>
      <header className="asset-header"><button className="asset-brand" disabled={!!structure} onClick={() => void action(async () => { await layerWorkspace.flush(); onBack() })}><ArrowLeft size={18}/><span>织境<small>Sceneweave</small></span></button><div className="asset-header-title"><Layers3 size={20}/><span>图层工坊</span><b>场景组织</b></div><div className="asset-header-actions"><span role="status" className={`asset-save ${state.status}`}>{state.status === 'saving' ? <LoaderCircle size={14} className="spin"/> : <CheckCircle2 size={14}/>} {saveLabels[state.status]}</span><button className="secondary" disabled={busy || !!structure} onClick={() => file.current?.click()}><Upload size={15}/>打开工程</button><button className="primary" disabled={busy || !!structure || !project} onClick={backup}><Download size={15}/>完整工程</button><button className="secondary" disabled={busy || !!structure || !project} onClick={exportImage}><Download size={15}/>4K PNG</button></div></header>
      <div className="asset-phase-note">用户图层 · 完整场景{onOpenHistory && <button className="text-button" disabled={busy || !!structure || !completeProject} onClick={openHistory}><Archive size={15}/>命名快照与恢复</button>}</div>
      {(state.error || message) && <div className="asset-notice" role="alert"><span>{message ?? state.error}</span>{state.status === 'error' && <button onClick={() => void action(() => layerWorkspace.retry())}>重试保存</button>}{['conflict', 'error'].includes(state.status) && <button onClick={() => void action(async () => { await layerWorkspace.saveAsCopy(); await refresh() })}>另存副本</button>}<button aria-label="关闭工坊提示" onClick={() => setMessage(null)}><X size={16}/></button></div>}
      {diagnostics && audience === 'gm' && <ProjectDiagnostics notice={diagnostics} onClose={() => setDiagnostics(null)} onChooseFile={() => file.current?.click()}/>}
      <div className="asset-layout">
        <div className="layer-library-stack">{completeProject && audience === 'gm' && <UserLayerPanel scene={completeProject.document} session={selectionSession} currentLayerId={currentLayerId} hiddenLayerIds={hiddenLayerIds} soloLayerId={soloLayerId} currentOnly={currentOnly} disabled={busy || !!structure} onCurrent={id => { setPlacement(null); setCurrentLayerId(id) }} onHidden={id => setHiddenLayerIds(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next })} onSolo={id => setSoloLayerId(current => current === id ? null : id)} onScope={setCurrentOnly} moveRequest={layerMoveRequest} onSelectLayer={selectLayer} onCommand={commands => commit(() => layerWorkspace.execute(commands))} onPreview={preview}/> }<SelectionSubscriber session={selectionSession}>{ids => <SceneLibrary project={project} selected={ids.length === 1 ? ids[0] : null} selectedIds={[...ids]} busy={busy || !!structure} recent={recent} onSelect={select} onNew={openNewScene} onPlace={choosePlacement} placingId={placement?.prop.definitionRef?.id ?? null} canPlace={audience === 'gm' && !!completeProject?.document.userLayers[currentLayerId] && !completeProject.document.userLayers[currentLayerId].editLocked && !effectiveHiddenLayers.has(currentLayerId)}
          onIsland={() => prepare(createIslandProject, '原创室外样板：双层岩岛、草岩浅水、高差台阶与可保留人工调整的散布。')}
          onStudy={() => prepare(createStudyProject, '原创室内建筑样板：书房与露台、厚墙与斜窗、墨绘原野材质及可拆分组合。')}
          onCalibration={() => prepare(createCalibrationProject, 'B1 原创程序校样：重复木纹、透明书桌与椅子，用于验证素材和工程保存。')}
          onMigrate={migrateCurrent} onOpen={id => void action(async () => {
            setAudience('gm'); setDiagnostics(null)
            const checkpoint = layerWorkspace.checkpoint(); await ready(); const saved = await repository.load(id)
            if (!saved) throw new Error('工程不存在。')
            await layerWorkspace.openPersisted(saved, checkpoint); setSelected(null)
          }, '打开本地工程')}/>}</SelectionSubscriber></div>
        <main className="asset-center"><div className="asset-scene-bar"><div><small>{audience === 'gm' ? '主持人场景' : '玩家场景'}</small><h1>{project?.document.title ?? '让空间有材质，也有故事'}</h1></div><div className="asset-toolbar"><button aria-label="撤销素材编辑" disabled={!state.canUndo || busy || !!structure} onClick={() => commit(() => layerWorkspace.undo())}><Undo2 size={17}/></button><button aria-label="重做素材编辑" disabled={!state.canRedo || busy || !!structure} onClick={() => commit(() => layerWorkspace.redo())}><Redo2 size={17}/></button><button aria-label="素材历史快照" disabled={!project || busy || !!structure} onClick={() => void action(async () => { await layerWorkspace.flush(); setSnapshots(await repository.listSnapshots(project!.document.sceneId)) })}><Archive size={17}/></button></div></div>
          <div className="asset-view-bar"><div role="group" aria-label="预览受众" className="asset-audience"><button disabled={busy || !!structure} aria-pressed={audience === 'gm'} onClick={() => setAudience('gm')}>主持人</button><button disabled={busy || !!structure} aria-pressed={audience === 'player'} onClick={() => { setAudience('player'); setSelected(null) }}>玩家</button></div><span>{project ? `${(project.document.exportBoundsMm.width / 1000).toFixed(1)} × ${(project.document.exportBoundsMm.height / 1000).toFixed(1)} m · 固定范围` : '二维俯视 · 毫米世界坐标'}</span></div>
          {structure && <div className="asset-structure-preview" role="status"><div><strong>{structure.description} · 候选预览</strong><span>尚未写入工程，采用后作为一次编辑保存</span>{structure.scopeIds && <details className="layer-preview-scope"><summary>实际操作范围 · {structure.scopeIds.length} 项</summary><textarea readOnly aria-label="待采用图层操作 ID" rows={4} value={structure.scopeIds.join('\n')}/></details>}</div><button className="secondary" onClick={() => setStructure(null)}>{structure.kind === 'batch' ? '取消批量预览' : structure.kind === 'layer' ? '取消图层预览' : '取消结构预览'}</button><button className="primary" onClick={() => {
            try { layerWorkspace.assertCheckpoint(structure.checkpoint); layerWorkspace.execute(structure.commands); setStructure(null); setMessage(null) }
            catch (error) { setStructure(null); setMessage(error instanceof Error ? error.message : String(error)) }
          }}>{structure.kind === 'batch' ? '采用批量修改' : structure.kind === 'layer' ? '采用图层修改' : '采用结构修改'}</button></div>}
          <div className="asset-stage">{visibleProject ? <AssetCanvas project={visibleProject} editorRenderer={editorRenderer} selectionOptions={selectionOptions} pointHitTest={pointHitTest} boundsSelector={boundsSelector} selectionGeometry={selectionGeometry} selectionSummaryReader={selectionSummaryReader} selected={null} selectionSession={selectionSession} onSelect={select} onSelectMany={selectMany} onContext={openMenu} memberMode={memberMode} onMemberMode={setMemberMode} fitRequest={fitRequest} audience={audience} disabled={busy || !!structure || audience === 'player'} placement={placement?.prop} onPlacementMove={positionMm => setPlacement(current => current ? { ...current, prop: { ...current.prop, positionMm } } : null)} onPlace={placeAt} onPlacementReady={setPlacementReady} onPlacementError={error => { setPlacement(null); setMessage(error) }} onCancelPlacement={() => setPlacement(null)}/> : <div className="asset-empty"><div className="asset-empty-icon"><Layers3 size={36}/></div><span>从一张空白画布开始</span><p>选择画布范围与使用预设，逐件放入素材。<br/>也可从左侧打开书房或岩岛样板。</p><button className="primary" disabled={busy} onClick={openNewScene}>新建场景</button></div>}</div><footer className="asset-canvas-footer"><span>{audience === 'gm' ? '主持人视图 · 工程可能包含秘密' : '玩家视图 · 已过滤私密内容'}</span>{project && <span>{Object.keys(project.assets).length} 张位图 · {Object.keys(project.document.props).length} 件物件 · r{project.document.revision}</span>}</footer>
        </main>
        <SelectionSubscriber session={selectionSession}>{ids => { const selectedIds = ids, selected = ids.length === 1 ? ids[0] : null; return <aside className="asset-inspector">{project && selectedIds.length > 0 && audience === 'gm' && !placement && <button className="secondary asset-wide" disabled={busy || !!structure} onClick={event => { const b = event.currentTarget.getBoundingClientRect(), bounds = project.document.exportBoundsMm; openMenu(project.document.props[selectedIds[0]]?.positionMm ?? { x: Math.round(bounds.x + bounds.width / 2), y: Math.round(bounds.y + bounds.height / 2) }, [...selectedIds], { x: b.left, y: b.bottom }, event.currentTarget) }}>更多操作</button>}{project && placement && audience === 'gm' ? <PlacementInspector scene={project.document} prop={placement.prop} busy={busy} ready={placementReady} onChange={changes => setPlacement(current => current ? { ...current, prop: { ...current.prop, ...changes } } : null)} onPlace={() => placeAt(placement.prop.positionMm)} onCancel={() => setPlacement(null)}/> : visibleProject && selectedIds.length > 1 && audience === 'gm' ? <SelectionInspector scene={project!.document} ids={selectedIds} summaryReader={selectionSummaryReader} busy={busy || !!structure} onAction={batchAction} onClear={() => select(null)}/> : visibleProject && selected && audience === 'gm' ? <SceneInspector project={visibleProject} selected={selected} busy={busy || !!structure} workspace={layerWorkspace} onSelect={select} onCommit={commit} onPreview={preview}/> : <>
          <div className="asset-section-heading"><Move size={16}/><h2>{audience === 'player' ? '玩家输出' : '工程信息'}</h2></div>
          {project ? <><h3>{project.document.activeStyleThemeRef ? '墨绘原野 · v1' : '用户图层 · 完整工程'}</h3><p className="asset-muted">{audience === 'player' ? '预览与 PNG 使用同一投影和绘制流程，私密内容在材质与阴影派生前过滤。' : '选择画面中的物件，或从左侧切换组合、散布与场景结构。全部素材、定义和许可随工程保存。'}</p>
            <dl className="asset-facts"><dt>场景修订</dt><dd>r{project.document.revision}</dd><dt>素材字节</dt><dd>{bytesLabel(Object.values(project.assets).reduce((sum, asset) => sum + asset.sizeBytes, 0))}</dd><dt>定义快照</dt><dd>{Object.keys(project.document.propDefinitions).length} 件物件 / {Object.keys(project.document.materials).length} 种材质</dd><dt>许可绑定</dt><dd>{project.licenseBindings.length} 条</dd></dl>
            {audience === 'gm' && <><h3>地面材质</h3>{Object.values(project.document.rooms).filter(room => room.floorStyle).map(room => <fieldset key={room.id} disabled={busy || !!structure || room.editLocked}><NumberInput label="木纹方向" value={room.floorStyle!.base.rotationDeg} unit="°" onCommit={rotation => commit(() => layerWorkspace.rotateRoomMaterial(room.id, rotation))}/></fieldset>)}<button className="secondary asset-wide" disabled={busy || !!structure} onClick={() => void action(async () => {
              const report = await diagnoseCompleteProjectV3(completeProject!)
              setDiagnostics({ source: `当前工程 · r${project.document.revision}`, report })
              setMessage(report.complete ? '完整工程校验通过：格式、引用、位图与许可一致。' : '完整工程检查未通过，请查看问题清单。')
            }, '当前工程完整性检查')}><CheckCircle2 size={15}/>校验完整工程</button></>}
            {audience === 'gm' && project.document.presetSnapshot.presetId === 'sceneweave-vis02' && <TerrainTravelPanel scene={project.document} disabled={busy || !!structure}/>}
            {completeProject?.migrationSource && <div className="asset-provenance"><strong>v2 图层迁移副本</strong><p>来源修订 r{completeProject.migrationSource.sourceRevision}，原始完整包独立保存在本地。</p><button onClick={() => downloadOriginal(2)}>下载 v2 迁移原件</button>{completeProject.migrationSource.previousSource && <button onClick={() => downloadOriginal(1)}>下载 M0 迁移原件</button>}</div>}
          </> : <p className="asset-muted">新建空白场景，打开室内外样板，或导入完整工程。</p>}
          <div className="asset-next"><RotateCw size={16}/><strong>把场景保存完整</strong><p>工程文件携带素材、材质与许可。定期下载备份，继续编辑前可检查工程完整性。</p></div>
        </>}</aside> }}</SelectionSubscriber>
      </div>
      <input hidden ref={file} type="file" accept=".sceneweave" aria-label="选择完整素材工程" onChange={event => { const selected = event.target.files?.[0]; event.target.value = ''; if (selected) prepare(async signal => { const version = await inspectProjectVersionV3(selected, { signal }); if (version === 3) return forkProjectV3(await importProjectV3(selected, { signal })); const old = version === 2 ? await importProjectV2(selected, { signal }) : await prepareProjectFile(selected, signal); return createLayerProject(old, { original: version === 2 ? selected : undefined, signal }) }, '打开为独立图层副本；旧工程经过完整迁移，原工程继续保留。') }}/>
      {busy && <div className="asset-busy" role="status"><LoaderCircle size={17} className="spin"/>正在处理完整工程…{controller.current && <button onClick={() => controller.current?.abort()}>取消准备</button>}</div>}
    </div>
    {menu && project && <SceneContextMenu key={`${menu.checkpoint}-${menu.x}-${menu.y}-${menu.ids.join('|')}`} project={project} menu={menu} onMoveToLayer={() => { try { layerWorkspace.assertCheckpoint(menu.checkpoint); selectionSession.set(menu.ids); setLayerMoveRequest(value => value + 1) } catch (error) { setMessage(String(error)) } }} onClose={closeMenu} onAction={action => batchAction(action, undefined, menu.ids, menu.checkpoint)} onSelect={select} onFit={() => setFitRequest(value => value + 1)} onPlace={(id, point) => { try { layerWorkspace.assertCheckpoint(menu.checkpoint); choosePlacement(id, point) } catch (error) { setMessage(String(error)) } }} onEdit={() => requestAnimationFrame(() => { const input = shell.current?.querySelector<HTMLElement>('.asset-inspector input:not(:disabled)') ?? shell.current?.querySelector<HTMLElement>('.asset-inspector button:not(:disabled)'); input?.focus() })}/>}
    {(candidate || snapshots || newScene) && <div className="modal-scrim"><div ref={dialog} className="modal" role="dialog" aria-modal="true" aria-label={newScene ? '新建空白场景' : candidate ? '确认打开素材工程' : '素材历史快照'}><div className="modal-heading"><h2>{newScene ? '新建空白场景' : candidate ? '确认打开素材工程' : '素材历史快照'}</h2><button className="icon-button" disabled={busy && !(newScene && creatingStage === 'preparing')} aria-label={newScene ? '取消新建场景' : '取消打开素材工程'} onClick={() => { if (newScene) cancelNewScene(); else { setCandidate(null); setSnapshots(null) } }}><X size={18}/></button></div>{newScene ? <NewSceneForm busy={busy} cancellable={creatingStage === 'preparing'} failure={message ?? state.error} onCreate={createScene} onCancel={cancelNewScene}/> : candidate ? <><p>{candidate.description}</p><div className="asset-candidate"><strong>{candidate.project.document.title}</strong><span>{Object.keys(candidate.project.assets).length} 张位图 · {Object.keys(candidate.project.document.props).length} 件物件 · 完整图层工程</span>{candidate.project.migrationSource && <span>实际来源修订 r{candidate.project.migrationSource.sourceRevision}</span>}</div><div className="modal-actions"><button className="secondary" disabled={busy} onClick={() => setCandidate(null)}>取消</button><button className="primary" disabled={busy} onClick={() => void action(async () => { await ready(); await layerWorkspace.adoptNew(candidate.project, candidate.checkpoint); setCandidate(null); setSelected(null); await refresh() })}>保存并打开副本</button></div></> : <><p>最近 20 次成功保存。恢复会新建完整图层副本。</p><div className="asset-snapshots">{snapshots?.map(snapshot => <div key={snapshot.revision}><span>r{snapshot.revision}</span><small>{new Date(snapshot.savedAt).toLocaleString('zh-CN')}</small><button className="secondary" disabled={busy} onClick={() => void action(async () => {
      const checkpoint = layerWorkspace.checkpoint(), recovered = await repository.loadSnapshot(snapshot.sceneId, snapshot.revision)
      if (!recovered) throw new Error('快照已不存在。')
      layerWorkspace.assertCheckpoint(checkpoint); setSnapshots(null); setCandidate({ project: forkProjectV3(recovered), checkpoint, description: '从历史快照创建副本。当前工程继续保留。' })
    })}>恢复副本</button></div>)}</div></>}</div></div>}
  </>
}
