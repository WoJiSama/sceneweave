import { describe, expect, it } from 'vitest'
import { semanticGenerationExample, semanticGenerationRequestHash } from '../generation/semantic-request.js'
import { hashGenerationValue } from '../generation/contracts.js'
import type { ForestFurnitureDiagnostics } from '../generation/forest-furniture-contract.js'
import { beginForestAction, completeForestGeneration, createForestLoop, failForestGeneration, forestLoopContext,
  ForestLoopContextSchema, stopForestLoop, validateForestAction, type ForestLoopState } from './forest-loop.js'

const request = semanticGenerationExample()
const action = (state: ForestLoopState, value = request.parameters.seed) => ({ kind: 'generate', stateHash: forestLoopContext(state).stateHash, seed: value, reason: '根据真实缺项比较一个候选。' })
const receipt = (state: ForestLoopState, candidateId = 'a'.repeat(64), notes = ['座椅找不到合法位置。']) => ({ candidateId,
  requestHash: state.pending!.requestHash, seed: state.pending!.seed, entities: { rooms: request.parameters.roomCount, props: 44 }, notes })
const diagnostics = (counts = [3, 3], structureHash = '1'.repeat(64)): ForestFurnitureDiagnostics => ({ structureHash,
  outcomeHash: hashGenerationValue(counts), deficit: counts.reduce((sum, actual) => sum + Math.max(0, 4 - actual), 0),
  rooms: counts.map((actual, index) => ({ roomId: `room-${index}`, recipeId: 'building-recipe', requirementId: `requirement-${index}`, purpose: request.parameters.purpose,
    repairable: actual < 4, roles: [{ role: 'seat', expected: 4, actual, deficit: Math.max(0, 4 - actual),
      rejections: actual < 4 ? [{ reason: 'seat-group-unavailable', count: 12 }] : [] }], notes: [] })),
})
const diagnosed = (counts = [3, 3]) => {
  const initial = createForestLoop(request), pending = beginForestAction(initial, action(initial))
  return completeForestGeneration(pending, { ...receipt(pending), diagnostics: diagnostics(counts) })
}
const repair = (state: ForestLoopState, roomId = 'room-0') => ({ kind: 'repair-furniture', stateHash: forestLoopContext(state).stateHash,
  candidateId: state.receipts.at(-1)!.candidateId, roomId, reason: '保留建筑并补齐该房间座椅。' })
const repairedReceipt = (state: ForestLoopState, counts = [4, 3], candidateId = 'b'.repeat(64)) => ({ ...receipt(state, candidateId),
  parentCandidateId: state.pending!.kind === 'repair-furniture' ? state.pending!.candidateId : '',
  repairRoomId: state.pending!.kind === 'repair-furniture' ? state.pending!.roomId : '', diagnostics: diagnostics(counts),
  entities: { rooms: request.parameters.roomCount, props: 44 + counts.reduce((sum, actual) => sum + actual - 3, 0) } })
