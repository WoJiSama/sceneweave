import { rebindPathAttachmentProofs } from '../../shared/path-attachments/state.js'
import { isDecorationCommand } from '../../shared/decorations/commands.js'
import type { AggregateEditBoundaryImpact } from './aggregate-boundary.js'
import { catalogAdditionCost, CATALOG_ADOPTION_LIMIT } from './catalog-budget.js'
import { emptyBudgetUsage, parseTaskBudgetProfile, type TaskBudgetProfile } from '../../shared/budget/task-budget.js'
import { assertCommandBudget, measureCommandBudget, retainLocalCommandBudget, selectManualTransactionBudget, type ManualTransactionBudget, type CommandBudgetUsage } from '../../shared/budget/command-budget.js'
import { selectManualCommandBudget } from '../../shared/budget/manual-request.js'
import { ProfiledAuthoringScopeSchema } from '../../shared/ai/authoring-profile.js'
import { prepareTerrainComposition } from './terrain-composition.js'
import { prepareBaseMapProject, type BaseMapPreparationOptions } from './base-map.js'
import type { InteriorCandidate } from './interior.js'
import type { ForestCandidate } from './forest.js'
import type { VolcanoCandidate } from './volcano.js'
import type { MixedCandidate } from './mixed.js'
import { prepareDomainProject, type DomainGenerationExecutor } from './generation.js'
import { getCompositionTransactionReceipt, isIssuedCompositionTransactionReceipt, releaseCompositionTransactionReceipt } from '../../shared/appearance/commands.js'
import type { TransactionReceipt } from '../../shared/transaction/receipt.js'
import type { DomainGenerationKind } from '../../shared/generation/execution.js'
import type { LocalGenerationRequest } from '../../shared/generation/local.js'
import { BaseMapExecutionClock } from './base-map-clock.js'
import type { BaseMapRequest } from '../../shared/terrain-generation/base-map.js'
import type { BaseMapRequestV2 } from '../../shared/terrain-generation/base-map-v2.js'
import type { BaseMapRequestV3 } from '../../shared/terrain-generation/base-map-v3.js'
import type { BaseMapSourceV3 } from '../../shared/ai/continuation-protocol-v3.js'
import { isClassifiedAuthoring, isClassifiedAuthoringState } from '../../shared/ai/authoring.js'
import { createCurrentAuthoringStartV4, createGeneratedAuthoringStartV4 } from '../../shared/ai/current-authoring.js'
import { CurrentAuthoringScopeV4Schema, type AuthoringStartV4, type CurrentAuthoringScope } from '../../shared/ai/authoring-protocol-v4.js'
import type { BaseMapSource } from '../../shared/ai/continuation-protocol.js'
import { CONTINUATION_POLICY, createContinuationPolicyV2 } from '../../shared/ai/budget-policy.js'
import { authoringBudgetIdentity } from '../../shared/ai/authoring.js'
import { emptyCompositionDocument } from '../../shared/terrain-generation/composition-materialize.js'
import { createCompositionContent } from '../../shared/appearance/graph.js'
import { getProjectLocalTransaction, projectContentHash, releaseProjectLocalTransaction, releaseProjectTransactionReceipt } from '../../shared/project/validate.js'
import { prepareTerrainProject, type TerrainPreview } from './terrain.js'
import { prepareTerrainEditProject, type TerrainEditPreview } from './terrain-edit.js'
import { prepareTerrainLocalRefreshProject, type TerrainLocalPreview } from './terrain-local.js'
import { prepareLocalGenerationProject, protectLocalGenerationContinuity, type LocalGenerationPreview } from './generation-local.js'
export type { LocalGenerationPreview } from './generation-local.js'
import { prepareRegionalCreate, prepareRegionalEdit, prepareRegionalDrillDown, prepareRegionalDrillDownFromResult, type RegionalCandidate } from './regional.js'
import type { RegionalDrillDownResult } from '../../shared/terrain-generation/regional-authoring.js'
import { regionalSceneCandidate } from '../../shared/ai/terrain-authoring.js'
import { RegionSceneCandidateResultSchema } from '../../shared/ai/region-candidate-protocol.js'
import type { TerrainEditResult, ProfiledTerrainEditResult } from '../../shared/terrain-generation/edit.js'
import type { TerrainGenerationResult } from '../../shared/terrain-generation/generate.js'
import { visualBase } from '../../shared/visual/base.js'
import { visualBindingEntityIds } from '../../shared/visual/diagnostics.js'
import { planTerrainDressing, type TerrainDressingReport } from '../../shared/visual/terrain-dressing.js'
import type { CompositionCommand, CompositionContent } from '../../shared/model/appearance.js'
import type { PreparationContext } from '../../shared/ports/runtime.js'
import type { CompleteValidationOptions } from '../../shared/ports/resources.js'
import { checkCancelled } from '../../shared/ports/resources.js'
import type { SceneDocument, SurfaceRef } from '../../shared/model/scene.js'
import type { LicenseBinding, SnapshotSummary } from '../../shared/model/project.js'
import { getVerifiedProjectBundle, validateProjectSnapshot } from '../../shared/project/resources.js'
import { certifyCompositionContent, getCompositionRevisionTransaction, getPropUpdateCompositionTransaction, releaseCompositionRevisionTransaction, releasePropUpdateCompositionTransaction, reviseCompositionContent } from '../../shared/validation/content.js'
import { validateCompositionIdentityContracts } from '../../shared/terrain-generation/composition-integrity.js'
import { surfaceStyle } from '../../shared/appearance/graph.js'
import { inspectDependencies } from '../../shared/geometry/dependencies.js'
import { reviseSceneSnapshot } from '../../shared/validation/snapshots.js'
import { assertAllFloorPlayerProjections } from '../../shared/projection/projection.js'
import { advanceHistoryIdentity, mergeIdentityRecords, mergeHistoryIdentities } from '../../shared/history/identity.js'
import { buildRestorePlan, generationRestoreChanges, type RestorePlan, type RestoreRequest } from '../../shared/history/restore.js'
import { terrainCommandCost } from '../../shared/terrain-generation/cost.js'
import { pauseChangedCompositions } from '../../shared/terrain-generation/composition-lifecycle.js'
import { StructureContinuitySession } from '../../shared/history/structure-continuity.js'
import { VisualContinuitySession, visualTopology } from '../../shared/history/visual-continuity.js'
import { buildStructureRestorePlan, inspectStructureRestoreScope, type StructureRestorePlan, type StructureRestoreRequest, type StructureRestoreScope } from '../../shared/history/structure-restore.js'
import { validateHistoryArchive, type HistoryArchive } from '../../shared/project/history.js'
import { captureJson } from '../../shared/validation/json.js'
import { prepareFillCopy, type FillCopyReport, type FillCopyRequest } from './fill-copy.js'
import type { AuthoringDraft, AuthoringScope, AuthoringStart, DraftLease } from '../../shared/ai/authoring-protocol.js'
import { AuthoringScopeSchema } from '../../shared/ai/authoring-protocol.js'
import { authoringProjectHash } from '../../shared/ai/authoring.js'
import type { ResourceOptions } from '../../shared/ports/resources.js'
import type { ProjectStore, CreateSnapshotOptions, ProjectSaveGuard, SnapshotReadSession, SourcePreservationGuard } from '../ports/project-store.js'
import { assertAtomicLease, atomicChanges, captureAtomicDraft, captureAtomicStart, freezeAtomic, pureProject,
  type AtomicAuthorization, type AtomicCandidate, type AtomicCandidateRecord, type AtomicAdoptionResult, type AtomicCandidateStatus } from './atomic.js'
import { materializeAuthoringArtwork } from './artwork.js'
import { assertAssetQualityAccepted, type AssetQualityAssessment } from '../../shared/assets/quality-review.js'
import { combineManualPreparationUsage, materializeProject, prepareCompositionCommands } from './prepare.js'
import { captureEditableDraft, consumeEditableSnapshot, fromBundle, fromVerifiedBundle, getVerifiedEditableProject, toBundle, tryDeriveEditableProject, validateEditableProject, type EditableProject } from './project.js'

type GeneratedAtomicStart = Extract<AuthoringStart, { schemaVersion: 2 | 3 }> | (AuthoringStartV4 & { source: BaseMapSourceV3 })
/** Classified budget identity also applies to edits of the current project. Only
 * proven generated sources use the independent base-map publication path. */
function isGeneratedAtomicStart(start: AuthoringStart): start is GeneratedAtomicStart {
  return isClassifiedAuthoring(start) && start.source.version !== 4
}

export type WorkspaceRepository = ProjectStore
export interface WorkspaceOptions { validation: CompleteValidationOptions; runtime: PreparationContext; validateCandidate?: (document: SceneDocument) => void }
export interface EditableSnapshot extends SnapshotSummary { project: EditableProject }
type SaveStatus = 'empty' | 'saved' | 'unsaved' | 'saving' | 'error' | 'conflict'
export interface WorkspaceState {
  project: EditableProject | null
  status: SaveStatus
  error: string | null
  canUndo: boolean
  canRedo: boolean
  /** Session-only completion boundary; never part of a project, checkpoint or archive. */
  lastTransaction: Readonly<{ sceneId: string; revision: number; committedAtMs: number }> | null
}
export interface CompositionPreview {
  project: EditableProject
  document: SceneDocument
  commands: readonly CompositionCommand[]
  description: string
  checkpoint: number
  currentSceneId: string
  currentRevision: number
  /** Session-only admission evidence; recomputed from the private baseline at adoption. */
  budgetUsage?: CommandBudgetUsage
  budgetProfile?: ManualTransactionBudget
  /** GM preparation diagnostics, excluded from project/history/player outputs. */
  aggregateBoundaryImpact?: AggregateEditBoundaryImpact
  /** Exact executor observations for review only; private registration still
   * owns adoption and full validation remains authoritative. */
  transaction?: TransactionReceipt
}
export interface TerrainDressingPreview {
  preview: CompositionPreview
  report: TerrainDressingReport
  cost: { total: number; limit: number }
}
export interface FillCopyPreview {
  preview: CompositionPreview
  report: FillCopyReport
  cost: { total: number; limit: number }
}
export interface RestorePreview {
  snapshot: SnapshotSummary
  plan: RestorePlan
  project: EditableProject
  checkpoint: number
  currentSceneId: string
  currentRevision: number
  sourceContentHash: string
  budgetProfile: ManualTransactionBudget
}
export interface StructureRestorePreview extends Omit<RestorePreview, 'plan'> {
  plan: StructureRestorePlan
}
export interface RegionalPreview extends RegionalCandidate {
  checkpoint: number
  currentSceneId: string | null
  currentRevision: number | null
  baseContentHash: string | null
}
export interface InteriorPreview extends InteriorCandidate {
  checkpoint: number
  currentSceneId: string | null
  currentRevision: number | null
  baseContentHash: string | null
}
export interface ForestPreview extends ForestCandidate {
  checkpoint: number
  currentSceneId: string | null
  currentRevision: number | null
  baseContentHash: string | null
}
export interface VolcanoPreview extends VolcanoCandidate {
  checkpoint: number
  currentSceneId: string | null
  currentRevision: number | null
  baseContentHash: string | null
}
export interface MixedPreview extends MixedCandidate {
  checkpoint: number
  currentSceneId: string | null
  currentRevision: number | null
  baseContentHash: string | null
}
export interface DomainPreviewMap { interior: InteriorPreview; forest: ForestPreview; volcano: VolcanoPreview; mixed: MixedPreview }
export interface GenerationPreviewOptions extends ResourceOptions { execute?: DomainGenerationExecutor; epoch?: number }
type NewGenerationRequest<K extends DomainGenerationKind = DomainGenerationKind> = { kind: 'new-project'; domain: K; base: EditableProject; input: unknown; profile: TaskBudgetProfile }
type CurrentGenerationRequest = { kind: 'current-project'; input: LocalGenerationRequest; profile?: TaskBudgetProfile }
type GenerationSelection = { [K in DomainGenerationKind]: { kind: 'new-project'; domain: K; preview: DomainPreviewMap[K] } }[DomainGenerationKind]
  | { kind: 'current-project'; preview: LocalGenerationPreview }
export interface StructureRestoreInspection {
  snapshot: SnapshotSummary
  scope: StructureRestoreScope
  checkpoint: number
  currentRevision: number
  sourceContentHash: string
  budgetProfile: ManualTransactionBudget
}
type PreviewStatus = 'active' | 'applying' | 'cancelled' | 'applied'
const copy = <T>(value: T): T => structuredClone(value)
function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !(value instanceof Blob) && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) freeze(child)
  }
  return value
}
function captureCommands(commands: readonly CompositionCommand[]): readonly CompositionCommand[] {
  const captured = freeze(captureJson(commands))
  const removedStructureIds = new Set(captured.flatMap(command => command.type === 'deleteOpening' || command.type === 'deleteNote' || command.type === 'deleteRoom' ? [command.id] : []))
  if (captured.some(command => (command.type === 'addOpening' || command.type === 'createNote' || command.type === 'createRoom') && removedStructureIds.has(command.id))) {
    throw new Error('同一事务不能删除后重建同一结构 ID；请使用明确更新，结构删除重建不能用于历史恢复。')
  }
  return captured
}
const message = (error: unknown) => error instanceof Error ? error.message : String(error)
const saveMessage = (error: unknown) => error instanceof Error && error.name === 'QuotaExceededError'
  ? `浏览器存储空间不足：${message(error)}` : message(error)
const canonical = (value: unknown): string => JSON.stringify(value, (_key, item: unknown) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item)
/** Only compare privately validated JSON branches; this is not an input validator or a hash. */
function equalOwnedJson(left: unknown, right: unknown): boolean {
  if (left === right) return true
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') return false
  if (Array.isArray(left)) return Array.isArray(right) && left.length === right.length
    && left.every((value, index) => equalOwnedJson(value, right[index]))
  if (Array.isArray(right)) return false
  const a = left as Record<string, unknown>, b = right as Record<string, unknown>, keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && equalOwnedJson(a[key], b[key]))
}
function equalOwnedContent(left: CompositionContent, right: CompositionContent): boolean {
  const receipt = getCompositionTransactionReceipt(contentOf(right), contentOf(left))
  if (receipt) return receipt.changes.length === 0
  const local = getPropUpdateCompositionTransaction(contentOf(right), contentOf(left))
  if (local) return local.changes.length === 0
  return equalOwnedJson(left.document, right.document) && equalOwnedJson(left.appearance, right.appearance)
    && equalOwnedJson(left.historyIdentity, right.historyIdentity)
}
const anchorTopology = (anchor: SceneDocument['notes'][string]['anchor'] | undefined) => anchor?.type === 'point' ? { type: 'point' } : anchor
const bindingKey = (binding: Pick<LicenseBinding, 'subjectKind' | 'subjectId'>) => JSON.stringify([binding.subjectKind, binding.subjectId])
const catalogCollections = ['assets', 'materials', 'propDefinitions', 'prefabDefinitions', 'styleThemes'] as const
const fixedAppearanceCollections = ['sources', 'variants', 'prefabAppearanceTemplates', 'presentations'] as const
const contentOf = (project: CompositionContent): CompositionContent => ({ document: project.document, historyIdentity: project.historyIdentity, appearance: project.appearance })
const withoutKeys = (value: object, keys: readonly string[]) => Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)))
function assertAppendOnly(label: string, current: Record<string, unknown>, candidate: Record<string, unknown>) {
  for (const [id, value] of Object.entries(current)) {
    if (!Object.hasOwn(candidate, id) || canonical(value) !== canonical(candidate[id])) throw new Error(`素材入库不能删除或修改既有${label}：${id}。`)
  }
}
function invalidatedStructureIds(document: SceneDocument, commands: readonly CompositionCommand[]): string[] {
  return commands.flatMap(command => {
    if (command.type === 'deleteOpening' || command.type === 'deleteNote' || command.type === 'reverseWall' || command.type === 'splitWall') return [command.id]
    if (command.type === 'updateOpening') {
      const before = document.openings[command.id]
      if (command.changes.wallId !== undefined && command.changes.wallId !== before?.wallId
        || command.changes.offsetReferenceVertexId !== undefined && command.changes.offsetReferenceVertexId !== before?.offsetReferenceVertexId) return [command.id]
    }
    if (command.type === 'updateNote' && command.changes.anchor !== undefined
      && canonical(anchorTopology(command.changes.anchor)) !== canonical(anchorTopology(document.notes[command.id]?.anchor))) return [command.id]
    return []
  })
}
/** Observe destructive intermediate visual identities even if a later command restores equal JSON. */
function invalidatedVisualIds(document: SceneDocument, commands: readonly CompositionCommand[]): string[] {
  if (!document.visual) return []
  const visualCommands = commands.filter(command => command.type === 'removeVisualBoundary' || command.type === 'removeVisualEffect'
    || command.type === 'upsertVisualBoundary' || command.type === 'upsertVisualEdgeLook' || command.type === 'upsertVisualLight'
    || command.type === 'upsertVisualFog' || command.type === 'upsertVisualFilter')
  if (!visualCommands.length) return []
  // Only visual records are changed by this intermediate-topology witness.
  // Keep the remaining immutable scene branches rather than cloning every prop.
  const scene = { ...document, visual: copy(document.visual) }, invalid = new Set<string>()
  for (const command of visualCommands) {
    const before = visualTopology(scene), visual = visualBase(scene)
    if (!visual) continue
    if (command.type === 'removeVisualBoundary') delete visual.boundaries[command.id]
    else if (command.type === 'removeVisualEffect') { const key = { edgeLook: 'edgeLooks', light: 'lights', fog: 'fogs', filter: 'filters' } as const; delete visual[key[command.kind]][command.id] }
    else if (command.type === 'upsertVisualBoundary') visual.boundaries[command.boundary.id] = command.boundary
    else if (command.type === 'upsertVisualEdgeLook') visual.edgeLooks[command.edgeLook.id] = command.edgeLook
    else if (command.type === 'upsertVisualLight') visual.lights[command.light.id] = command.light
    else if (command.type === 'upsertVisualFog') visual.fogs[command.fog.id] = command.fog
    else if (command.type === 'upsertVisualFilter') visual.filters[command.filter.id] = command.filter
    const after = visualTopology(scene)
    for (const id of new Set([...before.keys(), ...after.keys()])) if (before.get(id) !== after.get(id)) invalid.add(id)
  }
  return [...invalid]
}

