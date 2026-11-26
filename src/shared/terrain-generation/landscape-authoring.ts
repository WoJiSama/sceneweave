import type { ExecutionBudget } from '../budget/task-budget.js'
import { connectionArcFrame } from '../geometry/connection-route.js'
import { sampleAnchoredRoad } from '../geometry/automatic-road.js'
import { landmarkRoutes } from '../geometry/landmark-route.js'
import { distanceToSegment, pointInPolygon, polygonInside, polygonValid, polylineBand, terrainPoints } from '../geometry/geometry.js'
import { createRoadGround, assertRoadProfile } from '../geometry/road-domain.js'
import { gradeRoadSurface } from '../geometry/road-grading.js'
import { AUTOMATIC_ROAD_VERSION, ROAD_LANDING_MIN_MM } from '../geometry/road-surface.js'
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
import type { MapLandscapeRecipe } from '../generation/map-authoring.js'

export const LANDSCAPE_VERSION = 3
export const LANDSCAPE_WATER_ID = 'landscape/water'
type Landform = MapLandscapeRecipe['landforms'][number]
type Route = MapLandscapeRecipe['routes'][number]
type Frame = { point: (p: PointMm) => PointMm; size: (p: PointMm) => PointMm }
type HeightAt = (p: PointMm) => number
type PreparedRoute = ReturnType<typeof prepareRoute>
export type LandscapeRoadFailure = { id: string; fromMm: PointMm; toMm: PointMm; landmarkId: string; widthMm: number; issues: TerrainTravelIssue[] }
class NoLandscapeRoad extends OperationRejected {
  constructor(readonly details: LandscapeRoadFailure) {
    super('invalid_geometry', details.issues.map(issue => issue.message).join('；'))
  }
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
  const profile = (station: number) => {
    const next = control.findIndex((row, i) => i > 0 && row.station >= station)
    const a = control[(next < 0 ? control.length - 1 : next) - 1], b = next < 0 ? control.at(-1)! : control[next]
    const cap = (row: typeof a) => (row.landingMm ?? (row.station === 0 || row.station === frame.length ? 1650 : 0)) / 2
    const start = a.station + cap(a), end = b.station - cap(b), length = end - start
    if (length <= 0) return station <= (a.station + b.station) / 2 ? a.z : b.z
    const t = clamp((station - start) / length), ratio = Math.abs(b.z - a.z) / length
    if (route.style !== 'stairs' || length < 4000 || ratio < .035 || ratio > .27) return mix(a.z, b.z, t)
    // Place the steep part locally. The intervening length reads as a trail or landing.
    const run = clamp(.83 * ratio / .32)
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
function smoothOutline(points: PointMm[], bounds: BoundsMm, touchesNeighbor: (a: PointMm, b: PointMm) => boolean): PointMm[] {
  const hasRoom = (p: PointMm) => fits(p, bounds)
  const smoothed = (strength: number) => points.flatMap((a, i) => {
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
    // Author anchors already carry the small coves. Add only enough points
    // to show the transition at map scale and preserve each original anchor.
    const count = Math.min(4, Math.max(2, Math.ceil(length / 1450)))
    for (const scale of [strength, strength * .35]) {
      const segment = Array.from({ length: count + 1 }, (_, index) => {
        const t = index / count, k = 1 - t
        const first = 3 * k * k * t * scale, last = 3 * k * t * t * scale
        return round({ x: mix(a.x, b.x, t * t * (3 - 2 * t)) + first * ta.x - last * tb.x,
          y: mix(a.y, b.y, t * t * (3 - 2 * t)) + first * ta.y - last * tb.y })
      })
      if (segment.every(hasRoom) && segment.slice(1).every((p, index) =>
        (p.x !== segment[index].x || p.y !== segment[index].y) && !touchesNeighbor(segment[index], p))) return segment.slice(0, -1)
    }
    return [a]
  })
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
  }))
  return p => {
    const original = base(p)
    let nearest = Infinity, width = 0, z = original
    for (const { segments, route, profile, find, influence } of indexed) {
      const possible = find(p, p, influence)
      observeGeometryPairs(possible.length)
      for (const i of possible) {
        const { a, dx, dy, length, start } = segments[i]
        const fraction = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / (length * length))
        const distance = Math.hypot(p.x - a.x - fraction * dx, p.y - a.y - fraction * dy)
        if (distance < nearest) { nearest = distance; width = route.widthMm; z = profile(start + fraction * length) }
      }
    }
    const inner = width / 2 + cell * 1.55
    const transition = Math.min(6200, 2500 + Math.abs(z - original) * .24)
    return mix(z, original, smooth((nearest - inner) / transition))
  }
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
  const edgeIndex = keepEdges ? indexEdges(asEdges(points)) : undefined
  meter.charge({ fieldEvaluations: grid.offsetsMm.length * (keepEdges ? 3 : 2) })
  const offsetsMm = grid.offsetsMm.map((previous, index) => {
    const p = reliefGridPoint(grid, bounds, index % grid.columns, Math.floor(index / grid.columns))
    const neighbors = edgeIndex?.(p, p, cell * 1.5) ?? []
    observeGeometryPairs(neighbors.length)
    if (neighbors.length) return previous
    return Math.round(height(p) - area.groundElevationMm)
  })
  return { ...grid, offsetsMm }
}

