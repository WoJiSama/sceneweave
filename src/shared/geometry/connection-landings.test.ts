import { describe, expect, it } from 'vitest'
import type { ProjectedConnection } from '../projection/types.js'
import { connectionBand, pointInPolygon } from './geometry.js'
import { connectionLandingBlend, connectionLandingDepthMm } from './connection-landings.js'
import { connectionArcFrame, sampleConnectionRoute } from './connection-route.js'

const point = (x: number, y: number) => ({ x, y })

function routed(): ProjectedConnection {
  const source = { kind: 'cubic' as const, segments: [{ id: 'curve', start: point(0, 0), control1: point(0, 4000), control2: point(6000, 4000), end: point(6000, 0) }], sampleSpacingMm: 100, toleranceMm: 10 }
  return { id: 'connection', kind: 'stairs', start: point(0, 0), end: point(6000, 0), widthMm: 1200,
    fromElevationMm: 0, toElevationMm: 1800, blocksMovement: false, style: null, surfaceIds: ['low', 'high'],
    route: { centerlineMm: sampleConnectionRoute(source), stairStyle: 'stone', treadDepthMm: 250 } }
}

describe('connection landing blend geometry', () => {
  it('binds independent source and destination surfaces and fades inward at both ends', () => {
    const connection = routed(), frame = connectionArcFrame(connection.route!.centerlineMm)
    const start = connectionLandingBlend(connection, 'start')!, end = connectionLandingBlend(connection, 'end')!
    expect(start.surfaceId).toBe('low')
    expect(end.surfaceId).toBe('high')
    expect(start.fromMm).toEqual(frame.at(0))
    expect(start.toMm).toEqual(frame.at(start.depthMm))
    expect(end.fromMm).toEqual(frame.at(frame.length))
    expect(end.toMm.x).toBeCloseTo(frame.at(frame.length - end.depthMm).x, 9)
    expect(end.toMm.y).toBeCloseTo(frame.at(frame.length - end.depthMm).y, 9)
    expect(start.depthMm).toBe(864)
    expect(end.depthMm).toBe(864)
    expect(start.polygonMm.length).toBeGreaterThanOrEqual(4)
  })

  it('uses each curved route endpoint tangent instead of the endpoint chord', () => {
    const connection = routed(), frame = connectionArcFrame(connection.route!.centerlineMm)
    const start = connectionLandingBlend(connection, 'start')!, end = connectionLandingBlend(connection, 'end')!
    expect(start.toMm.y).toBeGreaterThan(start.fromMm.y)
    expect(end.toMm.y).toBeGreaterThan(end.fromMm.y)
    expect(Math.abs(start.toMm.x - start.fromMm.x)).toBeLessThan(150)
    expect(end.toMm.x).toBeLessThan(end.fromMm.x)
    expect(frame.length).toBeGreaterThan(connection.end.x - connection.start.x)
  })

  it('scales a landing with connection width while keeping both fades apart on short routes', () => {
    expect(connectionLandingDepthMm(1500, 5000)).toBe(1080)
    expect(connectionLandingDepthMm(600, 5000)).toBe(432)
    expect(connectionLandingDepthMm(1500, 1000)).toBe(320)
    expect(connectionLandingDepthMm(1500, 0)).toBe(0)
  })

  it('uses the width-based landing depth by default and rejects only an explicitly invalid override', () => {
    const connection = routed()
    expect(connectionLandingBlend(connection, 'start')?.depthMm).toBe(864)
    expect(connectionLandingBlend(connection, 'start', 0)).toBeNull()
    expect(connectionLandingBlend(connection, 'start', 500)?.depthMm).toBe(500)
  })

  it('supports straight and ramp connections without persisting derived geometry', () => {
    const connection = routed(), before = structuredClone(connection)
    const straight: ProjectedConnection = { ...connection, kind: 'ramp', route: undefined }
    expect(connectionLandingBlend(straight, 'start')).toMatchObject({ surfaceId: 'low', fromMm: straight.start })
    expect(connectionLandingBlend({ ...straight, surfaceIds: undefined }, 'end')).toBeNull()
    expect(connection).toEqual(before)
  })

  it('retains every real end-landing bend with uneven route sampling and endpoint reversal', () => {
    const centerlineMm = [point(0, 0), point(4000, 0), point(4000, 300), point(4200, 300)]
    const connection: ProjectedConnection = { ...routed(), start: centerlineMm[0], end: centerlineMm.at(-1)!, widthMm: 120,
      route: { centerlineMm, stairStyle: 'stone', treadDepthMm: 250 } }
    const before = structuredClone(connection), landing = connectionLandingBlend(connection, 'end')!
    expect(landing.depthMm).toBe(360)
    expect(landing.toMm).toEqual(point(4000, 140))
    expect(landing.polygonMm).toEqual(connectionBand([point(4200, 300), point(4000, 300), point(4000, 140)], 120))
    expect(pointInPolygon(point(4070, 300), landing.polygonMm)).toBe(true)
    expect(pointInPolygon(point(4090, 212), landing.polygonMm)).toBe(false)
    const reversed: ProjectedConnection = { ...connection, start: connection.end, end: connection.start,
      fromElevationMm: connection.toElevationMm, toElevationMm: connection.fromElevationMm,
      surfaceIds: [connection.surfaceIds![1], connection.surfaceIds![0]],
      route: { ...connection.route!, centerlineMm: [...centerlineMm].reverse() } }
    expect(connectionLandingBlend(reversed, 'start')).toEqual(landing)
    expect(connection).toEqual(before)
  })

  it('clips a landing to its own arc-length section on a switchback and re-derives after route edits', () => {
    const source = { kind: 'polyline' as const, segments: [
      { id: 'a', start: point(0, 0), control1: point(0, 0), control2: point(500, 0), end: point(500, 0) },
      { id: 'b', start: point(500, 0), control1: point(500, 0), control2: point(500, 100), end: point(500, 100) },
      { id: 'c', start: point(500, 100), control1: point(500, 100), control2: point(100, 100), end: point(100, 100) },
    ], sampleSpacingMm: 100, toleranceMm: 10 }
    const route = { ...source, centerlineMm: sampleConnectionRoute(source) }
    const connection: ProjectedConnection = { id: 'switchback', kind: 'stairs', start: point(0, 0), end: point(100, 100), widthMm: 80,
      fromElevationMm: 0, toElevationMm: 1000, blocksMovement: false, style: null, surfaceIds: ['low', 'high'],
      route: { ...route, stairStyle: 'stone', treadDepthMm: 100 } }
    const before = structuredClone(connection), landing = connectionLandingBlend(connection, 'start')!
    expect(pointInPolygon(point(350, 100), connectionBand(connection.route!.centerlineMm, connection.widthMm))).toBe(true)
    expect(pointInPolygon(point(350, 100), landing.polygonMm)).toBe(false)
    const edited = structuredClone(connection)
    edited.route!.centerlineMm = edited.route!.centerlineMm.map(point => ({ x: point.x + 20, y: point.y }))
    const moved = connectionLandingBlend(edited, 'start')!
    expect(moved.fromMm.x).toBe(landing.fromMm.x + 20)
    expect(connection).toEqual(before)
  })
})
