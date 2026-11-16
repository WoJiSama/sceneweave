import polygonClipping, { type MultiPolygon } from 'polygon-clipping'
import type { PointMm } from '../model/scene.js'
import { captureJson, freezeJson } from '../validation/json.js'
import { TERRAIN_INLAY_LIMITS as LIMITS, captureTerrainInlayRequest,
  type TerrainInlayCell, type TerrainInlayFace, type TerrainInlayPlan, type TerrainInlayPoint,
  type TerrainInlayRequest, type TerrainInlaySource, type TerrainInlaySourceInterval, type TerrainInlayMaterialBoundary,
  type TerrainInlayExposedWall } from './contracts.js'

const EPS = 1e-7, AREA_EPS = 1e-5
const cross = (a: PointMm, b: PointMm, c: PointMm) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
const length = (a: PointMm, b: PointMm) => Math.hypot(a.x - b.x, a.y - b.y)
const mix = (a: PointMm, b: PointMm, t: number) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
const key = (p: PointMm) => `${Math.round(p.x / EPS)},${Math.round(p.y / EPS)}`
const same = (a: PointMm, b: PointMm) => a.x === b.x && a.y === b.y
const edges = <T>(p: readonly T[]) => p.map((a, i) => [a, p[(i + 1) % p.length]] as const)
const signedArea = (p: readonly PointMm[]) => p.reduce((sum, a, i) => sum + cross(p[0], a, p[(i + 1) % p.length]), 0) / 2
const polygon = (p: readonly PointMm[]): MultiPolygon => [[p.map(v => [v.x, v.y])]]
const area = (multi: MultiPolygon) => multi.reduce((sum, p) => sum + p.reduce((sub, r, i) => sub + (i ? -1 : 1) * Math.abs(signedArea(r.map(([x, y]) => ({ x, y })))), 0), 0)
const union = (polys: MultiPolygon[]) => polys.length ? polygonClipping.union(polys[0], ...polys.slice(1)) : []
function assert(ok: unknown, message: string): asserts ok { if (!ok) throw Error(message) }
const on = (p: PointMm, a: PointMm, b: PointMm) => Math.abs(cross(a, b, p)) <= EPS * Math.max(1, length(a, b))
  && p.x >= Math.min(a.x, b.x) - EPS && p.x <= Math.max(a.x, b.x) + EPS && p.y >= Math.min(a.y, b.y) - EPS && p.y <= Math.max(a.y, b.y) + EPS
const meet = (a: PointMm, b: PointMm, c: PointMm, d: PointMm) => cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0
  || on(a, c, d) || on(b, c, d) || on(c, a, b) || on(d, a, b)
function simple(p: readonly PointMm[]) {
  assert(Math.abs(signedArea(p)) > AREA_EPS, '局部填切边界不能退化。')
  const e = edges(p)
  for (let i = 0; i < e.length; i++) {
    assert(!same(...e[i]), '局部填切边界不能含零长边。')
    for (let j = i + 1; j < e.length; j++) {
      if (j === i + 1 || i === 0 && j === e.length - 1) continue
      assert(!meet(...e[i], ...e[j]), '局部填切边界不能自交或自接触。')
    }
  }
}
function contains(regions: MultiPolygon, p: PointMm): boolean {
  const inRing = (raw: number[][]) => {
    const ring = raw.map(([x, y]) => ({ x, y })); let inside = false
    for (const [a, b] of edges(ring)) {
      if (on(p, a, b)) return true
      if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside
    }
    return inside
  }
  return regions.some(poly => inRing(poly[0]) && !poly.slice(1).some(inRing))
}
const triangle = (input: TerrainInlayRequest, face: TerrainInlayFace) => face.vertexIds.map(id => input.verticesMm[id]) as [TerrainInlayPoint, TerrainInlayPoint, TerrainInlayPoint]
function affine([a, b, c]: [TerrainInlayPoint, TerrainInlayPoint, TerrainInlayPoint]) {
  const determinant = cross(a, b, c)
  assert(determinant > EPS, '实际面必须有正面积且朝上。')
  const nx = (b.y - a.y) * (c.z - a.z) - (b.z - a.z) * (c.y - a.y)
  const ny = (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z), magnitude = Math.hypot(nx, ny, determinant)
  return { z: (p: PointMm) => (cross(p, b, c) * a.z + cross(a, p, c) * b.z + cross(a, b, p) * c.z) / determinant,
    normal: { x: nx / magnitude, y: ny / magnitude, z: determinant / magnitude } }
}
const faceContains = ([a, b, c]: [PointMm, PointMm, PointMm], p: PointMm) => cross(a, b, p) >= -EPS && cross(b, c, p) >= -EPS && cross(c, a, p) >= -EPS

