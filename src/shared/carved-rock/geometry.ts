import polygonClipping, { type MultiPolygon } from 'polygon-clipping'
import { z } from 'zod'
import type { IdSource } from '../ports/runtime.js'
import type { Issue, PointMm, SceneDocument, SurfaceRef } from '../model/scene.js'
import { captureJson, freezeJson } from '../validation/json.js'
import { CARVED_ROCK_LIMITS as LIMITS, carvedPointSchema, carvedStripSchema, rockBodySchema,
  type CarvedCutCell, type CarvedFace, type CarvedPointMm, type CarvedRockHost,
  type CarvedRockPatch, type CarvedSample, type CarvedStrip, type CreateCarvedStripIntent } from './contracts.js'

const EPS = 1e-7
const integer = z.number().finite().refine(Number.isSafeInteger)
const ident = z.string().min(1).max(256).refine(value => value !== '__proto__')
const intentSchema = z.object({ attachmentId: ident, walkSurfaceId: ident,
  sourceSegmentIds: z.array(ident).min(1).max(LIMITS.hostPoints), cutSide: z.enum(['left', 'right']),
  widthMm: integer.refine(value => value > 0 && value <= LIMITS.hostSpanMm),
  pointsMm: z.array(carvedPointSchema).min(2).max(LIMITS.stations),
}).strict()
const hostShape = z.object({ id: ident, floorId: ident, groundElevationMm: integer, rockBody: rockBodySchema,
  boundaryMm: z.array(z.object({ id: ident, segmentId: ident, positionMm: z.object({ x: integer, y: integer }).strict() }).strict()).min(4).max(LIMITS.hostPoints),
}).strict()

export const xy = (p: PointMm): PointMm => ({ x: p.x, y: p.y })
const same = (a: PointMm, b: PointMm) => a.x === b.x && a.y === b.y
const cross = (a: PointMm, b: PointMm, c: PointMm) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
const length = (a: PointMm, b: PointMm) => Math.hypot(b.x - a.x, b.y - a.y)
const at = (a: PointMm, b: PointMm, t: number) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
const edges = (p: readonly PointMm[]) => p.map((a, i) => [a, p[(i + 1) % p.length]] as const)
const ringArea = (p: readonly PointMm[]) => p.reduce((sum, a, i) => sum + cross(p[0], a, p[(i + 1) % p.length]), 0) / 2
export const carvedPolygon = (p: readonly PointMm[]): MultiPolygon => [[p.map(v => [v.x, v.y])]]
export const carvedArea = (multi: MultiPolygon): number => multi.reduce((sum, polygon) => sum + polygon.reduce((sub, ring, index) => {
  const area = Math.abs(ringArea(ring.map(([x, y]) => ({ x, y }))))
  return sub + (index ? -area : area)
}, 0), 0)
export const carvedUnion = (polygons: readonly MultiPolygon[]): MultiPolygon => polygons.length ? polygonClipping.union(polygons[0], ...polygons.slice(1)) : []
const onSegment = (p: PointMm, a: PointMm, b: PointMm) => Math.abs(cross(a, b, p)) <= EPS * Math.max(1, length(a, b))
  && p.x >= Math.min(a.x, b.x) - EPS && p.x <= Math.max(a.x, b.x) + EPS && p.y >= Math.min(a.y, b.y) - EPS && p.y <= Math.max(a.y, b.y) + EPS
