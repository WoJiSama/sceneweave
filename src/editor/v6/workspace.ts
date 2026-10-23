import { newId } from '../../core/types'
import type { CompositionCommandV6 } from '../../core/v6/types'
import { certifyCompositionContentV6, reviseCompositionContentV6 } from '../../core/v6/schema'
import { surfaceStyleV6 } from '../../core/v6/graph'
import { inspectDependenciesV3 } from '../../core/v3/dependencies'
import { reviseSceneSnapshotV3 } from '../../core/v3/snapshots'
import type { SceneDocumentV3, SurfaceRef } from '../../core/v3/types'
import { projectSceneV3 } from '../../render/v3/projection'
import { advanceHistoryIdentityV6, mergeIdentityRecordsV6, mergeHistoryIdentitiesV6, toHistoryIdentityV4 } from '../../core/v6/identity'
import { buildRestorePlanV6, type RestorePlanV6, type RestoreRequestV6 } from '../../core/v6/restore'
import { StructureContinuitySessionV4 } from '../../core/v4/structure-continuity'
import { buildStructureRestorePlanV4, inspectStructureRestoreScopeV4, type StructureRestorePlanV4, type StructureRestoreRequestV4, type StructureRestoreScopeV4 } from '../../core/v4/structure-restore'
import { materializeProjectV6, prepareCompositionCommandsV6 } from '../../io/v6/prepare'
import { captureCompleteProjectV6, captureValidatedProjectV6, validateCompleteProjectV6 } from '../../io/v6/project-file'
import type { SceneRepositoryV6 } from '../../io/v6/storage'
import type { CompleteProjectV6, HistoryArchiveV6, LicenseBinding, NamedSnapshotSummaryV6, NamedSnapshotV6 } from '../../io/v6/types'

export type WorkspaceRepositoryV6 = Pick<SceneRepositoryV6,
  'save' | 'loadNamedSnapshot' | 'createNamedSnapshot' | 'usage' | 'importArchive'>
