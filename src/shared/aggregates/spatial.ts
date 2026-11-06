import type { AggregateEntityRef } from '../model/aggregate.js'
import type { BoundsMm, PointMm, SceneDocument } from '../model/scene.js'
import { connectionFootprint, pathPolygon, propFootprint, roomPoints, terrainPoints } from '../geometry/geometry.js'
import { openingEnvelopePolygon, wallEnvelopePolygons } from '../geometry/doorway-clearance.js'
import { createPublicVisibility } from '../geometry/visibility.js'
import { connectionRouteSchema } from '../geometry/connection-route.js'
import { canonicalJson, cloneJson, freezeJson, inspectJsonInput } from '../validation/json.js'
import { sha256Text } from '../validation/hash.js'
import { validateSceneDocument } from '../validation/scene.js'

export type AggregateSpatialAudience = 'gm' | 'player'
export type AggregateSpatialRole = 'boundary' | 'footprint' | 'surface' | 'route' | 'visual'
export type AggregateSpatialEntityRef = AggregateEntityRef | { kind: 'floor'; id: string }

export interface AggregateSpatialEnvelope {
  entity: AggregateSpatialEntityRef
  floorId: string
  role: AggregateSpatialRole
  boundsMm: BoundsMm
}

export interface AggregateSpatialQuery {
  floorId: string
  boundsMm: BoundsMm
  roles?: readonly AggregateSpatialRole[]
  /** Searches a conservative clearance band around the supplied bounds. */
  marginMm?: number
}

export interface AggregateSpatialChangeQuery {
  floorId: string
  previousBoundsMm: BoundsMm
  nextBoundsMm: BoundsMm
  marginMm?: number
  roles?: readonly AggregateSpatialRole[]
}

export interface AggregateSpatialChangeCandidates {
  previous: readonly AggregateSpatialEnvelope[]
  next: readonly AggregateSpatialEnvelope[]
  affected: readonly AggregateSpatialEntityRef[]
}

export interface AggregateSpatialIndex {
  readonly audience: AggregateSpatialAudience
  readonly sourceHash: string
  readonly cellSizeMm: number
}

export interface AggregateSpatialSnapshot {
  readonly index: AggregateSpatialIndex
  readonly query: (query: AggregateSpatialQuery) => readonly AggregateSpatialEnvelope[]
  readonly queryChange: (query: AggregateSpatialChangeQuery) => AggregateSpatialChangeCandidates
}

interface AggregateSpatialIndexState {
  audience: AggregateSpatialAudience
  freshnessHash: string
  cellSizeMm: number
  byCell: Map<string, Set<number>>
  byFloor: Map<string, Set<number>>
  largeByFloor: Map<string, Set<number>>
  envelopes: readonly AggregateSpatialEnvelope[]
}
const SPATIAL_INDEXES = new WeakMap<object, AggregateSpatialIndexState>()
const MAX_CELLS_PER_ENVELOPE = 4096
const MAX_QUERY_CELLS = 65536
const cellKey = (floorId: string, x: number, y: number) => `${floorId}\0${x}\0${y}`
const refKey = (ref: AggregateSpatialEntityRef) => canonicalJson([ref.kind, ref.id])

function validBounds(bounds: BoundsMm): boolean {
  return !!bounds && [bounds.x, bounds.y, bounds.width, bounds.height, bounds.x + bounds.width, bounds.y + bounds.height].every(Number.isFinite)
    && bounds.width >= 0 && bounds.height >= 0
}