const meet = (a: PointMm, b: PointMm, c: PointMm, d: PointMm) => {
  const abC = cross(a, b, c), abD = cross(a, b, d), cdA = cross(c, d, a), cdB = cross(c, d, b)
  return abC * abD < 0 && cdA * cdB < 0 || onSegment(c, a, b) || onSegment(d, a, b) || onSegment(a, c, d) || onSegment(b, c, d)
}
export function carvedContains(polygon: readonly PointMm[], p: PointMm, boundary = true): boolean {
  let inside = false
  for (const [a, b] of edges(polygon)) {
    if (onSegment(p, a, b)) return boundary
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}
function simple(p: readonly PointMm[], label: string) {
  if (p.length < 3 || Math.abs(ringArea(p)) <= EPS) throw Error(`${label}不能为零面积。`)
  for (let i = 0; i < p.length; i++) {
    if (same(p[i], p[(i + 1) % p.length])) throw Error(`${label}不能含零长边。`)
    for (let j = i + 1; j < p.length; j++) {
      if (j === i + 1 || i === 0 && j === p.length - 1) continue
      if (meet(p[i], p[(i + 1) % p.length], p[j], p[(j + 1) % p.length])) throw Error(`${label}自交、接触或回折过近。`)
    }
  }
}
/** A typed scene still crosses an ownership boundary before geometry is read. */
export function captureCarvedRockHost(input: CarvedRockHost): CarvedRockHost {
  const source = captureJson(input)
  const host = hostShape.parse({ id: source.id, floorId: source.floorId, boundaryMm: source.boundaryMm,
    groundElevationMm: source.groundElevationMm, rockBody: source.rockBody })
  const points = host.boundaryMm.map(p => p.positionMm)
  const values = points.flatMap(p => [p.x, p.y]).concat(host.groundElevationMm, host.rockBody.baseElevationMm)
  if (values.some(v => Math.abs(v) > LIMITS.coordinateAbsMm)) throw Error('岩体坐标超过有限范围。')
  if (Math.max(...points.map(p => p.x)) - Math.min(...points.map(p => p.x)) > LIMITS.hostSpanMm
    || Math.max(...points.map(p => p.y)) - Math.min(...points.map(p => p.y)) > LIMITS.hostSpanMm) throw Error('首片岩体跨度超过1000米预算。')
  if (host.rockBody.baseElevationMm >= host.groundElevationMm) throw Error('岩体底高必须严格低于顶高。')
  if (new Set(host.boundaryMm.flatMap(p => [p.id, p.segmentId])).size !== 2 * points.length) throw Error('岩体点/边稳定 ID 不能重复。')
  simple(points, '岩体轮廓')
  return host
}
interface SourceChain { start: PointMm; end: PointMm; tangent: PointMm; outward: PointMm; length: number }
function sourceChain(host: CarvedRockHost, ids: readonly string[]): SourceChain {
  if (!ids.length || new Set(ids).size !== ids.length) throw Error('切削须明确选择不重复的连续源边链。')
  const ring = host.boundaryMm, first = ring.findIndex(p => p.segmentId === ids[0])
  if (first < 0 || ids.some((id, i) => ring[(first + i) % ring.length].segmentId !== id)) throw Error('岩体源边链必须按真实有向邻接连续。')
  const start = ring[first].positionMm, end = ring[(first + ids.length) % ring.length].positionMm
  if (same(start, end) || start.x !== end.x && start.y !== end.y) throw Error('首片仅支持连续共线的正交崖面源边链。')
  const span = length(start, end), tangent = { x: (end.x - start.x) / span, y: (end.y - start.y) / span }
  for (let i = 0; i < ids.length; i++) {
    const a = ring[(first + i) % ring.length].positionMm, b = ring[(first + i + 1) % ring.length].positionMm
    if (Math.abs(cross(start, end, a)) > EPS || (b.x - a.x) * tangent.x + (b.y - a.y) * tangent.y <= 0) throw Error('首片崖面源边不得折返或转角。')
  }
  const ccw = ringArea(ring.map(p => p.positionMm)) > 0
  return { start, end, tangent, length: span, outward: ccw ? { x: tangent.y, y: -tangent.x } : { x: -tangent.y, y: tangent.x } }
}
function projected(source: SourceChain, p: CarvedPointMm): CarvedPointMm {
  const distance = (p.x - source.start.x) * source.tangent.x + (p.y - source.start.y) * source.tangent.y
  if (distance < -EPS || distance > source.length + EPS) throw Error('岩台外侧射线超出所选真实源崖范围。')
  const result = { x: source.start.x + source.tangent.x * distance, y: source.start.y + source.tangent.y * distance, z: p.z }
  if (![result.x, result.y].every(Number.isSafeInteger)) throw Error('源崖开口不能产生非整数持久端点。')
  const inward = (p.x - result.x) * source.outward.x + (p.y - result.y) * source.outward.y
  if (inward > EPS) throw Error('山路伸出原岩体，不支持用托架补齐。')
  return result
}
const triangle = (strip: CarvedStrip, id: string): [CarvedPointMm, CarvedPointMm, CarvedPointMm] => strip.faces[id].vertexIds.map(key => strip.verticesMm[key]) as [CarvedPointMm, CarvedPointMm, CarvedPointMm]
const stationPoint = (strip: CarvedStrip, index: number) => strip.verticesMm[strip.stations[index].centerVertexId]
const footprintOwned = (strip: CarvedStrip): PointMm[] => [...strip.stations.map(row => xy(strip.verticesMm[row.leftVertexId])), ...[...strip.stations].reverse().map(row => xy(strip.verticesMm[row.rightVertexId]))]
const cutFootprintsOwned = (strip: CarvedStrip) => strip.cutCells.map(cell => triangle(strip, cell.lowerFaceId).map(xy))
function sampleFace(points: readonly CarvedPointMm[], p: PointMm): Omit<CarvedSample, 'inside' | 'faceId'> | null {
  const [a, b, c] = points, determinant = cross(a, b, c)
  if (determinant <= EPS) throw Error('实际步行面必须有正面积和一致朝上的顶点顺序。')
  const u = cross(p, b, c) / determinant, v = cross(a, p, c) / determinant, w = 1 - u - v
  if (u < -EPS || v < -EPS || w < -EPS) return null
  const nx = (b.y - a.y) * (c.z - a.z) - (b.z - a.z) * (c.y - a.y)
  const ny = (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z)
  const normalLength = Math.hypot(nx, ny, determinant)
  return { zMm: u * a.z + v * b.z + w * c.z, normal: { x: nx / normalLength, y: ny / normalLength, z: determinant / normalLength } }
}
function routeChecks(strip: CarvedStrip, host?: CarvedRockHost) {
  const points = strip.stations.map((_, i) => stationPoint(strip, i)), footprint = footprintOwned(strip)
  simple(footprint, '山路完整净宽带')
  if (strip.stations[0].sMm !== 0) throw Error('山路首站弧长必须为0。')
  let station = 0
  for (let i = 0; i < points.length; i++) {
    const row = strip.stations[i], c = points[i], left = strip.verticesMm[row.leftVertexId], right = strip.verticesMm[row.rightVertexId]
    if (left.z !== c.z || right.z !== c.z || left.x + right.x !== 2 * c.x || left.y + right.y !== 2 * c.y) throw Error('首片左右接触面须零横坡且围绕真实中心对称。')
    if (length(left, right) < strip.widthMm || length(c, left) > 2 * (Math.ceil(strip.widthMm / 2) + 2) + EPS) throw Error('真实站点宽度不足或转角超过miter2范围。')
    if (i) {
      const a = points[i - 1], span = length(a, c)
      if (span <= 0) throw Error('路线不能含零长段。')
      // Sampling density is not a reversal. Keep every authored station and
      // let the actual full-width band and complete triangle checks below
      // reject folds, overlaps, missing coverage and insufficient clearance.
      station += span
      if (row.sMm !== Math.round(station) || row.sMm <= strip.stations[i - 1].sMm) throw Error('保存弧长站点与完整实际路线不一致。')
      for (const index of [i - 1, i]) {
        const l = strip.verticesMm[strip.stations[index].leftVertexId], r = strip.verticesMm[strip.stations[index].rightVertexId]
        if (cross(a, c, l) / span < strip.widthMm / 2 - EPS || -cross(a, c, r) / span < strip.widthMm / 2 - EPS) throw Error('量化后的完整路段实际净宽不足。')
      }
    }
  }
  const walkPolygons = strip.walkFaceIds.map(id => carvedPolygon(triangle(strip, id)))
  // This algorithm's complete physical triangulation is explicit. Importers
  // may not smuggle extra bumps, disconnected vertices or T-junction heights
  // into a zero-crossfall strip whose station witnesses still look plausible.
  const triangleKey = (ids: readonly string[]) => JSON.stringify([...ids].sort())
  const expectedWalk = new Set<string>()
  for (let i = 1; i < strip.stations.length; i++) {
    const a = strip.stations[i - 1], b = strip.stations[i]
    for (const ids of [[a.leftVertexId, a.centerVertexId, b.centerVertexId], [a.leftVertexId, b.centerVertexId, b.leftVertexId],
      [a.centerVertexId, a.rightVertexId, b.rightVertexId], [a.centerVertexId, b.rightVertexId, b.centerVertexId]]) expectedWalk.add(triangleKey(ids))
  }
  for (const id of strip.walkFaceIds) if (!expectedWalk.delete(triangleKey(strip.faces[id].vertexIds))) throw Error('步行实际三角片须与相邻完整零横坡站点精确对应。')
  if (expectedWalk.size) throw Error('保存步行几何缺少相邻站点的完整实际三角片。')
  for (const id of Object.keys(strip.faces)) if (cross(...triangle(strip, id)) <= EPS) throw Error('实际面片不能退化、反转或互相折叠。')
  const walk = carvedUnion(walkPolygons), actualArea = walkPolygons.reduce((sum, p) => sum + carvedArea(p), 0)
  if (Math.abs(actualArea - carvedArea(walk)) > EPS || carvedArea(polygonClipping.xor(walk, carvedPolygon(footprint))) > EPS) throw Error('完整步行面必须无缝、无叠面地覆盖真实净宽带。')
  if (Object.keys(strip.verticesMm).some(id => !Object.values(strip.faces).some(face => face.vertexIds.includes(id)))) throw Error('不能保存未参与实际面的孤立顶点。')
  // Every shared XY boundary must have the same materialized height, even when
  // an importer attempts to supply different IDs for coincident vertices.
  const heights = new Map<string, number>()
  for (const p of Object.values(strip.verticesMm)) {
    const key = `${p.x},${p.y}`, previous = heights.get(key)
    if (previous !== undefined) throw Error('相邻步行/切削面须引用同一共享XYZ节点，不能复制或断开共同节点。')
    heights.set(key, p.z)
  }
  if (!host) return
  if (strip.hostAreaId !== host.id) throw Error('山路宿主与当前岩体不一致。')
  const hostIds = new Set(host.boundaryMm.flatMap(p => [p.id, p.segmentId]))
  if ([strip.attachmentId, strip.walkSurfaceId, ...Object.keys(strip.verticesMm), ...Object.keys(strip.faces),
    ...strip.stations.map(row => row.id), ...strip.cutCells.map(row => row.id)].some(id => hostIds.has(id))) throw Error('山路或关系不能复用岩体真实点边的稳定ID。')
  const source = sourceChain(host, strip.sourceSegmentIds), outerKey = strip.cutSide === 'left' ? 'leftVertexId' : 'rightVertexId'
  let sign = 0
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], dx = b.x - a.x, dy = b.y - a.y, along = dx * source.tangent.x + dy * source.tangent.y
    if (Math.abs(along) <= EPS) {
      const outwardStep = dx * source.outward.x + dy * source.outward.y
      const endpoint = i === 1 && outwardStep < 0 ? a : i === points.length - 1 && outwardStep > 0 ? b : null
      const onSource = endpoint && Math.abs((endpoint.x - source.start.x) * source.outward.x + (endpoint.y - source.start.y) * source.outward.y) <= EPS
      if (!onSource || a.z !== b.z) throw Error('垂源崖路段只允许完整端截面在真实边界上的等高入口/出口。')
      continue
    }
    if (sign && Math.sign(along) !== sign) throw Error('首片沿崖路线必须单向推进，不能回折。')
    sign = Math.sign(along)
    const side = strip.cutSide === 'left' ? 1 : -1
    if ((-dy * source.outward.x + dx * source.outward.y) * side / Math.hypot(dx, dy) < .6) throw Error('所选山路外侧不朝向真实源崖，不能暗改切入侧。')
  }
  if (!sign) throw Error('连续山路须有明确沿崖推进段，不能仅以垂源崖走廊冒充。')
  const expectedAprons: MultiPolygon[] = [], allowedApronVertices = new Set<string>(), expectedApronFaces = new Set<string>()
  const vertexKey = (p: CarvedPointMm) => `${p.x},${p.y},${p.z}`
  const apronFaceKey = (points: readonly CarvedPointMm[]) => points.map(vertexKey).sort().join('\u0000')
  for (let i = 1; i < strip.stations.length; i++) {
    const a = strip.verticesMm[strip.stations[i - 1][outerKey]], b = strip.verticesMm[strip.stations[i][outerKey]], qa = projected(source, a), qb = projected(source, b)
    const progress = (qb.x - qa.x) * source.tangent.x + (qb.y - qa.y) * source.tangent.y
    const area = Math.abs(ringArea([a, qa, qb, b]))
    if (progress * sign < -EPS || Math.abs(progress) <= EPS && (area > EPS || a.z !== b.z)) throw Error('山路外侧开口折返或射线交叠。')
    for (const p of [a, b, qa, qb]) allowedApronVertices.add(vertexKey(p))
    if (area > EPS) expectedAprons.push(carvedPolygon([a, qa, qb, b]))
    for (const t of [[a, qa, qb], [a, qb, b]]) if (Math.abs(cross(t[0], t[1], t[2])) > EPS) expectedApronFaces.add(apronFaceKey(t))
  }
  const aprons = strip.cutCells.filter(cell => cell.kind === 'apron').map(cell => {
    const p = triangle(strip, cell.lowerFaceId)
    if (p.some(v => !allowedApronVertices.has(vertexKey(v)))) throw Error('外侧切削下表面须精确连接真实路肩与源崖，不得伪造外扩。')
    if (!expectedApronFaces.delete(apronFaceKey(p))) throw Error('实际外侧切削三角片不能跨站点重排或隐式变更高程。')
    return carvedPolygon(p)
  })
  const apron = carvedUnion(aprons), expectedApron = carvedUnion(expectedAprons)
  if (expectedApronFaces.size) throw Error('实际外侧切削缺少完整源崖开口面。')
  if (carvedArea(polygonClipping.xor(apron, expectedApron)) > EPS || Math.abs(aprons.reduce((sum, p) => sum + carvedArea(p), 0) - carvedArea(apron)) > EPS) throw Error('外侧实际开口必须完整无缝且不重叠，不能只在绘制时擦除崖壁。')
  if (carvedArea(polygonClipping.intersection(walk, apron)) > EPS) throw Error('岩台外侧切削与净宽步行带不能重叠折返。')
  const cuts = carvedUnion([walk, apron]), hostPolygon = carvedPolygon(host.boundaryMm.map(row => row.positionMm))
  if (carvedArea(polygonClipping.difference(cuts, hostPolygon)) > EPS) throw Error('山路完整净宽/切削体越出原岩体，不能以侧影伪造支撑。')
  if (Object.values(strip.verticesMm).some(p => p.z <= host.rockBody.baseElevationMm || p.z > host.groundElevationMm)) throw Error('切削下表面必须高于真实岩底且不高于岩顶。')
}

