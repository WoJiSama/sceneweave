import Dexie, { type Table, type Transaction } from 'dexie'
import { migrateSceneV1 } from '../../core/v2/migration'
import { validateSceneV2 } from '../../core/v2/schema'
import type { SceneDocumentV2 } from '../../core/v2/types'
import { readProjectV1 } from '../project-file'
import { parseBoundedJson } from './json'
import { validateCompleteProjectV2 } from './project-file'
import type { AssetBlobRecord, CompleteProjectV2, LicenseBinding, LicenseTextRecord, MigrationSourceV2 } from './types'

interface StoredSceneV2 {
  sceneId: string
  revision: number
  documentSchemaVersion: 2
  document: SceneDocumentV2
  savedAt: number
}

interface ResourceBindingsV2 {
  sceneId: string
  revision: number
  assetHashes: string[]
  licenseHashes: string[]
  licenseBindings: LicenseBinding[]
}

interface StoredMigrationSourceV2 extends MigrationSourceV2 { sceneId: string }
export interface SceneSummaryV2 { sceneId: string; title: string; revision: number; savedAt: number }
export interface SnapshotSummaryV2 { sceneId: string; revision: number; savedAt: number }

export class ConflictErrorV2 extends Error {
  readonly currentRevision: number | null
  constructor(currentRevision: number | null) {
    super(`本地资产工程版本冲突（当前版本 ${currentRevision ?? '无记录'}）；请另存为或重新载入。`)
    this.name = 'ConflictErrorV2'
    this.currentRevision = currentRevision
  }
}

const HASH = /^[a-f0-9]{64}$/
const TABLES = ['scenes', 'snapshots', 'assetBlobs', 'licenseTexts', 'resourceBindings', 'migrationSources'] as const
const STORE_KEYS: Record<(typeof TABLES)[number], { key: string | string[]; indexes: Record<string, string> }> = {
  scenes: { key: 'sceneId', indexes: { savedAt: 'savedAt' } },
  snapshots: { key: ['sceneId', 'revision'], indexes: { sceneId: 'sceneId' } },
  assetBlobs: { key: 'sha256', indexes: {} },
  licenseTexts: { key: 'sha256', indexes: {} },
  resourceBindings: { key: ['sceneId', 'revision'], indexes: { sceneId: 'sceneId' } },
  migrationSources: { key: 'sceneId', indexes: {} },
}

function cancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('操作已取消；原存档保持不变。', 'AbortError')
}

function assertStoredScene(record: StoredSceneV2, sceneId = record.sceneId, revision = record.revision): void {
  if (!record || record.documentSchemaVersion !== 2 || record.document?.schemaVersion !== 2
    || typeof record.sceneId !== 'string' || record.sceneId !== sceneId || record.document.sceneId !== sceneId
    || !Number.isSafeInteger(record.revision) || record.revision < 0 || record.revision !== revision
    || record.document.revision !== revision || typeof record.document.title !== 'string'
    || !Number.isSafeInteger(record.savedAt) || record.savedAt < 0) {
    throw new Error('存档文档版本或记录损坏；原记录已保留，不能覆盖。')
  }
  const checked = validateSceneV2(record.document)
  if (!checked.ok) throw new Error(`存档文档包含损坏或不支持的内容；原记录已保留：${checked.errors.map(issue => issue.message).join('；')}`)
}

function assertBindings(record: ResourceBindingsV2 | undefined, sceneId: string, revision: number): asserts record is ResourceBindingsV2 {
  if (!record || record.sceneId !== sceneId || record.revision !== revision
    || !Array.isArray(record.assetHashes) || record.assetHashes.length > 256
    || !Array.isArray(record.licenseHashes) || record.licenseHashes.length > 3000
    || !Array.isArray(record.licenseBindings) || record.licenseBindings.length > 4352
    || [...record.assetHashes, ...record.licenseHashes].some(hash => typeof hash !== 'string' || !HASH.test(hash))
    || new Set(record.assetHashes).size !== record.assetHashes.length
    || new Set(record.licenseHashes).size !== record.licenseHashes.length) {
    throw new Error('存档资源绑定缺失或损坏；原记录已保留。')
  }
}

async function sameBytes(left: Blob, right: Blob): Promise<boolean> {
  if (!(left instanceof Blob) || !(right instanceof Blob) || left.size !== right.size) return false
  const [a, b] = await Promise.all([left.arrayBuffer(), right.arrayBuffer()])
  const leftBytes = new Uint8Array(a), rightBytes = new Uint8Array(b)
  return leftBytes.every((value, index) => value === rightBytes[index])
}

