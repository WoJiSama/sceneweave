import { serve } from '@hono/node-server'
import { pathToFileURL } from 'node:url'
import { connectionInfo, createAiApp } from './app.js'
import { loadAiConfig } from './config.js'
import type { AiConfig } from './config.js'
import { createChatProvider } from './chat-provider.js'
import { TaskStore } from './store.js'
import { TaskEngine } from './engine.js'

export function startAiServer(config: AiConfig = loadAiConfig()) {
  const store = new TaskStore(config.dataDir)
  const engine = new TaskEngine(store, createChatProvider(config.provider), connectionInfo(config), { maxConcurrent: config.maxConcurrent })
  const app = createAiApp(config, { store, engine })
  const server = serve({ fetch: app.fetch, hostname: config.host, port: config.port })
  const cleanup = setInterval(() => store.sweep(), 3600000)
  cleanup.unref()
  let closed = false
  const close = () => {
    if (closed) return
    closed = true; clearInterval(cleanup); engine.close(); store.close(); server.close()
  }
  return { app, server, store, engine, close }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const running = startAiServer()
    process.once('SIGINT', () => { running.close() })
    process.once('SIGTERM', () => { running.close() })
    // Deliberately omit provider URL, credentials, request bodies and task text from logs.
    process.stdout.write('Sceneweave AI service listening.\n')
  } catch {
    process.stderr.write('Sceneweave AI service could not start; check server configuration and private storage.\n')
    process.exitCode = 1
  }
}
