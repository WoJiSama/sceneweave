import Dexie, { type Table, type Transaction } from 'dexie'
import { validateCompositionContentV6 } from '../../core/v6/schema'
import { validateSceneV3 } from '../../core/v3/schema'
import type { SceneDocumentV3 } from '../../core/v3/types'
import { HISTORY_LIMITS_V6, type AppearanceGraphV6, type HistoryIdentityV6 } from '../../core/v6/types'
import { utf8Encoder } from '../v3/json'
import { mergeHistoryIdentitiesV6, validateHistoryIdentityV6 } from './identity'
import { hasExactKeys, isSha256, PROJECT_LIMITS_V6 } from './limits'
import { validateMigrationSourceV6 } from './migration'
import { assertFixedCompositionCompatibleV6, canonicalJsonV6, forkHistoryArchiveV6, hashValidatedProjectV6, projectJsonBytesV6,
  validateCompleteProjectV6, validateHistoryArchiveV6, validateNamedSnapshotSummaryV6 } from './project-file'
import type { AssetBlobRecord, CompleteProjectV6, HistoryArchiveV6, LicenseBinding, LicenseTextRecord,
  MigrationSourceV6, NamedSnapshotSummaryV6, NamedSnapshotV6 } from './types'

interface StoredContentV6 {
  documentSchemaVersion: 3
  document: SceneDocumentV3
  historyIdentity: HistoryIdentityV6
  appearance: AppearanceGraphV6
  contentHash: string
  migrationSourceHash: string | null
}
interface StoredSceneV6 extends StoredContentV6 { sceneId: string; revision: number; savedAt: number }
interface StoredNamedSnapshotV6 extends StoredContentV6, NamedSnapshotSummaryV6 {}
interface ResourceRefsV6 { assetHashes: string[]; licenseHashes: string[]; licenseBindings: LicenseBinding[] }
interface ResourceBindingsV6 extends ResourceRefsV6 { sceneId: string; revision: number }
interface NamedResourceBindingsV6 extends ResourceRefsV6 { sceneId: string; snapshotId: string }
interface StoredMigrationSourceV6 extends MigrationSourceV6 { sceneId: string }
interface HistoryMetadataV6 { sceneId: string; metadataVersion: number }
export interface SceneSummaryV6 { sceneId: string; title: string; revision: number; savedAt: number }
export interface SnapshotSummaryV6 { sceneId: string; revision: number; savedAt: number }
export interface HistoryUsageV6 {
  metadataVersion: number
  namedCount: number
  protectionCount: number
  resourceBytes: number
  documentBytes: number
  originalBytes: number
  limits: typeof HISTORY_LIMITS_V6
}
export interface CreateNamedSnapshotOptionsV6 {
  kind?: 'named' | 'protection'
  expectedRevision?: number
  expectedMetadataVersion?: number
  sourceSnapshot?: { id: string; contentHash: string }
  signal?: AbortSignal
}

export class ConflictErrorV6 extends Error {
  readonly currentRevision: number | null
  constructor(currentRevision: number | null) {
    super(`本地历史工程版本冲突（当前版本 ${currentRevision ?? '无记录'}）；请另存为或重新载入。`)
    this.name = 'ConflictErrorV6'; this.currentRevision = currentRevision
  }
}
export class HistoryConflictErrorV6 extends Error {
  constructor() { super('历史元数据已被其他操作修改；请刷新快照列表后重试。'); this.name = 'HistoryConflictErrorV6' }
}

const TABLES = ['scenes', 'snapshots', 'namedSnapshots', 'protectionSnapshots', 'assetBlobs', 'licenseTexts',
  'resourceBindings', 'namedResourceBindings', 'migrationSources', 'historyMetadata'] as const
