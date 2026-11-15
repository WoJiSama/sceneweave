import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { contentSha256 } from './frozen-input.mjs'

export const median = values => {
  const sorted = values.filter(Number.isFinite).toSorted((a, b) => a - b)
  return sorted.length ? (sorted[(sorted.length - 1) >> 1] + sorted[sorted.length >> 1]) / 2 : null
}
const rounded = value => Number.isFinite(value) ? Math.round(value * 100) / 100 : null
export const mib = value => Number.isFinite(value) ? rounded(value / 1048576) : null
const percentage = value => Number.isFinite(value) ? rounded(value * 100) : null
const functionMs = (diagnostic, name) => rounded(diagnostic?.functions?.[name]?.inclusiveMs)

export function summarizeCold(report) {
  if (report.status !== 'complete' || report.rows.some(row => row.status !== 'complete')) throw Error('Cold evidence is incomplete')
  return { status: report.status, startedAt: report.startedAt, endedAt: report.endedAt, config: report.config,
    rows: report.config.cases.map(factor => {
      const rows = report.rows.filter(row => row.case === factor.name).toSorted((a, b) => a.round - b.round)
      if (rows.length !== report.config.rounds || new Set(rows.map(row => row.round)).size !== report.config.rounds
        || rows.some(row => row.saves?.length !== 3)) throw Error('Cold evidence has missing rounds or saves')
      return { case: factor.name, coldMs: rows.map(row => rounded(row.saves[0].totalMs)),
        warmMedianMs: rounded(median(rows.flatMap(row => row.saves.slice(1).map(save => save.totalMs)))),
        rounds: rows.map(row => {
          const cold = row.saves[0], d = cold.diagnostic, w = cold.workers[0], phase = row.resources.summary.byPhase.cold
          const samples = row.resources.samples.filter(s => s.phase === 'cold' && s.phaseAtEnd === 'cold' && !s.phaseBoundary)
          return { round: row.round, captureMs: functionMs(d, 'storage-audit.ts#capture'), confirmMs: functionMs(d, 'storage-audit.ts#confirm'),
            pageAuditMs: functionMs(d, 'repository.ts#auditCapturedTotals'), workerWaitMs: functionMs(d, 'history-audit-client.ts#auditCapturedHistoryInWorker'),
            workerMaterializeMs: functionMs(w, 'content-blocks.ts#assembleProjectContent'), workerReplayMs: functionMs(w, 'history-records.ts#auditHistoryRecords'),
            workerValidationMs: functionMs(w, 'validate.ts#readProjectData'), workerValidations: w?.functions?.['validate.ts#readProjectData']?.count ?? null,
            workerHashMs: functionMs(w, 'hash.ts#sha256Bytes'), workerHashBytes: w?.functions?.['hash.ts#sha256Bytes']?.inputBytes ?? null,
            workerParses: w?.functions?.['content-blocks.ts#parseContentBlock']?.count ?? null, captures: d.captures,
            processSamples: phase.processSampleCount, heapSamples: phase.heapSampleCount, intervalMs: phase.processSamplingIntervalsMs,
            workingSetMiB: mib(phase.rssPeakBytes), privateCommitMiB: mib(phase.privateCommitPeakBytes), heapMiB: mib(phase.jsHeapPeakUsedBytes),
            systemCpuBusyPercent: percentage(median(samples.map(s => s.background?.systemCpuBusyFraction))), consistency: row.consistency }
        }) }
    }) }
}

/** Some raw phase labels remain active while the next switch is prepared.
 * Limit idle summaries to their declared duration, excluding boundary samples. */
export function summarizeIdle(resources, name, durationMs) {
  const marker = resources.summary.phaseMarkers.find(value => value.phase === name)
  if (!marker) throw Error(`Missing lifecycle phase ${name}`)
  const within = sample => sample.phase === name && sample.phaseAtEnd === name && !sample.phaseBoundary
    && sample.startedElapsedMs >= marker.elapsedMs && sample.endedElapsedMs <= marker.elapsedMs + durationMs
  const samples = resources.samples.filter(within), heaps = resources.heapSamples.filter(within)
  return { phase: name, durationMs, processSamples: samples.length, heapSamples: heaps.length,
    workingSetMedianMiB: mib(median(samples.map(s => s.rssBytes))), privateCommitMedianMiB: mib(median(samples.map(s => s.privateBytes))),
    heapMedianMiB: mib(median(heaps.map(s => s.heapUsedBytes))), systemCpuBusyPercent: percentage(median(samples.map(s => s.background?.systemCpuBusyFraction))) }
}

export function summarizeMemory(report) {
  if (report.status !== 'complete' || report.rows.length !== report.config.rounds * 2
    || report.rows.some(row => row.status !== 'complete' || row.cycles?.length !== report.config.cycles)
    || new Set(report.rows.map(row => `${row.round}:${row.mode}`)).size !== report.config.rounds * 2) throw Error('Lifecycle evidence is incomplete')
  return { status: report.status, startedAt: report.startedAt, endedAt: report.endedAt, config: report.config,
    rows: report.rows.map(row => ({ round: row.round, mode: row.mode,
      cycles: row.cycles.map(cycle => ({ cycle: cycle.cycle, versions: cycle.versions, workMs: rounded(cycle.workMs),
        heapEndpointMiB: mib(cycle.heapUsedBytes), activeWorkers: cycle.activeWorkers, idle: summarizeIdle(row.resources, `cycle-${cycle.cycle}-idle`, report.config.idleMs) })),
      idle: [['initial-idle', 10000], ['final-idle', 15000], ['switched-idle', 10000], ['released-idle', 10000]]
        .map(([name, ms]) => summarizeIdle(row.resources, name, ms)),
      closedPage: { processSamples: row.closedProcessSamples.length, workingSetMedianMiB: mib(median(row.closedProcessSamples.map(s => s.rssBytes))),
        privateCommitMedianMiB: mib(median(row.closedProcessSamples.map(s => s.privateBytes))) },
      workers: { count: row.workers.length, allClosed: row.workers.every(w => Number.isFinite(w.closedAt)) },
      rootExited: row.rootExited, consistency: row.consistency })) }
}

async function main() {
  const args = process.argv.slice(2), arg = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined
  if (args.includes('--help')) { console.log('node tools/performance/summarize-storage-lifecycle.mjs [--cold ABS_ANALYSIS_JSON] [--memory ABS_ANALYSIS_JSON] --output ABS_NEW_JSON'); return }
  const cold = arg('--cold'), memory = arg('--memory'), output = arg('--output')
  if ((!cold && !memory) || ![cold, memory, output].filter(Boolean).every(path.isAbsolute) || !output) throw Error('Use absolute input reports and a new output JSON')
  const result = { format: 'sceneweave-storage-lifecycle-summary', version: 1, runnerSha256: contentSha256(await fs.readFile(fileURLToPath(import.meta.url))), inputs: {} }
  for (const [name, input, summarize] of [['cold', cold, summarizeCold], ['memory', memory, summarizeMemory]]) if (input) {
    const bytes = await fs.readFile(input); result.inputs[name] = { path: input, sha256: contentSha256(bytes) }; result[name] = summarize(JSON.parse(bytes))
  }
  await fs.mkdir(path.dirname(output), { recursive: true }); await fs.writeFile(output, JSON.stringify(result, null, 2), { flag: 'wx' })
  console.log('Complete storage/lifecycle summaries written; null and declared idle windows preserved')
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
