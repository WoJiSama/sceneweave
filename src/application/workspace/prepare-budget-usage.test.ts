import { describe, expect, it } from 'vitest'
import { measureCommandBudget } from '../../shared/budget/command-budget.js'
import { BUDGET_DIMENSIONS, emptyBudgetUsage } from '../../shared/budget/task-budget.js'
import { cloneJson } from '../../shared/validation/json.js'
import { combineManualPreparationUsage } from './prepare.js'
import { fixture } from './test-fixtures.js'

describe('manual preparation measurement reuse', () => {
  it('preserves every admission dimension, including implicit building geometry and repeated work', () => {
    const before = fixture({ image: true, building: true }).project, after = cloneJson(before)
    after.document.vertices['vertex-0'].xMm += 100
    after.historyIdentity.lineageId = 'changed-metadata'
    const metadata = { before, after }, base = measureCommandBudget(before.document, after.document, metadata)
    for (const repeated of [0, 1, 7]) {
      const work = emptyBudgetUsage(), observed = emptyBudgetUsage()
      for (const key of ['geometryPoints', 'geometrySegments', 'curveSegments', 'intersectionPairs'] as const) work[key] = base[key] * repeated
      for (const key of BUDGET_DIMENSIONS) observed[key] = 3
      const execution = { ...work, intersectionPairs: Math.max(0, work.intersectionPairs - base.intersectionPairs) }
      for (const key of BUDGET_DIMENSIONS) execution[key] += observed[key]
      expect(combineManualPreparationUsage(base, work, observed)).toEqual(measureCommandBudget(before.document, after.document, metadata, execution))
    }
  })
})
