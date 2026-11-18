import assert from 'node:assert/strict'
import test from 'node:test'
import { summarizeCurrentFormal } from './summarize-current-formal.mjs'

const operation = (kind, latency = 5) => ({ kind, status: 'complete', cpu: { completeProcessContinuity: true }, sample: {
  intentToDomainCommitMs: latency, editIntentToDomainCommitMs: latency, intentToSavedMs: 7, intentToRasterReadyMs: 9, intentToDisplayProxyMs: 10,
  activeInputStartMs: 1, activeInputEndMs: 20, frameIntervals: [{ startMs: 0, endMs: 16, durationMs: 16 }],
} })
const fixture = () => ({ measurementClass: 'formal-current-v1-production-ui-observation', status: 'complete', inputUnchangedAfterMeasurement: true,
  fixtures: [{ name: 'building-500', summary: { fullPropCount: 500 } }], results: [1, 2, 3].map(run => ({ name: 'building-500', run, status: 'complete',
    coverage: { immediateOrdinary: { status: 'complete', count: 30, exactFirstEditAndFinalContent: true }, groupTransform: { status: 'complete' },
      propDrag: { status: 'complete', count: 3 } },
    metrics: { samples: [...Array.from({ length: 30 }, () => operation('ordinary-adopt')), ...Array.from({ length: 30 }, () => operation('immediate-prop-edit')),
      ...['continuous-pan', 'continuous-wheel', 'continuous-prop-drag'].flatMap(kind => Array.from({ length: 3 }, () => operation(kind)))],
      resources: { errors: [], summary: { processMetric: 'windows-working-set', byPhase: { 'immediate-prop-edit': {
        processSampleCount: 1, heapSampleCount: 1, heapValueSampleCount: 1, rssPeakBytes: 100, privateCommitPeakBytes: 200, jsHeapPeakUsedBytes: 50,
      } } } } } })) })
const one = manifest => summarizeCurrentFormal(manifest).cases[0]

test('formal summary preserves separate memory metrics and complete per-operation evidence', () => {
  const manifest = fixture()
  manifest.results[0].metrics.samples[0].sample.intentToDomainCommitMs = 250
  const result = one(manifest)
  assert.equal(result.immediate500Target.pass, true)
  assert.equal(result.groupedAdoption500Subtarget.adoptionSubtargetPass, true)
  assert.equal(result.statistics['ordinary-adopt'].intentToDomainCommitMs.max, 250)
  assert.equal(result.statistics['ordinary-adopt'].attemptedSampleCount, 90)
  assert.equal(result.viewportFrameSubtargetsPass, true)
  assert.equal(result.dragFrameSubtarget.pass, true)
  assert.equal(result.resources.productSampledRssPeakBytes, 100)
  assert.equal(result.resources.productSampledPrivateCommitPeakBytes, 200)
  assert.equal(result.resources.gpuMemoryCoverage, 'unmeasured')
})

test('failed, changed, duplicate, clock-discontinuous or failed-sample runs cannot produce a formal subtarget pass', () => {
  for (const mutate of [manifest => { manifest.status = 'failed' }, manifest => { manifest.measurementClass = 'diagnostic-current-v1-production-ui-observation' },
    manifest => { manifest.inputUnchangedAfterMeasurement = false },
    manifest => { manifest.results[2].run = 2 }, manifest => { manifest.results[0].metrics.clockGaps = [{ elapsedMs: 6000 }] },
    manifest => { manifest.results[0].metrics.samples.push({ kind: 'ordinary-adopt', status: 'failed', error: 'retained failure' }) }]) {
    const manifest = fixture(); mutate(manifest)
    const result = one(manifest)
    assert.equal(result.immediate500Target.pass, false)
    assert.equal(result.groupedAdoption500Subtarget.adoptionSubtargetPass, false)
    assert.equal(result.viewportFrameSubtargetsPass, null)
    assert.equal(result.dragFrameSubtarget.pass, null)
  }
  const manifest = fixture()
  manifest.results[0].metrics.samples.push({ kind: 'ordinary-adopt', status: 'failed', error: 'retained failure' })
  assert.deepEqual(one(manifest).statistics['ordinary-adopt'].failedSamples, [{ status: 'failed', error: 'retained failure' }])
})

