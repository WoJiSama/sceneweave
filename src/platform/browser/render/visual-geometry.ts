import type { BoundsMm, PointMm } from '../../../shared/model/scene.js'

const EPS = 1e-7
export interface VisualSegment { start: PointMm; end: PointMm }
export interface ArcPoint extends PointMm { distanceMm: number; tangent: PointMm; normal: PointMm }
const cross = (a: PointMm, b: PointMm) => a.x * b.y - a.y * b.x
const subtract = (a: PointMm, b: PointMm): PointMm => ({ x: a.x - b.x, y: a.y - b.y })
const add = (a: PointMm, b: PointMm): PointMm => ({ x: a.x + b.x, y: a.y + b.y })
const times = (a: PointMm, n: number): PointMm => ({ x: a.x * n, y: a.y * n })
const length = (a: PointMm) => Math.hypot(a.x, a.y)
const equal = (a: PointMm, b: PointMm) => length(subtract(a, b)) < EPS

/** Stable world arc length. Repeated vertices are omitted without changing the remaining phase. */
export function arcPoints(points: readonly PointMm[], closed = false): ArcPoint[] {
  const clean = points.filter((p, i) => !i || !equal(p, points[i - 1])).map(p => ({ ...p }))
  if (closed && clean.length > 1 && equal(clean[0], clean[clean.length - 1])) clean.pop()
  if (clean.length < 2) return []
  let distanceMm = 0
  const result: ArcPoint[] = []
  for (let i = 0; i < clean.length; i++) {
    if (i) distanceMm += length(subtract(clean[i], clean[i - 1]))
    const before = clean[i === 0 ? closed ? clean.length - 1 : 0 : i - 1]
    const after = clean[i === clean.length - 1 ? closed ? 0 : i : i + 1]
    const direction = subtract(after, before), size = length(direction)
    const tangent = size > EPS ? times(direction, 1 / size) : { x: 1, y: 0 }
    result.push({ ...clean[i], distanceMm, tangent, normal: { x: -tangent.y, y: tangent.x } })
  }
  if (closed) result.push({ ...result[0], distanceMm: distanceMm + length(subtract(clean[0], clean[clean.length - 1])) })
  return result
}

/** Interpolate by millimetres, never by screen pixels or curve-control index. */
export function pointAtArc(points: readonly ArcPoint[], distanceMm: number): ArcPoint | null {
  if (points.length < 2) return null
  const total = points[points.length - 1].distanceMm, distance = Math.max(0, Math.min(total, distanceMm))
  let lo = 0, hi = points.length - 1
  while (lo + 1 < hi) { const mid = (lo + hi) >>> 1; if (points[mid].distanceMm <= distance) lo = mid; else hi = mid }
  const a = points[lo], b = points[hi], segmentLength = b.distanceMm - a.distanceMm
  if (segmentLength <= EPS) return { ...a, distanceMm: distance }
  const t = (distance - a.distanceMm) / segmentLength, tangent = times(subtract(b, a), 1 / segmentLength)
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, distanceMm: distance, tangent, normal: { x: -tangent.y, y: tangent.x } }
}

/** Bounded miter/bevel offsets. One joined ring avoids independent segment cracks at concave/convex turns. */
export function offsetPolyline(points: readonly PointMm[], offsetMm: number, closed = false, miterLimit = 2): PointMm[] {
  const clean = points.filter((p, i) => !i || !equal(p, points[i - 1])).map(p => ({ ...p }))
  if (closed && clean.length > 1 && equal(clean[0], clean[clean.length - 1])) clean.pop()
  if (clean.length < 2) return []
  if (!offsetMm) return clean
  const result: PointMm[] = []
  const unit = (a: PointMm, b: PointMm) => { const d = subtract(b, a); return times(d, 1 / length(d)) }
  for (let i = 0; i < clean.length; i++) {
    const p = clean[i]
    if (!closed && (i === 0 || i === clean.length - 1)) {
      const u = i === 0 ? unit(p, clean[1]) : unit(clean[i - 1], p)
      result.push(add(p, { x: -u.y * offsetMm, y: u.x * offsetMm })); continue
    }
    const before = clean[(i + clean.length - 1) % clean.length], after = clean[(i + 1) % clean.length]
    const u = unit(before, p), v = unit(p, after), determinant = cross(u, v)
    const a = add(p, { x: -u.y * offsetMm, y: u.x * offsetMm }), b = add(p, { x: -v.y * offsetMm, y: v.x * offsetMm })
    if (Math.abs(determinant) < EPS) { result.push(a); continue }
    const miter = add(a, times(u, cross(subtract(b, a), v) / determinant))
    if (length(subtract(miter, p)) <= Math.abs(offsetMm) * miterLimit + EPS) result.push(miter)
    else result.push(a, b)
  }
  return result
}
export function bandRings(points: readonly PointMm[], nearMm: number, farMm: number, closed = false): PointMm[][] {
  const a = offsetPolyline(points, nearMm, closed), b = offsetPolyline(points, farMm, closed)
  if (!a.length || !b.length) return []
  return closed ? [a, b.reverse()] : [[...a, ...b.reverse()]]
}

