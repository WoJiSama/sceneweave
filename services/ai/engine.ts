import { z } from 'zod'
import { AI_LIMITS, utf8Size } from '../../src/shared/ai/protocol.js'
import type { AiError, ConnectionInfo, ControlTaskRequest, CreateTaskRequest, TaskSnapshot, ToolResult } from '../../src/shared/ai/protocol.js'
import type { ProviderAdapter, ProviderRequestScheduler, ProviderToolCall, ProviderToolDefinition } from './provider-types.js'
import { PROVIDER_REASONING_BYTES, ProviderFailure } from './provider-types.js'
import { TaskFault, TaskStore, safeTaskError } from './store.js'
import type { EventInput, StoredTask } from './store.js'
import { AUTHORING_LIMITS, AuthoringDraftSchema, DraftLeaseSchema } from '../../src/shared/ai/authoring-protocol.js'
import type { AuthoringDraft, DraftClaim, DraftLease, DraftStamp } from '../../src/shared/ai/authoring-protocol.js'
import { validateAuthoringStart, checkAuthoringDraft, authoringBudgetIdentity, authoringDraftStamp } from '../../src/shared/ai/authoring.js'
import { StaticSvgArtifacts } from './svg-artifacts.js'
import { getAuthoringTools, executeAuthoringTool, updateAuthoringSummary } from './authoring-tools.js'
import { validateTaskVision } from './vision-input.js'
import { VISION_LIMITS } from '../../src/shared/ai/vision.js'
import { canonicalJson } from '../../src/shared/validation/json.js'
import { sha256Text } from '../../src/shared/validation/hash.js'
import { RegionSceneCandidateResponseSchema } from '../../src/shared/ai/region-candidate-protocol.js'
import type { RegionSceneCandidateQuery } from '../../src/shared/ai/region-candidate-protocol.js'
import { CONTINUATION_POLICY } from '../../src/shared/ai/budget-policy.js'

const connectionArguments = z.object({ topic: z.literal('connection') }).strict()
const tool: ProviderToolDefinition = { name: 'sceneweave_connection_info', description: 'Read this Sceneweave connection and its actual supported capabilities. This does not read or change any scene.', parameters: { type: 'object', properties: { topic: { type: 'string', enum: ['connection'] } }, required: ['topic'], additionalProperties: false } }
const validId = /^[A-Za-z0-9_.:-]{1,128}$/
const aborted = () => new DOMException('Execution interrupted', 'AbortError')
const REGION_CANDIDATE_MAX_BYTES = 8 * 1024 * 1024

export interface TaskEngineOptions { now?: () => number; maxConcurrent?: number; authoringOutputTokens?: number; preserveReasoning?: 'enabled' | 'disabled'; requestScheduler?: ProviderRequestScheduler }

