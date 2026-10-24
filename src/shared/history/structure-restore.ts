import { z } from 'zod'
import { inspectJsonInput, cloneJson } from '../validation/json.js'
import { inspectDependencies, type LicenseSubject } from '../commands/dependencies.js'
import { enumerateLayerEntities } from '../commands/layers.js'
import { validateSceneSnapshot } from '../validation/snapshots.js'
import { COMMAND_LIMIT, type Editable, type EntityKind, type Note, type Opening, type Room, type SceneDocument, type Vertex, type Wall } from '../model/scene.js'
import { projectScene } from '../projection/projection.js'
import { mergeHistoryIdentities, validateHistoryIdentity } from './identity.js'
import { assertStructureContinuity, STRUCTURE_COLLECTIONS, structureKind, type StructureContinuity, type StructureKind } from './structure-continuity.js'
import type { HistoryIdentity } from '../model/history.js'


export type StructureRestoreMode = 'geometry' | 'properties'
export interface StructureRestoreRequest {
  ids: string[]
  mode: StructureRestoreMode
  acknowledgedDependencyIds?: string[]
  confirmedLayerIds?: string[]
}
export interface StructureRestoreImpact {
  id: string
  kind: EntityKind
  name: string
  layerId: string
  historicalLayerId: string | null
  role: 'root' | 'geometry' | 'dependency'
  fields: string[]
}
export interface StructureRestoreScope {
  rootIds: string[]
  writeIds: string[]
  dependencyIds: string[]
  impacts: StructureRestoreImpact[]
  requiredLayerIds: string[]
  /** One operation per write target with fields; unchanged writes are still reserved. */
  commandCost: number
  assetIds: string[]
  subjects: LicenseSubject[]
}
type StructureEntity = Vertex | Room | Wall | Opening | Note
export interface StructureRestoreChange {
  id: string
  kind: StructureKind
  name: string
  layerId: string
  fields: string[]
  before: Partial<StructureEntity>
  after: Partial<StructureEntity>
}
export interface StructureRestorePlan extends StructureRestoreScope {
  request: StructureRestoreRequest
  historyIdentity: HistoryIdentity
  document: SceneDocument
  changes: StructureRestoreChange[]
  changed: boolean
}

const id = z.string().min(1).max(256).refine(value => value !== '__proto__', '不能使用保留 ID')
const requestSchema = z.object({ ids: z.array(id).min(1).max(COMMAND_LIMIT), mode: z.enum(['geometry', 'properties']),
  acknowledgedDependencyIds: z.array(id).max(10000).optional(), confirmedLayerIds: z.array(id).max(128).optional() }).strict()
const canonical = (value: unknown): string => JSON.stringify(value, (_key, item: unknown) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item)
const equal = (a: unknown, b: unknown) => canonical(a) === canonical(b)
const own = <T>(record: Record<string, T>, key: string): T | undefined => Object.hasOwn(record, key) ? record[key] : undefined
const sorted = (ids: Iterable<string>) => [...ids].sort((a, b) => a.localeCompare(b))
function freezeJson<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) freezeJson(child)
  }
  return value
}