/** Counter-based random numbers give every world decoration a stable identity even when cropped. */
export function visualRandom(seed: string, index: number, channel = 0): number {
  let hash = (2166136261 ^ Math.imul(index + 1, 0x9e3779b1) ^ Math.imul(channel + 1, 0x85ebca6b)) >>> 0
  for (let i = 0; i < seed.length; i++) { hash ^= seed.charCodeAt(i); hash = Math.imul(hash, 16777619) >>> 0 }
  hash ^= hash >>> 16; hash = Math.imul(hash, 0x7feb352d); hash ^= hash >>> 15; hash = Math.imul(hash, 0x846ca68b); hash ^= hash >>> 16
  return (hash >>> 0) / 4294967296
}

function rayDistance(origin: PointMm, direction: PointMm, segment: VisualSegment): number | null {
  const edge = subtract(segment.end, segment.start), determinant = cross(direction, edge)
  if (Math.abs(determinant) < EPS) return null
  const delta = subtract(segment.start, origin), t = cross(delta, edge) / determinant, u = cross(delta, direction) / determinant
  return t > EPS && u >= -EPS && u <= 1 + EPS ? t : null
}
export const polygonSegments = (points: readonly PointMm[]): VisualSegment[] => points.map((p, i) => ({ start: { ...p }, end: { ...points[(i + 1) % points.length] } }))
export const intersectsVisualBounds = (a: BoundsMm, b: BoundsMm) => a.x <= b.x + b.width && a.x + a.width >= b.x && a.y <= b.y + b.height && a.y + a.height >= b.y

/** Two-dimensional, audience-owned visibility. The radius is cosmetic, never movement/path geometry. */
export function lightVisibilityPolygon(origin: PointMm, radiusMm: number, blockers: readonly VisualSegment[]): PointMm[] {
  const nearby = blockers.filter(s => intersectsVisualBounds({ x: Math.min(s.start.x, s.end.x), y: Math.min(s.start.y, s.end.y), width: Math.abs(s.end.x - s.start.x), height: Math.abs(s.end.y - s.start.y) }, { x: origin.x - radiusMm, y: origin.y - radiusMm, width: radiusMm * 2, height: radiusMm * 2 }))
  if (nearby.length > 2048) throw new Error('点光遮挡超过2048条局部边段预算，请缩小灯光范围。')
  const angles = Array.from({ length: 128 }, (_, i) => i * Math.PI * 2 / 128)
  for (const s of nearby) for (const p of [s.start, s.end]) {
    const a = Math.atan2(p.y - origin.y, p.x - origin.x)
    for (const offset of [-.000001, 0, .000001]) angles.push(((a + offset) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2))
  }
  if (angles.length > 12416 || angles.length * nearby.length > 4_000_000) throw new Error('点光可见性超过局部射线预算，请缩小灯光范围。')
  angles.sort((a, b) => a - b)
  return angles.map(a => {
    const direction = { x: Math.cos(a), y: Math.sin(a) }; let distance = radiusMm
    for (const s of nearby) { const hit = rayDistance(origin, direction, s); if (hit !== null) distance = Math.min(distance, hit) }
    return add(origin, times(direction, distance))
  })
}
