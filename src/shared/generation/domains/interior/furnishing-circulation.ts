import type { PointMm, SceneDocument } from '../../../model/scene.js'
import { openingEndpoints, pathPolygon, pointInPolygon, polygonInside, polygonsOverlap, roomPoints } from '../../../geometry/geometry.js'
import { checkTerrainRoute } from '../../../geometry/terrain-travel.js'
import { furnitureBoundsPolygon, type FurnishingPose, type FurnishingShape } from './furnishing-poses.js'
import type { InteriorFurnitureRole } from './contracts.js'

export interface RoomDoorPort { openingId: string; pointMm: PointMm }
export interface FurnitureAccessRoute {
  openingId: string
  pointsMm: PointMm[]
  widthMm: number
  polygon: PointMm[]
}
export interface InteriorFurnitureAccess {
  propId: string
  role: InteriorFurnitureRole
  openingId: string | null
  pointsMm: PointMm[]
  widthMm: number
  status: 'clear' | 'unavailable'
  notes: string[]
}
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0
const same = (a: PointMm, b: PointMm) => a.x === b.x && a.y === b.y
export const furnitureAccessBand = (pointsMm: PointMm[], widthMm = 600) => pathPolygon({
  id: 'furniture-access', floorId: 'candidate', editLocked: false, visibility: 'public', centerlineMm: pointsMm, widthMm,
  supportRefs: [{ kind: 'floor', id: 'candidate' }], surfaceStyle: null, movementCostMultiplier: 1, renderOrder: 0,
})
function compact(points: PointMm[]): PointMm[] {
  const result: PointMm[] = []
  for (const point of points) {
    if (result.length && same(result[result.length - 1], point)) continue
    result.push(point)
    while (result.length >= 3) {
      const [a, b, c] = result.slice(-3)
      if ((a.x !== b.x || b.x !== c.x) && (a.y !== b.y || b.y !== c.y)) break
      result.splice(result.length - 2, 1)
    }
  }
  return result
}

/** Real, currently open/unlocked door thresholds. The complete crossing is
 * checked against native support and physical obstacles before supplying an
 * interior port. No door is opened and no room-centre reachability is assumed. */
export function roomDoorPorts(document: SceneDocument, roomId: string, widthMm: number, checkCancelled: () => void,
  charge: (pairs: number) => void): RoomDoorPort[] {
  const room = document.rooms[roomId], polygon = roomPoints(document, room), ports: RoomDoorPort[] = []
  for (const opening of Object.values(document.openings)) {
    checkCancelled()
    if (opening.floorId !== room.floorId || opening.kind !== 'door' || opening.state !== 'open' || opening.locked || opening.widthMm < widthMm) continue
    const wall = document.walls[opening.wallId]
    if (!room.boundaryVertexIds.some((id, index, ids) => {
      const next = ids[(index + 1) % ids.length]
      return id === wall.startVertexId && next === wall.endVertexId || id === wall.endVertexId && next === wall.startVertexId
    })) continue
    const [a, b] = openingEndpoints(document, opening), length = Math.hypot(b.x - a.x, b.y - a.y)
    const midpoint = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, normal = { x: -(b.y - a.y) / length, y: (b.x - a.x) / length }
    // Square end caps require a complete half-width beyond the inner wall face.
    const depth = Math.ceil(wall.thicknessMm / 2 + widthMm / 2) + 2
    const endpoints = [-1, 1].map(sign => ({ x: Math.round(midpoint.x + normal.x * depth * sign), y: Math.round(midpoint.y + normal.y * depth * sign) }))
    charge(Object.keys(document.walls).length + Object.keys(document.props).length + Object.keys(document.regions).length)
    if (!checkTerrainRoute(document, { floorId: room.floorId, pointsMm: endpoints, widthMm }).ok) continue
    for (const pointMm of endpoints) if (pointInPolygon(pointMm, polygon)) ports.push({ openingId: opening.id, pointMm })
  }
  // Geometry, rather than IDs, controls every layout choice. ID is only carried
  // as the witness of the actual selected doorway.
  return ports.sort((a, b) => a.pointMm.y - b.pointMm.y || a.pointMm.x - b.pointMm.x || compare(a.openingId, b.openingId))
}

/** Reach the free 600mm strip behind a seat or in front of a standing unit,
 * using its actual local painted/physical envelope, including arbitrary angles. */
export function furnitureApproachPoint(shape: FurnishingShape, pose: FurnishingPose, rear: boolean): PointMm {
  const left = Math.min(shape.visualBoundsMm.x, shape.footprintOffsetMm.x - shape.footprintMm.width / 2)
  const right = Math.max(shape.visualBoundsMm.x + shape.visualBoundsMm.width, shape.footprintOffsetMm.x + shape.footprintMm.width / 2)
  const y = rear ? Math.min(shape.visualBoundsMm.y, shape.footprintOffsetMm.y - shape.footprintMm.height / 2) - 300
    : Math.max(shape.visualBoundsMm.y + shape.visualBoundsMm.height, shape.footprintOffsetMm.y + shape.footprintMm.height / 2) + 300
  const [point] = furnitureBoundsPolygon({ x: (left + right) / 2, y, width: 0, height: 0 }, pose)
  return { x: Math.round(point.x), y: Math.round(point.y) }
}

