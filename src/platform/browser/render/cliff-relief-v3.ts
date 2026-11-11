import polygonClipping, { type Polygon, type Ring } from 'polygon-clipping'
import type { PointMm } from '../../../shared/model/scene.js'
import type { ProjectedVisualBoundary } from '../../../shared/projection/types.js'
import type { VisualEdgeLook } from '../../../shared/visual/types.js'
import { cliffReliefV2, type CliffPaintFacetV2, type CliffPaintStrokeV2, type CliffReliefV2Options } from './cliff-relief-v2.js'
import { visualRandom } from './visual-geometry.js'

export const CLIFF_RELIEF_V3_PROFILE = 'rockRelief3' as const
export const CLIFF_RELIEF_V3_LIMITS = Object.freeze({ cells: 128, facets: 512, strokes: 1536, erosion: 256,
  openingPolygons: 64, openingPoints: 4096, outputPoints: 32768, coordinateMm: 1_000_000_000 })
export type CliffReliefV3Options = CliffReliefV2Options
export interface CliffReliefV3 {
  version: 3
  baseOpacity: number
  faceRings: PointMm[][]
  /** Envelope only: never paint this as a new closed outline. */
  outer: PointMm[]
  facets: CliffPaintFacetV2[]
  ledges: CliffPaintStrokeV2[]
  crestRuns: CliffPaintStrokeV2[]
  footRuns: CliffPaintStrokeV2[]
  fractures: CliffPaintStrokeV2[]
  erosion: { polygon: PointMm[]; shade: number }[]
}
const EPS = 1e-7
const finitePoint = (point: PointMm) => point && Number.isFinite(point.x) && Number.isFinite(point.y)
  && Math.abs(point.x) <= CLIFF_RELIEF_V3_LIMITS.coordinateMm && Math.abs(point.y) <= CLIFF_RELIEF_V3_LIMITS.coordinateMm
const area = (points: readonly PointMm[]) => Math.abs(points.reduce((sum, point, index) => {
  const next = points[(index + 1) % points.length]; return sum + point.x * next.y - next.x * point.y
}, 0) / 2)
const mix = (a: PointMm, b: PointMm, t: number): PointMm => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
const ring = (points: readonly PointMm[]): Ring => [...points.map(point => [point.x, point.y] as [number, number]), [points[0].x, points[0].y]]
const unring = (points: Ring): PointMm[] => points.slice(0, -1).map(([x, y]) => ({ x, y }))

/** Keep a finite subrun of an already opening-clipped line. Arc positions are
 * local to that visible run, so trimming cannot bridge two separate openings. */
function subrun(points: readonly PointMm[], from: number, to: number): PointMm[] {
  const distances = [0]
  for (let index = 1; index < points.length; index++) distances.push(distances[index - 1] + Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y))
  const length = distances[distances.length - 1]
  if (!(length > EPS)) return []
  const start = length * from, end = length * to, result: PointMm[] = []
  for (let index = 1; index < points.length; index++) {
    const low = Math.max(start, distances[index - 1]), high = Math.min(end, distances[index]), span = distances[index] - distances[index - 1]
    if (span <= EPS || high - low <= EPS) continue
    const a = mix(points[index - 1], points[index], (low - distances[index - 1]) / span)
    const b = mix(points[index - 1], points[index], (high - distances[index - 1]) / span)
    if (!result.length) result.push(a)
    result.push(b)
  }
  return result
}

/** Version 3 retains the exact v2 joined face/openings, replacing broad tiled
 * contrast with sparse asymmetric rock lenses and shorter, lighter contacts.
 * These are disposable paint values, not extra terrain or walkable geometry.
 * The caller still clips Canvas to faceRings and the true connection openings,
 * including stroke radii and antialiasing, before painting any detail. */