/** Pure finite preparation. All actual geometry is saved; no caller witness,
 * scene mutation, DOM, random/global ID source or seed-only storage is used. */
export function createCarvedStrip(hostInput: CarvedRockHost, input: CreateCarvedStripIntent, context: { ids: IdSource }): CarvedStrip {
  const host = captureCarvedRockHost(hostInput), intent = intentSchema.parse(captureJson(input)), source = sourceChain(host, intent.sourceSegmentIds)
  if (new Set([host.id, intent.attachmentId, intent.walkSurfaceId]).size !== 3) throw Error('宿主、附着与步行表面须具有不同ID。')
  const points = intent.pointsMm, radius = Math.ceil(intent.widthMm / 2) + 2
  const directions = points.slice(1).map((p, i) => {
    const span = length(points[i], p)
    if (!span) throw Error('山路路线不能含零长段。')
    return { x: (p.x - points[i].x) / span, y: (p.y - points[i].y) / span }
  })
  const used = new Set([host.id, intent.attachmentId, intent.walkSurfaceId, ...host.boundaryMm.flatMap(p => [p.id, p.segmentId])])
  const fresh = () => {
    const value = ident.parse(context.ids.nextId())
    if (used.has(value)) throw Error('准备器分配了重复或已占用岩体身份。')
    used.add(value); return value
  }
  const vertices: CarvedStrip['verticesMm'] = {}, faces: Record<string, CarvedFace> = {}, walkFaceIds: string[] = [], cutCells: CarvedCutCell[] = []
  const vertexIds = new Map<string, string>()
  const vertex = (p: CarvedPointMm) => {
    carvedPointSchema.parse(p)
    const key = `${p.x},${p.y},${p.z}`, known = vertexIds.get(key)
    if (known) return known
    const id = fresh(); vertices[id] = { ...p }; vertexIds.set(key, id); return id
  }
  let distance = 0
  const stations = points.map((c, i) => {
    const before = directions[Math.max(0, i - 1)], after = directions[Math.min(i, directions.length - 1)]
    const denominator = 1 + before.x * after.x + before.y * after.y
    if (denominator <= .5) throw Error('山路转角超过miter2范围；首片不猜测锐角倒角。')
    const offset = { x: Math.round((-before.y - after.y) * radius / denominator), y: Math.round((before.x + after.x) * radius / denominator) }
    if (i) distance += length(points[i - 1], c)
    return { id: fresh(), sMm: Math.round(distance), centerVertexId: vertex(c),
      leftVertexId: vertex({ x: c.x + offset.x, y: c.y + offset.y, z: c.z }),
      rightVertexId: vertex({ x: c.x - offset.x, y: c.y - offset.y, z: c.z }), state: 'managed' as const }
  })
  const add = (ids: [string, string, string], kind: 'walk' | 'apron') => {
    const area = cross(vertices[ids[0]], vertices[ids[1]], vertices[ids[2]])
    if (Math.abs(area) <= EPS) return
    if (area < 0) ids = [ids[0], ids[2], ids[1]]
    const id = fresh(); faces[id] = { id, vertexIds: ids }
    cutCells.push({ id: fresh(), lowerFaceId: id, sourceAreaId: host.id, kind })
    if (kind === 'walk') walkFaceIds.push(id)
  }
  for (let i = 1; i < stations.length; i++) {
    const a = stations[i - 1], b = stations[i]
    add([a.leftVertexId, a.centerVertexId, b.centerVertexId], 'walk'); add([a.leftVertexId, b.centerVertexId, b.leftVertexId], 'walk')
    add([a.centerVertexId, a.rightVertexId, b.rightVertexId], 'walk'); add([a.centerVertexId, b.rightVertexId, b.centerVertexId], 'walk')
    const outer = intent.cutSide === 'left' ? 'leftVertexId' : 'rightVertexId', pa = vertices[a[outer]], pb = vertices[b[outer]]
    const qa = vertex(projected(source, pa)), qb = vertex(projected(source, pb))
    add([a[outer], qa, qb], 'apron'); add([a[outer], qb, b[outer]], 'apron')
  }
  const strip: CarvedStrip = carvedStripSchema.parse({ algorithmId: 'carved-strip1', algorithmVersion: 1,
    hostAreaId: host.id, attachmentId: intent.attachmentId, walkSurfaceId: intent.walkSurfaceId,
    sourceSegmentIds: intent.sourceSegmentIds, cutSide: intent.cutSide, widthMm: intent.widthMm,
    stations, verticesMm: vertices, faces, walkFaceIds, cutCells })
  routeChecks(strip, host)
  return freezeJson(strip)
}

