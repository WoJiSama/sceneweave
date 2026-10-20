import { assertDoorwayClearancesV2, type DoorwayFixtureV2 } from '../../core/v2/doorway-clearance'
import type { SceneDocumentV2 } from '../../core/v2/types'

/** Persisted, versioned opt-in for the finite VIS-01 fixture checks. */
export const STUDY_PRESET_ID = 'sceneweave-vis01'
export const STUDY_DOORWAYS: readonly DoorwayFixtureV2[] = [
  { openingId: 'entrance-door', minWidthMm: 1000, approachDepthMm: 1000 },
  { openingId: 'terrace-door', minWidthMm: 1200, approachDepthMm: 1500 },
]

export function validateStudyEditsV2(scene: SceneDocumentV2): void {
  if (scene.presetSnapshot.presetId === STUDY_PRESET_ID && scene.presetSnapshot.presetVersion === 1) {
    assertDoorwayClearancesV2(scene, STUDY_DOORWAYS)
  }
}
