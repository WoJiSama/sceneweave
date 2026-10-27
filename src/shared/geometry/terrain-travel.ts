import { wallMovementPolygons } from './doorway-clearance.js'
import { corridor, coveredEverywhere, pathPolygon, pointInPolygon, polygonsOverlap, propFootprint, segmentCuts, supportSurfaceAt, terrainPoints, validateGeometry } from './geometry.js'
import type { Issue, Path, PointMm, SceneDocument, SurfaceRef, TerrainConnection } from '../model/scene.js'

export interface TerrainTravelRequest { floorId: string; from: PointMm; to: PointMm; widthMm: number }
export interface TerrainTravelResult { ok: boolean; issues: Issue[] }
export interface TerrainRouteRequest { floorId: string; pointsMm: readonly PointMm[]; widthMm: number }
export interface TerrainRouteResult extends TerrainTravelResult {
  /** Actual centreline distance, with maximum overlapping movement factors integrated along it. */
  lengthMm: number
  movementCostMm: number
  supportRefs: SurfaceRef[]
  connectionIds: string[]
}
export interface TerrainRouteSearchRequest extends TerrainTravelRequest {
  /** Integer millimetre lattice spacing. Smaller values improve reachability at a bounded cost. */
  gridMm?: number
  /** Maximum accepted direction states and expanded nodes for this bounded search. */
  maxNodes?: number
  /** Maximum segments retained after deterministic path simplification. */
  maxSegments?: number
}
export interface TerrainRouteSearchResult {
  ok: boolean
  points: PointMm[]
  issues: Issue[]
  expandedNodes: number
  status: 'found' | 'not-found' | 'budget' | 'invalid'
  lengthMm?: number
  movementCostMm?: number
  supportRefs?: SurfaceRef[]
  connectionIds?: string[]
}
export const TERRAIN_ROUTE_LIMITS = Object.freeze({ points: 128, nodes: 16384, gridMm: 10000 })
const EPS = 1e-7
const at = (a: PointMm, b: PointMm, t: number): PointMm => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
const edges = (polygon: PointMm[]): [PointMm, PointMm][] => polygon.map((point, index) => [point, polygon[(index + 1) % polygon.length]])
const groundRef = (scene: SceneDocument, ref: SurfaceRef): SurfaceRef => ref.kind === 'room' ? scene.rooms[ref.id].supportRef : ref
const sameRef = (a: SurfaceRef | null, b: SurfaceRef | null): boolean => !!a && !!b && a.kind === b.kind && a.id === b.id
const elevation = (scene: SceneDocument, ref: SurfaceRef) => ref.kind === 'floor' ? 0 : ref.kind === 'room' ? scene.rooms[ref.id]?.groundElevationMm : scene.terrainAreas[ref.id]?.groundElevationMm
const isWalkable = (scene: SceneDocument, p: PointMm, floorId: string): boolean => {
  const support = supportSurfaceAt(scene, p, floorId)
  return !!support && (support.kind !== 'terrainArea' || !scene.terrainAreas[support.id].blocksMovement)
}
function connectionOpen(scene: SceneDocument, connection: TerrainConnection): boolean {
  if (connection.blocksMovement) return false
  if (connection.openingId === null) return true
  const opening = scene.openings[connection.openingId]
  return !!opening && opening.kind === 'door' && opening.state === 'open' && !opening.locked
}

/**
 * Checks one explicit straight full-width route in an already valid single-Floor scene.
 * It resolves current support, water, exposed boundaries, connections and actual rotated
 * blockers. It does not search for an alternative route or claim whole-map reachability.
 */
export function checkTerrainTravel(scene: SceneDocument, request: TerrainTravelRequest): TerrainTravelResult {
  const { floorId, from, to, widthMm } = request
  if (![from.x, from.y, to.x, to.y, widthMm].every(Number.isSafeInteger) || widthMm <= 0 || from.x === to.x && from.y === to.y || !scene.floors[floorId]) {
    return { ok: false, issues: [{ code: 'INVALID_TERRAIN_TRAVEL', message: '有限通行检查需要同 Floor 的非零直线与正整数净宽。' }] }
  }
  const geometry = validateGeometry(scene)
  if (geometry.errors.length) return { ok: false, issues: geometry.errors }
  const band = corridor(from, to, widthMm)
  return checkTerrainBand(scene, floorId, band, widthMm)
}

