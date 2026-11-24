import { furnitureRoom } from '../geometry/furniture-room.js'
import type { AggregateEntityRef } from '../model/aggregate.js'
import type { SceneDocument } from '../model/scene.js'
import { isCertifiedSceneSnapshot } from '../validation/snapshots.js'

type VisitPlacementType = <T extends { id: string }>(kind: AggregateEntityRef['kind'],
  rows: (scene: SceneDocument) => Record<string, T>, hosts: (row: T) => string[]) => void

/** A shared boundary or route can only be owned where its moving supports meet.
 * A connection to the open Floor moves with its other end. The Floor itself
 * remains a read dependency for physical validation. */
export function visitSharedSupportTypes(visit: VisitPlacementType, followersOnly = false): void {
  if (!followersOnly) {
    visit('path', scene => scene.paths, row => row.supportRefs.map(ref => ref.id))
    visit('terrainEdge', scene => scene.terrainEdges, row => row.neighborAreaId ? [row.source.areaId, row.neighborAreaId] : [row.source.areaId])
  }
  visit('terrainConnection', scene => scene.terrainConnections, row => [
    ...[row.from.surfaceRef, row.to.surfaceRef].filter(ref => ref.kind !== 'floor').map(ref => ref.id),
    ...(row.openingId ? [row.openingId] : []), ...(row.terrainInlay?.geometry.sources.map(source => source.id) ?? []),
  ])
}

/** Placement references only. A road link, partition overlap, window light or
 * shared vertex can invalidate another object without making it a member. */
export function visitPlacementTypes(visit: VisitPlacementType, followersOnly = false): void {
  if (!followersOnly) {
    visit('opening', scene => scene.openings, row => [row.wallId])
    visit('prop', scene => scene.props, row => [furnitureRoom(row) ?? row.supportRef.id])
    visit('decoration', scene => scene.decorations, row => [row.supportRef.id])
    visit('decorationCluster', scene => scene.decorationClusters, row => [row.supportRef.id])
  }
  visitSharedSupportTypes(visit, followersOnly)
  // These types can themselves be placed on an object listed above.
  visit('prefabInstance', scene => scene.prefabInstances, row => Object.values(row.members).flatMap(member => member.propId ?? []))
  visit('scatterGroup', scene => scene.scatterGroups, row => [
    row.domain.kind === 'area' ? row.domain.areaId : row.domain.kind === 'path' ? row.domain.pathId : row.domain.edgeId,
  ])
  visit('surfaceRule', scene => scene.surfaceRules, row => row.field === 'material' ? [row.supportRef.id] : [row.supportRef.id, row.clusterId])
  visit('note', scene => scene.notes, row => row.anchor.type === 'entity' ? [row.anchor.entityId] : [])
}

interface PlacementLink { ref: AggregateEntityRef; hosts: string[] }
export function placementDependants(scene: SceneDocument, followersOnly: boolean): Map<string, PlacementLink[]> {
  const dependants = new Map<string, PlacementLink[]>()
  visitPlacementTypes((kind, rows, hosts) => {
    for (const row of Object.values(rows(scene))) {
      const link = { ref: { kind, id: row.id }, hosts: [...new Set(hosts(row))] }
      for (const host of link.hosts) {
        const list = dependants.get(host)
        if (list) list.push(link)
        else dependants.set(host, [link])
      }
    }
  }, followersOnly)
  return dependants
}

const indexes = new WeakMap<SceneDocument, Map<string, PlacementLink[]>>()
/** For the editor's contents list. Every real host of a multi-support object
 * must be in the selected structure. Caller-owned drafts are never cached. */
export function placedObjectIds(scene: SceneDocument, hostIds: string[]): string[] {
  let index = indexes.get(scene)
  if (!index) {
    index = placementDependants(scene, false)
    if (isCertifiedSceneSnapshot(scene)) indexes.set(scene, index)
  }
  const included = new Set(hostIds), result: string[] = []
  for (const host of included) for (const { ref, hosts } of index.get(host) ?? []) {
    if (!included.has(ref.id) && hosts.every(id => included.has(id))) {
      included.add(ref.id); result.push(ref.id)
    }
  }
  return result
}
