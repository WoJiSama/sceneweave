import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PointMm } from '../../../shared/model/scene.js'
import { connectionArcFrame, connectionRouteSchema, sampleConnectionRoute } from '../../../shared/geometry/connection-route.js'
import { connectionBand, pointInPolygon } from '../../../shared/geometry/geometry.js'
import { drawTerracedRockSteps, planTerracedRockSteps, type TerracedRockStepInput } from './terraced-rock-steps.js'

const p = (x: number, y: number): PointMm => ({ x, y })
afterEach(() => vi.unstubAllGlobals())
function source(points = [p(0, 0), p(6000, 0)], widthMm = 1500): TerracedRockStepInput {
  return { frame: connectionArcFrame(points), bandMm: connectionBand(points, widthMm), widthMm,
    count: 20, riseMm: 2000, seed: 'independent-carved-climb' }
}
const inside = (input: TerracedRockStepInput) => {
  const plan = planTerracedRockSteps(input)
  for (const shape of plan.shapes) for (const ring of shape.ringsMm) for (const point of ring) {
    // Boolean construction snaps below 1e-6 mm; the exact Canvas band remains
    // the final paint clip. A boundary-distance check admits that stated error.
    const nearBoundary = plan.bandMm.some((a, i, all) => {
      const b = all[(i + 1) % all.length], dx = b.x - a.x, dy = b.y - a.y
      const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy)))
      return Math.hypot(point.x - a.x - dx * t, point.y - a.y - dy * t) < 1e-6
    })
    expect(pointInPolygon(point, plan.bandMm) || nearBoundary).toBe(true)
  }
  return plan
}
describe('continuous carved rock stairs', () => {
  it('uses the same oblique view for a northward rise and an eastward turn without changing the physical corridor', () => {
    const north = source([p(0, 6000), p(0, 0)]), east = source()
    const first = inside({ ...north, profile: 'naturalRockSteps8' })
    const turned = inside({ ...east, profile: 'naturalRockSteps8' })
    expect(first.bandMm).toEqual(north.bandMm)
    expect(turned.bandMm).toEqual(east.bandMm)
    expect(first.shapes.filter(s => s.kind === 'riser').length).toBeGreaterThanOrEqual(north.count)
    expect(turned.shapes.filter(s => s.kind === 'riser')).toHaveLength(0)
    expect(turned.shapes.filter(s => s.kind === 'side')).toHaveLength(east.count)
    expect(first.shapes.filter(s => s.kind === 'tread')).toHaveLength(north.count)
    expect(first.riserHeightMm * north.count).toBe(north.riseMm)
    expect(planTerracedRockSteps({ ...north, profile: 'naturalRockSteps8' })).toEqual(first)
    const tall = inside({ ...north, profile: 'naturalRockSteps8', riseMm: 3000 })
    const area = (plan: typeof first) => plan.shapes.filter(s => s.kind === 'riser').reduce((sum, s) => sum + Math.abs(s.ringsMm[0].reduce((a, p, i, ring) => {
      const q = ring[(i + 1) % ring.length]; return a + p.x * q.y - q.x * p.y
    }, 0)) / 2, 0)
    expect(area(tall)).toBeGreaterThan(area(first) * 1.4)
    expect(planTerracedRockSteps({ ...north, profile: 'naturalRockSteps8', lightDirectionDeg: 60 }).shapes)
      .not.toEqual(first.shapes)
    const route = { version: 1 as const, kind: 'polyline' as const, segments: [{ id: 'oblique-rise', start: p(0, 6000), control1: p(0, 6000), control2: p(0, 0), end: p(0, 0) }],
      sampleSpacingMm: 500, toleranceMm: 20, stairStyle: 'naturalRock' as const, treadDepthMm: 450, renderProfile: 'naturalRockSteps8' as const }
    expect(connectionRouteSchema.safeParse({ ...route, centerlineMm: sampleConnectionRoute(route) }).success).toBe(true)
  })
  it('selects worn continuous rock separately while retaining the physical band, rise and saved carving recipe', () => {
    const input = source(), carved = inside({ ...input, profile: 'naturalRockSteps6' })
    const worn = inside({ ...input, profile: 'naturalRockSteps7' })
    expect(worn.profile).toBe('naturalRockSteps7')
    expect(worn.bandMm).toEqual(carved.bandMm)
    expect(worn.stationsMm).toEqual(carved.stationsMm)
    expect(worn.riserHeightMm).toBe(carved.riserHeightMm)
    expect(worn.shapes).not.toEqual(carved.shapes)
    expect(worn.shapes.filter(s => s.kind === 'tread')).toHaveLength(input.count)
    expect(planTerracedRockSteps({ ...input, profile: 'naturalRockSteps6' })).toEqual(carved)
    const route = { version: 1 as const, kind: 'polyline' as const, segments: [{ id: 'worn-route', start: p(0, 0), control1: p(0, 0), control2: p(6000, 0), end: p(6000, 0) }],
      sampleSpacingMm: 500, toleranceMm: 20, stairStyle: 'naturalRock' as const, treadDepthMm: 600, renderProfile: 'naturalRockSteps7' as const }
    expect(connectionRouteSchema.safeParse({ ...route, centerlineMm: sampleConnectionRoute(route) }).success).toBe(true)
  })
  it('selects weathered carving explicitly while preserving the saved profile5 plan and the full physical route', () => {
    const input = source(), before = structuredClone(input.bandMm)
    const original = planTerracedRockSteps(input)
    expect(planTerracedRockSteps({ ...input, profile: 'naturalRockSteps5' })).toEqual(original)
    const carved = inside({ ...input, profile: 'naturalRockSteps6' })
    expect(carved.profile).toBe('naturalRockSteps6')
    expect(carved.bandMm).toEqual(original.bandMm)
    expect(carved.stationsMm).toEqual(original.stationsMm)
    expect(carved.riserHeightMm).toBe(original.riserHeightMm)
    expect(carved.shapes).not.toEqual(original.shapes)
    const treads = carved.shapes.filter(shape => shape.kind === 'tread')
    expect(treads).toHaveLength(input.count)
    expect(treads.every(shape => {
      const points = shape.ringsMm.flat()
      return Math.max(...points.map(p => p.y)) - Math.min(...points.map(p => p.y)) > input.widthMm * .82
    })).toBe(true)
    // Broken visible risers/lips are not full-width bars; the continuous
    // physical tread and support corridor still retain their original width.
    for (const shape of carved.shapes.filter(s => s.kind === 'riser' || s.kind === 'lip')) {
      const points = shape.ringsMm.flat()
      expect(Math.max(...points.map(p => p.y)) - Math.min(...points.map(p => p.y))).toBeLessThan(input.widthMm * .83)
    }
    expect(carved.shapes.some(shape => shape.kind === 'side')).toBe(true)
    expect(carved.shapes.filter(shape => shape.kind === 'side').length).toBeLessThan(input.count)
    expect(planTerracedRockSteps({ ...input, profile: 'naturalRockSteps6', seed: 'another-weathered-rock' }).shapes).not.toEqual(carved.shapes)
    expect(input.bandMm).toEqual(before)
  })

  it('keeps curved weathered steps inside the original complete band and admits profile6 through the strict route schema', () => {
    const source = { version: 1 as const, kind: 'cubic' as const, segments: [
      { id: 'weathered-climb-curve', start: p(1000, 7000), control1: p(1000, 3000), control2: p(4000, 1000), end: p(8000, 1000) },
    ], sampleSpacingMm: 180, toleranceMm: 8, stairStyle: 'naturalRock' as const, treadDepthMm: 360, renderProfile: 'naturalRockSteps6' as const }
    const points = sampleConnectionRoute(source)
    expect(connectionRouteSchema.parse({ ...source, centerlineMm: points }).renderProfile).toBe('naturalRockSteps6')
    const input: TerracedRockStepInput = { frame: connectionArcFrame(points), bandMm: connectionBand(points, 1500), widthMm: 1500,
      count: 29, riseMm: 2000, seed: 'independent-carved-climb-863', profile: 'naturalRockSteps6' }
    const plan = inside(input)
    expect(plan.shapes.filter(s => s.kind === 'tread').length).toBeGreaterThanOrEqual(input.count)
    expect(plan).toEqual(planTerracedRockSteps(input))
    expect(planTerracedRockSteps({ ...input, riseMm: 4000 }).shapes.filter(s => s.kind === 'riser'))
      .not.toEqual(plan.shapes.filter(s => s.kind === 'riser'))
  })

  it('uses real rise for risers and continuous full-width treads, with open landings', () => {
    const input = source(), before = structuredClone(input.bandMm), plan = inside(input)
    expect(plan).toEqual(planTerracedRockSteps(input))
    expect(plan.riserHeightMm).toBe(100)
    expect(plan.stationsMm).toHaveLength(20)
    expect(plan.stationsMm[0]).toBe(plan.landingDepthMm)
    expect(plan.shapes.filter(s => s.kind === 'landing')).toHaveLength(2)
    expect(plan.shapes.filter(s => s.kind === 'tread')).toHaveLength(20)
    for (const tread of plan.shapes.filter(s => s.kind === 'tread')) {
      const points = tread.ringsMm.flat()
      expect(Math.max(...points.map(p => p.y)) - Math.min(...points.map(p => p.y))).toBe(input.widthMm)
    }
    expect(planTerracedRockSteps({ ...input, riseMm: 4000 }).shapes.filter(s => s.kind === 'riser'))
      .not.toEqual(plan.shapes.filter(s => s.kind === 'riser'))
    expect(input.bandMm).toEqual(before)
    plan.bandMm[0].x += 1
    expect(input.bandMm).toEqual(before)
  })

  it('turns around an independent cubic climb and retains the exact real band', () => {
    const source = { version: 1 as const, kind: 'cubic' as const, segments: [
      { id: 'independent-west-climb', start: p(1000, 7000), control1: p(1000, 3000), control2: p(4000, 1000), end: p(8000, 1000) },
    ], sampleSpacingMm: 180, toleranceMm: 8, stairStyle: 'naturalRock' as const, treadDepthMm: 280, renderProfile: 'naturalRockSteps5' as const }
    const points = sampleConnectionRoute(source)
    expect(connectionRouteSchema.parse({ ...source, centerlineMm: points }).renderProfile).toBe('naturalRockSteps5')
    const input = { frame: connectionArcFrame(points), bandMm: connectionBand(points, 1200), widthMm: 1200, count: 30, riseMm: 3200, seed: 'independent-curved-climb' }
    const plan = inside(input)
    expect(plan.bandMm).toEqual(input.bandMm)
    const treads = plan.shapes.filter(s => s.kind === 'tread')
    expect(treads.length).toBeGreaterThanOrEqual(30)
    const vectors = treads.map(s => ({ x: s.toMm.x - s.fromMm.x, y: s.toMm.y - s.fromMm.y }))
    expect(vectors[0].y).toBeLessThan(-100)
    expect(vectors.at(-1)!.x).toBeGreaterThan(100)
    expect(plan.stationsMm.every((station, i, all) => i === 0 || station > all[i - 1])).toBe(true)
    const reversed = inside({ ...input, frame: connectionArcFrame([...points].reverse()) })
    reversed.stationsMm.forEach((value, i) => expect(value).toBeCloseTo(plan.stationsMm[i], 8))
  })

  it('does not restart tread phase at a collinear source split or leave the supplied band', () => {
    const first = planTerracedRockSteps(source())
    const split = planTerracedRockSteps(source([p(0, 0), p(1400, 0), p(6000, 0)]))
    expect(split.stationsMm).toEqual(first.stationsMm)
    const input = source()
    input.bandMm = [p(1000, -380), p(5100, -380), p(5100, 520), p(1000, 520)]
    inside(input)
  })

  it('rejects invalid rise and world geometry before any draw operation', () => {
    for (const invalid of [{ riseMm: 0 }, { riseMm: -20 }, { riseMm: NaN }, { count: 513 }, { widthMm: Infinity }, { seed: '' },
      { lightDirectionDeg: Infinity }, { bandMm: [p(0, 0), p(1, 0), p(2, 0)] }, { frame: { length: 6000, at: () => p(NaN, 0) } }]) {
      expect(() => planTerracedRockSteps({ ...source(), ...invalid })).toThrow()
    }
    expect(() => planTerracedRockSteps({ ...source(), profile: 'unknown' as 'naturalRockSteps6' })).toThrow()
  })

  it('clips all paint to the exact band and restores the context after a failed draw', () => {
    class Path { moveTo = vi.fn(); lineTo = vi.fn(); closePath = vi.fn() }
    vi.stubGlobal('Path2D', Path)
    const palette = { base: '#A4A391', dark: '#58635C', light: '#D9CEAC' }
    const calls: string[] = []
    const target = { save: () => calls.push('save'), clip: () => calls.push('clip'),
      createLinearGradient: () => ({ addColorStop: vi.fn() }),
      fill: (_path: Path2D, rule: string) => { calls.push(`fill:${rule}`); throw new Error('device failed') },
      restore: () => calls.push('restore') } as unknown as CanvasRenderingContext2D
    expect(() => drawTerracedRockSteps(target, { ...source(), riseMm: 0, palette })).toThrow()
    expect(calls).toEqual([])
    expect(() => drawTerracedRockSteps(target, { ...source(), palette })).toThrow('device failed')
    expect(calls).toEqual(['save', 'clip', 'fill:evenodd', 'restore'])
  })
})
