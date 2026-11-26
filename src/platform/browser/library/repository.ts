import Dexie, { type Transaction } from 'dexie'
import type { CatalogOrganization, LibraryEntrySummary, LibraryMutation, LibrarySnapshot, PreparedLibraryEntry } from '../../../shared/library/types.js'
import { LIBRARY_LIMITS } from '../../../shared/library/types.js'
import { validateCatalogItem, validateCatalogKey } from '../../../shared/library/metadata.js'
import { validateCatalogOrganization } from '../../../shared/library/organization.js'
import { captureLibraryEntries, validateLibraryEntry } from '../../../shared/library/content.js'
import { checkCancelled, type CompleteValidationOptions, type ResourceOptions } from '../../../shared/ports/resources.js'
import { captureBytes, sha256Bytes } from '../../../shared/project/binary.js'
import { canonicalJson, captureJson } from '../../../shared/validation/json.js'
import { inspectLibraryDatabase, LibraryDatabase, LIBRARY_DATABASE_NAME, LIBRARY_TABLES, type StoredEntry, type StoredOrganization } from './database.js'

export interface LibraryRepositoryOptions { name?: string; validation: CompleteValidationOptions }
export class LibraryConflictError extends Error {
  constructor(readonly actualRevision: number) { super('个人素材库已在其他标签更新，请刷新后明确重应用。'); this.name = 'LibraryConflictError' }
}
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
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
function captureEntry(input: unknown): PreparedLibraryEntry {
  exact(input, ['item', 'capsule', 'capsuleSha256'])
  const item = validateCatalogItem(captureJson(input.item)), capsule = captureBytes(input.capsule as Uint8Array, LIBRARY_LIMITS.capsuleBytes)
  if (!capsule.length || !hash(input.capsuleSha256) || sha256Bytes(capsule) !== input.capsuleSha256) throw new Error('素材载体实际字节或hash不符。')
  return { item, capsule, capsuleSha256: input.capsuleSha256 }
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
/** Complete-v1 personal library. */
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
  private merge(before: LibrarySnapshot, entries: PreparedLibraryEntry[], orgs: Record<string, CatalogOrganization>, remove: string[]): LibrarySnapshot {
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
      nextOrg[key] = value
    }
    for (const key of remove) { next.delete(key); delete nextOrg[key] }
    if (next.size > LIBRARY_LIMITS.entries || Object.keys(nextOrg).length > LIBRARY_LIMITS.organizationRecords
      || [...next.values()].reduce((sum, row) => sum + row.sizeBytes, 0) > LIBRARY_LIMITS.storedCapsuleBytes) throw new Error('个人库合并超过512条目、2048整理或128MiB预算。')
    return { revision: before.revision, entries: [...next.values()], organizations: nextOrg }
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
      const after = this.merge(before, checked, orgs, removes)
      for (const entry of checked) if (!before.entries.some(row => row.item.identity.key === entry.item.identity.key)) await this.database.entries.add({ key: entry.item.identity.key, logicalKey: entry.item.identity.logicalKey, entry })
      for (const [key, value] of Object.entries(orgs)) await this.database.organizations.put({ key, value })
      for (const key of removes) { await this.database.entries.delete(key); await this.database.organizations.delete(key) }
      await this.database.metadata.put({ id: 'catalog', revision: before.revision + 1 }); checkCancelled(options.signal)
      return { ...after, revision: before.revision + 1 }
    })
  }
  close(): void { this.closed = true; this.database.close(); this.opening = null }
}
