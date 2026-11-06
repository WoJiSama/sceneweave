import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import { ProjectRepository } from '../../platform/browser/storage/repository.js'
import { createCompositionContent } from '../../shared/appearance/graph.js'
import { buildingAggregateMembers } from '../../shared/commands/building.js'
import type { SceneCommand } from '../../shared/commands/commands.js'
import { projectScene } from '../../shared/projection/projection.js'
import { exportProject, importProject } from '../../shared/project/file.js'
import { canonicalJson } from '../../shared/validation/json.js'
import { fromBundle, toBundle } from './project.js'
import { fixture, runtime, validation } from './test-fixtures.js'
import { Workspace } from './workspace.js'

const opened: { workspace: Workspace; repository: ProjectRepository }[] = []
afterEach(async () => {
  for (const { workspace, repository } of opened.splice(0)) {
    await workspace.close(); const name = repository.database.name; repository.close(); await Dexie.delete(name)
  }
})
async function setup() {
  const source = fixture({ building: true }), scene = source.project.document, layer = scene.entityLayers.room
  Object.assign(scene.props.item, { positionMm: { x: 4500, y: 4500 }, roomId: 'room', supportRef: { kind: 'room', id: 'room' } })
  scene.props.other.positionMm = { x: 16000, y: 16000 }
  scene.openings.door = { id: 'door', floorId: 'blank-floor', editLocked: false, wallId: 'wall-0', offsetReferenceVertexId: 'vertex-0',
    offsetMm: 1000, widthMm: 1200, kind: 'door', state: 'closed', locked: true, secret: true, revealed: false }
  scene.notes.clue = { id: 'clue', floorId: 'blank-floor', editLocked: false, kind: 'note', text: 'GM clue', visibility: 'gm', anchor: { type: 'entity', entityKind: 'prop', entityId: 'item' } }
  scene.paths.road = { id: 'road', floorId: 'blank-floor', editLocked: false, visibility: 'public',
    centerlineMm: [{ x: 4500, y: 7000 }, { x: 7500, y: 7000 }], widthMm: 400, supportRefs: [{ kind: 'room', id: 'room' }],
    surfaceStyle: null, movementCostMultiplier: 1, renderOrder: 0 }
  scene.entityLayers.door = layer; scene.entityLayers.clue = layer; scene.entityLayers.road = layer
  Object.assign(source.project, createCompositionContent(scene, runtime))
  const repository = new ProjectRepository({ name: `aggregate-building-${crypto.randomUUID()}`, runtime, validation })
  const workspace = new Workspace(repository, { runtime, validation }); opened.push({ workspace, repository })
  await workspace.adoptNew(await fromBundle(source, validation))
  const create: SceneCommand = { type: 'createAggregateGroup', group: { id: 'building', floorId: 'blank-floor', parentId: null,
    frame: { translationMm: { x: 6500, y: 6500 }, quarterTurns: 0 }, editLocked: false, members: buildingAggregateMembers(scene, 'room') } }
  return { workspace, repository, create }
}
const move: SceneCommand = { type: 'transformAggregateBuilding', id: 'building', offsetMm: { x: 1000, y: 0 }, pivotMm: { x: 6500, y: 6500 }, quarterTurns: 1 }

