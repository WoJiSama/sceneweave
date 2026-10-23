import { openingEndpointsV2, pointInPolygonV2, polygonDistance } from '../../core/v2/geometry'
import type { BoundsMm, PointMm, SceneDocumentV2 } from '../../core/v2/types'
import { toGeometryDocumentV2 } from '../../core/v3/geometry-view'
import { isCertifiedSceneSnapshotV3, validateSceneSnapshotV3 } from '../../core/v3/snapshots'
import type { SceneDocumentV3 } from '../../core/v3/types'
import { wallOrderV3, type ProjectedWallV3 } from '../../render/v3/projection'
import { wallGeometryV3 } from '../../render/v3/renderer'
import { effectiveEditLockedV2, hitTestAllV2, selectInBoundsV2, selectionGeometryV2 } from '../v2/selection'
import type { SelectionOptionsV2 } from '../v2/selection'
import { summarizeSelectionV2 } from '../v2/selection-summary'

const EPS = 1e-6
const cloneShapes = (shapes: PointMm[][]): PointMm[][] => shapes.map(shape => shape.map(point => ({ ...point })))
const own = <T>(record: Record<string, T>, id: string): T | undefined => Object.hasOwn(record, id) ? record[id] : undefined

/** Only real session hiding propagates through drawing dependencies. Selection scope never does. */
export function hiddenDependentsV3(scene: SceneDocumentV3, hidden: ReadonlySet<string>): Set<string> {
  const ids = new Set(hidden)
  for (const area of Object.values(scene.terrainAreas)) if (ids.has(area.id)) for (const point of area.boundaryMm) ids.add(point.id)
  for (const opening of Object.values(scene.openings)) if (ids.has(opening.wallId)) ids.add(opening.id)
  for (const edge of Object.values(scene.terrainEdges)) if (ids.has(edge.source.areaId) || edge.neighborAreaId !== null && ids.has(edge.neighborAreaId)) ids.add(edge.id)
  for (const connection of Object.values(scene.terrainConnections)) {
    const opening = connection.openingId === null ? undefined : scene.openings[connection.openingId]
    if (ids.has(connection.from.surfaceRef.id) || ids.has(connection.to.surfaceRef.id) || opening && (ids.has(opening.id) || ids.has(opening.wallId))) ids.add(connection.id)
  }
  for (const path of Object.values(scene.paths)) if (path.supportRefs.some(ref => ids.has(ref.id))) ids.add(path.id)
  let changed = true
  while (changed) {
    changed = false
    for (const note of Object.values(scene.notes)) if (!ids.has(note.id) && note.anchor.type === 'entity' && ids.has(note.anchor.entityId)) { ids.add(note.id); changed = true }
  }
  return ids
}

interface WallSelectionGeometryV3 {
  shapes: Map<string, PointMm[][]>
  openingRank: Map<string, number>
  wallRank: Map<string, number>
}
interface SelectionSourceV3 {
  scene: SceneDocumentV3
  domain: SceneDocumentV2
  walls: ProjectedWallV3[]
  wallIds: Set<string>
  layerOrder: Map<string, number>
  bands: Map<string, number>
  wallViews: Map<string, WallSelectionGeometryV3>
  legacyWallShapes: Map<string, PointMm[][]>
}
const sources = new WeakMap<SceneDocumentV3, SelectionSourceV3>()

