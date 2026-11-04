import type { CompleteValidationOptions } from '../../shared/ports/resources.js'
import type { PreparationContext } from '../../shared/ports/runtime.js'
import { advanceHistoryIdentity } from '../../shared/history/identity.js'
import { polygonBoolean } from '../../shared/geometry/polygon-boolean.js'
import { captureEditableDraft, validateEditableProject, type EditableProject } from './project.js'

/** Move rule ownership into strict v8 without generating or editing any member. */
export async function prepareSurfaceRulesUpgrade(source: EditableProject, options: { runtime: PreparationContext; validation: CompleteValidationOptions }): Promise<EditableProject> {
  const captured = captureEditableDraft(source)
  if (captured.schemaVersion !== 7) throw new Error('连续地表规则升级需要先保存独立完整v7树冠规则副本。')
  const owned = await validateEditableProject(captured, options.validation), candidate = captureEditableDraft(owned)
  candidate.schemaVersion = 8; candidate.document.schemaVersion = 8; candidate.document.surfaceRules = {}
  for (const cluster of Object.values(candidate.document.decorationClusters ?? {}).sort((a, b) => a.id.localeCompare(b.id))) {
    const canopy = cluster.canopyRule
    if (!canopy) continue
    if (cluster.supportRef.kind !== 'terrainArea') throw new Error('树冠规则迁移缺少明确地形支撑，已保留原工程。')
    const id = options.runtime.ids.nextId()
    candidate.document.surfaceRules[id] = {
      id, floorId: cluster.floorId, editLocked: cluster.editLocked, visibility: cluster.visibility,
      supportRef: { kind: 'terrainArea', id: cluster.supportRef.id }, field: 'trees', paintOrder: canopy.paintOrder,
      regionsMm: polygonBoolean({ operation: 'union', subject: canopy.regionsMm, clip: [] }).polygons.map(polygon => ({ outerMm: polygon.outer, holesMm: polygon.holes })),
      clusterId: cluster.id, coveragePpm: canopy.mode === 'erase' ? 0 : canopy.canopyCoveragePpm,
    }
    candidate.document.entityLayers[id] = candidate.document.entityLayers[cluster.id]
    delete cluster.canopyRule
  }
  // The cluster's birth and member ownership survive. Removing its old canopy
  // topology explicitly advances only that topology token, while v8 rules get
  // fresh births in the new identity5 pool. No generator runs in this path.
  candidate.historyIdentity = advanceHistoryIdentity(owned.historyIdentity, owned.document, candidate.document, options.runtime)
  const now = options.runtime.clock.now(), sceneId = options.runtime.ids.nextId()
  Object.assign(candidate.document, { sceneId, revision: 0, createdAt: now, updatedAt: now, title: `${owned.document.title} · 连续地表规则副本` })
  candidate.historyIdentity.lineageId = options.runtime.ids.nextId(); candidate.historyIdentity.rootSceneId = sceneId
  return validateEditableProject(candidate, options.validation)
}
