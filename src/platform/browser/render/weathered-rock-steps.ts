import { connectionArcFrame } from '../../../shared/geometry/connection-route.js'
import type { PointMm } from '../../../shared/model/scene.js'
import type { ProjectedConnection } from '../../../shared/projection/types.js'
import { defaultStaircase } from '../../../shared/stairs/contracts.js'
import { planStaircase, staircasePatch, staircasePointAt } from '../../../shared/stairs/geometry.js'
import { terrainRandomUnit } from '../../../shared/terrain-generation/field.js'

export const WEATHERED_ROCK_STEPS_PROFILE = 'naturalRockSteps9' as const
export const ERODED_ROCK_STEPS_PROFILE = 'naturalRockSteps10' as const
export const usesWeatheredRockSteps = (profile: NonNullable<ProjectedConnection['route']>['renderProfile']) =>
  profile === WEATHERED_ROCK_STEPS_PROFILE || profile === ERODED_ROCK_STEPS_PROFILE

export function planWeatheredRockSteps(connection: ProjectedConnection, fromMm: number, toMm: number) {
  const { route, widthMm } = connection
  if (!route || fromMm === toMm) return
  const line = fromMm < toMm ? route.centerlineMm : route.centerlineMm.toReversed()
  const frame = connectionArcFrame(line)
  const lowMm = Math.min(fromMm, toMm), highMm = Math.max(fromMm, toMm), rise = highMm - lowMm
  const eroded = route.renderProfile === ERODED_ROCK_STEPS_PROFILE
  const length = frame.length, landing = Math.min(widthMm * .28, length * (eroded ? .11 : .085))
  const highLanding = eroded ? Math.min(widthMm * .20, length * .075) : landing
  const run = eroded ? length - landing - highLanding : length - landing * 2
  const minSteps = Math.ceil(rise / 225), maxSteps = Math.max(minSteps, Math.round(rise / 160))
  const count = Math.max(1, Math.min(512, Math.floor(run / 155), maxSteps, Math.max(minSteps, Math.round(run / route.treadDepthMm))))
  const depth = run / count
  const seed = eroded ? line.map(p => `${p.x - line[0].x},${p.y - line[0].y}`).join('/') : line.map(p => `${p.x},${p.y}`).join('/')
  const random = (index: number, channel: string) => terrainRandomUnit(seed, `${index}/${channel}`)
  // The rails have the same miters as the ordinary staircase. A valid routed
  // connector can also have a bevel, so use the route frame for paint on those turns.
  let at = (s: number, lateral: number) => frame.at(s, lateral * widthMm)
  let stations = frame.distances.slice(1, -1)
  let patch = (a: number, b: number) => [at(a, -.5), at(b, -.5), at(b, .5), at(a, .5)]
  let fitsBedding = false
  try {
    const basis = planStaircase(line, widthMm, { ...defaultStaircase(), layout: { kind: 'stretch', stepCount: 1 } })
    at = (s, lateral) => staircasePointAt(basis, s, lateral)
    stations = basis.sections.slice(1, -1).map(row => row.distanceMm)
    patch = (a, b) => staircasePatch(basis, a, b)
    fitsBedding = eroded
  } catch {
    // The actual connection footprint is still the clip and opening in both views.
  }
  const fullWidthPoint = at
  const stoneMargins = (distance: number) => {
    const t = Math.max(0, Math.min(1, (distance - landing) / run))
    const shoulder = (1 - Math.sin(Math.PI * t)) * .065
    return [Math.min(.18, .074 + shoulder + .036 * Math.sin(t * 16 + 1) + .022 * Math.cos(t * 31)),
      Math.min(.18, .071 + shoulder + .044 * Math.cos(t * 13 + .5) + .025 * Math.sin(t * 25))] as const
  }
  const adaptiveWidth = fitsBedding && widthMm > 1150 ? Math.min(1, (widthMm - 1150) / (widthMm * .36)) : 0
  const stonePoint = (distance: number, lane: number) => {
    if (!adaptiveWidth) return at(distance, lane)
    const [right, left] = stoneMargins(distance)
    return at(distance, lane + (right * (.5 - lane) - left * (.5 + lane)) * adaptiveWidth)
  }
  const lanes = eroded ? [-.5, -.36, -.21, -.04, .15, .30, .43, .5] : [-.5, -.31, -.09, .15, .34, .5]
  const fronts = Array.from({ length: count + 1 }, (_, i) => {
    const offset = eroded && i > 0 && i < count ? depth * (random(i, 'bed run') - .5) * .30 : 0
    const center = landing + i * depth + offset
    return lanes.map((lane, j) => {
      const middle = j > 0 && j < lanes.length - 1
      const shift = i === count ? 0 : depth * ((random(i, 'skew') - .5) * (eroded ? .62 : .23) * lane + (middle ? (random(i, `nick/${j}`) - .5) * (eroded ? .39 : .22) : 0))
      return { point: stonePoint(center + shift, lane), distance: center + shift, lane }
    })
  })
  const edge = (a: number, b: number, side: number, project = stonePoint): PointMm[] =>
    [project(a, side), ...stations.filter(s => s > a + 1e-6 && s < b - 1e-6).map(s => project(s, side)), project(b, side)]
  const first = fronts[0], approachRight = edge(0, first[0].distance, -.5), approachLeft = edge(0, first.at(-1)!.distance, .5)
  const landings = fitsBedding ? [] : [
    { elevationMm: lowMm, polygonMm: [...approachRight, ...first.slice(1, -1).map(row => row.point), ...approachLeft.toReversed()] },
    { elevationMm: highMm, polygonMm: patch(length - highLanding, length) },
  ]
  const elevations = Array.from({ length: count + 1 }, (_, i) => lowMm + rise * (i + (i > 0 && i < count ? (random(i, 'rise') - .5) * .17 : 0)) / count)
  const treads = Array.from({ length: count }, (_, i) => {
    const front = fronts[i], rear = fronts[i + 1], start = landing + i * depth
    const right = edge(front[0].distance, rear[0].distance, -.5), left = edge(front.at(-1)!.distance, rear.at(-1)!.distance, .5)
    const polygonMm = [right[0], ...right.slice(1, -1), ...rear.map(row => row.point), ...left.slice(1, -1).reverse(), ...front.slice(1).reverse().map(row => row.point)]
    const noseDepth = Math.min(depth * .20, Math.max(30, (elevations[i + 1] - elevations[i]) * .51))
    const lip = front.map(row => stonePoint(row.distance + noseDepth, row.lane))
    const side = random(i, 'cleave') < .5 ? -1 : 1, cleave = side * (.12 + random(i, 'split') * .22)
    const fissure = [stonePoint(start + depth * .22, cleave), stonePoint(start + depth * .54, cleave - side * .068), stonePoint(start + depth * .90, cleave - side * .029)]
    const joint = [...fissure, ...fissure.map((_, j) => stonePoint(start + depth * [.22, .54, .90][j], cleave - side * [.024, .086, .034][j])).reverse()]
    const facet = [stonePoint(start + depth * .34, side * .48), stonePoint(start + depth * .28, side * .21),
      stonePoint(start + depth * .63, side * .12), stonePoint(start + depth * .83, side * .34), stonePoint(start + depth * .77, side * .48)]
    const scuffs = Array.from({ length: 4 }, (_, j) => {
      const lane = random(i, `wear/${j}/lane`) * .77 - .385, center = start + depth * (.30 + random(i, `wear/${j}/station`) * .43)
      const wide = .013 + random(i, `wear/${j}/width`) * .027, length = depth * (.03 + random(i, `wear/${j}/length`) * .13)
      return [stonePoint(center - length, lane + wide), stonePoint(center, lane - wide),
        stonePoint(center + length, lane), stonePoint(center + length * .30, lane + wide * .49)]
    })
    return { polygonMm, front: front.map(row => row.point), lip, sides: [right, left], joint, facet, scuffs,
      colorVariation: (random(i, 'stone') - .5) * (eroded ? .29 : .16), split: random(i, 'has joint') > .33,
      lowerMm: elevations[i], upperMm: elevations[i + 1] }
  })
  const bedding = fitsBedding ? { pointAt: fullWidthPoint, stations, lengthMm: length, startMm: landing, endMm: length - highLanding } : undefined
  return { treads, landings, depthMm: depth, lowMm, highMm, eroded, bedding }
}

export function weatheredStepColor(tint: string | null | undefined, shade: number): string {
  const rock = tint ?? '#AAA38E'
  return '#' + [1, 3, 5].map(i => Math.round(Math.min(255, Math.max(0, parseInt(rock.slice(i, i + 2), 16) * shade))).toString(16).padStart(2, '0')).join('')
}
