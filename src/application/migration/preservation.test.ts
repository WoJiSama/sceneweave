import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { emptyProject } from '../../io/v6/test-fixtures'
import { exportProjectV6 } from '../../io/v6/project-file'
import { captureLegacyFile } from '../../compat/legacy/file'
import { captureLegacyFamily, LEGACY_DATABASES } from '../../compat/legacy/capture'
import { captureLegacyCatalog, LEGACY_CATALOG_DATABASE } from '../../compat/legacy/catalog'
import { exportMigrationSet, importMigrationSet } from '../../shared/migration/set'
import { CONVERTER_VERSION } from '../../shared/migration/types'
import { ProjectRepository } from '../../platform/browser/storage/repository'
import { LibraryRepository } from '../../platform/browser/library/repository'
import { SceneRepositoryV6 } from '../../io/v6/storage'
import type { CatalogOrganization } from '../../shared/library/types'
import type { CompleteValidationOptions } from '../../shared/ports/resources'
import { cloneJson } from '../../shared/validation/json'
import { beginPreservedProjectConversion, beginPreservedLibraryConversion } from './preservation'
import { continueProjectConversion } from './conversion'
import { continueLibraryConversion } from './library-conversion'

const stamp = '2026-10-24T00:00:00.000Z'
const validation: CompleteValidationOptions = { images: {
  async decode() { throw new Error('No images in preservation reopening fixtures.') },
  async transform() { throw new Error('No image transform in preservation reopening fixtures.') },
  async encodePng() { throw new Error('No image encoding in preservation reopening fixtures.') },
} }
const databases: (ProjectRepository | LibraryRepository)[] = [], names: string[] = []
function runtime(prefix: string) { let sequence = 0; return { ids: { nextId: () => `${prefix}-${sequence++}` }, clock: { now: () => stamp } } }
function projectEnvironment(prefix: string) {
  const clock = runtime(prefix), name = `m20f-preserved-project-${crypto.randomUUID()}`
  const repository = new ProjectRepository({ name, runtime: clock, validation }); databases.push(repository); names.push(name)
  return { repository, runtime: clock, validation, legacy: { factory: new IDBFactory() } }
}
function libraryEnvironment(prefix: string) {
  const clock = runtime(prefix), name = `m20f-preserved-library-${crypto.randomUUID()}`
  const repository = new LibraryRepository({ name, runtime: clock, validation }); databases.push(repository); names.push(name)
  return { repository, runtime: clock, validation, legacy: { factory: new IDBFactory() } }
}
afterEach(async () => { vi.restoreAllMocks(); for (const database of databases.splice(0)) database.close(); for (const name of names.splice(0)) await Dexie.delete(name) })
async function projectSet() {
  const original = new Uint8Array(await (await exportProjectV6(emptyProject())).arrayBuffer()), capture = await captureLegacyFile(original)
  const files = await exportMigrationSet({ setId: 'external-project-journal', createdAt: stamp, converterVersion: CONVERTER_VERSION,
    scope: capture.scope, sourceFingerprint: capture.sourceFingerprint, records: capture.records })
  return { original, capture, files }
}
async function librarySet() {
  const factory = new IDBFactory(), key = JSON.stringify([1, 'a'.repeat(64), 'prop', 'uninstalled.original', 1, 'b'.repeat(64)])
  const organization: CatalogOrganization = { tags: ['  原标签  ', 'ＡＢＣ'], colors: ['蓝', '绿'], favorite: true }
  await new Promise<void>((resolve, reject) => {
    const request = factory.open(LEGACY_CATALOG_DATABASE, 10)
    request.onupgradeneeded = () => {
      const entries = request.result.createObjectStore('entries', { keyPath: 'key' }); entries.createIndex('logicalKey', 'logicalKey', { unique: true })
      request.result.createObjectStore('organizations', { keyPath: 'key' }); request.result.createObjectStore('metadata', { keyPath: 'id' })
    }
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const db = request.result, transaction = db.transaction(['organizations', 'metadata'], 'readwrite')
      transaction.objectStore('organizations').put({ key, value: organization }); transaction.objectStore('metadata').put({ id: 'catalog', revision: 3 })
      transaction.oncomplete = () => { db.close(); resolve() }; transaction.onerror = () => reject(transaction.error)
    }
  })
  const capture = await captureLegacyCatalog({ factory })
  const files = await exportMigrationSet({ setId: 'external-catalog-journal', createdAt: stamp, converterVersion: CONVERTER_VERSION,
    scope: capture.scope, sourceFingerprint: capture.sourceFingerprint, records: capture.records })
  return { files, key, organization }
}

