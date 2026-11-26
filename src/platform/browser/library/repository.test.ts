import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { outdoorProject } from '../../../../tests/helpers/current-project-fixtures.js'
import type { CompleteValidationOptions } from '../../../shared/ports/resources.js'
import { prepareLibraryEntry } from '../../../shared/library/content.js'
import type { CatalogOrganization, PreparedLibraryEntry } from '../../../shared/library/types.js'
import { sha256Bytes } from '../../../shared/project/binary.js'
import { LibraryDatabase, LIBRARY_DATABASE_NAME, LIBRARY_TABLES } from './database.js'
import { LibraryConflictError, LibraryRepository } from './repository.js'

const repos: LibraryRepository[] = [], names = new Set<string>()
const validation: CompleteValidationOptions = { images: {
  async decode() { throw new Error('Symbol-only repository tests must not decode') },
  async transform() { throw new Error('Storage must not transform') }, async encodePng() { throw new Error('Storage must not encode') },
} }
function repository(name = `m20e-library-${crypto.randomUUID()}`) {
  names.add(name)
  const repo = new LibraryRepository({ name, validation })
  repos.push(repo); return repo
}
const key = (value = 0, content = 'b') => JSON.stringify([1, 'a'.repeat(64), 'prop', `item-${value}`, 1, content.repeat(64)])
const org: CatalogOrganization = { tags: ['  手工 素材  ', 'Ｂ'], colors: ['蓝', '红'], favorite: true }
async function entry(index = 0): Promise<PreparedLibraryEntry> {
  const bundle = outdoorProject(1), definition = bundle.project.document.propDefinitions['scatter-definition']
  definition.catalogId = `storage-fixture-${index}`; definition.name = `Symbol ${index}`
  return prepareLibraryEntry(bundle, { kind: 'prop', definitionId: definition.id }, validation)
}
afterEach(async () => {
  vi.restoreAllMocks()
  for (const repo of repos.splice(0)) repo.close()
  for (const name of names) await Dexie.delete(name)
  names.clear()
})