export function createCarvedStripSampler(input: CarvedStrip) {
  const strip = freezeJson(carvedStripSchema.parse(input))
  routeChecks(strip)
  const footprint = freezeJson(footprintOwned(strip)), cutFootprints = freezeJson(cutFootprintsOwned(strip))
  return Object.freeze({ strip, footprint, cutFootprints,
    sample(point: PointMm): CarvedSample | null {
      const p = captureJson(point)
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) throw Error('支撑查询坐标须有限。')
      for (const id of strip.walkFaceIds) {
        const value = sampleFace(triangle(strip, id), p)
        if (value) return { inside: true, faceId: id, ...value }
      }
      return null
    },
    sampleCut(point: PointMm): (CarvedSample & { kind: 'walk' | 'apron' }) | null {
      const p = captureJson(point)
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) throw Error('切削查询坐标须有限。')
      for (const kind of ['walk', 'apron'] as const) for (const cell of strip.cutCells) {
        if (cell.kind !== kind) continue
        const value = sampleFace(triangle(strip, cell.lowerFaceId), p)
        if (value) return { inside: true, faceId: cell.lowerFaceId, kind, ...value }
      }
      return null
    },
  })
}
export function sampleCarvedStrip(strip: CarvedStrip, point: PointMm): CarvedSample | null { return createCarvedStripSampler(strip).sample(point) }
export function sampleCarvedCut(strip: CarvedStrip, point: PointMm) { return createCarvedStripSampler(strip).sampleCut(point) }
export function carvedStripFootprint(strip: CarvedStrip): PointMm[] { return footprintOwned(carvedStripSchema.parse(strip)) }
export function carvedStripCenterline(strip: CarvedStrip): PointMm[] { const parsed = carvedStripSchema.parse(strip); return parsed.stations.map((_, i) => xy(stationPoint(parsed, i))) }
export function carvedStripCutFootprints(strip: CarvedStrip): PointMm[][] { return cutFootprintsOwned(carvedStripSchema.parse(strip)) }
export function inspectCarvedStripHost(inputHost: CarvedRockHost, input: CarvedStrip): Issue[] {
  try { routeChecks(carvedStripSchema.parse(input), captureCarvedRockHost(inputHost)); return [] }
  catch (error) { return [{ code: 'CARVED_STRIP_INVALID', message: error instanceof Error ? error.message : String(error) }] }
}
export interface CarvedConnectionLike {
  id: string; floorId: string; kind: 'stairs' | 'ramp'; widthMm: number; route?: unknown; carvedStrip?: CarvedStrip
  from: { surfaceRef: SurfaceRef; positionMm: PointMm }; to: { surfaceRef: SurfaceRef; positionMm: PointMm }
}
function data<T>(value: unknown, key: string): T | undefined {
  if (!value || typeof value !== 'object') return undefined
  const descriptor = Object.getOwnPropertyDescriptor(value, key)
  if (!descriptor) return undefined
  if (!('value' in descriptor) || !descriptor.enumerable) throw Error('岩体依赖不接受访问器或隐藏字段。')
  return descriptor.value as T
}
/** Finite host/strip physical proof. Owning scene validation still proves all
 * endpoint approaches, obstacles, identity, locks, resources and transaction CAS. */
