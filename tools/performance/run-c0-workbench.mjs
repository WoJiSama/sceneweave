import { chromium } from '@playwright/test'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:http'
import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyArchivedFixtures } from './archived-fixtures.mjs'
import { closeMeasuredBrowser } from './close-browser.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'), args = process.argv.slice(2)
const argument = (name, fallback) => { const i = args.indexOf(name); return i < 0 ? fallback : args[i + 1] }
const output = argument('--output', null), fixtureDirectory = argument('--fixtures', null)
const runs = Number(argument('--runs', '3')), edits = Number(argument('--edits', '10')), channel = argument('--channel', 'chrome')
const requestedCases = argument('--cases', 'study-500,study-2000,island-500,island-2000').split(',')
if (!output || !path.isAbsolute(output) || !fixtureDirectory || !path.isAbsolute(fixtureDirectory)) throw new Error('--output ABS and --fixtures ABS are required')
if (![runs, edits].every(n => Number.isSafeInteger(n) && n > 0) || edits % 2) throw new Error('--runs must be positive; --edits must be positive and even so geometry returns to its starting state')
if (new Set(requestedCases).size !== requestedCases.length || requestedCases.some(name => !/^(study|island)-(500|2000)$/.test(name))) throw new Error('--cases must contain unique B5 case names')
try { if ((await fs.readdir(output)).length) throw new Error('Output must be empty; previous evidence will not be overwritten') } catch (error) { if (error.code !== 'ENOENT') throw error }
await fs.mkdir(output, { recursive: true })
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const json = (name, value, exclusive = false) => fs.writeFile(path.join(output, name), JSON.stringify(value, null, 2), exclusive ? { flag: 'wx' } : undefined)
const stats = values => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b), rank = p => sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] ?? null
  return { n: sorted.length, min: sorted[0] ?? null, p50: rank(.5), p95: rank(.95), max: sorted.at(-1) ?? null }
}
async function fingerprints(directory, relative = '') {
  const values = []
  for (const entry of await fs.readdir(path.join(directory, relative), { withFileTypes: true })) {
    const name = path.join(relative, entry.name)
    if (entry.isDirectory()) values.push(...await fingerprints(directory, name))
    else if (entry.isFile()) { const bytes = await fs.readFile(path.join(directory, name)); values.push({ path: name, sizeBytes: bytes.length, sha256: hash(bytes) }) }
  }
  return values.sort((a, b) => a.path.localeCompare(b.path))
}

