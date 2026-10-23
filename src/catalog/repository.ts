import Dexie, { type Table, type Transaction } from 'dexie'
import { captureOwnedData } from '../io/v3/owned-data'
import { canonicalJsonV6 } from '../core/v6/graph'
import { checkCancelled, hasExactKeys, isSha256 } from '../io/v6/limits'
import { readCatalogEntry } from './content'
import { validateCatalogItemV1, validateCatalogKey } from './metadata'
import { validateCatalogOrganization } from './organization'
import { CATALOG_LIMITS_V1, type CatalogEntrySummaryV1, type CatalogMutationV1, type CatalogOrganizationV1, type CatalogSnapshotV1, type PreparedCatalogEntryV1 } from './types'

interface StoredEntry { key: string; logicalKey: string; entry: PreparedCatalogEntryV1 }
interface StoredOrganization { key: string; value: CatalogOrganizationV1 }
interface StoredMetadata { id: 'catalog'; revision: number }

export class CatalogConflictError extends Error {
  constructor(readonly actualRevision: number) {
    super('素材库已在其他标签更新；请刷新后检查并明确重应用当前草稿。')
    this.name = 'CatalogConflictError'
  }
}

function validateRevision(value: unknown): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error('素材库revision无效。')
}

function entrySummary(record: StoredEntry): CatalogEntrySummaryV1 {
  const item = validateCatalogItemV1(record.entry.item)
  if (!hasExactKeys(record, ['key', 'logicalKey', 'entry']) || !hasExactKeys(record.entry, ['item', 'capsule', 'capsuleSha256'])
    || record.key !== item.identity.key || record.logicalKey !== item.identity.logicalKey || !isSha256(record.entry.capsuleSha256)
    || !(record.entry.capsule instanceof Blob) || record.entry.capsule.size > CATALOG_LIMITS_V1.capsuleBytes) throw new Error('本机素材库记录损坏；已有内容保留。')
  return { item, capsuleSha256: record.entry.capsuleSha256, sizeBytes: record.entry.capsule.size }
}

function snapshot(revision: number, records: StoredEntry[], organization: StoredOrganization[]): CatalogSnapshotV1 {
  validateRevision(revision)
  if (records.length > CATALOG_LIMITS_V1.entries || organization.length > CATALOG_LIMITS_V1.organizationRecords) throw new Error('本机素材库超过条目限额。')
  const entries = records.map(entrySummary), organizations: Record<string, CatalogOrganizationV1> = Object.create(null)
  let bytes = 0
  const keys = new Set<string>(), logicalKeys = new Map<string, string>()
  for (const entry of entries) {
    if (keys.has(entry.item.identity.key) || logicalKeys.has(entry.item.identity.logicalKey)) throw new Error('本机素材库包含重复固定身份。')
    keys.add(entry.item.identity.key); logicalKeys.set(entry.item.identity.logicalKey, entry.item.identity.key); bytes += entry.sizeBytes
  }
  if (bytes > CATALOG_LIMITS_V1.storedCapsuleBytes) throw new Error('本机素材库超过128MiB载体预算。')
  for (const record of organization) {
    if (!hasExactKeys(record, ['key', 'value'])) throw new Error('个人整理记录字段无效。')
    const key = validateCatalogKey(record.key)
    if (Object.hasOwn(organizations, key)) throw new Error('个人整理记录重复。')
    const logicalKey = JSON.stringify(JSON.parse(key).slice(0, 5)), existing = logicalKeys.get(logicalKey)
    if (existing && existing !== key) throw new Error('个人整理与目录包含相同逻辑身份的不同固定内容。')
    logicalKeys.set(logicalKey, key)
    organizations[key] = validateCatalogOrganization(record.value)
  }
  return { revision, entries, organizations }
}

/** Reject future or foreign stores without allowing Dexie to upgrade them. */
async function inspectDatabase(name: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(name)
    let created = false
    request.onupgradeneeded = () => { created = true; request.transaction!.abort() }
    request.onerror = () => created && request.error?.name === 'AbortError' ? resolve() : reject(request.error ?? new Error('无法检查素材库。'))
    request.onblocked = () => reject(new Error('素材库被其他标签阻塞，请关闭旧连接后重试。'))
    request.onsuccess = () => {
      const db = request.result
      try {
        if (db.version !== 10 || JSON.stringify(Array.from(db.objectStoreNames).sort()) !== JSON.stringify(['entries', 'metadata', 'organizations'])) throw new Error('不支持的素材库数据库版本或表结构；原数据保留。')
        const tx = db.transaction(['entries', 'metadata', 'organizations'], 'readonly')
        for (const table of ['entries', 'metadata', 'organizations']) {
          const store = tx.objectStore(table), key = table === 'metadata' ? 'id' : 'key'
          if (store.keyPath !== key || store.autoIncrement || JSON.stringify(Array.from(store.indexNames).sort()) !== JSON.stringify(table === 'entries' ? ['logicalKey'] : [])) throw new Error('不支持的素材库表/索引结构。')
          if (table === 'entries') {
            const index = store.index('logicalKey')
            if (index.keyPath !== 'logicalKey' || !index.unique || index.multiEntry) throw new Error('不支持的素材库固定身份索引。')
          }
        }
        resolve()
      } catch (error) { reject(error) }
      finally { db.close() }
    }
  })
}

