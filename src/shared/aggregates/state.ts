import { AGGREGATE_ENTITY_COLLECTIONS, AGGREGATE_LIMITS, type AggregateCoordinates, type AggregateFrame, type AggregateGroup } from '../model/aggregate.js'
import type { Issue, SceneDocument } from '../model/scene.js'
import { composeAggregateFrames } from './coordinates.js'
import { geometryIdentityIds } from '../commands/domain.js'

export const WORLD_FRAME: AggregateFrame = Object.freeze({ translationMm: Object.freeze({ x: 0, y: 0 }), quarterTurns: 0 })
const ownGroup = (groups: Record<string, AggregateGroup>, id: string) => Object.hasOwn(groups, id) ? groups[id] : undefined

/** No geometry/proof cache. Resolve the exact current parent tree on each call. */
export function aggregateWorldFrames(state: AggregateCoordinates): Map<string, AggregateFrame> {
  const frames = new Map<string, AggregateFrame>(), active = new Set<string>()
  const visit = (id: string, depth: number): AggregateFrame => {
    if (depth > AGGREGATE_LIMITS.depth || active.has(id)) throw new Error('聚合体父级成环或超过16层。')
    const group = ownGroup(state.groups, id)
    if (!group) throw new Error('聚合体父级不存在。')
    active.add(id)
    const parent = group.parentId === null ? WORLD_FRAME : visit(group.parentId, depth + 1)
    if (group.parentId !== null && ownGroup(state.groups, group.parentId)?.floorId !== group.floorId) throw new Error('聚合体父子必须同Floor。')
    active.delete(id)
    const frame = composeAggregateFrames(parent, group.frame)
    frames.set(id, frame)
    return frame
  }
  for (const id of Object.keys(state.groups)) visit(id, 1)
  return frames
}

/** Coordinate ownership only; full domain, resource and audience checks remain mandatory. */
export function validateAggregateCoordinates(scene: SceneDocument): Issue[] {
  const state = scene.aggregateCoordinates
  if (!state) return []
  const errors: Issue[] = []
  const error = (message: string, entityId?: string) => errors.push({ code: 'AGGREGATE_COORDINATES', message, ...(entityId === undefined ? {} : { entityId }) })
  if (state.encoding !== 'world') error('编辑、渲染和命中只消费已物化的世界视图；磁盘局部表示必须先解码。')
  if (scene.mapMode !== 'scene') error('区域模式尚不支持实体聚合坐标。')
  const occupied = geometryIdentityIds({ ...scene, aggregateCoordinates: undefined })
  for (const id of Object.keys(scene.floors)) occupied.add(id)
  const owners = new Map<string, string>(), ancestors = new Map<string, string[]>()
  try { aggregateWorldFrames(state) } catch (cause) { error(cause instanceof Error ? cause.message : String(cause)); return errors }
  for (const [key, group] of Object.entries(state.groups)) {
    if (key !== group.id) error('聚合体集合键须等于id。', key)
    if (occupied.has(key) || Object.hasOwn(scene.userLayers, key)) error('聚合体ID不能与现有场景、图层或实体复用。', key)
    occupied.add(key)
    if (!Object.hasOwn(scene.floors, group.floorId)) error('聚合体Floor不存在。', key)
    const chain: string[] = []
    let current: AggregateGroup | undefined = group
    while (current) { chain.push(current.id); current = current.parentId === null ? undefined : ownGroup(state.groups, current.parentId) }
    ancestors.set(key, chain)
    for (const ref of group.members) {
      const entity = scene[AGGREGATE_ENTITY_COLLECTIONS[ref.kind]][ref.id], memberKey = JSON.stringify([ref.kind, ref.id])
      if (!entity || !Object.hasOwn(scene[AGGREGATE_ENTITY_COLLECTIONS[ref.kind]], ref.id) || entity.floorId !== group.floorId) error('成员须为同Floor的现存实体。', ref.id)
      if (owners.has(memberKey)) error('实体只能有一个直接聚合所有者。', ref.id)
      owners.set(memberKey, key)
    }
  }
  const ownerOf = (kind: string, id: string) => owners.get(JSON.stringify([kind, id])) ?? null
  const segment = (a: string, b: string) => JSON.stringify([a, b].sort()), wallRooms = new Map<string, string[]>()
  for (const room of Object.values(scene.rooms)) room.boundaryVertexIds.forEach((id, i, ids) => {
    const key = segment(id, ids[(i + 1) % ids.length]); wallRooms.set(key, [...(wallRooms.get(key) ?? []), room.id])
  })
  for (const wall of Object.values(scene.walls)) {
    const rooms = wallRooms.get(segment(wall.startVertexId, wall.endVertexId)) ?? []
    if (rooms.length < 2) continue
    const roomOwners = rooms.map(id => ownerOf('room', id)), first = roomOwners[0]
    const common = first === null ? null : (ancestors.get(first) ?? []).find(id => roomOwners.every(owner => owner !== null && ancestors.get(owner)?.includes(id))) ?? null
    if (ownerOf('wall', wall.id) !== common) error('共享墙须由房间的最近共同所有者持有。', wall.id)
  }
  return errors
}

/** Called by owned editing paths, never by raw input validation. Deletion ends
 * only that member binding; fresh creations are not automatically regrouped. */
export function reconcileAggregateMembers(before: SceneDocument, after: SceneDocument): void {
  if (!before.aggregateCoordinates || !after.aggregateCoordinates) return
  for (const group of Object.values(after.aggregateCoordinates.groups)) group.members = group.members.filter(ref => {
    const collection = AGGREGATE_ENTITY_COLLECTIONS[ref.kind]
    return !Object.hasOwn(before[collection], ref.id) || Object.hasOwn(after[collection], ref.id)
  })
}
