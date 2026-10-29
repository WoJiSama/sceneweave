import { visualBase } from './base.js'
import { z } from 'zod'
import type { PreparationContext } from '../ports/runtime.js'
import type { SceneDocument, TerrainArea, PointMm } from '../model/scene.js'
import { COMMAND_LIMIT, LAYER_ENTITY_COLLECTIONS } from '../model/scene.js'
import { geometryIdentityIds } from '../commands/domain.js'
import { inspectOutdoorChanges, outdoorDependencies, type OutdoorImpact } from '../commands/outdoor.js'
import { cloneJson, inspectJsonInput } from '../validation/json.js'
import { id, style } from '../validation/primitives.js'
import { corridor, pathPolygon, polygonDistance, pointInPolygon, propFootprint, roomPoints, terrainPoints } from '../geometry/geometry.js'
import { VISUAL_ENTITY_COLLECTIONS, visualBindingEntityIds } from './diagnostics.js'
import { sampleVisualBoundary, terrainBoundaryChain } from './geometry.js'
import { emptyVisualSystem, type VisualBoundary, type VisualEntity, type VisualSystem } from './types.js'
import { visualBoundarySchema, visualEdgeLookSchema, visualEnvironmentSchema, visualFilterSchema, visualFogSchema, visualLightSchema } from './schema.js'
import { getLegacyVisual, visual3TransitionSchema, type TerrainTransition } from '../terrain-generation/composition-contracts.js'

