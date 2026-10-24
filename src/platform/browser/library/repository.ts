import Dexie, { type Transaction } from 'dexie'
import type { CatalogOrganization, LibraryEntrySummary, LibraryMutation, LibrarySnapshot, PreparedLibraryEntry } from '../../../shared/library/types.js'
import { LIBRARY_LIMITS } from '../../../shared/library/types.js'
import { validateCatalogItem, validateCatalogKey } from '../../../shared/library/metadata.js'
import { validateCatalogOrganization } from '../../../shared/library/organization.js'
import { captureLibraryEntries, validateLibraryEntry } from '../../../shared/library/content.js'
import type { PreparationContext } from '../../../shared/ports/runtime.js'
import { checkCancelled, type CompleteValidationOptions, type ResourceOptions } from '../../../shared/ports/resources.js'
import { captureBytes, sha256Bytes } from '../../../shared/project/binary.js'
import { canonicalJson, captureJson, cloneJson, encodeUtf8 } from '../../../shared/validation/json.js'
import { assertBackupReceipt } from '../../../shared/migration/set.js'
import { CONVERTER_VERSION, type BackupReceiptSummary, type ConversionStage } from '../../../shared/migration/types.js'
import { inspectLibraryDatabase, LibraryDatabase, LIBRARY_DATABASE_NAME, LIBRARY_TABLES, type StoredEntry, type StoredOrganization, type StagedRecord } from './database.js'

