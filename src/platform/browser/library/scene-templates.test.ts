import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { expect, it } from 'vitest'
import { SceneTemplateRepository } from './scene-templates.js'
import { prepareSceneTemplate } from '../../../shared/scene-templates/content.js'
import { exportSceneTemplateBackup, importSceneTemplateBackup } from '../../../shared/scene-templates/backup.js'
import { fixture, runtime, validation } from '../../../application/workspace/test-fixtures.js'

it('keeps complete local templates through cold reads and a portable backup, rejects CAS and corrupt bytes atomically', async () => {
  const name = `scene-templates-${crypto.randomUUID()}`, repository = new SceneTemplateRepository(validation, name)
  const other = new SceneTemplateRepository(validation, name)
  try {
    const entry = await prepareSceneTemplate(fixture({ building: true, image: true }), { name: '客房', roomIds: ['room'] }, { validation, runtime })
    const baseline = await repository.read()
    const saved = await repository.commit(baseline.revision, [entry])
    await expect(other.commit(baseline.revision, [entry])).rejects.toThrow(/另一个标签/)
    const cold = await other.read(); expect(cold.entries).toEqual(saved.entries)
    const bytes = await exportSceneTemplateBackup(cold.entries, validation), restored = await importSceneTemplateBackup(bytes, validation)
    expect(restored).toEqual([entry])
    const bad = { ...entry, bytes: entry.bytes.slice() }; bad.bytes[30] ^= 1
    await expect(repository.commit(saved.revision, [bad])).rejects.toThrow()
    expect((await repository.read()).revision).toBe(saved.revision)
    const removed = await repository.commit(saved.revision, [], [entry.key])
    expect(removed.entries).toEqual([])
    expect((await repository.commit(removed.revision, restored)).entries).toEqual([entry])
    let accessed = false
    const accessor = Object.defineProperty({ key: entry.key, name: entry.name }, 'bytes', { enumerable: true, get: () => { accessed = true; return entry.bytes } })
    await expect(repository.commit(removed.revision + 1, [accessor as typeof entry])).rejects.toThrow(/访问器/)
    expect(accessed).toBe(false)
  } finally { repository.close(); other.close(); await Dexie.delete(name) }
})
