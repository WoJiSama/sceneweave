import type { Path, PointMm } from '../model/scene.js'
import { connectionArcFrame } from './connection-route.js'
import { ROAD_LANDING_LENGTH_MM, ROAD_MIN_GOING_MM, ROAD_PPM, ROAD_RISER_LIMIT_MM, ROAD_SHOULDER_LIMIT_MM, ROAD_STATION_LIMIT, ROAD_SURFACE_DEPTH_MM, RoadFootprintConflict,
  pointPair, roadSurfaceFrame, toRoadPpm, type RoadLanding, type RoadSpanKind, type RoadStation, type RoadSurface } from './road-surface.js'

type GroundHeight = (point: PointMm) => number | null
type Range = { start: number; end: number; slope: -1 | 0 | 1; landingZ?: number }
const SAMPLE_MM = 360
const STEP_GRADE = .25
const CAP_MM = 850
const TERRAIN_CONFLICT = '现有坡面与自动道路的净宽或接合冲突，请移动路线或调整道路宽度。'
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value))

/** Size each bank from its actual cut or fill, independently of style. */
export function roadShoulderMm(widthMm: number, differenceMm: number) {
  if (Math.abs(differenceMm) <= .5) return 0
  return Math.round(Math.min(ROAD_SHOULDER_LIMIT_MM, widthMm * .38, 105 + Math.abs(differenceMm) * .69))
}