test('each continuous input sample needs active-window frames and drag cannot be substituted by viewport evidence', () => {
  const manifest = fixture()
  manifest.results[0].metrics.samples.find(sample => sample.kind === 'continuous-prop-drag').sample.frameIntervals = []
  const result = one(manifest)
  assert.equal(result.viewportFrameSubtargetsPass, true)
  assert.equal(result.dragFrameSubtarget.pass, null)
  const noDrag = fixture()
  for (const run of noDrag.results) {
    run.metrics.samples = run.metrics.samples.filter(sample => sample.kind !== 'continuous-prop-drag')
    delete run.coverage.propDrag
  }
  assert.equal(one(noDrag).viewportFrameSubtargetsPass, true)
  assert.equal(one(noDrag).dragFrameSubtarget.pass, null)
})

const matrixFixture = () => {
  const manifest = fixture()
  const names = ['building-500', 'building-2000', 'natural-500', 'natural-2000', 'mixed-500', 'mixed-2000']
  const template = manifest.results
  manifest.fixtures = names.map(name => ({ name, summary: { fullPropCount: name.endsWith('500') ? 500 : 2000 } }))
  manifest.results = names.flatMap(name => template.map(original => {
    const run = structuredClone(original); run.name = name; run.exports = [{}, {}]
    run.metrics.samples.push(...Array.from({ length: 30 }, () => operation('ordinary-preview')),
      ...Array.from({ length: 60 }, () => operation('object-list-selection')),
      ...Array.from({ length: 6 }, () => operation('canvas-prop-selection')),
      ...['cold-open', 'export-png-gm', 'export-png-player', 'group-preview', 'group-adopt',
        'group-undo', 'group-redo', 'group-reset-undo'].map(kind => operation(kind)),
      ...['prop-drag-adopt', 'prop-drag-undo'].flatMap(kind => Array.from({ length: 3 }, () => operation(kind))))
    return run
  }))
  return manifest
}

test('a complete legacy core matrix still requires separately verified drag coverage for formal matrix completion', () => {
  const manifest = matrixFixture()
  assert.equal(summarizeCurrentFormal(manifest).completeCoreMatrix, true)
  assert.equal(summarizeCurrentFormal(manifest).completeFormalMatrix, true)
  for (const kind of ['continuous-pan', 'continuous-wheel']) {
    const missingFrames = structuredClone(manifest)
    missingFrames.results[0].metrics.samples.find(sample => sample.kind === kind).sample.frameIntervals = []
    const summary = summarizeCurrentFormal(missingFrames)
    assert.equal(summary.cases[0].viewportFrameEvidenceComplete, false)
    assert.equal(summary.completeCoreMatrix, false, `${kind} missing active frames must invalidate the core matrix`)
    assert.equal(summary.completeFormalMatrix, false, `${kind} missing active frames must invalidate the formal matrix`)
  }
  delete manifest.results[0].coverage.propDrag
  assert.equal(summarizeCurrentFormal(manifest).completeCoreMatrix, true)
  assert.equal(summarizeCurrentFormal(manifest).completeFormalMatrix, false)
})


test('pooled totals cannot replace the exact repetitions in each declared run', () => {
  for (const kind of ['ordinary-preview', 'ordinary-adopt', 'immediate-prop-edit', 'object-list-selection',
    'canvas-prop-selection', 'continuous-pan', 'continuous-wheel', 'cold-open', 'export-png-gm', 'export-png-player']) {
    const manifest = matrixFixture(), first = manifest.results[0], second = manifest.results[1]
    const index = first.metrics.samples.findIndex(sample => sample.kind === kind)
    // Preserve every pooled count and complete coverage flag: one run is short,
    // another has an extra observation. Neither is the declared full replicate.
    second.metrics.samples.push(first.metrics.samples.splice(index, 1)[0])
    const summary = summarizeCurrentFormal(manifest)
    assert.equal(summary.cases[0].coreSampleEvidenceComplete, false, kind)
    assert.equal(summary.completeCoreMatrix, false, kind)
    assert.equal(summary.completeFormalMatrix, false, kind)
  }
  const manifest = matrixFixture()
  for (const run of manifest.results) run.run += 3
  assert.equal(summarizeCurrentFormal(manifest).completeCoreMatrix, false, 'runs must be the declared 1, 2, 3')
})

