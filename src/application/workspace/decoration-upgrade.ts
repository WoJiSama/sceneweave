import type { CompleteValidationOptions } from '../../shared/ports/resources.js'
import type { PreparationContext } from '../../shared/ports/runtime.js'
import { captureJson } from '../../shared/validation/json.js'
import { captureEditableDraft, validateEditableProject, type EditableProject } from './project.js'

/** New strict fields require a preserved full copy, never an in-place field patch. */
export async function prepareDecorationUpgrade(source: EditableProject, options: { runtime: PreparationContext; validation: CompleteValidationOptions }): Promise<EditableProject> {
  const captured = captureEditableDraft(source)
  if (captured.schemaVersion !== 5) throw new Error('轻量布景升级需要先保存独立完整v5曲线连接副本。')
  const owned = await validateEditableProject(captured, options.validation), candidate = captureEditableDraft(owned)
  const now = options.runtime.clock.now(), sceneId = options.runtime.ids.nextId()
  candidate.schemaVersion = 6; candidate.document.schemaVersion = 6
  candidate.document.decorations = {}; candidate.document.decorationClusters = {}
  Object.assign(candidate.document, { sceneId, revision: 0, createdAt: now, updatedAt: now, title: `${owned.document.title} · 轻量布景副本` })
  candidate.historyIdentity = { ...captureJson(owned.historyIdentity), version: 4, decorationTokens: {}, lineageId: options.runtime.ids.nextId(), rootSceneId: sceneId }
  return validateEditableProject(candidate, options.validation)
}
