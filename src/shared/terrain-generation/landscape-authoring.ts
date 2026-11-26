import type { ExecutionBudget } from '../budget/task-budget.js'
import { connectionArcFrame } from '../geometry/connection-route.js'
import { sampleAnchoredRoad } from '../geometry/automatic-road.js'
import { landmarkRoutes, reachesLandmarkSide } from '../geometry/landmark-route.js'
import { distanceToSegment, pointInPolygon, polygonInside, polygonsOverlap, polygonValid, polylineBand, segmentCuts, terrainPoints } from '../geometry/geometry.js'
import { createRoadGround, assertRoadProfile } from '../geometry/road-domain.js'
import { gradeRoadSurface } from '../geometry/road-grading.js'
import { AUTOMATIC_ROAD_VERSION, ROAD_LANDING_MIN_MM, RoadFootprintConflict, RoadProfileConflict } from '../geometry/road-surface.js'
import { createTerrainRelief, reliefBounds, reliefGridPoint, sampleTerrainRelief } from '../geometry/terrain-relief.js'
import { checkGradedRoadOnValidScene, type TerrainTravelIssue } from '../geometry/terrain-travel.js'
import { splitNewTerrainJunctions } from '../geometry/terrain-junctions.js'
import { indexEdges, observeGeometryPairs } from '../geometry/edge-index.js'
import type { BoundsMm, Floor, Path, PointMm, SceneDocument, TerrainArea } from '../model/scene.js'
import { WATER_PRESETS } from '../ocean/contracts.js'
import { defaultStaircase } from '../stairs/contracts.js'
import { defaultMaterialPaint } from '../appearance/surface-paint.js'
import { SHORE_MATERIAL_IDS } from '../visual/shore-art.js'
import { signedVisualArea } from '../visual/geometry.js'
import { OperationRejected } from '../validation/operation-rejection.js'
import { terrainRandomUnit, terrainValueNoise } from './field.js'
import { terrainLandscapeCourses } from './landscape-route-search.js'
import type { MapAscentRoute, MapLandscapeRecipe, MapLandscapeRoute } from '../generation/map-authoring.js'

export const LANDSCAPE_VERSION = 5
export const LANDSCAPE_WATER_ID = 'landscape/water'
export const ASCENT_APPROACH_MM = 650
type Landform = MapLandscapeRecipe['landforms'][number]
type Route = Extract<MapLandscapeRoute, { via: unknown }> & { minRiseMm?: number; flight?: boolean; protectedForms?: Landform[] }
type Frame = { point: (p: PointMm) => PointMm; size: (p: PointMm) => PointMm }
type HeightAt = (p: PointMm) => number
type PreparedRoute = ReturnType<typeof prepareRoute>
export type LandscapeRoadFailure = { id: string; fromMm: PointMm; toMm: PointMm; landmarkId?: string; widthMm: number; issues: TerrainTravelIssue[]; graded?: number }
class NoLandscapeRoad extends OperationRejected {
  constructor(readonly details: LandscapeRoadFailure) {
    super('invalid_geometry', details.issues.map(issue => issue.message).join('；'))
  }
}
class LandscapeRoadProfileError extends OperationRejected {
  constructor(readonly issue: TerrainTravelIssue) { super('invalid_geometry', issue.message) }
}
const clamp = (x: number) => Math.max(0, Math.min(1, x))
const smooth = (x: number) => { const t = clamp(x); return t * t * (3 - 2 * t) }
const mix = (a: number, b: number, t: number) => a + (b - a) * t
const heightError = (id: string, message: string) => new OperationRejected('invalid_geometry', `「${id}」：${message}`)
const round = ({ x, y }: PointMm) => ({ x: Math.round(x), y: Math.round(y) })
const fits = (p: PointMm, b: BoundsMm) => p.x >= b.x && p.y >= b.y && p.x <= b.x + b.width && p.y <= b.y + b.height
const asEdges = (points: PointMm[]) => points.map((a, i) => [a, points[(i + 1) % points.length]] as const)

export function landscapePaint(scene: SceneDocument, key: keyof typeof SHORE_MATERIAL_IDS, tint: string | null = null) {
  const material = scene.materials[SHORE_MATERIAL_IDS[key]]
  if (!material) throw new Error(`缺少固定地表材质「${key}」。`)
  return { ...defaultMaterialPaint(material), tint }
}

export function landscapeEllipse(at: PointMm, radius: PointMm, count: number, angle = 0, waviness: (a: number) => number = () => 1) {
  const sin = Math.sin(angle), cos = Math.cos(angle)
  return Array.from({ length: count }, (_, i) => {
    const a = i * 2 * Math.PI / count, r = waviness(a), x = Math.cos(a) * radius.x * r, y = Math.sin(a) * radius.y * r
    return round({ x: at.x + x * cos - y * sin, y: at.y + x * sin + y * cos })
  })
}

function newArea(id: string, floorId: string, points: PointMm[], elevation: number, priority: number,
  surfaceStyle: TerrainArea['surfaceStyle'], blocksMovement = false): TerrainArea {
  return { id, floorId, visibility: 'public', editLocked: false, groundElevationMm: elevation, coveragePriority: priority,
    blocksMovement, blocksSight: false, movementCostMultiplier: 1, surfaceStyle,
    boundaryMm: points.map((positionMm, i) => ({ positionMm, id: `${id}:point:${i}`, segmentId: `${id}:segment:${i}` })) }
}

function landformWeight(form: Landform, p: PointMm, seed: string) {
  const angle = form.rotationDeg * Math.PI / 180, sin = Math.sin(angle), cos = Math.cos(angle)
  const dx = p.x - form.at.x, dy = p.y - form.at.y
  const x = (dx * cos + dy * sin) / form.radius.x, y = (dy * cos - dx * sin) / form.radius.y
  const distance = Math.hypot(x, y)
  // Give different sides a shoulder, a gully or a steeper face while pinning the authored center.
  const bearing = Math.atan2(y, x)
  const top = form.shape === 'plateau' ? .50 : form.shape === 'ridge' ? .22 : form.shape === 'lowland' ? .36 : .21
  const phase = terrainRandomUnit(seed, form.id) * 2 * Math.PI
  const asymmetry = .13 * Math.sin(bearing * 3 + phase) + .075 * Math.cos(bearing * 5 - phase)
  const rim = form.shape === 'plateau' ? 1.00 : 1.15
  const falloff = smooth((distance - top) / (rim + asymmetry - top))
  return 1 - falloff
}