// Installed only by this runner, before app scripts. It observes real product DOM
// and native trusted events; the normal application exports no measurement API.
function installObserver() {
  const now = () => performance.now(), probe = { sample: null, gesture: null }
  const pendingProxies = new Set()
  const view = () => {
    const node = document.querySelector('.asset-viewport')
    return node ? { zoom: Number(node.dataset.zoom), panX: Number(node.dataset.panX), panY: Number(node.dataset.panY), renderCount: Number(node.dataset.renderCount) } : null
  }
  const snapshot = () => ({ view: view(), revision: Number(document.querySelector('[data-testid="asset-workbench"]')?.getAttribute('data-revision')), save: document.querySelector('.asset-save')?.textContent.trim() ?? null })
  const nativeStamp = event => {
    const captureMs = now(), stamp = event.timeStamp > 1e12 ? event.timeStamp - performance.timeOrigin : event.timeStamp
    return { type: event.type, trusted: event.isTrusted, eventTimeStamp: event.timeStamp, normalizedEventTimeStamp: stamp, captureMs, queuedUntilCaptureMs: captureMs - stamp }
  }
  const visibleRaster = () => {
    const canvas = document.querySelector('.asset-viewport canvas:not([aria-hidden="true"])'), image = canvas?.parentElement
    return !!canvas && canvas.width > 0 && canvas.height > 0 && getComputedStyle(image).visibility === 'visible'
  }
  const twoFrames = callback => {
    const pending = new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => { callback(now()); resolve() })))
    pendingProxies.add(pending); void pending.finally(() => pendingProxies.delete(pending))
    return pending
  }
  const capture = event => {
    const sample = probe.sample
    if (sample && !sample.complete) {
      const input = event.target instanceof HTMLInputElement && event.target.getAttribute('aria-label') === sample.inputLabel
      if (sample.trigger === 'enter' && input && (event.type === 'focusout' || event.type === 'keydown' && event.key === 'Enter')) {
        sample.events.push(nativeStamp(event)); sample.intent ??= sample.events.at(-1)
      }
      if (sample.trigger === 'click' && event.type === 'click' && event.target instanceof Element && event.target.closest('button')?.textContent.trim() === '采用结构修改') {
        sample.events.push(nativeStamp(event)); sample.intent ??= sample.events.at(-1)
      }
    }
    const gesture = probe.gesture
    if (!gesture?.active || !(event.target instanceof Element) || !event.target.closest('.asset-viewport')) return
    if (event.type === 'wheel' || event.type === 'pointermove' && (event.buttons & 1)) {
      gesture.events.push({ ...nativeStamp(event), sequence: gesture.events.length, before: view(), deltaX: event.deltaX ?? null, deltaY: event.deltaY ?? null })
    }
  }
  const bubble = event => {
    const sample = probe.sample
    if (!sample || sample.complete || !sample.intent) return
    const input = event.target instanceof HTMLInputElement && event.target.getAttribute('aria-label') === sample.inputLabel
    if (sample.trigger === 'enter' && event.type === 'focusout' && input || sample.trigger === 'click' && event.type === 'click' && event.target instanceof Element && event.target.closest('button')?.textContent.trim() === '采用结构修改') {
      sample.handlerEndMs = now(); sample.handlerEndEvent = event.type; sample.handlerEndTrusted = event.isTrusted
      sample.afterHandler = snapshot()
    }
  }
  for (const name of ['keydown', 'focusout', 'click', 'pointermove', 'wheel']) document.addEventListener(name, capture, true)
  for (const name of ['focusout', 'click']) document.addEventListener(name, bubble)
  const changed = () => {
    const sample = probe.sample, current = snapshot()
    if (sample?.intent && !sample.domReadyMs && current.revision === sample.expectedRevision && current.view?.renderCount > sample.before.view.renderCount && visibleRaster()) {
      sample.domReadyMs = now(); sample.afterRaster = current
      twoFrames(time => { sample.displayProxyMs = time; sample.complete = true })
    }
    const gesture = probe.gesture
    if (gesture?.active && current.view && JSON.stringify(current.view) !== JSON.stringify(gesture.lastView)) {
      const pending = gesture.events.filter(event => !event.domTransformMs)
      if (pending.length) {
        const domTransformMs = now(), latest = pending.at(-1).sequence
        for (const event of pending) { event.domTransformMs = domTransformMs; event.after = current.view; event.coalescedInto = latest }
        twoFrames(time => { for (const event of pending) event.displayProxyMs = time })
      }
      gesture.lastView = current.view
    }
  }
  new MutationObserver(changed).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-revision', 'data-render-count', 'data-zoom', 'data-pan-x', 'data-pan-y', 'style', 'aria-busy'] })
  Reflect.set(window, '__sceneweaveC0Probe', {
    snapshot,
    arm(options) { probe.sample = { ...options, before: snapshot(), events: [], intent: null, complete: false } },
    read() { return probe.sample },
    beginGesture() {
      const gesture = { active: true, before: snapshot(), events: [], frameGapMs: [], lastView: view(), startedMs: now() }
      let last = 0
      const tick = time => { if (!gesture.active) return; if (last) gesture.frameGapMs.push(time - last); last = time; requestAnimationFrame(tick) }
      probe.gesture = gesture; requestAnimationFrame(tick)
    },
    async endGesture() { await twoFrames(() => {}); await Promise.all([...pendingProxies]); const gesture = probe.gesture; gesture.active = false; gesture.endedMs = now(); gesture.after = snapshot(); return gesture },
  })
}

