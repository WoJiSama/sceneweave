import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProjectRepository } from '../../platform/browser/storage/repository.js'
import { cloneJson } from '../../shared/validation/json.js'
import { projectContentHash } from '../../shared/project/validate.js'
import { fromBundle, getVerifiedEditableProject, toBundle } from './project.js'
import { Workspace } from './workspace.js'
import { fixture, runtime, validation } from './test-fixtures.js'
import type { CompositionCommand } from '../../shared/model/appearance.js'

const repos: ProjectRepository[] = [], sessions: Workspace[] = [], names: string[] = []
function repository(name = `m20f-session-${crypto.randomUUID()}`) {
  const repo = new ProjectRepository({ name, runtime, validation }); repos.push(repo); names.push(name); return repo
}
async function setup(options: { building?: boolean; image?: boolean } = {}) {
  const repo = repository(), project = await fromBundle(fixture(options), validation), workspace = new Workspace(repo, { runtime, validation })
  sessions.push(workspace); await workspace.adoptNew(project)
  return { repo, workspace, project, owner: project.document.sceneId }
}
afterEach(async () => {
  for (const session of sessions.splice(0)) await session.close().catch(() => {})
  vi.restoreAllMocks()
  for (const repo of repos.splice(0)) repo.close()
  for (const name of names.splice(0)) await Dexie.delete(name)
})