function prepareRoute(route: Route, field: HeightAt) {
  const anchors = route.via.map(row => row.at)
  const centerlineMm = sampleAnchoredRoad(anchors)
  const frame = connectionArcFrame(centerlineMm)
  const positions = route.via.map((row, index) => {
    const i = centerlineMm.findIndex(p => p.x === row.at.x && p.y === row.at.y)
    if (i < 0) throw heightError(route.id, `无法保留第 ${index + 1} 个途经点。`)
    const endpoint = index === 0 || index === route.via.length - 1
    return { ...row, station: frame.distances[i],
      z: row.elevationMm ?? (endpoint || route.style === 'trail' ? Math.round(field(row.at)) : undefined) }
  })
  const control = positions.map((row, index) => {
    if (row.z !== undefined) return { ...row, z: row.z }
    const before = positions.slice(0, index).findLast(p => p.z !== undefined)!
    const after = positions.slice(index + 1).find(p => p.z !== undefined)!
    return { ...row, z: Math.round(mix(before.z!, after.z!, (row.station - before.station) / (after.station - before.station))) }
  })
  if (control[0].landingMm || control.at(-1)!.landingMm) throw heightError(route.id, '首尾是接地端，歇脚平台请设在中间途经点。')
  const flight = route.flight && route.style === 'stairs' ? Math.max(0, Math.abs(control.at(-1)!.z - control[0].z) * 2) : 0
  const scale = flight ? Math.min(.80, flight / frame.length) : 0
  const shapeHeight = (station: number) => {
    const fraction = station / frame.length
    if (!scale) return fraction
    const start = (1 - scale) * .46
    return .15 * fraction + .85 * clamp((fraction - start) / scale)
  }
  if (flight) {
    const first = control[0].z, last = control.at(-1)!.z
    for (const row of control.slice(1, -1)) row.z = Math.round(mix(first, last, shapeHeight(row.station)))
  }
  const profile = (station: number) => {
    const next = control.findIndex((row, i) => i > 0 && row.station >= station)
    const a = control[(next < 0 ? control.length - 1 : next) - 1], b = next < 0 ? control.at(-1)! : control[next]
    const cap = (row: typeof a) => (row.landingMm ?? (row.station === 0 || row.station === frame.length ? 1650 : 0)) / 2
    const start = a.station + cap(a), end = b.station - cap(b), length = end - start
    if (length <= 0) return station <= (a.station + b.station) / 2 ? a.z : b.z
    const t = clamp((station - start) / length), ratio = Math.abs(b.z - a.z) / length
    if (route.style !== 'stairs' || length < 4000 || ratio < .035 || ratio > .27) return mix(a.z, b.z, t)
    // Place the steep part locally. The intervening length reads as a trail or landing.
    const run = clamp(.83 * ratio / (route.minRiseMm ? .38 : .32))
    const steep = clamp((t - (1 - run) * .48) / run)
    return mix(a.z, b.z, .83 * steep + .17 * t)
  }
  const segments = centerlineMm.slice(1).map((b, i) => {
    const a = centerlineMm[i], dx = b.x - a.x, dy = b.y - a.y, length = frame.distances[i + 1] - frame.distances[i]
    return { a, b, dx, dy, length, start: frame.distances[i] }
  })
  return { route, anchors, centerlineMm, control, segments, profile }
}

/** Keep each control point on the coast. Rounded transitions are local, so a
 * long side does not create a wide spline overshoot at a nearby short inlet. */
function smoothOutline(points: PointMm[], bounds: BoundsMm, touchesNeighbor: (a: PointMm, b: PointMm) => boolean, natural: boolean): PointMm[] {
  const hasRoom = (p: PointMm) => fits(p, bounds)
  const smoothed = (strength: number) => {
    let remaining = 2048 - points.length
    return points.flatMap((a, i) => {
      const b = points[(i + 1) % points.length], previous = points[(i + points.length - 1) % points.length]
      if (touchesNeighbor(a, b)) return [a]
      const next = points[(i + 2) % points.length]
      const length = Math.hypot(b.x - a.x, b.y - a.y)
      const tangent = (from: PointMm, to: PointMm, reach: number) => {
        const dx = to.x - from.x, dy = to.y - from.y, distance = Math.hypot(dx, dy)
        return distance ? { x: dx * reach / distance, y: dy * reach / distance } : { x: 0, y: 0 }
      }
      const ta = tangent(previous, b, Math.min(length, Math.hypot(a.x - previous.x, a.y - previous.y)) / 3)
      const tb = tangent(a, next, Math.min(length, Math.hypot(b.x - next.x, b.y - next.y)) / 3)
      // Add enough samples to show the transition at map scale, preserving
      // the original anchors and the exact shared or cropped segments.
      const count = Math.min(4, Math.max(natural ? 1 : 2, Math.ceil(length / (natural ? 1100 : 1450))), remaining + 1)
      if (count < 2) return [a]
      for (const scale of [strength, strength * .35]) {
        const segment = Array.from({ length: count + 1 }, (_, index) => {
          const t = index / count, k = 1 - t
          const first = 3 * k * k * t * scale, last = 3 * k * t * t * scale
          return round({ x: mix(a.x, b.x, t * t * (3 - 2 * t)) + first * ta.x - last * tb.x,
            y: mix(a.y, b.y, t * t * (3 - 2 * t)) + first * ta.y - last * tb.y })
        })
        if (segment.every(hasRoom) && segment.slice(1).every((p, index) =>
          (p.x !== segment[index].x || p.y !== segment[index].y) && !touchesNeighbor(segment[index], p))) {
          remaining -= count - 1
          return segment.slice(0, -1)
        }
      }
      return [a]
    })
  }
  for (const strength of [1, .45]) {
    const ring = smoothed(strength)
    if (polygonValid(ring, true)) return ring
  }
  return points
}

