import type { MigrationScope, PreservationRecordInput, PreservationRole } from '../../shared/migration/types.js'
import type { CancellationSignal } from '../../shared/ports/resources.js'
import { checkCancelled } from '../../shared/ports/resources.js'
import { canonicalJson, captureJson, freezeJson } from '../../shared/validation/json.js'
import { sha256Bytes, captureBytes } from '../../shared/project/binary.js'
import { sha256Text } from '../../shared/validation/hash.js'
import { decodeLegacyRow, encodeLegacyRow } from './row-codec.js'
import { restoreLegacyFileCapture } from './file.js'

export type LegacyRepository = 'v1' | 'v2' | 'v3' | 'v4' | 'v5' | 'v6'
export interface LegacyReference { repository: LegacyRepository; sceneId: string }
export interface CaptureOptions { factory?: IDBFactory; signal?: CancellationSignal }
export interface LegacyCapture {
  scope: MigrationScope; sourceFingerprint: string; records: PreservationRecordInput[]
  snapshotKeys: string[]; sourceContentHashes: Record<string, string>
}
export interface CapturedRow { store: string; key: IDBValidKey; value: Record<string, unknown> }
export interface CaptureContents { repository: LegacyRepository; sceneId: string; rows: CapturedRow[] }
interface OwnedCapture extends CaptureContents { scopeJson: string; sourceFingerprint: string; records: PreservationRecordInput[] }
const ownedCaptures = new WeakMap<LegacyCapture, OwnedCapture>()
export const LEGACY_DATABASES: Readonly<Record<LegacyRepository, string>> = Object.freeze({
  v1: 'sceneweave-m0', v2: 'sceneweave-m1', v3: 'sceneweave-m1-layers', v4: 'sceneweave-m1-history', v5: 'sceneweave-m1-composition', v6: 'sceneweave-m1-outdoor',
})
type Shape = { key: string | string[]; indexes: Record<string, string> }
const geometry: Record<string, Shape> = {
  scenes: { key: 'sceneId', indexes: { savedAt: 'savedAt' } }, snapshots: { key: ['sceneId', 'revision'], indexes: { sceneId: 'sceneId' } },
}
const assets: Record<string, Shape> = { ...geometry, assetBlobs: { key: 'sha256', indexes: {} }, licenseTexts: { key: 'sha256', indexes: {} },
  resourceBindings: { key: ['sceneId', 'revision'], indexes: { sceneId: 'sceneId' } }, migrationSources: { key: 'sceneId', indexes: {} } }
const history: Record<string, Shape> = { ...assets, namedSnapshots: { key: ['sceneId', 'id'], indexes: { sceneId: 'sceneId', id: 'id' } },
  protectionSnapshots: { key: ['sceneId', 'id'], indexes: { sceneId: 'sceneId', id: 'id' } },
  namedResourceBindings: { key: ['sceneId', 'snapshotId'], indexes: { sceneId: 'sceneId' } }, historyMetadata: { key: 'sceneId', indexes: {} } }
const shapes = (repository: LegacyRepository) => repository === 'v1' ? geometry : repository === 'v2' || repository === 'v3' ? assets : history
const roles: Record<string, PreservationRole> = { scenes: 'current', snapshots: 'automatic', namedSnapshots: 'named', protectionSnapshots: 'protection',
  assetBlobs: 'resource', licenseTexts: 'license', resourceBindings: 'resource-binding', namedResourceBindings: 'resource-binding', migrationSources: 'legacy-source', historyMetadata: 'history-metadata' }
const id = (input: unknown): input is string => typeof input === 'string' && input.length > 0 && input.length <= 256 && input !== '__proto__'
const hash = (input: unknown): input is string => typeof input === 'string' && /^[a-f0-9]{64}$/.test(input)
const object = (input: unknown): input is Record<string, unknown> => !!input && typeof input === 'object' && !Array.isArray(input) && [Object.prototype, null].includes(Object.getPrototypeOf(input))
const repositoryValue = (input: unknown): LegacyRepository => {
  if (typeof input !== 'string' || !Object.hasOwn(LEGACY_DATABASES, input)) throw new Error('旧仓库标识不支持。')
  return input as LegacyRepository
}
export const legacySnapshotKey = (repository: LegacyRepository, ownerSceneId: string, kind: 'automatic' | 'named' | 'protection', sourceId: string) => canonicalJson({ repository, ownerSceneId, kind, id: sourceId })

