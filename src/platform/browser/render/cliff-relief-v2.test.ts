import polygonClipping, { type Polygon, type Ring } from 'polygon-clipping'
import { describe, expect, it } from 'vitest'
import type { PointMm } from '../../../shared/model/scene.js'
import type { ProjectedVisualBoundary } from '../../../shared/projection/types.js'
import type { VisualBoundary, VisualEdgeLook } from '../../../shared/visual/types.js'
import { sampleVisualBoundary } from '../../../shared/visual/geometry.js'
import { cliffRelief } from './cliff-relief.js'
import { CLIFF_RELIEF_V2_LIMITS, cliffReliefV2, type CliffReliefV2 } from './cliff-relief-v2.js'

const look: VisualEdgeLook = { id: 'rock', floorId: 'floor', layerId: 'layer', editLocked: false, visibility: 'public', boundaryId: 'cliff',
  kind: 'cliff', side: 'right', widthMm: 900, color: '#A89A7C', accentColor: '#E4D3AD', opacity: .94, intensity: .8,
  repeatMm: 300, seed: 'rock-relief-v2-fixture', enabled: true }
const rect = (x: number, y: number, width: number, height: number): PointMm[] => [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }]
function boundary(points: PointMm[], closed = false, spacing = 180): ProjectedVisualBoundary {
  const source: VisualBoundary = { id: 'cliff', floorId: 'floor', layerId: 'layer', editLocked: false, visibility: 'public', closed,
    sampleSpacingMm: spacing, toleranceMm: 10, binding: { kind: 'decoration' },
    segments: points.slice(0, closed ? undefined : -1).map((start, i) => {
      const end = points[(i + 1) % points.length]
      return { id: `side-${i}`, start, control1: start, control2: end, end }
    }) }
  return { id: source.id, terrainAreaIds: ['public-support'], ...sampleVisualBoundary(source) }
}
const straight = () => boundary([{ x: 0, y: 0 }, { x: 24000, y: 0 }])
const ring = (points: PointMm[]): Ring => [...points.map(p => [p.x, p.y] as [number, number]), [points[0].x, points[0].y]]
const area = (polygon: Polygon): number => Math.abs(polygon.reduce((total, points, index) => total + (index ? -1 : 1) * Math.abs(points.reduce((sum, p, i) => {
  const next = points[(i + 1) % points.length]
  return sum + p[0] * next[1] - next[0] * p[1]
}, 0) / 2), 0))
function lines(output: CliffReliefV2) { return [...output.ledges, ...output.crestRuns, ...output.footRuns, ...output.fractures] }
function allPoints(output: CliffReliefV2): PointMm[] { return [...output.faceRings.flat(), ...output.outer, ...output.facets.flatMap(face => face.polygon), ...lines(output).flatMap(line => line.points), ...output.erosion.flatMap(mark => mark.polygon)] }
const distance = (points: PointMm[]) => points.slice(1).reduce((sum, p, index) => sum + Math.hypot(p.x - points[index].x, p.y - points[index].y), 0)

// Test membership independently through boolean area, rather than replaying the
// relief's point/arc formulas. Finite palette details must stay in the old face.
function expectPaintInsideOriginal(output: CliffReliefV2, original: ReturnType<typeof cliffRelief>) {
  const originalFace = [...original.faceRings].sort((a, b) => Math.abs(area([ring(b)])) - Math.abs(area([ring(a)]))).map(ring)
  for (const points of [...output.facets.map(face => face.polygon), ...output.erosion.map(mark => mark.polygon)]) {
    const outside = polygonClipping.difference([ring(points)], originalFace)
    expect(outside.reduce((sum, polygon) => sum + area(polygon), 0)).toBeLessThan(.001)
  }
}