type SaveStatus = 'empty' | 'saved' | 'unsaved' | 'saving' | 'error' | 'conflict'
export interface WorkspaceStateV6 {
  project: CompleteProjectV6 | null
  status: SaveStatus
  error: string | null
  canUndo: boolean
  canRedo: boolean
  /** Session-only completion boundary; never part of a project, checkpoint or archive. */
  lastTransaction: Readonly<{ sceneId: string; revision: number; committedAtMs: number }> | null
}
export interface CompositionPreviewV6 {
  project: CompleteProjectV6
  document: SceneDocumentV3
  commands: readonly CompositionCommandV6[]
  description: string
  checkpoint: number
  currentSceneId: string
  currentRevision: number
}
export interface RestorePreviewV6 {
  snapshot: NamedSnapshotSummaryV6
  plan: RestorePlanV6
  project: CompleteProjectV6
  checkpoint: number
  currentSceneId: string
  currentRevision: number
  sourceContentHash: string
}
export interface StructureRestorePreviewV6 extends Omit<RestorePreviewV6, 'plan'> {
  plan: StructureRestorePlanV4
}
export interface StructureRestoreInspectionV6 {
  snapshot: NamedSnapshotSummaryV6
  scope: StructureRestoreScopeV4
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
function captureCommands(commands: readonly CompositionCommandV6[]): readonly CompositionCommandV6[] {
  const captured = freeze(copy(commands))
  const removedStructureIds = new Set(captured.flatMap(command => command.type === 'deleteOpening' || command.type === 'deleteNote' ? [command.id] : []))
  if (captured.some(command => (command.type === 'addOpening' || command.type === 'createNote') && removedStructureIds.has(command.id))) {
    throw new Error('同一事务不能删除后重建同一结构 ID；请使用明确更新，结构删除重建不能用于历史恢复。')
  }
  return captured
}
const message = (error: unknown) => error instanceof Error ? error.message : String(error)
const canonical = (value: unknown): string => JSON.stringify(value, (_key, item: unknown) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item)
const anchorTopology = (anchor: SceneDocumentV3['notes'][string]['anchor'] | undefined) => anchor?.type === 'point' ? { type: 'point' } : anchor
const bindingKey = (binding: Pick<LicenseBinding, 'subjectKind' | 'subjectId'>) => JSON.stringify([binding.subjectKind, binding.subjectId])
const catalogCollections = ['assets', 'materials', 'propDefinitions', 'prefabDefinitions', 'styleThemes'] as const
const fixedAppearanceCollections = ['sources', 'variants', 'prefabAppearanceTemplates'] as const
const withoutKeys = (value: object, keys: readonly string[]) => Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)))
function assertAppendOnly(label: string, current: Record<string, unknown>, candidate: Record<string, unknown>) {
  for (const [id, value] of Object.entries(current)) {
    if (!Object.hasOwn(candidate, id) || canonical(value) !== canonical(candidate[id])) throw new Error(`素材入库不能删除或修改既有${label}：${id}。`)
  }
}
function invalidatedStructureIds(document: SceneDocumentV3, commands: readonly CompositionCommandV6[]): string[] {
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

export function forkProjectV6(project: CompleteProjectV6): CompleteProjectV6 {
  const result = copy(project), now = new Date().toISOString()
  Object.assign(result.document, { sceneId: newId(), revision: 0, createdAt: now, updatedAt: now, title: `${result.document.title} · 副本` })
  return result
}

/** Select the candidate's exact adopted closure; old resources stay in undo and named history. */
function restorationProject(current: CompleteProjectV6, historic: CompleteProjectV6, plan: RestorePlanV6): CompleteProjectV6 {
  const assets: CompleteProjectV6['assets'] = {}, licenses: CompleteProjectV6['licenses'] = {}
  const dependencies = inspectDependenciesV3(plan.document)
  if (dependencies.errors.length) throw new Error(dependencies.errors.map(issue => issue.message).join('；'))
  for (const id of dependencies.assetIds) {
    const hash = plan.document.assets[id].sha256
    const asset = current.assets[hash] ?? historic.assets[hash]
    if (!asset) throw new Error(`恢复所需位图缺失：${id}。`)
    assets[hash] = asset
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
  return { ...current, document: plan.document, historyIdentity: plan.historyIdentity, appearance: plan.appearance, assets, licenses, licenseBindings: [...bindings.values()] }
}

/** Diff rows describe the actual materialized result, including today's layer in source mode. */
function materializedRestorePlan(current: CompleteProjectV6, plan: RestorePlanV6, project: CompleteProjectV6): RestorePlanV6 {
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
      after.surfaceStyle = copy(surfaceStyleV6(project.document, change.id))
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

/** Owns complete history states, while all scene edits continue through strict v3 geometry. */
export class WorkspaceV6 {
  private state: WorkspaceStateV6 = { project: null, status: 'empty', error: null, canUndo: false, canRedo: false, lastTransaction: null }
  private readonly listeners = new Set<() => void>()
  private readonly compositionPreviews = new WeakMap<CompositionPreviewV6, PreviewStatus>()
  private readonly previews = new WeakMap<RestorePreviewV6, PreviewStatus>()
  private readonly structurePreviews = new WeakMap<StructureRestorePreviewV6, PreviewStatus>()
  private readonly structureContinuity = new StructureContinuitySessionV4()
  private readonly structuralInvalidations = new WeakMap<CompleteProjectV6, string[]>()
  private past: CompleteProjectV6[] = []
  private future: CompleteProjectV6[] = []
  private persistedRevision: number | null = null
  private pending: CompleteProjectV6 | null = null
  private saving: Promise<void> | null = null
  private blocked: unknown = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private copying = false
  private version = 0

  constructor(private readonly repository: WorkspaceRepositoryV6, private readonly validateCandidate: (document: SceneDocumentV3) => void = () => {}) {}
  getState = (): WorkspaceStateV6 => this.state
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  checkpoint = () => this.version
  assertCheckpoint(checkpoint: number) {
    if (checkpoint !== this.version) throw new Error('准备期间场景已有修改，已保留当前内容，请重新预览。')
  }
  private publish(patch: Partial<WorkspaceStateV6>) {
    this.state = { ...this.state, ...patch, canUndo: this.past.length > 0, canRedo: this.future.length > 0 }
    this.listeners.forEach(listener => listener())
  }
  private requireProject(): CompleteProjectV6 {
    if (!this.state.project) throw new Error('尚未打开工程。')
    return this.state.project
  }
  private install(project: CompleteProjectV6) {
    const owned = captureCompleteProjectV6(project)
    Object.assign(owned, certifyCompositionContentV6({ document: owned.document, historyIdentity: owned.historyIdentity, appearance: owned.appearance }))
    this.structureContinuity.reset(owned.document)
    this.version++
    this.past = []; this.future = []; this.pending = null; this.blocked = null
    this.persistedRevision = project.document.revision
    this.publish({ project: freeze(owned), status: 'saved', error: null, lastTransaction: null })
  }
  async adoptNew(input: CompleteProjectV6, checkpoint = this.checkpoint()) {
    const project = captureCompleteProjectV6(input)
    await validateCompleteProjectV6(project)
    this.assertCheckpoint(checkpoint)
    await this.flush()
    this.assertCheckpoint(checkpoint)
    await this.repository.save(project, null)
    this.assertCheckpoint(checkpoint)
    this.install(project)
  }
  async adoptArchive(input: HistoryArchiveV6, checkpoint = this.checkpoint()) {
    const archive = copy(input)
    await this.flush()
    this.assertCheckpoint(checkpoint)
    const imported = await this.repository.importArchive(archive)
    this.assertCheckpoint(checkpoint)
    this.install(imported.project)
    return imported
  }
  async openPersisted(input: CompleteProjectV6, checkpoint = this.checkpoint()) {
    const project = captureCompleteProjectV6(input)
    await validateCompleteProjectV6(project)
    this.assertCheckpoint(checkpoint)
    if (project.document.sceneId === this.state.project?.document.sceneId && project.document.revision < this.state.project.document.revision) {
      throw new Error('载入结果早于当前编辑修订，已保留当前内容。')
    }
    await this.flush()
    this.assertCheckpoint(checkpoint)
    this.install(project)
  }
  private enqueue(project: CompleteProjectV6) {
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
          await this.repository.save(snapshot, this.persistedRevision)
          this.persistedRevision = snapshot.document.revision
          this.publish({ status: this.pending ? 'unsaved' : 'saved', error: null })
        } catch (error) {
          this.pending = this.pending ?? snapshot; this.blocked = error
          this.publish({ status: error instanceof Error && error.name === 'ConflictErrorV6' ? 'conflict' : 'error', error: message(error) })
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
    const checkpoint = this.checkpoint()
    await this.flush()
    this.assertCheckpoint(checkpoint)
    const current = this.state.project
    if (!current) return
    // Reset the existing witness owner so even previously issued proofs expire.
    this.structureContinuity.reset(current.document)
    this.version++
    this.past = []; this.future = []; this.pending = null; this.blocked = null
    this.persistedRevision = null
    this.publish({ project: null, status: 'empty', error: null, lastTransaction: null })
  }
  async retry() { this.blocked = null; await this.flush() }
  async saveAsCopy() {
    const checkpoint = this.checkpoint(), project = forkProjectV6(this.requireProject())
    if (this.copying) throw new Error('正在保存独立副本，请稍后重试。')
    if (this.timer) { clearTimeout(this.timer); this.timer = null }
    this.copying = true
    try {
      if (this.saving) await this.saving.catch(() => {})
      this.assertCheckpoint(checkpoint)
      await validateCompleteProjectV6(project)
      await this.repository.save(project, null)
      this.assertCheckpoint(checkpoint)
      this.install(project)
    } finally {
      this.copying = false
      if (this.pending && !this.blocked) this.timer = setTimeout(() => { this.timer = null; void this.startSave().catch(() => {}) }, 120)
    }
  }
  private commit(candidate: CompleteProjectV6, history: 'edit' | 'undo' | 'redo') {
    const current = this.requireProject(), checkpoint = this.checkpoint()
    const historyIdentity = mergeIdentityRecordsV6(candidate.historyIdentity, [current.historyIdentity])
    const content = reviseCompositionContentV6({ document: candidate.document, historyIdentity: candidate.historyIdentity, appearance: candidate.appearance },
      current.document.revision + 1, new Date().toISOString(), historyIdentity)
    this.validateCandidate(content.document)
    this.assertCheckpoint(checkpoint)
    const next = freeze({ ...candidate, ...content })
    this.structureContinuity.advance(current.document, content.document, this.structuralInvalidations.get(candidate))
    if (history === 'edit') { this.past.push(current); this.future = [] }
    else if (history === 'undo') { this.past.pop(); this.future.push(current) }
    else { this.future.pop(); this.past.push(current) }
    this.version++
    this.enqueue(next)
  }
  private assertCandidateBaseline(candidate: CompleteProjectV6, checkpoint: number) {
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
    if (canonical(candidate.migrationSource) !== canonical(current.migrationSource)) throw new Error('候选不能替换工程迁移来源。')
  }
  private assertCatalogImport(candidate: CompleteProjectV6, checkpoint: number) {
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
  async previewPrepared(input: CompleteProjectV6, description = '素材入库', checkpoint = this.checkpoint()): Promise<CompositionPreviewV6> {
    const candidate = captureCompleteProjectV6(input)
    this.assertCatalogImport(candidate, checkpoint)
    return this.registerPrepared(candidate, description, checkpoint)
  }
  /** Only the command preparation path may register candidates that change scene semantics. */
  private async registerPrepared(input: CompleteProjectV6, description: string, checkpoint: number, commands: readonly CompositionCommandV6[] = []): Promise<CompositionPreviewV6> {
    this.assertCandidateBaseline(input, checkpoint)
    const candidate = await captureValidatedProjectV6(input)
    this.assertCandidateBaseline(candidate, checkpoint)
    Object.assign(candidate, certifyCompositionContentV6({ document: candidate.document, historyIdentity: candidate.historyIdentity, appearance: candidate.appearance }))
    this.validateCandidate(candidate.document)
    projectSceneV3(candidate.document, 'player')
    this.assertCheckpoint(checkpoint)
    const project = freeze(candidate)
    const preview = freeze({ project, document: project.document, commands, description, checkpoint,
      currentSceneId: project.document.sceneId, currentRevision: project.document.revision })
    this.compositionPreviews.set(preview, 'active')
    return preview
  }
  async preview(commands: readonly CompositionCommandV6[]): Promise<CompositionPreviewV6> {
    const current = this.requireProject(), checkpoint = this.checkpoint(), frozenCommands = captureCommands(commands)
    const candidate = await prepareCompositionCommandsV6(current, frozenCommands)
    this.assertCheckpoint(checkpoint)
    const preview = await this.registerPrepared(candidate, '场景与外观修改', checkpoint, frozenCommands)
    this.structuralInvalidations.set(preview.project, invalidatedStructureIds(current.document, frozenCommands))
    return preview
  }
  cancelPreview(preview: CompositionPreviewV6) {
    if (this.compositionPreviews.has(preview)) this.compositionPreviews.set(preview, 'cancelled')
  }
  private assertPreview(preview: CompositionPreviewV6) {
    if (!['active', 'applying'].includes(this.compositionPreviews.get(preview) ?? '')) throw new Error('修改预览已取消、已采用或并非当前工作区创建。')
    this.assertCandidateBaseline(preview.project, preview.checkpoint)
  }
  async adoptPreview(preview: CompositionPreviewV6): Promise<void> {
    if (this.compositionPreviews.get(preview) !== 'active') throw new Error('修改预览不可重复采用。')
    this.assertPreview(preview)
    this.compositionPreviews.set(preview, 'applying')
    try {
      await captureValidatedProjectV6(preview.project)
      this.assertPreview(preview)
      this.validateCandidate(preview.project.document)
      this.assertPreview(preview)
      const current = this.requireProject()
      if (canonical({ document: current.document, appearance: current.appearance, identity: current.historyIdentity })
        !== canonical({ document: preview.project.document, appearance: preview.project.appearance, identity: preview.project.historyIdentity })) {
        this.commit(preview.project, 'edit')
      }
      this.compositionPreviews.set(preview, 'applied')
    } catch (error) { this.compositionPreviews.set(preview, 'cancelled'); throw error }
  }
  async execute(commands: readonly CompositionCommandV6[]): Promise<void> {
    const current = this.requireProject(), checkpoint = this.checkpoint(), frozenCommands = captureCommands(commands)
    // Preparation fully validates both the captured input and the materialized
    // candidate. Only validator-owned immutable byte/original closures are reused.
    // Immediate commands have no user-visible preview lifetime to register/recheck.
    const prepared = await prepareCompositionCommandsV6(current, frozenCommands)
    this.assertCandidateBaseline(prepared, checkpoint)
    const candidate = captureCompleteProjectV6(prepared)
    Object.assign(candidate, certifyCompositionContentV6({ document: candidate.document, historyIdentity: candidate.historyIdentity, appearance: candidate.appearance }))
    this.validateCandidate(candidate.document)
    projectSceneV3(candidate.document, 'player')
    this.assertCandidateBaseline(candidate, checkpoint)
    if (canonical({ document: current.document, appearance: current.appearance, identity: current.historyIdentity })
      !== canonical({ document: candidate.document, appearance: candidate.appearance, identity: candidate.historyIdentity })) {
      this.structuralInvalidations.set(candidate, invalidatedStructureIds(current.document, frozenCommands))
      this.commit(freeze(candidate), 'edit')
    }
  }
  updateProp(id: string, changes: { positionMm?: { x: number; y: number }; rotationDeg?: number }) { return this.execute([{ type: 'updateProp', id, changes }]) }
  rotateRoomMaterial(id: string, rotationDeg: number) { return this.execute([{ type: 'setSurfacePaint', kind: 'room', id, changes: { rotationDeg } }]) }
  detachPrefabMember(groupId: string, propId: string) { return this.execute([{ type: 'detachPrefabMember', groupId, propId }]) }
  resetPrefabMember(groupId: string, key: string, newId?: string, supportRef?: SurfaceRef) { return this.execute([{ type: 'resetPrefabMember', groupId, key, ...(newId ? { newId } : {}), ...(supportRef ? { supportRef } : {}) }]) }
  removePrefabMember(id: string) { return this.execute([{ type: 'deleteProp', id }]) }
  private restoreHistory(candidate: CompleteProjectV6, history: 'undo' | 'redo') {
    const current = this.requireProject(), checkpoint = this.checkpoint()
    const historyIdentity = advanceHistoryIdentityV6(current.historyIdentity, current.document, candidate.document, { allowResurrection: true })
    this.validateCandidate(candidate.document)
    this.assertCheckpoint(checkpoint)
    this.commit({ ...candidate, historyIdentity }, history)
  }
  undo() { const previous = this.past.at(-1); if (previous) this.restoreHistory(previous, 'undo') }
  redo() { const next = this.future.at(-1); if (next) this.restoreHistory(next, 'redo') }

  async createNamedSnapshot(name: string) {
    const checkpoint = this.checkpoint(), project = this.requireProject()
    await this.flush()
    this.assertCheckpoint(checkpoint)
    const usage = await this.repository.usage(project.document.sceneId)
    this.assertCheckpoint(checkpoint)
    const snapshot = await this.repository.createNamedSnapshot(project, name, {
      kind: 'named', expectedRevision: project.document.revision, expectedMetadataVersion: usage.metadataVersion,
    })
    this.assertCheckpoint(checkpoint)
    this.structureContinuity.recordSnapshot(snapshot.id, snapshot.contentHash, project.document)
    return snapshot
  }
  private restoreEvidence(snapshot: NamedSnapshotV6, request: RestoreRequestV6) {
    const current = this.requireProject()
    const structuralSurface = request.mode !== 'layer' && request.ids.some(id =>
      (current.appearance.surfaceSources[id] || snapshot.project.appearance.surfaceSources[id])
      && (current.document.rooms[id] || current.document.walls[id] || snapshot.project.document.rooms[id] || snapshot.project.document.walls[id]))
    return structuralSurface ? { surfaceContinuity: this.structureContinuity.prove(snapshot.id, snapshot.contentHash, current.document, snapshot.project.document) } : {}
  }
  async prepareRestore(snapshotId: string, request: RestoreRequestV6): Promise<RestorePreviewV6> {
    const current = this.requireProject(), checkpoint = this.checkpoint(), frozenRequest = copy(request)
    const snapshot = await this.repository.loadNamedSnapshot(snapshotId, current.document.sceneId)
    this.assertCheckpoint(checkpoint)
    if (!snapshot) throw new Error('源快照已被删除，请重新选择。')
    const plan = buildRestorePlanV6(current, snapshot.project, frozenRequest, this.restoreEvidence(snapshot, frozenRequest))
    this.validateCandidate(plan.document)
    this.assertCheckpoint(checkpoint)
    const project = await materializeProjectV6(restorationProject(current, snapshot.project, plan))
    this.assertCheckpoint(checkpoint)
    await validateCompleteProjectV6(project)
    this.assertCheckpoint(checkpoint)
    this.validateCandidate(project.document)
    projectSceneV3(project.document, 'player')
    const finalPlan = materializedRestorePlan(current, plan, project)
    const { project: _project, ...summary } = snapshot
    const preview = freeze({ snapshot: summary, plan: finalPlan, project, checkpoint, currentSceneId: current.document.sceneId,
      currentRevision: current.document.revision, sourceContentHash: snapshot.contentHash })
    this.previews.set(preview, 'active')
    return preview
  }
  cancelRestore(preview: RestorePreviewV6) {
    if (this.previews.has(preview)) this.previews.set(preview, 'cancelled')
  }
  private assertRestore(preview: RestorePreviewV6) {
    if (!['active', 'applying'].includes(this.previews.get(preview) ?? '')) throw new Error('恢复预览已取消、已采用或并非当前工作区创建。')
    this.assertCheckpoint(preview.checkpoint)
    const current = this.requireProject()
    if (current.document.sceneId !== preview.currentSceneId || current.document.revision !== preview.currentRevision) throw new Error('恢复基线已变化，请重新预览。')
  }
  async applyRestore(preview: RestorePreviewV6) {
    if (this.previews.get(preview) !== 'active') throw new Error('恢复预览不可重复采用。')
    this.assertRestore(preview)
    if (!preview.plan.changed) throw new Error('所选属性与快照一致，无需恢复。')
    this.previews.set(preview, 'applying')
    try {
      await this.flush()
      this.assertRestore(preview)
      const source = await this.repository.loadNamedSnapshot(preview.snapshot.id, preview.currentSceneId)
      this.assertRestore(preview)
      if (!source || source.contentHash !== preview.sourceContentHash) throw new Error('源快照已删除或内容校验值已变化，请重新预览。')
      const current = this.requireProject()
      const plan = buildRestorePlanV6(current, source.project, preview.plan.request, this.restoreEvidence(source, preview.plan.request))
      this.validateCandidate(plan.document)
      this.assertRestore(preview)
      const candidate = await materializeProjectV6(restorationProject(current, source.project, plan))
      this.assertRestore(preview)
      await validateCompleteProjectV6(candidate)
      this.assertRestore(preview)
      this.validateCandidate(candidate.document)
      projectSceneV3(candidate.document, 'player')
      // Check revision capacity before persisting a protection snapshot.
      reviseSceneSnapshotV3(candidate.document, current.document.revision + 1, new Date().toISOString())
      const usage = await this.repository.usage(preview.currentSceneId)
      this.assertRestore(preview)
      let protectionName = '恢复前 · '
      for (const character of source.name) { if ((protectionName + character).length > 80) break; protectionName += character }
      const protection = await this.repository.createNamedSnapshot(current, protectionName, {
        kind: 'protection', expectedRevision: current.document.revision, expectedMetadataVersion: usage.metadataVersion,
        sourceSnapshot: { id: source.id, contentHash: preview.sourceContentHash },
      })
      this.assertRestore(preview)
      this.structureContinuity.recordSnapshot(protection.id, protection.contentHash, current.document)
      const retained = await this.repository.loadNamedSnapshot(preview.snapshot.id, preview.currentSceneId)
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
  async inspectStructureRestore(snapshotId: string, request: StructureRestoreRequestV4): Promise<StructureRestoreInspectionV6> {
    const current = this.requireProject(), checkpoint = this.checkpoint(), frozenRequest = copy(request)
    const snapshot = await this.repository.loadNamedSnapshot(snapshotId, current.document.sceneId)
    this.assertCheckpoint(checkpoint)
    if (!snapshot) throw new Error('源快照已被删除，请重新选择。')
    const continuity = this.structureContinuity.prove(snapshot.id, snapshot.contentHash, current.document, snapshot.project.document)
    const scope = inspectStructureRestoreScopeV4(current.document, toHistoryIdentityV4(current.historyIdentity, current.document), snapshot.project.document, toHistoryIdentityV4(snapshot.project.historyIdentity, snapshot.project.document), frozenRequest, continuity)
    const { project: _project, ...summary } = snapshot
    return freeze({ snapshot: summary, scope, checkpoint, currentRevision: current.document.revision, sourceContentHash: snapshot.contentHash })
  }

  async prepareStructureRestore(snapshotId: string, request: StructureRestoreRequestV4): Promise<StructureRestorePreviewV6> {
    const current = this.requireProject(), checkpoint = this.checkpoint(), frozenRequest = copy(request)
    const snapshot = await this.repository.loadNamedSnapshot(snapshotId, current.document.sceneId)
    this.assertCheckpoint(checkpoint)
    if (!snapshot) throw new Error('源快照已被删除，请重新选择。')
    const continuity = this.structureContinuity.prove(snapshot.id, snapshot.contentHash, current.document, snapshot.project.document)
    const plan = buildStructureRestorePlanV4(current.document, toHistoryIdentityV4(current.historyIdentity, current.document), snapshot.project.document, toHistoryIdentityV4(snapshot.project.historyIdentity, snapshot.project.document), frozenRequest, continuity)
    this.validateCandidate(plan.document)
    this.assertCheckpoint(checkpoint)
    // C2 restores geometry/business fields only, so the exact current resource and license closure remains authoritative.
    const project = { ...current, document: plan.document, historyIdentity: mergeHistoryIdentitiesV6(current.historyIdentity, current.document, snapshot.project.historyIdentity, snapshot.project.document) }
    await validateCompleteProjectV6(project)
    this.assertCheckpoint(checkpoint)
    const { project: _project, ...summary } = snapshot
    const preview = freeze({ snapshot: summary, plan, project, checkpoint, currentSceneId: current.document.sceneId,
      currentRevision: current.document.revision, sourceContentHash: snapshot.contentHash })
    this.structurePreviews.set(preview, 'active')
    return preview
  }

  cancelStructureRestore(preview: StructureRestorePreviewV6) {
    if (this.structurePreviews.has(preview)) this.structurePreviews.set(preview, 'cancelled')
  }

  private assertStructureRestore(preview: StructureRestorePreviewV6) {
    if (!['active', 'applying'].includes(this.structurePreviews.get(preview) ?? '')) throw new Error('结构恢复预览已取消、已采用或并非当前工作区创建。')
    this.assertCheckpoint(preview.checkpoint)
    const current = this.requireProject()
    if (current.document.sceneId !== preview.currentSceneId || current.document.revision !== preview.currentRevision) throw new Error('结构恢复基线已变化，请重新预览。')
  }

  async applyStructureRestore(preview: StructureRestorePreviewV6) {
    if (this.structurePreviews.get(preview) !== 'active') throw new Error('结构恢复预览不可重复采用。')
    this.assertStructureRestore(preview)
    if (!preview.plan.changed) throw new Error('所选结构属性与快照一致，无需恢复。')
    this.structurePreviews.set(preview, 'applying')
    try {
      await this.flush()
      this.assertStructureRestore(preview)
      const source = await this.repository.loadNamedSnapshot(preview.snapshot.id, preview.currentSceneId)
      this.assertStructureRestore(preview)
      if (!source || source.contentHash !== preview.sourceContentHash) throw new Error('源快照已删除或内容校验值已变化，请重新预览。')
      const current = this.requireProject()
      const continuity = this.structureContinuity.prove(source.id, source.contentHash, current.document, source.project.document)
      const plan = buildStructureRestorePlanV4(current.document, toHistoryIdentityV4(current.historyIdentity, current.document), source.project.document, toHistoryIdentityV4(source.project.historyIdentity, source.project.document), preview.plan.request, continuity)
      this.validateCandidate(plan.document)
      this.assertStructureRestore(preview)
      const candidate = { ...current, document: plan.document, historyIdentity: mergeHistoryIdentitiesV6(current.historyIdentity, current.document, source.project.historyIdentity, source.project.document) }
      await validateCompleteProjectV6(candidate)
      this.assertStructureRestore(preview)
      reviseSceneSnapshotV3(candidate.document, current.document.revision + 1, new Date().toISOString())
      const usage = await this.repository.usage(preview.currentSceneId)
      this.assertStructureRestore(preview)
      let protectionName = '结构恢复前 · '
      for (const character of source.name) { if ((protectionName + character).length > 80) break; protectionName += character }
      const protection = await this.repository.createNamedSnapshot(current, protectionName, {
        kind: 'protection', expectedRevision: current.document.revision, expectedMetadataVersion: usage.metadataVersion,
        sourceSnapshot: { id: source.id, contentHash: preview.sourceContentHash },
      })
      this.assertStructureRestore(preview)
      this.structureContinuity.recordSnapshot(protection.id, protection.contentHash, current.document)
      const retained = await this.repository.loadNamedSnapshot(preview.snapshot.id, preview.currentSceneId)
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
