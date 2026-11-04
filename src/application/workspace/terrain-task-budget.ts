import type { SceneDocument } from '../../shared/model/scene.js'
import { getLegacyGeneration } from '../../shared/terrain-generation/composition-contracts.js'
import { parseTaskBudgetProfile, selectTaskBudget, taskBudgetProfile, type TaskBudgetProfile } from '../../shared/budget/task-budget.js'

/** A new local task selects its own envelope from current persisted geometry.
 * Reopening never re-generates from seed or mutates the stored recipe. */
export function selectTerrainEditBudget(document: SceneDocument, requested?: TaskBudgetProfile): TaskBudgetProfile | undefined {
  const current = Object.values(getLegacyGeneration(document)?.recipes ?? {}).some(recipe => [4,5].includes(recipe.recipeVersion) && (['terrain-scene', 'terrain-scene-t3'].includes(recipe.algorithmId) && recipe.algorithmVersion === recipe.recipeVersion || recipe.algorithmId === 'terrain-compose' && recipe.algorithmVersion === 1))
  if (!current) {
    if (requested) throw new Error('旧地形工程仍按原256事务预算执行；不能在旧任务中隐式换档。')
    return undefined
  }
  if (requested) return parseTaskBudgetProfile(requested)
  const selected = selectTaskBudget({ task: 'local-edit', widthMm: document.exportBoundsMm.width,
    heightMm: document.exportBoundsMm.height, quality: 'standard', device: 'standard' })
  return selected.profileId === 'small' && Object.values(getLegacyGeneration(document)?.recipes ?? {}).some(recipe => recipe.recipeVersion === 5) ? taskBudgetProfile('standard') : selected
}
