import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { layerSceneV3 } from '../../../core/v3/test-fixtures'
import { imageProject } from '../../../io/v3/test-fixtures'
import { createCompositionContent } from '../../../shared/appearance/graph.js'
import type { SceneDocument } from '../../../shared/model/scene.js'
import { toCurrentSceneDocument } from '../../../shared/model/current-scene.js'
import type { ProjectBundle, ProjectData } from '../../../shared/model/project.js'
import type { CompleteValidationOptions } from '../../../shared/ports/resources.js'
import type { ConversionJob, ConvertedFamily } from '../../../shared/migration/types.js'
import { CONVERTER_VERSION } from '../../../shared/migration/types.js'
import { exportMigrationSet, importMigrationSet } from '../../../shared/migration/set.js'
import { createMemoryResources } from '../../../shared/project/resources.js'
import { projectContentHash } from '../../../shared/project/validate.js'
import { sha256Bytes } from '../../../shared/project/binary.js'
import * as binaryHash from '../../../shared/project/binary.js'
import { canonicalJson, cloneJson, encodeUtf8 } from '../../../shared/validation/json.js'
import { ProjectDatabase, PROJECT_DATABASE_NAME, PROJECT_TABLES } from './database.js'
import { ConversionConflictError, HistoryMetadataConflictError, ProjectConflictError, ProjectRepository, PROJECT_STORAGE_LIMITS } from './repository.js'
import { historyHeadBytes, historyPinBytes, historyVersionBytes } from './incremental-history.js'