function sourceFor(scene: SceneDocumentV3): SelectionSourceV3 {
  // A factory may outlive a caller-owned object. Only our own strict, deeply
  // immutable snapshots cache; shallow freezes and subsequent mutations reparse.
  const certified = isCertifiedSceneSnapshotV3(scene), cached = certified ? sources.get(scene) : undefined
  if (cached) return cached
  const checked = validateSceneSnapshotV3(scene)
  if (!checked.ok) throw new Error(`v3 选择场景无效：${checked.errors[0]?.message ?? '结构不合法。'}`)
  const source = checked.document, domain = toGeometryDocumentV2(source, { effectiveLocks: true, layerOrder: true })
  const layerOrder = new Map(Object.entries(source.entityLayers).map(([id, layer]) => [id, source.userLayers[layer].order]))
  const bands = new Map<string, number>()
  const propBand = (id: string): number => source.props[id].renderLayer === 'canopy' ? 12 : source.props[id].renderLayer === 'object' ? 11 : 7
  for (const prop of Object.values(source.props)) bands.set(prop.id, propBand(prop.id))
  for (const group of [...Object.values(source.prefabInstances), ...Object.values(source.scatterGroups)]) {
    let band = 7
    for (const member of Object.values(group.members)) if (member.propId !== null) band = Math.max(band, propBand(member.propId))
    bands.set(group.id, band)
  }
  for (const id of Object.keys(source.vertices)) bands.set(id, 10)
  for (const area of Object.values(source.terrainAreas)) for (const point of area.boundaryMm) { bands.set(point.id, 10); layerOrder.set(point.id, layerOrder.get(area.id)!) }
  for (const [collection, band] of [['openings', 9], ['walls', 8], ['rooms', 6], ['terrainConnections', 4], ['terrainEdges', 3], ['terrainAreas', 2]] as const) {
    for (const id of Object.keys(source[collection])) bands.set(id, band)
  }
  if (Object.keys(source.paths).length) {
    for (const id of Object.keys(source.rooms)) bands.set(id, 4)
    for (const id of Object.keys(source.paths)) bands.set(id, 5)
    for (const id of Object.keys(source.terrainConnections)) bands.set(id, 6)
  }
  const openingsByWall = new Map<string, ProjectedWallV3['openings']>()
  for (const opening of Object.values(source.openings)) {
    const [start, end] = openingEndpointsV2(source, opening)
    const projected = { id: opening.id, start, end, widthMm: opening.widthMm, kind: opening.kind, state: opening.state, secret: opening.secret }
    const entries = openingsByWall.get(opening.wallId)
    if (entries) entries.push(projected)
    else openingsByWall.set(opening.wallId, [projected])
  }
  // This is the native GM projected wall contract, not a v2 renderer input.
  // Hidden openings remain in this list so their physical hole stays intact.
  const walls: ProjectedWallV3[] = Object.values(source.walls).map(wall => ({
    id: wall.id, sourceIds: [wall.id], start: { x: source.vertices[wall.startVertexId].xMm, y: source.vertices[wall.startVertexId].yMm },
    end: { x: source.vertices[wall.endVertexId].xMm, y: source.vertices[wall.endVertexId].yMm }, thicknessMm: wall.thicknessMm, style: wall.topStyle,
    openings: openingsByWall.get(wall.id) ?? [],
  })).sort((a, b) => layerOrder.get(a.id)! - layerOrder.get(b.id)! || wallOrderV3(a, b))
  const result: SelectionSourceV3 = { scene: source, domain, walls, wallIds: new Set(walls.map(wall => wall.id)), layerOrder, bands, wallViews: new Map(), legacyWallShapes: new Map() }
  if (certified) sources.set(scene, result)
  return result
}

function wallView(source: SelectionSourceV3, visibleHiddenIds?: ReadonlySet<string>): WallSelectionGeometryV3 {
  // Only hidden walls affect solid bands and joins. The key is derived from
  // current contents, so mutating a Set cannot reuse stale wall geometry.
  const hiddenWalls = source.walls.filter(wall => visibleHiddenIds?.has(wall.id)).map(wall => wall.id), key = JSON.stringify(hiddenWalls)
  const cached = source.wallViews.get(key)
  if (cached) return cached
  const walls = hiddenWalls.length ? source.walls.filter(wall => !visibleHiddenIds!.has(wall.id)) : source.walls
  const openingIds = walls.flatMap(wall => wall.openings.map(opening => opening.id)).sort((a, b) => source.layerOrder.get(a)! - source.layerOrder.get(b)!)
  const result = { shapes: new Map(wallGeometryV3(walls).map(wall => [wall.wall.id, wall.polygons])), openingRank: new Map(openingIds.map((id, rank) => [id, rank])), wallRank: new Map(walls.map((wall, rank) => [wall.id, rank])) }
  // Session isolation may change often. Retain a bounded set of wall views.
  if (source.wallViews.size >= 4) source.wallViews.delete(source.wallViews.keys().next().value!)
  source.wallViews.set(key, result)
  return result
}

