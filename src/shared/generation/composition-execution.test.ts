import { describe, expect, it } from 'vitest'
import { createShoreBlankDocument } from '../../platform/browser/content/shore-blank.js'
import { BUDGET_DIMENSIONS, emptyBudgetUsage, measureTaskBudget, taskBudgetProfile, type BudgetUsage } from '../budget/task-budget.js'
import { cloneJson, canonicalJson } from '../validation/json.js'
import type { SceneDocument } from '../model/scene.js'
import { domainGenerationCandidateSchema, freezeArtifact, generationCandidateSchema, hashGenerationValue, type GenerationCandidate } from './contracts.js'
import { GenerationCompositionExecution } from './composition-execution.js'

const source = () => createShoreBlankDocument('island', { sceneId: 'composition', title: '组合', now: '2026-11-09T00:00:00.000Z', widthMm: 24000, heightMm: 18000, preset: 'narrative' })
const options = { profile: taskBudgetProfile('small'), nowMilliseconds: () => 0 }
function candidate(document: SceneDocument, id: string, usage: Partial<BudgetUsage> = {}): GenerationCandidate {
  const hash = hashGenerationValue(document)
  const artifact = freezeArtifact({ id, owner: 'structure', kind: 'diagnostic', payload: { code: id, message: id, artifactIds: [], hard: false } })
  return { status: 'prepared', materializationRequired: true, requestHash: hashGenerationValue(id), sourceHash: hash,
    document: cloneJson(document), documentHash: hash, outputs: [artifact], outputHash: hashGenerationValue([[artifact.kind, artifact.id, artifact.contentHash]]), diagnostics: [],
    usage: { ...emptyBudgetUsage(), candidateAttempts: 1, ...usage }, stages: [{ stepId: 'stage', operator: { id, version: 1 }, beforeHash: hash, afterHash: hash, inputHash: hashGenerationValue([]), outputHash: hashGenerationValue([[artifact.id, artifact.contentHash]]) }] }
}
function mutableCandidate(document: SceneDocument, id: string) {
  const value = candidate(document, id)
  return { ...value, document: cloneJson(value.document) as SceneDocument, stages: value.stages.map(stage => ({ ...stage })) }
}