export const LIBRARY_TARGET_FORMAT = 'sceneweave-asset-library@1' as const
export type OrganizationPolicy = 'keep-local' | 'replace-selected'
export interface LibraryRepositoryOptions { name?: string; validation: CompleteValidationOptions; runtime: PreparationContext }
export interface ReserveLibraryConversion {
  sourceRepository: string; scopeId: string; sourceFingerprint: string
  entryKeys: string[]; organizationKeys: string[]; sourceContentHashes: Record<string, string>
}
export interface LibraryConversionInput {
  entries: PreparedLibraryEntry[]; organizations: Record<string, CatalogOrganization>
  sourceContentHashes: Record<string, string>; organizationPolicy: OrganizationPolicy
}
export interface LibraryConversionJob extends ReserveLibraryConversion {
  jobId: string; jobKey: string; converterVersion: typeof CONVERTER_VERSION; targetFormat: typeof LIBRARY_TARGET_FORMAT
  stage: ConversionStage; jobVersion: number; createdAt: string; updatedAt: string
  backupReceipt: BackupReceiptSummary | null; targetRevision: number | null; targetHash: string | null
  targetContentHashes: Record<string, string>; organizationPolicy: OrganizationPolicy | null; failure: string | null
}
export interface LibraryConversionRead { job: LibraryConversionJob; entries: PreparedLibraryEntry[]; organizations: Record<string, CatalogOrganization> }
export class LibraryConflictError extends Error {
  constructor(readonly actualRevision: number) { super('个人素材库已在其他标签更新，请刷新后明确重应用。'); this.name = 'LibraryConflictError' }
}
export class LibraryConversionConflictError extends Error {
  constructor() { super('个人库转换journal、阶段或目标版本已变化，保留已有成果。'); this.name = 'LibraryConversionConflictError' }
}
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const identifier = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 256 && !value.includes('\0') && value !== '__proto__'
function exact(input: unknown, keys: readonly string[]): asserts input is Record<string, unknown> {
  if (!input || typeof input !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) throw new Error('个人库记录须为普通数据。')
  const descriptors = Object.getOwnPropertyDescriptors(input)
  if (Reflect.ownKeys(input).length !== keys.length || !keys.every(key => descriptors[key]?.enumerable && 'value' in descriptors[key])) throw new Error('个人库字段缺失或含未知、访问器、隐藏或Symbol字段。')
}
function array(input: unknown, maximum: number): unknown[] {
  if (!Array.isArray(input) || Object.getPrototypeOf(input) !== Array.prototype || input.length > maximum || Reflect.ownKeys(input).length !== input.length + 1) throw new Error('个人库数组超过保护值或含额外字段。')
  return Array.from({ length: input.length }, (_, index) => {
    const descriptor = Object.getOwnPropertyDescriptor(input, String(index))
    if (!descriptor?.enumerable || !('value' in descriptor)) throw new Error('个人库数组不能含访问器或空洞。')
    return descriptor.value
  })
}
function revision(input: unknown): asserts input is number { if (!integer(input)) throw new Error('个人库revision无效。') }
function time(input: unknown): asserts input is string { if (typeof input !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(input) || !Number.isFinite(Date.parse(input))) throw new Error('个人库时间无效。') }
function hashRecord(input: unknown): Record<string, string> {
  const owned = captureJson(input) as Record<string, string>
  if (!owned || Array.isArray(owned) || typeof owned !== 'object' || Object.values(owned).some(value => !hash(value))) throw new Error('个人库转换内容摘要无效。')
  return owned
}
function captureEntry(input: unknown): PreparedLibraryEntry {
  exact(input, ['item', 'capsule', 'capsuleSha256'])
  const item = validateCatalogItem(captureJson(input.item)), capsule = captureBytes(input.capsule as Uint8Array, LIBRARY_LIMITS.capsuleBytes)
  if (!capsule.length || !hash(input.capsuleSha256) || sha256Bytes(capsule) !== input.capsuleSha256) throw new Error('素材载体实际字节或hash不符。')
  return { item, capsule, capsuleSha256: input.capsuleSha256 }
}
function organizations(input: unknown): Record<string, CatalogOrganization> {
  const owned = captureJson(input) as Record<string, unknown>
  if (!owned || Array.isArray(owned) || typeof owned !== 'object' || Object.keys(owned).length > LIBRARY_LIMITS.organizationRecords) throw new Error('个人整理记录超过保护值。')
  return Object.fromEntries(Object.entries(owned).map(([key, value]) => [validateCatalogKey(key), validateCatalogOrganization(value)]))
}
function summary(row: StoredEntry): LibraryEntrySummary {
  exact(row, ['key', 'logicalKey', 'entry'])
  const entry = captureEntry(row.entry)
  if (row.key !== entry.item.identity.key || row.logicalKey !== entry.item.identity.logicalKey) throw new Error('个人库固定身份与内容不符。')
  return { item: entry.item, capsuleSha256: entry.capsuleSha256, sizeBytes: entry.capsule.length }
}
function logicalOf(key: string): string { return JSON.stringify(JSON.parse(validateCatalogKey(key)).slice(0, 5)) }
function snapshot(rev: number, entries: StoredEntry[], orgs: StoredOrganization[]): LibrarySnapshot {
  revision(rev)
  const items = entries.map(summary), values: Record<string, CatalogOrganization> = {}, logical = new Map<string, string>(), keys = new Set<string>()
  if (items.length > LIBRARY_LIMITS.entries || orgs.length > LIBRARY_LIMITS.organizationRecords) throw new Error('个人库条目或整理记录超过保护值。')
  for (const entry of items) {
    const identity = entry.item.identity
    if (keys.has(identity.key) || logical.has(identity.logicalKey)) throw new Error('个人库包含重复或冲突的固定身份。')
    keys.add(identity.key); logical.set(identity.logicalKey, identity.key)
  }
  for (const row of orgs) {
    exact(row, ['key', 'value'])
    const key = validateCatalogKey(row.key), existing = logical.get(logicalOf(key))
    if (Object.hasOwn(values, key) || existing && existing !== key) throw new Error('个人整理与固定内容身份冲突。')
    logical.set(logicalOf(key), key); values[key] = validateCatalogOrganization(row.value)
  }
  if (items.reduce((sum, row) => sum + row.sizeBytes, 0) > LIBRARY_LIMITS.storedCapsuleBytes) throw new Error('个人库超过128MiB实际载体预算。')
  return { revision: rev, entries: items, organizations: values }
}
function captureConversion(input: LibraryConversionInput): LibraryConversionInput {
  exact(input, ['entries', 'organizations', 'sourceContentHashes', 'organizationPolicy'])
  if (!['keep-local', 'replace-selected'].includes(input.organizationPolicy)) throw new Error('须明确个人整理冲突策略。')
  return { entries: captureLibraryEntries(input.entries, LIBRARY_LIMITS.entries), organizations: organizations(input.organizations),
    sourceContentHashes: hashRecord(input.sourceContentHashes), organizationPolicy: input.organizationPolicy }
}
function keysOf(input: readonly string[]): string[] { return [...input].sort() }
function sameKeys(left: readonly string[], right: readonly string[]): boolean { return canonicalJson(keysOf(left)) === canonicalJson(keysOf(right)) }
function targetHashes(input: Pick<LibraryConversionInput, 'entries' | 'organizations'>): Record<string, string> {
  return Object.fromEntries([...input.entries.map(entry => [canonicalJson(['entry', entry.item.identity.key]), sha256Bytes(encodeUtf8(canonicalJson({ item: entry.item, capsuleSha256: entry.capsuleSha256 })))]),
    ...Object.entries(input.organizations).map(([key, value]) => [canonicalJson(['organization', key]), sha256Bytes(encodeUtf8(canonicalJson(value)))])])
}
function targetHash(input: Pick<LibraryConversionInput, 'entries' | 'organizations' | 'organizationPolicy'>): string {
  return sha256Bytes(encodeUtf8(canonicalJson({ hashes: targetHashes(input), organizationPolicy: input.organizationPolicy })))
}
function jobKey(input: Pick<ReserveLibraryConversion, 'sourceRepository' | 'scopeId' | 'sourceFingerprint'>): string {
  return sha256Bytes(encodeUtf8(canonicalJson({ sourceRepository: input.sourceRepository, scopeId: input.scopeId, sourceFingerprint: input.sourceFingerprint,
    converterVersion: CONVERTER_VERSION, targetFormat: LIBRARY_TARGET_FORMAT })))
}
function assertJob(job: LibraryConversionJob): void {
  exact(job, ['sourceRepository', 'scopeId', 'sourceFingerprint', 'entryKeys', 'organizationKeys', 'sourceContentHashes', 'jobId', 'jobKey', 'converterVersion', 'targetFormat', 'stage', 'jobVersion', 'createdAt', 'updatedAt', 'backupReceipt', 'targetRevision', 'targetHash', 'targetContentHashes', 'organizationPolicy', 'failure'])
  if (!identifier(job.jobId) || !identifier(job.sourceRepository) || !identifier(job.scopeId) || !hash(job.sourceFingerprint) || !hash(job.jobKey) || jobKey(job) !== job.jobKey
    || job.converterVersion !== CONVERTER_VERSION || job.targetFormat !== LIBRARY_TARGET_FORMAT || !integer(job.jobVersion)
    || !['captured', 'backup-verified', 'prepared', 'committed', 'verified', 'failed', 'cancelled'].includes(job.stage)
    || job.targetRevision !== null && !integer(job.targetRevision) || job.targetHash !== null && !hash(job.targetHash)
    || job.organizationPolicy !== null && !['keep-local', 'replace-selected'].includes(job.organizationPolicy)
    || job.failure !== null && (typeof job.failure !== 'string' || job.failure.length > 1024)) throw new Error('个人库转换journal字段损坏。')
  time(job.createdAt); time(job.updatedAt)
  for (const [keys, max] of [[job.entryKeys, LIBRARY_LIMITS.entries], [job.organizationKeys, LIBRARY_LIMITS.organizationRecords]] as const) {
    const values = array(keys, max).map(validateCatalogKey)
    if (new Set(values).size !== values.length) throw new Error('个人库转换固定key映射重复。')
  }
  hashRecord(job.sourceContentHashes); hashRecord(job.targetContentHashes)
  if (job.backupReceipt !== null) {
    exact(job.backupReceipt, ['setId', 'sourceFingerprint', 'indexHash', 'volumeHashes'])
    if (job.backupReceipt.setId !== job.jobId || job.backupReceipt.sourceFingerprint !== job.sourceFingerprint || !hash(job.backupReceipt.indexHash)) throw new Error('个人库保全receipt范围损坏。')
    const paths = new Set<string>()
    for (const value of array(job.backupReceipt.volumeHashes, 512)) {
      exact(value, ['path', 'sha256'])
      if (typeof value.path !== 'string' || !/^part-\d{4}\.sceneweave-migration-part$/.test(value.path) || paths.has(value.path) || !hash(value.sha256)) throw new Error('个人库保全receipt分卷损坏。')
      paths.add(value.path)
    }
  }
  if (['backup-verified', 'prepared', 'committed', 'verified'].includes(job.stage) && !job.backupReceipt) throw new Error('个人库转换缺少完整重读receipt。')
  if (['prepared', 'committed', 'verified'].includes(job.stage) && (job.targetRevision === null || job.targetHash === null || job.organizationPolicy === null)) throw new Error('个人库转换缺少目标基线或内容摘要。')
}

