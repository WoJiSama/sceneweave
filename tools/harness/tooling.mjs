import { createServer } from 'vite'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createServer as createNetServer } from 'node:net'

async function privatePort() {
  const probe = createNetServer()
  await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(0, '127.0.0.1', resolve) })
  const port = probe.address().port
  await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()))
  return port
}

/** A private source adapter, never the product page or a user's browser profile. */
export async function startHarnessTooling(root, listen = false) {
  const pathname = '/__sceneweave_harness__/index.html'
  const cacheDirectory = await mkdtemp(path.join(tmpdir(), 'sceneweave-harness-'))
  let server
  try {
    server = await createServer({
      root, configFile: false, base: '/', cacheDir: cacheDirectory, logLevel: 'error',
      server: { host: '127.0.0.1', port: listen ? await privatePort() : 0, strictPort: true, hmr: false, fs: { strict: true, allow: [root, cacheDirectory] } },
      optimizeDeps: { noDiscovery: true, include: ['dexie', 'fflate', 'zod', 'polygon-clipping'] },
      plugins: [{ name: 'semantic-generation-harness', configureServer(instance) {
        instance.middlewares.use((request, response, next) => {
          if (request.url !== pathname) { next(); return }
          response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
          response.end('<!doctype html><meta charset="utf-8"><link rel="icon" href="data:,"><title>Sceneweave local generation</title>')
        })
      } }],
    })
    if (listen) await server.listen()
    const origin = listen ? `http://127.0.0.1:${server.httpServer.address().port}` : undefined
    return {
      origin, url: origin && `${origin}${pathname}`,
      sdk: () => server.ssrLoadModule('/src/application/workspace/semantic-generation.ts'),
      budget: () => server.ssrLoadModule('/src/shared/budget/task-budget.ts'),
      close: async () => { try { await server.close() } finally { await rm(cacheDirectory, { recursive: true, force: true }) } },
    }
  } catch (error) {
    try { await server?.close() } finally { await rm(cacheDirectory, { recursive: true, force: true }) }
    throw error
  }
}
