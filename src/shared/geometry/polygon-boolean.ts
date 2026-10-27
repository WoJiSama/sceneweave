// polygon-clipping publishes its ESM implementation as a default operation
// object; keep the type import separate because its declaration file exposes
// the operations as named exports.
import polygonClipping, { type MultiPolygon } from 'polygon-clipping'
import type { PointMm } from '../model/scene.js'
import { captureJson } from '../validation/json.js'

export type PolygonBooleanOperation = 'union' | 'difference' | 'intersection'

export interface PolygonBooleanRequest {
  operation: PolygonBooleanOperation
  /** Every ring is an independent filled polygon. Rings are never implicit holes. */
  subject: PointMm[][]
  clip: PointMm[][]
}
export interface PolygonWithHoles {
  outer: PointMm[]
  holes: PointMm[][]
}
export interface PolygonBooleanResult {
  polygons: PolygonWithHoles[]
  vertexCount: number
}

export const POLYGON_BOOLEAN_LIMITS = Object.freeze({
  maxRings: 128,
  maxPoints: 8192,
  maxOutputPoints: 8192,
  minCoordinateMm: -1_000_000_000,
  maxCoordinateMm: 1_000_000_000,
})

const EPS = 1e-8
type FloatPoint = [number, number]
type FloatRing = FloatPoint[]

const fail = (message: string): never => { throw new Error(`多边形布尔运算拒绝: ${message}`) }
const ownKeys = (value: object): string[] => Object.keys(value)
const signedArea2 = (ring: PointMm[]): bigint => {
  let value = 0n
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length]
    value += BigInt(a.x) * BigInt(b.y) - BigInt(b.x) * BigInt(a.y)
  }
  return value
}
const cross = (a: PointMm, b: PointMm, c: PointMm): bigint => BigInt(b.x - a.x) * BigInt(c.y - a.y) - BigInt(b.y - a.y) * BigInt(c.x - a.x)
const same = (a: PointMm, b: PointMm): boolean => a.x === b.x && a.y === b.y
const between = (a: PointMm, b: PointMm, p: PointMm): boolean => p.x >= Math.min(a.x, b.x) && p.x <= Math.max(a.x, b.x) && p.y >= Math.min(a.y, b.y) && p.y <= Math.max(a.y, b.y)
const onSegment = (a: PointMm, b: PointMm, p: PointMm): boolean => cross(a, b, p) === 0n && between(a, b, p)
const sign = (v: bigint): number => v < 0n ? -1 : v > 0n ? 1 : 0
const intersects = (a: PointMm, b: PointMm, c: PointMm, d: PointMm): boolean => {
  const abC = sign(cross(a, b, c)), abD = sign(cross(a, b, d)), cdA = sign(cross(c, d, a)), cdB = sign(cross(c, d, b))
  if (abC === 0 && onSegment(a, b, c)) return true
  if (abD === 0 && onSegment(a, b, d)) return true
  if (cdA === 0 && onSegment(c, d, a)) return true
  if (cdB === 0 && onSegment(c, d, b)) return true
  return abC !== abD && cdA !== cdB
}

