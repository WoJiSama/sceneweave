import { z } from 'zod'
import { beginForestAction, completeForestGeneration, createForestLoop, failForestGeneration, FOREST_WORKFLOW_ID, ForestActionSchema,
  ForestLoopStateSchema, forestLoopContext, stopForestLoop, validateForestAction, type ForestGenerationReceipt } from '../../../shared/ai/forest-loop.js'
import { assertWorkflowBinding, workflowBinding, type WorkflowBinding } from '../../../shared/ai/workflows/catalog.js'
import { isTerminalTask, TaskSnapshotSchema, TaskUsageSchema, type TaskSnapshot } from '../../../shared/ai/protocol.js'
import { semanticGenerationRequestSchema, type SemanticGenerationRequest } from '../../../shared/generation/semantic-request.js'
import { canonicalJson } from '../../../shared/validation/json.js'
import { AiClientError, safeAiError, type AiClient } from './client.js'

export interface ForestLoopCandidate<T> {
  receipt: ForestGenerationReceipt
  preview: T
  image: Blob
  archive: Uint8Array
}
const milliseconds = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const decisionSchema = TaskUsageSchema.extend({
  clientRequestId: TaskSnapshotSchema.shape.clientRequestId, taskId: TaskSnapshotSchema.shape.id.nullable(),
  startedMs: milliseconds, completedMs: milliseconds.nullable(), action: ForestActionSchema.nullable(),
  progress: z.object({ generation: TaskSnapshotSchema.shape.generation, lastSequence: TaskSnapshotSchema.shape.lastSequence }).strict().nullable(),
}).strict()
export type ForestLoopDecision = z.infer<typeof decisionSchema>
export const ForestLoopCheckpointSchema = z.object({ state: ForestLoopStateSchema, decisions: z.array(decisionSchema).max(4), elapsedMs: milliseconds }).strict()
  .superRefine(({ state, decisions, elapsedMs }, ctx) => {
    const unaccepted = decisions.filter(record => record.action === null)
    if (decisions.length > state.limits.maxDecisions || decisions.length - unaccepted.length !== state.decisionsUsed
      || unaccepted.length > 1 || unaccepted.length && (unaccepted[0] !== decisions.at(-1) || !['ready', 'stopped'].includes(state.status))
      || new Set(decisions.map(record => record.clientRequestId)).size !== decisions.length
      || decisions.some(record => !!record.taskId !== !!record.progress || record.startedMs > elapsedMs
        || record.action && (!record.taskId || record.unknown || record.requests !== 1 || record.completedMs === null)
        || record.completedMs !== null && (record.completedMs < record.startedMs || record.completedMs > elapsedMs))) {
      ctx.addIssue({ code: 'custom', message: '林中建筑的请求身份、决策或累计用量不一致。' })
      return
    }
    try {
      let replay = createForestLoop(state.request, state.limits, state.runId)
      let receipt = 0, failure = 0
      for (const record of decisions) {
        if (!record.action) break
        replay = beginForestAction(replay, record.action)
        if (!replay.pending) continue
        if (state.receipts[receipt]) replay = completeForestGeneration(replay, state.receipts[receipt++])
        else if (state.failures[failure]) replay = failForestGeneration(replay, state.failures[failure++].message)
      }
      if (state.status === 'stopped') replay = stopForestLoop(replay, state.stopReason ?? '')
      if (canonicalJson(replay) !== canonicalJson(state)) throw new Error('checkpoint history mismatch')
    } catch { ctx.addIssue({ code: 'custom', message: '林中建筑的动作记录与候选或预算不符。' }) }
  })
export type ForestLoopCheckpoint = z.infer<typeof ForestLoopCheckpointSchema>
export interface ForestLoopOutcome<T> extends ForestLoopCheckpoint {
  candidates: readonly ForestLoopCandidate<T>[]
  requests: number
  inputTokens: number | null
  outputTokens: number | null
  unknown: boolean
  notice: string | null
}
export type ForestLoopObserver<T> = (value: ForestLoopOutcome<T>) => void
type DecisionClient = Pick<AiClient, 'create' | 'follow' | 'control' | 'forestLoopCapabilities' | 'findByClientRequestId'>
export const FOREST_USER_STOP = Symbol('forest user stop')
const maxActiveMs = 360000

export function newForestCheckpoint(request: SemanticGenerationRequest): ForestLoopCheckpoint {
  return { state: createForestLoop(request, { maxCandidates: 3, maxDecisions: 4 }, crypto.randomUUID()), decisions: [], elapsedMs: 0 }
}

export function forestLoopOutcome<T>(checkpoint: ForestLoopCheckpoint, candidates: readonly ForestLoopCandidate<T>[], notice: string | null = null): ForestLoopOutcome<T> {
  const { decisions } = checkpoint
  return { ...checkpoint, candidates: [...candidates], notice,
    requests: decisions.reduce((sum, record) => sum + record.requests, 0),
    inputTokens: decisions.some(record => record.inputTokens === null) ? null : decisions.reduce((sum, record) => sum + record.inputTokens!, 0),
    outputTokens: decisions.some(record => record.outputTokens === null) ? null : decisions.reduce((sum, record) => sum + record.outputTokens!, 0),
    unknown: decisions.some(record => record.unknown),
  }
}

