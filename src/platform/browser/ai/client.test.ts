import { beforeAll, describe, expect, it, vi } from 'vitest'
import { AiClient, AiClientError, normalizeAiBaseUrl, reduceTaskEvent, safeAiError, supportsContinuation } from './client'
import type { ConnectionInfo, CreateTaskRequest, TaskEvent, TaskSnapshot } from '../../../shared/ai/protocol'
import { AI_LIMITS } from '../../../shared/ai/protocol'
import native from '../content/scenes-data.json'
import { AUTHORING_LIMITS, type AuthoringDraft, type AuthoringSummary, type AuthoringStart, type DraftClaim, type DraftLease } from '../../../shared/ai/authoring-protocol-v1'
import { CONTINUATION_POLICY, type AuthoringStartV2 } from '../../../shared/ai/authoring-protocol'
import { authoringProjectHash, replayAuthoring, authoringDraftStamp, authoringSummary } from '../../../shared/ai/authoring'
import { continuationFixture } from '../../../../tests/helpers/continuation-fixture'
import { canonicalJson, cloneJson } from '../../../shared/validation/json'
import { sha256Text } from '../../../shared/validation/hash'
import type { ProjectData } from '../../../shared/model/project'

const request: CreateTaskRequest = { schemaVersion: 1, clientRequestId: '92304f00-6b07-4eb1-aa13-311250650166', prompt: '检查连接', context: { sceneId: 'scene-test', revision: 7, audience: 'public' } }
const snapshot = (overrides: Partial<TaskSnapshot> = {}): TaskSnapshot => ({ schemaVersion: 1, id: 'task-test', clientRequestId: request.clientRequestId, context: request.context, status: 'running', generation: 1, lastSequence: 0, text: '', tools: [], usage: { inputTokens: null, outputTokens: null, requests: 0, unknown: true }, error: null, createdAt: 1, updatedAt: 1, expiresAt: 604800001, ...overrides })
const event = (sequence: number, text: string): TaskEvent => ({ schemaVersion: 1, taskId: 'task-test', generation: 1, sequence, type: 'text_delta', data: { text } })
const completed = (sequence: number): TaskEvent => ({ schemaVersion: 1, taskId: 'task-test', generation: 1, sequence, type: 'status', data: { status: 'completed', reason: null } })
const frame = (value: TaskEvent) => `event: task\r\nid: ${value.sequence}\r\ndata: ${JSON.stringify(value)}\r\n\r\n`
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
const sse = (values: string[], split = false) => new Response(new ReadableStream({ start(controller) { const bytes = new TextEncoder().encode(values.join('')); if (split) for (const byte of bytes) controller.enqueue(new Uint8Array([byte])); else controller.enqueue(bytes); controller.close() } }), { headers: { 'content-type': 'text/event-stream' } })
const mockFetch = (fn: (url: string, init?: RequestInit) => Promise<Response> | Response): typeof fetch => vi.fn((url: string | URL | Request, init?: RequestInit) => Promise.resolve(fn(String(url), init))) as unknown as typeof fetch
const summary = (overrides: Partial<AuthoringSummary> = {}): AuthoringSummary => ({ draftRevision: 1, contentHash: 'a'.repeat(64), operationCost: 1,
  changedIds: ['prop-draft'], skill: { id: 'sceneweave-prop-authoring', version: 1 }, claim: null, ...overrides })
