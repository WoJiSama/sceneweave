import { LAYER_ENTITY_COLLECTIONS, DECORATION_COLLECTIONS, SURFACE_RULE_COLLECTIONS, type SceneDocument } from '../model/scene.js'
import { getLegacyGeneration } from '../terrain-generation/composition-contracts.js'

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
  // Recipe-local requirement keys do not allocate scene identities. The strict
  // recipe schema owns these parameter records, independent of domain names.
  const recipeParameters = new Set<unknown>(Object.values(getLegacyGeneration(scene)?.recipes ?? {}).map(recipe => recipe.parameters))
  const visit = (value: unknown) => {
    if (!value || typeof value !== 'object') return
    if (!Array.isArray(value)) {
      const record = value as Record<string, unknown>
      if (typeof record.id === 'string') ids.add(record.id)
      if (typeof record.segmentId === 'string') ids.add(record.segmentId)
    }
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (key === 'parameters' && recipeParameters.has(child)) continue
      visit(child)
    }
  }
  const { userLayers: _layers, entityLayers: _members, ...domain } = scene
  visit(domain)
  for (const connection of Object.values(scene.terrainConnections)) if (connection.carvedStrip) {
    for (const id of Object.keys(connection.carvedStrip.verticesMm)) ids.add(id)
  }
  for (const connection of Object.values(scene.terrainConnections)) if (connection.terrainInlay) {
    for (const id of Object.keys(connection.terrainInlay.geometry.verticesMm)) ids.add(id)
  }
  for (const area of Object.values(scene.terrainAreas)) if (area.rockBody?.shell) for (const id of Object.keys(area.rockBody.shell.verticesMm)) ids.add(id)
  ids.add(scene.sceneId)
  return ids
}
