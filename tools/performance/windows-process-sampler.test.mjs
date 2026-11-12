import assert from 'node:assert/strict'
import test from 'node:test'
import { parseWindowsProcessSnapshot } from './windows-process-sampler.mjs'

const row = (pid, ppid, name, workingSetBytes, privateBytes) => ({ pid, ppid, name, workingSetBytes, privateBytes, cpu100ns: '2500000', started: '12345' })
test('Windows sampler follows grandchildren, records private commitment separately and aggregates background only', () => {
  const result = parseWindowsProcessSnapshot([
    row(2, 1, 'chrome.exe', 1000, 2000), row(3, 2, 'chrome.exe', 3000, 4000), row(4, 3, 'chrome.exe', 500, 700),
    row(8, 1, 'chrome.exe', 9000, 9000), row(9, 1, 'node.exe', 8000, 8000)], 2)
  assert.equal(result.rootPresent, true); assert.equal(result.rssBytes, 4500); assert.equal(result.privateBytes, 6700)
  assert.deepEqual(result.processes.map(value => value.pid), [2, 3, 4]); assert.equal(result.processes[0].cpuTimeMs, 250)
  assert.deepEqual(result.background, { processCount: 2, browserProcessCount: 1, nodeProcessCount: 1 })
  assert.equal(JSON.stringify(result).includes('9000'), false)
})
test('Windows sampler preserves missing root and rejects invalid counters rather than reporting zero', () => {
  assert.equal(parseWindowsProcessSnapshot([], 2).rootPresent, false)
  for (const field of ['workingSetBytes', 'privateBytes', 'cpu100ns']) assert.throws(() => parseWindowsProcessSnapshot([{ ...row(2, 1, 'chrome.exe', 1, 2), [field]: 'bad' }], 2))
  assert.throws(() => parseWindowsProcessSnapshot([{ ...row(2, 1, 'chrome.exe', 1, 2), name: 'user/path --private' }], 2))
})