const NOW = '2026-10-24T00:00:00.000Z'
const repositories: ProjectRepository[] = [], names = new Set<string>()
let sequence = 0
const decodedTransactions: unknown[] = []
/** Explicit Node pixel adapter; native decoding remains in the focused Chrome tests. */
const validation: CompleteValidationOptions = { images: {
  async decode(_bytes, record) { decodedTransactions.push(Dexie.currentTransaction); return { width: record.pixelWidth, height: record.pixelHeight, rgba: new Uint8ClampedArray(record.pixelWidth * record.pixelHeight * 4) } },
  async transform(image) { return image }, async encodePng() { throw new Error('Storage must not encode') },
} }
function repository(name = `m20d-project-${crypto.randomUUID()}`): ProjectRepository {
  names.add(name)
  const repository = new ProjectRepository({ name, validation, runtime: { ids: { nextId: () => `db-id-${++sequence}` }, clock: { now: () => NOW } } })
  repositories.push(repository); return repository
}
function fixture(): ProjectBundle {
  const document: SceneDocument = toCurrentSceneDocument({ ...cloneJson(layerSceneV3()), format: 'sceneweave-scene', schemaVersion: 1 })
  document.sceneId = 'old-owner'; document.assets = {}; document.propDefinitions = {}; document.materials = {}; document.styleThemes = {}; document.activeStyleThemeRef = null
  const content = createCompositionContent(document, { ids: { nextId: () => `stable-token-${++sequence}` }, clock: { now: () => NOW } })
  return { project: { format: 'sceneweave-complete-project', schemaVersion: 1, ...content, assets: {}, licenses: {}, licenseBindings: [], authoringSources: {} }, resources: createMemoryResources({}) }
}
async function imageFixture(): Promise<ProjectBundle> {
  const old = await imageProject(), document: SceneDocument = toCurrentSceneDocument({ ...old.document, format: 'sceneweave-scene', schemaVersion: 1 })
  const content = createCompositionContent(document, { ids: { nextId: () => `image-token-${++sequence}` }, clock: { now: () => NOW } })
  const pairs = await Promise.all(Object.entries(old.assets).map(async ([hash, asset]) => [hash, new Uint8Array(await asset.blob.arrayBuffer())] as const))
  return { project: { format: 'sceneweave-complete-project', schemaVersion: 1, ...content,
    assets: Object.fromEntries(Object.entries(old.assets).map(([hash, { blob: _blob, ...record }]) => [hash, record])),
    licenses: old.licenses, licenseBindings: old.licenseBindings, authoringSources: {} }, resources: createMemoryResources(new Map(pairs)) }
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
function family(job: ConversionJob, source = fixture()): ConvertedFamily {
  const current = { project: cloneJson(source.project), resources: source.resources }; current.project.document.sceneId = job.targetSceneId
  return { current, snapshots: [], importedSnapshots: [], legacySources: [], legacyBlobs: [], sourceContentHashes: cloneJson(job.sourceContentHashes) }
}
async function prepared(repo: ProjectRepository, source?: ProjectBundle, keys: string[] = []) {
  let job = await reserve(repo, keys)
  job = await repo.advanceJob(job.jobId, job.jobVersion, 'backup-verified', { backupReceipt: await receipt(job) })
  const converted = family(job, source)
  return { job, converted }
}
afterEach(async () => {
  vi.restoreAllMocks()
  for (const repo of repositories.splice(0)) repo.close()
  for (const name of names) await Dexie.delete(name)
  names.clear(); decodedTransactions.length = 0
})

describe('native complete-v1 project repository and two-phase conversion', () => {
  it('creates only on explicit use, owns the exact schema3 stores and refuses old names or unknown schemas', async () => {
    const repo = repository(), before = (await indexedDB.databases()).map(db => db.name)
    expect(before).not.toContain(repo.database.name)
    await repo.open()
    expect(repo.database.verno).toBe(3); expect(repo.database.backendDB().version).toBe(30)
    expect(repo.database.tables.map(table => table.name).sort()).toEqual([...PROJECT_TABLES].sort())
    expect(repo.database.table('conversionJobs').schema.indexes.find(index => index.name === 'jobKey')?.unique).toBe(true)
    for (const name of ['sceneweave-m0', 'sceneweave-m1-outdoor', 'sceneweave-catalog-v1', 'sceneweave-library']) expect(() => repository(name)).toThrow(/不能/)
    const foreignName = `m20d-foreign-${crypto.randomUUID()}`, foreign = new Dexie(foreignName); names.add(foreignName)
    foreign.version(2).stores({ external: 'id' }); await foreign.open(); foreign.close()
    await expect(repository(foreignName).open()).rejects.toThrow(/结构/)
    const verify = new Dexie(foreignName); await verify.open(); expect(verify.verno).toBe(2); expect(verify.tables.map(table => table.name)).toEqual(['external']); verify.close()
    expect(PROJECT_DATABASE_NAME).toBe('sceneweave-projects-dev-v1')
  })
  it('rolls back an unknown lower-version database that appears after the native preflight', async () => {
    const foreignName = `m20d-late-foreign-${crypto.randomUUID()}`; names.add(foreignName)
    const foreign = new Dexie(foreignName)
    foreign.version(.1).stores({ external: 'id' })
    await foreign.open(); await foreign.table('external').add({ id: 'retained', value: 'original foreign data' }); foreign.close()
    // Direct open represents a foreign native-v1 database created in the gap
    // between inspectProjectDatabase and the repository's Dexie.open call.
    const candidate = new ProjectDatabase(foreignName)
    try { await expect(candidate.open()).rejects.toThrow(/不支持升级/) } finally { candidate.close() }
    const retained = new Dexie(foreignName)
    try {
      await retained.open()
      expect(retained.backendDB().version).toBe(1)
      expect(retained.tables.map(table => table.name)).toEqual(['external'])
      expect(await retained.table('external').toArray()).toEqual([{ id: 'retained', value: 'original foreign data' }])
    } finally { retained.close() }
  })
  it('owns mutable metadata, reopens actual bytes/licenses and keeps image processing outside IDB transactions', async () => {
    const repo = repository(), input = await imageFixture(), before = cloneJson(input.project)
    const saving = repo.save(input, null); input.project.document.title = 'caller mutation'; await saving
    const reopener = repository(repo.database.name), loaded = await reopener.load(before.document.sceneId)
    expect(loaded!.project).toEqual(before)
    const hash = Object.keys(before.assets)[0], bytes = await loaded!.resources.read(hash); bytes.fill(0)
    expect(sha256Bytes(await (await repo.load(before.document.sceneId))!.resources.read(hash))).toBe(hash)
    expect(decodedTransactions.length).toBeGreaterThanOrEqual(3); expect(decodedTransactions.every(value => !value)).toBe(true)
    expect(await reopener.usage(before.document.sceneId)).toMatchObject({ namedCount: 0, protectionCount: 0, importedCount: 0 })
  })
  it('stores named/protection pins without complete copies and accounts only actual records on warm writes', async () => {
    const repo = repository(), input = fixture(), owner = input.project.document.sceneId
    await repo.save(input, null)
    const before = await repo.usage(owner), baseline = (await repo.database.historyVersions.toArray())[0]
    const scanning = vi.spyOn(repo as unknown as { scanTotals(): Promise<unknown> }, 'scanTotals')
    const named = await repo.createSnapshot(input, '相同内容命名', { expectedRevision: 0, expectedMetadataVersion: 0 })
    const protection = await repo.createSnapshot(input, '相同内容保护', { kind: 'protection', expectedRevision: 0, expectedMetadataVersion: 1 })
    const pins = await repo.database.historyPins.toArray(), head = (await repo.database.historyHeads.get(owner))!
    expect(pins.map(row => row.id).sort()).toEqual([named.id, protection.id].sort())
    expect(pins.every(row => row.versionId === baseline.id && !Object.hasOwn(row, 'project'))).toBe(true)
    expect(await repo.database.historyVersions.count()).toBe(1)
    expect(await repo.database.snapshots.count()).toBe(0)
    expect(await repo.database.automaticSnapshots.count()).toBe(0)
    const usage = await repo.usage(owner)
    expect(usage).toEqual({ documentBytes: encodeUtf8(canonicalJson(input.project)).length + historyVersionBytes(baseline)
      + historyHeadBytes(head) + pins.reduce((sum, pin) => sum + historyPinBytes(pin), 0),
      resourceBytes: 0, legacyBytes: 0, metadataVersion: 2, namedCount: 1, protectionCount: 1, importedCount: 0 })
    expect(usage.documentBytes - before.documentBytes).toBe(pins.reduce((sum, pin) => sum + historyPinBytes(pin), 0))
    expect(scanning).not.toHaveBeenCalled()
    const cold = repository(repo.database.name), coldScan = vi.spyOn(cold as unknown as { scanTotals(): Promise<unknown> }, 'scanTotals')
    expect(await cold.usage(owner)).toEqual(usage)
    expect(coldScan).toHaveBeenCalledTimes(1)
    expect(await cold.usage(owner)).toEqual(usage)
    expect(coldScan).toHaveBeenCalledTimes(1)
  })
  it('rolls back longer snapshot names when their actual pin bytes exceed the library budget', async () => {
    const repo = repository(), input = fixture(), owner = input.project.document.sceneId
    await repo.save(input, null)
    const snapshot = await repo.createSnapshot(input, 'x', { expectedRevision: 0, expectedMetadataVersion: 0 })
    const before = { pin: await repo.database.historyPins.get([owner, snapshot.id]), metadata: await repo.database.historyMetadata.get(owner),
      epoch: await repo.database.storageState.get('epoch') }
    // Model a nearly full library without allocating 128MiB of test data.
    const totals = await repo.usage(owner)
    vi.spyOn(repo as unknown as { scanTotals(): Promise<unknown> }, 'scanTotals').mockResolvedValue({ ...totals,
      documentBytes: PROJECT_STORAGE_LIMITS.documentBytes - 1 })
    ;(repo as unknown as { accounting: { invalidate(): void } }).accounting.invalidate()
    await expect(repo.renameSnapshot(owner, snapshot.id, 'longer snapshot name', snapshot.contentHash, 1)).rejects.toThrow(/累计预算/)
    expect(await repo.database.historyPins.get([owner, snapshot.id])).toEqual(before.pin)
    expect(await repo.database.historyMetadata.get(owner)).toEqual(before.metadata)
    expect(await repo.database.storageState.get('epoch')).toEqual(before.epoch)
  })
  it('rejects corrupt later pin/version rows instead of returning partial history summaries', async () => {
    const repo = repository(), input = fixture(), owner = input.project.document.sceneId
    await repo.save(input, null)
    const first = await repo.createSnapshot(input, 'first', { id: 'a-first', expectedRevision: 0, expectedMetadataVersion: 0 })
    const last = await repo.createSnapshot(input, 'last', { id: 'z-last', expectedRevision: 0, expectedMetadataVersion: 1 })
    const stored = (await repo.database.historyPins.get([owner, last.id]))!
    await repo.database.historyPins.put({ ...stored, name: 'changed under the original record hash' })
    await expect(repo.listSnapshots(owner)).rejects.toThrow(/hash/)
    await repo.database.historyPins.put(stored)
    expect((await repo.listSnapshots(owner)).map(row => row.id).sort()).toEqual([first.id, last.id])
    await repo.save(revision(input, 1), 0)
    const automatic = (await repo.database.historyVersions.where('[ownerSceneId+revision]').equals([owner, 1]).first())!
    await repo.database.historyVersions.put({ ...automatic, contentHash: 'f'.repeat(64) })
    await expect(repo.listAutomaticSnapshots(owner)).rejects.toThrow(/hash/)
    await expect(repo.save(revision(input, 2), 1)).rejects.toThrow(/hash/)
    expect((await repo.database.projects.get(owner))!.revision).toBe(1)
    expect(await repo.database.historyVersions.where('[ownerSceneId+revision]').equals([owner, 2]).count()).toBe(0)
  })
  it('reads only the current history metadata version without certifying project content or scanning resources', async () => {
    const repo = repository(), input = await imageFixture(), owner = input.project.document.sceneId
    await repo.save(input, null)
    const hash = Object.keys(input.project.assets)[0], resource = (await repo.database.resources.get(hash))!
    const checking = vi.spyOn(binaryHash, 'sha256Bytes'), decoded = decodedTransactions.length
    const scanning = vi.spyOn(repo as unknown as { usageInTransaction(owner: string): Promise<unknown> }, 'usageInTransaction')
    expect(await repo.historyMetadataVersion(owner)).toBe(0)
    expect(checking).not.toHaveBeenCalled(); expect(scanning).not.toHaveBeenCalled()
    expect(decodedTransactions).toHaveLength(decoded)
    // This query makes no claim about resource validity. The final write still
    // inspects the complete database and must reject these damaged stored bytes.
    await repo.database.resources.put({ ...resource, bytes: new Uint8Array([1, 2, 3]) })
    expect(await repo.historyMetadataVersion(owner)).toBe(0)
    await expect(repo.save(revision(input, 1), 0)).rejects.toThrow(/资源字节hash/)
    expect((await repo.database.projects.get(owner))!.revision).toBe(0)
  })
  it('checks metadata/current envelopes and preserves final metadata CAS after the lightweight query', async () => {
    const repo = repository(), input = fixture(), owner = input.project.document.sceneId
    await expect(repo.historyMetadataVersion(owner)).rejects.toBeInstanceOf(ProjectConflictError)
    await repo.save(input, null)
    const current = (await repo.database.projects.get(owner))!, metadata = (await repo.database.historyMetadata.get(owner))!
    const unknown = { ...current, unexpected: true }
    await repo.database.projects.put(unknown)
    await expect(repo.historyMetadataVersion(owner)).rejects.toThrow(/字段/)
    await repo.database.projects.put({ ...current, contentHash: 'invalid' })
    await expect(repo.historyMetadataVersion(owner)).rejects.toThrow(/hash/)
    await repo.database.projects.put({ ...current, status: 'preparing', conversionJobId: 'retained-job' })
    await expect(repo.historyMetadataVersion(owner)).rejects.toBeInstanceOf(ProjectConflictError)
    await repo.database.projects.put(current)
    await repo.database.historyMetadata.delete(owner)
    await expect(repo.historyMetadataVersion(owner)).rejects.toThrow(/存档|元数据/)
    await repo.database.historyMetadata.put({ ...metadata, metadataVersion: -1 })
    await expect(repo.historyMetadataVersion(owner)).rejects.toThrow(/元数据/)
    await repo.database.historyMetadata.put(metadata)
    const version = await repo.historyMetadataVersion(owner), other = repository(repo.database.name)
    await other.createSnapshot(input, '另一连接先写入', { expectedRevision: 0, expectedMetadataVersion: version })
    await expect(repo.createSnapshot(input, '过期只读版本', { expectedRevision: 0, expectedMetadataVersion: version })).rejects.toBeInstanceOf(HistoryMetadataConflictError)
    expect(await repo.historyMetadataVersion(owner)).toBe(version + 1)
    const controller = new AbortController(); controller.abort()
    await expect(repo.historyMetadataVersion(owner, { signal: controller.signal })).rejects.toThrow(/取消/)
  })
  it('pins protected content and applies the guarded save without rescanning all retained history', async () => {
    const repo = repository(), input = fixture(), owner = input.project.document.sceneId
    await repo.save(input, null)
    const scanning = vi.spyOn(repo as unknown as { scanTotals(): Promise<unknown> }, 'scanTotals')
    const protection = await repo.createSnapshot(input, '一次事务共享', { kind: 'protection', expectedRevision: 0, expectedMetadataVersion: 0 })
    const guard = { expectedMetadataVersion: 1, protection: { id: protection.id, contentHash: protection.contentHash } }
    await repo.checkProtection(owner, 0, protection.contentHash, guard)
    await repo.checkProtection(owner, 0, protection.contentHash, guard)
    await repo.save(revision(input, 1), 0, { guard })
    expect(scanning).not.toHaveBeenCalled()
    const versions = await repo.database.historyVersions.toArray(), pin = (await repo.database.historyPins.get([owner, protection.id]))!
    expect(versions).toHaveLength(2)
    expect(versions.find(row => row.revision === 0)!.checkpoint).toEqual(input.project)
    const saved = versions.find(row => row.revision === 1)!
    expect(saved.checkpoint).toBeNull(); expect(saved.delta).not.toBeNull()
    expect(pin.versionId).toBe(versions.find(row => row.revision === 0)!.id)
    expect((await repo.loadSnapshot(owner, protection.id))!.bundle.project).toEqual(input.project)
    expect((await repo.load(owner))!.project).toEqual(revision(input, 1).project)
    const usage = await repo.usage(owner), head = (await repo.database.historyHeads.get(owner))!
    expect(usage.documentBytes).toBe(encodeUtf8(canonicalJson(revision(input, 1).project)).length
      + versions.reduce((sum, row) => sum + historyVersionBytes(row), 0) + historyPinBytes(pin) + historyHeadBytes(head))
  })
  it('rechecks selected immutable history and keeps rename/delete separate from version contents', async () => {
    const repo = repository(), input = fixture(), owner = input.project.document.sceneId
    await repo.save(input, null)
    const named = await repo.createSnapshot(input, 'selected history', { expectedRevision: 0, expectedMetadataVersion: 0 })
    expect((await repo.loadSnapshot(owner, named.id))!.bundle.project).toEqual(input.project)
    expect((await repo.loadSnapshot(owner, named.id))!.bundle.project).toEqual(input.project)
    expect((await repo.loadAutomaticSnapshot(owner, 0))!.project).toEqual(input.project)
    const pin = (await repo.database.historyPins.get([owner, named.id]))!, stored = (await repo.database.historyVersions.get([owner, pin.versionId]))!
    const corrupted = cloneJson(stored)
    corrupted.checkpoint!.document.title = 'changed under the old hash'
    await repo.database.historyVersions.put(corrupted)
    await expect(repo.loadSnapshot(owner, named.id)).rejects.toThrow(/hash/)
    await repo.database.historyVersions.put(stored)
    await repo.renameSnapshot(owner, named.id, 'renamed history', named.contentHash, 1)
    expect((await repo.loadSnapshot(owner, named.id))!.name).toBe('renamed history')
    expect(await repo.database.historyVersions.get([owner, stored.id])).toEqual(stored)
    await repo.deleteSnapshot(owner, named.id, named.contentHash, 2)
    expect(await repo.loadSnapshot(owner, named.id)).toBeNull()
    expect((await repo.loadAutomaticSnapshot(owner, 0))!.project).toEqual(input.project)
  })
  it('rejects same-hash history mutation after a cached check and rolls the whole transaction back', async () => {
    const repo = repository(), input = fixture(), owner = input.project.document.sceneId
    await repo.save(input, null)
    const automatic = (await repo.database.historyVersions.toArray())[0]
    const original = repo as unknown as { putResources: (...args: unknown[]) => Promise<void> }
    const putting = original.putResources
    const injection = vi.spyOn(original, 'putResources').mockImplementationOnce(async (...args) => {
      await putting.apply(repo, args)
      const changed = cloneJson(automatic); changed.checkpoint!.document.title = 'changed after current content checked'
      // Accounting hooks validate this changed record in the same transaction,
      // before a previously valid receipt could conceal it.
      await repo.database.historyVersions.put(changed)
    })
    await expect(repo.save(revision(input, 1), 0)).rejects.toThrow(/hash/)
    injection.mockRestore()
    expect((await repo.database.projects.get(owner))!.revision).toBe(0)
    expect(await repo.database.historyVersions.get([owner, automatic.id])).toEqual(automatic)
    expect(await repo.database.historyVersions.count()).toBe(1)
    await repo.save(revision(input, 1), 0)
    expect((await repo.load(owner))!.project.document.revision).toBe(1)
  })
  it('checks every version envelope and record hash after external writes invalidate a receipt', async () => {
    const repo = repository(), input = fixture(), owner = input.project.document.sceneId
    await repo.save(input, null)
    const automatic = (await repo.database.historyVersions.toArray())[0], before = await repo.usage(owner)
    await repo.database.historyVersions.put({ ...automatic, contentHash: 'f'.repeat(64) })
    await expect(repo.usage(owner)).rejects.toThrow(/hash/)
    await repo.database.historyVersions.put({ ...automatic, savedAt: 'invalid-time' })
    await expect(repo.usage(owner)).rejects.toThrow(/身份|时间/)
    const extraField = { ...automatic, unexpected: 'cannot be ignored' }
    await repo.database.historyVersions.put(extraField)
    await expect(repo.usage(owner)).rejects.toThrow(/字段|未知/)
    await repo.database.historyVersions.put(automatic)
    expect(await repo.usage(owner)).toEqual(before)
  })
  it('rejects modified checkpoints under reused hashes and schema-invalid content under honest raw hashes', async () => {
    const repo = repository(), input = fixture(), owner = input.project.document.sceneId
    await repo.save(input, null)
    const automatic = (await repo.database.historyVersions.toArray())[0], before = await repo.usage(owner)
    const changed = cloneJson(automatic); changed.checkpoint!.document.title = 'same declared hash, different actual content'
    await repo.database.historyVersions.put(changed)
    await expect(repo.usage(owner)).rejects.toThrow(/hash/)
    const invalid = cloneJson(automatic)
    Object.assign(invalid.checkpoint!.authoringSources, { orphan: { kind: 'svg' } })
    invalid.contentHash = sha256Bytes(encodeUtf8(canonicalJson(invalid.checkpoint)))
    const { recordHash: _recordHash, ...payload } = invalid
    invalid.recordHash = sha256Bytes(encodeUtf8(canonicalJson(payload)))
    await repo.database.historyVersions.put(invalid)
    await expect(repo.usage(owner)).rejects.toThrow(/字段无效/)
    await repo.database.historyVersions.put(automatic)
    expect(await repo.usage(owner)).toEqual(before)
  })
  it('rereads historical content, resources, licenses and originals changed by another connection after a successful scan', async () => {
    const repo = repository(), input = await imageFixture(), owner = input.project.document.sceneId
    await repo.save(input, null)
    const named = await repo.createSnapshot(input, '跨事务保护', { expectedRevision: 0, expectedMetadataVersion: 0 })
    const original = encodeUtf8('retained original bytes'), originalHash = sha256Bytes(original)
    await repo.database.legacyBlobs.put({ sha256: originalHash, bytes: original })
    await repo.usage(owner)
    const other = repository(repo.database.name); await other.open()
    const pin = (await other.database.historyPins.get([owner, named.id]))!
    const stored = (await other.database.historyVersions.get([owner, pin.versionId]))!, changed = cloneJson(stored)
    changed.checkpoint!.document.title = 'external history tampering'
    await other.database.historyVersions.put(changed)
    await expect(repo.usage(owner)).rejects.toThrow(/hash/)
    await other.database.historyVersions.put(stored)
    await repo.usage(owner)
    await other.database.historyPins.put({ ...pin, versionId: 'nonexistent-version' })
    await expect(repo.usage(owner)).rejects.toThrow(/hash|断链/)
    await other.database.historyPins.put(pin)
    await repo.usage(owner)
    const head = (await other.database.historyHeads.get(owner))!
    await other.database.historyHeads.put({ ...head, activeVersionId: 'nonexistent-active-version' })
    await expect(repo.usage(owner)).rejects.toThrow(/hash|活动版本/)
    await other.database.historyHeads.put(head)
    await repo.usage(owner)
    const resource = (await other.database.resources.toArray())[0]
    await other.database.resources.put({ ...resource, bytes: new Uint8Array([1, 2, 3]) })
    await expect(repo.usage(owner)).rejects.toThrow(/资源字节hash/)
    await other.database.resources.put(resource)
    await repo.usage(owner)
    const license = (await other.database.licenseTexts.toArray())[0]
    await other.database.licenseTexts.put({ ...license, text: 'external changed license text' })
    await expect(repo.usage(owner)).rejects.toThrow(/许可正文hash/)
    await other.database.licenseTexts.put(license)
    await repo.usage(owner)
    await other.database.legacyBlobs.put({ sha256: originalHash, bytes: new Uint8Array([9]) })
    await expect(repo.usage(owner)).rejects.toThrow(/资源字节hash/)
    await other.database.legacyBlobs.put({ sha256: originalHash, bytes: original })
    expect((await repo.usage(owner)).legacyBytes).toBe(original.length)
  })
  it('uses one transaction revision CAS across connections and refuses equal or decreasing revisions', async () => {
    const first = repository(), second = repository(first.database.name), input = fixture(); await first.save(input, null)
    const outcomes = await Promise.allSettled([first.save(revision(input, 1), 0), second.save(revision(input, 2), 0)])
    expect(outcomes.filter(row => row.status === 'fulfilled')).toHaveLength(1)
    expect((outcomes.find(row => row.status === 'rejected') as PromiseRejectedResult).reason).toBeInstanceOf(ProjectConflictError)
    const current = (await first.load(input.project.document.sceneId))!
    await expect(first.save(current, current.project.document.revision)).rejects.toBeInstanceOf(ProjectConflictError)
    expect((await first.list())[0].revision).toBe(current.project.document.revision)
  })
  it('lists the latest20 automatic versions while retaining older versions and fixed pins', async () => {
    const repo = repository(), input = fixture(), owner = input.project.document.sceneId; await repo.save(input, null)
    const named = await repo.createSnapshot(input, '命名', { expectedRevision: 0, expectedMetadataVersion: 0 })
    const protection = await repo.createSnapshot(input, '保护', { kind: 'protection', expectedRevision: 0, expectedMetadataVersion: 1 })
    for (let value = 1; value <= 21; value++) await repo.save(revision(input, value), value - 1)
    expect((await repo.listAutomaticSnapshots(owner)).map(row => row.revision)).toEqual(Array.from({ length: 20 }, (_, index) => 21 - index))
    expect((await repo.loadAutomaticSnapshot(owner, 0))!.project).toEqual(input.project)
    expect((await repo.loadSnapshot(owner, named.id))!.bundle.project).toEqual(input.project)
    expect((await repo.loadSnapshot(owner, protection.id))!.contentHash).toBe(protection.contentHash)
    expect(await repo.database.historyVersions.count()).toBe(22)
    expect(await repo.database.historyPins.count()).toBe(2)
    expect(await repo.database.resourceBindings.count()).toBe(3)
    expect(await repo.database.automaticSnapshots.count()).toBe(0)
  }, 20_000)
  it('checks current complete content, metadata and true source hash before protected capture', async () => {
    const repo = repository(), input = fixture(), owner = input.project.document.sceneId; await repo.save(input, null)
    const snapshot = await repo.createSnapshot(input, '原稿', { expectedRevision: 0, expectedMetadataVersion: 0 })
    await expect(repo.createSnapshot(input, '过时元数据', { expectedRevision: 0, expectedMetadataVersion: 0 })).rejects.toBeInstanceOf(HistoryMetadataConflictError)
    await expect(repo.createSnapshot(input, '假来源', { kind: 'protection', expectedRevision: 0, expectedMetadataVersion: 1, sourceSnapshot: { id: snapshot.id, contentHash: 'f'.repeat(64) } })).rejects.toBeInstanceOf(HistoryMetadataConflictError)
    const fake = revision(input, 0); fake.project.document.title = 'same revision replacement'
    await expect(repo.createSnapshot(fake, '错误内容', { expectedRevision: 0, expectedMetadataVersion: 1 })).rejects.toThrow(/完整工程/)
    const protection = await repo.createSnapshot(input, '真实保护', { kind: 'protection', expectedRevision: 0, expectedMetadataVersion: 1, sourceSnapshot: { id: snapshot.id, contentHash: snapshot.contentHash } })
    await repo.renameSnapshot(owner, snapshot.id, '改名', snapshot.contentHash, 2)
    expect((await repo.loadSnapshot(owner, snapshot.id))!.contentHash).toBe(snapshot.contentHash)
    await expect(repo.deleteSnapshot(owner, protection.id, protection.contentHash, 2)).rejects.toBeInstanceOf(HistoryMetadataConflictError)
    await repo.deleteSnapshot(owner, protection.id, protection.contentHash, 3)
    expect(await repo.loadSnapshot(owner, protection.id)).toBeNull()
  })
  it('enforces independent32 named/32 protection limits without silently evicting fixed items', async () => {
    const repo = repository(), input = fixture(), owner = input.project.document.sceneId; await repo.save(input, null)
    for (let count = 0; count < 32; count++) await repo.createSnapshot(input, `命名${count}`, { expectedRevision: 0, expectedMetadataVersion: count })
    await expect(repo.createSnapshot(input, '第33项', { expectedRevision: 0, expectedMetadataVersion: 32 })).rejects.toThrow(/上限/)
    const protectedPoint = await repo.createSnapshot(input, '独立保护额度', { kind: 'protection', expectedRevision: 0, expectedMetadataVersion: 32 })
    expect((await repo.listSnapshots(owner)).filter(row => row.kind === 'named')).toHaveLength(32)
    expect((await repo.loadSnapshot(owner, protectedPoint.id))!.kind).toBe('protection')
  }, 20_000)
  it('rolls back injected write failures and cancellation without a partial current/resource/history set', async () => {
    const repo = repository(), input = await imageFixture(), owner = input.project.document.sceneId; await repo.open()
    const fail = () => { throw new Error('injected disk write failure') }; repo.database.resourceBindings.hook('creating', fail)
    await expect(repo.save(input, null)).rejects.toThrow(/injected/)
    expect(await repo.database.projects.count()).toBe(0); expect(await repo.database.resources.count()).toBe(0); expect(await repo.database.historyMetadata.count()).toBe(0)
    repo.database.resourceBindings.hook('creating').unsubscribe(fail)
    const controller = new AbortController(); controller.abort()
    await expect(repo.save(input, null, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(await repo.load(owner)).toBeNull()
  })
  it('aborts foreign transactions when their shared epoch cannot advance', async () => {
    const repo = repository(), input = fixture(); await repo.save(input, null)
    const owner = input.project.document.sceneId, before = (await repo.database.projects.get(owner))!
    await repo.database.storageState.put({ key: 'epoch', epoch: Number.MAX_SAFE_INTEGER })
    await expect(repo.database.transaction('rw', PROJECT_TABLES, async () => {
      await repo.database.projects.put({ ...before, savedAt: '2026-10-30T00:00:00.000Z' })
    })).rejects.toThrow()
    expect(await repo.database.projects.get(owner)).toEqual(before)
  })
  it('rejects external accessors before calling them and blocks changed fixed source meaning', async () => {
    const repo = repository(), input = fixture(); let calls = 0
    Object.defineProperty(input.project.document, 'title', { enumerable: true, get() { calls++; return 'getter' } })
    await expect(repo.save(input, null)).rejects.toThrow(); expect(calls).toBe(0)
    const valid = fixture(); await repo.save(valid, null)
    const next = revision(valid, 1), source = next.project.appearance.sources[next.project.appearance.propSources.item]
    if (source.kind !== 'prop') throw new Error('fixture source must be prop')
    source.snapshot.appearance.opacity = .5
    next.project.document.props.item.appearance.opacity = .5
    await expect(repo.save(next, 0)).rejects.toThrow(/固定来源/)
    expect((await repo.load(valid.project.document.sceneId))!.project.document.revision).toBe(0)
  })
  it('reserves unique fixed mappings across concurrent requests and retries stopped jobs without new IDs', async () => {
    const repo = repository(), second = repository(repo.database.name)
    const [a, b] = await Promise.all([reserve(repo, ['named/one']), reserve(second, ['named/one'])])
    expect(a).toEqual(b); expect(a.jobVersion).toBe(0); expect(await repo.database.conversionJobs.count()).toBe(1)
    const failed = await repo.advanceJob(a.jobId, 0, 'failed', { failure: 'test failure' })
    await expect(repo.retryJob(a.jobId, 0)).rejects.toBeInstanceOf(ConversionConflictError)
    const retry = await repo.retryJob(a.jobId, failed.jobVersion)
    expect(retry).toMatchObject({ stage: 'captured', targetSceneId: a.targetSceneId, snapshotIds: a.snapshotIds, jobVersion: 2 })
  })
  it('requires the real reread receipt bound to both source fingerprint and this reserved job', async () => {
    const repo = repository(), job = await reserve(repo), proof = await receipt(job)
    await expect(repo.advanceJob(job.jobId, 0, 'backup-verified', { backupReceipt: structuredClone(proof) })).rejects.toThrow(/receipt/i)
    const other = { ...job, jobId: 'another-job' }, anotherProof = await receipt(other)
    await expect(repo.advanceJob(job.jobId, 0, 'backup-verified', { backupReceipt: anotherProof })).rejects.toThrow(/receipt/i)
    const backed = await repo.advanceJob(job.jobId, 0, 'backup-verified', { backupReceipt: proof })
    expect(backed.stage).toBe('backup-verified'); expect(backed.jobVersion).toBe(1)
  })
  it('atomically commits all history as hidden preparing, then cold-reads/publishes and preserves later manual edits', async () => {
    const repo = repository(), input = await imageFixture(), preparedInput = await prepared(repo, input, ['named/one', 'automatic/7'])
    let { job } = preparedInput; const converted = preparedInput.converted, owner = job.targetSceneId
    const historical = { project: cloneJson(input.project), resources: input.resources }; historical.project.document.revision = 7
    for (const [key, kind] of [['named/one', 'named'], ['automatic/7', 'imported-auto']] as const) {
      const snapshot = { id: job.snapshotIds[key], ownerSceneId: owner, lineageId: historical.project.historyIdentity.lineageId, sourceRevision: 7,
        kind, name: key, createdAt: NOW, contentHash: projectContentHash(historical.project), bundle: historical }
      ;(kind === 'named' ? converted.snapshots : converted.importedSnapshots).push(snapshot)
    }
    const original = encodeUtf8('Opaque already-validated legacy bytes retained exactly'), sourceHash = sha256Bytes(original)
    converted.legacyBlobs = [{ sha256: sourceHash, bytes: original }]
    converted.legacySources = [{ ownerSceneId: owner, nodeId: 'original-node', previousNodeId: null, sourceSchemaVersion: 1,
      sourceSceneId: 'original-scene', sourceRevision: 2, sourceHash, migratorVersion: 'old-migrator', migratedAt: NOW }]
    job = await repo.prepareConversion(job.jobId, job.jobVersion, converted)
    job = await repo.commitConversion(job.jobId, job.jobVersion, converted)
    expect(job.stage).toBe('committed'); expect(await repo.list()).toEqual([]); expect(await repo.load(owner)).toBeNull()
    const reopened = repository(repo.database.name), resourceReads = vi.spyOn(reopened.database.resources, 'get'), decodesBefore = decodedTransactions.length
    const cold = await reopened.readConversion(job.jobId)
    // Shared hashes are captured once while each complete current/history state
    // still goes through actual byte/hash/image validation outside the transaction.
    expect(resourceReads).toHaveBeenCalledTimes(Object.keys(input.project.assets).length)
    expect(decodedTransactions.length - decodesBefore).toBe(Object.keys(input.project.assets).length * 3)
    resourceReads.mockRestore()
    expect(cold.family.legacyBlobs[0].bytes).toEqual(original); expect(cold.family.importedSnapshots[0].bundle.project.document.sceneId).toBe(input.project.document.sceneId)
    const current = await reopened.publishConversion(job.jobId, job.jobVersion)
    expect((await reopened.list())[0].sceneId).toBe(owner); expect((await reopened.getJob(job.jobId))!.stage).toBe('verified')
    expect(await reopened.usage(owner)).toMatchObject({ importedCount: 1, namedCount: 1, metadataVersion: 0 })
    await expect(reopened.deleteSnapshot(owner, converted.importedSnapshots[0].id, converted.importedSnapshots[0].contentHash, 0)).rejects.toBeInstanceOf(HistoryMetadataConflictError)
    await reopened.save(revision(current, 1), 0)
    const repeated = await reopened.publishConversion(job.jobId, job.jobVersion)
    expect(repeated.project.document.revision).toBe(1)
    expect(await reopened.database.conversionJobs.count()).toBe(1)
  })
  it('resumes the same committed target after cancellation and never creates a second project', async () => {
    const repo = repository(); let { job, converted } = await prepared(repo)
    job = await repo.prepareConversion(job.jobId, job.jobVersion, converted)
    job = await repo.commitConversion(job.jobId, job.jobVersion, converted)
    job = await repo.advanceJob(job.jobId, job.jobVersion, 'cancelled')
    const retry = await repo.retryJob(job.jobId, job.jobVersion)
    expect(retry.stage).toBe('committed'); expect(retry.targetSceneId).toBe(job.targetSceneId)
    await repo.publishConversion(retry.jobId, retry.jobVersion)
    expect(await repo.database.projects.count()).toBe(1)
  })
  it('requires every v6 reserved historical ID and its true source kind/revision at prepare and commit', async () => {
    const repo = repository(), source = fixture()
    const sourceKey = (kind: 'named' | 'protection' | 'automatic', id: string) => canonicalJson({ repository: 'v6', ownerSceneId: 'old-owner', kind, id })
    const keys = [sourceKey('named', 'named-original'), sourceKey('protection', 'protection-original'), sourceKey('automatic', '7')]
    let job = await repo.reserveJob({ sourceRepository: 'v6', scopeId: 'old-owner', sourceFingerprint: 'a'.repeat(64), snapshotKeys: keys,
      sourceContentHashes: { current: 'b'.repeat(64), ...Object.fromEntries(keys.map(key => [key, 'c'.repeat(64)])) } })
    job = await repo.advanceJob(job.jobId, job.jobVersion, 'backup-verified', { backupReceipt: await receipt(job) })
    const converted = family(job, source), historical = { project: cloneJson(source.project), resources: source.resources }
    historical.project.document.revision = 7
    for (const [index, kind] of ['named', 'protection', 'imported-auto'].entries()) {
      const snapshot = { id: job.snapshotIds[keys[index]], ownerSceneId: job.targetSceneId, lineageId: historical.project.historyIdentity.lineageId,
        sourceRevision: 7, kind: kind as 'named' | 'protection' | 'imported-auto', name: kind, createdAt: NOW, contentHash: projectContentHash(historical.project), bundle: historical }
      ;(kind === 'imported-auto' ? converted.importedSnapshots : converted.snapshots).push(snapshot)
    }
    const missingNamed = { ...converted, snapshots: converted.snapshots.slice(1) }, missingAutomatic = { ...converted, importedSnapshots: [] }
    await expect(repo.prepareConversion(job.jobId, job.jobVersion, missingNamed)).rejects.toThrow(/全部/)
    await expect(repo.prepareConversion(job.jobId, job.jobVersion, missingAutomatic)).rejects.toThrow(/全部/)
    const changedKind = { ...converted, snapshots: converted.snapshots.map((row, index) => index ? row : { ...row, kind: 'protection' as const }) }
    await expect(repo.prepareConversion(job.jobId, job.jobVersion, changedKind)).rejects.toThrow(/类别/)
    const newerAutomatic = { project: cloneJson(historical.project), resources: historical.resources }; newerAutomatic.project.document.revision = 8
    const changedRevision = { ...converted, importedSnapshots: converted.importedSnapshots.map(row => ({ ...row, sourceRevision: 8, contentHash: projectContentHash(newerAutomatic.project), bundle: newerAutomatic })) }
    await expect(repo.prepareConversion(job.jobId, job.jobVersion, changedRevision)).rejects.toThrow(/自动快照修订/)
    job = await repo.prepareConversion(job.jobId, job.jobVersion, converted)
    await expect(repo.commitConversion(job.jobId, job.jobVersion, missingNamed)).rejects.toThrow(/全部/)
    await expect(repo.commitConversion(job.jobId, job.jobVersion, missingAutomatic)).rejects.toThrow(/全部/)
    expect(await repo.database.projects.count()).toBe(0)
    job = await repo.commitConversion(job.jobId, job.jobVersion, converted)
    await repo.publishConversion(job.jobId, job.jobVersion)
    expect(await repo.listSnapshots(job.targetSceneId)).toHaveLength(3)
  })
  it('rejects damaged cold-read bytes and missing retained lineage before any project becomes visible', async () => {
    const repo = repository(), input = await imageFixture(); let { job, converted } = await prepared(repo, input)
    job = await repo.prepareConversion(job.jobId, job.jobVersion, converted); job = await repo.commitConversion(job.jobId, job.jobVersion, converted)
    const hash = Object.keys(input.project.assets)[0]
    await repo.database.resources.put({ sha256: hash, bytes: new Uint8Array([1, 2, 3]) })
    await expect(repo.publishConversion(job.jobId, job.jobVersion)).rejects.toThrow(/hash/)
    expect(await repo.list()).toEqual([]); expect((await repo.getJob(job.jobId))!.stage).toBe('committed')
  })
  it('binds conversion publication to every cold-read version body and collection', async () => {
    const repo = repository(), input = await imageFixture()
    let { job, converted } = await prepared(repo, input)
    job = await repo.prepareConversion(job.jobId, job.jobVersion, converted)
    job = await repo.commitConversion(job.jobId, job.jobVersion, converted)
    const read = repo.readConversion.bind(repo)
    vi.spyOn(repo, 'readConversion').mockImplementationOnce(async (...args) => {
      const cold = await read(...args)
      const root = (await repo.database.historyVersions.toArray())[0], changed = cloneJson(root)
      changed.checkpoint!.document.title = 'changed after conversion cold read'
      await new Promise<void>((resolve, reject) => {
        const transaction = repo.database.backendDB().transaction('historyVersions', 'readwrite')
        transaction.objectStore('historyVersions').put(changed)
        transaction.oncomplete = () => resolve()
        transaction.onabort = () => reject(transaction.error)
        transaction.onerror = () => reject(transaction.error)
      })
      return cold
    })
    await expect(repo.publishConversion(job.jobId, job.jobVersion)).rejects.toThrow(/hash/)
    expect(await repo.list()).toEqual([])
    expect((await repo.getJob(job.jobId))!.stage).toBe('committed')
    expect((await repo.database.projects.get(job.targetSceneId))!.status).toBe('preparing')
  })
  it('preflights target cumulative budgets and leaves the reservation/backup intact on rejection', async () => {
    const repo = repository(), input = await imageFixture(), { job, converted } = await prepared(repo, input)
    const usage = { resourceBytes: PROJECT_STORAGE_LIMITS.resourceBytes, documentBytes: 0, legacyBytes: 0, metadataVersion: 0, namedCount: 0, protectionCount: 0, importedCount: 0 }
    // Inject an already-full database usage; no artificial enormous browser allocation or quota claim.
    vi.spyOn(repo as unknown as { usageInTransaction(owner: string): Promise<typeof usage> }, 'usageInTransaction').mockResolvedValue(usage)
    await expect(repo.prepareConversion(job.jobId, job.jobVersion, converted)).rejects.toThrow(/整个新主库/)
    expect((await repo.getJob(job.jobId))!.stage).toBe('backup-verified'); expect(await repo.database.projects.count()).toBe(0)
  })
})
