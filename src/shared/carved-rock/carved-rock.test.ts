import { describe, expect, it } from 'vitest'
import type { PointMm, SceneDocument } from '../model/scene.js'
import { carvedRockFaces, carvedStripCutFootprints, carvedStripFootprint, carvedStripSchema, createCarvedRockPaintPlan, createCarvedStrip,
  createCarvedStripSampler, followCarvedStrip, inspectCarvedStrip, inspectCarvedStripHost,
  sampleCarvedCut, sampleCarvedStrip, type CarvedRockHost, type CarvedStrip, type CreateCarvedStripIntent } from './index.js'
import polygonClipping from 'polygon-clipping'
import { carvedArea, carvedPolygon, carvedUnion } from './geometry.js'

const host = (points: PointMm[] = [{ x: 0, y: 0 }, { x: 12000, y: 0 }, { x: 12000, y: 8000 }, { x: 0, y: 8000 }]): CarvedRockHost => ({
  id: 'rock', floorId: 'floor', groundElevationMm: 2000, rockBody: { baseElevationMm: -500 },
  boundaryMm: points.map((positionMm, i) => ({ id: `p${i}`, segmentId: `s${i}`, positionMm })),
})
const intent = (changes: Partial<CreateCarvedStripIntent> = {}): CreateCarvedStripIntent => ({
  attachmentId: 'attachment', walkSurfaceId: 'walk', sourceSegmentIds: ['s0'], cutSide: 'right', widthMm: 1000,
  pointsMm: [{ x: 2000, y: 1500, z: 0 }, { x: 10000, y: 1500, z: 2000 }], ...changes,
})
const ids = () => { let value = 0; return { ids: { nextId: () => `allocated-${++value}` } } }
const copy = <T>(input: T): T => JSON.parse(JSON.stringify(input))
const connection = (strip: CarvedStrip) => ({ id: 'connection', floorId: 'floor', kind: 'ramp' as const, widthMm: strip.widthMm, carvedStrip: strip,
  from: { surfaceRef: { kind: 'floor' as const, id: 'floor' }, positionMm: { x: 2000, y: 1500 } },
  to: { surfaceRef: { kind: 'terrainArea' as const, id: 'rock' }, positionMm: { x: 10000, y: 1500 } },
})
const scene = (h: CarvedRockHost, strip: CarvedStrip) => ({ terrainAreas: { rock: h }, floors: { floor: { id: 'floor' } }, rooms: {}, terrainConnections: { connection: connection(strip) } }) as unknown as Pick<SceneDocument, 'terrainAreas' | 'floors' | 'rooms' | 'terrainConnections'>

