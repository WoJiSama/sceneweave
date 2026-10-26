import { applyCompositionCommands } from '../appearance/commands.js'
import { resolveAppearance } from '../appearance/graph.js'
import { buildingDependants, isBuildingCommand, previewBuildingCommands } from '../commands/building.js'
import { effectiveEditLocked } from '../commands/layers.js'
import { inspectOutdoorChanges, isOutdoorCommand, outdoorDependencies, previewOutdoorCommands, reconcileTerrainBoundary } from '../commands/outdoor.js'
import { wallMovementPolygons } from '../geometry/doorway-clearance.js'
import { corridor, openingEndpoints, pathPolygon, pointInPolygon, polygonDistance, polygonsOverlap, propFootprint, roomPoints, terrainPoints } from '../geometry/geometry.js'
import { createPublicVisibility } from '../geometry/visibility.js'
import type { AppearanceSource, CompositionCommand, CompositionContent } from '../model/appearance.js'
import type { ProjectData } from '../model/project.js'
import { collectionFor, LAYER_ENTITY_COLLECTIONS, type BoundsMm, type Editable, type PointMm, type Prop, type SceneDocument, type SurfaceRef, type SurfaceStyle } from '../model/scene.js'
import type { PreparationContext } from '../ports/runtime.js'
import { validateProjectData } from '../project/validate.js'
import { canonicalJson, captureJson, cloneJson } from '../validation/json.js'
import { SceneAuthoringOperationSchema, SceneAuthoringScopeSchema, type SceneAuthoringOperation, type SceneAuthoringScope } from './authoring-protocol.js'

const sorted = (values: Iterable<string>): string[] => [...new Set(values)].sort()
const own = <T>(record: Record<string, T>, id: string): T | undefined => Object.hasOwn(record, id) ? record[id] : undefined
function deny(message: string): never { throw new Error(`AI场景草稿范围无效：${message}`) }
const same = (a: unknown, b: unknown): boolean => a === undefined || b === undefined ? a === b : canonicalJson(a) === canonicalJson(b)
const allEntities = (scene: SceneDocument): Map<string, Editable> => new Map(LAYER_ENTITY_COLLECTIONS.flatMap(key => Object.values(scene[key]) as Editable[]).map(value => [value.id, value]))
const entity = (scene: SceneDocument, id: string): Editable | undefined => LAYER_ENTITY_COLLECTIONS.map(key => own<Editable>(scene[key], id)).find(Boolean)
function rectangle(bounds: BoundsMm): PointMm[] {
  if (![bounds.x + bounds.width, bounds.y + bounds.height].every(Number.isSafeInteger)) deny('授权矩形边界超过安全整数。')
  return [{ x: bounds.x, y: bounds.y }, { x: bounds.x + bounds.width, y: bounds.y }, { x: bounds.x + bounds.width, y: bounds.y + bounds.height }, { x: bounds.x, y: bounds.y + bounds.height }]
}
const inside = (bounds: BoundsMm, points: readonly PointMm[]): boolean => points.length > 0 && points.every(p => Number.isFinite(p.x) && Number.isFinite(p.y)
  && p.x >= bounds.x - 1e-7 && p.y >= bounds.y - 1e-7 && p.x <= bounds.x + bounds.width + 1e-7 && p.y <= bounds.y + bounds.height + 1e-7)
