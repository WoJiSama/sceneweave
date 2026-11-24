import type { PointMm, TerrainArea } from '../model/scene.js'
import type { ExecutionBudget } from '../budget/task-budget.js'
import { distanceToSegment, pointInPolygon } from '../geometry/geometry.js'
import { createTerrainRelief, reliefBounds } from '../geometry/terrain-relief.js'
import { terrainRandomUnit, terrainValueNoise } from './field.js'

const clamp = (t: number) => Math.max(0, Math.min(1, t))
const smooth = (t: number) => { const a = clamp(t); return a * a * (3 - 2 * a) }
const mix = (a: number, b: number, t: number) => a + (b - a) * t
const bell = (point: number, center: number, width: number) => Math.exp(-(((point - center) / width) ** 2))

/** One headland and a deep adjacent bay, with the ridge following the headland
 * toward its tip. Broad offsets are decided before building shoreline bands. */
export function coastSkeletonV9({ seed, widthMm: width, heightMm: height }: {
  seed: string; widthMm: number; heightMm: number
}) {
  const east = terrainRandomUnit(seed, 'coast-v9/cape-side') < .5
  const size = Math.min(width / 24000, height / 18000)
  const cape = .33 + (terrainRandomUnit(seed, 'coast-v9/cape-position') - .5) * .076
  const bay = .70 + (terrainRandomUnit(seed, 'coast-v9/bay-position') - .5) * .075
  const drift = cape - .33
  const uAt = (x: number) => east ? 1 - x / width : x / width
  const point = (x: number, y: number): PointMm => ({ x: Math.round((east ? 1 - x : x) * width), y: Math.round(y * height) })
  const sandWidth = (u: number) => .042 + .047 * bell(u, bay, .175) + .017 * terrainValueNoise(seed, 'coast-v9/dunes', u * 6, 0)
  const depth = (terrainRandomUnit(seed, 'coast-v9/bay-depth') - .5) * .068
  const shore = (u: number) => .46 - .267 * bell(u, cape, .139) - .042 * bell(u, cape - .07, .048)
    + (.16 + depth) * bell(u, bay, .172) - .088 * bell(u, .976, .14)
    + terrainValueNoise(seed, 'coast-v9/shoulders', u * 6.4, .23) * .013
    + terrainValueNoise(seed, 'coast-v9/coves', u * 12, .38) * .006
  const yAt = (x: number) => height * shore(uAt(x))
  const ridge = [[.23,.67,2730],[.305,.59,3250],[.346,.484,3300],[.358,.396,2320],[.344,.342,1790]]
    .map(([x,y,radius]) => ({ ...point(x + drift,y), radius: radius * size }))
  return {
    name: east ? '东岬潮湾' : '西岬潮湾',
    bayDirection: { x: east ? -1 : 1, y: 0 },
    field: (x: number, y: number) => Math.round(y - yAt(x)),
    duneAt: (x: number) => Math.round(yAt(x) + height * sandWidth(uAt(x))),
    shallowsWidth: (x: number) => height * (.034 + .025 * bell(uAt(x), bay, .17)
      + .014 * terrainValueNoise(seed, 'coast-v9/water-shelves', uAt(x) * 10, .18)),
    shorelineAt: yAt,
    plateauCenter: point(.31 + drift,.58),
    ridge,
  }
}

export function shapeCoastalRidge(area: TerrainArea, low: TerrainArea, upperLanding: PointMm,
  activity: { boundaryMm: PointMm[] }, seed: string, meter?: ExecutionBudget) {
  const outline = area.boundaryMm.map(point => point.positionMm), box = reliefBounds(outline)
  const edgeDistance = (p: PointMm, ring: PointMm[]) => Math.min(...ring.map((a, i) => distanceToSegment(p, a, ring[(i + 1) % ring.length])))
  const size = Math.min(box.width / 9800, box.height / 11800)
  const clearance = Math.max(1200, 550 * size)
  const lower = low.groundElevationMm, datum = area.groundElevationMm
  const relief = createTerrainRelief(box, p => {
    const edge = edgeDistance(p, outline)
    const t = smooth(edge / (2600 * size))
    const ridgeNoise = terrainValueNoise(seed, 'coast-v9/ridge', p.x / (2600 * size), p.y / (4700 * size))
    const ledgeNoise = terrainValueNoise(seed, 'coast-v9/ledge', p.x / (1200 * size), p.y / (900 * size))
    const peak = datum + size * (650 + ridgeNoise * 780 + ledgeNoise * 210)
    const cliff = lower + size * (245 + ridgeNoise * 225)
    const landing = smooth((Math.hypot(p.x - upperLanding.x, p.y - upperLanding.y) - clearance) / (950 * size))
    const terrace = pointInPolygon(p, activity.boundaryMm) ? 0 : smooth((edgeDistance(p, activity.boundaryMm) - 400) / (1000 * size))
    return Math.round(mix(datum, mix(cliff, peak, t), Math.min(landing, terrace)) - datum) || 0
  }, Math.max(420, 350 * size))
  meter?.charge({ gridNodes: relief.offsetsMm.length, fieldEvaluations: relief.offsetsMm.length })
  area.relief = relief
}