export function inspectCarvedStrip(scene: Pick<SceneDocument, 'terrainAreas' | 'floors' | 'rooms' | 'terrainConnections'>, inputConnection: CarvedConnectionLike): Issue[] {
  try {
    const connection = captureJson(inputConnection), strip = connection.carvedStrip
    if (!strip) return []
    if (connection.kind !== 'ramp' || connection.route !== undefined) throw Error('实际连续岩台仅用于ramp且与旧route互斥。')
    const parsed = carvedStripSchema.parse(strip), area = data<CarvedRockHost>(data(scene, 'terrainAreas'), parsed.hostAreaId)
    if (!area) throw Error('实际岩体宿主不存在。')
    const host = captureCarvedRockHost(area)
    if (host.floorId !== connection.floorId || parsed.widthMm !== connection.widthMm) throw Error('山路须与宿主同Floor并保存相同明确净宽。')
    routeChecks(parsed, host)
    for (const [index, end] of [[0, connection.from], [parsed.stations.length - 1, connection.to]] as const) {
      const p = stationPoint(parsed, index)
      if (!same(p, end.positionMm)) throw Error('保存山路首尾必须精确等于连接端点。')
      const collection = end.surfaceRef.kind === 'floor' ? 'floors' : end.surfaceRef.kind === 'room' ? 'rooms' : 'terrainAreas'
      const rawRef = data<{ id: string; floorId?: string; groundElevationMm?: number }>(data(scene, collection), end.surfaceRef.id)
      const ref = rawRef && captureJson(rawRef)
      if (!ref || (end.surfaceRef.kind === 'floor' ? ref.id !== connection.floorId : ref.floorId !== connection.floorId)) throw Error('山路端点必须引用现存同Floor的真实根基面。')
      const elevation = end.surfaceRef.kind === 'floor' ? 0 : ref.groundElevationMm
      if (p.z !== elevation) throw Error('实际连续山路端高必须精确接上声明支撑高程。')
    }
    let siblings = 0
    const ownCuts = carvedUnion(cutFootprintsOwned(parsed).map(carvedPolygon))
    const connections = captureJson(data<Record<string, unknown>>(scene, 'terrainConnections') ?? {})
    for (const raw of Object.values(connections)) {
      const otherId = data<string>(raw, 'id'), other = data<CarvedStrip>(raw, 'carvedStrip')
      if (!other || otherId === connection.id || data(other, 'hostAreaId') !== host.id) continue
      if (++siblings >= LIMITS.strips) throw Error('单岩体连续切口超过有限预算。')
      const validOther = carvedStripSchema.parse(other)
      if (carvedArea(polygonClipping.intersection(ownCuts, carvedUnion(cutFootprintsOwned(validOther).map(carvedPolygon)))) > EPS) throw Error('首片不支持同岩体切口交叠或交叉。')
    }
    return []
  } catch (error) { return [{ code: 'CARVED_STRIP_INVALID', message: error instanceof Error ? error.message : String(error), entityId: data<string>(inputConnection, 'id') }] }
}

