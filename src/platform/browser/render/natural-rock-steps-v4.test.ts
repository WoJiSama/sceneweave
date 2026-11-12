import { afterEach, describe, expect, it, vi } from 'vitest'
import polygonClipping, { type Polygon } from 'polygon-clipping'
import { connectionArcFrame } from '../../../shared/geometry/connection-route.js'
import { connectionBand } from '../../../shared/geometry/geometry.js'
import type { PointMm } from '../../../shared/model/scene.js'
import { planNaturalRockSteps, type NaturalRockStepInput } from './natural-rock-steps.js'
import { drawNaturalRockStepsV4, planNaturalRockStepsV4, type NaturalRockStepPlanV4 } from './natural-rock-steps-v4.js'

const p = (x: number, y: number): PointMm => ({ x, y })
const palette = { base: '#666D67', dark: '#303C36', light: '#9CA396' }
function input(points = [p(0, 0), p(12000, 0)], widthMm = 1600, count = 36): NaturalRockStepInput {
  return { frame: connectionArcFrame(points), bandMm: connectionBand(points, widthMm), widthMm, count, seed: 'natural-rock-v4-independent-seed' }
}
const polygon = (rings: PointMm[][]): Polygon => rings.map(ring => ring.map(point => [point.x, point.y]))
const rounded = (value: unknown) => JSON.parse(JSON.stringify(value, (_key, entry) => typeof entry === 'number' ? Math.round(entry * 1e6) / 1e6 : entry))
function assertClipped(plan: NaturalRockStepPlanV4) {
  expect(plan.shapes.length).toBeGreaterThan(0)
  const band = polygon([plan.bandMm])
  for (const shape of plan.shapes) {
    expect(polygonClipping.difference(polygon(shape.ringsMm), band), `${shape.kind} outside exact physical band`).toEqual([])
  }
}
afterEach(() => vi.unstubAllGlobals())