function observeDecision(record: ForestLoopDecision, snapshot: TaskSnapshot, expected: WorkflowBinding): ForestLoopDecision {
  if (snapshot.clientRequestId !== record.clientRequestId || snapshot.context !== null || snapshot.authoring
    || record.taskId && snapshot.id !== record.taskId || canonicalJson(snapshot.workflow ?? null) !== canonicalJson(expected)) {
    throw new Error('模型任务与原请求身份或流程定义不符。')
  }
  if (snapshot.status === 'completed' && snapshot.generation !== 1) throw new Error('模型任务已改变执行世代。')
  if (record.progress && (snapshot.generation < record.progress.generation || snapshot.lastSequence < record.progress.lastSequence)) return record
  if (snapshot.usage.requests < record.requests || (record.inputTokens ?? 0) > (snapshot.usage.inputTokens ?? 0)
    || (record.outputTokens ?? 0) > (snapshot.usage.outputTokens ?? 0)) throw new Error('模型任务的累计用量已变化。')
  return { ...record, ...snapshot.usage, unknown: snapshot.usage.unknown || !isTerminalTask(snapshot.status),
    taskId: snapshot.id, progress: { generation: snapshot.generation, lastSequence: snapshot.lastSequence } }
}

export async function lookupForestDecisions(checkpoint: ForestLoopCheckpoint, workflow: WorkflowBinding, client: DecisionClient, signal: AbortSignal): Promise<ForestLoopCheckpoint> {
  const decisions = []
  for (const record of checkpoint.decisions) {
    if (record.action) { decisions.push(record); continue }
    const snapshot = await client.findByClientRequestId(record.clientRequestId, signal)
    decisions.push(snapshot ? observeDecision(record, snapshot, workflow) : record)
  }
  return { ...checkpoint, decisions }
}

/** Each model request reserves a durable identity first. A restored reservation
 * can only query that identity. Accepted actions are durable before local work. */