function checkedScene(scene: SceneDocument, label: string): SceneDocument {
  const result = validateSceneSnapshot(scene)
  if (!result.ok) throw new Error(`${label}场景无效：${result.errors.map(issue => issue.message).join('；')}`)
  return result.document
}
function checkedRequest(input: StructureRestoreRequest): StructureRestoreRequest {
  const issue = inspectJsonInput(input)
  if (issue) throw new Error(`结构恢复选择无效：${issue.message}`)
  const parsed = requestSchema.safeParse(input)
  if (!parsed.success) throw new Error(`结构恢复选择无效：须明确选择 1 至 256 个现存结构及支持的属性组。${parsed.error.issues.map(item => item.message).join('；')}`)
  const request = parsed.data
  for (const values of [request.ids, request.acknowledgedDependencyIds ?? [], request.confirmedLayerIds ?? []]) {
    if (new Set(values).size !== values.length) throw new Error('结构恢复 ID 和确认项不能重复。')
  }
  return request
}
function entity(scene: SceneDocument, kind: StructureKind, id: string): StructureEntity | undefined {
  return own(scene[STRUCTURE_COLLECTIONS[kind]] as Record<string, StructureEntity>, id)
}
function fieldsFor(kind: StructureKind, mode: StructureRestoreMode, value: StructureEntity): string[] {
  if (kind === 'vertex') return ['xMm', 'yMm']
  if (kind === 'room') return mode === 'properties' ? ['purpose', 'visibility', 'accessExpectation'] : []
  if (kind === 'wall') return mode === 'properties' ? ['thicknessMm', 'blocksMovement', 'blocksSight'] : ['thicknessMm']
  if (kind === 'opening') return mode === 'properties' ? ['offsetMm', 'widthMm', 'kind', 'state', 'locked', 'secret', 'revealed'] : ['offsetMm', 'widthMm']
  return [...((value as Note).anchor.type === 'point' ? ['anchor'] : []), ...(mode === 'properties' ? ['kind', 'title', 'text', 'visibility', 'discovered'] : [])]
}
function selectedFields(value: StructureEntity, fields: readonly string[]): Partial<StructureEntity> {
  return Object.fromEntries(fields.filter(field => Object.hasOwn(value, field)).map(field => [field, cloneJson((value as unknown as Record<string, unknown>)[field])])) as Partial<StructureEntity>
}
function roomOwnsWall(room: Room, wall: Wall): boolean {
  return room.boundaryVertexIds.some((id, index) => {
    const next = room.boundaryVertexIds[(index + 1) % room.boundaryVertexIds.length]
    return id === wall.startVertexId && next === wall.endVertexId || id === wall.endVertexId && next === wall.startVertexId
  })
}

