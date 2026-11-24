import type { SceneDocument } from '../../shared/model/scene'

export function outdoorEntityKind(scene: SceneDocument, id: string) {
  if (scene.terrainAreas[id]) return 'terrainArea'
  if (scene.terrainEdges[id]) return 'terrainEdge'
  if (scene.terrainConnections[id]) return 'terrainConnection'
  if (scene.paths[id]) return 'path'
  if (scene.scatterGroups[id]) return 'scatterGroup'
  if (scene.regions[id] && scene.regions[id].kind !== 'manualMask') return 'region'
  return null
}
