import { IDBFactory } from 'fake-indexeddb'
import { unzlibSync } from 'fflate'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { imageProject } from '../../io/v6/test-fixtures'
import { prepareCatalogEntry } from '../../catalog/content'
import { exportCatalogBackup } from '../../catalog/backup'
import type { PreparedCatalogEntryV1, CatalogOrganizationV1 } from '../../catalog/types'
import type { CompleteValidationOptions } from '../../shared/ports/resources.js'
import { exportMigrationSet, importMigrationSet } from '../../shared/migration/set.js'
import { sha256Bytes } from '../../shared/project/binary.js'
import { loadLibraryCapsule } from '../../shared/library/content.js'
import { decodeLegacyRow, encodeLegacyRow } from './row-codec.js'
import { captureLegacyCatalog, captureLegacyCatalogFile, prepareLegacyCatalog, restoreLegacyCatalogCapture, LEGACY_CATALOG_DATABASE } from './catalog.js'

const validation: CompleteValidationOptions = { images: {
  async decode(bytes, record) {
    const compressed: Uint8Array[] = []
    for (let offset = 8; offset < bytes.length;) {
      const length = new DataView(bytes.buffer, bytes.byteOffset + offset).getUint32(0)
      if (new TextDecoder().decode(bytes.subarray(offset + 4, offset + 8)) === 'IDAT') compressed.push(bytes.subarray(offset + 8, offset + 8 + length))
      offset += length + 12
    }
    const data = new Uint8Array(compressed.reduce((sum, part) => sum + part.length, 0)); let offset = 0
    for (const part of compressed) { data.set(part, offset); offset += part.length }
    return { width: record.pixelWidth, height: record.pixelHeight, rgba: new Uint8ClampedArray(unzlibSync(data).slice(1)) }
  },
  async transform() { throw new Error('No variants in this fixture') }, async encodePng() { throw new Error('No encoding during conversion') },
} }
beforeEach(() => vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 1, height: 1, close() {} }))))
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })
function open(factory: IDBFactory, version = 10, foreignIndex = false): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(LEGACY_CATALOG_DATABASE, version)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result)
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore('entries', { keyPath: 'key' })
      store.createIndex('logicalKey', 'logicalKey', { unique: !foreignIndex })
      request.result.createObjectStore('organizations', { keyPath: 'key' })
      request.result.createObjectStore('metadata', { keyPath: 'id' })
    }
  })
}
async function seed(factory: IDBFactory, entries: PreparedCatalogEntryV1[] = [], orgs: { key: string; value: unknown }[] = [], metadata: unknown = { id: 'catalog', revision: 7 }) {
  const db = await open(factory)
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['entries', 'organizations', 'metadata'], 'readwrite')
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error)
    for (const entry of entries) tx.objectStore('entries').put({ key: entry.item.identity.key, logicalKey: entry.item.identity.logicalKey, entry })
    for (const organization of orgs) tx.objectStore('organizations').put(organization)
    if (metadata) tx.objectStore('metadata').put(metadata)
  })
  db.close()
}
async function entry() { return prepareCatalogEntry(await imageProject(), { kind: 'material', definitionId: 'test-material' }) }
const organization: CatalogOrganizationV1 = { tags: ['全角 Ａ', '保留顺序'], colors: ['绿', '灰'], favorite: true }
function uninstalledKey(installed: PreparedCatalogEntryV1) { const tuple = JSON.parse(installed.item.identity.key); tuple[3] = 'uninstalled.fixed'; return JSON.stringify(tuple) }

