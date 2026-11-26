import type { ExecutionBudget } from '../budget/task-budget.js'
import { indexEdges, observeGeometryPairs, type SegmentMm } from '../geometry/edge-index.js'
import { distanceToSegment, pointInPolygon } from '../geometry/geometry.js'
import type { PointMm } from '../model/scene.js'
import { ROAD_SHOULDER_LIMIT_MM } from '../geometry/road-surface.js'

const directions = { west: { x: -1, y: 0 }, east: { x: 1, y: 0 }, north: { x: 0, y: -1 }, south: { x: 0, y: 1 } }
type Turn = { at: PointMm; side: keyof typeof directions; radius: number; fixed: boolean }
const distance = (a: PointMm, b: PointMm) => Math.hypot(a.x - b.x, a.y - b.y)

/** Find alternative traverses by sampling room for both banks and local grade.
 * These scores only choose which courses go through full grading and validation. */
export function terrainLandscapeCourses(from: PointMm, to: PointMm, width: number, outline: PointMm[], water: PointMm[][],
  height: (at: PointMm) => number, meter: ExecutionBudget, disturbance: (course: PointMm[]) => number, turn?: Turn) {
  const direction = turn ? directions[turn.side] : { x: (to.x - from.x) / distance(from, to), y: (to.y - from.y) / distance(from, to) }
  const point = (origin: PointMm, along: number, across: number) => ({
    x: Math.round(origin.x + direction.x * along - direction.y * across),
    y: Math.round(origin.y + direction.y * along + direction.x * across),
  })
  const edges: SegmentMm[] = [outline, ...water].flatMap(ring => ring.map((a, i) => [a, ring[(i + 1) % ring.length]] as const))
  const find = indexEdges(edges), padding = width / 2 + ROAD_SHOULDER_LIMIT_MM * 2
  const samples = new Map<string, { clearance: number; elevation: number }>()
  const measure = (p: PointMm) => {
    const key = `${p.x}/${p.y}`, prior = samples.get(key)
    if (prior) return prior
    let clearance = 0
    if (pointInPolygon(p, outline, false) && water.every(ring => !pointInPolygon(p, ring))) {
      const local = find(p, p, padding)
      observeGeometryPairs(local.length)
      clearance = local.reduce((r, i) => Math.min(r, distanceToSegment(p, ...edges[i])), padding)
    }
    const sample = { clearance, elevation: clearance ? height(p) : 0 }
    samples.set(key, sample)
    return sample
  }
  const options: PointMm[][] = []
  if (turn) {
    const minRadius = width * 2.1
    const scaled = [.46, .62, .79, 1, 1.24, 1.55].map(scale => Math.max(minRadius, Math.round(turn.radius * scale)))
    const radii = turn.fixed ? [turn.radius] : [...new Set(scaled)]
    const lateral = (from.y - turn.at.y) * direction.x - (from.x - turn.at.x) * direction.y
    for (const radius of radii) for (const sign of [Math.sign(lateral) || 1, -(Math.sign(lateral) || 1)]) {
      const at = (along: number, across: number) => point(turn.at, along * radius, sign * across * radius)
      const turning = at(1, 0)
      const profiles = [
        [at(1.23, .70), turning, at(.69, -.36)],
        [at(1.20, .45), turning, at(.47, -.26)],
        [at(1.12, .93), turning, at(.80, -.60), at(.28, -.49)],
        [at(1.38, 1.05), at(1.25, .53), turning, at(.64, -.32)],
        [at(1.09, .44), turning, at(.46, -.12)],
      ]
      for (const anchors of profiles) options.push([from, ...anchors.filter(p => p === turning
        || distance(p, from) > width * 1.3 && distance(p, to) > width * 1.3), to])
    }
  } else {
    const span = distance(from, to)
    for (const reach of [.25, .40, .57]) for (const sign of [1, -1]) {
      const offset = sign * Math.max(width * 2.8, reach * span)
      options.push([from, point(from, span * .16, offset * .59), point(from, span * .44, offset), point(from, span * .76, offset * .64), to])
    }
  }

  const start = measure(from).elevation, end = measure(to).elevation
  const seen = new Set<string>()
  const ranked = options.flatMap(course => {
    const key = course.map(p => `${p.x}/${p.y}`).join(';')
    if (seen.has(key) || course.slice(1).some((p, i) => distance(p, course[i]) < width * .95)) return []
    seen.add(key)
    const lengths = course.slice(1).map((p, i) => distance(p, course[i])), length = lengths.reduce((a, b) => a + b)
    if (Math.abs(end - start) > length * .59) return []
    let walked = 0, cost = length + disturbance(course) * 8200
    for (const [i, span] of lengths.entries()) {
      const a = course[i], b = course[i + 1], count = Math.min(32, Math.ceil(span / Math.max(600, width * .55)))
      let prev = measure(a)
      for (let k = 1; k <= count; k++) {
        const t = k / count
        const site = measure({ x: Math.round(a.x + (b.x - a.x) * t), y: Math.round(a.y + (b.y - a.y) * t) })
        if (site.clearance < width * .44) return []
        const step = span / count, grade = Math.abs(site.elevation - prev.elevation) / step
        const target = start + (end - start) * (walked + span * t) / length
        const pad = Math.max(0, padding - site.clearance) / padding
        cost += step * (3.7 * grade ** 2 + Math.abs(site.elevation - target) / 9250 + pad * 3.8)
        prev = site
      }
      walked += span
    }
    return [{ course, cost }]
  }).sort((a, b) => a.cost - b.cost)
  meter.charge({ fieldEvaluations: samples.size })
  return ranked.slice(0, 16).map(row => row.course)
}
