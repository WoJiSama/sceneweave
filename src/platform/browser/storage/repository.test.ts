import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { imageProject, layerScene } from '../../../../tests/helpers/current-project-fixtures.js'
import { createCompositionContent } from '../../../shared/appearance/graph.js'
import type { SceneDocument } from '../../../shared/model/scene.js'
import type { ProjectBundle } from '../../../shared/model/project.js'
import type { CompleteValidationOptions } from '../../../shared/ports/resources.js'
import { createMemoryResources, validateProjectBundle } from '../../../shared/project/resources.js'
import { projectContentHash } from '../../../shared/project/validate.js'
import { sha256Bytes } from '../../../shared/project/binary.js'
import * as binaryHash from '../../../shared/project/binary.js'
import { canonicalJson, cloneJson, encodeUtf8 } from '../../../shared/validation/json.js'
import { ProjectDatabase, PROJECT_DATABASE_NAME, PROJECT_TABLES } from './database.js'
import { HistoryMetadataConflictError, ProjectConflictError, ProjectRepository, PROJECT_STORAGE_LIMITS } from './repository.js'
import { historyPinBytes } from './incremental-history.js'
import { canonicalProjectCoordinates } from '../../../shared/aggregates/scene-coordinates.js'

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
  const document: SceneDocument = layerScene()
  document.sceneId = 'old-owner'; document.assets = {}; document.propDefinitions = {}; document.materials = {}; document.styleThemes = {}; document.activeStyleThemeRef = null
  const content = createCompositionContent(document, { ids: { nextId: () => `stable-token-${++sequence}` }, clock: { now: () => NOW } })
  return { project: { format: 'sceneweave-complete-project', schemaVersion: 1, ...content, assets: {}, licenses: {}, licenseBindings: [], authoringSources: {} }, resources: createMemoryResources({}) }
}
const imageFixture = imageProject
function revision(input: ProjectBundle, value: number): ProjectBundle {
  const project = cloneJson(input.project); project.document.revision = value; project.document.title = `Revision ${value}`
  return { project, resources: input.resources }
}
/** Read physical records independently of complete-project hydration/accounting. */
async function nativeDocumentBytes(repo: ProjectRepository): Promise<number> {
  const names = ['projects', 'automaticSnapshots', 'snapshots', 'importedSnapshots', 'historyVersions', 'historyHeads', 'historyPins', 'projectContentBlocks']
  const transaction = repo.database.backendDB().transaction(names, 'readonly')
  const totals = await Promise.all(names.map(name => new Promise<number>((resolve, reject) => {
    const request = transaction.objectStore(name).getAll()
    request.onsuccess = () => {
      try { resolve(request.result.reduce((sum, row) => sum + (name === 'projectContentBlocks'
        ? row.bytes.byteLength : encodeUtf8(canonicalJson(row)).length), 0)) } catch (error) { reject(error) }
    }
    request.onerror = () => reject(request.error)
  })))
  return totals.reduce((sum, value) => sum + value, 0)
}
afterEach(async () => {
  vi.restoreAllMocks()
  for (const repo of repositories.splice(0)) repo.close()
  for (const name of names) await Dexie.delete(name)
  names.clear(); decodedTransactions.length = 0
})

