import type { PointMm } from '../../../shared/model/scene.js'
import type { ProjectedVisualBoundary } from '../../../shared/projection/types.js'
import type { VisualEdgeLook } from '../../../shared/visual/types.js'
import { visualSampleAtDistance } from '../../../shared/visual/geometry.js'
import { variableOffsetPolyline, visualRandom } from './visual-geometry'

export interface CliffStratum {
  upper: PointMm[]
  lower: PointMm[]
  shade: number
}

export interface CliffFacet {
  polygon: PointMm[]
  shade: number
  normal: PointMm
}

export interface CliffErosionMark {
  polygon: PointMm[]
  shade: number
}

export interface CliffRelief {
  face: PointMm[]
  faceRings: PointMm[][]
  outer: PointMm[]
  strata: CliffStratum[]
  facets: CliffFacet[]
  fractures: PointMm[][]
  erosion: CliffErosionMark[]
}

export interface CliffTread {
  polygon: PointMm[]
  lowerEdge: PointMm[]
  upperEdge: PointMm[]
  fraction: number
  shade: number
  lengthMm: number
  angleRad: number
}

/** Deterministic rock layers stay within the saved cliff width and its existing face polygon. */
export function cliffRelief(boundary: ProjectedVisualBoundary, look: VisualEdgeLook, side: number): CliffRelief {
  const length = boundary.lengthMm
  const count = Math.min(1024, Math.max(16, Math.ceil(length / Math.max(320, look.repeatMm * .8))))
  const phase = visualRandom(look.seed, 0, 18) * Math.PI * 2
  const widthAt = (distance: number) => {
    const wave = distance / length * Math.PI * 2
    return look.widthMm * (.68 + .13 * Math.sin(wave * 3 + phase) + .08 * Math.cos(wave * 7 + phase * 1.7))
  }
  const pointAt = (distance: number, fraction: number): PointMm => {
    const sample = visualSampleAtDistance(boundary, distance)
    const width = widthAt(distance) * fraction * side
    return { x: sample.positionMm.x + sample.normal.x * width, y: sample.positionMm.y + sample.normal.y * width }
  }
  const distances = Array.from({ length: count + 1 }, (_, i) => length * i / count)
  // Paint stays inside the saved width. Physical terrain and the editable
  // source boundary never change when the disposable relief is refined.
  const outer = variableOffsetPolyline(boundary.points, boundary.samples.slice(0, boundary.points.length).map(sample => widthAt(sample.distanceMm) * side), boundary.closed)
  const face = [...boundary.points, ...[...outer].reverse()]
  const faceRings = boundary.closed ? [boundary.points, outer] : [face]
  const fraction = (row: number, distance: number) => {
    if (row === 0) return 0
    if (row === 4) return 1
    const base = [.19, .43, .69][row - 1]
    const frequency = Math.max(1700, look.repeatMm * (2.4 + row * .65))
    const wave = Math.sin(distance / frequency * Math.PI * 2 + phase + row * 1.31) * .034
    const cell = Math.floor(distance / Math.max(900, look.repeatMm * 1.6))
    const jitter = (visualRandom(look.seed, cell, 30 + row) - .5) * .038
    return base + wave + jitter
  }
  const rows = Array.from({ length: 5 }, (_, row) => distances.map(distance => pointAt(distance, fraction(row, distance))))
  const strata: CliffStratum[] = Array.from({ length: 4 }, (_, index) => ({
    upper: rows[index], lower: rows[index + 1],
    shade: .9 + visualRandom(look.seed, index, 42) * .18,
  }))
  const facets: CliffFacet[] = []
  for (let row = 0; row < strata.length; row++) {
    let i = 0
    while (i < count) {
      const span = 2 + Math.floor(visualRandom(look.seed, row * 4096 + i, 50) * 5)
      const end = Math.min(count, i + span)
      const stratum = strata[row]
      facets.push({
        polygon: [stratum.upper[i], stratum.upper[end], stratum.lower[end], stratum.lower[i]],
        shade: .94 + visualRandom(look.seed, row * 4096 + i, 51) * .13,
        normal: visualSampleAtDistance(boundary, length * (i + end) / (count * 2)).normal,
      })
      i = end
    }
  }

  const fractureSpacing = Math.max(850, look.repeatMm * 1.25)
  const fractureCount = Math.min(256, Math.floor(length / fractureSpacing))
  const fractures = Array.from({ length: fractureCount }, (_, index) => {
    const start = index * fractureSpacing + visualRandom(look.seed, index, 60) * fractureSpacing * .65
    const from = .14 + visualRandom(look.seed, index, 61) * .25
    const reach = .2 + visualRandom(look.seed, index, 62) * .48
    const drift = (visualRandom(look.seed, index, 63) - .5) * look.widthMm * .16
    return [
      pointAt(start, from),
      pointAt(start + drift * .5, from + reach * .42),
      pointAt(start + drift, Math.min(.94, from + reach)),
    ]
  })

  const erosionSpacing = Math.max(620, look.repeatMm * .95)
  const erosionCount = Math.min(512, Math.floor(length / erosionSpacing))
  const erosion = Array.from({ length: erosionCount }, (_, index) => {
    const distance = index * erosionSpacing + visualRandom(look.seed, index, 70) * erosionSpacing * .7
    const center = pointAt(distance, .77 + visualRandom(look.seed, index, 71) * .19)
    const sample = visualSampleAtDistance(boundary, distance)
    const radiusAlong = look.widthMm * (.035 + visualRandom(look.seed, index, 72) * .055)
    const radiusAcross = look.widthMm * (.018 + visualRandom(look.seed, index, 73) * .025)
    const polygon = Array.from({ length: 7 }, (_, vertex) => {
      const angle = vertex * Math.PI * 2 / 7
      const wobble = .72 + visualRandom(look.seed, index * 8 + vertex, 74) * .5
      return {
        x: center.x + sample.tangent.x * Math.cos(angle) * radiusAlong * wobble + sample.normal.x * Math.sin(angle) * radiusAcross * wobble * side,
        y: center.y + sample.tangent.y * Math.cos(angle) * radiusAlong * wobble + sample.normal.y * Math.sin(angle) * radiusAcross * wobble * side,
      }
    })
    return { polygon, shade: .12 + visualRandom(look.seed, index, 75) * .1 }
  })

  return { face, faceRings, outer, strata, facets, fractures, erosion }
}

