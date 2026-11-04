import type { Decoration, Prop, SceneDocument, SurfaceRef } from '../model/scene.js'

/** Upstream audience semantics shared by finite commands; no render dependency. */
export function createPublicVisibility(scene: SceneDocument) {
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
  const decorationCluster = (id: string): boolean => {
    const value = scene.decorationClusters?.[id]
    return !!value && value.visibility === 'public' && surface(value.supportRef)
  }
  const wall = (id: string): boolean => {
    const value = scene.walls[id]
    if (!value) return false
    const owners = Object.values(scene.rooms).filter(owner => owner.boundaryVertexIds.some((a, index) => {
      const b = owner.boundaryVertexIds[(index + 1) % owner.boundaryVertexIds.length]
      return a === value.startVertexId && b === value.endVertexId || a === value.endVertexId && b === value.startVertexId
    }))
    return !owners.length || owners.some(owner => room(owner.id))
  }
  const opening = (id: string): boolean => {
    const value = scene.openings[id]
    return !!value && wall(value.wallId) && (!value.secret || value.revealed)
  }
  const terrainConnection = (id: string): boolean => {
    const value = scene.terrainConnections[id]
    return !!value && value.visibility === 'public' && surface(value.from.surfaceRef) && surface(value.to.surfaceRef) && (!value.openingId || opening(value.openingId))
  }
  const hiddenMembers = new Set<string>()
  for (const group of Object.values(scene.prefabInstances)) if (group.visibility !== 'public') for (const member of Object.values(group.members)) if (member.propId !== null) hiddenMembers.add(member.propId)
  for (const group of Object.values(scene.scatterGroups)) if (!scatterGroup(group.id)) for (const member of Object.values(group.members)) if (member.propId !== null) hiddenMembers.add(member.propId)
  for (const group of Object.values(scene.decorationClusters ?? {})) if (!decorationCluster(group.id)) for (const member of Object.values(group.members)) if (member.entityId !== null && member.state !== 'detached' && member.state !== 'deleted') hiddenMembers.add(member.entityId)
  const prop = (value: Prop): boolean => value.visibility === 'public' && !hiddenMembers.has(value.id) && surface(value.supportRef) && (value.roomId === undefined || room(value.roomId))
  const decoration = (value: Decoration): boolean => value.visibility === 'public' && !hiddenMembers.has(value.id) && surface(value.supportRef)
  return { terrainArea, room, surface, path, terrainEdge, scatterGroup, prop, decoration, decorationCluster, wall, opening, terrainConnection }
}

/** Public candidate support is resolved before private coverage can cut public holes. */
export function publicTerrainView(scene: SceneDocument, visibility = createPublicVisibility(scene)): SceneDocument {
  return { ...scene,
    terrainAreas: Object.fromEntries(Object.entries(scene.terrainAreas).filter(([id]) => visibility.terrainArea(id))),
    rooms: Object.fromEntries(Object.entries(scene.rooms).filter(([id]) => visibility.room(id))),
    paths: Object.fromEntries(Object.entries(scene.paths).filter(([id]) => visibility.path(id))),
    terrainEdges: Object.fromEntries(Object.entries(scene.terrainEdges).filter(([id]) => visibility.terrainEdge(id))),
    ...(scene.schemaVersion >= 6 ? { props: Object.fromEntries(Object.entries(scene.props).filter(([, value]) => visibility.prop(value))),
      decorations: Object.fromEntries(Object.entries(scene.decorations ?? {}).filter(([, value]) => visibility.decoration(value))),
      decorationClusters: Object.fromEntries(Object.entries(scene.decorationClusters ?? {}).filter(([id]) => visibility.decorationCluster(id))) } : {}),
  }
}
