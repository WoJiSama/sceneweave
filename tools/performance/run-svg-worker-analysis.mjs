import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { startNativeFixtureTooling } from './prepare-native-m2-fixture.mjs'
import { fingerprintPaths, MODULE_SOURCE_PATHS, assertFrozen, contentSha256 } from './frozen-input.mjs'

const args = process.argv.slice(2), arg = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback
if (args.includes('--help')) { console.log('node tools/performance/run-svg-worker-analysis.mjs --source ABS --input ABS_SCENEWEAVE --output ABS_NEW [--rounds 3]'); process.exit(0) }
const source = arg('--source'), input = arg('--input'), output = arg('--output'), rounds = Number(arg('--rounds', '3'))
if (![source, input, output].every(value => value && path.isAbsolute(value)) || !Number.isSafeInteger(rounds) || rounds < 1 || rounds > 10) throw new Error('Expected absolute paths and bounded rounds')
await fs.mkdir(output, { recursive: true }); if ((await fs.readdir(output)).length) throw new Error('Evidence directory must be empty')
const bytes = await fs.readFile(input), frozen = await fingerprintPaths(source, MODULE_SOURCE_PATHS)
const toolRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const toolPaths = ['tools/performance/run-svg-worker-analysis.mjs', 'tools/performance/frozen-input.mjs', 'tools/performance/prepare-native-m2-fixture.mjs']
const frozenTools = await fingerprintPaths(toolRoot, toolPaths)
const report = { format: 'sceneweave-svg-worker-component-analysis', version: 1, status: 'running', startedAt: new Date().toISOString(), source, frozen,
  frozenTools,
  input: { sha256: contentSha256(bytes), byteLength: bytes.length }, device: { platform: os.platform(), cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length },
  limitations: ['Source-module component comparison, not production UI or formal timing.', 'Same page, alternating order, full actual source/dimensions and RGBA audit. No browser image quality substitution.',
    'Long tasks and 16ms heartbeat are scheduling observations, not input-to-photon or complete responsiveness proof.', 'Setup/import, warmup, output hashing and cancellation checks are outside measured batches. Background competition is not excluded.'] }
const write = () => fs.writeFile(path.join(output, 'analysis.json'), JSON.stringify(report, null, 2))
let browser, tooling
try {
  await write(); tooling = await startNativeFixtureTooling({ root: source }); browser = await chromium.launch({ channel: arg('--channel', 'chrome'), headless: true })
  report.browser = browser.version()
  const page = await browser.newPage(); await page.goto(tooling.url)
  report.result = await page.evaluate(async ({ base64, rounds }) => {
    const paths = ['/src/shared/project/file.ts', '/src/platform/browser/runtime.ts', '/src/shared/ai/svg.ts', '/src/platform/browser/ai/svg-raster.ts', '/src/platform/browser/ai/svg-worker-client.ts']
    const [{ importProject }, { validation }, { normalizeStaticSvg }, { rasterizeCanonicalSvgPixels }, { rasterizeCanonicalSvgInWorker, disposeCanonicalSvgWorkers }] = await Promise.all(paths.map(path => import(path)))
    const bundle = await importProject(Uint8Array.from(atob(base64), char => char.charCodeAt(0)), validation)
    const tasks = []
    for (const [id, source] of Object.entries(bundle.project.authoringSources)) {
      if (source.processorVersion !== 2) throw new Error('Fixed canonical SVG processor 2 required')
      const dimensions = bundle.project.document.assets[id], bytes = await bundle.resources.read(source.sourceSha256)
      tasks.push({ id, source: normalizeStaticSvg(new TextDecoder().decode(bytes)), width: dimensions.pixelWidth, height: dimensions.pixelHeight })
    }
    if (!tasks.length) throw new Error('Input has no canonical SVG sources')
    const execute = (mode, task) => (mode === 'main' ? rasterizeCanonicalSvgPixels : rasterizeCanonicalSvgInWorker)(task.source, { width: task.width, height: task.height })
    // Initialize both fixed WASM instances before the alternating warm batches.
    await execute('main', tasks[0]); await Promise.all(tasks.slice(0, 2).map(task => execute('worker', task)))
    const longTasks = [], observer = new PerformanceObserver(list => longTasks.push(...list.getEntries().map(entry => ({ startTime: entry.startTime, duration: entry.duration }))))
    observer.observe({ type: 'longtask', buffered: true })
    const batches = []
    for (let round = 0; round < rounds; round++) for (const mode of round % 2 ? ['worker', 'main'] : ['main', 'worker']) {
      await new Promise(resolve => setTimeout(resolve, 50))
      const gaps = []; let last = performance.now()
      const timer = setInterval(() => { const now = performance.now(); gaps.push(now - last); last = now }, 16)
      const start = performance.now(), outputs = []
      // Same admission count as the validator. Main execution remains on its
      // own event loop; worker execution uses the bounded real service.
      for (let i = 0; i < tasks.length; i += 2) outputs.push(...await Promise.all(tasks.slice(i, i + 2).map(task => execute(mode, task))))
      const end = performance.now()
      await new Promise(resolve => setTimeout(resolve, 32)); clearInterval(timer)
      longTasks.push(...observer.takeRecords().map(entry => ({ startTime: entry.startTime, duration: entry.duration })))
      const relevant = longTasks.filter(entry => entry.startTime < end && entry.startTime + entry.duration > start)
      const hashes = []
      for (let i = 0; i < outputs.length; i++) {
        const value = outputs[i], hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', value.rgba))].map(byte => byte.toString(16).padStart(2, '0')).join('')
        hashes.push({ id: tasks[i].id, width: value.width, height: value.height, rgbaSha256: hash })
      }
      batches.push({ round: round + 1, mode, ms: end - start, heartbeatGapsMs: gaps, heartbeatMaxMs: gaps.length ? Math.max(...gaps) : null,
        longTasks: relevant, longestTaskMs: relevant.length ? Math.max(...relevant.map(value => value.duration)) : 0, hashes })
    }
    observer.disconnect(); disposeCanonicalSvgWorkers()
    if (new Set(batches.map(row => JSON.stringify(row.hashes))).size !== 1) throw new Error('Actual canonical RGBA mismatch')
    // An admitted real worker is terminated; no usable output may escape.
    const controller = new AbortController()
    const task = rasterizeCanonicalSvgInWorker(tasks[0].source, { width: 2048, height: 2048 }, controller.signal)
    // Admission runs in a microtask; cancel the real cold worker while it is
    // loading/rasterizing, rather than rejecting only a pre-aborted queue item.
    await new Promise(resolve => setTimeout(resolve, 0))
    controller.abort(); let cancellation = false
    try { await task } catch (error) { if (error.name !== 'AbortError') throw error; cancellation = true }
    disposeCanonicalSvgWorkers()
    return { taskCount: tasks.length, pixelsPerBatch: tasks.reduce((sum, task) => sum + task.width * task.height, 0), batches, actualRgbaEqual: true, cancellation }
  }, { base64: bytes.toString('base64'), rounds })
  assertFrozen(frozen, await fingerprintPaths(source, MODULE_SOURCE_PATHS), 'SVG component source')
  assertFrozen(frozenTools, await fingerprintPaths(toolRoot, toolPaths), 'SVG component tools')
  if (contentSha256(await fs.readFile(input)) !== report.input.sha256) throw new Error('Input drift')
  report.status = 'complete'
} catch (error) { report.status = 'failed'; report.error = error.stack ?? String(error); process.exitCode = 1; console.error(error) }
finally { await browser?.close(); await tooling?.close(); report.endedAt = new Date().toISOString(); await write() }
