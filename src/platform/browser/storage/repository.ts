import Dexie, { type Table, type Transaction } from 'dexie'
import type { HistoryDirectory, ProjectDirectoryPage, ProjectDirectoryQuery, ProjectDirectoryStore } from '../../../application/ports/project-directory.js'
import type { AutomaticSummary, CreateSnapshotOptions, HistoryOverview, ProjectSaveGuard, ProjectStore, ProjectSummary, SaveProjectOptions, SnapshotReadSession, SourcePreservationGuard, StorageUsage } from '../../../application/ports/project-store.js'
export type { AutomaticSummary, CreateSnapshotOptions, HistoryOverview, ProjectSaveGuard, ProjectSummary, SaveProjectOptions, SnapshotReadSession, SourcePreservationGuard, StorageUsage } from '../../../application/ports/project-store.js'
import type { ProjectBundle, ProjectData, ResourceBytePort, SnapshotSummary } from '../../../shared/model/project.js'
import type { PreparationContext } from '../../../shared/ports/runtime.js'
import type { CancellationSignal, CompleteValidationOptions, ResourceOptions } from '../../../shared/ports/resources.js'
import { checkCancelled } from '../../../shared/ports/resources.js'
import { mergeIdentityRecords } from '../../../shared/history/identity.js'
import { assertFixedProjectCompatible, validateSnapshotSummary, validateHistoryArchive, consumeHistoryArchive, type HistoryArchive, type SnapshotBundle } from '../../../shared/project/history.js'
import { captureProjectBundleInput, createMemoryResources, getVerifiedProjectBundle, tryDerivedProjectBundle, validateProjectBundle, validateProjectSnapshot, validateProjectBundles, type VerifiedProjectBundle } from '../../../shared/project/resources.js'
import { checkedContentBlock, createProjectMaterializer, isProjectBlockManifest, validateProjectBlockManifest, type ProjectContentBlock } from './content-blocks.js'
import { CONTENT_PAYLOAD_FIELDS } from './content-block-middleware.js'
import { waitForStorageTransaction } from './transaction-lifetime.js'
import { canRetainEncodedSnapshot, matchingEncodedSnapshot, pinEncodedSnapshot, prepareEncodedProjectDelta, prepareEncodedSnapshot, releaseEncodedSnapshot, type ContentSlot, type EncodedSnapshot, type PreparedProjectDelta } from './content-context.js'
import { inspectImageBytes } from '../../../shared/project/image-bytes.js'
import { getProjectLocalTransaction, getProjectTransactionReceipt, projectContentHash, validateProjectData, releaseProjectLocalTransaction, releaseProjectTransactionReceipt } from '../../../shared/project/validate.js'
import { canonicalProjectCoordinates, decodeProjectCoordinates } from '../../../shared/aggregates/scene-coordinates.js'
import { projectResourceRecords, projectSourceRecords } from '../../../shared/project/source-resources.js'
import { captureBytes, sha256Bytes } from '../../../shared/project/binary.js'
import { canonicalJson, captureJson, encodeUtf8, equalOwnedJson } from '../../../shared/validation/json.js'
import { inspectProjectDatabase, ProjectDatabase, PROJECT_DATABASE_NAME, PROJECT_TABLES, type BindingKind, type StoredAutomatic,
  type StoredBinding, type StoredBytes, type StoredHistoryMetadata, type StoredProject, type StoredSnapshot } from './database.js'

import { StorageAccounting, type StorageTotals } from './storage-accounting.js'
import { collectUnusedContentBlocks, discardAutomaticHistory, removeOwnedProject } from './project-maintenance.js'
import { prepareStorageAudit, StorageAuditConflictError, type StorageAuditPreparation } from './storage-audit.js'
import { auditCapturedHistoryInWorker } from './history-audit-client.js'
import type { CapturedHistoryVersion } from './history-audit-message.js'
import type { HistoryHead, HistoryPin } from './history-records.js'
import { IncrementalHistory, migrationManifest, historyVersionBytes, historyHeadBytes, historyPinBytes, type HistoryReadSession, type HistoryVersionSummary } from './incremental-history.js'
import { collectUnusedResources, type UnusedResourceCollection } from './history-maintenance.js'
import { readProjectDirectory, readHistoryDirectory } from './directory.js'

export const PROJECT_STORAGE_LIMITS = Object.freeze({ resourceBytes: 256 * 1024 * 1024, documentBytes: 128 * 1024 * 1024,
  automatic: 20, named: 32, protection: 32, imported: 20 } as const)