/** Both straight travel and complete route joins use the same physical predicates. */
function checkTerrainBand(scene: SceneDocument, floorId: string, band: PointMm[], widthMm: number): TerrainTravelResult {
  const issues: Issue[] = [], issue = (code: string, message: string, entityId?: string) => {
    if (!issues.some(existing => existing.code === code && existing.entityId === entityId)) issues.push({ code, message, ...(entityId ? { entityId } : {}) })
  }
  const areas = Object.values(scene.terrainAreas).filter(area => area.floorId === floorId), boundaries = areas.map(terrainPoints)
  const usable = Object.values(scene.terrainConnections).filter(connection => connection.floorId === floorId && connection.widthMm >= widthMm && connectionOpen(scene, connection)).map(connection => ({ connection, polygon: corridor(connection.from.positionMm, connection.to.positionMm, connection.widthMm) }))
  if (!coveredEverywhere(band, boundaries, p => isWalkable(scene, p, floorId))) issue('TERRAIN_NOT_WALKABLE', '整条净宽带必须留在世界内的可步行有效支撑面；水面或阻挡地形不能普通穿越。')
  for (const prop of Object.values(scene.props)) if (prop.floorId === floorId && prop.blocksMovement && polygonsOverlap(band, propFootprint(prop))) issue('TERRAIN_TRAVEL_OBSTACLE', '有限通行净宽被物件的真实旋转占地阻挡。', prop.id)
  for (const region of Object.values(scene.regions)) if (region.floorId === floorId && region.blocksMovement && polygonsOverlap(band, region.boundaryMm)) issue('TERRAIN_TRAVEL_OBSTACLE', '有限通行净宽被阻挡区域侵入。', region.id)
  for (const wall of wallMovementPolygons(scene, true)) if (wall.floorId === floorId && polygonsOverlap(band, wall.polygon)) issue('TERRAIN_TRAVEL_WALL', '有限通行净宽被实际墙体、转角或未打开的门窗阻挡。', wall.entityId)
  const allBoundaries = [...boundaries, band, ...usable.map(item => item.polygon)]
  const allEdges = allBoundaries.flatMap(edges)
  for (const area of areas) for (let index = 0; index < area.boundaryMm.length; index++) {
    const a = area.boundaryMm[index].positionMm, b = area.boundaryMm[(index + 1) % area.boundaryMm.length].positionMm, length = Math.hypot(b.x - a.x, b.y - a.y)
    if (!length) continue
    const cuts = segmentCuts(a, b, allEdges)
    for (let i = 1; i < cuts.length; i++) {
      const point = at(a, b, (cuts[i - 1] + cuts[i]) / 2)
      if (!pointInPolygon(point, band, false)) continue
      const offset = Math.min(0.01, length * (cuts[i] - cuts[i - 1]) / 10)
      const inside = supportSurfaceAt(scene, { x: point.x - (b.y - a.y) / length * offset, y: point.y + (b.x - a.x) / length * offset }, floorId)
      const outside = supportSurfaceAt(scene, { x: point.x + (b.y - a.y) / length * offset, y: point.y - (b.x - a.x) / length * offset }, floorId)
      if (!inside || !outside || sameRef(inside, outside)) continue
      const heightChange = elevation(scene, inside) !== elevation(scene, outside)
      const declared = Object.values(scene.terrainEdges).find(edge => edge.source.areaId === area.id && edge.source.segmentId === area.boundaryMm[index].segmentId || edge.source.areaId === outside.id && edge.neighborAreaId === area.id && (() => {
        const source = scene.terrainAreas[edge.source.areaId], sourceIndex = source?.boundaryMm.findIndex(p => p.segmentId === edge.source.segmentId) ?? -1
        return !!source && sourceIndex >= 0 && pointInPolygon(point, corridor(source.boundaryMm[sourceIndex].positionMm, source.boundaryMm[(sourceIndex + 1) % source.boundaryMm.length].positionMm, 0.001))
      })())
      if (!heightChange && !declared?.blocksMovement) continue
      const allowed = heightChange && usable.some(item => pointInPolygon(point, item.polygon) && [inside, outside].every(ref => sameRef(ref, groundRef(scene, item.connection.from.surfaceRef)) || sameRef(ref, groundRef(scene, item.connection.to.surfaceRef))))
      if (!allowed) issue(heightChange ? 'TERRAIN_HEIGHT_CONNECTION' : 'TERRAIN_EDGE_BLOCKED', heightChange ? '跨高差的完整净宽必须经过有效、未阻挡且足宽的台阶或坡道。' : '当前显式地形边缘阻挡移动。', declared?.id ?? area.id)
    }
  }
  return { ok: !issues.length, issues }
}