export class TaskEngine {
  private active = new Map<string, { generation: number; abort: AbortController; timer: ReturnType<typeof setTimeout> }>()
  private readonly now: () => number
  private readonly maxConcurrent: number
  private readonly authoringOutputTokens: number
  private readonly preserveReasoning: 'enabled' | 'disabled'
  private readonly requestScheduler?: ProviderRequestScheduler
  private readonly unsubscribeDeleted: () => void
  private unavailable = false
  private unavailableListeners = new Set<() => void>()
  constructor(readonly store: TaskStore, private readonly provider: ProviderAdapter, readonly connectionInfo: ConnectionInfo, options: TaskEngineOptions = {}) {
    this.now = options.now ?? Date.now
    this.maxConcurrent = options.maxConcurrent ?? 4
    this.authoringOutputTokens = options.authoringOutputTokens ?? AI_LIMITS.maxOutputTokensPerRequest
    if (!Number.isInteger(this.authoringOutputTokens) || this.authoringOutputTokens < 1 || this.authoringOutputTokens > AUTHORING_LIMITS.maxOutputTokensPerRequest) throw new Error('Invalid server configuration: AUTHORING_OUTPUT_TOKENS')
    this.preserveReasoning = options.preserveReasoning === undefined ? 'disabled' : options.preserveReasoning
    this.requestScheduler = options.requestScheduler
    if (this.requestScheduler && (!Number.isSafeInteger(this.requestScheduler.cooldownMs) || this.requestScheduler.cooldownMs < 0 || this.requestScheduler.cooldownMs > 60_000)) throw new Error('Invalid provider cooldown')
    if (this.preserveReasoning !== 'enabled' && this.preserveReasoning !== 'disabled') throw new Error('Invalid server configuration: PROVIDER_PRESERVE_REASONING')
    this.connectionInfo = Object.freeze({ ...connectionInfo, authoringOutputTokens: this.authoringOutputTokens })
    this.unsubscribeDeleted = store.onDelete(id => {
      const active = this.active.get(id)
      if (active) { active.abort.abort(); clearTimeout(active.timer); this.active.delete(id) }
    })
  }
  create(owner: string, request: CreateTaskRequest): TaskSnapshot {
    this.assertStorageAvailable()
    if (utf8Size(JSON.stringify(request)) > (request.authoring?.schemaVersion === 2 ? CONTINUATION_POLICY.requestBytes : request.vision ? VISION_LIMITS.requestBytes : request.authoring ? AUTHORING_LIMITS.requestBytes : AI_LIMITS.requestBytes)) throw new TaskFault('request_limit', 413)
    if (request.vision) {
      if (this.connectionInfo.capabilities.vision !== 'enabled') throw new TaskFault('vision_disabled', 400)
      try { validateTaskVision(request.vision, request.context, request.authoring) } catch { throw new TaskFault('invalid_vision', 400) }
    }
    if (request.authoring) {
      if (utf8Size(JSON.stringify(request.authoring.project)) > AUTHORING_LIMITS.metadataBytes) throw new TaskFault('metadata_limit', 413)
      if (request.authoring.schemaVersion === 2) {
        if (!this.connectionInfo.capabilities.authoringVersions?.includes(2)
          || !this.connectionInfo.capabilities.budgetPolicyHashes?.includes(request.authoring.policy.policyHash)) throw new TaskFault('unsupported_authoring_version', 400)
        const preservation = request.authoring.source.preservation
        if (preservation.sceneId === null ? request.context !== null : !request.context || request.context.sceneId !== preservation.sceneId || request.context.revision !== preservation.revision) throw new TaskFault('authoring_context_mismatch', 400)
        // TaskStore performs the authoritative, timed source replay once, before checkpoint creation.
      } else {
        try { validateAuthoringStart(request.authoring) } catch { throw new TaskFault('invalid_authoring', 400) }
        if (!request.context || request.context.sceneId !== request.authoring.project.document.sceneId || request.context.revision !== request.authoring.project.document.revision) throw new TaskFault('authoring_context_mismatch', 400)
      }
    }
    const { task, created } = this.store.create(owner, request, this.maxConcurrent, this.connectionInfo.reasoningEffort ?? null)
    if (created) this.start(task)
    return task.snapshot
  }
  assertStorageAvailable() { if (this.unavailable) throw new TaskFault('storage_unavailable', 503) }
  onStorageUnavailable(callback: () => void) { this.unavailableListeners.add(callback); return () => { this.unavailableListeners.delete(callback) } }
  private markUnavailable() {
    this.unavailable = true
    for (const active of this.active.values()) { active.abort.abort(); clearTimeout(active.timer) }
    this.active.clear()
    for (const listener of [...this.unavailableListeners]) listener()
  }
  private current(id: string, generation: number): StoredTask {
    const task = this.store.read(id)
    if (task.snapshot.generation !== generation || task.snapshot.status !== 'running') throw aborted()
    if (!this.store.remaining(task)) throw new TaskFault('execution_limit')
    return task
  }
  private start(task: StoredTask) {
    const { id, generation } = task.snapshot
    const abort = new AbortController()
    const timer = setTimeout(() => {
      this.fail(id, generation, 'execution_limit')
      abort.abort()
    }, this.store.remaining(task))
    timer.unref?.()
    this.active.set(id, { generation, abort, timer })
    queueMicrotask(() => { void this.run(id, generation, abort.signal).finally(() => {
      const current = this.active.get(id)
      if (current?.generation === generation) { clearTimeout(current.timer); this.active.delete(id) }
    }) })
  }
  private change(id: string, generation: number, mutate: Parameters<TaskStore['change']>[2]) {
    this.current(id, generation)
    let discarded: StoredTask | undefined
    try {
      const result = this.store.change(id, generation, current => {
        try { return mutate(current) }
        catch (error) { if (current.authoring?.start.schemaVersion === 2) discarded = current; throw error }
      })
      if (!result) throw aborted()
      return result
    } catch (error) {
      if (discarded) {
        // A failed provider round publishes no partial draft/messages/receipts.
        // Actual executed work and a completed provider's usage are not refunded.
        const consumed = discarded
        try {
          this.store.change(id, generation, current => {
            current.toolAttempts = Math.max(current.toolAttempts, consumed.toolAttempts)
            current.outputBytes = Math.max(current.outputBytes, consumed.outputBytes)
            if (consumed.completedRequests > current.completedRequests) {
              current.completedRequests = consumed.completedRequests
              current.snapshot.usage = { ...consumed.snapshot.usage }
            }
            return []
          })
        } catch { this.markUnavailable(); throw new TaskFault('storage_unavailable', 503) }
      }
      throw error
    }
  }
  private fail(id: string, generation: number, code: string, requestState?: AiError['requestState']) {
    try {
      const task = this.store.read(id)
      if (task.snapshot.generation !== generation || task.snapshot.status !== 'running') return
      this.store.change(id, generation, current => {
        this.store.stopClock(current)
        current.snapshot.status = 'failed'
        current.snapshot.usage.unknown = current.snapshot.usage.unknown || current.completedRequests < current.snapshot.usage.requests
        current.snapshot.error = safeTaskError(code, requestState ?? (current.completedRequests < current.snapshot.usage.requests ? 'unknown'
          : current.authoring?.start.schemaVersion === 2 && current.snapshot.usage.requests > 0 ? 'finished' : 'not_sent'))
        return [{ type: 'error', data: current.snapshot.error }, { type: 'status', data: { status: 'failed', reason: current.snapshot.error.message } }]
      })
    } catch (error) {
      if (error instanceof TaskFault && error.code === 'not_found') return
      this.markUnavailable() /* Inaccessible storage is explicitly 503 until a controlled restart. */
    }
  }
  private async run(id: string, generation: number, signal: AbortSignal) {
    try {
      while (!signal.aborted) {
        // Waiting belongs to the existing execution clock, but is not a paid
        // attempt. Select tools and record the attempt only after the slot opens.
        let releaseRequest: (() => void) | undefined
        if (this.requestScheduler) releaseRequest = await this.requestScheduler.acquire(signal)
        try {
          const task = this.current(id, generation)
          const limits = this.store.limits(task)
          if (task.snapshot.usage.requests >= limits.modelRequests) throw new TaskFault('request_limit')
          const finalRoundReason = !task.authoring ? undefined
            : task.snapshot.usage.requests + 1 === limits.modelRequests ? 'request_limit'
            : this.store.remaining(task) <= Math.min(30_000, limits.executionMs / 10) + (this.requestScheduler?.cooldownMs ?? 0) ? 'execution_limit' : undefined
          const textOnlyFinalRound = finalRoundReason !== undefined
          const requestTask = this.change(id, generation, current => {
            current.snapshot.usage.requests++; current.snapshot.usage.unknown = true; current.pendingText = ''
            if (this.preserveReasoning === 'disabled') for (const message of current.messages) delete message.reasoningContent
            if (textOnlyFinalRound) current.messages.push({ role: 'system', content: `${finalRoundReason === 'execution_limit'
              ? 'This is the final request before the task execution time limit.' : 'This is the final request in this task request budget.'} No tools are available. End with a concise, honest account of the validated draft and unmet requirements. Report only checks already completed; explicitly label incomplete or unverified requirements and any partial draft. Do not invent successful checks, visual review or adoption. Any generated draft still requires browser resource checks, host review and protected adoption; no main project has been changed or adopted. Finishing this response does not mean every requested scene requirement passed.` })
            return []
          })
          const messages = this.preserveReasoning === 'enabled' ? requestTask.messages : requestTask.messages.map(({ reasoningContent: _privateReasoning, ...message }) => message)
          let streamed = ''
          const completion = await this.provider.complete({ messages, reasoningEffort: requestTask.snapshot.reasoningEffort, tools: textOnlyFinalRound ? [] : task.authoring ? getAuthoringTools(task.authoring.start.scope, task.authoring.start.schemaVersion) : [tool], maxOutputTokens: task.authoring ? this.authoringOutputTokens : AI_LIMITS.maxOutputTokensPerRequest, signal,
            onText: text => {
              if (signal.aborted) throw aborted()
              if (!text) return
              // The public event schema has an 8192-character bound; do not execute or interpret streamed text.
              for (let offset = 0; offset < text.length; offset += 8192) {
                const part = text.slice(offset, offset + 8192)
                this.change(id, generation, current => {
                  const bytes = utf8Size(part)
                  if (current.authoring?.start.schemaVersion === 2) {
                    current.outputBytes += bytes
                    if (current.snapshot.lastSequence >= AI_LIMITS.events - 4) throw new TaskFault('event_limit')
                    if (current.outputBytes > AI_LIMITS.outputBytes) throw new TaskFault('output_limit')
                  } else {
                    if (current.snapshot.lastSequence >= AI_LIMITS.events - 4) throw new TaskFault('event_limit')
                    if (current.outputBytes + bytes > AI_LIMITS.outputBytes) throw new TaskFault('output_limit')
                    current.outputBytes += bytes
                  }
                  current.snapshot.text += part; current.pendingText += part
                  return [{ type: 'text_delta', data: { text: part } }]
                })
                streamed += part
              }
            } }).finally(() => { releaseRequest?.(); releaseRequest = undefined })
          if (signal.aborted) throw aborted()
          this.current(id, generation)
          const reasoningContent = this.preserveReasoning === 'enabled' ? completion.reasoningContent : undefined
          if (reasoningContent !== undefined) {
            if (typeof reasoningContent !== 'string') throw new ProviderFailure('provider_protocol', '模型服务返回了不完整或不支持的响应。')
            if (utf8Size(reasoningContent) > PROVIDER_REASONING_BYTES) throw new ProviderFailure('provider_limit', '模型服务响应超过允许的大小。')
          }
          if (completion.text !== streamed) throw new ProviderFailure('provider_protocol', 'Inconsistent streamed completion')
          if (completion.toolCalls.length ? completion.finishReason !== 'tool_calls' : completion.finishReason !== 'stop') throw new ProviderFailure('provider_protocol', 'Invalid completion end')
          if (new Set(completion.toolCalls.map(call => call.id)).size !== completion.toolCalls.length) throw new ProviderFailure('provider_protocol', 'Duplicate call identity')
          // Only pure read tools exist in M2-1. Commit the whole assistant/tool round and receipts together.
          // A restart can therefore observe either the previous complete conversation or this complete round.
          this.change(id, generation, current => {
            const input = completion.usage.inputTokens, output = completion.usage.outputTokens
            current.completedRequests++
            const priorKnown = current.completedRequests === current.snapshot.usage.requests && (current.snapshot.usage.requests === 1 || current.snapshot.usage.inputTokens !== null && current.snapshot.usage.outputTokens !== null)
            current.snapshot.usage.inputTokens = priorKnown && input !== null ? (current.snapshot.usage.inputTokens ?? 0) + input : null
            current.snapshot.usage.outputTokens = priorKnown && output !== null ? (current.snapshot.usage.outputTokens ?? 0) + output : null
            current.snapshot.usage.unknown = current.snapshot.usage.inputTokens === null || current.snapshot.usage.outputTokens === null
            current.pendingText = ''
            current.messages.push({ role: 'assistant', content: completion.text || null, ...(completion.toolCalls.length ? { toolCalls: completion.toolCalls } : {}), ...(reasoningContent !== undefined ? { reasoningContent } : {}) })
            const events: EventInput[] = [{ type: 'usage', data: current.snapshot.usage }]
            // A provider ignoring the last-round tool boundary cannot mutate the
            // draft. Keep its completed usage receipt, then fail without retry.
            if (textOnlyFinalRound && completion.toolCalls.length) {
              this.store.stopClock(current)
              current.snapshot.status = 'failed'; current.snapshot.error = safeTaskError(finalRoundReason!, 'finished')
              events.push({ type: 'error', data: current.snapshot.error }, { type: 'status', data: { status: 'failed', reason: current.snapshot.error.message } })
              return events
            }
            for (const call of completion.toolCalls) events.push(...this.executeTool(current, call))
            if (!completion.toolCalls.length) {
              this.store.stopClock(current)
              if (current.authoring && current.authoring.state.contentHash !== current.authoring.start.baseContentHash) {
                checkAuthoringDraft(current.authoring.start, current.authoring.state)
                current.snapshot.status = 'waiting_browser'
              } else current.snapshot.status = 'completed'
              events.push({ type: 'status', data: { status: current.snapshot.status, reason: current.snapshot.status === 'waiting_browser' ? '草稿已生成，等待本机资源检查。' : null } })
            }
            if (current.snapshot.lastSequence + events.length > AI_LIMITS.events - (completion.toolCalls.length ? 2 : 0)) throw new TaskFault('event_limit')
            return events
          })
          if (textOnlyFinalRound && completion.toolCalls.length) return
          if (!completion.toolCalls.length) return
        } finally { releaseRequest?.() }
      }
    } catch (error) {
      if (signal.aborted || error instanceof Error && error.name === 'AbortError') return
      const code = error instanceof TaskFault ? error.code : error instanceof ProviderFailure && /^[a-z_]{1,64}$/.test(error.code) ? error.code : 'provider_error'
      this.fail(id, generation, code, error instanceof ProviderFailure ? error.requestState
        : error instanceof TaskFault && error.code === 'request_limit' ? 'finished' : undefined)
      this.active.get(id)?.abort.abort()
    }
  }
  private executeTool(task: StoredTask, call: ProviderToolCall): EventInput[] {
    if (!validId.test(call.id) || !validId.test(call.name) || utf8Size(call.arguments) > AI_LIMITS.promptBytes) throw new ProviderFailure('provider_protocol', 'Invalid tool call')
    const signature = JSON.stringify([call.name, call.arguments])
    const cached = Object.hasOwn(task.calls, call.id) ? task.calls[call.id] : undefined
    if (cached && cached.signature !== signature) throw new ProviderFailure('provider_protocol', 'Tool identity was reused')
    if (task.toolAttempts >= this.store.limits(task).toolCalls) throw new TaskFault('tool_limit')
    const reserved = task.authoring?.start.schemaVersion === 2
    if (reserved) task.toolAttempts++
    if (cached) {
      if (reserved) {
        task.outputBytes += utf8Size(call.arguments) + utf8Size(cached.output)
        if (task.outputBytes > AI_LIMITS.outputBytes) throw new TaskFault('output_limit')
      } else task.toolAttempts++
      task.messages.push({ role: 'tool', toolCallId: call.id, content: cached.output })
      return []
    }
    let result: ToolResult
    let args: unknown
    try { args = JSON.parse(call.arguments) } catch { args = undefined }
    const draftBefore = task.authoring?.state.draftRevision
    if (task.authoring) result = executeAuthoringTool(task, call, args, new StaticSvgArtifacts(this.store.artifacts), {
      modelRequests: this.store.limits(task).modelRequests, toolCalls: this.store.limits(task).toolCalls, executionRemainingMs: this.store.remaining(task),
      maxOutputTokens: this.authoringOutputTokens, attemptReserved: reserved,
    })
    else if (call.name !== tool.name) result = { callId: call.id, name: call.name, success: false, output: JSON.stringify({ error: { code: 'unsupported_tool', message: '本任务未开放此工具。' } }) }
    else if (!connectionArguments.safeParse(args).success) result = { callId: call.id, name: call.name, success: false, output: JSON.stringify({ error: { code: 'invalid_arguments', message: '工具参数不符合严格协议。' } }) }
    else result = { callId: call.id, name: call.name, success: true, output: JSON.stringify(this.connectionInfo) }
      if (!reserved && task.snapshot.lastSequence >= AI_LIMITS.events - 5) throw new TaskFault('event_limit')
      const bytes = utf8Size(call.arguments) + utf8Size(result.output)
      if (reserved) {
        task.outputBytes += bytes
        if (task.snapshot.lastSequence >= AI_LIMITS.events - 5) throw new TaskFault('event_limit')
        if (task.outputBytes > AI_LIMITS.outputBytes) throw new TaskFault('output_limit')
      } else {
        if (task.outputBytes + bytes > AI_LIMITS.outputBytes) throw new TaskFault('output_limit')
        task.outputBytes += bytes; task.toolAttempts++
      }
      Object.defineProperty(task.calls, call.id, { value: { signature, output: result.output, success: result.success }, enumerable: true, writable: true, configurable: true })
      task.snapshot.tools.push(result)
      task.messages.push({ role: 'tool', toolCallId: call.id, content: result.output })
      const events: EventInput[] = [{ type: 'tool_started', data: { callId: call.id, name: call.name } }, { type: 'tool_result', data: result }]
      if (task.authoring && (task.authoring.state.draftRevision !== draftBefore || result.success && call.name === 'sceneweave_plan_draft')) events.push({ type: 'draft_updated', data: updateAuthoringSummary(task) })
      return events
  }
  control(owner: string, id: string, request: ControlTaskRequest): TaskSnapshot {
    this.assertStorageAvailable()
    if (utf8Size(JSON.stringify(request)) > (request.vision ? VISION_LIMITS.requestBytes : AI_LIMITS.requestBytes)) throw new TaskFault('request_limit', 413)
    const task = this.store.read(id, owner)
    if (task.snapshot.generation !== request.expectedGeneration) throw new TaskFault('generation_conflict')
    if ((request.prompt !== undefined || request.vision !== undefined) && request.action !== 'resume') throw new TaskFault('invalid_control', 400)
    const status = task.snapshot.status
    if (request.action === 'resume' ? status !== 'paused' : !['running', 'paused', 'waiting_browser', 'ready'].includes(status)) throw new TaskFault('invalid_task_state')
    if (request.action === 'pause' && status === 'paused') return task.snapshot
    if (request.action === 'resume') this.store.assertCanResume(task, this.maxConcurrent)
    if (request.vision) {
      if (this.connectionInfo.capabilities.vision !== 'enabled') throw new TaskFault('vision_disabled', 400)
      if (task.messages.reduce((sum, message) => sum + (message.images?.length ?? 0), 0) >= VISION_LIMITS.imagesPerTask) throw new TaskFault('vision_limit', 413)
      try { validateTaskVision(request.vision, task.snapshot.context, task.authoring?.start, task.authoring?.state) } catch { throw new TaskFault('invalid_vision', 400) }
    }
    const interrupted = this.active.get(id)
    const updated = this.store.change(id, request.expectedGeneration, current => {
      this.store.stopClock(current)
      current.snapshot.generation++
      current.snapshot.status = request.action === 'resume' ? 'running' : request.action === 'pause' ? 'paused' : 'cancelled'
      if (request.action === 'resume') {
        current.runStartedAt = this.now(); current.snapshot.error = null
        current.messages.push({ role: 'user', content: request.prompt ?? '明确继续上一任务；不要假定中断请求已经完成。', ...(request.vision ? { images: [request.vision] } : {}) })
      } else if (status === 'running') {
        current.snapshot.usage.unknown = true
        current.snapshot.error = safeTaskError('request_interrupted')
        if (current.pendingText) { current.messages.push({ role: 'assistant', content: current.pendingText }); current.pendingText = '' }
        // A partial assistant response is visible in the checkpoint, never replayed as an uncompleted tool call.
        current.messages.push({ role: 'system', content: 'The preceding generation was interrupted. Its request outcome is unknown. Continue only after an explicit user resume; do not assume any incomplete tool call was executed.' })
      }
      return [{ type: 'status', data: { status: current.snapshot.status, reason: request.action === 'resume' ? null : '执行已中止；已保留当前进度。' } }]
    })!
    interrupted?.abort.abort(); if (interrupted) clearTimeout(interrupted.timer)
    this.active.delete(id)
    if (request.action === 'resume') this.start(updated)
    return updated.snapshot
  }
  delete(owner: string, id: string) {
    if (this.store.read(id, owner).snapshot.status === 'applying') throw new TaskFault('adoption_in_progress')
    const active = this.active.get(id)
    active?.abort.abort(); if (active) clearTimeout(active.timer)
    this.active.delete(id)
    this.store.delete(id, owner)
  }
  draft(owner: string, id: string): AuthoringDraft {
    this.assertStorageAvailable()
    const task = this.store.read(id, owner)
    if (!task.authoring) throw new TaskFault('draft_not_found', 404)
    return AuthoringDraftSchema.parse({ schemaVersion: task.authoring.start.schemaVersion, taskId: id, generation: task.snapshot.generation, start: task.authoring.start, state: task.authoring.state })
  }
  regionSceneCandidate(owner: string, id: string, query: RegionSceneCandidateQuery) {
    this.assertStorageAvailable()
    const task = this.store.read(id, owner), authoring = task.authoring, candidate = authoring?.regionSceneCandidate
    if (!candidate) throw new TaskFault('not_found', 404)
    const scope = authoring.start.scope.scene
    if (!scope) throw new TaskFault('candidate_conflict')
    const scopeHash = sha256Text(canonicalJson(scope))
    if (candidate.id !== query.candidateId || candidate.hash !== query.candidateHash || candidate.atContentHash !== query.atContentHash
      || candidate.atDraftRevision !== query.draftRevision || candidate.scopeHash !== query.scopeHash || candidate.hash !== candidate.result.hash
      || authoring.state.contentHash !== query.atContentHash || authoring.state.draftRevision !== query.draftRevision || scopeHash !== candidate.scopeHash) throw new TaskFault('candidate_conflict')
    const response = RegionSceneCandidateResponseSchema.parse({ schemaVersion: 1, taskId: id, generation: task.snapshot.generation,
      candidateId: candidate.id, candidateHash: candidate.hash, atContentHash: candidate.atContentHash, draftRevision: authoring.state.draftRevision, scopeHash,
      scope, result: candidate.result })
    if (utf8Size(JSON.stringify(response)) > REGION_CANDIDATE_MAX_BYTES) throw new TaskFault('candidate_limit', 413)
    return response
  }
  private stamped(owner: string, id: string, stamp: DraftStamp) {
    this.assertStorageAvailable()
    const task = this.store.read(id, owner)
    if (!task.authoring) throw new TaskFault('draft_not_found', 404)
    if (task.snapshot.generation !== stamp.expectedGeneration) throw new TaskFault('generation_conflict')
    const expected = authoringDraftStamp(task.authoring.state, task.snapshot.generation)
    if (Object.entries(expected).some(([key, value]) => (stamp as unknown as Record<string, unknown>)[key] !== value)) throw new TaskFault('draft_conflict')
    if (task.authoring.state.schemaVersion === 1 && 'schemaVersion' in stamp) throw new TaskFault('draft_conflict')
    return task
  }
  validateDraft(owner: string, id: string, request: DraftStamp & { valid: boolean }): TaskSnapshot {
    const task = this.stamped(owner, id, request)
    if (!['waiting_browser', 'paused', 'failed'].includes(task.snapshot.status) || !task.authoring!.state.draftRevision || task.authoring!.claim) throw new TaskFault('invalid_task_state')
    return this.store.change(id, request.expectedGeneration, current => {
      if (request.valid) { checkAuthoringDraft(current.authoring!.start, current.authoring!.state); current.snapshot.status = 'ready'; current.snapshot.error = null }
      else { current.snapshot.status = 'paused'; current.snapshot.error = safeTaskError('browser_validation_failed', 'finished') }
      return [{ type: 'status', data: { status: current.snapshot.status, reason: request.valid ? '草稿已完成本机检查，等待审阅采用。' : '本机资源检查失败，已保留草稿。' } }]
    })!.snapshot
  }
  claimDraft(owner: string, id: string, request: DraftClaim): DraftLease {
    const task = this.stamped(owner, id, request), claim = task.authoring!.claim
    if (claim) {
      if (claim.lease.claimId !== request.claimId) throw new TaskFault('claim_conflict')
      if (task.snapshot.status === 'applying' && claim.lease.expiresAt > this.now()) return claim.lease
      throw new TaskFault('lease_expired')
    }
    if (task.snapshot.status !== 'ready') throw new TaskFault('invalid_task_state')
    const now = this.now(), lease = DraftLeaseSchema.parse({ schemaVersion: task.authoring!.state.schemaVersion, taskId: id, generation: request.expectedGeneration,
      draftRevision: request.draftRevision, contentHash: request.contentHash, claimId: request.claimId, serverNow: now, expiresAt: now + AUTHORING_LIMITS.claimMs,
      ...authoringBudgetIdentity(task.authoring!.state) })
    this.store.change(id, request.expectedGeneration, current => {
      current.authoring!.claim = { lease }; current.snapshot.status = 'applying'; updateAuthoringSummary(current)
      return [{ type: 'status', data: { status: 'applying', reason: '本机正在采用已审阅草稿。' } }]
    })
    return lease
  }
  releaseDraft(owner: string, id: string, request: DraftClaim): TaskSnapshot {
    const task = this.stamped(owner, id, request), claim = task.authoring!.claim
    if (!claim || claim.lease.claimId !== request.claimId || claim.appliedRevision !== undefined) throw new TaskFault('claim_conflict')
    if (!['applying', 'paused'].includes(task.snapshot.status)) throw new TaskFault('invalid_task_state')
    return this.store.change(id, request.expectedGeneration, current => {
      const expired = claim.lease.expiresAt <= this.now() || current.snapshot.status === 'paused'
      delete current.authoring!.claim; current.snapshot.status = expired ? 'paused' : 'ready'; updateAuthoringSummary(current)
      return [{ type: 'status', data: { status: current.snapshot.status, reason: '本机未采用草稿；采用租约已释放。' } }]
    })!.snapshot
  }
  appliedDraft(owner: string, id: string, request: DraftClaim & { sceneId: string; revision: number }): TaskSnapshot {
    const task = this.stamped(owner, id, request), claim = task.authoring!.claim, document = task.authoring!.start.project.document
    if (!claim || claim.lease.claimId !== request.claimId || request.sceneId !== document.sceneId || request.revision !== document.revision + 1) throw new TaskFault('claim_conflict')
    if (claim.appliedRevision !== undefined) { if (claim.appliedRevision !== request.revision) throw new TaskFault('claim_conflict'); return task.snapshot }
    if (!['applying', 'paused'].includes(task.snapshot.status)) throw new TaskFault('invalid_task_state')
    return this.store.change(id, request.expectedGeneration, current => {
      current.authoring!.claim!.appliedRevision = request.revision; current.snapshot.status = 'applied'; current.snapshot.error = null
      return [{ type: 'status', data: { status: 'applied', reason: '本机已确认采用；主工程由本机保存。' } }]
    })!.snapshot
  }
  close() {
    for (const [id, active] of this.active) {
      try { const task = this.store.read(id); if (task.snapshot.status === 'running') this.control(task.owner, id, { schemaVersion: 1, action: 'pause', expectedGeneration: active.generation }) } catch { active.abort.abort(); clearTimeout(active.timer) }
      finally { active.abort.abort(); clearTimeout(active.timer) }
    }
    this.active.clear()
    this.unsubscribeDeleted()
    this.unavailable = true
    for (const listener of [...this.unavailableListeners]) listener()
    this.unavailableListeners.clear()
  }
}