export function forkProject(project: EditableProject, runtime: PreparationContext): EditableProject {
  const result = captureEditableDraft(project), now = runtime.clock.now()
  Object.assign(result.document, { sceneId: runtime.ids.nextId(), revision: 0, createdAt: now, updatedAt: now, title: `${result.document.title} · 副本` })
  return result
}

/** Select the candidate's exact adopted closure; old resources stay in undo and named history. */
function restorationProject(current: EditableProject, historic: EditableProject, plan: RestorePlan): EditableProject {
  const assets: EditableProject['assets'] = {}, licenses: EditableProject['licenses'] = {}, authoringSources: EditableProject['authoringSources'] = {}
  const dependencies = inspectDependencies(plan.document)
  if (dependencies.errors.length) throw new Error(dependencies.errors.map(issue => issue.message).join('；'))
  for (const id of dependencies.assetIds) {
    const hash = plan.document.assets[id].sha256
    const asset = current.assets[hash] ?? historic.assets[hash]
    if (!asset) throw new Error(`恢复所需位图缺失：${id}。`)
    assets[hash] = asset
    const source = current.authoringSources[id] ?? historic.authoringSources[id]
    if (source) authoringSources[id] = source
  }
  const adoptedHistoricSubjects = new Set(plan.adoptedSubjects.map(bindingKey))
  const currentBindings = new Map(current.licenseBindings.map(binding => [bindingKey(binding), binding]))
  const historicBindings = new Map(historic.licenseBindings.map(binding => [bindingKey(binding), binding]))
  const bindings = new Map<string, LicenseBinding>()
  for (const subject of dependencies.subjects) {
    const key = bindingKey(subject)
    const before = currentBindings.get(key)
    const after = adoptedHistoricSubjects.has(key) ? historicBindings.get(key) : undefined
    if (before && after && canonical(before) !== canonical(after)) throw new Error(`恢复许可主体存在固定版本冲突：${subject.subjectId}。`)
    let binding = before ?? after
    // The pure restore may create an immutable carrier for an ancestor bitmap absent
    // from this undo branch. Its exact asset binding is the only inheritance source.
    if (!binding && subject.subjectKind === 'propDefinition'
      && !current.document.propDefinitions[subject.subjectId] && !historic.document.propDefinitions[subject.subjectId]) {
      const definition = plan.document.propDefinitions[subject.subjectId]
      if (definition.id.startsWith('composition-retained-prop-') && definition.tags.includes('sceneweave:retained-appearance')
        && definition.defaultAppearance.kind === 'image') {
        const assetKey = bindingKey({ subjectKind: 'asset', subjectId: definition.defaultAppearance.assetId })
        const source = currentBindings.get(assetKey) ?? (adoptedHistoricSubjects.has(assetKey) ? historicBindings.get(assetKey) : undefined)
        if (source?.embedding === 'allowed' && source.licenseRef === definition.licenseRef) binding = { ...source, subjectKind: 'propDefinition', subjectId: definition.id }
      }
    }
    if (!binding) throw new Error(`恢复所需许可绑定缺失：${subject.subjectId}。`)
    bindings.set(key, binding)
    const hash = binding.licensePath.slice(9, -4), license = current.licenses[hash] ?? historic.licenses[hash]
    if (!license) throw new Error(`恢复所需许可文本缺失：${subject.subjectId}。`)
    licenses[hash] = license
  }
  const licenseBindings = [...bindings.values()]
  // Only the workspace's exact owned project can retain its byte certificate.
  // Selection above still resolves every real asset/source/license dependency;
  // changed closures use the merged reader and full materialization as before.
  const sameClosure = getVerifiedEditableProject(current)
    && canonical(assets) === canonical(current.assets)
    && canonical(licenses) === canonical(current.licenses)
    && canonical(authoringSources) === canonical(current.authoringSources)
    // Binding order is not a resource change. Compare every unique subject and
    // all of its fields, then preserve the current order instead of rewriting it.
    && licenseBindings.length === current.licenseBindings.length
    && current.licenseBindings.every(binding => {
      const selected = bindings.get(bindingKey(binding))
      return selected !== undefined && canonical(selected) === canonical(binding)
    })
  return { ...current, document: plan.document, historyIdentity: plan.historyIdentity, appearance: plan.appearance,
    ...(sameClosure ? { assets: current.assets, licenses: current.licenses, authoringSources: current.authoringSources,
      licenseBindings: current.licenseBindings, resources: current.resources }
      : { assets, licenses, authoringSources, licenseBindings, resources: Object.freeze({ read: (hash: string) => Object.hasOwn(current.assets, hash) || Object.values(current.authoringSources).some(source => source.sourceSha256 === hash || source.normalizedSha256 === hash) ? current.resources.read(hash) : historic.resources.read(hash) }) }) }
}

/** Diff rows describe the actual materialized result, including today's layer in source mode. */
function materializedRestorePlan(current: EditableProject, plan: RestorePlan, project: EditableProject, budget: ManualTransactionBudget): RestorePlan {
  const changes = plan.changes.filter(change => change.kind !== 'generation').map(change => {
    if (change.after === null || typeof change.after !== 'object' || Array.isArray(change.after)) return change
    const after = copy(change.after) as Record<string, unknown>
    if (change.kind === 'prop') {
      const prop = project.document.props[change.id]
      if (Object.hasOwn(after, 'entity')) after.entity = prop ? copy(prop) : null
      if (prop) for (const field of Object.keys(after)) if (Object.hasOwn(prop, field)) after[field] = copy(prop[field as keyof typeof prop])
      if (Object.hasOwn(after, 'sourceId')) after.sourceId = project.appearance.propSources[change.id]
      if (Object.hasOwn(after, 'adjustments')) after.adjustments = copy(project.appearance.instanceAdjustments[change.id] ?? [])
    } else if (change.kind === 'surface') {
      after.surfaceStyle = copy(surfaceStyle(project.document, change.id))
      after.sourceId = project.appearance.surfaceSources[change.id]
      after.adjustments = copy(project.appearance.instanceAdjustments[change.id] ?? [])
    } else if (change.kind === 'scatterGroup' && typeof after.candidateKey === 'string' && Object.hasOwn(after, 'member')) {
      after.member = copy(project.document.scatterGroups[change.id]?.members[after.candidateKey] ?? null)
    }
    return { ...change, after }
  }).filter(change => canonical(change.before) !== canonical(change.after) || change.beforeLayerId !== change.layerId)
  let commandCost = plan.commandCost
  {
    changes.push(...generationRestoreChanges(current.document, project.document))
    commandCost = assertCommandBudget(budget,
      measureCommandBudget(current.document, project.document, { before: current, after: project }, undefined, budget)).semanticTargets
  }
  return { ...plan, document: project.document, historyIdentity: project.historyIdentity, appearance: project.appearance, changes, commandCost,
    affectedIds: [...new Set([...plan.affectedIds, ...changes.map(change => change.id)])].sort(),
    changed: canonical({ document: current.document, appearance: current.appearance }) !== canonical({ document: project.document, appearance: project.appearance }) }
}

/** Resolve data-dependent restore expansion before preparing a candidate. The
 * final restore meter still checks the exact writes under this frozen tier. */
function manualRestoreBudget(current: EditableProject, historic: EditableProject, request: { ids: readonly string[]; mode: string }, structural = false): ManualTransactionBudget {
  const affected = new Set(request.ids), roots = new Set(request.ids)
  for (const { document } of [current, historic]) {
    if (request.mode === 'layer') {
      for (const [id, layerId] of Object.entries(document.entityLayers)) if (roots.has(layerId)) affected.add(id)
    }
    for (const id of request.ids) {
      for (const member of Object.values(document.prefabInstances[id]?.members ?? {})) if (member.propId) affected.add(member.propId)
      for (const member of Object.values(document.scatterGroups[id]?.members ?? {})) if (member.propId) affected.add(member.propId)
      if (request.mode === 'visual') {
        const visual = visualBase(document), filter = visual?.filters[id]
        if (filter?.target.kind === 'entities') for (const target of filter.target.ids) affected.add(target)
        if (filter?.target.kind === 'layer') for (const [entity, layer] of Object.entries(document.entityLayers)) if (layer === filter.target.layerId) affected.add(entity)
        const boundary = visual?.boundaries[id]
        if (boundary) {
          for (const target of visualBindingEntityIds(boundary)) affected.add(target)
          for (const edge of Object.values(visual!.edgeLooks)) if (edge.boundaryId === id) affected.add(edge.id)
        }
      }
    }
    if (structural) {
      const vertices = new Set(request.ids.filter(id => Object.hasOwn(document.vertices, id)))
      for (const id of request.ids) {
        for (const vertex of document.rooms[id]?.boundaryVertexIds ?? []) vertices.add(vertex)
        const wall = document.walls[id]
        if (wall) { vertices.add(wall.startVertexId); vertices.add(wall.endVertexId) }
      }
      const walls = new Set(Object.values(document.walls).filter(wall => vertices.has(wall.startVertexId) || vertices.has(wall.endVertexId)).map(wall => wall.id))
      for (const id of walls) affected.add(id)
      for (const room of Object.values(document.rooms)) if (room.boundaryVertexIds.some(id => vertices.has(id))) affected.add(room.id)
      for (const opening of Object.values(document.openings)) if (walls.has(opening.wallId)) affected.add(opening.id)
    }
  }
  return selectManualTransactionBudget(current.document, affected.size)
}

/** Owns native complete-v1 history, byte closures and session-only structural evidence. */
export class Workspace {
  private state: WorkspaceState = { project: null, status: 'empty', error: null, canUndo: false, canRedo: false, lastTransaction: null }
  private readonly listeners = new Set<() => void>()
  private readonly terrainPreviews = new WeakMap<TerrainPreview, PreviewStatus>()
  private readonly domainPreviews = new WeakMap<object, { domain: DomainGenerationKind; status: PreviewStatus; base: EditableProject; preparedAt: string; identityAllocation: string[] }>()
  private readonly terrainEditPreviews = new WeakMap<TerrainEditPreview, PreviewStatus>()
  private readonly terrainLocalPreviews = new WeakMap<TerrainLocalPreview, PreviewStatus>()
  private readonly localGenerationPreviews = new WeakMap<LocalGenerationPreview, PreviewStatus>()
  private readonly regionalPreviews = new WeakMap<RegionalPreview, { status: PreviewStatus; base: EditableProject; sourceBase?: EditableProject; sourceResult?: RegionalDrillDownResult; sceneBase?: EditableProject }>()
  private readonly compositionPreviews = new WeakMap<CompositionPreview, PreviewStatus>()
  private readonly previews = new WeakMap<RestorePreview, PreviewStatus>()
  private readonly structurePreviews = new WeakMap<StructureRestorePreview, PreviewStatus>()
  private readonly atomicAuthorizations = new WeakMap<AtomicAuthorization, EditableProject>()
  private readonly atomicCandidates = new WeakMap<AtomicCandidate, AtomicCandidateRecord>()
  private readonly saveGuards = new WeakMap<EditableProject, ProjectSaveGuard>()
  private readonly completedSaveGuards = new WeakSet<ProjectSaveGuard>()
  private readonly historyParents = new WeakMap<EditableProject, { id: string; hash: string }>()
  private atomicLock: object | null = null
  private readonly structureContinuity = new StructureContinuitySession()
  private readonly visualContinuity = new VisualContinuitySession()
  private readonly structuralInvalidations = new WeakMap<EditableProject, string[]>()
  private readonly visualInvalidations = new WeakMap<EditableProject, string[]>()
  private past: EditableProject[] = []
  private readonly baseMapSources = new Map<string, { preview: TerrainPreview; project: EditableProject }>()
  private readonly baseMapExecution = new BaseMapExecutionClock(CONTINUATION_POLICY.activeExecutionMs)
  private future: EditableProject[] = []
  private persistedRevision: number | null = null
  private pending: EditableProject | null = null
  private saving: Promise<void> | null = null
  private blocked: unknown = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private copying = false
  private version = 0

