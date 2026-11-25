import type { ExecutionBudget } from '../budget/task-budget.js'
import { distanceToSegment, pointInPolygon, terrainPoints } from '../geometry/geometry.js'
import { createTerrainRelief, reliefBounds, sampleTerrainRelief } from '../geometry/terrain-relief.js'
import type { Path, PointMm, TerrainArea } from '../model/scene.js'
import { terrainRandomUnit, terrainValueNoise } from './field.js'

const smooth = (value: number) => {
  const t = Math.max(0, Math.min(1, value))
  return t * t * (3 - 2 * t)
}
const edges = (points: PointMm[], closed: boolean) => points.slice(0, points.length - Number(!closed))
  .map((point, index) => [point, points[(index + 1) % points.length]] as const)

/** Continue the apron beyond the upper surface boundary without lifting the shore or trail. */
export function shapeCoastalFootSlope(area: TerrainArea, bench: TerrainArea, trail: Path,
  center: PointMm, toe: PointMm, scale: number, meter?: ExecutionBudget) {
  const outline = terrainPoints(area), bounds = reliefBounds(outline)
  const shore = edges(outline, true), road = edges(trail.centerlineMm, false)
  const dx = toe.x - center.x, dy = toe.y - center.y, axis = Math.hypot(dx, dy) * scale
  const rise = (bench.groundElevationMm - area.groundElevationMm) * .38
  const cell = Math.round(510 * scale)
  let intersectionPairs = 0
  const relief = createTerrainRelief(bounds, point => {
    const x = point.x - toe.x, y = point.y - toe.y
    const down = (x * dx + y * dy) / axis, across = (x * dy - y * dx) / axis
    const spread = smooth(1 - (down / (down > 0 ? 3250 : 2180)) ** 2 - (across / 3150) ** 2)
    if (!spread) return 0
    intersectionPairs += road.length
    const clearance = Math.min(...road.map(([a, b]) => distanceToSegment(point, a, b))) - trail.widthMm * .58
    const pastTrail = smooth((clearance - cell * Math.SQRT2) / (710 * scale))
    if (!pastTrail) return 0
    intersectionPairs += outline.length
    if (!pointInPolygon(point, outline)) return 0
    intersectionPairs += shore.length
    const shoreDistance = Math.min(...shore.map(([a, b]) => distanceToSegment(point, a, b)))
    return rise * spread * pastTrail * smooth((shoreDistance - cell * Math.SQRT2) / (960 * scale))
  }, cell)
  const samples = relief.offsetsMm.length
  meter?.charge({ gridNodes: samples, fieldEvaluations: samples, intersectionPairs })
  area.relief = relief
}

/** Anchor the usable landings and tread approaches. Long eroded sectors on
 * each face meet the foot slope, leaving the stronger rock exposures between them. */
export function shapeErodedCoastalRock(area: TerrainArea, below: TerrainArea, trail: Path, clearing: PointMm[] | undefined,
  seed: string, scale: number, direction: number, slopeToe?: PointMm, meter?: ExecutionBudget) {
  const ridge = terrainPoints(area), bounds = reliefBounds(ridge), rim = edges(ridge, true)
  const road = edges(trail.centerlineMm, false), clearingEdges = clearing ? edges(clearing, true) : []
  const cell = Math.round(335 * scale), lowerBounds = reliefBounds(terrainPoints(below))
  const drop = area.groundElevationMm - below.groundElevationMm
  const phase = (terrainRandomUnit(seed, `${area.id}/erosion direction`) - .5) * .84 + (clearing ? .19 : -.36)
  const { x, y, width, height } = bounds
  const shape = createTerrainRelief(bounds, point => {
    if (clearing && pointInPolygon(point, clearing)) return 0
    const roadDistance = Math.min(...road.map(([a, b]) => distanceToSegment(point, a, b))) - trail.widthMm * .69
    const clearingDistance = Math.min(...clearingEdges.map(([a, b]) => distanceToSegment(point, a, b))) - 115
    const awayFromPath = smooth((Math.min(roadDistance, clearingDistance) - cell * 1.30) / (950 * scale))
    if (!awayFromPath) return 0
    const u = ((point.x - x) / width - .5) * -direction, v = (point.y - y) / height - .5
    const bearing = Math.atan2(v, u) + phase
    const fold = terrainValueNoise(seed, 'coastal rock beds', (point.x + .48 * point.y) / (2300 * scale), point.y / (1620 * scale))
    const small = terrainValueNoise(seed, 'coastal rock fractures', point.x / (685 * scale), point.y / (540 * scale))
    const crossSlope = .17 * Math.sin(bearing * 4 + .8) + .19 * Math.sin(bearing * 3)
    const rock = smooth((.38 + .41 * Math.cos(2 * bearing + (clearing ? .97 : 0)) + crossSlope + .14 * fold - .22) / .61)
    const rimDistance = Math.min(...rim.map(([a, b]) => distanceToSegment(point, a, b)))
    const bed = smooth(rimDistance / ((clearing ? 2100 : 2350) * scale))
    const lower = below.relief ? sampleTerrainRelief(below.relief, lowerBounds, point).offsetMm : 0
    const foot = lower - drop + (36 + (16 + small * 24) * scale)
    const washed = slopeToe ? smooth(1.68 - Math.hypot((point.x - slopeToe.x) / (1740 * scale), (point.y - slopeToe.y) / (2040 * scale))) : 0
    const opening = (1 - rock * (1 - washed)) * (1 - bed)
    const back = (clearing ? 370 : 220) + drop * (.16 * fold + .065 * small)
    return awayFromPath * (back * (1 - opening) + foot * opening)
  }, cell)
  const samples = shape.offsetsMm.length
  meter?.charge({ gridNodes: samples, fieldEvaluations: samples * 3,
    intersectionPairs: samples * (road.length + clearingEdges.length + rim.length) })
  area.relief = shape
}
