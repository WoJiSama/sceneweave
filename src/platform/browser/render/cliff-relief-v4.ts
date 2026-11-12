import type { PointMm } from '../../../shared/model/scene.js'
import type { ProjectedVisualBoundary } from '../../../shared/projection/types.js'
import type { VisualEdgeLook } from '../../../shared/visual/types.js'
import { visualSampleAtDistance } from '../../../shared/visual/geometry.js'
import { cliffReliefV3, type CliffReliefV3, type CliffReliefV3Options } from './cliff-relief-v3.js'
import { variableOffsetPolyline, visualRandom } from './visual-geometry.js'

export const CLIFF_RELIEF_V4_PROFILE = 'rockRelief4' as const
export const CLIFF_RELIEF_V4_LIMITS = Object.freeze({ cells: 256, outputPoints: 49152 })
export interface CliffShadeStop { offset: number; shade: number; accent: number; opacity: number }
export interface CliffShadeCell {
  rings: PointMm[][]
  fromMm: PointMm
  toMm: PointMm
  facing: number
  featherFromMm: PointMm
  featherToMm: PointMm
  stops: CliffShadeStop[]
}
export interface CliffReliefV4 extends Omit<CliffReliefV3, 'version'> {
  version: 4
  shadeCells: CliffShadeCell[]
}
export interface CliffReliefV4Options extends CliffReliefV3Options { lightDirectionDeg: number }
// This plan is paint only. A 0.01 mm lattice stabilizes local offsets; its
// footprints intentionally overlap the exact face. Only the caller's original
// even-odd face, high-ground and real opening clips define visible coverage.
const captured = (point: PointMm): PointMm => ({ x: Math.round(point.x * 100) / 100, y: Math.round(point.y * 100) / 100 })
const clamp = (value: number, from: number, to: number) => Math.max(from, Math.min(to, value))

/** An independent paint plan. Native v3 defines the exact joined face and
 * connection holes; only its surface lighting is replaced. Arc cells use
 * world millimetres with a fixed finite count, independent of canvas zoom.
 * The caller retains the audience-owned high-ground and opening Canvas clips. */
export function cliffReliefV4(boundary: ProjectedVisualBoundary, look: VisualEdgeLook, side: number, options: CliffReliefV4Options): CliffReliefV4 {
  if (!options || !Number.isFinite(options.lightDirectionDeg)) throw new Error('第四版崖面需要有限环境光方向。')
  const base = cliffReliefV3(boundary, look, side, options)
  const output: CliffReliefV4 = { ...base, version: 4, baseOpacity: .5, shadeCells: [] }
  if (!base.faceRings.length) return output
  const angle = options.lightDirectionDeg * Math.PI / 180, light = { x: Math.cos(angle), y: Math.sin(angle) }
  const phase = visualRandom(look.seed, 0, 18) * Math.PI * 2, length = boundary.lengthMm
  const widthAt = (distance: number) => look.widthMm * (.68 + .13 * Math.sin(distance / length * Math.PI * 6 + phase)
    + .08 * Math.cos(distance / length * Math.PI * 14 + phase * 1.7))
  // Width-sized cells carry smooth lighting over the whole rock face. Retain
  // actual curve vertices within each cell so 191 saved points do not become
  // a new coarse paint polygon. The 256-cell cap also covers long maps.
  const count = Math.min(CLIFF_RELIEF_V4_LIMITS.cells, Math.max(1, Math.ceil(length / Math.max(650, look.widthMm * .55))))
  const spacing = length / count
  let pointsUsed = base.faceRings.reduce((sum, points) => sum + points.length, 0) + base.outer.length
  for (let index = 0; index < count; index++) {
    const from = boundary.closed ? (index - .35) * spacing : Math.max(0, (index - .35) * spacing)
    const to = boundary.closed ? (index + 1.35) * spacing : Math.min(length, (index + 1.35) * spacing), middle = (index + .5) * spacing
    const fromSample = visualSampleAtDistance(boundary, from), toSample = visualSampleAtDistance(boundary, to)
    const retained = [-length, 0, length].flatMap(shift => boundary.samples
      .map(sample => ({ ...sample, distanceMm: sample.distanceMm + shift }))
      .filter(sample => sample.distanceMm > from && sample.distanceMm < to))
      .sort((a, b) => a.distanceMm - b.distanceMm)
    const samples = [{ ...fromSample, distanceMm: from }, ...retained, { ...toSample, distanceMm: to }]
    const source = samples.map(sample => captured(sample.positionMm))
    const widths = samples.map(sample => widthAt(sample.distanceMm) * side)
    // Extend both edges beyond the finite face so miter/bevel corners cannot
    // leave a white wedge. The actual visible outline stays the exact clip.
    const inner = variableOffsetPolyline(source, widths.map(width => width * -.16), false)
    const outer = variableOffsetPolyline(source, widths.map(width => width * 1.24), false)
    const cellRings = [[...inner, ...outer.reverse()].map(captured)]
    const sample = visualSampleAtDistance(boundary, middle), width = widthAt(middle), normal = { x: sample.normal.x * side, y: sample.normal.y * side }
    const facing = clamp(normal.x * light.x + normal.y * light.y, -1, 1)
    const daylight = .96 + facing * .13
    const fromMm = { ...sample.positionMm }, toMm = { x: fromMm.x + normal.x * width, y: fromMm.y + normal.y * width }
    // A light contact at the crest, directional mid-face and a short dark foot
    // express a descending face rather than a uniform opaque perimeter band.
    const stops: CliffShadeStop[] = [
      { offset: 0, shade: daylight * 1.1, accent: .12, opacity: .3 },
      { offset: .18, shade: daylight * 1.02, accent: .035, opacity: .38 },
      { offset: .6, shade: daylight * .88, accent: 0, opacity: .48 },
      { offset: .9, shade: daylight * .8, accent: 0, opacity: .35 },
      { offset: 1, shade: daylight * .84, accent: 0, opacity: .03 },
    ]
    pointsUsed += cellRings.reduce((sum, points) => sum + points.length, 0)
    if (pointsUsed > CLIFF_RELIEF_V4_LIMITS.outputPoints) throw new Error('第四版崖面受光计划超过有限绘制点预算。')
    output.shadeCells.push({ rings: cellRings, fromMm, toMm, facing, stops,
      featherFromMm: captured(fromSample.positionMm), featherToMm: captured(toSample.positionMm) })
  }
  return output
}
