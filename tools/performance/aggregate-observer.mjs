import { performance } from 'node:perf_hooks'
import { installNativeM2Observer } from './native-m2-observer.mjs'
import { startResourceSampling } from './resources.mjs'

const validTimeout = value => Number.isSafeInteger(value) && value > 0 && value <= 600000
const messageOf = error => error instanceof Error ? error.message : String(error)

function cpuDelta(before, after) {
  const first = new Map(before.processes.map(row => [row.id, row])), last = new Map(after.processes.map(row => [row.id, row]))
  const surviving = [], born = [], ended = [], reset = []
  for (const row of after.processes) {
    const previous = first.get(row.id)
    if (!previous) born.push({ ...row, observedCpuMs: row.cpuTimeSeconds * 1000 })
    else if (row.type !== previous.type || row.cpuTimeSeconds < previous.cpuTimeSeconds) reset.push({ before: previous, after: row })
    else surviving.push({ id: row.id, type: row.type, cpuMs: (row.cpuTimeSeconds - previous.cpuTimeSeconds) * 1000 })
  }
  for (const row of before.processes) if (!last.has(row.id)) ended.push(row)
  return {
    before, after, surviving, born, ended, reset,
    survivingProcessCpuMs: surviving.reduce((sum, row) => sum + row.cpuMs, 0),
    newlyObservedProcessCpuMs: born.reduce((sum, row) => sum + row.observedCpuMs, 0),
    completeProcessContinuity: born.length === 0 && ended.length === 0 && reset.length === 0,
    note: 'Browser CDP cumulative process CPU differences, not a CPU profile. Brackets include observer, automation and CDP waits. Newly observed process CPU includes its lifetime since birth; CPU after the first bracket for processes that exit before the second bracket is unavailable. Counter resets and process exits are retained explicitly.',
  }
}

/** Read committed native rows only; no Dexie/product hook, write or upgrade. */
async function readAggregateStorage(page, databaseName) {
  return page.evaluate(async selectedName => {
    if (typeof indexedDB.databases !== 'function') throw new Error('Existing IndexedDB enumeration is unavailable; storage audit cannot create a database to probe it.')
    const entries = (await indexedDB.databases()).filter(entry => entry.name && Number.isSafeInteger(entry.version) && entry.version > 0)
    if (selectedName !== undefined && !entries.some(entry => entry.name === selectedName)) throw new Error('Requested existing project database was not found.')
    const openExisting = entry => new Promise((resolve, reject) => {
      const request = indexedDB.open(entry.name, entry.version)
      let failed = false
      request.onupgradeneeded = () => request.transaction.abort()
      request.onerror = () => reject(request.error ?? new Error('Read-only database discovery failed.'))
      request.onblocked = () => { failed = true; reject(new Error('Read-only database discovery was blocked.')) }
      request.onsuccess = () => { if (failed) request.result.close(); else resolve(request.result) }
    })
    const candidates = []
    try {
      for (const entry of selectedName === undefined ? entries : entries.filter(entry => entry.name === selectedName)) {
        const db = await openExisting(entry)
        if (db.objectStoreNames.contains('projectContentBlocks')) candidates.push(db)
        else db.close()
      }
      if (candidates.length !== 1) throw new Error(`Expected one existing projectContentBlocks database, found ${candidates.length}; supply its exact name when there are several.`)
      const db = candidates[0], included = ['projectContentBlocks', 'projects', 'automaticSnapshots', 'snapshots', 'importedSnapshots',
        'historyVersions', 'historyHeads', 'historyPins', 'historyMetadata', 'storageState'].filter(name => db.objectStoreNames.contains(name))
      const stored = await new Promise((resolve, reject) => {
        const result = {}, transaction = db.transaction(included, 'readonly')
        transaction.onerror = () => reject(transaction.error ?? new Error('Read-only storage audit failed.'))
        transaction.onabort = () => reject(transaction.error ?? new Error('Read-only storage audit was aborted.'))
        transaction.oncomplete = () => resolve(result)
        for (const name of included) {
          const store = transaction.objectStore(name), keys = store.getAllKeys(), values = store.getAll()
          result[name] = { keys: null, values: null }
          keys.onsuccess = () => { result[name].keys = keys.result }
          values.onsuccess = () => { result[name].values = values.result }
        }
      })
      const digest = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('')
      // Match the product's deterministic UTF-16 key ordering and JSON number /
      // integer-key serialization. These are payload bytes, not IDB engine bytes.
      const ordered = value => Array.isArray(value) ? value.map(ordered)
        : value !== null && typeof value === 'object'
          ? Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])])) : value
      const jsonBytes = value => new TextEncoder().encode(JSON.stringify(ordered(value)))
      const blockRows = await Promise.all(stored.projectContentBlocks.values.map(async (row, index) => {
        const bytes = ArrayBuffer.isView(row.bytes) ? new Uint8Array(row.bytes.buffer, row.bytes.byteOffset, row.bytes.byteLength)
          : row.bytes instanceof ArrayBuffer ? new Uint8Array(row.bytes) : null
        if (!bytes || typeof row.sha256 !== 'string' || row.sha256 !== stored.projectContentBlocks.keys[index]
          || await digest(bytes) !== row.sha256) throw new Error('Committed content-block key, bytes or SHA-256 mismatch.')
        return { sha256: row.sha256, byteLength: bytes.byteLength }
      }))
      blockRows.sort((a, b) => a.sha256.localeCompare(b.sha256))
      const recordStores = {}
      for (const name of included.filter(name => name !== 'projectContentBlocks')) {
        const rows = await Promise.all(stored[name].values.map(async (row, index) => {
          const bytes = jsonBytes(row)
          return { key: JSON.stringify(stored[name].keys[index]), byteLength: bytes.byteLength, sha256: await digest(bytes) }
        }))
        rows.sort((a, b) => a.key.localeCompare(b.key))
        recordStores[name] = { rowCount: rows.length, canonicalJsonBytes: rows.reduce((sum, row) => sum + row.byteLength, 0), rows }
      }
      const projects = (stored.projects?.values ?? []).map(row => ({ sceneId: row.sceneId, revision: row.revision, status: row.status, contentHash: row.contentHash,
        manifest: row.project?.format === 'sceneweave-project-content-blocks' ? { contentHash: row.project.contentHash,
          projectCanonicalJsonBytes: row.project.byteLength, fieldCount: row.project.fields.length,
          blockReferenceCount: row.project.fields.reduce((sum, field) => sum + field.blocks.length, 0) } : null }))
      return { databaseName: db.name, databaseVersion: db.version, at: new Date().toISOString(),
        blocks: { count: blockRows.length, payloadBytes: blockRows.reduce((sum, row) => sum + row.byteLength, 0), rows: blockRows }, recordStores, projects,
        note: 'Native read-only transaction snapshot, followed by SHA-256 verification outside the transaction. Content-block payload bytes and canonical UTF-8 row payload bytes exclude IndexedDB keys/indexes/pages/engine overhead. Auditing and hashing are tooling work outside measured product phases.' }
    } finally { for (const db of candidates) db.close() }
  }, databaseName)
}