/** Standalone personal catalog; no project DB, scene revision or history is touched. */
export class CatalogRepositoryV1 {
  private readonly db: Dexie
  private readonly entries: Table<StoredEntry, string>
  private readonly organizations: Table<StoredOrganization, string>
  private readonly metadata: Table<StoredMetadata, string>
  private opening: Promise<void> | null = null
  private closed = false

  constructor(private readonly dbName = 'sceneweave-catalog-v1') {
    if (['sceneweave-m0', 'sceneweave-m1', 'sceneweave-m1-layers', 'sceneweave-m1-history', 'sceneweave-m1-composition', 'sceneweave-m1-outdoor'].includes(dbName)) throw new Error('个人素材库不能使用工程数据库名称。')
    this.db = new Dexie(dbName, { autoOpen: false })
    this.db.version(1).stores({ entries: 'key,&logicalKey', organizations: 'key', metadata: 'id' })
    this.entries = this.db.table('entries'); this.organizations = this.db.table('organizations'); this.metadata = this.db.table('metadata')
  }

  private async open(): Promise<void> {
    if (this.closed) throw new Error('素材库连接已关闭。')
    this.opening ??= inspectDatabase(this.dbName).then(() => {
      if (this.closed) throw new Error('素材库连接已关闭。')
      return this.db.open()
    }).then(() => {
      if (this.closed) { this.db.close(); throw new Error('素材库连接已关闭。') }
    }).catch(error => { this.opening = null; throw error })
    await this.opening
  }

  private async readInside(): Promise<CatalogSnapshotV1> {
    const [metadata, entries, organizations] = await Promise.all([this.metadata.get('catalog'), this.entries.toArray(), this.organizations.toArray()])
    if ((!metadata && (entries.length || organizations.length)) || metadata && !hasExactKeys(metadata, ['id', 'revision'])) throw new Error('素材库元数据字段无效。')
    return snapshot(metadata?.revision ?? 0, entries, organizations)
  }

  async read(): Promise<CatalogSnapshotV1> {
    await this.open()
    return this.db.transaction('r', [this.metadata, this.entries, this.organizations], () => this.readInside())
  }

  async load(key: string, signal?: AbortSignal): Promise<PreparedCatalogEntryV1> {
    validateCatalogKey(key); checkCancelled(signal)
    await this.open(); checkCancelled(signal)
    const record = await this.entries.get(key)
    if (!record) throw new Error('素材条目未安装或已经移除。')
    entrySummary(record)
    const entry = captureOwnedData(record.entry)
    await readCatalogEntry(entry, signal); checkCancelled(signal)
    return entry
  }

