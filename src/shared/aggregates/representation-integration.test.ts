import { describe, expect, it } from 'vitest'
import { fixture, runtime } from '../../application/workspace/test-fixtures.js'
import { hitTestAllV2, selectionGeometryV2 } from '../../editor/native-canvas/selection.js'
import { applyCommands, applySnapshotCommands } from '../commands/commands.js'
import { advanceHistoryIdentity } from '../history/identity.js'
import type { AggregateGroup } from '../model/aggregate.js'
import type { ProjectData } from '../model/project.js'
import type { SceneDocument } from '../model/scene.js'
import { applyProjectDelta, applyProjectDeltaChain, createProjectDelta } from '../project/delta.js'
import { projectContentHash, validateProjectData } from '../project/validate.js'
import { projectScene } from '../projection/projection.js'
import { canonicalJson, cloneJson } from '../validation/json.js'
import { validateSceneDocument } from '../validation/scene.js'
import { aggregateWorldFrames } from './state.js'
import { decodeSceneCoordinates, encodeSceneCoordinates } from './scene-coordinates.js'

function group(id: string, parentId: string | null = null, members: AggregateGroup['members'] = [], x = 0, y = 0, quarterTurns: 0 | 1 | 2 | 3 = 0): AggregateGroup {
  return { id, parentId, members, floorId: 'blank-floor', editLocked: false, frame: { translationMm: { x, y }, quarterTurns } }
}
const stripCoordinates = (scene: SceneDocument) => {
  const { aggregateCoordinates: _state, ...world } = scene
  return world
}
function grouped(scene: SceneDocument): SceneDocument {
  return applyCommands(scene, [
    { type: 'createAggregateGroup', group: group('representation-a', null, [], 500, -700, 1) },
    { type: 'createAggregateGroup', group: group('representation-b', null, [], -300, 100, 3) },
    { type: 'createAggregateGroup', group: group('representation-members', 'representation-a', [{ kind: 'prop', id: 'item' }], 50, -70, 2) },
  ], runtime)
}
const withDocument = (project: ProjectData, document: SceneDocument): ProjectData => validateProjectData({ ...project, document,
  historyIdentity: advanceHistoryIdentity(project.historyIdentity, project.document, document, runtime),
})

