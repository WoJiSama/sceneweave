import { describe, expect, it } from 'vitest'
import type { ProjectedConnection } from '../../../shared/projection/types.js'
import { boundaryConnections, connectionFrame, connectionSideSegments, drawConnectionCheeks } from './connection-geometry'
import { connectionBand } from '../../../shared/geometry/geometry.js'
import { sampleConnectionRoute } from '../../../shared/geometry/connection-route.js'

const connection = (angle = 0): ProjectedConnection => ({ id: 'stairs', kind: 'stairs', start: { x: -2000 * Math.cos(angle), y: -2000 * Math.sin(angle) }, end: { x: 2000 * Math.cos(angle), y: 2000 * Math.sin(angle) }, widthMm: 1500, fromElevationMm: 800, toElevationMm: 2600, blocksMovement: false, style: null, surfaceIds: ['low', 'high'] })
describe('connection paint geometry preserves the real footprint', () => {
  it.each([false, true])('paints routed cliff cheeks without either landing end cap, reversed=%s', reversed => {
    const points = [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 2000, y: 0 }, { x: 2000, y: 2000 }]
    const c: ProjectedConnection = { ...connection(), start: points[0], end: points.at(-1)!, widthMm: 100,
      route: { centerlineMm: points, stairStyle: 'naturalRock', treadDepthMm: 250, renderProfile: 'naturalRockSteps2' } }
    if (reversed) {
      c.start = points.at(-1)!; c.end = points[0]
      ;[c.fromElevationMm, c.toElevationMm] = [c.toElevationMm, c.fromElevationMm]
      c.route!.centerlineMm = [...points].reverse()
    }
    const painted: { x: number; y: number }[][] = []
    const ctx = { save() {}, restore() {}, beginPath() { painted.push([]) },
      moveTo(x: number, y: number) { painted.at(-1)!.push({ x, y }) },
      lineTo(x: number, y: number) { painted.at(-1)!.push({ x, y }) }, stroke() {} }
    drawConnectionCheeks(ctx as unknown as CanvasRenderingContext2D, [c], '#32463B', 24, .5)
    expect(painted).toHaveLength(4)
    expect(painted.every(([a, b]) => !(a.x === 0 && b.x === 0) && !(a.y === 2000 && b.y === 2000))).toBe(true)
    expect(painted.flat()).toContainEqual({ x: 2050, y: -50 })
    expect(c.widthMm).toBe(100)
  })
  it('keeps side contacts on the exact bent corridor, excluding both end caps', () => {
    const points = [{x:0,y:0},{x:1000,y:0},{x:2000,y:0},{x:2000,y:2000}]
    const c = { ...connection(), start:points[0],end:points.at(-1)!,widthMm:100,
      route:{centerlineMm:points,stairStyle:'naturalRock' as const,treadDepthMm:250} }
    const sides = connectionSideSegments(c), ring = connectionBand(points,c.widthMm)
    expect(sides).toHaveLength(4)
    expect(sides.flat()).toContainEqual({x:2050,y:-50})
    expect(sides.every(([a,b]) => ring.some((p,i) => p.x===a.x && p.y===a.y && ring[(i+1)%ring.length].x===b.x && ring[(i+1)%ring.length].y===b.y))).toBe(true)
    expect(sides.every(([a,b]) => !(a.x===0&&b.x===0) && !(a.y===2000&&b.y===2000))).toBe(true)
  })
  it.each([0, Math.PI / 2, Math.PI / 4, 2.4])('keeps full width, perpendicular treads and identical uphill direction at angle %s', angle => {
    const c = connection(angle), frame = connectionFrame(c)
    expect(Math.hypot(frame.sides[0][0].x - frame.sides[1][0].x, frame.sides[0][0].y - frame.sides[1][0].y)).toBeCloseTo(1500)
    expect(frame.normal.x * frame.up.x + frame.normal.y * frame.up.y).toBeCloseTo(0)
    const reversed = connectionFrame({ ...c, start: c.end, end: c.start, fromElevationMm: c.toElevationMm, toElevationMm: c.fromElevationMm })
    expect(reversed.sides).toEqual(frame.sides)
    expect(reversed.at(600, 750)).toEqual(frame.at(600, 750))
    expect(c.widthMm).toBe(1500)
  })
  it('uses an actual diagonal crossing and preserves a blocked structural opening', () => {
    const c = connection(Math.PI / 4), line = [{ x: 0, y: -3000 }, { x: 0, y: 3000 }]
    expect(boundaryConnections([{ ...c, blocksMovement: true }], line, false, ['high'])).toHaveLength(1)
    expect(boundaryConnections([c], [...line].reverse(), false, ['low', 'high'])).toEqual([c])
  })
  it('does not open unrelated supports, a parallel boundary or an offset decorative face', () => {
    const c = connection()
    expect(boundaryConnections([c], [{ x: 0, y: -3000 }, { x: 0, y: 3000 }], false, ['other'])).toEqual([])
    expect(boundaryConnections([c], [{ x: -3000, y: 50 }, { x: 3000, y: 50 }], false, ['high'])).toEqual([])
    expect(boundaryConnections([c], [{ x: 2100, y: -3000 }, { x: 2100, y: 3000 }], false, ['high'])).toEqual([])
  })
  it('rejects a closed-ring tangency and detects a crossing at its closure seam', () => {
    const ring = [{ x: 0, y: -1000 }, { x: 3000, y: -1000 }, { x: 3000, y: 1000 }, { x: 0, y: 1000 }]
    expect(boundaryConnections([connection()], ring, true, ['high'])).toHaveLength(1)
    const tangent = { ...connection(), start: { x: -1000, y: 0 }, end: { x: 1000, y: 2000 } }
    expect(boundaryConnections([tangent], ring, true, ['high'])).toEqual([])
  })
  it('uses the saved curved crossing and cumulative uphill frame, never its endpoint chord or a tangent vertex', () => {
    const source = { kind: 'cubic' as const, segments: [{ id: 'curve', start: { x: -2000, y: 0 }, control1: { x: -2000, y: -4000 }, control2: { x: 2000, y: -4000 }, end: { x: 2000, y: 0 } }], sampleSpacingMm: 400, toleranceMm: 10 }
    const c: ProjectedConnection = { ...connection(), route: { centerlineMm: sampleConnectionRoute(source), stairStyle: 'naturalRock', treadDepthMm: 250 } }
    expect(boundaryConnections([c], [{ x: 0, y: -4000 }, { x: 0, y: -2000 }], false, ['high'])).toEqual([c])
    expect(boundaryConnections([c], [{ x: 0, y: -1000 }, { x: 0, y: 1000 }], false, ['high'])).toEqual([])
    expect(boundaryConnections([c], [{ x: -2500, y: -3000 }, { x: 2500, y: -3000 }], false, ['high'])).toEqual([])
    const frame = connectionFrame(c)
    expect(frame.length).toBeGreaterThan(4000)
    expect(frame.at(frame.length / 2).y).toBeCloseTo(-3000, -1)
    const reversed = connectionFrame({ ...c, start: c.end, end: c.start, fromElevationMm: c.toElevationMm, toElevationMm: c.fromElevationMm, route: { ...c.route!, centerlineMm: [...c.route!.centerlineMm].reverse() } })
    expect(reversed.sides).toEqual(frame.sides); expect(reversed.at(1000, 500)).toEqual(frame.at(1000, 500))
  })
})