/** Immutable additions are observable; identical/repeated row writes are not. */
export function diffAggregateBlocks(before, after) {
  if (before.databaseName !== after.databaseName || before.databaseVersion !== after.databaseVersion) throw new Error('Storage observations belong to different databases or schemas.')
  const first = new Map(before.blocks.rows.map(row => [row.sha256, row.byteLength])), last = new Map(after.blocks.rows.map(row => [row.sha256, row.byteLength]))
  for (const [sha256, byteLength] of first) if (last.get(sha256) !== byteLength) throw new Error('An immutable content block was removed or changed between observations.')
  const added = after.blocks.rows.filter(row => !first.has(row.sha256)), changedRecords = [], removedRecords = []
  for (const name of new Set([...Object.keys(before.recordStores), ...Object.keys(after.recordStores)])) {
    const a = new Map((before.recordStores[name]?.rows ?? []).map(row => [row.key, row])), b = new Map((after.recordStores[name]?.rows ?? []).map(row => [row.key, row]))
    for (const [key, row] of b) if (a.get(key)?.sha256 !== row.sha256) changedRecords.push({ store: name, ...row })
    for (const [key, row] of a) if (!b.has(key)) removedRecords.push({ store: name, ...row })
  }
  return { addedBlockCount: added.length, newCommittedBlockPayloadBytes: added.reduce((sum, row) => sum + row.byteLength, 0), addedBlocks: added,
    changedAfterRecordPayloadBytes: changedRecords.reduce((sum, row) => sum + row.byteLength, 0), changedRecords,
    removedBeforeRecordPayloadBytes: removedRecords.reduce((sum, row) => sum + row.byteLength, 0), removedRecords,
    note: 'New SHA-256-verified immutable block payloads committed between snapshots; no block GC is allowed here. Changed-row bytes count each distinct final changed row once and cannot reveal identical, intermediate or repeated writes. These are logical payload observations, not physical disk write bytes.' }
}

/**
 * Diagnostics for a caller-owned, isolated normal-production Chrome process.
 * Creation does not navigate or launch a browser. Call before page.goto(), stop
 * before browser teardown, and keep storage/download audits in tooling phases.
 */
