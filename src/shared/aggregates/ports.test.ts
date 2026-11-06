import { describe, expect, it } from 'vitest'
import { fixture, runtime } from '../../application/workspace/test-fixtures.js'
import type { AggregateCoordinates } from '../model/aggregate.js'
import type { SceneDocument } from '../model/scene.js'
import { cloneJson } from '../validation/json.js'
import { validateSceneDocument } from '../validation/scene.js'
import { sampleConnectionRoute, type ConnectionRoute } from '../geometry/connection-route.js'
import { createRefinedBlankDocument } from '../../platform/browser/content/refined-blank.js'
import { emptyCompositionDocument } from '../terrain-generation/composition-materialize.js'
import { deriveAggregatePortGeometry } from './ports.js'

function withGroups(scene: SceneDocument, groups: AggregateCoordinates['groups']): SceneDocument {
  scene.aggregateCoordinates = { encoding: 'world', groups }
  return scene
}
function group(id: string, members: AggregateCoordinates['groups'][string]['members']) {
  return { id, floorId: 'blank-floor', parentId: null, frame: { translationMm: { x: 0, y: 0 }, quarterTurns: 0 as const }, members, editLocked: false }
}
function valid(scene: SceneDocument): SceneDocument {
  const result = validateSceneDocument(scene)
  if (!result.ok) throw new Error(result.errors.map(issue => issue.message).join('；'))
  return result.document
}

function doorwayScene(): SceneDocument {
  const scene = cloneJson(fixture({ building: true }).project.document)
  scene.openings.door = { id: 'door', floorId: 'blank-floor', editLocked: false, wallId: 'wall-0', offsetReferenceVertexId: 'vertex-0',
    offsetMm: 1000, widthMm: 1200, kind: 'door', state: 'closed', locked: true, secret: false, revealed: false }
  scene.entityLayers.door = scene.entityLayers['wall-0']
  return valid(withGroups(scene, { building: group('building', [
    { kind: 'room', id: 'room' }, { kind: 'wall', id: 'wall-0' }, { kind: 'opening', id: 'door' },
  ]) }))
}

function pathScene(): SceneDocument {
  const scene = cloneJson(fixture().project.document)
  scene.paths.trail = { id: 'trail', floorId: 'blank-floor', editLocked: false, visibility: 'public',
    centerlineMm: [{ x: 1000, y: 15000 }, { x: 10000, y: 15000 }], widthMm: 600,
    supportRefs: [{ kind: 'floor', id: 'blank-floor' }], surfaceStyle: null, movementCostMultiplier: 1, renderOrder: 0 }
  scene.entityLayers.trail = scene.entityLayers.item
  return valid(withGroups(scene, { route: group('route', [{ kind: 'path', id: 'trail' }]) }))
}

function heightConnectionScene(): SceneDocument {
  const base = createRefinedBlankDocument('island', { sceneId: 'port-height-connection', title: 'Port connection',
    widthMm: 24000, heightMm: 18000, preset: 'narrative', now: '2026-11-05T00:00:00.000Z' })
  const scene = emptyCompositionDocument(base); scene.schemaVersion = 1
  scene.terrainAreas.high = { id: 'high', floorId: 'visual-floor', editLocked: false, visibility: 'public',
    boundaryMm: [{ x: 10000, y: 0 }, { x: 24000, y: 0 }, { x: 24000, y: 18000 }, { x: 10000, y: 18000 }]
      .map((positionMm, index) => ({ id: `high-p${index}`, segmentId: `high-s${index}`, positionMm })),
    groundElevationMm: 1800, coveragePriority: 1, surfaceStyle: null, blocksMovement: false, blocksSight: false, movementCostMultiplier: 1 }
  scene.terrainConnections.ramp = { id: 'ramp', floorId: 'visual-floor', editLocked: false, visibility: 'public', kind: 'ramp',
    from: { surfaceRef: { kind: 'floor', id: 'visual-floor' }, positionMm: { x: 8500, y: 9000 } },
    to: { surfaceRef: { kind: 'terrainArea', id: 'high' }, positionMm: { x: 11500, y: 9000 } },
    widthMm: 1400, openingId: null, blocksMovement: false, movementCostMultiplier: 1.4, surfaceStyle: null }
  scene.entityLayers.high = 'visual-layer-ground'; scene.entityLayers.ramp = 'visual-layer-ground'
  return valid(withGroups(scene, { 'ramp-group': { id: 'ramp-group', floorId: 'visual-floor', parentId: null,
    frame: { translationMm: { x: 0, y: 0 }, quarterTurns: 0 }, members: [{ kind: 'terrainConnection', id: 'ramp' }], editLocked: false } }))
}

