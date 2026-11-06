import { commandSelectionLimit, type CommandBudgetProfile } from '../../shared/budget/command-budget.js'
import { propPaintPolygon, scenePresentation } from '../../shared/appearance/presentation.js'
import { isEntityEditLocked as isEntityEditLockedV2 } from '../../shared/commands/base.js'
import { isCertifiedSceneSnapshot as isCertifiedSceneSnapshotV2 } from '../../shared/validation/snapshots.js'
import { connectionFootprint, corridor, openingEndpoints as openingEndpointsV2, pathPolygon as pathPolygonV2, pointInPolygon as pointInPolygonV2, polygonDistance, roomPoints as roomPointsV2, terrainPoints as terrainPointsV2 } from '../../shared/geometry/geometry.js'
import type { BoundsMm, Editable, PointMm, Prop as PropV2, SceneDocument as SceneDocumentV2 } from '../../shared/model/scene.js'
import { orderedPropsV2, wallOrderV2 } from './projection'
import type { ProjectedWallV2 } from './projection'
import { wallGeometryV2 } from '../../platform/browser/render/renderer'
import type { SelectionSummaryV2 } from './selection-summary'
import { decorationPaintGeometry, decorationPaintPolygon } from '../../shared/decorations/presentation.js'
import { buildAggregateChunkManifest, planAggregateChunks } from '../../shared/aggregates/chunks.js'
import { aggregateEntityRelations } from '../../shared/aggregates/relations.js'
import { createAggregateDerivedResidency } from '../../platform/browser/render/aggregate-residency.js'

export interface SelectionOptionsV2 {
  memberMode?: boolean
  /** Session-only omission; this does not change the document or player visibility. */
  hiddenIds?: ReadonlySet<string>
  floorId?: string
}
export interface BoundsSelectionV2 { ids: string[]; excludedLocked: number; excludedHidden: number }
const EPS = 1e-6
const own = <T>(record: Record<string, T>, id: string): T | undefined => Object.hasOwn(record, id) ? record[id] : undefined
const clonePoints = (points: PointMm[]) => points.map(point => ({ ...point }))

/** The actual rotated visual rectangle, independent of physical footprint and shadows. */
export function propVisualPolygonV2(prop: PropV2): PointMm[] {
  const v = prop.visualBoundsMm, a = prop.rotationDeg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a)
  return [[v.x, v.y], [v.x + v.width, v.y], [v.x + v.width, v.y + v.height], [v.x, v.y + v.height]]
    .map(([x, y]) => ({ x: prop.positionMm.x + x * c - y * s, y: prop.positionMm.y + x * s + y * c }))
}

