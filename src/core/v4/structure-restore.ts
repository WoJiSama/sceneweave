import { z } from 'zod'
import { inspectJsonInput } from '../schema'
import { inspectDependenciesV3, type LicenseSubject } from '../v3/dependencies'
import { enumerateLayerEntitiesV3 } from '../v3/layers'
import { validateSceneSnapshotV3 } from '../v3/snapshots'
import { COMMAND_LIMIT_V3, type Editable, type EntityKindV2, type NoteV2, type OpeningV2, type RoomV2, type SceneDocumentV3, type Vertex, type WallV2 } from '../v3/types'
import { projectSceneV3 } from '../../render/v3/projection'
import { mergeHistoryIdentitiesV4, validateHistoryIdentityV4 } from './identity'
import { assertStructureContinuityV4, STRUCTURE_COLLECTIONS_V4, structureKindV4, type StructureContinuityV4, type StructureKindV4 } from './structure-continuity'
import type { HistoryIdentityV4 } from './types'

export type StructureRestoreModeV4 = 'geometry' | 'properties'
export interface StructureRestoreRequestV4 {
  ids: string[]
  mode: StructureRestoreModeV4
  acknowledgedDependencyIds?: string[]
  confirmedLayerIds?: string[]
}
export interface StructureRestoreImpactV4 {
  id: string
  kind: EntityKindV2
  name: string
  layerId: string
  historicalLayerId: string | null
  role: 'root' | 'geometry' | 'dependency'
  fields: string[]
}
export interface StructureRestoreScopeV4 {
  rootIds: string[]
  writeIds: string[]
  dependencyIds: string[]
  impacts: StructureRestoreImpactV4[]
  requiredLayerIds: string[]
  /** One operation per write target with fields; unchanged writes are still reserved. */
  commandCost: number
  assetIds: string[]
  subjects: LicenseSubject[]
}
type StructureEntity = Vertex | RoomV2 | WallV2 | OpeningV2 | NoteV2
export interface StructureRestoreChangeV4 {
  id: string
  kind: StructureKindV4
  name: string
  layerId: string
  fields: string[]
  before: Partial<StructureEntity>
  after: Partial<StructureEntity>
}
export interface StructureRestorePlanV4 extends StructureRestoreScopeV4 {
  request: StructureRestoreRequestV4
  historyIdentity: HistoryIdentityV4
  document: SceneDocumentV3
  changes: StructureRestoreChangeV4[]
  changed: boolean
}

