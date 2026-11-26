import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { layerScene } from '../../../../tests/helpers/current-project-fixtures.js'
import { createCompositionContent } from '../../../shared/appearance/graph.js'
import type { SceneDocument } from '../../../shared/model/scene.js'
import type { ProjectBundle } from '../../../shared/model/project.js'
import type { CompleteValidationOptions } from '../../../shared/ports/resources.js'
import { createMemoryResources } from '../../../shared/project/resources.js'
import { cloneJson } from '../../../shared/validation/json.js'
import { ProjectRepository } from './repository.js'

const NOW = '2026-10-30T00:00:00.000Z'
const repositories: ProjectRepository[] = [], names = new Set<string>()
let sequence = 0
const decodedTransactions: unknown[] = []
const validation: CompleteValidationOptions = { images: {
  async decode(_bytes, record) { decodedTransactions.push(Dexie.currentTransaction); return { width: record.pixelWidth, height: record.pixelHeight, rgba: new Uint8ClampedArray(record.pixelWidth * record.pixelHeight * 4) } },
  async transform(image) { return image }, async encodePng() { throw new Error('Storage must not encode') },
} }
function repository(name = `history-overview-${crypto.randomUUID()}`): ProjectRepository {
  names.add(name)
  const repo = new ProjectRepository({ name, validation, runtime: { ids: { nextId: () => `db-id-${++sequence}` }, clock: { now: () => NOW } } })
  repositories.push(repo); return repo
}
function fixture(): ProjectBundle {
  const document: SceneDocument = layerScene()
  document.sceneId = 'old-owner'; document.assets = {}; document.propDefinitions = {}; document.materials = {}; document.styleThemes = {}; document.activeStyleThemeRef = null
  const content = createCompositionContent(document, { ids: { nextId: () => `stable-token-${++sequence}` }, clock: { now: () => NOW } })
  return { project: { format: 'sceneweave-complete-project', schemaVersion: 1, ...content, assets: {}, licenses: {}, licenseBindings: [], authoringSources: {} }, resources: createMemoryResources({}) }
}
function revision(input: ProjectBundle, value: number): ProjectBundle {
  const project = cloneJson(input.project); project.document.revision = value; project.document.title = `Revision ${value}`
  return { project, resources: input.resources }
}
const separateReads = (repo: ProjectRepository, owner: string) => Promise.all([
  repo.listSnapshots(owner), repo.usage(owner), repo.listHistoryVersions(owner),
])
afterEach(async () => {
  vi.restoreAllMocks()
  for (const repo of repositories.splice(0)) repo.close()
  for (const name of names) await Dexie.delete(name)
  names.clear(); decodedTransactions.length = 0
})

describe('merged history panel overview read', () => {
  it('returns exactly the separate panel reads for a saved, snapshotted and branched project while reading the current row once', async () => {
    const repo = repository(), input = fixture(), owner = input.project.document.sceneId
    await repo.save(input, null)
    const created = await repo.createSnapshot(input, '命名一', { expectedRevision: 0, expectedMetadataVersion: 0 })
    await repo.save(revision(input, 1), 0)
    const projectReads = vi.spyOn(repo.database.projects, 'get')
    const overview = await repo.historyOverview(owner)
    // The merged read strictly checks current once; usage asks for existence
    // through the primary key and does not hydrate its payload a second time.
    expect(projectReads).toHaveBeenCalledTimes(1)
    projectReads.mockRestore()
    const [snapshots, usage, history] = await separateReads(repo, owner)
    expect(overview.snapshots).toEqual(snapshots)
    expect(overview.usage).toEqual(usage)
    expect(overview.history).toEqual(history)
    expect(overview.snapshots.map(row => row.id)).toEqual([created.id])
    expect(overview.history.versions.map(row => row.revision)).toEqual([1, 0])
    expect(overview.usage).toMatchObject({ namedCount: 1, protectionCount: 0, importedCount: 0 })
  })
  it('rejects corrupted current rows, heads and version records instead of trusting the shared content table', async () => {
    const repo = repository(), input = fixture(), owner = input.project.document.sceneId
    await repo.save(input, null)
    await repo.createSnapshot(input, '命名一', { expectedRevision: 0, expectedMetadataVersion: 0 })
    await repo.save(revision(input, 1), 0)
    const current = cloneJson((await repo.database.projects.get(owner))!)
    const damagedHash = { ...current, contentHash: 'a'.repeat(64) }
    await repo.database.projects.put(damagedHash)
    await expect(repo.historyOverview(owner)).rejects.toThrow(/hash/)
    await expect(repo.listSnapshots(owner)).rejects.toThrow(/hash/)
    await repo.database.projects.put(current)
    const head = cloneJson((await repo.database.historyHeads.get(owner))!)
    await repo.database.historyHeads.put({ ...head, savedRevision: head.savedRevision + 1, recordHash: 'b'.repeat(64) })
    await expect(repo.historyOverview(owner)).rejects.toThrow(/当前保存与历史活动版本|hash/)
    await repo.database.historyHeads.put(head)
    const versions = await repo.database.historyVersions.where('ownerSceneId').equals(owner).toArray()
    const leaf = versions.find(row => row.revision === 1)!
    await repo.database.historyVersions.put({ ...cloneJson(leaf), recordHash: 'c'.repeat(64) })
    await expect(repo.historyOverview(owner)).rejects.toThrow(/hash/)
    await repo.database.historyVersions.put(leaf)
    const overview = await repo.historyOverview(owner)
    expect(overview.history.versions).toHaveLength(2)
  })
  it('reflects snapshot mutations and keeps usage parity after create, rename and delete', async () => {
    const repo = repository(), input = fixture(), owner = input.project.document.sceneId
    await repo.save(input, null)
    const created = await repo.createSnapshot(input, '命名一', { expectedRevision: 0, expectedMetadataVersion: 0 })
    let overview = await repo.historyOverview(owner)
    expect(overview.snapshots.map(row => row.name)).toEqual(['命名一'])
    expect(overview.usage.metadataVersion).toBe(1)
    await repo.renameSnapshot(owner, created.id, '改名', created.contentHash, 1)
    overview = await repo.historyOverview(owner)
    expect(overview.snapshots.map(row => row.name)).toEqual(['改名'])
    expect(overview.snapshots).toEqual((await repo.listSnapshots(owner)))
    await repo.deleteSnapshot(owner, created.id, created.contentHash, 2)
    overview = await repo.historyOverview(owner)
    expect(overview.snapshots).toEqual([])
    expect(overview.usage).toEqual(await repo.usage(owner))
    expect(overview.usage).toMatchObject({ namedCount: 0, metadataVersion: 3 })
  })
  it('refuses unknown scenes and never returns partial overview data', async () => {
    const repo = repository()
    await expect(repo.historyOverview('missing-scene')).rejects.toThrow('当前工程不存在')
    expect(repo.database.isOpen()).toBe(true)
  })
})
