import { describe, expect, it } from 'vitest'
import { createRefinedBlankDocument } from '../../platform/browser/content/refined-blank.js'
import type { PointMm, SceneDocument, TerrainArea } from '../model/scene.js'
import { searchTerrainRoute, checkTerrainTravel, checkTerrainRoute } from './terrain-travel.js'
import { validateGeometry } from './geometry.js'

const blank = (): SceneDocument => createRefinedBlankDocument('coast', {
  title: 'T3 route fixture', widthMm: 24000, heightMm: 18000, preset: 'narrative', sceneId: 't3-route', now: '2026-10-26T00:00:00.000Z',
})

function withObstacle(): SceneDocument {
  const scene = blank()
  scene.props.obstacle = {
    id: 'obstacle', floorId: 'visual-floor', editLocked: false, definitionRef: null,
    appearance: { kind: 'symbol', symbol: 'table', tint: null, opacity: 1 },
    visualBoundsMm: { x: -2000, y: -2000, width: 4000, height: 4000 }, positionMm: { x: 12000, y: 9000 }, rotationDeg: 0,
    footprintMm: { width: 4000, height: 4000 }, footprintOffsetMm: { x: 0, y: 0 }, blocksMovement: true, blocksSight: false,
    visibility: 'public', supportRef: { kind: 'floor', id: 'visual-floor' }, renderLayer: 'object', renderOrder: 0,
    shadowClass: 'none', shadowOverride: null,
  }
  scene.entityLayers.obstacle = 'visual-layer-ground'
  return scene
}
const rect = (x: number, y: number, width: number, height: number): PointMm[] => [
  { x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height },
]
function area(id: string, points: PointMm[], elevationMm = 0, priority = 1): TerrainArea {
  return { id, floorId: 'visual-floor', editLocked: false, visibility: 'public',
    boundaryMm: points.map((positionMm, i) => ({ id: id + '-p' + i, segmentId: id + '-s' + i, positionMm })),
    groundElevationMm: elevationMm, coveragePriority: priority, surfaceStyle: null, blocksMovement: false, blocksSight: false, movementCostMultiplier: 1 }
}
function rampScene(): SceneDocument {
  const scene = blank()
  scene.terrainAreas.high = area('high', rect(10000, 0, 14000, 18000), 1800)
  scene.terrainConnections.ramp = { id: 'ramp', floorId: 'visual-floor', editLocked: false, visibility: 'public', kind: 'ramp',
    from: { surfaceRef: { kind: 'floor', id: 'visual-floor' }, positionMm: { x: 8500, y: 8820 } },
    to: { surfaceRef: { kind: 'terrainArea', id: 'high' }, positionMm: { x: 11500, y: 8820 } }, widthMm: 1400,
    openingId: null, blocksMovement: false, movementCostMultiplier: 1.4, surfaceStyle: null }
  return scene
}
function region(scene: SceneDocument, id: string, boundaryMm: PointMm[], blocksMovement: boolean, cost = 1) {
  scene.regions[id] = { id, floorId: 'visual-floor', editLocked: false, visibility: 'public', kind: 'hazard', boundaryMm, blocksMovement, movementCostMultiplier: cost }
}

