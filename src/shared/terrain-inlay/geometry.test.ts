import { describe, expect, it } from 'vitest'
import { createTerrainInlaySampler, planTerrainInlay } from './geometry.js'
import type { TerrainInlayRequest, TerrainInlaySource, TerrainInlayPoint } from './contracts.js'

const source = (id: string, height: number, priority: number, x0: number, x1: number): TerrainInlaySource => ({
  id, floorId: 'floor', groundElevationMm: height, coveragePriority: priority,
  boundaryMm: [{ x: x0, y: 0 }, { x: x1, y: 0 }, { x: x1, y: 6000 }, { x: x0, y: 6000 }]
    .map((positionMm, i) => ({ id: `${id}-p${i}`, segmentId: `${id}-s${i}`, positionMm })),
})
const fixture = (): TerrainInlayRequest => ({
  sources: [source('low', 1000, 1, 0, 10000), source('high', 3000, 2, 5000, 10000)],
  verticesMm: { a: { x: 2000, y: 2000, z: 1000 }, b: { x: 8000, y: 2000, z: 3000 },
    c: { x: 8000, y: 4000, z: 3000 }, d: { x: 2000, y: 4000, z: 1000 } },
  faces: { f1: { id: 'f1', kind: 'walk', vertexIds: ['a', 'b', 'c'] }, f2: { id: 'f2', kind: 'walk', vertexIds: ['a', 'c', 'd'] } },
  footprintVertexIds: ['a', 'b', 'c', 'd'], walkBoundaryVertexIds: ['a', 'b', 'c', 'd'],
})
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value))

