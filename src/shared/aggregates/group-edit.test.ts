import { describe, expect, it } from 'vitest'
import { fixture, runtime } from '../../application/workspace/test-fixtures.js'
import { applyCompositionCommands } from '../appearance/commands.js'
import { applyCommands } from '../commands/commands.js'
import type { AggregateGroup } from '../model/aggregate.js'
import type { SceneDocument } from '../model/scene.js'
import { canonicalJson, cloneJson } from '../validation/json.js'
import { applyAggregateRepresentationCommand as apply } from './commands.js'
import { decodeSceneCoordinates, encodeSceneCoordinates } from './scene-coordinates.js'
import { aggregateWorldFrames } from './state.js'

const group = (id: string, parentId: string | null = null, members: AggregateGroup['members'] = [], x = 0, turn: 0 | 1 | 2 | 3 = 0): AggregateGroup => ({
  id, parentId, members, floorId: 'blank-floor', editLocked: false, frame: { translationMm: { x, y: -300 }, quarterTurns: turn },
})
function source() {
  const bundle = fixture(), scene = bundle.project.document
  scene.aggregateCoordinates = { encoding: 'world', groups: {
    root: group('root', null, [], 100, 1),
    source: group('source', 'root', [{ kind: 'prop', id: 'item' }], 500, 2),
    child: group('child', 'source', [{ kind: 'prop', id: 'other' }], -700, 3),
    peer: group('peer', 'root', [], 900, 3),
  } }
  return scene
}
const world = (scene: SceneDocument) => { const { aggregateCoordinates: _state, ...rest } = scene; return canonicalJson(rest) }