  constructor(private readonly repository: WorkspaceRepository, private readonly options: WorkspaceOptions) {}
  private validateCandidate = (document: SceneDocument) => this.options.validateCandidate?.(document)
  private validation = () => this.options.validation
  private preparation = (baseline?: EditableProject) => ({ validation: this.options.validation, runtime: this.options.runtime, ...(baseline ? { baseline } : {}) })
  getManualBudget = (requestedTargets = 0): ManualTransactionBudget => selectManualTransactionBudget(this.requireProject().document, requestedTargets)
  private manualPreparation = (baseline?: EditableProject, budget = this.getManualBudget()) => ({ ...this.preparation(baseline), budget })
  getDocument = () => this.state.project?.document ?? null
  open = (project: EditableProject) => this.openPersisted(project)
  retrySave = () => this.retry()
  getState = (): WorkspaceState => this.state
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  checkpoint = () => this.version
  assertCheckpoint(checkpoint: number) {
    if (checkpoint !== this.version) throw new Error('准备期间场景已有修改，已保留当前内容，请重新预览。')
  }
  private publish(patch: Partial<WorkspaceState>) {
    this.state = { ...this.state, ...patch, canUndo: this.past.length > 0, canRedo: this.future.length > 0 }
    this.listeners.forEach(listener => listener())
  }
  private requireProject(): EditableProject {
    if (!this.state.project) throw new Error('尚未打开工程。')
    return this.state.project
  }
  private assertWritable(token?: object) {
    if (this.atomicLock && token !== this.atomicLock) throw new Error('正在保护并采用 AI 草稿或保存采用结果，请稍后重试。')
  }
  /** Only discard a save that was never started, or whose repository call has
   * settled. Undo documents, baseline evidence and protection guards stay owned. */
  private releaseSupersededSaveEvidence(project: EditableProject, replacement: EditableProject) {
    const previous = toBundle(project).project
    if (previous === toBundle(replacement).project) return
    releaseProjectLocalTransaction(previous)
    releaseProjectTransactionReceipt(previous)
  }
  private pendingSaveGuard(project: EditableProject): ProjectSaveGuard | undefined {
    const guard = this.saveGuards.get(project)
    return guard && !this.completedSaveGuards.has(guard) ? guard : undefined
  }
  private releaseBaseMapSources() {
    for (const { preview } of this.baseMapSources.values()) this.cancelTerrainGeneration(preview)
    this.baseMapSources.clear()
  }
  private install(project: EditableProject) {
    this.assertWritable()
    const verified = getVerifiedEditableProject(project)
    const owned = verified ?? captureEditableDraft(project)
    if (!verified) Object.assign(owned, certifyCompositionContent({ document: owned.document, historyIdentity: owned.historyIdentity, appearance: owned.appearance }))
    this.structureContinuity.reset(owned.document)
    this.visualContinuity.reset(owned.document)
    this.releaseBaseMapSources()
    this.version++
    // All install paths finish the previous save first. A successful independent
    // copy can still abandon an unsaved/conflicted pending branch here.
    if (this.pending) this.releaseSupersededSaveEvidence(this.pending, owned)
    this.past = []; this.future = []; this.pending = null; this.blocked = null
    this.persistedRevision = project.document.revision
    this.publish({ project: freeze(owned), status: 'saved', error: null, lastTransaction: null })
  }
  async adoptNew(input: EditableProject, checkpoint = this.checkpoint()) {
    this.assertWritable()
    checkCancelled(this.validation().signal)
    const project = getVerifiedEditableProject(input) ?? await validateEditableProject(input, this.validation())
    checkCancelled(this.validation().signal)
    this.assertCheckpoint(checkpoint)
    await this.flush()
    this.assertCheckpoint(checkpoint)
    checkCancelled(this.validation().signal)
    await this.repository.save(toBundle(project), null)
    this.assertCheckpoint(checkpoint)
    checkCancelled(this.validation().signal)
    this.install(project)
  }
  async adoptArchive(input: HistoryArchive, checkpoint = this.checkpoint()) {
    this.assertWritable()
    const archive = await validateHistoryArchive(input, this.validation())
    await this.flush()
    this.assertCheckpoint(checkpoint)
    const imported = await this.repository.importArchive(archive)
    this.assertCheckpoint(checkpoint)
    const project = await fromBundle(imported.project, this.validation())
    this.assertCheckpoint(checkpoint)
    this.install(project)
    return { ...imported, project: this.requireProject() }
  }
  async openPersisted(input: EditableProject, checkpoint = this.checkpoint()) {
    this.assertWritable()
    checkCancelled(this.validation().signal)
    const project = getVerifiedEditableProject(input) ?? await validateEditableProject(input, this.validation())
    checkCancelled(this.validation().signal)
    this.assertCheckpoint(checkpoint)
    if (project.document.sceneId === this.state.project?.document.sceneId && project.document.revision < this.state.project.document.revision) {
      throw new Error('载入结果早于当前编辑修订，已保留当前内容。')
    }
    await this.flush()
    this.assertCheckpoint(checkpoint)
    checkCancelled(this.validation().signal)
    this.install(project)
  }
  private enqueue(project: EditableProject) {
    // startSave removes its in-flight snapshot from pending before repository IO.
    // Replacing this slot therefore cannot revoke evidence being read by a save.
    if (this.pending) this.releaseSupersededSaveEvidence(this.pending, project)
    this.pending = project
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (!this.blocked && !this.copying) this.timer = setTimeout(() => { this.timer = null; void this.startSave().catch(() => {}) }, 120)
    // All domain validation, immutable state and undo/identity updates are complete.
    // Capture before notifying React so the DOM observation is a separate interval.
    const lastTransaction = Object.freeze({ sceneId: project.document.sceneId, revision: project.document.revision, committedAtMs: performance.now() })
    this.publish({ project, status: this.blocked ? this.state.status : 'unsaved', error: this.blocked ? this.state.error : null, lastTransaction })
  }
  private startSave(): Promise<void> {
    if (this.copying) return Promise.resolve()
    if (this.saving) return this.saving
    let resolve!: () => void, reject!: (reason: unknown) => void
    const saving = new Promise<void>((done, fail) => { resolve = done; reject = fail })
    this.saving = saving
    void (async () => {
      while (this.pending && !this.blocked && !this.copying) {
        const snapshot = this.pending
        this.pending = null
        try {
          this.publish({ status: 'saving' })
          const historyParent = this.historyParents.get(snapshot)
          const guard = this.pendingSaveGuard(snapshot)
          const save = this.repository.saveSnapshot ?? this.repository.save
          await save.call(this.repository, toBundle(snapshot), this.persistedRevision, { guard,
            historyParentId: historyParent?.id, historyParentHash: historyParent?.hash })
          // Edits made during IO share this exact guard. Once its protected
          // transition is durable, descendants must use the new saved baseline.
          if (guard) this.completedSaveGuards.add(guard)
          this.saveGuards.delete(snapshot)
          this.historyParents.delete(snapshot)
          this.persistedRevision = snapshot.document.revision
          this.publish({ status: this.pending ? 'unsaved' : 'saved', error: null })
        } catch (error) {
          // The failed call has settled. Keep its evidence only when that exact
          // snapshot will be retried; a later edit already owns its own proof.
          if (this.pending) this.releaseSupersededSaveEvidence(snapshot, this.pending)
          this.pending = this.pending ?? snapshot; this.blocked = error
          this.publish({ status: error instanceof Error && error.name === 'ProjectConflictError' ? 'conflict' : 'error', error: saveMessage(error) })
          throw error
        }
      }
    })().then(() => { this.saving = null; resolve() }, error => { this.saving = null; reject(error) })
    return saving
  }
  async flush() {
    if (this.copying) throw new Error('正在保存独立副本，请稍后重试。')
    if (this.timer) { clearTimeout(this.timer); this.timer = null }
    if (this.saving) await this.saving
    if (this.blocked) throw this.blocked
    if (this.pending) await this.startSave()
    if (this.blocked) throw this.blocked
  }
  /** A true departure releases the editing branch only after its complete save succeeds. */
  async close() {
    this.assertWritable()
    const checkpoint = this.checkpoint()
    await this.flush()
    this.assertWritable()
    this.assertCheckpoint(checkpoint)
    this.releaseBaseMapSources()
    // Closing an empty workspace also invalidates independent work that began there.
    this.version++
    const current = this.state.project
    if (!current) return
    // Reset the existing witness owner so even previously issued proofs expire.
    this.structureContinuity.reset(current.document)
    this.visualContinuity.reset(current.document)
    this.past = []; this.future = []; this.pending = null; this.blocked = null
    this.persistedRevision = null
    this.publish({ project: null, status: 'empty', error: null, lastTransaction: null })
  }
  async retry() { this.blocked = null; await this.flush() }
  async saveAsCopy() {
    this.assertWritable()
    const checkpoint = this.checkpoint(), draft = forkProject(this.requireProject(), this.options.runtime)
    if (this.copying) throw new Error('正在保存独立副本，请稍后重试。')
    if (this.timer) { clearTimeout(this.timer); this.timer = null }
    this.copying = true
    try {
      if (this.saving) await this.saving.catch(() => {})
      this.assertCheckpoint(checkpoint)
      const project = await validateEditableProject(draft, this.validation())
      await this.repository.save(toBundle(project), null)
      this.assertCheckpoint(checkpoint)
      this.install(project)
    } finally {
      this.copying = false
      if (this.pending && !this.blocked) this.timer = setTimeout(() => { this.timer = null; void this.startSave().catch(() => {}) }, 120)
    }
  }
  /** Target-specific publication strategies share one private domain witness.
   * New projects still save/cold-read before install; local edits retain their
   * own protection, CAS and single-undo transaction. */
  previewGeneration<K extends DomainGenerationKind>(request: NewGenerationRequest<K>, options?: GenerationPreviewOptions): Promise<DomainPreviewMap[K]>
  previewGeneration(request: CurrentGenerationRequest, options?: ResourceOptions): Promise<LocalGenerationPreview>
  previewGeneration(request: NewGenerationRequest | CurrentGenerationRequest, options: GenerationPreviewOptions = {}): Promise<DomainPreviewMap[DomainGenerationKind] | LocalGenerationPreview> {
    if (request.kind === 'current-project') return this.previewLocalGeneration(request.input, { budget: request.profile, signal: options.signal })
    return this.previewDomainGeneration(request.domain, request.base, request.input, request.profile, options)
  }
  cancelGeneration(selection: GenerationSelection) {
    if (selection.kind === 'current-project') return this.cancelLocalGeneration(selection.preview)
    this.cancelDomainGeneration(selection.domain, selection.preview)
  }
  adoptGeneration(selection: { kind: 'current-project'; preview: LocalGenerationPreview }, options?: ResourceOptions): ReturnType<Workspace['adoptLocalGeneration']>
  adoptGeneration(selection: Exclude<GenerationSelection, { kind: 'current-project' }>, options?: ResourceOptions): Promise<void>
  adoptGeneration(selection: GenerationSelection, options: ResourceOptions = {}) {
    if (selection.kind === 'current-project') return this.adoptLocalGeneration(selection.preview, options)
    return this.adoptDomainGeneration(selection.domain, selection.preview, options)
  }
  private async previewDomainGeneration<K extends DomainGenerationKind>(domain: K, base: EditableProject, input: unknown, profile: TaskBudgetProfile, options: GenerationPreviewOptions = {}): Promise<DomainPreviewMap[K]> {
    this.assertWritable()
    const checkpoint = this.checkpoint(), signal = this.atomicSignal(options.signal)
    const ownedInput = captureJson(input), capturedProfile = parseTaskBudgetProfile(profile)
    const owned = await consumeEditableSnapshot(base, { ...this.validation(), signal })
    checkCancelled(signal); this.assertWritable(); this.assertCheckpoint(checkpoint)
    const preparedAt = this.options.runtime.clock.now(), identityAllocation: string[] = []
    const runtime = { clock: { now: () => preparedAt }, ids: { nextId: () => { const id = this.options.runtime.ids.nextId(); identityAllocation.push(id); return id } } }
    const prepared = await prepareDomainProject(domain, owned, ownedInput, { runtime, validation: this.validation(), signal, profile: capturedProfile, execute: options.execute,
      context: { workspaceId: this.state.project?.document.sceneId ?? 'empty-workspace', checkpoint, epoch: options.epoch ?? 0 } })
    checkCancelled(signal); this.assertWritable(); this.assertCheckpoint(checkpoint)
    const current = this.state.project
    if (prepared.project.document.sceneId === current?.document.sceneId) throw new Error('生成布局必须具有独立的新工程身份。')
    this.validateCandidate(prepared.project.document); assertAllFloorPlayerProjections(prepared.project.document)
    const preview = freeze({ ...prepared, checkpoint, currentSceneId: current?.document.sceneId ?? null, currentRevision: current?.document.revision ?? null,
      baseContentHash: current ? projectContentHash(toBundle(current).project) : null }) as DomainPreviewMap[K]
    this.domainPreviews.set(preview, { domain, status: 'active', base: owned, preparedAt, identityAllocation })
    return preview
  }
  private cancelDomainGeneration(domain: DomainGenerationKind, preview: DomainPreviewMap[DomainGenerationKind]) {
    const witness = this.domainPreviews.get(preview)
    if (witness?.domain === domain && (witness.status === 'active' || witness.status === 'applying')) witness.status = 'cancelled'
  }
  private async adoptDomainGeneration(domain: DomainGenerationKind, preview: DomainPreviewMap[DomainGenerationKind], options: ResourceOptions = {}) {
    this.assertWritable()
    const witness = this.domainPreviews.get(preview)
    if (!witness || witness.domain !== domain || witness.status !== 'active') throw new Error('生成候选已取消、已采用或不属于本会话领域。')
    const token = {}, outerSignal = this.atomicSignal(options.signal)
    const signal = { get aborted() { return outerSignal.aborted || witness.status === 'cancelled' } }
    const assertActive = () => {
      checkCancelled(signal); this.assertCheckpoint(preview.checkpoint)
      const current = this.state.project
      if (witness.status !== 'applying' || (current?.document.sceneId ?? null) !== preview.currentSceneId || (current?.document.revision ?? null) !== preview.currentRevision
        || (current ? projectContentHash(toBundle(current).project) : null) !== preview.baseContentHash) throw new Error('生成候选基线已变化，请重新预览。')
    }
    witness.status = 'applying'; this.atomicLock = token
    try {
      assertActive()
      let allocationIndex = 0
      const runtime = { clock: { now: () => witness.preparedAt }, ids: { nextId: () => {
        const id = witness.identityAllocation[allocationIndex++]
        if (!id) throw new Error('生成候选身份分配与确定性重放不同。')
        return id
      } } }
      const replay = await prepareDomainProject(domain, witness.base, preview.input, { runtime, validation: this.validation(), signal, profile: preview.profile })
      assertActive()
      if (allocationIndex !== witness.identityAllocation.length) throw new Error('生成候选身份分配次数与确定性重放不同。')
      const project = await consumeEditableSnapshot(preview.project, { ...this.validation(), signal })
      assertActive()
      const review = (candidate: DomainPreviewMap[DomainGenerationKind] | typeof replay) => ({ resultHash: candidate.resultHash,
        report: candidate.report, cost: candidate.cost, layout: 'layout' in candidate ? candidate.layout : null })
      if (projectContentHash(toBundle(project).project) !== projectContentHash(toBundle(replay.project).project)
        || canonical(review(preview)) !== canonical(review(replay))) throw new Error('生成候选与完整重放不符。')
      this.validateCandidate(project.document); assertAllFloorPlayerProjections(project.document)
      if (project.document.sceneId === this.state.project?.document.sceneId) throw new Error('生成布局身份不能覆盖当前工程。')
      await this.flush(); assertActive()
      await this.repository.save(toBundle(project), null, { signal }); assertActive()
      if (!this.repository.load) throw new Error('当前仓库不支持生成新工程冷读。')
      const cold = await this.repository.load(project.document.sceneId, { signal })
      if (!cold) throw new Error('生成新工程冷读失败，当前工程保持。')
      // load still validates actual database bytes and pixels. Consume that
      // exact proof only under the current workspace capabilities; unfamiliar
      // repository results continue through full validation.
      const installed = fromVerifiedBundle(await validateProjectSnapshot(cold, { ...this.validation(), signal }), { signal }); assertActive()
      if (projectContentHash(toBundle(installed).project) !== projectContentHash(toBundle(project).project)) throw new Error('生成新工程在冷读前已变化，请从工程目录重新打开。')
      this.atomicLock = null; this.install(installed); witness.status = 'applied'
    } catch (error) { witness.status = 'cancelled'; throw error }
    finally { if (this.atomicLock === token) this.atomicLock = null }
  }
  previewInteriorGeneration(base: EditableProject, input: unknown, profile: TaskBudgetProfile, options: GenerationPreviewOptions = {}): Promise<InteriorPreview> {
    return this.previewDomainGeneration('interior', base, input, profile, options)
  }
  cancelInteriorGeneration(preview: InteriorPreview) { this.cancelDomainGeneration('interior', preview) }
  adoptInteriorGeneration(preview: InteriorPreview, options: ResourceOptions = {}) { return this.adoptDomainGeneration('interior', preview, options) }
  previewForestGeneration(base: EditableProject, input: unknown, profile: TaskBudgetProfile, options: GenerationPreviewOptions = {}): Promise<ForestPreview> {
    return this.previewDomainGeneration('forest', base, input, profile, options)
  }
  cancelForestGeneration(preview: ForestPreview) { this.cancelDomainGeneration('forest', preview) }
  adoptForestGeneration(preview: ForestPreview, options: ResourceOptions = {}) { return this.adoptDomainGeneration('forest', preview, options) }
  previewVolcanoGeneration(base: EditableProject, input: unknown, profile: TaskBudgetProfile, options: GenerationPreviewOptions = {}): Promise<VolcanoPreview> {
    return this.previewDomainGeneration('volcano', base, input, profile, options)
  }
  cancelVolcanoGeneration(preview: VolcanoPreview) { this.cancelDomainGeneration('volcano', preview) }
  adoptVolcanoGeneration(preview: VolcanoPreview, options: ResourceOptions = {}) { return this.adoptDomainGeneration('volcano', preview, options) }
  previewMixedGeneration(base: EditableProject, input: unknown, profile: TaskBudgetProfile, options: GenerationPreviewOptions = {}): Promise<MixedPreview> {
    return this.previewDomainGeneration('mixed', base, input, profile, options)
  }
  cancelMixedGeneration(preview: MixedPreview) { this.cancelDomainGeneration('mixed', preview) }
  adoptMixedGeneration(preview: MixedPreview, options: ResourceOptions = {}) { return this.adoptDomainGeneration('mixed', preview, options) }
  /** A generated map is previewed independently; current edits are saved before switching. */
  async previewBaseMapGeneration(base: EditableProject, request: BaseMapRequest | BaseMapRequestV2 | BaseMapRequestV3, response: unknown, options: { signal?: ResourceOptions['signal']; source?: 'worker' | 'server'; generationExecution?: BaseMapPreparationOptions['generationExecution'] } = {}): Promise<TerrainPreview> {
    this.assertWritable()
    const capturedRequest = captureJson(request), capturedResponse = captureJson(response)
    const checkpoint = this.checkpoint(), current = this.state.project
    if (capturedRequest.version !== 1) this.baseMapExecution.initialize(capturedRequest.flowId, options.generationExecution?.activeRuntimeMs ?? 0)
    const work = capturedRequest.version !== 1 ? this.baseMapExecution.begin(capturedRequest.flowId, this.atomicSignal(options.signal)) : null
    const signal = work?.signal ?? this.atomicSignal(options.signal)
    try {
      if (capturedRequest.checkpoint !== checkpoint || capturedRequest.workspaceSceneId !== (current?.document.sceneId ?? 'empty-workspace')) throw new Error('程序底图请求已过期，请基于当前工程重新生成。')
      checkCancelled(signal)
      const prepared = await prepareBaseMapProject(base, capturedRequest, capturedResponse, { runtime: this.options.runtime, validation: { ...this.validation(), signal }, source: options.source,
        generationExecution: options.generationExecution, preservation: { sceneId: current?.document.sceneId ?? null,
          revision: current?.document.revision ?? null, contentHash: current ? authoringProjectHash(pureProject(current)) : null, checkpoint } })
      checkCancelled(signal); this.assertWritable(); this.assertCheckpoint(checkpoint)
      if (prepared.project.document.sceneId === current?.document.sceneId) throw new Error('程序底图必须具有独立的新工程身份。')
      this.validateCandidate(prepared.project.document); assertAllFloorPlayerProjections(prepared.project.document)
      const preview = freeze({ ...prepared, checkpoint, currentSceneId: current?.document.sceneId ?? null, currentRevision: current?.document.revision ?? null }) as TerrainPreview
      this.terrainPreviews.set(preview, 'active')
      if (preview.continuationSource) this.baseMapSources.set(preview.continuationSource.flowId, { preview, project: preview.project })
      return preview
    } finally { work?.finish() }
  }
  async previewTerrainGeneration(base: EditableProject, input: unknown, result?: TerrainGenerationResult): Promise<TerrainPreview> {
    this.assertWritable()
    const checkpoint=this.checkpoint(), current=this.state.project
    const prepared=await prepareTerrainProject(base,input,{runtime:this.options.runtime,validation:this.validation(),result})
    this.assertWritable();this.assertCheckpoint(checkpoint)
    if(prepared.project.document.sceneId===current?.document.sceneId)throw new Error('生成地图必须具有独立的新工程身份。')
    this.validateCandidate(prepared.project.document)
    assertAllFloorPlayerProjections(prepared.project.document)
    const preview=freeze({...prepared,checkpoint,currentSceneId:current?.document.sceneId??null,currentRevision:current?.document.revision??null})
    this.terrainPreviews.set(preview,'active');return preview
  }
  async previewTerrainComposition(base:EditableProject,input:unknown,plan?:import('../../shared/terrain-generation/composition-field.js').TerrainCompositionPlan):Promise<TerrainPreview>{
    this.assertWritable();const checkpoint=this.checkpoint(),current=this.state.project
    const prepared=await prepareTerrainComposition(base,input,{runtime:this.options.runtime,validation:this.validation(),plan})
    this.assertWritable();this.assertCheckpoint(checkpoint)
    if(prepared.project.document.sceneId===current?.document.sceneId)throw new Error('地貌组合必须具有独立身份。')
    this.validateCandidate(prepared.project.document);assertAllFloorPlayerProjections(prepared.project.document)
    const preview=freeze({...prepared,checkpoint,currentSceneId:current?.document.sceneId??null,currentRevision:current?.document.revision??null})
    this.terrainPreviews.set(preview,'active');return preview
  }
  cancelTerrainGeneration(preview:TerrainPreview) {
    if (['active', 'applying'].includes(this.terrainPreviews.get(preview) ?? '')) this.terrainPreviews.set(preview,'cancelled')
    if (preview.continuationSource && this.baseMapSources.get(preview.continuationSource.flowId)?.preview === preview) this.baseMapSources.delete(preview.continuationSource.flowId)
  }
  async adoptTerrainGeneration(preview:TerrainPreview) {
    this.assertWritable()
    if(this.terrainPreviews.get(preview)!=='active')throw new Error('地形候选已取消、已采用或不属于本会话。')
    this.assertCheckpoint(preview.checkpoint)
    const token={};this.atomicLock=token;this.terrainPreviews.set(preview,'applying')
    const assertActive = () => { this.assertCheckpoint(preview.checkpoint); if (this.terrainPreviews.get(preview) !== 'applying') throw new Error('地形候选已取消。') }
    try {
      const project=await validateEditableProject(preview.project,this.validation())
      assertActive()
      this.validateCandidate(project.document)
      if(project.document.sceneId===this.state.project?.document.sceneId)throw new Error('生成地图身份不能覆盖当前工程。')
      await this.flush();assertActive()
      await this.repository.save(toBundle(project),null);assertActive()
      if (!this.repository.load) throw new Error('当前工程仓库不支持新地形工程冷读。')
      const cold=await this.repository.load(project.document.sceneId)
      if (!cold) throw new Error('新地形工程冷读失败，当前工程保持。')
      const installed=await fromBundle(cold,this.validation())
      assertActive()
      if (projectContentHash(toBundle(installed).project) !== projectContentHash(toBundle(project).project)) throw new Error('新地形工程在冷读前已改变，请从工程目录重新打开。')
      this.atomicLock=null
      this.install(installed);this.terrainPreviews.set(preview,'applied')
    } catch(error) {this.cancelTerrainGeneration(preview);throw error}
    finally {if(this.atomicLock===token)this.atomicLock=null}
  }
  /** A local edit stays in this family and shares protection, CAS and history with other editors. */
  async previewTerrainEdit(input: unknown, options: { result?: TerrainEditResult | ProfiledTerrainEditResult; budget?: TaskBudgetProfile; signal?: ResourceOptions['signal'] } = {}): Promise<TerrainEditPreview> {
    this.assertWritable()
    const current = this.requireProject(), checkpoint = this.checkpoint(), signal = this.atomicSignal(options.signal)
    const baseContentHash = projectContentHash(toBundle(current).project)
    const prepared = await prepareTerrainEditProject(current, input, { runtime: this.options.runtime, validation: this.validation(), result: options.result, budget: options.budget, signal })
    checkCancelled(signal); this.assertWritable(); this.assertCheckpoint(checkpoint)
    this.validateCandidate(prepared.document); assertAllFloorPlayerProjections(prepared.document)
    const preview = freeze({ ...prepared, checkpoint, currentSceneId: current.document.sceneId, currentRevision: current.document.revision, baseContentHash })
    this.terrainEditPreviews.set(preview, 'active')
    return preview
  }
  cancelTerrainEdit(preview: TerrainEditPreview) {
    const status = this.terrainEditPreviews.get(preview)
    if (status === 'active' || status === 'applying') this.terrainEditPreviews.set(preview, 'cancelled')
  }
  private assertTerrainEdit(preview: TerrainEditPreview) {
    if (!['active', 'applying'].includes(this.terrainEditPreviews.get(preview) ?? '')) throw new Error('局部地形候选已取消、已采用或不属于本会话。')
    this.assertCheckpoint(preview.checkpoint)
    const current = this.requireProject()
    if (current.document.sceneId !== preview.currentSceneId || current.document.revision !== preview.currentRevision
      || projectContentHash(toBundle(current).project) !== preview.baseContentHash) throw new Error('地形编辑的基线、锁或资源已改变，请重新预览。')
  }
  async adoptTerrainEdit(preview: TerrainEditPreview, options: ResourceOptions = {}) {
    this.assertWritable()
    if (this.terrainEditPreviews.get(preview) !== 'active') throw new Error('局部地形候选已取消、已采用或不属于本会话。')
    this.assertTerrainEdit(preview)
    const token = {}, signal = this.atomicSignal(options.signal)
    this.atomicLock = token; this.terrainEditPreviews.set(preview, 'applying')
    let committed = false
    const assertActive = () => { checkCancelled(signal); this.assertTerrainEdit(preview) }
    try {
      // Replay against today's exact base; do not trust even a frozen worker or UI wrapper.
      const replayed = await prepareTerrainEditProject(this.requireProject(), preview.input, { runtime: this.options.runtime, validation: this.validation(), result: preview.result, budget: preview.budgetProfile, signal })
      assertActive()
      if (preview.profileHash !== replayed.profileHash || canonical(preview.usage ?? null) !== canonical(replayed.usage ?? null)) throw new Error('地形候选的预算档位或计量已变化，请重新预览。')
      const project = await validateEditableProject(preview.project, { ...this.validation(), signal })
      assertActive()
      if (canonical(project.document) !== canonical(replayed.document) || canonical(project.appearance) !== canonical(replayed.project.appearance)) throw new Error('局部地形重放与已审阅完整候选不同，请重新预览。')
      if (equalOwnedContent(this.requireProject(), project)) throw new Error('本次地形候选没有实际变化，无需采用。')
      this.validateCandidate(project.document); assertAllFloorPlayerProjections(project.document)
      reviseSceneSnapshot(project.document, preview.currentRevision + 1, this.options.runtime.clock.now())
      await this.flush(); assertActive()
      const current = this.requireProject(), usage = await this.repository.usage(preview.currentSceneId)
      assertActive()
      const protection = await this.createSnapshot(current, '地形编辑前保护', { kind: 'protection', expectedRevision: preview.currentRevision, expectedMetadataVersion: usage.metadataVersion, signal })
      assertActive()
      this.structureContinuity.recordSnapshot(protection.id, protection.contentHash, current.document)
      this.visualContinuity.recordSnapshot(protection.id, protection.contentHash, current.document)
      const guard = { expectedMetadataVersion: usage.metadataVersion + 1, protection: { id: protection.id, contentHash: protection.contentHash } }
      await this.repository.checkProtection(preview.currentSceneId, preview.currentRevision, protection.contentHash, guard, { signal })
      assertActive()
      if (this.persistedRevision !== preview.currentRevision) throw new Error('持久修订已变化，未采用局部地形编辑。')
      this.commit(project, 'edit', token, guard)
      committed = true; this.terrainEditPreviews.set(preview, 'applied')
      const save = this.flush().finally(() => { if (this.atomicLock === token) this.atomicLock = null })
      void save.catch(() => {})
      return { protection, revision: this.requireProject().document.revision, save }
    } catch (error) {
      if (!committed) this.terrainEditPreviews.set(preview, 'cancelled')
      throw error
    } finally { if (!committed && this.atomicLock === token) this.atomicLock = null }
  }
  /** v4 local transition/scenery candidate with the same protection/CAS path as terrain edits. */
  async previewTerrainLocalRefresh(input: import('../../shared/terrain-generation/local.js').TerrainLocalRefreshRequest, options: { result?: import('../../shared/terrain-generation/local.js').TerrainLocalRefreshResult; budget?: TaskBudgetProfile; signal?: ResourceOptions['signal'] } = {}): Promise<TerrainLocalPreview> {
    this.assertWritable()
    const current = this.requireProject(), checkpoint = this.checkpoint(), signal = this.atomicSignal(options.signal)
    if (current.document.mapMode !== 'scene') throw new Error('局部联动预览需要场景工程。')
    const prepared = await prepareTerrainLocalRefreshProject(current, input, { runtime: this.options.runtime, validation: this.validation(), result: options.result, budget: options.budget, signal })
    this.assertCheckpoint(checkpoint); checkCancelled(signal)
    this.validateCandidate(prepared.project.document); assertAllFloorPlayerProjections(prepared.project.document)
    const preview = freeze({ ...prepared, checkpoint, currentSceneId: current.document.sceneId, currentRevision: current.document.revision, baseContentHash: projectContentHash(toBundle(current).project) })
    this.terrainLocalPreviews.set(preview, 'active')
    return preview
  }
  cancelTerrainLocalRefresh(preview: TerrainLocalPreview) {
    const status = this.terrainLocalPreviews.get(preview)
    if (status === 'active' || status === 'applying') this.terrainLocalPreviews.set(preview, 'cancelled')
  }
  private assertTerrainLocal(preview: TerrainLocalPreview) {
    if (!['active', 'applying'].includes(this.terrainLocalPreviews.get(preview) ?? '')) throw new Error('局部联动候选已取消、已采用或不属于本会话。')
    this.assertCheckpoint(preview.checkpoint)
    const current = this.requireProject()
    if (current.document.sceneId !== preview.currentSceneId || current.document.revision !== preview.currentRevision
      || projectContentHash(toBundle(current).project) !== preview.baseContentHash) throw new Error('局部联动基线、锁或资源已改变，请重新预览。')
  }
  async adoptTerrainLocalRefresh(preview: TerrainLocalPreview, options: ResourceOptions = {}) {
    this.assertWritable()
    if (this.terrainLocalPreviews.get(preview) !== 'active') throw new Error('局部联动候选不可重复采用。')
    this.assertTerrainLocal(preview)
    const token = {}, signal = this.atomicSignal(options.signal)
    this.atomicLock = token; this.terrainLocalPreviews.set(preview, 'applying')
    let committed = false
    const assertActive = () => { checkCancelled(signal); this.assertTerrainLocal(preview) }
    try {
      const replayed = await prepareTerrainLocalRefreshProject(this.requireProject(), preview.input, { runtime: this.options.runtime, validation: this.validation(), result: preview.result, budget: preview.budgetProfile, signal })
      assertActive()
      if (preview.profileHash !== replayed.profileHash || canonical(preview.usage ?? null) !== canonical(replayed.usage ?? null)) throw new Error('地形候选的预算档位或计量已变化，请重新预览。')
      const project = await validateEditableProject(preview.project, { ...this.validation(), signal })
      assertActive()
      if (canonical(project.document) !== canonical(replayed.document) || canonical(project.appearance) !== canonical(replayed.project.appearance)
        || canonical(project.historyIdentity) !== canonical(replayed.project.historyIdentity)) throw new Error('局部联动重放与已审阅完整候选不同，请重新预览。')
      if (equalOwnedContent(this.requireProject(), project)) throw new Error('本次局部联动没有实际变化，无需采用。')
      this.validateCandidate(project.document); assertAllFloorPlayerProjections(project.document)
      reviseSceneSnapshot(project.document, preview.currentRevision + 1, this.options.runtime.clock.now())
      await this.flush(); assertActive()
      const current = this.requireProject(), usage = await this.repository.usage(preview.currentSceneId)
      assertActive()
      const protection = await this.createSnapshot(current, '局部地形联动前保护', { kind: 'protection', expectedRevision: preview.currentRevision, expectedMetadataVersion: usage.metadataVersion, signal })
      assertActive()
      this.structureContinuity.recordSnapshot(protection.id, protection.contentHash, current.document)
      this.visualContinuity.recordSnapshot(protection.id, protection.contentHash, current.document)
      const guard = { expectedMetadataVersion: usage.metadataVersion + 1, protection: { id: protection.id, contentHash: protection.contentHash } }
      await this.repository.checkProtection(preview.currentSceneId, preview.currentRevision, protection.contentHash, guard, { signal }); assertActive()
      if (this.persistedRevision !== preview.currentRevision) throw new Error('持久修订已变化，未采用局部地形联动。')
      this.commit(project, 'edit', token, guard)
      committed = true; this.terrainLocalPreviews.set(preview, 'applied')
      const save = this.flush().finally(() => { if (this.atomicLock === token) this.atomicLock = null })
      void save.catch(() => {})
      return { protection, revision: this.requireProject().document.revision, save }
    } catch (error) { if (!committed) this.terrainLocalPreviews.set(preview, 'cancelled'); throw error }
    finally { if (!committed && this.atomicLock === token) this.atomicLock = null }
  }
  async previewLocalGeneration(input: import('../../shared/generation/local.js').LocalGenerationRequest, options: { budget?: TaskBudgetProfile; signal?: ResourceOptions['signal'] } = {}): Promise<LocalGenerationPreview> {
    this.assertWritable()
    const current = this.requireProject(), checkpoint = this.checkpoint(), signal = this.atomicSignal(options.signal)
    const prepared = await prepareLocalGenerationProject(current, input, { runtime: this.options.runtime, validation: this.validation(), budget: options.budget, signal })
    this.assertCheckpoint(checkpoint); checkCancelled(signal)
    this.validateCandidate(prepared.document); assertAllFloorPlayerProjections(prepared.document)
    const preview = freeze({ ...prepared, checkpoint, currentSceneId: current.document.sceneId, currentRevision: current.document.revision,
      baseContentHash: projectContentHash(toBundle(current).project) })
    this.localGenerationPreviews.set(preview, 'active')
    return preview
  }
  cancelLocalGeneration(preview: LocalGenerationPreview) {
    if (['active', 'applying'].includes(this.localGenerationPreviews.get(preview) ?? '')) this.localGenerationPreviews.set(preview, 'cancelled')
  }
  private assertLocalGeneration(preview: LocalGenerationPreview) {
    if (!['active', 'applying'].includes(this.localGenerationPreviews.get(preview) ?? '')) throw new Error('局部生成候选已取消、已采用或不属于本会话。')
    this.assertCheckpoint(preview.checkpoint)
    const current = this.requireProject()
    if (current.document.sceneId !== preview.currentSceneId || current.document.revision !== preview.currentRevision
      || projectContentHash(toBundle(current).project) !== preview.baseContentHash) throw new Error('局部生成基线、锁或资源已改变，请重新预览。')
  }
  async adoptLocalGeneration(preview: LocalGenerationPreview, options: ResourceOptions = {}) {
    this.assertWritable()
    if (this.localGenerationPreviews.get(preview) !== 'active') throw new Error('局部生成候选已取消、已采用或不属于本会话。')
    this.assertLocalGeneration(preview)
    const token = {}, outerSignal = this.atomicSignal(options.signal), statuses = this.localGenerationPreviews
    const signal = { get aborted() { return outerSignal.aborted || statuses.get(preview) !== 'applying' } }
    this.atomicLock = token; statuses.set(preview, 'applying')
    let committed = false
    const assertActive = () => { checkCancelled(signal); this.assertLocalGeneration(preview) }
    try {
      const replayed = await prepareLocalGenerationProject(this.requireProject(), preview.input, { runtime: this.options.runtime, validation: this.validation(), budget: preview.budgetProfile, signal })
      assertActive()
      if (projectContentHash(toBundle(replayed.project).project) !== projectContentHash(toBundle(preview.project).project)
        || canonical({ result: replayed.result, changes: replayed.changes, readIds: replayed.readIds, writeIds: replayed.writeIds, cost: replayed.cost, profileHash: replayed.profileHash, usage: replayed.usage })
          !== canonical({ result: preview.result, changes: preview.changes, readIds: preview.readIds, writeIds: preview.writeIds, cost: preview.cost, profileHash: preview.profileHash, usage: preview.usage })) throw new Error('局部生成的完整候选、依赖或预算与确定性重放不符，请重新预览。')
      const project = await validateEditableProject(preview.project, { ...this.validation(), signal })
      assertActive()
      if (equalOwnedContent(this.requireProject(), project)) throw new Error('本次局部生成没有实际变化，无需采用。')
      this.validateCandidate(project.document); assertAllFloorPlayerProjections(project.document)
      reviseSceneSnapshot(project.document, preview.currentRevision + 1, this.options.runtime.clock.now())
      await this.flush(); assertActive()
      const current = this.requireProject(), usage = await this.repository.usage(preview.currentSceneId)
      assertActive()
      const protection = await this.createSnapshot(current, '局部生成前保护', { kind: 'protection', expectedRevision: preview.currentRevision, expectedMetadataVersion: usage.metadataVersion, signal })
      assertActive()
      this.structureContinuity.recordSnapshot(protection.id, protection.contentHash, current.document)
      this.visualContinuity.recordSnapshot(protection.id, protection.contentHash, current.document)
      const guard = { expectedMetadataVersion: usage.metadataVersion + 1, protection: { id: protection.id, contentHash: protection.contentHash } }
      await this.repository.checkProtection(preview.currentSceneId, preview.currentRevision, protection.contentHash, guard, { signal }); assertActive()
      if (this.persistedRevision !== preview.currentRevision) throw new Error('持久修订已变化，未采用局部生成。')
      this.commit(project, 'edit', token, guard)
      committed = true; statuses.set(preview, 'applied')
      const save = this.flush().finally(() => { if (this.atomicLock === token) this.atomicLock = null })
      void save.catch(() => {})
      return { protection, revision: this.requireProject().document.revision, save }
    } catch (error) { if (!committed) statuses.set(preview, 'cancelled'); throw error }
    finally { if (!committed && this.atomicLock === token) this.atomicLock = null }
  }
  async previewRegionalCreate(base: EditableProject, input: Parameters<typeof prepareRegionalCreate>[1], options: ResourceOptions = {}): Promise<RegionalPreview> {
    this.assertWritable()
    const checkpoint = this.checkpoint(), signal = this.atomicSignal(options.signal)
    const owned = await validateEditableProject(base, { ...this.validation(), signal })
    const prepared = await prepareRegionalCreate(owned, input, { runtime: this.options.runtime, validation: this.validation(), signal })
    return this.registerRegional(prepared, checkpoint, owned)
  }
  async previewRegionalEdit(input: Parameters<typeof prepareRegionalEdit>[1], options: ResourceOptions = {}): Promise<RegionalPreview> {
    this.assertWritable()
    const checkpoint = this.checkpoint(), base = this.requireProject(), signal = this.atomicSignal(options.signal)
    const prepared = await prepareRegionalEdit(base, input, { runtime: this.options.runtime, validation: this.validation(), signal })
    return this.registerRegional(prepared, checkpoint, base)
  }
  async previewRegionalDrillDown(sceneBase: EditableProject, input: Parameters<typeof prepareRegionalDrillDown>[1], options: ResourceOptions = {}): Promise<RegionalPreview> {
    this.assertWritable()
    const checkpoint = this.checkpoint(), base = this.requireProject(), signal = this.atomicSignal(options.signal)
    const owned = await validateEditableProject(sceneBase, { ...this.validation(), signal })
    const prepared = await prepareRegionalDrillDown(base, input, { runtime: this.options.runtime, validation: this.validation(), signal, sceneBase: owned })
    return this.registerRegional(prepared, checkpoint, base, owned)
  }
  async previewRegionalDrillDownFromResult(sceneBase: EditableProject, result: RegionalDrillDownResult, options: ResourceOptions = {}): Promise<RegionalPreview> {
    this.assertWritable()
    const checkpoint = this.checkpoint(), base = this.requireProject(), signal = this.atomicSignal(options.signal)
    const owned = await validateEditableProject(sceneBase, { ...this.validation(), signal })
    const prepared = await prepareRegionalDrillDownFromResult(base, result, owned, { runtime: this.options.runtime, validation: this.validation(), signal })
    return this.registerRegional(prepared, checkpoint, base, owned, undefined, result)
  }
  async previewRegionalAiDrillDown(sourceCandidate: AtomicCandidate, sceneBase: EditableProject, expectedResult: RegionalDrillDownResult, options: ResourceOptions = {}): Promise<RegionalPreview> {
    this.assertWritable()
    const checkpoint = this.checkpoint(), base = this.requireProject(), signal = this.atomicSignal(options.signal)
    const witness = this.atomicCandidates.get(sourceCandidate)
    if (!witness || witness.status !== 'active' || sourceCandidate.checkpoint !== witness.authorization.checkpoint
      || sourceCandidate.contentHash !== witness.draft.state.contentHash || sourceCandidate.draftRevision !== witness.draft.state.draftRevision
      || sourceCandidate.generation !== witness.draft.generation || sourceCandidate.taskId !== witness.draft.taskId) throw new Error('AI区域候选不属于当前本机草稿或已失效。')
    const authorization = witness.authorization, scope = authorization.start.scope.scene
    if (!scope || base.document.sceneId !== authorization.currentSceneId || base.document.revision !== authorization.currentRevision
      || projectContentHash(toBundle(base).project) !== authorization.baseContentHash) throw new Error('区域来源工程已改变，请重新授权并生成候选。')
    this.assertCheckpoint(authorization.checkpoint)
    const source = await validateEditableProject(sourceCandidate.project, { ...this.validation(), signal })
    const allowed = new Set([...scope.entityIds, ...witness.draft.state.changedIds])
    const checkedExpected = RegionSceneCandidateResultSchema.parse(captureJson(expectedResult))
    const result = regionalSceneCandidate(pureProject(source), scope, allowed, checkedExpected.request)
    if (canonical(result) !== canonical(checkedExpected)) throw new Error('区域候选与本机授权范围或确定性重放不一致。')
    const owned = await validateEditableProject(sceneBase, { ...this.validation(), signal })
    const prepared = await prepareRegionalDrillDownFromResult(source, result, owned, { runtime: this.options.runtime, validation: this.validation(), signal })
    this.assertCheckpoint(checkpoint)
    return this.registerRegional(prepared, checkpoint, base, owned, source, result)
  }
  private registerRegional(prepared: RegionalCandidate, checkpoint: number, base: EditableProject, sceneBase?: EditableProject, sourceBase?: EditableProject, sourceResult?: RegionalDrillDownResult): RegionalPreview {
    this.assertWritable(); this.assertCheckpoint(checkpoint)
    const current = this.state.project
    if (prepared.kind !== 'edit' && prepared.document.sceneId === current?.document.sceneId) throw new Error('区域新图必须使用独立身份。')
    this.validateCandidate(prepared.document); assertAllFloorPlayerProjections(prepared.document)
    const preview = freeze({ ...prepared, checkpoint, currentSceneId: current?.document.sceneId ?? null, currentRevision: current?.document.revision ?? null, baseContentHash: current ? projectContentHash(toBundle(current).project) : null })
    this.regionalPreviews.set(preview, { status: 'active', base, sourceBase, sourceResult, sceneBase })
    return preview
  }
  cancelRegional(preview: RegionalPreview) {
    const witness = this.regionalPreviews.get(preview)
    if (witness && (witness.status === 'active' || witness.status === 'applying')) witness.status = 'cancelled'
  }
  async adoptRegional(preview: RegionalPreview, options: ResourceOptions = {}) {
    this.assertWritable()
    const witness = this.regionalPreviews.get(preview)
    if (!witness || witness.status !== 'active') throw new Error('区域候选已取消、已采用或不属于本会话。')
    const token = {}, signal = this.atomicSignal(options.signal)
    let committed = false
    const assertActive = () => {
      checkCancelled(signal); this.assertCheckpoint(preview.checkpoint)
      const current = this.state.project
      if (witness.status !== 'applying' || (current?.document.sceneId ?? null) !== preview.currentSceneId || (current?.document.revision ?? null) !== preview.currentRevision || (current ? projectContentHash(toBundle(current).project) : null) !== preview.baseContentHash) throw new Error('区域候选基线已变化，请重新预览。')
    }
    witness.status = 'applying'; this.atomicLock = token
    try {
      assertActive()
      const context = { runtime: this.options.runtime, validation: this.validation(), signal }
      const replay = preview.kind === 'create' ? await prepareRegionalCreate(witness.base, preview.input as Parameters<typeof prepareRegionalCreate>[1], context)
        : preview.kind === 'edit' ? await prepareRegionalEdit(this.requireProject(), preview.input as Parameters<typeof prepareRegionalEdit>[1], context)
        : witness.sourceResult ? await prepareRegionalDrillDownFromResult(witness.sourceBase ?? witness.base, witness.sourceResult, witness.sceneBase!, context)
          : await prepareRegionalDrillDown(witness.sourceBase ?? witness.base, preview.input as Parameters<typeof prepareRegionalDrillDown>[1], { ...context, sceneBase: witness.sceneBase! })
      assertActive()
      const project = await validateEditableProject(preview.project, { ...this.validation(), signal })
      assertActive()
      if (canonical(project.document) !== canonical(replay.document) || canonical(project.appearance) !== canonical(replay.project.appearance) || preview.resultHash !== replay.resultHash || canonical(preview.cost) !== canonical(replay.cost)) throw new Error('区域候选与完整重放不符。')
      this.validateCandidate(project.document); assertAllFloorPlayerProjections(project.document)
      await this.flush(); assertActive()
      if (preview.kind === 'edit') {
        const current = this.requireProject()
        if (equalOwnedContent(current, project)) throw new Error('区域候选没有实际变化。')
        const usage = await this.repository.usage(current.document.sceneId); assertActive()
        const protection = await this.createSnapshot(current, '区域编辑前保护', { kind: 'protection', expectedRevision: current.document.revision, expectedMetadataVersion: usage.metadataVersion, signal })
        assertActive()
        const guard = { expectedMetadataVersion: usage.metadataVersion + 1, protection: { id: protection.id, contentHash: protection.contentHash } }
        await this.repository.checkProtection(current.document.sceneId, current.document.revision, protection.contentHash, guard, { signal }); assertActive()
        if (this.persistedRevision !== preview.currentRevision) throw new Error('区域持久基线已变化。')
        reviseSceneSnapshot(project.document, current.document.revision + 1, this.options.runtime.clock.now())
        this.commit(project, 'edit', token, guard); committed = true; witness.status = 'applied'
        const save = this.flush().finally(() => { if (this.atomicLock === token) this.atomicLock = null })
        void save.catch(() => {})
        return { protection, revision: project.document.revision, save }
      }
      await this.repository.save(toBundle(project), null); assertActive()
      if (!this.repository.load) throw new Error('当前仓库不支持区域新图冷读。')
      const cold = await this.repository.load(project.document.sceneId)
      if (!cold) throw new Error('区域新图冷读失败。')
      const installed = await fromBundle(cold, { ...this.validation(), signal }); assertActive()
      if (projectContentHash(toBundle(installed).project) !== projectContentHash(toBundle(project).project)) throw new Error('区域新图在安装前已变化。')
      this.atomicLock = null; this.install(installed); witness.status = 'applied'
      return { protection: null, revision: installed.document.revision, save: Promise.resolve() }
    } catch (error) { if (!committed) witness.status = 'cancelled'; throw error }
    finally { if (!committed && this.atomicLock === token) this.atomicLock = null }
  }
  /** Complete public validation returns a new wrapper; retain transaction-only witnesses explicitly. */
  private transferInvalidations(source: EditableProject, target: EditableProject) {
    const structural = this.structuralInvalidations.get(source), visual = this.visualInvalidations.get(source)
    if (structural) this.structuralInvalidations.set(target, [...structural])
    if (visual) this.visualInvalidations.set(target, [...visual])
  }
  private commandInvalidations(current: EditableProject, candidate: EditableProject, commands: readonly CompositionCommand[], traced: readonly string[] = []) {
    const receipt = getCompositionTransactionReceipt(contentOf(candidate), contentOf(current))
    return receipt ? { structure: [...receipt.invalidation.structureIds], visual: [...receipt.invalidation.visualIds] }
      : { structure: [...new Set([...invalidatedStructureIds(current.document, commands), ...traced])], visual: invalidatedVisualIds(current.document, commands) }
  }
  private commit(candidate: EditableProject, history: 'edit' | 'undo' | 'redo', token?: object, saveGuard?: ProjectSaveGuard, baseline: EditableProject = candidate,
    historyParent?: { id: string; hash: string }) {
    this.assertWritable(token)
    const current = this.requireProject(), checkpoint = this.checkpoint()
    const historyIdentity = candidate.historyIdentity === current.historyIdentity ? undefined : mergeIdentityRecords(candidate.historyIdentity, [current.historyIdentity])
    const content = reviseCompositionContent({ document: candidate.document, historyIdentity: candidate.historyIdentity, appearance: candidate.appearance },
      current.document.revision + 1, this.options.runtime.clock.now(), historyIdentity)
    this.validateCandidate(content.document)
    const next = tryDeriveEditableProject({ ...candidate, ...content }, baseline, this.validation())
    if (!next) throw new Error('提交工程未能保留确切不可变资源闭包的验证证明，已保留当前内容。')
    if (getProjectLocalTransaction(toBundle(next).project)) {
      retainLocalCommandBudget(content)
      const prop = getPropUpdateCompositionTransaction(contentOf(candidate)), revision = getCompositionRevisionTransaction(content)
      if (prop) releasePropUpdateCompositionTransaction(prop)
      if (revision) releaseCompositionRevisionTransaction(revision)
      releaseProjectLocalTransaction(toBundle(candidate).project)
    }
    this.assertCheckpoint(checkpoint)
    const retainedGuard = saveGuard ?? this.pendingSaveGuard(current)
    if (retainedGuard) this.saveGuards.set(next, retainedGuard)
    const retainedParent = historyParent ?? this.historyParents.get(current)
    if (retainedParent) this.historyParents.set(next, retainedParent)
    const transaction = getCompositionTransactionReceipt(contentOf(candidate), contentOf(current))
    this.structureContinuity.advance(current.document, content.document, transaction?.invalidation.structureIds ?? this.structuralInvalidations.get(candidate))
    this.visualContinuity.advance(current.document, content.document, transaction?.invalidation.visualIds ?? this.visualInvalidations.get(candidate))
    // The committed snapshot has already inherited its own exact endpoint
    // proof. Draft receipts must not retain a second chain of older snapshots.
    releaseProjectTransactionReceipt(toBundle(candidate).project)
    if (transaction) releaseCompositionTransactionReceipt(transaction)
    if (history === 'edit') { this.past.push(current); this.future = [] }
    else if (history === 'undo') { this.past.pop(); this.future.push(current) }
    else { this.future.pop(); this.past.push(current) }
    this.releaseBaseMapSources()
    this.version++
    this.enqueue(next)
  }
  private assertCandidateBaseline(candidate: EditableProject, checkpoint: number) {
    this.assertCheckpoint(checkpoint)
    const current = this.requireProject()
    if (candidate.document.sceneId !== current.document.sceneId || candidate.document.revision !== current.document.revision
      || candidate.historyIdentity.lineageId !== current.historyIdentity.lineageId || candidate.historyIdentity.rootSceneId !== current.historyIdentity.rootSceneId) {
      throw new Error('候选不属于当前工程和修订，已保留当前内容。')
    }
    if (candidate.historyIdentity === current.historyIdentity && candidate.authoringSources === current.authoringSources) return
    for (const collection of ['propTokens', 'prefabTokens'] as const) for (const [id, token] of Object.entries(current.historyIdentity[collection])) {
      if (candidate.historyIdentity[collection][id] !== token) throw new Error(`候选不能丢弃或改写已分配身份：${id}。`)
    }
    for (const [id, token] of Object.entries(current.historyIdentity.aggregateTokens ?? {})) {
      if (candidate.historyIdentity.aggregateTokens?.[id] !== token) throw new Error(`候选不能丢弃或改写聚合组出生身份：${id}。`)
    }
    for (const [id, record] of Object.entries(current.historyIdentity.outdoorTokens)) {
      const after = candidate.historyIdentity.outdoorTokens[id]
      if (!after || after.kind !== record.kind || after.token !== record.token) throw new Error(`候选不能丢弃或改写室外出生身份：${id}。`)
    }
    for (const [id, record] of Object.entries(current.historyIdentity.structureTokens ?? {})) {
      const after = candidate.historyIdentity.structureTokens?.[id]
      if (!after || after.kind !== record.kind || after.token !== record.token) throw new Error(`候选不能丢弃或改写结构出生身份：${id}。`)
    }
    if (Object.entries(current.authoringSources).some(([id, value]) => canonical(value) !== canonical(candidate.authoringSources[id]))) throw new Error('候选不能替换工程创作源。')
  }
  private assertCatalogImport(candidate: EditableProject, checkpoint: number) {
    this.assertCandidateBaseline(candidate, checkpoint)
    const current = this.requireProject()
    if (canonical(withoutKeys(candidate.document, catalogCollections)) !== canonical(withoutKeys(current.document, catalogCollections))) {
      throw new Error('素材入库只能新增固定素材，不能修改场景对象、图层、私密性、约束或工程设置。')
    }
    if (canonical(candidate.historyIdentity) !== canonical(current.historyIdentity)) throw new Error('素材入库不能修改场景身份。')
    if (canonical(withoutKeys(candidate.appearance, fixedAppearanceCollections)) !== canonical(withoutKeys(current.appearance, fixedAppearanceCollections))) {
      throw new Error('素材入库不能修改当前外观源映射或实例、图层调整。')
    }
    for (const collection of catalogCollections) assertAppendOnly('固定素材', current.document[collection], candidate.document[collection])
    for (const collection of fixedAppearanceCollections) assertAppendOnly('固定外观记录', current.appearance[collection] ?? {}, candidate.appearance[collection] ?? {})
    assertAppendOnly('资源记录', current.assets, candidate.assets)
    assertAppendOnly('许可文本', current.licenses, candidate.licenses)
    assertAppendOnly('许可绑定', Object.fromEntries(current.licenseBindings.map(binding => [bindingKey(binding), binding])),
      Object.fromEntries(candidate.licenseBindings.map(binding => [bindingKey(binding), binding])))
  }
  /** Public prepared candidates can only append a fully validated fixed asset catalog. */
  async previewPrepared(input: EditableProject, description = '素材入库', checkpoint = this.checkpoint()): Promise<CompositionPreview> {
    const candidate = captureEditableDraft(input)
    this.assertCatalogImport(candidate, checkpoint)
    const cost = catalogAdditionCost(this.requireProject(), candidate)
    if (cost > CATALOG_ADOPTION_LIMIT) throw new Error(`素材入库实际新增记录${cost}，超过${CATALOG_ADOPTION_LIMIT}；整批未采用，请重新选择明确范围。`)
    return this.registerPrepared(candidate, description, checkpoint)
  }
  /** Append fixed sources and execute the finite dressing recipe in one ordinary preview/undo unit. */
  async previewTerrainDressing(catalogInput: EditableProject, input: unknown, options: { checkpoint?: number; signal?: ResourceOptions['signal'] } = {}): Promise<TerrainDressingPreview> {
    this.assertWritable()
    const current = this.requireProject(), checkpoint = options.checkpoint ?? this.checkpoint(), signal = this.atomicSignal(options.signal)
    this.assertCheckpoint(checkpoint); checkCancelled(signal)
    const capturedInput = captureJson(input), capturedCatalog = captureEditableDraft(catalogInput)
    const catalog = await validateEditableProject(capturedCatalog, { ...this.validation(), signal })
    checkCancelled(signal); this.assertCatalogImport(catalog, checkpoint)
    const sourceCost = catalogAdditionCost(current, catalog)
    if (sourceCost > 256) throw new Error('地形布景固定源新增记录超过256条操作预算。')
    const planned = planTerrainDressing({ document: catalog.document, appearance: catalog.appearance }, capturedInput)
    const commands = captureCommands(planned.commands), budget = selectManualCommandBudget(catalog.document, commands)
    checkCancelled(signal); this.assertCheckpoint(checkpoint)
    let total = sourceCost, preparedUsage: CommandBudgetUsage | undefined, executionReceipt: TransactionReceipt | undefined
    const candidate = await prepareCompositionCommands(catalog, commands, { ...this.manualPreparation(undefined, budget), signal,
      onOperationCost: cost => { total = cost }, onBudgetUsage: usage => { preparedUsage = usage }, onTransactionReceipt: receipt => { executionReceipt = receipt } })
    checkCancelled(signal); this.assertCheckpoint(checkpoint)
    const preview = await this.registerPrepared(candidate, '地形层次与布景', checkpoint, commands, budget, undefined, preparedUsage, executionReceipt)
    if (signal.aborted) { this.cancelPreview(preview); checkCancelled(signal) }
    return freeze({ preview, report: captureJson(planned.report), cost: { total, limit: budget.semanticTargets } })
  }
  /** Fixed source closure and every actual cluster/member edit share one bounded candidate. */
  async previewDecorationCommands(catalogInput: EditableProject, input: readonly CompositionCommand[], options: { checkpoint?: number; signal?: ResourceOptions['signal'] } = {}): Promise<CompositionPreview> {
    const current = this.requireProject()
    if (!input.length || !input.every(isDecorationCommand)) throw new Error('轻量布景候选只接受当前工程的明确布景命令。')
    return this.previewCatalogCommands(catalogInput, input, options)
  }
  /** Fixed sources and mixed physical/decoration edits share one complete candidate and adoption. */
  async previewCatalogCommands(catalogInput: EditableProject, input: readonly CompositionCommand[], options: { checkpoint?: number; signal?: ResourceOptions['signal'] } = {}): Promise<CompositionPreview> {
    this.assertWritable()
    const current = this.requireProject(), checkpoint = options.checkpoint ?? this.checkpoint(), signal = this.atomicSignal(options.signal)
    this.assertCheckpoint(checkpoint); checkCancelled(signal)
    const commands = captureCommands(input), capturedCatalog = captureEditableDraft(catalogInput)
    if (!commands.length) throw new Error('固定素材候选只接受当前工程的明确工程命令。')
    const catalog = await validateEditableProject(capturedCatalog, { ...this.validation(), signal })
    checkCancelled(signal); this.assertCatalogImport(catalog, checkpoint)
    const sourceCost = catalogAdditionCost(current, catalog)
    if (sourceCost > CATALOG_ADOPTION_LIMIT) throw new Error('轻量布景固定源新增记录超过256条操作预算。')
    let total = sourceCost, preparedUsage: CommandBudgetUsage | undefined, executionReceipt: TransactionReceipt | undefined
    const budget = selectManualCommandBudget(catalog.document, commands)
    const candidate = await prepareCompositionCommands(catalog, commands, { ...this.manualPreparation(undefined, budget), signal, onOperationCost: cost => { total = cost }, onBudgetUsage: usage => { preparedUsage = usage }, onTransactionReceipt: receipt => { executionReceipt = receipt } })
    checkCancelled(signal); this.assertCheckpoint(checkpoint)
    const preview = await this.registerPrepared(candidate, `固定素材与场景编辑 · ${total}/${budget.semanticTargets} 个编辑对象`, checkpoint, commands, budget, undefined, preparedUsage, executionReceipt)
    if (signal.aborted) { this.cancelPreview(preview); checkCancelled(signal) }
    return preview
  }
  /** Only the command preparation path may register candidates that change scene semantics. */
  private async registerPrepared(input: EditableProject, description: string, checkpoint: number, commands: readonly CompositionCommand[] = [], budget?: ManualTransactionBudget, aggregateBoundaryImpact?: AggregateEditBoundaryImpact, preparedUsage?: CommandBudgetUsage, executionReceipt?: TransactionReceipt): Promise<CompositionPreview> {
    this.assertCandidateBaseline(input, checkpoint)
    const candidate = getVerifiedEditableProject(input) ?? await validateEditableProject(input, this.validation())
    this.assertCandidateBaseline(candidate, checkpoint)
    this.validateCandidate(candidate.document)
    assertAllFloorPlayerProjections(candidate.document)
    this.assertCheckpoint(checkpoint)
    const current = this.requireProject()
    const measured = budget ? measureCommandBudget(current.document, candidate.document, { before: current, after: candidate }, undefined, budget) : undefined
    const budgetUsage = budget && measured ? assertCommandBudget(budget,
      preparedUsage ? combineManualPreparationUsage(measured, preparedUsage, emptyBudgetUsage()) : measured) : undefined
    const project = freeze(candidate)
    const exact = (left: CompositionContent, right: CompositionContent) => left.document === right.document && left.historyIdentity === right.historyIdentity && left.appearance === right.appearance
    const transaction = executionReceipt && isIssuedCompositionTransactionReceipt(executionReceipt)
      && exact(executionReceipt.baseline, current) && exact(executionReceipt.result, project)
      ? executionReceipt : getCompositionTransactionReceipt(contentOf(project), contentOf(current))
    const invalidation = this.commandInvalidations(current, project, commands)
    this.structuralInvalidations.set(project, invalidation.structure)
    this.visualInvalidations.set(project, invalidation.visual)
    const preview = freeze({ project, document: project.document, commands, description, checkpoint,
      currentSceneId: project.document.sceneId, currentRevision: project.document.revision, ...(transaction ? { transaction } : {}), ...(budgetUsage ? { budgetUsage, budgetProfile: budget } : {}), ...(aggregateBoundaryImpact ? { aggregateBoundaryImpact } : {}) })
    this.compositionPreviews.set(preview, 'active')
    return preview
  }
  /** A finite fill owns one source, one complete candidate and one undo unit. */
  async previewFillCopy(input: FillCopyRequest, options: { checkpoint?: number; signal?: ResourceOptions['signal'] } = {}): Promise<FillCopyPreview> {
    this.assertWritable()
    const current = this.requireProject(), checkpoint = options.checkpoint ?? this.checkpoint(), signal = this.atomicSignal(options.signal)
    this.assertCheckpoint(checkpoint); checkCancelled(signal)
    const prefab = current.document.prefabInstances[input.sourceId]
    const budget = this.getManualBudget(input.count * (prefab ? 1 + Object.values(prefab.members).filter(member => member.propId).length : 1))
    let preparedUsage: CommandBudgetUsage | undefined, executionReceipt: TransactionReceipt | undefined
    const prepared = await prepareFillCopy(current, captureJson(input), { ...this.manualPreparation(undefined, budget), signal, onBudgetUsage: usage => { preparedUsage = usage }, onTransactionReceipt: receipt => { executionReceipt = receipt } })
    checkCancelled(signal); this.assertCheckpoint(checkpoint)
    const commands = captureCommands(prepared.commands)
    const preview = await this.registerPrepared(prepared.project, '填充复制', checkpoint, commands, budget, undefined, preparedUsage, executionReceipt)
    if (signal.aborted) { this.cancelPreview(preview); checkCancelled(signal) }
    return freeze({ preview, report: captureJson(prepared.report), cost: prepared.cost })
  }
  async preview(commands: readonly CompositionCommand[]): Promise<CompositionPreview> {
    const current = this.requireProject(), checkpoint = this.checkpoint(), frozenCommands = captureCommands(commands)
    const tracedStructureIds = new Set<string>(), budget = selectManualCommandBudget(current.document, frozenCommands)
    let aggregateBoundaryImpact: AggregateEditBoundaryImpact | undefined, preparedUsage: CommandBudgetUsage | undefined, executionReceipt: TransactionReceipt | undefined
    const candidate = await prepareCompositionCommands(current, frozenCommands, { ...this.manualPreparation(undefined, budget),
      onStructureInvalidations: ids => { for (const id of ids) tracedStructureIds.add(id) },
      onAggregateBoundaryImpact: impact => { aggregateBoundaryImpact = impact }, onBudgetUsage: usage => { preparedUsage = usage }, onTransactionReceipt: receipt => { executionReceipt = receipt } })
    this.assertCheckpoint(checkpoint)
    const preview = await this.registerPrepared(candidate, '场景与外观修改', checkpoint, frozenCommands, budget, aggregateBoundaryImpact, preparedUsage, executionReceipt)
    const invalidation = this.commandInvalidations(current, preview.project, frozenCommands, [...tracedStructureIds])
    this.structuralInvalidations.set(preview.project, invalidation.structure)
    this.visualInvalidations.set(preview.project, invalidation.visual)
    return preview
  }
  private releasePreparedReceipt(project: EditableProject, receipt?: TransactionReceipt) {
    if (receipt) {
      // The same immutable project can also own an earlier pending-save
      // receipt. Only this operation's exact handle may be revoked here.
      releaseProjectTransactionReceipt(toBundle(project).project, receipt)
      releaseCompositionTransactionReceipt(receipt)
    }
  }
  cancelPreview(preview: CompositionPreview) {
    if (!this.compositionPreviews.has(preview)) return
    this.compositionPreviews.set(preview, 'cancelled')
    this.releasePreparedReceipt(preview.project, preview.transaction)
  }
  private assertPreview(preview: CompositionPreview) {
    if (!['active', 'applying'].includes(this.compositionPreviews.get(preview) ?? '')) throw new Error('修改预览已取消、已采用或并非当前工作区创建。')
    this.assertCandidateBaseline(preview.project, preview.checkpoint)
  }
  async adoptPreview(preview: CompositionPreview): Promise<void> {
    this.assertWritable()
    if (this.compositionPreviews.get(preview) !== 'active') throw new Error('修改预览不可重复采用。')
    this.assertPreview(preview)
    this.compositionPreviews.set(preview, 'applying')
    try {
      const candidate = getVerifiedEditableProject(preview.project) ?? await validateEditableProject(preview.project, this.validation())
      this.assertPreview(preview)
      this.validateCandidate(candidate.document)
      this.assertPreview(preview)
      const current = this.requireProject()
      if (preview.budgetProfile) {
        const measured = measureCommandBudget(current.document, candidate.document, { before: current, after: candidate }, undefined, preview.budgetProfile)
        assertCommandBudget(preview.budgetProfile, preview.budgetUsage ? combineManualPreparationUsage(measured, preview.budgetUsage, emptyBudgetUsage()) : measured)
      }
      if (!equalOwnedContent(current, candidate)
        || this.structuralInvalidations.get(preview.project)?.length || this.visualInvalidations.get(preview.project)?.length) {
        this.transferInvalidations(preview.project, candidate)
        this.commit(candidate, 'edit')
      } else this.releasePreparedReceipt(preview.project, preview.transaction)
      this.compositionPreviews.set(preview, 'applied')
    } catch (error) { this.cancelPreview(preview); throw error }
  }
  async execute(commands: readonly CompositionCommand[]): Promise<void> {
    this.assertWritable()
    const current = this.requireProject(), checkpoint = this.checkpoint(), frozenCommands = captureCommands(commands)
    // Preparation fully validates both the captured input and the materialized
    // candidate. Only validator-owned immutable byte/original closures are reused.
    // Immediate commands have no user-visible preview lifetime to register/recheck.
    const tracedStructureIds = new Set<string>(), budget = selectManualCommandBudget(current.document, frozenCommands)
    let executionReceipt: TransactionReceipt | undefined
    const candidate = await prepareCompositionCommands(current, frozenCommands, { ...this.manualPreparation(undefined, budget),
      onStructureInvalidations: ids => { for (const id of ids) tracedStructureIds.add(id) }, onTransactionReceipt: receipt => { executionReceipt = receipt } })
    this.assertCandidateBaseline(candidate, checkpoint)
    this.validateCandidate(candidate.document)
    assertAllFloorPlayerProjections(candidate.document)
    this.assertCandidateBaseline(candidate, checkpoint)
    const { structure: structuralInvalidations, visual: visualInvalidations } = this.commandInvalidations(current, candidate, frozenCommands, [...tracedStructureIds])
    if (!equalOwnedContent(current, candidate)
      || structuralInvalidations.length || visualInvalidations.length) {
      this.structuralInvalidations.set(candidate, structuralInvalidations)
      this.visualInvalidations.set(candidate, visualInvalidations)
      this.commit(candidate, 'edit')
    } else this.releasePreparedReceipt(candidate, executionReceipt)
  }
  updateProp(id: string, changes: { positionMm?: { x: number; y: number }; rotationDeg?: number }) { return this.execute([{ type: 'updateProp', id, changes }]) }
  rotateRoomMaterial(id: string, rotationDeg: number) { return this.execute([{ type: 'setSurfacePaint', kind: 'room', id, changes: { rotationDeg } }]) }
  detachPrefabMember(groupId: string, propId: string) { return this.execute([{ type: 'detachPrefabMember', groupId, propId }]) }
  resetPrefabMember(groupId: string, key: string, newId?: string, supportRef?: SurfaceRef) { return this.execute([{ type: 'resetPrefabMember', groupId, key, ...(newId ? { newId } : {}), ...(supportRef ? { supportRef } : {}) }]) }
  removePrefabMember(id: string) { return this.execute([{ type: 'deleteProp', id }]) }
  private prepareRestoredProject(candidate: EditableProject): EditableProject {
    const current = this.requireProject(), checkpoint = this.checkpoint()
    // History entries are validator-owned and deeply frozen. Reconciliation may
    // pause a composition or invalidate its receipt, so own a detached draft
    // before lifecycle code writes the restored branch.
    const draft = captureEditableDraft(candidate)
    // Keep the exact frozen resource/license closure as the derivation
    // baseline; only document, identity and appearance are detached for the
    // lifecycle reconciliation below.
    Object.assign(draft, {
      assets: candidate.assets,
      licenses: candidate.licenses,
      licenseBindings: candidate.licenseBindings,
      authoringSources: candidate.authoringSources,
      resources: candidate.resources,
    })
    // Restoring an older scene can legitimately allocate fresh topology
    // tokens. Keep continuity monotonic by pausing any active composition
    // whose frozen output receipt no longer matches the restored identity.
    pauseChangedCompositions(current.document, draft.document)
    const historyIdentity = advanceHistoryIdentity(current.historyIdentity, current.document, draft.document, this.options.runtime, { allowResurrection: true })
    if (Object.keys(draft.document.pathAttachments ?? {}).length) draft.document = rebindPathAttachmentProofs(draft.document, historyIdentity)
    protectLocalGenerationContinuity(draft.document, candidate.historyIdentity, historyIdentity)
    {
      const receiptIssues = validateCompositionIdentityContracts(draft.document, historyIdentity)
      if (receiptIssues.length) {
        draft.document = captureJson({ ...draft.document, generation: { ...draft.document.generation,
          compositions: Object.fromEntries(Object.entries(draft.document.generation.compositions).map(([id, row]) => [id,
            receiptIssues.some(issue => issue.entityId === id) ? { ...row, state: 'paused' as const } : row])) } })
      }
    }
    this.validateCandidate(draft.document)
    this.assertCheckpoint(checkpoint)
    // Keep candidate as the derivation baseline so its exact immutable resource
    // certificate remains authoritative while the draft carries reconciliation.
    return { ...draft, historyIdentity }
  }
  private restoreHistory(candidate: EditableProject, history: 'undo' | 'redo') {
    const restored = this.prepareRestoredProject(candidate)
    this.commit(restored, history, undefined, undefined, candidate)
  }
  undo() { this.assertWritable(); const previous = this.past.at(-1); if (previous) this.restoreHistory(previous, 'undo') }
  redo() { this.assertWritable(); const next = this.future.at(-1); if (next) this.restoreHistory(next, 'redo') }

