import { describe, expect, it } from 'vitest'
import clipping from 'polygon-clipping'
import { connectionBand } from '../geometry/geometry.js'
import { reliefContains } from './terrain-relief-frame.js'
import { composeTerrainMassPartition, terrainPartitionArea, type TerrainPartitionInput, type TerrainPartitionStair, type TerrainPartitionSurface } from './terrain-mass-partition.js'

const bounds = { x: 0, y: 0, width: 16000, height: 12000 }
const rect = (id: string, x: number, y: number, w: number, h: number, elevationMm: number, priority = 1): TerrainPartitionSurface => ({
  id, points: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]], elevationMm, priority,
})
const analytic: { id: string; surfaces: TerrainPartitionSurface[]; area: number }[] = [
  { id: 'same-height', surfaces: [rect('a', 1000, 3000, 5000, 6000, 2200), rect('b', 6000, 3000, 5000, 6000, 2200)], area: 70_400_000 },
  { id: 'nested', surfaces: [rect('base', 1000, 1000, 14000, 10000, 2200), rect('upper', 5000, 3000, 6000, 5000, 4200, 2)], area: 149_600_000 },
  { id: 'coast-junction', surfaces: [rect('base', 1000, 1000, 14000, 10000, 2200), rect('upper', 9000, 3000, 6000, 6000, 4200, 2)], area: 153_600_000 },
  { id: 'real-gap', surfaces: [rect('a', 1000, 3000, 5000, 6000, 2200), rect('b', 6300, 3000, 5000, 6000, 2200)], area: 96_800_000 },
  { id: 'projection-overlap', surfaces: [rect('back', 2000, 1000, 10000, 4000, 4200), rect('front', 2000, 5400, 10000, 4000, 2200)], area: 179_200_000 },
  { id: 'depression', surfaces: [rect('base', 1000, 1000, 14000, 10000, 2200), rect('hollow', 5000, 3000, 6000, 6000, 600, 2)], area: 144_000_000 },
]
const route = [{ x: 5500, y: 9000 }, { x: 5500, y: 8000 }, { x: 5700, y: 7000 }, { x: 6300, y: 6000 }, { x: 7300, y: 5400 }, { x: 8500, y: 5000 }, { x: 9500, y: 5000 }]
function stairInput(reflectX = false, reflectY = false, reversed = false): TerrainPartitionInput {
  const reflect = (p: { x: number; y: number }) => ({ x: reflectX ? bounds.width - p.x : p.x, y: reflectY ? bounds.height - p.y : p.y })
  const centerlineMm = route.map(reflect); if (reversed) centerlineMm.reverse()
  const surfaces = [rect('base', 1000, 1000, 14000, 10000, 3100), rect('upper', 7000, 1000, 8000, 10000, 5600, 2)].map(s => ({ ...s, points: s.points!.map(p => reflect(Array.isArray(p) ? { x: p[0], y: p[1] } : p)) }))
  const stair: TerrainPartitionStair = { id: 'curved', centerlineMm, widthMm: 1500, treadDepthMm: 500, fromElevationMm: reversed ? 5600 : 3100, toElevationMm: reversed ? 3100 : 5600,
    footprintMm: connectionBand(centerlineMm, 1500) }
  return { bounds, surfaces, connections: [stair] }
}