describe('complete-v1 project repository', () => {
  it('waits for an in-progress schema upgrade when a second opener sees the native handle', async () => {
    const repo = repository()
    let second: Promise<boolean> | undefined
    repo.database.on('populate', transaction => {
      let committed = false
      transaction.idbtrans.addEventListener('complete', () => { committed = true })
      second = repo.open().then(() => committed)
    })
    await repo.open()
    expect(await second).toBe(true)
  })

  it('composes a verified file import with one pixel check, but fully checks public and forged/replaced-capability inputs', async () => {
    const repo = repository(), raw = await imageFixture(), decode = vi.spyOn(validation.images, 'decode')
    const verified = await validateProjectBundle(raw, validation), count = decode.mock.calls.length
    expect(count).toBeGreaterThan(0)
    const installed = await repo.importSnapshotArchive({ current: verified, snapshots: [] })
    expect(installed.project.project.document.sceneId).not.toBe(verified.project.document.sceneId)
    expect(decode).toHaveBeenCalledTimes(count)
    await repo.importArchive({ current: verified, snapshots: [] })
    expect(decode).toHaveBeenCalledTimes(count * 2)
    await repo.importSnapshotArchive({ current: { project: cloneJson(verified.project), resources: verified.resources }, snapshots: [] })
    expect(decode).toHaveBeenCalledTimes(count * 3)
    const original = validation.images.decode
    validation.images.decode = async (...args) => original(...args)
    try { await repo.importSnapshotArchive({ current: verified, snapshots: [] }); expect(decode).toHaveBeenCalledTimes(count * 4) }
    finally { validation.images.decode = original }
    const cancelled = new AbortController(); cancelled.abort()
    await expect(repo.importSnapshotArchive({ current: verified, snapshots: [] }, { signal: cancelled.signal })).rejects.toMatchObject({ name: 'AbortError' })
  })
  it('preserves selected verified history under fresh local bindings and rejects oversized archives before pixel replay', async () => {
    const repo = repository(), raw = await imageFixture(), decode = vi.spyOn(validation.images, 'decode')
    const verified = await validateProjectBundle(raw, validation), original = cloneJson(verified.project)
    decode.mockClear()
    const snapshot = { id: 'original-history', ownerSceneId: original.document.sceneId, lineageId: original.historyIdentity.lineageId,
      sourceRevision: original.document.revision, name: 'selected history', kind: 'named' as const, createdAt: NOW,
      contentHash: projectContentHash(original), bundle: verified }
    const installed = await repo.importSnapshotArchive({ current: verified, snapshots: [snapshot] })
    expect(decode).not.toHaveBeenCalled()
    expect(installed.snapshots).toHaveLength(1)
    const summary = installed.snapshots[0]
    expect(summary.id).not.toBe(snapshot.id)
    expect(summary.ownerSceneId).toBe(installed.project.project.document.sceneId)
    expect(summary.contentHash).toBe(snapshot.contentHash)
    expect((await repo.loadSnapshot(summary.ownerSceneId, summary.id))!.bundle.project).toEqual(original)
    expect(verified.project).toEqual(original)
    decode.mockClear(); const projects = await repo.database.projects.count()
    await expect(repo.importSnapshotArchive({ current: verified,
      snapshots: Array.from({ length: 65 }, (_, i) => ({ ...snapshot, id: `too-many-${i}` })) })).rejects.toThrow(/64/)
    expect(decode).not.toHaveBeenCalled()
    expect(await repo.database.projects.count()).toBe(projects)
  })
  it('creates only on explicit use, owns the exact schema4 stores and refuses old names or unknown schemas', async () => {
    const repo = repository(), before = (await indexedDB.databases()).map(db => db.name)
    expect(before).not.toContain(repo.database.name)
    await repo.open()
    expect(repo.database.verno).toBe(4); expect(repo.database.backendDB().version).toBe(40)
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
    const pins = await repo.database.historyPins.toArray()
    expect(pins.map(row => row.id).sort()).toEqual([named.id, protection.id].sort())
    expect(pins.every(row => row.versionId === baseline.id && !Object.hasOwn(row, 'project'))).toBe(true)
    expect(await repo.database.historyVersions.count()).toBe(1)
    expect(await repo.database.snapshots.count()).toBe(0)
    expect(await repo.database.automaticSnapshots.count()).toBe(0)
    const usage = await repo.usage(owner)
    expect(usage).toEqual({ documentBytes: await nativeDocumentBytes(repo),
      resourceBytes: 0, metadataVersion: 2, namedCount: 1, protectionCount: 1, importedCount: 0 })
    expect(usage.documentBytes - before.documentBytes).toBe(pins.reduce((sum, pin) => sum + historyPinBytes(pin), 0))
    expect(scanning).not.toHaveBeenCalled()
    const cold = repository(repo.database.name), coldScan = vi.spyOn(cold as unknown as { auditCapturedTotals(): Promise<unknown> }, 'auditCapturedTotals')
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
    vi.spyOn(repo as unknown as { auditCapturedTotals(): Promise<unknown> }, 'auditCapturedTotals').mockResolvedValue({ ...totals,
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
  it('cold-audits other owners and orphan rows before saving, with exact physical document accounting', async () => {
    const repo = repository(), input = fixture(), other = fixture()
    other.project.document.sceneId = 'another-owner'
    await repo.save(input, null); await repo.save(other, null)
    const owners = [input.project.document.sceneId, other.project.document.sceneId]
    repo.close()
    const cold = repository(repo.database.name)
    expect((await cold.usage(owners[0])).documentBytes).toBe(await nativeDocumentBytes(cold))
    const root = (await cold.database.historyVersions.where('ownerSceneId').equals(owners[1]).first())!
    const changed = cloneJson(root); changed.checkpoint!.document.title = 'damaged other project'
    await cold.database.historyVersions.put(changed)
    await expect(cold.save(revision(input, 1), 0)).rejects.toThrow(/hash/)
    expect((await cold.database.projects.get(owners[0]))!.revision).toBe(0)
    await cold.database.historyVersions.put(root)
    await cold.database.historyHeads.delete(owners[1])
    await expect(cold.usage(owners[0])).rejects.toThrow(/所属|分支/)
    expect((await cold.database.projects.get(owners[0]))!.revision).toBe(0)
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
    const usage = await repo.usage(owner)
    expect(usage.documentBytes).toBe(await nativeDocumentBytes(repo))
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
    invalid.contentHash = sha256Bytes(encodeUtf8(canonicalProjectCoordinates(invalid.checkpoint!)))
    const { recordHash: _recordHash, ...payload } = invalid
    invalid.recordHash = sha256Bytes(encodeUtf8(canonicalJson({ ...payload, checkpoint: JSON.parse(canonicalProjectCoordinates(payload.checkpoint!)) })))
    await repo.database.historyVersions.put(invalid)
    await expect(repo.usage(owner)).rejects.toThrow(/字段无效/)
    await repo.database.historyVersions.put(automatic)
    // Failed external tampering leaves immutable blocks retained. They remain
    // real stored bytes even after the original visible record is restored.
    const after = await repo.usage(owner)
    expect(after).toEqual({ ...before, documentBytes: await nativeDocumentBytes(repo) })
    expect(after.documentBytes).toBeGreaterThan(before.documentBytes)
  })
  it('rereads historical content, resources and licenses changed by another connection after a successful scan', async () => {
    const repo = repository(), input = await imageFixture(), owner = input.project.document.sceneId
    await repo.save(input, null)
    const named = await repo.createSnapshot(input, '跨事务保护', { expectedRevision: 0, expectedMetadataVersion: 0 })
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
})
