import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { zlibSync } from 'fflate'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHouse } from '../../core/seed'
import { migrateSceneV1 } from '../../core/v2/migration'
import { SceneRepository } from '../storage'
import { exportProject } from '../project-file'
import { crc32 } from './limits'
import { sha256Bytes } from './resources'
import { ConflictErrorV2, SceneRepositoryV2 } from './storage'
import type { AssetBlobRecord, CompleteProjectV2 } from './types'

const repositories: SceneRepositoryV2[] = []
const databases = new Set<string>()
function repository(name = `test-v2-${crypto.randomUUID()}`): SceneRepositoryV2 {
  const repo = new SceneRepositoryV2(name)
  repositories.push(repo)
  databases.add(name)
  return repo
}
const database = (repo: SceneRepositoryV2): Dexie => (repo as unknown as { db: Dexie }).db
function revision(project: CompleteProjectV2, value: number): CompleteProjectV2 {
  const copy = structuredClone(project)
  copy.document.revision = value
  copy.document.title = `资产工程 ${value}`
  return copy
}
function project(sceneId: string = crypto.randomUUID()): CompleteProjectV2 {
  const document = migrateSceneV1(createHouse('v1-source'), { sceneId, now: '2026-10-20T00:00:00.000Z' })
  return { document, assets: {}, licenses: {}, licenseBindings: [] }
}

/** A newly encoded original 1x1 image; bitmap decode alone is stubbed in this Node suite. */
async function asset(red = 1): Promise<AssetBlobRecord> {
  const chunk = (name: string, bytes: Uint8Array): Uint8Array => {
    const result = new Uint8Array(bytes.length + 12), view = new DataView(result.buffer)
    view.setUint32(0, bytes.length)
    result.set(new TextEncoder().encode(name), 4)
    result.set(bytes, 8)
    view.setUint32(result.length - 4, crc32(result.subarray(4, result.length - 4)))
    return result
  }
  const chunks = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', new Uint8Array([0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0])),
    chunk('IDAT', zlibSync(new Uint8Array([0, red, 2, 3, 255]))), chunk('IEND', new Uint8Array())]
  const bytes = new Uint8Array(chunks.reduce((sum, item) => sum + item.length, 0))
  let offset = 0
  for (const part of chunks) { bytes.set(part, offset); offset += part.length }
  const sha256 = await sha256Bytes(bytes)
  return { sha256, blob: new Blob([bytes], { type: 'image/png' }), mimeType: 'image/png', sizeBytes: bytes.length, pixelWidth: 1, pixelHeight: 1 }
}

async function withAsset(input = project(), red = 1): Promise<CompleteProjectV2> {
  const copy = structuredClone(input), record = await asset(red)
  const text = 'Sceneweave original test pixel. CC0-1.0. No external source.'
  const licenseHash = await sha256Bytes(new TextEncoder().encode(text))
  copy.document.assets['test-image'] = {
    id: 'test-image', sha256: record.sha256, mimeType: record.mimeType, pixelWidth: 1, pixelHeight: 1,
    logicalSizeMm: { width: 1000, height: 1000 }, licenseRef: 'test-pixel-cc0',
    origin: { kind: 'original', attribution: 'Sceneweave test fixture', canEmbed: true },
  }
  const prop = Object.values(copy.document.props)[0]
  prop.appearance = { kind: 'image', assetId: 'test-image', tint: null, opacity: 1 }
  prop.definitionRef = { id: 'test-prop-definition', version: 1 }
  copy.document.propDefinitions = { 'test-prop-definition': {
    id: 'test-prop-definition', catalogId: 'test-pixel-prop', version: 1, name: 'Test pixel', tags: [], licenseRef: 'test-pixel-cc0',
    origin: { kind: 'original', attribution: 'Sceneweave test fixture', canEmbed: true },
    defaultAppearance: prop.appearance, defaultVisualBoundsMm: prop.visualBoundsMm,
    defaultFootprintMm: prop.footprintMm, defaultFootprintOffsetMm: prop.footprintOffsetMm,
    defaultBlocksMovement: prop.blocksMovement, defaultBlocksSight: prop.blocksSight,
    defaultRenderLayer: prop.renderLayer, defaultShadowClass: prop.shadowClass,
  } }
  copy.assets = { [record.sha256]: record }
  copy.licenses = { [licenseHash]: { sha256: licenseHash, text } }
  copy.licenseBindings = [
    { subjectKind: 'asset', subjectId: 'test-image', licenseRef: 'test-pixel-cc0', licensePath: `licenses/${licenseHash}.txt`, embedding: 'allowed' },
    { subjectKind: 'propDefinition', subjectId: 'test-prop-definition', licenseRef: 'test-pixel-cc0', licensePath: `licenses/${licenseHash}.txt`, embedding: 'allowed' },
  ]
  return copy
}

