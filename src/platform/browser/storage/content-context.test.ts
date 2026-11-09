import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fixture, runtime, validation } from '../../../application/workspace/test-fixtures.js'
import { Workspace } from '../../../application/workspace/workspace.js'
import { fromBundle, toBundle } from '../../../application/workspace/project.js'
import { validateProjectBundle } from '../../../shared/project/resources.js'
import { canonicalJson, cloneJson, encodeUtf8 } from '../../../shared/validation/json.js'
import { canonicalProjectCoordinates } from '../../../shared/aggregates/scene-coordinates.js'
import { sha256Bytes } from '../../../shared/project/binary.js'
import * as projectValidation from '../../../shared/project/validate.js'
import * as blocks from './content-blocks.js'
import { ownedEncodedSnapshot, prepareEncodedSnapshot, releaseEncodedSnapshot, snapshotContentPartition } from './content-context.js'
import { ProjectRepository } from './repository.js'
import { PROJECT_TABLES } from './database.js'

const repositories: ProjectRepository[] = []
const repository = () => {
  const repo = new ProjectRepository({ name: `content-context-${crypto.randomUUID()}`, runtime, validation })
  repositories.push(repo); return repo
}
afterEach(async () => {
  vi.restoreAllMocks()
  for (const repo of repositories.splice(0)) { const name = repo.database.name; repo.close(); await Dexie.delete(name) }
})

