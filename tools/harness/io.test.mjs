import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { parseArguments, readBounded, readRequest, writeVerified, replaceResult, digest } from './io.mjs'

test('generation needs separate explicit authorization, budget and absolute paths', () => {
  const args = ['generate', '--input', '/tmp/in.json', '--output', '/tmp/new-output', '--allow', 'forest-building', '--budget', 'standard']
  assert.deepEqual(parseArguments(args), { command: 'generate', input: '/tmp/in.json', output: '/tmp/new-output', budget: 'standard' })
  for (const invalid of [args.slice(0, -2), args.slice(0, -4), [...args, '--budget', 'expanded'],
    args.map(value => value === '/tmp/in.json' ? 'in.json' : value), args.map(value => value === 'forest-building' ? 'anything' : value),
    args.map(value => value === 'standard' ? 'unbounded' : value), [...args, '--endpoint', 'https://example.invalid'], ['capabilities', '--budget', 'small']]) {
    assert.throws(() => parseArguments(invalid))
  }
})

test('input reads are bounded and output creation never overwrites previous bytes', async () => {
  const directory = await fs.mkdtemp(path.join(tmpdir(), 'sceneweave-harness-io-test-'))
  try {
    const file = path.join(directory, 'input.json'), input = Buffer.from('{"safe":true}\n')
    await fs.writeFile(file, input)
    assert.deepEqual(await readRequest(file), { safe: true })
    await assert.rejects(readBounded(file, 2), /at most/)
    await assert.rejects(readBounded(directory, 100), /regular file/)
    const saved = await writeVerified(directory, 'saved.bin', input)
    assert.equal(saved.record.sha256, digest(input))
    await assert.rejects(writeVerified(directory, 'saved.bin', Buffer.from('replacement')), { code: 'EEXIST' })
    assert.deepEqual(await fs.readFile(path.join(directory, 'saved.bin')), input)
    await fs.writeFile(file, Buffer.from([0xff, 0xfe]))
    await assert.rejects(readRequest(file), /UTF-8 JSON/)
    await fs.writeFile(path.join(directory, 'result.json'), '{"status":"running"}\n', { flag: 'wx' })
    await replaceResult(directory, { status: 'failed' })
    assert.equal(JSON.parse(await fs.readFile(path.join(directory, 'result.json'), 'utf8')).status, 'failed')
  } finally { await fs.rm(directory, { recursive: true, force: true }) }
})

test('cancel during completion staging or rename leaves a failed result and never commits', async () => {
  for (const interruptedOperation of ['writeFile', 'rename']) {
    const directory = await fs.mkdtemp(path.join(tmpdir(), 'sceneweave-harness-publish-test-'))
    try {
      await fs.writeFile(path.join(directory, 'result.json'), '{"status":"running"}\n', { flag: 'wx' })
      let stopped = false, committed = false
      const operations = Object.fromEntries(['writeFile', 'rename'].map(name => [name, async (...args) => {
        const result = await fs[name](...args)
        if (name === interruptedOperation) stopped = true
        return result
      }]))
      await assert.rejects(replaceResult(directory, { status: 'complete' }, {
        operations,
        checkCurrent: () => { if (stopped) throw new Error('cancelled') },
        onPublished: () => { committed = true },
      }), /cancelled/)
      assert.equal(committed, false)
      await replaceResult(directory, { status: 'failed', error: 'cancelled' })
      assert.equal(JSON.parse(await fs.readFile(path.join(directory, 'result.json'), 'utf8')).status, 'failed')
      assert.equal((await fs.readdir(directory)).includes('.result.pending.json'), false)
    } finally { await fs.rm(directory, { recursive: true, force: true }) }
  }
})

test('publication commits synchronously after its final check and later signals cannot revoke it', async () => {
  const directory = await fs.mkdtemp(path.join(tmpdir(), 'sceneweave-harness-publish-test-'))
  try {
    await fs.writeFile(path.join(directory, 'result.json'), '{"status":"running"}\n', { flag: 'wx' })
    let stopped = false, committed = false
    const stop = () => { if (!committed) stopped = true }
    await replaceResult(directory, { status: 'complete' }, {
      checkCurrent: () => { if (stopped) throw new Error('cancelled') },
      onPublished: () => { committed = true },
    })
    stop()
    assert.equal(stopped, false)
    assert.equal(committed, true)
    assert.equal(JSON.parse(await fs.readFile(path.join(directory, 'result.json'), 'utf8')).status, 'complete')
  } finally { await fs.rm(directory, { recursive: true, force: true }) }
})
