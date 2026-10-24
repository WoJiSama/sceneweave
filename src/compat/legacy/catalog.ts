import { readCatalogEntry } from '../../catalog/content'
import { readCatalogBackup } from '../../catalog/backup'
import type { PreparedCatalogEntryV1 } from '../../catalog/types'
import type { MigrationScope, PreservationRecordInput, PreservationRole } from '../../shared/migration/types.js'
import type { ProjectBundle, ProjectData } from '../../shared/model/project.js'
import type { CompleteValidationOptions, CancellationSignal } from '../../shared/ports/resources.js'
import { checkCancelled } from '../../shared/ports/resources.js'
import { captureBytes, sha256Bytes } from '../../shared/project/binary.js'
import { createMemoryResources } from '../../shared/project/resources.js'
import { canonicalJson, captureJson, freezeJson } from '../../shared/validation/json.js'
import { sha256Text } from '../../shared/validation/hash.js'
import { prepareLibraryEntry } from '../../shared/library/content.js'
import { validateCatalogItem, validateCatalogKey } from '../../shared/library/metadata.js'
import { validateCatalogOrganization } from '../../shared/library/organization.js'
import { LIBRARY_LIMITS, type PreparedLibraryEntry, type CatalogOrganization } from '../../shared/library/types.js'
import { decodeLegacyRow, encodeLegacyRow } from './row-codec.js'
import type { CaptureOptions } from './capture.js'

