import { pointInPolygon } from '../../../shared/geometry/geometry.js'
import { reliefBounds, sampleTerrainRelief } from '../../../shared/geometry/terrain-relief.js'
import type { PointMm } from '../../../shared/model/scene.js'
import type { ProjectedSurface, Projection } from '../../../shared/projection/types.js'

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
