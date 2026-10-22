import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { layerSceneV3 } from '../../core/v3/test-fixtures'
import { createHistoryIdentityV4 } from '../../core/v4/identity'
import { HISTORY_LIMITS_V4 } from '../../core/v4/types'
import { validateCompleteProjectV4 } from '../../io/v4/project-file'
import type { CompleteProjectV4, NamedSnapshotV4 } from '../../io/v4/types'
import { WorkspaceV4, type WorkspaceRepositoryV4 } from './workspace'

// Real domain/identity/restore logic; IO validation and durability are exercised by IO/browser suites.
vi.mock('../../io/v4/project-file', () => ({ validateCompleteProjectV4: vi.fn(async () => {}) }))
const validate = vi.mocked(validateCompleteProjectV4)
function project(): CompleteProjectV4 {
  const document = layerSceneV3()
  // This suite exercises symbol props; the shared layer fixture also carries an unused bitmap catalog.
  document.assets = {}; document.propDefinitions = {}
  return { document, historyIdentity: createHistoryIdentityV4(document), assets: {}, licenses: {}, licenseBindings: [] }
}
function snapshot(project: CompleteProjectV4, id = 'saved-snapshot', kind: 'named' | 'protection' = 'named'): NamedSnapshotV4 {
  return { id, sceneId: project.document.sceneId, lineageId: project.historyIdentity.lineageId, sourceRevision: project.document.revision,
    name: '初稿', kind, contentHash: 'a'.repeat(64), createdAt: '2026-10-22T00:00:00.000Z', project: structuredClone(project) }
}
function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void, reject!: (reason: unknown) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}
function setup() {
  const input = project(), source = snapshot(input), named = new Map([[source.id, source]])
  let durable = structuredClone(input)
  const api = {
    save: vi.fn<WorkspaceRepositoryV4['save']>(async (candidate, expected) => {
      if (expected !== null && durable.document.revision !== expected) {
        const error = new Error('另一标签已保存'); error.name = 'ConflictErrorV4'; throw error
      }
      durable = structuredClone(candidate)
    }),
    usage: vi.fn<WorkspaceRepositoryV4['usage']>(async () => ({ metadataVersion: 0, namedCount: 1, protectionCount: 0,
      resourceBytes: 0, documentBytes: 0, originalBytes: 0, limits: HISTORY_LIMITS_V4 })),
    loadNamedSnapshot: vi.fn<WorkspaceRepositoryV4['loadNamedSnapshot']>(async id => named.has(id) ? structuredClone(named.get(id)!) : null),
    createNamedSnapshot: vi.fn<WorkspaceRepositoryV4['createNamedSnapshot']>(async (candidate, name, options = {}) => {
      if (candidate.document.revision !== durable.document.revision || options.expectedRevision !== durable.document.revision) throw new Error('保存基线已变化')
      const value = { ...snapshot(candidate, `named-${named.size}`, options.kind ?? 'named'), name }
      named.set(value.id, structuredClone(value)); return value
    }),
    importArchive: vi.fn<WorkspaceRepositoryV4['importArchive']>(async archive => archive),
  } satisfies WorkspaceRepositoryV4
  const workspace = new WorkspaceV4(api)
  return { workspace, api, source, named, input, durable: () => durable }
}
beforeEach(() => { vi.useFakeTimers(); validate.mockReset().mockResolvedValue() })
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks() })

