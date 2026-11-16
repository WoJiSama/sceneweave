import { describe, expect, it } from 'vitest'
import polygonClipping from 'polygon-clipping'
import type { PointMm } from '../model/scene.js'
import { createRockShellPaintPlan, createRockShellSampler, estimateRockShellCost, generateRockShell,
  inspectRockShell, rockShellPhysicalFootprint, rockShellSchema, type CreateRockShellIntent, type RockShell, type RockShellHost } from './index.js'
import { area, cornerJoin, cornerMiter, cross, polygon, radialSectorLimit, segmentNormal } from './geometry.js'

const host = (points: PointMm[] = [{ x: 0, y: 0 }, { x: 12000, y: 0 }, { x: 12000, y: 8000 }, { x: 0, y: 8000 }]): RockShellHost => ({
  id: 'rock', floorId: 'floor', groundElevationMm: 2000, rockBody: { baseElevationMm: -500 },
  boundaryMm: points.map((positionMm, i) => ({ id: `p${i}`, segmentId: `s${i}`, positionMm })),
})
const intent = (changes: Partial<CreateRockShellIntent> = {}): CreateRockShellIntent => ({ footSurfaceRef: { kind: 'floor', id: 'floor' },
  footElevationMm: 0, widthMm: 1800, direction: { x: 1, y: 1 }, seed: 'granite-macro', excludedSegmentIds: [], ...changes })
const ids = () => { let n = 0; return { ids: { nextId: () => `shell-${++n}` } } }
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value))

