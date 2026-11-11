import { timingSafeEqual } from 'node:crypto'
import { Hono } from 'hono'
import { AI_LIMITS, ConnectionInfoSchema, ControlTaskSchema, CreateTaskSchema, utf8Size } from '../../src/shared/ai/protocol.js'
import type { AiError, ConnectionInfo } from '../../src/shared/ai/protocol.js'
import type { AiConfig } from './config.js'
import type { ProviderAdapter } from './provider-types.js'
import { createChatProvider } from './chat-provider.js'
import { TaskEngine } from './engine.js'
import { TaskFault, TaskStore } from './store.js'
import { AUTHORING_LIMITS, DraftAppliedSchema, DraftClaimSchema, DraftValidationSchema } from '../../src/shared/ai/authoring-protocol.js'
import { VISION_LIMITS } from '../../src/shared/ai/vision.js'
import { RegionSceneCandidateQuerySchema } from '../../src/shared/ai/region-candidate-protocol.js'
import { createBaseMapService } from './base-map.js'
import { CONTINUATION_POLICY, CONTINUATION_POLICIES_V2, BUDGET_POLICY_HASHES } from '../../src/shared/ai/budget-policy.js'
import { TASK_BUDGET_PROFILES } from '../../src/shared/budget/task-budget.js'
import { domainGenerationCapabilities } from '../../src/shared/generation/execution.js'
import { createDomainGenerationService, GenerationServiceFault } from './generation.js'
import { createTaskBodyReader } from './task-body.js'
import { createImageEditService, ImageEditFault } from './image-edit.js'

