import { chromium } from '@playwright/test'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:http'
import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { unzipSync } from 'fflate'
import { copyArchivedFixtures } from './archived-fixtures.mjs'
import { closeMeasuredBrowser } from './close-browser.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'), args = process.argv.slice(2)
if (args.includes('--help')) {
  console.log('node tools/performance/run-selection.mjs --output ABS --fixtures ABS [--workbench assets|layers] [--runs 3] [--selections 30] [--cases study-500,study-2000,island-500,island-2000] [--channel chrome] [--profile] [--dist ABS] [--diagnostic] [--isolate list,overlay,inspector,transitions] [--trace] [--diagnostic-tail-ms 250]')
  console.log('Use an empty output directory. Run without other browsers, tests or builds. --profile, --diagnostic, --isolate and --trace are diagnostic runs, excluded from formal timing evidence. Isolation CSS is injected by this tool only; it leaves component JavaScript running. Diagnostics default to a 250ms pause after each action to observe animation/paint tails; use --diagnostic-tail-ms 0 to retain the original rapid alternating pace.')
  process.exit(0)
}
const argument = (name, fallback) => { const i = args.indexOf(name); return i < 0 ? fallback : args[i + 1] }
const workbench = argument('--workbench', 'assets')
if (!['assets', 'layers'].includes(workbench)) throw new Error('--workbench must be assets or layers')
const workbenchTestId = workbench === 'layers' ? 'layer-workbench' : 'asset-workbench'
const output = argument('--output', null), fixtureDirectory = argument('--fixtures', null), dist = path.resolve(argument('--dist', path.join(root, 'dist')))
const runs = Number(argument('--runs', '3')), selections = Number(argument('--selections', '30')), channel = argument('--channel', 'chrome'), profile = args.includes('--profile')
const trace = args.includes('--trace'), isolations = argument('--isolate', '').split(',').filter(Boolean)
const diagnostic = trace || args.includes('--diagnostic') || isolations.length > 0
if (isolations.some(value => !['list', 'overlay', 'inspector', 'transitions'].includes(value)) || new Set(isolations).size !== isolations.length) throw new Error('--isolate must contain unique list,overlay,inspector,transitions names')
const diagnosticTailMs = diagnostic ? Number(argument('--diagnostic-tail-ms', '250')) : 0
if (!Number.isSafeInteger(diagnosticTailMs) || diagnosticTailMs < 0 || diagnosticTailMs > 5000 || args.includes('--diagnostic-tail-ms') && !diagnostic) throw new Error('--diagnostic-tail-ms requires a diagnostic mode and an integer 0–5000')
const isolationRules = { list: '.asset-entity-list{display:none!important}', overlay: '.asset-selection-overlay{visibility:hidden!important}', inspector: '.asset-inspector>*{display:none!important}', transitions: '.asset-shell button{transition:none!important;animation:none!important}' }
const requestedCases = argument('--cases', 'study-500,study-2000,island-500,island-2000').split(',')
if (!output || !path.isAbsolute(output) || !fixtureDirectory || !path.isAbsolute(fixtureDirectory)) throw new Error('--output ABS and --fixtures ABS are required')
if (![runs, selections].every(value => Number.isSafeInteger(value) && value > 0)) throw new Error('--runs and --selections must be positive integers')
if (new Set(requestedCases).size !== requestedCases.length || requestedCases.some(name => !/^(study|island)-(500|2000)$/.test(name))) throw new Error('--cases must contain unique B5 case names')
try { if ((await fs.readdir(output)).length) throw new Error('Output must be empty; previous evidence will not be overwritten') } catch (error) { if (error.code !== 'ENOENT') throw error }
await fs.mkdir(output, { recursive: true })
const hash = bytes => createHash('sha256').update(bytes).digest('hex'), check = (condition, message) => { if (!condition) throw new Error(message) }
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

