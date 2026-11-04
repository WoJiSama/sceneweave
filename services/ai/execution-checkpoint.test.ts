import { describe, expect, it } from 'vitest'
import { emptyBudgetUsage } from '../../src/shared/budget/task-budget.js'
import { recordAuthoringExecution, type ExecutionCheckpointInput } from './execution-checkpoint.js'

const initial = (schemaVersion: 2 | 3 | 4 = 2): ExecutionCheckpointInput => ({ ...(schemaVersion === 3 || schemaVersion === 4 ? { schemaVersion, workUsage: emptyBudgetUsage() } : { schemaVersion: 2 as const }), flowId: 'flow', taskId: 'task', generation: 1,
  policyHash: 'a'.repeat(64), sourceHash: 'b'.repeat(64), ledgerHeadHash: 'c'.repeat(64), budgetStateHash: 'd'.repeat(64),
  activeRuntimeMs: 32, initializationMs: 32, modelRequests: 0, completedRequests: 0, toolAttempts: 0, outputBytes: 0 })

describe('server-owned classified execution checkpoint', () => {
  it('hashes independent v3 work and rejects refunds without changing the successful scene ledger', () => {
    const first = recordAuthoringExecution({ ...initial(3), schemaVersion: 3, workUsage: { ...emptyBudgetUsage(), fieldEvaluations: 20, candidateAttempts: 1 } })
    const next = recordAuthoringExecution({ ...initial(3), schemaVersion: 3, workUsage: { ...emptyBudgetUsage(), fieldEvaluations: 40, candidateAttempts: 2 } }, first)
    expect(next.ledgerHeadHash).toBe(first.ledgerHeadHash); expect(next.budgetStateHash).toBe(first.budgetStateHash)
    expect(next.checkpointHash).not.toBe(first.checkpointHash)
    expect(() => recordAuthoringExecution({ ...initial(3), schemaVersion: 3, workUsage: { ...emptyBudgetUsage(), fieldEvaluations: 39, candidateAttempts: 2 } }, next)).toThrow('work cannot be reset')
  })
  it.each([2, 3, 4] as const)('preserves v%s consumption across generations and binds ledger identity independently from scene content', schemaVersion => {
    const first = recordAuthoringExecution(initial(schemaVersion))
    const next = recordAuthoringExecution({ ...initial(schemaVersion), generation: 2, activeRuntimeMs: 90, modelRequests: 1,
      completedRequests: 1, toolAttempts: 2, outputBytes: 100, ledgerHeadHash: 'e'.repeat(64) }, first)
    expect(next.activeRuntimeMs).toBe(90)
    expect(next.checkpointHash).not.toBe(first.checkpointHash)
    expect(next.sourceHash).toBe(first.sourceHash)
  })
  it.each([2, 3, 4] as const)('rejects v%s reset counters, changed source, forged checkpoint and incomplete-request refunds', schemaVersion => {
    const input = { ...initial(schemaVersion), activeRuntimeMs: 90, modelRequests: 2, completedRequests: 1, toolAttempts: 3, outputBytes: 120 }
    const first = recordAuthoringExecution(input)
    for (const key of ['activeRuntimeMs', 'modelRequests', 'completedRequests', 'toolAttempts', 'outputBytes'] as const) {
      expect(() => recordAuthoringExecution({ ...input, generation: 2, [key]: input[key] - 1 }, first)).toThrow()
    }
    expect(() => recordAuthoringExecution({ ...initial(schemaVersion === 2 ? 3 : 2), activeRuntimeMs: 90, modelRequests: 2, completedRequests: 1, toolAttempts: 3, outputBytes: 120 }, first)).toThrow('identity changed')
    expect(() => recordAuthoringExecution({ ...input, sourceHash: 'f'.repeat(64) }, first)).toThrow()
    expect(() => recordAuthoringExecution(input, { ...first, toolAttempts: 2 })).toThrow()
    expect(() => recordAuthoringExecution({ ...initial(), completedRequests: 1 })).toThrow()
    const uncertain = recordAuthoringExecution({ ...input, uncertain: true }, first)
    expect(uncertain.uncertain).toBe(true)
    expect(() => recordAuthoringExecution({ ...input, uncertain: false }, uncertain)).toThrow()
  })
})
