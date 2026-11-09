import { currentDatabaseNames } from './current-databases.js'
import Dexie, { type Table, type Transaction } from 'dexie'
import type { LicenseBinding, LicenseTextRecord, ProjectData, SnapshotSummary } from '../../../shared/model/project.js'
import type { ConversionJob, LegacySource } from '../../../shared/migration/types.js'
import type { HistoryHead, HistoryPin, HistoryVersion } from './incremental-history.js'
import { decodeProjectCoordinates, encodeProjectCoordinates } from '../../../shared/aggregates/scene-coordinates.js'
import { canonicalJson } from '../../../shared/validation/json.js'
import { contentBlockMiddleware, type ContentBlockWrite } from './content-block-middleware.js'
import type { ProjectContentBlock } from './content-blocks.js'
import { exactEncodedSnapshot, matchingEncodedSnapshot } from './content-context.js'

export const LEGACY_DEVELOPMENT_PROJECT_DATABASE = 'sceneweave-projects'
export const PROJECT_DATABASE_NAME = currentDatabaseNames().projects
export const PROJECT_STORES_V1 = {
  projects: 'sceneId, savedAt, status, conversionJobId',
  automaticSnapshots: '[ownerSceneId+revision], ownerSceneId',
  snapshots: '[ownerSceneId+id], ownerSceneId, kind, id',
  importedSnapshots: '[ownerSceneId+id], ownerSceneId, id',
  resources: 'sha256', licenseTexts: 'sha256',
  resourceBindings: '[ownerSceneId+kind+recordId], ownerSceneId, kind',
  historyMetadata: 'ownerSceneId',
  legacyBlobs: 'sha256', legacySources: '[ownerSceneId+nodeId], ownerSceneId',
  conversionJobs: 'jobId, &jobKey, targetSceneId, stage',
} as const
export const PROJECT_STORES_V2 = { ...PROJECT_STORES_V1, nativeUpgradeCapsules: 'capsuleId, sourceSceneId, targetSceneId, createdAt' } as const
export const PROJECT_STORES_V3 = { ...PROJECT_STORES_V2,
  historyVersions: '[ownerSceneId+id], ownerSceneId, [ownerSceneId+revision], [ownerSceneId+parentId]',
  historyHeads: 'ownerSceneId', historyPins: '[ownerSceneId+id], ownerSceneId',
  storageState: 'key',
} as const
export const PROJECT_STORES = { ...PROJECT_STORES_V3, projectContentBlocks: 'sha256' } as const
export const PROJECT_TABLES = Object.keys(PROJECT_STORES) as (keyof typeof PROJECT_STORES)[]

export interface StoredProject {
  sceneId: string
  revision: number
  savedAt: string
  contentHash: string
  status: 'preparing' | 'ready'
  conversionJobId: string | null
  project: ProjectData
}
export interface StoredAutomatic {
  ownerSceneId: string
  revision: number
  savedAt: string
  contentHash: string
  project: ProjectData
}
export interface StoredSnapshot extends SnapshotSummary { project: ProjectData }
export type BindingKind = 'current' | 'automatic' | 'named' | 'protection' | 'imported-auto'
export interface StoredBinding {
  ownerSceneId: string
  kind: BindingKind
  recordId: string
  assetHashes: string[]
  sourceHashes: string[]
  licenseHashes: string[]
  licenseBindings: LicenseBinding[]
}
export interface StoredBytes { sha256: string; bytes: Uint8Array }
export interface StoredHistoryMetadata { ownerSceneId: string; metadataVersion: number }
export interface StorageState { key: 'epoch'; epoch: number }

type CoordinateField = 'project' | 'checkpoint'
/** Hooks see native stored records, including put's diff against local data.
 * Whole world replacements are the only supported way to edit encoded content;
 * Dexie applies dotted modifications before hooks, so local geometry patches
 * cannot safely be interpreted as world geometry. */