export const LEGACY_CATALOG_DATABASE = 'sceneweave-catalog-v1'
export interface LegacyCatalogCapture {
  scope: MigrationScope
  sourceFingerprint: string
  records: PreservationRecordInput[]
  entryKeys: string[]
  organizationKeys: string[]
  sourceContentHashes: Record<string, string>
}
export interface ConvertedCatalog {
  entries: PreparedLibraryEntry[]
  organizations: Record<string, CatalogOrganization>
  sourceContentHashes: Record<string, string>
}
interface Row { store: 'entries' | 'organizations' | 'metadata'; key: IDBValidKey; value: unknown }
interface OwnedCapture { scope: MigrationScope; fingerprint: string; records: PreservationRecordInput[] }
const captures = new WeakMap<LegacyCatalogCapture, OwnedCapture>()
const roles: Record<Row['store'], PreservationRole> = { entries: 'catalog-entry', organizations: 'catalog-organization', metadata: 'catalog-metadata' }
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value))
function exact(value: unknown, fields: string[]): asserts value is Record<string, unknown> {
  if (!object(value) || Reflect.ownKeys(value).length !== fields.length || !fields.every(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    return descriptor?.enumerable && 'value' in descriptor
  })) throw new Error('旧个人库记录含未知、隐藏、访问器或缺失字段；已保全但不能转换。')
}
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0
function fingerprint(scope: MigrationScope, records: readonly PreservationRecordInput[]): string {
  return sha256Text(canonicalJson({ scope, records: records.map(record => ({ role: record.role, recordKey: record.recordKey, sourceFormat: record.sourceFormat,
    contentHash: record.contentHash, rawSha256: sha256Bytes(record.bytes) })).sort((a, b) => compare(a.recordKey, b.recordKey)) }))
}
function seal(scope: MigrationScope, records: PreservationRecordInput[], rows: Row[]): LegacyCatalogCapture {
  const sourceFingerprint = fingerprint(scope, records), sourceContentHashes = Object.fromEntries(records.map(record => [record.recordKey, record.contentHash]))
  const key = (row: Row) => typeof row.key === 'string' ? row.key : canonicalJson(row.key)
  const capture: LegacyCatalogCapture = { scope: freezeJson(captureJson(scope)), sourceFingerprint, records,
    entryKeys: freezeJson(rows.filter(row => row.store === 'entries').map(key).sort(compare)),
    organizationKeys: freezeJson(rows.filter(row => row.store === 'organizations').map(key).sort(compare)), sourceContentHashes: freezeJson(sourceContentHashes) }
  captures.set(capture, { scope: captureJson(scope), fingerprint: sourceFingerprint, records: records.map(record => ({ ...record, bytes: record.bytes.slice() })) })
  records.forEach(Object.freeze); Object.freeze(records); return Object.freeze(capture)
}
function owned(capture: LegacyCatalogCapture): OwnedCapture {
  const result = captures.get(capture)
  if (!result || canonicalJson(result.scope) !== canonicalJson(capture.scope) || result.fingerprint !== capture.sourceFingerprint
    || fingerprint(capture.scope, capture.records) !== result.fingerprint) throw new Error('必须使用本次完整捕获或保全集合重读结果，记录不能修改。')
  return result
}
function inspect(db: IDBDatabase, tx: IDBTransaction): void {
  if (db.version !== 10 || canonicalJson(Array.from(db.objectStoreNames).sort()) !== canonicalJson(['entries', 'metadata', 'organizations'])) throw new Error('旧个人库版本或表集合未知；不升级原库。')
  for (const name of ['entries', 'organizations', 'metadata']) {
    const store = tx.objectStore(name), indexes = name === 'entries' ? ['logicalKey'] : []
    if (store.autoIncrement || store.keyPath !== (name === 'metadata' ? 'id' : 'key') || canonicalJson(Array.from(store.indexNames).sort()) !== canonicalJson(indexes)) throw new Error('旧个人库主键或索引未知。')
    if (name === 'entries') { const index = store.index('logicalKey'); if (index.keyPath !== 'logicalKey' || !index.unique || index.multiEntry) throw new Error('旧个人库逻辑身份索引未知。') }
  }
}
async function openExisting(options: CaptureOptions): Promise<IDBDatabase> {
  checkCancelled(options.signal)
  const factory = options.factory ?? globalThis.indexedDB
  if (!factory) throw new Error('当前运行时不能读取浏览器IndexedDB。')
  return new Promise((resolve, reject) => {
    let missing = false, settled = false
    const request = factory.open(LEGACY_CATALOG_DATABASE)
    request.onupgradeneeded = () => { missing = true; request.transaction!.abort() }
    request.onerror = () => { if (!settled) { settled = true; reject(missing ? new Error('旧个人库不存在，没有创建替代空库。') : request.error) } }
    request.onblocked = () => { settled = true; reject(new Error('旧个人库被其他连接阻塞。')) }
    request.onsuccess = () => { if (settled) { request.result.close(); return }; settled = true
      try { checkCancelled(options.signal); resolve(request.result) } catch (error) { request.result.close(); reject(error) } }
  })
}

/** One readonly native transaction captures every installed, organization-only and metadata row. */
export async function captureLegacyCatalog(options: CaptureOptions = {}): Promise<LegacyCatalogCapture> {
  const db = await openExisting(options)
  let rows: Row[]
  try {
    rows = await new Promise<Row[]>((resolve, reject) => {
      let tx: IDBTransaction
      try { tx = db.transaction(Array.from(db.objectStoreNames), 'readonly'); inspect(db, tx) } catch (error) { reject(error); return }
      const values: Row[] = []
      tx.onerror = () => reject(tx.error ?? new Error('旧个人库捕获失败。'))
      tx.onabort = () => reject(tx.error ?? new Error('旧个人库捕获取消。'))
      tx.oncomplete = () => { try { checkCancelled(options.signal); resolve(values) } catch (error) { reject(error) } }
      for (const store of ['entries', 'organizations', 'metadata'] as const) {
        const request = tx.objectStore(store).openCursor()
        request.onsuccess = () => { try {
          checkCancelled(options.signal)
          const cursor = request.result
          if (!cursor) return
          values.push({ store, key: cursor.primaryKey, value: cursor.value }); cursor.continue()
        } catch (error) { tx.abort(); reject(error) } }
      }
    })
  } finally { db.close() }
  rows.sort((a, b) => compare(canonicalJson([a.store, a.key]), canonicalJson([b.store, b.key])))
  const records: PreservationRecordInput[] = []
  for (const row of rows.filter(row => row.store !== 'metadata')) {
    checkCancelled(options.signal)
    const bytes = await encodeLegacyRow(row.value)
    records.push({ role: roles[row.store], recordKey: canonicalJson([row.store, row.key]), sourceFormat: 'sceneweave-idb-catalog-v1@1', contentHash: sha256Bytes(bytes), bytes })
  }
  // One metadata envelope also preserves an absent row or multiple damaged rows.
  // It never pretends that an invented revision existed in the source database.
  const metadataBytes = await encodeLegacyRow({ rows: rows.filter(row => row.store === 'metadata').map(({ key, value }) => ({ key, value })) })
  records.push({ role: 'catalog-metadata', recordKey: canonicalJson(['metadata', 'all']), sourceFormat: 'sceneweave-idb-catalog-v1@1', contentHash: sha256Bytes(metadataBytes), bytes: metadataBytes })
  records.sort((a, b) => compare(a.recordKey, b.recordKey))
  checkCancelled(options.signal)
  return seal({ kind: 'catalog', repository: LEGACY_CATALOG_DATABASE, sourceSceneId: null }, records, rows)
}