export const visualCommandSchemas = [
  z.object({ type: z.literal('upsertTerrainTransition'), transition: visual3TransitionSchema }).strict(),
  z.object({ type: z.literal('removeTerrainTransition'), id }).strict(),
  z.object({ type: z.literal('upsertVisualBoundary'), boundary: visualBoundarySchema }).strict(),
  z.object({ type: z.literal('removeVisualBoundary'), id, detach: z.boolean() }).strict(),
  z.object({ type: z.literal('upsertVisualEdgeLook'), edgeLook: visualEdgeLookSchema }).strict(),
  z.object({ type: z.literal('upsertVisualLight'), light: visualLightSchema }).strict(),
  z.object({ type: z.literal('upsertVisualFog'), fog: visualFogSchema }).strict(),
  z.object({ type: z.literal('upsertVisualFilter'), filter: visualFilterSchema }).strict(),
  z.object({ type: z.literal('removeVisualEffect'), kind: z.enum(['edgeLook', 'light', 'fog', 'filter']), id }).strict(),
  z.object({ type: z.literal('setVisualEnvironment'), environment: visualEnvironmentSchema }).strict(),
  z.object({ type: z.literal('setVisualSurface'), kind: z.enum(['room', 'terrainArea', 'wall', 'path', 'terrainEdge', 'terrainConnection']), id, style }).strict(),
] as const
export const visualCommandSchema = z.discriminatedUnion('type', visualCommandSchemas)
export type VisualCommand = z.infer<typeof visualCommandSchema>
const types = new Set<string>(visualCommandSchemas.map(schema => schema.shape.type.value))
export const isVisualCommand = (command: { type: string }): command is VisualCommand => types.has(command.type)
const own = <T>(record: Record<string, T>, value: string): T | undefined => Object.hasOwn(record, value) ? record[value] : undefined
const same = (a: PointMm, b: PointMm) => a.x === b.x && a.y === b.y
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const effects = { edgeLook: 'edgeLooks', light: 'lights', fog: 'fogs', filter: 'filters' } as const
function physicalEntities(scene: SceneDocument) {
  return new Map(LAYER_ENTITY_COLLECTIONS.flatMap(collection => Object.values(scene[collection])).map(entity => [entity.id, entity]))
}
function assertLayer(scene: SceneDocument, entity: VisualEntity): void {
  const layer = own(scene.userLayers, entity.layerId)
  if (!layer || layer.floorId !== entity.floorId || !own(scene.floors, entity.floorId)) throw new Error('视觉对象须选择同Floor现存用户图层。')
  if (layer.editLocked) throw new Error('视觉对象所在用户图层已锁定。')
}
function assertVisualWritable(scene: SceneDocument, incoming: VisualEntity, previous?: VisualEntity): void {
  assertLayer(scene, incoming)
  if (previous) {
    assertLayer(scene, previous)
    if (previous.editLocked || previous.editLocked !== incoming.editLocked) throw new Error('视觉对象已锁定，或试图通过普通编辑更改编辑锁。')
    if (previous.floorId !== incoming.floorId) throw new Error('视觉对象不能通过普通编辑跨Floor迁移。')
  } else {
    if (incoming.editLocked) throw new Error('新视觉对象默认不得带编辑锁。')
    if (geometryIdentityIds(scene).has(incoming.id) || own(scene.userLayers, incoming.id)) throw new Error('视觉对象ID已被其他身份占用。')
  }
}
export function visualCommandRootIds(scene: SceneDocument, command: VisualCommand): string[] {
  const visual = visualBase(scene)
  switch (command.type) {
    case 'upsertTerrainTransition': return [command.transition.id, command.transition.boundaryId]
    case 'removeTerrainTransition': return [command.id]
    case 'upsertVisualBoundary': return [command.boundary.id, ...visualBindingEntityIds(command.boundary), ...(visual?.boundaries[command.boundary.id] ? visualBindingEntityIds(visual.boundaries[command.boundary.id]) : [])]
    case 'removeVisualBoundary': return [command.id, ...(visual?.boundaries[command.id] ? visualBindingEntityIds(visual.boundaries[command.id]) : [])]
    case 'upsertVisualEdgeLook': return [command.edgeLook.id, command.edgeLook.boundaryId]
    case 'upsertVisualLight': return [command.light.id]
    case 'upsertVisualFog': return [command.fog.id]
    case 'upsertVisualFilter': return [command.filter.id, ...(command.filter.target.kind === 'entities' ? command.filter.target.ids : [])]
    case 'removeVisualEffect': return [command.id]
    case 'setVisualEnvironment': return []
    case 'setVisualSurface': return [command.id]
  }
}
function checkPhysicalLocks(scene: SceneDocument, ids: readonly string[]): void {
  const base = visualBase(scene)
  const materialized = getLegacyVisual(scene)?.materializedEdges ?? {}
  const transitions = scene.visual?.version === 3 ? scene.visual.transitions : {}
  const entities = physicalEntities(scene), locked = [...new Set(ids)].filter(id => {
    const entity = entities.get(id)
    if (entity && (entity.editLocked || scene.userLayers[scene.entityLayers[id]]?.editLocked)) return true
    for (const collection of VISUAL_ENTITY_COLLECTIONS) {
      const visual = base && own(base[collection] as Record<string, VisualEntity>, id)
      if (visual && (visual.editLocked || scene.userLayers[visual.layerId]?.editLocked)) return true
    }
    const edge = own(materialized, id)
    if (edge && (edge.editLocked || scene.userLayers[edge.layerId]?.editLocked)) return true
    const transition = own(transitions, id)
    if (transition && (transition.editLocked || scene.userLayers[transition.layerId]?.editLocked)) return true
    return false
  })
  if (locked.length) throw new Error(`视觉事务涉及锁定对象、图层或依赖：${locked.join('、')}。`)
}
function chainSamplePositions(boundary: VisualBoundary, reverse: boolean): PointMm[] {
  const positions = sampleVisualBoundary(boundary).points.map(point => ({ ...point }))
  if (reverse) {
    positions.reverse()
    if (boundary.closed) positions.unshift(positions.pop()!)
  }
  return positions
}
function freshGeometryId(scene: SceneDocument, context: PreparationContext, used: Set<string>): string {
  const value = context.ids.nextId()
  if (!value || value.length > 256 || value === '__proto__' || used.has(value) || geometryIdentityIds(scene).has(value) || own(scene.userLayers, value)) throw new Error('曲线派生点/段须使用未占用的新身份。')
  used.add(value)
  return value
}
/** Replace only the explicitly bound directed chain and keep both stable anchor identities. */
function replaceTerrainChain(scene: SceneDocument, boundary: VisualBoundary, side: Extract<VisualBoundary['binding'], { kind: 'terrain' }>['sides'][number], context: PreparationContext, used: Set<string>): void {
  const area = own(scene.terrainAreas, side.areaId)
  if (!area || area.floorId !== boundary.floorId) throw new Error('曲线绑定地形不存在或跨Floor。')
  const old = terrainBoundaryChain(area, side, boundary.closed), positions = chainSamplePositions(boundary, side.reverse)
  const start = area.boundaryMm.findIndex(p => p.id === side.startPointId), oldByPosition = new Map(old.map(point => [`${point.positionMm.x},${point.positionMm.y}`, point]))
  const allocated = new Set<string>(), vertices: TerrainArea['boundaryMm'] = []
  for (const [index, positionMm] of positions.entries()) {
    let source = index === 0 ? old[0] : !boundary.closed && index === positions.length - 1 ? old.at(-1)! : undefined
    if (!source) {
      const exact = oldByPosition.get(`${positionMm.x},${positionMm.y}`)
      if (exact && !allocated.has(exact.id) && exact.id !== old[0].id && (boundary.closed || exact.id !== old.at(-1)!.id)) source = exact
      else if (positions.length === old.length && index > 0 && (boundary.closed || index < positions.length - 1) && !allocated.has(old[index].id)) source = old[index]
    }
    const pointId = source?.id ?? freshGeometryId(scene, context, used)
    if (allocated.has(pointId)) throw new Error('曲线采样身份无法唯一对应；请先分步编辑。')
    allocated.add(pointId)
    vertices.push({ id: pointId, segmentId: source?.segmentId ?? '', positionMm })
  }
  // Keep untouched ring rows in their original order. The selected chain may wrap across row zero.
  const selected = new Set(old.map(p => p.id)), rest = boundary.closed ? [] : (() => {
    const result: TerrainArea['boundaryMm'] = []; let index = (area.boundaryMm.findIndex(p => p.id === side.endPointId) + 1) % area.boundaryMm.length
    while (index !== start) { if (!selected.has(area.boundaryMm[index].id)) result.push(cloneJson(area.boundaryMm[index])); index = (index + 1) % area.boundaryMm.length }
    return result
  })()
  const next = [...vertices, ...rest], oldSegments = new Map(area.boundaryMm.map((p, i, all) => [`${p.id}\0${all[(i + 1) % all.length].id}`, p.segmentId]))
  next.forEach((p, i) => { p.segmentId = oldSegments.get(`${p.id}\0${next[(i + 1) % next.length].id}`) ?? freshGeometryId(scene, context, used) })
  area.boundaryMm = next
}
function applyBoundary(scene: SceneDocument, boundary: VisualBoundary, context: PreparationContext): void {
  const visual = visualBase(scene)!, previous = own(visual.boundaries, boundary.id)
  assertVisualWritable(scene, boundary, previous)
  if (previous && !equal(previous.binding, boundary.binding)) throw new Error('更换曲线绑定须先显式解除原绑定，再创建新的边界身份。')
  sampleVisualBoundary(boundary)
  const used = new Set<string>()
  if (boundary.binding.kind === 'terrain') for (const side of boundary.binding.sides) replaceTerrainChain(scene, boundary, side, context, used)
  else if (boundary.binding.kind === 'path') {
    const path = own(scene.paths, boundary.binding.pathId)
    if (!path || path.floorId !== boundary.floorId || boundary.closed) throw new Error('道路曲线须绑定同Floor现存开放道路。')
    const points = sampleVisualBoundary(boundary).points
    if (points.length > 256) throw new Error('道路曲线采样超过256点预算。')
    path.centerlineMm = cloneJson(points)
  }
  visual.boundaries[boundary.id] = cloneJson(boundary)
}
/** T2 writes a stable terrain chain; dependent props remain read-only unless
 * its separate support pass explicitly moves them and checks their locks.
 * The ordinary visual command retains its broader dependency-lock policy. */
