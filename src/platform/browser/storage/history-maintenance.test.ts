import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { zlibSync } from 'fflate'
import { afterEach, describe, expect, it } from 'vitest'
import { concatBytes, imageProject, pixelPng, pngChunk } from '../../../io/v3/test-fixtures.js'
import { createCompositionContent } from '../../../shared/appearance/graph.js'
import { createHistoryIdentity } from '../../../shared/history/identity.js'
import type { ProjectBundle } from '../../../shared/model/project.js'
import type { SceneDocument } from '../../../shared/model/scene.js'
import type { CompleteValidationOptions, ResourceOptions } from '../../../shared/ports/resources.js'
import { sha256Bytes } from '../../../shared/project/binary.js'
import { createMemoryResources } from '../../../shared/project/resources.js'
import { projectContentHash } from '../../../shared/project/validate.js'
import { emptyTerrainDocument } from '../../../shared/terrain-generation/compose.js'
import { cloneJson, encodeUtf8 } from '../../../shared/validation/json.js'
import { emptyVisualSystem } from '../../../shared/visual/types.js'
import { PROJECT_TABLES, type StoredSnapshot } from './database.js'
import { collectUnusedResources, type HistoryMaintenanceChecks } from './history-maintenance.js'
import type { HistoryVersion } from './incremental-history.js'
import { nativeUpgradeCapsuleDocumentBytes, type NativeUpgradeContext } from './native-upgrade.js'
import { ProjectRepository } from './repository.js'

