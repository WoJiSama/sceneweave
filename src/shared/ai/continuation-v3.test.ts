import { describe, expect, it } from 'vitest'
import { continuationFixtureV3 } from '../../../tests/helpers/continuation-v3-fixture.js'
import { TASK_BUDGET_PROFILES, BUDGET_DIMENSIONS, emptyBudgetUsage, withExecutionWorkObserver } from '../budget/task-budget.js'
import { terrainEditRequestSchema } from '../terrain-generation/edit.js'
import { cloneJson } from '../validation/json.js'
import { CONTINUATION_POLICY, BudgetPolicySchema, BudgetPolicyV2Schema, createContinuationPolicyV2, accumulateContinuationUsage } from './budget-policy.js'
import { applyAuthoringStep, authoringDraftStamp, authoringSummary, checkAuthoringDraft, publicAuthoringContext, replayAuthoring, validateAuthoringStart } from './authoring.js'
import { AuthoringStartSchema, DraftStampSchema } from './authoring-protocol.js'
import { captureBaseMapSourceV3 } from './continuation-v3.js'

describe('authoring3 registered independent budgets', () => {
  it('freezes registered profiles and preserves policy1 exact meaning', () => {
    const profiles = Object.values(TASK_BUDGET_PROFILES).map(createContinuationPolicyV2)
    expect(profiles.map(p => p.aiTargets)).toEqual([512, 1024, 2048])
    expect(new Set(profiles.map(p => p.policyHash)).size).toBe(3)
    for (const policy of profiles) {
      expect(policy).toMatchObject({ policyVersion: 2, countingVersion: 2, modelRequests: 16, toolCalls: 64, activeExecutionMs: 300000 })
      expect(() => BudgetPolicyV2Schema.parse({ ...policy, aiTargets: policy.aiTargets + 1 })).toThrow()
      expect(() => BudgetPolicySchema.parse(policy)).toThrow()
    }
    expect(BudgetPolicySchema.parse(CONTINUATION_POLICY)).toEqual(CONTINUATION_POLICY)
  })
  it('admits retained closures at their peak and accumulates actual work dimensions independently', () => {
    const a = { ...emptyBudgetUsage(), assetBytes: 1024, geometryPoints: 500, gridNodes: 100, semanticTargets: 2 }
    const b = { ...emptyBudgetUsage(), assetBytes: 1024, geometryPoints: 400, gridNodes: 20, semanticTargets: 1 }
    expect(accumulateContinuationUsage(a, b)).toMatchObject({ assetBytes: 1024, geometryPoints: 500, gridNodes: 120, semanticTargets: 3 })
  })
  it('replays full source3, records real declared resource closure, and binds every budget dimension', () => {
    const start = continuationFixtureV3(), initial = replayAuthoring(start, [])
    expect(AuthoringStartSchema.parse(start).schemaVersion).toBe(3)
    expect(initial.state.budget.usage.assetBytes).toBe(Object.values(start.project.assets).reduce((sum, row) => sum + row.sizeBytes, 0))
    expect(initial.state.budget.usage.gridNodes).toBeGreaterThan(0)
    expect(initial.state.ledger[0].usage).toEqual(initial.state.budget.usage)
    expect(authoringSummary(start, initial.state, null)).toMatchObject({ schemaVersion: 3, budget: initial.state.budget })
    expect(DraftStampSchema.parse(authoringDraftStamp(initial.state, 1))).toMatchObject({ schemaVersion: 3, policyHash: start.policy.policyHash })
    for (const dimension of BUDGET_DIMENSIONS) {
      const forged = cloneJson(initial.state); forged.budget.usage[dimension]++
      expect(() => checkAuthoringDraft(start, forged)).toThrow()
    }
  }, 120000)
  it('supports independent AI edits with immutable generation usage, strict version dispatch and idempotence', () => {
    const start = continuationFixtureV3(), id = Object.keys(start.project.document.terrainAreas)[0]
    const initial = replayAuthoring(start, [])
    const operation = { kind: 'terrainUpdate' as const, id, blocksSight: !start.project.document.terrainAreas[id].blocksSight }
    const next = applyAuthoringStep(start, initial.state, [operation], 'area-edit')
    expect(next.state.ledger[1]).toMatchObject({ semanticCost: 1, targets: [`terrainArea:${id}`] })
    expect(next.state.budget.aiCost).toBe(1)
    expect(next.state.budget.generationCost).toBe(initial.state.budget.generationCost)
    expect(next.state.ledger[0]).toEqual(initial.state.ledger[0])
    expect(applyAuthoringStep(start, next.state, [operation], 'area-edit')).toEqual(next)
    expect(publicAuthoringContext(start, next.state)).toMatchObject({ remainingOperations: 511 })
    expect(() => AuthoringStartSchema.parse({ ...start, schemaVersion: 2 })).toThrow()
    expect(() => validateAuthoringStart({ ...start, policy: createContinuationPolicyV2(TASK_BUDGET_PROFILES.standard) })).toThrow()
    const source = cloneJson(start.source); source.request.profileHash = 'f'.repeat(64)
    expect(() => captureBaseMapSourceV3(source)).toThrow()
  }, 120000)
  it('accepts 257 repeated semantic edits under the frozen 512 profile without resetting generation or resource admission', () => {
    const start = continuationFixtureV3(), id = start.scope.targetIds[0]
    expect(id).toBeTruthy()
    const operations = Array.from({ length: 257 }, () => ({ kind: 'opacity' as const, id, value: 1 }))
    const steps = Array.from({ length: Math.ceil(operations.length / 16) }, (_, i) => ({ index: i + 1, stepId: `semantic-${i}`, operations: operations.slice(i * 16, (i + 1) * 16) }))
    const edited = replayAuthoring(start, steps)
    expect(edited.state.budget.aiCost).toBe(257)
    expect(edited.state.ledger).toHaveLength(258)
    expect(edited.state.budget.usage.assetBytes).toBe(edited.state.ledger[0].usage.assetBytes)
    expect(edited.state.budget.usage.semanticTargets).toBe(edited.state.budget.generationCost + 257)
  }, 120000)

  it('edits a real algorithm4 source through terrainEdit and observes actual verification work even on rejection', () => {
    const start = continuationFixtureV3(), scene = start.project.document, prop = Object.values(scene.props)[0]
    start.scope.scene!.operations.push('terrainEdit')
    const request = terrainEditRequestSchema.parse({ kind: 'brush', sceneId: scene.sceneId, operationId: 'profiled-clear', floorId: 'visual-floor', scopeMm: scene.exportBoundsMm,
      linkMode: 'scenery', mode: 'clearArea', targetAreaId: prop.supportRef.kind === 'terrainArea' ? prop.supportRef.id : 'terrain-low', materialRef: null, elevationMm: null,
      strokes: [{ pointsMm: [prop.positionMm], radiusMm: 300 }] })
    const initial = replayAuthoring(start, []), work: {gridNodes?:number;candidateAttempts?:number}[] = []
    const next = withExecutionWorkObserver(delta => work.push(delta), () => applyAuthoringStep(start, initial.state, [{ kind: 'terrainEdit', request }], 'clear-v4'))
    expect(Object.keys(next.project.document.props).length).toBeLessThan(Object.keys(scene.props).length)
    expect(next.state.ledger[1].usage.candidateAttempts).toBe(1)
    expect(work.reduce((sum, row) => sum + (row.gridNodes ?? 0), 0)).toBeGreaterThan(0)
    const rejected: {gridNodes?:number}[] = []
    expect(() => withExecutionWorkObserver(delta => rejected.push(delta), () => applyAuthoringStep(start, initial.state,
      [{ kind: 'terrainEdit', request: { ...request, sceneId: 'wrong-scene' } }], 'rejected-v4'))).toThrow()
    expect(rejected.reduce((sum, row) => sum + (row.gridNodes ?? 0), 0)).toBeGreaterThan(0)
  }, 120000)
  it('refreshes a real recipe4 composition through the profiled terrainLocal path', () => {
    const start = continuationFixtureV3('small', 'composition')
    start.scope.scene!.operations.push('terrainLocal')
    const initial = replayAuthoring(start, [])
    const next = applyAuthoringStep(start, initial.state, [{ kind: 'terrainLocal', request: { sceneId: start.project.document.sceneId, scopeMm: start.project.document.exportBoundsMm } }], 'local-v4')
    expect(next.project.schemaVersion).toBe(1)
    expect(next.state.budget.aiCost).toBeGreaterThanOrEqual(1)
    expect(next.state.ledger[1].usage.candidateAttempts).toBe(1)
    expect(next.state.budget.generationCost).toBe(initial.state.budget.generationCost)
  }, 120000)

})
