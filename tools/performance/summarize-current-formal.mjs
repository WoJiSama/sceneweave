import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const distribution = values => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b)
  return sorted.length ? { count: sorted.length, min: sorted[0], p50: sorted[Math.ceil(sorted.length * .5) - 1],
    p95: sorted[Math.ceil(sorted.length * .95) - 1], max: sorted.at(-1), mean: sorted.reduce((a, b) => a + b, 0) / sorted.length } : { count: 0 }
}
// The exact per-run file retains every process/heap sample. The manifest keeps
// the same observations and summary, without retaining duplicate raw series.
export function compactFormalRunForManifest(run, rawEvidence) {
  if (!run.metrics?.resources) return { ...run, rawEvidence }
  const { samples: _processSamples, heapSamples: _heapSamples, ...resources } = run.metrics.resources
  return { ...run, rawEvidence, metrics: { ...run.metrics, resources } }
}
export function summarizeCurrentFormal(manifest) {
  const cases = manifest.fixtures.map(fixture => {
    const runs = manifest.results.filter(run => run.name === fixture.name), samples = runs.flatMap(run => run.metrics?.samples ?? [])
    const statistics = {}
    for (const kind of new Set(samples.map(sample => sample.kind))) {
      const selected = samples.filter(sample => sample.kind === kind && sample.status === 'complete')
      statistics[kind] = Object.fromEntries(['intentToDomainCommitMs', 'intentToSavedMs', 'intentToRasterReadyMs', 'intentToDisplayProxyMs', 'editIntentToDomainCommitMs', 'editIntentToSavedMs', 'previewIntentToReviewDisplayMs', 'reviewReadyToAdoptionCaptureMs']
        .map(key => [key, distribution(selected.map(sample => sample.sample?.[key]))]))
      statistics[kind].framesMs = distribution(selected.flatMap(sample => Number.isFinite(sample.sample.activeInputEndMs)
        ? sample.sample.frameIntervals.filter(frame => frame.endMs >= sample.sample.activeInputStartMs && frame.startMs <= sample.sample.activeInputEndMs).map(frame => frame.durationMs) : []))
      statistics[kind].cpuContinuityWarnings = selected.filter(sample => !sample.cpu?.completeProcessContinuity).length
    }
    const productPhases = runs.flatMap(run => Object.entries(run.metrics?.resources?.summary?.byPhase ?? {})
      .filter(([name]) => !/^(tooling|setup|idle)/.test(name)).map(([, value]) => value))
    const peak = key => { const values = productPhases.map(value => value[key]).filter(Number.isFinite); return values.length ? Math.max(...values) : null }
    const resourceCoverage = runs.flatMap(run => Object.entries(run.metrics?.resources?.summary?.byPhase ?? {})
      .filter(([name]) => !/^(tooling|setup|idle)/.test(name)).map(([name, value]) => ({ run: run.run, phase: name,
        processSampleCount: value.processSampleCount, heapSampleCount: value.heapSampleCount,
        sampledRssPeakBytes: value.rssPeakBytes, sampledTargetHeapPeakBytes: value.jsHeapPeakUsedBytes })))
    const ordinary = statistics['ordinary-adopt']?.intentToDomainCommitMs ?? { count: 0 }
    const perRunOrdinary = runs.map(run => ({ run: run.run, status: run.status,
      adoptionClickToDomain: distribution((run.metrics?.samples ?? []).filter(sample => sample.kind === 'ordinary-adopt' && sample.status === 'complete').map(sample => sample.sample.intentToDomainCommitMs)),
      enterToDomainIncludingReview: distribution((run.metrics?.samples ?? []).filter(sample => sample.kind === 'ordinary-adopt' && sample.status === 'complete').map(sample => sample.sample.editIntentToDomainCommitMs)) }))
    const immediate = statistics['immediate-prop-edit']?.intentToDomainCommitMs ?? { count: 0 }
    const perRunImmediate = runs.map(run => {
      const edits = (run.metrics?.samples ?? []).filter(sample => sample.kind === 'immediate-prop-edit' && sample.status === 'complete')
      return { run: run.run, status: run.status,
        enterToDomain: distribution(edits.map(sample => sample.sample.intentToDomainCommitMs)),
        enterToSaved: distribution(edits.map(sample => sample.sample.intentToSavedMs)),
        enterToRasterReady: distribution(edits.map(sample => sample.sample.intentToRasterReadyMs)) }
    })
    const immediateEvidenceComplete = manifest.measurementClass === 'formal-current-v1-production-ui-observation'
      && manifest.status === 'complete' && manifest.inputUnchangedAfterMeasurement === true
      && runs.length === 3 && new Set(runs.map(run => run.run)).size === 3 && immediate.count >= 90
      && perRunImmediate.every(run => run.status === 'complete' && run.enterToDomain.count >= 30
        && run.enterToSaved.count >= 30 && run.enterToRasterReady.count >= 30)
      && runs.every(run => run.coverage?.immediateOrdinary?.status === 'complete' && run.coverage.immediateOrdinary.count >= 30
        && run.coverage.immediateOrdinary.exactFirstEditAndFinalContent === true)
    const frameKinds = ['continuous-pan', 'continuous-wheel']
    const frameGate = frameKinds.map(kind => ({ kind, targetMs: 33, measured: statistics[kind]?.framesMs ?? { count: 0 },
      perRun: runs.map(run => ({ run: run.run, framesMs: distribution((run.metrics?.samples ?? []).filter(sample => sample.kind === kind && sample.status === 'complete')
        .flatMap(sample => sample.sample.frameIntervals.filter(frame => frame.endMs >= sample.sample.activeInputStartMs && frame.startMs <= sample.sample.activeInputEndMs).map(frame => frame.durationMs))) })) }))
    const groupRejected = runs.some(run => run.coverage?.groupTransform?.status !== 'complete')
    return { name: fixture.name, fixture: fixture.summary, runs: runs.length, statistics, perRunOrdinary, perRunImmediate,
      storage: runs.map(run => ({ run: run.run, ...run.storage })),
      resources: { productSampledRssPeakBytes: peak('rssPeakBytes'), productTargetHeapPeakBytes: peak('jsHeapPeakUsedBytes'),
        sampleErrors: runs.reduce((n, run) => n + (run.metrics?.resources?.errors?.length ?? 0), 0), phaseCoverage: resourceCoverage,
        missingPhasePeakEvidence: resourceCoverage.filter(value => !value.processSampleCount || !value.heapSampleCount),
        note: 'Sampled peaks may miss transients. Missing phase samples remain missing evidence; bracket heap values are not substituted for peaks.' },
      immediate500Target: { required: (fixture.summary.fullPropCount ?? Number(fixture.name.match(/-(\d+)(?:-|$)/)?.[1])) === 500, targetMs: 100,
        scope: 'Trusted Enter to actual complete validated domain commit for the fixed independent full Prop world-X field edit; no preview/adoption or automation review interval is excluded. Free drag and other QA-PERF-01 operations remain separate.',
        measuredP95Ms: immediate.p95 ?? null, count: immediate.count, evidenceComplete: immediateEvidenceComplete,
        pass: immediateEvidenceComplete && immediate.p95 <= 100 && perRunImmediate.every(run => run.enterToDomain.p95 <= 100) },
      groupedAdoption500Subtarget: { required: (fixture.summary.fullPropCount ?? Number(fixture.name.match(/-(\d+)(?:-|$)/)?.[1])) === 500, targetMs: 100,
        scope: 'Trusted adoption click to actual validated domain commit in the grouped two-stage preview/adopt flow. Preview preparation and Enter-to-domain total are reported separately; this subinterval does not establish immediate-command latency.',
        measuredP95Ms: ordinary.p95 ?? null, count: ordinary.count,
        adoptionSubtargetPass: manifest.measurementClass === 'formal-current-v1-production-ui-observation' && runs.length === 3
          && ordinary.count >= 90 && ordinary.p95 <= 100
          && perRunOrdinary.every(run => run.status === 'complete' && run.adoptionClickToDomain.count >= 30 && run.adoptionClickToDomain.p95 <= 100) },
      viewportFrameSubtargets: frameGate,
      viewportFrameSubtargetsPass: manifest.measurementClass === 'formal-current-v1-production-ui-observation' && runs.length === 3
        && frameKinds.every(kind => statistics[kind]?.intentToDisplayProxyMs.count >= 9)
        ? frameGate.every(item => item.measured.count > 0 && item.measured.p95 <= 33 && item.perRun.every(run => run.framesMs.count > 0 && run.framesMs.p95 <= 33)) : null,
      groupTransformComplete: !groupRejected, failures: runs.filter(run => run.status !== 'complete').map(run => ({ run: run.run, error: run.error })),
      exports: runs.map(run => ({ run: run.run, outputs: run.exports ?? [] })), coverage: runs.map(run => ({ run: run.run, ...run.coverage })) }
  })
  const required = ['building-500', 'building-2000', 'natural-500', 'natural-2000', 'mixed-500', 'mixed-2000']
  const completeCoreMatrix = manifest.measurementClass === 'formal-current-v1-production-ui-observation' && manifest.status === 'complete'
    && manifest.inputUnchangedAfterMeasurement === true && required.every(name => cases.some(item => item.name === name && item.runs === 3 && !item.failures.length
      && item.statistics['ordinary-adopt']?.intentToDomainCommitMs.count >= 90 && item.statistics['object-list-selection']?.intentToDisplayProxyMs.count >= 180
      && item.statistics['immediate-prop-edit']?.intentToDomainCommitMs.count >= 90 && item.immediate500Target.evidenceComplete
      && item.statistics['canvas-prop-selection']?.intentToDisplayProxyMs.count >= 18
      && item.statistics['continuous-pan']?.intentToDisplayProxyMs.count >= 9 && item.statistics['continuous-wheel']?.intentToDisplayProxyMs.count >= 9
      && item.statistics['cold-open']?.intentToDisplayProxyMs.count >= 3 && item.exports.every(run => run.outputs.length === 2)))
  return { format: 'sceneweave-current-formal-summary', version: 1, status: manifest.status, measurementClass: manifest.measurementClass,
    inputFingerprint: manifest.inputFingerprint, device: manifest.device, cases, completeCoreMatrix,
    completeFormalMatrix: completeCoreMatrix && cases.every(item => item.groupTransformComplete),
    full09Acceptance: false, omittedCoverage: manifest.omittedCoverage,
    interpretation: ['All percentiles use pooled nearest-rank with per-run distributions retained; failed samples are retained separately, never discarded or retried.',
      'Independent immediate edits compare the entire trusted Enter-to-validated-domain interval with the 500-Prop 100ms target, requiring at least 30 samples in each of three runs and 90 pooled. Saved/raster-ready distributions remain separate. Grouped adoption-click-to-domain, Enter-to-preview and Enter-to-domain including automation/review delay retain separate subtargets.',
      'Frame intervals only overlap the actual trusted continuous input window (pointerdown through pointerup, or first through last wheel event). Setup, trailing save/display waits and idle frames do not dilute p95. This is browser scheduling, not physical display/GPU completion.',
      'New committed immutable block payloads and distinct final changed row bytes are logical storage observations, not physical disk I/O.',
      'Matrix completion and the independent X-edit 100ms target do not close the remaining QA-PERF-01/04 operations, capacity, privacy pixels, P3 or unsupported group transforms.'] }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const directory = process.argv[2]
  if (!directory || !path.isAbsolute(directory)) throw new Error('Usage: node tools/performance/summarize-current-formal.mjs ABS_OUTPUT_DIRECTORY')
  const manifest = JSON.parse(await fs.readFile(path.join(directory, 'manifest.json'), 'utf8'))
  if (manifest.format !== 'sceneweave-current-formal-performance') throw new Error('Unknown current formal manifest')
  console.log(JSON.stringify(summarizeCurrentFormal(manifest), null, 2))
}
