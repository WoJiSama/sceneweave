import { describe, expect, it } from 'vitest'
import { composeTerrainMassPartition } from './terrain-mass-partition.js'
import type { TerrainPartitionTop, TerrainPartitionWall } from './terrain-mass-partition.js'
import { planTerrainStairCuts } from './terrain-stair-cut-plan.js'

const fixture = () => {
  const region = (left: number, right: number): TerrainPartitionTop['regions'] => [[[[left, 0], [right, 0], [right, 1500], [left, 1500]]]]
  const tops: TerrainPartitionTop[] = [{ id: 'low', sourceId: 'stairs', z: 100, kind: 'tread', regions: region(0, 450) },
    { id: 'high', sourceId: 'stairs', z: 250, kind: 'tread', regions: region(450, 900) }]
  const walls: TerrainPartitionWall[] = [{ a: [450, 1500], b: [450, 600], normal: [-1, 0], highId: 'high', lowId: 'low', low: 100, high: 250 },
    { a: [450, 600], b: [450, 0], normal: [-1, 0], highId: 'high', lowId: 'low', low: 100, high: 250 }]
  return { tops, walls, seed: 'cut-stair-study', maxFaceDepthMm: 120 }
}
describe('shared stair front paint', () => {
  it('joins atomic fronts before wear, preserves exact endpoints and independent clips, and ignores enumeration', () => {
    const input = fixture(), before = structuredClone(input), plan = planTerrainStairCuts(input)
    expect(plan.metrics.atomicFronts).toBe(2); expect(plan.cuts).toHaveLength(1)
    const cut = plan.cuts[0]
    expect(cut.lengthMm).toBe(1500); expect(cut.depthMm).toBe(108)
    expect(cut.frontMm[0]).toEqual([450, 1500]); expect(cut.frontMm.at(-1)).toEqual([450, 0])
    expect(cut.clipRegionsMm).toEqual(input.tops[1].regions)
    expect(planTerrainStairCuts({ ...input, walls: [...input.walls].reverse(), tops: [...input.tops].reverse() })).toEqual(plan)
    expect(planTerrainStairCuts({ ...input, walls: [{ ...input.walls[0], b: [450, 0] }] })).toEqual({ ...plan, metrics: { ...plan.metrics, atomicFronts: 1 } })
    cut.frontMm[0][0] += 10; cut.clipRegionsMm[0][0][0][0] += 10; plan.treads[0].regionsMm[0][0][0][0] += 10
    expect(input).toEqual(before)
  })
  it('bounds depth by real rise and caller cap without shortening the saved corridor', () => {
    const input = fixture(), shallow = planTerrainStairCuts({ ...input, faceDepthPerRise: .4 }), deep = planTerrainStairCuts({ ...input, faceDepthPerRise: .9 })
    expect(shallow.cuts[0].depthMm).toBe(60); expect(deep.cuts[0].depthMm).toBe(120)
    expect(shallow.treads).toEqual(deep.treads)
    expect(planTerrainStairCuts({ ...input, walls: input.walls.map(w => ({ ...w, high: 101 })), tops: input.tops.map(t => t.id === 'high' ? { ...t, z: 101 } : t) }).cuts[0].depthMm).toBe(.72)
  })
  it('does not turn a different source, terrain side, or equal height into a stair riser', () => {
    const input = fixture()
    expect(planTerrainStairCuts({ ...input, tops: input.tops.map(t => t.id === 'low' ? { ...t, sourceId: 'another' } : t) }).cuts).toEqual([])
    expect(planTerrainStairCuts({ ...input, tops: input.tops.map(t => t.id === 'low' ? { ...t, kind: 'terrain' } : t) }).cuts).toEqual([])
    expect(() => planTerrainStairCuts({ ...input, walls: input.walls.map(w => ({ ...w, low: 250 })) })).toThrow()
  })
  it('rejects ambiguous or inconsistent shared boundaries instead of returning part of a paint plan', () => {
    const input = fixture()
    expect(() => planTerrainStairCuts({ ...input, walls: [...input.walls, { ...input.walls[0], b: [450, 900] }] })).toThrow(/branched/)
    expect(() => planTerrainStairCuts({ ...input, walls: input.walls.map(w => ({ ...w, normal: [1, 0] })) })).toThrow(/normal/)
    expect(() => planTerrainStairCuts({ ...input, maxFaceDepthMm: Infinity })).toThrow()
    expect(() => planTerrainStairCuts({ ...input, faceDepthPerRise: 1.1 })).toThrow()
    expect(() => planTerrainStairCuts({ ...input, tops: [...input.tops, input.tops[0]] })).toThrow()
  })
  it('reuses a shared partition of the same ascending physical stair saved in either direction', () => {
    const surface = { id: 'base', priority: 1, elevationMm: 0, points: [[0, 0], [6000, 0], [6000, 4000], [0, 4000]] as [number, number][] }
    const stair = { id: 'route', centerlineMm: [{ x: 500, y: 2000 }, { x: 5500, y: 2000 }], footprintMm: [[500, 1250], [5500, 1250], [5500, 2750], [500, 2750]] as [number, number][], widthMm: 1500, treadDepthMm: 450, fromElevationMm: 0, toElevationMm: 2000 }
    const input = { bounds: { x: 0, y: 0, width: 6000, height: 4000 }, surfaces: [surface], connections: [stair] }
    const a = composeTerrainMassPartition(input), b = composeTerrainMassPartition({ ...input, connections: [{ ...stair, centerlineMm: [...stair.centerlineMm].reverse(), fromElevationMm: 2000, toElevationMm: 0 }] })
    const paint = (p: typeof a) => planTerrainStairCuts({ ...p, seed: 'same-stair', maxFaceDepthMm: 120 })
    expect(paint(a)).toEqual(paint(b)); expect(paint(a).cuts.length).toBe(a.metrics.stairs[0].treads - 1)
    const complete = planTerrainStairCuts({ ...a, connections: input.connections, seed: 'same-stair', maxFaceDepthMm: 120 })
    expect(complete.cuts.length).toBe(a.metrics.stairs[0].treads)
    const first = complete.cuts.find(c => c.fromElevationMm === 0)!
    expect(first.frontMm[0][0]).toBe(500); expect(first.frontMm.at(-1)![0]).toBe(500)
    expect(first.lengthMm).toBe(1500)
    expect(planTerrainStairCuts({ ...b, connections: [{ ...stair, centerlineMm: [...stair.centerlineMm].reverse(), fromElevationMm: 2000, toElevationMm: 0 }], seed: 'same-stair', maxFaceDepthMm: 120 })).toEqual(complete)
  })
})