// Injected by the tool before app code. It never wraps Canvas, React or product
// functions. Mutation/rAF observations include their own overhead and do not
// represent GPU completion, monitor presentation, or the complete UX budget.
function installObserver({ traceEnabled = false, workbenchTestId = 'asset-workbench' } = {}) {
  const probe = { sample: null, longTasks: [] }, now = () => performance.now()
  const snapshot = () => {
    const node = document.querySelector('.asset-viewport'), shell = document.querySelector(`[data-testid="${workbenchTestId}"]`)
    return { selection: node?.getAttribute('data-selected-ids') ?? '[]', revision: Number(shell?.getAttribute('data-revision')),
      renderCount: Number(node?.getAttribute('data-render-count')), refinementCount: node?.hasAttribute('data-refinement-count') ? Number(node.getAttribute('data-refinement-count')) : null,
      save: document.querySelector('.asset-save')?.textContent.trim() ?? null }
  }
  let longTaskObserver = null
  if (PerformanceObserver.supportedEntryTypes.includes('longtask')) {
    longTaskObserver = new PerformanceObserver(list => probe.longTasks.push(...list.getEntries().map(entry => ({ startTime: entry.startTime, duration: entry.duration }))))
    longTaskObserver.observe({ type: 'longtask', buffered: true })
  }
  const ingestLongTasks = () => {
    if (longTaskObserver) probe.longTasks.push(...longTaskObserver.takeRecords().map(entry => ({ startTime: entry.startTime, duration: entry.duration })))
  }
  const ready = sample => {
    const current = snapshot(), overlay = document.querySelector('.asset-selection-overlay')
    return current.selection === sample.expectedSelection && overlay instanceof HTMLCanvasElement && overlay.width > 0 && overlay.height > 0
      && (sample.kind === 'marquee' ? [...document.querySelectorAll('.asset-inspector h3')].some(node => node.textContent === `已选择 ${sample.expectedCount} 个对象`)
        : [...document.querySelectorAll('.asset-inspector h2')].some(node => node.textContent === '物件属性'))
  }
  const finish = sample => {
    if (probe.sample !== sample || sample.complete || !sample.release || !ready(sample)) return
    if (sample.domReadyMs === undefined) { sample.domReadyMs = now(); mark(sample, 'dom-ready') }
    if (sample.pendingFrames) return
    sample.pendingFrames = true
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (probe.sample !== sample) return
      if (!ready(sample)) { sample.pendingFrames = false; return }
      sample.displayProxyMs = now(); sample.clockAtDisplay = { wallMs: Date.now(), monotonicMs: now() }; sample.after = snapshot(); sample.complete = true
      mark(sample, 'display-proxy')
      cancelAnimationFrame(sample.frameId); delete sample.frameId; ingestLongTasks()
      sample.longTasks = probe.longTasks.filter(entry => entry.startTime < sample.displayProxyMs && entry.startTime + entry.duration > sample.pointerdown.captureMs)
    }))
  }
  const mark = (sample, phase) => { if (traceEnabled) performance.mark(`${sample.traceMarkerPrefix}:${phase}`) }
  const stamp = event => {
    const captureMs = now(), normalizedEventTimeStamp = event.timeStamp > 1e12 ? event.timeStamp - performance.timeOrigin : event.timeStamp
    return { type: event.type, trusted: event.isTrusted, eventTimeStamp: event.timeStamp, normalizedEventTimeStamp, captureMs, queuedUntilCaptureMs: captureMs - normalizedEventTimeStamp }
  }
  const capture = event => {
    const sample = probe.sample
    if (!sample || sample.complete || !(event.target instanceof Element) || !event.target.closest('.asset-viewport')) return
    if (event.type === 'pointerdown') {
      sample.pointerdown = stamp(event)
      mark(sample, 'pointerdown')
      let last = null
      const tick = time => { if (sample.complete || probe.sample !== sample) return; if (last !== null) sample.frameGapMs.push(time - last); last = time; sample.frameId = requestAnimationFrame(tick) }
      sample.frameId = requestAnimationFrame(tick)
    }
    if (!sample.pointerdown) return
    if (event.type === 'pointermove') { sample.pointerMoves++; sample.trustedMoves &&= event.isTrusted }
    if (event.type === 'pointerup') { sample.release = stamp(event); mark(sample, 'release') }
    if (event.type === 'click') sample.click = stamp(event)
  }
  const bubble = event => {
    const sample = probe.sample
    if (!sample || sample.complete || !sample.release || !(event.target instanceof Element) || !event.target.closest('.asset-viewport')) return
    if (event.type === 'pointerup') { sample.pointerupBubbleMs = now(); mark(sample, 'handler-bubble') }
    if (event.type === 'click') sample.clickBubbleMs = now()
    finish(sample)
  }
  for (const name of ['pointerdown', 'pointermove', 'pointerup', 'click']) document.addEventListener(name, capture, true)
  for (const name of ['pointerup', 'click']) document.addEventListener(name, bubble)
  new MutationObserver(() => { if (probe.sample) finish(probe.sample) }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-selected-ids'] })
  Reflect.set(window, '__sceneweaveSelectionProbe', {
    snapshot,
    arm(options) { ingestLongTasks(); probe.sample = { ...options, traceMarkerPrefix: `sceneweave-selection-${options.kind}-${options.ordinal}`, clockAtArm: { wallMs: Date.now(), monotonicMs: now() }, before: snapshot(), frameGapMs: [], pointerMoves: 0, trustedMoves: true, complete: false }; mark(probe.sample, 'arm') },
    read() { return probe.sample },
  })
}

