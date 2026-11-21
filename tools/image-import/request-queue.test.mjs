import assert from 'node:assert/strict'
import test from 'node:test'
import { imageToolEffect, runImageRequestQueue } from './request-queue.mjs'

const call = (id, name, args = {}) => JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } })

function deferred() {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}

test('determines effects from the actual call and keeps file writes exclusive', () => {
  assert.equal(imageToolEffect('image_import_guided_selection', { generation: 3 }), 'read')
  assert.equal(imageToolEffect('image_import_guided_selection', { generation: 3, target: 'item' }), 'checkpoint')
  assert.equal(imageToolEffect('image_import_set_room', { generation: 3 }), 'checkpoint')
  assert.equal(imageToolEffect('image_import_vision_boundary', { generation: 3, target: 'item' }), 'read')
  for (const name of ['image_import_build_project', 'image_import_export_work', 'image_import_analyze_repair', 'future_tool']) {
    assert.equal(imageToolEffect(name, name === 'image_import_build_project' ? { generation: 3 } : {}), 'serial')
  }
})

test('runs only two reads at a time and drains them before a mutation and its checkpoint', { timeout: 5000 }, async () => {
  const firstTwo = deferred(), releaseFirst = deferred(), third = deferred(), releaseThird = deferred()
  const write = deferred(), save = deferred()
  const started = [], finished = []
  let generation = 3
  const requests = [call(1, 'image_import_inspect'), call(2, 'image_import_item_preview'), call(3, 'image_import_inspect'),
    call(4, 'image_import_set_scale', { generation }), call(5, 'sceneweave_workflow'), call(6, 'image_import_export_work')]
  const run = runImageRequestQueue(requests, async ({ request }) => {
    const { id } = request
    started.push(id)
    if (id === 1) await releaseFirst.promise
    if (id === 2) firstTwo.resolve()
    if (id === 3) { third.resolve(); await releaseThird.promise }
    if (id === 4) {
      assert.equal(request.params.arguments.generation, generation)
      generation++
      write.resolve()
      await save.promise
    }
    finished.push([id, generation])
  })
  try {
    await firstTwo.promise
    assert.deepEqual(started, [1, 2])
    assert.deepEqual(finished, [[2, 3]])
    releaseFirst.resolve()
    await third.promise
    assert.deepEqual(started, [1, 2, 3])
    releaseThird.resolve()
    await write.promise
    assert.deepEqual(started, [1, 2, 3, 4])
    save.resolve()
    await run
    assert.deepEqual(finished, [[2, 3], [1, 3], [3, 3], [4, 4], [5, 4], [6, 4]])
  } finally {
    releaseFirst.resolve()
    releaseThird.resolve()
    save.resolve()
  }
})

test('waits for the last read at EOF even if its peer fails', { timeout: 5000 }, async () => {
  const release = deferred(), started = deferred()
  const failure = new Error('disconnected handler')
  let settled = false
  const run = runImageRequestQueue([call(1, 'image_import_inspect'), call(2, 'image_import_workflow')], async ({ request }) => {
    if (request.id === 1) throw failure
    started.resolve()
    await release.promise
  }).finally(() => { settled = true })
  const expected = assert.rejects(run, error => error === failure)
  await started.promise
  assert.equal(settled, false)
  release.resolve()
  await expected
})
