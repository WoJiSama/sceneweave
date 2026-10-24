import Dexie, { type Table } from 'dexie'
import type { LicenseBinding, LicenseTextRecord, ProjectData, SnapshotSummary } from '../../../shared/model/project.js'
import type { ConversionJob, LegacySource } from '../../../shared/migration/types.js'

export const PROJECT_DATABASE_NAME = 'sceneweave-projects'
export const PROJECT_STORES = {
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
        if (db.version !== 10 || !same([...db.objectStoreNames].sort(), [...PROJECT_TABLES].sort())) throw new Error('不支持的新工程数据库结构版本；数据库保持原状。')
        const transaction = db.transaction(PROJECT_TABLES, 'readonly')
        for (const name of PROJECT_TABLES) {
          const store = transaction.objectStore(name), shape = nativeShape[name]
          if (store.autoIncrement || !same(store.keyPath, shape.key) || !same([...store.indexNames].sort(), Object.keys(shape.indexes).sort())) throw new Error('不支持的新工程数据库表结构；数据库保持原状。')
          for (const [indexName, expected] of Object.entries(shape.indexes)) {
            const index = store.index(indexName)
            if (!same(index.keyPath, expected.key) || index.unique !== expected.unique || index.multiEntry) throw new Error('不支持的新工程数据库索引结构；数据库保持原状。')
          }
        }
        settled = true; resolve()
      } catch (error) { fail(error) } finally { db.close() }
    }
  })
}

/** The schema is never installed until an explicit repository open/save operation. */
export class ProjectDatabase extends Dexie {
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

  constructor(name = PROJECT_DATABASE_NAME) {
    if (['sceneweave-m0', 'sceneweave-m1', 'sceneweave-m1-layers', 'sceneweave-m1-history', 'sceneweave-m1-composition', 'sceneweave-m1-outdoor', 'sceneweave-catalog', 'sceneweave-catalog-v1', 'sceneweave-library'].includes(name)) throw new Error('新主工程库不能使用旧工程或个人素材库的名称。')
    super(name)
    this.version(1).stores(PROJECT_STORES).upgrade(() => {
      // The native preflight and Dexie.open are separate operations. A foreign
      // lower-version database could appear between them; never upgrade it.
      // Initial creation (oldVersion === 0) follows Dexie's populate path and
      // does not execute this existing-database content upgrade callback.
      throw new Error('不支持升级既有工程数据库结构；原数据库保持原状。')
    })
  }
}