describe('normal workspace complete building aggregate lifecycle', () => {
  it('creates explicit ownership and moves one candidate through cancel/adopt/undo/redo, cold storage and complete package', async () => {
    const { workspace, repository, create } = await setup(), original = workspace.getState().project!
    const grouping = await workspace.preview([create])
    expect(workspace.getState().project).toBe(original)
    expect((await repository.load(original.document.sceneId))!.project.document.aggregateCoordinates).toBeUndefined()
    await workspace.adoptPreview(grouping)
    const baseline = workspace.getState().project!, door = baseline.document.openings.door
    const cancelled = await workspace.preview([move])
    expect(cancelled.aggregateBoundaryImpact!.groups.map(group => group.groupId)).toContain('building')
    expect(cancelled.budgetUsage!.semanticTargets).toBe(1)
    expect(cancelled.budgetUsage!.groupMembers).toBe((create as Extract<SceneCommand, { type: 'createAggregateGroup' }>).group.members.length)
    expect(cancelled.budgetUsage!.geometryPoints).toBeGreaterThan(0)
    expect(workspace.getState().project).toBe(baseline)
    workspace.cancelPreview(cancelled)
    await expect(workspace.adoptPreview(cancelled)).rejects.toThrow(/预览/)
    const preview = await workspace.preview([move])
    await workspace.adoptPreview(preview)
    const adopted = workspace.getState().project!
    expect(adopted.document.props.item.positionMm).toEqual({ x: 9500, y: 4500 })
    expect(adopted.document.openings.door).toEqual(door)
    expect(adopted.historyIdentity).toEqual(baseline.historyIdentity)
    expect(adopted.document.revision).toBe(2)
    workspace.undo()
    expect(workspace.getState().project!.document.props.item.positionMm).toEqual(baseline.document.props.item.positionMm)
    expect(workspace.getState().project!.document.aggregateCoordinates).toEqual(baseline.document.aggregateCoordinates)
    workspace.redo(); await workspace.flush()
    const cold = (await repository.load(original.document.sceneId))!
    expect(cold.project.document.props.item.positionMm).toEqual(adopted.document.props.item.positionMm)
    expect(cold.project.document.aggregateCoordinates).toEqual(adopted.document.aggregateCoordinates)
    expect(cold.project.document.notes.clue.text).toBe('GM clue')
    const imported = await importProject(await exportProject(cold, validation), validation)
    expect(imported.project.document).toEqual(cold.project.document)
    const player = canonicalJson(projectScene(cold.project.document, 'player'))
    expect(player).not.toContain('GM clue')
    expect(player).not.toContain('aggregateCoordinates')
    expect(player).not.toContain('baselineProofValid')
  })

  it('rejects a stale whole-building preview after an unrelated edit and retains independent inner editing', async () => {
    const { workspace, create } = await setup()
    await workspace.execute([create])
    const preview = await workspace.preview([move])
    await workspace.execute([{ type: 'updateProp', id: 'other', changes: { rotationDeg: 17 } }])
    const changed = workspace.getState().project!
    await expect(workspace.adoptPreview(preview)).rejects.toThrow()
    expect(workspace.getState().project).toBe(changed)
    await workspace.execute([{ type: 'updateProp', id: 'item', changes: { positionMm: { x: 5000, y: 5000 } } }])
    expect(workspace.getState().project!.document.aggregateCoordinates).toEqual(changed.document.aggregateCoordinates)
    expect(workspace.getState().project!.document.props.other.rotationDeg).toBe(17)
  })

  it('retains the saved branch and current scene when new-position geometry or a dependency lock rejects the candidate', async () => {
    const { workspace, repository, create } = await setup()
    await workspace.execute([create])
    await workspace.execute([{ type: 'setEditLock', kind: 'note', id: 'clue', locked: true }])
    await workspace.flush()
    const before = workspace.getState().project!, saved = await repository.load(before.document.sceneId)
    await expect(workspace.preview([move])).rejects.toThrow(/锁/)
    expect(workspace.getState().project).toBe(before)
    expect((await repository.load(before.document.sceneId))!.project).toEqual(saved!.project)
    await workspace.execute([{ type: 'setEditLock', kind: 'note', id: 'clue', locked: false }])
    const unchanged = workspace.getState().project!
    await expect(workspace.preview([{ ...move, offsetMm: { x: -10000, y: 0 } }])).rejects.toThrow()
    expect(workspace.getState().project).toBe(unchanged)
    expect(toBundle(unchanged).project.document.aggregateCoordinates!.groups.building.members).toEqual((create as Extract<SceneCommand, { type: 'createAggregateGroup' }>).group.members)
  })
})
