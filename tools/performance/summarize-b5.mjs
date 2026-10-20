import fs from 'node:fs/promises'
import path from 'node:path'

const directory = path.resolve(process.argv[2] || 'performance-results/b5')
const manifest = JSON.parse(await fs.readFile(path.join(directory, 'manifest.json'), 'utf8'))
if (manifest.status !== 'complete') throw new Error('Only a completed run can produce a verification summary')
const percentile = (values, q) => [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * q) - 1)]
const stats = values => ({ n: values.length, min: Math.min(...values), p50: percentile(values, .5), p95: percentile(values, .95), max: Math.max(...values) })
const rows = []
for (const item of manifest.cases) {
  const runs = []
  for (let i = 1; i <= manifest.config.runs; i++) runs.push(JSON.parse(await fs.readFile(path.join(directory, `${item.name}-run-${i}.json`), 'utf8')))
  const expectedCount = item.summary.propCount
  for (const run of runs) {
    if (run.edits.length !== manifest.config.editsPerKind * 2 || run.selections.length !== manifest.config.selections || run.cold.propCount !== expectedCount) throw new Error('Workload/sample count mismatch')
    if (run.errors.length || run.resourceEvidenceStatus !== 'sampled' || !run.failureRecovery.editable || !run.reopen.exactDocument || run.reopen.snapshots !== 20) throw new Error('Correctness/resource gate failed')
    if (run.reopen.revision !== run.edits.length) throw new Error('Revision sequence mismatch')
    for (const edit of run.edits) if (edit.status !== 'saved' || edit.renders.length !== 1) throw new Error('Missing successful edit render/save')
    if (run.exports.length !== 2) throw new Error('Missing audience export')
  }
  for (const audience of ['gm', 'player']) if (new Set(runs.map(run => run.exports.find(e => e.audience === audience)?.rgbaSha256)).size !== 1) throw new Error(`Non-deterministic 4K RGBA for ${item.name}/${audience}`)
  const edits = runs.flatMap(run => run.edits), selections = runs.flatMap(run => run.selections)
  const renderMetric = name => stats(edits.flatMap(edit => edit.renders.map(render => render[name])))
  rows.push({ name: item.name, runs: runs.length, browser: runs[0].browser,
    coldImportMs: stats(runs.map(run => run.cold.strictImportMs)), coldFullDisplayMs: stats(runs.map(run => run.cold.fullDisplayMs)),
    commitMs: stats(edits.map(edit => edit.commitMs)), propCommitMs: stats(edits.filter(edit => edit.kind === 'prop').map(edit => edit.commitMs)), contourCommitMs: stats(edits.filter(edit => edit.kind === 'contour').map(edit => edit.commitMs)),
    editDisplayProxyMs: stats(edits.map(edit => edit.displayProxyMs)), editCanvasCopyMs: stats(edits.map(edit => edit.canvasCopyMs)),
    selectionHandlerMs: stats(selections.map(s => s.handlerMs)), selectionCanvasCopyMs: stats(selections.map(s => s.eventToCanvasCopyMs)), selectionDisplayProxyMs: stats(selections.map(s => s.eventToPaintMs)),
    validationProjectionMs: renderMetric('validationProjectionMs'), resourceVerificationMs: renderMetric('resourceVerificationMs'), imageDecodeMs: renderMetric('imageDecodeMs'), decoderQueueWaitMs: stats(edits.flatMap(edit => edit.renders.map(r => r.decoderQueueWaitMs ?? 0))), drawSubmissionMs: renderMetric('drawSubmissionMs'), renderTotalMs: renderMetric('totalMs'),
    warmSaveMs: stats(runs.flatMap(run => run.observations.saves.filter(save => save.startMs >= run.edits[0].startMs && save.endMs <= run.edits.at(-1).endMs).map(save => save.durationMs))),
    reopenMs: stats(runs.map(run => run.reopen.durationMs)),
    exports: Object.fromEntries(['gm', 'player'].map(audience => [audience, {
      durationMs: stats(runs.map(run => run.exports.find(e => e.audience === audience).durationMs)),
      rgbaSha256: runs[0].exports.find(e => e.audience === audience).rgbaSha256,
      width: runs[0].exports.find(e => e.audience === audience).width, height: runs[0].exports.find(e => e.audience === audience).height,
    }])),
    productRssSampledPeakBytes: stats(runs.map(run => run.productRssSampledPeakBytes)),
    globalIncludingAuditRssSampledPeakBytes: stats(runs.map(run => run.resources.summary.rssSampledPeakBytes)),
    jsHeapSampledPeakBytes: stats(runs.map(run => run.resources.summary.jsHeapSampledPeakUsedBytes)),
    resourceSampleCounts: { rss: runs.reduce((n, run) => n + run.resources.samples.length, 0), heap: runs.reduce((n, run) => n + run.resources.heapSamples.length, 0) },
    perRun: runs.map(run => ({ run: run.run, startedAt: run.startedAt, finishedAt: run.finishedAt, statistics: run.statistics, productRssSampledPeakBytes: run.productRssSampledPeakBytes, resources: run.resources.summary.byPhase })),
  })
}
const report = { measurementClass: manifest.measurementClass, statisticalMethod: 'Nearest rank percentile: sorted[ceil(n*q)-1]; pooled discrete operations, no mean substituted for p95; raw per-run arrays retained',
  boundaries: 'Dedicated production-module harness; full-workbench correctness is separate; Canvas draw is submission; display is two-rAF scheduling proxy; RSS sampled simultaneous process-tree sum, not unique physical/GPU peak',
  startedAt: manifest.startedAt, finishedAt: manifest.finishedAt, rows }
await fs.writeFile(path.join(directory, 'summary.json'), JSON.stringify(report, null, 2))
console.table(rows.map(row => ({ case: row.name, commitP95: row.commitMs.p95.toFixed(1), drawP95: row.drawSubmissionMs.p95.toFixed(1), editDisplayP95: row.editDisplayProxyMs.p95.toFixed(1), saveP95: row.warmSaveMs.p95.toFixed(1), rssPeakMiB: (row.productRssSampledPeakBytes.max / 1048576).toFixed(1) })))
