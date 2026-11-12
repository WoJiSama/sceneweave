import type { PointMm } from '../model/scene.js'
import { assertSimpleVisualPolyline, sampleVisualBoundary } from './geometry.js'
import { captureJson, cloneJson } from '../validation/json.js'
import { visualBoundarySchema } from './schema.js'
import { VISUAL_LIMITS, type CubicSegment, type VisualBoundary } from './types.js'
import { polylineBand } from '../geometry/geometry.js'

export interface NaturalContourOptions {
  closed: boolean
  kind: 'smooth' | 'natural'
  /** Zero keeps the source polyline; 1 gives the full bounded tangent handles. */
  strength?: number
  seed?: string
  idPrefix?: string
  /** Maximum new anchor displacement; also bounded by its source span. */
  variationMm?: number
}
export type NaturalizeBoundaryOptions = Pick<NaturalContourOptions, 'kind' | 'strength' | 'seed' | 'variationMm'>
export interface RoadContourOptions {
  widthMm: number
  strength?: number
  idPrefix?: string
  sampleSpacingMm?: number
  toleranceMm?: number
}
const limit = 1_000_000_000
const point = (x: number, y: number): PointMm => ({ x: Math.round(x), y: Math.round(y) })
const distance = (a: PointMm, b: PointMm) => Math.hypot(b.x - a.x, b.y - a.y)
const unit = (a: PointMm, b: PointMm) => {
  const length = distance(a, b)
  if (!length) throw new Error('自然轮廓不能包含重复相邻点。')
  return { x: (b.x - a.x) / length, y: (b.y - a.y) / length }
}
function random(seed: string, index: number, channel = 0): number {
  let value = (2166136261 ^ Math.imul(index + 1, 0x9e3779b1) ^ Math.imul(channel + 1, 0x85ebca6b)) >>> 0
  for (let i = 0; i < seed.length; i++) value = Math.imul(value ^ seed.charCodeAt(i), 16777619) >>> 0
  value ^= value >>> 16; value = Math.imul(value, 0x7feb352d); value ^= value >>> 15
  return (value >>> 0) / 4294967296
}
function options(input: Omit<NaturalContourOptions, 'closed'>) {
  const strength = input.strength ?? .8, seed = input.seed ?? 'natural-contour-1', variationMm = input.variationMm ?? 450
  if (!['smooth', 'natural'].includes(input.kind) || !Number.isFinite(strength) || strength < 0 || strength > 1
    || typeof seed !== 'string' || !seed.length || seed.length > 128
    || !Number.isFinite(variationMm) || variationMm < 0 || variationMm > 5000) {
    throw new Error('自然轮廓需要有效样式、0–1强度、固定种子和0–5000mm起伏范围。')
  }
  return { ...input, strength, seed, variationMm }
}
function checkedPoints(source: readonly PointMm[], closed: boolean): PointMm[] {
  if (!Array.isArray(source) || source.some(p => !p || !Number.isSafeInteger(p.x) || !Number.isSafeInteger(p.y)
    || Math.abs(p.x) > limit || Math.abs(p.y) > limit)) throw new Error('自然轮廓控制点必须是范围内整数毫米。')
  const points = source.map(p => ({ x: p.x, y: p.y }))
  // A duplicated closing point carries no independent identity in this input API.
  if (closed && points.length > 1 && distance(points[0], points.at(-1)!) === 0) points.pop()
  assertSimpleVisualPolyline(points, closed)
  if (points.length > (closed ? 32 : 33)) throw new Error('自然轮廓超过32条控制段，请先明确缩小编辑范围。')
  return points
}
function tangent(points: readonly PointMm[], index: number, closed: boolean, endpointDirections?: [PointMm, PointMm]): PointMm {
  if (!closed && index === 0) return endpointDirections?.[0] ?? unit(points[0], points[1])
  if (!closed && index === points.length - 1) return endpointDirections?.[1] ?? unit(points.at(-2)!, points.at(-1)!)
  const before = points[(index + points.length - 1) % points.length], here = points[index], after = points[(index + 1) % points.length]
  const a = unit(before, here), b = unit(here, after), length = Math.hypot(a.x + b.x, a.y + b.y)
  if (length < .01) throw new Error('自然轮廓不能平滑折返尖点，请先调整控制点。')
  return { x: (a.x + b.x) / length, y: (a.y + b.y) / length }
}
function makeSegments(points: readonly PointMm[], closed: boolean, input: ReturnType<typeof options>, ids: readonly string[], endpointDirections?: [PointMm, PointMm]): CubicSegment[] {
  const count = closed ? points.length : points.length - 1
  const tangents = points.map((_point, index) => {
    const direction = tangent(points, index, closed, endpointDirections)
    if (input.kind !== 'natural' || !closed && (index === 0 || index === points.length - 1)) return direction
    const a = points[(index + points.length - 1) % points.length], b = points[(index + 1) % points.length]
    const length = Math.min(distance(a, points[index]), distance(points[index], b))
    const angle = (random(input.seed, index, 2) * 2 - 1) * Math.min(.15, input.variationMm / length) * input.strength
    return { x: direction.x * Math.cos(angle) - direction.y * Math.sin(angle), y: direction.x * Math.sin(angle) + direction.y * Math.cos(angle) }
  })
  const handle = points.map((p, index) => {
    const previous = index || closed ? distance(points[(index + points.length - 1) % points.length], p) : Infinity
    const next = index < points.length - 1 || closed ? distance(p, points[(index + 1) % points.length]) : Infinity
    const variation = input.kind === 'natural' ? .82 + random(input.seed, index, 3) * .18 : 1
    return Math.min(previous, next) / 3 * input.strength * variation
  })
  return Array.from({ length: count }, (_, index) => {
    const next = (index + 1) % points.length, start = points[index], end = points[next]
    if (input.strength === 0) return { id: ids[index], start: { ...start },
      control1: point((2 * start.x + end.x) / 3, (2 * start.y + end.y) / 3),
      control2: point((start.x + 2 * end.x) / 3, (start.y + 2 * end.y) / 3), end: { ...end } }
    return { id: ids[index], start: { ...start },
      control1: point(start.x + tangents[index].x * handle[index], start.y + tangents[index].y * handle[index]),
      control2: point(end.x - tangents[next].x * handle[next], end.y - tangents[next].y * handle[next]), end: { ...end } }
  })
}

