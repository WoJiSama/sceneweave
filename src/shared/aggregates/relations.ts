import { AGGREGATE_ENTITY_COLLECTIONS, type AggregateEntityRef, type AggregateRelation, type AggregateRelationRef } from '../model/aggregate.js'
import type { SceneDocument, SurfaceRef } from '../model/scene.js'

export interface AggregateEntityRelation { from: AggregateEntityRef; to: AggregateRelationRef; relation: AggregateRelation; field: string }
export interface AggregateAffectedClosure {
  roots: AggregateRelationRef[]
  /** Explicit dependency closure, including the original roots. */
  affected: AggregateRelationRef[]
  /** Every entity on these Floors needs the owning spatial validator to recheck it. */
  spatialReviewFloors: string[]
  /** Bad or unmapped references require the caller's conservative full-scene fallback. */
  unresolvedReferences: AggregateEntityRelation[]
  unknownTargets: AggregateRelationRef[]
  requiresSceneWideFallback: boolean
  /** These domains are deliberately delegated to their full owning validators. */
  requiresFullDomainValidation: true
  limitations: readonly ['spatial-contact', 'visual-system', 'appearance-resources', 'generation-provenance']
}
const segmentKey = (a: string, b: string) => JSON.stringify([a, b].sort())
const refKey = (ref: AggregateRelationRef) => JSON.stringify([ref.kind, ref.id])
const compare = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0
const refCompare = (left: AggregateRelationRef, right: AggregateRelationRef) => compare(refKey(left), refKey(right))

/** Entity references only. Resource/appearance/generation graphs and spatial
 * contacts still require the complete domain validators; this is not c's proof. */
