import 'fake-indexeddb/auto'
import { forceCloseDatabase } from 'fake-indexeddb'
import Dexie from 'dexie'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHouse } from '../../core/seed'
import { SceneRepository } from '../../io/storage'
import { SceneRepositoryV2 } from '../../io/v2/storage'
import { emptyProject as emptyV2 } from '../../io/v2/test-fixtures'
import { SceneRepositoryV3 } from '../../io/v3/storage'
import { emptyProject as emptyV3 } from '../../io/v3/test-fixtures'
import { createLayerProject } from '../../io/v3/migration'
import { sha256Bytes } from '../../io/v3/resources'
import { SceneRepositoryV4 } from '../../io/v4/storage'
import { emptyProject as emptyV4 } from '../../io/v4/test-fixtures'
import { SceneRepositoryV5 } from '../../io/v5/storage'
import { emptyProject as emptyV5, imageProject as imageV5 } from '../../io/v5/test-fixtures'
import { SceneRepositoryV6 } from '../../io/v6/storage'
import { emptyProject as emptyV6, imageProject as imageV6 } from '../../io/v6/test-fixtures'
import { migrationOriginalV6 } from '../../io/v6/migration'
import { migrateProjectV1 } from '../v2/migration-project'
import { discoverProjects, prepareProjectReference, projectReferenceKey, repositoryLabels, type RepositoryKind } from './project-registry'

const names: Record<RepositoryKind, string> = {
  v1: 'sceneweave-m0', v2: 'sceneweave-m1', v3: 'sceneweave-m1-layers',
  v4: 'sceneweave-m1-history', v5: 'sceneweave-m1-composition', v6: 'sceneweave-m1-outdoor',
}
const repositories: { close(): void }[] = []
type SourceLink = { sourceSchemaVersion: number; previousSource?: SourceLink }
// fake-indexeddb 6.2.6 declares a constructor here, but its helper accepts an instance.
const closeDatabaseForTest = forceCloseDatabase as unknown as (db: IDBDatabase) => void
const keep = <T extends { close(): void }>(repository: T): T => { repositories.push(repository); return repository }
const signal = () => new AbortController().signal
const requestValue = <T>(request: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
  request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error)
})
async function database(kind: RepositoryKind): Promise<IDBDatabase> { return requestValue(indexedDB.open(names[kind])) }
async function mutate(kind: RepositoryKind, store: string, action: (table: IDBObjectStore) => void): Promise<void> {
  const db = await database(kind)
  try { await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(store, 'readwrite')
    transaction.oncomplete = () => resolve(); transaction.onabort = () => reject(transaction.error)
    action(transaction.objectStore(store))
  }) } finally { db.close() }
}
async function read(kind: RepositoryKind, store: string, key: IDBValidKey): Promise<Record<string, any> | undefined> {
  const db = await database(kind)
  try { return await requestValue(db.transaction(store, 'readonly').objectStore(store).get(key)) } finally { db.close() }
}
async function counts(kind: RepositoryKind): Promise<Record<string, number>> {
  const db = await database(kind)
  try {
    const names = Array.from(db.objectStoreNames), tx = db.transaction(names, 'readonly')
    return Object.fromEntries(await Promise.all(names.map(async name => [name, await requestValue(tx.objectStore(name).count())])))
  } finally { db.close() }
}
async function saveEmpty(kind: RepositoryKind, id = 'shared-scene') {
  if (kind === 'v1') {
    const document = createHouse(id); document.title = '同名工程'
    await keep(new SceneRepository()).save(document, null)
    return document
  }
  const project = kind === 'v2' ? emptyV2() : kind === 'v3' ? emptyV3() : kind === 'v4' ? emptyV4() : kind === 'v5' ? emptyV5() : emptyV6()
  project.document.sceneId = id; project.document.title = '同名工程'
  if (kind === 'v2') await keep(new SceneRepositoryV2()).save(project as ReturnType<typeof emptyV2>, null)
  else if (kind === 'v3') await keep(new SceneRepositoryV3()).save(project as ReturnType<typeof emptyV3>, null)
  else if (kind === 'v4') await keep(new SceneRepositoryV4()).save(project as ReturnType<typeof emptyV4>, null)
  else if (kind === 'v5') await keep(new SceneRepositoryV5()).save(project as ReturnType<typeof emptyV5>, null)
  else await keep(new SceneRepositoryV6()).save(project as ReturnType<typeof emptyV6>, null)
  return project.document
}

