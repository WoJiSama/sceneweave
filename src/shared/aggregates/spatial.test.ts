import { describe, expect, it } from 'vitest'
import { layerSceneV3 } from '../../core/v3/test-fixtures.js'
import { fixture as workspaceFixture } from '../../application/workspace/test-fixtures.js'
import { toCurrentSceneDocument } from '../model/current-scene.js'
import { cloneJson } from '../validation/json.js'
import {
  buildAggregateSpatialIndex, createAggregateSpatialSnapshot, deriveAggregateEntityEnvelopes, queryAggregateSpatialChange, queryAggregateSpatialIndex,
  type AggregateSpatialEntityRef,
} from './spatial.js'

function fixture() {
  const scene = toCurrentSceneDocument({ ...cloneJson(layerSceneV3()), format: 'sceneweave-scene' })
  scene.paths['long-route'] = { id: 'long-route', floorId: 'blank-floor', editLocked: false, visibility: 'public',
    centerlineMm: [{ x: 1000, y: 10000 }, { x: 19000, y: 10000 }], widthMm: 800,
    supportRefs: [{ kind: 'floor', id: 'blank-floor' }], surfaceStyle: null, movementCostMultiplier: 1, renderOrder: 0 }
  scene.entityLayers['long-route'] = scene.entityLayers.item
  scene.regions['private-hazard'] = { id: 'private-hazard', floorId: 'blank-floor', editLocked: false, visibility: 'gm',
    kind: 'hazard', boundaryMm: [{ x: 14000, y: 14000 }, { x: 16000, y: 14000 }, { x: 16000, y: 16000 }, { x: 14000, y: 16000 }],
    blocksMovement: true, movementCostMultiplier: 2 }
  scene.entityLayers['private-hazard'] = scene.entityLayers.item
  return scene
}

