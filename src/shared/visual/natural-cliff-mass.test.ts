import { describe, expect, it } from 'vitest'
import { naturalCliffMass } from './natural-cliff-mass.js'

const at = (distance: number, depth: number) => ({ x: distance, y: depth * 1800 })
describe('bounded world-space natural rock mass', () => {
  it('joins rock blocks at shared fronts while seed changes their shape and tone', () => {
    const a = naturalCliffMass(16000, at, 'independent-rock', 420)
    expect(a).toEqual(naturalCliffMass(16000, at, 'independent-rock', 420))
    expect(a).not.toEqual(naturalCliffMass(16000, at, 'another-rock', 420))
    expect(a.planes.length).toBeGreaterThan(20)
    for (let i = 4; i < a.planes.length; i++) {
      const previous = a.planes[i - 4], current = a.planes[i]
      expect(current.points[0]).toEqual(previous.points[previous.frontCount - 1])
      expect(current.points.at(-1)).toEqual(previous.points[previous.frontCount])
    }
    expect(new Set(a.planes.map(a => a.shade)).size).toBeGreaterThan(10)
    a.planes.forEach((plane, i) => {
      if (i % 4 < 3) expect(plane.points.slice(plane.frontCount).reverse()).toEqual(a.planes[i + 1].points.slice(0, plane.frontCount))
      expect(plane.frontCount).toBeGreaterThan(3)
    })
    expect(a.creases.every(points => points.at(-1)!.x - points[0].x < 2400)).toBe(true)
    expect(a.planes.every(plane => plane.points.every(p => Number.isFinite(p.x) && Number.isFinite(p.y)))).toBe(true)
  })
  it('samples broad shelves along a curved cliff instead of cutting across it with a chord', () => {
    const curved = (distance: number, depth: number) => {
      const angle = distance / 1900, radius = 5000 + depth * 1000
      return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius }
    }
    const result = naturalCliffMass(8000, curved, 'curved-rock', 420)
    const firstFront = result.planes[0].points.slice(0, result.planes[0].frontCount)
    expect(firstFront.length).toBeGreaterThan(5)
    for (const p of firstFront) expect(Math.hypot(p.x, p.y)).toBeCloseTo(4000, 8)
    const shifted = naturalCliffMass(8000, (s, d) => { const p = curved(s, d); return { x: p.x + 7000, y: p.y + 2000 } }, 'curved-rock', 420)
    expect(shifted.planes.map(p => p.shade)).not.toEqual(result.planes.map(p => p.shade))
  })
  it('rejects unbounded detail work or invalid arc samples', () => {
    expect(() => naturalCliffMass(Infinity, at, 'seed', 400)).toThrow()
    expect(() => naturalCliffMass(10_000_000, at, 'seed', 20)).toThrow(/预算/)
    expect(() => naturalCliffMass(1e12, at, 'seed', 1e12)).toThrow(/预算/)
    expect(() => naturalCliffMass(12000, () => ({ x: NaN, y: 0 }), 'seed', 400)).toThrow(/无效/)
  })
})
