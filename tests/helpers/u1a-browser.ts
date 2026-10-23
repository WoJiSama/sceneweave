import { createC5MigrationChain } from '../c5-storage-fixtures'
import { createC3ProjectV5 } from '../c3-fixtures'
import { SceneRepository } from '../../src/io/storage'
import { SceneRepositoryV2 } from '../../src/io/v2/storage'
import { SceneRepositoryV3 } from '../../src/io/v3/storage'
import { SceneRepositoryV4 } from '../../src/io/v4/storage'
import { SceneRepositoryV5 } from '../../src/io/v5/storage'
import { SceneRepositoryV6 } from '../../src/io/v6/storage'
import { exportProjectV5, importProjectV5, projectContentHashV5 } from '../../src/io/v5/project-file'
import { migrateProjectV5ToV6, migrationOriginalV6 } from '../../src/io/v6/migration'
import { projectContentHashV6 } from '../../src/io/v6/project-file'
import type { CompleteProjectV6 } from '../../src/io/v6/types'

/** Browser-only fixtures. Repository writes, IDB reads, hashes and image decoding are native Chromium work. */
export const U1A_DATABASES = ['sceneweave-m0', 'sceneweave-m1', 'sceneweave-m1-layers', 'sceneweave-m1-history', 'sceneweave-m1-composition', 'sceneweave-m1-outdoor'] as const
export const U1A_SHARED_ID = 'u1a-identical-id'
export const U1A_SHARED_TITLE = '同名工程 · 六个独立仓库'
export const U1A_BROKEN_ID = 'u1a-broken-row'

const digest = async (bytes: ArrayBuffer) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map(value => value.toString(16).padStart(2, '0')).join('')

async function openExisting(name: string) {
  if (!(await indexedDB.databases()).some(item => item.name === name)) return null
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(name)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
    request.onupgradeneeded = () => { request.transaction?.abort(); reject(new Error(`Read-only fixture found no existing database: ${name}`)) }
  })
}

async function portable(value: unknown): Promise<unknown> {
  if (value instanceof Blob) return { blobType: value.type, size: value.size, sha256: await digest(await value.arrayBuffer()) }
  if (value instanceof ArrayBuffer) return { arrayBuffer: value.byteLength, sha256: await digest(value) }
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return Promise.all(value.map(portable))
  if (value && typeof value === 'object') return Object.fromEntries(await Promise.all(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(async ([key, item]) => [key, await portable(item)])))
  return value
}

/** Includes every row, resource Blob, snapshot and migration original; it never creates a missing database. */
export async function fingerprintU1ADatabases(names: readonly string[] = U1A_DATABASES) {
  const result: Record<string, { version: number; stores: Record<string, { count: number; sha256: string }> } | null> = {}
  for (const name of names) {
    const database = await openExisting(name)
    if (!database) { result[name] = null; continue }
    try {
      const stores: Record<string, { count: number; sha256: string }> = {}
      for (const storeName of Array.from(database.objectStoreNames).sort()) {
        const rows = await new Promise<unknown[]>((resolve, reject) => {
          const request = database.transaction(storeName, 'readonly').objectStore(storeName).getAll()
          request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error)
        })
        stores[storeName] = { count: rows.length, sha256: await digest(new TextEncoder().encode(JSON.stringify(await portable(rows))).buffer) }
      }
      result[name] = { version: database.version, stores }
    } finally { database.close() }
  }
  return result
}

export async function seedU1ADiscoveryFixture() {
  const chain = await createC5MigrationChain()
  // These are independent valid projects, not a migration chain: only their display names/scene IDs collide.
  const first = structuredClone(chain.v1); first.sceneId = U1A_SHARED_ID; first.title = U1A_SHARED_TITLE
  const independent = <T extends { document: { sceneId: string; title: string }; migrationSource?: unknown; historyIdentity?: { rootSceneId: string } }>(input: T) => {
    const project = structuredClone(input)
    project.document.sceneId = U1A_SHARED_ID; project.document.title = U1A_SHARED_TITLE
    delete project.migrationSource
    if (project.historyIdentity) project.historyIdentity.rootSceneId = U1A_SHARED_ID
    return project
  }
  const v2 = independent(chain.v2), v3 = independent(chain.v3), v4 = independent(chain.v4), v5 = independent(chain.v5), v6 = independent(chain.v6)
  const r1 = new SceneRepository(), r2 = new SceneRepositoryV2(), r3 = new SceneRepositoryV3(), r4 = new SceneRepositoryV4(), r5 = new SceneRepositoryV5(), r6 = new SceneRepositoryV6()
  try {
    await r1.save(first, null); await r2.save(v2, null); await r3.save(v3, null)
    await r4.save(v4, null); await r5.save(v5, null); await r6.save(v6, null)
    await r4.createNamedSnapshot(v4, 'U1a v4 original named snapshot')
    await r5.createNamedSnapshot(v5, 'U1a v5 original named snapshot')
  } finally { for (const repository of [r1, r2, r3, r4, r5, r6]) repository.close() }
  // Deliberate native corruption is limited to an isolated test context. It must remain diagnosable and unchanged.
  const database = await openExisting(U1A_DATABASES[1])
  if (!database) throw new Error('Expected seeded native v2 repository')
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction('scenes', 'readwrite')
      transaction.objectStore('scenes').put({ sceneId: U1A_BROKEN_ID, revision: 0, savedAt: Date.now(), documentSchemaVersion: 2,
        document: { format: 'sceneweave', schemaVersion: 999, sceneId: U1A_BROKEN_ID, title: '损坏工程行，必须保留', revision: 0 } })
      transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); transaction.onabort = () => reject(transaction.error)
    })
  } finally { database.close() }
  return { sceneId: U1A_SHARED_ID, title: U1A_SHARED_TITLE, brokenId: U1A_BROKEN_ID, before: await fingerprintU1ADatabases() }
}

