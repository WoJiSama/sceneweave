// Isolated, synthetic-input component diagnosis. Never modifies product source.
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { chromium } from '@playwright/test'
import ts from 'typescript'
import MagicString from 'magic-string'
import { startNativeFixtureTooling } from './prepare-native-m2-fixture.mjs'
import { fingerprintPaths, assertFrozen } from './frozen-input.mjs'

const toolRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const args = process.argv.slice(2), arg = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback
if (args.includes('--help')) {
  console.log('node tools/performance/run-history-cause-analysis.mjs --source ABS_FROZEN --input ABS_SYNTHETIC_SCENEWEAVE --output ABS_NEW [--history 20] [--channel chrome]')
  console.log('Copies frozen src into output, instruments synchronous coarse boundaries, prepares actual native history, measures cold save, then ABBA identical-graph worker audits with/without transaction keepalive and a separate page CPU profile. Not production UI or formal performance. Captured synthetic graph/profile remain in output.')
  process.exit(0)
}
const source = arg('--source'), input = arg('--input'), output = arg('--output'), history = Number(arg('--history', '20'))
if (![source, input, output].every(v => v && path.isAbsolute(v)) || !Number.isSafeInteger(history) || history < 0 || history > 100) throw new Error('Use absolute paths and history 0–100')
if (!path.resolve(output).startsWith(path.join(toolRoot, 'work') + path.sep)) throw new Error('Keep diagnostic source/data inside ignored work/')
await fs.mkdir(output, { recursive: true }); if ((await fs.readdir(output)).length) throw new Error('Use a new empty output directory')
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const frozenPaths = ['src', 'package.json', 'package-lock.json']
const toolPaths = ['tools/performance/run-history-cause-analysis.mjs', 'tools/performance/prepare-native-m2-fixture.mjs', 'tools/performance/frozen-input.mjs']
const fingerprint = async () => ({ source: await fingerprintPaths(source, frozenPaths), tools: await fingerprintPaths(toolRoot, toolPaths), input: sha(await fs.readFile(input)) })
const frozen = await fingerprint(), bytes = await fs.readFile(input), diagnostic = path.join(output, 'diagnostic-source')
const report = { format: 'sceneweave-history-cause-analysis', version: 1, status: 'preparing', startedAt: new Date().toISOString(), source, history,
  input: { sha256: sha(bytes), byteLength: bytes.length }, frozen,
  device: { platform: os.platform(), cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, memoryBytes: os.totalmem(), node: process.version },
  limitations: ['Synthetic fixture, title-only repository edits, source-module diagnosis; not production UI or formal performance.',
    'Synchronous timers report inclusive and self within selected boundaries; self still contains uninstrumented descendants and GC/scheduling.',
    'No recursive clone/freeze/point timers. Instrumentation changes timing; CPU profile is a separate direct-page audit with stage timers disabled.',
    'Transaction/no-transaction comparison uses exactly the same actual-read graph; standalone mode is diagnosis only, never a save implementation.',
    'JSON byte counts describe serialized data, never heap, resident memory or GPU. No exclusive system-load guard.'], workerDiagnostics: [], events: [] }
const write = () => fs.writeFile(path.join(output, 'analysis.json'), JSON.stringify(report, null, 2))
await write()
await fs.mkdir(diagnostic)
await fs.cp(path.join(source, 'src'), path.join(diagnostic, 'src'), { recursive: true })
for (const name of ['package.json', 'package-lock.json']) await fs.copyFile(path.join(source, name), path.join(diagnostic, name))
await fs.symlink(path.join(toolRoot, 'node_modules'), path.join(diagnostic, 'node_modules'), 'junction')
await fs.symlink(path.join(source, 'public'), path.join(diagnostic, 'public'), 'junction')