const indexes = new WeakMap<SceneDocumentV2, ReturnType<typeof buildSelectionIndex>>()
function selectionIndex(scene: SceneDocumentV2) {
  // Only owned, strictly validated immutable snapshots have stable geometry and
  // lock dependencies. Caller-owned inputs (including shallow freezes) rebuild.
  if (!isCertifiedSceneSnapshotV2(scene)) return buildSelectionIndex(scene)
  let index = indexes.get(scene)
  if (!index) { index = buildSelectionIndex(scene); indexes.set(scene, index) }
  return index
}
function buildSelectionIndex(scene: SceneDocumentV2) {
  const entities = new Map<string, Pick<Editable, 'id' | 'floorId'>>()
  for (const collection of [scene.props, scene.vertices, scene.walls, scene.openings, scene.rooms, scene.terrainAreas, scene.terrainEdges, scene.terrainConnections, scene.paths, scene.regions, scene.notes, scene.prefabInstances, scene.scatterGroups]) {
    for (const entity of Object.values(collection)) entities.set(entity.id, entity)
  }
  for (const record of [scene.decorations ?? {}, scene.decorationClusters ?? {}]) for (const entity of Object.values(record)) entities.set(entity.id, entity)
  const terrainPoints = new Map<string, PointMm>(), parents = new Map<string, string[]>(), prefabParents = new Map<string, string>()
  for (const area of Object.values(scene.terrainAreas)) for (const point of area.boundaryMm) {
    entities.set(point.id, { id: point.id, floorId: area.floorId }); terrainPoints.set(point.id, point.positionMm)
  }
  for (const group of [...Object.values(scene.prefabInstances), ...Object.values(scene.scatterGroups)]) for (const member of Object.values(group.members)) if (member.propId !== null) {
    parents.set(member.propId, [...(parents.get(member.propId) ?? []), group.id])
    if (own(scene.prefabInstances, group.id)) prefabParents.set(member.propId, group.id)
  }
  for (const group of Object.values(scene.decorationClusters ?? {})) for (const member of Object.values(group.members)) if (member.entityId !== null && member.state !== 'detached') parents.set(member.entityId, [...(parents.get(member.entityId) ?? []), group.id])
  const unit = (id: string, memberMode = false): string | null => entities.has(id) ? !memberMode && prefabParents.has(id) ? prefabParents.get(id)! : id : null
  const normalize = (ids: readonly string[], memberMode = false): string[] => {
    const units = [...new Set(ids.flatMap(id => unit(id, memberMode) ?? []))], present = new Set(units)
    // Explicit containers take precedence even in member mode. Never operate on a member twice.
    return units.filter(id => !(parents.get(id) ?? []).some(parent => present.has(parent)))
  }
  const hidden = (id: string, hiddenIds?: ReadonlySet<string>): boolean => {
    if (!hiddenIds) return false
    if (hiddenIds.has(id) || (parents.get(id) ?? []).some(parent => hiddenIds.has(parent))) return true
    const group = own(scene.prefabInstances, id) ?? own(scene.scatterGroups, id)
    if (group && Object.values(group.members).some(member => member.propId !== null && hiddenIds.has(member.propId))) return true
    const cluster = scene.decorationClusters?.[id]
    return !!cluster && Object.values(cluster.members).some(member => member.entityId !== null && member.state !== 'detached' && hiddenIds.has(member.entityId))
  }
  // GM rendering and picking must agree on both draw order and which wall owns
  // a shared join. Keep each wall's opening order identical to GM projection.
  const projectedWalls: ProjectedWallV2[] = Object.values(scene.walls).map(wall => ({
    id: wall.id, sourceIds: [wall.id], start: { x: scene.vertices[wall.startVertexId].xMm, y: scene.vertices[wall.startVertexId].yMm },
    end: { x: scene.vertices[wall.endVertexId].xMm, y: scene.vertices[wall.endVertexId].yMm }, thicknessMm: wall.thicknessMm, style: wall.topStyle,
    openings: Object.values(scene.openings).filter(item => item.wallId === wall.id).map(item => {
      const [start, end] = openingEndpointsV2(scene, item)
      return { id: item.id, start, end, widthMm: item.widthMm, kind: item.kind, state: item.state, secret: item.secret }
    }),
  })).sort(wallOrderV2)
  // Geometry is detached at the public boundary, but the certified document's
  // selection index may retain its own immutable copies.  This avoids rebuilding
  // every rotated polygon twice during a broad marquee (once for the coarse
  // query and again for the exact predicate).  Uncertified documents never use
  // this index as a cache, so caller-owned mutations remain observable.
  const geometryCache = new Map<string, PointMm[][]>()
  let residency: ReturnType<typeof createAggregateDerivedResidency<PointMm[][]>> | undefined
  let ensureResidency: (() => void) | undefined
  let geometry!: (id: string) => PointMm[][]
  const computeGeometry = (id: string): PointMm[][] => {
    const prop = own(scene.props, id)
    if (prop) return [propPaintPolygon(prop, scenePresentation(scene, prop.id))]
    const decoration = scene.decorations?.[id]
    if (decoration) return [decorationPaintPolygon(decorationPaintGeometry(scene, decoration))]
    const vertex = own(scene.vertices, id), terrainPoint = terrainPoints.get(id)
    if (vertex) return [[{ x: vertex.xMm, y: vertex.yMm }]]
    if (terrainPoint) return [[{ ...terrainPoint }]]
    const room = own(scene.rooms, id), area = own(scene.terrainAreas, id)
    if (room) return [clonePoints(roomPointsV2(scene, room))]
    if (area) return [clonePoints(terrainPointsV2(area))]
    const opening = own(scene.openings, id)
    if (opening) return [corridor(...openingEndpointsV2(scene, opening), scene.walls[opening.wallId].thicknessMm)]
    if (own(scene.walls, id)) {
      const wall = scene.walls[id], endpoints = new Set([wall.startVertexId, wall.endVertexId])
      // Only endpoint neighbors affect this wall's real miter/bevel join.
      // Preserve the complete wall draw order when assigning shared joins.
      const local = projectedWalls.filter(row => row.id === id || [scene.walls[row.id].startVertexId, scene.walls[row.id].endVertexId].some(vertex => endpoints.has(vertex)))
      return wallGeometryV2(local).find(row => row.wall.id === id)!.polygons.map(clonePoints)
    }
    const edge = own(scene.terrainEdges, id)
    if (edge) {
      const boundary = scene.terrainAreas[edge.source.areaId].boundaryMm, i = boundary.findIndex(point => point.segmentId === edge.source.segmentId)
      return i < 0 ? [] : [[{ ...boundary[i].positionMm }, { ...boundary[(i + 1) % boundary.length].positionMm }]]
    }
    const connection = own(scene.terrainConnections, id)
    if (connection) return [connectionFootprint(connection)]
    const path = own(scene.paths, id), region = own(scene.regions, id)
    if (path) return [pathPolygonV2(path)]
    if (region) return [clonePoints(region.boundaryMm)]
    const prefab = own(scene.prefabInstances, id)
    if (prefab) return Object.values(prefab.members).flatMap(member => member.propId === null ? [] : geometry(member.propId))
    const cluster = scene.decorationClusters?.[id]
    if (cluster) return Object.values(cluster.members).flatMap(member => member.entityId === null || member.state === 'detached' ? [] : geometry(member.entityId))
    const scatter = own(scene.scatterGroups, id)
    if (scatter) {
      if (scatter.domain.kind === 'area') return geometry(scatter.domain.areaId)
      if (scatter.domain.kind === 'path') return geometry(scatter.domain.pathId)
      const edgeGeometry = geometry(scatter.domain.edgeId)[0]
      return edgeGeometry?.length === 2 ? [corridor(edgeGeometry[0], edgeGeometry[1], scatter.domain.widthMm)] : []
    }
    return []
  }
  geometry = (id: string): PointMm[][] => {
    const cached = geometryCache.get(id)
    if (cached) return cached
    if (ensureResidency && entities.has(id)) { ensureResidency(); return residency!.materialize(id) }
    const value = computeGeometry(id).filter(shape => shape.length).map(clonePoints)
    geometryCache.set(id, value)
    return value
  }
  // Selectable content follows the actual system paint bands. Path picking uses
  // the same square-cap/miter/bevel band as strict validation and rendering.
  const props = orderedPropsV2(Object.values(scene.props))
  const decorations = Object.values(scene.decorations ?? {}).map(value => decorationPaintGeometry(scene, value))
  const spriteBand = { ground: 0, object: 1, canopy: 2 }
  const sprites = [...props, ...decorations].sort((a, b) => spriteBand[a.renderLayer] - spriteBand[b.renderLayer]
    || (scene.userLayers[scene.entityLayers[a.id]]?.order ?? 0) - (scene.userLayers[scene.entityLayers[b.id]]?.order ?? 0)
    || a.renderOrder - b.renderOrder || (scenePresentation(scene, a.id)?.mode === 'nearSide' && scenePresentation(scene, b.id)?.mode === 'nearSide' ? a.positionMm.y - b.positionMm.y : 0) || a.id.localeCompare(b.id))
  const paths = Object.values(scene.paths).sort((a, b) => b.renderOrder - a.renderOrder || b.id.localeCompare(a.id)).map(path => path.id)
  const connections = Object.keys(scene.terrainConnections).sort((a, b) => a.localeCompare(b)).reverse()
  const surfaces = paths.length ? [...connections, ...paths, ...Object.keys(scene.rooms).reverse()] : [...Object.keys(scene.rooms).reverse(), ...connections]
  const topFirst = [
    ...(decorations.length ? sprites : props).filter(prop => prop.renderLayer !== 'ground').reverse().map(prop => prop.id),
    ...Object.keys(scene.vertices).reverse(), ...[...terrainPoints.keys()].reverse(),
    ...projectedWalls.flatMap(wall => wall.openings.map(opening => opening.id)).reverse(), ...projectedWalls.map(wall => wall.id).reverse(),
    ...(decorations.length ? sprites : props).filter(prop => prop.renderLayer === 'ground').reverse().map(prop => prop.id),
    ...surfaces,
    ...Object.keys(scene.terrainEdges).reverse(),
    ...Object.values(scene.terrainAreas).sort((a, b) => b.coveragePriority - a.coveragePriority || b.id.localeCompare(a.id)).map(area => area.id),
  ]
  type BoundsEntry = { x: number; y: number; right: number; bottom: number }
  const boundsById = new Map<string, BoundsEntry>()
  const pickOrder = new Map(topFirst.map((id, position) => [id, position]))
  const coarse = new Map<string, BoundsMm | null>()
  const wallPadding = new Map<string, number>()
  for (const wall of Object.values(scene.walls)) for (const id of [wall.startVertexId, wall.endVertexId]) wallPadding.set(id, Math.max(wallPadding.get(id) ?? 0, wall.thicknessMm))
  const pointsBounds = (points: readonly PointMm[], padding = 0): BoundsMm | null => {
    if (!points.length) return null
    const x = Math.min(...points.map(point => point.x)) - padding, y = Math.min(...points.map(point => point.y)) - padding
    return { x, y, width: Math.max(...points.map(point => point.x)) - x + padding, height: Math.max(...points.map(point => point.y)) - y + padding }
  }
  const coarseBounds = (id: string): BoundsMm | null => {
    if (coarse.has(id)) return coarse.get(id)!
    const prop = own(scene.props, id), decoration = own(scene.decorations ?? {}, id), vertex = own(scene.vertices, id), terrainPoint = terrainPoints.get(id)
    const wall = own(scene.walls, id), room = own(scene.rooms, id), area = own(scene.terrainAreas, id), opening = own(scene.openings, id)
    const connection = own(scene.terrainConnections, id), path = own(scene.paths, id), region = own(scene.regions, id), edge = own(scene.terrainEdges, id)
    let bounds: BoundsMm | null = null
    if (prop) bounds = pointsBounds(propPaintPolygon(prop, scenePresentation(scene, id)))
    else if (decoration) bounds = pointsBounds(decorationPaintPolygon(decorationPaintGeometry(scene, decoration)))
    else if (vertex) bounds = pointsBounds([{ x: vertex.xMm, y: vertex.yMm }])
    else if (terrainPoint) bounds = pointsBounds([terrainPoint])
    else if (wall) {
      const padding = Math.max(wall.thicknessMm, wallPadding.get(wall.startVertexId) ?? 0, wallPadding.get(wall.endVertexId) ?? 0)
      bounds = pointsBounds([scene.vertices[wall.startVertexId], scene.vertices[wall.endVertexId]].map(point => ({ x: point.xMm, y: point.yMm })), padding)
    } else if (room) bounds = pointsBounds(roomPointsV2(scene, room))
    else if (area) bounds = pointsBounds(area.boundaryMm.map(point => point.positionMm))
    else if (opening) bounds = pointsBounds(openingEndpointsV2(scene, opening), scene.walls[opening.wallId].thicknessMm)
    else if (connection) bounds = pointsBounds(connection.route ? connection.route.segments.flatMap(segment => [segment.start, segment.control1, segment.control2, segment.end]) : [connection.from.positionMm, connection.to.positionMm], connection.widthMm)
    else if (path) bounds = pointsBounds(path.centerlineMm, path.widthMm)
    else if (region) bounds = pointsBounds(region.boundaryMm)
    else if (edge) {
      const boundary = scene.terrainAreas[edge.source.areaId].boundaryMm, index = boundary.findIndex(point => point.segmentId === edge.source.segmentId)
      bounds = index < 0 ? null : pointsBounds([boundary[index].positionMm, boundary[(index + 1) % boundary.length].positionMm])
    } else {
      const prefab = own(scene.prefabInstances, id), cluster = own(scene.decorationClusters ?? {}, id), scatter = own(scene.scatterGroups, id)
      const members = prefab ? Object.values(prefab.members).flatMap(member => member.propId ?? []) : cluster ? Object.values(cluster.members).flatMap(member => member.entityId === null || member.state === 'detached' ? [] : member.entityId) : []
      const memberBounds = members.flatMap(memberId => coarseBounds(memberId) ?? [])
      if (memberBounds.length) bounds = pointsBounds(memberBounds.flatMap(box => [{ x: box.x, y: box.y }, { x: box.x + box.width, y: box.y + box.height }]))
      else if (scatter) {
        const domain = scatter.domain, source = coarseBounds(domain.kind === 'area' ? domain.areaId : domain.kind === 'path' ? domain.pathId : domain.edgeId)
        const padding = domain.kind === 'edgeBand' ? domain.widthMm : 0
        if (source) bounds = { x: source.x - padding, y: source.y - padding, width: source.width + padding * 2, height: source.height + padding * 2 }
      }
    }
    coarse.set(id, bounds); return bounds
  }
  let manifest: ReturnType<typeof buildAggregateChunkManifest> | undefined
  ensureResidency = () => {
    if (residency) return
    const dependencies = new Map<string, Set<string>>()
    for (const relation of aggregateEntityRelations(scene)) if (entities.has(relation.from.id) && entities.has(relation.to.id)) {
      const refs = dependencies.get(relation.from.id) ?? new Set<string>(); refs.add(relation.to.id); dependencies.set(relation.from.id, refs)
    }
    manifest = buildAggregateChunkManifest([...entities.values()].map(entity => ({ id: entity.id, floorId: entity.floorId, boundsMm: coarseBounds(entity.id), dependencies: [...(dependencies.get(entity.id) ?? [])] })))
    residency = createAggregateDerivedResidency(manifest, id => {
      const value = computeGeometry(id).filter(shape => shape.length).map(clonePoints)
      geometryCache.set(id, value)
      return value
    })
  }
  const boundsFor = (id: string): BoundsEntry | null => {
    const known = boundsById.get(id)
    if (known) return known
    let x = Infinity, y = Infinity, right = -Infinity, bottom = -Infinity
    for (const shape of geometry(id)) for (const point of shape) {
      x = Math.min(x, point.x); y = Math.min(y, point.y); right = Math.max(right, point.x); bottom = Math.max(bottom, point.y)
    }
    if (x === Infinity) return null
    const entry = { x, y, right, bottom }
    boundsById.set(id, entry)
    return entry
  }
  const queryCandidates = (bounds: BoundsEntry): string[] => {
    ensureResidency!()
    const possible = new Set<string>()
    for (const floorId of Object.keys(scene.floors)) {
      const plan = planAggregateChunks(manifest!, { floorId, boundsMm: { x: bounds.x, y: bounds.y, width: bounds.right - bounds.x, height: bounds.bottom - bounds.y }, marginMm: EPS })
      residency!.ensure(plan)
      for (const id of plan.entityIds) if (pickOrder.has(id)) possible.add(id)
    }
    // Preserve render/picking order; the spatial index is only a candidate
    // filter and must never change overlap menu ordering.
    return [...possible].filter(id => {
      const candidate = boundsFor(id)
      return candidate !== null && candidate.right >= bounds.x - EPS && candidate.x <= bounds.right + EPS && candidate.bottom >= bounds.y - EPS && candidate.y <= bounds.bottom + EPS
    }).sort((a, b) => pickOrder.get(a)! - pickOrder.get(b)!)
  }
  const normalizedOrders = new Map<boolean, Map<string, number>>()
  const boundsUnits = (ids: string[], memberMode = false) => {
    let order = normalizedOrders.get(memberMode)
    if (!order) { order = new Map(normalize(topFirst, memberMode).map((id, position) => [id, position])); normalizedOrders.set(memberMode, order) }
    return normalize(ids, memberMode).sort((a, b) => order.get(a)! - order.get(b)!)
  }
  const candidatesForPoint = (point: PointMm, tolerance: number) => queryCandidates({ x: point.x - tolerance, y: point.y - tolerance, right: point.x + tolerance, bottom: point.y + tolerance })
  const candidatesForBounds = (bounds: BoundsMm) => {
    const x = Math.min(bounds.x, bounds.x + bounds.width), right = Math.max(bounds.x, bounds.x + bounds.width)
    const y = Math.min(bounds.y, bounds.y + bounds.height), bottom = Math.max(bounds.y, bounds.y + bounds.height)
    return queryCandidates({ x, y, right, bottom })
  }
  const locks = new Map<string, boolean>()
  const locked = (id: string): boolean => {
    if (!locks.has(id)) locks.set(id, isEntityEditLockedV2(scene, id))
    return locks.get(id)!
  }
  return { entities, unit, normalize, hidden, geometry, topFirst, locked, boundsFor, candidatesForPoint, candidatesForBounds, boundsUnits }
}

