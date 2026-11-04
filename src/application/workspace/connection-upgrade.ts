import type { CompleteValidationOptions } from '../../shared/ports/resources.js'
import type { PreparationContext } from '../../shared/ports/runtime.js'
import { captureJson } from '../../shared/validation/json.js'
import { captureEditableDraft, validateEditableProject, type EditableProject } from './project.js'

/** A new full copy only. Absent routes keep every old connection, receipt,
 * resource and picture unchanged; no new topology is invented by migration. */
export async function prepareConnectionUpgrade(source: EditableProject, options: { runtime: PreparationContext; validation: CompleteValidationOptions }): Promise<EditableProject> {
  if (source.schemaVersion !== 4) throw new Error('曲线连接升级需要先保存独立完整v4地貌组合副本。')
  const owned = await validateEditableProject(source, options.validation), candidate = captureEditableDraft(owned)
  const now = options.runtime.clock.now(), sceneId = options.runtime.ids.nextId()
  candidate.schemaVersion = 5
  candidate.document.schemaVersion = 5
  Object.assign(candidate.document, { sceneId, revision: 0, createdAt: now, updatedAt: now, title: `${owned.document.title} · 曲线连接副本` })
  candidate.historyIdentity = { ...captureJson(owned.historyIdentity), lineageId: options.runtime.ids.nextId(), rootSceneId: sceneId }
  return validateEditableProject(candidate, options.validation)
}