export async function runForestWorkflow<T>(options: {
  checkpoint: ForestLoopCheckpoint; workflow?: WorkflowBinding; candidates: readonly ForestLoopCandidate<T>[]; client: DecisionClient; signal: AbortSignal
  save(checkpoint: ForestLoopCheckpoint, candidate?: ForestLoopCandidate<T>): Promise<void>
  generate(request: SemanticGenerationRequest, signal: AbortSignal): Promise<ForestLoopCandidate<T>>
  repair?(parent: ForestLoopCandidate<T>, roomId: string, signal: AbortSignal): Promise<ForestLoopCandidate<T>>
  assertCurrent(): void; onUpdate: ForestLoopObserver<T>
}): Promise<ForestLoopOutcome<T>> {
  const started = performance.now(), elapsed = () => options.checkpoint.elapsedMs + Math.round(performance.now() - started)
  const timeout = AbortSignal.timeout(Math.max(0, maxActiveMs - options.checkpoint.elapsedMs))
  const signal = AbortSignal.any([options.signal, timeout])
  const workflow = assertWorkflowBinding(options.workflow ?? workflowBinding(FOREST_WORKFLOW_ID))
  const candidates = [...options.candidates]
  let checkpoint = ForestLoopCheckpointSchema.parse(options.checkpoint), pendingTask: TaskSnapshot | undefined, checkedCapabilities = false
  if (canonicalJson(candidates.map(candidate => candidate.receipt)) !== canonicalJson(checkpoint.state.receipts)) {
    throw new Error('已恢复的候选与断点不一致。')
  }
  const current = () => { signal.throwIfAborted(); options.assertCurrent() }
  const save = async (state: ForestLoopCheckpoint['state'], decisions = checkpoint.decisions, candidate?: ForestLoopCandidate<T>) => {
    options.assertCurrent()
    const next = ForestLoopCheckpointSchema.parse({ state, decisions, elapsedMs: elapsed() })
    await options.save(next, candidate)
    checkpoint = next
    if (candidate) candidates.push(candidate)
    options.onUpdate(forestLoopOutcome(checkpoint, candidates))
  }
  const saveDecision = (record: ForestLoopDecision, state = checkpoint.state) => save(state, [...checkpoint.decisions.slice(0, -1), record])
  const errorText = (error: unknown) => error instanceof AiClientError ? safeAiError(error)
    : error instanceof Error ? error.message : '执行未完成，已保留本轮断点。'
  options.onUpdate(forestLoopOutcome(checkpoint, candidates))
  try {
    while (checkpoint.state.status === 'ready' || checkpoint.state.status === 'generating') {
      if (elapsed() >= maxActiveMs) {
        await save(stopForestLoop(checkpoint.state, '本轮执行时间已达上限，可审阅已保存的候选。'))
        break
      }
      current()
      const { state } = checkpoint
      if (state.pending) {
        const action = state.pending
        let generated: ForestLoopCandidate<T>, next: ForestLoopCheckpoint['state']
        try {
          if (action.kind === 'repair-furniture') {
            const parent = candidates.find(value => value.receipt.candidateId === action.candidateId)
            if (!parent || !options.repair) throw new Error('当前宿主缺少指定房间的父候选或家具修正工具。')
            generated = await options.repair(parent, action.roomId, signal)
          } else {
            const request = semanticGenerationRequestSchema.parse({ ...state.request, parameters: { ...state.request.parameters, seed: action.seed } })
            generated = await options.generate(request, signal)
          }
          current()
          next = completeForestGeneration(state, generated.receipt)
        } catch (error) {
          current()
          const reason = errorText(error)
          await save(stopForestLoop(failForestGeneration(state, reason), reason))
          break
        }
        await save(next, checkpoint.decisions, generated)
        continue
      }
      const context = forestLoopContext(state)
      let record = checkpoint.decisions.at(-1)
      let created: TaskSnapshot | undefined
      if (record && !record.action) {
        created = await options.client.findByClientRequestId(record.clientRequestId, signal)
        current()
        if (!created) throw new Error('后端尚未确认原模型请求。可再次只读查询，原请求和候选已保留。')
      } else {
        if (!checkedCapabilities) {
          const info = await options.client.forestLoopCapabilities(signal)
          current()
          if (info.capabilities.forestLoop !== 1) throw new Error('当前后端尚未接入林中建筑执行工具。')
          checkedCapabilities = true
        }
        record = { clientRequestId: crypto.randomUUID(), taskId: null, progress: null, startedMs: elapsed(), completedMs: null,
          action: null, requests: 0, inputTokens: null, outputTokens: null, unknown: true }
        await save(state, [...checkpoint.decisions, record])
        current()
        try {
          created = await options.client.create({ schemaVersion: 1, clientRequestId: record.clientRequestId, context: null,
            workflow, forestLoop: context,
            prompt: '请根据本轮固定要求、当前合法动作和真实候选缺项，调用一次sceneweave_forest_action。保留未解决要求；此动作不会自动采用主工程。',
          }, signal, current)
        } catch (error) {
          current()
          if (error instanceof AiClientError && error.requestState === 'not_sent') {
            await saveDecision({ ...record, unknown: false, inputTokens: 0, outputTokens: 0 }, stopForestLoop(state, errorText(error)))
            break
          }
          throw error
        }
      }
      const accept = (snapshot: TaskSnapshot) => {
        current()
        const next = observeDecision(record!, snapshot, workflow)
        if (next !== record) { record = next; pendingTask = snapshot }
      }
      accept(created)
      await saveDecision(record)
      if (!isTerminalTask(created.status) && created.status !== 'paused') {
        const beforeFollow = record
        try { await options.client.follow(created, { onSnapshot: accept }, signal) }
        finally { if (!signal.aborted && record !== beforeFollow) { current(); await saveDecision(record) } }
      }
      current()
      const completed = pendingTask
      if (!completed || !isTerminalTask(completed.status)) throw new Error('原模型任务尚未完成。已保留断点和现有候选。')
      if (completed.status !== 'completed' || completed.usage.unknown || record.requests !== 1) {
        await save(stopForestLoop(state, '原模型请求已结束，未确认一项可执行动作。'))
        break
      }
      let action
      try {
        const actions = completed.tools.filter(tool => tool.name === 'sceneweave_forest_action')
        if (actions.length !== 1 || !actions[0].success) throw new Error('模型没有返回唯一合法执行动作。')
        const result = JSON.parse(actions[0].output) as { action?: unknown; acceptedForHost?: boolean }
        if (result.acceptedForHost !== true) throw new Error('动作尚未被宿主接收。')
        action = validateForestAction(context, result.action)
      } catch (error) {
        await save(stopForestLoop(state, errorText(error)))
        break
      }
      await saveDecision({ ...record, action, completedMs: elapsed() }, beginForestAction(state, action))
      pendingTask = undefined
    }
  } catch (error) {
    if (options.signal.reason === FOREST_USER_STOP || timeout.aborted && !options.signal.aborted) {
      options.assertCurrent()
      let record = checkpoint.decisions.at(-1)
      if (record && !record.action && pendingTask && !isTerminalTask(pendingTask.status)) {
        try {
          const stopped = await options.client.control(pendingTask.id, { schemaVersion: 1, expectedGeneration: pendingTask.generation, action: 'cancel' }, AbortSignal.timeout(5000))
          record = observeDecision(record, stopped, workflow)
        } catch { /* The saved identity still permits a later read-only lookup. */ }
      }
      const decisions = record ? [...checkpoint.decisions.slice(0, -1), record] : []
      const reason = timeout.aborted ? '本轮执行时间已达上限，可审阅已保存的候选。' : '已停止本轮自动候选，保留已完成的工程和请求记录。'
      await save(stopForestLoop(checkpoint.state, reason), decisions)
    } else {
      const outcome = forestLoopOutcome(checkpoint, candidates, signal.aborted ? '已暂停。可从本机断点接续。' : errorText(error))
      options.onUpdate(outcome)
      return outcome
    }
  }
  return forestLoopOutcome(checkpoint, candidates)
}
