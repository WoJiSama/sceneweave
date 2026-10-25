import { createServer } from 'vite'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

// This server belongs only to fixture preparation. It serves the existing strict
// readers/converter and real browser image adapter, never the measured product.
// No legacy UI, application entry point or measurement API is installed here.
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

// These functions execute only in the dedicated preparation browser. Module
// singletons keep the same journal/repository between capture and reread.
export async function beginNativeFixturePreparation(bytes) {
  const conversionPath = '/src/application/migration/conversion.ts', runtimePath = '/src/platform/browser/runtime.ts'
  const { beginProjectFileConversion } = await import(conversionPath)
  const { projectRepository, runtime, validation } = await import(runtimePath)
  const begun = await beginProjectFileConversion(Uint8Array.from(bytes), { repository: projectRepository, runtime, validation })
  if (!begun.backup || begun.reused || begun.job.stage !== 'captured') throw new Error('Fresh fixture capture must create a complete preservation set and fixed journal')
  return { jobId: begun.job.jobId, index: Array.from(begun.backup.index),
    volumes: [...begun.backup.volumes].map(([name, value]) => ({ name, bytes: Array.from(value) })) }
}

export async function completeNativeFixturePreparation({ jobId, index, volumes }) {
  const conversionPath = '/src/application/migration/conversion.ts', runtimePath = '/src/platform/browser/runtime.ts', projectPath = '/src/shared/project/file.ts'
  const { continueProjectConversion } = await import(conversionPath)
  const { projectRepository, runtime, validation } = await import(runtimePath)
  const { exportProject } = await import(projectPath)
  const completed = await continueProjectConversion({ jobId, sourcePolicy: 'require-unchanged',
    backup: { index: Uint8Array.from(index), volumes: new Map(volumes.map(({ name, bytes }) => [name, Uint8Array.from(bytes)])) } },
  { repository: projectRepository, runtime, validation })
  if (completed.job.stage !== 'verified' || completed.reused || completed.sourceState !== 'unchanged') throw new Error('Fixture preparation did not finish strict cold-read publication')
  return { bytes: Array.from(await exportProject(completed.bundle, validation)),
    job: { jobId: completed.job.jobId, stage: completed.job.stage, targetSceneId: completed.job.targetSceneId,
      sourceFingerprint: completed.job.sourceFingerprint, backupReceipt: completed.job.backupReceipt } }
}
