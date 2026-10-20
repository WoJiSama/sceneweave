import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHouse } from '../../core/seed'
import { migrateSceneV1 } from '../../core/v2/migration'
import { validateCompleteProjectV2 } from '../../io/v2/project-file'
import type { CompleteProjectV2 } from '../../io/v2/types'
import { forkProjectV2, WorkspaceV2, type WorkspaceRepository } from './workspace'

// These tests isolate editor concurrency. Schema/migration are real; resource validation
// has its own IO and browser suites and is replaced only at this asynchronous boundary.
vi.mock('../../io/v2/project-file', () => ({ validateCompleteProjectV2: vi.fn(async () => {}) }))
const validate = vi.mocked(validateCompleteProjectV2)
const PROP = 'p-b2'
function project(sceneId = 'scene-v2'): CompleteProjectV2 {
  return { document: migrateSceneV1(createHouse('source-v1'), { sceneId, now: '2026-10-20T00:00:00.000Z' }), assets: {}, licenses: {}, licenseBindings: [] }
}
function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}
const ticks = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }
function setup() {
  const save = vi.fn<WorkspaceRepository['save']>(async () => {})
  const workspace = new WorkspaceV2({ save })
  return { workspace, save }
}
function conflict(): Error {
  const result = new Error('another tab saved revision 8')
  result.name = 'ConflictErrorV2'
  return result
}
beforeEach(() => {
  vi.useFakeTimers()
  validate.mockReset().mockResolvedValue()
})
afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('WorkspaceV2 serial saves and recovery', () => {
  it('debounces unsaved edits into one newest revision with the loaded CAS baseline', async () => {
    const { workspace, save } = setup()
    await workspace.openPersisted(project())
    workspace.updateProp(PROP, { rotationDeg: 30 })
    workspace.updateProp(PROP, { rotationDeg: 60 })
    workspace.updateProp(PROP, { rotationDeg: 90 })
    expect(workspace.getState().status).toBe('unsaved')
    expect(save).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(119)
    expect(save).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    await workspace.flush()
    expect(save).toHaveBeenCalledTimes(1)
    expect(save.mock.calls[0][0].document.revision).toBe(3)
    expect(save.mock.calls[0][0].document.props[PROP].rotationDeg).toBe(90)
    expect(save.mock.calls[0][1]).toBe(0)
    expect(workspace.getState()).toMatchObject({ status: 'saved', error: null })
  })

  it('serializes edits made during a save and advances CAS only after commit', async () => {
    const { workspace, save } = setup(), gate = deferred()
    await workspace.openPersisted(project())
    save.mockImplementationOnce(() => gate.promise)
    workspace.updateProp(PROP, { rotationDeg: 30 })
    const flush = workspace.flush()
    expect(workspace.getState().status).toBe('saving')
    workspace.updateProp(PROP, { rotationDeg: 60 })
    workspace.updateProp(PROP, { rotationDeg: 90 })
    expect(save).toHaveBeenCalledTimes(1)
    expect(save.mock.calls[0][0].document.props[PROP].rotationDeg).toBe(30)
    gate.resolve()
    await flush
    expect(save.mock.calls.map(([input, expected]) => [input.document.revision, expected])).toEqual([[1, 0], [3, 1]])
    expect(workspace.getState().project!.document.props[PROP].rotationDeg).toBe(90)
    expect(workspace.getState().status).toBe('saved')
  })

  it('retains the newest pending edit after a failed write and retries it explicitly', async () => {
    const { workspace, save } = setup(), gate = deferred()
    await workspace.openPersisted(project())
    save.mockImplementationOnce(() => gate.promise)
    workspace.updateProp(PROP, { rotationDeg: 30 })
    const flush = workspace.flush()
    workspace.updateProp(PROP, { rotationDeg: 60 })
    gate.reject(new Error('quota failure'))
    await expect(flush).rejects.toThrow('quota failure')
    workspace.updateProp(PROP, { rotationDeg: 90 })
    await vi.advanceTimersByTimeAsync(1000)
    expect(save).toHaveBeenCalledTimes(1)
    expect(workspace.getState()).toMatchObject({ status: 'error', error: 'quota failure' })
    expect(workspace.getState().project!.document.props[PROP].rotationDeg).toBe(90)
    await workspace.retry()
    expect(save.mock.calls.map(([input, expected]) => [input.document.revision, expected])).toEqual([[1, 0], [3, 0]])
    expect(workspace.getState().status).toBe('saved')
  })

  it('keeps a conflicted branch editable and adopts only a successfully saved independent copy', async () => {
    const { workspace, save } = setup()
    await workspace.openPersisted(project())
    save.mockRejectedValueOnce(conflict())
    workspace.updateProp(PROP, { rotationDeg: 30 })
    await expect(workspace.flush()).rejects.toMatchObject({ name: 'ConflictErrorV2' })
    workspace.updateProp(PROP, { rotationDeg: 60 })
    expect(workspace.getState().status).toBe('conflict')
    await vi.advanceTimersByTimeAsync(1000)
    expect(save).toHaveBeenCalledTimes(1)
    await workspace.saveAsCopy()
    const [copy, expected] = save.mock.calls[1]
    expect(expected).toBeNull()
    expect(copy.document.sceneId).not.toBe('scene-v2')
    expect(copy.document.revision).toBe(0)
    expect(copy.document.props[PROP].rotationDeg).toBe(60)
    expect(copy.document.notes).toEqual(project().document.notes)
    expect(workspace.getState()).toMatchObject({ status: 'saved', error: null, canUndo: false, canRedo: false })
    workspace.updateProp(PROP, { rotationDeg: 90 })
    await workspace.flush()
    expect(save.mock.calls[2][0].document.sceneId).toBe(copy.document.sceneId)
    expect(save.mock.calls[2][1]).toBe(0)
  })

  it('keeps the conflict branch and history when saving its copy fails', async () => {
    const { workspace, save } = setup()
    await workspace.openPersisted(project())
    save.mockRejectedValueOnce(conflict())
    workspace.updateProp(PROP, { rotationDeg: 30 })
    await expect(workspace.flush()).rejects.toThrow()
    const before = workspace.getState().project
    save.mockRejectedValueOnce(new Error('copy quota failure'))
    await expect(workspace.saveAsCopy()).rejects.toThrow('copy quota failure')
    expect(workspace.getState().project).toBe(before)
    expect(workspace.getState()).toMatchObject({ status: 'conflict', canUndo: true, canRedo: false })
    workspace.undo()
    expect(workspace.getState().project!.document.props[PROP].rotationDeg).toBe(0)
  })

  it('does not let an old auto-save finish after a copy installs and poison its CAS baseline', async () => {
    const { workspace, save } = setup(), copying = deferred(), original = deferred()
    await workspace.openPersisted(project())
    workspace.updateProp(PROP, { rotationDeg: 30 })
    save.mockImplementation((input) => input.document.sceneId === 'scene-v2' ? original.promise : copying.promise)
    const copyOperation = workspace.saveAsCopy()
    await ticks()
    await vi.advanceTimersByTimeAsync(120)
    copying.resolve()
    await copyOperation
    // Resolve a potential old write only after the copy has installed.
    original.resolve()
    await ticks()
    const copySceneId = workspace.getState().project!.document.sceneId
    expect(copySceneId).not.toBe('scene-v2')
    workspace.updateProp(PROP, { rotationDeg: 60 })
    await workspace.flush()
    const copyEdit = save.mock.calls.find(([input]) => input.document.sceneId === copySceneId && input.document.revision === 1)
    expect(copyEdit?.[1]).toBe(0)
    expect(workspace.getState().status).toBe('saved')
  })

  it('waits for an already running original save before creating the independent copy', async () => {
    const { workspace, save } = setup(), writing = deferred()
    await workspace.openPersisted(project())
    workspace.updateProp(PROP, { rotationDeg: 30 })
    save.mockImplementationOnce(() => writing.promise)
    const flush = workspace.flush()
    const copying = workspace.saveAsCopy()
    await ticks()
    expect(save).toHaveBeenCalledTimes(1)
    writing.resolve()
    await flush
    await copying
    expect(save.mock.calls.map(([input, expected]) => [input.document.revision, expected])).toEqual([[1, 0], [0, null]])
    workspace.updateProp(PROP, { rotationDeg: 60 })
    await workspace.flush()
    expect(save.mock.calls[2][1]).toBe(0)
  })

  it('restarts the original pending queue after a failed copy without discarding its edits', async () => {
    const { workspace, save } = setup(), copying = deferred()
    await workspace.openPersisted(project())
    workspace.updateProp(PROP, { rotationDeg: 30 })
    save.mockImplementationOnce(() => copying.promise)
    const attempt = workspace.saveAsCopy()
    await ticks()
    copying.reject(new Error('copy storage failed'))
    await expect(attempt).rejects.toThrow('copy storage failed')
    expect(workspace.getState().project!.document.sceneId).toBe('scene-v2')
    expect(workspace.getState().project!.document.props[PROP].rotationDeg).toBe(30)
    await vi.advanceTimersByTimeAsync(120)
    await workspace.flush()
    expect(save.mock.calls[1][0].document.sceneId).toBe('scene-v2')
    expect(save.mock.calls[1][0].document.revision).toBe(1)
    expect(save.mock.calls[1][1]).toBe(0)
  })
})

