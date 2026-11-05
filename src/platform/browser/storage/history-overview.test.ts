import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { layerSceneV3 } from '../../../core/v3/test-fixtures'
import { createCompositionContent } from '../../../shared/appearance/graph.js'
import type { SceneDocument } from '../../../shared/model/scene.js'
import { toCurrentSceneDocument } from '../../../shared/model/current-scene.js'
import type { ProjectBundle } from '../../../shared/model/project.js'
import type { CompleteValidationOptions } from '../../../shared/ports/resources.js'
import type { ConversionJob, ConvertedFamily } from '../../../shared/migration/types.js'
import { CONVERTER_VERSION } from '../../../shared/migration/types.js'
import { exportMigrationSet, importMigrationSet } from '../../../shared/migration/set.js'
import { createMemoryResources } from '../../../shared/project/resources.js'
import { projectContentHash } from '../../../shared/project/validate.js'
import { sha256Bytes } from '../../../shared/project/binary.js'
import { canonicalJson, cloneJson, encodeUtf8 } from '../../../shared/validation/json.js'
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
  const document: SceneDocument = toCurrentSceneDocument({ ...cloneJson(layerSceneV3()), format: 'sceneweave-scene', schemaVersion: 1 })
  document.sceneId = 'old-owner'; document.assets = {}; document.propDefinitions = {}; document.materials = {}; document.styleThemes = {}; document.activeStyleThemeRef = null
  const content = createCompositionContent(document, { ids: { nextId: () => `stable-token-${++sequence}` }, clock: { now: () => NOW } })
  return { project: { format: 'sceneweave-complete-project', schemaVersion: 1, ...content, assets: {}, licenses: {}, licenseBindings: [], authoringSources: {} }, resources: createMemoryResources({}) }
}
function revision(input: ProjectBundle, value: number): ProjectBundle {
  const project = cloneJson(input.project); project.document.revision = value; project.document.title = `Revision ${value}`
  return { project, resources: input.resources }
}
async function reserve(repo: ProjectRepository, snapshotKeys: string[] = []): Promise<ConversionJob> {
  return repo.reserveJob({ sourceRepository: 'sceneweave-m1-outdoor', scopeId: 'old-owner', sourceFingerprint: 'a'.repeat(64), snapshotKeys, sourceContentHashes: { current: 'b'.repeat(64) } })
}
async function receipt(job: ConversionJob) {
  const bytes = encodeUtf8('{"captured":"unit fixture"}')
  const files = await exportMigrationSet({ setId: job.jobId, createdAt: NOW, converterVersion: CONVERTER_VERSION,
    scope: { kind: 'project-family', repository: job.sourceRepository, sourceSceneId: job.scopeId }, sourceFingerprint: job.sourceFingerprint,
    records: [{ role: 'current', recordKey: job.scopeId, sourceFormat: 'legacy-v6', contentHash: job.sourceContentHashes.current, bytes }] })
  return (await importMigrationSet(files.index, files.volumes)).receipt
}
async function convertedFamily(repo: ProjectRepository, source: ProjectBundle, snapshotKeys: string[]): Promise<{ job: ConversionJob; converted: ConvertedFamily }> {
  let job = await reserve(repo, snapshotKeys)
  job = await repo.advanceJob(job.jobId, job.jobVersion, 'backup-verified', { backupReceipt: await receipt(job) })
  const converted: ConvertedFamily = { current: { project: cloneJson(source.project), resources: source.resources }, snapshots: [], importedSnapshots: [],
    legacySources: [], legacyBlobs: [], sourceContentHashes: cloneJson(job.sourceContentHashes) }
  converted.current.project.document.sceneId = job.targetSceneId
  return { job, converted }
}
const fourSeparateReads = (repo: ProjectRepository, owner: string) => Promise.all([
  repo.listSnapshots(owner), repo.usage(owner), repo.listLegacySources(owner), repo.listHistoryVersions(owner),
])
afterEach(async () => {
  vi.restoreAllMocks()
  for (const repo of repositories.splice(0)) repo.close()
  for (const name of names) await Dexie.delete(name)
  names.clear(); decodedTransactions.length = 0
})

