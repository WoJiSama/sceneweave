import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import { svgFixtureValidation, svgProjectFixture, SVG_FIXTURE_SOURCE } from '../../../../tests/helpers/m24-svg-fixtures'
import { ProjectRepository } from './repository'
import { cloneJson } from '../../../shared/validation/json'
import { decodeUtf8 } from '../../../shared/project/binary'

const repositories: ProjectRepository[] = [], names = new Set<string>()
let sequence = 0
function repository(name = `m24-svg-${crypto.randomUUID()}`) {
  names.add(name)
  const repo = new ProjectRepository({ name, validation: svgFixtureValidation(), runtime: { ids: { nextId: () => `svg-db-${++sequence}` }, clock: { now: () => '2026-10-24T00:00:00.000Z' } } })
  repositories.push(repo); return repo
}
afterEach(async () => { for (const repo of repositories.splice(0)) repo.close(); for (const name of names) await Dexie.delete(name); names.clear() })

describe('complete project repository SVG preservation', () => {
  it('cold-loads real source bytes and correct hash bindings with current, automatic and named history', async () => {
    const { bundle, bytes, normalized } = svgProjectFixture(), repo = repository(), owner = bundle.project.document.sceneId
    await repo.save(bundle, null)
    const snapshot = await repo.createSnapshot(bundle, 'SVG original', { expectedRevision: 0, expectedMetadataVersion: 0 })
    const newer = { project: cloneJson(bundle.project), resources: bundle.resources }; newer.project.document.revision = 1
    await repo.save(newer, 0)
    const reopened = repository(repo.database.name), loaded = (await reopened.load(owner))!
    expect(loaded.project.authoringSources).toEqual(bundle.project.authoringSources)
    for (const [hash, value] of bytes) expect(await loaded.resources.read(hash)).toEqual(value)
    const bindings = await reopened.database.resourceBindings.toArray()
    expect(bindings.every(row => row.sourceHashes.length === 2 && row.sourceHashes.includes(normalized.sourceSha256) && !row.sourceHashes.includes('image'))).toBe(true)
    expect(decodeUtf8(await (await reopened.loadSnapshot(owner, snapshot.id))!.bundle.resources.read(normalized.sourceSha256))).toBe(SVG_FIXTURE_SOURCE)
    expect(decodeUtf8(await (await reopened.loadAutomaticSnapshot(owner, 0))!.resources.read(normalized.sourceSha256))).toBe(SVG_FIXTURE_SOURCE)
  })

  it('refuses damaged or missing SVG source bytes on cold-load without replacing stored project data', async () => {
    for (const mode of ['missing', 'changed'] as const) {
      const { bundle, normalized } = svgProjectFixture(), repo = repository(), owner = bundle.project.document.sceneId
      await repo.save(bundle, null)
      const before = await repo.database.projects.get(owner)
      if (mode === 'missing') await repo.database.resources.delete(normalized.sourceSha256)
      else await repo.database.resources.put({ sha256: normalized.sourceSha256, bytes: new Uint8Array([0]) })
      await expect(repository(repo.database.name).load(owner)).rejects.toThrow(/资源/)
      expect(await repo.database.projects.get(owner)).toEqual(before)
    }
  })
})