// All selected bodies are synchronous. The observer uses one stack, so selected
// descendants can be subtracted without summing overlapping inclusive spans.
const targets = {
  'platform/browser/storage/content-context.ts': ['prepareEncodedSnapshot', 'matchingEncodedSnapshot', 'snapshotContentPartition'],
  'platform/browser/storage/content-blocks.ts': ['prepareLocalProjectContent', 'encodeProjectContent'],
  'platform/browser/storage/history-records.ts': ['checkVersionRecord', 'remember', 'readCheckpoint', 'rebuildFromMap', 'auditHistoryRecords'],
  'shared/project/delta.ts': ['canonicalOwned', 'validateProjectDelta', 'applyChanges', 'remember', 'capture', 'encodedRepresentation', 'world', 'apply'],
  'shared/project/json.ts': ['parseBoundedJson'],
  'shared/project/validate.ts': ['readProjectData'],
  'shared/project/history.ts': ['include'],
  'shared/validation/json.ts': ['inspectJsonInput', 'captureJson', 'canonicalJson', 'encodeUtf8'],
  'shared/validation/hash.ts': ['sha256Bytes'],
  'shared/aggregates/scene-coordinates.ts': ['encodeProjectCoordinates', 'decodeProjectCoordinates', 'assertCoordinateRoundTrip'],
  'shared/validation/content.ts': ['checkGraph', 'validateAppearanceGraph', 'readCompositionDraft', 'readCompositionContent'],
  'shared/validation/scene.ts': ['parseSceneDocument', 'inspectSceneDocumentDomains', 'validateSceneDocument'],
  'shared/geometry/geometry.ts': ['validateGeometry', 'validatePropGeometry'],
  'shared/appearance/graph.ts': ['resolveAppearance'],
  'shared/history/identity.ts': ['validateHistoryIdentity'],
  'shared/commands/dependencies.ts': ['inspectDependencies'],
  'shared/visual/diagnostics.ts': ['validateVisualSystem'],
  'shared/terrain-generation/integrity.ts': ['validateTerrainContracts'],
  'shared/terrain-generation/composition-integrity.ts': ['validateCompositionContracts', 'validateCompositionIdentityContracts'],
  'shared/decorations/validation.ts': ['validateDecorations'],
  'shared/surface-rules/validation.ts': ['validateSurfaceRules'],
  'shared/aggregates/state.ts': ['validateAggregateCoordinates'],
  'shared/path-attachments/validation.ts': ['validatePathAttachmentGeometry', 'validatePathAttachmentProofs'],
}
report.boundaries = []
for (const [relative, names] of Object.entries(targets)) {
  const file = path.join(diagnostic, 'src', relative), code = await fs.readFile(file, 'utf8')
  // Later implementations add these synchronous boundaries. Keep the same
  // driver usable on a frozen baseline where the functions did not yet exist.
  const optional = relative.endsWith('content-context.ts') ? ['prepareEncodedProjectDelta', 'consumeEncodedProjectDelta']
    : relative.endsWith('project/delta.ts') ? ['diffProjectData', 'tryCreateVerifiedProjectDelta'] : []
  names.push(...optional.filter(name => code.includes(`function ${name}(`)))
  const ast = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true), edits = new MagicString(code), found = new Set()
  function visit(node) {
    const label = (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) && node.name ? node.name.getText(ast)
      : ts.isArrowFunction(node) && ts.isVariableDeclaration(node.parent) ? node.parent.name.getText(ast) : null
    if (label && node.body && names.includes(label)) {
      if (found.has(label) || node.modifiers?.some(m => m.kind === ts.SyntaxKind.AsyncKeyword)) throw new Error(`Duplicate/async boundary ${relative}#${label}`)
      found.add(label)
      const key = `${relative}#${label}`, body = node.body, size = label === 'sha256Bytes' ? ',bytes.length' : label === 'encodeUtf8' ? ',text.length' : ''
      const start = `const __cause=globalThis.__historyCauseTrace?.begin(${JSON.stringify(key)}${size});try{`
      const end = '}finally{__cause?.end()}'
      if (ts.isBlock(body)) { edits.appendLeft(body.getStart(ast) + 1, start); edits.prependLeft(body.end - 1, end) }
      else { edits.prependLeft(body.getStart(ast), `{${start}return (`); edits.appendRight(body.end, `);${end}}`) }
      report.boundaries.push({ key, line: ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1 })
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  if (found.size !== names.length) throw new Error(`Missing boundaries ${relative}: ${names.filter(n => !found.has(n))}`)
  await fs.writeFile(file, edits.toString())
}
function installTrace() {
  let stack = [], rows = new Map(), edges = new Map(), enabled = true
  globalThis.__historyCauseTrace = {
    enable(value) { enabled = value },
    reset() { if (stack.length) throw new Error('Open diagnostic stack'); rows = new Map(); edges = new Map() },
    begin(name, size = 0) {
      if (!enabled) return
      const span = { name, start: performance.now(), children: 0 }, parent = stack.at(-1); stack.push(span)
      return { end() {
        if (stack.pop() !== span) throw new Error('Non-synchronous diagnostic boundary')
        const ms = performance.now() - span.start
        if (parent) parent.children += ms
        const add = (map, key) => {
          const row = map.get(key) ?? { name: key, count: 0, inclusiveMs: 0, selfMs: 0, inputSize: 0, maximumInputSize: 0, maximumMs: 0 }
          row.count++; row.inclusiveMs += ms; row.selfMs += ms - span.children; row.inputSize += size
          row.maximumInputSize = Math.max(row.maximumInputSize, size); row.maximumMs = Math.max(row.maximumMs, ms); map.set(key, row)
        }
        add(rows, name); add(edges, `${parent?.name ?? '<root>'} -> ${name}`)
      } }
    },
    result() { return { rows: [...rows.values()], edges: [...edges.values()], open: stack.length } },
  }
}
const observerCode = `(${installTrace.toString()})();\n`
const workerFile = path.join(diagnostic, 'src/platform/browser/storage/history-audit-worker.ts')
const workerCode = await fs.readFile(workerFile, 'utf8')
// Keep the normal two-field result and error response intact; emit diagnostics
// over the browser console, after measuring the original audit call.
const compactBoundary = workerCode.includes('const result = await auditHistoryMessage(event.data)')
const auditCall = compactBoundary ? 'const result = await auditHistoryMessage(event.data)' : 'const result = auditHistoryRecords(owner, head, versions, pins)'
if (!workerCode.includes(auditCall)) throw new Error('Unknown history Worker boundary; cannot silently skip instrumentation')
await fs.writeFile(workerFile, observerCode + workerCode.replace(auditCall,
  `const __received=performance.timeOrigin+performance.now();const __start=performance.now();
    ${auditCall}
    const __end=performance.now();console.log('SCENEWEAVE_HISTORY_CAUSE '+JSON.stringify({receivedAt:__received,computeMs:__end-__start,trace:globalThis.__historyCauseTrace.result(),documentBytes:result.documentBytes}))`))
await fs.writeFile(path.join(diagnostic, 'cause-bridge.ts'), `import Dexie from 'dexie';export {Dexie};export {waitForStorageTransaction} from './src/platform/browser/storage/transaction-lifetime.ts';export {auditHistoryInWorker${compactBoundary ? ',auditCapturedHistoryInWorker' : ''}} from './src/platform/browser/storage/history-audit-client.ts';export {auditHistoryRecords} from './src/platform/browser/storage/history-records.ts';${compactBoundary ? "export {auditHistoryMessage} from './src/platform/browser/storage/history-audit-message.ts';" : ''}`)
report.diagnosticFiles = await fingerprintPaths(diagnostic, ['src', 'cause-bridge.ts'])
report.status = 'running'; await write()
let tooling, browser
try {
  tooling = await startNativeFixtureTooling({ root: diagnostic })
  browser = await chromium.launch({ channel: arg('--channel', 'chrome'), headless: true }); report.browser = browser.version()
  const context = await browser.newContext(), page = await context.newPage()
  page.on('console', event => {
    if (event.text().startsWith('SCENEWEAVE_HISTORY_CAUSE ')) report.workerDiagnostics.push(JSON.parse(event.text().slice('SCENEWEAVE_HISTORY_CAUSE '.length)))
    else if (event.type() === 'error') report.events.push({ type: 'console-error', message: event.text() })
  })
  page.on('pageerror', error => report.events.push({ type: 'page-error', message: error.message }))
  await page.goto(tooling.url); await page.evaluate(installTrace)
  // Install before loading Dexie: it captures this native method when opening
  // its connection, so a later prototype patch sees only the independent probe.
  await page.evaluate(() => {
    const transact = IDBDatabase.prototype.transaction
    IDBDatabase.prototype.transaction = function (...args) {
      const tx = transact.apply(this, args), state = globalThis.__historyCause
      if (state?.stage === 'cold-save') {
        const row = { mode: tx.mode, stores: [...tx.objectStoreNames], startedAt: performance.now() }; state.transactions.push(row)
        tx.addEventListener('complete', () => { row.completeMs = performance.now() - row.startedAt })
        tx.addEventListener('abort', () => { row.abortMs = performance.now() - row.startedAt })
      }
      return tx
    }
  })
  console.log(`Preparing real native history (${history} saves)`)
  report.setup = await page.evaluate(async ({ base64, history }) => {
    const [{ importProject }, { tryDerivedProjectBundle, validateProjectSnapshot }, { ProjectRepository }, { runtime, validation }, bridge] = await Promise.all([
      import('/src/shared/project/file.ts'), import('/src/shared/project/resources.ts'), import('/src/platform/browser/storage/repository.ts'), import('/src/platform/browser/runtime.ts'), import('/cause-bridge.ts')])
    const original = await importProject(Uint8Array.from(atob(base64), c => c.charCodeAt(0)), validation)
    const name = `sceneweave-projects-dev-v1-${crypto.randomUUID().replaceAll('-', '')}`, make = () => new ProjectRepository({ name, runtime, validation })
    const next = (bundle, title) => {
      const derived = tryDerivedProjectBundle({ project: { ...bundle.project, document: { ...bundle.project.document, title, revision: bundle.project.document.revision + 1, updatedAt: new Date().toISOString() } }, resources: bundle.resources }, bundle)
      if (!derived) throw new Error('Exact resource closure proof missing'); return derived
    }
    let repo = make(), current = (await repo.importSnapshotArchive({ current: original, snapshots: [] })).project
    const start = performance.now()
    for (let i = 0; i < history; i++) { const candidate = next(current, `prepared ${i}`); await repo.saveSnapshot(candidate, current.project.document.revision); current = candidate }
    repo.close(); repo = make()
    current = await validateProjectSnapshot(await repo.load(current.project.document.sceneId), validation)
    globalThis.__historyCause = { repo, current, next, bridge, name, workers: [], spans: [], transactions: [], stage: 'idle', spinCount: 0 }
    const state = globalThis.__historyCause, NativeWorker = globalThis.Worker, nativeGet = IDBObjectStore.prototype.get
    IDBObjectStore.prototype.get = function(key) { if (key === -Infinity) state.spinCount++; return nativeGet.call(this, key) }
    globalThis.Worker = class extends NativeWorker {
      constructor(...args) {
        const startedAt = performance.timeOrigin + performance.now(); super(...args)
        const row = { stage: state.stage, startedAt, url: String(args[0]) }; state.workers.push(row); this.__cause = row
        this.addEventListener('message', () => { row.receivedAt = performance.timeOrigin + performance.now() })
      }
      postMessage(value, ...rest) {
        if (value && Object.hasOwn(value, 'versions') && (Object.hasOwn(value, 'head') || value.kind === 'captured-history')) {
          state.graph = value; this.__cause.versions = value.versions.length
          if (state.stage === 'cold-save' && !state.coldLockProbe) {
            const probeStart = performance.now()
            state.coldLockProbe = new Promise((resolve, reject) => {
              const request = indexedDB.open(state.name)
              request.onerror = () => reject(request.error)
              request.onsuccess = () => {
                const db = request.result, tx = db.transaction(['storageState'], 'readwrite'), get = tx.objectStore('storageState').get('epoch')
                let acquiredMs
                get.onsuccess = () => { acquiredMs = performance.now() - probeStart }
                tx.oncomplete = () => { db.close(); resolve({ acquiredMs, totalMs: performance.now() - probeStart }) }
                tx.onabort = () => { db.close(); reject(tx.error) }
              }
            })
          }
          this.__cause.postStartedAt = performance.timeOrigin + performance.now()
          super.postMessage(value, ...rest); this.__cause.postEndedAt = performance.timeOrigin + performance.now()
        } else super.postMessage(value, ...rest)
      }
    }
    for (const [object, name, label] of [[repo, 'scanTotals'], [repo, 'prepareAccounting'], [repo, 'auditCapturedTotals'], [repo, 'putResources'], [repo, 'saveWithValidation'], [repo.history, 'audit', 'history.audit']]) {
      const original = object[name]
      if (typeof original !== 'function') continue
      object[name] = async function(...args) {
        const start = performance.now()
        try {
          const result = await original.apply(this, args)
          if (name === 'prepareAccounting' && result) return {
            async confirm(...parameters) {
              const confirmedAt = performance.now()
              try { return await result.confirm(...parameters) }
              finally { state.spans.push({ stage: state.stage, name: 'finalActualConfirmation', ms: performance.now() - confirmedAt }) }
            },
            release() { return result.release() },
          }
          return result
        } finally { state.spans.push({ stage: state.stage, name: label ?? name, ms: performance.now() - start }) }
      }
    }
    state.bridge.Dexie.ignoreTransaction(() => {})
    return { preparedMs: performance.now() - start, owner: current.project.document.sceneId, revision: current.project.document.revision, props: Object.keys(current.project.document.props).length }
  }, { base64: bytes.toString('base64'), history })
  console.log('Measuring instrumented cold save')
  report.coldSave = await page.evaluate(async () => {
    const s = globalThis.__historyCause; s.stage = 'cold-save'; globalThis.__historyCauseTrace.reset()
    const candidate = s.next(s.current, 'cold first measured'), spin = s.spinCount, start = performance.now()
    await s.repo.saveSnapshot(candidate, s.current.project.document.revision)
    const ms = performance.now() - start; s.current = candidate
    const lockProbe = s.coldLockProbe ? await s.coldLockProbe : null
    return { ms, spinCount: s.spinCount - spin, lockProbe, transactions: s.transactions, trace: globalThis.__historyCauseTrace.result(), spans: [...s.spans] }
  }); await write()
  const graphJson = await page.evaluate(() => JSON.stringify(globalThis.__historyCause.graph))
  await fs.writeFile(path.join(output, 'actual-read-graph.json'), graphJson, { flag: 'wx' })
  report.graph = { sha256: sha(graphJson), byteLength: Buffer.byteLength(graphJson), ...await page.evaluate(async () => {
    const s = globalThis.__historyCause, g = s.graph, raw = await new Promise((resolve, reject) => {
      const tx = s.repo.database.backendDB().transaction(['historyVersions', 'projectContentBlocks'], 'readonly'), values = {}
      for (const name of ['historyVersions', 'projectContentBlocks']) { const req = tx.objectStore(name).getAll(); req.onsuccess = () => { values[name] = req.result }; req.onerror = () => reject(req.error) }
      tx.oncomplete = () => resolve(values); tx.onabort = () => reject(tx.error)
    })
    const size = value => new TextEncoder().encode(JSON.stringify(value)).length
    return { versions: g.versions.length, checkpoints: g.versions.filter(v => v.checkpoint !== null).length, deltas: g.versions.filter(v => v.delta !== null).length,
      pins: g.pins.length, deltaChanges: g.versions.filter(v => v.delta !== null).map(v => v.delta.changes.length), checkpointJsonBytes: g.versions.filter(v => v.checkpoint !== null).map(v => size(v.checkpoint)),
      nativeVersionCountAfterColdSave: raw.historyVersions.length, nativeVersionJsonBytesAfterColdSave: size(raw.historyVersions),
      blockCountAfterColdSave: raw.projectContentBlocks.length, blockBytePayloadAfterColdSave: raw.projectContentBlocks.reduce((n, v) => n + v.bytes.length, 0),
      boundary: 'Worker graph captured immediately before cold save append; physical DB counts include the appended cold save and all content blocks, so not an exact compression ratio.' }
  }) }; await write()
  report.comparisons = []
  for (const mode of ['transaction', 'standalone', 'standalone', 'transaction']) {
    console.log(`Same-graph worker audit: ${mode}`)
    const row = await page.evaluate(async mode => {
      const s = globalThis.__historyCause, { auditHistoryInWorker, Dexie, waitForStorageTransaction } = s.bridge, g = s.graph
      s.stage = `${mode}-${s.workers.length}`; const start = performance.now(), spins = s.spinCount
      let result, lockProbe
      const compute = () => g.kind === 'captured-history' ? s.bridge.auditCapturedHistoryInWorker(g) : auditHistoryInWorker(g.owner, g.head, g.versions, g.pins)
      if (mode === 'standalone') result = await compute()
      else result = await s.repo.database.transaction('rw', s.repo.database.tables, async () => {
        // Acquire this connection's native write lock before the other probe.
        await s.repo.database.storageState.get('epoch')
        const probeStart = performance.now()
        lockProbe = Dexie.ignoreTransaction(() => new Promise((resolve, reject) => {
          const request = indexedDB.open(s.name)
          request.onerror = () => reject(request.error)
          request.onsuccess = () => {
            const db = request.result, tx = db.transaction(['storageState'], 'readwrite'), get = tx.objectStore('storageState').get('epoch')
            let acquiredMs
            get.onsuccess = () => { acquiredMs = performance.now() - probeStart }
            tx.oncomplete = () => { db.close(); resolve({ acquiredMs, totalMs: performance.now() - probeStart }) }
            tx.onabort = () => { db.close(); reject(tx.error) }
          }
        }))
        return waitForStorageTransaction(Dexie.ignoreTransaction(compute), 125_000)
      })
      const ms = performance.now() - start, lock = lockProbe ? await lockProbe : null
      return { mode, stage: s.stage, ms, spinCount: s.spinCount - spins, result, lock }
    }, mode)
    report.comparisons.push(row); await write()
  }
  console.log('Profiling separate synchronous same-graph audit; stage timers disabled')
  const cdp = await context.newCDPSession(page)
  await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 1000 })
  await page.evaluate(() => { globalThis.__historyCauseTrace.enable(false) })
  await cdp.send('Profiler.start')
  report.directPageAudit = await page.evaluate(async () => { const g = globalThis.__historyCause.graph, start = performance.now(), bridge = globalThis.__historyCause.bridge; const result = g.kind === 'captured-history' ? await bridge.auditHistoryMessage(g) : bridge.auditHistoryRecords(g.owner, g.head, g.versions, g.pins); return { ms: performance.now() - start, result } })
  const { profile } = await cdp.send('Profiler.stop'); await fs.writeFile(path.join(output, 'same-graph-page.cpuprofile'), JSON.stringify(profile), { flag: 'wx' })
  report.workers = await page.evaluate(() => globalThis.__historyCause.workers)
  report.outputConsistency = [...report.comparisons.map(r => r.result.documentBytes), report.directPageAudit.result.documentBytes]
  if (new Set(report.outputConsistency).size !== 1) throw new Error('Same graph produced different validated byte counts')
  const finalGraph = await page.evaluate(() => JSON.stringify(globalThis.__historyCause.graph))
  if (finalGraph !== graphJson) throw new Error('Actual-read graph changed during diagnosis')
  report.graph.unchangedAfterRun = true
  if (report.events.length) throw new Error('Unexpected page/console error; inspect retained events')
  if (report.workerDiagnostics.some(r => r.trace.open !== 0)) throw new Error('Unclosed worker trace')
  assertFrozen(frozen, await fingerprint(), 'source/input/tools after run')
  assertFrozen(report.diagnosticFiles, await fingerprintPaths(diagnostic, ['src', 'cause-bridge.ts']), 'diagnostic source after run')
  await page.evaluate(() => globalThis.__historyCause.repo.close())
  report.status = 'complete'; await context.close()
} catch (error) { report.status = 'failed'; report.error = error.stack ?? String(error); process.exitCode = 1; console.error(error) }
finally { await browser?.close(); await tooling?.close(); report.endedAt = new Date().toISOString(); await write() }
