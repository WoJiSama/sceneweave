import type { PointMm } from '../../../model/scene.js'
import type { InteriorRectangle } from './contracts.js'

/** Conservative 100mm room halo. Anything excluded is separated from every
 * supported in-room body/use strip by at least the existing furniture gap.
 * AABB overlap only retains extra work; it never proves a placement is clear. */
export function mayAffectInteriorRoom(polygon: readonly PointMm[], room: InteriorRectangle): boolean {
  if (!polygon.length) return true
  const x = polygon.map(p => p.x), y = polygon.map(p => p.y)
  return Math.max(...x) + 100 >= room.x && Math.min(...x) - 100 <= room.x + room.width
    && Math.max(...y) + 100 >= room.y && Math.min(...y) - 100 <= room.y + room.height
}