beforeEach(() => {
  // Browser integration exercises real decoding; Node has no browser image decoder.
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 1, height: 1, close: vi.fn() })))
})
afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  for (const repo of repositories.splice(0)) repo.close()
  for (const name of databases) await Dexie.delete(name)
  databases.clear()
})

describe('SceneRepositoryV2 complete resource ownership', () => {
  it('opens the independent six-table schema and refuses the M0 database name', async () => {
    const repo = repository()
    await repo.open()
    expect(database(repo).verno).toBe(1)
    expect(database(repo).tables.map(table => table.name).sort()).toEqual(['assetBlobs', 'licenseTexts', 'migrationSources', 'resourceBindings', 'scenes', 'snapshots'])
    expect(() => new SceneRepositoryV2('sceneweave-m0')).toThrow('M0')
  })

  it('reopens document, resource bytes and exact bindings without retaining mutable references', async () => {
    const repo = repository(), input = await withAsset()
    const title = input.document.title
    const saving = repo.save(input, null)
    input.document.title = 'caller changed during validation'
    input.licenseBindings[0].licenseRef = 'caller changed'
    await saving
    const loaded = (await repo.load(input.document.sceneId))!
    expect(loaded.document.title).toBe(title)
    expect(loaded.licenseBindings[0].licenseRef).toBe('test-pixel-cc0')
    const hash = Object.keys(loaded.assets)[0]
    expect(await loaded.assets[hash].blob.arrayBuffer()).toEqual(await input.assets[hash].blob.arrayBuffer())
    loaded.document.title = 'caller changed after load'
    loaded.assets[hash].pixelWidth = 9
    expect((await repo.load(input.document.sceneId))!.document.title).toBe(title)
    expect((await repo.load(input.document.sceneId))!.assets[hash].pixelWidth).toBe(1)
    expect(await repo.load('missing')).toBeNull()
    expect(await repo.loadSnapshot(input.document.sceneId, 99)).toBeNull()
  })

  it('deduplicates actual bytes across scenes while each revision owns its full binding', async () => {
    const repo = repository(), first = await withAsset(), second = await withAsset(project('second-scene'))
    await repo.save(first, null)
    await repo.save(second, null)
    expect(await database(repo).table('assetBlobs').count()).toBe(1)
    expect(await database(repo).table('licenseTexts').count()).toBe(1)
    expect(await database(repo).table('resourceBindings').count()).toBe(2)
    const changed = revision(second, 1)
    changed.document.props[Object.keys(changed.document.props)[0]].appearance = { kind: 'symbol', symbol: 'table', tint: null, opacity: 1 }
    changed.document.props[Object.keys(changed.document.props)[0]].definitionRef = null
    changed.document.propDefinitions = {}
    changed.document.assets = {}; changed.assets = {}; changed.licenses = {}; changed.licenseBindings = []
    await repo.save(changed, 0)
    expect(Object.keys((await repo.load(second.document.sceneId))!.assets)).toHaveLength(0)
    expect(Object.keys((await repo.loadSnapshot(second.document.sceneId, 0))!.assets)).toHaveLength(1)
    expect(Object.keys((await repo.load(first.document.sceneId))!.assets)).toHaveLength(1)
    expect(await database(repo).table('assetBlobs').count()).toBe(1)
  })

  it('performs browser image decoding outside both save and load transactions', async () => {
    const repo = repository(), input = await withAsset(), activeTransactions: unknown[] = []
    vi.stubGlobal('createImageBitmap', vi.fn(async () => {
      activeTransactions.push(Dexie.currentTransaction)
      return { width: 1, height: 1, close: vi.fn() }
    }))
    await repo.save(input, null)
    await repo.load(input.document.sceneId)
    await repo.loadSnapshot(input.document.sceneId, 0)
    expect(activeTransactions).toHaveLength(3)
    expect(activeTransactions.every(transaction => !transaction)).toBe(true)
  })

  it('refuses a corrupted stored hash entry by actual byte comparison without overwriting it', async () => {
    const repo = repository(), initial = await withAsset(), hash = Object.keys(initial.assets)[0]
    await repo.save(initial, null)
    const original = initial.assets[hash]
    const corrupted = { ...original, blob: new Blob([new Uint8Array(original.sizeBytes)], { type: original.mimeType }) }
    await database(repo).table('assetBlobs').put(corrupted)
    await expect(repo.save(revision(initial, 1), 0)).rejects.toThrow('已有字节')
    expect((await database(repo).table('scenes').get(initial.document.sceneId)).revision).toBe(0)
    expect(await database(repo).table('snapshots').count()).toBe(1)
    expect(await (await database(repo).table('assetBlobs').get(hash)).blob.arrayBuffer()).toEqual(await corrupted.blob.arrayBuffer())
    await expect(repo.load(initial.document.sceneId)).rejects.toThrow()
    expect(await database(repo).table('scenes').count()).toBe(1)
  })

  it('refuses conflicting dimensions or license content already bound to the same hash', async () => {
    const repo = repository(), initial = await withAsset(), hash = Object.keys(initial.assets)[0]
    await repo.save(initial, null)
    await database(repo).table('assetBlobs').update(hash, { pixelWidth: 2 })
    await expect(repo.save(revision(initial, 1), 0)).rejects.toThrow('尺寸冲突')
    await database(repo).table('assetBlobs').put(initial.assets[hash])
    const licenseHash = Object.keys(initial.licenses)[0]
    await database(repo).table('licenseTexts').update(licenseHash, { text: 'corrupted license' })
    await expect(repo.save(revision(initial, 1), 0)).rejects.toThrow('许可')
    expect((await database(repo).table('scenes').get(initial.document.sceneId)).revision).toBe(0)
  })

  it('reports missing persistent resources or bindings while retaining all original rows', async () => {
    const repo = repository(), initial = await withAsset()
    await repo.save(initial, null)
    await database(repo).table('assetBlobs').delete(Object.keys(initial.assets)[0])
    await expect(repo.load(initial.document.sceneId)).rejects.toThrow('素材或许可缺失')
    await database(repo).table('assetBlobs').put(Object.values(initial.assets)[0])
    await database(repo).table('resourceBindings').delete([initial.document.sceneId, 0])
    await expect(repo.load(initial.document.sceneId)).rejects.toThrow('绑定缺失')
    expect(await database(repo).table('scenes').count()).toBe(1)
    expect(await database(repo).table('snapshots').count()).toBe(1)
  })
})