export function aggregateEntityRelations(scene: SceneDocument): AggregateEntityRelation[] {
  const result: AggregateEntityRelation[] = []
  const add = (from: AggregateEntityRef, to: AggregateRelationRef, relation: AggregateRelation, field: string) => result.push({ from, to, relation, field })
  const support = (from: AggregateEntityRef, ref: SurfaceRef, field: string) => {
    if (ref.kind === 'terrainArea') add(from, { kind: 'terrainArea', id: ref.id }, 'support', field)
    else if (ref.kind === 'room') add(from, { kind: 'room', id: ref.id }, 'support', field)
    else add(from, { kind: 'floor', id: ref.id }, 'support', field)
  }
  const walls = new Map<string, string[]>()
  for (const wall of Object.values(scene.walls)) {
    const key = segmentKey(wall.startVertexId, wall.endVertexId)
    walls.set(key, [...(walls.get(key) ?? []), wall.id])
    for (const field of ['startVertexId', 'endVertexId'] as const) add({ kind: 'wall', id: wall.id }, { kind: 'vertex', id: wall[field] }, 'geometry', field)
  }
  for (const room of Object.values(scene.rooms)) {
    const from = { kind: 'room' as const, id: room.id }
    room.boundaryVertexIds.forEach((id, index, ring) => {
      add(from, { kind: 'vertex', id }, 'geometry', 'boundaryVertexIds')
      for (const wallId of walls.get(segmentKey(id, ring[(index + 1) % ring.length])) ?? []) add(from, { kind: 'wall', id: wallId }, 'geometry', 'boundaryVertexIds')
    })
    support(from, room.supportRef, 'supportRef')
  }
  for (const opening of Object.values(scene.openings)) {
    const from = { kind: 'opening' as const, id: opening.id }
    add(from, { kind: 'wall', id: opening.wallId }, 'attachment', 'wallId')
    add(from, { kind: 'vertex', id: opening.offsetReferenceVertexId }, 'attachment', 'offsetReferenceVertexId')
  }
  for (const prop of Object.values(scene.props)) {
    const from = { kind: 'prop' as const, id: prop.id }
    support(from, prop.supportRef, 'supportRef')
    if (prop.roomId !== undefined) add(from, { kind: 'room', id: prop.roomId }, 'support', 'roomId')
  }
  for (const note of Object.values(scene.notes)) if (note.anchor.type === 'entity') add({ kind: 'note', id: note.id }, { kind: note.anchor.entityKind, id: note.anchor.entityId }, 'annotation', 'anchor')
  for (const edge of Object.values(scene.terrainEdges)) {
    const from = { kind: 'terrainEdge' as const, id: edge.id }
    add(from, { kind: 'terrainArea', id: edge.source.areaId }, 'attachment', 'source.areaId')
    if (edge.neighborAreaId !== null) add(from, { kind: 'terrainArea', id: edge.neighborAreaId }, 'attachment', 'neighborAreaId')
  }
  for (const connection of Object.values(scene.terrainConnections)) {
    const from = { kind: 'terrainConnection' as const, id: connection.id }
    for (const end of ['from', 'to'] as const) support(from, connection[end].surfaceRef, `${end}.surfaceRef`)
    if (connection.openingId !== null) add(from, { kind: 'opening', id: connection.openingId }, 'attachment', 'openingId')
  }
  for (const path of Object.values(scene.paths)) for (const ref of path.supportRefs) support({ kind: 'path', id: path.id }, ref, 'supportRefs')
  for (const group of Object.values(scene.prefabInstances)) for (const member of Object.values(group.members)) if (member.propId !== null) add({ kind: 'prefabInstance', id: group.id }, { kind: 'prop', id: member.propId }, 'membership', 'members')
  for (const group of Object.values(scene.scatterGroups)) {
    const from = { kind: 'scatterGroup' as const, id: group.id }, domain = group.domain
    const to: AggregateEntityRef = domain.kind === 'area' ? { kind: 'terrainArea', id: domain.areaId } : domain.kind === 'path' ? { kind: 'path', id: domain.pathId } : { kind: 'terrainEdge', id: domain.edgeId }
    add(from, to, 'support', 'domain')
    for (const member of Object.values(group.members)) if (member.propId !== null && member.state !== 'deleted' && member.state !== 'detached') add(from, { kind: 'prop', id: member.propId }, 'membership', 'members')
  }
  for (const decoration of Object.values(scene.decorations)) support({ kind: 'decoration', id: decoration.id }, decoration.supportRef, 'supportRef')
  for (const group of Object.values(scene.decorationClusters)) {
    const from = { kind: 'decorationCluster' as const, id: group.id }
    support(from, group.supportRef, 'supportRef')
    for (const member of Object.values(group.members)) if (member.entityId !== null && member.state !== 'deleted' && member.state !== 'detached') add(from, { kind: member.kind, id: member.entityId }, 'membership', 'members')
  }
  for (const rule of Object.values(scene.surfaceRules)) {
    const from = { kind: 'surfaceRule' as const, id: rule.id }
    support(from, rule.supportRef, 'supportRef')
    if (rule.field !== 'material') add(from, { kind: 'decorationCluster', id: rule.clusterId }, 'membership', 'clusterId')
  }
  return result
}

/**
 * Resolve explicit reverse dependencies and co-affected geometry/container
 * members. This index is intentionally not a spatial collision solver: callers
 * must revalidate every entity on spatialReviewFloors with the owning geometry
 * validator. It never infers adjacency from grid distance or a fixed neighbor
 * stencil. Visual, appearance/resource and generation graphs remain owned by
 * their respective validators; unresolved references require scene-wide fallback.
 */
