import type { PointMm } from '../../../model/scene.js'
import { distanceToSegment, pointInPolygon, polygonInside, polylineSides } from '../../../geometry/geometry.js'
import { ROAD_MIN_GOING_MM, ROAD_RISER_LIMIT_MM } from '../../../geometry/road-surface.js'
import { terrainRandomUnit } from '../../../terrain-generation/field.js'
import type { VolcanoDesign, VolcanoParameters, VolcanoSide } from './contracts.js'

type Layout = Pick<VolcanoParameters, 'boundsMm' | 'mountain' | 'crater' | 'ascent' | 'descent' | 'route' | 'flow'>
type NaturalLayout = Pick<VolcanoParameters, 'relief' | 'mountain' | 'crater' | 'platform' | 'entrance' | 'ascent' | 'descent' | 'route' | 'flow'>
type Crossing = VolcanoParameters['ascent']
const sides: Record<VolcanoSide, PointMm> = { east: { x: 1, y: 0 }, west: { x: -1, y: 0 }, north: { x: 0, y: -1 }, south: { x: 0, y: 1 } }
export const volcanoSideVector = (side: VolcanoSide) => sides[side]

export function volcanoContainsRing(outer: PointMm[], inner: PointMm[]) {
  return inner.every(point => pointInPolygon(point, outer, false)) && polygonInside(inner, outer)
}

// Ordinary generated walking ramps use a rise of at most half their run.
// Existing authored connections retain their saved movement policy.
export const VOLCANO_WALKING_RAMP_GRADE = .5
export function volcanoCrossingMinimumRun(kind: Crossing['kind'], riseMm: number) {
  return kind === 'ramp' ? Math.ceil(riseMm / VOLCANO_WALKING_RAMP_GRADE)
    : Math.ceil(riseMm / ROAD_RISER_LIMIT_MM) * ROAD_MIN_GOING_MM
}

/** A narrow source widens into a pool. The same closed ring defines the
 * editable lava surface and its movement region. */
export function calderaFlowBoundary(points: PointMm[], widthMm: number, adaptive = false): PointMm[] {
  const widest = Math.round((points.length - 1) * .76), swell = Math.max(1, (points.length - 1) * .31)
  const narrow = adaptive ? .46 : .73
  const widths = points.map((_, i) => widthMm * (narrow + (adaptive ? 1 - narrow : .27) * Math.exp(-(((i - widest) / swell) ** 2))))
  const { left, right } = polylineSides(points, widths)
  if (!left.length) return []
  const cap = (center: PointMm, a: PointMm, b: PointMm) => Array.from({ length: 5 }, (_, i) => {
    const angle = Math.atan2(a.y - center.y, a.x - center.x) + Math.PI * (i + 1) / 6
    const radius = Math.hypot(b.x - center.x, b.y - center.y)
    return { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius }
  })
  return [...left, ...cap(points.at(-1)!, left.at(-1)!, right.at(-1)!), ...right.slice().reverse(), ...cap(points[0], right[0], left[0])]
    .map(({ x, y }) => ({ x: Math.round(x), y: Math.round(y) }))
}

/** Original layout envelope for saved v1 compositions. */
export function calderaLayout(parameters: Layout, seed: string): NaturalLayout | undefined {
  const { boundsMm: b, crater, route, flow } = parameters
  const { width, height } = b
  const [topLeft, , bottomRight] = crater.boundaryMm
  const cw = bottomRight.x - topLeft.x, ch = bottomRight.y - topLeft.y
  const s = Math.min(width / 40000, height / 32000)
  if (width < 28000 || height < 22000 || width / height > 2 || height / width > 1.25
    || route.widthMm > 1900 * s || cw < width * .16 || cw > width * .30
    || ch < height * .24 || topLeft.y < b.y + height * .17 || bottomRight.y > b.y + height * .82
    || flow && (flow.widthMm > cw * .25 || flow.widthMm > ch * .2)) return
  const layout = naturalLayout(parameters, seed)
  const lava = layout.flow?.centerlineMm
  if (flow && lava && distanceToSegment(layout.descent.toMm, lava[1], lava[2]) < (route.widthMm + flow.widthMm) / 2 + 250) return
  return layout
}

