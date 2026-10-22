import { newId } from '../../core/types'
import { applySnapshotCommandsV3, type SceneCommandV3 } from '../../core/v3/commands'
import { inspectDependenciesV3 } from '../../core/v3/dependencies'
import { reviseSceneSnapshotV3, validateSceneSnapshotV3 } from '../../core/v3/snapshots'
import type { SceneDocumentV3 } from '../../core/v3/types'
import { advanceHistoryIdentityV4, validateHistoryIdentityV4 } from '../../core/v4/identity'
import { buildRestorePlanV4 } from '../../core/v4/restore'
import { StructureContinuitySessionV4 } from '../../core/v4/structure-continuity'
import { buildStructureRestorePlanV4, inspectStructureRestoreScopeV4, type StructureRestorePlanV4, type StructureRestoreRequestV4, type StructureRestoreScopeV4 } from '../../core/v4/structure-restore'
import type { RestorePlanV4, RestoreRequestV4 } from '../../core/v4/types'
import { validateCompleteProjectV4 } from '../../io/v4/project-file'
import type { SceneRepositoryV4 } from '../../io/v4/storage'
import type { CompleteProjectV4, HistoryArchiveV4, LicenseBinding, NamedSnapshotSummaryV4 } from '../../io/v4/types'

export type WorkspaceRepositoryV4 = Pick<SceneRepositoryV4,
  'save' | 'loadNamedSnapshot' | 'createNamedSnapshot' | 'usage' | 'importArchive'>