async function storageSnapshot(page) {
  return page.evaluate(async () => {
    const digest = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('')
    const normalized = async value => {
      if (value instanceof Blob) return { blob: { size: value.size, type: value.type, sha256: await digest(await value.arrayBuffer()) } }
      if (value instanceof Date) return { date: value.toISOString() }
      if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
        const bytes = value instanceof ArrayBuffer ? value : value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength)
        return { bytes: bytes.byteLength, sha256: await digest(bytes) }
      }
      if (Array.isArray(value)) return Promise.all(value.map(normalized))
      if (value && typeof value === 'object') return Object.fromEntries(await Promise.all(Object.keys(value).sort().map(async key => [key, await normalized(value[key])])))
      return value
    }
    const result = []
    for (const entry of (await indexedDB.databases()).filter(entry => entry.name?.startsWith('sceneweave')).sort((a, b) => a.name.localeCompare(b.name))) {
      const db = await new Promise((resolve, reject) => { const request = indexedDB.open(entry.name); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) })
      const stores = []
      try {
        for (const name of [...db.objectStoreNames].sort()) {
          const values = await new Promise((resolve, reject) => {
            const transaction = db.transaction(name, 'readonly'), store = transaction.objectStore(name), keys = store.getAllKeys(), rows = store.getAll()
            transaction.oncomplete = () => resolve({ keys: keys.result, rows: rows.result }); transaction.onerror = () => reject(transaction.error); transaction.onabort = () => reject(transaction.error)
          })
          stores.push({ name, count: values.keys.length, sha256: await digest(new TextEncoder().encode(JSON.stringify(await normalized(values)))) })
        }
      } finally { db.close() }
      result.push({ name: entry.name, version: entry.version, stores })
    }
    return result
  })
}
function packageSnapshot(bytes) {
  const files = unzipSync(bytes), manifest = JSON.parse(new TextDecoder().decode(files['manifest.json'])), scene = JSON.parse(new TextDecoder().decode(files['scene.json']))
  return { manifest, sceneId: scene.sceneId, schemaVersion: scene.schemaVersion, revision: scene.revision, propCount: Object.keys(scene.props).length,
    entries: Object.entries(files).filter(([name]) => name !== 'manifest.json').map(([name, value]) => ({ path: name, sizeBytes: value.length, sha256: hash(value) })).sort((a, b) => a.path.localeCompare(b.path)) }
}
async function backup(page, name) {
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: '完整工程', exact: true }).click()
  const download = await pending; await download.saveAs(path.join(output, name))
  const bytes = await fs.readFile(path.join(output, name))
  await page.waitForFunction(() => !document.querySelector('.asset-busy'))
  return { artifact: { path: name, sizeBytes: bytes.length, sha256: hash(bytes) }, snapshot: packageSnapshot(bytes) }
}
const snapshot = page => page.evaluate(() => Reflect.get(window, '__sceneweaveSelectionProbe').snapshot())
const settle = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
async function ready(page) {
  await page.waitForFunction(() => document.querySelector('.asset-save')?.textContent.trim() === '本地已保存' && document.querySelector('.asset-map-wrap')?.getAttribute('aria-busy') === 'false')
  await page.getByLabel('材质场景主持人预览', { exact: true }).waitFor({ state: 'visible' }); await settle(page)
}
async function settleInitialRefinement(page) {
  const startedAt = new Date().toISOString(), started = performance.now()
  const exposed = await page.locator('.asset-viewport').evaluate(node => node.hasAttribute('data-refinement-count'))
  if (!exposed) return { available: false, startedAt, waitMs: performance.now() - started, boundary: 'Setup only; old builds expose no refinement counter.' }
  await page.waitForFunction(() => {
    const node = document.querySelector('.asset-viewport'), detail = document.querySelector('.asset-detail-preview')
    return Number(node?.getAttribute('data-refinement-count')) > 0 && detail instanceof HTMLCanvasElement && detail.width > 0 && detail.height > 0 && getComputedStyle(detail).display !== 'none'
  })
  let previous = (await snapshot(page)).refinementCount
  for (let attempt = 0; attempt < 20; attempt++) {
    await page.waitForTimeout(320)
    const current = (await snapshot(page)).refinementCount
    if (current === previous) return { available: true, startedAt, finishedAt: new Date().toISOString(), waitMs: performance.now() - started, refinementCount: current, stableForMs: 320,
      boundary: 'Initial idle crop/refinement setup only; excluded from all selection samples. Every sample checks this count remains unchanged.' }
    previous = current
  }
  throw new Error('Initial refinement did not stabilize before selection sampling')
}
const canvasBox = page => page.getByLabel('材质场景主持人预览', { exact: true }).boundingBox()
const screenPoint = (box, bounds, point) => ({ x: box.x + (point.x - bounds.x) / bounds.width * box.width, y: box.y + (point.y - bounds.y) / bounds.height * box.height })
async function marquee(page, box, bounds) {
  const first = screenPoint(box, bounds, { x: bounds.x + 100, y: bounds.y + 100 }), last = screenPoint(box, bounds, { x: bounds.x + bounds.width - 100, y: bounds.y + bounds.height - 100 })
  await page.mouse.move(first.x, first.y); await page.mouse.down()
  for (let i = 1; i <= 8; i++) { await page.evaluate(() => new Promise(requestAnimationFrame)); await page.mouse.move(first.x + (last.x - first.x) * i / 8, first.y + (last.y - first.y) * i / 8) }
  await page.mouse.up()
}
async function selectMarker(page, item, box) {
  const marker = screenPoint(box, item.summary.worldBoundsMm, item.summary.selectionPointMm)
  await page.mouse.click(marker.x, marker.y)
}
function expectedProps(scene, bounds) {
  const left = bounds.x + 100, top = bounds.y + 100, right = bounds.x + bounds.width - 100, bottom = bounds.y + bounds.height - 100
  return Object.values(scene.props).filter(prop => {
    if (prop.editLocked || [...Object.values(scene.prefabInstances), ...Object.values(scene.scatterGroups)].some(group => group.editLocked && Object.values(group.members).some(member => member.propId === prop.id))) return false
    const v = prop.visualBoundsMm, a = prop.rotationDeg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a)
    return [[v.x, v.y], [v.x + v.width, v.y], [v.x + v.width, v.y + v.height], [v.x, v.y + v.height]].every(([x, y]) => {
      const px = prop.positionMm.x + x * c - y * s, py = prop.positionMm.y + x * s + y * c
      return px >= left && px <= right && py >= top && py <= bottom
    })
  }).map(prop => prop.id).sort()
}
async function measure(page, kind, ordinal, expected, action) {
  if (runInterruption) throw runInterruption
  currentResult.pendingAction = { kind, ordinal, armedAt: new Date().toISOString() }
  await page.evaluate(options => Reflect.get(window, '__sceneweaveSelectionProbe').arm(options), { kind, ordinal, expectedSelection: JSON.stringify(expected), expectedCount: expected.length })
  await action()
  await page.waitForFunction(() => Reflect.get(window, '__sceneweaveSelectionProbe').read()?.complete, null, { timeout: 30_000 })
  const sample = await page.evaluate(() => Reflect.get(window, '__sceneweaveSelectionProbe').read())
  check(sample.release?.trusted && sample.pointerdown?.trusted && sample.trustedMoves, 'Expected trusted pointer events')
  check(kind !== 'marquee' || sample.pointerMoves === 8, 'Expected eight rAF-paced marquee moves')
  check(sample.before.renderCount === sample.after.renderCount && sample.before.revision === sample.after.revision && sample.before.save === '本地已保存' && sample.after.save === sample.before.save, 'Selection rerasterized or changed revision/save state')
  check(sample.before.refinementCount === sample.after.refinementCount, 'Selection overlapped an unexpected viewport refinement')
  check(sample.before.refinementCount === currentResult.selectionWindowStart.refinementCount, 'Viewport refinement changed between measured selection samples')
  sample.releaseToHandlerBubbleMs = sample.pointerupBubbleMs - sample.release.captureMs
  sample.releaseToDomMs = sample.domReadyMs - sample.release.captureMs
  sample.releaseToDisplayProxyMs = sample.displayProxyMs - sample.release.captureMs
  sample.pointerdownToDisplayProxyMs = sample.displayProxyMs - sample.pointerdown.captureMs
  sample.clickToHandlerBubbleMs = sample.click ? sample.clickBubbleMs - sample.click.captureMs : null
  sample.maxFrameGapMs = Math.max(0, ...sample.frameGapMs)
  sample.browserClockDiscontinuityMs = (sample.clockAtDisplay.wallMs - sample.clockAtArm.wallMs) - (sample.clockAtDisplay.monotonicMs - sample.clockAtArm.monotonicMs)
  check(Math.abs(sample.browserClockDiscontinuityMs) <= 250, 'Browser wall/monotonic clocks diverged during a sample; possible sleep or clock adjustment, sample is not formal evidence')
  delete sample.pendingFrames
  delete currentResult.pendingAction
  return sample
}
function summarize(samples) {
  return Object.fromEntries(['marquee', 'replacement'].map(kind => {
    const selected = samples.filter(sample => sample.kind === kind)
    return [kind, { ...Object.fromEntries(['releaseToHandlerBubbleMs', 'releaseToDomMs', 'releaseToDisplayProxyMs', 'pointerdownToDisplayProxyMs', 'clickToHandlerBubbleMs', 'maxFrameGapMs'].map(key => [key, stats(selected.map(sample => sample[key]))])),
      frameGapMs: stats(selected.flatMap(sample => sample.frameGapMs)), queuedUntilCaptureMs: stats(selected.map(sample => sample.release.queuedUntilCaptureMs)),
      longTasks: selected.reduce((count, sample) => count + sample.longTasks.length, 0), longTaskDurationMs: stats(selected.flatMap(sample => sample.longTasks.map(entry => entry.duration))) }]
  }))
}

