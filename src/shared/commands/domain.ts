import { LAYER_ENTITY_COLLECTIONS, DECORATION_COLLECTIONS, SURFACE_RULE_COLLECTIONS, type SceneDocument } from '../model/scene.js'

/**
 * Detached effective-lock view for command and dependency inspection. The native
 * document format, user layers and memberships are retained without downgrade.
 * This view grants no snapshot certification and is never persisted.
 */
export function geometryDocumentForValidation(scene: SceneDocument, effectiveLocks = false): SceneDocument {
  if (!effectiveLocks) return scene
  const view: SceneDocument = { ...scene }
  for (const collection of [...LAYER_ENTITY_COLLECTIONS, ...DECORATION_COLLECTIONS, ...SURFACE_RULE_COLLECTIONS]) {
    const record = scene[collection]
    if (!record) continue
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
    // Interior room IDs inside normalized parameters name local requirements,
    // not scene entities. In particular they cannot reserve a deleted entity's
    // ID and falsely turn its genuine identity tombstone into a collision.
    const record = value as Record<string, unknown>
    for (const [key, child] of Object.entries(record)) {
      if (key === 'parameters' && (record.domain === 'interior' && record.algorithmId === 'interior-layout' || record.domain === 'forest' && record.algorithmId === 'forest-layout' || record.domain === 'volcano' && record.algorithmId === 'volcano-layout')) continue
      visit(child)
    }
  }
  const { userLayers: _layers, entityLayers: _members, ...domain } = scene
  visit(domain)
  ids.add(scene.sceneId)
  return ids
}