export function connectionInfo(config: AiConfig): ConnectionInfo {
  return ConnectionInfoSchema.parse({ schemaVersion: 1, model: config.provider.model, ...(config.provider.visionModel ? { visionModel: config.provider.visionModel } : {}), reasoningEffort: config.provider.reasoningEffort ?? null, authoringOutputTokens: config.authoringOutputTokens ?? AI_LIMITS.maxOutputTokensPerRequest, protocol: 'chat-completions',
    capabilities: { conversation: true, connectionTool: true, sceneDraft: true, svg: true, vision: config.provider.vision ?? 'unverified', taskReasoningEffort: true,
      surfaceRecipeVersions: [1], baseMapSelectors: ['terrain-scene-v6', 'terrain-compose-v6', 'terrain-scene-v7', 'terrain-compose-v7'], currentAuthoring: 'sceneweave-current-authoring@1', completeProjectVersions: [1], visualReviewVersions: [1], authoringVersions: [4], baseMapVersions: [1, 2, 3], budgetPolicyHashes: BUDGET_POLICY_HASHES, budgetProfileHashes: Object.values(TASK_BUDGET_PROFILES).map(profile => profile.profileHash) }, retentionDays: AI_LIMITS.retentionDays,
    limits: { modelRequests: AI_LIMITS.modelRequests, toolCalls: AI_LIMITS.toolCalls, executionMs: AI_LIMITS.executionMs, promptBytes: AI_LIMITS.promptBytes, outputBytes: AI_LIMITS.outputBytes } })
}
export function authenticate(config: AiConfig, authorization: string | undefined): string | undefined {
  if (!authorization?.startsWith('Bearer ')) return undefined
  const candidate = Buffer.from(authorization.slice(7))
  let owner: string | undefined
  for (const [token, identity] of config.accessTokens) {
    const expected = Buffer.from(token)
    if (candidate.length === expected.length && timingSafeEqual(candidate, expected)) owner = identity
  }
  return owner
}
const errorPayload = (code: string, requestState: AiError['requestState'] = 'not_sent') => ({ schemaVersion: 1 as const, error: { code, message: code === 'unauthorized' ? '需要有效的应用访问凭据。' : code === 'origin_rejected' ? '此站点未获准访问任务服务。' : code === 'not_found' ? '任务不存在。' : code === 'snapshot_required' ? '事件游标无效，请先读取任务检查点。' : '请求未完成，请检查任务状态或服务配置。', retryable: false, requestState } satisfies AiError })
export interface AiAppOptions { store?: TaskStore; engine?: TaskEngine; provider?: ProviderAdapter; bodyTimeoutMs?: number; imageEditFetch?: typeof fetch }
export function createAiApp(config: AiConfig, options: AiAppOptions = {}) {
  const store = options.store ?? options.engine?.store ?? new TaskStore(config.dataDir)
  const engine = options.engine ?? new TaskEngine(store, options.provider ?? createChatProvider(config.provider), connectionInfo(config), { maxConcurrent: config.maxConcurrent, authoringOutputTokens: config.authoringOutputTokens, preserveReasoning: config.provider.preserveReasoning })
  const baseMaps = createBaseMapService({ maxConcurrent: Math.min(config.maxConcurrent, 2), execution: {
    begin: (owner, request) => store.beginBaseMap(owner, request), measure: (token, run) => store.measureBaseMapWork(token, run), finish: (token, elapsedMs, resultHash) => store.finishBaseMap(token, elapsedMs, resultHash),
  } })
  const domainGeneration = createDomainGenerationService({ maxConcurrent: Math.min(config.maxConcurrent, 2) })
  const imageEdit = createImageEditService({ provider: config.imageEdit, dataDir: config.dataDir, fetcher: options.imageEditFetch,
    maxConcurrent: Math.min(config.maxConcurrent, 2), bodyTimeoutMs: options.bodyTimeoutMs })
  const maximumTaskBody = Math.max(VISION_LIMITS.requestBytes, CONTINUATION_POLICY.requestBytes, ...CONTINUATION_POLICIES_V2.map(policy => policy.requestBytes))
  const boundedJson = createTaskBodyReader({ maxConcurrent: config.maxConcurrent,
    maxBytes: maximumTaskBody * Math.min(config.maxConcurrent, 2), timeoutMs: options.bodyTimeoutMs })
  const app = new Hono<{ Variables: { owner: string } }>()
  const streams = new Map<string, number>()
  let streamCount = 0
  app.onError((error, context) => {
    if (error instanceof ImageEditFault) return context.json({ schemaVersion: 1, error: { code: error.code, requestState: error.requestState, retryable: false } }, error.status)
    if (error instanceof GenerationServiceFault) {
      const payload = errorPayload(error.code)
      return context.json({ ...payload, error: { ...payload.error, message: error.safeMessage } }, error.status)
    }
    return error instanceof TaskFault ? context.json(errorPayload(error.code), error.status) : context.json(errorPayload('internal_error', 'unknown'), 503)
  })
  app.use('*', async (context, next) => {
    context.header('Cache-Control', 'no-store')
    context.header('X-Content-Type-Options', 'nosniff')
    context.header('Vary', 'Origin')
    const origin = context.req.header('Origin')
    if (origin !== undefined && !config.allowedOrigins.has(origin)) return context.json(errorPayload('origin_rejected'), 403)
    if (origin !== undefined) { context.header('Access-Control-Allow-Origin', origin); context.header('Access-Control-Expose-Headers', 'Content-Type') }
    if (context.req.method === 'OPTIONS') {
      if (!origin) return context.json(errorPayload('origin_rejected'), 403)
      const method = context.req.header('Access-Control-Request-Method')
      const headers = (context.req.header('Access-Control-Request-Headers') ?? '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean)
      if (!method || !['GET', 'POST', 'DELETE'].includes(method) || headers.some(header => !['authorization', 'content-type'].includes(header))) return context.json(errorPayload('invalid_preflight'), 403)
      context.header('Access-Control-Allow-Methods', 'GET, POST, DELETE')
      context.header('Access-Control-Allow-Headers', 'Authorization, Content-Type')
      context.header('Access-Control-Max-Age', '600')
      return context.body(null, 204)
    }
    if (context.req.path === '/healthz' && context.req.method === 'GET') return next()
    const owner = authenticate(config, context.req.header('Authorization'))
    if (!owner) return context.json(errorPayload('unauthorized'), 401)
    context.set('owner', owner)
    engine.assertStorageAvailable()
    store.sweep()
    return next()
  })
  app.get('/healthz', context => context.json({ ok: true }))
  app.get('/v1/image-edit/capabilities', context => {
    if (new URL(context.req.url).search) throw new ImageEditFault('image_edit_invalid_request', 400)
    return context.json(imageEdit.capabilities)
  })
  app.post('/v1/image-edit', async context => context.json(await imageEdit.edit(context.req.raw, context.get('owner'))))
  app.get('/v1/capabilities', context => {
    if (Object.keys(context.req.query()).some(key => !['authoringVersion', 'surfaceVersion', 'baseMapSelector'].includes(key))
      || ['authoringVersion', 'surfaceVersion', 'baseMapSelector'].some(key => (context.req.queries(key)?.length ?? 0) > 1)) throw new TaskFault('invalid_request', 400)
    const requestedSelector = context.req.query('baseMapSelector')
    if (requestedSelector !== undefined) {
      if (Object.keys(context.req.query()).length !== 1) throw new TaskFault('invalid_request', 400)
      if (!(['terrain-scene-v6', 'terrain-compose-v6', 'terrain-scene-v7', 'terrain-compose-v7'] as const).includes(requestedSelector as 'terrain-scene-v6' | 'terrain-compose-v6' | 'terrain-scene-v7' | 'terrain-compose-v7')) throw new TaskFault('unsupported_base_map_selector', 400)
      if (!engine.connectionInfo.capabilities.baseMapSelectors?.includes(requestedSelector as 'terrain-scene-v6' | 'terrain-compose-v6' | 'terrain-scene-v7' | 'terrain-compose-v7')) throw new TaskFault('unsupported_base_map_selector', 400)
      const { currentAuthoring: _current, completeProjectVersions: _complete, visualReviewVersions: _review, surfaceRecipeVersions: _surfaces, baseMapSelectors: _baseMapSelectors,
        ...priorCapabilities } = engine.connectionInfo.capabilities
      return context.json({ ...engine.connectionInfo, capabilities: {
        ...priorCapabilities, authoringVersions: priorCapabilities.authoringVersions?.filter(value => value !== 4).length ? priorCapabilities.authoringVersions.filter(value => value !== 4) : undefined,
        baseMapSelectors: [requestedSelector],
      } })
    }
    const version = context.req.query('authoringVersion'), surfaceVersion = context.req.query('surfaceVersion')
    if (version !== undefined && version !== '2' && version !== '3' && version !== '4') throw new TaskFault('unsupported_authoring_version', 400)
    if (surfaceVersion !== undefined && (surfaceVersion !== '1' || version !== '3' && version !== '4')) throw new TaskFault('unsupported_surface_version', 400)
    if (version === '4') {
      const { baseMapSelectors: _baseMapSelectors, surfaceRecipeVersions: _surfaceVersions, ...currentCapabilities } = engine.connectionInfo.capabilities
      return context.json({ ...engine.connectionInfo, capabilities: { ...currentCapabilities, ...(surfaceVersion === '1' ? { surfaceRecipeVersions: [1] } : {}) } })
    }
    const { currentAuthoring: _current, completeProjectVersions: _complete, visualReviewVersions: _review, baseMapSelectors: _baseMapSelectors, ...oldCapabilities } = engine.connectionInfo.capabilities
    const legacyCapabilities = { ...oldCapabilities, authoringVersions: oldCapabilities.authoringVersions?.filter(value => value !== 4).length ? oldCapabilities.authoringVersions.filter(value => value !== 4) : undefined }
    if (version === '3' && surfaceVersion === '1') return context.json({ ...engine.connectionInfo, capabilities: { ...legacyCapabilities, surfaceRecipeVersions: [1] } })
    const { surfaceRecipeVersions: _surfaces, ...priorCapabilities } = legacyCapabilities
    if (version === '3') return context.json({ ...engine.connectionInfo, capabilities: priorCapabilities })
    if (version === '2') {
      const { budgetProfileHashes: _profiles, ...capabilities } = priorCapabilities
      return context.json({ ...engine.connectionInfo, capabilities: { ...capabilities, authoringVersions: capabilities.authoringVersions?.filter(value => value !== 3), baseMapVersions: capabilities.baseMapVersions?.filter(value => value !== 3), budgetPolicyHashes: capabilities.budgetPolicyHashes?.filter(value => value === CONTINUATION_POLICY.policyHash) } })
    }
    // Existing cached clients parse this response strictly. New capabilities
    // require explicit negotiation; the engine itself retains the full grant.
    const { authoringVersions: _authoring, baseMapVersions: _baseMap, budgetPolicyHashes: _policies, budgetProfileHashes: _profiles, ...capabilities } = priorCapabilities
    return context.json({ ...engine.connectionInfo, capabilities })
  })
  app.post('/v1/terrain/basemap', async context => context.body(await baseMaps.generate(context.req.raw, context.get('owner')), 200, { 'Content-Type': 'application/json; charset=utf-8' }))
  app.get('/v1/generation/capabilities', context => {
    if ([...new URL(context.req.url).searchParams.keys()].length) throw new TaskFault('invalid_request', 400)
    return context.json(domainGenerationCapabilities('server'))
  })
  app.post('/v1/generation', async context => context.body(await domainGeneration.generate(context.req.raw), 200, { 'Content-Type': 'application/json; charset=utf-8' }))
  app.post('/v1/tasks', async context => {
    const version = context.req.query('authoringVersion')
    if (Object.keys(context.req.query()).some(key => key !== 'authoringVersion') || (context.req.queries('authoringVersion')?.length ?? 0) > 1) throw new TaskFault('invalid_request', 400)
    if (version !== undefined && version !== '3' && version !== '4') throw new TaskFault('unsupported_authoring_version', 400)
    const limit = version === '3' || version === '4' ? Math.max(...CONTINUATION_POLICIES_V2.map(policy => policy.requestBytes)) : Math.max(VISION_LIMITS.requestBytes, CONTINUATION_POLICY.requestBytes)
    const body = await boundedJson(context.req.raw, limit)
    const parsed = CreateTaskSchema.safeParse(body)
    if (!parsed.success || version === '3' && parsed.data.authoring?.schemaVersion !== 3 || version === '4' && parsed.data.authoring?.schemaVersion !== 4 || version !== '4' && parsed.data.authoring?.schemaVersion === 4) throw new TaskFault('invalid_request', 400)
    const snapshot = engine.create(context.get('owner'), parsed.data)
    return context.json(snapshot, 201)
  })
  app.get('/v1/tasks', context => {
    if (Object.keys(context.req.query()).some(key => key !== 'sceneId' && key !== 'clientRequestId')
      || ['sceneId', 'clientRequestId'].some(key => (context.req.queries(key)?.length ?? 0) > 1)) throw new TaskFault('invalid_request', 400)
    const sceneId = context.req.query('sceneId'), clientRequestId = context.req.query('clientRequestId')
    if (sceneId !== undefined && !/^[A-Za-z0-9_.:-]{1,128}$/.test(sceneId)) throw new TaskFault('invalid_request', 400)
    if (clientRequestId !== undefined && (sceneId !== undefined || !CreateTaskSchema.shape.clientRequestId.safeParse(clientRequestId).success)) throw new TaskFault('invalid_request', 400)
    const matched = clientRequestId === undefined ? undefined : store.findByClientRequestId(context.get('owner'), clientRequestId)
    const tasks = clientRequestId === undefined ? store.list(context.get('owner'), sceneId) : matched ? [matched] : []
    const rows: string[] = []
    let bytes = utf8Size('{"schemaVersion":1,"tasks":[]}')
    for (const task of tasks) {
      const row = JSON.stringify(task)
      bytes += utf8Size(row) + (rows.length ? 1 : 0)
      if (bytes > AI_LIMITS.taskBytes) throw new TaskFault('task_list_limit', 413)
      rows.push(row)
    }
    return context.body(`{"schemaVersion":1,"tasks":[${rows.join(',')}]}`, 200, { 'Content-Type': 'application/json; charset=utf-8' })
  })
  app.get('/v1/tasks/:id', context => context.json(store.read(context.req.param('id'), context.get('owner')).snapshot))
  app.get('/v1/tasks/:id/draft', context => context.json(engine.draft(context.get('owner'), context.req.param('id'))))
  app.get('/v1/tasks/:id/draft/region-scene-candidate', context => {
    const allowed = new Set(['candidateId', 'candidateHash', 'atContentHash', 'draftRevision', 'scopeHash'])
    const query = context.req.query()
    if (Object.keys(query).some(key => !allowed.has(key)) || [...allowed].some(key => (context.req.queries(key)?.length ?? 0) !== 1)
      || !/^(0|[1-9]\d*)$/.test(query.draftRevision ?? '') || !Number.isSafeInteger(Number(query.draftRevision))) throw new TaskFault('invalid_request', 400)
    const parsed = RegionSceneCandidateQuerySchema.safeParse({ ...query, draftRevision: Number(query.draftRevision) })
    if (!parsed.success) throw new TaskFault('invalid_request', 400)
    return context.json(engine.regionSceneCandidate(context.get('owner'), context.req.param('id'), parsed.data))
  })
  app.post('/v1/tasks/:id/draft/validate', async context => {
    const parsed = DraftValidationSchema.safeParse(await boundedJson(context.req.raw))
    if (!parsed.success) throw new TaskFault('invalid_request', 400)
    return context.json(engine.validateDraft(context.get('owner'), context.req.param('id'), parsed.data))
  })
  app.post('/v1/tasks/:id/draft/claim', async context => {
    const parsed = DraftClaimSchema.safeParse(await boundedJson(context.req.raw))
    if (!parsed.success) throw new TaskFault('invalid_request', 400)
    return context.json(engine.claimDraft(context.get('owner'), context.req.param('id'), parsed.data))
  })
  app.post('/v1/tasks/:id/draft/release', async context => {
    const parsed = DraftClaimSchema.safeParse(await boundedJson(context.req.raw))
    if (!parsed.success) throw new TaskFault('invalid_request', 400)
    return context.json(engine.releaseDraft(context.get('owner'), context.req.param('id'), parsed.data))
  })
  app.post('/v1/tasks/:id/draft/applied', async context => {
    const parsed = DraftAppliedSchema.safeParse(await boundedJson(context.req.raw))
    if (!parsed.success) throw new TaskFault('invalid_request', 400)
    return context.json(engine.appliedDraft(context.get('owner'), context.req.param('id'), parsed.data))
  })
  app.post('/v1/tasks/:id/control', async context => {
    const parsed = ControlTaskSchema.safeParse(await boundedJson(context.req.raw, VISION_LIMITS.requestBytes))
    if (!parsed.success) throw new TaskFault('invalid_request', 400)
    return context.json(engine.control(context.get('owner'), context.req.param('id'), parsed.data))
  })
  app.delete('/v1/tasks/:id', context => { engine.delete(context.get('owner'), context.req.param('id')); return context.body(null, 204) })
  app.get('/v1/tasks/:id/events', context => {
    const id = context.req.param('id'), owner = context.get('owner')
    store.read(id, owner)
    const cursor = context.req.query('after') ?? '0'
    if (Object.keys(context.req.query()).some(key => key !== 'after') || (context.req.queries('after')?.length ?? 0) > 1 || !/^\d+$/.test(cursor) || !Number.isSafeInteger(Number(cursor))) throw new TaskFault('invalid_cursor', 400)
    let after = Number(cursor)
    store.events(id, after)
    if ((streams.get(owner) ?? 0) >= 2 || streamCount >= 8) throw new TaskFault('stream_limit', 429)
    streams.set(owner, (streams.get(owner) ?? 0) + 1); streamCount++
    const encoder = new TextEncoder()
    let cleanup = () => {}
    let pump = () => {}
    const body = new ReadableStream<Uint8Array>({ start(controller) {
      let closed = false, draining = false
      const finish = () => { if (closed) return; closed = true; cleanup(); controller.close() }
      const drain = () => {
        if (closed || draining) return
        draining = true
        try {
          engine.assertStorageAvailable(); store.read(id, owner)
          for (const event of store.events(id, after, 64)) {
            if ((controller.desiredSize ?? 0) <= 0) break
            after = event.sequence
            controller.enqueue(encoder.encode(`event: task\nid: ${event.sequence}\ndata: ${JSON.stringify(event)}\n\n`))
          }
          if (store.terminal(id) && after === store.read(id, owner).snapshot.lastSequence) finish()
        } catch { finish() } finally { draining = false }
      }
      const unsubscribe = store.subscribe(id, drain)
      const unsubscribeUnavailable = engine.onStorageUnavailable(finish)
      const heartbeat = setInterval(() => { if (!closed && (controller.desiredSize ?? 0) > 0) controller.enqueue(encoder.encode(': keepalive\n\n')) }, 15000)
      heartbeat.unref?.()
      const onAbort = () => finish()
      let released = false
      cleanup = () => {
        if (released) return
        released = true; closed = true
        unsubscribe(); unsubscribeUnavailable(); clearInterval(heartbeat); context.req.raw.signal.removeEventListener('abort', onAbort)
        streamCount--; const count = (streams.get(owner) ?? 1) - 1; if (count) streams.set(owner, count); else streams.delete(owner)
      }
      pump = drain
      context.req.raw.signal.addEventListener('abort', onAbort, { once: true })
      if (context.req.raw.signal.aborted) finish(); else drain()
    }, pull() { pump() }, cancel() { cleanup() } }, { highWaterMark: 32768, size: chunk => chunk.byteLength })
    context.header('Content-Type', 'text/event-stream; charset=utf-8')
    context.header('X-Accel-Buffering', 'no')
    return context.body(body)
  })
  app.notFound(context => context.json(errorPayload('not_found'), 404))
  return app
}