// Diagnostic-only timeline processing. Event durations are clipped to each
// marked window. Named event totals can overlap (for example Paint within
// RunTask), so they are not claimed as exclusive CPU attribution.
const traceCategories = ['devtools.timeline', 'toplevel', 'blink.user_timing', 'v8', 'v8.execute', 'cc', 'gpu', 'animation', 'disabled-by-default-devtools.timeline', 'disabled-by-default-devtools.timeline.frame', 'disabled-by-default-devtools.timeline.invalidationTracking']
async function stopTrace(cdp, name) {
  const completed = new Promise(resolve => cdp.once('Tracing.tracingComplete', resolve))
  await cdp.send('Tracing.end')
  const result = await bounded(completed, 15_000)
  check(result.stream, 'CDP did not return a trace stream')
  const chunks = []
  try {
    while (true) {
      const chunk = await cdp.send('IO.read', { handle: result.stream })
      chunks.push(chunk.base64Encoded ? Buffer.from(chunk.data, 'base64') : Buffer.from(chunk.data))
      if (chunk.eof) break
    }
  } finally { await cdp.send('IO.close', { handle: result.stream }) }
  const bytes = Buffer.concat(chunks)
  await fs.writeFile(path.join(output, name), bytes, { flag: 'wx' })
  return { artifact: { path: name, sizeBytes: bytes.length, sha256: hash(bytes), dataLossOccurred: result.dataLossOccurred ?? false }, events: JSON.parse(bytes.toString()).traceEvents }
}
function analyzeTrace(events, samples) {
  const complete = [], stacks = new Map()
  for (const event of events) {
    const key = `${event.pid}:${event.tid}`
    if (event.ph === 'X' && Number.isFinite(event.dur)) complete.push(event)
    else if (event.ph === 'B') { const stack = stacks.get(key) ?? []; stack.push(event); stacks.set(key, stack) }
    else if (event.ph === 'E') { const first = stacks.get(key)?.pop(); if (first) complete.push({ ...first, ph: 'X', dur: event.ts - first.ts }) }
  }
  const threads = events.filter(event => event.ph === 'M' && event.name === 'thread_name').map(event => ({ pid: event.pid, tid: event.tid, name: event.args?.name }))
  const markers = events.filter(event => event.name?.startsWith('sceneweave-selection-'))
  const duration = (event, start, end) => Math.max(0, Math.min(event.ts + event.dur, end) - Math.max(event.ts, start)) / 1000
  const groups = {
    layout: /^(Layout|UpdateLayoutTree|RecalculateStyles|InvalidateLayout|ScheduleStyleRecalculation)$/,
    paint: /^(Paint|PrePaint|PaintImage|PaintArtifactCompositor::Update|UpdateLayerTree)$/,
    raster: /RasterTask|Rasterize|TileManager::PrepareTiles|PlaybackToMemory/,
    animation: /Animation|Animate|CSSAnimation|CSSTransition/,
    javascript: /^(FunctionCall|EvaluateScript|EventDispatch|V8\.Execute|v8\.run|RunMicrotasks)$/,
    garbageCollection: /GC|GarbageCollect|CollectGarbage|MinorMS/,
    frame: /BeginMainFrame|BeginFrame|DrawFrame|Commit|CompositeLayers/,
  }
  const classify = (start, end, pid, tid) => {
    const selected = complete.filter(event => event.dur > 0 && event.ts < end && event.ts + event.dur > start)
    const main = selected.filter(event => event.pid === pid && event.tid === tid)
    const unionMs = values => {
      const intervals = values.map(event => [Math.max(start, event.ts), Math.min(end, event.ts + event.dur)]).sort((a, b) => a[0] - b[0])
      let sum = 0, until = start
      for (const [from, to] of intervals) { sum += Math.max(0, to - Math.max(until, from)); until = Math.max(until, to) }
      return sum / 1000
    }
    const named = new Map()
    for (const event of selected) {
      const key = `${event.pid}:${event.tid}:${event.name}`, entry = named.get(key) ?? { name: event.name, pid: event.pid, tid: event.tid, count: 0, durationMs: 0, maxEventMs: 0 }
      const ms = duration(event, start, end); entry.count++; entry.durationMs += ms; entry.maxEventMs = Math.max(entry.maxEventMs, ms); named.set(key, entry)
    }
    const namedEvents = [...named.values()].sort((a, b) => b.durationMs - a.durationMs)
    const category = matcher => ({ count: selected.filter(event => matcher.test(event.name)).length,
      durationMs: selected.filter(event => matcher.test(event.name)).reduce((sum, event) => sum + duration(event, start, end), 0),
      rendererMainDurationMs: main.filter(event => matcher.test(event.name)).reduce((sum, event) => sum + duration(event, start, end), 0),
      rendererMainUnionMs: unionMs(main.filter(event => matcher.test(event.name))) })
    const dispatched = new Map()
    for (const event of main.filter(event => event.name === 'EventDispatch')) {
      const type = event.args?.data?.type ?? 'unknown', entry = dispatched.get(type) ?? { type, count: 0, durationMs: 0 }
      entry.count++; entry.durationMs += duration(event, start, end); dispatched.set(type, entry)
    }
    return { windowMs: (end - start) / 1000, categories: Object.fromEntries(Object.entries(groups).map(([name, matcher]) => [name, category(matcher)])),
      rendererMainTaskUnionMs: unionMs(main.filter(event => event.name === 'ThreadControllerImpl::RunTask')),
      rendererMainEventDispatchTypes: [...dispatched.values()].sort((a, b) => b.count - a.count),
      rendererMainNamedEvents: namedEvents.filter(event => event.pid === pid && event.tid === tid).slice(0, 45), otherThreadNamedEvents: namedEvents.filter(event => event.pid !== pid || event.tid !== tid).slice(0, 25) }
  }
  return { categories: traceCategories, caveats: ['Timeline event durations are clipped and can be nested/overlap; sums are not exclusive CPU time.', 'Raster/animation may occur on other threads and extend beyond the DOM/double-rAF proxy.', 'Isolation CSS changes rendering work while React, domain computation and Canvas submission JavaScript remain active.', 'CDP tracing adds overhead; compare this diagnostic A/B only and retain non-traced formal observations separately.'],
    eventCount: events.length, threads, samples: samples.map(sample => {
      const marker = suffix => markers.find(event => event.name === `${sample.traceMarkerPrefix}:${suffix}`)
      const first = marker('pointerdown'), release = marker('release'), display = marker('display-proxy'), tail = marker('diagnostic-tail') ?? display
      if (!first || !release || !display) return { kind: sample.kind, ordinal: sample.ordinal, error: 'Missing one or more trace markers' }
      return { kind: sample.kind, ordinal: sample.ordinal, rendererMain: { pid: first.pid, tid: first.tid }, traceStartUs: release.ts,
        releaseToDisplay: classify(release.ts, display.ts, first.pid, first.tid), displayTail: classify(display.ts, tail.ts, first.pid, first.tid), wholeAction: classify(first.ts, tail.ts, first.pid, first.tid) }
    }) }
}

