import { LAYER_ENTITY_COLLECTIONS, type SceneDocument } from '../model/scene.js'

/**
 * Detached effective-lock view for command and dependency inspection. The native
 * document format, user layers and memberships are retained without downgrade.
 * This view grants no snapshot certification and is never persisted.
 */
export function geometryDocumentForValidation(scene: SceneDocument, effectiveLocks = false): SceneDocument {
  if (!effectiveLocks) return scene
  const view: SceneDocument = { ...scene }
  for (const collection of LAYER_ENTITY_COLLECTIONS) {
    const record = scene[collection]
    Object.assign(view, { [collection]: Object.fromEntries(Object.entries(record).map(([id, entity]) => [id, {
      ...entity, editLocked: entity.editLocked || !!scene.userLayers[scene.entityLayers[id]]?.editLocked,
    }])) })
  }
  return view
}

/** IDs owned by the geometry domain, including nested stable identities. */
export function geometryIdentityIds(scene: SceneDocument): Set<string> {
  const ids = new Set<string>()
  const visit = (value: unknown) => {
    if (!value || typeof value !== 'object') return
    if (!Array.isArray(value)) {
      const record = value as Record<string, unknown>
      if (typeof record.id === 'string') ids.add(record.id)
      if (typeof record.segmentId === 'string') ids.add(record.segmentId)
    }
    for (const child of Object.values(value)) visit(child)
  }
  const { userLayers: _layers, entityLayers: _members, ...domain } = scene
  visit(domain)
  ids.add(scene.sceneId)
  return ids
}
