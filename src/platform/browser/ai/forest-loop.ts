import { beginForestAction, completeForestGeneration, createForestLoop, failForestGeneration, forestLoopContext,
  stopForestLoop, validateForestAction, type ForestAction, type ForestGenerationReceipt, type ForestLoopState } from '../../../shared/ai/forest-loop.js'
import { workflowBinding } from '../../../shared/ai/workflows/catalog.js'
import { isTerminalTask, type TaskSnapshot } from '../../../shared/ai/protocol.js'
import { semanticGenerationRequestSchema, type SemanticGenerationRequest } from '../../../shared/generation/semantic-request.js'
import { AiClientError, safeAiError, type AiClient } from './client.js'

export interface ForestLoopCandidate<T> {
  receipt: ForestGenerationReceipt
  preview: T
  image: Blob
  archive: Uint8Array
}
export interface ForestLoopDecision {
  clientRequestId: string; taskId: string | null; startedMs: number; completedMs: number | null
  action: ForestAction | null; requests: number; inputTokens: number | null; outputTokens: number | null; unknown: boolean
}
export interface ForestLoopOutcome<T> {
  state: ForestLoopState; candidates: readonly ForestLoopCandidate<T>[]; decisions: readonly ForestLoopDecision[]
  elapsedMs: number; requests: number; inputTokens: number | null; outputTokens: number | null; unknown: boolean
}
export type ForestLoopObserver<T> = (value: ForestLoopOutcome<T>) => void
type DecisionClient = Pick<AiClient, 'create' | 'follow' | 'control' | 'forestLoopCapabilities'>

/** Only fixed semantic candidates cross this boundary. A model decision cannot
 * write a project, change requirements, reset this loop or grant itself retries. */
