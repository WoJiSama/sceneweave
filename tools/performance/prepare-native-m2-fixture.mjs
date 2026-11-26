import { createServer } from 'vite'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

// Serve fixture preparation and diagnostic modules in an isolated browser context.
export async function startNativeFixtureTooling({ root }) {
  const pathname = '/__sceneweave_fixture__/index.html'
  const cacheDirectory = await mkdtemp(path.join(tmpdir(), 'sceneweave-native-fixture-'))
  let server
  try {
    server = await createServer({
      root, configFile: false, base: '/', cacheDir: cacheDirectory, logLevel: 'error',
      server: { host: '127.0.0.1', port: 0, hmr: false, fs: { allow: [root, cacheDirectory] } },
      optimizeDeps: { noDiscovery: true, include: ['dexie', 'fflate', 'zod'] },
      plugins: [{ name: 'native-fixture-tooling', configureServer(instance) {
        instance.middlewares.use((request, response, next) => {
          if (request.url !== pathname) { next(); return }
          response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
          response.end('<!doctype html><meta charset="utf-8"><link rel="icon" href="data:,"><title>Native fixture preparation</title>')
        })
      } }],
    })
    await server.listen()
    const origin = `http://127.0.0.1:${server.httpServer.address().port}`
    return { origin, url: `${origin}${pathname}`, close: async () => { try { await server.close() } finally { await rm(cacheDirectory, { recursive: true, force: true }) } } }
  } catch (error) {
    try { await server?.close() } finally { await rm(cacheDirectory, { recursive: true, force: true }) }
    throw error
  }
}
