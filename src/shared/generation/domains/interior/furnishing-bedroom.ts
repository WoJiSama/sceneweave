import type { PointMm } from '../../../model/scene.js'
import { pathPolygon, polygonInside, polygonsOverlap } from '../../../geometry/geometry.js'
import type { InteriorRectangle } from './contracts.js'
import { furnitureBoundsPolygon, type FurnishingPose, type FurnishingShape } from './furnishing-poses.js'

export interface BedroomFurnitureAnchor extends FurnishingShape, FurnishingPose { storageLoad?: number }
export interface BedroomAccess {
  usePolygon: PointMm[]
  routePolygon: PointMm[]
  pointsMm: PointMm[]
}
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0
export const isBedroomPurpose = (purpose: string) => /卧室|客房|寝室|宿舍|bedroom|guest|dorm/.test(purpose.toLowerCase())
function envelope(shape: FurnishingShape, rotationDeg = 0) {
  const boxes = [shape.visualBoundsMm, { x: shape.footprintOffsetMm.x - shape.footprintMm.width / 2,
    y: shape.footprintOffsetMm.y - shape.footprintMm.height / 2, ...shape.footprintMm }]
  const points = boxes.flatMap(box => furnitureBoundsPolygon(box, { positionMm: { x: 0, y: 0 }, rotationDeg }))
  return { left: Math.min(...points.map(p => p.x)), right: Math.max(...points.map(p => p.x)),
    top: Math.min(...points.map(p => p.y)), bottom: Math.max(...points.map(p => p.y)) }
}
const point = (local: PointMm, pose: FurnishingPose): PointMm => {
  const [world] = furnitureBoundsPolygon({ ...local, width: 0, height: 0 }, pose)
  return { x: Math.round(world.x), y: Math.round(world.y) }
}

/** A finite suggestion, not a bed/head metadata claim or a persistent rule.
 * Use the longer authored envelope side, leaving at most its first 1000mm for
 * optional storage. A whole 600mm strip and a whole 600mm path to the actual
 * room centre must fit. Arbitrary retained bed rotations use their real local
 * frame; no axis-aligned world box supplies a false usable side. */
export function planBedroomAccess(options: { shape: FurnishingShape; pose: FurnishingPose; roomPolygon: PointMm[];
  centerMm: PointMm; blockers: readonly PointMm[][]; rank: (key: string) => string;
  routeTo?: (entry: PointMm) => { pointsMm: PointMm[]; polygon: PointMm[] } | undefined;
  checkCancelled: () => void; chargeCandidate: () => void; chargePair: () => void }): BedroomAccess | undefined {
  const box = envelope(options.shape), vertical = box.bottom - box.top >= box.right - box.left
  const length = vertical ? box.bottom - box.top : box.right - box.left
  const endZone = Math.min(1000, Math.ceil(length * .4))
  if (length - endZone < 600) return undefined
  const candidates = [-1, 1].map(side => {
    const bounds = vertical
      ? { x: side < 0 ? box.left - 700 : box.right + 100, y: box.top + endZone, width: 600, height: length - endZone }
      : { x: box.left + endZone, y: side < 0 ? box.top - 700 : box.bottom + 100, width: length - endZone, height: 600 }
    const entry = point({ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }, options.pose)
    const alternate = point({ x: bounds.x + bounds.width / 2 + (vertical ? 0 : 150), y: bounds.y + bounds.height / 2 + (vertical ? 150 : 0) }, options.pose)
    return { side, usePolygon: furnitureBoundsPolygon(bounds, options.pose), entry, alternate,
      distance: Math.hypot(entry.x - options.centerMm.x, entry.y - options.centerMm.y) }
  }).sort((a, b) => a.distance - b.distance || compare(options.rank(String(a.side)), options.rank(String(b.side))))
  const clear = (polygon: PointMm[]) => {
    if (!polygonInside(polygon, options.roomPolygon)) return false
    for (const blocker of options.blockers) {
      options.chargePair()
      if (polygonsOverlap(polygon, blocker)) return false
    }
    return true
  }
  for (const candidate of candidates) {
    options.checkCancelled(); options.chargeCandidate()
    if (!clear(candidate.usePolygon)) continue
    if (options.routeTo) {
      const route = options.routeTo(candidate.entry)
      if (route) return { usePolygon: candidate.usePolygon, routePolygon: route.polygon, pointsMm: route.pointsMm }
      continue
    }
    const a = options.centerMm, b = a.x === candidate.entry.x && a.y === candidate.entry.y ? candidate.alternate : candidate.entry
    for (const points of [[a, b], [a, { x: b.x, y: a.y }, b], [a, { x: a.x, y: b.y }, b]]) {
      options.checkCancelled(); options.chargeCandidate()
      const pointsMm = points.filter((p, index) => !index || p.x !== points[index - 1].x || p.y !== points[index - 1].y)
      if (pointsMm.length < 2) continue
      const routePolygon = pathPolygon({ id: 'bed-access', floorId: 'candidate', editLocked: false, visibility: 'public',
        centerlineMm: pointsMm, widthMm: 600, supportRefs: [{ kind: 'floor', id: 'candidate' }], surfaceStyle: null,
        movementCostMultiplier: 1, renderOrder: 0 })
      if (clear(routePolygon)) return { usePolygon: candidate.usePolygon, routePolygon, pointsMm }
    }
  }
  return undefined
}

