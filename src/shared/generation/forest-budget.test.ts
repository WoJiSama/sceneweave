import { describe, expect, it } from 'vitest'
import { assertTaskBudget, emptyBudgetUsage, taskBudgetProfile } from '../budget/task-budget.js'
import { combineForestCandidateUsage } from './forest-budget.js'

describe('forest candidate correction budget', () => {
  it('counts the retained dependency/resource closure once while adding every search and execution step', () => {
    const profile = taskBudgetProfile('standard'), first = { ...emptyBudgetUsage(), dependencyRefs: 6000, metadataBytes: 300000,
      gridNodes: 1000, fieldEvaluations: 10000, activeExecutionMs: 100 }
    const correction = { ...emptyBudgetUsage(), dependencyRefs: 6100, metadataBytes: 310000, gridNodes: 2000, fieldEvaluations: 5000, activeExecutionMs: 50 }
    expect(assertTaskBudget(profile, combineForestCandidateUsage(first, correction))).toMatchObject({ dependencyRefs: 6100,
      metadataBytes: 310000, gridNodes: 3000, fieldEvaluations: 15000, activeExecutionMs: 150 })
    expect(() => assertTaskBudget(profile, combineForestCandidateUsage(first, { ...correction, gridNodes: profile.limits.gridNodes }))).toThrow('gridNodes')
  })
})