describe('derived aggregate port geometry', () => {
  it('uses the stable wall endpoint and real adjacent room to derive a door port; leaf state is separate from structure', () => {
    const scene = doorwayScene(), opening = scene.openings.door
    const closed = deriveAggregatePortGeometry(scene, { id: 'entrance', groupId: 'building', endpoint: { kind: 'opening', id: 'door' } })
    expect(closed).toMatchObject({ floorId: opening.floorId, widthMm: opening.widthMm, elevationMm: scene.rooms.room.groundElevationMm,
      supportRefs: [{ kind: 'room', id: 'room' }], structuralConnection: true, currentlyPassable: false })
    expect(closed.positionMm.x).toBe(4600)
    expect(closed.positionMm.y).toBe(3000)
    expect(closed.directionDeg).toBe(270)
    scene.openings.door.state = 'open'
    scene.openings.door.locked = false
    expect(deriveAggregatePortGeometry(scene, { id: 'entrance', groupId: 'building', endpoint: { kind: 'opening', id: 'door' } }).currentlyPassable).toBe(true)
    scene.openings.door.kind = 'window'
    expect(deriveAggregatePortGeometry(scene, { id: 'window', groupId: 'building', endpoint: { kind: 'opening', id: 'door' } }))
      .toMatchObject({ structuralConnection: false, currentlyPassable: false })
  })

  it('derives both path ends from centerline tangents and checks actual current route blockers', () => {
    const scene = pathScene(), input = { id: 'path-start', groupId: 'route', endpoint: { kind: 'path', id: 'trail', end: 'start' } }
    const start = deriveAggregatePortGeometry(scene, input)
    const end = deriveAggregatePortGeometry(scene, { ...input, id: 'path-end', endpoint: { kind: 'path', id: 'trail', end: 'end' } })
    expect(start).toMatchObject({ positionMm: { x: 1000, y: 15000 }, directionDeg: 180, widthMm: 600,
      supportRefs: [{ kind: 'floor', id: 'blank-floor' }], elevationMm: 0, structuralConnection: true, currentlyPassable: true })
    expect(end).toMatchObject({ positionMm: { x: 10000, y: 15000 }, directionDeg: 0, currentlyPassable: true })
    scene.regions.blocker = { id: 'blocker', floorId: 'blank-floor', editLocked: false, visibility: 'public', kind: 'hazard',
      boundaryMm: [{ x: 4000, y: 14800 }, { x: 5000, y: 14800 }, { x: 5000, y: 15200 }, { x: 4000, y: 15200 }],
      blocksMovement: true, movementCostMultiplier: 1 }
    scene.entityLayers.blocker = scene.entityLayers.trail
    valid(scene)
    expect(deriveAggregatePortGeometry(scene, input).currentlyPassable).toBe(false)
  })

  it('derives real support, elevation and outward tangent for each side of a ramp', () => {
    const scene = heightConnectionScene(), base = { id: 'ramp-port', groupId: 'ramp-group' }
    const from = deriveAggregatePortGeometry(scene, { ...base, endpoint: { kind: 'terrainConnection', id: 'ramp', end: 'from' } })
    const to = deriveAggregatePortGeometry(scene, { ...base, id: 'high-port', endpoint: { kind: 'terrainConnection', id: 'ramp', end: 'to' } })
    expect(from).toMatchObject({ positionMm: { x: 8500, y: 9000 }, directionDeg: 180, widthMm: 1400,
      elevationMm: 0, supportRefs: [{ kind: 'floor', id: 'visual-floor' }], structuralConnection: true, currentlyPassable: true })
    expect(to).toMatchObject({ positionMm: { x: 11500, y: 9000 }, directionDeg: 0, elevationMm: 1800,
      supportRefs: [{ kind: 'terrainArea', id: 'high' }], structuralConnection: true, currentlyPassable: true })
    scene.terrainConnections.ramp.blocksMovement = true
    valid(scene)
    expect(deriveAggregatePortGeometry(scene, { ...base, endpoint: { kind: 'terrainConnection', id: 'ramp', end: 'to' } }).currentlyPassable).toBe(false)
    expect(deriveAggregatePortGeometry(scene, { ...base, endpoint: { kind: 'terrainConnection', id: 'ramp', end: 'from' } }).elevationMm).toBe(0)
  })

  it('orients bent connection ports away from their own real endpoint tangent', () => {
    const scene = heightConnectionScene(), connection = scene.terrainConnections.ramp
    const points = [connection.from.positionMm, { x: 9000, y: 9500 }, { x: 11000, y: 9500 }, connection.to.positionMm]
    const source: Pick<ConnectionRoute, 'kind' | 'segments' | 'sampleSpacingMm' | 'toleranceMm'> = {
      kind: 'polyline', sampleSpacingMm: 1000, toleranceMm: 10,
      segments: points.slice(1).map((end, index) => ({ id: `port-bend-${index}`, start: points[index], control1: points[index], control2: end, end })),
    }
    connection.route = { ...source, version: 1, centerlineMm: sampleConnectionRoute(source), stairStyle: 'stone', treadDepthMm: 300 }
    valid(scene)
    const base = { id: 'bend-port', groupId: 'ramp-group' }
    expect(deriveAggregatePortGeometry(scene, { ...base, endpoint: { kind: 'terrainConnection', id: 'ramp', end: 'from' } }).directionDeg).toBe(225)
    expect(deriveAggregatePortGeometry(scene, { ...base, endpoint: { kind: 'terrainConnection', id: 'ramp', end: 'to' } }).directionDeg).toBe(315)
  })

  it('refuses false ownership, ambiguous room orientation and caller geometry fields', () => {
    const scene = doorwayScene()
    expect(() => deriveAggregatePortGeometry(scene, { id: 'fake', groupId: 'building', endpoint: { kind: 'opening', id: 'missing' } })).toThrow(/不存在/)
    expect(() => deriveAggregatePortGeometry(scene, { id: 'fake', groupId: 'absent', endpoint: { kind: 'opening', id: 'door' } })).toThrow(/聚合体/)
    expect(() => deriveAggregatePortGeometry(scene, { id: 'fake', groupId: 'building', endpoint: { kind: 'opening', id: 'door' }, positionMm: { x: 0, y: 0 } })).toThrow()
    scene.aggregateCoordinates!.groups.building.members = [{ kind: 'opening', id: 'door' }, { kind: 'wall', id: 'wall-0' }]
    valid(scene)
    expect(() => deriveAggregatePortGeometry(scene, { id: 'ambiguous', groupId: 'building', endpoint: { kind: 'opening', id: 'door' } })).toThrow(/相邻房间/)
  })
})
