import type { AggregateEntityRef, AggregateGroup } from '../model/aggregate.js'
import type { SceneDocument } from '../model/scene.js'
import { OperationRejected } from '../validation/operation-rejection.js'
import { AGGREGATE_DOMAIN_ADAPTERS, inspectAggregateMembership } from './domain-adapters.js'
import { placementDependants, visitPlacementTypes } from './placement-relations.js'

interface Placement {
  ref: AggregateEntityRef
  from: string[]
  to: string[]
  deleted: boolean
}

/** Only new geometry can acquire an owner here. A free-standing room follows
 * its support. An extension shares a real wall with the existing structure. */
function includeNewRoomBoundaries(before: SceneDocument, after: SceneDocument, changes: Map<string, Placement>, affectedIds?: readonly string[]): void {
  const rooms = (affectedIds ?? Object.keys(after.rooms)).flatMap(id =>
    !Object.hasOwn(before.rooms, id) && Object.hasOwn(after.rooms, id) ? [after.rooms[id]] : [])
  if (!rooms.length) return
  const vertices = new Map<string, string[]>(), edges = new Map<string, string[]>()
  const edgeKey = (a: string, b: string) => JSON.stringify(a < b ? [a, b] : [b, a])
  function record(map: Map<string, string[]>, key: string, id: string) {
    const users = map.get(key)
    if (users) users.push(id)
    else map.set(key, [id])
  }
  for (const room of Object.values(after.rooms)) room.boundaryVertexIds.forEach((id, i, ring) => {
    record(vertices, id, room.id)
    record(edges, edgeKey(id, ring[(i + 1) % ring.length]), room.id)
  })
  const participating = new Set<string>()
  for (const room of rooms) {
    const ring = room.boundaryVertexIds
    const touching = [...new Set(ring.flatMap(id => vertices.get(id)!).filter(id => Object.hasOwn(before.rooms, id)))]
    const oldVertices = ring.filter(id => Object.hasOwn(before.vertices, id))
    let hosts: string[]
    if (touching.length || oldVertices.length) {
      const sharesWall = ring.some((id, i) => edges.get(edgeKey(id, ring[(i + 1) % ring.length]))!.some(other => Object.hasOwn(before.rooms, other)))
      if (!sharesWall || touching.some(id => after.rooms[id].supportRef.id !== room.supportRef.id)) continue
      hosts = [...touching, ...oldVertices]
    } else {
      if (room.supportRef.kind !== 'terrainArea') continue
      hosts = [room.supportRef.id]
    }
    changes.set(room.id, { ref: { kind: 'room', id: room.id }, from: [], to: hosts, deleted: false })
    participating.add(room.id)
    touching.forEach(id => participating.add(id))
  }
  if (!participating.size) return
  // Splitting a wall can also create a segment used only by the old room.
  // Each fresh vertex or wall takes the common owner of all its actual users.
  for (const [id, to] of vertices) {
    if (!Object.hasOwn(before.vertices, id) && to.some(room => participating.has(room)))
      changes.set(id, { ref: { kind: 'vertex', id }, from: [], to, deleted: false })
  }
  for (const wall of Object.values(after.walls)) {
    if (Object.hasOwn(before.walls, wall.id)) continue
    const to = edges.get(edgeKey(wall.startVertexId, wall.endVertexId))
    if (to?.some(room => participating.has(room))) changes.set(wall.id, { ref: { kind: 'wall', id: wall.id }, from: [], to, deleted: false })
  }
}

function placementChanges(before: SceneDocument, after: SceneDocument, affectedIds?: readonly string[]): Placement[] {
  const changes = new Map<string, Placement>()
  visitPlacementTypes((kind, collection, hosts) => {
    const oldRows = collection(before), rows = collection(after)
    const inspect = (id: string) => {
      const old = Object.hasOwn(oldRows, id) ? oldRows[id] : undefined
      const row = Object.hasOwn(rows, id) ? rows[id] : undefined
      if (!old && !row) return
      const from = old ? hosts(old) : [], to = row ? hosts(row) : []
      if (from.length === to.length && from.every((host, i) => host === to[i])) return
      changes.set(id, { ref: { kind, id }, from, to, deleted: !row })
    }
    if (affectedIds) { affectedIds.forEach(inspect); return }
    for (const id of Object.keys(rows)) inspect(id)
    for (const id of Object.keys(oldRows)) if (!Object.hasOwn(rows, id)) inspect(id)
  })
  includeNewRoomBoundaries(before, after, changes, affectedIds)
  if (!changes.size) return []

  // A re-anchored note can itself carry notes. A prefab's placement can change
  // when its live members move, even though its slots still have the same IDs.
  const followers = placementDependants(after, true)
  for (const id of changes.keys()) {
    for (const { ref, hosts } of followers.get(id) ?? []) {
      if (!changes.has(ref.id)) changes.set(ref.id, { ref, from: hosts, to: hosts, deleted: false })
    }
  }
  const waiting = new Map<string, number>(), children = new Map<string, Placement[]>(), ordered: Placement[] = []
  for (const row of changes.values()) {
    const parents = [...new Set(row.to)].filter(host => changes.has(host))
    for (const host of parents) {
      const list = children.get(host) ?? []
      list.push(row); children.set(host, list)
    }
    if (parents.length) waiting.set(row.ref.id, parents.length)
    else ordered.push(row)
  }
  for (const row of ordered) for (const child of children.get(row.ref.id) ?? []) {
    const left = waiting.get(child.ref.id)! - 1
    waiting.set(child.ref.id, left)
    if (left === 0) ordered.push(child)
  }
  if (ordered.length !== changes.size) throw new Error('摆放关系成环，无法确定组归属。')
  return ordered
}