const grantRequest = (): CreateTaskRequest & { authoring: AuthoringStart } => {
  const project = cloneJson(native.scenes.blank) as unknown as ProjectData
  return { ...request, context: { sceneId: project.document.sceneId, revision: project.document.revision, audience: 'public' }, authoring: {
    schemaVersion: 1, project, baseContentHash: authoringProjectHash(project), seed: '0a85cddc-07b4-4a36-b839-f8aff0481203', preparedAt: '2026-10-24T00:00:00.000Z',
    skill: { id: 'sceneweave-prop-authoring', version: 1 }, disclosure: 'complete-metadata/public-model', scope: { targetIds: [], operations: ['place'],
      placement: { floorId: 'blank-floor', layerId: 'layer-default-0', supportRef: { kind: 'floor', id: 'blank-floor' },
        boundsMm: project.document.exportBoundsMm, definitionIds: [Object.keys(project.document.propDefinitions)[0]] } } } }
}
const claim: DraftClaim = { expectedGeneration: 3, draftRevision: 2, contentHash: 'b'.repeat(64), claimId: '28fb9c06-53bd-45cb-be79-e00ece80356d' }
const lease = (overrides: Partial<DraftLease> = {}): DraftLease => ({ schemaVersion: 1, taskId: 'task-test', generation: claim.expectedGeneration,
  draftRevision: claim.draftRevision, contentHash: claim.contentHash, claimId: claim.claimId, serverNow: 1000, expiresAt: 1000 + AUTHORING_LIMITS.claimMs, ...overrides })

 describe('native AI transport', () => {
  it('normalizes origin only and refuses insecure remote hosts, paths and embedded credentials', () => {
    expect(normalizeAiBaseUrl(' https://AI.example.com:443/ ')).toBe('https://ai.example.com')
    expect(normalizeAiBaseUrl('http://localhost:8787')).toBe('http://localhost:8787')
    expect(normalizeAiBaseUrl('http://[::1]:8787')).toBe('http://[::1]:8787')
    for (const url of ['', 'http://ai.example.com', 'https://u:p@example.com', 'https://example.com/ai', 'https://example.com/?x=1', 'https://example.com/#x', 'file:///tmp/a']) expect(() => normalizeAiBaseUrl(url)).toThrow(AiClientError)
  })
  it('sends only fixed task payload and bearer application credential; retries preserve the caller request ID', async () => {
    const bodies: string[] = [], headers: Headers[] = [], urls: string[] = []
    const fetcher = mockFetch((url, init) => { urls.push(url); bodies.push(String(init?.body)); headers.push(new Headers(init?.headers)); return json(snapshot()) })
    const client = new AiClient('https://ai.example.com', 'application-token-test', fetcher)
    await client.create(request); await client.create(request)
    expect(urls).toEqual(['https://ai.example.com/v1/tasks', 'https://ai.example.com/v1/tasks'])
    expect(bodies[0]).toBe(bodies[1]); expect(JSON.parse(bodies[0])).toEqual(request)
    expect(headers[0].get('Authorization')).toBe('Bearer application-token-test')
    expect(JSON.stringify(client)).not.toContain('application-token-test')
    expect(JSON.stringify(request)).not.toContain('application-token-test')
    expect((fetcher as ReturnType<typeof vi.fn>).mock.calls[0][1]).toMatchObject({ credentials: 'omit', redirect: 'error', cache: 'no-store' })
  })
  it('handles UTF-8 byte-split SSE and ignores duplicate events without duplicating text', async () => {
    const values: TaskSnapshot[] = []
    const client = new AiClient('https://ai.example.com', 'token', mockFetch(() => sse([frame(event(1, '你好')), frame(event(1, '你好')), frame(event(2, '🌲')), frame(completed(3))], true)))
    await client.follow(snapshot(), { onSnapshot: value => values.push(value) })
    expect(values.at(-1)).toMatchObject({ text: '你好🌲', lastSequence: 3, status: 'completed' })
    expect(values).toHaveLength(3)
  })
  it('refreshes a full snapshot on a sequence gap and reconnects GET from its cursor only', async () => {
    const urls: string[] = [], values: TaskSnapshot[] = []
    const client = new AiClient('https://ai.example.com', 'token', mockFetch(url => {
      urls.push(url)
      if (urls.length === 1) return sse([frame(event(3, '不应拼接'))])
      if (!url.includes('/events')) return json(snapshot({ text: '完整', lastSequence: 3 }))
      return sse([frame(event(4, '检查点')), frame(completed(5))])
    }))
    await client.follow(snapshot(), { onSnapshot: value => values.push(value) })
    expect(values.at(-1)?.text).toBe('完整检查点')
    expect(urls).toEqual(['https://ai.example.com/v1/tasks/task-test/events?after=0', 'https://ai.example.com/v1/tasks/task-test', 'https://ai.example.com/v1/tasks/task-test/events?after=3'])
  })
  it('uses a checkpoint for HTTP 409 and a changed generation, preserving paused text', async () => {
    const values: TaskSnapshot[] = [], urls: string[] = []
    const client = new AiClient('https://ai.example.com', 'token', mockFetch(url => { urls.push(url); return url.includes('/events') ? json({ schemaVersion: 1, error: { code: 'snapshot_required', message: 'do not display', retryable: true, requestState: 'not_sent' } }, 409) : json(snapshot({ generation: 2, lastSequence: 6, text: '保留', status: 'paused' })) }))
    await client.follow(snapshot(), { onSnapshot: value => values.push(value) })
    expect(values.at(-1)).toMatchObject({ generation: 2, text: '保留', status: 'paused' }); expect(urls).toHaveLength(2)
    expect(() => reduceTaskEvent(snapshot({ generation: 2 }), event(1, '迟到'))).toThrow(AiClientError)
  })
  it('stops after three automatic reconnects and never replays a POST or resumes a model', async () => {
    const fetcher = mockFetch(url => url.includes('/events') ? sse([]) : json(snapshot()))
    const client = new AiClient('https://ai.example.com', 'token', fetcher), states: string[] = []
    await expect(client.follow(snapshot(), { onSnapshot: () => undefined, onConnection: state => states.push(state) })).rejects.toMatchObject({ code: 'disconnected' })
    expect(states.filter(state => state === 'reconnecting')).toHaveLength(3)
    expect(states.at(-1)).toBe('disconnected')
    expect((fetcher as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(7)
    for (const call of (fetcher as ReturnType<typeof vi.fn>).mock.calls) expect(call[1]?.method).toBe('GET')
  })
  it('cancels a stalled local stream without sending server control/delete and does not emit late text', async () => {
    let streamCancelled = false
    const controller = new AbortController(), onSnapshot = vi.fn()
    const fetcher = mockFetch(() => new Response(new ReadableStream({ cancel() { streamCancelled = true } }), { headers: { 'content-type': 'text/event-stream' } }))
    const client = new AiClient('https://ai.example.com', 'token', fetcher)
    const following = client.follow(snapshot(), { onSnapshot, onConnection: state => { if (state === 'connected') controller.abort() } }, controller.signal)
    await expect(following).rejects.toMatchObject({ name: 'AbortError' })
    expect(streamCancelled).toBe(true); expect(onSnapshot).not.toHaveBeenCalled(); expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('rejects invalid schemas and does not expose raw HTML, server error messages or credential text', async () => {
    const privateValue = 'private-application-token'
    const client = new AiClient('https://ai.example.com', privateValue, mockFetch(() => json({ schemaVersion: 1, error: { code: 'provider_failed', message: privateValue, retryable: false, requestState: 'unknown' } }, 503)))
    const error = await client.create(request).catch(value => value)
    expect(error).toBeInstanceOf(AiClientError); expect(safeAiError(error)).not.toContain(privateValue)
    const html = new AiClient('https://ai.example.com', privateValue, mockFetch(() => new Response(`<script>${privateValue}</script>`, { status: 500 })))
    expect(safeAiError(await html.create(request).catch(value => value))).not.toContain(privateValue)
    const malformed = new AiClient('https://ai.example.com', privateValue, mockFetch(() => json({ ...snapshot(), unexpected: true })))
    await expect(malformed.create(request)).rejects.toMatchObject({ code: 'protocol', requestState: 'unknown' })
  })
  it('enforces 16KiB UTF-8 prompt budget before fetch and requires server 204 before deletion succeeds', async () => {
    const fetcher = mockFetch(() => json(snapshot())), client = new AiClient('https://ai.example.com', 'token', fetcher)
    await expect(client.create({ ...request, prompt: '界'.repeat(6000) })).rejects.toMatchObject({ code: 'protocol' })
    expect(fetcher).not.toHaveBeenCalled()
    await expect(client.delete('task-test')).rejects.toMatchObject({ code: 'protocol' })
    const confirmed = new AiClient('https://ai.example.com', 'token', mockFetch(() => new Response(null, { status: 204 })))
    await expect(confirmed.delete('task-test')).resolves.toBeUndefined()
  })
})

describe('AI authoring transport and dynamic task budgets', () => {
  it('sends an explicit complete-metadata authoring grant above the conversation-only request budget', async () => {
    const input = grantRequest(), body = JSON.stringify(input), seen: RequestInit[] = []
    expect(new TextEncoder().encode(body).length).toBeGreaterThan(32_768)
    const fetcher = mockFetch((_url, init) => { seen.push(init!); return json(snapshot({ context: input.context, authoring: summary() })) })
    const client = new AiClient('https://ai.example.com', 'application-only-token', fetcher)
    await expect(client.create(input)).resolves.toMatchObject({ authoring: summary() })
    expect(JSON.parse(String(seen[0].body))).toEqual(input)
    expect(String(seen[0].body)).not.toContain('application-only-token')
    expect(seen[0].signal).toBeInstanceOf(AbortSignal)
    expect(seen[0]).toMatchObject({ credentials: 'omit', redirect: 'error', cache: 'no-store' })
  })
  it('rejects oversized authoring transport before fetch and enforces the same UTF-8 prompt limit', async () => {
    const input = grantRequest(), fetcher = mockFetch(() => json(snapshot())), client = new AiClient('https://ai.example.com', 'token', fetcher)
    Object.values(input.authoring!.project.document.propDefinitions)[0].origin.attribution = 'x'.repeat(AUTHORING_LIMITS.requestBytes)
    // The server separately validates its stricter 4MiB complete metadata cap.
    await expect(client.create(input)).rejects.toMatchObject({ code: 'request_limit', requestState: 'not_sent' })
    const promptOverflow = grantRequest(); promptOverflow.prompt = '界'.repeat(6000)
    await expect(client.create(promptOverflow)).rejects.toMatchObject({ code: 'protocol' })
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('carries exact draft stamps and claim/receipt identity through all authoring endpoints', async () => {
    const input = grantRequest(), state = replayAuthoring(input.authoring!, []).state
    const draft: AuthoringDraft = { schemaVersion: 1, taskId: 'task-test', generation: 3, start: input.authoring!, state }
    const calls: { url: string; method: string; body: unknown }[] = []
    const fetcher = mockFetch((url, init) => {
      calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : null })
      return json(url.endsWith('/draft/claim') ? lease() : url.endsWith('/draft') ? draft : snapshot({ authoring: summary(), generation: 3 }))
    })
    const client = new AiClient('https://ai.example.com', 'token', fetcher)
    await expect(client.draft('task-test')).resolves.toEqual(draft)
    await expect(client.validateDraft('task-test', { ...claim, claimId: undefined, valid: true } as never)).rejects.toMatchObject({ code: 'protocol' })
    // Unknown fields are rejected locally; a proper stamp carries no claim ID.
    expect(calls).toHaveLength(1)
    const stamp = { expectedGeneration: claim.expectedGeneration, draftRevision: claim.draftRevision, contentHash: claim.contentHash }
    await client.validateDraft('task-test', { ...stamp, valid: true })
    await expect(client.claimDraft('task-test', claim)).resolves.toEqual(lease())
    await client.appliedDraft('task-test', { ...claim, sceneId: 'scene-test', revision: 8 })
    await client.releaseDraft('task-test', claim)
    expect(calls).toEqual([
      { url: 'https://ai.example.com/v1/tasks/task-test/draft', method: 'GET', body: null },
      { url: 'https://ai.example.com/v1/tasks/task-test/draft/validate', method: 'POST', body: { ...stamp, valid: true } },
      { url: 'https://ai.example.com/v1/tasks/task-test/draft/claim', method: 'POST', body: claim },
      { url: 'https://ai.example.com/v1/tasks/task-test/draft/applied', method: 'POST', body: { ...claim, sceneId: 'scene-test', revision: 8 } },
      { url: 'https://ai.example.com/v1/tasks/task-test/draft/release', method: 'POST', body: claim },
    ])
  })
  it('refuses mismatched task, claim ID, generation, draft revision, hash and expired leases', async () => {
    for (const changed of [{ taskId: 'other-task' }, { claimId: 'a688fedd-f1ac-4e6e-9ded-c219485ff29b' }, { generation: 4 },
      { draftRevision: 3 }, { contentHash: 'c'.repeat(64) }, { expiresAt: 1000 }, { expiresAt: 999 }]) {
      const client = new AiClient('https://ai.example.com', 'token', mockFetch(() => json(lease(changed))))
      await expect(client.claimDraft('task-test', claim)).rejects.toMatchObject({ code: 'protocol', requestState: 'unknown' })
    }
    const client = new AiClient('https://ai.example.com', 'token', mockFetch(() => json({ ...lease(), extra: true })))
    await expect(client.claimDraft('task-test', claim)).rejects.toMatchObject({ code: 'protocol', requestState: 'unknown' })
  })
  it('rejects authoring endpoint responses for another task without reporting success', async () => {
    const client = new AiClient('https://ai.example.com', 'token', mockFetch(() => json(snapshot({ id: 'other-task' }))))
    const stamp = { expectedGeneration: claim.expectedGeneration, draftRevision: claim.draftRevision, contentHash: claim.contentHash }
    await expect(client.validateDraft('task-test', { ...stamp, valid: true })).rejects.toMatchObject({ code: 'protocol', requestState: 'unknown' })
    await expect(client.appliedDraft('task-test', { ...claim, sceneId: 'scene-test', revision: 8 })).rejects.toMatchObject({ code: 'protocol', requestState: 'unknown' })
    await expect(client.releaseDraft('task-test', claim)).rejects.toMatchObject({ code: 'protocol', requestState: 'unknown' })
    const input = grantRequest(), draft: AuthoringDraft = { schemaVersion: 1, taskId: 'other-task', generation: 1, start: input.authoring!, state: replayAuthoring(input.authoring!, []).state }
    const wrongDraft = new AiClient('https://ai.example.com', 'token', mockFetch(() => json(draft)))
    await expect(wrongDraft.draft('task-test')).rejects.toMatchObject({ code: 'protocol' })
  })
  it('reduces draft updates and the waiting/ready/applying/applied lifecycle in sequence', () => {
    const draft = summary(), first: TaskEvent = { schemaVersion: 1, taskId: 'task-test', generation: 1, sequence: 1, type: 'draft_updated', data: draft }
    let current = reduceTaskEvent(snapshot(), first)
    expect(current.authoring).toEqual(draft)
    const statuses = ['waiting_browser', 'ready', 'applying', 'applied'] as const
    statuses.forEach((status, i) => { current = reduceTaskEvent(current, { schemaVersion: 1, taskId: 'task-test', generation: 1, sequence: i + 2, type: 'status', data: { status, reason: null } }) })
    expect(current).toMatchObject({ status: 'applied', lastSequence: 5, authoring: draft })
    expect(() => reduceTaskEvent(current, first)).toThrow(AiClientError)
    expect(() => reduceTaskEvent(snapshot(), { ...first, generation: 2 })).toThrow(AiClientError)
    expect(() => reduceTaskEvent(snapshot(), { ...first, taskId: 'other' })).toThrow(AiClientError)
  })
  it('allows 64 authoring tool results while preserving the eight-tool conversation limit', () => {
    const tool = (i: number) => ({ callId: `call-${i}`, name: 'sceneweave_read_scene', success: true, output: '{}' })
    const toolEvent = (i: number): TaskEvent => ({ schemaVersion: 1, taskId: 'task-test', generation: 1, sequence: i, type: 'tool_result', data: tool(i) })
    let conversation = snapshot()
    for (let i = 1; i <= 8; i++) conversation = reduceTaskEvent(conversation, toolEvent(i))
    expect(() => reduceTaskEvent(conversation, toolEvent(9))).toThrow(AiClientError)
    let authoring = snapshot({ authoring: summary() })
    for (let i = 1; i <= 64; i++) authoring = reduceTaskEvent(authoring, toolEvent(i))
    expect(authoring.tools).toHaveLength(64)
    expect(() => reduceTaskEvent(authoring, toolEvent(65))).toThrow(AiClientError)
    expect(snapshot().tools).toHaveLength(0)
  })
  it('reads valid authoring drafts above 1MiB but cancels a streamed response above its 8MiB cap', async () => {
    const input = grantRequest()
    Object.values(input.authoring!.project.document.propDefinitions)[0].origin.attribution = 'x'.repeat(1_100_000)
    input.authoring!.baseContentHash = authoringProjectHash(input.authoring!.project)
    const draft: AuthoringDraft = { schemaVersion: 1, taskId: 'task-test', generation: 1, start: input.authoring!, state: replayAuthoring(input.authoring!, []).state }
    const client = new AiClient('https://ai.example.com', 'token', mockFetch(() => json(draft)))
    await expect(client.draft('task-test')).resolves.toMatchObject({ taskId: 'task-test', start: { baseContentHash: input.authoring!.baseContentHash } })
    let didCancel = false
    const oversized = new AiClient('https://ai.example.com', 'token', mockFetch(() => new Response(new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(8 * 1024 * 1024 + 1)) }, cancel() { didCancel = true },
    }), { headers: { 'content-type': 'application/json' } })))
    await expect(oversized.draft('task-test')).rejects.toMatchObject({ code: 'protocol' })
    expect(didCancel).toBe(true)
  })
  it('caps task snapshots at 1MiB and keeps authoring task lists on their separate bounded response path', async () => {
    const task = snapshot({ authoring: summary(), tools: Array.from({ length: 64 }, (_, i) => ({ callId: `call-${i}`, name: 'sceneweave_read_scene', success: true, output: 'x'.repeat(7000) })) })
    const fetcher = mockFetch(url => url.includes('?sceneId=') ? json({ schemaVersion: 1, tasks: Array.from({ length: 4 }, (_, i) => ({ ...task, id: `task-${i}` })) }) : json(task))
    const client = new AiClient('https://ai.example.com', 'token', fetcher)
    await expect(client.snapshot('task-test')).resolves.toMatchObject({ tools: expect.any(Array) })
    await expect(client.list('scene-test')).resolves.toHaveLength(4)
    const oversized = new AiClient('https://ai.example.com', 'token', mockFetch(() => new Response(' '.repeat(1024 * 1024 + 1))))
    await expect(oversized.snapshot('task-test')).rejects.toMatchObject({ code: 'protocol' })
  })
  it('stops a stalled authoring JSON body at its bounded request deadline without retrying', async () => {
    const timeout = new AbortController(), timed = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeout.signal)
    let didCancel = false
    const fetcher = mockFetch(() => new Response(new ReadableStream({ cancel() { didCancel = true } }), { headers: { 'content-type': 'application/json' } }))
    try {
      const client = new AiClient('https://ai.example.com', 'token', fetcher), pending = client.claimDraft('task-test', claim)
      await Promise.resolve(); await Promise.resolve(); timeout.abort()
      await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
      expect(timed).toHaveBeenCalledWith(20_000)
      expect(didCancel).toBe(true); expect(fetcher).toHaveBeenCalledTimes(1)
    } finally { timed.mockRestore() }
  })
})

