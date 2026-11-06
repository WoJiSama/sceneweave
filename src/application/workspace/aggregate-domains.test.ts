import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import { ProjectRepository } from '../../platform/browser/storage/repository.js'
import { naturalAggregateMembers } from '../../shared/aggregates/domain-adapters.js'
import { planAggregateCopy } from '../../shared/aggregates/group-copy.js'
import { createCompositionContent } from '../../shared/appearance/graph.js'
import type { SceneCommand } from '../../shared/commands/commands.js'
import { projectScene } from '../../shared/projection/projection.js'
import { exportProject, importProject } from '../../shared/project/file.js'
import { canonicalJson } from '../../shared/validation/json.js'
import { fromBundle } from './project.js'
import { fixture, runtime, validation } from './test-fixtures.js'
import { Workspace } from './workspace.js'

const opened: { workspace: Workspace; repository: ProjectRepository }[] = []
afterEach(async () => { for (const { workspace, repository } of opened.splice(0)) { await workspace.close(); const name = repository.database.name; repository.close(); await Dexie.delete(name) } })
async function setup(natural = true) {
  const source = fixture(), scene = source.project.document, floorId = 'blank-floor', layer = scene.entityLayers.item
  scene.props.item.positionMm = { x: 5000, y: 5000 }; scene.props.other.positionMm = { x: 18000, y: 18000 }
  if (natural) {
    scene.terrainAreas.ground = { id: 'ground', floorId, editLocked: false, visibility: 'public',
      boundaryMm: [{ x: 3000, y: 3000 }, { x: 13000, y: 3000 }, { x: 13000, y: 13000 }, { x: 3000, y: 13000 }]
        .map((positionMm, i) => ({ id: `ground-p${i}`, segmentId: `ground-s${i}`, positionMm })),
      groundElevationMm: 0, coveragePriority: 1, surfaceStyle: null, blocksMovement: false, blocksSight: false, movementCostMultiplier: 1 }
    scene.props.item.supportRef = { kind: 'terrainArea', id: 'ground' }
    scene.paths.road = { id: 'road', floorId, editLocked: false, visibility: 'public', centerlineMm: [{ x: 5000, y: 9000 }, { x: 10000, y: 9000 }],
      widthMm: 400, supportRefs: [{ kind: 'terrainArea', id: 'ground' }], surfaceStyle: null, movementCostMultiplier: 1, renderOrder: 0 }
    scene.entityLayers.ground = layer; scene.entityLayers.road = layer
  }
  scene.notes.clue = { id: 'clue', floorId, editLocked: false, kind: 'clue', text: 'aggregate-private', visibility: 'gm', anchor: { type: 'entity', entityKind: 'prop', entityId: 'item' } }
  scene.entityLayers.clue = layer
  Object.assign(source.project, createCompositionContent(scene, runtime))
  const repository = new ProjectRepository({ name: `aggregate-domains-${crypto.randomUUID()}`, runtime, validation }), workspace = new Workspace(repository, { runtime, validation })
  opened.push({ workspace, repository }); await workspace.adoptNew(await fromBundle(source, validation))
  const members = natural ? naturalAggregateMembers(scene, ['ground']) : [{ kind: 'prop' as const, id: 'item' }, { kind: 'note' as const, id: 'clue' }]
  await workspace.execute([{ type: 'createAggregateGroup', group: { id: 'group', floorId, parentId: null, editLocked: false,
    frame: { translationMm: { x: 8000, y: 8000 }, quarterTurns: 0 }, members } }])
  return { workspace, repository }
}
const move: SceneCommand = { type: 'transformAggregateNatural', id: 'group', offsetMm: { x: 1000, y: 500 }, pivotMm: { x: 8000, y: 8000 }, quarterTurns: 1 }

