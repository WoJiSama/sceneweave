import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fixture, runtime, validation } from '../../../application/workspace/test-fixtures.js'
import type { ProjectData, SnapshotSummary } from '../../../shared/model/project.js'
import { canonicalJson, cloneJson, encodeUtf8 } from '../../../shared/validation/json.js'
import { sha256Bytes } from '../../../shared/project/binary.js'
import { projectContentHash } from '../../../shared/project/validate.js'
import { projectResourceRecords, projectSourceRecords } from '../../../shared/project/source-resources.js'
import { PROJECT_STORES_V2, type BindingKind, type StoredProject } from './database.js'
import { ProjectRepository } from './repository.js'

const connections: Dexie[] = [], repos: ProjectRepository[] = [], names = new Set<string>()
const NOW = '2026-10-30T01:00:00.000Z'
async function source(image = false) {
  const name = `history-copy-${crypto.randomUUID()}`, old = new Dexie(name)
  names.add(name); connections.push(old); old.version(2).stores(PROJECT_STORES_V2); await old.open()
  const bundle = fixture({ image }), base = bundle.project, owner = base.document.sceneId
  const row = (revision: number): StoredProject => {
    const project = cloneJson(base); project.document.revision = revision; project.document.props.item.rotationDeg = revision * 20
    return { sceneId: owner, revision, savedAt: NOW, contentHash: projectContentHash(project), status: 'ready', conversionJobId: null, project }
  }
  const rows = [row(0), row(1), row(2)], current = rows[2]
  const binding = (project: ProjectData, kind: BindingKind, recordId: string) => ({ ownerSceneId: owner, kind, recordId,
    assetHashes: Object.keys(project.assets).sort(), sourceHashes: [...projectSourceRecords(project).keys()].sort(),
    licenseHashes: Object.keys(project.licenses).sort(), licenseBindings: project.licenseBindings })
  await old.table('projects').add(current)
  await old.table('historyMetadata').add({ ownerSceneId: owner, metadataVersion: 2 })
  await old.table('resourceBindings').add(binding(current.project, 'current', 'current'))
  for (const row of rows) {
    await old.table('automaticSnapshots').add({ ownerSceneId: owner, revision: row.revision, savedAt: NOW, contentHash: row.contentHash, project: row.project })
    await old.table('resourceBindings').add(binding(row.project, 'automatic', String(row.revision)))
  }
  const summaries: SnapshotSummary[] = []
  for (const [index, kind] of ['named', 'protection'].entries()) {
    const row = rows[index], snapshot: SnapshotSummary = { id: `source-${kind}`, ownerSceneId: owner,
      lineageId: row.project.historyIdentity.lineageId, sourceRevision: row.revision, kind: kind as 'named' | 'protection', name: kind, createdAt: NOW, contentHash: row.contentHash }
    await old.table('snapshots').add({ ...snapshot, project: row.project }); summaries.push(snapshot)
    await old.table('resourceBindings').add(binding(row.project, snapshot.kind, snapshot.id))
  }
  for (const [sha256] of projectResourceRecords(base)) await old.table('resources').add({ sha256, bytes: await bundle.resources.read(sha256) })
  for (const license of Object.values(base.licenses)) await old.table('licenseTexts').add(license)
  const before = { automatic: await old.table('automaticSnapshots').toArray(), snapshots: await old.table('snapshots').toArray(), current: await old.table('projects').get(owner) }
  old.close()
  return { name, owner, current, rows, before, summaries, bundle }
}
function repository(name: string, custom = validation) { const repo = new ProjectRepository({ name, runtime, validation: custom }); repos.push(repo); return repo }
afterEach(async () => {
  vi.restoreAllMocks(); repos.splice(0).forEach(repo => repo.close()); connections.splice(0).forEach(db => db.close())
  for (const name of names) await Dexie.delete(name)
  names.clear()
})