describe('owned save content and native transaction context', () => {
  it('owns mutable partition bytes and independent concurrent operation handles', async () => {
    const bundle = await validateProjectBundle(fixture(), validation)
    const first = prepareEncodedSnapshot(bundle), second = prepareEncodedSnapshot(bundle)
    expect(first).not.toBe(second)
    const expected = snapshotContentPartition(second), returned = snapshotContentPartition(first)
    returned.manifest.fields[0].path[0] = 'poisoned'
    returned.blocks.forEach(block => block.bytes.fill(0))
    expect(snapshotContentPartition(first)).toEqual(expected)
    releaseEncodedSnapshot(first)
    expect(snapshotContentPartition(second)).toEqual(expected)
    const a = repository(), b = repository()
    await Promise.all([a.saveSnapshot(bundle, null), b.saveSnapshot(bundle, null)])
    expect((await a.load(bundle.project.document.sceneId))!.project).toEqual(bundle.project)
    expect((await b.load(bundle.project.document.sceneId))!.project).toEqual(bundle.project)
    releaseEncodedSnapshot(second)
  })

  it('shares strict materialization inside one read transaction without sharing mutable returns', async () => {
    const repo = repository(), input = fixture(), owner = input.project.document.sceneId
    await repo.save(input, null)
    const head = (await repo.database.historyHeads.get(owner))!
    const materialize = vi.spyOn(blocks, 'materializeProjectContent')
    const nativeGet = IDBObjectStore.prototype.get, blockReads: string[] = []
    vi.spyOn(IDBObjectStore.prototype, 'get').mockImplementation(function (this: IDBObjectStore, key) {
      if (this.name === 'projectContentBlocks') blockReads.push(String(key))
      return nativeGet.call(this, key)
    })
    await repo.database.transaction('r', PROJECT_TABLES, async () => {
      const [first, parallel] = await Promise.all([repo.database.projects.get(owner), repo.database.projects.get(owner), repo.database.historyVersions.get([owner, head.activeVersionId])])
      expect(parallel!.project).toEqual(input.project)
      expect(first).toBeDefined()
      first!.project.document.title = 'mutated returned view'
      expect((await repo.database.projects.get(owner))!.project.document.title).toBe(input.project.document.title)
      expect(await repo.database.projects.where('sceneId').equals(owner).count()).toBe(1)
    })
    expect(materialize).toHaveBeenCalledTimes(1)
    expect(new Set(blockReads).size).toBe(blockReads.length)
    await repo.database.projects.get(owner)
    expect(materialize).toHaveBeenCalledTimes(2) // Another tx must read actual blocks again.
  })

  it('invalidates same-transaction block reads on an owned mutation and rolls bad bytes back', async () => {
    const repo = repository(), input = fixture(), owner = input.project.document.sceneId
    await repo.save(input, null)
    const partition = blocks.partitionProjectContent(input.project), original = partition.blocks[0]
    await expect(repo.database.transaction('rw', PROJECT_TABLES, async () => {
      await repo.database.projects.get(owner)
      await repo.database.projects.update(owner, { savedAt: '2026-11-08T00:00:00.000Z' })
      expect((await repo.database.projects.get(owner))!.savedAt).toBe('2026-11-08T00:00:00.000Z')
      const corrupt = { sha256: original.sha256, bytes: original.bytes.slice() }; corrupt.bytes[0] ^= 1
      await repo.database.projectContentBlocks.put(corrupt)
      await repo.database.projects.get(owner)
    })).rejects.toThrow(/hash|字节|块/)
    expect((await repo.load(owner))!.project).toEqual(input.project)
    // A new transaction must also reject corruption after a prior warm read.
    await repo.database.projectContentBlocks.put({ sha256: original.sha256, bytes: new Uint8Array([1]) })
    await expect(repo.database.projects.get(owner)).rejects.toThrow(/hash|字节|块/)
  })

  it('pins both large contents and reuses the compiled checkpoint with the original full record hash', async () => {
    const repo = repository(), input = fixture(), owner = input.project.document.sceneId
    input.project.document.title = 'x'.repeat(2_150_000)
    await repo.save(input, null)
    for (let revision = 1; revision < 4; revision++) {
      const project = cloneJson(input.project); project.document.revision = revision
      await repo.save({ project, resources: input.resources }, revision - 1)
    }
    const project = cloneJson(input.project); project.document.revision = 4
    expect(canonicalProjectCoordinates(project).length * 2).toBeGreaterThan(4 * 1024 * 1024)
    const metadata = vi.spyOn(projectValidation, 'validateProjectData'), encode = vi.spyOn(blocks, 'encodeProjectContent')
    const materialize = vi.spyOn(blocks, 'materializeProjectContent')
    await repo.save({ project, resources: input.resources }, 3)
    expect(encode).toHaveBeenCalledTimes(1)
    expect(metadata).toHaveBeenCalledTimes(1) // Public input still validates; fresh bytes prove the owned baseline.
    expect(materialize).not.toHaveBeenCalled() // Actual old blocks must match before reusing their parsed endpoint.
    const rows = await repo.database.historyVersions.toArray(), checkpoint = rows.find(row => row.revision === 4)!
    expect(checkpoint.depth).toBe(0); expect(checkpoint.delta).toBeNull()
    const { recordHash, ...payload } = checkpoint
    expect(recordHash).toBe(sha256Bytes(encodeUtf8(canonicalJson({ ...payload, checkpoint: JSON.parse(canonicalProjectCoordinates(checkpoint.checkpoint!)) }))))
    const head = (await repo.database.historyHeads.get(owner))!
    expect(head.savedRevision).toBe(4)
    expect((await repo.loadHistoryVersion(owner, checkpoint.id))!.project).toEqual(project)
  }, 30000)

  it('keeps actual resource checks and final CAS on an authenticated snapshot save', async () => {
    const repo = repository(), source = fixture({ image: true }), input = await validateProjectBundle(source, validation)
    await repo.saveSnapshot(input, null)
    const project = cloneJson(input.project); project.document.revision = 1
    const next = await validateProjectBundle({ project, resources: input.resources }, validation)
    await expect(repo.saveSnapshot(next, 7)).rejects.toThrow(/冲突/)
    const resource = (await repo.database.resources.toArray())[0]
    await repo.database.resources.put({ ...resource, bytes: new Uint8Array([1, 2, 3]) })
    await expect(repo.saveSnapshot(next, 0)).rejects.toThrow(/hash|字节/)
    expect((await repo.database.projects.get(project.document.sceneId))!.revision).toBe(0)
  })

  it('freshly reads every warm baseline block while reusing its exact immutable parse and domain proof', async () => {
    const repo = repository(), workspace = new Workspace(repo, { runtime, validation })
    try {
      await workspace.adoptNew(await fromBundle(fixture(), validation))
      await workspace.updateProp('item', { rotationDeg: 90 }); await workspace.flush()
      await workspace.updateProp('item', { rotationDeg: 180 })
      const expected = toBundle(workspace.getState().project!).project
      const metadata = vi.spyOn(projectValidation, 'validateProjectData'), materialize = vi.spyOn(blocks, 'materializeProjectContent')
      const nativeGet = IDBObjectStore.prototype.get, nativeReads: string[] = []
      vi.spyOn(IDBObjectStore.prototype, 'get').mockImplementation(function (this: IDBObjectStore, key) {
        if (this.name === 'projectContentBlocks') nativeReads.push(String(key))
        return nativeGet.call(this, key)
      })
      await workspace.flush()
      expect(nativeReads.length).toBeGreaterThan(0)
      expect(metadata).not.toHaveBeenCalled(); expect(materialize).not.toHaveBeenCalled()
      expect(workspace.getState().status).toBe('saved')
      vi.restoreAllMocks(); repo.close()
      expect((await repo.load(expected.document.sceneId))!.project).toEqual(expected)
    } finally { await workspace.close().catch(() => {}) }
  })

  it('rejects damaged actual blocks after a warm save and preserves both the edited memory and committed revision', async () => {
    const repo = repository(), workspace = new Workspace(repo, { runtime, validation })
    try {
      await workspace.adoptNew(await fromBundle(fixture(), validation))
      await workspace.updateProp('item', { rotationDeg: 90 }); await workspace.flush()
      const before = toBundle(workspace.getState().project!).project, owner = before.document.sceneId
      const original = (await repo.database.projectContentBlocks.toArray())[0], damaged = { sha256: original.sha256, bytes: original.bytes.slice() }
      damaged.bytes[0] ^= 1
      await repo.database.projectContentBlocks.put(damaged)
      await workspace.updateProp('item', { rotationDeg: 180 })
      const edited = workspace.getState().project!
      await expect(workspace.flush()).rejects.toThrow(/hash|字节|块/)
      expect(workspace.getState().project).toBe(edited)
      expect(edited.document.props.item.rotationDeg).toBe(180)
      await repo.database.projectContentBlocks.put(original)
      expect((await repo.database.projects.get(owner))!.revision).toBe(before.document.revision)
      expect((await repo.load(owner))!.project).toEqual(before)
    } finally { await workspace.close().catch(() => {}) }
  })

  it('does not let a retained baseline overwrite a later committed value from another repository', async () => {
    const first = repository(), second = new ProjectRepository({ name: first.database.name, runtime, validation })
    const workspace = new Workspace(first, { runtime, validation })
    try {
      await workspace.adoptNew(await fromBundle(fixture(), validation))
      await workspace.updateProp('item', { rotationDeg: 90 }); await workspace.flush()
      const before = toBundle(workspace.getState().project!), external = cloneJson(before.project)
      external.document.revision++; external.document.title = 'other tab kept'
      await second.save({ project: external, resources: before.resources }, before.project.document.revision)
      await workspace.updateProp('item', { rotationDeg: 180 })
      const edited = workspace.getState().project
      await expect(workspace.flush()).rejects.toThrow(/冲突/)
      expect(workspace.getState().project).toBe(edited)
      expect((await second.load(external.document.sceneId))!.project).toEqual(external)
    } finally { await workspace.close().catch(() => {}); second.close() }
  })

  it.each(['repository', 'database', 'versionchange', 'blocked'] as const)('releases the committed encoding on %s close', async kind => {
    const repo = repository(), input = await validateProjectBundle(fixture(), validation)
    await repo.saveSnapshot(input, null)
    expect(ownedEncodedSnapshot(input.project)).toBeDefined()
    if (kind === 'repository') repo.close()
    else if (kind === 'database') repo.database.close()
    else repo.database.on[kind].fire(new IDBVersionChangeEvent(kind, { oldVersion: 40, newVersion: 50 }))
    expect(ownedEncodedSnapshot(input.project)).toBeUndefined()
    if (kind === 'versionchange' || kind === 'blocked') await expect(repo.open()).rejects.toThrow(/结构|失效/)
    else expect((await repo.load(input.project.document.sceneId))!.project).toEqual(input.project)
  })

  it('does not retain an encoding when a save crosses close during validation, but permits a fresh save after reopen', async () => {
    let started!: () => void, finish!: () => void
    const entered = new Promise<void>(resolve => { started = resolve }), completed = new Promise<void>(resolve => { finish = resolve })
    const images = { ...validation.images, async decode(...args: Parameters<typeof validation.images.decode>) {
      started(); await completed
      return validation.images.decode(...args)
    } }
    const input = await validateProjectBundle(fixture({ image: true }), validation)
    const repo = new ProjectRepository({ name: `content-context-${crypto.randomUUID()}`, runtime, validation: { ...validation, images } })
    repositories.push(repo)
    const pending = repo.saveSnapshot(input, null)
    try {
      await entered
      repo.close()
    } finally { finish() }
    await pending
    expect(ownedEncodedSnapshot(input.project)).toBeUndefined()
    expect((await repo.load(input.project.document.sceneId))!.project).toEqual(input.project)
    const project = cloneJson(input.project); project.document.revision++
    const next = await validateProjectBundle({ project, resources: input.resources }, validation)
    await repo.saveSnapshot(next, input.project.document.revision)
    expect(ownedEncodedSnapshot(next.project)).toBeDefined()
  })
})