describe('versioned broken cliff relief', () => {
  it('keeps the old joined envelope, inputs and algorithm intact while producing detached deterministic paint', () => {
    const source = straight(), before = structuredClone({ source, look }), old = cliffRelief(source, look, 1)
    const first = cliffReliefV2(source, look, 1), second = cliffReliefV2(source, look, 1)
    expect(first).toEqual(second)
    expect(first.version).toBe(2); expect(first.outer).toEqual(old.outer); expect(first.faceRings).toEqual(old.faceRings)
    expect(first.facets.length).toBeGreaterThan(8); expect(first.ledges.length).toBeGreaterThan(4)
    expect(first.crestRuns.length).toBeGreaterThan(4); expect(first.footRuns.length).toBeGreaterThan(4)
    expect(cliffRelief(source, look, 1)).toEqual(old)
    first.outer[0].x += 2; first.faceRings[0][0].x += 5
    expect({ source, look }).toEqual(before)
  })

  it('uses separated crest/foot ledges and broad staggered facets instead of complete concentric stripes', () => {
    const source = straight(), result = cliffReliefV2(source, look, 1)
    for (const runs of [result.crestRuns, result.footRuns, result.ledges]) {
      expect(runs.every(run => distance(run.points) < source.lengthMm / 5)).toBe(true)
      expect(runs.reduce((sum, run) => sum + distance(run.points), 0)).toBeLessThan(source.lengthMm * .9)
    }
    expect(new Set(result.facets.map(facet => Math.round(facet.shade * 100))).size).toBeGreaterThan(5)
    for (const point of allPoints(result)) { expect(point.x).toBeGreaterThanOrEqual(-.001); expect(point.x).toBeLessThanOrEqual(source.lengthMm + .001); expect(point.y).toBeGreaterThanOrEqual(-.001); expect(point.y).toBeLessThanOrEqual(look.widthMm + .001) }
    for (const stroke of lines(result)) { expect(stroke.widthMm).toBeGreaterThan(0); expect(stroke.opacity).toBeGreaterThan(0); expect(stroke.opacity).toBeLessThan(1); expect(stroke.color).toMatch(/^#[a-fA-F0-9]{6}$/) }
    expectPaintInsideOriginal(result, cliffRelief(source, look, 1))
  })

  it.each([1, -1])('keeps convex/concave closed corners inside the joined side %i face', side => {
    const source = boundary([{ x: 0, y: 0 }, { x: 8000, y: 0 }, { x: 8000, y: 2200 }, { x: 3200, y: 2200 }, { x: 3200, y: 6400 }, { x: 0, y: 6400 }], true)
    const result = cliffReliefV2(source, look, side)
    expect(result.faceRings).toHaveLength(2)
    expect(result.outer).toEqual(cliffRelief(source, look, side).outer)
    expect(allPoints(result).every(point => Number.isFinite(point.x) && Number.isFinite(point.y))).toBe(true)
    expectPaintInsideOriginal(result, cliffRelief(source, look, side))
  })

  it('splits a real connection band out of both polygon details and all continuous paint strokes', () => {
    const source = straight(), opening = rect(10400, -100, 2300, 1200)
    const result = cliffReliefV2(source, look, 1, { dropMm: 2600, openingPolygons: [opening] })
    expect(result.faceRings.length).toBeGreaterThan(1)
    const insideOpening = (p: PointMm) => p.x > 10400.001 && p.x < 12699.999 && p.y > -99.999 && p.y < 1099.999
    for (const stroke of lines(result)) for (let i = 1; i < stroke.points.length; i++) {
      const a = stroke.points[i - 1], b = stroke.points[i]
      for (const t of [.25, .5, .75]) expect(insideOpening({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })).toBe(false)
    }
    for (const points of [...result.facets.map(face => face.polygon), ...result.erosion.map(mark => mark.polygon)]) {
      const intersection = polygonClipping.intersection([ring(points)], [ring(opening)])
      expect(intersection.reduce((sum, polygon) => sum + area(polygon), 0)).toBeLessThan(.001)
    }
    expect(cliffReliefV2(source, look, 1, { openingPolygons: [rect(-500, -500, 26000, 2000)] })).toMatchObject({ faceRings: [], facets: [], ledges: [], crestRuns: [], footRuns: [] })
  })

  it('uses only supplied visible geometry, paint and optional real height, with no source IDs in the output', () => {
    const source = straight(), changedIds = { ...structuredClone(source), id: 'another-id', terrainAreaIds: ['hidden-source-name'] }
    expect(cliffReliefV2(source, look, 1)).toEqual(cliffReliefV2(changedIds, look, 1))
    expect(JSON.stringify(cliffReliefV2(changedIds, look, 1))).not.toContain('hidden-source-name')
    const low = cliffReliefV2(source, look, 1, { dropMm: 800 }), high = cliffReliefV2(source, look, 1, { dropMm: 2600 })
    expect(high.outer).toEqual(low.outer); expect(high.faceRings).toEqual(low.faceRings)
    expect(high.fractures).not.toEqual(low.fractures)
    expect(cliffReliefV2(source, { ...look, seed: 'new-cliff' }, 1)).not.toEqual(low)
  })

  it('bounds tiny repeats and rejects invalid, unbounded or over-budget paint inputs before publishing', () => {
    const source = boundary([{ x: 0, y: 0 }, { x: 250000, y: 0 }], false, 20000)
    const result = cliffReliefV2(source, { ...look, repeatMm: 1 }, 1)
    expect(result.facets.length).toBeLessThanOrEqual(CLIFF_RELIEF_V2_LIMITS.cells * 2)
    expect(allPoints(result).length).toBeLessThanOrEqual(CLIFF_RELIEF_V2_LIMITS.outputPoints)
    expect(cliffReliefV2(straight(), { ...look, widthMm: 0 }, 1)).toMatchObject({ faceRings: [], outer: [], facets: [] })
    expect(() => cliffReliefV2(straight(), look, 0)).toThrow(/有限投影/)
    expect(() => cliffReliefV2(straight(), look, 1, { dropMm: Infinity })).toThrow(/有限投影/)
    expect(() => cliffReliefV2(straight(), { ...look, repeatMm: 0 }, 1)).toThrow(/有限投影/)
    expect(() => cliffReliefV2(straight(), look, 1, { openingPolygons: Array.from({ length: 65 }, () => rect(100, 100, 100, 100)) })).toThrow(/预算/)
    expect(() => cliffReliefV2(straight(), look, 1, { openingPolygons: [[{ x: 0, y: 0 }, { x: Infinity, y: 0 }, { x: 0, y: 100 }]] })).toThrow(/无效轮廓/)
  })
})