  async commit(expectedRevision: number, input: CatalogMutationV1, signal?: AbortSignal): Promise<CatalogSnapshotV1> {
    validateRevision(expectedRevision)
    const mutation = captureOwnedData(input)
    if (!hasExactKeys(mutation, [], ['put', 'organization', 'remove'])) throw new Error('素材库批量变更字段无效。')
    const rawPuts = mutation.put ?? [], organizations = mutation.organization ?? [], removes = mutation.remove ?? []
    if (!Array.isArray(rawPuts) || !Array.isArray(organizations) || !Array.isArray(removes)) throw new Error('素材库批量变更必须为列表。')
    const puts = rawPuts as PreparedCatalogEntryV1[]
    const targets = new Set<string>(), putKeys = new Set<string>(), orgKeys = new Set<string>(), removeKeys = new Set<string>(), logicalKeys = new Map<string, string>()
    for (const entry of puts) {
      if (!hasExactKeys(entry, ['item', 'capsule', 'capsuleSha256'])) throw new Error('素材完整载体字段无效。')
      const item = validateCatalogItemV1(entry.item), key = item.identity.key
      if (!(entry.capsule instanceof Blob) || entry.capsule.size > CATALOG_LIMITS_V1.capsuleBytes || !isSha256(entry.capsuleSha256)) throw new Error('素材载体超限或摘要无效。')
      if (putKeys.has(key) || logicalKeys.has(item.identity.logicalKey) && logicalKeys.get(item.identity.logicalKey) !== key) throw new Error('本批包含重复或冲突的固定素材身份。')
      putKeys.add(key); targets.add(key); logicalKeys.set(item.identity.logicalKey, key)
    }
    const detachedOrganizations = organizations.map(record => {
      if (!hasExactKeys(record, ['key', 'value'])) throw new Error('个人整理变更字段无效。')
      const key = validateCatalogKey(record.key)
      if (orgKeys.has(key)) throw new Error('本批个人整理目标重复。')
      const logicalKey = JSON.stringify(JSON.parse(key).slice(0, 5)), existing = logicalKeys.get(logicalKey)
      if (existing && existing !== key) throw new Error('本批个人整理与素材的逻辑身份固定内容冲突。')
      logicalKeys.set(logicalKey, key); orgKeys.add(key); targets.add(key)
      return { key, value: validateCatalogOrganization(record.value) }
    })
    for (const inputKey of removes) {
      const key = validateCatalogKey(inputKey)
      if (removeKeys.has(key) || putKeys.has(key) || orgKeys.has(key)) throw new Error('同一素材不能同时移除和写入，移除目标也不能重复。')
      removeKeys.add(key); targets.add(key)
    }
    if (!targets.size || targets.size > CATALOG_LIMITS_V1.batch) throw new Error('每批需要1–64个不同素材目标。')
    checkCancelled(signal)
    for (const entry of puts) { await readCatalogEntry(entry, signal); checkCancelled(signal) }
    await this.open(); checkCancelled(signal)
    let active: Transaction | undefined
    const abort = () => active?.abort()
    signal?.addEventListener('abort', abort, { once: true })
    try {
      return await this.db.transaction('rw', [this.metadata, this.entries, this.organizations], async () => {
        active = Dexie.currentTransaction!; checkCancelled(signal)
        const before = await this.readInside()
        if (before.revision !== expectedRevision) throw new CatalogConflictError(before.revision)
        if (before.revision >= Number.MAX_SAFE_INTEGER) throw new Error('素材库revision已达到上限。')
        const nextEntries = new Map(before.entries.map(entry => [entry.item.identity.key, entry])), nextOrganizations = { ...before.organizations }
        const storedLogical = new Map(before.entries.map(entry => [entry.item.identity.logicalKey, entry.item.identity.key]))
        for (const key of Object.keys(before.organizations)) storedLogical.set(JSON.stringify(JSON.parse(key).slice(0, 5)), key)
        for (const entry of puts) {
          const identity = entry.item.identity, collision = storedLogical.get(identity.logicalKey), existing = nextEntries.get(identity.key)
          if (collision && collision !== identity.key) throw new Error('相同逻辑素材身份的固定内容冲突；不能覆盖或重命名。')
          if (existing && canonicalJsonV6(existing.item) !== canonicalJsonV6(entry.item)) throw new Error('相同精确身份的素材元数据冲突。')
          if (!existing) nextEntries.set(identity.key, { item: entry.item, capsuleSha256: entry.capsuleSha256, sizeBytes: entry.capsule.size })
          storedLogical.set(identity.logicalKey, identity.key)
        }
        for (const record of detachedOrganizations) {
          const logicalKey = JSON.stringify(JSON.parse(record.key).slice(0, 5)), collision = storedLogical.get(logicalKey)
          if (collision && collision !== record.key) throw new Error('相同逻辑素材身份的个人整理固定内容冲突；不能静默改绑。')
          storedLogical.set(logicalKey, record.key); nextOrganizations[record.key] = record.value
        }
        for (const key of removes) { nextEntries.delete(key); delete nextOrganizations[key] }
        if (nextEntries.size > CATALOG_LIMITS_V1.entries || Object.keys(nextOrganizations).length > CATALOG_LIMITS_V1.organizationRecords
          || [...nextEntries.values()].reduce((total, entry) => total + entry.sizeBytes, 0) > CATALOG_LIMITS_V1.storedCapsuleBytes) throw new Error('本批超过素材库条目、个人整理或128MiB容量限额。')
        checkCancelled(signal)
        // Repeated identical content keeps its original bytes; all supplied bytes were validated above.
        for (const entry of puts) if (!before.entries.some(existing => existing.item.identity.key === entry.item.identity.key)) await this.entries.put({ key: entry.item.identity.key, logicalKey: entry.item.identity.logicalKey, entry })
        for (const record of detachedOrganizations) await this.organizations.put(record)
        for (const key of removes) { await this.entries.delete(key); await this.organizations.delete(key) }
        await this.metadata.put({ id: 'catalog', revision: before.revision + 1 })
        checkCancelled(signal)
        return { revision: before.revision + 1, entries: [...nextEntries.values()], organizations: nextOrganizations }
      })
    } catch (error) {
      checkCancelled(signal)
      throw error
    } finally { active = undefined; signal?.removeEventListener('abort', abort) }
  }

  close(): void { this.closed = true; this.db.close(); this.opening = null }
}
