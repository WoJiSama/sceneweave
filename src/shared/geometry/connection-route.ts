import { z } from 'zod'
import type { PointMm } from '../model/scene.js'
import { id, point } from '../validation/primitives.js'
import { sampleVisualBoundary } from '../visual/geometry.js'

const segment = z.object({ id, start: point, control1: point, control2: point, end: point }).strict()
const routeShape = z.object({ version: z.literal(1), kind: z.enum(['polyline', 'cubic']),
  segments: z.array(segment).min(1).max(16), sampleSpacingMm: z.number().int().min(4).max(20_000),
  toleranceMm: z.number().int().min(1).max(1000), centerlineMm: z.array(point).min(2).max(256),
  stairStyle: z.enum(['stone', 'wood', 'naturalRock']), treadDepthMm: z.number().int().min(50).max(2000),
}).strict()
export type ConnectionRoute = z.infer<typeof routeShape>
export const CONNECTION_ROUTE_LIMITS = Object.freeze({ segments: 16, samples: 256, treads: 512 })
const same = (a: PointMm, b: PointMm) => a.x === b.x && a.y === b.y

/** Saved controls deterministically materialize the complete integer-mm route.
 * The sampler is shared with visual boundaries; no viewport/raster state enters. */
export function sampleConnectionRoute(route: Pick<ConnectionRoute, 'kind' | 'segments' | 'sampleSpacingMm' | 'toleranceMm'>): PointMm[] {
  if (!['polyline', 'cubic'].includes(route.kind) || route.segments.length < 1 || route.segments.length > CONNECTION_ROUTE_LIMITS.segments) throw new Error('连接路线须包含1–16个明确类型的稳定曲线段。')
  if (route.kind === 'polyline' && route.segments.some(s => !same(s.control1, s.start) || !same(s.control2, s.end))) throw new Error('折线连接的控制点须精确等于对应端点。')
  const sampled = sampleVisualBoundary({ ...route, closed: false }).points
  if (sampled.length > CONNECTION_ROUTE_LIMITS.samples) throw new Error('连接路线实际采样超过256点。')
  return sampled
}
export const connectionRouteSchema = routeShape.superRefine((route, context) => {
  try {
    const expected = sampleConnectionRoute(route)
    if (expected.length !== route.centerlineMm.length || expected.some((p, i) => !same(p, route.centerlineMm[i]))) throw new Error('连接保存的中心线须与控制源的确定性完整采样逐点一致。')
    const length = expected.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - expected[i].x, p.y - expected[i].y), 0)
    if (Math.ceil(length / route.treadDepthMm) > CONNECTION_ROUTE_LIMITS.treads) throw new Error('连接按世界弧长派生的踏面超过512级预算。')
  } catch (error) { context.addIssue({ code: 'custom', message: error instanceof Error ? error.message : String(error) }) }
})
export interface ConnectionRouteGeometry {
  from: { positionMm: PointMm }; to: { positionMm: PointMm }; widthMm: number; route?: ConnectionRoute
}
/** Absent route retains the old endpoint contract and old fixed pixels. */
export function connectionCenterline(connection: Pick<ConnectionRouteGeometry, 'from' | 'to' | 'route'>): PointMm[] {
  return connection.route ? connection.route.centerlineMm.map(p => ({ ...p })) : [{ ...connection.from.positionMm }, { ...connection.to.positionMm }]
}

/** Disposable linear stationing over saved full geometry. Tangents follow the
 * actual segment; a tread never restarts its phase at a control-point join. */
export function connectionArcFrame(points: readonly PointMm[]) {
  if (points.length < 2) throw new Error('连接中心线至少需要两个点。')
  const distances = [0]
  for (let i = 1; i < points.length; i++) {
    const span = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y)
    if (!(span > 0)) throw new Error('连接中心线不能含零长段。')
    distances.push(distances.at(-1)! + span)
  }
  const length = distances.at(-1)!
  const station = (rawDistance: number) => {
    const distance = Math.max(0, Math.min(length, rawDistance))
    let index = 1
    while (index < distances.length - 1 && distances[index] < distance) index++
    const a = points[index - 1], b = points[index], span = distances[index] - distances[index - 1], t = (distance - distances[index - 1]) / span
    const tangent = { x: (b.x - a.x) / span, y: (b.y - a.y) / span }
    return { positionMm: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, tangent, normal: { x: -tangent.y, y: tangent.x } }
  }
  const at = (distance: number, lateral = 0): PointMm => {
    const { positionMm, normal } = station(distance)
    return { x: positionMm.x + normal.x * lateral, y: positionMm.y + normal.y * lateral }
  }
  return { length, distances, station, at }
}
