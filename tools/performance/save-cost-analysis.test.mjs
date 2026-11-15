import assert from 'node:assert/strict'
import test from 'node:test'
import ts from 'typescript'
import { summarizeCpu } from './run-save-cost-analysis.mjs'
import { instrumentSaveCost, installSaveBoundaryDiagnostic, saveCostTargets, instrumentHookCopies } from './instrument-save-cost.mjs'

test('CPU summary assigns each leaf once and retains idle, GC and unknown/native time', () => {
  const profile = { startTime: 0, endTime: 9000, nodes: [
    { id: 1, callFrame: { functionName: '(root)', url: '' }, children: [2, 3, 4] },
    { id: 2, callFrame: { functionName: 'compute', url: 'http://localhost:123/src/check.ts' } },
    { id: 3, callFrame: { functionName: '(idle)', url: '' } },
    { id: 4, callFrame: { functionName: '(garbage collector)', url: '' } },
  ], samples: [2, 3, 2, 4, 1], timeDeltas: [1000, 2000, 1000, 3000, 2000] }
  const result = summarizeCpu(profile)
  assert.equal(result.sampledMs, 9)
  assert.equal(result.functions.reduce((n, row) => n + row.selfMs, 0), 9)
  assert.equal(result.files.reduce((n, row) => n + row.selfMs, 0), 9)
  assert.equal(result.attribution.reduce((n, row) => n + row.selfMs, 0), 9)
  assert.equal(result.functions.find(row => row.name === 'compute').selfMs, 2)
  assert.equal(result.functions.find(row => row.name === 'compute').file, '/src/check.ts')
})

test('boundary diagnostic preserves sync values, asynchronous outcomes and thrown errors', async () => {
  installSaveBoundaryDiagnostic()
  const api = Reflect.get(globalThis, '__sceneweaveSaveBoundaries'), value = {}, error = new Error('original failure')
  api.reset()
  assert.equal(api.call('sync', () => value), value)
  assert.throws(() => api.call('failed', () => { throw error }), e => e === error)
  assert.equal(await api.call('async', async () => value), value)
  await assert.rejects(api.call('async-failed', async () => { throw error }), e => e === error)
  assert.deepEqual(Object.fromEntries(Object.entries(api.finish().functions).map(([k, v]) => [k, v.count])), { sync: 1, failed: 1, async: 1, 'async-failed': 1 })
  assert.equal(api.call('inactive', () => value), value)
  delete globalThis.__sceneweaveSaveBoundaries
})

test('source instrumentation fails closed on drift and keeps async methods parseable', () => {
  const file = 'src/platform/browser/storage/content-context.ts', source = saveCostTargets[file].map(name => `export async function ${name}(value: unknown) { return value }`).join('\n')
  const result = instrumentSaveCost(source, file), ast = ts.createSourceFile(file, result, ts.ScriptTarget.Latest, true)
  assert.equal(ast.parseDiagnostics.length, 0)
  assert.throws(() => instrumentSaveCost(source.replace('matchingEncodedSnapshot', 'changedName'), file), /Missing boundary/)
  assert.throws(() => instrumentSaveCost(source + source, file), /Ambiguous boundary/)
})

test('hook observations retain counts and ordering without field names or values', () => {
  installSaveBoundaryDiagnostic()
  const api = Reflect.get(globalThis, '__sceneweaveSaveBoundaries')
  api.reset()
  api.shape('accounting', { 'project.document.title': 'private title', secret: 'private key', project: { private: 'payload' } }, 'project')
  const output = api.finish()
  assert.deepEqual(output.shapes, { 'accounting.payload.replacement.last': { count: 1, changes: 3, nested: 1 } })
  assert.doesNotMatch(JSON.stringify(output), /private|secret|title/)
  assert.throws(() => instrumentHookCopies('changed implementation', 'src/platform/browser/storage/database.ts'), /Missing\/ambiguous/)
  delete globalThis.__sceneweaveSaveBoundaries
})
