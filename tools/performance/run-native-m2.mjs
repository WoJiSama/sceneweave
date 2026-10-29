import { chromium } from '@playwright/test'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:http'
import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { unzipSync } from 'fflate'
import { isDeepStrictEqual } from 'node:util'
import { copyArchivedFixtures } from './archived-fixtures.mjs'
import { copyVisualV2Fixtures } from './visual-v2-fixtures.mjs'
import { closeMeasuredBrowser } from './close-browser.mjs'
import { startResourceSampling } from './resources.mjs'
import { installNativeM2Observer } from './native-m2-observer.mjs'
import { installDiagnosticStageObserver } from './diagnostic-stages.mjs'
import { summarizeNativeM2 } from './summarize-native-m2.mjs'
import { startNativeFixtureTooling, beginNativeFixturePreparation, completeNativeFixturePreparation } from './prepare-native-m2-fixture.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'), args = process.argv.slice(2)
if (args.includes('--help')) {
  console.log('node tools/performance/run-native-m2.mjs --output ABS (--fixtures ABS | --visual-v2-fixtures ABS) [--dist ABS] [--cases study-500,study-2000,island-500,island-2000] [--runs 3] [--selections 30] [--edits 10] [--layers 10] [--appearances 5] [--restores 3] [--menus 10] [--gestures 3] [--wait-timeout-ms 120000] [--case-timeout-ms 3600000] [--channel chrome] [--diagnostic] [--diagnostic-profile]')
  console.log('Measured operations use only the normal production UI. Fixture preparation uses an isolated tooling server/browser with strict reader, disk-reread preservation set and fixed-journal conversion, closed before measurement. Empty independent output directory required. Run serially without other browser/test/build work. Reduced samples/matrix are diagnostic. --diagnostic-profile always excludes the run from formal evidence and records the first ordinary-edit and first restore-protect-adopt-save in each case/run at a 1000us CDP sampling interval. Continuous gestures contain 30 rAF-paced pointer moves or 20 rAF-paced wheel inputs. No GPU/presentation or full QA pass is inferred.')
  console.log('--visual-v2-fixtures imports exact independent complete-v2 Q1/Q2 packages, preserves SVG/PNG/license bytes and never uses the legacy B5 converter. It adds 30-move real curve-handle drag, explicit preview/confirmed adoption and ordinary UI undo per gesture. Native-v1 remains the default --fixtures path; result classes stay separate.')
  console.log('--diagnostic-stages requires --dist from diagnostic-stages.mjs. It records inclusive function spans/counts in the same production UI, always diagnostic; nested/overlapping spans must not be summed. Normal dist rejects this flag, and instrumented dist cannot enter formal measurement.')
  process.exit(0)
}
const argument = (name, fallback) => { const i = args.indexOf(name); return i < 0 ? fallback : args[i + 1] }
const output = argument('--output', null), fixtureDirectory = argument('--fixtures', null), dist = path.resolve(argument('--dist', path.join(root, 'dist')))
const visualFixtureDirectory = argument('--visual-v2-fixtures', null), visualV2 = visualFixtureDirectory !== null, expectedSchemaVersion = visualV2 ? 2 : 1
const channel = argument('--channel', 'chrome'), requestedCases = argument('--cases', 'study-500,study-2000,island-500,island-2000').split(',')
const diagnosticStages = args.includes('--diagnostic-stages')
const diagnosticProfile = args.includes('--diagnostic-profile'), diagnostic = args.includes('--diagnostic') || diagnosticProfile || diagnosticStages
const waitTimeoutMs = Number(argument('--wait-timeout-ms', '120000'))
const caseTimeoutMs = Number(argument('--case-timeout-ms', '3600000'))
const counts = Object.fromEntries(Object.entries({ runs: 3, selections: 30, edits: 10, layers: 10, appearances: 5, restores: 3, menus: 10, gestures: 3 }).map(([key, value]) => [key, Number(argument(`--${key}`, String(value)))]))
const check = (condition, message) => { if (!condition) throw new Error(message) }, hash = bytes => createHash('sha256').update(bytes).digest('hex')
check(output && path.isAbsolute(output) && (fixtureDirectory === null) !== (visualFixtureDirectory === null) && path.isAbsolute(visualFixtureDirectory ?? fixtureDirectory), '--output ABS and exactly one of --fixtures ABS / --visual-v2-fixtures ABS are required')
check(Object.values(counts).every(value => Number.isSafeInteger(value) && value > 0), 'Sample counts must be positive integers')
check(Number.isSafeInteger(waitTimeoutMs) && waitTimeoutMs > 0 && waitTimeoutMs <= 10 * 60_000, '--wait-timeout-ms must be a positive integer no greater than 600000')
check(Number.isSafeInteger(caseTimeoutMs) && caseTimeoutMs > waitTimeoutMs && caseTimeoutMs <= 2 * 60 * 60_000, '--case-timeout-ms must exceed the sample timeout and be no greater than 7200000')
check(requestedCases.length && new Set(requestedCases).size === requestedCases.length && requestedCases.every(name => /^(study|island)-(500|2000)$/.test(name)), 'Expected unique B5 case names')
const formal = !diagnostic && requestedCases.length === 4 && Object.entries({ runs: 3, selections: 30, edits: 10, layers: 10, appearances: 5, restores: 3, menus: 10, gestures: 3 }).every(([key, min]) => counts[key] >= min)
try { check((await fs.readdir(output)).length === 0, 'Output must be empty; existing evidence will not be overwritten') } catch (error) { if (error.code !== 'ENOENT') throw error }
await fs.mkdir(output, { recursive: true })
const writeJson = (name, value, exclusive = false) => fs.writeFile(path.join(output, name), JSON.stringify(value, null, 2), exclusive ? { flag: 'wx' } : undefined)
async function fingerprints(directory, relative = '') {
  const files = []
  for (const entry of await fs.readdir(path.join(directory, relative), { withFileTypes: true })) {
    const name = path.join(relative, entry.name)
    if (entry.isDirectory()) files.push(...await fingerprints(directory, name))
    else if (entry.isFile()) { const bytes = await fs.readFile(path.join(directory, name)); files.push({ path: name, sizeBytes: bytes.length, sha256: hash(bytes) }) }
  }
  return files.sort((a, b) => a.path.localeCompare(b.path))
}
const html = await fs.readFile(path.join(dist, 'index.html'), 'utf8')
check(!html.includes('/@vite/client'), 'Expected a normal production build')
let stageInstrumentation = null
try { stageInstrumentation = JSON.parse(await fs.readFile(path.join(dist, 'diagnostic-stages.json'), 'utf8')) } catch (error) { if (error.code !== 'ENOENT') throw error }
check(diagnosticStages === !!stageInstrumentation, 'Instrumented dist requires --diagnostic-stages; that flag requires a separate diagnostic build')
if (diagnosticStages) check(stageInstrumentation.format === 'sceneweave-diagnostic-stages' && stageInstrumentation.version === 1, 'Unknown stage instrumentation')
if (diagnosticStages) for (const entry of stageInstrumentation.sourceFiles) check(hash(await fs.readFile(path.join(root, entry.name))) === entry.sha256, `Diagnostic build source changed: ${entry.name}`)
const servedBase = /<script[^>]+src="([^"]+\/assets\/)/.exec(html)?.[1]?.replace(/assets\/$/, '') ?? '/'
const allowIncidentalFavicon404 = !/<link\b[^>]*\brel\s*=\s*["'][^"']*\bicon\b/i.test(html)
const runnerFiles = ['run-native-m2.mjs', 'diagnostic-stages.mjs', 'prepare-native-m2-fixture.mjs', 'native-m2-observer.mjs', 'summarize-native-m2.mjs', 'summarize-c5.mjs', 'resources.mjs', 'archived-fixtures.mjs', 'close-browser.mjs', ...(visualV2 ? ['visual-v2-fixtures.mjs', 'visual-v2-fixtures-browser.ts'] : [])]
const manifest = {
  format: 'sceneweave-native-m2-performance', version: 1, startedAt: new Date().toISOString(), status: 'running',
  measurementClass: diagnosticStages ? 'diagnostic-instrumented-stage-observation' : visualV2 ? diagnosticProfile ? 'diagnostic-visual-v2-cpu-profile' : formal ? 'formal-visual-v2-production-ui-observation' : 'diagnostic-visual-v2-production-ui'
    : diagnosticProfile ? 'diagnostic-native-m2-cpu-profile' : formal ? 'formal-native-m2-production-ui-observation' : 'diagnostic-native-m2-production-ui',
  sourceRevision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  sourceDirty: execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }),
  runners: await Promise.all(runnerFiles.map(async name => { const bytes = await fs.readFile(path.join(root, 'tools/performance', name)); return { path: `tools/performance/${name}`, sizeBytes: bytes.length, sha256: hash(bytes) } })),
  node: process.version, device: { platform: os.platform(), release: os.release(), arch: os.arch(), cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, memoryBytes: os.totalmem() },
  source: await fingerprints(path.join(root, 'src')),
  sourceInputs: await Promise.all(['package.json', 'package-lock.json', 'vite.config.ts', 'tsconfig.json'].map(async name => { const bytes = await fs.readFile(path.join(root, name)); return { path: name, sizeBytes: bytes.length, sha256: hash(bytes) } })),
  build: await fingerprints(dist),
  config: { ...counts, requestedCases, channel, diagnostic, diagnosticProfile, diagnosticStages, stageInstrumentation, waitTimeoutMs, caseTimeoutMs, fixtureMode: visualV2 ? 'exact-native-visual-v2' : 'archived-b5-conversion', expectedSchemaVersion, route: '#home', viewport: { width: 1512, height: 982 }, dpr: 1,
    processState: 'Fresh dedicated headless Chrome process and profile per case/run; HTTP cache disabled, OS caches not purged. macOS caffeinate prevents idle sleep only.',
    fixturePreparation: visualV2 ? 'Exact independent complete-v2 Q1/Q2 fixture packages are copied, byte-hashed and disk-reread. Every ZIP entry and scene2/visual1 identity/count/source/marker is checked. Full actual SVG/PNG pixels, licenses and native scene validation occur in each normal product cold import. No legacy/B5 conversion, no tooling browser during measurement. Original refined benchmarks are preserved in the fixture archive. Two small user layers are added through UI; only the independent image marker is moved to M2 Focus, keeping measured transactions within 256.'
      : 'Exact original B5 strict-v2 packages are captured by the strict reader in a separate tooling-only Vite/Chrome process per case. Every preservation file is written to disk and reread before the fixed-journal converter performs its full resource validation and cold-read publication. The resulting native complete-v1 package is exported, saved and hashed. No retired legacy UI is used. The tooling server is closed before measured runs. Each measured case/run uses only the normal frozen production build in a fresh independent Chrome process and imports that exact native package. Two small user layers are added through UI; only the marker is moved to M2 Focus, keeping measured transactions within 256.',
    ...(visualV2 ? { curveInputs: { movesPerDrag: 30, trialsPerRun: counts.gestures, method: 'Trusted SVG control-handle pointerdown, 30 rAF-paced pointermoves, pointerup; the draft stays outside persistence. Ordinary visible preview and full-scope confirmation/adoption are measured separately. Ordinary visible UI undo resets the original curve and bound coordinates after every adoption; it never rewrites topology with an opposite command. Interior uses explicit decorative yard border; island uses the bound real q1-coast.' } } : {}),
    localReopen: 'Reload the normal home page without clearing localStorage or IndexedDB, then click the one available native recent-project Open button. The timed interval starts at this trusted click; reload and the read-only repository comparison are setup.',
    intent: diagnosticStages ? 'Trusted DOM/event capture plus explicitly instrumented function-body spans in a separate diagnostic build. Timer/await overhead is retained; this is never formal measurement.' : 'Trusted capture of the committing click, Enter keydown, file change, selection pointerup, contextmenu or first continuous input. The tool observes DOM/events; it never wraps product functions, Canvas, React or storage.',
    domainCommit: 'Exact page performance.now captured by Native Workspace after all domain validation, identity/freeze/undo updates and before publish. DOM data-transaction-revision must match the new data-revision. Import/open/name are separate operations and do not claim a domain edit commit.',
    completion: 'DOM revision, Canvas base render counter with map aria-busy=false, local-save status and double-rAF are separate observations. A retained preview raster can be reused on adoption. Double-rAF is a scheduling proxy, never GPU or physical display completion.',
    continuousInputs: { panPointerMoves: 30, wheelInputs: 20, pacing: 'One requestAnimationFrame awaited before every Playwright input; input timestamps, gaps, trusted event counts, view state and frame intervals retained. Wheel is continuous positive deltaY=12. Fit reset is outside each measured gesture.' },
    networkAudit: { allowIncidentalFavicon404, policy: 'Retain every HTTP response URL/status, failed request, console error with source location and CDP browser log error. Only same-origin /favicon.ico with no query, status 404, no declared HTML icon, and a matching resource-load console/log source URL is incidental. All other HTTP errors and unexpected console/browser log errors fail the run. Canceled ERR_ABORTED requests are retained separately.' },
    cpuProfile: { enabled: diagnosticProfile, phase: 'first ordinary-edit and first restore-protect-adopt-save per case/run', samplingIntervalUs: 1000,
      boundary: 'CDP Profiler.start before the first ordinary-edit field fill/arm or first protection/adoption click arm; stop after that sample has reached the same revision domain commit, DOM, Canvas ready, saved status and double-rAF proxy. Includes field preparation and automation/observer waits. Profile serialization is outside the sample; all profiled runs are diagnostic only.' },
    limits: ['Original fixtures retain their original extent/grid; this runner does not claim a 50 by 50 displayed grid.', 'RSS is sampled macOS dedicated-process-tree sum and can double-count shared pages; JS heap is target CDP metrics, not GPU or total physical memory.', 'Tooling audit phases include package downloads, readonly IndexedDB hashing and output verification. Their peaks are separated from product phases; phase-boundary samples remain raw.', 'Real UI operations are automated headless Chrome observations, not human UX, cross-browser, VTT import, or a complete QA-PERF-04 pass.', 'Formal runs use no CPU profiling. Optional diagnostic profiling adds overhead and is restricted to the first ordinary-edit and protection/adoption; no tracing, forced GC, heap snapshot or source/dev API. Observer, automation, frame and resource polling overhead are included.', 'A Node wall gap above 5 seconds or browser wall/monotonic discontinuity above 250 ms invalidates the run. Slow renderer samples are retained.'],
  }, fixturePreparation: [], cases: [], results: [], failures: [], teardowns: [],
}
manifest.sourceFingerprint = hash(JSON.stringify({ source: manifest.source, inputs: manifest.sourceInputs }))
manifest.buildFingerprint = hash(JSON.stringify(manifest.build))
await writeJson('manifest.json', manifest)
const server = createServer(async (req, res) => {
  try {
    const requested = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
    const relative = (servedBase !== '/' && requested.startsWith(servedBase) ? requested.slice(servedBase.length - 1) : requested).replace(/^\//, '')
    const file = path.resolve(dist, relative || 'index.html')
    if (!file.startsWith(`${dist}${path.sep}`)) { res.writeHead(403); res.end(); return }
    const bytes = await fs.readFile(file), mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' }[path.extname(file)] ?? 'application/octet-stream'
    res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-store' }); res.end(bytes)
  } catch { res.writeHead(404); res.end() }
})
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
const origin = `http://127.0.0.1:${server.address().port}`, pageUrl = `${origin}${servedBase}#home`
const sleepGuard = process.platform === 'darwin' ? spawn('caffeinate', ['-i', '-w', String(process.pid)], { stdio: 'ignore' }) : null
sleepGuard?.on('error', () => {})
let browserServer = null, browser = null, page = null, sampler = null, result = null, label = null, interruption = null, lastPrintedKind = null, fixtureTooling = null
const listeners = new Set()
const interrupt = message => { if (!interruption) { interruption = new Error(message); for (const listener of listeners) listener(interruption) } }
const handleSigint = () => interrupt('Runner canceled by SIGINT')
const handleSigterm = () => interrupt('Runner canceled by SIGTERM')
process.once('SIGINT', handleSigint); process.once('SIGTERM', handleSigterm)
let previousTick = Date.now()
const suspensionMonitor = setInterval(() => { const wall = Date.now(), gap = wall - previousTick; previousTick = wall; if (gap > 5000) interrupt(`Runner event loop wall gap ${gap}ms exceeds interruption limit`) }, 500)
suspensionMonitor.unref()
function guarded(promise) {
  return new Promise((resolve, reject) => {
    if (interruption) { void promise.catch(() => {}); reject(interruption); return }
    const fail = error => { listeners.delete(fail); reject(error) }; listeners.add(fail)
    void promise.then(value => { listeners.delete(fail); resolve(value) }, error => { listeners.delete(fail); reject(error) })
  })
}
const probe = () => page.evaluate(() => Reflect.get(window, '__sceneweaveNativeM2Probe').snapshot())
const frames = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
const nextFrame = () => page.evaluate(() => new Promise(requestAnimationFrame))
async function ready() {
  await page.waitForFunction(schemaVersion => document.querySelector('[data-testid="outdoor-workbench"]')?.getAttribute('data-native-format') === `sceneweave-complete-project@${schemaVersion}` && document.querySelector('.asset-save')?.textContent.trim() === '本地已保存' && document.querySelector('.asset-map-wrap')?.getAttribute('aria-busy') === 'false' && !document.querySelector('.asset-busy') && !document.querySelector('.native-app-content[inert]'), expectedSchemaVersion, { timeout: waitTimeoutMs })
  await page.locator('canvas[aria-label="材质场景主持人预览"],canvas[aria-label="材质场景玩家预览"]').waitFor({ state: 'visible' }); await frames()
}
async function refine() {
  await frames()
  const exposed = await page.locator('.asset-viewport').evaluate(node => node.hasAttribute('data-refinement-count'))
  if (exposed) await page.waitForFunction(() => {
    const node = document.querySelector('.asset-viewport'), detail = document.querySelector('.asset-detail-preview')
    return Number(node?.getAttribute('data-refinement-count')) > 0 && node?.getAttribute('data-refinement-pending') === 'false' && detail instanceof HTMLCanvasElement && detail.width > 0 && detail.height > 0 && getComputedStyle(detail).display !== 'none'
  })
  let previous = await probe()
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(320)
    const state = await probe()
    if (!previous.refinementPending && !state.refinementPending && state.refinementCount === previous.refinementCount && state.mapBusy === 'false') return { refinementCount: state.refinementCount, pending: false, stableForMs: 320, attempts: i + 1 }
    previous = state
  }
  throw new Error('Viewport refinement did not stabilize in setup')
}
async function measure(kind, ordinal, options, action) {
  if (interruption) throw interruption
  if (lastPrintedKind !== kind) { console.log(`Native M2 ${label}: ${kind} #${ordinal + 1}`); lastPrintedKind = kind }
  result.pendingAction = { kind, ordinal, armedAt: new Date().toISOString() }
  if (diagnosticStages) await page.evaluate(({ kind, ordinal }) => Reflect.get(globalThis, '__sceneweaveDiagnosticStages').start(kind, ordinal), { kind, ordinal })
  await page.evaluate(options => Reflect.get(window, '__sceneweaveNativeM2Probe').arm(options), { kind, ordinal, ...options })
  await action()
  if (options.externalEnd) await page.evaluate(() => Reflect.get(window, '__sceneweaveNativeM2Probe').endInputs())
  await page.waitForFunction(() => Reflect.get(window, '__sceneweaveNativeM2Probe').read()?.complete, null, { timeout: waitTimeoutMs })
  const sample = await page.evaluate(() => Reflect.get(window, '__sceneweaveNativeM2Probe').read())
  if (diagnosticStages) {
    sample.diagnosticStages = await page.evaluate(() => Reflect.get(globalThis, '__sceneweaveDiagnosticStages').finish())
    check(sample.diagnosticStages.dropped === 0, `${kind}: diagnostic stage capacity exceeded`)
  }
  check(sample.intent?.trusted, `${kind}: missing trusted intent event`)
  check(sample.events.every(event => event.trusted), `${kind}: untrusted input in measured scope`)
  sample.intentToHandlerBubbleMs = sample.handlerBubbleMs === undefined ? null : sample.handlerBubbleMs - sample.intent.captureMs
  sample.intentToDomainCommitMs = sample.domainCommittedAtMs === undefined ? null : sample.domainCommittedAtMs - sample.intent.captureMs
  sample.intentToDomRevisionMs = sample.domRevisionMs === undefined ? null : sample.domRevisionMs - sample.intent.captureMs
  sample.intentToRasterReadyMs = sample.rasterReadyMs === undefined ? null : sample.rasterReadyMs - sample.intent.captureMs
  sample.intentToSavedMs = sample.savedReadyMs === undefined ? null : sample.savedReadyMs - sample.intent.captureMs
  sample.intentToDomReadyMs = sample.domReadyMs - sample.intent.captureMs
  sample.intentToDisplayProxyMs = sample.displayProxyMs - sample.intent.captureMs
  sample.domainCommitToDomRevisionMs = sample.domRevisionMs === undefined || sample.domainCommittedAtMs === undefined ? null : sample.domRevisionMs - sample.domainCommittedAtMs
  sample.browserClockDiscontinuityMs = (sample.clockAtDisplay.wallMs - sample.clockAtArm.wallMs) - (sample.clockAtDisplay.monotonicMs - sample.clockAtArm.monotonicMs)
  check(Math.abs(sample.browserClockDiscontinuityMs) <= 250, `${kind}: browser clocks diverged, possible host suspension`)
  if (options.domainCommit) check(sample.domainCommittedAtMs >= sample.intent.captureMs && sample.after.transactionRevision === sample.expectedRevision && sample.after.revision === sample.expectedRevision, `${kind}: exact transaction timestamp/revision mismatch`)
  if (options.unchangedDocument) check(sample.before.revision === sample.after.revision && sample.before.save === sample.after.save, `${kind}: transient UI changed document/save state`)
  const end = sample.endInput?.captureMs ?? sample.externalEndMs ?? sample.displayProxyMs
  sample.activeInputFrameGapMs = sample.frameIntervals.filter(entry => entry.startMs >= sample.intent.captureMs && entry.endMs <= end).map(entry => entry.durationMs)
  sample.frameGapMs = sample.frameIntervals.map(entry => entry.durationMs)
  result.samples.push(sample); delete result.pendingAction
  return sample
}
const buttonStart = name => ({ event: 'click', selector: 'button', button: 0, label: name })
async function transaction(kind, ordinal, action, { requireRaster = false, ...rest } = {}) {
  const before = await probe()
  return measure(kind, ordinal, { start: { event: 'click', selector: 'button', button: 0 }, expectedRevision: before.revision + 1,
    domainCommit: true, requireSaved: true, requireRaster, ...rest }, action)
}
const canvasBox = () => page.getByLabel('材质场景主持人预览', { exact: true }).boundingBox()
const screenPoint = (box, bounds, point) => ({ x: box.x + (point.x - bounds.x) / bounds.width * box.width, y: box.y + (point.y - bounds.y) / bounds.height * box.height })
async function markerClick(item) {
  const box = await canvasBox(); check(box?.width > 0, 'Missing visible map canvas')
  const point = screenPoint(box, item.summary.worldBoundsMm, item.summary.selectionPointMm)
  await page.mouse.click(point.x, point.y)
}
async function marquee(item) {
  const box = await canvasBox(), bounds = item.summary.worldBoundsMm
  const first = screenPoint(box, bounds, { x: bounds.x + 100, y: bounds.y + 100 }), last = screenPoint(box, bounds, { x: bounds.x + bounds.width - 100, y: bounds.y + bounds.height - 100 })
  const visible = await page.locator('.asset-viewport').evaluate((node, points) => {
    const rect = node.getBoundingClientRect()
    return points.every(point => point.x > rect.left && point.x < rect.right && point.y > rect.top && point.y < rect.bottom && node.contains(document.elementFromPoint(point.x, point.y)))
  }, [first, last])
  check(visible, 'Marquee setup requires both world endpoints inside the visible, unobstructed viewport')
  await page.mouse.move(first.x, first.y); await page.mouse.down()
  for (let i = 1; i <= 8; i++) { await nextFrame(); await page.mouse.move(first.x + (last.x - first.x) * i / 8, first.y + (last.y - first.y) * i / 8) }
  await page.mouse.up()
}
function expectedProps(scene, bounds) {
  const left = bounds.x + 100, right = bounds.x + bounds.width - 100, top = bounds.y + 100, bottom = bounds.y + bounds.height - 100
  return Object.values(scene.props).filter(prop => {
    if (prop.editLocked || [...Object.values(scene.prefabInstances), ...Object.values(scene.scatterGroups)].some(group => group.editLocked && Object.values(group.members).some(member => member.propId === prop.id))) return false
    const v = prop.visualBoundsMm, a = prop.rotationDeg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a)
    return [[v.x, v.y], [v.x + v.width, v.y], [v.x + v.width, v.y + v.height], [v.x, v.y + v.height]].every(([x, y]) => {
      const px = prop.positionMm.x + x * c - y * s, py = prop.positionMm.y + x * s + y * c
      return px >= left && px <= right && py >= top && py <= bottom
    })
  }).map(prop => prop.id).sort()
}
async function storageAudit({ includeResources = true } = {}) {
  return page.evaluate(async ({ includeResources, visualV2 }) => {
    const digest = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('')
    const normalize = async value => {
      if (ArrayBuffer.isView(value)) return { bytes: value.byteLength, sha256: await digest(value) }
      if (value instanceof ArrayBuffer) return { bytes: value.byteLength, sha256: await digest(value) }
      if (value instanceof Blob) return { blob: { bytes: value.size, type: value.type, sha256: await digest(await value.arrayBuffer()) } }
      if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) { const bytes = value instanceof ArrayBuffer ? value : value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength); return { bytes: bytes.byteLength, sha256: await digest(bytes) } }
      if (Array.isArray(value)) return Promise.all(value.map(normalize))
      if (value && typeof value === 'object') return Object.fromEntries(await Promise.all(Object.keys(value).sort().map(async key => [key, await normalize(value[key])])))
      return value
    }
    const databases = await indexedDB.databases(), entry = databases.find(item => item.name === 'sceneweave-projects')
    if (!entry) throw new Error('No native complete-v1 repository')
    const db = await new Promise((resolve, reject) => { const request = indexedDB.open(entry.name); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) })
    const rows = {}, stores = []
    try {
      for (const name of [...db.objectStoreNames].sort()) {
        if (!includeResources && ['resources', 'licenseTexts', 'legacyBlobs'].includes(name)) continue
        const data = await new Promise((resolve, reject) => {
          const transaction = db.transaction(name, 'readonly'), store = transaction.objectStore(name), keys = store.getAllKeys(), values = store.getAll()
          transaction.oncomplete = () => resolve({ keys: keys.result, values: values.result }); transaction.onerror = () => reject(transaction.error); transaction.onabort = () => reject(transaction.error)
        })
        rows[name] = data.values
        stores.push({ name, count: data.keys.length, sha256: await digest(new TextEncoder().encode(JSON.stringify(await normalize(data)))) })
      }
    } finally { db.close() }
    return { database: entry.name, version: entry.version, allDatabases: databases.map(item => item.name).sort(), stores,
      scenes: (rows.projects ?? []).map(row => ({ sceneId: row.sceneId, revision: row.revision, contentHash: row.contentHash, format: row.project.format,
        documentSchemaVersion: row.project.document.schemaVersion, identityVersion: row.project.historyIdentity.version,
        propCount: Object.keys(row.project.document.props).length, title: row.project.document.title, grid: row.project.document.grid, worldBoundsMm: row.project.document.exportBoundsMm,
        props: row.project.document.props, userLayers: row.project.document.userLayers, entityLayers: row.project.document.entityLayers,
        ...(visualV2 ? { visual: row.project.document.visual, terrainAreas: row.project.document.terrainAreas } : {}) })),
      automatic: (rows.automaticSnapshots ?? []).map(row => ({ revision: row.revision, contentHash: row.contentHash })),
      named: (rows.snapshots ?? []).filter(row => row.kind === 'named').map(row => ({ id: row.id, name: row.name, sourceRevision: row.sourceRevision, contentHash: row.contentHash })),
      protection: (rows.snapshots ?? []).filter(row => row.kind === 'protection').map(row => ({ id: row.id, sourceRevision: row.sourceRevision, contentHash: row.contentHash })), metadata: rows.historyMetadata ?? [] }
  }, { includeResources, visualV2 })
}
function packageSnapshot(bytes) {
  const files = unzipSync(bytes), parse = name => files[name] ? JSON.parse(new TextDecoder().decode(files[name])) : null
  const container = parse('manifest.json'), scene = parse('scene.json'), identity = parse('identity.json')
  check(container?.format === 'sceneweave-complete-project' && container.schemaVersion === expectedSchemaVersion && container.packageMode === 'complete'
    && scene?.format === 'sceneweave-scene' && scene.schemaVersion === expectedSchemaVersion && identity?.version === 1 && (!visualV2 || scene.visual?.version === 1), `Expected a strict native complete-v${expectedSchemaVersion} package`)
  check(container.sceneId === scene.sceneId && container.revision === scene.revision, 'Native package manifest identity mismatch')
  check(Object.keys(files).length === container.entries.length + 1, 'Native package has undeclared or missing entries')
  for (const entry of container.entries) check(files[entry.path]?.length === entry.sizeBytes && hash(files[entry.path]) === entry.sha256, `Native package byte/hash mismatch: ${entry.path}`)
  return { format: container.format, schemaVersion: container.schemaVersion, packageMode: container.packageMode, documentSchemaVersion: scene.schemaVersion,
    sceneId: scene.sceneId, revision: scene.revision, identityVersion: identity.version, propCount: Object.keys(scene.props).length,
    entries: container.entries.map(entry => ({ path: entry.path, role: entry.role, sizeBytes: entry.sizeBytes, sha256: entry.sha256 })).sort((a, b) => a.path.localeCompare(b.path)) }
}
async function backup(name) {
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: '完整工程', exact: true }).click()
  const download = await pending; await download.saveAs(path.join(output, name)); await ready()
  const bytes = await fs.readFile(path.join(output, name))
  return { path: name, sizeBytes: bytes.length, sha256: hash(bytes), snapshot: packageSnapshot(bytes) }
}
async function plainEdit(item, kind, ordinal, value) {
  const field = page.getByLabel('物件 X', { exact: true })
  await field.fill(String(value))
  const before = await probe()
  const sample = await measure(kind, ordinal, { start: { event: 'keydown', selector: 'input[aria-label="物件 X"]', key: 'Enter' }, expectedRevision: before.revision + 1, domainCommit: true, requireRaster: true, requireSaved: true }, () => field.press('Enter'))
  sample.request = { id: item.summary.editablePropId, property: 'positionMm.x', value }
  return sample
}
async function measureVisualCurve(item) {
  const request = item.summary.curveEdit
  check(request && request.segment === 0 && request.handle === 'control1', 'Fixture curve edit contract missing')
  sampler.setPhase('tooling-audit-curve-before')
  const beforeStorage = await storageAudit({ includeResources: false }), initial = beforeStorage.scenes[0]
  const originalCurve = initial.visual.boundaries[request.boundaryId]
  check(originalCurve && originalCurve.binding.kind === request.binding, 'Curve workload/binding differs from package')
  const originalGeometry = JSON.stringify(Object.fromEntries(Object.entries(initial.terrainAreas).map(([id, area]) => [id, area.boundaryMm.map(point => point.positionMm)])))
  await page.getByRole('button', { name: '适应全图', exact: true }).click(); await ready(); await refine()
  await page.getByRole('tablist', { name: '工坊侧栏', exact: true }).getByRole('tab', { name: '视觉', exact: true }).click()
  const panel = page.getByRole('region', { name: '视觉场景创作', exact: true })
  await panel.getByRole('button', { name: '边界', exact: true }).click()
  for (let ordinal = 0; ordinal < counts.gestures; ordinal++) {
    sampler.setPhase('curve-drag-setup')
    const select = panel.getByLabel('视觉已有曲线', { exact: true })
    await select.selectOption(''); await select.selectOption(request.boundaryId)
    const handle = page.getByTestId('curve-handle-0-control1'); await handle.waitFor({ state: 'visible' })
    const position = await handle.boundingBox(), box = await canvasBox()
    check(position && box, 'Curve control handle/canvas has no real screen box')
    const start = { x: position.x + position.width / 2, y: position.y + position.height / 2 }, beforePoint = { x: Number(await handle.getAttribute('cx')), y: Number(await handle.getAttribute('cy')) }
    check(beforePoint.x === originalCurve.segments[0].control1.x && beforePoint.y === originalCurve.segments[0].control1.y, 'UI undo failed to reset original control')
    const dx = request.deltaMm.x / item.summary.worldBoundsMm.width * box.width, dy = request.deltaMm.y / item.summary.worldBoundsMm.height * box.height
    await page.mouse.move(start.x, start.y)
    sampler.setPhase('continuous-curve-draft')
    const sample = await measure('continuous-curve-draft', ordinal, { start: { event: 'pointerdown', selector: '.visual-controls', button: 0 }, eventScope: '.visual-controls', externalEnd: true,
      endEvent: { event: 'pointerup', selector: '.visual-controls', button: 0 }, unchangedDocument: true, requireSaved: true }, async () => {
      await page.mouse.down()
      for (let move = 1; move <= 30; move++) { await nextFrame(); await page.mouse.move(start.x + dx * move / 30, start.y + dy * move / 30) }
      await page.mouse.up()
    })
    const afterPoint = { x: Number(await handle.getAttribute('cx')), y: Number(await handle.getAttribute('cy')) }
    check(sample.eventCounts.pointermove === 30 && afterPoint.x === beforePoint.x + request.deltaMm.x && afterPoint.y === beforePoint.y + request.deltaMm.y, 'Curve draft requires exactly 30 actual moves and the declared exact control delta')
    sample.request = { ...request, beforePoint, actualDraftPoint: afterPoint, screenDeltaPx: { x: dx, y: dy } }
    sampler.setPhase('curve-preview')
    await measure('curve-preview', ordinal, { start: buttonStart('预览曲线与边带'), until: { preview: true }, unchangedDocument: true, requireRaster: true }, () => panel.getByRole('button', { name: '预览曲线与边带', exact: true }).click())
    const preview = page.locator('.asset-structure-preview'), affectedIds = (await preview.getByLabel('待采用视觉操作 ID', { exact: true }).inputValue()).split('\n')
    check(affectedIds.includes(request.boundaryId) && new Set(affectedIds).size === affectedIds.length && isDeepStrictEqual([...affectedIds].sort(), request.expectedAffectedIds)
      && Number.isSafeInteger(request.expandedWriteCost) && request.expandedWriteCost > 0 && request.expandedWriteCost <= 256,
    'Curve preview differs from its fully validated exact affected closure/write budget; unchanged read-only support dependants are separate from writes')
    await preview.getByLabel('确认完整影响范围', { exact: true }).check()
    sampler.setPhase('curve-adopt-save')
    const adopted = await transaction('curve-adopt-save', ordinal, () => preview.getByRole('button', { name: '采用视觉修改', exact: true }).click(), { until: { preview: false } })
    adopted.affectedIds = affectedIds
    sampler.setPhase('curve-undo-save')
    await transaction('curve-undo-save', ordinal, () => page.getByRole('button', { name: '撤销素材编辑', exact: true }).click(), { requireRaster: true })
  }
  sampler.setPhase('tooling-audit-curve-after')
  const afterStorage = await storageAudit({ includeResources: false }), final = afterStorage.scenes[0]
  check(isDeepStrictEqual(final.visual, initial.visual), 'Curve drag/adoption/undo changed the original final visual fields')
  check(JSON.stringify(Object.fromEntries(Object.entries(final.terrainAreas).map(([id, area]) => [id, area.boundaryMm.map(point => point.positionMm)]))) === originalGeometry, 'Curve undo failed to restore bound physical coordinates')
  check(isDeepStrictEqual(final.props, initial.props), 'Curve edit changed unrelated props')
  result.correctness.realCurveDragPreviewAdoptUndo = true
  result.curveWorkload = { ...request, trials: counts.gestures, originalControl: originalCurve.segments[0].control1, finalVisualAndPhysicalCoordinatesEqual: true, outOfScopePropsEqual: true }
}
async function profileSample(cdp, kind, action) {
  const window = { kind, ordinal: 0, status: 'running', samplingIntervalUs: 1000, startedAt: new Date().toISOString(),
    boundary: manifest.config.cpuProfile.boundary }
  result.diagnosticProfiles.push(window)
  await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 1000 }); await cdp.send('Profiler.start')
  window.pageAfterStartAtMs = await page.evaluate(() => performance.now())
  let sample, editError = null
  try {
    sample = await action()
    sample.diagnosticCpuProfile = true
    window.intentAtPageMs = sample.intent.captureMs; window.domainCommittedAtPageMs = sample.domainCommittedAtMs
    window.displayProxyAtPageMs = sample.displayProxyMs
  } catch (error) { editError = error; window.editFailure = String(error); throw error }
  finally {
    try {
      window.pageBeforeStopAtMs = await page.evaluate(() => performance.now())
      const captured = await cdp.send('Profiler.stop')
      window.finishedAt = new Date().toISOString(); window.status = editError ? 'partial-edit-failure' : 'complete'
      window.profileStartTime = captured.profile.startTime; window.profileEndTime = captured.profile.endTime
      window.nodeCount = captured.profile.nodes.length; window.sampleCount = captured.profile.samples?.length ?? 0
      const name = `${label}-${kind}-1.cpuprofile`, bytes = Buffer.from(JSON.stringify(captured.profile))
      sampler.setPhase('tooling-audit-cpu-profile')
      await fs.writeFile(path.join(output, name), bytes, { flag: 'wx' })
      window.artifact = { path: name, sizeBytes: bytes.length, sha256: hash(bytes) }
    } catch (error) {
      window.status = 'profile-collection-failed'; window.profileFailure = String(error)
      if (!editError) throw error
    } finally { await cdp.send('Profiler.disable').catch(() => {}) }
  }
  return sample
}
function reviewNetworkEvidence(ownedResult, auditOrigin = origin) {
  const incidentalFaviconUrl = value => {
    try { const url = new URL(value); return allowIncidentalFavicon404 && url.origin === auditOrigin && url.pathname === '/favicon.ico' && url.search === '' }
    catch { return false }
  }
  const favicon404 = response => response.status === 404 && incidentalFaviconUrl(response.url)
  const responses = [...ownedResult.httpResponses.map(response => ({ ...response, observer: 'playwright-page' })), ...ownedResult.cdpNetworkResponses.map(response => ({ ...response, observer: 'target-cdp' }))]
  const knownFavicon404 = url => incidentalFaviconUrl(url) && responses.some(response => favicon404(response) && response.url === url)
  const incidentalFaviconError = entry => knownFavicon404(entry.url ?? entry.location?.url) && /Failed to load resource/.test(entry.text) && /\b404\b/.test(entry.text)
  const errors = responses.filter(response => response.status >= 400)
  return { policy: { ...manifest.config.networkAudit, origin: auditOrigin }, pageResponseCount: ownedResult.httpResponses.length, cdpResponseCount: ownedResult.cdpNetworkResponses.length,
    responseObserverNote: 'Playwright suppresses favicon request/response page events. Target CDP Network.responseReceived is retained separately so the actual favicon URL/status remains auditable. The two observers can report the same product response; these counts are not unique requests.',
    incidentalFavicon404Responses: errors.filter(favicon404), productHttpErrors: errors.filter(response => !favicon404(response)),
    incidentalFaviconConsoleErrors: ownedResult.consoleErrorEvents.filter(incidentalFaviconError), unexpectedConsoleErrors: ownedResult.consoleErrorEvents.filter(entry => !incidentalFaviconError(entry)),
    incidentalFaviconBrowserLogErrors: ownedResult.browserLogErrors.filter(incidentalFaviconError), unexpectedBrowserLogErrors: ownedResult.browserLogErrors.filter(entry => !incidentalFaviconError(entry)),
    canceledRequests: ownedResult.requestFailures.filter(entry => entry.failure === 'net::ERR_ABORTED'),
    unexpectedRequestFailures: ownedResult.requestFailures.filter(entry => entry.failure !== 'net::ERR_ABORTED'),
  }
}
async function closeBrowser() {
  let resources = null, teardown = null
  if (sampler) {
    const ownedSampler = sampler; sampler = null
    const stopped = ownedSampler.stop()
    let timer
    try {
      const timeout = new Promise(resolve => { timer = setTimeout(() => resolve(null), 5000) })
      resources = await Promise.race([stopped, timeout])
    } finally { clearTimeout(timer) }
    // A canceled or wedged renderer may leave getMetrics awaiting a response.
    // Close this runner's dedicated process to settle that request; never begin
    // another measurement while its process or sampler is still alive.
    if (!resources) {
      teardown = await closeMeasuredBrowser(browserServer, browser)
      if (teardown) teardown.resourceStopRequiredBrowserClose = true
      resources = await stopped
    }
    if (result) {
      result.resources = { path: `${label}-resources.json`, summary: resources.summary }
      await writeJson(result.resources.path, resources, true)
    }
  }
  teardown ??= await closeMeasuredBrowser(browserServer, browser)
  if (teardown) manifest.teardowns.push({ case: label, ...teardown })
  browserServer = null; browser = null; page = null
}
async function failureEvidence() {
  const evidence = { pendingAction: result?.pendingAction ?? null, probe: null, dom: null, screenshot: null, errors: [] }
  if (page && !page.isClosed()) {
    const bounded = promise => Promise.race([promise, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('Failure collection timeout')), 2500); timer.unref() })])
    try { evidence.probe = await bounded(page.evaluate(() => Reflect.get(window, '__sceneweaveNativeM2Probe')?.read() ?? null)) } catch (error) { evidence.errors.push(String(error)) }
    try { evidence.dom = await bounded(page.evaluate(() => ({ text: document.body.innerText.slice(-14000), hash: location.hash, visibility: document.visibilityState }))) } catch (error) { evidence.errors.push(String(error)) }
    try { evidence.screenshot = `${label}-failure.png`; await bounded(page.screenshot({ path: path.join(output, evidence.screenshot), timeout: 2000 })) } catch (error) { evidence.errors.push(String(error)) }
  }
  return evidence
}

