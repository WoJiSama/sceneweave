import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHouse } from '../../core/seed'
import { migrateSceneV1 } from '../../core/v2/migration'
import { assertDoorwayClearancesV2 } from '../../core/v2/doorway-clearance'
import type { CompleteProjectV2 } from '../../io/v2/types'
import { WorkspaceV2, type WorkspaceRepository } from './workspace'

// Asset decoding and package closure are covered by IO/browser suites. These tests
// exercise the real command engine, scene validation, history and CAS boundary.
vi.mock('../../io/v2/project-file', () => ({ validateCompleteProjectV2: vi.fn(async () => {}) }))
function project(): CompleteProjectV2 {
  const document = migrateSceneV1(createHouse('source'), { sceneId: 'b2-workspace', now: '2026-10-20T00:00:00.000Z' })
  const template = (id: string) => {
    const { id: _id, floorId: _floor, editLocked: _lock, visibility: _visibility, roomId: _room, supportRef: _support, ...value } = document.props[id]
    return value
  }
  document.prefabDefinitions.definition = { id: 'definition', catalogId: 'test.desk-chair', version: 1, licenseRef: 'MIT', origin: { kind: 'original', attribution: 'Sceneweave test', canEmbed: true }, name: '桌椅', tags: [], members: [{ key: 'desk', propTemplate: template('p-b2') }, { key: 'chair', propTemplate: template('p-c3') }, { key: 'removed', propTemplate: template('p-c3') }] }
  document.prefabInstances.group = { id: 'group', floorId: 'f-a1', editLocked: false, visibility: 'public', definitionRef: { id: 'definition', version: 1 }, anchorMm: { x: 5000, y: 7600 }, rotationDeg: 0, members: { desk: { propId: 'p-b2', overrideFields: [] }, chair: { propId: 'p-c3', overrideFields: [] }, removed: { propId: null, overrideFields: [] } } }
  return { document, assets: {}, licenses: {}, licenseBindings: [] }
}
const setup = () => {
  const save = vi.fn<WorkspaceRepository['save']>(async () => {})
  return { workspace: new WorkspaceV2({ save }), save }
}
afterEach(() => vi.restoreAllMocks())

