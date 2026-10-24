import { assertDoorwayClearances, type DoorwayFixture } from '../../shared/geometry/doorway-clearance'
import type { SceneDocument } from '../../shared/model/scene'

/** Persisted, versioned opt-in for the finite VIS-01 fixture checks. */
export const STUDY_PRESET_ID = 'sceneweave-vis01'
export const STUDY_DOORWAYS: readonly DoorwayFixture[] = [
  { openingId: 'entrance-door', minWidthMm: 1000, approachDepthMm: 1000 },
  { openingId: 'terrace-door', minWidthMm: 1200, approachDepthMm: 1500 },
]

export function validateStudyEdits(scene: SceneDocument): void {
  if (scene.presetSnapshot.presetId === STUDY_PRESET_ID && scene.presetSnapshot.presetVersion === 1) {
    assertDoorwayClearances(scene, STUDY_DOORWAYS)
  }
}