export async function createAggregateObserver({ page, browser, rootPid, timeoutMs = 120000, intervalMs = 100, heapIntervalMs = 200 }) {
  if (process.platform !== 'darwin') throw new Error('Aggregate process-tree RSS observation is currently validated only on macOS.')
  if (!validTimeout(timeoutMs)) throw new TypeError('timeoutMs must be a positive integer no greater than 600000.')
  const cdp = await page.context().newCDPSession(page), browserCdp = await browser.newBrowserCDPSession()
  let sampler, stopped = false, stopping, measuring = false, phase = 'idle'
  const cpuWarnings = [], samples = [], audit = { pageErrors: [], requestFailures: [], httpErrors: [], consoleErrors: [], browserErrors: [] }
  const onPageError = error => audit.pageErrors.push(messageOf(error))
  const onRequestFailed = request => audit.requestFailures.push({ url: request.url(), errorText: request.failure()?.errorText ?? null })
  const onConsole = event => { if (event.type() === 'error') audit.consoleErrors.push({ text: event.text(), location: event.location() }) }
  const onResponse = event => { if (event.response.status >= 400) audit.httpErrors.push({ url: event.response.url, status: event.response.status, type: event.type }) }
  const onLog = ({ entry }) => { if (entry.level === 'error') audit.browserErrors.push({ source: entry.source, text: entry.text, url: entry.url ?? null }) }
  page.on('pageerror', onPageError); page.on('requestfailed', onRequestFailed); page.on('console', onConsole)
  cdp.on('Network.responseReceived', onResponse); cdp.on('Log.entryAdded', onLog)
  try {
    await page.addInitScript(installNativeM2Observer)
    await cdp.send('Performance.enable'); await cdp.send('Network.enable'); await cdp.send('Log.enable')
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true })
    sampler = startResourceSampling({ rootPid, cdp, intervalMs, heapIntervalMs })
  } catch (error) {
    page.off('pageerror', onPageError); page.off('requestfailed', onRequestFailed); page.off('console', onConsole)
    await Promise.allSettled([cdp.detach(), browserCdp.detach()]); throw error
  }
  const live = () => { if (stopped) throw new Error('Aggregate observer has stopped.') }
  const snapshot = async () => { live(); return page.evaluate(() => Reflect.get(window, '__sceneweaveNativeM2Probe').snapshot()) }
  function setPhase(next) { live(); sampler.setPhase(next); phase = next }
  const cpu = async () => {
    const startedNodeMs = performance.now(), { processInfo } = await browserCdp.send('SystemInfo.getProcessInfo')
    if (!Array.isArray(processInfo) || processInfo.some(row => !Number.isSafeInteger(row.id) || !Number.isFinite(row.cpuTime) || row.cpuTime < 0)) throw new Error('Browser process CPU counters were unavailable or invalid.')
    return { startedNodeMs, endedNodeMs: performance.now(), processes: processInfo.map(row => ({ id: row.id, type: row.type, cpuTimeSeconds: row.cpuTime })) }
  }
  const heap = async () => {
    const startedNodeMs = performance.now(), result = await cdp.send('Performance.getMetrics'), metrics = Object.fromEntries(result.metrics.map(row => [row.name, row.value]))
    if (!Number.isFinite(metrics.JSHeapUsedSize) || !Number.isFinite(metrics.JSHeapTotalSize)) throw new Error('Target JS heap metrics are unavailable.')
    return { startedNodeMs, endedNodeMs: performance.now(), usedBytes: metrics.JSHeapUsedSize, totalBytes: metrics.JSHeapTotalSize }
  }
  const readProbe = () => page.evaluate(() => Reflect.get(window, '__sceneweaveNativeM2Probe').read())
  return {
    snapshot, setPhase,
    async ready() {
      live()
      await page.waitForFunction(() => {
        const state = Reflect.get(window, '__sceneweaveNativeM2Probe')?.snapshot()
        return state?.nativeFormat === 'sceneweave-complete-project@1' && state.save === '本地已保存' && !state.busy && state.mapBusy === 'false' && state.primaryCanvas
      }, undefined, { timeout: timeoutMs })
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    },
    async measure(kind, options, action) {
      live()
      if (measuring) throw new Error('Aggregate product measurements must run serially.')
      if (!options?.start?.event || typeof action !== 'function') throw new TypeError('A trusted input event specification and action are required.')
      if (options.domainCommit && !Number.isSafeInteger(options.expectedRevision)) throw new TypeError('A domain commit observation requires its exact expected revision.')
      console.log(`Aggregate operation: ${kind}`)
      measuring = true
      const oldPhase = phase, nodeStartedMs = performance.now(), observation = { kind, measurementClass: 'diagnostic-normal-production-ui', status: 'running' }
      let failure
      try {
        setPhase(kind)
        observation.cpuBefore = await cpu(); observation.heapBefore = await heap()
        await page.evaluate(config => Reflect.get(window, '__sceneweaveNativeM2Probe').arm(config), options)
        await action()
        await page.waitForFunction(rejectText => Reflect.get(window, '__sceneweaveNativeM2Probe').read()?.complete === true
          || rejectText && document.body.innerText.includes(rejectText), options.rejectText ?? null, { timeout: timeoutMs })
        if (options.rejectText && await page.locator('body').innerText().then(value => value.includes(options.rejectText))) throw new Error(`${kind}: normal UI rejected the operation (${options.rejectText}).`)
        const sample = await readProbe()
        if (!sample.intent?.trusted) throw new Error(`${kind}: missing trusted start input.`)
        const clockDifferenceMs = (sample.clockAtDisplay.wallMs - sample.clockAtArm.wallMs) - (sample.clockAtDisplay.monotonicMs - sample.clockAtArm.monotonicMs)
        if (Math.abs(clockDifferenceMs) > 250) throw new Error(`${kind}: wall and monotonic clocks diverged; possible host suspension.`)
        if (options.domainCommit && (!Number.isFinite(sample.domainCommittedAtMs) || sample.domainCommittedAtMs < sample.intent.captureMs || sample.after.transactionRevision !== options.expectedRevision || sample.after.revision !== options.expectedRevision)) throw new Error(`${kind}: transaction timestamp or exact revision mismatch.`)
        if (options.unchangedDocument && (sample.before.revision !== sample.after.revision || sample.before.save !== sample.after.save)) throw new Error(`${kind}: transient UI operation changed revision or save state.`)
        observation.sample = { ...sample, browserClockDiscontinuityMs: clockDifferenceMs,
          intentToDomainCommitMs: sample.domainCommittedAtMs === undefined ? null : sample.domainCommittedAtMs - sample.intent.captureMs,
          intentToDomRevisionMs: sample.domRevisionMs === undefined ? null : sample.domRevisionMs - sample.intent.captureMs,
          intentToRasterReadyMs: sample.rasterReadyMs === undefined ? null : sample.rasterReadyMs - sample.intent.captureMs,
          intentToSavedMs: sample.savedReadyMs === undefined ? null : sample.savedReadyMs - sample.intent.captureMs,
          intentToDisplayProxyMs: sample.displayProxyMs - sample.intent.captureMs }
        observation.status = 'complete'
      } catch (error) {
        failure = error; observation.status = 'failed'; observation.error = messageOf(error)
        try { observation.partialSample = await readProbe() } catch {}
      } finally {
        try {
          const after = await cpu()
          if (observation.cpuBefore) {
            observation.cpu = cpuDelta(observation.cpuBefore, after)
            if (!observation.cpu.completeProcessContinuity) cpuWarnings.push({ kind, born: observation.cpu.born, ended: observation.cpu.ended, reset: observation.cpu.reset })
          }
          observation.heapAfter = await heap()
        } catch (error) { observation.resourceError = messageOf(error); failure ??= error; observation.status = 'failed' }
        observation.nodeWindowMs = performance.now() - nodeStartedMs
        samples.push(observation); setPhase(oldPhase); measuring = false
      }
      if (failure) { failure.aggregateObservation = observation; throw failure }
      return observation
    },
    async blockSnapshot(databaseName) {
      live()
      if (measuring) throw new Error('Read-only storage hashing must remain outside measured product operations.')
      const oldPhase = phase
      try { setPhase('tooling-storage-audit'); return await readAggregateStorage(page, databaseName) }
      finally { setPhase(oldPhase) }
    },
    async stop() {
      if (stopping) return stopping
      if (measuring) throw new Error('Finish the active product observation before stopping its sampler.')
      stopped = true
      stopping = (async () => {
        const resources = await sampler.stop()
        page.off('pageerror', onPageError); page.off('requestfailed', onRequestFailed); page.off('console', onConsole)
        cdp.off('Network.responseReceived', onResponse); cdp.off('Log.entryAdded', onLog)
        await Promise.allSettled([cdp.detach(), browserCdp.detach()])
        return { measurementClass: 'diagnostic-normal-production-ui', samples, resources, cpuWarnings, audit,
          notes: ['Double-rAF is a browser scheduling proxy, not GPU/presentation completion.', 'RSS is a sampled dedicated macOS process-tree sum and may count shared mappings more than once; target JS heap omits GPU and other targets.', 'No CPU profiling, forced garbage collection, product instrumentation or database writes are performed by this observer.', 'Sampling, automation and CDP overhead are retained. Tooling storage/hash/download phases must not be reported as product peaks.', 'These observations do not establish a formal performance pass, capacity promise, human UX or cross-browser acceptance.'] }
      })()
      return stopping
    },
  }
}