const NOW = '2026-10-30T00:00:00.000Z'
let sequence = 0
const runtime = { ids: { nextId: () => `maintenance-${++sequence}` }, clock: { now: () => NOW } }
const repositories: ProjectRepository[] = [], names = new Set<string>(), decodeTransactions: unknown[] = []
const validation: CompleteValidationOptions = { images: {
  async decode(_bytes, record) {
    decodeTransactions.push(Dexie.currentTransaction)
    return { width: record.pixelWidth, height: record.pixelHeight, rgba: new Uint8ClampedArray(record.pixelWidth * record.pixelHeight * 4) }
  },
  async transform(image) { return image }, async encodePng() { throw new Error('Storage must not encode') },
} }
function repository(): ProjectRepository {
  const name = `history-maintenance-${crypto.randomUUID()}`; names.add(name)
  const repo = new ProjectRepository({ name, validation, runtime }); repositories.push(repo); return repo
}
function checks(repo: ProjectRepository): HistoryMaintenanceChecks {
  const context = (repo as unknown as { nativeUpgradeContext(): NativeUpgradeContext }).nativeUpgradeContext()
  return { ...context, assertCapsule: row => { nativeUpgradeCapsuleDocumentBytes(row, context) } }
}
function collect(repo: ProjectRepository, options: ResourceOptions = {}) {
  return repo.database.transaction('rw', PROJECT_TABLES, () => collectUnusedResources(repo.database, checks(repo), options))
}
function uniquePixel(): Uint8Array {
  const marker = ++sequence, rgba = Uint8Array.of(0, marker & 255, marker >>> 8 & 255, marker >>> 16 & 255, 255)
  // Reuse the strict 1x1 RGBA header. Distinct actual pixels change the IDAT
  // hash without adding metadata that normalized project PNGs must reject.
  return concatBytes([pixelPng().subarray(0, 33), pngChunk('IDAT', zlibSync(rgba)), pngChunk('IEND', new Uint8Array())])
}
async function imageBundle(name: string): Promise<ProjectBundle> {
  const old = await imageProject(), bytes = uniquePixel(), imageHash = sha256Bytes(bytes)
  const document: SceneDocument = { ...cloneJson(old.document), format: 'sceneweave-scene', schemaVersion: 2, visual: emptyVisualSystem() }
  document.sceneId = `maintenance-image-${++sequence}`
  document.assets['test-image'].sha256 = imageHash
  const text = `Sceneweave original ${name}. CC0-1.0.`, licenseHash = sha256Bytes(encodeUtf8(text))
  return { project: { format: 'sceneweave-complete-project', schemaVersion: 2, ...createCompositionContent(document, runtime),
    assets: { [imageHash]: { sha256: imageHash, sizeBytes: bytes.length, mimeType: 'image/png', pixelWidth: 1, pixelHeight: 1 } },
    licenses: { [licenseHash]: { sha256: licenseHash, text } },
    licenseBindings: old.licenseBindings.map(binding => ({ ...binding, licensePath: `licenses/${licenseHash}.txt` })), authoringSources: {} },
  resources: createMemoryResources(new Map([[imageHash, bytes]])) }
}
function withoutImage(source: ProjectBundle, revision: number): ProjectBundle {
  const project = cloneJson(source.project)
  project.document.revision = revision; project.document.title = `Without image ${revision}`
  project.document.assets = {}; project.document.materials = {}; project.assets = {}; project.licenses = {}; project.licenseBindings = []
  return { project, resources: createMemoryResources({}) }
}
function upgraded(source: ProjectBundle): ProjectBundle {
  const project = cloneJson(source.project), document = emptyTerrainDocument(project.document)
  document.sceneId = `maintenance-upgrade-${++sequence}`; document.revision = 0
  project.schemaVersion = 3; project.document = document; project.historyIdentity = createHistoryIdentity(document, runtime)
  project.appearance = { ...project.appearance, version: 2, presentations: Object.fromEntries(Object.values(project.appearance.sources)
    .filter(source => source.kind === 'prop').map(source => [source.id, { mode: 'topDown' as const, rootAnchorMm: { x: 0, y: 0 }, orientation: 'rotateWithGround' as const, groundShadowMm: null }])) }
  return { project, resources: source.resources }
}
async function orphans(repo: ProjectRepository) {
  const bytes = uniquePixel(), resourceHash = sha256Bytes(bytes)
  const text = 'Genuinely unreferenced original license. CC0-1.0.', encoded = encodeUtf8(text), licenseHash = sha256Bytes(encoded)
  await repo.database.resources.add({ sha256: resourceHash, bytes })
  await repo.database.licenseTexts.add({ sha256: licenseHash, text })
  return { resourceHash, licenseHash, resourceBytes: bytes.length, licenseBytes: encoded.length }
}
async function installBytes(repo: ProjectRepository, bundle: ProjectBundle) {
  for (const hash of Object.keys(bundle.project.assets)) await repo.database.resources.put({ sha256: hash, bytes: await bundle.resources.read(hash) })
  for (const license of Object.values(bundle.project.licenses)) await repo.database.licenseTexts.put(license)
}
afterEach(async () => {
  for (const repo of repositories.splice(0)) repo.close()
  for (const name of names) await Dexie.delete(name)
  names.clear(); decodeTransactions.length = 0
})

