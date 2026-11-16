import type { PointMm } from '../model/scene.js'
import type { ProjectedWall } from '../projection/types.js'

export interface WallGeometry { wall: ProjectedWall; polygons: PointMm[][] }
const EPS = 1e-6
const point = (x: number, y: number): PointMm => ({ x, y })
const same = (a: PointMm, b: PointMm) => Math.abs(a.x - b.x) < EPS && Math.abs(a.y - b.y) < EPS
const signedArea = (points: PointMm[]) => points.reduce((sum, p, i) => sum + p.x * points[(i + 1) % points.length].y - points[(i + 1) % points.length].x * p.y, 0)
const positiveRing = (points: PointMm[]) => signedArea(points) < 0 ? [...points].reverse() : points
function wallBand(start: PointMm, end: PointMm, thickness: number): PointMm[] {
  const length = Math.hypot(end.x - start.x, end.y - start.y), nx = -(end.y - start.y) / length * thickness / 2, ny = (end.x - start.x) / length * thickness / 2
  return positiveRing([point(start.x + nx, start.y + ny), point(start.x - nx, start.y - ny), point(end.x - nx, end.y - ny), point(end.x + nx, end.y + ny)])
}
/** The same centerline bands/miterLimit=2/bevel rule as the domain; no coordinates are written back. */
export function wallGeometry(walls: ProjectedWall[]): WallGeometry[] {
  const result = walls.map(wall => {
    const dx = wall.end.x - wall.start.x, dy = wall.end.y - wall.start.y, length = Math.hypot(dx, dy), ux = dx / length, uy = dy / length
    if (!(length > 0)) throw new Error('墙长必须大于零。')
    const position = (p: PointMm) => (p.x - wall.start.x) * ux + (p.y - wall.start.y) * uy
    const intervals = wall.openings.map(o => [Math.min(position(o.start), position(o.end)), Math.max(position(o.start), position(o.end))]).sort((a, b) => a[0] - b[0])
    const solids: [number, number][] = []; let from = 0
    for (const [near, far] of intervals) { if (near > from + EPS) solids.push([from, near]); from = Math.max(from, far) }
    if (from < length - EPS) solids.push([from, length])
    return { wall, polygons: solids.map(([a, b]) => wallBand(point(wall.start.x + ux * a, wall.start.y + uy * a), point(wall.start.x + ux * b, wall.start.y + uy * b), wall.thicknessMm)) }
  })
  for (let i = 0; i < walls.length; i++) for (let j = i + 1; j < walls.length; j++) {
    const a = walls[i], b = walls[j], shared = [a.start, a.end].find(p => same(p, b.start) || same(p, b.end))
    if (!shared) continue
    const endA = same(shared, a.start) ? a.end : a.start, endB = same(shared, b.start) ? b.end : b.start
    const la = Math.hypot(endA.x - shared.x, endA.y - shared.y), lb = Math.hypot(endB.x - shared.x, endB.y - shared.y)
    const u = point((endA.x - shared.x) / la, (endA.y - shared.y) / la), v = point((endB.x - shared.x) / lb, (endB.y - shared.y) / lb), determinant = u.x * v.y - u.y * v.x
    if (Math.abs(determinant) < 1e-12) continue
    const ra = a.thicknessMm / 2, rb = b.thicknessMm / 2
    for (const sign of [-1, 1]) {
      const p = point(shared.x + u.y * ra * sign, shared.y - u.x * ra * sign), q = point(shared.x - v.y * rb * sign, shared.y + v.x * rb * sign)
      const t = ((q.x - p.x) * v.y - (q.y - p.y) * v.x) / determinant, miter = point(p.x + u.x * t, p.y + u.y * t)
      const ring = Math.hypot(miter.x - shared.x, miter.y - shared.y) <= 2 * Math.max(ra, rb) + EPS ? [shared, p, miter, q] : [shared, p, q]
      if (Math.abs(signedArea(ring)) > EPS) result[i].polygons.push(positiveRing(ring))
    }
  }
  return result
}
