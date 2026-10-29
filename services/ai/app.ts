import { timingSafeEqual } from 'node:crypto'
import { Hono } from 'hono'
import { AI_LIMITS, ConnectionInfoSchema, ControlTaskSchema, CreateTaskSchema } from '../../src/shared/ai/protocol.js'
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

export function connectionInfo(config: AiConfig): ConnectionInfo {
  return ConnectionInfoSchema.parse({ schemaVersion: 1, model: config.provider.model, ...(config.provider.visionModel ? { visionModel: config.provider.visionModel } : {}), reasoningEffort: config.provider.reasoningEffort ?? null, authoringOutputTokens: config.authoringOutputTokens ?? AI_LIMITS.maxOutputTokensPerRequest, protocol: 'chat-completions',
    capabilities: { conversation: true, connectionTool: true, sceneDraft: true, svg: true, vision: config.provider.vision ?? 'unverified', taskReasoningEffort: true }, retentionDays: AI_LIMITS.retentionDays,
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
async function boundedJson(request: Request, limit: number = AI_LIMITS.requestBytes) {
  if (!(request.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) throw new TaskFault('invalid_request', 400)
  const declared = request.headers.get('content-length')
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > limit)) throw new TaskFault('request_limit', 413)
  if (!request.body) throw new TaskFault('invalid_request', 400)
  const reader = request.body.getReader(), parts: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const value = await reader.read()
      if (value.done) break
      size += value.value.byteLength
      if (size > limit) { await reader.cancel(); throw new TaskFault('request_limit', 413) }
      parts.push(value.value)
    }
    const bytes = new Uint8Array(size)
    let offset = 0; for (const part of parts) { bytes.set(part, offset); offset += part.byteLength }
    let value: unknown
    try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown } catch { throw new TaskFault('invalid_request', 400) }
    if (size > AI_LIMITS.requestBytes && (!value || typeof value !== 'object' || (!Object.hasOwn(value, 'authoring') && !Object.hasOwn(value, 'vision')))) throw new TaskFault('request_limit', 413)
    return value
  } finally { reader.releaseLock() }
}
const errorPayload = (code: string, requestState: AiError['requestState'] = 'not_sent') => ({ schemaVersion: 1 as const, error: { code, message: code === 'unauthorized' ? '需要有效的应用访问凭据。' : code === 'origin_rejected' ? '此站点未获准访问任务服务。' : code === 'not_found' ? '任务不存在。' : code === 'snapshot_required' ? '事件游标无效，请先读取任务检查点。' : '请求未完成，请检查任务状态或服务配置。', retryable: false, requestState } satisfies AiError })
export interface AiAppOptions { store?: TaskStore; engine?: TaskEngine; provider?: ProviderAdapter }
export function createAiApp(config: AiConfig, options: AiAppOptions = {}) {
  const store = options.store ?? options.engine?.store ?? new TaskStore(config.dataDir)
  const engine = options.engine ?? new TaskEngine(store, options.provider ?? createChatProvider(config.provider), connectionInfo(config), { maxConcurrent: config.maxConcurrent, authoringOutputTokens: config.authoringOutputTokens, preserveReasoning: config.provider.preserveReasoning })
  const baseMaps = createBaseMapService({ maxConcurrent: Math.min(config.maxConcurrent, 2) })
  const app = new Hono<{ Variables: { owner: string } }>()
  const streams = new Map<string, number>()
  let streamCount = 0
  app.onError((error, context) => error instanceof TaskFault ? context.json(errorPayload(error.code), error.status) : context.json(errorPayload('internal_error', 'unknown'), 503))
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
  app.get('/v1/capabilities', context => context.json(engine.connectionInfo))
  app.post('/v1/terrain/basemap', async context => context.body(await baseMaps.generate(context.req.raw), 200, { 'Content-Type': 'application/json; charset=utf-8' }))
  app.post('/v1/tasks', async context => {
    const body = await boundedJson(context.req.raw, VISION_LIMITS.requestBytes)
    const parsed = CreateTaskSchema.safeParse(body)
    if (!parsed.success) throw new TaskFault('invalid_request', 400)
    const snapshot = engine.create(context.get('owner'), parsed.data)
    return context.json(snapshot, 201)
  })
  app.get('/v1/tasks', context => {
    if (Object.keys(context.req.query()).some(key => key !== 'sceneId') || (context.req.queries('sceneId')?.length ?? 0) > 1) throw new TaskFault('invalid_request', 400)
    const sceneId = context.req.query('sceneId')
    if (sceneId !== undefined && !/^[A-Za-z0-9_.:-]{1,128}$/.test(sceneId)) throw new TaskFault('invalid_request', 400)
    return context.json({ schemaVersion: 1, tasks: store.list(context.get('owner'), sceneId) })
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