function sameMigrationMetadata(left: MigrationSourceV2, right: MigrationSourceV2): boolean {
  return left.sourceSchemaVersion === right.sourceSchemaVersion && left.sourceSceneId === right.sourceSceneId
    && left.sourceRevision === right.sourceRevision && left.sourceHash === right.sourceHash
    && left.migratorVersion === right.migratorVersion && left.migratedAt === right.migratedAt
}

function assertMigrationTarget(source: MigrationSourceV2 | undefined, targetSceneId: string): void {
  if (source?.sourceSceneId === targetSceneId) throw new Error('迁移来源与目标不能使用同一场景身份；请创建新副本。')
}

async function validateMigrationOriginal(source: MigrationSourceV2 | undefined, targetSceneId: string, signal?: AbortSignal): Promise<void> {
  if (!source) return
  assertMigrationTarget(source, targetSceneId)
  cancelled(signal)
  const prefix = new Uint8Array(await source.original.slice(0, 4).arrayBuffer())
  const original: unknown = prefix[0] === 0x50 && prefix[1] === 0x4b
    ? await readProjectV1(source.original)
    : parseBoundedJson(new Uint8Array(await source.original.arrayBuffer()))
  // The migrator is the authority for the supported, strict M0 source profile.
  // This candidate is only checked; the persisted v2 document remains the caller's revision.
  const checked = migrateSceneV1(original, { sceneId: targetSceneId, now: source.migratedAt })
  if (!original || typeof original !== 'object' || !('sceneId' in original) || !('revision' in original)
    || original.sceneId !== source.sourceSceneId || original.revision !== source.sourceRevision
    || checked.sceneId !== targetSceneId) {
    throw new Error('迁移来源场景身份或修订与原件不匹配。')
  }
  cancelled(signal)
}

/** Inspect before Dexie opens: opening an unknown old DB must not upgrade it. */
function inspectExistingDatabase(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name)
    let isNew = false
    let settled = false
    const fail = (error: unknown) => { if (!settled) { settled = true; reject(error) } }
    request.onupgradeneeded = () => {
      isNew = true
      request.transaction!.abort()
    }
    request.onerror = () => {
      if (isNew && request.error?.name === 'AbortError') { settled = true; resolve() }
      else fail(request.error ?? new Error('无法检查本地资产数据库。'))
    }
    request.onblocked = () => fail(new Error('资产数据库被其他连接阻塞；请关闭旧标签后重试。'))
    request.onsuccess = () => {
      const db = request.result
      try {
        if (settled) return
        // Dexie represents its version 1 as native IndexedDB version 10.
        if (db.version !== 10 || JSON.stringify(Array.from(db.objectStoreNames).sort()) !== JSON.stringify([...TABLES].sort())) {
          throw new Error('不支持的资产数据库结构版本；原数据库已保留。')
        }
        const transaction = db.transaction([...TABLES], 'readonly')
        for (const name of TABLES) {
          const store = transaction.objectStore(name), expected = STORE_KEYS[name]
          if (store.autoIncrement || JSON.stringify(store.keyPath) !== JSON.stringify(expected.key)
            || JSON.stringify(Array.from(store.indexNames).sort()) !== JSON.stringify(Object.keys(expected.indexes).sort())) {
            throw new Error('不支持的资产数据库表结构；原数据库已保留。')
          }
          for (const [indexName, keyPath] of Object.entries(expected.indexes)) {
            const index = store.index(indexName)
            if (index.keyPath !== keyPath || index.unique || index.multiEntry) throw new Error('不支持的资产数据库索引结构；原数据库已保留。')
          }
        }
        settled = true
        resolve()
      } catch (error) { fail(error) }
      finally { db.close() }
    }
  })
}

/** Independent complete-asset repository. Resource bytes are never garbage-collected here. */
export class SceneRepositoryV2 {
  private readonly db: Dexie
  private readonly scenes: Table<StoredSceneV2, string>
  private readonly snapshots: Table<StoredSceneV2, [string, number]>
  private readonly assetBlobs: Table<AssetBlobRecord, string>
  private readonly licenseTexts: Table<LicenseTextRecord, string>
  private readonly resourceBindings: Table<ResourceBindingsV2, [string, number]>
  private readonly migrationSources: Table<StoredMigrationSourceV2, string>
  private opening: Promise<void> | null = null
  private invalidated = false
  private rejectBlocked: ((error: Error) => void) | undefined