const hashValue = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
const validId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 256 && value !== '__proto__'
function exact(input: unknown, keys: readonly string[]): asserts input is Record<string, unknown> {
  if (!input || typeof input !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) throw new Error('存档须为普通数据记录。')
  const descriptors = Object.getOwnPropertyDescriptors(input)
  if (Reflect.ownKeys(input).length !== keys.length || !keys.every(key => descriptors[key]?.enumerable && 'value' in descriptors[key])) throw new Error('存档字段缺失或包含未知、访问器、隐藏或Symbol字段。')
}
function id(input: unknown): asserts input is string { if (!validId(input)) throw new Error('工程或历史ID无效。') }
function time(input: unknown): asserts input is string { if (typeof input !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(input) || !Number.isFinite(Date.parse(input))) throw new Error('存档时间无效。') }
function name(input: unknown): string {
  if (typeof input !== 'string' || !input.trim() || Array.from(input.trim()).length > 80) throw new Error('快照名称须为1–80个字符。')
  return input.trim()
}
interface CheckedContent { hash: string; byteLength: number }
interface ContentChecks { entries: Map<string, CheckedContent>; pins: Map<ContentSlot, { json: string; checked: CheckedContent }>; retainedCharacters: number }
// UTF-16 string storage is bounded independently of the persisted byte budget.
const CONTENT_CHECK_CHARACTER_LIMIT = 4 * 1024 * 1024
const createContentChecks = (): ContentChecks => ({ entries: new Map(), pins: new Map(), retainedCharacters: 0 })
// Only a selected live transaction owns this table. Fresh IDB clones must
// match the entire inspected canonical JSON, never only an ID or claimed hash.
const transactionContentChecks = new WeakMap<object, ContentChecks>()
function rememberCheckedContent(contents: ContentChecks, json: string, checked: CheckedContent, slot?: ContentSlot): void {
  // Required before/after/branch proofs belong to this operation. An optional
  // cache budget must never evict one while another consumer still needs it.
  if (slot) { contents.pins.set(slot, { json, checked }); return }
  if (contents.entries.has(json) || json.length > CONTENT_CHECK_CHARACTER_LIMIT) return
  while (contents.retainedCharacters + json.length > CONTENT_CHECK_CHARACTER_LIMIT) {
    const oldest = contents.entries.keys().next().value!
    contents.entries.delete(oldest)
    contents.retainedCharacters -= oldest.length
  }
  contents.entries.set(json, checked)
  contents.retainedCharacters += json.length
}
function checkedContent(project: ProjectData, contents: ContentChecks, slot?: ContentSlot): CheckedContent {
  const transaction = Dexie.currentTransaction
  const snapshot = transaction && matchingEncodedSnapshot(transaction.idbtrans, project)
  const json = snapshot?.encoded.canonical ?? canonicalProjectCoordinates(project)
  let checked = snapshot ? { hash: snapshot.encoded.contentHash, byteLength: snapshot.encoded.byteLength }
    : [...contents.pins.values()].find(pin => pin.json === json)?.checked ?? contents.entries.get(json)
  if (!checked) {
    validateProjectData(project.document.aggregateCoordinates?.encoding === 'local' ? decodeProjectCoordinates(project) : project)
    const bytes = encodeUtf8(json)
    checked = { hash: sha256Bytes(bytes), byteLength: bytes.length }
    rememberCheckedContent(contents, json, checked)
  }
  if (slot) rememberCheckedContent(contents, json, checked, slot)
  return checked
}
/** Called only with this history reader's complete, strictly reconstructed result. */
function rememberReconstructedContent(project: ProjectData, hash: string): void {
  const transaction = Dexie.currentTransaction, contents = transaction && transactionContentChecks.get(transaction)
  if (!contents) return
  const json = canonicalProjectCoordinates(project)
  if (json.length > CONTENT_CHECK_CHARACTER_LIMIT) return
  rememberCheckedContent(contents, json, { hash, byteLength: encodeUtf8(json).length })
}
function contentHashInTransaction(project: ProjectData): string {
  const transaction = Dexie.currentTransaction, contents = transaction && transactionContentChecks.get(transaction)
  return contents ? checkedContent(project, contents).hash : projectContentHash(project)
}
async function withTransactionContentChecks<T>(run: () => Promise<T>): Promise<T> {
  const transaction = Dexie.currentTransaction
  if (!transaction) throw new Error('完整内容检查须绑定当前存档事务。')
  if (transactionContentChecks.has(transaction)) return run()
  transactionContentChecks.set(transaction, createContentChecks())
  try { return await run() }
  finally { transactionContentChecks.delete(transaction) }
}
function assertContent(project: ProjectData, hash: string): void {
  if (!hashValue(hash) || contentHashInTransaction(project) !== hash) throw new Error('存档完整内容hash损坏；原记录保持。')
}
export function assertCurrent(record: StoredProject, content: typeof assertContent = assertContent): void {
  exact(record, ['sceneId', 'revision', 'savedAt', 'contentHash', 'status', 'conversionJobId', 'project'])
  id(record.sceneId); time(record.savedAt)
  if (!integer(record.revision) || record.sceneId !== record.project?.document.sceneId || record.revision !== record.project.document.revision
    || !['preparing', 'ready'].includes(record.status) || record.conversionJobId !== null && !validId(record.conversionJobId)
    || record.status === 'preparing' && record.conversionJobId === null) throw new Error('当前工程身份、版本或发布状态损坏。')
  content(record.project, record.contentHash)
}
export function assertAutomatic(record: StoredAutomatic, content: typeof assertContent = assertContent): void {
  exact(record, ['ownerSceneId', 'revision', 'savedAt', 'contentHash', 'project'])
  id(record.ownerSceneId); time(record.savedAt)
  if (!integer(record.revision) || record.project?.document.sceneId !== record.ownerSceneId || record.project.document.revision !== record.revision) throw new Error('自动快照身份损坏。')
  content(record.project, record.contentHash)
}
function summaryOf(record: SnapshotSummary): SnapshotSummary {
  return { id: record.id, ownerSceneId: record.ownerSceneId, lineageId: record.lineageId, sourceRevision: record.sourceRevision,
    name: record.name, kind: record.kind, createdAt: record.createdAt, contentHash: record.contentHash }
}
export function assertSnapshot(record: StoredSnapshot, imported = false, content: typeof assertContent = assertContent): void {
  exact(record, ['id', 'ownerSceneId', 'lineageId', 'sourceRevision', 'name', 'kind', 'createdAt', 'contentHash', 'project'])
  validateSnapshotSummary(summaryOf(record))
  if ((record.kind === 'imported-auto') !== imported || record.sourceRevision !== record.project?.document.revision
    || record.lineageId !== record.project.historyIdentity.lineageId) throw new Error('历史快照归属、类型或版本损坏。')
  content(record.project, record.contentHash)
}
function assertMetadata(record: StoredHistoryMetadata | undefined, owner: string): asserts record is StoredHistoryMetadata {
  exact(record, ['ownerSceneId', 'metadataVersion'])
  if (record.ownerSceneId !== owner || !integer(record.metadataVersion)) throw new Error('历史元数据缺失或损坏。')
}
function refs(project: ProjectData) {
  return { assetHashes: Object.keys(project.assets).sort(), sourceHashes: [...projectSourceRecords(project).keys()].sort(),
    licenseHashes: Object.keys(project.licenses).sort(), licenseBindings: project.licenseBindings }
}
function binding(project: ProjectData, ownerSceneId: string, kind: BindingKind, recordId: string): StoredBinding {
  return { ownerSceneId, kind, recordId, ...refs(project) }
}
function assertBinding(record: StoredBinding | undefined, project: ProjectData, owner: string, kind: BindingKind, recordId: string): void {
  exact(record, ['ownerSceneId', 'kind', 'recordId', 'assetHashes', 'sourceHashes', 'licenseHashes', 'licenseBindings'])
  if (canonicalJson(record) !== canonicalJson(binding(project, owner, kind, recordId))) throw new Error('工程资源绑定缺失或与完整内容不符。')
}
function bytesOf(record: StoredBytes, maximum = 20 * 1024 * 1024): Uint8Array {
  exact(record, ['sha256', 'bytes'])
  if (!hashValue(record.sha256)) throw new Error('资源hash无效。')
  const bytes = captureBytes(record.bytes, maximum)
  if (!bytes.length || sha256Bytes(bytes) !== record.sha256) throw new Error('存档实际资源字节hash损坏。')
  return bytes
}
/** Dexie cursor callbacks must not leak exceptions through its event wrapper. */
function scanRows<T>(table: Pick<Table<T>, 'each'>, inspect: (row: T) => void): Promise<void> {
  let failed = false, failure: unknown
  return table.each(row => {
    if (failed) return
    try { inspect(row) }
    catch (error) { failed = true; failure = error }
  }).then(() => { if (failed) throw failure })
}
export class ProjectConflictError extends Error {
  constructor(readonly currentRevision: number | null) { super(`本地工程版本冲突（当前版本${currentRevision ?? '无记录'}）；请另存或重新载入。`); this.name = 'ProjectConflictError' }
}
export class HistoryMetadataConflictError extends Error {
  constructor() { super('历史元数据或来源快照已变化，请刷新后重试。'); this.name = 'HistoryMetadataConflictError' }
}
interface SnapshotReadState {
  closed: boolean
  busy: boolean
  writes: Set<Transaction>
  history: HistoryReadSession
  cached: { json: string; bundle: VerifiedProjectBundle } | null
}
export interface ProjectRepositoryOptions {
  name?: string
  validation: CompleteValidationOptions
  runtime: PreparationContext
}
interface ResourceAssembly {
  bytes: Map<string, Uint8Array>
  byteLength: number
  resources: ResourceBytePort
  maximumCount?: number
}
/** One native repository, independent of every legacy writer. Reads and public saves verify real bytes. */
export class ProjectRepository implements ProjectStore, ProjectDirectoryStore {
  private readonly maintenanceReviews = new WeakMap<object, { owner: string; epoch: number }>()
  readonly database: ProjectDatabase
  private opening: Promise<void> | null = null
  private invalidated = false
  private readonly accounting: StorageAccounting
  private readonly history: IncrementalHistory
  private readonly historyMigrations = new Map<string, Promise<void>>()
  private readonly auditSignals = new WeakMap<Transaction, CancellationSignal>()
  private readonly atomicTransactions = new WeakSet<Transaction>()
  private readonly preparingAudits = new Set<AbortController>()
  private readonly snapshotReads = new WeakMap<SnapshotReadSession, SnapshotReadState>()
  private readonly activeSnapshotReads = new Set<SnapshotReadState>()
  // One bounded optional lease, never a disk-freshness receipt. The next final
  // transaction still reads every manifest/block and compares actual bytes.
  private savedEncoding: EncodedSnapshot | undefined
  // A close can race an in-flight validation/transaction. A later continuation
  // must not publish an optional lease into that closed repository generation.
  private saveEpoch = 0
  constructor(private readonly options: ProjectRepositoryOptions) {
    this.database = new ProjectDatabase(options.name ?? PROJECT_DATABASE_NAME)
    this.history = new IncrementalHistory(this.database, contentHashInTransaction, rememberReconstructedContent)
    this.accounting = new StorageAccounting(this.database, () => this.scanTotals(), (table, row) => this.rowCost(table, row))
    this.database.on('versionchange', () => { this.invalidated = true; this.database.close(); return false })
    this.database.on('blocked', () => { this.invalidated = true; this.database.close() })
    this.database.on('close', () => {
      this.saveEpoch++
      for (const controller of this.preparingAudits) controller.abort()
      if (this.savedEncoding) releaseEncodedSnapshot(this.savedEncoding)
      this.savedEncoding = undefined
      for (const state of this.activeSnapshotReads) this.closeSnapshotRead(state)
    })
  }
  async open(): Promise<void> {
    if (this.invalidated) throw new Error('工程数据库结构已变化，请更新应用后重新打开。')
    // Dexie exposes the native handle during upgradeneeded. Ordinary reads and
    // imports must wait until the shared open has finished that transaction.
    if (this.opening) return this.opening
    if (this.database.isOpen()) return
    this.opening = (async () => {
      await inspectProjectDatabase(this.database.name)
      if (this.invalidated) throw new Error('工程数据库连接已失效。')
      await this.database.open()
      if (this.invalidated) { this.database.close(); throw new Error('工程数据库连接已失效。') }
    })().finally(() => { this.opening = null })
    return this.opening
  }
  private async legacyHistoryRows(owner: string) {
    const current = await this.database.projects.get(owner)
    if (!current || current.status !== 'ready') return null
    assertCurrent(current)
    const metadata = await this.database.historyMetadata.get(owner); assertMetadata(metadata, owner)
    const automatic = await this.database.automaticSnapshots.where('ownerSceneId').equals(owner).toArray()
    const snapshots = await this.database.snapshots.where('ownerSceneId').equals(owner).toArray()
    const imported = await this.database.importedSnapshots.where('ownerSceneId').equals(owner).toArray()
    automatic.forEach(row => assertAutomatic(row)); snapshots.forEach(row => assertSnapshot(row)); imported.forEach(row => assertSnapshot(row, true))
    assertBinding(await this.database.resourceBindings.get([owner, 'current', 'current']), current.project, owner, 'current', 'current')
    for (const row of automatic) assertBinding(await this.database.resourceBindings.get([owner, 'automatic', String(row.revision)]), row.project, owner, 'automatic', String(row.revision))
    for (const row of [...snapshots, ...imported]) assertBinding(await this.database.resourceBindings.get([owner, row.kind, row.id]), row.project, owner, row.kind, row.id)
    return { current, automatic, snapshots, imported, metadataVersion: metadata.metadataVersion }
  }
  private async historyCopyFingerprint(owner: string): Promise<string> {
    const head = await this.database.historyHeads.get(owner)
    const versions = await this.database.historyVersions.where('ownerSceneId').equals(owner).toArray()
    const pins = await this.database.historyPins.where('ownerSceneId').equals(owner).toArray()
    // Re-prove each body against its declared record hash at the final CAS.
    // A cold resource check must not authorize a different/corrupt old root.
    if (head) historyHeadBytes(head)
    versions.forEach(row => { historyVersionBytes(row) })
    pins.forEach(row => { historyPinBytes(row) })
    const sort = (rows: { id: string; recordHash: string }[]) => rows.map(row => ({ id: row.id, recordHash: row.recordHash })).sort((a, b) => a.id.localeCompare(b.id))
    return sha256Bytes(encodeUtf8(canonicalJson({ head: head?.recordHash ?? null, versions: sort(versions), pins: sort(pins) })))
  }
  /** Source rows remain intact. A separate cold read verifies every copied project and real resource before publication. */
  private async ensureHistory(owner: string, options: ResourceOptions = {}): Promise<void> {
    id(owner); checkCancelled(options.signal); await this.open()
    const existing = this.historyMigrations.get(owner)
    if (existing) return existing
    const pending = (async () => {
      const source = await this.database.transaction('r', PROJECT_TABLES, () => waitForStorageTransaction(withTransactionContentChecks(async () => {
        const head = await this.history.head(owner)
        if (head?.status === 'ready') return null
        const rows = await this.legacyHistoryRows(owner)
        if (!rows) return null
        const bundles = [await this.assembled(rows.current.project, owner, 'current', 'current')]
        for (const row of rows.automatic) bundles.push(await this.assembled(row.project, owner, 'automatic', String(row.revision)))
        for (const row of [...rows.snapshots, ...rows.imported]) bundles.push(await this.assembled(row.project, owner, row.kind, row.id))
        return { rows, bundles }
      })))
      if (!source) return
      for (let offset = 0; offset < source.bundles.length; offset += 85) await validateProjectBundles(source.bundles.slice(offset, offset + 85), this.validation(options))
      const { current, automatic, snapshots, imported, metadataVersion } = source.rows
      const manifest = migrationManifest(current, automatic, snapshots, imported, metadataVersion)
      await this.atomic(options, async () => {
        const head = await this.history.head(owner)
        if (head?.status === 'ready') return
        const latest = await this.legacyHistoryRows(owner)
        if (!latest || migrationManifest(latest.current, latest.automatic, latest.snapshots, latest.imported, latest.metadataVersion) !== manifest) throw new HistoryMetadataConflictError()
        if (!head) await this.history.initialize(current, automatic, snapshots, imported, metadataVersion)
        else if (head.migration?.sourceManifestHash !== manifest) throw new HistoryMetadataConflictError()
        await this.assertBudgets(owner)
      }, true)
      const cold = await this.database.transaction('r', PROJECT_TABLES, () => waitForStorageTransaction(withTransactionContentChecks(async () => {
        const head = await this.history.head(owner)
        if (!head || head.migration?.sourceManifestHash !== manifest) throw new HistoryMetadataConflictError()
        await this.history.audit(owner, options.signal, false)
        const versions = await this.history.versions(owner), pins = await this.history.pins(owner)
        const expectedHashes = new Set([current.contentHash, ...automatic.map(row => row.contentHash), ...snapshots.map(row => row.contentHash), ...imported.map(row => row.contentHash)])
        if (versions.length !== expectedHashes.size || versions.some(row => row.parentId !== null || row.id !== `root:${row.contentHash}` || !expectedHashes.has(row.contentHash))
          || head.activeVersionId !== `root:${current.contentHash}` || pins.length !== snapshots.length + imported.length) throw new HistoryMetadataConflictError()
        for (const source of [...snapshots, ...imported]) {
          const pin = pins.find(row => row.id === source.id)
          if (!pin || pin.versionId !== `root:${source.contentHash}` || canonicalJson(summaryOf(pin)) !== canonicalJson(summaryOf(source))) throw new HistoryMetadataConflictError()
        }
        const bundles: ProjectBundle[] = []
        for (const summary of await this.history.versions(owner)) {
          const version = await this.history.readVersion(owner, summary.id)
          if (!version) throw new Error('增量历史迁移副本缺失。')
          bundles.push(await this.assembledUnbound(version.project))
        }
        return { bundles, fingerprint: await this.historyCopyFingerprint(owner) }
      })))
      for (let offset = 0; offset < cold.bundles.length; offset += 85) await validateProjectBundles(cold.bundles.slice(offset, offset + 85), this.validation(options))
      await this.atomic(options, async () => {
        const head = await this.history.head(owner)
        if (head?.status === 'ready') return
        const latest = await this.legacyHistoryRows(owner)
        if (!latest || migrationManifest(latest.current, latest.automatic, latest.snapshots, latest.imported, latest.metadataVersion) !== manifest
          || head?.migration?.sourceManifestHash !== manifest || await this.historyCopyFingerprint(owner) !== cold.fingerprint) throw new HistoryMetadataConflictError()
        await this.history.activate(owner, current.contentHash, current.revision, metadataVersion)
      }, true)
    })().finally(() => { this.historyMigrations.delete(owner) })
    this.historyMigrations.set(owner, pending)
    return pending
  }
  private async snapshotRecord(owner: string, snapshotId: string, current?: StoredProject, readSession?: SnapshotReadSession): Promise<StoredSnapshot | null> {
    const head = await this.history.head(owner)
    if (head?.status === 'ready') return this.history.readPin(owner, snapshotId, current, readSession && this.snapshotReadState(readSession).history)
    return await this.database.snapshots.get([owner, snapshotId]) ?? await this.database.importedSnapshots.get([owner, snapshotId]) ?? null
  }
  async listHistoryVersions(owner: string): Promise<{ activeVersionId: string | null; versions: HistoryVersionSummary[] }> {
    await this.ensureHistory(owner)
    return this.database.transaction('r', PROJECT_TABLES, async () => {
      const current = await this.database.projects.get(owner)
      if (!current || current.status !== 'ready') return { activeVersionId: null, versions: [] }
      assertCurrent(current)
      const head = await this.history.head(owner)
      if (!head || head.status !== 'ready' || head.savedRevision !== current.revision || head.contentHash !== current.contentHash) throw new Error('当前保存与历史活动版本不一致。')
      return { activeVersionId: head.activeVersionId, versions: await this.history.versions(owner) }
    })
  }
  /** One shared read transaction for the history panel overview. Every list keeps
   * its own row, binding and byte validation; only the repeated full content
   * check of the same current row shares this transaction's exact-content table.
   * Zone-sensitive reads run before any nested native async resumption can drop
   * the transaction scope; pin references are cross-checked against the already
   * strictly validated version rows of this same transaction. */
  async historyOverview(ownerSceneId: string): Promise<HistoryOverview> {
    id(ownerSceneId); await this.ensureHistory(ownerSceneId)
    const overview = await this.database.transaction('r', PROJECT_TABLES, () => waitForStorageTransaction(withTransactionContentChecks(async () => {
      const current = await this.database.projects.get(ownerSceneId)
      if (!current || current.status !== 'ready') throw new Error('当前工程不存在。')
      assertCurrent(current)
      const head = await this.history.head(ownerSceneId)
      if (!head || head.status !== 'ready' || head.savedRevision !== current.revision || head.contentHash !== current.contentHash) throw new Error('当前保存与历史活动版本不一致。')
      const versions = await this.history.versions(ownerSceneId)
      const usage = await this.usageInTransaction(ownerSceneId)
      const versionById = new Map(versions.map(version => [version.id, version]))
      const pins: SnapshotSummary[] = []
      for (const row of await this.database.historyPins.where('ownerSceneId').equals(ownerSceneId).toArray()) {
        historyPinBytes(row)
        const version = versionById.get(row.versionId)
        if (!version || version.contentHash !== row.contentHash || version.revision !== row.sourceRevision) throw new Error('增量历史快照引用断链。')
        pins.push(summaryOf(row))
      }
      return {
        snapshots: pins.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id)),
        usage,
        history: { activeVersionId: head.activeVersionId, versions },
      }
    })))
    return overview
  }
  async loadHistoryVersion(owner: string, versionId: string, options: ResourceOptions = {}): Promise<ProjectBundle | null> {
    id(versionId); await this.ensureHistory(owner, options)
    const bundle = await this.database.transaction('r', PROJECT_TABLES, async () => {
      const current = await this.database.projects.get(owner), head = await this.history.head(owner)
      if (!current || current.status !== 'ready' || head?.status !== 'ready') return null
      assertCurrent(current)
      const value = await this.history.readVersion(owner, versionId)
      return value ? this.assembledUnbound(value.project) : null
    })
    return bundle ? validateProjectBundle(bundle, this.validation(options)) : null
  }
  close(): void {
    for (const controller of this.preparingAudits) controller.abort()
    for (const state of this.activeSnapshotReads) this.closeSnapshotRead(state)
    if (this.savedEncoding) releaseEncodedSnapshot(this.savedEncoding)
    this.savedEncoding = undefined
    this.accounting.invalidate(); this.database.close()
  }
  private validation(options: ResourceOptions = {}): CompleteValidationOptions { return { images: this.options.validation.images, svg: this.options.validation.svg, signal: options.signal ?? this.options.validation.signal } }
  private async prepareAccounting(options: ResourceOptions = {}): Promise<StorageAuditPreparation | undefined> {
    // Nested native transactions retain their original isolation/rollback path.
    if (Dexie.currentTransaction || !await this.accounting.needsScan()) return
    const controller = new AbortController(), abort = () => controller.abort()
    this.preparingAudits.add(controller); options.signal?.addEventListener?.('abort', abort, { once: true })
    const signal: CancellationSignal = { get aborted() { return controller.signal.aborted || options.signal?.aborted === true },
      addEventListener: controller.signal.addEventListener.bind(controller.signal), removeEventListener: controller.signal.removeEventListener.bind(controller.signal) }
    const cleanup = () => { this.preparingAudits.delete(controller); options.signal?.removeEventListener?.('abort', abort) }
    try {
      const prepared = await prepareStorageAudit(this.database, rows => this.auditCapturedTotals(rows, signal), signal)
      if (!prepared) { cleanup(); return }
      return { confirm: (transaction, currentSignal) => prepared.confirm(transaction, currentSignal ?? signal),
        release() { prepared.release(); cleanup() } }
    } catch (error) { cleanup(); throw error }
  }
  private async atomic<T>(options: ResourceOptions, run: () => Promise<T>, shareContentChecks = false): Promise<T> {
    checkCancelled(options.signal); await this.open(); checkCancelled(options.signal)
    for (let attempt = 0; ; attempt++) {
    const prepared = await this.prepareAccounting(options)
    let executing = false
    try { return await this.database.transaction('rw', PROJECT_TABLES, async () => {
      this.atomicTransactions.add(Dexie.currentTransaction!)
      if (options.signal) this.auditSignals.set(Dexie.currentTransaction!, options.signal)
      const execute = async () => {
        checkCancelled(options.signal)
        executing = true
        const result = await run()
        checkCancelled(options.signal); return result
      }
      // All mutations share one bounded exact-content table and a measured budget receipt.
      void shareContentChecks
      return withTransactionContentChecks(() => this.accounting.run(execute, prepared))
    }) } catch (error) {
      // Confirmation precedes every mutation/caller callback. A changed
      // snapshot can be re-audited safely; never retry an executed operation,
      // a CAS conflict, worker failure, unknown outcome or metered request.
      if (!(error instanceof StorageAuditConflictError) || executing || attempt >= 2) throw error
      checkCancelled(options.signal)
    } finally { prepared?.release() }
    }
  }
  private async assembled(project: ProjectData, owner: string, kind: BindingKind, recordId: string, shared?: ResourceAssembly, expectedBytes?: ReadonlyMap<string, Uint8Array>): Promise<ProjectBundle> {
    assertBinding(await this.database.resourceBindings.get([owner, kind, recordId]), project, owner, kind, recordId)
    return this.assembledUnbound(project, shared, expectedBytes)
  }
  private async assembledUnbound(project: ProjectData, shared?: ResourceAssembly, expectedBytes?: ReadonlyMap<string, Uint8Array>): Promise<ProjectBundle> {
    const pairs: [string, Uint8Array][] = []
    for (const [hash, size] of projectResourceRecords(project)) {
      let bytes = shared?.bytes.get(hash)
      if (!bytes) {
        if (shared && (shared.bytes.size >= (shared.maximumCount ?? 768) || shared.byteLength + size > PROJECT_STORAGE_LIMITS.resourceBytes)) throw new Error('联合图片/SVG源超过数量或字节保护预算。')
        const row = await this.database.resources.get(hash)
        if (!row || row.sha256 !== hash) throw new Error('工程实际资源字节缺失。')
        bytes = bytesOf(row, size)
        if (shared) { shared.bytes.set(hash, bytes); shared.byteLength += bytes.length }
      }
      if (bytes.length !== size) throw new Error('工程实际资源长度不符。')
      if (expectedBytes) {
        const original = expectedBytes.get(hash)
        if (!original || bytes.length !== original.length || !bytes.every((byte, index) => byte === original[index])) throw new Error('已验证资源闭包与实际持久字节不符。')
      }
      if (!shared) pairs.push([hash, bytes])
    }
    for (const [hash, license] of Object.entries(project.licenses)) {
      const row = await this.database.licenseTexts.get(hash)
      exact(row, ['sha256', 'text'])
      if (row.sha256 !== hash || row.text !== license.text) throw new Error('工程实际许可正文缺失或损坏。')
    }
    return { project, resources: shared?.resources ?? createMemoryResources(new Map(pairs)) }
  }
  async list(): Promise<ProjectSummary[]> {
    await this.open()
    return (await this.database.projects.where('status').equals('ready').toArray()).map(record => {
      assertCurrent(record)
      return { sceneId: record.sceneId, title: record.project.document.title, revision: record.revision, savedAt: record.savedAt, conversionJobId: record.conversionJobId }
    }).sort((a, b) => b.savedAt.localeCompare(a.savedAt) || a.sceneId.localeCompare(b.sceneId))
  }
  /** Navigation-only reads never certify the unread project/resource closure. */
  async projectDirectory(query: ProjectDirectoryQuery = {}): Promise<ProjectDirectoryPage> {
    const owned = captureJson(query)
    await this.open()
    return this.database.transaction('r', this.database.projects, this.database.projectContentBlocks, () => readProjectDirectory(this.database, owned))
  }
  async historyDirectory(ownerSceneId: string): Promise<HistoryDirectory> {
    id(ownerSceneId); await this.open()
    return this.database.transaction('r', [this.database.projects, this.database.historyMetadata, this.database.historyHeads,
      this.database.historyVersions, this.database.historyPins, this.database.snapshots, this.database.importedSnapshots],
      () => readHistoryDirectory(this.database, ownerSceneId))
  }
  /** A confirmation covers the selected project's currently visible revision.
   * Raw reads allow recovery even when the selected content is unreadable. */
  async reviewProjectMaintenance(owner: string, revision?: number): Promise<object> {
    id(owner); await this.open()
    const epoch = await this.database.transaction('r', this.database.projects, this.database.storageState, async () => {
      const current = await this.database.rawJsonRecord('projects', owner) as StoredProject | undefined
      if (!current || revision !== undefined && revision !== current.revision) throw new ProjectConflictError(current?.revision ?? null)
      return this.accounting.storageEpoch()
    })
    const review = Object.freeze({})
    this.maintenanceReviews.set(review, { owner, epoch })
    return review
  }
  recentStorageTotals(): StorageTotals | undefined { return this.accounting.recentTotals() }
  recentStorageChange(): StorageTotals | undefined { return this.accounting.recentChange() }
  private async confirmedMaintenance<T>(review: object, options: ResourceOptions, run: (owner: string) => Promise<T>): Promise<T> {
    const checked = this.maintenanceReviews.get(review)
    if (!checked) throw new Error('请先选择并重新确认要整理的工程。')
    this.maintenanceReviews.delete(review)
    checkCancelled(options.signal)
    return this.database.transaction('rw', PROJECT_TABLES, async () => this.accounting.runMaintenance(async () => {
      checkCancelled(options.signal)
      const result = await run(checked.owner)
      checkCancelled(options.signal)
      return result
    }, checked.epoch))
  }
  removeProject(review: object, options: ResourceOptions = {}): Promise<void> {
    return this.confirmedMaintenance(review, options, owner => removeOwnedProject(owner, options.signal))
  }
  private async reclaimUnreferenced(options: ResourceOptions, recoverOrphans: boolean) {
    const result = await collectUnusedResources(this.database, { assertCurrent, assertAutomatic, assertSnapshot }, { ...options, recoverOrphans })
    const blockCount = await collectUnusedContentBlocks(this.database, options.signal)
    return { ...result, blockCount }
  }
  /** Maintenance verifies every surviving owner before touching shared bytes.
   * A corrupt orphan can be removed by its key after that closure is proved. */
  async reclaimProjectStorage(options: ResourceOptions = {}): Promise<UnusedResourceCollection & { blockCount: number }> {
    checkCancelled(options.signal); await this.open()
    return this.database.transaction('rw', PROJECT_TABLES, async () => this.accounting.runMaintenance(async () => {
      const result = await this.reclaimUnreferenced(options, true)
      await this.scanTotals()
      checkCancelled(options.signal)
      return result
    }))
  }
  trimProjectHistory(review: object, options: ResourceOptions = {}): Promise<number> {
    return this.confirmedMaintenance(review, options, async owner => {
      const before = await this.scanTotals()
      const count = await discardAutomaticHistory(this.database, owner, options.signal)
      if (!count) return count
      const metadata = await this.database.historyMetadata.get(owner)
      assertMetadata(metadata, owner)
      if (metadata.metadataVersion === Number.MAX_SAFE_INTEGER) throw new HistoryMetadataConflictError()
      await this.database.historyMetadata.put({ ...metadata, metadataVersion: metadata.metadataVersion + 1 })
      await this.reclaimUnreferenced(options, false)
      const after = await this.scanTotals()
      if (after.documentBytes >= before.documentBytes) throw new Error('整理后没有减少文档占用，原历史已保留。')
      return count
    })
  }
  async load(sceneId: string, options: ResourceOptions = {}): Promise<ProjectBundle | null> {
    id(sceneId); checkCancelled(options.signal); await this.open()
    const bundle = await this.database.transaction('r', PROJECT_TABLES, async () => {
      const row = await this.database.projects.get(sceneId)
      if (!row) return null
      assertCurrent(row)
      if (row.status !== 'ready') return null
      assertMetadata(await this.database.historyMetadata.get(sceneId), sceneId)
      return this.assembled(row.project, sceneId, 'current', 'current')
    })
    return bundle ? validateProjectBundle(bundle, this.validation(options)) : null
  }
  async listAutomaticSnapshots(ownerSceneId: string): Promise<AutomaticSummary[]> {
    const history = await this.listHistoryVersions(ownerSceneId)
    return history.versions.filter(row => row.automatic).slice(0, 20).map(row => ({ ownerSceneId, revision: row.revision, savedAt: row.savedAt, contentHash: row.contentHash }))
  }
  async loadAutomaticSnapshot(ownerSceneId: string, revision: number, options: ResourceOptions = {}): Promise<ProjectBundle | null> {
    if (!integer(revision)) throw new Error('自动历史revision无效。')
    const history = await this.listHistoryVersions(ownerSceneId), rows = history.versions.filter(row => row.automatic && row.revision === revision)
    if (rows.length > 1) throw new Error('自动历史修订存在重复版本。')
    return rows[0] ? this.loadHistoryVersion(ownerSceneId, rows[0].id, options) : null
  }
  private async putResources(bundles: readonly ProjectBundle[], options: ResourceOptions, verifiedSnapshot?: VerifiedProjectBundle): Promise<void> {
    // Bundles have owned immutable byte ports; DB transactions never perform native image decoding.
    for (const bundle of bundles) {
      const records = [...projectResourceRecords(bundle.project)]
      // Bound fresh DB rows and byte-port copies together: at most four
      // resources and 20 MiB per batch, including a single maximum-size image.
      for (let offset = 0; offset < records.length;) {
        checkCancelled(options.signal)
        const batch: typeof records = []; let sizeBytes = 0
        while (offset < records.length && batch.length < 4) {
          const next = records[offset]
          if (batch.length && sizeBytes + next[1] > 20 * 1024 * 1024) break
          batch.push(next); sizeBytes += next[1]; offset++
        }
        const existingRows = await this.database.resources.bulkGet(batch.map(([hash]) => hash))
        const captured = await waitForStorageTransaction(Promise.all(batch.map(([hash]) => bundle.resources.read(hash))))
        for (const [i, [hash, size]] of batch.entries()) {
          const bytes = captured[i], existing = existingRows[i]
          const exactSnapshotMatch = !!existing && bundle === verifiedSnapshot
          if (bytes.length !== size || !exactSnapshotMatch && sha256Bytes(bytes) !== hash) throw new Error('准备后的资源字节发生改变。')
          if (existing) {
            // An exact immutable input already owns the checked digest. Still
            // read the retained row in this transaction and compare every byte.
            exact(existing, ['sha256', 'bytes'])
            if (existing.sha256 !== hash) throw new Error('相同资源hash的已有字节冲突。')
            const before = exactSnapshotMatch ? captureBytes(existing.bytes, size) : bytesOf(existing)
            if (before.length !== bytes.length || !before.every((value, index) => value === bytes[index])) throw new Error('相同资源hash的已有字节冲突。')
          } else await this.database.resources.add({ sha256: hash, bytes })
          checkCancelled(options.signal)
        }
      }
      const licenses = Object.entries(bundle.project.licenses)
      for (let offset = 0; offset < licenses.length; offset += 4) {
        const batch = licenses.slice(offset, offset + 4)
        const existingRows = await this.database.licenseTexts.bulkGet(batch.map(([hash]) => hash))
        for (const [i, [hash, license]] of batch.entries()) {
          const existing = existingRows[i]
          if (existing) {
            exact(existing, ['sha256', 'text'])
            if (existing.sha256 !== hash || existing.text !== license.text) throw new Error('相同许可hash的已有正文冲突。')
          } else await this.database.licenseTexts.add(license)
          checkCancelled(options.signal)
        }
      }
    }
  }

  private rowCost(table: string, value: unknown): { kind: keyof StorageTotals; bytes: number } | null {
    let size = 0
    const content: typeof assertContent = (project, hash) => {
      const checked = checkedContent(project, Dexie.currentTransaction && transactionContentChecks.get(Dexie.currentTransaction) || createContentChecks())
      if (checked.hash !== hash) throw new Error('存档完整内容hash损坏；原记录保持。')
      size += checked.byteLength
    }
    const runtimeRecord = (row: unknown) => {
      if (!row || typeof row !== 'object') return row
      const record = row as Record<string, unknown>, project = record.project as ProjectData | undefined
      return project?.document?.aggregateCoordinates?.encoding === 'local' ? { ...record, project: decodeProjectCoordinates(project) } : row
    }
    if (table === 'projects') assertCurrent(runtimeRecord(value) as StoredProject, content)
    else if (table === 'automaticSnapshots') assertAutomatic(runtimeRecord(value) as StoredAutomatic, content)
    else if (table === 'snapshots' || table === 'importedSnapshots') assertSnapshot(runtimeRecord(value) as StoredSnapshot, table === 'importedSnapshots', content)
    else if (table === 'historyVersions') size = this.history.versionBytes(value)
    else if (table === 'historyHeads') size = historyHeadBytes(value)
    else if (table === 'historyPins') size = historyPinBytes(value)
    else if (table === 'projectContentBlocks') return { kind: 'documentBytes', bytes: checkedContentBlock(value).bytes.length }
    else if (table === 'resources') return { kind: 'resourceBytes', bytes: bytesOf(value as StoredBytes).length }
    else if (table === 'licenseTexts') {
      exact(value, ['sha256', 'text'])
      if (!hashValue(value.sha256) || typeof value.text !== 'string') throw new Error('库中许可正文hash损坏。')
      const bytes = encodeUtf8(value.text)
      if (!bytes.length || bytes.length > 256 * 1024 || sha256Bytes(bytes) !== value.sha256) throw new Error('库中许可正文hash或预算损坏。')
      return { kind: 'resourceBytes', bytes: bytes.length }
    } else return null
    return { kind: 'documentBytes', bytes: size }
  }
  private async scanTotals(): Promise<StorageTotals> {
    const totals: StorageTotals = { documentBytes: 0, resourceBytes: 0 }
    for (const table of ['projects', 'automaticSnapshots', 'snapshots', 'importedSnapshots', 'resources', 'licenseTexts', 'historyHeads', 'historyPins', 'projectContentBlocks']) {
      await scanRows(this.database.table(table), row => { const cost = this.rowCost(table, row); if (cost && !Object.hasOwn(CONTENT_PAYLOAD_FIELDS, table)) totals[cost.kind] += cost.bytes })
      if (Object.hasOwn(CONTENT_PAYLOAD_FIELDS, table)) totals.documentBytes += await this.database.rawJsonBytes(table)
    }
    // Physical history rows are charged once, independently of hydrated
    // checkpoints. The graph audit below checks every complete version; doing
    // rowCost here repeated its checkpoint validation before reconstruction.
    totals.documentBytes += await this.database.rawJsonBytes('historyVersions')
    // Cold/opened connections prove the whole graph once; a session receipt is
    // retained only while all subsequent writes are transactionally measured.
    const heads = await this.database.historyHeads.toArray(), owners = new Set(heads.map(row => row.ownerSceneId))
    for (const head of heads) {
      const transaction = Dexie.currentTransaction!
      await this.history.audit(head.ownerSceneId, this.auditSignals.get(transaction), this.atomicTransactions.has(transaction))
      const current = await this.database.projects.get(head.ownerSceneId)
      if (!current || current.revision !== head.savedRevision || current.contentHash !== head.contentHash) throw new Error('历史活动版本与完整当前工程不一致。')
    }
    await scanRows(this.database.historyVersions, row => { if (!owners.has(row.ownerSceneId)) throw new Error('增量历史缺少所属活动分支。') })
    await scanRows(this.database.historyPins, row => { if (!owners.has(row.ownerSceneId)) throw new Error('增量历史快照缺少所属分支。') })
    return totals
  }
  /** The native snapshot transaction is already complete. Validate its actual
   * immutable block closure and every owner/branch without holding a DB lock.
   * The final transaction must compare all captured rows and actual bytes. */
  private async auditCapturedTotals(rows: ReadonlyMap<string, readonly unknown[]>, signal: CancellationSignal): Promise<StorageTotals> {
    const totals: StorageTotals = { documentBytes: 0, resourceBytes: 0 }
    // These loops no longer get cursor event boundaries from a live database
    // transaction. Yield between actual records so resolved promises cannot
    // turn the entire captured database into one long main-thread task.
    let sliceStart = performance.now()
    const yieldAudit = async () => {
      checkCancelled(signal)
      if (performance.now() - sliceStart >= 12) {
        await new Promise<void>(resolve => setTimeout(resolve, 0))
        checkCancelled(signal); sliceStart = performance.now()
      }
    }
    const blocks = new Map<string, ProjectContentBlock>(), hydrated = new Map<string, ProjectData>()
    for (const raw of rows.get('projectContentBlocks') ?? []) {
      checkCancelled(signal); const block = checkedContentBlock(raw); blocks.set(block.sha256, block)
      // Includes unreferenced blocks. No stored counter or declared hash can
      // replace this complete actual-byte check and physical accounting.
      totals.documentBytes += block.bytes.length
      await yieldAudit()
    }
    const materializer = createProjectMaterializer(async hash => blocks.get(hash))
    try {
    const readRows = new Map<string, unknown[]>()
    const materialize = async (table: string, raw: unknown): Promise<unknown> => {
      const field = CONTENT_PAYLOAD_FIELDS[table]
      if (!field || !raw || typeof raw !== 'object') return raw
      const row = raw as Record<string, unknown>, value = row[field]
      if (value === null) return raw
      let project = value as ProjectData
      if (isProjectBlockManifest(value)) {
        const key = canonicalJson(value)
        const known = hydrated.get(key)
        if (known) return { ...row, [field]: known }
        project = await materializer.materialize(value)
        if (project.document.aggregateCoordinates?.encoding === 'local') project = decodeProjectCoordinates(project)
        // Only this audit owns these objects. Consumers never mutate a raw row.
        hydrated.set(key, project)
      } else if (project?.document?.aggregateCoordinates?.encoding === 'local') project = decodeProjectCoordinates(project)
      return { ...row, [field]: project }
    }
    for (const table of ['projects', 'automaticSnapshots', 'snapshots', 'importedSnapshots', 'resources', 'licenseTexts', 'historyHeads', 'historyPins']) {
      const actual: unknown[] = []; readRows.set(table, actual)
      for (const raw of rows.get(table) ?? []) {
        checkCancelled(signal)
        const row = await materialize(table, raw); actual.push(row)
        const cost = this.rowCost(table, row)
        if (Object.hasOwn(CONTENT_PAYLOAD_FIELDS, table)) totals.documentBytes += encodeUtf8(canonicalJson(raw)).length
        else if (cost) totals[cost.kind] += cost.bytes
        await yieldAudit()
      }
    }
    const versions: CapturedHistoryVersion[] = [], required = new Set<string>()
    for (const raw of rows.get('historyVersions') ?? []) {
      checkCancelled(signal); totals.documentBytes += encodeUtf8(canonicalJson(raw)).length
      const version = raw as CapturedHistoryVersion
      if (isProjectBlockManifest(version.checkpoint)) {
        for (const field of validateProjectBlockManifest(version.checkpoint).fields) for (const ref of field.blocks) required.add(ref.sha256)
      }
      versions.push(version)
      await yieldAudit()
    }
    const heads = readRows.get('historyHeads') as HistoryHead[], pins = readRows.get('historyPins') as HistoryPin[]
    // Full current payloads have already passed rowCost's complete validation.
    // Only scalar head identity is needed after the Worker boundary.
    const owners = new Set(heads.map(head => head.ownerSceneId))
    const currents = new Map((readRows.get('projects') as StoredProject[]).map(row => [row.sceneId, { revision: row.revision, contentHash: row.contentHash }]))
    if (versions.some(row => !owners.has(row.ownerSceneId))) throw new Error('增量历史缺少所属活动分支。')
    if (pins.some(row => !owners.has(row.ownerSceneId))) throw new Error('增量历史快照缺少所属分支。')
    // Only needed content blocks cross the boundary. Resources and the entire
    // native capture stay on this page; ordinary clone never detaches bytes.
    const historyBlocks: ProjectContentBlock[] = []
    for (const hash of required) {
      const block = blocks.get(hash)
      if (!block) throw new Error('完整历史内容块缺失。')
      historyBlocks.push(block); await yieldAudit()
    }
    // No more page materialization follows. Release parsed and hydrated copies
    // before the Worker allocates its complete graph; retain all native capture
    // rows unchanged for the final transaction's exact byte confirmation.
    materializer.close(); hydrated.clear(); readRows.clear(); blocks.clear()
    if (heads.length) await auditCapturedHistoryInWorker({ kind: 'captured-history', heads, versions, pins, blocks: historyBlocks }, signal)
    for (const head of heads) {
      checkCancelled(signal)
      const current = currents.get(head.ownerSceneId)
      if (!current || current.revision !== head.savedRevision || current.contentHash !== head.contentHash) throw new Error('历史活动版本与完整当前工程不一致。')
    }
    return totals
    } finally { materializer.close(); blocks.clear(); hydrated.clear() }
  }
  private async usageInTransaction(ownerSceneId: string, prepared?: StorageAuditPreparation): Promise<StorageUsage> {
    const totals = await this.accounting.totals(prepared), metadata = await this.database.historyMetadata.get(ownerSceneId)
    // A primary-key existence query has no project payload to hydrate.
    if (await this.database.projects.where('sceneId').equals(ownerSceneId).count()) assertMetadata(metadata, ownerSceneId)
    const head = await this.history.head(ownerSceneId)
    const pins = head?.status === 'ready' ? await this.history.pins(ownerSceneId) : null
    const rows = pins ?? await this.database.snapshots.where('ownerSceneId').equals(ownerSceneId).toArray()
    return { ...totals, metadataVersion: metadata?.metadataVersion ?? 0,
      namedCount: rows.filter(row => row.kind === 'named').length, protectionCount: rows.filter(row => row.kind === 'protection').length,
      importedCount: pins ? pins.filter(row => row.kind === 'imported-auto').length : await this.database.importedSnapshots.where('ownerSceneId').equals(ownerSceneId).count() }
  }
  private async assertBudgets(ownerSceneId: string): Promise<void> {
    const usage = await this.usageInTransaction(ownerSceneId)
    if (usage.resourceBytes > PROJECT_STORAGE_LIMITS.resourceBytes || usage.documentBytes > PROJECT_STORAGE_LIMITS.documentBytes) throw new Error('整个新工程库超过资源或文档累计预算；事务未采用。')
    if (usage.namedCount > 32 || usage.protectionCount > 32 || usage.importedCount > 20) throw new Error('命名/保护/来源历史超过保留上限；事务未采用。')
  }
  async usage(ownerSceneId: string): Promise<StorageUsage> {
    id(ownerSceneId); await this.open()
    for (let attempt = 0; ; attempt++) {
    const prepared = await this.prepareAccounting()
    try { return await this.database.transaction('r', PROJECT_TABLES, () => waitForStorageTransaction(this.usageInTransaction(ownerSceneId, prepared), 125_000)) }
    catch (error) { if (!(error instanceof StorageAuditConflictError) || attempt >= 2) throw error }
    finally { prepared?.release() }
    }
  }
  /** Metadata for a later CAS only; this is not complete project/library validation. */
  async historyMetadataVersion(ownerSceneId: string, options: ResourceOptions = {}): Promise<number> {
    id(ownerSceneId); checkCancelled(options.signal); await this.open()
    return this.database.transaction('r', this.database.projects, this.database.historyMetadata, async () => {
      checkCancelled(options.signal)
      const current = await this.database.rawJsonRecord('projects', ownerSceneId) as StoredProject | undefined
      if (!current) throw new ProjectConflictError(null)
      if (isProjectBlockManifest(current.project)) {
        exact(current, ['sceneId', 'revision', 'savedAt', 'contentHash', 'status', 'conversionJobId', 'project'])
        id(current.sceneId); time(current.savedAt)
        const manifest = validateProjectBlockManifest(current.project)
        if (!hashValue(current.contentHash) || current.contentHash !== manifest.contentHash) throw new Error('存档完整内容hash无效。')
        if (current.sceneId !== ownerSceneId || !integer(current.revision)
          || !['preparing', 'ready'].includes(current.status) || current.conversionJobId !== null && !validId(current.conversionJobId)
          || current.status === 'preparing' && current.conversionJobId === null) throw new Error('当前工程身份、版本或发布状态损坏。')
      } else assertCurrent(current, (_project, hash) => {
        if (!hashValue(hash)) throw new Error('存档完整内容hash无效。')
      })
      if (current.status !== 'ready') throw new ProjectConflictError(current.revision)
      const metadata = await this.database.historyMetadata.get(ownerSceneId); assertMetadata(metadata, ownerSceneId)
      checkCancelled(options.signal)
      return metadata.metadataVersion
    })
  }
  private async addCurrent(bundle: ProjectBundle, hash: string, savedAt: string, conversionJobId: string | null, previous: StoredProject | null, parentId?: string, localSource?: ProjectData, preparedDelta?: PreparedProjectDelta): Promise<void> {
    const project = bundle.project, owner = project.document.sceneId
    const row: StoredProject = { sceneId: owner, revision: project.document.revision, savedAt, contentHash: hash, status: 'ready', conversionJobId, project }
    if (previous) await this.database.projects.put(row)
    else await this.database.projects.add(row)
    await this.database.resourceBindings.put(binding(project, owner, 'current', 'current'))
    await this.history.append(row, previous, this.options.runtime.ids.nextId(), parentId, localSource, preparedDelta)
  }
  private async installFamily(bundle: ProjectBundle, hash: string, savedAt: string, snapshots: readonly SnapshotBundle[]): Promise<void> {
    const owner = bundle.project.document.sceneId
    const current: StoredProject = { sceneId: owner, revision: bundle.project.document.revision, savedAt, contentHash: hash, status: 'ready', conversionJobId: null, project: bundle.project }
    await this.database.projects.add(current)
    await this.database.resourceBindings.add(binding(bundle.project, owner, 'current', 'current'))
    const named: StoredSnapshot[] = [], imported: StoredSnapshot[] = []
    for (const row of snapshots) {
      const stored = { ...summaryOf(row), project: row.bundle.project }
      ;(row.kind === 'imported-auto' ? imported : named).push(stored)
      await this.database.resourceBindings.add(binding(row.bundle.project, owner, row.kind, row.id))
    }
    await this.history.initialize(current, [], named, imported, 0)
    await this.history.activate(owner, hash, current.revision, 0)
  }
  async save(input: ProjectBundle, expectedRevision: number | null, options: SaveProjectOptions = {}): Promise<void> {
    return this.saveWithValidation(input, expectedRevision, options, false)
  }
  /** Workspace-only proof consumer. Unauthenticated bundles still receive full
   * validation; final actual DB bytes, identities and CAS are always checked. */
  async saveSnapshot(input: ProjectBundle, expectedRevision: number | null, options: SaveProjectOptions = {}): Promise<void> {
    return this.saveWithValidation(input, expectedRevision, options, true)
  }
  private retainSavedEncoding(snapshot: EncodedSnapshot, epoch: number): boolean {
    if (epoch !== this.saveEpoch) return false
    const previous = this.savedEncoding
    this.savedEncoding = canRetainEncodedSnapshot(snapshot) ? snapshot : undefined
    if (previous && previous !== snapshot) releaseEncodedSnapshot(previous)
    return this.savedEncoding === snapshot
  }
  private async saveWithValidation(input: ProjectBundle, expectedRevision: number | null, options: SaveProjectOptions, snapshotInput: boolean): Promise<void> {
    if (expectedRevision !== null && !integer(expectedRevision)) throw new Error('保存基线须为非负revision或无记录。')
    const saveEpoch = this.saveEpoch
    const historyParentId = options.historyParentId, historyParentHash = options.historyParentHash
    if ((historyParentId === undefined) !== (historyParentHash === undefined)) throw new Error('完整历史分支须同时绑定版本与内容hash。')
    if (historyParentId !== undefined) { id(historyParentId); if (!hashValue(historyParentHash) || expectedRevision === null) throw new Error('完整历史分支来源无效。') }
    const guard = options.guard ? captureJson(options.guard) as unknown as ProjectSaveGuard : undefined
    if (guard) {
      exact(guard, ['expectedMetadataVersion', 'protection']); exact(guard.protection, ['id', 'contentHash'])
      id(guard.protection.id)
      if (!integer(guard.expectedMetadataVersion) || !hashValue(guard.protection.contentHash) || expectedRevision === null) throw new Error('保护保存基线无效。')
    }
    const preservation = options.preservation ? captureJson(options.preservation) as unknown as SourcePreservationGuard : undefined
    if (preservation) {
      exact(preservation, ['sceneId', 'revision', 'contentHash', 'guard']); id(preservation.sceneId)
      exact(preservation.guard, ['expectedMetadataVersion', 'protection']); exact(preservation.guard.protection, ['id', 'contentHash']); id(preservation.guard.protection.id)
      if (expectedRevision !== null || !integer(preservation.revision) || !hashValue(preservation.contentHash)
        || !integer(preservation.guard.expectedMetadataVersion) || !hashValue(preservation.guard.protection.contentHash)) throw new Error('独立工程的原工程保护基线无效。')
    }
    // Capture private executor evidence before public IO validation detaches
    // JSON. It is only a hint: history compares fresh DB content in full.
    const localInput = getVerifiedProjectBundle(input), localSource = localInput?.project
    const savedAt = this.options.runtime.clock.now(); time(savedAt)
    // Keep the exact workspace capability intact until its owning validator
    // examines it. Public save deliberately keeps its full capture/validation.
    const bundle = snapshotInput ? await validateProjectSnapshot(input, this.validation(options))
      : await validateProjectBundle(captureProjectBundleInput(input), this.validation(options))
    const project = bundle.project, owner = project.document.sceneId
    const baseline = this.savedEncoding
    const encodedSnapshot = prepareEncodedSnapshot(bundle, localInput, baseline)
    let retained = false
    const validatedJson = encodedSnapshot.encoded.canonical
    const checked: CheckedContent = { hash: encodedSnapshot.encoded.contentHash, byteLength: encodedSnapshot.encoded.byteLength }, hash = checked.hash
    try {
    // Existing executor receipts already have a local delta path. Prepare only
    // the ordinary warm generic case, using the actual complete encoding that
    // save validation produced. Branch parents retain their explicit reader.
    const preparedDelta = baseline && historyParentId === undefined && expectedRevision === baseline.project.document.revision
      && owner === baseline.project.document.sceneId && !(localSource && (getProjectLocalTransaction(localSource) || getProjectTransactionReceipt(localSource)))
      ? prepareEncodedProjectDelta(baseline, encodedSnapshot) : undefined
    checkCancelled(options.signal)
    await this.ensureHistory(owner, options)
    if (preservation) await this.ensureHistory(preservation.sceneId, options)
    await this.atomic(options, async () => {
      const contents = transactionContentChecks.get(Dexie.currentTransaction!)
      if (!contents) throw new Error('保存完整内容证明须绑定当前事务。')
      pinEncodedSnapshot(Dexie.currentTransaction!.idbtrans, 'result', encodedSnapshot)
      if (baseline) pinEncodedSnapshot(Dexie.currentTransaction!.idbtrans, 'baseline', baseline)
      rememberCheckedContent(contents, validatedJson, checked, 'result')
      if (historyParentId !== undefined) {
        const parent = await this.history.readVersion(owner, historyParentId)
        if (!parent || parent.version.contentHash !== historyParentHash || parent.project.document.sceneId !== owner || parent.project.schemaVersion !== project.schemaVersion
          || parent.project.historyIdentity.lineageId !== project.historyIdentity.lineageId) throw new HistoryMetadataConflictError()
        checkedContent(parent.project, contents, 'branch')
      }
      if (preservation) {
        if (preservation.sceneId === owner) throw new Error('独立工程不能覆盖原工程身份。')
        await this.assertProtectionInTransaction(preservation.sceneId, preservation.revision, preservation.contentHash, preservation.guard)
      }
      const previous = await this.database.projects.get(owner)
      if (previous) assertCurrent(previous, (value, expected) => { if (checkedContent(value, contents, 'baseline').hash !== expected) throw new Error('存档完整内容hash损坏；原记录保持。') })
      if ((previous?.revision ?? null) !== expectedRevision || previous && (previous.status !== 'ready' || project.document.revision <= previous.revision)) throw new ProjectConflictError(previous?.revision ?? null)
      if (guard) {
        await this.metadataCAS(owner, guard.expectedMetadataVersion)
        const protection = await this.snapshotRecord(owner, guard.protection.id, previous)
        if (!protection || protection.kind !== 'protection' || protection.contentHash !== guard.protection.contentHash || protection.sourceRevision !== expectedRevision) throw new HistoryMetadataConflictError()
        assertSnapshot(protection)
        assertBinding(await this.database.resourceBindings.get([owner, 'protection', protection.id]), protection.project, owner, 'protection', protection.id)
        if (!previous || protection.contentHash !== previous.contentHash) throw new HistoryMetadataConflictError()
      }
      if (previous) {
        assertMetadata(await this.database.historyMetadata.get(owner), owner)
        assertBinding(await this.database.resourceBindings.get([owner, 'current', 'current']), previous.project, owner, 'current', 'current')
        assertFixedProjectCompatible(previous.project, project)
        if (!equalOwnedJson(mergeIdentityRecords(project.historyIdentity, [previous.project.historyIdentity]), project.historyIdentity)) throw new Error('后续保存不能丢失既有出生身份/墓碑。')
      } else {
        if (await this.database.historyMetadata.get(owner) || await this.database.automaticSnapshots.where('ownerSceneId').equals(owner).count()
          || await this.database.snapshots.where('ownerSceneId').equals(owner).count() || await this.database.importedSnapshots.where('ownerSceneId').equals(owner).count()) throw new Error('此工程身份已有历史记录，不能覆盖。')
        await this.database.historyMetadata.add({ ownerSceneId: owner, metadataVersion: 0 })
      }
      await this.putResources([bundle], options, snapshotInput ? bundle : undefined)
      await this.addCurrent(bundle, hash, savedAt, previous?.conversionJobId ?? null, previous ?? null, historyParentId, localSource, preparedDelta)
      await this.assertBudgets(owner)
    }, true)
    // Publish optional reuse only after native commit. A failed save keeps the
    // last committed lease; concurrent saves own their separate endpoint slots.
    retained = this.retainSavedEncoding(encodedSnapshot, saveEpoch)
    if (localSource) { releaseProjectLocalTransaction(localSource); releaseProjectTransactionReceipt(localSource) }
    } finally { if (!retained) releaseEncodedSnapshot(encodedSnapshot) }
  }
  private async assertProtectionInTransaction(owner: string, expectedRevision: number, expectedContentHash: string, guard: ProjectSaveGuard) {
    const current = await this.database.projects.get(owner)
    if (!current || current.status !== 'ready' || current.revision !== expectedRevision || current.contentHash !== expectedContentHash) throw new ProjectConflictError(current?.revision ?? null)
    assertCurrent(current)
    const metadata = await this.database.historyMetadata.get(owner); assertMetadata(metadata, owner)
    const protection = await this.snapshotRecord(owner, guard.protection.id, current)
    if (metadata.metadataVersion !== guard.expectedMetadataVersion || !protection || protection.kind !== 'protection'
      || protection.contentHash !== guard.protection.contentHash || protection.contentHash !== current.contentHash || protection.sourceRevision !== expectedRevision) throw new HistoryMetadataConflictError()
    assertSnapshot(protection)
    assertBinding(await this.database.resourceBindings.get([owner, 'protection', protection.id]), protection.project, owner, 'protection', protection.id)
  }
  /** A pre-commit read; save() must still repeat this guard in its final write transaction. */
  async checkProtection(owner: string, expectedRevision: number, expectedContentHash: string, guard: ProjectSaveGuard, options: ResourceOptions = {}): Promise<void> {
    id(owner); checkCancelled(options.signal); await this.ensureHistory(owner, options)
    const captured = captureJson(guard) as unknown as ProjectSaveGuard
    if (!integer(expectedRevision) || !hashValue(expectedContentHash) || !integer(captured.expectedMetadataVersion)) throw new Error('保护检查基线无效。')
    return this.database.transaction('r', PROJECT_TABLES, () => waitForStorageTransaction(withTransactionContentChecks(async () => {
      checkCancelled(options.signal)
      await this.assertProtectionInTransaction(owner, expectedRevision, expectedContentHash, captured)
      checkCancelled(options.signal)
    })))
  }
  /** Install an explicitly selected native archive as one fresh complete project, atomically with every history binding. */
  async importArchive(input: HistoryArchive, options: ResourceOptions = {}): Promise<{ project: ProjectBundle; snapshots: SnapshotSummary[] }> {
    return this.installArchive(validateHistoryArchive(input, this.validation(options)), options)
  }
  /** Internal file-import handoff; a copied/fake proof falls back to full IO. */
  async importSnapshotArchive(input: HistoryArchive, options: ResourceOptions = {}): Promise<{ project: ProjectBundle; snapshots: SnapshotSummary[] }> {
    return this.installArchive(consumeHistoryArchive(input, this.validation(options)), options)
  }
  private async installArchive(pending: Promise<HistoryArchive>, options: ResourceOptions): Promise<{ project: ProjectBundle; snapshots: SnapshotSummary[] }> {
    const saveEpoch = this.saveEpoch
    const owner = this.options.runtime.ids.nextId(), savedAt = this.options.runtime.clock.now()
    id(owner); time(savedAt)
    const archive = await pending
    if (owner === archive.current.project.document.sceneId) throw new Error('导入须创建独立工程身份。')
    const data = { ...archive.current.project, document: { ...archive.current.project.document,
      sceneId: owner, revision: 0, createdAt: savedAt, updatedAt: savedAt } }
    const candidate = { project: data, resources: archive.current.resources }
    const project = tryDerivedProjectBundle(candidate, archive.current, options)
      ?? await validateProjectBundle(candidate, this.validation(options))
    // Capabilities, including a replaced adapter, must match before installing.
    await validateProjectSnapshot(project, this.validation(options))
    const usedIds = new Set<string>(), snapshots: SnapshotBundle[] = archive.snapshots.map(source => {
      const snapshotId = this.options.runtime.ids.nextId(); id(snapshotId)
      if (usedIds.has(snapshotId)) throw new Error('导入快照身份重复。')
      usedIds.add(snapshotId)
      return { ...source, id: snapshotId, ownerSceneId: owner }
    })
    const encodedSnapshot = prepareEncodedSnapshot(project)
    let retained = false
    try {
      await this.atomic(options, async () => {
        if (await this.database.projects.get(owner) || await this.database.historyMetadata.get(owner)
          || await this.database.automaticSnapshots.where('ownerSceneId').equals(owner).count()
          || await this.database.snapshots.where('ownerSceneId').equals(owner).count()
          || await this.database.importedSnapshots.where('ownerSceneId').equals(owner).count()
          || await this.database.resourceBindings.where('ownerSceneId').equals(owner).count()) throw new Error('导入的新工程身份已占用，未覆盖任何成果。')
        pinEncodedSnapshot(Dexie.currentTransaction!.idbtrans, 'result', encodedSnapshot)
        await this.putResources([project, ...snapshots.map(snapshot => snapshot.bundle)], options)
        await this.database.historyMetadata.add({ ownerSceneId: owner, metadataVersion: 0 })
        await this.installFamily(project, encodedSnapshot.encoded.contentHash, savedAt, snapshots)
        await this.assertBudgets(owner)
      })
      retained = this.retainSavedEncoding(encodedSnapshot, saveEpoch)
    } finally { if (!retained) releaseEncodedSnapshot(encodedSnapshot) }
    return { project, snapshots: snapshots.map(summaryOf) }
  }
  async listSnapshots(ownerSceneId: string): Promise<SnapshotSummary[]> {
    await this.ensureHistory(ownerSceneId)
    return this.database.transaction('r', PROJECT_TABLES, async () => {
      const current = await this.database.projects.get(ownerSceneId)
      if (!current || current.status !== 'ready') return []
      assertCurrent(current)
      return (await this.history.pins(ownerSceneId)).map(summaryOf).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id))
    })
  }
  private async captureSnapshot(ownerSceneId: string, snapshotId: string, options: ResourceOptions, readSession?: SnapshotReadSession): Promise<SnapshotBundle | null> {
    id(snapshotId); await this.ensureHistory(ownerSceneId, options)
    const captured = await this.database.transaction('r', PROJECT_TABLES, () => waitForStorageTransaction(withTransactionContentChecks(async () => {
      const current = await this.database.projects.get(ownerSceneId)
      if (!current || current.status !== 'ready') return null
      assertCurrent(current)
      const row = await this.snapshotRecord(ownerSceneId, snapshotId, current, readSession)
      if (!row) return null
      assertSnapshot(row, row.kind === 'imported-auto')
      return { ...summaryOf(row), bundle: await this.assembled(row.project, ownerSceneId, row.kind, snapshotId) }
    })))
    return captured
  }
  async loadSnapshot(ownerSceneId: string, snapshotId: string, options: ResourceOptions = {}): Promise<SnapshotBundle | null> {
    const captured = await this.captureSnapshot(ownerSceneId, snapshotId, options)
    return captured ? { ...captured, bundle: await validateProjectBundle(captured.bundle, this.validation(options)) } : null
  }
  private closeSnapshotRead(state: SnapshotReadState): void {
    state.closed = true; state.cached = null; state.history.close(); this.activeSnapshotReads.delete(state)
    for (const transaction of state.writes) {
      try { if (transaction.active) transaction.abort() } catch { /* the transaction already completed */ }
    }
    state.writes.clear()
  }
  private snapshotReadState(session: SnapshotReadSession): SnapshotReadState {
    const state = this.snapshotReads.get(session)
    if (!state || state.closed || this.invalidated) throw new Error('历史读取会话无效、已关闭或不属于当前仓库。')
    return state
  }
  beginSnapshotRead(): SnapshotReadSession {
    if (this.invalidated) throw new Error('工程数据库连接已失效。')
    const state: SnapshotReadState = { closed: false, busy: false, cached: null, writes: new Set(), history: this.history.beginRead() }
    const session: SnapshotReadSession = Object.freeze({
      load: (owner: string, snapshotId: string, options: ResourceOptions = {}) => this.loadSnapshotInSession(session, owner, snapshotId, options),
      close: () => this.closeSnapshotRead(state),
    })
    this.snapshotReads.set(session, state); this.activeSnapshotReads.add(state)
    return session
  }
  private async loadSnapshotInSession(session: SnapshotReadSession, owner: string, snapshotId: string, options: ResourceOptions): Promise<SnapshotBundle | null> {
    const state = this.snapshotReadState(session), signal = this.validation(options).signal
    if (state.busy) { this.closeSnapshotRead(state); throw new Error('历史读取会话不能并发使用。') }
    state.busy = true
    const assertActive = () => { this.snapshotReadState(session); checkCancelled(signal) }
    try {
      assertActive()
      // Each read freshly proves the real DB rows, complete graph, bindings,
      // resource bytes/hashes/sizes and license bodies before considering reuse.
      const captured = await this.captureSnapshot(owner, snapshotId, options, session)
      assertActive()
      if (!captured) { state.cached = null; return null }
      const json = canonicalJson(captured.bundle.project), cached = state.cached
      let bundle: VerifiedProjectBundle | null = null
      if (cached && json === cached.json) {
        let sameBytes = true
        for (const [hash] of projectResourceRecords(captured.bundle.project)) {
          const actual = await captured.bundle.resources.read(hash), original = await cached.bundle.resources.read(hash)
          assertActive()
          const record = captured.bundle.project.assets[hash]
          if (record) {
            const header = inspectImageBytes(actual)
            if (header.mimeType !== record.mimeType || header.width !== record.pixelWidth || header.height !== record.pixelHeight) throw new Error('实际图片格式/尺寸与元数据不匹配。')
          }
          if (actual.length !== original.length || !actual.every((byte, index) => byte === original[index])) { sameBytes = false; break }
        }
        // The shared owner captures the complete adapter identity, including
        // processor/profile and concurrency, and fully verifies changed capabilities.
        if (sameBytes) bundle = await validateProjectSnapshot(cached.bundle, this.validation(options))
      }
      if (!bundle) {
        bundle = await validateProjectBundle(captured.bundle, this.validation(options))
      }
      assertActive()
      // No RGBA/Bitmap is retained. Only a successful immutable metadata/byte
      // closure may survive until the next read in this explicitly scoped operation.
      state.cached = { json, bundle }
      return { ...captured, bundle }
    } catch (error) {
      this.closeSnapshotRead(state); throw error
    } finally { state.busy = false }
  }
  private async captureResourceBytes(bundles: readonly ProjectBundle[], signal?: ResourceOptions['signal']): Promise<ReadonlyMap<string, Uint8Array>> {
    const bytes = new Map<string, Uint8Array>()
    for (const bundle of bundles) for (const [hash] of projectResourceRecords(bundle.project)) {
      checkCancelled(signal)
      const actual = await bundle.resources.read(hash), previous = bytes.get(hash)
      checkCancelled(signal)
      if (previous && (actual.length !== previous.length || !actual.every((byte, index) => byte === previous[index]))) throw new Error('相同资源hash对应不同实际字节。')
      if (!previous) bytes.set(hash, actual)
    }
    return bytes
  }
  private async metadataCAS(owner: string, expected: number): Promise<StoredHistoryMetadata> {
    const row = await this.database.historyMetadata.get(owner); assertMetadata(row, owner)
    if (!integer(expected) || row.metadataVersion !== expected || row.metadataVersion === Number.MAX_SAFE_INTEGER) throw new HistoryMetadataConflictError()
    return row
  }
  private async assertSaved(bundle: ProjectBundle, expectedRevision: number): Promise<StoredProject> {
    const project = bundle.project, row = await this.database.projects.get(project.document.sceneId)
    if (!row || row.status !== 'ready' || row.revision !== expectedRevision || project.document.revision !== expectedRevision) throw new ProjectConflictError(row?.revision ?? null)
    assertCurrent(row)
    assertBinding(await this.database.resourceBindings.get([row.sceneId, 'current', 'current']), row.project, row.sceneId, 'current', 'current')
    if (row.contentHash !== contentHashInTransaction(project)) throw new Error('当前完整工程与持久修订不一致；请先保存。')
    return row
  }
  async createSnapshot(input: ProjectBundle, snapshotName: string, options: CreateSnapshotOptions): Promise<SnapshotBundle> {
    const session = options.readSession, state = session === undefined ? undefined : this.snapshotReadState(session)
    const signal = this.validation(options).signal, thisRepository = this
    const scopedOptions = { ...options, ...(state ? { readSession: session } : {}),
      signal: state ? { get aborted() { return !!signal?.aborted || state.closed || thisRepository.invalidated } } : signal }
    try { return await this.createSnapshotChecked(input, snapshotName, scopedOptions) }
    catch (error) { if (state) this.closeSnapshotRead(state); throw error }
  }
  private async createSnapshotChecked(input: ProjectBundle, snapshotName: string, options: CreateSnapshotOptions): Promise<SnapshotBundle> {
    const captured = captureProjectBundleInput(input), normalized = name(snapshotName), kind = options.kind ?? 'named'
    const expected = options.expectedRevision, metadataVersion = options.expectedMetadataVersion
    if (!integer(expected) || !integer(metadataVersion) || !['named', 'protection'].includes(kind)) throw new Error('历史快照基线或类型无效。')
    const source = options.sourceSnapshot ? captureJson(options.sourceSnapshot) as { id: string; contentHash: string } : undefined
    if (source) { exact(source, ['id', 'contentHash']); id(source.id); if (!hashValue(source.contentHash)) throw new Error('来源快照hash无效。') }
    const snapshotId = options.id ?? this.options.runtime.ids.nextId(), createdAt = this.options.runtime.clock.now(); id(snapshotId); time(createdAt)
    const bundle = await validateProjectBundle(captured, this.validation(options)), owner = bundle.project.document.sceneId
    await this.ensureHistory(owner, options)
    let sourceBundle: ProjectBundle | undefined
    if (source) {
      const loaded = options.readSession
        ? await this.loadSnapshotInSession(options.readSession, owner, source.id, options)
        : await this.loadSnapshot(owner, source.id, options)
      if (!loaded || loaded.contentHash !== source.contentHash) throw new HistoryMetadataConflictError()
      sourceBundle = loaded.bundle
      mergeIdentityRecords(bundle.project.historyIdentity, [loaded.bundle.project.historyIdentity])
    }
    const expectedBytes = await this.captureResourceBytes(sourceBundle ? [bundle, sourceBundle] : [bundle], options.signal)
    const sourceJson = sourceBundle && canonicalJson(sourceBundle.project)
    const transactionBytes = new Map<string, Uint8Array>()
    const transactionResources: ResourceAssembly = { bytes: transactionBytes, byteLength: 0, maximumCount: expectedBytes.size,
      resources: Object.freeze({ async read(hash: string) {
        const bytes = transactionBytes.get(hash)
        if (!bytes) throw new Error('资源不在本次事务已核闭包内。')
        return bytes.slice()
      } }) }
    const snapshot: SnapshotBundle = { id: snapshotId, ownerSceneId: owner, kind, name: normalized, createdAt,
      lineageId: bundle.project.historyIdentity.lineageId, sourceRevision: bundle.project.document.revision, contentHash: projectContentHash(bundle.project), bundle }
    await this.atomic(options, async () => {
      if (options.readSession) {
        const state = this.snapshotReadState(options.readSession), transaction = Dexie.currentTransaction!
        state.writes.add(transaction)
        const release = () => { state.writes.delete(transaction) }
        transaction.on('complete', release); transaction.on('abort', release)
      }
      await this.assertSaved(bundle, expected)
      const metadata = await this.metadataCAS(owner, metadataVersion)
      await this.assembled(bundle.project, owner, 'current', 'current', transactionResources, expectedBytes)
      if (source) {
        const row = await this.snapshotRecord(owner, source.id, undefined, options.readSession)
        if (!row || row.contentHash !== source.contentHash) throw new HistoryMetadataConflictError()
        assertSnapshot(row, row.kind === 'imported-auto')
        if (canonicalJson(row.project) !== sourceJson) throw new HistoryMetadataConflictError()
        await this.assembled(row.project, owner, row.kind, row.id, transactionResources, expectedBytes)
      }
      if (await this.snapshotRecord(owner, snapshotId) || await this.database.snapshots.get([owner, snapshotId]) || await this.database.importedSnapshots.get([owner, snapshotId])) throw new Error('快照ID已被占用。')
      await this.history.pin(summaryOf(snapshot), bundle.project)
      await this.database.resourceBindings.add(binding(bundle.project, owner, kind, snapshotId))
      await this.database.historyMetadata.put({ ...metadata, metadataVersion: metadata.metadataVersion + 1 })
      await this.assertBudgets(owner)
    }, true)
    return snapshot
  }
  async renameSnapshot(owner: string, snapshotId: string, snapshotName: string, expectedHash: string, expectedMetadataVersion: number): Promise<void> {
    id(owner); id(snapshotId); const normalized = name(snapshotName)
    if (!hashValue(expectedHash)) throw new Error('快照hash无效。')
    await this.ensureHistory(owner)
    await this.atomic({}, async () => {
      const current = await this.database.projects.get(owner)
      if (!current || current.status !== 'ready') throw new HistoryMetadataConflictError()
      assertCurrent(current)
      const row = await this.snapshotRecord(owner, snapshotId, current)
      if (!row || row.contentHash !== expectedHash || row.kind !== 'named') throw new HistoryMetadataConflictError()
      assertSnapshot(row)
      const metadata = await this.metadataCAS(owner, expectedMetadataVersion)
      await this.history.renamePin(owner, snapshotId, normalized)
      await this.database.historyMetadata.put({ ...metadata, metadataVersion: metadata.metadataVersion + 1 })
      await this.assertBudgets(owner)
    }, true)
  }
  async deleteSnapshot(owner: string, snapshotId: string, expectedHash: string, expectedMetadataVersion: number): Promise<void> {
    id(owner); id(snapshotId)
    if (!hashValue(expectedHash)) throw new Error('快照hash无效。')
    await this.ensureHistory(owner)
    await this.atomic({}, async () => {
      const current = await this.database.projects.get(owner)
      if (!current || current.status !== 'ready') throw new HistoryMetadataConflictError()
      assertCurrent(current)
      const row = await this.snapshotRecord(owner, snapshotId, current)
      if (!row || row.contentHash !== expectedHash || row.kind === 'imported-auto') throw new HistoryMetadataConflictError()
      assertSnapshot(row)
      const metadata = await this.metadataCAS(owner, expectedMetadataVersion)
      await this.history.deletePin(owner, snapshotId)
      await this.database.resourceBindings.delete([owner, row.kind, snapshotId])
      await this.database.historyMetadata.put({ ...metadata, metadataVersion: metadata.metadataVersion + 1 })
    }, true)
  }
  /** Explicit maintenance retains every version, branch and original. Only unreferenced bytes are reclaimed. */
  async maintainHistory(owner: string, options: ResourceOptions = {}): Promise<UnusedResourceCollection> {
    id(owner); checkCancelled(options.signal); await this.open()
    // Maintenance always starts with a fresh full-library audit, even when this
    // connection has a valid session receipt for ordinary saves.
    this.accounting.invalidate()
    return this.atomic(options, async () => {
      const result = await collectUnusedResources(this.database, { assertCurrent, assertAutomatic, assertSnapshot }, options)
      await this.assertBudgets(owner)
      return result
    }, true)
  }
}
