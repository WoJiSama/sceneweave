import { describe, expect, it } from 'vitest'
import { layerSceneV3 } from '../../core/v3/test-fixtures.js'
import type { AggregateGroup } from '../model/aggregate.js'
import { toCurrentSceneDocument } from '../model/current-scene.js'
import type { SceneDocument } from '../model/scene.js'
import { canonicalJson, cloneJson } from '../validation/json.js'
import { validateSceneDocument } from '../validation/scene.js'
import { applyAggregateRepresentationCommand as apply, type AggregateRepresentationCommand } from './commands.js'
import { aggregateWorldFrames } from './state.js'
import { decodeSceneCoordinates, encodeSceneCoordinates } from './scene-coordinates.js'

function fixture(): SceneDocument {
  const scene = toCurrentSceneDocument({ ...cloneJson(layerSceneV3()), format: 'sceneweave-scene' })
  scene.props.other = { ...cloneJson(scene.props.item), id: 'other', positionMm: { x: 6000, y: 5000 } }
  scene.entityLayers.other = scene.entityLayers.item
  return scene
}
function group(id: string, parentId: string | null = null, members: AggregateGroup['members'] = [], x = 0, y = 0, quarterTurns: 0 | 1 | 2 | 3 = 0): AggregateGroup {
  return { id, floorId: 'blank-floor', parentId, frame: { translationMm: { x, y }, quarterTurns }, members, editLocked: false }
}
const world = (scene: SceneDocument) => {
  const { aggregateCoordinates: _state, ...rest } = scene
  return canonicalJson(rest)
}
function create(scene: SceneDocument, value: AggregateGroup) { return apply(scene, { type: 'createAggregateGroup', group: value }) }

describe('aggregate coordinate representation commands', () => {
  it('creates explicit ownership and reparents a nested subtree with exact world preservation', () => {
    const scene = fixture(), unchanged = world(scene)
    create(scene, group('root-a', null, [], 2000, 1000, 1))
    create(scene, group('root-b', null, [], -3000, 2000, 3))
    expect(create(scene, group('inside', 'root-a', [{ kind: 'prop', id: 'item' }], 40, -90, 2))).toEqual({ commandCost: 2 })
    create(scene, group('nested', 'inside', [{ kind: 'prop', id: 'other' }], 11, -37, 1))
    const frames = aggregateWorldFrames(scene.aggregateCoordinates!)
    const result = apply(scene, { type: 'reparentAggregateGroup', id: 'inside', parentId: 'root-b' })
    expect(result.commandCost).toBe(4)
    expect(aggregateWorldFrames(scene.aggregateCoordinates!).get('inside')).toEqual(frames.get('inside'))
    expect(aggregateWorldFrames(scene.aggregateCoordinates!).get('nested')).toEqual(frames.get('nested'))
    expect(world(scene)).toBe(unchanged)
    expect(decodeSceneCoordinates(encodeSceneCoordinates(scene))).toEqual(scene)
    expect(validateSceneDocument(scene).ok).toBe(true)
  })

  it('dissolves into the parent, then world, preserving children and member identities', () => {
    const scene = fixture(), unchanged = world(scene)
    create(scene, group('root', null, [{ kind: 'prop', id: 'item' }], 300, -500, 1))
    create(scene, group('middle', 'root', [{ kind: 'prop', id: 'other' }], -450, 70, 2))
    create(scene, group('leaf', 'middle', [], 51, -13, 3))
    const leafFrame = aggregateWorldFrames(scene.aggregateCoordinates!).get('leaf')
    apply(scene, { type: 'dissolveAggregateGroup', id: 'middle' })
    expect(scene.aggregateCoordinates!.groups.root.members).toEqual([{ kind: 'prop', id: 'item' }, { kind: 'prop', id: 'other' }])
    expect(scene.aggregateCoordinates!.groups.leaf.parentId).toBe('root')
    expect(aggregateWorldFrames(scene.aggregateCoordinates!).get('leaf')).toEqual(leafFrame)
    apply(scene, { type: 'dissolveAggregateGroup', id: 'root' })
    expect(scene.aggregateCoordinates!.groups.leaf.parentId).toBeNull()
    expect(aggregateWorldFrames(scene.aggregateCoordinates!).get('leaf')).toEqual(leafFrame)
    expect(world(scene)).toBe(unchanged)
    apply(scene, { type: 'dissolveAggregateGroup', id: 'leaf' })
    expect(scene.aggregateCoordinates).toBeUndefined()
    expect(world(scene)).toBe(unchanged)
  })

  it('refuses duplicate ownership, cycles, unknown frames and integer overflow atomically', () => {
    const scene = fixture()
    create(scene, group('root', null, [{ kind: 'prop', id: 'item' }]))
    create(scene, group('child', 'root'))
    const before = cloneJson(scene)
    const bad: AggregateRepresentationCommand[] = [
      { type: 'createAggregateGroup', group: group('duplicate', null, [{ kind: 'prop', id: 'item' }]) },
      { type: 'reparentAggregateGroup', id: 'root', parentId: 'child' },
      { type: 'createAggregateGroup', group: { ...group('free-angle'), frame: { translationMm: { x: 0, y: 0 }, quarterTurns: 0, angle: 1 } } as AggregateGroup },
      { type: 'createAggregateGroup', group: group('overflow', null, [{ kind: 'prop', id: 'other' }], -Number.MAX_SAFE_INTEGER) },
    ]
    for (const command of bad) {
      expect(() => apply(scene, command)).toThrow()
      expect(scene).toEqual(before)
    }
  })

  it('checks member, layer and recursive dependency locks before representation changes', () => {
    for (const lock of ['member', 'layer', 'dependency'] as const) {
      const scene = fixture()
      create(scene, group('root', null, [{ kind: 'prop', id: 'item' }]))
      create(scene, group('target'))
      if (lock === 'member') scene.props.item.editLocked = true
      if (lock === 'layer') scene.userLayers[scene.entityLayers.item].editLocked = true
      if (lock === 'dependency') {
        scene.notes.protected = { id: 'protected', floorId: 'blank-floor', editLocked: true, kind: 'note', text: 'private', visibility: 'gm', anchor: { type: 'entity', entityKind: 'prop', entityId: 'item' } }
        scene.entityLayers.protected = scene.entityLayers.item
      }
      const before = cloneJson(scene)
      expect(() => apply(scene, { type: 'reparentAggregateGroup', id: 'root', parentId: 'target' })).toThrow(/锁/)
      expect(() => apply(scene, { type: 'dissolveAggregateGroup', id: 'root' })).toThrow(/锁/)
      expect(scene).toEqual(before)
    }
  })

  it('rejects cross-Floor parenting, duplicate IDs, missing members and unsupported group locks', () => {
    const scene = fixture()
    scene.floors.upstairs = { ...cloneJson(scene.floors['blank-floor']), id: 'upstairs' }
    create(scene, group('root', null, [{ kind: 'prop', id: 'item' }]))
    create(scene, { ...group('other-floor'), floorId: 'upstairs' })
    const before = cloneJson(scene)
    expect(() => apply(scene, { type: 'reparentAggregateGroup', id: 'root', parentId: 'other-floor' })).toThrow(/Floor/)
    expect(() => create(scene, group('item'))).toThrow(/ID/)
    expect(() => create(scene, group('missing-member', null, [{ kind: 'prop', id: 'missing' }]))).toThrow(/成员/)
    expect(() => create(scene, { ...group('locked-group'), editLocked: true })).toThrow(/组锁/)
    expect(scene).toEqual(before)
  })
})