type Options = {
  roomPolygon: PointMm[]; blockers: readonly PointMm[][]; ports: readonly RoomDoorPort[]; targetMm: PointMm; widthMm?: number
  /** Previously found candidate, always checked again against current geometry. */
  retainedRoute?: FurnitureAccessRoute
  /** Explicit new recipe behavior: admit at most 4096 reached intersections
   * instead of requiring the entire Cartesian coordinate product to fit. */
  graphMode?: 'bounded-lazy'
  checkCancelled: () => void; chargeNode: () => void; chargePair: () => void
  checkNative: (pointsMm: PointMm[], widthMm: number) => boolean
}
/** Bounded orthogonal obstacle routing for a single room. Fast direct/L paths
 * precede an A* search over obstacle-edge coordinates. Every edge has square
 * caps, so a centreline squeezing around a corner cannot stand in for full
 * turning clearance. The completed native band is checked again. This is
 * transient generation evidence, not persistent navigation or a whole-map
 * reachability promise. Grid admission is explicit; no random sampling. */
export function findFurnitureAccess(options: Options): FurnitureAccessRoute | undefined {
  const width = options.widthMm ?? 600, radius = width / 2, target = options.targetMm
  // A route is entirely contained by this actual room. Disjoint polygons
  // cannot obstruct it and must not inflate its finite coordinate admission.
  // Native support/travel still consumes the complete current scene.
  const blockers = options.blockers.filter(polygon => {
    options.checkCancelled(); options.chargePair()
    return polygonsOverlap(polygon, options.roomPolygon)
  })
  // New recipes cache complete bounds for conservative pair rejection. A
  // strictly disjoint bounding box proves that the exact polygons cannot
  // intersect. Touching/overlapping boxes still run the original full check;
  // native support always receives the complete current scene.
  const bounds = (polygon: PointMm[]) => ({
    minX: Math.min(...polygon.map(p => p.x)), maxX: Math.max(...polygon.map(p => p.x)),
    minY: Math.min(...polygon.map(p => p.y)), maxY: Math.max(...polygon.map(p => p.y)),
  })
  const blockerBounds = options.graphMode === 'bounded-lazy' ? blockers.map(bounds) : undefined
  const clear = (polygon: PointMm[]) => {
    options.checkCancelled()
    if (!polygonInside(polygon, options.roomPolygon)) return false
    const bandBounds = blockerBounds ? bounds(polygon) : undefined
    for (const [index, blocker] of blockers.entries()) {
      if (bandBounds && blockerBounds) {
        const other = blockerBounds[index]
        if (bandBounds.maxX < other.minX || other.maxX < bandBounds.minX || bandBounds.maxY < other.minY || other.maxY < bandBounds.minY) continue
      }
      options.chargePair()
      if (polygonsOverlap(polygon, blocker)) return false
    }
    return true
  }
  const finish = (port: RoomDoorPort, points: PointMm[]): FurnitureAccessRoute | undefined => {
    const pointsMm = compact(points)
    if (pointsMm.length === 1) pointsMm.push({ x: pointsMm[0].x + 1, y: pointsMm[0].y })
    const polygon = furnitureAccessBand(pointsMm, width)
    if (!clear(polygon) || !options.checkNative(pointsMm, width)) return undefined
    return { openingId: port.openingId, pointsMm, widthMm: width, polygon }
  }
  const square = (point: PointMm) => [{ x: point.x - radius, y: point.y - radius }, { x: point.x + radius, y: point.y - radius },
    { x: point.x + radius, y: point.y + radius }, { x: point.x - radius, y: point.y + radius }]
  if (!clear(square(target))) return undefined
  const ports = [...options.ports].filter(port => clear(square(port.pointMm))).sort((a, b) =>
    Math.abs(a.pointMm.x - target.x) + Math.abs(a.pointMm.y - target.y) - Math.abs(b.pointMm.x - target.x) - Math.abs(b.pointMm.y - target.y)
    || a.pointMm.y - b.pointMm.y || a.pointMm.x - b.pointMm.x || compare(a.openingId, b.openingId))
  if (!ports.length) return undefined
  if (options.retainedRoute) {
    const retained = options.retainedRoute
    const port = ports.find(port => port.openingId === retained.openingId && same(port.pointMm, retained.pointsMm[0]))
    if (port && retained.widthMm === width && same(retained.pointsMm.at(-1)!, target)) {
      options.chargeNode()
      const checked = finish(port, retained.pointsMm)
      if (checked) return checked
    }
  }
  for (const port of ports) for (const points of [[port.pointMm, target],
    [port.pointMm, { x: target.x, y: port.pointMm.y }, target], [port.pointMm, { x: port.pointMm.x, y: target.y }, target]]) {
    options.checkCancelled(); options.chargeNode()
    const result = finish(port, points)
    if (result) return result
  }
  const xs = new Set([target.x, ...ports.map(port => port.pointMm.x)]), ys = new Set([target.y, ...ports.map(port => port.pointMm.y)])
  for (const polygon of [options.roomPolygon, ...blockers]) {
    options.checkCancelled()
    for (const point of polygon) {
      xs.add(Math.floor(point.x - radius)); xs.add(Math.ceil(point.x + radius))
      ys.add(Math.floor(point.y - radius)); ys.add(Math.ceil(point.y + radius))
    }
  }
  const minX = Math.min(...options.roomPolygon.map(p => p.x)) + radius, maxX = Math.max(...options.roomPolygon.map(p => p.x)) - radius
  const minY = Math.min(...options.roomPolygon.map(p => p.y)) + radius, maxY = Math.max(...options.roomPolygon.map(p => p.y)) - radius
  const x = [...xs].filter(v => v >= minX && v <= maxX).sort((a, b) => a - b), y = [...ys].filter(v => v >= minY && v <= maxY).sort((a, b) => a - b)
  // Legacy recipes require the whole coordinate product to fit 4096 nodes.
  // The explicit sparse mode admits only reached intersections, with the same
  // 4096 ceiling enforced below. Every returned route still checks its full band.
  if (options.graphMode !== 'bounded-lazy' && x.length * y.length > 4096) return undefined
  const index = (p: PointMm) => y.indexOf(p.y) * x.length + x.indexOf(p.x), point = (id: number) => ({ x: x[id % x.length], y: y[Math.floor(id / x.length)] })
  const targetIndex = index(target), roots = new Map(ports.map(port => [index(port.pointMm), port]))
  const cost = new Map<number, number>([[targetIndex, 0]]), parent = new Map<number, number>(), edgeCache = new Map<string, boolean>()
  const heuristic = (id: number) => { const p = point(id); return Math.min(...ports.map(port => Math.abs(p.x - port.pointMm.x) + Math.abs(p.y - port.pointMm.y))) }
  const heap: { id: number; cost: number; priority: number }[] = []
  const less = (a: typeof heap[number], b: typeof heap[number]) => a.priority - b.priority || a.cost - b.cost || a.id - b.id
  const push = (item: typeof heap[number]) => {
    heap.push(item); let at = heap.length - 1
    while (at) { const above = Math.floor((at - 1) / 2); if (less(heap[above], item) <= 0) break; heap[at] = heap[above]; at = above }
    heap[at] = item
  }
  const pop = () => {
    const first = heap[0], last = heap.pop()!
    if (heap.length) {
      let at = 0
      while (at * 2 + 1 < heap.length) {
        let child = at * 2 + 1
        if (child + 1 < heap.length && less(heap[child + 1], heap[child]) < 0) child++
        if (less(last, heap[child]) <= 0) break
        heap[at] = heap[child]; at = child
      }
      heap[at] = last
    }
    return first
  }
  push({ id: targetIndex, cost: 0, priority: heuristic(targetIndex) })
  while (heap.length) {
    options.checkCancelled()
    const current = pop()
    if (current.cost !== cost.get(current.id)) continue
    options.chargeNode()
    const port = roots.get(current.id)
    if (port) {
      const points = [point(current.id)]; let at = current.id
      while (parent.has(at)) { at = parent.get(at)!; points.push(point(at)) }
      const result = finish(port, points)
      if (result) return result
      roots.delete(current.id)
    }
    const column = current.id % x.length, row = Math.floor(current.id / x.length)
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const nx = column + dx, ny = row + dy
      if (nx < 0 || ny < 0 || nx >= x.length || ny >= y.length) continue
      const next = ny * x.length + nx, a = point(current.id), b = point(next), candidateCost = current.cost + Math.abs(b.x - a.x) + Math.abs(b.y - a.y)
      if (candidateCost >= (cost.get(next) ?? Infinity)) continue
      const key = current.id < next ? `${current.id}/${next}` : `${next}/${current.id}`
      if (!edgeCache.has(key)) edgeCache.set(key, clear(furnitureAccessBand([a, b], width)))
      if (!edgeCache.get(key)) continue
      // The sparse graph has the same finite node ceiling. Rejected solids do
      // not become nodes, and reaching the ceiling cannot grant clearance.
      // Existing admitted nodes may still improve; every completed full band
      // continues through the same geometry and native support checks.
      if (options.graphMode === 'bounded-lazy' && !cost.has(next) && cost.size >= 4096) continue
      cost.set(next, candidateCost); parent.set(next, current.id); push({ id: next, cost: candidateCost, priority: candidateCost + heuristic(next) })
    }
  }
  return undefined
}
