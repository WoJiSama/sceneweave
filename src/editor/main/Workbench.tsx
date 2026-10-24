import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Archive, ArrowLeft, CheckCircle2, Download, Layers3, PencilRuler, LoaderCircle, Move, Mountain, Plus, Ruler, StickyNote, Redo2, RotateCw, Undo2, Upload, X } from 'lucide-react'
import { WorkspaceRepository } from './repository'
import { Workspace, type CompositionPreview, type RestorePreview, type StructureRestorePreview } from '../../application/workspace/workspace'
import { prepareAssetImport } from '../../application/workspace/prepare'
import { toBundle, type EditableProject } from '../../application/workspace/project'
import { exportProject, exportHistoryArchive } from '../../shared/project/file'
import { validateProjectBundle } from '../../shared/project/resources'
import { projectRepository, validation, runtime } from '../../platform/browser/runtime'
import { createBlankProject, createSampleProject } from '../../platform/browser/content/factories'
import type { ContentLoadProgress } from '../../platform/browser/content/load-resources'
import { inspectOutdoorChanges, isOutdoorCommand, type OutdoorCommand } from '../../shared/commands/outdoor'
import { createPlacedProp, type SceneCommand } from '../../shared/commands/commands'
import { buildingDependants } from '../../shared/commands/building'
import { LAYER_ENTITY_COLLECTIONS, type SceneDocument, type PointMm, type Prop } from '../../shared/model/scene'
import type { CompositionCommand } from '../../shared/model/appearance'
import { exportPng, renderEditorProject } from '../../platform/browser/render/renderer'
import { OUTPOST_PRESET_ID, validateOutpostEdits } from './outpost-constraints'
import { validateStudyEdits } from './study-constraints'
import { validateIslandEdits } from './island-constraints'
import { describeCatalogItems, prepareCatalogEntry, loadBuiltinCatalogV1, prepareCatalogAdoption, type PreparedCatalogEntryV1 } from './catalog'
import OutdoorToolsPanel, { type OutdoorSketch } from './OutdoorToolsPanel'
import OutdoorInspector, { outdoorEntityKind } from './OutdoorInspector'
import SceneDisplayPanel from './SceneDisplayPanel'
import OutpostTravelPanel from './OutpostTravelPanel'
import CompositionLibrary from './CompositionLibrary'
import CatalogLibrary from './CatalogLibrary'
import AiConversationPanel from './AiConversationPanel'
import type { AtomicCandidate } from '../../application/workspace/atomic'
import AuthoringGuide from './AuthoringGuide'
import { authoringStageKind } from './authoring-recipes'
import AppearancePanel from './AppearancePanel'
import PrefabPanel from './PrefabPanel'
import CompositionChangesPanel from './CompositionChangesPanel'
import type { AssetImportFields } from './AssetImportForm'
import BuildingPanel from './BuildingPanel'
import BuildingInspector from './BuildingInspector'
import { formatDistanceMm, type BuildingSketch } from '../native-canvas/building-session'
import UserLayerPanel from './UserLayerPanel'
import { domainProject, hiddenEntities, scopedHiddenEntities, hitTestLayers, selectInBoundsLayers, selectionGeometryLayers, summarizeSelectionLayers } from '../native-canvas/layer-view'
import { NumberInput } from '../native-canvas/controls'
import SceneInspector from './SceneInspector'
import SceneLibrary from './SceneLibrary'
import TerrainTravelPanel from './TerrainTravelPanel'
import HistoryPanel, { RestoreChangesPanel } from './HistoryPanel'
import { StructureRestoreChangesPanel } from './StructureHistoryPanel'
import AssetCanvas from '../native-canvas/AssetCanvas'
import NewSceneForm, { type NewSceneOptions } from './NewSceneForm'
import PlacementInspector from './PlacementInspector'
import SelectionInspector from './SelectionInspector'
import SceneContextMenu, { type SceneMenu } from './SceneContextMenu'
import { normalizeSelection } from '../native-canvas/selection'
import { selectionCommands, type SelectionAction } from '../native-canvas/selection-actions'
import { SelectionSession } from '../native-canvas/selection-session'
import { SelectionSubscriber } from '../native-canvas/SelectionSubscriber'
import type { WorkspaceController, WorkspaceRequest, WorkspaceSessionSummary } from '../main-shell/session'
import WorkspaceLayout from '../workspace/WorkspaceLayout'
import { workspaceTransitionReason, workspaceFormDraftLabels, type WorkspaceDraft, type WorkspaceFormDraft, type WorkspaceTransient } from './session-guard'
import './assets.css'
import './layers.css'
import './history.css'
import './composition.css'
import './outdoor.css'
import './unified-workbench.css'

const repository = new WorkspaceRepository()
export const nativeWorkspace = new Workspace(projectRepository, { validation, runtime, validateCandidate: document => { validateStudyEdits(document); validateIslandEdits(document); validateOutpostEdits(document) } })
const compositionWorkspace = nativeWorkspace
const ready = () => repository.open()
type LoadProgress = (progress: ContentLoadProgress) => void
const createStudyProject = (signal: AbortSignal, progress?: LoadProgress) => createSampleProject('study', signal, progress)
const createIslandProject = (signal: AbortSignal, progress?: LoadProgress) => createSampleProject('island', signal, progress)
const createOutpostProject = (signal: AbortSignal, progress?: LoadProgress) => createSampleProject('outpost', signal, progress)
const createGraveyardProject = (signal: AbortSignal, progress?: LoadProgress) => createSampleProject('graveyard', signal, progress)
const createVolcanoProject = (signal: AbortSignal, progress?: LoadProgress) => createSampleProject('volcano', signal, progress)
const createCalibrationProject = (signal: AbortSignal, progress?: LoadProgress) => createSampleProject('calibration', signal, progress)
function waitForBuiltin(promise: Promise<EditableProject>, signal?: AbortSignal): Promise<EditableProject> {
  if (!signal) return promise
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const cancel = () => reject(signal.reason)
    signal.addEventListener('abort', cancel, { once: true })
    promise.then(value => { signal.removeEventListener('abort', cancel); if (!signal.aborted) resolve(value) }, error => { signal.removeEventListener('abort', cancel); reject(error) })
  })
}
const bytesLabel = (bytes: number) => `${(bytes / 1024).toFixed(1)} KiB`
const download = (blob: Blob, name: string) => {
  const url = URL.createObjectURL(blob), anchor = document.createElement('a')
  anchor.href = url; anchor.download = name; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 30_000)
}
type Candidate = { project: EditableProject; checkpoint: number; description: string }
type StructurePreview = { prepared: CompositionPreview; checkpoint: number; commands: CompositionCommand[]; document: SceneDocument; description: string; kind?: 'batch' | 'layer' | 'building' | 'outdoor' | 'display'; scopeIds?: string[]; layerIds?: string[]; confirmed?: boolean; selectionAfterAdopt?: string | null }
const initialFormDrafts = () => Object.fromEntries(Object.keys(workspaceFormDraftLabels).map(key => [key, false])) as Record<WorkspaceFormDraft, boolean>
const initialFormResets = () => Object.fromEntries(Object.keys(workspaceFormDraftLabels).map(key => [key, 0])) as Record<WorkspaceFormDraft, number>