  /** Complete history navigation keeps the old branch and adopts one new monotonic revision. */
  async navigateHistoryVersion(versionId: string): Promise<SnapshotSummary> {
    this.assertWritable()
    checkCancelled(this.validation().signal)
    if (typeof versionId !== 'string' || !versionId || !this.repository.listHistoryVersions || !this.repository.loadHistoryVersion) {
      throw new Error('所选完整历史版本不可用。')
    }
    await this.flush()
    checkCancelled(this.validation().signal)
    this.assertWritable()
    const checkpoint = this.checkpoint(), token = Object.freeze({}), current = this.requireProject()
    const owner = current.document.sceneId, revision = current.document.revision
    if (this.persistedRevision !== revision) throw new Error('当前工程尚未完整保存，不能导航版本历史。')
    const currentHash = projectContentHash(toBundle(current).project)
    this.atomicLock = token
    try {
      const list = await this.repository.listHistoryVersions(owner)
      this.assertCheckpoint(checkpoint); checkCancelled(this.validation().signal)
      const selected = list.versions.find(version => version.id === versionId && version.automatic && version.ownerSceneId === owner)
      if (!selected) throw new Error('所选版本不属于当前工程，或不是可导航的保存版本。')
      if (selected.contentHash === currentHash) throw new Error('当前工程已与所选完整版本一致。')
      const loadSource = async () => {
        const bundle = await this.repository.loadHistoryVersion!(owner, versionId, { signal: this.validation().signal })
        if (!bundle) throw new Error('完整历史版本已不可用。')
        const source = getVerifiedProjectBundle(bundle) ? fromVerifiedBundle(bundle, this.validation()) : await fromBundle(bundle, this.validation())
        if (source.document.sceneId !== owner || source.document.schemaVersion !== current.document.schemaVersion
          || source.historyIdentity.lineageId !== current.historyIdentity.lineageId || source.historyIdentity.rootSceneId !== current.historyIdentity.rootSceneId
          || source.document.revision !== selected.revision
          || projectContentHash(toBundle(source).project) !== selected.contentHash) {
          throw new Error('完整历史版本与当前工程的身份、格式或内容不一致。')
        }
        return source
      }
      const source = await loadSource()
      this.assertWritable(token); this.assertCheckpoint(checkpoint); checkCancelled(this.validation().signal)
      const candidate = getVerifiedEditableProject(source) ? source : await validateEditableProject(source, this.validation())
      const reconciled = this.prepareRestoredProject(candidate)
      this.validateCandidate(reconciled.document); assertAllFloorPlayerProjections(reconciled.document)
      reviseSceneSnapshot(reconciled.document, revision + 1, this.options.runtime.clock.now())
      const metadataVersion = this.repository.historyMetadataVersion
        ? await this.repository.historyMetadataVersion(owner, { signal: this.validation().signal })
        : (await this.repository.usage(owner)).metadataVersion
      this.assertWritable(token); this.assertCheckpoint(checkpoint); checkCancelled(this.validation().signal)
      const protection = await this.createSnapshot(current, '完整版本恢复前保护', {
        kind: 'protection', expectedRevision: revision, expectedMetadataVersion: metadataVersion, signal: this.validation().signal,
      })
      this.assertWritable(token); this.assertCheckpoint(checkpoint); checkCancelled(this.validation().signal)
      await loadSource()
      this.assertWritable(token); this.assertCheckpoint(checkpoint); checkCancelled(this.validation().signal)
      const guard: ProjectSaveGuard = { expectedMetadataVersion: metadataVersion + 1,
        protection: { id: protection.id, contentHash: protection.contentHash } }
      await this.repository.checkProtection(owner, revision, currentHash, guard, { signal: this.validation().signal })
      this.assertWritable(token); this.assertCheckpoint(checkpoint); checkCancelled(this.validation().signal)
      this.structureContinuity.recordSnapshot(protection.id, protection.contentHash, current.document)
      this.visualContinuity.recordSnapshot(protection.id, protection.contentHash, current.document)
      this.commit(reconciled, 'edit', token, guard, candidate, { id: versionId, hash: selected.contentHash })
      await this.flush()
      return protection
    } finally {
      if (this.atomicLock === token) this.atomicLock = null
    }
  }

