import { describe, expect, it } from 'vitest'
import polygonClipping, { type Ring } from 'polygon-clipping'
import { sampleVisualBoundary } from './geometry.js'
import type { PointMm } from '../model/scene.js'
import type { VisualEdgeLook } from './types.js'
import type { ProjectedVisualBoundary } from '../projection/types.js'
import { cliffRibbon, cliffRibbonPaints, joinCliffRibbonRuns } from './cliff-ribbon.js'

const p = (x: number, y: number): PointMm => ({ x, y })
const look: VisualEdgeLook = { id: 'arbitrary-edge', floorId: 'f', layerId: 'l', visibility: 'public', editLocked: false,
  boundaryId: 'arbitrary-boundary', kind: 'cliff', side: 'right', widthMm: 1100, color: '#728293', accentColor: '#d7c8a4',
  opacity: 1, intensity: 1, repeatMm: 400, seed: 'independent-coast', renderProfile: 'rockRelief5', enabled: true }
function boundary(id: string, points: PointMm[], closed = false): ProjectedVisualBoundary {
  return { id, terrainAreaIds: ['public-a'], ...sampleVisualBoundary({ closed, sampleSpacingMm: 1000, toleranceMm: 10,
    segments: points.slice(0, closed ? undefined : -1).map((start, i) => ({ id: `s-${i}`, start, end: points[(i + 1) % points.length], control1: start, control2: points[(i + 1) % points.length] })) }) }
}
const run = (id: string, points: PointMm[]) => ({ boundary: boundary(id, points), look: { ...look, id: `look-${id}`, boundaryId: id } })
const ring = (points: PointMm[]): Ring => [...points.map(p => [p.x, p.y] as [number, number]), [points[0].x, points[0].y]]
const area = (points: Ring) => Math.abs(points.reduce((s, a, i) => { const b = points[(i + 1) % points.length]; return s + a[0] * b[1] - b[0] * a[1] }, 0) / 2)
const filledArea = (polygons: ReturnType<typeof polygonClipping.union>) => polygons.reduce((sum, poly) => sum + poly.reduce((sum, r, i) => sum + (i ? -1 : 1) * area(r), 0), 0)

