import test from 'node:test'
import assert from 'node:assert/strict'
import { installDiagnosticStageObserver } from './diagnostic-stages.mjs'
import { summarizeCpuProfile } from './summarize-workflow-analysis.mjs'

function withClock(run) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'performance')
  let now = 0
  Object.defineProperty(globalThis, 'performance', { configurable: true, value: { now: () => now } })
  try { run(value => { now = value }) }
  finally { Object.defineProperty(globalThis, 'performance', descriptor); Reflect.deleteProperty(globalThis, '__sceneweaveDiagnosticStages') }
}

test('compact stages retain all calls, input sizes and failures without keeping tiny spans', () => withClock(tick => {
  installDiagnosticStageObserver({ compact: true })
  const api = globalThis.__sceneweaveDiagnosticStages
  api.start('tiny', 1)
  for (let i = 0; i < 100_001; i++) { const span = api.begin('hash', 3); if (i === 0) span.fail(); span.end() }
  tick(1); const slow = api.begin('hash', 7); tick(3); slow.end(); slow.end()
  const result = api.finish()
  assert.equal(result.dropped, 0); assert.equal(result.spans.length, 1); assert.equal(result.filteredSmallSpans, 100_001)
  assert.deepEqual(result.aggregates[0], { name: 'hash', count: 100_002, failed: 1, totalMs: 2, maxMs: 2, inputSize: 300_010 })
}))

test('stage windows report unfinished spans and never count them as completed', () => withClock(tick => {
  installDiagnosticStageObserver()
  const api = globalThis.__sceneweaveDiagnosticStages
  api.start('old', 1); const span = api.begin('async'); assert.equal(api.pending(), 1)
  tick(5); const result = api.finish()
  assert.equal(result.openAtEnd.length, 1); assert.equal(result.spans.length, 0); assert.equal(api.pending(), 0)
  api.start('new', 2); span.end(); assert.equal(api.finish().spans.length, 0)
}))

const frame = (name, line = -1) => ({ functionName: name, url: '', lineNumber: line, columnNumber: 0 })
const profile = () => ({ startTime: 0, endTime: 10_000, nodes: [
  { id: 1, callFrame: frame('(root)'), children: [2, 5] },
  { id: 2, callFrame: frame('outer', 0), children: [3] },
  { id: 3, callFrame: frame('recursive', 1), children: [4] },
  { id: 4, callFrame: frame('sha', 2) }, { id: 5, callFrame: frame('(idle)') },
], samples: [4, 3, 5], timeDeltas: [2000, 3000, 4000] })
test('CPU self weights partition samples; recursive inclusive source and SHA caller are counted once', () => {
  const result = summarizeCpuProfile(profile(), f => f.lineNumber >= 0 ? { source: f.functionName === 'sha' ? 'src/shared/validation/hash.ts' : 'src/storage.ts', line: f.lineNumber + 1 } : null)
  assert.equal(result.sampledMs, 9); assert.equal(result.uncoveredMs, 1)
  assert.equal(result.selfSources.reduce((sum, row) => sum + row.sampledMs, 0), 9)
  assert.equal(result.inclusiveSources.find(row => row.source === 'src/storage.ts').sampledMs, 5)
  assert.equal(result.shaCallers[0].sampledMs, 2); assert.equal(result.shaCallers[0].name, 'recursive')
})
test('CPU analysis rejects misaligned or invalid samples', () => {
  assert.throws(() => summarizeCpuProfile({ ...profile(), timeDeltas: [2000] }), /length mismatch/)
  assert.throws(() => summarizeCpuProfile({ ...profile(), samples: [99, 3, 5] }), /Invalid CPU sample/)
  assert.throws(() => summarizeCpuProfile({ ...profile(), timeDeltas: [-1, 1, 1] }), /Invalid CPU sample/)
})
