import type { EditableProject } from '../../application/workspace/project'
import type { CommandBudgetProfile } from '../../shared/budget/command-budget'
import { createPublicVisibility } from '../../shared/geometry/visibility'
import { effectiveEditLocked } from '../../shared/commands/layers'
import { selectionActionReason, selectionCommands } from '../native-canvas/selection-actions'

export interface SceneClipboard {
  readonly marker: string
  readonly sceneId: string
  readonly ids: readonly string[]
  readonly stamp: string
}

function sourceStamp(project: EditableProject, ids: readonly string[]): string {
  const scene = project.document, appearance = project.appearance, visibility = createPublicVisibility(scene)
  return JSON.stringify(ids.map(id => {
    const prop = scene.props[id], layer = scene.entityLayers[id]
    return { prop: prop ?? null, birth: project.historyIdentity.propTokens[id], layer,
      public: prop ? visibility.prop(prop) : false, source: appearance.propSources[id],
      instance: appearance.instanceAdjustments[id] ?? [], layerAppearance: appearance.layerAdjustments[layer] ?? [] }
  }))
}

/** A bounded reference clipboard. Revalidates copied fields and identity before current-baseline preview. */
export function captureSceneClipboard(project: EditableProject, ids: readonly string[], budget?: CommandBudgetProfile): SceneClipboard {
  const reason = selectionActionReason(project.document, ids, 'copy', budget)
  if (reason) throw new Error(reason)
  if (ids.some(id => effectiveEditLocked(project.document, id))) throw new Error('选择含锁定对象或图层，请先解除对应编辑锁。')
  return Object.freeze({ marker: `sceneweave-clipboard:${crypto.randomUUID()}`, sceneId: project.document.sceneId,
    ids: Object.freeze([...ids]), stamp: sourceStamp(project, ids) })
}

export function pasteSceneClipboard(project: EditableProject, clipboard: SceneClipboard, budget?: CommandBudgetProfile) {
  if (clipboard.sceneId !== project.document.sceneId) throw new Error('复制来源属于另一个工程，请在当前工程重新复制。')
  if (sourceStamp(project, clipboard.ids) !== clipboard.stamp) throw new Error('复制源已改变或删除，请重新复制后粘贴；工程未修改。')
  if (clipboard.ids.some(id => effectiveEditLocked(project.document, id))) throw new Error('复制源或所属图层已锁定，请先解除对应编辑锁。')
  return selectionCommands(project.document, clipboard.ids, 'copy', undefined, budget)
}
