import type { PointMm, PropDefinition, VersionRef } from '../../../model/scene.js'
import { polygonDistance, polygonInside, polygonsOverlap } from '../../../geometry/geometry.js'
import type { InteriorRectangle } from './contracts.js'
import { furnitureBoundsPolygon, furniturePoseCandidates, type FurnitureAnchor, type FurnishingPose, type FurnishingShape } from './furnishing-poses.js'

export interface FurnitureSeatReservation extends FurnishingPose {
  anchorKey: string
  definitionRef: VersionRef
  usePolygon: PointMm[]
  claimed: boolean
}

/** A finite generation suggestion: retain the full painted/physical seat and
 * 600mm behind its authored +Y front for pulling it out and standing up. This
 * temporary reservation never becomes a permanent rule on manual editing. */
function furnitureSpacePolygon(shape: FurnishingShape, pose: FurnishingPose, rearMm: number, frontMm: number): PointMm[] {
  const minX = Math.min(shape.visualBoundsMm.x, shape.footprintOffsetMm.x - shape.footprintMm.width / 2)
  const maxX = Math.max(shape.visualBoundsMm.x + shape.visualBoundsMm.width, shape.footprintOffsetMm.x + shape.footprintMm.width / 2)
  const minY = Math.min(shape.visualBoundsMm.y, shape.footprintOffsetMm.y - shape.footprintMm.height / 2) - rearMm
  const maxY = Math.max(shape.visualBoundsMm.y + shape.visualBoundsMm.height, shape.footprintOffsetMm.y + shape.footprintMm.height / 2) + frontMm
  return furnitureBoundsPolygon({ x: minX, y: minY, width: maxX - minX, height: maxY - minY }, pose)
}
export const furnitureUseSpacePolygon = (shape: FurnishingShape, pose: FurnishingPose) => furnitureSpacePolygon(shape, pose, 600, 0)
/** Standing work/hearth suggestions leave a full-width 600mm operating strip
 * in front when their room has no seated-work suggestion. */
export const furnitureWorkingSpacePolygon = (shape: FurnishingShape, pose: FurnishingPose) => furnitureSpacePolygon(shape, pose, 0, 600)

export const definitionFurnishingShape = (definition: PropDefinition): FurnishingShape => ({ visualBoundsMm: definition.defaultVisualBoundsMm,
  footprintMm: definition.defaultFootprintMm, footprintOffsetMm: definition.defaultFootprintOffsetMm })

/** Reserve actual complete chairs before accepting an anchor, so a second
 * table or wall cupboard cannot consume a promised function group's space.
 * The caller additionally checks the native candidate and its real routes. */
export function planFurnitureSeats(options: { anchorKey: string; anchor: FurnitureAnchor; seats: readonly PropDefinition[]; count: number; bounds: InteriorRectangle; inset: number;
  roomPolygon: PointMm[]; blockers: PointMm[][]; routeBands: PointMm[][]; rank: (key: string) => string;
  checkCancelled: () => void; chargeCandidate: () => void; chargePair: () => void }): FurnitureSeatReservation[] {
  const planned: FurnitureSeatReservation[] = []
  for (let slot = 0; slot < options.count; slot++) {
    let found = false
    for (const definition of options.seats) {
      const shape = definitionFurnishingShape(definition)
      const poses = furniturePoseCandidates(options.bounds, shape, options.inset, 'seat', [options.anchor], options.rank, undefined, options.count > 1)
      for (const pose of poses) {
        options.checkCancelled(); options.chargeCandidate()
        const usePolygon = furnitureUseSpacePolygon(shape, pose), painted = furnitureBoundsPolygon(shape.visualBoundsMm, pose)
        const physical = furnitureBoundsPolygon({ x: shape.footprintOffsetMm.x - shape.footprintMm.width / 2,
          y: shape.footprintOffsetMm.y - shape.footprintMm.height / 2, ...shape.footprintMm }, pose)
        if (!polygonInside(usePolygon, options.roomPolygon)) continue
        let blocked = false
        for (const polygon of [...options.blockers, ...planned.map(row => row.usePolygon)]) {
          options.chargePair()
          if (polygonsOverlap(usePolygon, polygon) || polygonDistance(usePolygon, polygon) < 100) { blocked = true; break }
        }
        if (blocked) continue
        for (const polygon of options.routeBands) {
          options.chargePair()
          if (polygonsOverlap(painted, polygon) || polygonsOverlap(physical, polygon)) { blocked = true; break }
        }
        if (blocked) continue
        planned.push({ ...pose, anchorKey: options.anchorKey, definitionRef: { id: definition.id, version: definition.version }, usePolygon, claimed: false })
        found = true; break
      }
      if (found) break
    }
    if (!found) break
  }
  return planned
}