/** Try storage at one end of each real cardinal bed, balancing existing nearby
 * storage before adding a second unit. The caller checks actual use/route
 * reservations and all native placement predicates. Unknown authored heads are
 * not inferred; this is only a bounded geometric grouping preference. */
export function bedroomStorageCandidates(bounds: InteriorRectangle, shape: FurnishingShape, inset: number,
  anchors: readonly BedroomFurnitureAnchor[], rank: (key: string) => string, retainedRotation?: number): FurnishingPose[] {
  const candidates: { pose: FurnishingPose; key: string; load: number }[] = []
  for (const anchor of [...anchors].sort((a, b) => (a.storageLoad ?? 0) - (b.storageLoad ?? 0)
    || a.positionMm.y - b.positionMm.y || a.positionMm.x - b.positionMm.x || a.rotationDeg - b.rotationDeg).slice(0, 8)) {
    if (!Number.isInteger(anchor.rotationDeg / 90)) continue
    const box = envelope(anchor), vertical = box.bottom - box.top >= box.right - box.left
    const rotationDeg = ((anchor.rotationDeg + (vertical ? 0 : 90)) % 360 + 360) % 360
    if (retainedRotation !== undefined && ((retainedRotation % 360) + 360) % 360 !== rotationDeg) continue
    const bed = envelope(anchor, vertical ? 0 : -90), own = envelope(shape)
    for (const side of [-1, 1]) {
      const offset = { x: side < 0 ? bed.left - 100 - own.right : bed.right + 100 - own.left, y: bed.top - own.top }
      const pose = { positionMm: point(offset, { positionMm: anchor.positionMm, rotationDeg }), rotationDeg: retainedRotation ?? rotationDeg }
      const actual = envelope(shape, pose.rotationDeg)
      if (pose.positionMm.x + actual.left < bounds.x + inset || pose.positionMm.x + actual.right > bounds.x + bounds.width - inset
        || pose.positionMm.y + actual.top < bounds.y + inset || pose.positionMm.y + actual.bottom > bounds.y + bounds.height - inset) continue
      candidates.push({ pose, key: `${pose.positionMm.x}/${pose.positionMm.y}/${pose.rotationDeg}`, load: anchor.storageLoad ?? 0 })
    }
  }
  const unique = new Map<string, typeof candidates[number]>()
  for (const candidate of candidates) if (!unique.has(candidate.key) || candidate.load < unique.get(candidate.key)!.load) unique.set(candidate.key, candidate)
  return [...unique.values()].sort((a, b) => a.load - b.load || compare(rank(a.key), rank(b.key)) || compare(a.key, b.key)).map(row => row.pose)
}