// Strict fixture conversion is tooling in its own server/process/profile. The
// measured product receives only complete-v1 bytes through its native import UI.
async function prepareNativeFixture(item) {
  label = `prepare-${item.name}`
  result = { case: item.name, phase: 'tooling-fixture-preparation', startedAt: new Date().toISOString(), samples: [], errors: [], pageErrorEvents: [],
    consoleErrors: [], consoleErrorEvents: [], httpResponses: [], cdpNetworkResponses: [], requestFailures: [], browserLogErrors: [], correctness: {}, preservationFiles: [] }
  const preparationResult = result
  console.log(`Native M2 fixture preparation ${item.name}`)
  fixtureTooling = await startNativeFixtureTooling({ root })
  browserServer = await chromium.launchServer({ channel, headless: true }); browser = await chromium.connect(browserServer.wsEndpoint())
  const context = await browser.newContext({ viewport: manifest.config.viewport, deviceScaleFactor: 1, acceptDownloads: true })
  await context.route('**/*', route => new URL(route.request().url()).origin === fixtureTooling.origin ? route.continue() : route.abort('blockedbyclient'))
  page = await context.newPage(); page.setDefaultTimeout(waitTimeoutMs)
  page.on('pageerror', error => { preparationResult.errors.push(error.message); preparationResult.pageErrorEvents.push({ at: new Date().toISOString(), name: error.name, message: error.message, stack: error.stack }) })
  page.on('response', response => preparationResult.httpResponses.push({ url: response.url(), status: response.status() }))
  page.on('requestfailed', request => preparationResult.requestFailures.push({ url: request.url(), failure: request.failure()?.errorText ?? null }))
  page.on('console', message => { if (message.type() === 'error') preparationResult.consoleErrorEvents.push({ text: message.text(), location: message.location() }) })
  const cdp = await context.newCDPSession(page)
  cdp.on('Network.responseReceived', event => preparationResult.cdpNetworkResponses.push({ at: new Date().toISOString(), url: event.response.url, status: event.response.status, resourceType: event.type, requestId: event.requestId, timestamp: event.timestamp }))
  cdp.on('Log.entryAdded', ({ entry }) => { if (entry.level === 'error') preparationResult.browserLogErrors.push({ source: entry.source, text: entry.text, url: entry.url ?? null, timestamp: entry.timestamp, networkRequestId: entry.networkRequestId ?? null }) })
  await cdp.send('Log.enable'); await cdp.send('Performance.enable'); await cdp.send('Network.enable'); await cdp.send('Network.setCacheDisabled', { cacheDisabled: true })
  sampler = startResourceSampling({ rootPid: browserServer.process().pid, cdp, intervalMs: 100, heapIntervalMs: 200 })
  sampler.setPhase('tooling-audit-fixture-conversion')
  await page.goto(fixtureTooling.url)
  const originalBytes = await fs.readFile(path.join(output, item.artifact.path))
  check(originalBytes.length === item.artifact.sizeBytes && hash(originalBytes) === item.artifact.sha256, 'Copied original fixture bytes changed before preparation')
  const captured = await page.evaluate(beginNativeFixturePreparation, Array.from(originalBytes))
  const directory = path.join(output, 'preparation', item.name)
  await fs.mkdir(directory, { recursive: true })
  const preservation = [{ name: 'preservation.sceneweave-migration.json', bytes: captured.index }, ...captured.volumes]
  check(captured.volumes.length > 0, 'Missing complete preservation index/volume')
  const reread = []
  for (const file of preservation) {
    check(file.name && path.basename(file.name) === file.name, 'Unsafe preservation filename')
    const target = path.join(directory, file.name), source = Buffer.from(file.bytes)
    await fs.writeFile(target, source, { flag: 'wx' })
    const bytes = await fs.readFile(target)
    check(bytes.equals(source), 'Preservation file bytes changed during disk reread')
    preparationResult.preservationFiles.push({ path: path.relative(output, target), sizeBytes: bytes.length, sha256: hash(bytes) })
    reread.push({ name: file.name, bytes: Array.from(bytes) })
  }
  const completed = await page.evaluate(completeNativeFixturePreparation, { jobId: captured.jobId, index: reread[0].bytes, volumes: reread.slice(1) })
  const prepared = await storageAudit()
  check(prepared.scenes.length === 1 && prepared.scenes[0].propCount === item.summary.propCount, 'Fixture conversion lost original prop count')
  const original = unzipSync(originalBytes)
  const sourceScene = JSON.parse(new TextDecoder().decode(original['scene.json']))
  check(isDeepStrictEqual(prepared.scenes[0].worldBoundsMm, item.summary.worldBoundsMm), 'Fixture conversion changed world extent')
  check(isDeepStrictEqual(prepared.scenes[0].props, sourceScene.props), 'Fixture conversion changed actual original props')
  await fs.mkdir(path.join(output, 'native-fixtures'), { recursive: true })
  const relative = `native-fixtures/${item.name}.sceneweave`, exported = Buffer.from(completed.bytes)
  await fs.writeFile(path.join(output, relative), exported, { flag: 'wx' })
  const nativeBytes = await fs.readFile(path.join(output, relative))
  check(nativeBytes.equals(exported), 'Native fixture bytes changed during disk reread')
  const artifact = { path: relative, sizeBytes: nativeBytes.length, sha256: hash(nativeBytes), snapshot: packageSnapshot(nativeBytes) }
  const nativeFiles = unzipSync(nativeBytes)
  const sourceHeader = JSON.parse(new TextDecoder().decode(original['manifest.json']))
  for (const entry of sourceHeader.entries.filter(entry => entry.role === 'asset' || entry.role === 'license')) {
    check(artifact.snapshot.entries.some(value => value.sha256 === entry.sha256 && value.sizeBytes === entry.sizeBytes), 'Fixture conversion lost original resource or license bytes')
  }
  preparationResult.nativePackage = artifact
  preparationResult.conversionJournal = completed.job
  preparationResult.browser = browser.version()
  preparationResult.storage = { database: prepared.database, projectCount: prepared.scenes.length, stores: prepared.stores }
  preparationResult.correctness = { fullPreservationWrittenAndReread: true, strictColdReadPublication: completed.job.stage === 'verified', originalPropFieldsUnchanged: true, worldExtentUnchanged: true,
    originalResourceAndLicenseBytesUnchanged: true, nativeManifestAndEveryEntryVerified: Object.keys(nativeFiles).length === artifact.snapshot.entries.length + 1 }
  check(!preparationResult.errors.length, 'Fixture conversion emitted page errors')
  preparationResult.networkAudit = reviewNetworkEvidence(preparationResult, fixtureTooling.origin)
  check(!preparationResult.networkAudit.productHttpErrors.length && !preparationResult.networkAudit.unexpectedRequestFailures.length
    && !preparationResult.networkAudit.unexpectedConsoleErrors.length && !preparationResult.networkAudit.unexpectedBrowserLogErrors.length,
  'Fixture conversion resource or console/browser log error; inspect preparation evidence')
  preparationResult.finishedAt = new Date().toISOString()
  await closeBrowser()
  await fixtureTooling.close(); fixtureTooling = null
  await writeJson(`${label}.json`, preparationResult, true)
  item.nativeArtifact = artifact
  manifest.fixturePreparation.push({ case: item.name, path: `${label}.json`, nativeArtifact: artifact, resourcePath: preparationResult.resources.path })
  await writeJson('manifest.json', manifest)
  result = null; label = null
}