type OutdoorWorkbenchProps = {
  onBack: () => void
  onImportFile: (file: File) => void
  unified?: boolean
  active?: boolean
  onController?: (controller: WorkspaceController | null) => void
  onSession?: (summary: WorkspaceSessionSummary | null) => void
}
export default function Workbench({ onBack, onImportFile, unified = true, active = true, onController, onSession }: OutdoorWorkbenchProps) {
  const state = useSyncExternalStore(compositionWorkspace.subscribe, compositionWorkspace.getState), completeProject = state.project
  const project = useMemo(() => completeProject ? domainProject(completeProject) : null, [completeProject])
  const [currentLayerId, setCurrentLayerId] = useState(''), [hiddenLayerIds, setHiddenLayerIds] = useState<ReadonlySet<string>>(new Set()), [soloLayerId, setSoloLayerId] = useState<string | null>(null), [currentOnly, setCurrentOnly] = useState(false)
  const effectiveHiddenLayers = useMemo(() => new Set(completeProject ? Object.keys(completeProject.document.userLayers).filter(id => hiddenLayerIds.has(id) || soloLayerId !== null && soloLayerId !== id) : []), [completeProject?.document, hiddenLayerIds, soloLayerId])
  const hiddenIds = useMemo(() => completeProject ? hiddenEntities(completeProject.document, effectiveHiddenLayers) : new Set<string>(), [completeProject?.document, effectiveHiddenLayers])
  const scopedHiddenIds = useMemo(() => completeProject ? scopedHiddenEntities(completeProject.document, hiddenIds, currentOnly ? currentLayerId : null) : hiddenIds, [completeProject?.document, hiddenIds, currentOnly, currentLayerId])
  const selectionOptions = useMemo(() => ({ hiddenIds: scopedHiddenIds }), [scopedHiddenIds])
  const [recent, setRecent] = useState<Awaited<ReturnType<WorkspaceRepository['list']>>>([])
  const [sessionGeneration, setSessionGeneration] = useState(0)
  const [authoringOpen, setAuthoringOpen] = useState(false)
  const [navigationTab, setNavigationTab] = useState<'layers' | 'objects' | 'history'>('objects')
  const [toolControlsTarget, setToolControlsTarget] = useState<HTMLDivElement | null>(null)
  const [viewControlsTarget, setViewControlsTarget] = useState<HTMLDivElement | null>(null)
  const [panelRequest, setPanelRequest] = useState<{ id: 'resources' | 'inspector' | 'navigation'; sequence: number }>()
  const revealPanel = (id: 'resources' | 'inspector' | 'navigation') => setPanelRequest(current => ({ id, sequence: (current?.sequence ?? 0) + 1 }))
  const [formDrafts, setFormDrafts] = useState(initialFormDrafts)
  const [formReset, setFormReset] = useState(initialFormResets)
  const [catalogBusy, setCatalogBusy] = useState(false)
  const catalogPending = useRef(false)
  const [builtinProject, setBuiltinProject] = useState<EditableProject>()
  const [builtinLoading, setBuiltinLoading] = useState(false), [builtinError, setBuiltinError] = useState<string>()
  const builtinValue = useRef<EditableProject | undefined>(undefined)
  const builtinOperation = useRef<{ abort: AbortController; promise: Promise<EditableProject> } | null>(null)
  const ensureBuiltin = useCallback((signal?: AbortSignal): Promise<EditableProject> => {
    signal?.throwIfAborted()
    if (builtinValue.current) return Promise.resolve(builtinValue.current)
    if (!builtinOperation.current) {
      const abort = new AbortController(), loading = { abort, promise: null! as Promise<EditableProject> }
      setBuiltinLoading(true); setBuiltinError(undefined)
      loading.promise = loadBuiltinCatalogV1(abort.signal).then(value => {
        abort.signal.throwIfAborted()
        if (builtinOperation.current === loading) { builtinValue.current = value; setBuiltinProject(value) }
        return value
      }).catch(error => {
        if (builtinOperation.current === loading && !abort.signal.aborted) setBuiltinError(error instanceof Error ? error.message : String(error))
        throw error
      }).finally(() => { if (builtinOperation.current === loading) { builtinOperation.current = null; setBuiltinLoading(false) } })
      builtinOperation.current = loading
    }
    return waitForBuiltin(builtinOperation.current.promise, signal)
  }, [])
  const requestBuiltin = useCallback(() => { void ensureBuiltin().catch(() => { /* Explicit catalogue retry remains available. */ }) }, [ensureBuiltin])
  const onCatalogPending = useCallback((pending: boolean) => { catalogPending.current = pending; setCatalogBusy(pending) }, [])
  const onCatalogDraft = useCallback((dirty: boolean) => setFormDrafts(current => current.catalogForm === dirty ? current : { ...current, catalogForm: dirty }), [])
  const onPropAppearanceDraft = useCallback((dirty: boolean) => setFormDrafts(current => current.propAppearanceForm === dirty ? current : { ...current, propAppearanceForm: dirty }), [])
  const [busy, setBusy] = useState(false), [message, setMessage] = useState<string | null>(null)
  const [selectionSession] = useState(() => new SelectionSession())
  const setSelected = (id: string | null) => selectionSession.set(id ? [id] : [])
  const [layerMoveRequest, setLayerMoveRequest] = useState(0)
  const [memberMode, setMemberMode] = useState(false), [menu, setMenu] = useState<SceneMenu | null>(null), [fitRequest, setFitRequest] = useState(0)
  const [candidate, setCandidate] = useState<Candidate | null>(null)
  const [preparation, setPreparation] = useState<{ abort: AbortController; description: string; progress: ContentLoadProgress | null; cancelling: boolean } | null>(null)
  const cancelPreparation = () => { controller.current?.abort(); setPreparation(current => current ? { ...current, cancelling: true } : current) }
  const [sidebar, setSidebar] = useState<'scene' | 'history' | 'building' | 'library' | 'outdoor' | 'ai'>(unified ? 'library' : 'scene'), [historyRefresh, setHistoryRefresh] = useState(0)
  const [restore, setRestore] = useState<RestorePreview | null>(null)
  const [restoreConfirmed, setRestoreConfirmed] = useState(false)
  const restoreRef = useRef<RestorePreview | null>(null)
  restoreRef.current = restore
  const [structureRestore, setStructureRestore] = useState<StructureRestorePreview | null>(null)
  const structureRestoreRef = useRef<StructureRestorePreview | null>(null)
  structureRestoreRef.current = structureRestore
  const [structure, setStructure] = useState<StructurePreview | null>(null), [audience, setAudience] = useState<'gm' | 'player'>('gm')
  const structureRef = useRef<StructurePreview | null>(null)
  structureRef.current = structure
  const [sketch, setSketch] = useState<BuildingSketch | null>(null)
  const [outdoorSketch, setOutdoorSketch] = useState<OutdoorSketch | null>(null)
  const [newScene, setNewScene] = useState(false)
  const [prefabPlacement, setPrefabPlacement] = useState<string | null>(null)
  const [creatingStage, setCreatingStage] = useState<'preparing' | 'saving' | null>(null)
  const creatingStageRef = useRef<'preparing' | 'saving' | null>(null)
  const [placement, setPlacement] = useState<{ prop: Prop; checkpoint: number } | null>(null)
  const [placementReady, setPlacementReady] = useState(false)
  const [aiPreview, setAiPreview] = useState<AtomicCandidate | null>(null), [showAiDraft, setShowAiDraft] = useState(false), [aiCritical, setAiCritical] = useState(false)
  const aiShown = !!aiPreview && showAiDraft && audience === 'gm'
  useEffect(() => { setAiPreview(null); setShowAiDraft(false) }, [completeProject?.document.sceneId, sessionGeneration])
  const previewRef = useRef(false)
  previewRef.current = !!structure || !!restore || !!structureRestore
  const editingBlocked = !!structure || !!restore || !!structureRestore || aiShown || aiCritical
  const placingRef = useRef(false)
  placingRef.current = !!placement
  const file = useRef<HTMLInputElement>(null), controller = useRef<AbortController | null>(null), shell = useRef<HTMLDivElement>(null), dialog = useRef<HTMLDivElement>(null)
  const modalOrigin = useRef<HTMLElement | null>(null)
  const actionPending = useRef(false)
  const activeRef = useRef(active)
  activeRef.current = active
  const transient = (): WorkspaceTransient => ({ busy: busy || actionPending.current || catalogPending.current || aiCritical, preparing: !!controller.current && creatingStageRef.current !== 'saving',
    newScene, candidate: !!candidate, placement: !!placement, prefabPlacement: !!prefabPlacement, sketch: !!sketch,
    outdoorSketch: !!outdoorSketch, restore: !!restore, structureRestore: !!structureRestore, structure: !!structure, aiPreview: aiShown, ...formDrafts })
  const transientRef = useRef(transient)
  transientRef.current = transient
  const guard = (completing?: WorkspaceDraft | readonly WorkspaceDraft[]) => {
    const reason = workspaceTransitionReason(transientRef.current(), completing)
    if (reason) { setMessage(reason); return false }
    return true
  }
  const hasDraft = !!placement || !!prefabPlacement || !!sketch || !!outdoorSketch || Object.values(formDrafts).some(Boolean)
  const editDisabled = busy || catalogBusy || editingBlocked || hasDraft
  const markFormDraft = (key: keyof typeof formDrafts) => setFormDrafts(current => current[key] ? current : { ...current, [key]: true })
  const finishFormDraft = (key: keyof typeof formDrafts, reset = false) => {
    setFormDrafts(current => ({ ...current, [key]: false }))
    if (reset) setFormReset(current => ({ ...current, [key]: current[key] + 1 }))
  }
  const toolDisabled = (completing: readonly WorkspaceDraft[]) => !!workspaceTransitionReason(transient(), completing)
  const sessionActions = useRef<WorkspaceController | null>(null)
  const refresh = async () => { await ready(); setRecent(await repository.list()) }
  const action = async (run: () => Promise<void>, failureSource = '工程操作') => {
    if (actionPending.current) return
    actionPending.current = true
    if (!candidate && !newScene && !document.activeElement?.closest('[role="dialog"]')) modalOrigin.current = document.activeElement as HTMLElement | null
    setBusy(true); setMessage(null)
    try { await run() } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') setMessage('准备已取消，当前工程和本地存档未改变。')
      else setMessage(`${failureSource}：${error instanceof Error ? error.message : String(error)}`)
    }
    finally { actionPending.current = false; setBusy(false) }
  }
  useEffect(() => { void refresh().catch(error => setMessage(String(error))); return () => { controller.current?.abort() } }, [])
  useEffect(() => () => { const current = builtinOperation.current; builtinOperation.current = null; current?.abort.abort() }, [])
  useEffect(() => {
    onController?.({ leave: destination => sessionActions.current!.leave(destination), request: request => sessionActions.current!.request(request) })
    return () => onController?.(null)
  }, [onController])
  useEffect(() => {
    onSession?.(completeProject ? { sceneId: completeProject.document.sceneId, title: completeProject.document.title,
      revision: completeProject.document.revision, status: state.status } : null)
  }, [onSession, completeProject, state.status])
  useEffect(() => {
    // Remembering the selection is optional; IndexedDB owns the complete project.
    try { if (project) localStorage.setItem('sceneweave.mainSceneId', project.document.sceneId) } catch { /* The recent list still permits reopening. */ }
    setSelected(null)
    setFormDrafts(initialFormDrafts())
    setStructure(null); setRestore(null); setStructureRestore(null); setSketch(null); setOutdoorSketch(null); setPrefabPlacement(null); setAudience('gm'); setMemberMode(false); setHiddenLayerIds(new Set()); setSoloLayerId(null); setCurrentOnly(false); setLayerMoveRequest(0); setCurrentLayerId(Object.keys(completeProject?.document.userLayers ?? {})[0] ?? '')
    if (project) void refresh().catch(() => {})
  }, [project?.document.sceneId, sessionGeneration])
  useEffect(() => { if (state.status === 'saved') void refresh().catch(() => {}) }, [state.status, project?.document.revision])
  useEffect(() => { if (structureRef.current) compositionWorkspace.cancelPreview(structureRef.current.prepared); setStructure(null) }, [project?.document.sceneId, project?.document.revision])
  useEffect(() => { if (restoreRef.current) compositionWorkspace.cancelRestore(restoreRef.current); setRestore(null) }, [project?.document.sceneId, project?.document.revision])
  useEffect(() => { setRestoreConfirmed(false) }, [restore])
  useEffect(() => { if (structureRestoreRef.current) compositionWorkspace.cancelStructureRestore(structureRestoreRef.current); setStructureRestore(null) }, [project?.document.sceneId, project?.document.revision])
  useEffect(() => { setPlacement(null); setMenu(null); setSketch(null); setOutdoorSketch(null); if (project) selectionSession.set(normalizeSelection(project.document, selectionSession.getSnapshot(), true).filter(id => !scopedHiddenIds.has(id))) }, [project, audience, scopedHiddenIds])
  useEffect(() => {
    if (import.meta.env.DEV) Reflect.set(window, '__sceneweaveOutdoorDev', { workspace: compositionWorkspace, repository })
    const unload = (event: BeforeUnloadEvent) => { if (workspaceTransitionReason(transientRef.current()) || !['empty', 'saved'].includes(compositionWorkspace.getState().status)) { event.preventDefault(); event.returnValue = '' } }
    const key = (event: KeyboardEvent) => {
      if (!activeRef.current) return
      if (actionPending.current) return
      if (previewRef.current) { if (event.key === 'Escape' && !(event.target as HTMLElement)?.closest('input,textarea,select,[contenteditable]')) { event.preventDefault(); if (structureRef.current) compositionWorkspace.cancelPreview(structureRef.current.prepared); setStructure(null); if (restoreRef.current) compositionWorkspace.cancelRestore(restoreRef.current); setRestore(null); if (structureRestoreRef.current) compositionWorkspace.cancelStructureRestore(structureRestoreRef.current); setStructureRestore(null) }; return }
      if ((event.target as HTMLElement)?.closest('input,textarea,select,[contenteditable]') || event.isComposing || document.querySelector('[role="dialog"],[role="menu"]')) return
      if (event.key === 'Escape' && placingRef.current) { event.preventDefault(); setPlacement(null); return }
      if (event.key === 'Escape' && transientRef.current().prefabPlacement) { event.preventDefault(); setPrefabPlacement(null); finishFormDraft('prefabForm', true); return }
      if ((event.metaKey || event.ctrlKey) && ['z', 'y', 's'].includes(event.key.toLowerCase())) {
        event.preventDefault()
        if (workspaceTransitionReason(transientRef.current())) { setMessage(workspaceTransitionReason(transientRef.current())); return }
        try {
          if (event.key.toLowerCase() === 's') void action(() => compositionWorkspace.flush())
          else if (event.key.toLowerCase() === 'y' || event.shiftKey) compositionWorkspace.redo()
          else compositionWorkspace.undo()
        } catch (error) { setMessage(String(error)) }
      }
    }
    window.addEventListener('beforeunload', unload); window.addEventListener('keydown', key)
    return () => { if (structureRef.current) compositionWorkspace.cancelPreview(structureRef.current.prepared); if (restoreRef.current) compositionWorkspace.cancelRestore(restoreRef.current); if (structureRestoreRef.current) compositionWorkspace.cancelStructureRestore(structureRestoreRef.current); window.removeEventListener('beforeunload', unload); window.removeEventListener('keydown', key) }
  }, [])
  useEffect(() => {
    if (!active || !candidate && !newScene && !preparation) return
    const prior = modalOrigin.current, background = shell.current
    if (background) background.inert = true
    dialog.current?.querySelector<HTMLButtonElement>('button')?.focus()
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (preparation) { event.preventDefault(); cancelPreparation() }
        else if (newScene && creatingStageRef.current === 'preparing') { controller.current?.abort(); setNewScene(false) }
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
  }, [candidate, newScene, busy, active, !!preparation])
  const prepare = (factory: (signal: AbortSignal, progress?: LoadProgress) => Promise<EditableProject>, description: string) => {
    if (actionPending.current || !guard()) return
    const abort = new AbortController(); controller.current = abort
    setPreparation({ abort, description, progress: null, cancelling: false })
    void action(async () => {
      const checkpoint = compositionWorkspace.checkpoint()
      try {
        // Paint the cancellable preparation dialog before starting synchronous metadata work.
        await new Promise<void>(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)))
        abort.signal.throwIfAborted()
        const prepared = await factory(abort.signal, progress => setPreparation(current => current?.abort === abort && !abort.signal.aborted ? { ...current, progress } : current))
        abort.signal.throwIfAborted(); compositionWorkspace.assertCheckpoint(checkpoint)
        setCandidate({ project: prepared, checkpoint, description })
      } finally {
        if (controller.current === abort) controller.current = null
        setPreparation(current => current?.abort === abort ? null : current)
      }
    }, '准备打开工程')
  }
  const openReference = (sceneId: string, reload = false) => {
    if (!reload && sceneId === compositionWorkspace.getState().project?.document.sceneId) return
    if (!guard()) return
    void action(async () => {
      const checkpoint = compositionWorkspace.checkpoint()
      await compositionWorkspace.flush(); compositionWorkspace.assertCheckpoint(checkpoint)
      const project = await repository.load(sceneId)
      if (!project) throw new Error('工程已不存在。')
      compositionWorkspace.assertCheckpoint(checkpoint)
      await compositionWorkspace.openPersisted(project, checkpoint)
      setSessionGeneration(value => value + 1); setAudience('gm'); setSelected(null); await refresh()
    }, reload ? '重新打开工程' : '打开本地工程')
  }
  const openNewScene = () => {
    if (!guard()) return
    modalOrigin.current = document.activeElement as HTMLElement | null
    setMessage(null); setNewScene(true)
  }
  const requestImport = () => { if (guard()) file.current?.click() }
  const leave = async (destination: 'home' | 'legacy'): Promise<boolean> => {
    if (!guard()) return false
    actionPending.current = true; setBusy(true)
    const checkpoint = compositionWorkspace.checkpoint()
    try {
      if (destination === 'legacy') await compositionWorkspace.close()
      else { await compositionWorkspace.flush(); compositionWorkspace.assertCheckpoint(checkpoint) }
      return true
    } catch (error) {
      setMessage(`暂不能离开：${error instanceof Error ? error.message : String(error)}。当前编辑与撤销已保留，可重试保存、下载当前工程或另存副本。`)
      return false
    } finally { actionPending.current = false; setBusy(false) }
  }
  const request = (requested: WorkspaceRequest) => {
    if (requested.type === 'new') openNewScene()
    else if (requested.type === 'import') requestImport()
    else if (requested.type === 'open') openReference(requested.sceneId)
    else if (requested.type === 'open-project') {
      if (!requested.reload && requested.project.document.sceneId === compositionWorkspace.getState().project?.document.sceneId) return
      if (!guard()) return
      void action(async () => { const checkpoint = compositionWorkspace.checkpoint(); await compositionWorkspace.flush(); compositionWorkspace.assertCheckpoint(checkpoint); if (requested.saved !== false) await compositionWorkspace.openPersisted(requested.project, checkpoint); else await compositionWorkspace.adoptNew(requested.project, checkpoint); setSessionGeneration(value => value + 1); setAudience('gm'); setSelected(null); await refresh() }, '打开工程')
    }
    else if (requested.type === 'reload') {
      const current = compositionWorkspace.getState().project
      if (current) openReference(current.document.sceneId, true)
    } else {
      const samples = {
        study: { create: createStudyProject, description: '原创室内建筑样板：书房与露台、厚墙与斜窗、墨绘原野材质及可拆分组合。' },
        island: { create: createIslandProject, description: '原创室外样板：双层岩岛、草岩浅水、高差台阶与可保留人工调整的散布。' },
        outpost: { create: createOutpostProject, description: '原创混合场景：36 × 28 m 海岸哨所，含建筑、地形、道路及布景。全部实体可继续编辑。' },
        calibration: { create: createCalibrationProject, description: 'B1 原创程序校样：重复木纹、透明书桌与椅子，用于验证素材和工程保存。' },
        graveyard: { create: createGraveyardProject, description: '原创墓地内容小样：20 × 16 m 苔石墓园，真实地面、步道、石棺墓碑和铁栏组合，可逐件编辑。' },
        volcano: { create: createVolcanoProject, description: '原创火山内容小样：20 × 16 m 灰烬熔脉，独立熔岩外观、危险区、岩台和坡道，可逐件编辑。' },
      }
      prepare(samples[requested.sample].create, samples[requested.sample].description)
    }
  }
  sessionActions.current = { leave, request }
  const createScene = (options: NewSceneOptions) => void action(async () => {
    controller.current?.abort(); const abort = new AbortController(); controller.current = abort
    creatingStageRef.current = 'preparing'; setCreatingStage('preparing')
    const checkpoint = compositionWorkspace.checkpoint()
    try {
      await ready(); await compositionWorkspace.flush(); abort.signal.throwIfAborted()
      abort.signal.throwIfAborted()
      const prepared = await createBlankProject(options, abort.signal)
      abort.signal.throwIfAborted(); compositionWorkspace.assertCheckpoint(checkpoint)
      creatingStageRef.current = 'saving'; setCreatingStage('saving')
      abort.signal.throwIfAborted(); await compositionWorkspace.adoptNew(prepared, checkpoint)
      setNewScene(false); setSelected(null); setAudience('gm'); await refresh()
    } finally { if (controller.current === abort) controller.current = null; creatingStageRef.current = null; setCreatingStage(null) }
  }, '创建空白场景')
  const cancelNewScene = () => {
    if (actionPending.current && creatingStageRef.current !== 'preparing') return
    if (creatingStageRef.current === 'preparing') controller.current?.abort()
    setNewScene(false)
  }
  useEffect(() => {
    if (completeProject && !completeProject.document.userLayers[currentLayerId]) setCurrentLayerId(Object.keys(completeProject.document.userLayers)[0] ?? '')
  }, [completeProject?.document, currentLayerId])
  const choosePlacement = (definitionId: string, position?: PointMm) => {
    if (!project || !completeProject || audience !== 'gm' || !guard()) return
    try {
      const layer = completeProject.document.userLayers[currentLayerId]
      if (!layer || layer.editLocked || effectiveHiddenLayers.has(layer.id)) throw new Error('请先选择可见且未锁定的当前图层。')
      const b = project.document.exportBoundsMm
      const prop = createPlacedProp(completeProject.document, definitionId, position ?? { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) }, runtime, { layerId: currentLayerId })
      setPlacementReady(false); setPlacement({ prop, checkpoint: compositionWorkspace.checkpoint() }); setMessage(null)
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)) }
  }
  const placeAt = (positionMm: PointMm) => {
    if (!placement || busy || editingBlocked || audience !== 'gm' || !placementReady) return
    void action(async () => {
      compositionWorkspace.assertCheckpoint(placement.checkpoint)
      const prop = placement.prop
      await compositionWorkspace.execute([{ type: 'addProp', id: prop.id, floorId: prop.floorId, definitionRef: prop.definitionRef!, positionMm, rotationDeg: prop.rotationDeg, supportRef: prop.supportRef, layerId: currentLayerId }])
      setPlacement(null); setSelected(prop.id)
    }, '放置物件')
  }
  const backup = (snapshotIds?: readonly string[], sceneId = completeProject?.document.sceneId) => {
    if (!completeProject || !sceneId) return
    const selected = snapshotIds === undefined ? undefined : [...snapshotIds]
    void action(async () => {
      const checkpoint = compositionWorkspace.checkpoint()
      if (compositionWorkspace.getState().project?.document.sceneId !== sceneId) throw new Error('备份所属工程已切换，请重新选择备份范围。')
      if (selected && !selected.length) throw new Error('请先明确勾选需要携带的历史快照。')
      // A failed save must still leave a way to preserve the complete memory
      // branch. Selected-history archives continue to require a saved baseline.
      if (selected || !['error', 'conflict'].includes(compositionWorkspace.getState().status)) await compositionWorkspace.flush()
      compositionWorkspace.assertCheckpoint(checkpoint)
      const current = compositionWorkspace.getState().project!
      if (current.document.sceneId !== sceneId) throw new Error('备份所属工程已切换，请重新选择备份范围。')
      const blob = selected
        ? await exportHistoryArchive(await repository.exportArchive(sceneId, selected), validation)
        : await exportProject(toBundle(current), validation)
      compositionWorkspace.assertCheckpoint(checkpoint)
      if (compositionWorkspace.getState().project?.document.sceneId !== sceneId) throw new Error('备份所属工程已切换，请重新选择备份范围。')
      download(new Blob([blob.slice().buffer], { type: 'application/octet-stream' }), selected ? 'sceneweave-history.sceneweave' : 'sceneweave-complete.sceneweave')
      setMessage(selected ? `已生成当前完整工程与所选 ${selected.length} 份快照备份。` : '已生成当前完整工程，含全部资源、许可和秘密。')
    }, '下载工程备份')
  }
  const commit = (run: () => void | Promise<void>) => { if (!guard()) return; void action(async () => { await run() }, '编辑未采用') }
  const preview = (input: CompositionCommand[] | (() => CompositionCommand[]), description: string, scopeIds?: string[], form?: WorkspaceFormDraft) => {
    if (!project) return
    const completingPrefab = Array.isArray(input) && input.every(command => command.type === 'instantiatePrefab' && command.definitionRef.id === prefabPlacement)
    if (!guard([...(completingPrefab ? ['prefabPlacement' as const] : []), ...(form ? [form] : [])])) return
    void action(async () => {
      const commands = typeof input === 'function' ? input() : input
      const checkpoint = structure?.checkpoint ?? compositionWorkspace.checkpoint()
      compositionWorkspace.assertCheckpoint(checkpoint)
      const prepared = await compositionWorkspace.preview(commands)
      if (structure) compositionWorkspace.cancelPreview(structure.prepared)
      setStructure({ prepared, checkpoint, commands, document: prepared.document, description, scopeIds, ...(commands.every(command => command.type === 'setSceneDisplay') ? { kind: 'display' as const } : scopeIds ? { kind: 'layer' as const } : {}) })
      if (completingPrefab) setPrefabPlacement(null)
      if (form) finishFormDraft(form, form === 'propAppearanceForm')
    }, '候选未通过，工程未修改')
  }
  const previewOutdoor = (commands: OutdoorCommand[], description: string, selectionAfterAdopt?: string | null, form: 'outdoorForm' | 'outdoorInspector' = 'outdoorForm') => {
    if (!completeProject || audience !== 'gm' || !guard([form, ...(form === 'outdoorForm' ? ['outdoorSketch' as const] : [])])) return
    void action(async () => {
      const checkpoint = compositionWorkspace.checkpoint(), prepared = await compositionWorkspace.preview(commands)
      const before = completeProject.document, after = prepared.document
      const roots = commands.flatMap(command => 'id' in command ? [command.id] : 'areaId' in command ? [command.areaId] : 'groupId' in command ? [command.groupId] : [])
      const impact = inspectOutdoorChanges(before, after, roots), scopeIds = impact.affectedIds, layerIds = impact.layerIds
      if (form === 'outdoorForm') setOutdoorSketch(null)
      finishFormDraft(form)
      setStructure({ prepared, checkpoint, commands, document: after, description, kind: 'outdoor', scopeIds, layerIds, confirmed: false, selectionAfterAdopt })
    }, '室外候选未通过，工程未修改')
  }
  const importAsset = (input: AssetImportFields) => {
    if (!completeProject || audience !== 'gm' || !guard('assetImportForm')) return
    void action(async () => {
      const checkpoint = compositionWorkspace.checkpoint(), abort = new AbortController(); controller.current = abort
      try {
        const candidate = await prepareAssetImport(completeProject, input, { validation, runtime, signal: abort.signal })
        abort.signal.throwIfAborted()
        const prepared = await compositionWorkspace.previewPrepared(candidate, `导入素材 · ${input.name}`, checkpoint)
        if (abort.signal.aborted) { compositionWorkspace.cancelPreview(prepared); abort.signal.throwIfAborted() }
        setStructure({ prepared, checkpoint, commands: [], document: prepared.document, description: `导入${input.kind === 'prop' ? '物件' : '材质'} · ${input.name}` })
        finishFormDraft('assetImportForm')
      } finally { if (controller.current === abort) controller.current = null }
    }, '素材导入未采用')
  }
  const adoptCatalog = async (input: PreparedCatalogEntryV1[] | ((signal: AbortSignal) => Promise<PreparedCatalogEntryV1[]>), signal?: AbortSignal) => {
    // The catalog owns its own pending flag; all other scene tools/drafts still guard adoption.
    const reason = workspaceTransitionReason({ ...transientRef.current(), busy: busy || actionPending.current })
    if (!completeProject || audience !== 'gm' || reason) throw new Error(reason ?? '请先打开主持人工程。')
    const checkpoint = compositionWorkspace.checkpoint(), abort = new AbortController()
    const cancel = () => abort.abort()
    signal?.addEventListener('abort', cancel, { once: true })
    if (signal?.aborted) abort.abort()
    actionPending.current = true; setBusy(true); setMessage(null); controller.current = abort
    try {
      const entries = typeof input === 'function' ? await input(abort.signal) : input
      const candidate = await prepareCatalogAdoption(completeProject, entries, abort.signal)
      abort.signal.throwIfAborted()
      compositionWorkspace.assertCheckpoint(checkpoint)
      if (!candidate.operationCost) throw new Error('确切固定素材及完整依赖已在本工程，无需重复采用。')
      const prepared = await compositionWorkspace.previewPrepared(candidate.project, `采用素材库 · ${entries.length} 项`, checkpoint)
      if (abort.signal.aborted) { compositionWorkspace.cancelPreview(prepared); abort.signal.throwIfAborted() }
      setStructure({ prepared, checkpoint, commands: [], document: prepared.document,
        description: `采用素材库 · ${entries.length} 项 · ${candidate.operationCost} 个新增依赖`, scopeIds: candidate.addedDefinitionIds })
    } catch (error) {
      setMessage(`素材采用未提交：${error instanceof Error ? error.message : String(error)}`)
      throw error
    } finally {
      signal?.removeEventListener('abort', cancel)
      if (controller.current === abort) controller.current = null
      actionPending.current = false; setBusy(false)
    }
  }
  const adoptAuthoringCatalog = (catalogIds: string[]) => {
    if (!guard()) return
    void adoptCatalog(async signal => {
      const provider = await ensureBuiltin(signal), items = describeCatalogItems(provider)
      const required = catalogIds.map(id => {
        const matches = items.filter(item => item.identity.catalogId === id && item.identity.kind === 'prop')
        if (matches.length !== 1) throw new Error(`室内素材版本未明确：${id}。`)
        return matches[0]
      })
      const entries: PreparedCatalogEntryV1[] = []
      for (const item of required) entries.push(await prepareCatalogEntry(provider, item.selector, signal))
      return entries
    }).catch(() => { /* The shared adoption path already reports the concrete failure. */ })
  }
  const previewAuthoring = (commands: CompositionCommand[], description: string) => {
    const kind = authoringStageKind(commands)
    if (kind === 'composition' || kind === 'display') preview(commands, description)
    else if (kind === 'outdoor') previewOutdoor(commands as OutdoorCommand[], description)
    else previewBuilding(commands as SceneCommand[], description)
  }
  const previewBuilding = (commands: SceneCommand[], description: string, form: 'buildingForm' | 'buildingInspector' = 'buildingForm') => {
    if (!completeProject || audience !== 'gm' || !guard([form, ...(form === 'buildingForm' ? ['sketch' as const] : [])])) return
    void action(async () => {
      const checkpoint = compositionWorkspace.checkpoint(), prepared = await compositionWorkspace.preview(commands), document = prepared.document
      const before = completeProject.document, affected = new Set<string>()
      for (const collection of LAYER_ENTITY_COLLECTIONS) {
        const ids = new Set([...Object.keys(before[collection]), ...Object.keys(document[collection])])
        for (const id of ids) if (JSON.stringify(before[collection][id]) !== JSON.stringify(document[collection][id])) affected.add(id)
      }
      for (const command of commands) if (command.type === 'setCanvasBounds') for (const id of Object.keys(before.entityLayers)) affected.add(id)
      for (const command of commands) if (command.type === 'setEntranceOpenings') for (const id of [...before.constraints.entranceOpeningIds, ...document.constraints.entranceOpeningIds]) affected.add(id)
      const roots = new Set(affected)
      for (const scene of [before, document]) {
        // Coordinate edits change adjacent joins without changing wall JSON. Room,
        // opening and note edits also need their actual dependencies in the review.
        const walls = Object.values(scene.walls).filter(wall => roots.has(wall.id) || roots.has(wall.startVertexId) || roots.has(wall.endVertexId)
          || Object.values(scene.openings).some(opening => roots.has(opening.id) && opening.wallId === wall.id)
          || Object.values(scene.rooms).some(room => roots.has(room.id) && room.boundaryVertexIds.some((id, index) => {
            const next = room.boundaryVertexIds[(index + 1) % room.boundaryVertexIds.length]
            return id === wall.startVertexId && next === wall.endVertexId || id === wall.endVertexId && next === wall.startVertexId
          })))
        const dependencies = new Set([...roots].filter(id => scene.entityLayers[id]))
        for (const id of roots) {
          let note = scene.notes[id]
          const seen = new Set<string>()
          while (note?.anchor.type === 'entity' && !seen.has(note.id)) {
            seen.add(note.id); dependencies.add(note.anchor.entityId)
            note = scene.notes[note.anchor.entityId]
          }
        }
        for (const id of buildingDependants(scene, walls.map(wall => wall.id), [...dependencies])) affected.add(id)
      }
      const layerIds = [...new Set([...affected].flatMap(id => [before.entityLayers[id], document.entityLayers[id]]).filter(Boolean))]
      if (!affected.size && JSON.stringify(before.constraints) === JSON.stringify(document.constraints) && JSON.stringify(before.exportBoundsMm) === JSON.stringify(document.exportBoundsMm) && JSON.stringify(before.floors) === JSON.stringify(document.floors)) throw new Error('参数与当前工程一致，无需采用。')
      setStructure({ prepared, checkpoint, commands, document, description, kind: 'building', scopeIds: [...affected].sort(), layerIds, confirmed: false })
      if (form === 'buildingForm') setSketch(null)
      setMessage(null); finishFormDraft(form)
    }, '建筑候选未通过，工程未修改')
  }
  const select = (id: string | null, operation: 'replace' | 'add' | 'subtract' = 'replace') => { if (!guard()) return; if (id && scopedHiddenIds.has(id)) { setMessage('该对象在隐藏图层或当前选择范围外，请先调整图层。'); return } setMenu(null); if (id && project?.document.props[id] && Object.values(project.document.prefabInstances).some(group => Object.values(group.members).some(member => member.propId === id))) setMemberMode(true); else if (id && project?.document.prefabInstances[id]) setMemberMode(false); selectionSession.set(!id ? [] : normalizeSelection(project!.document, operation === 'replace' ? [id] : operation === 'add' ? [...selectionSession.getSnapshot(), id] : selectionSession.getSnapshot().filter(current => current !== id), true)) }
  const selectMany = (ids: readonly string[]) => { if (!guard()) return; setMenu(null); selectionSession.set(ids.filter(id => !scopedHiddenIds.has(id))) }
  const batchAction = (kind: SelectionAction, values?: { dx?: number; dy?: number; angle?: number }, ids = selectionSession.getSnapshot(), checkpoint = compositionWorkspace.checkpoint()) => {
    if (!project || audience !== 'gm' || !guard(kind === 'move' || kind === 'rotate' ? 'selectionForm' : undefined)) return
    void action(async () => {
      compositionWorkspace.assertCheckpoint(checkpoint)
      const commands = selectionCommands(project.document, ids, kind, values)
      const scatterEdit = Object.values(project.document.scatterGroups).some(group => ids.includes(group.id) || Object.values(group.members).some(member => member.propId !== null && ids.includes(member.propId)))
      if (!scatterEdit && (kind === 'lock' || kind === 'unlock')) { await compositionWorkspace.execute(commands); return }
      const prepared = await compositionWorkspace.preview(commands)
      finishFormDraft('selectionForm')
      const impact = scatterEdit ? inspectOutdoorChanges(completeProject!.document, prepared.document, ids) : null
      setStructure({ prepared, checkpoint, commands, document: prepared.document, kind: impact ? 'outdoor' : 'batch', description: `${{ move: '批量移动', rotate: '批量旋转', delete: '删除所选', copy: '复制所选', lock: '锁定所选', unlock: '解锁所选' }[kind]} · ${ids.length} 个选择单元`, ...(impact ? { scopeIds: impact.affectedIds, layerIds: impact.layerIds, confirmed: false } : {}) })
    }, '整批未采用，工程未修改')
  }
  const openMenu = (point: PointMm, hits: string[], position: { x: number; y: number }, origin: HTMLElement) => {
    if (!project || audience !== 'gm' || !guard()) return
    const currentIds = selectionSession.getSnapshot(), retained = !!hits[0] && currentIds.includes(hits[0]), ids = hits.length && !retained ? [hits[0]] : [...currentIds]
    if (!retained && hits.length) selectionSession.set(ids)
    setMenu({ ...position, point, hits, ids, checkpoint: compositionWorkspace.checkpoint(), origin, blank: !hits.length })
  }
  const closeMenu = (restore = false) => { const origin = menu?.origin; setMenu(null); if (restore) requestAnimationFrame(() => origin?.isConnected && origin.focus({ preventScroll: true })) }
  const visibleCompleteProject = useMemo(() => aiShown ? aiPreview!.project : structureRestore?.project ?? restore?.project ?? (structure?.prepared.project ?? completeProject), [completeProject, structure, restore, structureRestore, aiShown, aiPreview])
  const renderProject = useMemo(() => visibleCompleteProject ? visibleCompleteProject : null, [visibleCompleteProject])
  const visibleProject = useMemo(() => renderProject ? domainProject(renderProject) : null, [renderProject])
  const editorRenderer = useMemo(() => renderProject ? (options: Parameters<typeof renderEditorProject>[1]) => renderEditorProject(toBundle(renderProject), { ...options, hiddenLayerIds: effectiveHiddenLayers }) : undefined, [renderProject, effectiveHiddenLayers])
  const pointHitTest = useMemo(() => visibleCompleteProject ? hitTestLayers(visibleCompleteProject.document, hiddenIds) : undefined, [visibleCompleteProject?.document, hiddenIds])
  const boundsSelector = useMemo(() => visibleCompleteProject ? selectInBoundsLayers(visibleCompleteProject.document, hiddenIds) : undefined, [visibleCompleteProject?.document, hiddenIds])
  const selectionGeometry = useMemo(() => visibleCompleteProject ? selectionGeometryLayers(visibleCompleteProject.document, hiddenIds) : undefined, [visibleCompleteProject?.document, hiddenIds])
  const selectionSummaryReader = useMemo(() => visibleCompleteProject ? summarizeSelectionLayers(visibleCompleteProject.document, hiddenIds) : undefined, [visibleCompleteProject?.document, hiddenIds])
  const selectLayer = (layerId: string) => {
    if (!completeProject || !project || !boundsSelector || audience !== 'gm' || effectiveHiddenLayers.has(layerId) || !guard()) return
    const boxes = [project.document.exportBoundsMm, ...Object.values(project.document.floors).map(floor => floor.boundsMm)]
    const x = Math.min(...boxes.map(box => box.x)), y = Math.min(...boxes.map(box => box.y))
    const right = Math.max(...boxes.map(box => box.x + box.width)), bottom = Math.max(...boxes.map(box => box.y + box.height))
    const found = boundsSelector(project.document, { x, y, width: right - x, height: bottom - y }, 'intersect', { hiddenIds: scopedHiddenEntities(completeProject.document, hiddenIds, layerId), memberMode })
    setCurrentLayerId(layerId); setMenu(null); selectionSession.set(found.ids)
    setMessage(`已选择本层 ${found.ids.length} 个对象；排除锁定 ${found.excludedLocked} 个。`)
  }
  const exportImage = () => { if (completeProject) void action(async () => {
    // Capture the complete immutable project and audience at the click boundary.
    const blob = await exportPng(toBundle(completeProject), { audience, longEdgePx: 4096 })
    download(blob, `sceneweave-${audience}-map.png`)
    setMessage(`${audience === 'gm' ? '主持人' : '玩家'} PNG 已生成 · r${completeProject.document.revision} · 固定工程范围 · 长边 4096 px`)
  }) }
  const buildingWorldTool = sketch && audience === 'gm' ? { ...sketch, snapMm: project?.document.units.snapMm ?? 100, onCancel: () => setSketch(null),
    onPoint: (point: PointMm) => setSketch(current => {
      if (!current) return null
      const points = current.kind !== 'polygon' && current.points.length >= 2 ? [point] : [...current.points, point]
      return { ...current, points, cursor: null }
    }), onMove: (point: PointMm) => setSketch(current => current && !(current.kind !== 'polygon' && current.points.length >= 2) ? { ...current, cursor: point } : current),
  } : null
  const canvasWorldTool = outdoorSketch && audience === 'gm' ? { ...outdoorSketch, snapMm: project?.document.units.snapMm ?? 100, label: '室外草图 · 逐点取坐标 · Escape 退出',
    onCancel: () => setOutdoorSketch(null), onPoint: (point: PointMm) => setOutdoorSketch(current => current ? { ...current, points: current.purpose === 'connection' && current.points.length >= 2 ? [point] : [...current.points, point], cursor: null } : current),
    onMove: (point: PointMm) => setOutdoorSketch(current => current ? { ...current, cursor: point } : current),
  } : buildingWorldTool
  const saveLabels = { empty: '尚未打开工程', saved: '本地已保存', unsaved: '等待保存', saving: '正在保存', error: '保存失败', conflict: '版本冲突' }
  const layerPanel = completeProject && audience === 'gm' ? <UserLayerPanel scene={completeProject.document} session={selectionSession}
    currentLayerId={currentLayerId} hiddenLayerIds={hiddenLayerIds} soloLayerId={soloLayerId} currentOnly={currentOnly}
    disabled={editDisabled} onCurrent={id => { if (guard()) setCurrentLayerId(id) }}
    onHidden={id => { if (guard()) setHiddenLayerIds(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next }) }}
    onSolo={id => { if (guard()) setSoloLayerId(current => current === id ? null : id) }} onScope={value => { if (guard()) setCurrentOnly(value) }}
    moveRequest={layerMoveRequest} onSelectLayer={selectLayer} onCommand={commands => commit(() => compositionWorkspace.execute(commands))} onPreview={preview}/> : null
  const panelKey = `${completeProject?.document.sceneId ?? 'empty'}-${sessionGeneration}`
  const openResources = (module: 'scene' | 'building' | 'library' | 'outdoor') => { setSidebar(module); revealPanel('resources') }
  const openHistory = () => { if (unified) { setNavigationTab('history'); revealPanel('navigation') } else setSidebar('history') }
  const startBuildingTool = (kind: BuildingSketch['kind']) => { if (!completeProject || !guard()) return; setSketch({ kind, points: [], cursor: null }); openResources('building') }
  const startTerrainTool = () => { if (!completeProject || !guard()) return; setOutdoorSketch({ kind: 'polygon', purpose: 'terrain', points: [], cursor: null }); openResources('outdoor') }
  const showSettings = () => { openResources('scene'); requestAnimationFrame(() => requestAnimationFrame(() => { const details = shell.current?.querySelector<HTMLDetailsElement>('.workspace-project-tools .scene-display-panel'); if (details) { details.open = true; details.querySelector<HTMLElement>('summary')?.focus() } })) }
  const showNotes = () => { if (!guard()) return; openResources('building'); requestAnimationFrame(() => requestAnimationFrame(() => { const field = shell.current?.querySelector<HTMLTextAreaElement>('[aria-label="新注记内容"]'); const details = field?.closest('details'); if (details) details.open = true; field?.focus() })) }
  const draftControls = <>{(editingBlocked || hasDraft) && <p className="asset-muted" role="status">{workspaceTransitionReason({ ...transient(), busy: false, preparing: false })}侧栏浏览保留当前选择、输入和候选。</p>}
          {(placement || prefabPlacement || sketch || outdoorSketch) && !editingBlocked && <div className="building-sketch-status" role="group" aria-label="当前工具">
            <span>{placement ? '物件放置' : prefabPlacement ? '组合放置' : sketch ? '建筑绘图或量尺' : '室外画布取点'}</span>
            <button className="secondary" disabled={busy} onClick={() => {
              if (placement) setPlacement(null)
              else if (prefabPlacement) { setPrefabPlacement(null); finishFormDraft('prefabForm', true) }
              else if (sketch) setSketch(null)
              else setOutdoorSketch(null)
            }}>{placement ? '取消当前放置工具' : prefabPlacement ? '取消组合放置' : sketch ? '取消当前绘图工具' : '取消当前室外取点'}</button>
          </div>}
          {Object.entries(formDrafts).filter(([, dirty]) => dirty).map(([key]) => <button className="secondary asset-wide" key={key} disabled={busy || editingBlocked} onClick={() => {
            if (key === 'buildingForm') setSketch(null)
            if (key === 'outdoorForm') setOutdoorSketch(null)
            if (key === 'prefabForm') setPrefabPlacement(null)
            finishFormDraft(key as keyof typeof formDrafts, true)
          }}>{workspaceFormDraftLabels[key as WorkspaceFormDraft].cancel}</button>)}</>
  const historyBrowser = completeProject && <HistoryPanel key={panelKey} active={active && audience === 'gm' && (unified ? navigationTab === 'history' : sidebar === 'history')} project={completeProject} repository={repository} workspace={compositionWorkspace}
            session={selectionSession} disabled={editDisabled} refreshKey={historyRefresh} onAction={action} onPreview={setRestore} onStructurePreview={setStructureRestore} onBackup={backup}/>
  const sceneBrowser = <SelectionSubscriber session={selectionSession}>{ids => <SceneLibrary key={panelKey} navigationOnly={unified} project={audience === 'player' ? visibleProject : project}
            selected={ids.length === 1 ? ids[0] : null} selectedIds={[...ids]} busy={editDisabled} recent={recent} onSelect={select} onNew={openNewScene} onPlace={choosePlacement}
            definitionFilter={definition => !(definition.id.startsWith('composition-retained-prop-') && definition.tags.includes('sceneweave:retained-appearance'))}
            placingId={placement?.prop.definitionRef?.id ?? null} canPlace={audience === 'gm' && !!completeProject?.document.userLayers[currentLayerId] && !completeProject.document.userLayers[currentLayerId].editLocked && !effectiveHiddenLayers.has(currentLayerId)}
            onIsland={() => request({ type: 'sample', sample: 'island' })} onStudy={() => request({ type: 'sample', sample: 'study' })}
            onOutpost={() => request({ type: 'sample', sample: 'outpost' })} onCalibration={() => request({ type: 'sample', sample: 'calibration' })}
            onMigrate={onBack} onOpen={id => openReference(id)}/>}</SelectionSubscriber>
  const projectTools = <section className="workspace-project-tools" aria-label="工程与显示设置"><h2>工程</h2><p className="asset-muted">在同一画布中继续建筑、素材与室外创作。</p><button className="primary asset-wide" disabled={editDisabled} onClick={openNewScene}><Plus size={14}/>新建空白场景</button><button className="secondary asset-wide" disabled={editDisabled} onClick={requestImport}><Upload size={14}/>打开完整工程</button>{project && <p className="asset-muted">{project.document.title} · r{project.document.revision}</p>}{project && audience === 'gm' && <div onChangeCapture={() => markFormDraft('displayForm')}><SceneDisplayPanel key={`${project.document.sceneId}-${project.document.revision}-${formReset.displayForm}`} scene={completeProject!.document} disabled={toolDisabled(['displayForm'])} onPreview={(commands, label) => preview(commands, label, undefined, 'displayForm')}/></div>}{project && <details className="workspace-authoring-details" open={authoringOpen} onToggle={event => setAuthoringOpen(event.currentTarget.open)}><summary>分步制作 SCN-01 / SCN-04</summary>{authoringOpen && <AuthoringGuide project={completeProject!} disabled={editDisabled} onPreview={previewAuthoring} onAdoptRequiredCatalog={adoptAuthoringCatalog}/>}</details>}<h3>可编辑样板</h3><button className="secondary asset-wide" disabled={editDisabled} onClick={() => request({ type: 'sample', sample: 'study' })}>书房与露台</button><button className="secondary asset-wide" disabled={editDisabled} onClick={() => request({ type: 'sample', sample: 'island' })}>双层岩岛</button><button className="secondary asset-wide" disabled={editDisabled} onClick={() => request({ type: 'sample', sample: 'outpost' })}>海岸哨所</button><button className="secondary asset-wide" disabled={editDisabled} onClick={() => request({ type: 'sample', sample: 'graveyard' })}>苔石墓园 · 内容小样</button><button className="secondary asset-wide" disabled={editDisabled} onClick={() => request({ type: 'sample', sample: 'volcano' })}>灰烬熔脉 · 内容小样</button></section>
  const resourcePanels = <div className="layer-library-stack history-library-stack">
          <div className="history-sidebar-tabs" role="tablist" aria-label="工坊侧栏">
            <button role="tab" aria-selected={sidebar === 'scene' || audience === 'player'} onClick={() => setSidebar('scene')}><Layers3 size={14}/>{unified ? '工程' : '场景'}</button>
            {!unified && <button role="tab" aria-selected={sidebar === 'history' && audience === 'gm'} disabled={!completeProject || audience === 'player'} onClick={openHistory}><Archive size={14}/>历史</button>}
            <button role="tab" aria-selected={sidebar === 'building' && audience === 'gm'} disabled={!completeProject || audience === 'player'} onClick={() => setSidebar('building')}><PencilRuler size={14}/>建筑</button>
            <button role="tab" aria-selected={sidebar === 'library' && audience === 'gm'} disabled={!completeProject || audience === 'player'} onClick={() => setSidebar('library')}><Layers3 size={14}/>素材库</button>
            <button role="tab" aria-selected={sidebar === 'outdoor' && audience === 'gm'} disabled={!completeProject || audience === 'player'} onClick={() => setSidebar('outdoor')}><PencilRuler size={14}/>室外</button>
            <button role="tab" aria-selected={sidebar === 'ai' && audience === 'gm'} disabled={audience === 'player'} onClick={() => setSidebar('ai')}>AI对话</button>
          </div>
          {!unified && draftControls}
          <div hidden={sidebar !== 'ai' || audience !== 'gm'}><SelectionSubscriber session={selectionSession}>{ids => <AiConversationPanel context={completeProject ? { sceneId: completeProject.document.sceneId, revision: completeProject.document.revision, audience: 'public' } : null} disabled={busy || !!structure || !!restore || !!structureRestore || audience === 'player'} authoring={completeProject ? { workspace: compositionWorkspace, sessionKey: sessionGeneration, project: completeProject, selectedIds: ids, layerId: currentLayerId, canPrepare: () => guard(), onPreview: next => { setAiPreview(next); if (!next) setShowAiDraft(false) }, onAdopted: () => { setAiPreview(null); setShowAiDraft(false); setHistoryRefresh(value => value + 1); void refresh() }, onCritical: setAiCritical } : undefined}/>}</SelectionSubscriber></div>
          {!unified && <div hidden={!(sidebar === 'scene' || sidebar === 'building') || audience !== 'gm'}>{layerPanel}</div>}
          <div hidden={sidebar !== 'outdoor' || audience !== 'gm'} onChangeCapture={() => markFormDraft('outdoorForm')}>{completeProject && <OutdoorToolsPanel key={`${panelKey}-${formReset.outdoorForm}`} scene={completeProject.document} layerId={currentLayerId}
            disabled={toolDisabled(['outdoorSketch', 'outdoorForm']) || effectiveHiddenLayers.has(currentLayerId)} sketch={outdoorSketch}
            onSketch={next => { if (!next) setOutdoorSketch(null); else if (guard('outdoorForm')) setOutdoorSketch(next) }} onPreview={previewOutdoor} onSelect={select}/>}</div>
          <div hidden={sidebar !== 'library' || audience !== 'gm'} onChangeCapture={event => { if ((event.target as HTMLElement).closest('.composition-import')) markFormDraft('assetImportForm') }}>{completeProject && (() => {
            const libraryProps = { project: completeProject, disabled: editDisabled, importDisabled: toolDisabled(['assetImportForm']), importResetKey: formReset.assetImportForm,
              onPlace: choosePlacement, onPrefab: (id: string) => { if (guard()) setPrefabPlacement(id) }, onImport: importAsset,
              onMaterial: (id: string) => {
                if (!guard()) return
                const ids = selectionSession.getSnapshot()
                if (!ids.length || ids.some(target => !completeProject.document.rooms[target] && !completeProject.document.terrainAreas[target])) { setMessage('请先明确选择房间或地形表面，再应用材质。'); return }
                preview(ids.map(target => ({ type: 'setSurfaceMaterial', kind: completeProject.document.rooms[target] ? 'room' as const : 'terrainArea' as const, id: target, materialRef: { id, version: completeProject.document.materials[id].version } })), '将固定材质应用到所选表面')
              } }
            return unified ? <CatalogLibrary key={panelKey} {...libraryProps} builtinProject={builtinProject} builtinLoading={builtinLoading} builtinError={builtinError}
              onBuiltinDemand={requestBuiltin}
              onAdopt={adoptCatalog} onPendingChange={onCatalogPending} onDraftChange={onCatalogDraft} organizationResetKey={formReset.catalogForm}/>
              : <CompositionLibrary key={panelKey} {...libraryProps}/>
          })()}</div>
          {!unified && <div hidden={sidebar !== 'history' || audience !== 'gm'}>{historyBrowser}</div>}
          <div hidden={sidebar !== 'building' || audience !== 'gm'} onChangeCapture={() => markFormDraft('buildingForm')}>{completeProject && <BuildingPanel key={`${panelKey}-${formReset.buildingForm}`} scene={completeProject.document} layerId={currentLayerId}
            disabled={toolDisabled(['sketch', 'buildingForm']) || effectiveHiddenLayers.has(currentLayerId)} sketch={sketch}
            onSketch={next => { if (!next) setSketch(null); else if (guard('buildingForm')) setSketch(next) }} onPreview={previewBuilding} onSelect={select}/>}</div>
          <div hidden={sidebar !== 'scene' && audience === 'gm'}>{unified ? projectTools : sceneBrowser}</div>
        </div>
  const inspectorPanel = <SelectionSubscriber session={selectionSession}>{ids => { const selectedIds = ids, selected = ids.length === 1 ? ids[0] : null; return <aside className="asset-inspector">{completeProject && audience === 'gm' && !restore && !structureRestore && <><div onChangeCapture={() => markFormDraft('appearanceForm')}><AppearancePanel key={`${panelKey}-${formReset.appearanceForm}`} project={completeProject} ids={ids} layerId={currentLayerId} disabled={toolDisabled(['appearanceForm'])} onPreview={(commands, description) => preview(commands, description, undefined, 'appearanceForm')}/></div><div onChangeCapture={() => markFormDraft('prefabForm')}><PrefabPanel key={`${panelKey}-${prefabPlacement ?? ''}-${formReset.prefabForm}`} project={completeProject} ids={ids} layerId={currentLayerId} placementDefinitionId={prefabPlacement} onSelect={select} disabled={toolDisabled(['prefabPlacement', 'prefabForm'])} onPreview={(commands, description) => preview(commands, description, undefined, 'prefabForm')}/></div></>}{!restore && !structureRestore && project && selectedIds.length > 0 && audience === 'gm' && !placement && <button className="secondary asset-wide" disabled={busy || editingBlocked} onClick={event => { const b = event.currentTarget.getBoundingClientRect(), bounds = project.document.exportBoundsMm; openMenu(project.document.props[selectedIds[0]]?.positionMm ?? { x: Math.round(bounds.x + bounds.width / 2), y: Math.round(bounds.y + bounds.height / 2) }, [...selectedIds], { x: b.left, y: b.bottom }, event.currentTarget) }}>更多操作</button>}{structureRestore ? <StructureRestoreChangesPanel preview={structureRestore} current={completeProject!}/> : restore ? <RestoreChangesPanel preview={restore} current={completeProject!}/> : project && placement && audience === 'gm' ? <PlacementInspector scene={project.document} prop={placement.prop} busy={busy} ready={placementReady} onChange={changes => setPlacement(current => current ? { ...current, prop: { ...current.prop, ...changes } } : null)} onPlace={() => placeAt(placement.prop.positionMm)} onCancel={() => setPlacement(null)}/> : visibleProject && selectedIds.length > 1 && audience === 'gm' ? <div onChangeCapture={() => markFormDraft('selectionForm')}><SelectionInspector key={`${panelKey}-${formReset.selectionForm}`} scene={project!.document} ids={selectedIds} summaryReader={selectionSummaryReader} busy={toolDisabled(['selectionForm'])} onAction={batchAction} onClear={() => select(null)}/></div> : completeProject && selected && audience === 'gm' && outdoorEntityKind(completeProject.document, selected) ? <div onChangeCapture={() => markFormDraft('outdoorInspector')}><OutdoorInspector key={`${selected}-${completeProject.document.revision}-${formReset.outdoorInspector}`} scene={completeProject.document} id={selected} disabled={toolDisabled(['outdoorInspector'])} onPreview={(commands, label) => previewOutdoor(commands as OutdoorCommand[], label, undefined, 'outdoorInspector')} onSelect={select}/></div> : completeProject && selected && audience === 'gm' && (completeProject.document.rooms[selected] || completeProject.document.walls[selected] || completeProject.document.vertices[selected] || completeProject.document.openings[selected] || completeProject.document.notes[selected] || completeProject.document.regions[selected]?.kind === 'manualMask') ? <div onChangeCapture={() => markFormDraft('buildingInspector')}><BuildingInspector key={`${selected}-${completeProject.document.revision}-${formReset.buildingInspector}`} scene={completeProject.document} selected={selected} layerId={currentLayerId} disabled={toolDisabled(['buildingInspector'])} onPreview={(commands, label) => previewBuilding(commands, label, 'buildingInspector')} onSelect={select} onLock={(kind, id, locked) => commit(() => compositionWorkspace.execute([{ type: 'setEditLock', kind, id, locked }]))}/></div> : visibleProject && selected && audience === 'gm' ? <SceneInspector project={visibleProject} selected={selected} busy={toolDisabled(['propAppearanceForm'])} appearanceResetKey={formReset.propAppearanceForm} onAppearanceDraftChange={onPropAppearanceDraft} workspace={compositionWorkspace} onSelect={select} onCommit={commit} onPreview={(commands, description) => preview(commands, description, undefined, Array.isArray(commands) && commands.some(command => command.type === 'replacePropAppearance') ? 'propAppearanceForm' : undefined)} onPropCommand={(commands, description, selectionAfterCommit) => {
            const scatterOwner = completeProject && Object.values(completeProject.document.scatterGroups).find(group => Object.values(group.members).some(member => member.propId === selected))
            if (!scatterOwner) { commit(async () => { await compositionWorkspace.execute(commands); if (selectionAfterCommit !== undefined) setSelected(selectionAfterCommit) }); return }
            if (!commands.every(isOutdoorCommand)) { setMessage('散布成员修改包含不支持的室外操作。'); return }
            previewOutdoor(commands as OutdoorCommand[], description, selectionAfterCommit)
          }}/> : <>
          <div className="asset-section-heading"><Move size={16}/><h2>{audience === 'player' ? '玩家输出' : '工程信息'}</h2></div>
          {project ? <><h3>{project.document.activeStyleThemeRef ? '墨绘原野 · v1' : '用户图层 · 完整工程'}</h3><p className="asset-muted">{audience === 'player' ? '预览与 PNG 使用同一投影和绘制流程，私密内容在材质与阴影派生前过滤。' : '选择画面中的物件，或从左侧切换组合、散布与场景结构。全部素材、定义和许可随工程保存。'}</p>
            <dl className="asset-facts"><dt>场景修订</dt><dd>r{project.document.revision}</dd><dt>素材字节</dt><dd>{bytesLabel(Object.values(project.assets).reduce((sum, asset) => sum + asset.sizeBytes, 0))}</dd><dt>定义快照</dt><dd>{Object.keys(project.document.propDefinitions).length} 件物件 / {Object.keys(project.document.materials).length} 种材质</dd><dt>许可绑定</dt><dd>{project.licenseBindings.length} 条</dd></dl>
            {audience === 'gm' && <>{!unified && <div onChangeCapture={() => markFormDraft('displayForm')}><SceneDisplayPanel key={`${project.document.sceneId}-${project.document.revision}-${formReset.displayForm}`} scene={completeProject!.document} disabled={toolDisabled(['displayForm'])} onPreview={(commands, label) => preview(commands, label, undefined, 'displayForm')}/></div>}<h3>地面材质</h3>{Object.values(project.document.rooms).filter(room => room.floorStyle).map(room => <fieldset key={room.id} disabled={busy || editingBlocked || room.editLocked}><NumberInput label="木纹方向" value={room.floorStyle!.base.rotationDeg} unit="°" onCommit={rotation => commit(() => compositionWorkspace.rotateRoomMaterial(room.id, rotation))}/></fieldset>)}<button className="secondary asset-wide" disabled={busy || editingBlocked} onClick={() => void action(async () => {
              await validateProjectBundle(toBundle(completeProject!), validation)
              setMessage('完整工程校验通过：格式、历史身份、位图与许可一致。')
            }, '当前工程完整性检查')}><CheckCircle2 size={15}/>校验完整工程</button></>}
            {audience === 'gm' && project.document.presetSnapshot.presetId === 'sceneweave-vis02' && <TerrainTravelPanel scene={project.document} disabled={busy || editingBlocked}/>}
            {audience === 'gm' && completeProject?.document.presetSnapshot.presetId === OUTPOST_PRESET_ID && <OutpostTravelPanel scene={completeProject.document} disabled={busy || editingBlocked}/>}
          </> : <p className="asset-muted">新建空白场景，打开室内外样板，或导入完整工程。</p>}
          <div className="asset-next"><RotateCw size={16}/><strong>把场景保存完整</strong><p>工程文件携带素材、材质与许可。定期下载备份，继续编辑前可检查工程完整性。</p></div>
        </>}</aside> }}</SelectionSubscriber>
  const canvasPanel = <main className="asset-center">{!unified && <><div className="asset-scene-bar"><div><small>{audience === 'gm' ? '主持人场景' : '玩家场景'}</small><h1>{project?.document.title ?? '织境场景'}</h1></div><div className="asset-toolbar"><button aria-label="撤销素材编辑" title="撤销" disabled={!state.canUndo || editDisabled} onClick={() => commit(() => compositionWorkspace.undo())}><Undo2 size={17}/></button><button aria-label="重做素材编辑" title="重做" disabled={!state.canRedo || editDisabled} onClick={() => commit(() => compositionWorkspace.redo())}><Redo2 size={17}/></button><button aria-label="命名历史快照" title="命名历史快照" disabled={!project || audience === 'player'} onClick={openHistory}><Archive size={17}/></button></div></div></>}
          <div className="asset-view-bar"><div role="group" aria-label="预览受众" className="asset-audience"><button disabled={editDisabled} aria-pressed={audience === 'gm'} onClick={() => { if (guard()) setAudience('gm') }}>主持人</button><button disabled={editDisabled} aria-pressed={audience === 'player'} onClick={() => { if (guard()) { setAudience('player'); setSelected(null) } }}>玩家</button></div><span>{project ? `${formatDistanceMm(project.document.exportBoundsMm.width, project.document.units.display)} × ${formatDistanceMm(project.document.exportBoundsMm.height, project.document.units.display)} · 固定范围` : '二维俯视 · 毫米世界坐标'}</span></div>
          {structure && <div className="asset-structure-preview" role="status"><div><strong>{structure.description} · 候选预览</strong><span>尚未写入工程，采用后作为一次编辑保存</span><CompositionChangesPanel current={completeProject!} candidate={structure.prepared.project} commands={structure.commands}/>{(structure.kind === 'building' || structure.kind === 'outdoor') && <label className="building-check"><input type="checkbox" aria-label="确认完整影响范围" checked={structure.confirmed ?? false} onChange={event => setStructure(current => current ? { ...current, confirmed: event.target.checked } : current)}/>确认 {structure.scopeIds?.length} 个实体及 {structure.layerIds?.length} 个图层的影响范围</label>}{structure.layerIds && <span>{structure.layerIds.map(id => completeProject?.document.userLayers[id]?.name ?? id).join(' · ')}</span>}{structure.scopeIds && <details className="layer-preview-scope"><summary>实际操作范围 · {structure.scopeIds.length} 项</summary><textarea readOnly aria-label={structure.kind === 'building' ? '待采用建筑操作 ID' : structure.kind === 'outdoor' ? '待采用室外操作 ID' : '待采用图层操作 ID'} rows={4} value={structure.scopeIds.join('\n')}/></details>}</div><button className="secondary" disabled={busy} onClick={() => { compositionWorkspace.cancelPreview(structure.prepared); setStructure(null) }}>{structure.kind === 'batch' ? '取消批量预览' : structure.kind === 'layer' ? '取消图层预览' : structure.kind === 'outdoor' ? '取消室外预览' : structure.kind === 'building' ? '取消结构预览' : structure.kind === 'display' ? '取消显示预览' : '取消组件预览'}</button><button className="primary" disabled={busy || (structure.kind === 'building' || structure.kind === 'outdoor') && !structure.confirmed} onClick={() => void action(async () => {
            try {
              await compositionWorkspace.adoptPreview(structure.prepared)
              setStructure(null)
              if (structure.selectionAfterAdopt !== undefined) setSelected(structure.selectionAfterAdopt)
            }
            catch (error) { compositionWorkspace.cancelPreview(structure.prepared); setStructure(null); throw error }
          }, '采用候选')}>{structure.kind === 'batch' ? '采用批量修改' : structure.kind === 'layer' ? '采用图层修改' : structure.kind === 'outdoor' ? '采用室外修改' : structure.kind === 'building' ? '采用结构修改' : structure.kind === 'display' ? '采用显示设置' : '采用组件修改'}</button></div>}
          {restore && <div className="asset-structure-preview history-restore-banner" role="status" aria-label="局部恢复候选"><div><strong>{restore.snapshot.name} · 局部恢复预览</strong><span>{restore.plan.request.ids.length} 件请求 · {restore.plan.changes.length} 件变化 · 当前 r{restore.currentRevision}</span><label className="building-check"><input type="checkbox" aria-label="确认恢复完整影响范围" checked={restoreConfirmed} onChange={event => setRestoreConfirmed(event.target.checked)}/>确认下方列出的全部依赖与跨层变化</label></div><button className="secondary" disabled={busy} onClick={() => { compositionWorkspace.cancelRestore(restore); setRestore(null) }}>取消局部恢复</button><button className="primary" disabled={busy || !restore.plan.changed || !restoreConfirmed} onClick={() => void action(async () => { try { await compositionWorkspace.applyRestore(restore); setSelected(null); await refresh() } finally { setRestore(null); setHistoryRefresh(value => value + 1) } }, '采用局部恢复')}>保护当前并采用</button></div>}
          {structureRestore && <div className="asset-structure-preview history-restore-banner" role="status" aria-label="结构恢复候选"><div><strong>{structureRestore.snapshot.name} · 结构恢复预览</strong><span>{structureRestore.plan.request.ids.length} 项请求 · {structureRestore.plan.changes.length} 项变化 · 当前 r{structureRestore.currentRevision}</span></div><button className="secondary" disabled={busy} onClick={() => { compositionWorkspace.cancelStructureRestore(structureRestore); setStructureRestore(null) }}>取消结构恢复</button><button className="primary" disabled={busy || !structureRestore.plan.changed} onClick={() => void action(async () => { try { await compositionWorkspace.applyStructureRestore(structureRestore); setSelected(null); await refresh() } finally { setStructureRestore(null); setHistoryRefresh(value => value + 1) } }, '采用结构恢复')}>保护当前并采用结构恢复</button></div>}
          {aiPreview && audience === 'gm' && <div className="ai-preview-banner" role="status"><strong>{aiShown ? 'AI草稿预览 · 主工程未改变' : '正在查看主工程'}</strong><span>草稿 {aiPreview.draftRevision} · {aiPreview.changes.length} 件差异</span><button disabled={aiCritical || busy} onClick={() => { if (showAiDraft) setShowAiDraft(false); else if (guard()) setShowAiDraft(true) }}>{aiShown ? '查看主工程' : '查看AI草稿'}</button></div>}<div className="asset-stage">{visibleProject ? <AssetCanvas key={panelKey} toolControlsTarget={unified ? toolControlsTarget : undefined} viewControlsTarget={unified ? viewControlsTarget : undefined} project={visibleProject} editorRenderer={editorRenderer} selectionOptions={selectionOptions} pointHitTest={pointHitTest} boundsSelector={boundsSelector} selectionGeometry={selectionGeometry} selectionSummaryReader={selectionSummaryReader} worldTool={canvasWorldTool} selected={null} selectionSession={selectionSession} onSelect={select} onSelectMany={selectMany} onContext={openMenu} memberMode={memberMode} onMemberMode={setMemberMode} fitRequest={fitRequest} audience={audience} disabled={busy || editingBlocked || !!prefabPlacement || audience === 'player'} placement={placement?.prop} onPlacementMove={positionMm => setPlacement(current => current ? { ...current, prop: { ...current.prop, positionMm } } : null)} onPlace={placeAt} onPlacementReady={setPlacementReady} onPlacementError={error => { setPlacement(null); setMessage(error) }} onCancelPlacement={() => setPlacement(null)}/> : <div className="asset-empty"><div className="asset-empty-icon"><Layers3 size={36}/></div><span>从一张空白画布开始</span><p>选择画布范围与使用预设，逐件放入素材。<br/>也可从左侧打开书房、岩岛或海岸哨所。</p><button className="primary" disabled={busy} onClick={openNewScene}>新建场景</button></div>}</div>{!unified && <footer className="asset-canvas-footer"><span>{audience === 'gm' ? '主持人视图 · 工程可能包含秘密' : '玩家视图 · 已过滤私密内容'}</span>{project && <span>{Object.keys(project.assets).length} 张位图 · {Object.keys(project.document.props).length} 件物件 · r{project.document.revision}</span>}</footer>}
        </main>
  const workspaceTools = <><div ref={setToolControlsTarget}/><button title="画矩形房间" aria-label="工具：画房间" disabled={editDisabled || !completeProject || audience === 'player'} aria-pressed={!!sketch && sketch.kind !== 'ruler'} onClick={() => startBuildingTool('rectangle')}><PencilRuler size={18}/><small>房间</small></button><button title="绘制地形" aria-label="工具：画地形" disabled={editDisabled || !completeProject || audience === 'player'} aria-pressed={!!outdoorSketch} onClick={startTerrainTool}><Mountain size={18}/><small>地形</small></button><button title="选择待放置素材" aria-label="工具：放置素材" disabled={editDisabled || !completeProject || audience === 'player'} onClick={() => { if (guard()) openResources('library') }}><Plus size={18}/><small>放置</small></button><button title="文字与线索" aria-label="工具：注记" disabled={editDisabled || !completeProject || audience === 'player'} onClick={showNotes}><StickyNote size={18}/><small>注记</small></button><button title="量尺" aria-label="工具：量尺" disabled={editDisabled || !completeProject || audience === 'player'} aria-pressed={sketch?.kind === 'ruler'} onClick={() => startBuildingTool('ruler')}><Ruler size={18}/><small>量尺</small></button></>
  const workspaceFooter = <><div ref={setViewControlsTarget}/>{project && <button className="workspace-display-summary" disabled={audience === 'player'} onClick={showSettings} title="打开单位与格线设置">{project.document.units.display === 'm' ? '米' : '英尺'} · 格线{project.document.units.gridVisible ? '显示' : '隐藏'} · 吸附 {project.document.units.snapMm} mm</button>}<SelectionSubscriber session={selectionSession}>{ids => <span>已选 {ids.length} 项</span>}</SelectionSubscriber><span>{placement ? '放置物件' : prefabPlacement ? '放置组合' : sketch?.kind === 'ruler' ? '量尺' : sketch ? '绘制房间' : outdoorSketch ? '绘制室外' : '选择 / 平移'}</span><span>{audience === 'gm' ? '主持人视图' : '玩家视图'}</span></>
  return <>
    <div className={`asset-shell history-shell composition-shell outdoor-shell${unified ? ' workspace-unified' : ''}`} ref={shell} data-testid="outdoor-workbench" data-native-format="sceneweave-complete-project@1" data-revision={project?.document.revision}
      data-transaction-revision={state.lastTransaction?.revision} data-transaction-committed-at={state.lastTransaction?.committedAtMs}>
      <header className="asset-header"><button className="asset-brand" aria-label={unified ? "回到首页" : undefined} onClick={() => { if (unified) onBack(); else void leave('home').then(allowed => { if (allowed) onBack() }) }}><ArrowLeft size={18}/><span>织境<small>Sceneweave</small></span></button><div className="asset-header-title">{unified ? <div className="workspace-project-title"><small>统一工作区</small><h1>{project?.document.title ?? '织境场景'}</h1></div> : <><Archive size={20}/><span>室外工坊</span><b>地形与布景</b></>}</div>{unified && <div className="asset-toolbar"><button aria-label="撤销素材编辑" title="撤销" disabled={!state.canUndo || editDisabled} onClick={() => commit(() => compositionWorkspace.undo())}><Undo2 size={17}/></button><button aria-label="重做素材编辑" title="重做" disabled={!state.canRedo || editDisabled} onClick={() => commit(() => compositionWorkspace.redo())}><Redo2 size={17}/></button><button aria-label="命名历史快照" title="命名历史快照" disabled={!project || audience === 'player'} onClick={openHistory}><Archive size={17}/></button></div>}<div className="asset-header-actions"><span role="status" className={`asset-save ${state.status}`}>{state.status === 'saving' ? <LoaderCircle size={14} className="spin"/> : <CheckCircle2 size={14}/>} {saveLabels[state.status]}</span><button className="secondary" disabled={busy || editingBlocked} onClick={requestImport}><Upload size={15}/>打开工程</button>{unified && project && <button className="secondary" disabled={busy} onClick={() => request({ type: 'reload' })}>重新载入已保存版本</button>}<button className="primary" disabled={busy || editingBlocked || !project} onClick={() => backup()}><Download size={15}/>完整工程</button><button className="secondary" disabled={busy || editingBlocked || !project} onClick={exportImage}><Download size={15}/>4K PNG</button></div></header>
      {!unified && <div className="asset-phase-note">地形 · 通路 · 散布<span>显式支撑 / 人工保留 / 持久局部恢复</span></div>}
      {(state.error || message) && <div className="asset-notice" role="alert"><span>{message ?? state.error}</span>{state.status === 'error' && <button onClick={() => void action(() => compositionWorkspace.retry())}>重试保存</button>}{['conflict', 'error'].includes(state.status) && <button onClick={() => { if (guard()) void action(async () => { await compositionWorkspace.saveAsCopy(); await refresh() }) }}>另存副本</button>}<button aria-label="关闭工坊提示" onClick={() => setMessage(null)}><X size={16}/></button></div>}
      {unified && <div className="workspace-session-feedback">{draftControls}</div>}
      {unified ? <WorkspaceLayout active={active} panelRequest={panelRequest} resources={resourcePanels} inspector={inspectorPanel} navigation={[
        { id: 'layers', label: '图层', content: layerPanel, disabled: !completeProject || audience === 'player' },
        { id: 'objects', label: '对象', content: sceneBrowser },
        { id: 'history', label: '历史', content: audience === 'gm' ? historyBrowser : null, disabled: !completeProject || audience === 'player' },
      ]} navigationTab={audience === 'player' ? 'objects' : navigationTab} onNavigationTabChange={setNavigationTab} tools={workspaceTools} footer={workspaceFooter}>{canvasPanel}</WorkspaceLayout>
        : <div className="asset-layout">{resourcePanels}{canvasPanel}{inspectorPanel}</div>}
      <input hidden ref={file} type="file" accept=".sceneweave" aria-label="选择完整工程" onChange={event => { const selected = event.target.files?.[0]; event.target.value = ''; if (selected && guard()) onImportFile(selected) }}/>
      {busy && !preparation && <div className="asset-busy" role="status"><LoaderCircle size={17} className="spin"/>正在处理完整工程…{controller.current && <button onClick={() => controller.current?.abort()}>取消准备</button>}</div>}
    </div>
    {active && menu && project && <SceneContextMenu key={`${menu.checkpoint}-${menu.x}-${menu.y}-${menu.ids.join('|')}`} project={project} menu={menu} onMoveToLayer={() => { try { compositionWorkspace.assertCheckpoint(menu.checkpoint); selectionSession.set(menu.ids); setLayerMoveRequest(value => value + 1) } catch (error) { setMessage(String(error)) } }} onClose={closeMenu} onAction={action => batchAction(action, undefined, menu.ids, menu.checkpoint)} onSelect={select} onFit={() => setFitRequest(value => value + 1)} onPlace={(id, point) => { try { compositionWorkspace.assertCheckpoint(menu.checkpoint); choosePlacement(id, point) } catch (error) { setMessage(String(error)) } }} onEdit={() => { if (unified) revealPanel('inspector'); requestAnimationFrame(() => requestAnimationFrame(() => { const input = shell.current?.querySelector<HTMLElement>('.asset-inspector input:not(:disabled)') ?? shell.current?.querySelector<HTMLElement>('.asset-inspector button:not(:disabled)'); input?.focus() })) }}/>}
    {active && (candidate || newScene || preparation) && <div className="modal-scrim"><div ref={dialog} className="modal" role="dialog" aria-modal="true" aria-label={preparation ? '准备打开工程' : newScene ? '新建空白场景' : '确认打开工程'}>
      <div className="modal-heading"><h2>{preparation ? '准备打开工程' : newScene ? '新建空白场景' : '确认打开工程'}</h2><button className="icon-button" disabled={preparation ? preparation.cancelling : busy && !(newScene && creatingStage === 'preparing')} aria-label={preparation ? '关闭准备窗口' : newScene ? '取消新建场景' : '取消打开工程'} onClick={() => { if (preparation) cancelPreparation(); else if (newScene) cancelNewScene(); else setCandidate(null) }}><X size={18}/></button></div>
      {preparation ? <>
        <p>{preparation.description}</p>
        <p role="status">{preparation.cancelling ? '正在取消准备…' : preparation.progress?.phase === 'resources' ? `正在读取场景素材 ${preparation.progress.completed} / ${preparation.progress.total}` : preparation.progress?.phase === 'validation' ? '正在检查完整场景与素材…' : '正在准备场景…'}</p>
        <progress className="asset-preparation-progress" aria-label="工程准备进度" max={preparation.progress?.total || 1} value={preparation.progress?.phase === 'resources' ? preparation.progress.completed : undefined}/>
        <p className="asset-muted">准备完成后可审阅并打开副本，当前工程保持。</p>
        <div className="modal-actions"><button className="secondary" disabled={preparation.cancelling} onClick={cancelPreparation}>取消准备</button></div>
      </> : newScene ? <NewSceneForm busy={busy} cancellable={creatingStage === 'preparing'} failure={message ?? state.error} onCreate={createScene} onCancel={cancelNewScene}/> : candidate && <><p>{candidate.description}</p><div className="asset-candidate"><strong>{candidate.project.document.title}</strong><span>{Object.keys(candidate.project.assets).length} 张位图 · {Object.keys(candidate.project.document.props).length} 件物件 · 完整工程</span></div>{message && <p role="alert" className="asset-form-error">{message}</p>}<div className="modal-actions"><button className="secondary" disabled={busy} onClick={() => setCandidate(null)}>取消</button><button className="primary" disabled={busy} onClick={() => void action(async () => { await ready(); await compositionWorkspace.adoptNew(candidate.project, candidate.checkpoint); setCandidate(null); setSelected(null); setAudience('gm'); setSessionGeneration(value => value + 1); await refresh() })}>保存并打开副本</button></div></>}
    </div></div>}
  </>
}
