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

test('reused intermediate PID never grafts an older process or its whole subtree', () => {
  const timed = (pid, ppid, started, bytes = 100) => ({ ...row(pid, ppid, 'chrome.exe', bytes, bytes), started })
  const result = parseWindowsProcessSnapshot([
    timed(20, 1, '639305672000000000'), timed(948, 20, '639305672000000100'),
    timed(21, 20, '639305672000000101'),
    timed(1076, 948, '639301158787501840', 8000000000),
    timed(1248, 948, '639301158799804740', 1000000000),
    timed(1392, 1248, '639301158803555850', 1000000000),
  ], 20)
  assert.deepEqual(result.processes.map(value => value.pid), [20, 21, 948])
  assert.equal(result.rssBytes, 300)
  assert.equal(result.lineage.rejectedReusedParentEdges, 2)
  assert.equal(result.background.processCount, 3)
})

test('birth ordering retains single-tick precision above Number.MAX_SAFE_INTEGER', () => {
  const result = parseWindowsProcessSnapshot([
    { ...row(20, 1, 'chrome.exe', 100, 100), started: '639305672000000001' },
    { ...row(21, 20, 'chrome.exe', 200, 200), started: '639305672000000000' },
    { ...row(22, 20, 'chrome.exe', 300, 300), started: '639305672000000001' },
  ], 20)
  assert.deepEqual(result.processes.map(value => value.pid), [20, 22])
  assert.equal(result.lineage.rejectedReusedParentEdges, 1)
})

test('a missing or replaced root cannot authorize orphan/recycled descendants', () => {
  const child = { ...row(21, 20, 'chrome.exe', 100, 100), started: '100' }
  assert.deepEqual(parseWindowsProcessSnapshot([child], 20).processes, [])
  const changed = parseWindowsProcessSnapshot([{ ...row(20, 1, 'chrome.exe', 100, 100), started: '200' }, child], 20, '100')
  assert.equal(changed.rootPresent, false)
  assert.equal(changed.lineage.rootIdentityChanged, true)
  assert.deepEqual(changed.processes, [])
})

test('unknown birth times remain explicit incomplete lineage, with no assumed descendants', () => {
  const result = parseWindowsProcessSnapshot([
    row(20, 1, 'chrome.exe', 100, 100),
    { ...row(21, 20, 'chrome.exe', 200, 200), started: '0' },
  ], 20)
  assert.deepEqual(result.processes.map(value => value.pid), [20])
  assert.equal(result.lineage.unknownBirthEdges, 1)
  assert.equal(parseWindowsProcessSnapshot([{ ...row(20, 1, 'chrome.exe', 100, 100), started: '0' }], 20).lineage.rootBirthKnown, false)
})