describe('local terrain cut and fill development kernel', () => {
  it('derives real fill/cut and zero-step source intervals from immutable full source rings', () => {
    const input = fixture(), original = copy(input), plan = planTerrainInlay(input)
    expect(input).toEqual(original)
    expect(Object.isFrozen(plan.cells[0].ringMm)).toBe(true)
    expect(plan.footprintAreaMm2).toBe(12_000_000)
    expect(plan.walkAreaMm2).toBe(plan.footprintAreaMm2)
    expect(plan.fillVolumeMm3).toBeCloseTo(3_000_000_000, 3)
    expect(plan.cutVolumeMm3).toBeCloseTo(3_000_000_000, 3)
    expect(plan.sourceIntervals).toHaveLength(2)
    for (const row of plan.sourceIntervals) {
      expect(row.sourceAreaId).toBe('high')
      expect(row.outsideSourceAreaId).toBe('low')
      expect(row.originalInsideHeightMm).toBe(3000)
      expect(row.originalOutsideHeightMm).toBe(1000)
      expect(row.sourceSegmentId).toBe('high-s3')
      expect(row.insideHeightMm).toEqual([2000, 2000])
      expect(row.outsideHeightMm).toEqual([2000, 2000])
    }
    const query = createTerrainInlaySampler(input)
    input.verticesMm.a.z = 9000
    expect(query.sample({ x: 5000, y: 3000 }, true)).toMatchObject({ zMm: 2000, kind: 'walk' })
    expect(query.sample({ x: 1000, y: 3000 })).toBeNull()
    expect(planTerrainInlay(copy(original))).toEqual(plan)
  })

  it('derives final outward walls against the visible opposite ground, excluding same-height caps', () => {
    const input = fixture(), plan = planTerrainInlay(input)
    expect(plan.exposedWalls).toHaveLength(4)
    expect(plan.exposedWalls.every(w => w.a.y === w.b.y && [2000, 4000].includes(w.a.y))).toBe(true)
    let wallArea = 0
    for (const wall of plan.exposedWalls) {
      const [a, b, c, d] = wall.verticesMm
      const cross3 = (a: TerrainInlayPoint, b: TerrainInlayPoint, c: TerrainInlayPoint) => ({
        x: (b.y - a.y) * (c.z - a.z) - (b.z - a.z) * (c.y - a.y),
        y: (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z),
        z: (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x),
      })
      for (const n of [cross3(a, b, c), cross3(a, c, d)]) {
        expect(Math.abs(n.z)).toBe(0)
        const size = Math.hypot(n.x, n.y)
        if (size) expect((n.x * wall.normal.x + n.y * wall.normal.y) / size).toBeCloseTo(1)
        wallArea += size / 2
      }
      expect(wall.highMm.every((z, i) => z >= wall.lowMm[i])).toBe(true)
    }
    expect(wallArea).toBeCloseTo(6_000_000, 3)
    expect(plan.exposedWalls.filter(w => w.high.kind === 'actual')).toHaveLength(2)
    expect(plan.exposedWalls.filter(w => w.high.kind === 'source')).toHaveLength(2)
  })

  it('retains a real source cliff when actual equals the inside ground and erases it when actual meets the outside', () => {
    const input = fixture()
    // The north-east side of the actual boundary follows the original high
    // left edge, with a west arm to keep both explicit sources participating.
    Object.assign(input.verticesMm, {
      a: { x: 2000, y: 1000, z: 3000 }, b: { x: 8000, y: 1000, z: 3000 },
      c: { x: 8000, y: 4000, z: 3000 }, d: { x: 5000, y: 4000, z: 3000 },
      e: { x: 5000, y: 2000, z: 3000 }, f: { x: 2000, y: 2000, z: 3000 },
    })
    const t: [string, string, string][] = [['a', 'b', 'e'], ['b', 'c', 'e'], ['c', 'd', 'e'], ['a', 'e', 'f']]
    input.faces = Object.fromEntries(t.map((vertexIds, i) => [`f${i}`, { id: `f${i}`, kind: 'walk' as const, vertexIds }]))
    input.footprintVertexIds = ['a', 'b', 'c', 'd', 'e', 'f']; input.walkBoundaryVertexIds = [...input.footprintVertexIds]
    const plan = planTerrainInlay(input)
    const cliff = plan.exposedWalls.filter(w => w.a.x === 5000 && w.b.x === 5000 && Math.min(w.a.y, w.b.y) >= 2000)
    expect(cliff).toHaveLength(1)
    expect(cliff[0]).toMatchObject({ high: { kind: 'actual' }, low: { kind: 'source', areaId: 'low' }, highMm: [3000, 3000], lowMm: [1000, 1000], normal: { x: -1, y: 0 } })
    expect(plan.materialBoundaries.some(w => w.a.x === 5000 && w.b.x === 5000 && Math.min(w.a.y, w.b.y) >= 2000)).toBe(false)
    Object.values(input.verticesMm).forEach(p => { p.z = 1000 })
    const erased = planTerrainInlay(input)
    expect(erased.exposedWalls.some(w => w.a.x === 5000 && w.b.x === 5000 && Math.min(w.a.y, w.b.y) >= 2000)).toBe(false)
    expect(erased.materialBoundaries.some(w => w.a.x === 5000 && w.b.x === 5000 && Math.min(w.a.y, w.b.y) >= 2000)).toBe(true)
  })

  it('splits final walls before the high side changes and preserves all winding directions', () => {
    const input = fixture()
    input.verticesMm.a.z = input.verticesMm.d.z = 0
    input.verticesMm.b.z = input.verticesMm.c.z = 4000
    const plan = planTerrainInlay(input)
    expect(plan.exposedWalls).toHaveLength(10)
    expect(plan.exposedWalls.every(w => w.highMm.every((z, i) => z >= w.lowMm[i] - 1e-7))).toBe(true)
    const reverse = copy(input)
    reverse.sources.forEach(s => s.boundaryMm.reverse())
    reverse.footprintVertexIds.reverse(); reverse.walkBoundaryVertexIds.reverse()
    expect(planTerrainInlay(reverse).exposedWalls).toEqual(plan.exposedWalls)
  })

  it('splits a single source intersection at the actual zero volume line', () => {
    const input = fixture()
    input.sources[0].groundElevationMm = 1500
    input.sources[1].groundElevationMm = 2500
    const plan = planTerrainInlay(input)
    expect(plan.cells.filter(c => c.sourceAreaId === 'low').map(c => c.mode)).toContain('cut')
    expect(plan.cells.filter(c => c.sourceAreaId === 'low').map(c => c.mode)).toContain('fill')
    expect(plan.fillVolumeMm3).toBeCloseTo(1_500_000_000, 3)
    expect(plan.cutVolumeMm3).toBeCloseTo(1_500_000_000, 3)
    expect(plan.cells.reduce((sum, c) => sum + c.areaMm2, 0)).toBe(12_000_000)
  })

  it('restores collinear original source nodes instead of losing individual edge provenance', () => {
    const input = fixture(), high = input.sources[1]
    high.boundaryMm.push({ id: 'high-p4', segmentId: 'high-s4', positionMm: { x: 5000, y: 3000 } })
    const plan = planTerrainInlay(input)
    expect(new Set(plan.sourceIntervals.map(s => s.sourceSegmentId))).toEqual(new Set(['high-s3', 'high-s4']))
    expect(plan.sourceIntervals.every(s => s.a.y === 3000 || s.b.y === 3000)).toBe(true)
    expect(plan.sourceIntervals.every(s => s.insideHeightMm.every(z => z === 2000) && s.outsideHeightMm.every(z => z === 2000))).toBe(true)
  })

  it('preserves an explicitly separate non-walk apron sharing the same XYZ shoulder', () => {
    const input = fixture()
    input.verticesMm.e = { x: 2000, y: 1000, z: 1000 }; input.verticesMm.f = { x: 8000, y: 1000, z: 3000 }
    input.faces.f3 = { id: 'f3', kind: 'apron', vertexIds: ['e', 'f', 'b'] }
    input.faces.f4 = { id: 'f4', kind: 'apron', vertexIds: ['e', 'b', 'a'] }
    input.footprintVertexIds = ['e', 'f', 'b', 'c', 'd', 'a']
    const plan = planTerrainInlay(input), query = createTerrainInlaySampler(input)
    expect(plan.sharedWalkApronEdges).toHaveLength(2)
    expect(plan.walkAreaMm2).toBe(12_000_000)
    expect(plan.footprintAreaMm2).toBe(18_000_000)
    expect(query.sample({ x: 5000, y: 1500 })).toMatchObject({ kind: 'apron', zMm: 2000 })
    expect(query.sample({ x: 5000, y: 1500 }, true)).toBeNull()
    expect(query.sample({ x: 5000, y: 2000 })).toMatchObject({ kind: 'walk', zMm: 2000 })
  })

  it('does not expose a hidden lower raw boundary as an original source cliff', () => {
    // The low ring ends at x=10000, but high covers BOTH sides of this edge.
    // The L-shaped actual footprint occupies only its right side at y>=3000.
    const points = { a: [2000, 2000], b: [11000, 2000], g: [11000, 3000], c: [11000, 5000],
      d: [10000, 5000], e: [10000, 3000], f: [2000, 3000] }
    const faces: [string, string, string][] = [['a', 'b', 'e'], ['b', 'g', 'e'], ['a', 'e', 'f'], ['e', 'g', 'c'], ['e', 'c', 'd']]
    const input: TerrainInlayRequest = {
      sources: [source('low', 1000, 1, 0, 10000), source('high', 3000, 2, 5000, 12000)],
      verticesMm: Object.fromEntries(Object.entries(points).map(([id, [x, y]]) => [id, { x, y, z: 2000 }])),
      faces: Object.fromEntries(faces.map((vertexIds, i) => [`f${i}`, { id: `f${i}`, kind: 'walk' as const, vertexIds }])),
      footprintVertexIds: ['a', 'b', 'g', 'c', 'd', 'e', 'f'], walkBoundaryVertexIds: ['a', 'b', 'g', 'c', 'd', 'e', 'f'],
    }
    const plan = planTerrainInlay(input)
    expect(plan.sourceIntervals.length).toBeGreaterThan(0)
    expect(plan.sourceIntervals.every(s => s.sourceAreaId === 'high' && s.sourceSegmentId === 'high-s3')).toBe(true)
    const outsideWall = plan.materialBoundaries.find(w => w.a.x === 10000 && w.b.x === 10000 && Math.min(w.a.y, w.b.y) >= 3000)
    expect(outsideWall).toMatchObject({ sourceAreaId: 'high', actualHeightMm: [2000, 2000], originalHeightMm: [3000, 3000], kind: 'cut' })
    expect(plan.exposedWalls.find(w => w.a.x === 10000 && w.b.x === 10000 && Math.min(w.a.y, w.b.y) >= 3000))
      .toMatchObject({ high: { kind: 'source', areaId: 'high' }, highMm: [3000, 3000], lowMm: [2000, 2000], normal: { x: 1, y: 0 } })
    expect(createTerrainInlaySampler(input).sample({ x: 9999, y: 4000 })).toBeNull()
    expect(createTerrainInlaySampler(input).sample({ x: 10001, y: 4000 })).toMatchObject({ zMm: 2000 })
  })

  it('rejects gaps, overlaps, inverse faces, duplicate XY heights and unshared T junctions', () => {
    const missing = fixture(); delete missing.faces.f2
    expect(() => planTerrainInlay(missing)).toThrow()
    const overlapping = fixture(); overlapping.faces.f3 = { ...overlapping.faces.f1, id: 'f3' }
    expect(() => planTerrainInlay(overlapping)).toThrow(/重叠/)
    const inverse = fixture(); inverse.faces.f1.vertexIds.reverse()
    expect(() => planTerrainInlay(inverse)).toThrow(/朝上/)
    const duplicate = fixture(); duplicate.verticesMm.e = { ...duplicate.verticesMm.a, z: 1500 }
    expect(() => planTerrainInlay(duplicate)).toThrow(/共享/)
    const junction = fixture(); junction.verticesMm.e = { x: 5000, y: 3000, z: 2000 }
    junction.verticesMm.f = { x: 2000, y: 3000, z: 1000 }
    junction.faces.f2.vertexIds = ['a', 'e', 'f']
    expect(() => planTerrainInlay(junction)).toThrow(/T接点/)
  })

  it('rejects source escapes, different floors, source identity aliases and fractional persistent points', () => {
    const outside = fixture(); outside.verticesMm.a.x = -100
    expect(() => planTerrainInlay(outside)).toThrow(/越出/)
    const floor = fixture(); floor.sources[0].floorId = 'other'
    expect(() => planTerrainInlay(floor)).toThrow(/同Floor/)
    const alias = fixture(); alias.faces.f1.id = 'low-s1'
    expect(() => planTerrainInlay(alias)).toThrow()
    const fraction = fixture(); fraction.verticesMm.a.z = 1000.5
    expect(() => planTerrainInlay(fraction)).toThrow()
  })

  it('never runs source getters and refuses hidden, custom-prototype or extra input', () => {
    let reads = 0
    const input = fixture()
    Object.defineProperty(input.sources[0].boundaryMm[0], 'positionMm', { enumerable: true, get() { reads++; throw Error('getter ran') } })
    expect(() => planTerrainInlay(input)).toThrow(/访问器/)
    expect(reads).toBe(0)
    const hidden = fixture(); Object.defineProperty(hidden, 'hidden', { value: 1 })
    expect(() => createTerrainInlaySampler(hidden)).toThrow(/隐藏/)
    const custom = fixture(); Object.setPrototypeOf(custom.sources[0], { inherited: true })
    expect(() => planTerrainInlay(custom)).toThrow(/普通JSON/)
    expect(() => planTerrainInlay({ ...fixture(), approved: true } as TerrainInlayRequest)).toThrow()
  })

  it('refuses unused sources and excessive geometric work before expensive arrangements', () => {
    const unused = fixture()
    unused.sources[1].boundaryMm.forEach(p => { p.positionMm.x += 20000 })
    expect(() => planTerrainInlay(unused)).toThrow(/实际参与/)
    const heavy = fixture()
    // Collinear nodes are legal authored source data, but their complete
    // pairwise proof must fit the kernel's own finite work protection.
    for (const s of heavy.sources) s.boundaryMm = Array.from({ length: 2048 }, (_, i) => ({
      id: `${s.id}-dense-p${i}`, segmentId: `${s.id}-dense-s${i}`, positionMm: { x: i, y: i % 2 },
    }))
    expect(() => planTerrainInlay(heavy)).toThrow(/工作预算/)
    const tooMany = fixture()
    for (let i = 0; i < 513; i++) tooMany.verticesMm['extra-' + i] = { x: i, y: 1000, z: 1000 }
    expect(() => planTerrainInlay(tooMany)).toThrow(/有限保护/)
  })
})
