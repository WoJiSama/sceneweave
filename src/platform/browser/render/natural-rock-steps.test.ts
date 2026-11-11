import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PointMm } from '../../../shared/model/scene.js'
import { connectionArcFrame } from '../../../shared/geometry/connection-route.js'
import { connectionBand, pointInPolygon } from '../../../shared/geometry/geometry.js'
import { drawNaturalRockSteps, planNaturalRockSteps, type NaturalRockStepInput, type NaturalRockStepPlan } from './natural-rock-steps.js'

const p = (x: number, y: number): PointMm => ({ x, y })
const palette = { base: '#B6B094', dark: '#606D5E', light: '#E4D4A9' }
function input(points = [p(0, 0), p(6000, 0)], widthMm = 1200, count = 12): NaturalRockStepInput {
  return { frame: connectionArcFrame(points), bandMm: connectionBand(points, widthMm), widthMm, count, seed: 'fixed-natural-step-layout-2' }
}
const assertInside = (plan: NaturalRockStepPlan) => {
  expect(plan.shapes.length).toBeGreaterThan(0)
  for (const shape of plan.shapes) for (const ring of shape.ringsMm) for (const [index, point] of ring.entries()) {
    expect(pointInPolygon(point, plan.bandMm), `${shape.kind} point ${JSON.stringify(point)}`).toBe(true)
    const next = ring[(index + 1) % ring.length]
    expect(pointInPolygon(p((point.x + next.x) / 2, (point.y + next.y) / 2), plan.bandMm), `${shape.kind} edge`).toBe(true)
  }
}
const rounded = (value: unknown): unknown => JSON.parse(JSON.stringify(value, (_key, entry) => typeof entry === 'number' ? Math.round(entry * 1e6) / 1e6 : entry))

afterEach(() => vi.unstubAllGlobals())
describe('versioned natural rock step paint', () => {
  it('keeps world-deterministic split stones, short faces and complete detached input state', () => {
    const source = input(), bandBefore = structuredClone(source.bandMm), first = planNaturalRockSteps(source)
    expect(first).toEqual(planNaturalRockSteps(source))
    expect(first.profile).toBe('naturalRockSteps2')
    expect(first.stationsMm).toHaveLength(source.count)
    expect(first.stationsMm.every((station, index) => station > index * source.frame.length / source.count
      && station < (index + 1) * source.frame.length / source.count)).toBe(true)
    const stones = first.shapes.filter(shape => shape.kind === 'stone')
    expect(stones.length).toBeGreaterThanOrEqual(source.count * 2)
    expect(first.shapes.some(shape => shape.kind === 'chip')).toBe(true)
    expect(new Set(stones.map(stone => Math.round(Math.max(...stone.ringsMm[0].map(point => point.x)) - Math.min(...stone.ringsMm[0].map(point => point.x))))).size).toBeGreaterThan(4)
    // No straight horizontal bright/dark bar crosses the full route width.
    for (const shape of first.shapes) {
      const points = shape.ringsMm.flat(), width = Math.max(...points.map(point => point.y)) - Math.min(...points.map(point => point.y))
      expect(width).toBeLessThan(source.widthMm * .75)
    }
    assertInside(first)
    expect(source.bandMm).toEqual(bandBefore)
    first.bandMm[0].x += 10; first.shapes[0].ringsMm[0][0].x += 10
    expect(source.bandMm).toEqual(bandBefore)
    expect(planNaturalRockSteps({ ...source, seed: 'different-world-seed' })).not.toEqual(planNaturalRockSteps(source))
  })

  it('does not restart stationing when a collinear route gains a control point', () => {
    const straight = planNaturalRockSteps(input())
    const split = planNaturalRockSteps(input([p(0, 0), p(1800, 0), p(6000, 0)]))
    expect(split.stationsMm).toEqual(straight.stationsMm)
    expect(rounded(split)).toEqual(rounded(straight))
  })

  it.each([
    [p(1000, 1000), p(5000, 1000), p(5000, 6500)],
    [p(9000, 0), p(0, 0), p(0, 5000), p(9000, 5000)],
  ])('clips all marks to the full bent or switchback route instead of an endpoint chord', (...points) => {
    const plan = planNaturalRockSteps(input(points, 900, 32))
    assertInside(plan)
    expect(plan.stationsMm.every((value, index, values) => index === 0 || value > values[index - 1])).toBe(true)
    const reverse = planNaturalRockSteps(input([...points].reverse(), 900, 32))
    assertInside(reverse)
    expect(reverse.stationsMm).toEqual(plan.stationsMm)
    expect(reverse.shapes.filter(shape => shape.kind === 'stone').length).toBeGreaterThan(32)
  })

  it('uses the exact supplied band and never widens paint to fit generated stones', () => {
    const source = input()
    source.bandMm = [p(1500, -420), p(4500, -420), p(4500, 230), p(1500, 230)]
    const plan = planNaturalRockSteps(source)
    assertInside(plan)
    for (const point of plan.shapes.flatMap(shape => shape.ringsMm.flat())) {
      expect(point.x).toBeGreaterThanOrEqual(1500); expect(point.x).toBeLessThanOrEqual(4500)
      expect(point.y).toBeGreaterThanOrEqual(-420); expect(point.y).toBeLessThanOrEqual(230)
    }
  })

  it('bounds derivation to512 treads and rejects invalid work before touching the target', () => {
    const source = input([p(0, 0), p(60000, 0)], 1200, 512)
    const plan = planNaturalRockSteps(source)
    expect(plan.stationsMm).toHaveLength(512)
    expect(plan.shapes.length).toBeLessThanOrEqual(12288)
    const target = { save: vi.fn(), fill: vi.fn(), clip: vi.fn() } as unknown as CanvasRenderingContext2D
    for (const invalid of [{ count: 513 }, { count: .5 }, { widthMm: 0 }, { widthMm: NaN }, { seed: '' }, { bandMm: [p(0, 0)] },
      { bandMm: [p(0, 0), p(1, 0), p(2, 0)] }, { frame: { length: 6000, at: () => p(NaN, 0) } }]) {
      expect(() => drawNaturalRockSteps(target, { ...input(), ...invalid, palette })).toThrow()
    }
    expect(() => drawNaturalRockSteps(target, { ...input(), palette: { ...palette, base: 'transparent' } })).toThrow('RGB')
    expect(target.save).not.toHaveBeenCalled(); expect(target.fill).not.toHaveBeenCalled(); expect(target.clip).not.toHaveBeenCalled()
  })

  it('clips before filling, uses even-odd rings and restores the context on a paint failure', () => {
    class Path {
      moveTo = vi.fn(); lineTo = vi.fn(); closePath = vi.fn()
    }
    vi.stubGlobal('Path2D', Path)
    const calls: string[] = []
    const context = { save: () => calls.push('save'), clip: () => calls.push('clip'),
      fill: (_path: Path2D, rule: string) => { calls.push(`fill:${rule}`); throw new Error('device paint failed') }, restore: () => calls.push('restore') } as unknown as CanvasRenderingContext2D
    expect(() => drawNaturalRockSteps(context, { ...input(), palette })).toThrow('device paint failed')
    expect(calls).toEqual(['save', 'clip', 'fill:evenodd', 'restore'])
  })
})
