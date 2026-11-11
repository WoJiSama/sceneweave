import { visualBase } from '../../shared/visual/base'
import PathAttachmentTools from './PathAttachmentTools'
import FloorTools from './FloorTools'
import { resolveFloorOutput } from '../../shared/floors/output'
import ImageImportTool from './ImageImportTool'
import SceneAssetEditor, { type SceneAssetTarget } from './SceneAssetEditor'
import { prepareImageEnhancementCandidate, type ImageEnhancementSource } from '../../platform/browser/content/image-enhancement'
import { prepareImageRefinementCandidate, type ImageRefinementCandidate } from '../../platform/browser/content/image-refinement'
import type { ImageEnhancementRecipe } from '../../shared/image-enhancement'
import { installSavedImageImportItems } from '../../platform/browser/content/image-import-library'
import ProjectAssetReviewPanel from './ProjectAssetReviewPanel'
import ThemePacksPanel from './ThemePacksPanel'
import DecorationPanel, { DecorationInspector } from './DecorationPanel'
import VegetationCompositionTools from './VegetationCompositionTools'
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
import MixedGenerationPanel, { type MixedGenerationUiRequest } from './MixedGenerationPanel'
import { prepareGenerationIntent } from '../../application/workspace/generation-intent.js'
import { browserGenerationContent } from '../../platform/browser/content/generation-intent.js'
import LocalGenerationPanel from './LocalGenerationPanel'
import type { LocalGenerationRequest } from '../../shared/generation/local'
import type { DomainPreviewMap, LocalGenerationPreview } from '../../application/workspace/workspace'
import { domainOperationView, type DomainOperationLease } from './domain-operation-session'
import { GENERATION_DOMAINS, useDomainOperations, type GenerationDomain } from './use-domain-operations'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { AlertTriangle, Archive, ArrowLeft, BookOpen, Sparkles, Palette, Shapes, Shield, WandSparkles, CheckCircle2, Clock3, Download, Layers3, PencilRuler, LoaderCircle, Move, Mountain, DoorOpen, Plus, Ruler, StickyNote, Redo2, Undo2, Upload, X } from 'lucide-react'
import { WorkspaceRepository } from './repository'
import { Workspace, type CompositionPreview, type RestorePreview, type StructureRestorePreview, type RegionalPreview } from '../../application/workspace/workspace'
import RegionalPanel from './RegionalPanel'
import { createRegionalBlankProject } from '../../platform/browser/content/regional-symbols'
import { compareRegionalSource, type RegionalCreateUiRequest, type RegionalDrillDownUiRequest } from '../../application/workspace/regional'
import type { RegionalEditRequest } from '../../shared/terrain-generation/regional-authoring'
import { fromBundle } from '../../application/workspace/project'
import { assessAddedCatalogQuality } from '../../application/workspace/asset-quality'
import { assertAssetQualityAccepted, assetQualityAcknowledgmentsComplete, type AssetQualityAssessment } from '../../shared/assets/quality-review'
import AssetQualityReview from './AssetQualityReview'
import { toBundle, type EditableProject } from '../../application/workspace/project'
import { exportProject, exportHistoryArchive } from '../../shared/project/file'
import { validateProjectBundle } from '../../shared/project/resources'
import { projectRepository, validation, runtime } from '../../platform/browser/runtime'
import { createBlankProject, createSampleProject } from '../../platform/browser/content/factories'
import type { ContentLoadProgress } from '../../platform/browser/content/load-resources'
import { inspectOutdoorChanges, isOutdoorCommand, type OutdoorCommand } from '../../shared/commands/outdoor'
import { outdoorPreviewError } from './outdoor-preview-error'
import { historyPreviewError } from './history-preview-error'
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
import OutdoorToolsPanel, { type OutdoorSketch, type OutdoorTask, type RoadDrawingSettings } from './OutdoorToolsPanel'
import TerrainElevationTools from './TerrainElevationTools'
import TerrainSculptTools from './TerrainSculptTools'
import { createTerrainSculptToolState, type TerrainSculptToolState } from './terrain-sculpt-tools'
import { prepareRoadDoorStart, type RoadDoorStartRequest, type RoadDoorStart } from './road-door-start'
import { createTerrainElevationToolState, sampleTerrainElevation, stepTerrainElevation, type TerrainElevationToolState } from './terrain-elevation-tools'
import { terrainPoints } from '../../shared/geometry/geometry'
import OutdoorInspector, { outdoorEntityKind } from './OutdoorInspector'
import SceneDisplayPanel from './SceneDisplayPanel'
import ProjectTitleForm from './ProjectTitleForm'
import { inspectVisualChanges, isVisualCommand } from '../../shared/visual/commands'
import { createNaturalDetailIslandProject, createNaturalDetailOutpostProject, NATURAL_DETAIL_ISLAND_NAME, NATURAL_DETAIL_OUTPOST_NAME } from '../../platform/browser/content/natural-detail-samples.js'
import { createDetailedIslandProject, DETAILED_ISLAND_NAME } from '../../platform/browser/content/detailed-island.js'
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
import VisualPanel, { type VisualBoundaryEditor, type VisualTab } from './VisualPanel'
import OutpostTravelPanel from './OutpostTravelPanel'
import CatalogLibrary, { type CatalogSelectorV1 } from './CatalogLibrary'
import { createEntityLabeler } from './entity-label'
import { aggregateReviewMembers } from './aggregate-review'
import TaskPicker from './TaskPicker'
import WorkspaceHelp from './WorkspaceHelp'
import WorkspaceSaveRecovery from './WorkspaceSaveRecovery'
import OpeningPlacementPanel, { type OpeningTool } from './OpeningPlacementPanel'
import { openingAtPoint } from './opening-placement'
import { newId } from './runtime'
import AiConversationPanel, { type AiConnection } from './AiConversationPanel'
import type { AtomicCandidate } from '../../application/workspace/atomic'
import AuthoringGuide from './AuthoringGuide'
import { authoringStageKind } from './authoring-recipes'
import AppearancePanel from './AppearancePanel'
import PrefabPanel from './PrefabPanel'
import CompositionChangesPanel from './CompositionChangesPanel'
import type { AssetImportFields } from './AssetImportForm'
import BuildingPanel, { type BuildingTask } from './BuildingPanel'
import SceneBoundsPanel from './SceneBoundsPanel'
import { assertMaterialTargets, surfaceMaterialCommands } from './surface-material'
import { WorkspacePresentationContext } from '../workspace/WorkspacePresentation'
import AggregateNaturalPanel from './AggregateNaturalPanel'
import BuildingInspector from './BuildingInspector'
import { formatDistanceMm, type BuildingSketch, type CanvasWorldTool } from '../native-canvas/building-session'
import UserLayerPanel from './UserLayerPanel'
import LayerSelectionNotice from './LayerSelectionNotice'
import { domainProject, hiddenEntities, scopedHiddenEntities, hitTestLayers, selectInBoundsLayers, selectionGeometryLayers, summarizeSelectionLayers, inheritSelectionGeometryForProject } from '../native-canvas/layer-view'
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
import { selectionActionBehavior, selectionCommands, type SelectionAction } from '../native-canvas/selection-actions'
import { captureSceneClipboard, pasteSceneClipboard, type SceneClipboard } from './scene-clipboard'
import { SelectionSession } from '../native-canvas/selection-session'
import { SelectionSubscriber } from '../native-canvas/SelectionSubscriber'
import type { WorkspaceController, WorkspaceRequest, WorkspaceSessionSummary } from '../main-shell/session'
import WorkspaceLayout from '../workspace/WorkspaceLayout'
import WorkspaceNotice from './WorkspaceNotice'
import { imageImportDraftMatches, workspaceTransitionReason, workspaceFormDraftLabels, type WorkspaceDraft, type WorkspaceFormDraft, type WorkspaceTransient } from './session-guard'
import './assets.css'
import './layers.css'
import './history.css'
import './composition.css'
import './outdoor.css'
import './unified-workbench.css'
import './workspace-ux.css'
import './workspace-controls.css'
import './workspace-information-architecture.css'
import './workspace-density.css'

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
type Candidate = { project: EditableProject; checkpoint: number; description: string; imageDraftToken?: string }
type CatalogUse = { selector: CatalogSelectorV1; layerId: string; ids: string[] }
type StructurePreview = { assetQuality?: readonly AssetQualityAssessment[]; qualityAcknowledgments?: readonly string[]; afterUse?: CatalogUse; assetBatch?: { count: number; addedDefinitions: number; operationCost: number }; fillCopy?: { report: FillCopyReport; cost: { total: number; limit: number } }; prepared: CompositionPreview; checkpoint: number; commands: CompositionCommand[]; document: SceneDocument; description: string; kind?: 'batch' | 'fill-copy' | 'layer' | 'building' | 'outdoor' | 'visual' | 'display' | 'image-enhancement'; scopeIds?: string[]; layerIds?: string[]; confirmed?: boolean; selectionAfterAdopt?: string | null }
function AffectedObjectNames({ before, after, ids }: { before: SceneDocument; after: SceneDocument; ids: readonly string[] }) {
  const labels = useMemo(() => {
    const previousName = createEntityLabeler(before), nextName = createEntityLabeler(after)
    return ids.filter(id => !before.vertices[id] && !after.vertices[id]).map(id => ({ id, name: nextName(id) === id ? previousName(id) : nextName(id) }))
  }, [before, after, ids])
  return <div className="workspace-scope-names" aria-label="关联对象">{labels.slice(0, 8).map(item => <span key={item.id}>{item.name}</span>)}{labels.length > 8 && <span>另 {labels.length - 8} 项</span>}</div>
}
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
  const project = useMemo(() => {
    if (!completeProject) return null
    inheritSelectionGeometryForProject(toBundle(completeProject).project)
    return domainProject(completeProject)
  }, [completeProject])
  const [chosenFloorId, setChosenFloorId] = useState('')
  const activeFloorId = completeProject && Object.hasOwn(completeProject.document.floors, chosenFloorId) ? chosenFloorId : Object.keys(completeProject?.document.floors ?? {})[0] ?? ''
  const [storedLayerId, setCurrentLayerId] = useState(''), [hiddenLayerIds, setHiddenLayerIds] = useState<ReadonlySet<string>>(new Set()), [soloLayerId, setSoloLayerId] = useState<string | null>(null), [currentOnly, setCurrentOnly] = useState(false)
  const currentLayerId = completeProject?.document.userLayers[storedLayerId]?.floorId === activeFloorId ? storedLayerId : Object.values(completeProject?.document.userLayers ?? {}).find(layer => layer.floorId === activeFloorId)?.id ?? ''
  const effectiveHiddenLayers = useMemo(() => new Set(completeProject ? Object.keys(completeProject.document.userLayers).filter(id => completeProject.document.userLayers[id].floorId !== activeFloorId || hiddenLayerIds.has(id) || soloLayerId !== null && soloLayerId !== id) : []), [completeProject?.document, activeFloorId, hiddenLayerIds, soloLayerId])
  const hiddenIds = useMemo(() => completeProject ? hiddenEntities(completeProject.document, effectiveHiddenLayers) : new Set<string>(), [completeProject?.document, effectiveHiddenLayers])
  const scopedHiddenIds = useMemo(() => completeProject ? scopedHiddenEntities(completeProject.document, hiddenIds, currentOnly ? currentLayerId : null) : hiddenIds, [completeProject?.document, hiddenIds, currentOnly, currentLayerId])
  const selectionOptions = useMemo(() => ({ hiddenIds: scopedHiddenIds }), [scopedHiddenIds])
  const [sessionGeneration, setSessionGeneration] = useState(0)
  const clipboard = useRef<SceneClipboard | null>(null)
  useEffect(() => { clipboard.current = null }, [project?.document.sceneId, sessionGeneration])
  const [authoringOpen, setAuthoringOpen] = useState(false)
  const [detailMode, setDetailMode] = useState<'selection' | 'settings' | 'layer' | 'building' | 'outdoor' | 'elevation' | 'sculpt' | 'outdoorEdit' | 'outdoorAggregate' | 'dress' | 'regenerate' | 'visual' | 'history' | 'review' | 'samples'>('selection')
  const [inspectedLayerId, setInspectedLayerId] = useState('')
  const [buildingTask, setBuildingTask] = useState<BuildingTask>('room')
  const [outdoorTask, setOutdoorTask] = useState<OutdoorTask>('terrain')
  const [surfaceRequest, setSurfaceRequest] = useState(0)
  const [visualTab, setVisualTab] = useState<VisualTab>('surface')
  const [catalogDetailOpen, setCatalogDetailOpen] = useState(false)
  const [buildingTarget, setBuildingTarget] = useState<HTMLDivElement | null>(null)
  const [outdoorTarget, setOutdoorTarget] = useState<HTMLDivElement | null>(null)
  const [visualTarget, setVisualTarget] = useState<HTMLDivElement | null>(null)
  const [catalogTarget, setCatalogTarget] = useState<HTMLDivElement | null>(null)
  const [historyTarget, setHistoryTarget] = useState<HTMLDivElement | null>(null)
  const [reviewTarget, setReviewTarget] = useState<HTMLDivElement | null>(null)
  const [reviewIds, setReviewIds] = useState<ReadonlySet<string>>(new Set())
  const registerReview = useCallback((id: string) => {
    setReviewIds(current => new Set(current).add(id))
    return () => setReviewIds(current => { const next = new Set(current); next.delete(id); return next })
  }, [])
  const presentation = useMemo(() => ({ reviewTarget, registerReview }), [reviewTarget, registerReview])
  const [toolControlsTarget, setToolControlsTarget] = useState<HTMLDivElement | null>(null)
  const [viewControlsTarget, setViewControlsTarget] = useState<HTMLDivElement | null>(null)
  const [layoutControlsTarget, setLayoutControlsTarget] = useState<HTMLDivElement | null>(null)
  const [panelRequest, setPanelRequest] = useState<{ id: 'resources' | 'inspector'; sequence: number; action?: 'open' | 'close'; narrowOnly?: boolean; focus?: boolean }>()
  const revealPanel = (id: 'resources' | 'inspector') => setPanelRequest(current => ({ id, sequence: (current?.sequence ?? 0) + 1 }))
  const inspect = (mode: typeof detailMode) => { setCatalogDetailOpen(false); setDetailMode(mode); revealPanel('inspector') }
  const enterCanvas = () => setPanelRequest(current => ({ id: 'inspector', sequence: (current?.sequence ?? 0) + 1, action: 'close', narrowOnly: true }))
  const [formDrafts, setFormDrafts] = useState(initialFormDrafts)
  const [formReset, setFormReset] = useState(initialFormResets)
  const [catalogBusy, setCatalogBusy] = useState(false)
  const [pendingCatalogUse, setPendingCatalogUse] = useState<{ request: CatalogUse; project: EditableProject; checkpoint: number } | null>(null)
  const [finishBuilding, setFinishBuilding] = useState<(() => void) | null>(null)
  const onBuildingFinishReady = useCallback((finish: (() => void) | null) => setFinishBuilding(() => finish), [])
  const [finishOutdoor, setFinishOutdoor] = useState<(() => void) | null>(null)
  const onOutdoorFinishReady = useCallback((finish: (() => void) | null) => setFinishOutdoor(() => finish), [])
  const [finishSculpt, setFinishSculpt] = useState<(() => void) | null>(null)
  const onSculptFinishReady = useCallback((finish: (() => void) | null) => setFinishSculpt(() => finish), [])
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
  const pendingCatalogSources = useRef(new Set<string>())
  const updateCatalogPending = useCallback((source: string, pending: boolean) => {
    if (pending) pendingCatalogSources.current.add(source); else pendingCatalogSources.current.delete(source)
    catalogPending.current = pendingCatalogSources.current.size > 0; setCatalogBusy(catalogPending.current)
  }, [])
  const onCatalogPending = useCallback((pending: boolean) => updateCatalogPending('catalog', pending), [updateCatalogPending])
  const onThemePending = useCallback((pending: boolean) => updateCatalogPending('themes', pending), [updateCatalogPending])
  const onProjectReviewPending = useCallback((pending: boolean) => updateCatalogPending('project-review', pending), [updateCatalogPending])
  const onCatalogDraft = useCallback((dirty: boolean) => setFormDrafts(current => current.catalogForm === dirty ? current : { ...current, catalogForm: dirty }), [])
  const propAppearanceDraftOwners = useRef({ inspector: false, editor: false })
  const onPropAppearanceDraft = useCallback((dirty: boolean) => {
    propAppearanceDraftOwners.current.inspector = dirty
    const any = dirty || propAppearanceDraftOwners.current.editor
    setFormDrafts(current => current.propAppearanceForm === any ? current : { ...current, propAppearanceForm: any })
  }, [])
  const onEditorAppearanceDraft = useCallback((dirty: boolean) => {
    propAppearanceDraftOwners.current.editor = dirty
    const any = dirty || propAppearanceDraftOwners.current.inspector
    setFormDrafts(current => current.propAppearanceForm === any ? current : { ...current, propAppearanceForm: any })
  }, [])
  const [busy, setBusy] = useState(false), [busyMessage, setBusyMessage] = useState('正在处理完整工程…'), [message, setMessage] = useState<string | null>(null)
  const [transientMessage, setTransientMessage] = useState<string | null>(null)
  const dismissMessage = useCallback(() => setMessage(null), [])
  const announceSuccess = (text: string) => { setTransientMessage(text); setMessage(text) }
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

  const { operations: domainOperations, state: domainOperationState } = useDomainOperations({
    sourceKey: `${completeProject?.document.sceneId ?? 'empty'}:${completeProject?.document.revision ?? 0}:${sessionGeneration}`,
    checkpoint: () => compositionWorkspace.checkpoint(),
    release: {
      interior: preview => compositionWorkspace.cancelGeneration({ kind: 'new-project', domain: 'interior', preview }),
      forest: preview => compositionWorkspace.cancelGeneration({ kind: 'new-project', domain: 'forest', preview }),
      volcano: preview => compositionWorkspace.cancelGeneration({ kind: 'new-project', domain: 'volcano', preview }),
      mixed: preview => compositionWorkspace.cancelGeneration({ kind: 'new-project', domain: 'mixed', preview }),
    },
  })
  const { preview: interiorPreview, busy: interiorBusy, dirty: interiorDraft, error: interiorError, resetKey: interiorReset } = domainOperationView(domainOperationState.interior)
  const { preview: forestPreview, busy: forestBusy, dirty: forestDraft, error: forestError, resetKey: forestReset } = domainOperationView(domainOperationState.forest)
  const { preview: volcanoPreview, busy: volcanoBusy, dirty: volcanoDraft, error: volcanoError, resetKey: volcanoReset } = domainOperationView(domainOperationState.volcano)
  const { preview: mixedPreview, busy: mixedBusy, dirty: mixedDraft, error: mixedError, resetKey: mixedReset } = domainOperationView(domainOperationState.mixed)
  const domainSummary = domainOperations.summary(), domainPreview = domainOperations.currentPreview()
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
  const [parameterAiConnection, setParameterAiConnection] = useState<AiConnection | null>(null)
  useEffect(() => () => domainClient.current?.dispose(), [])
  const terrainOperation = useRef(0)
  const terrainAbort = useRef<AbortController | null>(null)
  const [baseMapSettings, setBaseMapSettings] = useState<BaseMapGenerationSettingsValue>({ mode: 'worker', baseUrl: '', token: '' })
  const [terrainBusy, setTerrainBusy] = useState(false), [terrainError, setTerrainError] = useState<string | null>(null)
  const [terrainLocalPreview, setTerrainLocalPreview] = useState<TerrainLocalPreview | null>(null), [terrainLocalBusy, setTerrainLocalBusy] = useState(false), [terrainLocalError, setTerrainLocalError] = useState<string | null>(null)
  const terrainLocalPreviewRef = useRef<TerrainLocalPreview | null>(null)
  terrainLocalPreviewRef.current = terrainLocalPreview
  const [candidate, setCandidate] = useState<Candidate | null>(null)
  const [imageImportRequest, setImageImportRequest] = useState(0)
  const [imageImportDraft, setImageImportDraft] = useState<string | null>(null)
  const imageImportDraftRef = useRef<string | null>(null)
  const [imageImportReset, setImageImportReset] = useState(0)
  const updateImageImportDraft = useCallback((token: string | null) => {
    const previous = imageImportDraftRef.current
    imageImportDraftRef.current = token; setImageImportDraft(token)
    if (token === null && previous !== null) { setImageImportRequest(0); setImageImportReset(value => value + 1) }
  }, [])
  const [imageLibraryRefresh, setImageLibraryRefresh] = useState(0)
  const [imageLibraryStatus, setImageLibraryStatus] = useState<{ sceneId: string; message: string; failed: boolean } | null>(null)
  const imageLibraryAttempts = useRef(new Set<string>())
  const imageLibraryJob = useRef<{ sceneId: string; controller: AbortController } | null>(null)
  useEffect(() => () => {
    const job = imageLibraryJob.current
    if (job) { job.controller.abort(); imageLibraryAttempts.current.delete(job.sceneId) }
    imageLibraryJob.current = null
  }, [])
  const syncImageItems = async (sceneId: string, ids: string[]) => {
    const previous = imageLibraryJob.current
    if (previous?.sceneId === sceneId) return
    if (previous) { previous.controller.abort(); imageLibraryAttempts.current.delete(previous.sceneId) }
    const job = { sceneId, controller: new AbortController() }
    imageLibraryJob.current = job
    setImageLibraryStatus({ sceneId, message: '工程已保存，正在将拆解物件加入我的素材…', failed: false })
    try {
      const result = await installSavedImageImportItems(sceneId, ids, job.controller.signal)
      if (job.controller.signal.aborted || imageLibraryJob.current !== job) return
      setImageLibraryRefresh(value => value + 1)
      setImageLibraryStatus({ sceneId, message: `拆解物件已保存到我的素材，新增${result.savedCount}项，已有${result.existingCount}项。`, failed: false })
    } catch (error) {
      if (job.controller.signal.aborted || imageLibraryJob.current !== job) return
      setImageLibraryStatus({ sceneId, message: `工程已保存，素材入库待重试。${error instanceof Error ? error.message : String(error)}`, failed: true })
    } finally { if (imageLibraryJob.current === job) imageLibraryJob.current = null }
  }
  useEffect(() => {
    const document = completeProject?.document
    if (!document || state.status !== 'saved' || document.presetSnapshot.presetId !== 'image-import-manual' || imageLibraryAttempts.current.has(document.sceneId)) return
    imageLibraryAttempts.current.add(document.sceneId)
    void syncImageItems(document.sceneId, Object.keys(document.props))
  }, [completeProject?.document.sceneId, state.status])

  const [preparation, setPreparation] = useState<{ abort: AbortController; description: string; progress: ContentLoadProgress | null; cancelling: boolean } | null>(null)
  const cancelPreparation = () => { controller.current?.abort(); setPreparation(current => current ? { ...current, cancelling: true } : current) }
  const [sidebar, setSidebar] = useState<'scene' | 'generate' | 'building' | 'library' | 'outdoor' | 'visual' | 'ai' | 'history'>('scene'), [historyRefresh, setHistoryRefresh] = useState(0)
  const [generationTab, setGenerationTab] = useState<'interior' | 'forest' | 'volcano' | 'mixed' | 'natural' | 'composition' | 'regional'>('interior')
  const [outdoorTab, setOutdoorTab] = useState<'draw' | 'edit' | 'dress' | 'regenerate'>('draw')
  const [appearanceOpen, setAppearanceOpen] = useState(false), [prefabToolsOpen, setPrefabToolsOpen] = useState(false)
  const [restore, setRestore] = useState<RestorePreview | null>(null)
  const [restoreConfirmed, setRestoreConfirmed] = useState(false)
  const restoreRef = useRef<RestorePreview | null>(null)
  restoreRef.current = restore
  const [structureRestore, setStructureRestore] = useState<StructureRestorePreview | null>(null)
  const structureRestoreRef = useRef<StructureRestorePreview | null>(null)
  structureRestoreRef.current = structureRestore
  const [enhancementTarget, setEnhancementTarget] = useState<SceneAssetTarget | null>(null)
  const assetEditorDraft = useRef(false)
  const [assetEditorResume, setAssetEditorResume] = useState(0)
  const onAssetEditorDraft = useCallback((dirty: boolean) => { assetEditorDraft.current = dirty }, [])
  const guardAssetEditorDeparture = () => {
    if (!assetEditorDraft.current) return true
    setMessage('素材编辑还有未采用的图像草稿，请返回编辑页继续，或明确丢弃后再离开。')
    setAssetEditorResume(value => value + 1)
    return false
  }

  const [structure, setStructure] = useState<StructurePreview | null>(null), [audience, setAudience] = useState<'gm' | 'player'>('gm'), [groundView, setGroundView] = useState(false)
  const structureRef = useRef<StructurePreview | null>(null)
  structureRef.current = structure
  const [sketch, setSketch] = useState<BuildingSketch | null>(null)
  const [openingTool, setOpeningTool] = useState<OpeningTool | null>(null)
  const [outdoorSketch, setOutdoorSketch] = useState<OutdoorSketch | null>(null)
  const [roadSettings, setRoadSettings] = useState<RoadDrawingSettings | null>(null)
  const [elevationSession, setElevationSession] = useState<{ document: SceneDocument; checkpoint: number; ids: string[]; state: TerrainElevationToolState } | null>(null)
  const elevationEpoch = useRef(0)
  const [sculptSession, setSculptSession] = useState<{ document: SceneDocument; checkpoint: number; ids: string[]; operationId: string; state: TerrainSculptToolState } | null>(null)
  const sculptEpoch = useRef(0)
  const [roadStart, setRoadStart] = useState<{ id: string; document: SceneDocument; checkpoint: number; start: RoadDoorStart } | null>(null)
  const [atmosphereBypass, setAtmosphereBypass] = useState(false)
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
  const hasReview = !!structure || !!restore || !!structureRestore || reviewIds.size > 0 || !!terrainLocalPreview
  const detailBeforeReview = useRef(detailMode)
  useEffect(() => { if (hasReview && audience === 'gm') { detailBeforeReview.current = detailMode; setCatalogDetailOpen(false); setDetailMode('review'); setPanelRequest(current => ({ id: 'inspector', sequence: (current?.sequence ?? 0) + 1 })) } else setDetailMode(current => current === 'review' ? detailBeforeReview.current === 'review' ? 'selection' : detailBeforeReview.current : current) }, [hasReview, audience])
  const aiCriticalRef = useRef(aiCritical)
  aiCriticalRef.current = aiCritical
  const aiShown = !!aiPreview && showAiDraft && audience === 'gm'
  useEffect(() => { setAiPreview(null); setShowAiDraft(false) }, [completeProject?.document.sceneId, sessionGeneration])
  useEffect(() => { setEnhancementTarget(null) }, [completeProject?.document.sceneId, sessionGeneration])
  const previewRef = useRef(false)
  previewRef.current = !!localGenerationPreview || domainSummary.hasCandidate || domainSummary.hasDraft || !!regionalPreview || !!structure || !!restore || !!structureRestore || !!terrainPreview || !!terrainEditPreview || !!terrainLocalPreview
  const editingBlocked = localGenerationBusy || !!localGenerationPreview || domainSummary.blocking || regionalBusy || !!regionalPreview || !!structure || !!restore || !!structureRestore || !!terrainPreview || terrainBusy || !!terrainEditPreview || terrainEditBusy || !!terrainLocalPreview || terrainLocalBusy || aiShown || aiCritical
  const placingRef = useRef(false)
  placingRef.current = !!placement || !!fillCopy
  const file = useRef<HTMLInputElement>(null), controller = useRef<AbortController | null>(null), shell = useRef<HTMLDivElement>(null), dialog = useRef<HTMLDivElement>(null)
  const modalOrigin = useRef<HTMLElement | null>(null)
  const actionPending = useRef(false)
  const activeRef = useRef(active)
  activeRef.current = active
  const transient = (exceptDomain?: GenerationDomain): WorkspaceTransient => {
    const domains = domainOperations.summary(exceptDomain)
    return { busy: busy || localGenerationBusy || domains.busy || terrainBusy || terrainEditBusy || regionalBusy || actionPending.current || catalogPending.current || aiCritical, preparing: !!controller.current && creatingStageRef.current !== 'saving',
      newScene, candidate: !!candidate, terrainPreview: domains.hasDraft || domains.hasCandidate || !!localGenerationPreviewRef.current || localGenerationDraftRef.current || !!terrainPreview || !!terrainEditPreview || !!terrainLocalPreview || terrainEditDraft || !!regionalPreview || regionalDraft, placement: !!placement || !!fillCopy, prefabPlacement: !!prefabPlacement, sketch: !!sketch,
      outdoorSketch: !!outdoorSketch || !!openingTool, restore: !!restore, structureRestore: !!structureRestore, structure: !!structure, aiPreview: aiShown, imageImport: imageImportDraftRef.current !== null, ...formDrafts }
  }
  const transientRef = useRef(transient)
  transientRef.current = transient
  const generationTransitionReason = (domain: GenerationDomain) => workspaceTransitionReason(transientRef.current(domain))
  const guard = (completing?: WorkspaceDraft | readonly WorkspaceDraft[]) => {
    const reason = workspaceTransitionReason(transientRef.current(), completing)
    if (reason) { setMessage(reason); return false }
    return true
  }
  const hasDraft = imageImportDraft !== null || domainSummary.hasDraft || localGenerationDraft || regionalDraft || terrainEditDraft || !!placement || !!fillCopy || !!prefabPlacement || !!sketch || !!outdoorSketch || !!openingTool || Object.values(formDrafts).some(Boolean)
  const editDisabled = busy || catalogBusy || editingBlocked || hasDraft
  const markFormDraft = (key: keyof typeof formDrafts) => setFormDrafts(current => current[key] ? current : { ...current, [key]: true })
  const finishFormDraft = (key: keyof typeof formDrafts, reset = false) => {
    setFormDrafts(current => ({ ...current, [key]: false }))
    if (reset) setFormReset(current => ({ ...current, [key]: current[key] + 1 }))
  }
  const toolDisabled = (completing: readonly WorkspaceDraft[]) => !!workspaceTransitionReason(transient(), completing)
  const sessionActions = useRef<WorkspaceController | null>(null)
  const action = async (run: () => Promise<void>, failureSource = '工程操作', progressMessage = '正在处理完整工程…') => {
    if (actionPending.current) return
    actionPending.current = true
    if (!candidate && !newScene && !document.activeElement?.closest('[role="dialog"]')) modalOrigin.current = document.activeElement as HTMLElement | null
    setBusyMessage(progressMessage); setBusy(true); setMessage(null)
    try { await run() } catch (error) {
      const scene = compositionWorkspace.getState().project?.document
      if (scene) error = historyPreviewError(error, scene)
      if (error instanceof Error && error.name === 'AbortError') setMessage('准备已取消，当前工程和本地存档未改变。')
      else setMessage(`${failureSource}：${error instanceof Error ? error.message : String(error)}`)
    }
    finally { actionPending.current = false; setBusy(false) }
  }
  const applyEditHistory = (direction: 'undo' | 'redo') => {
    const checkpoint = compositionWorkspace.checkpoint()
    compositionWorkspace[direction]()
    const changed = compositionWorkspace.checkpoint() !== checkpoint
    setMessage(changed ? direction === 'undo' ? '已撤销上一次编辑，可用顶部“重做”恢复。' : '已重做一次编辑，可用顶部“撤销”撤回。' : direction === 'undo' ? '当前没有可撤销的编辑。' : '当前没有可重做的编辑。')
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
    setDetailMode('selection'); setCatalogDetailOpen(false); setInspectedLayerId('')
    setFormDrafts(initialFormDrafts())
    sculptEpoch.current++; setSculptSession(null); setRoadStart(null); setAtmosphereBypass(false)
    elevationEpoch.current++; setElevationSession(null); setOpeningTool(null); setStructure(null); setRestore(null); setStructureRestore(null); setSketch(null); setOutdoorSketch(null); setPrefabPlacement(null); setAudience('gm'); setMemberMode(false); setHiddenLayerIds(new Set()); setSoloLayerId(null); setCurrentOnly(false); setChosenFloorId(''); setLayerMoveRequest(0); setCurrentLayerId(Object.keys(completeProject?.document.userLayers ?? {})[0] ?? '')
  }, [project?.document.sceneId, sessionGeneration])
  useEffect(() => { if (structureRef.current) compositionWorkspace.cancelPreview(structureRef.current.prepared); setStructure(null) }, [project?.document.sceneId, project?.document.revision])
  useEffect(() => { if (restoreRef.current) compositionWorkspace.cancelRestore(restoreRef.current); setRestore(null) }, [project?.document.sceneId, project?.document.revision])
  useEffect(() => { setRestoreConfirmed(false) }, [restore])
  useEffect(() => { if (structureRestoreRef.current) compositionWorkspace.cancelStructureRestore(structureRestoreRef.current); setStructureRestore(null) }, [project?.document.sceneId, project?.document.revision])
  useEffect(() => { setOpeningTool(null); setPlacement(null); setFillCopy(null); setMenu(null); setSketch(null); setOutdoorSketch(null); if (project) selectionSession.set(normalizeSelection(project.document, selectionSession.getSnapshot(), true).filter(id => !scopedHiddenIds.has(id))) }, [project, audience, scopedHiddenIds])
  useEffect(() => {
    if (import.meta.env.DEV) Reflect.set(window, '__sceneweaveOutdoorDev', { workspace: compositionWorkspace, repository })
    const unload = (event: BeforeUnloadEvent) => { if (workspaceTransitionReason(transientRef.current()) || !['empty', 'saved'].includes(compositionWorkspace.getState().status)) { event.preventDefault(); event.returnValue = '' } }
    const key = (event: KeyboardEvent) => {
      if (!activeRef.current) return
      if (event.isComposing || event.keyCode === 229) return
      // Canvas Escape prevents its browser default before this candidate-level handler.
      // Menus, drawers and temporary details stop propagation when they own the event.
      if (event.key === 'Escape' && shell.current?.querySelector('[data-catalog-detail-open="true"]')) return
      if (actionPending.current || aiCriticalRef.current) return
      if (localGenerationDraftRef.current || localGenerationAbort.current || localGenerationPreviewRef.current) {
        if (event.key === 'Escape' && !(event.target as HTMLElement)?.closest('input,textarea,select,[contenteditable]')) { event.preventDefault(); cancelLocalGeneration() }
        if ((event.metaKey || event.ctrlKey) && ['z', 'y', 's'].includes(event.key.toLowerCase()) && !(event.target as HTMLElement)?.closest('input,textarea,select,[contenteditable]')) { event.preventDefault(); setMessage('请先采用或取消局部重生成候选。') }
        return
      }
      const domainOperation = domainOperations.active()
      if (domainOperation) {
        const domain = domainOperation.domain
        if (event.key === 'Escape' && !(event.target as HTMLElement)?.closest('input,textarea,select,[contenteditable]')) { event.preventDefault(); cancelDomain(domain, true, domain === 'mixed') }
        if ((event.metaKey || event.ctrlKey) && ['z', 'y', 's'].includes(event.key.toLowerCase()) && !(event.target as HTMLElement)?.closest('input,textarea,select,[contenteditable]')) { event.preventDefault(); setMessage(`请先保存或取消${{ interior: '室内布局', forest: '森林与营地', volcano: '火山', mixed: '混合场景' }[domain]}候选。`) }
        return
      }
      if (terrainEditDraftRef.current || terrainEditPreviewRef.current || terrainEditAbort.current) {
        if (event.key === 'Escape' && !(event.target as HTMLElement)?.closest('input,textarea,select,[contenteditable]')) { event.preventDefault(); cancelTerrainEditing() }
        if ((event.metaKey || event.ctrlKey) && ['z', 'y', 's'].includes(event.key.toLowerCase()) && !(event.target as HTMLElement)?.closest('input,textarea,select,[contenteditable]')) { event.preventDefault(); setMessage('请先采用或取消当前地形修改。') }
        return
      }
      if (terrainAbort.current || terrainPreviewRef.current) {
        if (event.key === 'Escape' && !(event.target as HTMLElement)?.closest('input,textarea,select,[contenteditable]')) { event.preventDefault(); cancelTerrain(); setMessage('已取消地形生成，当前工程和本地存档未改变。') }
        return
      }
      if (regionalAbort.current || regionalPreviewRef.current) {
        if (event.key === 'Escape' && !(event.target as HTMLElement)?.closest('input,textarea,select,[contenteditable]')) { event.preventDefault(); cancelRegional(); setMessage('已取消区域生成，当前工程和本地存档未改变。') }
        return
      }
      if (previewRef.current) { if (event.key === 'Escape' && !(event.target as HTMLElement)?.closest('input,textarea,select,[contenteditable]')) { event.preventDefault(); if (regionalPreviewRef.current) { compositionWorkspace.cancelRegional(regionalPreviewRef.current); regionalPreviewRef.current = null; setRegionalPreview(null); setRegionalDraft(false); setRegionalReset(value => value + 1) }; if (terrainPreviewRef.current) { terrainOperation.current++; terrainClient.current?.cancel(); compositionWorkspace.cancelTerrainGeneration(terrainPreviewRef.current); terrainPreviewRef.current = null; setTerrainPreview(null) }; if (terrainLocalPreviewRef.current) { compositionWorkspace.cancelTerrainLocalRefresh(terrainLocalPreviewRef.current); terrainLocalPreviewRef.current = null; setTerrainLocalPreview(null); setTerrainLocalError(null) }; if (structureRef.current) cancelStructurePreview(); if (restoreRef.current || structureRestoreRef.current) setMessage('已取消历史恢复预览，工程未修改。'); if (restoreRef.current) compositionWorkspace.cancelRestore(restoreRef.current); setRestore(null); if (structureRestoreRef.current) compositionWorkspace.cancelStructureRestore(structureRestoreRef.current); setStructureRestore(null) }; return }
      if ((event.target as HTMLElement)?.closest('input,textarea,select,[contenteditable]') || event.isComposing || document.querySelector('[role="dialog"],[role="menu"]')) return
      if (event.key === 'Escape' && transientRef.current().outdoorSketch && !transientRef.current().outdoorForm) { event.preventDefault(); setOpeningTool(null); setOutdoorSketch(null); return }
      if (event.key === 'Escape' && placingRef.current) { event.preventDefault(); setPlacement(null); setFillCopy(null); return }
      if (event.key === 'Escape' && transientRef.current().prefabPlacement) { event.preventDefault(); setPrefabPlacement(null); finishFormDraft('prefabForm', true); return }
      if ((event.metaKey || event.ctrlKey) && ['z', 'y', 's'].includes(event.key.toLowerCase())) {
        event.preventDefault()
        if (workspaceTransitionReason(transientRef.current())) { setMessage(workspaceTransitionReason(transientRef.current())); return }
        try {
          if (event.key.toLowerCase() === 's') void action(() => compositionWorkspace.flush())
          else if (event.key.toLowerCase() === 'y' || event.shiftKey) applyEditHistory('redo')
          else applyEditHistory('undo')
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
      if (event.isComposing || event.keyCode === 229) return
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
  const prepare = (factory: (signal: AbortSignal, progress?: LoadProgress) => Promise<EditableProject>, description: string, imageDraftToken?: string): boolean => {
    if (imageDraftToken !== undefined && !imageImportDraftMatches(imageImportDraftRef.current, imageDraftToken)) { setMessage('图片草稿已变化，请返回图片工具重新预览。'); return false }
    if (actionPending.current || !guard(imageDraftToken === undefined ? undefined : 'imageImport')) return false
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
        setCandidate({ project: prepared, checkpoint, description, ...(imageDraftToken === undefined ? {} : { imageDraftToken }) })
      } finally {
        if (controller.current === abort) controller.current = null
        setPreparation(current => current?.abort === abort ? null : current)
      }
    }, '准备打开工程')
    return true
  }
  const openReference = (sceneId: string, reload = false) => {
    if (!guardAssetEditorDeparture()) return
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
      setMessage(reload ? '已重新载入本地工程，本次选区和撤销记录已重置。' : '已打开本地工程，可以继续编辑。')
    }, reload ? '重新打开工程' : '打开本地工程')
  }
  const openNewScene = () => {
    if (!guardAssetEditorDeparture()) return
    if (!guard()) return
    modalOrigin.current = document.activeElement as HTMLElement | null
    setMessage(null); setVisualNewScene(false); setNewScene(true)
  }
  const domainExecutor = (lease: DomainOperationLease) => (request: DomainExecutionRequest) => {
    domainClient.current ??= createDomainGenerationClient()
    return domainClient.current.execute(request, { signal: lease.signal, isCurrent: lease.isCurrent,
      ...(domainSettings.mode === 'server' ? { server: { baseUrl: domainSettings.baseUrl, token: domainSettings.token } } : {}),
    })
  }
  const cancelDomain = (domain: GenerationDomain, reset = true, announce = false) => {
    const cancelled = domainOperations.cancel(domain, { reset })
    if (domain === 'mixed' && announce && cancelled) {
      const subject = cancelled.phase === 'preparing' ? '生成' : cancelled.phase === 'review' ? '候选' : '参数修改'
      setMessage(`已取消混合场景${subject}，当前工程未改变。`)
    }
  }
  const cancelInterior = (reset = true) => cancelDomain('interior', reset)
  const cancelForest = (reset = true) => cancelDomain('forest', reset)
  const cancelVolcano = (reset = true) => cancelDomain('volcano', reset)
  const cancelMixed = (reset = true, announce = false) => cancelDomain('mixed', reset, announce)
  const changeInterior = () => { domainOperations.change('interior') }
  const changeForest = () => { domainOperations.change('forest') }
  const changeVolcano = () => { domainOperations.change('volcano') }
  const changeMixed = () => { domainOperations.change('mixed') }
  const generateDomain = async <K extends GenerationDomain, I,>(domain: K, input: I, prepare: (owned: I, lease: DomainOperationLease) => Promise<DomainPreviewMap[K]>) => {
    if (busy || audience !== 'gm' || domainOperationView(domainOperations.getSnapshot()[domain]).busy) return
    const reason = generationTransitionReason(domain)
    if (reason) { domainOperations.reportError(domain, reason); return }
    const owned = captureJson(input)
    if (domain === 'mixed') setMessage(null)
    const next = await domainOperations.run(domain, lease => prepare(owned, lease))
    if (next) { setSelected(null); setAudience('gm'); setHiddenLayerIds(new Set()); setSoloLayerId(null); setCurrentOnly(false); setFitRequest(value => value + 1) }
  }
  const adoptDomain = async <K extends GenerationDomain,>(domain: K, apply: (preview: DomainPreviewMap[K]) => Promise<void>, success: string, failureSource: string, progressMessage: string) => {
    if (busy || aiCritical || domainOperationView(domainOperations.getSnapshot()[domain]).busy) return
    await action(async () => {
      const adopted = await domainOperations.adopt(domain, async preview => { await ready(); await apply(preview) })
      if (adopted) { setSelected(null); setSessionGeneration(value => value + 1); setMessage(success) }
    }, failureSource, progressMessage)
  }
  const generateInterior = (input: InteriorGenerationUiRequest) => generateDomain('interior', input, async (owned, lease) => {
    const request = await prepareGenerationIntent({ domain: 'interior', request: owned }, { runtime, content: browserGenerationContent, selectBudget: selectBrowserGenerationBudget, signal: lease.signal })
    lease.assertCurrent()
    return compositionWorkspace.previewGeneration(request, { signal: lease.signal, epoch: lease.epoch, execute: domainExecutor(lease) })
  })
  const adoptInterior = () => adoptDomain('interior', preview => compositionWorkspace.adoptGeneration({ kind: 'new-project', domain: 'interior', preview }),
    '室内布局已完整保存并打开。首次建议的门和家具可继续修改、删除，不会自动补回。', '保存室内布局', '正在保存室内布局并准备打开…')
  const generateVolcano = (input: VolcanoGenerationUiRequest) => generateDomain('volcano', input, async (owned, lease) => {
    const request = await prepareGenerationIntent({ domain: 'volcano', request: owned }, { runtime, content: browserGenerationContent, selectBudget: selectBrowserGenerationBudget, signal: lease.signal })
    lease.assertCurrent()
    return compositionWorkspace.previewGeneration(request, { signal: lease.signal, epoch: lease.epoch, execute: domainExecutor(lease) })
  })
  const adoptVolcano = () => adoptDomain('volcano', preview => compositionWorkspace.adoptGeneration({ kind: 'new-project', domain: 'volcano', preview }),
    '火山已完整保存并打开。地形、危险与通行策略可继续独立修改，不会自动补回。', '保存火山', '正在保存火山场景并准备打开…')
  const generateMixed = (input: MixedGenerationUiRequest) => generateDomain('mixed', input, async (owned, lease) => {
    const request = await prepareGenerationIntent({ domain: 'mixed', request: owned }, { runtime, content: browserGenerationContent, selectBudget: selectBrowserGenerationBudget, signal: lease.signal })
    lease.assertCurrent()
    return compositionWorkspace.previewGeneration(request, { signal: lease.signal, epoch: lease.epoch, execute: domainExecutor(lease) })
  })
  const adoptMixed = () => adoptDomain('mixed', preview => compositionWorkspace.adoptGeneration({ kind: 'new-project', domain: 'mixed', preview }),
    '混合场景已完整保存并打开。首次建议的门、家具和接入路线可继续修改、删除，不会自动补回。', '保存混合场景', '正在保存混合场景并准备打开…')
  const generateForest = (input: ForestGenerationUiRequest) => generateDomain('forest', input, async (owned, lease) => {
    const request = await prepareGenerationIntent({ domain: 'forest', request: owned }, { runtime, content: browserGenerationContent, selectBudget: selectBrowserGenerationBudget, signal: lease.signal })
    lease.assertCurrent()
    return compositionWorkspace.previewGeneration(request, { signal: lease.signal, epoch: lease.epoch, execute: domainExecutor(lease) })
  })
  const adoptForest = () => adoptDomain('forest', preview => compositionWorkspace.adoptGeneration({ kind: 'new-project', domain: 'forest', preview }),
    '森林与营地已完整保存并打开。道路与植被可继续修改、删除，不会自动补回。', '保存森林与营地', '正在保存森林与营地并准备打开…')
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
    const reason = workspaceTransitionReason({ ...transientRef.current(), terrainPreview: !!localGenerationPreviewRef.current || localGenerationDraftRef.current || domainOperations.summary().blocking })
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
    const reason = workspaceTransitionReason({ ...transientRef.current(), terrainPreview: !!localGenerationPreviewRef.current || localGenerationDraftRef.current || domainOperations.summary().blocking || !!terrainPreviewRef.current })
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
    const reason = workspaceTransitionReason({ ...transientRef.current(), terrainPreview: domainOperations.summary().blocking || !!terrainPreviewRef.current || !!terrainEditPreviewRef.current || terrainEditDraftRef.current || !!terrainLocalPreviewRef.current || !!regionalPreviewRef.current || regionalDraft })
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
    const reason = workspaceTransitionReason({ ...transientRef.current(), terrainPreview: !!localGenerationPreviewRef.current || localGenerationDraftRef.current || domainOperations.summary().blocking || !!terrainPreviewRef.current })
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
    const reason = workspaceTransitionReason({ ...transientRef.current(), terrainPreview: !!localGenerationPreviewRef.current || localGenerationDraftRef.current || domainOperations.summary().blocking || !!terrainPreview || !!terrainEditPreview || terrainEditDraft })
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
  const requestImport = () => { if (guardAssetEditorDeparture() && guard()) file.current?.click() }
  const leave = async (): Promise<boolean> => {
    if (!guardAssetEditorDeparture()) return false
    if (!guard()) return false
    actionPending.current = true; setBusyMessage('正在保存当前编辑，完成后离开…'); setBusy(true)
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
    else if (requested.type === 'generate') { if (guard()) { setAudience('gm'); openResources('generate') } }
    else if (requested.type === 'import') requestImport()
    else if (requested.type === 'image-import') { if (guard('imageImport')) { setAudience('gm'); setSidebar('scene'); openResources('scene'); setImageImportRequest(value => value + 1) } }
    else if (requested.type === 'open') openReference(requested.sceneId)
    else if (requested.type === 'open-project') {
      if (!guardAssetEditorDeparture()) return
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
      setNewScene(false); setSelected(null); setAudience('gm'); setSidebar('building')
    } finally { if (controller.current === abort) controller.current = null; creatingStageRef.current = null; setCreatingStage(null) }
  }, '创建空白场景')
  const cancelNewScene = () => {
    if (actionPending.current && creatingStageRef.current !== 'preparing') return
    if (creatingStageRef.current === 'preparing') controller.current?.abort()
    setNewScene(false)
  }
  useEffect(() => {
    if (completeProject && completeProject.document.userLayers[currentLayerId]?.floorId !== activeFloorId) setCurrentLayerId(Object.values(completeProject.document.userLayers).find(layer => layer.floorId === activeFloorId)?.id ?? '')
  }, [completeProject?.document, currentLayerId, activeFloorId])
  const choosePlacement = (definitionId: string, position?: PointMm) => {
    if (!project || !completeProject || audience !== 'gm' || !guard()) return
    try {
      const layer = completeProject.document.userLayers[currentLayerId]
      if (!layer || layer.editLocked || effectiveHiddenLayers.has(layer.id)) throw new Error('请先选择可见且未锁定的当前图层。')
      const b = resolveFloorOutput(completeProject.document, layer.floorId).boundsMm
      const prop = createPlacedProp(completeProject.document, definitionId, position ?? { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) }, runtime, { layerId: currentLayerId })
      setPlacementReady(false); setPlacement({ prop, checkpoint: compositionWorkspace.checkpoint() }); inspect('selection'); enterCanvas(); setMessage(null)
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
      announceSuccess(selected ? `已生成当前完整工程与所选 ${selected.length} 份快照备份。` : '已生成当前完整工程，含全部资源、许可和秘密。')
    }, '下载工程备份', selected ? '正在生成包含所选历史的工程备份…' : '正在生成完整工程备份…')
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
      const environmentFloors = new Set(commands.flatMap(command => command.type === 'setFloorEnvironment' ? [command.id] : []))
      let impact = visual.length ? inspectVisualChanges(completeProject.document, prepared.document, visual) : null
      if (environmentFloors.size) {
        const base = impact ?? inspectVisualChanges(completeProject.document, prepared.document, [])
        const affected = new Set([...base.affectedIds, ...environmentFloors]), layers = new Set(base.layerIds)
        for (const scene of [completeProject.document, prepared.document]) {
          for (const layer of Object.values(scene.userLayers)) if (environmentFloors.has(layer.floorId)) layers.add(layer.id)
          for (const [id, layerId] of Object.entries(scene.entityLayers)) if (environmentFloors.has(scene.userLayers[layerId]?.floorId)) affected.add(id)
          const currentVisual = visualBase(scene)
          for (const key of ['boundaries', 'edgeLooks', 'lights', 'fogs', 'filters'] as const) for (const row of Object.values(currentVisual?.[key] ?? {})) if (environmentFloors.has(row.floorId)) affected.add(row.id)
          if (scene.visual?.version === 3) for (const row of [...Object.values(scene.visual.transitions), ...Object.values(scene.visual.base.materializedEdges)]) if (environmentFloors.has(row.floorId)) affected.add(row.id)
        }
        impact = { ...base, affectedIds: [...affected].sort(), layerIds: [...layers].sort() }
      }
      setStructure({ prepared, checkpoint, commands, document: prepared.document, description, ...(impact ? { kind: 'visual' as const, scopeIds: impact.affectedIds, layerIds: impact.layerIds, confirmed: false } : commands.every(command => command.type === 'setSceneDisplay' || command.type === 'setSceneBackground') ? { kind: 'display' as const } : scopeIds ? { kind: 'layer' as const, scopeIds } : {}) })
      if (completingPrefab) setPrefabPlacement(null)
      if (form) finishFormDraft(form, form === 'propAppearanceForm')
    }, '候选未通过，工程未修改')
  }
  const previewOutdoor = (commands: OutdoorCommand[], description: string, selectionAfterAdopt?: string | null, form: 'outdoorForm' | 'outdoorInspector' | 'elevationForm' | 'sculptForm' = 'outdoorForm') => {
    if (!completeProject || audience !== 'gm' || !guard([form, ...(form === 'outdoorForm' ? ['outdoorSketch' as const] : [])])) return
    const requestedElevationEpoch = elevationEpoch.current, requestedSculptEpoch = sculptEpoch.current
    void action(async () => {
      const checkpoint = compositionWorkspace.checkpoint()
      const prepared = await compositionWorkspace.preview(commands).catch(error => { throw outdoorPreviewError(error, completeProject.document) })
      if (form === 'elevationForm' && requestedElevationEpoch !== elevationEpoch.current) { compositionWorkspace.cancelPreview(prepared); return }
      if (form === 'sculptForm' && requestedSculptEpoch !== sculptEpoch.current) { compositionWorkspace.cancelPreview(prepared); return }
      const before = completeProject.document, after = prepared.document
      const roots = commands.flatMap(command => 'id' in command ? [command.id] : 'areaId' in command ? [command.areaId] : 'groupId' in command ? [command.groupId] : [])
      const impact = inspectOutdoorChanges(before, after, roots), scopeIds = impact.affectedIds, layerIds = impact.layerIds
      if (form === 'outdoorForm') setOutdoorSketch(null)
      if (form === 'elevationForm') setElevationSession(null)
      if (form === 'sculptForm') setSculptSession(null)
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
        const result = await compositionWorkspace.previewTerrainDressing(catalogProject, { sceneId: completeProject.document.sceneId, floorId: activeFloorId, seed: 'terrain-dressing-0' }, { checkpoint, signal: abort.signal })
        const prepared = result.preview, commands = [...prepared.commands], before = completeProject.document, after = prepared.document
        if (abort.signal.aborted) { compositionWorkspace.cancelPreview(prepared); abort.signal.throwIfAborted() }
        const visual = commands.filter(isVisualCommand), visualImpact = visual.length ? inspectVisualChanges(before, after, visual) : null
        const roots = commands.flatMap(command => 'id' in command ? [command.id] : 'areaId' in command ? [command.areaId] : 'groupId' in command ? [command.groupId] : [])
        const outdoorImpact = inspectOutdoorChanges(before, after, roots)
        setStructure({ prepared, checkpoint, commands, document: after, description: `地形层次与布景 · 编辑对象 ${result.cost.total}/${result.cost.limit}`, kind: 'visual', scopeIds: [...new Set([...outdoorImpact.affectedIds, ...(visualImpact?.affectedIds ?? [])])], layerIds: [...new Set([...outdoorImpact.layerIds, ...(visualImpact?.layerIds ?? [])])], confirmed: false })
        setMessage([...result.report.notes, ...(result.report.preservedIds.length ? [`已保留 ${result.report.preservedIds.length} 项锁定或人工内容。`] : [])].join(' '))
      } finally { if (controller.current === abort) controller.current = null }
    }, '层次与布景候选未通过，工程未修改')
  }
  const previewImageCandidate = async (source: ImageEnhancementSource, prepare: (current: EditableProject, signal: AbortSignal) => ReturnType<typeof prepareImageEnhancementCandidate>, signal?: AbortSignal) => {
    signal?.throwIfAborted()
    if (audience !== 'gm' || !guard() || actionPending.current) throw new Error('请先完成当前场景操作，再预览画质候选。')
    const current = compositionWorkspace.getState().project
    if (!current) throw new Error('当前工程已关闭。')
    const checkpoint = compositionWorkspace.checkpoint(), abort = new AbortController()
    const cancel = () => abort.abort()
    signal?.addEventListener('abort', cancel, { once: true })
    controller.current = abort; actionPending.current = true; setBusy(true); setBusyMessage('正在检查画质候选与原始来源…')
    try {
      const candidate = await prepare(current, abort.signal)
      abort.signal.throwIfAborted(); compositionWorkspace.assertCheckpoint(checkpoint)
      const prepared = await compositionWorkspace.previewCatalogCommands(candidate.catalog, candidate.commands, { checkpoint, signal: abort.signal })
      if (abort.signal.aborted) { compositionWorkspace.cancelPreview(prepared); abort.signal.throwIfAborted() }
      setStructure({ prepared, checkpoint, commands: candidate.commands, document: prepared.document,
        description: candidate.label, kind: 'image-enhancement', scopeIds: [source.target.id] })
    } finally {
      signal?.removeEventListener('abort', cancel)
      if (controller.current === abort) controller.current = null
      actionPending.current = false; setBusy(false)
    }
  }
  const previewImageEnhancement = (source: ImageEnhancementSource, recipe: ImageEnhancementRecipe, scope?: Uint8Array, signal?: AbortSignal) => previewImageCandidate(source, (current, activeSignal) => prepareImageEnhancementCandidate(current, source, recipe, scope, activeSignal), signal)
  const previewImageRefinement = (source: ImageEnhancementSource, candidate: ImageRefinementCandidate, signal?: AbortSignal) => previewImageCandidate(source, (current, activeSignal) => prepareImageRefinementCandidate(current, source, candidate, activeSignal), signal)
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
        const result = await prepareAssetBatchImport(completeProject, [input], { validation, runtime, signal: abort.signal })
        const candidate = result.project
        abort.signal.throwIfAborted()
        const prepared = await compositionWorkspace.previewPrepared(candidate, `导入素材 · ${input.name}`, checkpoint)
        if (abort.signal.aborted) { compositionWorkspace.cancelPreview(prepared); abort.signal.throwIfAborted() }
        setStructure({ prepared, checkpoint, commands: [], document: prepared.document, description: `导入${input.kind === 'prop' ? '物件' : '材质'} · ${input.name}`, assetQuality: result.items.map(item => item.quality), qualityAcknowledgments: [] })
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
    actionPending.current=true;setBusyMessage('正在检查导入素材并准备候选…');setBusy(true);setMessage(null);controller.current=abort
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
      const next:StructurePreview={prepared,checkpoint,commands:[],document:prepared.document,description:`批量导入 ${requests.length} 项 · 新增 ${result.addedDefinitionIds.length} 个定义 · 完整新增记录 ${result.operationCost}/256`,assetQuality:[...new Map(result.items.map(item=>[item.quality.key,item.quality])).values()],qualityAcknowledgments:[],assetBatch:{count:requests.length,addedDefinitions:result.addedDefinitionIds.length,operationCost:result.operationCost}}
      structureRef.current=next;setStructure(next)
      batchAssetDraft.current=false;syncAssetDraft()
      return {items,addedDefinitions:result.addedDefinitionIds.length,uniqueImageBytes:result.uniqueImageBytes}
    }catch(error){if(prepared)compositionWorkspace.cancelPreview(prepared);setMessage(`素材批次未采用：${error instanceof Error?error.message:String(error)}`);throw error}
    finally{signal.removeEventListener('abort',cancel);if(controller.current===abort)controller.current=null;actionPending.current=false;setBusy(false)}
  }
  const adoptCatalog = async (input: PreparedCatalogEntryV1[] | ((signal: AbortSignal) => Promise<PreparedCatalogEntryV1[]>), signal?: AbortSignal, use?: CatalogSelectorV1) => {
    // The catalog owns its own pending flag; all other scene tools/drafts still guard adoption.
    const reason = workspaceTransitionReason({ ...transientRef.current(), busy: busy || localGenerationBusy || domainOperations.summary().busy || actionPending.current })
    if (!completeProject || audience !== 'gm' || reason) throw new Error(reason ?? '请先打开主持人工程。')
    const checkpoint = compositionWorkspace.checkpoint(), abort = new AbortController()
    const afterUse = use ? { selector: { ...use }, layerId: currentLayerId, ids: [...selectionSession.getSnapshot()] } : undefined
    if (afterUse?.selector.kind === 'material') assertMaterialTargets(completeProject.document, afterUse.ids)
    const cancel = () => abort.abort()
    signal?.addEventListener('abort', cancel, { once: true })
    if (signal?.aborted) abort.abort()
    actionPending.current = true; setBusyMessage('正在检查素材并准备添加候选…'); setBusy(true); setMessage(null); controller.current = abort
    try {
      const entries = typeof input === 'function' ? await input(abort.signal) : input
      const candidate = await prepareCatalogAdoption(completeProject, entries, abort.signal)
      abort.signal.throwIfAborted()
      compositionWorkspace.assertCheckpoint(checkpoint)
      if (!candidate.operationCost) throw new Error('确切固定素材及完整依赖已在本工程，无需重复采用。')
      const assetQuality = await assessAddedCatalogQuality(completeProject, candidate.project, { ...validation, signal: abort.signal })
      abort.signal.throwIfAborted(); compositionWorkspace.assertCheckpoint(checkpoint)
      const prepared = await compositionWorkspace.previewPrepared(candidate.project, `采用素材库 · ${entries.length} 项`, checkpoint)
      if (abort.signal.aborted) { compositionWorkspace.cancelPreview(prepared); abort.signal.throwIfAborted() }
      setStructure({ prepared, checkpoint, commands: [], document: prepared.document,
        description: `${afterUse ? '添加并' + (afterUse.selector.kind === 'material' ? '应用' : '放置') : '采用素材库'} · ${entries.length} 项素材`, scopeIds: candidate.addedDefinitionIds, afterUse, assetQuality, qualityAcknowledgments: [] })
    } catch (error) {
      setMessage(`素材采用未提交：${error instanceof Error ? error.message : String(error)}`)
      throw error
    } finally {
      signal?.removeEventListener('abort', cancel)
      if (controller.current === abort) controller.current = null
      actionPending.current = false; setBusy(false)
    }
  }
  useEffect(() => {
    if (!pendingCatalogUse || busy || catalogBusy) return
    const pending = pendingCatalogUse
    setPendingCatalogUse(null)
    try {
      compositionWorkspace.assertCheckpoint(pending.checkpoint)
      if (completeProject !== pending.project || audience !== 'gm' || currentLayerId !== pending.request.layerId) throw new Error('工程或图层已变化，请从本工程素材重新选择。')
      const layer = completeProject.document.userLayers[currentLayerId]
      if (!layer || layer.editLocked || effectiveHiddenLayers.has(layer.id)) throw new Error('请先选择可见且未锁定的当前图层。')
      const { selector, ids } = pending.request
      if (selector.kind === 'prop') { choosePlacement(selector.definitionId); revealPanel('inspector') }
      else if (selector.kind === 'prefab') { if (guard()) { setPrefabPlacement(selector.definitionId); setPrefabToolsOpen(true); inspect('selection') } }
      else {
        if (JSON.stringify(ids) !== JSON.stringify(selectionSession.getSnapshot())) throw new Error('所选表面已变化，请重新选择后应用材质。')
        const material = completeProject.document.materials[selector.definitionId]
        if (!material) throw new Error('材质尚未完整加入工程。')
        preview(surfaceMaterialCommands(completeProject, ids, material.id), '将材质应用到所选表面')
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)) }
  }, [pendingCatalogUse, busy, catalogBusy, completeProject, audience, currentLayerId, effectiveHiddenLayers])
  const useCatalogItem = async (source: EditableProject, selector: CatalogSelectorV1, signal?: AbortSignal) => {
    if (selector.kind === 'material') {
      const material = source.document.materials[selector.definitionId], ids = selectionSession.getSnapshot()
      if (!completeProject || !material) throw new Error('请先打开工程并选择有效材质。')
      assertMaterialTargets(completeProject.document, ids, material)
    }
    await adoptCatalog(async inner => [await prepareCatalogEntry(source, selector, inner)], signal, selector)
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
  const previewBuilding = (commands: SceneCommand[], description: string, form: 'buildingForm' | 'buildingInspector' | 'openingTool' | 'outdoorForm' | 'displayForm' = 'buildingForm') => {
    if (!completeProject || audience !== 'gm' || !guard(form === 'openingTool' ? ['outdoorSketch'] : [form, ...(form === 'buildingForm' ? ['sketch' as const] : [])])) return
    void action(async () => {
      const checkpoint = compositionWorkspace.checkpoint(), prepared = await compositionWorkspace.preview(commands), document = prepared.document
      const before = completeProject.document, affected = new Set(aggregateReviewMembers(before, document))
      for (const command of commands) if (command.type === 'setCanvasBounds') for (const [id, layerId] of Object.entries(before.entityLayers)) if (before.userLayers[layerId]?.floorId === command.floorId) affected.add(id)
      for (const command of commands) if (command.type === 'setEntranceOpenings') for (const id of [...before.constraints.entranceOpeningIds, ...document.constraints.entranceOpeningIds]) affected.add(id)
      for (const key of ['floors', 'pathAttachments'] as const) for (const id of new Set([...Object.keys(before[key] ?? {}), ...Object.keys(document[key] ?? {})])) if (JSON.stringify(before[key]?.[id]) !== JSON.stringify(document[key]?.[id])) affected.add(id)
      const impact = inspectBuildingChanges(before, document, [...affected])
      if (!impact.affectedIds.length && JSON.stringify(before.aggregateCoordinates) === JSON.stringify(document.aggregateCoordinates) && JSON.stringify(before.constraints) === JSON.stringify(document.constraints) && JSON.stringify(before.exportBoundsMm) === JSON.stringify(document.exportBoundsMm) && JSON.stringify(before.floors) === JSON.stringify(document.floors) && JSON.stringify(before.pathAttachments) === JSON.stringify(document.pathAttachments) && JSON.stringify(completeProject.historyIdentity) === JSON.stringify(prepared.project.historyIdentity)) throw new Error('参数与当前工程一致，无需采用。')
      setStructure({ prepared, checkpoint, commands, document, description, kind: 'building', scopeIds: impact.affectedIds, layerIds: impact.layerIds, confirmed: false })
      if (form === 'buildingForm') setSketch(null)
      setMessage(null); if (form === 'openingTool') setOpeningTool(null); else finishFormDraft(form)
    }, '候选未通过，工程未修改')
  }
  const select = (id: string | null, operation: 'replace' | 'add' | 'subtract' = 'replace') => { if (!guard()) return; if (id && scopedHiddenIds.has(id)) { const name = completeProject ? createEntityLabeler(completeProject.document)(id) : '该对象'; setMessage(hiddenIds.has(id) ? `「${name}」在编辑视图中隐藏；请在图层中显示它、退出独显，或检查隐藏的支撑/附着对象。` : `「${name}」在当前选择范围外；请在图层中切换当前层或选择「所有可见图层」。`); return } setMenu(null); setMessage(null); setCatalogDetailOpen(false); setDetailMode('selection'); requestAnimationFrame(() => shell.current?.querySelector('.workspace-inspector .workspace-panel-body')?.scrollTo({ top: 0 })); if (id && project?.document.props[id] && Object.values(project.document.prefabInstances).some(group => Object.values(group.members).some(member => member.propId === id))) setMemberMode(true); else if (id && project?.document.prefabInstances[id]) setMemberMode(false); selectionSession.set(!id ? [] : normalizeSelection(project!.document, operation === 'replace' ? [id] : operation === 'add' ? [...selectionSession.getSnapshot(), id] : selectionSession.getSnapshot().filter(current => current !== id), true)) }
  const selectMany = (ids: readonly string[]) => { if (!guard()) return; setMenu(null); setMessage(null); selectionSession.set(ids.filter(id => !scopedHiddenIds.has(id))) }
  const batchAction = (kind: SelectionAction, values?: { dx?: number; dy?: number; angle?: number }, ids = selectionSession.getSnapshot(), checkpoint = compositionWorkspace.checkpoint()) => {
    if (!project || audience !== 'gm' || !guard(kind === 'move' || kind === 'rotate' ? 'selectionForm' : undefined)) return
    void action(async () => {
      compositionWorkspace.assertCheckpoint(checkpoint)
      const commands = selectionCommands(project.document, ids, kind, values, compositionWorkspace.getManualBudget(ids.length))
      const { decorationEdit, scatterEdit, requiresPreview } = selectionActionBehavior(project.document, ids, kind)
      if (!requiresPreview) {
        const before = compositionWorkspace.checkpoint()
        await compositionWorkspace.execute(commands)
        setMessage(compositionWorkspace.checkpoint() !== before ? `已${kind === 'lock' ? '锁定' : '解锁'}所选，作为一次编辑；可用顶部“撤销”撤回。` : '所选对象已是目标锁定状态，未新增编辑或撤销记录。')
        return
      }
      const prepared = await compositionWorkspace.preview(commands)
      finishFormDraft('selectionForm')
      const impact = decorationEdit ? inspectDecorationChanges(completeProject!.document, prepared.document) : scatterEdit ? inspectOutdoorChanges(completeProject!.document, prepared.document, ids) : null
      setStructure({ prepared, checkpoint, commands, document: prepared.document, kind: impact ? 'outdoor' : 'batch', description: `${{ move: '批量移动', rotate: '批量旋转', delete: '删除所选', copy: '复制所选', lock: '锁定所选', unlock: '解锁所选' }[kind]} · ${ids.length} 个选择单元${kind === 'move' ? ` · X ${values?.dx ?? 0} mm / Y ${values?.dy ?? 0} mm` : kind === 'rotate' ? ` · ${values?.angle ?? 0}°` : ''}`, ...(impact ? { scopeIds: impact.affectedIds, layerIds: impact.layerIds, confirmed: false } : {}) })
    }, '整批未采用，工程未修改')
  }
  const canvasClipboardReady = () => active && audience === 'gm' && !editDisabled && !document.querySelector('[role="dialog"],[role="menu"],.workspace-help[open],.workspace-export-menu[open]') && guard()
  const copySelection = () => {
    if (!completeProject || !canvasClipboardReady()) return null
    try {
      const copied = captureSceneClipboard(completeProject, selectionSession.getSnapshot(), compositionWorkspace.getManualBudget(selectionSession.getSnapshot().length))
      clipboard.current = copied
      setMessage(`已复制 ${copied.ids.length} 个独立物件；在画布按 Ctrl / ⌘ + V 预览粘贴。复制源改变后请重新复制。`)
      return copied.marker
    } catch (error) { clipboard.current = null; setMessage(error instanceof Error ? error.message : String(error)); return null }
  }
  const pasteSelection = (marker: string) => {
    if (!completeProject || !canvasClipboardReady()) return
    const copied = clipboard.current
    if (!copied || marker !== copied.marker) { setMessage('剪贴板中没有本次工程会话复制的物件；请先选择独立物件并复制。'); return }
    void action(async () => {
      const checkpoint = compositionWorkspace.checkpoint()
      const commands = pasteSceneClipboard(completeProject, copied, compositionWorkspace.getManualBudget(copied.ids.length))
      const prepared = await compositionWorkspace.preview(commands)
      setStructure({ prepared, checkpoint, commands, document: prepared.document, kind: 'batch', description: `粘贴所选 · ${copied.ids.length} 个独立物件 · X/Y 各偏移 0.3 米` })
    }, '粘贴未生成候选，工程未修改')
  }
  const beginFillCopy = (sourceId: string, count: number, allowOverlap: boolean) => {
    if (!completeProject || audience !== 'gm' || !guard()) return
    const prefab = completeProject.document.prefabInstances[sourceId]
    const members = prefab ? 1 + Object.values(prefab.members).filter(member => member.propId !== null).length : 1
    const limit = compositionWorkspace.getManualBudget(Number.isSafeInteger(count) && count >= 0 ? Math.min(1025, count * members) : 0).semanticTargets
    if (!Number.isSafeInteger(count) || count < 1 || count > limit) { setMessage(`填充份数须为 1–${limit}；独立编辑对象、几何与资源分别完整复核。`); return }
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
    const candidate = structureRef.current
    if (!candidate) return
    compositionWorkspace.cancelPreview(candidate.prepared)
    structureRef.current = null
    setStructure(null)
    setMessage(`已取消「${candidate.description}」预览，工程未修改。`)
  }
  const adoptStructurePreview = () => {
    const candidate = structure
    if (!candidate) return
    try { assertAssetQualityAccepted(candidate.assetQuality ?? [], candidate.qualityAcknowledgments) }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)); return }
    void action(async () => {
      try {
        const checkpoint = compositionWorkspace.checkpoint()
        await compositionWorkspace.adoptPreview(candidate.prepared)
        const changed = compositionWorkspace.checkpoint() !== checkpoint
        if (candidate.assetBatch) { await compositionWorkspace.flush(); finishFormDraft('assetImportForm', true) }
        setStructure(null)
        if (candidate.afterUse) setPendingCatalogUse({ request: candidate.afterUse, project: compositionWorkspace.getState().project!, checkpoint: compositionWorkspace.checkpoint() })
        if (candidate.selectionAfterAdopt !== undefined) setSelected(candidate.selectionAfterAdopt)
        setMessage(changed ? `已采用「${candidate.description}」，作为一次编辑；可用顶部“撤销”整笔撤回。` : '候选与当前工程一致，未新增编辑或撤销记录。')
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
  const visibleCompleteProject = useMemo(() => localGenerationPreview?.project ?? domainPreview?.project ?? regionalPreview?.project ?? terrainLocalPreview?.project ?? terrainEditPreview?.project ?? (aiShown ? aiPreview!.project : terrainPreview?.project ?? structureRestore?.project ?? restore?.project ?? (structure?.prepared.project ?? completeProject)), [completeProject, structure, restore, structureRestore, aiShown, aiPreview, terrainPreview, terrainEditPreview, terrainLocalPreview, regionalPreview, domainPreview, localGenerationPreview])
  const renderProject = useMemo(() => visibleCompleteProject ? visibleCompleteProject : null, [visibleCompleteProject])
  const visibleProject = useMemo(() => renderProject ? domainProject(renderProject) : null, [renderProject])
  const visibleFloorId = visibleProject && visibleProject.document.sceneId !== completeProject?.document.sceneId ? Object.keys(visibleProject.document.floors)[0] : activeFloorId
  const visibleFloor = visibleProject?.document.floors[visibleFloorId]
  const baseMapPreview = terrainPreview?.continuationSource ? terrainPreview : undefined
  const baseMapGenerationBudget = terrainPreview?.continuationSource?.response.generationBudget
  const authoringProject = baseMapPreview?.project ?? completeProject
  const authoringLayerId = authoringProject?.document.userLayers[currentLayerId] ? currentLayerId : Object.keys(authoringProject?.document.userLayers ?? {})[0] ?? ''
  const canPrepareAuthoring = () => {
    if (!baseMapPreview) return guard()
    if (terrainPreviewRef.current !== baseMapPreview || baseMapPreview.checkpoint !== compositionWorkspace.checkpoint()) return false
    const reason = workspaceTransitionReason({ ...transientRef.current(), terrainPreview: !!localGenerationPreviewRef.current || localGenerationDraftRef.current || domainOperations.summary().blocking || !!terrainEditPreview || terrainEditDraft || !!terrainLocalPreview || !!regionalPreview || regionalDraft })
    if (reason) { setMessage(reason); return false }
    return true
  }
  const editorRenderer = useMemo(() => renderProject ? (options: Parameters<typeof renderEditorProject>[1]) => renderEditorProject(toBundle(renderProject), { ...options, floorId: renderProject.document.sceneId !== completeProject?.document.sceneId ? Object.keys(renderProject.document.floors)[0] : activeFloorId, hiddenLayerIds: effectiveHiddenLayers, atmosphereBypass }) : undefined, [renderProject, completeProject?.document.sceneId, activeFloorId, effectiveHiddenLayers, atmosphereBypass])
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
    setMenu(null); selectionSession.set(found.ids); inspect('selection')
    setMessage(`已选择本层 ${found.ids.length} 个对象；排除锁定 ${found.excludedLocked} 个。`)
  }
  const exportImage = (targetAudience: 'gm' | 'player') => { if (completeProject) void action(async () => {
    // Capture the complete immutable project and audience at the click boundary.
    const blob = await exportPng(toBundle(completeProject), { audience: targetAudience, longEdgePx: 4096, floorId: activeFloorId })
    download(blob, `sceneweave-${targetAudience}-map.png`)
    announceSuccess(`${targetAudience === 'gm' ? '主持人' : '玩家'} PNG 已生成 · r${completeProject.document.revision} · ${completeProject.document.floors[activeFloorId].name}固定范围 · 长边 4096 px`)
  }, '导出地图 PNG', `正在生成${targetAudience === 'gm' ? '主持人' : '玩家'}地图 PNG…`) }
  const canFinishCanvas = (completing: readonly WorkspaceDraft[]) => active && audience === 'gm' && !catalogBusy
    && !document.querySelector('[role="dialog"],[role="menu"],.workspace-help[open],.workspace-export-menu[open]') && guard(completing)
  const buildingWorldTool = sketch && audience === 'gm' ? { ...sketch, snapMm: project?.document.units.snapMm ?? 100, onCancel: () => setSketch(null),
    label: sketch.kind === 'ruler' ? '量尺 · 点击两点 · Escape 退出' : '点击绘图 · Enter 预览 · Escape 退出',
    onFinish: sketch.kind === 'ruler' ? undefined : () => {
      if (!canFinishCanvas(['sketch', 'buildingForm'])) return
      const minimum = sketch.kind === 'rectangle' ? 2 : 3
      if (sketch.points.length < minimum) { setMessage(`${sketch.kind === 'rectangle' ? '矩形房间需要 2 个角点' : '多边形房间至少需要 3 个顶点'}，当前 ${sketch.points.length} 点；请继续取点。`); return }
      if (finishBuilding) finishBuilding()
      else setMessage('建筑设置或当前图层尚不可预览，请在建筑面板检查参数与编辑锁。')
    },
    onPoint: (point: PointMm) => setSketch(current => {
      if (!current) return null
      const points = current.kind !== 'polygon' && current.kind !== 'orthogonal' && current.points.length >= 2 ? [point] : [...current.points, point]
      return { ...current, points, cursor: null }
    }), onMove: (point: PointMm) => setSketch(current => current && !(!['polygon', 'orthogonal'].includes(current.kind) && current.points.length >= 2) ? { ...current, cursor: point } : current),
  } : null
  const openingWorldTool = openingTool && audience === 'gm' ? { kind: 'polyline' as const, points: [], cursor: null, snapMm: 1, label: '点击墙面放置门窗 · Escape 退出', onMove: () => {}, onCancel: () => setOpeningTool(null), onPoint: (point: PointMm) => {
    if (!completeProject) return
    try {
      const attachment = openingAtPoint(completeProject.document, point, openingTool.widthMm, scopedHiddenIds)
      previewBuilding([{ type: 'addOpening', id: newId(), ...attachment, kind: openingTool.kind, state: 'closed', locked: false, secret: false, revealed: false, layerId: currentLayerId }], `新增${openingTool.kind === 'door' ? '门' : '窗'}`, 'openingTool')
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)) }
  } } : null
  const cancelElevation = () => { elevationEpoch.current++; setElevationSession(null); finishFormDraft('elevationForm', true); setMessage('已取消高程草稿，工程未修改。') }
  const elevationFresh = !!elevationSession && elevationSession.document === completeProject?.document && elevationSession.checkpoint === compositionWorkspace.checkpoint()
  const elevationWorldTool: CanvasWorldTool | null = elevationSession && elevationFresh && !busy && !editingBlocked && !catalogDetailOpen && sidebar === 'outdoor' && detailMode === 'elevation' && elevationSession.state.mode !== 'idle' && audience === 'gm' ? {
    kind: 'polyline', points: [], cursor: null, snapMm: 1,
    label: elevationSession.state.mode === 'elevate' ? `整面高程草稿 ${elevationSession.state.targetElevationMm} mm · 滚轮升降 · 预览后采用 · Escape 取消` : '点击地面取高 · 只更新目标参数 · Escape 取消',
    elevation: { mode: elevationSession.state.mode, scopeMm: elevationSession.state.mode === 'elevate' && completeProject?.document.terrainAreas[elevationSession.ids[0]] ? terrainPoints(completeProject.document.terrainAreas[elevationSession.ids[0]]) : undefined, onStep: direction => setElevationSession(current => {
      if (!current || current.document !== compositionWorkspace.getState().project?.document || current.checkpoint !== compositionWorkspace.checkpoint()) return current
      try { return { ...current, state: stepTerrainElevation(current.state, direction) } } catch { return current }
    }) }, onMove: () => {}, onCancel: cancelElevation,
    onPoint: point => {
      if (elevationSession.state.mode !== 'sample' || !completeProject) return
      try {
        const floorId = completeProject.document.terrainAreas[elevationSession.ids[0]]?.floorId ?? completeProject.document.userLayers[currentLayerId]?.floorId
        if (!floorId) throw new Error('请先选择当前地形楼层。')
        const sample = sampleTerrainElevation(completeProject.document, floorId, point)
        setElevationSession(current => current ? { ...current, state: { ...current.state, targetElevationMm: sample.elevationMm, mode: 'idle' } } : current)
        setMessage(`已读取「${createEntityLabeler(completeProject.document)(sample.surfaceRef.id)}」高程 ${sample.elevationMm} mm；仅设置工具参数。`)
      } catch (error) { setMessage(error instanceof Error ? error.message : String(error)) }
    },
  } : null
  const cancelSculpt = () => { sculptEpoch.current++; setSculptSession(null); finishFormDraft('sculptForm', true); setMessage('已取消局部高程草稿，工程未修改。') }
  const sculptFresh = !!sculptSession && sculptSession.document === completeProject?.document && sculptSession.checkpoint === compositionWorkspace.checkpoint()
  const sculptWorldTool: CanvasWorldTool | null = sculptSession && sculptFresh && !busy && !editingBlocked && !catalogDetailOpen && sidebar === 'outdoor' && detailMode === 'sculpt' && sculptSession.state.mode === 'polygon' && audience === 'gm' ? {
    kind: 'polygon', points: sculptSession.state.points, cursor: sculptSession.state.cursor, snapMm: project?.document.units.snapMm ?? 100,
    label: '局部台地 / 洼地 · 绘制内部范围 · Enter 预览 · Escape 取消',
    onCancel: cancelSculpt,
    onPoint: point => setSculptSession(current => current && current.document === compositionWorkspace.getState().project?.document && current.checkpoint === compositionWorkspace.checkpoint() ? { ...current, state: { ...current.state, points: [...current.state.points, point], cursor: null } } : current),
    onMove: point => setSculptSession(current => current ? { ...current, state: { ...current.state, cursor: point } } : current),
    onClearCursor: () => setSculptSession(current => current ? { ...current, state: { ...current.state, cursor: null } } : current),
    onFinish: () => { if (canFinishCanvas(['sculptForm'])) finishSculpt?.() },
  } : null
  const canvasWorldTool = sculptWorldTool ?? elevationWorldTool ?? openingWorldTool ?? terrainEditCanvas?.scopeTool ?? (outdoorSketch && audience === 'gm' ? { ...outdoorSketch, road: outdoorSketch.purpose === 'path' ? roadSettings ?? undefined : undefined, snapMm: project?.document.units.snapMm ?? 100, label: '室外草图 · 逐点取坐标 · Enter 预览 · Escape 退出',
    onFinish: () => {
      if (!canFinishCanvas(['outdoorSketch', 'outdoorForm'])) return
      const minimum = outdoorSketch.kind === 'polyline' ? 2 : 3
      if (outdoorSketch.points.length < minimum) { setMessage(`${minimum === 2 ? '道路和连接至少需要 2 个点' : '地形和区域至少需要 3 个顶点'}，当前 ${outdoorSketch.points.length} 点；请继续取点。`); return }
      if (finishOutdoor) finishOutdoor()
      else setMessage('室外设置或当前图层尚不可预览，请在地形面板检查参数与编辑锁。')
    },
    onCancel: () => setOutdoorSketch(null), onPoint: (point: PointMm) => setOutdoorSketch(current => current ? { ...current, points: current.purpose === 'connection' && current.points.length >= 2 ? [point] : [...current.points, point], cursor: null } : current),
    onMove: (point: PointMm) => setOutdoorSketch(current => current ? { ...current, cursor: point } : current),
    onClearCursor: () => setOutdoorSketch(current => current ? { ...current, cursor: null } : current),
  } : buildingWorldTool)
  const saveLabels = { empty: '尚未打开工程', saved: '本地已保存', unsaved: '等待保存', saving: '正在保存', error: '保存失败', conflict: '版本冲突' }
  const transitionReason = workspaceTransitionReason(transient())
  const exportBlockedReason = !completeProject ? '请先新建或打开工程，再导出地图或备份。'
    : busy || editingBlocked ? transitionReason ?? '当前操作尚未结束，请等待完成，或采用/取消候选后再导出。' : null
  const openLayers = () => { setSidebar('scene'); revealPanel('resources') }
  const changeSelectionView = (change: () => void) => { if (guard()) { change(); setMessage(null) } }
  const panelKey = `${completeProject?.document.sceneId ?? 'empty'}-${sessionGeneration}-${activeFloorId}`
  const changeFloor = (floorId: string) => {
    if (!completeProject?.document.floors[floorId] || floorId === activeFloorId || !guard()) return
    setChosenFloorId(floorId); setCurrentLayerId(Object.values(completeProject.document.userLayers).find(layer => layer.floorId === floorId)?.id ?? '')
    selectionSession.set([]); setInspectedLayerId(''); setSoloLayerId(null); setCurrentOnly(false); setMenu(null); clipboard.current = null
    setMessage(`当前楼层：${completeProject.document.floors[floorId].name}。编辑、预览和PNG使用此层。`)
  }
  const layerPanel = completeProject && audience === 'gm' ? <UserLayerPanel activeFloorId={activeFloorId} key={panelKey} scene={completeProject.document} session={selectionSession}
    currentLayerId={currentLayerId} inspectedLayerId={inspectedLayerId} onInspect={id => { if (id !== inspectedLayerId && formDrafts.appearanceForm) { setMessage('请先预览或取消当前图层外观草稿，再查看其他图层参数。'); return }; setInspectedLayerId(id); inspect('layer') }} hiddenLayerIds={hiddenLayerIds} soloLayerId={soloLayerId} currentOnly={currentOnly}
    disabled={editDisabled} onCurrent={id => { const layer = completeProject.document.userLayers[id]; if (layer.floorId !== activeFloorId) { changeFloor(layer.floorId); return }; changeSelectionView(() => setCurrentLayerId(id)) }}
    onHidden={id => changeSelectionView(() => setHiddenLayerIds(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next }))}
    onSolo={id => changeSelectionView(() => setSoloLayerId(current => current === id ? null : id))} onScope={value => changeSelectionView(() => setCurrentOnly(value))}
    moveRequest={layerMoveRequest} onSelectLayer={selectLayer} onCommand={commands => commit(() => compositionWorkspace.execute(commands))} onPreview={preview}/> : null
  const openResources = (module: typeof sidebar) => { setSidebar(module); revealPanel('resources') }
  const openHistory = () => { setSidebar('history'); revealPanel('resources') }
  const startBuildingTool = (kind: BuildingSketch['kind']) => { if (!completeProject || !guard()) return; setBuildingTask(kind === 'ruler' ? 'ruler' : 'room'); if (kind !== 'ruler') markFormDraft('buildingForm'); setDetailMode('building'); setCatalogDetailOpen(false); setSketch({ kind, points: [], cursor: null }); setSidebar('building'); enterCanvas() }
  const startDoorRoad = (request: RoadDoorStartRequest) => {
    if (!completeProject || audience !== 'gm' || !guard()) return
    try {
      const checkpoint = compositionWorkspace.checkpoint(), start = prepareRoadDoorStart(completeProject.document, request, scopedHiddenIds)
      compositionWorkspace.assertCheckpoint(checkpoint)
      const layers = Object.values(completeProject.document.userLayers).filter(layer => layer.floorId === start.floorId && !layer.editLocked && !effectiveHiddenLayers.has(layer.id))
      const layerId = layers.find(layer => layer.id === currentLayerId)?.id ?? layers[0]?.id
      if (!layerId) throw new Error('门口所在楼层没有可见且未锁定的绘图层。')
      setCurrentLayerId(layerId); setOutdoorTab('draw'); setOutdoorTask('path'); setSidebar('outdoor'); inspect('outdoor')
      setRoadStart({ id: newId(), document: completeProject.document, checkpoint, start })
      setMessage('已准备门前道路首点；继续取点、预览并采用后才会写入工程。')
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)) }
  }
  // Run after layer/selection reset effects, so a floor change cannot erase the new draft.
  useEffect(() => {
    if (!roadStart || roadStart.document !== completeProject?.document || roadStart.checkpoint !== compositionWorkspace.checkpoint()) return
    setOutdoorSketch({ kind: 'polyline', purpose: 'path', points: [roadStart.start.point], cursor: null })
    markFormDraft('outdoorForm')
  }, [roadStart, completeProject?.document])
  const startTerrainTool = () => { if (!completeProject || !guard()) return; setOutdoorTab('draw'); setOutdoorTask('terrain'); markFormDraft('outdoorForm'); setDetailMode('outdoor'); setCatalogDetailOpen(false); setOutdoorSketch({ kind: 'polygon', purpose: 'terrain', points: [], cursor: null }); setSidebar('outdoor'); enterCanvas() }
  const showSettings = () => inspect('settings')
  const showNotes = () => { if (!guard()) return; setBuildingTask('note'); setSidebar('building'); inspect('building') }
  const showSamples = () => inspect('samples')
  const resumeDraft = () => {
    if (imageImportDraft !== null) { request({ type: 'image-import' }); return }
    if (sculptSession) { setSidebar('outdoor'); inspect('sculpt'); return }
    if (elevationSession) { setSidebar('outdoor'); inspect('elevation'); return }
    if (localGenerationDraft) { setSidebar('outdoor'); setOutdoorTab('regenerate'); inspect('regenerate'); return }
    if (terrainEditDraft) { setSidebar('outdoor'); setOutdoorTab('edit'); inspect('outdoorEdit'); return }
    const generationDraft = domainSummary.hasDraft ? domainOperations.active()?.domain : regionalDraft ? 'regional' : null
    if (generationDraft) { setGenerationTab(generationDraft); openResources('generate'); return }
    if (formDrafts.catalogForm || formDrafts.assetImportForm) { openResources('library'); return }
    inspect(openingTool || placement || prefabPlacement ? 'selection' : formDrafts.visualForm ? 'visual' : formDrafts.displayForm || formDrafts.titleForm ? 'settings' : formDrafts.appearanceForm && detailMode === 'layer' ? 'layer' : outdoorSketch || formDrafts.outdoorForm ? detailMode === 'dress' ? 'dress' : detailMode === 'outdoorAggregate' ? 'outdoorAggregate' : 'outdoor' : formDrafts.buildingForm || sketch ? 'building' : 'selection')
  }
  const draftControls = <>{(editingBlocked || hasDraft) && <p className="asset-muted" role="status">{openingTool ? '门窗放置尚未结束。请点击墙面继续，或取消门窗工具。' : workspaceTransitionReason({ ...transient(), busy: false, preparing: false })}侧栏浏览保留当前选择、输入和候选。</p>}
          {(placement || prefabPlacement || sketch || outdoorSketch || openingTool) && !editingBlocked && <div className="building-sketch-status" role="group" aria-label="当前工具">
            <span>{placement ? '物件放置' : prefabPlacement ? '组合放置' : sketch ? '建筑绘图或量尺' : openingTool ? '门窗放置' : '室外画布取点'}</span>
            <button className="secondary" disabled={busy} onClick={() => {
              if (placement) setPlacement(null)
              else if (prefabPlacement) { setPrefabPlacement(null); finishFormDraft('prefabForm', true) }
              else if (sketch) setSketch(null)
              else if (openingTool) setOpeningTool(null)
              else setOutdoorSketch(null)
            }}>{placement ? '取消当前放置工具' : prefabPlacement ? '取消组合放置' : sketch ? '取消当前绘图工具' : openingTool ? '取消门窗工具' : '取消当前室外取点'}</button>
          </div>}
          {Object.entries(formDrafts).filter(([, dirty]) => dirty).map(([key]) => <button className="secondary asset-wide" key={key} disabled={busy || editingBlocked} onClick={() => {
            if (key === 'buildingForm') setSketch(null)
            if (key === 'outdoorForm') setOutdoorSketch(null)
            if (key === 'sculptForm') { sculptEpoch.current++; setSculptSession(null) }
            if (key === 'elevationForm') { elevationEpoch.current++; setElevationSession(null) }
            if (key === 'prefabForm') setPrefabPlacement(null)
            finishFormDraft(key as keyof typeof formDrafts, true)
          }}>{workspaceFormDraftLabels[key as WorkspaceFormDraft].cancel}</button>)}</>
  const historyBrowser = completeProject && <HistoryPanel key={panelKey} detailsTarget={historyTarget} detailsActive={detailMode === 'history' && !catalogDetailOpen} onInspect={() => inspect('history')} active={active && audience === 'gm' && sidebar === 'history'} project={completeProject} repository={repository} workspace={compositionWorkspace}
            session={selectionSession} disabled={editDisabled} refreshBlocked={busy || state.status === 'unsaved' || state.status === 'saving'} refreshKey={historyRefresh} onAction={action} onPreview={setRestore} onStructurePreview={setStructureRestore} onBackup={backup}/>
  const sceneBrowser = <SelectionSubscriber session={selectionSession}>{ids => <SceneLibrary floorId={activeFloorId} key={panelKey} project={audience === 'player' ? visibleProject : project}
    selected={ids.length === 1 ? ids[0] : null} selectedIds={[...ids]} busy={editDisabled} layerFilter={inspectedLayerId || undefined} onSelect={(id, operation) => { select(id, operation); if (!workspaceTransitionReason(transient())) inspect('selection') }}
    hiddenIds={audience === 'gm' ? hiddenIds : undefined} excludedIds={audience === 'gm' ? scopedHiddenIds : undefined} onOpenLayers={audience === 'gm' ? openLayers : undefined}/>}</SelectionSubscriber>
  const projectTools = <section className="workspace-project-tools" aria-label="场景设置"><h2>场景设置</h2><p className="asset-muted">全局 · 名称、单位、格线、世界与导出范围。</p>{project && audience === 'gm' && <ProjectTitleForm key={`${project.document.sceneId}-${project.document.revision}-${formReset.titleForm}`} title={project.document.title} disabled={toolDisabled(['titleForm'])} onChange={dirty => dirty ? markFormDraft('titleForm') : finishFormDraft('titleForm')} onCancel={() => finishFormDraft('titleForm', true)} onSave={title => { if (!guard(['titleForm'])) return; void action(async () => { await compositionWorkspace.execute([{ type: 'renameScene', title }]); finishFormDraft('titleForm', true); setMessage('工程已改名，可撤销；名称随工程自动保存。') }, '工程改名') }}/> }{project && audience === 'gm' && <div onChangeCapture={() => markFormDraft('displayForm')}><SceneDisplayPanel key={`${project.document.sceneId}-${project.document.revision}-${formReset.displayForm}`} scene={completeProject!.document} disabled={toolDisabled(['displayForm'])} onPreview={(commands, label) => preview(commands, label, undefined, 'displayForm')}/></div>}{project && <details className="workspace-authoring-details" open={authoringOpen} onToggle={event => setAuthoringOpen(event.currentTarget.open)}><summary>制作教程 · 调查宅邸与海岸哨所</summary>{authoringOpen && <AuthoringGuide project={completeProject!} disabled={editDisabled} onPreview={previewAuthoring} onAdoptRequiredCatalog={adoptAuthoringCatalog}/>}</details>}
{completeProject && audience === 'gm' && <SceneBoundsPanel key={`${panelKey}-${formReset.displayForm}`} scene={completeProject.document} floorId={completeProject.document.userLayers[currentLayerId]?.floorId ?? Object.keys(completeProject.document.floors)[0]} disabled={toolDisabled(['displayForm'])} onDraftChange={dirty => dirty ? markFormDraft('displayForm') : finishFormDraft('displayForm')} onPreview={(commands, description) => previewBuilding(commands, description, 'displayForm')}/>}
    {project && <details className="workspace-advanced"><summary>工程资源与完整性</summary><dl className="asset-facts"><dt>场景修订</dt><dd>r{project.document.revision}</dd><dt>素材字节</dt><dd>{bytesLabel(Object.values(project.assets).reduce((sum, asset) => sum + asset.sizeBytes, 0))}</dd><dt>许可绑定</dt><dd>{project.licenseBindings.length} 条</dd></dl><button className="secondary asset-wide" disabled={busy || editingBlocked} onClick={() => void action(async () => { await validateProjectBundle(toBundle(completeProject!), validation); setMessage('完整工程校验通过：格式、历史身份、位图与许可一致。') }, '当前工程完整性检查')}>校验完整工程</button></details>}
    {audience === 'gm' && project?.document.presetSnapshot.presetId === 'sceneweave-vis02' && <TerrainTravelPanel scene={project.document} disabled={busy || editingBlocked}/>}
    {audience === 'gm' && completeProject?.document.presetSnapshot.presetId === OUTPOST_PRESET_ID && <OutpostTravelPanel scene={completeProject.document} disabled={busy || editingBlocked}/>}
    {completeProject && audience === 'gm' && <FloorTools key={`${panelKey}-${completeProject.document.revision}-${formReset.displayForm}-floors`} scene={completeProject.document} floorId={activeFloorId} disabled={toolDisabled(['displayForm'])} onDraftChange={() => markFormDraft('displayForm')} onPreview={(commands, label) => previewBuilding(commands, label, 'displayForm')}/>}
  </section>
  const sampleTools = <section className="workspace-project-tools" aria-label="场景样板"><details className="workspace-advanced"><summary>从样板开始</summary><h3>视觉创作</h3><button className="secondary asset-wide" disabled={editDisabled} onClick={openVisualNewScene}>新建视觉空白 · 原创素材</button><h3>视觉创作样板</h3><button className="secondary asset-wide" disabled={editDisabled} onClick={() => prepare(signal => createNaturalDetailIslandProject(signal), NATURAL_DETAIL_ISLAND_NAME)}>{NATURAL_DETAIL_ISLAND_NAME}</button><button className="secondary asset-wide" disabled={editDisabled} onClick={() => prepare(signal => createNaturalDetailOutpostProject('balanced', signal), NATURAL_DETAIL_OUTPOST_NAME)}>{NATURAL_DETAIL_OUTPOST_NAME}</button><button className="secondary asset-wide" disabled={editDisabled} onClick={() => prepare(signal => createDetailedIslandProject(signal), DETAILED_ISLAND_NAME)}>{DETAILED_ISLAND_NAME}</button>{(['beach','island','interior'] as const).map(kind => <button key={kind} className="secondary asset-wide" disabled={editDisabled} onClick={() => prepare(signal => createVisualSampleProject(kind, signal), ({beach:'潮声浅湾',island:'苔冠岩岛',interior:'灯下旅舍'})[kind])}>{({beach:'潮声浅湾 · 连续海岸',island:'苔冠岩岛 · 高差与草沿',interior:'灯下旅舍 · 材质与灯光'})[kind]}</button>)}<button className="secondary asset-wide" disabled={editDisabled} onClick={() => prepare(signal => createRefinedIslandProject(signal), REFINED_ISLAND_NAME)}>岬湾苔岛 · 精修版</button><button className="secondary asset-wide" disabled={editDisabled} onClick={() => prepare(signal => createRefinedCoastProject(signal), REFINED_COAST_NAME)}>{REFINED_COAST_NAME}</button><button className="secondary asset-wide" disabled={editDisabled} onClick={() => prepare(signal => createRefinedInteriorProject(signal), REFINED_INTERIOR_NAME)}>{REFINED_INTERIOR_NAME}</button><button className="secondary asset-wide" disabled={editDisabled} onClick={() => prepare(signal => createNearSideIslandProject(signal), NEAR_SIDE_ISLAND_NAME)}>新建近侧视苔岛</button><h3>可编辑样板</h3><button className="secondary asset-wide" disabled={editDisabled} onClick={() => request({ type: 'sample', sample: 'study' })}>书房与露台</button><button className="secondary asset-wide" disabled={editDisabled} onClick={() => request({ type: 'sample', sample: 'island' })}>双层岩岛</button><button className="secondary asset-wide" disabled={editDisabled} onClick={() => request({ type: 'sample', sample: 'outpost' })}>海岸哨所</button><button className="secondary asset-wide" disabled={editDisabled} onClick={() => request({ type: 'sample', sample: 'graveyard' })}>苔石墓园 · 内容小样</button><button className="secondary asset-wide" disabled={editDisabled} onClick={() => request({ type: 'sample', sample: 'volcano' })}>灰烬熔脉 · 内容小样</button></details></section>
  const terrainEditTools = <>{completeProject && completeProject.document.mapMode === 'scene' && completeProject.document.generation && audience === 'gm' && <TerrainEditingPanel floorId={activeFloorId} key={panelKey + '-terrain-edit-' + terrainEditReset} scene={completeProject.document} busy={terrainEditBusy || busy} adopting={busy} disabled={!!workspaceTransitionReason({ ...transient(), terrainPreview: !!localGenerationPreviewRef.current || localGenerationDraftRef.current || domainOperations.summary().blocking || !!terrainPreview, busy: busy || localGenerationBusy || domainOperations.summary().busy || terrainBusy || catalogBusy || aiCritical })} error={terrainEditError} candidate={terrainEditPreview ? { ...terrainEditPreview.result, cost: terrainEditPreview.cost, impact: terrainEditPreview.impact } : null} onPreview={previewTerrainEditing} onAdopt={adoptTerrainEditing} onCancel={cancelTerrainEditing} onCanvasSession={setTerrainEditCanvas} onDraftChange={setTerrainEditDraft}/>}{completeProject && completeProject.document.visual?.version === 3 && <><button className="secondary asset-wide" disabled={editDisabled || terrainLocalBusy} onClick={() => void previewTerrainLocal()}>预览局部地形联动</button>{terrainLocalError && <p className="asset-error" role="alert">{terrainLocalError}</p>}</>}</>
  const dressingTools = <>{audience === 'gm' && completeProject && completeProject.document.mapMode === 'scene' && <button className="secondary asset-wide" disabled={editDisabled} onClick={previewDressing}>预览地形层次与布景</button>}{audience === 'gm' && completeProject && <IslandDressingPanel scene={completeProject.document} disabled={editDisabled} onPrepareSources={previewDecorationSources} onPreview={previewIslandDressing}/>}</>
  const localGenerationTools = <>{audience === 'gm' && completeProject && completeProject.document.mapMode === 'scene' && <LocalGenerationPanel key={`local-${completeProject.document.sceneId}-${completeProject.document.revision}-${localGenerationReset}`} document={completeProject.document} busy={localGenerationBusy || busy} disabled={!!workspaceTransitionReason({ ...transient(), busy: busy || domainOperations.summary().busy || terrainBusy || terrainEditBusy || regionalBusy || catalogBusy || aiCritical, terrainPreview: domainOperations.summary().blocking || !!terrainPreview || !!terrainEditPreview || terrainEditDraft || !!terrainLocalPreview || !!regionalPreview || regionalDraft })} dirty={localGenerationDraft} error={localGenerationError} candidate={localGenerationPreview} onChange={changeLocalGeneration} onPreview={previewLocalGeneration} onAdopt={adoptLocalGeneration} onCancel={() => cancelLocalGeneration()}/>}</>
  const generationTools = <section aria-label="生成地图">
    <div className="workspace-task-heading"><h2>生成地图</h2><p>选择场景类型，调整参数并预览。保存为新工程后可继续手工编辑。</p></div>
    <TaskPicker label="生成场景类型" value={generationTab} onChange={setGenerationTab} choices={[
      { id: 'interior', label: '室内布局', description: '房间、门与家具' },
      { id: 'forest', label: '森林与营地', description: '空地、路线与植被' },
      { id: 'volcano', label: '火山', description: '火口、高台与通路' },
      { id: 'mixed', label: '混合场景', description: '建筑与自然环境' },
      { id: 'natural', label: '自然地形', description: '岩岛、海岸、河湖与丘陵' },
      { id: 'composition', label: '组合地貌', description: '群岛、河谷与台地' },
      { id: 'regional', label: '区域地图', description: '规划旅程与地点' },
    ]}/>
