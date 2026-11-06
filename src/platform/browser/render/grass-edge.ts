import type { PointMm } from '../../../shared/model/scene.js'
import type { ProjectedVisualBoundary } from '../../../shared/projection/types.js'
import type { VisualEdgeLook } from '../../../shared/visual/types.js'
import { visualSampleAtDistance } from '../../../shared/visual/geometry.js'
import { variableOffsetPolyline, visualRandom } from './visual-geometry.js'

/** Disposable paint rings. Phase follows the complete world boundary, so crop
 * and resolution cannot move the grass/rock seam. Saved geometry stays intact. */
export function grassEdgeRings(boundary: ProjectedVisualBoundary, look: VisualEdgeLook, side: number, fraction: number): PointMm[][] {
  if (!(boundary.lengthMm > 0) || !(look.widthMm > 0) || !(fraction > 0)) return []
  const count = Math.min(1024, Math.max(4, Math.ceil(boundary.lengthMm / Math.max(80, look.repeatMm * .6))))
  // Preserve every real corner, even for a narrow band with a large repeat.
  // Uniform detail stations alone could cut a chord across the wrong side.
  const distances = [...new Set([...boundary.samples.map(sample => sample.distanceMm),
    ...Array.from({ length: count + 1 }, (_, index) => boundary.lengthMm * index / count)])]
    .filter(distance => !boundary.closed || distance < boundary.lengthMm).sort((a, b) => a - b)
  const points = distances.map(distance => visualSampleAtDistance(boundary, distance).positionMm)
  const widths = distances.map(distance => {
    const station = distance / boundary.lengthMm * count, cell = Math.floor(station), t = station - cell, smooth = t * t * (3 - 2 * t)
    const next = boundary.closed ? (cell + 1) % count : cell + 1
    const first = visualRandom(look.seed, cell, 110), second = visualRandom(look.seed, next, 110)
    return look.widthMm * fraction * (.3 + .7 * (first + (second - first) * smooth)) * side
  })
  const outer = variableOffsetPolyline(points, widths, boundary.closed)
  return boundary.closed ? [[...boundary.points], outer.reverse()] : [[...boundary.points, ...outer.reverse()]]
}
