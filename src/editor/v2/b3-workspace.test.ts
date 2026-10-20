import { describe, expect, it, vi } from 'vitest'
import { applyCommandsV2 } from '../../core/v2/commands'
import type { CompleteProjectV2 } from '../../io/v2/types'
import { validateIslandEditsV2 } from './island-constraints'
import { createIslandDocument, ISLAND_IDS, islandShallowWaterBoundaryMm } from './island-sample'
import { terrainPointCommandsV2 } from './terrain-editing'
import { WorkspaceV2, type WorkspaceRepository } from './workspace'

// The browser IO suite supplies actual image bytes. These exercise the real
// sample, command validation, candidate guard, history and save queue boundary.
vi.mock('../../io/v2/project-file', () => ({ validateCompleteProjectV2: vi.fn(async () => {}) }))
const project = (): CompleteProjectV2 => ({ document: createIslandDocument({ sceneId: 'b3-workspace', now: '2026-10-20T00:00:00.000Z' }), assets: {}, licenses: {}, licenseBindings: [] })
const setup = async () => {
  const save = vi.fn<WorkspaceRepository['save']>(async () => {}), workspace = new WorkspaceV2({ save }, validateIslandEditsV2), input = project()
  await workspace.openPersisted(input)
  return { workspace, save, input }
}

describe('B3 sample editing and atomic workspace integration', () => {
  it('coordinates shared endpoints and explicit shallow paint in one candidate without changing the input', () => {
    const scene = project().document, before = structuredClone(scene), low = scene.terrainAreas[ISLAND_IDS.low]
    const shared = low.boundaryMm.find(point => point.positionMm.x === 14000 && point.positionMm.y === 6000)!
    const commands = terrainPointCommandsV2(scene, low.id, shared.id, { x: 13900, y: 6000 })
    expect(commands.filter(command => command.type === 'moveTerrainPoint')).toHaveLength(2)
    expect(commands.at(-1)).toMatchObject({ type: 'setOverlayBoundary', id: ISLAND_IDS.water, overlayId: ISLAND_IDS.waterOverlay })
    const candidate = applyCommandsV2(scene, commands)
    for (const area of [candidate.terrainAreas[ISLAND_IDS.low], candidate.terrainAreas[ISLAND_IDS.high]]) expect(area.boundaryMm.some(point => point.positionMm.x === 13900 && point.positionMm.y === 6000)).toBe(true)
    expect(candidate.terrainAreas[ISLAND_IDS.water].surfaceStyle!.overlays[0].boundaryMm).toEqual(islandShallowWaterBoundaryMm(candidate))
    expect(scene).toEqual(before)
  })

  it('previews coast/height/overlay, adopts as one revision, and restores actual stored members and paints with history', async () => {
    const { workspace, save, input } = await setup(), low = input.document.terrainAreas[ISLAND_IDS.low], point = low.boundaryMm[0]
    const commands = terrainPointCommandsV2(input.document, low.id, point.id, { ...point.positionMm, x: point.positionMm.x - 200 })
    commands.push({ type: 'setTerrainElevation', id: ISLAND_IDS.high, groundElevationMm: 4000 })
    const checkpoint = workspace.checkpoint(), before = workspace.getState(), candidate = workspace.preview(commands)
    expect(workspace.getState()).toBe(before); expect(workspace.checkpoint()).toBe(checkpoint); expect(candidate.revision).toBe(0)
    expect(candidate.terrainAreas[ISLAND_IDS.high].groundElevationMm).toBe(4000)
    workspace.execute(commands)
    expect(workspace.getState().project!.document.revision).toBe(1)
    await workspace.flush()
    expect(save).toHaveBeenCalledTimes(1)
    workspace.undo()
    const restored = workspace.getState().project!.document
    expect(restored).toEqual({ ...input.document, revision: 2, updatedAt: restored.updatedAt })
    workspace.redo()
    const replayed = workspace.getState().project!.document
    expect(replayed).toEqual({ ...candidate, revision: 3, updatedAt: replayed.updatedAt })
    await workspace.flush()
    expect(save.mock.calls.map(([value, expected]) => [value.document.revision, expected])).toEqual([[1, 0], [3, 1]])
  })

  it('rejects a missing required connection before consuming redo, revision or saving', async () => {
    const { workspace, save } = await setup()
    workspace.execute([{ type: 'setTerrainElevation', id: ISLAND_IDS.high, groundElevationMm: 4000 }]); workspace.undo()
    const before = workspace.getState(), checkpoint = workspace.checkpoint()
    expect(() => workspace.preview([{ type: 'removeTerrainConnection', id: ISLAND_IDS.connection }])).toThrow(/连接|台阶/)
    expect(() => workspace.execute([{ type: 'setConnectionBlocked', id: ISLAND_IDS.connection, blocksMovement: true }])).toThrow(/阻挡|连接|台阶/)
    expect(workspace.getState()).toBe(before); expect(workspace.checkpoint()).toBe(checkpoint)
    expect(save).not.toHaveBeenCalled()
    expect(before).toMatchObject({ canUndo: false, canRedo: true, project: { document: { revision: 2 } } })
    workspace.redo(); expect(workspace.getState().project!.document.terrainAreas[ISLAND_IDS.high].groundElevationMm).toBe(4000)
    await workspace.flush()
  })

  it('regenerates density atomically while preserving deleted records and locked concrete members, then undo restores the full previous scatter', async () => {
    const { workspace } = await setup(), scene = workspace.getState().project!.document
    const trees = scene.scatterGroups[ISLAND_IDS.scatterTrees], shrubs = scene.scatterGroups[ISLAND_IDS.scatterShrubs]
    const [treeKey, tree] = Object.entries(trees.members).find(([, member]) => member.propId)!, [shrubKey, shrub] = Object.entries(shrubs.members).find(([, member]) => member.propId)!
    workspace.execute([{ type: 'setEditLock', kind: 'prop', id: tree.propId!, locked: true }, { type: 'deleteProp', id: shrub.propId! }])
    const before = workspace.getState().project!.document, savedTree = structuredClone(before.props[tree.propId!])
    const commands = [{ type: 'regenerateScatter' as const, id: trees.id, densityFactor: 1 }, { type: 'regenerateScatter' as const, id: shrubs.id, densityFactor: 1 }]
    const candidate = workspace.preview(commands)
    expect(workspace.getState().project!.document).toBe(before)
    expect(candidate.props[tree.propId!]).toEqual(savedTree)
    expect(candidate.scatterGroups[trees.id].members[treeKey]).toEqual(before.scatterGroups[trees.id].members[treeKey])
    expect(candidate.scatterGroups[shrubs.id].members[shrubKey]).toEqual({ propId: null, state: 'deleted', overrideFields: [] })
    expect(candidate.scatterGroups[shrubs.id].exclusions).toEqual(before.scatterGroups[shrubs.id].exclusions)
    workspace.execute(commands)
    expect(workspace.getState().project!.document.revision).toBe(before.revision + 1)
    workspace.undo()
    const restored = workspace.getState().project!.document
    expect(restored).toEqual({ ...before, revision: before.revision + 2, updatedAt: restored.updatedAt })
    await workspace.flush()
  })
})