export function carvedStripPatches(input: CarvedStrip): CarvedRockPatch[] {
  const strip = carvedStripSchema.parse(input)
  return strip.cutCells.map(cell => ({ surfaceId: cell.kind === 'walk' ? strip.walkSurfaceId : strip.hostAreaId,
    faceId: cell.lowerFaceId, kind: cell.kind, verticesMm: triangle(strip, cell.lowerFaceId).map(p => ({ ...p })) as CarvedRockPatch['verticesMm'] }))
}

/** Exact rigid XY follow of already materialized geometry. No regenerated
 * control points, lost manual edits, topology repair or implicit height move. */
export function followCarvedStrip(beforeInput: CarvedRockHost, afterInput: CarvedRockHost, input: CarvedStrip): CarvedStrip {
  const before = captureCarvedRockHost(beforeInput), after = captureCarvedRockHost(afterInput), strip = carvedStripSchema.parse(input)
  routeChecks(strip, before)
  if (before.id !== after.id || before.floorId !== after.floorId || before.groundElevationMm !== after.groundElevationMm
    || before.rockBody.baseElevationMm !== after.rockBody.baseElevationMm || before.boundaryMm.length !== after.boundaryMm.length) throw Error('首片嵌入随动只支持同拓扑、同高程岩体的刚性XY平移。')
  const corresponding = after.boundaryMm.find(p => p.id === before.boundaryMm[0].id)
  if (!corresponding) throw Error('岩体源点拓扑改变，不能重新绑定旧切口。')
  const dx = corresponding.positionMm.x - before.boundaryMm[0].positionMm.x, dy = corresponding.positionMm.y - before.boundaryMm[0].positionMm.y
  for (let i = 0; i < before.boundaryMm.length; i++) {
    const b = before.boundaryMm[i], a = after.boundaryMm.find(p => p.id === b.id)
    if (!a || a.segmentId !== b.segmentId || a.positionMm.x - b.positionMm.x !== dx || a.positionMm.y - b.positionMm.y !== dy) throw Error('岩体局部编辑不能作为刚性平移覆盖人工山路。')
    const next = after.boundaryMm[(after.boundaryMm.indexOf(a) + 1) % after.boundaryMm.length]
    if (next.id !== before.boundaryMm[(i + 1) % before.boundaryMm.length].id) throw Error('岩体有向源边拓扑改变，不能续用旧附着。')
  }
  for (const p of Object.values(strip.verticesMm)) { p.x += dx; p.y += dy }
  const checked = carvedStripSchema.parse(strip)
  routeChecks(checked, after)
  return freezeJson(checked)
}

/** Internal helpers shared by the materializer. They never grant scene proof. */
export const carvedRockGeometry = Object.freeze({ triangle, sampleFace, routeChecks, edges, at, cross, onSegment, ringArea })
