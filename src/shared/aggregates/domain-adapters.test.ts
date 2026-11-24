import { describe, expect, it } from 'vitest'
import { fixture, runtime } from '../../application/workspace/test-fixtures.js'
import { applyCommands } from '../commands/commands.js'
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
function groupBanks(doc: ReturnType<typeof scene>) {
  return applyCommands(doc, ['ground', 'bank'].map(id => ({ type: 'createAggregateGroup', group: {
    id: id + '-group', floorId: doc.terrainAreas[id].floorId, parentId: null, editLocked: false,
    frame: { translationMm: { x: 0, y: 0 }, quarterTurns: 0 }, members: naturalAggregateMembers(doc, [id]),
  } })), runtime)
}
describe('shared aggregate domain adapters', () => {
  it('adds a later vegetation scatter and its live outputs, preserving a deleted slot on regeneration', () => {
    const base = fixture({ image: true }).project.document, floorId = 'blank-floor'
    const land = applyCommands(base, [{ type: 'createTerrainArea', id: 'land', floorId,
      boundaryMm: [{ x: 11000, y: 2000 }, { x: 19000, y: 2000 }, { x: 19000, y: 10000 }, { x: 11000, y: 10000 }] }], runtime)
    const grouped = applyCommands(land, [{ type: 'createAggregateGroup', group: { id: 'land-group', floorId, parentId: null,
      editLocked: false, frame: { translationMm: { x: 11000, y: 2000 }, quarterTurns: 0 }, members: naturalAggregateMembers(land, ['land']) } }], runtime)
    const planted = applyCommands(grouped, [
      { type: 'createScatter', id: 'grove', floorId, domain: { kind: 'area', areaId: 'land' }, cellSizeMm: 2400, densityFactor: 1,
        palette: [{ key: 'tree', propDefinitionRef: { id: 'definition', version: 1 }, weight: 1 }], seed: 'grove' },
      { type: 'regenerateScatter', id: 'grove' },
    ], runtime)
    const live = Object.entries(planted.scatterGroups.grove.members).filter(([, m]) => m.propId !== null)
    expect(live.length).toBeGreaterThan(1)
    expect(inspectAggregateDomain(planted, 'land-group').members.map(ref => ref.id)).toEqual(expect.arrayContaining(['grove', ...live.map(([, m]) => m.propId)]))
    const [slot, member] = live[0], id = member.propId!
    const regenerated = applyCommands(planted, [{ type: 'deleteProp', id }, { type: 'regenerateScatter', id: 'grove' }], runtime)
    expect(regenerated.scatterGroups.grove.members[slot]).toMatchObject({ propId: null, state: 'deleted' })
    expect(inspectAggregateDomain(regenerated, 'land-group').members.map(ref => ref.id)).not.toContain(id)
    const rotated = applyCommands(regenerated, [{ type: 'transformAggregateNatural', id: 'land-group', offsetMm: { x: 0, y: 0 },
      pivotMm: { x: 15000, y: 6000 }, quarterTurns: 1 }], runtime)
    expect(rotated.scatterGroups.grove.members[slot]).toEqual(regenerated.scatterGroups.grove.members[slot])
    const replanted = applyCommands(rotated, [{ type: 'regenerateScatter', id: 'grove' }], runtime)
    expect(inspectAggregateDomain(replanted, 'land-group').members).toContainEqual({ kind: 'scatterGroup', id: 'grove' })
  })

  it('leaves a road spanning two independent terrain groups external to both', () => {
    const floorId = 'blank-floor'
    const source = applyCommands(scene(), [{ type: 'createTerrainArea', id: 'bank', floorId,
      boundaryMm: [{ x: 14000, y: 2000 }, { x: 19000, y: 2000 }, { x: 19000, y: 14000 }, { x: 14000, y: 14000 }] }], runtime)
    const addRoad = (doc: typeof source) => applyCommands(doc, [{ type: 'createPath', id: 'crossing', floorId, widthMm: 400,
      centerlineMm: [{ x: 12500, y: 6000 }, { x: 16000, y: 6000 }], supportRefs: [{ kind: 'terrainArea', id: 'ground' }, { kind: 'terrainArea', id: 'bank' }] },
      { type: 'createNote', id: 'sign', floorId, kind: 'label', text: 'waypoint', visibility: 'public',
        anchor: { type: 'entity', entityKind: 'path', entityId: 'crossing' } }], runtime)
    const groups = groupBanks(source), linked = addRoad(groups)
    expect(linked.aggregateCoordinates).toEqual(groups.aggregateCoordinates)
    expect(groupBanks(addRoad(source)).aggregateCoordinates).toEqual(linked.aggregateCoordinates)
    for (const id of ['ground-group', 'bank-group']) {
      expect(inspectAggregateDomain(linked, id).readDependencies).toContainEqual({ kind: 'path', id: 'crossing' })
    }
    expect(linked.paths.crossing.supportRefs).toHaveLength(2)
    expect(() => applyCommands(linked, [{ type: 'transformAggregateNatural', id: 'ground-group', offsetMm: { x: -1000, y: 0 },
      pivotMm: { x: 0, y: 0 }, quarterTurns: 0 }], runtime)).toThrow(/未随动/)
    const oneBank = applyCommands(linked, [{ type: 'updatePath', id: 'crossing', changes: {
      centerlineMm: [{ x: 15000, y: 6000 }, { x: 16500, y: 6000 }], supportRefs: [{ kind: 'terrainArea', id: 'bank' }],
    } }], runtime)
    expect(inspectAggregateDomain(oneBank, 'bank-group').members.map(ref => ref.id)).toEqual(expect.arrayContaining(['crossing', 'sign']))
    expect(inspectAggregateDomain(oneBank, 'ground-group').readDependencies).not.toContainEqual({ kind: 'path', id: 'crossing' })

    const beforeGroups = addRoad(source)
    const legacy = applyCommands(beforeGroups, [{ type: 'createAggregateGroup', group: {
      ...groups.aggregateCoordinates!.groups['ground-group'],
      members: [...naturalAggregateMembers(beforeGroups, ['ground']), { kind: 'path', id: 'crossing' }, { kind: 'note', id: 'sign' }],
    } }], runtime)
    const annotated = applyCommands(legacy, [{ type: 'createNote', id: 'second-sign', floorId, kind: 'label', text: 'old crossing', visibility: 'gm',
      anchor: { type: 'entity', entityKind: 'path', entityId: 'crossing' } }], runtime)
    const scope = inspectAggregateDomain(annotated, 'ground-group')
    expect(scope.members.map(ref => ref.id)).toEqual(expect.arrayContaining(['crossing', 'sign', 'second-sign']))
    expect(scope.readDependencies).toContainEqual({ kind: 'terrainArea', id: 'bank' })
  })

  it('keeps a shared terrain edge and ramp external in either construction order and owns stairs down to the open Floor', () => {
    const floorId = 'blank-floor'
    const banks = applyCommands(scene(), [{ type: 'createTerrainArea', id: 'bank', floorId, groundElevationMm: 1000,
      boundaryMm: [{ x: 14000, y: 2000 }, { x: 19000, y: 2000 }, { x: 19000, y: 14000 }, { x: 14000, y: 14000 }] }], runtime)
    const link = (doc: typeof banks) => applyCommands(doc, [
      { type: 'createTerrainEdge', id: 'cliff', source: { areaId: 'ground', segmentId: 'ground-s1' } },
      { type: 'createTerrainConnection', id: 'ramp', floorId, kind: 'ramp', widthMm: 600,
        from: { surfaceRef: { kind: 'terrainArea', id: 'ground' }, positionMm: { x: 12000, y: 6000 } },
        to: { surfaceRef: { kind: 'terrainArea', id: 'bank' }, positionMm: { x: 16000, y: 6000 } } },
      { type: 'createTerrainConnection', id: 'steps', floorId, kind: 'stairs', widthMm: 600,
        from: { surfaceRef: { kind: 'terrainArea', id: 'bank' }, positionMm: { x: 16000, y: 13000 } },
        to: { surfaceRef: { kind: 'floor', id: floorId }, positionMm: { x: 16000, y: 15000 } } },
    ], runtime)
    for (const doc of [link(groupBanks(banks)), groupBanks(link(banks))]) {
      for (const id of ['ground-group', 'bank-group']) {
        const scope = inspectAggregateDomain(doc, id)
        expect(scope.readDependencies.map(ref => ref.id)).toEqual(expect.arrayContaining(['cliff', 'ramp']))
        expect(scope.members.map(ref => ref.id)).not.toContain('ramp')
        expect(scope.members.map(ref => ref.id)).not.toContain('cliff')
      }
      expect(inspectAggregateDomain(doc, 'bank-group').members).toContainEqual({ kind: 'terrainConnection', id: 'steps' })
      expect(naturalAggregateMembers(doc, ['ground', 'bank']).map(ref => ref.id)).toEqual(expect.arrayContaining(['cliff', 'ramp', 'steps']))
    }
  })

  it('respects a hand-grouped point note and an incomplete building baseline', () => {
    const original = fixture({ building: true }).project.document, floorId = 'blank-floor'
    const note = applyCommands(original, [{ type: 'createNote', id: 'pin', floorId, kind: 'clue', text: 'private', visibility: 'gm',
      anchor: { type: 'point', positionMm: { x: 7000, y: 7000 } } }], runtime)
    const base = { floorId, parentId: null, editLocked: false, frame: { translationMm: { x: 0, y: 0 }, quarterTurns: 0 as const } }
    const building = AGGREGATE_DOMAIN_ADAPTERS.building.members(note, [{ kind: 'room', id: 'room' }])
    const grouped = applyCommands(note, [
      { type: 'createAggregateGroup', group: { ...base, id: 'house', members: building } },
      { type: 'createAggregateGroup', group: { ...base, id: 'notes', members: [{ kind: 'note', id: 'pin' }] } },
    ], runtime)
    expect(() => applyCommands(grouped, [{ type: 'updateNote', id: 'pin',
      changes: { anchor: { type: 'entity', entityKind: 'room', entityId: 'room' } } }], runtime)).toThrow(/手工组/)
    expect(grouped.notes.pin.anchor.type).toBe('point')
    const partial = applyCommands(note, [{ type: 'createAggregateGroup', group: { ...base, id: 'walls', members: building.filter(ref => ref.kind === 'wall') } }], runtime)
    const opened = applyCommands(partial, [{ type: 'addOpening', id: 'opening', wallId: 'wall-0', offsetReferenceVertexId: 'vertex-0',
      offsetMm: 1500, widthMm: 900, kind: 'window' }], runtime)
    expect(opened.aggregateCoordinates).toEqual(partial.aggregateCoordinates)
  })

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
