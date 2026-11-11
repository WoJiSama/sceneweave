import polygonClipping, { type Polygon } from 'polygon-clipping'
import type { PointMm } from '../../../shared/model/scene.js'
import { visualRandom } from './visual-geometry.js'

/** Explicitly selected by a saved connection rendering profile, never by an ID
 * or secret scene geometry. The original rock-tread algorithm remains intact. */
export const NATURAL_ROCK_STEPS_PROFILE = 'naturalRockSteps2' as const
export interface NaturalRockStepFrame {
  length: number
  at: (distance: number, lateral?: number) => PointMm
}
export interface NaturalRockStepPalette { base: string; dark: string; light: string }
export interface NaturalRockStepInput {
  frame: NaturalRockStepFrame
  widthMm: number
  count: number
  seed: string
  /** The exact audience-owned physical connection polygon, not an endpoint box. */
  bandMm: readonly PointMm[]
}
export interface NaturalRockStepShape {
  ringsMm: PointMm[][]
  kind: 'stone' | 'riser' | 'light' | 'chip'
  shade: number
  opacity: number
  stationMm: number
}
export interface NaturalRockStepPlan {
  profile: typeof NATURAL_ROCK_STEPS_PROFILE
  bandMm: PointMm[]
  stationsMm: number[]
  shapes: NaturalRockStepShape[]
}
const MAX_TREADS = 512, MAX_BAND_POINTS = 2048, MAX_SHAPES = 12288
const finitePoint = (point: PointMm) => point && Number.isFinite(point.x) && Number.isFinite(point.y)
const signedArea = (points: PointMm[]) => points.reduce((area, point, index) => {
  const next = points[(index + 1) % points.length]
  return area + point.x * next.y - next.x * point.y
}, 0) / 2
const rgb = (color: string, scale: number) => `rgb(${[1, 3, 5].map(index => Math.max(0, Math.min(255,
  Math.round(Number.parseInt(color.slice(index, index + 2), 16) * scale)))).join(',')})`

/** A world-space draw plan can be checked without allocating a Canvas. Each
 * step is divided into staggered stones so no full-width bright/dark stripe is
 * needed. All geometry is intersected with the complete routed physical band. */
