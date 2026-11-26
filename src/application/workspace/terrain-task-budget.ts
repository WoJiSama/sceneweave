import type { SceneDocument } from '../../shared/model/scene.js'
import { getLegacyGeneration } from '../../shared/terrain-generation/composition-contracts.js'
import { isCoastalAscentVersion, supportsProfiledTerrainEdit } from '../../shared/terrain-generation/recipe-capabilities.js'
import { parseTaskBudgetProfile, selectTaskBudget, taskBudgetProfile, type TaskBudgetProfile } from '../../shared/budget/task-budget.js'

/** A new local task selects its own envelope from current persisted geometry.
 * Reopening never re-generates from seed or mutates the stored recipe. */
export function selectTerrainEditBudget(document: SceneDocument, requested?: TaskBudgetProfile): TaskBudgetProfile | undefined {
  const recipes = Object.values(getLegacyGeneration(document)?.recipes ?? {})
  const current = recipes.some(recipe => supportsProfiledTerrainEdit(recipe)
    || recipe.algorithmId === 'terrain-compose' && recipe.algorithmVersion === 1 && [4, 5].includes(recipe.recipeVersion))
  if (!current) {
    if (requested) throw new Error('旧地形工程仍按原256事务预算执行；不能在旧任务中隐式换档。')
    return undefined
  }
  if (requested) return parseTaskBudgetProfile(requested)
  const selected = selectTaskBudget({ task: 'local-edit', widthMm: document.exportBoundsMm.width,
    heightMm: document.exportBoundsMm.height, quality: 'standard', device: 'standard' })
  const needsStandard = recipes.some(recipe => [5, 8, 9].includes(recipe.recipeVersion) || isCoastalAscentVersion(recipe.recipeVersion))
  return selected.profileId === 'small' && needsStandard ? taskBudgetProfile('standard') : selected
}