describe('aggregate representation through normal consumers', () => {
  it('uses normal atomic commands for creation, reparent and dissolution without changing world content', () => {
    const source = fixture().project.document, original = cloneJson(source), initial = grouped(source)
    const frame = aggregateWorldFrames(initial.aggregateCoordinates!).get('representation-members')
    const moved = applyCommands(initial, [{ type: 'reparentAggregateGroup', id: 'representation-members', parentId: 'representation-b' }], runtime)
    expect(aggregateWorldFrames(moved.aggregateCoordinates!).get('representation-members')).toEqual(frame)
    const dissolved = applyCommands(moved, [{ type: 'dissolveAggregateGroup', id: 'representation-members' }], runtime)
    expect(dissolved.aggregateCoordinates!.groups['representation-b'].members).toEqual([{ kind: 'prop', id: 'item' }])
    for (const value of [initial, moved, dissolved]) {
      expect(stripCoordinates(value)).toEqual(stripCoordinates(source))
      expect(decodeSceneCoordinates(encodeSceneCoordinates(value))).toEqual(value)
    }
    expect(source).toEqual(original)
  })

  it('preserves certified snapshot semantics and rejects a locked member atomically', () => {
    const scene = fixture().project.document
    const snapshot = applySnapshotCommands(scene, [{ type: 'createAggregateGroup', group: group('snapshot-group', null, [{ kind: 'prop', id: 'item' }], 300, 500, 1) }], runtime)
    expect(Object.isFrozen(snapshot)).toBe(true)
    expect(Object.isFrozen(snapshot.aggregateCoordinates!.groups['snapshot-group'])).toBe(true)
    expect(applySnapshotCommands(snapshot, [{ type: 'reparentAggregateGroup', id: 'snapshot-group', parentId: null }], runtime)).toBe(snapshot)
    const locked = applySnapshotCommands(snapshot, [{ type: 'setEditLock', kind: 'prop', id: 'item', locked: true }], runtime)
    const before = canonicalJson(locked)
    expect(() => applySnapshotCommands(locked, [{ type: 'dissolveAggregateGroup', id: 'snapshot-group' }], runtime)).toThrow(/锁/)
    expect(canonicalJson(locked)).toBe(before)
  })

  it('projects identical GM/player content before grouping and after local cold materialization', () => {
    const source = cloneJson(fixture().project.document)
    source.props.item.visibility = 'gm'
    const bounds = source.exportBoundsMm
    source.regions['private-mask'] = { id: 'private-mask', floorId: 'blank-floor', editLocked: false, visibility: 'gm', kind: 'manualMask',
      blocksMovement: false, movementCostMultiplier: 1, boundaryMm: [{ x: bounds.x, y: bounds.y }, { x: bounds.x + bounds.width, y: bounds.y },
        { x: bounds.x + bounds.width, y: bounds.y + bounds.height }, { x: bounds.x, y: bounds.y + bounds.height }] }
    source.entityLayers['private-mask'] = source.entityLayers.item
    const complete = grouped(source), cold = decodeSceneCoordinates(encodeSceneCoordinates(complete))
    for (const audience of ['gm', 'player'] as const) {
      expect(projectScene(complete, audience)).toEqual(projectScene(source, audience))
      expect(projectScene(cold, audience)).toEqual(projectScene(source, audience))
      expect(JSON.stringify(projectScene(cold, audience))).not.toContain('representation-members')
    }
  })

  it('uses identical native hit and selection geometry after local materialization', () => {
    const source = fixture().project.document, cold = decodeSceneCoordinates(encodeSceneCoordinates(grouped(source)))
    const point = source.props.item.positionMm
    expect(hitTestAllV2(cold, point, 10)).toEqual(hitTestAllV2(source, point, 10))
    expect(hitTestAllV2(cold, point, 10)).toContain('item')
    expect(selectionGeometryV2(cold, 'item')).toEqual(selectionGeometryV2(source, 'item'))
  })

  it('edits and deletes a grouped member through the existing command path with complete ownership', () => {
    const initial = grouped(fixture().project.document), sourcePoint = cloneJson(initial.props.item.positionMm)
    const edited = applyCommands(initial, [{ type: 'updateProp', id: 'item', changes: { positionMm: { x: sourcePoint.x + 100, y: sourcePoint.y + 200 } } }], runtime)
    expect(edited.props.item.positionMm).toEqual({ x: sourcePoint.x + 100, y: sourcePoint.y + 200 })
    expect(edited.aggregateCoordinates!.groups['representation-members'].members).toEqual([{ kind: 'prop', id: 'item' }])
    expect(decodeSceneCoordinates(encodeSceneCoordinates(edited))).toEqual(edited)
    const deleted = applyCommands(edited, [{ type: 'deleteProp', id: 'item' }], runtime)
    expect(deleted.props.item).toBeUndefined()
    expect(deleted.aggregateCoordinates!.groups['representation-members'].members).toEqual([])
    expect(validateSceneDocument(deleted).ok).toBe(true)
    expect(initial.props.item.positionMm).toEqual(sourcePoint)
  })

  it('reconstructs exact project hashes with local coordinate deltas in both directions and chains', () => {
    const base = fixture().project, first = withDocument(base, grouped(base.document))
    const second = withDocument(first, applyCommands(first.document, [{ type: 'reparentAggregateGroup', id: 'representation-members', parentId: 'representation-b' }], runtime))
    const oldPoint = second.document.props.item.positionMm
    const third = withDocument(second, applyCommands(second.document, [{ type: 'updateProp', id: 'item', changes: { positionMm: { x: oldPoint.x + 110, y: oldPoint.y - 90 } } }], runtime))
    const deltaA = createProjectDelta(first, second), deltaB = createProjectDelta(second, third)
    const localSecond = encodeSceneCoordinates(second.document), localThird = encodeSceneCoordinates(third.document)
    const localX = deltaB.changes.find(change => change.path.join('.') === 'document.props.item.positionMm.x')
    expect(localX?.before).toEqual({ present: true, value: localSecond.props.item.positionMm.x })
    expect(localX?.after).toEqual({ present: true, value: localThird.props.item.positionMm.x })
    expect(applyProjectDelta(first, deltaA, 'forward')).toEqual(second)
    expect(applyProjectDelta(second, deltaA, 'backward')).toEqual(first)
    expect(applyProjectDelta(third, deltaB, 'backward')).toEqual(second)
    const chain = applyProjectDeltaChain(first, [deltaA, deltaB], projectContentHash(first))
    expect(chain.project).toEqual(third)
    expect(chain.states.map(state => state.contentHash)).toEqual([projectContentHash(second), projectContentHash(third)])
    expect(deltaA.beforeHash).toBe(projectContentHash(first))
    expect(deltaA.afterHash).toBe(projectContentHash(second))
    expect(deltaB.afterHash).toBe(projectContentHash(third))
  })
})