describe('generated-map continuation transport identity', () => {
  let start: AuthoringStartV2, initial: ReturnType<typeof replayAuthoring>, input: CreateTaskRequest
  const capabilities = (changes: Partial<ConnectionInfo['capabilities']> = {}): ConnectionInfo => ({ schemaVersion: 1, model: 'test-model', protocol: 'chat-completions',
    capabilities: { conversation: true, connectionTool: true, sceneDraft: true, svg: true, vision: 'disabled', authoringVersions: [1, 2], baseMapVersions: [1, 2], budgetPolicyHashes: [CONTINUATION_POLICY.policyHash], ...changes },
    retentionDays: 7, limits: { modelRequests: 4, toolCalls: 8, executionMs: 120000, promptBytes: 16384, outputBytes: 65536 } })
  beforeAll(() => {
    start = continuationFixture(); initial = replayAuthoring(start, [])
    input = { ...request, context: { sceneId: 'original-main', revision: 7, audience: 'public' }, authoring: start }
  }, 30000)
  const currentSummary = () => {
    const value = authoringSummary(start, initial.state, null)
    if (!('schemaVersion' in value) || value.schemaVersion !== 2) throw new Error('Expected a classified authoring summary.')
    return value
  }
  const classifiedSnapshot = (overrides: Partial<TaskSnapshot> = {}): TaskSnapshot => {
    const value = snapshot(overrides), authoring = value.authoring
    if (!authoring || !('schemaVersion' in authoring) || authoring.schemaVersion !== 2) return value
    const body = { schemaVersion: 2 as const, flowId: start.source.flowId, taskId: value.id, generation: value.generation,
      policyHash: authoring.policyHash, sourceHash: authoring.sourceHash, ledgerHeadHash: authoring.ledgerHeadHash, budgetStateHash: authoring.budgetStateHash,
      activeRuntimeMs: 1, initializationMs: 1, modelRequests: value.usage.requests, completedRequests: 0, toolAttempts: 0, outputBytes: 0 }
    return { ...value, executionCheckpoint: { ...body, checkpointHash: sha256Text(canonicalJson(body)) } }
  }
  const currentStamp = () => authoringDraftStamp(initial.state, 3)
  const currentClaim = () => ({ ...currentStamp(), claimId: claim.claimId })
  const currentLease = () => { const { expectedGeneration, ...fields } = currentClaim(); return { ...fields, taskId: 'task-test', generation: expectedGeneration, serverNow: 1000, expiresAt: 31000 } }
  const checkpointEvent = (sequence: number, value: TaskSnapshot): TaskEvent => {
    const authoring = value.authoring, executionCheckpoint = value.executionCheckpoint
    if (!authoring || !('schemaVersion' in authoring) || authoring.schemaVersion !== 2 || !executionCheckpoint) throw new Error('Expected a complete classified snapshot.')
    return { schemaVersion: 1, taskId: value.id, generation: value.generation, sequence, type: 'authoring_checkpoint',
      data: { authoring, usage: value.usage, executionCheckpoint } }
  }

  it.each([{ authoringVersions: [1] as [1] }, { budgetPolicyHashes: ['f'.repeat(64)] }, { budgetPolicyHashes: [] },
    { authoringVersions: undefined, baseMapVersions: undefined, budgetPolicyHashes: undefined }])('does not POST v2 metadata to an incompatible policy/version, including an old server ignoring the opt-in query', async changes => {
    const fetcher = mockFetch(() => json(capabilities(changes))), client = new AiClient('https://ai.example.com', 'token', fetcher)
    await expect(client.create(input)).rejects.toMatchObject({ code: 'unsupported_continuation', requestState: 'not_sent' })
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect((fetcher as ReturnType<typeof vi.fn>).mock.calls[0][1].method).toBe('GET')
    expect((fetcher as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe('https://ai.example.com/v1/capabilities?authoringVersion=2')
    expect(supportsContinuation(capabilities(changes), 'authoring')).toBe(false)
  })
  it('negotiates before sending and preserves the exact source and original workspace context', async () => {
    const calls: { url: string; body: unknown }[] = []
    const fetcher = mockFetch((url, init) => { calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null }); return json(url.endsWith('/capabilities?authoringVersion=2') ? capabilities() : classifiedSnapshot({ context: input.context, authoring: currentSummary() })) })
    const client = new AiClient('https://ai.example.com', 'token', fetcher)
    await expect(client.create(input)).resolves.toMatchObject({ authoring: currentSummary() })
    expect(calls.map(call => call.url)).toEqual(['https://ai.example.com/v1/capabilities?authoringVersion=2', 'https://ai.example.com/v1/tasks'])
    expect(calls[1].body).toEqual(input)
  })
  it('refuses a successful HTTP response that downgrades the v2 task', async () => {
    const fetcher = mockFetch(url => json(url.endsWith('/capabilities?authoringVersion=2') ? capabilities() : snapshot({ context: input.context, authoring: summary() })))
    await expect(new AiClient('https://ai.example.com', 'token', fetcher).create(input)).rejects.toMatchObject({ code: 'protocol', requestState: 'unknown' })
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
  it('fetches a v2 draft only with an explicit v2 expectation and refuses downgrade', async () => {
    const draft = { schemaVersion: 2, taskId: 'task-test', generation: 3, start, state: initial.state }
    const client = new AiClient('https://ai.example.com', 'token', mockFetch(() => json(draft)))
    await expect(client.draft('task-test', undefined, 2)).resolves.toEqual(draft)
    await expect(client.draft('task-test')).rejects.toMatchObject({ code: 'protocol' })
    const old = grantRequest(), downgraded = new AiClient('https://ai.example.com', 'token', mockFetch(() => json({ schemaVersion: 1, taskId: 'task-test', generation: 3, start: old.authoring, state: replayAuthoring(old.authoring, []).state })))
    await expect(downgraded.draft('task-test', undefined, 2)).rejects.toMatchObject({ code: 'protocol' })
  })
  it('carries all four hashes through validation, claim, applied and release', async () => {
    const bodies: unknown[] = []
    const client = new AiClient('https://ai.example.com', 'token', mockFetch((url, init) => { bodies.push(JSON.parse(String(init?.body))); return json(url.endsWith('/claim') ? currentLease() : classifiedSnapshot({ authoring: currentSummary(), generation: 3 })) }))
    await client.validateDraft('task-test', { ...currentStamp(), valid: true })
    await client.claimDraft('task-test', currentClaim())
    await client.appliedDraft('task-test', { ...currentClaim(), sceneId: start.project.document.sceneId, revision: 1 })
    await client.releaseDraft('task-test', currentClaim())
    for (const body of bodies) expect(body).toMatchObject(currentStamp())
  })
  it.each(['policyHash', 'sourceHash', 'ledgerHeadHash', 'budgetStateHash'] as const)('rejects a changed %s in every v2 response', async field => {
    const altered = { [field]: 'f'.repeat(64) }
    const client = new AiClient('https://ai.example.com', 'token', mockFetch(url => json(url.endsWith('/claim') ? { ...currentLease(), ...altered } : classifiedSnapshot({ authoring: { ...currentSummary(), ...altered }, generation: 3 }))))
    await expect(client.validateDraft('task-test', { ...currentStamp(), valid: true })).rejects.toMatchObject({ code: 'protocol', requestState: 'unknown' })
    await expect(client.claimDraft('task-test', currentClaim())).rejects.toMatchObject({ code: 'protocol', requestState: 'unknown' })
    await expect(client.appliedDraft('task-test', { ...currentClaim(), sceneId: start.project.document.sceneId, revision: 1 })).rejects.toMatchObject({ code: 'protocol', requestState: 'unknown' })
    await expect(client.releaseDraft('task-test', currentClaim())).rejects.toMatchObject({ code: 'protocol', requestState: 'unknown' })
  })
  it('atomically advances classified summary, usage and execution while refusing isolated or foreign checkpoint updates', () => {
    const before = classifiedSnapshot({ authoring: currentSummary() })
    const next = classifiedSnapshot({ authoring: { ...currentSummary(), draftRevision: currentSummary().draftRevision + 1,
      ledgerHeadHash: 'b'.repeat(64), budgetStateHash: 'c'.repeat(64) },
      usage: { ...before.usage, requests: 1 } })
    const checkpoint = checkpointEvent(1, next), updated = reduceTaskEvent(before, checkpoint)
    expect(updated).toMatchObject({ authoring: next.authoring, usage: next.usage, executionCheckpoint: next.executionCheckpoint, lastSequence: 1 })
    expect(reduceTaskEvent(updated, { schemaVersion: 1, taskId: next.id, generation: 1, sequence: 2, type: 'usage', data: next.usage }).usage.requests).toBe(1)
    expect(() => reduceTaskEvent(before, { schemaVersion: 1, taskId: next.id, generation: 1, sequence: 1, type: 'usage', data: next.usage })).toThrow(AiClientError)
    expect(() => reduceTaskEvent(before, { schemaVersion: 1, taskId: next.id, generation: 1, sequence: 1, type: 'draft_updated', data: next.authoring! })).toThrow(AiClientError)
    expect(() => reduceTaskEvent(snapshot(), checkpoint)).toThrow(AiClientError)
    if (checkpoint.type !== 'authoring_checkpoint') throw new Error('Expected atomic checkpoint event.')
    const foreign = structuredClone(checkpoint); foreign.data.executionCheckpoint.flowId = 'foreign-flow'
    expect(() => reduceTaskEvent(before, foreign)).toThrow(AiClientError)
    const corrupt = structuredClone(checkpoint); corrupt.data.executionCheckpoint.checkpointHash = 'f'.repeat(64)
    expect(() => reduceTaskEvent(before, corrupt)).toThrow(AiClientError)
  })
  it('rejects self-consistent cumulative rollback but permits a smaller final net difference and execution-only progress', () => {
    const summary = currentSummary(), before = classifiedSnapshot({ authoring: { ...summary, draftRevision: 2,
      budget: { ...summary.budget, aiCost: 2, complexityCost: 4 } }, usage: { ...snapshot().usage, requests: 3 } })
    const synchronize = (value: TaskSnapshot) => {
      if (!value.authoring || !('schemaVersion' in value.authoring) || value.authoring.schemaVersion !== 2) throw new Error('Expected classified summary.')
      const { checkpointHash: _old, ...body } = value.executionCheckpoint!
      Object.assign(body, { ledgerHeadHash: value.authoring.ledgerHeadHash, budgetStateHash: value.authoring.budgetStateHash, modelRequests: value.usage.requests })
      value.executionCheckpoint = { ...body, checkpointHash: sha256Text(canonicalJson(body)) }; return value
    }
    Object.assign(before.executionCheckpoint!, { activeRuntimeMs: 10, initializationMs: 5, completedRequests: 2, toolAttempts: 4, outputBytes: 5, uncertain: true })
    synchronize(before)
    const cases: [string, (value: TaskSnapshot) => void][] = [
      ['draft revision', value => { value.authoring!.draftRevision-- }],
      ['generation cost', value => { if (value.authoring && 'budget' in value.authoring) value.authoring.budget.generationCost++ }],
      ['AI cost', value => { if (value.authoring && 'budget' in value.authoring) value.authoring.budget.aiCost-- }],
      ['complexity cost', value => { if (value.authoring && 'budget' in value.authoring) value.authoring.budget.complexityCost-- }],
      ['same-revision ledger', value => { if (value.authoring && 'ledgerHeadHash' in value.authoring) value.authoring.ledgerHeadHash = 'd'.repeat(64) }],
      ['same-revision budget', value => { if (value.authoring && 'budgetStateHash' in value.authoring) value.authoring.budgetStateHash = 'e'.repeat(64) }],
      ...(['activeRuntimeMs', 'initializationMs', 'completedRequests', 'toolAttempts', 'outputBytes'] as const).map(field => [field, (value: TaskSnapshot) => { value.executionCheckpoint![field]-- }] as [string, (value: TaskSnapshot) => void]),
      ['model requests', value => { value.usage.requests-- }],
      ['uncertainty cleared', value => { value.executionCheckpoint!.uncertain = false }],
      ['uncertainty omitted', value => { delete value.executionCheckpoint!.uncertain }],
    ]
    for (const [label, mutate] of cases) { const changed = structuredClone(before); mutate(changed); synchronize(changed); expect(() => reduceTaskEvent(before, checkpointEvent(1, changed)), label).toThrow(AiClientError) }
    const progress = structuredClone(before); progress.executionCheckpoint!.activeRuntimeMs++
    expect(reduceTaskEvent(before, checkpointEvent(1, synchronize(progress))).executionCheckpoint).toMatchObject({ activeRuntimeMs: 11, uncertain: true })
    const reduced = structuredClone(before)
    if (!reduced.authoring || !('budget' in reduced.authoring)) throw new Error('Expected classified summary.')
    reduced.authoring.draftRevision++; reduced.authoring.ledgerHeadHash = 'd'.repeat(64); reduced.authoring.budgetStateHash = 'e'.repeat(64)
    reduced.authoring.budget.finalAdoptionCost = 0; reduced.authoring.changedIds = []
    expect(reduceTaskEvent(before, checkpointEvent(1, synchronize(reduced))).authoring).toMatchObject({ changedIds: [], budget: { finalAdoptionCost: 0 } })
  })
  it('transports the maximum escaped v2 ID collection over SSE and explicit snapshot reads while retaining the v1 byte gate', async () => {
    // Transport-only boundary: domain replay is tested separately. Each of the
    // 8192 unique IDs reaches the strict 256-character schema maximum, including
    // JSON escapes, without loosening the 16MiB task envelope.
    const ids = Array.from({ length: 8192 }, (_, index) => String(index).padStart(7, '0') + '\u0001'.repeat(249))
    const large = classifiedSnapshot({ authoring: { ...currentSummary(), changedIds: ids } }), values: TaskSnapshot[] = []
    const payload = JSON.stringify(large)
    expect(new TextEncoder().encode(payload).length).toBeGreaterThan(1024 * 1024)
    expect(new TextEncoder().encode(payload).length).toBeLessThan(AI_LIMITS.taskBytes)
    const streamClient = new AiClient('https://ai.example.com', 'token', mockFetch(() => sse([frame(checkpointEvent(1, large)), frame(completed(2))])))
    await streamClient.follow(classifiedSnapshot({ authoring: currentSummary() }), { onSnapshot: value => values.push(value) })
    expect(values.at(-1)).toMatchObject({ status: 'completed', lastSequence: 2, authoring: { changedIds: ids } })
    const client = new AiClient('https://ai.example.com', 'token', mockFetch(() => new Response(payload, { headers: { 'content-type': 'application/json' } })))
    await expect(client.snapshot('task-test', undefined, 2)).resolves.toMatchObject({ authoring: { changedIds: ids } })
    await expect(client.lookupSnapshot('task-test')).resolves.toMatchObject({ authoring: { changedIds: ids } })
    await expect(client.snapshot('task-test')).rejects.toMatchObject({ code: 'protocol' })
  })
  it.each(['snapshot', 'stream'] as const)('refuses v2 %s bytes above the fixed 16MiB cap', async kind => {
    const oversized = ' '.repeat(AI_LIMITS.taskBytes + 1)
    const client = new AiClient('https://ai.example.com', 'token', mockFetch(() => kind === 'snapshot'
      ? new Response(oversized, { headers: { 'content-type': 'application/json' } })
      : sse(['data: ' + oversized])))
    if (kind === 'snapshot') await expect(client.lookupSnapshot('task-test')).rejects.toMatchObject({ code: 'protocol' })
    else await expect(client.follow(classifiedSnapshot({ authoring: currentSummary() }), { onSnapshot: () => undefined })).rejects.toMatchObject({ code: 'protocol' })
  })
  it('keeps v1 SSE under its original 128KiB unfinished-event cap and binds lookup response IDs', async () => {
    const client = new AiClient('https://ai.example.com', 'token', mockFetch(() => sse(['data: ' + ' '.repeat(AI_LIMITS.outputBytes * 2 + 1)])))
    await expect(client.follow(snapshot(), { onSnapshot: () => undefined })).rejects.toMatchObject({ code: 'protocol' })
    const wrong = new AiClient('https://ai.example.com', 'token', mockFetch(() => json(classifiedSnapshot({ id: 'other-task', authoring: currentSummary() }))))
    await expect(wrong.lookupSnapshot('task-test')).rejects.toMatchObject({ code: 'protocol' })
  })
})
