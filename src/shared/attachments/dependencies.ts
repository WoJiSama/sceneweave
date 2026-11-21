import type { Attachment, AttachmentSurface } from './contracts.js'
import type { AttachmentScene } from './topology.js'

/** Read-only closure: roots, actual hosts, groups, recursively anchored notes and layers. */
export function attachmentDependencyIds(scene: AttachmentScene, value: Attachment | AttachmentSurface): string[] {
  const ids = new Set<string>([value.id]), add = (id: string | undefined) => { if (id) ids.add(id) }
  if ('mode' in value) {
    add(value.child.id)
    for (const id of value.mode === 'embed' ? value.surfaceIds : [value.surfaceId]) {
      add(id); const surface = scene.attachmentSurfaces?.[id]; if (surface) add(surface.owner.id)
    }
  } else add(value.owner.id)
  return expandDependencyIds(scene, ids)
}

/** Host edits need the same real closure even before a surface exists. */
export function attachmentOwnerDependencyIds(scene: AttachmentScene, ownerId: string): string[] {
  return expandDependencyIds(scene, new Set([ownerId]))
}

export function followingAttachmentProps(scene: AttachmentScene, ownerId: string): Set<string> {
  const children = new Map<string, string[]>()
  for (const row of Object.values(scene.attachments ?? {})) {
    if (row.mode === 'embed' || row.follow !== 'follow') continue
    const owner = scene.attachmentSurfaces?.[row.surfaceId]?.owner.id
    if (owner) children.set(owner, [...(children.get(owner) ?? []), row.child.id])
  }
  const result = new Set<string>(), queue = [ownerId]
  for (const owner of queue) for (const child of children.get(owner) ?? []) if (!result.has(child) && child !== ownerId) {
    result.add(child)
    queue.push(child)
  }
  return result
}

function expandDependencyIds(scene: AttachmentScene, ids: Set<string>): string[] {
  const add = (id: string | undefined) => { if (id) ids.add(id) }
  let more = true
  while (more) {
    more = false; const size = ids.size
    for (const prop of Object.values(scene.props)) if (ids.has(prop.id)) { add(prop.supportRef.id); add(prop.roomId) }
    for (const room of Object.values(scene.rooms)) if (ids.has(room.id)) { add(room.supportRef.id); room.boundaryVertexIds.forEach(add) }
    for (const wall of Object.values(scene.walls)) if (ids.has(wall.id)) {
      add(wall.startVertexId); add(wall.endVertexId)
      for (const room of Object.values(scene.rooms)) if (room.boundaryVertexIds.some((v, i) => {
        const b = room.boundaryVertexIds[(i + 1) % room.boundaryVertexIds.length]
        return v === wall.startVertexId && b === wall.endVertexId || v === wall.endVertexId && b === wall.startVertexId
      })) add(room.id)
    }
    for (const opening of Object.values(scene.openings)) if (ids.has(opening.wallId) || ids.has(opening.id)) { add(opening.id); add(opening.wallId) }
    for (const connection of Object.values(scene.terrainConnections)) if (ids.has(connection.id)) { add(connection.from.surfaceRef.id); add(connection.to.surfaceRef.id); add(connection.openingId ?? undefined) }
    for (const row of Object.values(scene.attachments ?? {})) if (ids.has(row.child.id) || (row.mode === 'embed' ? row.surfaceIds : [row.surfaceId]).some(id => ids.has(scene.attachmentSurfaces?.[id]?.owner.id ?? ''))) {
      add(row.id); add(row.child.id)
      for (const id of row.mode === 'embed' ? row.surfaceIds : [row.surfaceId]) { add(id); add(scene.attachmentSurfaces?.[id]?.owner.id) }
    }
    for (const group of Object.values(scene.prefabInstances)) if (ids.has(group.id) || Object.values(group.members).some(v => v.propId !== null && ids.has(v.propId))) {
      add(group.id); for (const member of Object.values(group.members)) if (member.propId) add(member.propId)
    }
    for (const group of Object.values(scene.scatterGroups)) if (ids.has(group.id) || Object.values(group.members).some(v => v.propId !== null && ids.has(v.propId))) add(group.id)
    for (const group of Object.values(scene.decorationClusters ?? {})) if (ids.has(group.id) || Object.values(group.members).some(v => v.entityId !== null && ids.has(v.entityId))) add(group.id)
    for (const group of Object.values(scene.aggregateCoordinates?.groups ?? {})) if (ids.has(group.id) || group.members.some(v => ids.has(v.id))) add(group.id)
    for (const note of Object.values(scene.notes)) if (note.anchor.type === 'entity' && ids.has(note.anchor.entityId)) add(note.id)
    for (const id of [...ids]) add(scene.entityLayers[id])
    more = ids.size !== size
    if (ids.size > 4096) throw new Error('附着真实依赖超过4096，保留当前成果。')
  }
  return [...ids].sort()
}
export function assertAttachmentLocks(scene: AttachmentScene, ids: readonly string[], carriedPropIds?: ReadonlySet<string>): void {
  const locked = new Set<string>()
  const collections = ['props', 'rooms', 'walls', 'vertices', 'openings', 'terrainAreas', 'terrainEdges', 'terrainConnections', 'paths', 'notes', 'prefabInstances', 'scatterGroups', 'decorations', 'decorationClusters', 'surfaceRules', 'userLayers'] as const
  for (const collection of collections) for (const value of Object.values(scene[collection] ?? {})) if (value.editLocked) locked.add(value.id)
  for (const value of Object.values(scene.aggregateCoordinates?.groups ?? {})) if (value.editLocked) locked.add(value.id)
  for (const id of ids) if (locked.has(id) && !carriedPropIds?.has(id) || scene.userLayers[scene.entityLayers[id]]?.editLocked) throw new Error(`附着涉及锁定实体、图层或递归依赖：${id}。`)
}