/** Explicit authoring, never a render-time substitution. The returned curves
 * must be adopted with the existing bound-curve transaction so sampled terrain
 * or paths, support dependencies and locks are checked together. */
export function naturalContourSegments(source: readonly PointMm[], request: NaturalContourOptions): CubicSegment[] {
  const captured = captureJson(request), input = options(captured)
  if (typeof captured.closed !== 'boolean') throw new Error('自然轮廓必须明确闭合状态。')
  const original = checkedPoints(captureJson(source), captured.closed), points: PointMm[] = []
  const segmentCount = captured.closed ? original.length : original.length - 1, prefix = captured.idPrefix ?? 'natural-contour'
  if (typeof prefix !== 'string' || !prefix.length || prefix.length > 100) throw new Error('自然轮廓需要有限且非空的控制段ID前缀。')
  let spare = VISUAL_LIMITS.segmentsPerBoundary - segmentCount
  for (let index = 0; index < original.length; index++) {
    const a = original[index]; points.push(a)
    if (!captured.closed && index === original.length - 1) break
    const b = original[(index + 1) % original.length], length = distance(a, b)
    if (input.kind !== 'natural' || input.strength === 0 || !spare || length < 1800 || input.variationMm === 0) continue
    const t = .4 + random(input.seed, index) * .2, direction = unit(a, b)
    const offset = (random(input.seed, index, 1) * 2 - 1) * Math.min(input.variationMm, length * .08) * input.strength
    points.push(point(a.x + (b.x - a.x) * t - direction.y * offset, a.y + (b.y - a.y) * t + direction.x * offset)); spare--
  }
  const endpointDirections: [PointMm, PointMm] = [unit(original[0], original[1]), unit(original.at(-2)!, original.at(-1)!)]
  const count = captured.closed ? points.length : points.length - 1
  const result = makeSegments(points, captured.closed, input, Array.from({ length: count }, (_, index) => `${prefix}-${index}`), endpointDirections)
  sampleVisualBoundary({ segments: result, closed: captured.closed, sampleSpacingMm: 1000, toleranceMm: 20 })
  return result
}

/** Existing boundary identity, anchors and binding remain exact. Only handles
 * change; the normal upsert command owns all physical/derived updates. Unlike
 * new authoring this operation never inserts or removes a control segment. */
