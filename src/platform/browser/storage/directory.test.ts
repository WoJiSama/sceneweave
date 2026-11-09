import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fixture, runtime, validation } from '../../../application/workspace/test-fixtures.js'
import { cloneJson } from '../../../shared/validation/json.js'
import type { ProjectBundle } from '../../../shared/model/project.js'
import { ProjectRepository } from './repository.js'
import { PROJECT_TABLES } from './database.js'
import type { ProjectBlockManifest } from './content-blocks.js'

const repositories: ProjectRepository[] = [], names = new Set<string>()
function repository(name = `directory-${crypto.randomUUID()}`) {
  const repo = new ProjectRepository({ name, runtime, validation }); repositories.push(repo); names.add(name); return repo
}
const revision = (bundle: ProjectBundle, value: number) => {
  const project = cloneJson(bundle.project); project.document.revision = value
  return { project, resources: bundle.resources }
}
async function nativeCurrent(repo: ProjectRepository, owner: string) {
  return repo.database.transaction('r', PROJECT_TABLES, async () => await repo.database.rawJsonRecord('projects', owner) as { project: ProjectBlockManifest; [key: string]: unknown })
}
afterEach(async () => {
  vi.restoreAllMocks()
  for (const repo of repositories.splice(0)) repo.close()
  for (const name of names) await Dexie.delete(name)
  names.clear()
})

