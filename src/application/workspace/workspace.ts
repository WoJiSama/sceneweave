import type { CompositionCommand, CompositionContent } from '../../shared/model/appearance.js'
import { emptyVisualSystem } from '../../shared/visual/types.js'
import type { PreparationContext } from '../../shared/ports/runtime.js'
import type { CompleteValidationOptions } from '../../shared/ports/resources.js'
import { checkCancelled } from '../../shared/ports/resources.js'
import type { SceneDocument, SurfaceRef } from '../../shared/model/scene.js'
import type { LicenseBinding, SnapshotSummary } from '../../shared/model/project.js'
import { certifyCompositionContent, reviseCompositionContent } from '../../shared/validation/content.js'
import { surfaceStyle } from '../../shared/appearance/graph.js'
import { inspectDependencies } from '../../shared/geometry/dependencies.js'
import { reviseSceneSnapshot } from '../../shared/validation/snapshots.js'
import { projectScene } from '../../shared/projection/projection.js'
import { advanceHistoryIdentity, mergeIdentityRecords, mergeHistoryIdentities } from '../../shared/history/identity.js'
import { buildRestorePlan, type RestorePlan, type RestoreRequest } from '../../shared/history/restore.js'
import { StructureContinuitySession } from '../../shared/history/structure-continuity.js'
import { VisualContinuitySession, visualTopology } from '../../shared/history/visual-continuity.js'
import { buildStructureRestorePlan, inspectStructureRestoreScope, type StructureRestorePlan, type StructureRestoreRequest, type StructureRestoreScope } from '../../shared/history/structure-restore.js'
import { validateHistoryArchive, type HistoryArchive } from '../../shared/project/history.js'
import { getVerifiedProjectBundle } from '../../shared/project/resources.js'
import { captureJson } from '../../shared/validation/json.js'
import type { AuthoringDraft, AuthoringScope, AuthoringStart, DraftLease } from '../../shared/ai/authoring-protocol.js'
import { AuthoringScopeSchema } from '../../shared/ai/authoring-protocol.js'
import { authoringProjectHash } from '../../shared/ai/authoring.js'
import type { ResourceOptions } from '../../shared/ports/resources.js'
import type { ProjectRepository, CreateSnapshotOptions, ProjectSaveGuard } from '../../platform/browser/storage/repository.js'
import { assertAtomicLease, atomicChanges, captureAtomicDraft, captureAtomicStart, freezeAtomic, pureProject,
  type AtomicAuthorization, type AtomicCandidate, type AtomicCandidateRecord, type AtomicAdoptionResult, type AtomicCandidateStatus } from './atomic.js'
import { materializeAuthoringArtwork } from './artwork.js'
import { materializeProject, prepareCompositionCommands } from './prepare.js'
import { captureEditableDraft, fromBundle, fromVerifiedBundle, getVerifiedEditableProject, toBundle, tryDeriveEditableProject, tryReviseEditableProject, validateEditableProject, type EditableProject } from './project.js'

