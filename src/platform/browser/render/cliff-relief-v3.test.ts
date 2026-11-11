import polygonClipping, { type Polygon, type Ring } from 'polygon-clipping'
import { describe, expect, it } from 'vitest'
import type { PointMm } from '../../../shared/model/scene.js'
import type { ProjectedVisualBoundary } from '../../../shared/projection/types.js'
import type { VisualBoundary, VisualEdgeLook } from '../../../shared/visual/types.js'
import { sampleVisualBoundary } from '../../../shared/visual/geometry.js'
import { cliffReliefV2 } from './cliff-relief-v2.js'
import { CLIFF_RELIEF_V3_LIMITS, CLIFF_RELIEF_V3_PROFILE, cliffReliefV3, type CliffReliefV3 } from './cliff-relief-v3.js'

const look: VisualEdgeLook = { id: 'ordinary-cliff', floorId: 'floor', layerId: 'layer', editLocked: false, visibility: 'public', boundaryId: 'boundary',
  kind: 'cliff', side: 'right', widthMm: 900, color: '#A89A7C', accentColor: '#E4D3AD', opacity: .94, intensity: .8,
  repeatMm: 300, seed: 'rock-relief-v3-fixture', enabled: true }
const rect = (x: number, y: number, width: number, height: number): PointMm[] => [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }]
function boundary(points = [{ x: 0, y: 0 }, { x: 24000, y: 0 }], closed = false, spacing = 180): ProjectedVisualBoundary {
  const source: VisualBoundary = { id: 'boundary', floorId: 'floor', layerId: 'layer', editLocked: false, visibility: 'public', closed,
    sampleSpacingMm: spacing, toleranceMm: 10, binding: { kind: 'decoration' }, segments: points.slice(0, closed ? undefined : -1).map((start, index) => {
      const end = points[(index + 1) % points.length]
      return { id: `curve-${index}`, start, control1: start, control2: end, end }
    }) }
  return { id: source.id, terrainAreaIds: ['visible-rock'], ...sampleVisualBoundary(source) }
}
const ring = (points: PointMm[]): Ring => [...points.map(p => [p.x, p.y] as [number, number]), [points[0].x, points[0].y]]
const area = (polygon: Polygon) => polygon.reduce((sum, points, index) => sum + (index ? -1 : 1) * Math.abs(points.reduce((total, p, i) => {
  const next = points[(i + 1) % points.length]; return total + p[0] * next[1] - next[0] * p[1]
}, 0) / 2), 0)
const strokes = (output: CliffReliefV3) => [...output.ledges, ...output.crestRuns, ...output.footRuns, ...output.fractures]
const allPoints = (output: CliffReliefV3) => [...output.faceRings.flat(), ...output.outer, ...output.facets.flatMap(facet => facet.polygon), ...strokes(output).flatMap(stroke => stroke.points), ...output.erosion.flatMap(mark => mark.polygon)]
const distance = (points: PointMm[]) => points.slice(1).reduce((sum, p, index) => sum + Math.hypot(p.x - points[index].x, p.y - points[index].y), 0)

