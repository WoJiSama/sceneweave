import { effectiveEditLocked } from '../../shared/commands/layers'
import { createPublicVisibility } from '../../shared/geometry/visibility'
import type { SceneDocument } from '../../shared/model/scene'

const edgeKey = (a: string, b: string) => JSON.stringify([a, b].sort())

/** Material-only selection aid. The backend still validates the complete frozen grant. */
export function selectedWallSurfaceIds(scene: SceneDocument, selectedIds: readonly string[]): string[] {
  const visibility = createPublicVisibility(scene), roomEdges = new Map(Object.values(scene.rooms).map(room => [room.id,
    new Set(room.boundaryVertexIds.map((id, index, ids) => edgeKey(id, ids[(index + 1) % ids.length])))]))
  const publicWall = (id: string) => {
    const wall = scene.walls[id]
    return !!wall && Object.values(scene.rooms).filter(room => roomEdges.get(room.id)!.has(edgeKey(wall.startVertexId, wall.endVertexId))).every(room => visibility.room(room.id))
  }
  const publicVertex = (id: string) => !!scene.vertices[id]
    && Object.values(scene.walls).filter(wall => wall.startVertexId === id || wall.endVertexId === id).every(wall => publicWall(wall.id))
    && Object.values(scene.rooms).filter(room => room.boundaryVertexIds.includes(id)).every(room => visibility.room(room.id))
  const candidates = new Set<string>()
  for (const id of selectedIds) {
    if (scene.walls[id]) candidates.add(id)
    else if (scene.rooms[id] && visibility.room(id)) {
      const edges = roomEdges.get(id)!
      for (const wall of Object.values(scene.walls)) if (wall.floorId === scene.rooms[id].floorId && edges.has(edgeKey(wall.startVertexId, wall.endVertexId))) candidates.add(wall.id)
    }
  }
  const result = new Set<string>()
  for (const id of candidates) {
    const wall = scene.walls[id], endpoints = [wall.startVertexId, wall.endVertexId]
    if (!publicWall(id) || endpoints.some(endpoint => !publicVertex(endpoint)) || [id, ...endpoints].some(target => effectiveEditLocked(scene, target))) continue
    result.add(id); endpoints.forEach(endpoint => result.add(endpoint))
  }
  return [...result].sort()
}