  async loadNamedSnapshot(snapshotId: string, ownerSceneId = this.requireProject().document.sceneId, readSession?: SnapshotReadSession): Promise<EditableSnapshot | null> {
    const snapshot = readSession ? await readSession.load(ownerSceneId, snapshotId, this.validation()) : await this.repository.loadSnapshot(ownerSceneId, snapshotId)
    if (!snapshot) return null
    const { bundle, ...summary } = snapshot
    return { ...summary, project: getVerifiedProjectBundle(bundle) ? fromVerifiedBundle(bundle, this.validation()) : await fromBundle(bundle, this.validation()) }
  }
  private async createSnapshot(project: EditableProject, name: string, options: CreateSnapshotOptions): Promise<EditableSnapshot> {
    const snapshot = await this.repository.createSnapshot(toBundle(project), name, options)
    const { bundle, ...summary } = snapshot
    return { ...summary, project: getVerifiedProjectBundle(bundle) ? fromVerifiedBundle(bundle, this.validation()) : await fromBundle(bundle, this.validation()) }
  }

  /** Explicitly freezes one local authority; JSON returned by a task can never create it. */
  async authorizeAtomic(scope: AuthoringScope, brief?: import('../../shared/ai/plan.js').AuthoringBrief): Promise<AtomicAuthorization & { start: import('../../shared/ai/authoring-protocol-v1.js').AuthoringStart }> {
    this.assertWritable()
    const checkpoint = this.checkpoint(), current = this.requireProject()
    const capturedScope = AuthoringScopeSchema.parse(captureJson(scope))
    const verified = await validateEditableProject(current, this.validation())
    this.assertCheckpoint(checkpoint)
    const project = pureProject(verified), baseContentHash = authoringProjectHash(project)
    const start = captureAtomicStart({ schemaVersion: 1, project, baseContentHash, scope: capturedScope, seed: crypto.randomUUID(),
      preparedAt: this.options.runtime.clock.now(), skill: { id: capturedScope.scene || capturedScope.visual ? 'sceneweave-scene-authoring' : capturedScope.artwork ? 'sceneweave-artwork-authoring' : 'sceneweave-prop-authoring', version: 1 }, disclosure: 'complete-metadata/public-model', ...(brief ? { brief } : {}) })
    const authorization = freezeAtomic({ start, scope: start.scope, checkpoint, currentSceneId: current.document.sceneId,
      currentRevision: current.document.revision, baseContentHash })
    this.assertWritable(); this.assertCheckpoint(checkpoint)
    this.atomicAuthorizations.set(authorization, verified)
    return authorization
  }

