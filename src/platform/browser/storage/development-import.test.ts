import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { zipSync, unzipSync } from 'fflate'
import { encodeUtf8 } from '../../../shared/validation/json.js'
import { sha256Bytes, decodeUtf8 } from '../../../shared/project/binary.js'
import { prepareLibraryEntry } from '../../../shared/library/content.js'
import { LibraryDatabase } from '../library/database.js'
import { LibraryRepository } from '../library/repository.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { inspectLocalDevelopmentImport, importLocalDevelopmentData } from './development-import.js'
import { CURRENT_DATABASE_SELECTION_KEY, DEFAULT_CURRENT_DATABASES } from './current-databases.js'
import { LEGACY_DEVELOPMENT_PROJECT_DATABASE, PROJECT_STORES } from './database.js'
import { LEGACY_DEVELOPMENT_LIBRARY_DATABASE } from '../library/database.js'
import { fixture, runtime, validation as imageValidation } from '../../../application/workspace/test-fixtures.js'
import { cloneJson } from '../../../shared/validation/json.js'
import { legacyDevelopmentProjectHash } from '../../../shared/migration/development-project.js'
import { createProjectDelta, projectDeltaBytes } from '../../../shared/project/delta.js'
import { sealHistoryRecord } from './incremental-history.js'
import { ProjectRepository } from './repository.js'
import type { ProjectData } from '../../../shared/model/project.js'
import type { CompleteValidationOptions } from '../../../shared/ports/resources.js'

const validation: CompleteValidationOptions = { images: {
  async decode() { throw new Error('empty migration must not decode images') },
  async transform(image) { return image },
  async encodePng() { throw new Error('empty migration must not encode images') },
} }
const storage = () => { const values = new Map<string, string>(); return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) } } }
const locks = { request: async (_name: string, _options: unknown, callback: () => Promise<unknown>) => callback() } as Pick<LockManager, 'request'>
const names = [LEGACY_DEVELOPMENT_PROJECT_DATABASE, LEGACY_DEVELOPMENT_LIBRARY_DATABASE, DEFAULT_CURRENT_DATABASES.projects, DEFAULT_CURRENT_DATABASES.library]
afterEach(async () => { for (const name of names) await Dexie.delete(name); for (const database of await indexedDB.databases()) if (database.name?.startsWith('sceneweave-development-originals-') || database.name?.startsWith('sceneweave-projects-dev-v1-') || database.name?.startsWith('sceneweave-library-dev-v1-') || database.name?.startsWith('dev-import-test-')) await Dexie.delete(database.name) })

