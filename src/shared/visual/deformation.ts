import { z } from 'zod'
import type { PointMm } from '../model/scene.js'
import type { VisualBoundary } from './types.js'
import type { MaterializedEdge } from '../terrain-generation/contracts.js'
import { materializedEdgeSchema } from '../terrain-generation/contracts.js'
import { materializedBoundaryHash } from '../terrain-generation/integrity.js'
import { captureJson, cloneJson } from '../validation/json.js'
import { visualBoundarySchema } from './schema.js'
import { assertSimpleVisualPolyline, sampleVisualBoundary, visualSampleAtDistance } from './geometry.js'

const selection = z.array(z.string().min(1).max(256)).min(1).max(32).refine(ids => new Set(ids).size === ids.length, '变形段不能重复。')
const deformationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('bend'), segmentIds: selection, offsetMm: z.number().finite().int().min(-100_000).max(100_000) }).strict(),
  z.object({ kind: z.literal('stretch'), segmentIds: selection, factor: z.number().finite().min(.1).max(10),
    axis: z.enum(['tangent', 'x', 'y']), anchor: z.enum(['start', 'center', 'end']) }).strict(),
])
export type BoundaryDeformation = z.infer<typeof deformationSchema>
const same = (a: PointMm, b: PointMm) => a.x === b.x && a.y === b.y
const rounded = (point: PointMm): PointMm => ({ x: Math.round(point.x), y: Math.round(point.y) })
const shifted = (point: PointMm, delta: PointMm): PointMm => ({ x: point.x + delta.x, y: point.y + delta.y })

/** Own the curve before applying a transient edit. Only existing control points
 * change: fixed definitions, binding, IDs, width and world detail spacing stay put. */
export function deformVisualBoundary(input: VisualBoundary, request: BoundaryDeformation): VisualBoundary {
  const original = visualBoundarySchema.parse(captureJson(input)), operation = deformationSchema.parse(captureJson(request))
  sampleVisualBoundary(original)
  const selected = new Set(operation.segmentIds), indexes = original.segments.flatMap((segment, index) => selected.has(segment.id) ? [index] : [])
  if (indexes.length !== selected.size) throw new Error('组件变形必须明确选择当前仍存在的曲线段。')
  if (indexes.some((value, index) => index > 0 && value !== indexes[index - 1] + 1)) throw new Error('局部变形须选择一条连续控制段链。')
  const next = cloneJson(original)
  if (operation.kind === 'bend') {
    for (const index of indexes) {
      const source = original.segments[index], dx = source.end.x - source.start.x, dy = source.end.y - source.start.y, length = Math.hypot(dx, dy)
      if (length < 1) throw new Error('闭合整圈须先选择端点不同的局部段进行弯曲。')
      // A cubic with equal handle displacement reaches 3/4 of that displacement
      // at its midpoint, hence the 4/3 factor for a world-mm bend amount.
      const delta = { x: -dy / length * operation.offsetMm * 4 / 3, y: dx / length * operation.offsetMm * 4 / 3 }
      next.segments[index].control1 = rounded(shifted(source.control1, delta))
      next.segments[index].control2 = rounded(shifted(source.control2, delta))
    }
  } else {
    const start = original.segments[indexes[0]].start, end = original.segments[indexes.at(-1)!].end
    const dx = end.x - start.x, dy = end.y - start.y, length = Math.hypot(dx, dy)
    if (operation.axis === 'tangent' && length < 1) throw new Error('闭合整圈拉伸须明确选择世界X或Y轴，或选择局部段。')
    const direction = operation.axis === 'x' ? { x: 1, y: 0 } : operation.axis === 'y' ? { x: 0, y: 1 } : { x: dx / length, y: dy / length }
    const controls = indexes.flatMap(index => { const segment = original.segments[index]; return [segment.start, segment.control1, segment.control2, segment.end] })
    const anchor = operation.anchor === 'start' ? start : operation.anchor === 'end' ? end : {
      x: (Math.min(...controls.map(point => point.x)) + Math.max(...controls.map(point => point.x))) / 2,
      y: (Math.min(...controls.map(point => point.y)) + Math.max(...controls.map(point => point.y))) / 2,
    }
    const transform = (point: PointMm): PointMm => {
      const along = (point.x - anchor.x) * direction.x + (point.y - anchor.y) * direction.y
      return rounded({ x: point.x + direction.x * along * (operation.factor - 1), y: point.y + direction.y * along * (operation.factor - 1) })
    }
    for (const index of indexes) for (const key of ['start', 'control1', 'control2', 'end'] as const) next.segments[index][key] = transform(original.segments[index][key])
    // Adjacent unselected handles move with their shared anchor. Their other
    // anchor and remaining controls preserve the user's edit outside this chain.
    for (const index of indexes) {
      const previous = (index + original.segments.length - 1) % original.segments.length, following = (index + 1) % original.segments.length
      if ((index > 0 || original.closed) && !selected.has(original.segments[previous].id)) {
        const delta = { x: next.segments[index].start.x - original.segments[index].start.x, y: next.segments[index].start.y - original.segments[index].start.y }
        next.segments[previous].end = cloneJson(next.segments[index].start)
        next.segments[previous].control2 = shifted(original.segments[previous].control2, delta)
      }
      if ((index < original.segments.length - 1 || original.closed) && !selected.has(original.segments[following].id)) {
        const delta = { x: next.segments[index].end.x - original.segments[index].end.x, y: next.segments[index].end.y - original.segments[index].end.y }
        next.segments[following].start = cloneJson(next.segments[index].end)
        next.segments[following].control1 = shifted(original.segments[following].control1, delta)
      }
    }
  }
  sampleVisualBoundary(next)
  return next
}