const STORE_KEYS: Record<(typeof TABLES)[number], { key: string | string[]; indexes: Record<string, string> }> = {
  scenes: { key: 'sceneId', indexes: { savedAt: 'savedAt' } },
  snapshots: { key: ['sceneId', 'revision'], indexes: { sceneId: 'sceneId' } },
  namedSnapshots: { key: ['sceneId', 'id'], indexes: { sceneId: 'sceneId', id: 'id' } },
  protectionSnapshots: { key: ['sceneId', 'id'], indexes: { sceneId: 'sceneId', id: 'id' } },
  assetBlobs: { key: 'sha256', indexes: {} }, licenseTexts: { key: 'sha256', indexes: {} },
  resourceBindings: { key: ['sceneId', 'revision'], indexes: { sceneId: 'sceneId' } },
  namedResourceBindings: { key: ['sceneId', 'snapshotId'], indexes: { sceneId: 'sceneId' } },
  migrationSources: { key: 'sceneId', indexes: {} }, historyMetadata: { key: 'sceneId', indexes: {} },
}
const integer = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0
const validId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 256 && value !== '__proto__'
function cancelled(signal?: AbortSignal) { if (signal?.aborted) throw new DOMException('操作已取消；原存档保持不变。', 'AbortError') }
function nameValue(value: string): string {
  if (typeof value !== 'string' || !value.trim() || Array.from(value.trim()).length > 80) throw new Error('快照名称须为 1–80 个字符。')
  return value.trim()
}
function assertContent(record: StoredContentV6): void {
  if (record.documentSchemaVersion !== 3 || !isSha256(record.contentHash)
    || record.migrationSourceHash !== null && !isSha256(record.migrationSourceHash)) throw new Error('存档文档版本或内容绑定损坏；原记录已保留。')
  const checked = validateSceneV3(record.document)
  if (!checked.ok) throw new Error(`存档文档损坏；原记录已保留：${checked.errors.map(issue => issue.message).join('；')}`)
  validateHistoryIdentityV6(record.historyIdentity, record.document)
  validateCompositionContentV6({ document: record.document, historyIdentity: record.historyIdentity, appearance: record.appearance })
}
function assertScene(record: StoredSceneV6, sceneId = record.sceneId, revision = record.revision): void {
  if (!hasExactKeys(record, ['sceneId', 'revision', 'savedAt', 'documentSchemaVersion', 'document', 'historyIdentity', 'appearance', 'contentHash', 'migrationSourceHash'])
    || !validId(record.sceneId) || record.sceneId !== sceneId || !integer(record.revision) || record.revision !== revision
    || record.document?.sceneId !== sceneId || record.document.revision !== revision || !integer(record.savedAt)) throw new Error('存档文档版本、身份或记录损坏；原记录已保留。')
  assertContent(record)
}
function summaryOf(record: NamedSnapshotSummaryV6): NamedSnapshotSummaryV6 {
  return { id: record.id, sceneId: record.sceneId, lineageId: record.lineageId, sourceRevision: record.sourceRevision,
    name: record.name, kind: record.kind, createdAt: record.createdAt, contentHash: record.contentHash }
}
function assertNamed(record: StoredNamedSnapshotV6, sceneId = record.sceneId, kind?: NamedSnapshotSummaryV6['kind']): void {
  if (!hasExactKeys(record, ['id', 'sceneId', 'lineageId', 'sourceRevision', 'name', 'kind', 'createdAt', 'contentHash',
    'documentSchemaVersion', 'document', 'historyIdentity', 'appearance', 'migrationSourceHash']) || record.sceneId !== sceneId
    || record.sourceRevision !== record.document?.revision || record.lineageId !== record.historyIdentity?.lineageId
    || kind !== undefined && record.kind !== kind) throw new Error('历史快照记录身份、类型或字段损坏；原记录已保留。')
  validateNamedSnapshotSummaryV6(summaryOf(record)); assertContent(record)
}
function assertRefs(record: ResourceRefsV6 | undefined): asserts record is ResourceRefsV6 {
  if (!record || !Array.isArray(record.assetHashes) || record.assetHashes.length > PROJECT_LIMITS_V6.uniqueImages
    || !Array.isArray(record.licenseHashes) || record.licenseHashes.length > PROJECT_LIMITS_V6.entries
    || !Array.isArray(record.licenseBindings) || record.licenseBindings.length > 10_000
    || [...record.assetHashes, ...record.licenseHashes].some(hash => !isSha256(hash))
    || new Set(record.assetHashes).size !== record.assetHashes.length || new Set(record.licenseHashes).size !== record.licenseHashes.length) throw new Error('存档资源绑定缺失或损坏；原记录已保留。')
}
function refsOf(project: CompleteProjectV6): ResourceRefsV6 {
  return { assetHashes: Object.keys(project.assets).sort(), licenseHashes: Object.keys(project.licenses).sort(), licenseBindings: project.licenseBindings }
}
function assertMetadata(record: HistoryMetadataV6 | undefined, sceneId: string): asserts record is HistoryMetadataV6 {
  if (!hasExactKeys(record, ['sceneId', 'metadataVersion']) || record.sceneId !== sceneId || !integer(record.metadataVersion)) throw new Error('历史元数据缺失或损坏；原记录已保留。')
}
async function sameBytes(left: Blob, right: Blob): Promise<boolean> {
  if (!(left instanceof Blob) || !(right instanceof Blob) || left.size !== right.size) return false
  const [a, b] = await Promise.all([left.arrayBuffer(), right.arrayBuffer()]), bytes = new Uint8Array(b)
  return new Uint8Array(a).every((value, index) => value === bytes[index])
}
type OriginalChain = { original: Blob; previousSource?: OriginalChain }
function migrationMetadata(source: OriginalChain): unknown {
  const { original: _original, previousSource, ...rest } = source
  return previousSource ? { ...rest, previousSource: migrationMetadata(previousSource) } : rest
}
async function sameMigration(left: MigrationSourceV6, right: MigrationSourceV6): Promise<boolean> {
  if (canonicalJsonV6(migrationMetadata(left)) !== canonicalJsonV6(migrationMetadata(right))) return false
  let a: OriginalChain | undefined = left, b: OriginalChain | undefined = right
  while (a && b) {
    if (!(await sameBytes(a.original, b.original))) return false
    a = a.previousSource; b = b.previousSource
  }
  return !a && !b
}
function sourceOf(record: StoredMigrationSourceV6): MigrationSourceV6 { const { sceneId: _sceneId, ...source } = record; return source }
function originalBytes(source: MigrationSourceV6): number {
  const originals: Blob[] = []
  const seen = new Set<OriginalChain>()
  let item: OriginalChain | undefined = source
  while (item) {
    if (seen.has(item) || originals.length >= 5) throw new Error('迁移原件来源链循环或超出已支持版本；原记录已保留。')
    seen.add(item); originals.push(item.original); item = item.previousSource
  }
  if (originals.some(value => !(value instanceof Blob) || value.size < 1 || value.size > PROJECT_LIMITS_V6.compressedBytes)) throw new Error('迁移原件字节损坏；原记录已保留。')
  return originals.reduce((sum, value) => sum + value.size, 0)
}

