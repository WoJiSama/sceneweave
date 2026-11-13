import type { BoundsMm, PointMm, Prop } from '../../../model/scene.js'
import type { InteriorFurnitureRole, InteriorRectangle } from './contracts.js'

export type FurnishingShape = Pick<Prop, 'visualBoundsMm' | 'footprintMm' | 'footprintOffsetMm'>
export interface FurnishingPose { positionMm: PointMm; rotationDeg: number }
export interface FurnitureAnchor extends FurnishingShape, FurnishingPose { role: 'work' | 'table'; seatingLoad?: number }
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0

/** Use the actual rotated painted rectangle as well as the physical footprint.
 * Cardinal transforms are exact, including off-centre image/root bounds. */
export function furnitureBoundsPolygon(bounds: BoundsMm, pose: FurnishingPose): PointMm[] {
  const corners = [{ x: bounds.x, y: bounds.y }, { x: bounds.x + bounds.width, y: bounds.y },
    { x: bounds.x + bounds.width, y: bounds.y + bounds.height }, { x: bounds.x, y: bounds.y + bounds.height }]
  const angle = ((pose.rotationDeg % 360) + 360) % 360
  const radians = angle * Math.PI / 180, cos = angle === 0 ? 1 : angle === 180 ? -1 : angle === 90 || angle === 270 ? 0 : Math.cos(radians)
  const sin = angle === 90 ? 1 : angle === 270 ? -1 : angle === 0 || angle === 180 ? 0 : Math.sin(radians)
  return corners.map(p => ({ x: pose.positionMm.x + p.x * cos - p.y * sin, y: pose.positionMm.y + p.x * sin + p.y * cos }))
}
function envelope(shape: FurnishingShape, rotationDeg: number) {
  const physical = { x: shape.footprintOffsetMm.x - shape.footprintMm.width / 2,
    y: shape.footprintOffsetMm.y - shape.footprintMm.height / 2, ...shape.footprintMm }
  const points = [physical, shape.visualBoundsMm].flatMap(bounds => furnitureBoundsPolygon(bounds, { positionMm: { x: 0, y: 0 }, rotationDeg }))
  return { minX: Math.min(...points.map(p => p.x)), maxX: Math.max(...points.map(p => p.x)),
    minY: Math.min(...points.map(p => p.y)), maxY: Math.max(...points.map(p => p.y)) }
}

/** interior-layout@4: a bounded set of complete poses, independent of scene or
 * entity identity. Seats try neighbouring work/table edges before free walls;
 * long furniture can turn without changing scale, support or fixed definition.
 * The pose is a suggestion only; the caller still checks actual dependencies,
 * lock state, rotated geometry, door reservations and full-width circulation. */
