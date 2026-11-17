import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { readWorkflowCompanion, writeWorkflowCompanion } from './workflow-checkpoint.mjs'

test('work companions bind actual archive bytes and never fabricate an old workflow definition', async () => {
  const directory = await fs.mkdtemp(path.join(tmpdir(), 'sceneweave-workflow-checkpoint-'))
  try {
    const file = path.join(directory, 'work.sceneweave-image-work'), bytes = Buffer.from('actual archive'), binding = { id: 'image', version: 1, definitionHash: 'a'.repeat(64) }
    assert.deepEqual(await readWorkflowCompanion(file, bytes, value => value), { status: 'legacy-unbound', binding: null })
    await writeWorkflowCompanion(file, bytes, binding, 3)
    assert.equal((await readWorkflowCompanion(file, bytes, value => value)).generation, 3)
    await assert.rejects(readWorkflowCompanion(file, Buffer.from('changed archive'), value => value), /does not match/)
    await assert.rejects(readWorkflowCompanion(file, bytes, () => { throw new Error('definition changed') }), /definition changed/)
    await assert.rejects(writeWorkflowCompanion(file, bytes, binding, 4), { code: 'EEXIST' })
  } finally { await fs.rm(directory, { recursive: true, force: true }) }
})
