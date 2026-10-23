import type { SceneDocument } from '../../core/types'
import type { CompleteProjectV2 } from '../../io/v2/types'
import type { CompleteProjectV3 } from '../../io/v3/types'
import type { CompleteProjectV4 } from '../../io/v4/types'
import type { CompleteProjectV5 } from '../../io/v5/types'
import type { CompleteProjectV6 } from '../../io/v6/types'

export type RepositoryKind = 'v1' | 'v2' | 'v3' | 'v4' | 'v5' | 'v6'
export type ProjectReference = { repository: RepositoryKind; sceneId: string }
export type ProjectEntry = { reference: ProjectReference; key: string; title: string; revision: number; savedAt: string; issue?: string }
export type DiscoveryResult = { entries: ProjectEntry[]; issues: { repository: RepositoryKind; message: string }[] }

export const repositoryLabels: Record<RepositoryKind, string> = {
  v1: 'M0 几何工程 · v1', v2: '素材工程 · v2', v3: '图层工程 · v3',
  v4: '历史工程 · v4', v5: '组件工程 · v5', v6: '当前工程 · v6',
}
const names: Record<RepositoryKind, string> = {
  v1: 'sceneweave-m0', v2: 'sceneweave-m1', v3: 'sceneweave-m1-layers',
  v4: 'sceneweave-m1-history', v5: 'sceneweave-m1-composition', v6: 'sceneweave-m1-outdoor',
}
const kinds = Object.keys(names) as RepositoryKind[]
type Data = Record<string, unknown>
type StoreShape = { key: string | string[]; indexes: Record<string, string> }
const geometryStores: Record<string, StoreShape> = {
  scenes: { key: 'sceneId', indexes: { savedAt: 'savedAt' } },
  snapshots: { key: ['sceneId', 'revision'], indexes: { sceneId: 'sceneId' } },
}
const assetStores: Record<string, StoreShape> = {
  ...geometryStores, assetBlobs: { key: 'sha256', indexes: {} }, licenseTexts: { key: 'sha256', indexes: {} },
  resourceBindings: { key: ['sceneId', 'revision'], indexes: { sceneId: 'sceneId' } },
  migrationSources: { key: 'sceneId', indexes: {} },
}
const historyStores: Record<string, StoreShape> = {
  ...assetStores,
  namedSnapshots: { key: ['sceneId', 'id'], indexes: { sceneId: 'sceneId', id: 'id' } },
  protectionSnapshots: { key: ['sceneId', 'id'], indexes: { sceneId: 'sceneId', id: 'id' } },
  namedResourceBindings: { key: ['sceneId', 'snapshotId'], indexes: { sceneId: 'sceneId' } },
  historyMetadata: { key: 'sceneId', indexes: {} },
}
const storesFor = (kind: RepositoryKind) => kind === 'v1' ? geometryStores : kind === 'v2' || kind === 'v3' ? assetStores : historyStores
const object = (value: unknown): value is Data => value !== null && typeof value === 'object' && !Array.isArray(value)
const exact = (value: unknown, keys: string[]): value is Data => object(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))
const integer = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0
const identifier = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 256 && value !== '__proto__'
const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error)
const cancellation = () => new DOMException('操作已取消；原存档保持不变。', 'AbortError')
function checkCancelled(signal?: AbortSignal): void { if (signal?.aborted) throw cancellation() }

function referenceValue(input: ProjectReference): ProjectReference {
  if (!exact(input, ['repository', 'sceneId']) || typeof input.repository !== 'string' || !Object.hasOwn(names, input.repository) || !identifier(input.sceneId)) {
    throw new Error('工程引用必须包含有效的原生仓库和 sceneId。')
  }
  return { repository: input.repository as RepositoryKind, sceneId: input.sceneId }
}
export function projectReferenceKey(reference: ProjectReference): string {
  const value = referenceValue(reference)
  return `${value.repository}:${value.sceneId}`
}

interface ReadConnection { db: IDBDatabase; signal: AbortSignal; check(): void; close(): void }

