import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FormalVisualProgress } from './formal-visual-progress.ts'

async function fixture(run) {
  const directory = await mkdtemp(join(tmpdir(), 'sceneweave-visual-progress-'))
  let clock = 10
  const path = join(directory, 'formal-visual-progress.json')
  const progress = new FormalVisualProgress(path, { case: 'indoor', engine: 'firefox' }, () => clock)
  const read = async () => JSON.parse(await readFile(path, 'utf8'))
  try { await run({ progress, read, directory, path, tick: value => { clock += value } }) }
  finally { await rm(directory, { recursive: true, force: true }) }
}

test('completed phases and actual observations persist before the next phase finishes', async () => {
  await fixture(async ({ progress, read, tick, directory }) => {
    progress.begin('baseline')
    const result = await progress.measure('import effect', async () => { tick(12); return 'actual-input' }, value => ({ input: value }))
    assert.equal(result, 'actual-input')
    const facts = { packageSha256: 'actual-verified-hash' }
    progress.complete(facts); facts.packageSha256 = 'later mutable value'; progress.begin('native crop west')
    const saved = await read()
    assert.equal(saved.status, 'running'); assert.equal(saved.completeFactsArtifact, null)
    assert.equal(saved.phases[0].status, 'complete')
    assert.deepEqual(saved.phases[0].facts, { packageSha256: 'actual-verified-hash' })
    assert.equal(saved.operations[0].elapsedMs, 12)
    assert.deepEqual(saved.operations[0].facts, { input: 'actual-input' })
    assert.equal(saved.phases[1].status, 'running')
    assert.deepEqual(await readdir(directory), ['formal-visual-progress.json'])
  })
})

test('the primary assertion survives later context cleanup errors', async () => {
  await fixture(async ({ progress, read, tick }) => {
    progress.begin('native crop west')
    const first = new Error('actual pixel mismatch')
    await assert.rejects(progress.measure('export gm PNG', async () => { tick(15); throw first }), error => error === first)
    progress.cleanupFailed(new Error('later context close error'))
    progress.finish('failed', [{ message: first.message }])
    const saved = await read()
    assert.equal(saved.status, 'failed'); assert.equal(saved.phases[0].status, 'failed')
    assert.equal(saved.operations[0].status, 'failed'); assert.equal(saved.firstFailure.message, first.message)
    assert.equal(saved.completeFactsArtifact, null); assert.equal(saved.cleanupErrors[0].message, 'later context close error')
  })
})

test('timeout retains prior phases and a late result cannot overwrite it or start another operation', async () => {
  await fixture(async ({ progress, read, tick }) => {
    progress.begin('baseline'); progress.complete({ coldRead: 'verified' }); progress.begin('native crop east')
    let resolve
    const pending = progress.measure('export gm PNG', () => new Promise(done => { resolve = done }))
    tick(900_000); progress.finish('timedOut', [{ message: 'Test timeout of 900000ms exceeded' }])
    const saved = await read()
    assert.equal(saved.status, 'timedOut'); assert.equal(saved.phases[0].status, 'complete')
    assert.equal(saved.phases[1].status, 'interrupted'); assert.equal(saved.operations[0].status, 'interrupted')
    assert.equal(saved.operations[0].elapsedMs, 900_000)
    resolve('late result'); assert.equal(await pending, 'late result')
    progress.complete({ mustNotAppear: true }); progress.factsWritten('must-not-appear.json')
    let laterStarted = false
    await assert.rejects(progress.measure('late operation', async () => { laterStarted = true }), /finalized/)
    assert.equal(laterStarted, false); assert.deepEqual(await read(), saved)
  })
})

test('a late rejection after interruption preserves the captured timeout', async () => {
  await fixture(async ({ progress, read }) => {
    progress.begin('native crop east')
    let reject
    const pending = progress.measure('export', () => new Promise((_, fail) => { reject = fail }))
    progress.finish('interrupted', [{ message: 'worker interrupted' }]); const saved = await read()
    const late = new Error('context closed after interruption'); reject(late)
    await assert.rejects(pending, error => error === late)
    progress.cleanupFailed(late); progress.finish('failed', [late])
    assert.deepEqual(await read(), saved)
  })
})

