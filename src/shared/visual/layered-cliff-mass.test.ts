import { describe, expect, it } from 'vitest'
import { layeredCliffMass } from './layered-cliff-mass.js'
import { naturalCliffMass } from './natural-cliff-mass.js'

const at = (s: number, depth: number) => ({ x: s, y: depth * 1800 })

describe('separate stratified rock benches', () => {
  it('reuses the natural base without mutating it and joins shelf tops to their short fronts exactly', () => {
    const base = naturalCliffMass(16000, at, 'independent-layered-headland', 430), before = structuredClone(base)
    const plan = layeredCliffMass(16000, at, 'independent-layered-headland', 430)
    const { benches, planes, ...sameBase } = plan
    const { planes: originalPlanes, ...expectedBase } = base
    expect(sameBase).toEqual(expectedBase); expect(base).toEqual(before)
    expect(planes.map(p => p.points)).toEqual(originalPlanes.map(p => p.points))
    expect(plan).toEqual(layeredCliffMass(16000, at, 'independent-layered-headland', 430))
    expect(benches.length).toBeGreaterThan(10)
    for (const bench of benches) {
      expect(bench.top.slice(bench.edge.length).reverse()).toEqual(bench.edge)
      expect(bench.front.slice(0, bench.edge.length)).toEqual(bench.edge)
      expect(bench.top.every(p => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true)
      const span = bench.edge.at(-1)!.x - bench.edge[0].x
      expect(span).toBeGreaterThan(50); expect(span).toBeLessThan(2300)
    }
    expect(new Set(benches.map(b => b.depth)).size).toBeGreaterThan(10)
    expect(layeredCliffMass(16000, at, 'another-layered-headland', 430).benches).not.toEqual(benches)
  })
  it('keeps shelves on a concave curved face and rejects excessive work before allocation', () => {
    const curved = (s: number, depth: number) => ({ x: Math.cos(s / 2400) * (5000 + depth * 900), y: Math.sin(s / 2400) * (5000 + depth * 900) })
    const result = layeredCliffMass(9000, curved, 'independent-concave-rock', 360)
    for (const bench of result.benches) {
      expect(bench.edge.length).toBeGreaterThan(3)
      for (const p of bench.edge) expect(Math.hypot(p.x, p.y)).toBeGreaterThan(4000)
    }
    expect(() => layeredCliffMass(1e12, at, 'seed', 1e12)).toThrow(/预算/)
    expect(() => layeredCliffMass(9000, () => ({ x: NaN, y: 0 }), 'seed', 360)).toThrow(/无效/)
  })
})
