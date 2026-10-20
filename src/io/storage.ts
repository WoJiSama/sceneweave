import Dexie, { type Table } from 'dexie'
import { validateScene } from '../core/schema'
import { cloneScene, type SceneDocument } from '../core/types'

interface StoredScene {
  sceneId: string
  revision: number
  document: SceneDocument
  savedAt: number
}

export class ConflictError extends Error {
  readonly currentRevision: number | null
  constructor(currentRevision: number | null) {
    super(`本地存档版本冲突（当前版本 ${currentRevision ?? '无记录'}）；请另存为或重新载入。`)
    this.name = 'ConflictError'
    this.currentRevision = currentRevision
  }
}

/** Complete geometry documents and their last 20 successful snapshots. */
export class SceneRepository {
  private readonly db: Dexie
  private readonly scenes: Table<StoredScene, string>
  private readonly snapshots: Table<StoredScene, [string, number]>

  constructor(name = 'sceneweave-m0') {
    this.db = new Dexie(name)
    this.db.version(1).stores({
      scenes: 'sceneId, savedAt',
      snapshots: '[sceneId+revision], sceneId',
    })
    this.scenes = this.db.table('scenes')
    this.snapshots = this.db.table('snapshots')
  }

  async load(sceneId: string): Promise<SceneDocument | null> {
    return (await this.scenes.get(sceneId))?.document ?? null
  }

  async latest(): Promise<SceneDocument | null> {
    return (await this.scenes.orderBy('savedAt').last())?.document ?? null
  }

  async save(document: SceneDocument, expectedPersistedRevision: number | null): Promise<void> {
    const snapshot = cloneScene(document)
    const checked = validateScene(snapshot)
    if (!checked.ok) throw new Error(`场景校验失败：${checked.errors.map(issue => issue.message).join('；')}`)
    if (Object.keys(snapshot.assets).length || Object.values(snapshot.props).some(prop => prop.assetId !== null)) {
      throw new Error('M0 只保存原生符号物件；外部素材尚未实现。')
    }
    await this.db.transaction('rw', this.scenes, this.snapshots, async () => {
      const previous = await this.scenes.get(snapshot.sceneId)
      const currentRevision = previous?.revision ?? null
      if (currentRevision !== expectedPersistedRevision || (currentRevision !== null && snapshot.revision <= currentRevision)) {
        throw new ConflictError(currentRevision)
      }
      const latestSavedAt = (await this.scenes.orderBy('savedAt').last())?.savedAt ?? 0
      const record: StoredScene = {
        sceneId: snapshot.sceneId, revision: snapshot.revision, document: snapshot, savedAt: Math.max(Date.now(), latestSavedAt + 1),
      }
      await this.scenes.put(record)
      await this.snapshots.add(record)
      const older = (await this.snapshots.where('sceneId').equals(snapshot.sceneId).primaryKeys())
        .sort((left, right) => right[1] - left[1]).slice(20)
      if (older.length) await this.snapshots.bulkDelete(older)
    })
  }

  async listSnapshots(sceneId: string): Promise<SceneDocument[]> {
    return (await this.snapshots.where('sceneId').equals(sceneId).toArray())
      .sort((left, right) => right.revision - left.revision).map(record => record.document)
  }

  close(): void { this.db.close() }
}

export interface SaveState {
  status: 'unsaved' | 'saving' | 'saved' | 'error' | 'conflict'
  persistedRevision: number | null
  error?: string
}

/** Serialises writes; a failed write retains the newest unsaved document for retry. */
export class SaveCoordinator {
  private latestDocument: SceneDocument
  private pending: SceneDocument | null = null
  private persistedRevision: number | null
  private running: Promise<void> | null = null
  private scheduled = false
  private stopped = false
  private failure: Error | null = null
  private frozen = false

  constructor(
    private readonly repository: SceneRepository,
    document: SceneDocument,
    expected: number | null,
    private readonly onState: (state: SaveState) => void,
  ) {
    this.latestDocument = cloneScene(document)
    this.persistedRevision = expected
    if (document.revision === expected) this.emit('saved')
    else {
      this.pending = cloneScene(document)
      this.emit('unsaved')
      this.schedule()
    }
  }

  enqueue(document: SceneDocument): void {
    if (this.stopped) return
    if (document.sceneId !== this.latestDocument.sceneId) throw new Error('保存协调器不能切换场景 ID。')
    if (document.revision < this.latestDocument.revision) throw new Error('保存队列拒绝倒退的 revision。')
    if (document.revision === this.latestDocument.revision) return
    this.latestDocument = cloneScene(document)
    this.pending = cloneScene(document)
    if (this.failure) this.emit(this.frozen ? 'conflict' : 'error')
    else {
      this.emit('unsaved')
      this.schedule()
    }
  }

  /** Waits for the current queue; rejects on storage failure without discarding it. */
  async flush(): Promise<void> {
    if (!this.stopped && !this.failure) this.start()
    while (this.running) await this.running
    if (this.failure) throw this.failure
  }

  retry(): void {
    if (this.stopped || this.frozen) return
    this.failure = null
    if (this.latestDocument.revision !== this.persistedRevision) {
      this.pending = cloneScene(this.latestDocument)
      this.emit('unsaved')
      this.schedule()
    }
  }

  /** An already-started atomic transaction finishes; queued writes are cancelled. */
  stop(): void {
    this.stopped = true
    this.pending = null
  }

  private emit(status: SaveState['status']): void {
    if (!this.stopped) this.onState({ status, persistedRevision: this.persistedRevision, ...(this.failure ? { error: this.failure.message } : {}) })
  }

  private schedule(): void {
    if (this.scheduled || this.running || this.failure || this.stopped) return
    this.scheduled = true
    queueMicrotask(() => { this.scheduled = false; this.start() })
  }

  private start(): void {
    if (this.running || this.failure || this.stopped || !this.pending) return
    this.running = this.drain().finally(() => { this.running = null })
  }

  private async drain(): Promise<void> {
    while (this.pending && !this.stopped && !this.failure) {
      const snapshot = this.pending
      this.pending = null
      this.emit('saving')
      try {
        await this.repository.save(snapshot, this.persistedRevision)
        this.persistedRevision = snapshot.revision
        this.emit(this.latestDocument.revision === snapshot.revision ? 'saved' : 'unsaved')
      } catch (error) {
        this.failure = error instanceof Error ? error : new Error(String(error))
        this.frozen = this.failure instanceof ConflictError
        this.pending = cloneScene(this.latestDocument)
        this.emit(this.frozen ? 'conflict' : 'error')
      }
    }
  }
}