beforeEach(() => {
  // Only browser decode is substituted. Native records, real PNG bytes, hashes,
  // complete validators and all migration/provenance functions are real here.
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 1, height: 1, close: vi.fn() })))
})
afterEach(async () => {
  vi.restoreAllMocks(); vi.unstubAllGlobals()
  for (const repository of repositories.splice(0)) repository.close()
  for (const name of Object.values(names)) await Dexie.delete(name)
})

describe('read-only native project discovery', () => {
  it('does not create absent databases when discovering or opening', async () => {
    expect(await indexedDB.databases()).toEqual([])
    expect(await discoverProjects()).toEqual({ entries: [], issues: [] })
    await expect(prepareProjectReference({ repository: 'v2', sceneId: 'missing' }, signal())).rejects.toThrow('仓库不存在')
    expect(await indexedDB.databases()).toEqual([])
  })

  it('uses all six native wrappers, disambiguates identical IDs/titles, and reads no bitmaps', async () => {
    for (const kind of Object.keys(names) as RepositoryKind[]) await saveEmpty(kind)
    vi.mocked(createImageBitmap).mockClear()
    const result = await discoverProjects()
    expect(result.issues).toEqual([]); expect(result.entries).toHaveLength(6)
    expect(new Set(result.entries.map(entry => entry.key)).size).toBe(6)
    expect(result.entries.every(entry => entry.title === '同名工程' && entry.reference.sceneId === 'shared-scene' && entry.revision === 0 && !entry.issue)).toBe(true)
    for (const entry of result.entries) {
      expect(entry.key).toBe(projectReferenceKey(entry.reference)); expect(repositoryLabels[entry.reference.repository]).toBeTruthy()
      expect(new Date(entry.savedAt).toISOString()).toBe(entry.savedAt)
    }
    expect(createImageBitmap).not.toHaveBeenCalled()
  })

  it('keeps a corrupt metadata row visible without losing healthy rows or trusting scene contents', async () => {
    await saveEmpty('v1', 'healthy')
    const wrapper = (await read('v1', 'scenes', 'healthy'))!
    const invalid = structuredClone(wrapper); invalid.sceneId = 'bad'; invalid.document.sceneId = 'bad'; invalid.savedAt = 'not-a-date'
    const unvalidated = structuredClone(wrapper); unvalidated.sceneId = 'bad-geometry'; unvalidated.document.sceneId = 'bad-geometry'; unvalidated.document.props = { invalid: true }
    await mutate('v1', 'scenes', table => { table.put(invalid); table.put(unvalidated) })
    const result = await discoverProjects()
    expect(result.entries).toHaveLength(3); expect(result.issues).toEqual([])
    expect(result.entries.find(entry => entry.reference.sceneId === 'healthy')?.issue).toBeUndefined()
    expect(result.entries.find(entry => entry.reference.sceneId === 'bad')).toMatchObject({ savedAt: '', issue: expect.stringContaining('字段损坏') })
    expect(result.entries.find(entry => entry.reference.sceneId === 'bad-geometry')?.issue).toBeUndefined()
    await expect(prepareProjectReference({ repository: 'v1', sceneId: 'bad-geometry' }, signal())).rejects.toThrow('迁移失败')
    expect((await read('v1', 'scenes', 'bad'))!.savedAt).toBe('not-a-date')
  })

  it('reports an unusable primary key as a repository issue rather than inventing a reference', async () => {
    await saveEmpty('v1')
    await mutate('v1', 'scenes', table => table.put({ sceneId: 7, document: {}, revision: 0, savedAt: 0 }))
    const result = await discoverProjects()
    expect(result.entries).toHaveLength(1)
    expect(result.issues).toEqual([{ repository: 'v1', message: expect.stringContaining('主键') }])
  })

  it.each(['version', 'store', 'index'] as const)('isolates an unknown %s without modifying the database or hiding another repository', async fault => {
    await saveEmpty('v6')
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(names.v1, fault === 'version' ? 20 : 10)
      request.onupgradeneeded = () => {
        const db = request.result, scenes = db.createObjectStore('scenes', { keyPath: 'sceneId' })
        scenes.createIndex('savedAt', 'savedAt', { unique: fault === 'index' })
        db.createObjectStore('snapshots', { keyPath: ['sceneId', 'revision'] }).createIndex('sceneId', 'sceneId')
        if (fault === 'store') db.createObjectStore('unknown')
      }
      request.onerror = () => reject(request.error); request.onsuccess = () => { request.result.close(); resolve() }
    })
    const before = await indexedDB.databases(), result = await discoverProjects()
    expect(result.entries.map(entry => entry.reference.repository)).toEqual(['v6'])
    expect(result.issues).toEqual([{ repository: 'v1', message: expect.stringContaining('不支持') }])
    await expect(prepareProjectReference({ repository: 'v1', sceneId: 'shared-scene' }, signal())).rejects.toThrow('不支持')
    expect(await indexedDB.databases()).toEqual(before)
  })

  it('rejects pre-cancellation and cancellation during discovery without returning partial results', async () => {
    const controller = new AbortController(); controller.abort()
    const opening = vi.spyOn(indexedDB, 'open')
    await expect(discoverProjects(controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    await expect(prepareProjectReference({ repository: 'v1', sceneId: 'anything' }, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(opening).not.toHaveBeenCalled(); opening.mockRestore()
    await saveEmpty('v1')
    const pending = new AbortController(), original = IDBObjectStore.prototype.openCursor
    vi.spyOn(IDBObjectStore.prototype, 'openCursor').mockImplementation(function (this: IDBObjectStore, ...args) {
      const request = original.apply(this, args); request.addEventListener('success', () => pending.abort(), { once: true }); return request
    })
    await expect(discoverProjects(pending.signal)).rejects.toMatchObject({ name: 'AbortError' })
  })
})

describe('complete native preparation and independent migration', () => {
  it.each(Object.keys(names) as RepositoryKind[])('opens a real %s saved revision through complete validation without writing any repository', async repository => {
    const original = await saveEmpty(repository), before = await counts(repository), databases = await indexedDB.databases()
    const result = await prepareProjectReference({ repository, sceneId: original.sceneId }, signal())
    expect(result.project.document.schemaVersion).toBe(3); expect(result.project.historyIdentity.version).toBe(3)
    expect(result.project.appearance.version).toBe(1); expect(result.project.document.title).toBe(original.title)
    expect(result.openPersisted).toBe(repository === 'v6')
    if (repository === 'v6') expect(result.project.document).toEqual(original)
    else {
      expect(result.project.document.sceneId).not.toBe(original.sceneId)
      let source: SourceLink | undefined = result.project.migrationSource, chain = 0
      while (source) { chain++; source = source.previousSource }
      expect(chain).toBe(6 - Number(repository.slice(1)))
      expect(result.description).toContain('历史留在原仓库')
    }
    expect(await counts(repository)).toEqual(before); expect(await indexedDB.databases()).toEqual(databases)
    expect((await read(repository, 'scenes', original.sceneId))!.document).toEqual(original)
    if (repository === 'v1') expect(await (await migrationOriginalV6(result.project, 1))!.text()).toBe(JSON.stringify(original))
  }, 30_000)

  it('retains a real pre-existing exact source chain and leaves named/protection/automatic history in the old repository', async () => {
    const source = createHouse('original-m0'), v2 = await migrateProjectV1(source)
    const v3 = await createLayerProject(v2), { migrateProjectV3ToV4 } = await import('../../io/v4/migration')
    const v4 = await migrateProjectV3ToV4(v3), repo = keep(new SceneRepositoryV4())
    await repo.save(v4, null)
    const named = await repo.createNamedSnapshot(v4, '保留命名'), protection = await repo.createNamedSnapshot(v4, '保留保护', { kind: 'protection' })
    const before = await counts('v4'), result = await prepareProjectReference({ repository: 'v4', sceneId: v4.document.sceneId }, signal())
    expect(await (await migrationOriginalV6(result.project, 1))!.arrayBuffer()).toEqual(await v2.migrationSource!.original.arrayBuffer())
    expect(await (await migrationOriginalV6(result.project, 2))!.arrayBuffer()).toEqual(await v3.migrationSource!.original.arrayBuffer())
    expect(await (await migrationOriginalV6(result.project, 3))!.arrayBuffer()).toEqual(await v4.migrationSource!.original.arrayBuffer())
    expect(await counts('v4')).toEqual(before)
    expect(await repo.loadNamedSnapshot(named.id)).toEqual(named); expect(await repo.loadNamedSnapshot(protection.id)).toEqual(protection)
    expect((await indexedDB.databases()).map(value => value.name)).toEqual([names.v4])
  }, 30_000)

  it('rejects metadata revision substitution and valid document content substituted under an old native hash', async () => {
    const document = await saveEmpty('v6'), record = (await read('v6', 'scenes', document.sceneId))!
    const changed = structuredClone(record); changed.document.title = '偷偷替换完整内容'
    await mutate('v6', 'scenes', table => table.put(changed))
    await expect(prepareProjectReference({ repository: 'v6', sceneId: document.sceneId }, signal())).rejects.toThrow('hash 不匹配')
    changed.document.revision++
    await mutate('v6', 'scenes', table => table.put(changed))
    await expect(prepareProjectReference({ repository: 'v6', sceneId: document.sceneId }, signal())).rejects.toThrow('字段损坏')
    expect((await read('v6', 'scenes', document.sceneId))!.document).toEqual(changed.document)
  })

  it.each(['resource', 'binding', 'historyMetadata', 'bytes'] as const)('rejects damaged native %s while preserving the stored project', async fault => {
    const project = await imageV5(), repo = keep(new SceneRepositoryV5()); await repo.save(project, null)
    const id = project.document.sceneId, assetHash = Object.keys(project.assets)[0]
    if (fault === 'resource') await mutate('v5', 'assetBlobs', table => table.delete(assetHash))
    else if (fault === 'binding') {
      const refs = (await read('v5', 'resourceBindings', [id, 0]))!; refs.licenseBindings = []
      await mutate('v5', 'resourceBindings', table => table.put(refs))
    } else if (fault === 'historyMetadata') await mutate('v5', 'historyMetadata', table => table.delete(id))
    else {
      const asset = (await read('v5', 'assetBlobs', assetHash))!, bytes = new Uint8Array(await (asset.blob as Blob).arrayBuffer())
      bytes[bytes.length - 1] ^= 1; asset.blob = new Blob([bytes], { type: 'image/png' })
      await mutate('v5', 'assetBlobs', table => table.put(asset))
    }
    await expect(prepareProjectReference({ repository: 'v5', sceneId: id }, signal())).rejects.toThrow()
    expect((await read('v5', 'scenes', id))!.document).toEqual(project.document)
    expect((await indexedDB.databases()).map(value => value.name)).toEqual([names.v5])
  })

  it('rejects missing provenance, incorrect source binding and hash-consistent but invalid M0 original contents', async () => {
    const source = createHouse('native-source'), project = await migrateProjectV1(source), layer = await createLayerProject(project)
    await keep(new SceneRepositoryV3()).save(layer, null)
    const provenance = (await read('v3', 'migrationSources', layer.document.sceneId))!
    await mutate('v3', 'migrationSources', table => table.delete(layer.document.sceneId))
    await expect(prepareProjectReference({ repository: 'v3', sceneId: layer.document.sceneId }, signal())).rejects.toThrow('迁移原件缺失')
    await mutate('v3', 'migrationSources', table => table.put({ ...provenance, sourceHash: '0'.repeat(64) }))
    await expect(prepareProjectReference({ repository: 'v3', sceneId: layer.document.sceneId }, signal())).rejects.toThrow('绑定损坏')
    await keep(new SceneRepositoryV2()).save(project, null)
    const raw = (await read('v2', 'migrationSources', project.document.sceneId))!
    raw.original = new Blob([JSON.stringify({ ...source, unsupported: true })], { type: 'application/json' })
    raw.sourceHash = await sha256Bytes(new Uint8Array(await (raw.original as Blob).arrayBuffer()))
    await mutate('v2', 'migrationSources', table => table.put(raw))
    await expect(prepareProjectReference({ repository: 'v2', sceneId: project.document.sceneId }, signal())).rejects.toThrow('迁移失败')
  })

  it.each(['cancel', 'versionchange', 'close'] as const)('discards late native decoding after %s and releases its bitmap/connection', async interruption => {
    const project = await imageV6(), repo = keep(new SceneRepositoryV6()); await repo.save(project, null); repo.close()
    let finishDecode!: (value: ImageBitmap) => void, entered!: () => void
    const started = new Promise<void>(resolve => { entered = resolve }), closed = vi.fn()
    vi.stubGlobal('createImageBitmap', vi.fn(() => { entered(); return new Promise<ImageBitmap>(resolve => { finishDecode = resolve }) }))
    const opened: IDBDatabase[] = [], originalOpen = indexedDB.open.bind(indexedDB)
    vi.spyOn(indexedDB, 'open').mockImplementation((...args) => {
      const request = originalOpen(...args); request.addEventListener('success', () => opened.push(request.result)); return request
    })
    const controller = new AbortController(), pending = prepareProjectReference({ repository: 'v6', sceneId: project.document.sceneId }, controller.signal)
    const rejected = expect(pending).rejects.toThrow()
    await started
    if (interruption === 'cancel') controller.abort()
    else if (interruption === 'close') await new Promise<void>(resolve => {
      opened[0].addEventListener('close', () => resolve(), { once: true }); closeDatabaseForTest(opened[0])
    })
    else await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(names.v6, 20)
      request.onerror = () => reject(request.error); request.onblocked = () => reject(new Error('registry retained its connection'))
      request.onsuccess = () => { request.result.close(); resolve() }
    })
    finishDecode({ width: 1, height: 1, close: closed } as unknown as ImageBitmap)
    await rejected; expect(closed).toHaveBeenCalledOnce()
    const db = await database('v6'); expect(db.version).toBe(interruption === 'versionchange' ? 20 : 10); db.close()
  })

  it('captures a reference before asynchronous reads and rejects invalid repository identities', async () => {
    const source = await saveEmpty('v6'), reference = { repository: 'v6' as RepositoryKind, sceneId: source.sceneId }
    const prepared = prepareProjectReference(reference, signal()); reference.repository = 'v1'; reference.sceneId = 'changed'
    expect((await prepared).project.document.sceneId).toBe(source.sceneId)
    await expect(prepareProjectReference({ repository: 'constructor' as RepositoryKind, sceneId: source.sceneId }, signal())).rejects.toThrow('工程引用')
    expect(projectReferenceKey({ repository: 'v1', sceneId: 'a:b' })).not.toBe(projectReferenceKey({ repository: 'v2', sceneId: 'a:b' }))
  })
})
