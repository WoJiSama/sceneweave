import { assertTaskBudget, captureExecutionBudget, measureTaskBudget, type BudgetUsage, type TaskBudgetProfile } from '../../shared/budget/task-budget.js'
import { selectTerrainEditBudget } from './terrain-task-budget.js'
export { selectTerrainEditBudget } from './terrain-task-budget.js'
import type { EditableProject } from './project.js'
import { getVerifiedEditableProject, validateEditableProject } from './project.js'
import { materializeProject } from './prepare.js'
import type { CompleteValidationOptions, CancellationSignal } from '../../shared/ports/resources.js'
import { checkCancelled } from '../../shared/ports/resources.js'
import type { PreparationContext } from '../../shared/ports/runtime.js'
import { advanceHistoryIdentity } from '../../shared/history/identity.js'
import { addSurfaceAppearanceSource, surfaceStyle, syncAppearanceGraph } from '../../shared/appearance/graph.js'
import { canonicalJson, captureJson } from '../../shared/validation/json.js'
import { prepareTerrainEdit, terrainEditEntityChanges, terrainEditRequestSchema, type TerrainEditResult, type ProfiledTerrainEditResult } from '../../shared/terrain-generation/edit.js'
import { detachChangedAppearance } from '../../shared/terrain-generation/appearance-lifecycle.js'
import { pauseChangedCompositionAppearance } from '../../shared/terrain-generation/composition-lifecycle.js'
import { terrainSemanticCost } from '../../shared/terrain-generation/task-admission.js'
import { terrainCommandCost } from '../../shared/terrain-generation/cost.js'

export interface TerrainEditPreview {
  project: EditableProject
  document: EditableProject['document']
  result: TerrainEditResult | ProfiledTerrainEditResult
  input: TerrainEditResult['request']
  cost: ReturnType<typeof terrainCommandCost>
  impact: TerrainEditResult['impact']
  checkpoint: number
  currentSceneId: string
  currentRevision: number
  baseContentHash: string
  budgetProfile?: TaskBudgetProfile
  profileHash?: string
  usage?: BudgetUsage
}

/** Preserve fixed source paints and active adjustments while updating real overlay geometry. */
function synchronizeSurfaces(base: EditableProject, result: TerrainEditResult | ProfiledTerrainEditResult) {
  const appearance = captureJson(base.appearance)
  for (const [id, sourceId] of Object.entries(appearance.surfaceSources)) {
    const before = surfaceStyle(base.document, id), after = surfaceStyle(result.document, id)
    if (!before || !after || canonicalJson(before) === canonicalJson(after)) continue
    const source = appearance.sources[sourceId]
    if (source?.kind !== 'surface') throw new Error(`地形表面缺少固定源：${id}。`)
    if (canonicalJson(before.base) !== canonicalJson(after.base)) throw new Error('局部地形编辑不能隐式替换既有底材参数。')
    const snapshot = captureJson(source.snapshot)
    snapshot.overlays = after.overlays.map(overlay => {
      const previous = before.overlays.find(row => row.id === overlay.id), fixed = source.snapshot.overlays.find(row => row.id === overlay.id)
      if (!previous) {
        const fresh = captureJson(overlay)
        // A brush may select today's effective base material. Preserve its
        // original fixed paint so the active layer/instance adjustment runs
        // once, just as it does for the rest of this surface.
        if (canonicalJson(fresh.paint.materialRef) === canonicalJson(before.base.materialRef)
          && fresh.paint.tint === before.base.tint) {
          fresh.paint.materialRef = captureJson(source.snapshot.base.materialRef)
          fresh.paint.tint = source.snapshot.base.tint
        }
        return fresh
      }
      if (!fixed || canonicalJson(previous.paint) !== canonicalJson(overlay.paint)) throw new Error(`局部地形编辑不能改写人工表面外观：${id}/${overlay.id}。`)
      return { ...captureJson(fixed), boundaryMm: captureJson(overlay.boundaryMm), blendWidthMm: overlay.blendWidthMm, renderOrder: overlay.renderOrder }
    })
    appearance.surfaceSources[id] = addSurfaceAppearanceSource(appearance, snapshot, sourceId)
  }
  return appearance
}

/** Main-thread replay owns geometry; worker output is only an independently checked calculation. */
export async function prepareTerrainEditProject(base: EditableProject, input: unknown, options: {
  runtime: PreparationContext; validation: CompleteValidationOptions; result?: TerrainEditResult | ProfiledTerrainEditResult; signal?: CancellationSignal; budget?: TaskBudgetProfile
}) {
  const validation = { ...options.validation, signal: options.signal ?? options.validation.signal }
  checkCancelled(validation.signal)
  const owned = getVerifiedEditableProject(base) ?? await validateEditableProject(base, validation)
  if (owned.document.mapMode !== 'scene') throw new Error('局部地形编辑需要场景工程。')
  const budgetProfile = selectTerrainEditBudget(owned.document, options.budget), meter = budgetProfile ? captureExecutionBudget(budgetProfile) : undefined
  const request = terrainEditRequestSchema.parse(captureJson(input))
  const result = budgetProfile ? prepareTerrainEdit(owned.document, request, { budget: budgetProfile, meter }) : prepareTerrainEdit(owned.document, request)
  if (options.result && canonicalJson(result) !== canonicalJson(captureJson(options.result))) throw new Error('局部地形计算结果与确定性重放不符。')
  checkCancelled(validation.signal)
  const historyIdentity = advanceHistoryIdentity(owned.historyIdentity, owned.document, result.document, options.runtime)
  const content = syncAppearanceGraph({ document: result.document, historyIdentity, appearance: synchronizeSurfaces(owned, result) })
  // A fixed surface source can change when its overlay geometry follows the
  // edited shoreline. Review the resulting manual protection before bitmap
  // materialization; the worker's independently replayed result stays intact.
  detachChangedAppearance(owned, content)
  pauseChangedCompositionAppearance(owned, content)
  const project = await materializeProject({ ...owned, ...content }, { runtime: options.runtime, validation, signal: validation.signal, baseline: owned, budget: budgetProfile })
  checkCancelled(validation.signal)
  if (canonicalJson(project.document) !== canonicalJson(content.document)) throw new Error('局部地形物化改变了已审阅结果；请先解决现有表面覆盖或依赖冲突。')
  const changes = terrainEditEntityChanges(owned.document, project.document)
  const writeIds = new Set(changes.writeIds)
  const impact = { ...result.impact, writeIds: changes.writeIds, preservedIds: result.impact.preservedIds.filter(id => !writeIds.has(id)) }
  const cost = budgetProfile ? terrainSemanticCost(owned.document, project.document, budgetProfile) : terrainCommandCost(owned.document, project.document, { before: owned, after: project })
  if (cost.total > cost.limit) throw new Error(`局部地形完整影响展开${cost.total}，超过${cost.limit}；请缩小本次修改。`)
  const usage = budgetProfile ? assertTaskBudget(budgetProfile, measureTaskBudget(owned.document, project.document, { before: owned, after: project }, meter?.snapshot())) : undefined
  return { project, document: project.document, result, input: result.request, cost, impact, ...(budgetProfile ? { budgetProfile, profileHash: budgetProfile.profileHash, usage } : {}) }
}
