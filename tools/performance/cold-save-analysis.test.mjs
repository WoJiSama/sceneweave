import assert from 'node:assert/strict'
import test from 'node:test'
import ts from 'typescript'
import { installColdSaveDiagnostic, instrumentColdSave, instrumentColdWorker } from './instrument-cold-save.mjs'

test('cold boundaries preserve values, failures and independent async owners', async () => {
  installColdSaveDiagnostic(); const api = globalThis.__sceneweaveColdSave, value = {}, failure = Error('expected')
  api.reset(); assert.equal(api.call('sync', () => value, 4), value)
  assert.throws(() => api.call('failure', () => { throw failure }), e => e === failure)
  assert.equal(await api.call('async', async () => value), value)
  await assert.rejects(api.call('reject', async () => { throw failure }), e => e === failure)
  const result = api.finish(); assert.equal(result.functions.sync.inputBytes, 4)
  assert.deepEqual(Object.fromEntries(Object.entries(result.functions).map(([name, row]) => [name, row.count])), { sync: 1, failure: 1, async: 1, reject: 1 })
  delete globalThis.__sceneweaveColdSave
})
test('capture observations contain schema counts and bytes, never keys or payloads', () => {
  installColdSaveDiagnostic(); const api = globalThis.__sceneweaveColdSave; api.reset()
  api.capture(new Map([['resources', [{ privateKey: 'private payload', bytes: new Uint8Array(7) }]]]))
  api.capture(null)
  const output = api.finish(); assert.deepEqual(output.captures, [{ overflow: false, tables: [{ table: 'resources', rows: 1, binaryBytes: 7 }] }, { overflow: true }])
  assert.doesNotMatch(JSON.stringify(output), /private/); delete globalThis.__sceneweaveColdSave
})
test('instrumentation refuses drift and preserves parseable original Worker protocol', () => {
  const file = 'src/platform/browser/storage/storage-audit.ts'
  const source = 'async function capture(){return 1}\nconst receipt={async confirm(){return 2}}\nasync function prepare(){const rows=await capture();\n  if (!rows) return\nreturn rows}'
  const output = instrumentColdSave(source, file)
  assert.equal(ts.createSourceFile(file, output, ts.ScriptTarget.Latest, true).parseDiagnostics.length, 0)
  assert.throws(() => instrumentColdSave(source.replace('confirm', 'renamed'), file), /Missing/)
  const worker = instrumentColdWorker('const result = await auditHistoryMessage(event.data);self.postMessage({ok:true,documentBytes:result.documentBytes})')
  assert.match(worker, /self.postMessage\(\{ok:true,documentBytes:result.documentBytes\}\)/)
  assert.throws(() => instrumentColdWorker('drift'), /drift/)
})