async function legacyHistory() {
  const sourceName = `dev-import-test-${crypto.randomUUID()}`, sourceLibrary = `dev-import-test-${crypto.randomUUID()}`
  const source = new Dexie(sourceName); source.version(3).stores(PROJECT_STORES); await source.open()
  const bundle = fixture({ image: true }), base = bundle.project, owner = base.document.sceneId
  const current = (revision: number, title: string) => { const project = cloneJson(base); project.document.revision = revision; project.document.title = title; return project }
  const originals = [current(0, 'root'), current(1, 'old branch'), current(2, 'active branch')]
  const legacy = originals.map(project => ({ ...cloneJson(project), schemaVersion: 8, document: { ...cloneJson(project.document), schemaVersion: 8 } }))
  const hashes = legacy.map(legacyDevelopmentProjectHash)
  const delta = { ...createProjectDelta(originals[0], originals[2]), beforeHash: hashes[0], afterHash: hashes[2] }
  const version = (index: number) => sealHistoryRecord({ format: 'sceneweave-history-version', version: 1, ownerSceneId: owner, id: `version-${index}`, revision: index,
    savedAt: base.document.updatedAt, contentHash: hashes[index], parentId: index ? 'version-0' : null, parentHash: index ? hashes[0] : null,
    checkpoint: index === 2 ? null : legacy[index], delta: index === 2 ? delta : null, depth: index === 2 ? 1 : 0, chainBytes: index === 2 ? projectDeltaBytes(delta) : 0, automatic: true })
  const head = sealHistoryRecord({ format: 'sceneweave-history-head', version: 1, ownerSceneId: owner, status: 'ready', activeVersionId: 'version-2', savedRevision: 2, contentHash: hashes[2], migration: null })
  const pin = sealHistoryRecord({ format: 'sceneweave-history-pin', version: 1, ownerSceneId: owner, id: 'branch-pin', versionId: 'version-1', lineageId: base.historyIdentity.lineageId,
    sourceRevision: 1, name: 'Retained branch', kind: 'named', createdAt: base.document.updatedAt, contentHash: hashes[1] })
  await source.table('projects').add({ sceneId: owner, revision: 2, savedAt: base.document.updatedAt, contentHash: hashes[2], status: 'ready', conversionJobId: null, project: legacy[2] })
  await source.table('historyMetadata').add({ ownerSceneId: owner, metadataVersion: 1 })
  await source.table('historyVersions').bulkAdd([version(0), version(1), version(2)])
  await source.table('historyHeads').add(head); await source.table('historyPins').add(pin)
  await source.table('resourceBindings').add({ ownerSceneId: owner, kind: 'current', recordId: 'current', assetHashes: Object.keys(base.assets).sort(), sourceHashes: [], licenseHashes: Object.keys(base.licenses).sort(), licenseBindings: base.licenseBindings })
  await source.table('resourceBindings').add({ ownerSceneId: owner, kind: 'named', recordId: 'branch-pin', assetHashes: Object.keys(base.assets).sort(), sourceHashes: [], licenseHashes: Object.keys(base.licenses).sort(), licenseBindings: base.licenseBindings })
  for (const sha256 of Object.keys(base.assets)) await source.table('resources').add({ sha256, bytes: await bundle.resources.read(sha256) })
  for (const row of Object.values(base.licenses)) await source.table('licenseTexts').add(row)
  const before = await Promise.all(source.tables.map(async table => [table.name, await table.toArray()]))
  return { source, before, owner, originals, hashes, sourceNames: { projects: sourceName, library: sourceLibrary } }
}

