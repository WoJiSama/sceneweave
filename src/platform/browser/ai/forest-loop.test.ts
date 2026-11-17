import { describe, expect, it, vi } from 'vitest'
import { runForestWorkflow, type ForestLoopCandidate } from './forest-loop.js'
import { AiClientError } from './client.js'
import { semanticGenerationExample, semanticGenerationRequestHash, type SemanticGenerationRequest } from '../../../shared/generation/semantic-request.js'
import type { ConnectionInfo, CreateTaskRequest, TaskSnapshot } from '../../../shared/ai/protocol.js'
import type { ForestAction, ForestLoopContext } from '../../../shared/ai/forest-loop.js'

function snapshot(request: CreateTaskRequest, action: ForestAction, overrides: Partial<TaskSnapshot> = {}): TaskSnapshot {
  return { schemaVersion: 1, id: crypto.randomUUID(), clientRequestId: request.clientRequestId, context: null, status: 'completed',
    generation: 1, lastSequence: 3, text: '', tools: [{ callId: 'one-action', name: 'sceneweave_forest_action', success: true,
      output: JSON.stringify({ acceptedForHost: true, executed: false, action }) }], usage: { inputTokens: 100, outputTokens: 20, requests: 1, unknown: false },
    error: null, createdAt: 1, updatedAt: 2, expiresAt: 604800001, ...overrides }
}
function host(decide: (context: ForestLoopContext, index: number) => ForestAction) {
  let index = 0
  return {
    forestLoopCapabilities: vi.fn(async (): Promise<ConnectionInfo> => ({ schemaVersion: 1 as const, model: 'test', protocol: 'chat-completions' as const, capabilities: {
      conversation: true as const, connectionTool: true as const, sceneDraft: true, svg: true as const, vision: 'disabled' as const, forestLoop: 1 as const,
    }, retentionDays: 7 as const, limits: { modelRequests: 4, toolCalls: 8, executionMs: 120000, promptBytes: 16384, outputBytes: 65536 } })),
    create: vi.fn(async (request: CreateTaskRequest) => snapshot(request, decide(request.forestLoop!, index++))),
    follow: vi.fn(async () => {}),
    control: vi.fn(async (): Promise<TaskSnapshot> => { throw new Error('unexpected control') }),
  }
}
const initialAction = (context: ForestLoopContext): ForestAction => ({ kind: 'generate', stateHash: context.stateHash, seed: context.request.parameters.seed, reason: '按固定原始要求生成。' })
const generate = () => vi.fn(async (request: SemanticGenerationRequest): Promise<ForestLoopCandidate<string>> => ({
  preview: request.parameters.seed, archive: new Uint8Array([1, 2, 3]), image: new Blob(['image']),
  receipt: { candidateId: (request.parameters.seed === semanticGenerationExample().parameters.seed ? 'a' : 'b').repeat(64),
    requestHash: semanticGenerationRequestHash(request), seed: request.parameters.seed, entities: { rooms: request.parameters.roomCount, props: 44 },
    notes: request.parameters.seed === semanticGenerationExample().parameters.seed ? ['座椅没有找到合法位置。'] : [] },
}))
describe('browser forest workflow execution boundary', () => {
  it('executes an exact parent room repair and preserves both real archives without changing fixed requirements', async () => {
    const request = semanticGenerationExample()
    const diagnostic = (actual: number) => ({ structureHash: 'c'.repeat(64), outcomeHash: String(actual).repeat(64), deficit: 5 - actual,
      rooms: Array.from({ length: request.parameters.roomCount }, (_, index) => ({ roomId: `room-${index}`, recipeId: 'recipe', requirementId: `req-${index}`,
        purpose: request.parameters.purpose, repairable: index === 0 && actual < 5,
        roles: [{ role: 'seat' as const, expected: index ? 0 : 5, actual: index ? 0 : actual, deficit: index ? 0 : 5 - actual, rejections: [] }], notes: [] })) })
    const execute = generate()
    execute.mockImplementationOnce(async input => ({ ...(await generate()(input)), receipt: { candidateId: 'a'.repeat(64),
      requestHash: semanticGenerationRequestHash(input), seed: input.parameters.seed, entities: { rooms: input.parameters.roomCount, props: 44 }, notes: [], diagnostics: diagnostic(3) } }))
    const repair = vi.fn(async (parent: ForestLoopCandidate<string>, roomId: string): Promise<ForestLoopCandidate<string>> => ({ ...parent, preview: 'repaired',
      receipt: { ...parent.receipt, candidateId: 'b'.repeat(64), parentCandidateId: parent.receipt.candidateId, repairRoomId: roomId,
        entities: { ...parent.receipt.entities, props: 46 }, diagnostics: diagnostic(5) } }))
    const client = host((context, index) => !index ? initialAction(context) : index === 1
      ? { kind: 'repair-furniture', stateHash: context.stateHash, ...context.repairTargets[0], reason: '修正该房实际缺失座椅。' }
      : { kind: 'finish', stateHash: context.stateHash, candidateId: context.receipts.at(-1)!.candidateId, reason: '座椅数量补齐，画面待用户审阅。' })
    const result = await runForestWorkflow({ client, request, generate: execute, repair, signal: new AbortController().signal, assertCurrent: () => {}, onUpdate: () => {} })
    expect(result.state.status).toBe('finished'); expect(result.state.attemptsUsed).toBe(2)
    expect(execute).toHaveBeenCalledOnce(); expect(repair).toHaveBeenCalledOnce()
    expect(repair.mock.calls[0].slice(0, 2)).toEqual([result.candidates[0], 'room-0'])
    expect(client.create.mock.calls[2][0].forestLoop?.nextActions).toEqual(['finish'])
    expect(client.create.mock.calls.every(([value]) => JSON.stringify(value.forestLoop!.request) === JSON.stringify(request))).toBe(true)
    expect(result.candidates.map(value => value.preview)).toEqual([request.parameters.seed, 'repaired'])
  })
  it('gives the next model actual diagnostics, executes a bounded revision and retains both complete candidates', async () => {
    const client = host((context, index) => index === 0 ? initialAction(context) : index === 1
      ? { kind: 'generate', stateHash: context.stateHash, seed: 'second-seed', reason: context.receipts[0].notes[0] }
      : { kind: 'finish', stateHash: context.stateHash, candidateId: context.receipts[1].candidateId, reason: '第二份没有生成缺项，画面待用户审阅。' })
    const execute = generate(), request = semanticGenerationExample()
    const result = await runForestWorkflow({ client, request, signal: new AbortController().signal, generate: execute, assertCurrent: () => {}, onUpdate: () => {} })
    expect(result.state).toMatchObject({ status: 'finished', decisionsUsed: 3, attemptsUsed: 2, selectedCandidateId: 'b'.repeat(64) })
    expect(result.candidates.map(value => value.receipt.notes)).toEqual([['座椅没有找到合法位置。'], []])
    expect(client.create.mock.calls[1][0].forestLoop?.receipts[0].notes).toEqual(['座椅没有找到合法位置。'])
    expect(execute.mock.calls[1][0].parameters).toEqual({ ...request.parameters, seed: 'second-seed' })
    expect(result).toMatchObject({ requests: 3, inputTokens: 300, outputTokens: 60, unknown: false })
  })
  it('retains the first result and original request identity when a later POST has an unknown outcome', async () => {
    const client = host(initialAction)
    client.create.mockImplementationOnce(async request => snapshot(request, initialAction(request.forestLoop!)))
      .mockRejectedValueOnce(new AiClientError('network', '创建结果未知', 'unknown'))
    const execute = generate()
    const result = await runForestWorkflow({ client, request: semanticGenerationExample(), signal: new AbortController().signal, generate: execute, assertCurrent: () => {}, onUpdate: () => {} })
    expect(result.state.status).toBe('stopped')
    expect(result.candidates).toHaveLength(1); expect(execute).toHaveBeenCalledTimes(1)
    expect(client.create).toHaveBeenCalledTimes(2); expect(result.unknown).toBe(true)
    expect(result.decisions[1]).toMatchObject({ taskId: null, unknown: true })
    expect(result.decisions[1].clientRequestId).toBe(client.create.mock.calls[1][0].clientRequestId)
  })
  it('refuses a stale or invented finish action without another generation', async () => {
    const client = host((context, index) => index ? { kind: 'finish', stateHash: context.stateHash, candidateId: 'c'.repeat(64), reason: '伪造成功。' } : initialAction(context))
    const execute = generate()
    const result = await runForestWorkflow({ client, request: semanticGenerationExample(), signal: new AbortController().signal, generate: execute, assertCurrent: () => {}, onUpdate: () => {} })
    expect(result.state.status).toBe('stopped'); expect(result.state.selectedCandidateId).toBeNull()
    expect(result.candidates).toHaveLength(1); expect(execute).toHaveBeenCalledOnce()
    expect(client.create).toHaveBeenCalledTimes(2)
  })
  it('does not silently fall back to ordinary chat when the server lacks the loop tool', async () => {
    const client = host(initialAction)
    client.forestLoopCapabilities.mockResolvedValueOnce({ ...(await client.forestLoopCapabilities()), capabilities: {
      conversation: true, connectionTool: true, sceneDraft: true, svg: true, vision: 'disabled', forestLoop: undefined,
    } } as never)
    const execute = generate()
    const result = await runForestWorkflow({ client, request: semanticGenerationExample(), signal: new AbortController().signal, generate: execute, assertCurrent: () => {}, onUpdate: () => {} })
    expect(result.state.status).toBe('stopped'); expect(client.create).not.toHaveBeenCalled(); expect(execute).not.toHaveBeenCalled()
  })
  it('counts a failed local attempt and stops without asking the model to retry it', async () => {
    const client = host(initialAction), execute = generate()
    execute.mockRejectedValueOnce(new Error('真实资源冷读失败'))
    const result = await runForestWorkflow({ client, request: semanticGenerationExample(), signal: new AbortController().signal, generate: execute, assertCurrent: () => {}, onUpdate: () => {} })
    expect(result.state).toMatchObject({ status: 'stopped', attemptsUsed: 1, decisionsUsed: 1, stopReason: '真实资源冷读失败' })
    expect(result.state.failures).toHaveLength(1); expect(result.candidates).toHaveLength(0)
    expect(client.create).toHaveBeenCalledOnce(); expect(execute).toHaveBeenCalledOnce()
  })
  it('cancels one known running decision on abort without replaying it', async () => {
    const abort = new AbortController(), client = host(initialAction)
    client.create.mockImplementationOnce(async request => snapshot(request, initialAction(request.forestLoop!), { status: 'running', tools: [], usage: { requests: 1, inputTokens: null, outputTokens: null, unknown: true } }))
    client.follow.mockImplementationOnce(async () => { abort.abort(); abort.signal.throwIfAborted() })
    client.control.mockImplementationOnce(async () => ({ schemaVersion: 1, status: 'cancelled', usage: { requests: 1, inputTokens: null, outputTokens: null, unknown: true } }) as TaskSnapshot)
    const execute = generate()
    const result = await runForestWorkflow({ client, request: semanticGenerationExample(), signal: abort.signal, generate: execute, assertCurrent: () => {}, onUpdate: () => {} })
    expect(result.state.status).toBe('stopped'); expect(result.unknown).toBe(true)
    expect(client.control).toHaveBeenCalledOnce(); expect(client.create).toHaveBeenCalledOnce(); expect(execute).not.toHaveBeenCalled()
  })
})
