import { chromium } from '@playwright/test'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:http'
import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { startResourceSampling } from './resources.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const args = process.argv.slice(2)
const argument = (name, fallback) => { const i = args.indexOf(name); return i < 0 ? fallback : args[i + 1] }
const output = path.resolve(argument('--output', 'performance-results/b5'))
const runs = Number(argument('--runs', '3'))
const editsPerKind = Number(argument('--edits', '30'))
const selections = Number(argument('--selections', '60'))
const requestedCases = argument('--cases', 'study-500,study-2000,island-500,island-2000').split(',')
const channel = argument('--channel', 'chrome')
if (![runs, editsPerKind, selections].every(value => Number.isSafeInteger(value) && value > 0)) throw new Error('runs, edits and selections must be positive integers')
if (editsPerKind % 2) throw new Error('Use an even edit count so reversible geometry returns to its initial state')
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
const hash = buffer => createHash('sha256').update(buffer).digest('hex')
const json = (name, data) => fs.writeFile(path.join(output, name), JSON.stringify(data, null, 2))
const nearestRank = (values, percentile) => [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * percentile) - 1)] ?? null
const stats = values => ({ n: values.length, min: Math.min(...values), p50: nearestRank(values, .5), p95: nearestRank(values, .95), max: Math.max(...values) })
try {
  await fs.access(path.join(output, 'manifest.json'))
  throw new Error('The output already contains a manifest; choose a new --output directory to preserve previous evidence')
} catch (error) { if (error.code !== 'ENOENT') throw error }
await fs.mkdir(output, { recursive: true })
await fs.mkdir(path.join(output, 'fixtures'), { recursive: true })
const sleepGuard = process.platform === 'darwin' ? spawn('caffeinate', ['-i', '-w', String(process.pid)], { stdio: 'ignore' }) : null
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost'), relative = decodeURIComponent(url.pathname).replace(/^\//, '')
    const base = relative.startsWith('fixtures/') ? output : path.join(root, 'dist-performance')
    const file = path.resolve(base, relative || 'index.html')
    if (!file.startsWith(base + path.sep)) { res.writeHead(403); res.end(); return }
    const bytes = await fs.readFile(file)
    const ext = path.extname(file), mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' }[ext] || 'application/octet-stream'
    res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-store' }); res.end(bytes)
  } catch { res.writeHead(404); res.end() }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${server.address().port}`
const harness = `${origin}/tools/performance/index.html`
const manifest = { startedAt: new Date().toISOString(), sourceRevision: revision, sourceDirty: execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }),
  measurementClass: runs >= 3 && editsPerKind >= 30 && selections >= 60 ? 'formal' : 'diagnostic-smoke',
  node: process.version, device: { platform: os.platform(), release: os.release(), arch: os.arch(), cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, memoryBytes: os.totalmem() },
  config: { runs, editsPerKind, selections, requestedCases, channel, headless: true, launchArgs: ['--enable-precise-memory-info'], viewport: { width: 1512, height: 1120 }, dpr: 1, osSampleIntervalMs: 100, cdpHeapIntervalMs: 200,
    decodedBitmapCache: 'none; each renderer call decodes and closes its own SHA-deduplicated bitmaps', processState: 'fresh Chrome process and profile per measured run; HTTP cache disabled; OS caches not purged',
    rendering: 'production modules, Canvas2D; drawSubmission is CPU submission; paint is two-rAF scheduling proxy' }, cases: [], failures: [] }
await json('manifest.json', manifest)
let activeBrowser = null, activeServer = null, sampler = null, currentResult = null, currentLabel = null
async function browserSession() {
  activeServer = await chromium.launchServer({ channel, headless: true, args: ['--enable-precise-memory-info'] })
  activeBrowser = await chromium.connect(activeServer.wsEndpoint())
  const context = await activeBrowser.newContext({ viewport: manifest.config.viewport, deviceScaleFactor: 1, acceptDownloads: true })
  const page = await context.newPage()
  page.setDefaultTimeout(30_000)
  // Action timeouts do not constrain evaluate promises. This is a tool watchdog, never an app performance pass threshold.
  const watchdog = setTimeout(() => { void page.close().catch(() => {}) }, 8 * 60_000)
  page.once('close', () => clearTimeout(watchdog))
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  return { page, context, errors, rootPid: activeServer.process().pid, browser: activeBrowser }
}
async function closeSession() {
  if (sampler) { await sampler.stop(); sampler = null }
  await activeBrowser?.close(); await activeServer?.close(); activeBrowser = null; activeServer = null
}
async function download(page, key, relative) {
  const pending = page.waitForEvent('download')
  await page.evaluate(({ key, relative }) => window.__sceneweavePerformance.download(key, relative.split('/').at(-1)), { key, relative })
  const item = await pending
  await item.saveAs(path.join(output, relative))
  const bytes = await fs.readFile(path.join(output, relative))
  return { path: relative, sizeBytes: bytes.length, sha256: hash(bytes) }
}
try {
  // Fixture creation and its decoding happen in a separate, subsequently closed process.
  const preparation = await browserSession()
  await preparation.page.goto(harness)
  await preparation.page.waitForFunction(() => !!window.__sceneweavePerformance)
  for (const name of requestedCases) {
    const [sample, textCount] = name.split('-'), count = Number(textCount)
    if (!['study', 'island'].includes(sample) || ![500, 2000].includes(count)) throw new Error(`Invalid case ${name}`)
    const summary = await preparation.page.evaluate(({ sample, count }) => window.__sceneweavePerformance.prepare(sample, count), { sample, count })
    const artifact = await download(preparation.page, 'fixture', `fixtures/${name}.sceneweave`)
    manifest.cases.push({ name, summary, artifact })
    console.log(`Prepared ${name}: ${artifact.sizeBytes} bytes`)
  }
  if (preparation.errors.length) throw new Error(JSON.stringify(preparation.errors))
  await closeSession(); await json('manifest.json', manifest)
  for (const item of manifest.cases) for (let run = 1; run <= runs; run++) {
    const label = `${item.name}-run-${run}`, result = { case: item.name, run, startedAt: new Date().toISOString(), edits: [], selections: [], exports: [] }
    currentResult = result; currentLabel = label
    console.log(`Measuring ${label}`)
    const { page, browser, errors, rootPid } = await browserSession()
    result.browser = browser.version()
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Performance.enable'); await cdp.send('Network.enable'); await cdp.send('Network.setCacheDisabled', { cacheDisabled: true })
    const browserCdp = await browser.newBrowserCDPSession()
    const system = await browserCdp.send('SystemInfo.getInfo')
    result.gpu = { devices: system.gpu.devices, featureStatus: system.gpu.featureStatus, renderer: system.gpu.auxAttributes?.glRenderer }
    sampler = startResourceSampling({ rootPid, cdp, intervalMs: 100, heapIntervalMs: 200 })
    sampler.setPhase('idle-before-navigation'); await page.waitForTimeout(1000)
    sampler.setPhase('runtime-navigation')
    const navStart = performance.now(); await page.goto(harness); await page.waitForFunction(() => !!window.__sceneweavePerformance)
    result.runtimeNavigationMs = performance.now() - navStart
    sampler.setPhase('cold-package-import-adopt-display')
    result.cold = await page.evaluate(file => window.__sceneweavePerformance.coldOpen(file), `${origin}/${item.artifact.path}`)
    const rect = await page.locator('canvas').boundingBox(), bounds = await page.evaluate(() => window.__sceneweavePerformance.bounds())
    const points = await page.evaluate(() => window.__sceneweavePerformance.selectionPoints())
    const toScreen = point => ({ x: rect.x + (point.x - bounds.x) / bounds.width * rect.width, y: rect.y + (point.y - bounds.y) / bounds.height * rect.height })
    const first = toScreen(points.at(-1).positionMm), blank = { x: rect.x + 1, y: rect.y + 1 }
    // Discover actual product hit-test output before collecting selection changes.
    await page.mouse.click(first.x, first.y); await page.waitForTimeout(50)
    const hit = await page.evaluate(() => window.__sceneweavePerformance.selectionState())
    await page.mouse.click(blank.x, blank.y); await page.waitForTimeout(50)
    const other = await page.evaluate(() => window.__sceneweavePerformance.selectionState())
    if (!hit || hit === other) throw new Error('Fixture does not provide two distinct actual pointer-selection states')
    result.selectionTargets = { hit, other, first, blank }
    sampler.setPhase('trusted-pointer-selection')
    for (let i = 0; i < selections; i++) {
      await page.evaluate(() => { Reflect.set(window, '__b5Paint', window.__sceneweavePerformance.selectionBegin()); Reflect.set(window, '__b5SelectStart', performance.now()) })
      const point = i % 2 ? blank : first
      await page.mouse.click(point.x, point.y)
      const sample = await page.evaluate(async () => {
        const end = await Reflect.get(window, '__b5Paint')
        return window.__sceneweavePerformance.selectionRead(Reflect.get(window, '__b5SelectStart'), end)
      })
      result.selections.push(sample)
      if (sample.selected !== (i % 2 ? other : hit)) throw new Error('Trusted click selected an unexpected entity')
    }
    sampler.setPhase('supported-property-and-contour-edit-save')
    for (let i = 0; i < editsPerKind; i++) for (const kind of ['prop', 'contour']) {
      result.edits.push(await page.evaluate(({ kind, ordinal }) => window.__sceneweavePerformance.edit(kind, ordinal), { kind, ordinal: i }))
    }
    sampler.setPhase('repository-reopen')
    result.reopen = await page.evaluate(() => window.__sceneweavePerformance.reopen())
    for (const audience of ['gm', 'player']) {
      sampler.setPhase(`export-4k-${audience}`)
      const exported = await page.evaluate(audience => window.__sceneweavePerformance.png(audience), audience)
      result.exports.push(exported)
    }
    sampler.setPhase('over-limit-failure-edit-undo')
    result.failureRecovery = await page.evaluate(() => window.__sceneweavePerformance.failureRecovery())
    if (run === 1) {
      sampler.setPhase('complete-project-backup')
      await page.evaluate(() => window.__sceneweavePerformance.complete())
    }
    // All measured product export phases precede the additional 4K audit canvases.
    sampler.setPhase('tooling-pixel-audit-and-download')
    for (const exported of result.exports) {
      Object.assign(exported, await page.evaluate(audience => window.__sceneweavePerformance.auditPng(audience), exported.audience))
      const expected = item.name.startsWith('study') ? [4096, 2926] : [4096, 3686]
      if (exported.width !== expected[0] || exported.height !== expected[1]) throw new Error('Wrong fixed 4K dimensions')
      if (run === 1) exported.artifact = await download(page, exported.audience, `${item.name}-${exported.audience}-4096.png`)
    }
    if (run === 1) {
      result.complete = await download(page, 'complete', `${item.name}-edited.sceneweave`)
      await page.screenshot({ path: path.join(output, `${item.name}-selected.png`) })
    }
    result.observations = await page.evaluate(() => window.__sceneweavePerformance.observations())
    if (result.observations.nativeDecodeConcurrencyPeak > 1) throw new Error('Native image decoder concurrency exceeded the shared single-slot budget')
    sampler.setPhase('idle-after-workload'); await page.waitForTimeout(2000)
    result.resources = await sampler.stop(); sampler = null
    const resourceSummary = result.resources.summary
    result.resourceEvidenceStatus = resourceSummary.rootPresentSampleCount > 0 && resourceSummary.heapValueSampleCount > 0 && resourceSummary.errorCount === 0 ? 'sampled' : 'incomplete'
    result.productRssSampledPeakBytes = Math.max(...Object.entries(resourceSummary.byPhase).filter(([phase]) => !phase.startsWith('tooling-') && phase !== 'idle-after-workload').map(([, value]) => value.rssPeakBytes || 0))
    result.errors = errors
    result.finishedAt = new Date().toISOString()
    result.statistics = {
      selectionHandlerMs: stats(result.selections.map(s => s.handlerMs)), selectionDisplayProxyMs: stats(result.selections.map(s => s.eventToPaintMs)),
      selectionCanvasCopyMs: stats(result.selections.map(s => s.eventToCanvasCopyMs)),
      commitMs: stats(result.edits.map(e => e.commitMs)), editDisplayProxyMs: stats(result.edits.map(e => e.displayProxyMs)),
      rendererDrawSubmissionMs: stats(result.edits.flatMap(e => e.renders.map(r => r.drawSubmissionMs))),
      repositorySaveMs: stats(result.observations.saves.filter(s => s.startMs >= result.edits[0].startMs && s.endMs <= result.edits.at(-1).endMs).map(s => s.durationMs)),
      propCommitMs: stats(result.edits.filter(e => e.kind === 'prop').map(e => e.commitMs)),
      contourCommitMs: stats(result.edits.filter(e => e.kind === 'contour').map(e => e.commitMs)),
    }
    await json(`${label}.json`, result)
    if (errors.length) throw new Error(JSON.stringify(errors))
    if (result.resourceEvidenceStatus !== 'sampled') throw new Error('Resource sampling evidence incomplete; see raw sampler errors')
    console.log(`Complete ${label}: commit p95=${result.statistics.commitMs.p95.toFixed(1)}ms, edit display p95=${result.statistics.editDisplayProxyMs.p95.toFixed(1)}ms`)
    await closeSession()
    currentResult = null; currentLabel = null
  }
  manifest.finishedAt = new Date().toISOString(); manifest.status = 'complete'
} catch (error) {
  manifest.status = 'failed'; manifest.failures.push({ at: new Date().toISOString(), message: String(error), stack: error.stack })
  console.error(error); process.exitCode = 1
  if (currentResult) {
    currentResult.failure = manifest.failures.at(-1)
    if (sampler) { currentResult.resources = await sampler.stop(); sampler = null }
    await json(`${currentLabel}-partial-failure.json`, currentResult)
  }
} finally {
  await closeSession(); await json('manifest.json', manifest)
  await new Promise(resolve => server.close(resolve)); sleepGuard?.kill()
}
