import Dexie, { type Table } from 'dexie'
import type { CatalogOrganization, PreparedLibraryEntry } from '../../../shared/library/types.js'
import type { LibraryConversionJob } from './repository.js'

export const LIBRARY_DATABASE_NAME = 'sceneweave-library'
export const LIBRARY_STORES = {
  entries: 'key,&logicalKey', organizations: 'key', metadata: 'id',
  conversionJobs: 'jobId,&jobKey', conversionStaging: '[jobId+kind+key]',
} as const
export const LIBRARY_TABLES = Object.keys(LIBRARY_STORES) as (keyof typeof LIBRARY_STORES)[]
export interface StoredEntry { key: string; logicalKey: string; entry: PreparedLibraryEntry }
export interface StoredOrganization { key: string; value: CatalogOrganization }
export interface StoredMetadata { id: 'catalog'; revision: number }
export type StagedRecord = { jobId: string; kind: 'entry'; key: string; value: StoredEntry }
  | { jobId: string; kind: 'organization'; key: string; value: StoredOrganization }

const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right)
/** An absent database is inspected without creating it. Foreign schemas are never upgraded. */
export function inspectLibraryDatabase(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name)
    let absent = false, settled = false
    const fail = (error: unknown) => { if (!settled) { settled = true; reject(error) } }
    request.onupgradeneeded = () => { absent = true; request.transaction!.abort() }
    request.onerror = () => {
      if (absent && request.error?.name === 'AbortError') { settled = true; resolve() }
      else fail(request.error ?? new Error('无法检查个人素材库。'))
    }
    request.onblocked = () => fail(new Error('个人素材库被其他连接阻塞，请关闭旧标签后重试。'))
    request.onsuccess = () => {
      const db = request.result
      try {
        if (settled) return
        if (db.version !== 10 || !same([...db.objectStoreNames].sort(), [...LIBRARY_TABLES].sort())) throw new Error('不支持的个人素材库结构版本，原数据保持。')
        const tx = db.transaction(LIBRARY_TABLES, 'readonly')
        for (const table of LIBRARY_TABLES) {
          const store = tx.objectStore(table)
          const key = table === 'metadata' ? 'id' : table === 'conversionJobs' ? 'jobId' : table === 'conversionStaging' ? ['jobId', 'kind', 'key'] : 'key'
          const indexes = table === 'entries' ? ['logicalKey'] : table === 'conversionJobs' ? ['jobKey'] : []
          if (store.autoIncrement || !same(store.keyPath, key) || !same([...store.indexNames].sort(), indexes)) throw new Error('不支持的个人素材库表结构，原数据保持。')
          for (const name of indexes) {
            const index = store.index(name)
            if (index.keyPath !== name || !index.unique || index.multiEntry) throw new Error('不支持的个人素材库索引，原数据保持。')
          }
        }
        settled = true; resolve()
      } catch (error) { fail(error) } finally { db.close() }
    }
  })
}

export class LibraryDatabase extends Dexie {
  entries!: Table<StoredEntry, string>
  organizations!: Table<StoredOrganization, string>
  metadata!: Table<StoredMetadata, string>
  conversionJobs!: Table<LibraryConversionJob, string>
  conversionStaging!: Table<StagedRecord, [string, string, string]>
  constructor(name = LIBRARY_DATABASE_NAME) {
    if (['sceneweave-m0', 'sceneweave-m1', 'sceneweave-m1-layers', 'sceneweave-m1-history', 'sceneweave-m1-composition', 'sceneweave-m1-outdoor', 'sceneweave-catalog', 'sceneweave-catalog-v1', 'sceneweave-projects'].includes(name)) throw new Error('新个人素材库不能使用旧库或工程库名称。')
    super(name, { autoOpen: false })
    this.version(1).stores(LIBRARY_STORES).upgrade(() => {
      throw new Error('不支持升级既有个人素材库，原数据库保持。')
    })
  }
}