  /** Current authoring is explicitly negotiated by the caller; it never creates
   * a generated provenance record or an independent-project adoption path. */
  async authorizeCurrentAtomic(scope: CurrentAuthoringScope, brief?: import('../../shared/ai/plan.js').AuthoringBrief): Promise<AtomicAuthorization & { start: AuthoringStartV4 }> {
    this.assertWritable()
    const checkpoint = this.checkpoint(), current = this.requireProject()
    const capturedScope = CurrentAuthoringScopeV4Schema.parse(captureJson(scope))
    const verified = await validateEditableProject(current, this.validation())
    this.assertWritable(); this.assertCheckpoint(checkpoint)
    const project = pureProject(verified), baseContentHash = authoringProjectHash(project)
    const start = captureAtomicStart(createCurrentAuthoringStartV4({ project, scope: capturedScope, seed: crypto.randomUUID(),
      preparedAt: this.options.runtime.clock.now(), flowId: crypto.randomUUID(), ...(brief ? { brief } : {}),
      preservation: { sceneId: current.document.sceneId, revision: current.document.revision, contentHash: baseContentHash, checkpoint } }))
    const authorization = freezeAtomic({ start, scope: start.scope, checkpoint, currentSceneId: current.document.sceneId,
      currentRevision: current.document.revision, baseContentHash })
    this.assertWritable(); this.assertCheckpoint(checkpoint)
    this.atomicAuthorizations.set(authorization, verified)
    return authorization
  }

