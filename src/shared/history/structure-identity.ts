import type { SceneDocument } from '../model/scene.js'
import type { HistoryIdentity, StructureIdentityKind, StructureIdentityToken } from '../model/history.js'
import type { PreparationContext } from '../ports/runtime.js'
import { canonicalJson } from '../validation/json.js'
import { sha256Text } from '../validation/hash.js'
import { geometryIdentityIds } from '../commands/domain.js'

export interface StructureDescriptor { kind: StructureIdentityKind; topologyHash: string }
export type StructureDescriptors = Record<string, StructureDescriptor>
const ring = (ids: readonly string[]) => {
  if (!ids.length) return []
  const first = ids.reduce((best, id, index) => id < ids[best] ? index : best, 0)
  return [...ids.slice(first), ...ids.slice(0, first)]
}

/** Coordinates, width, door state and appearance are edits, not new births.
 * This covers ordinary structures; generation ownership remains a separate
 * provenance axis and is never used as permission to follow a manual road. */
export function structureIdentityDescriptors(scene: Readonly<SceneDocument>): StructureDescriptors {
  const result: StructureDescriptors = {}
  const pairRooms = new Map<string, string[]>(), vertexRooms = new Map<string, string[]>(), vertexWalls = new Map<string, string[]>()
  const pair = (floorId: string, a: string, b: string) => JSON.stringify([floorId, ...[a, b].sort()])
  const append = (map: Map<string, string[]>, id: string, value: string) => { const values = map.get(id) ?? []; values.push(value); map.set(id, values) }
  for (const room of Object.values(scene.rooms)) for (const [index, id] of room.boundaryVertexIds.entries()) {
    append(vertexRooms, id, room.id)
    append(pairRooms, pair(room.floorId, id, room.boundaryVertexIds[(index + 1) % room.boundaryVertexIds.length]), room.id)
  }
  for (const wall of Object.values(scene.walls)) { append(vertexWalls, wall.startVertexId, wall.id); append(vertexWalls, wall.endVertexId, wall.id) }
  const add = (id: string, kind: StructureIdentityKind, topology: unknown) => {
    if (Object.hasOwn(result, id)) throw new Error(`结构身份重复：${id}。`)
    result[id] = { kind, topologyHash: sha256Text(canonicalJson([kind, topology])) }
  }
  for (const floor of Object.values(scene.floors)) add(floor.id, 'floor', [floor.id])
  for (const room of Object.values(scene.rooms)) add(room.id, 'room', [room.floorId, room.supportRef, ring(room.boundaryVertexIds)])
  for (const wall of Object.values(scene.walls)) add(wall.id, 'wall', [wall.floorId, wall.startVertexId, wall.endVertexId, (pairRooms.get(pair(wall.floorId, wall.startVertexId, wall.endVertexId)) ?? []).sort()])
  for (const vertex of Object.values(scene.vertices)) add(vertex.id, 'vertex', [vertex.floorId,
    (vertexWalls.get(vertex.id) ?? []).sort(), (vertexRooms.get(vertex.id) ?? []).sort()])
  for (const opening of Object.values(scene.openings)) add(opening.id, 'opening', [opening.floorId, opening.kind, opening.wallId, opening.offsetReferenceVertexId])
  for (const row of Object.values(scene.pathAttachments ?? {})) add(row.id, 'pathAttachment', [row.floorId, row.pathId, row.openingId, row.end, row.anchor.wallId, row.anchor.roomId])
  return result
}

export function validateStructureIdentities(identity: HistoryIdentity, scene: SceneDocument): void {
  if (!identity.structureTokens) return
  const descriptors = structureIdentityDescriptors(scene), occupied = geometryIdentityIds(scene)
  for (const id of Object.keys(scene.userLayers)) occupied.add(id)
  for (const [id, descriptor] of Object.entries(descriptors)) {
    const record = Object.hasOwn(identity.structureTokens, id) ? identity.structureTokens[id] : undefined
    if (!record || record.kind !== descriptor.kind || record.topologyHash !== descriptor.topologyHash) throw new Error(`结构缺少真实出生/拓扑证明：${id}。`)
    occupied.delete(id)
  }
  for (const id of Object.keys(identity.structureTokens)) if (occupied.has(id)) throw new Error(`退休结构ID被其他种类复用：${id}。`)
}

/** Observe every native command, including an edit later reversed in the same
 * batch. Undo can restore content, but never resurrect a retired continuity token. */
export function advanceStructureIdentities(identity: HistoryIdentity, before: StructureDescriptors, after: StructureDescriptors,
  context: PreparationContext, allowResurrection = false): void {
  const pool = identity.structureTokens ??= {}
  for (const [id, descriptor] of Object.entries(after)) {
    const record = Object.hasOwn(pool, id) ? pool[id] : undefined, previous = Object.hasOwn(before, id) ? before[id] : undefined
    if (record) {
      if (record.kind !== descriptor.kind || previous && previous.kind !== descriptor.kind || !previous && !allowResurrection) throw new Error(`普通编辑不能复用退休结构ID：${id}。`)
      if (!previous || record.topologyHash !== descriptor.topologyHash) pool[id] = { ...record, topologyHash: descriptor.topologyHash, topologyToken: context.ids.nextId() }
    } else pool[id] = { ...descriptor, token: context.ids.nextId(), topologyToken: context.ids.nextId() }
  }
}

export function mergeStructureIdentityRecords(current: HistoryIdentity, historic: HistoryIdentity): void {
  if (!historic.structureTokens) return
  if (!current.structureTokens) throw new Error('当前缺少结构身份，不能用历史记录补造当前连续性；请先明确建立当前结构身份。')
  const pool = current.structureTokens
  for (const [id, record] of Object.entries(historic.structureTokens)) {
    const prior = Object.hasOwn(pool, id) ? pool[id] : undefined
    if (prior && (prior.kind !== record.kind || prior.token !== record.token || prior.topologyToken === record.topologyToken && prior.topologyHash !== record.topologyHash)) throw new Error(`结构历史身份冲突：${id}。`)
    if (!prior) pool[id] = record
  }
}

export function assertStructureContinuity(current: HistoryIdentity, historic: HistoryIdentity, ids: readonly string[]): void {
  for (const id of ids) {
    const a = historic.structureTokens?.[id], b = current.structureTokens?.[id]
    if (!a || !b || a.kind !== b.kind || a.token !== b.token || a.topologyToken !== b.topologyToken || a.topologyHash !== b.topologyHash) throw new Error(`结构出生或拓扑连续性不足：${id}。`)
  }
}

export function structureWitness(identity: HistoryIdentity, id: string): StructureIdentityToken {
  const record = identity.structureTokens && Object.hasOwn(identity.structureTokens, id) ? identity.structureTokens[id] : undefined
  if (!record) throw new Error(`结构尚无持久出生证明，请先建立当前结构身份：${id}。`)
  return { ...record }
}