function compose(
  currentInput: SceneDocument, currentIdentityInput: HistoryIdentity,
  historicInput: SceneDocument, historicIdentityInput: HistoryIdentity,
  requestInput: StructureRestoreRequest, continuity: StructureContinuity,
): { current: SceneDocument; historic: SceneDocument; request: StructureRestoreRequest; historyIdentity: HistoryIdentity; scope: StructureRestoreScope; writes: Map<string, string[]> } {
  const request = checkedRequest(requestInput), current = checkedScene(currentInput, '当前'), historic = checkedScene(historicInput, '历史')
  const historyIdentity = mergeHistoryIdentities(currentIdentityInput, current, historicIdentityInput, historic)
  const roots = new Set(request.ids), writes = new Map<string, string[]>(), affected = new Set(request.ids)
  const requireStructure = (id: string): StructureKind => {
    const kind = structureKind(historic, id), presentKind = structureKind(current, id)
    if (!kind) throw new Error(`所选历史结构不存在或不支持：${id}。`)
    if (!presentKind || presentKind !== kind) throw new Error(`结构 ${id} 当前不存在或身份类型不符；本批不支持已删除结构重建。`)
    if (entity(current, kind, id)!.floorId !== entity(historic, kind, id)!.floorId) throw new Error(`结构 ${id} 的 Floor 已变化，不能局部恢复。`)
    return kind
  }
  for (const id of request.ids) {
    const kind = requireStructure(id), source = entity(historic, kind, id)!
    writes.set(id, fieldsFor(kind, request.mode, source))
    const vertices = kind === 'room' ? historic.rooms[id].boundaryVertexIds : kind === 'wall' ? [historic.walls[id].startVertexId, historic.walls[id].endVertexId] : []
    for (const vertexId of vertices) { requireStructure(vertexId); writes.set(vertexId, ['xMm', 'yMm']); affected.add(vertexId) }
  }
  // Only roots and their explicit geometry are restored. Adjacent current content is review/lock context.
  assertStructureContinuity(continuity, current, historic, [...writes.keys()])
  const movedVertices = new Set([...writes.keys()].filter(id => !!own(current.vertices, id)))
  const primaryWalls = Object.values(current.walls).filter(wall => roots.has(wall.id) || movedVertices.has(wall.startVertexId) || movedVertices.has(wall.endVertexId)
    || request.ids.some(id => own(current.rooms, id) && roomOwnsWall(current.rooms[id], wall))
    || request.ids.some(id => own(current.openings, id)?.wallId === wall.id))
  const primaryEndpoints = new Set(primaryWalls.flatMap(wall => [wall.startVertexId, wall.endVertexId]))
  const walls = Object.values(current.walls).filter(wall => primaryEndpoints.has(wall.startVertexId) || primaryEndpoints.has(wall.endVertexId))
  const wallIds = new Set(walls.map(wall => wall.id))
  for (const wall of walls) { affected.add(wall.id); affected.add(wall.startVertexId); affected.add(wall.endVertexId) }
  const rooms = Object.values(current.rooms).filter(room => roots.has(room.id) || room.boundaryVertexIds.some(id => movedVertices.has(id)) || walls.some(wall => roomOwnsWall(room, wall)))
  const roomIds = new Set(rooms.map(room => room.id))
  for (const room of rooms) {
    affected.add(room.id)
    if (room.supportRef.kind === 'terrainArea') affected.add(room.supportRef.id)
  }
  for (const opening of Object.values(current.openings)) if (wallIds.has(opening.wallId)) affected.add(opening.id)
  const openingIds = new Set([...affected].filter(id => !!own(current.openings, id)))
  for (const prop of Object.values(current.props)) if (prop.supportRef.kind === 'room' && roomIds.has(prop.supportRef.id) || prop.roomId !== undefined && roomIds.has(prop.roomId)) affected.add(prop.id)
  for (const path of Object.values(current.paths)) if (path.supportRefs.some(ref => ref.kind === 'room' && roomIds.has(ref.id))) affected.add(path.id)
  for (const connection of Object.values(current.terrainConnections)) if ([connection.from, connection.to].some(end => end.surfaceRef.kind === 'room' && roomIds.has(end.surfaceRef.id))
    || connection.openingId !== null && openingIds.has(connection.openingId)) affected.add(connection.id)
  // A selected entity-anchored note needs its current anchor, without restoring that anchor's fields.
  for (const id of request.ids) {
    let note = own(current.notes, id)
    const visited = new Set<string>()
    while (note?.anchor.type === 'entity') {
      if (visited.has(note.id)) throw new Error('结构恢复注记锚点不能形成循环。')
      visited.add(note.id)
      affected.add(note.anchor.entityId)
      note = note.anchor.entityKind === 'note' ? own(current.notes, note.anchor.entityId) : undefined
    }
  }
  let changed = true
  while (changed) {
    changed = false
    for (const note of Object.values(current.notes)) if (note.anchor.type === 'entity' && affected.has(note.anchor.entityId) && !affected.has(note.id)) { affected.add(note.id); changed = true }
    for (const group of [...Object.values(current.prefabInstances), ...Object.values(current.scatterGroups)]) {
      if (!affected.has(group.id) && Object.values(group.members).some(member => member.propId !== null && affected.has(member.propId))) { affected.add(group.id); changed = true }
    }
  }
  const entities = new Map(enumerateLayerEntities(current).map(value => [value.id, value]))
  const kindFor = (id: string): EntityKind => {
    const structure = structureKind(current, id)
    if (structure) return structure
    const others = { prop: current.props, region: current.regions, terrainArea: current.terrainAreas, terrainEdge: current.terrainEdges,
      terrainConnection: current.terrainConnections, path: current.paths, prefabInstance: current.prefabInstances, scatterGroup: current.scatterGroups }
    return Object.keys(others).find(kind => own(others[kind as keyof typeof others] as Record<string, Editable>, id)) as EntityKind
  }
  const impacts: StructureRestoreImpact[] = sorted(affected).map(id => {
    const value = entities.get(id)
    if (!value) throw new Error(`结构恢复依赖不存在：${id}。`)
    const layerId = current.entityLayers[id], layer = current.userLayers[layerId]
    if (value.editLocked || layer.editLocked) throw new Error(`结构恢复涉及已锁定实体或图层：${id}。`)
    const kind = kindFor(id), name = kind === 'room' ? current.rooms[id].purpose || id : kind === 'note' ? current.notes[id].title || id : id
    return { id, kind, name, layerId, historicalLayerId: own(historic.entityLayers, id) ?? null,
      role: roots.has(id) ? 'root' : writes.has(id) ? 'geometry' : 'dependency', fields: writes.get(id) ?? [] }
  })
  // Existing shared structure also needs continuous identity, although its business fields stay current.
  // Current-only neighbors are explicitly listed and preserved; no history identity is invented for them.
  assertStructureContinuity(continuity, current, historic, impacts.filter(impact => structureKind(historic, impact.id) !== null).map(impact => impact.id))
  const rootLayerId = current.entityLayers[request.ids[0]]
  const requiredLayerIds = sorted(impacts.filter(impact => impact.layerId !== rootLayerId
    || impact.historicalLayerId !== null && impact.historicalLayerId !== impact.layerId).map(impact => impact.layerId))
  const dependencies = inspectDependencies(current)
  const scope: StructureRestoreScope = { rootIds: [...request.ids], writeIds: sorted(writes.keys()),
    dependencyIds: sorted([...affected].filter(id => !roots.has(id))), impacts, requiredLayerIds: [...new Set(requiredLayerIds)],
    commandCost: [...writes.values()].filter(fields => fields.length > 0).length, assetIds: dependencies.assetIds, subjects: dependencies.subjects }
  if (scope.commandCost > COMMAND_LIMIT) throw new Error(`结构恢复需要 ${scope.commandCost} 条操作，超过单次 256 条预算；请缩小选择，不能自动拆批。`)
  return { current, historic, request, historyIdentity, scope, writes }
}

