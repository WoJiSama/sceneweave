import polygonClipping, { type Polygon } from 'polygon-clipping'
import type { PointMm } from '../../../shared/model/scene.js'
import type { NaturalRockStepInput, NaturalRockStepPalette, NaturalRockStepShape } from './natural-rock-steps.js'
import { visualRandom } from './visual-geometry.js'

export const NATURAL_ROCK_STEPS_V4_PROFILE = 'naturalRockSteps4' as const
export interface NaturalRockStepPlanV4 {
  profile: typeof NATURAL_ROCK_STEPS_V4_PROFILE
  bandMm: PointMm[]
  stationsMm: number[]
  piecesPerStep: number[]
  shapes: NaturalRockStepShape[]
}
const MAX_TREADS = 512, MAX_BAND_POINTS = 2048, MAX_SHAPES = 12288
const finitePoint = (point: PointMm) => point && Number.isFinite(point.x) && Number.isFinite(point.y)
const area = (points: PointMm[]) => points.reduce((sum, point, i) => {
  const next = points[(i + 1) % points.length]
  return sum + point.x * next.y - next.x * point.y
}, 0) / 2
const rgb = (color: string, scale: number) => `rgb(${[1, 3, 5].map(index => Math.max(0, Math.min(255,
  Math.round(Number.parseInt(color.slice(index, index + 2), 16) * scale)))).join(',')})`

/** Independent paint recipe. Its stations/count and exact supplied physical
 * band remain authoritative; only the local distribution of rock faces varies.
 * The caller retains the existing endpoint support/landing masks. */