export function planNaturalRockSteps(input: NaturalRockStepInput): NaturalRockStepPlan {
  const { frame, widthMm, count, seed } = input
  if (!frame || !Number.isFinite(frame.length) || frame.length <= 0 || typeof frame.at !== 'function'
    || !Number.isFinite(widthMm) || widthMm <= 0 || !Number.isInteger(count) || count < 1 || count > MAX_TREADS
    || typeof seed !== 'string' || !seed.length) throw new Error('自然岩阶需要有效弧长、净宽、种子及1–512级踏面。')
  if (!Array.isArray(input.bandMm) || input.bandMm.length < 3 || input.bandMm.length > MAX_BAND_POINTS
    || !input.bandMm.every(finitePoint)) throw new Error('自然岩阶需要完整的有限连接带区。')
  const bandMm = input.bandMm.map(point => ({ x: point.x, y: point.y }))
  if (Math.abs(signedArea(bandMm)) < 1e-7) throw new Error('自然岩阶连接带区不能退化。')
  const band: Polygon = [bandMm.map(point => [point.x, point.y])]
  const shapes: NaturalRockStepShape[] = [], stationsMm: number[] = []
  const length = frame.length, depth = length / count, half = widthMm / 2
  const at = (distance: number, lateral: number) => {
    const point = frame.at(Math.max(0, Math.min(length, distance)), Math.max(-half, Math.min(half, lateral)))
    if (!finitePoint(point)) throw new Error('自然岩阶弧长查询返回无效坐标。')
    return { x: point.x, y: point.y }
  }
  const emit = (kind: NaturalRockStepShape['kind'], points: PointMm[], shade: number, opacity: number, stationMm: number) => {
    if (Math.abs(signedArea(points)) < 1e-7) return
    const shape: Polygon = [points.map(point => [point.x, point.y])]
    const clipped = polygonClipping.intersection(shape, band)
    for (const polygon of clipped) {
      const ringsMm = polygon.map(ring => ring.slice(0, -1).map(([x, y]) => ({ x, y })))
      if (!ringsMm[0]?.length || Math.abs(signedArea(ringsMm[0])) < 1e-7) continue
      shapes.push({ ringsMm, kind, shade, opacity, stationMm })
      if (shapes.length > MAX_SHAPES) throw new Error('自然岩阶实际细节超过12288片保护值。')
    }
  }
  for (let index = 0; index < count; index++) {
    const random = (channel: number) => visualRandom(seed, index, 120 + channel)
    const station = (index + .5 + (random(0) - .5) * .16) * depth
    stationsMm.push(station)
    // The endpoint blend belongs to the caller and its real support paint.
    // First/last stones still use the same cumulative world stationing.
    const pieces = random(1) > .62 ? 3 : 2
    const left = -half * (.86 + random(2) * .08), right = half * (.86 + random(3) * .08)
    const fractions = pieces === 2 ? [0, .36 + random(4) * .27, 1] : [0, .24 + random(4) * .13, .62 + random(5) * .13, 1]
    for (let piece = 0; piece < pieces; piece++) {
      const key = index * 4 + piece, r = (channel: number) => visualRandom(seed, key, 150 + channel)
      const gap = Math.min(24, widthMm * .012)
      const a = left + (right - left) * fractions[piece] + (piece ? gap : 0)
      const b = left + (right - left) * fractions[piece + 1] - (piece < pieces - 1 ? gap : 0)
      const center = station + (r(0) - .5) * depth * .24
      const extent = depth * (.66 + r(1) * .24), low = center - extent / 2, high = center + extent / 2
      const skew = depth * (r(2) - .5) * .13, chip = Math.min((b - a) * .2, depth * (.12 + r(3) * .12))
      const corners = [at(low + chip * .25, a + chip), at(low + skew, b - chip), at(low + chip, b),
        at(high - chip * .7, b), at(high - skew, b - chip * .8), at(high, a + chip),
        at(high - chip, a), at(low + chip, a)]
      const shade = .9 + r(4) * .17
      emit('stone', corners, shade, .9, station)
      // Short inset faces and broken highlights belong to individual stones;
      // no mark spans the corridor or introduces a straight side/end frame.
      const lip = Math.min(26, depth * .07), inset = (b - a) * (.1 + r(5) * .12)
      emit('riser', [at(low + lip * .2, a + inset), at(low + skew + lip * .2, b - inset),
        at(low + skew + lip, b - inset * 1.4), at(low + lip, a + inset * 1.1)], .9, .3, station)
      const lightA = a + (b - a) * (.12 + r(6) * .15), lightB = a + (b - a) * (.66 + r(7) * .19)
      emit('light', [at(high - lip, lightA), at(high - skew - lip * .8, lightB),
        at(high - skew - lip * .35, lightB - chip * .15), at(high - lip * .35, lightA + chip * .2)], .95 + r(8) * .1, .46, station)
      if ((index + piece) % 2 === 0) {
        const s = center + extent * .1, lateral = a + (b - a) * (.25 + r(9) * .5)
        emit('chip', [at(s, lateral), at(s + Math.min(35, extent * .1), lateral + Math.min(55, (b - a) * .16)),
          at(s + Math.min(50, extent * .16), lateral - Math.min(35, (b - a) * .1))], .92, .24, station)
      }
    }
  }
  return { profile: NATURAL_ROCK_STEPS_PROFILE, bandMm, stationsMm, shapes }
}

/** Plans and checks the complete call before touching the target. The final
 * exact band clip also contains antialiasing and any floating clipping error.
 * Caller retains material fill, support landing blend and atmospheric alpha. */
export function drawNaturalRockSteps(ctx: CanvasRenderingContext2D, input: NaturalRockStepInput & { palette: NaturalRockStepPalette }): NaturalRockStepPlan {
  if (![input.palette?.base, input.palette?.dark, input.palette?.light].every(color => typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color))) {
    throw new Error('自然岩阶调色须为完整RGB颜色。')
  }
  const plan = planNaturalRockSteps(input)
  const path = (rings: PointMm[][]) => {
    const value = new Path2D()
    for (const ring of rings) { ring.forEach((point, index) => index ? value.lineTo(point.x, point.y) : value.moveTo(point.x, point.y)); value.closePath() }
    return value
  }
  const band = path([plan.bandMm])
  // Path construction must also succeed before the first target mutation.
  const shapes = plan.shapes.map(shape => ({ ...shape, path: path(shape.ringsMm) }))
  ctx.save()
  try {
    ctx.clip(band)
    for (const shape of shapes) {
      const color = shape.kind === 'stone' ? input.palette.base : shape.kind === 'light' ? input.palette.light : input.palette.dark
      ctx.fillStyle = rgb(color, shape.shade); ctx.globalAlpha = shape.opacity
      ctx.fill(shape.path, 'evenodd')
    }
  } finally { ctx.restore() }
  return plan
}
