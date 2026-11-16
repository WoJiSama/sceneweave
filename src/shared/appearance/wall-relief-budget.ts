import type { BoundsMm, Issue, PointMm, SceneDocument } from '../model/scene.js'
import type { ProjectedOpening, ProjectedWall } from '../projection/types.js'
import { openingEndpoints } from '../geometry/geometry.js'
import { wallGeometry, type WallGeometry } from '../geometry/wall-paint-geometry.js'
import { WALL_RELIEF_ADDITION_LIMIT, WALL_RELIEF_LIMIT_MM, WALL_RELIEF_NETWORK_LIMIT, wallSupportsRelief } from './wall-edge-profile.js'

const fail = () => { throw new Error('块石外缘超过有限派生预算，请减少同楼层墙体/开口或增大材质尺寸。') }
const bounds = (points: PointMm[], padding = 0): BoundsMm => {
  const xs = points.map(p => p.x), ys = points.map(p => p.y)
  return { x: Math.min(...xs) - padding, y: Math.min(...ys) - padding,
    width: Math.max(...xs) - Math.min(...xs) + padding * 2, height: Math.max(...ys) - Math.min(...ys) + padding * 2 }
}
const overlaps = (a: BoundsMm, b: BoundsMm) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
export function wallReliefOpeningGuard(opening: ProjectedOpening, half: number): PointMm[] {
  const dx = opening.end.x - opening.start.x, dy = opening.end.y - opening.start.y, length = Math.hypot(dx, dy), nx = -dy / length * half, ny = dx / length * half
  return [{ x: opening.start.x + nx, y: opening.start.y + ny }, { x: opening.end.x + nx, y: opening.end.y + ny },
    { x: opening.end.x - nx, y: opening.end.y - ny }, { x: opening.start.x - nx, y: opening.start.y - ny }]
}

/** Returns occupy only the solid interval between this opening, the next one,
 * and the actual wall end. A narrow end pier must never become a 110mm overhang. */
export function wallReliefJambReturns(wall: ProjectedWall, maximumForBudget = false): PointMm[][] {
  const result: PointMm[][] = []
  for (const opening of wall.openings) {
    const dx = opening.end.x - opening.start.x, dy = opening.end.y - opening.start.y, length = Math.hypot(dx, dy), ux = dx / length, uy = dy / length
    const along = (p: PointMm) => (p.x - opening.start.x) * ux + (p.y - opening.start.y) * uy
    const limits = [along(wall.start), along(wall.end)]
    let before = Math.min(...limits), after = Math.max(...limits)
    for (const other of wall.openings) if (other !== opening) {
      const a = along(other.start), b = along(other.end), near = Math.min(a, b), far = Math.max(a, b)
      if (far <= 1e-6) before = Math.max(before, far)
      if (near >= length - 1e-6) after = Math.min(after, near)
    }
    const half = wall.thicknessMm / 2 + 32
    for (const [point, sign, available] of [[opening.start, -1, -before], [opening.end, 1, after - length]] as const) {
      const width = maximumForBudget ? 110 : Math.min(110, Math.max(0, available))
      if (width < 1e-6) continue
      result.push([[0, half], [sign * width, half], [sign * width, -half], [0, -half]]
        .map(([x, y]) => ({ x: point.x + ux * x - uy * y, y: point.y + uy * x + ux * y })))
    }
  }
  return result
}

/** Filling a private opening can expose the complete long wall edge. Charge
 * that full band plus opening/join edges, omitting duplicate covered pieces. */
function budgetEdges(geometry: readonly WallGeometry[]): (readonly [PointMm, PointMm])[] {
  return geometry.flatMap(item => {
    const { start, end, thicknessMm } = item.wall, dx = end.x - start.x, dy = end.y - start.y, length = Math.hypot(dx, dy)
    const nx = -dy / length * thicknessMm / 2, ny = dx / length * thicknessMm / 2
    const ring = [{ x: start.x + nx, y: start.y + ny }, { x: end.x + nx, y: end.y + ny },
      { x: end.x - nx, y: end.y - ny }, { x: start.x - nx, y: start.y - ny }]
    const full = ring.map((a, index) => [a, ring[(index + 1) % ring.length]] as const)
    const on = (p: PointMm, [a, b]: readonly [PointMm, PointMm]) => {
      const ex = b.x - a.x, ey = b.y - a.y, l2 = ex * ex + ey * ey, t = ((p.x - a.x) * ex + (p.y - a.y) * ey) / l2
      return t >= -1e-9 && t <= 1 + 1e-9 && Math.abs((p.x - a.x) * ey - (p.y - a.y) * ex) <= 1e-6 * Math.sqrt(l2)
    }
    return [...full, ...item.polygons.flatMap(polygon => polygon.map((a, index) => [a, polygon[(index + 1) % polygon.length]] as const))
      .filter(edge => !full.some(side => on(edge[0], side) && on(edge[1], side)))]
  })
}