export function planNaturalRockStepsV4(input: NaturalRockStepInput): NaturalRockStepPlanV4 {
  const { frame, widthMm, count, seed } = input
  if (!frame || !Number.isFinite(frame.length) || frame.length <= 0 || typeof frame.at !== 'function'
    || !Number.isFinite(widthMm) || widthMm <= 0 || !Number.isInteger(count) || count < 1 || count > MAX_TREADS
    || typeof seed !== 'string' || !seed.length) throw new Error('自然岩阶4需要有效弧长、净宽、种子及1–512级踏面。')
  if (!Array.isArray(input.bandMm) || input.bandMm.length < 3 || input.bandMm.length > MAX_BAND_POINTS
    || !input.bandMm.every(finitePoint) || Math.abs(area([...input.bandMm])) < 1e-7) throw new Error('自然岩阶4需要完整的非退化有限带区。')
  const bandMm = input.bandMm.map(point => ({ x: point.x, y: point.y }))
  const band: Polygon = [bandMm.map(point => [point.x, point.y])]
  const shapes: NaturalRockStepShape[] = [], stationsMm: number[] = [], piecesPerStep: number[] = []
  const length = frame.length, depth = length / count, half = widthMm / 2
  const at = (distance: number, lateral: number) => {
    const point = frame.at(Math.max(0, Math.min(length, distance)), Math.max(-half, Math.min(half, lateral)))
    if (!finitePoint(point)) throw new Error('自然岩阶4弧长查询返回无效坐标。')
    return { x: point.x, y: point.y }
  }
  const emit = (kind: NaturalRockStepShape['kind'], points: PointMm[], shade: number, opacity: number, stationMm: number) => {
    if (Math.abs(area(points)) < 1e-7) return
    const shape: Polygon = [points.map(point => [point.x, point.y])]
    const clipped = polygonClipping.intersection(shape, band)
    for (const polygon of clipped) {
      const ringsMm = polygon.map(ring => ring.slice(0, -1).map(([x, y]) => ({ x, y })))
      if (!ringsMm[0]?.length || Math.abs(area(ringsMm[0])) < 1e-7) continue
      shapes.push({ ringsMm, kind, shade, opacity, stationMm })
      if (shapes.length > MAX_SHAPES) throw new Error('自然岩阶4实际细节超过12288片保护值。')
    }
  }
  for (let index = 0; index < count; index++) {
    const random = (channel: number) => visualRandom(seed, index, 410 + channel)
    // Keep the original recipe's nominal tread stations exactly. Rock corners
    // can stagger around a station without moving a physical step or endpoint.
    const station = (index + .5 + (visualRandom(seed, index, 120) - .5) * .16) * depth
    stationsMm.push(station)
    const split = random(0), pieces = split < .28 ? 1 : split < .76 ? 2 : 3
    piecesPerStep.push(pieces)
    const left = -half * (.68 + random(1) * .22), right = half * (.68 + random(2) * .22)
    const fractions = pieces === 1 ? [0, 1] : pieces === 2 ? [0, .24 + random(3) * .46, 1]
      : [0, .16 + random(3) * .2, .57 + random(4) * .24, 1]
    const weights = Array.from({ length: pieces + 1 }, (_, i) => (visualRandom(seed, index * 4 + i, 430) - .5) * depth * .26)
    for (let piece = 0; piece < pieces; piece++) {
      const r = (channel: number) => visualRandom(seed, index * 4 + piece, 450 + channel)
      const gap = Math.min(46, widthMm * .026)
      const a = left + (right - left) * fractions[piece] + (piece ? gap : 0)
      const b = left + (right - left) * fractions[piece + 1] - (piece < pieces - 1 ? gap : 0)
      if (b <= a) continue
      const span = b - a, extent = depth * (.58 + r(0) * .29)
      const center = station + (r(1) - .5) * depth * .32
      const low = center - extent / 2, high = center + extent / 2
      const lowA = low + weights[piece], lowB = low + weights[piece + 1]
      const highA = high + weights[piece] * .65, highB = high + weights[piece + 1] * .65
      const chipA = Math.min(span * (.09 + r(2) * .13), depth * .27)
      const chipB = Math.min(span * (.07 + r(3) * .15), depth * .25)
      const sideA = a + span * (.018 + r(4) * .045), sideB = b - span * (.018 + r(5) * .045)
      emit('stone', [at(lowA + chipA * .45, a + chipA), at(lowB, b - chipB), at(lowB + chipB, b),
        at(highB - chipB * .8, sideB), at(highB, b - chipB * .8), at(highA - chipA * .12, a + chipA),
        at(highA - chipA, sideA), at(lowA + chipA, a)], .77 + r(6) * .2, .84 + r(7) * .12, station)

      // The shaded riser and lip follow short, skewed parts of each stone.
      // Their gaps and lateral spans do not align into a full-width brick grid.
      const face = Math.min(48, depth * (.1 + r(8) * .07))
      const faceA = a + span * (.1 + r(9) * .12), faceB = a + span * (.68 + r(10) * .21)
      const front = (lateral: number) => lowA + (lowB - lowA) * (lateral - a) / span
      emit('riser', [at(front(faceA), faceA), at(front(faceB), faceB),
        at(front(faceB) + face * .72, faceB - chipB * .2), at(front(faceA) + face, faceA + chipA * .3)],
      .74 + r(11) * .15, .38 + r(12) * .13, station)
      const lip = Math.min(15, depth * .042)
      const lightA = a + span * (.12 + r(13) * .18), lightB = a + span * (.5 + r(14) * .27)
      emit('light', [at(front(lightA) + face, lightA), at(front(lightB) + face * .72, lightB),
        at(front(lightB) + face * .72 + lip, lightB - chipB * .18), at(front(lightA) + face + lip * .65, lightA + chipA * .25)],
      .82 + r(15) * .14, .25 + r(16) * .16, station)
      if (r(17) > .55) {
        const lateral = a + span * (.25 + r(18) * .5), mark = center + extent * (.08 + r(19) * .2)
        emit('chip', [at(mark, lateral), at(mark + Math.min(36, extent * .12), lateral + Math.min(48, span * .13)),
          at(mark + Math.min(55, extent * .2), lateral - Math.min(31, span * .07))], .75 + r(20) * .12, .21, station)
      }
    }
  }
  return { profile: NATURAL_ROCK_STEPS_V4_PROFILE, bandMm, stationsMm, piecesPerStep, shapes }
}

/** Validate/clip the complete plan before touching the destination. The final
 * exact physical band clip also contains raster antialiasing at the perimeter. */
export function drawNaturalRockStepsV4(ctx: CanvasRenderingContext2D, input: NaturalRockStepInput & { palette: NaturalRockStepPalette }): NaturalRockStepPlanV4 {
  if (![input.palette?.base, input.palette?.dark, input.palette?.light].every(color => typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color))) {
    throw new Error('自然岩阶4调色须为完整RGB颜色。')
  }
  const plan = planNaturalRockStepsV4(input)
  const path = (rings: PointMm[][]) => {
    const value = new Path2D()
    for (const ring of rings) { ring.forEach((point, i) => i ? value.lineTo(point.x, point.y) : value.moveTo(point.x, point.y)); value.closePath() }
    return value
  }
  const band = path([plan.bandMm]), shapes = plan.shapes.map(shape => ({ ...shape, path: path(shape.ringsMm) }))
  ctx.save()
  try {
    ctx.clip(band)
    for (const shape of shapes) {
      ctx.fillStyle = rgb(shape.kind === 'stone' ? input.palette.base : shape.kind === 'light' ? input.palette.light : input.palette.dark, shape.shade)
      ctx.globalAlpha = shape.opacity; ctx.fill(shape.path, 'evenodd')
    }
  } finally { ctx.restore() }
  return plan
}