/** Shapes use polygons (3+ points), segments (2), or edit handles (1). Returned points are detached. */
export function selectionGeometryV2(scene: SceneDocumentV2, id: string): PointMm[][] { return selectionIndex(scene).geometry(id).map(clonePoints) }
export function selectionUnitIdV2(scene: SceneDocumentV2, id: string, memberMode = false): string | null { return selectionIndex(scene).unit(id, memberMode) }
export function normalizeSelectionV2(scene: SceneDocumentV2, ids: readonly string[], memberMode = false): string[] { return selectionIndex(scene).normalize(ids, memberMode) }
export function effectiveEditLockedV2(scene: SceneDocumentV2, id: string): boolean {
  return isCertifiedSceneSnapshotV2(scene) ? selectionIndex(scene).locked(id) : isEntityEditLockedV2(scene, id)
}

/** One index per summary, including callers that own a mutable scene. */
export function readSelectionSummaryV2(scene: SceneDocumentV2, ids: readonly string[], memberMode = false, budget?: CommandBudgetProfile): SelectionSummaryV2 {
  const index = selectionIndex(scene), normalized = index.normalize(ids, memberMode)
  const kinds: [keyof Pick<SceneDocumentV2, 'vertices' | 'rooms' | 'walls' | 'openings' | 'props' | 'regions' | 'notes' | 'terrainAreas' | 'terrainEdges' | 'terrainConnections' | 'paths' | 'prefabInstances' | 'scatterGroups'>, string][] = [
    ['vertices', 'vertex'], ['rooms', 'room'], ['walls', 'wall'], ['openings', 'opening'], ['props', 'prop'], ['regions', 'region'], ['notes', 'note'],
    ['terrainAreas', 'terrainArea'], ['terrainEdges', 'terrainEdge'], ['terrainConnections', 'terrainConnection'], ['paths', 'path'], ['prefabInstances', 'prefabInstance'], ['scatterGroups', 'scatterGroup'],
  ]
  const typeCounts: Record<string, number> = {}
  let effectiveLockedCount = 0, x = Infinity, y = Infinity, right = -Infinity, bottom = -Infinity
  for (const id of normalized) {
    const kind = scene.decorations?.[id] ? 'decoration' : scene.decorationClusters?.[id] ? 'decorationCluster' : kinds.find(([collection]) => Object.hasOwn(scene[collection], id))?.[1] ?? 'terrainPoint'
    typeCounts[kind] = (typeCounts[kind] ?? 0) + 1
    if (index.locked(id)) effectiveLockedCount++
    const b = index.boundsFor(id)
    if (b) { x = Math.min(x, b.x); y = Math.min(y, b.y); right = Math.max(right, b.right); bottom = Math.max(bottom, b.bottom) }
  }
  return { ids: normalized, count: normalized.length, typeCounts, effectiveLockedCount,
    boundsMm: x === Infinity ? null : { x, y, width: right - x, height: bottom - y }, overCommandBudget: normalized.length > commandSelectionLimit(budget) }
}

