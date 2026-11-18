import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProjectRepository } from '../../platform/browser/storage/repository.js'
import * as identityModule from '../../shared/history/identity.js'
import type { SceneDocument } from '../../shared/model/scene.js'
import { cloneJson } from '../../shared/validation/json.js'
import { fromBundle, getVerifiedEditableProject, toBundle, type EditableProject } from './project.js'
import { fixture, runtime, validation } from './test-fixtures.js'
import { Workspace } from './workspace.js'

const repositories: ProjectRepository[] = [], workspaces: Workspace[] = []
async function setup() {
  let callback: ((document: SceneDocument) => void) | undefined
  const repo = new ProjectRepository({ name: `history-snapshot-reuse-${crypto.randomUUID()}`, runtime, validation })
  const workspace = new Workspace(repo, { runtime, validation, validateCandidate(document) {
    // Each mutation belongs to one restoration callback, not to a later real
    // commit validation or a deliberately reentrant command in a Proxy trap.
    const active = callback; callback = undefined; active?.(document)
  } })
  repositories.push(repo); workspaces.push(workspace)
  await workspace.adoptNew(await fromBundle(fixture({ image: true }), validation))
  const before = workspace.getState().project!
  await workspace.updateProp('item', { rotationDeg: 25 }); await workspace.flush()
  return { repo, workspace, before, current: workspace.getState().project!, arm(next: (document: SceneDocument) => void) { callback = next } }
}
const prepare = (workspace: Workspace, candidate: EditableProject) =>
  (workspace as unknown as { prepareRestoredProject(input: EditableProject): EditableProject }).prepareRestoredProject(candidate)
afterEach(async () => {
  vi.restoreAllMocks()
  for (const workspace of workspaces.splice(0)) await workspace.close().catch(() => {})
  const retained = repositories.splice(0)
  for (const repo of retained) repo.close()
  for (const name of new Set(retained.map(repo => repo.database.name))) await Dexie.delete(name)
})

