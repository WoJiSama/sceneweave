import polygonClipping, { type Polygon } from 'polygon-clipping'
import type { PointMm } from '../../../shared/model/scene.js'
import type { NaturalRockStepFrame, NaturalRockStepPalette } from './natural-rock-steps.js'
import { visualRandom } from './visual-geometry.js'

/** A separate saved recipe: earlier naturalRockSteps2/3/4 retain their pixels. */
export const TERRACED_ROCK_STEPS_PROFILE = 'naturalRockSteps5' as const
export const CARVED_ROCK_STEPS_PROFILE = 'naturalRockSteps6' as const
export const WORN_ROCK_STEPS_PROFILE = 'naturalRockSteps7' as const
export const SCULPTED_ROCK_STEPS_PROFILE = 'naturalRockSteps8' as const
export interface TerracedRockStepInput {
  /** Ascending, from the actual lower support to the actual upper support. */
  frame: NaturalRockStepFrame
  widthMm: number
  count: number
  riseMm: number
  seed: string
  bandMm: readonly PointMm[]
  lightDirectionDeg?: number
  /** Absent/5 retain the previously saved continuous-step recipe exactly. */
  profile?: typeof TERRACED_ROCK_STEPS_PROFILE | typeof CARVED_ROCK_STEPS_PROFILE | typeof WORN_ROCK_STEPS_PROFILE | typeof SCULPTED_ROCK_STEPS_PROFILE
}
export interface TerracedRockStepShape {
  ringsMm: PointMm[][]
  kind: 'landing' | 'tread' | 'riser' | 'lip' | 'seam' | 'side'
  fromMm: PointMm
  toMm: PointMm
  startShade: number
  endShade: number
  opacity: number
}
export interface TerracedRockStepPlan {
  profile: NonNullable<TerracedRockStepInput['profile']>
  bandMm: PointMm[]
  landingDepthMm: number
  stationsMm: number[]
  riserHeightMm: number
  shapes: TerracedRockStepShape[]
}
const finite = (point: PointMm) => point && Number.isFinite(point.x) && Number.isFinite(point.y)
const area = (points: readonly PointMm[]) => points.reduce((sum, p, i) => {
  const next = points[(i + 1) % points.length]
  return sum + p.x * next.y - next.x * p.y
}, 0) / 2
const tint = (color: string, factor: number) => `rgb(${[1, 3, 5].map(index => Math.round(Math.max(0, Math.min(255,
  Number.parseInt(color.slice(index, index + 2), 16) * factor)))).join(',')})`

/** Continuous transverse treads follow the real cumulative route. Their shared
 * irregular fronts form one carved stair mass, with actual-rise-sized risers;
 * the physical corridor is never shortened or narrowed to accommodate paint. */
