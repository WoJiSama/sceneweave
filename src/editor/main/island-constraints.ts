import { assertTerrainConnectionClearances, type TerrainConnectionFixture } from '../../shared/geometry/terrain-travel'
import type { SceneDocument } from '../../shared/model/scene'

/** Persisted versioned opt-in for VIS-02's finite required stairs/approach fixture. */
export const ISLAND_PRESET_ID = 'sceneweave-vis02'
export const ISLAND_CONNECTIONS: readonly TerrainConnectionFixture[] = [
  { connectionId: 'island-stairs', minWidthMm: 2000, approachDepthMm: 2000 },
]
export function validateIslandEdits(scene: SceneDocument): void {
  if (scene.presetSnapshot.presetId === ISLAND_PRESET_ID && scene.presetSnapshot.presetVersion === 1) assertTerrainConnectionClearances(scene, ISLAND_CONNECTIONS)
}
