import polygonClipping, { type Polygon, type Ring } from 'polygon-clipping'
import { describe, expect, it } from 'vitest'
import type { PointMm } from '../../../shared/model/scene.js'
import type { ProjectedVisualBoundary } from '../../../shared/projection/types.js'
import type { VisualBoundary, VisualEdgeLook } from '../../../shared/visual/types.js'
import { sampleVisualBoundary } from '../../../shared/visual/geometry.js'
import { cliffReliefV3 } from './cliff-relief-v3.js'
import { CLIFF_RELIEF_V4_LIMITS, cliffReliefV4 } from './cliff-relief-v4.js'

const look: VisualEdgeLook = { id: 'rock', floorId: 'floor', layerId: 'layer', editLocked: false, visibility: 'public', boundaryId: 'cliff',
  kind: 'cliff', side: 'right', widthMm: 1800, color: '#736855', accentColor: '#D9CBAA', opacity: .95, intensity: 1,
  repeatMm: 320, seed: 'directional-rock-4', enabled: true }
const rect = (x: number, y: number, width: number, height: number): PointMm[] => [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }]
function boundary(points = [{ x: 0, y: 0 }, { x: 24000, y: 0 }], closed = false, spacing = 1000): ProjectedVisualBoundary {
  const source: VisualBoundary = { id: 'cliff', floorId: 'floor', layerId: 'layer', editLocked: false, visibility: 'public', closed,
    sampleSpacingMm: spacing, toleranceMm: 20, binding: { kind: 'decoration' }, segments: points.slice(0, closed ? undefined : -1).map((start, index) => {
      const end = points[(index + 1) % points.length]
      return { id: `curve-${index}`, start, control1: start, control2: end, end }
    }) }
  return { id: source.id, terrainAreaIds: ['public-support'], ...sampleVisualBoundary(source) }
}
const ring = (points: readonly PointMm[]): Ring => points.map(point => [point.x, point.y])
const area = (polygon: Polygon) => polygon.reduce((sum, points, index) => sum + (index ? -1 : 1) * Math.abs(points.reduce((total, p, i) => {
  const next = points[(i + 1) % points.length]; return total + p[0] * next[1] - next[0] * p[1]
}, 0) / 2), 0)

describe('independent directional cliff relief 4', () => {
  it('keeps existing face, openings and v3 output while putting directional depth into the main face', () => {
    const source = boundary(), before = structuredClone({ source, look }), old = cliffReliefV3(source, look, 1)
    const next = cliffReliefV4(source, look, 1, { lightDirectionDeg: 90 })
    expect(next).toEqual(cliffReliefV4(source, look, 1, { lightDirectionDeg: 90 }))
    expect(next.faceRings).toEqual(old.faceRings); expect(next.outer).toEqual(old.outer)
    expect(next.shadeCells.length).toBeGreaterThan(10)
    expect(next.shadeCells.every(cell => cell.facing > .99)).toBe(true)
    expect(next.shadeCells[0].stops[1].shade).toBeGreaterThan(next.shadeCells[0].stops[3].shade)
    const backlit = cliffReliefV4(source, look, 1, { lightDirectionDeg: 270 })
    expect(backlit.shadeCells[0].stops[2].shade).toBeLessThan(next.shadeCells[0].stops[2].shade * .82)
    expect(backlit.faceRings).toEqual(next.faceRings)
    expect({ source, look }).toEqual(before); expect(cliffReliefV3(source, look, 1)).toEqual(old)
    const renamed = { ...source, id: 'private-id', terrainAreaIds: ['secret-id'] }
    expect(cliffReliefV4(renamed, { ...look, id: 'another-id' }, 1, { lightDirectionDeg: 90 })).toEqual(next)
  })

  it.each([1, -1])('retains the exact face/opening clip for overlapping paint footprints on side %i', side => {
    const source = boundary(rect(0, 0, 10000, 7000), true), opening = rect(4200, -2400, 1800, 5000)
    const next = cliffReliefV4(source, look, side, { lightDirectionDeg: 135, openingPolygons: [opening] })
    let face: polygonClipping.MultiPolygon = []
    for (const points of next.faceRings) face = face.length ? polygonClipping.xor(face, [ring(points)]) : [[ring(points)]]
    for (const cell of next.shadeCells) {
      // Footprints are deliberately larger than the face; visible paint is
      // their intersection with the unchanged exact Canvas even-odd clip.
      const visible = polygonClipping.intersection(cell.rings.map(ring), face)
      expect(polygonClipping.difference(visible, face).reduce((sum, polygon) => sum + area(polygon), 0)).toBeLessThan(.001)
      expect(polygonClipping.intersection(visible, [ring(opening)]).reduce((sum, polygon) => sum + area(polygon), 0)).toBeLessThan(.001)
      expect(cell.stops.every(stop => Number.isFinite(stop.shade) && stop.opacity >= 0 && stop.opacity <= 1)).toBe(true)
    }
    expect(cliffReliefV4(boundary(), look, side, { lightDirectionDeg: 135, openingPolygons: [rect(-3000, -5000, 30000, 10000)] }).shadeCells).toEqual([])
    expect(next.baseOpacity).toBeGreaterThanOrEqual(.5)
    expect(next.shadeCells.every(cell => Math.hypot(cell.featherToMm.x - cell.featherFromMm.x, cell.featherToMm.y - cell.featherFromMm.y) > 0)).toBe(true)
  })

  it('overlaps adjacent arc footprints while keeping an uninterrupted base face at closed corners', () => {
    const next = cliffReliefV4(boundary(rect(0, 0, 12000, 8000), true), look, 1, { lightDirectionDeg: 135 })
    for (let index = 1; index < next.shadeCells.length; index++) {
      const a = next.shadeCells[index - 1], b = next.shadeCells[index]
      expect(polygonClipping.intersection(a.rings.map(ring), b.rings.map(ring)).reduce((sum, polygon) => sum + area(polygon), 0)).toBeGreaterThan(1)
    }
  })

  it('bounds long-map paint plans and rejects invalid light direction without changing inputs', () => {
    const next = cliffReliefV4(boundary([{ x: 0, y: 0 }, { x: 250000, y: 0 }], false, 20000), look, 1, { lightDirectionDeg: 45 })
    expect(next.shadeCells.length).toBeLessThanOrEqual(CLIFF_RELIEF_V4_LIMITS.cells)
    expect(next.shadeCells.flatMap(cell => cell.rings.flat()).length).toBeLessThan(CLIFF_RELIEF_V4_LIMITS.outputPoints)
    expect(next.shadeCells.flatMap(cell => cell.rings.flat()).every(point => Number.isFinite(point.x) && Number.isFinite(point.y))).toBe(true)
    expect(cliffReliefV4(boundary(), { ...look, widthMm: 0 }, 1, { lightDirectionDeg: 90 }).shadeCells).toEqual([])
    expect(() => cliffReliefV4(boundary(), look, 1, { lightDirectionDeg: Infinity })).toThrow('有限环境光方向')
  })
})