function visualPoints(prop: Prop): PointMm[] {
  const b = prop.visualBoundsMm
  return propFootprint({ ...prop, footprintMm: { width: b.width, height: b.height }, footprintOffsetMm: { x: b.x + b.width / 2, y: b.y + b.height / 2 } })
}
function ownsWall(scene: SceneDocument, roomId: string, wallId: string): boolean {
  const room = scene.rooms[roomId], wall = scene.walls[wallId]
  return !!room && !!wall && room.boundaryVertexIds.some((id, i, all) => id === wall.startVertexId && all[(i + 1) % all.length] === wall.endVertexId || id === wall.endVertexId && all[(i + 1) % all.length] === wall.startVertexId)
}
function wallIdsForRoom(scene: SceneDocument, roomId: string): string[] { return Object.keys(scene.walls).filter(id => ownsWall(scene, roomId, id)) }
function edgeShape(scene: SceneDocument, id: string, widthMm?: number): PointMm[] {
  const edge = scene.terrainEdges[id], area = edge && scene.terrainAreas[edge.source.areaId]
  const index = area?.boundaryMm.findIndex(p => p.segmentId === edge.source.segmentId) ?? -1
  if (!edge || !area || index < 0) deny('来源边缘缺少真实地形边段。')
  const theme = scene.activeStyleThemeRef && scene.styleThemes[scene.activeStyleThemeRef.id]
  const width = widthMm ?? Math.max(1, edge.styleOverride?.bandWidthMm ?? (theme ? theme.edgeStyles[edge.kind].bandWidthMm : 1), edge.styleOverride?.strokeWidthMm ?? 0)
  return corridor(area.boundaryMm[index].positionMm, area.boundaryMm[(index + 1) % area.boundaryMm.length].positionMm, width)
}
/** Full wall bands and the production miter/bevel joins, including nonblocking walls. */
function wallShapes(scene: SceneDocument, id: string): PointMm[][] {
  const wall = scene.walls[id]
  if (!wall) return []
  // Give this local geometry view collision-proof IDs; the production helper joins IDs in its output.
  const walls = Object.values(scene.walls).filter(value => value.floorId === wall.floorId), names = new Map(walls.map((value, i) => [value.id, `wall-${i}`]))
  const projected = { ...scene, openings: {}, walls: Object.fromEntries(walls.map(value => [names.get(value.id)!, { ...value, id: names.get(value.id)!, blocksMovement: true }])) }
  const target = names.get(id)!
  return wallMovementPolygons(projected).filter(shape => shape.entityId.split('、').includes(target)).map(shape => shape.polygon)
}
function shapes(scene: SceneDocument, id: string, visited = new Set<string>()): PointMm[][] {
  if (visited.has(id)) return []
  visited.add(id)
  const value = entity(scene, id)
  if (!value) return []
  if (scene.rooms[id]) return [roomPoints(scene, scene.rooms[id]), ...wallIdsForRoom(scene, id).flatMap(wallId => wallShapes(scene, wallId))]
  if (scene.walls[id]) return wallShapes(scene, id)
  if (scene.vertices[id]) return [[{ x: scene.vertices[id].xMm, y: scene.vertices[id].yMm }]]
  if (scene.openings[id]) return [corridor(...openingEndpoints(scene, scene.openings[id]), scene.walls[scene.openings[id].wallId].thicknessMm)]
  if (scene.props[id]) return [visualPoints(scene.props[id]), propFootprint(scene.props[id])]
  if (scene.terrainAreas[id]) return [terrainPoints(scene.terrainAreas[id])]
  if (scene.terrainEdges[id]) return [edgeShape(scene, id)]
  if (scene.terrainConnections[id]) { const c = scene.terrainConnections[id]; return [corridor(c.from.positionMm, c.to.positionMm, c.widthMm)] }
  if (scene.paths[id]) return [pathPolygon(scene.paths[id])]
  if (scene.regions[id]) return [scene.regions[id].boundaryMm]
  if (scene.notes[id]) { const anchor = scene.notes[id].anchor; return anchor.type === 'point' ? [[anchor.positionMm]] : shapes(scene, anchor.entityId, visited) }
  const group = scene.prefabInstances[id] ?? scene.scatterGroups[id]
  if (group) {
    const points = Object.values(group.members).flatMap(member => member.propId === null ? [] : shapes(scene, member.propId, visited))
    if (scene.prefabInstances[id]) points.push([scene.prefabInstances[id].anchorMm])
    else {
      const domain = scene.scatterGroups[id].domain
      points.push(...(domain.kind === 'area' ? [terrainPoints(scene.terrainAreas[domain.areaId])] : domain.kind === 'path' ? [pathPolygon(scene.paths[domain.pathId])] : [edgeShape(scene, domain.edgeId, domain.widthMm)]))
    }
    return points
  }
  return []
}
function unmasked(scene: SceneDocument, floorId: string, polygons: PointMm[][]): void {
  for (const mask of Object.values(scene.regions)) if (mask.floorId === floorId && mask.kind === 'manualMask') for (const polygon of polygons) {
    if (polygonsOverlap(polygon, mask.boundaryMm) || polygon.some(p => pointInPolygon(p, mask.boundaryMm)) || polygon.length >= 3 && mask.boundaryMm.some(p => pointInPolygon(p, polygon))) deny('明确公开范围不能包含玩家遮罩。')
  }
}
function isPublic(scene: SceneDocument, id: string, visited = new Set<string>()): boolean {
  if (visited.has(id)) return false
  visited.add(id)
  const view = createPublicVisibility(scene)
  if (scene.rooms[id]) return view.room(id)
  if (scene.props[id]) return view.prop(scene.props[id])
  if (scene.terrainAreas[id]) return view.terrainArea(id)
  if (scene.paths[id]) return view.path(id)
  if (scene.terrainEdges[id]) return view.terrainEdge(id)
  if (scene.terrainConnections[id]) { const c = scene.terrainConnections[id]; return c.visibility === 'public' && view.surface(c.from.surfaceRef) && view.surface(c.to.surfaceRef) && (c.openingId === null || isPublic(scene, c.openingId, new Set(visited))) }
  if (scene.openings[id]) { const opening = scene.openings[id]; return !opening.secret && isPublic(scene, opening.wallId, new Set(visited)) }
  if (scene.walls[id]) return Object.keys(scene.rooms).filter(roomId => ownsWall(scene, roomId, id)).every(roomId => view.room(roomId))
  if (scene.vertices[id]) return Object.values(scene.walls).filter(wall => [wall.startVertexId, wall.endVertexId].includes(id)).every(wall => isPublic(scene, wall.id, new Set(visited)))
    && Object.values(scene.rooms).filter(room => room.boundaryVertexIds.includes(id)).every(room => view.room(room.id))
  if (scene.regions[id]) return scene.regions[id].visibility === 'public' && scene.regions[id].kind !== 'manualMask'
  if (scene.notes[id]) { const note = scene.notes[id]; return note.visibility === 'public' && (note.anchor.type === 'point' || isPublic(scene, note.anchor.entityId, new Set(visited))) }
  const group = scene.prefabInstances[id] ?? scene.scatterGroups[id]
  return !!group && (scene.scatterGroups[id] ? view.scatterGroup(id) : group.visibility === 'public') && Object.values(group.members).every(member => member.propId === null || !!scene.props[member.propId] && view.prop(scene.props[member.propId]))
}
function assertGeometry(scene: SceneDocument, scope: SceneAuthoringScope, id: string): void {
  const polygons = shapes(scene, id)
  if (!polygons.length || polygons.some(polygon => !inside(scope.boundsMm, polygon))) deny(`实体或真实物理/图像边界超出明确授权范围：${id}。`)
  unmasked(scene, scope.floorId, polygons)
}
function definition(project: ProjectData, id: string): void {
  const value = own(project.document.propDefinitions, id)
  if (!value?.origin.canEmbed || value.tags.includes('sceneweave:retained-appearance')) deny('固定物件定义不可用或不是公开素材。')
}

