import polygonClipping, { type MultiPolygon, type Polygon } from 'polygon-clipping'
import type { PointMm } from '../model/scene.js'
import { pointInPolygon } from '../geometry/geometry.js'

/** Every overlapping mask must allow the point; a solid mask always wins. */
export function playerMaskContains(point: PointMm, masks: readonly PointMm[][], publicRooms?: readonly PointMm[][][]): boolean {
  return masks.some((mask, index) => pointInPolygon(point, mask, true)
    && !publicRooms?.[index]?.some(room => pointInPolygon(point, room, false)))
}

/** Resolve each mask's room exemptions before uniting overlapping opaque areas. */
export function playerMaskRings(masks: PointMm[][], publicRooms?: readonly PointMm[][][]): PointMm[][] {
  if (!publicRooms?.some(rooms => rooms.length)) return masks
  const pieces = masks.flatMap((mask, index) => {
    const polygon: Polygon = [mask.map(({ x, y }) => [x, y])]
    const holes: MultiPolygon = (publicRooms[index] ?? []).map(room => [room.map(({ x, y }) => [x, y])])
    return holes.length ? polygonClipping.difference(polygon, holes) : [polygon]
  })
  return pieces.length ? polygonClipping.union(pieces).flatMap(polygon => polygon.map(ring => ring.slice(0, -1).map(([x, y]) => ({ x, y })))) : []
}