function prepare(input: TerrainInlayRequest) {
  const request = freezeJson(captureTerrainInlayRequest(input)), vertices = Object.values(request.verticesMm), faces = Object.values(request.faces)
  assert(vertices.length >= 3 && vertices.length <= LIMITS.vertices && faces.length >= 1 && faces.length <= LIMITS.faces, '局部填切实际点面超过有限保护值。')
  assert(new Set(request.sources.map(a => a.id)).size === request.sources.length && new Set(request.sources.map(a => a.floorId)).size === 1, '实际填切须引用不同的同Floor源面。')
  const reserved = request.sources.flatMap(a => [a.id, ...a.boundaryMm.flatMap(p => [p.id, p.segmentId])])
  assert(new Set(reserved).size === reserved.length, '源地形的点边身份不能重复。')
  const ids = [...Object.keys(request.verticesMm), ...Object.keys(request.faces)]
  assert(new Set(ids).size === ids.length && !ids.some(id => reserved.includes(id) || id === request.sources[0].floorId), '实际填切不能复用源地形或Floor身份。')
  assert(new Set(vertices.map(key)).size === vertices.length, '实际面须共享相同XYZ节点，不能复制共同XY。')
  const allPoints = [...vertices, ...request.sources.flatMap(a => a.boundaryMm.map(p => p.positionMm))]
  const sourcePairWork = request.sources.reduce((sum, a) => sum + a.boundaryMm.length * (a.boundaryMm.length - 1) / 2, 0)
  const sourceClipWork = faces.length * request.sources.reduce((sum, a) => sum + a.boundaryMm.length, 0)
  assert(sourcePairWork + sourceClipWork + vertices.length * faces.length * 3 <= LIMITS.intersectionPairs, '源轮廓与实际网格超过有限交点工作预算。')
  assert(Math.max(...allPoints.map(p => p.x)) - Math.min(...allPoints.map(p => p.x)) <= LIMITS.spanMm
    && Math.max(...allPoints.map(p => p.y)) - Math.min(...allPoints.map(p => p.y)) <= LIMITS.spanMm, '局部填切范围超过1000米保护值。')
  const footprints = [request.footprintVertexIds, request.walkBoundaryVertexIds].map(ids => {
    assert(ids.every(id => Object.hasOwn(request.verticesMm, id)), '完整边界须引用实际现存节点。')
    const points = ids.map(id => request.verticesMm[id]); simple(points); return polygon(points)
  })
  for (const source of request.sources) simple(source.boundaryMm.map(p => p.positionMm))
  const used = new Set<string>()
  for (const [id, face] of Object.entries(request.faces)) {
    assert(face.id === id && new Set(face.vertexIds).size === 3 && face.vertexIds.every(v => Object.hasOwn(request.verticesMm, v)), '实际面ID及完整顶点引用无效。')
    const t = triangle(request, face); affine(t)
    face.vertexIds.forEach(id => used.add(id))
    // Input T-junctions are rejected rather than silently rewriting persistent
    // geometry. Source intersections are noded later in disposable cells only.
    for (const [a, b] of edges(t)) for (const p of vertices) if (on(p, a, b)) assert(same(p, a) || same(p, b), '实际网格存在未共享的T接点。')
  }
  assert(used.size === vertices.length, '实际填切不能包含孤立顶点。')
  const faceRegions = faces.map(f => polygon(triangle(request, f))), actual = union(faceRegions)
  assert(Math.abs(faceRegions.reduce((s, r) => s + area(r), 0) - area(actual)) <= AREA_EPS, '实际填切三角片重叠。')
  assert(area(polygonClipping.xor(actual, footprints[0])) <= AREA_EPS, '实际填切不能漏面或越过完整声明边界。')
  const walk = union(faces.filter(f => f.kind === 'walk').map(f => polygon(triangle(request, f))))
  assert(area(polygonClipping.xor(walk, footprints[1])) <= AREA_EPS, '步行实际面须完整覆盖明确边界。')
  const sorted = [...request.sources].sort((a, b) => b.coveragePriority - a.coveragePriority || a.id.localeCompare(b.id))
  const visible: { source: TerrainInlaySource; regions: MultiPolygon }[] = [], covered: MultiPolygon[] = []
  for (const source of sorted) {
    const raw = polygon(source.boundaryMm.map(p => p.positionMm))
    visible.push({ source, regions: covered.length ? polygonClipping.difference(raw, union(covered)) : raw }); covered.push(raw)
  }
  assert(area(polygonClipping.difference(actual, union(covered))) <= AREA_EPS, '完整填切越出明确源地形，不能以影子授予承托。')
  assert(visible.every(v => area(polygonClipping.intersection(actual, v.regions)) > AREA_EPS), '每个明确源面必须实际参与本次局部填切。')
  return { request, faces, actual, walk, visible }
}