async function runCase(item, run) {
  label = `${item.name}-run-${run}`
  lastPrintedKind = null
  result = { case: item.name, run, startedAt: new Date().toISOString(), samples: [], errors: [], pageErrorEvents: [], consoleErrors: [], consoleErrorEvents: [],
    httpResponses: [], cdpNetworkResponses: [], requestFailures: [], browserLogErrors: [], diagnosticProfiles: [], correctness: {}, auditArtifacts: [] }
  console.log(`Native M2 production UI ${label}`)
  const archived = unzipSync(await fs.readFile(path.join(output, item.nativeArtifact.path))), sourceScene = JSON.parse(new TextDecoder().decode(archived['scene.json']))
  browserServer = await chromium.launchServer({ channel, headless: true }); browser = await chromium.connect(browserServer.wsEndpoint())
  const context = await browser.newContext({ viewport: manifest.config.viewport, deviceScaleFactor: 1, acceptDownloads: true })
  await context.addInitScript(installNativeM2Observer)
  if (diagnosticStages) await context.addInitScript(installDiagnosticStageObserver)
  await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort('blockedbyclient'))
  page = await context.newPage(); page.setDefaultTimeout(waitTimeoutMs)
  const ownedResult = result
  page.on('pageerror', error => { ownedResult.errors.push(error.message); ownedResult.pageErrorEvents.push({ at: new Date().toISOString(), name: error.name, message: error.message, stack: error.stack }) })
  page.on('console', message => {
    if (message.type() === 'error') { ownedResult.consoleErrors.push(message.text()); ownedResult.consoleErrorEvents.push({ at: new Date().toISOString(), text: message.text(), location: message.location() }) }
  })
  page.on('response', response => ownedResult.httpResponses.push({ at: new Date().toISOString(), url: response.url(), status: response.status(), resourceType: response.request().resourceType(), method: response.request().method() }))
  page.on('requestfailed', request => ownedResult.requestFailures.push({ at: new Date().toISOString(), url: request.url(), resourceType: request.resourceType(), method: request.method(), failure: request.failure()?.errorText ?? null }))
  const cdp = await context.newCDPSession(page)
  cdp.on('Network.responseReceived', event => ownedResult.cdpNetworkResponses.push({ at: new Date().toISOString(), url: event.response.url, status: event.response.status, resourceType: event.type, requestId: event.requestId, timestamp: event.timestamp }))
  cdp.on('Log.entryAdded', ({ entry }) => { if (entry.level === 'error') ownedResult.browserLogErrors.push({ source: entry.source, text: entry.text, url: entry.url ?? null, timestamp: entry.timestamp, networkRequestId: entry.networkRequestId ?? null }) })
  await cdp.send('Log.enable'); await cdp.send('Performance.enable'); await cdp.send('Network.enable'); await cdp.send('Network.setCacheDisabled', { cacheDisabled: true })
  sampler = startResourceSampling({ rootPid: browserServer.process().pid, cdp, intervalMs: 100, heapIntervalMs: 200 })
  result.browser = browser.version(); result.nativeFixture = item.nativeArtifact
  sampler.setPhase('cold-page-navigation')
  const navigationStart = performance.now(); await page.goto(pageUrl); await page.getByTestId('workspace-home').waitFor({ state: 'visible' })
  result.coldPageNavigationMs = performance.now() - navigationStart
  check(await page.evaluate(allowed => Object.getOwnPropertyNames(window).filter(name => name.startsWith('__sceneweave') && !allowed.includes(name)).length === 0,
    ['__sceneweaveNativeM2Probe', ...(diagnosticStages ? ['__sceneweaveDiagnosticStages'] : [])]), 'Build exposed an unexpected product dev/performance API')
  sampler.setPhase('cold-native-import-save-raster')
  await measure('cold-native-import-save-raster', 0, { start: { event: 'change', selector: 'input[data-testid="native-project-file"]' }, requireSaved: true,
    until: { absent: '[role="dialog"][aria-label="检查完整工程"]' } }, () => page.getByTestId('native-project-file').setInputFiles(path.join(output, item.nativeArtifact.path)))
  await ready()
  sampler.setPhase('tooling-audit-import')
  const imported = await storageAudit(); result.auditArtifacts.push({ kind: 'import-storage', path: `${label}-import-storage.json` }); await writeJson(`${label}-import-storage.json`, imported, true)
  check(imported.scenes.length === 1 && imported.scenes[0].format === 'sceneweave-complete-project' && imported.scenes[0].documentSchemaVersion === expectedSchemaVersion
    && imported.scenes[0].identityVersion === 1 && imported.scenes[0].propCount === item.summary.propCount, `Native complete-v${expectedSchemaVersion} import counts failed`)
  check(!imported.allDatabases.some(name => /^sceneweave-m[01]/.test(name)), 'Measured native import created a legacy repository')
  check(imported.scenes[0].sceneId !== sourceScene.sceneId && imported.scenes[0].revision === 0, 'Native import failed to create an independent saved owner at r0')
  result.sceneId = imported.scenes[0].sceneId; result.title = imported.scenes[0].title; result.correctness[visualV2 ? 'nativeCompleteV2' : 'nativeCompleteV1'] = true
  sampler.setPhase('local-reopen-navigation-setup')
  const reloadStarted = performance.now()
  await page.goto(pageUrl); await page.reload(); await page.getByTestId('workspace-home').waitFor({ state: 'visible' })
  const recentButton = page.getByTestId('workspace-home').getByRole('button', { name: '打开', exact: true })
  await recentButton.waitFor({ state: 'visible' }); check(await recentButton.count() === 1 && await recentButton.isEnabled(), 'Expected one available native recent-project button')
  result.localReopenPreparation = { reloadToRecentUiMs: performance.now() - reloadStarted, method: 'Normal home navigation followed by a full page reload, no repository or localStorage mutation.' }
  sampler.setPhase('tooling-audit-local-reopen-preparation')
  const preparedStorage = await storageAudit()
  check(JSON.stringify(preparedStorage) === JSON.stringify(imported), 'Manual reopen preparation changed the native repository')
  result.localReopenPreparation.nativeRepositoryUnchanged = true
  sampler.setPhase('local-reopen')
  const reopened = await measure('local-reopen', 0, { start: { event: 'click', selector: '.home-project-row button' }, expectedRevision: imported.scenes[0].revision,
    requireSaved: true }, () => recentButton.click())
  reopened.boundary = 'Trusted click of the visible native recent-project Open button on the normal home page; navigation and repository audit are setup.'
  await ready()
  sampler.setPhase('selection-setup')
  await page.getByRole('checkbox', { name: '选择组合成员', exact: true }).check(); await refine()
  await marquee(item); await frames()
  const broadIds = JSON.parse((await probe()).selection), expected = expectedProps(sourceScene, item.summary.worldBoundsMm)
  check(JSON.stringify(broadIds.filter(id => Object.hasOwn(sourceScene.props, id)).sort()) === JSON.stringify(expected), 'Selection prop membership differs from rotated visual corners/locks')
  check(expected.length > 256 && await page.getByRole('button', { name: '预览批量移动', exact: true }).isDisabled(), 'Over-budget bulk operation was not rejected')
  await markerClick(item); await frames(); check((await probe()).selection === JSON.stringify([item.summary.editablePropId]), 'Unexpected marker selection')
  for (let i = 0; i < 3; i++) { await marquee(item); await frames(); await markerClick(item); await frames() }
  result.selectionCalibration = { broadIds, independentlyExpectedPropIds: expected, markerId: item.summary.editablePropId }; result.selectionRefinementSetup = await refine()
  sampler.setPhase('tooling-audit-selection-before')
  const beforeSelectionStorage = await storageAudit(), beforeSelectionPackage = await backup(`${label}-selection-before.sceneweave`)
  // The download notice changes chrome height. Product resize preserves the
  // world scale, so fit again before sending endpoints near the world edges.
  await page.getByRole('button', { name: '适应全图', exact: true }).click()
  await ready(); await refine()
  const selectionStart = await probe()
  sampler.setPhase('selection')
  for (let i = 0; i < counts.selections; i++) {
    for (const [kind, ids, action] of [['marquee', broadIds, () => marquee(item)], ['replacement', [item.summary.editablePropId], () => markerClick(item)]]) {
      const sample = await measure(kind, i, { start: { event: 'pointerup', selector: '.asset-viewport', button: 0 }, eventScope: '.asset-viewport', until: { selection: JSON.stringify(ids),
        text: kind === 'marquee' ? { selector: '.asset-inspector h3', value: `已选择 ${ids.length} 个对象` } : { selector: '.asset-inspector h2', value: '物件属性' } }, unchangedDocument: true }, action)
      check(sample.before.renderCount === sample.after.renderCount && sample.before.refinementCount === sample.after.refinementCount && sample.after.refinementCount === selectionStart.refinementCount, `${kind}: selection rerasterized or overlapped refinement ${JSON.stringify({ setup: selectionStart, before: sample.before, after: sample.after })}`)
      if (kind === 'marquee') check(sample.eventCounts.pointermove === 9, 'Expected initial positioning plus eight rAF-paced marquee moves')
    }
  }
  sampler.setPhase('tooling-audit-selection-after')
  const afterSelectionStorage = await storageAudit(), afterSelectionPackage = await backup(`${label}-selection-after.sceneweave`)
  check(JSON.stringify(beforeSelectionStorage) === JSON.stringify(afterSelectionStorage), 'Selection changed persisted repository')
  check(JSON.stringify(beforeSelectionPackage.snapshot) === JSON.stringify(afterSelectionPackage.snapshot), 'Selection changed complete native package')
  result.correctness.selectionUnchanged = true; result.selectionPackages = { before: beforeSelectionPackage, after: afterSelectionPackage }
  sampler.setPhase('context-menu')
  const markerBox = await canvasBox(), marker = screenPoint(markerBox, item.summary.worldBoundsMm, item.summary.selectionPointMm)
  for (let i = 0; i < counts.menus; i++) {
    const keyboard = i % 2 === 1
    if (keyboard) await page.locator('.asset-viewport').focus()
    await measure(keyboard ? 'keyboard-menu' : 'pointer-menu', i, { start: keyboard ? { event: 'keydown', selector: '.asset-viewport', key: 'F10' } : { event: 'contextmenu', selector: '.asset-viewport' }, until: { menu: true }, unchangedDocument: true },
      () => keyboard ? page.locator('.asset-viewport').press('Shift+F10') : page.mouse.click(marker.x, marker.y, { button: 'right' }))
    await measure('menu-dismiss', i, { start: { event: 'keydown', selector: '[role="menu"]', key: 'Escape' }, until: { menu: false }, unchangedDocument: true }, () => page.keyboard.press('Escape'))
    check(await page.locator('.asset-viewport').evaluate(node => document.activeElement === node), 'Context menu did not restore viewport focus')
  }
  // The minimum diagnostic still exercises both input paths as correctness checks.
  if (counts.menus === 1) {
    await page.locator('.asset-viewport').focus(); await page.locator('.asset-viewport').press('Shift+F10'); await page.getByRole('menu').waitFor(); await page.keyboard.press('Escape')
  }
  result.correctness.pointerAndKeyboardMenus = true
  sampler.setPhase('continuous-viewport')
  for (let i = 0; i < counts.gestures; i++) {
    await page.getByRole('button', { name: '适应全图', exact: true }).click(); await refine()
    await page.getByRole('button', { name: '平移地图', exact: true }).click()
    const box = await page.locator('.asset-viewport').boundingBox(), start = { x: box.x + box.width * .4, y: box.y + box.height * .45 }
    await page.mouse.move(start.x, start.y)
    const pan = await measure('continuous-pan', i, { start: { event: 'pointerdown', selector: '.asset-viewport', button: 0 }, eventScope: '.asset-viewport', endEvent: { event: 'pointerup', selector: '.asset-viewport', button: 0 }, until: { viewChanged: true }, unchangedDocument: true }, async () => {
      await page.mouse.down()
      for (let move = 1; move <= 30; move++) { await nextFrame(); await page.mouse.move(start.x + move * 3, start.y + move) }
      await page.mouse.up()
    })
    check(pan.eventCounts.pointermove === 30, 'Continuous pan requires exactly 30 real pointer moves')
    await page.getByRole('button', { name: '适应全图', exact: true }).click(); await refine()
    await page.getByRole('button', { name: '选择地图对象', exact: true }).click()
    const canvas = await canvasBox(); await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2)
    const wheel = await measure('continuous-wheel', i, { start: { event: 'wheel', selector: '.asset-viewport' }, eventScope: '.asset-viewport', externalEnd: true, until: { viewChanged: true }, unchangedDocument: true }, async () => {
      for (let step = 0; step < 20; step++) { await nextFrame(); await page.mouse.wheel(0, 12) }
    })
    check(wheel.eventCounts.wheel === 20, 'Continuous zoom requires exactly 20 real wheel events')
  }
  sampler.setPhase('viewport-reset-setup')
  await page.getByRole('button', { name: '适应全图', exact: true }).click(); await refine(); await markerClick(item); await frames()
  sampler.setPhase('ordinary-edit')
  const x = item.summary.selectionPointMm.x
  for (let i = 0; i < counts.edits; i++) {
    if (diagnosticProfile && i === 0) { sampler.setPhase('diagnostic-profile-ordinary-edit'); await profileSample(cdp, 'ordinary-edit', () => plainEdit(item, 'ordinary-edit', 0, x + 100)) }
    else { sampler.setPhase('ordinary-edit'); await plainEdit(item, 'ordinary-edit', i, i % 2 === 0 ? x + 100 : x) }
  }
  // Return marker to its documented click point before the remaining UI setup.
  if (counts.edits % 2) { sampler.setPhase('edit-reset-setup'); await plainEdit(item, 'edit-reset-setup', 0, x) }
  if (visualV2) { await measureVisualCurve(item); await page.getByTestId('workspace-navigation').getByRole('tab', { name: '对象', exact: true }).click(); await markerClick(item); await frames() }
  sampler.setPhase('layer-setup')
  await page.getByTestId('workspace-navigation').getByRole('tab', { name: '图层', exact: true }).click()
  const layerIds = {}
  for (const name of ['M2 Focus', 'M2 Spare']) {
    await page.getByRole('button', { name: '新建用户图层', exact: true }).click(); await page.getByLabel('新图层名称', { exact: true }).fill(name)
    await transaction('layer-create-setup', Object.keys(layerIds).length, () => page.getByRole('button', { name: '创建图层', exact: true }).click())
    layerIds[name] = await page.getByRole('button', { name: `设为当前图层 ${name}`, exact: true }).locator('..').locator('..').getAttribute('data-layer-id')
    check(layerIds[name], `No stable layer ID for ${name}`)
  }
  await page.getByRole('button', { name: /^移动所选到图层/ }).click(); await page.getByLabel('图层操作目标', { exact: true }).selectOption(layerIds['M2 Focus'])
  await measure('layer-move-preview', 0, { start: buttonStart('预览图层修改'), until: { preview: true }, unchangedDocument: true }, () => page.getByRole('button', { name: '预览图层修改', exact: true }).click())
  const moveScope = (await page.getByLabel('待采用图层操作 ID', { exact: true }).inputValue()).split('\n')
  check(moveScope.length <= 256 && moveScope.includes(item.summary.editablePropId), 'Small-layer member migration exceeded scope budget')
  await transaction('layer-move-adopt', 0, () => page.getByRole('button', { name: '采用图层修改', exact: true }).click(), { until: { preview: false } })
  await page.getByRole('button', { name: '设为当前图层 M2 Focus', exact: true }).click()
  result.layerSetup = { ids: layerIds, movedIds: moveScope }
  sampler.setPhase('layer-hide')
  for (let i = 0; i < counts.layers; i++) {
    const hide = i % 2 === 0, before = await probe()
    const sample = await measure('layer-hide', i, { start: buttonStart(hide ? '隐藏图层 M2 Focus' : '显示图层 M2 Focus'), requireRaster: true, requireSaved: true, unchangedDocument: true },
      () => page.getByRole('button', { name: `${hide ? '隐藏' : '显示'}图层 M2 Focus`, exact: true }).click())
    check(sample.after.hiddenLayerIds.includes(layerIds['M2 Focus']) === hide && sample.before.revision === before.revision, 'Unexpected transient layer visibility')
  }
  if (counts.layers % 2) { await page.getByRole('button', { name: '显示图层 M2 Focus', exact: true }).click(); await ready() }
  sampler.setPhase('layer-reorder')
  for (let i = 0; i < counts.layers; i++) {
    const up = page.getByRole('button', { name: '上移图层 M2 Focus', exact: true }), direction = await up.isEnabled() ? '上移' : '下移'
    const sample = await transaction('layer-reorder', i, () => page.getByRole('button', { name: `${direction}图层 M2 Focus`, exact: true }).click())
    check(JSON.stringify(sample.before.layerOrder) !== JSON.stringify(sample.after.layerOrder), 'Layer order failed to change')
  }
  sampler.setPhase('appearance-setup')
  await page.getByRole('button', { name: '选择图层成员 M2 Focus', exact: true }).click(); await frames()
  check(JSON.parse((await probe()).selection).length <= 256, 'Measured appearance scope exceeds 256')
  const appearance = page.getByRole('region', { name: '非破坏性外观', exact: true })
  await appearance.getByLabel('外观调整范围', { exact: true }).selectOption('layer'); await appearance.getByLabel('外观调整项目', { exact: true }).selectOption('brightness')
  sampler.setPhase('appearance')
  for (let i = 0; i < counts.appearances; i++) {
    await appearance.getByLabel('外观亮度', { exact: true }).fill(i % 2 === 0 ? '0.9' : '1')
    await measure('appearance-preview', i, { start: buttonStart('预览外观调整'), until: { preview: true }, unchangedDocument: true, requireRaster: true }, () => appearance.getByRole('button', { name: '预览外观调整', exact: true }).click())
    await transaction('appearance-adopt', i, () => page.getByRole('button', { name: '采用组件修改', exact: true }).click(), { until: { preview: false } })
  }
  sampler.setPhase('named-snapshot')
  const snapshotName = `M2 ${item.name} ${run}`
  await page.getByTestId('workspace-navigation').getByRole('tab', { name: '历史', exact: true }).click(); await page.getByRole('button', { name: '新建命名快照', exact: true }).click(); await page.getByLabel('命名快照名称', { exact: true }).fill(snapshotName)
  await measure('named-snapshot', 0, { start: buttonStart('保存快照'), until: { visible: '.history-snapshot-row.selected', absent: 'input[aria-label="命名快照名称"]' }, requireSaved: true, unchangedDocument: true }, () => page.getByRole('button', { name: '保存快照', exact: true }).click())
  sampler.setPhase('tooling-audit-history-before')
  const beforeHistory = await storageAudit({ includeResources: false })
  result.historyBefore = { named: beforeHistory.named, protection: beforeHistory.protection, metadata: beforeHistory.metadata }
  for (let i = 0; i < counts.restores; i++) {
    sampler.setPhase('restore-change-setup')
    await page.getByTestId('workspace-navigation').getByRole('tab', { name: '对象', exact: true }).click(); await markerClick(item); await frames()
    await plainEdit(item, 'restore-change-setup', i, x + 100)
    await page.getByTestId('workspace-navigation').getByRole('tab', { name: '历史', exact: true }).click()
    // Loading the named snapshot through the repository remains a distinct UI phase.
    sampler.setPhase('history-open')
    await measure('history-open', i, { start: buttonStart(`查看快照 ${snapshotName}`), until: { visible: 'select[aria-label="局部恢复模式"]' }, requireSaved: true, unchangedDocument: true }, () => page.getByRole('button', { name: `查看快照 ${snapshotName}`, exact: true }).click())
    await page.getByLabel('局部恢复模式', { exact: true }).selectOption('transform'); await page.getByLabel('搜索历史物件', { exact: true }).fill(item.summary.editablePropId)
    await page.getByRole('checkbox', { name: `恢复物件 ${item.summary.editablePropId}`, exact: true }).check()
    sampler.setPhase('restore-preview')
    await measure('restore-preview', i, { start: buttonStart('预览局部恢复'), until: { visible: '[aria-label="局部恢复候选"]' }, requireRaster: true, unchangedDocument: true }, () => page.getByRole('button', { name: '预览局部恢复 · 1 件', exact: true }).click())
    const affected = (await page.getByLabel('局部恢复完整实际范围', { exact: true }).inputValue()).split('\n')
    check(affected.length <= 256 && affected.includes(item.summary.editablePropId), 'Restore preview scope is invalid')
    await page.getByRole('checkbox', { name: '确认恢复完整影响范围', exact: true }).check()
    sampler.setPhase('restore-protect-adopt-save')
    const adoptRestore = () => transaction('restore-protect-adopt-save', i, () => page.getByRole('button', { name: '保护当前并采用', exact: true }).click(), { until: { absent: '[aria-label="局部恢复候选"]' } })
    const restored = diagnosticProfile && i === 0 ? await profileSample(cdp, 'restore-protect-adopt-save', adoptRestore) : await adoptRestore()
    restored.affectedIds = affected
  }
  sampler.setPhase('tooling-audit-history-after')
  const afterHistory = await storageAudit({ includeResources: false })
  result.historyAfter = { named: afterHistory.named, protection: afterHistory.protection, metadata: afterHistory.metadata }
  check(afterHistory.protection.length === beforeHistory.protection.length + counts.restores, 'Protection checkpoint count mismatch')
  check(afterHistory.scenes[0].props[item.summary.editablePropId].positionMm.x === x, 'Local transform restore failed')
  result.correctness.namedAndProtection = true
  sampler.setPhase('export-4k-gm')
  const exports = []
  for (const audience of ['gm', 'player']) {
    if (audience === 'player') { sampler.setPhase('player-preview'); await page.getByRole('group', { name: '预览受众', exact: true }).getByRole('button', { name: '玩家', exact: true }).click(); await ready(); sampler.setPhase('export-4k-player') }
    const pending = page.waitForEvent('download')
    let capturedDownload = null
    const sample = await measure(`export-4k-${audience}`, 0, { start: buttonStart('4K PNG'), externalEnd: true, requireSaved: true, unchangedDocument: true }, async () => {
      await page.getByRole('button', { name: '4K PNG', exact: true }).click()
      const download = await pending, name = `${label}-${audience}-4096.png`
      const at = await page.evaluate(() => performance.now())
      capturedDownload = download
      exports.push({ audience, path: name, downloadObservedAtPageMs: at })
    })
    const file = exports.at(-1); file.intentToDownloadObservedMs = file.downloadObservedAtPageMs - sample.intent.captureMs
    sampler.setPhase('tooling-audit-export-retention')
    await capturedDownload.saveAs(path.join(output, file.path))
  }
  sampler.setPhase('tooling-audit-final')
  for (const artifact of exports) {
    const bytes = await fs.readFile(path.join(output, artifact.path)); check(bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), 'Expected PNG signature')
    artifact.sizeBytes = bytes.length; artifact.sha256 = hash(bytes); artifact.width = bytes.readUInt32BE(16); artifact.height = bytes.readUInt32BE(20)
    check(Math.max(artifact.width, artifact.height) === 4096, 'Expected 4096px export long edge')
  }
  result.exports = exports
  await page.getByRole('group', { name: '预览受众', exact: true }).getByRole('button', { name: '主持人', exact: true }).click(); await ready()
  result.finalPackage = await backup(`${label}-final.sceneweave`)
  check(result.finalPackage.snapshot.format === 'sceneweave-complete-project' && result.finalPackage.snapshot.schemaVersion === expectedSchemaVersion && result.finalPackage.snapshot.identityVersion === 1, `Export lost native complete-v${expectedSchemaVersion} identity`)
  const finalStorage = await storageAudit()
  check(finalStorage.automatic.length === Math.min(20, finalStorage.scenes[0].revision + 1), 'Automatic history retention count differs from committed revisions')
  check(finalStorage.automatic.some(row => row.revision === finalStorage.scenes[0].revision), 'Latest saved revision is missing from automatic history')
  result.correctness.automaticHistoryRetained = true
  await writeJson(`${label}-final-storage.json`, finalStorage, true); result.auditArtifacts.push({ kind: 'final-storage', path: `${label}-final-storage.json` })
  result.networkAudit = reviewNetworkEvidence(result)
  check(!result.errors.length, 'Product emitted page errors')
  check(!result.networkAudit.productHttpErrors.length && !result.networkAudit.unexpectedRequestFailures.length, 'Product resource requests failed; inspect retained URLs/statuses')
  check(!result.networkAudit.unexpectedConsoleErrors.length && !result.networkAudit.unexpectedBrowserLogErrors.length, 'Product emitted unexpected console/browser log errors; inspect source URLs and network audit')
  result.correctness.networkErrorsReviewed = true
  result.finishedAt = new Date().toISOString()
  await closeBrowser()
  await writeJson(`${label}.json`, result, true)
  manifest.results.push({ case: item.name, run, path: `${label}.json`, resourcePath: result.resources.path }); await writeJson('manifest.json', manifest)
  console.log(`Completed ${label}: ${result.samples.length} observations`)
  result = null; label = null
}