describe('persisted finite actual rock shell', () => {
  it('saves complete immutable geometry, shared nodes and deterministic source recipe', () => {
    const h = host(), request = intent(), before = copy({ h, request })
    const a = generateRockShell(h, request, ids()), b = generateRockShell(h, request, ids())
    expect(a).toEqual(b)
    expect({ h, request }).toEqual(before)
    expect(Object.isFrozen(a.verticesMm)).toBe(true)
    expect(a.sections.length).toBeLessThanOrEqual(20)
    expect(Object.keys(a.verticesMm).length).toBeLessThanOrEqual(80)
    expect(Object.keys(a.faces).length).toBeLessThanOrEqual(120)
    expect(inspectRockShell(h, rockShellSchema.parse(copy(a)))).toEqual([])
    const nodes = Object.values(a.verticesMm).map(v => `${v.x},${v.y},${v.z}`)
    expect(new Set(nodes).size).toBe(nodes.length)
    for (const s of a.sections) expect(a.verticesMm[s.topVertexId].z).toBe(h.groundElevationMm)
    expect(a.sections.some(s => s.shoulderVertexId === s.topVertexId)).toBe(true)
    expect(a.sections.some(s => {
      const k = a.verticesMm[s.kneeVertexId], f = a.verticesMm[s.footVertexId]
      return k.x === f.x && k.y === f.y
    })).toBe(true)
  })

  it('uses actual asymmetric footprint and actual sloping face samples with no walk permission', () => {
    const h = host(), shell = generateRockShell(h, intent(), ids()), sampler = createRockShellSampler(shell)
    expect(area(sampler.physicalFootprintMm)).toBeGreaterThan(12000 * 8000)
    expect(rockShellPhysicalFootprint(h, shell)).toEqual(sampler.physicalFootprintMm)
    expect(sampler.sample({ x: 6000, y: 4000 })).toBeNull()
    const projected = sampler.triangles.filter(t => Math.abs(cross(...t.verticesMm)) > 1)
    expect(projected.length).toBeGreaterThan(10)
    for (const t of projected) {
      const p = { x: t.verticesMm.reduce((sum, v) => sum + v.x, 0) / 3, y: t.verticesMm.reduce((sum, v) => sum + v.y, 0) / 3 }
      const result = sampler.sample(p)!
      expect(result).toMatchObject({ inside: true, hostAreaId: h.id, walkable: false })
      expect(result.zMm).toBeCloseTo(t.verticesMm.reduce((sum, v) => sum + v.z, 0) / 3, 5)
      expect(result.normal.z).toBeGreaterThan(0)
      expect(result.normal.z).toBeLessThan(1)
    }
    const widths = shell.sections.map(s => {
      const t = shell.verticesMm[s.topVertexId], f = shell.verticesMm[s.footVertexId]
      return Math.hypot(f.x - t.x, f.y - t.y)
    })
    expect(Math.max(...widths)).toBeGreaterThan(Math.min(...widths) * 1.8)
  })

  it('keeps required source cliffs and both neighboring corner columns completely vertical', () => {
    const h = host(), shell = generateRockShell(h, intent({ excludedSegmentIds: ['s0', 's3'], requiredExcludedSegmentIds: ['s0', 's3'] }), ids())
    for (let i = 0; i < shell.sections.length; i++) {
      const s = shell.sections[i], t = shell.verticesMm[s.topVertexId]
      const cornerWithExcluded = s.offsetMm === 0 && ['s0', 's1', 's3'].includes(s.sourceSegmentId)
      if (['s0', 's3'].includes(s.sourceSegmentId) || cornerWithExcluded) for (const id of [s.shoulderVertexId, s.kneeVertexId, s.footVertexId]) expect(shell.verticesMm[id]).toMatchObject({ x: t.x, y: t.y })
    }
    const original = polygon(h.boundaryMm.map(v => v.positionMm)), outer = polygonClipping.difference(rockShellPhysicalFootprint(h, shell), original)
    expect(area(polygonClipping.intersection(outer, polygon([{ x: -5000, y: -5000 }, { x: 17000, y: -5000 }, { x: 17000, y: 0 }, { x: -5000, y: 0 }])))).toBe(0)
    expect(() => generateRockShell(h, intent({ excludedSegmentIds: ['s0'], requiredExcludedSegmentIds: ['s0', 's3'] }), ids())).toThrow(/入口|源崖/)
  })

  it('checks complete transaction budget before allocating any identity', () => {
    let allocations = 0
    const h = host(), request = intent(), cost = estimateRockShellCost(h, request)
    expect(cost).toBeLessThanOrEqual(221)
    expect(() => generateRockShell(h, request, { ids: { nextId: () => { allocations++; return `n${allocations}` } }, transactionBudget: cost - 1 })).toThrow(/预算/)
    expect(allocations).toBe(0)
  })

  it('supports an independent concave footprint and source-ring rotation without special coordinates', () => {
    const h = host([{ x: 2000, y: 1000 }, { x: 21000, y: 1000 }, { x: 21000, y: 14000 }, { x: 15000, y: 14000 }, { x: 15000, y: 11000 }, { x: 2000, y: 11000 }])
    const a = generateRockShell(h, intent({ widthMm: 1100 }), ids()), shifted = copy(h)
    shifted.boundaryMm = [...shifted.boundaryMm.slice(2), ...shifted.boundaryMm.slice(0, 2)]
    expect(generateRockShell(shifted, intent({ widthMm: 1100 }), ids())).toEqual(a)
    expect(inspectRockShell(h, a)).toEqual([])
    expect(rockShellPhysicalFootprint(h, a)[0]).toHaveLength(1)
  })

  it('resolves both frozen wide-shell shapes within the same 20-section budget using actual height', () => {
    const fixtures = [
      { h: host([{ x: 6000, y: 4000 }, { x: 20000, y: 4000 }, { x: 20000, y: 14000 }, { x: 6000, y: 14000 }]), count: 18 },
      { h: { ...host([{ x: 4000, y: 3000 }, { x: 21000, y: 3000 }, { x: 21000, y: 14000 }, { x: 15000, y: 14000 }, { x: 15000, y: 12500 }, { x: 4000, y: 12500 }]), groundElevationMm: 1800 }, count: 20 },
    ]
    for (const { h, count } of fixtures) {
      const request = intent({ widthMm: 3200, direction: { x: 0, y: 1 }, seed: 'shape-review-shared-rule',
        excludedSegmentIds: ['s0', h.boundaryMm.at(-1)!.segmentId] })
      const shell = generateRockShell(h, request, ids())
      expect(shell.sections).toHaveLength(count)
      expect(inspectRockShell(h, shell)).toEqual([])
      expect(estimateRockShellCost(h, request)).toBeLessThanOrEqual(221)
      // Width changes do not remove longitudinal samples from a tall wall.
      expect(generateRockShell(h, { ...request, widthMm: 1600 }, ids()).sections.map(s => [s.sourceSegmentId, s.offsetMm]))
        .toEqual(shell.sections.map(s => [s.sourceSegmentId, s.offsetMm]))
      const east = shell.sections.filter(s => s.sourceSegmentId === 's1')
      expect(east.length).toBeGreaterThanOrEqual(5)
      const spans = east.map((s, i) => (east[i + 1]?.offsetMm ?? h.boundaryMm[2].positionMm.y - h.boundaryMm[1].positionMm.y) - s.offsetMm)
      expect(Math.max(...spans)).toBeLessThanOrEqual(2200)
      const corner = shell.sections.find(s => s.sourceSegmentId === 's2' && s.offsetMm === 0)!, top = shell.verticesMm[corner.topVertexId], foot = shell.verticesMm[corner.footVertexId]
      const previous = east.at(-1)!, beforeTop = shell.verticesMm[previous.topVertexId], beforeFoot = shell.verticesMm[previous.footVertexId]
      expect(Math.abs((foot.x - top.x) - (beforeFoot.x - beforeTop.x))).toBeLessThan(h.groundElevationMm * .45)
    }
  })

  it('gives a shared corner the same actual profile from either boundary traversal direction', () => {
    const points = [{ x: 6000, y: 4000 }, { x: 20000, y: 4000 }, { x: 20000, y: 14000 }, { x: 6000, y: 14000 }]
    const request = intent({ widthMm: 3200, direction: { x: 0, y: 1 }, seed: 'shape-review-shared-rule' })
    const forward = generateRockShell(host(points), request, ids()), backward = generateRockShell(host([...points].reverse()), request, ids())
    const corners = (shell: RockShell) => shell.sections.filter(s => s.offsetMm === 0).map(s =>
      [s.topVertexId, s.shoulderVertexId, s.kneeVertexId, s.footVertexId].map(id => shell.verticesMm[id]))
      .sort((a, b) => a[0].x - b[0].x || a[0].y - b[0].y)
    expect(corners(forward)).toEqual(corners(backward))
    expect(inspectRockShell(host([...points].reverse()), backward)).toEqual([])
  })

  it('rejects self-intersecting concave expansion, unsupported ground and malformed source', () => {
    const narrow = host([{ x: 0, y: 0 }, { x: 10000, y: 0 }, { x: 10000, y: 10000 }, { x: 5500, y: 10000 },
      { x: 5500, y: 3000 }, { x: 4500, y: 3000 }, { x: 4500, y: 10000 }, { x: 0, y: 10000 }])
    expect(() => generateRockShell(narrow, intent({ widthMm: 6000 }), ids())).toThrow(/重叠|自交|侵入|孤岛/)
    expect(() => generateRockShell(host(), intent({ footElevationMm: -500 }), ids())).toThrow(/零高/)
    expect(() => generateRockShell(host(), intent({ footSurfaceRef: { kind: 'terrainArea', id: 'other' } }), ids())).toThrow(/Floor/)
    expect(() => generateRockShell(host([{ x: 0, y: 0 }, { x: 10000, y: 0 }, { x: 0, y: 10000 }, { x: 10000, y: 10000 }]), intent(), ids())).toThrow(/退化|自交/)
  })

  it('constructs actual general-angle shared miters by intersecting adjacent support lines', () => {
    const h = host([{ x: 0, y: 0 }, { x: 12000, y: 0 }, { x: 15000, y: 4000 }, { x: 12000, y: 10000 }, { x: 3000, y: 12000 }, { x: -2000, y: 7000 }])
    for (let i = 0; i < h.boundaryMm.length; i++) {
      const m = cornerMiter(h.boundaryMm, i), a = segmentNormal(h.boundaryMm, i), b = segmentNormal(h.boundaryMm, (i + h.boundaryMm.length - 1) % h.boundaryMm.length)
      expect(m.x * a.x + m.y * a.y).toBeCloseTo(1, 10)
      expect(m.x * b.x + m.y * b.y).toBeCloseTo(1, 10)
      expect(Math.hypot(m.x, m.y)).toBeLessThanOrEqual(2)
    }
    const shell = generateRockShell(h, intent({ widthMm: 1400 }), ids()), sampler = createRockShellSampler(shell)
    expect(inspectRockShell(h, shell)).toEqual([])
    expect(shell.sections.length).toBeLessThanOrEqual(20)
    for (const s of shell.sections) {
      const edge = h.boundaryMm.findIndex(v => v.segmentId === s.sourceSegmentId), top = shell.verticesMm[s.topVertexId], foot = shell.verticesMm[s.footVertexId]
      expect(Math.abs(cross(h.boundaryMm[edge].positionMm, h.boundaryMm[(edge + 1) % h.boundaryMm.length].positionMm, top))).toBe(0)
      for (const id of [s.shoulderVertexId, s.kneeVertexId]) expect(Math.abs(cross(top, foot, shell.verticesMm[id]))).toBe(0)
      expect([top, foot].every(p => Object.values(p).every(Number.isSafeInteger))).toBe(true)
    }
    for (const t of sampler.triangles) {
      const [a, b, c] = t.verticesMm
      if (cross(a, b, c) <= 1) continue
      const result = sampler.sample({ x: (a.x + b.x + c.x) / 3, y: (a.y + b.y + c.y) / 3 })!
      expect(result.walkable).toBe(false)
      expect(result.zMm).toBeCloseTo((a.z + b.z + c.z) / 3, 6)
    }
    const reverseHost = host(h.boundaryMm.map(v => v.positionMm).reverse()), reverse = generateRockShell(reverseHost, intent({ widthMm: 1400 }), ids())
    const corners = (value: RockShell) => value.sections.filter(s => s.offsetMm === 0).map(s =>
      [s.topVertexId, s.shoulderVertexId, s.kneeVertexId, s.footVertexId].map(id => value.verticesMm[id]))
      .sort((a, b) => a[0].x - b[0].x || a[0].y - b[0].y)
    expect(corners(reverse)).toEqual(corners(shell))
    expect(inspectRockShell(reverseHost, reverse)).toEqual([])
  })

  it('supports real diagonal ridges and a concave bay with exact source stations and cold actual geometry', () => {
    const h = host([{ x: 3000, y: 3000 }, { x: 18000, y: 3000 }, { x: 21000, y: 7000 }, { x: 18500, y: 11500 },
      { x: 14500, y: 10500 }, { x: 12000, y: 13500 }, { x: 7000, y: 12500 }, { x: 2000, y: 8000 }])
    const request = intent({ widthMm: 1000, excludedSegmentIds: ['s0', 's7'], requiredExcludedSegmentIds: ['s0', 's7'] })
    const shell = generateRockShell(h, request, ids()), restored = rockShellSchema.parse(copy(shell))
    expect(inspectRockShell(h, restored)).toEqual([])
    expect(rockShellPhysicalFootprint(h, restored)).toEqual(rockShellPhysicalFootprint(h, shell))
    expect(estimateRockShellCost(h, request)).toBeLessThanOrEqual(221)
    let allocations = 0
    expect(() => generateRockShell(h, request, { transactionBudget: estimateRockShellCost(h, request) - 1,
      ids: { nextId: () => `budget-${++allocations}` } })).toThrow(/预算/)
    expect(allocations).toBe(0)
    const rotated = copy(h); rotated.boundaryMm = [...rotated.boundaryMm.slice(3), ...rotated.boundaryMm.slice(0, 3)]
    expect(generateRockShell(rotated, request, ids())).toEqual(shell)
    for (const s of shell.sections) {
      if (s.sourceSegmentId !== 's0' && s.sourceSegmentId !== 's7' && !(s.sourceSegmentId === 's1' && s.offsetMm === 0)) continue
      const top = shell.verticesMm[s.topVertexId]
      for (const id of [s.shoulderVertexId, s.kneeVertexId, s.footVertexId]) expect(shell.verticesMm[id]).toMatchObject({ x: top.x, y: top.y })
    }
    const broken = copy(shell), station = broken.sections.find(s => s.sourceSegmentId === 's1' && s.offsetMm > 0)!
    broken.verticesMm[station.topVertexId].x++
    expect(inspectRockShell(h, broken).length).toBeGreaterThan(0)
  })

  it('limits a non-right concave sector by its actual shared-ray intersection', () => {
    // Corner ray (-2,1): x=-2y. The point (-9,0) moving down crosses at y=4.5.
    const bound = radialSectorLimit({ x: -9, y: 0 }, { x: 0, y: 1 }, { x: 0, y: 0 }, { x: -2, y: 1 })
    expect(bound).toBeCloseTo(3.5)
    expect(radialSectorLimit({ x: -9, y: 0 }, { x: 0, y: -1 }, { x: 0, y: 0 }, { x: -2, y: 1 })).toBe(Infinity)
  })

  it('never rounds a primitive diagonal source top off its true line', () => {
    const h = host([{ x: 0, y: 0 }, { x: 10000, y: 1 }, { x: 11000, y: 10000 }, { x: 0, y: 10000 }])
    const shell = generateRockShell(h, intent({ widthMm: 800 }), ids())
    expect(shell.sections.filter(s => s.sourceSegmentId === 's0')).toHaveLength(1)
    expect(inspectRockShell(h, shell)).toEqual([])
  })

  it('converges formerly excessive sharp convex and deep concave corners to actual vertical sections', () => {
    const outlines = [
      [{ x: 0, y: 0 }, { x: 8000, y: 0 }, { x: 16000, y: 1000 }, { x: 8000, y: 2000 }, { x: 0, y: 2000 }],
      [{ x: 0, y: 0 }, { x: 14000, y: 0 }, { x: 14000, y: 12000 }, { x: 9500, y: 12000 }, { x: 7000, y: 3000 }, { x: 4500, y: 12000 }, { x: 0, y: 12000 }],
    ]
    for (const points of outlines) {
      const h = host(points), request = intent({ widthMm: 600 }), shell = generateRockShell(h, request, ids())
      const oldRejected = h.boundaryMm.flatMap((_, edge) => cornerJoin(h.boundaryMm, edge).kind === 'vertical' ? [edge] : [])
      expect(oldRejected.length).toBeGreaterThan(0)
      for (const edge of oldRejected) {
        expect(() => cornerMiter(h.boundaryMm, edge)).toThrow(/miter/)
        const section = shell.sections.find(s => s.sourceSegmentId === h.boundaryMm[edge].segmentId && s.offsetMm === 0)!
        const top = shell.verticesMm[section.topVertexId]
        expect(top).toEqual({ ...h.boundaryMm[edge].positionMm, z: h.groundElevationMm })
        for (const id of [section.shoulderVertexId, section.kneeVertexId, section.footVertexId]) expect(shell.verticesMm[id]).toMatchObject({ x: top.x, y: top.y })
        const corrupt = copy(shell); corrupt.verticesMm[section.footVertexId].x++
        expect(inspectRockShell(h, corrupt)[0]?.message).toMatch(/竖直/)
      }
      expect(inspectRockShell(h, rockShellSchema.parse(copy(shell)))).toEqual([])
      const cold = createRockShellSampler(copy(shell))
      for (const triangle of cold.triangles) {
        const [a, b, c] = triangle.verticesMm
        if (cross(a, b, c) < 1) continue
        const actual = cold.sample({ x: (a.x + b.x + c.x) / 3, y: (a.y + b.y + c.y) / 3 })!
        expect(actual).toMatchObject({ inside: true, hostAreaId: h.id, walkable: false })
        expect(actual.zMm).toBeCloseTo((a.z + b.z + c.z) / 3, 6)
      }
      const reverseHost = host([...points].reverse()), reverse = generateRockShell(reverseHost, request, ids())
      const cornerRows = (value: RockShell) => value.sections.filter(s => s.offsetMm === 0).map(s =>
        [s.topVertexId, s.shoulderVertexId, s.kneeVertexId, s.footVertexId].map(id => value.verticesMm[id]))
        .sort((a, b) => a[0].x - b[0].x || a[0].y - b[0].y)
      expect(cornerRows(reverse)).toEqual(cornerRows(shell))
      expect(inspectRockShell(reverseHost, reverse)).toEqual([])
      let allocations = 0
      expect(() => generateRockShell(h, request, { transactionBudget: estimateRockShellCost(h, request) - 1,
        ids: { nextId: () => `none-${++allocations}` } })).toThrow(/预算/)
      expect(allocations).toBe(0)
    }
  })

  it('still rejects nonadjacent side-band intersections instead of hiding them with a vertical corner', () => {
    const h = host([{ x: 0, y: 0 }, { x: 14000, y: 0 }, { x: 14000, y: 12000 }, { x: 9500, y: 12000 },
      { x: 7000, y: 3000 }, { x: 4500, y: 12000 }, { x: 0, y: 12000 }])
    expect(() => generateRockShell(h, intent({ widthMm: 12000 }), ids())).toThrow(/重叠|侵入|自交|孤岛/)
    const folded = host([{ x: 0, y: 0 }, { x: 12000, y: 0 }, { x: 6000, y: 0 }, { x: 6000, y: 8000 }, { x: 0, y: 8000 }])
    let allocations = 0
    expect(() => generateRockShell(folded, intent(), { ids: { nextId: () => `none-${++allocations}` } })).toThrow(/折返|自交/)
    expect(allocations).toBe(0)
  })

  it('cold validation rejects missing faces, moved top/foot, flipped faces, stale source and stray nodes', () => {
    const h = host(), shell = generateRockShell(h, intent({ excludedSegmentIds: ['s0'] }), ids())
    const broken: RockShell[] = []
    const missing = copy(shell); delete missing.faces[Object.keys(missing.faces)[0]]; broken.push(missing)
    const movedTop = copy(shell); movedTop.verticesMm[movedTop.sections[0].topVertexId].x++; broken.push(movedTop)
    const foot = copy(shell); foot.verticesMm[foot.sections[2].footVertexId].z = -500; broken.push(foot)
    const flipped = copy(shell), f = flipped.faces[Object.keys(flipped.faces).find(id => {
      const [a, b, c] = flipped.faces[id].vertexIds.map(v => flipped.verticesMm[v])
      return cross(a, b, c) > 1
    })!]
    ;[f.vertexIds[1], f.vertexIds[2]] = [f.vertexIds[2], f.vertexIds[1]]; broken.push(flipped)
    const stale = copy(shell); stale.sourceBoundaryMm[0].positionMm.x++; broken.push(stale)
    const stray = copy(shell); stray.verticesMm.stray = { x: 50, y: 50, z: 50 }; broken.push(stray)
    for (const item of broken) expect(inspectRockShell(h, item).length).toBeGreaterThan(0)
    const translated = copy(h); translated.boundaryMm.forEach(v => v.positionMm.x++)
    expect(inspectRockShell(translated, shell).length).toBeGreaterThan(0)
  })

  it('preserves explicit manual state and validates actual saved geometry rather than regenerating from seed', () => {
    const h = host(), shell = copy(generateRockShell(h, intent(), ids()))
    shell.sections[3].state = 'manual'; Object.values(shell.faces)[0].state = 'manual'; shell.recipe.seed = 'another-source-seed'
    expect(inspectRockShell(h, shell)).toEqual([])
    expect(createRockShellSampler(shell).shell.sections[3].state).toBe('manual')
  })

  it('paint is deterministic, lit by one actual normal field and contained in actual face triangles', () => {
    const shell = generateRockShell(host(), intent(), ids()), before = copy(shell), paint = createRockShellPaintPlan(shell)
    expect(paint).toEqual(createRockShellPaintPlan(shell))
    expect(shell).toEqual(before)
    expect(paint.facets.length).toBeGreaterThan(10)
    expect(new Set(paint.facets.map(f => f.fill)).size).toBeGreaterThan(2)
    for (const facet of paint.facets) expect(facet.pointsMm).toEqual(shell.faces[facet.faceId].vertexIds.map(id => ({ x: shell.verticesMm[id].x, y: shell.verticesMm[id].y })))
    expect(paint.strokes.length).toBeLessThanOrEqual(12)
    expect(() => createRockShellPaintPlan(shell, { lightDirection: { x: 0, y: 0, z: 0 } })).toThrow(/光向/)
  })

  it('never invokes untrusted accessors at generation or strict import boundaries', () => {
    let reads = 0
    const h = host(); Object.defineProperty(h, 'groundElevationMm', { enumerable: true, get: () => { reads++; return 2000 } })
    expect(() => generateRockShell(h, intent(), ids())).toThrow(/访问器/)
    const shell = copy(generateRockShell(host(), intent(), ids())); Object.defineProperty(shell, 'verticesMm', { enumerable: true, get: () => { reads++; return {} } })
    expect(rockShellSchema.safeParse(shell).success).toBe(false)
    expect(reads).toBe(0)
  })
})