describe('WorkspaceV2 asynchronous switching preserves current edits', () => {
  it('rejects an open result whose validation completed after the current scene changed', async () => {
    const { workspace, save } = setup(), checking = deferred()
    await workspace.openPersisted(project())
    validate.mockImplementationOnce(() => checking.promise)
    const opening = workspace.openPersisted(project('other-scene'))
    workspace.updateProp(PROP, { rotationDeg: 30 })
    checking.resolve()
    await expect(opening).rejects.toThrow('已有修改')
    expect(workspace.getState().project!.document.sceneId).toBe('scene-v2')
    expect(workspace.getState().project!.document.props[PROP].rotationDeg).toBe(30)
    expect(save).not.toHaveBeenCalled()
  })

  it('does not install a new project when edits arrive during its target save', async () => {
    const { workspace, save } = setup(), creating = deferred()
    await workspace.openPersisted(project())
    save.mockImplementationOnce(() => creating.promise)
    const adopting = workspace.adoptNew(project('new-scene'))
    await ticks()
    expect(save).toHaveBeenCalledTimes(1)
    expect(save.mock.calls[0][1]).toBeNull()
    workspace.updateProp(PROP, { rotationDeg: 30 })
    creating.resolve()
    await expect(adopting).rejects.toThrow('已有修改')
    expect(workspace.getState().project!.document.sceneId).toBe('scene-v2')
    expect(workspace.getState().project!.document.props[PROP].rotationDeg).toBe(30)
    await workspace.flush()
    expect(save.mock.calls[1][0].document.sceneId).toBe('scene-v2')
    expect(save.mock.calls[1][1]).toBe(0)
  })

  it('retains edits made while an open operation flushes the outgoing scene', async () => {
    const { workspace, save } = setup(), writing = deferred()
    await workspace.openPersisted(project())
    workspace.updateProp(PROP, { rotationDeg: 30 })
    save.mockImplementationOnce(() => writing.promise)
    const opening = workspace.openPersisted(project('other-scene'))
    await ticks()
    workspace.updateProp(PROP, { rotationDeg: 60 })
    writing.resolve()
    await expect(opening).rejects.toThrow('已有修改')
    expect(save.mock.calls.map(([input, expected]) => [input.document.sceneId, input.document.revision, expected])).toEqual([['scene-v2', 1, 0], ['scene-v2', 2, 1]])
    expect(workspace.getState().project!.document.props[PROP].rotationDeg).toBe(60)
    expect(workspace.getState().project!.document.sceneId).toBe('scene-v2')
  })

  it('rejects an explicit stale checkpoint even if validation itself succeeds', async () => {
    const { workspace, save } = setup()
    await workspace.openPersisted(project())
    const checkpoint = workspace.checkpoint()
    workspace.updateProp(PROP, { rotationDeg: 30 })
    await expect(workspace.adoptNew(project('new-scene'), checkpoint)).rejects.toThrow('已有修改')
    await expect(workspace.openPersisted(project('new-scene'), checkpoint)).rejects.toThrow('已有修改')
    expect(save).not.toHaveBeenCalled()
  })

  it('refuses an older persisted revision of the current scene before flushing or replacing its edits', async () => {
    const { workspace, save } = setup(), oldRevision = project()
    await workspace.openPersisted(oldRevision)
    workspace.updateProp(PROP, { rotationDeg: 30 })
    const current = workspace.getState().project
    await expect(workspace.openPersisted(oldRevision)).rejects.toThrow()
    expect(workspace.getState().project).toBe(current)
    expect(workspace.getState().project!.document.revision).toBe(1)
    expect(workspace.getState().project!.document.props[PROP].rotationDeg).toBe(30)
    expect(workspace.getState().canUndo).toBe(true)
    expect(save).not.toHaveBeenCalled()
    await workspace.flush()
    expect(save.mock.calls[0][0].document.revision).toBe(1)
    expect(save.mock.calls[0][1]).toBe(0)
  })

  it('leaves edits queued if they arrive while a copy waits for the already running save', async () => {
    const { workspace, save } = setup(), writing = deferred()
    await workspace.openPersisted(project())
    workspace.updateProp(PROP, { rotationDeg: 30 })
    save.mockImplementationOnce(() => writing.promise)
    const flush = workspace.flush()
    const copying = workspace.saveAsCopy()
    workspace.updateProp(PROP, { rotationDeg: 60 })
    writing.resolve()
    await flush
    await expect(copying).rejects.toThrow('已有修改')
    expect(save).toHaveBeenCalledTimes(1)
    expect(workspace.getState().project!.document.sceneId).toBe('scene-v2')
    expect(workspace.getState().project!.document.props[PROP].rotationDeg).toBe(60)
    await vi.advanceTimersByTimeAsync(120)
    await workspace.flush()
    expect(save.mock.calls[1][0].document.revision).toBe(2)
    expect(save.mock.calls[1][1]).toBe(1)
  })

  it('keeps a copy result from replacing edits made during independent creation', async () => {
    const { workspace, save } = setup(), creating = deferred()
    await workspace.openPersisted(project())
    save.mockImplementationOnce(() => creating.promise)
    const copying = workspace.saveAsCopy()
    await ticks()
    workspace.updateProp(PROP, { rotationDeg: 30 })
    expect(workspace.getState().status).toBe('unsaved')
    await vi.advanceTimersByTimeAsync(240)
    expect(save).toHaveBeenCalledTimes(1)
    creating.resolve()
    await expect(copying).rejects.toThrow('已有修改')
    expect(workspace.getState().project!.document.sceneId).toBe('scene-v2')
    expect(workspace.getState().project!.document.props[PROP].rotationDeg).toBe(30)
    await workspace.flush()
    expect(save.mock.calls[1][0].document.sceneId).toBe('scene-v2')
  })

  it('preserves current state and history if a candidate validation or new-scene write fails', async () => {
    const { workspace, save } = setup()
    await workspace.openPersisted(project())
    workspace.updateProp(PROP, { rotationDeg: 30 })
    await workspace.flush()
    const before = workspace.getState().project
    validate.mockRejectedValueOnce(new Error('missing resource'))
    await expect(workspace.openPersisted(project('bad-scene'))).rejects.toThrow('missing resource')
    save.mockRejectedValueOnce(new Error('new scene storage failed'))
    await expect(workspace.adoptNew(project('other-scene'))).rejects.toThrow('new scene storage failed')
    expect(workspace.getState().project).toBe(before)
    expect(workspace.getState()).toMatchObject({ status: 'saved', canUndo: true })
  })
})

