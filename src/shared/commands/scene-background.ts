import { z } from 'zod'
import type { SceneDocument, SceneOutputBackground } from '../model/scene.js'
import { sceneOutputBackgroundSchema } from '../validation/scene-background.js'

/** Global paint setting; null restores the normal renderer background. */
export interface SceneBackgroundCommand { type: 'setSceneBackground'; background: SceneOutputBackground | null }
export const sceneBackgroundCommandSchema = z.object({ type: z.literal('setSceneBackground'), background: sceneOutputBackgroundSchema.nullable() }).strict()

export function applySceneBackgroundCommand(scene: SceneDocument, command: SceneBackgroundCommand): void {
  if (command.background === null) delete scene.outputBackground
  else scene.outputBackground = { ...command.background }
}
