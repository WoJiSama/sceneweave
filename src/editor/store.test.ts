import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SceneDocument } from '../core/types'

type StoreModule = typeof import('./store')
type StorageModule = typeof import('../io/storage')
type Repository = InstanceType<StorageModule['SceneRepository']>

let store: StoreModule
let storage: StorageModule
let repository: Repository

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}

function current(): SceneDocument {
  const document = store.useEditorStore.getState().document
  if (!document) throw new Error('Test editor was not booted.')
  return document
}

function moveTable() {
  const position = current().props['p-b2'].positionMm
  expect(store.useEditorStore.getState().execute([
    { type: 'moveProp', id: 'p-b2', positionMm: { x: position.x + 100, y: position.y } },
  ], '异步等待期间的新编辑')).toBe(true)
  return structuredClone(current())
}

beforeEach(async () => {
  vi.resetModules()
  vi.stubGlobal('indexedDB', new IDBFactory())
  vi.stubGlobal('IDBKeyRange', IDBKeyRange)
  storage = await import('../io/storage')
  store = await import('./store')
  // Capture only the connection for cleanup; risk simulations are installed after boot/save.
  const realLatest = storage.SceneRepository.prototype.latest
  const bootConnection = vi.spyOn(storage.SceneRepository.prototype, 'latest').mockImplementation(function (this: Repository) {
    repository = this
    return realLatest.call(this)
  })
  await store.bootEditor()
  await store.flushSave()
  bootConnection.mockRestore()
})

afterEach(async () => {
  vi.restoreAllMocks()
  await store?.flushSave().catch(() => {})
  repository?.close()
  const { default: Dexie } = await import('dexie')
  await Dexie.delete('sceneweave-m0')
  vi.unstubAllGlobals()
})

describe('editor asynchronous scene switching preserves new local work', () => {
  it('saves an independent copy but refuses to switch when editing continued during its write', async () => {
    const before = structuredClone(current())
    const entered = deferred(), release = deferred()
    const realSave = storage.SceneRepository.prototype.save
    let savedCopy: SceneDocument | undefined
    vi.spyOn(storage.SceneRepository.prototype, 'save').mockImplementation(async function (this: Repository, document, expected) {
      if (document.sceneId !== before.sceneId) {
        savedCopy = structuredClone(document)
        entered.resolve()
        await release.promise
      }
      return realSave.call(this, document, expected)
    })

    const copying = store.saveAsCopy()
    const rejected = expect(copying).rejects.toThrow('副本已保存')
    await entered.promise
    const edited = moveTable()
    release.resolve()
    await rejected
    expect(current()).toEqual(edited)
    expect(current().sceneId).toBe(before.sceneId)
    expect(current().revision).toBe(before.revision + 1)
    expect(current().props['p-b2'].positionMm.x).toBe(before.props['p-b2'].positionMm.x + 100)
    expect(savedCopy).toBeDefined()
    expect(savedCopy!.sceneId).not.toBe(before.sceneId)
    expect(await repository.load(savedCopy!.sceneId)).toEqual(savedCopy)
    await store.flushSave()
    expect(await repository.load(before.sceneId)).toEqual(edited)
  })

  it.each(['error', 'conflict'] as const)('refuses historical restore while current auto-save is in %s, retaining both current memory and prior persisted data', async status => {
    const historicalSnapshot = structuredClone(current())
    let lastPersisted = structuredClone(historicalSnapshot)
    if (status === 'conflict') {
      lastPersisted.revision += 1
      lastPersisted.notes['n-d4'].text = '另一个标签已经保存的主持人修改。'
      const external = new storage.SceneRepository()
      try { await external.save(lastPersisted, historicalSnapshot.revision) }
      finally { external.close() }
    }
    const realSave = storage.SceneRepository.prototype.save
    const save = vi.spyOn(storage.SceneRepository.prototype, 'save').mockImplementation(function (this: Repository, document, expected) {
      if (status === 'error' && document.sceneId === historicalSnapshot.sceneId) return Promise.reject(new Error('simulated storage write failure'))
      return realSave.call(this, document, expected)
    })
    const localBranch = moveTable()
    await expect(store.flushSave()).rejects.toThrow()
    expect(store.useEditorStore.getState().save.status).toBe(status)
    const attemptsBeforeRestore = save.mock.calls.length

    await expect(store.saveAsCopy(historicalSnapshot)).rejects.toThrow()
    expect(save.mock.calls).toHaveLength(attemptsBeforeRestore)
    expect(current()).toEqual(localBranch)
    expect(current().sceneId).toBe(historicalSnapshot.sceneId)
    expect(current().props['p-b2'].positionMm.x).toBe(historicalSnapshot.props['p-b2'].positionMm.x + 100)
    expect(await repository.load(historicalSnapshot.sceneId)).toEqual(lastPersisted)
    expect((await repository.latest())?.sceneId).toBe(historicalSnapshot.sceneId)
  })

  it('keeps current edits when opening a new document is still writing its isolated candidate', async () => {
    const { createHouse } = await import('../core/seed')
    const before = structuredClone(current())
    const candidate = createHouse()
    candidate.title = '等待写入的新场景'
    const entered = deferred(), release = deferred()
    const realSave = storage.SceneRepository.prototype.save
    vi.spyOn(storage.SceneRepository.prototype, 'save').mockImplementation(async function (this: Repository, document, expected) {
      if (document.sceneId === candidate.sceneId) { entered.resolve(); await release.promise }
      return realSave.call(this, document, expected)
    })

    const opening = store.openNewDocument(candidate)
    const rejected = expect(opening).rejects.toThrow('切换期间当前场景又有修改')
    await entered.promise
    const edited = moveTable()
    release.resolve()
    await rejected
    expect(current()).toEqual(edited)
    expect(current().sceneId).toBe(before.sceneId)
    expect(await repository.load(candidate.sceneId)).toEqual(candidate)
    await store.flushSave()
    expect(await repository.load(before.sceneId)).toEqual(edited)
  })

  it('keeps current edits when a delayed reload resolves with an older persisted snapshot', async () => {
    const before = structuredClone(current())
    const entered = deferred(), release = deferred()
    const realLoad = storage.SceneRepository.prototype.load
    const load = vi.spyOn(storage.SceneRepository.prototype, 'load').mockImplementationOnce(async function (this: Repository, sceneId) {
      const snapshot = await realLoad.call(this, sceneId)
      entered.resolve()
      await release.promise
      return snapshot
    })

    const reloading = store.reloadPersisted()
    const rejected = expect(reloading).rejects.toThrow('载入期间当前场景又有修改')
    await entered.promise
    const edited = moveTable()
    release.resolve()
    await rejected
    expect(current()).toEqual(edited)
    expect(current().sceneId).toBe(before.sceneId)
    expect(current().revision).toBe(before.revision + 1)
    load.mockRestore()
    await store.flushSave()
    expect(await repository.load(before.sceneId)).toEqual(edited)
  })
})