export function furniturePoseCandidates(bounds: InteriorRectangle, shape: FurnishingShape, inset: number,
  role: InteriorFurnitureRole, anchors: readonly FurnitureAnchor[], rank: (key: string) => string,
  retainedRotation?: number, allowPairedSeats = true, fitSeatToEdge = false): FurnishingPose[] {
  type Candidate = FurnishingPose & { priority: number; key: string; neighbour: boolean }
  const candidates: Candidate[] = []
  const add = (x: number, y: number, rotationDeg: number, priority: number, neighbour = false) => {
    const positionMm = { x: Math.round(x), y: Math.round(y) }, box = envelope(shape, rotationDeg)
    if (positionMm.x + box.minX < bounds.x + inset || positionMm.x + box.maxX > bounds.x + bounds.width - inset
      || positionMm.y + box.minY < bounds.y + inset || positionMm.y + box.maxY > bounds.y + bounds.height - inset) return
    const key = `${positionMm.x}/${positionMm.y}/${rotationDeg}`
    candidates.push({ positionMm, rotationDeg, priority, key, neighbour })
  }
  // Palette seats use their authored +Y front. A seat north/east/south/west of
  // a table faces towards its nearest edge. Local re-layout retains the user's
  // current rotation even when it is non-cardinal.
  if (role === 'seat') for (const anchor of [...anchors].sort((a, b) => a.positionMm.y - b.positionMm.y
    || a.positionMm.x - b.positionMm.x || a.rotationDeg - b.rotationDeg || compare(a.role, b.role)).slice(0, 8)) {
    const box = envelope(anchor, anchor.rotationDeg), x = anchor.positionMm.x, y = anchor.positionMm.y
    const midX = x + (box.minX + box.maxX) / 2, midY = y + (box.minY + box.maxY) / 2
    // Prefer a rectangular surface's longer edge before its short ends. This
    // is a geometry preference, not an authored front/usable-side claim. An
    // arbitrary retained table angle has no world-axis edge in this candidate
    // family, so keep its existing neutral ordering instead of inferring one
    // from an inflated axis-aligned box.
    const cardinal = Math.abs(anchor.rotationDeg / 90 - Math.round(anchor.rotationDeg / 90)) < 1e-9
    const width = box.maxX - box.minX, height = box.maxY - box.minY
    const longAxis = !cardinal || Math.max(width, height) < Math.min(width, height) * 1.15 ? null : width > height ? 'x' : 'y'
    for (const side of [0, 1, 2, 3]) {
      const rotation = retainedRotation ?? [0, 90, 180, 270][side], seat = envelope(shape, rotation)
      const px = side === 1 ? x + box.maxX + 180 - seat.minX : side === 3 ? x + box.minX - 180 - seat.maxX : midX - (seat.minX + seat.maxX) / 2
      const py = side === 0 ? y + box.minY - 180 - seat.maxY : side === 2 ? y + box.maxY + 180 - seat.minY : midY - (seat.minY + seat.maxY) / 2
      // An unserved table still comes before extra seats on an occupied one.
      // Keep short-end fallbacks when both longer edges are actually blocked.
      const load = (anchor.seatingLoad ?? 0) * 4
      const shortEnd = longAxis !== null && (longAxis === 'x' ? side % 2 === 1 : side % 2 === 0)
      const priority = load + (shortEnd ? 2 : 0)
      // A central chair can consume both quarter-edge alternatives. Offer
      // two fully separated seats first only when their complete envelopes
      // fit along the surface. A long bench keeps the single central place;
      // neither its artwork nor its physical footprint is shortened to fit.
      const edgeSpan = side % 2 ? height : width
      const seatSpan = side % 2 ? seat.maxY - seat.minY : seat.maxX - seat.minX
      // v18 dining groups do not place a full bench across a shorter table
      // end. Keep the complete authored body and other fitting edges instead.
      if (fitSeatToEdge && cardinal && seatSpan > edgeSpan) continue
      const pairFits = allowPairedSeats && longAxis !== null && !shortEnd && edgeSpan >= seatSpan * 2 + 100
      if (pairFits) {
        const spread = (seatSpan + 100) / 2
        for (const sign of [-1, 1]) add(px + (side % 2 ? 0 : sign * spread), py + (side % 2 ? sign * spread : 0), rotation, priority, true)
      }
      // A legal centre remains a fallback when room bounds or real blockers
      // reject the pair. The caller still checks each complete proposed pose.
      add(px, py, rotation, priority + (pairFits ? 1 : 0), true)
      if (!pairFits) {
        // Keep the original single-place offsets as fallbacks. A complete
        // bench may need to slide along an edge to clear a door or route even
        // though two benches cannot fit side by side.
        const spread = Math.min(700, edgeSpan / 4, fitSeatToEdge && cardinal ? Math.max(0, (edgeSpan - seatSpan) / 2) : Infinity)
        for (const sign of [-1, 1]) add(px + (side % 2 ? 0 : sign * spread), py + (side % 2 ? sign * spread : 0), rotation, priority + 1, true)
      }
    }
  }
  if (role !== 'seat' || !anchors.length) for (const rotation of retainedRotation === undefined ? [0, 90, 180, 270] : [retainedRotation]) {
    const box = envelope(shape, rotation), left = Math.ceil(bounds.x + inset - box.minX), right = Math.floor(bounds.x + bounds.width - inset - box.maxX)
    const top = Math.ceil(bounds.y + inset - box.minY), bottom = Math.floor(bounds.y + bounds.height - inset - box.maxY)
    if (left > right || top > bottom) continue
    for (const fraction of [.5, .25, .75, 0, 1]) {
      const x = left + (right - left) * fraction, y = top + (bottom - top) * fraction
      const front = ((rotation % 360) + 360) % 360
      // Prefer the authored front facing into the room for wall furniture.
      add(x, top, rotation, front === 0 ? 3 : 4)
      add(x, bottom, rotation, front === 180 ? 3 : 4)
      add(left, y, rotation, front === 270 ? 3 : 4)
      add(right, y, rotation, front === 90 ? 3 : 4)
    }
    for (const fy of [.5, .25, .75]) for (const fx of [.5, .25, .75]) {
      add(left + (right - left) * fx, top + (bottom - top) * fy, rotation, role === 'table' ? 2 : 5)
    }
  }
  const unique = new Map<string, Candidate>()
  for (const row of candidates) if (!unique.has(row.key) || unique.get(row.key)!.priority > row.priority) unique.set(row.key, row)
  return [...unique.values()].sort((a, b) => a.priority - b.priority || compare(rank(a.key), rank(b.key)) || compare(a.key, b.key))
    // An available work surface makes these functional seats. Do not silently
    // scatter an unplaceable chair to a distant wall; leave that suggestion
    // visibly unfilled instead. Standalone bedroom/lounge seats still use walls.
    .filter(candidate => role !== 'seat' || !anchors.length || candidate.neighbour)
    .slice(0, 128).map(({ positionMm, rotationDeg }) => ({ positionMm, rotationDeg }))
}
