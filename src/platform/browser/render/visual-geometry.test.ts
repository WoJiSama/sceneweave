import { describe, expect, it } from 'vitest'
import { arcPoints, bandRings, lightVisibilityPolygon, offsetPolyline, pointAtArc, visualRandom } from './visual-geometry'

describe('deterministic visual geometry', () => {
  it('keeps continuous world arc length through corners and repeated points', () => {
    const points = arcPoints([{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 400 }])
    expect(points.map(p => p.distanceMm)).toEqual([0, 300, 700])
    expect(pointAtArc(points, 450)).toMatchObject({ x: 300, y: 150, distanceMm: 450, tangent: { x: 0, y: 1 } })
    expect(pointAtArc(points, 999)).toMatchObject({ x: 300, y: 400 })
  })
  it('joins both convex and concave boundary turns with finite bounded offsets', () => {
    const points = [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 1000 }, { x: 500, y: 500 }, { x: 0, y: 1000 }]
    for (const offset of [-100, 100]) {
      const result = offsetPolyline(points, offset, true)
      expect(result.every(p => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true)
      expect(result).toContainEqual({ x: offset, y: offset })
      expect(bandRings(points, 0, offset, true)).toHaveLength(2)
    }
    expect(bandRings(points, -100, 100, false)).toHaveLength(1)
  })
  it('bounds sharp miters and keeps deterministic counter seeds independent of call order', () => {
    const points = [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1, y: 1 }]
    const offset = offsetPolyline(points, 50)
    expect(offset.length).toBeGreaterThan(3)
    expect(Math.max(...offset.map(p => Math.abs(p.x)))).toBeLessThan(1100)
    const expected = Array.from({ length: 8 }, (_, i) => visualRandom('coast', i))
    expect(expected.every(v => v >= 0 && v < 1)).toBe(true)
    expect(expected[5]).toBe(visualRandom('coast', 5))
    expect(expected[5]).not.toBe(visualRandom('coast', 5, 1))
  })
  it('clips point light against walls while leaving a real doorway gap', () => {
    const origin = { x: 0, y: 0 }, wall = [
      { start: { x: 100, y: -300 }, end: { x: 100, y: -30 } },
      { start: { x: 100, y: 30 }, end: { x: 100, y: 300 } },
    ]
    const polygon = lightVisibilityPolygon(origin, 500, wall)
    expect(polygon.some(p => p.x > 490 && Math.abs(p.y) < 1)).toBe(true)
    expect(polygon.filter(p => p.y > 150 && p.y < 250 && p.x > 0).every(p => p.x <= 100.00001)).toBe(true)
    const solid = lightVisibilityPolygon(origin, 500, [{ start: { x: 100, y: -1000 }, end: { x: 100, y: 1000 } }])
    expect(solid.every(p => p.x <= 100.00001)).toBe(true)
    expect(lightVisibilityPolygon(origin, 500, [])).toHaveLength(128)
  })
})