export interface TerrainConnectionFixture { connectionId: string; minWidthMm: number; approachDepthMm: number }
/** Finite opt-in hard constraints for a named connection and both straight approaches. */
export function assertTerrainConnectionClearances(scene: SceneDocument, fixtures: readonly TerrainConnectionFixture[]): void {
  if (fixtures.length > 64) throw new Error('单次有限台阶检查最多指定 64 处连接。')
  const ids = new Set<string>()
  for (const fixture of fixtures) {
    if (!fixture.connectionId || ids.has(fixture.connectionId) || !Number.isSafeInteger(fixture.minWidthMm) || fixture.minWidthMm <= 0 || !Number.isSafeInteger(fixture.approachDepthMm) || fixture.approachDepthMm <= 0) throw new Error('台阶净空配置需要唯一连接 ID、正整数净宽与接入深度。')
    ids.add(fixture.connectionId)
    const connection = scene.terrainConnections[fixture.connectionId]
    if (!connection) throw new Error(`声明 required 的地形连接不存在：${fixture.connectionId}。`)
    if (connection.widthMm < fixture.minWidthMm) throw new Error(`连接 ${connection.id} 净宽不足 ${fixture.minWidthMm} mm。`)
    const a = connection.from.positionMm, b = connection.to.positionMm, length = Math.hypot(b.x - a.x, b.y - a.y)
    if (!length) throw new Error(`连接 ${connection.id} 不能为零长。`)
    const dx = (b.x - a.x) / length * fixture.approachDepthMm, dy = (b.y - a.y) / length * fixture.approachDepthMm
    // The fixture uses integer endpoints. Refuse an unrepresentable extension rather
    // than silently quantizing a narrower/shorter promised approach corridor.
    const from = { x: a.x - dx, y: a.y - dy }, to = { x: b.x + dx, y: b.y + dy }
    if (![from.x, from.y, to.x, to.y].every(Number.isSafeInteger)) throw new Error(`连接 ${connection.id} 的有限接入区需要可精确表达的整数端点。`)
    const check = checkTerrainTravel(scene, { floorId: connection.floorId, from, to, widthMm: connection.widthMm })
    if (!check.ok) throw new Error(`连接 ${connection.id} 的 ${connection.widthMm} mm 净宽及两端 ${fixture.approachDepthMm} mm 接入区未通过：${check.issues.map(item => item.message).join('；')}`)
  }
}

type RouteNode = { point: PointMm; key: string; g: number; h: number; points: PointMm[] }
const routeKey = (point: PointMm) => `${point.x},${point.y}`
const routeDistance = (a: PointMm, b: PointMm) => Math.hypot(b.x - a.x, b.y - a.y)
const routeBoundsContain = (point: PointMm, bounds: { x: number; y: number; width: number; height: number }) =>
  point.x >= bounds.x && point.x <= bounds.x + bounds.width && point.y >= bounds.y && point.y <= bounds.y + bounds.height
const emptyRoute = (issues: Issue[]): TerrainRouteResult => ({ ok: false, issues, lengthMm: 0, movementCostMm: 0, supportRefs: [], connectionIds: [] })
const samePoint = (a: PointMm, b: PointMm) => Math.abs(a.x - b.x) <= EPS && Math.abs(a.y - b.y) <= EPS
function turn(a: PointMm, b: PointMm, c: PointMm): number {
  if ([a.x, a.y, b.x, b.y, c.x, c.y].every(Number.isSafeInteger)) {
    const value = (BigInt(b.x) - BigInt(a.x)) * (BigInt(c.y) - BigInt(a.y)) - (BigInt(b.y) - BigInt(a.y)) * (BigInt(c.x) - BigInt(a.x))
    return value < 0n ? -1 : value > 0n ? 1 : 0
  }
  const value = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
  return Math.abs(value) <= EPS ? 0 : Math.sign(value)
}
function segmentMeets(a: PointMm, b: PointMm, c: PointMm, d: PointMm): boolean {
  const abC = turn(a, b, c), abD = turn(a, b, d), cdA = turn(c, d, a), cdB = turn(c, d, b)
  const on = (p: PointMm, q: PointMm, r: PointMm) => r.x >= Math.min(p.x, q.x) - EPS && r.x <= Math.max(p.x, q.x) + EPS && r.y >= Math.min(p.y, q.y) - EPS && r.y <= Math.max(p.y, q.y) + EPS
  return abC * abD < 0 && cdA * cdB < 0 || !abC && on(a, b, c) || !abD && on(a, b, d) || !cdA && on(c, d, a) || !cdB && on(c, d, b)
}
function simpleRoutePoints(points: readonly PointMm[], closed: boolean): boolean {
  const count = closed ? points.length : points.length - 1
  for (let i = 0; i < count; i++) {
    const a = points[i], b = points[(i + 1) % points.length]
    if (samePoint(a, b)) return false
    if (i + 2 < points.length || closed) {
      const c = points[(i + 2) % points.length]
      if (!turn(a, b, c) && (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y) < 0) return false
    }
    for (let j = i + 2; j < count; j++) {
      if (closed && i === 0 && j === count - 1) continue
      if (segmentMeets(a, b, points[j], points[(j + 1) % points.length])) return false
    }
  }
  return true
}
function routePath(points: readonly PointMm[], floorId: string, widthMm: number): Path {
  return { id: 'terrain-route-check', floorId, editLocked: false, visibility: 'public', centerlineMm: [...points], widthMm,
    supportRefs: [{ kind: 'floor', id: floorId }], surfaceStyle: null, movementCostMultiplier: 1, renderOrder: 0 }
}

