import { execFile } from 'node:child_process'
import { basename } from 'node:path'
import { performance } from 'node:perf_hooks'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

function processType(comm, isRoot) {
  if (isRoot) return 'browser'
  if (/\(renderer\)/i.test(comm)) return 'renderer'
  if (/\(gpu\)/i.test(comm)) return 'gpu'
  if (/crashpad/i.test(comm)) return 'crash-handler'
  if (/helper/i.test(comm)) return 'helper'
  return 'child'
}

/** Parse without retaining command lines or unrelated processes in evidence. */
export function parseProcessSnapshot(output, rootPid) {
  const rows = []
  let malformedRows = 0
  for (const line of output.split(/\r?\n/)) {
    if (!line.trim()) continue
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.+?)\s*$/.exec(line)
    if (!match) { malformedRows++; continue }
    const [, pid, ppid, rssKiB, command] = match
    const row = { pid: Number(pid), ppid: Number(ppid), rssKiB: Number(rssKiB), comm: basename(command) }
    if (![row.pid, row.ppid, row.rssKiB, row.rssKiB * 1024].every(Number.isSafeInteger)) { malformedRows++; continue }
    rows.push(row)
  }
  const children = new Map()
  for (const row of rows) {
    const siblings = children.get(row.ppid) ?? []
    siblings.push(row.pid)
    children.set(row.ppid, siblings)
  }
  const included = new Set([rootPid]), queue = [rootPid]
  for (let index = 0; index < queue.length; index++) {
    for (const pid of children.get(queue[index]) ?? []) if (!included.has(pid)) { included.add(pid); queue.push(pid) }
  }
  const processes = rows.filter(row => included.has(row.pid)).map(row => ({
    ...row, rssBytes: row.rssKiB * 1024, type: processType(row.comm, row.pid === rootPid),
  })).sort((left, right) => left.pid - right.pid)
  return {
    rootPresent: processes.some(row => row.pid === rootPid),
    malformedRows,
    processes,
    rssBytes: processes.reduce((total, row) => total + row.rssBytes, 0),
  }
}

function distribution(values) {
  if (!values.length) return { count: 0, min: null, p50: null, p95: null, max: null, mean: null }
  const sorted = [...values].sort((left, right) => left - right)
  return {
    count: sorted.length, min: sorted[0], p50: sorted[Math.ceil(sorted.length * .5) - 1],
    p95: sorted[Math.ceil(sorted.length * .95) - 1], max: sorted.at(-1),
    mean: sorted.reduce((total, value) => total + value, 0) / sorted.length,
  }
}

function intervals(samples) {
  return distribution(samples.slice(1).map((sample, index) => sample.startedElapsedMs - samples[index].startedElapsedMs))
}

function maxSample(samples, field) {
  return samples.reduce((peak, sample) => Number.isFinite(sample[field]) && (!peak || sample[field] > peak[field]) ? sample : peak, null)
}

function sampleReference(sample, field) {
  return sample ? {
    valueBytes: sample[field], startedAtMs: sample.startedAtMs, endedAtMs: sample.endedAtMs,
    startedElapsedMs: sample.startedElapsedMs, endedElapsedMs: sample.endedElapsedMs,
    phase: sample.phase, phaseAtEnd: sample.phaseAtEnd, phaseBoundary: sample.phaseBoundary,
  } : null
}