  private assertBaseMapPreservation(source: BaseMapSource | BaseMapSourceV3) {
    const current = this.state.project, expected = source.preservation
    if ((current?.document.sceneId ?? null) !== expected.sceneId || (current?.document.revision ?? null) !== expected.revision
      || (current ? authoringProjectHash(pureProject(current)) : null) !== expected.contentHash) throw new Error('底图流程的原工程保护基线已变化，请重新生成或保留独立底图。')
    const local = this.baseMapSources.get(source.flowId)
    if (!local || this.terrainPreviews.get(local.preview) !== 'active' || canonical(local.preview.continuationSource) !== canonical(source)) throw new Error('底图候选已取消、替换、采用或缺少本机真实资源。')
  }

  /** Generation stays isolated; authorization does not install a second map. */
  async authorizeBaseMapAtomic(preview: TerrainPreview, scope: AuthoringScope, brief?: import('../../shared/ai/plan.js').AuthoringBrief, options: { authoringVersion?: 4 } = {}): Promise<AtomicAuthorization> {
    this.assertWritable()
    if (this.terrainPreviews.get(preview) !== 'active' || !preview.continuationSource) throw new Error('只有当前完整来源的程序底图可以接续AI；旧底图仍可独立采用。')
    this.assertCheckpoint(preview.checkpoint)
    const source = preview.continuationSource, checkpoint = this.checkpoint()
    const work = this.baseMapExecution.begin(source.flowId, this.atomicSignal())
    try {
      this.assertBaseMapPreservation(source)
      const verified = await validateEditableProject(preview.project, { ...this.validation(), signal: work.signal })
      this.assertWritable(); this.assertCheckpoint(checkpoint); this.assertBaseMapPreservation(source)
      const project = pureProject(verified), capturedScope = (options.authoringVersion === 4 ? CurrentAuthoringScopeV4Schema : source.version === 3 ? ProfiledAuthoringScopeSchema : AuthoringScopeSchema).parse(captureJson(scope))
      const common = { project, baseContentHash: authoringProjectHash(project), scope: capturedScope,
        seed: crypto.randomUUID(), preparedAt: this.options.runtime.clock.now(), skill: { id: 'sceneweave-scene-authoring' as const, version: 1 as const },
        disclosure: 'complete-metadata/public-model' as const, ...(brief ? { brief } : {}) }
      if (options.authoringVersion === 4 && source.version !== 3) throw new Error('新AI协议只接续具完整档位来源的程序底图；旧底图仍可独立采用。')
      const start = options.authoringVersion === 4 && source.version === 3
        ? captureAtomicStart(createGeneratedAuthoringStartV4({ ...common, schemaVersion: 3, policy: createContinuationPolicyV2(source.request.profile), source }))
        : source.version === 3
          ? captureAtomicStart({ ...common, scope: ProfiledAuthoringScopeSchema.parse(capturedScope), schemaVersion: 3, policy: createContinuationPolicyV2(source.request.profile), source })
          : captureAtomicStart({ ...common, scope: AuthoringScopeSchema.parse(capturedScope), schemaVersion: 2, policy: CONTINUATION_POLICY, source })
      const authorization = freezeAtomic({ start, scope: start.scope, checkpoint, currentSceneId: source.preservation.sceneId ?? 'empty-workspace',
        currentRevision: source.preservation.revision ?? 0, baseContentHash: start.baseContentHash })
      this.atomicAuthorizations.set(authorization, verified)
      checkCancelled(work.signal)
      return authorization
    } finally { work.finish() }
  }

  /** Called only after the user explicitly requests attachment of an existing task. */
  async reattachAtomic(input: AuthoringStart): Promise<AtomicAuthorization> {
    this.assertWritable()
    const checkpoint = this.checkpoint(), captured = captureJson(input) as AuthoringStart
    const work = isGeneratedAtomicStart(captured) ? this.baseMapExecution.begin(captured.source.flowId, this.atomicSignal()) : null
    try {
      const start = captureAtomicStart(captured)
      if (isGeneratedAtomicStart(start)) {
        this.assertBaseMapPreservation(start.source)
        const local = this.baseMapSources.get(start.source.flowId)
        if (!local) throw new Error('缺少此底图流程的本机真实资源和活动候选；任务已保留，不能凭网络元数据恢复额度。')
        const verified = await fromBundle({ project: start.project, resources: local.project.resources }, { ...this.validation(), signal: work!.signal })
        this.assertWritable(); this.assertCheckpoint(checkpoint); this.assertBaseMapPreservation(start.source)
        const authorization = freezeAtomic({ start, scope: start.scope, checkpoint, currentSceneId: start.source.preservation.sceneId ?? 'empty-workspace',
          currentRevision: start.source.preservation.revision ?? 0, baseContentHash: start.baseContentHash })
        this.atomicAuthorizations.set(authorization, verified)
        checkCancelled(work!.signal)
        return authorization
      }
      const current = this.requireProject()
      const verified = await validateEditableProject(current, this.validation())
      this.assertWritable(); this.assertCheckpoint(checkpoint)
      if (authoringProjectHash(pureProject(verified)) !== start.baseContentHash) throw new Error('任务基线与当前完整工程不同，已保留草稿，请重新计算。')
      const authorization = freezeAtomic({ start, scope: start.scope, checkpoint, currentSceneId: current.document.sceneId,
        currentRevision: current.document.revision, baseContentHash: start.baseContentHash })
      this.atomicAuthorizations.set(authorization, verified)
      return authorization
    } finally { work?.finish() }
  }

  async prepareAtomicCandidate(authorization: AtomicAuthorization, input: AuthoringDraft, options: ResourceOptions & { allowEmpty?: boolean } = {}): Promise<AtomicCandidate> {
    const source = this.atomicAuthorizations.get(authorization)
    if (!source) throw new Error('AI 授权并非当前工作区创建，不能信任克隆或网络凭证。')
    const work = isGeneratedAtomicStart(authorization.start) ? this.baseMapExecution.begin(authorization.start.source.flowId, this.atomicSignal(options.signal)) : null
    const signal = work?.signal ?? this.atomicSignal(options.signal)
    try {
      checkCancelled(signal)
      if (isGeneratedAtomicStart(authorization.start)) { this.assertCheckpoint(authorization.checkpoint); this.assertBaseMapPreservation(authorization.start.source) }
      const replayed = captureAtomicDraft(input, authorization, options)
      const raw = await fromBundle({ project: replayed.project, resources: source.resources }, { ...this.validation(), signal })
      const assetQuality: AssetQualityAssessment[] = []
      const project = await materializeAuthoringArtwork(raw, replayed.draft, { ...this.validation(), signal }, { onQualityAssessment: assessment => assetQuality.push(assessment) })
      checkCancelled(signal)
      if (isGeneratedAtomicStart(authorization.start)) { this.assertCheckpoint(authorization.checkpoint); this.assertBaseMapPreservation(authorization.start.source) }
      this.validateCandidate(project.document); assertAllFloorPlayerProjections(project.document)
      const changes = atomicChanges(isGeneratedAtomicStart(authorization.start) ? authorization.start.source.blank : authorization.start.project, pureProject(project), replayed.state.changedIds, replayed.visualInvalidatedIds)
      if (!changes.length && !options.allowEmpty) throw new Error('草稿没有可采用的实际修改。')
      const candidate = freezeAtomic({ schemaVersion: replayed.state.schemaVersion,
        ...(isClassifiedAuthoringState(replayed.state) ? { budgetIdentity: authoringBudgetIdentity(replayed.state), budget: replayed.state.budget } : {}),
        project, document: project.document, changes, assetQuality, reviewOnly: options.allowEmpty === true && changes.length === 0, operationCost: replayed.state.operationCost,
        readIds: replayed.state.readIds, writeIds: replayed.state.writeIds, taskId: replayed.draft.taskId, generation: replayed.draft.generation,
        draftRevision: replayed.state.draftRevision, contentHash: replayed.state.contentHash, checkpoint: authorization.checkpoint,
        currentSceneId: authorization.currentSceneId, currentRevision: authorization.currentRevision })
      this.atomicCandidates.set(candidate, { authorization, draft: replayed.draft, status: 'active' })
      checkCancelled(signal)
      return candidate
    } finally { work?.finish() }
  }

  getAtomicCandidateStatus(candidate: AtomicCandidate): AtomicCandidateStatus | null { return this.atomicCandidates.get(candidate)?.status ?? null }
  cancelAtomicCandidate(candidate: AtomicCandidate) {
    const record = this.atomicCandidates.get(candidate)
    if (record && record.status === 'active') record.status = 'cancelled'
  }
  private assertAtomicBaseline(candidate: AtomicCandidate, record: AtomicCandidateRecord) {
    if (!['active', 'applying'].includes(record.status)) throw new Error('AI 草稿已取消或采用，不能重复采用。')
    this.assertCheckpoint(candidate.checkpoint)
    if (isGeneratedAtomicStart(record.authorization.start)) { this.assertBaseMapPreservation(record.authorization.start.source); return }
    const current = this.requireProject()
    if (current.document.sceneId !== candidate.currentSceneId || current.document.revision !== candidate.currentRevision
      || authoringProjectHash(pureProject(current)) !== record.authorization.baseContentHash) throw new Error('AI 草稿基线、锁或来源已变化，请重新计算。')
  }
  private atomicSignal(signal?: ResourceOptions['signal']): NonNullable<ResourceOptions['signal']> {
    const workspaceSignal = this.validation().signal
    return { get aborted() { return !!signal?.aborted || !!workspaceSignal?.aborted } }
  }

  private async baseMapUndoBaseline(source: BaseMapSource | BaseMapSourceV3, final: EditableProject, signal: NonNullable<ResourceOptions['signal']>) {
    const document = emptyCompositionDocument(source.blank.document)
    // Keep fixed definitions/resources introduced by the accepted result. Undo
    // removes its editable objects; it does not rewrite fixed source meanings.
    for (const key of ['assets', 'materials', 'propDefinitions', 'prefabDefinitions', 'styleThemes'] as const) Object.assign(document, { [key]: captureJson(final.document[key]) })
    const content = createCompositionContent(document, this.options.runtime)
    content.historyIdentity.lineageId = final.historyIdentity.lineageId
    return fromBundle({ project: { ...pureProject(final), ...content, schemaVersion: final.schemaVersion }, resources: final.resources }, { ...this.validation(), signal })
  }

  /** Publish the independent result once; the preserved main map is never its edit base. */
  private async adoptBaseMapAtomicCandidate(candidate: AtomicCandidate, record: AtomicCandidateRecord, options: { claim: () => Promise<DraftLease>; signal?: ResourceOptions['signal'] }): Promise<AtomicAdoptionResult> {
    const start = record.authorization.start
    if (!isGeneratedAtomicStart(start)) throw new Error('接续采用版本不同。')
    const work = this.baseMapExecution.begin(start.source.flowId, this.atomicSignal(options.signal)), signal = work.signal, token = {}
    let published = false
    try {
      this.assertAtomicBaseline(candidate, record); checkCancelled(signal)
      this.atomicLock = token; record.status = 'applying'
      const replayed = captureAtomicDraft(record.draft, record.authorization)
      const resources = this.atomicAuthorizations.get(record.authorization)!.resources
      const project = await fromBundle({ project: replayed.project, resources }, { ...this.validation(), signal })
      if (canonical(pureProject(project)) !== canonical(pureProject(candidate.project))) throw new Error('AI接续本机完整重放与已审阅结果不同。')
      this.validateCandidate(project.document); assertAllFloorPlayerProjections(project.document)
      const baseline = await this.baseMapUndoBaseline(start.source, project, signal)
      const revised = captureEditableDraft(project)
      revised.document = reviseSceneSnapshot(revised.document, baseline.document.revision + 1, this.options.runtime.clock.now())
      const final = await validateEditableProject(revised, { ...this.validation(), signal })
      checkCancelled(signal); this.assertAtomicBaseline(candidate, record)
      await this.flush()
      checkCancelled(signal); this.assertAtomicBaseline(candidate, record)
      let protection: EditableSnapshot | undefined, preservation: SourcePreservationGuard | undefined
      const current = this.state.project
      if (current) {
        const usage = await this.repository.usage(current.document.sceneId)
        this.assertAtomicBaseline(candidate, record); checkCancelled(signal)
        protection = await this.createSnapshot(current, '底图AI采用前保护', { kind: 'protection', expectedRevision: current.document.revision,
          expectedMetadataVersion: usage.metadataVersion, signal })
        preservation = { sceneId: current.document.sceneId, revision: current.document.revision, contentHash: protection.contentHash,
          guard: { expectedMetadataVersion: usage.metadataVersion + 1, protection: { id: protection.id, contentHash: protection.contentHash } } }
      }
      this.assertAtomicBaseline(candidate, record); checkCancelled(signal)
      const requestedAt = performance.now(), lease = assertAtomicLease(await options.claim(), candidate, requestedAt)
      this.assertAtomicBaseline(candidate, record); checkCancelled(signal); assertAtomicLease(lease, candidate, requestedAt)
      // Both the old-map protection and the absent new identity are compared in
      // this single write transaction. No blank/partial candidate is published.
      const leaseSignal = { get aborted() { return signal.aborted || performance.now() - requestedAt >= lease.expiresAt - lease.serverNow } }
      await this.repository.save(toBundle(final), null, { signal: leaseSignal, ...(preservation ? { preservation } : {}) })
      if (!this.repository.load) throw new Error('工程仓库缺少完整冷读；已保存独立成果，当前工程保留。')
      const cold = await this.repository.load(final.document.sceneId)
      if (!cold) throw new Error('AI底图冷读失败；当前工程保留。')
      const installed = await fromBundle(cold, { ...this.validation(), signal })
      if (authoringProjectHash(pureProject(installed)) !== authoringProjectHash(pureProject(final))) throw new Error('AI底图在冷读前已变化；请从工程目录核对独立成果。')
      this.assertAtomicBaseline(candidate, record); checkCancelled(signal)
      const local = this.baseMapSources.get(start.source.flowId)
      this.atomicLock = null; this.install(installed)
      this.past = [baseline]; this.future = []
      this.publish({ lastTransaction: { sceneId: installed.document.sceneId, revision: installed.document.revision, committedAtMs: performance.now() } })
      record.status = 'applied'; published = true
      if (local) this.terrainPreviews.set(local.preview, 'applied')
      this.baseMapSources.delete(start.source.flowId)
      return { protection, revision: installed.document.revision, save: Promise.resolve() }
    } catch (error) {
      if (!published) record.status = 'cancelled'
      throw error
    } finally { work.finish(); if (this.atomicLock === token) this.atomicLock = null }
  }

