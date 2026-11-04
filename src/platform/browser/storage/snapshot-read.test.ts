import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fixture, runtime, validation } from '../../../application/workspace/test-fixtures.js'
import type { ProjectBundle } from '../../../shared/model/project.js'
import type { CompleteValidationOptions } from '../../../shared/ports/resources.js'
import { cloneJson } from '../../../shared/validation/json.js'
import * as projectDelta from '../../../shared/project/delta.js'
import * as projectValidation from '../../../shared/project/validate.js'
import type { StoredHistoryMetadata } from './database.js'
import { HistoryMetadataConflictError, ProjectRepository, type SnapshotReadSession } from './repository.js'

const repositories: ProjectRepository[] = [], names = new Set<string>()
function repository(checking: CompleteValidationOptions, name = `snapshot-read-${crypto.randomUUID()}`): ProjectRepository {
  const repo = new ProjectRepository({ name, validation: checking, runtime })
  repositories.push(repo); names.add(name); return repo
}
async function setup() {
  const decode = vi.fn(validation.images.decode.bind(validation.images))
  const checking: CompleteValidationOptions = { images: { ...validation.images, decode } }
  const repo = repository(checking), original = fixture({ image: true }), owner = original.project.document.sceneId
  await repo.save(original, null)
  const source = await repo.createSnapshot(original, 'real saved source', { expectedRevision: 0, expectedMetadataVersion: 0 })
  const current: ProjectBundle = { project: cloneJson(original.project), resources: original.resources }
  current.project.document.revision = 1; current.project.document.props.item.rotationDeg = 25
  await repo.save(current, 0)
  decode.mockClear()
  return { repo, checking, decode, original, current, owner, source }
}
async function storedCounts(repo: ProjectRepository) {
  return { pins: await repo.database.historyPins.count(), bindings: await repo.database.resourceBindings.count(),
    versions: await repo.database.historyVersions.count(), metadata: await repo.database.historyMetadata.toArray() }
}
afterEach(async () => {
  vi.restoreAllMocks()
  for (const repo of repositories.splice(0)) repo.close()
  for (const name of names) await Dexie.delete(name)
  names.clear()
})

