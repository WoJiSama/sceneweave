import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import { fixture, runtime, validation } from '../../../application/workspace/test-fixtures.js'
import { cloneJson } from '../../../shared/validation/json.js'
import { projectContentHash } from '../../../shared/project/validate.js'
import { ProjectConflictError, ProjectRepository } from './repository.js'

const repositories: ProjectRepository[] = []
afterEach(async () => {
  for (const repo of repositories.splice(0)) { const name = repo.database.name; repo.close(); await Dexie.delete(name) }
})
const repository = () => {
  const repo = new ProjectRepository({ name: `save-content-proof-${crypto.randomUUID()}`, runtime, validation })
  repositories.push(repo); return repo
}

describe('save complete-content proof reuse', () => {
  it('keeps the captured result immutable and the final revision CAS authoritative', async () => {
    const repo = repository(), input = fixture({ image: true }), owner = input.project.document.sceneId
    await repo.save(input, null)
    const next = { project: cloneJson(input.project), resources: input.resources }
    next.project.document.revision = 1; next.project.document.title = 'captured title'
    const expected = projectContentHash(next.project), saving = repo.save(next, 0)
    next.project.document.title = 'caller changed after first await'
    await saving
    expect(projectContentHash((await repo.load(owner))!.project)).toBe(expected)
    const stale = { project: cloneJson(input.project), resources: input.resources }
    stale.project.document.revision = 2
    await expect(repo.save(stale, 0)).rejects.toBeInstanceOf(ProjectConflictError)
    expect(projectContentHash((await repo.load(owner))!.project)).toBe(expected)
  })

  it('rejects altered persisted content and actual bytes despite a fresh valid candidate', async () => {
    const repo = repository(), input = fixture({ image: true }), owner = input.project.document.sceneId
    await repo.save(input, null)
    const next = { project: cloneJson(input.project), resources: input.resources }
    next.project.document.revision = 1
    const current = (await repo.database.projects.get(owner))!
    await repo.database.projects.put({ ...current, project: { ...cloneJson(current.project), document: { ...cloneJson(current.project.document), title: 'under old hash' } } })
    await expect(repo.save(next, 0)).rejects.toThrow(/hash/)
    await repo.database.projects.put(current)
    const resource = (await repo.database.resources.toArray())[0]
    await repo.database.resources.put({ ...resource, bytes: new Uint8Array([1, 2, 3]) })
    await expect(repo.save(next, 0)).rejects.toThrow(/字节|长度|hash/)
    expect((await repo.database.projects.get(owner))!.revision).toBe(0)
  })
})