/** Inspect first; this cannot be adopted and does not silently confirm dependency expansion. */
export function inspectStructureRestoreScope(
  current: SceneDocument, currentIdentity: HistoryIdentity, historic: SceneDocument, historicIdentity: HistoryIdentity,
  request: StructureRestoreRequest, continuity: StructureContinuity,
): StructureRestoreScope {
  return freezeJson(compose(current, currentIdentity, historic, historicIdentity, request, continuity).scope)
}

/** Pure, checked candidate. Workspace owns protection persistence, CAS and revision+1. */
export function buildStructureRestorePlan(
  currentInput: SceneDocument, currentIdentity: HistoryIdentity, historicInput: SceneDocument, historicIdentity: HistoryIdentity,
  requestInput: StructureRestoreRequest, continuity: StructureContinuity,
): StructureRestorePlan {
  const { current, historic, request, historyIdentity, scope, writes } = compose(currentInput, currentIdentity, historicInput, historicIdentity, requestInput, continuity)
  const acknowledged = new Set(request.acknowledgedDependencyIds ?? []), confirmed = new Set(request.confirmedLayerIds ?? [])
  if (scope.dependencyIds.some(id => !acknowledged.has(id)) || [...acknowledged].some(id => !scope.dependencyIds.includes(id))) throw new Error('结构恢复依赖范围尚未完整确认或已变化，请检查全部扩展 ID 后重新预览。')
  if (scope.requiredLayerIds.some(id => !confirmed.has(id)) || [...confirmed].some(id => !scope.requiredLayerIds.includes(id))) throw new Error('结构恢复跨层影响尚未完整确认或已变化，请检查所列图层后重新预览。')
  const candidate = cloneJson(current), changes: StructureRestoreChange[] = []
  for (const [id, fields] of writes) {
    const kind = structureKind(current, id)!, present = entity(current, kind, id)!, source = entity(historic, kind, id)!
    const before = selectedFields(present, fields), after = selectedFields(source, fields)
    if (equal(before, after)) continue
    const target = entity(candidate, kind, id)! as unknown as Record<string, unknown>
    for (const field of fields) {
      if (Object.hasOwn(after, field)) target[field] = cloneJson((after as Record<string, unknown>)[field])
      else delete target[field]
    }
    const impact = scope.impacts.find(impact => impact.id === id)!
    changes.push({ id, kind, name: impact.name, layerId: impact.layerId, fields: fields.filter(field => !equal((before as Record<string, unknown>)[field], (after as Record<string, unknown>)[field])), before, after })
  }
  const document = changes.length ? checkedScene(candidate, '结构恢复候选') : current
  validateHistoryIdentity(historyIdentity, document)
  projectScene(document, 'player')
  return freezeJson({ ...scope, request, historyIdentity, document, changes, changed: changes.length > 0 })
}
