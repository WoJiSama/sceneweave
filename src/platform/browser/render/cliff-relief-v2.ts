import polygonClipping, { type MultiPolygon, type Polygon, type Ring } from 'polygon-clipping'
import type { PointMm } from '../../../shared/model/scene.js'
import type { ProjectedVisualBoundary } from '../../../shared/projection/types.js'
import type { VisualEdgeLook } from '../../../shared/visual/types.js'
import { visualSampleAtDistance } from '../../../shared/visual/geometry.js'
import { cliffRelief } from './cliff-relief.js'
import { visualRandom } from './visual-geometry.js'

export interface CliffPaintStrokeV2 {
  points: PointMm[]
  color: string
  widthMm: number
  opacity: number
}
export interface CliffPaintFacetV2 {
  polygon: PointMm[]
  normal: PointMm
  shade: number
  opacity: number
}
export interface CliffReliefV2 {
  version: 2
  /** Suggested multiplier for look.opacity; broad rock remains subordinate to its ledges. */
  baseOpacity: number
  faceRings: PointMm[][]
  outer: PointMm[]
  facets: CliffPaintFacetV2[]
  ledges: CliffPaintStrokeV2[]
  crestRuns: CliffPaintStrokeV2[]
  footRuns: CliffPaintStrokeV2[]
  fractures: CliffPaintStrokeV2[]
  erosion: { polygon: PointMm[]; shade: number }[]
}
export interface CliffReliefV2Options {
  /** Actual, audience-visible elevation difference only. Omitted uses a neutral cosmetic scale. */
  dropMm?: number
  /** Actual, audience-filtered connection bands. The caller must retain its canvas opening clip too. */
  openingPolygons?: readonly PointMm[][]
}
export const CLIFF_RELIEF_V2_LIMITS = Object.freeze({ cells: 128, openingPolygons: 64, openingPoints: 4096, outputPoints: 32768 })
const EPS = 1e-7
const clone = (points: readonly PointMm[]): PointMm[] => points.map(point => ({ ...point }))
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value))
const area = (points: readonly PointMm[]) => points.reduce((sum, point, index) => {
  const next = points[(index + 1) % points.length]
  return sum + point.x * next.y - next.x * point.y
}, 0) / 2
const ring = (points: readonly PointMm[]): Ring => [...points.map(point => [point.x, point.y] as [number, number]), [points[0].x, points[0].y]]
const unring = (points: Ring): PointMm[] => points.slice(0, -1).map(([x, y]) => ({ x, y }))
const cross = (a: PointMm, b: PointMm) => a.x * b.y - a.y * b.x
const delta = (a: PointMm, b: PointMm): PointMm => ({ x: a.x - b.x, y: a.y - b.y })
const mix = (a: PointMm, b: PointMm, t: number): PointMm => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
const same = (a: PointMm, b: PointMm) => Math.abs(a.x - b.x) < EPS && Math.abs(a.y - b.y) < EPS

/** Even-odd membership for disposable float paint, including the joined face holes. */
function inside(point: PointMm, rings: readonly PointMm[][]): boolean {
  let value = false
  for (const points of rings) for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i], b = points[j]
    const direction = delta(b, a), relative = delta(point, a)
    if (Math.abs(cross(direction, relative)) < EPS && point.x >= Math.min(a.x, b.x) - EPS && point.x <= Math.max(a.x, b.x) + EPS
      && point.y >= Math.min(a.y, b.y) - EPS && point.y <= Math.max(a.y, b.y) + EPS) return true
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) value = !value
  }
  return value
}

/** Split lines at the actual face and opening boundaries, so no painter must
 * connect two isolated visible ledges across an excluded plateau or stair. */
function clipStroke(points: readonly PointMm[], rings: readonly PointMm[][]): PointMm[][] {
  const result: PointMm[][] = []
  let run: PointMm[] | undefined
  for (let index = 1; index < points.length; index++) {
    const a = points[index - 1], b = points[index], direction = delta(b, a), cuts = [0, 1]
    for (const boundary of rings) for (let i = 0; i < boundary.length; i++) {
      const c = boundary[i], d = boundary[(i + 1) % boundary.length], edge = delta(d, c), denominator = cross(direction, edge)
      if (Math.abs(denominator) < EPS) continue
      const relative = delta(c, a), t = cross(relative, edge) / denominator, u = cross(relative, direction) / denominator
      if (t > EPS && t < 1 - EPS && u >= -EPS && u <= 1 + EPS) cuts.push(t)
    }
    const sorted = cuts.sort((a, b) => a - b).filter((value, i, values) => !i || value - values[i - 1] > EPS)
    for (let i = 1; i < sorted.length; i++) {
      const from = mix(a, b, sorted[i - 1]), to = mix(a, b, sorted[i])
      if (same(from, to) || !inside(mix(from, to, .5), rings)) { run = undefined; continue }
      if (run && same(run[run.length - 1], from)) run.push(to)
      else { run = [from, to]; result.push(run) }
    }
  }
  return result
}