function validateInputRing(raw: unknown, ringIndex: number): PointMm[] {
  if (!Array.isArray(raw) || raw.length < 3 || raw.length > POLYGON_BOOLEAN_LIMITS.maxPoints) fail(`第${ringIndex + 1}个环顶点数必须为3..${POLYGON_BOOLEAN_LIMITS.maxPoints}。`)
  const points = raw as unknown[]
  const ring: PointMm[] = points.map((rawPoint: unknown, pointIndex: number) => {
    if (rawPoint === null || typeof rawPoint !== 'object' || Array.isArray(rawPoint)) fail(`第${ringIndex + 1}个环的第${pointIndex + 1}点不是普通对象。`)
    const point = rawPoint as Record<string, unknown>
    if (ownKeys(point).length !== 2 || !Object.hasOwn(point, 'x') || !Object.hasOwn(point, 'y')) fail(`第${ringIndex + 1}个环的点必须只含x、y。`)
    const x = point.x, y = point.y
    if (typeof x !== 'number' || typeof y !== 'number' || !Number.isSafeInteger(x) || !Number.isSafeInteger(y)) fail(`第${ringIndex + 1}个环含非安全整数坐标。`)
    const nx = x as number, ny = y as number
    if (nx < POLYGON_BOOLEAN_LIMITS.minCoordinateMm || nx > POLYGON_BOOLEAN_LIMITS.maxCoordinateMm || ny < POLYGON_BOOLEAN_LIMITS.minCoordinateMm || ny > POLYGON_BOOLEAN_LIMITS.maxCoordinateMm) fail(`第${ringIndex + 1}个环坐标超过±1e9mm。`)
    return { x: nx, y: ny }
  })
  if (same(ring[0], ring[ring.length - 1])) fail(`第${ringIndex + 1}个环不能重复闭合首点。`)
  if (new Set(ring.map(point => `${point.x}\0${point.y}`)).size !== ring.length) fail(`第${ringIndex + 1}个环不能重复顶点。`)
  const area = signedArea2(ring)
  if (area === 0n) fail(`第${ringIndex + 1}个环面积不能为零。`)
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length], c = ring[(i + 2) % ring.length]
    if (same(a, b)) fail(`第${ringIndex + 1}个环不能含零长边。`)
    // A consecutive reversal is a backtrack even when its endpoints differ.
    if (cross(a, b, c) === 0n && (BigInt(b.x - a.x) * BigInt(c.x - b.x) + BigInt(b.y - a.y) * BigInt(c.y - b.y) <= 0n)) fail(`第${ringIndex + 1}个环不能回折或自接触。`)
  }
  const edges = ring.map((point, i) => [point, ring[(i + 1) % ring.length]] as const)
  for (let i = 0; i < edges.length; i++) for (let j = i + 1; j < edges.length; j++) {
    if (j === i + 1 || (i === 0 && j === edges.length - 1)) continue
    if (intersects(edges[i][0], edges[i][1], edges[j][0], edges[j][1])) fail(`第${ringIndex + 1}个环存在自相交或自接触。`)
  }
  return ring
}

function validateRequest(raw: unknown): PolygonBooleanRequest {
  const owned = captureJson(raw) as unknown
  if (owned === null || typeof owned !== 'object' || Array.isArray(owned)) fail('请求必须是普通对象。')
  const request = owned as Record<string, unknown>
  if (ownKeys(request).length !== 3 || !Object.hasOwn(request, 'operation') || !Object.hasOwn(request, 'subject') || !Object.hasOwn(request, 'clip')) fail('请求只能含operation、subject、clip。')
  if (request.operation !== 'union' && request.operation !== 'difference' && request.operation !== 'intersection') fail('不支持的布尔操作。')
  const subjectRaw = request.subject, clipRaw = request.clip
  if (!Array.isArray(subjectRaw) || !Array.isArray(clipRaw)) fail('subject和clip必须是环数组。')
  const subjectArray = subjectRaw as unknown[], clipArray = clipRaw as unknown[]
  if (subjectArray.length + clipArray.length > POLYGON_BOOLEAN_LIMITS.maxRings) fail(`输入环数不能超过${POLYGON_BOOLEAN_LIMITS.maxRings}。`)
  let pointCount = 0
  const subject = subjectArray, clip = clipArray
  const parse = (rings: unknown[]): PointMm[][] => rings.map((ring, index) => {
    pointCount += Array.isArray(ring) ? ring.length : 0
    if (pointCount > POLYGON_BOOLEAN_LIMITS.maxPoints) fail(`输入顶点总数不能超过${POLYGON_BOOLEAN_LIMITS.maxPoints}。`)
    return validateInputRing(ring, index)
  })
  return { operation: request.operation as PolygonBooleanOperation, subject: parse(subject), clip: parse(clip) }
}

