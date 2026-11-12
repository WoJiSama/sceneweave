import type { InteriorRectangle } from './contracts.js'
import { furnitureBoundsPolygon, furniturePoseCandidates, type FurnishingPose, type FurnishingShape } from './furnishing-poses.js'

/** Candidate positions for a complete bed/storage envelope. The cabinet keeps
 * its authored dimensions and a 600mm front strip. This only moves the finite
 * bed suggestions away from corners that cannot accommodate the partner; all
 * actual members, support, locks and routes still pass the normal checks.
 * No authored head or persistent pairing is inferred from this geometry. */
export function bedroomGroupPoseCandidates(bounds: InteriorRectangle, bed: FurnishingShape, storage: readonly FurnishingShape[], inset: number,
  rank: (key: string) => string, retainedRotation?: number): FurnishingPose[] {
  if (retainedRotation !== undefined && !Number.isInteger(retainedRotation / 90)) return []
  const envelope = (shape: FurnishingShape, pose: FurnishingPose) => {
    const points = [shape.visualBoundsMm, { x: shape.footprintOffsetMm.x - shape.footprintMm.width / 2,
      y: shape.footprintOffsetMm.y - shape.footprintMm.height / 2, ...shape.footprintMm }].flatMap(box => furnitureBoundsPolygon(box, pose))
    return { left: Math.min(...points.map(p => p.x)), right: Math.max(...points.map(p => p.x)),
      top: Math.min(...points.map(p => p.y)), bottom: Math.max(...points.map(p => p.y)) }
  }
  const zero = { x: 0, y: 0 }, original = envelope(bed, { positionMm: zero, rotationDeg: 0 })
  const vertical = original.bottom - original.top >= original.right - original.left
  const frame = vertical ? 0 : -90, box = envelope(bed, { positionMm: zero, rotationDeg: frame })
  const candidates = new Map<string, FurnishingPose>()
  for (const cabinet of storage.slice(0, 8)) {
    const own = envelope(cabinet, { positionMm: zero, rotationDeg: 0 })
    for (const side of [-1, 1]) {
      const x = side < 0 ? box.left - 100 - own.right : box.right + 100 - own.left, y = box.top - own.top
      const combined = { x: Math.min(box.left, x + own.left), y: Math.min(box.top, y + own.top),
        width: Math.max(box.right, x + own.right) - Math.min(box.left, x + own.left),
        height: Math.max(box.bottom, y + own.bottom + 600) - Math.min(box.top, y + own.top) }
      const points = furnitureBoundsPolygon(combined, { positionMm: zero, rotationDeg: -frame })
      const left = Math.min(...points.map(p => p.x)), top = Math.min(...points.map(p => p.y))
      const width = Math.max(...points.map(p => p.x)) - left, height = Math.max(...points.map(p => p.y)) - top
      const group = { visualBoundsMm: { x: left, y: top, width, height }, footprintMm: { width, height },
        footprintOffsetMm: { x: left + width / 2, y: top + height / 2 } }
      for (const pose of furniturePoseCandidates(bounds, group, inset, 'bed', [], rank, retainedRotation)) {
        const key = `${pose.positionMm.x}/${pose.positionMm.y}/${pose.rotationDeg}`
        if (!candidates.has(key)) candidates.set(key, pose)
      }
    }
  }
  return [...candidates.values()]
}
