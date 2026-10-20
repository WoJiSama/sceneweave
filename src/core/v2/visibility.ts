import type { PropV2, SceneDocumentV2, SurfaceRef } from './types'

/** Upstream audience semantics shared by finite commands; no render dependency. */
export function createPublicVisibilityV2(scene: SceneDocumentV2) {
  const terrainArea = (id: string): boolean => scene.terrainAreas[id]?.visibility === 'public'
  const room = (id: string): boolean => {
    const value = scene.rooms[id]
    return !!value && value.visibility === 'public' && (value.supportRef.kind === 'floor' ? !!scene.floors[value.supportRef.id] : terrainArea(value.supportRef.id))
  }
  const surface = (ref: SurfaceRef): boolean => ref.kind === 'floor' ? !!scene.floors[ref.id] : ref.kind === 'room' ? room(ref.id) : terrainArea(ref.id)
  const path = (id: string): boolean => {
    const value = scene.paths[id]
    return !!value && value.visibility === 'public' && value.supportRefs.every(surface)
  }
  const terrainEdge = (id: string): boolean => {
    const value = scene.terrainEdges[id]
    return !!value && value.visibility === 'public' && terrainArea(value.source.areaId) && (value.neighborAreaId === null || terrainArea(value.neighborAreaId))
  }
  const scatterGroup = (id: string): boolean => {
    const value = scene.scatterGroups[id]
    return !!value && value.visibility === 'public' && (value.domain.kind === 'area' ? terrainArea(value.domain.areaId) : value.domain.kind === 'path' ? path(value.domain.pathId) : terrainEdge(value.domain.edgeId))
  }
  const hiddenMembers = new Set<string>()
  for (const group of Object.values(scene.prefabInstances)) if (group.visibility !== 'public') for (const member of Object.values(group.members)) if (member.propId !== null) hiddenMembers.add(member.propId)
  for (const group of Object.values(scene.scatterGroups)) if (!scatterGroup(group.id)) for (const member of Object.values(group.members)) if (member.propId !== null) hiddenMembers.add(member.propId)
  const prop = (value: PropV2): boolean => value.visibility === 'public' && !hiddenMembers.has(value.id) && surface(value.supportRef) && (value.roomId === undefined || room(value.roomId))
  return { terrainArea, room, surface, path, terrainEdge, scatterGroup, prop }
}

/** Public candidate support is resolved before private coverage can cut public holes. */
export function publicTerrainViewV2(scene: SceneDocumentV2, visibility = createPublicVisibilityV2(scene)): SceneDocumentV2 {
  return { ...scene,
    terrainAreas: Object.fromEntries(Object.entries(scene.terrainAreas).filter(([id]) => visibility.terrainArea(id))),
    rooms: Object.fromEntries(Object.entries(scene.rooms).filter(([id]) => visibility.room(id))),
    paths: Object.fromEntries(Object.entries(scene.paths).filter(([id]) => visibility.path(id))),
    terrainEdges: Object.fromEntries(Object.entries(scene.terrainEdges).filter(([id]) => visibility.terrainEdge(id))),
  }
}
