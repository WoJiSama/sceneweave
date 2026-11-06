import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { unzipSync, zipSync } from 'fflate'
import { afterEach, describe, expect, it } from 'vitest'
import { layerSceneV3 } from '../../../core/v3/test-fixtures.js'
import { createCompositionContent } from '../../../shared/appearance/graph.js'
import { decodeSceneCoordinates, encodeProjectCoordinates } from '../../../shared/aggregates/scene-coordinates.js'
import type { ProjectBundle, ProjectData } from '../../../shared/model/project.js'
import { toCurrentSceneDocument } from '../../../shared/model/current-scene.js'
import type { CompleteValidationOptions } from '../../../shared/ports/resources.js'
import { exportProject, importProject } from '../../../shared/project/file.js'
import { createMemoryResources } from '../../../shared/project/resources.js'
import { projectContentHash } from '../../../shared/project/validate.js'
import { sha256Bytes } from '../../../shared/project/binary.js'
import { canonicalJson, cloneJson, encodeUtf8 } from '../../../shared/validation/json.js'
import { ProjectDatabase, type StoredProject } from './database.js'
import {
  captureHistoryGraph, historyGraphJson, historyGraphProjects, historyVersionBytes, historyVersionJson,
  readHistoryGraphVersion, type HistoryVersion,
} from './incremental-history.js'
import { ProjectConflictError, ProjectRepository } from './repository.js'
import { isProjectBlockManifest, materializeProjectContent } from './content-blocks.js'

const NOW = '2026-11-05T00:00:00.000Z'
const databases: ProjectDatabase[] = [], repositories: ProjectRepository[] = [], names = new Set<string>()
let sequence = 0
const validation: CompleteValidationOptions = { images: {
  async decode() { throw new Error('Symbol-only coordinate fixture must not decode images') },
  async transform() { throw new Error('Coordinate fixture must not transform images') },
  async encodePng() { throw new Error('Coordinate fixture must not encode images') },
} }

function fixture(aggregate = true): ProjectBundle {
  const document = toCurrentSceneDocument({ ...cloneJson(layerSceneV3()), format: 'sceneweave-scene', schemaVersion: 1 })
  document.sceneId = 'aggregate-io-owner'; document.assets = {}; document.propDefinitions = {}; document.materials = {}; document.styleThemes = {}; document.activeStyleThemeRef = null
  if (aggregate) document.aggregateCoordinates = { encoding: 'world', groups: {
    root: { id: 'root', floorId: 'blank-floor', parentId: null, frame: { translationMm: { x: 1000, y: 2000 }, quarterTurns: 1 }, members: [{ kind: 'prop', id: 'item' }], editLocked: false },
  } }
  const content = createCompositionContent(document, { ids: { nextId: () => `aggregate-io-${++sequence}` }, clock: { now: () => NOW } })
  return { project: { format: 'sceneweave-complete-project', schemaVersion: 1, ...content, assets: {}, licenses: {}, licenseBindings: [], authoringSources: {} }, resources: createMemoryResources({}) }
}
function database(): ProjectDatabase {
  const db = new ProjectDatabase(`aggregate-coordinates-${crypto.randomUUID()}`)
  databases.push(db); names.add(db.name); return db
}
function repository(): ProjectRepository {
  const repo = new ProjectRepository({ name: `aggregate-repository-${crypto.randomUUID()}`, validation,
    runtime: { ids: { nextId: () => `aggregate-repository-${++sequence}` }, clock: { now: () => NOW } } })
  repositories.push(repo); names.add(repo.database.name); return repo
}
function row(project: ProjectData): StoredProject {
  return { sceneId: project.document.sceneId, revision: project.document.revision, savedAt: NOW, contentHash: projectContentHash(project), status: 'ready', conversionJobId: null, project }
}
function raw<T>(db: ProjectDatabase, store: string, key: IDBValidKey): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const transaction = db.backendDB().transaction(store, 'readonly'), request = transaction.objectStore(store).get(key)
    request.onsuccess = () => {
      const value = request.result
      const hydrate = async () => {
        for (const field of ['project', 'checkpoint']) if (value && isProjectBlockManifest(value[field])) {
          value[field] = await materializeProjectContent(value[field], hash => raw(db, 'projectContentBlocks', hash))
        }
        return value as T | undefined
      }
      void hydrate().then(resolve, reject)
    }
    request.onerror = () => reject(request.error)
    transaction.onabort = () => reject(transaction.error)
  })
}
afterEach(async () => {
  for (const repo of repositories.splice(0)) repo.close()
  for (const db of databases.splice(0)) db.close()
  for (const name of names) await Dexie.delete(name)
  names.clear()
})