describe('continuous cliff ribbon', () => {
  it('shares feet across split records without moving or expanding their individual paint footprints', () => {
    const a = run('one', [p(0, 0), p(4000, 0)]), b = run('two', [p(4000, 0), p(6000, 2000)])
    const parts = cliffRibbonPaints([a, b], -1), first = parts.get(a.look.id)!, second = parts.get(b.look.id)!
    expect(first.cells.at(-1)!.foot[1]).toEqual(second.cells[0].foot[0])
    expect(first.cells).toHaveLength(a.boundary.points.length - 1)
    expect(second.cells).toHaveLength(b.boundary.points.length - 1)
    expect(first.cells.every(cell => a.boundary.points.some(p => p.x === cell.crest[0].x && p.y === cell.crest[0].y))).toBe(true)
    const joined = cliffRibbon(joinCliffRibbonRuns([a, b])[0].boundary, look, -1)
    const partition = polygonClipping.union(first.rings.map(ring), second.rings.map(ring))
    expect(filledArea(polygonClipping.xor(partition, joined.rings.map(ring)))).toBeLessThan(.01)
    // The caller retains its paint slots, including any intervening cover. No
    // original record is consumed in order to paint a whole chain early.
    expect([...parts.keys()]).toEqual([a.look.id, b.look.id])
    const isolated = cliffRibbonPaints([a, { ...b, look: { ...b.look, visibility: 'gm' } }], -1)
    expect(isolated.get(a.look.id)).toEqual(cliffRibbon(a.boundary, a.look, -1))
  })
  it('joins arbitrary exact endpoints in either input order, closes loops and preserves inputs', () => {
    const source = [run('c', [p(4000, 3000), p(0, 3000)]), run('a', [p(0, 0), p(4000, 0)]),
      run('d', [p(0, 3000), p(0, 0)]), run('b', [p(4000, 0), p(4000, 3000)])]
    const before = structuredClone(source), joined = joinCliffRibbonRuns(source)
    expect(joined).toHaveLength(1); expect(joined[0].boundary.closed).toBe(true)
    expect(joined[0].boundary.lengthMm).toBe(14000)
    const whole = boundary('one', [p(4000, 3000), p(0, 3000), p(0, 0), p(4000, 0)], true)
    expect(cliffRibbon(joined[0].boundary, look, -1)).toEqual(cliffRibbon(whole, look, -1))
    expect(source).toEqual(before)
  })
  it('does not connect branches, mismatched metadata/support, a reversed direction or a one-mm gap', () => {
    const a = run('a', [p(0, 0), p(4000, 0)]), b = run('b', [p(4000, 0), p(8000, 0)])
    for (const changed of [{ ...b, look: { ...b.look, color: '#ff0000' } }, { ...b, look: { ...b.look, layerId: 'other' } },
      { ...b, look: { ...b.look, seed: 'other' } }, { ...b, boundary: { ...b.boundary, terrainAreaIds: ['another-support'] } },
      run('gap', [p(4001, 0), p(8000, 0)]), run('reversed', [p(8000, 0), p(4000, 0)])]) {
      expect(joinCliffRibbonRuns([a, changed])).toHaveLength(2)
    }
    expect(joinCliffRibbonRuns([a, b, run('branch', [p(4000, 0), p(5000, 2000)])])).toHaveLength(3)
  })
  it.each([1, -1] as const)('keeps a concave / acute coast finite, continuous, within width and deterministic on side %s', side => {
    const source = boundary('independent', [p(0, 0), p(9000, 0), p(9000, 240), p(3600, 240), p(2900, 5200), p(0, 4700)], true)
    const result = cliffRibbon(source, look, side)
    expect(result).toEqual(cliffRibbon(source, look, side)); expect(result.rings.length).toBeGreaterThan(0)
    const distanceToSegment = (p: PointMm, a: PointMm, b: PointMm) => { const dx = b.x - a.x, dy = b.y - a.y,
      t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy))); return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy) }
    for (const point of result.rings.flat()) {
      expect(Number.isFinite(point.x) && Number.isFinite(point.y)).toBe(true)
      expect(Math.min(...source.points.map((a, i) => distanceToSegment(point, a, source.points[(i + 1) % source.points.length])))).toBeLessThanOrEqual(look.widthMm + .001)
    }
    // Every segment cell belongs to the real union, including at narrow concave
    // joins; an even-odd self-crossed offset ring would remove parts of a cell.
    const ordered = result.rings.map(ring).sort((a, b) => area(b) - area(a))
    for (const cell of result.cells) expect(filledArea(polygonClipping.difference([ring(cell.polygon)], ordered))).toBeLessThan(.01)
  })
  it('reads the near side deeper without changes to physical input and rejects bad budgets', () => {
    const north = boundary('north', [p(0, 0), p(8000, 0)]), south = boundary('south', [p(8000, 0), p(0, 0)])
    const upper = cliffRibbon(north, look, -1), lower = cliffRibbon(south, look, -1)
    expect(Math.min(...lower.cells.map(c => c.widthMm))).toBeGreaterThan(Math.max(...upper.cells.map(c => c.widthMm)) * 4)
    expect(cliffRibbon(north, { ...look, widthMm: 0 }, -1).rings).toEqual([])
    expect(() => cliffRibbon(north, { ...look, widthMm: Infinity }, -1)).toThrow(/有限/)
    expect(() => cliffRibbon({ points: Array.from({ length: 4097 }, (_, i) => p(i, 0)), closed: false }, look, -1)).toThrow(/预算/)
    expect(() => joinCliffRibbonRuns(Array.from({ length: 129 }, () => run('a', [p(0, 0), p(1000, 0)])))).toThrow(/预算/)
  })
})