describe('navigation directories do not materialize complete content', () => {
  it('paginates same-name projects by stable identity and only reads actual title blocks', async () => {
    const repo = repository(), bundles = [fixture(), fixture(), fixture()]
    for (const bundle of bundles) await repo.save(bundle, null)
    const hydrated: unknown[] = [], read = (value: unknown) => { hydrated.push(value); return value }
    repo.database.projects.hook('reading', read)
    const first = await repo.projectDirectory({ limit: 2 }), second = await repo.projectDirectory({ limit: 2, after: first.next! })
    expect(hydrated).toEqual([])
    expect(first.total).toBe(3); expect(second.next).toBeNull()
    expect([...first.entries, ...second.entries].map(row => row.sceneId)).toEqual(bundles.map(bundle => bundle.project.document.sceneId).sort((a, b) => a.localeCompare(b)))
    expect(first.entries.every(row => row.contentStatus === 'not-checked' && row.summary && row.issue === null)).toBe(true)
    expect((await repo.projectDirectory({ query: bundles[1].project.document.sceneId })).entries.map(row => row.sceneId)).toEqual([bundles[1].project.document.sceneId])
    repo.database.projects.hook('reading').unsubscribe(read)
  })

  it.each([
    { label: 'whitespace-only', title: ' \t\n  ' },
    { label: 'long multibyte', title: '目录标题'.repeat(512) },
  ])('preserves a schema-valid $label title through navigation and strict opening', async ({ title }) => {
    const repo = repository(), input = fixture(), owner = input.project.document.sceneId
    input.project.document.title = title
    await repo.save(input, null)
    const raw = await nativeCurrent(repo, owner)
    expect((await repo.projectDirectory()).entries).toEqual([{
      sceneId: owner, summary: { sceneId: owner, title, revision: 0, savedAt: runtime.clock.now(), conversionJobId: null },
      issue: null, contentStatus: 'not-checked',
    }])
    expect((await repo.load(owner))!.project).toEqual(input.project)
    expect(await nativeCurrent(repo, owner)).toEqual(raw)
  })

  it('requires the same saved-project history metadata as strict opening without creating missing metadata', async () => {
    const repo = repository(), input = fixture(), owner = input.project.document.sceneId
    await repo.save(input, null)
    expect(await repo.historyDirectory(owner)).toMatchObject({ metadataVersion: 0, historyState: 'ready', issues: [] })
    const raw = await nativeCurrent(repo, owner), versions = await repo.database.historyVersions.count()
    await repo.database.historyMetadata.delete(owner)
    await expect(repo.historyDirectory(owner)).rejects.toThrow()
    await expect(repo.load(owner)).rejects.toThrow()
    expect(await repo.database.historyMetadata.get(owner)).toBeUndefined()
    expect(await nativeCurrent(repo, owner)).toEqual(raw)
    expect(await repo.database.historyVersions.count()).toBe(versions)
  })

  it('does not claim unread geometry is valid and strict opening still rejects missing blocks', async () => {
    const repo = repository(), input = fixture(), owner = input.project.document.sceneId
    await repo.save(input, null)
    const raw = await nativeCurrent(repo, owner), geometry = raw.project.fields.find(field => field.path.join('.') === 'document.props')!
    await repo.database.projectContentBlocks.delete(geometry.blocks[0].sha256)
    expect((await repo.projectDirectory()).entries[0]).toMatchObject({ sceneId: owner, issue: null, contentStatus: 'not-checked' })
    expect((await repo.historyDirectory(owner)).history.versions).toHaveLength(1)
    await expect(repo.load(owner)).rejects.toThrow(/内容块/)
    await expect(repo.loadHistoryVersion(owner, (await repo.historyDirectory(owner)).history.activeVersionId!)).rejects.toThrow(/内容块/)
  })

  it('retains a known unreadable title beside readable projects instead of returning a false empty directory', async () => {
    const repo = repository(), broken = fixture(), other = fixture()
    other.project.document.title = 'Independent project'
    await repo.save(broken, null); await repo.save(other, null)
    const raw = await nativeCurrent(repo, broken.project.document.sceneId), title = raw.project.fields.find(field => field.path.join('.') === 'document.title')!
    await repo.database.projectContentBlocks.delete(title.blocks[0].sha256)
    const page = await repo.projectDirectory()
    expect(page.entries.find(row => row.sceneId === broken.project.document.sceneId)).toMatchObject({ summary: null, issue: expect.stringMatching(/内容块/) })
    expect(page.entries.find(row => row.sceneId === other.project.document.sceneId)?.summary?.title).toBe('Independent project')
    expect((await repo.projectDirectory({ query: 'no title can establish absence' })).entries.map(row => row.sceneId)).toEqual([broken.project.document.sceneId])
    expect(await repo.database.projects.count()).toBe(2)
  })

  it('reads branch and pin navigation without invoking project/checkpoint hydration or full usage scans', async () => {
    const repo = repository(), input = fixture(), owner = input.project.document.sceneId
    await repo.save(input, null)
    const root = (await repo.listHistoryVersions(owner)).activeVersionId!
    await repo.createSnapshot(input, 'Kept root', { expectedRevision: 0, expectedMetadataVersion: 0 })
    await repo.save(revision(input, 1), 0)
    await repo.save(revision(input, 2), 1, { historyParentId: root, historyParentHash: (await repo.listHistoryVersions(owner)).versions.find(row => row.id === root)!.contentHash })
    const hydrated: unknown[] = [], read = (value: unknown) => { hydrated.push(value); return value }
    repo.database.projects.hook('reading', read); repo.database.historyVersions.hook('reading', read)
    const directory = await repo.historyDirectory(owner)
    expect(hydrated).toEqual([]); expect(directory.issues).toEqual([])
    expect(directory.history.versions.filter(row => row.parentId === root)).toHaveLength(2)
    expect(directory.snapshots.map(row => row.name)).toEqual(['Kept root'])
    expect(directory.metadataVersion).toBe(1); expect(directory.contentStatus).toBe('not-checked')
    repo.database.projects.hook('reading').unsubscribe(read); repo.database.historyVersions.hook('reading').unsubscribe(read)
  })

  it('reports malformed history metadata and preserves the other readable rows and all stored branches', async () => {
    const repo = repository(), input = fixture(), owner = input.project.document.sceneId
    await repo.save(input, null); await repo.save(revision(input, 1), 0)
    const rows = await repo.database.historyVersions.where('ownerSceneId').equals(owner).toArray(), previous = rows.find(row => row.revision === 0)!
    // Native injection does not inherit repository write hooks or certificates.
    await repo.database.transaction('rw', PROJECT_TABLES, async () => {
      const raw = await repo.database.rawJsonRecord('historyVersions', [owner, previous.id]) as object
      await new Dexie.Promise<void>((resolve, reject) => {
        const request = Dexie.currentTransaction!.idbtrans.objectStore('historyVersions').put({ ...raw, savedAt: 'broken time' })
        request.onsuccess = () => resolve(); request.onerror = () => reject(request.error)
      })
    })
    const directory = await repo.historyDirectory(owner)
    expect(directory.issues.length).toBeGreaterThan(0)
    expect(directory.history.versions.map(row => row.revision)).toEqual([1])
    expect(await repo.database.historyVersions.count()).toBe(2)
    await expect(repo.listHistoryVersions(owner)).rejects.toThrow()
  })
})
