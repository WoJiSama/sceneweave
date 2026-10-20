import { assertTerrainConnectionClearancesV2, type TerrainConnectionFixtureV2 } from '../../core/v2/terrain-travel'
import type { SceneDocumentV2 } from '../../core/v2/types'

/** Persisted versioned opt-in for VIS-02's finite required stairs/approach fixture. */
export const ISLAND_PRESET_ID = 'sceneweave-vis02'
export const ISLAND_CONNECTIONS: readonly TerrainConnectionFixtureV2[] = [
  { connectionId: 'island-stairs', minWidthMm: 2000, approachDepthMm: 2000 },
]
export function validateIslandEditsV2(scene: SceneDocumentV2): void {
  if (scene.presetSnapshot.presetId === ISLAND_PRESET_ID && scene.presetSnapshot.presetVersion === 1) assertTerrainConnectionClearancesV2(scene, ISLAND_CONNECTIONS)
}