export function gradeRoadSurface(path: Pick<Path, 'centerlineMm' | 'widthMm' | 'widthSections'>, fixed: readonly PointMm[], landings: readonly RoadLanding[], heightAt: GroundHeight): RoadSurface {
  const frame = roadSurfaceFrame(path), length = frame.length
  const arc = connectionArcFrame(path.centerlineMm)
  const ppm = (distance: number) => toRoadPpm(distance, length)
  const height = (point: PointMm) => {
    const value = heightAt(point)
    if (value === null) throw new RoadFootprintConflict(TERRAIN_CONFLICT)
    return value
  }
  const crossAt = (distance: number) => pointPair(side => height(frame.pointAt(ppm(distance), side ? .5 : -.5)))
  const caps = [crossAt(0), crossAt(length)]
  const mean = ([a, b]: readonly [number, number]) => (a + b) / 2
  const raw = (distance: number) => height(arc.at(distance))
  const anchors = fixed.map(point => {
    const index = path.centerlineMm.findIndex(p => p.x === point.x && p.y === point.y)
    if (index < 0) throw new Error('固定点须在道路中心线上。')
    return arc.distances[index]
  })
  const heights = new Map<number, number>()
  const desired = (distance: number) => {
    if (distance < .001 || distance > length - .001) return Math.round(mean(caps[distance < length / 2 ? 0 : 1]))
    if (heights.has(distance)) return heights.get(distance)!
    const reach = Math.min(310, ...anchors.map(anchor => Math.abs(distance - anchor)))
    const value = Math.round((raw(distance) * 2 + raw(distance - reach) + raw(distance + reach)) / 4)
    heights.set(distance, value)
    return value
  }

  const pinned = landings.map(landing => {
    const i = fixed.findIndex(point => point.x === landing.pointMm.x && point.y === landing.pointMm.y)
    if (i < 1 || i >= fixed.length - 1) throw new Error('歇脚平台须绑定内部固定点。')
    return { start: anchors[i] - landing.lengthMm / 2, end: anchors[i] + landing.lengthMm / 2, slope: 0 as const, landingZ: landing.elevationMm }
  }).sort((a, b) => a.start - b.start)
  if (pinned.some((range, i) => range.start < CAP_MM || range.end > length - CAP_MM || i > 0 && range.start < pinned[i - 1].end + 260)) throw new Error('固定平台需要足够的两端接入距离，请拉开端点或其他平台。')

  const findLanding = ({ start, end }: Range): Range | undefined => {
    const low = Math.max(start + 160, CAP_MM), high = Math.min(end - 160, length - CAP_MM)
    const middle = (low + high) / 2
    for (const size of [ROAD_LANDING_LENGTH_MM, 1050]) {
      const first = low + size / 2, last = high - size / 2
      if (first > last) continue
      const count = Math.min(24, Math.max(1, Math.ceil((last - first) / 170)))
      const centers = [middle, ...Array.from({ length: count + 1 }, (_, i) => first + (last - first) * i / count)]
        .sort((a, b) => Math.abs(a - middle) - Math.abs(b - middle))
      for (const center of centers) {
        const a = center - size / 2, b = center + size / 2, z = desired(center)
        const heights = [a, a + size / 4, center, b - size / 4, b].map(desired)
        if (Math.max(...heights) - Math.min(...heights) > 105
          || Math.abs(desired(start) - z) > .35 * (a - start) || Math.abs(desired(end) - z) > .35 * (end - b)) continue
        return { start: a, end: b, slope: 0, landingZ: z }
      }
    }
  }

  // Each fixed point bounds the grading of its two legs. Landings themselves
  // can straddle the fixed point so their size and elevation remain stable.
  const divisions = [...new Set([...anchors.filter(value => !pinned.some(range => value > range.start && value < range.end)), ...pinned.flatMap(range => [range.start, range.end])])].sort((a, b) => a - b)
  const ranges: Range[] = []
  for (let i = 1; i < divisions.length; i++) {
    const start = divisions[i - 1], end = divisions[i], span = end - start
    const landing = pinned.find(range => range.start === start && range.end === end)
    if (landing) { ranges.push(landing); continue }
    const count = Math.max(1, Math.ceil(span / SAMPLE_MM))
    if (count > ROAD_STATION_LIMIT) throw new Error('这段路线超过地形断面预算，请分段绘制。')
    const local: Range[] = []
    for (let j = 0; j < count; j++) {
      const a = start + span * j / count, b = start + span * (j + 1) / count
      const mid = (a + b) / 2, low = Math.max(start, mid - 480), high = Math.min(end, mid + 480)
      const slope = (desired(high) - desired(low)) / (high - low)
      const sign = slope >= STEP_GRADE ? 1 : slope <= -STEP_GRADE ? -1 : 0
      const previous = local.at(-1)
      if (previous?.slope === sign) previous.end = b
      else local.push({ start: a, end: b, slope: sign })
    }
    for (const range of local) {
      const runLength = range.end - range.start, rise = desired(range.end) - desired(range.start)
      if (range.slope && (runLength < 550 || Math.abs(rise) < 128 || Math.sign(rise) !== range.slope)) range.slope = 0
    }
    for (const [j, range] of local.entries()) {
      const landing = !range.slope && local[j - 1]?.slope && local[j + 1]?.slope ? findLanding(range) : undefined
      if (landing) {
        ranges.push({ ...range, end: landing.start }, landing, { ...range, start: landing.end })
        continue
      }
      const previous = ranges.at(-1)
      if (previous && previous.start >= start && previous.slope === range.slope && previous.landingZ === undefined && range.landingZ === undefined) previous.end = range.end
      else ranges.push(range)
    }
  }

  type Interval = { start: number; end: number; kind: RoadSpanKind; from: number; to: number }
  const intervals: Interval[] = []
  const endHeight = (where: number, a?: Range, b?: Range) => a?.landingZ ?? b?.landingZ ?? desired(where)
  for (const [i, range] of ranges.entries()) {
    const { start, end, landingZ } = range, from = endHeight(start, range, ranges[i - 1]), to = endHeight(end, range, ranges[i + 1])
    const runLength = end - start, rise = Math.abs(to - from)
    if (landingZ !== undefined) { intervals.push({ start, end, kind: 'landing', from: landingZ, to: landingZ }); continue }
    if ((!range.slope && rise <= runLength * .38) || rise < 115 && rise <= runLength * .40) { intervals.push({ start, end, kind: 'trail', from, to }); continue }
    const count = Math.ceil(rise / ROAD_RISER_LIMIT_MM)
    if (runLength + .01 < count * ROAD_MIN_GOING_MM) throw new Error(`沿线有一段 ${Math.round(runLength / 10)} 厘米内升降过急，无法排出有足够深度的踏步。请调整转弯或平台。`)
    // Invert the local elevation profile at each half-rise. The treads have
    // bounded risers and can lengthen naturally on a less steep part of a flight.
    const direction = Math.sign(to - from), samples = Math.max(2, Math.ceil(runLength / 150))
    const profile = Array.from({ length: samples + 1 }, (_, j) => desired(start + runLength * j / samples))
    let search = 1, previous = start
    for (let j = 1; j <= count; j++) {
      const target = rise * (j - .5) / count
      while (search < samples && (profile[search] - from) * direction < target) search++
      const low = (profile[search - 1] - from) * direction, high = (profile[search] - from) * direction
      const at = start + runLength * (search - 1 + (high > low ? clamp((target - low) / (high - low), 0, 1) : .5)) / samples
      const edge = clamp(at, previous + ROAD_MIN_GOING_MM * (j === 1 ? .5 : 1), end - ROAD_MIN_GOING_MM * (count - j + .5))
      const level = Math.round(from + (to - from) * (j - 1) / count)
      intervals.push({ start: previous, end: edge, kind: 'tread', from: level, to: level })
      previous = edge
    }
    intervals.push({ start: previous, end, kind: 'tread', from: to, to })
  }

  const ledger = new Map<number, RoadStation>()
  const deck = (level: number, distance: number): [number, number] => {
    const run = distance < length / 2 ? distance : length - distance
    if (run >= CAP_MM) return [level, level]
    const cap = caps[distance < length / 2 ? 0 : 1], mix = 1 - run / CAP_MM
    const tilt = Math.round((cap[0] - mean(cap)) * mix)
    return pointPair(side => Math.round(level) + (side ? -tilt : tilt))
  }
  function station(atPpm: number, z: [number, number], kind: RoadSpanKind) {
    const xy = frame.sectionAt(atPpm, [0, 0]), endpoint = atPpm === 0 || atPpm === ROAD_PPM
    // An exact cap shares its two height samples with the original ground.
    if (endpoint) z = caps[atPpm === 0 ? 0 : 1].map(Math.round) as [number, number]
    const innerGround = pointPair(side => height(xy[side + 1]))
    const width = Math.hypot(xy[2].x - xy[1].x, xy[2].y - xy[1].y)
    const previous = ledger.get(atPpm)
    const shoulderMm = pointPair(side => {
      if (endpoint) return 0
      const heights = previous ? [z[side], previous.inZMm[side]] : [z[side]]
      let size = Math.max(...heights.map(level => roadShoulderMm(width, innerGround[side] - level)))
      while (size > 1) {
        const outer = frame.sectionAt(atPpm, side ? [0, size] : [size, 0])[side ? 3 : 0]
        const bank = heightAt(outer)
        if (bank !== null && heights.every(level => Math.abs(bank - level) <= ROAD_SURFACE_DEPTH_MM - 1)) break
        size = Math.floor(size * .8)
      }
      return size
    })
    const outer = frame.sectionAt(atPpm, shoulderMm)
    const bankZMm = pointPair(side => {
      const ground = height(outer[side ? 3 : 0])
      if (Math.abs(ground - z[side]) > ROAD_SURFACE_DEPTH_MM) throw new Error(`局部挖填深度 ${Math.round(Math.abs(ground - z[side]))} 毫米，超过路肩接合范围。请调整道路走向或净宽。`)
      return Math.round(ground)
    })
    if (previous) {
      previous.kind = kind
      previous.shoulderMm = shoulderMm
      previous.bankZMm = bankZMm
      if (!endpoint && previous.inZMm.some((value, i) => value !== z[i])) previous.outZMm = z
    } else ledger.set(atPpm, { atPpm, kind, inZMm: z, shoulderMm, bankZMm })
  }
  const knots = [...frame.knots.values()]
  for (const { start, end, from, to, kind } of intervals) {
    const span = end - start, count = Math.max(1, Math.ceil(span / 560))
    const samples = [start, end, ...Array.from({ length: count - 1 }, (_, j) => start + span * (j + 1) / count), ...knots.filter(where => where > start && where < end)]
    let previousMm = start, previousZ = from
    for (const at of [...new Set(samples.map(ppm))].sort((a, b) => a - b)) {
      const distance = frame.distance(at)
      let z = from
      if (kind === 'trail') {
        const remaining = Math.min(span, Math.max(0, end - distance)), reach = Math.min(span, Math.max(0, distance - previousMm)) * .40
        const source = desired(distance) + (from - desired(start)) * Math.max(0, 1 - (distance - start) / 1300)
          + (to - desired(end)) * Math.max(0, 1 - remaining / 1300)
        z = clamp(clamp(source, previousZ - reach, previousZ + reach), to - remaining * .40, to + remaining * .40)
        if (at === ppm(start)) z = from
        if (at === ppm(end)) z = to
      }
      station(at, deck(z, distance).map(Math.round) as [number, number], kind)
      previousMm = distance
      previousZ = z
    }
    if (ledger.size > ROAD_STATION_LIMIT) throw new Error('这条道路超过地表断面预算，请分段绘制。')
  }
  return { version: 1, stations: [...ledger.values()].sort((a, b) => a.atPpm - b.atPpm) }
}

export function makeRoadLanding(pointMm: PointMm, heightAt: GroundHeight, lengthMm = ROAD_LANDING_LENGTH_MM): RoadLanding {
  const elevationMm = heightAt(pointMm)
  if (elevationMm === null) throw new Error('歇脚平台须落在现有陆地上。')
  return { pointMm: { ...pointMm }, lengthMm, elevationMm: Math.round(elevationMm) }
}
