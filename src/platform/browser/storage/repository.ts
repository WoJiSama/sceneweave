import Dexie, { type Table, type Transaction } from 'dexie'
import type { ProjectBundle, ProjectData, ResourceBytePort, SnapshotSummary } from '../../../shared/model/project.js'
import type { PreparationContext } from '../../../shared/ports/runtime.js'
import type { CompleteValidationOptions, ResourceOptions } from '../../../shared/ports/resources.js'
import { checkCancelled } from '../../../shared/ports/resources.js'
import { mergeIdentityRecords } from '../../../shared/history/identity.js'
import { assertFixedProjectCompatible, validateSnapshotSummary, validateHistoryArchive, type HistoryArchive, type SnapshotBundle } from '../../../shared/project/history.js'
import { captureProjectBundleInput, createMemoryResources, validateProjectBundle, validateProjectBundles, type VerifiedProjectBundle } from '../../../shared/project/resources.js'
import { inspectImageBytes } from '../../../shared/project/image-bytes.js'
import { projectContentHash, validateProjectData } from '../../../shared/project/validate.js'
import { projectResourceRecords, projectSourceRecords } from '../../../shared/project/source-resources.js'
import { captureBytes, sha256Bytes } from '../../../shared/project/binary.js'
import { parseBoundedJson } from '../../../shared/project/json.js'
import { canonicalJson, captureJson, cloneJson, encodeUtf8 } from '../../../shared/validation/json.js'
import { assertBackupReceipt } from '../../../shared/migration/set.js'
import { CONVERTER_VERSION, TARGET_FORMAT, type ConversionJob, type ConversionStage, type ConvertedFamily, type LegacySource } from '../../../shared/migration/types.js'
import { inspectProjectDatabase, ProjectDatabase, PROJECT_DATABASE_NAME, PROJECT_TABLES, type BindingKind, type StoredAutomatic,
  type StoredBinding, type StoredBytes, type StoredHistoryMetadata, type StoredProject, type StoredSnapshot } from './database.js'
import { preserveNativeUpgrade, exportNativeUpgradeCapsule, importNativeUpgradeCapsule, listNativeUpgradeSummaries, nativeUpgradeCapsuleDocumentBytes,
  type NativeUpgradeContext, type NativeUpgradeTransfer, type NativeUpgradeSummary } from './native-upgrade.js'
import { StorageAccounting, type StorageTotals } from './storage-accounting.js'
import { IncrementalHistory, migrationManifest, historyVersionBytes, historyHeadBytes, historyPinBytes, type HistoryReadSession, type HistoryVersionSummary } from './incremental-history.js'
import { encodeNativeUpgradeFile, decodeNativeUpgradeFile } from './native-upgrade-file.js'
import { collectUnusedResources, type UnusedResourceCollection } from './history-maintenance.js'

