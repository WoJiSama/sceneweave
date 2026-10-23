import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SceneRepositoryV3 } from '../v3/storage'
import { imageProject as imageV3 } from '../v3/test-fixtures'
import { migrateProjectV4ToV6 } from './migration'
import { migrateProjectV3ToV4 } from '../v4/migration'
import { SceneRepositoryV4 } from '../v4/storage'
import { imageProject as imageV4 } from '../v4/test-fixtures'
import { migrateProjectV5ToV6 } from './migration'
import { SceneRepositoryV5 } from '../v5/storage'
import { imageProject as imageV5 } from '../v5/test-fixtures'
import { exportHistoryArchiveV6, importHistoryArchiveV6, projectContentHashV6 } from './project-file'
import { ConflictErrorV6, HistoryConflictErrorV6, SceneRepositoryV6 } from './storage'
import { emptyProject, imageProject, namedSnapshot, outdoorProject, revision } from './test-fixtures'

const repositories: SceneRepositoryV6[] = [], databases = new Set<string>()
function repository(name = `history-${crypto.randomUUID()}`) { const repo = new SceneRepositoryV6(name); repositories.push(repo); databases.add(name); return repo }
const database = (repo: SceneRepositoryV6): Dexie => (repo as unknown as { db: Dexie }).db
beforeEach(() => { vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 1, height: 1, close: vi.fn() }))) })
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllGlobals(); for (const repo of repositories.splice(0)) repo.close(); for (const name of databases) await Dexie.delete(name); databases.clear() })