function routeShape(base: HeightAt, routes: ReturnType<typeof prepareRoute>[], cell: number): HeightAt {
  const indexed = routes.map(plan => ({
    ...plan, find: indexEdges(plan.segments.map(({ a, b }) => [a, b])),
    influence: plan.route.widthMm / 2 + cell * 1.9 + 6200,
    pins: plan.route.protectedForms?.flatMap(form => {
      const distance = Math.min(...plan.segments.map(({ a, b }) => distanceToSegment(form.at, a, b)))
      const reserve = distance - plan.route.widthMm / 2 - cell * 2.1
      return reserve > cell * 1.2 ? [{ at: form.at, radius: Math.min(reserve, Math.max(cell * 1.6, Math.min(form.radius.x, form.radius.y) * .38)) }] : []
    }) ?? [],
  }))
  return p => {
    const original = base(p)
    let nearest = Infinity, width = 0, z = original, pins: typeof indexed[number]['pins'] = []
    for (const { segments, route, profile, find, influence, pins: routePins } of indexed) {
      const possible = find(p, p, influence)
      observeGeometryPairs(possible.length)
      for (const i of possible) {
        const { a, dx, dy, length, start } = segments[i]
        const fraction = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / (length * length))
        const distance = Math.hypot(p.x - a.x - fraction * dx, p.y - a.y - fraction * dy)
        if (distance < nearest) { nearest = distance; width = route.widthMm; z = profile(start + fraction * length); pins = routePins }
      }
    }
    const inner = width / 2 + cell * 1.55
    const transition = Math.min(6200, 2500 + Math.abs(z - original) * .24)
    const natural = pins.reduce((weight, pin) => Math.max(weight, 1 - smooth(Math.hypot(p.x - pin.at.x, p.y - pin.at.y) / pin.radius)),
      smooth((nearest - inner) / transition))
    return mix(z, original, natural)
  }
}

function protectedReliefNodes(grid: NonNullable<TerrainArea['relief']>, bounds: BoundsMm, cell: number, plan: PreparedRoute, meter: ExecutionBudget) {
  const protectedNodes = new Set<number>()
  for (const form of plan.route.protectedForms ?? []) {
    const u = (form.at.x - bounds.x) * (grid.columns - 1) / bounds.width
    const v = (form.at.y - bounds.y) * (grid.rows - 1) / bounds.height
    const col = Math.min(grid.columns - 2, Math.max(0, Math.floor(u))), row = Math.min(grid.rows - 2, Math.max(0, Math.floor(v)))
    const corners = [[col, row], [col + 1, row], [col, row + 1], [col + 1, row + 1]]
    meter.charge({ fieldEvaluations: corners.length * plan.segments.length })
    const clear = corners.every(([x, y]) => {
      const p = reliefGridPoint(grid, bounds, x, y)
      return plan.segments.every(({ a, b }) => distanceToSegment(p, a, b) > plan.route.widthMm / 2 + cell * 1.45)
    })
    // Keep the exact interpolation cell outside the road's support.
    // The trial still validates the resulting full-width band.
    if (clear) for (const [x, y] of corners) protectedNodes.add(y * grid.columns + x)
  }
  return protectedNodes
}

/** Plan a flat bend wherever there is enough distance for a platform and its approaches. */
export function landscapeRouteAnchors(anchors: PointMm[], style: Route['style'], widthMm: number): Route['via'] {
  return anchors.map((at, i) => {
    if (style === 'trail' || !i || i === anchors.length - 1) return { at }
    const before = anchors[i - 1], after = anchors[i + 1]
    const dx = at.x - before.x, dy = at.y - before.y, ex = after.x - at.x, ey = after.y - at.y
    const enter = Math.hypot(dx, dy), leave = Math.hypot(ex, ey), available = Math.min(enter, leave)
    if (dx * ex + dy * ey > enter * leave * .96 || available < 1900) return { at }
    const landingMm = Math.round(Math.min(1600, Math.max(ROAD_LANDING_MIN_MM, widthMm * .72), available * .47))
    return { at, landingMm }
  })
}

/** Fit a new road into an existing editable relief without resampling the
 * terrain lattice. The edge samples are retained at shared shore and cliff joins. */
export function gradeLandscapeRouteRelief(area: TerrainArea, route: Route, meter: ExecutionBudget) {
  const points = terrainPoints(area), bounds = reliefBounds(points), grid = area.relief
  if (!grid || area.rockBody) throw new Error('现有承托地形需要使用普通编辑器重塑。')
  const base = (p: PointMm) => area.groundElevationMm + sampleTerrainRelief(grid, bounds, p).offsetMm
  return gradeRouteRelief(area, prepareRoute(route, base), meter, true)
}

function gradeRouteRelief(area: TerrainArea, plan: ReturnType<typeof prepareRoute>, meter: ExecutionBudget, keepEdges: boolean) {
  const points = terrainPoints(area), bounds = reliefBounds(points), grid = area.relief!
  const base = (p: PointMm) => area.groundElevationMm + sampleTerrainRelief(grid, bounds, p).offsetMm
  const cell = Math.max(bounds.width / (grid.columns - 1), bounds.height / (grid.rows - 1))
  const height = routeShape(base, [plan], cell)
  const protectedNodes = protectedReliefNodes(grid, bounds, cell, plan, meter)
  const edgeIndex = keepEdges ? indexEdges(asEdges(points)) : undefined
  meter.charge({ fieldEvaluations: grid.offsetsMm.length * (keepEdges ? 3 : 2) })
  const offsetsMm = grid.offsetsMm.map((previous, index) => {
    if (protectedNodes.has(index)) return previous
    const p = reliefGridPoint(grid, bounds, index % grid.columns, Math.floor(index / grid.columns))
    const neighbors = edgeIndex?.(p, p, cell * 1.5) ?? []
    observeGeometryPairs(neighbors.length)
    if (neighbors.length) return previous
    return Math.round(height(p) - area.groundElevationMm)
  })
  return { ...grid, offsetsMm }
}

