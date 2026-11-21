import { connectionArcFrame } from './connection-route.js'
import { polylineBand, widthProfileBand } from './geometry.js'
import { ROUTE_FRACTION, ROUTE_WIDTH_SECTION_LIMIT, type RouteWidthSection } from './route-width.js'
import type { PointMm } from '../model/scene.js'

/** Fit the default width around unsupported shoulders without changing the route. */
export function fitRoadWidth(points: readonly PointMm[], widthMm: number, supports: (band: PointMm[]) => boolean) {
  const regular = polylineBand(points, widthMm, true)
  if (supports(regular)) return { band: regular, sections: [] as RouteWidthSection[] }
  const minimum = Math.min(widthMm, Math.max(600, Math.ceil(widthMm / 2)))
  if (minimum === widthMm || !supports(polylineBand(points, minimum, true))) return null
  const route = connectionArcFrame(points)
  const count = Math.min(24, Math.max(1, Math.ceil(route.length / Math.max(widthMm / 2, 600))))
  const bad = Array.from({ length: count }, (_, index) => {
    const start = index * route.length / count, end = (index + 1) * route.length / count
    const slice = [route.at(start), ...points.filter((_, i) => route.distances[i] > start && route.distances[i] < end), route.at(end)]
    return !supports(polylineBand(slice, widthMm, true))
  })
  const ppm = (station: number) => Math.round(station / count * ROUTE_FRACTION)
  for (const padding of [0, 1, 2, count]) {
    const sections: RouteWidthSection[] = []
    for (const [index, needsWidth] of bad.entries()) {
      if (!needsWidth) continue
      const startPpm = ppm(Math.max(0, index - padding)), endPpm = ppm(Math.min(count, index + 1 + padding))
      const last = sections.at(-1)
      if (last && last.endPpm >= startPpm) last.endPpm = endPpm
      else sections.push({ startPpm, endPpm, widthMm: minimum })
    }
    if (!sections.length && padding === count) sections.push({ startPpm: 0, endPpm: ROUTE_FRACTION, widthMm: minimum })
    if (!sections.length || sections.length > ROUTE_WIDTH_SECTION_LIMIT) continue
    const band = widthProfileBand(points, widthMm, sections)
    if (supports(band)) return { band, sections }
  }
  return null
}
