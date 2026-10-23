import { newId } from '../../core/types'
import type { SceneDocumentV3 } from '../../core/v3/types'
import { applySnapshotCommandsV3, type SceneCommandV3 } from '../../core/v3/commands'
import { reviseSceneSnapshotV3, validateSceneSnapshotV3 } from '../../core/v3/snapshots'
import { validateCompleteProjectV3 } from '../../io/v3/project-file'
import type { CompleteProjectV3 } from '../../io/v3/types'

export interface WorkspaceRepository {
  save(project: CompleteProjectV3, expectedRevision: number | null): Promise<void>
}
type SaveStatus = 'empty' | 'saved' | 'unsaved' | 'saving' | 'error' | 'conflict'
export interface WorkspaceState {
  project: CompleteProjectV3 | null
  status: SaveStatus
  error: string | null
  canUndo: boolean
  canRedo: boolean
}
const copy = <T>(value: T): T => structuredClone(value)
function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !(value instanceof Blob) && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) freeze(child)
  }
  return value
}
const message = (e: unknown) => e instanceof Error ? e.message : String(e)

export function forkProjectV3(project: CompleteProjectV3): CompleteProjectV3 {
  const result = copy(project), now = new Date().toISOString()
  Object.assign(result.document, { sceneId: newId(), revision: 0, createdAt: now, updatedAt: now, title: `${result.document.title} · 副本` })
  return result
}

/** The v3 editor owns full project snapshots; rendering never becomes its storage model. */
export class WorkspaceV3 {
  private state: WorkspaceState = { project: null, status: 'empty', error: null, canUndo: false, canRedo: false }
  private listeners = new Set<() => void>()
  private past: SceneDocumentV3[] = []
  private future: SceneDocumentV3[] = []
  private persistedRevision: number | null = null
  private pending: CompleteProjectV3 | null = null
  private saving: Promise<void> | null = null
  private blocked: unknown = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private copying = false
  private version = 0