describe('SceneRepositoryV2 atomic revisions and failure recovery', () => {
  it('performs CAS across two connections and refuses import overwrite or revision regression', async () => {
    const name = `test-v2-${crypto.randomUUID()}`, first = repository(name), second = repository(name), initial = await withAsset()
    await first.save(initial, null)
    const outcomes = await Promise.allSettled([first.save(revision(initial, 2), 0), second.save(revision(initial, 4), 0)])
    expect(outcomes.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    const failed = outcomes.find(result => result.status === 'rejected') as PromiseRejectedResult
    expect(failed.reason).toBeInstanceOf(ConflictErrorV2)
    const loaded = (await first.load(initial.document.sceneId))!
    await expect(second.save(revision(initial, 5), null)).rejects.toBeInstanceOf(ConflictErrorV2)
    await expect(second.save(loaded, loaded.document.revision)).rejects.toBeInstanceOf(ConflictErrorV2)
    await expect(second.save(revision(initial, 0), loaded.document.revision)).rejects.toBeInstanceOf(ConflictErrorV2)
    expect(await first.listSnapshots(initial.document.sceneId)).toHaveLength(2)
  })

  it('rolls back new assets, licenses, document, migration and bindings when snapshot insertion fails', async () => {
    const repo = repository(), initial = project()
    await repo.save(initial, null)
    const next = await withAsset(revision(initial, 1))
    const snapshots = database(repo).table('snapshots')
    vi.spyOn(snapshots, 'add').mockRejectedValueOnce(new DOMException('simulated quota', 'QuotaExceededError'))
    await expect(repo.save(next, 0)).rejects.toThrow('simulated quota')
    expect((await repo.load(initial.document.sceneId))!.document).toEqual(initial.document)
    expect(await database(repo).table('assetBlobs').count()).toBe(0)
    expect(await database(repo).table('licenseTexts').count()).toBe(0)
    expect(await database(repo).table('resourceBindings').count()).toBe(1)
    expect(await database(repo).table('snapshots').count()).toBe(1)
  })

  it('keeps only the latest 20 successful revision bindings and retains resource bytes', async () => {
    const repo = repository(), initial = await withAsset()
    for (let value = 0; value < 23; value++) await repo.save(revision(initial, value), value === 0 ? null : value - 1)
    expect((await repo.listSnapshots(initial.document.sceneId)).map(item => item.revision)).toEqual(Array.from({ length: 20 }, (_, index) => 22 - index))
    expect(await repo.loadSnapshot(initial.document.sceneId, 2)).toBeNull()
    expect((await repo.loadSnapshot(initial.document.sceneId, 3))!.document.revision).toBe(3)
    expect(await database(repo).table('resourceBindings').count()).toBe(20)
    expect(await database(repo).table('assetBlobs').count()).toBe(1)
  })

  it('rejects cancellation before validation without creating a database', async () => {
    const repo = repository(), controller = new AbortController()
    controller.abort()
    await expect(repo.save(project(), null, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(database(repo).isOpen()).toBe(false)
  })

  it('aborts every new resource write if cancelled during the transaction', async () => {
    const repo = repository(), initial = project(), controller = new AbortController()
    await repo.save(initial, null)
    const assets = database(repo).table('assetBlobs'), realAdd = assets.add.bind(assets)
    vi.spyOn(assets, 'add').mockImplementationOnce((...args: Parameters<typeof realAdd>) => realAdd(...args).then(result => {
      controller.abort()
      return result
    }))
    await expect(repo.save(await withAsset(revision(initial, 1)), 0, { signal: controller.signal })).rejects.toThrow()
    expect((await repo.load(initial.document.sceneId))!.document).toEqual(initial.document)
    expect(await database(repo).table('assetBlobs').count()).toBe(0)
    expect(await database(repo).table('licenseTexts').count()).toBe(0)
    expect(await database(repo).table('resourceBindings').count()).toBe(1)
  })

  it('sorts summaries by successful save time even when the clock does not advance', async () => {
    const repo = repository(), first = project('z-first'), second = project('a-second')
    vi.spyOn(Date, 'now').mockReturnValue(1000)
    await repo.save(first, null)
    await repo.save(second, null)
    expect((await repo.list()).map(item => item.sceneId)).toEqual(['a-second', 'z-first'])
    await repo.save(revision(first, 2), 0)
    expect((await repo.list()).map(item => [item.sceneId, item.revision])).toEqual([['z-first', 2], ['a-second', 0]])
  })
})

describe('SceneRepositoryV2 migration originals and compatibility', () => {
  async function migrated(): Promise<CompleteProjectV2> {
    const original = createHouse('actual-m0'), input = project('new-m1')
    const blob = new Blob([JSON.stringify(original)], { type: 'application/json' })
    input.migrationSource = {
      sourceSchemaVersion: 1, sourceSceneId: original.sceneId, sourceRevision: original.revision,
      sourceHash: await sha256Bytes(new Uint8Array(await blob.arrayBuffer())),
      migratorVersion: 'sceneweave-v1-v2@1', migratedAt: '2026-10-20T00:00:00.000Z', original: blob,
    }
    return input
  }

  it('stores migration original atomically and retains it when later saves omit the source', async () => {
    const repo = repository(), input = await migrated()
    await repo.save(input, null)
    const source = (await repo.load(input.document.sceneId))!.migrationSource!
    expect(await source.original.text()).toBe(await input.migrationSource!.original.text())
    expect(source.sourceHash).toBe(input.migrationSource!.sourceHash)
    const next = revision(input, 1)
    delete next.migrationSource
    await repo.save(next, 0)
    expect((await repo.load(next.document.sceneId))!.migrationSource!.sourceHash).toBe(source.sourceHash)
    expect((await repo.loadSnapshot(next.document.sceneId, 0))!.migrationSource!.sourceHash).toBe(source.sourceHash)
    const replaced = revision(input, 2)
    replaced.migrationSource!.migratorVersion = 'different'
    await expect(repo.save(replaced, 1)).rejects.toThrow('迁移来源不可')
    expect((await repo.load(input.document.sceneId))!.document.revision).toBe(1)
  })

  it('accepts an original strict v1 ZIP without changing its identity or bytes', async () => {
    const repo = repository(), input = await migrated(), original = createHouse('actual-m0')
    const blob = await exportProject(original)
    input.migrationSource!.original = blob
    input.migrationSource!.sourceHash = await sha256Bytes(new Uint8Array(await blob.arrayBuffer()))
    await repo.save(input, null)
    const loaded = (await repo.load(input.document.sceneId))!
    expect(await loaded.migrationSource!.original.arrayBuffer()).toEqual(await blob.arrayBuffer())
    expect(loaded.migrationSource!.sourceSceneId).toBe(original.sceneId)
  })

  it('rolls back the migration original when the target transaction fails', async () => {
    const repo = repository(), input = await migrated()
    await repo.open()
    vi.spyOn(database(repo).table('snapshots'), 'add').mockRejectedValueOnce(new Error('simulated write failure'))
    await expect(repo.save(input, null)).rejects.toThrow('simulated write failure')
    for (const table of database(repo).tables) expect(await table.count()).toBe(0)
  })

  it('rejects a forged source hash or reusing the M0 source identity', async () => {
    const repo = repository(), input = await migrated()
    input.migrationSource!.sourceHash = '0'.repeat(64)
    await expect(repo.save(input, null)).rejects.toThrow('SHA-256')
    input.migrationSource!.sourceHash = await sha256Bytes(new Uint8Array(await input.migrationSource!.original.arrayBuffer()))
    input.document.sceneId = input.migrationSource!.sourceSceneId
    await expect(repo.save(input, null)).rejects.toThrow('迁移来源')
    expect(database(repo).isOpen()).toBe(false)
  })

  it('refuses metadata from a different source revision and unsupported M0 originals', async () => {
    const repo = repository(), input = await migrated()
    input.migrationSource!.sourceRevision = 9
    await expect(repo.save(input, null)).rejects.toThrow('原件不匹配')
    input.migrationSource!.sourceRevision = 0
    const unsupported = createHouse('actual-m0')
    unsupported.schemaVersion = 3 as 1
    const blob = new Blob([JSON.stringify(unsupported)], { type: 'application/json' })
    input.migrationSource!.original = blob
    input.migrationSource!.sourceHash = await sha256Bytes(new Uint8Array(await blob.arrayBuffer()))
    await expect(repo.save(input, null)).rejects.toThrow()
    expect(database(repo).isOpen()).toBe(false)
  })

  it('preserves the separate original M0 database and snapshots during a migration save', async () => {
    const name = `test-m0-${crypto.randomUUID()}`, originalRepo = new SceneRepository(name), original = createHouse('actual-m0')
    databases.add(name)
    try {
      await originalRepo.save(original, null)
      const target = repository(), input = await migrated()
      await target.save(input, null)
      expect(await originalRepo.load(original.sceneId)).toEqual(original)
      expect(await originalRepo.listSnapshots(original.sceneId)).toEqual([original])
      expect((await target.load(input.document.sceneId))!.migrationSource!.sourceSceneId).toBe(original.sceneId)
    } finally { originalRepo.close() }
  })

  it('refuses unknown document rows on save/load rather than treating them as empty', async () => {
    const repo = repository(), input = project()
    await repo.save(input, null)
    await database(repo).table('scenes').update(input.document.sceneId, { documentSchemaVersion: 3 })
    await expect(repo.load(input.document.sceneId)).rejects.toThrow('文档版本')
    await expect(repo.save(revision(input, 1), null)).rejects.toThrow('文档版本')
    await expect(repo.save(revision(input, 1), 0)).rejects.toThrow('文档版本')
    expect((await database(repo).table('scenes').get(input.document.sceneId)).documentSchemaVersion).toBe(3)
  })

  it('refuses unknown required document fields even when row version still says v2', async () => {
    const repo = repository(), input = project()
    await repo.save(input, null)
    const record = await database(repo).table('scenes').get(input.document.sceneId)
    record.document.futureRequiredSemantic = { keep: true }
    await database(repo).table('scenes').put(record)
    await expect(repo.save(revision(input, 1), 0)).rejects.toThrow('不支持的内容')
    expect((await database(repo).table('scenes').get(input.document.sceneId)).document.futureRequiredSemantic).toEqual({ keep: true })
  })

  it('refuses a higher database version without altering any store', async () => {
    const name = `future-v2-${crypto.randomUUID()}`, future = new Dexie(name)
    databases.add(name)
    future.version(2).stores({ marker: 'id' })
    await future.open()
    await future.table('marker').put({ id: 'original', value: 'retained' })
    future.close()
    await expect(repository(name).open()).rejects.toThrow('结构版本')
    await future.open()
    expect(await future.table('marker').get('original')).toEqual({ id: 'original', value: 'retained' })
    expect(future.verno).toBe(2)
    future.close()
  })

  it('refuses an unrelated native version-1 database without auto-upgrading it', async () => {
    const name = `unknown-v2-${crypto.randomUUID()}`
    databases.add(name)
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(name, 1)
      request.onupgradeneeded = () => request.result.createObjectStore('original')
      request.onerror = () => reject(request.error)
      request.onsuccess = () => { request.result.close(); resolve() }
    })
    await expect(repository(name).open()).rejects.toThrow('结构版本')
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(name)
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        expect(request.result.version).toBe(1)
        expect(Array.from(request.result.objectStoreNames)).toEqual(['original'])
        request.result.close(); resolve()
      }
    })
  })

  it('refuses an incompatible store schema even if its version number says v1', async () => {
    const name = `bad-schema-v2-${crypto.randomUUID()}`, unrelated = new Dexie(name)
    databases.add(name)
    unrelated.version(1).stores({ scenes: 'sceneId, savedAt', snapshots: '[sceneId+revision], sceneId', assetBlobs: 'sha256', licenseTexts: 'sha256', resourceBindings: '[sceneId+revision]', migrationSources: 'sceneId' })
    await unrelated.open()
    await unrelated.table('scenes').put({ sceneId: 'keep-original' })
    unrelated.close()
    await expect(repository(name).open()).rejects.toThrow('表结构')
    await unrelated.open()
    expect(await unrelated.table('scenes').get('keep-original')).toEqual({ sceneId: 'keep-original' })
    unrelated.close()
  })

  it('stops the old reader after another connection upgrades the database', async () => {
    const name = `upgrade-v2-${crypto.randomUUID()}`, repo = repository(name), input = project()
    await repo.save(input, null)
    const upgrade = new Dexie(name)
    upgrade.version(2).stores({ scenes: 'sceneId, savedAt', snapshots: '[sceneId+revision], sceneId', assetBlobs: 'sha256', licenseTexts: 'sha256', resourceBindings: '[sceneId+revision], sceneId', migrationSources: 'sceneId' })
    await upgrade.open()
    await expect(repo.save(revision(input, 1), 0)).rejects.toThrow('结构已变化')
    expect((await upgrade.table('scenes').get(input.document.sceneId)).revision).toBe(0)
    upgrade.close()
  })
})
