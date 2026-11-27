import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { parseArguments, readBounded, readRequest, writeVerified, replaceResult, digest } from './io.mjs'

test('generation needs separate explicit authorization, budget and absolute paths', () => {
  const args = ['generate', '--input', '/tmp/in.json', '--output', '/tmp/new-output', '--allow', 'forest-building', '--budget', 'standard']
  assert.deepEqual(parseArguments(args), { command: 'generate', input: path.resolve('/tmp/in.json'), output: path.resolve('/tmp/new-output'), budget: 'standard' })
  for (const invalid of [args.slice(0, -2), args.slice(0, -4), [...args, '--budget', 'expanded'],
    args.map(value => value === '/tmp/in.json' ? 'in.json' : value), args.map(value => value === 'forest-building' ? 'anything' : value),
    args.map(value => value === 'standard' ? 'unbounded' : value), [...args, '--endpoint', 'https://example.invalid'], ['capabilities', '--budget', 'small']]) {
    assert.throws(() => parseArguments(invalid))
  }
})

test('workflow discovery is read-only and rejects ambiguous selectors', () => {
  assert.deepEqual(parseArguments(['workflows']), { command: 'workflows', query: { action: 'list' } })
  assert.deepEqual(parseArguments(['workflows', '--id', 'sceneweave-image-items', '--step', 'review']), {
    command: 'workflows', query: { action: 'step', workflowId: 'sceneweave-image-items', stepId: 'review' },
  })
  const definitionHash = 'a'.repeat(64)
  assert.deepEqual(parseArguments(['workflows', '--id', 'sceneweave-image-items', '--definition-hash', definitionHash, '--step', 'review']), {
    command: 'workflows', query: { action: 'step', workflowId: 'sceneweave-image-items', stepId: 'review', definitionHash },
  })
  for (const args of [['--step', 'review'], ['--id', 'image', '--step', 'review', '--effects'], ['--id', 'image', '--query', 'forest'],
    ['--schema'], ['--output', '/tmp/out'], ['--definition-hash', definitionHash], ['--id', 'image', '--definition-hash', 'wrong']]) {
    assert.throws(() => parseArguments(['workflows', ...args]))
  }
})

test('furniture repair requires an exact archive, one explicit room and registered budget', () => {
  const args = ['repair-furniture', '--input', path.resolve('parent.sceneweave'), '--room', 'room-a', '--output', path.resolve('repair-output'), '--allow', 'forest-building', '--budget', 'standard']
  assert.equal(parseArguments(args).command, 'repair-furniture')
  assert.equal(parseArguments(args).roomId, 'room-a')
  assert.throws(() => parseArguments(args.filter((_, index) => index !== 3 && index !== 4)))
  assert.throws(() => parseArguments([...args, '--strategy', 'skip-clearance']))
  assert.throws(() => parseArguments(args.map(value => value === 'room-a' ? '__proto__' : value)))
  assert.throws(() => parseArguments(['generate', ...args.slice(1)]))
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

test('a temporarily locked result is atomically replaced after the filesystem releases it', async () => {
  const directory = await fs.mkdtemp(path.join(tmpdir(), 'sceneweave-harness-publish-test-'))
  try {
    const target = path.join(directory, 'result.json')
    await fs.writeFile(target, '{"status":"running"}\n', { flag: 'wx' })
    let attempts = 0, publications = 0
    await replaceResult(directory, { status: 'complete' }, {
      operations: { writeFile: fs.writeFile, async rename(from, to) {
        if (++attempts === 1) throw Object.assign(new Error('File temporarily locked'), { code: 'EPERM' })
        assert.equal(JSON.parse(await fs.readFile(to, 'utf8')).status, 'running')
        return fs.rename(from, to)
      } },
      onPublished: () => { publications++ },
    })
    assert.equal(attempts, 2)
    assert.equal(publications, 1)
    assert.equal(JSON.parse(await fs.readFile(target, 'utf8')).status, 'complete')
    assert.deepEqual(await fs.readdir(directory), ['result.json'])
  } finally {
    const checked = await fs.realpath(directory)
    assert.equal(path.dirname(checked), await fs.realpath(tmpdir()))
    assert.match(path.basename(checked), /^sceneweave-harness-publish-test-/)
    await fs.rm(checked, { recursive: true, force: true })
  }
})