describe('independent history repository', () => {
  it('leaves the v5 database and named history intact after copying the project into v6', async () => {
    const oldName = `original-v5-history-${crypto.randomUUID()}`, old = new SceneRepositoryV5(oldName), source = await imageV5(); databases.add(oldName)
    try {
      await old.save(source, null)
      const named = await old.createNamedSnapshot(source, 'v5 source history'), before = structuredClone(await old.load(source.document.sceneId))!
      const repo = repository(), migrated = await migrateProjectV5ToV6(source, { sceneId: `copy-${crypto.randomUUID()}` })
      await repo.save(migrated, null)
      expect(await old.load(source.document.sceneId)).toEqual(before)
      expect(await old.loadNamedSnapshot(named.id)).toEqual(named)
      expect(await old.listSnapshots(source.document.sceneId)).toHaveLength(1)
      expect(await old.listNamedSnapshots(source.document.sceneId)).toEqual([{ ...named, project: undefined }].map(({ project: _project, ...summary }) => summary))
      expect(await repo.listNamedSnapshots(migrated.document.sceneId)).toEqual([])
      expect((await repo.load(migrated.document.sceneId))!.historyIdentity.outdoorTokens).toBeDefined()
    } finally { old.close() }
  })

  it('preserves the original v4 current, automatic and named history when making a composition copy', async () => {
    const oldName = `original-history-${crypto.randomUUID()}`, old = new SceneRepositoryV4(oldName), source = await imageV4(); databases.add(oldName)
    try {
      await old.save(source, null)
      const named = await old.createNamedSnapshot(source, 'v4 source history'), repo = repository()
      const migrated = await migrateProjectV4ToV6(source); await repo.save(migrated, null)
      expect((await old.load(source.document.sceneId))!.document).toEqual(source.document)
      expect((await old.loadNamedSnapshot(named.id))!.contentHash).toBe(named.contentHash)
      expect(await old.listSnapshots(source.document.sceneId)).toHaveLength(1)
      expect(await repo.listNamedSnapshots(migrated.document.sceneId)).toEqual([])
      expect((await repo.load(migrated.document.sceneId))!.appearance).toEqual(migrated.appearance)
    } finally { old.close() }
  })

  it('owns all ten tables in a separate database and refuses previous-version repository names', async () => {
    const repo = repository(); await repo.open()
    expect(database(repo).verno).toBe(1)
    expect(database(repo).tables.map(table => table.name).sort()).toEqual(['assetBlobs', 'historyMetadata', 'licenseTexts', 'migrationSources', 'namedResourceBindings', 'namedSnapshots', 'protectionSnapshots', 'resourceBindings', 'scenes', 'snapshots'])
    for (const name of ['sceneweave-m0', 'sceneweave-m1', 'sceneweave-m1-layers', 'sceneweave-m1-history', 'sceneweave-m1-composition']) expect(() => new SceneRepositoryV6(name)).toThrow('原件')
  })

  it('reopens a persisted outdoor project and enforces scene, metadata and source snapshot CAS', async () => {
    const name = `outdoor-reopen-${crypto.randomUUID()}`, repo = repository(name), initial = await outdoorProject()
    await repo.save(initial, null)
    const named = await repo.createNamedSnapshot(initial, '地形原稿', { expectedRevision: 0, expectedMetadataVersion: 0 })
    const current = structuredClone(initial)
    current.document.revision = 1; current.document.terrainAreas.domain.groundElevationMm = 250
    await repo.save(current, 0)
    const protection = await repo.createNamedSnapshot(current, '恢复前保护', { kind: 'protection', expectedRevision: 1,
      expectedMetadataVersion: 1, sourceSnapshot: { id: named.id, contentHash: named.contentHash } })

    const reopened = repository(name), loaded = (await reopened.load(initial.document.sceneId))!
    expect(loaded.document.terrainAreas.domain.groundElevationMm).toBe(250)
    expect(loaded.historyIdentity).toEqual(current.historyIdentity)
    expect((await reopened.loadNamedSnapshot(named.id))!.project.document.terrainAreas.domain.groundElevationMm).toBe(0)
    expect((await reopened.loadNamedSnapshot(protection.id))!.project.document.terrainAreas.domain.groundElevationMm).toBe(250)
    expect(await reopened.usage(initial.document.sceneId)).toMatchObject({ metadataVersion: 2, namedCount: 1, protectionCount: 1 })
    await expect(repo.createNamedSnapshot(initial, 'stale revision', { expectedRevision: 0 })).rejects.toBeInstanceOf(ConflictErrorV6)
    await expect(repo.createNamedSnapshot(current, 'stale metadata', { expectedRevision: 1, expectedMetadataVersion: 1 })).rejects.toBeInstanceOf(HistoryConflictErrorV6)
    await expect(repo.createNamedSnapshot(current, 'stale source', { kind: 'protection', expectedRevision: 1, expectedMetadataVersion: 2,
      sourceSnapshot: { id: named.id, contentHash: 'f'.repeat(64) } })).rejects.toThrow(/hash/)
    expect(await reopened.usage(initial.document.sceneId)).toMatchObject({ metadataVersion: 2, protectionCount: 1 })
  })

  it('captures full content before awaiting and never decodes images inside read or write transactions', async () => {
    const repo = repository(), input = await imageProject(), before = structuredClone(input), active: unknown[] = []
    vi.stubGlobal('createImageBitmap', vi.fn(async () => { active.push(Dexie.currentTransaction); return { width: 1, height: 1, close: vi.fn() } }))
    const saving = repo.save(input, null)
    input.document.title = 'caller mutation'; input.historyIdentity.lineageId = 'caller mutation'
    await saving
    const loaded = (await repo.load(before.document.sceneId))!
    expect(loaded.document).toEqual(before.document); expect(loaded.historyIdentity).toEqual(before.historyIdentity)
    const snapshot = await repo.createNamedSnapshot(loaded, '捕获原稿')
    loaded.document.title = 'mutated after snapshot'
    expect((await repo.loadNamedSnapshot(snapshot.id))!.project.document).toEqual(before.document)
    expect(active.length).toBeGreaterThan(2); expect(active.every(value => !value)).toBe(true)
  })

  it('rolls automatic history to twenty while retaining named/protection snapshots and their exact resources', async () => {
    const repo = repository(), initial = await imageProject(); await repo.save(initial, null)
    const named = await repo.createNamedSnapshot(initial, '永久保留'), protection = await repo.createNamedSnapshot(initial, '恢复前', { kind: 'protection' })
    for (let value = 1; value <= 23; value++) await repo.save(revision(initial, value), value - 1)
    expect((await repo.listSnapshots(initial.document.sceneId)).map(value => value.revision)).toEqual(Array.from({ length: 20 }, (_, index) => 23 - index))
    expect(await repo.loadSnapshot(initial.document.sceneId, 0)).toBeNull()
    for (const snapshot of [named, protection]) {
      const loaded = (await repo.loadNamedSnapshot(snapshot.id))!
      expect(loaded.contentHash).toBe(snapshot.contentHash); expect(loaded.project.document).toEqual(initial.document)
      const hash = Object.keys(initial.assets)[0]
      expect(await loaded.project.assets[hash].blob.arrayBuffer()).toEqual(await initial.assets[hash].blob.arrayBuffer())
    }
    expect(await database(repo).table('resourceBindings').count()).toBe(20)
    expect(await database(repo).table('namedResourceBindings').count()).toBe(2)
    expect(await database(repo).table('assetBlobs').count()).toBe(1)
  }, 20_000)

  it('serializes revision CAS across connections and rejects same-revision content substitutions', async () => {
    const name = `history-cas-${crypto.randomUUID()}`, first = repository(name), second = repository(name), initial = emptyProject()
    await first.save(initial, null)
    const outcomes = await Promise.allSettled([first.save(revision(initial, 1), 0), second.save(revision(initial, 2), 0)])
    expect(outcomes.filter(value => value.status === 'fulfilled')).toHaveLength(1)
    expect((outcomes.find(value => value.status === 'rejected') as PromiseRejectedResult).reason).toBeInstanceOf(ConflictErrorV6)
    const current = (await first.load(initial.document.sceneId))!, changed = structuredClone(current); changed.document.title = 'same revision different content'
    await expect(second.createNamedSnapshot(changed, 'stale content')).rejects.toThrow('完整工程内容')
    await expect(second.projectCAS(initial)).rejects.toBeInstanceOf(ConflictErrorV6)
    expect(await first.listNamedSnapshots(initial.document.sceneId)).toEqual([])
  })

  it('rejects fixed source replacement atomically even when the changed effective scene is valid', async () => {
    const repo = repository(), initial = emptyProject(); await repo.save(initial, null)
    const next = revision(initial, 1), propId = Object.keys(next.document.props)[0], source = next.appearance.sources[next.appearance.propSources[propId]]
    if (source.kind !== 'prop') throw new Error('Fixture needs a prop source')
    source.snapshot.appearance.opacity = .25
    for (const [id, sourceId] of Object.entries(next.appearance.propSources)) if (sourceId === source.id) next.document.props[id].appearance.opacity = .25
    await expect(repo.save(next, 0)).rejects.toThrow('固定来源或定义身份冲突')
    expect((await repo.load(initial.document.sceneId))!.appearance).toEqual(initial.appearance)
    expect(await repo.listSnapshots(initial.document.sceneId)).toHaveLength(1)
  })

  it('uses metadata CAS for create, rename and delete without changing immutable content hashes', async () => {
    const repo = repository(), initial = emptyProject(); await repo.save(initial, null)
    const named = await repo.createNamedSnapshot(initial, '原名', { expectedMetadataVersion: 0 })
    expect((await repo.usage(initial.document.sceneId)).metadataVersion).toBe(1)
    await expect(repo.createNamedSnapshot(initial, '旧列表', { expectedMetadataVersion: 0 })).rejects.toBeInstanceOf(HistoryConflictErrorV6)
    await repo.renameNamedSnapshot(named.id, ' 新名称 ', named.contentHash, 1)
    const renamed = (await repo.loadNamedSnapshot(named.id))!
    expect(renamed.name).toBe('新名称'); expect(renamed.contentHash).toBe(named.contentHash); expect(renamed.project).toEqual(named.project)
    await expect(repo.deleteNamedSnapshot(named.id, named.contentHash, 1)).rejects.toBeInstanceOf(HistoryConflictErrorV6)
    await repo.deleteNamedSnapshot(named.id, named.contentHash, 2)
    expect(await repo.loadNamedSnapshot(named.id)).toBeNull(); expect((await repo.usage(initial.document.sceneId)).metadataVersion).toBe(3)
  })

  it('rechecks the source snapshot inside protection creation and refuses deleted or corrupted sources', async () => {
    const repo = repository(), initial = emptyProject(); await repo.save(initial, null)
    const source = await repo.createNamedSnapshot(initial, 'restore source')
    await repo.deleteNamedSnapshot(source.id, source.contentHash)
    await expect(repo.createNamedSnapshot(initial, 'deleted source', { kind: 'protection', sourceSnapshot: source })).rejects.toThrow('源快照已删除')
    const second = await repo.createNamedSnapshot(initial, 'another source')
    await database(repo).table('namedSnapshots').update([initial.document.sceneId, second.id], { document: { ...second.project.document, title: 'corrupted content' } })
    await expect(repo.createNamedSnapshot(initial, 'corrupt source', { kind: 'protection', sourceSnapshot: second })).rejects.toThrow('源快照内容 hash 损坏')
    expect((await repo.usage(initial.document.sceneId)).protectionCount).toBe(0)
  })

  it('keeps named and protection limits independent and rolls the thirty-third named write back', async () => {
    const repo = repository(), initial = emptyProject(); await repo.save(initial, null)
    for (let index = 0; index < 32; index++) await repo.createNamedSnapshot(initial, `named-${index}`)
    const usage = await repo.usage(initial.document.sceneId)
    await expect(repo.createNamedSnapshot(initial, 'over limit')).rejects.toThrow('保留上限')
    expect(await repo.usage(initial.document.sceneId)).toEqual(usage)
    const protection = await repo.createNamedSnapshot(initial, 'independent protection', { kind: 'protection' })
    await expect(repo.renameNamedSnapshot(protection.id, 'forbidden', protection.contentHash)).rejects.toThrow('不能重命名')
    expect(await repo.usage(initial.document.sceneId)).toMatchObject({ namedCount: 32, protectionCount: 1, metadataVersion: 33 })
    expect(await database(repo).table('namedResourceBindings').count()).toBe(33)
  }, 20_000)

  it('rolls back new resources, originals and every history table when a final initial save write fails', async () => {
    const repo = repository(), candidate = await migrateProjectV4ToV6(await migrateProjectV3ToV4(await imageV3())); await repo.open()
    vi.spyOn(database(repo).table('snapshots'), 'add').mockRejectedValueOnce(new DOMException('simulated quota', 'QuotaExceededError'))
    await expect(repo.save(candidate, null)).rejects.toThrow('simulated quota')
    for (const table of database(repo).tables) expect(await table.count()).toBe(0)
  })

  it('rolls back named records, bindings and metadata if their last write fails', async () => {
    const repo = repository(), initial = await imageProject(); await repo.save(initial, null)
    const before = await repo.usage(initial.document.sceneId)
    vi.spyOn(database(repo).table('historyMetadata'), 'put').mockRejectedValueOnce(new DOMException('simulated metadata quota', 'QuotaExceededError'))
    await expect(repo.createNamedSnapshot(initial, 'must not exist')).rejects.toThrow('simulated metadata quota')
    expect(await repo.listNamedSnapshots(initial.document.sceneId)).toEqual([])
    expect(await database(repo).table('namedResourceBindings').count()).toBe(0)
    expect(await repo.usage(initial.document.sceneId)).toEqual(before)
    expect((await repo.load(initial.document.sceneId))!.document).toEqual(initial.document)
  })

  it('retains exact provenance when omitted on later saves and refuses replacement or loss', async () => {
    const repo = repository(), initial = await migrateProjectV4ToV6(await migrateProjectV3ToV4(await imageV3())); await repo.save(initial, null)
    const next = revision(initial, 1); delete next.migrationSource; await repo.save(next, 0)
    const loaded = (await repo.load(initial.document.sceneId))!, named = await repo.createNamedSnapshot(loaded, 'with original')
    for (const value of [loaded, (await repo.loadNamedSnapshot(named.id))!.project, (await repo.loadSnapshot(initial.document.sceneId, 0))!]) {
      expect(value.migrationSource!.sourceHash).toBe(initial.migrationSource!.sourceHash)
      expect(await value.migrationSource!.original.arrayBuffer()).toEqual(await initial.migrationSource!.original.arrayBuffer())
    }
    const replacement = revision(initial, 2); replacement.migrationSource!.migratorVersion = 'replacement'
    await expect(repo.save(replacement, 1)).rejects.toThrow('不可被后续保存替换')
    await database(repo).table('migrationSources').delete(initial.document.sceneId)
    await expect(repo.load(initial.document.sceneId)).rejects.toThrow('原件缺失')
    await expect(repo.save(revision(next, 2), 1)).rejects.toThrow('原件缺失')
    expect((await database(repo).table('scenes').get(initial.document.sceneId)).revision).toBe(1)
  })

  it('exports only selected fixed snapshots and imports a separate branch without rewriting historical content', async () => {
    const repo = repository(), initial = await imageProject(); await repo.save(initial, null)
    const named = await repo.createNamedSnapshot(initial, 'selected'), omitted = await repo.createNamedSnapshot(initial, 'omit')
    await repo.save(revision(initial, 1), 0)
    const archive = await repo.exportArchive(initial.document.sceneId, [named.id])
    expect(archive.snapshots.map(value => value.id)).toEqual([named.id])
    expect((await repo.exportArchive(initial.document.sceneId, [])).snapshots).toEqual([])
    expect((await repo.exportArchive(initial.document.sceneId)).snapshots).toEqual([])
    await expect(repo.exportArchive(initial.document.sceneId, [named.id, named.id])).rejects.toThrow('重复')
    await expect(repo.exportArchive(initial.document.sceneId, ['missing'])).rejects.toThrow('所选快照已删除')
    const imported = await repo.importArchive(await importHistoryArchiveV6(await exportHistoryArchiveV6(archive)))
    expect(imported.project.document.sceneId).not.toBe(initial.document.sceneId); expect(imported.project.document.revision).toBe(0)
    const historic = (await repo.loadNamedSnapshot(named.id, imported.project.document.sceneId))!
    expect(historic.project.document).toEqual(initial.document); expect(historic.contentHash).toBe(named.contentHash)
    expect(await projectContentHashV6(historic.project)).toBe(named.contentHash)
    expect((await repo.load(initial.document.sceneId))!.document.revision).toBe(1)
    expect(await repo.loadNamedSnapshot(omitted.id, imported.project.document.sceneId)).toBeNull()
    await expect(repo.loadNamedSnapshot(named.id)).rejects.toThrow('显式指定所属工程')
  })

  it('rolls the whole imported branch back on a snapshot binding failure', async () => {
    const repo = repository(), initial = await imageProject(), snapshot = await namedSnapshot(initial); await repo.open()
    vi.spyOn(database(repo).table('namedResourceBindings'), 'add').mockRejectedValueOnce(new DOMException('import quota', 'QuotaExceededError'))
    await expect(repo.importArchive({ project: initial, snapshots: [snapshot] })).rejects.toThrow('import quota')
    for (const table of database(repo).tables) expect(await table.count()).toBe(0)
  })

  it('rejects misfiled snapshot kinds rather than deleting bindings from an inconsistent record', async () => {
    const repo = repository(), initial = emptyProject(); await repo.save(initial, null)
    const snapshot = await repo.createNamedSnapshot(initial, 'named')
    await database(repo).table('namedSnapshots').update([initial.document.sceneId, snapshot.id], { kind: 'protection' })
    await expect(repo.listNamedSnapshots(initial.document.sceneId)).rejects.toThrow('类型')
    await expect(repo.deleteNamedSnapshot(snapshot.id, snapshot.contentHash)).rejects.toThrow('类型')
    expect(await database(repo).table('namedSnapshots').count()).toBe(1); expect(await database(repo).table('namedResourceBindings').count()).toBe(1)
  })

  it('rejects unknown database schemas and cancelled writes while preserving the original v3 database', async () => {
    const oldName = `original-layers-${crypto.randomUUID()}`, old = new SceneRepositoryV3(oldName), initial = await imageV3(); databases.add(oldName)
    try {
      await old.save(initial, null)
      const repo = repository(), migrated = await migrateProjectV4ToV6(await migrateProjectV3ToV4(initial)); await repo.save(migrated, null)
      expect((await old.load(initial.document.sceneId))!.document).toEqual(initial.document)
      expect(await old.listSnapshots(initial.document.sceneId)).toHaveLength(1)
    } finally { old.close() }
    const futureName = `future-history-${crypto.randomUUID()}`, future = new Dexie(futureName); databases.add(futureName)
    future.version(2).stores({ marker: 'id' }); await future.open(); await future.table('marker').put({ id: 'retained' }); future.close()
    await expect(repository(futureName).open()).rejects.toThrow('结构版本')
    await future.open(); expect(await future.table('marker').get('retained')).toEqual({ id: 'retained' }); future.close()
    const cancelled = repository(), controller = new AbortController(); controller.abort()
    await expect(cancelled.save(emptyProject(), null, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(database(cancelled).isOpen()).toBe(false)
  })
})
