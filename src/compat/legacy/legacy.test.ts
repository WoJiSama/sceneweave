import { IDBFactory as FakeFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { createHouse } from '../../core/seed'
import { emptyProject as emptyV2 } from '../../io/v2/test-fixtures'
import { emptyProject as emptyV3 } from '../../io/v3/test-fixtures'
import { emptyProject as emptyV4 } from '../../io/v4/test-fixtures'
import { emptyProject as emptyV5 } from '../../io/v5/test-fixtures'
import { emptyProject as emptyV6, imageProject as imageV6 } from '../../io/v6/test-fixtures'
import { hashValidatedProjectV4 } from '../../io/v4/project-file'
import { hashValidatedProjectV5 } from '../../io/v5/project-file'
import { hashValidatedProjectV6 } from '../../io/v6/project-file'
import { sha256Bytes } from '../../shared/project/binary.js'
import type { CompleteValidationOptions } from '../../shared/ports/resources.js'
import { encodeLegacyRow, decodeLegacyRow } from './row-codec.js'
import { captureLegacyFamily, discoverLegacyRepositories, LEGACY_DATABASES, restoreLegacyCapture, legacySnapshotKey, type LegacyRepository, type LegacyCapture } from './capture.js'
import { prepareLegacyFamily } from './convert.js'

const stamp = '2026-10-24T00:00:00.000Z'
const options: CompleteValidationOptions = { images: {
  async decode() { throw new Error('symbol-only test must not decode') },
  async transform() { throw new Error('symbol-only test must not transform') },
  async encodePng() { throw new Error('symbol-only test must not encode') },
} }
type Row = { store: string; value: Record<string, unknown> }
function factory() { return new FakeFactory() as unknown as IDBFactory }
async function database(factory: IDBFactory, repository: LegacyRepository, rows: Row[], schema = true): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = factory.open(LEGACY_DATABASES[repository], 10)
    request.onupgradeneeded = () => {
      const db = request.result, scenes = db.createObjectStore('scenes', { keyPath: 'sceneId' }); scenes.createIndex('savedAt', 'savedAt')
      const snapshots = db.createObjectStore('snapshots', { keyPath: ['sceneId', 'revision'] }); snapshots.createIndex('sceneId', 'sceneId')
      if (repository !== 'v1') {
        db.createObjectStore('assetBlobs', { keyPath: 'sha256' }); db.createObjectStore('licenseTexts', { keyPath: 'sha256' }); db.createObjectStore('migrationSources', { keyPath: 'sceneId' })
        db.createObjectStore('resourceBindings', { keyPath: ['sceneId', 'revision'] }).createIndex('sceneId', 'sceneId')
      }
      if (repository >= 'v4') {
        for (const name of ['namedSnapshots', 'protectionSnapshots']) { const store = db.createObjectStore(name, { keyPath: ['sceneId', 'id'] }); store.createIndex('sceneId', 'sceneId'); store.createIndex('id', 'id') }
        db.createObjectStore('namedResourceBindings', { keyPath: ['sceneId', 'snapshotId'] }).createIndex('sceneId', 'sceneId')
        db.createObjectStore('historyMetadata', { keyPath: 'sceneId' })
      }
      if (!schema) db.createObjectStore('foreign', { keyPath: 'id' })
    }
    request.onerror = () => reject(request.error)
    request.onsuccess = () => { const db = request.result, transaction = db.transaction(Array.from(db.objectStoreNames), 'readwrite')
      for (const row of rows) transaction.objectStore(row.store).put(row.value)
      transaction.oncomplete = () => { db.close(); resolve() }; transaction.onerror = () => { db.close(); reject(transaction.error) } }
  })
}
async function mutate(factory: IDBFactory, repository: LegacyRepository, store: string, key: IDBValidKey, change: (value: Record<string, unknown>) => void): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = factory.open(LEGACY_DATABASES[repository])
    request.onsuccess = () => { const db = request.result, transaction = db.transaction(store, 'readwrite'), table = transaction.objectStore(store), read = table.get(key)
      read.onsuccess = () => { const value = read.result; change(value); table.put(value) }; transaction.oncomplete = () => { db.close(); resolve() }; transaction.onerror = () => reject(transaction.error) }
  })
}
async function fixture(repository: LegacyRepository, history = true, supplied?: ReturnType<typeof emptyV6>): Promise<{ rows: Row[]; sceneId: string; project: ReturnType<typeof emptyV6> | undefined }> {
  if (repository === 'v1') { const document = createHouse(); return { sceneId: document.sceneId, project: undefined, rows: [{ store: 'scenes', value: { sceneId: document.sceneId, revision: document.revision, savedAt: 7, document } },
    ...(history ? [{ store: 'snapshots', value: { sceneId: document.sceneId, revision: document.revision, savedAt: 7, document } }] : [])] } }
  const project = supplied ?? (repository === 'v2' ? emptyV2() : repository === 'v3' ? emptyV3() : repository === 'v4' ? emptyV4() : repository === 'v5' ? emptyV5() : emptyV6())
  const sceneId = project.document.sceneId, common = { documentSchemaVersion: repository === 'v2' ? 2 : 3, document: project.document,
    ...(repository >= 'v3' ? { migrationSourceHash: null } : {}), ...(repository >= 'v4' ? { historyIdentity: (project as ReturnType<typeof emptyV6>).historyIdentity,
      contentHash: repository === 'v4' ? await hashValidatedProjectV4(project as ReturnType<typeof emptyV4>) : repository === 'v5' ? await hashValidatedProjectV5(project as ReturnType<typeof emptyV5>) : await hashValidatedProjectV6(project as ReturnType<typeof emptyV6>) } : {}),
    ...(repository >= 'v5' ? { appearance: (project as ReturnType<typeof emptyV6>).appearance } : {}) }
  const current = { ...common, sceneId, revision: project.document.revision, savedAt: 7 }, refs = { sceneId, revision: project.document.revision, assetHashes: Object.keys(project.assets), licenseHashes: Object.keys(project.licenses), licenseBindings: project.licenseBindings }
  const rows: Row[] = [{ store: 'scenes', value: current }, { store: 'resourceBindings', value: refs },
    ...Object.values(project.assets).map(value => ({ store: 'assetBlobs', value: value as unknown as Record<string, unknown> })),
    ...Object.values(project.licenses).map(value => ({ store: 'licenseTexts', value: value as unknown as Record<string, unknown> }))]
  if (history) rows.push({ store: 'snapshots', value: structuredClone(current) })
  if (repository >= 'v4') {
    rows.push({ store: 'historyMetadata', value: { sceneId, metadataVersion: history ? 2 : 0 } })
    if (history) for (const [store, kind, id] of [['namedSnapshots', 'named', 'named-one'], ['protectionSnapshots', 'protection', 'protect-one']]) {
      rows.push({ store, value: { ...structuredClone(common), id, sceneId, lineageId: (project as ReturnType<typeof emptyV6>).historyIdentity.lineageId, sourceRevision: project.document.revision, name: '同名历史', kind, createdAt: stamp } })
      rows.push({ store: 'namedResourceBindings', value: { sceneId, snapshotId: id, assetHashes: refs.assetHashes, licenseHashes: refs.licenseHashes, licenseBindings: refs.licenseBindings } })
    }
  }
  return { sceneId, rows, project: project as ReturnType<typeof emptyV6> }
}
function preparation(capture: LegacyCapture) {
  let sequence = 0
  return { sceneId: 'new-unified-project', createdAt: stamp, snapshotIds: Object.fromEntries(capture.snapshotKeys.map((key, i) => [key, `new-snapshot-${i}`])),
    context: { ids: { nextId: () => `fixed-token-${++sequence}` }, clock: { now: () => stamp } } }
}