function checkDatabase(db: IDBDatabase, kind: RepositoryKind): void {
  const stores = storesFor(kind), expected = Object.keys(stores).sort()
  if (db.version !== 10 || JSON.stringify(Array.from(db.objectStoreNames).sort()) !== JSON.stringify(expected)) {
    throw new Error('不支持的原生数据库版本或表结构；原数据库已保留。')
  }
  const transaction = db.transaction(expected, 'readonly')
  for (const [name, shape] of Object.entries(stores)) {
    const store = transaction.objectStore(name)
    if (store.autoIncrement || JSON.stringify(store.keyPath) !== JSON.stringify(shape.key)
      || JSON.stringify(Array.from(store.indexNames).sort()) !== JSON.stringify(Object.keys(shape.indexes).sort())) {
      throw new Error(`不支持的原生数据库表结构（${name}）；原数据库已保留。`)
    }
    for (const [name, key] of Object.entries(shape.indexes)) {
      const index = store.index(name)
      if (index.keyPath !== key || index.unique || index.multiEntry) throw new Error('不支持的原生数据库索引结构；原数据库已保留。')
    }
  }
}

/** No Dexie auto-open here: a missing database's upgrade is always aborted. */
function openExisting(kind: RepositoryKind, signal?: AbortSignal): Promise<ReadConnection | null> {
  checkCancelled(signal)
  return new Promise((resolve, reject) => {
    const controller = new AbortController()
    let request: IDBOpenDBRequest, database: IDBDatabase | undefined, settled = false, missing = false, closed = false
    const close = () => {
      closed = true; signal?.removeEventListener('abort', abort)
      if (database) { database.onversionchange = null; database.onclose = null; database.close() }
    }
    const fail = (error: Error) => {
      if (!controller.signal.aborted) controller.abort(error)
      close()
      if (!settled) { settled = true; reject(error) }
    }
    const abort = () => fail(cancellation())
    signal?.addEventListener('abort', abort, { once: true })
    try { request = indexedDB.open(names[kind]) } catch (error) { fail(error instanceof Error ? error : new Error(String(error))); return }
    request.onupgradeneeded = () => { missing = true; request.transaction!.abort() }
    request.onblocked = () => fail(new Error('原生数据库被其他连接阻塞；请关闭旧标签后重试。'))
    request.onerror = () => {
      if (missing && request.error?.name === 'AbortError' && !settled) { close(); settled = true; resolve(null) }
      else if (!settled) fail(request.error ?? new Error('无法读取原生数据库。'))
    }
    request.onsuccess = () => {
      database = request.result
      if (closed || settled) { database.close(); return }
      try {
        checkCancelled(signal); checkDatabase(database, kind)
        database.onversionchange = () => fail(new Error('原生数据库版本已变化；已停止读取，请重新发现工程。'))
        database.onclose = () => { if (!closed) fail(new Error('原生数据库连接意外关闭；已停止读取。')) }
        settled = true
        resolve({ db: database, signal: controller.signal, close, check() {
          if (controller.signal.aborted) throw controller.signal.reason
          if (closed) throw new Error('原生数据库连接已关闭。')
        } })
      } catch (error) { fail(error instanceof Error ? error : new Error(String(error))) }
    }
  })
}

function requestValue<T = unknown>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error ?? new Error('原生存档读取失败。')) })
}
function readTransaction<T>(connection: ReadConnection, stores: string[], read: (transaction: IDBTransaction) => Promise<T>): Promise<T> {
  connection.check()
  return new Promise((resolve, reject) => {
    const transaction = connection.db.transaction(stores, 'readonly')
    let value: T, completed = false, failure: unknown
    const cleanup = () => connection.signal.removeEventListener('abort', abort)
    const abort = () => { failure = connection.signal.reason; try { transaction.abort() } catch { /* It may already have completed. */ } }
    connection.signal.addEventListener('abort', abort, { once: true })
    transaction.oncomplete = () => {
      cleanup()
      try { connection.check(); if (!completed) throw new Error('原生只读事务未完整结束。'); resolve(value) } catch (error) { reject(error) }
    }
    transaction.onabort = () => { cleanup(); reject(failure ?? transaction.error ?? new Error('原生只读事务已中止。')) }
    transaction.onerror = () => { failure ??= transaction.error }
    void read(transaction).then(result => { value = result; completed = true }, error => { failure = error; try { transaction.abort() } catch { cleanup(); reject(error) } })
  })
}

