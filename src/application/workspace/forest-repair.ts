import { assertTaskBudget, withAdditionalExecutionWorkObserver, type BudgetUsage, type TaskBudgetProfile } from '../../shared/budget/task-budget.js'
import { hashGenerationValue } from '../../shared/generation/contracts.js'
import { combineForestCandidateUsage } from '../../shared/generation/forest-budget.js'
import { diagnoseForestFurniture, forestFurnitureNotes } from '../../shared/generation/forest-furniture.js'
import { checkCancelled, type CompleteValidationOptions, type CancellationSignal } from '../../shared/ports/resources.js'
import type { SceneDocument } from '../../shared/model/scene.js'
import type { PreparationContext } from '../../shared/ports/runtime.js'
import { getLegacyGeneration } from '../../shared/terrain-generation/composition-contracts.js'
import { prepareLocalGenerationProject } from './generation-local.js'
import type { EditableProject } from './project.js'
import type { MixedCandidate } from './mixed.js'

/** Observe synchronous diagnostic work without retaining a global observer
 * over resource IO. The existing generation work remains charged. */
function inspect(document: SceneDocument, profile: TaskBudgetProfile, usage: BudgetUsage, signal?: CancellationSignal) {
  const cumulative = { ...usage }, started = performance.now()
  const diagnostics = withAdditionalExecutionWorkObserver(delta => {
    for (const key of Object.keys(delta) as (keyof BudgetUsage)[]) {
      cumulative[key] += delta[key] ?? 0
      if (!Number.isSafeInteger(cumulative[key]) || cumulative[key] > profile.limits[key]) throw new Error(`任务预算超限[${key}]：${cumulative[key]}/${profile.limits[key]}，保留当前成果。`)
    }
  }, () => diagnoseForestFurniture(document, { profile, checkCancelled: () => checkCancelled(signal) }))
  cumulative.activeExecutionMs += Math.ceil(performance.now() - started)
  return { furnitureDiagnostics: diagnostics, usage: assertTaskBudget(profile, cumulative) }
}

export function prepareForestCandidateDiagnostics(candidate: MixedCandidate, signal?: CancellationSignal): MixedCandidate {
  const observed = inspect(candidate.project.document, candidate.profile, candidate.usage, signal)
  return { ...candidate, ...observed }
}

/** The host chooses one actual generated room. All placement, ownership,
 * manual-edit, lock, resource and transaction checks belong to the existing
 * local-generation path; model text cannot select a weaker strategy. */
export async function prepareForestFurnitureRepair(base: EditableProject, roomId: string, options: {
  runtime: PreparationContext; validation: CompleteValidationOptions
  profile: TaskBudgetProfile; signal?: CancellationSignal
}) {
  const generation = getLegacyGeneration(base.document)
  const owners = Object.values(generation?.ownership ?? {}).filter(owner => owner.target.kind === 'room' && owner.target.entityId === roomId)
  if (owners.length !== 1 || !generation) throw new Error('指定房间没有唯一的真实生成归属。')
  const recipeId = generation.rules[owners[0].ruleId]?.recipeRef.id
  const recipe = recipeId && generation.recipes[recipeId]
  if (!recipe || !('domain' in recipe) || recipe.domain !== 'interior') throw new Error('指定房间不属于可修正的室内生成配方。')
  const local = await prepareLocalGenerationProject(base, { version: 1, operation: 'interior-furniture', recipeId, roomId,
    variation: 'forest-repair-seating-v1', strategy: 'seating-v1' }, { ...options, budget: options.profile })
  return { ...local, ...inspect(local.project.document, options.profile, local.usage, options.signal) }
}

/** Keep original domain receipts as provenance. The repaired project/report
 * and its digest are separately bound to the exact local transaction. */
export async function prepareMixedForestFurnitureRepair(parent: MixedCandidate, roomId: string, options: {
  runtime: PreparationContext; validation: CompleteValidationOptions; signal?: CancellationSignal
}): Promise<MixedCandidate> {
  const local = await prepareForestFurnitureRepair(parent.project, roomId, { ...options, profile: parent.profile })
  const diagnostics = local.furnitureDiagnostics
  const cumulative = combineForestCandidateUsage(parent.usage, local.usage)
  const usage = assertTaskBudget(parent.profile, cumulative)
  const items = { ...parent.cost.items, ...Object.fromEntries(local.writeIds.map(id => [id, 1])) }
  return { ...parent, project: local.project, furnitureDiagnostics: diagnostics, usage, cost: { items, total: Object.keys(items).length, limit: parent.cost.limit },
    report: { ...parent.report, propIds: Object.keys(local.project.document.props).sort(), notes: forestFurnitureNotes(diagnostics, parent.report.notes) },
    resultHash: hashGenerationValue({ parentResultHash: parent.resultHash, localResultHash: local.result.resultHash, diagnostics }) }
}