export function planTerracedRockSteps(input: TerracedRockStepInput): TerracedRockStepPlan {
  const { frame, widthMm, count, riseMm, seed } = input
  if (!frame || !Number.isFinite(frame.length) || frame.length <= 0 || typeof frame.at !== 'function'
    || !Number.isFinite(widthMm) || widthMm <= 0 || !Number.isInteger(count) || count < 1 || count > 512
    || !Number.isFinite(riseMm) || riseMm <= 0 || typeof seed !== 'string' || !seed.length
    || input.lightDirectionDeg !== undefined && !Number.isFinite(input.lightDirectionDeg)
    || input.profile !== undefined && input.profile !== TERRACED_ROCK_STEPS_PROFILE && input.profile !== CARVED_ROCK_STEPS_PROFILE && input.profile !== WORN_ROCK_STEPS_PROFILE && input.profile !== SCULPTED_ROCK_STEPS_PROFILE) throw new Error('连续岩阶需要真实正高差、净宽、弧长、种子及1–512级踏面。')
  if (!Array.isArray(input.bandMm) || input.bandMm.length < 3 || input.bandMm.length > 2048
    || !input.bandMm.every(finite) || Math.abs(area(input.bandMm)) < 1e-7) throw new Error('连续岩阶需要完整的非退化连接带区。')
  const bandMm = input.bandMm.map(p => ({ x: p.x, y: p.y }))
  // Sub-micrometre snapping stabilizes coincident route/band edges in the
  // polygon boolean kernel. The final Canvas clip still uses the exact band.
  const coordinate = (p: PointMm): [number, number] => [Math.round(p.x * 1e6) / 1e6, Math.round(p.y * 1e6) / 1e6]
  const band: Polygon = [bandMm.map(coordinate)]
  const half = widthMm / 2, length = frame.length
  const landingDepthMm = Math.min(widthMm * .34, length * .08)
  const depth = (length - landingDepthMm * 2) / count, riserHeightMm = riseMm / count
  const riserDepth = Math.min(depth * .23, Math.max(10, riserHeightMm * .32))
  const stationsMm = Array.from({ length: count }, (_, i) => landingDepthMm + i * depth)
  const lightAngle = (input.lightDirectionDeg ?? 225) * Math.PI / 180
  const light = { x: Math.cos(lightAngle), y: Math.sin(lightAngle) }
  const at = (s: number, t = 0) => {
    const point = frame.at(Math.max(0, Math.min(length, s)), Math.max(-half, Math.min(half, t)))
    if (!finite(point)) throw new Error('连续岩阶弧长查询返回无效坐标。')
    return { x: point.x, y: point.y }
  }
  const shapes: TerracedRockStepShape[] = []
  const emit = (kind: TerracedRockStepShape['kind'], polygon: PointMm[], from: number, to: number,
    startShade: number, endShade: number, opacity = 1) => {
    if (Math.abs(area(polygon)) < 1e-7) return
    const clipped = polygonClipping.intersection([polygon.map(coordinate)], band)
    const fromMm = at(from), toMm = at(to)
    for (const region of clipped) {
      const ringsMm = region.map(ring => ring.slice(0, -1).map(([x, y]) => ({ x, y })))
      if (ringsMm[0]?.length && Math.abs(area(ringsMm[0])) > 1e-7) shapes.push({ ringsMm, kind, fromMm, toMm, startShade, endShade, opacity })
      if (shapes.length > 8192) throw new Error('连续岩阶超过8192片绘制预算。')
    }
  }
  // Sample along each side as well as across each front, so a bend retains a
  // curved outer cheek instead of acquiring the endpoint chord of a tread.
  const strip = (low: number, high: number, left = -half, right = half) => {
    const segments = Math.min(32, Math.max(1, Math.ceil((high - low) / 90)))
    const side = (lateral: number) => Array.from({ length: segments + 1 }, (_, k) => at(low + (high - low) * k / segments, lateral))
    return [...side(left), ...side(right).reverse()]
  }
  if (input.profile === SCULPTED_ROCK_STEPS_PROFILE) {
    // One fixed oblique view explains every riser and cheek, including a turn.
    // Its displacement is local to each step; it never moves the saved route,
    // either landing, support, or physical width. Clipping retains the corridor.
    const view = { x: .12, y: .62 }
    const random = (i: number, channel: number) => visualRandom(seed, i, 900 + channel)
    const front = (index: number) => Array.from({ length: 9 }, (_, k) => {
      const t = k / 8, lateral = (t - .5) * widthMm * (.89 + random(index, 8) * .09)
      const wear = Math.sin(t * Math.PI) * depth * (.025 + random(index, 1) * .035)
      const rough = (random(index * 9 + k, 2) - .5) * Math.min(65, depth * .15)
      return at(landingDepthMm + index * depth + wear + rough, lateral)
    })
    const lower = (points: PointMm[], height: number) => points.map(p => ({ x: p.x + view.x * height, y: p.y + view.y * height }))
    const average = (points: PointMm[]) => points.reduce((a, p) => ({ x: a.x + p.x / points.length, y: a.y + p.y / points.length }), { x: 0, y: 0 })
    const fronts = Array.from({ length: count + 1 }, (_, i) => front(i))
    const order = Array.from({ length: count }, (_, i) => i).sort((a, b) => average(fronts[a]).y - average(fronts[b]).y || a - b)
    for (const i of order) {
      const start = stationsMm[i], end = start + depth, nose = fronts[i], back = fronts[i + 1]
      const a = at(start), b = at(end), length = Math.hypot(b.x - a.x, b.y - a.y) || 1
      const downhill = { x: (a.x - b.x) / length, y: (a.y - b.y) / length }
      const facing = downhill.x * light.x + downhill.y * light.y
      const exposure = Math.max(0, downhill.x * view.x + downhill.y * view.y)
      const height = Math.min(riserHeightMm, depth * .7)
      const blend = Math.min(1, (i + 1) / 1.5, (count - i) / 1.5)
      // The cut faces are filled areas, not wide strokes along a route normal.
      // Back-facing risers disappear as a northward stair turns eastward.
      if (exposure > .025) {
        const spans = random(i, 9) > .62 ? [[0, 3], [4, 8]] : [[0, 8]]
        for (const [from, to] of spans) {
          const cut = nose.slice(from, to + 1)
          emit('riser', [...cut, ...lower(cut, height).reverse()], start, start + Math.max(1, height * exposure),
            .90 + facing * .06, 1.025 + facing * .04, .84 * blend)
        }
      }
      for (const side of [-1, 1]) {
        const normal = { x: downhill.y * side, y: -downhill.x * side }
        if (normal.x * view.x + normal.y * view.y < .025) continue
        const endpoint = side < 0 ? 0 : 8, edge = [nose[endpoint], back[endpoint]]
        const sideFacing = normal.x * light.x + normal.y * light.y
        emit('side', [...edge, ...lower(edge, height).reverse()], start, end,
          .90 + sideFacing * .06, 1.02 + sideFacing * .06, .52 * blend)
      }
      const shade = .985 + random(i, 3) * .04
      emit('tread', [...nose, ...[...back].reverse()], start, end, shade * 1.025, shade * .985, .76 * blend)
      const from = 1 + Math.floor(random(i, 4) * 2), to = 6 + Math.floor(random(i, 5) * 2)
      const lip = nose.slice(from, to + 1), highlight = lip.map(p => ({ x: p.x - view.x * 10, y: p.y - view.y * 10 }))
      emit('lip', [...lip, ...highlight.reverse()], start, start + 10, .98, 1.02, .56 * blend)
      if (random(i, 6) > .6) {
        const s = start + depth * .62, t = (random(i, 7) - .5) * widthMm * .65
        emit('seam', [at(s, t), at(s + depth * .12, t + widthMm * .055), at(s + depth * .12 + 7, t + widthMm * .055), at(s + 7, t)],
          s, s + depth * .12, .93, 1.04, .22 * blend)
      }
    }
    // Adjacent flat treads share their front exactly. Paint all tops before
    // the short projected cuts, otherwise the next downhill tread erases the
    // preceding riser and turns the whole staircase back into a flat ribbon.
    const paintOrder = { landing: 0, tread: 0, side: 1, riser: 2, lip: 3, seam: 4 }
    shapes.sort((a, b) => paintOrder[a.kind] - paintOrder[b.kind])
    return { profile: input.profile, bandMm, landingDepthMm, stationsMm, riserHeightMm, shapes }
  }
  if (input.profile === CARVED_ROCK_STEPS_PROFILE || input.profile === WORN_ROCK_STEPS_PROFILE) {
    const worn = input.profile === WORN_ROCK_STEPS_PROFILE
    // The real band/count/rise remain authoritative. This independent saved
    // recipe carves low-contrast, broken fronts into a continuous rock mass;
    // it does not substitute disconnected pavers or narrower physical treads.
    const random = (index: number, channel: number) => visualRandom(seed, index, 610 + channel)
    const roughness = (index: number, k: number) => {
      const coarse = random(index * 11 + Math.floor(k / 2), 1) - .5
      return coarse * depth * (worn ? .20 : .16) + (random(index * 11 + k, 2) - .5) * depth * .035
    }
    const extent = (index: number) => ({ left: -half * (.87 + random(index, 3) * .11), right: half * (.87 + random(index, 4) * .11) })
    const edgeAt = (index: number, lateralFraction: number, offset = 0) => {
      const station = landingDepthMm + index * depth, { left, right } = extent(index)
      const lateral = left + (right - left) * lateralFraction
      const k = lateralFraction * 8, low = Math.floor(k), high = Math.min(8, low + 1)
      const wobble = roughness(index, low) * (1 - (k - low)) + roughness(index, high) * (k - low)
      const rake = (random(index, 5) - .5) * depth * .28 * (lateralFraction - .5)
      const hollow = worn ? Math.sin(lateralFraction * Math.PI) * depth * (.10 + random(index, 33) * .15) : 0
      return at(station + wobble + rake + hollow + offset, lateral)
    }
    const front = (index: number, from = 0, to = 1, offset = 0) => {
      const count = Math.max(2, Math.ceil((to - from) * 8))
      return Array.from({ length: count + 1 }, (_, k) => edgeAt(index, from + (to - from) * k / count, offset))
    }
    // A short stratum carries beyond the first/last carved front and tapers
    // into the existing support blend. No transverse end cap or side rail.
    for (const [end, start] of [[0, 0], [1, length - landingDepthMm]] as const) {
      emit('landing', strip(start, start + landingDepthMm, -half * .93, half * .94), start, start + landingDepthMm,
        1.01, .99, .18)
      for (let mark = 0; mark < 5; mark++) {
        const lateral = (random(end * 7 + mark, 6) - .5) * widthMm * .85
        const s = start + landingDepthMm * (.12 + random(mark, 7) * .6), span = landingDepthMm * (.22 + random(mark, 8) * .16)
        const sideways = widthMm * (.10 + random(mark + end, 9) * .15), thickness = 7 + random(mark, 10) * 7
        emit('seam', [at(s, lateral), at(s + span, lateral + sideways), at(s + span + thickness, lateral + sideways), at(s + thickness, lateral)],
          s, s + span, .95, 1.05, .12)
      }
    }
    for (let index = 0; index < count; index++) {
      const low = stationsMm[index], high = low + depth
      const blend = worn ? Math.min(1, (index + 1) / 1.5, (count - index) / 1.5) : Math.min(1, (index + .75) / 2.5, (count - index - .25) / 2.5)
      // Adjacent treads reuse each exact irregular front. They form a joined
      // rock stair mass even where the visible lip is worn away.
      const tone = .98 + random(index, 11) * .065
      emit('tread', [...front(index), ...front(index + 1).reverse()], low, high, tone * (worn ? 1.025 : 1.065), tone * (worn ? .98 : .92), ((worn ? .48 : .72) + random(index, 12) * .15) * blend)
      const faceDepth = Math.min(depth * .20, Math.max(11, riserHeightMm * (.38 + random(index, 13) * .17)))
      // Partial broken fronts preserve the visual rise without a regular dark
      // fan of full-width stripes. Each missing section is worn rock, not a gap.
      const spans: [number, number][] = worn ? [[.02 + random(index, 15) * .04, .94 + random(index, 16) * .04]] : random(index, 14) < .43
        ? [[.04 + random(index, 15) * .12, .34 + random(index, 16) * .15], [.59 + random(index, 17) * .1, .90 + random(index, 18) * .06]]
        : [[.08 + random(index, 15) * .14, .73 + random(index, 16) * .20]]
      for (const [from, to] of spans) {
        const opacity = ((worn ? .72 : .58) + random(index, 19) * (worn ? .10 : .18)) * blend
        emit('riser', [...front(index, from, to), ...front(index, from, to, faceDepth).reverse()], low, low + faceDepth, .85, 1.045, opacity)
        if (random(index, 20) > .28) {
          const lipFrom = from + (to - from) * (.12 + random(index, 21) * .15)
          const lipTo = from + (to - from) * (.58 + random(index, 22) * .24), lip = Math.min(12, depth * .027)
          emit('lip', [...front(index, lipFrom, lipTo, faceDepth), ...front(index, lipFrom, lipTo, faceDepth + lip).reverse()],
            low + faceDepth, low + faceDepth + lip, .96, 1.025, (.51 + random(index, 23) * .22) * blend)
        }
      }
      if (random(index, 24) > .37) {
        const lateral = (random(index, 25) - .5) * widthMm * .8, s = low + depth * (.43 + random(index, 26) * .25)
        const sideways = widthMm * (.07 + random(index, 27) * .12), thickness = 7 + random(index, 28) * 7
        emit('seam', [at(s - depth * .1, lateral), at(s + depth * .22, lateral + sideways),
          at(s + depth * .22 + thickness, lateral + sideways), at(s - depth * .1 + thickness, lateral)],
          s - depth * .1, s + depth * .22, .92, 1.06, .16 * blend)
      }
      if (index % 3 === 0) {
        const side = random(index, 29) > .5 ? 1 : -1, lateral = side * half * (.86 + random(index, 30) * .07)
        const s = low + depth * .55, cut = depth * (.10 + random(index, 31) * .18), inset = widthMm * (.035 + random(index, 32) * .04)
        emit('side', [at(s - cut, lateral), at(s - cut * .2, lateral - side * inset), at(s + cut, lateral - side * inset * .5), at(s + cut * .7, lateral)],
          s - cut, s + cut, .97, 1.08, .23 * blend)
      }
    }
    return { profile: input.profile, bandMm, landingDepthMm, stationsMm, riserHeightMm, shapes }
  }
  emit('landing', strip(0, landingDepthMm), 0, landingDepthMm, .98, 1.04)
  emit('landing', strip(length - landingDepthMm, length), length - landingDepthMm, length, 1.03, 1.01)
  // The same saved-world irregular front is reused by adjoining steps.
  const front = (index: number, offset: number) => Array.from({ length: 9 }, (_, k) => {
    const lateral = -half + widthMm * k / 8
    const variation = index === 0 || index === count ? 0 : (visualRandom(seed, index * 9 + k, 520) - .5) * depth * .10
    return at(landingDepthMm + index * depth + offset + variation, lateral)
  })
  for (let i = 0; i < count; i++) {
    const low = stationsMm[i], high = low + depth, shade = .98 + visualRandom(seed, i, 521) * .075
    const a = at(low), b = at(Math.min(length, low + Math.max(1, depth * .3)))
    const span = Math.hypot(b.x - a.x, b.y - a.y) || 1
    const downhillFacing = -((b.x - a.x) * light.x + (b.y - a.y) * light.y) / span
    emit('tread', [...front(i, riserDepth), ...front(i + 1, 0).reverse()], low + riserDepth, high,
      shade * 1.045, shade * .91)
    const faceShade = .95 + downhillFacing * .08
    emit('riser', [...front(i, 0), ...front(i, riserDepth).reverse()], low, low + riserDepth,
      faceShade * .90, faceShade * 1.04, .82)
    const lip = Math.min(15, depth * .045)
    emit('lip', [...front(i, riserDepth), ...front(i, riserDepth + lip).reverse()], low + riserDepth,
      low + riserDepth + lip, .97, 1.06, .77)
    // Sparse, short cracks belong to a continuous tread rather than splitting
    // every step into isolated pavers with aligned gaps.
    if (visualRandom(seed, i, 522) > .47) {
      const x = (visualRandom(seed, i, 523) - .5) * widthMm * .8
      const s = low + depth * .62, crack = Math.min(18, widthMm * .014)
      emit('seam', [at(s - depth * .13, x), at(s + depth * .21, x + widthMm * .04),
        at(s + depth * .19, x + widthMm * .04 + crack), at(s - depth * .12, x + crack)],
      s - depth * .13, s + depth * .21, .86, .95, .32)
    }
  }
  // Narrow side masses preserve the physical width; open end landings avoid a
  // rectangular frame around the entire connection.
  for (const side of [-1, 1]) {
    const outer = side * half, inner = side * (half - Math.min(80, widthMm * .06))
    emit('side', strip(landingDepthMm, length - landingDepthMm, Math.min(outer, inner), Math.max(outer, inner)),
      landingDepthMm, length - landingDepthMm, .85, .98, .5)
  }
  return { profile: TERRACED_ROCK_STEPS_PROFILE, bandMm, landingDepthMm, stationsMm, riserHeightMm, shapes }
}