export function naturalizeVisualBoundary(source: VisualBoundary, request: NaturalizeBoundaryOptions): VisualBoundary {
  const boundary = visualBoundarySchema.parse(captureJson(source))
  sampleVisualBoundary(boundary)
  const input = options(captureJson(request)), points = boundary.segments.map(segment => ({ ...segment.start }))
  if (!boundary.closed) points.push({ ...boundary.segments.at(-1)!.end })
  checkedPoints(points, boundary.closed)
  const result: VisualBoundary = { ...boundary, binding: cloneJson(boundary.binding),
    segments: makeSegments(points, boundary.closed, input, boundary.segments.map(segment => segment.id)) }
  sampleVisualBoundary(result)
  return result
}

function roadOptions(request: RoadContourOptions) {
  const input = captureJson(request), strength = input.strength ?? .85, idPrefix = input.idPrefix ?? 'road-contour'
  if (!Number.isSafeInteger(input.widthMm) || input.widthMm <= 0 || input.widthMm > limit
    || !Number.isFinite(strength) || strength < 0 || strength > 1
    || typeof idPrefix !== 'string' || !idPrefix.length || idPrefix.length > 100) throw new Error('道路圆弧需要正整数宽度、0–1强度和有限的控制段ID前缀。')
  return { ...input, strength, idPrefix, sampleSpacingMm: input.sampleSpacingMm ?? 900, toleranceMm: input.toleranceMm ?? 20 }
}
function linearSegment(start: PointMm, end: PointMm, id: string): CubicSegment {
  return { id, start: { ...start }, control1: point((2*start.x+end.x)/3, (2*start.y+end.y)/3),
    control2: point((start.x+2*end.x)/3, (start.y+2*end.y)/3), end: { ...end } }
}
function roadSamples(segments: CubicSegment[], input: ReturnType<typeof roadOptions>) {
  const sampled = sampleVisualBoundary({ segments, closed: false, sampleSpacingMm: input.sampleSpacingMm, toleranceMm: input.toleranceMm })
  if (sampled.points.length > 256) throw new Error('道路圆弧采样超过256点预算，请减少控制点或增大采样间距。')
  assertSimpleVisualPolyline(polylineBand(sampled.points, input.widthMm, true), true)
  return sampled
}
function cornerArc(a: PointMm, corner: PointMm, b: PointMm, input: ReturnType<typeof roadOptions>, id: string, availableFraction = .45): CubicSegment | undefined {
  const incoming = distance(a, corner), outgoing = distance(corner, b), u = unit(a, corner), v = unit(corner, b)
  const theta = Math.acos(Math.max(-1, Math.min(1, u.x*v.x+u.y*v.y)))
  if (theta < 1e-7) return undefined
  if (theta > Math.PI - .01) throw new Error('道路圆弧不能连接折返尖点。')
  const trim = Math.min(incoming*availableFraction, outgoing*availableFraction, input.widthMm*(.6+1.2*input.strength)), radius = trim/Math.tan(theta/2)
  if (radius < input.widthMm/2+input.toleranceMm*2+2) throw new Error('相邻直段不足以容纳当前道路净宽的圆弧，请先留出转弯空间。')
  const start = point(corner.x-u.x*trim, corner.y-u.y*trim), end = point(corner.x+v.x*trim, corner.y+v.y*trim)
  const handle = 4/3*Math.tan(theta/4)*radius
  return { id, start, control1: point(start.x+u.x*handle, start.y+u.y*handle), control2: point(end.x-v.x*handle, end.y-v.y*handle), end }
}

/** Explicit road authoring replaces old interior corner anchors with tangent
 * circular fillets. Only the first/last position and direction stay exact.
 * It checks the real square-cap/miter2/bevel band, rather than only the line. */
export function roadContourSegments(source: readonly PointMm[], request: RoadContourOptions): CubicSegment[] {
  const input = roadOptions(request), original = checkedPoints(captureJson(source), false), points: PointMm[] = []
  for (const p of original) {
    while (points.length > 1) {
      const a = points.at(-2)!, b = points.at(-1)!, ax = BigInt(b.x-a.x), ay = BigInt(b.y-a.y), bx = BigInt(p.x-b.x), by = BigInt(p.y-b.y)
      if (ax*by !== ay*bx || ax*bx+ay*by <= 0n) break
      points.pop()
    }
    points.push(p)
  }
  const segments: CubicSegment[] = []; let cursor = points[0]
  const straight = (end: PointMm) => {
    if (distance(cursor, end)) segments.push(linearSegment(cursor, end, `${input.idPrefix}-line-${segments.length}`))
    cursor = end
  }
  for (let index = 1; index < points.length-1; index++) {
    const arc = input.strength === 0 ? undefined : cornerArc(points[index-1], points[index], points[index+1], input, `${input.idPrefix}-arc-${index}`)
    if (!arc) { if (input.strength === 0) straight(points[index]); continue }
    straight(arc.start); segments.push(arc); cursor = arc.end
  }
  straight(points.at(-1)!)
  roadSamples(segments, input)
  return segments
}