describe('bounded deterministic terrain route search', () => {
  it('returns a straight full-width route when the complete checker accepts it', () => {
    const scene = blank(), request = { floorId: 'visual-floor', from: { x: 2000, y: 9000 }, to: { x: 22000, y: 9000 }, widthMm: 1000, gridMm: 2000 }
    const result = searchTerrainRoute(scene, request)
    expect(result).toMatchObject({ ok: true, status: 'found' })
    expect(result.expandedNodes).toBeGreaterThan(0)
    expect(result.points).toEqual([request.from, request.to])
    expect(checkTerrainTravel(scene, { floorId: request.floorId, from: request.from, to: request.to, widthMm: request.widthMm }).ok).toBe(true)
  })

  it('routes around a real rotated footprint and verifies every retained segment', () => {
    const scene = withObstacle(), request = { floorId: 'visual-floor', from: { x: 2000, y: 9000 }, to: { x: 22000, y: 9000 }, widthMm: 1000, gridMm: 2000 }
    scene.props.obstacle.rotationDeg = 30
    expect(checkTerrainTravel(scene, request).ok).toBe(false)
    const first = searchTerrainRoute(scene, request), second = searchTerrainRoute(scene, request)
    expect(first).toEqual(second)
    expect(first.ok).toBe(true)
    expect(first.points.length).toBeGreaterThan(2)
    expect(checkTerrainRoute(scene, { floorId: request.floorId, pointsMm: first.points, widthMm: request.widthMm }).ok).toBe(true)
    for (let i = 1; i < first.points.length; i++) expect(checkTerrainTravel(scene, { floorId: request.floorId, from: first.points[i - 1], to: first.points[i], widthMm: request.widthMm }).ok).toBe(true)
  })

  it('rejects a real obstacle only inside the outer miter while both straight legs pass', () => {
    const scene = blank(), pointsMm = [{ x: 4000, y: 8000 }, { x: 8000, y: 8000 }, { x: 8000, y: 12000 }]
    region(scene, 'outer-corner', rect(8250, 7250, 500, 500), true)
    for (let i = 1; i < pointsMm.length; i++) expect(checkTerrainTravel(scene, { floorId: 'visual-floor', from: pointsMm[i - 1], to: pointsMm[i], widthMm: 2000 }).ok).toBe(true)
    expect(checkTerrainRoute(scene, { floorId: 'visual-floor', pointsMm, widthMm: 2000 })).toMatchObject({ ok: false, issues: [{ code: 'TERRAIN_TRAVEL_OBSTACLE', entityId: 'outer-corner' }] })
    delete scene.regions['outer-corner']
    expect(checkTerrainRoute(scene, { floorId: 'visual-floor', pointsMm, widthMm: 2000 }).ok).toBe(true)
  })

  it('checks square end caps and rejects self-crossing or oversized polylines', () => {
    const scene = blank(), floorId = 'visual-floor'
    expect(checkTerrainTravel(scene, { floorId, from: { x: 100, y: 4000 }, to: { x: 4000, y: 4000 }, widthMm: 1000 }).ok).toBe(true)
    expect(checkTerrainRoute(scene, { floorId, pointsMm: [{ x: 100, y: 4000 }, { x: 4000, y: 4000 }], widthMm: 1000 }).ok).toBe(false)
    expect(checkTerrainRoute(scene, { floorId, pointsMm: [{ x: 1000, y: 1000 }, { x: 5000, y: 5000 }, { x: 1000, y: 5000 }, { x: 5000, y: 1000 }], widthMm: 1000 }).issues[0].code).toBe('TERRAIN_ROUTE_SELF_OVERLAP')
    expect(checkTerrainRoute(scene, { floorId, pointsMm: Array.from({ length: 129 }, (_, i) => ({ x: 1000 + i, y: 4000 })), widthMm: 1000 }).issues[0].code).toBe('INVALID_TERRAIN_ROUTE')
  })

  it('uses the exact off-grid ramp anchors and refuses wider or blocked connections', () => {
    const scene = rampScene(), floorId = 'visual-floor', request = { floorId, from: { x: 3000, y: 13500 }, to: { x: 21000, y: 13500 }, widthMm: 1000, gridMm: 2000, maxNodes: 1024 }
    expect(validateGeometry(scene).errors).toEqual([])
    const found = searchTerrainRoute(scene, request)
    expect(found.ok).toBe(true)
    expect(found.connectionIds).toEqual(['ramp'])
    expect(checkTerrainRoute(scene, { floorId, pointsMm: found.points, widthMm: request.widthMm }).ok).toBe(true)
    const pointsMm = [{ x: 3000, y: 8820 }, { x: 21000, y: 8820 }]
    expect(checkTerrainRoute(scene, { floorId, pointsMm, widthMm: 1400 }).ok).toBe(true)
    expect(checkTerrainRoute(scene, { floorId, pointsMm, widthMm: 1401 }).issues.some(issue => issue.code === 'TERRAIN_HEIGHT_CONNECTION')).toBe(true)
    scene.terrainConnections.ramp.blocksMovement = true
    expect(checkTerrainRoute(scene, { floorId, pointsMm, widthMm: 1000 }).ok).toBe(false)
  })

  it('cannot cross blocking water until a full-width explicit walkable ford exists', () => {
    const scene = blank(), floorId = 'visual-floor', pointsMm = [{ x: 3000, y: 9000 }, { x: 21000, y: 9000 }]
    scene.terrainAreas.water = { ...area('water', rect(9000, 1000, 6000, 16000)), blocksMovement: true }
    expect(checkTerrainRoute(scene, { floorId, pointsMm, widthMm: 1000 }).issues.some(issue => issue.code === 'TERRAIN_NOT_WALKABLE')).toBe(true)
    scene.terrainAreas.ford = { ...area('ford', rect(9000, 8300, 6000, 1400), 0, 2), movementCostMultiplier: 1.5 }
    // Split water corners explicitly; the existing validator must stay strict.
    scene.terrainAreas.water = { ...area('water', [{ x: 9000, y: 1000 }, { x: 15000, y: 1000 }, { x: 15000, y: 8300 }, { x: 15000, y: 9700 }, { x: 15000, y: 17000 }, { x: 9000, y: 17000 }, { x: 9000, y: 9700 }, { x: 9000, y: 8300 }]), blocksMovement: true }
    expect(validateGeometry(scene).errors).toEqual([])
    const checked = checkTerrainRoute(scene, { floorId, pointsMm, widthMm: 1400 })
    expect(checked.ok).toBe(true)
    expect(checked.supportRefs).toContainEqual({ kind: 'terrainArea', id: 'ford' })
    expect(checked.movementCostMm).toBeGreaterThan(checked.lengthMm)
    expect(checkTerrainRoute(scene, { floorId, pointsMm, widthMm: 1401 }).ok).toBe(false)
  })

  it('integrates maximum real costs and chooses a longer cheaper route', () => {
    const scene = blank(), floorId = 'visual-floor', from = { x: 3000, y: 9000 }, to = { x: 21000, y: 9000 }
    region(scene, 'slow', rect(9000, 6000, 6000, 6000), false, 10)
    region(scene, 'overlap', rect(10000, 7000, 2000, 4000), false, 2)
    const direct = checkTerrainRoute(scene, { floorId, pointsMm: [from, to], widthMm: 1000 })
    expect(direct.ok).toBe(true)
    expect(direct.lengthMm).toBe(18000)
    expect(direct.movementCostMm).toBe(72000)
    const route = searchTerrainRoute(scene, { floorId, from, to, widthMm: 1000, gridMm: 2000, maxNodes: 2048 })
    expect(route.ok).toBe(true)
    expect(route.lengthMm).toBeGreaterThan(direct.lengthMm)
    expect(route.movementCostMm).toBeLessThan(direct.movementCostMm)
  })

  it('reports effective support over the entire band rather than only its centreline', () => {
    const scene = blank(), floorId = 'visual-floor', pointsMm = [{ x: 3000, y: 9000 }, { x: 21000, y: 9000 }]
    scene.terrainAreas.side = area('side', rect(9000, 9200, 6000, 1800))
    expect(validateGeometry(scene).errors).toEqual([])
    const checked = checkTerrainRoute(scene, { floorId, pointsMm, widthMm: 1000 })
    expect(checked.ok).toBe(true)
    expect(checked.supportRefs).toEqual([{ kind: 'floor', id: floorId }, { kind: 'terrainArea', id: 'side' }])
    expect(checked.lengthMm).toBe(18000)
    expect(checked.movementCostMm).toBe(18000)
  })

  it('reports a bounded search failure without claiming mathematical impossibility', () => {
    const scene = withObstacle(), result = searchTerrainRoute(scene, { floorId: 'visual-floor', from: { x: 2000, y: 9000 }, to: { x: 22000, y: 9000 }, widthMm: 1000, gridMm: 2000, maxNodes: 1 })
    expect(result.ok).toBe(false)
    expect(result.status).toBe('budget')
    expect(result.issues[0].code).toBe('TERRAIN_ROUTE_SEARCH_LIMIT')
    expect(result.issues[0].message).toContain('未宣称不存在')
  })

  it('does not return an adoptable route when its retained segment budget is exceeded', () => {
    const result = searchTerrainRoute(withObstacle(), { floorId: 'visual-floor', from: { x: 2000, y: 9000 }, to: { x: 22000, y: 9000 }, widthMm: 1000, gridMm: 2000, maxSegments: 1 })
    expect(result).toMatchObject({ ok: false, status: 'budget', points: [] })
    expect(result.issues[0].code).toBe('TERRAIN_ROUTE_SEGMENT_LIMIT')
  })

  it('rejects endpoints outside the floor before any geometry search', () => {
    const result = searchTerrainRoute(blank(), { floorId: 'visual-floor', from: { x: -1, y: 9000 }, to: { x: 22000, y: 9000 }, widthMm: 1000 })
    expect(result).toMatchObject({ ok: false, status: 'invalid', expandedNodes: 0, points: [] })
    expect(result.issues[0].code).toBe('INVALID_TERRAIN_ROUTE')
  })
})