export function applyTerrainBoundaryShape(scene: SceneDocument, input: VisualBoundary, context: PreparationContext): void {
  const boundary = visualBoundarySchema.parse(input), previous = visualBase(scene)?.boundaries[boundary.id]
  if (!previous || boundary.binding.kind !== 'terrain' || previous.binding.kind !== 'terrain'
    || !equal(previous.binding, boundary.binding) || previous.closed !== boundary.closed
    || !equal(previous.segments.map(segment => segment.id), boundary.segments.map(segment => segment.id))) {
    throw new Error('局部地形曲线必须保留现存地形绑定与拓扑。')
  }
  if (!equal({ ...previous, segments: [] }, { ...boundary, segments: [] })) {
    throw new Error('局部地形曲线只允许修改控制点，必须保留Floor、图层、锁、秘密与采样参数。')
  }
  checkPhysicalLocks(scene, [boundary.id, ...visualBindingEntityIds(boundary)])
  applyBoundary(scene, boundary, context)
}
function entityShape(scene: SceneDocument, id: string): PointMm[][] {
  if (scene.terrainAreas[id]) return [terrainPoints(scene.terrainAreas[id])]
  if (scene.rooms[id]) return [roomPoints(scene, scene.rooms[id])]
  const prop = scene.props[id]
  if (prop) {
    const v = prop.visualBoundsMm, a = prop.rotationDeg * Math.PI / 180
    return [[{ x: v.x, y: v.y }, { x: v.x + v.width, y: v.y }, { x: v.x + v.width, y: v.y + v.height }, { x: v.x, y: v.y + v.height }].map(p => ({ x: prop.positionMm.x + p.x * Math.cos(a) - p.y * Math.sin(a), y: prop.positionMm.y + p.x * Math.sin(a) + p.y * Math.cos(a) }))]
  }
  if (scene.paths[id]) return [pathPolygon(scene.paths[id])]
  const wall = scene.walls[id]
  if (wall) { const a = scene.vertices[wall.startVertexId], b = scene.vertices[wall.endVertexId]; return a && b ? [corridor({ x: a.xMm, y: a.yMm }, { x: b.xMm, y: b.yMm }, wall.thicknessMm)] : [] }
  if (scene.regions[id]) return [scene.regions[id].boundaryMm]
  const connection = scene.terrainConnections[id]
  if (connection) return [corridor(connection.from.positionMm, connection.to.positionMm, connection.widthMm)]
  return []
}
function relatedVisualLocks(scene: SceneDocument, initial: Iterable<string>): string[] {
  const ids = new Set(initial)
  let changed = true
  while (changed) {
    changed = false
    const add = (id: string) => { if (!ids.has(id)) { ids.add(id); changed = true } }
    for (const group of [...Object.values(scene.prefabInstances), ...Object.values(scene.scatterGroups)]) if (Object.values(group.members).some(member => member.propId !== null && ids.has(member.propId))) add(group.id)
    for (const note of Object.values(scene.notes)) if (note.anchor.type === 'entity' && ids.has(note.anchor.entityId)) add(note.id)
  }
  return [...ids]
}
function circleTouchesShape(center: PointMm, radius: number, points: PointMm[]): boolean {
  if (!points.length) return false
  if (pointInPolygon(center, points)) return true
  return points.some((a, index) => {
    const b = points[(index + 1) % points.length], dx = b.x - a.x, dy = b.y - a.y, square = dx * dx + dy * dy
    const t = square ? Math.max(0, Math.min(1, ((center.x - a.x) * dx + (center.y - a.y) * dy) / square)) : 0
    return Math.hypot(center.x - a.x - t * dx, center.y - a.y - t * dy) <= radius
  })
}
function spatialTargets(scene: SceneDocument, entity: VisualSystem['lights'][string] | VisualSystem['fogs'][string] | VisualSystem['filters'][string]): string[] {
  const all = physicalEntities(scene)
  if ('target' in entity) {
    const target = entity.target
    if (target.kind === 'entities') return relatedVisualLocks(scene, target.ids)
    if (target.kind === 'layer') return relatedVisualLocks(scene, Object.keys(scene.entityLayers).filter(id => scene.entityLayers[id] === target.layerId))
    if (target.kind === 'scene') return [...all.values()].filter(item => item.floorId === entity.floorId).map(item => item.id)
  }
  const shapes = 'radiusMm' in entity ? null : 'boundaryMm' in entity ? entity.boundaryMm : entity.target.kind === 'region' ? entity.target.boundaryMm : []
  const affected = [...all.values()].filter(item => item.floorId === entity.floorId && entityShape(scene, item.id).some(shape => shapes ? polygonDistance(shape, shapes) < 1e-7 : circleTouchesShape((entity as VisualSystem['lights'][string]).positionMm, (entity as VisualSystem['lights'][string]).radiusMm, shape))).map(item => item.id)
  return relatedVisualLocks(scene, affected)
}
function effectDependencies(scene: SceneDocument, command: VisualCommand): string[] {
  const visual = visualBase(scene)
  const materialized = getLegacyVisual(scene)?.materializedEdges ?? {}
  const transitions = scene.visual?.version === 3 ? scene.visual.transitions : {}
  const roots = visualCommandRootIds(scene, command), result = new Set<string>(roots)
  if (command.type === 'upsertTerrainTransition' || command.type === 'removeTerrainTransition') {
    const transition = command.type === 'upsertTerrainTransition' ? command.transition : transitions[command.id]
    if (transition) { result.add(transition.boundaryId); result.add(transition.id) }
  }
  if (command.type === 'upsertVisualBoundary' || command.type === 'removeVisualBoundary') for (const id of outdoorDependencies(scene, roots)) result.add(id)
  if (command.type === 'setVisualSurface') for (const id of relatedVisualLocks(scene, [command.id])) result.add(id)
  for (const root of roots) {
    const boundary = visual?.boundaries[root]
    if (boundary) for (const id of outdoorDependencies(scene, visualBindingEntityIds(boundary))) result.add(id)
    for (const effect of Object.values(visual?.edgeLooks ?? {})) if (effect.boundaryId === root) result.add(effect.id)
    for (const edge of Object.values(materialized)) if (edge.boundaryId === root) result.add(edge.id)
    for (const collection of ['lights', 'fogs', 'filters'] as const) {
      const existing = visual?.[collection][root]
      if (existing) for (const id of spatialTargets(scene, existing)) result.add(id)
    }
  }
  if (command.type === 'setVisualEnvironment') {
    for (const id of physicalEntities(scene).keys()) result.add(id)
    for (const collection of VISUAL_ENTITY_COLLECTIONS) for (const id of Object.keys(visual?.[collection] ?? {})) result.add(id)
    for (const id of Object.keys(materialized)) result.add(id)
  }
  if (command.type === 'upsertVisualFilter') for (const id of spatialTargets(scene, command.filter)) result.add(id)
  if (command.type === 'upsertVisualFog' || command.type === 'upsertVisualLight') for (const id of spatialTargets(scene, command.type === 'upsertVisualFog' ? command.fog : command.light)) result.add(id)
  return [...result].sort()
}
function mutate(scene: SceneDocument, command: VisualCommand, context: PreparationContext): void {
  if (scene.schemaVersion === 1) {
    const initial = emptyVisualSystem()
    const theme = scene.activeStyleThemeRef && scene.styleThemes[scene.activeStyleThemeRef.id]
    if (theme) initial.environment.lightDirectionDeg = theme.terrainCliff.directionDeg ?? theme.shadowPresets.wall.directionDeg
    scene.schemaVersion = 2; scene.visual = initial
  }
  const visual = visualBase(scene)
  if (!visual) throw new Error('视觉指令需要完整视觉系统。')
  switch (command.type) {
    case 'upsertTerrainTransition': {
      if (scene.schemaVersion !== 4 || scene.visual?.version !== 3) throw new Error('地形过渡需要严格scene4/visual3。')
      const previous = scene.visual.transitions[command.transition.id]
      if (previous) {
        if (previous.editLocked || previous.floorId !== command.transition.floorId || previous.boundaryId !== command.transition.boundaryId) throw new Error('过渡已锁定或不能更换来源边界。')
      } else if (geometryIdentityIds(scene).has(command.transition.id) || Object.hasOwn(scene.visual.transitions, command.transition.id)) throw new Error('过渡身份ID已被其他记录占用。')
      assertVisualWritable(scene, command.transition, previous)
      scene.visual.transitions[command.transition.id] = cloneJson(command.transition)
      break
    }
    case 'removeTerrainTransition': {
      if (scene.schemaVersion !== 4 || scene.visual?.version !== 3) throw new Error('地形过渡需要严格scene4/visual3。')
      const previous = scene.visual.transitions[command.id]
      if (!previous) throw new Error('待移除的过渡不存在。')
      assertVisualWritable(scene, previous, previous)
      delete scene.visual.transitions[command.id]
      break
    }
    case 'upsertVisualBoundary': applyBoundary(scene, command.boundary, context); break
    case 'removeVisualBoundary': {
      const boundary = own(visual.boundaries, command.id)
      if (!boundary) throw new Error('待解除的视觉边界不存在。')
      assertVisualWritable(scene, boundary, boundary)
      if (boundary.binding.kind !== 'decoration' && !command.detach) throw new Error('物理曲线须明确detach=true，保留当前几何后解除控制。')
      if (Object.values(visual.edgeLooks).some(edge => edge.boundaryId === boundary.id)) throw new Error('边界仍有边缘外观，请先显式移除外观。')
      if (Object.values(getLegacyVisual(scene)?.materializedEdges ?? {}).some(edge => edge.boundaryId === boundary.id)) {
        throw new Error('边界仍有物化边缘，请先通过明确候选处理依赖；不能只移除来源曲线。')
      }
      delete visual.boundaries[command.id]; break
    }
    case 'upsertVisualEdgeLook': assertVisualWritable(scene, command.edgeLook, own(visual.edgeLooks, command.edgeLook.id)); visual.edgeLooks[command.edgeLook.id] = cloneJson(command.edgeLook); break
    case 'upsertVisualLight': assertVisualWritable(scene, command.light, own(visual.lights, command.light.id)); visual.lights[command.light.id] = cloneJson(command.light); break
    case 'upsertVisualFog': assertVisualWritable(scene, command.fog, own(visual.fogs, command.fog.id)); visual.fogs[command.fog.id] = cloneJson(command.fog); break
    case 'upsertVisualFilter': assertVisualWritable(scene, command.filter, own(visual.filters, command.filter.id)); visual.filters[command.filter.id] = cloneJson(command.filter); break
    case 'removeVisualEffect': {
      const record = visual[effects[command.kind]], entity = own(record as Record<string, VisualEntity>, command.id)
      if (!entity) throw new Error('待移除的视觉效果不存在。')
      assertVisualWritable(scene, entity, entity); delete record[command.id]; break
    }
    case 'setVisualEnvironment': visual.environment = cloneJson(command.environment); break
    case 'setVisualSurface': {
      const collections = { room: 'rooms', terrainArea: 'terrainAreas', wall: 'walls', path: 'paths', terrainEdge: 'terrainEdges', terrainConnection: 'terrainConnections' } as const
      const entity = scene[collections[command.kind]][command.id]
      if (!entity) throw new Error('待编辑材质表面不存在或类型不符。')
      if ('floorStyle' in entity) entity.floorStyle = cloneJson(command.style)
      else if ('topStyle' in entity) entity.topStyle = cloneJson(command.style)
      else entity.surfaceStyle = cloneJson(command.style)
      break
    }
  }
}
function diffRecord(before: Record<string, unknown>, after: Record<string, unknown>, extra: (value: unknown) => number = () => 0): number {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(id => !equal(before[id], after[id])).reduce((sum, id) => sum + 1 + Math.max(extra(before[id]), extra(after[id])), 0)
}
/** Count real control records, sampled points/segments, entities and path samples; no hidden batching. */
export function visualCommandCost(before: SceneDocument, after: SceneDocument): number {
  let cost = inspectOutdoorChanges(before, after, []).commandCost
  if (before.schemaVersion !== after.schemaVersion) cost++
  for (const collection of VISUAL_ENTITY_COLLECTIONS) cost += diffRecord(visualBase(before)?.[collection] ?? {}, visualBase(after)?.[collection] ?? {})
  const transitions = (scene: SceneDocument) => scene.visual?.version === 3 ? scene.visual.transitions : {}
  cost += diffRecord(transitions(before), transitions(after), value => {
    const row = value as TerrainTransition | undefined
    return row ? row.polygons.reduce((sum, polygon) => sum + polygon.pointsMm.length, 0) + row.strokes.reduce((sum, stroke) => sum + stroke.pointsMm.length, 0) : 0
  })
  for (const id of new Set([...Object.keys(visualBase(before)?.boundaries ?? {}), ...Object.keys(visualBase(after)?.boundaries ?? {})])) {
    const segments = (scene: SceneDocument) => Object.fromEntries((visualBase(scene)?.boundaries[id]?.segments ?? []).map(segment => [segment.id, segment]))
    cost += diffRecord(segments(before), segments(after))
  }
  for (const id of new Set([...Object.keys(before.paths), ...Object.keys(after.paths)])) {
    const a = before.paths[id]?.centerlineMm ?? [], b = after.paths[id]?.centerlineMm ?? []
    cost += Array.from({ length: Math.max(a.length, b.length) }, (_, index) => index).filter(index => !equal(a[index], b[index])).length
  }
  if (!equal(visualBase(before)?.environment, visualBase(after)?.environment)) cost++
  const surfaceOverlays = (document: SceneDocument) => Object.fromEntries([
    ...Object.values(document.rooms).map(value => [value.id, value.floorStyle] as const), ...Object.values(document.walls).map(value => [value.id, value.topStyle] as const),
    ...[...Object.values(document.terrainAreas), ...Object.values(document.paths), ...Object.values(document.terrainEdges), ...Object.values(document.terrainConnections)].map(value => [value.id, value.surfaceStyle] as const),
  ].flatMap(([id, surface]) => (surface?.overlays ?? []).map(overlay => [`${id}\0${overlay.id}`, overlay])))
  cost += diffRecord(surfaceOverlays(before), surfaceOverlays(after))
  return cost
}
/** Inspect the exact prepared documents. Never applies commands or allocates geometry identities. */
export function inspectVisualChanges(before: Readonly<SceneDocument>, after: Readonly<SceneDocument>, commands: readonly VisualCommand[]): OutdoorImpact {
  const roots = [...new Set(commands.flatMap(command => [...visualCommandRootIds(before, command), ...visualCommandRootIds(after, command)]))]
  const physical = inspectOutdoorChanges(before, after, roots)
  const visualIds = (document: Readonly<SceneDocument>) => new Map<string, { id: string; layerId: string }>([
    ...VISUAL_ENTITY_COLLECTIONS.flatMap(collection => Object.values(visualBase(document)?.[collection] ?? {})),
    ...Object.values(getLegacyVisual(document)?.materializedEdges ?? {}),
    ...(document.visual?.version === 3 ? Object.values(document.visual.transitions) : []),
  ].map(entity => [entity.id, entity]))
  const a = visualIds(before), b = visualIds(after)
  const dependencies = [...new Set(commands.flatMap(command => [...effectDependencies(before, command), ...effectDependencies(after, command)]))]
  const affectedIds = [...new Set([...physical.affectedIds, ...dependencies])].sort()
  const layerIds = [...new Set([...physical.layerIds, ...affectedIds.flatMap(id => [before.entityLayers[id], after.entityLayers[id], a.get(id)?.layerId, b.get(id)?.layerId]).filter((id): id is string => !!id)])].sort()
  return { ...physical, rootIds: roots.sort(), affectedIds,
    createdIds: [...new Set([...physical.createdIds, ...[...b.keys()].filter(id => !a.has(id))])].sort(),
    changedIds: [...new Set([...physical.changedIds, ...[...a.keys()].filter(id => b.has(id) && !equal(a.get(id), b.get(id)))])].sort(),
    removedIds: [...new Set([...physical.removedIds, ...[...a.keys()].filter(id => !b.has(id))])].sort(),
    layerIds, commandCost: visualCommandCost(before, after), reason: null }
}
/** Detached draft only; caller owns complete atomic validation and revision commit. */
export function applyVisualCommand(scene: SceneDocument, input: VisualCommand, context: PreparationContext): OutdoorImpact {
  const issue = inspectJsonInput(input), parsed = !issue && visualCommandSchema.safeParse(input)
  if (issue || !parsed || !parsed.success) throw new Error(`视觉指令无效：${issue?.message ?? (parsed && !parsed.success ? parsed.error.issues.map(issue => issue.message).join('；') : '')}`)
  const command = parsed.data, before = cloneJson(scene), dependenciesBefore = effectDependencies(before, command)
  if (command.type === 'setVisualEnvironment' && Object.values(before.userLayers).some(layer => layer.editLocked)) throw new Error('全景环境事务涉及锁定用户图层。')
  checkPhysicalLocks(before, dependenciesBefore)
  mutate(scene, command, context)
  const dependenciesAfter = effectDependencies(scene, command), commandCost = visualCommandCost(before, scene)
  checkPhysicalLocks(before, [...dependenciesBefore, ...dependenciesAfter])
  if (commandCost > COMMAND_LIMIT) throw new Error('展开后的视觉事务超过256条操作预算，不能拆批绕过。')
  return inspectVisualChanges(before, scene, [command])
}
