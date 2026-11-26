import { pointInPolygon } from '../../../shared/geometry/geometry.js'
import { reliefBounds, sampleTerrainRelief } from '../../../shared/geometry/terrain-relief.js'
import type { PointMm } from '../../../shared/model/scene.js'
import type { ProjectedSurface, ProjectedWall, Projection } from '../../../shared/projection/types.js'

const inside = (p: PointMm, area: ProjectedSurface) => area.regionsMm
  ? area.regionsMm.some(row => pointInPolygon(p, row.outerMm) && !row.holesMm.some(hole => pointInPolygon(p, hole)))
  : pointInPolygon(p, area.points)

/** Renderer queries use the terrain, cuts and rooms already filtered for this audience. */
export function projectGround(projection: Projection, zOffset = 0) {
  const all = [...projection.terrain.filter(area => !area.bridgeSupport), ...projection.rooms].reverse()
  const levels = new Map(all.map(area => [area.id, area]))
  const boxes = new Map(all.map(area => [area.id, reliefBounds(area.points)]))
  const elevation = (area: ProjectedSurface | undefined, p: PointMm) =>
    zOffset + (area?.elevationMm ?? 0) + (area?.relief ? sampleTerrainRelief(area.relief, boxes.get(area.id)!, p).offsetMm : 0)
  const patches = [...projection.inlays ?? [], ...projection.rocks ?? []].flatMap(row => row.patches).map(patch => ({
    ...patch, bounds: reliefBounds(patch.pointsMm),
  }))
  const within = (p: PointMm, bounds: ReturnType<typeof reliefBounds>) => p.x >= bounds.x && p.x <= bounds.x + bounds.width && p.y >= bounds.y && p.y <= bounds.y + bounds.height
  const surfaceAt = (p: PointMm) => all.find(area => within(p, boxes.get(area.id)!) && inside(p, area))
  const groundAt = (p: PointMm) => {
    const patch = patches.find(({ pointsMm, bounds }) => within(p, bounds) && pointsMm.length === 3 && pointInPolygon(p, pointsMm))
    if (patch) {
      const [a, b, c] = patch.pointsMm, [za, zb, zc] = patch.elevationsMm
      const ux = b.x - a.x, uy = b.y - a.y, vx = c.x - a.x, vy = c.y - a.y
      const px = p.x - a.x, py = p.y - a.y, area = ux * vy - uy * vx
      if (area) return zOffset + za + (zb - za) * (px * vy - py * vx) / area + (zc - za) * (ux * py - uy * px) / area
    }
    return elevation(surfaceAt(p), p)
  }
  return { all, levels, boxes, elevation, groundAt, surfaceAt }
}

export function spatialWallFrame(projection: Projection, ground: ReturnType<typeof projectGround>, wall: ProjectedWall) {
  const center = { x: (wall.start.x + wall.end.x) / 2, y: (wall.start.y + wall.end.y) / 2 }
  const dx = wall.end.x - wall.start.x, dy = wall.end.y - wall.start.y, span = Math.hypot(dx, dy)
  const nx = -dy / span, ny = dx / span, distance = wall.thicknessMm / 2 + 8
  const neighbours = [-1, 1].map(side => projection.rooms.find(room => pointInPolygon({ x: center.x + nx * distance * side, y: center.y + ny * distance * side }, room.points)))
  const sign = neighbours[0] ? 1 : -1
  const room = neighbours[0] ?? neighbours[1]
  const floor = room ? ground.elevation(room, center) : ground.groundAt(center)
  const fade = Boolean(neighbours[0]) !== Boolean(neighbours[1]) ? { center, nearSide: { x: nx * sign, y: ny * sign } } : undefined
  return { floor, fade }
}
