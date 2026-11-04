import type { CompleteValidationOptions } from '../../shared/ports/resources.js'
import type { PreparationContext } from '../../shared/ports/runtime.js'
import { captureJson } from '../../shared/validation/json.js'
import { captureEditableDraft, validateEditableProject, type EditableProject } from './project.js'

/** Canopy rules have an explicit strict v7 home; preserve v6 as a full copy. */
export async function prepareCanopyUpgrade(source: EditableProject, options: { runtime: PreparationContext; validation: CompleteValidationOptions }): Promise<EditableProject> {
  const captured = captureEditableDraft(source)
  if (captured.schemaVersion !== 6) throw new Error('树冠区域规则升级需要先保存独立完整v6布景副本。')
  const owned = await validateEditableProject(captured, options.validation), candidate = captureEditableDraft(owned)
  const now = options.runtime.clock.now(), sceneId = options.runtime.ids.nextId()
  candidate.schemaVersion = 7; candidate.document.schemaVersion = 7
  Object.assign(candidate.document, { sceneId, revision: 0, createdAt: now, updatedAt: now, title: `${owned.document.title} · 树冠区域规则副本` })
  candidate.historyIdentity = { ...captureJson(owned.historyIdentity), lineageId: options.runtime.ids.nextId(), rootSceneId: sceneId }
  return validateEditableProject(candidate, options.validation)
}