describe('aggregate broad-phase spatial index', () => {
  it('indexes complete path and footprint envelopes across every intersected cell', () => {
    const scene = fixture(), index = buildAggregateSpatialIndex(scene, { audience: 'gm', cellSizeMm: 2000 })
    const candidates = queryAggregateSpatialIndex(index, scene, { floorId: 'blank-floor', boundsMm: { x: 8800, y: 9600, width: 300, height: 800 } })
    expect(candidates).toContainEqual(expect.objectContaining({ entity: { kind: 'path', id: 'long-route' }, role: 'route' }))
    expect(candidates).toContainEqual(expect.objectContaining({ entity: { kind: 'floor', id: 'blank-floor' }, role: 'surface' }))
    expect(candidates.every(candidate => candidate.floorId === 'blank-floor')).toBe(true)
  })

  it('finds old and proposed new bounds while keeping candidate results separate from exact geometry decisions', () => {
    const scene = fixture(), index = buildAggregateSpatialIndex(scene, { audience: 'gm', cellSizeMm: 2000 })
    const change = queryAggregateSpatialChange(index, scene, { floorId: 'blank-floor',
      previousBoundsMm: { x: 3900, y: 3900, width: 200, height: 200 }, nextBoundsMm: { x: 17900, y: 17900, width: 200, height: 200 }, marginMm: 200 })
    expect(change.previous).toContainEqual(expect.objectContaining({ entity: { kind: 'prop', id: 'item' }, role: 'footprint' }))
    expect(change.next.some(candidate => candidate.entity.kind === 'path')).toBe(false)
    expect(change.next.some(candidate => candidate.entity.kind === 'floor')).toBe(true)
    expect(change.affected).toContainEqual({ kind: 'prop', id: 'item' })
  })

  it('filters private geometry before building a player index and does not expose a GM content hash', () => {
    const scene = fixture(), withoutSecret = cloneJson(scene)
    delete withoutSecret.regions['private-hazard']; delete withoutSecret.entityLayers['private-hazard']
    const playerIndex = buildAggregateSpatialIndex(scene, { audience: 'player', cellSizeMm: 2000 })
    const cleanPlayerIndex = buildAggregateSpatialIndex(withoutSecret, { audience: 'player', cellSizeMm: 2000 })
    expect(playerIndex.sourceHash).toBe(cleanPlayerIndex.sourceHash)
    const candidates = queryAggregateSpatialIndex(playerIndex, scene, { floorId: 'blank-floor', boundsMm: { x: 14000, y: 14000, width: 2000, height: 2000 } })
    expect(candidates.some(candidate => candidate.entity.kind === 'region' && candidate.entity.id === 'private-hazard')).toBe(false)
    expect(candidates.some(candidate => candidate.entity.kind === 'floor')).toBe(true)
  })

  it('rejects forged and stale indexes, including when only private source data changed', () => {
    const scene = fixture(), index = buildAggregateSpatialIndex(scene, { audience: 'player', cellSizeMm: 2000 })
    const query = { floorId: 'blank-floor', boundsMm: { x: 1000, y: 1000, width: 1000, height: 1000 } }
    expect(() => queryAggregateSpatialIndex({ ...index }, scene, query)).toThrow(/私有身份/)
    const changed = cloneJson(scene)
    changed.regions['private-hazard'].boundaryMm[0].x += 1
    expect(() => queryAggregateSpatialIndex(index, changed, query)).toThrow(/已过期/)
  })

  it('uses a floor-scan fallback for very large indexed or query bounds', () => {
    const scene = fixture(), index = buildAggregateSpatialIndex(scene, { audience: 'gm', cellSizeMm: 100 })
    const result = queryAggregateSpatialIndex(index, scene, { floorId: 'blank-floor', boundsMm: { x: 0, y: 0, width: 20000, height: 20000 } })
    expect(result.some(candidate => candidate.entity.kind === 'floor')).toBe(true)
    expect(result.some(candidate => candidate.entity.kind === 'path' && candidate.entity.id === 'long-route')).toBe(true)
  })

  it('falls back for unsafe grid addresses and refuses nonfinite inflated bounds', () => {
    const scene = fixture(), index = buildAggregateSpatialIndex(scene, { audience: 'gm', cellSizeMm: 1 })
    const unsafe = { floorId: 'blank-floor', boundsMm: { x: Number.MAX_SAFE_INTEGER, y: 0, width: 1, height: 0 } }
    expect(queryAggregateSpatialIndex(index, scene, unsafe)).toEqual([])
    expect(() => queryAggregateSpatialIndex(index, scene, {
      floorId: 'blank-floor', boundsMm: { x: 0, y: 0, width: 1, height: 1 }, marginMm: Number.MAX_VALUE,
    })).toThrow(/扩张后的范围必须有限/)
  })

  it('captures an independent frozen snapshot while public queries still reject a changed source', () => {
    const scene = fixture(), options = { audience: 'gm' as const, cellSizeMm: 2000 }
    const snapshot = createAggregateSpatialSnapshot(scene, options)
    const query = { floorId: 'blank-floor', boundsMm: { x: 3900, y: 3900, width: 200, height: 200 } }
    const expected = queryAggregateSpatialIndex(snapshot.index, scene, query)
    expect(snapshot.query(query)).toEqual(expected)
    expect(Object.isFrozen(snapshot)).toBe(true)
    expect(Object.isFrozen(snapshot.index)).toBe(true)
    expect(Object.isFrozen(snapshot.query(query)[0].boundsMm)).toBe(true)
    expect(Object.isFrozen(scene)).toBe(false)
    scene.props.item.positionMm.x = 18000
    options.cellSizeMm = 1
    expect(snapshot.query(query)).toEqual(expected)
    expect(snapshot.queryChange({ floorId: query.floorId, previousBoundsMm: query.boundsMm,
      nextBoundsMm: { x: 17900, y: 17900, width: 200, height: 200 } }).previous).toEqual(expected)
    expect(() => queryAggregateSpatialIndex(snapshot.index, scene, query)).toThrow(/已过期/)
    expect(() => (snapshot.query as unknown as (query: unknown, source: unknown) => unknown)(query, scene)).toThrow(/不接受新的场景或证明/)
    let reads = 0
    const accessorQuery = Object.defineProperty({}, 'floorId', { enumerable: true, get() { reads++; return 'blank-floor' } })
    expect(() => snapshot.query(accessorQuery as typeof query)).toThrow(/非JSON/)
    expect(reads).toBe(0)
  })

  it('keeps fractional derived bounds and the player filter in stable snapshot queries', () => {
    const scene = fixture()
    scene.props.item.rotationDeg = 37
    const snapshot = createAggregateSpatialSnapshot(scene, { audience: 'player', cellSizeMm: 2000 })
    const boundsMm = { x: 3000, y: 3000, width: 2000, height: 2000 }
    const visual = snapshot.query({ floorId: 'blank-floor', boundsMm, roles: ['visual'] }).find(candidate => candidate.entity.id === 'item')
    expect(visual).toBeDefined()
    expect([visual!.boundsMm.x, visual!.boundsMm.y, visual!.boundsMm.width, visual!.boundsMm.height].some(value => !Number.isInteger(value))).toBe(true)
    expect(snapshot.query({ floorId: 'blank-floor', boundsMm: { x: 14000, y: 14000, width: 2000, height: 2000 } })
      .some(candidate => candidate.entity.id === 'private-hazard')).toBe(false)
  })

  it('derives only requested entities with the same complete envelopes as a validated snapshot', () => {
    const scene = workspaceFixture({ building: true }).project.document
    scene.paths['long-route'] = cloneJson(fixture().paths['long-route'])
    scene.entityLayers['long-route'] = scene.entityLayers.item
    scene.openings.door = { id: 'door', floorId: 'blank-floor', editLocked: false,
      wallId: 'wall-0', offsetReferenceVertexId: 'vertex-0', offsetMm: 1000, widthMm: 1000,
      kind: 'door', state: 'open', locked: false, secret: false, revealed: false }
    scene.entityLayers.door = scene.entityLayers.item
    const refs: AggregateSpatialEntityRef[] = [{ kind: 'floor', id: 'blank-floor' }, { kind: 'wall', id: 'wall-0' },
      { kind: 'opening', id: 'door' }, { kind: 'path', id: 'long-route' }, { kind: 'prop', id: 'item' }]
    const snapshot = createAggregateSpatialSnapshot(scene, { audience: 'gm' })
    const expected = snapshot.query({ floorId: 'blank-floor', boundsMm: scene.floors['blank-floor'].boundsMm })
      .filter(row => refs.some(ref => ref.kind === row.entity.kind && ref.id === row.entity.id))
    const targeted = deriveAggregateEntityEnvelopes(scene, [...refs, refs[1]])
    expect(targeted).toEqual(expected)
    expect(targeted.find(row => row.entity.id === 'long-route')?.boundsMm).toEqual({ x: 600, y: 9600, width: 18800, height: 800 })
    expect(targeted.some(row => row.entity.kind === 'vertex' || row.entity.kind === 'room')).toBe(false)
    expect(Object.isFrozen(targeted)).toBe(true)
    expect(targeted.every(row => Object.isFrozen(row) && Object.isFrozen(row.entity) && Object.isFrozen(row.boundsMm))).toBe(true)
    expect(Object.isFrozen(scene.floors['blank-floor'].boundsMm)).toBe(false)
    for (const vertex of Object.values(scene.vertices)) vertex.xMm += 500
    const changed = deriveAggregateEntityEnvelopes(scene, [{ kind: 'wall', id: 'wall-0' }, { kind: 'opening', id: 'door' }])
    for (const row of changed) {
      const old = targeted.find(previous => previous.entity.kind === row.entity.kind && previous.entity.id === row.entity.id)!
      expect(row.boundsMm).toEqual({ ...old.boundsMm, x: old.boundsMm.x + 500 })
    }
    expect(targeted.find(row => row.entity.id === 'wall-0')?.boundsMm.x).toBe(2900)
  })

  it('reads a terrain edge parent without returning it and keeps targeted player geometry private', () => {
    const scene = fixture()
    scene.terrainAreas.ground = { id: 'ground', floorId: 'blank-floor', editLocked: false, visibility: 'public',
      boundaryMm: [{ x: 10000, y: 2000 }, { x: 14000, y: 2000 }, { x: 14000, y: 6000 }, { x: 10000, y: 6000 }]
        .map((positionMm, i) => ({ id: `ground-${i}`, segmentId: `ground-segment-${i}`, positionMm })),
      groundElevationMm: 0, coveragePriority: 1, surfaceStyle: null, blocksMovement: false, blocksSight: false, movementCostMultiplier: 1 }
    scene.terrainEdges.edge = { id: 'edge', floorId: 'blank-floor', editLocked: false, visibility: 'public',
      source: { areaId: 'ground', segmentId: 'ground-segment-0' }, neighborAreaId: null, kind: 'materialTransition', shoreline: false,
      blocksMovement: false, blocksSight: false, surfaceStyle: null, styleOverride: { strokeWidthMm: 20, color: '#334455', bandWidthMm: 200 } }
    scene.entityLayers.ground = scene.entityLayers.item; scene.entityLayers.edge = scene.entityLayers.item
    const refs: AggregateSpatialEntityRef[] = [{ kind: 'terrainEdge', id: 'edge' }, { kind: 'region', id: 'private-hazard' }]
    const all = createAggregateSpatialSnapshot(scene, { audience: 'gm' }).query({ floorId: 'blank-floor', boundsMm: scene.floors['blank-floor'].boundsMm })
    expect(deriveAggregateEntityEnvelopes(scene, refs)).toEqual(all.filter(row => refs.some(ref => ref.kind === row.entity.kind && ref.id === row.entity.id)))
    expect(deriveAggregateEntityEnvelopes(scene, refs, 'player')).toEqual([{ entity: { kind: 'terrainEdge', id: 'edge' },
      floorId: 'blank-floor', role: 'visual', boundsMm: { x: 9900, y: 1900, width: 4200, height: 200 } }])
    scene.terrainAreas.ground.visibility = 'gm'
    expect(deriveAggregateEntityEnvelopes(scene, refs, 'player')).toEqual([])
    expect(deriveAggregateEntityEnvelopes(scene, [{ kind: 'prop', id: 'missing' }, { kind: 'vertex', id: 'missing' },
      { kind: 'note', id: 'missing' }, { kind: 'prefabInstance', id: 'missing' }, { kind: 'scatterGroup', id: 'missing' }])).toEqual([])
  })

  it('includes actual diagonal wall joins beyond the old half-thickness AABB, including nonblocking walls', () => {
    const scene = workspaceFixture({ building: true }).project.document
    scene.vertices['vertex-2'].xMm = 7000
    scene.vertices['vertex-2'].yMm = 9000
    scene.walls['wall-0'].thicknessMm = 400
    scene.walls['wall-1'].thicknessMm = 400
    scene.walls['wall-1'].blocksMovement = false
    const envelope = deriveAggregateEntityEnvelopes(scene, [{ kind: 'wall', id: 'wall-0' }])[0]
    expect(envelope.entity).toEqual({ kind: 'wall', id: 'wall-0' })
    expect(envelope.boundsMm.x + envelope.boundsMm.width).toBeGreaterThan(10200)
    const snapshot = createAggregateSpatialSnapshot(scene, { audience: 'gm' })
    expect(snapshot.query({ floorId: 'blank-floor', boundsMm: { x: 10250, y: 2750, width: 100, height: 100 } }))
      .toContainEqual(envelope)
    expect(snapshot.query({ floorId: 'blank-floor', boundsMm: scene.floors['blank-floor'].boundsMm })
      .find(row => row.entity.kind === 'wall' && row.entity.id === 'wall-0')).toEqual(envelope)
  })

  it('does not let a player-hidden adjacent wall change the public wall envelope', () => {
    const withSecret = workspaceFixture({ building: true }).project.document
    const secretPoints = [{ xMm: 1000, yMm: 3000 }, { xMm: 1000, yMm: 1000 }, { xMm: 3000, yMm: 1000 }]
    const ring = ['vertex-0', ...secretPoints.map((_, i) => `secret-vertex-${i}`)]
    secretPoints.forEach((point, i) => {
      const id = ring[i + 1]
      withSecret.vertices[id] = { id, floorId: 'blank-floor', editLocked: false, ...point }
      withSecret.entityLayers[id] = withSecret.entityLayers.item
    })
    ring.forEach((id, i) => {
      const wallId = `secret-wall-${i}`
      withSecret.walls[wallId] = { id: wallId, floorId: 'blank-floor', editLocked: false,
        startVertexId: id, endVertexId: ring[(i + 1) % ring.length], thicknessMm: 900, blocksMovement: true, blocksSight: true, topStyle: null }
      withSecret.entityLayers[wallId] = withSecret.entityLayers.item
    })
    withSecret.rooms['secret-room'] = { id: 'secret-room', floorId: 'blank-floor', editLocked: false,
      boundaryVertexIds: ring, purpose: 'secret boundary', visibility: 'gm', accessExpectation: 'unspecified',
      supportRef: { kind: 'floor', id: 'blank-floor' }, groundElevationMm: 0, floorStyle: null }
    withSecret.entityLayers['secret-room'] = withSecret.entityLayers.item
    const withoutSecret = cloneJson(withSecret)
    for (const id of ring.slice(1)) { delete withoutSecret.vertices[id]; delete withoutSecret.entityLayers[id] }
    for (let i = 0; i < ring.length; i++) { delete withoutSecret.walls[`secret-wall-${i}`]; delete withoutSecret.entityLayers[`secret-wall-${i}`] }
    delete withoutSecret.rooms['secret-room']; delete withoutSecret.entityLayers['secret-room']
    const refs = [{ kind: 'wall', id: 'wall-0' }] as const
    expect(deriveAggregateEntityEnvelopes(withSecret, refs, 'player')).toEqual(deriveAggregateEntityEnvelopes(withoutSecret, refs, 'player'))
    expect(deriveAggregateEntityEnvelopes(withSecret, refs, 'gm')).not.toEqual(deriveAggregateEntityEnvelopes(withoutSecret, refs, 'gm'))
    const hidden = createAggregateSpatialSnapshot(withSecret, { audience: 'player' })
    const clean = createAggregateSpatialSnapshot(withoutSecret, { audience: 'player' })
    expect(hidden.index.sourceHash).toBe(clean.index.sourceHash)
    const query = { floorId: 'blank-floor', boundsMm: withSecret.floors['blank-floor'].boundsMm }
    expect(hidden.query(query)).toEqual(clean.query(query))
  })
})