/** Build/validate every path before the first target mutation. Caller retains
 * its material, support blending, audience filtering and exact opening band. */
export function drawTerracedRockSteps(ctx: CanvasRenderingContext2D,
  input: TerracedRockStepInput & { palette: NaturalRockStepPalette }): TerracedRockStepPlan {
  if (![input.palette?.base, input.palette?.dark, input.palette?.light].every(color => typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color))) throw new Error('连续岩阶调色须为完整RGB颜色。')
  const plan = planTerracedRockSteps(input)
  const path = (rings: PointMm[][]) => {
    const result = new Path2D()
    for (const ring of rings) { ring.forEach((p, i) => i ? result.lineTo(p.x, p.y) : result.moveTo(p.x, p.y)); result.closePath() }
    return result
  }
  const band = path([plan.bandMm]), shapes = plan.shapes.map(shape => ({ ...shape, path: path(shape.ringsMm) }))
  ctx.save()
  try {
    ctx.clip(band)
    for (const shape of shapes) {
      const base = shape.kind === 'riser' || shape.kind === 'seam' || shape.kind === 'side' ? input.palette.dark
        : shape.kind === 'lip' ? input.palette.light : input.palette.base
      const gradient = ctx.createLinearGradient(shape.fromMm.x, shape.fromMm.y, shape.toMm.x, shape.toMm.y)
      gradient.addColorStop(0, tint(base, shape.startShade)); gradient.addColorStop(1, tint(base, shape.endShade))
      ctx.fillStyle = gradient; ctx.globalAlpha = shape.opacity; ctx.fill(shape.path, 'evenodd')
    }
  } finally { ctx.restore() }
  return plan
}
