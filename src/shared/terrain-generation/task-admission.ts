import type { SceneDocument } from '../model/scene.js'
import { assertTaskBudget, measureTaskBudget, parseTaskBudgetProfile, taskSemanticTargets,
  type BudgetUsage, type ExecutionBudget, type TaskBudgetProfile } from '../budget/task-budget.js'
export interface TerrainTaskBudgetOptions { budget?: TaskBudgetProfile; meter?: ExecutionBudget }
export const captureTerrainTaskBudget = (options?: TerrainTaskBudgetOptions): TaskBudgetProfile | undefined => options?.budget ? parseTaskBudgetProfile(options.budget) : undefined
export const terrainSemanticCost = (before: SceneDocument, after: SceneDocument, budget: TaskBudgetProfile) => {
  const targets = taskSemanticTargets(before, after)
  const items = targets.length ? Object.fromEntries(targets.map(target => [target, 1])) : { noOp: 1 }
  return { items, total: Math.max(1, targets.length), limit: budget.semanticTargets }
}
/** Scene-only admission. Complete appearance/identity/asset bytes are checked
 * again by the full project owner; actual work is supplied by the executor. */
export function terrainTaskUsage(before: SceneDocument, after: SceneDocument, options: TerrainTaskBudgetOptions): BudgetUsage {
  const budget = captureTerrainTaskBudget(options)
  if (!budget) throw new Error('独立地形预算缺少冻结档位。')
  const usage = { ...measureTaskBudget(before, after) }, work = options.meter?.snapshot()
  if (work) for (const key of ['gridNodes','fieldEvaluations','intersectionPairs','dependencyRefs','candidateAttempts','activeExecutionMs'] as const) usage[key] += work[key]
  return assertTaskBudget(budget, usage)
}