const id = z.string().min(1).max(256).refine(value => value !== '__proto__', '不能使用保留 ID')
const requestSchema = z.object({ ids: z.array(id).min(1).max(COMMAND_LIMIT_V3), mode: z.enum(['geometry', 'properties']),
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

function checkedScene(scene: SceneDocumentV3, label: string): SceneDocumentV3 {
  const result = validateSceneSnapshotV3(scene)
  if (!result.ok) throw new Error(`${label}场景无效：${result.errors.map(issue => issue.message).join('；')}`)
  return result.document
}
function checkedRequest(input: StructureRestoreRequestV4): StructureRestoreRequestV4 {
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
function entity(scene: SceneDocumentV3, kind: StructureKindV4, id: string): StructureEntity | undefined {
  return own(scene[STRUCTURE_COLLECTIONS_V4[kind]] as Record<string, StructureEntity>, id)
}
function fieldsFor(kind: StructureKindV4, mode: StructureRestoreModeV4, value: StructureEntity): string[] {
  if (kind === 'vertex') return ['xMm', 'yMm']
  if (kind === 'room') return mode === 'properties' ? ['purpose', 'visibility', 'accessExpectation'] : []
  if (kind === 'wall') return mode === 'properties' ? ['thicknessMm', 'blocksMovement', 'blocksSight'] : ['thicknessMm']
  if (kind === 'opening') return mode === 'properties' ? ['offsetMm', 'widthMm', 'kind', 'state', 'locked', 'secret', 'revealed'] : ['offsetMm', 'widthMm']
  return [...((value as NoteV2).anchor.type === 'point' ? ['anchor'] : []), ...(mode === 'properties' ? ['kind', 'title', 'text', 'visibility', 'discovered'] : [])]
}
function selectedFields(value: StructureEntity, fields: readonly string[]): Partial<StructureEntity> {
  return Object.fromEntries(fields.filter(field => Object.hasOwn(value, field)).map(field => [field, structuredClone((value as unknown as Record<string, unknown>)[field])])) as Partial<StructureEntity>
}
function roomOwnsWall(room: RoomV2, wall: WallV2): boolean {
  return room.boundaryVertexIds.some((id, index) => {
    const next = room.boundaryVertexIds[(index + 1) % room.boundaryVertexIds.length]
    return id === wall.startVertexId && next === wall.endVertexId || id === wall.endVertexId && next === wall.startVertexId
  })
}

function compose(
  currentInput: SceneDocumentV3, currentIdentityInput: HistoryIdentityV4,
  historicInput: SceneDocumentV3, historicIdentityInput: HistoryIdentityV4,
  requestInput: StructureRestoreRequestV4, continuity: StructureContinuityV4,
): { current: SceneDocumentV3; historic: SceneDocumentV3; request: StructureRestoreRequestV4; historyIdentity: HistoryIdentityV4; scope: StructureRestoreScopeV4; writes: Map<string, string[]> } {
  const request = checkedRequest(requestInput), current = checkedScene(currentInput, '当前'), historic = checkedScene(historicInput, '历史')
  const historyIdentity = mergeHistoryIdentitiesV4(currentIdentityInput, current, historicIdentityInput, historic)
  const roots = new Set(request.ids), writes = new Map<string, string[]>(), affected = new Set(request.ids)
  const requireStructure = (id: string): StructureKindV4 => {
    const kind = structureKindV4(historic, id), presentKind = structureKindV4(current, id)
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
  assertStructureContinuityV4(continuity, current, historic, [...writes.keys()])
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
  const entities = new Map(enumerateLayerEntitiesV3(current).map(value => [value.id, value]))
  const kindFor = (id: string): EntityKindV2 => {
    const structure = structureKindV4(current, id)
    if (structure) return structure
    const others = { prop: current.props, region: current.regions, terrainArea: current.terrainAreas, terrainEdge: current.terrainEdges,
      terrainConnection: current.terrainConnections, path: current.paths, prefabInstance: current.prefabInstances, scatterGroup: current.scatterGroups }
    return Object.keys(others).find(kind => own(others[kind as keyof typeof others] as Record<string, Editable>, id)) as EntityKindV2
  }
  const impacts: StructureRestoreImpactV4[] = sorted(affected).map(id => {
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
  assertStructureContinuityV4(continuity, current, historic, impacts.filter(impact => structureKindV4(historic, impact.id) !== null).map(impact => impact.id))
  const rootLayerId = current.entityLayers[request.ids[0]]
  const requiredLayerIds = sorted(impacts.filter(impact => impact.layerId !== rootLayerId
    || impact.historicalLayerId !== null && impact.historicalLayerId !== impact.layerId).map(impact => impact.layerId))
  const dependencies = inspectDependenciesV3(current)
  const scope: StructureRestoreScopeV4 = { rootIds: [...request.ids], writeIds: sorted(writes.keys()),
    dependencyIds: sorted([...affected].filter(id => !roots.has(id))), impacts, requiredLayerIds: [...new Set(requiredLayerIds)],
    commandCost: [...writes.values()].filter(fields => fields.length > 0).length, assetIds: dependencies.assetIds, subjects: dependencies.subjects }
  if (scope.commandCost > COMMAND_LIMIT_V3) throw new Error(`结构恢复需要 ${scope.commandCost} 条操作，超过单次 256 条预算；请缩小选择，不能自动拆批。`)
  return { current, historic, request, historyIdentity, scope, writes }
}

/** Inspect first; this cannot be adopted and does not silently confirm dependency expansion. */
export function inspectStructureRestoreScopeV4(
  current: SceneDocumentV3, currentIdentity: HistoryIdentityV4, historic: SceneDocumentV3, historicIdentity: HistoryIdentityV4,
  request: StructureRestoreRequestV4, continuity: StructureContinuityV4,
): StructureRestoreScopeV4 {
  return freezeJson(compose(current, currentIdentity, historic, historicIdentity, request, continuity).scope)
}

/** Pure, checked candidate. Workspace owns protection persistence, CAS and revision+1. */
export function buildStructureRestorePlanV4(
  currentInput: SceneDocumentV3, currentIdentity: HistoryIdentityV4, historicInput: SceneDocumentV3, historicIdentity: HistoryIdentityV4,
  requestInput: StructureRestoreRequestV4, continuity: StructureContinuityV4,
): StructureRestorePlanV4 {
  const { current, historic, request, historyIdentity, scope, writes } = compose(currentInput, currentIdentity, historicInput, historicIdentity, requestInput, continuity)
  const acknowledged = new Set(request.acknowledgedDependencyIds ?? []), confirmed = new Set(request.confirmedLayerIds ?? [])
  if (scope.dependencyIds.some(id => !acknowledged.has(id)) || [...acknowledged].some(id => !scope.dependencyIds.includes(id))) throw new Error('结构恢复依赖范围尚未完整确认或已变化，请检查全部扩展 ID 后重新预览。')
  if (scope.requiredLayerIds.some(id => !confirmed.has(id)) || [...confirmed].some(id => !scope.requiredLayerIds.includes(id))) throw new Error('结构恢复跨层影响尚未完整确认或已变化，请检查所列图层后重新预览。')
  const candidate = structuredClone(current), changes: StructureRestoreChangeV4[] = []
  for (const [id, fields] of writes) {
    const kind = structureKindV4(current, id)!, present = entity(current, kind, id)!, source = entity(historic, kind, id)!
    const before = selectedFields(present, fields), after = selectedFields(source, fields)
    if (equal(before, after)) continue
    const target = entity(candidate, kind, id)! as unknown as Record<string, unknown>
    for (const field of fields) {
      if (Object.hasOwn(after, field)) target[field] = structuredClone((after as Record<string, unknown>)[field])
      else delete target[field]
    }
    const impact = scope.impacts.find(impact => impact.id === id)!
    changes.push({ id, kind, name: impact.name, layerId: impact.layerId, fields: fields.filter(field => !equal((before as Record<string, unknown>)[field], (after as Record<string, unknown>)[field])), before, after })
  }
  const document = changes.length ? checkedScene(candidate, '结构恢复候选') : current
  validateHistoryIdentityV4(historyIdentity, document)
  projectSceneV3(document, 'player')
  return freezeJson({ ...scope, request, historyIdentity, document, changes, changed: changes.length > 0 })
}