describe('operation-owned snapshot read session', () => {
  it('reuses only identical successful pixels in one session while public snapshot loads still fully decode', async () => {
    const { repo, decode, original, owner, source } = await setup(), session = repo.beginSnapshotRead()
    const first = await session.load(owner, source.id), second = await session.load(owner, source.id)
    expect(first!.bundle.project).toEqual(original.project)
    expect(second!.bundle.project).toEqual(original.project)
    expect(decode).toHaveBeenCalledTimes(1)
    await repo.loadSnapshot(owner, source.id); await repo.loadSnapshot(owner, source.id)
    expect(decode).toHaveBeenCalledTimes(3)
    session.close()
    const next = repo.beginSnapshotRead()
    expect((await next.load(owner, source.id))!.bundle.project).toEqual(original.project)
    expect(decode).toHaveBeenCalledTimes(4)
    next.close()
  })

  it('rebuilds the source once through the final protection transaction and shares only exact reconstructed metadata', async () => {
    const { repo, current, owner, source } = await setup(), session = repo.beginSnapshotRead()
    const rebuild = vi.spyOn(projectDelta, 'applyProjectDeltaChain'), metadata = vi.spyOn(projectValidation, 'validateProjectData')
    expect((await session.load(owner, source.id))!.contentHash).toBe(source.contentHash)
    // One current row and one complete checkpoint. assertSnapshot consumes
    // the actual reconstruction proof instead of validating that project again.
    expect(metadata).toHaveBeenCalledTimes(2)
    const protection = await repo.createSnapshot(current, 'protected once', { kind: 'protection', expectedRevision: 1, expectedMetadataVersion: 1,
      sourceSnapshot: { id: source.id, contentHash: source.contentHash }, readSession: session })
    expect(protection.sourceRevision).toBe(1)
    expect((await session.load(owner, source.id))!.contentHash).toBe(source.contentHash)
    expect(rebuild).toHaveBeenCalledTimes(1)
    session.close()
    await repo.loadSnapshot(owner, source.id)
    expect(rebuild).toHaveBeenCalledTimes(2)
  })

  it('owns its successful result independently of caller wrapper and resource-byte mutation', async () => {
    const { repo, decode, original, owner, source } = await setup(), session = repo.beginSnapshotRead()
    const first = (await session.load(owner, source.id))!, hash = Object.keys(original.project.assets)[0]
    const exposed = await first.bundle.resources.read(hash); exposed.fill(0)
    Reflect.set(first, 'name', 'caller changed summary')
    Reflect.set(first, 'bundle', { project: cloneJson(original.project), resources: { read: async () => new Uint8Array([1, 2, 3]) } })
    const again = (await session.load(owner, source.id))!
    expect(again.name).toBe(source.name)
    expect(again.bundle.project).toEqual(original.project)
    expect(await again.bundle.resources.read(hash)).toEqual(await original.resources.read(hash))
    expect(decode).toHaveBeenCalledTimes(1)
    session.close()
  })

  it.each(['bytes', 'binding', 'checkpoint', 'current', 'pin', 'license'] as const)('rereads actual %s after a cached load and invalidates the failed session', async kind => {
    const { repo, decode, original, owner, source } = await setup(), session = repo.beginSnapshotRead()
    await session.load(owner, source.id)
    let restore: () => Promise<unknown>
    if (kind === 'bytes') {
      const hash = Object.keys(original.project.assets)[0], row = (await repo.database.resources.get(hash))!
      await repo.database.resources.put({ ...row, bytes: new Uint8Array([1, 2, 3]) })
      restore = () => repo.database.resources.put(row)
    } else if (kind === 'binding') {
      const key = [owner, 'named', source.id] as [string, 'named', string], row = (await repo.database.resourceBindings.get(key))!
      await repo.database.resourceBindings.put({ ...row, assetHashes: [] })
      restore = () => repo.database.resourceBindings.put(row)
    } else if (kind === 'checkpoint') {
      const pin = (await repo.database.historyPins.get([owner, source.id]))!, key = [owner, pin.versionId]
      const row = (await repo.database.historyVersions.get(key))!, changed = cloneJson(row)
      changed.checkpoint!.document.title = 'changed under the old content and record hashes'
      await repo.database.historyVersions.put(changed)
      restore = () => repo.database.historyVersions.put(row)
    } else if (kind === 'current') {
      const row = (await repo.database.projects.get(owner))!, changed = cloneJson(row)
      changed.project.document.title = 'damaged current owner record'
      await repo.database.projects.put(changed)
      restore = () => repo.database.projects.put(row)
    } else if (kind === 'pin') {
      const row = (await repo.database.historyPins.get([owner, source.id]))!
      await repo.database.historyPins.put({ ...row, name: 'tampered snapshot metadata' })
      restore = () => repo.database.historyPins.put(row)
    } else {
      const hash = Object.keys(original.project.licenses)[0], row = (await repo.database.licenseTexts.get(hash))!
      await repo.database.licenseTexts.put({ ...row, text: 'different actual license body' })
      restore = () => repo.database.licenseTexts.put(row)
    }
    await expect(session.load(owner, source.id)).rejects.toThrow()
    await restore()
    await expect(session.load(owner, source.id)).rejects.toThrow()
    expect(decode).toHaveBeenCalledTimes(1)
    expect((await repo.loadSnapshot(owner, source.id))!.contentHash).toBe(source.contentHash)
    expect(decode).toHaveBeenCalledTimes(2)
  })

  it('closes on cancellation or failed pixel validation and does not recover authority after retry', async () => {
    const { repo, decode, owner, source } = await setup(), cancelled = repo.beginSnapshotRead(), signal = { aborted: true }
    await expect(cancelled.load(owner, source.id, { signal })).rejects.toMatchObject({ name: 'AbortError' })
    signal.aborted = false
    await expect(cancelled.load(owner, source.id, { signal })).rejects.toThrow()
    expect(decode).not.toHaveBeenCalled()
    const failed = repo.beginSnapshotRead()
    decode.mockRejectedValueOnce(new Error('actual pixel decode rejected'))
    await expect(failed.load(owner, source.id)).rejects.toThrow('actual pixel decode rejected')
    await expect(failed.load(owner, source.id)).rejects.toThrow()
    expect(decode).toHaveBeenCalledTimes(1)
    const fresh = repo.beginSnapshotRead()
    expect((await fresh.load(owner, source.id))!.contentHash).toBe(source.contentHash)
    expect(decode).toHaveBeenCalledTimes(2)
    fresh.close()
  })

  it('does not register or return a usable result when closed during the first decode', async () => {
    const { repo, decode, owner, source } = await setup(), session = repo.beginSnapshotRead()
    decode.mockImplementationOnce(async (...args) => { session.close(); return validation.images.decode(...args) })
    await expect(session.load(owner, source.id)).rejects.toThrow()
    await expect(session.load(owner, source.id)).rejects.toThrow()
    expect(decode).toHaveBeenCalledTimes(1)
  })

  it('rejects concurrent reads and does not return the in-flight result after closing the session', async () => {
    const { repo, decode, owner, source } = await setup(), session = repo.beginSnapshotRead()
    let notifyStarted!: () => void, releaseDecode!: () => void
    const started = new Promise<void>(resolve => { notifyStarted = resolve })
    const gate = new Promise<void>(resolve => { releaseDecode = resolve })
    decode.mockImplementationOnce(async (...args) => {
      notifyStarted()
      await gate
      return validation.images.decode(...args)
    })
    const pending = session.load(owner, source.id).then(() => 'returned', () => 'rejected')
    await started
    try { await expect(session.load(owner, source.id)).rejects.toThrow(/并发/) }
    finally { releaseDecode() }
    expect(await pending).toBe('rejected')
    await expect(session.load(owner, source.id)).rejects.toThrow()
    expect(decode).toHaveBeenCalledTimes(1)
  })

  it('does not return an in-flight result when the repository closes during pixel decoding', async () => {
    const { repo, decode, owner, source } = await setup(), session = repo.beginSnapshotRead()
    let notifyStarted!: () => void, releaseDecode!: () => void
    const started = new Promise<void>(resolve => { notifyStarted = resolve })
    const gate = new Promise<void>(resolve => { releaseDecode = resolve })
    decode.mockImplementationOnce(async (...args) => {
      notifyStarted()
      await gate
      return validation.images.decode(...args)
    })
    const pending = session.load(owner, source.id).then(() => 'returned', () => 'rejected')
    await started
    repo.close()
    releaseDecode()
    expect(await pending).toBe('rejected')
    await expect(session.load(owner, source.id)).rejects.toThrow()
    expect(decode).toHaveBeenCalledTimes(1)
  })

  it('preserves the repository default cancellation signal when creating protection with a read session', async () => {
    const { repo, checking, current, owner, source } = await setup(), session = repo.beginSnapshotRead(), signal = { aborted: false }
    checking.signal = signal
    await session.load(owner, source.id)
    const before = await storedCounts(repo)
    signal.aborted = true
    await expect(repo.createSnapshot(current, 'cancelled protection', { kind: 'protection', expectedRevision: 1, expectedMetadataVersion: 1,
      sourceSnapshot: { id: source.id, contentHash: source.contentHash }, readSession: session })).rejects.toMatchObject({ name: 'AbortError' })
    expect(await storedCounts(repo)).toEqual(before)
    signal.aborted = false
    await expect(session.load(owner, source.id)).rejects.toThrow()
  })

  it('preserves the repository default cancellation signal through an ordinary snapshot transaction', async () => {
    const { repo, checking, current, owner } = await setup(), signal = { aborted: false }
    checking.signal = signal
    const before = await storedCounts(repo), internal = repo as unknown as { metadataCAS: (owner: string, expected: number) => Promise<StoredHistoryMetadata> }
    const cas = internal.metadataCAS.bind(repo)
    vi.spyOn(internal, 'metadataCAS').mockImplementationOnce(async (...args) => {
      const metadata = await cas(...args)
      signal.aborted = true
      return metadata
    })
    await expect(repo.createSnapshot(current, 'cancelled without session', { expectedRevision: 1, expectedMetadataVersion: 1 })).rejects.toMatchObject({ name: 'AbortError' })
    signal.aborted = false
    expect(await storedCounts(repo)).toEqual(before)
    expect((await repo.load(owner))!.project.document.revision).toBe(1)
  })

  it('aborts a protection write when its read session closes before transaction completion', async () => {
    const { repo, current, owner, source } = await setup(), session = repo.beginSnapshotRead()
    await session.load(owner, source.id)
    const before = await storedCounts(repo), internal = repo as unknown as { assertBudgets: (owner: string) => Promise<void> }
    const check = internal.assertBudgets.bind(repo)
    vi.spyOn(internal, 'assertBudgets').mockImplementationOnce(async (...args) => { await check(...args); session.close() })
    await expect(repo.createSnapshot(current, 'closed protection', { kind: 'protection', expectedRevision: 1, expectedMetadataVersion: 1,
      sourceSnapshot: { id: source.id, contentHash: source.contentHash }, readSession: session })).rejects.toThrow()
    expect(await storedCounts(repo)).toEqual(before)
    expect((await repo.load(owner))!.project.document.revision).toBe(1)
  })

  it('fully validates again when an image adapter method or the adapter object changes', async () => {
    const { repo, checking, decode, owner, source } = await setup(), session = repo.beginSnapshotRead()
    await session.load(owner, source.id); await session.load(owner, source.id)
    expect(decode).toHaveBeenCalledTimes(1)
    const replacement = vi.fn(validation.images.decode.bind(validation.images))
    checking.images.decode = replacement
    await session.load(owner, source.id); await session.load(owner, source.id)
    expect(replacement).toHaveBeenCalledTimes(1)
    const another = vi.fn(validation.images.decode.bind(validation.images))
    checking.images = { ...validation.images, decode: another }
    await session.load(owner, source.id)
    expect(another).toHaveBeenCalledTimes(1)
    session.close()
  })

  it('rejects forged, foreign-repository and closed read sessions without calling caller methods or writing protection', async () => {
    const { repo, checking, current, owner, source } = await setup(), before = await storedCounts(repo)
    const fake = { load: vi.fn(async () => source), close: vi.fn() } as SnapshotReadSession
    const foreign = repository(checking).beginSnapshotRead(), closed = repo.beginSnapshotRead(); closed.close()
    for (const readSession of [fake, foreign, closed]) {
      await expect(repo.createSnapshot(current, 'must not be saved', { kind: 'protection', expectedRevision: 1, expectedMetadataVersion: 1,
        sourceSnapshot: { id: source.id, contentHash: source.contentHash }, readSession })).rejects.toThrow()
      expect(await storedCounts(repo)).toEqual(before)
    }
    expect(fake.load).not.toHaveBeenCalled(); expect(fake.close).not.toHaveBeenCalled()
    foreign.close()
    expect((await repo.load(owner))!.project.document.revision).toBe(1)
  })

  it('retains the final metadata CAS when source pixels were already verified by the session', async () => {
    const { repo, current, owner, source } = await setup(), session = repo.beginSnapshotRead()
    await session.load(owner, source.id)
    await repo.database.historyMetadata.put({ ownerSceneId: owner, metadataVersion: 2 })
    const before = await storedCounts(repo)
    await expect(repo.createSnapshot(current, 'stale metadata protection', { kind: 'protection', expectedRevision: 1, expectedMetadataVersion: 1,
      sourceSnapshot: { id: source.id, contentHash: source.contentHash }, readSession: session })).rejects.toBeInstanceOf(HistoryMetadataConflictError)
    const after = await storedCounts(repo)
    expect({ ...after, metadata: before.metadata }).toEqual(before)
    expect(after.metadata).toEqual([{ ownerSceneId: owner, metadataVersion: 2 }])
    expect((await repo.load(owner))!.project.document.revision).toBe(1)
    session.close()
  })

  it('rechecks the actual source in the final protection transaction and rolls its partial writes back', async () => {
    const { repo, current, owner, source } = await setup(), session = repo.beginSnapshotRead()
    await session.load(owner, source.id)
    const before = await storedCounts(repo)
    const internal = repo as unknown as { metadataCAS: (owner: string, expected: number) => Promise<StoredHistoryMetadata> }
    const cas = internal.metadataCAS.bind(repo)
    vi.spyOn(internal, 'metadataCAS').mockImplementationOnce(async (...args) => {
      const metadata = await cas(...args)
      await repo.database.historyPins.delete([owner, source.id])
      return metadata
    })
    await expect(repo.createSnapshot(current, 'missing source protection', { kind: 'protection', expectedRevision: 1, expectedMetadataVersion: 1,
      sourceSnapshot: { id: source.id, contentHash: source.contentHash }, readSession: session })).rejects.toBeInstanceOf(HistoryMetadataConflictError)
    expect(await storedCounts(repo)).toEqual(before)
    expect((await repo.loadSnapshot(owner, source.id))!.contentHash).toBe(source.contentHash)
    expect((await repo.load(owner))!.project.document.revision).toBe(1)
    session.close()
  })

  it.each(['resource bytes', 'license text'] as const)('rejects changed final source %s and rolls the protection transaction back', async kind => {
    const { repo, current, owner, original, source } = await setup(), session = repo.beginSnapshotRead()
    await session.load(owner, source.id)
    const before = await storedCounts(repo)
    const resourceHash = Object.keys(original.project.assets)[0], licenseHash = Object.keys(original.project.licenses)[0]
    const resource = await repo.database.resources.get(resourceHash), license = await repo.database.licenseTexts.get(licenseHash)
    if (!resource || !license) throw new Error('Fixture resource/license row is missing')
    const internal = repo as unknown as { metadataCAS: (owner: string, expected: number) => Promise<StoredHistoryMetadata> }
    const cas = internal.metadataCAS.bind(repo)
    vi.spyOn(internal, 'metadataCAS').mockImplementationOnce(async (...args) => {
      const metadata = await cas(...args)
      if (kind === 'resource bytes') await repo.database.resources.put({ ...resource, bytes: new Uint8Array([1, 2, 3]) })
      else await repo.database.licenseTexts.put({ ...license, text: 'changed after the successful pixel read' })
      return metadata
    })
    await expect(repo.createSnapshot(current, `changed ${kind}`, { kind: 'protection', expectedRevision: 1, expectedMetadataVersion: 1,
      sourceSnapshot: { id: source.id, contentHash: source.contentHash }, readSession: session })).rejects.toThrow()
    expect(await storedCounts(repo)).toEqual(before)
    expect(await repo.database.resources.get(resourceHash)).toEqual(resource)
    expect(await repo.database.licenseTexts.get(licenseHash)).toEqual(license)
    expect((await repo.loadSnapshot(owner, source.id))!.contentHash).toBe(source.contentHash)
    expect((await repo.load(owner))!.project.document.revision).toBe(1)
    session.close()
  })
})
