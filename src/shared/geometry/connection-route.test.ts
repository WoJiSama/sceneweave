import { describe, expect, it } from 'vitest'
import { createRefinedBlankDocument } from '../../platform/browser/content/refined-blank.js'
import { emptyCompositionDocument } from '../terrain-generation/composition-materialize.js'
import type { PointMm, SceneDocument, TerrainConnection } from '../model/scene.js'
import { connectionArcFrame, connectionCenterline, connectionRouteSchema, sampleConnectionRoute, type ConnectionRoute } from './connection-route.js'
import { connectionFootprint, corridor, pointInPolygon, validateGeometry } from './geometry.js'
import { checkTerrainTravel, checkTerrainRoute, assertTerrainConnectionClearances } from './terrain-travel.js'
import { projectScene } from '../projection/projection.js'
import { selectionGeometry, hitTestAll } from '../../editor/native-canvas/selection.js'
import { visualBase } from '../visual/base.js'

const p = (x: number, y: number): PointMm => ({ x, y })
function route(kind: 'polyline' | 'cubic' = 'cubic', points = [p(6000, 10000), p(14000, 10000)]): ConnectionRoute {
  const segments = points.slice(1).map((end, i) => ({ id: `r-${i}`, start: points[i], end,
    control1: kind === 'cubic' ? p(6000, 2000) : points[i], control2: kind === 'cubic' ? p(14000, 2000) : end }))
  const source = { version: 1 as const, kind, segments, sampleSpacingMm: 800, toleranceMm: 20, stairStyle: 'stone' as const, treadDepthMm: 250 }
  return { ...source, centerlineMm: sampleConnectionRoute(source) }
}
function fixture(): SceneDocument {
  const base = createRefinedBlankDocument('island', { sceneId: 'curved-connection', title: 'Curved connection geometry', widthMm: 24000, heightMm: 18000, preset: 'narrative', now: '2026-10-31T00:00:00.000Z' })
  const scene = emptyCompositionDocument(base); scene.schemaVersion = 5
  scene.terrainAreas.high = { id: 'high', floorId: 'visual-floor', editLocked: false, visibility: 'public',
    boundaryMm: [p(10000, 0), p(24000, 0), p(24000, 18000), p(10000, 18000)].map((positionMm, i) => ({ id: `high-p${i}`, segmentId: `high-s${i}`, positionMm })),
    groundElevationMm: 1800, coveragePriority: 1, surfaceStyle: null, blocksMovement: false, blocksSight: false, movementCostMultiplier: 1 }
  scene.terrainConnections.stairs = { id: 'stairs', floorId: 'visual-floor', editLocked: false, visibility: 'public', kind: 'stairs',
    from: { surfaceRef: { kind: 'floor', id: 'visual-floor' }, positionMm: p(6000, 10000) }, to: { surfaceRef: { kind: 'terrainArea', id: 'high' }, positionMm: p(14000, 10000) },
    widthMm: 1000, openingId: null, blocksMovement: false, movementCostMultiplier: 1, surfaceStyle: null, route: route() }
  scene.entityLayers.high = 'visual-layer-ground'; scene.entityLayers.stairs = 'visual-layer-ground'
  return scene
}

