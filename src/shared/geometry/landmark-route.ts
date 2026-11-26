import type { PointMm } from '../model/scene.js'
import { OperationRejected } from '../validation/operation-rejection.js'
import { sampleAnchoredRoad } from './automatic-road.js'
import { distanceToSegment, polygonValid, polylineBand } from './geometry.js'
import { AUTOMATIC_ROAD_MAX_FIXED_POINTS } from './road-surface.js'

const bearing = { east: 0, south: Math.PI / 2, west: Math.PI, north: -Math.PI / 2 }
const signedAngle = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle))
const distance = (a: PointMm, b: PointMm) => Math.hypot(b.x - a.x, b.y - a.y)

/** Trace both approaches to the requested side. Each alternative includes the
 * side itself and a bend beyond it before approaching the destination. */
export function landmarkRoutes(from: PointMm, to: PointMm, landmark: PointMm, side: keyof typeof bearing, radiusMm: number,
  widthMm: number, fits: (band: PointMm[]) => boolean, fitRadius = true) {
  const facing = bearing[side], start = Math.atan2(from.y - landmark.y, from.x - landmark.x)
  const destination = Math.atan2(to.y - landmark.y, to.x - landmark.x), destinationRadius = distance(to, landmark)
  const candidates: { anchors: PointMm[]; score: number }[] = [], seen = new Set<string>()
  const add = (anchors: PointMm[], penalty: number) => {
    const keys = anchors.map(p => `${p.x},${p.y}`), key = keys.join(';')
    if (seen.has(key) || new Set(keys).size !== anchors.length) return
    seen.add(key)
    let centerline
    try { centerline = sampleAnchoredRoad(anchors) }
    catch (error) {
      if (error instanceof OperationRejected) throw error
      return
    }
    const band = polylineBand(centerline, widthMm, true)
    if (!polygonValid(band, true) || !fits(band)) return
    const length = centerline.slice(1).reduce((sum, point, i) => sum + distance(point, centerline[i]), 0)
    candidates.push({ anchors, score: length + penalty })
  }
  for (const scale of fitRadius ? [1, .84, 1.16, .70] : [1]) {
    const radius = radiusMm * scale
    if (radius < widthMm * 2.1) continue
    for (const turn of [1, -1]) {
      const relativeStart = signedAngle(start - facing) * turn
      // Enter at the actual radial bearing on longer approaches. For a
      // close endpoint on the requested side, first step out along the arc.
      const entry = relativeStart < -.96 ? Math.max(-2.75, relativeStart + .38) : -.68
      const approachesCenter = destinationRadius < radius * .74
      const relativeEnd = signedAngle(destination - facing) * turn
      const exit = approachesCenter ? .78 : Math.max(.46, Math.min(2.2, relativeEnd - .28))
      const pieces = Math.ceil(-entry / .53)
      const after = Math.min(Math.ceil(exit / .53), AUTOMATIC_ROAD_MAX_FIXED_POINTS - pieces - (approachesCenter ? 4 : 3))
      const offsets = [...Array.from({ length: pieces }, (_, i) => entry * (1 - i / pieces)),
        ...Array.from({ length: after + 1 }, (_, i) => exit * i / after)]
      const arc = (approachesCenter ? [...offsets, exit + .50] : offsets).map(offset => {
        const angle = facing + offset * turn
        const reach = radius * (offset < 0 ? 1 + .12 * offset / entry : offset <= exit ? 1 - .14 * offset / exit : .53)
        return { x: Math.round(landmark.x + reach * Math.cos(angle)), y: Math.round(landmark.y + reach * Math.sin(angle)) }
      })
      // Rounding to the full road width needs room to swing into each turn.
      const anchors = [from, ...arc.filter((p, i) => i === pieces || distance(p, from) > widthMm * 1.2 && distance(p, to) > widthMm * 1.2), to]
      if (distance(from, landmark) >= radius * .75 && distanceToSegment(landmark, from, anchors[1]) < radius * .63) continue
      add(anchors, Math.abs(1 - scale) * radiusMm * 3)
    }
  }
  const arcs = candidates.sort((a, b) => a.score - b.score).map(candidate => candidate.anchors)
  candidates.length = 0
  // An approach to a peak can need a long diagonal traverse instead of a
  // near-circular bend. Work in the requested side's local frame so the
  // same approach mirrors with the terrain.
  const ux = Math.round(Math.cos(facing)), uy = Math.round(Math.sin(facing))
  const lateral = (p: PointMm) => (p.x - landmark.x) * -uy + (p.y - landmark.y) * ux
  const directed = lateral(from) < 0 ? -1 : 1
  const traverses = [
    [[1.45, 1.13], [1.42, .56], [1.2, .04], [.91, -.29], [.48, -.43], [0, -.39]],
    [[1.46, .91], [1.31, .36], [1.10, -.12], [.77, -.43], [.37, -.53], [0, -.45]],
  ]
  for (const scale of fitRadius ? [1.30, 1.05, 1.55, 1.80] : [1]) {
    const radius = radiusMm * scale
    if (radius < widthMm * 2.1) continue
    for (const sign of [directed, -directed]) for (const traverse of traverses) {
      const guide = traverse.map(([u, v]) => ({
        x: Math.round(landmark.x + radius * (ux * u - uy * v * sign)),
        y: Math.round(landmark.y + radius * (uy * u + ux * v * sign)),
      })).filter(p => distance(p, from) > widthMm * 1.65 && distance(p, to) > widthMm * 1.65)
      if (guide.length < 3 || distanceToSegment(landmark, from, guide[0]) < radius * .65) continue
      add([from, ...guide, to], Math.abs(1 - scale) * radiusMm * .75)
    }
  }
  const sweeps = candidates.sort((a, b) => a.score - b.score).map(candidate => candidate.anchors)
  return [...arcs, ...sweeps]
}
