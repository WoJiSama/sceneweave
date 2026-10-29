import { describe, expect, it } from 'vitest'
import type { ProjectedConnection } from '../../../shared/projection/types.js'
import { boundaryConnections, connectionFrame } from './connection-geometry'

const connection = (angle = 0): ProjectedConnection => ({ id: 'stairs', kind: 'stairs', start: { x: -2000 * Math.cos(angle), y: -2000 * Math.sin(angle) }, end: { x: 2000 * Math.cos(angle), y: 2000 * Math.sin(angle) }, widthMm: 1500, fromElevationMm: 800, toElevationMm: 2600, blocksMovement: false, style: null, surfaceIds: ['low', 'high'] })
describe('connection paint geometry preserves the real footprint', () => {
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
})