export async function restoreLegacyCatalogCapture(scopeInput: MigrationScope, inputs: readonly PreservationRecordInput[], signal?: CancellationSignal): Promise<LegacyCatalogCapture> {
  const scope = captureJson(scopeInput)
  if (canonicalJson(Object.keys(scope).sort()) !== canonicalJson(['kind', 'repository', 'sourceSceneId']) || scope.kind !== 'catalog' || scope.sourceSceneId !== null
    || ![LEGACY_CATALOG_DATABASE, 'file-catalog-v1'].includes(scope.repository)) throw new Error('旧个人库保全scope无效。')
  if (!Array.isArray(inputs) || Object.getPrototypeOf(inputs) !== Array.prototype || Reflect.ownKeys(inputs).length !== inputs.length + 1 || inputs.length > 30_000) throw new Error('旧个人库保全记录数组无效。')
  const captured: PreservationRecordInput[] = []
  for (let i = 0; i < inputs.length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(inputs, String(i))
    if (!descriptor?.enumerable || !('value' in descriptor)) throw new Error('保全记录数组有空洞或访问器。')
    const value: unknown = descriptor.value
    exact(value, ['role', 'recordKey', 'sourceFormat', 'contentHash', 'bytes'])
    const metadata = captureJson({ role: value.role, recordKey: value.recordKey, sourceFormat: value.sourceFormat, contentHash: value.contentHash })
    const bytes = captureBytes(value.bytes as Uint8Array, 512 * 1024 * 1024)
    captured.push({ ...metadata, bytes } as PreservationRecordInput)
  }
  checkCancelled(signal)
  if (scope.repository === 'file-catalog-v1') {
    if (captured.length !== 1 || captured[0].recordKey !== 'input.sceneweave-library' || captured[0].role !== 'catalog-metadata' || captured[0].sourceFormat !== 'sceneweave-library@1'
      || sha256Bytes(captured[0].bytes) !== captured[0].contentHash) throw new Error('旧库备份原文件记录无效。')
    return captureLegacyCatalogFile(captured[0].bytes, { signal })
  }
  const rows: Row[] = [], keys = new Set<string>()
  for (const record of captured) {
    checkCancelled(signal)
    const pair = JSON.parse(record.recordKey) as unknown
    if (!Array.isArray(pair) || pair.length !== 2 || !['entries', 'organizations', 'metadata'].includes(pair[0]) || canonicalJson(pair) !== record.recordKey
      || record.sourceFormat !== 'sceneweave-idb-catalog-v1@1' || record.role !== roles[pair[0] as Row['store']] || keys.has(record.recordKey)
      || record.contentHash !== sha256Bytes(record.bytes)) throw new Error('旧个人库保全行角色、键或字节hash无效。')
    keys.add(record.recordKey)
    const value = decodeLegacyRow(record.bytes)
    if (pair[0] === 'metadata') {
      if (pair[1] !== 'all') throw new Error('个人库元数据必须完整保全为单一行集合。')
      exact(value, ['rows'])
      if (!Array.isArray(value.rows) || value.rows.length > 30_000) throw new Error('旧个人库元数据行集合无效。')
      const metadataKeys = new Set<string>()
      for (const inputRow of value.rows) {
        exact(inputRow, ['key', 'value'])
        if (!object(inputRow.value) || canonicalJson(inputRow.value.id) !== canonicalJson(inputRow.key) || metadataKeys.has(canonicalJson(inputRow.key))) throw new Error('旧个人库元数据行与主键不一致或重复。')
        metadataKeys.add(canonicalJson(inputRow.key)); rows.push({ store: 'metadata', key: inputRow.key as IDBValidKey, value: inputRow.value })
      }
      continue
    }
    const field = 'key'
    if (!object(value) || canonicalJson(value[field]) !== canonicalJson(pair[1])) throw new Error('旧个人库行值与原主键不一致。')
    rows.push({ store: pair[0] as Row['store'], key: pair[1] as IDBValidKey, value })
  }
  if (captured.filter(record => record.role === 'catalog-metadata').length !== 1) throw new Error('旧个人库保全必须包含确切完整元数据集合。')
  return seal(scope, captured, rows)
}