describe('one shared terrain/tread arrangement', () => {
  it.each(analytic)('matches independently calculated exposed wall area: $id', ({ surfaces, area }) => {
    const model = composeTerrainMassPartition({ bounds, surfaces })
    expect(model.metrics.wallAreaMm2).toBeCloseTo(area, 5)
    expect(model.metrics.coveredAreaMm2).toBe(bounds.width * bounds.height)
  })
  it('removes equal-height interior walls but retains editable source identities', () => {
    const model = composeTerrainMassPartition({ bounds, surfaces: analytic[0].surfaces })
    expect(model.tops.some(t => t.sourceId === 'a')).toBe(true); expect(model.tops.some(t => t.sourceId === 'b')).toBe(true)
    expect(model.walls.some(w => w.a[0] === 6000 && w.b[0] === 6000)).toBe(false)
  })
  it.each([1, 300])('retains a real %imm gap and both facing walls', gap => {
    const model = composeTerrainMassPartition({ bounds, surfaces: [rect('a', 1000, 1000, 5000, 8000, 2200), rect('b', 6000 + gap, 1000, 5000, 8000, 2200)] })
    const floor = model.tops.find(t => t.id === '$floor')!
    expect(reliefContains(floor.regions, { x: 6000 + gap / 2, y: 4000 })).toBe(true)
    expect(model.walls.filter(w => w.a[0] === 6000 && w.b[0] === 6000 || w.a[0] === 6000 + gap && w.b[0] === 6000 + gap)).toHaveLength(2)
  })
  it('does not turn point contact into a shared edge', () => {
    const model = composeTerrainMassPartition({ bounds, surfaces: [rect('a', 1000, 1000, 4000, 4000, 2200), rect('b', 5000, 5000, 4000, 4000, 2200)] })
    expect(model.walls).toHaveLength(8)
  })
  it('preserves source holes and negative higher-priority depressions', () => {
    const ring = rect('ring', 1000, 1000, 12000, 10000, 2200)
    ring.regions = [[ring.points!.map(p => Array.isArray(p) ? p : [p.x, p.y]), [[4000, 3000], [10000, 3000], [10000, 9000], [4000, 9000]]]]
    delete ring.points
    const model = composeTerrainMassPartition({ bounds, surfaces: [ring, rect('hollow', 4000, 3000, 6000, 6000, -1200, 2)] })
    expect(terrainPartitionArea(model.tops.find(t => t.id === 'ring')!.regions)).toBe(84_000_000)
    expect(model.tops.find(t => t.id === 'hollow')!.z).toBe(-1200)
    expect(model.walls.filter(w => w.low === -1200 && w.high === 2200)).toHaveLength(4)
  })
  it.each([false, true])('rejects equal-priority overlaps even if covered=%s', covered => {
    const surfaces = [rect('a', 1000, 1000, 6000, 6000, 2200), rect('b', 4000, 1000, 6000, 6000, 2200), ...(covered ? [rect('cover', 0, 0, 16000, 12000, 4200, 2)] : [])]
    expect(() => composeTerrainMassPartition({ bounds, surfaces })).toThrow('Ambiguous equal-priority overlap')
  })
  it.each([[false, false], [true, false], [false, true], [true, true]])('reconstructs native curved stairs at physical reflection x=%s/y=%s', (x, y) => {
    const input = stairInput(x, y), model = composeTerrainMassPartition(input), reverse = composeTerrainMassPartition(stairInput(x, y, true))
    const treads = model.tops.filter(t => t.sourceId === 'curved'), footprint = [input.connections![0].footprintMm.map(p => Array.isArray(p) ? p : [p.x, p.y] as [number, number])]
    expect(treads).toHaveLength(14)
    const assembled = clipping.union(treads[0].regions, ...treads.slice(1).map(t => t.regions))
    expect(terrainPartitionArea(clipping.xor(assembled, footprint))).toBeLessThan(1e-5)
    expect(reverse.metrics.wallAreaMm2).toBeCloseTo(model.metrics.wallAreaMm2, 5)
    for (let i = 0; i < model.tops.length; i++) for (let j = i + 1; j < model.tops.length; j++) {
      expect(terrainPartitionArea(clipping.intersection(model.tops[i].regions, model.tops[j].regions))).toBeLessThan(1e-5)
    }
  })
  it('uses exactly the same atomic endpoints on both sides of every internal edge', () => {
    const model = composeTerrainMassPartition(stairInput()), counts = new Map<string, number>()
    for (const top of model.tops) for (const poly of top.regions) for (const ring of poly) for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length], key = [JSON.stringify(a), JSON.stringify(b)].sort().join('|')
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    for (const [key, count] of counts) {
      expect(count).toBeLessThanOrEqual(2)
      if (count === 1) {
        const [a, b] = key.split('|').map(p => JSON.parse(p) as [number, number])
        expect(a[0] === b[0] && [0, bounds.width].includes(a[0]) || a[1] === b[1] && [0, bounds.height].includes(a[1])).toBe(true)
      }
    }
    for (const wall of model.walls) {
      const mid = { x: (wall.a[0] + wall.b[0]) / 2, y: (wall.a[1] + wall.b[1]) / 2 }
      const high = model.tops.find(t => reliefContains(t.regions, { x: mid.x - wall.normal[0] * .001, y: mid.y - wall.normal[1] * .001 }, false))!
      const low = model.tops.find(t => reliefContains(t.regions, { x: mid.x + wall.normal[0] * .001, y: mid.y + wall.normal[1] * .001 }, false))!
      expect(high.id).toBe(wall.highId); expect(low.id).toBe(wall.lowId); expect(high.z).toBe(wall.high); expect(low.z).toBe(wall.low)
    }
  })
  it.each([100_000_000, -100_000_000])('is stable near offset %imm and leaves source geometry intact', offset => {
    const input = { bounds: { ...bounds, x: offset, y: offset }, surfaces: [rect('base', offset + 1000, offset + 1000, 12000, 10000, 2200), rect('high', offset + 5000, offset + 3000, 6000, 6000, 4200, 2)] }
    const before = JSON.stringify(input), model = composeTerrainMassPartition(input)
    expect(JSON.stringify(input)).toBe(before); expect(model.metrics.coveredAreaMm2).toBe(bounds.width * bounds.height)
    expect(model.bounds).not.toBe(input.bounds)
  })
  it('rejects invalid dimensions, identities, nonfinite points and excessive inputs', () => {
    expect(() => composeTerrainMassPartition({ bounds: { ...bounds, width: 0 }, surfaces: [] })).toThrow('bounds')
    expect(() => composeTerrainMassPartition({ bounds, surfaces: [rect('$floor', 0, 0, 1000, 1000, 0)] })).toThrow('identity')
    expect(() => composeTerrainMassPartition({ bounds, surfaces: [rect('bad', NaN, 0, 1000, 1000, 0)] })).toThrow('coordinates')
    expect(() => composeTerrainMassPartition({ bounds, surfaces: Array.from({ length: 257 }, (_, i) => rect('area-' + i, 0, 0, 1000, 1000, 0)) })).toThrow('budget')
    const input = stairInput(); input.connections = [{ ...input.connections![0], treadDepthMm: 0 }]
    expect(() => composeTerrainMassPartition(input)).toThrow('dimensions')
  })
})