  /** Protect first, claim the exact task generation last, and commit one undo unit. */
  async adoptAtomicCandidate(candidate: AtomicCandidate, options: { claim: () => Promise<DraftLease>; signal?: ResourceOptions['signal']; qualityAcknowledgments?: readonly string[] }): Promise<AtomicAdoptionResult> {
    this.assertWritable()
    const record = this.atomicCandidates.get(candidate)
    if (!record || record.status !== 'active') throw new Error('AI 草稿不属于当前工作区、已取消或已采用。')
    if (candidate.reviewOnly || !candidate.changes.length || !candidate.operationCost) throw new Error('区域来源审阅凭证只能用于独立下钻，不能采用到主工程。')
    const qualityAcknowledgments = [...(options.qualityAcknowledgments ?? [])]
    // Missing human review leaves the candidate active and does not create a
    // protection snapshot or request the short-lived server claim.
    assertAssetQualityAccepted(candidate.assetQuality, qualityAcknowledgments)
    if (isGeneratedAtomicStart(record.authorization.start)) return this.adoptBaseMapAtomicCandidate(candidate, record, options)
    const signal = this.atomicSignal(options.signal)
    this.assertAtomicBaseline(candidate, record); checkCancelled(signal)
    const token = {}
    this.atomicLock = token; record.status = 'applying'
    let committed = false
    try {
      const replayed = captureAtomicDraft(record.draft, record.authorization)
      const source = this.atomicAuthorizations.get(record.authorization)!
      const raw = await fromBundle({ project: replayed.project, resources: source.resources }, { ...this.validation(), signal })
      const assetQuality: AssetQualityAssessment[] = []
      const checkedProject = await materializeAuthoringArtwork(raw, replayed.draft, { ...this.validation(), signal }, { onQualityAssessment: assessment => assetQuality.push(assessment) })
      if (canonical(pureProject(checkedProject)) !== canonical(pureProject(candidate.project))) throw new Error('素材本机物化结果与已审阅草稿不同，请重新审阅。')
      if (canonical(assetQuality) !== canonical(candidate.assetQuality)) throw new Error('素材质量检查与已审阅的确切图片不同，请重新审阅。')
      assertAssetQualityAccepted(assetQuality, qualityAcknowledgments)
      // Preserve the exact verified wrapper before requesting a short-lived server claim.
      const project = checkedProject
      checkCancelled(signal); this.assertAtomicBaseline(candidate, record)
      this.validateCandidate(project.document); assertAllFloorPlayerProjections(project.document)
      reviseSceneSnapshot(project.document, this.requireProject().document.revision + 1, this.options.runtime.clock.now())
      await this.flush()
      checkCancelled(signal); this.assertAtomicBaseline(candidate, record)
      const current = this.requireProject(), usage = await this.repository.usage(candidate.currentSceneId)
      checkCancelled(signal); this.assertAtomicBaseline(candidate, record)
      const protection = await this.createSnapshot(current, 'AI 采用前保护', { kind: 'protection', expectedRevision: candidate.currentRevision,
        expectedMetadataVersion: usage.metadataVersion, signal })
      checkCancelled(signal); this.assertAtomicBaseline(candidate, record)
      this.structureContinuity.recordSnapshot(protection.id, protection.contentHash, current.document)
      this.visualContinuity.recordSnapshot(protection.id, protection.contentHash, current.document)
      const requestedAt = performance.now(), lease = assertAtomicLease(await options.claim(), candidate, requestedAt)
      checkCancelled(signal); this.assertAtomicBaseline(candidate, record)
      // A read transaction rejects already moved branches; the final write must repeat this exact guard.
      if (this.persistedRevision !== candidate.currentRevision) throw new Error('持久修订已变化，未采用 AI 草稿。')
      const guard = { expectedMetadataVersion: usage.metadataVersion + 1, protection: { id: protection.id, contentHash: protection.contentHash } }
      await this.repository.checkProtection(candidate.currentSceneId, candidate.currentRevision, protection.contentHash, guard, { signal })
      checkCancelled(signal); this.assertAtomicBaseline(candidate, record); assertAtomicLease(lease, candidate, requestedAt)
      record.status = 'applied'
      this.visualInvalidations.set(project, replayed.visualInvalidatedIds)
      this.commit(project, 'edit', token, guard)
      committed = true
      const save = this.flush().finally(() => { if (this.atomicLock === token) this.atomicLock = null })
      // The caller reports adoption immediately; persistence failure is shown separately and keeps this branch and undo.
      void save.catch(() => {})
      return { protection, revision: this.requireProject().document.revision, save }
    } catch (error) {
      if (!committed) record.status = 'cancelled'
      throw error
    } finally {
      if (!committed && this.atomicLock === token) this.atomicLock = null
    }
  }

  async createNamedSnapshot(name: string) {
    this.assertWritable()
    const checkpoint = this.checkpoint(), project = this.requireProject()
    await this.flush()
    this.assertCheckpoint(checkpoint)
    const metadataVersion = this.repository.historyMetadataVersion
      ? await this.repository.historyMetadataVersion(project.document.sceneId)
      : (await this.repository.usage(project.document.sceneId)).metadataVersion
    this.assertCheckpoint(checkpoint)
    const snapshot = await this.createSnapshot(project, name, {
      kind: 'named', expectedRevision: project.document.revision, expectedMetadataVersion: metadataVersion,
    })
    this.assertCheckpoint(checkpoint)
    this.structureContinuity.recordSnapshot(snapshot.id, snapshot.contentHash, project.document)
    this.visualContinuity.recordSnapshot(snapshot.id, snapshot.contentHash, project.document)
    return snapshot
  }
  private restoreEvidence(snapshot: EditableSnapshot, request: RestoreRequest) {
    const current = this.requireProject()
    if (request.mode === 'visual') return { visualContinuity: this.visualContinuity.prove(snapshot.id, snapshot.contentHash, current.document, snapshot.project.document) }
    const structuralSurface = request.mode !== 'layer' && request.ids.some(id =>
      (current.appearance.surfaceSources[id] || snapshot.project.appearance.surfaceSources[id])
      && (current.document.rooms[id] || current.document.walls[id] || snapshot.project.document.rooms[id] || snapshot.project.document.walls[id]))
    return structuralSurface ? { surfaceContinuity: this.structureContinuity.prove(snapshot.id, snapshot.contentHash, current.document, snapshot.project.document) } : {}
  }
  async prepareRestore(snapshotId: string, request: RestoreRequest): Promise<RestorePreview> {
    const current = this.requireProject(), checkpoint = this.checkpoint(), frozenRequest = captureJson(request)
    const snapshot = await this.loadNamedSnapshot(snapshotId, current.document.sceneId)
    this.assertCheckpoint(checkpoint)
    if (!snapshot) throw new Error('源快照已被删除，请重新选择。')
    const budget = manualRestoreBudget(current, snapshot.project, frozenRequest)
    const plan = buildRestorePlan(contentOf(current), contentOf(snapshot.project), frozenRequest, this.restoreEvidence(snapshot, frozenRequest), budget)
    this.validateCandidate(plan.document)
    this.assertCheckpoint(checkpoint)
    const materialized = await materializeProject(restorationProject(current, snapshot.project, plan), this.manualPreparation(current, budget))
    this.assertCheckpoint(checkpoint)
    checkCancelled(this.validation().signal)
    const project = getVerifiedEditableProject(materialized) ?? await validateEditableProject(materialized, this.validation())
    this.transferInvalidations(materialized, project)
    this.assertCheckpoint(checkpoint)
    this.validateCandidate(project.document)
    assertAllFloorPlayerProjections(project.document)
    const finalPlan = materializedRestorePlan(current, plan, project, budget)
    const { project: _project, ...summary } = snapshot
    const preview = freeze({ snapshot: summary, plan: finalPlan, project, checkpoint, currentSceneId: current.document.sceneId,
      currentRevision: current.document.revision, sourceContentHash: snapshot.contentHash, budgetProfile: budget })
    this.previews.set(preview, 'active')
    return preview
  }
  cancelRestore(preview: RestorePreview) {
    if (this.previews.has(preview)) this.previews.set(preview, 'cancelled')
  }
  private assertRestore(preview: RestorePreview) {
    if (!['active', 'applying'].includes(this.previews.get(preview) ?? '')) throw new Error('恢复预览已取消、已采用或并非当前工作区创建。')
    this.assertCheckpoint(preview.checkpoint)
    const current = this.requireProject()
    if (current.document.sceneId !== preview.currentSceneId || current.document.revision !== preview.currentRevision) throw new Error('恢复基线已变化，请重新预览。')
  }
  async applyRestore(preview: RestorePreview) {
    this.assertWritable()
    if (this.previews.get(preview) !== 'active') throw new Error('恢复预览不可重复采用。')
    this.assertRestore(preview)
    if (!preview.plan.changed) throw new Error('所选属性与快照一致，无需恢复。')
    this.previews.set(preview, 'applying')
    let readSession: SnapshotReadSession | undefined
    try {
      await this.flush()
      this.assertRestore(preview)
      readSession = this.repository.beginSnapshotRead?.()
      const source = await this.loadNamedSnapshot(preview.snapshot.id, preview.currentSceneId, readSession)
      this.assertRestore(preview)
      if (!source || source.contentHash !== preview.sourceContentHash) throw new Error('源快照已删除或内容校验值已变化，请重新预览。')
      const current = this.requireProject()
      const plan = buildRestorePlan(contentOf(current), contentOf(source.project), preview.plan.request, this.restoreEvidence(source, preview.plan.request), preview.budgetProfile)
      this.validateCandidate(plan.document)
      this.assertRestore(preview)
      const materialized = await materializeProject(restorationProject(current, source.project, plan), this.manualPreparation(current, preview.budgetProfile))
      this.assertRestore(preview)
      checkCancelled(this.validation().signal)
      const candidate = getVerifiedEditableProject(materialized) ?? await validateEditableProject(materialized, this.validation())
      this.transferInvalidations(materialized, candidate)
      this.assertRestore(preview)
      this.validateCandidate(candidate.document)
      assertAllFloorPlayerProjections(candidate.document)
      // Check revision capacity before persisting a protection snapshot.
      reviseSceneSnapshot(candidate.document, current.document.revision + 1, this.options.runtime.clock.now())
      const metadataVersion = this.repository.historyMetadataVersion
        ? await this.repository.historyMetadataVersion(preview.currentSceneId)
        : (await this.repository.usage(preview.currentSceneId)).metadataVersion
      this.assertRestore(preview)
      let protectionName = '恢复前 · '
      for (const character of source.name) { if ((protectionName + character).length > 80) break; protectionName += character }
      const protection = await this.createSnapshot(current, protectionName, {
        kind: 'protection', expectedRevision: current.document.revision, expectedMetadataVersion: metadataVersion,
        sourceSnapshot: { id: source.id, contentHash: preview.sourceContentHash },
        ...(readSession ? { readSession } : {}),
      })
      this.assertRestore(preview)
      this.structureContinuity.recordSnapshot(protection.id, protection.contentHash, current.document)
      this.visualContinuity.recordSnapshot(protection.id, protection.contentHash, current.document)
      const retained = await this.loadNamedSnapshot(preview.snapshot.id, preview.currentSceneId, readSession)
      this.assertRestore(preview)
      if (!retained || retained.contentHash !== preview.sourceContentHash) throw new Error('源快照已删除或内容变化，保护快照已保留，未采用恢复。')
      const guard: ProjectSaveGuard = { expectedMetadataVersion: metadataVersion + 1,
        protection: { id: protection.id, contentHash: protection.contentHash } }
      await this.repository.checkProtection(preview.currentSceneId, current.document.revision, protection.contentHash, guard, { signal: this.validation().signal })
      this.assertRestore(preview); checkCancelled(this.validation().signal)
      this.restoreEvidence(retained, preview.plan.request)
      this.previews.set(preview, 'applied')
      this.commit(candidate, 'edit', undefined, guard)
      return protection
    } catch (error) {
      this.previews.set(preview, 'cancelled')
      throw error
    } finally {
      // Pixel proof and byte closure live only for this one confirmed restore.
      // Session load failures already close it; close is intentionally idempotent.
      if (typeof readSession !== 'undefined') readSession.close()
    }
  }

  /** Inspect dependency expansion before the user explicitly confirms it. */
  async inspectStructureRestore(snapshotId: string, request: StructureRestoreRequest): Promise<StructureRestoreInspection> {
    const current = this.requireProject(), checkpoint = this.checkpoint(), frozenRequest = captureJson(request)
    const snapshot = await this.loadNamedSnapshot(snapshotId, current.document.sceneId)
    this.assertCheckpoint(checkpoint)
    if (!snapshot) throw new Error('源快照已被删除，请重新选择。')
    const budget = manualRestoreBudget(current, snapshot.project, frozenRequest, true)
    const continuity = this.structureContinuity.prove(snapshot.id, snapshot.contentHash, current.document, snapshot.project.document)
    const scope = inspectStructureRestoreScope(current.document, current.historyIdentity, snapshot.project.document, snapshot.project.historyIdentity, frozenRequest, continuity, budget)
    const { project: _project, ...summary } = snapshot
    return freeze({ snapshot: summary, scope, checkpoint, currentRevision: current.document.revision, sourceContentHash: snapshot.contentHash, budgetProfile: budget })
  }

  async prepareStructureRestore(snapshotId: string, request: StructureRestoreRequest): Promise<StructureRestorePreview> {
    const current = this.requireProject(), checkpoint = this.checkpoint(), frozenRequest = captureJson(request)
    const snapshot = await this.loadNamedSnapshot(snapshotId, current.document.sceneId)
    this.assertCheckpoint(checkpoint)
    if (!snapshot) throw new Error('源快照已被删除，请重新选择。')
    const budget = manualRestoreBudget(current, snapshot.project, frozenRequest, true)
    const continuity = this.structureContinuity.prove(snapshot.id, snapshot.contentHash, current.document, snapshot.project.document)
    const plan = buildStructureRestorePlan(current.document, current.historyIdentity, snapshot.project.document, snapshot.project.historyIdentity, frozenRequest, continuity, budget)
    this.validateCandidate(plan.document)
    this.assertCheckpoint(checkpoint)
    // C2 restores geometry/business fields only, so the exact current resource and license closure remains authoritative.
    const project = await validateEditableProject({ ...current, document: plan.document,
      historyIdentity: mergeHistoryIdentities(current.historyIdentity, current.document, snapshot.project.historyIdentity, snapshot.project.document) }, this.validation())
    assertCommandBudget(budget, measureCommandBudget(current.document, project.document, { before: current, after: project }, undefined, budget))
    this.assertCheckpoint(checkpoint)
    const { project: _project, ...summary } = snapshot
    const preview = freeze({ snapshot: summary, plan, project, checkpoint, currentSceneId: current.document.sceneId,
      currentRevision: current.document.revision, sourceContentHash: snapshot.contentHash, budgetProfile: budget })
    this.structurePreviews.set(preview, 'active')
    return preview
  }

  cancelStructureRestore(preview: StructureRestorePreview) {
    if (this.structurePreviews.has(preview)) this.structurePreviews.set(preview, 'cancelled')
  }

  private assertStructureRestore(preview: StructureRestorePreview) {
    if (!['active', 'applying'].includes(this.structurePreviews.get(preview) ?? '')) throw new Error('结构恢复预览已取消、已采用或并非当前工作区创建。')
    this.assertCheckpoint(preview.checkpoint)
    const current = this.requireProject()
    if (current.document.sceneId !== preview.currentSceneId || current.document.revision !== preview.currentRevision) throw new Error('结构恢复基线已变化，请重新预览。')
  }

  async applyStructureRestore(preview: StructureRestorePreview) {
    this.assertWritable()
    if (this.structurePreviews.get(preview) !== 'active') throw new Error('结构恢复预览不可重复采用。')
    this.assertStructureRestore(preview)
    if (!preview.plan.changed) throw new Error('所选结构属性与快照一致，无需恢复。')
    this.structurePreviews.set(preview, 'applying')
    let readSession: SnapshotReadSession | undefined
    try {
      await this.flush()
      this.assertStructureRestore(preview)
      readSession = this.repository.beginSnapshotRead?.()
      const source = await this.loadNamedSnapshot(preview.snapshot.id, preview.currentSceneId, readSession)
      this.assertStructureRestore(preview)
      if (!source || source.contentHash !== preview.sourceContentHash) throw new Error('源快照已删除或内容校验值已变化，请重新预览。')
      const current = this.requireProject()
      const continuity = this.structureContinuity.prove(source.id, source.contentHash, current.document, source.project.document)
      const plan = buildStructureRestorePlan(current.document, current.historyIdentity, source.project.document, source.project.historyIdentity, preview.plan.request, continuity, preview.budgetProfile)
      this.validateCandidate(plan.document)
      this.assertStructureRestore(preview)
      const candidate = await validateEditableProject({ ...current, document: plan.document,
        historyIdentity: mergeHistoryIdentities(current.historyIdentity, current.document, source.project.historyIdentity, source.project.document) }, this.validation())
      assertCommandBudget(preview.budgetProfile, measureCommandBudget(current.document, candidate.document, { before: current, after: candidate }, undefined, preview.budgetProfile))
      this.assertStructureRestore(preview)
      reviseSceneSnapshot(candidate.document, current.document.revision + 1, this.options.runtime.clock.now())
      const usage = await this.repository.usage(preview.currentSceneId)
      this.assertStructureRestore(preview)
      let protectionName = '结构恢复前 · '
      for (const character of source.name) { if ((protectionName + character).length > 80) break; protectionName += character }
      const protection = await this.createSnapshot(current, protectionName, {
        kind: 'protection', expectedRevision: current.document.revision, expectedMetadataVersion: usage.metadataVersion,
        sourceSnapshot: { id: source.id, contentHash: preview.sourceContentHash },
        ...(readSession ? { readSession } : {}),
      })
      this.assertStructureRestore(preview)
      this.structureContinuity.recordSnapshot(protection.id, protection.contentHash, current.document)
      this.visualContinuity.recordSnapshot(protection.id, protection.contentHash, current.document)
      const retained = await this.loadNamedSnapshot(preview.snapshot.id, preview.currentSceneId, readSession)
      this.assertStructureRestore(preview)
      if (!retained || retained.contentHash !== preview.sourceContentHash) throw new Error('源快照已删除或内容变化，保护快照已保留，未采用结构恢复。')
      const guard: ProjectSaveGuard = { expectedMetadataVersion: usage.metadataVersion + 1,
        protection: { id: protection.id, contentHash: protection.contentHash } }
      await this.repository.checkProtection(preview.currentSceneId, current.document.revision, protection.contentHash, guard, { signal: this.validation().signal })
      this.assertStructureRestore(preview); checkCancelled(this.validation().signal)
      // Re-prove after every asynchronous step; topology or source changes cannot slip through protection IO.
      this.structureContinuity.prove(retained.id, retained.contentHash, current.document, retained.project.document)
      this.structurePreviews.set(preview, 'applied')
      this.commit(candidate, 'edit', undefined, guard)
      return protection
    } catch (error) {
      this.structurePreviews.set(preview, 'cancelled')
      throw error
    } finally {
      if (typeof readSession !== 'undefined') readSession.close()
    }
  }
}
