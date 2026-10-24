import { z } from 'zod'
import type { SceneDocument } from '../model/scene.js'

/** Display preferences use existing scene fields; they never rescale world geometry. */
export type SceneDisplayCommand = {
  type: 'setSceneDisplay'
  display: 'm' | 'ft'
  distanceMode: 'metric' | 'grid' | 'abstract'
  gridSizeMm: number
  snapMm: number
  gridVisible: boolean
}

const positiveMm = z.number().finite().refine(Number.isSafeInteger, '格距和吸附必须为整数毫米').refine(value => value > 0, '格距和吸附必须大于零')
export const sceneDisplayCommandSchema = z.object({
  type: z.literal('setSceneDisplay'), display: z.enum(['m', 'ft']), distanceMode: z.enum(['metric', 'grid', 'abstract']),
  gridSizeMm: positiveMm, snapMm: positiveMm, gridVisible: z.boolean(),
}).strict()

export function applySceneDisplayCommand(scene: SceneDocument, command: SceneDisplayCommand): void {
  scene.units = { world: 'mm', display: command.display, gridSizeMm: command.gridSizeMm, snapMm: command.snapMm, gridVisible: command.gridVisible }
  // Preserve the fixed preset's identity, provenance and fixture-specific guards.
  scene.presetSnapshot = { ...scene.presetSnapshot, distanceMode: command.distanceMode, gridSizeMm: command.gridSizeMm }
}
