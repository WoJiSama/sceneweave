import { connectionBandCenterline, polylineSides } from '../geometry/geometry.js'
import { routeWidthFrame } from '../geometry/route-width.js'
import type { MaterialPaint, Path, PointMm } from '../model/scene.js'

export interface ProjectedPavingCourse {
  points: PointMm[]
  direction: PointMm
  paint: MaterialPaint
}

function sideBetween(points: PointMm[], ends: number[], from: number, to: number): PointMm[] {
  const bevel = (index: number) => index > 0 && ends[index] - ends[index - 1] === 2
  const midpoint = (index: number) => {
    const a = points[ends[index] - 1], b = points[ends[index]]
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
  }
  const side = points.slice(ends[from], ends[to] + (bevel(to) ? 0 : 1))
  if (bevel(from)) side.unshift(midpoint(from))
  if (bevel(to)) side.push(midpoint(to))
  return side
}

/** Paint cells partition the same miter/bevel band used for the path footprint. */
export function projectRoutePaving(path: Path, paint: MaterialPaint): ProjectedPavingCourse[] {
  const stations = path.widthSections?.length ? routeWidthFrame(path.centerlineMm, path.widthMm, path.widthSections).stations : undefined
  const bridge = !!path.assembly?.bridge
  const centerline = stations?.map(station => station.positionMm) ?? (bridge ? connectionBandCenterline(path.centerlineMm) : path.centerlineMm)
  const widths = stations?.map(station => station.widthMm) ?? path.widthMm
  const sides = polylineSides(centerline, widths, !!stations || !bridge)
  if (!sides.left.length || !sides.right.length) return []

  let distance = 0
  const segments = centerline.slice(1).map((end, i) => {
    const start = centerline[i], x = end.x - start.x, y = end.y - start.y, length = Math.hypot(x, y)
    const segment = { start, station: distance, direction: { x: x / length, y: y / length } }
    distance += length
    return segment
  })
  const cuts = [0]
  for (let i = 1; i < segments.length; i++) {
    const a = segments[i - 1].direction, b = segments[i].direction
    if (Math.hypot(a.x - b.x, a.y - b.y) > 1e-7) cuts.push(i)
  }
  return cuts.map((from, i) => {
    const to = cuts[i + 1] ?? segments.length
    const { start, station, direction } = segments[from]
    const x = paint.originMm.x - station, y = paint.originMm.y
    const rotationDeg = (paint.rotationDeg + Math.atan2(direction.y, direction.x) * 180 / Math.PI + 360) % 360
    return {
      points: [...sideBetween(sides.left, sides.leftEnds, from, to), ...sideBetween(sides.right, sides.rightEnds, from, to).reverse()],
      direction,
      paint: { ...paint, alignment: 'world', rotationDeg,
        originMm: { x: start.x + direction.x * x - direction.y * y, y: start.y + direction.y * x + direction.x * y } },
    }
  })
}

/** Carry the phase at the actual join to a differently oriented road course.
 * Reversing the order in which the road was drawn cannot flip the texture. */
export function joinedPavingPaint(bridge: ProjectedPavingCourse, road: ProjectedPavingCourse, at: PointMm): MaterialPaint {
  const from = bridge.direction, to = road.direction
  const sign = from.x * to.x + from.y * to.y < 0 ? -1 : 1
  const cos = (from.x * to.x + from.y * to.y) * sign
  const sin = (from.x * to.y - from.y * to.x) * sign
  if (Math.abs(sin) < 1e-8) return bridge.paint
  const x = bridge.paint.originMm.x - at.x, y = bridge.paint.originMm.y - at.y
  return { ...bridge.paint, rotationDeg: (bridge.paint.rotationDeg + Math.atan2(sin, cos) * 180 / Math.PI + 360) % 360,
    originMm: { x: at.x + x * cos - y * sin, y: at.y + x * sin + y * cos } }
}