function boundsOf(points: readonly PointMm[]): BoundsMm | undefined {
  if (!points.length || points.some(point => !Number.isFinite(point.x) || !Number.isFinite(point.y))) return
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const point of points) {
    minX = Math.min(minX, point.x); minY = Math.min(minY, point.y)
    maxX = Math.max(maxX, point.x); maxY = Math.max(maxY, point.y)
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

function inflate(bounds: BoundsMm, padding: number): BoundsMm {
  return { x: bounds.x - padding, y: bounds.y - padding, width: bounds.width + padding * 2, height: bounds.height + padding * 2 }
}

function intersects(a: BoundsMm, b: BoundsMm): boolean {
  return a.x <= b.x + b.width && b.x <= a.x + a.width && a.y <= b.y + b.height && b.y <= a.y + a.height
}

function publicEnvelopePredicate(scene: SceneDocument): (kind: AggregateSpatialEntityRef['kind'], id: string) => boolean {
  const visibility = createPublicVisibility(scene)
  return (kind, id) => {
    switch (kind) {
      case 'floor': return true
      case 'room': return visibility.room(id)
      case 'wall': return visibility.wall(id)
      case 'opening': return visibility.opening(id)
      case 'prop': return visibility.prop(scene.props[id])
      case 'region': return scene.regions[id].visibility === 'public'
      case 'terrainArea': return visibility.terrainArea(id)
      case 'terrainEdge': return visibility.terrainEdge(id)
      case 'terrainConnection': return visibility.terrainConnection(id)
      case 'path': return visibility.path(id)
      case 'decoration': return visibility.decoration(scene.decorations[id])
      case 'decorationCluster': return visibility.decorationCluster(id)
      case 'surfaceRule': { const rule = scene.surfaceRules[id]; return rule.visibility === 'public' && visibility.terrainArea(rule.supportRef.id) }
      default: return false
    }
  }
}

function deriveEnvelopes(scene: SceneDocument, audience: AggregateSpatialAudience, refs?: readonly AggregateSpatialEntityRef[]): AggregateSpatialEnvelope[] {
  const visible = audience === 'player' ? publicEnvelopePredicate(scene) : () => true, result: AggregateSpatialEnvelope[] = []
  const selected = new Map<AggregateSpatialEntityRef['kind'], Set<string>>()
  if (refs !== undefined) for (const ref of refs) {
    if (!ref || typeof ref.kind !== 'string' || typeof ref.id !== 'string') continue
    const ids = selected.get(ref.kind) ?? new Set<string>()
    ids.add(ref.id); selected.set(ref.kind, ids)
  }
  const records = <T>(rows: Record<string, T>, kind: AggregateSpatialEntityRef['kind']): T[] => refs === undefined ? Object.values(rows)
    : [...(selected.get(kind) ?? [])].filter(id => Object.hasOwn(rows, id)).map(id => rows[id])
  const add = (kind: AggregateSpatialEntityRef['kind'], id: string, floorId: string, role: AggregateSpatialRole, bounds: BoundsMm | undefined) => {
    if (!bounds || !validBounds(bounds)) return
    result.push({ entity: { kind, id }, floorId, role, boundsMm: { ...bounds } })
  }
  const addPoints = (kind: AggregateSpatialEntityRef['kind'], id: string, floorId: string, role: AggregateSpatialRole, points: readonly PointMm[], padding = 0) => {
    const bounds = boundsOf(points)
    add(kind, id, floorId, role, bounds && padding > 0 ? inflate(bounds, padding) : bounds)
  }

  for (const floor of records(scene.floors, 'floor')) if (visible('floor', floor.id)) add('floor', floor.id, floor.id, 'surface', floor.boundsMm)
  for (const room of records(scene.rooms, 'room')) if (visible('room', room.id)) addPoints('room', room.id, room.floorId, 'surface', roomPoints(scene, room))
  const requestedWalls = records(scene.walls, 'wall').filter(wall => visible('wall', wall.id))
  if (requestedWalls.length) {
    const requestedIds = new Set(requestedWalls.map(wall => wall.id))
    const endpoints = new Set(requestedWalls.flatMap(wall => [wall.startVertexId, wall.endVertexId]))
    // Only direct endpoint neighbours can contribute to a requested wall's
    // joins. Filter player-hidden neighbours before any shared geometry exists.
    const geometryWalls = refs === undefined ? requestedWalls : Object.values(scene.walls).filter(wall =>
      (requestedIds.has(wall.id) || endpoints.has(wall.startVertexId) || endpoints.has(wall.endVertexId)) && visible('wall', wall.id))
    const pointsByWall = new Map<string, PointMm[]>()
    for (const shape of wallEnvelopePolygons({ ...scene, walls: Object.fromEntries(geometryWalls.map(wall => [wall.id, wall])) })) {
      if (!requestedIds.has(shape.entityId)) continue
      const points = pointsByWall.get(shape.entityId) ?? []
      points.push(...shape.polygon); pointsByWall.set(shape.entityId, points)
    }
    for (const wall of requestedWalls) addPoints('wall', wall.id, wall.floorId, 'boundary', pointsByWall.get(wall.id) ?? [])
  }
  for (const opening of records(scene.openings, 'opening')) {
    if (!visible('opening', opening.id)) continue
    addPoints('opening', opening.id, opening.floorId, 'boundary', openingEnvelopePolygon(scene, opening.id))
  }
  for (const prop of records(scene.props, 'prop')) {
    if (!visible('prop', prop.id)) continue
    addPoints('prop', prop.id, prop.floorId, 'footprint', propFootprint(prop))
    const radians = prop.rotationDeg * Math.PI / 180, cos = Math.cos(radians), sin = Math.sin(radians), box = prop.visualBoundsMm
    const corners = [[box.x, box.y], [box.x + box.width, box.y], [box.x + box.width, box.y + box.height], [box.x, box.y + box.height]]
      .map(([x, y]) => ({ x: prop.positionMm.x + x! * cos - y! * sin, y: prop.positionMm.y + x! * sin + y! * cos }))
    addPoints('prop', prop.id, prop.floorId, 'visual', corners)
  }
  for (const region of records(scene.regions, 'region')) if (visible('region', region.id)) addPoints('region', region.id, region.floorId, 'boundary', region.boundaryMm)
  for (const area of records(scene.terrainAreas, 'terrainArea')) if (visible('terrainArea', area.id)) addPoints('terrainArea', area.id, area.floorId, 'surface', terrainPoints(area))
  for (const edge of records(scene.terrainEdges, 'terrainEdge')) {
    if (!visible('terrainEdge', edge.id)) continue
    const area = scene.terrainAreas[edge.source.areaId], index = area?.boundaryMm.findIndex(point => point.segmentId === edge.source.segmentId) ?? -1
    if (area && index >= 0) addPoints('terrainEdge', edge.id, edge.floorId, 'visual', [area.boundaryMm[index].positionMm, area.boundaryMm[(index + 1) % area.boundaryMm.length].positionMm], (edge.styleOverride?.bandWidthMm ?? 0) / 2)
  }
  for (const connection of records(scene.terrainConnections, 'terrainConnection')) {
    if (!visible('terrainConnection', connection.id)) continue
    const route = connection.route ? connectionRouteSchema.parse(connection.route) : undefined
    addPoints('terrainConnection', connection.id, connection.floorId, 'route', connectionFootprint({ from: connection.from, to: connection.to, widthMm: connection.widthMm, route }))
  }
  for (const path of records(scene.paths, 'path')) if (visible('path', path.id)) addPoints('path', path.id, path.floorId, 'route', pathPolygon(path))
  for (const cluster of records(scene.decorationClusters ?? {}, 'decorationCluster')) if (visible('decorationCluster', cluster.id)) add('decorationCluster', cluster.id, cluster.floorId, 'visual', cluster.boundsMm)
  for (const rule of records(scene.surfaceRules ?? {}, 'surfaceRule')) if (visible('surfaceRule', rule.id)) for (const region of rule.regionsMm) addPoints('surfaceRule', rule.id, rule.floorId, 'visual', region.outerMm)
  for (const decoration of records(scene.decorations ?? {}, 'decoration')) if (visible('decoration', decoration.id)) add('decoration', decoration.id, decoration.floorId, 'visual', { x: decoration.positionMm.x, y: decoration.positionMm.y, width: 0, height: 0 })
  return result.sort((a, b) => a.floorId.localeCompare(b.floorId) || a.entity.kind.localeCompare(b.entity.kind) || a.entity.id.localeCompare(b.entity.id) || a.role.localeCompare(b.role))
}

/**
 * Read-only geometry extraction from the caller's complete validated world
 * document. This neither authenticates the scene nor grants editing authority.
 * Missing/non-spatial refs produce no envelope; callers must fall back safely.
 */
export function deriveAggregateEntityEnvelopes(
  scene: SceneDocument,
  refs: readonly AggregateSpatialEntityRef[],
  audience: AggregateSpatialAudience = 'gm',
): readonly AggregateSpatialEnvelope[] {
  const issue = inspectJsonInput(refs)
  if (issue || !Array.isArray(refs)) throw new Error(`空间实体引用无效：${issue?.message ?? '须提供引用数组。'}`)
  if (audience !== 'gm' && audience !== 'player') throw new Error('空间包络须明确选择主持人或玩家受众。')
  if (scene.aggregateCoordinates?.encoding === 'local') throw new Error('空间包络提取只接受已解码的world场景视图。')
  return freezeJson(deriveEnvelopes(scene, audience, refs))
}

function cellRange(bounds: BoundsMm, cellSizeMm: number) {
  const minX = Math.floor(bounds.x / cellSizeMm), minY = Math.floor(bounds.y / cellSizeMm)
  const maxX = Math.floor((bounds.x + bounds.width) / cellSizeMm), maxY = Math.floor((bounds.y + bounds.height) / cellSizeMm)
  // An unsafe cell coordinate cannot be advanced reliably with x++/y++.
  // Keep finite fractional geometry; only unsafe grid addresses need fallback.
  const count = [minX, minY, maxX, maxY].every(Number.isSafeInteger)
    ? (maxX - minX + 1) * (maxY - minY + 1) : Infinity
  return { minX, minY, maxX, maxY, count }
}

function checkedScene(input: unknown): SceneDocument {
  const result = validateSceneDocument(input)
  if (!result.ok) throw new Error(`空间索引拒绝无效场景：${result.errors[0]?.message ?? '完整场景校验失败。'}`)
  if (result.document.aggregateCoordinates?.encoding === 'local') throw new Error('空间索引只接受已解码的world场景视图。')
  return result.document
}

function buildIndexForScene(
  scene: SceneDocument,
  options: { audience: AggregateSpatialAudience; cellSizeMm?: number },
): AggregateSpatialIndex {
  const optionsIssue = inspectJsonInput(options)
  if (optionsIssue || !options || typeof options !== 'object') throw new Error(`空间索引选项无效：${optionsIssue?.message ?? '须提供受众。'}`)
  const cellSizeMm = options.cellSizeMm ?? 10_000
  if (options.audience !== 'gm' && options.audience !== 'player') throw new Error('空间索引须明确选择主持人或玩家受众。')
  if (!Number.isSafeInteger(cellSizeMm) || cellSizeMm <= 0) throw new Error('空间索引网格尺寸须为正安全整数毫米。')
  const envelopes = freezeJson(deriveEnvelopes(scene, options.audience)), byCell = new Map<string, Set<number>>(), byFloor = new Map<string, Set<number>>(), largeByFloor = new Map<string, Set<number>>()
  envelopes.forEach((envelope, index) => {
    const floorItems = byFloor.get(envelope.floorId) ?? new Set<number>()
    floorItems.add(index); byFloor.set(envelope.floorId, floorItems)
    const range = cellRange(envelope.boundsMm, cellSizeMm)
    if (!Number.isSafeInteger(range.count) || range.count > MAX_CELLS_PER_ENVELOPE) {
      const large = largeByFloor.get(envelope.floorId) ?? new Set<number>()
      large.add(index); largeByFloor.set(envelope.floorId, large); return
    }
    for (let x = range.minX; x <= range.maxX; x++) for (let y = range.minY; y <= range.maxY; y++) {
      const key = cellKey(envelope.floorId, x, y), items = byCell.get(key) ?? new Set<number>()
      items.add(index); byCell.set(key, items)
    }
  })
  const freshnessHash = sha256Text(canonicalJson(scene))
  const sourceHash = sha256Text(canonicalJson({ audience: options.audience, cellSizeMm, envelopes }))
  const index: AggregateSpatialIndex = Object.freeze({ audience: options.audience, sourceHash, cellSizeMm })
  SPATIAL_INDEXES.set(index, Object.freeze({ audience: options.audience, freshnessHash, cellSizeMm, byCell, byFloor, largeByFloor, envelopes }))
  return index
}

export function buildAggregateSpatialIndex(
  sceneInput: unknown,
  options: { audience: AggregateSpatialAudience; cellSizeMm?: number },
): AggregateSpatialIndex {
  return buildIndexForScene(checkedScene(sceneInput), options)
}

function checkedIndex(indexInput: unknown, sceneInput: unknown): AggregateSpatialIndexState {
  if (!indexInput || typeof indexInput !== 'object') throw new Error('空间索引必须由当前校验器创建。')
  const index = SPATIAL_INDEXES.get(indexInput)
  if (!index) throw new Error('空间索引伪造或已丢失私有身份。')
  const scene = checkedScene(sceneInput)
  if (index.freshnessHash !== sha256Text(canonicalJson(scene))) throw new Error('空间索引来源已过期，须重新构建。')
  return index
}

function queryIndex(index: AggregateSpatialIndexState, query: AggregateSpatialQuery): readonly AggregateSpatialEnvelope[] {
  const queryIssue = inspectJsonInput(query)
  if (queryIssue) throw new Error(`空间查询拒绝非JSON输入：${queryIssue.message}`)
  const validRoles = new Set<AggregateSpatialRole>(['boundary', 'footprint', 'surface', 'route', 'visual'])
  if (!query || typeof query.floorId !== 'string' || query.floorId.length === 0 || !validBounds(query.boundsMm) || !Number.isFinite(query.marginMm ?? 0) || (query.marginMm ?? 0) < 0
    || query.roles !== undefined && (!Array.isArray(query.roles) || query.roles.some(role => !validRoles.has(role)))) throw new Error('空间查询范围、角色或净空边距无效。')
  const bounds = inflate(query.boundsMm, query.marginMm ?? 0)
  if (!validBounds(bounds)) throw new Error('空间查询扩张后的范围必须有限。')
  const range = cellRange(bounds, index.cellSizeMm)
  const floorItems = index.byFloor.get(query.floorId) ?? new Set<number>(), selected = new Set<number>(index.largeByFloor.get(query.floorId) ?? [])
  if (!Number.isSafeInteger(range.count) || range.count > MAX_QUERY_CELLS) {
    for (const item of floorItems) selected.add(item)
  } else {
    for (let x = range.minX; x <= range.maxX; x++) for (let y = range.minY; y <= range.maxY; y++) for (const item of index.byCell.get(cellKey(query.floorId, x, y)) ?? []) selected.add(item)
  }
  const roles = query.roles ? new Set(query.roles) : undefined
  return freezeJson([...selected].map(item => index.envelopes[item]).filter(envelope => envelope.floorId === query.floorId
    && (!roles || roles.has(envelope.role)) && intersects(envelope.boundsMm, bounds))
    .sort((a, b) => a.entity.kind.localeCompare(b.entity.kind) || a.entity.id.localeCompare(b.entity.id) || a.role.localeCompare(b.role)))
}

function queryChangeIndex(
  index: AggregateSpatialIndexState,
  query: AggregateSpatialChangeQuery,
): AggregateSpatialChangeCandidates {
  const queryIssue = inspectJsonInput(query)
  if (queryIssue || !query) throw new Error(`空间变更查询拒绝非JSON输入：${queryIssue?.message ?? '须提供范围。'}`)
  const options = { floorId: query.floorId, ...(query.marginMm === undefined ? {} : { marginMm: query.marginMm }), ...(query.roles === undefined ? {} : { roles: query.roles }) }
  const previous = queryIndex(index, { ...options, boundsMm: query.previousBoundsMm })
  const next = queryIndex(index, { ...options, boundsMm: query.nextBoundsMm })
  const affected = new Map<string, AggregateSpatialEntityRef>()
  for (const envelope of [...previous, ...next]) affected.set(refKey(envelope.entity), envelope.entity)
  return freezeJson({ previous, next, affected: [...affected.values()].sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id)) })
}