function validPoint(point: PointMm): boolean { return Number.isFinite(point.x) && Number.isFinite(point.y) }
function containsPoint(shape: PointMm[], point: PointMm, tolerance: number): boolean {
  return shape.length >= 3 && pointInPolygonV2(point, shape, true) || polygonDistance(shape, [point]) <= tolerance + EPS
}
/** Topmost first; locked content remains inspectable by clicking, but hidden content is omitted. */
export function hitTestAllV2(scene: SceneDocumentV2, point: PointMm, toleranceMm: number, options: SelectionOptionsV2 = {}): string[] {
  if (!validPoint(point) || !Number.isFinite(toleranceMm) || toleranceMm < 0) throw new Error('命中测试须使用有限坐标和非负容差。')
  const index = selectionIndex(scene), result: string[] = [], seen = new Set<string>()
  for (const id of index.candidatesForPoint(point, toleranceMm)) {
    if (options.floorId !== undefined && index.entities.get(id)?.floorId !== options.floorId) continue
    const unit = index.unit(id, options.memberMode)!
    if (seen.has(unit) || index.hidden(unit, options.hiddenIds)) continue
    // Props are picked by their visual rectangle only; handle/line tolerance must
    // not turn shadows, padding or the gaps between prefab members into targets.
    const tolerance = own(scene.props, id) || scene.decorations?.[id] ? 0 : toleranceMm
    if (index.geometry(id).some(shape => containsPoint(shape, point, tolerance))) { seen.add(unit); result.push(unit) }
  }
  return result
}

