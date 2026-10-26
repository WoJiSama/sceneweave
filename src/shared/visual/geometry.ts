import type { PointMm, TerrainArea } from '../model/scene.js'
import { VISUAL_LIMITS, type CubicSegment, type SampledBoundary, type TerrainBoundarySide, type VisualBoundary, type BoundarySample } from './types.js'

const EPS = 1e-7
const same = (a: PointMm, b: PointMm) => a.x === b.x && a.y === b.y
const mix = (a: PointMm, b: PointMm, t = .5): PointMm => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
const length = (a: PointMm, b: PointMm) => Math.hypot(b.x - a.x, b.y - a.y)
const quantize = (n: number) => (n < 0 ? -1 : 1) * Math.floor(Math.abs(n) + .5)
const cross = (a: PointMm, b: PointMm, c: PointMm) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
function onSegment(p: PointMm, a: PointMm, b: PointMm): boolean {
  return Math.abs(cross(a, b, p)) < EPS && p.x >= Math.min(a.x, b.x) && p.x <= Math.max(a.x, b.x) && p.y >= Math.min(a.y, b.y) && p.y <= Math.max(a.y, b.y)
}
function intersects(a: PointMm, b: PointMm, c: PointMm, d: PointMm): boolean {
  const x = cross(a, b, c), y = cross(a, b, d), u = cross(c, d, a), v = cross(c, d, b)
  return (x * y < 0 && u * v < 0) || onSegment(a, c, d) || onSegment(b, c, d) || onSegment(c, a, b) || onSegment(d, a, b)
}
export const signedVisualArea = (points: readonly PointMm[]): number => points.reduce((total, p, i) => total + p.x * points[(i + 1) % points.length].y - points[(i + 1) % points.length].x * p.y, 0) / 2
/** Checks the actual quantized physical approximation, with no hidden repair or smoothing. */
export function assertSimpleVisualPolyline(points: readonly PointMm[], closed: boolean): void {
  if (points.length < (closed ? 3 : 2) || new Set(points.map(p => `${p.x},${p.y}`)).size !== points.length) throw new Error('曲线采样出现重复点、闭合退化或长度不足。')
  const count = closed ? points.length : points.length - 1
  if (closed && Math.abs(signedVisualArea(points)) < 1) throw new Error('闭合曲线采样面积必须非零。')
  for (let i = 0; i < count; i++) {
    const a = points[i], b = points[(i + 1) % points.length]
    if (same(a, b)) throw new Error('曲线采样出现零长段。')
    if (i + 1 < count || closed) {
      const c = points[(i + 2) % points.length]
      if (Math.abs(cross(a, b, c)) < EPS && (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y) <= 0) throw new Error('曲线含折返或尖点，请调整控制点。')
    }
    for (let j = i + 1; j < count; j++) {
      if (j === i + 1 || closed && i === 0 && j === count - 1) continue
      if (intersects(a, b, points[j], points[(j + 1) % points.length])) throw new Error('曲线采样自交或自接触。')
    }
  }
}
function distanceToChord(p: PointMm, a: PointMm, b: PointMm): number {
  const l = length(a, b)
  return l ? Math.abs(cross(a, b, p)) / l : length(a, p)
}
function subdivide(segment: CubicSegment, spacing: number, tolerance: number, output: PointMm[], depth = 0): void {
  const { start: a, control1: b, control2: c, end: d } = segment
  const polygonLength = length(a, b) + length(b, c) + length(c, d), chordLength = length(a, d)
  const flat = Math.max(distanceToChord(b, a, d), distanceToChord(c, a, d)) <= tolerance && polygonLength - chordLength <= tolerance
  if (flat && polygonLength <= spacing) {
    const q = { x: quantize(d.x), y: quantize(d.y) }
    if (!same(output.at(-1)!, q)) output.push(q)
    if (output.length > VISUAL_LIMITS.samplesPerBoundary + 1) throw new Error('曲线采样超过512点预算；请减少细节或增大采样间距。')
    return
  }
  if (depth >= 16) throw new Error('曲线曲率或控制点超过细分预算。')
  const ab = mix(a, b), bc = mix(b, c), cd = mix(c, d), abc = mix(ab, bc), bcd = mix(bc, cd), mid = mix(abc, bcd)
  subdivide({ ...segment, start: a, control1: ab, control2: abc, end: mid }, spacing, tolerance, output, depth + 1)
  subdivide({ ...segment, start: mid, control1: bcd, control2: cd, end: d }, spacing, tolerance, output, depth + 1)
}
/** Stable dyadic cubic subdivision and integer-mm quantization; independent of viewport and raster scale. */
export function sampleVisualBoundary(boundary: Pick<VisualBoundary, 'segments' | 'closed' | 'sampleSpacingMm' | 'toleranceMm'>): SampledBoundary {
  if (!Number.isSafeInteger(boundary.sampleSpacingMm) || boundary.sampleSpacingMm < 4 || boundary.sampleSpacingMm > 20_000 || !Number.isSafeInteger(boundary.toleranceMm) || boundary.toleranceMm < 1 || boundary.toleranceMm > 1000) throw new Error('曲线采样间距或容差无效。')
  if (!boundary.segments.length || boundary.segments.length > VISUAL_LIMITS.segmentsPerBoundary) throw new Error('曲线须包含1–32条三次段。')
  const ids = new Set<string>()
  for (const [index, segment] of boundary.segments.entries()) {
    if (!segment.id || ids.has(segment.id)) throw new Error('三次曲线段ID必须稳定且唯一。')
    ids.add(segment.id)
    for (const p of [segment.start, segment.control1, segment.control2, segment.end]) if (![p.x, p.y].every(n => Number.isSafeInteger(n) && Math.abs(n) <= 1_000_000_000)) throw new Error('曲线控制点须为范围内整数毫米。')
    if (index && !same(boundary.segments[index - 1].end, segment.start)) throw new Error('相邻曲线段须共用确切端点。')
  }
  if (same(boundary.segments[0].start, boundary.segments.at(-1)!.end) !== boundary.closed) throw new Error('曲线闭合标记必须与首尾端点一致。')
  const raw: PointMm[] = [{ ...boundary.segments[0].start }]
  for (const segment of boundary.segments) subdivide(segment, boundary.sampleSpacingMm, boundary.toleranceMm, raw)
  if (boundary.closed && same(raw[0], raw.at(-1)!)) raw.pop()
  assertSimpleVisualPolyline(raw, boundary.closed)
  if (raw.length > VISUAL_LIMITS.samplesPerBoundary) throw new Error('曲线超过512点采样预算。')
  let distance = 0
  const samples: BoundarySample[] = raw.map((positionMm, i) => {
    if (i) distance += length(raw[i - 1], positionMm)
    const previous = raw[i ? i - 1 : boundary.closed ? raw.length - 1 : 0], next = raw[i === raw.length - 1 ? boundary.closed ? 0 : i : i + 1]
    const beforeLength = length(previous, positionMm), nextLength = length(positionMm, next)
    const dx = (beforeLength ? (positionMm.x - previous.x) / beforeLength : 0) + (nextLength ? (next.x - positionMm.x) / nextLength : 0)
    const dy = (beforeLength ? (positionMm.y - previous.y) / beforeLength : 0) + (nextLength ? (next.y - positionMm.y) / nextLength : 0), l = Math.hypot(dx, dy)
    if (l < EPS) throw new Error('曲线存在不可定义法线的折返点。')
    const tangent = { x: dx / l, y: dy / l }
    return { positionMm: { ...positionMm }, distanceMm: distance, tangent, normal: { x: -tangent.y, y: tangent.x } }
  })
  if (boundary.closed) {
    distance += length(raw.at(-1)!, raw[0])
    samples.push({ ...samples[0], positionMm: { ...raw[0] }, distanceMm: distance, tangent: { ...samples[0].tangent }, normal: { ...samples[0].normal } })
  }
  return { points: raw, samples, lengthMm: distance, closed: boundary.closed }
}
/** Arc-length placement does not restart at cubic or tessellation joins. */
export function visualSampleAtDistance(boundary: SampledBoundary, distanceMm: number): BoundarySample {
  if (!Number.isFinite(distanceMm) || !boundary.samples.length || !(boundary.lengthMm > 0)) throw new Error('曲线弧长位置无效。')
  const distance = boundary.closed ? ((distanceMm % boundary.lengthMm) + boundary.lengthMm) % boundary.lengthMm : Math.max(0, Math.min(boundary.lengthMm, distanceMm))
  let low = 0, high = boundary.samples.length - 1
  while (high - low > 1) { const mid = (low + high) >>> 1; if (boundary.samples[mid].distanceMm <= distance) low = mid; else high = mid }
  const a = boundary.samples[low], b = boundary.samples[high], span = b.distanceMm - a.distanceMm, t = span ? (distance - a.distanceMm) / span : 0
  const tangent = mix(a.tangent, b.tangent, t), l = Math.hypot(tangent.x, tangent.y)
  if (!(l > EPS)) throw new Error('曲线弧长法线无效。')
  tangent.x /= l; tangent.y /= l
  return { positionMm: mix(a.positionMm, b.positionMm, t), distanceMm: distance, tangent, normal: { x: -tangent.y, y: tangent.x } }
}
/** Directed inclusive chain, anchored by persisted point IDs rather than mutable array offsets. */
export function terrainBoundaryChain(area: TerrainArea, side: TerrainBoundarySide, closed: boolean): TerrainArea['boundaryMm'] {
  const start = area.boundaryMm.findIndex(p => p.id === side.startPointId), end = area.boundaryMm.findIndex(p => p.id === side.endPointId)
  if (start < 0 || end < 0 || (start === end) !== closed) throw new Error('共享曲线须绑定现存起止点；闭合曲线须绑定同一锚点。')
  const result = [area.boundaryMm[start]]
  let index = (start + 1) % area.boundaryMm.length
  while (index !== end) { result.push(area.boundaryMm[index]); index = (index + 1) % area.boundaryMm.length; if (result.length > area.boundaryMm.length) throw new Error('曲线链闭合失败。') }
  if (!closed) result.push(area.boundaryMm[end])
  return result
}