/** Broad-phase AABB candidates only. Exact overlap, clearance, support and
 * passability remain the responsibility of the existing domain validators. */
export function queryAggregateSpatialIndex(indexInput: unknown, sceneInput: unknown, query: AggregateSpatialQuery): readonly AggregateSpatialEnvelope[] {
  return queryIndex(checkedIndex(indexInput, sceneInput), query)
}

/** Queries both positions against a freshly revalidated complete source. */
export function queryAggregateSpatialChange(
  indexInput: unknown,
  sceneInput: unknown,
  query: AggregateSpatialChangeQuery,
): AggregateSpatialChangeCandidates {
  return queryChangeIndex(checkedIndex(indexInput, sceneInput), query)
}

/**
 * Captures one fully validated, independently frozen scene and its private
 * index. Queries stay on that exact snapshot, accept no later scene/proof,
 * and still validate every requested range. This grants no editing authority.
 */
export function createAggregateSpatialSnapshot(
  sceneInput: unknown,
  options: { audience: AggregateSpatialAudience; cellSizeMm?: number },
): AggregateSpatialSnapshot {
  const scene = freezeJson(cloneJson(checkedScene(sceneInput)))
  const index = buildIndexForScene(scene, options), state = SPATIAL_INDEXES.get(index)!
  const query = function(this: void, input: AggregateSpatialQuery, ...extra: unknown[]) {
    if (extra.length) throw new Error('空间快照查询只接受一个查询对象，不接受新的场景或证明。')
    return queryIndex(state, input)
  }
  const queryChange = function(this: void, input: AggregateSpatialChangeQuery, ...extra: unknown[]) {
    if (extra.length) throw new Error('空间快照变更查询只接受一个查询对象，不接受新的场景或证明。')
    return queryChangeIndex(state, input)
  }
  return Object.freeze({ index,
    query,
    queryChange,
  })
}
