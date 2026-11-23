import { describe, expect, it } from 'vitest'
import type { PointMm } from '../model/scene.js'
import { planPlatformFenceRoutes, platformFenceBandGaps } from './platform-fence-route.js'

const p = (x: number, y: number): PointMm => ({ x, y })
const rect = (left: number, top: number, right: number, bottom: number) => [p(left, top), p(right, top), p(right, bottom), p(left, bottom)]
const outline = (points = rect(0, 0, 10000, 8000)) => ({
  boundaryMm: points.map((positionMm, index) => ({ id: `point-${index}`, segmentId: `edge-${index}`, positionMm })),
})
const all = { kind: 'all' } as const

describe('platform fence route geometry', () => {
  it('uses saved segment ids in outline order and joins the points across the seam', () => {
    const [ring] = planPlatformFenceRoutes(outline(), all)
    expect(ring).toMatchObject({ closed: true, segmentIds: ['edge-0', 'edge-1', 'edge-2', 'edge-3'], centerlineMm: rect(0, 0, 10000, 8000) })

    const [run] = planPlatformFenceRoutes(outline(), { kind: 'segments', segmentIds: ['edge-0', 'edge-3'] })
    expect(run).toMatchObject({ closed: false, segmentIds: ['edge-3', 'edge-0'], centerlineMm: [p(0, 8000), p(0, 0), p(10000, 0)] })
    expect(planPlatformFenceRoutes(outline(), { kind: 'segments', segmentIds: ['edge-0', 'edge-2'] })).toHaveLength(2)
    expect(() => planPlatformFenceRoutes(outline(), { kind: 'segments', segmentIds: ['removed'] })).toThrow(/边段/)
  })

  it('groups long outlines into command-sized sections without losing a source edge', () => {
    const points = Array.from({ length: 34 }, (_, i) => p((i < 17 ? i : 33 - i) * 1000, i < 17 ? 0 : 4000))
    const source = outline(points)
    const routes = planPlatformFenceRoutes(source, all)
    expect(routes.flatMap(route => route.segmentIds)).toEqual(source.boundaryMm.map(row => row.segmentId))
    expect(routes.every(route => !route.closed && route.centerlineMm.length <= 33)).toBe(true)
  })

  it('clips a single passage to both adjacent legs and merges overlapping clearances', () => {
    const [route] = planPlatformFenceRoutes(outline(), all)
    const gaps = platformFenceBandGaps(route, [rect(-100, -100, 1000, 1200), rect(800, -200, 2000, 100), rect(5000, 1600, 7000, 1900)], 2)
    expect(gaps).toEqual([{ side: 'both', fromMm: 0, toMm: 2002 }, { side: 'both', fromMm: 34798, toMm: 36000 }])
  })

  it('uses integer station ends for an oblique open edge', () => {
    const [route] = planPlatformFenceRoutes(outline([p(0, 0), p(1000, 1000), p(1000, 8000), p(0, 8000)]),
      { kind: 'segments', segmentIds: ['edge-0'] })
    expect(platformFenceBandGaps(route, [rect(700, 700, 1500, 1500)], 2)).toEqual([{ side: 'both', fromMm: 987, toMm: 1415 }])
  })
})