function baseHeight(area: TerrainArea, points: PointMm[], forms: Landform[], coastal: boolean, seed: string, natural: boolean, beachRiseMm: number): HeightAt {
  const outline = asEdges(points), find = coastal ? indexEdges(outline) : undefined
  const lows = forms.filter(form => form.shape === 'lowland')
  const retained = forms.filter(form => form.preserveRelief || natural && form.shape !== 'lowland' && lows.some(low =>
    form.elevationMm > low.elevationMm + 250 && form.radius.x * form.radius.y < low.radius.x * low.radius.y * .55
    && landformWeight(low, form.at, seed) > .27))
  const raised = forms.filter(form => form.shape !== 'lowland' && !retained.includes(form))
  const kept = retained.map(form => ({ form, lowPins: natural ? lows.flatMap(low => {
    const distance = Math.hypot(form.at.x - low.at.x, form.at.y - low.at.y), core = Math.min(form.radius.x, form.radius.y)
    return distance >= core * .64 && landformWeight(form, low.at, seed) > 0
      ? [{ at: low.at, radius: Math.min(distance * .42, core * .50) }] : []
  }) : [] }))
  return p => {
    let distance = 4700
    const candidates = find?.(p, p, distance) ?? []
    observeGeometryPairs(candidates.length)
    for (const i of candidates) distance = Math.min(distance, distanceToSegment(p, ...outline[i]))
    const inside = smooth(distance / 4700)
    const fold = terrainValueNoise(seed, `${area.id}/fold`, p.x / 6900, p.y / 5900)
    const seam = terrainValueNoise(seed, `${area.id}/seam`, p.x / 2050, p.y / 1730)
    const datum = area.groundElevationMm + inside * (beachRiseMm + (coastal ? 590 : 250) * (1 + .68 * fold + .21 * seam))
    let high = datum, still = 0
    for (const form of raised) {
      const weight = landformWeight(form, p, seed)
      high = Math.max(high, mix(datum, form.elevationMm, weight))
      still = Math.max(still, smooth((weight - .82) / .18))
    }
    high += (1 - still) * inside * (natural ? fold * 960 + seam * 420 : fold * 670 + seam * 260) * clamp((high - datum) / 5800)
    for (const form of lows) high = mix(high, form.elevationMm, landformWeight(form, p, seed))
    const basin = high
    for (const { form, lowPins } of kept) {
      const weight = lowPins.reduce((gain, pin) => gain * smooth(Math.hypot(p.x - pin.at.x, p.y - pin.at.y) / pin.radius), landformWeight(form, p, seed))
      high = Math.max(high, mix(basin, form.elevationMm, weight))
    }
    return coastal ? Math.max(80, high) : high
  }
}

function landscapeRoad(scene: SceneDocument, areaId: string, floor: Floor, plan: PreparedRoute): Path {
  const { route, centerlineMm, anchors, control } = plan
  const path = { centerlineMm, widthMm: route.widthMm }
  const turnConflict = (at: PointMm) => {
    throw new LandscapeRoadProfileError(roadIssue(route.id, 'LANDSCAPE_ROAD_TURN', '道路净宽带在转角处折返或相交。请拉开两个途经点。', at))
  }
  if (!polygonValid(polylineBand(centerlineMm, route.widthMm, true), true, turnConflict)) turnConflict(anchors[0])
  const ground = createRoadGround(scene, floor.id, route.id)
  const at = (point: PointMm) => ground.sample(point)?.zMm ?? null
  const landings = control.flatMap(row => row.landingMm ? [{ pointMm: row.at, lengthMm: row.landingMm, elevationMm: Math.round(at(row.at) ?? row.z) }] : [])
  try {
    const roadSurface = gradeRoadSurface(path, anchors, landings, at)
    const { refs } = assertRoadProfile(path, roadSurface, landings, anchors, ground)
    if (!refs.some(ref => ref.kind === 'terrainArea' && ref.id === areaId)) throw new Error(`路线须落在指定地形「${areaId}」。`)
    if (route.style === 'stairs' && !roadSurface.stations.some(station => station.outZMm)) {
      throw new Error('实际纵坡未形成踏步。可集中部分高差，或把路线设为普通步道。')
    }
    const desiredRise = control.at(-1)!.z - control[0].z
    if (route.style === 'stairs' && desiredRise) {
      const first = roadSurface.stations[0].inZMm, last = roadSurface.stations.at(-1)!.inZMm
      if (Math.sign(last[0] + last[1] - first[0] - first[1]) !== Math.sign(desiredRise)) {
        throw new Error('台阶道路实际升降方向与起终点高程不符。请确认起点和终点锚点。')
      }
    }
    return { ...path, id: route.id, floorId: floor.id, editLocked: false, visibility: 'public', renderOrder: 0,
      movementCostMultiplier: 1, boundaryBlendMm: 225, supportRefs: refs, roadSurface,
      surfaceStyle: { base: landscapePaint(scene, 'sandDry', scene.terrainAreas[areaId].reliefFinish === 'weathered-v2' ? '#C8B89E' : '#D5CAB4'), overlays: [] },
      ...(roadSurface.stations.some(station => station.outZMm) ? { staircase: { ...defaultStaircase(), preset: 'rough-stone' as const, material: 'limestone' as const } } : {}),
      automaticRoute: { algorithm: AUTOMATIC_ROAD_VERSION, alignment: 'anchors-v1', fixedPointsMm: anchors,
        landings: route.around ? [] : landings, automaticStairs: true } }
  } catch (error) {
    if (error instanceof OperationRejected && error.code === 'operation_budget') throw error
    const point = error instanceof RoadProfileConflict || error instanceof RoadFootprintConflict ? error.atMm : undefined
    const code = error instanceof RoadProfileConflict ? error.reason === 'turn' ? 'LANDSCAPE_ROAD_TURN' : 'LANDSCAPE_ROAD_GRADING'
      : error instanceof RoadFootprintConflict ? 'LANDSCAPE_ROAD_SUPPORT' : 'LANDSCAPE_ROAD_PROFILE'
    throw new LandscapeRoadProfileError(roadIssue(route.id, code, error instanceof Error ? error.message : String(error), point))
  }
}

function roadIssue(id: string, code: string, message: string, atMm?: PointMm): TerrainTravelIssue {
  return { code, entityId: id, message: `「${id}」${message}`, ...(atMm ? { atMm: round(atMm) } : {}) }
}

function landscapeBandFits(id: string, band: PointMm[], outline: PointMm[], water: PointMm[][], issue: (issue: TerrainTravelIssue) => void) {
  if (!polygonInside(band, outline, at => issue(roadIssue(id, 'LANDSCAPE_ROAD_WATER', '净宽带在这里越出指定陆地。', at)))) return false
  for (const lake of water) if (polygonsOverlap(lake, band)) {
    const interior = band.find(p => pointInPolygon(p, lake)) ?? lake.find(p => pointInPolygon(p, band))
    let edge = interior
    if (!edge) {
      const shore: [PointMm, PointMm][] = lake.map((p, i) => [p, lake[(i + 1) % lake.length]])
      for (const [a, b] of asEdges(band)) {
        const t = segmentCuts(a, b, shore)[1]
        if (t < 1) { edge = { x: mix(a.x, b.x, t), y: mix(a.y, b.y, t) }; break }
      }
    }
    issue(roadIssue(id, 'LANDSCAPE_ROAD_WATER', '净宽带在这里穿过内水。', edge))
    return false
  }
  return true
}