describe('shared serial composition execution', () => {
  it('preserves ordered receipts and cumulative accounting of the mixed@1 composition contract', () => {
    const base = source(), before = canonicalJson(base), execution = new GenerationCompositionExecution(base, options)
    const first = candidate(base, 'first', { gridNodes: 10, candidateAttempts: 2 }), second = candidate(base, 'second', { gridNodes: 12 })
    execution.run('outdoor', () => ({ candidate: first }))
    execution.run('building', () => ({ candidate: second }))
    const actual = execution.publish('a'.repeat(64))
    // Independent accounting in the preceding mixed@1 implementation: one
    // published candidate, cumulative work, then the full scene lower bound.
    const usage = emptyBudgetUsage(); usage.candidateAttempts = 1
    for (const row of [first, second]) for (const key of BUDGET_DIMENSIONS) usage[key] += key === 'candidateAttempts' ? Math.max(0, row.usage[key] - 1) : row.usage[key]
    const full = measureTaskBudget(base, base)
    for (const key of BUDGET_DIMENSIONS) usage[key] = Math.max(usage[key], full[key])
    expect(actual.usage).toEqual(usage)
    expect(actual.stages).toEqual([...first.stages.map(stage => ({ ...stage, stepId: `outdoor:${stage.stepId}` })), ...second.stages.map(stage => ({ ...stage, stepId: `building:${stage.stepId}` }))])
    expect(actual.sourceHash).toBe(first.sourceHash); expect(actual.documentHash).toBe(second.documentHash)
    expect(Object.isFrozen(actual.document)).toBe(true)
    expect(canonicalJson(base)).toBe(before)
    expect(() => execution.publish('a'.repeat(64))).toThrow(/重复发布/)
  })

  it.each(['source', 'document', 'stage-start', 'stage-end', 'stage-gap', 'output'] as const)('rejects broken %s hashes before any publication', kind => {
    const base = source(), execution = new GenerationCompositionExecution(base, options), result = mutableCandidate(base, 'changed')
    if (kind === 'source') result.sourceHash = '0'.repeat(64)
    if (kind === 'document') (result.document as SceneDocument).title = 'hidden change'
    if (kind === 'stage-start') result.stages[0].beforeHash = '0'.repeat(64)
    if (kind === 'stage-end') result.stages[0].afterHash = '0'.repeat(64)
    if (kind === 'stage-gap') result.stages.push({ ...result.stages[0], stepId: 'gap', beforeHash: '0'.repeat(64) })
    if (kind === 'output') result.outputHash = '0'.repeat(64)
    expect(() => execution.run('broken', () => ({ candidate: result }))).toThrow(/摘要|阶段链/)
    expect(() => execution.publish('a'.repeat(64))).toThrow(/部分执行/)
  })

  it('rejects duplicate output identity across separate domain modules', () => {
    const base = source(), execution = new GenerationCompositionExecution(base, options)
    execution.run('one', current => ({ candidate: candidate(current, 'same-output') }))
    expect(() => execution.run('two', current => ({ candidate: candidate(current, 'same-output') }))).toThrow(/输出事实身份冲突/)
    expect(() => execution.publish('a'.repeat(64))).toThrow(/部分执行/)
  })

  it('rejects colliding composed stage identities even when module names are distinct', () => {
    const base = source(), execution = new GenerationCompositionExecution(base, options)
    execution.run('outer:inner', current => ({ candidate: candidate(current, 'one') }))
    const result = mutableCandidate(base, 'two'); result.stages[0].stepId = 'inner:stage'
    expect(() => execution.run('outer', () => ({ candidate: result }))).toThrow(/身份重复/)
    expect(() => execution.publish('a'.repeat(64))).toThrow(/部分执行/)
  })

  it.each(['candidate-field', 'stage-field', 'artifact-field', 'hard-diagnostic', 'hard-artifact'] as const)('rejects a self-consistent %s contract violation before publication', kind => {
    const base = source(), execution = new GenerationCompositionExecution(base, options), result = mutableCandidate(base, 'contract')
    if (kind === 'candidate-field') Object.assign(result, { unknown: true })
    if (kind === 'stage-field') Object.assign(result.stages[0], { unknown: true })
    if (kind === 'artifact-field') {
      const { contentHash: _hash, ...body } = result.outputs[0]
      const altered = { ...body, unknown: true }
      result.outputs = [{ ...altered, contentHash: hashGenerationValue(altered) }]
    }
    if (kind === 'hard-diagnostic') result.diagnostics = [{ code: 'unmet', message: 'Unmet hard requirement', artifactIds: [], hard: true }]
    if (kind === 'hard-artifact') result.outputs = [freezeArtifact({ id: 'unmet', kind: 'diagnostic', owner: 'structure', payload: { code: 'unmet', message: 'Unmet hard requirement', artifactIds: [], hard: true } })]
    result.outputHash = hashGenerationValue(result.outputs.map(row => [row.kind, row.id, row.contentHash]))
    expect(() => execution.run('invalid', () => ({ candidate: result }))).toThrow(/信封|产物合同|硬约束/)
    expect(execution.document).toEqual(base)
    expect(() => execution.publish('a'.repeat(64))).toThrow(/部分执行/)
  })

  it('keeps internal composition envelopes independent from transport collection and step limits', () => {
    const original = candidate(source(), 'internal')
    const larger = { ...original, outputs: Array.from({ length: 8193 }, () => original.outputs[0]),
      stages: Array.from({ length: 65 }, (_, index) => ({ ...original.stages[0], stepId: `${'module:'.repeat(40)}${index}` })) }
    expect(generationCandidateSchema.safeParse(larger).success).toBe(true)
    expect(domainGenerationCandidateSchema.safeParse(larger).success).toBe(false)
  })

  it('charges cumulative work even when each module fits its independent budget', () => {
    const base = source(), execution = new GenerationCompositionExecution(base, options), cost = Math.floor(options.profile.limits.gridNodes * 0.6)
    execution.run('one', current => ({ candidate: candidate(current, 'one', { gridNodes: cost }) }))
    expect(() => execution.run('two', current => ({ candidate: candidate(current, 'two', { gridNodes: cost }) }))).toThrow(/预算超限/)
    expect(() => execution.publish('a'.repeat(64))).toThrow(/部分执行/)
  })

  it('captures mutable runner results and refuses cancellation at final publication', () => {
    const base = source(), signal = { aborted: false }, execution = new GenerationCompositionExecution(base, { ...options, signal }), result = mutableCandidate(base, 'one')
    execution.run('one', () => ({ candidate: result }))
    result.document.title = 'mutated after return'
    expect(execution.document.title).toBe(base.title)
    signal.aborted = true
    expect(() => execution.publish('a'.repeat(64))).toThrow(/取消/)
  })

  it('rejects a self-consistent invalid intermediate scene before exposing it to the next runner', () => {
    const base = source(), execution = new GenerationCompositionExecution(base, options), result = mutableCandidate(base, 'invalid')
    result.document.rooms.dangling = { id: 'dangling', floorId: 'visual-floor', editLocked: false, visibility: 'public', accessExpectation: 'unspecified',
      boundaryVertexIds: ['absent-a', 'absent-b', 'absent-c'], purpose: '', supportRef: { kind: 'floor', id: 'visual-floor' }, groundElevationMm: 0, floorStyle: null }
    result.documentHash = hashGenerationValue(result.document); result.stages[0].afterHash = result.documentHash
    expect(() => execution.run('invalid', () => ({ candidate: result }))).toThrow(/严格有效/)
    expect(execution.document).toEqual(base)
    expect(() => execution.run('repair', current => ({ candidate: candidate(current, 'repair') }))).toThrow(/关闭后/)
  })

  it('does not invoke a later runner after cancellation', () => {
    const base = source(), signal = { aborted: false }, execution = new GenerationCompositionExecution(base, { ...options, signal })
    execution.run('one', current => ({ candidate: candidate(current, 'one') }))
    signal.aborted = true
    let invoked = false
    expect(() => execution.run('two', current => { invoked = true; return { candidate: candidate(current, 'two') } })).toThrow(/取消/)
    expect(invoked).toBe(false)
  })

  it('enforces one monotonic clock and an aggregate duration across modules', () => {
    const base = source(); let time = 0
    const execution = new GenerationCompositionExecution(base, { ...options, nowMilliseconds: () => time })
    time = 180000; execution.run('one', current => ({ candidate: candidate(current, 'one') }))
    time = 300001
    expect(() => execution.run('two', current => ({ candidate: candidate(current, 'two') }))).toThrow(/时间超限/)
    let backwards = 10
    const another = new GenerationCompositionExecution(base, { ...options, nowMilliseconds: () => backwards })
    backwards = 9
    expect(() => another.run('one', current => ({ candidate: candidate(current, 'one') }))).toThrow(/单调/)
  })
})
