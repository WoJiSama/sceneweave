import type { PointMm, SurfaceRuleRegion } from '../model/scene.js'
import { pointInPolygon, polygonInside } from '../geometry/geometry.js'
import { polygonBooleanWithHoles, type PolygonWithHoles } from '../geometry/polygon-boolean.js'

/** Integer clipping must remain inside the support after rounding crossings. */
export function clipSurfaceRegions(input: readonly SurfaceRuleRegion[], support: readonly PointMm[]): SurfaceRuleRegion[] {
  const boundary = support.map(point => ({ ...point }))
  const subject: PolygonWithHoles[] = input.map(region => ({ outer: region.outerMm, holes: region.holesMm }))
  // Repeated clipping is common (brush, command, cold validation). Once the
  // actual integer outline is inside, do not round its crossings a second time.
  const inside = subject.every(polygon => polygonInside(polygon.outer, boundary))
  const clipped = polygonBooleanWithHoles({ operation: inside ? 'union' : 'intersection', subject,
    clip: inside ? [] : [{ outer: boundary, holes: [] }] }).polygons
  const inStroke = (point: PointMm) => subject.some(polygon => pointInPolygon(point, polygon.outer)
    && !polygon.holes.some(hole => pointInPolygon(point, hole, false)))
  const snap = (point: PointMm): PointMm => {
    if (pointInPolygon(point, boundary) && inStroke(point)) return point
    // Nearest integer rounding can fall just outside a diagonal support edge.
    // Move only that crossing by at most one millimetre on either axis. Never
    // accept a tolerance in the persisted geometry or silently remove a ring.
    const candidates: PointMm[] = []
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      const candidate = { x: point.x + dx, y: point.y + dy }
      if (pointInPolygon(candidate, boundary) && inStroke(candidate)) candidates.push(candidate)
    }
    candidates.sort((a, b) => (a.x - point.x) ** 2 + (a.y - point.y) ** 2 - (b.x - point.x) ** 2 - (b.y - point.y) ** 2 || a.x - b.x || a.y - b.y)
    if (!candidates.length) throw new Error('地表笔迹的毫米交点无法保留在支撑内，请调整笔迹。')
    return candidates[0]
  }
  const corrected = clipped.map(polygon => ({ outer: polygon.outer.map(snap), holes: polygon.holes }))
  // Full strict validation still rejects self contacts, lost holes, collapsed
  // components, or an edge crossing a concavity after the local correction.
  const result = polygonBooleanWithHoles({ operation: 'union', subject: corrected, clip: [] }).polygons
  if (result.some(polygon => !polygonInside(polygon.outer, boundary))
    || polygonBooleanWithHoles({ operation: 'difference', subject: result, clip: [{ outer: boundary, holes: [] }] }).polygons.length
    || polygonBooleanWithHoles({ operation: 'difference', subject: result, clip: subject }).polygons.length) {
    throw new Error('地表笔迹毫米裁切后仍越过笔迹或明确支撑，工程未修改。')
  }
  return result.map(polygon => ({ outerMm: polygon.outer, holesMm: polygon.holes }))
}
