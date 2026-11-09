import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProjectRepository } from '../../platform/browser/storage/repository.js'
import { cloneJson } from '../../shared/validation/json.js'
import { fromBundle, toBundle } from './project.js'
import { Workspace, type WorkspaceRepository } from './workspace.js'
import { fixture, runtime, validation } from './test-fixtures.js'

const repositories: ProjectRepository[] = [], workspaces: Workspace[] = []
const deferred = () => {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}
async function setup(image = false) {
  // Capture the actual methods before the initial proof, so this spy does not
  // simulate replacing the runtime capability after a snapshot was certified.
  const decode = vi.fn(validation.images.decode)
  const options = { images: { ...validation.images, decode } }
  const repo = new ProjectRepository({ name: `snapshot-workspace-${crypto.randomUUID()}`, runtime, validation: options })
  repositories.push(repo)
  const workspace = new Workspace(repo, { runtime, validation: options })
  workspaces.push(workspace)
  await workspace.adoptNew(await fromBundle(fixture({ image }), options))
  decode.mockClear()
  return { repo, workspace, decode, options, owner: workspace.getDocument()!.sceneId }
}
afterEach(async () => {
  for (const workspace of workspaces.splice(0)) await workspace.close().catch(() => {})
  for (const repo of repositories.splice(0)) { repo.close(); await Dexie.delete(repo.database.name) }
  vi.restoreAllMocks()
})

describe('workspace snapshot persistence', () => {
  it('reuses unchanged owned pixels for automatic saves while public saves and cold reads still validate', async () => {
    const { repo, workspace, decode, owner } = await setup(true)
    const auto = vi.spyOn(repo, 'saveSnapshot'), external = vi.spyOn(repo, 'save')
    await workspace.updateProp('item', { rotationDeg: 15 })
    await workspace.flush()
    expect(auto).toHaveBeenCalledTimes(1)
    expect(external).not.toHaveBeenCalled()
    expect(decode).not.toHaveBeenCalled()
    const snapshot = workspace.getState().project!
    const data = cloneJson(toBundle(snapshot).project)
    data.document.revision++
    await repo.save({ project: data, resources: snapshot.resources }, 1)
    expect(decode).toHaveBeenCalledTimes(1)
    expect((await repo.load(owner))!.project.document.revision).toBe(2)
    expect(decode).toHaveBeenCalledTimes(2)
    // This workspace deliberately no longer owns the persisted head.
  })

  it('never marks a newer edit saved when an older snapshot finishes and serializes the following write', async () => {
    const { repo, workspace, owner } = await setup()
    const enteredFirst = deferred(), releaseFirst = deferred(), enteredSecond = deferred(), releaseSecond = deferred()
    const write = repo.saveSnapshot.bind(repo)
    let active = 0, maximum = 0
    const observed: { revision: number; status: string }[] = []
    const unsubscribe = workspace.subscribe(() => observed.push({ revision: workspace.getDocument()!.revision, status: workspace.getState().status }))
    const spy = vi.spyOn(repo, 'saveSnapshot')
      .mockImplementationOnce(async (...args) => {
        maximum = Math.max(maximum, ++active)
        enteredFirst.resolve()
        try { await releaseFirst.promise; return await write(...args) } finally { active-- }
      })
      .mockImplementationOnce(async (...args) => {
        maximum = Math.max(maximum, ++active)
        enteredSecond.resolve()
        try { await releaseSecond.promise; return await write(...args) } finally { active-- }
      })
    try {
      await workspace.updateProp('item', { rotationDeg: 10 })
      const flushing = workspace.flush()
      await enteredFirst.promise
      await workspace.updateProp('item', { rotationDeg: 20 })
      releaseFirst.resolve()
      await enteredSecond.promise
      expect(workspace.getState().status).toBe('saving')
      expect((await repo.load(owner))!.project.document.revision).toBe(1)
      expect(observed).not.toContainEqual({ revision: 2, status: 'saved' })
      releaseSecond.resolve()
      await flushing
      expect(maximum).toBe(1)
      expect(spy.mock.calls.map(call => call[1])).toEqual([0, 1])
      expect(workspace.getState()).toMatchObject({ status: 'saved', project: { document: { revision: 2 } } })
      expect((await repo.load(owner))!.project.document.props.item.rotationDeg).toBe(20)
    } finally { releaseFirst.resolve(); releaseSecond.resolve(); unsubscribe() }
  })

  it('keeps the edited memory and undo when actual stored resource bytes have been corrupted', async () => {
    const { repo, workspace, owner } = await setup(true)
    const original = workspace.getState().project!, hash = Object.keys(original.assets)[0]
    const row = (await repo.database.resources.get(hash))!
    await repo.database.resources.put({ ...row, bytes: new Uint8Array(row.bytes.length) })
    await workspace.updateProp('item', { rotationDeg: 25 })
    await expect(workspace.flush()).rejects.toThrow(/字节|hash|SHA|冲突/)
    expect(workspace.getState()).toMatchObject({ status: 'error', canUndo: true,
      project: { document: { revision: 1, props: { item: { rotationDeg: 25 } } } } })
    const current = await repo.database.projects.get(owner)
    expect(current?.revision).toBe(0)
    expect(workspace.getState().project!.resources).toBe(original.resources)
  })

  it('retains the full-save adapter fallback without a snapshot consumer', async () => {
    const { repo, options } = await setup(true)
    const save = vi.fn(repo.save.bind(repo))
    const port: WorkspaceRepository = {
      save,
      loadSnapshot: repo.loadSnapshot.bind(repo), createSnapshot: repo.createSnapshot.bind(repo),
      usage: repo.usage.bind(repo), importArchive: repo.importArchive.bind(repo), checkProtection: repo.checkProtection.bind(repo),
    }
    const workspace = new Workspace(port, { runtime, validation: options })
    workspaces.push(workspace)
    await workspace.adoptNew(await fromBundle(fixture({ image: true }), options))
    save.mockClear()
    await workspace.updateProp('item', { rotationDeg: 30 })
    await workspace.flush()
    expect(save).toHaveBeenCalledTimes(1)
    expect(save.mock.calls[0][1]).toBe(0)
    expect(workspace.getState().status).toBe('saved')
  })
})