describe('C1d guarded restore transaction', () => {
  it('uses current licenses for transforms and compares only the historic resources actually restored', async () => {
    const { workspace, input, named } = setup()
    const template = Object.values(layerSceneV3().propDefinitions)[0]
    for (const id of ['selected-definition', 'unrelated-definition']) {
      input.document.propDefinitions[id] = { ...template, id, catalogId: id, licenseRef: id, defaultAppearance: input.document.props.item.appearance }
      input.licenseBindings.push({ subjectKind: 'propDefinition', subjectId: id, licenseRef: id, licensePath: `licenses/${'a'.repeat(64)}.txt`, embedding: 'allowed' })
    }
    input.document.props.item.definitionRef = { id: 'selected-definition', version: template.version }
    input.licenses['a'.repeat(64)] = { sha256: 'a'.repeat(64), text: 'Current selected license' }
    const historic = structuredClone(input)
    historic.licenses['b'.repeat(64)] = { sha256: 'b'.repeat(64), text: 'Different historic license' }
    historic.licenseBindings = historic.licenseBindings.map(binding => ({ ...binding, licensePath: `licenses/${'b'.repeat(64)}.txt` }))
    named.set('saved-snapshot', snapshot(historic))
    await workspace.openPersisted(input)
    workspace.updateProp('item', { rotationDeg: 45 })
    const transform = await workspace.prepareRestore('saved-snapshot', { ids: ['item'], mode: 'transform' })
    expect(transform.project.licenseBindings).toEqual(input.licenseBindings)
    expect(transform.project.licenses).toEqual(input.licenses)
    await expect(workspace.prepareRestore('saved-snapshot', { ids: ['item'], mode: 'appearance' })).rejects.toThrow(/许可主体.*冲突/)
    historic.licenseBindings[0] = structuredClone(input.licenseBindings[0])
    named.set('saved-snapshot', snapshot(historic))
    const appearance = await workspace.prepareRestore('saved-snapshot', { ids: ['item'], mode: 'appearance' })
    expect(appearance.project.licenseBindings).toEqual(input.licenseBindings)
    expect(appearance.project.licenses).toEqual(input.licenses)
    await workspace.flush()
  })

  it('restores selected transforms once, preserves a later prop, and undoes with increasing revisions', async () => {
    const { workspace, api, input, durable } = setup()
    await workspace.openPersisted(input)
    workspace.updateProp('item', { rotationDeg: 45 })
    workspace.execute([{ type: 'copyProp', id: 'item', newId: 'later', offsetMm: { x: 1200, y: 0 } }])
    const later = workspace.getState().project!.document.props.later
    const preview = await workspace.prepareRestore('saved-snapshot', { ids: ['item'], mode: 'transform' })
    expect(workspace.getState().project!.document.revision).toBe(2)
    expect(preview.plan.changes).toHaveLength(1)
    const protection = await workspace.applyRestore(preview)
    expect(protection.project.document.revision).toBe(2)
    expect(workspace.getState().project!.document).toMatchObject({ revision: 3, props: { item: { rotationDeg: 0 }, later } })
    expect(api.createNamedSnapshot).toHaveBeenCalledTimes(1)
    await expect(workspace.applyRestore(preview)).rejects.toThrow(/重复/)
    workspace.undo()
    expect(workspace.getState().project!.document).toMatchObject({ revision: 4, props: { item: { rotationDeg: 45 }, later } })
    workspace.redo()
    expect(workspace.getState().project!.document).toMatchObject({ revision: 5, props: { item: { rotationDeg: 0 }, later } })
    await workspace.flush()
    expect(durable().document.revision).toBe(5)
    expect(api.save.mock.calls.map(([value, baseline]) => [value.document.revision, baseline])).toEqual([[2, 0], [5, 2]])
  })

  it('rejects cancelled, edited, removed, and tampered previews before protection is created', async () => {
    const { workspace, input, named, api } = setup()
    await workspace.openPersisted(input)
    workspace.updateProp('item', { rotationDeg: 45 })
    const cancelled = await workspace.prepareRestore('saved-snapshot', { ids: ['item'], mode: 'transform' })
    workspace.cancelRestore(cancelled)
    await expect(workspace.applyRestore(cancelled)).rejects.toThrow(/重复/)
    const stale = await workspace.prepareRestore('saved-snapshot', { ids: ['item'], mode: 'transform' })
    workspace.updateProp('item', { rotationDeg: 90 })
    await expect(workspace.applyRestore(stale)).rejects.toThrow(/已有修改/)
    const missing = await workspace.prepareRestore('saved-snapshot', { ids: ['item'], mode: 'transform' })
    named.clear()
    await expect(workspace.applyRestore(missing)).rejects.toThrow(/删除/)
    await expect(workspace.applyRestore(structuredClone(stale))).rejects.toThrow(/重复/)
    expect(api.createNamedSnapshot).not.toHaveBeenCalled()
    expect(workspace.getState().project!.document.props.item.rotationDeg).toBe(90)
  })

  it('keeps the current state and undo stack when protection storage fails', async () => {
    const { workspace, input, api } = setup()
    await workspace.openPersisted(input)
    workspace.updateProp('item', { rotationDeg: 45 })
    const preview = await workspace.prepareRestore('saved-snapshot', { ids: ['item'], mode: 'transform' })
    api.createNamedSnapshot.mockRejectedValueOnce(new DOMException('存储已满', 'QuotaExceededError'))
    await expect(workspace.applyRestore(preview)).rejects.toThrow(/存储已满/)
    expect(workspace.getState()).toMatchObject({ canUndo: true, canRedo: false, project: { document: { revision: 1, props: { item: { rotationDeg: 45 } } } } })
    workspace.undo()
    expect(workspace.getState().project!.document).toMatchObject({ revision: 2, props: { item: { rotationDeg: 0 } } })
    await workspace.flush()
  })

  it('rechecks edits, cancellation and source deletion after asynchronous protection writes', async () => {
    for (const event of ['edit', 'cancel', 'delete'] as const) {
      const { workspace, input, api, named } = setup()
      await workspace.openPersisted(input)
      workspace.updateProp('item', { rotationDeg: 45 })
      const preview = await workspace.prepareRestore('saved-snapshot', { ids: ['item'], mode: 'transform' })
      const saved = api.createNamedSnapshot.getMockImplementation()!
      api.createNamedSnapshot.mockImplementationOnce(async (...args) => {
        const protection = await saved(...args)
        if (event === 'edit') workspace.updateProp('item', { rotationDeg: 90 })
        else if (event === 'cancel') workspace.cancelRestore(preview)
        else named.delete('saved-snapshot')
        return protection
      })
      await expect(workspace.applyRestore(preview)).rejects.toThrow(event === 'edit' ? /已有修改/ : event === 'cancel' ? /取消/ : /删除/)
      expect([...named.values()].filter(value => value.kind === 'protection')).toHaveLength(1)
      expect(workspace.getState().project!.document.props.item.rotationDeg).toBe(event === 'edit' ? 90 : 45)
      await workspace.flush()
    }
  })

  it('keeps the restored memory branch, undo, protection and old durable branch after the apply save fails', async () => {
    const { workspace, input, api, named, durable } = setup()
    await workspace.openPersisted(input)
    workspace.updateProp('item', { rotationDeg: 45 })
    await workspace.flush()
    const preview = await workspace.prepareRestore('saved-snapshot', { ids: ['item'], mode: 'transform' })
    await workspace.applyRestore(preview)
    api.save.mockRejectedValueOnce(new Error('写入失败'))
    await expect(workspace.flush()).rejects.toThrow(/写入失败/)
    expect(workspace.getState()).toMatchObject({ status: 'error', canUndo: true, project: { document: { revision: 2, props: { item: { rotationDeg: 0 } } } } })
    expect(durable().document).toMatchObject({ revision: 1, props: { item: { rotationDeg: 45 } } })
    expect([...named.values()].filter(value => value.kind === 'protection')).toHaveLength(1)
    workspace.undo()
    expect(workspace.getState().project!.document).toMatchObject({ revision: 3, props: { item: { rotationDeg: 45 } } })
    await workspace.retry()
    expect(durable().document.revision).toBe(3)
  })

  it('rejects a late source or complete validation result after the baseline advances', async () => {
    const { workspace, input, api, source } = setup()
    await workspace.openPersisted(input)
    const gate = deferred<NamedSnapshotV4 | null>()
    api.loadNamedSnapshot.mockReturnValueOnce(gate.promise)
    const preparing = workspace.prepareRestore(source.id, { ids: ['item'], mode: 'transform' })
    workspace.updateProp('item', { rotationDeg: 45 })
    gate.resolve(source)
    await expect(preparing).rejects.toThrow(/已有修改/)
    const checking = deferred()
    validate.mockReturnValueOnce(checking.promise)
    const second = workspace.prepareRestore(source.id, { ids: ['item'], mode: 'transform' })
    for (let index = 0; index < 10; index++) await Promise.resolve()
    workspace.updateProp('item', { rotationDeg: 90 })
    checking.resolve()
    await expect(second).rejects.toThrow(/已有修改/)
    expect(api.createNamedSnapshot).not.toHaveBeenCalled()
    await workspace.flush()
  })
})

