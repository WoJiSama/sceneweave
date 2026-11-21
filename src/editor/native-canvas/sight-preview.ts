import type { PointMm } from '../../shared/model/scene'
import type { Projection } from '../../shared/projection/types'
import { lightVisibilityPolygon, occluderSegments, polygonSegments } from '../../platform/browser/render/visual-geometry'
import { pointInPolygon } from '../../shared/geometry/geometry'
import { playerMaskContains, playerMaskRings } from '../../shared/projection/player-mask'
import { projectedSightOccluders } from '../../shared/visual/projection'

export const SIGHT_PREVIEW_RADIUS_MM = 12_000

/** The audience has already been resolved before rays read any blocker. */
export function previewSight(projection: Projection, origin: PointMm) {
  const player = projection.audience === 'player'
  if (player && playerMaskContains(origin, projection.masks, projection.maskPublicRooms)) return null
  const occlusion = projection.visual ?? projectedSightOccluders(projection)
  if (occlusion.occluderRings.some(ring => pointInPolygon(origin, ring, false))) return []
  const maskEdges = player ? playerMaskRings(projection.masks, projection.maskPublicRooms).flatMap(polygonSegments) : []
  return lightVisibilityPolygon(origin, SIGHT_PREVIEW_RADIUS_MM, [...occluderSegments(occlusion), ...maskEdges])
}