  constructor(private readonly name = 'sceneweave-m1') {
    if (name === 'sceneweave-m0') throw new Error('资产仓库不能使用 M0 原件数据库。')
    this.db = new Dexie(name)
    this.db.version(1).stores({
      scenes: 'sceneId, savedAt', snapshots: '[sceneId+revision], sceneId',
      assetBlobs: 'sha256', licenseTexts: 'sha256',
      resourceBindings: '[sceneId+revision], sceneId', migrationSources: 'sceneId',
    })
    this.scenes = this.db.table('scenes')
    this.snapshots = this.db.table('snapshots')
    this.assetBlobs = this.db.table('assetBlobs')
    this.licenseTexts = this.db.table('licenseTexts')
    this.resourceBindings = this.db.table('resourceBindings')
    this.migrationSources = this.db.table('migrationSources')
    this.db.on('versionchange', () => { this.invalidated = true; this.db.close(); return false })
    this.db.on('blocked', () => {
      this.invalidated = true
      this.db.close()
      this.rejectBlocked?.(new Error('资产数据库被其他连接阻塞；请关闭旧标签后重试。'))
    })
  }

  async open(): Promise<void> {
    if (this.invalidated) throw new Error('资产数据库结构已变化；旧读者已停止写入，请更新应用。')
    if (this.db.isOpen()) return
    this.opening ??= this.openDatabase().finally(() => { this.opening = null })
    await this.opening
  }

  private async openDatabase(): Promise<void> {
    await inspectExistingDatabase(this.name)
    if (this.invalidated) throw new Error('资产数据库结构已变化；请更新应用。')
    const blocked = new Promise<never>((_resolve, reject) => { this.rejectBlocked = reject })
    try {
      await Promise.race([this.db.open().then(() => {
        if (this.invalidated) { this.db.close(); throw new Error('资产数据库被其他连接阻塞；请关闭旧标签后重试。') }
      }), blocked])
    } finally { this.rejectBlocked = undefined }
  }

  close(): void { this.db.close() }

  async list(): Promise<SceneSummaryV2[]> {
    await this.open()
    const records = await this.scenes.orderBy('savedAt').reverse().toArray()
    return records.map(record => {
      assertStoredScene(record)
      return { sceneId: record.sceneId, title: record.document.title, revision: record.revision, savedAt: record.savedAt }
    })
  }

  async load(sceneId: string): Promise<CompleteProjectV2 | null> { return this.readProject(sceneId) }

  async listSnapshots(sceneId: string): Promise<SnapshotSummaryV2[]> {
    await this.open()
    const records = await this.snapshots.where('sceneId').equals(sceneId).toArray()
    return records.sort((left, right) => right.revision - left.revision).map(record => {
      assertStoredScene(record, sceneId)
      return { sceneId, revision: record.revision, savedAt: record.savedAt }
    })
  }

  async loadSnapshot(sceneId: string, revision: number): Promise<CompleteProjectV2 | null> {
    if (!Number.isSafeInteger(revision) || revision < 0) throw new Error('快照 revision 必须为非负安全整数。')
    return this.readProject(sceneId, revision)
  }

  private async readProject(sceneId: string, revision?: number): Promise<CompleteProjectV2 | null> {
    await this.open()
    const project = await this.db.transaction('r', [...TABLES], async () => {
      const record = revision === undefined ? await this.scenes.get(sceneId) : await this.snapshots.get([sceneId, revision])
      if (!record) return null
      assertStoredScene(record, sceneId, revision ?? record.revision)
      const binding = await this.resourceBindings.get([sceneId, record.revision])
      assertBindings(binding, sceneId, record.revision)
      const [assets, licenses, migration] = await Promise.all([
        this.assetBlobs.bulkGet(binding.assetHashes), this.licenseTexts.bulkGet(binding.licenseHashes), this.migrationSources.get(sceneId),
      ])
      if (assets.some(record => !record) || licenses.some(record => !record)) throw new Error('存档所需素材或许可缺失；原记录已保留。')
      const complete: CompleteProjectV2 = {
        document: record.document,
        assets: Object.fromEntries(binding.assetHashes.map((hash, index) => [hash, assets[index]!])),
        licenses: Object.fromEntries(binding.licenseHashes.map((hash, index) => [hash, licenses[index]!])),
        licenseBindings: binding.licenseBindings,
      }
      if (migration) {
        const { sceneId: storedSceneId, ...source } = migration
        if (storedSceneId !== sceneId) throw new Error('迁移来源绑定损坏；原记录已保留。')
        complete.migrationSource = source
      }
      return complete
    })
    if (project) {
      // Hashing and browser image decode must never hold a read transaction open.
      await validateCompleteProjectV2(project)
      await validateMigrationOriginal(project.migrationSource, sceneId)
    }
    return project
  }