const dist = path.join(root, 'dist'), html = await fs.readFile(path.join(dist, 'index.html'), 'utf8')
if (html.includes('/@vite/client')) throw new Error('Expected a normal production dist, found a development client')
// 正式站点构建可能带部署前缀（GitHub Pages 子路径）；本工具以根路径伺服，需按构建产物声明的 base 剥前缀
const servedBase = /<script[^>]+src="([^"]+\/assets\/)/.exec(html)?.[1]?.replace(/assets\/$/, '') ?? '/'
const manifest = { startedAt: new Date().toISOString(), status: 'running', sourceRevision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  sourceDirty: execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }), runnerSha256: hash(await fs.readFile(fileURLToPath(import.meta.url))),
  node: process.version, device: { platform: os.platform(), release: os.release(), arch: os.arch(), cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, memoryBytes: os.totalmem() },
  measurementClass: runs >= 3 && edits * runs >= 30 ? 'formal-workbench-observation' : 'diagnostic-smoke',
  config: { runs, editsPerKindPerRun: edits, requestedCases, channel, viewport: { width: 1512, height: 982 }, dpr: 1, panMoves: 30, wheelInputs: 20,
    processState: 'Fresh dedicated headless Chrome process/profile per case/run; HTTP cache disabled; OS caches not purged',
    timing: 'Enter capture starts submission intent. Focusout capture to document bubble follows the React root handler, including synchronous command preparation and domain validation. Adoption click is measured separately. MutationObserver waits for an increased completed-raster count and visible primary canvas, then two rAF callbacks.',
    limitations: ['event.timeStamp queue intervals begin at browser event creation, not physical input.', 'DOM/rAF intervals include observer and automation overhead; they are not GPU completion or physical screen presentation.', 'Gesture coalescing is explicit; multiple inputs may share one observed transform.', 'No runtime resource peak, cross-browser, free-object drag, or complete QA-PERF-01/04 claim.'] },
  build: await fingerprints(dist), cases: [], results: [], failures: [] }