describe('new fixed curved connection geometry and source', () => {
  it('retains complete deterministic integer samples and rejects stale samples, fake polylines and excessive treads', () => {
    const source = route()
    expect(connectionRouteSchema.parse(source)).toEqual(source)
    expect(source.centerlineMm).toEqual(sampleConnectionRoute(source))
    expect(source.centerlineMm.every(p => Number.isSafeInteger(p.x) && Number.isSafeInteger(p.y))).toBe(true)
    const stale = structuredClone(source); stale.centerlineMm[2].x++
    expect(connectionRouteSchema.safeParse(stale).success).toBe(false)
    expect(connectionRouteSchema.safeParse({ ...source, kind: 'polyline' }).success).toBe(false)
    const many = route('polyline', [p(1000, 1000), p(100000, 1000)]); many.treadDepthMm = 50
    expect(connectionRouteSchema.safeParse(many).success).toBe(false)
    expect(connectionRouteSchema.safeParse({ ...source, unchecked: true }).success).toBe(false)
  })
  it('keeps legacy endpoint bands exact and stations routed treads by full cumulative arc length', () => {
    const c = fixture().terrainConnections.stairs, source = c.route!, frame = connectionArcFrame(source.centerlineMm)
    const legacy: TerrainConnection = structuredClone(c); delete legacy.route
    expect(connectionFootprint(legacy)).toEqual(corridor(c.from.positionMm, c.to.positionMm, c.widthMm))
    expect(connectionCenterline(legacy)).toEqual([c.from.positionMm, c.to.positionMm])
    expect(frame.length).toBeGreaterThan(8000)
    expect(frame.at(frame.length / 2).y).toBeCloseTo(4000, -1)
    expect(frame.at(0)).toEqual(c.from.positionMm); expect(frame.at(frame.length)).toEqual(c.to.positionMm)
  })
  it('uses the curved full band for physical crossing, support and native selection rather than the endpoint chord', () => {
    const scene = fixture(), c = scene.terrainConnections.stairs, ring = connectionFootprint(c)
    expect(validateGeometry(scene).errors).toEqual([])
    expect(() => assertTerrainConnectionClearances(scene, [{ connectionId: c.id, minWidthMm: 1000, approachDepthMm: 300 }])).not.toThrow()
    expect(pointInPolygon(p(10000, 4000), ring)).toBe(true); expect(pointInPolygon(p(10000, 10000), ring)).toBe(false)
    expect(checkTerrainTravel(scene, { floorId: c.floorId, from: p(9000, 4000), to: p(11000, 4000), widthMm: 400 }).ok).toBe(true)
    expect(checkTerrainTravel(scene, { floorId: c.floorId, from: p(9000, 10000), to: p(11000, 10000), widthMm: 400 }).ok).toBe(false)
    expect(selectionGeometry(scene, c.id)).toEqual([ring])
    expect(hitTestAll(scene, p(10000, 4000), 0)).toContain(c.id); expect(hitTestAll(scene, p(10000, 10000), 0)).not.toContain(c.id)
    scene.regions.blocker = { id: 'blocker', floorId: c.floorId, editLocked: false, visibility: 'public', kind: 'hazard', blocksMovement: true, movementCostMultiplier: 1,
      boundaryMm: [p(9900, 3900), p(10100, 3900), p(10100, 4100), p(9900, 4100)] }; scene.entityLayers.blocker = 'visual-layer-ground'
    expect(validateGeometry(scene).errors.some(e => e.code === 'CONNECTION_OBSTACLE')).toBe(true)
  })
  it('rejects a stale endpoint, too-close switchback and repeated height transitions', () => {
    const mismatch = fixture(); mismatch.terrainConnections.stairs.from.positionMm.x++
    expect(validateGeometry(mismatch).errors.some(e => e.code === 'CONNECTION_ROUTE_ENDPOINT')).toBe(true)
    const narrow = fixture(), c = narrow.terrainConnections.stairs
    c.route = route('polyline', [p(6000, 10000), p(9000, 10000), p(9000, 4000), p(10000, 4000), p(10000, 9000), p(14000, 9000)]); c.to.positionMm = p(14000, 9000); c.widthMm = 1600
    expect(validateGeometry(narrow).errors.some(e => e.code === 'CONNECTION_WIDTH')).toBe(true)
    const repeated = fixture(), r = repeated.terrainConnections.stairs
    r.route = route('polyline', [p(6000, 10000), p(12000, 10000), p(12000, 6000), p(7000, 6000), p(7000, 3000), p(14000, 3000)]); r.to.positionMm = p(14000, 3000)
    const issues = validateGeometry(repeated).errors
    expect(issues.some(e => e.code === 'CONNECTION_TRANSITIONS'), JSON.stringify(issues)).toBe(true)
  })
  it('accepts a full-width U switchback with opposite parallel runs and only its actual height crossing', () => {
    const scene = fixture(), c = scene.terrainConnections.stairs
    scene.terrainAreas.high.boundaryMm.forEach((node, i) => { node.positionMm = [p(1000, 5000), p(23000, 5000), p(23000, 16000), p(1000, 16000)][i] })
    const points = [p(18000, 2000), p(4000, 2000), p(4000, 10000), p(18000, 10000)]
    c.from.positionMm = points[0]; c.to.positionMm = points.at(-1)!
    c.route = route('polyline', points)
    expect(validateGeometry(scene).errors).toEqual([])
    expect(() => assertTerrainConnectionClearances(scene, [{ connectionId: c.id, minWidthMm: 1000, approachDepthMm: 300 }])).not.toThrow()
    const travel = checkTerrainRoute(scene, { floorId: c.floorId, pointsMm: points, widthMm: 800 })
    expect(travel.ok, JSON.stringify(travel.issues)).toBe(true)
    expect(travel.lengthMm).toBe(36000); expect(travel.connectionIds).toContain(c.id)
    expect(checkTerrainTravel(scene, { floorId: c.floorId, from: points[0], to: points.at(-1)!, widthMm: 800 }).ok).toBe(false)
    const band = connectionFootprint(c)
    expect(pointInPolygon(p(4000, 5000), band)).toBe(true)
    expect(pointInPolygon(p(18000, 5000), band)).toBe(false)
    expect(hitTestAll(scene, p(11000, 2000), 0)).toContain(c.id)
    expect(hitTestAll(scene, p(11000, 10000), 0)).toContain(c.id)
    expect(hitTestAll(scene, p(11000, 6000), 0)).not.toContain(c.id)
  })
  it('projects only audience-filtered actual route parameters and requires masks for its complete curved extent', () => {
    const scene = fixture(), projected = projectScene(scene, 'gm').connections[0]
    expect(projected.route).toEqual({ centerlineMm: scene.terrainConnections.stairs.route!.centerlineMm, stairStyle: 'stone', treadDepthMm: 250 })
    expect(projected.route).not.toHaveProperty('segments')
    scene.terrainConnections.stairs.visibility = 'gm'
    scene.regions.mask = { id: 'mask', floorId: 'visual-floor', editLocked: false, visibility: 'gm', kind: 'manualMask', blocksMovement: false, movementCostMultiplier: 1,
      boundaryMm: [p(5000, 9000), p(15000, 9000), p(15000, 11000), p(5000, 11000)] }; scene.entityLayers.mask = 'visual-layer-ground'
    expect(() => projectScene(scene, 'player')).toThrow(/固定遮罩未覆盖/)
    scene.regions.mask.boundaryMm = [p(4000, 2000), p(16000, 2000), p(16000, 12000), p(4000, 12000)]
    expect(projectScene(scene, 'player').connections).toEqual([])
  })
  it('reserves route segment identities across real props, other routes and live visual control segments', () => {
    const prop = fixture(); prop.terrainConnections.stairs.route!.segments[0].id = 'real-prop'
    prop.props['real-prop'] = { id: 'real-prop', floorId: 'visual-floor', editLocked: false, visibility: 'public', definitionRef: null, appearance: { kind: 'symbol', symbol: 'table', tint: null, opacity: 1 },
      positionMm: p(1000, 1000), rotationDeg: 0, visualBoundsMm: { x: -100, y: -100, width: 200, height: 200 }, footprintMm: { width: 200, height: 200 }, footprintOffsetMm: p(0, 0), blocksMovement: false, blocksSight: false,
      supportRef: { kind: 'floor', id: 'visual-floor' }, renderLayer: 'object', renderOrder: 0, shadowClass: 'none', shadowOverride: null }; prop.entityLayers['real-prop'] = 'visual-layer-props'
    expect(validateGeometry(prop).errors.some(e => e.code === 'CONNECTION_ROUTE_ID' && e.entityId === 'real-prop')).toBe(true)
    const shared = fixture(); shared.terrainConnections.second = { ...structuredClone(shared.terrainConnections.stairs), id: 'second' }; shared.entityLayers.second = 'visual-layer-ground'
    expect(validateGeometry(shared).errors.some(e => e.code === 'CONNECTION_ROUTE_ID')).toBe(true)
    const visual = fixture(), segment = structuredClone(visual.terrainConnections.stairs.route!.segments[0])
    visualBase(visual)!.boundaries.decoration = { id: 'decoration', floorId: 'visual-floor', layerId: 'visual-layer-ground', visibility: 'public', editLocked: false, closed: false,
      segments: [segment], sampleSpacingMm: 800, toleranceMm: 20, binding: { kind: 'decoration' } }
    expect(validateGeometry(visual).errors.some(e => e.code === 'CONNECTION_ROUTE_ID' && e.entityId === segment.id)).toBe(true)
  })
})
