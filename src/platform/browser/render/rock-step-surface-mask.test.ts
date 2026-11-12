import { describe, expect, it } from 'vitest'
import type { PointMm } from '../../../shared/model/scene.js'
import { planRockStepSideMask, ROCK_STEP_SIDE_MASK_LIMITS, type RockStepSideMask } from './rock-step-surface-mask.js'

const point = (x: number, y: number): PointMm => ({ x, y })
const input = () => ({ bounds: { x: 0, y: -1000, width: 10000, height: 2000 }, width: 501, height: 101,
  centerlineMm: [point(0, 0), point(10000, 0)], widthMm: 2000 })
const alpha = (mask: RockStepSideMask, x: number, y: number) => mask.data[(y * mask.width + x) * 4 + 3]

describe('profile-4 base surface side mask', () => {
  it('keeps the full center including endpoint stations and smoothly feathers only the two base sides', () => {
    const source = input(), before = structuredClone(source), mask = planRockStepSideMask(source), x = Math.floor(mask.width / 2), y = Math.floor(mask.height / 2)
    expect(planRockStepSideMask(source)).toEqual(mask)
    expect(alpha(mask, x, y)).toBe(255)
    expect(alpha(mask, 0, y)).toBe(255); expect(alpha(mask, mask.width - 1, y)).toBe(255)
    expect(alpha(mask, x, 0)).toBeLessThan(3); expect(alpha(mask, x, mask.height - 1)).toBeLessThan(3)
    expect(alpha(mask, x, 10)).toBeGreaterThan(0); expect(alpha(mask, x, 10)).toBeLessThan(255)
    for (let row = 1; row <= y; row++) expect(alpha(mask, x, row)).toBeGreaterThanOrEqual(alpha(mask, x, row - 1))
    for (let row = 0; row < mask.height; row++) expect(alpha(mask, x, row)).toBe(alpha(mask, x, mask.height - row - 1))
    expect(source).toEqual(before)
  })

  it('preserves the field when saved collinear segments are inserted or direction is reversed', () => {
    const source = input(), base = planRockStepSideMask(source)
    expect(planRockStepSideMask({ ...source, centerlineMm: [point(0, 0), point(3800, 0), point(10000, 0)] })).toEqual(base)
    expect(planRockStepSideMask({ ...source, centerlineMm: [...source.centerlineMm].reverse() })).toEqual(base)
  })

  it('follows every leg of a bent and switchback route while leaving space between separate arms transparent', () => {
    const bounds = { x: -1000, y: -1000, width: 8000, height: 7000 }, width = 401, height = 351
    const sample = (mask: RockStepSideMask, x: number, y: number) => alpha(mask,
      Math.round((x - bounds.x) / bounds.width * mask.width - .5), Math.round((y - bounds.y) / bounds.height * mask.height - .5))
    const source = { bounds, width, height, widthMm: 1000, centerlineMm: [point(0, 0), point(6000, 0), point(6000, 5000), point(0, 5000)] }
    const mask = planRockStepSideMask(source)
    for (const [x, y] of [[3000, 0], [6000, 2500], [3000, 5000], [6000, 0]]) expect(sample(mask, x, y)).toBe(255)
    expect(sample(mask, 3000, 2500)).toBe(0)
    expect(sample(mask, 3000, 450)).toBeGreaterThan(0); expect(sample(mask, 3000, 450)).toBeLessThan(100)
    expect(planRockStepSideMask({ ...source, centerlineMm: [...source.centerlineMm].reverse() })).toEqual(mask)
  })

  it('uses a bounded temporary raster and refuses invalid source dimensions or a degenerate route', () => {
    const source = input(), mask = planRockStepSideMask({ ...source, width: 4096, height: 1024 })
    expect(Math.max(mask.width, mask.height)).toBe(ROCK_STEP_SIDE_MASK_LIMITS.longEdge)
    expect(mask.data.length).toBe(mask.width * mask.height * 4)
    for (const value of [{ width: 0 }, { height: Infinity }, { width: 5000, height: 5000 }, { widthMm: 0 },
      { bounds: { ...source.bounds, height: -1 } }, { centerlineMm: [point(1, 2), point(1, 2)] },
      { centerlineMm: [point(0, 0), point(NaN, 0)] }]) expect(() => planRockStepSideMask({ ...source, ...value })).toThrow()
  })
})
