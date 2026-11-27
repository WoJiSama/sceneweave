import type { PropDefinition } from '../../../model/scene.js'
import type { InteriorRectangle } from './contracts.js'
import { furnitureBoundsPolygon, type FurnishingPose, type FurnishingShape } from './furnishing-poses.js'

export const isServiceCounter = (definition: PropDefinition) => /柜台|料理台|备餐台|counter/i.test([definition.name, ...definition.tags].join(' '))

function counterWallRun(room: InteriorRectangle, neighbor: InteriorRectangle, shape: FurnishingShape, inset: number) {
  const right = room.x + room.width, bottom = room.y + room.height
  const neighborRight = neighbor.x + neighbor.width, neighborBottom = neighbor.y + neighbor.height
  const side = neighborBottom === room.y ? 'north' : neighbor.y === bottom ? 'south'
    : neighborRight === room.x ? 'west' : neighbor.x === right ? 'east' : undefined
  if (!side) return
  const horizontal = side === 'north' || side === 'south', along = horizontal ? 'x' : 'y', across = horizontal ? 'y' : 'x'
  const from = Math.max(room[along], neighbor[along]), to = Math.min(horizontal ? right : bottom, horizontal ? neighborRight : neighborBottom)
  const rotationDeg = { north: 0, west: 270, south: 180, east: 90 }[side]
  const footprint = { x: shape.footprintOffsetMm.x - shape.footprintMm.width / 2, y: shape.footprintOffsetMm.y - shape.footprintMm.height / 2, ...shape.footprintMm }
  const corners = [footprint, shape.visualBoundsMm].flatMap(box => furnitureBoundsPolygon(box, { positionMm: { x: 0, y: 0 }, rotationDeg }))
  const low = Math.ceil(from + inset - Math.min(...corners.map(point => point[along])))
  const high = Math.floor(to - inset - Math.max(...corners.map(point => point[along])))
  if (low > high) return
  const near = side === 'north' || side === 'west'
  const station = near ? Math.ceil(room[across] + inset - Math.min(...corners.map(point => point[across])))
    : Math.floor((horizontal ? bottom : right) - inset - Math.max(...corners.map(point => point[across])))
  return { low, high, station, along, across, rotationDeg, near } as const
}

/** Both rooms are the checked, materialized layout rectangles. Along their
 * contact, leave the door and furniture checks to the usual placement stage. */
export function counterPoses(room: InteriorRectangle, neighbor: InteriorRectangle, shape: FurnishingShape, inset: number, rank: (key: string) => string): FurnishingPose[] {
  const run = counterWallRun(room, neighbor, shape, inset)
  if (!run) return []
  const { low, high, station, rotationDeg } = run
  const positions = [...new Set([.5, .25, .75, 0, 1].map(fraction => Math.round(low + (high - low) * fraction)))]
  // The center is natural on an uninterrupted run. The seeded end variants
  // can clear a real adjoining door without moving the counter off this wall.
  const centered = positions[0]
  const ends = positions.slice(1).sort((a, b) => rank(String(a)).localeCompare(rank(String(b))))
  return [centered, ...ends].map(value => ({ positionMm: run.along === 'x' ? { x: value, y: station } : { x: station, y: value }, rotationDeg }))
}

export function counterFitsSharedWall(room: InteriorRectangle, neighbor: InteriorRectangle, counter: FurnishingShape & FurnishingPose, inset: number, besideMm: number) {
  const run = counterWallRun(room, neighbor, counter, inset)
  if (!run || ((counter.rotationDeg % 360) + 360) % 360 !== run.rotationDeg) return false
  const at = counter.positionMm[run.along], distance = (counter.positionMm[run.across] - run.station) * (run.near ? 1 : -1)
  return at >= run.low && at <= run.high && distance >= 0 && distance <= besideMm
}