export type WorkspaceRepository = Pick<ProjectRepository, 'save' | 'loadSnapshot' | 'createSnapshot' | 'usage' | 'importArchive' | 'checkProtection'>
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
}
export interface RestorePreview {
  snapshot: SnapshotSummary
  plan: RestorePlan
  project: EditableProject
  checkpoint: number
  currentSceneId: string
  currentRevision: number
  sourceContentHash: string
}
export interface StructureRestorePreview extends Omit<RestorePreview, 'plan'> {
  plan: StructureRestorePlan
}
export interface StructureRestoreInspection {
  snapshot: SnapshotSummary
  scope: StructureRestoreScope
  checkpoint: number
  currentRevision: number
  sourceContentHash: string
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
  const removedStructureIds = new Set(captured.flatMap(command => command.type === 'deleteOpening' || command.type === 'deleteNote' ? [command.id] : []))
  if (captured.some(command => (command.type === 'addOpening' || command.type === 'createNote') && removedStructureIds.has(command.id))) {
    throw new Error('同一事务不能删除后重建同一结构 ID；请使用明确更新，结构删除重建不能用于历史恢复。')
  }
  return captured
}
const message = (error: unknown) => error instanceof Error ? error.message : String(error)
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
  return equalOwnedJson(left.document, right.document) && equalOwnedJson(left.appearance, right.appearance)
    && equalOwnedJson(left.historyIdentity, right.historyIdentity)
}
const anchorTopology = (anchor: SceneDocument['notes'][string]['anchor'] | undefined) => anchor?.type === 'point' ? { type: 'point' } : anchor
const bindingKey = (binding: Pick<LicenseBinding, 'subjectKind' | 'subjectId'>) => JSON.stringify([binding.subjectKind, binding.subjectId])
const catalogCollections = ['assets', 'materials', 'propDefinitions', 'prefabDefinitions', 'styleThemes'] as const
const fixedAppearanceCollections = ['sources', 'variants', 'prefabAppearanceTemplates'] as const
const contentOf = (project: EditableProject): CompositionContent => ({ document: project.document, historyIdentity: project.historyIdentity, appearance: project.appearance })
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
    const before = visualTopology(scene), visual = scene.visual
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
  const sameRecords = (selected: Record<string, unknown>, original: Record<string, unknown>) => Object.keys(selected).length === Object.keys(original).length
    && Object.entries(selected).every(([key, value]) => Object.hasOwn(original, key) && value === original[key])
  // A transform-only restore can retain the exact current owned byte closure.
  // New historic assets, SVG sources or bindings still take the merged reader
  // and full byte/pixel validation path below.
  if (getVerifiedEditableProject(current) && sameRecords(assets, current.assets) && sameRecords(licenses, current.licenses)
    && sameRecords(authoringSources, current.authoringSources) && licenseBindings.length === current.licenseBindings.length
    && licenseBindings.every((binding, index) => binding === current.licenseBindings[index])) {
    return { ...current, document: plan.document, historyIdentity: plan.historyIdentity, appearance: plan.appearance }
  }
  return { ...current, document: plan.document, historyIdentity: plan.historyIdentity, appearance: plan.appearance, assets, licenses, authoringSources, licenseBindings, resources: Object.freeze({ read: (hash: string) => Object.hasOwn(current.assets, hash) || Object.values(current.authoringSources).some(source => source.sourceSha256 === hash || source.normalizedSha256 === hash) ? current.resources.read(hash) : historic.resources.read(hash) }) }
}

