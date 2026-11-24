import type { PointMm } from '../../../shared/model/scene.js'
import type { ProjectedPath } from '../../../shared/projection/types.js'
import { staircasePointAt, type StaircaseGeometry } from '../../../shared/stairs/geometry.js'

export function earthenRoad(path: ProjectedPath): boolean {
  const config = path.stairs?.config
  return !!path.groundBlendMm && config?.material === 'earth' && config.preset === 'carved-rock' && config.covers.length === 0
}

const earthenRoadLanes = [-.5, -.38, -.25, 0, .25, .38, .5]
const shoulderWeight = [0, .62, 1, 1, 1, .62, 0]
const smoothstep = (value: number) => {
  const t = Math.max(0, Math.min(1, value))
  return t * t * (3 - 2 * t)
}

export function planEarthenRoad(stair: StaircaseGeometry, groundAt: (p: PointMm) => number) {
  const zAt = (distance: number, side = 0) => groundAt(staircasePointAt(stair, distance, side))
  const landingMm = Math.min(stair.lengthMm / 2, 480)
  const treads = stair.treads.map(tread => {
    const { startMm: start, endMm: end } = tread
    const mid = (start + end) / 2, z = zAt(mid)
    const longitudinal = [start, ...stair.sections.filter(s => s.distanceMm > start + .0001 && s.distanceMm < end - .0001).map(s => s.distanceMm), end]
    const at = (distance: number) => earthenRoadLanes.map((side, lane) => {
      const p = staircasePointAt(stair, distance, side), ground = groundAt(p)
      const blend = shoulderWeight[lane] * smoothstep(Math.min(distance, stair.lengthMm - distance) / landingMm)
      // The tread follows the bank at both edges and both landings. Only the
      // center of the cut is stepped, with a bounded local depth on rough relief.
      return { ...p, z: ground + Math.max(-820, Math.min(820, z - ground)) * blend }
    })
    return { start, end, z, longitudinal, at }
  })
  const risers = treads.slice(1).map((high, i) => {
    const low = treads[i], distance = high.start
    return { distance, rise: high.z - low.z, before: low.at(distance), after: high.at(distance) }
  })
  return { treads, risers }
}