// Translate before summing. Boolean output may sit near ±1e9mm, where the
// unshifted shoelace sum loses all of a small ring's area to cancellation.
const floatArea2 = (ring: FloatRing): number => {
  const origin = ring[0]
  return ring.reduce((sum, point, index) => {
    const next = ring[(index + 1) % ring.length]
    return sum + (point[0] - origin[0]) * (next[1] - origin[1]) - (next[0] - origin[0]) * (point[1] - origin[1])
  }, 0)
}
const floatSame = (a: FloatPoint, b: FloatPoint): boolean => Math.abs(a[0] - b[0]) <= EPS && Math.abs(a[1] - b[1]) <= EPS
const floatCross = (a: FloatPoint, b: FloatPoint, c: FloatPoint): number => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
const floatOnSegment = (a: FloatPoint, b: FloatPoint, p: FloatPoint): boolean => Math.abs(floatCross(a, b, p)) <= EPS && p[0] >= Math.min(a[0], b[0]) - EPS && p[0] <= Math.max(a[0], b[0]) + EPS && p[1] >= Math.min(a[1], b[1]) - EPS && p[1] <= Math.max(a[1], b[1]) + EPS
const floatIntersects = (a: FloatPoint, b: FloatPoint, c: FloatPoint, d: FloatPoint): boolean => {
  const abC = floatCross(a, b, c), abD = floatCross(a, b, d), cdA = floatCross(c, d, a), cdB = floatCross(c, d, b)
  if (Math.abs(abC) <= EPS && floatOnSegment(a, b, c) || Math.abs(abD) <= EPS && floatOnSegment(a, b, d) || Math.abs(cdA) <= EPS && floatOnSegment(c, d, a) || Math.abs(cdB) <= EPS && floatOnSegment(c, d, b)) return true
  return (abC < -EPS) !== (abD < -EPS) && (cdA < -EPS) !== (cdB < -EPS)
}
const floatSimple = (ring: FloatRing): boolean => {
  if (ring.length < 3 || Math.abs(floatArea2(ring)) <= EPS) return false
  for (let i = 0; i < ring.length; i++) for (let j = i + 1; j < ring.length; j++) {
    if (j === i + 1 || (i === 0 && j === ring.length - 1)) continue
    if (floatIntersects(ring[i], ring[(i + 1) % ring.length], ring[j], ring[(j + 1) % ring.length])) return false
  }
  return true
}
const pointInRing = (point: PointMm, ring: PointMm[], includeBoundary: boolean): boolean => {
  let inside = false
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length]
    if (onSegment(a, b, point)) return includeBoundary
    if ((a.y > point.y) !== (b.y > point.y)) {
      const left = BigInt(a.x) * BigInt(b.y - a.y) + BigInt(b.x - a.x) * BigInt(point.y - a.y)
      if ((b.y > a.y && left > BigInt(point.x) * BigInt(b.y - a.y)) || (b.y < a.y && left < BigInt(point.x) * BigInt(b.y - a.y))) inside = !inside
    }
  }
  return inside
}
const ringsTouch = (a: PointMm[], b: PointMm[]): boolean => {
  for (let i = 0; i < a.length; i++) {
    const a1 = a[i], a2 = a[(i + 1) % a.length]
    for (let j = 0; j < b.length; j++) if (intersects(a1, a2, b[j], b[(j + 1) % b.length])) return true
  }
  return false
}
const canonicalRing = (ring: PointMm[], positive: boolean): PointMm[] => {
  let result = ring.slice()
  if ((signedArea2(result) > 0n) !== positive) result.reverse()
  let start = 0
  for (let i = 1; i < result.length; i++) if (result[i].x < result[start].x || result[i].x === result[start].x && result[i].y < result[start].y) start = i
  return result.slice(start).concat(result.slice(0, start))
}
const compareRing = (a: PointMm[], b: PointMm[]): number => {
  const pa = a[0], pb = b[0]
  return pa.x - pb.x || pa.y - pb.y || a.length - b.length || (signedArea2(a) < signedArea2(b) ? -1 : signedArea2(a) > signedArea2(b) ? 1 : 0)
}