export function cliffReliefV3(boundary: ProjectedVisualBoundary, look: VisualEdgeLook, side: number, options: CliffReliefV3Options = {}): CliffReliefV3 {
  if (!boundary || !look || side !== -1 && side !== 1 || look.kind !== 'cliff'
    || !Number.isFinite(look.widthMm) || look.widthMm < 0 || look.widthMm > 5000
    || !Number.isFinite(look.repeatMm) || look.repeatMm <= 0 || look.repeatMm > 20000
    || !Number.isFinite(look.opacity) || look.opacity < 0 || look.opacity > 1 || !Number.isFinite(look.intensity) || look.intensity < 0 || look.intensity > 2
    || typeof look.seed !== 'string' || !look.seed.length || look.seed.length > 128
    || !/^#[\da-f]{6}$/i.test(look.color) || !/^#[\da-f]{6}$/i.test(look.accentColor)
    || !Number.isFinite(boundary.lengthMm) || boundary.lengthMm <= 0
    || typeof boundary.closed !== 'boolean' || !Array.isArray(boundary.points) || boundary.points.length < (boundary.closed ? 3 : 2) || boundary.points.length > 513 || !boundary.points.every(finitePoint)
    || !Array.isArray(boundary.samples) || boundary.samples.length !== boundary.points.length + (boundary.closed ? 1 : 0)
    || boundary.samples.some((sample, index) => !finitePoint(sample.positionMm) || !finitePoint(sample.normal) || !finitePoint(sample.tangent)
      || !Number.isFinite(sample.distanceMm) || sample.distanceMm < 0 || index > 0 && sample.distanceMm <= boundary.samples[index - 1].distanceMm
      || index > 0 && Math.abs(sample.distanceMm - boundary.samples[index - 1].distanceMm - Math.hypot(sample.positionMm.x - boundary.samples[index - 1].positionMm.x, sample.positionMm.y - boundary.samples[index - 1].positionMm.y)) > 1e-5
      || Math.abs(Math.hypot(sample.normal.x, sample.normal.y) - 1) > 1e-5 || Math.abs(Math.hypot(sample.tangent.x, sample.tangent.y) - 1) > 1e-5
      || Math.abs(sample.normal.x + sample.tangent.y) > 1e-5 || Math.abs(sample.normal.y - sample.tangent.x) > 1e-5
      || Math.hypot(sample.positionMm.x - boundary.points[index % boundary.points.length].x, sample.positionMm.y - boundary.points[index % boundary.points.length].y) > 1e-5)
    || Math.abs(boundary.samples[0].distanceMm) > EPS || Math.abs(boundary.samples.at(-1)!.distanceMm - boundary.lengthMm) > 1e-5) throw new Error('第三版崖面需要有限且一致的投影采样、净宽、颜色及明确侧向。')
  if (options.dropMm !== undefined && (!Number.isFinite(options.dropMm) || options.dropMm < 0)) throw new Error('第三版崖面仅接收非负有限的实际可见高差。')
  const openings = options.openingPolygons ?? []
  if (!Array.isArray(openings) || openings.length > CLIFF_RELIEF_V3_LIMITS.openingPolygons
    || openings.reduce((sum, points) => sum + points.length, 0) > CLIFF_RELIEF_V3_LIMITS.openingPoints
    || openings.some(points => !Array.isArray(points) || points.length < 3 || !points.every(finitePoint))) throw new Error('第三版崖面实际开口包含无效轮廓或超过绘制预算。')
  const base = cliffReliefV2(boundary, look, side, options)
  const output: CliffReliefV3 = { version: 3, baseOpacity: .54, faceRings: base.faceRings, outer: base.outer,
    facets: [], ledges: [], crestRuns: [], footRuns: [], fractures: [], erosion: [] }
  if (!base.faceRings.length) return output
  let pointCount = base.faceRings.reduce((sum, points) => sum + points.length, 0) + base.outer.length, strokeCount = 0
  const charge = (points: readonly PointMm[]) => {
    pointCount += points.length
    if (pointCount > CLIFF_RELIEF_V3_LIMITS.outputPoints || !points.every(finitePoint)) throw new Error('第三版崖面派生细节超过有限绘制点预算。')
  }
  const random = (index: number, channel: number) => visualRandom(look.seed, index, 400 + channel)
  for (const [index, facet] of base.facets.entries()) {
    if (random(index, 0) < .28 || facet.polygon.length < 3) continue
    const center = facet.polygon.reduce((sum, p) => ({ x: sum.x + p.x / facet.polygon.length, y: sum.y + p.y / facet.polygon.length }), { x: 0, y: 0 })
    const normal = facet.normal, tangent = { x: normal.y, y: -normal.x }
    const projection = (direction: PointMm) => facet.polygon.map(p => (p.x - center.x) * direction.x + (p.y - center.y) * direction.y)
    const along = projection(tangent), across = projection(normal)
    const radiusAlong = (Math.max(...along) - Math.min(...along)) * (.23 + random(index, 1) * .14)
    const radiusAcross = (Math.max(...across) - Math.min(...across)) * (.24 + random(index, 2) * .13)
    const drift = (random(index, 3) - .5) * radiusAlong * .6
    const lens = Array.from({ length: 7 }, (_, vertex) => {
      const angle = vertex / 7 * Math.PI * 2 + .15, factor = .67 + random(index * 7 + vertex, 4) * .33
      const x = Math.cos(angle) * radiusAlong * factor + drift, y = Math.sin(angle) * radiusAcross * factor
      return { x: center.x + tangent.x * x + normal.x * y, y: center.y + tangent.y * x + normal.y * y }
    })
    const subject: Polygon = [ring(lens)], clip: Polygon = [ring(facet.polygon)]
    for (const polygon of polygonClipping.intersection(subject, clip)) {
      if (polygon.length !== 1) continue
      const points = unring(polygon[0]); if (points.length < 3 || area(points) < EPS) continue
      charge(points)
      output.facets.push({ polygon: points, normal: { ...normal }, shade: .965 + random(index, 5) * .07, opacity: .055 + random(index, 6) * .06 })
      if (output.facets.length > CLIFF_RELIEF_V3_LIMITS.facets) throw new Error('第三版崖面岩片数量超过绘制预算。')
    }
  }
  const strokes = (source: CliffPaintStrokeV2[], target: CliffPaintStrokeV2[], channel: number, keep: number, width: number, opacity: number) => {
    for (const [index, stroke] of source.entries()) {
      if (random(index, channel) > keep) continue
      const from = .12 + random(index, channel + 1) * .18, to = .58 + random(index, channel + 2) * .2
      const points = subrun(stroke.points, from, to)
      if (points.length < 2) continue
      charge(points)
      if (++strokeCount > CLIFF_RELIEF_V3_LIMITS.strokes) throw new Error('第三版崖面短笔触数量超过绘制预算。')
      target.push({ points, color: stroke.color, widthMm: Math.max(4, stroke.widthMm * width), opacity: Math.min(opacity, stroke.opacity * .56) })
    }
  }
  strokes(base.ledges, output.ledges, 10, .7, .65, .12)
  strokes(base.crestRuns, output.crestRuns, 20, .73, .7, .17)
  strokes(base.footRuns, output.footRuns, 30, .66, .65, .14)
  strokes(base.fractures, output.fractures, 40, .82, .8, .17)
  for (const [index, mark] of base.erosion.entries()) {
    if (random(index, 50) < .4) continue
    const center = mark.polygon.reduce((sum, p) => ({ x: sum.x + p.x / mark.polygon.length, y: sum.y + p.y / mark.polygon.length }), { x: 0, y: 0 })
    // Convex combinations remain in the original small erosion fragment only
    // after the explicit clip below, including concave pieces near openings.
    const subject: Polygon = [ring(mark.polygon.map((p, vertex) => mix(center, p, .4 + random(index * 11 + vertex, 51) * .3)))], clip: Polygon = [ring(mark.polygon)]
    for (const polygon of polygonClipping.intersection(subject, clip)) {
      if (polygon.length !== 1) continue
      const points = unring(polygon[0]); if (points.length < 3 || area(points) < EPS) continue
      charge(points); output.erosion.push({ polygon: points, shade: .035 + random(index, 52) * .04 })
      if (output.erosion.length > CLIFF_RELIEF_V3_LIMITS.erosion) throw new Error('第三版崖面侵蚀细节超过绘制预算。')
    }
  }
  return output
}