export async function runForestWorkflow<T>(options: {
  request: SemanticGenerationRequest; client: DecisionClient; signal: AbortSignal
  generate(request: SemanticGenerationRequest, signal: AbortSignal): Promise<ForestLoopCandidate<T>>
  repair?(parent: ForestLoopCandidate<T>, roomId: string, signal: AbortSignal): Promise<ForestLoopCandidate<T>>
  assertCurrent(): void; onUpdate: ForestLoopObserver<T>
}): Promise<ForestLoopOutcome<T>> {
  const started = performance.now(), elapsed = () => Math.round(performance.now() - started)
  const signal = AbortSignal.any([options.signal, AbortSignal.timeout(360000)])
  let state = createForestLoop(options.request, { maxCandidates: 3, maxDecisions: 4 }, crypto.randomUUID())
  const candidates: ForestLoopCandidate<T>[] = [], decisions: ForestLoopDecision[] = []
  let pendingTask: TaskSnapshot | null = null
  const view = (): ForestLoopOutcome<T> => ({ state, candidates: [...candidates], decisions: decisions.map(value => ({ ...value })), elapsedMs: elapsed(),
    requests: decisions.reduce((sum, value) => sum + value.requests, 0),
    inputTokens: decisions.some(value => value.inputTokens === null) ? null : decisions.reduce((sum, value) => sum + value.inputTokens!, 0),
    outputTokens: decisions.some(value => value.outputTokens === null) ? null : decisions.reduce((sum, value) => sum + value.outputTokens!, 0),
    unknown: decisions.some(value => value.unknown) })
  const publish = () => options.onUpdate(view())
  const current = () => { signal.throwIfAborted(); options.assertCurrent() }
  publish()
  try {
    current()
    const info = await options.client.forestLoopCapabilities(signal)
    if (info.capabilities.forestLoop !== 1) throw new Error('当前后端尚未接入林中建筑执行工具，请更新后端后使用；原工程保留。')
    while (state.status === 'ready') {
      current()
      const context = forestLoopContext(state)
      const record: ForestLoopDecision = { clientRequestId: crypto.randomUUID(), taskId: null, startedMs: elapsed(), completedMs: null,
        action: null, requests: 0, inputTokens: null, outputTokens: null, unknown: true }
      decisions.push(record); publish()
      // The request identity is retained before the first await. Failure never
      // causes another POST or an implicitly fresh loop.
      const created = await options.client.create({ schemaVersion: 1, clientRequestId: record.clientRequestId, context: null,
        workflow: workflowBinding('sceneweave-forest-building'), forestLoop: context,
        prompt: '请根据本轮固定要求、当前合法动作和真实候选缺项，调用一次sceneweave_forest_action。保留未解决要求；此动作不会自动采用主工程。',
      }, signal, current)
      const accept = (snapshot: TaskSnapshot) => {
        current()
        if (snapshot.clientRequestId !== record.clientRequestId || snapshot.context !== null || snapshot.authoring
          || record.taskId && snapshot.id !== record.taskId) throw new Error('模型动作任务身份不匹配；保留原任务，不执行候选。')
        if (pendingTask?.id === snapshot.id && (snapshot.generation < pendingTask.generation || snapshot.generation === pendingTask.generation && snapshot.lastSequence < pendingTask.lastSequence)) return
        record.taskId = snapshot.id; pendingTask = snapshot
        record.requests = snapshot.usage.requests; record.inputTokens = snapshot.usage.inputTokens
        record.outputTokens = snapshot.usage.outputTokens; record.unknown = snapshot.usage.unknown
        publish()
      }
      accept(created)
      if (!isTerminalTask(created.status) && created.status !== 'paused') await options.client.follow(created, { onSnapshot: accept }, signal)
      current()
      const completed = pendingTask as TaskSnapshot | null
      if (!completed || completed.status !== 'completed' || completed.usage.unknown) throw new Error('模型请求未完整确认；已停止循环，保留原请求和已有候选，不自动重发。')
      if (record.requests !== 1) throw new Error('本轮动作超出一次模型请求的约定，循环已停止。')
      const actions = completed.tools.filter(tool => tool.name === 'sceneweave_forest_action')
      if (actions.length !== 1 || !actions[0].success) throw new Error('模型没有返回唯一合法执行动作；已保留已有候选。')
      const result = JSON.parse(actions[0].output) as { action?: unknown; acceptedForHost?: boolean }
      if (result.acceptedForHost !== true) throw new Error('动作尚未被宿主接收，不能声称已生成。')
      const action = validateForestAction(context, result.action)
      record.action = action; record.completedMs = elapsed(); pendingTask = null
      state = beginForestAction(state, action); publish()
      if (action.kind === 'finish') break
      try {
        let generated: ForestLoopCandidate<T>
        if (action.kind === 'repair-furniture') {
          const parent = candidates.find(value => value.receipt.candidateId === action.candidateId)
          if (!parent || !options.repair) throw new Error('当前宿主没有可用的指定房间家具修正，已有候选保留。')
          generated = await options.repair(parent, action.roomId, signal)
        } else {
          const request = semanticGenerationRequestSchema.parse({ ...state.request, parameters: { ...state.request.parameters, seed: action.seed } })
          generated = await options.generate(request, signal)
        }
        current()
        state = completeForestGeneration(state, generated.receipt)
        candidates.push(generated)
      } catch (error) {
        current()
        const reason = error instanceof Error ? error.message : '本机生成失败，之前的候选保留。'
        state = stopForestLoop(failForestGeneration(state, reason), reason)
      }
      publish()
    }
  } catch (error) {
    const reason = signal.aborted ? '本轮自动候选已停止；原工程及已完成候选保留，模型请求不自动重发。'
      : error instanceof AiClientError ? safeAiError(error) : error instanceof Error ? error.message : '执行未完成，已保留原任务及候选。'
    state = stopForestLoop(state, reason)
    // A known running task may be cancelled once. This never starts a provider
    // request, and cancellation uncertainty cannot authorize another attempt.
    const task = pendingTask as TaskSnapshot | null
    if (task && !isTerminalTask(task.status)) {
      try {
        const stopped = await options.client.control(task.id, { schemaVersion: 1, expectedGeneration: task.generation, action: 'cancel' }, AbortSignal.timeout(5000))
        const record = decisions.at(-1)!
        record.requests = stopped.usage.requests; record.inputTokens = stopped.usage.inputTokens
        record.outputTokens = stopped.usage.outputTokens; record.unknown = stopped.usage.unknown
      } catch { /* Keep original identity and unknown usage; never retry. */ }
    }
    publish()
  }
  return view()
}
