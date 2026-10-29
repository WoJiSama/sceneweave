import { connectionInfo } from './app.js'
import { createChatProvider } from './chat-provider.js'
import { loadAiConfig, type AiConfig } from './config.js'
import { TaskEngine } from './engine.js'
import { createProviderCooldown } from './request-scheduler.js'
import { TaskStore } from './store.js'

/** Construct a bounded serial runner. This does not create/resume any task or send a request. */
export function createControlledTaskRunner(config: AiConfig = loadAiConfig(), options: { cooldownMs?: number; lastCompletedAt?: number; now?: () => number; fetchImpl?: typeof fetch } = {}) {
  const scheduler = createProviderCooldown(options.cooldownMs ?? 10000, { now: options.now, lastCompletedAt: options.lastCompletedAt })
  const provider = createChatProvider(config.provider, options.fetchImpl)
  const store = new TaskStore(config.dataDir, { now: options.now })
  let engine: TaskEngine
  try { engine = new TaskEngine(store, provider, connectionInfo(config), { now: options.now, maxConcurrent: config.maxConcurrent,
    authoringOutputTokens: config.authoringOutputTokens, preserveReasoning: config.provider.preserveReasoning, requestScheduler: scheduler }) }
  catch (error) { store.close(); throw error }
  let closed = false
  return { store, engine, close() { if (closed) return; closed = true; engine.close(); store.close() } }
}
