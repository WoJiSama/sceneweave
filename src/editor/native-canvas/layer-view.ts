import { selectionScene as toGeometryDocumentV2 } from './selection-scene'
import type { SceneDocument as SceneDocumentV3 } from '../../shared/model/scene.js'
import type { EditableProject as CompleteProjectV3 } from '../../application/workspace/project'
import type { EditableProject as CompleteProjectV2 } from '../../application/workspace/project'
import { hiddenDependentsV3 } from './layer-selection'
export { hitTestLayersV3, selectInBoundsLayersV3, selectionGeometryLayersV3, summarizeSelectionLayersV3 } from './layer-selection'

/** Explicit physical/domain view. Never use this as a renderer or storage input. */
export function domainProjectV3(project: CompleteProjectV3): CompleteProjectV2 {
  return { ...project, document: toGeometryDocumentV2(project.document, { effectiveLocks: true, layerOrder: true }) }
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

export { domainProjectV3 as domainProject }
export { hiddenEntitiesV3 as hiddenEntities }
export { scopedHiddenEntitiesV3 as scopedHiddenEntities }
export { hitTestLayersV3 as hitTestLayers, selectInBoundsLayersV3 as selectInBoundsLayers, selectionGeometryLayersV3 as selectionGeometryLayers, summarizeSelectionLayersV3 as summarizeSelectionLayers } from './layer-selection'
