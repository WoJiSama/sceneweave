import DecorationPanel, { DecorationInspector } from './DecorationPanel'
import IslandDressingPanel from './IslandDressingPanel'
import { buildIslandDressingCommandsV2, hasGeneratedIslandBase } from '../../shared/decorations/island-dressing'
import { buildIslandSurfaceDressingCommandsV1 } from '../../shared/decorations/island-dressing-v3'
import { buildIslandCliffDetailCommands } from '../../shared/decorations/island-cliff-detail'
import UvttExportDialog from './UvttExportDialog'
import { inspectDecorationChanges } from '../../shared/decorations/commands'
import { estimateCanopyRegionInstances } from '../../shared/decorations/generate'
import { estimateSurfaceRegionInstances } from '../../shared/decorations/generate'
import { inspectSurfaceRuleChanges, isSurfaceRuleCommand } from '../../shared/surface-rules/commands'
import { createTerrainVariantCatalogProject } from '../../platform/browser/content/terrain-variant-catalog'
import { prepareAssetBatchImport, type AssetImportRequest } from '../../application/workspace/asset-batch'
import type { AssetBatchReview } from './AssetBatchImportForm'
import { createShoreBlankProject } from '../../platform/browser/content/shore-blank'
import { selectTerrainEditBudget } from '../../application/workspace/terrain-edit'
import { getLegacyGeneration } from '../../shared/terrain-generation/composition-contracts.js'
import TerrainCompositionPanel from './TerrainCompositionPanel'
import InteriorGenerationPanel, { type InteriorGenerationUiRequest } from './InteriorGenerationPanel'
import ForestGenerationPanel, { type ForestGenerationUiRequest } from './ForestGenerationPanel'
import VolcanoGenerationPanel, { type VolcanoGenerationUiRequest } from './VolcanoGenerationPanel'
import LocalGenerationPanel from './LocalGenerationPanel'
import type { LocalGenerationRequest } from '../../shared/generation/local'
import { defaultVolcanoInput } from '../../shared/generation/domains/volcano/index'
import { forestRectangle, type ForestGenerationInput } from '../../shared/generation/domains/forest/index'
import type { ForestPreview, InteriorPreview, VolcanoPreview, LocalGenerationPreview } from '../../application/workspace/workspace'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Archive, ArrowLeft, CheckCircle2, Download, Layers3, PencilRuler, LoaderCircle, Move, Mountain, Plus, Ruler, StickyNote, Redo2, RotateCw, Undo2, Upload, X } from 'lucide-react'
import { WorkspaceRepository } from './repository'
import { Workspace, type CompositionPreview, type RestorePreview, type StructureRestorePreview, type RegionalPreview } from '../../application/workspace/workspace'
import RegionalPanel from './RegionalPanel'
import { createRegionalBlankProject } from '../../platform/browser/content/regional-symbols'
import { compareRegionalSource, type RegionalCreateUiRequest, type RegionalDrillDownUiRequest } from '../../application/workspace/regional'
import type { RegionalEditRequest } from '../../shared/terrain-generation/regional-authoring'
import { fromBundle } from '../../application/workspace/project'
import { prepareAssetImport } from '../../application/workspace/prepare'
import { toBundle, type EditableProject } from '../../application/workspace/project'
import { exportProject, exportHistoryArchive } from '../../shared/project/file'
import { validateProjectBundle } from '../../shared/project/resources'
import { projectRepository, validation, runtime } from '../../platform/browser/runtime'
import { createBlankProject, createSampleProject, createVolcanoBlankProject } from '../../platform/browser/content/factories'
import type { ContentLoadProgress } from '../../platform/browser/content/load-resources'
import { inspectOutdoorChanges, isOutdoorCommand, type OutdoorCommand } from '../../shared/commands/outdoor'
import { createPlacedProp, type SceneCommand } from '../../shared/commands/commands'
import { inspectBuildingChanges } from '../../shared/commands/building'
import type { SceneDocument, PointMm, Prop } from '../../shared/model/scene'
import type { CompositionCommand } from '../../shared/model/appearance'
import type { FillCopyReport, FillCopyRequest } from '../../application/workspace/fill-copy'
import { exportPng, renderEditorProject } from '../../platform/browser/render/renderer'
import { OUTPOST_PRESET_ID, validateOutpostEdits } from './outpost-constraints'
import { validateStudyEdits } from './study-constraints'
import { validateIslandEdits } from './island-constraints'
import { describeCatalogItems, prepareCatalogEntry, loadBuiltinCatalogV1, prepareCatalogAdoption, type PreparedCatalogEntryV1 } from './catalog'
import OutdoorToolsPanel, { type OutdoorSketch } from './OutdoorToolsPanel'
import OutdoorInspector, { outdoorEntityKind } from './OutdoorInspector'
import SceneDisplayPanel from './SceneDisplayPanel'
import { inspectVisualChanges, isVisualCommand } from '../../shared/visual/commands'
import { createRefinedIslandProject, REFINED_ISLAND_NAME } from '../../platform/browser/content/refined-island.js'
import { createNearSideIslandProject, NEAR_SIDE_ISLAND_NAME } from '../../platform/browser/content/near-side.js'
import { createRefinedCoastProject, REFINED_COAST_NAME } from '../../platform/browser/content/refined-coast.js'
import { createRefinedInteriorProject, REFINED_INTERIOR_NAME } from '../../platform/browser/content/refined-interior.js'
import { createVisualSampleProject, createVisualBlankProject } from '../../platform/browser/content/visual-samples'
import { createRefinedBlankProject } from '../../platform/browser/content/refined-blank'
import TerrainGenerationPanel, { type TerrainGenerationRequest } from './TerrainGenerationPanel'
import TerrainEditingPanel, { type TerrainEditCanvasSession } from './TerrainEditingPanel'
import type { CanvasTerrainBrush } from '../native-canvas/AssetCanvas'
import type { TerrainEditRequest } from '../../shared/terrain-generation/edit'
import type { TerrainEditPreview } from '../../application/workspace/terrain-edit'
import type { TerrainLocalPreview } from '../../application/workspace/terrain-local'
import { createTerrainEditClient } from '../../platform/browser/terrain-generation/edit-client'
import type { TerrainPreview } from '../../application/workspace/terrain'
import GenerationExecutionSettings, { type GenerationExecutionSettingsValue } from './GenerationExecutionSettings'
import { createDomainGenerationClient } from '../../platform/browser/generation/client'
import type { DomainExecutionRequest } from '../../shared/generation/execution'
import { createBaseMapGenerationClient } from '../../platform/browser/terrain-generation/base-map-client'
import { prepareBaseMapRequestV3 } from '../../shared/terrain-generation/base-map-v3'
import { selectBrowserGenerationBudget } from '../../platform/browser/budget'
import { prepareBaseMapRequestV2 } from '../../shared/terrain-generation/base-map-v2'
import { CONTINUATION_POLICY } from '../../shared/ai/budget-policy'
import type { BaseMapGenerationExecution } from '../../platform/browser/terrain-generation/base-map-client'
import { captureJson } from '../../shared/validation/json'
import BaseMapGenerationSettings, { type BaseMapGenerationSettingsValue } from './BaseMapGenerationSettings'
import VisualPanel, { type VisualBoundaryEditor } from './VisualPanel'
import OutpostTravelPanel from './OutpostTravelPanel'
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
type StructurePreview = { assetBatch?: { count: number; addedDefinitions: number; operationCost: number }; fillCopy?: { report: FillCopyReport; cost: { total: number; limit: 256 } }; prepared: CompositionPreview; checkpoint: number; commands: CompositionCommand[]; document: SceneDocument; description: string; kind?: 'batch' | 'fill-copy' | 'layer' | 'building' | 'outdoor' | 'visual' | 'display'; scopeIds?: string[]; layerIds?: string[]; confirmed?: boolean; selectionAfterAdopt?: string | null }
const initialFormDrafts = () => Object.fromEntries(Object.keys(workspaceFormDraftLabels).map(key => [key, false])) as Record<WorkspaceFormDraft, boolean>
const initialFormResets = () => Object.fromEntries(Object.keys(workspaceFormDraftLabels).map(key => [key, 0])) as Record<WorkspaceFormDraft, number>