/** Integrates the centreline over exact boundary intervals. Overlapping costs
 * combine by maximum, so a drawn road never lowers another declared cost. */
function routeMetrics(scene: SceneDocument, floorId: string, points: readonly PointMm[], widthMm: number): Omit<TerrainRouteResult, 'ok' | 'issues'> {
  const areas = Object.values(scene.terrainAreas).filter(area => area.floorId === floorId)
  const regions = Object.values(scene.regions).filter(region => region.floorId === floorId && !region.blocksMovement)
  const paths = Object.values(scene.paths).filter(path => path.floorId === floorId).map(path => ({ path, polygon: pathPolygon(path) }))
  const connections = Object.values(scene.terrainConnections).filter(connection => connection.floorId === floorId && connection.widthMm >= widthMm && connectionOpen(scene, connection))
    .map(connection => ({ connection, polygon: corridor(connection.from.positionMm, connection.to.positionMm, connection.widthMm) }))
  const boundaries = [...areas.map(terrainPoints), ...regions.map(region => region.boundaryMm), ...paths.map(item => item.polygon), ...connections.map(item => item.polygon)]
  const allEdges = boundaries.flatMap(edges), supports = new Map<string, SurfaceRef>(), connectionIds = new Set<string>()
  let lengthMm = 0, movementCostMm = 0
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], length = routeDistance(a, b), cuts = segmentCuts(a, b, allEdges)
    lengthMm += length
    for (let j = 1; j < cuts.length; j++) {
      const point = at(a, b, (cuts[j - 1] + cuts[j]) / 2), support = supportSurfaceAt(scene, point, floorId)
      if (support) supports.set(support.kind + '/' + support.id, support)
      let factor = support?.kind === 'terrainArea' ? scene.terrainAreas[support.id].movementCostMultiplier : 1
      for (const region of regions) if (pointInPolygon(point, region.boundaryMm)) factor = Math.max(factor, region.movementCostMultiplier)
      for (const item of paths) if (pointInPolygon(point, item.polygon)) factor = Math.max(factor, item.path.movementCostMultiplier)
      for (const item of connections) if (pointInPolygon(point, item.polygon)) {
        factor = Math.max(factor, item.connection.movementCostMultiplier); connectionIds.add(item.connection.id)
      }
      movementCostMm += length * (cuts[j] - cuts[j - 1]) * factor
    }
  }
  return { lengthMm, movementCostMm, supportRefs: [...supports].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, ref]) => ref), connectionIds: [...connectionIds].sort() }
}