function sortIds(source: SelectionSourceV3, view: WallSelectionGeometryV3, ids: string[]): string[] {
  const scene = source.scene
  return ids.map((id, index) => ({ id, index })).sort((a, b) => {
    const band = (source.bands.get(b.id) ?? 0) - (source.bands.get(a.id) ?? 0)
    if (band) return band
    const areaA = own(scene.terrainAreas, a.id), areaB = own(scene.terrainAreas, b.id)
    if (areaA && areaB && areaA.coveragePriority !== areaB.coveragePriority) return areaB.coveragePriority - areaA.coveragePriority
    const edgeA = own(scene.terrainEdges, a.id), edgeB = own(scene.terrainEdges, b.id)
    if (edgeA && edgeB) {
      const elevation = (edge: typeof edgeA) => Math.max(scene.terrainAreas[edge.source.areaId].groundElevationMm, edge.neighborAreaId === null ? 0 : scene.terrainAreas[edge.neighborAreaId].groundElevationMm)
      const height = elevation(edgeB) - elevation(edgeA)
      if (height) return height
    }
    const layer = (source.layerOrder.get(b.id) ?? 0) - (source.layerOrder.get(a.id) ?? 0)
    if (layer) return layer
    const pathA = own(scene.paths, a.id), pathB = own(scene.paths, b.id)
    if (pathA && pathB) return pathB.renderOrder - pathA.renderOrder || pathB.id.localeCompare(pathA.id)
    if (source.wallIds.has(a.id) && source.wallIds.has(b.id)) return view.wallRank.get(b.id)! - view.wallRank.get(a.id)!
    if (own(scene.openings, a.id) && own(scene.openings, b.id)) return (view.openingRank.get(b.id) ?? 0) - (view.openingRank.get(a.id) ?? 0)
    return a.index - b.index
  }).map(item => item.id)
}

function queryHidden(source: SelectionSourceV3, visibleHiddenIds?: ReadonlySet<string>, options: SelectionOptionsV2 = {}): Set<string> {
  const hidden = visibleHiddenIds?.size ? hiddenDependentsV3(source.scene, visibleHiddenIds) : new Set<string>()
  if (options.hiddenIds) for (const id of options.hiddenIds) hidden.add(id)
  return hidden
}

function boundsPredicate(bounds: BoundsMm, mode: 'contain' | 'intersect'): (shapes: PointMm[][]) => boolean {
  const left = Math.min(bounds.x, bounds.x + bounds.width), right = Math.max(bounds.x, bounds.x + bounds.width)
  const top = Math.min(bounds.y, bounds.y + bounds.height), bottom = Math.max(bounds.y, bounds.y + bounds.height)
  const rectangle = [{ x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom }]
  const inBounds = (point: PointMm) => point.x >= left - EPS && point.x <= right + EPS && point.y >= top - EPS && point.y <= bottom + EPS
  return shapes => shapes.length > 0 && (mode === 'contain' ? shapes.every(shape => shape.every(inBounds)) : shapes.some(shape => shape.some(inBounds) || shape.length >= 3 && rectangle.some(point => pointInPolygonV2(point, shape, true)) || polygonDistance(shape, rectangle) <= EPS))
}

/** V2-compatible callback; walls use the exact visible native Canvas polygons. */
export function hitTestLayersV3(scene: SceneDocumentV3, visibleHiddenIds?: ReadonlySet<string>): typeof hitTestAllV2 {
  return (_domain, point, toleranceMm, options = {}) => {
    const source = sourceFor(scene), view = wallView(source, visibleHiddenIds), hidden = queryHidden(source, visibleHiddenIds, options)
    const nonwallHidden = new Set([...hidden, ...source.wallIds])
    // The proven spatial index remains responsible for props, handles, groups
    // and other primitives. A changed native corner may lie outside its old AABB.
    const ids = hitTestAllV2(source.domain, point, toleranceMm, { ...options, hiddenIds: nonwallHidden })
    for (const [id, shapes] of view.shapes) {
      if (hidden.has(id) || options.floorId !== undefined && source.scene.walls[id].floorId !== options.floorId) continue
      if (shapes.some(shape => pointInPolygonV2(point, shape, true) || polygonDistance(shape, [point]) <= toleranceMm + EPS)) ids.push(id)
    }
    return sortIds(source, view, ids)
  }
}