function naturalLayout(parameters: Layout, seed: string, lavaShift = 0): NaturalLayout {
  const { boundsMm: b, crater, ascent, descent, route, flow } = parameters
  const { width, height } = b
  const [topLeft, , bottomRight] = crater.boundaryMm
  const cw = bottomRight.x - topLeft.x, ch = bottomRight.y - topLeft.y
  const cy = (topLeft.y + bottomRight.y - 2 * b.y) / (2 * height)
  const at = (x: number, y: number): PointMm => ({ x: b.x + Math.round(width * x), y: b.y + Math.round(height * y) })
  const inCrater = (x: number, y: number): PointMm => ({ x: topLeft.x + Math.round(cw * x), y: topLeft.y + Math.round(ch * y) })
  const drift = (index: number) => (terrainRandomUnit(seed, `caldera/rim/${index}`) - .5) * .024
  const mountain = [[.24,.22],[.34,.15],[.45,.10],[.57,.105],[.66,.065],[.79,.10],[.89,.16],[.945,.29],
    [.932,.40],[.958,.51],[.936,.64],[.946,.77],[.867,.873],[.742,.922],[.626,.906],[.527,.925],[.422,.887],
    [.319,.90],[.239,.831],[.168,.72],[.151,.61],[.168,.55],[.16,.48],[.177,.397],[.165,.33],[.199,.263]]
    .map(([x, y], i) => at(x + drift(i) * .52, y + drift(i + 31)))
  // The approach-facing lip leaves room for the full stair or ramp landing.
  const rim = [[.045,.31],[.11,.171],[.23,.072],[.36,.095],[.48,.00],[.60,.049],[.73,.113],[.84,.128],
    [.948,.25],[1,.384],[.96,.55],[.985,.68],[.90,.81],[.79,.916],[.63,.956],[.51,1],[.37,.942],
    [.25,.95],[.14,.858],[.062,.72],[.025,.60],[0,.50],[.035,.42]]
    .map(([x,y], i) => inCrater(x, y <= .025 || y >= .98 || x < .04 ? y : y + drift(i + 57) * 1.1))
  const platform = [[.305,.535],[.333,.503],[.407,.49],[.452,.511],[.474,.55],[.455,.606],
    [.386,.626],[.322,.609],[.298,.581]].map(([x,y]) => at(x,y))
  const anchorMm = at(.385,.557), entrance = at(.052,.735)
  const approachY = .596
  const craterEntry = inCrater(.20,.50)
  const crestEntry = at(.492,cy)
  const branch = inCrater(.67 + drift(98), .24)
  const lava = flow && [branch, inCrater(.641,.34), inCrater(.595,.42), inCrater(.588,.48), inCrater(.622,.54),
    inCrater(.67,.60), inCrater(.685,.67), inCrater(.66,.74)].map(p => ({ ...p, x: p.x + Math.round(cw * lavaShift) }))
  return {
    relief: 'caldera-v1',
    mountain: { ...parameters.mountain, boundaryMm: mountain },
    crater: { ...crater, boundaryMm: rim },
    platform: { boundaryMm: platform, anchorMm },
    entrance: { positionMm: entrance, directionDeg: 311 },
    ascent: { ...ascent, fromMm: at(.116,approachY), toMm: at(.236,approachY) },
    descent: { ...descent, fromMm: crestEntry, toMm: craterEntry },
    route: { ...route, toPlatformViaMm: [at(.263,approachY), at(.29,.601), at(.323,.588), at(.353,.57)],
      toCraterViaMm: [at(.423,.555), at(.453,(cy * .35 + .55 * .65)), at(.471,cy)] },
    flow: flow && lava ? { ...flow, centerlineMm: lava } : null,
  }
}

const ring = (left: number, top: number, right: number, bottom: number): PointMm[] =>
  [{ x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom }]

function extendCrossing(crossing: Crossing, minimumRun: number, earliest: number, latest: number, share: number): Crossing {
  const from = crossing.fromMm, to = crossing.toMm
  if (to.x - from.x >= minimumRun) return crossing
  const extra = minimumRun - (to.x - from.x), leftRoom = Math.max(0, from.x - earliest), rightRoom = Math.max(0, latest - to.x)
  const left = Math.min(leftRoom, Math.max(extra - rightRoom, Math.ceil(extra * share)))
  return { ...crossing, fromMm: { ...from, x: from.x - left }, toMm: { ...to, x: to.x + Math.min(rightRoom, extra - left) } }
}

/** Extra land is added to the outside of a rim that genuinely has room in the
 * floor. Keep the inner basin and all authored dimensions at their input size. */