/** Old selected backups remain selected scopes, and preserve their original uploaded bytes. */
export async function captureLegacyCatalogFile(input: Uint8Array, options: CaptureOptions = {}): Promise<LegacyCatalogCapture> {
  const bytes = captureBytes(input, LIBRARY_LIMITS.backupBytes)
  const records = await readCatalogBackup(new Blob([bytes.slice().buffer], { type: 'application/json' }), options.signal as AbortSignal | undefined)
  checkCancelled(options.signal)
  const rows: Row[] = records.flatMap(record => [{ store: 'entries' as const, key: record.entry.item.identity.key, value: record.entry },
    { store: 'organizations' as const, key: record.entry.item.identity.key, value: record.organization }])
  const capture = seal({ kind: 'catalog', repository: 'file-catalog-v1', sourceSceneId: null }, [{ role: 'catalog-metadata', recordKey: 'input.sceneweave-library',
    sourceFormat: 'sceneweave-library@1', contentHash: sha256Bytes(bytes), bytes }], rows)
  return capture
}

async function convertEntry(entry: PreparedCatalogEntryV1, validation: CompleteValidationOptions): Promise<PreparedLibraryEntry> {
  const old = await readCatalogEntry(entry, validation.signal as AbortSignal | undefined)
  checkCancelled(validation.signal)
  const bytes = new Map<string, Uint8Array>()
  const assets = Object.fromEntries(await Promise.all(Object.entries(old.assets).map(async ([hash, record]) => {
    const { blob, ...metadata } = record
    bytes.set(hash, new Uint8Array(await Blob.prototype.arrayBuffer.call(blob))); return [hash, metadata]
  })))
  const project: ProjectData = { format: 'sceneweave-complete-project', schemaVersion: 1,
    document: { ...captureJson(old.document), format: 'sceneweave-scene', schemaVersion: 1 },
    historyIdentity: { ...captureJson(old.historyIdentity), version: 1 }, appearance: captureJson(old.appearance),
    assets, licenses: captureJson(old.licenses), licenseBindings: captureJson(old.licenseBindings), authoringSources: {} }
  const bundle: ProjectBundle = { project, resources: createMemoryResources(bytes) }, converted = await prepareLibraryEntry(bundle, entry.item.selector, validation)
  if (canonicalJson(converted.item) !== canonicalJson(entry.item)) throw new Error('个人素材转换改变了算法1精确身份或元数据；不允许猜测重绑。')
  return converted
}

