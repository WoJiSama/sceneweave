import { z } from 'zod'
import { AI_LIMITS, utf8Size } from '../../src/shared/ai/protocol.js'
import type { AiError, ConnectionInfo, ControlTaskRequest, CreateTaskRequest, TaskSnapshot, ToolResult } from '../../src/shared/ai/protocol.js'
import type { ProviderAdapter, ProviderToolCall, ProviderToolDefinition } from './provider-types.js'
import { ProviderFailure } from './provider-types.js'
import { TaskFault, TaskStore, safeTaskError } from './store.js'
import type { EventInput, StoredTask } from './store.js'
import { AUTHORING_LIMITS, AuthoringDraftSchema } from '../../src/shared/ai/authoring-protocol.js'
import type { AuthoringDraft, DraftClaim, DraftLease, DraftStamp } from '../../src/shared/ai/authoring-protocol.js'
import { validateAuthoringStart, checkAuthoringDraft } from '../../src/shared/ai/authoring.js'
import { StaticSvgArtifacts } from './svg-artifacts.js'
import { authoringTools, executeAuthoringTool, updateAuthoringSummary } from './authoring-tools.js'

const connectionArguments = z.object({ topic: z.literal('connection') }).strict()
const tool: ProviderToolDefinition = { name: 'sceneweave_connection_info', description: 'Read this Sceneweave connection and its actual supported capabilities. This does not read or change any scene.', parameters: { type: 'object', properties: { topic: { type: 'string', enum: ['connection'] } }, required: ['topic'], additionalProperties: false } }
const validId = /^[A-Za-z0-9_.:-]{1,128}$/
const aborted = () => new DOMException('Execution interrupted', 'AbortError')