/** Diff rows describe the actual materialized result, including today's layer in source mode. */
function materializedRestorePlan(current: EditableProject, plan: RestorePlan, project: EditableProject): RestorePlan {
  const changes = plan.changes.map(change => {
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
  return { ...plan, document: project.document, appearance: project.appearance, changes,
    changed: canonical({ document: current.document, appearance: current.appearance }) !== canonical({ document: project.document, appearance: project.appearance }) }
}

/** Owns native complete-v1 history, byte closures and session-only structural evidence. */
export class Workspace {
  private state: WorkspaceState = { project: null, status: 'empty', error: null, canUndo: false, canRedo: false, lastTransaction: null }
  private readonly listeners = new Set<() => void>()
  private readonly compositionPreviews = new WeakMap<CompositionPreview, PreviewStatus>()
  private readonly previews = new WeakMap<RestorePreview, PreviewStatus>()
  private readonly structurePreviews = new WeakMap<StructureRestorePreview, PreviewStatus>()
  private readonly atomicAuthorizations = new WeakMap<AtomicAuthorization, EditableProject>()
  private readonly atomicCandidates = new WeakMap<AtomicCandidate, AtomicCandidateRecord>()
  private readonly saveGuards = new WeakMap<EditableProject, ProjectSaveGuard>()
  private atomicLock: object | null = null
  private readonly structureContinuity = new StructureContinuitySession()
  private readonly visualContinuity = new VisualContinuitySession()
  private readonly structuralInvalidations = new WeakMap<EditableProject, string[]>()
  private readonly visualInvalidations = new WeakMap<EditableProject, string[]>()
  private past: EditableProject[] = []
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
  private install(project: EditableProject) {
    this.assertWritable()
    const verified = getVerifiedEditableProject(project)
    const owned = verified ?? captureEditableDraft(project)
    if (!verified) Object.assign(owned, certifyCompositionContent({ document: owned.document, historyIdentity: owned.historyIdentity, appearance: owned.appearance }))
    this.structureContinuity.reset(owned.document)
    this.visualContinuity.reset(owned.document)
    this.version++
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
          await this.repository.save(toBundle(snapshot), this.persistedRevision, { guard: this.saveGuards.get(snapshot) })
          this.saveGuards.delete(snapshot)
          this.persistedRevision = snapshot.document.revision
          this.publish({ status: this.pending ? 'unsaved' : 'saved', error: null })
        } catch (error) {
          this.pending = this.pending ?? snapshot; this.blocked = error
          this.publish({ status: error instanceof Error && error.name === 'ProjectConflictError' ? 'conflict' : 'error', error: message(error) })
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
    const current = this.state.project
    if (!current) return
    // Reset the existing witness owner so even previously issued proofs expire.
    this.structureContinuity.reset(current.document)
    this.visualContinuity.reset(current.document)
    this.version++
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
  /** Upgrade a saved current-v1 branch by publishing a separately validated copy. */
  async enableVisualCopy() {
    this.assertWritable()
    const current = this.requireProject()
    if (current.schemaVersion === 2) return
    const checkpoint = this.checkpoint()
    await this.flush()
    this.assertCheckpoint(checkpoint)
    const draft = forkProject(current, this.options.runtime)
    draft.schemaVersion = 2
    draft.document.schemaVersion = 2
    draft.document.visual = emptyVisualSystem()
    draft.document.title = `${current.document.title} · 视觉副本`
    const candidate = await validateEditableProject(draft, this.validation())
    this.assertCheckpoint(checkpoint)
    await this.repository.save(toBundle(candidate), null)
    this.assertCheckpoint(checkpoint)
    this.install(candidate)
  }
  /** Complete public validation returns a new wrapper; retain transaction-only witnesses explicitly. */
  private transferInvalidations(source: EditableProject, target: EditableProject) {
    const structural = this.structuralInvalidations.get(source), visual = this.visualInvalidations.get(source)
    if (structural) this.structuralInvalidations.set(target, [...structural])
    if (visual) this.visualInvalidations.set(target, [...visual])
  }
  private commit(candidate: EditableProject, history: 'edit' | 'undo' | 'redo', token?: object, saveGuard?: ProjectSaveGuard, baseline: EditableProject = candidate) {
    this.assertWritable(token)
    const current = this.requireProject(), checkpoint = this.checkpoint()
    const historyIdentity = mergeIdentityRecords(candidate.historyIdentity, [current.historyIdentity])
    const sameIdentity = equalOwnedJson(historyIdentity, candidate.historyIdentity)
    const content = reviseCompositionContent({ document: candidate.document, historyIdentity: candidate.historyIdentity, appearance: candidate.appearance },
      current.document.revision + 1, this.options.runtime.clock.now(), sameIdentity ? undefined : historyIdentity)
    this.validateCandidate(content.document)
    const next = (sameIdentity ? tryReviseEditableProject(candidate, content.document.revision, content.document.updatedAt, this.validation()) : undefined)
      ?? tryDeriveEditableProject({ ...candidate, ...content }, baseline, this.validation())
    if (!next) throw new Error('提交工程未能保留确切不可变资源闭包的验证证明，已保留当前内容。')
    this.assertCheckpoint(checkpoint)
    const retainedGuard = saveGuard ?? this.saveGuards.get(current)
    if (retainedGuard) this.saveGuards.set(next, retainedGuard)
    this.structureContinuity.advance(current.document, next.document, this.structuralInvalidations.get(candidate))
    this.visualContinuity.advance(current.document, next.document, this.visualInvalidations.get(candidate))
    if (history === 'edit') { this.past.push(current); this.future = [] }
    else if (history === 'undo') { this.past.pop(); this.future.push(current) }
    else { this.future.pop(); this.past.push(current) }
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
    for (const collection of ['propTokens', 'prefabTokens'] as const) for (const [id, token] of Object.entries(current.historyIdentity[collection])) {
      if (candidate.historyIdentity[collection][id] !== token) throw new Error(`候选不能丢弃或改写已分配身份：${id}。`)
    }
    for (const [id, record] of Object.entries(current.historyIdentity.outdoorTokens)) {
      const after = candidate.historyIdentity.outdoorTokens[id]
      if (!after || after.kind !== record.kind || after.token !== record.token) throw new Error(`候选不能丢弃或改写室外出生身份：${id}。`)
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
    for (const collection of fixedAppearanceCollections) assertAppendOnly('固定外观记录', current.appearance[collection], candidate.appearance[collection])
    assertAppendOnly('资源记录', current.assets, candidate.assets)
    assertAppendOnly('许可文本', current.licenses, candidate.licenses)
    assertAppendOnly('许可绑定', Object.fromEntries(current.licenseBindings.map(binding => [bindingKey(binding), binding])),
      Object.fromEntries(candidate.licenseBindings.map(binding => [bindingKey(binding), binding])))
  }
  /** Public prepared candidates can only append a fully validated fixed asset catalog. */
  async previewPrepared(input: EditableProject, description = '素材入库', checkpoint = this.checkpoint()): Promise<CompositionPreview> {
    const candidate = captureEditableDraft(input)
    this.assertCatalogImport(candidate, checkpoint)
    return this.registerPrepared(candidate, description, checkpoint)
  }
  /** Only the command preparation path may register candidates that change scene semantics. */
  private async registerPrepared(input: EditableProject, description: string, checkpoint: number, commands: readonly CompositionCommand[] = []): Promise<CompositionPreview> {
    this.assertCandidateBaseline(input, checkpoint)
    const candidate = getVerifiedEditableProject(input) ?? await validateEditableProject(input, this.validation())
    this.assertCandidateBaseline(candidate, checkpoint)
    this.validateCandidate(candidate.document)
    projectScene(candidate.document, 'player')
    this.assertCheckpoint(checkpoint)
    const project = freeze(candidate)
    const preview = freeze({ project, document: project.document, commands, description, checkpoint,
      currentSceneId: project.document.sceneId, currentRevision: project.document.revision })
    this.compositionPreviews.set(preview, 'active')
    return preview
  }
  async preview(commands: readonly CompositionCommand[]): Promise<CompositionPreview> {
    const current = this.requireProject(), checkpoint = this.checkpoint(), frozenCommands = captureCommands(commands)
    const candidate = await prepareCompositionCommands(current, frozenCommands, this.preparation())
    this.assertCheckpoint(checkpoint)
    const preview = await this.registerPrepared(candidate, '场景与外观修改', checkpoint, frozenCommands)
    this.structuralInvalidations.set(preview.project, invalidatedStructureIds(current.document, frozenCommands))
    this.visualInvalidations.set(preview.project, invalidatedVisualIds(current.document, frozenCommands))
    return preview
  }
  cancelPreview(preview: CompositionPreview) {
    if (this.compositionPreviews.has(preview)) this.compositionPreviews.set(preview, 'cancelled')
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
      const candidate = await validateEditableProject(preview.project, this.validation())
      this.assertPreview(preview)
      this.validateCandidate(candidate.document)
      this.assertPreview(preview)
      const current = this.requireProject()
      if (!equalOwnedContent(current, candidate)
        || this.structuralInvalidations.get(preview.project)?.length || this.visualInvalidations.get(preview.project)?.length) {
        this.transferInvalidations(preview.project, candidate)
        this.commit(candidate, 'edit')
      }
      this.compositionPreviews.set(preview, 'applied')
    } catch (error) { this.compositionPreviews.set(preview, 'cancelled'); throw error }
  }
  async execute(commands: readonly CompositionCommand[]): Promise<void> {
    this.assertWritable()
    const current = this.requireProject(), checkpoint = this.checkpoint(), frozenCommands = captureCommands(commands)
    // Preparation fully validates both the captured input and the materialized
    // candidate. Only validator-owned immutable byte/original closures are reused.
    // Immediate commands have no user-visible preview lifetime to register/recheck.
    const candidate = await prepareCompositionCommands(current, frozenCommands, this.preparation())
    this.assertCandidateBaseline(candidate, checkpoint)
    this.validateCandidate(candidate.document)
    projectScene(candidate.document, 'player')
    this.assertCandidateBaseline(candidate, checkpoint)
    const structuralInvalidations = invalidatedStructureIds(current.document, frozenCommands)
    const visualInvalidations = invalidatedVisualIds(current.document, frozenCommands)
    if (!equalOwnedContent(current, candidate)
      || structuralInvalidations.length || visualInvalidations.length) {
      this.structuralInvalidations.set(candidate, structuralInvalidations)
      this.visualInvalidations.set(candidate, visualInvalidations)
      this.commit(candidate, 'edit')
    }
  }
  updateProp(id: string, changes: { positionMm?: { x: number; y: number }; rotationDeg?: number }) { return this.execute([{ type: 'updateProp', id, changes }]) }
  rotateRoomMaterial(id: string, rotationDeg: number) { return this.execute([{ type: 'setSurfacePaint', kind: 'room', id, changes: { rotationDeg } }]) }
  detachPrefabMember(groupId: string, propId: string) { return this.execute([{ type: 'detachPrefabMember', groupId, propId }]) }
  resetPrefabMember(groupId: string, key: string, newId?: string, supportRef?: SurfaceRef) { return this.execute([{ type: 'resetPrefabMember', groupId, key, ...(newId ? { newId } : {}), ...(supportRef ? { supportRef } : {}) }]) }
  removePrefabMember(id: string) { return this.execute([{ type: 'deleteProp', id }]) }
  private restoreHistory(candidate: EditableProject, history: 'undo' | 'redo') {
    const current = this.requireProject(), checkpoint = this.checkpoint()
    const historyIdentity = advanceHistoryIdentity(current.historyIdentity, current.document, candidate.document, this.options.runtime, { allowResurrection: true })
    this.validateCandidate(candidate.document)
    this.assertCheckpoint(checkpoint)
    this.commit({ ...candidate, historyIdentity }, history, undefined, undefined, candidate)
  }
  undo() { this.assertWritable(); const previous = this.past.at(-1); if (previous) this.restoreHistory(previous, 'undo') }
  redo() { this.assertWritable(); const next = this.future.at(-1); if (next) this.restoreHistory(next, 'redo') }

  async loadNamedSnapshot(snapshotId: string, ownerSceneId = this.requireProject().document.sceneId): Promise<EditableSnapshot | null> {
    const snapshot = await this.repository.loadSnapshot(ownerSceneId, snapshotId)
    if (!snapshot) return null
    const { bundle, ...summary } = snapshot
    const verified = getVerifiedProjectBundle(bundle)
    return { ...summary, project: verified ? fromVerifiedBundle(verified, this.validation()) : await fromBundle(bundle, this.validation()) }
  }
  private async createSnapshot(project: EditableProject, name: string, options: CreateSnapshotOptions): Promise<EditableSnapshot> {
    const snapshot = await this.repository.createSnapshot(toBundle(project), name, options)
    const { bundle, ...summary } = snapshot
    const verified = getVerifiedProjectBundle(bundle)
    return { ...summary, project: verified ? fromVerifiedBundle(verified, this.validation()) : await fromBundle(bundle, this.validation()) }
  }

  /** Explicitly freezes one local authority; JSON returned by a task can never create it. */
  async authorizeAtomic(scope: AuthoringScope, brief?: import('../../shared/ai/plan.js').AuthoringBrief): Promise<AtomicAuthorization> {
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

  /** Called only after the user explicitly requests attachment of an existing task. */
  async reattachAtomic(input: AuthoringStart): Promise<AtomicAuthorization> {
    this.assertWritable()
    const checkpoint = this.checkpoint(), start = captureAtomicStart(input), current = this.requireProject()
    const verified = await validateEditableProject(current, this.validation())
    this.assertWritable(); this.assertCheckpoint(checkpoint)
    if (authoringProjectHash(pureProject(verified)) !== start.baseContentHash) throw new Error('任务基线与当前完整工程不同，已保留草稿，请重新计算。')
    const authorization = freezeAtomic({ start, scope: start.scope, checkpoint, currentSceneId: current.document.sceneId,
      currentRevision: current.document.revision, baseContentHash: start.baseContentHash })
    this.atomicAuthorizations.set(authorization, verified)
    return authorization
  }

  async prepareAtomicCandidate(authorization: AtomicAuthorization, input: AuthoringDraft, options: ResourceOptions = {}): Promise<AtomicCandidate> {
    const source = this.atomicAuthorizations.get(authorization)
    if (!source) throw new Error('AI 授权并非当前工作区创建，不能信任克隆或网络凭证。')
    const signal = this.atomicSignal(options.signal)
    checkCancelled(signal)
    const replayed = captureAtomicDraft(input, authorization)
    const raw = await fromBundle({ project: replayed.project, resources: source.resources }, { ...this.validation(), signal })
    const project = await materializeAuthoringArtwork(raw, replayed.draft, { ...this.validation(), signal })
    checkCancelled(signal)
    this.validateCandidate(project.document); projectScene(project.document, 'player')
    const changes = atomicChanges(authorization.start.project, pureProject(project), replayed.state.changedIds, replayed.visualInvalidatedIds)
    if (!changes.length) throw new Error('草稿没有可采用的实际修改。')
    const candidate = freezeAtomic({ project, document: project.document, changes, operationCost: replayed.state.operationCost,
      readIds: replayed.state.readIds, writeIds: replayed.state.writeIds, taskId: replayed.draft.taskId, generation: replayed.draft.generation,
      draftRevision: replayed.state.draftRevision, contentHash: replayed.state.contentHash, checkpoint: authorization.checkpoint,
      currentSceneId: authorization.currentSceneId, currentRevision: authorization.currentRevision })
    this.atomicCandidates.set(candidate, { authorization, draft: replayed.draft, status: 'active' })
    return candidate
  }

  getAtomicCandidateStatus(candidate: AtomicCandidate): AtomicCandidateStatus | null { return this.atomicCandidates.get(candidate)?.status ?? null }
  cancelAtomicCandidate(candidate: AtomicCandidate) {
    const record = this.atomicCandidates.get(candidate)
    if (record && record.status === 'active') record.status = 'cancelled'
  }
  private assertAtomicBaseline(candidate: AtomicCandidate, record: AtomicCandidateRecord) {
    if (!['active', 'applying'].includes(record.status)) throw new Error('AI 草稿已取消或采用，不能重复采用。')
    this.assertCheckpoint(candidate.checkpoint)
    const current = this.requireProject()
    if (current.document.sceneId !== candidate.currentSceneId || current.document.revision !== candidate.currentRevision
      || authoringProjectHash(pureProject(current)) !== record.authorization.baseContentHash) throw new Error('AI 草稿基线、锁或来源已变化，请重新计算。')
  }
  private atomicSignal(signal?: ResourceOptions['signal']): NonNullable<ResourceOptions['signal']> {
    const workspaceSignal = this.validation().signal
    return { get aborted() { return !!signal?.aborted || !!workspaceSignal?.aborted } }
  }

  /** Protect first, claim the exact task generation last, and commit one undo unit. */
  async adoptAtomicCandidate(candidate: AtomicCandidate, options: { claim: () => Promise<DraftLease>; signal?: ResourceOptions['signal'] }): Promise<AtomicAdoptionResult> {
    this.assertWritable()
    const record = this.atomicCandidates.get(candidate)
    if (!record || record.status !== 'active') throw new Error('AI 草稿不属于当前工作区、已取消或已采用。')
    const signal = this.atomicSignal(options.signal)
    this.assertAtomicBaseline(candidate, record); checkCancelled(signal)
    const token = {}
    this.atomicLock = token; record.status = 'applying'
    let committed = false
    try {
      const replayed = captureAtomicDraft(record.draft, record.authorization)
      const source = this.atomicAuthorizations.get(record.authorization)!
      const raw = await fromBundle({ project: replayed.project, resources: source.resources }, { ...this.validation(), signal })
      const checkedProject = await materializeAuthoringArtwork(raw, replayed.draft, { ...this.validation(), signal })
      if (canonical(pureProject(checkedProject)) !== canonical(pureProject(candidate.project))) throw new Error('素材本机物化结果与已审阅草稿不同，请重新审阅。')
      // Preserve the exact verified wrapper before requesting a short-lived server claim.
      const project = checkedProject
      checkCancelled(signal); this.assertAtomicBaseline(candidate, record)
      this.validateCandidate(project.document); projectScene(project.document, 'player')
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
    const usage = await this.repository.usage(project.document.sceneId)
    this.assertCheckpoint(checkpoint)
    const snapshot = await this.createSnapshot(project, name, {
      kind: 'named', expectedRevision: project.document.revision, expectedMetadataVersion: usage.metadataVersion,
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
    const plan = buildRestorePlan(contentOf(current), contentOf(snapshot.project), frozenRequest, this.restoreEvidence(snapshot, frozenRequest))
    this.validateCandidate(plan.document)
    this.assertCheckpoint(checkpoint)
    const materialized = await materializeProject(restorationProject(current, snapshot.project, plan), this.preparation(current))
    this.assertCheckpoint(checkpoint)
    checkCancelled(this.validation().signal)
    const project = getVerifiedEditableProject(materialized) ?? await validateEditableProject(materialized, this.validation())
    checkCancelled(this.validation().signal)
    this.transferInvalidations(materialized, project)
    this.assertCheckpoint(checkpoint)
    this.validateCandidate(project.document)
    projectScene(project.document, 'player')
    const finalPlan = materializedRestorePlan(current, plan, project)
    const { project: _project, ...summary } = snapshot
    const preview = freeze({ snapshot: summary, plan: finalPlan, project, checkpoint, currentSceneId: current.document.sceneId,
      currentRevision: current.document.revision, sourceContentHash: snapshot.contentHash })
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
    try {
      await this.flush()
      this.assertRestore(preview)
      const source = await this.loadNamedSnapshot(preview.snapshot.id, preview.currentSceneId)
      this.assertRestore(preview)
      if (!source || source.contentHash !== preview.sourceContentHash) throw new Error('源快照已删除或内容校验值已变化，请重新预览。')
      const current = this.requireProject()
      const plan = buildRestorePlan(contentOf(current), contentOf(source.project), preview.plan.request, this.restoreEvidence(source, preview.plan.request))
      this.validateCandidate(plan.document)
      this.assertRestore(preview)
      const materialized = await materializeProject(restorationProject(current, source.project, plan), this.preparation(current))
      this.assertRestore(preview)
      checkCancelled(this.validation().signal)
      const candidate = getVerifiedEditableProject(materialized) ?? await validateEditableProject(materialized, this.validation())
      checkCancelled(this.validation().signal)
      this.transferInvalidations(materialized, candidate)
      this.assertRestore(preview)
      this.validateCandidate(candidate.document)
      projectScene(candidate.document, 'player')
      // Check revision capacity before persisting a protection snapshot.
      reviseSceneSnapshot(candidate.document, current.document.revision + 1, this.options.runtime.clock.now())
      const usage = await this.repository.usage(preview.currentSceneId)
      this.assertRestore(preview)
      let protectionName = '恢复前 · '
      for (const character of source.name) { if ((protectionName + character).length > 80) break; protectionName += character }
      const protection = await this.createSnapshot(current, protectionName, {
        kind: 'protection', expectedRevision: current.document.revision, expectedMetadataVersion: usage.metadataVersion,
        sourceSnapshot: { id: source.id, contentHash: preview.sourceContentHash },
      })
      this.assertRestore(preview)
      this.structureContinuity.recordSnapshot(protection.id, protection.contentHash, current.document)
      this.visualContinuity.recordSnapshot(protection.id, protection.contentHash, current.document)
      const retained = await this.loadNamedSnapshot(preview.snapshot.id, preview.currentSceneId)
      this.assertRestore(preview)
      if (!retained || retained.contentHash !== preview.sourceContentHash) throw new Error('源快照已删除或内容变化，保护快照已保留，未采用恢复。')
      this.restoreEvidence(retained, preview.plan.request)
      this.previews.set(preview, 'applied')
      this.commit(candidate, 'edit')
      return protection
    } catch (error) {
      this.previews.set(preview, 'cancelled')
      throw error
    }
  }

  /** Inspect dependency expansion before the user explicitly confirms it. */
  async inspectStructureRestore(snapshotId: string, request: StructureRestoreRequest): Promise<StructureRestoreInspection> {
    const current = this.requireProject(), checkpoint = this.checkpoint(), frozenRequest = captureJson(request)
    const snapshot = await this.loadNamedSnapshot(snapshotId, current.document.sceneId)
    this.assertCheckpoint(checkpoint)
    if (!snapshot) throw new Error('源快照已被删除，请重新选择。')
    const continuity = this.structureContinuity.prove(snapshot.id, snapshot.contentHash, current.document, snapshot.project.document)
    const scope = inspectStructureRestoreScope(current.document, current.historyIdentity, snapshot.project.document, snapshot.project.historyIdentity, frozenRequest, continuity)
    const { project: _project, ...summary } = snapshot
    return freeze({ snapshot: summary, scope, checkpoint, currentRevision: current.document.revision, sourceContentHash: snapshot.contentHash })
  }

  async prepareStructureRestore(snapshotId: string, request: StructureRestoreRequest): Promise<StructureRestorePreview> {
    const current = this.requireProject(), checkpoint = this.checkpoint(), frozenRequest = captureJson(request)
    const snapshot = await this.loadNamedSnapshot(snapshotId, current.document.sceneId)
    this.assertCheckpoint(checkpoint)
    if (!snapshot) throw new Error('源快照已被删除，请重新选择。')
    const continuity = this.structureContinuity.prove(snapshot.id, snapshot.contentHash, current.document, snapshot.project.document)
    const plan = buildStructureRestorePlan(current.document, current.historyIdentity, snapshot.project.document, snapshot.project.historyIdentity, frozenRequest, continuity)
    this.validateCandidate(plan.document)
    this.assertCheckpoint(checkpoint)
    // C2 restores geometry/business fields only, so the exact current resource and license closure remains authoritative.
    const project = await validateEditableProject({ ...current, document: plan.document,
      historyIdentity: mergeHistoryIdentities(current.historyIdentity, current.document, snapshot.project.historyIdentity, snapshot.project.document) }, this.validation())
    this.assertCheckpoint(checkpoint)
    const { project: _project, ...summary } = snapshot
    const preview = freeze({ snapshot: summary, plan, project, checkpoint, currentSceneId: current.document.sceneId,
      currentRevision: current.document.revision, sourceContentHash: snapshot.contentHash })
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
    try {
      await this.flush()
      this.assertStructureRestore(preview)
      const source = await this.loadNamedSnapshot(preview.snapshot.id, preview.currentSceneId)
      this.assertStructureRestore(preview)
      if (!source || source.contentHash !== preview.sourceContentHash) throw new Error('源快照已删除或内容校验值已变化，请重新预览。')
      const current = this.requireProject()
      const continuity = this.structureContinuity.prove(source.id, source.contentHash, current.document, source.project.document)
      const plan = buildStructureRestorePlan(current.document, current.historyIdentity, source.project.document, source.project.historyIdentity, preview.plan.request, continuity)
      this.validateCandidate(plan.document)
      this.assertStructureRestore(preview)
      const candidate = await validateEditableProject({ ...current, document: plan.document,
        historyIdentity: mergeHistoryIdentities(current.historyIdentity, current.document, source.project.historyIdentity, source.project.document) }, this.validation())
      this.assertStructureRestore(preview)
      reviseSceneSnapshot(candidate.document, current.document.revision + 1, this.options.runtime.clock.now())
      const usage = await this.repository.usage(preview.currentSceneId)
      this.assertStructureRestore(preview)
      let protectionName = '结构恢复前 · '
      for (const character of source.name) { if ((protectionName + character).length > 80) break; protectionName += character }
      const protection = await this.createSnapshot(current, protectionName, {
        kind: 'protection', expectedRevision: current.document.revision, expectedMetadataVersion: usage.metadataVersion,
        sourceSnapshot: { id: source.id, contentHash: preview.sourceContentHash },
      })
      this.assertStructureRestore(preview)
      this.structureContinuity.recordSnapshot(protection.id, protection.contentHash, current.document)
      this.visualContinuity.recordSnapshot(protection.id, protection.contentHash, current.document)
      const retained = await this.loadNamedSnapshot(preview.snapshot.id, preview.currentSceneId)
      this.assertStructureRestore(preview)
      if (!retained || retained.contentHash !== preview.sourceContentHash) throw new Error('源快照已删除或内容变化，保护快照已保留，未采用结构恢复。')
      // Re-prove after every asynchronous step; topology or source changes cannot slip through protection IO.
      this.structureContinuity.prove(retained.id, retained.contentHash, current.document, retained.project.document)
      this.structurePreviews.set(preview, 'applied')
      this.commit(candidate, 'edit')
      return protection
    } catch (error) {
      this.structurePreviews.set(preview, 'cancelled')
      throw error
    }
  }
}
