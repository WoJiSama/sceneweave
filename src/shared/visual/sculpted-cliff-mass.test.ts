import { describe, expect, it } from 'vitest'
import { sculptedCliffMass } from './sculpted-cliff-mass.js'

describe('sculpted ledges and steep rock faces', () => {
  it('shares the complete sampled front between neighboring planes and keeps its input deterministic', () => {
    const at = (s: number, d: number) => ({ x: s, y: Math.sin(s / 1400) * 800 + d * 1200 })
    const mass = sculptedCliffMass(18000, at, 'independent-curved-shelves', 400)
    expect(mass).toEqual(sculptedCliffMass(18000, at, 'independent-curved-shelves', 400))
    expect(mass.planes.some(p => p.surface === 'ledge')).toBe(true)
    expect(mass.planes.some(p => p.surface === 'wall')).toBe(true)
    for (let i = 0; i < mass.planes.length; i++) {
      const plane = mass.planes[i], back = plane.points.slice(plane.frontCount).reverse()
      if (i % 5 < 4) expect(back).toEqual(mass.planes[i + 1].points.slice(0, plane.frontCount))
      expect(plane.points.every(p => Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 0 && p.x <= 18000)).toBe(true)
    }
    expect(sculptedCliffMass(18000, at, 'another-rock-source', 400)).not.toEqual(mass)
  })
  it('joins a closed curved cliff at the same depths and bounds work on excessive inputs', () => {
    const length = 22000
    const at = (s: number, d: number) => ({ x: Math.cos(s / length * Math.PI * 2) * (4000 + d * 900), y: Math.sin(s / length * Math.PI * 2) * (4000 + d * 900) })
    const mass = sculptedCliffMass(length, at, 'independent-closed-rock', 500)
    for (let row = 0; row < 5; row++) {
      const first = mass.planes[row], last = mass.planes[mass.planes.length - 5 + row]
      expect(last.points[last.frontCount - 1].x).toBeCloseTo(first.points[0].x, 8)
      expect(last.points[last.frontCount - 1].y).toBeCloseTo(first.points[0].y, 8)
    }
    expect(() => sculptedCliffMass(1e10, at, 'over-budget', 500)).toThrow('预算')
    expect(() => sculptedCliffMass(1000, () => ({ x: NaN, y: 0 }), 'bad-coordinate', 500)).toThrow('坐标')
  })
})