describe('bounded forest host actions', () => {
  it('repairs only a diagnosed current room and charges the shared candidate budget before execution', () => {
    const state = diagnosed(), context = forestLoopContext(state)
    expect(context.nextActions).toEqual(['generate', 'repair-furniture', 'finish'])
    expect(context.repairTargets).toEqual([{ candidateId: state.receipts[0].candidateId, roomId: 'room-0' }, { candidateId: state.receipts[0].candidateId, roomId: 'room-1' }])
    expect(() => beginForestAction(state, { ...repair(state), roomId: 'unknown' })).toThrow(/房间/)
    expect(() => beginForestAction(state, { ...repair(state), seed: 'changed' })).toThrow()
    const pending = beginForestAction(state, repair(state))
    expect(pending).toMatchObject({ decisionsUsed: 2, attemptsUsed: 2, attemptedSeeds: [request.parameters.seed],
      pending: { kind: 'repair-furniture', candidateId: state.receipts[0].candidateId, roomId: 'room-0', seed: request.parameters.seed } })
    const result = completeForestGeneration(pending, repairedReceipt(pending))
    expect(forestLoopContext(result).nextActions).toEqual(['repair-furniture', 'finish'])
    expect(forestLoopContext(result).repairTargets).toEqual([{ candidateId: 'b'.repeat(64), roomId: 'room-1' }])
    const finalPending = beginForestAction(result, repair(result, 'room-1'))
    const final = completeForestGeneration(finalPending, repairedReceipt(finalPending, [4, 4], 'c'.repeat(64)))
    expect(final).toMatchObject({ attemptsUsed: 3, decisionsUsed: 3 })
    expect(final.receipts.map(row => row.diagnostics?.deficit)).toEqual([2, 1, 0])
    expect(forestLoopContext(final).nextActions).toEqual(['finish'])
    const selected = beginForestAction(final, { kind: 'finish', stateHash: forestLoopContext(final).stateHash, candidateId: 'c'.repeat(64), reason: '实际目标数量齐全，外观待审阅。' })
    expect(selected).toMatchObject({ status: 'finished', decisionsUsed: 4 })
  })
  it('rejects repaired receipts that lower furniture goals, alter another room or rebound their parent', () => {
    const state = diagnosed(), pending = beginForestAction(state, repair(state)), real = repairedReceipt(pending)
    expect(() => completeForestGeneration(pending, { ...real, parentCandidateId: 'd'.repeat(64) })).toThrow(/不符/)
    expect(() => completeForestGeneration(pending, { ...real, repairRoomId: 'room-1' })).toThrow(/不符/)
    expect(() => completeForestGeneration(pending, { ...real, diagnostics: diagnostics([4, 4]) })).toThrow(/不一致/)
    expect(() => completeForestGeneration(pending, { ...real, diagnostics: diagnostics([4, 3], '2'.repeat(64)) })).toThrow(/不一致/)
    const lowered = structuredClone(real)
    lowered.diagnostics.rooms[0].roles[0].expected = 3
    lowered.diagnostics.rooms[0].roles[0].actual = 3
    expect(() => completeForestGeneration(pending, lowered)).toThrow()
    const { diagnostics: _diagnostics, ...withoutDiagnostics } = real
    expect(() => completeForestGeneration(pending, withoutDiagnostics)).toThrow(/不符/)
    expect(() => completeForestGeneration(pending, { ...real, entities: { rooms: 2, props: 40 } })).toThrow(/不一致/)
  })
  it('stops repeated seed attempts when structure and measured goal outcome repeat', () => {
    let state = diagnosed()
    state = beginForestAction(state, action(state, 'second-seed'))
    state = completeForestGeneration(state, { ...receipt(state, 'b'.repeat(64), ['Different prose does not prove progress.']), diagnostics: diagnostics() })
    expect(forestLoopContext(state).nextActions).toEqual(['repair-furniture', 'finish'])
    expect(() => beginForestAction(state, action(state, 'third-seed'))).toThrow(/预算/)
    expect(state.receipts).toHaveLength(2)
  })
  it('blocks the same unsuccessful room repair while retaining other useful repair actions and all candidates', () => {
    const state = diagnosed(), pending = beginForestAction(state, repair(state))
    const result = completeForestGeneration(pending, repairedReceipt(pending, [3, 3]))
    expect(forestLoopContext(result).nextActions).toEqual(['repair-furniture', 'finish'])
    expect(forestLoopContext(result).repairTargets).toEqual([{ candidateId: 'b'.repeat(64), roomId: 'room-1' }])
    expect(() => beginForestAction(result, repair(result))).toThrow(/房间/)
    expect(() => beginForestAction(result, { ...repair(result), candidateId: state.receipts[0].candidateId })).toThrow(/房间/)
    expect(result.receipts).toHaveLength(2)
    const oneProblem = diagnosed([3, 4]), ineffective = beginForestAction(oneProblem, repair(oneProblem))
    const final = completeForestGeneration(ineffective, repairedReceipt(ineffective, [3, 4]))
    expect(forestLoopContext(final).nextActions).toEqual(['finish'])
    expect(final.selectedCandidateId).toBeNull()
  })
  it('does not spend the remaining fixed-strategy attempt on a partially improved room twice', () => {
    const initial = diagnosed([2, 3]), pending = beginForestAction(initial, repair(initial))
    const improved = completeForestGeneration(pending, repairedReceipt(pending, [3, 3]))
    expect(improved.receipts.at(-1)!.diagnostics!.deficit).toBeLessThan(initial.receipts[0].diagnostics!.deficit)
    expect(forestLoopContext(improved).repairTargets).toEqual([{ candidateId: 'b'.repeat(64), roomId: 'room-1' }])
    expect(() => beginForestAction(improved, repair(improved))).toThrow(/房间/)
  })
  it('charges repair failure and preserves prior candidates without pretending generation used a new seed', () => {
    const state = diagnosed(), pending = beginForestAction(state, repair(state)), failed = failForestGeneration(pending, '房间家具已被人工修改，拒绝覆盖。')
    expect(failed).toMatchObject({ attemptsUsed: 2, decisionsUsed: 2, attemptedSeeds: [request.parameters.seed],
      failures: [{ parentCandidateId: state.receipts[0].candidateId, repairRoomId: 'room-0', seed: request.parameters.seed }] })
    expect(failed.receipts).toEqual(state.receipts)
    expect(forestLoopContext(failed).repairTargets).toEqual([{ candidateId: state.receipts[0].candidateId, roomId: 'room-1' }])
    expect(forestLoopContext(failed).nextActions).not.toContain('generate')
    expect(() => completeForestGeneration(stopForestLoop(pending, '取消'), repairedReceipt(pending))).toThrow(/不符/)
    expect(forestLoopContext(diagnosed([4, 4])).nextActions).toEqual(['finish'])
  })
  it('starts from fixed requirements, charges before execution and accepts only its real result', () => {
    const initial = createForestLoop(request, undefined, 'test-run')
    expect(forestLoopContext(initial).nextActions).toEqual(['generate'])
    const pending = beginForestAction(initial, action(initial))
    expect(pending).toMatchObject({ status: 'generating', attemptsUsed: 1, decisionsUsed: 1,
      pending: { seed: request.parameters.seed, requestHash: semanticGenerationRequestHash(request) } })
    expect(forestLoopContext(pending).nextActions).toEqual([])
    const result = completeForestGeneration(pending, receipt(pending))
    expect(result.receipts[0].notes).toEqual(['座椅找不到合法位置。'])
    expect(forestLoopContext(result).nextActions).toEqual(['generate', 'finish'])
    expect(Object.isFrozen(result.receipts[0].notes)).toBe(true)
    expect(initial).toMatchObject({ attemptsUsed: 0, receipts: [] })
  })
  it('rejects stale actions, altered requirements, duplicate seeds and unowned candidates', () => {
    const initial = createForestLoop(request), first = beginForestAction(initial, action(initial))
    const result = completeForestGeneration(first, receipt(first))
    expect(() => beginForestAction(initial, action(initial, 'other'))).toThrow(/第一次/)
    expect(() => beginForestAction(result, action(initial))).toThrow(/已变化/)
    expect(() => beginForestAction(result, action(result))).toThrow(/重复/)
    expect(() => beginForestAction(result, { ...action(result, 'next'), furniture: false })).toThrow()
    expect(() => beginForestAction(result, { kind: 'finish', stateHash: forestLoopContext(result).stateHash, candidateId: 'b'.repeat(64), reason: '选择' })).toThrow(/实际完成/)
    expect(() => ForestLoopContextSchema.parse({ ...forestLoopContext(result), request: { ...request, parameters: { ...request.parameters, roomCount: 1 } } })).toThrow()
  })
  it('preserves prior results and consumes failed attempts without replaying them', () => {
    let state = createForestLoop(request)
    state = beginForestAction(state, action(state)); state = completeForestGeneration(state, receipt(state))
    const second = beginForestAction(state, action(state, 'alternate-seed'))
    const failed = failForestGeneration(second, '实际生成器拒绝：通路预算不足。')
    expect(failed).toMatchObject({ status: 'ready', attemptsUsed: 2, decisionsUsed: 2 })
    expect(failed.receipts).toEqual(state.receipts)
    expect(failed.failures[0].message).toContain('实际生成器拒绝')
    expect(() => beginForestAction(failed, action(failed, 'alternate-seed'))).toThrow(/重复/)
    const stopped = stopForestLoop(failed, '模型请求结果未知，停止。')
    expect(forestLoopContext(stopped).nextActions).toEqual([])
    expect(stopped.receipts).toEqual(state.receipts)
  })
  it('rejects wrong result identities, wrong room counts and late results', () => {
    const state = beginForestAction(createForestLoop(request), action(createForestLoop(request)))
    expect(() => completeForestGeneration(state, { ...receipt(state), requestHash: '0'.repeat(64) })).toThrow(/不符/)
    expect(() => completeForestGeneration(state, { ...receipt(state), seed: 'another' })).toThrow(/不符/)
    expect(() => completeForestGeneration(state, { ...receipt(state), entities: { rooms: 1, props: 10 } })).toThrow(/不符/)
    expect(() => completeForestGeneration(stopForestLoop(state, '取消'), receipt(state))).toThrow(/不符/)
  })
  it('exhausts generation budget while leaving an explicit real candidate selection', () => {
    let state = createForestLoop(request)
    for (let index = 0; index < 3; index++) {
      state = beginForestAction(state, action(state, index ? `alternate-${index}` : request.parameters.seed))
      state = completeForestGeneration(state, receipt(state, String(index + 1).repeat(64), index ? [] : ['座椅缺项']))
    }
    expect(forestLoopContext(state).nextActions).toEqual(['finish'])
    expect(() => beginForestAction(state, action(state, 'fourth'))).toThrow(/预算/)
    const selected = beginForestAction(state, { kind: 'finish', stateHash: forestLoopContext(state).stateHash,
      candidateId: state.receipts[1].candidateId, reason: '实际报告没有座椅缺项，视觉仍待审阅。' })
    expect(selected).toMatchObject({ status: 'finished', selectedCandidateId: state.receipts[1].candidateId, decisionsUsed: 4 })
    expect(forestLoopContext(selected).nextActions).toEqual([])
  })
  it('does not silently select a result when decision budget is exhausted', () => {
    let state = createForestLoop(request, { maxCandidates: 1, maxDecisions: 1 })
    state = beginForestAction(state, action(state)); state = completeForestGeneration(state, receipt(state))
    expect(state).toMatchObject({ status: 'stopped', selectedCandidateId: null })
    expect(state.receipts).toHaveLength(1)
    expect(() => createForestLoop(request, { maxCandidates: 4, maxDecisions: 5 })).toThrow()
  })
  it('captures owned plain JSON before reading context or action accessors', () => {
    let reads = 0
    const state = createForestLoop(request), context = forestLoopContext(state)
    const invalid = { ...action(state), get reason() { reads++; return 'forged' } }
    expect(() => validateForestAction(context, invalid)).toThrow()
    expect(reads).toBe(0)
  })
  it('rejects duplicate or rebound outcomes even when a caller recomputes the context hash', () => {
    const initial = createForestLoop(request), first = beginForestAction(initial, action(initial))
    let result = completeForestGeneration(first, receipt(first))
    const second = beginForestAction(result, action(result, 'next'))
    result = failForestGeneration(second, '实际失败')
    const assertInvalid = (state: Record<string, unknown>) => {
      const body = { ...state, nextActions: ['generate', 'finish'] }
      expect(ForestLoopContextSchema.safeParse({ ...body, stateHash: hashGenerationValue(body) }).success).toBe(false)
    }
    assertInvalid({ ...result, decisionsUsed: 1 })
    assertInvalid({ ...result, attemptedSeeds: ['wrong-first', 'next'] })
    assertInvalid({ ...result, failures: [{ ...result.failures[0], requestHash: '0'.repeat(64) }] })
    assertInvalid({ ...result, failures: [{ ...result.failures[0], seed: request.parameters.seed, requestHash: semanticGenerationRequestHash(request) }] })
    assertInvalid({ ...second, pending: { ...second.pending, requestHash: '0'.repeat(64) } })
    assertInvalid({ ...result, failures: [], receipts: [result.receipts[0], { ...result.receipts[0], seed: 'next', requestHash: second.pending!.requestHash }] })
  })
})
