import { describe, expect, it } from 'vitest'
import { recordAuthoringExecution, type ExecutionCheckpointInput } from './execution-checkpoint.js'

const initial = (): ExecutionCheckpointInput => ({ schemaVersion: 2, flowId: 'flow', taskId: 'task', generation: 1,
  policyHash: 'a'.repeat(64), sourceHash: 'b'.repeat(64), ledgerHeadHash: 'c'.repeat(64), budgetStateHash: 'd'.repeat(64),
  activeRuntimeMs: 32, initializationMs: 32, modelRequests: 0, completedRequests: 0, toolAttempts: 0, outputBytes: 0 })

describe('server-owned classified execution checkpoint', () => {
  it('preserves consumption across generations and binds ledger identity independently from scene content', () => {
    const first = recordAuthoringExecution(initial())
    const next = recordAuthoringExecution({ ...initial(), generation: 2, activeRuntimeMs: 90, modelRequests: 1,
      completedRequests: 1, toolAttempts: 2, outputBytes: 100, ledgerHeadHash: 'e'.repeat(64) }, first)
    expect(next.activeRuntimeMs).toBe(90)
    expect(next.checkpointHash).not.toBe(first.checkpointHash)
    expect(next.sourceHash).toBe(first.sourceHash)
  })
  it('rejects reset counters, changed source, forged checkpoint and incomplete-request refunds', () => {
    const input = { ...initial(), activeRuntimeMs: 90, modelRequests: 2, completedRequests: 1, toolAttempts: 3, outputBytes: 120 }
    const first = recordAuthoringExecution(input)
    for (const key of ['activeRuntimeMs', 'modelRequests', 'completedRequests', 'toolAttempts', 'outputBytes'] as const) {
      expect(() => recordAuthoringExecution({ ...input, generation: 2, [key]: input[key] - 1 }, first)).toThrow()
    }
    expect(() => recordAuthoringExecution({ ...input, sourceHash: 'f'.repeat(64) }, first)).toThrow()
    expect(() => recordAuthoringExecution(input, { ...first, toolAttempts: 2 })).toThrow()
    expect(() => recordAuthoringExecution({ ...initial(), completedRequests: 1 })).toThrow()
    const uncertain = recordAuthoringExecution({ ...input, uncertain: true }, first)
    expect(uncertain.uncertain).toBe(true)
    expect(() => recordAuthoringExecution({ ...input, uncertain: false }, uncertain)).toThrow()
  })
})
