import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { outdoorProject } from '../../../io/v6/test-fixtures'
import { createCompositionContent } from '../../../shared/appearance/graph.js'
import type { SceneDocument } from '../../../shared/model/scene.js'
import type { CompleteValidationOptions } from '../../../shared/ports/resources.js'
import { createMemoryResources } from '../../../shared/project/resources.js'
import { prepareLibraryEntry } from '../../../shared/library/content.js'
import type { CatalogOrganization, PreparedLibraryEntry } from '../../../shared/library/types.js'
import { CONVERTER_VERSION } from '../../../shared/migration/types.js'
import { exportMigrationSet, importMigrationSet } from '../../../shared/migration/set.js'
import { canonicalJson, cloneJson, encodeUtf8 } from '../../../shared/validation/json.js'
import { sha256Bytes } from '../../../shared/project/binary.js'
import { LibraryDatabase, LIBRARY_DATABASE_NAME, LIBRARY_TABLES } from './database.js'
import { LibraryConflictError, LibraryConversionConflictError, LibraryRepository, type LibraryConversionInput, type LibraryConversionJob, type OrganizationPolicy } from './repository.js'

const NOW = '2026-10-24T00:00:00.000Z'
const repos: LibraryRepository[] = [], names = new Set<string>()
let sequence = 0
const validation: CompleteValidationOptions = { images: {
  async decode() { throw new Error('Symbol-only repository tests must not decode') },
  async transform() { throw new Error('Storage must not transform') }, async encodePng() { throw new Error('Storage must not encode') },
} }
function repository(name = `m20e-library-${crypto.randomUUID()}`) {
  names.add(name)
  const repo = new LibraryRepository({ name, validation, runtime: { ids: { nextId: () => `library-id-${++sequence}` }, clock: { now: () => NOW } } })
  repos.push(repo); return repo
}
const key = (value = 0, content = 'b') => JSON.stringify([1, 'a'.repeat(64), 'prop', `item-${value}`, 1, content.repeat(64)])
const org: CatalogOrganization = { tags: ['  手工 素材  ', 'Ｂ'], colors: ['蓝', '红'], favorite: true }
async function entry(index = 0): Promise<PreparedLibraryEntry> {
  const legacy = await outdoorProject(1), document = { ...cloneJson(legacy.document), format: 'sceneweave-scene', schemaVersion: 1 } as SceneDocument
  const definition = document.propDefinitions['scatter-definition']
  definition.catalogId = `storage-fixture-${index}`; definition.name = `Symbol ${index}`
  document.propDefinitions = { [definition.id]: definition }
  for (const prop of Object.values(document.props)) prop.definitionRef = { id: definition.id, version: definition.version }
  const content = createCompositionContent(document, { ids: { nextId: () => `fixture-token-${++sequence}` }, clock: { now: () => NOW } })
  return prepareLibraryEntry({ project: { format: 'sceneweave-complete-project', schemaVersion: 1, ...content, authoringSources: {}, assets: {}, licenses: legacy.licenses,
    licenseBindings: legacy.licenseBindings.map(row => ({ ...row, subjectId: definition.id })) }, resources: createMemoryResources({}) }, { kind: 'prop', definitionId: definition.id }, validation)
}
async function reserve(repo: LibraryRepository, entries: PreparedLibraryEntry[] = [], organizations: Record<string, CatalogOrganization> = {}, policy: OrganizationPolicy = 'replace-selected') {
  const sourceContentHashes = { source: 'c'.repeat(64) }
  const input: LibraryConversionInput = { entries, organizations, sourceContentHashes, organizationPolicy: policy }
  let job = await repo.reserveConversion({ sourceRepository: 'sceneweave-catalog-v1', scopeId: 'catalog', sourceFingerprint: 'd'.repeat(64), entryKeys: entries.map(row => row.item.identity.key), organizationKeys: Object.keys(organizations), sourceContentHashes })
  const bytes = encodeUtf8('{"id":"catalog","revision":0}')
  const set = await exportMigrationSet({ setId: job.jobId, createdAt: NOW, converterVersion: CONVERTER_VERSION,
    scope: { kind: 'catalog', repository: job.sourceRepository, sourceSceneId: null }, sourceFingerprint: job.sourceFingerprint,
    records: [{ role: 'catalog-metadata', recordKey: 'catalog', sourceFormat: 'catalog-v1', contentHash: sourceContentHashes.source, bytes }] })
  const reread = await importMigrationSet(set.index, set.volumes)
  job = await repo.advanceConversion(job.jobId, job.jobVersion, 'backup-verified', { backupReceipt: reread.receipt })
  return { job, input, receipt: reread.receipt }
}
async function committed(repo: LibraryRepository, entries: PreparedLibraryEntry[] = [], organizations: Record<string, CatalogOrganization> = {}, policy: OrganizationPolicy = 'replace-selected') {
  const prepared = await reserve(repo, entries, organizations, policy)
  let job = await repo.prepareConversion(prepared.job.jobId, prepared.job.jobVersion, prepared.input)
  job = await repo.commitConversion(job.jobId, job.jobVersion, prepared.input)
  return { job, input: prepared.input }
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
    expect(LIBRARY_DATABASE_NAME).toBe('sceneweave-library')
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
  it('requires a true full-re-read receipt and fixes reservation scope without trusting clones', async () => {
    const repo = repository(), input = { sourceRepository: 'sceneweave-catalog-v1', scopeId: 'catalog', sourceFingerprint: 'e'.repeat(64), entryKeys: [], organizationKeys: [key()], sourceContentHashes: { source: 'f'.repeat(64) } }
    const first = await repo.reserveConversion(input), again = await repo.reserveConversion(input)
    expect(again.jobId).toBe(first.jobId)
    await expect(repo.reserveConversion({ ...input, organizationKeys: [] })).rejects.toThrow('固定范围')
    await expect(repo.advanceConversion(first.jobId, 0, 'backup-verified', { backupReceipt: { setId: first.jobId, sourceFingerprint: first.sourceFingerprint } })).rejects.toThrow('backupReceipt')
    expect((await repo.getJob(first.jobId))!.stage).toBe('captured')
    const good = await reserve(repo, [], { [key(1)]: org })
    await expect(repo.advanceConversion(good.job.jobId, 0, 'backup-verified', { backupReceipt: structuredClone(good.receipt) })).rejects.toThrow()
  })
  it('bounds fullscope reservations at512 entries and2048 organizations without changing ordinary64 batches', async () => {
    const repo = repository(), input = { sourceRepository: 'sceneweave-catalog-v1', scopeId: 'catalog', sourceFingerprint: 'e'.repeat(64), entryKeys: Array.from({ length: 512 }, (_, index) => key(index)), organizationKeys: Array.from({ length: 2048 }, (_, index) => key(index)), sourceContentHashes: {} }
    const job = await repo.reserveConversion(input)
    expect(job.entryKeys).toHaveLength(512); expect(job.organizationKeys).toHaveLength(2048)
    await expect(repo.reserveConversion({ ...input, sourceFingerprint: 'f'.repeat(64), entryKeys: [...input.entryKeys, key(512)] })).rejects.toThrow('保护值')
    await expect(repo.reserveConversion({ ...input, sourceFingerprint: 'f'.repeat(64), organizationKeys: [...input.organizationKeys, key(2048)] })).rejects.toThrow('保护值')
    expect(await repo.database.conversionJobs.count()).toBe(1)
    expect((await repo.read()).revision).toBe(0)
  })
  it('stages privately, cold validates all rows and publishes one exact fullscope beyond normal64 including 2048 organization-only keys', async () => {
    const repo = repository(), entries = await Promise.all(Array.from({ length: 65 }, (_, index) => entry(index)))
    const orgs = Object.fromEntries(Array.from({ length: 2048 }, (_, index) => [key(index), org]))
    const { job } = await committed(repo, entries, orgs)
    expect(await repo.read()).toEqual({ revision: 0, entries: [], organizations: {} })
    expect(await repo.database.conversionStaging.count()).toBe(2113)
    const cold = await repository(repo.database.name).readConversion(job.jobId)
    expect(cold.entries).toHaveLength(65); expect(Object.keys(cold.organizations)).toHaveLength(2048)
    const published = await repo.publishConversion(job.jobId, job.jobVersion)
    expect(published.revision).toBe(1); expect(published.entries).toHaveLength(65); expect(Object.keys(published.organizations)).toHaveLength(2048)
    expect(await repo.database.conversionStaging.count()).toBe(0)
    expect((await repo.getJob(job.jobId))!.stage).toBe('verified')
    await repo.commit(1, { organization: [{ key: key(), value: { ...org, favorite: false } }] })
    expect((await repo.publishConversion(job.jobId, job.jobVersion)).organizations[key()].favorite).toBe(false)
    expect((await repo.read()).revision).toBe(2)
  }, 30_000)
  it('requires all reserved entries/organizations and identical prepared candidates', async () => {
    const repo = repository(), one = await entry(), two = await entry(1), setup = await reserve(repo, [one, two], { [key()]: org })
    await expect(repo.prepareConversion(setup.job.jobId, setup.job.jobVersion, { ...setup.input, entries: [one] })).rejects.toThrow('全部')
    await expect(repo.prepareConversion(setup.job.jobId, setup.job.jobVersion, { ...setup.input, organizations: {} })).rejects.toThrow('全部')
    const prepared = await repo.prepareConversion(setup.job.jobId, setup.job.jobVersion, setup.input)
    await expect(repo.commitConversion(prepared.jobId, prepared.jobVersion, { ...setup.input, organizationPolicy: 'keep-local' })).rejects.toThrow('prepared')
    expect(await repo.database.conversionStaging.count()).toBe(0)
    expect((await repo.read()).revision).toBe(0)
  })
  it('keeps public content untouched on corrupt cold reads and a failed atomic publish', async () => {
    const repo = repository(), one = await entry(), setup = await committed(repo, [one], { [key()]: org })
    const stagedKey: [string, string, string] = [setup.job.jobId, 'entry', one.item.identity.key]
    const stored = (await repo.database.conversionStaging.get(stagedKey))!
    if (stored.kind !== 'entry') throw new Error('fixture kind')
    const original = structuredClone(stored); stored.value.entry.capsule[0] ^= 1
    await repo.database.conversionStaging.put(stored)
    await expect(repo.publishConversion(setup.job.jobId, setup.job.jobVersion)).rejects.toThrow('字节')
    expect((await repo.read()).revision).toBe(0)
    await repo.database.conversionStaging.put(original)
    const failure = () => { throw new Error('injected final publish failure') }
    repo.database.conversionJobs.hook('updating', failure)
    await expect(repo.publishConversion(setup.job.jobId, setup.job.jobVersion)).rejects.toThrow('injected')
    repo.database.conversionJobs.hook('updating').unsubscribe(failure)
    expect(await repo.read()).toEqual({ revision: 0, entries: [], organizations: {} })
    expect(await repo.database.conversionStaging.count()).toBe(2)
    expect((await repo.getJob(setup.job.jobId))!.stage).toBe('committed')
    await repo.publishConversion(setup.job.jobId, setup.job.jobVersion)
  })
  it('cancels with public data intact, resumes fixed staging and resets only private stale staging on explicit retry', async () => {
    const repo = repository(), setup = await committed(repo, [], { [key()]: org })
    const cancelled = await repo.advanceConversion(setup.job.jobId, setup.job.jobVersion, 'cancelled')
    expect(await repo.read()).toEqual({ revision: 0, entries: [], organizations: {} })
    const resumed = await repo.retryConversion(cancelled.jobId, cancelled.jobVersion)
    expect(resumed.stage).toBe('committed'); expect(resumed.jobId).toBe(setup.job.jobId)
    await repo.commit(0, { organization: [{ key: key(9), value: org }] })
    await expect(repo.publishConversion(resumed.jobId, resumed.jobVersion)).rejects.toBeInstanceOf(LibraryConflictError)
    const failed = await repo.advanceConversion(resumed.jobId, resumed.jobVersion, 'failed', { failure: 'target changed' })
    const retry = await repo.retryConversion(failed.jobId, failed.jobVersion)
    expect(retry.jobId).toBe(resumed.jobId); expect(retry.stage).toBe('captured'); expect(retry.organizationKeys).toEqual([key()])
    expect(retry.organizationPolicy).toBe('replace-selected')
    expect(await repo.database.conversionStaging.count()).toBe(0)
    expect((await repo.read()).organizations).toEqual({ [key(9)]: org })
  })
  it('retains the frozen organization policy after prepared cancellation and rejects a different retry policy', async () => {
    const repo = repository(), setup = await reserve(repo, [], { [key()]: org }, 'replace-selected')
    const prepared = await repo.prepareConversion(setup.job.jobId, setup.job.jobVersion, setup.input)
    const cancelled = await repo.advanceConversion(prepared.jobId, prepared.jobVersion, 'cancelled')
    const retry = await repo.retryConversion(cancelled.jobId, cancelled.jobVersion)
    expect(retry.stage).toBe('captured'); expect(retry.jobId).toBe(prepared.jobId)
    expect(retry.organizationPolicy).toBe('replace-selected'); expect(retry.organizationKeys).toEqual([key()])
    const verified = await repo.advanceConversion(retry.jobId, retry.jobVersion, 'backup-verified', { backupReceipt: setup.receipt })
    await expect(repo.prepareConversion(verified.jobId, verified.jobVersion, { ...setup.input, organizationPolicy: 'keep-local' })).rejects.toThrow('策略已冻结')
    expect((await repo.getJob(verified.jobId))!.stage).toBe('backup-verified')
    expect((await repo.prepareConversion(verified.jobId, verified.jobVersion, setup.input)).organizationPolicy).toBe('replace-selected')
  })
  it('keeps outside-scope organization, applies explicit keep/replace policy and reuses exact installed bytes', async () => {
    for (const policy of ['keep-local', 'replace-selected'] as const) {
      const repo = repository(), one = await entry(), local = { ...org, favorite: false }
      await repo.commit(0, { put: [one], organization: [{ key: key(), value: local }, { key: key(9), value: local }] })
      const setup = await committed(repo, [one], { [key()]: org }, policy)
      const result = await repo.publishConversion(setup.job.jobId, setup.job.jobVersion)
      expect(result.entries).toHaveLength(1); expect(result.organizations[key()]).toEqual(policy === 'keep-local' ? local : org)
      expect(result.organizations[key(9)]).toEqual(local)
      expect((await repo.load(one.item.identity.key)).capsule).toEqual(one.capsule)
    }
  })
  it('fully cold validates reused exact-key capsules before idempotent writes or final publication', async () => {
    const repo = repository(), one = await entry(), different = await entry(1)
    await repo.commit(0, { put: [one] })
    const setup = await committed(repo, [one], {})
    const row = (await repo.database.entries.get(one.item.identity.key))!, original = structuredClone(row)
    // The ZIP and its byte hash are valid, but they carry another fixed root.
    row.entry.capsule = different.capsule; row.entry.capsuleSha256 = different.capsuleSha256
    await repo.database.entries.put(row)
    await expect(repo.commit(1, { put: [one] })).rejects.toThrow()
    await expect(repo.publishConversion(setup.job.jobId, setup.job.jobVersion)).rejects.toThrow()
    expect((await repo.getJob(setup.job.jobId))!.stage).toBe('committed')
    expect((await repo.read()).revision).toBe(1)
    expect((await repo.database.entries.get(one.item.identity.key))!.entry.capsuleSha256).toBe(different.capsuleSha256)
    await repo.database.entries.put(original)
    expect((await repo.publishConversion(setup.job.jobId, setup.job.jobVersion)).revision).toBe(2)
  })
  it('captures stage patches before awaiting open and never invokes a later replacement getter', async () => {
    const repo = repository(), setup = await reserve(repo, [], {})
    let invoked = false
    const patch = { failure: 'captured reason' }
    const pending = repo.advanceConversion(setup.job.jobId, setup.job.jobVersion, 'failed', patch)
    Object.defineProperty(patch, 'failure', { enumerable: true, get() { invoked = true; return 'late reason' } })
    const failed = await pending
    expect(failed.failure).toBe('captured reason'); expect(invoked).toBe(false)
  })
  it('counts existing private staging toward every write budget and rolls failed staging back atomically', async () => {
    const repo = repository(), setup = await reserve(repo, [await entry()], {})
    const budgetSpy = vi.spyOn(repo as unknown as { stagedBytes(): Promise<number> }, 'stagedBytes').mockResolvedValue(128 * 1024 * 1024)
    await expect(repo.prepareConversion(setup.job.jobId, setup.job.jobVersion, setup.input)).rejects.toThrow('128MiB')
    expect((await repo.getJob(setup.job.jobId))!.stage).toBe('backup-verified')
    budgetSpy.mockRestore()
    const prepared = await repo.prepareConversion(setup.job.jobId, setup.job.jobVersion, setup.input)
    const failure = () => { throw new Error('injected staging failure') }
    repo.database.conversionJobs.hook('updating', failure)
    await expect(repo.commitConversion(prepared.jobId, prepared.jobVersion, setup.input)).rejects.toThrow('injected')
    repo.database.conversionJobs.hook('updating').unsubscribe(failure)
    expect(await repo.database.conversionStaging.count()).toBe(0)
    expect((await repo.getJob(prepared.jobId))!.stage).toBe('prepared')
    await repo.commitConversion(prepared.jobId, prepared.jobVersion, setup.input)
    expect(await (repo as unknown as { stagedBytes(): Promise<number> }).stagedBytes()).toBe(setup.input.entries[0].capsule.length)
    const writeBudgetSpy = vi.spyOn(repo as unknown as { stagedBytes(): Promise<number> }, 'stagedBytes').mockResolvedValue(128 * 1024 * 1024)
    await expect(repo.commit(0, { put: [await entry(1)] })).rejects.toThrow('128MiB')
    writeBudgetSpy.mockRestore()
    expect((await repo.read()).entries).toHaveLength(0)
  })
  it('refuses stale journal CAS and closing during asynchronous open without leaving an orphan connection', async () => {
    const repo = repository(), initial = await reserve(repo, [], { [key()]: org })
    await expect(repo.advanceConversion(initial.job.jobId, 0, 'cancelled')).rejects.toBeInstanceOf(LibraryConversionConflictError)
    expect(canonicalJson((await repo.getJob(initial.job.jobId))!.sourceContentHashes)).toBe(canonicalJson(initial.input.sourceContentHashes))
    const closed = repository(), reading = closed.read(); closed.close()
    await expect(reading).rejects.toThrow('关闭'); expect(closed.database.isOpen()).toBe(false)
    await expect(closed.read()).rejects.toThrow('关闭')
  })
})