/** Validate a fixed, explicit grant. Dependencies never silently enlarge this grant. */
export function validateSceneScope(project: ProjectData, input: SceneAuthoringScope): void {
  const scope = SceneAuthoringScopeSchema.parse(captureJson(input)), scene = project.document
  const floor = own(scene.floors, scope.floorId), layer = own(scene.userLayers, scope.layerId)
  if (!floor || !layer || layer.floorId !== floor.id || layer.editLocked) deny('创作Floor或用户图层无效/锁定。')
  if (!inside(floor.boundsMm, rectangle(scope.boundsMm))) deny('创作范围超出世界。')
  unmasked(scene, scope.floorId, [rectangle(scope.boundsMm)])
  for (const id of scope.entityIds) {
    const value = entity(scene, id)
    if (!value || value.floorId !== scope.floorId || !isPublic(scene, id) || effectiveEditLocked(scene, id)) deny(`既有实体须为同Floor的公开、未锁定对象：${id}。`)
    assertGeometry(scene, scope, id)
  }
  scope.definitionIds.forEach(id => definition(project, id))
  for (const id of scope.prefabDefinitionIds) {
    const value = own(scene.prefabDefinitions, id)
    if (!value?.origin.canEmbed || value.tags.includes('sceneweave:retained-appearance')) deny('固定组合定义不可用。')
    for (const member of value.members) if (member.propTemplate.definitionRef) definition(project, member.propTemplate.definitionRef.id)
  }
  for (const id of scope.materialIds) if (!own(scene.materials, id)?.origin.canEmbed) deny('固定材质不可用。')
}

function collectSubject(project: ProjectData, kind: 'asset' | 'propDefinition' | 'prefabDefinition' | 'material', id: string, read: Set<string>): void {
  read.add(id)
  for (const binding of project.licenseBindings) if (binding.subjectKind === kind && binding.subjectId === id) {
    read.add(binding.licenseRef); read.add(binding.licensePath); read.add(binding.licensePath.slice(9, -4))
  }
  const scene = project.document
  if (kind === 'asset') { const asset = scene.assets[id]; if (!asset) deny('素材元数据缺失。'); read.add(asset.sha256) }
  else if (kind === 'material') collectSubject(project, 'asset', scene.materials[id].textureAssetId, read)
  else if (kind === 'propDefinition') { const appearance = scene.propDefinitions[id].defaultAppearance; if (appearance.kind === 'image') collectSubject(project, 'asset', appearance.assetId, read) }
  else for (const member of scene.prefabDefinitions[id].members) {
    const template = member.propTemplate
    if (template.definitionRef) collectSubject(project, 'propDefinition', template.definitionRef.id, read)
    if (template.appearance.kind === 'image') collectSubject(project, 'asset', template.appearance.assetId, read)
  }
}
function collectEntity(project: ProjectData, id: string, read: Set<string>): void {
  const scene = project.document, value = entity(scene, id)
  if (!value) return
  read.add(id); read.add(value.floorId); read.add(scene.entityLayers[id])
  const prop = scene.props[id]
  if (prop) {
    if (prop.definitionRef) collectSubject(project, 'propDefinition', prop.definitionRef.id, read)
    if (prop.appearance.kind === 'image') collectSubject(project, 'asset', prop.appearance.assetId, read)
    let sourceId: string | null = project.appearance.propSources[id]
    const seen = new Set<string>()
    while (sourceId && !seen.has(sourceId)) {
      seen.add(sourceId); read.add(sourceId)
      const source: AppearanceSource = project.appearance.sources[sourceId]
      if (source.kind === 'prop') {
        if (source.snapshot.definitionRef) collectSubject(project, 'propDefinition', source.snapshot.definitionRef.id, read)
        if (source.snapshot.appearance.kind === 'image') collectSubject(project, 'asset', source.snapshot.appearance.assetId, read)
      }
      sourceId = source.parentSourceId
    }
    for (const adjustment of [...(project.appearance.instanceAdjustments[id] ?? []), ...(project.appearance.layerAdjustments[scene.entityLayers[id]] ?? [])]) read.add(adjustment.id)
  }
  const style = scene.rooms[id]?.floorStyle ?? scene.walls[id]?.topStyle ?? scene.terrainAreas[id]?.surfaceStyle ?? scene.terrainEdges[id]?.surfaceStyle ?? scene.terrainConnections[id]?.surfaceStyle ?? scene.paths[id]?.surfaceStyle
  if (style) for (const paint of [style.base, ...style.overlays.map(value => value.paint)]) collectSubject(project, 'material', paint.materialRef.id, read)
  if (scene.prefabInstances[id]) collectSubject(project, 'prefabDefinition', scene.prefabInstances[id].definitionRef.id, read)
  if (scene.scatterGroups[id]) for (const palette of scene.scatterGroups[id].palette) collectSubject(project, 'propDefinition', palette.propDefinitionRef.id, read)
  if (scene.terrainAreas[id]) for (const point of scene.terrainAreas[id].boundaryMm) { read.add(point.id); read.add(point.segmentId) }
}
/** Visual tools share exactly the public geometry/lock/resource boundary of scene tools. */
export function assertPublicSceneEntity(project: ProjectData, scope: Pick<SceneAuthoringScope, 'floorId' | 'boundsMm'>, id: string): string[] {
  const scene = project.document, value = entity(scene, id), read = new Set<string>()
  if (!value || value.floorId !== scope.floorId || !isPublic(scene, id) || effectiveEditLocked(scene, id)) deny('视觉目标须为明确公开、同Floor且未锁定的实体。')
  assertGeometry(scene, scope as SceneAuthoringScope, id); collectEntity(project, id, read)
  return sorted(read)
}
export function sceneReadIds(project: ProjectData, scope: SceneAuthoringScope): string[] {
  const read = new Set([scope.floorId, scope.layerId])
  scope.entityIds.forEach(id => collectEntity(project, id, read))
  scope.definitionIds.forEach(id => collectSubject(project, 'propDefinition', id, read))
  scope.prefabDefinitionIds.forEach(id => collectSubject(project, 'prefabDefinition', id, read))
  scope.materialIds.forEach(id => collectSubject(project, 'material', id, read))
  for (const region of Object.values(project.document.regions)) if (region.floorId === scope.floorId && region.kind === 'manualMask') read.add(region.id)
  return sorted(read)
}

