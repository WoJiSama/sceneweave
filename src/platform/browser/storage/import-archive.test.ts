import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, expect, it, vi } from 'vitest'
import { fixture, runtime, validation, NOW } from '../../../application/workspace/test-fixtures.js'
import { projectContentHash } from '../../../shared/project/validate.js'
import type { HistoryArchive } from '../../../shared/project/history.js'
import { ProjectRepository } from './repository.js'

const repos: ProjectRepository[] = [], names: string[] = []
function repository() { const name = 'native-archive-' + crypto.randomUUID(); names.push(name); const repo = new ProjectRepository({ name, runtime, validation }); repos.push(repo); return repo }
function archive(): HistoryArchive {
  const current = fixture({ image: true }), owner = current.project.document.sceneId
  return { current, snapshots: [{ id: 'selected-history', ownerSceneId: owner, lineageId: current.project.historyIdentity.lineageId,
    sourceRevision: current.project.document.revision, name: 'selected snapshot', kind: 'named', createdAt: NOW,
    contentHash: projectContentHash(current.project), bundle: current }] }
}
afterEach(async () => { vi.restoreAllMocks(); repos.splice(0).forEach(repo => repo.close()); for (const name of names.splice(0)) await Dexie.delete(name) })

it('atomically imports native current and selected history under a fresh owner without rewriting historical document identity', async () => {
  const repo = repository(), input = archive(), originalHash = projectContentHash(input.current.project), result = await repo.importArchive(input)
  expect(result.project.project.document.sceneId).not.toBe(input.current.project.document.sceneId)
  expect(result.project.project.document.revision).toBe(0)
  expect(projectContentHash(input.current.project)).toBe(originalHash)
  const history = await repo.loadSnapshot(result.project.project.document.sceneId, result.snapshots[0].id)
  expect(history?.bundle.project).toEqual(input.current.project)
  expect(history?.ownerSceneId).toBe(result.project.project.document.sceneId)
  const reopened = new ProjectRepository({ name: repo.database.name, runtime, validation }); repos.push(reopened)
  const loaded = await reopened.load(result.project.project.document.sceneId)
  expect(loaded?.project).toEqual(result.project.project)
  for (const hash of Object.keys(result.project.project.assets)) expect(await loaded!.resources.read(hash)).toEqual(await input.current.resources.read(hash))
})

it('rolls back current, resource bindings and all history when any archive row fails, retaining an unrelated ready project', async () => {
  const repo = repository(), existing = fixture(); await repo.save(existing, null)
  const before = await repo.database.resourceBindings.count()
  vi.spyOn(repo.database.snapshots, 'add').mockRejectedValueOnce(new Error('injected final history failure'))
  await expect(repo.importArchive(archive())).rejects.toThrow('injected final history failure')
  expect((await repo.list()).map(row => row.sceneId)).toEqual([existing.project.document.sceneId])
  expect(await repo.database.snapshots.count()).toBe(0)
  expect(await repo.database.resourceBindings.count()).toBe(before)
  expect(await repo.database.resources.count()).toBe(0)
})