export async function prepareLegacyCatalog(capture: LegacyCatalogCapture, validation: CompleteValidationOptions): Promise<ConvertedCatalog> {
  const captured = owned(capture), rows: Row[] = []
  if (captured.scope.repository === 'file-catalog-v1') {
    const old = await readCatalogBackup(new Blob([captured.records[0].bytes.slice().buffer]), validation.signal as AbortSignal | undefined)
    for (const record of old) {
      rows.push({ store: 'entries', key: record.entry.item.identity.key, value: { key: record.entry.item.identity.key, logicalKey: record.entry.item.identity.logicalKey, entry: record.entry } })
      rows.push({ store: 'organizations', key: record.entry.item.identity.key, value: { key: record.entry.item.identity.key, value: record.organization } })
    }
    rows.push({ store: 'metadata', key: 'catalog', value: { id: 'catalog', revision: 0 } })
  } else for (const record of captured.records) {
    const [store, key] = JSON.parse(record.recordKey) as [Row['store'], IDBValidKey]
    const value = decodeLegacyRow(record.bytes)
    if (store === 'metadata') for (const row of (value as { rows: { key: IDBValidKey; value: unknown }[] }).rows) rows.push({ store, ...row })
    else rows.push({ store, key, value })
  }
  const installed = rows.filter(row => row.store === 'entries'), organized = rows.filter(row => row.store === 'organizations'), metadata = rows.filter(row => row.store === 'metadata')
  if (installed.length > LIBRARY_LIMITS.entries || organized.length > LIBRARY_LIMITS.organizationRecords || metadata.length > 1 || (!metadata.length && rows.length)) throw new Error('旧个人库元数据缺失或记录数量超限。')
  if (metadata.length) { exact(metadata[0].value, ['id', 'revision']); if (metadata[0].key !== 'catalog' || metadata[0].value.id !== 'catalog' || !Number.isSafeInteger(metadata[0].value.revision) || Number(metadata[0].value.revision) < 0) throw new Error('旧个人库revision或元数据归属无效。') }
  const entries: PreparedLibraryEntry[] = [], organizations: Record<string, CatalogOrganization> = Object.create(null), logical = new Map<string, string>()
  let totalBytes = 0
  for (const row of installed) {
    checkCancelled(validation.signal); exact(row.value, ['key', 'logicalKey', 'entry']); exact(row.value.entry, ['item', 'capsule', 'capsuleSha256'])
    const item = validateCatalogItem(row.value.entry.item), key = item.identity.key
    if (row.key !== key || row.value.key !== key || row.value.logicalKey !== item.identity.logicalKey || logical.has(item.identity.logicalKey)
      || !(row.value.entry.capsule instanceof Blob) || row.value.entry.capsule.size > LIBRARY_LIMITS.capsuleBytes) throw new Error('旧个人素材记录归属、身份重复或载体无效。')
    if ((totalBytes += row.value.entry.capsule.size) > LIBRARY_LIMITS.storedCapsuleBytes) throw new Error('旧个人库完整载体超过128MiB。')
    logical.set(item.identity.logicalKey, key)
    entries.push(await convertEntry(row.value.entry as unknown as PreparedCatalogEntryV1, validation))
  }
  if (entries.reduce((sum, entry) => sum + entry.capsule.byteLength, 0) > LIBRARY_LIMITS.storedCapsuleBytes) throw new Error('转换后完整载体超过128MiB，原库保持。')
  for (const row of organized) {
    checkCancelled(validation.signal); exact(row.value, ['key', 'value'])
    const key = validateCatalogKey(row.value.key), logicalKey = JSON.stringify(JSON.parse(key).slice(0, 5)), collision = logical.get(logicalKey)
    if (row.key !== key || Object.hasOwn(organizations, key) || collision && collision !== key) throw new Error('旧个人整理归属、重复或固定内容冲突。')
    logical.set(logicalKey, key); organizations[key] = validateCatalogOrganization(row.value.value)
  }
  checkCancelled(validation.signal)
  return { entries, organizations, sourceContentHashes: captureJson(capture.sourceContentHashes) }
}
