import type { Id, SceneDocumentV2 } from '../v2/types'

export type * from '../v2/types'

/** User organization is separate from system render bands, Floor and elevation. */
export interface UserLayerV3 {
  id: Id
  floorId: Id
  name: string
  order: number
  editLocked: boolean
}

export interface SceneDocumentV3 extends Omit<SceneDocumentV2, 'schemaVersion'> {
  schemaVersion: 3
  userLayers: Record<Id, UserLayerV3>
  /** Embedded terrain points inherit their area's layer and have no separate entry. */
  entityLayers: Record<Id, Id>
}

export const USER_LAYER_LIMIT_V3 = 128
export const COMMAND_LIMIT_V3 = 256

export const LAYER_ENTITY_COLLECTIONS_V3 = [
  'vertices', 'rooms', 'walls', 'openings', 'props', 'regions', 'notes',
  'terrainAreas', 'terrainEdges', 'terrainConnections', 'paths', 'prefabInstances', 'scatterGroups',
] as const

export type LayerEntityCollectionV3 = typeof LAYER_ENTITY_COLLECTIONS_V3[number]
