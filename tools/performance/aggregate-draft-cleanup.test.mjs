import assert from 'node:assert/strict'
import test from 'node:test'
import { runAggregateWithDraftCleanup } from './aggregate-draft-cleanup.mjs'

function fixture({ domain = 'building', dirty = true, count, onCancel = () => {}, operation = async () => {} } = {}) {
  const label = domain === 'building' ? '取消建筑草稿' : '取消室外草稿'
  const state = { revision: 12, selection: '["marker"]', nativeFormat: 'sceneweave-complete-project@1' }
  const project = { scene: { sceneId: 'scene', revision: 12, props: { marker: { x: 1 } } }, resources: ['original-bytes'], identity: { token: 'birth' } }
  const events = []
  let pendingDraft = dirty
  const page = { getByRole(role, options) {
    assert.equal(role, 'button'); assert.deepEqual(options, { name: label, exact: true })
    return {
      count: async () => count ?? Number(pendingDraft),
      async click() { events.push('cancel'); onCancel({ state, project }); pendingDraft = false },
      async waitFor(options) { assert.deepEqual(options, { state: 'hidden' }); assert.equal(pendingDraft, false); events.push('hidden') },
    }
  } }
  const observer = { snapshot: async () => ({ ...state }), setPhase: value => events.push(value), ready: async () => { events.push('ready') } }
  const options = { page, observer, domain, operation: async () => { events.push('operation'); await operation() },
    readProject: async phase => { events.push(phase); return structuredClone(project) }, assertSameProject: (before, after) => assert.deepEqual(after, before) }
  return { options, events, state, project, select() { assert.equal(pendingDraft, false, '建筑表单仍有草稿，选择被守卫阻止') } }
}

test('a refused building group leaves no form draft before canvas selection, without a new transaction', async () => {
  const harness = fixture()
  const result = await runAggregateWithDraftCleanup(harness.options)
  harness.select()
  assert.equal(result.status, 'cancelled')
  assert.equal(result.revisionUnchanged, true)
  assert.equal(result.completePackageUnchanged, true)
  assert.equal(harness.state.revision, 12)
  assert.deepEqual(harness.events, ['operation', 'before-draft-dismiss', 'setup-group-draft-dismiss', 'cancel', 'hidden', 'ready', 'after-draft-dismiss'])
})

test('the same completion boundary handles a surviving natural-group draft after undo', async () => {
  const harness = fixture({ domain: 'natural' })
  const result = await runAggregateWithDraftCleanup(harness.options)
  harness.select()
  assert.equal(result.button, '取消室外草稿')
})

test('successful adoption with no remaining draft adds no cancellation or package audit', async () => {
  const harness = fixture({ dirty: false })
  assert.deepEqual(await runAggregateWithDraftCleanup(harness.options), { status: 'not-needed', domain: 'building' })
  assert.deepEqual(harness.events, ['operation'])
})

test('an unexpected group failure preserves its first error and does not discard the draft', async () => {
  const failure = new Error('unexpected save failure')
  const harness = fixture({ operation: async () => { throw failure } })
  await assert.rejects(runAggregateWithDraftCleanup(harness.options), error => error === failure)
  assert.deepEqual(harness.events, ['operation'])
})

test('cleanup refuses ambiguous controls and does not touch another form', async () => {
  const ambiguous = fixture({ count: 2 })
  await assert.rejects(runAggregateWithDraftCleanup(ambiguous.options), /Ambiguous aggregate draft/)
  assert.deepEqual(ambiguous.events, ['operation'])
  const invalid = fixture()
  await assert.rejects(runAggregateWithDraftCleanup({ ...invalid.options, domain: 'mixed' }), /Unknown aggregate domain/)
  assert.deepEqual(invalid.events, [])
})

test('a cancellation that changes revision or selection fails before the next measurement', async () => {
  for (const field of ['revision', 'selection']) {
    const harness = fixture({ onCancel: ({ state }) => { state[field] = field === 'revision' ? 13 : '[]' } })
    await assert.rejects(runAggregateWithDraftCleanup(harness.options), /Draft dismissal changed/)
  }
})

test('a cancellation that changes persisted content at the same revision is rejected', async () => {
  const harness = fixture({ onCancel: ({ project }) => { project.resources[0] = 'different-bytes' } })
  await assert.rejects(runAggregateWithDraftCleanup(harness.options), { code: 'ERR_ASSERTION' })
})