function gradingDisturbance(course: PointMm[], widthMm: number, forms: Landform[]) {
  const reach = widthMm / 2 + 4100
  return forms.reduce((sum, form) => {
    const distance = Math.min(...course.slice(1).map((b, i) => distanceToSegment(form.at, course[i], b)))
    return sum + clamp(1 - distance / reach) ** 2
  }, 0)
}

function fitLandscapeRoad(scene: SceneDocument, floor: Floor, area: TerrainArea, route: Route, landmark: Landform | undefined,
  field: HeightAt, nearby: PreparedRoute[], meter: ExecutionBudget, water: PointMm[][], protectedForms: Landform[] = [],
  search?: { terrain: boolean; maxGrades: number }) {
  const [first, last] = route.via, points = terrainPoints(area)
  const issues = new Map<string, TerrainTravelIssue>()
  const record = (issue: TerrainTravelIssue) => {
    if (!issues.has(issue.code) || !issues.get(issue.code)?.atMm) issues.set(issue.code, issue)
  }
  const badTurn = (at: PointMm) => record(roadIssue(route.id, 'LANDSCAPE_ROAD_TURN', '净宽带在这里折返或相交。', at))
  const fits = (band: PointMm[]) => landscapeBandFits(route.id, band, points, water, record)
  const { side, radiusMm } = route.around ?? {}
  const radius = radiusMm ?? Math.max(route.widthMm * 2.2, landmark ? Math.min(landmark.radius.x, landmark.radius.y) * .70 : 0)
  const checkCourse = (course: PointMm[]) => {
    try {
      const centerline = sampleAnchoredRoad(course), band = polylineBand(centerline, route.widthMm, true)
      return polygonValid(band, true, badTurn) && fits(band)
    } catch (error) {
      if (error instanceof OperationRejected) throw error
      return false
    }
  }
  let courses: PointMm[][]
  if (landmark && side && radiusMm !== undefined && radiusMm < route.widthMm * 2.1) {
    record(roadIssue(route.id, 'LANDSCAPE_ROAD_RADIUS', `${radiusMm} mm 绕行半径不足以布置 ${route.widthMm} mm 净宽及转角。`, landmark.at))
    courses = []
  } else if (search?.terrain) {
    const box = reliefBounds(points), grid = area.relief!
    const height = (p: PointMm) => area.groundElevationMm + sampleTerrainRelief(grid, box, p).offsetMm
    courses = terrainLandscapeCourses(first.at, last.at, route.widthMm, points, water, height, meter,
      course => gradingDisturbance(course, route.widthMm, protectedForms), landmark && side ? { at: landmark.at, side, radius, fixed: radiusMm !== undefined } : undefined)
      .filter(checkCourse)
  } else {
    courses = landmark && side ? landmarkRoutes(first.at, last.at, landmark.at, side, radius, route.widthMm, fits, radiusMm === undefined, badTurn)
      : directLandscapeCourses(first.at, last.at, route.widthMm).filter(checkCourse)
  }
  if (protectedForms.length && !search?.terrain) {
    const cost = new Map(courses.map(course => [course, gradingDisturbance(course, route.widthMm, protectedForms)]))
    courses.sort((a, b) => cost.get(a)! - cost.get(b)!)
  }
  let graded = 0
  for (const course of courses.slice(0, search?.maxGrades ?? 4)) {
    graded++
    try {
      const via = landscapeRouteAnchors(course, route.style, route.widthMm)
      const plan = prepareRoute({ ...route, via: [first, ...via.slice(1, -1), last], protectedForms }, field)
      if (side && landmark && !reachesLandmarkSide(plan.centerlineMm, landmark.at, side)) continue
      const relief = gradeRouteRelief(area, plan, meter, false)
      const terrain = { ...area, relief }
      const trial = { ...scene, terrainAreas: { ...scene.terrainAreas, [area.id]: terrain }, paths: { ...scene.paths } }
      const road = landscapeRoad(trial, area.id, floor, plan)
      trial.paths[road.id] = road
      for (const other of nearby) trial.paths[other.route.id] = landscapeRoad(trial, area.id, floor, other)
      const result = checkGradedRoadOnValidScene(trial, road, route.minRiseMm ? ASCENT_APPROACH_MM : 0)
      if (!result.ok) {
        result.issues.forEach(record)
        continue
      }
      if (route.minRiseMm !== undefined && result.elevationsMm[1] - result.elevationsMm[0] < route.minRiseMm) {
        record(roadIssue(route.id, 'LANDSCAPE_ASCENT_RISE', `道路保存后的高差未达到 ${route.minRiseMm} mm。`, first.at))
        continue
      }
      const disrupted = nearby.filter(other => other.route.around)
        .map(other => checkGradedRoadOnValidScene(trial, trial.paths[other.route.id])).find(result => !result.ok)
      if (disrupted) { disrupted.issues.forEach(record); continue }
      return { plan, relief }
    } catch (error) {
      if (error instanceof OperationRejected && error.code === 'operation_budget') throw error
      record(error instanceof LandscapeRoadProfileError ? error.issue
        : roadIssue(route.id, 'LANDSCAPE_ROAD_PROFILE', error instanceof Error ? error.message : String(error)))
    }
  }
  const direction = side && ({ north: '北', east: '东', south: '南', west: '西' })[side]
  throw new NoLandscapeRoad({ id: route.id, widthMm: route.widthMm, fromMm: first.at, toMm: last.at, landmarkId: landmark?.id, issues: [
    { code: 'LANDSCAPE_ROAD_NOT_FOUND', entityId: route.id, atMm: landmark?.at ?? first.at,
      message: `「${route.id}」${landmark ? `绕「${landmark.id}」${direction}侧` : '从所选低处'}未找到 ${route.widthMm} mm 净宽的可通行路线。可调整起点区域、绕行半径或净宽。` },
    ...issues.values(),
  ], graded })
}

function directLandscapeCourses(from: PointMm, to: PointMm, widthMm: number) {
  const dx = to.x - from.x, dy = to.y - from.y, length = Math.hypot(dx, dy)
  if (!length) return []
  const bend = (station: number, offset: number) => round({
    x: from.x + dx * station - dy / length * offset,
    y: from.y + dy * station + dx / length * offset,
  })
  const courses = [[from, to]]
  for (const reach of [.17, .31, .48]) for (const sign of [1, -1]) {
    const offset = sign * Math.max(3 * widthMm, reach * length)
    courses.push([from, bend(.24, offset), bend(.70, offset * .84), to])
  }
  return courses
}

