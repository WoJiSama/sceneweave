import { describe, expect, it } from 'vitest'
import type { MultiPolygon } from 'polygon-clipping'
import { createTerrainReliefFrame, reliefContains, type ReliefGeometry, type ReliefTop, type ReliefWall } from './terrain-relief-frame.js'

const rect = (x: number, y: number, w: number, h: number): MultiPolygon => [[[[x, y], [x + w, y], [x + w, y + h], [x, y + h]]]]
const top = (id: string, z: number, regions: MultiPolygon): ReliefTop => ({ id, z, regions })
const south: ReliefWall = { a: [0, 6000], b: [6000, 6000], low: 0, high: 4000, highId: 'high', lowId: 'sea' }
const frame = createTerrainReliefFrame({ x: .16, y: -.58 })
const geometry: ReliefGeometry = { tops: [top('sea', 0, rect(-10000, -10000, 30000, 30000)), top('high', 4000, rect(0, 0, 6000, 6000))], walls: [south] }

describe('shared terrain relief observation and picking', () => {
  it.each([0, 2200, 4200, -3500])('round-trips known support at %imm without rounding world coordinates', z => {
    const point = { x: 1234.125, y: -981.8125 }, view = frame.project(point, z), restored = frame.inverseAtElevation(view, z)
    expect(restored.x).toBeCloseTo(point.x, 10); expect(restored.y).toBeCloseTo(point.y, 10)
  })
  it('captures observation values and rejects nonfinite directions', () => {
    const input = { x: 0, y: -1 }, captured = createTerrainReliefFrame(input); input.y = 9
    expect(captured.project({ x: 10, y: 20 }, 30)).toEqual({ x: 10, y: -10 })
    expect(() => createTerrainReliefFrame({ x: Infinity, y: 0 })).toThrow('有限')
  })
  it('picks the high top over a lower surface at the same image coordinate', () => {
    const hit = frame.pick(geometry, frame.project({ x: 3000, y: 3000 }, 4000))
    expect(hit).toEqual({ kind: 'top', sourceId: 'high', positionMm: { x: 3000, y: 3000 }, elevationMm: 4000, ground: true })
  })
  it('returns a nonplaceable wall instead of selecting the sea behind it', () => {
    const hit = frame.pick(geometry, frame.project({ x: 3000, y: 6000 }, 2000))!
    expect(hit.kind).toBe('wall'); expect(hit.sourceId).toBe('high'); expect(hit.ground).toBe(false)
    expect(hit.elevationMm).toBeCloseTo(2000, 9); expect(hit.positionMm.y).toBeCloseTo(6000, 9)
  })
  it('lets a crest belong to its top and rejects walls beyond their actual endpoints', () => {
    expect(frame.pick(geometry, frame.project({ x: 3000, y: 6000 }, 4000))?.kind).toBe('top')
    expect(frame.wallHit(south, frame.project({ x: 7000, y: 6000 }, 2000))).toBeNull()
    expect(frame.wallHit(south, frame.project({ x: 3000, y: 6000 }, 5000))).toBeNull()
  })
  it('preserves a depression hole and negative elevations', () => {
    const region = rect(0, 0, 10000, 10000); region[0].push(rect(3000, 3000, 4000, 4000)[0][0])
    const g = { tops: [top('rim', 0, region), top('hollow', -1200, rect(3000, 3000, 4000, 4000))], walls: [] }
    expect(frame.pick(g, frame.project({ x: 5000, y: 5000 }, -1200))?.sourceId).toBe('hollow')
    expect(reliefContains(region, { x: 5000, y: 5000 })).toBe(false)
    expect(reliefContains(region, { x: 3000, y: 5000 })).toBe(true)
    expect(reliefContains(region, { x: 3000, y: 5000 }, false)).toBe(false)
  })
  it('keeps a one-millimetre physical gap between two nearby tops', () => {
    const flat = createTerrainReliefFrame({ x: 0, y: 0 })
    const g = { tops: [top('a', 2200, rect(0, 0, 5000, 6000)), top('b', 2200, rect(5001, 0, 5000, 6000))], walls: [] }
    expect(flat.pick(g, { x: 5000.5, y: 3000 })).toBeNull()
    expect(flat.pick(g, { x: 4999.5, y: 3000 })?.sourceId).toBe('a')
  })
  it('does not intercept edge-on walls and uses wall feet in the fixed bounds', () => {
    const flat = createTerrainReliefFrame({ x: 0, y: 0 })
    expect(flat.wallHit(south, { x: 3000, y: 6000 })).toBeNull()
    expect(frame.projectedBounds({ tops: [geometry.tops[1]], walls: [south] })).toEqual({ x: 0, y: -2320, width: 6640, height: 8320 })
    expect(frame.projectedBounds({ tops: [], walls: [] })).toBeNull()
  })
  it('retains every source coordinate and face while resolving hits', () => {
    const before = JSON.stringify(geometry)
    frame.pick(geometry, { x: 3500, y: 5000 }); frame.projectedBounds(geometry)
    expect(JSON.stringify(geometry)).toBe(before)
  })
})
