import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHouse } from '../core/seed'
import { cloneScene, type SceneDocument } from '../core/types'
import { ConflictError, SaveCoordinator, SceneRepository, type SaveState } from './storage'

const repositories: SceneRepository[] = []
const databases: string[] = []
function repository(name = `test-${crypto.randomUUID()}`): SceneRepository {
  const repo = new SceneRepository(name)
  repositories.push(repo)
  if (!databases.includes(name)) databases.push(name)
  return repo
}
function atRevision(scene: SceneDocument, revision: number): SceneDocument {
  return { ...cloneScene(scene), revision, title: `雾灯宅 ${revision}` }
}
function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
afterEach(async () => {
  vi.restoreAllMocks()
  for (const repo of repositories.splice(0)) repo.close()
  for (const name of databases.splice(0)) await Dexie.delete(name)
})

describe('SceneRepository atomic persistence', () => {
  it('stores and reopens the full document, including secret metadata', async () => {
    const repo = repository()
    const scene = createHouse()
    await repo.save(scene, null)
    expect(await repo.load(scene.sceneId)).toEqual(scene)
    expect(await repo.latest()).toEqual(scene)
    expect(await repo.listSnapshots(scene.sceneId)).toEqual([scene])
    expect(await repo.load('missing')).toBeNull()
  })

  it('allows coalesced revisions but refuses same or older revisions', async () => {
    const repo = repository()
    const scene = createHouse()
    await repo.save(scene, null)
    await repo.save(atRevision(scene, 3), 0)
    await expect(repo.save(atRevision(scene, 2), 3)).rejects.toMatchObject({ name: 'ConflictError', currentRevision: 3 })
    await expect(repo.save(atRevision(scene, 3), 3)).rejects.toBeInstanceOf(ConflictError)
    expect((await repo.load(scene.sceneId))?.revision).toBe(3)
  })

  it('performs the version comparison and write in the same transaction across two connections', async () => {
    const name = `test-${crypto.randomUUID()}`
    const first = repository(name), second = repository(name)
    const scene = createHouse()
    await first.save(scene, null)
    const results = await Promise.allSettled([first.save(atRevision(scene, 1), 0), second.save(atRevision(scene, 2), 0)])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    const failed = results.find(result => result.status === 'rejected') as PromiseRejectedResult
    expect(failed.reason).toBeInstanceOf(ConflictError)
    expect((await first.listSnapshots(scene.sceneId))).toHaveLength(2)
    expect((await second.load(scene.sceneId))?.revision).toBe(failed.reason.currentRevision)
  })

  it('rolls back the document when snapshot insertion fails', async () => {
    const repo = repository()
    const scene = createHouse()
    await repo.save(scene, null)
    const internal = repo as unknown as { snapshots: { add: (...args: unknown[]) => Promise<unknown> } }
    vi.spyOn(internal.snapshots, 'add').mockRejectedValueOnce(new Error('simulated quota'))
    await expect(repo.save(atRevision(scene, 1), 0)).rejects.toThrow('simulated quota')
    expect(await repo.load(scene.sceneId)).toEqual(scene)
    expect(await repo.listSnapshots(scene.sceneId)).toEqual([scene])
  })

  it('keeps the 20 newest successful snapshots in descending revision order', async () => {
    const repo = repository()
    const scene = createHouse()
    for (let revision = 0; revision < 25; revision++) await repo.save(atRevision(scene, revision), revision === 0 ? null : revision - 1)
    expect((await repo.listSnapshots(scene.sceneId)).map(snapshot => snapshot.revision)).toEqual(Array.from({ length: 20 }, (_, index) => 24 - index))
  })

  it('does not retain mutable document references', async () => {
    const repo = repository()
    const scene = createHouse()
    const savedTitle = scene.title
    const saving = repo.save(scene, null)
    scene.title = 'mutated after enqueue'
    await saving
    const loaded = await repo.load(scene.sceneId)
    loaded!.title = 'mutated after load'
    expect((await repo.load(scene.sceneId))?.title).toBe(savedTitle)
  })

  it('chooses the last saved scene even when the clock does not advance', async () => {
    const repo = repository()
    vi.spyOn(Date, 'now').mockReturnValue(1000)
    const first = createHouse('z-first'), second = createHouse('a-second')
    await repo.save(first, null)
    await repo.save(second, null)
    expect((await repo.latest())?.sceneId).toBe(second.sceneId)
    await repo.save(atRevision(first, 1), 0)
    expect((await repo.latest())?.sceneId).toBe(first.sceneId)
  })
})