/** Refuse unknown databases before Dexie can upgrade or normalize their stores. */
function inspectExistingDatabase(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name); let isNew = false, settled = false
    const fail = (error: unknown) => { if (!settled) { settled = true; reject(error) } }
    request.onupgradeneeded = () => { isNew = true; request.transaction!.abort() }
    request.onerror = () => { if (isNew && request.error?.name === 'AbortError') { settled = true; resolve() } else fail(request.error ?? new Error('无法检查历史数据库。')) }
    request.onblocked = () => fail(new Error('历史数据库被其他连接阻塞；请关闭旧标签后重试。'))
    request.onsuccess = () => {
      const db = request.result
      try {
        if (settled) return
        if (db.version !== 10 || JSON.stringify(Array.from(db.objectStoreNames).sort()) !== JSON.stringify([...TABLES].sort())) throw new Error('不支持的历史数据库结构版本；原数据库已保留。')
        const transaction = db.transaction([...TABLES], 'readonly')
        for (const name of TABLES) {
          const store = transaction.objectStore(name), expected = STORE_KEYS[name]
          if (store.autoIncrement || JSON.stringify(store.keyPath) !== JSON.stringify(expected.key)
            || JSON.stringify(Array.from(store.indexNames).sort()) !== JSON.stringify(Object.keys(expected.indexes).sort())) throw new Error('不支持的历史数据库表结构；原数据库已保留。')
          for (const [indexName, keyPath] of Object.entries(expected.indexes)) {
            const index = store.index(indexName)
            if (index.keyPath !== keyPath || index.unique || index.multiEntry) throw new Error('不支持的历史数据库索引结构；原数据库已保留。')
          }
        }
        settled = true; resolve()
      } catch (error) { fail(error) } finally { db.close() }
    }
  })
}

/** Independent v5 repository; fixed history and resource bytes never roll with automatic saves. */
export class SceneRepositoryV6 {
  private readonly db: Dexie
  private readonly scenes: Table<StoredSceneV6, string>
  private readonly snapshots: Table<StoredSceneV6, [string, number]>
  private readonly namedSnapshots: Table<StoredNamedSnapshotV6, [string, string]>
  private readonly protectionSnapshots: Table<StoredNamedSnapshotV6, [string, string]>
  private readonly assetBlobs: Table<AssetBlobRecord, string>
  private readonly licenseTexts: Table<LicenseTextRecord, string>
  private readonly resourceBindings: Table<ResourceBindingsV6, [string, number]>
  private readonly namedResourceBindings: Table<NamedResourceBindingsV6, [string, string]>
  private readonly migrationSources: Table<StoredMigrationSourceV6, string>
  private readonly historyMetadata: Table<HistoryMetadataV6, string>
  private opening: Promise<void> | null = null
  private invalidated = false
  private rejectBlocked: ((error: Error) => void) | undefined