test('group and drag coverage flags cannot replace missing or duplicate lifecycle observations', () => {
  for (const kind of ['group-preview', 'group-adopt', 'group-undo', 'group-redo', 'group-reset-undo',
    'continuous-prop-drag', 'prop-drag-adopt', 'prop-drag-undo']) {
    for (const mode of ['missing', 'extra']) {
      const manifest = matrixFixture(), samples = manifest.results[0].metrics.samples
      const index = samples.findIndex(sample => sample.kind === kind)
      if (mode === 'missing') samples.splice(index, 1)
      else samples.push(structuredClone(samples[index]))
      const summary = summarizeCurrentFormal(manifest)
      assert.equal(summary.completeCoreMatrix, true, `${kind}: the legacy core remains separate`)
      assert.equal(summary.cases[0].formalSampleEvidenceComplete, false, `${kind} ${mode}`)
      assert.equal(summary.completeFormalMatrix, false, `${kind} ${mode}`)
    }
  }
})

test('a complete status without the actual timing field remains missing evidence', () => {
  for (const [kind, field, coreExpected] of [
    ['ordinary-preview', 'intentToDisplayProxyMs', false],
    ['ordinary-adopt', 'editIntentToDomainCommitMs', false],
    ['group-adopt', 'intentToDomainCommitMs', true],
    ['group-reset-undo', 'intentToDomainCommitMs', true],
    ['prop-drag-adopt', 'intentToDomainCommitMs', true],
    ['prop-drag-undo', 'intentToDomainCommitMs', true],
  ]) {
    const manifest = matrixFixture()
    manifest.results[0].metrics.samples.find(sample => sample.kind === kind).sample[field] = null
    const summary = summarizeCurrentFormal(manifest)
    assert.equal(summary.completeCoreMatrix, coreExpected, `${kind} ${field}`)
    assert.equal(summary.completeFormalMatrix, false, `${kind} ${field}`)
  }
})

test('matrix completion remains coverage, independent of the unchanged latency and frame targets', () => {
  const manifest = matrixFixture()
  for (const sample of manifest.results[0].metrics.samples) {
    if (sample.kind === 'immediate-prop-edit') sample.sample.intentToDomainCommitMs = 150
    if (sample.kind === 'ordinary-adopt') sample.sample.intentToDomainCommitMs = 150
    if (['continuous-pan', 'continuous-wheel', 'continuous-prop-drag'].includes(sample.kind)) {
      sample.sample.frameIntervals = [{ startMs: 0, endMs: 50, durationMs: 50 }]
    }
  }
  const summary = summarizeCurrentFormal(manifest), first = summary.cases[0]
  assert.equal(first.immediate500Target.pass, false)
  assert.equal(first.groupedAdoption500Subtarget.adoptionSubtargetPass, false)
  assert.equal(first.viewportFrameSubtargetsPass, false)
  assert.equal(first.dragFrameSubtarget.pass, false)
  assert.equal(summary.completeCoreMatrix, true)
  assert.equal(summary.completeFormalMatrix, true)
  assert.equal(summary.full09Acceptance, false)
})

test('missing heap values and missing whole resource summaries remain visible', () => {
  const manifest = fixture()
  manifest.results[0].metrics.resources.summary.byPhase['immediate-prop-edit'].jsHeapPeakUsedBytes = null
  manifest.results[0].metrics.resources.summary.byPhase['immediate-prop-edit'].heapValueSampleCount = 0
  delete manifest.results[1].metrics.resources
  const resources = one(manifest).resources
  assert.equal(resources.missingPhasePeakEvidence.length, 1)
  assert.equal(resources.missingPhasePeakEvidence[0].heapSampleCount, 1)
  assert.equal(resources.missingPhasePeakEvidence[0].sampledTargetHeapPeakBytes, null)
  assert.deepEqual(resources.missingResourceRuns, [2])
})
