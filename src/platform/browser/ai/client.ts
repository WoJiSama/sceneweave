import { z } from 'zod'
import { VISION_LIMITS } from '../../../shared/ai/vision.js'
import {
  AI_LIMITS, AiErrorSchema, ConnectionInfoSchema, ControlTaskSchema, CreateTaskSchema,
  TaskEventSchema, TaskSnapshotSchema, isTerminalTask, utf8Size,
  type ConnectionInfo, type ControlTaskRequest, type CreateTaskRequest, type TaskEvent, type TaskSnapshot,
} from '../../../shared/ai/protocol'

import { AUTHORING_LIMITS, CONTINUATION_POLICY, AuthoringDraftSchema, DraftValidationSchema, DraftClaimSchema, DraftLeaseSchema, DraftAppliedSchema, type DraftClaim, type DraftStamp, type BudgetIdentity } from '../../../shared/ai/authoring-protocol'
import { RegionSceneCandidateQuerySchema, RegionSceneCandidateResponseSchema, type RegionSceneCandidateQuery } from '../../../shared/ai/region-candidate-protocol'
import { canonicalJson } from '../../../shared/validation/json'
import { sha256Text } from '../../../shared/validation/hash'

const MAX_JSON_BYTES = 1024 * 1024
export function supportsContinuation(info: ConnectionInfo, kind: 'authoring' | 'baseMap'): boolean {
  return (kind === 'authoring' ? info.capabilities.sceneDraft && info.capabilities.authoringVersions?.includes(2) : info.capabilities.baseMapVersions?.includes(2)) === true
    && info.capabilities.budgetPolicyHashes?.includes(CONTINUATION_POLICY.policyHash) === true
}
/** A v2 response cannot silently drop or replace any part of the budget identity. */
export function continuationIdentity(value: unknown): (BudgetIdentity & { schemaVersion: 2 }) | null {
  return value && typeof value === 'object' && 'schemaVersion' in value && value.schemaVersion === 2 ? value as BudgetIdentity & { schemaVersion: 2 } : null
}
export function sameBudgetIdentity(expected: unknown, actual: unknown): boolean {
  const before = continuationIdentity(expected), after = continuationIdentity(actual)
  return before ? !!after && before.policyHash === after.policyHash && before.sourceHash === after.sourceHash
    && before.ledgerHeadHash === after.ledgerHeadHash && before.budgetStateHash === after.budgetStateHash : !after
}
const stopped = (value: TaskSnapshot) => isTerminalTask(value.status) || value.status === 'paused'
const listSchema = z.object({ schemaVersion: z.literal(1), tasks: z.array(TaskSnapshotSchema).max(20) }).strict()
const faultSchema = z.object({ schemaVersion: z.literal(1), error: AiErrorSchema }).strict()
const safeErrors: Record<string, string> = {
  snapshot_required: '事件检查点已变化，正在重新读取完整任务。',
  task_list_limit: '最近任务的完整记录总量超过读取上限。请使用任务 ID 只读查询单个任务。',
  generation_conflict: '任务状态已变化，请刷新后再操作。',
  service_restarted: '服务已重启，上一模型请求结果未知；继续可能产生新的费用。',
  provider_configuration: '后端模型配置不可用，请检查服务器配置。',
  execution_limit: '任务执行时间已达上限，已保留最后进度。',
  model_request_limit: '任务已达到模型请求次数上限。',
  tool_limit: '任务已达到工具调用次数上限。',
  output_limit: '任务输出已达到上限。',
  vision_disabled: '此模型连接尚未启用图片输入；可移除截图，继续使用结构检查。',
  invalid_vision: '截图格式、公开授权范围或草稿基线不匹配，请重新生成当前玩家截图。',
  vision_limit: '本任务已达到四张截图上限，请使用结构诊断或新建明确范围的修正任务。',
}
export class AiClientError extends Error {
  constructor(public readonly code: string, message: string, public readonly requestState: 'not_sent' | 'unknown' | 'finished' = 'not_sent', public readonly status?: number) {
    super(message); this.name = 'AiClientError'
  }
}
export function safeAiError(error: unknown): string {
  return error instanceof AiClientError ? error.message : error instanceof DOMException && error.name === 'AbortError' ? '已停止本地连接。' : '连接未完成，请检查后端地址、应用凭据和网络后重试。'
}
export function describeTaskError(code: string): string { return safeErrors[code] ?? '任务未完成，服务器保留了可查询的进度。请检查连接或服务器配置。' }
export function normalizeAiBaseUrl(raw: string): string {
  if (!raw.trim()) throw new AiClientError('configuration', '请填写自有后端地址。')
  let url: URL
  try { url = new URL(raw.trim()) } catch { throw new AiClientError('configuration', '后端地址须为完整的 HTTPS 地址，或本机 HTTP 地址。') }
  const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]'
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new AiClientError('configuration', '后端地址只填写 HTTPS 域名和端口；本地开发可用 HTTP localhost、127.0.0.1 或 [::1]。请移除路径、凭据、查询和片段。')
  }
  return url.origin
}
function aborted(signal?: AbortSignal): void { if (signal?.aborted) throw new DOMException('Aborted', 'AbortError') }
async function boundedText(response: Response, signal?: AbortSignal, max = MAX_JSON_BYTES): Promise<string> {
  const reader = response.body?.getReader()
  if (!reader) throw new AiClientError('protocol', '后端返回了无法读取的响应。')
  const chunks: Uint8Array[] = []; let size = 0
  const cancel = () => { void reader.cancel().catch(() => undefined) }
  signal?.addEventListener('abort', cancel, { once: true })
  try {
    aborted(signal)
    for (;;) {
      const part = await reader.read(); aborted(signal)
      if (part.done) break
      size += part.value.byteLength
      if (size > max) throw new AiClientError('protocol', '后端响应超过允许大小。')
      chunks.push(part.value)
    }
    const bytes = new Uint8Array(size); let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } finally { signal?.removeEventListener('abort', cancel); await reader.cancel().catch(() => undefined); reader.releaseLock() }
}
function parseJson(text: string): unknown { try { return JSON.parse(text) } catch { throw new AiClientError('protocol', '后端返回格式不符合对话协议。') } }
function parseSchema<T>(schema: z.ZodType<T>, value: unknown): T { const result = schema.safeParse(value); if (!result.success) throw new AiClientError('protocol', '后端返回格式不符合对话协议。'); return result.data }
const statusError = (status: number) => status === 401 || status === 403 ? '后端拒绝访问，请检查应用凭据及允许的站点 Origin。' : status === 404 ? '未找到任务，可能已删除或超过七日保留期。' : status === 409 ? '任务状态或请求基线已变化，请刷新任务后重试。' : status === 413 || status === 429 ? '请求或服务预算已达上限，请缩小输入或稍后重试。' : status >= 500 ? '后端暂时不可用，请检查服务器和模型配置。' : '后端未接受本次操作，请检查输入和连接配置。'
export interface TaskSubscription {
  onSnapshot: (snapshot: TaskSnapshot) => void
  onEvent?: (event: TaskEvent) => void
  onConnection?: (state: 'connected' | 'reconnecting' | 'disconnected') => void
}
export function reduceTaskEvent(snapshot: TaskSnapshot, event: TaskEvent): TaskSnapshot {
  if (event.taskId !== snapshot.id || event.generation !== snapshot.generation || event.sequence !== snapshot.lastSequence + 1) throw new AiClientError('snapshot_required', safeErrors.snapshot_required)
  const next: TaskSnapshot = { ...snapshot, lastSequence: event.sequence }
  if (event.type === 'text_delta') next.text += event.data.text
  if (event.type === 'tool_result') next.tools = [...next.tools.filter(tool => tool.callId !== event.data.callId), event.data]
  if (event.type === 'draft_updated') next.authoring = event.data
  if (event.type === 'usage') next.usage = event.data
  if (event.type === 'authoring_checkpoint') {
    const previous = snapshot.authoring, execution = snapshot.executionCheckpoint, after = event.data.authoring
    if (!previous || !('schemaVersion' in previous) || previous.schemaVersion !== 2 || !execution
      || event.data.executionCheckpoint.flowId !== execution.flowId
      || after.policyHash !== execution.policyHash || after.sourceHash !== execution.sourceHash) throw new AiClientError('protocol', '实时接续检查点与原底图来源不匹配。')
    if (after.draftRevision < previous.draftRevision || after.budget.generationCost !== previous.budget.generationCost
      || after.budget.aiCost < previous.budget.aiCost || after.budget.complexityCost < previous.budget.complexityCost
      || execution.uncertain === true && event.data.executionCheckpoint.uncertain !== true
      || after.draftRevision === previous.draftRevision && (after.ledgerHeadHash !== previous.ledgerHeadHash || after.budgetStateHash !== previous.budgetStateHash)
      || (['activeRuntimeMs', 'initializationMs', 'modelRequests', 'completedRequests', 'toolAttempts', 'outputBytes'] as const).some(field => event.data.executionCheckpoint[field] < execution[field])) throw new AiClientError('protocol', '实时接续检查点的累计记录倒退或账本身份已改变。')
    next.authoring = event.data.authoring; next.usage = event.data.usage; next.executionCheckpoint = event.data.executionCheckpoint
  }
  if (event.type === 'error') next.error = event.data
  if (event.type === 'status') next.status = event.data.status
  return parseSchema(TaskSnapshotSchema, next)
}
/** A credential belongs only to this in-memory client. No storage, URL, telemetry or provider configuration is used. */
export class AiClient {
  readonly baseUrl: string
  readonly #token: string
  readonly #fetch: typeof fetch
  constructor(baseUrl: string, token: string, fetcher: typeof fetch = fetch) {
    this.baseUrl = normalizeAiBaseUrl(baseUrl)
    if (!token.trim() || token.length > 4096 || /[\r\n\x00-\x1f\x7f]/.test(token)) throw new AiClientError('configuration', '请输入有效的后端应用凭据；它与模型供应商密钥不同。')
    this.#token = token.trim(); this.#fetch = fetcher
  }
  async #request(path: string, method: 'GET' | 'POST' | 'DELETE', body?: unknown, signal?: AbortSignal): Promise<Response> {
    aborted(signal)
    let response: Response
    // Browser-native fetch requires its global receiver; a class field receiver is illegal.
    try { response = await this.#fetch.call(globalThis, `${this.baseUrl}/v1/${path}`, { method, headers: { Authorization: `Bearer ${this.#token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, credentials: 'omit', redirect: 'error', cache: 'no-store', signal }) }
    catch (error) { aborted(signal); if (error instanceof AiClientError) throw error; throw new AiClientError('network', '无法连接自有后端，请检查地址、网络和服务器允许的站点 Origin。', method === 'GET' ? 'not_sent' : 'unknown') }
    if (!response.ok) {
      let code = 'http_error', state: 'not_sent' | 'unknown' | 'finished' = method === 'GET' ? 'not_sent' : 'unknown'
      try { const parsed = faultSchema.safeParse(parseJson(await boundedText(response, signal, 4096))); if (parsed.success) { code = parsed.data.error.code; state = parsed.data.error.requestState } } catch { aborted(signal) }
      throw new AiClientError(code, safeErrors[code] ?? statusError(response.status), state, response.status)
    }
    return response
  }
  async #json<T>(path: string, schema: z.ZodType<T>, method: 'GET' | 'POST' = 'GET', body?: unknown, signal?: AbortSignal, max = MAX_JSON_BYTES): Promise<T> {
    signal = signal ? AbortSignal.any([signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000)
    const response = await this.#request(path, method, body, signal)
    try { return parseSchema(schema, parseJson(await boundedText(response, signal, max))) }
    catch (error) { aborted(signal); if (method === 'POST') throw new AiClientError('protocol', '服务器已接收请求，但响应尚未确认。请保留同一请求 ID 重试或刷新任务。', 'unknown'); throw error }
  }
  capabilities(signal?: AbortSignal): Promise<ConnectionInfo> { return this.#json('capabilities?authoringVersion=2', ConnectionInfoSchema, 'GET', undefined, signal) }
  async create(request: CreateTaskRequest, signal?: AbortSignal): Promise<TaskSnapshot> {
    const input = parseSchema(CreateTaskSchema, request)
    const authoring = input.authoring, continuation = authoring?.schemaVersion === 2
    if (utf8Size(JSON.stringify(input)) > (continuation ? CONTINUATION_POLICY.requestBytes : input.vision ? VISION_LIMITS.requestBytes : input.authoring ? AUTHORING_LIMITS.requestBytes : AI_LIMITS.requestBytes)) throw new AiClientError('request_limit', '请求超过允许大小，请缩小授权范围。')
    if (continuation && !supportsContinuation(await this.capabilities(signal), 'authoring')) throw new AiClientError('unsupported_continuation', '后端尚未支持本次程序底图接续策略，请升级后端；底图仍可独立采用。')
    const value = await this.#json('tasks', TaskSnapshotSchema, 'POST', input, signal, continuation ? AI_LIMITS.taskBytes : MAX_JSON_BYTES)
    if (value.clientRequestId !== input.clientRequestId || value.context?.sceneId !== input.context?.sceneId || value.context?.revision !== input.context?.revision) throw new AiClientError('protocol', '创建响应与本次请求不匹配，请保留同一请求 ID 重试。', 'unknown')
    const identity = continuationIdentity(value.authoring)
    if (continuation && (!identity || identity.policyHash !== authoring.policy.policyHash || identity.sourceHash !== sha256Text(canonicalJson(authoring.source)))) throw new AiClientError('protocol', '服务器未确认程序底图接续版本与来源，请保留同一请求并刷新任务。', 'unknown')
    return value
  }
  async snapshot(taskId: string, signal?: AbortSignal, version: 1 | 2 = 1): Promise<TaskSnapshot> {
    const value = await this.#json(`tasks/${encodeURIComponent(taskId)}`, TaskSnapshotSchema, 'GET', undefined, signal, version === 2 ? AI_LIMITS.taskBytes : MAX_JSON_BYTES)
    if (value.id !== taskId || !!continuationIdentity(value.authoring) !== (version === 2)) throw new AiClientError('protocol', '完整任务身份或接续版本不匹配，已停止连接。')
    return value
  }
  /** Explicit ID lookup can discover either strict version within one task's fixed byte cap. */
  async lookupSnapshot(taskId: string, signal?: AbortSignal): Promise<TaskSnapshot> {
    const value = await this.#json(`tasks/${encodeURIComponent(taskId)}`, TaskSnapshotSchema, 'GET', undefined, signal, AI_LIMITS.taskBytes)
    if (value.id !== taskId) throw new AiClientError('protocol', '完整任务身份不匹配，已停止显示。')
    return value
  }
  async list(sceneId: string | null, signal?: AbortSignal): Promise<TaskSnapshot[]> {
    const result = await this.#json(`tasks${sceneId === null ? '' : `?sceneId=${encodeURIComponent(sceneId)}`}`, listSchema, 'GET', undefined, signal, 16 * 1024 * 1024)
    if (sceneId !== null && result.tasks.some(value => value.context?.sceneId !== sceneId)) throw new AiClientError('protocol', '任务列表包含其他工程，已停止显示。')
    return result.tasks
  }
  async control(taskId: string, request: ControlTaskRequest, signal?: AbortSignal, version: 1 | 2 = 1): Promise<TaskSnapshot> {
    const input = parseSchema(ControlTaskSchema, request)
    if (utf8Size(JSON.stringify(input)) > (input.vision ? VISION_LIMITS.requestBytes : AI_LIMITS.requestBytes)) throw new AiClientError('request_limit', '请求超过允许大小，请缩小授权范围。')
    const value = await this.#json(`tasks/${encodeURIComponent(taskId)}/control`, TaskSnapshotSchema, 'POST', input, signal, version === 2 ? AI_LIMITS.taskBytes : MAX_JSON_BYTES)
    if (value.id !== taskId || value.generation < request.expectedGeneration || !!continuationIdentity(value.authoring) !== (version === 2)) throw new AiClientError('protocol', '控制响应与任务或接续版本不匹配，请刷新完整任务。', 'unknown')
    return value
  }
  async draft(taskId: string, signal?: AbortSignal, version: 1 | 2 = 1) {
    const value = await this.#json(`tasks/${encodeURIComponent(taskId)}/draft`, AuthoringDraftSchema, 'GET', undefined, signal, version === 2 ? CONTINUATION_POLICY.requestBytes : 8 * 1024 * 1024)
    if (value.taskId !== taskId || value.schemaVersion !== version) throw new AiClientError('protocol', '草稿身份或接续版本不匹配，已停止显示。')
    return value
  }
  async regionSceneCandidate(taskId: string, query: RegionSceneCandidateQuery, signal?: AbortSignal) {
    const input = parseSchema(RegionSceneCandidateQuerySchema, query), params = new URLSearchParams({
      candidateId: input.candidateId, candidateHash: input.candidateHash, atContentHash: input.atContentHash,
      draftRevision: String(input.draftRevision), scopeHash: input.scopeHash,
    })
    const value = await this.#json(`tasks/${encodeURIComponent(taskId)}/draft/region-scene-candidate?${params}`, RegionSceneCandidateResponseSchema, 'GET', undefined, signal, 8 * 1024 * 1024)
    if (value.taskId !== taskId || value.candidateId !== input.candidateId || value.candidateHash !== input.candidateHash
      || value.atContentHash !== input.atContentHash || value.draftRevision !== input.draftRevision || value.result.hash !== value.candidateHash) throw new AiClientError('protocol', '区域候选身份或基线不匹配，已停止显示。')
    return value
  }
  async validateDraft(taskId: string, stamp: DraftStamp & { valid: boolean }, signal?: AbortSignal) {
    const value = await this.#json(`tasks/${encodeURIComponent(taskId)}/draft/validate`, TaskSnapshotSchema, 'POST', parseSchema(DraftValidationSchema, stamp), signal, continuationIdentity(stamp) ? AI_LIMITS.taskBytes : MAX_JSON_BYTES)
    if (value.id !== taskId || continuationIdentity(stamp) && (!value.authoring || !sameBudgetIdentity(stamp, value.authoring))) throw new AiClientError('protocol', '草稿校验响应身份不匹配。', 'unknown')
    return value
  }
  async claimDraft(taskId: string, claim: DraftClaim, signal?: AbortSignal) {
    const value = await this.#json(`tasks/${encodeURIComponent(taskId)}/draft/claim`, DraftLeaseSchema, 'POST', parseSchema(DraftClaimSchema, claim), signal)
    if (value.taskId !== taskId || value.claimId !== claim.claimId || value.generation !== claim.expectedGeneration || value.draftRevision !== claim.draftRevision || value.contentHash !== claim.contentHash || value.expiresAt <= value.serverNow || !sameBudgetIdentity(claim, value)) throw new AiClientError('protocol', '采用租约身份不匹配。', 'unknown')
    return value
  }
  async appliedDraft(taskId: string, receipt: DraftClaim & { sceneId: string; revision: number }, signal?: AbortSignal) {
    const value = await this.#json(`tasks/${encodeURIComponent(taskId)}/draft/applied`, TaskSnapshotSchema, 'POST', parseSchema(DraftAppliedSchema, receipt), signal, continuationIdentity(receipt) ? AI_LIMITS.taskBytes : MAX_JSON_BYTES)
    if (value.id !== taskId || continuationIdentity(receipt) && (!value.authoring || !sameBudgetIdentity(receipt, value.authoring))) throw new AiClientError('protocol', '采用回执身份不匹配。', 'unknown')
    return value
  }
  async releaseDraft(taskId: string, claim: DraftClaim, signal?: AbortSignal) {
    const value = await this.#json(`tasks/${encodeURIComponent(taskId)}/draft/release`, TaskSnapshotSchema, 'POST', parseSchema(DraftClaimSchema, claim), signal, continuationIdentity(claim) ? AI_LIMITS.taskBytes : MAX_JSON_BYTES)
    if (value.id !== taskId || continuationIdentity(claim) && (!value.authoring || !sameBudgetIdentity(claim, value.authoring))) throw new AiClientError('protocol', '释放租约响应身份不匹配。', 'unknown')
    return value
  }
  async delete(taskId: string, signal?: AbortSignal): Promise<void> { const response = await this.#request(`tasks/${encodeURIComponent(taskId)}`, 'DELETE', undefined, signal); if (response.status !== 204) { await response.body?.cancel(); throw new AiClientError('protocol', '服务器未确认删除，请刷新任务状态。') } }

  /** Reconnect only replays persisted events or GETs a snapshot; it never creates or resumes model requests. */
  async follow(initial: TaskSnapshot, callbacks: TaskSubscription, signal?: AbortSignal): Promise<void> {
    let current = parseSchema(TaskSnapshotSchema, initial), reconnects = 0
    if (stopped(current)) return
    for (;;) {
      aborted(signal)
      try {
        const response = await this.#request(`tasks/${encodeURIComponent(current.id)}/events?after=${current.lastSequence}`, 'GET', undefined, signal)
        if (!response.headers.get('content-type')?.toLowerCase().includes('text/event-stream') || !response.body) { await response.body?.cancel(); throw new AiClientError('protocol', '后端未返回有效的实时事件流。') }
        callbacks.onConnection?.('connected')
        const reader = response.body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true })
        const eventBytes = continuationIdentity(current.authoring) ? AI_LIMITS.taskBytes : AI_LIMITS.outputBytes * 2
        let buffer = '', data: string[] = [], eventName = '', eventId = ''
        const cancel = () => { void reader.cancel().catch(() => undefined) }
        signal?.addEventListener('abort', cancel, { once: true })
        const dispatch = () => {
          if (!data.length) { eventName = ''; eventId = ''; return }
          if (eventName !== 'task') throw new AiClientError('protocol', '后端返回了未支持的事件类型。')
          const event = parseSchema(TaskEventSchema, parseJson(data.join('\n')))
          if (eventId !== String(event.sequence) || event.taskId !== current.id) throw new AiClientError('protocol', '实时事件身份不匹配，请刷新完整任务。')
          data = []; eventName = ''; eventId = ''
          if (event.sequence <= current.lastSequence) return
          current = reduceTaskEvent(current, event); callbacks.onEvent?.(event); callbacks.onSnapshot(current)
        }
        try {
          for (;;) {
            aborted(signal)
            const part = await reader.read(); aborted(signal)
            if (part.done) { buffer += decoder.decode(); if (buffer.trim() || data.length) throw new AiClientError('stream_interrupted', '实时事件尚未完整，正在重新连接。'); break }
            buffer += decoder.decode(part.value, { stream: true })
            for (;;) {
              const lineEnd = buffer.indexOf('\n'); if (lineEnd < 0) break
              const line = buffer.slice(0, lineEnd).replace(/\r$/, ''); buffer = buffer.slice(lineEnd + 1)
              if (!line) { dispatch(); if (stopped(current)) return; continue }
              if (line.startsWith(':')) continue
              const colon = line.indexOf(':'), field = colon < 0 ? line : line.slice(0, colon), value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '')
              if (field === 'data') data.push(value)
              else if (field === 'event') eventName = value
              else if (field === 'id') eventId = value
              if (utf8Size(data.join('\n')) > eventBytes) throw new AiClientError('protocol', '实时事件超过允许大小。')
            }
            if (utf8Size(buffer) + utf8Size(data.join('\n')) > eventBytes) throw new AiClientError('protocol', '实时事件超过允许大小。')
          }
        } finally { signal?.removeEventListener('abort', cancel); await reader.cancel().catch(() => undefined); reader.releaseLock() }
        if (stopped(current)) return
        throw new AiClientError('stream_interrupted', '实时连接中断，正在读取已有进度。')
      } catch (error) {
        aborted(signal)
        if (error instanceof AiClientError && error.code === 'protocol') { callbacks.onConnection?.('disconnected'); throw error }
        if (reconnects >= 3) { callbacks.onConnection?.('disconnected'); throw new AiClientError('disconnected', '实时连接已中断，自动重连已停止。可点击重新连接读取服务器已有进度。') }
        reconnects += 1; callbacks.onConnection?.('reconnecting')
        // A full checkpoint handles event gaps, stale generations and unknown HTTP 409 cursors.
        current = await this.snapshot(current.id, signal, continuationIdentity(current.authoring) ? 2 : 1); callbacks.onSnapshot(current)
        if (stopped(current)) return
      }
    }
  }
}