type SaveStatus = 'empty' | 'saved' | 'unsaved' | 'saving' | 'error' | 'conflict'
export interface WorkspaceStateV4 {
  project: CompleteProjectV4 | null
  status: SaveStatus
  error: string | null
  canUndo: boolean
  canRedo: boolean
}
export interface RestorePreviewV4 {
  snapshot: NamedSnapshotSummaryV4
  plan: RestorePlanV4
  project: CompleteProjectV4
  checkpoint: number
  currentSceneId: string
  currentRevision: number
  sourceContentHash: string
}
export interface StructureRestorePreviewV4 extends Omit<RestorePreviewV4, 'plan'> {
  plan: StructureRestorePlanV4
}
export interface StructureRestoreInspectionV4 {
  snapshot: NamedSnapshotSummaryV4
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
const message = (error: unknown) => error instanceof Error ? error.message : String(error)
const canonical = (value: unknown): string => JSON.stringify(value, (_key, item: unknown) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item)
const anchorTopology = (anchor: SceneDocumentV3['notes'][string]['anchor'] | undefined) => anchor?.type === 'point' ? { type: 'point' } : anchor
const bindingKey = (binding: Pick<LicenseBinding, 'subjectKind' | 'subjectId'>) => JSON.stringify([binding.subjectKind, binding.subjectId])
function invalidatedStructureIds(document: SceneDocumentV3, commands: readonly SceneCommandV3[]): string[] {
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

export function forkProjectV4(project: CompleteProjectV4): CompleteProjectV4 {
  const result = copy(project), now = new Date().toISOString()
  Object.assign(result.document, { sceneId: newId(), revision: 0, createdAt: now, updatedAt: now, title: `${result.document.title} · 副本` })
  return result
}

/** Select the candidate's exact adopted closure; old resources stay in undo and named history. */
function restorationProject(current: CompleteProjectV4, historic: CompleteProjectV4, plan: RestorePlanV4): CompleteProjectV4 {
  const assets: CompleteProjectV4['assets'] = {}, licenses: CompleteProjectV4['licenses'] = {}
  const dependencies = inspectDependenciesV3(plan.document)
  if (dependencies.errors.length) throw new Error(dependencies.errors.map(issue => issue.message).join('；'))
  for (const id of dependencies.assetIds) {
    const hash = plan.document.assets[id].sha256
    const asset = current.assets[hash] ?? historic.assets[hash]
    if (!asset) throw new Error(`恢复所需位图缺失：${id}。`)
    assets[hash] = asset
  }
  const adoptedHistoricSubjects = new Set<string>()
  if (plan.request.mode !== 'transform') for (const id of plan.request.ids) {
    const prop = historic.document.props[id]
    if (prop.definitionRef) {
      adoptedHistoricSubjects.add(bindingKey({ subjectKind: 'propDefinition', subjectId: prop.definitionRef.id }))
      const definition = historic.document.propDefinitions[prop.definitionRef.id]
      if (definition.defaultAppearance.kind === 'image') adoptedHistoricSubjects.add(bindingKey({ subjectKind: 'asset', subjectId: definition.defaultAppearance.assetId }))
    }
    if (prop.appearance.kind === 'image') adoptedHistoricSubjects.add(bindingKey({ subjectKind: 'asset', subjectId: prop.appearance.assetId }))
  }
  const currentBindings = new Map(current.licenseBindings.map(binding => [bindingKey(binding), binding]))
  const historicBindings = new Map(historic.licenseBindings.map(binding => [bindingKey(binding), binding]))
  const bindings = new Map<string, LicenseBinding>()
  for (const subject of dependencies.subjects) {
    const key = bindingKey(subject)
    const before = currentBindings.get(key)
    const after = adoptedHistoricSubjects.has(key) ? historicBindings.get(key) : undefined
    if (before && after && canonical(before) !== canonical(after)) throw new Error(`恢复许可主体存在固定版本冲突：${subject.subjectId}。`)
    const binding = before ?? after
    if (!binding) throw new Error(`恢复所需许可绑定缺失：${subject.subjectId}。`)
    bindings.set(key, binding)
    const hash = binding.licensePath.slice(9, -4), license = current.licenses[hash] ?? historic.licenses[hash]
    if (!license) throw new Error(`恢复所需许可文本缺失：${subject.subjectId}。`)
    licenses[hash] = license
  }
  return { ...current, document: plan.document, historyIdentity: plan.historyIdentity, assets, licenses, licenseBindings: [...bindings.values()] }
}

/** Owns complete history states, while all scene edits continue through strict v3 geometry. */
export class WorkspaceV4 {
  private state: WorkspaceStateV4 = { project: null, status: 'empty', error: null, canUndo: false, canRedo: false }
  private readonly listeners = new Set<() => void>()
  private readonly previews = new WeakMap<RestorePreviewV4, PreviewStatus>()
  private readonly structurePreviews = new WeakMap<StructureRestorePreviewV4, PreviewStatus>()
  private readonly structureContinuity = new StructureContinuitySessionV4()
  private readonly structuralInvalidations = new WeakMap<CompleteProjectV4, string[]>()
  private past: CompleteProjectV4[] = []
  private future: CompleteProjectV4[] = []
  private persistedRevision: number | null = null
  private pending: CompleteProjectV4 | null = null
  private saving: Promise<void> | null = null
  private blocked: unknown = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private copying = false
  private version = 0

  constructor(private readonly repository: WorkspaceRepositoryV4, private readonly validateCandidate: (document: SceneDocumentV3) => void = () => {}) {}
  getState = (): WorkspaceStateV4 => this.state
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  checkpoint = () => this.version
  assertCheckpoint(checkpoint: number) {
    if (checkpoint !== this.version) throw new Error('准备期间场景已有修改，已保留当前内容，请重新预览。')
  }
  private publish(patch: Partial<WorkspaceStateV4>) {
    this.state = { ...this.state, ...patch, canUndo: this.past.length > 0, canRedo: this.future.length > 0 }
    this.listeners.forEach(listener => listener())
  }
  private requireProject(): CompleteProjectV4 {
    if (!this.state.project) throw new Error('尚未打开工程。')
    return this.state.project
  }
  private install(project: CompleteProjectV4) {
    const owned = copy(project), checked = validateSceneSnapshotV3(owned.document)
    if (!checked.ok) throw new Error(checked.errors.map(error => error.message).join('；'))
    owned.document = checked.document
    owned.historyIdentity = validateHistoryIdentityV4(owned.historyIdentity, owned.document)
    this.structureContinuity.reset(owned.document)
    this.version++
    this.past = []; this.future = []; this.pending = null; this.blocked = null
    this.persistedRevision = project.document.revision
    this.publish({ project: freeze(owned), status: 'saved', error: null })
  }
  async adoptNew(input: CompleteProjectV4, checkpoint = this.checkpoint()) {
    const project = copy(input)
    await validateCompleteProjectV4(project)
    this.assertCheckpoint(checkpoint)
    await this.flush()
    this.assertCheckpoint(checkpoint)
    await this.repository.save(project, null)
    this.assertCheckpoint(checkpoint)
    this.install(project)
  }
  async adoptArchive(input: HistoryArchiveV4, checkpoint = this.checkpoint()) {
    const archive = copy(input)
    await this.flush()
    this.assertCheckpoint(checkpoint)
    const imported = await this.repository.importArchive(archive)
    this.assertCheckpoint(checkpoint)
    this.install(imported.project)
    return imported
  }
  async openPersisted(input: CompleteProjectV4, checkpoint = this.checkpoint()) {
    const project = copy(input)
    await validateCompleteProjectV4(project)
    this.assertCheckpoint(checkpoint)
    if (project.document.sceneId === this.state.project?.document.sceneId && project.document.revision < this.state.project.document.revision) {
      throw new Error('载入结果早于当前编辑修订，已保留当前内容。')
    }
    await this.flush()
    this.assertCheckpoint(checkpoint)
    this.install(project)
  }
  private enqueue(project: CompleteProjectV4) {
    this.pending = project
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (!this.blocked && !this.copying) this.timer = setTimeout(() => { this.timer = null; void this.startSave().catch(() => {}) }, 120)
    this.publish({ project, status: this.blocked ? this.state.status : 'unsaved', error: this.blocked ? this.state.error : null })
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
          this.publish({ status: error instanceof Error && error.name === 'ConflictErrorV4' ? 'conflict' : 'error', error: message(error) })
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
  async retry() { this.blocked = null; await this.flush() }
  async saveAsCopy() {
    const checkpoint = this.checkpoint(), project = forkProjectV4(this.requireProject())
    if (this.copying) throw new Error('正在保存独立副本，请稍后重试。')
    if (this.timer) { clearTimeout(this.timer); this.timer = null }
    this.copying = true
    try {
      if (this.saving) await this.saving.catch(() => {})
      this.assertCheckpoint(checkpoint)
      await validateCompleteProjectV4(project)
      await this.repository.save(project, null)
      this.assertCheckpoint(checkpoint)
      this.install(project)
    } finally {
      this.copying = false
      if (this.pending && !this.blocked) this.timer = setTimeout(() => { this.timer = null; void this.startSave().catch(() => {}) }, 120)
    }
  }
  private commit(candidate: CompleteProjectV4, history: 'edit' | 'undo' | 'redo') {
    const current = this.requireProject()
    const document = reviseSceneSnapshotV3(candidate.document, current.document.revision + 1, new Date().toISOString())
    const historyIdentity = advanceHistoryIdentityV4(candidate.historyIdentity, current.document, document, { allowResurrection: true })
    const next = freeze({ ...candidate, document, historyIdentity })
    this.structureContinuity.advance(current.document, document, this.structuralInvalidations.get(candidate))
    if (history === 'edit') { this.past.push(current); this.future = [] }
    else if (history === 'undo') { this.past.pop(); this.future.push(current) }
    else { this.future.pop(); this.past.push(current) }
    this.version++
    this.enqueue(next)
  }
  private candidate(commands: readonly SceneCommandV3[]): CompleteProjectV4 {
    const current = this.requireProject(), checkpoint = this.checkpoint()
    const document = applySnapshotCommandsV3(current.document, commands)
    const removedStructureIds = new Set(commands.flatMap(command => command.type === 'deleteOpening' || command.type === 'deleteNote' ? [command.id] : []))
    if (commands.some(command => (command.type === 'addOpening' || command.type === 'createNote') && removedStructureIds.has(command.id))) {
      throw new Error('同一事务不能删除后重建同一结构 ID；请使用明确更新，结构删除重建不能用于历史恢复。')
    }
    if (document === current.document) return current
    for (const command of commands) {
      const id = command.type === 'addProp' ? command.id : command.type === 'copyProp' ? command.newId : null
      if (id && Object.hasOwn(current.historyIdentity.propTokens, id)) throw new Error(`物件身份已分配，不能用于新物件：${id}。`)
    }
    const historyIdentity = advanceHistoryIdentityV4(current.historyIdentity, current.document, document,
      { allowResurrection: commands.some(command => command.type === 'regenerateScatter') })
    this.validateCandidate(document)
    this.assertCheckpoint(checkpoint)
    const candidate = freeze({ ...current, document, historyIdentity })
    // A delete and recreate in one atomic batch must not regain a preexisting structural identity.
    this.structuralInvalidations.set(candidate, invalidatedStructureIds(current.document, commands))
    return candidate
  }
  preview(commands: readonly SceneCommandV3[]): SceneDocumentV3 { return this.candidate(commands).document }
  execute(commands: readonly SceneCommandV3[]) {
    const candidate = this.candidate(commands)
    if (candidate !== this.state.project) this.commit(candidate, 'edit')
  }
  updateProp(id: string, changes: { positionMm?: { x: number; y: number }; rotationDeg?: number }) { this.execute([{ type: 'updateProp', id, changes }]) }
  rotateRoomMaterial(id: string, rotationDeg: number) { this.execute([{ type: 'setSurfacePaint', kind: 'room', id, changes: { rotationDeg } }]) }
  private restoreHistory(candidate: CompleteProjectV4, history: 'undo' | 'redo') {
    const current = this.requireProject(), checkpoint = this.checkpoint()
    const historyIdentity = advanceHistoryIdentityV4(current.historyIdentity, current.document, candidate.document, { allowResurrection: true })
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
  async prepareRestore(snapshotId: string, request: RestoreRequestV4): Promise<RestorePreviewV4> {
    const current = this.requireProject(), checkpoint = this.checkpoint(), frozenRequest = copy(request)
    const snapshot = await this.repository.loadNamedSnapshot(snapshotId, current.document.sceneId)
    this.assertCheckpoint(checkpoint)
    if (!snapshot) throw new Error('源快照已被删除，请重新选择。')
    const plan = buildRestorePlanV4(current.document, current.historyIdentity, snapshot.project.document, snapshot.project.historyIdentity, frozenRequest)
    this.validateCandidate(plan.document)
    this.assertCheckpoint(checkpoint)
    const project = restorationProject(current, snapshot.project, plan)
    await validateCompleteProjectV4(project)
    this.assertCheckpoint(checkpoint)
    const { project: _project, ...summary } = snapshot
    const preview = freeze({ snapshot: summary, plan, project, checkpoint, currentSceneId: current.document.sceneId,
      currentRevision: current.document.revision, sourceContentHash: snapshot.contentHash })
    this.previews.set(preview, 'active')
    return preview
  }
  cancelRestore(preview: RestorePreviewV4) {
    if (this.previews.has(preview)) this.previews.set(preview, 'cancelled')
  }
  private assertRestore(preview: RestorePreviewV4) {
    if (!['active', 'applying'].includes(this.previews.get(preview) ?? '')) throw new Error('恢复预览已取消、已采用或并非当前工作区创建。')
    this.assertCheckpoint(preview.checkpoint)
    const current = this.requireProject()
    if (current.document.sceneId !== preview.currentSceneId || current.document.revision !== preview.currentRevision) throw new Error('恢复基线已变化，请重新预览。')
  }
  async applyRestore(preview: RestorePreviewV4) {
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
      const plan = buildRestorePlanV4(current.document, current.historyIdentity, source.project.document, source.project.historyIdentity, preview.plan.request)
      this.validateCandidate(plan.document)
      this.assertRestore(preview)
      const candidate = restorationProject(current, source.project, plan)
      await validateCompleteProjectV4(candidate)
      this.assertRestore(preview)
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
      this.previews.set(preview, 'applied')
      this.commit(candidate, 'edit')
      return protection
    } catch (error) {
      this.previews.set(preview, 'cancelled')
      throw error
    }
  }

  /** Inspect dependency expansion before the user explicitly confirms it. */
  async inspectStructureRestore(snapshotId: string, request: StructureRestoreRequestV4): Promise<StructureRestoreInspectionV4> {
    const current = this.requireProject(), checkpoint = this.checkpoint(), frozenRequest = copy(request)
    const snapshot = await this.repository.loadNamedSnapshot(snapshotId, current.document.sceneId)
    this.assertCheckpoint(checkpoint)
    if (!snapshot) throw new Error('源快照已被删除，请重新选择。')
    const continuity = this.structureContinuity.prove(snapshot.id, snapshot.contentHash, current.document, snapshot.project.document)
    const scope = inspectStructureRestoreScopeV4(current.document, current.historyIdentity, snapshot.project.document, snapshot.project.historyIdentity, frozenRequest, continuity)
    const { project: _project, ...summary } = snapshot
    return freeze({ snapshot: summary, scope, checkpoint, currentRevision: current.document.revision, sourceContentHash: snapshot.contentHash })
  }

  async prepareStructureRestore(snapshotId: string, request: StructureRestoreRequestV4): Promise<StructureRestorePreviewV4> {
    const current = this.requireProject(), checkpoint = this.checkpoint(), frozenRequest = copy(request)
    const snapshot = await this.repository.loadNamedSnapshot(snapshotId, current.document.sceneId)
    this.assertCheckpoint(checkpoint)
    if (!snapshot) throw new Error('源快照已被删除，请重新选择。')
    const continuity = this.structureContinuity.prove(snapshot.id, snapshot.contentHash, current.document, snapshot.project.document)
    const plan = buildStructureRestorePlanV4(current.document, current.historyIdentity, snapshot.project.document, snapshot.project.historyIdentity, frozenRequest, continuity)
    this.validateCandidate(plan.document)
    this.assertCheckpoint(checkpoint)
    // C2 restores geometry/business fields only, so the exact current resource and license closure remains authoritative.
    const project = { ...current, document: plan.document, historyIdentity: plan.historyIdentity }
    await validateCompleteProjectV4(project)
    this.assertCheckpoint(checkpoint)
    const { project: _project, ...summary } = snapshot
    const preview = freeze({ snapshot: summary, plan, project, checkpoint, currentSceneId: current.document.sceneId,
      currentRevision: current.document.revision, sourceContentHash: snapshot.contentHash })
    this.structurePreviews.set(preview, 'active')
    return preview
  }

  cancelStructureRestore(preview: StructureRestorePreviewV4) {
    if (this.structurePreviews.has(preview)) this.structurePreviews.set(preview, 'cancelled')
  }

  private assertStructureRestore(preview: StructureRestorePreviewV4) {
    if (!['active', 'applying'].includes(this.structurePreviews.get(preview) ?? '')) throw new Error('结构恢复预览已取消、已采用或并非当前工作区创建。')
    this.assertCheckpoint(preview.checkpoint)
    const current = this.requireProject()
    if (current.document.sceneId !== preview.currentSceneId || current.document.revision !== preview.currentRevision) throw new Error('结构恢复基线已变化，请重新预览。')
  }

  async applyStructureRestore(preview: StructureRestorePreviewV4) {
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
      const plan = buildStructureRestorePlanV4(current.document, current.historyIdentity, source.project.document, source.project.historyIdentity, preview.plan.request, continuity)
      this.validateCandidate(plan.document)
      this.assertStructureRestore(preview)
      const candidate = { ...current, document: plan.document, historyIdentity: plan.historyIdentity }
      await validateCompleteProjectV4(candidate)
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
