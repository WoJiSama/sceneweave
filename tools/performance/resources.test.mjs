import assert from 'node:assert/strict'
import test from 'node:test'
import { observationPhaseAttribution, startResourceSampling } from './resources.mjs'

test('Windows poll phase attribution retains an intervening phase even when names at both ends match', () => {
  const markers = [{ phase: 'idle', elapsedMs: 0 }, { phase: 'edit', elapsedMs: 10 }, { phase: 'idle', elapsedMs: 20 }]
  assert.deepEqual(observationPhaseAttribution(5, 25, markers), { phase: 'idle', phaseAtEnd: 'idle', phaseBoundary: true })
  assert.deepEqual(observationPhaseAttribution(21, 25, markers), { phase: 'idle', phaseAtEnd: 'idle', phaseBoundary: false })
})

test('heap-only diagnostics keep RSS unavailable and retain phase-crossing and failed heap observations', async () => {
  let release
  const first = new Promise(resolve => { release = resolve })
  let calls = 0
  const sampler = startResourceSampling({ rootPid: 1, sampleProcess: false, heapIntervalMs: 10,
    cdp: { async send() { calls++; if (calls === 1) await first; else throw new Error('not retained');
      return { metrics: [{ name: 'JSHeapUsedSize', value: 120 }, { name: 'JSHeapTotalSize', value: 240 }] } } } })
  sampler.setPhase('edit')
  release()
  await new Promise(resolve => setTimeout(resolve, 40))
  const result = await sampler.stop()
  assert.deepEqual(result.samples, [])
  assert.equal(result.summary.rssSampledPeakBytes, null)
  assert.equal(result.summary.byPhase.edit.rssPeakBytes, null)
  assert.equal(result.summary.config.processSamplingStatus, 'unavailable')
  assert.equal(result.summary.config.psCommand, null)
  assert.equal(result.summary.jsHeapSampledPeakUsedBytes, 120)
  assert.equal(result.heapSamples[0].phaseBoundary, true)
  assert.equal(result.summary.byPhase.edit.heapSampleCount, 0)
  assert.ok(result.errors.some(row => row.code === 'CDP_METRICS_FAILED'))
  assert.equal(await sampler.stop(), result)
  assert.throws(() => sampler.setPhase('late'), /stopped/)
})

test('missing heap counters remain missing phase peak evidence despite successful CDP responses', async () => {
  const sampler = startResourceSampling({ rootPid: 1, sampleProcess: false, heapIntervalMs: 10,
    cdp: { async send() { return { metrics: [] } } } })
  sampler.setPhase('edit')
  await new Promise(resolve => setTimeout(resolve, 40))
  const result = await sampler.stop()
  assert.ok(result.summary.byPhase.edit.heapSampleCount > 0)
  assert.equal(result.summary.byPhase.edit.heapValueSampleCount, 0)
  assert.equal(result.summary.byPhase.edit.jsHeapPeakUsedBytes, null)
  assert.equal(result.summary.backgroundObservation.browserProcessMax, null)
  assert.equal(result.summary.backgroundObservation.nodeProcessMax, null)
  assert.ok(result.errors.some(row => row.code === 'CDP_HEAP_METRICS_UNAVAILABLE'))
})