function coordinateHooks(table: Table, field: CoordinateField): void {
  const atomic = <T>(transaction: Transaction, operation: () => T): T => {
    try { return operation() } catch (error) { transaction.abort(); throw error }
  }
  const payload = (row: Record<string, unknown>): ProjectData | null => row[field] as ProjectData | null
  const local = (project: ProjectData | null): boolean => project?.document?.aggregateCoordinates?.encoding === 'local'
  table.hook('reading', row => {
    if (row === undefined || field === 'checkpoint' && row[field] === null) return row
    const transaction = Dexie.currentTransaction, project = payload(row)!
    const prepared = transaction && exactEncodedSnapshot(transaction.idbtrans, project)
    // The block middleware exposes this exact immutable local object only
    // after the final transaction compared every actual native block byte.
    // Preserve its owned world endpoint instead of decoding/cloning it again.
    if (prepared && project === prepared.encoded.stored) return { ...row, [field]: prepared.project }
    const decoded = decodeProjectCoordinates(payload(row)!)
    return decoded === row[field] ? row : { ...row, [field]: decoded }
  })
  table.hook('creating', function (_key, row, transaction) {
    return atomic(transaction, () => {
      const original = payload(row)
      if (original === null) {
        if (field === 'checkpoint') return
        throw new Error('工程存储记录不能缺少完整工程。')
      }
      const encoded = matchingEncodedSnapshot(transaction.idbtrans, original)?.encoded.stored ?? encodeProjectCoordinates(original)
      if (encoded === original) return
      row[field] = encoded
      // Dexie's creating hook mutates the requested object. Restore the runtime
      // view after its native write, including an unsuccessful native request.
      const restore = () => { row[field] = original }
      this.onsuccess = restore; this.onerror = restore
      transaction.on('complete', restore); transaction.on('abort', restore)
    })
  })
  table.hook('updating', function (changes, _key, row, transaction) {
    return atomic(transaction, () => {
      const previous = payload(row), next = structuredClone(row)
      for (const [path, value] of Object.entries(changes)) Dexie.setByKeyPath(next, path, value)
      const candidate = payload(next), touched = Object.keys(changes).some(path => path === field || path.startsWith(`${field}.`))
      if (!touched) return
      if (candidate === null && field === 'project') throw new Error('工程存储记录不能缺少完整工程。')
      const prepared = candidate && matchingEncodedSnapshot(transaction.idbtrans, candidate)
      if (prepared) {
        const encoded = prepared.encoded.stored
        this.onsuccess = written => {
          if (written && typeof written === 'object' && (written as Record<string, unknown>)[field] === encoded) (written as Record<string, unknown>)[field] = prepared.project
        }
        return { [field]: encoded }
      }
      if (local(previous) && candidate !== null && candidate?.document?.aggregateCoordinates?.encoding !== 'world') {
        // Dexie's modify clones arrays and reports them as changed even for an
        // unrelated metadata update. Equal JSON is still the same local payload.
        if (canonicalJson(candidate) === canonicalJson(previous)) return
        throw new Error('局部坐标工程须以完整世界坐标副本替换；不接受嵌套存储修改。')
      }
      const world = candidate === null ? null : local(candidate) ? decodeProjectCoordinates(candidate) : candidate
      const encoded = world === null ? null : encodeProjectCoordinates(world)
      if (encoded === candidate) return
      // put's requested object may be the caller's runtime row; keep it world
      // after Dexie applies this hook's native-only replacement.
      this.onsuccess = written => {
        if (written && typeof written === 'object' && (written as Record<string, unknown>)[field] === encoded) (written as Record<string, unknown>)[field] = world
      }
      return { [field]: encoded }
    })
  })
}

