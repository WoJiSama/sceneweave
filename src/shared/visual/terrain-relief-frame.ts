import type { MultiPolygon } from 'polygon-clipping'
import type { BoundsMm, PointMm } from '../model/scene.js'

/** Disposable, audience/Floor-filtered faces. These coordinates never replace
 * the integer world geometry or grant physical support/passage. */
export interface ReliefTop { id: string; z: number; regions: MultiPolygon }
export interface ReliefWall { a: [number, number]; b: [number, number]; low: number; high: number; highId: string; lowId: string }
export interface ReliefGeometry { tops: readonly ReliefTop[]; walls: readonly ReliefWall[] }
export interface ReliefHit {
  kind: 'top' | 'wall'
  sourceId: string
  positionMm: PointMm
  elevationMm: number
  /** A wall is a painted exterior, not a placeable ground surface. */
  ground: boolean
}
const EPS = 1e-6
const cross = (ax: number, ay: number, bx: number, by: number) => ax * by - ay * bx

/** Even-odd holes remain holes, including disconnected components. */
export function reliefContains(regions: MultiPolygon, point: PointMm, includeBoundary = true): boolean {
  return regions.some(polygon => {
    let inside = false
    for (const ring of polygon) {
      let ringInside = false
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i], b = ring[(i + 1) % ring.length]
        const dx = b[0] - a[0], dy = b[1] - a[1], length = Math.hypot(dx, dy)
        const px = point.x - a[0], py = point.y - a[1]
        if (length > 0 && Math.abs(cross(dx, dy, px, py)) <= EPS * length
          && px * dx + py * dy >= -EPS * length && px * dx + py * dy <= length * length + EPS * length) return includeBoundary
        if ((a[1] > point.y) !== (b[1] > point.y) && point.x < dx * (point.y - a[1]) / dy + a[0]) ringInside = !ringInside
      }
      if (ringInside) inside = !inside
    }
    return inside
  })
}

/** One affine observation shared by ground, sprite roots, overlays and picking.
 * Input/output use millimetres before viewport fit/zoom. Known support elevation
 * is required for inverse placement; it must never be guessed from paint order.
 * The frame owns a copy of its offset so caller mutation cannot move a render. */
export function createTerrainReliefFrame(offsetPerHeight: PointMm) {
  if (![offsetPerHeight.x, offsetPerHeight.y].every(Number.isFinite)) throw new Error('地形观察方向必须为有限数值。')
  const offset = Object.freeze({ x: offsetPerHeight.x, y: offsetPerHeight.y })
  const project = (positionMm: PointMm, elevationMm: number): PointMm => ({
    x: positionMm.x + offset.x * elevationMm, y: positionMm.y + offset.y * elevationMm,
  })
  const inverseAtElevation = (viewMm: PointMm, elevationMm: number): PointMm => ({
    x: viewMm.x - offset.x * elevationMm, y: viewMm.y - offset.y * elevationMm,
  })
  const wallHit = (wall: ReliefWall, viewMm: PointMm): ReliefHit | null => {
    const dx = wall.b[0] - wall.a[0], dy = wall.b[1] - wall.a[1], length = Math.hypot(dx, dy)
    if (length <= EPS || wall.high <= wall.low) return null
    const denominator = cross(dx, dy, offset.x, offset.y)
    // Edge-on faces have zero screen area and cannot intercept a pointer.
    if (Math.abs(denominator) <= length * 1e-12) return null
    const z = cross(dx, dy, viewMm.x - wall.a[0], viewMm.y - wall.a[1]) / denominator
    if (z < wall.low - EPS || z > wall.high + EPS) return null
    const point = inverseAtElevation(viewMm, z)
    const along = ((point.x - wall.a[0]) * dx + (point.y - wall.a[1]) * dy) / length
    if (along < -EPS || along > length + EPS) return null
    return { kind: 'wall', sourceId: wall.highId, positionMm: point, elevationMm: z, ground: false }
  }
  const pick = (geometry: ReliefGeometry, viewMm: PointMm): ReliefHit | null => {
    let result: ReliefHit | null = null
    for (const top of geometry.tops) {
      const point = inverseAtElevation(viewMm, top.z)
      if (reliefContains(top.regions, point) && (!result || top.z > result.elevationMm + EPS)) {
        result = { kind: 'top', sourceId: top.id, positionMm: point, elevationMm: top.z, ground: true }
      }
    }
    for (const wall of geometry.walls) {
      const hit = wallHit(wall, viewMm)
      // At a crest the top owns the tie. Wall hits cannot expose ground behind.
      if (hit && (!result || hit.elevationMm > result.elevationMm + EPS)) result = hit
    }
    return result
  }
  const projectedBounds = (geometry: ReliefGeometry): BoundsMm | null => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    const include = (x: number, y: number, z: number) => {
      const p = project({ x, y }, z)
      minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y)
    }
    for (const top of geometry.tops) for (const polygon of top.regions) for (const ring of polygon) for (const [x, y] of ring) include(x, y, top.z)
    for (const wall of geometry.walls) for (const [x, y] of [wall.a, wall.b]) { include(x, y, wall.low); include(x, y, wall.high) }
    return minX === Infinity ? null : { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
  }
  return Object.freeze({ offsetPerHeight: offset, project, inverseAtElevation, wallHit, pick, projectedBounds })
}