function baseHeight(area: TerrainArea, points: PointMm[], forms: Landform[], coastal: boolean, seed: string): HeightAt {
  const outline = asEdges(points), find = coastal ? indexEdges(outline) : undefined
  const raised = forms.filter(form => form.shape !== 'lowland' && !form.preserveRelief)
  const lows = forms.filter(form => form.shape === 'lowland')
  const retained = forms.filter(form => form.preserveRelief)
  return p => {
    let distance = 4700
    const candidates = find?.(p, p, distance) ?? []
    observeGeometryPairs(candidates.length)
    for (const i of candidates) distance = Math.min(distance, distanceToSegment(p, ...outline[i]))
    const inside = smooth(distance / 4700)
    const fold = terrainValueNoise(seed, `${area.id}/fold`, p.x / 6900, p.y / 5900)
    const seam = terrainValueNoise(seed, `${area.id}/seam`, p.x / 2050, p.y / 1730)
    const datum = area.groundElevationMm + inside * (coastal ? 590 : 250) * (1 + .68 * fold + .21 * seam)
    let high = datum, still = 0
    for (const form of raised) {
      const weight = landformWeight(form, p, seed)
      high = Math.max(high, mix(datum, form.elevationMm, weight))
      still = Math.max(still, smooth((weight - .82) / .18))
    }
    high += (1 - still) * inside * (fold * 670 + seam * 260) * clamp((high - datum) / 5800)
    for (const form of lows) high = mix(high, form.elevationMm, landformWeight(form, p, seed))
    const basin = high
    for (const form of retained) high = Math.max(high, mix(basin, form.elevationMm, landformWeight(form, p, seed)))
    return coastal ? Math.max(80, high) : high
  }
}

function landscapeRoad(scene: SceneDocument, areaId: string, floor: Floor, plan: PreparedRoute): Path {
  const { route, centerlineMm, anchors, control } = plan
  const path = { centerlineMm, widthMm: route.widthMm }
  if (!polygonValid(polylineBand(centerlineMm, route.widthMm, true), true)) throw heightError(route.id, '道路的净宽带在转角处折返或相交。请拉开两个途经点。')
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
      surfaceStyle: { base: landscapePaint(scene, 'sandDry', '#D5CAB4'), overlays: [] },
      ...(roadSurface.stations.some(station => station.outZMm) ? { staircase: { ...defaultStaircase(), preset: 'rough-stone' as const, material: 'limestone' as const } } : {}),
      automaticRoute: { algorithm: AUTOMATIC_ROAD_VERSION, alignment: 'anchors-v1', fixedPointsMm: anchors,
        landings: route.around ? [] : landings, automaticStairs: true } }
  } catch (error) {
    if (error instanceof OperationRejected && error.code === 'operation_budget') {
      throw new OperationRejected(error.code, `道路「${route.id}」所在陆地「${areaId}」：${error.message}`)
    }
    throw heightError(route.id, `${error instanceof Error ? error.message : String(error)} 起终点：${anchors.map(p => `${p.x},${p.y}`).join(' → ')} mm。`)
  }
}