describe('independent natural rock step4 paint', () => {
  it('preserves original physical stations/count while varying one-to-three stone splits and irregular shoulders', () => {
    const source = input(), band = structuredClone(source.bandMm), legacy = planNaturalRockSteps(source)
    const plan = planNaturalRockStepsV4(source)
    expect(plan).toEqual(planNaturalRockStepsV4(source))
    expect(plan.profile).toBe('naturalRockSteps4')
    expect(plan.stationsMm).toEqual(legacy.stationsMm)
    expect(plan.stationsMm).toHaveLength(source.count)
    expect(new Set(plan.piecesPerStep)).toEqual(new Set([1, 2, 3]))
    expect(plan.piecesPerStep).toHaveLength(source.count)
    const stones = plan.shapes.filter(shape => shape.kind === 'stone')
    expect(stones).toHaveLength(plan.piecesPerStep.reduce((sum, count) => sum + count, 0))
    expect(new Set(stones.map(shape => {
      const points = shape.ringsMm.flat()
      return Math.round(Math.max(...points.map(point => point.y)) - Math.min(...points.map(point => point.y)))
    })).size).toBeGreaterThan(20)
    for (const shape of plan.shapes) {
      const points = shape.ringsMm.flat(), lateral = Math.max(...points.map(point => point.y)) - Math.min(...points.map(point => point.y))
      expect(lateral).toBeLessThan(source.widthMm * .91)
      if (shape.kind === 'riser' || shape.kind === 'light') expect(lateral).toBeLessThan(source.widthMm * .75)
    }
    assertClipped(plan)
    expect(source.bandMm).toEqual(band)
    plan.bandMm[0].x += 50; plan.shapes[0].ringsMm[0][0].x += 50
    expect(source.bandMm).toEqual(band)
    expect(planNaturalRockStepsV4({ ...source, seed: 'another-seed' })).not.toEqual(planNaturalRockStepsV4(source))
    expect(planNaturalRockSteps(source)).toEqual(legacy)
  })

  it('retains cumulative stationing through an inserted collinear control point', () => {
    expect(rounded(planNaturalRockStepsV4(input([p(0, 0), p(3800, 0), p(12000, 0)]))))
      .toEqual(rounded(planNaturalRockStepsV4(input())))
  })

  it.each([
    [p(1000, 1000), p(5000, 1000), p(5000, 6500)],
    [p(9000, 0), p(0, 0), p(0, 5000), p(9000, 5000)],
  ])('clips every rock and short lip to a bent/switchback band in either direction', (...points) => {
    const source = input(points, 1000, 40), reverse = input([...points].reverse(), 1000, 40)
    const plan = planNaturalRockStepsV4(source), back = planNaturalRockStepsV4(reverse)
    expect(plan.stationsMm).toEqual(back.stationsMm)
    expect(plan.stationsMm.every((value, i) => i === 0 || value > plan.stationsMm[i - 1])).toBe(true)
    assertClipped(plan); assertClipped(back)
  })

  it('uses a narrower supplied physical band without widening the saved footprint', () => {
    const source = input(); source.bandMm = [p(1600, -400), p(9800, -400), p(9800, 250), p(1600, 250)]
    const plan = planNaturalRockStepsV4(source)
    expect(plan.bandMm).toEqual(source.bandMm)
    expect(plan.stationsMm).toHaveLength(source.count)
    assertClipped(plan)
  })

  it('keeps dark contacts local and broken highlights restrained within each stone', () => {
    const plan = planNaturalRockStepsV4(input())
    expect(plan.shapes.filter(shape => shape.kind === 'light').length).toBeGreaterThan(0)
    for (const shape of plan.shapes) {
      if (shape.kind === 'riser') { expect(shape.shade).toBeLessThan(.9); expect(shape.opacity).toBeLessThanOrEqual(.51) }
      if (shape.kind === 'light') expect(shape.opacity).toBeLessThanOrEqual(.41)
      expect(plan.stationsMm).toContain(shape.stationMm)
    }
  })

  it('bounds derivation and validates all input before mutating a canvas', () => {
    const plan = planNaturalRockStepsV4(input([p(0, 0), p(80000, 0)], 1600, 512))
    expect(plan.stationsMm).toHaveLength(512); expect(plan.shapes.length).toBeLessThanOrEqual(12288)
    const target = { save: vi.fn(), fill: vi.fn(), clip: vi.fn() } as unknown as CanvasRenderingContext2D
    for (const invalid of [{ count: 513 }, { count: .5 }, { widthMm: 0 }, { widthMm: NaN }, { seed: '' }, { bandMm: [p(0, 0)] },
      { bandMm: [p(0, 0), p(1, 0), p(2, 0)] }, { frame: { length: 6000, at: () => p(NaN, 0) } }]) {
      expect(() => drawNaturalRockStepsV4(target, { ...input(), ...invalid, palette })).toThrow()
    }
    expect(() => drawNaturalRockStepsV4(target, { ...input(), palette: { ...palette, base: 'transparent' } })).toThrow('RGB')
    expect(target.save).not.toHaveBeenCalled(); expect(target.fill).not.toHaveBeenCalled(); expect(target.clip).not.toHaveBeenCalled()
  })

  it('clips first and restores the canvas if device painting fails', () => {
    class Path { moveTo = vi.fn(); lineTo = vi.fn(); closePath = vi.fn() }
    vi.stubGlobal('Path2D', Path)
    const calls: string[] = []
    const target = { save: () => calls.push('save'), clip: () => calls.push('clip'),
      fill: (_path: Path2D, rule: string) => { calls.push(`fill:${rule}`); throw new Error('device paint failed') }, restore: () => calls.push('restore') } as unknown as CanvasRenderingContext2D
    expect(() => drawNaturalRockStepsV4(target, { ...input(), palette })).toThrow('device paint failed')
    expect(calls).toEqual(['save', 'clip', 'fill:evenodd', 'restore'])
  })
})
