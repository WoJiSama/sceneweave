import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { startNativeFixtureTooling } from './prepare-native-m2-fixture.mjs'
import { fingerprintPaths, MODULE_SOURCE_PATHS, assertFrozen } from './frozen-input.mjs'

const args = process.argv.slice(2), arg = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback
if (args.includes('--help')) {
  console.log('node tools/performance/run-storage-scale.mjs --source ABS --input ABS_SCENEWEAVE --output ABS_NEW_DIRECTORY [--matrix 1:2,5:2,1:20]')
  console.log('Real Chrome/native IndexedDB component attribution, not normal-production UI timing. Each isolated context prepares owner:history-save counts through validated repository APIs, reopens the repository, fully cold-loads, then saves one cold and two warm title revisions. Method spans include descendants; do not add. No persisted counters or integrity checks are bypassed.')
  process.exit(0)
}
const source = path.resolve(arg('--source', path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')))
const input = arg('--input'), output = arg('--output'), matrix = arg('--matrix', '1:2,5:2,1:20').split(',').map(item => item.split(':').map(Number))
if (![input, output].every(v => v && path.isAbsolute(v)) || !matrix.every(([owners, history]) => Number.isSafeInteger(owners) && owners >= 1 && owners <= 10 && Number.isSafeInteger(history) && history >= 0 && history <= 100)) throw new Error('Expected absolute paths and bounded owner:history matrix')
await fs.mkdir(output, { recursive: true }); if ((await fs.readdir(output)).length) throw new Error('Evidence directory must be empty')
const bytes = await fs.readFile(input), sha = value => createHash('sha256').update(value).digest('hex')
const toolRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const fingerprints = async () => ({ source: await fingerprintPaths(source, MODULE_SOURCE_PATHS),
  tools: await fingerprintPaths(toolRoot, ['tools/performance/run-storage-scale.mjs', 'tools/performance/frozen-input.mjs', 'tools/performance/prepare-native-m2-fixture.mjs']),
  input: sha(await fs.readFile(input)) })
const frozen = await fingerprints()
const report = { format: 'sceneweave-storage-scale-component', version: 1, status: 'running', startedAt: new Date().toISOString(),
  device: { platform: os.platform(), cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, memoryBytes: os.totalmem(), node: process.version },
  input: { sha256: sha(bytes), byteLength: bytes.length }, source, frozen, fingerprint: sha(JSON.stringify(frozen)), matrix, cases: [],
  limitations: ['Component attribution with source modules and method timers, not normal production UI or formal timing.',
    'Prepared title-only saves have no editor local-transaction receipt. Their generic delta cost does not represent immediate Prop UI edits.',
    'Inclusive spans overlap. Native DB, CPU, decoding and scheduling waits are not separately attributed.',
    'Each case owns a fresh browser context and test-only database. No user profile or source DB is changed.'] }
const write = () => fs.writeFile(path.join(output, 'analysis.json'), JSON.stringify(report, null, 2))
await write()
let tooling, browser
try {
  tooling = await startNativeFixtureTooling({ root: source })
  browser = await chromium.launch({ channel: arg('--channel', 'chrome'), headless: true }); report.browser = browser.version()
  for (const [owners, history] of matrix) {
    assertFrozen(frozen, await fingerprints(), 'source/input/tools before case')
    console.log(`Storage scale: owners=${owners} history=${history}`)
    const context = await browser.newContext()
    try {
      const page = await context.newPage()
      page.on('console', event => {
        const prefix = 'SCENEWEAVE_HISTORY_DIAGNOSTIC '
        if (event.text().startsWith(prefix)) {
          report.workerDiagnostics ??= []
          if (report.workerDiagnostics.length >= 100) throw new Error('Unexpected diagnostic output volume')
          report.workerDiagnostics.push(JSON.parse(event.text().slice(prefix.length)))
        }
      })
      await page.goto(tooling.url)
      const row = await page.evaluate(async ({ base64, owners, history }) => {
        const filePath = '/src/shared/project/file.ts', resourcesPath = '/src/shared/project/resources.ts'
        const repositoryPath = '/src/platform/browser/storage/repository.ts', runtimePath = '/src/platform/browser/runtime.ts'
        const [{ importProject }, { tryDerivedProjectBundle, validateProjectSnapshot }, { ProjectRepository }, { runtime, validation }] = await Promise.all([
          import(filePath), import(resourcesPath), import(repositoryPath), import(runtimePath)])
        const binary = atob(base64), bytes = Uint8Array.from(binary, value => value.charCodeAt(0))
        const original = await importProject(bytes, validation)
        const name = `sceneweave-projects-dev-v1-${[...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(crypto.randomUUID())))].map(v => v.toString(16).padStart(2, '0')).join('')}`
        const make = () => new ProjectRepository({ name, runtime, validation })
        let repo = make(), current
        const next = (bundle, title) => {
          const candidate = { project: { ...bundle.project, document: { ...bundle.project.document,
            title, revision: bundle.project.document.revision + 1, updatedAt: new Date().toISOString() } }, resources: bundle.resources }
          const result = tryDerivedProjectBundle(candidate, bundle)
          if (!result) throw new Error('Expected exact verified resource closure')
          return result
        }
        const setupStarted = performance.now()
        for (let owner = 0; owner < owners; owner++) {
          let installed = (await repo.importSnapshotArchive({ current: original, snapshots: [] })).project
          for (let version = 0; version < history; version++) {
            const candidate = next(installed, `scale ${owner}/${version}`)
            await repo.saveSnapshot(candidate, installed.project.document.revision); installed = candidate
          }
          if (owner === 0) current = installed
        }
        const setupMs = performance.now() - setupStarted, owner = current.project.document.sceneId
        repo.close(); repo = make()
        const spans = [], wrap = (object, name, label) => {
          const original = object[name]
          object[name] = async function (...args) {
            const start = performance.now(); let failed = false
            try { return await original.apply(this, args) } catch (error) { failed = true; throw error }
            finally { spans.push({ name: label ?? name, ms: performance.now() - start, failed }) }
          }
        }
        for (const name of ['scanTotals', 'putResources', 'saveWithValidation']) wrap(repo, name)
        wrap(repo.history, 'audit', 'history.audit')
        const openedAt = performance.now(), loaded = await repo.load(owner), coldLoadMs = performance.now() - openedAt
        if (!loaded) throw new Error('Cold project disappeared')
        current = await validateProjectSnapshot(loaded, validation)
        const saves = [], longTasks = [], beats = []
        const observer = new PerformanceObserver(list => longTasks.push(...list.getEntries().map(entry => ({ start: entry.startTime, ms: entry.duration }))))
        observer.observe({ type: 'longtask' })
        let lastBeat = performance.now()
        const heartbeat = setInterval(() => { const now = performance.now(); beats.push({ start: lastBeat, ms: now - lastBeat }); lastBeat = now }, 50)
        for (let i = 0; i < 3; i++) {
          const candidate = next(current, `measured ${i}`), count = spans.length, start = performance.now()
          await repo.saveSnapshot(candidate, current.project.document.revision)
          const end = performance.now()
          // Allow queued observer/timer delivery after the measured interval.
          // These diagnostics describe page responsiveness, not worker CPU.
          await new Promise(resolve => setTimeout(resolve, 80))
          const tasks = longTasks.filter(task => task.start < end && task.start + task.ms > start)
          const gaps = beats.filter(beat => beat.start < end && beat.start + beat.ms > start)
          saves.push({ kind: i ? 'warm' : 'cold-first', ms: end - start, spans: spans.slice(count), responsiveness: {
            longTasks: tasks, longestTaskMs: Math.max(0, ...tasks.map(task => task.ms)),
            longTaskTotalMs: tasks.reduce((sum, task) => sum + task.ms, 0),
            maximumHeartbeatIntervalMs: Math.max(0, ...gaps.map(beat => beat.ms)), heartbeatIntervalMs: 50,
          } }); current = candidate
        }
        clearInterval(heartbeat); observer.disconnect()
        const counts = Object.fromEntries(await Promise.all(['projects', 'historyVersions', 'resources', 'projectContentBlocks'].map(async table => [table, await repo.database.table(table).count()])))
        const usage = await repo.usage(owner); repo.close()
        return { owners, history, setupMs, coldLoadMs, saves, counts, usage }
      }, { base64: bytes.toString('base64'), owners, history })
      assertFrozen(frozen, await fingerprints(), 'source/input/tools after case')
      report.cases.push({ status: 'complete', ...row }); await write()
    } finally { await context.close() }
  }
  report.status = 'complete'
} catch (error) { report.status = 'failed'; report.error = error.stack ?? String(error); process.exitCode = 1; console.error(error) }
finally { await browser?.close(); await tooling?.close(); report.endedAt = new Date().toISOString(); await write() }