/** Irregular rock treads follow the real arc frame and remain within its physical band. */
export function naturalRockTreads(frame: { length: number; at: (distance: number, lateral?: number) => PointMm }, widthMm: number, seed: string, count: number): CliffTread[] {
  const { length } = frame
  if (!(length > 0) || !(widthMm > 0) || count < 1) return []
  const spacing = length / count, half = widthMm / 2
  return Array.from({ length: count }, (_, index) => {
    const center = (index + .5 + (visualRandom(seed, index, 80) - .5) * .3) * spacing
    const treadLength = Math.min(spacing * .96, spacing * (.68 + visualRandom(seed, index, 81) * .28))
    const centerShift = (visualRandom(seed, index, 82) - .5) * widthMm * .08
    const skew = (visualRandom(seed, index, 83) - .5) * Math.min(spacing * .16, widthMm * .045)
    const angle = (visualRandom(seed, index, 84) - .5) * .08
    const along = Math.cos(angle), across = Math.sin(angle), inset = half * (.91 + visualRandom(seed, index, 86) * .045)
    const point = (distance: number, side: number): PointMm => frame.at(Math.max(0, Math.min(length, distance + centerShift + side * skew + side * inset * across)),
      side * inset * along)
    const low = center - treadLength * .5, high = center + treadLength * .5
    const chip = treadLength * (.09 + visualRandom(seed, index, 87) * .13)
    const lowLeft = point(low, -.78), lowRight = point(low + chip * .2, .83)
    const highRight = point(high, .73), highLeft = point(high - chip * .3, -.85)
    const polygon = [lowLeft, lowRight, point(low + chip, 1), point(high - chip * .7, 1), highRight, highLeft, point(high - chip, -1), point(low + chip * .8, -1)]
    const bevel = Math.min(34, spacing * .09)
    const lowerEdge = [lowLeft, lowRight, point(low + bevel, .8), point(low + bevel, -.76)]
    return { polygon, lowerEdge, upperEdge: [highRight, highLeft], fraction: (index + .5) / count, shade: .94 + visualRandom(seed, index, 85) * .2, lengthMm: treadLength, angleRad: Math.atan2(lowRight.y - lowLeft.y, lowRight.x - lowLeft.x) }
  })
}