function quantizeRing(rawRing: FloatRing, index: string): PointMm[] {
  let ring = rawRing.slice()
  if (ring.length > 1 && floatSame(ring[0], ring[ring.length - 1])) ring = ring.slice(0, -1)
  if (!ring.every(point => Number.isFinite(point[0]) && Number.isFinite(point[1]))) fail(`${index}含非有限交点。`)
  if (!floatSimple(ring)) fail(`${index}的浮点结果不是简单环。`)
  const perimeter = ring.reduce((sum, point, i) => {
    const next = ring[(i + 1) % ring.length]
    return sum + Math.hypot(next[0] - point[0], next[1] - point[1])
  }, 0)
  const quantized = ring.map(([x, y]) => {
    if (x < POLYGON_BOOLEAN_LIMITS.minCoordinateMm - .500001 || x > POLYGON_BOOLEAN_LIMITS.maxCoordinateMm + .500001 || y < POLYGON_BOOLEAN_LIMITS.minCoordinateMm - .500001 || y > POLYGON_BOOLEAN_LIMITS.maxCoordinateMm + .500001) fail(`${index}交点超过±1e9mm。`)
    return { x: Math.round(x), y: Math.round(y) }
  })
  const rawArea = floatArea2(ring), quantizedArea = signedArea2(quantized)
  if (quantizedArea === 0n || (rawArea > 0) !== (quantizedArea > 0n)) fail(`${index}毫米量化改变了环方向或使其退化。`)
  // Each rounded coordinate moves by at most half a millimetre. The
  // coordinate-wise bound for doubled shoelace area is sqrt(2)*perimeter;
  // 1.5 is a conservative decimal bound plus a small vertex-count guard.
  if (Math.abs(rawArea - Number(quantizedArea)) > 1.5 * perimeter + 4) fail(`${index}毫米量化误差会改变面积拓扑。`)
  try { return validateInputRing(quantized, 0) } catch { return fail(`${index}毫米量化后环退化或自相交。`) }
}

function validateOutput(raw: MultiPolygon): PolygonBooleanResult {
  let vertexCount = 0
  const polygons: PolygonWithHoles[] = raw.map((polygon, polygonIndex) => {
    if (!Array.isArray(polygon) || polygon.length === 0) fail(`结果分量${polygonIndex + 1}为空。`)
    const outer = quantizeRing(polygon[0], `结果分量${polygonIndex + 1}外环`)
    const holes = polygon.slice(1).map((ring, holeIndex) => quantizeRing(ring, `结果分量${polygonIndex + 1}孔洞${holeIndex + 1}`))
    const normalizedOuter = canonicalRing(outer, true)
    const normalizedHoles = holes.map(hole => canonicalRing(hole, false)).sort(compareRing)
    for (const hole of normalizedHoles) {
      if (!pointInRing(hole[0], normalizedOuter, false)) fail(`结果分量${polygonIndex + 1}孔洞不在外环内。`)
      if (ringsTouch(normalizedOuter, hole)) fail(`结果分量${polygonIndex + 1}孔洞触碰外环。`)
    }
    for (let i = 0; i < normalizedHoles.length; i++) for (let j = i + 1; j < normalizedHoles.length; j++) {
      if (ringsTouch(normalizedHoles[i], normalizedHoles[j]) || pointInRing(normalizedHoles[i][0], normalizedHoles[j], true) || pointInRing(normalizedHoles[j][0], normalizedHoles[i], true)) fail(`结果分量${polygonIndex + 1}孔洞互相重叠。`)
    }
    vertexCount += normalizedOuter.length + normalizedHoles.reduce((sum, hole) => sum + hole.length, 0)
    return { outer: normalizedOuter, holes: normalizedHoles }
  })
  if (vertexCount > POLYGON_BOOLEAN_LIMITS.maxOutputPoints) fail(`结果顶点数超过${POLYGON_BOOLEAN_LIMITS.maxOutputPoints}。`)
  for (let i = 0; i < polygons.length; i++) for (let j = i + 1; j < polygons.length; j++) {
    const a = polygons[i].outer, b = polygons[j].outer
    if (ringsTouch(a, b) || pointInRing(a[0], b, true) || pointInRing(b[0], a, true)) fail('结果分量相交或相接，无法证明为完整分离分量。')
  }
  polygons.sort((a, b) => compareRing(a.outer, b.outer))
  return { polygons, vertexCount }
}

const asMultiPolygon = (rings: PointMm[][]): MultiPolygon => rings.map(ring => [ring.map(point => [point.x, point.y] as FloatPoint)])

export function polygonBoolean(raw: unknown): PolygonBooleanResult {
  const request = validateRequest(raw)
  const subject = asMultiPolygon(request.subject), clip = asMultiPolygon(request.clip)
  let result: MultiPolygon
  if (request.operation === 'union') result = subject.length && clip.length ? polygonClipping.union(subject, clip) : subject.length ? polygonClipping.union(subject) : polygonClipping.union(clip)
  else if (request.operation === 'intersection') result = subject.length && clip.length ? polygonClipping.intersection(subject, clip) : []
  else result = subject.length ? (clip.length ? polygonClipping.difference(subject, clip) : polygonClipping.difference(subject)) : []
  return validateOutput(result)
}