describe('M2-0e readonly legacy full personal catalog preservation and conversion', () => {
  it('does not create a missing source and rejects unknown version or logical index without upgrading', async () => {
    const missing = new IDBFactory()
    await expect(captureLegacyCatalog({ factory: missing })).rejects.toThrow('不存在')
    expect(await missing.databases()).toEqual([])
    for (const [version, index] of [[11, false], [10, true]] as const) {
      const factory = new IDBFactory(), db = await open(factory, version, index); db.close()
      await expect(captureLegacyCatalog({ factory })).rejects.toThrow(/未知/)
      expect((await factory.databases())[0].version).toBe(version)
    }
  })

  it('preserves an existing empty catalog including absent metadata as an explicit empty metadata row set', async () => {
    const factory = new IDBFactory(), db = await open(factory); db.close()
    const capture = await captureLegacyCatalog({ factory })
    expect(capture.records).toHaveLength(1); expect(capture.records[0].role).toBe('catalog-metadata')
    expect(decodeLegacyRow(capture.records[0].bytes)).toEqual({ rows: [] })
    const files = await exportMigrationSet({ setId: 'empty-catalog', converterVersion: 'm20-converter-1', createdAt: '2026-10-24T00:00:00.000Z', scope: capture.scope, sourceFingerprint: capture.sourceFingerprint, records: capture.records })
    const reread = await importMigrationSet(files.index, files.volumes)
    const restored = await restoreLegacyCatalogCapture(reread.manifest.scope, reread.records.map(({ role, recordKey, sourceFormat, contentHash, bytes }) => ({ role, recordKey, sourceFormat, contentHash, bytes })))
    const converted = await prepareLegacyCatalog(restored, validation)
    expect(converted.entries).toEqual([]); expect(converted.organizations).toEqual({})
  })

  it('captures every installed, uninstalled organization and exact Blob bytes, then converts the reread set with stable keys', async () => {
    const factory = new IDBFactory(), installed = await entry(), absent = uninstalledKey(installed)
    await seed(factory, [installed], [{ key: installed.item.identity.key, value: organization }, { key: absent, value: { tags: ['未安装'], colors: [], favorite: false } }])
    const before = await captureLegacyCatalog({ factory })
    expect(before.scope).toEqual({ kind: 'catalog', repository: LEGACY_CATALOG_DATABASE, sourceSceneId: null })
    expect(before.entryKeys).toEqual([installed.item.identity.key]); expect(before.organizationKeys).toHaveLength(2)
    expect(before.records).toHaveLength(4); expect(Object.keys(before.sourceContentHashes)).toHaveLength(4)
    const serialized = await exportMigrationSet({ setId: 'catalog-preservation', converterVersion: 'm20-converter-1', createdAt: '2026-10-24T00:00:00.000Z', scope: before.scope, sourceFingerprint: before.sourceFingerprint, records: before.records })
    const reread = await importMigrationSet(serialized.index, serialized.volumes), restored = await restoreLegacyCatalogCapture(reread.manifest.scope, reread.records.map(({ role, recordKey, sourceFormat, contentHash, bytes }) => ({ role, recordKey, sourceFormat, contentHash, bytes })))
    const raw = decodeLegacyRow(restored.records.find(record => record.role === 'catalog-entry')!.bytes) as { entry: PreparedCatalogEntryV1 }
    expect(await raw.entry.capsule.arrayBuffer()).toEqual(await installed.capsule.arrayBuffer())
    expect(raw.entry.capsule.type).toBe(installed.capsule.type)
    const converted = await prepareLegacyCatalog(restored, validation)
    expect(converted.entries[0].item).toEqual(installed.item)
    expect(converted.entries[0].capsuleSha256).not.toBe(installed.capsuleSha256)
    expect(converted.organizations[installed.item.identity.key]).toEqual(organization)
    expect(converted.organizations[absent].tags).toEqual(['未安装'])
    expect(converted.entries).toHaveLength(1)
    const capsule = await loadLibraryCapsule(converted.entries[0], validation), hash = Object.keys(capsule.project.assets)[0]
    expect(capsule.project.format).toBe('sceneweave-complete-project'); expect(capsule.project.authoringSources).toEqual({})
    expect(await capsule.resources.read(hash)).toEqual(new Uint8Array(await (await imageProject()).assets[hash].blob.arrayBuffer()))
    expect((await captureLegacyCatalog({ factory })).sourceFingerprint).toBe(before.sourceFingerprint)
  })

  it('preserves serializable damaged organization rows and metadata but refuses conversion rather than trimming them', async () => {
    const factory = new IDBFactory(), installed = await entry(), key = uninstalledKey(installed)
    await seed(factory, [], [{ key, value: { tags: ['暂不可读'], colors: [], favorite: false, futureField: 'kept' } }], { id: 'catalog', revision: 9, unexpected: ['retained'] })
    const capture = await captureLegacyCatalog({ factory }), restored = await restoreLegacyCatalogCapture(capture.scope, capture.records)
    expect(restored.records).toHaveLength(2)
    expect((decodeLegacyRow(restored.records.find(record => record.role === 'catalog-metadata')!.bytes) as { rows: {value: Record<string, unknown>}[] }).rows[0].value.unexpected).toEqual(['retained'])
    await expect(prepareLegacyCatalog(restored, validation)).rejects.toThrow(/未知/)
    expect((await captureLegacyCatalog({ factory })).sourceFingerprint).toBe(capture.sourceFingerprint)
  })

  it('fingerprints installation, all organization values and revision, and rejects modified public byte views or forged captures', async () => {
    const factory = new IDBFactory(), installed = await entry()
    await seed(factory, [], [{ key: installed.item.identity.key, value: organization }])
    const onlyOrganization = await captureLegacyCatalog({ factory })
    await seed(factory, [installed], [], { id: 'catalog', revision: 8 })
    const withEntry = await captureLegacyCatalog({ factory })
    expect(withEntry.sourceFingerprint).not.toBe(onlyOrganization.sourceFingerprint)
    await expect(prepareLegacyCatalog({ ...withEntry }, validation)).rejects.toThrow(/本次完整捕获/)
    withEntry.records[0].bytes[0] ^= 1
    await expect(prepareLegacyCatalog(withEntry, validation)).rejects.toThrow(/记录不能修改/)
    const bad = onlyOrganization.records.map(record => ({ ...record, bytes: record.bytes.slice() })); bad[0].bytes[0] ^= 1
    await expect(restoreLegacyCatalogCapture(onlyOrganization.scope, bad)).rejects.toThrow()
  })

  it('preserves organization-only valid unknown content keys without installing or rebinding them', async () => {
    const factory = new IDBFactory(), installed = await entry(), key = uninstalledKey(installed)
    await seed(factory, [], [{ key, value: organization }])
    const converted = await prepareLegacyCatalog(await captureLegacyCatalog({ factory }), validation)
    expect(converted.entries).toEqual([]); expect(Object.keys(converted.organizations)).toEqual([key]); expect(converted.organizations[key]).toEqual(organization)
  })

  it('keeps the exact old selected backup file and converts through its legacy reader without creating a source database', async () => {
    const installed = await entry(), file = await exportCatalogBackup([{ entry: installed, organization }]), bytes = new Uint8Array(await file.arrayBuffer())
    const captured = await captureLegacyCatalogFile(bytes), restored = await restoreLegacyCatalogCapture(captured.scope, captured.records)
    expect(captured.scope.repository).toBe('file-catalog-v1'); expect(captured.records).toHaveLength(1)
    expect(captured.records[0].bytes).toEqual(bytes); expect(captured.sourceContentHashes['input.sceneweave-library']).toBe(sha256Bytes(bytes))
    const converted = await prepareLegacyCatalog(restored, validation)
    expect(converted.entries[0].item).toEqual(installed.item); expect(converted.organizations[installed.item.identity.key]).toEqual(organization)
    const corrupt = [{ ...captured.records[0], bytes: await encodeLegacyRow({ unexpected: true }) }]
    await expect(restoreLegacyCatalogCapture(captured.scope, corrupt)).rejects.toThrow()
  })
})
