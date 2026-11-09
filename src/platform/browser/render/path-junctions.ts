import type { PointMm } from '../../../shared/model/scene.js'
import type { ProjectedPath, Projection } from '../../../shared/projection/types.js'
import { pointInPolygon } from '../../../shared/geometry/geometry.js'
import { canonicalJson } from '../../../shared/validation/json.js'

type Segment = [PointMm, PointMm]
const EPS = 1e-7
const cross = (a: PointMm, b: PointMm) => a.x * b.y - a.y * b.x
const minus = (a: PointMm, b: PointMm) => ({ x: a.x - b.x, y: a.y - b.y })
const at = (a: PointMm, b: PointMm, t: number) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
const edges = (points: PointMm[]): Segment[] => points.map((a, i) => [a, points[(i + 1) % points.length]])
const on = (p: PointMm, a: PointMm, b: PointMm) => {
  const d = minus(b, a), q = minus(p, a), length = Math.hypot(d.x, d.y)
  return Math.abs(cross(d, q)) <= EPS * Math.max(1, length)
    && q.x * d.x + q.y * d.y >= -EPS && q.x * d.x + q.y * d.y <= length * length + EPS
}
function cuts(a: PointMm, b: PointMm, c: PointMm, d: PointMm): number[] {
  const ab = minus(b, a), cd = minus(d, c), ac = minus(c, a), determinant = cross(ab, cd)
  if (Math.abs(determinant) > EPS) {
    const t = cross(ac, cd) / determinant, u = cross(ac, ab) / determinant
    return t > EPS && t < 1 - EPS && u >= -EPS && u <= 1 + EPS ? [t] : []
  }
  if (Math.abs(cross(ab, ac)) > EPS * Math.max(1, Math.hypot(ab.x, ab.y))) return []
  const length2 = ab.x * ab.x + ab.y * ab.y
  return [c, d].map(p => ((p.x - a.x) * ab.x + (p.y - a.y) * ab.y) / length2).filter(t => t > EPS && t < 1 - EPS)
}
const bounds = (path: ProjectedPath) => ({ left: Math.min(...path.points.map(p => p.x)), right: Math.max(...path.points.map(p => p.x)),
  top: Math.min(...path.points.map(p => p.y)), bottom: Math.max(...path.points.map(p => p.y)) })
const overlaps = (a: ReturnType<typeof bounds>, b: ReturnType<typeof bounds>) => a.left <= b.right && a.right >= b.left && a.top <= b.bottom && a.bottom >= b.top

/** Keep every physical band and its paint order. Only boundary segments lying
 * inside the compatible visible union are removed. No model or hit shape changes. */
export function pathJunctionOutlines(projection: Pick<Projection, 'paths' | 'pathJoinGroups' | 'visual'>): Map<string, Segment[]> {
  const result = new Map<string, Segment[]>(), byId = new Map(projection.paths.map(path => [path.id, path]))
  const filtered = new Set(projection.visual?.filters.flatMap(filter => filter.sourceEntityIds ?? []) ?? [])
  for (const ids of projection.pathJoinGroups ?? []) {
    const styles = new Map<string, ProjectedPath[]>()
    for (const id of ids) {
      const path = byId.get(id)
      // Entity/layer filters are applied to separate primitive buffers. Leave
      // their outlines independent rather than joining differently graded paint.
      if (!path || filtered.has(id)) continue
      const key = canonicalJson([path.style, path.edgeStyle]), group = styles.get(key) ?? []
      group.push(path); styles.set(key, group)
    }
    for (const group of styles.values()) {
      if (group.length < 2) continue
      const boxes = group.map(bounds), rings = group.map(path => edges(path.points))
      for (let index = 0; index < group.length; index++) {
        const path = group[index], peers = group.map((_path, i) => i).filter(i => i !== index && overlaps(boxes[index], boxes[i]))
        if (!peers.length) continue
        const outline: Segment[] = []
        for (const [a, b] of rings[index]) {
          const stations = [0, ...peers.flatMap(i => rings[i].flatMap(([c, d]) => cuts(a, b, c, d))), 1].sort((a, b) => a - b)
          const length = Math.hypot(b.x - a.x, b.y - a.y)
          if (!length) continue
          const normal = { x: -(b.y - a.y) / length * .001, y: (b.x - a.x) / length * .001 }
          for (let j = 1; j < stations.length; j++) {
            if (stations[j] - stations[j - 1] <= EPS) continue
            const mid = at(a, b, (stations[j] + stations[j - 1]) / 2)
            const left = { x: mid.x + normal.x, y: mid.y + normal.y }, right = { x: mid.x - normal.x, y: mid.y - normal.y }
            const inside = (p: PointMm) => [index, ...peers].some(i => pointInPolygon(p, group[i].points, false))
            if (inside(left) && inside(right)) continue
            // Coincident exterior edges have one owner, preventing double-dark
            // blur/strokes without changing which primitive is painted last.
            if (peers.some(i => i > index && rings[i].some(([c, d]) => on(mid, c, d)))) continue
            outline.push([at(a, b, stations[j - 1]), at(a, b, stations[j])])
          }
        }
        result.set(path.id, outline)
      }
    }
  }
  return result
}
