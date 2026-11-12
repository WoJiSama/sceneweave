import assert from 'node:assert/strict'
import test from 'node:test'
import { startResourceSampling } from './resources.mjs'

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