  constructor(private readonly name = 'sceneweave-m1-outdoor') {
    if (['sceneweave-m0', 'sceneweave-m1', 'sceneweave-m1-layers', 'sceneweave-m1-history', 'sceneweave-m1-composition'].includes(name)) throw new Error('历史仓库不能使用 M0/v2/v3/v4/v5 原件数据库。')
    this.db = new Dexie(name)
    this.db.version(1).stores({ scenes: 'sceneId, savedAt', snapshots: '[sceneId+revision], sceneId',
      namedSnapshots: '[sceneId+id], sceneId, id', protectionSnapshots: '[sceneId+id], sceneId, id',
      assetBlobs: 'sha256', licenseTexts: 'sha256', resourceBindings: '[sceneId+revision], sceneId',
      namedResourceBindings: '[sceneId+snapshotId], sceneId', migrationSources: 'sceneId', historyMetadata: 'sceneId' })
    this.scenes = this.db.table('scenes'); this.snapshots = this.db.table('snapshots')
    this.namedSnapshots = this.db.table('namedSnapshots'); this.protectionSnapshots = this.db.table('protectionSnapshots')
    this.assetBlobs = this.db.table('assetBlobs'); this.licenseTexts = this.db.table('licenseTexts')
    this.resourceBindings = this.db.table('resourceBindings'); this.namedResourceBindings = this.db.table('namedResourceBindings')
    this.migrationSources = this.db.table('migrationSources'); this.historyMetadata = this.db.table('historyMetadata')
    this.db.on('versionchange', () => { this.invalidated = true; this.db.close(); return false })
    this.db.on('blocked', () => { this.invalidated = true; this.db.close(); this.rejectBlocked?.(new Error('历史数据库被其他连接阻塞；请关闭旧标签后重试。')) })
  }
  async open(): Promise<void> {
    if (this.invalidated) throw new Error('历史数据库结构已变化；旧读者已停止写入，请更新应用。')
    if (this.db.isOpen()) return
    this.opening ??= this.openDatabase().finally(() => { this.opening = null }); await this.opening
  }
  private async openDatabase(): Promise<void> {
    await inspectExistingDatabase(this.name)
    if (this.invalidated) throw new Error('历史数据库结构已变化；请更新应用。')
    const blocked = new Promise<never>((_resolve, reject) => { this.rejectBlocked = reject })
    try { await Promise.race([this.db.open().then(() => { if (this.invalidated) { this.db.close(); throw new Error('历史数据库被其他连接阻塞；请关闭旧标签后重试。') } }), blocked]) }
    finally { this.rejectBlocked = undefined }
  }
  close() { this.db.close() }
  async list(): Promise<SceneSummaryV6[]> {
    await this.open()
    return (await this.scenes.orderBy('savedAt').reverse().toArray()).map(record => {
      assertScene(record); return { sceneId: record.sceneId, title: record.document.title, revision: record.revision, savedAt: record.savedAt }
    })
  }
  async listSnapshots(sceneId: string): Promise<SnapshotSummaryV6[]> {
    await this.open()
    return (await this.snapshots.where('sceneId').equals(sceneId).toArray()).sort((a, b) => b.revision - a.revision).map(record => {
      assertScene(record, sceneId); return { sceneId, revision: record.revision, savedAt: record.savedAt }
    })
  }
  private async assemble(record: StoredContentV6, ownerSceneId: string, refs: ResourceRefsV6 | undefined): Promise<CompleteProjectV6> {
    assertRefs(refs)
    const [assets, licenses, migration] = await Promise.all([this.assetBlobs.bulkGet(refs.assetHashes), this.licenseTexts.bulkGet(refs.licenseHashes), this.migrationSources.get(ownerSceneId)])
    if (assets.some(value => !value) || licenses.some(value => !value)) throw new Error('存档所需素材或许可缺失；原记录已保留。')
    if ((migration?.sourceHash ?? null) !== record.migrationSourceHash || migration && migration.sceneId !== ownerSceneId) throw new Error('迁移原件缺失或绑定损坏；原记录已保留。')
    return { document: record.document, historyIdentity: record.historyIdentity, appearance: record.appearance,
      assets: Object.fromEntries(refs.assetHashes.map((hash, i) => [hash, assets[i]!])),
      licenses: Object.fromEntries(refs.licenseHashes.map((hash, i) => [hash, licenses[i]!])), licenseBindings: refs.licenseBindings,
      ...(migration ? { migrationSource: sourceOf(migration) } : {}) }
  }
  private async assembleScene(record: StoredSceneV6): Promise<CompleteProjectV6> {
    assertScene(record)
    const refs = await this.resourceBindings.get([record.sceneId, record.revision])
    if (!hasExactKeys(refs, ['sceneId', 'revision', 'assetHashes', 'licenseHashes', 'licenseBindings']) || refs.sceneId !== record.sceneId || refs.revision !== record.revision) throw new Error('存档资源绑定身份损坏；原记录已保留。')
    return this.assemble(record, record.sceneId, refs)
  }
  private async checkedProject(project: CompleteProjectV6, hash: string): Promise<void> {
    // Real decode and provenance imports run only after the IDB read transaction closes.
    await validateCompleteProjectV6(project)
    if (await hashValidatedProjectV6(project) !== hash) throw new Error('存档内容 hash 不匹配；原记录已保留。')
  }
  async load(sceneId: string): Promise<CompleteProjectV6 | null> { return this.readProject(sceneId) }
  async loadSnapshot(sceneId: string, revision: number): Promise<CompleteProjectV6 | null> {
    if (!integer(revision)) throw new Error('快照 revision 必须为非负安全整数。')
    return this.readProject(sceneId, revision)
  }
  private async readProject(sceneId: string, revision?: number): Promise<CompleteProjectV6 | null> {
    await this.open()
    const value = await this.db.transaction('r', [...TABLES], async () => {
      const record = revision === undefined ? await this.scenes.get(sceneId) : await this.snapshots.get([sceneId, revision])
      if (!record) return null
      assertScene(record, sceneId, revision ?? record.revision)
      const metadata = await this.historyMetadata.get(sceneId); assertMetadata(metadata, sceneId)
      return { project: await this.assembleScene(record), hash: record.contentHash }
    })
    if (!value) return null
    await this.checkedProject(value.project, value.hash); return value.project
  }
  private async findNamed(id: string, sceneId?: string): Promise<StoredNamedSnapshotV6 | undefined> {
    const named = sceneId === undefined ? await this.namedSnapshots.where('id').equals(id).toArray() : [await this.namedSnapshots.get([sceneId, id])],
      protections = sceneId === undefined ? await this.protectionSnapshots.where('id').equals(id).toArray() : [await this.protectionSnapshots.get([sceneId, id])]
    for (const record of named) if (record) assertNamed(record, sceneId ?? record.sceneId, 'named')
    for (const record of protections) if (record) assertNamed(record, sceneId ?? record.sceneId, 'protection')
    const matches = [...named, ...protections].filter((value): value is StoredNamedSnapshotV6 => !!value)
    if (matches.length > 1) throw new Error('快照 ID 在多个工程中存在；请显式指定所属工程。')
    const record = matches[0]; if (record) assertNamed(record, sceneId ?? record.sceneId); return record
  }
  private async namedRecords(sceneId: string): Promise<StoredNamedSnapshotV6[]> {
    const named = await this.namedSnapshots.where('sceneId').equals(sceneId).toArray(), protections = await this.protectionSnapshots.where('sceneId').equals(sceneId).toArray()
    for (const record of named) assertNamed(record, sceneId, 'named')
    for (const record of protections) assertNamed(record, sceneId, 'protection')
    return [...named, ...protections]
  }
  private async assembleNamed(record: StoredNamedSnapshotV6): Promise<NamedSnapshotV6> {
    assertNamed(record)
    const refs = await this.namedResourceBindings.get([record.sceneId, record.id])
    if (!hasExactKeys(refs, ['sceneId', 'snapshotId', 'assetHashes', 'licenseHashes', 'licenseBindings']) || refs.sceneId !== record.sceneId || refs.snapshotId !== record.id) throw new Error('历史快照资源绑定缺失或损坏；原记录已保留。')
    return { ...summaryOf(record), project: await this.assemble(record, record.sceneId, refs) }
  }
  async listNamedSnapshots(sceneId: string): Promise<NamedSnapshotSummaryV6[]> {
    await this.open()
    return this.db.transaction('r', [...TABLES], async () => {
      const records = await this.namedRecords(sceneId)
      return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id)).map(summaryOf)
    })
  }
  async loadNamedSnapshot(id: string, sceneId?: string): Promise<NamedSnapshotV6 | null> {
    await this.open()
    const snapshot = await this.db.transaction('r', [...TABLES], async () => { const record = await this.findNamed(id, sceneId); return record ? this.assembleNamed(record) : null })
    if (snapshot) await this.checkedProject(snapshot.project, snapshot.contentHash)
    return snapshot
  }
  private async atomic<T>(signal: AbortSignal | undefined, run: () => Promise<T>): Promise<T> {
    cancelled(signal); await this.open()
    let active: Transaction | undefined
    const abort = () => active?.abort()
    signal?.addEventListener('abort', abort, { once: true })
    try { return await this.db.transaction('rw', [...TABLES], async () => {
      active = Dexie.currentTransaction!; cancelled(signal)
      const result = await run(); cancelled(signal); return result
    }) } finally { active = undefined; signal?.removeEventListener('abort', abort) }
  }
  private async putResources(project: CompleteProjectV6, signal?: AbortSignal): Promise<void> {
    for (const [hash, candidate] of Object.entries(project.assets)) {
      const existing = await this.assetBlobs.get(hash)
      if (existing) {
        if (existing.sha256 !== hash || existing.mimeType !== candidate.mimeType || existing.sizeBytes !== candidate.sizeBytes
          || existing.pixelWidth !== candidate.pixelWidth || existing.pixelHeight !== candidate.pixelHeight
          || !(existing.blob instanceof Blob) || existing.blob.type !== candidate.blob.type
          || !(await Dexie.waitFor(sameBytes(existing.blob, candidate.blob)))) throw new Error(`素材 ${hash} 的已有字节、类型或尺寸冲突；原存档已保留。`)
      } else await this.assetBlobs.add(candidate)
      cancelled(signal)
    }
    for (const [hash, candidate] of Object.entries(project.licenses)) {
      const existing = await this.licenseTexts.get(hash)
      if (existing && (existing.sha256 !== hash || existing.text !== candidate.text)) throw new Error(`许可 ${hash} 的已有内容冲突；原存档已保留。`)
      if (!existing) await this.licenseTexts.add(candidate)
      cancelled(signal)
    }
  }
  /** An omitted optional local field cannot erase a previously retained original. */
  private async captureMigration(project: CompleteProjectV6, signal?: AbortSignal): Promise<void> {
    await this.open()
    const retained = await this.migrationSources.get(project.document.sceneId)
    if (retained) {
      if (retained.sceneId !== project.document.sceneId) throw new Error('迁移来源绑定损坏；原记录已保留。')
      const source = sourceOf(retained)
      await validateMigrationSourceV6(source, project.document.sceneId, { signal })
      if (!project.migrationSource) project.migrationSource = source
    }
  }
  private async putMigration(project: CompleteProjectV6, previous?: StoredSceneV6): Promise<void> {
    const original = await this.migrationSources.get(project.document.sceneId)
    if (previous && (original?.sourceHash ?? null) !== previous.migrationSourceHash) throw new Error('迁移原件缺失或绑定损坏；原记录已保留。')
    if (!previous && original) throw new Error('迁移原件已绑定此场景身份；请另存为独立副本。')
    if (project.migrationSource) {
      if (original) {
        if (!(await Dexie.waitFor(sameMigration(sourceOf(original), project.migrationSource)))) throw new Error('迁移来源不可被后续保存替换；原件已保留。')
      } else {
        if (previous) throw new Error('已有工程不能后补不同迁移来源；请迁移为新副本。')
        await this.migrationSources.add({ ...project.migrationSource, sceneId: project.document.sceneId })
      }
    } else if (original) throw new Error('迁移原件在准备期间改变；原记录已保留。')
  }
  private async assertCurrentProject(project: CompleteProjectV6, expectedRevision: number, contentHash: string): Promise<StoredSceneV6> {
    const record = await this.scenes.get(project.document.sceneId)
    if (!record || record.revision !== expectedRevision || project.document.revision !== expectedRevision) throw new ConflictErrorV6(record?.revision ?? null)
    assertScene(record, project.document.sceneId)
    const persisted = await this.assembleScene(record)
    if (await Dexie.waitFor(hashValidatedProjectV6(persisted)) !== record.contentHash) throw new Error('当前持久文档内容 hash 损坏；原记录已保留。')
    if (contentHash !== record.contentHash) throw new Error('当前完整工程内容与持久修订不一致；请先保存或重新载入。')
    return record
  }
  async projectCAS(input: CompleteProjectV6, expectedRevision = input.document.revision): Promise<void> {
    const project = structuredClone(input)
    if (!integer(expectedRevision)) throw new Error('保存基线必须为非负 revision。')
    await validateCompleteProjectV6(project)
    const hash = await hashValidatedProjectV6(project)
    await this.open()
    await this.db.transaction('r', [...TABLES], () => this.assertCurrentProject(project, expectedRevision, hash))
  }
  private async usageInTransaction(sceneId: string): Promise<HistoryUsageV6> {
    const [metadata, named, protections, current, automatic, allNamed, allProtections, assets, licenses, originals] = await Promise.all([
      this.historyMetadata.get(sceneId), this.namedSnapshots.where('sceneId').equals(sceneId).count(), this.protectionSnapshots.where('sceneId').equals(sceneId).count(),
      this.scenes.toArray(), this.snapshots.toArray(), this.namedSnapshots.toArray(), this.protectionSnapshots.toArray(),
      this.assetBlobs.toArray(), this.licenseTexts.toArray(), this.migrationSources.toArray(),
    ])
    if (current.some(value => value.sceneId === sceneId)) assertMetadata(metadata, sceneId)
    else if (metadata || named || protections) throw new Error('历史元数据缺少所属场景；原记录已保留。')
    let resourceBytes = 0, documentBytes = 0, retainedOriginalBytes = 0
    for (const record of [...current, ...automatic]) { assertScene(record); documentBytes += projectJsonBytesV6(record) }
    for (const record of allNamed) { assertNamed(record, record.sceneId, 'named'); documentBytes += projectJsonBytesV6(record) }
    for (const record of allProtections) { assertNamed(record, record.sceneId, 'protection'); documentBytes += projectJsonBytesV6(record) }
    for (const asset of assets) {
      if (!hasExactKeys(asset, ['sha256', 'blob', 'mimeType', 'sizeBytes', 'pixelWidth', 'pixelHeight']) || !isSha256(asset.sha256)
        || !(asset.blob instanceof Blob) || !integer(asset.sizeBytes) || asset.sizeBytes !== asset.blob.size
        || asset.sizeBytes < 1 || asset.sizeBytes > PROJECT_LIMITS_V6.imageBytes) throw new Error('已有素材记录损坏；原记录已保留。')
      resourceBytes += asset.blob.size
    }
    for (const license of licenses) {
      if (!hasExactKeys(license, ['sha256', 'text']) || !isSha256(license.sha256) || typeof license.text !== 'string') throw new Error('已有许可记录损坏；原记录已保留。')
      const size = utf8Encoder.encode(license.text).length
      if (!size || size > PROJECT_LIMITS_V6.licenseBytes) throw new Error('已有许可记录超过预算或为空；原记录已保留。')
      resourceBytes += size
    }
    for (const source of originals) retainedOriginalBytes += originalBytes(source)
    return { metadataVersion: metadata?.metadataVersion ?? 0, namedCount: named, protectionCount: protections,
      resourceBytes, documentBytes, originalBytes: retainedOriginalBytes, limits: HISTORY_LIMITS_V6 }
  }
  private async assertBudgets(sceneId: string): Promise<void> {
    const usage = await this.usageInTransaction(sceneId)
    if (usage.namedCount > HISTORY_LIMITS_V6.namedPerScene || usage.protectionCount > HISTORY_LIMITS_V6.protectionPerScene) throw new Error('命名快照或恢复保护点达到保留上限；请先导出并显式删除不需要的快照。')
    if (usage.resourceBytes > HISTORY_LIMITS_V6.storedResourceBytes || usage.documentBytes > HISTORY_LIMITS_V6.storedDocumentBytes
      || usage.originalBytes > HISTORY_LIMITS_V6.storedOriginalBytes) throw new Error('历史仓库达到资源、文档或迁移原件预算；请先导出并显式清理。')
  }
  async usage(sceneId: string): Promise<HistoryUsageV6> {
    await this.open(); return this.db.transaction('r', [...TABLES], () => this.usageInTransaction(sceneId))
  }
  private async addCurrent(project: CompleteProjectV6, hash: string): Promise<void> {
    const document = project.document, latestSavedAt = (await this.scenes.orderBy('savedAt').last())?.savedAt ?? 0
    const record: StoredSceneV6 = { sceneId: document.sceneId, revision: document.revision, savedAt: Math.max(Date.now(), latestSavedAt + 1),
      documentSchemaVersion: 3, document, historyIdentity: project.historyIdentity, appearance: project.appearance, contentHash: hash, migrationSourceHash: project.migrationSource?.sourceHash ?? null }
    await this.scenes.put(record)
    await this.resourceBindings.add({ sceneId: document.sceneId, revision: document.revision, ...refsOf(project) })
    await this.snapshots.add(record)
    const older = (await this.snapshots.where('sceneId').equals(document.sceneId).primaryKeys()).sort((a, b) => b[1] - a[1]).slice(20)
    if (older.length) { await this.snapshots.bulkDelete(older); await this.resourceBindings.bulkDelete(older) }
  }
  async save(input: CompleteProjectV6, expectedRevision: number | null, options: { signal?: AbortSignal } = {}): Promise<void> {
    cancelled(options.signal)
    if (expectedRevision !== null && !integer(expectedRevision)) throw new Error('保存基线必须为非负 revision 或无记录。')
    const project = structuredClone(input)
    await validateCompleteProjectV6(project, options); await this.captureMigration(project, options.signal)
    const hash = await hashValidatedProjectV6(project)
    await this.atomic(options.signal, async () => {
      const previous = await this.scenes.get(project.document.sceneId)
      if (previous) assertScene(previous, project.document.sceneId)
      if ((previous?.revision ?? null) !== expectedRevision || previous && project.document.revision <= previous.revision) throw new ConflictErrorV6(previous?.revision ?? null)
      if (previous) {
        const metadata = await this.historyMetadata.get(project.document.sceneId); assertMetadata(metadata, project.document.sceneId)
        const before = await this.assembleScene(previous)
        if (await Dexie.waitFor(hashValidatedProjectV6(before)) !== previous.contentHash) throw new Error('当前持久文档内容 hash 损坏；原记录已保留。')
        assertFixedCompositionCompatibleV6(before, project)
        const merged = mergeHistoryIdentitiesV6(project.historyIdentity, [previous.historyIdentity])
        if (canonicalJsonV6(merged) !== canonicalJsonV6(project.historyIdentity)) throw new Error('后续保存不能丢失已分配物件身份。')
      } else {
        if (await this.historyMetadata.get(project.document.sceneId) || await this.snapshots.where('sceneId').equals(project.document.sceneId).count()
          || await this.namedSnapshots.where('sceneId').equals(project.document.sceneId).count() || await this.protectionSnapshots.where('sceneId').equals(project.document.sceneId).count()) throw new Error('场景身份已被历史记录占用；请另存为独立副本。')
        await this.historyMetadata.add({ sceneId: project.document.sceneId, metadataVersion: 0 })
      }
      await this.putMigration(project, previous); await this.putResources(project, options.signal); await this.addCurrent(project, hash)
      await this.assertBudgets(project.document.sceneId)
    })
  }
  private async metadataCAS(sceneId: string, expected?: number): Promise<HistoryMetadataV6> {
    const metadata = await this.historyMetadata.get(sceneId); assertMetadata(metadata, sceneId)
    if (expected !== undefined && (!integer(expected) || metadata.metadataVersion !== expected)) throw new HistoryConflictErrorV6()
    if (metadata.metadataVersion >= Number.MAX_SAFE_INTEGER) throw new Error('历史元数据版本已达上限。')
    return metadata
  }
  private async addNamed(snapshot: NamedSnapshotV6): Promise<void> {
    if (await this.findNamed(snapshot.id, snapshot.sceneId)) throw new Error('快照身份已存在，不能覆盖不可变内容。')
    const record: StoredNamedSnapshotV6 = { ...summaryOf(snapshot), documentSchemaVersion: 3,
      document: snapshot.project.document, historyIdentity: snapshot.project.historyIdentity, appearance: snapshot.project.appearance, migrationSourceHash: snapshot.project.migrationSource?.sourceHash ?? null }
    await (snapshot.kind === 'named' ? this.namedSnapshots : this.protectionSnapshots).add(record)
    await this.namedResourceBindings.add({ sceneId: snapshot.sceneId, snapshotId: snapshot.id, ...refsOf(snapshot.project) })
  }
  async createNamedSnapshot(input: CompleteProjectV6, name: string, options: CreateNamedSnapshotOptionsV6 = {}): Promise<NamedSnapshotV6> {
    cancelled(options.signal)
    const project = structuredClone(input), expectedRevision = options.expectedRevision ?? project.document.revision
    const capturedOptions = { ...options, sourceSnapshot: options.sourceSnapshot ? { ...options.sourceSnapshot } : undefined }
    const normalizedName = nameValue(name), kind = options.kind ?? 'named'
    if (!integer(expectedRevision) || kind !== 'named' && kind !== 'protection') throw new Error('快照类型或保存基线无效。')
    if (capturedOptions.sourceSnapshot && (!validId(capturedOptions.sourceSnapshot.id) || !isSha256(capturedOptions.sourceSnapshot.contentHash))) throw new Error('恢复来源快照身份或 hash 无效。')
    await validateCompleteProjectV6(project, options); await this.captureMigration(project, options.signal)
    const contentHash = await hashValidatedProjectV6(project)
    const snapshot: NamedSnapshotV6 = { id: crypto.randomUUID(), sceneId: project.document.sceneId, lineageId: project.historyIdentity.lineageId,
      sourceRevision: project.document.revision, name: normalizedName, kind, createdAt: new Date().toISOString(), contentHash, project }
    await this.atomic(options.signal, async () => {
      await this.assertCurrentProject(project, expectedRevision, contentHash)
      const metadata = await this.metadataCAS(project.document.sceneId, capturedOptions.expectedMetadataVersion)
      if (capturedOptions.sourceSnapshot) {
        const source = await this.findNamed(capturedOptions.sourceSnapshot.id, project.document.sceneId)
        if (!source || source.contentHash !== capturedOptions.sourceSnapshot.contentHash) throw new Error('源快照已删除或内容 hash 已变化，未创建保护快照。')
        const sourceProject = await this.assembleNamed(source)
        if (await Dexie.waitFor(hashValidatedProjectV6(sourceProject.project)) !== source.contentHash) throw new Error('源快照内容 hash 损坏，未创建保护快照。')
        mergeHistoryIdentitiesV6(project.historyIdentity, [source.historyIdentity])
      }
      await this.putMigration(project, await this.scenes.get(project.document.sceneId)); await this.putResources(project, options.signal)
      await this.addNamed(snapshot)
      await this.historyMetadata.put({ ...metadata, metadataVersion: metadata.metadataVersion + 1 })
      await this.assertBudgets(project.document.sceneId)
    })
    return snapshot
  }
  async renameNamedSnapshot(id: string, name: string, expectedContentHash: string, expectedMetadataVersion?: number, sceneId?: string): Promise<void> {
    const normalizedName = nameValue(name)
    if (!isSha256(expectedContentHash)) throw new Error('快照内容 hash 无效。')
    await this.atomic(undefined, async () => {
      const record = await this.findNamed(id, sceneId)
      if (!record || record.contentHash !== expectedContentHash) throw new HistoryConflictErrorV6()
      const metadata = await this.metadataCAS(record.sceneId, expectedMetadataVersion)
      if (record.kind !== 'named') throw new Error('恢复保护快照不能重命名。')
      await this.namedSnapshots.put({ ...record, name: normalizedName })
      await this.historyMetadata.put({ ...metadata, metadataVersion: metadata.metadataVersion + 1 })
    })
  }
  async deleteNamedSnapshot(id: string, expectedContentHash: string, expectedMetadataVersion?: number, sceneId?: string): Promise<void> {
    if (!isSha256(expectedContentHash)) throw new Error('快照内容 hash 无效。')
    await this.atomic(undefined, async () => {
      const record = await this.findNamed(id, sceneId)
      if (!record || record.contentHash !== expectedContentHash) throw new HistoryConflictErrorV6()
      const metadata = await this.metadataCAS(record.sceneId, expectedMetadataVersion)
      await (record.kind === 'named' ? this.namedSnapshots : this.protectionSnapshots).delete([record.sceneId, record.id])
      await this.namedResourceBindings.delete([record.sceneId, record.id])
      await this.historyMetadata.put({ ...metadata, metadataVersion: metadata.metadataVersion + 1 })
    })
  }
  async exportArchive(sceneId: string, ids: readonly string[] = []): Promise<HistoryArchiveV6> {
    const selectedIds = [...ids]
    if (selectedIds && (new Set(selectedIds).size !== selectedIds.length || selectedIds.some(id => !validId(id)))) throw new Error('导出快照 ID 重复或无效。')
    await this.open()
    const captured = await this.db.transaction('r', [...TABLES], async () => {
      const current = await this.scenes.get(sceneId)
      if (!current) throw new Error('工程不存在，不能导出历史。')
      const project = await this.assembleScene(current)
      const all = await this.namedRecords(sceneId)
      const wanted = selectedIds ? new Set(selectedIds) : undefined, records = all.filter(record => !wanted || wanted.has(record.id))
      if (wanted && records.length !== wanted.size) throw new Error('所选快照已删除，未导出不完整历史。')
      const snapshots: NamedSnapshotV6[] = []
      for (const record of records) snapshots.push(await this.assembleNamed(record))
      return { archive: { project, snapshots }, hash: current.contentHash }
    })
    await this.checkedProject(captured.archive.project, captured.hash)
    return validateHistoryArchiveV6(captured.archive)
  }
  async importArchive(input: HistoryArchiveV6, options: { signal?: AbortSignal } = {}): Promise<HistoryArchiveV6> {
    const validated = await validateHistoryArchiveV6(input, options), archive = forkHistoryArchiveV6(validated)
    // Historical documents stay byte-identical; sceneId on the summary denotes local ownership.
    // Local originals are scene-scoped and must agree across the imported branch.
    for (const snapshot of archive.snapshots) {
      if (snapshot.project.migrationSource && (!archive.project.migrationSource
        || !(await sameMigration(snapshot.project.migrationSource, archive.project.migrationSource)))) throw new Error('历史快照迁移来源不一致；请使用不含本地原件的便携历史备份。')
      if (archive.project.migrationSource) snapshot.project.migrationSource = archive.project.migrationSource
    }
    await validateCompleteProjectV6(archive.project, options)
    const hash = await hashValidatedProjectV6(archive.project)
    await this.atomic(options.signal, async () => {
      const sceneId = archive.project.document.sceneId
      if (await this.scenes.get(sceneId) || await this.historyMetadata.get(sceneId)) throw new ConflictErrorV6((await this.scenes.get(sceneId))?.revision ?? null)
      await this.putMigration(archive.project); await this.putResources(archive.project, options.signal)
      await this.historyMetadata.add({ sceneId, metadataVersion: archive.snapshots.length ? 1 : 0 })
      await this.addCurrent(archive.project, hash)
      for (const snapshot of archive.snapshots) { await this.putResources(snapshot.project, options.signal); await this.addNamed(snapshot) }
      await this.assertBudgets(sceneId)
    })
    return archive
  }
}