function materialStyle(scene: SceneDocument, id: string): SurfaceStyle {
  const value = scene.materials[id]
  return { base: { materialRef: { id, version: value.version }, tileSizeMm: cloneJson(value.defaultTileSizeMm), rotationDeg: 0, alignment: 'world', originMm: { x: 0, y: 0 }, tint: null, opacity: 1 }, overlays: [] }
}
function commandsFor(project: ProjectData, scope: SceneAuthoringScope, operation: SceneAuthoringOperation, context: PreparationContext, allowed: ReadonlySet<string>): CompositionCommand[] {
  const scene = project.document
  const required = (id: string) => { if (!allowed.has(id) || !entity(scene, id)) deny(`实体/支撑/锚点未明确授权：${id}。`) }
  const fresh = (id: string) => {
    if (entity(scene, id) || Object.hasOwn(scene.userLayers, id) || Object.hasOwn(scene.floors, id) || Object.hasOwn(project.historyIdentity.propTokens, id) || Object.hasOwn(project.historyIdentity.prefabTokens, id) || Object.hasOwn(project.historyIdentity.outdoorTokens, id)) deny('新增ID已占用或带历史出生身份。')
  }
  const support = (ref: SurfaceRef) => {
    if (ref.kind === 'floor') { if (ref.id !== scope.floorId) deny('支撑Floor未获授权。'); return }
    required(ref.id)
    if (!createPublicVisibility(scene).surface(ref) || effectiveEditLocked(scene, ref.id)) deny('支撑必须公开且未锁定。')
  }
  const material = (id: string | undefined, kind: 'room' | 'wall' | 'terrain' | 'path') => {
    if (id === undefined) return {}
    if (!scope.materialIds.includes(id) || !scene.materials[id]?.applicableSurfaces.includes(kind)) deny('固定材质未获授权或不适用。')
    return { materialRef: { id, version: scene.materials[id].version } }
  }
  const common = { floorId: scope.floorId, layerId: scope.layerId }
  switch (operation.kind) {
    case 'room': {
      fresh(operation.id)
      if (operation.supportRef) support(operation.supportRef)
      return [{ type: 'createRoom', id: operation.id, ...common, boundaryMm: operation.boundaryMm, thicknessMm: operation.thicknessMm, purpose: operation.purpose ?? 'AI 房间', ...(operation.supportRef ? { supportRef: operation.supportRef } : {}), ...material(operation.materialId, 'room') }]
    }
    case 'wall': {
      required(operation.id); if (!scene.walls[operation.id]) deny('目标不是墙体。')
      const grantedMaterial = material(operation.materialId, 'wall')
      const commands: CompositionCommand[] = []
      if (operation.thicknessMm !== undefined) commands.push({ type: 'setWallThickness', id: operation.id, thicknessMm: operation.thicknessMm })
      if (grantedMaterial.materialRef) commands.push({ type: 'setSurfaceMaterial', kind: 'wall', id: operation.id, materialRef: grantedMaterial.materialRef })
      return commands
    }
    case 'vertex': required(operation.id); if (!scene.vertices[operation.id]) deny('目标不是建筑顶点。'); return [{ type: 'moveVertex', id: operation.id, positionMm: operation.positionMm }]
    case 'opening':
      fresh(operation.id); required(operation.wallId); required(operation.offsetReferenceVertexId)
      if (!scene.walls[operation.wallId] || !scene.vertices[operation.offsetReferenceVertexId]) deny('门窗须使用授权墙及稳定端点。')
      return [{ type: 'addOpening', id: operation.id, wallId: operation.wallId, offsetReferenceVertexId: operation.offsetReferenceVertexId, offsetMm: operation.offsetMm, widthMm: operation.widthMm, kind: operation.openingKind, state: operation.state ?? 'closed', secret: false, revealed: false, locked: false, layerId: scope.layerId }]
    case 'entrance':
      operation.openingIds.forEach(id => { required(id); if (!scene.openings[id] || scene.openings[id].kind !== 'door') deny('入口必须是授权门。') })
      return [{ type: 'setEntranceOpenings', ids: operation.openingIds }]
    case 'terrain':
      fresh(operation.id)
      return [{ type: 'createTerrainArea', id: operation.id, ...common, boundaryMm: operation.boundaryMm, groundElevationMm: operation.groundElevationMm, coveragePriority: operation.coveragePriority ?? 0, blocksMovement: operation.blocksMovement ?? false, blocksSight: operation.blocksSight ?? false, ...material(operation.materialId, 'terrain') }]
    case 'terrainUpdate': {
      required(operation.id)
      const previous = scene.terrainAreas[operation.id]
      if (!previous) deny('目标不是地形。')
      material(operation.materialId, 'terrain')
      return [{ type: 'updateTerrainArea', id: operation.id, changes: {
        ...(operation.boundaryMm ? { boundaryMm: reconcileTerrainBoundary(previous.boundaryMm, operation.boundaryMm, context) } : {}),
        ...(operation.groundElevationMm !== undefined ? { groundElevationMm: operation.groundElevationMm } : {}),
        ...(operation.coveragePriority !== undefined ? { coveragePriority: operation.coveragePriority } : {}),
        ...(operation.blocksMovement !== undefined ? { blocksMovement: operation.blocksMovement } : {}),
        ...(operation.blocksSight !== undefined ? { blocksSight: operation.blocksSight } : {}),
        ...(operation.materialId ? { surfaceStyle: materialStyle(scene, operation.materialId) } : {}),
      } }]
    }
    case 'edge':
      fresh(operation.id); required(operation.areaId)
      if (!scene.terrainAreas[operation.areaId]?.boundaryMm.some(p => p.segmentId === operation.segmentId)) deny('来源边段不属于授权地形。')
      return [{ type: 'createTerrainEdge', id: operation.id, layerId: scope.layerId, source: { areaId: operation.areaId, segmentId: operation.segmentId }, kind: operation.edgeKind, ...(operation.shoreline !== undefined ? { shoreline: operation.shoreline } : {}), ...(operation.blocksMovement !== undefined ? { blocksMovement: operation.blocksMovement } : {}), ...(operation.blocksSight !== undefined ? { blocksSight: operation.blocksSight } : {}) }]
    case 'connection':
      fresh(operation.id); support(operation.from.surfaceRef); support(operation.to.surfaceRef)
      if (operation.openingId) required(operation.openingId)
      return [{ type: 'createTerrainConnection', id: operation.id, ...common, kind: operation.connectionKind, from: operation.from, to: operation.to, widthMm: operation.widthMm, openingId: operation.openingId ?? null, blocksMovement: operation.blocksMovement ?? false }]
    case 'region':
      fresh(operation.id)
      return [{ type: 'createRegion', id: operation.id, ...common, kind: operation.regionKind, boundaryMm: operation.boundaryMm, visibility: 'public', blocksMovement: operation.blocksMovement ?? false, movementCostMultiplier: operation.movementCostMultiplier ?? 1 }]
    case 'path':
      fresh(operation.id); operation.supportRefs.forEach(support)
      return [{ type: 'createPath', id: operation.id, ...common, centerlineMm: operation.centerlineMm, widthMm: operation.widthMm, supportRefs: operation.supportRefs, ...material(operation.materialId, 'path') }]
    case 'pathUpdate':
      required(operation.id)
      if (!scene.paths[operation.id]) deny('目标不是道路。')
      operation.supportRefs?.forEach(support); material(operation.materialId, 'path')
      return [{ type: 'updatePath', id: operation.id, changes: { ...(operation.centerlineMm ? { centerlineMm: operation.centerlineMm } : {}), ...(operation.widthMm !== undefined ? { widthMm: operation.widthMm } : {}), ...(operation.supportRefs ? { supportRefs: operation.supportRefs } : {}), ...(operation.materialId ? { surfaceStyle: materialStyle(scene, operation.materialId) } : {}) } }]
    case 'scatter': {
      fresh(operation.id)
      required(operation.domain.kind === 'area' ? operation.domain.areaId : operation.domain.kind === 'path' ? operation.domain.pathId : operation.domain.edgeId)
      for (const value of operation.palette) if (!scope.definitionIds.includes(value.definitionId)) deny('散布素材未获明确授权。')
      return [{ type: 'createScatter', id: operation.id, ...common, domain: operation.domain, palette: operation.palette.map(value => ({ key: value.definitionId, propDefinitionRef: { id: value.definitionId, version: scene.propDefinitions[value.definitionId].version }, weight: value.weight })), seed: operation.seed, cellSizeMm: operation.cellSizeMm, densityFactor: operation.densityFactor ?? .25, minDistanceMm: operation.minDistanceMm, rotationRangeDeg: { min: operation.rotationMinDeg ?? 0, max: operation.rotationMaxDeg ?? 359 } }, { type: 'regenerateScatter', id: operation.id }]
    }
    case 'scatterRegenerate':
      required(operation.id)
      if (!scene.scatterGroups[operation.id] || scene.scatterGroups[operation.id].palette.some(value => !scope.definitionIds.includes(value.propDefinitionRef.id))) deny('散布组或其固定素材未获授权。')
      return [{ type: 'regenerateScatter', id: operation.id, ...(operation.densityFactor !== undefined ? { densityFactor: operation.densityFactor } : {}) }]
    case 'prefab': {
      fresh(operation.id); support(operation.supportRef)
      if (!scope.prefabDefinitionIds.includes(operation.definitionId)) deny('固定组合未获授权。')
      const value = scene.prefabDefinitions[operation.definitionId]
      if (!value) deny('固定组合不存在。')
      const memberIds = Object.fromEntries(value.members.map(member => [member.key, context.ids.nextId()]))
      return [{ type: 'instantiatePrefab', id: operation.id, definitionRef: { id: value.id, version: value.version }, memberIds, anchorMm: operation.anchorMm, rotationDeg: operation.rotationDeg ?? 0, layerId: scope.layerId, supportRef: operation.supportRef }]
    }
    case 'furnish':
      fresh(operation.id); support(operation.supportRef)
      if (!scope.definitionIds.includes(operation.definitionId)) deny('家具固定素材未获明确授权。')
      return [{ type: 'addProp', id: operation.id, ...common, definitionRef: { id: operation.definitionId, version: scene.propDefinitions[operation.definitionId].version }, positionMm: operation.positionMm, rotationDeg: operation.rotationDeg ?? 0, supportRef: operation.supportRef }]
    case 'gmNote': {
      fresh(operation.id)
      if (operation.anchor.type === 'entity') {
        required(operation.anchor.entityId)
        if (!own<Editable>(scene[collectionFor[operation.anchor.entityKind]], operation.anchor.entityId)) deny('注记实体类型与真实锚点不匹配。')
      }
      return [{ type: 'createNote', id: operation.id, ...common, anchor: operation.anchor, kind: operation.noteKind, ...(operation.title !== undefined ? { title: operation.title } : {}), text: operation.text, visibility: 'gm', discovered: false }]
    }
    case 'gmNoteUpdate':
      required(operation.id)
      if (!scene.notes[operation.id]) deny('待修改注记不存在。')
      if (scope.entityIds.includes(operation.id) || scene.notes[operation.id].visibility !== 'gm') deny('只可改写本任务新建的GM注记；既有公开文字须新建GM草稿并绑定原注记。')
      return [{ type: 'updateNote', id: operation.id, changes: { ...(operation.title !== undefined ? { title: operation.title } : {}), ...(operation.text !== undefined ? { text: operation.text } : {}) } }]
  }
}