  async save(project: CompleteProjectV2, expectedRevision: number | null, options: { signal?: AbortSignal } = {}): Promise<void> {
    cancelled(options.signal)
    if (expectedRevision !== null && (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)) throw new Error('保存基线必须为非负 revision 或无记录。')
    // Capture before the first await; neither caller mutations nor decoder work may change the candidate.
    const snapshot = structuredClone(project)
    await validateCompleteProjectV2(snapshot, options)
    await validateMigrationOriginal(snapshot.migrationSource, snapshot.document.sceneId, options.signal)
    cancelled(options.signal)
    await this.open()
    let active: Transaction | undefined
    const abort = () => { active?.abort() }
    options.signal?.addEventListener('abort', abort, { once: true })
    try {
      await this.db.transaction('rw', [...TABLES], async () => {
        active = Dexie.currentTransaction!
        cancelled(options.signal)
        const scene = snapshot.document
        const previous = await this.scenes.get(scene.sceneId)
        if (previous) assertStoredScene(previous, scene.sceneId)
        const currentRevision = previous?.revision ?? null
        if (currentRevision !== expectedRevision || (currentRevision !== null && scene.revision <= currentRevision)) throw new ConflictErrorV2(currentRevision)
        for (const [hash, candidate] of Object.entries(snapshot.assets)) {
          const existing = await this.assetBlobs.get(hash)
          if (existing) {
            if (existing.sha256 !== hash || existing.mimeType !== candidate.mimeType || existing.sizeBytes !== candidate.sizeBytes
              || existing.pixelWidth !== candidate.pixelWidth || existing.pixelHeight !== candidate.pixelHeight
              || !(existing.blob instanceof Blob) || existing.blob.type !== candidate.blob.type
              || !(await Dexie.waitFor(sameBytes(existing.blob, candidate.blob)))) {
              throw new Error(`素材 ${hash} 的已有字节、类型或尺寸冲突；原存档已保留。`)
            }
          } else await this.assetBlobs.add(candidate)
          cancelled(options.signal)
        }
        for (const [hash, candidate] of Object.entries(snapshot.licenses)) {
          const existing = await this.licenseTexts.get(hash)
          if (existing && (existing.sha256 !== hash || existing.text !== candidate.text)) throw new Error(`许可 ${hash} 的已有内容冲突；原存档已保留。`)
          if (!existing) await this.licenseTexts.add(candidate)
          cancelled(options.signal)
        }
        const original = await this.migrationSources.get(scene.sceneId)
        if (snapshot.migrationSource) {
          const candidate = snapshot.migrationSource
          if (original) {
            if (!sameMigrationMetadata(original, candidate) || !(await Dexie.waitFor(sameBytes(original.original, candidate.original)))) {
              throw new Error('迁移来源不可被后续保存替换；原件已保留。')
            }
          } else {
            if (previous) throw new Error('已有工程不能后补不同迁移来源；请迁移为新副本。')
            await this.migrationSources.add({ ...candidate, sceneId: scene.sceneId })
          }
        }
        const latestSavedAt = (await this.scenes.orderBy('savedAt').last())?.savedAt ?? 0
        const record: StoredSceneV2 = {
          sceneId: scene.sceneId, revision: scene.revision, documentSchemaVersion: 2,
          document: scene, savedAt: Math.max(Date.now(), latestSavedAt + 1),
        }
        const bindings: ResourceBindingsV2 = {
          sceneId: scene.sceneId, revision: scene.revision,
          assetHashes: Object.keys(snapshot.assets).sort(), licenseHashes: Object.keys(snapshot.licenses).sort(),
          licenseBindings: snapshot.licenseBindings,
        }
        cancelled(options.signal)
        await this.scenes.put(record)
        await this.resourceBindings.add(bindings)
        await this.snapshots.add(record)
        const older = (await this.snapshots.where('sceneId').equals(scene.sceneId).primaryKeys())
          .sort((left, right) => right[1] - left[1]).slice(20)
        if (older.length) {
          await this.snapshots.bulkDelete(older)
          await this.resourceBindings.bulkDelete(older)
        }
        cancelled(options.signal)
      })
    } finally { active = undefined; options.signal?.removeEventListener('abort', abort) }
  }
}
