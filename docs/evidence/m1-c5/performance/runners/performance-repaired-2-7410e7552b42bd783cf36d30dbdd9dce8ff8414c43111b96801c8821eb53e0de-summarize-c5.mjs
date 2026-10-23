import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export function distribution(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b), rank = quantile => sorted[Math.max(0, Math.ceil(sorted.length * quantile) - 1)] ?? null
  return { n: sorted.length, min: sorted[0] ?? null, p50: rank(.5), p95: rank(.95), max: sorted.at(-1) ?? null }
}
const latencyFields = ['intentToHandlerBubbleMs', 'intentToDomainCommitMs', 'intentToDomRevisionMs', 'intentToRasterReadyMs', 'intentToSavedMs', 'intentToDomReadyMs', 'intentToDisplayProxyMs', 'domainCommitToDomRevisionMs']
function sampleStatistics(samples) {
  return Object.fromEntries([...new Set(samples.map(sample => sample.kind))].map(kind => {
    const selected = samples.filter(sample => sample.kind === kind), continuous = kind.startsWith('continuous-')
    const frames = selected.flatMap(sample => sample.activeInputFrameGapMs ?? [])
    const inputGaps = selected.flatMap(sample => {
      const events = sample.events.filter(event => event.type === (kind === 'continuous-pan' ? 'pointermove' : kind === 'continuous-wheel' ? 'wheel' : '__none'))
      return events.slice(1).map((event, index) => event.captureMs - events[index].captureMs)
    })
    return [kind, { samples: selected.length,
      ...Object.fromEntries(latencyFields.map(field => [field, distribution(selected.map(sample => sample[field]))])),
      queuedUntilCaptureMs: distribution(selected.map(sample => sample.intent?.queuedUntilCaptureMs)),
      observedFrameGapMs: distribution(selected.flatMap(sample => sample.frameGapMs ?? [])),
      longTaskCount: selected.reduce((count, sample) => count + (sample.longTasks?.length ?? 0), 0),
      longTaskDurationMs: distribution(selected.flatMap(sample => (sample.longTasks ?? []).map(entry => entry.duration))),
      rasterReuseObservations: selected.filter(sample => sample.expectedRevision !== undefined && sample.after.renderCount === sample.before.renderCount).length,
      ...(continuous ? { activeInputFrameGapMs: distribution(frames), activeInputFrameGapsAbove33_334Ms: frames.filter(value => value > 1000 / 30).length,
        activeInputFrameGapCount: frames.length, activeInputFrameGapsAbove33_334Fraction: frames.length ? frames.filter(value => value > 1000 / 30).length / frames.length : null,
        inputCaptureGapMs: distribution(inputGaps), actualInputEventCounts: selected.map(sample => sample.eventCounts),
        note: 'rAF and input intervals are browser/automation scheduling proxies. Exceeding 33.334ms is reported without claiming physical display FPS or a complete UX pass.' } : {}),
    }]
  }))
}
function resourceStatistics(runs) {
  const phases = [...new Set(runs.flatMap(run => Object.keys(run.resources?.summary.byPhase ?? {})))], maximum = values => values.filter(Number.isFinite).length ? Math.max(...values.filter(Number.isFinite)) : null
  const byPhase = Object.fromEntries(phases.map(phase => [phase, {
    runsWithRssSamples: runs.filter(run => run.resources?.summary.byPhase[phase]?.processSampleCount > 0).length,
    processSampleCount: runs.reduce((n, run) => n + (run.resources?.summary.byPhase[phase]?.processSampleCount ?? 0), 0),
    heapSampleCount: runs.reduce((n, run) => n + (run.resources?.summary.byPhase[phase]?.heapSampleCount ?? 0), 0),
    rssSampledPeakBytes: maximum(runs.map(run => run.resources?.summary.byPhase[phase]?.rssPeakBytes)),
    jsHeapSampledPeakUsedBytes: maximum(runs.map(run => run.resources?.summary.byPhase[phase]?.jsHeapPeakUsedBytes)),
  }]))
  const productPhases = phases.filter(phase => !phase.startsWith('tooling-audit')), toolingPhases = phases.filter(phase => phase.startsWith('tooling-audit'))
  return {
    productPhaseRssSampledPeakBytes: maximum(productPhases.map(phase => byPhase[phase].rssSampledPeakBytes)),
    productPhaseJsHeapSampledPeakUsedBytes: maximum(productPhases.map(phase => byPhase[phase].jsHeapSampledPeakUsedBytes)),
    toolingAuditRssSampledPeakBytes: maximum(toolingPhases.map(phase => byPhase[phase].rssSampledPeakBytes)),
    toolingAuditJsHeapSampledPeakUsedBytes: maximum(toolingPhases.map(phase => byPhase[phase].jsHeapSampledPeakUsedBytes)),
    globalRssSampledPeakBytesIncludingBoundariesAndTooling: maximum(runs.map(run => run.resources?.summary.rssSampledPeakBytes)),
    globalJsHeapSampledPeakUsedBytesIncludingBoundariesAndTooling: maximum(runs.map(run => run.resources?.summary.jsHeapSampledPeakUsedBytes)),
    samplingErrors: runs.reduce((n, run) => n + (run.resources?.summary.errorCount ?? 0), 0),
    excludedPhaseBoundaryProcessSamples: runs.reduce((n, run) => n + (run.resources?.summary.phaseBoundaryProcessSamples ?? 0), 0),
    excludedPhaseBoundaryHeapSamples: runs.reduce((n, run) => n + (run.resources?.summary.phaseBoundaryHeapSamples ?? 0), 0),
    byPhase,
    note: 'Product/tooling phase peaks use only observations wholly inside one phase; mixed and other boundary samples remain in raw files and global peaks. Peaks from different processes/phases/runs must not be added.',
  }
}
export function summarizeC5(manifest, runs) {
  const ordinaryTargetMs = 100
  return {
    format: 'sceneweave-c5-performance-summary', version: 1, generatedAt: new Date().toISOString(), status: manifest.status, measurementClass: manifest.measurementClass,
    sourceRevision: manifest.sourceRevision, method: manifest.config,
    interpretation: ['Nearest-rank p95; every measured sample and slow observation is retained. Per-run p95 and pooled p95 are distinct.', 'The 100ms ordinary-edit target is evaluated only against exact intent-to-domain-commit, never the save or double-rAF interval.', 'This summary reports observed target compliance. It does not confer full interaction, cross-browser, visual, resource or small-group acceptance.', 'Long tasks may span samples or phases; per-kind counts are observation-window counts and must not be added as unique-task totals.'],
    cases: manifest.cases.map(item => {
      const selected = runs.filter(run => run.case === item.name), samples = selected.flatMap(run => run.samples), statistics = sampleStatistics(samples)
      const ordinary = statistics['ordinary-edit']?.intentToDomainCommitMs ?? distribution([])
      return { name: item.name, fixture: item.summary, completedRuns: selected.length,
        statistics, resources: resourceStatistics(selected),
        ordinaryEditTarget: { metric: 'intentToDomainCommitMs', targetP95Ms: ordinaryTargetMs, sampleCount: ordinary.n, pooledP95Ms: ordinary.p95,
          pooledObservedWithinTarget: ordinary.p95 === null ? null : ordinary.p95 <= ordinaryTargetMs,
          everyRunObservedWithinTarget: selected.length ? selected.every(run => {
            const values = distribution(run.samples.filter(sample => sample.kind === 'ordinary-edit').map(sample => sample.intentToDomainCommitMs))
            return values.p95 !== null && values.p95 <= ordinaryTargetMs
          }) : null, formalMatrix: manifest.measurementClass === 'formal-c5-production-ui-observation' },
        runs: selected.map(run => ({ run: run.run, sampleCount: run.samples.length, statistics: sampleStatistics(run.samples), correctness: run.correctness, diagnosticProfiles: run.diagnosticProfiles,
          exports: run.exports, resources: { rawPath: run.resources?.path, summary: run.resources?.summary } })),
      }
    }),
  }
}
const invokedAsScript = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedAsScript) {
  const args = process.argv.slice(2), directory = args[0], outputIndex = args.indexOf('--output')
  if (args.includes('--help') || !directory) { console.log('node tools/performance/summarize-c5.mjs ABS_EVIDENCE_DIRECTORY [--output ABS_NEW_JSON]'); process.exit(args.includes('--help') ? 0 : 1) }
  if (!path.isAbsolute(directory)) throw new Error('Evidence directory must be absolute')
  const manifest = JSON.parse(await fs.readFile(path.join(directory, 'manifest.json'), 'utf8'))
  if (manifest.format !== 'sceneweave-c5-performance' || manifest.status !== 'complete') throw new Error('Expected a completed C5 evidence manifest')
  const runs = await Promise.all(manifest.results.map(async entry => {
    const resolved = path.resolve(directory, entry.path)
    if (!resolved.startsWith(`${path.resolve(directory)}${path.sep}`)) throw new Error('Result path escapes evidence directory')
    return JSON.parse(await fs.readFile(resolved, 'utf8'))
  }))
  const summary = summarizeC5(manifest, runs)
  if (outputIndex >= 0) {
    const target = args[outputIndex + 1]
    if (!target || !path.isAbsolute(target)) throw new Error('--output requires an absolute new file')
    await fs.writeFile(target, JSON.stringify(summary, null, 2), { flag: 'wx' })
  } else console.log(JSON.stringify(summary, null, 2))
}