describe('incremental history source-copy migration', () => {
  it('cold-verifies all old roots and pins before activating, then preserves original rows across new delta saves', async () => {
    const sourceRows = await source(true), repo = repository(sourceRows.name), owner = sourceRows.owner
    const history = await repo.listHistoryVersions(owner)
    expect(repo.database.backendDB().version).toBe(30)
    expect(history.versions).toHaveLength(3); expect(history.versions.every(row => row.parentId === null && row.checkpoint)).toBe(true)
    expect(await repo.listSnapshots(owner)).toEqual(sourceRows.summaries.sort((a, b) => a.id.localeCompare(b.id)))
    for (const row of history.versions) expect(projectContentHash((await repo.loadHistoryVersion(owner, row.id))!.project)).toBe(row.contentHash)
    const loaded = (await repo.load(owner))!, project = cloneJson(loaded.project)
    project.document.revision++; project.document.props.item.rotationDeg = 80
    await repo.save({ ...loaded, project }, 2)
    expect((await repo.listHistoryVersions(owner)).versions).toHaveLength(4)
    expect(await repo.database.automaticSnapshots.toArray()).toEqual(sourceRows.before.automatic)
    expect(await repo.database.snapshots.toArray()).toEqual(sourceRows.before.snapshots)
    repo.close()
    const cold = repository(sourceRows.name)
    expect((await cold.loadSnapshot(owner, 'source-named'))!.contentHash).toBe(sourceRows.rows[0].contentHash)
    expect((await cold.load(owner))!.project.document.revision).toBe(3)
  })
  it('leaves the complete source usable and staging unpublished on failed real-resource cold read, then retries the same roots', async () => {
    const data = await source(true), decode = vi.fn(validation.images.decode.bind(validation.images))
    let calls = 0
    decode.mockImplementation(async (...args) => {
      if (++calls === 7) throw new Error('cold pixels rejected')
      return validation.images.decode(...args)
    })
    const repo = repository(data.name, { ...validation, images: { ...validation.images, decode } })
    await expect(repo.listHistoryVersions(data.owner)).rejects.toThrow('cold pixels rejected')
    expect((await repo.database.historyHeads.get(data.owner))!.status).toBe('staged')
    expect(await repo.database.projects.get(data.owner)).toEqual(data.before.current)
    expect(await repo.database.snapshots.toArray()).toEqual(data.before.snapshots)
    expect((await repo.load(data.owner))!.project.document.revision).toBe(2)
    const roots = await repo.database.historyVersions.toCollection().primaryKeys()
    expect((await repo.listHistoryVersions(data.owner)).versions).toHaveLength(3)
    expect(await repo.database.historyVersions.toCollection().primaryKeys()).toEqual(roots)
    expect((await repo.database.historyHeads.get(data.owner))!.status).toBe('ready')
  })
  it('binds publication to the entire cold-read copy, including changes made during pixel validation', async () => {
    const data = await source(true)
    let repo!: ProjectRepository, calls = 0
    const decode = vi.fn(async (...args: Parameters<typeof validation.images.decode>) => {
      if (++calls === 7) {
        const original = (await repo.database.historyVersions.toArray())[0]
        const added = { ...original, id: 'unexpected-root', automatic: false }
        const { recordHash: _hash, ...body } = added
        added.recordHash = sha256Bytes(encodeUtf8(canonicalJson(body)))
        await repo.database.transaction('rw', Object.keys(PROJECT_STORES_V2).concat(['historyVersions', 'historyHeads', 'historyPins', 'storageState']), async () => {
          await repo.database.historyVersions.add(added)
        })
      }
      return validation.images.decode(...args)
    })
    repo = repository(data.name, { ...validation, images: { ...validation.images, decode } })
    await expect(repo.listHistoryVersions(data.owner)).rejects.toThrow(/元数据|来源快照/)
    expect((await repo.database.historyHeads.get(data.owner))!.status).toBe('staged')
    expect(await repo.database.projects.get(data.owner)).toEqual(data.before.current)
    await repo.database.historyVersions.delete([data.owner, 'unexpected-root'])
    expect((await repo.listHistoryVersions(data.owner)).versions).toHaveLength(3)
  })
  it('revalidates non-active root bodies at final publication even when their declared hash was not updated', async () => {
    const data = await source(true)
    let repo!: ProjectRepository, calls = 0
    const decode = vi.fn(async (...args: Parameters<typeof validation.images.decode>) => {
      if (++calls === 7) {
        const root = (await repo.database.historyVersions.toArray()).find(row => row.contentHash !== data.current.contentHash)!
        const changed = cloneJson(root)
        changed.checkpoint!.document.title = 'corrupted during cold pixel verification'
        // Simulate storage corruption through raw IDB, bypassing repository hooks
        // and leaving both the claimed record hash and accounting epoch intact.
        await new Promise<void>((resolve, reject) => {
          const transaction = repo.database.backendDB().transaction('historyVersions', 'readwrite')
          transaction.objectStore('historyVersions').put(changed)
          transaction.oncomplete = () => resolve()
          transaction.onabort = () => reject(transaction.error)
          transaction.onerror = () => reject(transaction.error)
        })
      }
      return validation.images.decode(...args)
    })
    repo = repository(data.name, { ...validation, images: { ...validation.images, decode } })
    await expect(repo.listHistoryVersions(data.owner)).rejects.toThrow(/hash/)
    expect((await repo.database.historyHeads.get(data.owner))!.status).toBe('staged')
    expect(await repo.database.projects.get(data.owner)).toEqual(data.before.current)
    expect((await repo.load(data.owner))!.project).toEqual(data.current.project)
  })
  it('rolls back failed staged writes and can retry without replacing any old history', async () => {
    const data = await source(), repo = repository(data.name)
    vi.spyOn(repo.database.historyVersions, 'bulkAdd').mockRejectedValueOnce(new DOMException('quota', 'QuotaExceededError'))
    await expect(repo.listHistoryVersions(data.owner)).rejects.toMatchObject({ name: 'QuotaExceededError' })
    expect(await repo.database.historyHeads.count()).toBe(0); expect(await repo.database.historyPins.count()).toBe(0)
    expect(await repo.database.historyVersions.count()).toBe(0)
    expect(await repo.database.snapshots.toArray()).toEqual(data.before.snapshots)
    expect((await repo.listHistoryVersions(data.owner)).versions).toHaveLength(3)
  })
})