function summarize(samples, heapSamples, errors, config, phaseMarkers) {
  const usable = samples.filter(sample => sample.rootPresent)
  const rssPeak = maxSample(usable, 'rssBytes'), heapPeak = maxSample(heapSamples, 'heapUsedBytes')
  const byPhase = Object.create(null)
  for (const phase of new Set(phaseMarkers.map(marker => marker.phase))) {
    const processPhase = usable.filter(sample => sample.phase === phase && !sample.phaseBoundary)
    const heapPhase = heapSamples.filter(sample => sample.phase === phase && !sample.phaseBoundary)
    byPhase[phase] = {
      processSampleCount: processPhase.length, heapSampleCount: heapPhase.length,
      rssPeakBytes: maxSample(processPhase, 'rssBytes')?.rssBytes ?? null,
      jsHeapPeakUsedBytes: maxSample(heapPhase, 'heapUsedBytes')?.heapUsedBytes ?? null,
      processSamplingIntervalsMs: intervals(processPhase), heapSamplingIntervalsMs: intervals(heapPhase),
    }
  }
  const perTypeSampledPeaksBytes = {}
  for (const sample of usable) {
    const current = {}
    for (const row of sample.processes) current[row.type] = (current[row.type] ?? 0) + row.rssBytes
    for (const [type, bytes] of Object.entries(current)) perTypeSampledPeaksBytes[type] = Math.max(perTypeSampledPeaksBytes[type] ?? 0, bytes)
  }
  return {
    config,
    processSampleCount: samples.length, rootPresentSampleCount: usable.length,
    rootMissingSampleCount: samples.length - usable.length,
    heapSampleCount: heapSamples.length,
    heapValueSampleCount: heapSamples.filter(sample => Number.isFinite(sample.heapUsedBytes)).length,
    errorCount: errors.length,
    rssSampledPeakBytes: rssPeak?.rssBytes ?? null,
    rssPeak: sampleReference(rssPeak, 'rssBytes'),
    firstRssBytes: usable[0]?.rssBytes ?? null, lastRssBytes: usable.at(-1)?.rssBytes ?? null,
    peakMinusFirstRssBytes: rssPeak && usable.length ? rssPeak.rssBytes - usable[0].rssBytes : null,
    perTypeSampledPeaksBytes,
    jsHeapSampledPeakUsedBytes: heapPeak?.heapUsedBytes ?? null,
    heapPeak: sampleReference(heapPeak, 'heapUsedBytes'),
    processSamplingIntervalsMs: intervals(samples), heapSamplingIntervalsMs: intervals(heapSamples),
    processPollDurationMs: distribution(samples.map(sample => sample.durationMs)),
    heapPollDurationMs: distribution(heapSamples.map(sample => sample.durationMs)),
    phaseBoundaryProcessSamples: samples.filter(sample => sample.phaseBoundary).length,
    phaseBoundaryHeapSamples: heapSamples.filter(sample => sample.phaseBoundary).length,
    phaseMarkers, byPhase,
    notes: [
      'RSS is a sampled simultaneous sum over the dedicated root PID and its currently observed descendants. ps RSS KiB is multiplied by 1024.',
      'Shared mappings can be counted in several processes. RSS sum is not deduplicated physical memory, complete browser memory, or GPU/Metal allocation peak.',
      'Children reparented outside the observed root tree are excluded. No unrelated Chrome or user processes are retained in these results.',
      'Configured intervals are targets; actual intervals and poll durations are recorded. Transients between polls may be missed.',
      'Per-type peaks need not occur together and must not be added. Global RSS peak is max over each simultaneous process-tree sum.',
      'CDP metrics describe only the supplied target session. A getMetrics observation occurs within its request/response interval, which can widen during main-thread blocking.',
      'Phase summaries exclude observations whose request crossed a phase change; global peaks include them with both boundary phases recorded.',
      'No forced garbage collection, heap snapshot, GPU dump, or full system memory measurement is performed.',
      'The first RSS value is an observation, not an asserted idle baseline. Callers should create a measured idle phase when a baseline is needed.',
    ],
  }
}

/**
 * Independent OS RSS and target-CDP heap polling. The caller enables Performance
 * on the supplied CDP session before starting and stops before closing Chrome.
 * Importing this module does not start a browser or sampler.
 */