const nativeShape = Object.fromEntries(Object.entries(PROJECT_STORES).map(([name, expression]) => {
  const [key, ...indexes] = expression.split(',').map(value => value.trim())
  const keyPath = (value: string): string | string[] => value.startsWith('[') ? value.slice(1, -1).split('+') : value
  return [name, { key: keyPath(key), indexes: Object.fromEntries(indexes.map(index => {
    const unique = index.startsWith('&'), path = unique ? index.slice(1) : index
    return [path, { key: keyPath(path), unique }]
  })) }]
}))
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right)
function assertNativeShape(db: IDBDatabase, names: readonly string[], transaction: IDBTransaction) {
  if (!same([...db.objectStoreNames].sort(), [...names].sort())) throw new Error('不支持的新工程数据库结构版本；数据库保持原状。')
  for (const name of names) {
    const store = transaction.objectStore(name), shape = nativeShape[name]
    if (store.autoIncrement || !same(store.keyPath, shape.key) || !same([...store.indexNames].sort(), Object.keys(shape.indexes).sort())) throw new Error('不支持的新工程数据库表结构；数据库保持原状。')
    for (const [indexName, expected] of Object.entries(shape.indexes)) {
      const index = store.index(indexName)
      if (!same(index.keyPath, expected.key) || index.unique !== expected.unique || index.multiEntry) throw new Error('不支持的新工程数据库索引结构；数据库保持原状。')
    }
  }
}

/** Inspect the exact source schema before Dexie may add stores during an explicit upgrade. */
function guardedFactory(factory: IDBFactory) {
  let failure: Error | undefined
  const guarded: IDBFactory = {
    open(name, version) {
      failure = undefined
      const request = version === undefined ? factory.open(name) : factory.open(name, version)
      request.addEventListener('upgradeneeded', event => {
        if (event.oldVersion === 0) return
        try {
          if (event.oldVersion !== 10 && event.oldVersion !== 20 && event.oldVersion !== 30) throw new Error('不支持升级既有工程数据库结构；原数据库保持原状。')
          assertNativeShape(request.result, Object.keys(event.oldVersion === 10 ? PROJECT_STORES_V1 : event.oldVersion === 20 ? PROJECT_STORES_V2 : PROJECT_STORES_V3), request.transaction!)
        } catch (error) {
          failure = error instanceof Error ? error : new Error('工程数据库升级前结构校验失败。')
          request.transaction!.abort()
        }
      })
      return request
    },
    deleteDatabase: name => factory.deleteDatabase(name), cmp: (left, right) => factory.cmp(left, right),
    databases: () => factory.databases(),
  }
  return { factory: guarded, failure: () => failure }
}

/** Abort the initial upgrade of an absent database; only the later explicit Dexie open creates it. */
export function inspectProjectDatabase(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name)
    let absent = false, settled = false
    const fail = (error: unknown) => { if (!settled) { settled = true; reject(error) } }
    request.onupgradeneeded = () => { absent = true; request.transaction!.abort() }
    request.onerror = () => {
      if (absent && request.error?.name === 'AbortError') { settled = true; resolve() }
      else fail(request.error ?? new Error('无法检查新工程数据库。'))
    }
    request.onblocked = () => fail(new Error('工程数据库被其他连接阻塞；请关闭旧标签后重试。'))
    request.onsuccess = () => {
      const db = request.result
      try {
        if (settled) return
        if (db.version !== 10 && db.version !== 20 && db.version !== 30 && db.version !== 40) throw new Error('不支持的新工程数据库结构版本；数据库保持原状。')
        const names = db.version === 10 ? Object.keys(PROJECT_STORES_V1) : db.version === 20 ? Object.keys(PROJECT_STORES_V2) : db.version === 30 ? Object.keys(PROJECT_STORES_V3) : [...PROJECT_TABLES]
        // Check store names before constructing a transaction against them;
        // foreign stores otherwise produce a browser NotFoundError first.
        if (!same([...db.objectStoreNames].sort(), [...names].sort())) throw new Error('不支持的新工程数据库结构版本；数据库保持原状。')
        assertNativeShape(db, names, db.transaction(names, 'readonly'))
        settled = true; resolve()
      } catch (error) { fail(error) } finally { db.close() }
    }
  })
}

