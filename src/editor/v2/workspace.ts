import { newId } from '../../core/types'
import type { SceneDocumentV2 } from '../../core/v2/types'
import { validateSceneV2 } from '../../core/v2/schema'
import { applyCommandsV2, type SceneCommandV2 } from '../../core/v2/commands'
import { validateCompleteProjectV2 } from '../../io/v2/project-file'
import type { CompleteProjectV2 } from '../../io/v2/types'

export interface WorkspaceRepository {
  save(project: CompleteProjectV2, expectedRevision: number | null): Promise<void>
}
type SaveStatus = 'empty' | 'saved' | 'unsaved' | 'saving' | 'error' | 'conflict'
export interface WorkspaceState {
  project: CompleteProjectV2 | null
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

export function forkProjectV2(project: CompleteProjectV2): CompleteProjectV2 {
  const result = copy(project), now = new Date().toISOString()
  Object.assign(result.document, { sceneId: newId(), revision: 0, createdAt: now, updatedAt: now, title: `${result.document.title} · 副本` })
  return result
}

/** The v2 editor owns full project snapshots; rendering never becomes its storage model. */
export class WorkspaceV2 {
  private state: WorkspaceState = { project: null, status: 'empty', error: null, canUndo: false, canRedo: false }
  private listeners = new Set<() => void>()
  private past: SceneDocumentV2[] = []
  private future: SceneDocumentV2[] = []
  private persistedRevision: number | null = null
  private pending: CompleteProjectV2 | null = null
  private saving: Promise<void> | null = null
  private blocked: unknown = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private copying = false
  private version = 0

  constructor(private readonly repository: WorkspaceRepository, private readonly validateCandidate: (document: SceneDocumentV2) => void = () => {}) {}
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
  private install(project: CompleteProjectV2) {
    this.version++
    this.past = []; this.future = []; this.pending = null; this.blocked = null
    this.persistedRevision = project.document.revision
    this.publish({ project: freeze(copy(project)), status: 'saved', error: null })
  }
  /** Read-only validation and CAS creation precede switching; late results cannot discard edits. */
  async adoptNew(input: CompleteProjectV2, checkpoint = this.checkpoint()) {
    const project = copy(input)
    await validateCompleteProjectV2(project)
    this.assertCheckpoint(checkpoint)
    await this.flush()
    this.assertCheckpoint(checkpoint)
    await this.repository.save(project, null)
    this.assertCheckpoint(checkpoint)
    this.install(project)
  }
  async openPersisted(input: CompleteProjectV2, checkpoint = this.checkpoint()) {
    const project = copy(input)
    await validateCompleteProjectV2(project)
    this.assertCheckpoint(checkpoint)
    if (project.document.sceneId === this.state.project?.document.sceneId && project.document.revision < this.state.project.document.revision) {
      throw new Error('载入结果早于当前编辑修订，已保留当前内容。请等待保存后重新打开。')
    }
    await this.flush()
    this.assertCheckpoint(checkpoint)
    this.install(project)
  }
  private enqueue(project: CompleteProjectV2) {
    this.pending = project
    if (this.blocked) return
    this.publish({ status: 'unsaved', error: null })
    if (this.copying) return
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => { this.timer = null; void this.startSave().catch(() => {}) }, 120)
  }
  private startSave(): Promise<void> {
    if (this.copying) return Promise.resolve()
    if (this.saving) return this.saving
    this.saving = (async () => {
      while (this.pending && !this.blocked && !this.copying) {
        const snapshot = this.pending
        this.pending = null
        this.publish({ status: 'saving' })
        try {
          await this.repository.save(snapshot, this.persistedRevision)
          this.persistedRevision = snapshot.document.revision
          this.publish({ status: this.pending ? 'unsaved' : 'saved', error: null })
        } catch (error) {
          this.pending = this.pending ?? snapshot
          this.blocked = error
          this.publish({ status: error instanceof Error && error.name === 'ConflictErrorV2' ? 'conflict' : 'error', error: message(error) })
          throw error
        }
      }
    })().finally(() => { this.saving = null })
    return this.saving
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
    const checkpoint = this.checkpoint(), project = forkProjectV2(this.state.project)
    if (this.timer) { clearTimeout(this.timer); this.timer = null }
    this.copying = true
    try {
      // Drain the previous branch before installing another identity. New edits stay queued.
      if (this.saving) await this.saving.catch(() => {})
      this.assertCheckpoint(checkpoint)
      await validateCompleteProjectV2(project)
      await this.repository.save(project, null)
      this.assertCheckpoint(checkpoint)
      this.install(project)
    } finally {
      this.copying = false
      if (this.pending && !this.blocked) this.timer = setTimeout(() => { this.timer = null; void this.startSave().catch(() => {}) }, 120)
    }
  }
  private commit(document: SceneDocumentV2, history: 'edit' | 'undo' | 'redo') {
    const project = this.state.project
    if (!project) throw new Error('尚未打开工程。')
    document.revision = project.document.revision + 1
    document.updatedAt = new Date().toISOString()
    const result = validateSceneV2(document)
    if (!result.ok) throw new Error(result.errors.map(error => error.message).join('；'))
    if (history === 'edit') { this.past.push(project.document); this.future = [] }
    this.version++
    const next = freeze({ ...project, document: result.document })
    this.publish({ project: next })
    this.enqueue(next)
  }
  /** Preview uses the same candidate checks as adoption, without changing state. */
  preview(commands: readonly SceneCommandV2[]): SceneDocumentV2 {
    const scene = this.state.project?.document
    if (!scene) throw new Error('尚未打开工程。')
    const next = applyCommandsV2(scene, commands)
    if (JSON.stringify(next) !== JSON.stringify(scene)) this.validateCandidate(next)
    return next
  }
  execute(commands: readonly SceneCommandV2[]) {
    const next = this.preview(commands)
    if (JSON.stringify(next) !== JSON.stringify(this.state.project!.document)) this.commit(next, 'edit')
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
    const next = copy(previous)
    this.commit(next, 'undo')
    this.past.pop(); this.future.push(current)
    this.publish({})
  }
  redo() {
    const next = this.future.at(-1), current = this.state.project?.document
    if (!next || !current) return
    this.commit(copy(next), 'redo')
    this.future.pop(); this.past.push(current)
    this.publish({})
  }
}