/** Conservative admission uses every physical source polygon, including those
 * hidden by other walls. Removing private walls/openings can expose that source
 * perimeter, but cannot add a new source edge. No audience or entity ID seeds it.
 * This intentionally refuses some complex networks before union or drawing. */
export function assertWallReliefBudget(geometry: readonly WallGeometry[]): void {
  const enabled = geometry.filter(item => wallSupportsRelief(item.wall))
  if (!enabled.length) return
  const openingCount = geometry.reduce((sum, item) => sum + item.wall.openings.length, 0)
  if (geometry.length > WALL_RELIEF_NETWORK_LIMIT || openingCount > WALL_RELIEF_NETWORK_LIMIT) fail()
  const edges = budgetEdges(geometry)
  if (edges.length > 8192) fail()
  const lengths = edges.map(([a, b]) => Math.hypot(b.x - a.x, b.y - a.y)), perimeter = lengths.reduce((a, b) => a + b, 0)
  const tile = Math.min(...enabled.flatMap(item => [item.wall.style!.base.tileSizeMm.width, item.wall.style!.base.tileSizeMm.height]))
  // A segment crosses at most 6*length/tile rows and three column boundaries
  // per tile per row; 27*perimeter/tile bounds cuts before the 30mm span skip.
  if (!Number.isFinite(perimeter) || !(tile > 0) || 9 + 27 * perimeter / tile > 8192) fail()
  if (lengths.reduce((sum, length) => sum + Math.ceil(length / 512) + 1, 0) > 8192) fail()
  const guards = geometry.flatMap(item => item.wall.openings.map(opening => bounds(wallReliefOpeningGuard(opening, item.wall.thicknessMm + WALL_RELIEF_LIMIT_MM * 4))))
  let additions = 0
  const charge = (box: BoundsMm, count: number) => {
    const intersecting = guards.reduce((sum, guard) => sum + Number(overlaps(box, guard)), 0)
    // The arrangement of m convex rectangles has fewer than (m+1)^2 faces.
    // Charging all faces also covers disconnected pieces after subtraction.
    additions += count * (intersecting + 1) ** 2
    if (additions > WALL_RELIEF_ADDITION_LIMIT) fail()
  }
  for (let index = 0; index < edges.length; index++) {
    const [a, b] = edges[index], length = lengths[index], axis = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y) ? 'x' : 'y'
    const distance = b[axis] - a[axis]
    if (!(length > 0)) continue
    const low = Math.min(a[axis], b[axis]), high = Math.max(a[axis], b[axis])
    const first = Math.floor(low / 512), last = Math.ceil(high / 512) - 1
    for (let chunk = first; chunk <= last; chunk++) {
      const at = (coordinate: number) => { const t = (coordinate - a[axis]) / distance; return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t } }
      const span = (Math.min(high, (chunk + 1) * 512) - Math.max(low, chunk * 512)) / Math.abs(distance) * length
      // Lips have disjoint spans >=30mm. Two extra spans cover candidates
      // crossing either chunk end. Query the complete world-grid interval even
      // for a partial edge: collinear splitting/merging cannot raise admission.
      charge(bounds([at(chunk * 512), at((chunk + 1) * 512)], WALL_RELIEF_LIMIT_MM), Math.ceil(span / 30) + 2)
    }
  }
  for (const item of enabled) for (const polygon of wallReliefJambReturns(item.wall, true)) charge(bounds(polygon), 1)
}

export function inspectSceneWallReliefBudget(scene: SceneDocument): Issue[] {
  const floors = new Set(Object.values(scene.walls).filter(wall => wall.edgeProfile).map(wall => wall.floorId))
  const errors: Issue[] = []
  for (const floorId of floors) try {
    const walls = Object.values(scene.walls).filter(wall => wall.floorId === floorId)
    const openings = Object.values(scene.openings).filter(opening => opening.floorId === floorId)
    if (walls.length > WALL_RELIEF_NETWORK_LIMIT || openings.length > WALL_RELIEF_NETWORK_LIMIT) fail()
    const projected = walls.map(wall => {
      const a = scene.vertices[wall.startVertexId], b = scene.vertices[wall.endVertexId]
      return { id: wall.id, sourceIds: [wall.id], start: { x: a.xMm, y: a.yMm }, end: { x: b.xMm, y: b.yMm },
        thicknessMm: wall.thicknessMm, style: wall.topStyle, edgeProfile: wall.edgeProfile,
        openings: openings.filter(opening => opening.wallId === wall.id).map(opening => {
          const [start, end] = openingEndpoints(scene, opening)
          return { id: opening.id, start, end, widthMm: opening.widthMm, kind: opening.kind, state: opening.state, secret: opening.secret }
        }) }
    })
    assertWallReliefBudget(wallGeometry(projected))
  } catch (cause) { errors.push({ code: 'WALL_RELIEF_BUDGET', entityId: floorId, message: cause instanceof Error ? cause.message : String(cause) }) }
  return errors
}
