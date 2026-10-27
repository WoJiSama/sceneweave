import Dexie, { type Table } from 'dexie'
import type { LicenseBinding, LicenseTextRecord, ProjectData, SnapshotSummary } from '../../../shared/model/project.js'
import type { ConversionJob, LegacySource } from '../../../shared/migration/types.js'
import type { StoredNativeUpgradeCapsule } from './native-upgrade.js'

export const PROJECT_DATABASE_NAME = 'sceneweave-projects'
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
export const PROJECT_STORES = { ...PROJECT_STORES_V1, nativeUpgradeCapsules: 'capsuleId, sourceSceneId, targetSceneId, createdAt' } as const
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

/** Inspect old native stores before Dexie can add/remove indexes or stores during a v1→v2 upgrade. */
function guardedFactory(factory: IDBFactory) {
  let failure: Error | undefined
  const guarded: IDBFactory = {
    open(name, version) {
      failure = undefined
      const request = version === undefined ? factory.open(name) : factory.open(name, version)
      request.addEventListener('upgradeneeded', event => {
        if (event.oldVersion === 0) return
        try {
          if (event.oldVersion !== 10) throw new Error('不支持升级既有工程数据库结构；原数据库保持原状。')
          assertNativeShape(request.result, Object.keys(PROJECT_STORES_V1), request.transaction!)
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
        if (db.version !== 10 && db.version !== 20) throw new Error('不支持的新工程数据库结构版本；数据库保持原状。')
        const names = db.version === 10 ? Object.keys(PROJECT_STORES_V1) : [...PROJECT_TABLES]
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
  nativeUpgradeCapsules!: Table<StoredNativeUpgradeCapsule, string>

  constructor(name = PROJECT_DATABASE_NAME) {
    if (['sceneweave-m0', 'sceneweave-m1', 'sceneweave-m1-layers', 'sceneweave-m1-history', 'sceneweave-m1-composition', 'sceneweave-m1-outdoor', 'sceneweave-catalog', 'sceneweave-catalog-v1', 'sceneweave-library'].includes(name)) throw new Error('新主工程库不能使用旧工程或个人素材库的名称。')
    const guard = guardedFactory(Dexie.dependencies.indexedDB)
    super(name, { indexedDB: guard.factory })
    this.upgradeGuard = guard
    this.version(1).stores(PROJECT_STORES_V1).upgrade(() => {
      // The native preflight and Dexie.open are separate operations. A foreign
      // lower-version database could appear between them; never upgrade it.
      // Initial creation (oldVersion === 0) follows Dexie's populate path and
      // does not execute this existing-database content upgrade callback.
      throw new Error('不支持升级既有工程数据库结构；原数据库保持原状。')
    })
    this.version(2).stores(PROJECT_STORES).upgrade(transaction => {
      // Inspect the actual upgrade transaction too: preflight and open are separate operations.
      // A foreign v1 database appearing between them must roll back the new store and every change.
      assertNativeShape(transaction.idbtrans.db, PROJECT_TABLES, transaction.idbtrans)
    })
  }
  override open() { return super.open().catch(error => { throw this.upgradeGuard.failure() ?? error }) }
}