describe('exact history scene and appearance reference reuse', () => {
  it('retains real trace capture/finish and uses the exact certified scene only as an unchanged read-only finish argument', async () => {
    const { workspace, before, current, arm } = await setup(), actual = identityModule.createHistoryIdentityTrace
    const observed: { captures: Readonly<SceneDocument>[]; finishes: SceneDocument[] } = { captures: [], finishes: [] }
    vi.spyOn(identityModule, 'createHistoryIdentityTrace').mockImplementation((...args) => {
      const trace = actual(...args)
      return { ...trace,
        capture(document) { observed.captures.push(document); return trace.capture(document) },
        finish(document) { observed.finishes.push(document); return trace.finish(document) },
      }
    })
    let mutable: SceneDocument | undefined
    arm(document => { mutable = document; expect(Object.isFrozen(document)).toBe(false) })
    const restored = prepare(workspace, before)
    expect(observed.captures).toHaveLength(1)
    expect(observed.captures[0]).not.toBe(before.document)
    expect(observed.finishes).toHaveLength(1)
    expect(observed.finishes[0]).toBe(before.document)
    expect(mutable).not.toBe(before.document)
    expect(restored.document).toBe(before.document)
    expect(restored.appearance).toBe(before.appearance)
    expect(restored.historyIdentity).toEqual(before.historyIdentity)
    expect(restored.historyIdentity).not.toBe(before.historyIdentity)
    expect(getVerifiedEditableProject(restored)).toBeUndefined()
    expect(getVerifiedEditableProject(before)).toBe(before)
    expect(workspace.getState().project).toBe(current)
  })

  it.each(['spread', 'cloned-scene', 'replaced-port'] as const)('does not reuse exact scene or appearance authority for an unregistered %s wrapper', async kind => {
    const { workspace, before } = await setup()
    const candidate = Object.freeze({ ...before,
      ...(kind === 'cloned-scene' ? { document: cloneJson(before.document) } : {}),
      ...(kind === 'replaced-port' ? { resources: { read: (hash: string) => before.resources.read(hash) } } : {}),
    })
    const restored = prepare(workspace, candidate)
    expect(getVerifiedEditableProject(candidate)).toBeUndefined()
    expect(restored.document).not.toBe(candidate.document)
    expect(restored.appearance).not.toBe(candidate.appearance)
    expect(restored.document).toEqual(before.document)
    expect(restored.appearance).toEqual(before.appearance)
    expect(restored.resources).toBe(candidate.resources)
    expect(getVerifiedEditableProject(restored)).toBeUndefined()
  })

  it('preserves a legal callback change and captures it independently before a real undo commit and cold read', async () => {
    const { workspace, before, current, repo, arm } = await setup()
    let retained: SceneDocument | undefined
    arm(document => { retained = document; document.title = 'Reviewed restored title' })
    workspace.undo()
    const restored = workspace.getState().project!
    expect(restored.document.title).toBe('Reviewed restored title')
    expect(restored.document.revision).toBe(current.document.revision + 1)
    expect(restored.document).not.toBe(before.document)
    expect(restored.appearance).toEqual(before.appearance)
    expect(restored.historyIdentity).toEqual(before.historyIdentity)
    expect(getVerifiedEditableProject(restored)).toBe(restored)
    retained!.title = 'Late external write'
    expect(restored.document.title).toBe('Reviewed restored title')
    expect(before.document.title).not.toBe('Reviewed restored title')
    await workspace.flush()
    const cold = (await repo.load(restored.document.sceneId))!
    expect(cold.project).toEqual(toBundle(restored).project)
    const hash = Object.keys(restored.assets)[0]
    expect(await cold.resources.read(hash)).toEqual(await before.resources.read(hash))
  })

  it('keeps both persistent-navigation callbacks mutable and saves a legal second-callback edit with its protection and original history intact', async () => {
    const { workspace, before, current, repo, arm } = await setup(), owner = before.document.sceneId
    const initial = (await repo.listHistoryVersions(owner)).versions.find(row => row.automatic && row.revision === 0)!
    expect(initial).toBeDefined()
    const source = (await repo.loadHistoryVersion(owner, initial.id))!, original = cloneJson(source.project)
    const hash = Object.keys(source.project.assets)[0], bytes = await source.resources.read(hash)
    let first: SceneDocument | undefined, second: SceneDocument | undefined
    arm(document => {
      first = document
      expect(Object.isFrozen(document)).toBe(false)
      expect(Object.isFrozen(document.props.item.positionMm)).toBe(false)
      arm(next => {
        second = next
        expect(Object.isFrozen(next)).toBe(false)
        expect(Object.isFrozen(next.props.item.positionMm)).toBe(false)
        next.title = 'Second persistent-navigation callback'
      })
    })
    const protection = await workspace.navigateHistoryVersion(initial.id), restored = workspace.getState().project!
    expect(first).toBeDefined()
    expect(second).toBeDefined()
    expect(second).not.toBe(first)
    expect(restored.document).not.toBe(second)
    expect(restored.document).toMatchObject({ title: 'Second persistent-navigation callback', revision: current.document.revision + 1,
      props: { item: { rotationDeg: before.document.props.item.rotationDeg } } })
    expect(restored.historyIdentity).toEqual(before.historyIdentity)
    expect(workspace.getState().status).toBe('saved')
    expect(protection).toMatchObject({ kind: 'protection', sourceRevision: current.document.revision })
    expect((await repo.listSnapshots(owner)).some(row => row.id === protection.id && row.kind === 'protection')).toBe(true)
    expect((await repo.loadHistoryVersion(owner, initial.id))!.project).toEqual(original)
    second!.title = 'Late mutation of the retained second callback argument'
    expect(restored.document.title).toBe('Second persistent-navigation callback')
    const expected = cloneJson(toBundle(restored).project), name = repo.database.name
    await workspace.close(); repo.close()
    const cold = new ProjectRepository({ name, runtime, validation }); repositories.push(cold)
    const loaded = (await cold.load(owner))!
    expect(loaded.project).toEqual(expected)
    expect(await loaded.resources.read(hash)).toEqual(bytes)
    expect((await cold.loadHistoryVersion(owner, initial.id))!.project).toEqual(original)
    expect((await cold.listSnapshots(owner)).some(row => row.id === protection.id && row.kind === 'protection')).toBe(true)
  })

  it('uses the descriptor-captured legal value when a nested Proxy get reports the unchanged value', async () => {
    const { workspace, before, current, arm } = await setup(), x = before.document.props.item.positionMm.x
    const getX = vi.fn(() => x)
    arm(document => {
      document.props.item.positionMm = new Proxy({ ...document.props.item.positionMm }, {
        get(target, key, receiver) { return key === 'x' ? getX() : Reflect.get(target, key, receiver) },
        getOwnPropertyDescriptor(target, key) {
          const descriptor = Reflect.getOwnPropertyDescriptor(target, key)
          return key === 'x' ? { ...descriptor, value: x + 10 } : descriptor
        },
      })
    })
    workspace.undo()
    expect(getX).not.toHaveBeenCalled()
    expect(workspace.getDocument()!.props.item.positionMm.x).toBe(x + 10)
    expect(workspace.getDocument()!.revision).toBe(current.document.revision + 1)
    expect(before.document.props.item.positionMm.x).toBe(x)
  })

  it('rejects a descriptor-captured invalid domain value even when Proxy get pretends to be the exact historical value', async () => {
    const { workspace, before, current, arm } = await setup(), x = before.document.props.item.positionMm.x
    const getX = vi.fn(() => x)
    arm(document => {
      document.props.item.positionMm = new Proxy({ ...document.props.item.positionMm }, {
        get(target, key, receiver) { return key === 'x' ? getX() : Reflect.get(target, key, receiver) },
        getOwnPropertyDescriptor(target, key) {
          const descriptor = Reflect.getOwnPropertyDescriptor(target, key)
          return key === 'x' ? { ...descriptor, value: 'invalid-domain-coordinate' } : descriptor
        },
      })
    })
    expect(() => workspace.undo()).toThrow()
    expect(getX).not.toHaveBeenCalled()
    expect(workspace.getState().project).toBe(current)
    expect(workspace.getState()).toMatchObject({ canUndo: true, canRedo: false })
    expect(before.document.props.item.positionMm.x).toBe(x)
  })

  it.each(['plain', 'proxy'] as const)('rejects a nested %s accessor after the callback without evaluating it or changing history', async kind => {
    const { workspace, before, current, arm } = await setup(), read = vi.fn(() => before.document.props.item.positionMm.x)
    arm(document => {
      const target = { ...document.props.item.positionMm }
      document.props.item.positionMm = kind === 'plain'
        ? Object.defineProperty(target, 'x', { configurable: true, enumerable: true, get: read })
        : new Proxy(target, { getOwnPropertyDescriptor(object, key) {
          return key === 'x' ? { configurable: true, enumerable: true, get: read } : Reflect.getOwnPropertyDescriptor(object, key)
        } })
    })
    expect(() => workspace.undo()).toThrow(/访问器/)
    expect(read).not.toHaveBeenCalled()
    expect(workspace.getState().project).toBe(current)
    expect(workspace.getState()).toMatchObject({ canUndo: true, canRedo: false })
  })

  it('rechecks the checkpoint after a Proxy capture trap reenters and commits another real history operation', async () => {
    const { workspace, before, current, arm } = await setup()
    let reentered = false, nested: EditableProject | undefined
    arm(document => {
      document.props.item.positionMm = new Proxy({ ...document.props.item.positionMm }, {
        getOwnPropertyDescriptor(target, key) {
          if (key === 'x' && !reentered) {
            reentered = true
            workspace.undo()
            nested = workspace.getState().project!
          }
          return Reflect.getOwnPropertyDescriptor(target, key)
        },
      })
    })
    expect(() => prepare(workspace, before)).toThrow(/准备期间场景已有修改/)
    expect(reentered).toBe(true)
    expect(nested).toBeDefined()
    expect(workspace.getState().project).toBe(nested)
    expect(workspace.getDocument()!.revision).toBe(current.document.revision + 1)
    expect(workspace.getDocument()!.props.item.rotationDeg).toBe(before.document.props.item.rotationDeg)
    expect(workspace.getState()).toMatchObject({ canUndo: false, canRedo: true })
  })
})
