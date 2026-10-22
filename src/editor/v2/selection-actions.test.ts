import { describe, expect, it, vi } from 'vitest'
import { createHouse } from '../../core/seed'
import { migrateSceneV1 } from '../../core/v2/migration'
import { applyCommandsV2 } from '../../core/v2/commands'
import { selectionActionReasonV2, selectionCommandsV2 } from './selection-actions'
import { WorkspaceV2 } from './workspace'

// The editor transaction tests isolate resource IO, as workspace.test.ts does.
// Geometry, finite commands, strict parsing, revision and history remain real.
vi.mock('../../io/v2/project-file', () => ({ validateCompleteProjectV2: vi.fn(async () => {}) }))
const scene = () => migrateSceneV1(createHouse('selection-source'), { sceneId: 'selection-actions', now: '2026-10-21T00:00:00.000Z' })
describe('C1b shared selection commands', () => {
  it('uses the core stable half-millimetre rounding for a quarter-turn', () => {
    const input = scene(), a = input.props['p-c3'], b = input.props['p-d4']
    a.positionMm = { x: 1000, y: 1000 }; b.positionMm = { x: 5000, y: 5001 }; b.rotationDeg = 0
    expect(selectionCommandsV2(input, [a.id, b.id], 'rotate', { angle: 90 })).toMatchObject([
      { changes: { positionMm: { x: 5001, y: 1001 } } }, { changes: { positionMm: { x: 1000, y: 5001 } } },
    ])
  })
  it('preserves source overlap order when copying a top-first selection', () => {
    const input = scene(); input.props['p-c3'].renderOrder = 20; input.props['p-d4'].renderOrder = 30
    const commands = selectionCommandsV2(input, ['p-d4', 'p-c3'], 'copy')
    expect(commands.map(command => 'id' in command ? command.id : null)).toEqual(['p-c3', 'p-d4'])
    const next = applyCommandsV2(input, commands), copies = commands.map(command => { if (command.type !== 'copyProp') throw new Error('Unexpected command'); return next.props[command.newId] })
    expect(copies[0].renderOrder).toBeLessThan(copies[1].renderOrder)
  })
  it('distinguishes a locked parent from locked anchored notes for edit-lock commands', () => {
    const input = scene(), prop = input.props['p-e5']; input.notes['n-d4'].editLocked = true
    expect(selectionActionReasonV2(input, [prop.id], 'lock')).toBeNull()
    // A minimal container is sufficient to test capability checks; acceptance is
    // separately strict-tested by the domain transaction suite.
    input.prefabInstances.parent = { id: 'parent', floorId: prop.floorId, editLocked: true, visibility: 'public', definitionRef: { id: 'not-adopted', version: 1 }, anchorMm: { x: 0, y: 0 }, rotationDeg: 0, members: { shelf: { propId: prop.id, overrideFields: [] } } }
    expect(selectionActionReasonV2(input, [prop.id], 'lock')).toMatch(/容器/)
    prop.editLocked = true
    expect(selectionActionReasonV2(input, [prop.id], 'unlock')).toMatch(/容器/)
    expect(selectionActionReasonV2(input, [prop.id], 'lock')).toBeNull()
  })
  it('normalizes negative and wraparound rotations and preserves millimetre positions', () => {
    const input = scene(); input.props['p-c3'].rotationDeg = 350
    const positive = selectionCommandsV2(input, ['p-c3'], 'rotate', { angle: 25 })
    expect(positive).toMatchObject([{ type: 'updateProp', changes: { rotationDeg: 15 } }])
    expect(selectionCommandsV2(input, ['p-c3'], 'rotate', { angle: -355 })).toMatchObject([{ changes: { rotationDeg: 355 } }])
    const result = applyCommandsV2(input, positive)
    expect(result.props['p-c3'].positionMm).toEqual(input.props['p-c3'].positionMm)
  })
  it('rejects the entire mixed or locked selection and the existing transaction cap without splitting', () => {
    const input = scene(); input.props['p-c3'].editLocked = true
    expect(() => selectionCommandsV2(input, ['p-b2', 'p-c3'], 'move', { dx: 100 })).toThrow(/锁定/)
    expect(selectionActionReasonV2(input, ['p-b2', 'w-0a'], 'delete')).toMatch(/结构/)
    const ids = Array.from({ length: 257 }, (_, i) => `selection-${i}`)
    ids.forEach(id => { input.props[id] = { ...structuredClone(input.props['p-b2']), id } })
    expect(() => selectionCommandsV2(input, ids, 'move', { dx: 100 })).toThrow(/256/)
    expect(() => selectionCommandsV2(input, ['p-b2'], 'move', { dx: .5 })).toThrow(/整数毫米/)
  })
  it('previews, cancels, applies once and restores all targets with one undo/redo', async () => {
    const input = scene(), save = vi.fn(async () => {}), workspace = new WorkspaceV2({ save })
    await workspace.openPersisted({ document: input, assets: {}, licenses: {}, licenseBindings: [] })
    const original = workspace.getState().project!.document, before = workspace.checkpoint()
    const commands = selectionCommandsV2(original, ['p-c3', 'p-d4'], 'move', { dx: 100, dy: 200 })
    const preview = workspace.preview(commands)
    expect(preview.props['p-c3'].positionMm).toEqual({ x: 5100, y: 6700 })
    expect(workspace.getState().project!.document).toBe(original); expect(workspace.checkpoint()).toBe(before)
    workspace.execute(commands)
    expect(workspace.getState().project!.document.revision).toBe(original.revision + 1)
    workspace.undo()
    expect(workspace.getState().project!.document.props).toEqual(original.props)
    workspace.redo()
    expect(workspace.getState().project!.document.props).toEqual(preview.props)
    await workspace.flush()
  })
  it('rejects an invalid final target without deleting earlier targets or consuming history', async () => {
    const input = scene(), workspace = new WorkspaceV2({ save: vi.fn(async () => {}) })
    await workspace.openPersisted({ document: input, assets: {}, licenses: {}, licenseBindings: [] })
    const before = workspace.getState(), checkpoint = workspace.checkpoint()
    // The shelf has a real anchored note, so its deletion fails after the chair command.
    expect(() => workspace.execute(selectionCommandsV2(input, ['p-c3', 'p-e5'], 'delete'))).toThrow()
    expect(workspace.getState()).toBe(before); expect(workspace.checkpoint()).toBe(checkpoint)
    expect(workspace.getState().canUndo).toBe(false)
  })
})
