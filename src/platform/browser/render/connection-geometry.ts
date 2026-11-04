import type { PointMm } from '../../../shared/model/scene.js'
import type { ProjectedConnection } from '../../../shared/projection/types.js'
import { pointInPolygon, connectionBand } from '../../../shared/geometry/geometry.js'
import { connectionArcFrame } from '../../../shared/geometry/connection-route.js'

/** Disposable paint geometry; the saved endpoints and full physical width stay authoritative. */
export function connectionFrame(connection: Pick<ProjectedConnection, 'start' | 'end' | 'widthMm' | 'fromElevationMm' | 'toElevationMm' | 'route'>) {
  const ascending = connection.toElevationMm > connection.fromElevationMm
  const low = ascending ? connection.start : connection.end, high = ascending ? connection.end : connection.start
  if (connection.route) {
    const points = ascending ? connection.route.centerlineMm : [...connection.route.centerlineMm].reverse(), frame = connectionArcFrame(points)
    const up = frame.station(0).tangent, normal = frame.station(0).normal, ring = connectionBand(points, connection.widthMm)
    const sides = ring.map((p, i) => [p, ring[(i + 1) % ring.length]] as [PointMm, PointMm])
    return { low, high, length: frame.length, up, normal, at: frame.at, sides }
  }
  const length = Math.hypot(high.x - low.x, high.y - low.y)
  if (!(length > 0)) throw new Error('连接长度必须大于零。')
  const up = { x: (high.x - low.x) / length, y: (high.y - low.y) / length }, normal = { x: -up.y, y: up.x }
  const at = (distance: number, lateral = 0): PointMm => ({ x: low.x + up.x * distance + normal.x * lateral, y: low.y + up.y * distance + normal.y * lateral })
  return { low, high, length, up, normal, at, sides: [[at(0, connection.widthMm / 2), at(length, connection.widthMm / 2)], [at(0, -connection.widthMm / 2), at(length, -connection.widthMm / 2)]] as [PointMm, PointMm][] }
}

/** A visible connection cuts only a bound support boundary that its centreline
 * actually crosses. Contact with a nearby extruded face alone cannot open it. */
export function boundaryConnections(connections: readonly ProjectedConnection[], points: readonly PointMm[], closed: boolean, surfaceIds: readonly string[]): ProjectedConnection[] {
  if (points.length < 2 || !surfaceIds.length) return []
  return connections.filter(connection => {
    if (!connection.surfaceIds?.some(id => surfaceIds.includes(id))) return false
    if (closed && pointInPolygon(connection.start, [...points], false) === pointInPolygon(connection.end, [...points], false)) return false
    const centerline = connection.route?.centerlineMm ?? [connection.start, connection.end]
    const frame = connection.route ? connectionArcFrame(centerline) : undefined
    for (let segment = 1; segment < centerline.length; segment++) {
      const start = centerline[segment - 1], end = centerline[segment], dx = end.x - start.x, dy = end.y - start.y
      for (let i = 0; i < points.length - (closed ? 0 : 1); i++) {
        const a = points[i], b = points[(i + 1) % points.length], ex = b.x - a.x, ey = b.y - a.y, determinant = dx * ey - dy * ex
        if (Math.abs(determinant) < 1e-7) {
          if (frame && Math.abs(ex * (start.y - a.y) - ey * (start.x - a.x)) < 1e-7) {
            const axis = Math.abs(ex) >= Math.abs(ey) ? 'x' : 'y'
            if (Math.min(Math.max(start[axis], end[axis]), Math.max(a[axis], b[axis])) - Math.max(Math.min(start[axis], end[axis]), Math.min(a[axis], b[axis])) > 1e-7) return true
          }
          continue
        }
        const ax = a.x - start.x, ay = a.y - start.y
        const t = (ax * ey - ay * ex) / determinant, u = (ax * dy - ay * dx) / determinant
        // A sampled vertex may lie exactly on the shared boundary. Include
        // internal route vertices, but not a mere whole-connection endpoint.
        const internal = (t > 1e-7 || segment > 1 && t >= -1e-7) && (t < 1 - 1e-7 || segment < centerline.length - 1 && t <= 1 + 1e-7)
        if (internal && u >= -1e-7 && u <= 1 + 1e-7) {
          if (!frame) return true
          const distance = frame.distances[segment - 1] + t * (frame.distances[segment] - frame.distances[segment - 1]), epsilon = Math.min(.01, distance / 2, (frame.length - distance) / 2)
          const before = frame.at(distance - epsilon), after = frame.at(distance + epsilon)
          const side = (p: PointMm) => ex * (p.y - a.y) - ey * (p.x - a.x)
          if (side(before) * side(after) < 0) return true
        }
      }
    }
    return false
  })
}

/** Sequential differences give union semantics even where two openings overlap. */
export function clipConnectionOpenings(ctx: CanvasRenderingContext2D, bounds: { x: number; y: number; width: number; height: number }, connections: readonly ProjectedConnection[]): void {
  for (const connection of connections) {
    const { sides } = connectionFrame(connection), ring = connection.route ? connectionBand(connection.route.centerlineMm, connection.widthMm) : [sides[0][0], sides[0][1], sides[1][1], sides[1][0]], path = new Path2D()
    path.rect(bounds.x - 100000, bounds.y - 100000, bounds.width + 200000, bounds.height + 200000)
    ring.forEach((p, i) => i ? path.lineTo(p.x, p.y) : path.moveTo(p.x, p.y)); path.closePath()
    ctx.clip(path, 'evenodd')
  }
}

/** Cheek lines terminate the existing face at the exact two sides of the gap. */
export function drawConnectionCheeks(ctx: CanvasRenderingContext2D, connections: readonly ProjectedConnection[], color: string, widthMm: number, opacity: number): void {
  ctx.save(); ctx.strokeStyle = color; ctx.globalAlpha = opacity; ctx.lineWidth = widthMm; ctx.lineCap = 'butt'
  for (const connection of connections) for (const [start, end] of connectionFrame(connection).sides) {
    ctx.beginPath(); ctx.moveTo(start.x, start.y); ctx.lineTo(end.x, end.y); ctx.stroke()
  }
  ctx.restore()
}
