import { z } from 'zod'
import { positive } from '../validation/primitives.js'
import type { PointMm } from '../model/scene.js'
import { connectionArcFrame } from './connection-route.js'

export const ROUTE_FRACTION = 1_000_000
export const ROUTE_WIDTH_SECTION_LIMIT = 16
export const routeWidthSectionsSchema = z.array(z.object({
  startPpm: z.number().int().min(0).max(ROUTE_FRACTION - 1),
  endPpm: z.number().int().min(1).max(ROUTE_FRACTION),
  widthMm: positive,
}).strict()).min(1).max(ROUTE_WIDTH_SECTION_LIMIT).refine(sections => sections.every((section, index) =>
  section.startPpm < section.endPpm && (!index || sections[index - 1].endPpm < section.startPpm)),
'局部净宽区间须按路线顺序排列，区间之间须留出过渡空间。')
export type RouteWidthSection = z.infer<typeof routeWidthSectionsSchema>[number]

/** The default width and manual sections describe one continuous road. Each
 * transition fits in the adjoining gap and uses the change in width as its
 * preferred length. The stored route and its controls keep their own identity. */
export function routeWidthFrame(points: readonly PointMm[], baseWidthMm: number, sections: readonly RouteWidthSection[]) {
  const route = connectionArcFrame(points), { length } = route
  const knots = new Map<number, number>([[0, baseWidthMm], [length, baseWidthMm]])
  const distance = (ppm: number) => length * (ppm / ROUTE_FRACTION)
  for (const [index, section] of sections.entries()) {
    const start = distance(section.startPpm), end = distance(section.endPpm)
    const transitionMm = Math.abs(section.widthMm - baseWidthMm)
    if (start > 0) {
      const previousEnd = index ? distance(sections[index - 1].endPpm) : 0
      knots.set(Math.max(start - transitionMm, index ? (previousEnd + start) / 2 : 0), baseWidthMm)
    }
    if (end < length) {
      const nextStart = index < sections.length - 1 ? distance(sections[index + 1].startPpm) : length
      knots.set(Math.min(end + transitionMm, index < sections.length - 1 ? (end + nextStart) / 2 : length), baseWidthMm)
    }
    knots.set(start, section.widthMm)
    knots.set(end, section.widthMm)
  }
  const ordered = [...knots.keys()].sort((a, b) => a - b)
  const widthAt = (distanceMm: number) => {
    const upper = ordered.findIndex(value => value >= distanceMm)
    if (upper <= 0) return knots.get(ordered[upper === 0 ? 0 : ordered.length - 1])!
    const a = ordered[upper - 1], b = ordered[upper], first = knots.get(a)!, last = knots.get(b)!
    return first + (last - first) * ((distanceMm - a) / (b - a))
  }
  const originals = new Map(route.distances.map((value, index) => [value, points[index]]))
  const stations = [...new Set([...route.distances, ...ordered])].sort((a, b) => a - b).map(distanceMm => ({
    distanceMm, positionMm: originals.get(distanceMm) ?? route.at(distanceMm), widthMm: widthAt(distanceMm),
  }))
  return { widthAt, stations, distances: route.distances }
}