describe('third-version subdued natural cliff paint', () => {
  it('keeps the exact joined face and old version output while returning isolated deterministic paint', () => {
    const source = boundary(), input = structuredClone({ source, look }), old = cliffReliefV2(source, look, 1)
    const first = cliffReliefV3(source, look, 1), second = cliffReliefV3(source, look, 1)
    expect(CLIFF_RELIEF_V3_PROFILE).toBe('rockRelief3'); expect(first.version).toBe(3)
    expect(first).toEqual(second); expect(first.faceRings).toEqual(old.faceRings); expect(first.outer).toEqual(old.outer)
    expect(first.facets.length).toBeGreaterThan(4)
    first.faceRings[0][0].x++; first.outer[0].y++; first.facets[0].normal.x++
    expect({ source, look }).toEqual(input); expect(cliffReliefV2(source, look, 1)).toEqual(old)
  })

  it('reduces painted facet mass and contrast, leaving separated crest/foot contacts instead of a new full border', () => {
    const source = boundary(), old = cliffReliefV2(source, look, 1), next = cliffReliefV3(source, look, 1)
    const mass = (facets: typeof old.facets) => facets.reduce((sum, facet) => sum + area([ring(facet.polygon)]) * facet.opacity, 0)
    const contrast = (facets: typeof old.facets) => facets.reduce((sum, facet) => sum + area([ring(facet.polygon)]) * facet.opacity * Math.abs(facet.shade - 1), 0)
    expect(mass(next.facets)).toBeLessThan(mass(old.facets) * .25)
    expect(contrast(next.facets)).toBeLessThan(contrast(old.facets) * .2)
    expect(next.facets.every(facet => facet.opacity <= .12 && Math.abs(facet.shade - 1) <= .04)).toBe(true)
    expect(next.baseOpacity).toBeLessThan(old.baseOpacity)
    for (const runs of [next.ledges, next.crestRuns, next.footRuns]) {
      expect(runs.length).toBeGreaterThan(1)
      expect(runs.reduce((sum, stroke) => sum + distance(stroke.points), 0)).toBeLessThan(source.lengthMm * .4)
      expect(runs.every(stroke => distance(stroke.points) < source.lengthMm / 6)).toBe(true)
    }
    expect(next.erosion.every(mark => mark.shade <= .075)).toBe(true)
  })

  it.each([1, -1])('keeps both winding directions on the actual side %i face with consistent signed normals', side => {
    for (const reversed of [false, true]) {
      const source = boundary(reversed ? [{ x: 24000, y: 0 }, { x: 0, y: 0 }] : undefined), output = cliffReliefV3(source, look, side)
      const direction = side * (reversed ? -1 : 1)
      expect(output.facets.length).toBeGreaterThan(0)
      for (const p of allPoints(output)) expect(p.y * direction).toBeGreaterThanOrEqual(-.001)
      for (const facet of output.facets) { expect(facet.normal.x).toBeCloseTo(0); expect(facet.normal.y).toBeCloseTo(direction) }
    }
  })

  it.each([1, -1])('clips all new polygon details into the joined convex/concave face on side %i', side => {
    const source = boundary([{ x: -3000, y: -3000 }, { x: 8000, y: -3000 }, { x: 8000, y: 2200 }, { x: 3200, y: 2200 }, { x: 3200, y: 6400 }, { x: -3000, y: 6400 }], true)
    const output = cliffReliefV3(source, look, side), old = cliffReliefV2(source, look, side)
    const originalFace: Polygon = [...old.faceRings].sort((a, b) => area([ring(b)]) - area([ring(a)])).map(ring)
    expect(output.faceRings).toEqual(old.faceRings)
    for (const points of [...output.facets.map(facet => facet.polygon), ...output.erosion.map(mark => mark.polygon)]) {
      expect(polygonClipping.difference([ring(points)], originalFace).reduce((sum, polygon) => sum + area(polygon), 0)).toBeLessThan(.001)
    }
    expect(allPoints(output).every(p => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true)
  })

  it('preserves real opening cuts and never connects two visible stroke pieces across a connection', () => {
    const source = boundary(), opening = rect(10400, -100, 2300, 1200)
    const output = cliffReliefV3(source, look, 1, { openingPolygons: [opening], dropMm: 2600 })
    expect(output.faceRings).toEqual(cliffReliefV2(source, look, 1, { openingPolygons: [opening], dropMm: 2600 }).faceRings)
    for (const points of [...output.facets.map(facet => facet.polygon), ...output.erosion.map(mark => mark.polygon)]) expect(polygonClipping.intersection([ring(points)], [ring(opening)]).reduce((sum, polygon) => sum + area(polygon), 0)).toBeLessThan(.001)
    for (const stroke of strokes(output)) for (let index = 1; index < stroke.points.length; index++) for (const t of [.25, .5, .75]) {
      const a = stroke.points[index - 1], b = stroke.points[index], x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t
      expect(x > 10400.001 && x < 12699.999 && y > -99.999 && y < 1099.999).toBe(false)
    }
    expect(cliffReliefV3(source, look, 1, { openingPolygons: [rect(-500, -500, 26000, 2000)] })).toMatchObject({ faceRings: [], facets: [], ledges: [], crestRuns: [], footRuns: [], fractures: [], erosion: [] })
  })

  it('uses supplied visible elevation only for finite fracture rhythm, without IDs or hidden scene inputs', () => {
    const source = boundary(), low = cliffReliefV3(source, look, 1, { dropMm: 800 }), high = cliffReliefV3(source, look, 1, { dropMm: 2600 })
    expect(high.faceRings).toEqual(low.faceRings); expect(high.outer).toEqual(low.outer)
    expect(high.fractures).not.toEqual(low.fractures)
    const renamed = { ...structuredClone(source), id: 'private-name', terrainAreaIds: ['another-private-name'] }
    expect(cliffReliefV3(renamed, { ...look, id: 'private-look', boundaryId: 'private-boundary' }, 1, { dropMm: 800 })).toEqual(low)
    expect(JSON.stringify(low)).not.toContain('visible-rock')
    expect(cliffReliefV3(source, { ...look, seed: 'different-stone' }, 1)).not.toEqual(low)
  })

  it('bounds dense repeats and rejects invalid normals, elevations, opening budgets and non-finite geometry before returning', () => {
    const source = boundary([{ x: 0, y: 0 }, { x: 250000, y: 0 }], false, 20000), output = cliffReliefV3(source, { ...look, repeatMm: 1 }, 1)
    expect(output.facets.length).toBeLessThanOrEqual(CLIFF_RELIEF_V3_LIMITS.facets)
    expect(strokes(output).length).toBeLessThanOrEqual(CLIFF_RELIEF_V3_LIMITS.strokes)
    expect(allPoints(output).length).toBeLessThanOrEqual(CLIFF_RELIEF_V3_LIMITS.outputPoints)
    expect(cliffReliefV3(boundary(), { ...look, widthMm: 0 }, 1)).toMatchObject({ faceRings: [], facets: [], crestRuns: [] })
    expect(() => cliffReliefV3(boundary(), look, 0)).toThrow(/第三版/)
    expect(() => cliffReliefV3(boundary(), look, 1, { dropMm: Infinity })).toThrow(/有限|高差/)
    expect(() => cliffReliefV3(boundary(), look, 1, { openingPolygons: Array.from({ length: 65 }, () => rect(0, 0, 100, 100)) })).toThrow(/预算/)
    const invalid = boundary(); invalid.samples[1].normal.x = NaN
    expect(() => cliffReliefV3(invalid, look, 1)).toThrow(/投影采样/)
    const wrongDistance = boundary(); wrongDistance.samples[1].distanceMm = 0
    expect(() => cliffReliefV3(wrongDistance, look, 1)).toThrow(/投影采样/)
  })
})