function recordKeys(kind: RepositoryKind): string[] {
  return ['sceneId', 'revision', 'document', 'savedAt', ...(kind !== 'v1' ? ['documentSchemaVersion'] : []),
    ...(!['v1', 'v2'].includes(kind) ? ['migrationSourceHash'] : []),
    ...(['v4', 'v5', 'v6'].includes(kind) ? ['historyIdentity', 'contentHash'] : []),
    ...(['v5', 'v6'].includes(kind) ? ['appearance'] : [])]
}
/** Metadata only. This deliberately does not traverse geometry, resources or historical content. */
function recordIssue(kind: RepositoryKind, sceneId: string, value: unknown): string | undefined {
  if (!exact(value, recordKeys(kind)) || value.sceneId !== sceneId || !integer(value.revision) || !object(value.document)
    || value.document.sceneId !== sceneId || value.document.revision !== value.revision
    || typeof value.document.title !== 'string' || !value.document.title.trim()
    || !integer(value.savedAt) || value.savedAt > 8_640_000_000_000_000) return '工程摘要身份、修订或时间字段损坏；原记录已保留。'
  const schema = kind === 'v1' ? 1 : kind === 'v2' ? 2 : 3
  if (value.document.schemaVersion !== schema || kind !== 'v1' && value.documentSchemaVersion !== schema) return '工程文档版本与原生仓库不匹配；原记录已保留。'
  if (!['v1', 'v2'].includes(kind) && value.migrationSourceHash !== null && !hash(value.migrationSourceHash)) return '工程来源链绑定损坏；原记录已保留。'
  if (['v4', 'v5', 'v6'].includes(kind) && (!hash(value.contentHash) || !object(value.historyIdentity)
    || value.historyIdentity.version !== ({ v4: 1, v5: 2, v6: 3 } as Record<string, number>)[kind])) return '工程内容 hash 或历史身份版本损坏；原记录已保留。'
  if (['v5', 'v6'].includes(kind) && (!object(value.appearance) || value.appearance.version !== 1)) return '工程外观版本损坏；原记录已保留。'
}

async function discoverRepository(repository: RepositoryKind, signal?: AbortSignal): Promise<DiscoveryResult> {
  const connection = await openExisting(repository, signal)
  if (!connection) return { entries: [], issues: [] }
  try {
    return await readTransaction(connection, ['scenes'], transaction => new Promise((resolve, reject) => {
      const result: DiscoveryResult = { entries: [], issues: [] }, request = transaction.objectStore('scenes').openCursor()
      request.onerror = () => reject(request.error ?? new Error('无法读取工程列表。'))
      request.onsuccess = () => {
        try {
          connection.check()
          const cursor = request.result
          if (!cursor) { resolve(result); return }
          const id = cursor.primaryKey, record: unknown = cursor.value
          if (!identifier(id)) result.issues.push({ repository, message: '发现无法作为工程引用的记录主键；原记录已保留。' })
          else {
            const reference = { repository, sceneId: id }, issue = recordIssue(repository, id, record)
            const document = object(record) && object(record.document) ? record.document : undefined
            result.entries.push({ reference, key: projectReferenceKey(reference),
              title: typeof document?.title === 'string' && document.title.trim() ? document.title : `损坏的工程（${id}）`,
              revision: object(record) && integer(record.revision) ? record.revision : -1,
              savedAt: object(record) && integer(record.savedAt) && record.savedAt <= 8_640_000_000_000_000 ? new Date(record.savedAt).toISOString() : '',
              ...(issue ? { issue } : {}) })
          }
          cursor.continue()
        } catch (error) { reject(error) }
      }
    }))
  } finally { connection.close() }
}