<details className="workspace-advanced workspace-generation-settings"><summary>生成设置 · 执行位置与画面细节</summary><GenerationExecutionSettings value={domainSettings} disabled={editDisabled} onChange={value => { for (const domain of GENERATION_DOMAINS) cancelDomain(domain, false); setDomainSettings(value) }}/><BaseMapGenerationSettings value={baseMapSettings} disabled={editDisabled} onChange={setBaseMapSettings}/></details>
    <div className="workspace-task-section" hidden={generationTab !== 'interior'}><InteriorGenerationPanel key={`interior-${interiorReset}`} busy={interiorBusy || busy} disabled={audience !== 'gm' || aiCritical || !!generationTransitionReason('interior')} dirty={interiorDraft} error={interiorError} candidate={interiorPreview} onChange={changeInterior} onGenerate={generateInterior} onAdopt={adoptInterior} onCancel={() => cancelInterior()}/></div>
    <div className="workspace-task-section" hidden={generationTab !== 'forest'}><ForestGenerationPanel key={`forest-${forestReset}`} busy={forestBusy || busy} disabled={audience !== 'gm' || aiCritical || !!generationTransitionReason('forest')} dirty={forestDraft} error={forestError} candidate={forestPreview} onChange={changeForest} onGenerate={generateForest} onAdopt={adoptForest} onCancel={() => cancelForest()}/></div>
    <div className="workspace-task-section" hidden={generationTab !== 'volcano'}><VolcanoGenerationPanel key={`volcano-${volcanoReset}`} busy={mixedBusy || volcanoBusy || busy} disabled={audience !== 'gm' || aiCritical || !!generationTransitionReason('volcano')} dirty={volcanoDraft} error={volcanoError} candidate={volcanoPreview} onChange={changeVolcano} onGenerate={generateVolcano} onAdopt={adoptVolcano} onCancel={() => cancelVolcano()}/></div>
    <div className="workspace-task-section" hidden={generationTab !== 'mixed'}><MixedGenerationPanel key={`mixed-${mixedReset}`} busy={mixedBusy || busy} disabled={audience !== 'gm' || aiCritical || !!generationTransitionReason('mixed')} dirty={mixedDraft} error={mixedError} candidate={mixedPreview} aiConnection={parameterAiConnection} onChange={changeMixed} onGenerate={generateMixed} onAdopt={adoptMixed} onCancel={() => cancelMixed(true, true)}/></div>
    <div className="workspace-task-section" hidden={generationTab !== 'natural'}><TerrainGenerationPanel busy={terrainBusy || busy || aiCritical} error={terrainError} disabled={!terrainPreview && !terrainBusy && !!workspaceTransitionReason(transient())} disabledReason={workspaceTransitionReason(transient()) ?? undefined} candidate={terrainPreview && !terrainPreview.composition ? { id: terrainPreview.project.document.sceneId, name: terrainPreview.project.document.title, ...terrainPreview.input, terrainCount: Object.keys(terrainPreview.project.document.terrainAreas).length, propCount: Object.keys(terrainPreview.project.document.props).length, connectionCount: Object.keys(terrainPreview.project.document.terrainConnections).length, budgetProfile: terrainPreview.baseMap?.budgetProfile, cost: { ...terrainPreview.cost, items: Object.entries(terrainPreview.cost.items).filter(([, value]) => value > 0).map(([label, value]) => ({ label, value })) }, checks: [{ label: '活动空地与合法登高连接', status: 'passed', detail: '登高连接净宽 1.5 米；完整支撑与几何已检查。' }, ...(terrainPreview.result.route ? [{ label: '指定路线与完整转角净宽', status: 'passed' as const, detail: `净宽 ${terrainPreview.result.route.widthMm / 1000} 米；${terrainPreview.result.route.pointsMm.length - 1} 段道路已检查。` }] : [])] } : null} onGenerate={generateTerrain} onAdopt={adoptTerrain} onCancel={cancelTerrain} onExport={exportTerrain}/></div>
    <div className="workspace-task-section" hidden={generationTab !== 'composition'}><TerrainCompositionPanel busy={terrainBusy || busy || aiCritical} error={terrainError} disabled={!terrainPreview?.composition && !terrainBusy && !!workspaceTransitionReason(transient())} disabledReason={workspaceTransitionReason(transient())} candidate={terrainPreview?.composition?terrainPreview:null} onGenerate={generateComposition} onAdopt={adoptTerrain} onCancel={cancelTerrain} onExport={exportTerrain}/></div>
    <div className="workspace-task-section" hidden={generationTab !== 'regional'}>{audience === 'gm' && <RegionalPanel key={panelKey + '-regional-' + regionalReset} document={completeProject?.document ?? null} busy={regionalBusy || busy} disabled={!!workspaceTransitionReason({ ...transient(), terrainPreview: !!localGenerationPreviewRef.current || localGenerationDraftRef.current || domainOperations.summary().blocking || !!terrainPreview || !!terrainEditPreview || terrainEditDraft, busy: busy || localGenerationBusy || domainOperations.summary().busy || terrainBusy || terrainEditBusy || catalogBusy || aiCritical })} error={regionalError} candidate={regionalPreview} sourceComparison={regionalComparison} onPreviewCreate={input => previewRegional('create', input)} onPreviewEdit={input => previewRegional('edit', input)} onPreviewDrillDown={input => previewRegional('drillDown', input)} onCompareSource={compareRegional} onAdopt={adoptRegional} onCancel={cancelRegional} onDraftChange={setRegionalDraft}/>}</div>
  </section>
  const resourcePanels = <div className="layer-library-stack history-library-stack">
          <div hidden={sidebar !== 'ai' || audience !== 'gm'}><SelectionSubscriber session={selectionSession}>{ids => <><AiConversationPanel
            onConnectionChange={setParameterAiConnection}
            context={completeProject ? { sceneId: completeProject.document.sceneId, revision: completeProject.document.revision, audience: 'public' } : null}
            disabled={domainSummary.blocking || regionalBusy || regionalDraft || !!regionalPreview || busy || terrainBusy || terrainEditBusy || terrainEditDraft || !!terrainEditPreview || !!terrainPreview && !baseMapPreview || !!structure || !!restore || !!structureRestore || audience === 'player'}
            authoring={authoringProject ? { workspace: compositionWorkspace, sessionKey: sessionGeneration, project: authoringProject, baseMapPreview,
              selectedIds: baseMapPreview ? ids.filter(id => Object.hasOwn(authoringProject.document.props, id)) : ids, layerId: authoringLayerId, canPrepare: canPrepareAuthoring,
              onPreview: next => { setAiPreview(next); if (!next) setShowAiDraft(false) }, onRegionalPreview: receiveAiRegionalPreview,
              onAdopted: () => { setAiPreview(null); setShowAiDraft(false); if (baseMapPreview) { terrainPreviewRef.current = null; setTerrainPreview(null); setSelected(null); setSessionGeneration(value => value + 1) }; setHistoryRefresh(value => value + 1) }, onCritical: setAiCritical } : undefined}/></>}</SelectionSubscriber></div>
          <div hidden={sidebar !== 'outdoor' || audience !== 'gm'}><div className="workspace-task-heading"><h2>地形与布景</h2><p>绘制地面和道路，或选择已有地形进行修改。</p></div><TaskPicker label="地形任务" value={outdoorTab} onChange={value => { setOutdoorTab(value); if (value !== 'draw') inspect(value === 'edit' ? 'outdoorEdit' : value === 'dress' ? 'dress' : 'regenerate') }} choices={[{id:'draw',label:'绘制地形',description:'地面、道路与高差连接'},{id:'edit',label:'修改地形',description:'岸线、笔刷与局部联动'},{id:'dress',label:'布置植被',description:'树木、草簇与岩石'},{id:'regenerate',label:'局部重生成',description:'保留人工编辑'}]}/><div className="workspace-task-section" hidden={outdoorTab !== 'draw'} onChangeCapture={event => { if (!(event.target as HTMLElement).closest('[data-aggregate-session-control]')) markFormDraft('outdoorForm') }} onClickCapture={event => { if ((event.target as HTMLElement).closest('.connection-route-fields button')) markFormDraft('outdoorForm') }}>{completeProject && <OutdoorToolsPanel detailsTarget={outdoorTarget} detailsActive={detailMode === 'outdoor' && !catalogDetailOpen} activeTask={outdoorTask} onTaskChange={task => { if (task !== outdoorTask && !guard(['outdoorForm', 'outdoorSketch'])) return; setOutdoorTask(task); inspect('outdoor') }} onBrowseScene={openLayers} key={`${panelKey}-${formReset.outdoorForm}`} scene={completeProject.document} layerId={currentLayerId}
            disabled={toolDisabled(['outdoorSketch', 'outdoorForm']) || effectiveHiddenLayers.has(currentLayerId)} sketch={outdoorSketch}
          onSketch={next => { if (!next) setOutdoorSketch(null); else if (guard('outdoorForm')) { setOutdoorSketch(next); markFormDraft('outdoorForm'); setDetailMode('outdoor'); setCatalogDetailOpen(false); enterCanvas() } }} onPreview={previewOutdoor} onSelect={select} onBoundaryEditor={editConnectionForm} onRoadSettings={setRoadSettings} roadStart={roadStart} onRoadStartConsumed={id => setRoadStart(current => current?.id === id ? null : current)} onFinishReady={onOutdoorFinishReady}/>}
            <button type="button" className="secondary asset-wide" disabled={!completeProject || (!elevationSession && editDisabled)} onClick={() => {
              if (!completeProject) return
              if (elevationSession) { inspect('elevation'); return }
              if (!guard()) return
              const ids = [...selectionSession.getSnapshot()]
              elevationEpoch.current++
              setElevationSession({ document: completeProject.document, checkpoint: compositionWorkspace.checkpoint(), ids, state: createTerrainElevationToolState(completeProject.document, ids) })
              markFormDraft('elevationForm'); inspect('elevation')
            }}>{elevationSession ? '继续整面高程' : '开始整面高程'}</button>
            <button type="button" className="secondary asset-wide" disabled={!completeProject || (!sculptSession && editDisabled)} onClick={() => {
              if (!completeProject) return
              if (sculptSession) { inspect('sculpt'); return }
              if (!guard()) return
              const ids = [...selectionSession.getSnapshot()]
              sculptEpoch.current++
              setSculptSession({ document: completeProject.document, checkpoint: compositionWorkspace.checkpoint(), ids, operationId: newId(), state: createTerrainSculptToolState(completeProject.document, ids) })
              markFormDraft('sculptForm'); inspect('sculpt')
            }}>{sculptSession ? '继续局部台地 / 洼地' : '开始局部台地 / 洼地'}</button>
            <button className="secondary asset-wide" disabled={!completeProject} onClick={() => inspect('outdoorAggregate')}>自然组 · 创建与整体调整</button>
          </div></div>
          <div hidden={sidebar !== 'library' || audience !== 'gm'} onChangeCapture={event => { if ((event.target as HTMLElement).closest('.composition-import') && !(event.target as HTMLElement).closest('.asset-batch-import')) { singleAssetDraft.current=true; syncAssetDraft() } }}>{completeProject && (() => {
            const libraryProps = { project: completeProject, disabled: editDisabled, importDisabled: toolDisabled(['assetImportForm']), importResetKey: formReset.assetImportForm,
              onImportBatch: importAssetBatch, onAssetBatchDraftChange: onAssetBatchDraft, onInvalidateAssetBatch: invalidateAssetBatch, assetBatchPreviewActive: !!structure?.assetBatch, onPlace: choosePlacement, onPrefab: (id: string) => { if (guard()) { setPrefabPlacement(id); inspect('selection') } }, onImport: importAsset,
              onMaterial: (id: string) => {
                if (!guard()) return
                const ids = selectionSession.getSnapshot()
                preview(() => surfaceMaterialCommands(completeProject, ids, id), '将固定材质应用到所选表面')
              } }
            return <><ThemePacksPanel key={`${panelKey}-theme-packs`} disabled={editDisabled} onAdopt={adoptCatalog} onPendingChange={onThemePending}/><ProjectAssetReviewPanel project={completeProject} disabled={editDisabled} onPendingChange={onProjectReviewPending}/><CatalogLibrary organizationDisabled={toolDisabled(['catalogForm'])} externalRefreshKey={imageLibraryRefresh} detailTarget={catalogTarget} detailVisible={catalogDetailOpen} detailReturnLabel={detailMode === 'review' ? '返回候选审阅' : detailMode === 'selection' ? '返回对象' : '返回当前任务'} onDetailChange={open => { setCatalogDetailOpen(open); if (open) revealPanel('inspector') }} key={panelKey} {...libraryProps} builtinProject={builtinProject} builtinLoading={builtinLoading} builtinError={builtinError}
              onBrowse={() => openResources('library')} onManage={() => { setCatalogDetailOpen(false); openResources('library') }} onBuiltinDemand={requestBuiltin} variantsProject={variantsProject} variantsLoading={variantsLoading} variantsError={variantsError} onVariantsDemand={requestVariants}
              onAdopt={adoptCatalog} onUse={useCatalogItem} onPendingChange={onCatalogPending} onDraftChange={onCatalogDraft} organizationResetKey={formReset.catalogForm}/></>
          })()}</div>
          <div hidden={sidebar !== 'building' || audience !== 'gm'} onChangeCapture={event => { if (!(event.target as HTMLElement).closest('[data-aggregate-session-control]')) markFormDraft('buildingForm') }}>{completeProject && <BuildingPanel detailsTarget={buildingTarget} detailsActive={detailMode === 'building' && !catalogDetailOpen} activeTask={buildingTask} onTaskChange={task => { if (task !== buildingTask && !guard(['buildingForm', 'sketch'])) return; setBuildingTask(task); inspect('building') }} onBrowseScene={openLayers} onOpenSettings={showSettings} onOpenings={() => { if (guard()) { setOpeningTool({ kind: 'door', widthMm: 900 }); inspect('selection') } }} key={`${panelKey}-${formReset.buildingForm}`} scene={completeProject.document} layerId={currentLayerId}
            disabled={toolDisabled(['sketch', 'buildingForm']) || effectiveHiddenLayers.has(currentLayerId)} sketch={sketch}
            onSketch={next => { if (!next) setSketch(null); else if (guard('buildingForm')) { setSketch(next); if (next.kind !== 'ruler') markFormDraft('buildingForm'); setDetailMode('building'); setCatalogDetailOpen(false); enterCanvas() } }} onPreview={previewBuilding} onSelect={select} onSelectMany={selectMany} onFinishReady={onBuildingFinishReady}/>}</div>
          <div hidden={sidebar !== 'visual' || audience !== 'gm'} onChangeCapture={() => markFormDraft('visualForm')}>{completeProject && <SelectionSubscriber session={selectionSession}>{ids => <VisualPanel surfaceRequest={surfaceRequest} detailsTarget={visualTarget} detailsActive={detailMode === 'visual' && !catalogDetailOpen} activeTab={visualTab} onTabChange={tab => { if (tab !== visualTab && !guard('visualForm')) return; setVisualTab(tab); inspect('visual') }} onInspect={() => inspect('visual')} key={`${panelKey}-${completeProject.document.revision}-${formReset.visualForm}`} scene={completeProject.document} appearance={completeProject.appearance} historyIdentity={completeProject.historyIdentity} layerId={currentLayerId} selectedIds={ids} disabled={toolDisabled(['visualForm'])} onPreview={(commands, label) => preview(commands, label, undefined, 'visualForm')}  onBoundaryEditor={setBoundaryEditor} onDraftChange={() => markFormDraft('visualForm')}/>}</SelectionSubscriber>}</div>
          <div hidden={sidebar !== 'generate' || audience !== 'gm'}>{generationTools}</div>
          <div hidden={sidebar !== 'history' || audience !== 'gm'}>{historyBrowser}</div>
          <div hidden={sidebar !== 'scene' && audience === 'gm'}>{audience === 'gm' && <><ImageImportTool key={imageImportReset} disabled={toolDisabled(['imageImport'])} requestKey={imageImportRequest} onDraftChange={updateImageImportDraft} onPrepare={(factory, description, token) => prepare(factory, description, token)}/>{imageLibraryStatus && imageLibraryStatus.sceneId === project?.document.sceneId && <div role="status" className="asset-muted"><p>{imageLibraryStatus.message}</p>{imageLibraryStatus.failed && <button className="secondary" disabled={editDisabled} onClick={() => { if (project) void syncImageItems(project.document.sceneId, Object.keys(project.document.props)) }}>重试保存拆解素材</button>}</div>}</>}<div className="workspace-scene-actions"><button className="secondary" disabled={!project || audience === 'player'} onClick={showSettings}>场景设置</button></div>{layerPanel}{inspectedLayerId && <button className="secondary asset-wide" onClick={() => setInspectedLayerId('')}>显示所有图层的对象</button>}{sceneBrowser}</div>
        </div>
  const editInspectorProp = (selected: string, commands: SceneCommand[], description: string, selectionAfterCommit?: string | null) => {
    if (!completeProject) return
    const scatterOwner = Object.values(completeProject.document.scatterGroups).find(group => Object.values(group.members).some(member => member.propId === selected))
    const aggregateMember = Object.values(completeProject.document.aggregateCoordinates?.groups ?? {}).some(group => group.members.some(member => member.kind === 'prop' && member.id === selected))
    if (aggregateMember && commands.length === 1 && commands[0].type === 'updateProp'
      && Object.keys(commands[0].changes).every(field => field === 'positionMm' || field === 'rotationDeg')) {
      preview(commands, description); return
    }
    if (!scatterOwner) { commit(async () => { await compositionWorkspace.execute(commands); if (selectionAfterCommit !== undefined) setSelected(selectionAfterCommit) }); return }
    if (!commands.every(isOutdoorCommand)) { setMessage('散布成员修改包含不支持的室外操作。'); return }
    previewOutdoor(commands as OutdoorCommand[], description, selectionAfterCommit)
  }
  const inspectorPanel = <SelectionSubscriber session={selectionSession}>{ids => {
    const selectedIds = ids, selected = ids.length === 1 ? ids[0] : null
    const enhancement = completeProject && selected ? (['prop', 'room', 'terrainArea', 'wall'] as const)
      .map(kind => ({ kind, id: selected })).find(target => target.kind === 'prop' ? !!completeProject.document.props[target.id] : target.kind === 'room' ? !!completeProject.document.rooms[target.id] : target.kind === 'wall' ? !!completeProject.document.walls[target.id] : !!completeProject.document.terrainAreas[target.id]) : undefined
    return <aside className="asset-inspector">
      {enhancement && audience === 'gm' && <button type="button" className="secondary asset-wide" disabled={editDisabled} onClick={() => { if (guardAssetEditorDeparture() && guard()) setEnhancementTarget(enhancement) }}>编辑素材</button>}
      {openingTool ? <OpeningPlacementPanel value={openingTool} unit={completeProject?.document.units.display ?? 'm'} disabled={busy} onChange={setOpeningTool} onCancel={() => setOpeningTool(null)}/> : project && placement && audience === 'gm' ? <PlacementInspector scene={project.document} prop={placement.prop} busy={busy} ready={placementReady} onChange={changes => setPlacement(current => current ? { ...current, prop: { ...current.prop, ...changes } } : null)} onPlace={() => placeAt(placement.prop.positionMm)} onCancel={() => setPlacement(null)}/>
            : visibleProject && selectedIds.length > 1 && audience === 'gm' ? <div onChangeCapture={() => markFormDraft('selectionForm')}><SelectionInspector key={`${panelKey}-${formReset.selectionForm}`} scene={project!.document} ids={selectedIds} summaryReader={selectionSummaryReader} busy={toolDisabled(['selectionForm'])} onAction={batchAction} onClear={() => select(null)}/></div>
              : completeProject && selected && audience === 'gm' && (completeProject.document.decorations?.[selected] || completeProject.document.decorationClusters?.[selected]) ? <div onChangeCapture={() => markFormDraft('outdoorInspector')}><DecorationInspector onOpenLayers={openLayers} key={`${selected}-${completeProject.document.revision}-${formReset.outdoorInspector}`} scene={completeProject.document} id={selected} disabled={toolDisabled(['outdoorInspector'])} onPreview={(commands, label) => previewDecorations(commands, label, 'outdoorInspector')} onSelect={select}/></div>
                : completeProject && selected && audience === 'gm' && outdoorEntityKind(completeProject.document, selected) ? <div onChangeCapture={() => markFormDraft('outdoorInspector')} onClickCapture={event => { if ((event.target as HTMLElement).closest('.connection-route-fields button')) markFormDraft('outdoorInspector') }}><OutdoorInspector onOpenLayers={openLayers} key={`${selected}-${completeProject.document.revision}-${formReset.outdoorInspector}`} scene={completeProject.document} id={selected} disabled={toolDisabled(['outdoorInspector'])} onPreview={(commands, label) => previewOutdoor(commands as OutdoorCommand[], label, undefined, 'outdoorInspector')} onSelect={select} onBoundaryEditor={editConnectionInspector}/></div>
                  : completeProject && selected && audience === 'gm' && (completeProject.document.rooms[selected] || completeProject.document.walls[selected] || completeProject.document.vertices[selected] || completeProject.document.openings[selected] || completeProject.document.notes[selected] || completeProject.document.regions[selected]?.kind === 'manualMask') ? <div onChangeCapture={event => { if (!(event.target as HTMLElement).closest('[data-road-door-start]')) markFormDraft('buildingInspector') }}><BuildingInspector onRoadDoorStart={startDoorRoad} onOpenLayers={openLayers} key={`${selected}-${completeProject.document.revision}-${formReset.buildingInspector}`} scene={completeProject.document} selected={selected} layerId={currentLayerId} disabled={toolDisabled(['buildingInspector'])} onPreview={(commands, label) => previewBuilding(commands, label, 'buildingInspector')} onSelect={select} onLock={(kind, id, locked) => commit(() => compositionWorkspace.execute([{ type: 'setEditLock', kind, id, locked }]))}/>{completeProject.document.openings[selected]?.kind === 'door' && <PathAttachmentTools project={completeProject} openingId={selected} disabled={toolDisabled(['buildingInspector'])} onDraftChange={() => markFormDraft('buildingInspector')} onPreview={(commands, label) => previewBuilding(commands, label, 'buildingInspector')}/>}</div>
                    : completeProject && visibleProject && selected && audience === 'gm' ? <div>
                        <SceneInspector onOpenLayers={openLayers} key={`${selected}-${completeProject.document.revision}-${formReset.propAppearanceForm}`} project={completeProject} selected={selected} busy={toolDisabled(['propAppearanceForm'])} appearanceResetKey={formReset.propAppearanceForm} onAppearanceDraftChange={onPropAppearanceDraft} onFillCopy={beginFillCopy} onFillCopyNumeric={previewNumericFillCopy} fillCopyBusy={!!fillCopy} workspace={compositionWorkspace} onSelect={select} onCommit={commit} onPreview={(commands, description) => preview(commands, description, undefined, Array.isArray(commands) && commands.some(command => command.type === 'replacePropAppearance') ? 'propAppearanceForm' : undefined)} onPropCommand={(commands, description, selectionAfterCommit) => editInspectorProp(selected, commands, description, selectionAfterCommit)}/>
                      </div> : <>
          <div className="asset-section-heading"><Move size={16}/><h2>{audience === 'player' ? '玩家输出预览' : '当前选择'}</h2></div>
          <p className="asset-muted">{audience === 'player' ? '画布和对象列表仅展示公开投影。' : '点击画布或左侧场景对象查看详情；选择工具后在这里调整参数。'}</p>
        </>}
      {completeProject && audience === 'gm' && selected && ['rooms', 'terrainAreas', 'walls', 'paths', 'terrainEdges', 'terrainConnections'].some(kind => Object.hasOwn(completeProject.document[kind as 'rooms'], selected)) && <div className="workspace-surface-actions"><button className="secondary asset-wide" onClick={() => { if (guard()) { setVisualTab('surface'); setSurfaceRequest(value => value + 1); inspect('visual') } }}>材质与铺装</button><button className="secondary asset-wide" onClick={() => openResources('library')}>从素材选择材质</button></div>}
      {!restore && !structureRestore && project && selectedIds.length > 0 && audience === 'gm' && !placement && <button className="secondary asset-wide" disabled={busy || editingBlocked} onClick={event => {
        const b = event.currentTarget.getBoundingClientRect(), bounds = project.document.exportBoundsMm
        openMenu(project.document.props[selectedIds[0]]?.positionMm ?? { x: Math.round(bounds.x + bounds.width / 2), y: Math.round(bounds.y + bounds.height / 2) }, [...selectedIds], { x: b.left, y: b.bottom }, event.currentTarget)
      }}>更多操作</button>}
      {completeProject && audience === 'gm' && !restore && !structureRestore && (ids.length > 0 || !!prefabPlacement) && <>
        <details className="workspace-advanced" open={appearanceOpen} onToggle={event => setAppearanceOpen(event.currentTarget.open)}><summary>外观与图层调整</summary><div onChangeCapture={() => markFormDraft('appearanceForm')}><AppearancePanel key={`${panelKey}-${formReset.appearanceForm}`} project={completeProject} ids={ids} layerId={inspectedLayerId || currentLayerId} scopeKind="targets" disabled={toolDisabled(['appearanceForm'])} onPreview={(commands, description) => preview(commands, description, undefined, 'appearanceForm')}/></div></details>
        <details className="workspace-advanced" open={prefabToolsOpen || !!prefabPlacement} onToggle={event => setPrefabToolsOpen(event.currentTarget.open)}><summary>组合与重复布置</summary><div onChangeCapture={() => markFormDraft('prefabForm')}><PrefabPanel key={`${panelKey}-${prefabPlacement ?? ''}-${formReset.prefabForm}`} project={completeProject} ids={ids} layerId={currentLayerId} placementDefinitionId={prefabPlacement} onSelect={select} disabled={toolDisabled(['prefabPlacement', 'prefabForm'])} onPreview={(commands, description) => preview(commands, description, undefined, 'prefabForm')}/></div></details>
      </>}
    </aside> }}</SelectionSubscriber>
  const reviewPanel = <>{structureRestore && <StructureRestoreChangesPanel preview={structureRestore} current={completeProject!}/>} {restore && <RestoreChangesPanel preview={restore} current={completeProject!}/>}          {(terrainLocalPreview || terrainLocalBusy) && <div className="asset-structure-preview" role="status" aria-label="局部地形联动候选"><div><strong>{terrainLocalBusy ? '正在计算局部地形联动' : '局部地形联动候选 · 主工程尚未改变'}</strong><span>{terrainLocalBusy ? '正在读取过渡、素材和依赖闭包。' : `影响 ${terrainLocalPreview?.result.changedIds.length ?? 0} 项；范围外内容已保留。`}</span></div>{terrainLocalPreview && <><button className="primary" disabled={busy} onClick={() => void adoptTerrainLocal()}>保护并采用</button><button className="secondary" disabled={busy} onClick={cancelTerrainLocal}>取消局部地形预览</button></>}</div>}
          {terrainPreview && <div className="asset-structure-preview" role="status"><div><strong>自然地形候选 · 主工程尚未改变</strong><span>请审阅下方方案，再采用或取消。</span>{terrainPreview.baseMap && <span aria-label="程序底图本次预算">{terrainPreview.baseMap.source === 'server' ? '服务端' : '本机'}程序生成 · {terrainPreview.baseMap.version === 3 && terrainPreview.baseMap.budgetProfile ? `编辑目标 ${terrainPreview.baseMap.initialOperationCost}/${terrainPreview.baseMap.operationLimit} · ${terrainPreview.baseMap.budgetProfile.profileId} 档；轮廓点 ${terrainPreview.baseMap.budgetUsage?.geometryPoints ?? 0}/${terrainPreview.baseMap.budgetProfile.limits.geometryPoints}，计算采样 ${terrainPreview.baseMap.budgetUsage?.fieldEvaluations ?? 0}/${terrainPreview.baseMap.budgetProfile.limits.fieldEvaluations}。` : terrainPreview.baseMap.version === 2 ? baseMapGenerationBudget && 'complexityCost' in baseMapGenerationBudget ? `生成目标 ${baseMapGenerationBudget.semanticCost}/${CONTINUATION_POLICY.generationTargets}，余 ${CONTINUATION_POLICY.generationTargets - baseMapGenerationBudget.semanticCost}；展开复杂度 ${baseMapGenerationBudget.complexityCost}/256。` : `生成目标凭证不可用；已验证展开复杂度 ${terrainPreview.baseMap.initialOperationCost}/256。` : `本次编辑量 ${terrainPreview.baseMap.initialOperationCost}/256，余 ${terrainPreview.baseMap.remainingOperationCost}。`}生成额度独立记录；{Object.keys(terrainPreview.project.document.surfaceRules).length > 0 ? '此规则候选当前仅可直接采用，之后可手工编辑。' : terrainPreview.continuationSource ? '可直接采用底图，或在此底图上继续 AI 修改。' : '可直接采用合法底图。'}</span>}{terrainPreview.continuationError && <span role="alert">此底图仍可独立采用；AI 接续不可用：{terrainPreview.continuationError}</span>}</div>{baseMapPreview && Object.keys(baseMapPreview.project.document.surfaceRules).length === 0 && <button className="primary" disabled={busy || terrainBusy || aiCritical} onClick={() => { if (canPrepareAuthoring()) { setSidebar('ai'); revealPanel('resources') } }}>继续用 AI 修改底图</button>}</div>}{structure && <section className="asset-structure-preview workspace-candidate-review" aria-label="候选审阅">
            <div className="workspace-candidate-body">
              <strong className="workspace-candidate-title">{structure.description} · 候选预览</strong>
              <p className="workspace-confirm-help">尚未写入工程。采用会形成一次编辑，可从顶部撤销；自动保存状态见右上角。</p>
              {!!structure.assetQuality?.length && <AssetQualityReview resources={structure.prepared.project.resources} assessments={structure.assetQuality} acknowledgedKeys={structure.qualityAcknowledgments ?? []} disabled={busy} onAcknowledgedKeysChange={keys => setStructure(current => current?.prepared === structure.prepared ? { ...current, qualityAcknowledgments: keys } : current)}/>}
              <CompositionChangesPanel current={completeProject!} candidate={structure.prepared.project} commands={structure.commands} budgetUsage={structure.prepared.budgetUsage} budgetProfile={structure.prepared.budgetProfile} aggregateBoundaryImpact={structure.prepared.aggregateBoundaryImpact}/>{structure.layerIds && <span>{structure.layerIds.map(id => completeProject?.document.userLayers[id]?.name ?? id).join(' · ')}</span>}{structure.scopeIds && <AffectedObjectNames before={completeProject!.document} after={structure.document} ids={structure.scopeIds}/>}{structure.scopeIds && <details className="layer-preview-scope"><summary>实际操作范围 · {structure.scopeIds.length} 项</summary><textarea readOnly aria-label={structure.kind === 'building' ? '待采用建筑操作 ID' : structure.kind === 'visual' ? '待采用视觉操作 ID' : structure.kind === 'outdoor' ? '待采用室外操作 ID' : '待采用图层操作 ID'} rows={4} value={structure.scopeIds.join('\n')}/></details>}
              {structure.fillCopy && <div className="fill-copy-summary" aria-label="填充复制参数"><strong>填充复制 · {structure.fillCopy.report.sourceKind === 'prefab' ? '组合' : '独立物件'} · 新增 {structure.fillCopy.report.count} 份 · 独立编辑对象 {structure.fillCopy.cost.total}/{structure.fillCopy.cost.limit}</strong>
              <p>每份偏移 {formatDistanceMm(structure.fillCopy.report.stepMm.x, structure.document.units.display)}, {formatDistanceMm(structure.fillCopy.report.stepMm.y, structure.document.units.display)}；方向 {Math.round(Math.atan2(structure.fillCopy.report.stepMm.y, structure.fillCopy.report.stepMm.x) * 180 / Math.PI)}°；首件 ({formatDistanceMm(structure.fillCopy.report.positions[0]!.x, structure.document.units.display)}, {formatDistanceMm(structure.fillCopy.report.positions[0]!.y, structure.document.units.display)}) · 末件 ({formatDistanceMm(structure.fillCopy.report.positions.at(-1)!.x, structure.document.units.display)}, {formatDistanceMm(structure.fillCopy.report.positions.at(-1)!.y, structure.document.units.display)})；支撑/锁依赖 {structure.fillCopy.report.dependencyIds.length} 项 · 重叠 {structure.fillCopy.report.overlaps.length} 处。</p>
            </div>}
            </div>
            <div className="workspace-candidate-actions">
              {(structure.kind === 'building' || structure.kind === 'outdoor' || structure.kind === 'visual') && <label className="building-check"><input type="checkbox" aria-label="确认完整影响范围" checked={structure.confirmed ?? false} onChange={event => setStructure(current => current ? { ...current, confirmed: event.target.checked } : current)}/>确认以上修改及关联影响</label>}{(structure.kind === 'building' || structure.kind === 'outdoor' || structure.kind === 'visual') && <p className="workspace-confirm-help">勾选确认后可采用；取消预览不会修改工程。</p>}
              <div className="workspace-candidate-buttons"><button className="secondary" disabled={busy} onClick={cancelStructurePreview}>{structure.kind === 'image-enhancement' ? '取消图像预览' : structure.fillCopy ? '取消填充复制预览' : structure.afterUse ? '取消素材添加' : structure.assetBatch ? '取消素材导入预览' : structure.kind === 'batch' ? '取消批量预览' : structure.kind === 'layer' ? '取消图层预览' : structure.kind === 'outdoor' ? '取消室外预览' : structure.kind === 'building' ? '取消结构预览' : structure.kind === 'visual' ? '取消视觉预览' : structure.kind === 'display' ? '取消显示预览' : '取消组件预览'}</button><button className="primary" disabled={busy || !assetQualityAcknowledgmentsComplete(structure.assetQuality ?? [], structure.qualityAcknowledgments) || (structure.kind === 'building' || structure.kind === 'outdoor' || structure.kind === 'visual') && !structure.confirmed} onClick={adoptStructurePreview}>{structure.kind === 'image-enhancement' ? '采用图像候选' : structure.fillCopy ? '采用填充复制' : structure.afterUse ? structure.afterUse.selector.kind === 'material' ? '添加并应用材质' : '添加并继续放置' : structure.assetBatch ? '采用所选素材' : structure.kind === 'batch' ? '采用批量修改' : structure.kind === 'layer' ? '采用图层修改' : structure.kind === 'outdoor' ? '采用室外修改' : structure.kind === 'building' ? '采用结构修改' : structure.kind === 'visual' ? '采用视觉修改' : structure.kind === 'display' ? '采用显示设置' : '采用组件修改'}</button></div>
            </div>
          </section>}
          {restore && <div className="asset-structure-preview history-restore-banner" role="status" aria-label="局部恢复候选"><div><strong>{restore.snapshot.name} · 局部恢复预览</strong><span>{restore.plan.request.ids.length} 件请求 · {restore.plan.changes.length} 件变化 · 当前 r{restore.currentRevision}</span><label className="building-check"><input type="checkbox" aria-label="确认恢复完整影响范围" checked={restoreConfirmed} onChange={event => setRestoreConfirmed(event.target.checked)}/>确认下方列出的全部依赖与跨层变化</label></div><button className="secondary" disabled={busy} onClick={() => { compositionWorkspace.cancelRestore(restore); setRestore(null); setMessage('已取消局部恢复预览，工程未修改。') }}>取消局部恢复</button><button className="primary" disabled={busy || !restore.plan.changed || !restoreConfirmed} onClick={() => void action(async () => { try { await compositionWorkspace.applyRestore(restore); setSelected(null); setMessage(`已保护恢复前工程并恢复「${restore.snapshot.name}」的所选内容，可撤销；保存状态见右上角。`) } finally { setRestore(null); setHistoryRefresh(value => value + 1) } }, '采用局部恢复')}>保护当前并采用</button></div>}
          {structureRestore && <div className="asset-structure-preview history-restore-banner" role="status" aria-label="结构恢复候选"><div><strong>{structureRestore.snapshot.name} · 结构恢复预览</strong><span>{structureRestore.plan.request.ids.length} 项请求 · {structureRestore.plan.changes.length} 项变化 · 当前 r{structureRestore.currentRevision}</span></div><button className="secondary" disabled={busy} onClick={() => { compositionWorkspace.cancelStructureRestore(structureRestore); setStructureRestore(null); setMessage('已取消结构恢复预览，工程未修改。') }}>取消结构恢复</button><button className="primary" disabled={busy || !structureRestore.plan.changed} onClick={() => void action(async () => { try { await compositionWorkspace.applyStructureRestore(structureRestore); setSelected(null); setMessage(`已保护恢复前工程并恢复「${structureRestore.snapshot.name}」的所选结构，可撤销；保存状态见右上角。`) } finally { setStructureRestore(null); setHistoryRefresh(value => value + 1) } }, '采用结构恢复')}>保护当前并采用结构恢复</button></div>}