/** The schema is never installed until an explicit repository open/save operation. */
export class ProjectDatabase extends Dexie {
  private readonly upgradeGuard: ReturnType<typeof guardedFactory>
  projects!: Table<StoredProject, string>
  automaticSnapshots!: Table<StoredAutomatic, [string, number]>
  snapshots!: Table<StoredSnapshot, [string, string]>
  importedSnapshots!: Table<StoredSnapshot, [string, string]>
  resources!: Table<StoredBytes, string>
  licenseTexts!: Table<LicenseTextRecord, string>
  resourceBindings!: Table<StoredBinding, [string, BindingKind, string]>
  historyMetadata!: Table<StoredHistoryMetadata, string>
  legacyBlobs!: Table<StoredBytes, string>
  legacySources!: Table<LegacySource, [string, string]>
  conversionJobs!: Table<ConversionJob, string>
  nativeUpgradeCapsules!: Table<Record<string, unknown>, string>
  historyVersions!: Table<HistoryVersion, [string, string]>
  historyHeads!: Table<HistoryHead, string>
  historyPins!: Table<HistoryPin, [string, string]>
  storageState!: Table<StorageState, string>
  projectContentBlocks!: Table<ProjectContentBlock, string>
  private blockWriteTotals: ContentBlockWrite = { blocks: 0, bytes: 0, reused: 0, recordBytes: 0 }
  onContentBlockWrite?: () => void
  onContentStorageDelta?: (bytes: number) => void
  contentBlockWrites(): Readonly<ContentBlockWrite> { return { ...this.blockWriteTotals } }
  /** Physical bytes, including inline records retained by an upgrade. */
  async rawJsonBytes(table: string): Promise<number> {
    const transaction = Dexie.currentTransaction
    if (!transaction) throw new Error('原始字节计量须位于当前完整事务。')
    return new Dexie.Promise<number>((resolve, reject) => {
      const request = transaction.idbtrans.objectStore(table).getAll()
      request.onsuccess = () => { try { resolve(request.result.reduce((sum, row) => sum + new TextEncoder().encode(canonicalJson(row)).length, 0)) } catch (error) { reject(error) } }
      request.onerror = () => reject(request.error)
    })
  }
  /** Envelope-only reads do not certify or materialize project content. */
  rawJsonRecord(table: string, key: IDBValidKey): Promise<unknown> {
    const transaction = Dexie.currentTransaction
    if (!transaction) throw new Error('原始记录读取须位于当前完整事务。')
    return new Dexie.Promise((resolve, reject) => {
      const request = transaction.idbtrans.objectStore(table).get(key)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  }

  /** Native envelopes for navigation only. No coordinate decode or content
   * block materialization; callers must not treat these as project proofs. */
  rawJsonRows(table: string, query?: { index: string; key: IDBValidKey }): Promise<{ key: IDBValidKey; value: unknown }[]> {
    const transaction = Dexie.currentTransaction
    if (!transaction) throw new Error('目录记录读取须位于当前事务。')
    return new Dexie.Promise((resolve, reject) => {
      const store = transaction.idbtrans.objectStore(table), source = query ? store.index(query.index) : store
      const request = query ? source.openCursor(IDBKeyRange.only(query.key)) : source.openCursor()
      const rows: { key: IDBValidKey; value: unknown }[] = []
      request.onsuccess = () => {
        try {
          const cursor = request.result
          if (!cursor) { resolve(rows); return }
          if (rows.length >= 65_536) throw new Error('目录记录超过读取保护值；未返回不完整目录。')
          rows.push({ key: cursor.primaryKey, value: cursor.value }); cursor.continue()
        } catch (error) { reject(error) }
      }
      request.onerror = () => reject(request.error)
    })
  }

  constructor(name = PROJECT_DATABASE_NAME) {
    if (['sceneweave-m0', 'sceneweave-m1', 'sceneweave-m1-layers', 'sceneweave-m1-history', 'sceneweave-m1-composition', 'sceneweave-m1-outdoor', 'sceneweave-catalog', 'sceneweave-catalog-v1', 'sceneweave-library'].includes(name)) throw new Error('新主工程库不能使用旧工程或个人素材库的名称。')
    const guard = guardedFactory(Dexie.dependencies.indexedDB)
    super(name, { indexedDB: guard.factory })
    // Observe update specs before Dexie's table hooks turn them into object diffs.
    this.use({ stack: 'dbcore', name: 'aggregate-coordinate-update-guard', level: 3, create: down => ({
      ...down,
      table: tableName => {
        const table = down.table(tableName)
        if (!['projects', 'automaticSnapshots', 'snapshots', 'importedSnapshots', 'historyVersions'].includes(tableName)) return table
        return { ...table, mutate: request => {
          if (request.type === 'put' && (request.updates || request.changeSpec)) {
            const fields = request.updates
              ? request.updates.changeSpecs.flatMap(spec => Object.keys(spec))
              : Object.keys(request.changeSpec ?? {})
            const nestedPayloadEdit = fields.some(path => path.startsWith('project.') || path.startsWith('checkpoint.'))
            const hasCoordinatePayload = request.values.some((value: Record<string, unknown>) => {
              const currentProject = value.project as ProjectData | undefined
              const checkpoint = value.checkpoint as ProjectData | null | undefined
              return currentProject?.document?.aggregateCoordinates !== undefined
                || checkpoint?.document?.aggregateCoordinates !== undefined
            })
            if (nestedPayloadEdit && hasCoordinatePayload) {
              request.trans.abort()
              throw new Error('局部坐标工程只允许整行替换，不能用嵌套载荷更新。')
            }
          }
          return table.mutate(request)
        } }
      },
    }) })
    this.use(contentBlockMiddleware((measurement, transaction) => {
      // Diagnostics count committed bytes, never abandoned insertion attempts.
      ;(transaction as IDBTransaction).addEventListener('complete', () => {
        this.blockWriteTotals.blocks += measurement.blocks; this.blockWriteTotals.bytes += measurement.bytes; this.blockWriteTotals.reused += measurement.reused; this.blockWriteTotals.recordBytes += measurement.recordBytes
      }, { once: true })
      if (measurement.blocks) this.onContentBlockWrite?.()
    }, bytes => this.onContentStorageDelta?.(bytes)))
    this.upgradeGuard = guard
    this.version(1).stores(PROJECT_STORES_V1).upgrade(() => {
      // The native preflight and Dexie.open are separate operations. A foreign
      // lower-version database could appear between them; never upgrade it.
      // Initial creation (oldVersion === 0) follows Dexie's populate path and
      // does not execute this existing-database content upgrade callback.
      throw new Error('不支持升级既有工程数据库结构；原数据库保持原状。')
    })
    this.version(2).stores(PROJECT_STORES_V2).upgrade(transaction => {
      // Inspect the actual upgrade transaction too: preflight and open are separate operations.
      // A foreign v1 database appearing between them must roll back the new store and every change.
      assertNativeShape(transaction.idbtrans.db, Object.keys(PROJECT_STORES_V2), transaction.idbtrans)
    })
    this.version(3).stores(PROJECT_STORES_V3).upgrade(transaction => {
      // Data remains untouched: the repository stages complete copies and
      // verifies cold reads before activating an incremental-history head.
      assertNativeShape(transaction.idbtrans.db, Object.keys(PROJECT_STORES_V3), transaction.idbtrans)
    })
    this.version(4).stores(PROJECT_STORES).upgrade(transaction => {
      // Additive only: original inline projects/history remain untouched.
      assertNativeShape(transaction.idbtrans.db, PROJECT_TABLES, transaction.idbtrans)
    })
    for (const table of [this.projects, this.automaticSnapshots, this.snapshots, this.importedSnapshots]) coordinateHooks(table, 'project')
    coordinateHooks(this.historyVersions, 'checkpoint')
  }
  override open() { return super.open().catch(error => { throw this.upgradeGuard.failure() ?? error }) }
}