function fitLandscapeRoad(scene: SceneDocument, floor: Floor, area: TerrainArea, route: Route, landmark: Landform,
  field: HeightAt, nearby: PreparedRoute[], meter: ExecutionBudget) {
  const { side, radiusMm } = route.around!, [first, last] = route.via, points = terrainPoints(area)
  const radius = radiusMm ?? Math.max(route.widthMm * 2.2, Math.min(landmark.radius.x, landmark.radius.y) * .70)
  const courses = landmarkRoutes(first.at, last.at, landmark.at, side, radius, route.widthMm,
    band => polygonInside(band, points), radiusMm === undefined)
  let issues: TerrainTravelIssue[] = []
  for (const course of courses.slice(0, 4)) {
    try {
      const via = landscapeRouteAnchors(course, route.style, route.widthMm)
      const plan = prepareRoute({ ...route, via: [first, ...via.slice(1, -1), last] }, field)
      const relief = gradeRouteRelief(area, plan, meter, false)
      const terrain = { ...area, relief }
      const trial = { ...scene, terrainAreas: { ...scene.terrainAreas, [area.id]: terrain }, paths: { ...scene.paths } }
      const road = landscapeRoad(trial, area.id, floor, plan)
      trial.paths[road.id] = road
      for (const other of nearby) trial.paths[other.route.id] = landscapeRoad(trial, area.id, floor, other)
      const result = checkGradedRoadOnValidScene(trial, road)
      if (!result.ok) {
        issues = result.issues
        continue
      }
      const disrupted = nearby.filter(other => other.route.around)
        .map(other => checkGradedRoadOnValidScene(trial, trial.paths[other.route.id])).find(result => !result.ok)
      if (disrupted) { issues = disrupted.issues; continue }
      return { plan, relief }
    } catch (error) {
      if (error instanceof OperationRejected && error.code === 'operation_budget') throw error
      if (!issues.some(issue => issue.atMm)) issues = [{ code: 'LANDSCAPE_ROAD_PROFILE', entityId: route.id,
        message: error instanceof Error ? error.message : String(error) }]
    }
  }
  const direction = ({ north: '北', east: '东', south: '南', west: '西' })[side]
  throw new NoLandscapeRoad({ id: route.id, widthMm: route.widthMm, fromMm: first.at, toMm: last.at, landmarkId: landmark.id, issues: [
    { code: 'LANDSCAPE_ROAD_NOT_FOUND', entityId: route.id, atMm: landmark.at,
      message: `「${route.id}」绕「${landmark.id}」${direction}侧未找到 ${route.widthMm} mm 净宽的可通行路线。可移动靠岸端点、指定绕行半径或调整净宽。` },
    ...issues,
  ] })
}

