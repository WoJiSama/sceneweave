import type { ForestParameters } from '../../shared/generation/domains/forest/contracts.js'
import { forestRectangle } from '../../shared/generation/domains/forest/index.js'
import { distanceToSegment, polygonInside, polygonValid, polylineBand } from '../../shared/geometry/geometry.js'
import type { PointMm } from '../../shared/model/scene.js'
import { terrainRandomUnit } from '../../shared/terrain-generation/field.js'

/** Default waypoints for the forest form. Keep a common entry stem where all
 * clearing anchors are well inside, then bend each branch into its clearing. */
export function planWoodlandTrails(p: ForestParameters, seed: string): void {
  const entry = p.entrances[0]
  const start = entry.positionMm, width = entry.widthMm, boundary = forestRectangle(p.boundsMm)
  const angle = entry.directionDeg * Math.PI / 180
  const inward = { x: Math.round(Math.cos(angle)), y: Math.round(Math.sin(angle)) }
  const nearest = Math.min(...p.clearings.map(({ anchorMm }) => (anchorMm.x - start.x) * inward.x + (anchorMm.y - start.y) * inward.y))
  const stemLength = p.clearings.length > 1 && nearest > width * 3 ? Math.round(Math.min(nearest * .29, 3600)) : 0
  const stem = { x: start.x + inward.x * stemLength, y: start.y + inward.y * stemLength }
  const groves = p.zones.length < 2 ? [] : p.zones.filter(zone => zone.vegetation.some(row => row.role === 'tree' && row.coveragePpm)).map(zone => {
    const count = zone.boundaryMm.length
    const center = zone.boundaryMm.reduce((p, q) => ({ x: p.x + q.x / count, y: p.y + q.y / count }), { x: 0, y: 0 })
    return { center, radius: Math.min(...zone.boundaryMm.map(point => Math.hypot(point.x - center.x, point.y - center.y))) }
  })
  const fits = (points: PointMm[]) => {
    const band = polylineBand(points, width, true)
    return polygonValid(band, true) && polygonInside(band, boundary)
  }
  const treeClearance = (points: PointMm[]) => groves.reduce((score, { center, radius }) => {
    const distance = Math.min(...points.slice(1).map((point, index) => distanceToSegment(center, points[index], point)))
    return score - Math.max(0, radius + width / 2 - distance)
  }, 0)
  for (const route of p.routes) {
    const end = p.clearings.find(row => row.id === route.toClearingId)!.anchorMm
    const dx = end.x - stem.x, dy = end.y - stem.y, distance = Math.hypot(dx, dy)
    if (distance < width * 3) continue
    const unit = terrainRandomUnit(seed, `forest-trail/${route.id}`)
    const bend = Math.min(distance * .13, 2400) * (unit < .5 ? -1 : 1)
    const candidates = [bend, -bend].map(offset => [start, ...(stemLength ? [stem] : []), ...[.23, .43, .63, .81].map(t => {
      const swing = offset * Math.sin(Math.PI * t)
      return { x: Math.round(stem.x + t * dx - swing * dy / distance), y: Math.round(stem.y + t * dy + swing * dx / distance) }
    }), end]).filter(fits)
    candidates.sort((a, b) => treeClearance(b) - treeClearance(a))
    if (candidates.length) route.viaMm = candidates[0].slice(1, -1)
  }
}