export function boundaryDeformationCommand(boundary: VisualBoundary, request: BoundaryDeformation): { type: 'upsertVisualBoundary'; boundary: VisualBoundary } {
  return { type: 'upsertVisualBoundary', boundary: deformVisualBoundary(boundary, request) }
}

/** Re-materialize a stored edge in the source segment's local arc/normal frame.
 * The exact normal/tangent offsets retain world width; the current source and
 * output geometry travel together instead of leaving a stale source hash. */
export function deformMaterializedEdge(input: MaterializedEdge, before: VisualBoundary, after: VisualBoundary): MaterializedEdge {
  const edge = materializedEdgeSchema.parse(captureJson(input))
  if (edge.boundaryId !== before.id || before.id !== after.id || before.closed !== after.closed
    || before.segments.length !== after.segments.length || before.segments.some((segment, index) => segment.id !== after.segments[index].id)) {
    throw new Error('物化边缘变形须保留来源曲线身份及完整控制段拓扑。')
  }
  if (edge.inputHash !== materializedBoundaryHash(before)) throw new Error('物化边缘来源已过期，不能以新hash掩盖旧几何。')
  const parts = (curve: VisualBoundary) => curve.segments.map(segment => sampleVisualBoundary({ ...curve, closed: same(segment.start, segment.end), segments: [segment] }))
  const old = parts(before), fresh = parts(after)
  const remap = (point: PointMm): PointMm => {
    let closest: { index: number; distance: number; arc: number; position: PointMm; tangent: PointMm } | undefined
    for (const [index, part] of old.entries()) for (let i = 1; i < part.samples.length; i++) {
      const a = part.samples[i - 1], b = part.samples[i], dx = b.positionMm.x - a.positionMm.x, dy = b.positionMm.y - a.positionMm.y, square = dx * dx + dy * dy
      const t = Math.max(0, Math.min(1, ((point.x - a.positionMm.x) * dx + (point.y - a.positionMm.y) * dy) / square))
      const position = { x: a.positionMm.x + dx * t, y: a.positionMm.y + dy * t }, distance = Math.hypot(point.x - position.x, point.y - position.y)
      if (!closest || distance < closest.distance) closest = { index, distance, arc: a.distanceMm + (b.distanceMm - a.distanceMm) * t, position, tangent: { x: dx / Math.sqrt(square), y: dy / Math.sqrt(square) } }
    }
    if (!closest) throw new Error('物化边缘缺少可验证的来源弧长。')
    if (JSON.stringify(before.segments[closest.index]) === JSON.stringify(after.segments[closest.index])) return cloneJson(point)
    const at = visualSampleAtDistance(fresh[closest.index], closest.arc / old[closest.index].lengthMm * fresh[closest.index].lengthMm)
    const offset = { x: point.x - closest.position.x, y: point.y - closest.position.y }
    const tangent = offset.x * closest.tangent.x + offset.y * closest.tangent.y, normal = -offset.x * closest.tangent.y + offset.y * closest.tangent.x
    return rounded({ x: at.positionMm.x + at.tangent.x * tangent + at.normal.x * normal, y: at.positionMm.y + at.tangent.y * tangent + at.normal.y * normal })
  }
  edge.polygons = edge.polygons.map(polygon => polygon.map(remap))
  edge.strokes = edge.strokes.map(stroke => ({ ...stroke, pointsMm: stroke.pointsMm.map(remap) }))
  for (const polygon of edge.polygons) assertSimpleVisualPolyline(polygon, true)
  for (const stroke of edge.strokes) assertSimpleVisualPolyline(stroke.pointsMm, false)
  edge.inputHash = materializedBoundaryHash(after)
  return materializedEdgeSchema.parse(edge)
}