describe('B2 atomic command workspace integration', () => {
  it('commits one monotone revision and one save for a multi-command edit, then restores everything with undo/redo', async () => {
    const { workspace, save } = setup(), input = project()
    await workspace.openPersisted(input)
    workspace.execute([
      { type: 'updateProp', id: 'p-c3', changes: { rotationDeg: 30 } },
      { type: 'transformPrefab', id: 'group', anchorMm: { x: 5300, y: 7900 } },
      { type: 'reverseWall', id: 'w-6a' },
    ])
    const edited = workspace.getState().project!.document
    expect(edited.revision).toBe(1)
    expect(edited.props['p-c3']).toMatchObject({ positionMm: { x: 5300, y: 6800 }, rotationDeg: 30 })
    expect(edited.prefabInstances.group.members.chair.overrideFields).toEqual(['rotationDeg'])
    expect(edited.openings).toEqual(input.document.openings)
    await workspace.flush()
    expect(save.mock.calls.map(([value, baseline]) => [value.document.revision, baseline])).toEqual([[1, 0]])
    workspace.undo()
    expect(workspace.getState().project!.document).toEqual({ ...input.document, revision: 2, updatedAt: workspace.getState().project!.document.updatedAt })
    expect(workspace.getState()).toMatchObject({ canUndo: false, canRedo: true })
    workspace.redo()
    expect(workspace.getState().project!.document).toEqual({ ...edited, revision: 3, updatedAt: workspace.getState().project!.document.updatedAt })
    await workspace.flush()
    expect(save.mock.calls.map(([value, baseline]) => [value.document.revision, baseline])).toEqual([[1, 0], [3, 1]])
  })
  it('retains current identity, revision and both history stacks after an invalid geometry batch', async () => {
    const { workspace, save } = setup()
    await workspace.openPersisted(project())
    workspace.updateProp('p-b2', { rotationDeg: 30 })
    workspace.undo()
    const before = workspace.getState(), checkpoint = workspace.checkpoint()
    expect(() => workspace.execute([
      { type: 'updateProp', id: 'p-b2', changes: { rotationDeg: 45 } },
      { type: 'moveVertex', id: 'v-b2', positionMm: { x: 2000, y: 4000 } },
    ])).toThrow(/事务未采用/)
    expect(workspace.getState()).toBe(before)
    expect(workspace.checkpoint()).toBe(checkpoint)
    expect(workspace.getState()).toMatchObject({ canUndo: false, canRedo: true })
    workspace.redo()
    expect(workspace.getState().project!.document).toMatchObject({ revision: 3, props: { 'p-b2': { rotationDeg: 30 } } })
    await workspace.flush()
    expect(save.mock.calls[0][0].document.revision).toBe(3)
  })
  it('keeps the same project and history for a cancelled or unchanged candidate', async () => {
    const { workspace, save } = setup()
    await workspace.openPersisted(project())
    const before = workspace.getState(), checkpoint = workspace.checkpoint()
    workspace.execute([])
    workspace.execute([{ type: 'reverseWall', id: 'w-6a' }, { type: 'reverseWall', id: 'w-6a' }])
    workspace.updateProp('p-b2', { rotationDeg: 0 })
    expect(workspace.getState()).toBe(before)
    expect(workspace.checkpoint()).toBe(checkpoint)
    await workspace.flush()
    expect(save).not.toHaveBeenCalled()
  })
  it('restores prefab relation, deleted member records and upstream private audience when undoing unpack', async () => {
    const { workspace } = setup(), input = project()
    input.document.prefabInstances.group.visibility = 'gm'
    await workspace.openPersisted(input)
    workspace.execute([{ type: 'unpackPrefab', id: 'group' }])
    expect(workspace.getState().project!.document.prefabInstances).toEqual({})
    expect(workspace.getState().project!.document.props['p-b2'].visibility).toBe('gm')
    workspace.undo()
    expect(workspace.getState().project!.document.prefabInstances).toEqual(input.document.prefabInstances)
    expect(workspace.getState().project!.document.props).toEqual(input.document.props)
    workspace.redo()
    expect(workspace.getState().project!.document.prefabInstances).toEqual({})
    expect(workspace.getState().project!.document.props['p-b2'].visibility).toBe('gm')
    await workspace.flush()
  })
  it('preserves grouped local edits through the B1 updateProp API and rejects affected locks atomically', async () => {
    const { workspace } = setup(), input = project()
    input.document.props['p-c3'].editLocked = true
    await workspace.openPersisted(input)
    workspace.updateProp('p-b2', { rotationDeg: 30 })
    expect(workspace.getState().project!.document.prefabInstances.group.members.desk.overrideFields).toEqual(['rotationDeg'])
    const before = workspace.getState()
    expect(() => workspace.execute([{ type: 'transformPrefab', id: 'group', rotationDeg: 90 }])).toThrow(/锁定/)
    expect(workspace.getState()).toBe(before)
    workspace.undo()
    expect(workspace.getState().project!.document.prefabInstances.group.members.desk.overrideFields).toEqual([])
    await workspace.flush()
  })
  it('rejects finite doorway guard failures before revision, history or automatic save changes', async () => {
    const save = vi.fn<WorkspaceRepository['save']>(async () => {})
    const guard = vi.fn((document: CompleteProjectV2['document']) => assertDoorwayClearancesV2(document, [{ openingId: 'o-a1', minWidthMm: 1200, approachDepthMm: 1000 }]))
    const workspace = new WorkspaceV2({ save }, guard)
    await workspace.openPersisted(project())
    workspace.updateProp('p-b2', { rotationDeg: 30 })
    workspace.undo()
    const before = workspace.getState(), checkpoint = workspace.checkpoint()
    expect(guard).toHaveBeenCalledTimes(1) // History replay does not invoke new-edit guards.
    expect(() => workspace.preview([{ type: 'updateProp', id: 'p-b2', changes: { positionMm: { x: 5000, y: 10500 } } }])).toThrow(/门口.*被阻挡.*p-b2/)
    expect(workspace.getState()).toBe(before)
    expect(() => workspace.updateProp('p-b2', { positionMm: { x: 5000, y: 10500 } })).toThrow(/门口.*被阻挡.*p-b2/)
    expect(workspace.getState()).toBe(before)
    expect(workspace.checkpoint()).toBe(checkpoint)
    expect(workspace.getState()).toMatchObject({ canUndo: false, canRedo: true, project: { document: { revision: 2 } } })
    expect(save).not.toHaveBeenCalled()
    workspace.redo()
    expect(guard).toHaveBeenCalledTimes(3)
    expect(workspace.getState().project!.document.revision).toBe(3)
    await workspace.flush()
    expect(save.mock.calls.map(([value, baseline]) => [value.document.revision, baseline])).toEqual([[3, 0]])
  })
})