describe('reopening complete preservation sets without their original browser', () => {
  it('reserves stable native project mappings, requires the new journal-bound set and preserves later edits', async () => {
    const { files, original } = await projectSet(), env = projectEnvironment('browser-a'), opened = vi.spyOn(env.legacy.factory, 'open')
    const first = await beginPreservedProjectConversion(files, env)
    expect(first.backup).not.toBeNull(); expect(first.reused).toBeNull(); expect(await env.repository.list()).toEqual([])
    expect((await importMigrationSet(first.backup!.index, first.backup!.volumes)).manifest.setId).toBe(first.job.jobId)
    expect(first.job.jobId).not.toBe('external-project-journal'); expect(opened).not.toHaveBeenCalled()
    await expect(continueProjectConversion({ jobId: first.job.jobId, backup: files }, env)).rejects.toThrow(/backupReceipt|凭证|匹配/)
    const retry = await beginPreservedProjectConversion(files, env)
    expect(retry.job.jobId).toBe(first.job.jobId); expect(retry.job.targetSceneId).toBe(first.job.targetSceneId)
    expect(retry.job.snapshotIds).toEqual(first.job.snapshotIds)
    const completed = await continueProjectConversion({ jobId: retry.job.jobId, backup: retry.backup! }, env)
    expect(completed.bundle.project.format).toBe('sceneweave-complete-project')
    const originals = await env.repository.listLegacySources(completed.bundle.project.document.sceneId)
    expect(originals).toHaveLength(1)
    expect((await env.repository.loadLegacyOriginal(completed.bundle.project.document.sceneId, originals[0].nodeId)).bytes).toEqual(original)
    const edited = cloneJson(completed.bundle.project)
    edited.document.revision = 1; edited.document.title = 'Later native edit'
    await env.repository.save({ project: edited, resources: completed.bundle.resources }, 0)
    const reused = await beginPreservedProjectConversion(files, env)
    expect(reused.backup).toBeNull(); expect(reused.reused!.project.document).toMatchObject({ revision: 1, title: 'Later native edit' })
    expect(await env.legacy.factory.databases()).toEqual([]); expect(opened).not.toHaveBeenCalled()
    const other = await beginPreservedProjectConversion(files, projectEnvironment('browser-b'))
    expect(other.job.jobId).not.toBe(first.job.jobId); expect(other.job.targetSceneId).not.toBe(first.job.targetSceneId)
    expect((await importMigrationSet(other.backup!.index, other.backup!.volumes)).manifest.setId).toBe(other.job.jobId)
  })

  it('refuses a structurally valid set whose actual captured fingerprint differs before reserving a target', async () => {
    const { capture } = await projectSet(), env = projectEnvironment('bad-fingerprint'), reserve = vi.spyOn(env.repository, 'reserveJob')
    const wrong = await exportMigrationSet({ setId: 'wrong-fingerprint', createdAt: stamp, converterVersion: CONVERTER_VERSION,
      scope: capture.scope, sourceFingerprint: 'f'.repeat(64), records: capture.records })
    await expect(beginPreservedProjectConversion(wrong, env)).rejects.toThrow(/指纹/)
    expect(reserve).not.toHaveBeenCalled()
    const getter = vi.fn(() => wrong.index)
    await expect(beginPreservedProjectConversion({ get index() { return getter() }, volumes: wrong.volumes }, env)).rejects.toThrow(/访问器/)
    expect(getter).not.toHaveBeenCalled()
  })

  it('requires captured-copy for a preserved database project whose original browser is unavailable', async () => {
    const original = emptyProject(), old = new SceneRepositoryV6()
    names.push(LEGACY_DATABASES.v6)
    try { await old.save(original, null) } finally { old.close() }
    const capture = await captureLegacyFamily({ repository: 'v6', sceneId: original.document.sceneId })
    const files = await exportMigrationSet({ setId: 'removed-browser-project', createdAt: stamp, converterVersion: CONVERTER_VERSION,
      scope: capture.scope, sourceFingerprint: capture.sourceFingerprint, records: capture.records })
    const env = projectEnvironment('removed-project-browser'), opened = vi.spyOn(env.legacy.factory, 'open')
    const begun = await beginPreservedProjectConversion(files, env)
    expect(opened).not.toHaveBeenCalled()
    await expect(continueProjectConversion({ jobId: begun.job.jobId, backup: begun.backup! }, env)).rejects.toMatchObject({ code: 'conversion-source-changed', sourceState: 'unavailable' })
    expect(await env.repository.list()).toEqual([])
    const retry = await beginPreservedProjectConversion(files, env)
    expect(retry.job.targetSceneId).toBe(begun.job.targetSceneId)
    const completed = await continueProjectConversion({ jobId: retry.job.jobId, backup: retry.backup!, sourcePolicy: 'captured-copy' }, env)
    expect(completed.bundle.project.document.title).toBe(original.document.title)
    expect(completed.sourceState).toBe('unavailable')
    expect(await env.legacy.factory.databases()).toEqual([])
  })

  it('keeps all personal organization without a source DB and requires an explicit captured-copy continue decision', async () => {
    const { files, key, organization } = await librarySet(), env = libraryEnvironment('catalog-browser'), opened = vi.spyOn(env.legacy.factory, 'open')
    const begun = await beginPreservedLibraryConversion(files, env)
    expect(begun.backup).not.toBeNull(); expect(opened).not.toHaveBeenCalled()
    await expect(continueLibraryConversion({ jobId: begun.job.jobId, backup: begun.backup! }, env)).rejects.toMatchObject({ code: 'library-conversion-source-changed', sourceState: 'unavailable' })
    expect((await env.repository.read()).organizations).toEqual({})
    const retry = await beginPreservedLibraryConversion(files, env)
    expect(retry.job.jobId).toBe(begun.job.jobId)
    const completed = await continueLibraryConversion({ jobId: retry.job.jobId, backup: retry.backup!, sourcePolicy: 'captured-copy' }, env)
    expect(completed.snapshot.entries).toEqual([]); expect(completed.snapshot.organizations).toEqual({ [key]: organization })
    const later = { ...organization, tags: ['Later personal edit'] }
    await env.repository.commit(completed.snapshot.revision, { organization: [{ key, value: later }] })
    const sourceReads = opened.mock.calls.length
    const reused = await beginPreservedLibraryConversion(files, env)
    expect(reused.backup).toBeNull(); expect(reused.reused!.organizations).toEqual({ [key]: later })
    expect(await env.legacy.factory.databases()).toEqual([]); expect(opened).toHaveBeenCalledTimes(sourceReads)
    expect(opened.mock.calls.every(args => args.length === 1 && args[0] === LEGACY_CATALOG_DATABASE)).toBe(true)
    await expect(beginPreservedProjectConversion(files, projectEnvironment('wrong-scope'))).rejects.toThrow(/工程家族/)
  })
})
