import type { Decoration, Prop, SceneDocument, SurfaceRef } from '../model/scene.js'
import { visualBase } from '../visual/base.js'
import type { AttachmentOwner } from '../attachments/contracts.js'

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
  const attachmentSurface = (id: string, seen = new Set<string>()): boolean => {
    const row = scene.attachmentSurfaces?.[id]
    return !!row && ownerPublic(row.owner, seen)
  }
  const ownerPublic = (owner: AttachmentOwner, seen: Set<string>): boolean => owner.kind === 'terrainArea' ? terrainArea(owner.id) : owner.kind === 'wall' ? wall(owner.id)
    : owner.kind === 'terrainConnection' ? terrainConnection(owner.id, seen) : !!scene.props[owner.id] && prop(scene.props[owner.id], seen)
  const terrainConnection = (id: string, seen = new Set<string>()): boolean => {
    const value = scene.terrainConnections[id]
    if (!value || value.visibility !== 'public' || !surface(value.from.surfaceRef) || !surface(value.to.surfaceRef) || value.openingId && !opening(value.openingId) || seen.has('connection:' + id)) return false
    if (value.terrainInlay) return value.terrainInlay.geometry.sources.every(source => terrainArea(source.id))
    if (!value.carvedStrip) return true
    const relation = scene.attachments?.[value.carvedStrip.attachmentId], walk = scene.attachmentSurfaces?.[value.carvedStrip.walkSurfaceId], next = new Set([...seen, 'connection:' + id])
    return terrainArea(value.carvedStrip.hostAreaId) && !!walk && walk.owner.kind === 'terrainConnection' && walk.owner.id === id && walk.feature.kind === 'carvedWalk'
      && !!relation && relation.mode === 'embed' && relation.child.id === id && relation.surfaceIds.every(surfaceId => attachmentSurface(surfaceId, next))
  }
  const hiddenMembers = new Set<string>()
  for (const owner of Object.values(scene.paths)) if (owner.assembly && !path(owner.id)) {
    for (const member of Object.values(owner.assembly.members)) if (member.state === 'placed') hiddenMembers.add(member.propId)
  }
  for (const boundary of Object.values(visualBase(scene)?.boundaries ?? {})) if (boundary.fence && boundary.visibility !== 'public') {
    for (const member of Object.values(boundary.fence.members)) if (member.state === 'placed') hiddenMembers.add(member.propId)
  }
  for (const group of Object.values(scene.prefabInstances)) if (group.visibility !== 'public') for (const member of Object.values(group.members)) if (member.propId !== null) hiddenMembers.add(member.propId)
  for (const group of Object.values(scene.scatterGroups)) if (!scatterGroup(group.id)) for (const member of Object.values(group.members)) if (member.propId !== null) hiddenMembers.add(member.propId)
  for (const group of Object.values(scene.decorationClusters ?? {})) if (!decorationCluster(group.id)) for (const member of Object.values(group.members)) if (member.entityId !== null && member.state !== 'detached' && member.state !== 'deleted') hiddenMembers.add(member.entityId)
  const prop = (value: Prop, seen = new Set<string>()): boolean => {
    if (value.visibility !== 'public' || hiddenMembers.has(value.id) || !surface(value.supportRef) || value.roomId !== undefined && !room(value.roomId) || seen.has('prop:' + value.id)) return false
    const rows = Object.values(scene.attachments ?? {}).filter(row => row.child.kind === 'prop' && row.child.id === value.id)
    if (!rows.length) return true
    return rows.length === 1 && rows[0].mode !== 'embed' && attachmentSurface(rows[0].surfaceId, new Set([...seen, 'prop:' + value.id]))
  }
  const decoration = (value: Decoration): boolean => value.visibility === 'public' && !hiddenMembers.has(value.id) && surface(value.supportRef)
  return { terrainArea, room, surface, path, terrainEdge, scatterGroup, prop, decoration, decorationCluster, wall, opening, terrainConnection, attachmentSurface }
}

/** Public candidate support is resolved before private coverage can cut public holes. */
export function publicTerrainView(scene: SceneDocument, visibility = createPublicVisibility(scene)): SceneDocument {
  const view: SceneDocument = { ...scene,
    terrainAreas: Object.fromEntries(Object.entries(scene.terrainAreas).filter(([id]) => visibility.terrainArea(id))),
    rooms: Object.fromEntries(Object.entries(scene.rooms).filter(([id]) => visibility.room(id))),
    paths: Object.fromEntries(Object.entries(scene.paths).filter(([id]) => visibility.path(id))),
    terrainEdges: Object.fromEntries(Object.entries(scene.terrainEdges).filter(([id]) => visibility.terrainEdge(id))),
    terrainConnections: Object.fromEntries(Object.entries(scene.terrainConnections).filter(([id]) => visibility.terrainConnection(id))),
    walls: Object.fromEntries(Object.entries(scene.walls).filter(([id]) => visibility.wall(id))),
    openings: Object.fromEntries(Object.entries(scene.openings).filter(([id]) => visibility.opening(id))),
    regions: Object.fromEntries(Object.entries(scene.regions).filter(([, value]) => value.visibility === 'public')),
    props: Object.fromEntries(Object.entries(scene.props).filter(([, value]) => visibility.prop(value))),
      decorations: Object.fromEntries(Object.entries(scene.decorations ?? {}).filter(([, value]) => visibility.decoration(value))),
      decorationClusters: Object.fromEntries(Object.entries(scene.decorationClusters ?? {}).filter(([id]) => visibility.decorationCluster(id))),
  }
  const ownerPresent = (owner: AttachmentOwner) => owner.kind === 'terrainArea' ? !!view.terrainAreas[owner.id] : owner.kind === 'wall' ? !!view.walls[owner.id] : owner.kind === 'terrainConnection' ? !!view.terrainConnections[owner.id] : !!view.props[owner.id]
  if (scene.attachmentSurfaces) view.attachmentSurfaces = Object.fromEntries(Object.entries(scene.attachmentSurfaces).filter(([id, row]) => visibility.attachmentSurface(id) && ownerPresent(row.owner)))
  if (scene.attachments) view.attachments = Object.fromEntries(Object.entries(scene.attachments).filter(([, row]) => row.mode === 'embed'
    ? !!view.terrainConnections[row.child.id] && row.surfaceIds.every(id => !!view.attachmentSurfaces?.[id])
    : !!view.props[row.child.id] && !!view.attachmentSurfaces?.[row.surfaceId]))
  return view
}