export function shapeLandscape(scene: SceneDocument, floor: Floor, input: MapLandscapeRecipe, frame: Frame, seed: string, meter: ExecutionBudget,
  draftRoadFailures?: LandscapeRoadFailure[]) {
  const coast = input.environment === 'coast', floorId = floor.id, bounds = floor.boundsMm
  const layers = Object.values(scene.userLayers).filter(row => row.floorId === floorId).sort((a, b) => a.order - b.order)
  const groundLayer = layers[0].id, trailsLayer = layers[1]?.id ?? groundLayer
  if (coast) {
    const bottom = bounds.y + bounds.height, right = bounds.x + bounds.width
    const water = newArea(LANDSCAPE_WATER_ID, floorId,
      [{ x: bounds.x, y: bounds.y }, { x: right, y: bounds.y }, { x: right, y: bottom }, { x: bounds.x, y: bottom }],
      0, 0, { base: landscapePaint(scene, 'waterDeep'), overlays: [] }, true)
    water.waterSurface = { ...WATER_PRESETS.calm, waveSpacingMm: 3100, waveStrength: .47, seed: `${seed.slice(0, 105)}/water` }
    scene.terrainAreas[water.id] = water
    scene.entityLayers[water.id] = groundLayer
  }
  const forms = input.landforms.map(row => ({ ...row, at: frame.point(row.at), radius: frame.size(row.radius) }))
  const routes = input.routes.map(row => ({ ...row, via: row.via.map(anchor => ({ ...anchor, at: frame.point(anchor.at) })) }))
  const plans: { areaId: string; plan: ReturnType<typeof prepareRoute> }[] = []
  const automatic: { area: TerrainArea; route: Route; landmark: Landform; profile: HeightAt }[] = []
  const outlines = splitNewTerrainJunctions(input.land.map(row => {
    const isReef = row.form === 'reef', flat = row.form === 'flat'
    const phase = terrainRandomUnit(seed, row.id) * 6
    const noise = (a: number) => .90 + .055 * Math.sin(3 * a + phase) + .032 * Math.sin(a * 7 + 1) + .013 * Math.cos(a * 11)
    let points = row.boundary ? row.boundary.map(frame.point)
      : landscapeEllipse(frame.point(row.at!), frame.size(row.radius!), isReef ? 14 : 60, 0, row.shore === 'hard' || flat ? undefined : noise)
    if (points.length > 3 && points[0].x === points.at(-1)!.x && points[0].y === points.at(-1)!.y) points.pop()
    if (signedVisualArea(points) < 0) points = points.reverse()
    if (!points.every(p => fits(p, bounds)) || !polygonValid(points, true)) throw heightError(row.id, '轮廓超出画布、相交或存在重合点。')
    return { id: row.id, points }
  }))
  const outlineEdges = outlines.flatMap(({ id, points }) => asEdges(points).map(edge => ({ id, edge })))
  const findOutline = indexEdges(outlineEdges.map(row => row.edge))
  const smoothRings = outlines.map(({ id, points }, i) => {
    const row = input.land[i]
    if (!row.boundary || row.outline !== 'smooth' || row.shore === 'hard' || points.length > 180) return points
    return smoothOutline(points, bounds, (a, b) => {
      const hits = findOutline(a, b)
      observeGeometryPairs(hits.length)
      return hits.some(index => outlineEdges[index].id !== id)
    })
  })
  for (const [index, row] of input.land.entries()) {
    const points = smoothRings[index], isReef = row.form === 'reef', flat = row.form === 'flat'
    if (points.length > 2048) throw heightError(row.id, `共享交点加入后轮廓有 ${points.length} 个点，原生上限为 2048。`)
    const relevant = forms.filter(form => form.areaId === row.id)
    const ownRoutes = routes.filter(route => route.areaId === row.id)
    const invalid = relevant.find(form => !pointInPolygon(form.at, points, false) || Math.min(form.radius.x, form.radius.y) < 250)
    if (invalid) throw heightError(invalid.id, '地貌中心须在指定陆地内，半径换算后每轴至少 250 mm。')
    for (const route of ownRoutes) if (route.via.some(anchor => !pointInPolygon(anchor.at, points, false))) {
      throw heightError(route.id, `起点、途经点和终点须在地形「${row.id}」内。`)
    }
    const key = row.cover === 'natural' ? coast ? isReef ? 'rockDry' : 'sandDry' : flat ? 'grass' : 'sandDry'
      : row.cover === 'sand' ? 'sandDry' : row.cover === 'rock' ? 'rockDry' : 'grass'
    const elevation = row.elevationMm ?? (coast ? isReef ? 1000 : 640 : flat ? 0 : 200)
    const shapedReef = isReef && !relevant.length && !ownRoutes.length && coast
    const area = newArea(row.id, floorId, points, shapedReef ? Math.min(170, elevation) : elevation,
      1, { base: landscapePaint(scene, key), overlays: [] })
    const profile = flat && !relevant.length ? () => area.groundElevationMm : baseHeight(area, points, relevant, coast, seed)
    const planned = ownRoutes.filter(route => !route.around).map(route => prepareRoute(route, profile))
    for (const route of ownRoutes) if (route.around) {
      const landmark = relevant.find(form => form.id === route.around!.landmarkId)
      if (!landmark) throw heightError(route.id, '绕行地标须位于同一块陆地。')
      automatic.push({ area, route, landmark, profile })
    }
    const box = reliefBounds(points), cell = Math.max(480, Math.max(box.width, box.height) / 96)
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
    } else if (!flat || relevant.length || planned.some(route => route.control.some(row => row.z !== area.groundElevationMm))) {
      const heightAt = routeShape(profile, planned, cell)
      const estimate = Math.min(97, Math.ceil(box.width / cell) + 1) * Math.min(97, Math.ceil(box.height / cell) + 1)
      meter.charge({ gridNodes: estimate, fieldEvaluations: estimate * (2 + relevant.length + planned.length) })
      area.relief = createTerrainRelief(box, p => heightAt(p) - area.groundElevationMm, cell)
    }
    if (area.relief && (row.cover === 'natural' || row.cover === 'rock')) area.reliefFinish = 'weathered-v1'
    scene.terrainAreas[area.id] = area
    scene.entityLayers[area.id] = groundLayer
    for (const plan of planned) plans.push({ areaId: area.id, plan })
    for (const form of relevant) {
      const size = { x: Math.min(form.radius.x * .20, form.at.x - bounds.x, bounds.x + bounds.width - form.at.x),
        y: Math.min(form.radius.y * .20, form.at.y - bounds.y, bounds.y + bounds.height - form.at.y) }
      scene.regions[form.id] = { id: form.id, name: (form.name ?? form.id).slice(0, 80), floorId, kind: 'partition', visibility: 'public',
        editLocked: false, boundaryMm: landscapeEllipse(form.at, size, 12, form.rotationDeg * Math.PI / 180), blocksMovement: false, movementCostMultiplier: 1 }
      scene.entityLayers[form.id] = groundLayer
    }
  }
  for (const { area, route, landmark, profile } of automatic) {
    try {
      const nearby = plans.filter(row => row.areaId === area.id).map(row => row.plan)
      const chosen = fitLandscapeRoad(scene, floor, area, route, landmark, profile, nearby, meter)
      area.relief = chosen.relief
      plans.unshift({ areaId: area.id, plan: chosen.plan })
    } catch (error) {
      if (!(error instanceof NoLandscapeRoad) || !draftRoadFailures) throw error
      draftRoadFailures.push(error.details)
    }
  }
  for (const { areaId, plan } of plans) {
    scene.paths[plan.route.id] = landscapeRoad(scene, areaId, floor, plan)
    scene.entityLayers[plan.route.id] = trailsLayer
  }
  return forms
}