/** Native complete-v1 personal library. Private staging is never exposed to ordinary readers. */
export class LibraryRepository {
  readonly database: LibraryDatabase
  private opening: Promise<void> | null = null
  private closed = false
  constructor(private readonly options: LibraryRepositoryOptions) {
    this.database = new LibraryDatabase(options.name ?? LIBRARY_DATABASE_NAME)
    this.database.on('versionchange', () => { this.closed = true; this.database.close(); return false })
    this.database.on('blocked', () => { this.closed = true; this.database.close() })
  }
  async open(): Promise<void> {
    if (this.closed) throw new Error('个人素材库连接已关闭。')
    this.opening ??= inspectLibraryDatabase(this.database.name).then(async () => {
      if (this.closed) throw new Error('个人素材库连接已关闭。')
      await this.database.open()
      if (this.closed) { this.database.close(); throw new Error('个人素材库连接已关闭。') }
    }).catch(error => { this.opening = null; throw error })
    return this.opening
  }
  private validation(options: ResourceOptions): CompleteValidationOptions { return { ...this.options.validation, signal: options.signal ?? this.options.validation.signal } }
  private async atomic<T>(options: ResourceOptions, body: () => Promise<T>): Promise<T> {
    checkCancelled(options.signal); await this.open(); checkCancelled(options.signal)
    let active: Transaction | undefined
    const signal = options.signal as AbortSignal | undefined, abort = () => active?.abort()
    signal?.addEventListener?.('abort', abort, { once: true })
    try { return await this.database.transaction('rw', LIBRARY_TABLES, async () => {
      active = Dexie.currentTransaction!; checkCancelled(options.signal)
      const result = await body(); checkCancelled(options.signal); return result
    }) }
    catch (error) { checkCancelled(options.signal); throw error }
    finally { active = undefined; signal?.removeEventListener?.('abort', abort) }
  }
  private async readInside(): Promise<LibrarySnapshot> {
    const [metadataRows, entries, orgs] = await Promise.all([this.database.metadata.toArray(), this.database.entries.toArray(), this.database.organizations.toArray()])
    if (metadataRows.length > 1 || metadataRows.some(row => row.id !== 'catalog')) throw new Error('个人素材库元数据必须仅含catalog记录。')
    const metadata = metadataRows[0]
    if (!metadata && (entries.length || orgs.length)) throw new Error('个人素材库缺少元数据。')
    if (metadata) { exact(metadata, ['id', 'revision']); if (metadata.id !== 'catalog') throw new Error('个人库元数据身份无效。') }
    return snapshot(metadata?.revision ?? 0, entries, orgs)
  }
  async read(options: ResourceOptions = {}): Promise<LibrarySnapshot> {
    checkCancelled(options.signal); await this.open()
    const result = await this.database.transaction('r', ['entries', 'organizations', 'metadata'], () => this.readInside())
    checkCancelled(options.signal); return result
  }
  async load(key: string, options: ResourceOptions = {}): Promise<PreparedLibraryEntry> {
    validateCatalogKey(key); checkCancelled(options.signal); await this.open()
    const row = await this.database.entries.get(key)
    if (!row) throw new Error('素材未安装或已被移除。')
    summary(row)
    return validateLibraryEntry(captureEntry(row.entry), this.validation(options))
  }
  private async validatedReuse(keys: string[], options: ResourceOptions): Promise<Map<string, PreparedLibraryEntry>> {
    checkCancelled(options.signal); await this.open()
    const captured = await this.database.transaction('r', this.database.entries, async () => {
      const entries = new Map<string, PreparedLibraryEntry>()
      for (const key of keys) {
        const row = await this.database.entries.get(key)
        if (row) { summary(row); entries.set(key, captureEntry(row.entry)) }
      }
      return entries
    })
    for (const [key, entry] of captured) captured.set(key, await validateLibraryEntry(entry, this.validation(options)))
    return captured
  }
  private assertReuse(before: LibrarySnapshot, keys: string[], validated: Map<string, PreparedLibraryEntry>): void {
    for (const key of keys) {
      const previous = before.entries.find(row => row.item.identity.key === key), cold = validated.get(key)
      if (Boolean(previous) !== Boolean(cold) || previous && cold && (previous.capsuleSha256 !== cold.capsuleSha256 || canonicalJson(previous.item) !== canonicalJson(cold.item))) throw new LibraryConflictError(before.revision)
    }
  }
  private merge(before: LibrarySnapshot, entries: PreparedLibraryEntry[], orgs: Record<string, CatalogOrganization>, policy: OrganizationPolicy, remove: string[] = []): LibrarySnapshot {
    const next = new Map(before.entries.map(row => [row.item.identity.key, row])), nextOrg = { ...before.organizations }
    const logical = new Map(before.entries.map(row => [row.item.identity.logicalKey, row.item.identity.key]))
    for (const key of Object.keys(before.organizations)) logical.set(logicalOf(key), key)
    for (const entry of entries) {
      const identity = entry.item.identity, previous = next.get(identity.key), collision = logical.get(identity.logicalKey)
      if (collision && collision !== identity.key) throw new Error('相同逻辑身份的固定内容冲突，不能覆盖或静默重绑。')
      if (previous && canonicalJson(previous.item) !== canonicalJson(entry.item)) throw new Error('相同精确key的固定素材元数据冲突。')
      if (!previous) next.set(identity.key, { item: entry.item, capsuleSha256: entry.capsuleSha256, sizeBytes: entry.capsule.length })
      logical.set(identity.logicalKey, identity.key)
    }
    for (const [key, value] of Object.entries(orgs)) {
      const collision = logical.get(logicalOf(key))
      if (collision && collision !== key) throw new Error('个人整理的逻辑身份固定内容冲突。')
      logical.set(logicalOf(key), key)
      if (policy === 'replace-selected' || !Object.hasOwn(nextOrg, key)) nextOrg[key] = value
    }
    for (const key of remove) { next.delete(key); delete nextOrg[key] }
    if (next.size > LIBRARY_LIMITS.entries || Object.keys(nextOrg).length > LIBRARY_LIMITS.organizationRecords
      || [...next.values()].reduce((sum, row) => sum + row.sizeBytes, 0) > LIBRARY_LIMITS.storedCapsuleBytes) throw new Error('个人库合并超过512条目、2048整理或128MiB预算。')
    return { revision: before.revision, entries: [...next.values()], organizations: nextOrg }
  }
  private async stagedBytes(): Promise<number> {
    let bytes = 0
    for (const row of await this.database.conversionStaging.toArray()) {
      exact(row, ['jobId', 'kind', 'key', 'value'])
      if (!identifier(row.jobId) || !['entry', 'organization'].includes(row.kind)) throw new Error('个人库暂存行身份损坏。')
      if (row.kind === 'entry') { const entry = summary(row.value); if (row.key !== entry.item.identity.key) throw new Error('个人库暂存素材key不符。'); bytes += entry.sizeBytes }
      else { exact(row.value, ['key', 'value']); if (row.key !== validateCatalogKey(row.value.key)) throw new Error('个人库暂存整理key不符。'); validateCatalogOrganization(row.value.value) }
    }
    return bytes
  }
  private async budget(publicSnapshot: LibrarySnapshot, additional = 0): Promise<void> {
    if (publicSnapshot.entries.reduce((sum, row) => sum + row.sizeBytes, 0) + await this.stagedBytes() + additional > LIBRARY_LIMITS.storedCapsuleBytes) throw new Error('个人库及私有暂存合计超过128MiB实际字节预算。')
  }
  async commit(expectedRevision: number, input: LibraryMutation, options: ResourceOptions = {}): Promise<LibrarySnapshot> {
    revision(expectedRevision)
    exact(input, Object.keys(input)); if (Object.keys(input).some(key => !['put', 'organization', 'remove'].includes(key))) throw new Error('个人库变更含未知字段。')
    const entries = captureLibraryEntries((input.put ?? []) as PreparedLibraryEntry[], LIBRARY_LIMITS.batch)
    const orgs: Record<string, CatalogOrganization> = {}, removes = array(input.remove ?? [], LIBRARY_LIMITS.batch).map(validateCatalogKey)
    for (const row of array(input.organization ?? [], LIBRARY_LIMITS.batch)) {
      exact(row, ['key', 'value']); const key = validateCatalogKey(row.key)
      if (Object.hasOwn(orgs, key)) throw new Error('本批个人整理目标重复。')
      orgs[key] = validateCatalogOrganization(captureJson(row.value))
    }
    const entryKeys = entries.map(row => row.item.identity.key), all = new Set([...entryKeys, ...Object.keys(orgs), ...removes])
    if (new Set(entryKeys).size !== entries.length || new Set(removes).size !== removes.length) throw new Error('本批固定素材目标重复。')
    if (removes.some(key => entryKeys.includes(key) || Object.hasOwn(orgs, key))) throw new Error('同一素材不能同时移除和写入。')
    if (!all.size || all.size > LIBRARY_LIMITS.batch) throw new Error('普通个人库变更每批须为1–64个不同目标。')
    const checked: PreparedLibraryEntry[] = []
    for (const entry of entries) checked.push(await validateLibraryEntry(entry, this.validation(options)))
    const reused = await this.validatedReuse(entryKeys, options)
    return this.atomic(options, async () => {
      const before = await this.readInside()
      if (before.revision !== expectedRevision) throw new LibraryConflictError(before.revision)
      if (before.revision === Number.MAX_SAFE_INTEGER) throw new Error('个人库revision已达到上限。')
      this.assertReuse(before, entryKeys, reused)
      const after = this.merge(before, checked, orgs, 'replace-selected', removes)
      await this.budget(after)
      for (const entry of checked) if (!before.entries.some(row => row.item.identity.key === entry.item.identity.key)) await this.database.entries.add({ key: entry.item.identity.key, logicalKey: entry.item.identity.logicalKey, entry })
      for (const [key, value] of Object.entries(orgs)) await this.database.organizations.put({ key, value })
      for (const key of removes) { await this.database.entries.delete(key); await this.database.organizations.delete(key) }
      await this.database.metadata.put({ id: 'catalog', revision: before.revision + 1 }); checkCancelled(options.signal)
      return { ...after, revision: before.revision + 1 }
    })
  }
  async getJob(jobId: string): Promise<LibraryConversionJob | null> {
    if (!identifier(jobId)) throw new Error('个人库转换jobID无效。')
    await this.open(); const job = await this.database.conversionJobs.get(jobId)
    if (!job) return null
    assertJob(job); return job
  }
  private async jobCAS(jobId: string, version: number, stage?: ConversionStage): Promise<LibraryConversionJob> {
    const job = await this.database.conversionJobs.get(jobId)
    if (!job) throw new LibraryConversionConflictError()
    assertJob(job)
    if (!integer(version) || job.jobVersion !== version || stage && job.stage !== stage) throw new LibraryConversionConflictError()
    return job
  }
  private nextJob(job: LibraryConversionJob, stage: ConversionStage, patch: Partial<LibraryConversionJob> = {}): LibraryConversionJob {
    if (job.jobVersion === Number.MAX_SAFE_INTEGER) throw new Error('个人库转换jobVersion达到上限。')
    const next = { ...job, ...patch, stage, jobVersion: job.jobVersion + 1, updatedAt: this.options.runtime.clock.now() }
    assertJob(next); return next
  }
  async reserveConversion(input: ReserveLibraryConversion, options: ResourceOptions = {}): Promise<LibraryConversionJob> {
    const owned = captureJson(input) as ReserveLibraryConversion
    exact(owned, ['sourceRepository', 'scopeId', 'sourceFingerprint', 'entryKeys', 'organizationKeys', 'sourceContentHashes'])
    const now = this.options.runtime.clock.now(), jobId = this.options.runtime.ids.nextId()
    const job: LibraryConversionJob = { ...owned, jobId, jobKey: jobKey(owned), converterVersion: CONVERTER_VERSION, targetFormat: LIBRARY_TARGET_FORMAT,
      stage: 'captured', jobVersion: 0, createdAt: now, updatedAt: now, backupReceipt: null, targetRevision: null, targetHash: null, targetContentHashes: {}, organizationPolicy: null, failure: null }
    assertJob(job)
    return this.atomic(options, async () => {
      const existing = await this.database.conversionJobs.where('jobKey').equals(job.jobKey).first()
      if (existing) {
        assertJob(existing)
        if (!sameKeys(existing.entryKeys, job.entryKeys) || !sameKeys(existing.organizationKeys, job.organizationKeys) || canonicalJson(existing.sourceContentHashes) !== canonicalJson(job.sourceContentHashes)) throw new Error('相同源指纹的固定范围或内容摘要不符。')
        return existing
      }
      await this.database.conversionJobs.add(job); return job
    })
  }
  async advanceConversion(jobId: string, expectedVersion: number, stage: 'backup-verified' | 'failed' | 'cancelled', patch: { backupReceipt?: unknown; failure?: string } = {}, options: ResourceOptions = {}): Promise<LibraryConversionJob> {
    exact(patch, Object.keys(patch)); if (Object.keys(patch).some(key => !['backupReceipt', 'failure'].includes(key)) || !['backup-verified', 'failed', 'cancelled'].includes(stage)) throw new Error('个人库转换阶段补丁无效。')
    const receiptInput = patch.backupReceipt, failureInput = patch.failure
    if (failureInput !== undefined && (typeof failureInput !== 'string' || failureInput.length > 1024)) throw new Error('个人库转换失败原因超出范围。')
    return this.atomic(options, async () => {
      const job = await this.jobCAS(jobId, expectedVersion)
      if (job.stage === 'verified' || stage === 'backup-verified' && job.stage !== 'captured' || stage !== 'backup-verified' && ['failed', 'cancelled'].includes(job.stage)) throw new LibraryConversionConflictError()
      const receipt = stage === 'backup-verified' ? cloneJson(assertBackupReceipt(receiptInput, { setId: job.jobId, sourceFingerprint: job.sourceFingerprint })) : job.backupReceipt
      const next = this.nextJob(job, stage, { backupReceipt: receipt, failure: stage === 'backup-verified' ? null : failureInput ?? (stage === 'cancelled' ? '用户取消转换。' : null) })
      await this.database.conversionJobs.put(next); return next
    })
  }
  private async checked(input: LibraryConversionInput, job: LibraryConversionJob, options: ResourceOptions): Promise<LibraryConversionInput> {
    const owned = captureConversion(input)
    if (!sameKeys(owned.entries.map(row => row.item.identity.key), job.entryKeys) || new Set(owned.entries.map(row => row.item.identity.key)).size !== owned.entries.length
      || !sameKeys(Object.keys(owned.organizations), job.organizationKeys) || canonicalJson(owned.sourceContentHashes) !== canonicalJson(job.sourceContentHashes)) throw new Error('转换必须完整包含预留范围内全部素材、整理及源摘要。')
    const validated: PreparedLibraryEntry[] = []
    for (const entry of owned.entries) validated.push(await validateLibraryEntry(entry, this.validation(options)))
    // Build an isolated snapshot to reject internal logical collisions before touching any database.
    snapshot(0, validated.map(entry => ({ key: entry.item.identity.key, logicalKey: entry.item.identity.logicalKey, entry })), Object.entries(owned.organizations).map(([key, value]) => ({ key, value })))
    return { ...owned, entries: validated }
  }
  async prepareConversion(jobId: string, expectedVersion: number, input: LibraryConversionInput, options: ResourceOptions = {}): Promise<LibraryConversionJob> {
    const captured = captureConversion(input), job = await this.getJob(jobId)
    if (!job || job.stage !== 'backup-verified' || job.jobVersion !== expectedVersion) throw new LibraryConversionConflictError()
    if (job.organizationPolicy !== null && job.organizationPolicy !== captured.organizationPolicy) throw new Error('转换个人整理策略已冻结，重试不能更改。')
    const checked = await this.checked(captured, job, options)
    return this.atomic(options, async () => {
      const current = await this.jobCAS(jobId, expectedVersion, 'backup-verified'), before = await this.readInside()
      this.merge(before, checked.entries, checked.organizations, checked.organizationPolicy)
      await this.budget(before, checked.entries.reduce((sum, row) => sum + row.capsule.length, 0))
      if ((await this.database.conversionStaging.toArray()).some(row => row.jobId === jobId)) throw new LibraryConversionConflictError()
      const next = this.nextJob(current, 'prepared', { targetRevision: before.revision, targetHash: targetHash(checked), targetContentHashes: targetHashes(checked), organizationPolicy: checked.organizationPolicy, failure: null })
      await this.database.conversionJobs.put(next); return next
    })
  }
  async commitConversion(jobId: string, expectedVersion: number, input: LibraryConversionInput, options: ResourceOptions = {}): Promise<LibraryConversionJob> {
    const captured = captureConversion(input), job = await this.getJob(jobId)
    if (!job || job.stage !== 'prepared' || job.jobVersion !== expectedVersion) throw new LibraryConversionConflictError()
    const checked = await this.checked(captured, job, options)
    if (targetHash(checked) !== job.targetHash || canonicalJson(targetHashes(checked)) !== canonicalJson(job.targetContentHashes)) throw new Error('转换候选与prepared记录不一致。')
    return this.atomic(options, async () => {
      const current = await this.jobCAS(jobId, expectedVersion, 'prepared'), before = await this.readInside()
      if (before.revision !== current.targetRevision) throw new LibraryConflictError(before.revision)
      this.merge(before, checked.entries, checked.organizations, checked.organizationPolicy)
      if ((await this.database.conversionStaging.toArray()).some(row => row.jobId === jobId)) throw new LibraryConversionConflictError()
      await this.budget(before, checked.entries.reduce((sum, row) => sum + row.capsule.length, 0))
      for (const entry of checked.entries) await this.database.conversionStaging.add({ jobId, kind: 'entry', key: entry.item.identity.key, value: { key: entry.item.identity.key, logicalKey: entry.item.identity.logicalKey, entry } })
      for (const [key, value] of Object.entries(checked.organizations)) await this.database.conversionStaging.add({ jobId, kind: 'organization', key, value: { key, value } })
      const next = this.nextJob(current, 'committed'); await this.database.conversionJobs.put(next); checkCancelled(options.signal); return next
    })
  }
  private stagedInput(rows: StagedRecord[], job: LibraryConversionJob): LibraryConversionInput {
    const entries: PreparedLibraryEntry[] = [], orgs: Record<string, CatalogOrganization> = {}
    for (const row of rows) {
      exact(row, ['jobId', 'kind', 'key', 'value'])
      if (row.jobId !== job.jobId || !['entry', 'organization'].includes(row.kind)) throw new Error('转换私有暂存归属无效。')
      if (row.kind === 'entry') { const value = summary(row.value); if (row.key !== value.item.identity.key) throw new Error('暂存素材key不符。'); entries.push(captureEntry(row.value.entry)) }
      else { exact(row.value, ['key', 'value']); if (row.key !== validateCatalogKey(row.value.key) || Object.hasOwn(orgs, row.key)) throw new Error('暂存个人整理key不符或重复。'); orgs[row.key] = validateCatalogOrganization(row.value.value) }
    }
    const input = { entries, organizations: orgs, sourceContentHashes: cloneJson(job.sourceContentHashes), organizationPolicy: job.organizationPolicy! }
    if (!sameKeys(entries.map(entry => entry.item.identity.key), job.entryKeys) || !sameKeys(Object.keys(orgs), job.organizationKeys)
      || targetHash(input) !== job.targetHash || canonicalJson(targetHashes(input)) !== canonicalJson(job.targetContentHashes)) throw new Error('私有暂存未完整覆盖固定范围或内容hash不符。')
    return input
  }
  async readConversion(jobId: string, options: ResourceOptions = {}): Promise<LibraryConversionRead> {
    checkCancelled(options.signal); await this.open()
    const captured = await this.database.transaction('r', LIBRARY_TABLES, async () => {
      const job = await this.database.conversionJobs.get(jobId)
      if (!job) throw new LibraryConversionConflictError()
      assertJob(job)
      if (!['committed', 'failed', 'cancelled'].includes(job.stage)) throw new LibraryConversionConflictError()
      const input = this.stagedInput((await this.database.conversionStaging.toArray()).filter(row => row.jobId === jobId), job)
      return { job, input }
    })
    const verified = await this.checked(captured.input, captured.job, options)
    return { job: captured.job, entries: verified.entries, organizations: verified.organizations }
  }
  async publishConversion(jobId: string, expectedVersion: number, options: ResourceOptions = {}): Promise<LibrarySnapshot> {
    const initial = await this.getJob(jobId)
    if (!initial) throw new LibraryConversionConflictError()
    if (initial.stage === 'verified') return this.read(options)
    if (initial.stage !== 'committed' || initial.jobVersion !== expectedVersion) throw new LibraryConversionConflictError()
    const cold = await this.readConversion(jobId, options)
    const reused = await this.validatedReuse(cold.entries.map(entry => entry.item.identity.key), options)
    return this.atomic(options, async () => {
      const job = await this.jobCAS(jobId, expectedVersion, 'committed'), before = await this.readInside()
      if (before.revision !== job.targetRevision) throw new LibraryConflictError(before.revision)
      if (before.revision === Number.MAX_SAFE_INTEGER) throw new Error('个人库revision达到上限。')
      this.assertReuse(before, cold.entries.map(entry => entry.item.identity.key), reused)
      // Recheck actual staged bytes and exact sets inside the publication transaction.
      this.stagedInput((await this.database.conversionStaging.toArray()).filter(row => row.jobId === jobId), job)
      const after = this.merge(before, cold.entries, cold.organizations, job.organizationPolicy!)
      await this.budget(before)
      for (const entry of cold.entries) if (!before.entries.some(row => row.item.identity.key === entry.item.identity.key)) await this.database.entries.add({ key: entry.item.identity.key, logicalKey: entry.item.identity.logicalKey, entry })
      for (const [key, value] of Object.entries(cold.organizations)) if (job.organizationPolicy === 'replace-selected' || !Object.hasOwn(before.organizations, key)) await this.database.organizations.put({ key, value })
      for (const row of (await this.database.conversionStaging.toArray()).filter(row => row.jobId === jobId)) await this.database.conversionStaging.delete([row.jobId, row.kind, row.key])
      await this.database.metadata.put({ id: 'catalog', revision: before.revision + 1 })
      await this.database.conversionJobs.put(this.nextJob(job, 'verified')); checkCancelled(options.signal)
      return { ...after, revision: before.revision + 1 }
    })
  }
  async retryConversion(jobId: string, expectedVersion: number, options: ResourceOptions = {}): Promise<LibraryConversionJob> {
    const initial = await this.getJob(jobId)
    if (!initial || initial.jobVersion !== expectedVersion) throw new LibraryConversionConflictError()
    if (initial.stage === 'verified') { await this.read(options); return initial }
    if (!['failed', 'cancelled'].includes(initial.stage)) throw new LibraryConversionConflictError()
    const staged = (await this.database.conversionStaging.toArray()).some(row => row.jobId === jobId)
    if (staged) await this.readConversion(jobId, options)
    return this.atomic(options, async () => {
      const current = await this.jobCAS(jobId, expectedVersion), before = await this.readInside()
      if (!['failed', 'cancelled'].includes(current.stage)) throw new LibraryConversionConflictError()
      const rows = (await this.database.conversionStaging.toArray()).filter(row => row.jobId === jobId)
      if (rows.length) {
        this.stagedInput(rows, current)
        if (before.revision === current.targetRevision) {
          const next = this.nextJob(current, 'committed', { failure: null }); await this.database.conversionJobs.put(next); return next
        }
        for (const row of rows) await this.database.conversionStaging.delete([row.jobId, row.kind, row.key])
      }
      const next = this.nextJob(current, 'captured', { failure: null, backupReceipt: null, targetHash: null, targetContentHashes: {}, targetRevision: null })
      await this.database.conversionJobs.put(next); return next
    })
  }
  close(): void { this.closed = true; this.database.close(); this.opening = null }
}