function fitLandscapeAscent(scene: SceneDocument, floor: Floor, area: TerrainArea, route: MapAscentRoute, summit: Landform,
  around: Landform | undefined, field: HeightAt, nearby: PreparedRoute[], meter: ExecutionBudget, water: PointMm[][], protectedForms: Landform[]) {
  const { from, minRiseMm } = route.ascent, outline = terrainPoints(area), box = reliefBounds(outline)
  const height = (p: PointMm) => Math.round(area.groundElevationMm + (area.relief ? sampleTerrainRelief(area.relief, box, p).offsetMm : 0))
  const allowed = (p: PointMm) => pointInPolygon(p, outline, false) && water.every(ring => !pointInPolygon(p, ring))
  const destination = { at: summit.at, elevationMm: height(summit.at) }
  const facing = route.around && {
    north: { x: 0, y: -1 }, east: { x: 1, y: 0 }, south: { x: 0, y: 1 }, west: { x: -1, y: 0 },
  }[route.around.side]
  const reach = around && (route.around?.radiusMm ?? Math.max(route.widthMm * 2.2, Math.min(around.radius.x, around.radius.y) * .7))
  const entering = facing && around && reach
    ? { x: around.at.x + facing.x * reach, y: around.at.y + facing.y * reach } : summit.at
  const samples = [from.at, ...[.50, .87].flatMap(scale => landscapeEllipse(from.at, { x: from.radius.x * scale, y: from.radius.y * scale }, 12))]
    .filter(allowed).map(at => ({ at, elevationMm: height(at) }))
  meter.charge({ fieldEvaluations: samples.length + 1 })
  const eligible = samples.filter(p => destination.elevationMm - p.elevationMm >= minRiseMm)
  const minimum = route.ascent.minWidthMm ?? route.widthMm
  const widths = minimum === route.widthMm ? [route.widthMm] : [route.widthMm, minimum]
  const failures = new Map<string, TerrainTravelIssue>()
  let totalGraded = 0
  for (const widthMm of widths) {
    const ranked = eligible.filter(p => Math.hypot(p.at.x - summit.at.x, p.at.y - summit.at.y) > widthMm * 2)
      .map(p => ({ ...p, score: p.elevationMm * .75 + Math.hypot(p.at.x - from.at.x, p.at.y - from.at.y) * .10
        + gradingDisturbance([p.at, entering], widthMm, protectedForms) * 3100 })).sort((a, b) => a.score - b.score)
    const starts: typeof ranked = []
    for (const row of ranked) {
      if (starts.every(p => Math.hypot(p.at.x - row.at.x, p.at.y - row.at.y) >= widthMm * .78)) starts.push(row)
      if (starts.length === 4) break
    }
    let remaining = widths.length === 1 ? 12 : 7
    for (const terrain of [false, true]) {
      for (const [index, start] of starts.entries()) {
        const maxGrades = Math.min(remaining, terrain ? 2 : index === 0 ? 4 : 1)
        if (!maxGrades) break
        try {
          return fitLandscapeRoad(scene, floor, area, { ...route, widthMm, via: [start, destination], minRiseMm,
            flight: route.ascent.staircase === 'flight' }, around, field, nearby, meter, water, protectedForms, { terrain, maxGrades })
        } catch (error) {
          if (!(error instanceof NoLandscapeRoad)) throw error
          const graded = error.details.graded ?? 0
          remaining -= graded
          totalGraded += graded
          for (const issue of error.details.issues) if (!failures.has(issue.code)) failures.set(issue.code, issue)
        }
      }
    }
  }
  const bestRise = samples.length ? destination.elevationMm - Math.min(...samples.map(row => row.elevationMm)) : null
  throw new NoLandscapeRoad({ id: route.id, fromMm: from.at, toMm: summit.at, landmarkId: summit.id, widthMm: route.widthMm,
    graded: totalGraded, issues: failures.size ? [...failures.values()] : [roadIssue(route.id, 'LANDSCAPE_ASCENT_START',
      bestRise === null ? '标记起步区没有落在这一块陆地上。' : bestRise < minRiseMm
        ? `起步区到地标最多升高 ${bestRise} mm，要求至少 ${minRiseMm} mm。请重新标记较低的出发区。`
        : '起步区与地标之间的距离不足以布置所需净宽及转角。', from.at)] })
}