describe('strict read-only legacy family capture and conversion', () => {
  it('preserves exact supported IDB field values and Blob bytes with a strict bounded data-only codec', async () => {
    const value = { text: '织境', blob: new Blob([new Uint8Array([1, 0, 255])], { type: 'application/octet-stream' }), optional: undefined, minus: -0,
      date: new Date(stamp), bytes: new Uint8Array([4, 5]), sparse: [, 'next'], bigint: 9n }
    const encoded = await encodeLegacyRow(value), restored = decodeLegacyRow(encoded) as typeof value
    expect(restored).toEqual(value); expect(Object.hasOwn(restored, 'optional')).toBe(true); expect(Object.is(restored.minus, -0)).toBe(true)
    expect(new Uint8Array(await restored.blob.arrayBuffer())).toEqual(new Uint8Array([1, 0, 255]))
    expect(await encodeLegacyRow(restored)).toEqual(encoded)
    const damaged = encoded.slice(); damaged[damaged.length - 1] ^= 1; expect(() => decodeLegacyRow(damaged)).toThrow(/hash/)
    await expect(encodeLegacyRow({ get unsafe() { throw new Error('must not invoke') } })).rejects.toThrow(/访问器/)
  })
  it('does not create missing six databases and rejects foreign schema without upgrading it', async () => {
    const isolated = factory()
    expect(await discoverLegacyRepositories({ factory: isolated })).toEqual([])
    expect(await isolated.databases()).toEqual([])
    const data = await fixture('v6'); await database(isolated, 'v6', data.rows, false)
    await expect(captureLegacyFamily({ repository: 'v6', sceneId: data.sceneId }, { factory: isolated })).rejects.toThrow(/表集合/)
    expect((await isolated.databases()).map(entry => entry.version)).toEqual([10])
  })
  it('converts each of six current versions and leaves old histories independently preserved for v1 through v5', async () => {
    for (const repository of ['v1', 'v2', 'v3', 'v4', 'v5', 'v6'] as const) {
      const isolated = factory(), data = await fixture(repository); await database(isolated, repository, data.rows)
      const capture = await captureLegacyFamily({ repository, sceneId: data.sceneId }, { factory: isolated }), before = capture.sourceFingerprint
      const result = await prepareLegacyFamily(capture, preparation(capture), options)
      expect(result.current.project).toMatchObject({ format: 'sceneweave-complete-project', schemaVersion: 1, document: { format: 'sceneweave-scene', schemaVersion: 1, sceneId: 'new-unified-project', revision: 0 } })
      expect(capture.records.filter(record => record.role === 'automatic')).toHaveLength(1)
      if (repository !== 'v6') { expect(result.snapshots).toEqual([]); expect(result.importedSnapshots).toEqual([]) }
      expect((await captureLegacyFamily({ repository, sceneId: data.sceneId }, { factory: isolated })).sourceFingerprint).toBe(before)
    }
  })
  it('rebuilds a captured family exclusively from reread preservation bytes without reopening its source database', async () => {
    const isolated = factory(), data = await fixture('v6'); await database(isolated, 'v6', data.rows)
    const capture = await captureLegacyFamily({ repository: 'v6', sceneId: data.sceneId }, { factory: isolated })
    const restored = await restoreLegacyCapture(capture.scope, capture.records)
    expect(restored.sourceFingerprint).toBe(capture.sourceFingerprint); expect(restored.snapshotKeys).toEqual(capture.snapshotKeys)
    await new Promise<void>((resolve, reject) => { const request = isolated.deleteDatabase(LEGACY_DATABASES.v6); request.onsuccess = () => resolve(); request.onerror = () => reject(request.error) })
    const converted = await prepareLegacyFamily(restored, preparation(restored), options)
    expect(converted.snapshots).toHaveLength(2); expect(converted.importedSnapshots).toHaveLength(1)
    expect(await isolated.databases()).toEqual([])
  })
  it('maps v6 named, protection and all automatic histories with original document identities and exact birth tokens', async () => {
    const isolated = factory(), data = await fixture('v6'); await database(isolated, 'v6', data.rows)
    const capture = await captureLegacyFamily({ repository: 'v6', sceneId: data.sceneId }, { factory: isolated }), prepared = await prepareLegacyFamily(capture, preparation(capture), options)
    expect(prepared.snapshots.map(row => row.name)).toEqual(['同名历史', '同名历史'])
    for (const row of [...prepared.snapshots, ...prepared.importedSnapshots]) {
      expect(row.ownerSceneId).toBe('new-unified-project'); expect(row.bundle.project.document.sceneId).toBe(data.sceneId)
      expect(row.bundle.project.historyIdentity).toEqual({ ...data.project!.historyIdentity, version: 1 })
    }
    expect(prepared.importedSnapshots[0].kind).toBe('imported-auto')
    expect(prepared.current.project.historyIdentity.propTokens).toEqual(data.project!.historyIdentity.propTokens)
    expect(prepared.current.project.historyIdentity.rootSceneId).toBe(data.project!.historyIdentity.rootSceneId)
    const again = await prepareLegacyFamily(capture, preparation(capture), options)
    expect(again.current.project).toEqual(prepared.current.project)
  })
  it('detects history-only rename and metadata changes in sourceFingerprint even when current revision is unchanged', async () => {
    const isolated = factory(), data = await fixture('v6'); await database(isolated, 'v6', data.rows)
    const a = await captureLegacyFamily({ repository: 'v6', sceneId: data.sceneId }, { factory: isolated })
    await mutate(isolated, 'v6', 'namedSnapshots', [data.sceneId, 'named-one'], row => { row.name = 'renamed' })
    const b = await captureLegacyFamily({ repository: 'v6', sceneId: data.sceneId }, { factory: isolated }); expect(b.sourceFingerprint).not.toBe(a.sourceFingerprint)
    await mutate(isolated, 'v6', 'historyMetadata', data.sceneId, row => { row.metadataVersion = 3 })
    const c = await captureLegacyFamily({ repository: 'v6', sceneId: data.sceneId }, { factory: isolated }); expect(c.sourceFingerprint).not.toBe(b.sourceFingerprint)
    expect(c.sourceContentHashes.current).toBe(a.sourceContentHashes.current)
  })
  it('preserves serializable damaged rows while refusing their conversion and never rewrites them', async () => {
    const isolated = factory(), data = await fixture('v6'); await database(isolated, 'v6', data.rows)
    await mutate(isolated, 'v6', 'scenes', data.sceneId, row => { row.contentHash = 'f'.repeat(64); row.unrecognized = undefined })
    const capture = await captureLegacyFamily({ repository: 'v6', sceneId: data.sceneId }, { factory: isolated })
    const current = decodeLegacyRow(capture.records.find(record => record.role === 'current')!.bytes) as Record<string, unknown>
    expect(Object.hasOwn(current, 'unrecognized')).toBe(true)
    await expect(prepareLegacyFamily(capture, preparation(capture), options)).rejects.toThrow(/未知字段/)
    expect((await captureLegacyFamily({ repository: 'v6', sceneId: data.sceneId }, { factory: isolated })).sourceFingerprint).toBe(capture.sourceFingerprint)
  })
  it('rejects v6 birth conflicts and missing fixed journal mappings rather than reassigning tokens', async () => {
    const isolated = factory(), data = await fixture('v6')
    const historic = data.rows.find(row => row.store === 'namedSnapshots')!, original = structuredClone(data.project!)
    original.historyIdentity.propTokens[Object.keys(original.historyIdentity.propTokens)[0]] = 'conflicting-token'
    historic.value.historyIdentity = original.historyIdentity; historic.value.contentHash = await hashValidatedProjectV6(original)
    await database(isolated, 'v6', data.rows)
    const capture = await captureLegacyFamily({ repository: 'v6', sceneId: data.sceneId }, { factory: isolated })
    await expect(prepareLegacyFamily(capture, { ...preparation(capture), snapshotIds: {} }, options)).rejects.toThrow(/ID映射/)
    await expect(prepareLegacyFamily(capture, preparation(capture), options)).rejects.toThrow(/token冲突/)
  })
  it('keeps existing exact v2 original Blob and source metadata without generating another original envelope', async () => {
    const isolated = factory(), data = await fixture('v2'), original = createHouse(), bytes = new TextEncoder().encode(JSON.stringify(original))
    data.rows.push({ store: 'migrationSources', value: { sceneId: data.sceneId, sourceSchemaVersion: 1, sourceSceneId: original.sceneId, sourceRevision: original.revision,
      sourceHash: sha256Bytes(bytes), migratorVersion: 'existing-migrator', migratedAt: stamp, original: new Blob([bytes]) } })
    await database(isolated, 'v2', data.rows)
    const capture = await captureLegacyFamily({ repository: 'v2', sceneId: data.sceneId }, { factory: isolated }), result = await prepareLegacyFamily(capture, preparation(capture), options)
    expect(result.legacySources).toHaveLength(1); expect(result.legacySources[0]).toMatchObject({ sourceSchemaVersion: 1, sourceSceneId: original.sceneId, sourceHash: sha256Bytes(bytes), previousNodeId: null })
    expect(result.legacyBlobs).toEqual([{ sha256: sha256Bytes(bytes), bytes }])
  })
  it('rejects mutated capture bytes and cancellation without returning a candidate', async () => {
    const isolated = factory(), data = await fixture('v6'); await database(isolated, 'v6', data.rows)
    const capture = await captureLegacyFamily({ repository: 'v6', sceneId: data.sceneId }, { factory: isolated })
    await expect(captureLegacyFamily({ repository: 'v6', sceneId: data.sceneId }, { factory: isolated, signal: { aborted: true } })).rejects.toMatchObject({ name: 'AbortError' })
    await expect(prepareLegacyFamily(capture, preparation(capture), { ...options, signal: { aborted: true } })).rejects.toMatchObject({ name: 'AbortError' })
    capture.records[0].bytes[0] ^= 1
    await expect(prepareLegacyFamily(capture, preparation(capture), options)).rejects.toThrow(/修改/)
  })
  it('captures actual image and license closure, decodes through the supplied port and detects resource-only corruption', async () => {
    const isolated = factory(), data = await fixture('v6', true, await imageV6()); await database(isolated, 'v6', data.rows)
    const capture = await captureLegacyFamily({ repository: 'v6', sceneId: data.sceneId }, { factory: isolated }), before = capture.sourceFingerprint
    let decoded = 0
    const imageOptions: CompleteValidationOptions = { images: { ...options.images,
      async decode(_bytes, record) { decoded++; return { width: record.pixelWidth, height: record.pixelHeight, rgba: new Uint8ClampedArray([20, 50, 80, 200]) } },
    } }
    const result = await prepareLegacyFamily(capture, preparation(capture), imageOptions), hash = Object.keys(data.project!.assets)[0]
    expect(decoded).toBeGreaterThan(0); expect(result.current.project.licenses).toEqual(data.project!.licenses)
    expect(await result.current.resources.read(hash)).toEqual(new Uint8Array(await data.project!.assets[hash].blob.arrayBuffer()))
    expect(capture.records.some(record => record.role === 'resource')).toBe(true); expect(capture.records.some(record => record.role === 'license')).toBe(true)
    await mutate(isolated, 'v6', 'assetBlobs', hash, row => { row.blob = new Blob([new Uint8Array(Number(row.sizeBytes))], { type: String(row.mimeType) }) })
    const changed = await captureLegacyFamily({ repository: 'v6', sceneId: data.sceneId }, { factory: isolated })
    expect(changed.sourceFingerprint).not.toBe(before)
    await expect(prepareLegacyFamily(changed, preparation(changed), imageOptions)).rejects.toThrow(/位图/)
  })
  it('merges proven v6 historical tombstones into current while retaining its existing live tokens', async () => {
    const isolated = factory(), data = await fixture('v6'), historic = data.rows.find(row => row.store === 'namedSnapshots')!, original = structuredClone(data.project!)
    original.historyIdentity.propTokens['already-deleted-object'] = 'historic-tombstone-token'
    historic.value.historyIdentity = original.historyIdentity; historic.value.contentHash = await hashValidatedProjectV6(original)
    await database(isolated, 'v6', data.rows)
    const capture = await captureLegacyFamily({ repository: 'v6', sceneId: data.sceneId }, { factory: isolated }), result = await prepareLegacyFamily(capture, preparation(capture), options)
    expect(result.current.project.historyIdentity.propTokens['already-deleted-object']).toBe('historic-tombstone-token')
    expect(result.current.project.document.props['already-deleted-object']).toBeUndefined()
    for (const [id, token] of Object.entries(data.project!.historyIdentity.propTokens)) expect(result.current.project.historyIdentity.propTokens[id]).toBe(token)
  })
  it('does not invoke getter wrappers while restoring or accepting a reference', async () => {
    let invoked = false
    const ref = { get repository() { invoked = true; return 'v6' }, sceneId: 'source' }
    await expect(captureLegacyFamily(ref as never, { factory: factory() })).rejects.toThrow(/访问器/)
    expect(invoked).toBe(false)
    const scope = { kind: 'project-family' as const, repository: 'v6', sourceSceneId: 'source' }, records = [{ get role() { invoked = true; return 'current' } }]
    await expect(restoreLegacyCapture(scope, records as never)).rejects.toThrow(/未知|访问器/)
    expect(invoked).toBe(false)
  })
})