function reverseSegments(source: readonly CubicSegment[]): CubicSegment[] {
  return source.slice().reverse().map(s => ({ id: s.id, start: { ...s.end }, control1: { ...s.control2 }, control2: { ...s.control1 }, end: { ...s.start } }))
}
function straightControl(segment: CubicSegment) {
  const d = unit(segment.start, segment.end)
  return [segment.control1, segment.control2].every(p => Math.abs((p.x-segment.start.x)*d.y-(p.y-segment.start.y)*d.x) <= 1.1)
}
/** Join explicit road endpoints through a real common straight tangent. Its
 * sampled end segments are exactly collinear, so equal-width square caps lie
 * inside the opposite road rather than protruding from two tessellated arcs.
 * Only the finite terminal span changes; distant anchors, bindings and locks
 * stay exact. Both normal upserts must be previewed/adopted atomically. */
export function joinRoadContourEndpoints(firstInput: VisualBoundary, secondInput: VisualBoundary,
  request: RoadContourOptions & { secondWidthMm: number; clearanceWidthMm?: number; firstEnd?: 'start' | 'end'; secondEnd?: 'start' | 'end' }): { first: VisualBoundary; second: VisualBoundary; junctionMm: PointMm } {
  const captured = captureJson(request), first = visualBoundarySchema.parse(captureJson(firstInput)), second = visualBoundarySchema.parse(captureJson(secondInput))
  const input = roadOptions(captured), secondOptions = roadOptions({ ...input, widthMm: captured.secondWidthMm })
  const firstEnd = captured.firstEnd ?? 'end', secondEnd = captured.secondEnd ?? 'end'
  if (!['start', 'end'].includes(firstEnd) || !['start', 'end'].includes(secondEnd) || first.id === second.id || first.closed || second.closed
    || first.floorId !== second.floorId || first.binding.kind !== 'path' || second.binding.kind !== 'path' || first.binding.pathId === second.binding.pathId) throw new Error('道路连接需要同Floor的两条独立开放道路和明确端点。')
  roadSamples(first.segments, { ...input, sampleSpacingMm: first.sampleSpacingMm, toleranceMm: first.toleranceMm })
  roadSamples(second.segments, { ...secondOptions, sampleSpacingMm: second.sampleSpacingMm, toleranceMm: second.toleranceMm })
  const a = firstEnd === 'start' ? reverseSegments(first.segments) : cloneJson(first.segments), b = secondEnd === 'start' ? reverseSegments(second.segments) : cloneJson(second.segments)
  const lastA = a.at(-1)!, lastB = b.at(-1)!
  if (distance(lastA.end, lastB.end) !== 0 || !straightControl(lastA) || !straightControl(lastB)) throw new Error('道路连接仅支持确切相接且端部为直段的两个端点，请先明确调整端部。')
  if (input.strength === 0) return { first, second, junctionMm: { ...lastA.end } }
  const clearance = captured.clearanceWidthMm ?? Math.max(input.widthMm, secondOptions.widthMm)
  if (!Number.isSafeInteger(clearance) || clearance < Math.max(input.widthMm, secondOptions.widthMm) || clearance > limit) throw new Error('道路连接净空不得小于两条道路实际宽度。')
  const wide = { ...input, widthMm: clearance }
  const straightLengthMm = Math.ceil(wide.widthMm / 2 + 2 * Math.max(first.toleranceMm, second.toleranceMm) + 64)
  const incoming = unit(lastA.start, lastA.end), outgoing = unit(lastB.end, lastB.start)
  const theta = Math.acos(Math.max(-1, Math.min(1, incoming.x*outgoing.x+incoming.y*outgoing.y)))
  if (theta < 1e-7) return { first, second, junctionMm: { ...lastA.end } }
  if (theta > Math.PI - .01) throw new Error('道路圆弧不能连接折返尖点。')
  const directionLength = Math.hypot(incoming.x+outgoing.x, incoming.y+outgoing.y)
  const direction = { x: (incoming.x+outgoing.x)/directionLength, y: (incoming.y+outgoing.y)/directionLength }
  const radius = wide.widthMm / 2 + 2 * Math.max(first.toleranceMm, second.toleranceMm) + 64
  const halfTrim = radius * Math.tan(theta / 4), shift = (straightLengthMm+halfTrim) / Math.cos(theta/2), trim = shift + halfTrim
  // A short final straight can follow an existing fillet. Include that finite
  // suffix when necessary instead of folding a road-width tangent into it.
  const suffixStart = (segments: CubicSegment[]) => {
    let index = segments.length - 1
    while (index > 0 && distance(segments[index].start, segments.at(-1)!.end) < trim + radius/2) index--
    if (distance(segments[index].start, segments.at(-1)!.end) < trim + radius/2) throw new Error('道路端部不足以保留完整方端帽的共同直段，请先留出连接空间。')
    return index
  }
  const indexA = suffixStart(a), indexB = suffixStart(b), startA = a[indexA], startB = b[indexB]
  const corner = lastA.end, entry = point(corner.x-incoming.x*trim, corner.y-incoming.y*trim), exit = point(corner.x+outgoing.x*trim, corner.y+outgoing.y*trim)
  const ca = { x: corner.x-incoming.x*shift, y: corner.y-incoming.y*shift }, cb = { x: corner.x+outgoing.x*shift, y: corner.y+outgoing.y*shift }
  const junctionMm = point((ca.x+cb.x)/2, (ca.y+cb.y)/2)
  const delta = point(direction.x * straightLengthMm, direction.y * straightLengthMm)
  const tangentA = point(junctionMm.x-delta.x, junctionMm.y-delta.y), tangentB = point(junctionMm.x+delta.x, junctionMm.y+delta.y)
  const lead = (start: CubicSegment, end: PointMm, endDirection: PointMm, id: string): CubicSegment => {
    const initial = unit(start.start, start.control1), handle = distance(start.start, end) / 3
    return { id, start: { ...start.start }, control1: point(start.start.x+initial.x*handle, start.start.y+initial.y*handle),
      control2: point(end.x-endDirection.x*handle, end.y-endDirection.y*handle), end }
  }
  const handle = 4/3*Math.tan(theta/8)*radius
  const halfA: CubicSegment = { id: `${input.idPrefix}-join-a`, start: entry, control1: point(entry.x+incoming.x*handle,entry.y+incoming.y*handle),
    control2: point(tangentA.x-direction.x*handle,tangentA.y-direction.y*handle), end: tangentA }
  const halfB: CubicSegment = { id: `${input.idPrefix}-join-b`, start: exit, control1: point(exit.x-outgoing.x*handle,exit.y-outgoing.y*handle),
    control2: point(tangentB.x+direction.x*handle,tangentB.y+direction.y*handle), end: tangentB }
  const joinedA = [...a.slice(0,indexA), lead(startA, entry, incoming, `${input.idPrefix}-lead-a`), halfA, linearSegment(tangentA, junctionMm, `${input.idPrefix}-tangent-a`)]
  const joinedB = [...b.slice(0,indexB), lead(startB, exit, {x:-outgoing.x,y:-outgoing.y}, `${input.idPrefix}-lead-b`), halfB, linearSegment(tangentB, junctionMm, `${input.idPrefix}-tangent-b`)]
  // Keep this terminal line as one physical sample. Subdividing and quantizing
  // a diagonal line independently can make the final millimetre chord differ.
  const spacing = Math.ceil(Math.hypot(delta.x, delta.y)) + 4
  const firstSpacing = Math.max(first.sampleSpacingMm, spacing), secondSpacing = Math.max(second.sampleSpacingMm, spacing)
  const samplesA = roadSamples(joinedA, { ...input, sampleSpacingMm: firstSpacing, toleranceMm: first.toleranceMm })
  const samplesB = roadSamples(joinedB, { ...secondOptions, sampleSpacingMm: secondSpacing, toleranceMm: second.toleranceMm })
  assertSimpleVisualPolyline(polylineBand([...samplesA.points, ...samplesB.points.slice(0,-1).reverse()], wide.widthMm, true), true)
  return { first: { ...first, sampleSpacingMm: firstSpacing, segments: firstEnd === 'start' ? reverseSegments(joinedA) : joinedA },
    second: { ...second, sampleSpacingMm: secondSpacing, segments: secondEnd === 'start' ? reverseSegments(joinedB) : joinedB }, junctionMm }
}