describe('SaveCoordinator', () => {
  it('coalesces not-yet-started versions and reports saved only after commit', async () => {
    const repo = repository()
    const save = vi.spyOn(repo, 'save')
    const scene = createHouse()
    const states: SaveState[] = []
    const coordinator = new SaveCoordinator(repo, scene, null, state => states.push(state))
    coordinator.enqueue(atRevision(scene, 1))
    coordinator.enqueue(atRevision(scene, 2))
    coordinator.enqueue(atRevision(scene, 3))
    expect(states.at(-1)?.status).toBe('unsaved')
    await coordinator.flush()
    expect(save).toHaveBeenCalledTimes(1)
    expect(save.mock.calls[0][0].revision).toBe(3)
    expect(states.at(-1)).toEqual({ status: 'saved', persistedRevision: 3 })
  })

  it('serialises in-flight saves and uses the completed revision as the next CAS baseline', async () => {
    const repo = repository()
    const gate = deferred<void>()
    const realSave = repo.save.bind(repo)
    const save = vi.spyOn(repo, 'save').mockImplementationOnce(async (...args) => { await gate.promise; await realSave(...args) })
    const scene = createHouse()
    const coordinator = new SaveCoordinator(repo, scene, null, () => {})
    await Promise.resolve()
    coordinator.enqueue(atRevision(scene, 1))
    coordinator.enqueue(atRevision(scene, 2))
    expect(save).toHaveBeenCalledTimes(1)
    gate.resolve()
    await coordinator.flush()
    expect(save.mock.calls.map(([document, expected]) => [document.revision, expected])).toEqual([[0, null], [2, 0]])
  })

  it('starts a loaded persisted document as saved without another write', async () => {
    const repo = repository()
    const scene = createHouse()
    await repo.save(scene, null)
    const save = vi.spyOn(repo, 'save')
    const states: SaveState[] = []
    const coordinator = new SaveCoordinator(repo, scene, 0, state => states.push(state))
    await coordinator.flush()
    expect(save).not.toHaveBeenCalled()
    expect(states).toEqual([{ status: 'saved', persistedRevision: 0 }])
  })

  it('preserves the newest queued document on write failure and retries it explicitly', async () => {
    const repo = repository()
    const scene = createHouse()
    await repo.save(scene, null)
    const save = vi.spyOn(repo, 'save').mockRejectedValueOnce(new Error('storage quota'))
    const states: SaveState[] = []
    const coordinator = new SaveCoordinator(repo, scene, 0, state => states.push(state))
    coordinator.enqueue(atRevision(scene, 1))
    await expect(coordinator.flush()).rejects.toThrow('storage quota')
    coordinator.enqueue(atRevision(scene, 2))
    await expect(coordinator.flush()).rejects.toThrow('storage quota')
    expect(save).toHaveBeenCalledTimes(1)
    expect((await repo.load(scene.sceneId))?.revision).toBe(0)
    coordinator.retry()
    await coordinator.flush()
    expect((await repo.load(scene.sceneId))?.revision).toBe(2)
    expect(states.at(-1)).toEqual({ status: 'saved', persistedRevision: 2 })
  })

  it('freezes conflict writes even when enqueue or retry is called', async () => {
    const repo = repository()
    const scene = createHouse()
    await repo.save(scene, null)
    const states: SaveState[] = []
    const coordinator = new SaveCoordinator(repo, scene, 0, state => states.push(state))
    await repo.save(atRevision(scene, 1), 0)
    const save = vi.spyOn(repo, 'save')
    coordinator.enqueue(atRevision(scene, 2))
    await expect(coordinator.flush()).rejects.toBeInstanceOf(ConflictError)
    coordinator.enqueue(atRevision(scene, 3))
    coordinator.retry()
    await expect(coordinator.flush()).rejects.toBeInstanceOf(ConflictError)
    expect(save).toHaveBeenCalledTimes(1)
    expect((await repo.load(scene.sceneId))?.revision).toBe(1)
    expect(states.at(-1)?.status).toBe('conflict')
  })

  it('lets the in-flight atomic save finish while stop cancels queued work', async () => {
    const repo = repository()
    const gate = deferred<void>()
    const realSave = repo.save.bind(repo)
    const save = vi.spyOn(repo, 'save').mockImplementationOnce(async (...args) => { await gate.promise; await realSave(...args) })
    const scene = createHouse()
    const coordinator = new SaveCoordinator(repo, scene, null, () => {})
    await Promise.resolve()
    coordinator.enqueue(atRevision(scene, 1))
    coordinator.stop()
    coordinator.enqueue(atRevision(scene, 2))
    gate.resolve()
    await coordinator.flush()
    expect(save).toHaveBeenCalledTimes(1)
    expect((await repo.load(scene.sceneId))?.revision).toBe(0)
  })

  it('refuses a revision regression or a switch of scene IDs', async () => {
    const repo = repository()
    const scene = createHouse()
    const coordinator = new SaveCoordinator(repo, atRevision(scene, 2), 2, () => {})
    expect(() => coordinator.enqueue(scene)).toThrow('revision')
    expect(() => coordinator.enqueue({ ...scene, sceneId: 'other', revision: 3 })).toThrow('ID')
  })
})
