import { toGeometryDocumentV2 } from '../../core/v3/geometry-view'
import type { SceneDocumentV3 } from '../../core/v3/types'
import type { CompleteProjectV3 } from '../../io/v3/types'
import type { CompleteProjectV2 } from '../../io/v2/types'
import { hiddenDependentsV3 } from './selection'
export { hitTestLayersV3, selectInBoundsLayersV3, selectionGeometryLayersV3, summarizeSelectionLayersV3 } from './selection'

/** Explicit physical/domain view. Never use this as a renderer or storage input. */
export function domainProjectV3(project: CompleteProjectV3): CompleteProjectV2 {
  return { document: toGeometryDocumentV2(project.document, { effectiveLocks: true, layerOrder: true }), assets: project.assets, licenses: project.licenses, licenseBindings: project.licenseBindings }
}

export function hiddenEntitiesV3(scene: SceneDocumentV3, hiddenLayers: ReadonlySet<string>): Set<string> {
  const ids = new Set(Object.entries(scene.entityLayers).filter(([, layer]) => hiddenLayers.has(layer)).map(([id]) => id))
  return hiddenDependentsV3(scene, ids)
}

export function scopedHiddenEntitiesV3(scene: SceneDocumentV3, hidden: ReadonlySet<string>, currentLayer: string | null): Set<string> {
  const ids = new Set(hidden)
  if (currentLayer !== null) {
    for (const [id, layer] of Object.entries(scene.entityLayers)) if (layer !== currentLayer) ids.add(id)
    for (const area of Object.values(scene.terrainAreas)) if (scene.entityLayers[area.id] !== currentLayer) for (const point of area.boundaryMm) ids.add(point.id)
  }
  return ids
}