const html = await fs.readFile(path.join(dist, 'index.html'), 'utf8')
check(!html.includes('/@vite/client'), 'Expected a normal production dist')
const servedBase = /<script[^>]+src="([^"]+\/assets\/)/.exec(html)?.[1]?.replace(/assets\/$/, '') ?? '/'
const manifest = { startedAt: new Date().toISOString(), status: 'running', sourceRevision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  sourceDirty: execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }), runnerSha256: hash(await fs.readFile(fileURLToPath(import.meta.url))),
  node: process.version, device: { platform: os.platform(), release: os.release(), arch: os.arch(), cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, memoryBytes: os.totalmem() },
  measurementClass: diagnostic ? 'diagnostic-selection-isolation' : profile ? 'diagnostic-cpu-profile' : runs >= 3 && selections >= 30 ? 'formal-selection-observation' : 'diagnostic-smoke',
  config: { workbench, workbenchTestId, route: `#${workbench}`, fixturePreparation: workbench === 'layers' ? 'Original strict v2 B5 archived package imported through the native v3 UI as a complete independent migrated copy; migration is excluded from selection timing.' : 'Original strict v2 B5 archived package imported through the asset UI as a complete independent copy.',
    runs, selectionsPerKindPerRun: selections, requestedCases, channel, profile, diagnostic, isolations, isolationRules: Object.fromEntries(isolations.map(name => [name, isolationRules[name]])), trace, traceCategories: trace ? traceCategories : undefined, diagnosticTailMs, viewport: { width: 1512, height: 982 }, dpr: 1, warmupPairs: 3,
    processState: 'Fresh dedicated headless Chrome process/profile per case/run; HTTP cache disabled; OS caches not purged. caffeinate -i prevents idle sleep, not lid-closure sleep; keep the laptop lid open during measurements.',
    interruptionDetection: 'A Node event-loop wall gap over 5 seconds invalidates the run as an environment interruption. Browser Date/performance clock discontinuities over 250ms also invalidate the sample. These detect tool/host suspension, not slow product work on the separate renderer process; slow product samples are retained.',
    method: 'Real member-mode contained marquee from 100mm inside top-left to 100mm inside bottom-right, eight rAF-paced pointer moves; alternate each with one real marker click. Pointerup capture starts response timing, document bubble follows React handler, MutationObserver requires expected selectedIds and inspector, then two rAF callbacks. All samples and slow observations retained.',
    correctness: 'Each run calibrates stable actual ID order; prop membership is independently checked against rotated visual corners and fixture entity/container locks. Complete UI package bytes/content, raw IndexedDB stores, revision/save state and base-render count checked before/after. When exposed, initial viewport refinement finishes and stabilizes for 320ms in setup; per-sample and whole-window refinement counts must remain unchanged.',
    limitations: ['Selection DOM readiness is a scheduling/commit proxy, not a direct Canvas drawing boundary or GPU completion.', 'Canvas, React and product functions are not wrapped. Formal runs do not use CPU profiler.', 'LongTask entries cover main-thread tasks over 50ms and can span multiple phases; no function-level attribution is inferred.', 'Pointer event timestamps omit physical/OS input latency. rAF intervals contain browser/automation/observer scheduling.', 'Before/after IndexedDB equality does not prove no transient writes occurred.', 'Calibrated structural IDs are checked for stability, not independently geometry-audited here.', 'No complete QA-PERF-01/04, resource peak, cross-browser or physical presentation claim.'] },
  build: await fingerprints(dist), cases: [], results: [], failures: [] }