function recordsCost(before: Record<string, unknown>, after: Record<string, unknown>): number {
  return new Set([...Object.keys(before), ...Object.keys(after)]).size === 0 ? 0 : [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(id => !same(before[id], after[id])).length
}
function expansionCost(before: SceneDocument, after: SceneDocument): number {
  let cost = 0
  for (const collection of LAYER_ENTITY_COLLECTIONS) cost += recordsCost(before[collection], after[collection])
  for (const collection of ['prefabInstances', 'scatterGroups'] as const) for (const id of new Set([...Object.keys(before[collection]), ...Object.keys(after[collection])])) cost += recordsCost(before[collection][id]?.members ?? {}, after[collection][id]?.members ?? {})
  for (const id of new Set([...Object.keys(before.terrainAreas), ...Object.keys(after.terrainAreas)])) {
    const points = (scene: SceneDocument) => Object.fromEntries((scene.terrainAreas[id]?.boundaryMm ?? []).map(point => [point.id, point.positionMm]))
    const segments = (scene: SceneDocument) => Object.fromEntries((scene.terrainAreas[id]?.boundaryMm ?? []).map((point, i, all) => [point.segmentId, [point.id, all[(i + 1) % all.length].id]]))
    cost += recordsCost(points(before), points(after)) + recordsCost(segments(before), segments(after))
  }
  for (const id of new Set([...Object.keys(before.scatterGroups), ...Object.keys(after.scatterGroups)])) {
    const records = (scene: SceneDocument) => Object.fromEntries((scene.scatterGroups[id]?.exclusions ?? []).map(value => [value.id, value]))
    cost += recordsCost(records(before), records(after))
  }
  if (!same(before.constraints, after.constraints)) cost++
  return cost
}
function referencedIds(scene: SceneDocument, root: string, result = new Set<string>()): Set<string> {
  if (result.has(root)) return result
  result.add(root)
  const add = (id: string) => { if (entity(scene, id)) referencedIds(scene, id, result) }
  const prop = scene.props[root]
  if (prop) { add(prop.supportRef.id); if (prop.roomId) add(prop.roomId) }
  if (scene.rooms[root]) { const room = scene.rooms[root]; add(room.supportRef.id); room.boundaryVertexIds.forEach(add); wallIdsForRoom(scene, root).forEach(add) }
  if (scene.walls[root]) { add(scene.walls[root].startVertexId); add(scene.walls[root].endVertexId) }
  if (scene.openings[root]) { add(scene.openings[root].wallId); add(scene.openings[root].offsetReferenceVertexId) }
  if (scene.terrainEdges[root]) { add(scene.terrainEdges[root].source.areaId); if (scene.terrainEdges[root].neighborAreaId) add(scene.terrainEdges[root].neighborAreaId!) }
  if (scene.terrainConnections[root]) { const c = scene.terrainConnections[root]; add(c.from.surfaceRef.id); add(c.to.surfaceRef.id); if (c.openingId) add(c.openingId) }
  if (scene.paths[root]) scene.paths[root].supportRefs.forEach(ref => add(ref.id))
  if (scene.notes[root]?.anchor.type === 'entity') add(scene.notes[root].anchor.entityId)
  const group = scene.prefabInstances[root] ?? scene.scatterGroups[root]
  if (group) {
    Object.values(group.members).forEach(member => { if (member.propId) add(member.propId) })
    if (scene.scatterGroups[root]) { const d = scene.scatterGroups[root].domain; add(d.kind === 'area' ? d.areaId : d.kind === 'path' ? d.pathId : d.edgeId) }
  }
  return result
}
/** Native diagnostics may name a hidden collision or locked dependant. Never disclose its identity. */
function diagnostic(scene: SceneDocument, scope: SceneAuthoringScope, allowed: ReadonlySet<string>, message: string): string {
  const disclosed = new Set([...allowed, scope.floorId, scope.layerId, ...scope.definitionIds, ...scope.prefabDefinitionIds, ...scope.materialIds])
  for (const id of allowed) if (scene.entityLayers[id]) disclosed.add(scene.entityLayers[id])
  const undisclosed = [...allEntities(scene).keys(), ...Object.keys(scene.userLayers), ...Object.keys(scene.floors), ...Object.keys(scene.propDefinitions), ...Object.keys(scene.prefabDefinitions), ...Object.keys(scene.materials)].filter(id => !disclosed.has(id))
  return undisclosed.some(id => message.includes(id)) ? '候选涉及未授权的既有内容或依赖；请缩小或重新明确授权范围。' : message
}
/** Replays one finite operation; the outer ledger enforces the returned cumulative expanded cost. */
export function applySceneOperation(project: ProjectData, inputScope: SceneAuthoringScope, inputOperation: SceneAuthoringOperation, context: PreparationContext, allowedEntityIds: ReadonlySet<string>): { project: ProjectData; readIds: string[]; writeIds: string[]; cost: number; createdIds: string[] } {
  const scope = SceneAuthoringScopeSchema.parse(captureJson(inputScope)), operation = SceneAuthoringOperationSchema.parse(captureJson(inputOperation))
  if (!scope.operations.includes(operation.kind)) deny('场景操作未获明确授权。')
  const allowed = new Set([...scope.entityIds, ...allowedEntityIds]), scene = project.document, read = new Set([scope.floorId, scope.layerId])
  const guarded = <T>(prepare: () => T): T => { try { return prepare() } catch (error) { if (!(error instanceof Error)) deny('候选未通过完整校验。'); deny(diagnostic(scene, scope, allowed, error.message)) } }
  const commands = commandsFor(project, scope, operation, context, allowed), affected = new Set<string>()
  let previewCost = 0, prepared: CompositionContent | undefined
  if (commands.every(isBuildingCommand)) {
    const preview = previewBuildingCommands(scene, commands)
    if (preview.reason) deny(diagnostic(scene, scope, allowed, preview.reason))
    preview.affectedIds.forEach(id => affected.add(id)); previewCost = preview.commandCost
  } else if (commands.every(isOutdoorCommand)) {
    // Replay each command with the exact preview IDs before allocating its history tokens.
    // This avoids create+regenerate interleaving a new group token with candidate member IDs.
    let outdoorContent: CompositionContent = { document: project.document, appearance: project.appearance, historyIdentity: project.historyIdentity }
    for (const command of commands) {
      const tape: string[] = [], previewContext: PreparationContext = { clock: context.clock, ids: { nextId: () => { const id = context.ids.nextId(); tape.push(id); return id } } }
      const preview = previewOutdoorCommands(outdoorContent.document, [command], previewContext)
      if (preview.reason) deny(diagnostic(scene, scope, allowed, preview.reason))
      let position = 0
      const replayContext: PreparationContext = { clock: context.clock, ids: { nextId: () => position < tape.length ? tape[position++] : context.ids.nextId() } }
      const current: CompositionContent = outdoorContent
      const applied: CompositionContent = guarded(() => applyCompositionCommands(current, [command], replayContext))
      outdoorContent = applied
      preview.affectedIds.forEach(id => affected.add(id)); previewCost += preview.commandCost
    }
    prepared = outdoorContent
  }
  if (operation.kind === 'wall' && operation.thicknessMm !== undefined || operation.kind === 'vertex') {
    const wallIds = operation.kind === 'wall' ? [operation.id] : Object.values(scene.walls).filter(wall => [wall.startVertexId, wall.endVertexId].includes(operation.id)).map(wall => wall.id)
    buildingDependants(scene, wallIds, [operation.id]).forEach(id => affected.add(id))
  } else if (operation.kind === 'wall') affected.add(operation.id)
  if (operation.kind === 'prefab' || operation.kind === 'furnish') referencedIds(scene, operation.supportRef.id).forEach(id => affected.add(id))
  if (operation.kind === 'gmNote' && operation.anchor.type === 'entity') {
    referencedIds(scene, operation.anchor.entityId).forEach(id => affected.add(id))
    // The annotation command checks these unchanged recursive dependants as well.
    outdoorDependencies(scene, [operation.anchor.entityId]).forEach(id => affected.add(id))
  }
  if (operation.kind === 'gmNoteUpdate') outdoorDependencies(scene, [operation.id]).forEach(id => affected.add(id))
  const content = prepared ?? guarded(() => applyCompositionCommands({ document: project.document, appearance: project.appearance, historyIdentity: project.historyIdentity }, commands, context))
  const next = guarded(() => validateProjectData({ ...project, ...content, document: { ...content.document, revision: scene.revision, updatedAt: scene.updatedAt } }))
  const before = allEntities(scene), after = allEntities(next.document)
  const writeIds = sorted([...new Set([...before.keys(), ...after.keys()])].filter(id => !same(before.get(id), after.get(id)) || scene.entityLayers[id] !== next.document.entityLayers[id]))
  const createdIds = sorted([...after.keys()].filter(id => !before.has(id)))
  writeIds.forEach(id => affected.add(id))
  if (commands.every(isOutdoorCommand)) inspectOutdoorChanges(scene, next.document, commands.map(command => 'areaId' in command ? command.areaId : 'groupId' in command ? command.groupId : command.id)).affectedIds.forEach(id => affected.add(id))
  if (operation.kind === 'wall' && operation.thicknessMm !== undefined || operation.kind === 'vertex') {
    const wallIds = operation.kind === 'wall' ? [operation.id] : Object.values(next.document.walls).filter(wall => [wall.startVertexId, wall.endVertexId].includes(operation.id)).map(wall => wall.id)
    buildingDependants(next.document, wallIds, [operation.id]).forEach(id => affected.add(id))
  }
  // Scatter reads real nearby public obstacles in addition to domain/support references.
  if (operation.kind === 'scatter' || operation.kind === 'scatterRegenerate') {
    const groupId = operation.id, domainPolygons = shapes(next.document, groupId), minimumDistance = next.document.scatterGroups[groupId].minDistanceMm, view = createPublicVisibility(scene)
    for (const prop of Object.values(scene.props)) if (prop.floorId === scope.floorId && view.prop(prop) && domainPolygons.some(polygon => polygonDistance(propFootprint(prop), polygon) <= minimumDistance + 1e-7)) affected.add(prop.id)
  }
  for (const id of [...affected]) { referencedIds(scene, id).forEach(value => affected.add(value)); referencedIds(next.document, id).forEach(value => affected.add(value)) }
  for (const id of affected) {
    const existing = before.get(id), current = after.get(id)
    if (existing) {
      if (!allowed.has(id)) deny('真实依赖未明确授权；请缩小或重新明确授权范围。')
      if (existing.floorId !== scope.floorId || effectiveEditLocked(scene, id) || !isPublic(scene, id) && !(scene.notes[id]?.visibility === 'gm' && !scope.entityIds.includes(id))) deny('真实依赖跨Floor、私密或锁定。')
      assertGeometry(scene, scope, id); collectEntity(project, id, read)
    }
    if (current) {
      if (current.floorId !== scope.floorId) deny('场景候选跨越授权Floor。')
      assertGeometry(next.document, scope, id); collectEntity(next, id, read)
      if (!existing && next.document.entityLayers[id] !== scope.layerId) deny('新增实体越过授权用户图层。')
    }
  }
  if (!same(scene.constraints, next.document.constraints)) { read.add('constraints'); writeIds.push('constraints') }
  const cost = Math.max(1, commands.length, previewCost, expansionCost(scene, next.document))
  if (cost > 256) deny('本次真实展开超过256条累计预算。')
  return { project: next, readIds: sorted(read), writeIds: sorted(writeIds), cost, createdIds }
}

/** Model projection contains only the fixed public grant and this task's generated entities. */
export function publicSceneContext(project: ProjectData, scope: SceneAuthoringScope, allowedIds: ReadonlySet<string>): unknown {
  const document = resolveAppearance({ document: project.document, appearance: project.appearance, historyIdentity: project.historyIdentity }).document, ids = sorted([...scope.entityIds, ...allowedIds]), generated = new Set([...allowedIds].filter(id => !scope.entityIds.includes(id)))
  const entities: unknown[] = []
  for (const id of ids) {
    const value = entity(document, id)
    if (!value || value.floorId !== scope.floorId || !isPublic(document, id) && !(generated.has(id) && document.notes[id]?.visibility === 'gm')) continue
    // The outer draft can also contain prop edits authorized by a different, narrower capability.
    // Those edits are projected by their own context and cannot enlarge this geographic grant.
    if (shapes(document, id).some(polygon => !inside(scope.boundsMm, polygon))) continue
    assertGeometry(document, scope, id)
    const kind = Object.entries(collectionFor).find(([, collection]) => Object.hasOwn(document[collection], id))![0]
    entities.push({ entityKind: kind, ...cloneJson(value) })
  }
  return { floor: { id: scope.floorId, boundsMm: cloneJson(document.floors[scope.floorId].boundsMm) }, layer: { id: scope.layerId }, boundsMm: cloneJson(scope.boundsMm), entities,
    definitions: scope.definitionIds.map(id => cloneJson(document.propDefinitions[id])),
    prefabDefinitions: scope.prefabDefinitionIds.map(id => cloneJson(document.prefabDefinitions[id])),
    materials: scope.materialIds.map(id => cloneJson(document.materials[id])) }
}