type WorkbenchProps = {
  onBack: () => void
  onImportFile: (file: File) => void
  active?: boolean
  onController?: (controller: WorkspaceController | null) => void
  onSession?: (summary: WorkspaceSessionSummary | null) => void
}
export default function Workbench({ onBack, onImportFile, active = true, onController, onSession }: WorkbenchProps) {
  const state = useSyncExternalStore(compositionWorkspace.subscribe, compositionWorkspace.getState), completeProject = state.project
  const project = useMemo(() => completeProject ? domainProject(completeProject) : null, [completeProject])
  const [currentLayerId, setCurrentLayerId] = useState(''), [hiddenLayerIds, setHiddenLayerIds] = useState<ReadonlySet<string>>(new Set()), [soloLayerId, setSoloLayerId] = useState<string | null>(null), [currentOnly, setCurrentOnly] = useState(false)
  const effectiveHiddenLayers = useMemo(() => new Set(completeProject ? Object.keys(completeProject.document.userLayers).filter(id => hiddenLayerIds.has(id) || soloLayerId !== null && soloLayerId !== id) : []), [completeProject?.document, hiddenLayerIds, soloLayerId])
  const hiddenIds = useMemo(() => completeProject ? hiddenEntities(completeProject.document, effectiveHiddenLayers) : new Set<string>(), [completeProject?.document, effectiveHiddenLayers])
  const scopedHiddenIds = useMemo(() => completeProject ? scopedHiddenEntities(completeProject.document, hiddenIds, currentOnly ? currentLayerId : null) : hiddenIds, [completeProject?.document, hiddenIds, currentOnly, currentLayerId])
  const selectionOptions = useMemo(() => ({ hiddenIds: scopedHiddenIds }), [scopedHiddenIds])
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
  const [variantsProject,setVariantsProject]=useState<EditableProject>(),[variantsLoading,setVariantsLoading]=useState(false),[variantsError,setVariantsError]=useState<string>()
  const variantsOperation=useRef<{abort:AbortController;promise:Promise<EditableProject>}|null>(null),variantsValue=useRef<EditableProject|null>(null)
  const requestVariants=useCallback(()=>{
    if(variantsValue.current||variantsOperation.current)return
    const abort=new AbortController(),operation={abort,promise:null! as Promise<EditableProject>}
    variantsOperation.current=operation;setVariantsLoading(true);setVariantsError(undefined)
    operation.promise=createTerrainVariantCatalogProject(abort.signal).then(value=>{if(variantsOperation.current===operation&&!abort.signal.aborted){variantsValue.current=value;setVariantsProject(value)}return value})
      .catch(error=>{if(variantsOperation.current===operation&&!abort.signal.aborted)setVariantsError(error instanceof Error?error.message:String(error));throw error})
      .finally(()=>{if(variantsOperation.current===operation){variantsOperation.current=null;setVariantsLoading(false)}})
    void operation.promise.catch(()=>{})
  },[])
  useEffect(()=>()=>{variantsOperation.current?.abort.abort();variantsOperation.current=null},[])
  const singleAssetDraft=useRef(false),batchAssetDraft=useRef(false)
  const syncAssetDraft=()=>setFormDrafts(current=>({...current,assetImportForm:singleAssetDraft.current||batchAssetDraft.current}))
  const onAssetBatchDraft=(dirty:boolean)=>{batchAssetDraft.current=dirty;syncAssetDraft()}
  useEffect(()=>{singleAssetDraft.current=false;batchAssetDraft.current=false;setFormDrafts(current=>({...current,assetImportForm:false}))},[formReset.assetImportForm,completeProject?.document.sceneId,sessionGeneration])
  const onCatalogPending = useCallback((pending: boolean) => { catalogPending.current = pending; setCatalogBusy(pending) }, [])
  const onCatalogDraft = useCallback((dirty: boolean) => setFormDrafts(current => current.catalogForm === dirty ? current : { ...current, catalogForm: dirty }), [])
  const onPropAppearanceDraft = useCallback((dirty: boolean) => setFormDrafts(current => current.propAppearanceForm === dirty ? current : { ...current, propAppearanceForm: dirty }), [])
  const [busy, setBusy] = useState(false), [message, setMessage] = useState<string | null>(null)
  const [uvttProject, setUvttProject] = useState<EditableProject | null>(null)
  const [selectionSession] = useState(() => new SelectionSession())
  const setSelected = (id: string | null) => selectionSession.set(id ? [id] : [])
  const [layerMoveRequest, setLayerMoveRequest] = useState(0)
  const [memberMode, setMemberMode] = useState(false), [menu, setMenu] = useState<SceneMenu | null>(null), [fitRequest, setFitRequest] = useState(0)
  const [terrainPreview, setTerrainPreview] = useState<TerrainPreview | null>(null)
  const [localGenerationPreview, setLocalGenerationPreview] = useState<LocalGenerationPreview | null>(null), [localGenerationBusy, setLocalGenerationBusy] = useState(false), [localGenerationError, setLocalGenerationError] = useState<string | null>(null)
  const [localGenerationDraft, setLocalGenerationDraft] = useState(false), [localGenerationReset, setLocalGenerationReset] = useState(0)
  const localGenerationPreviewRef = useRef<LocalGenerationPreview | null>(null), localGenerationAbort = useRef<AbortController | null>(null), localGenerationEpoch = useRef(0), localGenerationBaseline = useRef(compositionWorkspace.checkpoint())
  const localGenerationDraftRef = useRef(localGenerationDraft)
  localGenerationPreviewRef.current = localGenerationPreview
  localGenerationDraftRef.current = localGenerationDraft

  const [volcanoPreview, setVolcanoPreview] = useState<VolcanoPreview | null>(null), [volcanoBusy, setVolcanoBusy] = useState(false), [volcanoError, setVolcanoError] = useState<string | null>(null)
  const [volcanoDraft, setVolcanoDraft] = useState(false), [volcanoReset, setVolcanoReset] = useState(0)
  const volcanoPreviewRef = useRef<VolcanoPreview | null>(null), volcanoAbort = useRef<AbortController | null>(null), volcanoEpoch = useRef(0), volcanoBaseline = useRef(compositionWorkspace.checkpoint())
  const volcanoDraftRef = useRef(volcanoDraft)
  volcanoPreviewRef.current = volcanoPreview
  volcanoDraftRef.current = volcanoDraft
  const [forestPreview, setForestPreview] = useState<ForestPreview | null>(null), [forestBusy, setForestBusy] = useState(false), [forestError, setForestError] = useState<string | null>(null)
  const [forestDraft, setForestDraft] = useState(false), [forestReset, setForestReset] = useState(0)
  const forestPreviewRef = useRef<ForestPreview | null>(null), forestAbort = useRef<AbortController | null>(null), forestEpoch = useRef(0), forestBaseline = useRef(compositionWorkspace.checkpoint())
  const forestDraftRef = useRef(forestDraft)
  forestPreviewRef.current = forestPreview
  forestDraftRef.current = forestDraft
  const [interiorPreview, setInteriorPreview] = useState<InteriorPreview | null>(null), [interiorBusy, setInteriorBusy] = useState(false), [interiorError, setInteriorError] = useState<string | null>(null)
  const [interiorDraft, setInteriorDraft] = useState(false), [interiorReset, setInteriorReset] = useState(0)
  const interiorPreviewRef = useRef<InteriorPreview | null>(null), interiorAbort = useRef<AbortController | null>(null), interiorEpoch = useRef(0), interiorBaseline = useRef(compositionWorkspace.checkpoint())
  const interiorDraftRef = useRef(interiorDraft)
  interiorPreviewRef.current = interiorPreview
  interiorDraftRef.current = interiorDraft
  const [regionalPreview, setRegionalPreview] = useState<RegionalPreview | null>(null), [regionalBusy, setRegionalBusy] = useState(false), [regionalError, setRegionalError] = useState<string | null>(null)
  const [regionalDraft, setRegionalDraft] = useState(false), [regionalReset, setRegionalReset] = useState(0), [regionalComparison, setRegionalComparison] = useState<string | null>(null)
  const regionalPreviewRef = useRef<RegionalPreview | null>(null), regionalAbort = useRef<AbortController | null>(null), regionalEpoch = useRef(0)
  regionalPreviewRef.current = regionalPreview
  const [terrainEditPreview, setTerrainEditPreview] = useState<TerrainEditPreview | null>(null)
  const terrainEditPreviewRef = useRef<TerrainEditPreview | null>(null)
  terrainEditPreviewRef.current = terrainEditPreview
  const terrainEditClient = useRef<ReturnType<typeof createTerrainEditClient> | null>(null), terrainEditAbort = useRef<AbortController | null>(null), terrainEditOperation = useRef(0)
  const [terrainEditBusy, setTerrainEditBusy] = useState(false), [terrainEditError, setTerrainEditError] = useState<string | null>(null)
  const [terrainEditDraft, setTerrainEditDraft] = useState(false), [terrainEditReset, setTerrainEditReset] = useState(0)
  const [terrainEditCanvas, setTerrainEditCanvas] = useState<TerrainEditCanvasSession | null>(null)
  const [canopyBrush, setCanopyBrush] = useState<CanvasTerrainBrush | null>(null)
  const terrainEditDraftRef = useRef(false)
  terrainEditDraftRef.current = terrainEditDraft
  const terrainEditBaseline = useRef(compositionWorkspace.checkpoint())
  const terrainPreviewRef = useRef<TerrainPreview | null>(null)
  terrainPreviewRef.current = terrainPreview
  const terrainClient = useRef<ReturnType<typeof createBaseMapGenerationClient> | null>(null)
  const domainClient = useRef<ReturnType<typeof createDomainGenerationClient> | null>(null)
  const [domainSettings, setDomainSettings] = useState<GenerationExecutionSettingsValue>({ mode: 'worker', baseUrl: '', token: '' })
  useEffect(() => () => domainClient.current?.dispose(), [])
  const terrainOperation = useRef(0)
  const terrainAbort = useRef<AbortController | null>(null)
  const [baseMapSettings, setBaseMapSettings] = useState<BaseMapGenerationSettingsValue>({ mode: 'worker', baseUrl: '', token: '' })
  const [terrainBusy, setTerrainBusy] = useState(false), [terrainError, setTerrainError] = useState<string | null>(null)
  const [terrainLocalPreview, setTerrainLocalPreview] = useState<TerrainLocalPreview | null>(null), [terrainLocalBusy, setTerrainLocalBusy] = useState(false), [terrainLocalError, setTerrainLocalError] = useState<string | null>(null)
  const terrainLocalPreviewRef = useRef<TerrainLocalPreview | null>(null)
  terrainLocalPreviewRef.current = terrainLocalPreview
  const [candidate, setCandidate] = useState<Candidate | null>(null)
  const [preparation, setPreparation] = useState<{ abort: AbortController; description: string; progress: ContentLoadProgress | null; cancelling: boolean } | null>(null)
  const cancelPreparation = () => { controller.current?.abort(); setPreparation(current => current ? { ...current, cancelling: true } : current) }
  const [sidebar, setSidebar] = useState<'scene' | 'building' | 'library' | 'outdoor' | 'visual' | 'ai'>('library'), [historyRefresh, setHistoryRefresh] = useState(0)
  const [restore, setRestore] = useState<RestorePreview | null>(null)
  const [restoreConfirmed, setRestoreConfirmed] = useState(false)
  const restoreRef = useRef<RestorePreview | null>(null)
  restoreRef.current = restore
  const [structureRestore, setStructureRestore] = useState<StructureRestorePreview | null>(null)
  const structureRestoreRef = useRef<StructureRestorePreview | null>(null)
  structureRestoreRef.current = structureRestore
  const [structure, setStructure] = useState<StructurePreview | null>(null), [audience, setAudience] = useState<'gm' | 'player'>('gm'), [groundView, setGroundView] = useState(false)
  const structureRef = useRef<StructurePreview | null>(null)
  structureRef.current = structure
  const [sketch, setSketch] = useState<BuildingSketch | null>(null)
  const [outdoorSketch, setOutdoorSketch] = useState<OutdoorSketch | null>(null)
  const [boundaryEditor, setBoundaryEditor] = useState<VisualBoundaryEditor | null>(null)
  const [connectionBoundaryEditor, setConnectionBoundaryEditor] = useState<(VisualBoundaryEditor & { owner: 'outdoorForm' | 'outdoorInspector' }) | null>(null)
  const editConnectionForm = useCallback((editor: VisualBoundaryEditor | null) => setConnectionBoundaryEditor(editor ? { ...editor, owner: 'outdoorForm' } : null), [])
  const editConnectionInspector = useCallback((editor: VisualBoundaryEditor | null) => setConnectionBoundaryEditor(editor ? { ...editor, owner: 'outdoorInspector' } : null), [])
  const [newScene, setNewScene] = useState(false), [visualNewScene, setVisualNewScene] = useState(false)
  const [prefabPlacement, setPrefabPlacement] = useState<string | null>(null)
  const [creatingStage, setCreatingStage] = useState<'preparing' | 'saving' | null>(null)
  const creatingStageRef = useRef<'preparing' | 'saving' | null>(null)
  const [placement, setPlacement] = useState<{ prop: Prop; checkpoint: number } | null>(null)
  const [fillCopy, setFillCopy] = useState<{ sourceId: string; count: number; allowOverlap: boolean; checkpoint: number } | null>(null)
  const [placementReady, setPlacementReady] = useState(false)
  const [aiPreview, setAiPreview] = useState<AtomicCandidate | null>(null), [showAiDraft, setShowAiDraft] = useState(false), [aiCritical, setAiCritical] = useState(false)
  const aiCriticalRef = useRef(aiCritical)
  aiCriticalRef.current = aiCritical
  const aiShown = !!aiPreview && showAiDraft && audience === 'gm'
  useEffect(() => { setAiPreview(null); setShowAiDraft(false) }, [completeProject?.document.sceneId, sessionGeneration])
  const previewRef = useRef(false)
  previewRef.current = !!localGenerationPreview || !!volcanoPreview || !!forestPreview || !!interiorPreview || !!regionalPreview || !!structure || !!restore || !!structureRestore || !!terrainPreview || !!terrainEditPreview || !!terrainLocalPreview
  const editingBlocked = localGenerationBusy || !!localGenerationPreview || volcanoBusy || forestBusy || !!volcanoPreview || !!forestPreview || interiorBusy || !!interiorPreview || regionalBusy || !!regionalPreview || !!structure || !!restore || !!structureRestore || !!terrainPreview || terrainBusy || !!terrainEditPreview || terrainEditBusy || !!terrainLocalPreview || terrainLocalBusy || aiShown || aiCritical
  const placingRef = useRef(false)
  placingRef.current = !!placement || !!fillCopy
  const file = useRef<HTMLInputElement>(null), controller = useRef<AbortController | null>(null), shell = useRef<HTMLDivElement>(null), dialog = useRef<HTMLDivElement>(null)
  const modalOrigin = useRef<HTMLElement | null>(null)
  const actionPending = useRef(false)
  const activeRef = useRef(active)
  activeRef.current = active
  const transient = (): WorkspaceTransient => ({ busy: busy || localGenerationBusy || volcanoBusy || forestBusy || interiorBusy || terrainBusy || terrainEditBusy || regionalBusy || actionPending.current || catalogPending.current || aiCritical, preparing: !!controller.current && creatingStageRef.current !== 'saving',
    newScene, candidate: !!candidate, terrainPreview: !!localGenerationPreviewRef.current || localGenerationDraftRef.current || !!volcanoPreview || !!forestPreview || volcanoDraft || forestDraft || !!interiorPreview || interiorDraft || !!terrainPreview || !!terrainEditPreview || !!terrainLocalPreview || terrainEditDraft || !!regionalPreview || regionalDraft, placement: !!placement || !!fillCopy, prefabPlacement: !!prefabPlacement, sketch: !!sketch,
    outdoorSketch: !!outdoorSketch, restore: !!restore, structureRestore: !!structureRestore, structure: !!structure, aiPreview: aiShown, ...formDrafts })
  const transientRef = useRef(transient)
  transientRef.current = transient
  const guard = (completing?: WorkspaceDraft | readonly WorkspaceDraft[]) => {
    const reason = workspaceTransitionReason(transientRef.current(), completing)
    if (reason) { setMessage(reason); return false }
    return true
  }
  const hasDraft = localGenerationDraft || volcanoDraft || forestDraft || interiorDraft || regionalDraft || terrainEditDraft || !!placement || !!fillCopy || !!prefabPlacement || !!sketch || !!outdoorSketch || Object.values(formDrafts).some(Boolean)
  const editDisabled = busy || catalogBusy || editingBlocked || hasDraft
  const markFormDraft = (key: keyof typeof formDrafts) => setFormDrafts(current => current[key] ? current : { ...current, [key]: true })
  const finishFormDraft = (key: keyof typeof formDrafts, reset = false) => {
    setFormDrafts(current => ({ ...current, [key]: false }))
    if (reset) setFormReset(current => ({ ...current, [key]: current[key] + 1 }))
  }
  const toolDisabled = (completing: readonly WorkspaceDraft[]) => !!workspaceTransitionReason(transient(), completing)
  const sessionActions = useRef<WorkspaceController | null>(null)
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
  useEffect(() => { void ready().catch(error => setMessage(String(error))); return () => { controller.current?.abort() } }, [])
  useEffect(() => () => { const current = builtinOperation.current; builtinOperation.current = null; current?.abort.abort() }, [])
  useEffect(() => {
    onController?.({ leave: () => sessionActions.current!.leave(), request: request => sessionActions.current!.request(request) })
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
  }, [project?.document.sceneId, sessionGeneration])
  useEffect(() => { if (structureRef.current) compositionWorkspace.cancelPreview(structureRef.current.prepared); setStructure(null) }, [project?.document.sceneId, project?.document.revision])
  useEffect(() => { if (restoreRef.current) compositionWorkspace.cancelRestore(restoreRef.current); setRestore(null) }, [project?.document.sceneId, project?.document.revision])
  useEffect(() => { setRestoreConfirmed(false) }, [restore])
  useEffect(() => { if (structureRestoreRef.current) compositionWorkspace.cancelStructureRestore(structureRestoreRef.current); setStructureRestore(null) }, [project?.document.sceneId, project?.document.revision])
  useEffect(() => { setPlacement(null); setFillCopy(null); setMenu(null); setSketch(null); setOutdoorSketch(null); if (project) selectionSession.set(normalizeSelection(project.document, selectionSession.getSnapshot(), true).filter(id => !scopedHiddenIds.has(id))) }, [project, audience, scopedHiddenIds])
  useEffect(() => {
    if (import.meta.env.DEV) Reflect.set(window, '__sceneweaveOutdoorDev', { workspace: compositionWorkspace, repository })
    const unload = (event: BeforeUnloadEvent) => { if (workspaceTransitionReason(transientRef.current()) || !['empty', 'saved'].includes(compositionWorkspace.getState().status)) { event.preventDefault(); event.returnValue = '' } }
    const key = (event: KeyboardEvent) => {
      if (!activeRef.current) return
      if (actionPending.current || aiCriticalRef.current) return
      if (localGenerationDraftRef.current || localGenerationAbort.current || localGenerationPreviewRef.current) {
        if (event.key === 'Escape' && !(event.target as HTMLElement)?.closest('input,textarea,select,[contenteditable]')) { event.preventDefault(); cancelLocalGeneration() }
        if ((event.metaKey || event.ctrlKey) && ['z', 'y', 's'].includes(event.key.toLowerCase()) && !(event.target as HTMLElement)?.closest('input,textarea,select,[contenteditable]')) { event.preventDefault(); setMessage('请先采用或取消局部重生成候选。') }
        return
      }
      if (volcanoDraftRef.current || volcanoAbort.current || volcanoPreviewRef.current) {
        if (event.key === 'Escape' && !(event.target as HTMLElement)?.closest('input,textarea,select,[contenteditable]')) { event.preventDefault(); cancelVolcano() }
        if ((event.metaKey || event.ctrlKey) && ['z', 'y', 's'].includes(event.key.toLowerCase()) && !(event.target as HTMLElement)?.closest('input,textarea,select,[contenteditable]')) { event.preventDefault(); setMessage('请先保存或取消火山候选。') }
        return
      }
      if (forestDraftRef.current || forestAbort.current || forestPreviewRef.current) {
        if (event.key === 'Escape' && !(event.target as HTMLElement)?.closest('input,textarea,select,[contenteditable]')) { event.preventDefault(); cancelForest() }
        if ((event.metaKey || event.ctrlKey) && ['z', 'y', 's'].includes(event.key.toLowerCase()) && !(event.target as HTMLElement)?.closest('input,textarea,select,[contenteditable]')) { event.preventDefault(); setMessage('请先保存或取消森林与营地候选。') }
        return
      }
      if (interiorDraftRef.current || interiorAbort.current || interiorPreviewRef.current) {
        if (event.key === 'Escape' && !(event.target as HTMLElement)?.closest('input,textarea,select,[contenteditable]')) { event.preventDefault(); cancelInterior() }
        if ((event.metaKey || event.ctrlKey) && ['z', 'y', 's'].includes(event.key.toLowerCase()) && !(event.target as HTMLElement)?.closest('input,textarea,select,[contenteditable]')) { event.preventDefault(); setMessage('请先保存或取消室内布局候选。') }
        return
      }
      if (terrainEditDraftRef.current || terrainEditPreviewRef.current || terrainEditAbort.current) {
        if (event.key === 'Escape' && !(event.target as HTMLElement)?.closest('input,textarea,select,[contenteditable]')) { event.preventDefault(); cancelTerrainEditing() }
        if ((event.metaKey || event.ctrlKey) && ['z', 'y', 's'].includes(event.key.toLowerCase()) && !(event.target as HTMLElement)?.closest('input,textarea,select,[contenteditable]')) { event.preventDefault(); setMessage('请先采用或取消当前地形修改。') }
        return
      }
      if (previewRef.current) { if (event.key === 'Escape' && !(event.target as HTMLElement)?.closest('input,textarea,select,[contenteditable]')) { event.preventDefault(); if (regionalPreviewRef.current) { compositionWorkspace.cancelRegional(regionalPreviewRef.current); regionalPreviewRef.current = null; setRegionalPreview(null); setRegionalDraft(false); setRegionalReset(value => value + 1) }; if (terrainPreviewRef.current) { terrainOperation.current++; terrainClient.current?.cancel(); compositionWorkspace.cancelTerrainGeneration(terrainPreviewRef.current); terrainPreviewRef.current = null; setTerrainPreview(null) }; if (terrainLocalPreviewRef.current) { compositionWorkspace.cancelTerrainLocalRefresh(terrainLocalPreviewRef.current); terrainLocalPreviewRef.current = null; setTerrainLocalPreview(null); setTerrainLocalError(null) }; if (structureRef.current) compositionWorkspace.cancelPreview(structureRef.current.prepared); setStructure(null); if (restoreRef.current) compositionWorkspace.cancelRestore(restoreRef.current); setRestore(null); if (structureRestoreRef.current) compositionWorkspace.cancelStructureRestore(structureRestoreRef.current); setStructureRestore(null) }; return }
      if ((event.target as HTMLElement)?.closest('input,textarea,select,[contenteditable]') || event.isComposing || document.querySelector('[role="dialog"],[role="menu"]')) return
      if (event.key === 'Escape' && placingRef.current) { event.preventDefault(); setPlacement(null); setFillCopy(null); return }
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
      setSessionGeneration(value => value + 1); setAudience('gm'); setSelected(null)
    }, reload ? '重新打开工程' : '打开本地工程')
  }
  const openNewScene = () => {
    if (!guard()) return
    modalOrigin.current = document.activeElement as HTMLElement | null
    setMessage(null); setVisualNewScene(false); setNewScene(true)
  }
  const domainExecutor = (abort: AbortController, checkpoint: number, current: () => boolean) => (request: DomainExecutionRequest) => {
    domainClient.current ??= createDomainGenerationClient()
    return domainClient.current.execute(request, { signal: abort.signal,
      isCurrent: () => checkpoint === compositionWorkspace.checkpoint() && current(),
      ...(domainSettings.mode === 'server' ? { server: { baseUrl: domainSettings.baseUrl, token: domainSettings.token } } : {}),
    })
  }
  const cancelInterior = (reset = true) => {
    interiorEpoch.current++; interiorAbort.current?.abort(); interiorAbort.current = null
    if (interiorPreviewRef.current) compositionWorkspace.cancelGeneration({ kind: 'new-project', domain: 'interior', preview: interiorPreviewRef.current })
    interiorPreviewRef.current = null; setInteriorPreview(null); setInteriorBusy(false); setInteriorError(null); setInteriorDraft(false)
    if (reset) setInteriorReset(value => value + 1)
  }
  const changeInterior = () => { cancelInterior(false); setInteriorDraft(true) }
  useEffect(() => () => { interiorEpoch.current++; interiorAbort.current?.abort(); if (interiorPreviewRef.current) compositionWorkspace.cancelGeneration({ kind: 'new-project', domain: 'interior', preview: interiorPreviewRef.current }) }, [])
  useEffect(() => {
    if (interiorBaseline.current !== compositionWorkspace.checkpoint()) cancelInterior()
  }, [completeProject?.document.sceneId, completeProject?.document.revision, sessionGeneration])
  const generateInterior = async (input: InteriorGenerationUiRequest) => {
    if (interiorBusy || busy || audience !== 'gm') return
    const owned = captureJson(input)
    const reason = workspaceTransitionReason({ ...transientRef.current(), terrainPreview: !!localGenerationPreviewRef.current || localGenerationDraftRef.current || !!volcanoPreviewRef.current || !!forestPreviewRef.current || volcanoDraft || forestDraft || !!terrainPreviewRef.current || !!terrainEditPreviewRef.current || terrainEditDraftRef.current || !!terrainLocalPreviewRef.current || !!regionalPreviewRef.current || regionalDraft })
    if (reason) { setInteriorError(reason); return }
    cancelInterior(false)
    const epoch = ++interiorEpoch.current, checkpoint = compositionWorkspace.checkpoint(), abort = new AbortController()
    interiorBaseline.current = checkpoint; interiorAbort.current = abort; setInteriorBusy(true); setInteriorDraft(true); setInteriorError(null)
    try {
      const base = await createRefinedBlankProject('interior', { title: owned.title, widthMm: owned.widthMm, heightMm: owned.heightMm, preset: 'narrative', gridVisible: false, sceneId: runtime.ids.nextId() }, abort.signal)
      abort.signal.throwIfAborted(); compositionWorkspace.assertCheckpoint(checkpoint)
      if (epoch !== interiorEpoch.current) return
      const floor = Object.values(base.document.floors)[0], layer = Object.values(base.document.userLayers).find(value => value.floorId === floor.id)
      if (!layer) throw new Error('室内布局缺少可用的房间图层。')
      const profile = selectBrowserGenerationBudget({ widthMm: owned.widthMm, heightMm: owned.heightMm, quality: 'standard', mode: 'auto' })
      // This fixed palette belongs to the same original interior blank catalog.
      // The shared domain consumes roles and exact references, never names.
      const palette = [
        { role: 'bed' as const, ref: { id: 'refined-prop-interior-bed-indigo', version: 1 } },
        { role: 'seat' as const, ref: { id: 'refined-prop-interior-chair-slat', version: 1 } },
        { role: 'table' as const, ref: { id: 'refined-prop-interior-table-round', version: 1 } },
        { role: 'storage' as const, ref: { id: 'refined-prop-interior-cupboard-linen', version: 1 } },
        { role: 'work' as const, ref: { id: 'refined-prop-interior-counter-kitchen', version: 1 } },
        { role: 'hearth' as const, ref: { id: 'refined-prop-interior-stove-masonry', version: 1 } },
        { role: 'shelf' as const, ref: { id: 'refined-prop-interior-shelf-books', version: 1 } },
      ].filter(row => base.document.propDefinitions[row.ref.id]?.version === row.ref.version)
      const next = await compositionWorkspace.previewGeneration({ kind: 'new-project', domain: 'interior', base, input: { version: 1, algorithmVersion: 2, seed: owned.seed, parameters: {
        floorId: floor.id, layerId: layer.id, boundsMm: { ...floor.boundsMm }, wallThicknessMm: owned.wallThicknessMm, rooms: owned.rooms, relations: owned.relations,
        corridor: owned.corridor, materials: { floor: null, wall: null }, arrangement: { ...owned.arrangement, palette },
      } }, profile }, { signal: abort.signal, epoch, execute: domainExecutor(abort, checkpoint, () => epoch === interiorEpoch.current) })
      if (epoch !== interiorEpoch.current || abort.signal.aborted || checkpoint !== compositionWorkspace.checkpoint()) { compositionWorkspace.cancelGeneration({ kind: 'new-project', domain: 'interior', preview: next }); return }
      interiorPreviewRef.current = next; setInteriorPreview(next); setInteriorDraft(false); setSelected(null); setAudience('gm'); setHiddenLayerIds(new Set()); setSoloLayerId(null); setCurrentOnly(false); setFitRequest(value => value + 1)
    } catch (error) { if (epoch === interiorEpoch.current && !abort.signal.aborted) setInteriorError(error instanceof Error ? error.message : String(error)) }
    finally { if (epoch === interiorEpoch.current) { interiorAbort.current = null; setInteriorBusy(false) } }
  }
  const adoptInterior = async () => {
    const next = interiorPreviewRef.current
    if (!next || busy || interiorBusy || aiCritical) return
    await action(async () => {
      try { await ready(); await compositionWorkspace.adoptGeneration({ kind: 'new-project', domain: 'interior', preview: next }) }
      catch (error) { cancelInterior(false); setInteriorDraft(true); setInteriorError(error instanceof Error ? error.message : String(error)); throw error }
      interiorPreviewRef.current = null; setInteriorPreview(null); setInteriorDraft(false); setInteriorReset(value => value + 1); setSelected(null); setSessionGeneration(value => value + 1)
      setMessage('室内布局已完整保存并打开。首次建议的门和家具可继续修改、删除，不会自动补回。')
    }, '保存室内布局')
  }
  const cancelVolcano = (reset = true) => {
    volcanoEpoch.current++; volcanoAbort.current?.abort(); volcanoAbort.current = null
    if (volcanoPreviewRef.current) compositionWorkspace.cancelGeneration({ kind: 'new-project', domain: 'volcano', preview: volcanoPreviewRef.current })
    volcanoPreviewRef.current = null; setVolcanoPreview(null); setVolcanoBusy(false); setVolcanoError(null); setVolcanoDraft(false)
    if (reset) setVolcanoReset(value => value + 1)
  }
  const changeVolcano = () => { cancelVolcano(false); setVolcanoDraft(true) }
  useEffect(() => () => { volcanoEpoch.current++; volcanoAbort.current?.abort(); if (volcanoPreviewRef.current) compositionWorkspace.cancelGeneration({ kind: 'new-project', domain: 'volcano', preview: volcanoPreviewRef.current }) }, [])
  useEffect(() => {
    if (volcanoBaseline.current !== compositionWorkspace.checkpoint()) cancelVolcano()
  }, [completeProject?.document.sceneId, completeProject?.document.revision, sessionGeneration])
  const generateVolcano = async (input: VolcanoGenerationUiRequest) => {
    if (volcanoBusy || busy || audience !== 'gm') return
    const owned = captureJson(input)
    const reason = workspaceTransitionReason({ ...transientRef.current(), terrainPreview: !!localGenerationPreviewRef.current || localGenerationDraftRef.current || !!forestPreviewRef.current || forestDraft || !!interiorPreviewRef.current || interiorDraft || !!terrainPreviewRef.current || !!terrainEditPreviewRef.current || terrainEditDraftRef.current || !!terrainLocalPreviewRef.current || !!regionalPreviewRef.current || regionalDraft })
    if (reason) { setVolcanoError(reason); return }
    cancelVolcano(false)
    const epoch = ++volcanoEpoch.current, checkpoint = compositionWorkspace.checkpoint(), abort = new AbortController()
    volcanoBaseline.current = checkpoint; volcanoAbort.current = abort; setVolcanoBusy(true); setVolcanoDraft(true); setVolcanoError(null)
    try {
      const base = await createVolcanoBlankProject({ title: owned.title, widthMm: owned.widthMm, heightMm: owned.heightMm, preset: 'narrative', gridVisible: false, sceneId: runtime.ids.nextId() }, abort.signal)
      abort.signal.throwIfAborted(); compositionWorkspace.assertCheckpoint(checkpoint)
      if (epoch !== volcanoEpoch.current) return
      const request = captureJson(defaultVolcanoInput(base.document, owned.seed)), p = request.parameters, bounds = p.boundsMm
      p.mountain.elevationMm = owned.mountainElevationMm
      Object.assign(p.crater, { elevationMm: owned.craterElevationMm, hazard: owned.craterHazard, blocksMovement: owned.craterBlocksMovement, movementCostMultiplier: owned.craterMovementCostMultiplier })
      const crater = { x: bounds.x + Math.round(bounds.width * .55), y: bounds.y + Math.round(bounds.height * (owned.craterCenterYPercent - owned.craterHeightPercent / 2) / 100), width: Math.round(bounds.width * owned.craterWidthPercent / 100), height: Math.round(bounds.height * owned.craterHeightPercent / 100) }
      p.crater.boundaryMm = forestRectangle(crater)
      const y = Math.round(crater.y + crater.height / 2)
      p.ascent.kind = owned.connectionKind; p.descent.kind = owned.connectionKind
      p.descent.fromMm = { x: crater.x - Math.round(bounds.width * .04), y }
      p.descent.toMm = { x: crater.x + Math.min(Math.round(bounds.width * .04), Math.round(crater.width / 4)), y }
      p.route.widthMm = owned.routeWidthMm
      p.route.toCraterViaMm = y === p.platform.anchorMm.y ? [] : [{ x: p.platform.anchorMm.x, y }]
      p.flow = owned.flowEnabled ? { centerlineMm: [{ x: Math.round(crater.x + crater.width * .72), y: Math.round(crater.y + crater.height * .25) }, { x: Math.round(crater.x + crater.width * .72), y: Math.round(crater.y + crater.height * .75) }], widthMm: owned.flowWidthMm, hazard: owned.flowHazard, blocksMovement: owned.flowBlocksMovement, movementCostMultiplier: owned.flowMovementCostMultiplier } : null
      p.materials.flow = { id: owned.lavaAppearance === 'hot' ? 'content-m-lava-hot' : 'content-m-lava', version: 1 }
      const profile = selectBrowserGenerationBudget({ widthMm: owned.widthMm, heightMm: owned.heightMm, quality: 'standard', mode: 'auto' })
      const next = await compositionWorkspace.previewGeneration({ kind: 'new-project', domain: 'volcano', base, input: request, profile }, { signal: abort.signal, epoch, execute: domainExecutor(abort, checkpoint, () => epoch === volcanoEpoch.current) })
      if (epoch !== volcanoEpoch.current || abort.signal.aborted || checkpoint !== compositionWorkspace.checkpoint()) { compositionWorkspace.cancelGeneration({ kind: 'new-project', domain: 'volcano', preview: next }); return }
      volcanoPreviewRef.current = next; setVolcanoPreview(next); setVolcanoDraft(false); setSelected(null); setAudience('gm'); setHiddenLayerIds(new Set()); setSoloLayerId(null); setCurrentOnly(false); setFitRequest(value => value + 1)
    } catch (error) { if (epoch === volcanoEpoch.current && !abort.signal.aborted) setVolcanoError(error instanceof Error ? error.message : String(error)) }
    finally { if (epoch === volcanoEpoch.current) { volcanoAbort.current = null; setVolcanoBusy(false) } }
  }
  const adoptVolcano = async () => {
    const next = volcanoPreviewRef.current
    if (!next || busy || volcanoBusy || aiCritical) return
    await action(async () => {
      try { await ready(); await compositionWorkspace.adoptGeneration({ kind: 'new-project', domain: 'volcano', preview: next }) }
      catch (error) { cancelVolcano(false); setVolcanoDraft(true); setVolcanoError(error instanceof Error ? error.message : String(error)); throw error }
      volcanoPreviewRef.current = null; setVolcanoPreview(null); setVolcanoDraft(false); setVolcanoReset(value => value + 1); setSelected(null); setSessionGeneration(value => value + 1)
      setMessage('火山已完整保存并打开。地形、危险与通行策略可继续独立修改，不会自动补回。')
    }, '保存火山')
  }
  const cancelForest = (reset = true) => {
    forestEpoch.current++; forestAbort.current?.abort(); forestAbort.current = null
    if (forestPreviewRef.current) compositionWorkspace.cancelGeneration({ kind: 'new-project', domain: 'forest', preview: forestPreviewRef.current })
    forestPreviewRef.current = null; setForestPreview(null); setForestBusy(false); setForestError(null); setForestDraft(false)
    if (reset) setForestReset(value => value + 1)
  }
  const changeForest = () => { cancelForest(false); setForestDraft(true) }
  useEffect(() => () => { forestEpoch.current++; forestAbort.current?.abort(); if (forestPreviewRef.current) compositionWorkspace.cancelGeneration({ kind: 'new-project', domain: 'forest', preview: forestPreviewRef.current }) }, [])
  useEffect(() => {
    if (forestBaseline.current !== compositionWorkspace.checkpoint()) cancelForest()
  }, [completeProject?.document.sceneId, completeProject?.document.revision, sessionGeneration])
  const generateForest = async (input: ForestGenerationUiRequest) => {
    if (volcanoBusy || forestBusy || busy || audience !== 'gm') return
    const owned = captureJson(input)
    const reason = workspaceTransitionReason({ ...transientRef.current(), terrainPreview: !!localGenerationPreviewRef.current || localGenerationDraftRef.current || !!volcanoPreviewRef.current || volcanoDraft || !!interiorPreviewRef.current || interiorDraft || !!terrainPreviewRef.current || !!terrainEditPreviewRef.current || terrainEditDraftRef.current || !!terrainLocalPreviewRef.current || !!regionalPreviewRef.current || regionalDraft })
    if (reason) { setForestError(reason); return }
    cancelForest(false)
    const epoch = ++forestEpoch.current, checkpoint = compositionWorkspace.checkpoint(), abort = new AbortController()
    forestBaseline.current = checkpoint; forestAbort.current = abort; setForestBusy(true); setForestDraft(true); setForestError(null)
    try {
      const base = await createShoreBlankProject('island', { title: owned.title, widthMm: owned.widthMm, heightMm: owned.heightMm, preset: 'narrative', gridVisible: false, sceneId: runtime.ids.nextId() }, abort.signal, true, true)
      abort.signal.throwIfAborted(); compositionWorkspace.assertCheckpoint(checkpoint)
      if (epoch !== forestEpoch.current) return
      const floor = Object.values(base.document.floors)[0], layer = Object.values(base.document.userLayers).find(value => value.floorId === floor.id)
      if (!layer) throw new Error('森林与营地缺少可用的地面图层。')
      const profile = selectBrowserGenerationBudget({ widthMm: owned.widthMm, heightMm: owned.heightMm, quality: 'standard', mode: 'auto' })
      const bounds = floor.boundsMm, inset = Math.ceil(owned.routeWidthMm / 2) + 300
      const centre = { x: Math.round(bounds.x + bounds.width / 2), y: Math.round(bounds.y + bounds.height / 2) }
      const positionMm = owned.entranceSide === 'west' ? { x: bounds.x + inset, y: centre.y }
        : owned.entranceSide === 'east' ? { x: bounds.x + bounds.width - inset, y: centre.y }
          : owned.entranceSide === 'north' ? { x: centre.x, y: bounds.y + inset } : { x: centre.x, y: bounds.y + bounds.height - inset }
      const directionDeg = { west: 0, north: 90, east: 180, south: 270 }[owned.entranceSide]
      const supportRef = { kind: 'generated-ground' as const }
      const clearings = owned.clearings.map(row => {
        const rectangle = { ...row.boundsMm, x: bounds.x + row.boundsMm.x, y: bounds.y + row.boundsMm.y }
        return { id: row.id, supportRef, boundaryMm: forestRectangle(rectangle), anchorMm: { x: Math.round(rectangle.x + rectangle.width / 2), y: Math.round(rectangle.y + rectangle.height / 2) }, clearanceMm: 300 }
      })
      const request: ForestGenerationInput = { version: 1, algorithmVersion: 1, seed: owned.seed, parameters: {
        floorId: floor.id, layerId: layer.id, boundsMm: { ...bounds }, ground: { kind: 'new', elevationMm: 0, materialRef: { id: 'shore-v1-material-grass', version: 1 } },
        zones: [{ id: 'woodland', supportRef, boundaryMm: forestRectangle(bounds), vegetation: [
          { role: 'tree', coveragePpm: owned.treeCoveragePpm, spacingMm: 2500, clusterRadiusMm: 6000, clearanceMm: 200, palette: [{ key: 'tree-highland-copse', definitionRef: { id: 'terrain-variants-v2-prop-tree-highland-copse', version: 1 }, kind: 'prop', weight: 1 }] },
          { role: 'shrub', coveragePpm: owned.shrubCoveragePpm, spacingMm: 800, clusterRadiusMm: 4000, clearanceMm: 180, palette: [{ key: 'shrub-heath-mound', definitionRef: { id: 'terrain-variants-v1-prop-shrub-heath-mound', version: 1 }, kind: 'decoration', weight: 1 }] },
          { role: 'grass', coveragePpm: owned.grassCoveragePpm, spacingMm: 300, clusterRadiusMm: 3000, clearanceMm: 180, palette: [{ key: 'grass-sedge-fan', definitionRef: { id: 'terrain-variants-v1-prop-grass-sedge-fan', version: 1 }, kind: 'decoration', weight: 1 }] },
        ] }], clearings, entrances: [{ id: 'entry', supportRef, positionMm, directionDeg, widthMm: owned.routeWidthMm }],
        routes: clearings.map(row => ({ id: `route:${row.id}`, fromEntranceId: 'entry', toClearingId: row.id, viaMm: [], widthMm: owned.routeWidthMm, materialRef: { id: 'shore-v1-material-sand-dry', version: 1 } })),
      } }
      const next = await compositionWorkspace.previewGeneration({ kind: 'new-project', domain: 'forest', base, input: request, profile }, { signal: abort.signal, epoch, execute: domainExecutor(abort, checkpoint, () => epoch === forestEpoch.current) })
      if (epoch !== forestEpoch.current || abort.signal.aborted || checkpoint !== compositionWorkspace.checkpoint()) { compositionWorkspace.cancelGeneration({ kind: 'new-project', domain: 'forest', preview: next }); return }
      forestPreviewRef.current = next; setForestPreview(next); setForestDraft(false); setSelected(null); setAudience('gm'); setHiddenLayerIds(new Set()); setSoloLayerId(null); setCurrentOnly(false); setFitRequest(value => value + 1)
    } catch (error) { if (epoch === forestEpoch.current && !abort.signal.aborted) setForestError(error instanceof Error ? error.message : String(error)) }
    finally { if (epoch === forestEpoch.current) { forestAbort.current = null; setForestBusy(false) } }
  }
  const adoptForest = async () => {
    const next = forestPreviewRef.current
    if (!next || busy || volcanoBusy || forestBusy || aiCritical) return
    await action(async () => {
      try { await ready(); await compositionWorkspace.adoptGeneration({ kind: 'new-project', domain: 'forest', preview: next }) }
      catch (error) { cancelForest(false); setForestDraft(true); setForestError(error instanceof Error ? error.message : String(error)); throw error }
      forestPreviewRef.current = null; setForestPreview(null); setForestDraft(false); setForestReset(value => value + 1); setSelected(null); setSessionGeneration(value => value + 1)
      setMessage('森林与营地已完整保存并打开。道路与植被可继续修改、删除，不会自动补回。')
    }, '保存森林与营地')
  }
  const cancelTerrain = () => {
    terrainOperation.current++; terrainAbort.current?.abort(); terrainAbort.current = null
    terrainClient.current?.cancel()
    if (terrainPreviewRef.current) compositionWorkspace.cancelTerrainGeneration(terrainPreviewRef.current)
    if (aiPreview?.schemaVersion === 2 || aiPreview?.schemaVersion === 3 || aiPreview?.schemaVersion === 4) { compositionWorkspace.cancelAtomicCandidate(aiPreview); setAiPreview(null); setShowAiDraft(false) }
    terrainPreviewRef.current = null; setTerrainPreview(null); setTerrainBusy(false); setTerrainError(null)
  }
  useEffect(() => () => { terrainOperation.current++; terrainAbort.current?.abort(); terrainClient.current?.dispose(); if (terrainPreviewRef.current) compositionWorkspace.cancelTerrainGeneration(terrainPreviewRef.current); if (terrainLocalPreviewRef.current) compositionWorkspace.cancelTerrainLocalRefresh(terrainLocalPreviewRef.current) }, [])
  useEffect(() => {
    if (terrainPreviewRef.current && terrainPreviewRef.current.checkpoint !== compositionWorkspace.checkpoint()) cancelTerrain()
  }, [completeProject?.document.sceneId, completeProject?.document.revision, sessionGeneration])
  const generateBaseMap = async (generation: { kind: 'terrain'; input: TerrainGenerationRequest } | { kind: 'composition'; input: Omit<import('../../shared/terrain-generation/composition-presets').CompositionPresetInput, 'sceneId'> }) => {
    if (terrainBusy || busy) return
    const ownedGeneration = captureJson(generation)
    if (terrainPreviewRef.current) cancelTerrain()
    const reason = workspaceTransitionReason({ ...transientRef.current(), terrainPreview: !!localGenerationPreviewRef.current || localGenerationDraftRef.current || !!volcanoPreviewRef.current || !!forestPreviewRef.current || volcanoDraft || forestDraft || !!interiorPreviewRef.current || interiorDraft })
    if (reason) { setTerrainError(reason); return }
    const epoch = ++terrainOperation.current, checkpoint = compositionWorkspace.checkpoint()
    const workspaceSceneId = compositionWorkspace.getState().project?.document.sceneId ?? 'empty-workspace'
    const abort = new AbortController(), connection = { ...baseMapSettings }
    terrainAbort.current = abort; setTerrainBusy(true); setTerrainError(null)
    try {
      const sceneId = runtime.ids.nextId(), input = ownedGeneration.input
      const palette = ownedGeneration.kind === 'terrain' && ownedGeneration.input.kind === 'coast' ? 'coast' : 'island'
      const surfaceVersion = connection.surfacePalette === 'classic' ? 4 as const : connection.surfacePalette === 'highland-v7' ? 7 as const : connection.surfacePalette === 'surface-rules' ? 6 as const : 5 as const
      const base = await (surfaceVersion >= 5 ? createShoreBlankProject(palette, { title: '程序底图候选', widthMm: input.widthMm, heightMm: input.heightMm, preset: 'narrative', gridVisible: false, sceneId }, abort.signal, surfaceVersion >= 6, surfaceVersion === 7)
        : createRefinedBlankProject(palette, { title: '程序底图候选', widthMm: input.widthMm, heightMm: input.heightMm, preset: 'narrative', gridVisible: false, sceneId }, abort.signal))
      abort.signal.throwIfAborted(); compositionWorkspace.assertCheckpoint(checkpoint)
      const quality = connection.quality ?? 'standard'
      const profile = selectBrowserGenerationBudget({ widthMm: input.widthMm, heightMm: input.heightMm, quality, ...(surfaceVersion >= 5 ? { surfaceRecipe: 1 as const } : {}), mode: connection.budgetMode })
      const normalized = ownedGeneration.kind === 'terrain'
        ? { kind: 'terrain' as const, input: { ...ownedGeneration.input, sceneId, algorithmVersion: surfaceVersion, budgetProfileId: profile.profileId, quality } }
        : { kind: 'composition' as const, input: { ...ownedGeneration.input, sceneId, recipeVersion: surfaceVersion, budgetProfileId: profile.profileId, quality } }
      const request = prepareBaseMapRequestV3({ requestId: runtime.ids.nextId(), flowId: runtime.ids.nextId(), profile,
        workspaceSceneId, checkpoint, operationEpoch: epoch, base: base.document, generation: normalized })
      terrainClient.current ??= createBaseMapGenerationClient()
      let generationExecution: BaseMapGenerationExecution | undefined
      const response = await terrainClient.current.generate(request, {
        signal: abort.signal, isCurrent: () => terrainOperation.current === epoch && compositionWorkspace.checkpoint() === checkpoint,
        onExecution: execution => { generationExecution = execution },
        ...(connection.mode === 'server' ? { server: { baseUrl: connection.baseUrl, token: connection.token } } : {}),
      })
      abort.signal.throwIfAborted(); compositionWorkspace.assertCheckpoint(checkpoint)
      if (!generationExecution?.generationCalls) throw new Error('程序底图缺少本次真实执行记录，请重新准备。')
      const preview = await compositionWorkspace.previewBaseMapGeneration(base, request, response, { signal: abort.signal, source: connection.mode, generationExecution })
      if (terrainOperation.current !== epoch || abort.signal.aborted) { compositionWorkspace.cancelTerrainGeneration(preview); return }
      terrainPreviewRef.current = preview; setTerrainPreview(preview); setSelected(null); setAudience('gm'); setHiddenLayerIds(new Set()); setSoloLayerId(null); setCurrentOnly(false); setFitRequest(value => value + 1)
    } catch (failure) {
      if (terrainOperation.current === epoch && !abort.signal.aborted) setTerrainError(failure instanceof Error ? failure.message : String(failure))
    } finally { if (terrainOperation.current === epoch) { terrainAbort.current = null; setTerrainBusy(false) } }
  }
  const generateTerrain = (input: TerrainGenerationRequest) => generateBaseMap({ kind: 'terrain', input })
  const generateComposition = (input: Omit<import('../../shared/terrain-generation/composition-presets').CompositionPresetInput, 'sceneId'>) => generateBaseMap({ kind: 'composition', input })
  const adoptTerrain = async () => {
    const preview = terrainPreviewRef.current
    if (!preview || busy || terrainBusy || aiCritical) return
    await action(async () => {
      await ready(); await compositionWorkspace.adoptTerrainGeneration(preview)
      terrainPreviewRef.current = null; setTerrainPreview(null); setSelected(null); setSessionGeneration(value => value + 1)
      setMessage('地形工程已保存并打开，可继续移动树石和编辑轮廓。')
    }, '采用地形方案')
  }
  const exportTerrain = async () => {
    const preview = terrainPreviewRef.current
    if (!preview || busy || terrainBusy || aiCritical) return
    await action(async () => { download(new Blob([new Uint8Array(await exportProject(toBundle(preview.project), validation)).buffer], { type: 'application/zip' }), `terrain-${preview.input.kind}-${preview.input.seed}.sceneweave`) }, '导出地形候选')
  }
  const cancelTerrainEditing = () => {
    terrainEditOperation.current++; terrainEditAbort.current?.abort(); terrainEditAbort.current = null; terrainEditClient.current?.cancel()
    if (terrainEditPreviewRef.current) compositionWorkspace.cancelTerrainEdit(terrainEditPreviewRef.current)
    terrainEditPreviewRef.current = null; setTerrainEditPreview(null); setTerrainEditBusy(false); setTerrainEditError(null); setTerrainEditCanvas(null); setTerrainEditDraft(false); setTerrainEditReset(value => value + 1)
  }
  useEffect(() => () => { terrainEditOperation.current++; terrainEditAbort.current?.abort(); terrainEditClient.current?.dispose(); if (terrainEditPreviewRef.current) compositionWorkspace.cancelTerrainEdit(terrainEditPreviewRef.current) }, [])
  useEffect(() => {
    const checkpoint = compositionWorkspace.checkpoint()
    if (terrainEditBaseline.current !== checkpoint && (terrainEditDraftRef.current || terrainEditPreviewRef.current || terrainEditAbort.current)) cancelTerrainEditing()
    terrainEditBaseline.current = checkpoint
  }, [completeProject?.document.sceneId, completeProject?.document.revision, sessionGeneration])
  const previewTerrainEditing = async (input: TerrainEditRequest) => {
    if (terrainEditBusy || busy || audience !== 'gm') return
    const base = compositionWorkspace.getState().project
    if (!base || base.document.mapMode !== 'scene') return
    const reason = workspaceTransitionReason({ ...transientRef.current(), terrainPreview: !!localGenerationPreviewRef.current || localGenerationDraftRef.current || !!volcanoPreviewRef.current || !!forestPreviewRef.current || volcanoDraft || forestDraft || !!interiorPreviewRef.current || interiorDraft || !!terrainPreviewRef.current })
    if (reason) { setTerrainEditError(reason); return }
    if (terrainEditPreviewRef.current) compositionWorkspace.cancelTerrainEdit(terrainEditPreviewRef.current)
    terrainEditPreviewRef.current = null; setTerrainEditPreview(null)
    const epoch = ++terrainEditOperation.current, checkpoint = compositionWorkspace.checkpoint(), abort = new AbortController()
    terrainEditAbort.current = abort; setTerrainEditBusy(true); setTerrainEditError(null)
    try {
      const budget = selectTerrainEditBudget(base.document)
      let result
      if (!budget) {
        terrainEditClient.current ??= createTerrainEditClient()
        result = await terrainEditClient.current.edit({ sceneId: base.document.sceneId, checkpoint, operationEpoch: epoch, base: base.document, input }, { signal: abort.signal, isCurrent: () => terrainEditOperation.current === epoch && compositionWorkspace.checkpoint() === checkpoint })
      }
      abort.signal.throwIfAborted(); compositionWorkspace.assertCheckpoint(checkpoint)
      const preview = await compositionWorkspace.previewTerrainEdit(input, { result, budget, signal: abort.signal })
      if (epoch !== terrainEditOperation.current || abort.signal.aborted) { compositionWorkspace.cancelTerrainEdit(preview); return }
      terrainEditPreviewRef.current = preview; setTerrainEditPreview(preview); setSelected(null)
    } catch (failure) { if (epoch === terrainEditOperation.current && !abort.signal.aborted) setTerrainEditError(failure instanceof Error ? failure.message : String(failure)) }
    finally { if (epoch === terrainEditOperation.current) { terrainEditAbort.current = null; setTerrainEditBusy(false) } }
  }
  const adoptTerrainEditing = async () => {
    const preview = terrainEditPreviewRef.current
    if (!preview || busy || terrainEditBusy) return
    await action(async () => {
      let adopted: Awaited<ReturnType<typeof compositionWorkspace.adoptTerrainEdit>>
      try { await ready(); adopted = await compositionWorkspace.adoptTerrainEdit(preview) }
      catch (failure) {
        compositionWorkspace.cancelTerrainEdit(preview); terrainEditPreviewRef.current = null; setTerrainEditPreview(null)
        setTerrainEditError(`尚未采用，笔画仍保留；请重新预览。${failure instanceof Error ? failure.message : String(failure)}`)
        return
      }
      terrainEditPreviewRef.current = null; setTerrainEditPreview(null); setTerrainEditCanvas(null); setTerrainEditDraft(false); setTerrainEditReset(value => value + 1); setSelected(null)
      try { await adopted.save; setMessage('已保护当前版本并采用局部地形修改；本地保存完成，可整笔撤销。') }
      catch (failure) { setMessage(`地形修改已采用，保存失败；当前成果仍可撤销。${failure instanceof Error ? failure.message : String(failure)}`) }
    }, '采用局部地形修改')
  }
  const cancelLocalGeneration = (reset = true) => {
    localGenerationEpoch.current++; localGenerationAbort.current?.abort(); localGenerationAbort.current = null
    if (localGenerationPreviewRef.current) compositionWorkspace.cancelGeneration({ kind: 'current-project', preview: localGenerationPreviewRef.current })
    localGenerationPreviewRef.current = null; setLocalGenerationPreview(null); setLocalGenerationBusy(false); setLocalGenerationError(null); setLocalGenerationDraft(false)
    localGenerationDraftRef.current = false
    if (reset) setLocalGenerationReset(value => value + 1)
  }
  const changeLocalGeneration = () => { cancelLocalGeneration(false); localGenerationDraftRef.current = true; setLocalGenerationDraft(true) }
  useEffect(() => () => { localGenerationEpoch.current++; localGenerationAbort.current?.abort(); if (localGenerationPreviewRef.current) compositionWorkspace.cancelGeneration({ kind: 'current-project', preview: localGenerationPreviewRef.current }) }, [])
  useEffect(() => {
    if (localGenerationBaseline.current !== compositionWorkspace.checkpoint()) { cancelLocalGeneration(); localGenerationBaseline.current = compositionWorkspace.checkpoint() }
  }, [completeProject?.document.sceneId, completeProject?.document.revision, sessionGeneration])
  const previewLocalGeneration = async (input: LocalGenerationRequest) => {
    if (localGenerationBusy || busy || audience !== 'gm') return
    const reason = workspaceTransitionReason({ ...transientRef.current(), terrainPreview: !!volcanoPreviewRef.current || volcanoDraftRef.current || !!forestPreviewRef.current || forestDraftRef.current || !!interiorPreviewRef.current || interiorDraftRef.current || !!terrainPreviewRef.current || !!terrainEditPreviewRef.current || terrainEditDraftRef.current || !!terrainLocalPreviewRef.current || !!regionalPreviewRef.current || regionalDraft })
    if (reason) { setLocalGenerationError(reason); return }
    cancelLocalGeneration(false)
    const epoch = ++localGenerationEpoch.current, checkpoint = compositionWorkspace.checkpoint(), abort = new AbortController()
    localGenerationBaseline.current = checkpoint; localGenerationAbort.current = abort; localGenerationDraftRef.current = true; setLocalGenerationBusy(true); setLocalGenerationDraft(true)
    try {
      const next = await compositionWorkspace.previewGeneration({ kind: 'current-project', input }, { signal: abort.signal })
      if (epoch !== localGenerationEpoch.current || abort.signal.aborted || checkpoint !== compositionWorkspace.checkpoint()) { compositionWorkspace.cancelGeneration({ kind: 'current-project', preview: next }); return }
      localGenerationPreviewRef.current = next; setLocalGenerationPreview(next); localGenerationDraftRef.current = false; setLocalGenerationDraft(false); setSelected(null); setAudience('gm')
    } catch (error) { if (epoch === localGenerationEpoch.current && !abort.signal.aborted) setLocalGenerationError(error instanceof Error ? error.message : String(error)) }
    finally { if (epoch === localGenerationEpoch.current) { localGenerationAbort.current = null; setLocalGenerationBusy(false) } }
  }
  const adoptLocalGeneration = async () => {
    const next = localGenerationPreviewRef.current
    if (!next || busy || localGenerationBusy || aiCritical) return
    await action(async () => {
      let adopted: Awaited<ReturnType<typeof compositionWorkspace.adoptLocalGeneration>>
      try { await ready(); adopted = await compositionWorkspace.adoptGeneration({ kind: 'current-project', preview: next }) }
      catch (error) { cancelLocalGeneration(false); localGenerationDraftRef.current = true; setLocalGenerationDraft(true); setLocalGenerationError(error instanceof Error ? error.message : String(error)); throw error }
      localGenerationPreviewRef.current = null; setLocalGenerationPreview(null); localGenerationDraftRef.current = false; setLocalGenerationDraft(false); setLocalGenerationReset(value => value + 1); setSelected(null); setSessionGeneration(value => value + 1)
      try { await adopted.save; setMessage('已保护当前版本并采用局部重生成；本地保存完成，可整笔撤销。') }
      catch (error) { setMessage(`局部重生成已采用，保存失败；当前成果仍可撤销。${error instanceof Error ? error.message : String(error)}`) }
    }, '采用局部重生成')
  }
  const cancelTerrainLocal = () => {
    const preview = terrainLocalPreviewRef.current
    if (preview) compositionWorkspace.cancelTerrainLocalRefresh(preview)
    terrainLocalPreviewRef.current = null; setTerrainLocalPreview(null); setTerrainLocalBusy(false); setTerrainLocalError(null)
  }
  const previewTerrainLocal = async () => {
    if (terrainLocalBusy || busy || audience !== 'gm') return
    const base = compositionWorkspace.getState().project
    const transitions = base?.document.visual?.version === 3 ? Object.values(base.document.visual.transitions) : []
    const transition = transitions[0]
    if (!base || base.document.mapMode !== 'scene' || !transition) { setTerrainLocalError('当前工程没有可用的地形过渡范围。'); return }
    const reason = workspaceTransitionReason({ ...transientRef.current(), terrainPreview: !!localGenerationPreviewRef.current || localGenerationDraftRef.current || !!volcanoPreviewRef.current || !!forestPreviewRef.current || volcanoDraft || forestDraft || !!interiorPreviewRef.current || interiorDraft || !!terrainPreviewRef.current })
    if (reason) { setTerrainLocalError(reason); return }
    cancelTerrainLocal()
    setTerrainLocalBusy(true); setTerrainLocalError(null)
    try {
      const preview = await compositionWorkspace.previewTerrainLocalRefresh({ sceneId: base.document.sceneId, scopeMm: transition.distanceSource.clipMm, transitionIds: [transition.id] })
      terrainLocalPreviewRef.current = preview; setTerrainLocalPreview(preview); setSelected(null)
    } catch (failure) { setTerrainLocalError(failure instanceof Error ? failure.message : String(failure)) }
    finally { setTerrainLocalBusy(false) }
  }
  const adoptTerrainLocal = async () => {
    const preview = terrainLocalPreviewRef.current
    if (!preview || busy || terrainLocalBusy) return
    await action(async () => {
      const adopted = await compositionWorkspace.adoptTerrainLocalRefresh(preview)
      terrainLocalPreviewRef.current = null; setTerrainLocalPreview(null); setSelected(null); setSessionGeneration(value => value + 1)
      try { await adopted.save; setMessage('已保护并采用局部地形联动；本地保存完成，可整笔撤销。') }
      catch (failure) { setMessage(`局部地形联动已采用，保存失败；当前成果仍可撤销。${failure instanceof Error ? failure.message : String(failure)}`) }
    }, '采用局部地形联动')
  }
  const cancelRegional = () => {
    regionalEpoch.current++; regionalAbort.current?.abort(); regionalAbort.current = null
    if (regionalPreviewRef.current) compositionWorkspace.cancelRegional(regionalPreviewRef.current)
    regionalPreviewRef.current = null; setRegionalPreview(null); setRegionalBusy(false); setRegionalError(null); setRegionalDraft(false); setRegionalReset(value => value + 1)
  }
  const receiveAiRegionalPreview = (next: RegionalPreview | null) => {
    const current = regionalPreviewRef.current
    if (current) compositionWorkspace.cancelRegional(current)
    regionalPreviewRef.current = next
    setRegionalPreview(next)
    setRegionalError(null)
    setRegionalBusy(false)
    if (next) {
      setRegionalDraft(false)
      setAudience('gm')
      setSidebar('scene')
      setSelected(null)
      setFitRequest(value => value + 1)
    }
  }
  useEffect(() => () => { regionalEpoch.current++; regionalAbort.current?.abort(); if (regionalPreviewRef.current) compositionWorkspace.cancelRegional(regionalPreviewRef.current) }, [])
  useEffect(() => { if (regionalPreviewRef.current && regionalPreviewRef.current.checkpoint !== compositionWorkspace.checkpoint()) cancelRegional() }, [completeProject?.document.sceneId, completeProject?.document.revision, sessionGeneration])
  const previewRegional = async (kind: 'create' | 'edit' | 'drillDown', input: RegionalCreateUiRequest | RegionalEditRequest | RegionalDrillDownUiRequest) => {
    if (regionalBusy || busy || audience !== 'gm') return
    const reason = workspaceTransitionReason({ ...transientRef.current(), terrainPreview: !!localGenerationPreviewRef.current || localGenerationDraftRef.current || !!volcanoPreviewRef.current || !!forestPreviewRef.current || volcanoDraft || forestDraft || !!interiorPreviewRef.current || interiorDraft || !!terrainPreview || !!terrainEditPreview || terrainEditDraft })
    if (reason) { setRegionalError(reason); return }
    if (regionalPreviewRef.current) compositionWorkspace.cancelRegional(regionalPreviewRef.current)
    regionalPreviewRef.current = null; setRegionalPreview(null)
    const epoch = ++regionalEpoch.current, checkpoint = compositionWorkspace.checkpoint(), abort = new AbortController()
    regionalAbort.current = abort; setRegionalBusy(true); setRegionalError(null)
    try {
      let next: RegionalPreview
      if (kind === 'create') {
        const base = await createRegionalBlankProject({}, abort.signal)
        abort.signal.throwIfAborted(); compositionWorkspace.assertCheckpoint(checkpoint)
        next = await compositionWorkspace.previewRegionalCreate(base, input as RegionalCreateUiRequest, { signal: abort.signal })
      } else if (kind === 'edit') next = await compositionWorkspace.previewRegionalEdit(input as RegionalEditRequest, { signal: abort.signal })
      else {
        const sceneBase = await createRefinedBlankProject('coast', { title: '区域下钻材质基线', widthMm: 24000, heightMm: 18000, preset: 'narrative', gridVisible: false, sceneId: runtime.ids.nextId() }, abort.signal)
        abort.signal.throwIfAborted(); compositionWorkspace.assertCheckpoint(checkpoint)
        next = await compositionWorkspace.previewRegionalDrillDown(sceneBase, input as RegionalDrillDownUiRequest, { signal: abort.signal })
      }
      if (epoch !== regionalEpoch.current || abort.signal.aborted || checkpoint !== compositionWorkspace.checkpoint()) { compositionWorkspace.cancelRegional(next); return }
      regionalPreviewRef.current = next; setRegionalPreview(next); setSelected(null); setAudience('gm'); setFitRequest(value => value + 1)
    } catch (error) { if (epoch === regionalEpoch.current && !abort.signal.aborted) setRegionalError(error instanceof Error ? error.message : String(error)) }
    finally { if (epoch === regionalEpoch.current) { regionalAbort.current = null; setRegionalBusy(false) } }
  }
  const adoptRegional = async () => {
    const next = regionalPreviewRef.current
    if (!next || busy || regionalBusy) return
    await action(async () => {
      const adopted = await compositionWorkspace.adoptRegional(next)
      regionalPreviewRef.current = null; setRegionalPreview(null); setRegionalDraft(false); setRegionalReset(value => value + 1); setSelected(null); setSessionGeneration(value => value + 1)
      try { await adopted.save; setMessage(next.kind === 'edit' ? '已保护并采用区域修改，本地保存完成。' : '独立地图已完整保存并打开。') }
      catch (error) { setMessage('区域修改已采用，本地保存失败；当前成果仍可撤销。' + (error instanceof Error ? error.message : String(error))) }
    }, '采用区域候选')
  }
  const compareRegional = async () => {
    const current = compositionWorkspace.getState().project, link = Object.values(getLegacyGeneration(current?.document ?? {})?.sourceLinks ?? {})[0]
    if (!current || !link || busy || regionalBusy) return
    await action(async () => {
      const checkpoint = compositionWorkspace.checkpoint(), bundle = await projectRepository.load(link.sourceSceneId)
      const parent = bundle ? await fromBundle(bundle, validation) : null
      const result = await compareRegionalSource(current, parent, { runtime, validation })
      compositionWorkspace.assertCheckpoint(checkpoint); setRegionalComparison(result)
    }, '比较区域来源')
  }
  const openVisualNewScene = () => { if (!guard()) return; openNewScene(); setVisualNewScene(true) }
  const requestImport = () => { if (guard()) file.current?.click() }
  const leave = async (): Promise<boolean> => {
    if (!guard()) return false
    actionPending.current = true; setBusy(true)
    const checkpoint = compositionWorkspace.checkpoint()
    try {
      await compositionWorkspace.flush(); compositionWorkspace.assertCheckpoint(checkpoint)
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
      void action(async () => { const checkpoint = compositionWorkspace.checkpoint(); await compositionWorkspace.flush(); compositionWorkspace.assertCheckpoint(checkpoint); if (requested.saved !== false) await compositionWorkspace.openPersisted(requested.project, checkpoint); else await compositionWorkspace.adoptNew(requested.project, checkpoint); setSessionGeneration(value => value + 1); setAudience('gm'); setSelected(null) }, '打开工程')
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
      const { visualPalette = 'original', ...blankOptions } = options
      const prepared = await (visualNewScene ? visualPalette === 'original' ? createVisualBlankProject(blankOptions, abort.signal) : createRefinedBlankProject(visualPalette, blankOptions, abort.signal) : createBlankProject(blankOptions, abort.signal))
      abort.signal.throwIfAborted(); compositionWorkspace.assertCheckpoint(checkpoint)
      creatingStageRef.current = 'saving'; setCreatingStage('saving')
      abort.signal.throwIfAborted(); await compositionWorkspace.adoptNew(prepared, checkpoint)
      setNewScene(false); setSelected(null); setAudience('gm')
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
    if (!project || !completeProject) return
    const completingPrefab = Array.isArray(input) && input.every(command => command.type === 'instantiatePrefab' && command.definitionRef.id === prefabPlacement)
    if (!guard([...(completingPrefab ? ['prefabPlacement' as const] : []), ...(form ? [form] : [])])) return
    void action(async () => {
      const commands = typeof input === 'function' ? input() : input
      const checkpoint = structure?.checkpoint ?? compositionWorkspace.checkpoint()
      compositionWorkspace.assertCheckpoint(checkpoint)
      const prepared = await compositionWorkspace.preview(commands)
      if (structure) compositionWorkspace.cancelPreview(structure.prepared)
      const visual = commands.filter(isVisualCommand)
      const impact = visual.length ? inspectVisualChanges(completeProject.document, prepared.document, visual) : null
      setStructure({ prepared, checkpoint, commands, document: prepared.document, description, ...(impact ? { kind: 'visual' as const, scopeIds: impact.affectedIds, layerIds: impact.layerIds, confirmed: false } : commands.every(command => command.type === 'setSceneDisplay') ? { kind: 'display' as const } : scopeIds ? { kind: 'layer' as const, scopeIds } : {}) })
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
  const previewDressing = () => {
    if (!completeProject || audience !== 'gm' || !guard()) return
    void action(async () => {
      const checkpoint = compositionWorkspace.checkpoint(), abort = new AbortController(); controller.current = abort
      try {
        let catalogProject = completeProject
        const definitions = Object.values(completeProject.document.propDefinitions).filter(def => def.catalogId.startsWith('prop.sceneweave.terrain-dressing.'))
        if (definitions.length !== 6) {
          const { createTerrainDressingCatalogProject } = await import('../../platform/browser/content/terrain-dressing-catalog')
          const provider = await createTerrainDressingCatalogProject(abort.signal), entries: PreparedCatalogEntryV1[] = []
          for (const item of describeCatalogItems(provider).filter(item => item.selector.kind === 'prop')) entries.push(await prepareCatalogEntry(provider, item.selector, abort.signal))
          catalogProject = (await prepareCatalogAdoption(completeProject, entries, abort.signal)).project
        }
        abort.signal.throwIfAborted(); compositionWorkspace.assertCheckpoint(checkpoint)
        const result = await compositionWorkspace.previewTerrainDressing(catalogProject, { sceneId: completeProject.document.sceneId, floorId: Object.keys(completeProject.document.floors)[0], seed: 'terrain-dressing-0' }, { checkpoint, signal: abort.signal })
        const prepared = result.preview, commands = [...prepared.commands], before = completeProject.document, after = prepared.document
        if (abort.signal.aborted) { compositionWorkspace.cancelPreview(prepared); abort.signal.throwIfAborted() }
        const visual = commands.filter(isVisualCommand), visualImpact = visual.length ? inspectVisualChanges(before, after, visual) : null
        const roots = commands.flatMap(command => 'id' in command ? [command.id] : 'areaId' in command ? [command.areaId] : 'groupId' in command ? [command.groupId] : [])
        const outdoorImpact = inspectOutdoorChanges(before, after, roots)
        setStructure({ prepared, checkpoint, commands, document: after, description: `地形层次与布景 · 展开 ${result.cost.total}/256`, kind: 'visual', scopeIds: [...new Set([...outdoorImpact.affectedIds, ...(visualImpact?.affectedIds ?? [])])], layerIds: [...new Set([...outdoorImpact.layerIds, ...(visualImpact?.layerIds ?? [])])], confirmed: false })
        setMessage([...result.report.notes, ...(result.report.preservedIds.length ? [`已保留 ${result.report.preservedIds.length} 项锁定或人工内容。`] : [])].join(' '))
      } finally { if (controller.current === abort) controller.current = null }
    }, '层次与布景候选未通过，工程未修改')
  }
  const previewDecorationSources = (definitionIds: string[]) => {
    if (!completeProject || audience !== 'gm' || !guard('outdoorForm')) return
    const requested = [...definitionIds]
    void action(async () => {
      const checkpoint = compositionWorkspace.checkpoint(), abort = new AbortController(); controller.current = abort
      try {
        const provider = await createTerrainVariantCatalogProject(abort.signal), entries: PreparedCatalogEntryV1[] = []
        for (const item of describeCatalogItems(provider).filter(item => item.selector.kind === 'prop' && requested.includes(item.selector.definitionId))) entries.push(await prepareCatalogEntry(provider, item.selector, abort.signal))
        if (entries.length !== requested.length) throw new Error('所选固定素材来源不完整，未准备候选。')
        const candidate = (await prepareCatalogAdoption(completeProject, entries, abort.signal)).project
        abort.signal.throwIfAborted(); compositionWorkspace.assertCheckpoint(checkpoint)
        const prepared = await compositionWorkspace.previewPrepared(candidate, '簇状布景固定素材入库', checkpoint)
        if (abort.signal.aborted) { compositionWorkspace.cancelPreview(prepared); abort.signal.throwIfAborted() }
        finishFormDraft('outdoorForm')
        setStructure({ prepared, checkpoint, commands: [], document: prepared.document, description: `簇状布景固定素材 · ${requested.length} 项`, kind: 'outdoor', scopeIds: requested, layerIds: [], confirmed: false })
      } finally { if (controller.current === abort) controller.current = null }
    }, '固定素材未准备，工程未修改')
  }
  const previewDecorations = (input: SceneCommand[], description: string, form: 'outdoorForm' | 'outdoorInspector' = 'outdoorForm', includeSources = false, exactSources = false) => {
    if (!completeProject || audience !== 'gm' || !guard(form)) return
    const commands = captureJson(input)
    void action(async () => {
      const checkpoint = compositionWorkspace.checkpoint(), abort = new AbortController(); controller.current = abort
      try {
        let catalog = completeProject
        if (includeSources) {
          const requested = new Set(commands.flatMap(command => command.type === 'createDecorationCluster' ? command.palette.map(row => row.definitionRef.id) : command.type === 'paintSurfaceVegetation' ? command.palette.map(row => row.definitionRef.id) : command.type === 'addProp' ? [command.definitionRef.id] : []))
          const missing = [...requested].filter(id => exactSources || !completeProject.document.propDefinitions[id])
          if (missing.length) {
            const provider = await createTerrainVariantCatalogProject(abort.signal), entries: PreparedCatalogEntryV1[] = []
            for (const item of describeCatalogItems(provider).filter(item => item.selector.kind === 'prop' && missing.includes(item.selector.definitionId))) entries.push(await prepareCatalogEntry(provider, item.selector, abort.signal))
            if (entries.length !== missing.length) throw new Error('所选固定素材来源不完整，未准备布景候选。')
            catalog = (await prepareCatalogAdoption(completeProject, entries, abort.signal)).project
          }
        }
        abort.signal.throwIfAborted(); compositionWorkspace.assertCheckpoint(checkpoint)
        const prepared = includeSources ? await compositionWorkspace.previewCatalogCommands(catalog, commands, { checkpoint, signal: abort.signal }) : await compositionWorkspace.preview(commands)
        if (abort.signal.aborted) { compositionWorkspace.cancelPreview(prepared); abort.signal.throwIfAborted() }
        const impact = inspectDecorationChanges(completeProject.document, prepared.document)
        const surfaceImpact = commands.some(isSurfaceRuleCommand) ? inspectSurfaceRuleChanges(completeProject.document, prepared.document) : null
        const outdoorRoots = commands.flatMap(command => command.type === 'addProp' || command.type === 'updateTerrainConnection' ? [command.id] : [])
        const outdoorImpact = outdoorRoots.length ? inspectOutdoorChanges(completeProject.document, prepared.document, outdoorRoots) : null
        const visualCommands = commands.filter(isVisualCommand), visualImpact = visualCommands.length ? inspectVisualChanges(completeProject.document, prepared.document, visualCommands) : null
        const counts = commands.flatMap(command => {
          if (command.type === 'paintSurfaceVegetation') {
            const rule = prepared.document.surfaceRules?.[command.id], cluster = rule && rule.field !== 'material' ? prepared.document.decorationClusters?.[rule.clusterId] : undefined
            if (!rule || !cluster || rule.field === 'material') return []
            const estimated = estimateSurfaceRegionInstances(prepared.document, cluster.palette, { polygons: rule.regionsMm.map(region => ({ outer: region.outerMm, holes: region.holesMm })), coveragePpm: rule.coveragePpm })
            const actual = Object.values(cluster.members).filter(member => member.entityId && member.state !== 'detached' && member.state !== 'deleted').length
            return [`${rule.supportRef.id}：区域植被预计${estimated}件，候选${actual}件`]
          }
          if (command.type === 'updateSurfaceVegetation') {
            const rule = prepared.document.surfaceRules?.[command.id], cluster = rule && rule.field !== 'material' ? prepared.document.decorationClusters?.[rule.clusterId] : undefined
            if (!rule || !cluster || rule.field === 'material') return []
            const estimated = estimateSurfaceRegionInstances(prepared.document, cluster.palette, { polygons: rule.regionsMm.map(region => ({ outer: region.outerMm, holes: region.holesMm })), coveragePpm: rule.coveragePpm })
            const actual = Object.values(cluster.members).filter(member => member.entityId && member.state !== 'detached' && member.state !== 'deleted').length
            return [`${rule.supportRef.id}：区域植被预计${estimated}件，候选${actual}件`]
          }
          if (command.type !== 'createDecorationCluster') return []
          const cluster = prepared.document.decorationClusters![command.id]
          const actual = Object.values(cluster.members).filter(member => member.entityId && member.state !== 'detached' && member.state !== 'deleted').length

          return [`${cluster.supportRef.id}：${actual}/${cluster.maxInstances}件`]
        })
        if (commands.some(command => command.type === 'addProp')) counts.unshift(`高台固定植被：${commands.filter(command => command.type === 'addProp').length}件`)
        finishFormDraft(form)
        setStructure({ prepared, checkpoint, commands, document: prepared.document, description: [description, ...counts, includeSources ? prepared.description : ''].filter(Boolean).join(' · '), kind: 'outdoor', scopeIds: [...new Set([...impact.affectedIds, ...(surfaceImpact?.affectedIds ?? []), ...(outdoorImpact?.affectedIds ?? []), ...(visualImpact?.affectedIds ?? [])])], layerIds: [...new Set([...impact.layerIds, ...(surfaceImpact?.layerIds ?? []), ...(outdoorImpact?.layerIds ?? []), ...(visualImpact?.layerIds ?? [])])], confirmed: false,
          selectionAfterAdopt: commands.length === 1 && commands[0].type === 'createDecorationCluster' ? commands[0].id : undefined })
      } finally { if (controller.current === abort) controller.current = null }
    }, '布景候选未通过，工程未修改')
  }

  const previewIslandDressing = (mode?: 'cliff' | 'surface') => {
    if (!completeProject || !guard()) return
    try {
      const plan = mode === 'cliff'
        ? buildIslandCliffDetailCommands(completeProject.document, { nextId: runtime.ids.nextId })
        : mode === 'surface'
          ? buildIslandSurfaceDressingCommandsV1(completeProject.document, { nextId: runtime.ids.nextId, appearance: completeProject.appearance })
          : buildIslandDressingCommandsV2(completeProject.document, { nextId: runtime.ids.nextId, appearance: completeProject.appearance })
      const includeSources = mode !== 'cliff'
      previewDecorations(plan.commands, plan.report, 'outdoorForm', includeSources, includeSources)
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)) }
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
        singleAssetDraft.current=false;syncAssetDraft()
      } finally { if (controller.current === abort) controller.current = null }
    }, '素材导入未采用')
  }
  const invalidateAssetBatch=()=>{
    const current=structureRef.current
    if(current?.assetBatch){compositionWorkspace.cancelPreview(current.prepared);structureRef.current=null;setStructure(null)}
  }
  const importAssetBatch=async(requests:AssetImportRequest[],signal:AbortSignal):Promise<AssetBatchReview>=>{
    if(!completeProject||audience!=='gm'||!guard('assetImportForm'))throw new Error('当前工程或编辑状态不允许准备素材批次。')
    if(actionPending.current)throw new Error('另一个工程操作尚未完成。')
    const checkpoint=compositionWorkspace.checkpoint(),abort=new AbortController(),cancel=()=>abort.abort()
    signal.addEventListener('abort',cancel,{once:true});if(signal.aborted)abort.abort()
    actionPending.current=true;setBusy(true);setMessage(null);controller.current=abort
    let prepared:CompositionPreview|undefined
    try{
      const result=await prepareAssetBatchImport(completeProject,requests,{runtime,validation,signal:abort.signal})
      abort.signal.throwIfAborted();compositionWorkspace.assertCheckpoint(checkpoint)
      prepared=await compositionWorkspace.previewPrepared(result.project,`批量素材入库 · ${requests.length} 项`,checkpoint)
      const images=new Map<string,Blob>(),items:AssetBatchReview['items']=[]
      for(const item of result.items){
        abort.signal.throwIfAborted()
        let thumbnail=images.get(item.sha256)
        if(!thumbnail){const bytes=await result.project.resources.read(item.sha256),copy=new Uint8Array(bytes.length);copy.set(bytes);thumbnail=new Blob([copy],{type:'image/png'});images.set(item.sha256,thumbnail)}
        items.push({...item,thumbnail})
      }
      abort.signal.throwIfAborted();compositionWorkspace.assertCheckpoint(checkpoint)
      const next:StructurePreview={prepared,checkpoint,commands:[],document:prepared.document,description:`批量导入 ${requests.length} 项 · 新增 ${result.addedDefinitionIds.length} 个定义 · 完整新增记录 ${result.operationCost}/256`,assetBatch:{count:requests.length,addedDefinitions:result.addedDefinitionIds.length,operationCost:result.operationCost}}
      structureRef.current=next;setStructure(next)
      batchAssetDraft.current=false;syncAssetDraft()
      return {items,addedDefinitions:result.addedDefinitionIds.length,uniqueImageBytes:result.uniqueImageBytes}
    }catch(error){if(prepared)compositionWorkspace.cancelPreview(prepared);setMessage(`素材批次未采用：${error instanceof Error?error.message:String(error)}`);throw error}
    finally{signal.removeEventListener('abort',cancel);if(controller.current===abort)controller.current=null;actionPending.current=false;setBusy(false)}
  }
  const adoptCatalog = async (input: PreparedCatalogEntryV1[] | ((signal: AbortSignal) => Promise<PreparedCatalogEntryV1[]>), signal?: AbortSignal) => {
    // The catalog owns its own pending flag; all other scene tools/drafts still guard adoption.
    const reason = workspaceTransitionReason({ ...transientRef.current(), busy: busy || localGenerationBusy || volcanoBusy || forestBusy || interiorBusy || actionPending.current })
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
      for (const command of commands) if (command.type === 'setCanvasBounds') for (const id of Object.keys(before.entityLayers)) affected.add(id)
      for (const command of commands) if (command.type === 'setEntranceOpenings') for (const id of [...before.constraints.entranceOpeningIds, ...document.constraints.entranceOpeningIds]) affected.add(id)
      const impact = inspectBuildingChanges(before, document, [...affected])
      if (!impact.affectedIds.length && JSON.stringify(before.constraints) === JSON.stringify(document.constraints) && JSON.stringify(before.exportBoundsMm) === JSON.stringify(document.exportBoundsMm) && JSON.stringify(before.floors) === JSON.stringify(document.floors)) throw new Error('参数与当前工程一致，无需采用。')
      setStructure({ prepared, checkpoint, commands, document, description, kind: 'building', scopeIds: impact.affectedIds, layerIds: impact.layerIds, confirmed: false })
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
      const decorationEdit = ids.some(id => project.document.decorations?.[id] || project.document.decorationClusters?.[id]) || Object.values(project.document.decorationClusters ?? {}).some(group => Object.values(group.members).some(member => member.entityId && ids.includes(member.entityId)))
      const scatterEdit = decorationEdit || Object.values(project.document.scatterGroups).some(group => ids.includes(group.id) || Object.values(group.members).some(member => member.propId !== null && ids.includes(member.propId)))
      if (!scatterEdit && (kind === 'lock' || kind === 'unlock')) { await compositionWorkspace.execute(commands); return }
      const prepared = await compositionWorkspace.preview(commands)
      finishFormDraft('selectionForm')
      const impact = decorationEdit ? inspectDecorationChanges(completeProject!.document, prepared.document) : scatterEdit ? inspectOutdoorChanges(completeProject!.document, prepared.document, ids) : null
      setStructure({ prepared, checkpoint, commands, document: prepared.document, kind: impact ? 'outdoor' : 'batch', description: `${{ move: '批量移动', rotate: '批量旋转', delete: '删除所选', copy: '复制所选', lock: '锁定所选', unlock: '解锁所选' }[kind]} · ${ids.length} 个选择单元`, ...(impact ? { scopeIds: impact.affectedIds, layerIds: impact.layerIds, confirmed: false } : {}) })
    }, '整批未采用，工程未修改')
  }
  const beginFillCopy = (sourceId: string, count: number, allowOverlap: boolean) => {
    if (!completeProject || audience !== 'gm' || !guard()) return
    if (!Number.isSafeInteger(count) || count < 1 || count > 256) { setMessage('填充数量须为 1–256；实际展开预算仍会完整复核。'); return }
    setFillCopy({ sourceId, count, allowOverlap, checkpoint: compositionWorkspace.checkpoint() })
    setMessage('拖动画布中的填充柄，设置副本间距和方向；Escape 可取消。')
  }
  const prepareFillCandidate = async (request: FillCopyRequest, checkpoint: number) => {
    const result = await compositionWorkspace.previewFillCopy(request, { checkpoint })
    setStructure({ prepared: result.preview, checkpoint, commands: [...result.preview.commands], document: result.preview.document,
      description: `填充复制 · ${request.count} 件`, kind: 'fill-copy', fillCopy: { report: result.report, cost: result.cost } })
  }
  const previewNumericFillCopy = (sourceId: string, count: number, allowOverlap: boolean, stepMm: PointMm) => {
    if (!completeProject || audience !== 'gm' || !guard()) return
    const checkpoint = compositionWorkspace.checkpoint()
    void action(() => prepareFillCandidate({ sourceId, count, stepMm, allowOverlap }, checkpoint), '填充复制未生成候选，工程未修改')
  }
  const finishFillCopy = (stepMm: PointMm, report: FillCopyReport) => {
    const active = fillCopy
    if (!active) return
    setFillCopy(null)
    if (report.issues.length) { setMessage(`填充复制未生成候选：${report.issues.join('；')}`); return }
    const request: FillCopyRequest = { sourceId: active.sourceId, count: active.count, stepMm, allowOverlap: active.allowOverlap }
    void action(() => prepareFillCandidate(request, active.checkpoint), '填充复制未生成候选，工程未修改')
  }
  const cancelStructurePreview = () => {
    if (!structure) return
    compositionWorkspace.cancelPreview(structure.prepared)
    setStructure(null)
  }
  const adoptStructurePreview = () => {
    const candidate = structure
    if (!candidate) return
    void action(async () => {
      try {
        await compositionWorkspace.adoptPreview(candidate.prepared)
        if (candidate.assetBatch) { await compositionWorkspace.flush(); finishFormDraft('assetImportForm', true) }
        setStructure(null)
        if (candidate.selectionAfterAdopt !== undefined) setSelected(candidate.selectionAfterAdopt)
      } catch (error) { compositionWorkspace.cancelPreview(candidate.prepared); setStructure(null); throw error }
    }, candidate.fillCopy ? '采用填充复制' : '采用候选')
  }
  const openMenu = (point: PointMm, hits: string[], position: { x: number; y: number }, origin: HTMLElement) => {
    if (!project || audience !== 'gm' || !guard()) return
    const currentIds = selectionSession.getSnapshot(), retained = !!hits[0] && currentIds.includes(hits[0]), ids = hits.length && !retained ? [hits[0]] : [...currentIds]
    if (!retained && hits.length) selectionSession.set(ids)
    setMenu({ ...position, point, hits, ids, checkpoint: compositionWorkspace.checkpoint(), origin, blank: !hits.length })
  }
  const closeMenu = (restore = false) => { const origin = menu?.origin; setMenu(null); if (restore) requestAnimationFrame(() => origin?.isConnected && origin.focus({ preventScroll: true })) }
  const visibleCompleteProject = useMemo(() => localGenerationPreview?.project ?? volcanoPreview?.project ?? forestPreview?.project ?? interiorPreview?.project ?? regionalPreview?.project ?? terrainLocalPreview?.project ?? terrainEditPreview?.project ?? (aiShown ? aiPreview!.project : terrainPreview?.project ?? structureRestore?.project ?? restore?.project ?? (structure?.prepared.project ?? completeProject)), [completeProject, structure, restore, structureRestore, aiShown, aiPreview, terrainPreview, terrainEditPreview, terrainLocalPreview, regionalPreview, interiorPreview, forestPreview, volcanoPreview, localGenerationPreview])
  const renderProject = useMemo(() => visibleCompleteProject ? visibleCompleteProject : null, [visibleCompleteProject])
  const visibleProject = useMemo(() => renderProject ? domainProject(renderProject) : null, [renderProject])
  const baseMapPreview = terrainPreview?.continuationSource ? terrainPreview : undefined
  const baseMapGenerationBudget = terrainPreview?.continuationSource?.response.generationBudget
  const authoringProject = baseMapPreview?.project ?? completeProject
  const authoringLayerId = authoringProject?.document.userLayers[currentLayerId] ? currentLayerId : Object.keys(authoringProject?.document.userLayers ?? {})[0] ?? ''
  const canPrepareAuthoring = () => {
    if (!baseMapPreview) return guard()
    if (terrainPreviewRef.current !== baseMapPreview || baseMapPreview.checkpoint !== compositionWorkspace.checkpoint()) return false
    const reason = workspaceTransitionReason({ ...transientRef.current(), terrainPreview: !!localGenerationPreviewRef.current || localGenerationDraftRef.current || !!volcanoPreview || !!forestPreview || volcanoDraft || forestDraft || !!interiorPreview || interiorDraft || !!terrainEditPreview || terrainEditDraft || !!terrainLocalPreview || !!regionalPreview || regionalDraft })
    if (reason) { setMessage(reason); return false }
    return true
  }
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
      const points = current.kind !== 'polygon' && current.kind !== 'orthogonal' && current.points.length >= 2 ? [point] : [...current.points, point]
      return { ...current, points, cursor: null }
    }), onMove: (point: PointMm) => setSketch(current => current && !(!['polygon', 'orthogonal'].includes(current.kind) && current.points.length >= 2) ? { ...current, cursor: point } : current),
  } : null
  const canvasWorldTool = terrainEditCanvas?.scopeTool ?? (outdoorSketch && audience === 'gm' ? { ...outdoorSketch, snapMm: project?.document.units.snapMm ?? 100, label: '室外草图 · 逐点取坐标 · Escape 退出',
    onCancel: () => setOutdoorSketch(null), onPoint: (point: PointMm) => setOutdoorSketch(current => current ? { ...current, points: current.purpose === 'connection' && current.points.length >= 2 ? [point] : [...current.points, point], cursor: null } : current),
    onMove: (point: PointMm) => setOutdoorSketch(current => current ? { ...current, cursor: point } : current),
  } : buildingWorldTool)
  const saveLabels = { empty: '尚未打开工程', saved: '本地已保存', unsaved: '等待保存', saving: '正在保存', error: '保存失败', conflict: '版本冲突' }
  const layerPanel = completeProject && audience === 'gm' ? <UserLayerPanel scene={completeProject.document} session={selectionSession}
    currentLayerId={currentLayerId} hiddenLayerIds={hiddenLayerIds} soloLayerId={soloLayerId} currentOnly={currentOnly}
    disabled={editDisabled} onCurrent={id => { if (guard()) setCurrentLayerId(id) }}
    onHidden={id => { if (guard()) setHiddenLayerIds(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next }) }}
    onSolo={id => { if (guard()) setSoloLayerId(current => current === id ? null : id) }} onScope={value => { if (guard()) setCurrentOnly(value) }}
    moveRequest={layerMoveRequest} onSelectLayer={selectLayer} onCommand={commands => commit(() => compositionWorkspace.execute(commands))} onPreview={preview}/> : null
  const panelKey = `${completeProject?.document.sceneId ?? 'empty'}-${sessionGeneration}`
  const openResources = (module: 'scene' | 'building' | 'library' | 'outdoor') => { setSidebar(module); revealPanel('resources') }
  const openHistory = () => { setNavigationTab('history'); revealPanel('navigation') }
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
  const historyBrowser = completeProject && <HistoryPanel key={panelKey} active={active && audience === 'gm' && navigationTab === 'history'} project={completeProject} repository={repository} workspace={compositionWorkspace}
            session={selectionSession} disabled={editDisabled} refreshBlocked={busy || state.status === 'unsaved' || state.status === 'saving'} refreshKey={historyRefresh} onAction={action} onPreview={setRestore} onStructurePreview={setStructureRestore} onBackup={backup}/>
  const sceneBrowser = <SelectionSubscriber session={selectionSession}>{ids => <SceneLibrary key={panelKey} project={audience === 'player' ? visibleProject : project}
    selected={ids.length === 1 ? ids[0] : null} selectedIds={[...ids]} busy={editDisabled} onSelect={select}/>}</SelectionSubscriber>
  const projectTools = <section className="workspace-project-tools" aria-label="工程与显示设置"><h2>工程</h2><p className="asset-muted">在同一画布中继续建筑、素材与室外创作。</p><button className="primary asset-wide" disabled={editDisabled} onClick={openNewScene}><Plus size={14}/>新建空白场景</button><button className="secondary asset-wide" disabled={editDisabled} onClick={requestImport}><Upload size={14}/>打开完整工程</button>{project && <p className="asset-muted">{project.document.title} · r{project.document.revision}</p>}{project && audience === 'gm' && <div onChangeCapture={() => markFormDraft('displayForm')}><SceneDisplayPanel key={`${project.document.sceneId}-${project.document.revision}-${formReset.displayForm}`} scene={completeProject!.document} disabled={toolDisabled(['displayForm'])} onPreview={(commands, label) => preview(commands, label, undefined, 'displayForm')}/></div>}{project && <details className="workspace-authoring-details" open={authoringOpen} onToggle={event => setAuthoringOpen(event.currentTarget.open)}><summary>分步制作 SCN-01 / SCN-04</summary>{authoringOpen && <AuthoringGuide project={completeProject!} disabled={editDisabled} onPreview={previewAuthoring} onAdoptRequiredCatalog={adoptAuthoringCatalog}/>}</details>}{completeProject && completeProject.document.mapMode === 'scene' && completeProject.document.generation && audience === 'gm' && <TerrainEditingPanel key={panelKey + '-terrain-edit-' + terrainEditReset} scene={completeProject.document} busy={terrainEditBusy || busy} adopting={busy} disabled={!!workspaceTransitionReason({ ...transient(), terrainPreview: !!localGenerationPreviewRef.current || localGenerationDraftRef.current || !!volcanoPreview || !!forestPreview || volcanoDraft || forestDraft || !!interiorPreview || interiorDraft || !!terrainPreview, busy: busy || localGenerationBusy || volcanoBusy || forestBusy || interiorBusy || terrainBusy || catalogBusy || aiCritical })} error={terrainEditError} candidate={terrainEditPreview?.result ?? null} onPreview={previewTerrainEditing} onAdopt={adoptTerrainEditing} onCancel={cancelTerrainEditing} onCanvasSession={setTerrainEditCanvas} onDraftChange={setTerrainEditDraft}/>}{audience === 'gm' && <RegionalPanel key={panelKey + '-regional-' + regionalReset} document={completeProject?.document ?? null} busy={regionalBusy || busy} disabled={!!workspaceTransitionReason({ ...transient(), terrainPreview: !!localGenerationPreviewRef.current || localGenerationDraftRef.current || !!volcanoPreview || !!forestPreview || volcanoDraft || forestDraft || !!interiorPreview || interiorDraft || !!terrainPreview || !!terrainEditPreview || terrainEditDraft, busy: busy || localGenerationBusy || volcanoBusy || forestBusy || interiorBusy || terrainBusy || terrainEditBusy || catalogBusy || aiCritical })} error={regionalError} candidate={regionalPreview} sourceComparison={regionalComparison} onPreviewCreate={input => previewRegional('create', input)} onPreviewEdit={input => previewRegional('edit', input)} onPreviewDrillDown={input => previewRegional('drillDown', input)} onCompareSource={compareRegional} onAdopt={adoptRegional} onCancel={cancelRegional} onDraftChange={setRegionalDraft}/>}{audience === 'gm' && completeProject && completeProject.document.mapMode === 'scene' && <button className="secondary asset-wide" disabled={editDisabled} onClick={previewDressing}>预览地形层次与布景</button>}{audience === 'gm' && completeProject && <IslandDressingPanel scene={completeProject.document} disabled={editDisabled} onPrepareSources={previewDecorationSources} onPreview={previewIslandDressing}/>}<GenerationExecutionSettings value={domainSettings} disabled={editDisabled || interiorBusy || forestBusy || volcanoBusy} onChange={value => { cancelInterior(false); cancelForest(false); cancelVolcano(false); setDomainSettings(value) }}/><InteriorGenerationPanel key={`interior-${interiorReset}`} busy={interiorBusy || busy} disabled={audience !== 'gm' || aiCritical || !!workspaceTransitionReason({ ...transient(), busy: busy || localGenerationBusy || volcanoBusy || forestBusy || terrainBusy || terrainEditBusy || regionalBusy || catalogBusy || aiCritical, terrainPreview: !!localGenerationPreviewRef.current || localGenerationDraftRef.current || !!volcanoPreview || !!forestPreview || volcanoDraft || forestDraft || !!terrainPreview || !!terrainEditPreview || terrainEditDraft || !!terrainLocalPreview || !!regionalPreview || regionalDraft })} dirty={interiorDraft} error={interiorError} candidate={interiorPreview} onChange={changeInterior} onGenerate={generateInterior} onAdopt={adoptInterior} onCancel={() => cancelInterior()}/><ForestGenerationPanel key={`forest-${forestReset}`} busy={forestBusy || busy} disabled={audience !== 'gm' || aiCritical || !!workspaceTransitionReason({ ...transient(), busy: busy || localGenerationBusy || volcanoBusy || interiorBusy || terrainBusy || terrainEditBusy || regionalBusy || catalogBusy || aiCritical, terrainPreview: !!localGenerationPreviewRef.current || localGenerationDraftRef.current || !!volcanoPreview || volcanoDraft || !!interiorPreview || interiorDraft || !!terrainPreview || !!terrainEditPreview || terrainEditDraft || !!terrainLocalPreview || !!regionalPreview || regionalDraft })} dirty={forestDraft} error={forestError} candidate={forestPreview} onChange={changeForest} onGenerate={generateForest} onAdopt={adoptForest} onCancel={() => cancelForest()}/><VolcanoGenerationPanel key={`volcano-${volcanoReset}`} busy={volcanoBusy || busy} disabled={audience !== 'gm' || aiCritical || !!workspaceTransitionReason({ ...transient(), busy: busy || localGenerationBusy || forestBusy || interiorBusy || terrainBusy || terrainEditBusy || regionalBusy || catalogBusy || aiCritical, terrainPreview: !!localGenerationPreviewRef.current || localGenerationDraftRef.current || !!forestPreview || forestDraft || !!interiorPreview || interiorDraft || !!terrainPreview || !!terrainEditPreview || terrainEditDraft || !!terrainLocalPreview || !!regionalPreview || regionalDraft })} dirty={volcanoDraft} error={volcanoError} candidate={volcanoPreview} onChange={changeVolcano} onGenerate={generateVolcano} onAdopt={adoptVolcano} onCancel={() => cancelVolcano()}/>{audience === 'gm' && completeProject && completeProject.document.mapMode === 'scene' && <LocalGenerationPanel key={`local-${completeProject.document.sceneId}-${completeProject.document.revision}-${localGenerationReset}`} document={completeProject.document} busy={localGenerationBusy || busy} disabled={!!workspaceTransitionReason({ ...transient(), busy: busy || volcanoBusy || forestBusy || interiorBusy || terrainBusy || terrainEditBusy || regionalBusy || catalogBusy || aiCritical, terrainPreview: !!volcanoPreview || volcanoDraft || !!forestPreview || forestDraft || !!interiorPreview || interiorDraft || !!terrainPreview || !!terrainEditPreview || terrainEditDraft || !!terrainLocalPreview || !!regionalPreview || regionalDraft })} dirty={localGenerationDraft} error={localGenerationError} candidate={localGenerationPreview} onChange={changeLocalGeneration} onPreview={previewLocalGeneration} onAdopt={adoptLocalGeneration} onCancel={() => cancelLocalGeneration()}/>}<BaseMapGenerationSettings value={baseMapSettings} disabled={editDisabled} onChange={setBaseMapSettings}/><TerrainCompositionPanel busy={terrainBusy||busy||aiCritical||localGenerationBusy||localGenerationDraft||!!localGenerationPreview||volcanoBusy||forestBusy||volcanoDraft||forestDraft||!!volcanoPreview||!!forestPreview||interiorBusy||interiorDraft||!!interiorPreview} candidate={terrainPreview?.composition?terrainPreview:null} onGenerate={generateComposition} onAdopt={adoptTerrain} onCancel={cancelTerrain} onExport={exportTerrain}/><TerrainGenerationPanel busy={terrainBusy || busy || aiCritical} error={terrainError} disabled={!terrainPreview && !terrainBusy && !!workspaceTransitionReason(transient())} disabledReason={workspaceTransitionReason(transient()) ?? undefined} candidate={terrainPreview && !terrainPreview.composition ? { id: terrainPreview.project.document.sceneId, name: terrainPreview.project.document.title, ...terrainPreview.input, terrainCount: Object.keys(terrainPreview.project.document.terrainAreas).length, propCount: Object.keys(terrainPreview.project.document.props).length, connectionCount: Object.keys(terrainPreview.project.document.terrainConnections).length, budgetProfile: terrainPreview.baseMap?.budgetProfile, cost: { ...terrainPreview.cost, items: Object.entries(terrainPreview.cost.items).filter(([, value]) => value > 0).map(([label, value]) => ({ label, value })) }, checks: [{ label: '活动空地与合法登高连接', status: 'passed', detail: '登高连接净宽 1.5 米；完整支撑与几何已检查。' }, ...(terrainPreview.result.route ? [{ label: '指定路线与完整转角净宽', status: 'passed' as const, detail: `净宽 ${terrainPreview.result.route.widthMm / 1000} 米；${terrainPreview.result.route.pointsMm.length - 1} 段道路已检查。` }] : [])] } : null} onGenerate={generateTerrain} onAdopt={adoptTerrain} onCancel={cancelTerrain} onExport={exportTerrain}/>{completeProject && completeProject.document.visual?.version === 3 && <><button className="secondary asset-wide" disabled={editDisabled || terrainLocalBusy} onClick={() => void previewTerrainLocal()}>预览局部地形联动</button>{terrainLocalError && <p className="asset-error" role="alert">{terrainLocalError}</p>}</>}<h3>视觉创作</h3><button className="secondary asset-wide" disabled={editDisabled} onClick={openVisualNewScene}>新建视觉空白 · 原创素材</button><h3>视觉创作样板</h3>{(['beach','island','interior'] as const).map(kind => <button key={kind} className="secondary asset-wide" disabled={editDisabled} onClick={() => prepare(signal => createVisualSampleProject(kind, signal), ({beach:'潮声浅湾',island:'苔冠岩岛',interior:'灯下旅舍'})[kind])}>{({beach:'潮声浅湾 · 连续海岸',island:'苔冠岩岛 · 高差与草沿',interior:'灯下旅舍 · 材质与灯光'})[kind]}</button>)}<button className="secondary asset-wide" disabled={editDisabled} onClick={() => prepare(signal => createRefinedIslandProject(signal), REFINED_ISLAND_NAME)}>岬湾苔岛 · 精修版</button><button className="secondary asset-wide" disabled={editDisabled} onClick={() => prepare(signal => createRefinedCoastProject(signal), REFINED_COAST_NAME)}>{REFINED_COAST_NAME}</button><button className="secondary asset-wide" disabled={editDisabled} onClick={() => prepare(signal => createRefinedInteriorProject(signal), REFINED_INTERIOR_NAME)}>{REFINED_INTERIOR_NAME}</button><button className="secondary asset-wide" disabled={editDisabled} onClick={() => prepare(signal => createNearSideIslandProject(signal), NEAR_SIDE_ISLAND_NAME)}>新建近侧视苔岛</button><h3>可编辑样板</h3><button className="secondary asset-wide" disabled={editDisabled} onClick={() => request({ type: 'sample', sample: 'study' })}>书房与露台</button><button className="secondary asset-wide" disabled={editDisabled} onClick={() => request({ type: 'sample', sample: 'island' })}>双层岩岛</button><button className="secondary asset-wide" disabled={editDisabled} onClick={() => request({ type: 'sample', sample: 'outpost' })}>海岸哨所</button><button className="secondary asset-wide" disabled={editDisabled} onClick={() => request({ type: 'sample', sample: 'graveyard' })}>苔石墓园 · 内容小样</button><button className="secondary asset-wide" disabled={editDisabled} onClick={() => request({ type: 'sample', sample: 'volcano' })}>灰烬熔脉 · 内容小样</button></section>
  const resourcePanels = <div className="layer-library-stack history-library-stack">
          <div className="history-sidebar-tabs" role="tablist" aria-label="工坊侧栏">
            <button role="tab" aria-selected={sidebar === 'scene' || audience === 'player'} onClick={() => setSidebar('scene')}><Layers3 size={14}/>工程</button>
            <button role="tab" aria-selected={sidebar === 'building' && audience === 'gm'} disabled={!completeProject || audience === 'player'} onClick={() => setSidebar('building')}><PencilRuler size={14}/>建筑</button>
            <button role="tab" aria-selected={sidebar === 'library' && audience === 'gm'} disabled={!completeProject || audience === 'player'} onClick={() => setSidebar('library')}><Layers3 size={14}/>素材库</button>
            <button role="tab" aria-selected={sidebar === 'outdoor' && audience === 'gm'} disabled={!completeProject || audience === 'player'} onClick={() => setSidebar('outdoor')}><PencilRuler size={14}/>室外</button>
            <button role="tab" aria-selected={sidebar === 'visual' && audience === 'gm'} disabled={!completeProject || audience === 'player'} onClick={() => setSidebar('visual')}><Mountain size={14}/>视觉</button>
            <button role="tab" aria-selected={sidebar === 'ai' && audience === 'gm'} disabled={audience === 'player'} onClick={() => setSidebar('ai')}>AI对话</button>
          </div>
          <div hidden={sidebar !== 'ai' || audience !== 'gm'}><SelectionSubscriber session={selectionSession}>{ids => <><AiConversationPanel
            context={completeProject ? { sceneId: completeProject.document.sceneId, revision: completeProject.document.revision, audience: 'public' } : null}
            disabled={volcanoBusy || forestBusy || volcanoDraft || forestDraft || !!volcanoPreview || !!forestPreview || interiorBusy || interiorDraft || !!interiorPreview || regionalBusy || regionalDraft || !!regionalPreview || busy || terrainBusy || terrainEditBusy || terrainEditDraft || !!terrainEditPreview || !!terrainPreview && !baseMapPreview || !!structure || !!restore || !!structureRestore || audience === 'player'}
            authoring={authoringProject ? { workspace: compositionWorkspace, sessionKey: sessionGeneration, project: authoringProject, baseMapPreview,
              selectedIds: baseMapPreview ? ids.filter(id => Object.hasOwn(authoringProject.document.props, id)) : ids, layerId: authoringLayerId, canPrepare: canPrepareAuthoring,
              onPreview: next => { setAiPreview(next); if (!next) setShowAiDraft(false) }, onRegionalPreview: receiveAiRegionalPreview,
              onAdopted: () => { setAiPreview(null); setShowAiDraft(false); if (baseMapPreview) { terrainPreviewRef.current = null; setTerrainPreview(null); setSelected(null); setSessionGeneration(value => value + 1) }; setHistoryRefresh(value => value + 1) }, onCritical: setAiCritical } : undefined}/></>}</SelectionSubscriber></div>
          <div hidden={sidebar !== 'outdoor' || audience !== 'gm'} onChangeCapture={() => markFormDraft('outdoorForm')} onClickCapture={event => { if ((event.target as HTMLElement).closest('.connection-route-fields button')) markFormDraft('outdoorForm') }}>{completeProject && <OutdoorToolsPanel key={`${panelKey}-${formReset.outdoorForm}`} scene={completeProject.document} layerId={currentLayerId}
            disabled={toolDisabled(['outdoorSketch', 'outdoorForm']) || effectiveHiddenLayers.has(currentLayerId)} sketch={outdoorSketch}
          onSketch={next => { if (!next) setOutdoorSketch(null); else if (guard('outdoorForm')) setOutdoorSketch(next) }} onPreview={previewOutdoor} onSelect={select} onBoundaryEditor={editConnectionForm}/>} {completeProject && <DecorationPanel key={`${panelKey}-${completeProject.document.revision}-${currentLayerId}-${formReset.outdoorForm}-decorations`} scene={completeProject.document} layerId={currentLayerId} disabled={toolDisabled(['outdoorForm']) || effectiveHiddenLayers.has(currentLayerId)} onPrepareSources={previewDecorationSources} onCreate={command => previewDecorations([command], '簇状布景', 'outdoorForm', true)} onCanvasBrushChange={setCanopyBrush} onDraftChange={dirty => dirty ? markFormDraft('outdoorForm') : finishFormDraft('outdoorForm')}   onPreview={(commands, label) => previewDecorations(commands, label)} onSelect={select}/>}</div>
          <div hidden={sidebar !== 'library' || audience !== 'gm'} onChangeCapture={event => { if ((event.target as HTMLElement).closest('.composition-import') && !(event.target as HTMLElement).closest('.asset-batch-import')) { singleAssetDraft.current=true; syncAssetDraft() } }}>{completeProject && (() => {
            const libraryProps = { project: completeProject, disabled: editDisabled, importDisabled: toolDisabled(['assetImportForm']), importResetKey: formReset.assetImportForm,
              onImportBatch: importAssetBatch, onAssetBatchDraftChange: onAssetBatchDraft, onInvalidateAssetBatch: invalidateAssetBatch, assetBatchPreviewActive: !!structure?.assetBatch, onPlace: choosePlacement, onPrefab: (id: string) => { if (guard()) setPrefabPlacement(id) }, onImport: importAsset,
              onMaterial: (id: string) => {
                if (!guard()) return
                const ids = selectionSession.getSnapshot()
                if (!ids.length || ids.some(target => !completeProject.document.rooms[target] && !completeProject.document.terrainAreas[target])) { setMessage('请先明确选择房间或地形表面，再应用材质。'); return }
                preview(ids.map(target => ({ type: 'setSurfaceMaterial', kind: completeProject.document.rooms[target] ? 'room' as const : 'terrainArea' as const, id: target, materialRef: { id, version: completeProject.document.materials[id].version } })), '将固定材质应用到所选表面')
              } }
            return <CatalogLibrary key={panelKey} {...libraryProps} builtinProject={builtinProject} builtinLoading={builtinLoading} builtinError={builtinError}
              onBuiltinDemand={requestBuiltin} variantsProject={variantsProject} variantsLoading={variantsLoading} variantsError={variantsError} onVariantsDemand={requestVariants}
              onAdopt={adoptCatalog} onPendingChange={onCatalogPending} onDraftChange={onCatalogDraft} organizationResetKey={formReset.catalogForm}/>
          })()}</div>
          <div hidden={sidebar !== 'building' || audience !== 'gm'} onChangeCapture={() => markFormDraft('buildingForm')}>{completeProject && <BuildingPanel key={`${panelKey}-${formReset.buildingForm}`} scene={completeProject.document} layerId={currentLayerId}
            disabled={toolDisabled(['sketch', 'buildingForm']) || effectiveHiddenLayers.has(currentLayerId)} sketch={sketch}
            onSketch={next => { if (!next) setSketch(null); else if (guard('buildingForm')) setSketch(next) }} onPreview={previewBuilding} onSelect={select}/>}</div>
          <div hidden={sidebar !== 'visual' || audience !== 'gm'} onChangeCapture={() => markFormDraft('visualForm')}>{completeProject && <SelectionSubscriber session={selectionSession}>{ids => <VisualPanel key={`${panelKey}-${completeProject.document.revision}-${formReset.visualForm}`} scene={completeProject.document} appearance={completeProject.appearance} layerId={currentLayerId} selectedIds={ids} disabled={toolDisabled(['visualForm'])} onPreview={(commands, label) => preview(commands, label, undefined, 'visualForm')}  onBoundaryEditor={setBoundaryEditor} onDraftChange={() => markFormDraft('visualForm')}/>}</SelectionSubscriber>}</div>
          <div hidden={sidebar !== 'scene' && audience === 'gm'}>{projectTools}</div>
        </div>
  const inspectorPanel = <SelectionSubscriber session={selectionSession}>{ids => {
    const selectedIds = ids, selected = ids.length === 1 ? ids[0] : null
    return <aside className="asset-inspector">
      {completeProject && audience === 'gm' && !restore && !structureRestore && <>
        <div onChangeCapture={() => markFormDraft('appearanceForm')}><AppearancePanel key={`${panelKey}-${formReset.appearanceForm}`} project={completeProject} ids={ids} layerId={currentLayerId} disabled={toolDisabled(['appearanceForm'])} onPreview={(commands, description) => preview(commands, description, undefined, 'appearanceForm')}/></div>
        <div onChangeCapture={() => markFormDraft('prefabForm')}><PrefabPanel key={`${panelKey}-${prefabPlacement ?? ''}-${formReset.prefabForm}`} project={completeProject} ids={ids} layerId={currentLayerId} placementDefinitionId={prefabPlacement} onSelect={select} disabled={toolDisabled(['prefabPlacement', 'prefabForm'])} onPreview={(commands, description) => preview(commands, description, undefined, 'prefabForm')}/></div>
      </>}
      {!restore && !structureRestore && project && selectedIds.length > 0 && audience === 'gm' && !placement && <button className="secondary asset-wide" disabled={busy || editingBlocked} onClick={event => {
        const b = event.currentTarget.getBoundingClientRect(), bounds = project.document.exportBoundsMm
        openMenu(project.document.props[selectedIds[0]]?.positionMm ?? { x: Math.round(bounds.x + bounds.width / 2), y: Math.round(bounds.y + bounds.height / 2) }, [...selectedIds], { x: b.left, y: b.bottom }, event.currentTarget)
      }}>更多操作</button>}
      {structureRestore ? <StructureRestoreChangesPanel preview={structureRestore} current={completeProject!}/>
        : restore ? <RestoreChangesPanel preview={restore} current={completeProject!}/>
          : project && placement && audience === 'gm' ? <PlacementInspector scene={project.document} prop={placement.prop} busy={busy} ready={placementReady} onChange={changes => setPlacement(current => current ? { ...current, prop: { ...current.prop, ...changes } } : null)} onPlace={() => placeAt(placement.prop.positionMm)} onCancel={() => setPlacement(null)}/>
            : visibleProject && selectedIds.length > 1 && audience === 'gm' ? <div onChangeCapture={() => markFormDraft('selectionForm')}><SelectionInspector key={`${panelKey}-${formReset.selectionForm}`} scene={project!.document} ids={selectedIds} summaryReader={selectionSummaryReader} busy={toolDisabled(['selectionForm'])} onAction={batchAction} onClear={() => select(null)}/></div>
              : completeProject && selected && audience === 'gm' && (completeProject.document.decorations?.[selected] || completeProject.document.decorationClusters?.[selected]) ? <div onChangeCapture={() => markFormDraft('outdoorInspector')}><DecorationInspector key={`${selected}-${completeProject.document.revision}-${formReset.outdoorInspector}`} scene={completeProject.document} id={selected} disabled={toolDisabled(['outdoorInspector'])} onPreview={(commands, label) => previewDecorations(commands, label, 'outdoorInspector')} onSelect={select}/></div>
                : completeProject && selected && audience === 'gm' && outdoorEntityKind(completeProject.document, selected) ? <div onChangeCapture={() => markFormDraft('outdoorInspector')} onClickCapture={event => { if ((event.target as HTMLElement).closest('.connection-route-fields button')) markFormDraft('outdoorInspector') }}><OutdoorInspector key={`${selected}-${completeProject.document.revision}-${formReset.outdoorInspector}`} scene={completeProject.document} id={selected} disabled={toolDisabled(['outdoorInspector'])} onPreview={(commands, label) => previewOutdoor(commands as OutdoorCommand[], label, undefined, 'outdoorInspector')} onSelect={select} onBoundaryEditor={editConnectionInspector}/></div>
                  : completeProject && selected && audience === 'gm' && (completeProject.document.rooms[selected] || completeProject.document.walls[selected] || completeProject.document.vertices[selected] || completeProject.document.openings[selected] || completeProject.document.notes[selected] || completeProject.document.regions[selected]?.kind === 'manualMask') ? <div onChangeCapture={() => markFormDraft('buildingInspector')}><BuildingInspector key={`${selected}-${completeProject.document.revision}-${formReset.buildingInspector}`} scene={completeProject.document} selected={selected} layerId={currentLayerId} disabled={toolDisabled(['buildingInspector'])} onPreview={(commands, label) => previewBuilding(commands, label, 'buildingInspector')} onSelect={select} onLock={(kind, id, locked) => commit(() => compositionWorkspace.execute([{ type: 'setEditLock', kind, id, locked }]))}/></div>
                    : completeProject && visibleProject && selected && audience === 'gm' ? <div onChangeCapture={event => { if (!(event.target as HTMLElement).closest('[data-fill-copy-settings]')) markFormDraft('propAppearanceForm') }}>
                        <SceneInspector key={`${selected}-${completeProject.document.revision}-${formReset.propAppearanceForm}`} project={completeProject} selected={selected} busy={toolDisabled(['propAppearanceForm'])} appearanceResetKey={formReset.propAppearanceForm} onAppearanceDraftChange={onPropAppearanceDraft} onFillCopy={beginFillCopy} onFillCopyNumeric={previewNumericFillCopy} fillCopyBusy={!!fillCopy} workspace={compositionWorkspace} onSelect={select} onCommit={commit} onPreview={(commands, description) => preview(commands, description, undefined, Array.isArray(commands) && commands.some(command => command.type === 'replacePropAppearance') ? 'propAppearanceForm' : undefined)} onPropCommand={(commands, description, selectionAfterCommit) => {
                          const scatterOwner = Object.values(completeProject.document.scatterGroups).find(group => Object.values(group.members).some(member => member.propId === selected))
                          if (!scatterOwner) { commit(async () => { await compositionWorkspace.execute(commands); if (selectionAfterCommit !== undefined) setSelected(selectionAfterCommit) }); return }
                          if (!commands.every(isOutdoorCommand)) { setMessage('散布成员修改包含不支持的室外操作。'); return }
                          previewOutdoor(commands as OutdoorCommand[], description, selectionAfterCommit)
                        }}/>
                      </div> : <>
          <div className="asset-section-heading"><Move size={16}/><h2>{audience === 'player' ? '玩家输出' : '工程信息'}</h2></div>
          {project ? <><h3>{project.document.activeStyleThemeRef ? '墨绘原野 · v1' : '用户图层 · 完整工程'}</h3><p className="asset-muted">{audience === 'player' ? '预览与 PNG 使用同一投影和绘制流程，私密内容在材质与阴影派生前过滤。' : '选择画面中的物件，或从左侧切换组合、散布与场景结构。全部素材、定义和许可随工程保存。'}</p>
            <dl className="asset-facts"><dt>场景修订</dt><dd>r{project.document.revision}</dd><dt>素材字节</dt><dd>{bytesLabel(Object.values(project.assets).reduce((sum, asset) => sum + asset.sizeBytes, 0))}</dd><dt>定义快照</dt><dd>{Object.keys(project.document.propDefinitions).length} 件物件 / {Object.keys(project.document.materials).length} 种材质</dd><dt>许可绑定</dt><dd>{project.licenseBindings.length} 条</dd></dl>
            {audience === 'gm' && <><h3>地面材质</h3>{Object.values(project.document.rooms).filter(room => room.floorStyle).map(room => <fieldset key={room.id} disabled={busy || editingBlocked || room.editLocked}><NumberInput label="木纹方向" value={room.floorStyle!.base.rotationDeg} unit="°" onCommit={rotation => commit(() => compositionWorkspace.rotateRoomMaterial(room.id, rotation))}/></fieldset>)}<button className="secondary asset-wide" disabled={busy || editingBlocked} onClick={() => void action(async () => {
              await validateProjectBundle(toBundle(completeProject!), validation)
              setMessage('完整工程校验通过：格式、历史身份、位图与许可一致。')
            }, '当前工程完整性检查')}><CheckCircle2 size={15}/>校验完整工程</button></>}
            {audience === 'gm' && project.document.presetSnapshot.presetId === 'sceneweave-vis02' && <TerrainTravelPanel scene={project.document} disabled={busy || editingBlocked}/>}
            {audience === 'gm' && completeProject?.document.presetSnapshot.presetId === OUTPOST_PRESET_ID && <OutpostTravelPanel scene={completeProject.document} disabled={busy || editingBlocked}/>}
          </> : <p className="asset-muted">新建空白场景，打开室内外样板，或导入完整工程。</p>}
          <div className="asset-next"><RotateCw size={16}/><strong>把场景保存完整</strong><p>工程文件携带素材、材质与许可。定期下载备份，继续编辑前可检查工程完整性。</p></div>
        </>}</aside> }}</SelectionSubscriber>
  const canvasPanel = <main className="asset-center">
          <div className="asset-view-bar"><div role="group" aria-label="预览受众" className="asset-audience"><button disabled={editDisabled} aria-pressed={audience === 'gm'} onClick={() => { if (guard()) setAudience('gm') }}>主持人</button><button disabled={editDisabled} aria-pressed={audience === 'player'} onClick={() => { if (guard()) { setAudience('player'); setGroundView(false); setSelected(null) } }}>玩家</button></div><div className="asset-view-actions"><span>{visibleProject ? `${formatDistanceMm(visibleProject.document.exportBoundsMm.width, visibleProject.document.units.display)} × ${formatDistanceMm(visibleProject.document.exportBoundsMm.height, visibleProject.document.units.display)} · 固定范围` : '二维俯视 · 毫米世界坐标'}</span>{project && audience === 'gm' && <button className="secondary" disabled={editDisabled} aria-pressed={groundView} onClick={() => setGroundView(value => !value)}>地面查看</button>}</div></div>
          {(localGenerationPreview || localGenerationBusy) && <div className="asset-structure-preview" role="status" aria-label="局部重生成候选状态"><div><strong>{localGenerationBusy ? '正在准备局部重生成' : '局部重生成候选 · 当前工程尚未改变'}</strong><span>在工程面板审阅完整写入和依赖，再保护并采用。</span></div><button className="secondary" disabled={busy} onClick={() => cancelLocalGeneration()}>取消局部候选</button></div>}
          {(volcanoPreview || volcanoBusy) && <div className="asset-structure-preview" role="status" aria-label="火山候选状态"><div><strong>{volcanoBusy ? '正在准备火山' : '火山候选 · 当前工程尚未改变'}</strong><span>在工程面板查看真实连接、路线及独立危险设置，再保存为新工程或取消。</span></div><button className="secondary" disabled={busy} onClick={() => cancelVolcano()}>取消火山预览</button></div>}
          {(forestPreview || forestBusy) && <div className="asset-structure-preview" role="status" aria-label="森林与营地候选状态"><div><strong>{forestBusy ? '正在准备森林与营地' : '森林与营地候选 · 当前工程尚未改变'}</strong><span>在工程面板查看空地、路线和实际植被数量，再保存为新工程或取消。</span></div><button className="secondary" disabled={busy} onClick={() => cancelForest()}>取消森林与营地预览</button></div>}
          {(interiorPreview || interiorBusy) && <div className="asset-structure-preview" role="status" aria-label="室内布局候选状态"><div><strong>{interiorBusy ? '正在准备室内布局' : '室内布局候选 · 当前工程尚未改变'}</strong><span>在工程面板查看房间实际净面积，再保存为新工程或取消。</span></div><button className="secondary" disabled={busy} onClick={() => cancelInterior()}>取消室内布局预览</button></div>}
          {(regionalPreview || regionalBusy) && <div className="asset-structure-preview" role="status" aria-label="区域候选状态"><div><strong>{regionalBusy ? '正在准备区域完整候选' : '区域候选 · 主工程尚未改变'}</strong><span>在工程面板审阅后采用或取消。</span></div><button className="secondary" disabled={busy} onClick={cancelRegional}>取消区域预览</button></div>}
          {(terrainEditPreview || terrainEditBusy) && <div className="asset-structure-preview" role="status" aria-label="局部地形候选"><div><strong>{terrainEditBusy ? '正在计算局部地形修改' : '局部地形候选 · 主工程尚未改变'}</strong><span>{terrainEditBusy ? '可取消计算，当前工程保持。' : '请在工程面板查看完整影响范围，再保护并采用。'}</span></div><button className="secondary" disabled={busy} onClick={cancelTerrainEditing}>取消局部地形预览</button></div>}
          {(terrainLocalPreview || terrainLocalBusy) && <div className="asset-structure-preview" role="status" aria-label="局部地形联动候选"><div><strong>{terrainLocalBusy ? '正在计算局部地形联动' : '局部地形联动候选 · 主工程尚未改变'}</strong><span>{terrainLocalBusy ? '正在读取过渡、素材和依赖闭包。' : `影响 ${terrainLocalPreview?.result.changedIds.length ?? 0} 项；范围外内容已保留。`}</span></div>{terrainLocalPreview && <><button className="primary" disabled={busy} onClick={() => void adoptTerrainLocal()}>保护并采用</button><button className="secondary" disabled={busy} onClick={cancelTerrainLocal}>取消局部地形预览</button></>}</div>}
          {terrainPreview && <div className="asset-structure-preview" role="status"><div><strong>自然地形候选 · 主工程尚未改变</strong><span>请在工程面板采用或取消此方案。</span>{terrainPreview.baseMap && <span aria-label="程序底图本次预算">{terrainPreview.baseMap.source === 'server' ? '服务端' : '本机'}程序生成 · {terrainPreview.baseMap.version === 3 && terrainPreview.baseMap.budgetProfile ? `编辑目标 ${terrainPreview.baseMap.initialOperationCost}/${terrainPreview.baseMap.operationLimit} · ${terrainPreview.baseMap.budgetProfile.profileId} 档；轮廓点 ${terrainPreview.baseMap.budgetUsage?.geometryPoints ?? 0}/${terrainPreview.baseMap.budgetProfile.limits.geometryPoints}，计算采样 ${terrainPreview.baseMap.budgetUsage?.fieldEvaluations ?? 0}/${terrainPreview.baseMap.budgetProfile.limits.fieldEvaluations}。` : terrainPreview.baseMap.version === 2 ? baseMapGenerationBudget && 'complexityCost' in baseMapGenerationBudget ? `生成目标 ${baseMapGenerationBudget.semanticCost}/${CONTINUATION_POLICY.generationTargets}，余 ${CONTINUATION_POLICY.generationTargets - baseMapGenerationBudget.semanticCost}；展开复杂度 ${baseMapGenerationBudget.complexityCost}/256。` : `生成目标凭证不可用；已验证展开复杂度 ${terrainPreview.baseMap.initialOperationCost}/256。` : `本次编辑量 ${terrainPreview.baseMap.initialOperationCost}/256，余 ${terrainPreview.baseMap.remainingOperationCost}。`}生成额度独立记录；{Object.keys(terrainPreview.project.document.surfaceRules).length > 0 ? '此规则候选当前仅可直接采用，之后可手工编辑。' : terrainPreview.continuationSource ? '可直接采用底图，或在此底图上继续 AI 修改。' : '可直接采用合法底图。'}</span>}{terrainPreview.continuationError && <span role="alert">此底图仍可独立采用；AI 接续不可用：{terrainPreview.continuationError}</span>}</div>{baseMapPreview && Object.keys(baseMapPreview.project.document.surfaceRules).length === 0 && <button className="primary" disabled={busy || terrainBusy || aiCritical} onClick={() => { if (canPrepareAuthoring()) { setSidebar('ai'); revealPanel('resources') } }}>继续用 AI 修改底图</button>}<button className="secondary" disabled={busy || aiCritical} onClick={cancelTerrain}>取消地形预览</button></div>}{structure && <div className="asset-structure-preview" role="status"><div><strong>{structure.description} · 候选预览</strong><span>尚未写入工程，采用后作为一次编辑保存</span><CompositionChangesPanel current={completeProject!} candidate={structure.prepared.project} commands={structure.commands}/>{(structure.kind === 'building' || structure.kind === 'outdoor' || structure.kind === 'visual') && <label className="building-check"><input type="checkbox" aria-label="确认完整影响范围" checked={structure.confirmed ?? false} onChange={event => setStructure(current => current ? { ...current, confirmed: event.target.checked } : current)}/>确认 {structure.scopeIds?.length} 个实体及 {structure.layerIds?.length} 个图层的影响范围</label>}{structure.layerIds && <span>{structure.layerIds.map(id => completeProject?.document.userLayers[id]?.name ?? id).join(' · ')}</span>}{structure.scopeIds && <details className="layer-preview-scope"><summary>实际操作范围 · {structure.scopeIds.length} 项</summary><textarea readOnly aria-label={structure.kind === 'building' ? '待采用建筑操作 ID' : structure.kind === 'visual' ? '待采用视觉操作 ID' : structure.kind === 'outdoor' ? '待采用室外操作 ID' : '待采用图层操作 ID'} rows={4} value={structure.scopeIds.join('\n')}/></details>}</div><button className="secondary" disabled={busy} onClick={() => { compositionWorkspace.cancelPreview(structure.prepared); setStructure(null) }}>{structure.assetBatch ? '取消素材导入预览' : structure.kind === 'batch' ? '取消批量预览' : structure.kind === 'layer' ? '取消图层预览' : structure.kind === 'outdoor' ? '取消室外预览' : structure.kind === 'building' ? '取消结构预览' : structure.kind === 'visual' ? '取消视觉预览' : structure.kind === 'display' ? '取消显示预览' : '取消组件预览'}</button><button className="primary" disabled={busy || (structure.kind === 'building' || structure.kind === 'outdoor' || structure.kind === 'visual') && !structure.confirmed} onClick={() => void action(async () => {
            try {
              await compositionWorkspace.adoptPreview(structure.prepared); if (structure.assetBatch) { await compositionWorkspace.flush(); finishFormDraft('assetImportForm', true) }
              setStructure(null)
              if (structure.selectionAfterAdopt !== undefined) setSelected(structure.selectionAfterAdopt)
            }
            catch (error) { compositionWorkspace.cancelPreview(structure.prepared); setStructure(null); throw error }
          }, '采用候选')}>{structure.assetBatch ? '采用所选素材' : structure.kind === 'batch' ? '采用批量修改' : structure.kind === 'layer' ? '采用图层修改' : structure.kind === 'outdoor' ? '采用室外修改' : structure.kind === 'building' ? '采用结构修改' : structure.kind === 'visual' ? '采用视觉修改' : structure.kind === 'display' ? '采用显示设置' : '采用组件修改'}</button></div>}
          {restore && <div className="asset-structure-preview history-restore-banner" role="status" aria-label="局部恢复候选"><div><strong>{restore.snapshot.name} · 局部恢复预览</strong><span>{restore.plan.request.ids.length} 件请求 · {restore.plan.changes.length} 件变化 · 当前 r{restore.currentRevision}</span><label className="building-check"><input type="checkbox" aria-label="确认恢复完整影响范围" checked={restoreConfirmed} onChange={event => setRestoreConfirmed(event.target.checked)}/>确认下方列出的全部依赖与跨层变化</label></div><button className="secondary" disabled={busy} onClick={() => { compositionWorkspace.cancelRestore(restore); setRestore(null) }}>取消局部恢复</button><button className="primary" disabled={busy || !restore.plan.changed || !restoreConfirmed} onClick={() => void action(async () => { try { await compositionWorkspace.applyRestore(restore); setSelected(null) } finally { setRestore(null); setHistoryRefresh(value => value + 1) } }, '采用局部恢复')}>保护当前并采用</button></div>}
          {structureRestore && <div className="asset-structure-preview history-restore-banner" role="status" aria-label="结构恢复候选"><div><strong>{structureRestore.snapshot.name} · 结构恢复预览</strong><span>{structureRestore.plan.request.ids.length} 项请求 · {structureRestore.plan.changes.length} 项变化 · 当前 r{structureRestore.currentRevision}</span></div><button className="secondary" disabled={busy} onClick={() => { compositionWorkspace.cancelStructureRestore(structureRestore); setStructureRestore(null) }}>取消结构恢复</button><button className="primary" disabled={busy || !structureRestore.plan.changed} onClick={() => void action(async () => { try { await compositionWorkspace.applyStructureRestore(structureRestore); setSelected(null) } finally { setStructureRestore(null); setHistoryRefresh(value => value + 1) } }, '采用结构恢复')}>保护当前并采用结构恢复</button></div>}
          {structure?.fillCopy && <div className="asset-structure-preview fill-copy-summary" role="status" aria-label="填充复制参数">
            <div><strong>填充复制 · {structure.fillCopy.report.sourceKind === 'prefab' ? '组合' : '独立物件'} · 新增 {structure.fillCopy.report.count} 份 · 实际预算 {structure.fillCopy.cost.total}/{structure.fillCopy.cost.limit}</strong>
              <span>每份偏移 {structure.fillCopy.report.stepMm.x}, {structure.fillCopy.report.stepMm.y} mm；方向 {Math.round(Math.atan2(structure.fillCopy.report.stepMm.y, structure.fillCopy.report.stepMm.x) * 180 / Math.PI)}°；首件 ({structure.fillCopy.report.positions[0]?.x}, {structure.fillCopy.report.positions[0]?.y}) · 末件 ({structure.fillCopy.report.positions.at(-1)?.x}, {structure.fillCopy.report.positions.at(-1)?.y})；支撑/锁依赖 {structure.fillCopy.report.dependencyIds.length} 项 · 重叠 {structure.fillCopy.report.overlaps.length} 处。</span>
            </div>
            <button className="secondary" disabled={busy} onClick={cancelStructurePreview}>取消填充复制预览</button>
            <button className="primary" disabled={busy} onClick={adoptStructurePreview}>采用填充复制</button>
          </div>}
          {aiPreview && audience === 'gm' && <div className="ai-preview-banner" role="status"><strong>{aiShown ? 'AI草稿预览 · 主工程未改变' : baseMapPreview ? '正在查看程序底图' : '正在查看主工程'}</strong><span>草稿 {aiPreview.draftRevision} · {aiPreview.changes.length} 件差异</span><button disabled={aiCritical || busy} onClick={() => { if (showAiDraft) setShowAiDraft(false); else if (canPrepareAuthoring()) setShowAiDraft(true) }}>{aiShown ? baseMapPreview ? '查看程序底图' : '查看主工程' : '查看AI草稿'}</button></div>}
          <div className="asset-stage">{visibleProject ? <AssetCanvas key={panelKey} groundView={groundView} toolControlsTarget={toolControlsTarget} viewControlsTarget={viewControlsTarget}
            project={visibleProject} editorRenderer={editorRenderer} selectionOptions={selectionOptions} pointHitTest={pointHitTest} boundsSelector={boundsSelector}
            selectionGeometry={selectionGeometry} selectionSummaryReader={selectionSummaryReader} worldTool={canvasWorldTool}
            terrainBrush={audience === 'gm' ? canopyBrush ?? terrainEditCanvas?.brush : null} fillCopy={fillCopy} onFillCopyPreview={finishFillCopy} onFillCopyCancel={() => setFillCopy(null)}
            visualBoundary={terrainEditCanvas?.boundary ?? (audience === 'gm' && connectionBoundaryEditor && (connectionBoundaryEditor.owner === 'outdoorInspector' || sidebar === 'outdoor') ? connectionBoundaryEditor.boundary : sidebar === 'visual' && audience === 'gm' ? boundaryEditor?.boundary : null)}
            onVisualBoundaryFinish={terrainEditCanvas?.onBoundaryFinish} onVisualBoundaryChange={next => { if (terrainEditCanvas?.onBoundaryChange) terrainEditCanvas.onBoundaryChange(next); else if (connectionBoundaryEditor && (connectionBoundaryEditor.owner === 'outdoorInspector' || sidebar === 'outdoor')) { markFormDraft(connectionBoundaryEditor.owner); connectionBoundaryEditor.onChange(next) } else if (boundaryEditor) { markFormDraft('visualForm'); boundaryEditor.onChange(next) } }}
            onWallDragPreview={(wallId, offsetMm) => {
              const scene = completeProject?.document, wall = scene?.walls[wallId]
              if (!scene || !wall) return
              const commands = [wall.startVertexId, wall.endVertexId].map(id => ({ type: 'moveVertex' as const, id, positionMm: { x: scene.vertices[id].xMm + offsetMm.x, y: scene.vertices[id].yMm + offsetMm.y } }))
              previewBuilding(commands, '拖动墙边，核对共享结构、门窗与支撑依赖', 'buildingInspector')
            }}
            selected={null} selectionSession={selectionSession} onSelect={select} onSelectMany={selectMany} onContext={openMenu} memberMode={memberMode} onMemberMode={setMemberMode}
            fitRequest={fitRequest} audience={audience} disabled={busy || terrainEditBusy || (!!terrainEditCanvas ? false : editingBlocked) || !!prefabPlacement || audience === 'player'}
            placement={placement?.prop} onPlacementMove={positionMm => setPlacement(current => current ? { ...current, prop: { ...current.prop, positionMm } } : null)} onPlace={placeAt}
            onPlacementReady={setPlacementReady} onPlacementError={error => { setPlacement(null); setMessage(error) }} onCancelPlacement={() => setPlacement(null)}/>
            : <div className="asset-empty"><div className="asset-empty-icon"><Layers3 size={36}/></div><span>从一张空白画布开始</span><p>选择画布范围与使用预设。<br/>也可从左侧打开书房、岩岛或海岸哨所。</p><button className="primary" disabled={busy} onClick={openNewScene}>新建场景</button></div>}</div>
        </main>
  const workspaceTools = <><div ref={setToolControlsTarget}/><button title="画矩形房间" aria-label="工具：画房间" disabled={editDisabled || !completeProject || audience === 'player'} aria-pressed={!!sketch && sketch.kind !== 'ruler'} onClick={() => startBuildingTool('rectangle')}><PencilRuler size={18}/><small>房间</small></button><button title="绘制地形" aria-label="工具：画地形" disabled={editDisabled || !completeProject || audience === 'player'} aria-pressed={!!outdoorSketch} onClick={startTerrainTool}><Mountain size={18}/><small>地形</small></button><button title="选择待放置素材" aria-label="工具：放置素材" disabled={editDisabled || !completeProject || audience === 'player'} onClick={() => { if (guard()) openResources('library') }}><Plus size={18}/><small>放置</small></button><button title="文字与线索" aria-label="工具：注记" disabled={editDisabled || !completeProject || audience === 'player'} onClick={showNotes}><StickyNote size={18}/><small>注记</small></button><button title="量尺" aria-label="工具：量尺" disabled={editDisabled || !completeProject || audience === 'player'} aria-pressed={sketch?.kind === 'ruler'} onClick={() => startBuildingTool('ruler')}><Ruler size={18}/><small>量尺</small></button></>
  const workspaceFooter = <><div ref={setViewControlsTarget}/>{project && <button className="workspace-display-summary" disabled={audience === 'player'} onClick={showSettings} title="打开单位与格线设置">{project.document.units.display === 'm' ? '米' : '英尺'} · 格线{project.document.units.gridVisible ? '显示' : '隐藏'} · 吸附 {project.document.units.snapMm} mm</button>}<SelectionSubscriber session={selectionSession}>{ids => <span>已选 {ids.length} 项</span>}</SelectionSubscriber><span>{placement ? '放置物件' : prefabPlacement ? '放置组合' : sketch?.kind === 'ruler' ? '量尺' : sketch ? '绘制房间' : outdoorSketch ? '绘制室外' : '选择 / 平移'}</span><span>{audience === 'gm' ? '主持人视图' : '玩家视图'}</span></>
  return <>
    <div className="asset-shell history-shell composition-shell outdoor-shell workspace-unified" ref={shell} data-testid="outdoor-workbench" data-native-format={`sceneweave-complete-project@${completeProject?.schemaVersion ?? 1}`} data-revision={project?.document.revision}
      data-transaction-revision={state.lastTransaction?.revision} data-transaction-committed-at={state.lastTransaction?.committedAtMs}>
      <header className="asset-header"><button className="asset-brand" aria-label="回到首页" onClick={onBack}><ArrowLeft size={18}/><span>织境<small>Sceneweave</small></span></button><div className="asset-header-title"><div className="workspace-project-title"><small>统一工作区</small><h1>{project?.document.title ?? '织境场景'}</h1></div></div><div className="asset-toolbar"><button aria-label="撤销素材编辑" title="撤销" disabled={!state.canUndo || editDisabled} onClick={() => commit(() => compositionWorkspace.undo())}><Undo2 size={17}/></button><button aria-label="重做素材编辑" title="重做" disabled={!state.canRedo || editDisabled} onClick={() => commit(() => compositionWorkspace.redo())}><Redo2 size={17}/></button><button aria-label="命名历史快照" title="命名历史快照" disabled={!project || audience === 'player'} onClick={openHistory}><Archive size={17}/></button></div><div className="asset-header-actions"><span role="status" className={`asset-save ${state.status}`}>{state.status === 'saving' ? <LoaderCircle size={14} className="spin"/> : <CheckCircle2 size={14}/>} {saveLabels[state.status]}</span><button className="secondary" disabled={busy || editingBlocked} onClick={requestImport}><Upload size={15}/>打开工程</button>{project && <button className="secondary" disabled={busy} onClick={() => request({ type: 'reload' })}>重新载入已保存版本</button>}<button className="primary" disabled={busy || editingBlocked || !project} onClick={() => backup()}><Download size={15}/>完整工程</button><button className="secondary" disabled={busy || editingBlocked || !project} onClick={exportImage}><Download size={15}/>4K PNG</button><button className="secondary" disabled={busy || editingBlocked || !completeProject || audience !== 'gm'} onClick={() => { if (completeProject && guard()) setUvttProject(completeProject) }}>VTT 导出</button></div></header>
      {(state.error || message) && <div className="asset-notice" role="alert"><span>{message ?? state.error}</span>{state.status === 'error' && <button onClick={() => void action(() => compositionWorkspace.retry())}>重试保存</button>}{['conflict', 'error'].includes(state.status) && <button onClick={() => { if (guard()) void action(async () => { await compositionWorkspace.saveAsCopy() }) }}>另存副本</button>}<button aria-label="关闭工坊提示" onClick={() => setMessage(null)}><X size={16}/></button></div>}
      <div className="workspace-session-feedback">{draftControls}</div>
      <WorkspaceLayout active={active} panelRequest={panelRequest} resources={resourcePanels} inspector={inspectorPanel} navigation={[
        { id: 'layers', label: '图层', content: layerPanel, disabled: !completeProject || audience === 'player' },
        { id: 'objects', label: '对象', content: sceneBrowser },
        { id: 'history', label: '历史', content: audience === 'gm' ? historyBrowser : null, disabled: !completeProject || audience === 'player' },
      ]} navigationTab={audience === 'player' ? 'objects' : navigationTab} onNavigationTabChange={setNavigationTab} tools={workspaceTools} footer={workspaceFooter}>{canvasPanel}</WorkspaceLayout>
      {uvttProject && <UvttExportDialog project={uvttProject} onClose={() => setUvttProject(null)}/>}
      <input hidden ref={file} type="file" accept=".sceneweave" aria-label="选择完整工程" onChange={event => { const selected = event.target.files?.[0]; event.target.value = ''; if (selected && guard()) onImportFile(selected) }}/>
      {busy && !preparation && <div className="asset-busy" role="status"><LoaderCircle size={17} className="spin"/>正在处理完整工程…{controller.current && <button onClick={() => controller.current?.abort()}>取消准备</button>}</div>}
    </div>
    {active && menu && project && <SceneContextMenu key={`${menu.checkpoint}-${menu.x}-${menu.y}-${menu.ids.join('|')}`} project={project} menu={menu} onMoveToLayer={() => { try { compositionWorkspace.assertCheckpoint(menu.checkpoint); selectionSession.set(menu.ids); setLayerMoveRequest(value => value + 1) } catch (error) { setMessage(String(error)) } }} onClose={closeMenu} onAction={action => batchAction(action, undefined, menu.ids, menu.checkpoint)} onSelect={select} onFit={() => setFitRequest(value => value + 1)} onPlace={(id, point) => { try { compositionWorkspace.assertCheckpoint(menu.checkpoint); choosePlacement(id, point) } catch (error) { setMessage(String(error)) } }} onEdit={() => { revealPanel('inspector'); requestAnimationFrame(() => requestAnimationFrame(() => { const input = shell.current?.querySelector<HTMLElement>('.asset-inspector input:not(:disabled)') ?? shell.current?.querySelector<HTMLElement>('.asset-inspector button:not(:disabled)'); input?.focus() })) }}/>}
    {active && (candidate || newScene || preparation) && <div className="modal-scrim"><div ref={dialog} className="modal" role="dialog" aria-modal="true" aria-label={preparation ? '准备打开工程' : newScene ? '新建空白场景' : '确认打开工程'}>
      <div className="modal-heading"><h2>{preparation ? '准备打开工程' : newScene ? '新建空白场景' : '确认打开工程'}</h2><button className="icon-button" disabled={preparation ? preparation.cancelling : busy && !(newScene && creatingStage === 'preparing')} aria-label={preparation ? '关闭准备窗口' : newScene ? '取消新建场景' : '取消打开工程'} onClick={() => { if (preparation) cancelPreparation(); else if (newScene) cancelNewScene(); else setCandidate(null) }}><X size={18}/></button></div>
      {preparation ? <>
        <p>{preparation.description}</p>
        <p role="status">{preparation.cancelling ? '正在取消准备…' : preparation.progress?.phase === 'resources' ? `正在读取场景素材 ${preparation.progress.completed} / ${preparation.progress.total}` : preparation.progress?.phase === 'validation' ? '正在检查完整场景与素材…' : '正在准备场景…'}</p>
        <progress className="asset-preparation-progress" aria-label="工程准备进度" max={preparation.progress?.total || 1} value={preparation.progress?.phase === 'resources' ? preparation.progress.completed : undefined}/>
        <p className="asset-muted">准备完成后可审阅并打开副本，当前工程保持。</p>
        <div className="modal-actions"><button className="secondary" disabled={preparation.cancelling} onClick={cancelPreparation}>取消准备</button></div>
      </> : newScene ? <NewSceneForm visualPack={visualNewScene} busy={busy} cancellable={creatingStage === 'preparing'} failure={message ?? state.error} onCreate={createScene} onCancel={cancelNewScene}/> : candidate && <><p>{candidate.description}</p><div className="asset-candidate"><strong>{candidate.project.document.title}</strong><span>{Object.keys(candidate.project.assets).length} 张位图 · {Object.keys(candidate.project.document.props).length} 件物件 · 完整工程</span></div>{message && <p role="alert" className="asset-form-error">{message}</p>}<div className="modal-actions"><button className="secondary" disabled={busy} onClick={() => setCandidate(null)}>取消</button><button className="primary" disabled={busy} onClick={() => void action(async () => { await ready(); await compositionWorkspace.adoptNew(candidate.project, candidate.checkpoint); setCandidate(null); setSelected(null); setAudience('gm'); setSessionGeneration(value => value + 1) })}>保存并打开副本</button></div></>}
    </div></div>}
  </>
}