export class TaskEngine {
  private active = new Map<string, { generation: number; abort: AbortController; timer: ReturnType<typeof setTimeout> }>()
  private readonly now: () => number
  private readonly maxConcurrent: number
  private unavailable = false
  private unavailableListeners = new Set<() => void>()
  constructor(readonly store: TaskStore, private readonly provider: ProviderAdapter, readonly connectionInfo: ConnectionInfo, options: { now?: () => number; maxConcurrent?: number } = {}) {
    this.now = options.now ?? Date.now
    this.maxConcurrent = options.maxConcurrent ?? 4
  }
  create(owner: string, request: CreateTaskRequest): TaskSnapshot {
    this.assertStorageAvailable()
    if (request.authoring) {
      if (utf8Size(JSON.stringify(request.authoring.project)) > AUTHORING_LIMITS.metadataBytes) throw new TaskFault('metadata_limit', 413)
      try { validateAuthoringStart(request.authoring) } catch { throw new TaskFault('invalid_authoring', 400) }
      if (!request.context || request.context.sceneId !== request.authoring.project.document.sceneId || request.context.revision !== request.authoring.project.document.revision) throw new TaskFault('authoring_context_mismatch', 400)
    }
    const { task, created } = this.store.create(owner, request, this.maxConcurrent)
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
    const result = this.store.change(id, generation, mutate)
    if (!result) throw aborted()
    return result
  }
  private fail(id: string, generation: number, code: string, requestState: AiError['requestState'] = 'unknown') {
    try {
      const task = this.store.read(id)
      if (task.snapshot.generation !== generation || task.snapshot.status !== 'running') return
      this.store.change(id, generation, current => {
        this.store.stopClock(current)
        current.snapshot.status = 'failed'
        current.snapshot.usage.unknown = current.snapshot.usage.unknown || current.completedRequests < current.snapshot.usage.requests
        current.snapshot.error = safeTaskError(code, requestState)
        return [{ type: 'error', data: current.snapshot.error }, { type: 'status', data: { status: 'failed', reason: current.snapshot.error.message } }]
      })
    } catch { this.markUnavailable() /* Inaccessible storage is explicitly 503 until a controlled restart. */ }
  }
  private async run(id: string, generation: number, signal: AbortSignal) {
    try {
      while (!signal.aborted) {
        const task = this.current(id, generation)
        if (task.snapshot.usage.requests >= this.store.limits(task).modelRequests) throw new TaskFault('request_limit')
        this.change(id, generation, current => { current.snapshot.usage.requests++; current.snapshot.usage.unknown = true; current.pendingText = ''; return [] })
        let streamed = ''
        const completion = await this.provider.complete({ messages: task.messages, tools: task.authoring ? authoringTools : [tool], maxOutputTokens: AI_LIMITS.maxOutputTokensPerRequest, signal,
          onText: text => {
            if (signal.aborted) throw aborted()
            if (!text) return
            // The public event schema has an 8192-character bound; do not execute or interpret streamed text.
            for (let offset = 0; offset < text.length; offset += 8192) {
              const part = text.slice(offset, offset + 8192)
              this.change(id, generation, current => {
                if (current.snapshot.lastSequence >= AI_LIMITS.events - 4) throw new TaskFault('event_limit')
                const bytes = utf8Size(part)
                if (current.outputBytes + bytes > AI_LIMITS.outputBytes) throw new TaskFault('output_limit')
                current.outputBytes += bytes; current.snapshot.text += part; current.pendingText += part
                return [{ type: 'text_delta', data: { text: part } }]
              })
              streamed += part
            }
          } })
        if (signal.aborted) throw aborted()
        this.current(id, generation)
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
          current.messages.push({ role: 'assistant', content: completion.text || null, ...(completion.toolCalls.length ? { toolCalls: completion.toolCalls } : {}) })
          const events: EventInput[] = [{ type: 'usage', data: current.snapshot.usage }]
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
        if (!completion.toolCalls.length) return
      }
    } catch (error) {
      if (signal.aborted || error instanceof Error && error.name === 'AbortError') return
      const code = error instanceof TaskFault ? error.code : error instanceof ProviderFailure && /^[a-z_]{1,64}$/.test(error.code) ? error.code : 'provider_error'
      this.fail(id, generation, code, error instanceof ProviderFailure ? error.requestState : 'unknown')
      this.active.get(id)?.abort.abort()
    }
  }
  private executeTool(task: StoredTask, call: ProviderToolCall): EventInput[] {
    if (!validId.test(call.id) || !validId.test(call.name) || utf8Size(call.arguments) > AI_LIMITS.promptBytes) throw new ProviderFailure('provider_protocol', 'Invalid tool call')
    const signature = JSON.stringify([call.name, call.arguments])
    const cached = Object.hasOwn(task.calls, call.id) ? task.calls[call.id] : undefined
    if (cached && cached.signature !== signature) throw new ProviderFailure('provider_protocol', 'Tool identity was reused')
    if (task.toolAttempts >= this.store.limits(task).toolCalls) throw new TaskFault('tool_limit')
    if (cached) {
      task.toolAttempts++; task.messages.push({ role: 'tool', toolCallId: call.id, content: cached.output })
      return []
    }
    let result: ToolResult
    let args: unknown
    try { args = JSON.parse(call.arguments) } catch { args = undefined }
    const draftBefore = task.authoring?.state.draftRevision
    if (task.authoring) result = executeAuthoringTool(task, call, args, new StaticSvgArtifacts(this.store.artifacts))
    else if (call.name !== tool.name) result = { callId: call.id, name: call.name, success: false, output: JSON.stringify({ error: { code: 'unsupported_tool', message: '本任务未开放此工具。' } }) }
    else if (!connectionArguments.safeParse(args).success) result = { callId: call.id, name: call.name, success: false, output: JSON.stringify({ error: { code: 'invalid_arguments', message: '工具参数不符合严格协议。' } }) }
    else result = { callId: call.id, name: call.name, success: true, output: JSON.stringify(this.connectionInfo) }
      if (task.snapshot.lastSequence >= AI_LIMITS.events - 5) throw new TaskFault('event_limit')
      const bytes = utf8Size(call.arguments) + utf8Size(result.output)
      if (task.outputBytes + bytes > AI_LIMITS.outputBytes) throw new TaskFault('output_limit')
      task.outputBytes += bytes; task.toolAttempts++
      Object.defineProperty(task.calls, call.id, { value: { signature, output: result.output, success: result.success }, enumerable: true, writable: true, configurable: true })
      task.snapshot.tools.push(result)
      task.messages.push({ role: 'tool', toolCallId: call.id, content: result.output })
      const events: EventInput[] = [{ type: 'tool_started', data: { callId: call.id, name: call.name } }, { type: 'tool_result', data: result }]
      if (task.authoring && task.authoring.state.draftRevision !== draftBefore) events.push({ type: 'draft_updated', data: updateAuthoringSummary(task) })
      return events
  }
  control(owner: string, id: string, request: ControlTaskRequest): TaskSnapshot {
    this.assertStorageAvailable()
    const task = this.store.read(id, owner)
    if (task.snapshot.generation !== request.expectedGeneration) throw new TaskFault('generation_conflict')
    if (request.prompt !== undefined && request.action !== 'resume') throw new TaskFault('invalid_control', 400)
    const status = task.snapshot.status
    if (request.action === 'resume' ? status !== 'paused' : !['running', 'paused', 'waiting_browser', 'ready'].includes(status)) throw new TaskFault('invalid_task_state')
    if (request.action === 'pause' && status === 'paused') return task.snapshot
    if (request.action === 'resume') this.store.assertCanResume(task, this.maxConcurrent)
    const interrupted = this.active.get(id)
    const updated = this.store.change(id, request.expectedGeneration, current => {
      this.store.stopClock(current)
      current.snapshot.generation++
      current.snapshot.status = request.action === 'resume' ? 'running' : request.action === 'pause' ? 'paused' : 'cancelled'
      if (request.action === 'resume') {
        current.runStartedAt = this.now(); current.snapshot.error = null
        current.messages.push({ role: 'user', content: request.prompt ?? '明确继续上一任务；不要假定中断请求已经完成。' })
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
    return AuthoringDraftSchema.parse({ schemaVersion: 1, taskId: id, generation: task.snapshot.generation, start: task.authoring.start, state: task.authoring.state })
  }
  private stamped(owner: string, id: string, stamp: DraftStamp) {
    this.assertStorageAvailable()
    const task = this.store.read(id, owner)
    if (!task.authoring) throw new TaskFault('draft_not_found', 404)
    if (task.snapshot.generation !== stamp.expectedGeneration) throw new TaskFault('generation_conflict')
    if (task.authoring.state.draftRevision !== stamp.draftRevision || task.authoring.state.contentHash !== stamp.contentHash) throw new TaskFault('draft_conflict')
    return task
  }
  validateDraft(owner: string, id: string, request: DraftStamp & { valid: boolean }): TaskSnapshot {
    const task = this.stamped(owner, id, request)
    if (!['waiting_browser', 'paused'].includes(task.snapshot.status) || !task.authoring!.state.draftRevision || task.authoring!.claim) throw new TaskFault('invalid_task_state')
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
    const now = this.now(), lease: DraftLease = { schemaVersion: 1, taskId: id, generation: request.expectedGeneration,
      draftRevision: request.draftRevision, contentHash: request.contentHash, claimId: request.claimId, serverNow: now, expiresAt: now + AUTHORING_LIMITS.claimMs }
    this.store.change(id, request.expectedGeneration, current => {
      current.authoring!.claim = { lease }; current.snapshot.status = 'applying'; updateAuthoringSummary(current)
      return [{ type: 'status', data: { status: 'applying', reason: '本机正在采用已审阅草稿。' } }]
    })
    return lease
  }
  releaseDraft(owner: string, id: string, request: DraftClaim): TaskSnapshot {
    const task = this.stamped(owner, id, request), claim = task.authoring!.claim
    if (!claim || claim.lease.claimId !== request.claimId || claim.appliedRevision !== undefined) throw new TaskFault('claim_conflict')
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
    this.unavailable = true
    for (const listener of [...this.unavailableListeners]) listener()
    this.unavailableListeners.clear()
  }
}
