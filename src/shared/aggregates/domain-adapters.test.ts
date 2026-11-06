import { describe, expect, it } from 'vitest'
import { fixture } from '../../application/workspace/test-fixtures.js'
import { applyAggregateRepresentationCommand } from './commands.js'
import { AGGREGATE_DOMAIN_ADAPTERS, inspectAggregateDomain, naturalAggregateMembers } from './domain-adapters.js'
import { canonicalJson } from '../validation/json.js'

function scene() {
  const scene = fixture({ building: true }).project.document, floorId = 'blank-floor', layer = scene.entityLayers.room
  scene.terrainAreas.ground = { id: 'ground', floorId, editLocked: false, visibility: 'public',
    boundaryMm: [{ x: 2000, y: 2000 }, { x: 14000, y: 2000 }, { x: 14000, y: 14000 }, { x: 2000, y: 14000 }]
      .map((positionMm, i) => ({ id: `ground-p${i}`, segmentId: `ground-s${i}`, positionMm })),
    groundElevationMm: 0, coveragePriority: 1, surfaceStyle: null, blocksMovement: false, blocksSight: false, movementCostMultiplier: 1 }
  scene.rooms.room.supportRef = { kind: 'terrainArea', id: 'ground' }
  scene.props.item.positionMm = { x: 6000, y: 6000 }; scene.props.item.supportRef = { kind: 'room', id: 'room' }; scene.props.item.roomId = 'room'
  scene.props.other.positionMm = { x: 18000, y: 18000 }
  scene.notes.first = { id: 'first', floorId, editLocked: false, anchor: { type: 'entity', entityKind: 'prop', entityId: 'item' }, kind: 'note', text: 'manual', visibility: 'gm' }
  scene.notes.second = { ...scene.notes.first, id: 'second', anchor: { type: 'entity', entityKind: 'note', entityId: 'first' } }
  for (const id of ['ground', 'first', 'second']) scene.entityLayers[id] = layer
  return scene
}
describe('shared aggregate domain adapters', () => {
  it('declares the same finite rigid-transform capability contract for buildings and natural content', () => {
    expect(AGGREGATE_DOMAIN_ADAPTERS.building.capabilities).toEqual(AGGREGATE_DOMAIN_ADAPTERS.natural.capabilities)
    const source = scene(), before = canonicalJson(source)
    const building = AGGREGATE_DOMAIN_ADAPTERS.building.members(source, [{ kind: 'room', id: 'room' }])
    const natural = AGGREGATE_DOMAIN_ADAPTERS.natural.members(source, [{ kind: 'terrainArea', id: 'ground' }])
    expect(building).not.toContainEqual({ kind: 'terrainArea', id: 'ground' })
    expect(natural).toEqual(expect.arrayContaining([...building, { kind: 'terrainArea', id: 'ground' }]))
    expect(natural).not.toContainEqual({ kind: 'prop', id: 'other' })
    expect(canonicalJson(source)).toBe(before)
  })
  it('rechecks the exact nested ownership set and exposes only external read dependencies', () => {
    const source = scene(), members = naturalAggregateMembers(source, ['ground'])
    applyAggregateRepresentationCommand(source, { type: 'createAggregateGroup', group: { id: 'natural', floorId: 'blank-floor', parentId: null,
      frame: { translationMm: { x: 5000, y: 5000 }, quarterTurns: 0 }, members, editLocked: false } })
    expect(inspectAggregateDomain(source, 'natural')).toMatchObject({ domain: 'natural', members,
      readDependencies: [{ kind: 'floor', id: 'blank-floor' }] })
    source.aggregateCoordinates!.groups.natural.members = members.filter(ref => ref.id !== 'wall-0')
    expect(() => inspectAggregateDomain(source, 'natural')).toThrow(/完整拥有/)
  })
  it('does not silently adopt a later dependent or an extra Floor-supported member', () => {
    for (const mode of ['later', 'extra'] as const) {
      const source = scene(), members = naturalAggregateMembers(source, ['ground'])
      applyAggregateRepresentationCommand(source, { type: 'createAggregateGroup', group: { id: 'natural', floorId: 'blank-floor', parentId: null,
        frame: { translationMm: { x: 0, y: 0 }, quarterTurns: 0 }, members, editLocked: false } })
      if (mode === 'later') source.props.other.supportRef = { kind: 'terrainArea', id: 'ground' }
      else source.aggregateCoordinates!.groups.natural.members.push({ kind: 'prop', id: 'other' })
      expect(() => inspectAggregateDomain(source, 'natural'), mode).toThrow(/完整拥有/)
    }
    expect(() => naturalAggregateMembers(scene(), ['missing'])).toThrow(/不存在/)
    expect(() => naturalAggregateMembers(scene(), ['ground', 'ground'])).toThrow(/不重复/)
  })
})