function checkRouteOnValidScene(scene: SceneDocument, request: TerrainRouteRequest): TerrainRouteResult {
  const { floorId, pointsMm, widthMm } = request
  if (!scene.floors[floorId] || !Array.isArray(pointsMm) || pointsMm.length < 2 || pointsMm.length > TERRAIN_ROUTE_LIMITS.points
    || !Number.isSafeInteger(widthMm) || widthMm <= 0 || pointsMm.some(point => !point || ![point.x, point.y].every(Number.isSafeInteger))) {
    return emptyRoute([{ code: 'INVALID_TERRAIN_ROUTE', message: '有限路线检查需要同 Floor 的 2–128 个整数点与正整数净宽。' }])
  }
  if (!simpleRoutePoints(pointsMm, false)) return emptyRoute([{ code: 'TERRAIN_ROUTE_SELF_OVERLAP', message: '路线不能重复、折返、自交或自接触。' }])
  const band = pathPolygon(routePath(pointsMm, floorId, widthMm))
  if (!band.length || !simpleRoutePoints(band, true)) return emptyRoute([{ code: 'TERRAIN_ROUTE_SELF_OVERLAP', message: '路线的方端帽、miterLimit2/bevel完整净宽带不能自交或自接触。' }])
  const checked = checkTerrainBand(scene, floorId, band, widthMm)
  const metrics = routeMetrics(scene, floorId, pointsMm, widthMm), supports = new Map<string, SurfaceRef>()
  coveredEverywhere(band, Object.values(scene.terrainAreas).filter(area => area.floorId === floorId).map(terrainPoints), point => {
    const support = supportSurfaceAt(scene, point, floorId)
    if (support) supports.set(support.kind + '/' + support.id, support)
    return true
  })
  metrics.supportRefs = [...supports].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, ref]) => ref)
  return { ...checked, ...metrics }
}

/** Checks the actual complete square-cap, miterLimit2/bevel corridor, including
 * each turn and full-width height crossing under current door/connection state. */
export function checkTerrainRoute(scene: SceneDocument, request: TerrainRouteRequest): TerrainRouteResult {
  const geometry = validateGeometry(scene)
  return geometry.errors.length ? emptyRoute(geometry.errors) : checkRouteOnValidScene(scene, request)
}

/**
 * Finds a finite deterministic route over lattice neighbours and exact usable
 * connection endpoints. Every extension and simplification rechecks the full
 * corridor, including all turns. This is a suggestion only: callers still
 * need to show the returned polyline and adopt it through the normal transaction.
 */