/** Versioned paint geometry for rockRelief2. It consumes only projected public
 * inputs and never mutates terrain, support, saved width or the old relief.
 * Broad staggered facets and deliberately separated ledges replace full-length
 * horizontal stripes. The canvas painter still clips face, high ground and
 * actual connection openings before painting these disposable values. */
export function cliffReliefV2(boundary: ProjectedVisualBoundary, look: VisualEdgeLook, side: number, options: CliffReliefV2Options = {}): CliffReliefV2 {
  const dropMm = options.dropMm ?? 1800
  if (side !== -1 && side !== 1 || look.kind !== 'cliff' || !Number.isFinite(look.widthMm) || look.widthMm < 0 || !Number.isFinite(look.repeatMm) || look.repeatMm <= 0
    || !Number.isFinite(dropMm) || dropMm < 0 || !Number.isFinite(boundary.lengthMm) || boundary.lengthMm <= 0
    || boundary.points.length < 2 || boundary.points.length > 513 || boundary.samples.length < 2 || boundary.samples.length > 514
    || boundary.points.some(point => !Number.isFinite(point.x) || !Number.isFinite(point.y))) throw new Error('第二版崖面须为有限投影曲线、非负宽度/高差与明确侧向。')
  const openings = options.openingPolygons ?? []
  if (openings.length > CLIFF_RELIEF_V2_LIMITS.openingPolygons || openings.reduce((sum, points) => sum + points.length, 0) > CLIFF_RELIEF_V2_LIMITS.openingPoints
    || openings.some(points => points.length < 3 || points.some(point => !Number.isFinite(point.x) || !Number.isFinite(point.y)))) throw new Error('第二版崖面连接开口超过绘制预算或包含无效轮廓。')
  const output: CliffReliefV2 = { version: 2, baseOpacity: .62, faceRings: [], outer: [], facets: [], ledges: [], crestRuns: [], footRuns: [], fractures: [], erosion: [] }
  if (!look.widthMm) return output
  const original = cliffRelief(boundary, look, side)
  // Retain the old joined face exactly. Its two closed rings are explicitly
  // ordered as outer/hole for boolean operations, independent of side/winding.
  const ordered = [...original.faceRings].sort((a, b) => Math.abs(area(b)) - Math.abs(area(a)))
  const face: Polygon = ordered.map(ring)
  const regions: MultiPolygon = openings.length ? polygonClipping.difference(face, ...openings.map(points => [ring(points)] as Polygon)) : [face]
  const faceRings = regions.flatMap(polygon => polygon.map(unring))
  output.faceRings = faceRings
  output.outer = clone(original.outer)
  if (!regions.length) return output
  const length = boundary.lengthMm, phase = visualRandom(look.seed, 0, 18) * Math.PI * 2
  const heightFactor = clamp(Math.sqrt(dropMm / 1800), .55, 1.35)
  const widthAt = (distance: number) => {
    const wave = distance / length * Math.PI * 2
    return look.widthMm * (.68 + .13 * Math.sin(wave * 3 + phase) + .08 * Math.cos(wave * 7 + phase * 1.7))
  }
  const pointAt = (distance: number, fraction: number): PointMm => {
    const sample = visualSampleAtDistance(boundary, distance), offset = widthAt(distance) * clamp(fraction, .015, .985) * side
    return { x: sample.positionMm.x + sample.normal.x * offset, y: sample.positionMm.y + sample.normal.y * offset }
  }
  let pointCount = faceRings.reduce((sum, points) => sum + points.length, 0) + output.outer.length
  const charge = (count: number) => { pointCount += count; if (pointCount > CLIFF_RELIEF_V2_LIMITS.outputPoints) throw new Error('第二版崖面派生绘制点超过预算，请增大重复间距。') }
  const polygonParts = (points: PointMm[]): PointMm[][] => polygonClipping.intersection([ring(points)], regions).flatMap(polygon => {
    // Candidate rock facets are small, but a physical opening may still split
    // them. Every returned ring is a separately clipped, hole-free paint part.
    if (polygon.length !== 1) return []
    return [unring(polygon[0])]
  }).filter(points => points.length >= 3 && Math.abs(area(points)) > EPS)
  const addStroke = (collection: CliffPaintStrokeV2[], points: PointMm[], color: string, widthMm: number, opacity: number) => {
    for (const visible of clipStroke(points, faceRings)) {
      charge(visible.length)
      collection.push({ points: visible, color, widthMm, opacity })
    }
  }
  const count = Math.min(CLIFF_RELIEF_V2_LIMITS.cells, Math.max(1, Math.ceil(length / Math.max(900, look.repeatMm * 3.6, look.widthMm * .85))))
  const spacing = length / count
  for (let index = 0; index < count; index++) {
    const random = (channel: number) => visualRandom(look.seed, index, 200 + channel)
    const start = spacing * (index + .1 + random(0) * .2)
    const end = Math.min(length, start + spacing * (.43 + random(1) * .4))
    const center = (start + end) / 2, sample = visualSampleAtDistance(boundary, center)
    // Staggered broad faces have different extents and shared rock colors;
    // they do not establish four uninterrupted parallel contour bands.
    for (let layer = 0; layer < 2; layer++) {
      const top = layer === 0 ? .04 + random(2) * .13 : .38 + random(3) * .18
      const bottom = layer === 0 ? .47 + random(4) * .16 : .9 + random(5) * .07
      const shift = layer ? spacing * (.07 + random(6) * .1) : 0, a = Math.min(length, start + shift), b = Math.min(length, end + shift)
      const polygon = [pointAt(a, top), pointAt((a + b) / 2, top + .025), pointAt(b, top + .055),
        pointAt(b, bottom - .025), pointAt((a + b) / 2, bottom), pointAt(a, bottom - .04)]
      for (const part of polygonParts(polygon)) {
        charge(part.length)
        output.facets.push({ polygon: part, normal: { x: sample.normal.x * side, y: sample.normal.y * side },
          shade: .83 + random(8 + layer) * .32, opacity: .22 + random(10 + layer) * .2 })
      }
    }
    const fraction = .28 + random(12) * .44, ledgeEnd = Math.min(length, start + spacing * (.24 + random(13) * .34))
    addStroke(output.ledges, [pointAt(start, fraction), pointAt((start + ledgeEnd) / 2, fraction + .025), pointAt(ledgeEnd, fraction - .025)],
      random(14) > .5 ? look.accentColor : '#455246', Math.max(8, look.widthMm * (.012 + random(15) * .009)), .12 + random(16) * .15)
    if (random(17) > .22) addStroke(output.crestRuns,
      [pointAt(start, .035), pointAt(center, .04), pointAt(end, .025)], look.accentColor, Math.max(9, look.widthMm * .027), .17 + random(18) * .14)
    if (random(19) > .32) addStroke(output.footRuns,
      [pointAt(start, .94), pointAt(center, .965), pointAt(end, .92)], '#31463B', Math.max(12, look.widthMm * .047), .12 + random(20) * .16)
    if (random(21) > .36) {
      const from = .13 + random(22) * .2, to = clamp(from + (.22 + random(23) * .3) * heightFactor, .25, .88)
      const drift = spacing * (.06 + random(24) * .12) * (random(25) > .5 ? 1 : -1)
      addStroke(output.fractures, [pointAt(center, from), pointAt(center + drift * .5, (from + to) / 2), pointAt(center + drift, to)],
        '#33473E', Math.max(8, look.widthMm * .014), .16 + random(26) * .13)
    }
    if (random(27) > .38) {
      const radius = Math.min(spacing * .13, look.widthMm * (.06 + random(28) * .05)), position = start + (end - start) * random(29)
      const polygon = [pointAt(position - radius, .78), pointAt(position - radius * .35, .9), pointAt(position + radius * .7, .965),
        pointAt(position + radius, .84), pointAt(position, .75)]
      for (const part of polygonParts(polygon)) { charge(part.length); output.erosion.push({ polygon: part, shade: .09 + random(30) * .12 }) }
    }
  }
  return output
}