/** Maintain an already complete domain only on an actual host change. Never
 * fill holes in an old/manual group, or adopt a neighboring external dependency. */
export function syncAggregatePlacements(before: SceneDocument, after: SceneDocument, affectedIds?: readonly string[]): number {
  if (!before.aggregateCoordinates || !after.aggregateCoordinates) return 0
  const changes = placementChanges(before, after, affectedIds)
  if (!changes.length) return 0

  const groups = before.aggregateCoordinates.groups, owners = new Map<string, string>()
  for (const group of Object.values(groups)) for (const ref of group.members) owners.set(ref.id, group.id)
  const nextOwners = new Map(owners)
  const ancestry = new Map<string, string[]>()
  function ancestors(id: string): string[] {
    const known = ancestry.get(id)
    if (known) return known
    const result: string[] = []
    for (let group: AggregateGroup | undefined = groups[id]; group; group = group.parentId === null ? undefined : groups[group.parentId]) result.push(group.id)
    ancestry.set(id, result)
    return result
  }
  function commonOwner(hosts: string[], membership: Map<string, string>): string | undefined {
    const parent = membership.get(hosts[0])
    if (!parent || hosts.length === 1) return parent
    const others = hosts.slice(1).map(host => membership.get(host))
    return ancestors(parent).find(id => others.every(other => other !== undefined && ancestors(other).includes(id)))
  }

  type Domain = { scope: ReturnType<typeof inspectAggregateMembership>; next?: Set<string> }
  const domains = new Map<string, Domain | null>()
  function domainIncludes(owner: string, memberId: string, next: boolean): boolean {
    for (const id of ancestors(owner)) {
      if (!domains.has(id)) {
        try { domains.set(id, { scope: inspectAggregateMembership(before, id) }) }
        catch { domains.set(id, null) } // Partial and manual groups are valid coordinate owners.
      }
      const domain = domains.get(id)
      if (!domain) continue
      if (!next) return true // The existing member belongs to this exact subtree.
      domain.next ??= new Set(AGGREGATE_DOMAIN_ADAPTERS[domain.scope.domain].members(after, domain.scope.seedRefs, domain.scope.members).map(ref => ref.id))
      if (domain.next.has(memberId)) return true
    }
    return false
  }
  const removals = new Map<string, Set<string>>(), additions = new Map<string, AggregateEntityRef[]>()
  for (const { ref, from, to, deleted } of changes) {
    const current = owners.get(ref.id), previous = commonOwner(from, owners), candidate = commonOwner(to, nextOwners)
    const target = candidate && domainIncludes(candidate, ref.id, true) ? candidate : undefined
    if (current === target) continue
    if (current && !deleted && (previous !== current || !domainIncludes(current, ref.id, false))) {
      if (target && !ancestors(current).includes(target) || previous && domainIncludes(current, ref.id, false) && !domainIncludes(current, ref.id, true)) {
        throw new Error('物件已有手工组归属，请先调整原组。')
      }
      continue
    }
    for (const owner of [current, target]) if (owner && ancestors(owner).some(id => groups[id].editLocked)) {
      throw new OperationRejected('locked_dependency', '所属组或祖先组已锁定，不能更改成员。')
    }
    if (current) {
      const removed = removals.get(current) ?? new Set<string>()
      removed.add(ref.id); removals.set(current, removed); nextOwners.delete(ref.id)
    }
    if (target) {
      const added = additions.get(target) ?? []
      added.push(ref); additions.set(target, added); nextOwners.set(ref.id, target)
    }
  }
  let cost = 0
  const nextGroups = after.aggregateCoordinates.groups
  for (const [id, removed] of removals) {
    const group = nextGroups[id], kept = group.members.filter(ref => !removed.has(ref.id))
    cost += group.members.length - kept.length; group.members = kept
  }
  for (const [id, added] of additions) {
    const group = nextGroups[id], present = new Set(group.members.map(ref => ref.id))
    for (const ref of added) if (!present.has(ref.id)) { group.members.push(ref); cost++ }
  }
  return cost
}