export function aggregateAffectedClosure(
  scene: SceneDocument,
  changedTargets: readonly AggregateRelationRef[],
  options: { maxNodes?: number } = {},
): AggregateAffectedClosure {
  const maxNodes = options.maxNodes ?? 131_072
  if (!Number.isSafeInteger(maxNodes) || maxNodes < 1) throw new Error('依赖闭包节点预算必须是正安全整数。')

  const entities = new Map<string, AggregateEntityRef>(), entityFloors = new Map<string, string>()
  for (const [kind, collection] of Object.entries(AGGREGATE_ENTITY_COLLECTIONS)) {
    for (const value of Object.values(scene[collection])) {
      const ref = { kind: kind as AggregateEntityRef['kind'], id: value.id }
      entities.set(refKey(ref), ref); entityFloors.set(refKey(ref), value.floorId)
    }
  }
  const floors = new Set(Object.keys(scene.floors))
  const normalize = (input: AggregateRelationRef): AggregateRelationRef => {
    if (!input || typeof input.id !== 'string' || input.id.length === 0) throw new Error('依赖查询目标无效。')
    if (input.kind === 'floor') return { kind: 'floor', id: input.id }
    if (!Object.hasOwn(AGGREGATE_ENTITY_COLLECTIONS, input.kind)) throw new Error('依赖查询目标类型未知。')
    return { kind: input.kind, id: input.id }
  }
  const roots = [...new Map(changedTargets.map(target => {
    const ref = normalize(target); return [refKey(ref), ref] as const
  })).values()].sort(refCompare)
  if (roots.length > maxNodes) throw new Error('依赖失效闭包超过节点保护预算。')

  const relations = aggregateEntityRelations(scene)
  const adjacency = new Map<string, Map<string, AggregateRelationRef>>()
  const addArc = (source: AggregateRelationRef, affected: AggregateRelationRef) => {
    const key = refKey(source), targetKey = refKey(affected)
    let next = adjacency.get(key)
    if (!next) { next = new Map(); adjacency.set(key, next) }
    next.set(targetKey, affected)
  }
  const unresolvedReferences: AggregateEntityRelation[] = []
  for (const relation of relations) {
    const fromKey = refKey(relation.from), toKey = refKey(relation.to)
    const fromFloor = entityFloors.get(fromKey), toFloor = relation.to.kind === 'floor' ? relation.to.id : entityFloors.get(toKey)
    if (!fromFloor || !entities.has(fromKey) || relation.to.kind === 'floor' && !floors.has(relation.to.id)
      || relation.to.kind !== 'floor' && !entities.has(toKey) || toFloor !== fromFloor) unresolvedReferences.push(relation)
    // If `from` depends on `to`, editing `to` invalidates `from`.
    addArc(relation.to, relation.from)
    // Geometry and membership describe coupled editing units: commands on
    // either side may change the other side, so invalidation is bidirectional.
    if (relation.relation === 'geometry' || relation.relation === 'membership') addArc(relation.from, relation.to)
  }

  const knownNodes = new Map<string, AggregateRelationRef>()
  for (const [key, ref] of entities) knownNodes.set(key, ref)
  for (const id of floors) knownNodes.set(refKey({ kind: 'floor', id }), { kind: 'floor', id })
  const unknownTargets = roots.filter(root => !knownNodes.has(refKey(root)))
  const queue = [...roots], seen = new Map(roots.map(root => [refKey(root), root]))
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const current = queue[cursor], key = refKey(current)
    const neighbors = [...(adjacency.get(key)?.values() ?? [])].sort(refCompare)
    for (const next of neighbors) {
      const nextKey = refKey(next)
      if (seen.has(nextKey)) continue
      if (seen.size >= maxNodes) throw new Error('依赖失效闭包超过节点保护预算。')
      seen.set(nextKey, next); queue.push(next)
    }
  }

  // A changed Floor affects every entity on that Floor. Spatial rechecks are
  // intentionally whole-Floor because collision distance is not indexed here.
  const spatialFloors = new Set<string>()
  for (const ref of roots) {
    if (ref.kind === 'floor') { if (floors.has(ref.id)) spatialFloors.add(ref.id) }
    else { const floorId = entityFloors.get(refKey(ref)); if (floorId) spatialFloors.add(floorId) }
  }
  for (const ref of seen.values()) {
    if (ref.kind === 'floor') { if (floors.has(ref.id)) spatialFloors.add(ref.id) }
    else { const floorId = entityFloors.get(refKey(ref)); if (floorId) spatialFloors.add(floorId) }
  }

  const unresolved = unresolvedReferences.sort((a, b) => compare(refKey(a.from), refKey(b.from))
    || compare(refKey(a.to), refKey(b.to)) || compare(`${a.relation}:${a.field}`, `${b.relation}:${b.field}`))
  return {
    roots, affected: [...seen.values()].sort(refCompare),
    spatialReviewFloors: [...spatialFloors].sort(compare),
    unresolvedReferences: unresolved, unknownTargets,
    requiresSceneWideFallback: unknownTargets.length > 0 || unresolved.length > 0,
    requiresFullDomainValidation: true,
    limitations: ['spatial-contact', 'visual-system', 'appearance-resources', 'generation-provenance'],
  }
}
