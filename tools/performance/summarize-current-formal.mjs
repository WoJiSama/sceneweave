import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const distribution = values => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b)
  return sorted.length ? { count: sorted.length, min: sorted[0], p50: sorted[Math.ceil(sorted.length * .5) - 1],
    p95: sorted[Math.ceil(sorted.length * .95) - 1], max: sorted.at(-1), mean: sorted.reduce((a, b) => a + b, 0) / sorted.length } : { count: 0 }
}
export function summarizeCurrentFormal(manifest) {
  const cases = manifest.fixtures.map(fixture => {
    const runs = manifest.results.filter(run => run.name === fixture.name), samples = runs.flatMap(run => run.metrics?.samples ?? [])
    const statistics = {}
    for (const kind of new Set(samples.map(sample => sample.kind))) {
      const selected = samples.filter(sample => sample.kind === kind && sample.status === 'complete')
      statistics[kind] = Object.fromEntries(['intentToDomainCommitMs', 'intentToSavedMs', 'intentToRasterReadyMs', 'intentToDisplayProxyMs', 'editIntentToDomainCommitMs', 'editIntentToSavedMs']
        .map(key => [key, distribution(selected.map(sample => sample.sample?.[key]))]))
      statistics[kind].framesMs = distribution(selected.flatMap(sample => {
        const inputEnd = sample.sample.endInput?.captureMs ?? sample.sample.externalEndMs ?? sample.sample.displayProxyMs
        return sample.sample.frameIntervals.filter(frame => frame.endMs >= sample.sample.intent.captureMs && frame.startMs <= inputEnd).map(frame => frame.durationMs)
      }))
      statistics[kind].cpuContinuityWarnings = selected.filter(sample => !sample.cpu?.completeProcessContinuity).length
    }
    const productPhases = runs.flatMap(run => Object.entries(run.metrics?.resources?.summary?.byPhase ?? {})
      .filter(([name]) => !/^(tooling|setup|idle)/.test(name)).map(([, value]) => value))
    const peak = key => Math.max(0, ...productPhases.map(value => value[key] ?? 0))
    const ordinary = statistics['ordinary-adopt']?.editIntentToDomainCommitMs ?? { count: 0 }
    const perRunOrdinary = runs.map(run => ({ run: run.run, status: run.status,
      domain: distribution((run.metrics?.samples ?? []).filter(sample => sample.kind === 'ordinary-adopt' && sample.status === 'complete').map(sample => sample.sample.editIntentToDomainCommitMs)) }))
    const groupRejected = runs.some(run => run.coverage?.groupTransform?.status !== 'complete')
    return { name: fixture.name, fixture: fixture.summary, runs: runs.length, statistics, perRunOrdinary,
      storage: runs.map(run => ({ run: run.run, ...run.storage })),
      resources: { productSampledRssPeakBytes: peak('rssPeakBytes'), productTargetHeapPeakBytes: peak('jsHeapPeakUsedBytes'),
        sampleErrors: runs.reduce((n, run) => n + (run.metrics?.resources?.errors?.length ?? 0), 0) },
      ordinary500Target: { required: Number(fixture.name.match(/-(\d+)$/)?.[1]) === 500, targetMs: 100,
        measuredP95Ms: ordinary.p95 ?? null, count: ordinary.count,
        pass: ordinary.count >= 90 && ordinary.p95 <= 100 && perRunOrdinary.every(run => run.domain.count >= 30 && run.domain.p95 <= 100) },
      groupTransformComplete: !groupRejected, failures: runs.filter(run => run.status !== 'complete').map(run => ({ run: run.run, error: run.error })),
      exports: runs.map(run => ({ run: run.run, outputs: run.exports ?? [] })), coverage: runs.map(run => ({ run: run.run, ...run.coverage })) }
  })
  const completeCoreMatrix = manifest.measurementClass === 'formal-current-v1-production-ui-observation' && manifest.status === 'complete'
    && manifest.inputUnchangedAfterMeasurement === true && cases.length === 6 && cases.every(item => item.runs === 3 && !item.failures.length
      && item.statistics['ordinary-adopt']?.intentToDomainCommitMs.count >= 90 && item.statistics['object-list-selection']?.intentToDisplayProxyMs.count >= 180)
  return { format: 'sceneweave-current-formal-summary', version: 1, status: manifest.status, measurementClass: manifest.measurementClass,
    inputFingerprint: manifest.inputFingerprint, device: manifest.device, cases, completeCoreMatrix,
    completeFormalMatrix: completeCoreMatrix && cases.every(item => item.groupTransformComplete),
    full09Acceptance: false, omittedCoverage: manifest.omittedCoverage,
    interpretation: ['All percentiles use pooled nearest-rank with per-run distributions retained; failed samples are retained separately, never discarded or retried.',
      'The ordinary100ms gate uses Enter-to-domain completion across the actual preview and automated adoption flow. Adoption-click-to-domain is also retained as a separate subinterval. The complete interval includes automation/review delay and never subtracts the preview.',
      'Frame intervals are browser scheduling observations during trusted input, not physical display/GPU completion.',
      'New committed immutable block payloads and distinct final changed row bytes are logical storage observations, not physical disk I/O.',
      'Matrix completion and ordinary100ms subtarget do not close full QA-PERF-01/04, capacity, privacy pixels, P3 or unsupported group transforms.'] }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const directory = process.argv[2]
  if (!directory || !path.isAbsolute(directory)) throw new Error('Usage: node tools/performance/summarize-current-formal.mjs ABS_OUTPUT_DIRECTORY')
  const manifest = JSON.parse(await fs.readFile(path.join(directory, 'manifest.json'), 'utf8'))
  if (manifest.format !== 'sceneweave-current-formal-performance') throw new Error('Unknown current formal manifest')
  console.log(JSON.stringify(summarizeCurrentFormal(manifest), null, 2))
}