await json('manifest.json', manifest)
let activeBrowser, activeServer, activePage, currentResult, currentLabel
const sleepGuard = process.platform === 'darwin' ? spawn('caffeinate', ['-i', '-w', String(process.pid)], { stdio: 'ignore' }) : null
sleepGuard?.on('error', () => {})
const server = createServer(async (req, res) => {
  try {
    const requested = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
    const relative = (servedBase !== '/' && requested.startsWith(servedBase) ? requested.slice(servedBase.length - 1) : requested).replace(/^\//, '')
    const file = path.resolve(dist, relative || 'index.html')
    if (!file.startsWith(dist + path.sep)) { res.writeHead(403); res.end(); return }
    const bytes = await fs.readFile(file), type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' }[path.extname(file)] ?? 'application/octet-stream'
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(bytes)
  } catch { res.writeHead(404); res.end() }
})
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
const origin = `http://127.0.0.1:${server.address().port}`
const check = (condition, message) => { if (!condition) throw new Error(message) }
const probeCall = (page, method, options) => page.evaluate(({ method, options }) => Reflect.get(window, '__sceneweaveC0Probe')[method](options), { method, options })
async function settled(page) {
  await page.waitForFunction(() => document.querySelector('.asset-save')?.textContent.trim() === '本地已保存')
  await page.getByLabel('材质场景主持人预览', { exact: true }).waitFor({ state: 'visible' })
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
}
async function closeBrowser() {
  const closed = await closeMeasuredBrowser(activeServer, activeBrowser)
  if (closed) {
    manifest.teardowns ??= []
    manifest.teardowns.push({ case: currentLabel, ...closed })
    console.log(`Closed dedicated browser: ${closed.durationMs.toFixed(0)}ms; forced kill=${closed.killed}; released exited pipes=${closed.releasedExitedProcessPipes}`)
  }
  activeBrowser = null; activeServer = null; activePage = null
}
async function measure(page, options, action) {
  currentResult.pendingAction = options
  await probeCall(page, 'arm', options)
  const automationStartedMs = performance.now(); await action()
  await page.waitForFunction(() => Reflect.get(window, '__sceneweaveC0Probe').read()?.complete, null, { timeout: 45_000 })
  const value = await probeCall(page, 'read')
  check(value.intent?.trusted && value.events.every(event => event.trusted) && value.handlerEndTrusted, 'Expected trusted input and its synchronous handler boundary')
  check(Number.isFinite(value.handlerEndMs), 'No document bubble completion observed after the React root handler')
  const focusout = value.events.find(event => event.type === 'focusout')
  if (options.trigger === 'enter') check(focusout && value.intent.type === 'keydown', 'Missing Enter/focusout submission boundary')
  value.automationWindowMs = performance.now() - automationStartedMs
  value.intentToHandlerEndMs = value.handlerEndMs - value.intent.captureMs
  value.focusoutHandlerMs = focusout ? value.handlerEndMs - focusout.captureMs : null
  value.intentToRasterDomMs = value.domReadyMs - value.intent.captureMs
  value.intentToDisplayProxyMs = value.displayProxyMs - value.intent.captureMs
  await settled(page)
  delete currentResult.pendingAction
  return value
}
function summarize(result) {
  const values = {}
  for (const kind of ['prop', 'contourPreview', 'contourAdopt']) {
    const samples = result.edits.filter(sample => sample.kind === kind)
    values[kind] = Object.fromEntries(['intentToHandlerEndMs', 'focusoutHandlerMs', 'intentToRasterDomMs', 'intentToDisplayProxyMs'].map(field => [field, stats(samples.map(sample => sample[field]))]))
    values[kind].queuedUntilCaptureMs = stats(samples.map(sample => sample.intent.queuedUntilCaptureMs))
  }
  const events = result.gesture?.events ?? []
  values.gestureFrameGapMs = stats(result.gesture?.frameGapMs ?? [])
  for (const type of ['pointermove', 'wheel']) {
    const samples = events.filter(event => event.type === type)
    values[type] = { observedInputs: samples.length, unobservedTransforms: samples.filter(event => !event.domTransformMs).length,
      coalescedInputs: samples.filter(event => event.sequence !== event.coalescedInto).length,
      captureToDomMs: stats(samples.map(event => event.domTransformMs - event.captureMs)), captureToDisplayProxyMs: stats(samples.map(event => event.displayProxyMs - event.captureMs)) }
  }
  return values
}
try {
  const copied = await copyArchivedFixtures({ sourceDirectory: fixtureDirectory, outputDirectory: output, requestedCases })
  manifest.cases = copied.cases; manifest.fixtureSource = copied.provenance; await json('manifest.json', manifest)
  for (const item of manifest.cases) for (let run = 1; run <= runs; run++) {
    currentLabel = `${item.name}-run-${run}`
    currentResult = { case: item.name, run, startedAt: new Date().toISOString(), edits: [], errors: [], consoleErrors: [], networkFailures: [] }
    console.log(`Measuring actual production workbench ${currentLabel}`)
    activeServer = await chromium.launchServer({ channel, headless: true }); activeBrowser = await chromium.connect(activeServer.wsEndpoint())
    const context = await activeBrowser.newContext({ viewport: manifest.config.viewport, deviceScaleFactor: 1, acceptDownloads: true })
    await context.addInitScript(installObserver)
    const page = activePage = await context.newPage(); page.setDefaultTimeout(30_000)
    const watchdog = setTimeout(() => { void page.close().catch(() => {}) }, 8 * 60_000)
    page.once('close', () => clearTimeout(watchdog))
    page.on('pageerror', error => currentResult?.errors.push(error.message))
    page.on('console', message => { if (message.type() === 'error') currentResult?.consoleErrors.push(message.text()) })
    page.on('requestfailed', request => currentResult?.networkFailures.push({ path: new URL(request.url()).pathname, reason: request.failure()?.errorText }))
    const cdp = await context.newCDPSession(page)
    await cdp.send('Network.enable'); await cdp.send('Network.setCacheDisabled', { cacheDisabled: true })
    currentResult.browser = activeBrowser.version()
    const opened = performance.now(); await page.goto(`${origin}/#assets`)
    check(await page.evaluate(() => !Reflect.has(window, '__sceneweavePerformance') && !Reflect.has(window, '__sceneweaveAssetsDev')), 'Normal production page exposed a runtime measurement/development API')
    await page.getByLabel('选择完整素材工程').setInputFiles(path.join(output, item.artifact.path))
    await page.getByRole('button', { name: '保存并打开副本', exact: true }).click(); await settled(page)
    currentResult.importAdoptDisplayAutomationMs = performance.now() - opened
    const canvas = await page.getByLabel('材质场景主持人预览', { exact: true }).boundingBox(), bounds = item.summary.worldBoundsMm, marker = item.summary.selectionPointMm
    check(canvas, 'No product primary canvas')
    await page.mouse.click(canvas.x + (marker.x - bounds.x) / bounds.width * canvas.width, canvas.y + (marker.y - bounds.y) / bounds.height * canvas.height)
    await page.getByRole('heading', { name: '物件属性', exact: true }).waitFor()
    check(await page.locator('.asset-viewport').evaluate((node, id) => {
      const selected = JSON.parse(node.getAttribute('data-selected-ids') ?? '[]')
      return selected.length === 1 && selected[0] === id
    }, item.summary.editablePropId), 'Actual map pointer did not select the fixture marker')
    for (let ordinal = 0; ordinal < edits; ordinal++) {
      const input = page.getByLabel('物件旋转', { exact: true }); await input.fill(String(ordinal % 2 ? 0 : 1))
      const before = await probeCall(page, 'snapshot')
      currentResult.edits.push(await measure(page, { kind: 'prop', ordinal, trigger: 'enter', inputLabel: '物件旋转', expectedRevision: before.revision + 1 }, () => input.press('Enter')))
    }
    await page.getByRole('group', { name: '场景对象分类', exact: true }).getByRole('button', { name: '结构', exact: true }).click()
    const target = item.summary.contourEditTarget, entityId = target.kind === 'vertex' ? target.id : target.pointId, label = target.kind === 'vertex' ? '顶点 X' : '轮廓点 X'
    await page.locator(`[data-entity-id="${entityId}"]`).click()
    for (let ordinal = 0; ordinal < edits; ordinal++) {
      const input = page.getByLabel(label, { exact: true }); await input.fill(String(target.positionMm.x + (ordinal % 2 ? 0 : 1)))
      const before = await probeCall(page, 'snapshot')
      currentResult.edits.push(await measure(page, { kind: 'contourPreview', ordinal, trigger: 'enter', inputLabel: label, expectedRevision: before.revision }, () => input.press('Enter')))
      check((await probeCall(page, 'snapshot')).revision === before.revision, 'Preview changed the persisted revision')
      currentResult.edits.push(await measure(page, { kind: 'contourAdopt', ordinal, trigger: 'click', expectedRevision: before.revision + 1 }, () => page.getByRole('button', { name: '采用结构修改', exact: true }).click()))
    }
    await page.getByRole('button', { name: '适应全图', exact: true }).click(); await settled(page)
    await page.getByRole('button', { name: '平移地图', exact: true }).click()
    const viewport = await page.getByLabel('地图视口', { exact: true }).boundingBox(); check(viewport, 'No map viewport')
    const centre = { x: viewport.x + viewport.width / 2, y: viewport.y + viewport.height / 2 }
    await page.mouse.move(centre.x, centre.y); await page.mouse.down(); await probeCall(page, 'beginGesture')
    for (let i = 1; i <= 30; i++) { await page.evaluate(() => new Promise(requestAnimationFrame)); await page.mouse.move(centre.x + i * .8, centre.y + i * .4) }
    await page.mouse.up(); await page.mouse.move(centre.x, centre.y)
    for (let i = 0; i < 20; i++) { await page.evaluate(() => new Promise(requestAnimationFrame)); await page.mouse.wheel(0, i % 2 ? 120 : -120) }
    currentResult.gesture = await probeCall(page, 'endGesture')
    const gesture = currentResult.gesture
    check(gesture.events.every(event => event.trusted), 'Gesture input was not trusted')
    check(gesture.events.filter(event => event.type === 'pointermove').length === 30 && gesture.events.filter(event => event.type === 'wheel').length === 20, 'Gesture input count differs from the requested 30 pointer moves/20 wheel events')
    check(gesture.before.revision === gesture.after.revision && gesture.before.save === '本地已保存' && gesture.after.save === gesture.before.save && gesture.before.view.renderCount === gesture.after.view.renderCount, 'Viewport gesture changed scene revision/save state or rerasterized')
    await page.getByRole('button', { name: '适应全图', exact: true }).click(); await settled(page)
    const final = await probeCall(page, 'snapshot'); check(final.view.zoom === 1 && final.view.panX === 0 && final.view.panY === 0, 'Fit failed to restore the view')
    currentResult.final = final; currentResult.statistics = summarize(currentResult)
    if (run === 1) { const relative = `${item.name}-workbench.png`; await page.screenshot({ path: path.join(output, relative) }); const bytes = await fs.readFile(path.join(output, relative)); currentResult.screenshot = { path: relative, sizeBytes: bytes.length, sha256: hash(bytes) } }
    check(!currentResult.errors.length, 'Product page emitted an uncaught error')
    currentResult.finishedAt = new Date().toISOString(); await json(`${currentLabel}.json`, currentResult, true)
    manifest.results.push({ case: item.name, run, path: `${currentLabel}.json`, statistics: currentResult.statistics }); await json('manifest.json', manifest)
    console.log(`Complete ${currentLabel}: property intent→handler p95 ${currentResult.statistics.prop.intentToHandlerEndMs.p95.toFixed(1)}ms`)
    await closeBrowser(); currentResult = null; currentLabel = null
  }
  check(JSON.stringify(await fingerprints(dist)) === JSON.stringify(manifest.build), 'Normal dist bytes changed during measurement')
  manifest.buildUnchangedAfterMeasurement = true; manifest.status = 'complete'; manifest.finishedAt = new Date().toISOString()
  const completed = await Promise.all(manifest.results.map(item => fs.readFile(path.join(output, item.path), 'utf8').then(JSON.parse)))
  await json('summary.json', { method: manifest.config, cases: requestedCases.map(name => { const results = completed.filter(item => item.case === name); return { name, runs: results.length, statistics: summarize({ edits: results.flatMap(item => item.edits), gesture: { events: results.flatMap(item => item.gesture.events), frameGapMs: results.flatMap(item => item.gesture.frameGapMs) } }) } }) }, true)
} catch (error) {
  manifest.status = 'failed'; manifest.failures.push({ at: new Date().toISOString(), message: String(error), stack: error.stack }); process.exitCode = 1; console.error(error)
  if (currentResult) {
    currentResult.failure = manifest.failures.at(-1)
    try { currentResult.pendingObservation = activePage && !activePage.isClosed() ? await probeCall(activePage, 'read') : null } catch { /* Keep the already collected raw samples. */ }
    await json(`${currentLabel}-partial-failure.json`, currentResult, true)
  }
} finally {
  await closeBrowser(); await json('manifest.json', manifest)
  await new Promise(resolve => server.close(resolve)); sleepGuard?.kill()
}