/** Split a disposable cell at z=source elevation. This represents simultaneous
 * positive and negative volumes without inferring a whole-island rock base. */
function halfPlane(ring: PointMm[], delta: (p: PointMm) => number, sign: 1 | -1) {
  const result: PointMm[] = []
  for (const [a, b] of edges(ring)) {
    const da = delta(a) * sign, db = delta(b) * sign
    if (da >= -EPS) result.push(a)
    if (da * db < 0) result.push(mix(a, b, da / (da - db)))
  }
  return result.filter((p, i) => !i || length(p, result[i - 1]) > EPS)
}
function integral(ring: TerrainInlayPoint[], elevation: number) {
  // The signed polygon fan integrates an affine function exactly, including
  // concave rings. It is not a persisted triangulation or support shortcut.
  return ring.slice(1, -1).reduce((sum, b, i) => sum + cross(ring[0], b, ring[i + 2]) / 2
    * (ring[0].z + b.z + ring[i + 2].z - 3 * elevation) / 3, 0)
}

export function planTerrainInlay(input: TerrainInlayRequest): TerrainInlayPlan {
  const { request, faces, visible, actual, walk } = prepare(input)
  const cells: TerrainInlayCell[] = []
  let rawCellSegments = 0
  for (const face of faces) {
    const t = triangle(request, face), surface = affine(t)
    for (const { source, regions } of visible) for (const poly of polygonClipping.intersection(polygon(t), regions)) {
      assert(poly.length === 1, '首片局部填切不接受含孔的单片交差。')
      const raw = poly[0].map(([x, y]) => ({ x, y }))
      if (length(raw[0], raw.at(-1)!) <= EPS) raw.pop()
      if (signedArea(raw) < 0) raw.reverse()
      const delta = (p: PointMm) => surface.z(p) - source.groundElevationMm
      const allLevel = raw.every(p => Math.abs(delta(p)) <= EPS)
      for (const mode of allLevel ? ['level'] as const : ['fill', 'cut'] as const) {
        const ring = allLevel ? raw : halfPlane(raw, delta, mode === 'fill' ? 1 : -1)
        const cellArea = ring.length < 3 ? 0 : Math.abs(signedArea(ring))
        if (cellArea <= AREA_EPS) continue
        simple(ring)
        rawCellSegments += ring.length
        assert(rawCellSegments <= LIMITS.segments, '局部填切源交差超过完整线段保护值。')
        const ringMm = ring.map(p => ({ ...p, z: surface.z(p) }))
        cells.push({ sourceAreaId: source.id, faceId: face.id, kind: face.kind, mode,
          sourceElevationMm: source.groundElevationMm, ringMm, areaMm2: cellArea,
          volumeMm3: Math.abs(integral(ringMm, source.groundElevationMm)) })
      }
    }
  }
  assert(Math.abs(cells.reduce((s, c) => s + c.areaMm2, 0) - area(actual)) <= AREA_EPS, '完整源交差缺失或重叠。')
  // Recover original collinear source nodes that polygon boolean clipping can
  // merge, then use the SAME graph for wall ownership and source provenance.
  const nodes = new Map<string, PointMm>()
  const node = (p: PointMm) => { const k = key(p); if (!nodes.has(k)) nodes.set(k, { x: p.x, y: p.y }); return nodes.get(k)! }
  for (const c of cells) for (const p of c.ringMm) node(p)
  for (const s of request.sources) for (const p of s.boundaryMm) node(p.positionMm)
  const positions = [...nodes.values()]
  const planes = new Map(faces.map(f => [f.id, affine(triangle(request, f))]))
  const atomic = new Map<string, { a: PointMm; b: PointMm; cell: TerrainInlayCell }[]>()
  let edgeCount = 0
  for (const cell of cells) edgeCount += cell.ringMm.length
  assert(edgeCount <= LIMITS.segments && edgeCount * positions.length <= LIMITS.intersectionPairs, '局部填切排列超过有限点边工作预算。')
  for (const cell of cells) {
    const previous = cell.ringMm, noded: TerrainInlayPoint[] = []
    for (const [a, b] of edges(previous)) {
      const splits = positions.filter(p => on(p, a, b)).sort((p, q) => (p.x - q.x) * (b.x - a.x) + (p.y - q.y) * (b.y - a.y))
      assert(splits.length >= 2 && key(splits[0]) === key(a) && key(splits.at(-1)!) === key(b), '不能可靠切分真实源接缝。')
      for (let i = 1; i < splits.length; i++) {
        const a = splits[i - 1], b = splits[i], ka = key(a), kb = key(b), k = ka < kb ? ka + '|' + kb : kb + '|' + ka
        const entry = atomic.get(k) ?? []
        entry.push({ a, b, cell }); atomic.set(k, entry)
        assert(entry.length <= 2 && (entry.length === 1 || entry[0].a === b && entry[0].b === a), '局部填切存在非流形或反向共享边。')
        noded.push({ ...a, z: planes.get(cell.faceId)!.z(a) })
      }
    }
    cell.ringMm = noded
  }
  const materialBoundaries: TerrainInlayMaterialBoundary[] = [], sharedWalkApronEdges: TerrainInlayPlan['sharedWalkApronEdges'] = [], sourceIntervals: TerrainInlaySourceInterval[] = [], exposedWalls: TerrainInlayExposedWall[] = []
  const sourceLines = request.sources.flatMap(s => {
    const ccw = signedArea(s.boundaryMm.map(p => p.positionMm)) > 0
    return s.boundaryMm.map((p, i) => ({ source: s, segmentId: p.segmentId,
      a: p.positionMm, b: s.boundaryMm[(i + 1) % s.boundaryMm.length].positionMm, ccw }))
  })
  const atomicLines = [...atomic.values()].map(e => ({ a: e[0].a, b: e[0].b }))
  const proofLines = [...sourceLines, ...atomicLines]
  assert(atomic.size * proofLines.length <= LIMITS.intersectionPairs, '局部填切两侧及源接缝证明超过有限工作预算。')
  const originalSides = (a: PointMm, b: PointMm) => {
    const midpoint = mix(a, b, .5), span = length(a, b), normal = { x: -(b.y - a.y) / span, y: (b.x - a.x) / span }
    let offset = Math.min(.01, span / 100)
    for (const boundary of proofLines) {
      const dx = boundary.b.x - boundary.a.x, dy = boundary.b.y - boundary.a.y, t = Math.max(0, Math.min(1, ((midpoint.x - boundary.a.x) * dx + (midpoint.y - boundary.a.y) * dy) / (dx * dx + dy * dy)))
      const distance = length(midpoint, mix(boundary.a, boundary.b, t))
      if (distance > EPS) offset = Math.min(offset, distance / 4)
    }
    assert(offset > EPS, '源崖或实际边两侧间距过小，不能可靠证明邻面。')
    return { left: visible.find(v => contains(v.regions, { x: midpoint.x + normal.x * offset, y: midpoint.y + normal.y * offset }))?.source,
      right: visible.find(v => contains(v.regions, { x: midpoint.x - normal.x * offset, y: midpoint.y - normal.y * offset }))?.source }
  }
  for (const entries of atomic.values()) {
    const first = entries[0], { a, b, cell } = first, surface = planes.get(cell.faceId)!
    const original = originalSides(a, b)
    assert(original.left?.id === cell.sourceAreaId, '实际分片与边内侧的完整可见来源不一致。')
    if (entries.length === 2) {
      const other = planes.get(entries[1].cell.faceId)!
      assert(Math.abs(surface.z(a) - other.z(a)) <= EPS && Math.abs(surface.z(b) - other.z(b)) <= EPS, '实际路面及开口接缝高程不连续。')
      if (cell.kind !== entries[1].cell.kind) sharedWalkApronEdges.push({ a: { ...a, z: surface.z(a) }, b: { ...b, z: surface.z(b) } })
    } else if (cell.mode !== 'level') {
      materialBoundaries.push({ a, b, actualHeightMm: [surface.z(a), surface.z(b)], originalHeightMm: [cell.sourceElevationMm, cell.sourceElevationMm],
        sourceAreaId: cell.sourceAreaId, faceId: cell.faceId, kind: cell.mode })
    }
    if (entries.length === 1) {
      assert(original.right, '完整填切边外缺少明确可见地形，不能推断岩底或以材料侧界代替外露壁。')
      const outside = original.right, za = surface.z(a), zb = surface.z(b), deltaA = za - outside.groundElevationMm, deltaB = zb - outside.groundElevationMm
      const cuts = [0, 1]
      if (deltaA * deltaB < 0) cuts.splice(1, 0, deltaA / (deltaA - deltaB))
      for (let i = 1; i < cuts.length; i++) {
        const from = mix(a, b, cuts[i - 1]), to = mix(a, b, cuts[i]), span = length(from, to)
        const actualHeights: [number, number] = [surface.z(from), surface.z(to)], outsideHeights: [number, number] = [outside.groundElevationMm, outside.groundElevationMm]
        const middleDelta = surface.z(mix(from, to, .5)) - outside.groundElevationMm
        if (Math.abs(middleDelta) <= EPS || span <= EPS) continue
        const actualHigh = middleDelta > 0, highMm = actualHigh ? actualHeights : outsideHeights, lowMm = actualHigh ? outsideHeights : actualHeights
        assert(highMm.every((z, j) => z >= lowMm[j] - EPS), '外露壁高低交换未完整切分。')
        const ha = { ...from, z: highMm[0] }, hb = { ...to, z: highMm[1] }, la = { ...from, z: lowMm[0] }, lb = { ...to, z: lowMm[1] }
        exposedWalls.push({ a: from, b: to, high: actualHigh ? { kind: 'actual', faceId: cell.faceId } : { kind: 'source', areaId: outside.id },
          low: actualHigh ? { kind: 'source', areaId: outside.id } : { kind: 'actual', faceId: cell.faceId }, highMm, lowMm,
          normal: { x: (to.y - from.y) / span * (actualHigh ? 1 : -1) || 0, y: -(to.x - from.x) / span * (actualHigh ? 1 : -1) || 0 },
          verticesMm: actualHigh ? [ha, la, lb, hb] : [ha, hb, lb, la] })
      }
    }
    for (const line of sourceLines) if (on(a, line.a, line.b) && on(b, line.a, line.b)) {
      const direction = ((b.x - a.x) * (line.b.x - line.a.x) + (b.y - a.y) * (line.b.y - line.a.y)) > 0
      // A cell's CCW edge has its own material on the left. Original source
      // boundary winding decides which original area is inside that edge.
      const firstInside = direction === line.ccw, inside = entries.find((_, i) => (i === 0) === firstInside)?.cell
      const outside = entries.find((_, i) => (i === 0) !== firstInside)?.cell
      const originalInside = firstInside ? original.left : original.right, originalOutside = firstInside ? original.right : original.left
      if (originalInside?.id !== line.source.id) continue
      assert(originalOutside, '局部填切源边外侧缺少明确原地形，不能推断岩底。')
      const z = (c: TerrainInlayCell | undefined, p: PointMm, fallback: number) => c ? planes.get(c.faceId)!.z(p) : fallback
      sourceIntervals.push({ sourceAreaId: line.source.id, outsideSourceAreaId: originalOutside.id, sourceSegmentId: line.segmentId, a, b,
        originalInsideHeightMm: originalInside.groundElevationMm, originalOutsideHeightMm: originalOutside.groundElevationMm,
        insideHeightMm: [z(inside, a, originalInside.groundElevationMm), z(inside, b, originalInside.groundElevationMm)],
        outsideHeightMm: [z(outside, a, originalOutside.groundElevationMm), z(outside, b, originalOutside.groundElevationMm)],
        insideFaceId: inside?.faceId ?? null, outsideFaceId: outside?.faceId ?? null })
    }
  }
  return freezeJson({ cells, materialBoundaries, exposedWalls, sourceIntervals, sharedWalkApronEdges,
    fillVolumeMm3: cells.filter(c => c.mode === 'fill').reduce((s, c) => s + c.volumeMm3, 0),
    cutVolumeMm3: cells.filter(c => c.mode === 'cut').reduce((s, c) => s + c.volumeMm3, 0),
    footprintAreaMm2: area(actual), walkAreaMm2: area(walk) })
}

/** Development query on independently captured actual geometry. It does NOT
 * grant SceneDocument support, walkability, privacy or attachment proof. */
export function createTerrainInlaySampler(input: TerrainInlayRequest) {
  const owned = prepare(input), rows = owned.faces.map(face => ({ face, points: triangle(owned.request, face), surface: affine(triangle(owned.request, face)) }))
  return Object.freeze({ sample(rawPoint: PointMm, walkOnly = false) {
    const p = captureJson(rawPoint)
    assert(Number.isFinite(p.x) && Number.isFinite(p.y), '实际面查询须为有限坐标。')
    const hits = rows.filter(row => (!walkOnly || row.face.kind === 'walk') && faceContains(row.points, p))
    if (!hits.length) return null
    const zs = hits.map(row => row.surface.z(p))
    assert(Math.max(...zs) - Math.min(...zs) <= EPS, '查询命中了不连续实际面。')
    const chosen = hits.find(row => row.face.kind === 'walk') ?? hits[0]
    return freezeJson({ faceId: chosen.face.id, kind: chosen.face.kind, zMm: chosen.surface.z(p), normal: { ...chosen.surface.normal } })
  } })
}