try {
  check(process.platform === 'darwin', 'Native M2 RSS sampler currently requires macOS; unsupported platforms must not produce formal evidence')
  const copied = visualV2 ? await copyVisualV2Fixtures({ sourceDirectory: visualFixtureDirectory, outputDirectory: output, requestedCases })
    : await copyArchivedFixtures({ sourceDirectory: fixtureDirectory, outputDirectory: output, requestedCases })
  manifest.cases = copied.cases; manifest.fixtureSource = copied.provenance; await writeJson('manifest.json', manifest)
  for (const item of visualV2 ? [] : manifest.cases) {
    const watchdog = setTimeout(() => interrupt(`Fixture preparation exceeded ${caseTimeoutMs}ms watchdog`), caseTimeoutMs)
    try { await guarded(prepareNativeFixture(item)) } finally { clearTimeout(watchdog) }
  }
  for (const item of manifest.cases) for (let run = 1; run <= counts.runs; run++) {
    const watchdog = setTimeout(() => interrupt(`Dedicated case/run exceeded ${caseTimeoutMs}ms watchdog`), caseTimeoutMs)
    try { await guarded(runCase(item, run)) } finally { clearTimeout(watchdog) }
  }
  check(JSON.stringify(await fingerprints(dist)) === JSON.stringify(manifest.build), 'Production dist changed during measurement')
  check(JSON.stringify(await fingerprints(path.join(root, 'src'))) === JSON.stringify(manifest.source), 'Application source changed during measurement')
  for (const entry of manifest.sourceInputs) check(hash(await fs.readFile(path.join(root, entry.path))) === entry.sha256, `Source input changed during measurement: ${entry.path}`)
  for (const entry of manifest.runners) check(hash(await fs.readFile(path.join(root, entry.path))) === entry.sha256, `Runner changed during measurement: ${entry.path}`)
  manifest.sourceUnchangedAfterMeasurement = true; manifest.runnersUnchangedAfterMeasurement = true
  manifest.buildUnchangedAfterMeasurement = true; manifest.status = 'complete'; manifest.finishedAt = new Date().toISOString()
  await writeJson('manifest.json', manifest)
  const completed = await Promise.all(manifest.results.map(item => fs.readFile(path.join(output, item.path), 'utf8').then(JSON.parse)))
  await writeJson('summary.json', summarizeNativeM2(manifest, completed), true)
} catch (error) {
  manifest.status = 'failed'; manifest.failures.push({ at: new Date().toISOString(), case: label, message: String(error), stack: error.stack }); process.exitCode = 1; console.error(error)
  if (result) { result.failure = manifest.failures.at(-1); result.failureEvidence = await failureEvidence() }
} finally {
  process.removeListener('SIGINT', handleSigint); process.removeListener('SIGTERM', handleSigterm)
  clearInterval(suspensionMonitor)
  try { await closeBrowser() } catch (error) { manifest.failures.push({ phase: 'teardown', message: String(error) }); manifest.status = 'failed'; process.exitCode = 1 }
  try { await fixtureTooling?.close(); fixtureTooling = null } catch (error) { manifest.failures.push({ phase: 'fixture-tooling-teardown', message: String(error) }); manifest.status = 'failed'; process.exitCode = 1 }
  if (result) await writeJson(`${label}-partial-failure.json`, result, true)
  await writeJson('manifest.json', manifest); await new Promise(resolve => server.close(resolve)); sleepGuard?.kill()
}