function fitMountainAroundCrater(mountain: PointMm[], crater: PointMm[], bounds: VolcanoParameters['boundsMm']) {
  const centre = { x: (Math.min(...crater.map(p => p.x)) + Math.max(...crater.map(p => p.x))) / 2,
    y: (Math.min(...crater.map(p => p.y)) + Math.max(...crater.map(p => p.y))) / 2 }
  const inset = Math.max(1, Math.round(Math.min(bounds.width, bounds.height) * .014))
  const padded = crater.map(p => {
    const dx = p.x - centre.x, dy = p.y - centre.y, length = Math.hypot(dx, dy) || 1
    return { x: Math.round(p.x + inset * dx / length), y: Math.round(p.y + inset * dy / length) }
  })
  if (volcanoContainsRing(mountain, padded)) return mountain
  const left = Math.min(...padded.map(p => p.x)), right = Math.max(...padded.map(p => p.x))
  const top = Math.min(...padded.map(p => p.y)), bottom = Math.max(...padded.map(p => p.y))
  if (left <= bounds.x || right >= bounds.x + bounds.width || top <= bounds.y || bottom >= bounds.y + bounds.height) return mountain
  const x0 = Math.min(...mountain.map(p => p.x)), x1 = Math.max(...mountain.map(p => p.x))
  const y0 = Math.min(...mountain.map(p => p.y)), y1 = Math.max(...mountain.map(p => p.y))
  const push = (n: number, low: number, high: number, needLow: number, needHigh: number, allowedLow: number, allowedHigh: number) => {
    const t = (n - low) / (high - low)
    return Math.round(n - (needLow < low ? Math.min(low - allowedLow, low - needLow + inset) : 0) * (1 - t) ** 2
      + (needHigh > high ? Math.min(allowedHigh - high, needHigh - high + inset) : 0) * t ** 2)
  }
  return mountain.map(p => ({ x: push(p.x, x0, x1, left, right, bounds.x + 1, bounds.x + bounds.width - 1),
    y: push(p.y, y0, y1, top, bottom, bounds.y + 1, bounds.y + bounds.height - 1) }))
}

/** Keep the requested size, direction, elevations and widths. Alternatives move the
 * unpinned crater/landings along the approach and move the lava within its basin. */