let migrationFixture: Awaited<ReturnType<typeof createC5MigrationChain>> | undefined
export async function seedU1AMigrationFixture() {
  const chain = migrationFixture = await createC5MigrationChain()
  const r1 = new SceneRepository(), r2 = new SceneRepositoryV2(), r3 = new SceneRepositoryV3(), r4 = new SceneRepositoryV4(), r5 = new SceneRepositoryV5()
  let nativeSourceContentHash: string | undefined
  try {
    await r1.save(chain.v1, null); await r2.save(chain.v2, null); await r3.save(chain.v3, null)
    await r4.save(chain.v4, null); await r5.save(chain.v5, null)
    await r4.createNamedSnapshot(chain.v4, 'U1a retained v4 history')
    await r5.createNamedSnapshot(chain.v5, 'U1a retained v5 history')
    const nativeSource = await r5.load(chain.v5.document.sceneId)
    if (!nativeSource) throw new Error('Expected persisted native v5 source')
    nativeSourceContentHash = await projectContentHashV5(nativeSource)
  } finally { for (const repository of [r1, r2, r3, r4, r5]) repository.close() }
  if (!nativeSourceContentHash) throw new Error('Native v5 source content was not checked')
  return { sourceSceneId: chain.v5.document.sceneId, sourceRevision: chain.v5.document.revision, nativeSourceContentHash,
    before: await fingerprintU1ADatabases(U1A_DATABASES.slice(0, 5)), existingAncestorHashes: await Promise.all(chain.originals.slice(0, 4).map(async original => digest(await original.arrayBuffer()))) }
}

export async function describeU1AUpgrade(project: CompleteProjectV6) {
  if (!migrationFixture) throw new Error('U1a original fixture is missing from this same page')
  const existingAncestors = []
  for (const schema of [1, 2, 3, 4] as const) {
    const actual = await migrationOriginalV6(project, schema)
    if (!actual) throw new Error(`Expected preserved v${schema} original`)
    const left = new Uint8Array(await actual.arrayBuffer()), right = new Uint8Array(await migrationFixture.originals[schema - 1].arrayBuffer())
    existingAncestors.push({ schema, sizeBytes: left.length, sha256: await digest(left.buffer), expectedHash: await digest(right.buffer), exact: left.length === right.length && left.every((value, index) => value === right[index]) })
  }
  // Native v5 stores complete content, not an earlier v5 ZIP. Its new capture can have different ZIP timestamps.
  const nativeCapture = await migrationOriginalV6(project, 5)
  if (!nativeCapture || !project.migrationSource) throw new Error('Expected newly captured complete native v5 original')
  const importedCapture = await importProjectV5(nativeCapture), nativeRepository = new SceneRepositoryV5()
  let currentNativeContentHash: string
  try {
    const nativeSource = await nativeRepository.load(migrationFixture.v5.document.sceneId)
    if (!nativeSource) throw new Error('Native v5 source disappeared after upgrade')
    currentNativeContentHash = await projectContentHashV5(nativeSource)
  } finally { nativeRepository.close() }
  // Full validation/hash covers document, identity, appearance, validated actual assets, licenses and bindings.
  // The separately retained migration source chain is covered by the exact v1-v4 byte comparisons above.
  const capturedNativeV5 = { sceneId: importedCapture.document.sceneId, revision: importedCapture.document.revision,
    sizeBytes: nativeCapture.size, actualBlobSha256: await digest(await nativeCapture.arrayBuffer()), recordedSourceHash: project.migrationSource.sourceHash,
    importedContentHash: await projectContentHashV5(importedCapture), currentNativeContentHash,
    fixtureContentHash: await projectContentHashV5(migrationFixture.v5) }
  return { sceneId: project.document.sceneId, revision: project.document.revision, sourceSceneId: project.migrationSource?.sourceSceneId,
    sourceRevision: project.migrationSource?.sourceRevision, contentHash: await projectContentHashV6(project), existingAncestors, capturedNativeV5,
    oldRepositories: await fingerprintU1ADatabases(U1A_DATABASES.slice(0, 5)) }
}

export async function createU1AProject(title = 'U1a 真实资源与会话夹具') {
  const source = await createC3ProjectV5({ title }), original = await exportProjectV5(source)
  return migrateProjectV5ToV6(source, { original })
}

export async function readU1ACurrent(project: CompleteProjectV6) {
  return { sceneId: project.document.sceneId, title: project.document.title, revision: project.document.revision,
    contentHash: await projectContentHashV6(project), document: structuredClone(project.document),
    historyIdentity: structuredClone(project.historyIdentity), appearance: structuredClone(project.appearance),
    assets: Object.fromEntries(await Promise.all(Object.entries(project.assets).map(async ([key, asset]) => [key, { sha256: asset.sha256, actualHash: await digest(await asset.blob.arrayBuffer()), sizeBytes: asset.sizeBytes }] as const))),
    licenses: Object.fromEntries(await Promise.all(Object.entries(project.licenses).map(async ([key, license]) => [key, { sha256: license.sha256, actualHash: await digest(new TextEncoder().encode(license.text).buffer) }] as const))) }
}