describe('native complete-v1 library repository', () => {
  it('creates only on use, has the exact five schema1 stores and refuses old/future database meanings', async () => {
    const repo = repository()
    expect((await indexedDB.databases()).map(row => row.name)).not.toContain(repo.database.name)
    expect(LIBRARY_DATABASE_NAME).toBe('sceneweave-library-dev-v1')
    await repo.read()
    expect(repo.database.backendDB().version).toBe(10)
    expect(repo.database.tables.map(row => row.name).sort()).toEqual([...LIBRARY_TABLES].sort())
    expect(repo.database.table('entries').schema.indexes[0].unique).toBe(true)
    expect(repo.database.table('conversionJobs').schema.indexes[0].unique).toBe(true)
    for (const name of ['sceneweave-m0', 'sceneweave-m1-outdoor', 'sceneweave-catalog-v1', 'sceneweave-projects']) expect(() => repository(name)).toThrow('不能')
    const foreignName = `m20e-foreign-${crypto.randomUUID()}`; names.add(foreignName)
    const foreign = new Dexie(foreignName); foreign.version(2).stores({ foreign: 'id' }); await foreign.open(); foreign.close()
    await expect(repository(foreignName).read()).rejects.toThrow('结构')
    const probe = new Dexie(foreignName); await probe.open(); expect(probe.verno).toBe(2); expect(probe.tables.map(row => row.name)).toEqual(['foreign']); probe.close()
  })
  it('aborts a lower-version foreign database appearing between inspect and Dexie open', async () => {
    const name = `m20e-race-${crypto.randomUUID()}`; names.add(name)
    const foreign = new Dexie(name); foreign.version(.1).stores({ external: 'id' }); await foreign.open(); await foreign.table('external').add({ id: 'keep', value: 'original' }); foreign.close()
    const candidate = new LibraryDatabase(name)
    try { await expect(candidate.open()).rejects.toThrow('不支持升级') } finally { candidate.close() }
    const probe = new Dexie(name); await probe.open(); expect(probe.backendDB().version).toBe(1); expect(await probe.table('external').toArray()).toEqual([{ id: 'keep', value: 'original' }]); probe.close()
  })
  it('uses independent revision CAS across connections, keeps exact display text and rolls back all public writes', async () => {
    const first = repository(), other = repository(first.database.name)
    await first.commit(0, { organization: [{ key: key(), value: org }] })
    await expect(other.commit(0, { organization: [{ key: key(1), value: org }] })).rejects.toBeInstanceOf(LibraryConflictError)
    expect((await first.read()).organizations[key()]).toEqual(org)
    const fail = () => { throw new Error('injected transaction failure') }
    first.database.metadata.hook('updating', fail)
    await expect(first.commit(1, { remove: [key()] })).rejects.toThrow('injected')
    first.database.metadata.hook('updating').unsubscribe(fail)
    expect(await first.read()).toMatchObject({ revision: 1, organizations: { [key()]: org } })
    const outcomes = await Promise.allSettled([first.commit(1, { organization: [{ key: key(1), value: org }] }), other.commit(1, { organization: [{ key: key(2), value: org }] })])
    expect(outcomes.filter(row => row.status === 'fulfilled')).toHaveLength(1)
    expect((await first.read()).revision).toBe(2)
  })
  it('captures real capsule bytes before await, fully rereads content and refuses metadata/hash forgery', async () => {
    const repo = repository(), original = await entry(), expected = original.capsule.slice()
    const pending = repo.commit(0, { put: [original] })
    original.capsule.fill(0); original.item.name = 'caller changed'
    await pending
    const loaded = await repo.load((await repo.read()).entries[0].item.identity.key)
    expect(loaded.capsule).toEqual(expected); expect(loaded.item.name).not.toBe('caller changed')
    loaded.capsule.fill(0)
    expect(sha256Bytes((await repo.load(loaded.item.identity.key)).capsule)).toBe(loaded.capsuleSha256)
    const tampered = await repo.load(loaded.item.identity.key); tampered.item.name = 'forged fixed metadata'
    await expect(repo.commit(1, { put: [tampered] })).rejects.toThrow()
    const bad = await repo.load(loaded.item.identity.key); bad.capsule[0] ^= 1
    await expect(repo.commit(1, { put: [bad] })).rejects.toThrow(/字节|摘要/)
    expect((await repo.read()).revision).toBe(1)
  })
  it('rejects accessors, unknown fields, duplicates, over64 targets, cancellation and logical rebinding', async () => {
    const repo = repository(); let invoked = false
    const accessor = Object.defineProperty({}, 'organization', { enumerable: true, get() { invoked = true; return [] } })
    await expect(repo.commit(0, accessor)).rejects.toThrow(); expect(invoked).toBe(false)
    await expect(repo.commit(0, { organization: [{ key: key(), value: org }, { key: key(), value: org }] })).rejects.toThrow('重复')
    await expect(repo.commit(0, { organization: Array.from({ length: 65 }, (_, i) => ({ key: key(i), value: org })) })).rejects.toThrow()
    const controller = new AbortController(); controller.abort()
    await expect(repo.commit(0, { organization: [{ key: key(), value: org }] }, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    await repo.commit(0, { organization: [{ key: key(), value: org }] })
    await expect(repo.commit(1, { organization: [{ key: key(0, 'c'), value: org }] })).rejects.toThrow('冲突')
    expect(await repo.read()).toMatchObject({ revision: 1, entries: [] })
  })
  it('closes safely during asynchronous open', async () => {
    const repo = repository()
    const opening = repo.open()
    repo.close()
    await expect(opening).rejects.toThrow('已关闭')
    expect(repo.database.isOpen()).toBe(false)
  })
})