describe('independent development v1 migration boundary', () => {
  it('inspects absent legacy stores without creating or selecting a target', async () => {
    const selected = storage(), preview = await inspectLocalDevelopmentImport({ validation, storage: selected, locks })
    expect(preview.projectCount).toBe(0); expect(preview.historyVersionCount).toBe(0); expect(preview.libraryEntryCount).toBe(0)
    expect(selected.getItem(CURRENT_DATABASE_SELECTION_KEY)).toBeNull()
    expect((await indexedDB.databases()).map(row => row.name)).not.toContain(LEGACY_DEVELOPMENT_PROJECT_DATABASE)
  })
  it('publishes an empty target only after source recheck and keeps the legacy source untouched', async () => {
    const selected = storage(), preview = await inspectLocalDevelopmentImport({ validation, storage: selected, locks })
    const result = await importLocalDevelopmentData({ validation, storage: selected, locks }, preview.sourceFingerprint)
    expect(result).toEqual(preview)
    expect(JSON.parse(selected.getItem(CURRENT_DATABASE_SELECTION_KEY)!)).toEqual(preview.target)
    expect((await indexedDB.databases()).map(row => row.name)).toEqual(expect.arrayContaining([preview.target.projects, preview.target.library]))
    const again = await importLocalDevelopmentData({ validation, storage: selected, locks }, preview.sourceFingerprint)
    expect(again).toEqual(result)
  })
  it('converts the entire branched historical graph and exact bitmap closure, preserving all source rows', async () => {
    const data = await legacyHistory(), selected = storage(), options = { validation: imageValidation, storage: selected, locks, source: data.sourceNames }
    try {
      const preview = await inspectLocalDevelopmentImport(options)
      expect(preview.historyVersionCount).toBe(3)
      await importLocalDevelopmentData(options, preview.sourceFingerprint)
      const target = new ProjectRepository({ name: preview.target.projects, validation: imageValidation, runtime })
      try {
        const overview = await target.historyOverview(data.owner)
        expect(overview.history.versions).toHaveLength(3)
        expect(overview.snapshots).toMatchObject([{ id: 'branch-pin', sourceRevision: 1 }])
        for (const [index, expected] of data.originals.entries()) {
          const restored = await target.loadHistoryVersion(data.owner, `version-${index}`)
          expect(restored!.project).toEqual(expected)
          expect(overview.history.versions.find(row => row.id === `version-${index}`)!.contentHash).not.toBe(data.hashes[index])
        }
        const loaded = (await target.load(data.owner))!, edited = { ...loaded, project: cloneJson(loaded.project) }
        edited.project.document.revision = 3; edited.project.document.title = 'edited after import'
        await target.save(edited, 2)
      } finally { target.close() }
      await importLocalDevelopmentData(options, preview.sourceFingerprint)
      const cold = new ProjectRepository({ name: preview.target.projects, validation: imageValidation, runtime })
      try { expect((await cold.load(data.owner))!.project.document.title).toBe('edited after import') } finally { cold.close() }
      expect(await Promise.all(data.source.tables.map(async table => [table.name, await table.toArray()]))).toEqual(data.before)
    } finally { data.source.close() }
  })
  it('rejects damaged bindings and cancellation without publishing or mutating source data', async () => {
    const data = await legacyHistory(), selected = storage(), options = { validation: imageValidation, storage: selected, locks, source: data.sourceNames }
    try {
      await data.source.table('resourceBindings').clear()
      const preview = await inspectLocalDevelopmentImport(options)
      await expect(importLocalDevelopmentData(options, preview.sourceFingerprint)).rejects.toThrow('绑定缺失')
      expect(selected.getItem(CURRENT_DATABASE_SELECTION_KEY)).toBeNull()
      await expect(inspectLocalDevelopmentImport({ ...options, validation: { ...imageValidation, signal: { aborted: true } } })).rejects.toMatchObject({ name: 'AbortError' })
    } finally { data.source.close() }
  })
  it('converts personal capsules while preserving exact keys and all organization records', async () => {
    const data = await legacyHistory(), selected = storage(), library = new LibraryDatabase(data.sourceNames.library)
    const options = { validation: imageValidation, storage: selected, locks, source: data.sourceNames }
    try {
      const entry = await prepareLibraryEntry(fixture({ image: true }), { kind: 'prop', definitionId: 'definition' }, imageValidation)
      const files = unzipSync(entry.capsule), scene = JSON.parse(decodeUtf8(files['scene.json'])), manifest = JSON.parse(decodeUtf8(files['manifest.json']))
      scene.schemaVersion = 8; manifest.schemaVersion = 8; files['scene.json'] = new Uint8Array(encodeUtf8(JSON.stringify(scene)))
      const record = manifest.entries.find((row: { path: string }) => row.path === 'scene.json')
      record.sha256 = sha256Bytes(files['scene.json']); record.sizeBytes = files['scene.json'].length
      files['manifest.json'] = new Uint8Array(encodeUtf8(JSON.stringify(manifest)))
      const capsule = zipSync(files), oldEntry = { ...entry, capsule, capsuleSha256: sha256Bytes(capsule) }
      await library.open()
      await library.entries.add({ key: entry.item.identity.key, logicalKey: entry.item.identity.logicalKey, entry: oldEntry })
      const organization = { tags: ['retained'], colors: ['蓝' as const], favorite: true }
      await library.organizations.add({ key: entry.item.identity.key, value: organization }); await library.metadata.add({ id: 'catalog', revision: 7 })
      library.close()
      const preview = await inspectLocalDevelopmentImport(options); await importLocalDevelopmentData(options, preview.sourceFingerprint)
      const cold = new LibraryRepository({ name: preview.target.library, runtime, validation: imageValidation })
      try {
        const snapshot = await cold.read(); expect(snapshot.revision).toBe(7)
        expect(snapshot.entries[0].item.identity.key).toBe(entry.item.identity.key)
        expect(snapshot.organizations[entry.item.identity.key]).toEqual(organization)
        expect((await cold.load(entry.item.identity.key)).item).toEqual(entry.item)
      } finally { cold.close() }
      const sourceLibrary = new LibraryDatabase(data.sourceNames.library)
      try { await sourceLibrary.open(); expect((await sourceLibrary.entries.get(entry.item.identity.key))!.entry.capsule).toEqual(capsule) } finally { sourceLibrary.close() }
    } finally { data.source.close(); library.close() }
  })
  it('resumes a verified target after pointer publication fails without rebuilding saved content', async () => {
    const selected = storage(), options = { validation, storage: selected, locks }, preview = await inspectLocalDevelopmentImport(options)
    const failing = { getItem: selected.getItem, setItem() { throw new DOMException('fixture quota', 'QuotaExceededError') } }
    await expect(importLocalDevelopmentData({ ...options, storage: failing }, preview.sourceFingerprint)).rejects.toMatchObject({ name: 'QuotaExceededError' })
    expect(selected.getItem(CURRENT_DATABASE_SELECTION_KEY)).toBeNull()
    await expect(importLocalDevelopmentData(options, preview.sourceFingerprint)).resolves.toEqual(preview)
  })
  it('rechecks the source while resuming a verified but unpublished target', async () => {
    const data = await legacyHistory(), selected = storage()
    const baseOptions = { validation: imageValidation, storage: selected, locks, source: data.sourceNames }
    try {
      const preview = await inspectLocalDevelopmentImport(baseOptions)
      const failing = { getItem: selected.getItem, setItem() { throw new DOMException('fixture quota', 'QuotaExceededError') } }
      await expect(importLocalDevelopmentData({ ...baseOptions, storage: failing }, preview.sourceFingerprint)).rejects.toMatchObject({ name: 'QuotaExceededError' })
      let changed = false
      const validation = { ...imageValidation, images: { ...imageValidation.images, async decode(...args: Parameters<typeof imageValidation.images.decode>) {
        if (!changed) { changed = true; await data.source.table('historyMetadata').put({ ownerSceneId: data.owner, metadataVersion: 2 }) }
        return imageValidation.images.decode(...args)
      } } }
      await expect(importLocalDevelopmentData({ ...baseOptions, validation }, preview.sourceFingerprint)).rejects.toThrow('来源或当前存储选择已变化')
      expect(selected.getItem(CURRENT_DATABASE_SELECTION_KEY)).toBeNull()
    } finally { data.source.close() }
  })
  it('refuses a missing project in an unpublished verified target without recreating it', async () => {
    const data = await legacyHistory(), selected = storage(), options = { validation: imageValidation, storage: selected, locks, source: data.sourceNames }
    try {
      const preview = await inspectLocalDevelopmentImport(options)
      const failing = { getItem: selected.getItem, setItem() { throw new DOMException('fixture quota', 'QuotaExceededError') } }
      await expect(importLocalDevelopmentData({ ...options, storage: failing }, preview.sourceFingerprint)).rejects.toMatchObject({ name: 'QuotaExceededError' })
      const target = new ProjectRepository({ name: preview.target.projects, validation: imageValidation, runtime })
      try { await target.open(); await target.database.projects.clear(); await target.database.historyHeads.clear(); await target.database.historyVersions.clear(); await target.database.historyPins.clear() } finally { target.close() }
      await expect(importLocalDevelopmentData(options, preview.sourceFingerprint)).rejects.toThrow('目标范围或内容已变化')
      expect(selected.getItem(CURRENT_DATABASE_SELECTION_KEY)).toBeNull()
    } finally { data.source.close() }
  })
  it('rejects an orphan historical scope before selecting a target', async () => {
    const data = await legacyHistory(), selected = storage(), options = { validation: imageValidation, storage: selected, locks, source: data.sourceNames }
    try {
      await data.source.table('historyMetadata').put({ ownerSceneId: 'missing-owner', metadataVersion: 0 })
      const preview = await inspectLocalDevelopmentImport(options)
      await expect(importLocalDevelopmentData(options, preview.sourceFingerprint)).rejects.toThrow('缺少所属当前工程')
      expect(selected.getItem(CURRENT_DATABASE_SELECTION_KEY)).toBeNull()
    } finally { data.source.close() }
  })
  it('requires every installed project scope even if an entire scope disappears during cold validation', async () => {
    const data = await legacyHistory(), selected = storage(), options = { validation: imageValidation, storage: selected, locks, source: data.sourceNames }
    const load = ProjectRepository.prototype.load
    let removed = false
    const spy = vi.spyOn(ProjectRepository.prototype, 'load').mockImplementation(async function (this: ProjectRepository, ...args) {
      const loaded = await load.apply(this, args)
      if (!removed && this.database.name.startsWith('sceneweave-projects-dev-v1-')) {
        removed = true
        await this.database.projects.clear(); await this.database.historyHeads.clear()
        await this.database.historyVersions.clear(); await this.database.historyPins.clear()
      }
      return loaded
    })
    try {
      const preview = await inspectLocalDevelopmentImport(options)
      await expect(importLocalDevelopmentData(options, preview.sourceFingerprint)).rejects.toThrow()
      expect(removed).toBe(true)
      expect(selected.getItem(CURRENT_DATABASE_SELECTION_KEY)).toBeNull()
      expect(await Promise.all(data.source.tables.map(async table => [table.name, await table.toArray()]))).toEqual(data.before)
    } finally { spy.mockRestore(); data.source.close() }
  })
  it('retains both databases when the source changes during pixel validation', async () => {
    const data = await legacyHistory(), selected = storage()
    let changed = false
    const validation = { ...imageValidation, images: { ...imageValidation.images, async decode(...args: Parameters<typeof imageValidation.images.decode>) {
      if (!changed) { changed = true; await data.source.table('historyMetadata').put({ ownerSceneId: data.owner, metadataVersion: 2 }) }
      return imageValidation.images.decode(...args)
    } } }
    const options = { validation, storage: selected, locks, source: data.sourceNames }
    try {
      const preview = await inspectLocalDevelopmentImport(options)
      await expect(importLocalDevelopmentData(options, preview.sourceFingerprint)).rejects.toThrow('来源或当前存储选择已变化')
      expect(selected.getItem(CURRENT_DATABASE_SELECTION_KEY)).toBeNull()
      expect((await data.source.table('projects').get(data.owner)).project.document.schemaVersion).toBe(8)
      const fresh = await inspectLocalDevelopmentImport(options)
      expect(fresh.sourceFingerprint).not.toBe(preview.sourceFingerprint)
    } finally { data.source.close() }
  })
  it('rolls back cancellation before publication and retries an exact private target', async () => {
    const data = await legacyHistory(), selected = storage(), signal = { aborted: false }
    let cancel = true
    const options = { validation: { ...imageValidation, signal, images: { ...imageValidation.images, async decode(...args: Parameters<typeof imageValidation.images.decode>) {
      if (cancel) signal.aborted = true
      return imageValidation.images.decode(...args)
    } } }, storage: selected, locks, source: data.sourceNames }
    try {
      const preview = await inspectLocalDevelopmentImport(options)
      await expect(importLocalDevelopmentData(options, preview.sourceFingerprint)).rejects.toMatchObject({ name: 'AbortError' })
      expect(selected.getItem(CURRENT_DATABASE_SELECTION_KEY)).toBeNull()
      cancel = false; signal.aborted = false
      await expect(importLocalDevelopmentData(options, preview.sourceFingerprint)).resolves.toEqual(preview)
    } finally { data.source.close() }
  })
  it('rejects a stale fingerprint before creating any target', async () => {
    const selected = storage(), preview = await inspectLocalDevelopmentImport({ validation, storage: selected, locks })
    await expect(importLocalDevelopmentData({ validation, storage: selected, locks }, 'f'.repeat(64))).rejects.toThrow('数据已变化')
    expect(selected.getItem(CURRENT_DATABASE_SELECTION_KEY)).toBeNull()
  })
})
