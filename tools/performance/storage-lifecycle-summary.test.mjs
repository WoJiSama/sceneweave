import assert from 'node:assert/strict'
import test from 'node:test'
import { median, mib, summarizeIdle, summarizeCold, summarizeMemory } from './summarize-storage-lifecycle.mjs'

test('missing observations stay null and are excluded from medians', () => {
  assert.equal(median([null, undefined, NaN]), null)
  assert.equal(mib(null), null); assert.equal(mib(undefined), null)
  assert.equal(median([1, null, 3, NaN]), 2); assert.equal(mib(1048576), 1)
})
test('idle windows exclude the next switch preparation and phase-crossing samples', () => {
  const sample = (start, end, value) => ({ phase: 'idle', phaseAtEnd: 'idle', phaseBoundary: false, startedElapsedMs: start, endedElapsedMs: end, rssBytes: value * 1048576 })
  const resources = { summary: { phaseMarkers: [{ phase: 'idle', elapsedMs: 100 }] }, samples: [sample(110, 150, 1), sample(180, 210, 99), { ...sample(120, 130, 77), phaseBoundary: true }], heapSamples: [] }
  const result = summarizeIdle(resources, 'idle', 100)
  assert.equal(result.workingSetMedianMiB, 1); assert.equal(result.processSamples, 1)
  assert.equal(result.heapMedianMiB, null); assert.equal(result.systemCpuBusyPercent, null)
  assert.throws(() => summarizeIdle(resources, 'missing', 100), /Missing/)
})
test('incomplete source-component matrices cannot be summarized as complete', () => {
  assert.throws(() => summarizeCold({ status: 'failed', rows: [] }), /incomplete/)
  assert.throws(() => summarizeCold({ status: 'complete', rows: [], config: { rounds: 2, cases: [{ name: 'missing' }] } }), /missing rounds/)
  assert.throws(() => summarizeMemory({ status: 'complete', rows: [], config: { rounds: 2 } }), /incomplete/)
  assert.throws(() => summarizeMemory({ status: 'complete', rows: [{ round: 1, mode: 'fixed', status: 'complete', cycles: [] }, { round: 1, mode: 'growth', status: 'complete', cycles: [] }], config: { rounds: 1, cycles: 8 } }), /incomplete/)
})