/** Missing stores are aborted during upgrade; no missing legacy database is created. */
function openExisting(repository: LegacyRepository, options: CaptureOptions): Promise<IDBDatabase | null> {
  checkCancelled(options.signal)
  const factory = options.factory ?? globalThis.indexedDB
  if (!factory) throw new Error('当前运行时不能读取浏览器IndexedDB。')
  return new Promise((resolve, reject) => {
    let missing = false, done = false
    const request = factory.open(LEGACY_DATABASES[repository])
    request.onupgradeneeded = () => { missing = true; request.transaction!.abort() }
    request.onblocked = () => { done = true; reject(new Error('旧库被其他连接阻塞；原库保持不变。')) }
    request.onerror = () => { if (done) return; done = true; missing ? resolve(null) : reject(request.error ?? new Error('旧库读取失败。')) }
    request.onsuccess = () => { if (done) { request.result.close(); return }; done = true
      try { checkCancelled(options.signal); resolve(request.result) } catch (error) { request.result.close(); reject(error) } }
  })
}
function inspectSchema(db: IDBDatabase, repository: LegacyRepository, transaction: IDBTransaction): void {
  const expected = shapes(repository)
  if (db.version !== 10 || canonicalJson(Array.from(db.objectStoreNames).sort()) !== canonicalJson(Object.keys(expected).sort())) throw new Error('旧库版本或表集合未知，不能自动升级或猜测读取。')
  for (const [name, shape] of Object.entries(expected)) {
    const store = transaction.objectStore(name)
    if (store.autoIncrement || canonicalJson(store.keyPath) !== canonicalJson(shape.key) || canonicalJson(Array.from(store.indexNames).sort()) !== canonicalJson(Object.keys(shape.indexes).sort())) throw new Error(`旧库表 ${name} 的主键或索引不匹配。`)
    for (const [indexName, path] of Object.entries(shape.indexes)) {
      const index = store.index(indexName)
      if (index.keyPath !== path || index.unique || index.multiEntry) throw new Error(`旧库索引 ${name}.${indexName} 不匹配。`)
    }
  }
}
export async function discoverLegacyRepositories(options: CaptureOptions = {}): Promise<LegacyRepository[]> {
  const found: LegacyRepository[] = []
  for (const repository of Object.keys(LEGACY_DATABASES) as LegacyRepository[]) {
    checkCancelled(options.signal)
    const db = await openExisting(repository, options)
    if (!db) continue
    try { const transaction = db.transaction(Array.from(db.objectStoreNames), 'readonly'); inspectSchema(db, repository, transaction); found.push(repository) } finally { db.close() }
  }
  return found
}