describe('native complete-v1 workspace and repository boundary', () => {
  it('reuses an owned preparation for adoption and reopen while persistence still decodes its real bytes', async () => {
    const repo = repository(), project = await fromBundle(fixture({ image: true }), validation)
    const decode = vi.spyOn(validation.images, 'decode'), workspace = new Workspace(repo, { runtime, validation })
    sessions.push(workspace)
    await workspace.adoptNew(project)
    expect(decode).toHaveBeenCalledTimes(1)
    expect(workspace.getState().project).toBe(project)
    await workspace.openPersisted(project)
    expect(workspace.getState().project).toBe(project)
    expect(decode).toHaveBeenCalledTimes(1)
    const cold = await repo.load(project.document.sceneId)
    expect(decode).toHaveBeenCalledTimes(2)
    expect(cold!.project.document).toEqual(project.document)
  })

  it('fully validates unowned frozen wrappers instead of reusing a replaced resource port', async () => {
    const { workspace, repo } = await setup(), current = workspace.getState().project
    const prepared = await fromBundle(fixture({ image: true }), validation)
    const forged = Object.freeze({ ...prepared, resources: Object.freeze({ read: async () => new Uint8Array([1, 2, 3]) }) })
    await expect(workspace.adoptNew(forged)).rejects.toThrow(/字节/)
    await expect(workspace.openPersisted(forged)).rejects.toThrow(/字节/)
    expect(workspace.getState().project).toBe(current)
    expect(await repo.list()).toHaveLength(1)
  })

  it('does not install or save an owned prepared project after cancellation', async () => {
    const repo = repository(), signal = { aborted: false }
    const workspace = new Workspace(repo, { runtime, validation: { ...validation, signal } })
    sessions.push(workspace)
    const initial = await fromBundle(fixture(), validation)
    await workspace.adoptNew(initial)
    const next = await fromBundle(fixture({ image: true }), validation)
    signal.aborted = true
    await expect(workspace.adoptNew(next)).rejects.toMatchObject({ name: 'AbortError' })
    await expect(workspace.openPersisted(next)).rejects.toMatchObject({ name: 'AbortError' })
    expect(workspace.getState().project).toBe(initial)
    expect(await repo.list()).toHaveLength(1)
  })

  it('saves full native v1 and advances revisions monotonically across edit, undo, redo and cold reopen', async () => {
    const { repo, workspace, owner } = await setup()
    await workspace.updateProp('item', { rotationDeg: 20 }); await workspace.flush()
    workspace.undo(); expect(workspace.getDocument()!.revision).toBe(2)
    workspace.redo(); expect(workspace.getDocument()!.revision).toBe(3)
    await workspace.flush(); repo.close()
    const loaded = await repository(repo.database.name).load(owner)
    expect(loaded!.project.document).toMatchObject({ format: 'sceneweave-scene', schemaVersion: 1, revision: 3, props: { item: { rotationDeg: 20 } } })
    expect(loaded!.project).toMatchObject({ format: 'sceneweave-complete-project', schemaVersion: 1, authoringSources: {} })
    expect(Object.keys(loaded!)).toEqual(['project', 'resources'])
    expect(await repo.listAutomaticSnapshots(owner)).toHaveLength(3)
  })

  it.each(['execute', 'preview'] as const)('keeps equal parsed content outside history and storage through %s, including negative zero', async method => {
    const input = fixture()
    input.project.document.props = Object.fromEntries(Object.entries(input.project.document.props).reverse())
    const repo = repository(), project = await fromBundle(input, validation), workspace = new Workspace(repo, { runtime, validation })
    sessions.push(workspace); await workspace.adoptNew(project)
    const automaticBefore = await repo.listAutomaticSnapshots(project.document.sceneId)
    const apply = async (commands: CompositionCommand[]) => {
      if (method === 'execute') await workspace.execute(commands)
      else await workspace.adoptPreview(await workspace.preview(commands))
    }
    const before = workspace.getState().project!, save = vi.spyOn(repo, 'save'), point = before.document.props.item.positionMm
    expect(Object.hasOwn(before.document, 'visual')).toBe(false)
    await apply([{ type: 'updateProp', id: 'item', changes: { rotationDeg: -0, positionMm: { y: point.y, x: point.x } } }])
    await workspace.flush()
    expect(workspace.getState()).toMatchObject({ project: before, status: 'saved', canUndo: false, canRedo: false, lastTransaction: null })
    expect(workspace.getState().project).toBe(before)
    expect(save).not.toHaveBeenCalled()
    expect(await repo.listAutomaticSnapshots(project.document.sceneId)).toEqual(automaticBefore)
    expect((await repo.load(project.document.sceneId))!.project.document.revision).toBe(0)

    await apply([{ type: 'updateProp', id: 'item', changes: { rotationDeg: 25 } }])
    await workspace.flush()
    expect(workspace.getDocument()).toMatchObject({ revision: 1, props: { item: { rotationDeg: 25 } } })
    const changed = workspace.getState().project
    await apply([{ type: 'updateProp', id: 'item', changes: { rotationDeg: 25 } }])
    await workspace.flush()
    expect(workspace.getState().project).toBe(changed)
    expect(save).toHaveBeenCalledTimes(1)
    workspace.undo()
    expect(workspace.getDocument()).toMatchObject({ revision: 2, props: { item: { rotationDeg: 0 } } })
    expect(workspace.getState()).toMatchObject({ canUndo: false, canRedo: true })
  })

  it.each(['execute', 'preview'] as const)('commits appearance array order changes through %s even when resolved scene fields are equal', async method => {
    const { workspace } = await setup()
    const first = { id: 'disabled-opacity', kind: 'opacity' as const, value: .4, enabled: false }
    const second = { id: 'disabled-shadow', kind: 'shadowClass' as const, value: 'none' as const, enabled: false }
    const scope = { kind: 'targets' as const, ids: ['item'] }
    await workspace.execute([{ type: 'setAppearanceAdjustment', scope, adjustment: first }, { type: 'setAppearanceAdjustment', scope, adjustment: second }])
    const before = workspace.getState().project!
    const commands: CompositionCommand[] = [{ type: 'removeAppearanceAdjustment', scope, adjustmentId: first.id }, { type: 'setAppearanceAdjustment', scope, adjustment: first }]
    if (method === 'execute') await workspace.execute(commands)
    else await workspace.adoptPreview(await workspace.preview(commands))
    expect(workspace.getDocument()!.revision).toBe(2)
    expect(workspace.getDocument()!.props).toEqual(before.document.props)
    expect(workspace.getState().project!.appearance.instanceAdjustments.item).toEqual([second, first])
    workspace.undo()
    expect(workspace.getState().project!.appearance.instanceAdjustments.item).toEqual([first, second])
  })

  it('retains private proof across execute, preview adoption, undo and redo while cold reads still decode', async () => {
    const { repo, workspace, owner } = await setup({ image: true })
    const decode = vi.spyOn(validation.images, 'decode')
    let current = workspace.getState().project!
    expect(getVerifiedEditableProject(current)).toBe(current)
    await workspace.updateProp('item', { rotationDeg: 15 })
    current = workspace.getState().project!
    expect(getVerifiedEditableProject(current)).toBe(current)
    await workspace.flush()
    expect(decode).toHaveBeenCalledTimes(1)

    const firstResources = current.resources
    await workspace.updateProp('item', { rotationDeg: 35 })
    current = workspace.getState().project!
    expect(getVerifiedEditableProject(current)).toBe(current)
    expect(current.resources).toBe(firstResources)
    await workspace.flush()
    expect(decode).toHaveBeenCalledTimes(2)

    const preview = await workspace.preview([{ type: 'updateProp', id: 'other', changes: { rotationDeg: 25 } }])
    expect(getVerifiedEditableProject(preview.project)).toBe(preview.project)
    expect(decode).toHaveBeenCalledTimes(2)
    await workspace.adoptPreview(preview)
    current = workspace.getState().project!
    expect(getVerifiedEditableProject(current)).toBe(current)
    expect(decode).toHaveBeenCalledTimes(3)
    await workspace.flush()
    expect(decode).toHaveBeenCalledTimes(4)

    workspace.undo()
    current = workspace.getState().project!
    expect(getVerifiedEditableProject(current)).toBe(current)
    expect(current.document.props.other.rotationDeg).toBe(0)
    workspace.redo()
    current = workspace.getState().project!
    expect(getVerifiedEditableProject(current)).toBe(current)
    expect(current.document).toMatchObject({ revision: 5, props: { item: { rotationDeg: 35 }, other: { rotationDeg: 25 } } })
    expect(decode).toHaveBeenCalledTimes(4)

    await workspace.flush()
    expect(decode).toHaveBeenCalledTimes(5)
    const cold = await repo.load(owner)
    expect(cold).not.toBeNull()
    expect(decode).toHaveBeenCalledTimes(6)
    const reopened = await fromBundle(cold!, validation)
    expect(getVerifiedEditableProject(reopened)).toBe(reopened)
    expect(decode).toHaveBeenCalledTimes(7)
  })

  it('keeps previews outside history, enforces their origin/baseline, locks and command budget', async () => {
    const { workspace, repo, owner } = await setup()
    const preview = await workspace.preview([{ type: 'updateProp', id: 'item', changes: { rotationDeg: 45 } }])
    expect(workspace.getDocument()!.revision).toBe(0); expect((await repo.load(owner))!.project.document.revision).toBe(0)
    await expect(workspace.adoptPreview({ ...preview })).rejects.toThrow(/不可重复采用/)
    await workspace.updateProp('other', { rotationDeg: 30 })
    await expect(workspace.adoptPreview(preview)).rejects.toThrow(/已有修改/)
    const latest = workspace.getState().project
    await expect(workspace.execute(Array.from({ length: 257 }, () => ({ type: 'updateProp' as const, id: 'item', changes: { rotationDeg: 20 } })))).rejects.toThrow(/256/)
    expect(workspace.getState().project).toBe(latest)
    let getters = 0
    const untrusted = { type: 'updateProp' as const, id: 'item', changes: { rotationDeg: 15 } }
    Object.defineProperty(untrusted, 'changes', { enumerable: true, get() { getters++; return { rotationDeg: 15 } } })
    await expect(workspace.execute([untrusted])).rejects.toThrow(/访问器/); expect(getters).toBe(0)
    await workspace.execute([{ type: 'setEditLock', kind: 'prop', id: 'item', locked: true }])
    await expect(workspace.updateProp('item', { rotationDeg: 90 })).rejects.toThrow(/锁/)
  })

  it('creates a saved protection before scoped restoration and preserves edits outside that scope', async () => {
    const { workspace, repo, owner } = await setup()
    const named = await workspace.createNamedSnapshot('initial')
    await workspace.updateProp('item', { rotationDeg: 50 }); await workspace.updateProp('other', { rotationDeg: 70 })
    const before = workspace.getState().project!, preview = await workspace.prepareRestore(named.id, { ids: ['item'], mode: 'transform' })
    expect(getVerifiedEditableProject(preview.project)).toBe(preview.project)
    const protection = await workspace.applyRestore(preview)
    expect(protection.kind).toBe('protection'); expect(protection.project.document.revision).toBe(2)
    expect(workspace.getDocument()).toMatchObject({ revision: 3, props: { item: { rotationDeg: 0 }, other: { rotationDeg: 70 } } })
    expect(getVerifiedEditableProject(workspace.getState().project!)).toBe(workspace.getState().project)
    expect(projectContentHash(toBundle(protection.project).project)).toBe(projectContentHash(toBundle(before).project))
    await workspace.flush()
    expect((await repo.usage(owner)).protectionCount).toBe(1)
    workspace.undo(); expect(workspace.getDocument()).toMatchObject({ revision: 4, props: { item: { rotationDeg: 50 }, other: { rotationDeg: 70 } } })
    await expect(workspace.applyRestore(preview)).rejects.toThrow(/不可重复采用/)
  })

  it('retains the branch on source deletion or protection failure without adopting restoration', async () => {
    const { workspace, repo, owner } = await setup()
    const named = await workspace.createNamedSnapshot('initial'); await workspace.updateProp('item', { rotationDeg: 25 }); await workspace.flush()
    const first = await workspace.prepareRestore(named.id, { ids: ['item'], mode: 'transform' }), before = workspace.getState().project
    const snapshot = vi.spyOn(repo, 'createSnapshot').mockRejectedValueOnce(new Error('protection save denied'))
    await expect(workspace.applyRestore(first)).rejects.toThrow(/denied/)
    expect(workspace.getState().project).toBe(before); expect((await repo.usage(owner)).protectionCount).toBe(0)
    snapshot.mockRestore()
    const next = await workspace.prepareRestore(named.id, { ids: ['item'], mode: 'transform' })
    await repo.deleteSnapshot(owner, named.id, named.contentHash, (await repo.usage(owner)).metadataVersion)
    await expect(workspace.applyRestore(next)).rejects.toThrow(/删除/)
    expect(workspace.getState().project).toBe(before)
  })

  it('keeps the edited branch and undo on cross-connection CAS conflict and saves an independent native copy', async () => {
    const { workspace, repo, owner } = await setup(), other = repository(repo.database.name)
    const external = (await other.load(owner))!, project = cloneJson(external.project)
    project.document.title = 'another tab'; project.document.revision = 1
    await other.save({ project, resources: external.resources }, 0)
    await workspace.updateProp('item', { rotationDeg: 40 })
    await expect(workspace.close()).rejects.toThrow(/冲突/)
    expect(workspace.getState()).toMatchObject({ status: 'conflict', canUndo: true, project: { document: { revision: 1, props: { item: { rotationDeg: 40 } } } } })
    await workspace.saveAsCopy()
    expect(workspace.getDocument()!.sceneId).not.toBe(owner); expect(workspace.getDocument()!.revision).toBe(0)
    expect((await other.load(owner))!.project.document.title).toBe('another tab')
  })

  it('retains C2 witness through passive flush and expires it on real reopen', async () => {
    const { workspace, repo, owner } = await setup({ building: true })
    const named = await workspace.createNamedSnapshot('room initial')
    await workspace.execute([{ type: 'updateRoom', id: 'room', changes: { purpose: 'changed room' } }]); await workspace.flush()
    const inspection = await workspace.inspectStructureRestore(named.id, { ids: ['room'], mode: 'properties' })
    expect(inspection.scope.rootIds).toEqual(['room'])
    const preview = await workspace.prepareStructureRestore(named.id, { ids: ['room'], mode: 'properties', acknowledgedDependencyIds: inspection.scope.dependencyIds, confirmedLayerIds: inspection.scope.requiredLayerIds })
    expect(getVerifiedEditableProject(preview.project)).toBe(preview.project)
    await workspace.applyStructureRestore(preview); expect(workspace.getDocument()!.rooms.room.purpose).toBe('original room')
    expect(getVerifiedEditableProject(workspace.getState().project!)).toBe(workspace.getState().project)
    await workspace.flush(); await workspace.close(); await workspace.openPersisted(await fromBundle((await repo.load(owner))!, validation))
    await expect(workspace.inspectStructureRestore(named.id, { ids: ['room'], mode: 'properties' })).rejects.toThrow(/本会话.*连续性/)
    expect(workspace.getState().canUndo).toBe(false)
  })

  it.each(['execute', 'preview'] as const)('preserves structural invalidation through %s even when two reversals restore equal wall JSON', async method => {
    const { workspace } = await setup({ building: true, image: true })
    const originalWall = cloneJson(workspace.getDocument()!.walls['wall-0'])
    const named = await workspace.createNamedSnapshot('before reversals')
    const commands = [{ type: 'reverseWall' as const, id: 'wall-0' }, { type: 'reverseWall' as const, id: 'wall-0' }]
    if (method === 'execute') await workspace.execute(commands)
    else {
      const preview = await workspace.preview(commands)
      expect(preview.document.walls['wall-0']).toEqual(originalWall)
      await workspace.adoptPreview(preview)
    }
    const current = workspace.getState().project!
    expect(getVerifiedEditableProject(current)).toBe(current)
    expect(current.document.revision).toBe(1)
    expect(current.document.walls['wall-0']).toEqual(originalWall)
    await expect(workspace.inspectStructureRestore(named.id, { ids: ['wall-0'], mode: 'geometry' })).rejects.toThrow(/改变拓扑/)
    workspace.undo()
    await expect(workspace.inspectStructureRestore(named.id, { ids: ['wall-0'], mode: 'geometry' })).rejects.toThrow(/改变拓扑/)
  })

  it('transfers visual recreation invalidation to the publicly revalidated preview wrapper', async () => {
    const { workspace } = await setup({ image: true })
    await workspace.enableVisualCopy()
    const document = workspace.getDocument()!, light = { id: 'preview-light', floorId: Object.keys(document.floors)[0], layerId: document.entityLayers.item,
      visibility: 'public' as const, editLocked: false, positionMm: { x: 3000, y: 3000 }, radiusMm: 1500, color: '#FFD080', intensity: .4, wallOcclusion: true, enabled: true }
    await workspace.execute([{ type: 'upsertVisualLight', light }])
    const named = await workspace.createNamedSnapshot('before visual recreation')
    const preview = await workspace.preview([{ type: 'removeVisualEffect', kind: 'light', id: light.id }, { type: 'upsertVisualLight', light }])
    expect(preview.document.visual!.lights[light.id]).toEqual(light)
    await workspace.adoptPreview(preview)
    const current = workspace.getState().project!
    expect(getVerifiedEditableProject(current)).toBe(current)
    expect(current.document.revision).toBe(2)
    await expect(workspace.prepareRestore(named.id, { mode: 'visual', ids: [light.id] })).rejects.toThrow(/删除.*重建/)
    workspace.undo()
    await expect(workspace.prepareRestore(named.id, { mode: 'visual', ids: [light.id] })).rejects.toThrow(/删除.*重建/)
  })

  it('does not replace a newer editing branch during the imported archive final byte capture', async () => {
    const { workspace, repo, owner } = await setup(), incoming = fixture({ image: true })
    let importingReturned = false, held = false, release!: () => void, reached!: () => void
    const waiting = new Promise<void>(resolve => { release = resolve }), started = new Promise<void>(resolve => { reached = resolve })
    const originalImport = repo.importArchive.bind(repo), originalDecode = validation.images.decode
    vi.spyOn(repo, 'importArchive').mockImplementation(async (...args) => { const result = await originalImport(...args); importingReturned = true; return result })
    vi.spyOn(validation.images, 'decode').mockImplementation(async (...args) => {
      if (importingReturned && !held) { held = true; reached(); await waiting }
      return originalDecode(...args)
    })
    const importPromise = workspace.adoptArchive({ current: incoming, snapshots: [] })
    await started
    await workspace.updateProp('item', { rotationDeg: 35 })
    release()
    await expect(importPromise).rejects.toThrow(/已有修改/)
    expect(workspace.getDocument()).toMatchObject({ sceneId: owner, revision: 1, props: { item: { rotationDeg: 35 } } })
    expect((await repo.list()).filter(project => project.sceneId !== owner)).toHaveLength(1)
  })
})
