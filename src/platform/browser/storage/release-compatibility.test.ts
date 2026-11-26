import 'fake-indexeddb/auto'
import { gunzipSync } from 'node:zlib'
import Dexie from 'dexie'
import { describe, expect, it } from 'vitest'
import { readReleaseFixture } from '../../../../tests/helpers/release-fixtures.js'
import { runtime, validation } from '../../../application/workspace/test-fixtures.js'
import { exportLibraryBackup, importLibraryBackup } from '../../../shared/library/backup.js'
import { loadLibraryCapsule, prepareLibraryEntry } from '../../../shared/library/content.js'
import { exportHistoryArchive, importProjectArchive } from '../../../shared/project/file.js'
import { projectContentHash } from '../../../shared/project/validate.js'
import { ProjectRepository } from './repository.js'

const rootHash = '0afe39e0b8d15412c0481184580731fa659bd6f06095523e62fa4468dab3d9cd'
const branchHash = '4b2fb39585a98744d783df605f01b63ae68fa2a36dddaa8bd545a10849dc7303'
const activeHash = '69ff5dcb2712ae9697be1037d587ad15830e067a4c26a76d2d586b271a747973'

interface FrozenDatabase {
  version: number
  schema: Record<string, { keyPath: string | string[]; indexes: { name: string; path: string | string[]; unique: boolean; multiEntry: boolean }[] }>
  stores: Record<string, unknown[]>
}

/** Restore physical records through native IDB. Current repository writers would re-encode the blocks. */
async function restoreReleaseDatabase(name: string): Promise<void> {
  const bytes = await readReleaseFixture('project-database.json.gz')
  const data: FrozenDatabase = JSON.parse(gunzipSync(bytes).toString('utf8'), (_, value) =>
    value?.type === 'Uint8Array' ? Uint8Array.from(Buffer.from(value.base64, 'base64')) : value)
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(name, data.version)
    request.onupgradeneeded = () => {
      for (const [table, schema] of Object.entries(data.schema)) {
        const store = request.result.createObjectStore(table, { keyPath: schema.keyPath })
        for (const index of schema.indexes) store.createIndex(index.name, index.path, { unique: index.unique, multiEntry: index.multiEntry })
        for (const row of data.stores[table] ?? []) store.add(row)
      }
    }
    request.onerror = () => reject(request.error)
    request.onsuccess = () => { request.result.close(); resolve() }
  })
}

describe('released v1 compatibility', () => {
  it('reads and re-exports the selected snapshot and its original identity, hash and pixels', async () => {
    const archive = await importProjectArchive(await readReleaseFixture('selected-history.sceneweave'), validation)
    expect(projectContentHash(archive.current.project)).toBe(activeHash)
    expect(archive.snapshots).toHaveLength(1)
    const [snapshot] = archive.snapshots
    expect(snapshot).toMatchObject({ id: 'opening', name: '开场', sourceRevision: 0, contentHash: rootHash })
    expect(projectContentHash(snapshot.bundle.project)).toBe(rootHash)
    const copy = await importProjectArchive(await exportHistoryArchive(archive, validation), validation)
    expect(copy.current.project).toEqual(archive.current.project)
    expect(copy.snapshots[0].bundle.project).toEqual(snapshot.bundle.project)
  })

  it('reopens a personal library backup and preserves its fixed identity across writer builds', async () => {
    const bytes = await readReleaseFixture('personal-library.json')
    const library = await importLibraryBackup(bytes, validation)
    expect(library.entries).toHaveLength(1)
    const [entry] = library.entries
    expect(library.organizations[entry.item.identity.key]).toEqual({ favorite: true, tags: ['备团'], colors: [] })
    const bundle = await loadLibraryCapsule(entry, validation)
    const current = await prepareLibraryEntry(bundle, entry.item.selector, validation)
    expect(current.item.identity).toEqual(entry.item.identity)
    expect(await exportLibraryBackup(library, validation)).toEqual(bytes)
  })

  it('cold-opens the released physical store, keeps both branches and a pin, then saves on the active branch', async () => {
    const name = 'release-v1-' + crypto.randomUUID(), owner = 'native-session-1'
    await restoreReleaseDatabase(name)
    const open = () => new ProjectRepository({ name, runtime, validation })
    let repo = open()
    try {
      const current = (await repo.load(owner))!
      expect(projectContentHash(current.project)).toBe(activeHash)
      const original = await repo.listHistoryVersions(owner)
      const root = original.versions.find(version => version.contentHash === rootHash)!
      expect(original.versions.filter(version => version.parentId === root.id).map(version => version.contentHash).sort()).toEqual([branchHash, activeHash].sort())
      for (const version of original.versions) {
        expect(projectContentHash((await repo.loadHistoryVersion(owner, version.id))!.project)).toBe(version.contentHash)
      }
      expect((await repo.loadSnapshot(owner, 'opening'))!.contentHash).toBe(rootHash)
      const project = structuredClone(current.project)
      project.document.revision++
      project.document.title = '跨版本继续编辑'
      project.extensions = { 'example.org/notes': { schemaVersion: 23, data: '  原分支没有的线索\r\n' } }
      await repo.save({ project, resources: current.resources }, current.project.document.revision)
      repo.close()
      repo = open()
      expect((await repo.load(owner))!.project).toEqual(project)
      const versions = (await repo.listHistoryVersions(owner)).versions
      expect(versions).toHaveLength(4)
      expect(versions).toEqual(expect.arrayContaining(original.versions))
      expect(versions.find(version => version.revision === 3)?.parentId).toBe(original.activeVersionId)
      expect((await repo.loadHistoryVersion(owner, original.activeVersionId!))!.project.extensions).toBeUndefined()
      expect(projectContentHash((await repo.loadSnapshot(owner, 'opening'))!.bundle.project)).toBe(rootHash)
    } finally { repo.close(); await Dexie.delete(name) }
  })
})