export const PROJECT_STORAGE_LIMITS = Object.freeze({ resourceBytes: 256 * 1024 * 1024, documentBytes: 128 * 1024 * 1024,
  legacyBytes: 128 * 1024 * 1024, automatic: 20, named: 32, protection: 32, imported: 20 } as const)
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
interface ContentChecks { entries: Map<string, CheckedContent>; retainedCharacters: number }
// UTF-16 string storage is bounded independently of the persisted byte budget.
const CONTENT_CHECK_CHARACTER_LIMIT = 4 * 1024 * 1024
const createContentChecks = (): ContentChecks => ({ entries: new Map(), retainedCharacters: 0 })
// Only a selected live transaction owns this table. Fresh IDB clones must
// match the entire inspected canonical JSON, never only an ID or claimed hash.
const transactionContentChecks = new WeakMap<object, ContentChecks>()
function rememberCheckedContent(contents: ContentChecks, json: string, checked: CheckedContent): void {
  if (contents.entries.has(json) || json.length > CONTENT_CHECK_CHARACTER_LIMIT) return
  while (contents.retainedCharacters + json.length > CONTENT_CHECK_CHARACTER_LIMIT) {
    const oldest = contents.entries.keys().next().value!
    contents.entries.delete(oldest)
    contents.retainedCharacters -= oldest.length
  }
  contents.entries.set(json, checked)
  contents.retainedCharacters += json.length
}
function checkedContent(project: ProjectData, contents: ContentChecks): CheckedContent {
  const json = canonicalJson(project)
  let checked = contents.entries.get(json)
  if (!checked) {
    validateProjectData(project)
    const bytes = encodeUtf8(json)
    checked = { hash: sha256Bytes(bytes), byteLength: bytes.length }
    rememberCheckedContent(contents, json, checked)
  }
  return checked
}
/** Called only with this history reader's complete, strictly reconstructed result. */
function rememberReconstructedContent(project: ProjectData, hash: string): void {
  const transaction = Dexie.currentTransaction, contents = transaction && transactionContentChecks.get(transaction)
  if (!contents) return
  const json = canonicalJson(project)
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
function assertCurrent(record: StoredProject, content: typeof assertContent = assertContent): void {
  exact(record, ['sceneId', 'revision', 'savedAt', 'contentHash', 'status', 'conversionJobId', 'project'])
  id(record.sceneId); time(record.savedAt)
  if (!integer(record.revision) || record.sceneId !== record.project?.document.sceneId || record.revision !== record.project.document.revision
    || !['preparing', 'ready'].includes(record.status) || record.conversionJobId !== null && !validId(record.conversionJobId)
    || record.status === 'preparing' && record.conversionJobId === null) throw new Error('当前工程身份、版本或发布状态损坏。')
  content(record.project, record.contentHash)
}
function assertAutomatic(record: StoredAutomatic, content: typeof assertContent = assertContent): void {
  exact(record, ['ownerSceneId', 'revision', 'savedAt', 'contentHash', 'project'])
  id(record.ownerSceneId); time(record.savedAt)
  if (!integer(record.revision) || record.project?.document.sceneId !== record.ownerSceneId || record.project.document.revision !== record.revision) throw new Error('自动快照身份损坏。')
  content(record.project, record.contentHash)
}
function summaryOf(record: SnapshotSummary): SnapshotSummary {
  return { id: record.id, ownerSceneId: record.ownerSceneId, lineageId: record.lineageId, sourceRevision: record.sourceRevision,
    name: record.name, kind: record.kind, createdAt: record.createdAt, contentHash: record.contentHash }
}
function assertSnapshot(record: StoredSnapshot, imported = false, content: typeof assertContent = assertContent): void {
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
export interface ProjectSummary { sceneId: string; title: string; revision: number; savedAt: string; conversionJobId: string | null }
export interface AutomaticSummary { ownerSceneId: string; revision: number; savedAt: string; contentHash: string }
export interface StorageUsage { resourceBytes: number; documentBytes: number; legacyBytes: number; metadataVersion: number; namedCount: number; protectionCount: number; importedCount: number }
export interface HistoryOverview {
  snapshots: SnapshotSummary[]
  usage: StorageUsage
  legacySources: LegacySource[]
  upgradeOriginals: NativeUpgradeSummary[]
  history: { activeVersionId: string | null; versions: HistoryVersionSummary[] }
}
/** One restoration operation; close in finally. Public snapshot reads stay full-validation reads. */
export interface SnapshotReadSession {
  load(ownerSceneId: string, snapshotId: string, options?: ResourceOptions): Promise<SnapshotBundle | null>
  close(): void
}
interface SnapshotReadState {
  closed: boolean
  busy: boolean
  writes: Set<Transaction>
  history: HistoryReadSession
  cached: { json: string; bundle: VerifiedProjectBundle; pixels: readonly unknown[] } | null
}
export interface CreateSnapshotOptions extends ResourceOptions {
  id?: string
  kind?: 'named' | 'protection'
  expectedRevision: number
  expectedMetadataVersion: number
  sourceSnapshot?: { id: string; contentHash: string }
  readSession?: SnapshotReadSession
}
/** Checked in the very same write transaction as the new current revision. */
export interface ProjectSaveGuard {
  expectedMetadataVersion: number
  protection: { id: string; contentHash: string }
}
export interface SourcePreservationGuard {
  sceneId: string
  revision: number
  contentHash: string
  guard: ProjectSaveGuard
}
export interface SaveProjectOptions extends ResourceOptions { guard?: ProjectSaveGuard; preservation?: SourcePreservationGuard; historyParentId?: string; historyParentHash?: string }
export interface ProjectRepositoryOptions {
  name?: string
  validation: CompleteValidationOptions
  runtime: PreparationContext
}
export interface ReserveConversionJob {
  sourceRepository: string
  scopeId: string
  sourceFingerprint: string
  snapshotKeys: string[]
  sourceContentHashes: Record<string, string>
}
export interface ConversionRead { job: ConversionJob; family: ConvertedFamily; contentHash: string; metadataVersion: number; historyFingerprint: string }
interface ResourceAssembly {
  bytes: Map<string, Uint8Array>
  byteLength: number
  resources: ResourceBytePort
  maximumCount?: number
}
export class ConversionConflictError extends Error {
  constructor() { super('转换journal版本、状态或目标已变化；保留已有映射和成果。'); this.name = 'ConversionConflictError' }
}
function assertHashRecord(input: Record<string, string>): void {
  const owned = captureJson(input) as Record<string, string>
  if (!owned || Array.isArray(owned) || Object.values(owned).some(value => !hashValue(value))) throw new Error('转换内容摘要映射无效。')
}
function jobKeyOf(input: Pick<ReserveConversionJob, 'sourceRepository' | 'scopeId' | 'sourceFingerprint'>): string {
  return sha256Bytes(encodeUtf8(canonicalJson({ sourceRepository: input.sourceRepository, scopeId: input.scopeId,
    sourceFingerprint: input.sourceFingerprint, converterVersion: CONVERTER_VERSION, targetFormat: TARGET_FORMAT })))
}
function assertJob(job: ConversionJob): void {
  exact(job, ['jobId', 'jobKey', 'sourceRepository', 'scopeId', 'sourceFingerprint', 'converterVersion', 'targetFormat', 'targetSceneId', 'snapshotIds',
    'stage', 'jobVersion', 'createdAt', 'updatedAt', 'backupReceipt', 'sourceContentHashes', 'targetContentHashes', 'contentHash', 'metadataVersion', 'failure'])
  id(job.jobId); id(job.sourceRepository); id(job.scopeId); id(job.targetSceneId); time(job.createdAt); time(job.updatedAt)
  if (!hashValue(job.jobKey) || !hashValue(job.sourceFingerprint) || job.jobKey !== jobKeyOf(job) || job.converterVersion !== CONVERTER_VERSION || job.targetFormat !== TARGET_FORMAT
    || !['captured', 'backup-verified', 'prepared', 'committed', 'verified', 'failed', 'cancelled'].includes(job.stage) || !integer(job.jobVersion)
    || job.contentHash !== null && !hashValue(job.contentHash) || job.metadataVersion !== null && !integer(job.metadataVersion)
    || job.failure !== null && (typeof job.failure !== 'string' || job.failure.length > 1024)) throw new Error('转换journal字段损坏。')
  const mappings = captureJson(job.snapshotIds) as Record<string, string>
  if (!mappings || Array.isArray(mappings) || Object.values(mappings).some(value => !validId(value)) || new Set(Object.values(mappings)).size !== Object.values(mappings).length
    || Object.keys(mappings).some(key => !key || key.length > 16_384 || key === '__proto__')) throw new Error('转换固定ID映射损坏。')
  assertHashRecord(job.sourceContentHashes); assertHashRecord(job.targetContentHashes)
  if (job.backupReceipt !== null) {
    exact(job.backupReceipt, ['setId', 'sourceFingerprint', 'indexHash', 'volumeHashes'])
    id(job.backupReceipt.setId)
    if (job.backupReceipt.sourceFingerprint !== job.sourceFingerprint || !hashValue(job.backupReceipt.indexHash) || !Array.isArray(job.backupReceipt.volumeHashes)
      || job.backupReceipt.volumeHashes.length > 512 || job.backupReceipt.volumeHashes.some(value => {
        exact(value, ['path', 'sha256'])
        return !/^part-\d{4}\.sceneweave-migration-part$/.test(value.path) || !hashValue(value.sha256)
      })) throw new Error('转换保全receipt摘要损坏。')
  }
  if (['backup-verified', 'prepared', 'committed', 'verified'].includes(job.stage) && !job.backupReceipt) throw new Error('转换journal缺少已重读保全记录。')
  if (['prepared', 'committed', 'verified'].includes(job.stage) && (job.contentHash === null || job.metadataVersion === null)) throw new Error('转换journal缺少目标摘要。')
}
function assertLegacyNodes(nodes: LegacySource[], blobs: { sha256: string; bytes: Uint8Array }[], owner: string): void {
  if (nodes.length > 64 || blobs.length > 64) throw new Error('旧原件来源节点超过保护值。')
  const byId = new Map<string, LegacySource>(), hashes = new Set<string>()
  for (const blob of blobs) {
    const bytes = bytesOf(blob, PROJECT_STORAGE_LIMITS.legacyBytes)
    if (hashes.has(blob.sha256) || !bytes.length) throw new Error('旧原件重复或为空。')
    hashes.add(blob.sha256)
  }
  for (const node of nodes) {
    exact(node, ['ownerSceneId', 'nodeId', 'previousNodeId', 'sourceSchemaVersion', 'sourceSceneId', 'sourceRevision', 'sourceHash', 'migratorVersion', 'migratedAt'])
    id(node.nodeId); id(node.sourceSceneId); id(node.migratorVersion); time(node.migratedAt)
    if (node.ownerSceneId !== owner || byId.has(node.nodeId) || ![1, 2, 3, 4, 5, 6].includes(node.sourceSchemaVersion) || !integer(node.sourceRevision)
      || !hashValue(node.sourceHash) || !hashes.has(node.sourceHash) || node.previousNodeId !== null && !validId(node.previousNodeId)) throw new Error('旧原件来源节点身份、字节或前序损坏。')
    byId.set(node.nodeId, node)
  }
  if ([...hashes].some(hash => !nodes.some(node => node.sourceHash === hash))) throw new Error('旧原件字节没有真实来源节点。')
  for (const node of nodes) {
    const seen = new Set<string>()
    let current: LegacySource | undefined = node
    while (current) {
      if (seen.has(current.nodeId)) throw new Error('旧原件来源链循环。')
      seen.add(current.nodeId)
      if (current.previousNodeId === null) break
      const previous = byId.get(current.previousNodeId)
      if (!previous || previous.sourceSchemaVersion >= current.sourceSchemaVersion) throw new Error('旧原件前序缺失或版本顺序无效。')
      current = previous
    }
  }
}
function captureFamily(input: ConvertedFamily): ConvertedFamily {
  exact(input, ['current', 'snapshots', 'importedSnapshots', 'legacySources', 'legacyBlobs', 'sourceContentHashes'])
  const captureSnapshots = (rows: SnapshotBundle[], imported: boolean): SnapshotBundle[] => {
    if (!Array.isArray(rows) || Object.getPrototypeOf(rows) !== Array.prototype || rows.length > (imported ? 20 : 64)
      || Reflect.ownKeys(rows).length !== rows.length + 1) throw new Error('转换历史数组超过范围或包含额外字段。')
    const result: SnapshotBundle[] = []
    for (let index = 0; index < rows.length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(rows, String(index))
      if (!descriptor?.enumerable || !('value' in descriptor)) throw new Error('转换历史数组不能含空洞或访问器。')
      const row = descriptor.value as SnapshotBundle
      exact(row, ['id', 'ownerSceneId', 'lineageId', 'sourceRevision', 'name', 'kind', 'createdAt', 'contentHash', 'bundle'])
      const summary = validateSnapshotSummary(summaryOf(row))
      if ((summary.kind === 'imported-auto') !== imported) throw new Error('来源自动快照与命名/保护类别不符。')
      result.push({ ...summary, bundle: captureProjectBundleInput(row.bundle) })
    }
    return result
  }
  if (!Array.isArray(input.legacyBlobs) || input.legacyBlobs.length > 64 || Reflect.ownKeys(input.legacyBlobs).length !== input.legacyBlobs.length + 1) throw new Error('旧原件数组无效。')
  const legacyBlobs = []
  for (let index = 0; index < input.legacyBlobs.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(input.legacyBlobs, String(index))
    if (!descriptor?.enumerable || !('value' in descriptor)) throw new Error('旧原件数组不能含空洞或访问器。')
    const row = descriptor.value
    exact(row, ['sha256', 'bytes']); legacyBlobs.push({ sha256: row.sha256 as string, bytes: captureBytes(row.bytes as Uint8Array, PROJECT_STORAGE_LIMITS.legacyBytes) })
  }
  return { current: captureProjectBundleInput(input.current), snapshots: captureSnapshots(input.snapshots, false), importedSnapshots: captureSnapshots(input.importedSnapshots, true),
    legacySources: captureJson(input.legacySources) as LegacySource[], legacyBlobs, sourceContentHashes: captureJson(input.sourceContentHashes) as Record<string, string> }
}

/** One native repository, independent of every legacy writer. Reads and public saves verify real bytes. */
export class ProjectRepository {
  readonly database: ProjectDatabase
  private opening: Promise<void> | null = null
  private invalidated = false
  private readonly accounting: StorageAccounting
  private readonly history: IncrementalHistory
  private readonly historyMigrations = new Map<string, Promise<void>>()
  private readonly snapshotReads = new WeakMap<SnapshotReadSession, SnapshotReadState>()
  private readonly activeSnapshotReads = new Set<SnapshotReadState>()
  constructor(private readonly options: ProjectRepositoryOptions) {
    this.database = new ProjectDatabase(options.name ?? PROJECT_DATABASE_NAME)
    this.history = new IncrementalHistory(this.database, contentHashInTransaction, rememberReconstructedContent)
    this.accounting = new StorageAccounting(this.database, () => this.scanTotals(), (table, row) => this.rowCost(table, row))
    this.database.on('versionchange', () => { this.invalidated = true; this.database.close(); return false })
    this.database.on('blocked', () => { this.invalidated = true; this.database.close() })
    this.database.on('close', () => { for (const state of this.activeSnapshotReads) this.closeSnapshotRead(state) })
  }
  async open(): Promise<void> {
    if (this.invalidated) throw new Error('工程数据库结构已变化，请更新应用后重新打开。')
    if (this.database.isOpen()) return
    this.opening ??= (async () => {
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
      const source = await this.database.transaction('r', PROJECT_TABLES, () => Dexie.waitFor(withTransactionContentChecks(async () => {
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
      const cold = await this.database.transaction('r', PROJECT_TABLES, () => Dexie.waitFor(withTransactionContentChecks(async () => {
        const head = await this.history.head(owner)
        if (!head || head.migration?.sourceManifestHash !== manifest) throw new HistoryMetadataConflictError()
        await this.history.audit(owner)
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
    const upgradeOriginals = await listNativeUpgradeSummaries(this.nativeUpgradeContext(), ownerSceneId)
    const overview = await this.database.transaction('r', PROJECT_TABLES, () => Dexie.waitFor(withTransactionContentChecks(async () => {
      const current = await this.database.projects.get(ownerSceneId)
      if (!current || current.status !== 'ready') throw new Error('原件所属工程不存在或尚未完成转换。')
      assertCurrent(current)
      const head = await this.history.head(ownerSceneId)
      if (!head || head.status !== 'ready' || head.savedRevision !== current.revision || head.contentHash !== current.contentHash) throw new Error('当前保存与历史活动版本不一致。')
      const versions = await this.history.versions(ownerSceneId)
      const usage = await this.usageInTransaction(ownerSceneId)
      const sources = await this.database.legacySources.where('ownerSceneId').equals(ownerSceneId).toArray()
      if (sources.length > 64) throw new Error('旧原件来源节点超过保护值。')
      const blobs = new Map<string, Uint8Array>()
      let total = 0
      for (const hash of new Set(sources.map(source => source.sourceHash))) {
        const stored = await this.database.legacyBlobs.get(hash)
        if (!stored) throw new Error('迁移原件字节缺失；不会导出不完整原件。')
        const bytes = bytesOf(stored, PROJECT_STORAGE_LIMITS.legacyBytes)
        total += bytes.length
        if (total > PROJECT_STORAGE_LIMITS.legacyBytes) throw new Error('迁移原件累计字节超过保护值。')
        blobs.set(hash, bytes)
      }
      assertLegacyNodes(sources, [...blobs].map(([sha256, bytes]) => ({ sha256, bytes })), ownerSceneId)
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
        legacySources: sources.sort((a, b) => b.sourceSchemaVersion - a.sourceSchemaVersion || a.nodeId.localeCompare(b.nodeId)),
        history: { activeVersionId: head.activeVersionId, versions },
      }
    })))
    return { ...overview, upgradeOriginals }
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
    for (const state of this.activeSnapshotReads) this.closeSnapshotRead(state)
    this.accounting.invalidate(); this.database.close()
  }
  private validation(options: ResourceOptions = {}): CompleteValidationOptions { return { images: this.options.validation.images, svg: this.options.validation.svg, signal: options.signal ?? this.options.validation.signal } }
  private nativeUpgradeContext(options: ResourceOptions = {}): NativeUpgradeContext {
    return { database: this.database, open: () => this.open(), validation: this.validation(options), now: () => this.options.runtime.clock.now(),
      assertCurrent, assertAutomatic, assertSnapshot, assertMetadata, assertBinding, assertJob, assertLegacyNodes,
      assertBudgets: owner => this.assertBudgets(owner) }
  }
  /** Preserve every source history/original before a caller saves its independent complete-v3 target. */
  async preserveNativeUpgrade(source: ProjectBundle, target: ProjectBundle, options: ResourceOptions = {}): Promise<void> {
    await this.ensureHistory(source.project.document.sceneId, options)
    await preserveNativeUpgrade(this.nativeUpgradeContext(options), source, target, options)
  }
  async exportNativeUpgradeCapsule(targetSceneId: string, options: ResourceOptions = {}): Promise<NativeUpgradeTransfer> {
    return exportNativeUpgradeCapsule(this.nativeUpgradeContext(options), targetSceneId, options)
  }
  async importNativeUpgradeCapsule(transfer: NativeUpgradeTransfer, options: ResourceOptions = {}): Promise<void> {
    await importNativeUpgradeCapsule(this.nativeUpgradeContext(options), transfer, options)
  }
  async listNativeUpgradeSummaries(targetSceneId: string, options: ResourceOptions = {}): Promise<NativeUpgradeSummary[]> {
    return listNativeUpgradeSummaries(this.nativeUpgradeContext(options), targetSceneId, options)
  }
  async exportNativeUpgradeFile(targetSceneId: string, options: ResourceOptions = {}): Promise<Uint8Array> {
    return encodeNativeUpgradeFile(await this.exportNativeUpgradeCapsule(targetSceneId, options), options)
  }
  /** Archives originals only. It never opens, installs or replaces a current project. */
  async importNativeUpgradeFile(bytes: Uint8Array, options: ResourceOptions = {}): Promise<void> {
    await this.importNativeUpgradeCapsule(await decodeNativeUpgradeFile(bytes, options), options)
  }
  private async atomic<T>(options: ResourceOptions, run: () => Promise<T>, shareContentChecks = false): Promise<T> {
    checkCancelled(options.signal); await this.open(); checkCancelled(options.signal)
    return this.database.transaction('rw', PROJECT_TABLES, async () => {
      const execute = async () => {
        checkCancelled(options.signal)
        const result = await run()
        checkCancelled(options.signal); return result
      }
      // All mutations share one bounded exact-content table and a measured budget receipt.
      void shareContentChecks
      return withTransactionContentChecks(() => this.accounting.run(execute))
    })
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
  private async putResources(bundles: readonly ProjectBundle[], options: ResourceOptions): Promise<void> {
    // Bundles have owned immutable byte ports; DB transactions never perform native image decoding.
    for (const bundle of bundles) {
      for (const [hash, size] of projectResourceRecords(bundle.project)) {
        const bytes = await Dexie.waitFor(bundle.resources.read(hash)), existing = await this.database.resources.get(hash)
        if (bytes.length !== size || sha256Bytes(bytes) !== hash) throw new Error('准备后的资源字节发生改变。')
        if (existing) {
          const before = bytesOf(existing)
          if (before.length !== bytes.length || !before.every((value, index) => value === bytes[index])) throw new Error('相同资源hash的已有字节冲突。')
        } else await this.database.resources.add({ sha256: hash, bytes })
        checkCancelled(options.signal)
      }
      for (const [hash, license] of Object.entries(bundle.project.licenses)) {
        const existing = await this.database.licenseTexts.get(hash)
        if (existing) {
          exact(existing, ['sha256', 'text'])
          if (existing.sha256 !== hash || existing.text !== license.text) throw new Error('相同许可hash的已有正文冲突。')
        } else await this.database.licenseTexts.add(license)
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
    if (table === 'projects') assertCurrent(value as StoredProject, content)
    else if (table === 'automaticSnapshots') assertAutomatic(value as StoredAutomatic, content)
    else if (table === 'snapshots' || table === 'importedSnapshots') assertSnapshot(value as StoredSnapshot, table === 'importedSnapshots', content)
    else if (table === 'nativeUpgradeCapsules') size = nativeUpgradeCapsuleDocumentBytes(value as Parameters<typeof nativeUpgradeCapsuleDocumentBytes>[0], this.nativeUpgradeContext())
    else if (table === 'historyVersions') size = this.history.versionBytes(value)
    else if (table === 'historyHeads') size = historyHeadBytes(value)
    else if (table === 'historyPins') size = historyPinBytes(value)
    else if (table === 'resources' || table === 'legacyBlobs') return { kind: table === 'resources' ? 'resourceBytes' : 'legacyBytes',
      bytes: bytesOf(value as StoredBytes, table === 'resources' ? 20 * 1024 * 1024 : PROJECT_STORAGE_LIMITS.legacyBytes).length }
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
    const totals: StorageTotals = { documentBytes: 0, resourceBytes: 0, legacyBytes: 0 }
    for (const table of ['projects', 'automaticSnapshots', 'snapshots', 'importedSnapshots', 'resources', 'licenseTexts', 'legacyBlobs', 'nativeUpgradeCapsules', 'historyVersions', 'historyHeads', 'historyPins']) {
      await scanRows(this.database.table(table), row => { const cost = this.rowCost(table, row); if (cost) totals[cost.kind] += cost.bytes })
    }
    // Cold/opened connections prove the whole graph once; a session receipt is
    // retained only while all subsequent writes are transactionally measured.
    const heads = await this.database.historyHeads.toArray(), owners = new Set(heads.map(row => row.ownerSceneId))
    for (const head of heads) {
      await this.history.audit(head.ownerSceneId)
      const current = await this.database.projects.get(head.ownerSceneId)
      if (!current || current.revision !== head.savedRevision || current.contentHash !== head.contentHash) throw new Error('历史活动版本与完整当前工程不一致。')
    }
    await scanRows(this.database.historyVersions, row => { if (!owners.has(row.ownerSceneId)) throw new Error('增量历史缺少所属活动分支。') })
    await scanRows(this.database.historyPins, row => { if (!owners.has(row.ownerSceneId)) throw new Error('增量历史快照缺少所属分支。') })
    return totals
  }
  private async usageInTransaction(ownerSceneId: string): Promise<StorageUsage> {
    const totals = await this.accounting.totals(), metadata = await this.database.historyMetadata.get(ownerSceneId)
    if (await this.database.projects.get(ownerSceneId)) assertMetadata(metadata, ownerSceneId)
    const head = await this.history.head(ownerSceneId)
    const pins = head?.status === 'ready' ? await this.history.pins(ownerSceneId) : null
    const rows = pins ?? await this.database.snapshots.where('ownerSceneId').equals(ownerSceneId).toArray()
    return { ...totals, metadataVersion: metadata?.metadataVersion ?? 0,
      namedCount: rows.filter(row => row.kind === 'named').length, protectionCount: rows.filter(row => row.kind === 'protection').length,
      importedCount: pins ? pins.filter(row => row.kind === 'imported-auto').length : await this.database.importedSnapshots.where('ownerSceneId').equals(ownerSceneId).count() }
  }
  private async assertBudgets(ownerSceneId: string): Promise<void> {
    const usage = await this.usageInTransaction(ownerSceneId)
    if (usage.resourceBytes > PROJECT_STORAGE_LIMITS.resourceBytes || usage.documentBytes > PROJECT_STORAGE_LIMITS.documentBytes || usage.legacyBytes > PROJECT_STORAGE_LIMITS.legacyBytes) throw new Error('整个新工程库超过资源、文档或旧原件累计预算；事务未采用。')
    if (usage.namedCount > 32 || usage.protectionCount > 32 || usage.importedCount > 20) throw new Error('命名/保护/来源历史超过保留上限；事务未采用。')
  }
  async usage(ownerSceneId: string): Promise<StorageUsage> {
    id(ownerSceneId); await this.open()
    return this.database.transaction('r', PROJECT_TABLES, () => Dexie.waitFor(this.usageInTransaction(ownerSceneId)))
  }
  /** Metadata for a later CAS only; this is not complete project/library validation. */
  async historyMetadataVersion(ownerSceneId: string, options: ResourceOptions = {}): Promise<number> {
    id(ownerSceneId); checkCancelled(options.signal); await this.open()
    return this.database.transaction('r', this.database.projects, this.database.historyMetadata, async () => {
      checkCancelled(options.signal)
      const current = await this.database.projects.get(ownerSceneId)
      if (!current) throw new ProjectConflictError(null)
      assertCurrent(current, (_project, hash) => {
        if (!hashValue(hash)) throw new Error('存档完整内容hash无效。')
      })
      if (current.status !== 'ready') throw new ProjectConflictError(current.revision)
      const metadata = await this.database.historyMetadata.get(ownerSceneId); assertMetadata(metadata, ownerSceneId)
      checkCancelled(options.signal)
      return metadata.metadataVersion
    })
  }
  private async addCurrent(bundle: ProjectBundle, hash: string, savedAt: string, conversionJobId: string | null, previous: StoredProject | null, parentId?: string): Promise<void> {
    const project = bundle.project, owner = project.document.sceneId
    const row: StoredProject = { sceneId: owner, revision: project.document.revision, savedAt, contentHash: hash, status: 'ready', conversionJobId, project }
    if (previous) await this.database.projects.put(row)
    else await this.database.projects.add(row)
    await this.database.resourceBindings.put(binding(project, owner, 'current', 'current'))
    await this.history.append(row, previous, this.options.runtime.ids.nextId(), parentId)
  }
  private async installFamily(bundle: ProjectBundle, hash: string, savedAt: string, status: StoredProject['status'], conversionJobId: string | null, snapshots: readonly SnapshotBundle[]): Promise<void> {
    const owner = bundle.project.document.sceneId
    const current: StoredProject = { sceneId: owner, revision: bundle.project.document.revision, savedAt, contentHash: hash, status, conversionJobId, project: bundle.project }
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
    if (expectedRevision !== null && !integer(expectedRevision)) throw new Error('保存基线须为非负revision或无记录。')
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
    const captured = captureProjectBundleInput(input), savedAt = this.options.runtime.clock.now(); time(savedAt)
    const bundle = await validateProjectBundle(captured, this.validation(options)), project = bundle.project, hash = projectContentHash(project), owner = project.document.sceneId
    await this.ensureHistory(owner, options)
    if (preservation) await this.ensureHistory(preservation.sceneId, options)
    await this.atomic(options, async () => {
      if (historyParentId !== undefined) {
        const parent = await this.history.readVersion(owner, historyParentId)
        if (!parent || parent.version.contentHash !== historyParentHash || parent.project.document.sceneId !== owner || parent.project.schemaVersion !== project.schemaVersion
          || parent.project.historyIdentity.lineageId !== project.historyIdentity.lineageId) throw new HistoryMetadataConflictError()
      }
      if (preservation) {
        if (preservation.sceneId === owner) throw new Error('独立工程不能覆盖原工程身份。')
        await this.assertProtectionInTransaction(preservation.sceneId, preservation.revision, preservation.contentHash, preservation.guard)
      }
      const previous = await this.database.projects.get(owner)
      if (previous) assertCurrent(previous)
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
        if (canonicalJson(mergeIdentityRecords(project.historyIdentity, [previous.project.historyIdentity])) !== canonicalJson(project.historyIdentity)) throw new Error('后续保存不能丢失既有出生身份/墓碑。')
      } else {
        if (await this.database.historyMetadata.get(owner) || await this.database.automaticSnapshots.where('ownerSceneId').equals(owner).count()
          || await this.database.snapshots.where('ownerSceneId').equals(owner).count() || await this.database.importedSnapshots.where('ownerSceneId').equals(owner).count()) throw new Error('此工程身份已有历史记录，不能覆盖。')
        await this.database.historyMetadata.add({ ownerSceneId: owner, metadataVersion: 0 })
      }
      await this.putResources([bundle], options)
      await this.addCurrent(bundle, hash, savedAt, previous?.conversionJobId ?? null, previous ?? null, historyParentId)
      await this.assertBudgets(owner)
    }, true)
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
    return this.database.transaction('r', PROJECT_TABLES, () => Dexie.waitFor(withTransactionContentChecks(async () => {
      checkCancelled(options.signal)
      await this.assertProtectionInTransaction(owner, expectedRevision, expectedContentHash, captured)
      checkCancelled(options.signal)
    })))
  }
  /** Install an explicitly selected native archive as one fresh complete project, atomically with every history binding. */
  async importArchive(input: HistoryArchive, options: ResourceOptions = {}): Promise<{ project: ProjectBundle; snapshots: SnapshotSummary[] }> {
    const pending = validateHistoryArchive(input, this.validation(options))
    const owner = this.options.runtime.ids.nextId(), savedAt = this.options.runtime.clock.now()
    id(owner); time(savedAt)
    const archive = await pending
    if (owner === archive.current.project.document.sceneId) throw new Error('导入须创建独立工程身份。')
    const data = cloneJson(archive.current.project)
    Object.assign(data.document, { sceneId: owner, revision: 0, createdAt: savedAt, updatedAt: savedAt })
    const project = await validateProjectBundle({ project: data, resources: archive.current.resources }, this.validation(options))
    const usedIds = new Set<string>(), snapshots: SnapshotBundle[] = archive.snapshots.map(source => {
      const snapshotId = this.options.runtime.ids.nextId(); id(snapshotId)
      if (usedIds.has(snapshotId)) throw new Error('导入快照身份重复。')
      usedIds.add(snapshotId)
      return { ...source, id: snapshotId, ownerSceneId: owner }
    })
    await this.atomic(options, async () => {
      if (await this.database.projects.get(owner) || await this.database.historyMetadata.get(owner)
        || await this.database.automaticSnapshots.where('ownerSceneId').equals(owner).count()
        || await this.database.snapshots.where('ownerSceneId').equals(owner).count()
        || await this.database.importedSnapshots.where('ownerSceneId').equals(owner).count()
        || await this.database.resourceBindings.where('ownerSceneId').equals(owner).count()
        || await this.database.legacySources.where('ownerSceneId').equals(owner).count()) throw new Error('导入的新工程身份已占用，未覆盖任何成果。')
      await this.putResources([project, ...snapshots.map(snapshot => snapshot.bundle)], options)
      await this.database.historyMetadata.add({ ownerSceneId: owner, metadataVersion: 0 })
      await this.installFamily(project, projectContentHash(project.project), savedAt, 'ready', null, snapshots)
      await this.assertBudgets(owner)
    })
    return { project, snapshots: snapshots.map(summaryOf) }
  }
  private async readLegacyOriginals(ownerSceneId: string): Promise<{ sources: LegacySource[]; blobs: Map<string, Uint8Array> }> {
    id(ownerSceneId); await this.open()
    return this.database.transaction('r', PROJECT_TABLES, async () => {
      const current = await this.database.projects.get(ownerSceneId)
      if (!current || current.status !== 'ready') throw new Error('原件所属工程不存在或尚未完成转换。')
      assertCurrent(current)
      const sources = await this.database.legacySources.where('ownerSceneId').equals(ownerSceneId).toArray(), blobs = new Map<string, Uint8Array>()
      if (sources.length > 64) throw new Error('旧原件来源节点超过保护值。')
      let total = 0
      for (const hash of new Set(sources.map(source => source.sourceHash))) {
        const stored = await this.database.legacyBlobs.get(hash)
        if (!stored) throw new Error('迁移原件字节缺失；不会导出不完整原件。')
        const bytes = bytesOf(stored, PROJECT_STORAGE_LIMITS.legacyBytes)
        total += bytes.length
        if (total > PROJECT_STORAGE_LIMITS.legacyBytes) throw new Error('迁移原件累计字节超过保护值。')
        blobs.set(hash, bytes)
      }
      assertLegacyNodes(sources, [...blobs].map(([sha256, bytes]) => ({ sha256, bytes })), ownerSceneId)
      return { sources, blobs }
    })
  }
  async listLegacySources(ownerSceneId: string): Promise<LegacySource[]> {
    const { sources } = await this.readLegacyOriginals(ownerSceneId)
    return sources.sort((a, b) => b.sourceSchemaVersion - a.sourceSchemaVersion || a.nodeId.localeCompare(b.nodeId))
  }
  async loadLegacyOriginal(ownerSceneId: string, nodeId: string): Promise<{ source: LegacySource; bytes: Uint8Array }> {
    id(nodeId)
    const { sources, blobs } = await this.readLegacyOriginals(ownerSceneId), source = sources.find(row => row.nodeId === nodeId)
    if (!source) throw new Error('此原件不属于当前工程。')
    return { source, bytes: blobs.get(source.sourceHash)!.slice() }
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
    const captured = await this.database.transaction('r', PROJECT_TABLES, () => Dexie.waitFor(withTransactionContentChecks(async () => {
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
  /** Only trusted platform objects and their own data methods identify pixel validation. */
  private snapshotPixelKey(): readonly unknown[] | null {
    const { images, svg } = this.options.validation
    if (!images || typeof images !== 'object') return null
    const fields = Object.getOwnPropertyDescriptors(images), methods = ['decode', 'transform', 'encodePng'].map(key => fields[key])
    if (methods.some(method => !method || !('value' in method) || typeof method.value !== 'function')) return null
    const rasterize = svg && Object.getOwnPropertyDescriptor(svg, 'rasterize')
    if (svg && (!rasterize || !('value' in rasterize) || typeof rasterize.value !== 'function')) return null
    return [images, ...methods.map(method => method.value), svg, rasterize?.value]
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
    const samePixels = (left: readonly unknown[] | null, right: readonly unknown[] | null) => left !== null && right !== null
      && left.length === right.length && left.every((value, index) => value === right[index])
    try {
      assertActive()
      // Each read freshly proves the real DB rows, complete graph, bindings,
      // resource bytes/hashes/sizes and license bodies before considering reuse.
      const captured = await this.captureSnapshot(owner, snapshotId, options, session)
      assertActive()
      if (!captured) { state.cached = null; return null }
      const json = canonicalJson(captured.bundle.project), pixels = this.snapshotPixelKey(), cached = state.cached
      let bundle: VerifiedProjectBundle | null = null
      if (cached && json === cached.json && samePixels(pixels, cached.pixels)) {
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
        if (sameBytes && samePixels(pixels, this.snapshotPixelKey())) bundle = cached.bundle
      }
      let proofPixels = pixels
      if (!bundle) {
        proofPixels = this.snapshotPixelKey()
        bundle = await validateProjectBundle(captured.bundle, this.validation(options))
      }
      assertActive()
      // No RGBA/Bitmap is retained. Only a successful immutable metadata/byte
      // closure may survive until the next read in this explicitly scoped operation.
      state.cached = proofPixels && samePixels(proofPixels, this.snapshotPixelKey()) ? { json, bundle, pixels: proofPixels } : null
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
      const context = this.nativeUpgradeContext(options)
      const result = await collectUnusedResources(this.database, { ...context,
        assertCapsule: row => { nativeUpgradeCapsuleDocumentBytes(row, context) } }, options)
      await this.assertBudgets(owner)
      return result
    }, true)
  }
  async getJob(jobId: string): Promise<ConversionJob | null> {
    id(jobId); await this.open()
    const row = await this.database.conversionJobs.get(jobId)
    if (!row) return null
    assertJob(row); return row
  }
  async reserveJob(input: ReserveConversionJob, options: ResourceOptions = {}): Promise<ConversionJob> {
    const captured = captureJson(input) as ReserveConversionJob
    exact(captured, ['sourceRepository', 'scopeId', 'sourceFingerprint', 'snapshotKeys', 'sourceContentHashes'])
    id(captured.sourceRepository); id(captured.scopeId); assertHashRecord(captured.sourceContentHashes)
    if (!hashValue(captured.sourceFingerprint) || !Array.isArray(captured.snapshotKeys) || captured.snapshotKeys.length > 84
      || new Set(captured.snapshotKeys).size !== captured.snapshotKeys.length || captured.snapshotKeys.some(key => typeof key !== 'string' || !key || key.length > 16_384 || key === '__proto__')) throw new Error('转换源指纹或历史键范围无效。')
    const key = jobKeyOf(captured)
    return this.atomic(options, async () => {
      const existing = await this.database.conversionJobs.where('jobKey').equals(key).first()
      if (existing) {
        assertJob(existing)
        if (canonicalJson(existing.sourceContentHashes) !== canonicalJson(captured.sourceContentHashes)
          || canonicalJson(Object.keys(existing.snapshotIds).sort()) !== canonicalJson([...captured.snapshotKeys].sort())) throw new Error('相同转换指纹对应不同源内容或历史键，不能重用。')
        return existing
      }
      const jobId = this.options.runtime.ids.nextId(), targetSceneId = this.options.runtime.ids.nextId(), now = this.options.runtime.clock.now()
      id(jobId); id(targetSceneId); time(now)
      const snapshotIds = Object.fromEntries([...captured.snapshotKeys].sort().map(key => [key, this.options.runtime.ids.nextId()]))
      const journal: ConversionJob = { jobId, jobKey: key, sourceRepository: captured.sourceRepository, scopeId: captured.scopeId, sourceFingerprint: captured.sourceFingerprint,
        converterVersion: CONVERTER_VERSION, targetFormat: TARGET_FORMAT, targetSceneId, snapshotIds, stage: 'captured', jobVersion: 0, createdAt: now, updatedAt: now,
        backupReceipt: null, sourceContentHashes: captured.sourceContentHashes, targetContentHashes: {}, contentHash: null, metadataVersion: null, failure: null }
      assertJob(journal)
      if (await this.database.projects.get(targetSceneId)) throw new Error('转换新目标身份已被占用。')
      await this.database.conversionJobs.add(journal)
      return journal
    })
  }
  private async jobCAS(jobId: string, expectedVersion: number, stage?: ConversionStage): Promise<ConversionJob> {
    const job = await this.database.conversionJobs.get(jobId)
    if (!job) throw new ConversionConflictError()
    assertJob(job)
    if (!integer(expectedVersion) || job.jobVersion !== expectedVersion || job.jobVersion === Number.MAX_SAFE_INTEGER || stage !== undefined && job.stage !== stage) throw new ConversionConflictError()
    return job
  }
  private nextJob(job: ConversionJob, stage: ConversionStage, patch: Partial<ConversionJob> = {}): ConversionJob {
    const updatedAt = this.options.runtime.clock.now(); time(updatedAt)
    const next = { ...job, ...patch, stage, jobVersion: job.jobVersion + 1, updatedAt }; assertJob(next)
    return next
  }
  async advanceJob(jobId: string, expectedVersion: number, stage: 'backup-verified' | 'failed' | 'cancelled',
    patch: { backupReceipt?: unknown; failure?: string } = {}, options: ResourceOptions = {}): Promise<ConversionJob> {
    id(jobId)
    if (!['backup-verified', 'failed', 'cancelled'].includes(stage)) throw new Error('转换阶段须通过专用准备、提交或发布入口推进。')
    // Never clone a receipt before checking its process-local identity.
    exact(patch, Object.keys(patch))
    if (Object.keys(patch).some(key => !['backupReceipt', 'failure'].includes(key))) throw new Error('转换阶段补丁包含未知字段。')
    const receiptInput = patch.backupReceipt
    const failure = patch.failure ?? (stage === 'cancelled' ? '用户取消转换。' : null)
    if (failure !== null && (typeof failure !== 'string' || failure.length > 1024)) throw new Error('转换失败原因超出范围。')
    return this.atomic(options, async () => {
      const job = await this.jobCAS(jobId, expectedVersion)
      if (job.stage === 'verified' || stage === 'backup-verified' && job.stage !== 'captured'
        || stage !== 'backup-verified' && ['failed', 'cancelled'].includes(job.stage)) throw new ConversionConflictError()
      const receipt = stage === 'backup-verified' ? cloneJson(assertBackupReceipt(receiptInput, { setId: job.jobId, sourceFingerprint: job.sourceFingerprint })) : job.backupReceipt
      const next = this.nextJob(job, stage, { backupReceipt: receipt, failure: stage === 'backup-verified' ? null : failure })
      await this.database.conversionJobs.put(next)
      return next
    })
  }
  private async checkedFamily(input: ConvertedFamily, job: ConversionJob, options: ResourceOptions): Promise<ConvertedFamily> {
    const family = captureFamily(input), current = family.current.project, owner = current.document.sceneId
    if (owner !== job.targetSceneId || current.document.revision !== 0 || canonicalJson(family.sourceContentHashes) !== canonicalJson(job.sourceContentHashes)) throw new Error('转换目标身份、revision0或源内容摘要与固定journal不符。')
    const summaries = [...family.snapshots, ...family.importedSnapshots], all = [family.current, ...summaries.map(row => row.bundle)]
    const ids = new Set<string>(), reserved = new Set(Object.values(job.snapshotIds))
    for (const snapshot of summaries) {
      const project = snapshot.bundle.project
      if (ids.has(snapshot.id) || !reserved.has(snapshot.id) || snapshot.ownerSceneId !== owner || snapshot.contentHash !== projectContentHash(project)
        || snapshot.sourceRevision !== project.document.revision || snapshot.lineageId !== project.historyIdentity.lineageId) throw new Error('转换历史ID、归属或内容摘要不符。')
      ids.add(snapshot.id)
    }
    if (['v6', 'file-v6', 'sceneweave-m1-outdoor'].includes(job.sourceRepository) && (ids.size !== reserved.size || [...reserved].some(value => !ids.has(value)))) throw new Error('v6转换必须完整迁入固定映射的全部命名、保护和来源自动历史。')
    if (job.sourceRepository === 'v6' || job.sourceRepository === 'file-v6') {
      const byId = new Map(summaries.map(snapshot => [snapshot.id, snapshot]))
      for (const [key, mappedId] of Object.entries(job.snapshotIds)) {
        const source = parseBoundedJson(encodeUtf8(key), { values: 0 })
        exact(source, ['repository', 'ownerSceneId', 'kind', 'id'])
        if (canonicalJson(source) !== key || source.repository !== job.sourceRepository || source.ownerSceneId !== job.scopeId
          || !['named', 'protection', 'automatic'].includes(source.kind as string) || !validId(source.id) || !Object.hasOwn(job.sourceContentHashes, key)) throw new Error('v6历史规范源键与固定journal范围不符。')
        const snapshot = byId.get(mappedId)!
        if (snapshot.kind !== (source.kind === 'automatic' ? 'imported-auto' : source.kind)) throw new Error('v6历史快照类别与规范源键不符。')
        if (source.kind === 'automatic' && (!/^(0|[1-9]\d*)$/.test(source.id) || !integer(Number(source.id)) || snapshot.sourceRevision !== Number(source.id))) throw new Error('v6来源自动快照修订与规范源键不符。')
      }
    }
    if (family.snapshots.filter(row => row.kind === 'named').length > 32 || family.snapshots.filter(row => row.kind === 'protection').length > 32) throw new Error('转换命名/保护快照超过32+32限制。')
    if (canonicalJson(mergeIdentityRecords(current.historyIdentity, summaries.map(row => row.bundle.project.historyIdentity))) !== canonicalJson(current.historyIdentity)) throw new Error('转换当前身份未完整保留家族出生/墓碑。')
    let jsonBytes = 0
    const imageRecords = new Map<string, ProjectData['assets'][string]>(), licenses = new Map<string, string>(), sourceRecords = new Map<string, number>()
    for (let index = 0; index < all.length; index++) {
      const project = all[index].project
      jsonBytes += encodeUtf8(canonicalJson(project)).length
      for (let previous = 0; previous < index; previous++) assertFixedProjectCompatible(all[previous].project, project)
      for (const [hash, record] of Object.entries(project.assets)) {
        if (imageRecords.has(hash) && canonicalJson(imageRecords.get(hash)) !== canonicalJson(record)) throw new Error('转换家族相同图片hash的元数据冲突。')
        imageRecords.set(hash, record)
      }
      for (const [hash, size] of projectSourceRecords(project)) {
        if (sourceRecords.has(hash) && sourceRecords.get(hash) !== size) throw new Error('转换家族相同SVG源hash的字节声明冲突。')
        sourceRecords.set(hash, size)
      }
      for (const [hash, license] of Object.entries(project.licenses)) {
        if (licenses.has(hash) && licenses.get(hash) !== license.text) throw new Error('转换家族相同许可hash的正文冲突。')
        licenses.set(hash, license.text)
      }
    }
    const imageBytes = [...imageRecords.values()].reduce((sum, value) => sum + value.sizeBytes, 0), licenseBytes = [...licenses.values()].reduce((sum, value) => sum + encodeUtf8(value).length, 0)
    const sourceBytes = [...sourceRecords.values()].reduce((sum, size) => sum + size, 0)
    if (imageRecords.size > 256 || [...imageRecords.values()].reduce((sum, value) => sum + value.pixelWidth * value.pixelHeight, 0) > 64_000_000
      || sourceRecords.size > 512 || sourceBytes > 32 * 1024 * 1024 || jsonBytes > 128 * 1024 * 1024
      || jsonBytes + imageBytes + sourceBytes + licenseBytes > 300 * 1024 * 1024) throw new Error('转换家族完整图片/源/像素/文档或展开字节超过保护预算。')
    assertLegacyNodes(family.legacySources, family.legacyBlobs, owner)
    if (family.legacyBlobs.reduce((sum, value) => sum + value.bytes.length, 0) > PROJECT_STORAGE_LIMITS.legacyBytes) throw new Error('转换原件累计超过128MiB。')
    const verified = await validateProjectBundles(all, this.validation(options))
    family.current = verified[0]
    summaries.forEach((row, index) => { row.bundle = verified[index + 1] })
    checkCancelled(options.signal)
    return family
  }
  private targetHashes(family: ConvertedFamily): Record<string, string> {
    return Object.fromEntries([['current', projectContentHash(family.current.project)],
      ...[...family.snapshots, ...family.importedSnapshots].map(row => [canonicalJson([row.kind, row.id]), row.contentHash]),
      ...family.legacySources.map(row => [canonicalJson(['legacy-source', row.nodeId]), sha256Bytes(encodeUtf8(canonicalJson(row)))]),
      ...family.legacyBlobs.map(row => [canonicalJson(['legacy-blob', row.sha256]), row.sha256])])
  }
  private async projectedBudgets(family: ConvertedFamily): Promise<void> {
    const usage = await this.usageInTransaction(family.current.project.document.sceneId)
    let resources = usage.resourceBytes, documents = usage.documentBytes, legacy = usage.legacyBytes
    const all = [family.current, ...family.snapshots.map(row => row.bundle), ...family.importedSnapshots.map(row => row.bundle)]
    // A successful conversion adds both current and its first normal automatic snapshot.
    documents += encodeUtf8(canonicalJson(family.current.project)).length
    const assets = new Set<string>(), licenses = new Set<string>(), originals = new Set<string>()
    for (const bundle of all) {
      documents += encodeUtf8(canonicalJson(bundle.project)).length
      for (const [hash, size] of projectResourceRecords(bundle.project)) if (!assets.has(hash)) {
        assets.add(hash)
        if (!(await this.database.resources.get(hash))) resources += size
      }
      for (const [hash, license] of Object.entries(bundle.project.licenses)) if (!licenses.has(hash)) {
        licenses.add(hash)
        if (!(await this.database.licenseTexts.get(hash))) resources += encodeUtf8(license.text).length
      }
    }
    for (const blob of family.legacyBlobs) if (!originals.has(blob.sha256)) {
      originals.add(blob.sha256)
      if (!(await this.database.legacyBlobs.get(blob.sha256))) legacy += blob.bytes.length
    }
    if (resources > PROJECT_STORAGE_LIMITS.resourceBytes || documents > PROJECT_STORAGE_LIMITS.documentBytes || legacy > PROJECT_STORAGE_LIMITS.legacyBytes) throw new Error('转换后整个新主库超过资源、文档或旧原件预算。')
  }
  async prepareConversion(jobId: string, expectedVersion: number, input: ConvertedFamily, options: ResourceOptions = {}): Promise<ConversionJob> {
    const captured = captureFamily(input)
    const job = await this.getJob(jobId)
    if (!job || job.stage !== 'backup-verified' || job.jobVersion !== expectedVersion) throw new ConversionConflictError()
    const family = await this.checkedFamily(captured, job, options)
    await this.open()
    await this.database.transaction('r', PROJECT_TABLES, () => this.projectedBudgets(family))
    const hashes = this.targetHashes(family)
    return this.atomic(options, async () => {
      const current = await this.jobCAS(jobId, expectedVersion, 'backup-verified')
      if (await this.database.projects.get(current.targetSceneId)) throw new ConversionConflictError()
      const next = this.nextJob(current, 'prepared', { targetContentHashes: hashes, contentHash: hashes.current, metadataVersion: 0, failure: null })
      await this.database.conversionJobs.put(next)
      return next
    })
  }
  async commitConversion(jobId: string, expectedVersion: number, input: ConvertedFamily, options: ResourceOptions = {}): Promise<ConversionJob> {
    const captured = captureFamily(input)
    const job = await this.getJob(jobId)
    if (!job || job.stage !== 'prepared' || job.jobVersion !== expectedVersion) throw new ConversionConflictError()
    const family = await this.checkedFamily(captured, job, options), hashes = this.targetHashes(family)
    if (canonicalJson(hashes) !== canonicalJson(job.targetContentHashes) || hashes.current !== job.contentHash || job.metadataVersion !== 0) throw new Error('转换候选与prepared记录不一致。')
    const savedAt = this.options.runtime.clock.now(); time(savedAt)
    return this.atomic(options, async () => {
      const current = await this.jobCAS(jobId, expectedVersion, 'prepared'), owner = current.targetSceneId
      if (await this.database.projects.get(owner) || await this.database.historyMetadata.get(owner) || await this.database.automaticSnapshots.where('ownerSceneId').equals(owner).count()
        || await this.database.snapshots.where('ownerSceneId').equals(owner).count() || await this.database.importedSnapshots.where('ownerSceneId').equals(owner).count()
        || await this.database.resourceBindings.where('ownerSceneId').equals(owner).count() || await this.database.legacySources.where('ownerSceneId').equals(owner).count()) throw new ConversionConflictError()
      await this.projectedBudgets(family)
      const all = [family.current, ...family.snapshots.map(row => row.bundle), ...family.importedSnapshots.map(row => row.bundle)]
      await this.putResources(all, options)
      await this.database.historyMetadata.add({ ownerSceneId: owner, metadataVersion: 0 })
      await this.installFamily(family.current, hashes.current, savedAt, 'preparing', jobId, [...family.snapshots, ...family.importedSnapshots])
      for (const blob of family.legacyBlobs) {
        const existing = await this.database.legacyBlobs.get(blob.sha256)
        if (existing) {
          const bytes = bytesOf(existing, PROJECT_STORAGE_LIMITS.legacyBytes)
          if (bytes.length !== blob.bytes.length || !bytes.every((value, index) => value === blob.bytes[index])) throw new Error('旧原件已有字节冲突。')
        } else await this.database.legacyBlobs.add(blob)
      }
      for (const node of family.legacySources) await this.database.legacySources.add(node)
      await this.assertBudgets(owner)
      const next = this.nextJob(current, 'committed')
      // The reservation already exists; this updates it in the same transaction as every new record.
      await this.database.conversionJobs.put(next)
      return next
    })
  }
  /** Internal preparation read; preparing projects remain hidden from ordinary load/list APIs. */
  async readConversion(jobId: string, options: ResourceOptions = {}): Promise<ConversionRead> {
    id(jobId); checkCancelled(options.signal); await this.open()
    const captured = await this.database.transaction('r', PROJECT_TABLES, async () => {
      const job = await this.database.conversionJobs.get(jobId)
      if (!job) throw new ConversionConflictError()
      assertJob(job)
      if (!['committed', 'verified', 'failed', 'cancelled'].includes(job.stage)) throw new ConversionConflictError()
      const row = await this.database.projects.get(job.targetSceneId)
      if (!row) throw new Error('转换目标缺失；不会静默重建。')
      assertCurrent(row)
      if (row.conversionJobId !== jobId || job.stage !== 'verified' && (row.status !== 'preparing' || row.revision !== 0 || row.contentHash !== job.contentHash)) throw new Error('转换目标状态或内容与journal不符。')
      const metadata = await this.database.historyMetadata.get(row.sceneId); assertMetadata(metadata, row.sceneId)
      // One readonly transaction observes one immutable resource store. Capture
      // each hash once across all historical states, without a full byte copy
      // per snapshot. Only the private port escapes this scope, and every read
      // still returns a copy; final validation creates per-project scoped ports.
      const bytes = new Map<string, Uint8Array>()
      const shared: ResourceAssembly = { bytes, byteLength: 0, resources: Object.freeze({ async read(hash: string) {
        const value = bytes.get(hash)
        if (!value) throw new Error('转换冷读所需资源字节缺失。')
        return value.slice()
      } }) }
      if (job.stage !== 'verified') {
        const head = await this.history.head(row.sceneId)
        if (head?.status === 'ready') {
          const automatic = await this.history.readVersion(row.sceneId, head.activeVersionId)
          if (!automatic || head.savedRevision !== 0 || head.contentHash !== row.contentHash || automatic.version.contentHash !== row.contentHash
            || canonicalJson(automatic.project) !== canonicalJson(row.project)) throw new Error('转换首份自动历史与当前内容不符。')
          await this.assembledUnbound(automatic.project, shared)
        } else {
          const automatic = await this.database.automaticSnapshots.where('ownerSceneId').equals(row.sceneId).toArray()
          if (automatic.length !== 1) throw new Error('转换首份自动历史缺失或重复。')
          assertAutomatic(automatic[0])
          if (automatic[0].revision !== 0 || automatic[0].contentHash !== row.contentHash || canonicalJson(automatic[0].project) !== canonicalJson(row.project)) throw new Error('转换首份自动历史与当前内容不符。')
          await this.assembled(automatic[0].project, row.sceneId, 'automatic', '0', shared)
        }
      }
      const family: ConvertedFamily = { current: await this.assembled(row.project, row.sceneId, 'current', 'current', shared), snapshots: [], importedSnapshots: [],
        legacySources: await this.database.legacySources.where('ownerSceneId').equals(row.sceneId).toArray(), legacyBlobs: [], sourceContentHashes: job.sourceContentHashes }
      const head = await this.history.head(row.sceneId)
      const historical: StoredSnapshot[] = []
      if (head?.status === 'ready') {
        for (const pin of await this.history.pins(row.sceneId)) {
          const snapshot = await this.history.readPin(row.sceneId, pin.id, row)
          if (!snapshot) throw new Error('转换当前历史引用缺失。')
          historical.push(snapshot)
        }
      } else historical.push(...await this.database.snapshots.where('ownerSceneId').equals(row.sceneId).toArray(), ...await this.database.importedSnapshots.where('ownerSceneId').equals(row.sceneId).toArray())
      for (const snapshot of historical) {
        assertSnapshot(snapshot, snapshot.kind === 'imported-auto')
        const full = { ...summaryOf(snapshot), bundle: await this.assembled(snapshot.project, row.sceneId, snapshot.kind, snapshot.id, shared) }
        ;(snapshot.kind === 'imported-auto' ? family.importedSnapshots : family.snapshots).push(full)
      }
      for (const hash of new Set(family.legacySources.map(node => node.sourceHash))) {
        const blob = await this.database.legacyBlobs.get(hash)
        if (!blob) throw new Error('转换旧原件字节缺失。')
        family.legacyBlobs.push({ sha256: hash, bytes: bytesOf(blob, PROJECT_STORAGE_LIMITS.legacyBytes) })
      }
      return { job, family, contentHash: row.contentHash, metadataVersion: metadata.metadataVersion,
        historyFingerprint: await this.historyCopyFingerprint(row.sceneId) }
    })
    if (captured.job.stage === 'verified') {
      // Once opened, user edits are authoritative. Validate their full current/history content without imposing r0.
      const all = [captured.family.current, ...captured.family.snapshots.map(row => row.bundle), ...captured.family.importedSnapshots.map(row => row.bundle)]
      const verified = await validateProjectBundles(all, this.validation(options))
      captured.family.current = verified[0]
      ;[...captured.family.snapshots, ...captured.family.importedSnapshots].forEach((row, index) => { row.bundle = verified[index + 1] })
      assertLegacyNodes(captured.family.legacySources, captured.family.legacyBlobs, captured.job.targetSceneId)
      return captured
    }
    captured.family = await this.checkedFamily(captured.family, captured.job, options)
    if (captured.contentHash !== captured.job.contentHash || captured.metadataVersion !== captured.job.metadataVersion
      || canonicalJson(this.targetHashes(captured.family)) !== canonicalJson(captured.job.targetContentHashes)) throw new Error('冷读转换内容、历史或元数据不符，工程继续保持未开放。')
    return captured
  }
  async publishConversion(jobId: string, expectedVersion: number, options: ResourceOptions = {}): Promise<ProjectBundle> {
    const initial = await this.getJob(jobId)
    if (!initial) throw new ConversionConflictError()
    if (initial.stage === 'verified') {
      const current = await this.load(initial.targetSceneId, options)
      if (!current) throw new Error('已开放转换目标缺失或不可读；不会覆盖已有结果。')
      return current
    }
    if (initial.stage !== 'committed' || initial.jobVersion !== expectedVersion) throw new ConversionConflictError()
    const cold = await this.readConversion(jobId, options)
    await this.atomic(options, async () => {
      const job = await this.jobCAS(jobId, expectedVersion, 'committed'), row = await this.database.projects.get(job.targetSceneId)
      if (!row) throw new ConversionConflictError()
      assertCurrent(row)
      const metadata = await this.database.historyMetadata.get(row.sceneId); assertMetadata(metadata, row.sceneId)
      if (row.status !== 'preparing' || row.conversionJobId !== jobId || row.revision !== 0 || row.contentHash !== cold.contentHash
        || row.contentHash !== job.contentHash || metadata.metadataVersion !== cold.metadataVersion || metadata.metadataVersion !== job.metadataVersion
        || await this.historyCopyFingerprint(row.sceneId) !== cold.historyFingerprint) throw new ConversionConflictError()
      await this.database.projects.put({ ...row, status: 'ready' })
      await this.database.conversionJobs.put(this.nextJob(job, 'verified'))
    })
    return cold.family.current
  }
  async retryJob(jobId: string, expectedVersion: number, options: ResourceOptions = {}): Promise<ConversionJob> {
    const initial = await this.getJob(jobId)
    if (!initial || initial.jobVersion !== expectedVersion) throw new ConversionConflictError()
    if (initial.stage === 'verified') {
      if (!(await this.load(initial.targetSceneId, options))) throw new Error('已开放目标损坏或缺失。')
      return initial
    }
    if (!['failed', 'cancelled'].includes(initial.stage)) throw new ConversionConflictError()
    const row = await this.database.projects.get(initial.targetSceneId)
    if (row) {
      assertCurrent(row)
      if (row.status === 'ready') {
        if (row.conversionJobId !== jobId || !(await this.load(row.sceneId, options))) throw new Error('已开放转换目标缺失、归属不符或不可读。')
        return this.atomic(options, async () => {
          const job = await this.jobCAS(jobId, expectedVersion), target = await this.database.projects.get(row.sceneId)
          if (!['failed', 'cancelled'].includes(job.stage) || !target || target.status !== 'ready' || target.conversionJobId !== jobId
            || target.revision !== row.revision || target.contentHash !== row.contentHash) throw new ConversionConflictError()
          assertCurrent(target)
          const next = this.nextJob(job, 'verified', { failure: null })
          await this.database.conversionJobs.put(next)
          return next
        })
      }
      await this.readConversion(jobId, options)
    }
    return this.atomic(options, async () => {
      const current = await this.jobCAS(jobId, expectedVersion)
      if (!['failed', 'cancelled'].includes(current.stage)) throw new ConversionConflictError()
      const target = await this.database.projects.get(current.targetSceneId)
      if (target && (target.status !== 'preparing' || target.revision !== 0 || target.contentHash !== current.contentHash)) throw new ConversionConflictError()
      const next = this.nextJob(current, target ? 'committed' : 'captured', { failure: null })
      await this.database.conversionJobs.put(next)
      return next
    })
  }
}
