import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { expect, it } from 'vitest'
import { fixture, runtime, validation } from '../../../application/workspace/test-fixtures.js'
import type { ProjectBundle } from '../../../shared/model/project.js'
import { ProjectRepository } from './repository.js'

function revision(bundle: ProjectBundle, value: number): ProjectBundle {
  const project = structuredClone(bundle.project)
  project.document.revision = value
  project.document.title = `Revision ${value}`
  return { project, resources: bundle.resources }
}

function connect() {
  const name = `maintenance-${crypto.randomUUID()}`
  const first = new ProjectRepository({ name, runtime, validation }), second = new ProjectRepository({ name, runtime, validation })
  return { first, second, close: async () => { first.close(); second.close(); await Dexie.delete(name) } }
}

it('removes one corrupt owner by exact keys and only reclaims resources after proving the remaining owners', async () => {
  const { first, second, close } = connect()
  try {
    const damaged = fixture({ image: true }), healthy = fixture()
    const damagedId = damaged.project.document.sceneId, healthyId = healthy.project.document.sceneId
    await first.save(damaged, null); await first.save(healthy, null)
    const sha = damaged.project.document.assets.image.sha256
    const existing = (await first.database.resources.get(sha))!
    existing.bytes[0] ^= 1
    await first.database.resources.put(existing)
    first.close()
    expect((await second.load(healthyId))?.project).toEqual(healthy.project)
    await expect(second.save(revision(healthy, 1), 0)).rejects.toThrow(/资源字节hash损坏/)
    const review = await second.reviewProjectMaintenance(damagedId, 0)
    await second.removeProject(review)
    expect(await second.load(damagedId)).toBeNull()
    expect(await second.database.resources.get(sha)).toEqual(existing)
    const collected = await second.reclaimProjectStorage()
    expect(collected.resourceCount).toBe(1)
    expect(collected.blockCount).toBeGreaterThan(0)
    expect(await second.database.resources.get(sha)).toBeUndefined()
    await second.save(revision(healthy, 1), 0)
    expect((await second.load(healthyId))?.project).toEqual(revision(healthy, 1).project)
  } finally { await close() }
})

it('invalidates confirmation on another tab and proves shared image bytes before removing any resource', async () => {
  const { first, second, close } = connect()
  try {
    const a = fixture({ image: true }), b = fixture({ image: true })
    const aId = a.project.document.sceneId, bId = b.project.document.sceneId
    const sha = a.project.document.assets.image.sha256
    await first.save(a, null); await first.save(b, null)
    const stale = await first.reviewProjectMaintenance(aId, 0)
    await second.save(revision(a, 1), 0)
    await expect(first.removeProject(stale)).rejects.toThrow(/重新打开确认/)
    expect((await first.load(aId))?.project.document.revision).toBe(1)
    await first.removeProject(await first.reviewProjectMaintenance(aId, 1))
    const result = await first.reclaimProjectStorage()
    expect(result.resourceCount).toBe(0)
    expect(await first.database.resources.get(sha)).toBeDefined()
    expect((await second.load(bId))?.project).toEqual(b.project)
  } finally { await close() }
})

it('cuts discarded history without changing the active or pinned version contents', async () => {
  const { first, second, close } = connect()
  try {
    const input = fixture(), owner = input.project.document.sceneId
    await first.save(input, null)
    await first.save(revision(input, 1), 0)
    const pinned = await first.createSnapshot(revision(input, 1), 'Keep this', { expectedRevision: 1, expectedMetadataVersion: 0 })
    for (let value = 2; value <= 8; value++) await first.save(revision(input, value), value - 1)
    const previous = await first.listHistoryVersions(owner)
    const usage = await first.usage(owner)
    const review = await first.reviewProjectMaintenance(owner, 8)
    await expect(first.trimProjectHistory(review)).resolves.toBe(7)
    const next = await second.listHistoryVersions(owner)
    expect(next.activeVersionId).toBe(previous.activeVersionId)
    expect(next.versions.map(row => [row.revision, row.parentId])).toEqual([[8, null], [1, null]])
    expect((await second.loadSnapshot(owner, pinned.id))?.bundle.project).toEqual(revision(input, 1).project)
    expect((await second.usage(owner)).documentBytes).toBeLessThan(usage.documentBytes)
    await second.save(revision(input, 9), 8)
    expect((await second.load(owner))?.project).toEqual(revision(input, 9).project)
  } finally { await close() }
})