/** Axis-aligned bounds may be dragged in either direction. Both modes include boundary contact. */
export function selectInBoundsV2(scene: SceneDocumentV2, bounds: BoundsMm, mode: 'contain' | 'intersect', options: SelectionOptionsV2 = {}): BoundsSelectionV2 {
  const end = { x: bounds.x + bounds.width, y: bounds.y + bounds.height }
  if (!validPoint(bounds) || !validPoint(end) || mode !== 'contain' && mode !== 'intersect') throw new Error('框选须使用有限矩形及受支持的模式。')
  const left = Math.min(bounds.x, end.x), right = Math.max(bounds.x, end.x), top = Math.min(bounds.y, end.y), bottom = Math.max(bounds.y, end.y)
  const rectangle = [{ x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom }]
  const inBounds = (p: PointMm) => p.x >= left - EPS && p.x <= right + EPS && p.y >= top - EPS && p.y <= bottom + EPS
  const index = selectionIndex(scene), result: BoundsSelectionV2 = { ids: [], excludedLocked: 0, excludedHidden: 0 }
  for (const id of index.boundsUnits(index.candidatesForBounds(bounds), options.memberMode)) {
    if (options.floorId !== undefined && index.entities.get(id)?.floorId !== options.floorId) continue
    const shapes = index.geometry(id).filter(shape => shape.length)
    const matches = shapes.length > 0 && (mode === 'contain' ? shapes.every(shape => shape.every(inBounds)) : shapes.some(shape => shape.some(inBounds) || shape.length >= 3 && rectangle.some(point => pointInPolygonV2(point, shape, true)) || polygonDistance(shape, rectangle) <= EPS))
    if (!matches) continue
    if (index.hidden(id, options.hiddenIds)) { result.excludedHidden++; continue }
    if (index.locked(id)) { result.excludedLocked++; continue }
    result.ids.push(id)
  }
  return result
}

export type { SelectionOptionsV2 as SelectionOptions }
export type { BoundsSelectionV2 as BoundsSelection }
export { propVisualPolygonV2 as propVisualPolygon }
export { selectionGeometryV2 as selectionGeometry }
export { selectionUnitIdV2 as selectionUnitId }
export { normalizeSelectionV2 as normalizeSelection }
export { effectiveEditLockedV2 as effectiveEditLocked }
export { readSelectionSummaryV2 as readSelectionSummary }
export { hitTestAllV2 as hitTestAll }
export { selectInBoundsV2 as selectInBounds }
