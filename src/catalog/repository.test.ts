import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import { prepareCatalogEntry } from './content'
import { outdoorProject } from '../io/v6/test-fixtures'
import { CatalogConflictError, CatalogRepositoryV1 } from './repository'

const repos: CatalogRepositoryV1[] = [], names = new Set<string>()
const key = (index = 0) => JSON.stringify([1, 'a'.repeat(64), 'prop', `item-${index}`, 1, 'b'.repeat(64)])
const org = { tags: ['手工'], colors: ['蓝'] as ['蓝'], favorite: true }
function repository(name = `catalog-test-${crypto.randomUUID()}`) { const repo = new CatalogRepositoryV1(name); repos.push(repo); names.add(name); return repo }
afterEach(async () => { for (const repo of repos.splice(0)) repo.close(); for (const name of names) await Dexie.delete(name); names.clear() })

describe('independent catalog repository', () => {
  it('commits organization-only records with an independent revision and rejects stale cross-tab batches', async () => {
    const name = `catalog-test-${crypto.randomUUID()}`, first = repository(name), other = repository(name)
    expect((await first.read()).revision).toBe(0)
    await first.commit(0, { organization: [{ key: key(), value: org }] })
    await expect(other.commit(0, { organization: [{ key: key(1), value: org }] })).rejects.toBeInstanceOf(CatalogConflictError)
    const stored = await other.read()
    expect(stored.revision).toBe(1); expect(stored.entries).toEqual([])
    expect(Object.keys(stored.organizations)).toEqual([key()])
  })

  it('rejects accessors, duplicate targets, >64 targets and cancellation without any write', async () => {
    const repo = repository()
    let called = false
    const mutation = Object.defineProperty({}, 'organization', { enumerable: true, get() { called = true; return [] } })
    await expect(repo.commit(0, mutation)).rejects.toThrow(); expect(called).toBe(false)
    await expect(repo.commit(0, { organization: [{ key: key(), value: org }, { key: key(), value: org }] })).rejects.toThrow('重复')
    await expect(repo.commit(0, { organization: Array.from({ length: 65 }, (_, index) => ({ key: key(index), value: org })) })).rejects.toThrow('1–64')
    const controller = new AbortController(); controller.abort()
    await expect(repo.commit(0, { organization: [{ key: key(), value: org }] }, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(await repo.read()).toMatchObject({ revision: 0, entries: [], organizations: {} })
  })

  it('rolls back all writes on storage failure and removes only explicit personal records', async () => {
    const repo = repository()
    await repo.commit(0, { organization: [{ key: key(), value: org }, { key: key(1), value: org }] })
    const db = (repo as unknown as { db: Dexie }).db
    const failWrite = () => { throw new Error('simulated disk failure') }
    db.table('metadata').hook('updating', failWrite)
    await expect(repo.commit(1, { remove: [key()] })).rejects.toThrow('simulated disk failure')
    expect(Object.keys((await repo.read()).organizations)).toHaveLength(2)
    db.table('metadata').hook('updating').unsubscribe(failWrite)
    const after = await repo.commit(1, { remove: [key()] })
    expect(Object.keys(after.organizations)).toEqual([key(1)]); expect(after.revision).toBe(2)
  })

  it('validates complete fixed content before atomic entry/organization commits', async () => {
    const repo = repository(), entry = await prepareCatalogEntry(await outdoorProject(1), { kind: 'prop', definitionId: 'scatter-definition' })
    const installed = await repo.commit(0, { put: [entry], organization: [{ key: entry.item.identity.key, value: org }] })
    expect(installed.entries).toHaveLength(1); expect((await repo.load(entry.item.identity.key)).capsuleSha256).toBe(entry.capsuleSha256)
    const tampered = structuredClone(entry); tampered.item.name = 'tampered fixed metadata'
    await expect(repo.commit(1, { put: [tampered], organization: [{ key: key(9), value: org }] })).rejects.toThrow()
    expect((await repo.read()).revision).toBe(1); expect((await repo.read()).organizations[key(9)]).toBeUndefined()
    const conflictingKey = JSON.stringify([1, 'a'.repeat(64), 'prop', 'item-0', 1, 'c'.repeat(64)])
    await repo.commit(1, { organization: [{ key: key(), value: org }] })
    await expect(repo.commit(2, { organization: [{ key: conflictingKey, value: org }] })).rejects.toThrow('冲突')
    expect((await repo.read()).revision).toBe(2)
  })

  it('does not reopen an orphan connection when closed during the initial asynchronous read', async () => {
    const repo = repository(), pending = repo.read()
    repo.close()
    await expect(pending).rejects.toThrow('关闭')
    expect((repo as unknown as { db: Dexie }).db.isOpen()).toBe(false)
    await expect(repo.read()).rejects.toThrow('关闭')
  })

  it('refuses unknown future databases without changing their version or stores', async () => {
    const name = `catalog-test-${crypto.randomUUID()}`, future = new Dexie(name); names.add(name)
    future.version(2).stores({ foreign: 'id' }); await future.open(); future.close()
    const repo = repository(name)
    await expect(repo.read()).rejects.toThrow('不支持')
    const probe = new Dexie(name); await probe.open(); expect(probe.verno).toBe(2); expect(probe.tables.map(table => table.name)).toEqual(['foreign']); probe.close()
  })
})
