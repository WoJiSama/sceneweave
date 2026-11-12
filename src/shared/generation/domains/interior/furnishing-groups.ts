import type { InteriorFurnitureRole, InteriorRectangle } from './contracts.js'
import { furnitureBoundsPolygon, type FurnishingPose, type FurnishingShape } from './furnishing-poses.js'

export interface KitchenFurnitureAnchor extends FurnishingShape, FurnishingPose { role: InteriorFurnitureRole }
const kitchenRoles = new Set<InteriorFurnitureRole>(['work', 'hearth', 'storage', 'shelf'])
export const isKitchenPurpose = (purpose: string) => /厨房|烹饪|kitchen/.test(purpose.toLowerCase())
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0
const boundsOf = (shape: FurnishingShape) => ({
  left: Math.min(shape.visualBoundsMm.x, shape.footprintOffsetMm.x - shape.footprintMm.width / 2),
  right: Math.max(shape.visualBoundsMm.x + shape.visualBoundsMm.width, shape.footprintOffsetMm.x + shape.footprintMm.width / 2),
  back: Math.min(shape.visualBoundsMm.y, shape.footprintOffsetMm.y - shape.footprintMm.height / 2),
})

/** interior-layout@6 initial kitchen suggestions. Join complete fixed shapes
 * along their authored back edge, with a 100mm separation. Only actual cardinal
 * anchors supply a usable axis; arbitrary retained angles are not reinterpreted.
 * This supplies a finite preference, not a persistent dependency or permission
 * to move an anchor. Native support, doors, use space and routes remain checked
 * by the caller. Ordinary independent poses remain a reported fallback. */
export function kitchenFurnitureGroupCandidates(bounds: InteriorRectangle, shape: FurnishingShape, inset: number,
  role: InteriorFurnitureRole, anchors: readonly KitchenFurnitureAnchor[], rank: (key: string) => string,
  retainedRotation?: number): FurnishingPose[] {
  if (!kitchenRoles.has(role)) return []
  const own = boundsOf(shape), candidates: { pose: FurnishingPose; key: string; priority: number }[] = []
  const ordered = anchors.filter(anchor => kitchenRoles.has(anchor.role))
    .sort((a, b) => a.positionMm.y - b.positionMm.y || a.positionMm.x - b.positionMm.x || a.rotationDeg - b.rotationDeg || compare(a.role, b.role))
    .slice(0, 16)
  // Start at a wall end so later full-size worktops can extend along its run.
  // The legacy independent wall positions often spend the middle first. No
  // wall is assumed usable: the caller still checks actual doors and use space.
  if (!ordered.length && (role === 'work' || role === 'hearth')) {
    for (const rotationDeg of retainedRotation === undefined ? [0, 90, 180, 270] : [retainedRotation]) {
      const rotation = ((rotationDeg % 360) + 360) % 360
      if (!Number.isInteger(rotation / 90)) continue
      const physical = { x: shape.footprintOffsetMm.x - shape.footprintMm.width / 2,
        y: shape.footprintOffsetMm.y - shape.footprintMm.height / 2, ...shape.footprintMm }
      const points = [shape.visualBoundsMm, physical].flatMap(box => furnitureBoundsPolygon(box, {positionMm:{x:0,y:0},rotationDeg}))
      const left = Math.ceil(bounds.x + inset - Math.min(...points.map(p=>p.x)))
      const right = Math.floor(bounds.x + bounds.width - inset - Math.max(...points.map(p=>p.x)))
      const top = Math.ceil(bounds.y + inset - Math.min(...points.map(p=>p.y)))
      const bottom = Math.floor(bounds.y + bounds.height - inset - Math.max(...points.map(p=>p.y)))
      if (left > right || top > bottom) continue
      const horizontal = rotation === 0 || rotation === 180
      const starts = rotation === 0 ? [{x:left,y:top},{x:right,y:top}]
        : rotation === 180 ? [{x:left,y:bottom},{x:right,y:bottom}]
          : rotation === 90 ? [{x:right,y:top},{x:right,y:bottom}] : [{x:left,y:top},{x:left,y:bottom}]
      for (const positionMm of starts) {
        const key = `${positionMm.x}/${positionMm.y}/${rotationDeg}`
        const longWall = horizontal ? bounds.width >= bounds.height : bounds.height >= bounds.width
        candidates.push({pose:{positionMm,rotationDeg},key,priority:longWall?0:1})
      }
    }
  }
  for (const anchor of ordered) {
    const rotation = ((anchor.rotationDeg % 360) + 360) % 360
    if (!Number.isInteger(rotation / 90) || retainedRotation !== undefined && retainedRotation !== rotation) continue
    const other = boundsOf(anchor)
    for (const side of [-1, 1]) {
      const offset = { x: side < 0 ? other.left - 100 - own.right : other.right + 100 - own.left, y: other.back - own.back }
      const [point] = furnitureBoundsPolygon({ x: offset.x, y: offset.y, width: 0, height: 0 }, anchor)
      const pose = { positionMm: { x: Math.round(point.x), y: Math.round(point.y) }, rotationDeg: retainedRotation ?? rotation }
      const physical = { x: shape.footprintOffsetMm.x - shape.footprintMm.width / 2,
        y: shape.footprintOffsetMm.y - shape.footprintMm.height / 2, ...shape.footprintMm }
      const corners = [shape.visualBoundsMm, physical].flatMap(box => furnitureBoundsPolygon(box, pose))
      if (corners.some(p => p.x < bounds.x + inset || p.x > bounds.x + bounds.width - inset
        || p.y < bounds.y + inset || p.y > bounds.y + bounds.height - inset)) continue
      const key = `${pose.positionMm.x}/${pose.positionMm.y}/${pose.rotationDeg}`
      candidates.push({ pose, key, priority: anchor.role === 'work' || anchor.role === 'hearth' ? 0 : 1 })
    }
  }
  const unique = new Map<string, typeof candidates[number]>()
  for (const candidate of candidates) if (!unique.has(candidate.key) || candidate.priority < unique.get(candidate.key)!.priority) unique.set(candidate.key, candidate)
  return [...unique.values()].sort((a, b) => a.priority - b.priority || compare(rank(a.key), rank(b.key)) || compare(a.key, b.key)).map(row => row.pose)
}