describe('aggregate coordinates at package and native storage boundaries', () => {
  it('writes the sole package scene as local geometry and fully imports a world view', async () => {
    const source = fixture(), original = cloneJson(source.project), bytes = await exportProject(source, validation)
    const files = unzipSync(bytes), stored = JSON.parse(new TextDecoder().decode(files['scene.json']))
    expect(stored.aggregateCoordinates.encoding).toBe('local')
    expect(stored.props.item.positionMm).toEqual({ x: 2000, y: -3000 })
    expect(stored.props.item.rotationDeg).toBe((original.document.props.item.rotationDeg + 270) % 360)
    expect(Object.hasOwn(stored, 'worldDocument')).toBe(false)
    expect(decodeSceneCoordinates(stored)).toEqual(original.document)
    expect((await importProject(bytes, validation)).project).toEqual(original)
    expect(source.project).toEqual(original)
  })

  it('rejects a package scene that claims persisted world coordinates even with correct ZIP hashes', async () => {
    const source = fixture(), files: Record<string, Uint8Array> = unzipSync(await exportProject(source, validation))
    files['scene.json'] = encodeUtf8(canonicalJson(source.project.document))
    const manifest = JSON.parse(new TextDecoder().decode(files['manifest.json']))
    const entry = manifest.entries.find((value: { path: string }) => value.path === 'scene.json')
    entry.sha256 = sha256Bytes(files['scene.json']); entry.sizeBytes = files['scene.json'].length
    files['manifest.json'] = encodeUtf8(canonicalJson(manifest))
    await expect(importProject(zipSync(files), validation)).rejects.toThrow()
  })

  it('stores actual local IDB records in every complete-project table while all API reads return world geometry', async () => {
    const db = database(), project = fixture().project, stored = row(project), original = cloneJson(project)
    await db.open()
    await db.projects.add(stored)
    await db.automaticSnapshots.add({ ownerSceneId: stored.sceneId, revision: stored.revision, savedAt: NOW, contentHash: stored.contentHash, project })
    const snapshot = { id: 'snapshot', ownerSceneId: stored.sceneId, lineageId: project.historyIdentity.lineageId,
      sourceRevision: 0, name: 'snapshot', kind: 'named' as const, createdAt: NOW, contentHash: stored.contentHash, project }
    await db.snapshots.add(snapshot)
    await db.importedSnapshots.add({ ...snapshot, kind: 'imported-auto' })
    for (const [name, key, table] of [
      ['projects', stored.sceneId, db.projects], ['automaticSnapshots', [stored.sceneId, 0], db.automaticSnapshots],
      ['snapshots', [stored.sceneId, snapshot.id], db.snapshots], ['importedSnapshots', [stored.sceneId, snapshot.id], db.importedSnapshots],
    ] as const) {
      const native = await raw<{ project: ProjectData }>(db, name, key as IDBValidKey)
      expect(native!.project).toEqual(encodeProjectCoordinates(project))
      expect(native!.project.document.aggregateCoordinates!.encoding).toBe('local')
      expect((await (table as typeof db.projects).get(key as string))!.project).toEqual(original)
      expect((await table.toArray())[0].project).toEqual(original)
    }
    expect(project).toEqual(original)
    expect(stored.project).toEqual(original)
  })

  it('encodes checkpoint payloads and preserves null delta checkpoints', async () => {
    const db = database(), project = fixture().project
    await db.open()
    const checkpoint: HistoryVersion = { format: 'sceneweave-history-version', version: 1, ownerSceneId: project.document.sceneId,
      id: 'checkpoint', revision: 0, savedAt: NOW, contentHash: projectContentHash(project), parentId: null, parentHash: null,
      checkpoint: project, delta: null, depth: 0, chainBytes: 0, automatic: true, recordHash: 'a'.repeat(64) }
    await db.historyVersions.add(checkpoint)
    expect((await raw<HistoryVersion>(db, 'historyVersions', [checkpoint.ownerSceneId, checkpoint.id]))!.checkpoint).toEqual(encodeProjectCoordinates(project))
    expect((await db.historyVersions.get([checkpoint.ownerSceneId, checkpoint.id]))!.checkpoint).toEqual(project)
    const delta = { ...checkpoint, id: 'delta', checkpoint: null, parentId: checkpoint.id, parentHash: checkpoint.contentHash, depth: 1 }
    await db.historyVersions.add(delta)
    expect((await db.historyVersions.get([delta.ownerSceneId, delta.id]))!.checkpoint).toBeNull()
  })

  it('supports complete world put and unrelated updates, and atomically rejects nested local-record edits', async () => {
    const db = database(), source = row(fixture().project)
    await db.open(); await db.projects.add(source)
    const changed = cloneJson(source)
    changed.project.document.props.item.positionMm = { x: 7000, y: 9000 }; changed.project.document.revision = 1; changed.revision = 1
    changed.contentHash = projectContentHash(changed.project)
    await db.projects.put(changed)
    expect((await db.projects.get(source.sceneId))!.project).toEqual(changed.project)
    expect((await raw<StoredProject>(db, 'projects', source.sceneId))!.project.document.props.item.positionMm).toEqual({ x: 7000, y: -6000 })
    await db.projects.update(source.sceneId, { status: 'preparing' })
    const before = await raw<StoredProject>(db, 'projects', source.sceneId)
    await expect(db.transaction('rw', db.projects, async () => {
      await db.projects.update(source.sceneId, { status: 'ready' })
      await db.projects.update(source.sceneId, { 'project.document.props.item.positionMm.x': 999 } as never)
    })).rejects.toThrow(/只允许整行替换/)
    expect(await raw<StoredProject>(db, 'projects', source.sceneId)).toEqual(before)
    const tampering = [
      { 'project.document.props.item.positionMm.x': 999 },
      { 'project.document.aggregateCoordinates.encoding': 'world' },
      { 'project.document.aggregateCoordinates.encoding': 'world', 'project.document.props.item.positionMm.x': 999 },
    ]
    for (const changes of tampering) {
      await expect(db.transaction('rw', db.projects, async () => {
        await db.projects.update(source.sceneId, { status: 'ready' })
        await db.projects.update(source.sceneId, changes as never)
      })).rejects.toThrow(/局部坐标工程只允许整行替换/)
      expect(await raw<StoredProject>(db, 'projects', source.sceneId)).toEqual(before)
    }
    expect((await db.projects.get(source.sceneId))!.project).toEqual(changed.project)
  })

  it('keeps projects without coordinate encoding byte-for-byte equivalent in packages and IDB', async () => {
    const source = fixture(false), db = database(), stored = row(source.project)
    await db.open(); await db.projects.add(stored)
    expect(await raw<StoredProject>(db, 'projects', stored.sceneId)).toEqual(stored)
    await db.projects.update(stored.sceneId, { 'project.document.title': 'ordinary nested update' } as never)
    expect((await db.projects.get(stored.sceneId))!.project.document.title).toBe('ordinary nested update')
    const files = unzipSync(await exportProject(source, validation))
    expect(JSON.parse(new TextDecoder().decode(files['scene.json']))).toEqual(source.project.document)
    expect((await importProject(await exportProject(source, validation), validation)).project).toEqual(source.project)
  })

  it('preserves the saved local current and world API view after save/CAS or a later native write fails', async () => {
    const repo = repository(), source = fixture(), owner = source.project.document.sceneId
    await repo.save(source, null)
    const before = await raw<StoredProject>(repo.database, 'projects', owner), loaded = await repo.load(owner)
    expect(before!.project.document.aggregateCoordinates!.encoding).toBe('local')
    expect(loaded!.project).toEqual(source.project)
    const next = { ...source, project: cloneJson(source.project) }
    next.project.document.revision = 1; next.project.document.title = 'next'
    await expect(repo.save(next, null)).rejects.toBeInstanceOf(ProjectConflictError)
    expect(await raw<StoredProject>(repo.database, 'projects', owner)).toEqual(before)
    const fail = () => { throw new Error('injected later storage failure') }
    repo.database.resourceBindings.hook('updating', fail)
    try { await expect(repo.save(next, 0)).rejects.toThrow(/injected later storage failure/) }
    finally { repo.database.resourceBindings.hook('updating').unsubscribe(fail) }
    expect(await raw<StoredProject>(repo.database, 'projects', owner)).toEqual(before)
    expect((await repo.load(owner))!.project).toEqual(source.project)
  })

  it('roundtrips real saved checkpoints and local deltas through public graph JSON with exact hashes', async () => {
    const repo = repository(), source = fixture(), owner = source.project.document.sceneId
    await repo.save(source, null)
    const next = { ...source, project: cloneJson(source.project) }
    next.project.document.revision = 1; next.project.document.title = 'graph revision one'
    next.project.document.props.item.positionMm = { x: 7000, y: 9000 }
    await repo.save(next, 0)
    const graph = { head: (await repo.database.historyHeads.get(owner))!, versions: await repo.database.historyVersions.toArray(), pins: await repo.database.historyPins.toArray() }
    const wire = JSON.parse(historyGraphJson(graph))
    expect(wire.versions.find((version: HistoryVersion) => version.checkpoint !== null).checkpoint.document.aggregateCoordinates.encoding).toBe('local')
    expect(wire.versions.some((version: HistoryVersion) => version.delta !== null)).toBe(true)
    const captured = captureHistoryGraph(wire), read = readHistoryGraphVersion(captured, captured.head.activeVersionId)
    expect(read).toEqual(next.project)
    expect(projectContentHash(read)).toBe(captured.head.contentHash)
    expect([...historyGraphProjects(wire)].map(projectContentHash)).toEqual([projectContentHash(source.project), projectContentHash(next.project)])
    expect(historyGraphJson(captured)).toBe(historyGraphJson(graph))
  })

  it('rejects checkpoint accessors before public history inputs can execute them', async () => {
    const repo = repository(), source = fixture(), owner = source.project.document.sceneId
    await repo.save(source, null)
    const graph = { head: (await repo.database.historyHeads.get(owner))!, versions: await repo.database.historyVersions.toArray(), pins: await repo.database.historyPins.toArray() }
    const version = graph.versions[0]
    let reads = 0
    const read = () => { reads++; return source.project.document }
    const root = Object.defineProperty(cloneJson(source.project), 'document', { get: read, enumerable: true })
    const nested = cloneJson(source.project)
    Object.defineProperty(nested.document, 'aggregateCoordinates', { get: read, enumerable: true })
    for (const checkpoint of [root, nested]) {
      const malformed = { ...version, checkpoint }
      expect(() => historyVersionBytes(malformed)).toThrow()
      expect(() => historyVersionJson(malformed)).toThrow()
      expect(() => captureHistoryGraph({ ...graph, versions: [malformed] })).toThrow()
      expect(() => readHistoryGraphVersion({ ...graph, versions: [malformed] }, malformed.id)).toThrow()
      expect(() => [...historyGraphProjects({ ...graph, versions: [malformed] })]).toThrow()
    }
    expect(reads).toBe(0)
  })
})