export function startResourceSampling({ rootPid, cdp, intervalMs = 100, heapIntervalMs = 200 }) {
  if (!Number.isSafeInteger(rootPid) || rootPid < 1) throw new TypeError('rootPid must be a positive OS process id.')
  if (!cdp || typeof cdp.send !== 'function') throw new TypeError('An enabled target CDP session is required.')
  if (![intervalMs, heapIntervalMs].every(value => Number.isFinite(value) && value >= 10)) throw new TypeError('Sampling intervals must be finite and at least 10 ms.')
  const startedAtMs = Date.now(), origin = performance.now()
  const samples = [], heapSamples = [], errors = [], phaseMarkers = [{ phase: 'idle', atMs: startedAtMs, elapsedMs: 0 }]
  let phase = 'idle', phaseVersion = 0, stopped = false, stopPromise
  let processTimer, heapTimer, processInFlight, heapInFlight
  const config = { rootPid, intervalMs, heapIntervalMs, startedAtMs, psCommand: '/bin/ps -axo pid=,ppid=,rss=,comm=' }
  const stamp = () => ({ atMs: Date.now(), elapsedMs: performance.now() - origin })
  const startObservation = () => ({ startedAtMs: Date.now(), startedElapsedMs: performance.now() - origin, phase, phaseVersion })
  function finishObservation(start) {
    const end = stamp()
    return {
      startedAtMs: start.startedAtMs, endedAtMs: end.atMs,
      startedElapsedMs: start.startedElapsedMs, endedElapsedMs: end.elapsedMs,
      durationMs: end.elapsedMs - start.startedElapsedMs,
      phase: start.phase, phaseAtEnd: phase, phaseBoundary: start.phaseVersion !== phaseVersion,
    }
  }
  function recordError(code, error, start) {
    const timing = finishObservation(start)
    // execFile errors can contain command output; do not retain their message/stdout/stderr.
    errors.push({ ...timing, code, errorName: error instanceof Error ? error.name : 'Error',
      ...(typeof error?.code === 'string' || typeof error?.code === 'number' ? { errorCode: error.code } : {}) })
  }
  async function collectProcess() {
    const start = startObservation()
    try {
      const { stdout } = await execFileAsync('/bin/ps', ['-axo', 'pid=,ppid=,rss=,comm='], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 })
      const parsed = parseProcessSnapshot(stdout, rootPid)
      samples.push({ ...finishObservation(start), ...parsed })
      if (parsed.malformedRows) errors.push({ ...finishObservation(start), code: 'PS_MALFORMED_ROWS', count: parsed.malformedRows })
    } catch (error) { recordError('PS_SNAPSHOT_FAILED', error, start) }
  }
  async function collectHeap() {
    const start = startObservation()
    try {
      const result = await cdp.send('Performance.getMetrics')
      if (!result || !Array.isArray(result.metrics)) throw new TypeError('Invalid metrics response')
      const metrics = Object.fromEntries(result.metrics.filter(metric => typeof metric.name === 'string' && Number.isFinite(metric.value)).map(metric => [metric.name, metric.value]))
      const timing = finishObservation(start)
      heapSamples.push({ ...timing, metrics,
        ...(Number.isFinite(metrics.JSHeapUsedSize) ? { heapUsedBytes: metrics.JSHeapUsedSize } : {}),
        ...(Number.isFinite(metrics.JSHeapTotalSize) ? { heapTotalBytes: metrics.JSHeapTotalSize } : {}) })
      if (!Number.isFinite(metrics.JSHeapUsedSize) || !Number.isFinite(metrics.JSHeapTotalSize)) errors.push({ ...timing, code: 'CDP_HEAP_METRICS_UNAVAILABLE' })
    } catch (error) { recordError('CDP_METRICS_FAILED', error, start) }
  }
  function pollProcess() {
    if (stopped) return
    const start = performance.now()
    processInFlight = collectProcess().finally(() => {
      processInFlight = undefined
      if (!stopped) processTimer = setTimeout(pollProcess, Math.max(0, intervalMs - (performance.now() - start)))
    })
  }
  function pollHeap() {
    if (stopped) return
    const start = performance.now()
    heapInFlight = collectHeap().finally(() => {
      heapInFlight = undefined
      if (!stopped) heapTimer = setTimeout(pollHeap, Math.max(0, heapIntervalMs - (performance.now() - start)))
    })
  }
  pollProcess()
  pollHeap()
  return {
    setPhase(nextPhase) {
      if (stopped) throw new Error('Resource sampling has stopped.')
      if (typeof nextPhase !== 'string' || !nextPhase.trim() || nextPhase.length > 120) throw new TypeError('A non-empty phase name of at most 120 characters is required.')
      if (nextPhase === phase) return
      phase = nextPhase
      phaseVersion++
      phaseMarkers.push({ phase, ...stamp() })
    },
    async stop() {
      if (stopPromise) return stopPromise
      stopped = true
      clearTimeout(processTimer)
      clearTimeout(heapTimer)
      stopPromise = (async () => {
        await Promise.allSettled([processInFlight, heapInFlight].filter(Boolean))
        const ended = stamp()
        return { samples, heapSamples, errors, summary: {
          ...summarize(samples, heapSamples, errors, config, phaseMarkers),
          endedAtMs: ended.atMs, durationMs: ended.elapsedMs,
        } }
      })()
      return stopPromise
    },
  }
}