describe('C1d allocated identities and editor safety', () => {
  it('retains birth tokens through deletion, undo, redo and branching and rejects an ID reused by normal copy', async () => {
    const { workspace, input } = setup()
    await workspace.openPersisted(input)
    workspace.execute([{ type: 'copyProp', id: 'item', newId: 'allocated', offsetMm: { x: 1200, y: 0 } }])
    const token = workspace.getState().project!.historyIdentity.propTokens.allocated
    workspace.undo()
    expect(workspace.getState().project!.historyIdentity.propTokens.allocated).toBe(token)
    workspace.redo()
    expect(workspace.getState().project!.historyIdentity.propTokens.allocated).toBe(token)
    workspace.execute([{ type: 'deleteProp', id: 'allocated' }])
    expect(workspace.getState().project!.historyIdentity.propTokens.allocated).toBe(token)
    const before = workspace.getState()
    expect(() => workspace.execute([{ type: 'copyProp', id: 'item', newId: 'allocated', offsetMm: { x: 1200, y: 0 } }])).toThrow(/身份已分配/)
    expect(workspace.getState()).toBe(before)
    await workspace.flush()
  })

  it('checks naming after a save awaits and protects the selected current branch', async () => {
    const { workspace, input, api } = setup()
    await workspace.openPersisted(input)
    workspace.updateProp('item', { rotationDeg: 45 })
    const gate = deferred()
    const save = api.save.getMockImplementation()!
    api.save.mockImplementationOnce(async (...args) => { await gate.promise; return save(...args) })
    const naming = workspace.createNamedSnapshot('新名字')
    workspace.updateProp('item', { rotationDeg: 90 })
    gate.resolve()
    await expect(naming).rejects.toThrow(/已有修改/)
    expect(api.createNamedSnapshot).not.toHaveBeenCalled()
    await workspace.flush()
  })

  it('does not consume history if revision overflows or a geometry guard rejects the candidate', async () => {
    const { api, input } = setup()
    input.document.revision = Number.MAX_SAFE_INTEGER
    const workspace = new WorkspaceV4(api)
    await workspace.openPersisted(input)
    const before = workspace.getState(), checkpoint = workspace.checkpoint()
    expect(() => workspace.updateProp('item', { rotationDeg: 45 })).toThrow(/安全整数/)
    expect(workspace.getState()).toBe(before)
    expect(workspace.checkpoint()).toBe(checkpoint)
    expect(api.save).not.toHaveBeenCalled()
    const guarded = new WorkspaceV4(api, () => { throw new Error('样板约束无效') })
    await guarded.openPersisted(project())
    expect(() => guarded.updateProp('item', { rotationDeg: 45 })).toThrow(/样板约束/)
    expect(guarded.getState().canUndo).toBe(false)
  })
})