export async function discoverProjects(signal?: AbortSignal): Promise<DiscoveryResult> {
  checkCancelled(signal)
  const results = await Promise.allSettled(kinds.map(kind => discoverRepository(kind, signal)))
  checkCancelled(signal)
  const result: DiscoveryResult = { entries: [], issues: [] }
  results.forEach((value, index) => {
    if (value.status === 'fulfilled') { result.entries.push(...value.value.entries); result.issues.push(...value.value.issues) }
    else result.issues.push({ repository: kinds[index], message: errorMessage(value.reason) })
  })
  result.entries.sort((a, b) => (Date.parse(b.savedAt) || 0) - (Date.parse(a.savedAt) || 0) || a.key.localeCompare(b.key))
  return result
}

interface NativeSnapshot { project: Data; contentHash?: string }
async function readNativeProject(connection: ReadConnection, reference: ProjectReference): Promise<NativeSnapshot> {
  const { repository, sceneId } = reference
  return readTransaction(connection, Object.keys(storesFor(repository)), async transaction => {
    const record = await requestValue(transaction.objectStore('scenes').get(sceneId))
    if (record === undefined) throw new Error('工程已不存在；当前工程保持不变。')
    const issue = recordIssue(repository, sceneId, record)
    if (issue) throw new Error(issue)
    const stored = record as Data
    if (repository === 'v1') return { project: { document: stored.document } }
    const binding = await requestValue(transaction.objectStore('resourceBindings').get([sceneId, stored.revision as number]))
    const history = ['v4', 'v5', 'v6'].includes(repository)
    if (!exact(binding, ['sceneId', 'revision', 'assetHashes', 'licenseHashes', 'licenseBindings'])
      || binding.sceneId !== sceneId || binding.revision !== stored.revision
      || !Array.isArray(binding.assetHashes) || binding.assetHashes.length > 256
      || !Array.isArray(binding.licenseHashes) || binding.licenseHashes.length > 3000
      || !Array.isArray(binding.licenseBindings) || binding.licenseBindings.length > (history ? 10_000 : 4352)
      || [...binding.assetHashes, ...binding.licenseHashes].some(value => !hash(value))
      || new Set(binding.assetHashes).size !== binding.assetHashes.length || new Set(binding.licenseHashes).size !== binding.licenseHashes.length) {
      throw new Error('存档资源绑定缺失、损坏或超出原生预算；原记录已保留。')
    }
    const assetHashes = binding.assetHashes as string[], licenseHashes = binding.licenseHashes as string[]
    const [assets, licenses, migration, metadata] = await Promise.all([
      Promise.all(assetHashes.map(id => requestValue(transaction.objectStore('assetBlobs').get(id)))),
      Promise.all(licenseHashes.map(id => requestValue(transaction.objectStore('licenseTexts').get(id)))),
      requestValue(transaction.objectStore('migrationSources').get(sceneId)),
      history ? requestValue(transaction.objectStore('historyMetadata').get(sceneId)) : Promise.resolve(undefined),
    ])
    if (assets.some(value => value === undefined) || licenses.some(value => value === undefined)) throw new Error('存档所需素材或许可缺失；原记录已保留。')
    if (history && (!exact(metadata, ['sceneId', 'metadataVersion']) || metadata.sceneId !== sceneId || !integer(metadata.metadataVersion))) throw new Error('历史元数据缺失或损坏；原记录已保留。')
    if (migration !== undefined && (!object(migration) || migration.sceneId !== sceneId)) throw new Error('迁移来源绑定损坏；原记录已保留。')
    if (repository !== 'v2' && (object(migration) ? migration.sourceHash : null) !== stored.migrationSourceHash) throw new Error('迁移原件缺失或绑定损坏；原记录已保留。')
    const project: Data = { document: stored.document,
      assets: Object.fromEntries(assetHashes.map((id, index) => [id, assets[index]])),
      licenses: Object.fromEntries(licenseHashes.map((id, index) => [id, licenses[index]])), licenseBindings: binding.licenseBindings,
      ...(history ? { historyIdentity: stored.historyIdentity } : {}),
      ...(['v5', 'v6'].includes(repository) ? { appearance: stored.appearance } : {}) }
    if (object(migration)) { const { sceneId: _owner, ...source } = migration; project.migrationSource = source }
    return { project, ...(history ? { contentHash: stored.contentHash as string } : {}) }
  })
}