describe('complete history resource maintenance', () => {
  it('public maintenance refreshes its receipt and accounts reclaimed actual bytes atomically', async () => {
    const repo = repository(), source = await imageBundle('public maintenance'), owner = source.project.document.sceneId
    await repo.save(source, null)
    await repo.usage(owner)
    const orphan = await orphans(repo), before = await repo.usage(owner)
    expect(await repo.maintainHistory(owner)).toEqual({ resourceCount: 1, resourceBytes: orphan.resourceBytes,
      licenseCount: 1, licenseBytes: orphan.licenseBytes })
    const after = await repo.usage(owner)
    expect(after.resourceBytes).toBe(before.resourceBytes - orphan.resourceBytes - orphan.licenseBytes)
    expect(after.documentBytes).toBe(before.documentBytes)
    expect((await repo.load(owner))!.project).toEqual(source.project)
  })
  it('retains every old branch and its removed bitmap beyond the latest twenty, deleting only real orphans', async () => {
    const repo = repository(), original = await imageBundle('historical branch'), owner = original.project.document.sceneId
    await repo.save(original, null)
    const root = (await repo.listHistoryVersions(owner)).versions[0]
    let current = withoutImage(original, 1); await repo.save(current, 0)
    current = withoutImage(original, 2)
    await repo.save(current, 1, { historyParentId: root.id, historyParentHash: root.contentHash })
    for (let revision = 3; revision <= 22; revision++) {
      current = withoutImage(original, revision); await repo.save(current, revision - 1)
    }
    expect((await repo.listAutomaticSnapshots(owner)).map(row => row.revision)).not.toContain(0)
    const before = { versions: await repo.database.historyVersions.toArray(), heads: await repo.database.historyHeads.toArray(), pins: await repo.database.historyPins.toArray() }
    const orphan = await orphans(repo), decoded = decodeTransactions.length
    const legacyBytes = encodeUtf8('permanently retained exact original'), legacyHash = sha256Bytes(legacyBytes)
    await repo.database.legacyBlobs.add({ sha256: legacyHash, bytes: legacyBytes })
    let versionReads = 0
    const observeVersionRead = (row: HistoryVersion) => { versionReads++; return row }
    repo.database.historyVersions.hook('reading', observeVersionRead)
    try {
      expect(await collect(repo)).toEqual({ resourceCount: 1, resourceBytes: orphan.resourceBytes, licenseCount: 1, licenseBytes: orphan.licenseBytes })
    } finally { repo.database.historyVersions.hook('reading').unsubscribe(observeVersionRead) }
    // The reference pass may audit orphan ownership, but never rereads every
    // ancestor chain separately for each retained version.
    expect(versionReads).toBeLessThanOrEqual(before.versions.length * 2)
    expect(await repo.database.resources.get(orphan.resourceHash)).toBeUndefined()
    expect(await repo.database.licenseTexts.get(orphan.licenseHash)).toBeUndefined()
    expect(await repo.database.resources.get(Object.keys(original.project.assets)[0])).toBeDefined()
    expect(await repo.database.licenseTexts.get(Object.keys(original.project.licenses)[0])).toBeDefined()
    expect(await repo.database.legacyBlobs.get(legacyHash)).toEqual({ sha256: legacyHash, bytes: legacyBytes })
    expect({ versions: await repo.database.historyVersions.toArray(), heads: await repo.database.historyHeads.toArray(), pins: await repo.database.historyPins.toArray() }).toEqual(before)
    expect(decodeTransactions).toHaveLength(decoded)
    expect((await repo.loadHistoryVersion(owner, root.id))!.project).toEqual(original.project)
    expect(await collect(repo)).toEqual({ resourceCount: 0, resourceBytes: 0, licenseCount: 0, licenseBytes: 0 })
  })

  it('retains old table scopes and capsule-only actual bitmap/license closure after the source rows are absent', async () => {
    const repo = repository(), source = await imageBundle('capsule-only'), target = upgraded(source), owner = source.project.document.sceneId
    await repo.save(source, null); await repo.preserveNativeUpgrade(source, target)
    const capsule = (await repo.exportNativeUpgradeCapsule(target.project.document.sceneId)).capsule
    const legacy = await Promise.all(['old automatic', 'old named', 'old protection', 'old imported'].map(imageBundle))
    await repo.database.transaction('rw', PROJECT_TABLES, async () => {
      await repo.database.projects.delete(owner); await repo.database.historyMetadata.delete(owner)
      for (const table of [repo.database.historyVersions, repo.database.historyPins, repo.database.resourceBindings]) await table.where('ownerSceneId').equals(owner).delete()
      await repo.database.historyHeads.delete(owner)
    })
    const [automatic, ...snapshotBundles] = legacy
    await installBytes(repo, automatic)
    await repo.database.automaticSnapshots.add({ ownerSceneId: automatic.project.document.sceneId, revision: 0, savedAt: NOW,
      contentHash: projectContentHash(automatic.project), project: automatic.project })
    for (const [index, bundle] of snapshotBundles.entries()) {
      await installBytes(repo, bundle)
      const row: StoredSnapshot = { id: `old-snapshot-${index}`, ownerSceneId: bundle.project.document.sceneId,
        lineageId: bundle.project.historyIdentity.lineageId, sourceRevision: 0, name: `Old snapshot ${index}`,
        kind: index === 0 ? 'named' : index === 1 ? 'protection' : 'imported-auto', createdAt: NOW,
        contentHash: projectContentHash(bundle.project), project: bundle.project }
      await (row.kind === 'imported-auto' ? repo.database.importedSnapshots : repo.database.snapshots).add(row)
    }
    const orphan = await orphans(repo), decoded = decodeTransactions.length
    expect(await collect(repo)).toMatchObject({ resourceCount: 1, resourceBytes: orphan.resourceBytes, licenseCount: 1, licenseBytes: orphan.licenseBytes })
    for (const bundle of [source, ...legacy]) {
      expect(await repo.database.resources.get(Object.keys(bundle.project.assets)[0])).toBeDefined()
      expect(await repo.database.licenseTexts.get(Object.keys(bundle.project.licenses)[0])).toBeDefined()
    }
    expect(await repo.database.nativeUpgradeCapsules.get(capsule.capsuleId)).toEqual(capsule)
    expect(decodeTransactions).toHaveLength(decoded)
  })

  it('refuses missing referenced bytes or corrupt orphan bytes before deleting any candidate', async () => {
    const repo = repository(), source = await imageBundle('missing closure')
    await repo.save(source, null)
    const orphan = await orphans(repo), requiredHash = Object.keys(source.project.assets)[0]
    const required = (await repo.database.resources.get(requiredHash))!
    await repo.database.resources.delete(requiredHash)
    await expect(collect(repo)).rejects.toThrow(/实际资源字节或许可正文缺失/)
    expect(await repo.database.resources.get(orphan.resourceHash)).toBeDefined()
    expect(await repo.database.licenseTexts.get(orphan.licenseHash)).toBeDefined()
    await repo.database.resources.put(required)
    await repo.database.resources.put({ sha256: orphan.resourceHash, bytes: new Uint8Array([1, 2, 3]) })
    await expect(collect(repo)).rejects.toThrow(/资源字节hash损坏/)
    expect(await repo.database.resources.get(orphan.resourceHash)).toBeDefined()
    expect(await repo.database.licenseTexts.get(orphan.licenseHash)).toBeDefined()
  })

  it('rolls every deletion back when a quota hook fails or cancellation arrives after the first delete', async () => {
    const repo = repository(), source = await imageBundle('transaction rollback')
    await repo.save(source, null)
    const orphan = await orphans(repo)
    const quota = () => { throw new DOMException('simulated cleanup quota failure', 'QuotaExceededError') }
    repo.database.licenseTexts.hook('deleting', quota)
    try { await expect(collect(repo)).rejects.toMatchObject({ name: 'QuotaExceededError' }) }
    finally { repo.database.licenseTexts.hook('deleting').unsubscribe(quota) }
    expect(await repo.database.resources.get(orphan.resourceHash)).toBeDefined()
    expect(await repo.database.licenseTexts.get(orphan.licenseHash)).toBeDefined()
    const signal = { aborted: false }, cancel = () => { signal.aborted = true }
    repo.database.resources.hook('deleting', cancel)
    try { await expect(collect(repo, { signal })).rejects.toMatchObject({ name: 'AbortError' }) }
    finally { repo.database.resources.hook('deleting').unsubscribe(cancel) }
    expect(await repo.database.resources.get(orphan.resourceHash)).toBeDefined()
    expect(await repo.database.licenseTexts.get(orphan.licenseHash)).toBeDefined()
  })

  it('requires the existing complete readwrite transaction', async () => {
    const repo = repository(); await repo.open()
    await expect(collectUnusedResources(repo.database, checks(repo))).rejects.toThrow(/完整工程库读写事务/)
    await expect(repo.database.transaction('r', PROJECT_TABLES, () => collectUnusedResources(repo.database, checks(repo)))).rejects.toThrow(/完整工程库读写事务/)
  })
})
