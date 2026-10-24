import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, expect, it } from 'vitest'
import { fixture, runtime, validation, NOW } from '../../../application/workspace/test-fixtures.js'
import { sha256Bytes } from '../../../shared/project/binary.js'
import { ProjectRepository } from './repository.js'

const repositories: ProjectRepository[] = []
afterEach(async () => { for (const repository of repositories.splice(0)) { repository.close(); await Dexie.delete(repository.database.name) } })
async function setup() {
  const repository = new ProjectRepository({ name: 'originals-' + crypto.randomUUID(), runtime, validation }); repositories.push(repository)
  const bundle = fixture(), owner = bundle.project.document.sceneId
  await repository.save(bundle, null)
  const bytes = new TextEncoder().encode('{ "exact": "original bytes" }\n'), hash = sha256Bytes(bytes)
  const source = { ownerSceneId: owner, nodeId: 'kept-original', previousNodeId: null, sourceSchemaVersion: 6 as const,
    sourceSceneId: 'old-owner', sourceRevision: 12, sourceHash: hash, migratorVersion: 'converter-1', migratedAt: NOW }
  await repository.database.legacyBlobs.add({ sha256: hash, bytes }); await repository.database.legacySources.add(source)
  return { repository, owner, source, bytes }
}
it('returns exact independent original bytes only for the ready owner and verifies the full chain on every read', async () => {
  const { repository, owner, source, bytes } = await setup()
  expect(await repository.listLegacySources(owner)).toEqual([source])
  const result = await repository.loadLegacyOriginal(owner, source.nodeId)
  expect(result.bytes).toEqual(bytes); result.bytes[0] ^= 1; result.source.sourceSceneId = 'caller mutation'
  expect(await repository.loadLegacyOriginal(owner, source.nodeId)).toEqual({ source, bytes })
  await expect(repository.loadLegacyOriginal(owner, 'another-owner-node')).rejects.toThrow('不属于')
  await repository.database.legacySources.update([owner, source.nodeId], { previousNodeId: 'missing-ancestor' })
  await expect(repository.listLegacySources(owner)).rejects.toThrow('前序')
})
it('rejects corrupted actual original bytes without changing the ready project or silently omitting originals', async () => {
  const { repository, owner, source, bytes } = await setup()
  const current = await repository.load(owner)
  const damaged = bytes.slice(); damaged[0] ^= 1
  await repository.database.legacyBlobs.put({ sha256: source.sourceHash, bytes: damaged })
  await expect(repository.listLegacySources(owner)).rejects.toThrow('hash')
  await expect(repository.loadLegacyOriginal(owner, source.nodeId)).rejects.toThrow('hash')
  expect((await repository.load(owner))?.project).toEqual(current?.project)
})
