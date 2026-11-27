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
export async function startHarnessTooling(root, listen = false, editor = false) {
  const pathname = '/__sceneweave_harness__/index.html'
  const cacheDirectory = await mkdtemp(path.join(tmpdir(), 'sceneweave-harness-'))
  let server
  try {
    server = await createServer({
      // Use the same virtual starter content as the normal editor.
      root, configFile: path.join(root, 'vite.config.ts'), base: '/', cacheDir: cacheDirectory, logLevel: 'error',
      server: { host: '127.0.0.1', port: listen ? await privatePort() : 0, strictPort: true, hmr: false,
        // These short-lived invocations have no live reload.
        watch: null,
        fs: { strict: true, allow: [root, cacheDirectory] } },
      optimizeDeps: { noDiscovery: !editor, include: ['dexie', 'fflate', 'zod', 'polygon-clipping',
        ...(editor ? ['react', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'lucide-react'] : [])] },
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
      mapAuthoring: () => server.ssrLoadModule('/src/shared/generation/map-authoring.ts'),
      workflows: () => server.ssrLoadModule('/src/shared/ai/workflows/entry.ts'),
      forestLoop: () => server.ssrLoadModule('/src/shared/ai/forest-loop.ts'),
      budget: () => server.ssrLoadModule('/src/shared/budget/task-budget.ts'),
      png: () => server.ssrLoadModule('/src/shared/project/png-rgba.ts'),
      imageWorkStorage: () => server.ssrLoadModule('/src/shared/image-import/work-archive-storage.ts'),
      close: async () => { try { await server.close() } finally { await rm(cacheDirectory, { recursive: true, force: true }) } },
    }
  } catch (error) {
    try { await server?.close() } finally { await rm(cacheDirectory, { recursive: true, force: true }) }
    throw error
  }
}

export async function openHarnessContext(browser, origin) {
  const context = await browser.newContext({ serviceWorkers: 'block' }), errors = []
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)))
  await context.route('**/*', route => route.request().url().startsWith(`${origin}/`) ? route.continue() : route.abort('blockedbyclient'))
  await context.addInitScript(() => {
    IDBFactory.prototype.open = () => { throw new Error('Local harness cannot open browser databases') }
    IDBFactory.prototype.deleteDatabase = () => { throw new Error('Local harness cannot delete browser databases') }
  })
  return { context, errors }
}