/** Marquee and select-all share native wall joins, holes, locks and hidden scope. */
export function selectInBoundsLayersV3(scene: SceneDocumentV3, visibleHiddenIds?: ReadonlySet<string>): typeof selectInBoundsV2 {
  return (_domain, bounds, mode, options = {}) => {
    const source = sourceFor(scene), view = wallView(source, visibleHiddenIds), hidden = queryHidden(source, visibleHiddenIds, options)
    const result = selectInBoundsV2(source.domain, bounds, mode, { ...options, hiddenIds: new Set([...hidden, ...source.wallIds]) })
    const matches = boundsPredicate(bounds, mode)
    // V2 counts its wall candidates as hidden above. Remove those exact legacy
    // contributions, then use native geometry for every wall decision/count.
    for (const id of source.wallIds) {
      if (options.floorId !== undefined && source.scene.walls[id].floorId !== options.floorId) continue
      let legacyShapes = source.legacyWallShapes.get(id)
      if (!legacyShapes) { legacyShapes = selectionGeometryV2(source.domain, id); source.legacyWallShapes.set(id, legacyShapes) }
      if (matches(legacyShapes)) result.excludedHidden--
    }
    const allWalls = visibleHiddenIds?.size ? wallView(source).shapes : view.shapes
    for (const id of source.wallIds) {
      if (options.floorId !== undefined && source.scene.walls[id].floorId !== options.floorId) continue
      // Hidden walls contribute only an omission count. They never lend their
      // joins to a visible wall or become selectable through a tolerance query.
      const shapes = view.shapes.get(id) ?? allWalls.get(id) ?? []
      if (!matches(shapes)) continue
      if (hidden.has(id)) result.excludedHidden++
      else if (effectiveEditLockedV2(source.domain, id)) result.excludedLocked++
      else result.ids.push(id)
    }
    result.ids = sortIds(source, view, result.ids)
    return result
  }
}

export function selectionGeometryLayersV3(scene: SceneDocumentV3, visibleHiddenIds?: ReadonlySet<string>): typeof selectionGeometryV2 {
  return (_domain, id) => {
    const source = sourceFor(scene)
    if (source.wallIds.has(id)) return cloneShapes(wallView(source, visibleHiddenIds).shapes.get(id) ?? [])
    if (visibleHiddenIds?.has(id)) return []
    const opening = own(source.scene.openings, id)
    if (opening && visibleHiddenIds?.has(opening.wallId)) return []
    return selectionGeometryV2(source.domain, id)
  }
}

/** Preserve operation-unit/type/lock semantics while replacing native wall bounds. */
export function summarizeSelectionLayersV3(scene: SceneDocumentV3, visibleHiddenIds?: ReadonlySet<string>): typeof summarizeSelectionV2 {
  return (_domain, ids, memberMode = false) => {
    const source = sourceFor(scene), summary = summarizeSelectionV2(source.domain, ids, memberMode)
    const wallIds = summary.ids.filter(id => source.wallIds.has(id))
    if (!wallIds.length) return summary
    const bounds = summarizeSelectionV2(source.domain, summary.ids.filter(id => !source.wallIds.has(id)), true).boundsMm
    let x = bounds?.x ?? Infinity, y = bounds?.y ?? Infinity, right = bounds ? bounds.x + bounds.width : -Infinity, bottom = bounds ? bounds.y + bounds.height : -Infinity
    const walls = wallView(source, visibleHiddenIds).shapes
    for (const id of wallIds) for (const shape of walls.get(id) ?? []) for (const point of shape) {
      x = Math.min(x, point.x); y = Math.min(y, point.y); right = Math.max(right, point.x); bottom = Math.max(bottom, point.y)
    }
    return { ...summary, boundsMm: x === Infinity ? null : { x, y, width: right - x, height: bottom - y } }
  }
}