/** Schema inspection and all family rows/resources use one native readonly transaction. */
async function readRows(reference: LegacyReference, options: CaptureOptions): Promise<CapturedRow[]> {
  const db = await openExisting(reference.repository, options)
  if (!db) throw new Error('所选旧库不存在，没有创建替代空库。')
  try {
    return await new Promise((resolve, reject) => {
      let transaction: IDBTransaction
      try { transaction = db.transaction(Array.from(db.objectStoreNames), 'readonly'); inspectSchema(db, reference.repository, transaction) } catch (error) { reject(error); return }
      const rows: CapturedRow[] = []
      transaction.onerror = () => reject(transaction.error ?? new Error('旧工程只读捕获失败。'))
      transaction.onabort = () => reject(transaction.error ?? new Error('旧工程只读捕获已中止。'))
      transaction.oncomplete = () => {
        try {
          checkCancelled(options.signal)
          const bindings = rows.filter(row => row.store === 'resourceBindings' || row.store === 'namedResourceBindings'), assetHashes = new Set<string>(), licenseHashes = new Set<string>()
          let malformed = false
          for (const binding of bindings) for (const [field, target] of [['assetHashes', assetHashes], ['licenseHashes', licenseHashes]] as const) {
            const values = binding.value[field]
            if (!Array.isArray(values) || values.some(value => !hash(value))) malformed = true
            else values.forEach(value => target.add(value))
          }
          // A malformed binding is still preserved. Its unknown closure is conservatively
          // captured in full and will be rejected by the converter, never silently omitted.
          resolve(rows.filter(row => row.store === 'assetBlobs' ? malformed || assetHashes.has(String(row.key)) : row.store === 'licenseTexts' ? malformed || licenseHashes.has(String(row.key)) : true))
        } catch (error) { reject(error) }
      }
      for (const name of Object.keys(shapes(reference.repository))) {
        const store = transaction.objectStore(name)
        const source = name === 'scenes' || name === 'migrationSources' || name === 'historyMetadata' ? store : name === 'assetBlobs' || name === 'licenseTexts' ? store : store.index('sceneId')
        const query = name === 'assetBlobs' || name === 'licenseTexts' ? undefined : reference.sceneId
        const request = source.openCursor(query)
        request.onsuccess = () => {
          try {
            checkCancelled(options.signal)
            const cursor = request.result
            if (!cursor) return
            rows.push({ store: name, key: cursor.primaryKey, value: cursor.value }); cursor.continue()
          } catch (error) { transaction.abort(); reject(error) }
        }
      }
    })
  } finally { db.close() }
}
function semanticHash(row: CapturedRow, rawHash: string): string {
  return hash(row.value.contentHash) ? row.value.contentHash : rawHash
}
function fingerprint(scope: MigrationScope, records: readonly PreservationRecordInput[]): string {
  return sha256Text(canonicalJson({ scope, records: records.map(record => ({ role: record.role, recordKey: record.recordKey,
    sourceFormat: record.sourceFormat, contentHash: record.contentHash, rawSha256: sha256Bytes(record.bytes) })).sort((a, b) => a.recordKey < b.recordKey ? -1 : a.recordKey > b.recordKey ? 1 : 0) }))
}
function buildCapture(scope: MigrationScope, rows: CapturedRow[], records: PreservationRecordInput[]): LegacyCapture {
  const repository = repositoryValue(scope.repository), sceneId = scope.sourceSceneId
  if (scope.kind !== 'project-family' || !id(sceneId)) throw new Error('旧工程scope无效。')
  const current = rows.filter(row => row.store === 'scenes')
  if (current.length !== 1 || current[0].key !== sceneId) throw new Error('旧工程当前记录缺失或重复，不能宣称完整保全。')
  const snapshotKeys: string[] = [], sourceContentHashes: Record<string, string> = {}
  records.forEach((record, i) => {
    const row = rows[i]
    if (row.store === 'scenes') sourceContentHashes.current = record.contentHash
    if (row.store === 'snapshots' || row.store === 'namedSnapshots' || row.store === 'protectionSnapshots') {
      const kind = row.store === 'snapshots' ? 'automatic' : row.store === 'namedSnapshots' ? 'named' : 'protection'
      const key = legacySnapshotKey(repository, sceneId, kind, String(kind === 'automatic' ? row.value.revision : row.value.id))
      snapshotKeys.push(key); sourceContentHashes[key] = record.contentHash
    }
  })
  if (new Set(snapshotKeys).size !== snapshotKeys.length) throw new Error('旧历史源键重复，不能固定转换映射。')
  const sourceFingerprint = fingerprint(scope, records), ownedRecords = records.map(record => ({ ...record, bytes: record.bytes.slice() }))
  const capture: LegacyCapture = { scope: freezeJson({ ...scope }), sourceFingerprint, records, snapshotKeys: freezeJson(snapshotKeys.sort()), sourceContentHashes: freezeJson(sourceContentHashes) }
  for (const record of records) Object.freeze(record)
  Object.freeze(records); Object.freeze(capture)
  ownedCaptures.set(capture, { repository, sceneId, rows: [], scopeJson: canonicalJson(scope), sourceFingerprint, records: ownedRecords }); return capture
}
export async function captureLegacyFamily(reference: LegacyReference, options: CaptureOptions = {}): Promise<LegacyCapture> {
  const capturedReference = captureJson(reference)
  if (Object.keys(capturedReference).sort().join(',') !== 'repository,sceneId') throw new Error('旧工程引用含未知字段。')
  const repository = repositoryValue(capturedReference.repository), sceneId = capturedReference.sceneId
  if (!id(sceneId)) throw new Error('旧工程sceneId无效。')
  const rows = await readRows({ repository, sceneId }, options), records: PreservationRecordInput[] = []
  rows.sort((a, b) => { const left = canonicalJson([a.store, a.key]), right = canonicalJson([b.store, b.key]); return left < right ? -1 : left > right ? 1 : 0 })
  for (const row of rows) {
    checkCancelled(options.signal)
    const bytes = await encodeLegacyRow(row.value), rawHash = sha256Bytes(bytes)
    records.push({ role: roles[row.store], recordKey: canonicalJson([row.store, row.key]), sourceFormat: `sceneweave-idb-${repository}@1`, contentHash: semanticHash(row, rawHash), bytes })
  }
  return buildCapture({ kind: 'project-family', repository, sourceSceneId: sceneId }, rows, records)
}
export async function restoreLegacyCapture(scopeInput: MigrationScope, inputs: readonly PreservationRecordInput[], signal?: CancellationSignal): Promise<LegacyCapture> {
  const scope = captureJson(scopeInput)
  if (typeof scope.repository === 'string' && /^file-v[1-6]$/.test(scope.repository)) return restoreLegacyFileCapture(scope, inputs, signal)
  const repository = repositoryValue(scope.repository), sceneId = scope.sourceSceneId
  if (scope.kind !== 'project-family' || !id(sceneId) || Object.keys(scopeInput).sort().join(',') !== 'kind,repository,sourceSceneId') throw new Error('保全集合工程scope无效。')
  if (!Array.isArray(inputs) || Object.getPrototypeOf(inputs) !== Array.prototype || Reflect.ownKeys(inputs).length !== inputs.length + 1 || inputs.length > 30_000) throw new Error('旧工程保全记录数组无效。')
  const records: PreservationRecordInput[] = [], rows: CapturedRow[] = [], keys = new Set<string>(), expected = shapes(repository)
  for (let index = 0; index < inputs.length; index++) {
    checkCancelled(signal)
    const descriptor = Object.getOwnPropertyDescriptor(inputs, String(index))
    if (!descriptor?.enumerable || !('value' in descriptor)) throw new Error('旧保全数组含空洞或访问器。')
    const inputValue = descriptor.value
    if (!object(inputValue)) throw new Error('旧保全记录必须为普通对象。')
    const descriptors = Object.getOwnPropertyDescriptors(inputValue), fields = ['role', 'recordKey', 'sourceFormat', 'contentHash', 'bytes']
    if (Reflect.ownKeys(inputValue).length !== fields.length || !fields.every(key => descriptors[key]?.enumerable && 'value' in descriptors[key])) throw new Error('旧保全记录含未知、隐藏、Symbol或访问器字段。')
    const input = Object.fromEntries(fields.map(key => [key, descriptors[key].value])) as unknown as PreservationRecordInput
    captureJson({ role: input.role, recordKey: input.recordKey, sourceFormat: input.sourceFormat, contentHash: input.contentHash })
    const bytes = captureBytes(input.bytes, 512 * 1024 * 1024), pair = JSON.parse(input.recordKey) as unknown
    if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== 'string' || !Object.hasOwn(expected, pair[0]) || input.sourceFormat !== `sceneweave-idb-${repository}@1`
      || input.role !== roles[pair[0]] || canonicalJson(pair) !== input.recordKey || keys.has(input.recordKey)) throw new Error('保全行的表、角色、格式或键无效。')
    keys.add(input.recordKey)
    const value = decodeLegacyRow(bytes)
    if (!object(value)) throw new Error('保全行必须恢复为原生IDB对象记录。')
    const shape = expected[pair[0]], rowKey = typeof shape.key === 'string' ? value[shape.key] : shape.key.map(key => value[key])
    if (canonicalJson(rowKey) !== canonicalJson(pair[1])) throw new Error('保全行值与原主键不一致。')
    if (!['assetBlobs', 'licenseTexts'].includes(pair[0]) && value.sceneId !== sceneId) throw new Error('保全行来自scope外工程。')
    const row = { store: pair[0], key: pair[1] as IDBValidKey, value }
    if (semanticHash(row, sha256Bytes(bytes)) !== input.contentHash) throw new Error('保全行语义hash不匹配。')
    rows.push(row); records.push({ ...input, bytes })
  }
  return buildCapture(scope, rows, records)
}
export function legacyCaptureContents(capture: LegacyCapture): CaptureContents {
  const contents = ownedCaptures.get(capture)
  if (!contents || canonicalJson(capture.scope) !== contents.scopeJson || capture.sourceFingerprint !== contents.sourceFingerprint
    || fingerprint(capture.scope, capture.records) !== contents.sourceFingerprint) throw new Error('必须使用本次完整捕获或已重读的保全集合，且捕获记录不能被修改。')
  return { repository: contents.repository, sceneId: contents.sceneId, rows: contents.records.map(record => {
    const [store, key] = JSON.parse(record.recordKey) as [string, IDBValidKey]
    return { store, key, value: decodeLegacyRow(record.bytes) as Record<string, unknown> }
  }) }
}