export function searchTerrainRoute(scene: SceneDocument, request: TerrainRouteSearchRequest): TerrainRouteSearchResult {
  const gridMm = request.gridMm ?? 1000, maxNodes = request.maxNodes ?? 4096, maxSegments = request.maxSegments ?? TERRAIN_ROUTE_LIMITS.points - 1
  const invalid = (message: string): TerrainRouteSearchResult => ({ ok: false, points: [], expandedNodes: 0,
    status: 'invalid', issues: [{ code: 'INVALID_TERRAIN_ROUTE', message }] })
  if (!scene.floors[request.floorId] || ![request.from.x, request.from.y, request.to.x, request.to.y, request.widthMm, gridMm, maxNodes, maxSegments].every(Number.isSafeInteger)
    || request.widthMm <= 0 || gridMm <= 0 || maxNodes <= 0 || maxSegments <= 0 || request.from.x === request.to.x && request.from.y === request.to.y) {
    return invalid('有限路线搜索需要存在的 Floor、不同的整数端点、正整数净宽、网格、节点和折线预算。')
  }
  if (!routeBoundsContain(request.from, scene.floors[request.floorId].boundsMm) || !routeBoundsContain(request.to, scene.floors[request.floorId].boundsMm)) {
    return invalid('路线端点必须位于指定 Floor 的世界范围内。')
  }
  if (gridMm > TERRAIN_ROUTE_LIMITS.gridMm || maxNodes > TERRAIN_ROUTE_LIMITS.nodes || maxSegments >= TERRAIN_ROUTE_LIMITS.points) return invalid('有限路线搜索参数超过保护上限。')
  const geometry = validateGeometry(scene)
  if (geometry.errors.length) return { ok: false, points: [], expandedNodes: 0, status: 'invalid', issues: geometry.errors }
  const check = (pointsMm: PointMm[]) => checkRouteOnValidScene(scene, { floorId: request.floorId, pointsMm, widthMm: request.widthMm })
  const direct = check([request.from, request.to])
  const hasCosts = [...Object.values(scene.terrainAreas), ...Object.values(scene.regions), ...Object.values(scene.paths), ...Object.values(scene.terrainConnections)]
    .some(item => item.floorId === request.floorId && item.movementCostMultiplier > 1)
  if (direct.ok && !hasCosts) return { ...direct, points: [{ ...request.from }, { ...request.to }], expandedNodes: 1, status: 'found' }
  const anchors = new Map<string, PointMm>([[routeKey(request.to), request.to]])
  const connections = Object.values(scene.terrainConnections).filter(connection => connection.floorId === request.floorId && connection.widthMm >= request.widthMm && connectionOpen(scene, connection))
    .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  for (const connection of connections) for (const point of [connection.from.positionMm, connection.to.positionMm]) anchors.set(routeKey(point), point)
  if (anchors.size > 129) return { ok: false, points: [], expandedNodes: 0, status: 'budget', issues: [{ code: 'TERRAIN_ROUTE_ANCHOR_LIMIT', message: '本次路线搜索的有效连接端点超过128个保护上限。' }] }
  const orderedAnchors = [...anchors.values()].sort((a, b) => a.y - b.y || a.x - b.x)

  const startKey = routeKey(request.from), goalKey = routeKey(request.to)
  const open: RouteNode[] = [{ point: request.from, key: startKey, g: 0, h: routeDistance(request.from, request.to), points: [request.from] }]
  const best = new Map<string, RouteNode>([[startKey, open[0]]]), closed = new Set<string>()
  const directions = [
    [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1],
  ] as const
  let expandedNodes = 0, pointLimitHit = false, stateLimitHit = false
  while (open.length) {
    open.sort((a, b) => (a.g + a.h) - (b.g + b.h) || a.h - b.h || a.point.y - b.point.y || a.point.x - b.point.x || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    const current = open.shift()!
    if (closed.has(current.key) || best.get(current.key) !== current) continue
    closed.add(current.key); expandedNodes++
    if (routeKey(current.point) === goalKey) {
      let simplified = current.points
      for (let i = 1; i < simplified.length - 1;) {
        const candidate = [...simplified.slice(0, i), ...simplified.slice(i + 1)], checked = check(candidate), previous = check(simplified)
        if (checked.ok && checked.movementCostMm <= previous.movementCostMm + EPS) simplified = candidate
        else i++
      }
      if (simplified.length - 1 > maxSegments) return { ok: false, points: [], expandedNodes, status: 'budget',
        issues: [{ code: 'TERRAIN_ROUTE_SEGMENT_LIMIT', message: `路线折点超过本次 ${maxSegments} 段预算。` }] }
      const checked = check(simplified)
      return { ...checked, points: checked.ok ? simplified.map(point => ({ ...point })) : [], expandedNodes, status: checked.ok ? 'found' : 'not-found' }
    }
    if (expandedNodes >= maxNodes) return { ok: false, points: [], expandedNodes, status: 'budget',
      issues: [{ code: 'TERRAIN_ROUTE_SEARCH_LIMIT', message: `路线搜索达到 ${maxNodes} 个节点预算，未宣称不存在其他路线。` }] }
    const candidates = new Map<string, PointMm>()
    for (const [dx, dy] of directions) {
      const point = { x: current.point.x + dx * gridMm, y: current.point.y + dy * gridMm }
      if ([point.x, point.y].every(Number.isSafeInteger) && routeBoundsContain(point, scene.floors[request.floorId].boundsMm)) candidates.set(routeKey(point), point)
    }
    for (const anchor of orderedAnchors) candidates.set(routeKey(anchor), anchor)
    for (const point of candidates.values()) {
      if (samePoint(current.point, point) || current.points.some(previous => samePoint(previous, point))) continue
      if (current.points.length >= TERRAIN_ROUTE_LIMITS.points) { pointLimitHit = true; continue }
      const key = routeKey(point) + '|' + routeKey(current.point)
      if (closed.has(key)) continue
      const points = [...current.points, point], checked = check(points)
      if (!checked.ok) continue
      const g = checked.movementCostMm, prior = best.get(key)
      if (prior && prior.g <= g) continue
      if (!prior && best.size >= maxNodes) { stateLimitHit = true; continue }
      const node = { point, key, g, h: routeDistance(point, request.to), points }
      best.set(key, node); open.push(node)
    }
  }
  if (stateLimitHit) return { ok: false, points: [], expandedNodes, status: 'budget', issues: [{ code: 'TERRAIN_ROUTE_SEARCH_LIMIT', message: '路线达到本次节点状态预算，未宣称不存在其他路线。' }] }
  if (pointLimitHit) return { ok: false, points: [], expandedNodes, status: 'budget', issues: [{ code: 'TERRAIN_ROUTE_POINT_LIMIT', message: '路线达到128个点保护上限，未宣称不存在其他路线。' }] }
  return { ok: false, points: [], expandedNodes, status: 'not-found',
    issues: [{ code: 'TERRAIN_ROUTE_NOT_FOUND', message: '在当前有限路线算法和预算内未找到满足完整净宽的路线；这不表示数学上不存在其他路线。' }] }
}