await json('manifest.json', manifest)
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
const sleepGuard = process.platform === 'darwin' ? spawn('caffeinate', ['-i', '-w', String(process.pid)], { stdio: 'ignore' }) : null
sleepGuard?.on('error', () => {})
let activeServer = null, activeBrowser = null, activePage = null, activeTrace = null, currentResult = null, currentLabel = null, runInterruption = null, closing = null
const interruptionListeners = new Set()
function interruptRun(message, detail = {}) {
  if (runInterruption) return
  runInterruption = new Error(message)
  manifest.environmentInterruptions ??= []
  manifest.environmentInterruptions.push({ at: new Date().toISOString(), case: currentLabel, message, ...detail })
  for (const listener of interruptionListeners) listener(runInterruption)
}
function guarded(promise) {
  return new Promise((resolve, reject) => {
    if (runInterruption) { void promise.catch(() => {}); reject(runInterruption); return }
    const failed = error => { interruptionListeners.delete(failed); reject(error) }
    interruptionListeners.add(failed)
    void promise.then(value => { interruptionListeners.delete(failed); resolve(value) }, error => { interruptionListeners.delete(failed); reject(error) })
  })
}
let lastRunnerTick = Date.now()
const suspensionMonitor = setInterval(() => {
  const wall = Date.now(), gapMs = wall - lastRunnerTick; lastRunnerTick = wall
  if (gapMs > 5000) interruptRun('Runner event loop was suspended for over 5 seconds; measurement interrupted', { runnerTickGapMs: gapMs })
}, 500)
suspensionMonitor.unref()
async function bounded(promise, timeoutMs) {
  let timer
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`Diagnostic collection exceeded ${timeoutMs}ms`)), timeoutMs) })]) }
  finally { clearTimeout(timer) }
}
async function failureEvidence() {
  const evidence = { at: new Date().toISOString(), pendingAction: currentResult?.pendingAction ?? null, pageClosed: activePage?.isClosed() ?? true,
    browserConnected: activeBrowser?.isConnected() ?? false, browserRootExited: activeServer ? activeServer.process().exitCode !== null || activeServer.process().signalCode !== null : true,
    pendingObservation: null, dom: null, screenshot: null, collectionErrors: [] }
  if (activePage && !activePage.isClosed()) {
    try { evidence.pendingObservation = await bounded(activePage.evaluate(() => Reflect.get(window, '__sceneweaveSelectionProbe')?.read() ?? null), 2000) } catch (error) { evidence.collectionErrors.push({ step: 'probe', error: String(error) }) }
    try { evidence.dom = await bounded(activePage.evaluate(workbenchTestId => ({ visibility: document.visibilityState, locationHash: location.hash,
      viewport: (() => { const node = document.querySelector('.asset-viewport'); if (!node) return null; const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, selectedIds: node.getAttribute('data-selected-ids'), renderCount: node.getAttribute('data-render-count') } })(),
      inspectorText: document.querySelector('.asset-inspector')?.textContent.slice(0, 1500), busy: document.querySelector('.asset-map-wrap')?.getAttribute('aria-busy'), revision: document.querySelector(`[data-testid="${workbenchTestId}"]`)?.getAttribute('data-revision') }), workbenchTestId), 2000) } catch (error) { evidence.collectionErrors.push({ step: 'dom', error: String(error) }) }
    try { const name = `${currentLabel}-failure.png`; await bounded(activePage.screenshot({ path: path.join(output, name), timeout: 2000 }), 2500); evidence.screenshot = name } catch (error) { evidence.collectionErrors.push({ step: 'screenshot', error: String(error) }) }
  }
  return evidence
}
async function closeBrowser() {
  if (closing) return closing
  closing = (async () => {
    const closed = await closeMeasuredBrowser(activeServer, activeBrowser)
    if (closed) { manifest.teardowns ??= []; manifest.teardowns.push({ case: currentLabel, ...closed }); console.log(`Closed ${currentLabel}: ${closed.durationMs.toFixed(0)}ms; forced kill=${closed.killed}`) }
    activeServer = null; activeBrowser = null; activePage = null
  })()
  try { await closing } finally { closing = null }
}
try {
  const copied = await copyArchivedFixtures({ sourceDirectory: fixtureDirectory, outputDirectory: output, requestedCases })
  manifest.cases = copied.cases; manifest.fixtureSource = copied.provenance; await json('manifest.json', manifest)
  for (const item of manifest.cases) for (let run = 1; run <= runs; run++) {
    if (runInterruption) throw runInterruption
    currentLabel = `${item.name}-run-${run}`; currentResult = { case: item.name, run, workbench, startedAt: new Date().toISOString(), samples: [], errors: [], consoleErrors: [], browserEvents: [] }
    await guarded((async () => {
    console.log(`Measuring production ${workbench} selection ${currentLabel}`)
    activeServer = await chromium.launchServer({ channel, headless: true }); activeBrowser = await chromium.connect(activeServer.wsEndpoint())
    const context = await activeBrowser.newContext({ viewport: manifest.config.viewport, deviceScaleFactor: 1, acceptDownloads: true })
    await context.addInitScript(installObserver, { traceEnabled: trace, workbenchTestId })
    const page = activePage = await context.newPage(); page.setDefaultTimeout(30_000)
    const ownedResult = currentResult
    const watchdog = setTimeout(() => interruptRun('Dedicated run exceeded the eight-minute tool watchdog; collect evidence before teardown'), 8 * 60_000)
    page.once('close', () => { clearTimeout(watchdog); ownedResult.browserEvents.push({ event: 'close', at: new Date().toISOString() }) })
    page.on('crash', () => ownedResult.browserEvents.push({ event: 'crash', at: new Date().toISOString() }))
    page.on('pageerror', error => ownedResult.errors.push(error.message))
    page.on('console', message => { if (message.type() === 'error') ownedResult.consoleErrors.push(message.text()) })
    const cdp = await context.newCDPSession(page)
    await cdp.send('Network.enable'); await cdp.send('Network.setCacheDisabled', { cacheDisabled: true })
    currentResult.browser = activeBrowser.version(); await page.goto(`${origin}/#${workbench}`)
    await page.getByTestId(workbenchTestId).waitFor({ state: 'visible' })
    check(await page.evaluate(() => !Reflect.has(window, '__sceneweavePerformance') && !Reflect.has(window, '__sceneweaveAssetsDev') && !Reflect.has(window, '__sceneweaveLayersDev')), 'Normal page exposed a product measurement/development API')
    await page.getByLabel('选择完整素材工程').setInputFiles(path.join(output, item.artifact.path))
    await page.getByRole('button', { name: '保存并打开副本', exact: true }).click(); await ready(page)
    await page.getByRole('checkbox', { name: '选择组合成员', exact: true }).check(); await settle(page)
    currentResult.initialRefinementSetup = await settleInitialRefinement(page)
    // Archive decoding and backup/IDB hashing are outside the measured selection window.
    const source = unzipSync(await fs.readFile(path.join(output, item.artifact.path))), scene = JSON.parse(new TextDecoder().decode(source['scene.json']))
    currentResult.beforePackage = await backup(page, `${currentLabel}-before.sceneweave`); await ready(page)
    check(currentResult.beforePackage.snapshot.schemaVersion === (workbench === 'layers' ? 3 : 2), 'Workbench did not adopt the expected native document version')
    currentResult.beforeStorage = await storageSnapshot(page)
    currentResult.before = await snapshot(page)
    const bounds = item.summary.worldBoundsMm, box = await canvasBox(page); check(box && box.width > 0 && box.height > 0, 'No visible primary map canvas')
    await marquee(page, box, bounds); await settle(page)
    const broad = JSON.parse((await snapshot(page)).selection), expected = expectedProps(scene, bounds)
    check(JSON.stringify(broad.filter(id => Object.hasOwn(scene.props, id)).sort()) === JSON.stringify(expected), 'Actual prop selection differs from independent rotated-corner/lock expectation')
    check(expected.length > 256, 'Fixture did not produce the expected over-budget selection')
    await page.getByRole('heading', { name: `已选择 ${broad.length} 个对象`, exact: true }).waitFor()
    check(await page.getByRole('button', { name: '预览批量移动', exact: true }).isDisabled(), 'Over-budget selection enabled bulk move')
    await selectMarker(page, item, box); await settle(page)
    const marker = JSON.parse((await snapshot(page)).selection)
    check(marker.length === 1 && marker[0] === item.summary.editablePropId, 'Marker pointer selected an unexpected entity')
    currentResult.selectionCalibration = { broadIds: broad, independentlyExpectedPropIds: expected, markerIds: marker }
    if (diagnostic) {
      const describe = () => {
        const info = selector => {
          const node = document.querySelector(selector)
          if (!node) return null
          const style = getComputedStyle(node), bounds = node.getBoundingClientRect()
          return { display: style.display, visibility: style.visibility, transition: style.transition, animation: style.animation, width: bounds.width, height: bounds.height }
        }
        return { rows: document.querySelectorAll('.asset-entity-list button').length, selectedRows: document.querySelectorAll('.asset-entity-list button.selected').length,
          list: info('.asset-entity-list'), row: info('.asset-entity-list button'), overlay: info('.asset-selection-overlay'), inspector: info('.asset-inspector'), inspectorChild: info('.asset-inspector>*') }
      }
      currentResult.diagnosticIntervention = { isolations, before: await page.evaluate(describe) }
      if (isolations.length) await page.addStyleTag({ content: isolations.map(name => isolationRules[name]).join('\n') })
      await settle(page)
      currentResult.diagnosticIntervention.after = await page.evaluate(describe)
    }
    for (let i = 0; i < manifest.config.warmupPairs; i++) { await marquee(page, box, bounds); await settle(page); await selectMarker(page, item, box); await settle(page) }
    currentResult.preMeasurementRefinementSetup = await settleInitialRefinement(page)
    currentResult.selectionWindowStart = await snapshot(page)
    if (profile) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 1000 }); await cdp.send('Profiler.start') }
    if (trace) {
      const available = await cdp.send('Tracing.getCategories')
      currentResult.traceCategories = traceCategories.filter(name => available.categories.includes(name))
      await cdp.send('Tracing.start', { categories: currentResult.traceCategories.join(','), transferMode: 'ReturnAsStream', options: 'record-as-much-as-possible' })
      activeTrace = { cdp, name: `${currentLabel}.trace.json` }
    }
    currentResult.measuredStartedAt = new Date().toISOString()
    for (let ordinal = 0; ordinal < selections; ordinal++) {
      for (const [kind, expectedSelection, action] of [['marquee', broad, () => marquee(page, box, bounds)], ['replacement', marker, () => selectMarker(page, item, box)]]) {
        const sample = await measure(page, kind, ordinal, expectedSelection, action)
        currentResult.samples.push(sample)
        if (diagnosticTailMs) {
          await page.waitForTimeout(diagnosticTailMs)
          if (trace) await page.evaluate(prefix => performance.mark(`${prefix}:diagnostic-tail`), sample.traceMarkerPrefix)
        }
      }
    }
    currentResult.measuredFinishedAt = new Date().toISOString()
    currentResult.selectionWindowEnd = await snapshot(page)
    if (profile) { const captured = await cdp.send('Profiler.stop'); await json(`${currentLabel}.cpuprofile`, captured.profile, true); currentResult.cpuProfile = `${currentLabel}.cpuprofile` }
    if (activeTrace) {
      const captured = await stopTrace(cdp, activeTrace.name); activeTrace = null
      const summaryPath = `${currentLabel}.trace-summary.json`
      await json(summaryPath, analyzeTrace(captured.events, currentResult.samples), true)
      currentResult.trace = { ...captured.artifact, summaryPath }
    }
    currentResult.after = await snapshot(page); currentResult.afterStorage = await storageSnapshot(page)
    currentResult.afterPackage = await backup(page, `${currentLabel}-after.sceneweave`); await ready(page)
    check(JSON.stringify(currentResult.beforeStorage) === JSON.stringify(currentResult.afterStorage), 'Selection changed raw IndexedDB content')
    check(JSON.stringify(currentResult.beforePackage.snapshot) === JSON.stringify(currentResult.afterPackage.snapshot), 'Selection changed complete package scene/resources/manifest')
    check(currentResult.before.revision === currentResult.after.revision && currentResult.before.renderCount === currentResult.after.renderCount && currentResult.before.save === currentResult.after.save, 'Selection changed revision/base rendering/save status')
    check(currentResult.selectionWindowStart.refinementCount === currentResult.selectionWindowEnd.refinementCount, 'Viewport refinement overlapped the selection window')
    check(!currentResult.errors.length, 'Product emitted page errors')
    currentResult.documentAndStorageUnchanged = true; currentResult.statistics = summarize(currentResult.samples)
    currentResult.finishedAt = new Date().toISOString(); await json(`${currentLabel}.json`, currentResult, true)
    manifest.results.push({ case: item.name, run, path: `${currentLabel}.json`, statistics: currentResult.statistics }); await json('manifest.json', manifest)
    console.log(`Complete ${currentLabel}: marquee release→double-rAF p95 ${currentResult.statistics.marquee.releaseToDisplayProxyMs.p95.toFixed(1)}ms; replacement ${currentResult.statistics.replacement.releaseToDisplayProxyMs.p95.toFixed(1)}ms`)
    await closeBrowser(); currentResult = null; currentLabel = null
    })())
  }
  check(JSON.stringify(await fingerprints(dist)) === JSON.stringify(manifest.build), 'Normal dist changed during measurement')
  manifest.buildUnchangedAfterMeasurement = true; manifest.status = 'complete'; manifest.finishedAt = new Date().toISOString()
  const completed = await Promise.all(manifest.results.map(item => fs.readFile(path.join(output, item.path), 'utf8').then(JSON.parse)))
  await json('summary.json', { measurementClass: manifest.measurementClass, method: manifest.config, cases: requestedCases.map(name => {
    const results = completed.filter(item => item.case === name)
    return { name, runs: results.length, statistics: summarize(results.flatMap(item => item.samples)) }
  }) }, true)
} catch (error) {
  manifest.status = 'failed'; manifest.failures.push({ at: new Date().toISOString(), message: String(error), stack: error.stack }); process.exitCode = 1; console.error(error)
  if (currentResult) {
    currentResult.failure = manifest.failures.at(-1)
    currentResult.failureEvidence = await failureEvidence()
    if (activeTrace) {
      try { const captured = await bounded(stopTrace(activeTrace.cdp, activeTrace.name), 20_000); currentResult.partialTrace = captured.artifact }
      catch (traceError) { currentResult.traceFailure = String(traceError) }
      activeTrace = null
    }
    await json(`${currentLabel}-partial-failure.json`, currentResult, true)
  }
} finally {
  clearInterval(suspensionMonitor)
  try { await closeBrowser() } finally { await json('manifest.json', manifest); await new Promise(resolve => server.close(resolve)); sleepGuard?.kill() }
}
