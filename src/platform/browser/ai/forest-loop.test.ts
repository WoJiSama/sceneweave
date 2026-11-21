import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { describe, expect, it, vi } from 'vitest'
import { FOREST_USER_STOP, newForestCheckpoint, runForestWorkflow, type ForestLoopCandidate } from './forest-loop.js'
import { AiClientError } from './client.js'
import { ForestLoopStore } from './forest-loop-store.js'
import { workflowBinding } from '../../../shared/ai/workflows/catalog.js'
import { semanticGenerationExample, semanticGenerationRequestHash, type SemanticGenerationRequest } from '../../../shared/generation/semantic-request.js'
import type { ConnectionInfo, CreateTaskRequest, TaskSnapshot } from '../../../shared/ai/protocol.js'
import type { ForestAction, ForestLoopContext } from '../../../shared/ai/forest-loop.js'

function snapshot(request: CreateTaskRequest, action: ForestAction, overrides: Partial<TaskSnapshot> = {}): TaskSnapshot {
  return { schemaVersion: 1, id: crypto.randomUUID(), clientRequestId: request.clientRequestId, workflow: request.workflow, context: null, status: 'completed',
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
    findByClientRequestId: vi.fn(async (_id: string): Promise<TaskSnapshot | undefined> => undefined),
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
type LoopOptions = Parameters<typeof runForestWorkflow<string>>[0]
const run = ({ request, ...options }: Omit<LoopOptions, 'checkpoint' | 'save' | 'candidates'> & { request: SemanticGenerationRequest }) =>
  runForestWorkflow({ ...options, checkpoint: newForestCheckpoint(request), candidates: [], save: async () => {} })

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
    const result = await run({ client, request, generate: execute, repair, signal: new AbortController().signal, assertCurrent: () => {}, onUpdate: () => {} })
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
    const result = await run({ client, request, signal: new AbortController().signal, generate: execute, assertCurrent: () => {}, onUpdate: () => {} })
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
    const result = await run({ client, request: semanticGenerationExample(), signal: new AbortController().signal, generate: execute, assertCurrent: () => {}, onUpdate: () => {} })
    expect(result.state.status).toBe('ready')
    expect(result.candidates).toHaveLength(1); expect(execute).toHaveBeenCalledTimes(1)
    expect(client.create).toHaveBeenCalledTimes(2); expect(result.unknown).toBe(true)
    expect(result.decisions[1]).toMatchObject({ taskId: null, unknown: true })
    expect(result.decisions[1].clientRequestId).toBe(client.create.mock.calls[1][0].clientRequestId)
  })
  it('refuses a stale or invented finish action without another generation', async () => {
    const client = host((context, index) => index ? { kind: 'finish', stateHash: context.stateHash, candidateId: 'c'.repeat(64), reason: '伪造成功。' } : initialAction(context))
    const execute = generate()
    const result = await run({ client, request: semanticGenerationExample(), signal: new AbortController().signal, generate: execute, assertCurrent: () => {}, onUpdate: () => {} })
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
    const result = await run({ client, request: semanticGenerationExample(), signal: new AbortController().signal, generate: execute, assertCurrent: () => {}, onUpdate: () => {} })
    expect(result.notice).toContain('尚未接入'); expect(client.create).not.toHaveBeenCalled(); expect(execute).not.toHaveBeenCalled()
  })
  it('counts a failed local attempt and stops without asking the model to retry it', async () => {
    const client = host(initialAction), execute = generate()
    execute.mockRejectedValueOnce(new Error('真实资源冷读失败'))
    const result = await run({ client, request: semanticGenerationExample(), signal: new AbortController().signal, generate: execute, assertCurrent: () => {}, onUpdate: () => {} })
    expect(result.state).toMatchObject({ status: 'stopped', attemptsUsed: 1, decisionsUsed: 1, stopReason: '真实资源冷读失败' })
    expect(result.state.failures).toHaveLength(1); expect(result.candidates).toHaveLength(0)
    expect(client.create).toHaveBeenCalledOnce(); expect(execute).toHaveBeenCalledOnce()
  })
  it('cancels one known running decision on abort without replaying it', async () => {
    const abort = new AbortController(), client = host(initialAction)
    client.create.mockImplementationOnce(async request => snapshot(request, initialAction(request.forestLoop!), { status: 'running', tools: [], usage: { requests: 1, inputTokens: null, outputTokens: null, unknown: true } }))
    client.follow.mockImplementationOnce(async () => { abort.abort(FOREST_USER_STOP); abort.signal.throwIfAborted() })
    client.control.mockImplementationOnce(async () => {
      const created = await client.create.mock.results[0].value
      return { ...created, status: 'cancelled', generation: created.generation + 1, lastSequence: created.lastSequence + 1 }
    })
    const execute = generate()
    const result = await run({ client, request: semanticGenerationExample(), signal: abort.signal, generate: execute, assertCurrent: () => {}, onUpdate: () => {} })
    expect(result.state.status).toBe('stopped'); expect(result.unknown).toBe(true)
    expect(client.control).toHaveBeenCalledOnce(); expect(client.create).toHaveBeenCalledOnce(); expect(execute).not.toHaveBeenCalled()
  })
  it('queries a lost POST receipt and resumes the original fixed round without replaying a model request', async () => {
    const client = host(initialAction), execute = generate(), request = semanticGenerationExample()
    let checkpoint = newForestCheckpoint(request), recoveredTask: TaskSnapshot | undefined
    const save: LoopOptions['save'] = async value => { checkpoint = value }
    client.create.mockImplementationOnce(async input => {
      expect(checkpoint.decisions.at(-1)?.clientRequestId).toBe(input.clientRequestId)
      recoveredTask = snapshot(input, initialAction(input.forestLoop!))
      throw new AiClientError('network', '原 POST 回执丢失', 'unknown')
    }).mockImplementationOnce(async input => snapshot(input, { kind: 'finish', stateHash: input.forestLoop!.stateHash,
      candidateId: input.forestLoop!.receipts[0].candidateId, reason: '结束原任务。' }))
    const options = { client, generate: execute, candidates: [], save, signal: new AbortController().signal, assertCurrent: () => {}, onUpdate: () => {} }
    const paused = await runForestWorkflow({ ...options, checkpoint })
    expect(paused).toMatchObject({ unknown: true, requests: 0, state: { runId: checkpoint.state.runId, attemptsUsed: 0 } })
    client.findByClientRequestId.mockImplementationOnce(async () => recoveredTask)
    const finished = await runForestWorkflow({ ...options, checkpoint })
    expect(client.findByClientRequestId).toHaveBeenCalledWith(paused.decisions[0].clientRequestId, expect.any(AbortSignal))
    expect(client.create).toHaveBeenCalledTimes(2)
    expect(execute).toHaveBeenCalledOnce()
    expect(finished.state).toMatchObject({ status: 'finished', runId: paused.state.runId, request, attemptsUsed: 1 })
    expect(finished.decisions[0].clientRequestId).toBe(paused.decisions[0].clientRequestId)
    expect(finished).toMatchObject({ unknown: false, requests: 2, inputTokens: 200, outputTokens: 40 })
  })

  it('starts no model request when its reservation fails and retains the last checkpoint when candidate storage fails', async () => {
    const client = host(initialAction), execute = generate()
    let checkpoint = newForestCheckpoint(semanticGenerationExample())
    const options = { client, generate: execute, candidates: [], signal: new AbortController().signal, assertCurrent: () => {}, onUpdate: () => {} }
    await runForestWorkflow({ ...options, checkpoint, save: async () => { throw new Error('磁盘配额已满') } })
    expect(client.create).not.toHaveBeenCalled()
    const work = await runForestWorkflow({ ...options, checkpoint, save: async (value, result) => {
      if (result) throw new Error('候选保存失败')
      checkpoint = value
    } })
    expect(client.create).toHaveBeenCalledOnce(); expect(execute).toHaveBeenCalledOnce()
    expect(work.state).toMatchObject({ status: 'generating', attemptsUsed: 1, decisionsUsed: 1, receipts: [] })
    expect(work.notice).toBe('候选保存失败')
    expect(checkpoint.state).toEqual(work.state)
  })

  it('leaves an unresolved reservation in place when a read-only check has no result', async () => {
    const client = host(initialAction), generateCandidate = generate()
    client.create.mockRejectedValueOnce(new AiClientError('network', '连接失去', 'unknown'))
    let checkpoint = newForestCheckpoint(semanticGenerationExample())
    const options = { client, candidates: [], generate: generateCandidate, signal: new AbortController().signal, assertCurrent: () => {}, onUpdate: () => {},
      save: async (value: LoopOptions['checkpoint']) => { checkpoint = value } }
    await runForestWorkflow({ ...options, checkpoint })
    const held = checkpoint
    await runForestWorkflow({ ...options, checkpoint })
    expect(checkpoint).toBe(held)
    expect(client.create).toHaveBeenCalledOnce()
    expect(client.findByClientRequestId).toHaveBeenCalledOnce()
    expect(generateCandidate).not.toHaveBeenCalled()
  })

  it('commits only one reservation from two browser sessions using the same saved revision', async () => {
    const name = `forest-loop-test-${crypto.randomUUID()}`
    const first = new ForestLoopStore(name), second = new ForestLoopStore(name)
    const client = host(initialAction), signal = new AbortController().signal
    const request = semanticGenerationExample()
    try {
      const original = await first.start(newForestCheckpoint(request), 'http://127.0.0.1:8787', signal)
      const copy = await second.active()
      client.create.mockRejectedValueOnce(new AiClientError('network', '回执未知', 'unknown'))
      const resume = (store: ForestLoopStore, row: typeof original) => runForestWorkflow({
        checkpoint: row.checkpoint, candidates: [], client, signal, generate: generate(), assertCurrent: () => {}, onUpdate: () => {},
        save: async (next, candidate) => {
          expect(candidate).toBeUndefined()
          await store.commit(row, next, undefined, signal)
        },
      })
      await Promise.all([resume(first, original), resume(second, copy!)])
      expect(client.create).toHaveBeenCalledOnce()
      const durable = await second.active()
      expect(durable?.revision).toBe(original.revision + 1)
      expect(durable?.checkpoint.decisions).toMatchObject([{ clientRequestId: client.create.mock.calls[0][0].clientRequestId, unknown: true }])
    } finally {
      first.close(); second.close()
      await Dexie.delete(name)
    }
  })

  it('does not run a saved action or call the model if the workflow definition changes', async () => {
    const checkpoint = newForestCheckpoint(semanticGenerationExample()), client = host(initialAction), execute = generate()
    const workflow = { ...workflowBinding('sceneweave-forest-building'), definitionHash: '0'.repeat(64) }
    await expect(runForestWorkflow({ checkpoint, workflow, candidates: [], client, generate: execute, signal: new AbortController().signal,
      assertCurrent: () => {}, onUpdate: () => {}, save: async () => {} })).rejects.toThrow('工作流定义已变化')
    expect(client.create).not.toHaveBeenCalled()
    expect(execute).not.toHaveBeenCalled()
  })
})
