import type { SceneDocument } from '../model/scene.js'
import { OperationRejected } from '../validation/operation-rejection.js'
import { visualBase } from './base.js'
import { lightHostIds, lightSourcePoints } from './light-geometry.js'

/** A removed opening, route, or surface leaves an editable preset. Disable it
 * in the same transaction so a later object reusing that ID cannot emit light. */
export function disableLostVisualLights(before: SceneDocument, after: SceneDocument): number {
  const next = visualBase(after)?.lights
  if (!next) return 0
  let count = 0
  for (const previous of Object.values(visualBase(before)?.lights ?? {})) {
    const light = next[previous.id]
    if (!previous.enabled || !light?.enabled || !lightHostIds(before, previous).length || lightSourcePoints(after, light).length) continue
    if (previous.editLocked || before.userLayers[previous.layerId]?.editLocked) {
      throw new OperationRejected('locked_dependency', '此修改将使已锁定灯光失去绑定，请先解除灯光图层锁。')
    }
    light.enabled = false
    count++
  }
  return count
}
