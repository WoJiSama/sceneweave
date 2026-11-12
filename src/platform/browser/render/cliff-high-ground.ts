import polygonClipping, { type MultiPolygon, type Ring } from 'polygon-clipping'
import { pointInPolygon } from '../../../shared/geometry/geometry.js'
import type { PointMm } from '../../../shared/model/scene.js'
import { bandRings } from './visual-geometry.js'
import type { ProjectedSurface, ProjectedVisualBoundary, Projection } from '../../../shared/projection/types.js'

export interface CliffHighGround {
  /** Visible high-side polygons, including holes cut by higher coverage paints. */
  excludedRings: PointMm[][]
  /** The largest actual visible step met by this boundary; absent for decorative/unresolved cliffs. */
  dropMm?: number
}
const ring = (points: readonly PointMm[]): Ring => points.map(point => [point.x, point.y])
const polygon = (surface: ProjectedSurface): MultiPolygon => [[ring(surface.points)]]

/** Consume only the audience-owned projection. A bound area is not necessarily
 * the high side: a higher-priority crater can expose a lower floor inside a
 * mountain, including when both elevations are above zero. */
export function cliffHighGround(projection: Pick<Projection, 'terrain' | 'bounds'>, boundary: Pick<ProjectedVisualBoundary, 'points' | 'closed' | 'terrainAreaIds'>, paintPaddingMm = Math.max(projection.bounds.width, projection.bounds.height) * 2): CliffHighGround {
  if (!boundary.terrainAreaIds.length || boundary.points.length < 2) return { excludedRings: [] }
  // Projection order already includes coveragePriority, layer order and stable
  // ties. Retain it for equal priorities; never infer coverage from elevation.
  const surfaces = projection.terrain.map((surface, index) => ({ surface, index }))
    .sort((a, b) => a.surface.priority - b.surface.priority || a.index - b.index).map(row => row.surface)
  if (!(paintPaddingMm > 0) || !Number.isFinite(paintPaddingMm)) throw new Error('崖面裁剪范围必须为有限正数。')
  const floorKey = Symbol('projected Floor'), key = (surface: ProjectedSurface | null) => surface?.id ?? floorKey
  type SurfaceKey = ReturnType<typeof key>
  const bound = new Set(boundary.terrainAreaIds), highIds = new Set<SurfaceKey>(), lowIds = new Set<SurfaceKey>()
  const lastBoundIndex = surfaces.reduce((last, surface, index) => bound.has(surface.id) ? Math.max(last, index) : last, -1)
  const isLaterCover = (surface: ProjectedSurface | null) => surface && lastBoundIndex >= 0 && surfaces.indexOf(surface) > lastBoundIndex
  const highRuns = new Map<SurfaceKey, PointMm[][]>()
  const same = (a: PointMm, b: PointMm) => Math.hypot(a.x - b.x, a.y - b.y) < 1e-6
  const recordHigh = (surface: ProjectedSurface | null, a: PointMm, b: PointMm) => {
    const id = key(surface), runs = highRuns.get(id) ?? []
    highIds.add(id)
    if (runs.length && same(runs.at(-1)!.at(-1)!, a)) runs.at(-1)!.push(b)
    else runs.push([a, b])
    highRuns.set(id, runs)
  }
  const visible = (point: PointMm) => {
    for (let i = surfaces.length - 1; i >= 0; i--) if (pointInPolygon(point, surfaces[i].points, false)) return surfaces[i]
    return null // Exposed Floor ground is zero; no source/hidden surface is consulted.
  }
  let dropMm = 0
  for (let index = 0; index < boundary.points.length - (boundary.closed ? 0 : 1); index++) {
    const a = boundary.points[index], b = boundary.points[(index + 1) % boundary.points.length]
    const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy)
    if (!length) continue
    // Split at actual terrain crossings, so a narrow projected cover cannot
    // disappear between probes. Collinear endpoints are also split explicitly.
    const cuts = [0, 1], cross = (x: number, y: number, u: number, v: number) => x * v - y * u
    for (const surface of surfaces) for (let edge = 0; edge < surface.points.length; edge++) {
      const c = surface.points[edge], d = surface.points[(edge + 1) % surface.points.length]
      const ex = d.x - c.x, ey = d.y - c.y, determinant = cross(dx, dy, ex, ey)
      if (Math.abs(determinant) < 1e-8) {
        if (Math.abs(cross(c.x - a.x, c.y - a.y, dx, dy)) < 1e-6) {
          for (const p of [c, d]) { const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / (length * length); if (t > 0 && t < 1) cuts.push(t) }
        }
        continue
      }
      const t = cross(c.x - a.x, c.y - a.y, ex, ey) / determinant, u = cross(c.x - a.x, c.y - a.y, dx, dy) / determinant
      if (t > 0 && t < 1 && u >= 0 && u <= 1) cuts.push(t)
    }
    const sorted = [...new Set(cuts)].sort((x, y) => x - y)
    for (let cut = 0; cut < sorted.length - 1; cut++) {
      if ((sorted[cut + 1] - sorted[cut]) * length < 1e-6) continue
      const t = (sorted[cut] + sorted[cut + 1]) / 2
      // World-space probes are sub-millimetre and independent of output zoom.
      const distance = Math.min(.5, (sorted[cut + 1] - sorted[cut]) * length / 8), nx = -dy / length * distance, ny = dx / length * distance
      const p = { x: a.x + dx * t, y: a.y + dy * t }
      const from = { x: a.x + dx * sorted[cut], y: a.y + dy * sorted[cut] }, to = { x: a.x + dx * sorted[cut + 1], y: a.y + dy * sorted[cut + 1] }
      const left = visible({ x: p.x + nx, y: p.y + ny }), right = visible({ x: p.x - nx, y: p.y - ny })
      if ((!left || !bound.has(left.id)) && (!right || !bound.has(right.id))) {
        // Later public paints can entirely cover the bound edge. Preserve that
        // occlusion even when the covering terrain happens to be lower.
        if (isLaterCover(left)) recordHigh(left, from, to)
        if (right !== left && isLaterCover(right)) recordHigh(right, from, to)
        continue
      }
      const leftElevation = left?.elevationMm ?? 0, rightElevation = right?.elevationMm ?? 0
      if (leftElevation === rightElevation) continue
      const high = leftElevation > rightElevation ? left : right
      recordHigh(high, from, to)
      lowIds.add(key(leftElevation > rightElevation ? right : left))
      dropMm = Math.max(dropMm, Math.abs(leftElevation - rightElevation))
    }
  }
  const localHigh = (id: SurfaceKey, visibleHigh: MultiPolygon): MultiPolygon => {
    if (!lowIds.has(id)) return visibleHigh
    // A surface can be high along one stretch and low along another. Limit
    // its mask to contiguous high runs instead of erasing both sides globally.
    const runs = highRuns.get(id) ?? []
    if (runs.length > 1 && same(runs.at(-1)!.at(-1)!, runs[0][0])) {
      runs[0] = [...runs.at(-1)!.slice(0, -1), ...runs[0]]; runs.pop()
    }
    const bands = runs.map(points => [bandRings(points, -paintPaddingMm, paintPaddingMm).map(ring)] as MultiPolygon).filter(parts => parts[0].length)
    return bands.length ? polygonClipping.intersection(visibleHigh, polygonClipping.union(bands[0], ...bands.slice(1))) : []
  }
  const rings: PointMm[][] = []
  for (const [index, surface] of surfaces.entries()) {
    if (!highIds.has(surface.id)) continue
    const covers = surfaces.slice(index + 1).map(polygon)
    const visibleHigh = covers.length ? polygonClipping.difference(polygon(surface), ...covers) : polygon(surface)
    for (const region of localHigh(surface.id, visibleHigh)) for (const points of region) rings.push(points.map(([x, y]) => ({ x, y })))
  }
  if (highIds.has(floorKey)) {
    const b = projection.bounds, floor: MultiPolygon = [[[[b.x, b.y], [b.x + b.width, b.y], [b.x + b.width, b.y + b.height], [b.x, b.y + b.height]]]]
    const exposed = surfaces.length ? polygonClipping.difference(floor, ...surfaces.map(polygon)) : floor
    for (const region of localHigh(floorKey, exposed)) for (const points of region) rings.push(points.map(([x, y]) => ({ x, y })))
  }
  return { excludedRings: rings, ...(dropMm ? { dropMm } : {}) }
}