  constructor(private readonly repository: WorkspaceRepository, private readonly validateCandidate: (document: SceneDocumentV3) => void = () => {}) {}
  getState = (): WorkspaceState => this.state
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  checkpoint = () => this.version
  assertCheckpoint(version: number) {
    if (version !== this.version) throw new Error('准备期间场景已有修改，已保留当前内容，请重新打开。')
  }
  private publish(patch: Partial<WorkspaceState>) {
    this.state = { ...this.state, ...patch, canUndo: this.past.length > 0, canRedo: this.future.length > 0 }
    this.listeners.forEach(listener => listener())
  }
  private install(project: CompleteProjectV3) {
    // Keep repository/caller references outside the owned immutable boundary.
    const owned = copy(project), checked = validateSceneSnapshotV3(owned.document)
    if (!checked.ok) throw new Error(checked.errors.map(error => error.message).join('；'))
    owned.document = checked.document
    this.version++
    this.past = []; this.future = []; this.pending = null; this.blocked = null
    this.persistedRevision = project.document.revision
    this.publish({ project: freeze(owned), status: 'saved', error: null })
  }
  /** Read-only validation and CAS creation precede switching; late results cannot discard edits. */
  async adoptNew(input: CompleteProjectV3, checkpoint = this.checkpoint()) {
    const project = copy(input)
    await validateCompleteProjectV3(project)
    this.assertCheckpoint(checkpoint)
    await this.flush()
    this.assertCheckpoint(checkpoint)
    await this.repository.save(project, null)
    this.assertCheckpoint(checkpoint)
    this.install(project)
  }
  async openPersisted(input: CompleteProjectV3, checkpoint = this.checkpoint()) {
    const project = copy(input)
    await validateCompleteProjectV3(project)
    this.assertCheckpoint(checkpoint)
    if (project.document.sceneId === this.state.project?.document.sceneId && project.document.revision < this.state.project.document.revision) {
      throw new Error('载入结果早于当前编辑修订，已保留当前内容。请等待保存后重新打开。')
    }
    await this.flush()
    this.assertCheckpoint(checkpoint)
    this.install(project)
  }
  /** A compatibility route departure is a real close, after preserving the current branch. */
  async close(checkpoint = this.checkpoint()) {
    await this.flush()
    this.assertCheckpoint(checkpoint)
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.version++
    this.past = []; this.future = []; this.pending = null; this.blocked = null
    this.persistedRevision = null
    this.publish({ project: null, status: 'empty', error: null })
  }
  private enqueue(project: CompleteProjectV3) {
    this.pending = project
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (!this.blocked && !this.copying) this.timer = setTimeout(() => { this.timer = null; void this.startSave().catch(() => {}) }, 120)
    // A synchronous subscriber may edit, undo, redo or flush. No older queue or
    // history mutation may run after it has observed this complete transition.
    this.publish({ project, status: this.blocked ? this.state.status : 'unsaved', error: this.blocked ? this.state.error : null })
  }
  private startSave(): Promise<void> {
    if (this.copying) return Promise.resolve()
    if (this.saving) return this.saving
    let resolve!: () => void, reject!: (reason: unknown) => void
    const saving = new Promise<void>((done, fail) => { resolve = done; reject = fail })
    // Install the serialization lock before the first synchronous notification.
    // Starting the worker immediately preserves flush's existing status timing.
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
          this.pending = this.pending ?? snapshot
          this.blocked = error
          this.publish({ status: error instanceof Error && error.name === 'ConflictErrorV3' ? 'conflict' : 'error', error: message(error) })
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
  /** A conflict branch stays recoverable even when flushing that branch is impossible. */
  async saveAsCopy() {
    if (!this.state.project) throw new Error('尚未打开工程。')
    if (this.copying) throw new Error('正在保存独立副本，请稍后重试。')
    const checkpoint = this.checkpoint(), project = forkProjectV3(this.state.project)
    if (this.timer) { clearTimeout(this.timer); this.timer = null }
    this.copying = true
    try {
      // Drain the previous branch before installing another identity. New edits stay queued.
      if (this.saving) await this.saving.catch(() => {})
      this.assertCheckpoint(checkpoint)
      await validateCompleteProjectV3(project)
      await this.repository.save(project, null)
      this.assertCheckpoint(checkpoint)
      this.install(project)
    } finally {
      this.copying = false
      if (this.pending && !this.blocked) this.timer = setTimeout(() => { this.timer = null; void this.startSave().catch(() => {}) }, 120)
    }
  }
  private commit(document: SceneDocumentV3, history: 'edit' | 'undo' | 'redo') {
    const project = this.state.project
    if (!project) throw new Error('尚未打开工程。')
    const nextDocument = reviseSceneSnapshotV3(document, project.document.revision + 1, new Date().toISOString())
    const next = freeze({ ...project, document: nextDocument })
    if (history === 'edit') { this.past.push(project.document); this.future = [] }
    else if (history === 'undo') { this.past.pop(); this.future.push(project.document) }
    else { this.future.pop(); this.past.push(project.document) }
    this.version++
    this.enqueue(next)
  }
  /** Preview uses the same candidate checks as adoption, without changing state. */
  preview(commands: readonly SceneCommandV3[]): SceneDocumentV3 {
    const scene = this.state.project?.document
    if (!scene) throw new Error('尚未打开工程。')
    const checkpoint = this.checkpoint(), next = applySnapshotCommandsV3(scene, commands)
    if (next !== scene) this.validateCandidate(next)
    this.assertCheckpoint(checkpoint)
    return next
  }
  execute(commands: readonly SceneCommandV3[]) {
    const next = this.preview(commands)
    if (next !== this.state.project!.document) this.commit(next, 'edit')
  }
  updateProp(id: string, changes: { positionMm?: { x: number; y: number }; rotationDeg?: number }) {
    this.execute([{ type: 'updateProp', id, changes }])
  }
  rotateRoomMaterial(id: string, rotationDeg: number) {
    this.execute([{ type: 'setSurfacePaint', kind: 'room', id, changes: { rotationDeg } }])
  }
  undo() {
    const previous = this.past.at(-1), current = this.state.project?.document
    if (!previous || !current) return
    // Validate first so an unsuccessful history operation cannot consume the stacks.
    this.commit(previous, 'undo')
  }
  redo() {
    const next = this.future.at(-1), current = this.state.project?.document
    if (!next || !current) return
    this.commit(next, 'redo')
  }
}
