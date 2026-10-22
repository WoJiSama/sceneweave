import type { SceneDocumentV2 } from '../v2/types'
import { LAYER_ENTITY_COLLECTIONS_V3, type SceneDocumentV3 } from './types'

/**
 * Internal domain adapter for reused geometry/dependency/command validation.
 * It is never a serialization, render or IO input and grants no certification.
 */
export function geometryDocumentForValidationV3(scene: SceneDocumentV3, effectiveLocks = false): SceneDocumentV2 {
  const { userLayers: _layers, entityLayers: _members, schemaVersion: _version, ...domain } = scene
  const view: SceneDocumentV2 = { ...domain, schemaVersion: 2 }
  if (effectiveLocks) for (const collection of LAYER_ENTITY_COLLECTIONS_V3) {
    const record = scene[collection]
    Object.assign(view, { [collection]: Object.fromEntries(Object.entries(record).map(([id, entity]) => [id, {
      ...entity, editLocked: entity.editLocked || !!scene.userLayers[scene.entityLayers[id]]?.editLocked,
    }])) })
  }
  return view
}

/** IDs owned by the geometry domain, including nested stable identities. */
export function geometryIdentityIdsV3(scene: SceneDocumentV3): Set<string> {
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