describe('finite rock body and continuous carved path', () => {
  it('persists complete immutable geometry without changing inputs or using global identities', () => {
    const h = host(), request = intent(), original = copy({ h, request })
    const first = createCarvedStrip(h, request, ids()), second = createCarvedStrip(h, request, ids())
    expect(first).toEqual(second)
    expect({ h, request }).toEqual(original)
    expect(first.algorithmId).toBe('carved-strip1')
    expect(first.stations).toHaveLength(2)
    expect(first.walkFaceIds).toHaveLength(4)
    expect(first.cutCells.filter(row => row.kind === 'apron')).toHaveLength(2)
    expect(Object.isFrozen(first.verticesMm)).toBe(true)
    expect(inspectCarvedStrip(scene(h, first), connection(first))).toEqual([])
  })

  it('resolves continuous height and full-width support, while apron is a distinct non-walk surface', () => {
    const strip = createCarvedStrip(host(), intent(), ids()), query = createCarvedStripSampler(strip)
    expect(query.sample({ x: 6000, y: 1500 })).toMatchObject({ inside: true, zMm: 1000 })
    expect(query.sample({ x: 6000, y: 1999 })).toMatchObject({ zMm: 1000 })
    expect(query.sample({ x: 6000, y: 700 })).toBeNull()
    expect(query.sampleCut({ x: 6000, y: 700 })).toMatchObject({ kind: 'apron', zMm: 1000 })
    expect(sampleCarvedCut(strip, { x: 6000, y: 2100 })).toBeNull()
    expect(query.sample({ x: 6000, y: 1500 })!.normal.z).toBeGreaterThan(.9)
    expect(carvedStripFootprint(strip)).toHaveLength(4)
    expect(carvedStripCutFootprints(strip)).toHaveLength(6)
  })

  it('materializes both the inner cut wall and the outer exposed rock from the same sloping face', () => {
    const h = host(), strip = createCarvedStrip(h, intent(), ids()), plan = carvedRockFaces(h, [strip])
    const inner = plan.walls.filter(w => w.kind === 'cut' && Math.abs(w.a.y - 2002) < .001 && Math.abs(w.b.y - 2002) < .001)
    const outer = plan.walls.filter(w => w.kind === 'outer' && Math.abs(w.a.y) < .001 && Math.abs(w.b.y) < .001)
    expect(inner.length).toBeGreaterThan(0)
    expect(inner.every(w => w.highMm.every(z => z === 2000))).toBe(true)
    expect(inner.some(w => w.lowMm[0] !== w.lowMm[1])).toBe(true)
    expect(outer.length).toBeGreaterThan(0)
    expect(outer.every(w => w.lowMm.every(z => z === -500))).toBe(true)
    expect(outer.some(w => w.highMm[0] !== w.highMm[1])).toBe(true)
    expect(plan.patches.filter(p => p.kind === 'walk')).toHaveLength(4)
    expect(plan.walls.every(w => w.highMm.every((z, i) => z >= w.lowMm[i]))).toBe(true)
  })

  it('uses shared nodes and actual triangles on an unspecialized multi-segment curve', () => {
    const request = intent({ pointsMm: [{ x: 1800, y: 1300, z: 0 }, { x: 4800, y: 1800, z: 600 }, { x: 7800, y: 1700, z: 1300 }, { x: 10200, y: 1300, z: 2000 }] })
    const h = host(), strip = createCarvedStrip(h, request, ids())
    expect(inspectCarvedStripHost(h, strip)).toEqual([])
    request.pointsMm.forEach(p => expect(sampleCarvedStrip(strip, p)?.zMm).toBeCloseTo(p.z))
    const plan = carvedRockFaces(h, [strip])
    expect(plan.patches.filter(p => p.kind === 'walk')).toHaveLength(12)
    expect(plan.walls.length).toBeGreaterThan(4)
    for (const row of strip.stations) expect(strip.verticesMm[row.leftVertexId].z).toBe(strip.verticesMm[row.rightVertexId].z)
  })

  it('shares a complete finite source chain without depending on source ring start or map coordinates', () => {
    const h = host([{ x: 0, y: 0 }, { x: 6000, y: 0 }, { x: 12000, y: 0 }, { x: 12000, y: 8000 }, { x: 0, y: 8000 }])
    const first = createCarvedStrip(h, intent({ sourceSegmentIds: ['s0', 's1'] }), ids())
    const shifted = copy(h); shifted.boundaryMm = [...shifted.boundaryMm.slice(2), ...shifted.boundaryMm.slice(0, 2)]
    expect(inspectCarvedStripHost(shifted, first)).toEqual([])
    const opposite = host(), reflected = intent({ sourceSegmentIds: ['s2'], cutSide: 'right', pointsMm: [{ x: 10000, y: 6500, z: 0 }, { x: 2000, y: 6500, z: 2000 }] })
    const strip = createCarvedStrip(opposite, reflected, ids())
    expect(sampleCarvedStrip(strip, { x: 6000, y: 6500 })!.zMm).toBeCloseTo(1000)
    expect(carvedRockFaces(opposite, [strip]).walls.some(w => w.kind === 'outer' && Math.abs(w.a.y - 8000) < .001)).toBe(true)
  })

  it('preserves dense smooth stations and checks their actual full-width mesh without thinning the route', () => {
    const pointsMm = Array.from({ length: 33 }, (_, i) => ({ x: 2000 + i * 200,
      y: 1500 + Math.round(Math.sin(i / 8) * 100), z: Math.round(i * 2000 / 32) }))
    const request = intent({ pointsMm }), before = copy(request), h = host()
    const strip = createCarvedStrip(h, request, ids()), cold = carvedStripSchema.parse(copy(strip))
    expect(request).toEqual(before)
    expect(cold).toEqual(strip)
    expect(inspectCarvedStripHost(h, cold)).toEqual([])
    expect(strip.stations.map(row => strip.verticesMm[row.centerVertexId])).toEqual(pointsMm)
    expect(strip.walkFaceIds).toHaveLength(128)
    const query = createCarvedStripSampler(cold)
    for (let i = 1; i < cold.stations.length; i++) {
      const a = cold.stations[i - 1], b = cold.stations[i]
      for (const t of [0, .5, 1]) for (const across of [.01, .5, .99]) {
        const interpolate = (key: 'leftVertexId' | 'rightVertexId') => {
          const p = cold.verticesMm[a[key]], q = cold.verticesMm[b[key]]
          return { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t }
        }
        const left = interpolate('leftVertexId'), right = interpolate('rightVertexId')
        const sample = query.sample({ x: left.x + (right.x - left.x) * across, y: left.y + (right.y - left.y) * across })
        expect(sample).not.toBeNull()
        expect(sample!.zMm).toBeGreaterThanOrEqual(pointsMm[i - 1].z - 1e-6)
        expect(sample!.zMm).toBeLessThanOrEqual(pointsMm[i].z + 1e-6)
        expect(sample!.normal.z).toBeGreaterThan(0)
      }
    }
    const narrowed = copy(cold), row = narrowed.stations[16]
    narrowed.verticesMm[row.leftVertexId].y -= 30
    narrowed.verticesMm[row.rightVertexId].y += 30
    expect(inspectCarvedStripHost(h, narrowed)).not.toEqual([])
    const missing = copy(cold), removed = missing.walkFaceIds.pop()!
    delete missing.faces[removed]; missing.cutCells = missing.cutCells.filter(cell => cell.lowerFaceId !== removed)
    expect(inspectCarvedStripHost(h, missing)).not.toEqual([])
    expect(() => createCarvedStrip(h, intent({ pointsMm: [
      { x: 2000, y: 1500, z: 0 }, { x: 2200, y: 1500, z: 500 }, { x: 2050, y: 1600, z: 2000 },
    ] }), ids())).toThrow()
  })

  it('makes a real full-width floor entrance before climbing along the cliff', () => {
    const h = host(), strip = createCarvedStrip(h, intent({ pointsMm: [
      { x: 2000, y: 0, z: 0 }, { x: 2000, y: 1500, z: 0 }, { x: 10000, y: 1500, z: 2000 },
    ] }), ids())
    const sampler = createCarvedStripSampler(strip)
    for (const x of [1500, 2000, 2500]) {
      expect(sampler.sample({ x, y: 0 })).toMatchObject({ zMm: 0 })
      expect(sampler.sample({ x, y: 200 })).toMatchObject({ zMm: 0 })
    }
    expect(sampler.sample({ x: 2000, y: 1000 })).toMatchObject({ zMm: 0 })
    expect(sampler.sample({ x: 6000, y: 1500 })!.zMm).toBeCloseTo(1000)
    expect(carvedRockFaces(h, [strip]).walls.every(w => w.highMm.every((z, i) => z >= w.lowMm[i]))).toBe(true)
    const row = connection(strip); row.from.positionMm.y = 0
    expect(inspectCarvedStrip(scene(h, strip), row)).toEqual([])
    expect(() => createCarvedStrip(h, intent({ pointsMm: [
      { x: 2000, y: 0, z: 0 }, { x: 2000, y: 1500, z: 300 }, { x: 10000, y: 1500, z: 2000 },
    ] }), ids())).toThrow()
    expect(() => createCarvedStrip(h, intent({ pointsMm: [
      { x: 2000, y: 300, z: 0 }, { x: 2000, y: 1500, z: 0 }, { x: 10000, y: 1500, z: 2000 },
    ] }), ids())).toThrow()
  })

  it('rejects missing real host material, including a notch reached only by the outer part of the width', () => {
    expect(() => createCarvedStrip(host(), intent({ pointsMm: [{ x: 2000, y: 200, z: 0 }, { x: 10000, y: 200, z: 2000 }] }), ids())).toThrow()
    const h = host([{ x: 0, y: 0 }, { x: 12000, y: 0 }, { x: 12000, y: 8000 }, { x: 6500, y: 8000 },
      { x: 6500, y: 1900 }, { x: 4500, y: 1900 }, { x: 4500, y: 8000 }, { x: 0, y: 8000 }])
    expect(() => createCarvedStrip(h, intent(), ids())).toThrow(/越出/)
  })

  it('keeps the complete same path on an irregular host while retaining its axis-aligned source and actual slanted walls', () => {
    const h = host([{ x: 0, y: 0 }, { x: 12000, y: 0 }, { x: 14500, y: 3000 }, { x: 12500, y: 8000 },
      { x: 8000, y: 10000 }, { x: 2500, y: 9000 }, { x: 0, y: 6500 }])
    const original = copy(h), request = intent(), strip = createCarvedStrip(h, request, ids())
    // The route solver only depends on its explicit orthogonal source. Slanted
    // parts of the host are still exact material, not a bounding rectangle.
    expect(strip).toEqual(createCarvedStrip(host(), request, ids()))
    expect(inspectCarvedStripHost(h, strip)).toEqual([])
    const plan = carvedRockFaces(h, [strip])
    expect(plan.footprintMm).toEqual(h.boundaryMm.map(row => row.positionMm))
    expect(plan.walls.some(row => row.kind === 'cliff' && row.a.x !== row.b.x && row.a.y !== row.b.y)).toBe(true)
    expect(carvedArea(plan.topRegionsMm)).toBeCloseTo(carvedArea(carvedPolygon(plan.footprintMm))
      - carvedArea(carvedUnion(carvedStripCutFootprints(strip).map(carvedPolygon))), 5)
    for (const wall of plan.walls.filter(row => row.kind === 'cliff')) {
      expect(wall.highMm).toEqual([2000, 2000])
      expect(wall.lowMm).toEqual([-500, -500])
      expect(Math.hypot(wall.normal.x, wall.normal.y)).toBeCloseTo(1)
    }
    expect(h).toEqual(original)
    expect(() => createCarvedStrip(h, intent({ sourceSegmentIds: ['s1'] }), ids())).toThrow(/正交|共线/)
  })

  it('rejects a slanted concave intrusion that only the real outer width reaches', () => {
    const h = host([{ x: 0, y: 0 }, { x: 12000, y: 0 }, { x: 12000, y: 8000 }, { x: 7500, y: 8000 },
      { x: 6200, y: 1900 }, { x: 4800, y: 2100 }, { x: 3000, y: 8000 }, { x: 0, y: 8000 }])
    // Every route centre remains inside. The 1000mm full-width strip crosses
    // the notch, which a centreline or host-bounds check would miss.
    expect(() => createCarvedStrip(h, intent(), ids())).toThrow(/越出/)
    const crossed = host([{ x: 0, y: 0 }, { x: 12000, y: 0 }, { x: 0, y: 8000 }, { x: 11000, y: 7000 }])
    expect(() => createCarvedStrip(crossed, intent(), ids())).toThrow(/自交|接触/)
  })

  it('refuses bottom penetration, over-top paths, wrong cut side and a non-collinear source chain', () => {
    const h = host(); h.rockBody.baseElevationMm = 0
    expect(() => createCarvedStrip(h, intent(), ids())).toThrow(/岩底/)
    expect(() => createCarvedStrip(host(), intent({ pointsMm: [{ x: 2000, y: 1500, z: 0 }, { x: 10000, y: 1500, z: 2001 }] }), ids())).toThrow(/岩底|岩顶/)
    expect(() => createCarvedStrip(host(), intent({ cutSide: 'left' }), ids())).toThrow()
    expect(() => createCarvedStrip(host(), intent({ sourceSegmentIds: ['s0', 's1'] }), ids())).toThrow(/共线/)
    h.rockBody.baseElevationMm = 2000
    expect(() => createCarvedStrip(h, intent(), ids())).toThrow(/底高/)
  })

  it('refuses tight reversals and excessive saved complexity rather than manufacturing a legal-looking strip', () => {
    expect(() => createCarvedStrip(host(), intent({ pointsMm: [{ x: 2000, y: 1500, z: 0 }, { x: 8000, y: 1500, z: 900 }, { x: 2100, y: 1700, z: 2000 }] }), ids())).toThrow()
    expect(() => createCarvedStrip(host(), intent({ pointsMm: Array.from({ length: 65 }, (_, i) => ({ x: 2000 + i * 100, y: 1500, z: i * 20 })) }), ids())).toThrow()
    expect(() => createCarvedStrip(host(), intent(), { ids: { nextId: () => 'same-id' } })).toThrow(/重复/)
  })

  it('rejects imported missing walk/cut faces, detached apron and discontinuous saved height', () => {
    const h = host(), original = createCarvedStrip(h, intent(), ids())
    const missing = copy(original), removed = missing.walkFaceIds.pop()!
    delete missing.faces[removed]; missing.cutCells = missing.cutCells.filter(row => row.lowerFaceId !== removed)
    expect(inspectCarvedStripHost(h, missing)).not.toEqual([])
    const apron = copy(original); apron.cutCells = apron.cutCells.filter(row => row.kind !== 'apron')
    expect(() => carvedStripSchema.parse(apron)).toThrow()
    const broken = copy(original); broken.verticesMm[broken.stations[0].leftVertexId].z += 20
    expect(inspectCarvedStripHost(h, broken)).not.toEqual([])
    const shuffled = copy(original)
    const face = shuffled.faces[shuffled.walkFaceIds[0]], replacement = shuffled.stations.at(-1)!.rightVertexId
    face.vertexIds[0] = replacement
    expect(inspectCarvedStripHost(h, shuffled)).not.toEqual([])
    const collision = copy(original); collision.attachmentId = collision.sourceSegmentIds[0]
    expect(carvedStripSchema.safeParse(collision).success).toBe(false)
  })

  it('checks endpoint identity/height and rejects old route coexistence and crossing cut bodies', () => {
    const h = host(), strip = createCarvedStrip(h, intent(), ids()), document = scene(h, strip), row = connection(strip)
    expect(inspectCarvedStrip(document, { ...row, kind: 'stairs' })).not.toEqual([])
    expect(inspectCarvedStrip(document, { ...row, route: {} })).not.toEqual([])
    expect(inspectCarvedStrip(document, { ...row, widthMm: 1500 })).not.toEqual([])
    expect(inspectCarvedStrip(document, { ...row, from: { ...row.from, positionMm: { x: 2001, y: 1500 } } })).not.toEqual([])
    expect(inspectCarvedStrip(document, { ...row, to: { ...row.to, surfaceRef: { kind: 'floor', id: 'floor' } } })).not.toEqual([])
    const overlapping = { ...row, id: 'other' }; (document.terrainConnections as unknown as Record<string, unknown>).other = overlapping
    expect(inspectCarvedStrip(document, row)).not.toEqual([])
  })

  it('follows only proven rigid translation and preserves full manual geometry/identities', () => {
    const h = host(), changed = copy(h), original = copy(createCarvedStrip(h, intent(), ids()))
    original.stations[0].state = 'manual'
    for (const p of changed.boundaryMm) { p.positionMm.x += 2300; p.positionMm.y += 400 }
    const before = copy(original), moved = followCarvedStrip(h, changed, original)
    expect(original).toEqual(before)
    expect(moved.stations).toEqual(before.stations)
    expect(moved.faces).toEqual(before.faces)
    expect(sampleCarvedStrip(moved, { x: 8300, y: 1900 })?.zMm).toBeCloseTo(1000)
    changed.groundElevationMm += 100
    expect(() => followCarvedStrip(h, changed, original)).toThrow(/平移/)
  })

  it('keeps dynamic rock paint deterministic and outside actual walk width and top geometry', () => {
    const h = host(), strip = createCarvedStrip(h, intent({ pointsMm: [
      { x: 2000, y: 0, z: 0 }, { x: 2000, y: 1500, z: 0 }, { x: 10000, y: 1500, z: 2000 },
    ] }), ids())
    const plan = carvedRockFaces(h, [strip]), before = copy(plan), paint = createCarvedRockPaintPlan(plan, { seed: h.id })
    expect(paint).toEqual(createCarvedRockPaintPlan(plan, { seed: h.id }))
    expect(plan).toEqual(before)
    expect(paint.facets.length).toBeGreaterThan(0)
    const walk = carvedUnion(plan.patches.filter(p => p.kind === 'walk').map(p => carvedPolygon(p.verticesMm)))
    for (const facet of paint.facets) {
      expect(carvedArea(polygonClipping.intersection(carvedPolygon(facet.pointsMm), walk))).toBeLessThan(1e-6)
      expect(carvedArea(polygonClipping.intersection(carvedPolygon(facet.pointsMm), plan.topRegionsMm))).toBeLessThan(1e-6)
    }
    expect(paint.boundsMm).not.toBeNull()
  })

  it('never executes getter-bearing caller input and keeps malformed queries out', () => {
    let calls = 0
    const request = intent(); Object.defineProperty(request, 'widthMm', { enumerable: true, get() { calls++; return 1000 } })
    expect(() => createCarvedStrip(host(), request, ids())).toThrow(/访问器/)
    expect(calls).toBe(0)
    const bad = Object.defineProperty({}, 'algorithmId', { enumerable: true, get() { calls++; return 'carved-strip1' } })
    expect(carvedStripSchema.safeParse(bad).success).toBe(false)
    expect(calls).toBe(0)
    const strip = createCarvedStrip(host(), intent(), ids())
    expect(() => sampleCarvedStrip(strip, { x: Number.NaN, y: 1500 })).toThrow()
  })
})
