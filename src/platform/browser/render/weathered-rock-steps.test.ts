import { describe, expect, it } from 'vitest'
import { connectionBand, pointInPolygon } from '../../../shared/geometry/geometry.js'
import type { PointMm } from '../../../shared/model/scene.js'
import type { ProjectedConnection } from '../../../shared/projection/types.js'
import { ERODED_ROCK_STEPS_PROFILE, planWeatheredRockSteps, WEATHERED_ROCK_STEPS_PROFILE } from './weathered-rock-steps.js'

function connection(centerlineMm: PointMm[]): ProjectedConnection {
  return { id: 'stone-flight', kind: 'stairs', start: centerlineMm[0], end: centerlineMm.at(-1)!,
    widthMm: 1800, fromElevationMm: 800, toElevationMm: 2900, blocksMovement: false, style: null,
    route: { centerlineMm, stairStyle: 'naturalRock', treadDepthMm: 355, renderProfile: WEATHERED_ROCK_STEPS_PROFILE } }
}

describe('weathered stairs in both views', () => {
  it.each([
    { direction: 'transverse', line: [{ x: 1000, y: 3450 }, { x: 5100, y: 3450 }] },
    { direction: 'vertical', line: [{ x: 1000, y: 5100 }, { x: 1000, y: 1000 }] },
    { direction: 'curved', line: [{ x: 1000, y: 5100 }, { x: 3200, y: 5100 }, { x: 5100, y: 4100 }] },
  ])('fills the flight between the landings and keeps visible noses on a $direction route', ({ line }) => {
    const row = connection(line), plan = planWeatheredRockSteps(row, 800, 2900)!
    expect(plan.treads.length).toBeGreaterThanOrEqual(10)
    expect([plan.lowMm, plan.highMm]).toEqual([800, 2900])
    expect(plan.landings.map(landing => landing.elevationMm)).toEqual([800, 2900])
    expect(plan.treads[0].lowerMm).toBe(800)
    expect(plan.treads.at(-1)!.upperMm).toBe(2900)
    const band = connectionBand(line, row.widthMm)
    for (const [i, tread] of plan.treads.entries()) {
      expect(tread.upperMm - tread.lowerMm).toBeGreaterThan(130)
      expect(tread.upperMm - tread.lowerMm).toBeLessThan(251)
      if (i > 0) expect(tread.lowerMm).toBe(plan.treads[i - 1].upperMm)
      expect(tread.front).not.toEqual(tread.lip)
      expect(tread.front.concat(tread.lip, ...tread.scuffs).every(point => pointInPolygon(point, band))).toBe(true)
    }
    const reversed = connection(line.toReversed())
    expect(planWeatheredRockSteps(reversed, 2900, 800)).toEqual(plan)
    expect(planWeatheredRockSteps(row, 800, 3530)!.treads.length).toBeGreaterThan(plan.treads.length)
  })
  it('spans the rise with irregular stone and continuous bedding on a bent route', () => {
    const line = [{ x: 1000, y: 3450 }, { x: 2950, y: 3180 }, { x: 5100, y: 3800 }]
    const row = connection(line)
    row.route!.renderProfile = ERODED_ROCK_STEPS_PROFILE
    const band = connectionBand(line, row.widthMm), plan = planWeatheredRockSteps(row, 800, 2900)!
    expect(plan.landings).toHaveLength(0)
    expect(plan.treads[0].lowerMm).toBe(800)
    expect(plan.treads.at(-1)!.upperMm).toBe(2900)
    expect([plan.lowMm, plan.highMm]).toEqual([800, 2900])
    const { pointAt, startMm, endMm, lengthMm } = plan.bedding!
    expect(pointAt(0, 0)).toEqual(line[0])
    expect(pointAt(lengthMm, 0)).toEqual(line.at(-1))
    expect(startMm).toBeGreaterThan(0)
    expect(endMm).toBeLessThan(lengthMm)
    expect(endMm - startMm).toBeCloseTo(plan.depthMm * plan.treads.length)
    for (const station of [0, startMm, (startMm + endMm) / 2, endMm, lengthMm]) {
      expect([-.49, 0, .49].every(lane => pointInPolygon(pointAt(station, lane), band))).toBe(true)
    }
    expect(plan.treads.every(tread => tread.polygonMm.every(point => pointInPolygon(point, band)))).toBe(true)
    const spans = plan.treads.map(({ front }) => Math.round(Math.hypot(front[0].x - front.at(-1)!.x, front[0].y - front.at(-1)!.y)))
    expect(Math.max(...spans) - Math.min(...spans)).toBeGreaterThan(150)
    expect(Math.min(...spans)).toBeGreaterThanOrEqual(1100)
  })
})
