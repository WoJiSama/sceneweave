import { BUDGET_DIMENSIONS, type BudgetUsage } from '../budget/task-budget.js'

/** Retained project/resource dimensions describe the same candidate closure.
 * Actual search and execution work is additional on every correction. */
export function combineForestCandidateUsage(parent: BudgetUsage, correction: BudgetUsage): BudgetUsage {
  const result = { ...parent }
  for (const key of BUDGET_DIMENSIONS) result[key] = ['gridNodes', 'fieldEvaluations', 'intersectionPairs', 'candidateAttempts', 'activeExecutionMs'].includes(key)
    ? parent[key] + correction[key] : Math.max(parent[key], correction[key])
  return result
}