describe('aggregate domains and group editing through the normal workspace', () => {
  it('adopts natural movement, edits an inner member, splits/merges ownership, and saves one complete offline closure', async () => {
    const { workspace, repository } = await setup(), initial = workspace.getState().project!, tokens = initial.historyIdentity
    const cancelled = await workspace.preview([move]); workspace.cancelPreview(cancelled)
    expect(workspace.getState().project).toBe(initial)
    await workspace.adoptPreview(await workspace.preview([move]))
    const moved = workspace.getState().project!
    expect(moved.document.props.item.positionMm).toEqual({ x: 12000, y: 5500 })
    expect(moved.document.props.other).toEqual(initial.document.props.other)
    expect(moved.historyIdentity).toEqual(tokens)
    workspace.undo(); expect(workspace.getState().project!.document.props.item.positionMm).toEqual(initial.document.props.item.positionMm)
    workspace.redo()
    await workspace.execute([{ type: 'updateProp', id: 'item', changes: { rotationDeg: 17 } }])
    const members = workspace.getState().project!.document.aggregateCoordinates!.groups.group.members
    await workspace.execute([{ type: 'splitAggregateGroup', id: 'group', parts: [
      { id: 'content', members: members.filter(ref => ref.kind !== 'terrainArea'), childGroupIds: [] },
      { id: 'ground-only', members: members.filter(ref => ref.kind === 'terrainArea'), childGroupIds: [] },
    ] }])
    await workspace.execute([{ type: 'mergeAggregateGroups', ids: ['content', 'ground-only'], newId: 'merged' }])
    expect(workspace.getState().project!.historyIdentity.propTokens).toEqual(tokens.propTokens)
    expect(workspace.getState().project!.document.props.item.rotationDeg).toBe(17)
    await workspace.flush(); const cold = (await repository.load(initial.document.sceneId))!
    expect(cold.project.document.aggregateCoordinates!.groups.merged.members).toEqual(members.filter(ref => ref.kind !== 'terrainArea').concat(members.filter(ref => ref.kind === 'terrainArea')))
    expect(canonicalJson(projectScene(cold.project.document, 'player'))).not.toContain('aggregate-private')
    const offline = await importProject(await exportProject(cold, validation), validation)
    expect(offline.project).toEqual(cold.project)
  }, 30000)

  it('copies a complete finite group subtree once and preserves the saved branch on stale preview or lock failure', async () => {
    const { workspace, repository } = await setup(false), initial = workspace.getState().project!, scope = initial.document
    const commands = planAggregateCopy(scope, 'group', { offsetMm: { x: 3000, y: 0 }, idMap: { group: 'copy', item: 'new-item', clue: 'new-clue' }, externalRefs: [{ kind: 'floor', id: 'blank-floor' }] })
    const stale = await workspace.preview(commands)
    await workspace.execute([{ type: 'updateProp', id: 'other', changes: { rotationDeg: 9 } }])
    await expect(workspace.adoptPreview(stale)).rejects.toThrow()
    await workspace.adoptPreview(await workspace.preview(commands))
    const copied = workspace.getState().project!
    expect(copied.document.notes['new-clue'].anchor).toEqual({ type: 'entity', entityKind: 'prop', entityId: 'new-item' })
    expect(copied.historyIdentity.propTokens['new-item']).not.toBe(copied.historyIdentity.propTokens.item)
    workspace.undo(); expect(workspace.getState().project!.document.props['new-item']).toBeUndefined()
    workspace.redo(); await workspace.flush()
    await workspace.execute([{ type: 'setEditLock', kind: 'note', id: 'clue', locked: true }]); await workspace.flush()
    const saved = await repository.load(initial.document.sceneId), before = workspace.getState().project!
    await expect(workspace.preview([{ type: 'dissolveAggregateGroup', id: 'group' }])).rejects.toThrow(/锁/)
    expect(workspace.getState().project).toBe(before)
    expect((await repository.load(initial.document.sceneId))!.project).toEqual(saved!.project)
  }, 30000)
})