export function* volcanoLayouts(parameters: VolcanoParameters, design: VolcanoDesign, seed: string) {
  const world = parameters.boundsMm, inward = volcanoSideVector(design.entranceSide)
  const horizontal = inward.x !== 0, width = horizontal ? world.width : world.height, height = horizontal ? world.height : world.width
  const boundsMm = { x: 0, y: 0, width, height }
  const toWorld = ({ x, y }: PointMm): PointMm => horizontal
    ? { x: world.x + (inward.x < 0 ? x : width - x), y: world.y + y }
    : { x: world.x + y, y: world.y + (inward.y < 0 ? x : width - x) }
  const toLocal = ({ x, y }: PointMm): PointMm => horizontal
    ? { x: inward.x < 0 ? x - world.x : width - (x - world.x), y: y - world.y }
    : { x: inward.y < 0 ? y - world.y : width - (y - world.y), y: x - world.x }
  const fixedPlatform = design.fixedPlatform ? { boundaryMm: parameters.platform.boundaryMm.map(toLocal), anchorMm: toLocal(parameters.platform.anchorMm) } : undefined
  const at = (x: number, y: number) => ({ x: Math.round(width * x), y: Math.round(height * y) })
  const { route, flow, ascent, descent } = parameters
  const cw = Math.round(width * design.craterWidthPercent / 100), ch = Math.round(height * design.craterHeightPercent / 100)
  const top = Math.round(height * (design.craterCenterYPercent - design.craterHeightPercent / 2) / 100), bottom = top + ch
  const halfWidth = Math.ceil(route.widthMm / 2), approach = Math.ceil(route.widthMm / 3)
  const ascentRun = volcanoCrossingMinimumRun(ascent.kind, parameters.mountain.elevationMm - parameters.groundElevationMm)
  const descentRun = volcanoCrossingMinimumRun(descent.kind, parameters.mountain.elevationMm - parameters.crater.elevationMm)
  const natural = design.shape === 'natural'
  const west = Math.round(width * .55), fittedWest = Math.min(west, Math.max(Math.round(width * .48), Math.round(width * .92) - cw))
  const variants = [
    { craterWest: west, ascentShare: .45, descentShare: .24, lavaShift: 0, fitMountain: false },
    { craterWest: west, ascentShare: .78, descentShare: .50, lavaShift: .055, fitMountain: true },
    { craterWest: fittedWest, ascentShare: .54, descentShare: .30, lavaShift: 0, fitMountain: false },
    { craterWest: fittedWest, ascentShare: .25, descentShare: .62, lavaShift: .085, fitMountain: true },
  ]
  for (const { craterWest, ascentShare, descentShare, lavaShift, fitMountain } of variants) {
    const crater = { ...parameters.crater, boundaryMm: ring(craterWest, top, craterWest + cw, bottom) }
    const cy = Math.round((top + bottom) / 2)
    const layout: NaturalLayout = natural ? naturalLayout({ ...parameters, boundsMm, crater }, seed, lavaShift) : {
      mountain: { ...parameters.mountain, boundaryMm: ring(at(.2, .125).x, at(.2, .125).y, at(.94, .875).x, at(.94, .875).y) },
      crater, platform: { boundaryMm: ring(at(.33, .40).x, at(.33, .40).y, at(.48, .60).x, at(.48, .60).y), anchorMm: at(.405, .5) },
      entrance: { positionMm: at(.075, .5), directionDeg: 0 },
      ascent: { ...ascent, fromMm: at(.15, .5), toMm: at(.25, .5) },
      descent: { ...descent, fromMm: { x: craterWest - at(.04, 0).x, y: cy }, toMm: { x: craterWest + Math.round(cw * .2), y: cy } },
      route: { ...route, toPlatformViaMm: [], toCraterViaMm: [] },
      flow: flow && { ...flow, centerlineMm: [ { x: craterWest + Math.round(cw * .72), y: top + Math.round(ch * .25) },
        { x: craterWest + Math.round(cw * .72), y: top + Math.round(ch * .75) } ] },
    }
    const lava = layout.flow?.centerlineMm, platform = fixedPlatform ?? layout.platform
    const firstPlatformX = Math.min(...platform.boundaryMm.map(p => p.x))
    const lastPlatformX = Math.max(...platform.boundaryMm.map(p => p.x))
    const ascentFit = extendCrossing(layout.ascent, ascentRun, halfWidth + approach + 2, firstPlatformX - halfWidth - 2, ascentShare)
    const lavaWest = lava && flow ? Math.min(...lava.map(p => p.x)) - Math.ceil(flow.widthMm / 2) - halfWidth - approach : Infinity
    const descentFit = extendCrossing(layout.descent, descentRun, lastPlatformX + halfWidth + 2,
      Math.min(craterWest + Math.round(cw * .67), lavaWest), descentShare)
    const entry = layout.entrance.positionMm
    const entrance = toWorld({ ...entry, x: Math.max(halfWidth + 2, Math.min(entry.x, ascentFit.fromMm.x - approach)) })
    const firstLanding = toWorld(ascentFit.fromMm)
    const angle = Math.atan2(firstLanding.y - entrance.y, firstLanding.x - entrance.x) * 180 / Math.PI
    const towardPlatform = layout.route.toPlatformViaMm.filter(p => p.x > ascentFit.toMm.x + halfWidth)
    const towardCrater = layout.route.toCraterViaMm.filter(p => p.x < descentFit.fromMm.x - halfWidth)
    if (!natural && platform.anchorMm.y !== cy) towardCrater.push({ x: platform.anchorMm.x, y: cy })
    const reverseWinding = design.entranceSide === 'east' || design.entranceSide === 'north'
    const polygon = (points: PointMm[]) => reverseWinding ? points.map(toWorld).reverse() : points.map(toWorld)
    const crossing = (row: Crossing) => ({ ...row, fromMm: toWorld(row.fromMm), toMm: toWorld(row.toMm) })
    const foot = natural && fitMountain ? fitMountainAroundCrater(layout.mountain.boundaryMm, layout.crater.boundaryMm, boundsMm) : layout.mountain.boundaryMm
    const result: VolcanoParameters & { breachSide?: VolcanoSide } = {
      ...parameters, ...(natural ? { relief: 'caldera-v1' as const } : {}),
      ...(natural && design.breachSide !== 'none' ? { breachSide: design.breachSide } : {}),
      mountain: { ...layout.mountain, boundaryMm: polygon(foot) },
      crater: { ...layout.crater, boundaryMm: polygon(layout.crater.boundaryMm) },
      platform: fixedPlatform ? parameters.platform : { boundaryMm: polygon(platform.boundaryMm), anchorMm: toWorld(platform.anchorMm) },
      entrance: { positionMm: entrance, directionDeg: (angle + 360) % 360 },
      ascent: crossing(ascentFit), descent: crossing(descentFit),
      route: { ...route, ...(natural ? { boundaryBlendMm: 215 } : {}), toPlatformViaMm: towardPlatform.map(toWorld), toCraterViaMm: towardCrater.map(toWorld) },
      flow: layout.flow && { ...layout.flow, centerlineMm: layout.flow.centerlineMm.map(toWorld) },
    }
    if (!natural) delete result.relief
    if (!natural || design.breachSide === 'none') delete result.breachSide
    yield result
  }
}