describe('finite aggregate partition and merge', () => {
  it('partitions direct members and whole child groups into fresh sibling containers without changing entities or frames', () => {
    const scene = source(), before = world(scene), frames = aggregateWorldFrames(scene.aggregateCoordinates!)
    const result = apply(scene, { type: 'splitAggregateGroup', id: 'source', parts: [
      { id: 'split-prop', members: [{ kind: 'prop', id: 'item' }], childGroupIds: [] },
      { id: 'split-child', members: [], childGroupIds: ['child'] },
    ] })
    expect(result.commandCost).toBe(6)
    expect(scene.aggregateCoordinates!.groups.source).toBeUndefined()
    expect(scene.aggregateCoordinates!.groups.child.parentId).toBe('split-child')
    const splitFrames = aggregateWorldFrames(scene.aggregateCoordinates!)
    expect(splitFrames.get('split-prop')).toEqual(frames.get('source'))
    expect(splitFrames.get('split-child')).toEqual(frames.get('source'))
    expect(splitFrames.get('child')).toEqual(frames.get('child'))
    expect(world(scene)).toBe(before)
    expect(decodeSceneCoordinates(encodeSceneCoordinates(scene))).toEqual(scene)
  })

  it('merges sibling containers with different frames and reparents children exactly, preserving instance and topology identities', () => {
    const scene = source(), before = world(scene), frames = aggregateWorldFrames(scene.aggregateCoordinates!)
    apply(scene, { type: 'mergeAggregateGroups', ids: ['peer', 'source'], newId: 'merged' })
    expect(scene.aggregateCoordinates!.groups.source).toBeUndefined()
    expect(scene.aggregateCoordinates!.groups.peer).toBeUndefined()
    expect(scene.aggregateCoordinates!.groups.merged.members).toEqual([{ kind: 'prop', id: 'item' }])
    expect(scene.aggregateCoordinates!.groups.child.parentId).toBe('merged')
    expect(aggregateWorldFrames(scene.aggregateCoordinates!).get('child')).toEqual(frames.get('child'))
    expect(world(scene)).toBe(before)
    expect(decodeSceneCoordinates(encodeSceneCoordinates(scene))).toEqual(scene)
    const { document, historyIdentity, appearance } = fixture().project, content = { document, historyIdentity, appearance }
    const initial = applyCompositionCommands(content, [{ type: 'createAggregateGroup', group: group('original', null, [
      { kind: 'prop', id: 'item' }, { kind: 'prop', id: 'other' },
    ]) }], runtime)
    const split = applyCompositionCommands(initial, [{ type: 'splitAggregateGroup', id: 'original', parts: [
      { id: 'left', members: [{ kind: 'prop', id: 'item' }], childGroupIds: [] },
      { id: 'right', members: [{ kind: 'prop', id: 'other' }], childGroupIds: [] },
    ] }], runtime)
    const merged = applyCompositionCommands(split, [{ type: 'mergeAggregateGroups', ids: ['left', 'right'], newId: 'combined' }], runtime)
    expect(merged.historyIdentity.propTokens).toEqual(initial.historyIdentity.propTokens)
    expect(merged.historyIdentity.outdoorTokens).toEqual(initial.historyIdentity.outdoorTokens)
    expect(merged.historyIdentity.aggregateTokens).toMatchObject(initial.historyIdentity.aggregateTokens!)
    expect(Object.keys(merged.historyIdentity.aggregateTokens!)).toEqual(expect.arrayContaining(['original', 'left', 'right', 'combined']))
    expect(merged.appearance).toEqual(initial.appearance)
    expect(merged.document.props).toEqual(initial.document.props)
  })

  it('rejects incomplete/duplicate partitions, old container identities, non-sibling merges and unknown fields atomically', () => {
    const scene = source(), before = cloneJson(scene)
    const partitions = [
      [{ id: 'a', members: [], childGroupIds: ['child'] }, { id: 'b', members: [], childGroupIds: [] }],
      [{ id: 'a', members: [{ kind: 'prop' as const, id: 'item' }], childGroupIds: ['child'] }, { id: 'b', members: [{ kind: 'prop' as const, id: 'item' }], childGroupIds: [] }],
      [{ id: 'source', members: [{ kind: 'prop' as const, id: 'item' }], childGroupIds: [] }, { id: 'b', members: [], childGroupIds: ['child'] }],
      [{ id: 'a', members: [{ kind: 'prop' as const, id: 'item' }], childGroupIds: [] }, { id: 'b', members: [], childGroupIds: ['peer'] }],
    ]
    for (const parts of partitions) { expect(() => apply(scene, { type: 'splitAggregateGroup', id: 'source', parts })).toThrow(); expect(scene).toEqual(before) }
    expect(() => apply(scene, { type: 'mergeAggregateGroups', ids: ['source', 'child'], newId: 'merged' })).toThrow(/同父级/)
    expect(() => apply(scene, { type: 'mergeAggregateGroups', ids: ['source', 'peer'], newId: 'source' })).toThrow(/新容器/)
    expect(() => apply(scene, { type: 'mergeAggregateGroups', ids: ['source', 'peer'], newId: 'merged', resetIds: true } as never)).toThrow()
    expect(scene).toEqual(before)
  })

  it('refuses locked members or recursive note dependencies across every affected child before metadata publication', () => {
    for (const lock of ['member', 'layer', 'note'] as const) {
      const scene = source()
      if (lock === 'member') scene.props.other.editLocked = true
      if (lock === 'layer') scene.userLayers[scene.entityLayers.other].editLocked = true
      if (lock === 'note') {
        scene.notes.locked = { id: 'locked', floorId: 'blank-floor', editLocked: true, kind: 'note', text: 'protected', visibility: 'gm', anchor: { type: 'entity', entityKind: 'prop', entityId: 'other' } }
        scene.entityLayers.locked = scene.entityLayers.other
      }
      const before = cloneJson(scene)
      expect(() => apply(scene, { type: 'mergeAggregateGroups', ids: ['source', 'peer'], newId: 'merged' })).toThrow(/锁/)
      expect(() => apply(scene, { type: 'splitAggregateGroup', id: 'source', parts: [
        { id: 'a', members: [{ kind: 'prop', id: 'item' }], childGroupIds: [] }, { id: 'b', members: [], childGroupIds: ['child'] },
      ] })).toThrow(/锁/)
      expect(scene).toEqual(before)
    }
  })

  it('keeps shared-wall ownership constraints instead of duplicating shared geometry to make a partition valid', () => {
    const scene = fixture({ building: true }).project.document
    // Two identical room boundaries still share one authoritative wall per edge.
    scene.rooms.second = { ...cloneJson(scene.rooms.room), id: 'second' }
    scene.entityLayers.second = scene.entityLayers.room
    scene.aggregateCoordinates = { encoding: 'world', groups: { building: group('building', null, [
      ...Object.keys(scene.rooms).map(id => ({ kind: 'room' as const, id })),
      ...Object.keys(scene.walls).map(id => ({ kind: 'wall' as const, id })),
      ...Object.keys(scene.vertices).map(id => ({ kind: 'vertex' as const, id })),
    ]) } }
    const before = cloneJson(scene)
    expect(() => apply(scene, { type: 'splitAggregateGroup', id: 'building', parts: [
      { id: 'left', members: scene.aggregateCoordinates!.groups.building.members.filter(member => member.id !== 'second'), childGroupIds: [] },
      { id: 'right', members: [{ kind: 'room', id: 'second' }], childGroupIds: [] },
    ] })).toThrow(/共享墙/)
    expect(scene).toEqual(before)
  })

  it('enters the normal strict scene command dispatcher and leaves member editing usable after split and merge', () => {
    const initial = source()
    const split = applyCommands(initial, [{ type: 'splitAggregateGroup', id: 'source', parts: [
      { id: 'left', members: [{ kind: 'prop', id: 'item' }], childGroupIds: [] }, { id: 'right', members: [], childGroupIds: ['child'] },
    ] }], runtime)
    const moved = applyCommands(split, [{ type: 'updateProp', id: 'item', changes: { positionMm: { x: 4400, y: 4300 } } }], runtime)
    const merged = applyCommands(moved, [{ type: 'mergeAggregateGroups', ids: ['left', 'right'], newId: 'merged' }], runtime)
    expect(merged.props.item.positionMm).toEqual({ x: 4400, y: 4300 })
    expect(merged.aggregateCoordinates!.groups.merged.members).toContainEqual({ kind: 'prop', id: 'item' })
    expect(initial.props.item.positionMm).toEqual({ x: 4000, y: 4000 })
  })
})