describe('WorkspaceV2 immutable snapshots and history', () => {
  it('copies input before asynchronous validation and deeply freezes the adopted project', async () => {
    const { workspace } = setup(), checking = deferred(), input = project()
    validate.mockImplementationOnce(() => checking.promise)
    const opening = workspace.openPersisted(input)
    input.document.title = 'mutated during prepare'
    input.document.props[PROP].positionMm.x = 999999
    checking.resolve()
    await opening
    const adopted = workspace.getState().project!
    expect(adopted.document.title).toBe('雾灯宅')
    expect(adopted.document.props[PROP].positionMm.x).toBe(5000)
    expect(Object.isFrozen(adopted)).toBe(true)
    expect(Object.isFrozen(adopted.document.props[PROP].positionMm)).toBe(true)
    expect(() => { adopted.document.title = 'mutated' }).toThrow()
  })

  it('keeps previously published snapshots immutable and gives undo/redo fresh monotonic revisions', async () => {
    const { workspace, save } = setup(), input = project()
    await workspace.openPersisted(input)
    const zero = workspace.getState().project!
    workspace.updateProp(PROP, { rotationDeg: 30 })
    const one = workspace.getState().project!
    workspace.updateProp(PROP, { rotationDeg: 60 })
    const two = workspace.getState().project!
    workspace.undo()
    expect(workspace.getState().project!.document.props[PROP].rotationDeg).toBe(30)
    expect(workspace.getState().project!.document.revision).toBe(3)
    expect(workspace.getState()).toMatchObject({ canUndo: true, canRedo: true })
    workspace.undo()
    expect(workspace.getState().project!.document.props[PROP].rotationDeg).toBe(0)
    expect(workspace.getState().project!.document.revision).toBe(4)
    workspace.redo()
    expect(workspace.getState().project!.document.props[PROP].rotationDeg).toBe(30)
    expect(workspace.getState().project!.document.revision).toBe(5)
    expect([zero.document.revision, one.document.revision, two.document.revision]).toEqual([0, 1, 2])
    expect([zero, one, two].map(item => item.document.props[PROP].rotationDeg)).toEqual([0, 30, 60])
    expect(input.document.props[PROP].rotationDeg).toBe(0)
    await workspace.flush()
    expect(save.mock.calls[0][0].document.revision).toBe(5)
    expect(save.mock.calls[0][1]).toBe(0)
  })

  it('clears redo on a new edit and leaves both history stacks untouched after an invalid edit', async () => {
    const { workspace } = setup()
    await workspace.openPersisted(project())
    workspace.updateProp(PROP, { rotationDeg: 30 })
    workspace.updateProp(PROP, { rotationDeg: 60 })
    workspace.undo()
    const before = workspace.getState().project
    expect(() => workspace.updateProp(PROP, { rotationDeg: 360 })).toThrow()
    expect(workspace.getState().project).toBe(before)
    expect(workspace.getState()).toMatchObject({ canUndo: true, canRedo: true })
    workspace.updateProp(PROP, { rotationDeg: 90 })
    expect(workspace.getState().canRedo).toBe(false)
    const final = workspace.getState().project
    workspace.redo()
    expect(workspace.getState().project).toBe(final)
  })

  it('does not increment revision or schedule a save for a no-op edit', async () => {
    const { workspace, save } = setup()
    await workspace.openPersisted(project())
    const initial = workspace.getState().project
    workspace.updateProp(PROP, { rotationDeg: 0 })
    await vi.advanceTimersByTimeAsync(240)
    expect(workspace.getState().project).toBe(initial)
    expect(workspace.getState().canUndo).toBe(false)
    expect(save).not.toHaveBeenCalled()
  })

  it('forks original migration bytes and secrets without mutating the source or reusing its identity', async () => {
    const input = project(), original = new Blob([JSON.stringify(createHouse('source-v1'))], { type: 'application/json' })
    const hash = await crypto.subtle.digest('SHA-256', await original.arrayBuffer())
    input.migrationSource = { sourceSchemaVersion: 1, sourceSceneId: 'source-v1', sourceRevision: 0,
      sourceHash: Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join(''),
      migratorVersion: 'sceneweave-v1-v2@1', migratedAt: '2026-10-20T00:00:00.000Z', original }
    const source = structuredClone(input), fork = forkProjectV2(input)
    expect(input).toEqual(source)
    expect(fork.document.sceneId).not.toBe(source.document.sceneId)
    expect(fork.document.revision).toBe(0)
    expect(fork.document.notes).toEqual(source.document.notes)
    expect(fork.document.regions).toEqual(source.document.regions)
    expect(fork.assets).toEqual(source.assets)
    expect(fork.licenseBindings).toEqual(source.licenseBindings)
    expect(fork.migrationSource!.sourceHash).toBe(source.migrationSource!.sourceHash)
    expect(await fork.migrationSource!.original.arrayBuffer()).toEqual(await original.arrayBuffer())
    fork.document.notes['n-d4'].text = 'fork-only change'
    expect(input.document.notes['n-d4'].text).toBe(source.document.notes['n-d4'].text)
  })
})