export function shapeLandscape(scene: SceneDocument, floor: Floor, input: MapLandscapeRecipe, frame: Frame, seed: string, meter: ExecutionBudget,
  draftRoadFailures?: LandscapeRoadFailure[]) {
  const coast = input.environment === 'coast', natural = input.finish === 'natural', floorId = floor.id, bounds = floor.boundsMm
  const layers = Object.values(scene.userLayers).filter(row => row.floorId === floorId).sort((a, b) => a.order - b.order)
  const groundLayer = layers[0].id, trailsLayer = layers[1]?.id ?? groundLayer
  const addWater = (id: string, points: PointMm[], lake: boolean, elevation = 0) => {
    const water = newArea(id, floorId, points, elevation, lake ? 2 : 0,
      { base: landscapePaint(scene, lake ? 'waterShallow' : 'waterDeep'), overlays: [] }, true)
    water.waterSurface = { ...WATER_PRESETS[lake ? 'shallow' : 'calm'],
      ...(natural ? { color: lake ? '#6A9F9E' : '#4D8793', highlightColor: '#D8E8DE', clarity: .86 } : {}),
      waveSpacingMm: natural ? 2400 : 3100, waveStrength: natural ? .59 : .47, seed: `${seed.slice(0, 105)}/water` }
    scene.terrainAreas[id] = water
    scene.entityLayers[id] = groundLayer
  }
  const bottom = bounds.y + bounds.height, right = bounds.x + bounds.width
  const sea = { id: LANDSCAPE_WATER_ID, points: [
    { x: bounds.x, y: bounds.y }, { x: right, y: bounds.y }, { x: right, y: bottom }, { x: bounds.x, y: bottom },
  ] }
  const forms = input.landforms.map(row => ({ ...row, at: frame.point(row.at), radius: frame.size(row.radius) }))
  const routes = input.routes.map(row => 'via' in row ? { ...row, via: row.via.map(anchor => ({ ...anchor, at: frame.point(anchor.at) })) }
    : { ...row, ascent: { ...row.ascent, from: { at: frame.point(row.ascent.from.at), radius: frame.size(row.ascent.from.radius) } } })
  const plans: { areaId: string; plan: ReturnType<typeof prepareRoute> }[] = []
  const automatic: { area: TerrainArea; route: Route | MapAscentRoute; landmark?: Landform; summit?: Landform; profile: HeightAt }[] = []
  const fixedAreas: { area: TerrainArea; planned: PreparedRoute[]; rebuild: () => void }[] = []
  const fixedFailure = (route: Route, issue: TerrainTravelIssue) => {
    const details = { id: route.id, widthMm: route.widthMm, fromMm: route.via[0].at, toMm: route.via.at(-1)!.at, issues: [issue] }
    if (!draftRoadFailures) throw new NoLandscapeRoad(details)
    draftRoadFailures.push(details)
  }
  const landOutlines = input.land.map(row => {
    const isReef = row.form === 'reef', flat = row.form === 'flat'
    const phase = terrainRandomUnit(seed, row.id) * 6
    const noise = (a: number) => .90 + .055 * Math.sin(3 * a + phase) + .032 * Math.sin(a * 7 + 1) + .013 * Math.cos(a * 11)
    let points = row.boundary ? row.boundary.map(frame.point)
      : landscapeEllipse(frame.point(row.at!), frame.size(row.radius!), isReef ? 14 : 60, 0, row.shore === 'hard' || flat ? undefined : noise)
    if (points.length > 3 && points[0].x === points.at(-1)!.x && points[0].y === points.at(-1)!.y) points.pop()
    if (signedVisualArea(points) < 0) points = points.reverse()
    if (!points.every(p => fits(p, bounds)) || !polygonValid(points, true)) throw heightError(row.id, '轮廓超出画布、相交或存在重合点。')
    return { id: row.id, points }
  })
  const finalizedOutlines = splitNewTerrainJunctions(coast ? [...landOutlines, sea] : landOutlines)
  const outlines = finalizedOutlines.slice(0, landOutlines.length)
  if (coast) addWater(sea.id, finalizedOutlines.at(-1)!.points, false)
  const lakeRings = (input.lakes ?? []).map(({ id, areaId, boundary }) => {
    const points = boundary.map(frame.point)
    if (signedVisualArea(points) < 0) points.reverse()
    if (!polygonValid(points, true)) throw heightError(id, '内水轮廓无效。')
    return { id, areaId, points }
  })
  const outlineEdges = outlines.flatMap(({ id, points }) => asEdges(points).map(edge => ({ id, edge })))
  const findOutline = indexEdges(outlineEdges.map(row => row.edge))
  const smoothRings = outlines.map(({ id, points }, i) => {
    const row = input.land[i]
    if (!row.boundary || row.outline !== 'smooth' || row.shore === 'hard') return points
    return smoothOutline(points, bounds, (a, b) => {
      if (a.x === b.x && (a.x === bounds.x || a.x === right) || a.y === b.y && (a.y === bounds.y || a.y === bottom)) return true
      const hits = findOutline(a, b)
      observeGeometryPairs(hits.length)
      return hits.some(index => {
        const other = outlineEdges[index]
        if (other.id === id) return false
        const [c, d] = other.edge
        return segmentCuts(a, b, [[c, d]]).length > 2 || segmentCuts(c, d, [[a, b]]).length > 2
          || [a, b].every(p => distanceToSegment(p, c, d) < .001)
      })
    }, natural)
  })
  for (const [index, row] of input.land.entries()) {
    const points = smoothRings[index], isReef = row.form === 'reef', flat = row.form === 'flat'
    if (points.length > 2048) throw heightError(row.id, `共享交点加入后轮廓有 ${points.length} 个点，原生上限为 2048。`)
    const relevant = forms.filter(form => form.areaId === row.id)
    const ownRoutes = routes.filter(route => route.areaId === row.id)
    const invalid = relevant.find(form => !pointInPolygon(form.at, points, false) || Math.min(form.radius.x, form.radius.y) < 250)
    if (invalid) throw heightError(invalid.id, '地貌中心须在指定陆地内，半径换算后每轴至少 250 mm。')
    const water = lakeRings.filter(lake => lake.areaId === row.id).map(lake => lake.points)
    const key = row.cover === 'natural' ? coast ? isReef ? 'rockDry' : 'sandDry' : flat ? 'grass' : 'sandDry'
      : row.cover === 'sand' ? 'sandDry' : row.cover === 'rock' ? 'rockDry' : 'grass'
    const coastShelfMm = 640
    const beach = coast && natural && row.form === 'natural' && row.shore === 'natural' && row.elevationMm === undefined
    const elevation = row.elevationMm ?? (coast ? isReef ? 1000 : beach ? 0 : coastShelfMm : flat ? 0 : 200)
    const shapedReef = isReef && !relevant.length && !ownRoutes.length && coast
    const priority = lakeRings.some(lake => lake.areaId !== row.id && polygonInside(points, lake.points)) ? 3 : 1
    const area = newArea(row.id, floorId, points, shapedReef ? Math.min(170, elevation) : elevation,
      priority, { base: landscapePaint(scene, key), overlays: [] })
    const profile = flat && !relevant.length ? () => area.groundElevationMm : baseHeight(area, points, relevant, coast, seed, natural, beach ? coastShelfMm : 0)
    const planned: PreparedRoute[] = []
    for (const route of ownRoutes) {
      if ('via' in route) {
        const outside = route.via.find(anchor => !pointInPolygon(anchor.at, points, false) || water.some(lake => pointInPolygon(anchor.at, lake)))
        if (outside) {
          fixedFailure(route, roadIssue(route.id, 'LANDSCAPE_ROAD_WATER', '此处途经点须落在指定陆地的有效地面上。', outside.at))
          continue
        }
        if (!route.around) {
          try {
            const plan = prepareRoute(route, profile), band = polylineBand(plan.centerlineMm, route.widthMm, true)
            let issue: TerrainTravelIssue | undefined
            if (!polygonValid(band, true, at => { issue = roadIssue(route.id, 'LANDSCAPE_ROAD_TURN', '转角处的道路净宽带折返或相交。', at) })) {
              fixedFailure(route, issue ?? roadIssue(route.id, 'LANDSCAPE_ROAD_TURN', '无法生成有效的道路净宽带。', route.via[0].at))
            } else if (!landscapeBandFits(route.id, band, points, water, value => { issue = value })) {
              fixedFailure(route, issue ?? roadIssue(route.id, 'LANDSCAPE_ROAD_WATER', '道路净宽带须留在指定陆地。'))
            } else planned.push(plan)
          } catch (error) {
            if (error instanceof NoLandscapeRoad || error instanceof OperationRejected && error.code === 'operation_budget') throw error
            fixedFailure(route, roadIssue(route.id, 'LANDSCAPE_ROAD_PROFILE', error instanceof Error ? error.message : String(error)))
          }
          continue
        }
      }
      const landmark = route.around && relevant.find(form => form.id === route.around!.landmarkId)
      if (route.around && !landmark) throw heightError(route.id, '绕行地标须位于同一块陆地。')
      const summit = 'ascent' in route ? relevant.find(form => form.id === route.ascent.toLandmarkId) : undefined
      automatic.push({ area, route, landmark, summit, profile })
    }
    const box = reliefBounds(points), cell = Math.max(480, Math.max(box.width, box.height) / 96)
    const rebuild = () => {
      if (flat && !relevant.length && !ownRoutes.some(route => !('via' in route) || route.around)
        && !planned.some(route => route.control.some(row => row.z !== area.groundElevationMm))) {
        delete area.relief
        return
      }
      const heightAt = routeShape(profile, planned, cell)
      const estimate = Math.min(97, Math.ceil(box.width / cell) + 1) * Math.min(97, Math.ceil(box.height / cell) + 1)
      meter.charge({ gridNodes: estimate, fieldEvaluations: estimate * (2 + relevant.length + planned.length) })
      area.relief = createTerrainRelief(box, p => heightAt(p) - area.groundElevationMm, cell)
    }
    if (shapedReef) {
      const phase = terrainRandomUnit(seed, row.id) * 6
      const top = { x: box.x + box.width * (.50 + .13 * Math.sin(phase)), y: box.y + box.height * (.46 + .09 * Math.cos(phase)) }
      const grid = createTerrainRelief(box, p => {
        const r = Math.hypot((p.x - top.x) * 1.7 / box.width, (p.y - top.y) * 1.7 / box.height)
        const crag = terrainValueNoise(seed, row.id, p.x / 850, p.y / 710)
        return (elevation - area.groundElevationMm) * (1 - smooth((r + .19 * crag - .11) / .71))
      }, Math.max(195, Math.max(box.width, box.height) / 32))
      meter.charge({ gridNodes: grid.offsetsMm.length, fieldEvaluations: grid.offsetsMm.length })
      area.relief = grid
    } else rebuild()
    if (area.relief && (row.cover === 'natural' || row.cover === 'rock') && (relevant.length || row.form !== 'reef' || !natural)) {
      area.reliefFinish = natural ? 'weathered-v2' : 'weathered-v1'
    }
    scene.terrainAreas[area.id] = area
    scene.entityLayers[area.id] = groundLayer
    if (planned.length) fixedAreas.push({ area, planned, rebuild })
    for (const form of relevant) {
      const size = { x: Math.min(form.radius.x * .20, form.at.x - bounds.x, bounds.x + bounds.width - form.at.x),
        y: Math.min(form.radius.y * .20, form.at.y - bounds.y, bounds.y + bounds.height - form.at.y) }
      scene.regions[form.id] = { id: form.id, name: (form.name ?? form.id).slice(0, 80), floorId, kind: natural ? 'terrain' : 'partition', visibility: 'public',
        editLocked: false, boundaryMm: landscapeEllipse(form.at, size, 12, form.rotationDeg * Math.PI / 180), blocksMovement: false, movementCostMultiplier: 1 }
      scene.entityLayers[form.id] = groundLayer
    }
  }
  for (const lake of lakeRings) {
    const carrier = scene.terrainAreas[lake.areaId]
    if (!polygonInside(lake.points, terrainPoints(carrier))) throw heightError(lake.id, '内水轮廓须在指定陆地内。')
    addWater(lake.id, lake.points, true, carrier.groundElevationMm)
  }
  for (const { area, planned, rebuild } of fixedAreas) {
    if (draftRoadFailures) {
      // An invalid fixed route must leave the rest of the draft usable.
      // Rebuild the base relief after removing each rejected grading plan.
      while (planned.length) {
        const trial = { ...scene, paths: { ...scene.paths } }
        const invalid = planned.findIndex(plan => {
          try {
            trial.paths[plan.route.id] = landscapeRoad(trial, area.id, floor, plan)
            return false
          } catch (error) {
            if (!(error instanceof LandscapeRoadProfileError)) throw error
            fixedFailure(plan.route, error.issue)
            return true
          }
        })
        if (invalid < 0) break
        planned.splice(invalid, 1)
        rebuild()
        if (!area.relief) delete area.reliefFinish
      }
    }
    for (const plan of planned) plans.push({ areaId: area.id, plan })
  }
  for (const { area, route, landmark, summit, profile } of automatic) {
    try {
      const nearby = plans.filter(row => row.areaId === area.id).map(row => row.plan)
      const water = lakeRings.filter(lake => lake.areaId === area.id).map(lake => lake.points)
      const protectedForms = natural ? forms.filter(form => form.areaId === area.id && form !== summit && form.shape !== 'lowland'
        && form.elevationMm > 1700) : []
      const chosen = 'ascent' in route
        ? fitLandscapeAscent(scene, floor, area, route, summit!, landmark, profile, nearby, meter, water, protectedForms)
        : fitLandscapeRoad(scene, floor, area, route, landmark, profile, nearby, meter, water)
      area.relief = chosen.relief
      plans.unshift({ areaId: area.id, plan: chosen.plan })
    } catch (error) {
      if (!(error instanceof NoLandscapeRoad) || !draftRoadFailures) throw error
      draftRoadFailures.push(error.details)
    }
  }
  for (const { areaId, plan } of plans) {
    try {
      scene.paths[plan.route.id] = landscapeRoad(scene, areaId, floor, plan)
    } catch (error) {
      if (!(error instanceof LandscapeRoadProfileError)) throw error
      // A road trial checks the affected neighbours before its relief is
      // selected. A rejected combined result is never delivered.
      throw new NoLandscapeRoad({ id: plan.route.id, widthMm: plan.route.widthMm, fromMm: plan.anchors[0], toMm: plan.anchors.at(-1)!, issues: [error.issue] })
    }
    scene.entityLayers[plan.route.id] = trailsLayer
  }
  return forms
}