describe('merged history panel overview read', () => {
  it('returns exactly the four separate panel reads for a saved, snapshotted and branched project while reading the current row once', async () => {
    const repo = repository(), input = fixture(), owner = input.project.document.sceneId
    await repo.save(input, null)
    const created = await repo.createSnapshot(input, '命名一', { expectedRevision: 0, expectedMetadataVersion: 0 })
    await repo.save(revision(input, 1), 0)
    const projectReads = vi.spyOn(repo.database.projects, 'get')
    const overview = await repo.historyOverview(owner)
    // The merged read touches the current row once for its full strict check and
    // once more inside the usage assertion; the separate panel reads used four.
    expect(projectReads).toHaveBeenCalledTimes(2)
    projectReads.mockRestore()
    const [snapshots, usage, legacySources, history] = await fourSeparateReads(repo, owner)
    expect(overview.snapshots).toEqual(snapshots)
    expect(overview.usage).toEqual(usage)
    expect(overview.legacySources).toEqual(legacySources)
    expect(overview.history).toEqual(history)
    expect(overview.snapshots.map(row => row.id)).toEqual([created.id])
    expect(overview.history.versions.map(row => row.revision)).toEqual([1, 0])
    expect(overview.usage).toMatchObject({ namedCount: 1, protectionCount: 0, importedCount: 0 })
  })
  it('matches the separate reads for a published conversion family with legacy originals and imported history', async () => {
    const repo = repository(), input = fixture(), keys = ['named/one', 'automatic/7']
    const { job, converted } = await convertedFamily(repo, input, keys)
    const historical = { project: cloneJson(input.project), resources: input.resources }; historical.project.document.revision = 7
    for (const [key, kind] of [['named/one', 'named'], ['automatic/7', 'imported-auto']] as const) {
      const snapshot = { id: job.snapshotIds[key], ownerSceneId: job.targetSceneId, lineageId: historical.project.historyIdentity.lineageId, sourceRevision: 7,
        kind, name: key, createdAt: NOW, contentHash: projectContentHash(historical.project), bundle: historical }
      ;(kind === 'named' ? converted.snapshots : converted.importedSnapshots).push(snapshot as never)
    }
    const original = encodeUtf8('Opaque already-validated legacy bytes retained exactly'), sourceHash = sha256Bytes(original)
    converted.legacyBlobs = [{ sha256: sourceHash, bytes: original }]
    converted.legacySources = [{ ownerSceneId: job.targetSceneId, nodeId: 'original-node', previousNodeId: null, sourceSchemaVersion: 1,
      sourceSceneId: 'original-scene', sourceRevision: 2, sourceHash, migratorVersion: 'old-migrator', migratedAt: NOW }]
    const preparedJob = await repo.prepareConversion(job.jobId, job.jobVersion, converted)
    const committed = await repo.commitConversion(job.jobId, preparedJob.jobVersion, converted)
    // A hidden preparing target fails the overview exactly like the legacy original read.
    await expect(repo.historyOverview(job.targetSceneId)).rejects.toThrow(/尚未完成转换/)
    const cold = repository(repo.database.name)
    await cold.readConversion(committed.jobId)
    await cold.publishConversion(committed.jobId, committed.jobVersion)
    const overview = await cold.historyOverview(job.targetSceneId)
    const [snapshots, usage, legacySources, history] = await fourSeparateReads(cold, job.targetSceneId)
    expect(overview.snapshots).toEqual(snapshots)
    expect(overview.usage).toEqual(usage)
    expect(overview.legacySources).toEqual(legacySources)
    expect(overview.history).toEqual(history)
    expect(overview.legacySources.map(row => row.nodeId)).toEqual(['original-node'])
    expect(overview.usage).toMatchObject({ namedCount: 1, importedCount: 1 })
  })
  it('rejects corrupted current rows, heads, version records and legacy bytes instead of trusting the shared content table', async () => {
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
    await repo.database.legacyBlobs.add({ sha256: 'd'.repeat(64), bytes: new Uint8Array([1, 2, 3]) })
    await repo.database.legacySources.add({ ownerSceneId: owner, nodeId: 'broken-node', previousNodeId: null, sourceSchemaVersion: 1,
      sourceSceneId: 'original-scene', sourceRevision: 2, sourceHash: 'd'.repeat(64), migratorVersion: 'old-migrator', migratedAt: NOW })
    await expect(repo.historyOverview(owner)).rejects.toThrow(/hash|原件/)
    await expect(repo.listLegacySources(owner)).rejects.toThrow(/hash|原件/)
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
    await expect(repo.historyOverview('missing-scene')).rejects.toThrow(/不存在或尚未完成转换/)
    expect(repo.database.isOpen()).toBe(true)
  })
})
