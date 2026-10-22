import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SceneRepositoryV2 } from '../v2/storage'
import { imageProject as imageV2 } from '../v2/test-fixtures'
import { createLayerProject } from './migration'
import { ConflictErrorV3, SceneRepositoryV3 } from './storage'
import { emptyProject, imageProject } from './test-fixtures'
import type { CompleteProjectV3 } from './types'

const repositories: SceneRepositoryV3[] = [], databases = new Set<string>()
function repository(name = `layers-${crypto.randomUUID()}`) { const repo = new SceneRepositoryV3(name); repositories.push(repo); databases.add(name); return repo }
const database = (repo: SceneRepositoryV3): Dexie => (repo as unknown as { db: Dexie }).db
function revision(project: CompleteProjectV3, value: number) { const copy = structuredClone(project); copy.document.revision = value; copy.document.title = `Layer revision ${value}`; return copy }
beforeEach(() => { vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 1, height: 1, close: vi.fn() }))) })
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllGlobals(); for (const repo of repositories.splice(0)) repo.close(); for (const name of databases) await Dexie.delete(name); databases.clear() })

describe('independent strict v3 layer repository', () => {
  it('owns the independent six-table v1 database and refuses original repository names', async () => {
    const repo = repository(); await repo.open()
    expect(database(repo).verno).toBe(1); expect(database(repo).tables.map(value => value.name).sort()).toEqual(['assetBlobs', 'licenseTexts', 'migrationSources', 'resourceBindings', 'scenes', 'snapshots'])
    expect(() => new SceneRepositoryV3('sceneweave-m0')).toThrow('原件'); expect(() => new SceneRepositoryV3('sceneweave-m1')).toThrow('原件')
  })

  it('captures full resources/layers before awaits, decodes outside transactions and preserves saved reads', async () => {
    const repo = repository(), input = await imageProject(), before = structuredClone(input), active: unknown[] = []
    vi.stubGlobal('createImageBitmap', vi.fn(async () => { active.push(Dexie.currentTransaction); return { width: 1, height: 1, close: vi.fn() } }))
    const saving = repo.save(input, null); input.document.userLayers[Object.keys(input.document.userLayers)[0]].name = 'caller changed during save'; await saving
    const loaded = (await repo.load(input.document.sceneId))!
    expect(loaded.document).toEqual(before.document); expect(loaded.licenseBindings).toEqual(before.licenseBindings)
    const hash = Object.keys(before.assets)[0]; expect(await loaded.assets[hash].blob.arrayBuffer()).toEqual(await before.assets[hash].blob.arrayBuffer())
    loaded.document.title = 'caller changed after load'; expect((await repo.load(input.document.sceneId))!.document.title).toBe(before.document.title)
    expect(active.length).toBeGreaterThanOrEqual(3); expect(active.every(value => !value)).toBe(true)
  })

  it('CAS protects both connections, refuses regression and keeps the latest 20 revision/resource bindings', async () => {
    const name = `layers-cas-${crypto.randomUUID()}`, first = repository(name), second = repository(name), initial = await imageProject()
    await first.save(initial, null)
    const outcomes = await Promise.allSettled([first.save(revision(initial, 1), 0), second.save(revision(initial, 2), 0)])
    expect(outcomes.filter(value => value.status === 'fulfilled')).toHaveLength(1)
    expect((outcomes.find(value => value.status === 'rejected') as PromiseRejectedResult).reason).toBeInstanceOf(ConflictErrorV3)
    let current = (await first.load(initial.document.sceneId))!.document.revision
    await expect(second.save(revision(initial, current), current)).rejects.toBeInstanceOf(ConflictErrorV3)
    for (let i = 0; i < 22; i++) { await first.save(revision(initial, current + 1), current); current++ }
    expect((await first.listSnapshots(initial.document.sceneId)).map(value => value.revision)).toEqual(Array.from({ length: 20 }, (_, i) => current - i))
    expect(await first.loadSnapshot(initial.document.sceneId, 0)).toBeNull(); expect(await database(first).table('resourceBindings').count()).toBe(20)
    expect(await database(first).table('assetBlobs').count()).toBe(1)
  })

  it('rolls back resources, layers, provenance and history together when the final write fails', async () => {
    const repo = repository(), candidate = await createLayerProject(await imageV2()); await repo.open()
    vi.spyOn(database(repo).table('snapshots'), 'add').mockRejectedValueOnce(new DOMException('simulated quota', 'QuotaExceededError'))
    await expect(repo.save(candidate, null)).rejects.toThrow('simulated quota')
    for (const table of database(repo).tables) expect(await table.count()).toBe(0)
  })

  it('retains exact originals across saves/snapshots and rejects later provenance replacement', async () => {
    const repo = repository(), candidate = await createLayerProject(await imageV2())
    await repo.save(candidate, null); const next = revision(candidate, 1); delete next.migrationSource; await repo.save(next, 0)
    for (const loaded of [(await repo.load(candidate.document.sceneId))!, (await repo.loadSnapshot(candidate.document.sceneId, 0))!]) {
      expect(loaded.migrationSource!.sourceHash).toBe(candidate.migrationSource!.sourceHash)
      expect(await loaded.migrationSource!.original.arrayBuffer()).toEqual(await candidate.migrationSource!.original.arrayBuffer())
    }
    const replaced = revision(candidate, 2); replaced.migrationSource!.migratorVersion = 'replacement'
    await expect(repo.save(replaced, 1)).rejects.toThrow('迁移来源不可')
    expect((await repo.load(candidate.document.sceneId))!.document.revision).toBe(1)
  })

  it('rejects corrupted retained provenance even when a later save omits the local source field', async () => {
    const repo = repository(), candidate = await createLayerProject(await imageV2()); await repo.save(candidate, null)
    await database(repo).table('migrationSources').update(candidate.document.sceneId, { sourceRevision: 999 })
    const next = revision(candidate, 1); delete next.migrationSource
    await expect(repo.save(next, 0)).rejects.toThrow('完整原件不匹配')
    expect((await database(repo).table('scenes').get(candidate.document.sceneId)).revision).toBe(0)
    expect(await database(repo).table('snapshots').count()).toBe(1)
  })

  it('detects a missing local original on both read and save instead of silently losing migration history', async () => {
    const repo = repository(), candidate = await createLayerProject(await imageV2()); await repo.save(candidate, null)
    await database(repo).table('migrationSources').delete(candidate.document.sceneId)
    await expect(repo.load(candidate.document.sceneId)).rejects.toThrow('迁移原件缺失')
    await expect(repo.loadSnapshot(candidate.document.sceneId, 0)).rejects.toThrow('迁移原件缺失')
    const next = revision(candidate, 1); delete next.migrationSource
    await expect(repo.save(next, 0)).rejects.toThrow('迁移原件缺失')
    expect((await database(repo).table('scenes').get(candidate.document.sceneId)).revision).toBe(0)
  })

  it('rejects corrupt existing resource and unknown document/database schemas without replacing records', async () => {
    const repo = repository(), initial = await imageProject(); await repo.save(initial, null)
    const hash = Object.keys(initial.assets)[0], asset = initial.assets[hash]
    await database(repo).table('assetBlobs').put({ ...asset, blob: new Blob([new Uint8Array(asset.sizeBytes)], { type: asset.mimeType }) })
    await expect(repo.save(revision(initial, 1), 0)).rejects.toThrow('已有字节'); await expect(repo.load(initial.document.sceneId)).rejects.toThrow()
    await database(repo).table('assetBlobs').put(asset)
    await database(repo).table('scenes').update(initial.document.sceneId, { documentSchemaVersion: 4 })
    await expect(repo.save(revision(initial, 1), 0)).rejects.toThrow('文档版本'); await expect(repo.load(initial.document.sceneId)).rejects.toThrow('文档版本')
    const futureName = `future-layers-${crypto.randomUUID()}`, future = new Dexie(futureName); databases.add(futureName)
    future.version(2).stores({ marker: 'id' }); await future.open(); await future.table('marker').put({ id: 'retained' }); future.close()
    await expect(repository(futureName).open()).rejects.toThrow('结构版本')
    await future.open(); expect(await future.table('marker').get('retained')).toEqual({ id: 'retained' }); future.close()
  })

  it('preserves the separate v2 database and its original history during migration', async () => {
    const originalName = `original-v2-${crypto.randomUUID()}`, originalRepo = new SceneRepositoryV2(originalName), original = await imageV2(); databases.add(originalName)
    try {
      await originalRepo.save(original, null)
      const repo = repository(), migrated = await createLayerProject(original); await repo.save(migrated, null)
      expect((await originalRepo.load(original.document.sceneId))!.document).toEqual(original.document)
      expect(await originalRepo.listSnapshots(original.document.sceneId)).toHaveLength(1)
      expect((await repo.load(migrated.document.sceneId))!.document.schemaVersion).toBe(3)
    } finally { originalRepo.close() }
  })

  it('rejects aborted candidates before opening the database', async () => {
    const repo = repository(), controller = new AbortController(); controller.abort()
    await expect(repo.save(emptyProject(), null, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(database(repo).isOpen()).toBe(false)
  })
})
