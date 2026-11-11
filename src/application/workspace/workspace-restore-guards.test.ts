import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HistoryMetadataConflictError, ProjectRepository } from '../../platform/browser/storage/repository.js'
import { fromBundle, toBundle } from './project.js'
import { Workspace } from './workspace.js'
import { fixture, runtime, validation } from './test-fixtures.js'

const repositories: ProjectRepository[] = [], workspaces: Workspace[] = [], names = new Set<string>()
function repository(name = `restore-guards-${crypto.randomUUID()}`) {
  const repo = new ProjectRepository({ name, runtime, validation })
  repositories.push(repo); names.add(name); return repo
}
async function setup(kind: 'local' | 'structure') {
  const repo = repository(), other = repository(repo.database.name), workspace = new Workspace(repo, { runtime, validation })
  workspaces.push(workspace)
  await workspace.adoptNew(await fromBundle(fixture({ building: kind === 'structure' }), validation))
  const named = await workspace.createNamedSnapshot('Before edit'), owner = workspace.getDocument()!.sceneId
  if (kind === 'local') await workspace.updateProp('item', { rotationDeg: 50 })
  else await workspace.execute([{ type: 'updateRoom', id: 'room', changes: { purpose: 'Changed room' } }])
  await workspace.flush()
  const before = workspace.getState().project!
  const apply = kind === 'local'
    ? await workspace.prepareRestore(named.id, { ids: ['item'], mode: 'transform' }).then(preview => () => workspace.applyRestore(preview))
    : await (async () => {
      const inspection = await workspace.inspectStructureRestore(named.id, { ids: ['room'], mode: 'properties' })
      const preview = await workspace.prepareStructureRestore(named.id, { ids: ['room'], mode: 'properties',
        acknowledgedDependencyIds: inspection.scope.dependencyIds, confirmedLayerIds: inspection.scope.requiredLayerIds })
      return () => workspace.applyStructureRestore(preview)
    })()
  return { repo, other, workspace, owner, before, apply }
}
afterEach(async () => {
  vi.restoreAllMocks()
  for (const workspace of workspaces.splice(0)) await workspace.close().catch(() => {})
  for (const repo of repositories.splice(0)) repo.close()
  for (const name of names) await Dexie.delete(name)
  names.clear()
})

describe('limited restoration protection ownership', () => {
  it.each(['local', 'structure'] as const)('rejects %s restoration before adoption if another connection removes protection', async kind => {
    const { repo, other, workspace, owner, before, apply } = await setup(kind), create = repo.createSnapshot.bind(repo)
    vi.spyOn(repo, 'createSnapshot').mockImplementationOnce(async (...args) => {
      const snapshot = await create(...args), usage = await other.usage(owner)
      await other.deleteSnapshot(owner, snapshot.id, snapshot.contentHash, usage.metadataVersion)
      return snapshot
    })
    await expect(apply()).rejects.toBeInstanceOf(HistoryMetadataConflictError)
    expect(workspace.getState().project).toBe(before)
    expect((await other.load(owner))!.project).toEqual(toBundle(before).project)
  })

  it.each(['local', 'structure'] as const)('keeps adopted %s memory and undo when protection disappears before the final write', async kind => {
    const { repo, other, workspace, owner, before, apply } = await setup(kind), save = repo.saveSnapshot.bind(repo)
    const protection = await apply()
    vi.spyOn(repo, 'saveSnapshot').mockImplementationOnce(async (...args) => {
      const usage = await other.usage(owner)
      await other.deleteSnapshot(owner, protection.id, protection.contentHash, usage.metadataVersion)
      return save(...args)
    })
    await expect(workspace.flush()).rejects.toBeInstanceOf(HistoryMetadataConflictError)
    expect(workspace.getDocument()!.revision).toBe(before.document.revision + 1)
    expect(workspace.getState()).toMatchObject({ status: 'error', canUndo: true })
    expect((await other.load(owner))!.project).toEqual(toBundle(before).project)
  })

  it('consumes a successful guard for descendants edited while its first save is in flight', async () => {
    const { repo, other, workspace, owner, apply } = await setup('local'), save = repo.saveSnapshot.bind(repo)
    await apply()
    let started!: () => void, release!: () => void
    const entered = new Promise<void>(resolve => { started = resolve }), gate = new Promise<void>(resolve => { release = resolve })
    const calls = vi.spyOn(repo, 'saveSnapshot').mockImplementationOnce(async (...args) => {
      started(); await gate; return save(...args)
    })
    const pending = workspace.flush()
    await entered
    try { await workspace.updateProp('item', { rotationDeg: 75 }) } finally { release() }
    await pending
    expect(calls).toHaveBeenCalledTimes(2)
    expect(calls.mock.calls[0][2]?.guard).toBeDefined()
    expect(calls.mock.calls[1][2]?.guard).toBeUndefined()
    expect((await other.load(owner))!.project.document.props.item.rotationDeg).toBe(75)
    await workspace.updateProp('item', { rotationDeg: 90 }); await workspace.flush()
    expect(calls.mock.calls[2][2]?.guard).toBeUndefined()
  })

  it('retains the same required guard across a failed save and later edits until retry succeeds', async () => {
    const { repo, workspace, apply } = await setup('local')
    await apply()
    const save = vi.spyOn(repo, 'saveSnapshot').mockRejectedValueOnce(new Error('temporary storage failure'))
    await expect(workspace.flush()).rejects.toThrow('temporary storage failure')
    await workspace.updateProp('item', { rotationDeg: 75 })
    await workspace.retry()
    expect(save.mock.calls[0][2]?.guard).toBeDefined()
    expect(save.mock.calls[1][2]?.guard).toBe(save.mock.calls[0][2]?.guard)
    expect(workspace.getState().status).toBe('saved')
  })
})