/** Captures one complete native revision. Never writes, upgrades, installs, or copies old history. */
export async function prepareProjectReference(input: ProjectReference, signal: AbortSignal): Promise<{ project: CompleteProjectV6; description: string; openPersisted: boolean }> {
  const reference = referenceValue(input)
  const connection = await openExisting(reference.repository, signal)
  checkCancelled(signal)
  if (!connection) throw new Error('原生工程仓库不存在；当前工程保持不变。')
  try {
    const snapshot = await readNativeProject(connection, reference), options = { signal: connection.signal }
    connection.check()
    let source2: CompleteProjectV2 | undefined, source3: CompleteProjectV3 | undefined, source4: CompleteProjectV4 | undefined, source5: CompleteProjectV5 | undefined
    if (reference.repository === 'v6') {
      const { validateCompleteProjectV6, hashValidatedProjectV6 } = await import('../../io/v6/project-file')
      const project = snapshot.project as unknown as CompleteProjectV6
      await validateCompleteProjectV6(project, options)
      if (await hashValidatedProjectV6(project) !== snapshot.contentHash) throw new Error('存档内容 hash 不匹配；原记录已保留。')
      connection.check()
      return { project, description: '打开已保存的当前 v6 完整工程；命名、保护与自动历史仍在原生仓库。', openPersisted: true }
    }
    if (reference.repository === 'v1') {
      const { migrateProjectV1 } = await import('../v2/migration-project')
      connection.check()
      source2 = await migrateProjectV1(snapshot.project.document as SceneDocument)
      connection.check()
    } else if (reference.repository === 'v2') source2 = snapshot.project as unknown as CompleteProjectV2
    else if (reference.repository === 'v3') source3 = snapshot.project as unknown as CompleteProjectV3
    else if (reference.repository === 'v4') {
      const { validateCompleteProjectV4, hashValidatedProjectV4 } = await import('../../io/v4/project-file')
      source4 = snapshot.project as unknown as CompleteProjectV4
      await validateCompleteProjectV4(source4, options)
      if (await hashValidatedProjectV4(source4) !== snapshot.contentHash) throw new Error('存档内容 hash 不匹配；原记录已保留。')
    } else {
      const { validateCompleteProjectV5, hashValidatedProjectV5 } = await import('../../io/v5/project-file')
      source5 = snapshot.project as unknown as CompleteProjectV5
      await validateCompleteProjectV5(source5, options)
      if (await hashValidatedProjectV5(source5) !== snapshot.contentHash) throw new Error('存档内容 hash 不匹配；原记录已保留。')
    }
    // These existing migrators fully validate their native input and exact original,
    // including v2's M0 original contents, before producing the next independent copy.
    if (source2) source3 = await (await import('../../io/v3/migration')).createLayerProject(source2, options)
    if (source3) source4 = await (await import('../../io/v4/migration')).migrateProjectV3ToV4(source3, options)
    if (source4) source5 = await (await import('../../io/v5/migration')).migrateProjectV4ToV5(source4, options)
    connection.check()
    const project = await (await import('../../io/v6/migration')).migrateProjectV5ToV6(source5!, options)
    connection.check()
    return { project, description: `从${repositoryLabels[reference.repository]}的已保存完整修订创建独立 v6 副本。确切原件与既有来源链随副本保全；原工程与已有历史留在原仓库（包括该版本支持的自动、命名、保护快照），不随当前修订迁移。`, openPersisted: false }
  } catch (error) {
    // Preserve connection/version diagnostics instead of reporting a generic
    // decoder cancellation when the database disappears while validation runs.
    connection.check()
    throw error
  } finally { connection.close() }
}