test('the runner primary timeout takes precedence over a cancellation side effect', async () => {
  await fixture(async ({ progress, read }) => {
    progress.begin('native crop east')
    await assert.rejects(progress.measure('export', async () => { throw new Error('context closed during cancellation') }))
    progress.finish('timedOut', [{ message: 'Test timeout of 900000ms exceeded' }])
    const saved = await read()
    assert.equal(saved.firstFailure.message, 'Test timeout of 900000ms exceeded')
    assert.equal(saved.operations[0].failure.message, 'context closed during cancellation')
  })
})

test('existing evidence is never overwritten by a second recorder', async () => {
  await fixture(async ({ path, progress, read }) => {
    progress.begin('baseline'); const before = await read()
    assert.throws(() => new FormalVisualProgress(path, { case: 'different case' }), { code: 'EEXIST' })
    assert.deepEqual(await read(), before)
  })
})

test('a checkpoint write failure retains the previous valid JSON and the browser first failure', async () => {
  await fixture(async ({ path, progress, read }) => {
    progress.begin('baseline'); const before = await read()
    const blocked = `${path}.pending-${process.pid}`; await mkdir(blocked)
    const primary = new Error('actual browser failure')
    // The begin checkpoint fails before any browser action runs.
    let ran = false
    await assert.rejects(progress.measure('cannot record', async () => { ran = true }))
    assert.equal(ran, false); assert.deepEqual(await read(), before)
    progress.failed(primary)
    await rm(blocked, { recursive: true })
    progress.finish('failed', [primary])
    const saved = await read()
    assert.equal(saved.firstFailure.message, primary.message); assert.equal(saved.recordingErrors.length, 1)
  })
})

test('passing diagnostics reference full facts only after the caller publishes that artifact', async () => {
  await fixture(async ({ progress, read }) => {
    progress.begin('final assertions'); progress.complete({ pageErrors: [], developmentRequests: [] })
    progress.factsWritten('formal-visual-facts.json'); progress.finish('passed', [])
    const saved = await read()
    assert.equal(saved.status, 'passed'); assert.equal(saved.completeFactsArtifact, 'formal-visual-facts.json')
    assert.match(saved.scope, /diagnostic/i)
  })
})

test('cleanup remains visible while pending and executes after timeout without rewriting the final record', async () => {
  await fixture(async ({ progress, read, tick }) => {
    progress.begin('native crop east'); progress.complete({ pixels: 'verified' })
    let resolve
    const pending = progress.cleanup('close isolated context', () => new Promise(done => { resolve = done }))
    const active = await read()
    assert.equal(active.operations[0].name, 'close isolated context'); assert.equal(active.operations[0].status, 'running')
    tick(25); progress.finish('timedOut', [{ message: 'Test timeout' }]); const final = await read()
    resolve('closed'); assert.equal(await pending, 'closed')
    let closed = false
    await progress.cleanup('close another context', async () => { closed = true })
    assert.equal(closed, true); assert.deepEqual(await read(), final)
  })
})

test('checkpoint failure cannot prevent cleanup or replace its actual failure and the original test failure', async () => {
  await fixture(async ({ progress, read, path }) => {
    progress.begin('native crop east')
    const primary = new Error('original assertion'); progress.failed(primary)
    const before = await read(), blocked = `${path}.pending-${process.pid}`
    await mkdir(blocked)
    let closed = 0
    assert.equal(await progress.cleanup('close first context', async () => { closed++; return 'closed' }), 'closed')
    const cleanupFailure = new Error('actual close failure')
    await assert.rejects(progress.cleanup('close second context', async () => { closed++; throw cleanupFailure }), error => error === cleanupFailure)
    assert.equal(closed, 2); assert.deepEqual(await read(), before)
    await rm(blocked, { recursive: true }); progress.finish('failed', [primary])
    const final = await read()
    assert.equal(final.firstFailure.message, primary.message)
    assert.equal(final.operations[0].status, 'complete'); assert.equal(final.operations[1].status, 'failed')
    assert.equal(final.cleanupErrors[0].message, cleanupFailure.message); assert.equal(final.recordingErrors.length, 4)
  })
})