</>
  const canvasPanel = <main className="asset-center">
          {completeProject && audience === 'gm' && <LayerSelectionNotice scene={completeProject.document} currentLayerId={currentLayerId} hiddenLayerIds={hiddenLayerIds} soloLayerId={soloLayerId} currentOnly={currentOnly} disabled={editDisabled}
            onOpenLayers={openLayers} onShow={id => changeSelectionView(() => setHiddenLayerIds(current => { const next = new Set(current); next.delete(id); return next }))} onExitSolo={() => changeSelectionView(() => setSoloLayerId(null))} onAllLayers={() => changeSelectionView(() => setCurrentOnly(false))}/>}
          {sketch && <div className="workspace-canvas-hint" role="status" aria-label={sketch.kind === 'ruler' ? '量尺操作提示' : '房间绘制提示'}><span>{sketch.kind === 'ruler' ? `${sketch.points.length} / 2 点 · 点击起点和终点测量距离；Esc 退出。` : finishBuilding ? '轮廓已就绪，可先检查名称、尺寸和支撑表面；Enter 预览，Esc 退出。' : sketch.kind === 'rectangle' ? `${sketch.points.length} / 2 点 · 点击矩形的两个对角；Esc 退出。` : `${sketch.points.length} 个点 · 继续点击顶点，至少三点后预览；Esc 退出。`}</span>{finishBuilding && <button className="primary" disabled={busy || editingBlocked} onClick={finishBuilding}>预览房间</button>}<button className="secondary" disabled={busy || editingBlocked} onClick={() => setSketch(null)}>退出{sketch.kind === 'ruler' ? '量尺' : '房间绘制'}</button></div>}
          {outdoorSketch && <div className="workspace-canvas-hint" role="status" aria-label="地形绘制提示"><span>{outdoorSketch.points.length} 个点 · {finishOutdoor ? '草图已就绪，预览后确认材质、宽度与实际影响。' : '继续在画布取点；道路与连接至少两点，地形与区域至少三点；Esc 退出。'}</span>{finishOutdoor && <> <button className="primary" disabled={busy || editingBlocked} onClick={finishOutdoor}>预览绘制结果</button></>}<button className="secondary" disabled={busy || editingBlocked} onClick={() => setOutdoorSketch(null)}>退出地形绘制</button></div>}
          {openingTool && <div className="workspace-canvas-hint">点击目标墙面，门窗将以点击位置为中心。净宽可在「放置门窗」面板调整；Esc 退出。</div>}
          <div className="asset-view-bar">{completeProject && <label className="workspace-floor-switch">当前楼层<select aria-label="当前楼层" value={activeFloorId} disabled={editDisabled} onChange={event => changeFloor(event.target.value)}>{Object.values(completeProject.document.floors).map(floor => <option key={floor.id} value={floor.id}>{floor.name}</option>)}</select></label>}<div role="group" aria-label="预览受众" className="asset-audience"><button disabled={editDisabled} aria-pressed={audience === 'gm'} onClick={() => { if (guard()) setAudience('gm') }}>主持人</button><button disabled={editDisabled} aria-pressed={audience === 'player'} onClick={() => { if (guardAssetEditorDeparture() && guard()) { setAudience('player'); setGroundView(false); setSelected(null); setDetailMode('selection'); setCatalogDetailOpen(false) } }}>玩家</button></div><div className="asset-view-actions"><span>{visibleProject && visibleFloor ? `${formatDistanceMm(resolveFloorOutput(visibleProject.document, visibleFloorId).boundsMm.width, visibleProject.document.units.display)} × ${formatDistanceMm(resolveFloorOutput(visibleProject.document, visibleFloorId).boundsMm.height, visibleProject.document.units.display)} · 固定范围` : '二维俯视 · 毫米世界坐标'}</span>{project && audience === 'gm' && <button className="secondary" disabled={busy} aria-pressed={atmosphereBypass} title="暂时关闭氛围调色、点光、薄雾和滤镜，保留材质与高差阴影；仅影响主持人预览。" onClick={() => setAtmosphereBypass(value => !value)}>对比原色（仅预览）</button>}{project && audience === 'gm' && <button className="secondary" disabled={editDisabled} aria-pressed={groundView} onClick={() => setGroundView(value => !value)}>地面查看</button>}</div></div>
          {localGenerationBusy && <div className="asset-structure-preview" role="status" aria-label="局部重生成候选状态"><div><strong>{localGenerationBusy ? '正在准备局部重生成' : '局部重生成候选 · 当前工程尚未改变'}</strong><span>在地形的「局部重生成」中审阅实际修改与依赖，再保护并采用。</span></div><button className="secondary" disabled={busy} onClick={() => cancelLocalGeneration()}>取消局部候选</button></div>}
          {domainOperationState.mixed.phase === 'preparing' && <div className="asset-structure-preview" role="status" aria-label="混合场景候选状态"><div><strong>{mixedBusy ? '正在准备混合场景' : '混合场景候选 · 当前工程尚未改变'}</strong><span>在生成面板审阅建筑支撑、真实外门和室外路线，再保存为新工程或取消。</span></div><button className="secondary" disabled={busy} onClick={() => cancelMixed(true, true)}>取消混合场景预览</button></div>}
          {domainOperationState.volcano.phase === 'preparing' && <div className="asset-structure-preview" role="status" aria-label="火山候选状态"><div><strong>{volcanoBusy ? '正在准备火山' : '火山候选 · 当前工程尚未改变'}</strong><span>在生成面板查看真实连接、路线及独立危险设置，再保存为新工程或取消。</span></div><button className="secondary" disabled={busy} onClick={() => cancelVolcano()}>取消火山预览</button></div>}
          {domainOperationState.forest.phase === 'preparing' && <div className="asset-structure-preview" role="status" aria-label="森林与营地候选状态"><div><strong>{forestBusy ? '正在准备森林与营地' : '森林与营地候选 · 当前工程尚未改变'}</strong><span>在生成面板查看空地、路线和实际植被数量，再保存为新工程或取消。</span></div><button className="secondary" disabled={busy} onClick={() => cancelForest()}>取消森林与营地预览</button></div>}
          {domainOperationState.interior.phase === 'preparing' && <div className="asset-structure-preview" role="status" aria-label="室内布局候选状态"><div><strong>{interiorBusy ? '正在准备室内布局' : '室内布局候选 · 当前工程尚未改变'}</strong><span>在生成面板查看房间实际净面积，再保存为新工程或取消。</span></div><button className="secondary" disabled={busy} onClick={() => cancelInterior()}>取消室内布局预览</button></div>}
          {regionalBusy && <div className="asset-structure-preview" role="status" aria-label="区域候选状态"><div><strong>{regionalBusy ? '正在准备区域完整候选' : '区域候选 · 主工程尚未改变'}</strong><span>在生成面板审阅后采用或取消。</span></div><button className="secondary" disabled={busy} onClick={cancelRegional}>取消区域预览</button></div>}
          {terrainEditBusy && <div className="asset-structure-preview" role="status" aria-label="局部地形候选"><div><strong>{terrainEditBusy ? '正在计算局部地形修改' : '局部地形候选 · 主工程尚未改变'}</strong><span>{terrainEditBusy ? '可取消计算，当前工程保持。' : '请在地形的「修改地形」中查看完整影响范围，再保护并采用。'}</span></div><button className="secondary" disabled={busy} onClick={cancelTerrainEditing}>取消局部地形预览</button></div>}
          {aiPreview && audience === 'gm' && <div className="ai-preview-banner" role="status"><strong>{aiShown ? 'AI草稿预览 · 主工程未改变' : baseMapPreview ? '正在查看程序底图' : '正在查看主工程'}</strong><span>草稿 {aiPreview.draftRevision} · {aiPreview.changes.length} 件差异</span><button disabled={aiCritical || busy} onClick={() => { if (showAiDraft) setShowAiDraft(false); else if (canPrepareAuthoring()) setShowAiDraft(true) }}>{aiShown ? baseMapPreview ? '查看程序底图' : '查看主工程' : '查看AI草稿'}</button></div>}
          <div className="asset-stage">{visibleProject && visibleFloor ? <AssetCanvas floorId={visibleFloorId} key={panelKey} groundView={groundView} toolControlsTarget={toolControlsTarget} viewControlsTarget={viewControlsTarget}
            project={visibleProject} persistenceBusy={state.status === 'unsaved' || state.status === 'saving'} editorRenderer={editorRenderer} selectionOptions={selectionOptions} pointHitTest={pointHitTest} boundsSelector={boundsSelector}
            selectionGeometry={selectionGeometry} selectionSummaryReader={selectionSummaryReader} worldTool={canvasWorldTool}
            terrainBrush={audience === 'gm' ? canopyBrush ?? terrainEditCanvas?.brush : null} fillCopy={fillCopy} onFillCopyPreview={finishFillCopy} onFillCopyCancel={() => setFillCopy(null)}
            visualBoundary={terrainEditCanvas?.boundary ?? (audience === 'gm' && connectionBoundaryEditor && (detailMode === 'outdoor' || detailMode === 'selection' || formDrafts.outdoorForm || formDrafts.outdoorInspector) ? connectionBoundaryEditor.boundary : (detailMode === 'visual' || formDrafts.visualForm) && audience === 'gm' ? boundaryEditor?.boundary : null)}
            onVisualBoundaryFinish={terrainEditCanvas?.onBoundaryFinish} onVisualBoundaryChange={next => { if (terrainEditCanvas?.onBoundaryChange) terrainEditCanvas.onBoundaryChange(next); else if (connectionBoundaryEditor) { markFormDraft(connectionBoundaryEditor.owner); connectionBoundaryEditor.onChange(next) } else if (boundaryEditor) { markFormDraft('visualForm'); boundaryEditor.onChange(next) } }}
            onWallDragPreview={(wallId, offsetMm) => {
              const scene = completeProject?.document, wall = scene?.walls[wallId]
              if (!scene || !wall) return
              const commands = [wall.startVertexId, wall.endVertexId].map(id => ({ type: 'moveVertex' as const, id, positionMm: { x: scene.vertices[id].xMm + offsetMm.x, y: scene.vertices[id].yMm + offsetMm.y } }))
              previewBuilding(commands, '拖动墙边，核对共享结构、门窗与支撑依赖', 'buildingInspector')
            }}
            onCopySelection={copySelection} onPasteSelection={pasteSelection}
            onDeleteSelection={() => {
              if (!active || editDisabled || document.querySelector('[role="dialog"],[role="menu"],.workspace-help[open],.workspace-export-menu[open]')) return
              batchAction('delete')
            }}
            selected={null} selectionSession={selectionSession} onSelect={select} onSelectMany={selectMany} onContext={openMenu} memberMode={memberMode} onMemberMode={setMemberMode}
            fitRequest={fitRequest} audience={audience} disabled={busy || terrainEditBusy || (!!terrainEditCanvas ? false : editingBlocked) || !!prefabPlacement || audience === 'player'}
            placement={placement?.prop} onPlacementMove={positionMm => setPlacement(current => current ? { ...current, prop: { ...current.prop, positionMm } } : null)} onPlace={placeAt}
            onPlacementReady={setPlacementReady} onPlacementError={error => { setPlacement(null); setMessage(error) }} onCancelPlacement={() => setPlacement(null)}/>
            : visibleProject ? <div className="asset-empty" role="status"><p>当前楼层将在此候选中移除；请核对楼层与依赖差异后采用，或取消返回原楼层。</p></div> : <div className="asset-empty"><div className="asset-empty-icon"><Layers3 size={36}/></div><span>从一张空白画布开始</span><p>手工绘制房间与地形，或先生成一张地图再继续编辑。</p><div className="workspace-start-actions"><button className="primary" disabled={busy} onClick={openNewScene}>新建场景</button><button className="secondary" disabled={busy} onClick={() => request({ type: 'generate' })}>生成地图</button><button className="secondary" disabled={busy} onClick={showSamples}>从样板开始</button></div></div>}</div>
        </main>
  const workspaceTools = <><div ref={setToolControlsTarget}/><button title="画矩形房间" aria-label="工具：画房间" disabled={editDisabled || !completeProject || audience === 'player'} aria-pressed={!!sketch && sketch.kind !== 'ruler'} onClick={() => startBuildingTool('rectangle')}><PencilRuler size={18}/><small>房间</small></button><button title="点击墙面放置门窗" aria-label="工具：门窗" disabled={editDisabled || !completeProject || audience === 'player'} aria-pressed={!!openingTool} onClick={() => { if (guard()) { setOpeningTool({ kind: 'door', widthMm: 900 }); inspect('selection') } }}><DoorOpen size={18}/><small>门窗</small></button><button title="绘制地形" aria-label="工具：画地形" disabled={editDisabled || !completeProject || audience === 'player'} aria-pressed={!!outdoorSketch} onClick={startTerrainTool}><Mountain size={18}/><small>地形</small></button><button title="选择待放置素材" aria-label="工具：放置素材" disabled={editDisabled || !completeProject || audience === 'player'} onClick={() => { if (guard()) openResources('library') }}><Plus size={18}/><small>放置</small></button><button title="文字与线索" aria-label="工具：注记" disabled={editDisabled || !completeProject || audience === 'player'} onClick={showNotes}><StickyNote size={18}/><small>注记</small></button><button title="玩家遮罩" aria-label="工具：遮罩" disabled={editDisabled || !completeProject || audience === 'player'} onClick={() => { if (guard()) { setBuildingTask('mask'); setSidebar('building'); inspect('building') } }}><Shield size={18}/><small>遮罩</small></button><button title="量尺" aria-label="工具：量尺" disabled={editDisabled || !completeProject || audience === 'player'} aria-pressed={sketch?.kind === 'ruler'} onClick={() => startBuildingTool('ruler')}><Ruler size={18}/><small>量尺</small></button></>
  const workspaceFooter = <><div ref={setViewControlsTarget}/>{project && <button className="workspace-display-summary" disabled={audience === 'player'} onClick={showSettings} title="打开单位与格线设置">{project.document.units.display === 'm' ? '米' : '英尺'} · 格线{project.document.units.gridVisible ? '显示' : '隐藏'} · 吸附 {project.document.units.snapMm} mm</button>}<SelectionSubscriber session={selectionSession}>{ids => <span>已选 {ids.length} 项</span>}</SelectionSubscriber><span>{placement ? '放置物件' : prefabPlacement ? '放置组合' : sketch?.kind === 'ruler' ? '量尺' : sketch ? '绘制房间' : openingTool ? '放置门窗' : outdoorSketch ? '绘制室外' : '选择 / 平移'}</span><span>{audience === 'gm' ? '主持人视图' : '玩家视图'}</span></>
  return <WorkspacePresentationContext.Provider value={{ ...presentation, aiReviewActive: !!aiPreview }}>
    <div className="asset-shell history-shell composition-shell outdoor-shell workspace-unified" ref={shell} data-testid="outdoor-workbench" data-native-format={`sceneweave-complete-project@${completeProject?.schemaVersion ?? 1}`} data-revision={project?.document.revision}
      data-transaction-revision={state.lastTransaction?.revision} data-transaction-committed-at={state.lastTransaction?.committedAtMs}>
      <header className="asset-header"><button className="asset-brand" aria-label="回到首页" onClick={onBack}><ArrowLeft size={18}/><span>织境<small>Sceneweave</small></span></button><div className="asset-header-title"><div className="workspace-project-title"><small>统一工作区</small><h1>{project?.document.title ?? '织境场景'}</h1></div></div><div className="asset-toolbar"><button aria-label="撤销编辑" title="撤销编辑（Ctrl / ⌘ + Z）" aria-keyshortcuts="Control+Z Meta+Z" disabled={!state.canUndo || editDisabled} onClick={() => commit(() => applyEditHistory('undo'))}><Undo2 size={17}/></button><button aria-label="重做编辑" title="重做编辑（Ctrl / ⌘ + Shift + Z / Y）" aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z Control+Y Meta+Y" disabled={!state.canRedo || editDisabled} onClick={() => commit(() => applyEditHistory('redo'))}><Redo2 size={17}/></button><button aria-label="命名历史快照" title="命名历史快照" disabled={!project || audience === 'player'} onClick={openHistory}><Archive size={17}/></button></div><div className="asset-header-actions"><span role="status" className={`asset-save ${state.status}`} title="已采用的编辑自动保存在此浏览器；下载工程备份请使用「导出」。">{state.status === 'saving' ? <LoaderCircle size={14} className="spin"/> : state.status === 'error' || state.status === 'conflict' ? <AlertTriangle size={14}/> : state.status === 'unsaved' ? <Clock3 size={14}/> : state.status === 'saved' ? <CheckCircle2 size={14}/> : null} {saveLabels[state.status]}{imageImportDraft !== null ? ' · 图片草稿未采用' : ''}</span><details className="workspace-file-menu" onClick={event => { if ((event.target as HTMLElement).closest('button')) event.currentTarget.open = false }} onKeyDown={event => { if (event.key === 'Escape' && !event.nativeEvent.isComposing && event.currentTarget.open) { event.preventDefault(); event.stopPropagation(); event.currentTarget.open = false; event.currentTarget.querySelector('summary')?.focus() } }}><summary>文件</summary><div role="group" aria-label="文件操作"><button className="secondary" disabled={editDisabled} onClick={openNewScene}>新建空白场景</button><button className="secondary" disabled={editDisabled} onClick={requestImport}>打开工程文件</button><button className="secondary" disabled={toolDisabled(['imageImport'])} onClick={() => request({ type: 'image-import' })}>从图片新建场景</button><button className="secondary" disabled={editDisabled} onClick={showSamples}>从样板开始</button><button className="secondary" disabled={editDisabled || !project} onClick={() => request({ type: 'reload' })}>重新载入已保存版本</button><button className="secondary" disabled={busy || editingBlocked || !project} onClick={() => backup()}>备份可编辑工程 · 含秘密</button></div></details><WorkspaceHelp/><details className="workspace-export-menu" onKeyDown={event => {
        if (event.key !== 'Escape' || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229 || !event.currentTarget.open) return
        event.preventDefault(); event.stopPropagation()
        event.currentTarget.open = false
        event.currentTarget.querySelector('summary')?.focus()
      }}><summary><Download size={15}/>导出</summary><div role="group" aria-label="导出选项"><p>玩家地图用于分享；主持人地图包含秘密。工程备份可继续编辑，需下载文件另行保管。</p>{exportBlockedReason && <p role="status">{exportBlockedReason}</p>}{completeProject && audience === 'player' && <p>VTT 导出请先切换到主持人视图。</p>}<button className="primary" disabled={busy || editingBlocked || !project} onClick={() => exportImage('player')}>玩家地图 PNG</button>{audience === 'gm' && <button className="secondary" disabled={busy || editingBlocked || !project} onClick={() => exportImage('gm')}>主持人地图 PNG · 含秘密</button>}<button className="secondary" disabled={busy || editingBlocked || !project} onClick={() => backup()}>备份可编辑工程 · 含秘密</button><button className="secondary" disabled={busy || editingBlocked || !completeProject || audience !== 'gm'} onClick={() => { if (completeProject && guard()) setUvttProject(completeProject) }}>VTT 导出</button><button className="secondary" disabled={!completeProject || audience !== 'gm'} onClick={showSettings}>调整导出范围</button></div></details><div className="workspace-header-layout" ref={setLayoutControlsTarget}/></div></header>
      <WorkspaceSaveRecovery status={state.status} error={state.error} busy={busy} copyBlockedReason={transitionReason} backupBlockedReason={exportBlockedReason}
        onRetry={() => void action(() => compositionWorkspace.retry(), '重试保存失败')}
        onCopy={() => { if (guard()) void action(async () => { await compositionWorkspace.saveAsCopy() }, '另存副本失败') }}
        onBackup={() => backup()}/>
      {message && <WorkspaceNotice message={message} transient={message === transientMessage} onDismiss={dismissMessage}/>}
      <div className="workspace-session-feedback">{hasReview && audience === 'gm' && <button className="secondary" onClick={() => inspect('review')}>返回候选审阅</button>}{(hasDraft || sketch || outdoorSketch || openingTool) && <button className="secondary" onClick={resumeDraft}>返回当前工具与草稿</button>}{draftControls}</div>
      <WorkspaceLayout active={active} sessionKey={panelKey} panelRequest={panelRequest} layoutControlsTarget={layoutControlsTarget} modules={[
        { id: 'scene', label: '场景', icon: <Layers3 size={18}/> }, { id: 'generate', label: '生成', icon: <WandSparkles size={18}/>, disabled: audience === 'player' },
        { id: 'outdoor', label: '地形', icon: <Mountain size={18}/>, disabled: !completeProject || audience === 'player' }, { id: 'building', label: '建筑', icon: <PencilRuler size={18}/>, disabled: !completeProject || audience === 'player' },
        { id: 'library', label: '素材与布景', icon: <Shapes size={18}/>, disabled: !completeProject || audience === 'player' }, { id: 'visual', label: '氛围', icon: <Palette size={18}/>, disabled: !completeProject || audience === 'player' },
        { id: 'ai', label: 'AI', icon: <Sparkles size={18}/>, disabled: audience === 'player', group: 'utility' }, { id: 'history', label: '历史', icon: <BookOpen size={18}/>, disabled: !completeProject || audience === 'player', group: 'utility' },
      ]} activeModule={audience === 'player' ? 'scene' : sidebar} onModuleChange={id => setSidebar(id as typeof sidebar)} resourceTitle={audience === 'player' ? '场景' : ({ scene: '场景', library: '素材与布景', building: '建筑', outdoor: '地形', visual: '氛围', generate: '生成', ai: 'AI', history: '历史' })[sidebar]} inspectorTitle={audience === 'player' ? '玩家输出预览' : catalogDetailOpen ? '素材详情' : detailMode === 'review' ? '候选审阅' : detailMode === 'layer' ? '图层详情' : detailMode === 'settings' ? '场景设置' : '当前详情'}
        resources={resourcePanels} inspector={<>
          <div ref={setCatalogTarget} hidden={!catalogDetailOpen || audience !== 'gm'} data-catalog-detail-open={catalogDetailOpen} onKeyDown={event => { if (event.key === 'Escape' && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) { event.preventDefault(); event.stopPropagation(); setCatalogDetailOpen(false) } }}/>
          <div hidden={catalogDetailOpen && audience === 'gm'} className="workspace-context-content">
            {audience === 'gm' && detailMode !== 'selection' && detailMode !== 'review' && <button className="secondary asset-wide" onClick={() => { if (guard()) inspect('selection') }}>返回所选对象</button>}
            <div hidden={detailMode !== 'selection' && audience === 'gm'}>{inspectorPanel}</div>
            <div hidden={detailMode !== 'settings' || audience !== 'gm'}>{projectTools}</div>
            <div hidden={detailMode !== 'samples' || audience !== 'gm'}>{sampleTools}</div>
            <div ref={setBuildingTarget} hidden={detailMode !== 'building' || audience !== 'gm'}/><div ref={setOutdoorTarget} hidden={detailMode !== 'outdoor' || audience !== 'gm'}/><div ref={setVisualTarget} hidden={detailMode !== 'visual' || audience !== 'gm'}/><div ref={setHistoryTarget} hidden={detailMode !== 'history' || audience !== 'gm'}/>
            <div hidden={detailMode !== 'sculpt' || audience !== 'gm'}>{completeProject && sculptSession ? <TerrainSculptTools project={completeProject} selectedIds={sculptSession.ids} state={sculptSession.state} operationId={sculptSession.operationId} excludedIds={scopedHiddenIds}
              disabled={toolDisabled(['sculptForm']) || !sculptFresh} disabledReason={!sculptFresh ? '工程基线已改变，请取消局部高程草稿后重新选择。' : undefined}
              onChange={next => { if (sculptFresh && guard('sculptForm')) setSculptSession(current => current ? { ...current, state: next } : current) }} onCancel={cancelSculpt} onFinishReady={onSculptFinishReady}
              onPreview={(commands, description, createdAreaId) => {
                if (!sculptFresh) { setMessage('局部高程草稿基线已改变，请取消并重新选择；工程未修改。'); return }
                previewOutdoor(commands, description, createdAreaId, 'sculptForm')
              }}/> : <p className="asset-muted">先选择一个简单裸地面，再开始局部台地或洼地工具。</p>}</div>
            <div hidden={detailMode !== 'elevation' || audience !== 'gm'}>{completeProject && elevationSession ? <TerrainElevationTools scene={completeProject.document} selectedIds={elevationSession.ids} state={elevationSession.state}
              disabled={toolDisabled(['elevationForm']) || !elevationFresh} disabledReason={!elevationFresh ? '工程基线已改变，请取消高程草稿后重新选择。' : undefined}
              onChange={next => { if (elevationFresh && guard('elevationForm')) setElevationSession(current => current ? { ...current, state: next } : current) }} onCancel={cancelElevation}
              onPreview={(commands, description) => {
                if (!elevationFresh) { setMessage('高程草稿基线已改变，请取消并重新选择；工程未修改。'); return }
                if (!commands.every(isOutdoorCommand)) { setMessage('高程候选包含不支持的命令。'); return }
                previewOutdoor(commands as OutdoorCommand[], description, undefined, 'elevationForm')
              }}/> : <p className="asset-muted">从地形模块开始整面高程工具；先选择完整地形面，或从地面取高。</p>}</div>
            <div hidden={detailMode !== 'outdoorEdit' || audience !== 'gm'}>{terrainEditTools}{completeProject && !completeProject.document.generation && <p className="asset-muted">岸线与局部笔刷需要带生成来源的地形。已有手工地形可从场景中选择后调整轮廓与参数。</p>}</div><div hidden={detailMode !== 'regenerate' || audience !== 'gm'}>{localGenerationTools}</div><div hidden={detailMode !== 'dress' || audience !== 'gm'}>{dressingTools}{completeProject && <VegetationCompositionTools key={panelKey + '-' + completeProject.document.revision + '-' + currentLayerId + '-community'} scene={completeProject.document} appearance={completeProject.appearance} layerId={currentLayerId} disabled={toolDisabled(['outdoorForm']) || effectiveHiddenLayers.has(currentLayerId)} onDraftChange={() => markFormDraft('outdoorForm')} onPreview={(commands, label) => previewDecorations(commands, label, 'outdoorForm', true)}/>}<div>{completeProject && <DecorationPanel key={`${panelKey}-${completeProject.document.revision}-${currentLayerId}-${formReset.outdoorForm}-decorations`} scene={completeProject.document} layerId={currentLayerId} disabled={toolDisabled(['outdoorForm']) || effectiveHiddenLayers.has(currentLayerId)} onPrepareSources={previewDecorationSources} onCreate={command => previewDecorations([command], '簇状布景', 'outdoorForm', true)} onCanvasBrushChange={setCanopyBrush} onDraftChange={dirty => dirty ? markFormDraft('outdoorForm') : finishFormDraft('outdoorForm')}   onPreview={(commands, label) => previewDecorations(commands, label)} onSelect={select}/>}</div></div><div hidden={detailMode !== 'outdoorAggregate' || audience !== 'gm'}>            {completeProject && <AggregateNaturalPanel scene={completeProject.document} disabled={toolDisabled(['outdoorForm'])} onPreview={(commands, description) => previewBuilding(commands, description, 'outdoorForm')} onSelect={select} onSelectMany={selectMany}/>}</div>
            <div hidden={detailMode !== 'layer' || audience !== 'gm'}>{completeProject && inspectedLayerId && <SelectionSubscriber session={selectionSession}>{() => <><h2>{completeProject.document.userLayers[inspectedLayerId]?.name}</h2><p className="asset-muted">图层持续规则 · 影响本层现有及后续对象。</p><div onChangeCapture={() => markFormDraft('appearanceForm')}><AppearancePanel key={`${panelKey}-${formReset.appearanceForm}-layer`} project={completeProject} ids={[]} layerId={inspectedLayerId} scopeKind="layer" disabled={toolDisabled(['appearanceForm'])} onPreview={(commands, description) => preview(commands, description, undefined, 'appearanceForm')}/></div></>}</SelectionSubscriber>}</div>
            <div hidden={detailMode !== 'review' || audience !== 'gm'}>{reviewPanel}<div ref={setReviewTarget}/></div>
          </div>
        </>} tools={workspaceTools} footer={workspaceFooter}>{canvasPanel}</WorkspaceLayout>
      {uvttProject && <UvttExportDialog project={uvttProject} onClose={() => setUvttProject(null)}/>}
      <input hidden ref={file} type="file" accept=".sceneweave" aria-label="选择完整工程" onChange={event => { const selected = event.target.files?.[0]; event.target.value = ''; if (selected && guard()) onImportFile(selected) }}/>
      {busy && !preparation && <div className="asset-busy" role="status"><LoaderCircle size={17} className="spin"/>{busyMessage}{controller.current && <button onClick={() => controller.current?.abort()}>取消准备</button>}</div>}
    </div>
    {active && completeProject && audience === 'gm' && enhancementTarget && <SceneAssetEditor key={`${completeProject.document.sceneId}-${enhancementTarget.kind}-${enhancementTarget.id}`} project={completeProject} target={enhancementTarget} disabled={editDisabled} previewActive={!!structure} resumeRequest={assetEditorResume} onDraftChange={onAssetEditorDraft} propertiesDirty={propAppearanceDraftOwners.current.editor || enhancementTarget.kind !== 'prop' && formDrafts.appearanceForm} onPreview={previewImageEnhancement} onRefinementPreview={previewImageRefinement} onClose={() => { assetEditorDraft.current = false; onEditorAppearanceDraft(false); if (enhancementTarget.kind !== 'prop') finishFormDraft('appearanceForm', true); else setFormReset(current => ({ ...current, propAppearanceForm: current.propAppearanceForm + 1 })); setEnhancementTarget(null) }} properties={enhancementTarget.kind === 'prop' ? <SceneInspector project={completeProject} selected={enhancementTarget.id} busy={toolDisabled(['propAppearanceForm'])} appearanceResetKey={formReset.propAppearanceForm} onAppearanceDraftChange={onEditorAppearanceDraft} workspace={compositionWorkspace} onSelect={id => { select(id) }} onCommit={commit} onPreview={(commands, description) => preview(commands, description, undefined, Array.isArray(commands) && commands.some(command => command.type === 'replacePropAppearance') ? 'propAppearanceForm' : undefined)} onPropCommand={(commands, description, selectionAfterCommit) => editInspectorProp(enhancementTarget.id, commands, description, selectionAfterCommit)}/> : <div onChangeCapture={() => markFormDraft('appearanceForm')}><AppearancePanel project={completeProject} ids={[enhancementTarget.id]} layerId={completeProject.document.entityLayers[enhancementTarget.id]} scopeKind="targets" disabled={toolDisabled(['appearanceForm'])} onPreview={(commands, description) => preview(commands, description, undefined, 'appearanceForm')}/></div>}/>}
    {active && menu && project && <SceneContextMenu key={`${menu.checkpoint}-${menu.x}-${menu.y}-${menu.ids.join('|')}`} project={project} menu={menu} onMoveToLayer={() => { try { compositionWorkspace.assertCheckpoint(menu.checkpoint); selectionSession.set(menu.ids); setLayerMoveRequest(value => value + 1); openLayers() } catch (error) { setMessage(String(error)) } }} onClose={closeMenu} onAction={action => batchAction(action, undefined, menu.ids, menu.checkpoint)} onSelect={select} onFit={() => setFitRequest(value => value + 1)} onPlace={(id, point) => { try { compositionWorkspace.assertCheckpoint(menu.checkpoint); choosePlacement(id, point) } catch (error) { setMessage(String(error)) } }} onEdit={() => { inspect('selection'); requestAnimationFrame(() => requestAnimationFrame(() => { const input = shell.current?.querySelector<HTMLElement>('.asset-inspector input:not(:disabled)') ?? shell.current?.querySelector<HTMLElement>('.asset-inspector button:not(:disabled)'); input?.focus() })) }}/>}
    {active && (candidate || newScene || preparation) && <div className="modal-scrim workspace-modal-scrim"><div ref={dialog} className="modal workspace-modal" role="dialog" aria-modal="true" aria-label={preparation ? '准备打开工程' : newScene ? '新建空白场景' : '确认打开工程'}>
      <div className="modal-heading"><h2>{preparation ? '准备打开工程' : newScene ? '新建空白场景' : '确认打开工程'}</h2><button className="icon-button" disabled={preparation ? preparation.cancelling : busy && !(newScene && creatingStage === 'preparing')} aria-label={preparation ? '关闭准备窗口' : newScene ? '取消新建场景' : '取消打开工程'} onClick={() => { if (preparation) cancelPreparation(); else if (newScene) cancelNewScene(); else setCandidate(null) }}><X size={18}/></button></div>
      {preparation ? <>
        <p>{preparation.description}</p>
        <p role="status">{preparation.cancelling ? '正在取消准备…' : preparation.progress?.phase === 'resources' ? `正在读取场景素材 ${preparation.progress.completed} / ${preparation.progress.total}` : preparation.progress?.phase === 'validation' ? '正在检查完整场景与素材…' : '正在准备场景…'}</p>
        <progress className="asset-preparation-progress" aria-label="工程准备进度" max={preparation.progress?.total || 1} value={preparation.progress?.phase === 'resources' ? preparation.progress.completed : undefined}/>
        <p className="asset-muted">准备完成后可审阅并打开副本，当前工程保持。</p>
        <div className="modal-actions"><button className="secondary" disabled={preparation.cancelling} onClick={cancelPreparation}>取消准备</button></div>
      </> : newScene ? <NewSceneForm visualPack={visualNewScene} busy={busy} cancellable={creatingStage === 'preparing'} failure={message ?? state.error} onCreate={createScene} onCancel={cancelNewScene}/> : candidate && <><p>{candidate.description}</p><div className="asset-candidate"><strong>{candidate.project.document.title}</strong><span>{Object.keys(candidate.project.assets).length} 张位图 · {Object.keys(candidate.project.document.props).length} 件物件 · 完整工程</span></div>{message && <p role="alert" className="asset-form-error">{message}</p>}<div className="modal-actions"><button className="secondary" disabled={busy} onClick={() => setCandidate(null)}>取消</button><button className="primary" disabled={busy} onClick={() => void action(async () => { await ready(); await compositionWorkspace.adoptNew(candidate.project, candidate.checkpoint); if (imageImportDraftMatches(imageImportDraftRef.current, candidate.imageDraftToken)) updateImageImportDraft(null); setCandidate(null); setSelected(null); setAudience('gm'); setSessionGeneration(value => value + 1) })}>保存并打开副本</button></div></>}
    </div></div>}
  </WorkspacePresentationContext.Provider>
}
