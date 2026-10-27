import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { unzipSync, zipSync } from 'fflate'
import { afterEach, describe, expect, it } from 'vitest'
import { layerSceneV3 } from '../../../core/v3/test-fixtures.js'
import { imageProject } from '../../../io/v3/test-fixtures.js'
import { createCompositionContent } from '../../../shared/appearance/graph.js'
import { createHistoryIdentity } from '../../../shared/history/identity.js'
import type { ProjectBundle } from '../../../shared/model/project.js'
import type { SceneDocument } from '../../../shared/model/scene.js'
import type { CompleteValidationOptions } from '../../../shared/ports/resources.js'
import { createMemoryResources } from '../../../shared/project/resources.js'
import { projectContentHash } from '../../../shared/project/validate.js'
import { decodeUtf8, sha256Bytes } from '../../../shared/project/binary.js'
import { canonicalJson, cloneJson, encodeUtf8 } from '../../../shared/validation/json.js'
import { emptyVisualSystem } from '../../../shared/visual/types.js'
import { emptyTerrainDocument } from '../../../shared/terrain-generation/compose.js'
import { CONVERTER_VERSION, TARGET_FORMAT, type ConversionJob } from '../../../shared/migration/types.js'
import { ProjectDatabase, PROJECT_STORES_V1 } from './database.js'
import { ProjectRepository } from './repository.js'
import type { NativeUpgradeTransfer, NativeUpgradeFamily, StoredNativeUpgradeCapsule } from './native-upgrade.js'
import { decodeNativeUpgradeFile } from './native-upgrade-file.js'

const NOW = '2026-10-26T00:00:00.000Z'
let sequence = 0
const names = new Set<string>(), repositories: ProjectRepository[] = [], decodeTransactions: unknown[] = []
const runtime = { ids: { nextId: () => `upgrade-token-${++sequence}` }, clock: { now: () => NOW } }
const validation: CompleteValidationOptions = { images: {
  async decode(_bytes, record) { decodeTransactions.push(Dexie.currentTransaction); return { width: record.pixelWidth, height: record.pixelHeight,
    rgba: new Uint8ClampedArray(record.pixelWidth * record.pixelHeight * 4) } },
  async transform(image) { return image }, async encodePng() { throw new Error('Storage must not encode') },
} }
function repository(name = `terrain-storage-${crypto.randomUUID()}`, options = validation): ProjectRepository {
  names.add(name)
  const repo = new ProjectRepository({ name, validation: options, runtime }); repositories.push(repo); return repo
}
function fixture(): ProjectBundle {
  const document: SceneDocument = { ...cloneJson(layerSceneV3()), format: 'sceneweave-scene', schemaVersion: 2, visual: emptyVisualSystem() }
  document.sceneId = `upgrade-source-${++sequence}`
  document.assets = {}; document.propDefinitions = {}; document.materials = {}; document.styleThemes = {}; document.activeStyleThemeRef = null
  return { project: { format: 'sceneweave-complete-project', schemaVersion: 2, ...createCompositionContent(document, runtime),
    assets: {}, licenses: {}, licenseBindings: [], authoringSources: {} }, resources: createMemoryResources({}) }
}
async function imageFixture(): Promise<ProjectBundle> {
  const old = await imageProject(), document: SceneDocument = { ...cloneJson(old.document), format: 'sceneweave-scene', schemaVersion: 2, visual: emptyVisualSystem() }
  document.sceneId = `upgrade-image-${++sequence}`
  const pairs = await Promise.all(Object.entries(old.assets).map(async ([hash, record]) => [hash, new Uint8Array(await record.blob.arrayBuffer())] as const))
  return { project: { format: 'sceneweave-complete-project', schemaVersion: 2, ...createCompositionContent(document, runtime),
    assets: Object.fromEntries(Object.entries(old.assets).map(([hash, { blob: _blob, ...record }]) => [hash, record])),
    licenses: old.licenses, licenseBindings: old.licenseBindings, authoringSources: {} }, resources: createMemoryResources(new Map(pairs)) }
}
function target(source: ProjectBundle): ProjectBundle {
  const project = cloneJson(source.project), document = emptyTerrainDocument(project.document)
  document.sceneId = `upgrade-target-${++sequence}`; document.revision = 0
  project.schemaVersion = 3; project.document = document; project.historyIdentity = createHistoryIdentity(document, runtime)
  project.appearance = { ...project.appearance, version: 2, presentations: Object.fromEntries(Object.values(project.appearance.sources)
    .filter(source => source.kind === 'prop').map(source => [source.id, { mode: 'topDown' as const, rootAnchorMm: { x: 0, y: 0 }, orientation: 'rotateWithGround' as const, groundShadowMm: null }])) }
  return { project, resources: source.resources }
}
function revision(source: ProjectBundle, value: number): ProjectBundle {
  const project = cloneJson(source.project); project.document.revision = value; project.document.title = `Source revision ${value}`
  return { project, resources: source.resources }
}
async function seedAllScopes(repo: ProjectRepository, initial = fixture()) {
  await repo.save(initial, null)
  const source = revision(initial, 1), owner = source.project.document.sceneId
  await repo.save(source, 0)
  const named = await repo.createSnapshot(source, 'Native named', { id: 'all-named', expectedRevision: 1, expectedMetadataVersion: 0 })
  await repo.createSnapshot(source, 'Native protection', { id: 'all-protection', kind: 'protection', expectedRevision: 1, expectedMetadataVersion: 1 })
  const stored = (await repo.database.snapshots.get([owner, named.id]))!
  await repo.database.importedSnapshots.add({ ...stored, id: 'all-imported', kind: 'imported-auto' })
  const binding = (await repo.database.resourceBindings.get([owner, 'named', named.id]))!
  await repo.database.resourceBindings.add({ ...binding, kind: 'imported-auto', recordId: 'all-imported' })
  const bytes = encodeUtf8('exact prior legacy original'), sourceHash = sha256Bytes(bytes)
  await repo.database.legacyBlobs.add({ sha256: sourceHash, bytes })
  await repo.database.legacySources.add({ ownerSceneId: owner, nodeId: 'prior-v6-original', previousNodeId: null, sourceSchemaVersion: 6,
    sourceSceneId: 'legacy-owner', sourceRevision: 12, sourceHash, migratorVersion: CONVERTER_VERSION, migratedAt: NOW })
  const identity = { sourceRepository: 'sceneweave-m1-outdoor', scopeId: 'legacy-owner', sourceFingerprint: 'a'.repeat(64), converterVersion: CONVERTER_VERSION, targetFormat: TARGET_FORMAT }
  const job: ConversionJob = { ...identity, jobId: 'original-conversion-journal', jobKey: sha256Bytes(encodeUtf8(canonicalJson(identity))),
    targetSceneId: owner, snapshotIds: {}, stage: 'captured', jobVersion: 0, createdAt: NOW, updatedAt: NOW, backupReceipt: null,
    sourceContentHashes: { current: sourceHash }, targetContentHashes: {}, contentHash: null, metadataVersion: null, failure: null }
  await repo.database.conversionJobs.add(job)
  return { source, owner, originalHash: sourceHash }
}
async function sourceRows(repo: ProjectRepository): Promise<Record<string, unknown[]>> {
  return Object.fromEntries(await Promise.all(Object.keys(PROJECT_STORES_V1).map(async name => [name, await repo.database.table(name).toArray()] as const)))
}
function copyTransfer(input: NativeUpgradeTransfer): NativeUpgradeTransfer {
  return { ...input, capsule: { ...input.capsule, family: {
    ...input.capsule.family, current: { ...input.capsule.family.current, project: cloneJson(input.capsule.family.current.project) },
  } }, ancestors: input.ancestors.slice(), resources: input.resources.map(row => ({ ...row, bytes: row.bytes.slice() })),
  legacyBlobs: input.legacyBlobs.map(row => ({ ...row, bytes: row.bytes.slice() })), licenses: input.licenses.map(row => ({ ...row })) }
}
function repack(files: Record<string, Uint8Array>): Uint8Array { return zipSync(files, { level: 6 }) }
function unpackZip(input: Uint8Array): Record<string, Uint8Array> { return unzipSync(input) }
function refreshManifest(files: Record<string, Uint8Array>): void {
  const manifest = JSON.parse(decodeUtf8(files['manifest.json'])) as { entries: { path: string; sha256: string; sizeBytes: number }[] }
  for (const row of manifest.entries) {
    const bytes = files[row.path]
    if (!bytes) throw new Error('Test fixture entry missing')
    row.sha256 = sha256Bytes(bytes); row.sizeBytes = bytes.length
  }
  files['manifest.json'] = encodeUtf8(canonicalJson(manifest))
}
/** Changes both ZIP names in place, leaving a real duplicate central-directory path. */
function duplicateZipPath(input: Uint8Array, from: string, to: string): Uint8Array {
  const bytes = input.slice(), view = new DataView(bytes.buffer), fromBytes = encodeUtf8(from), toBytes = encodeUtf8(to)
  if (fromBytes.length !== toBytes.length) throw new Error('Test path lengths must match')
  const end = bytes.length - 22, count = view.getUint16(end + 10, true)
  let cursor = view.getUint32(end + 16, true), replaced = false
  for (let i = 0; i < count; i++) {
    const nameSize = view.getUint16(cursor + 28, true), extraSize = view.getUint16(cursor + 30, true), commentSize = view.getUint16(cursor + 32, true)
    if (decodeUtf8(bytes.subarray(cursor + 46, cursor + 46 + nameSize)) === from) {
      bytes.set(toBytes, cursor + 46)
      const local = view.getUint32(cursor + 42, true)
      bytes.set(toBytes, local + 30); replaced = true
    }
    cursor += 46 + nameSize + extraSize + commentSize
  }
  if (!replaced) throw new Error('Test duplicate source missing')
  return bytes
}
function capsule(family: NativeUpgradeFamily, initialTarget: ProjectBundle): StoredNativeUpgradeCapsule {
  const targetSceneId = initialTarget.project.document.sceneId, targetInitialContentHash = projectContentHash(initialTarget.project), parentCapsuleIds: string[] = []
  const capsuleId = `native-upgrade-${sha256Bytes(encodeUtf8(canonicalJson({ family, parentCapsuleIds, targetSceneId, targetInitialContentHash })))}`
  const body = { format: 'sceneweave-native-upgrade-capsule' as const, version: 1 as const, capsuleId,
    sourceSceneId: family.current.sceneId, sourceContentHash: family.current.contentHash, targetSceneId, targetInitialContentHash,
    targetInitialProject: initialTarget.project, createdAt: NOW, family, resourceHashes: [], licenseHashes: [], legacyHashes: [], parentCapsuleIds }
  return { ...body, contentHash: sha256Bytes(encodeUtf8(canonicalJson(body))) }
}
afterEach(async () => {
  for (const repo of repositories.splice(0)) repo.close()
  for (const name of names) await Dexie.delete(name)
  names.clear(); decodeTransactions.length = 0
})

describe('explicit native database schema2 and complete original-family preservation', () => {
  it('incrementally adds the capsule store while retaining all exact native schema1 records', async () => {
    const seed = repository(); await seedAllScopes(seed, await imageFixture())
    const before = await sourceRows(seed), name = `native-schema1-${crypto.randomUUID()}`; names.add(name)
    const old = new Dexie(name); old.version(1).stores(PROJECT_STORES_V1); await old.open()
    for (const [table, rows] of Object.entries(before)) if (rows.length) await old.table(table).bulkAdd(rows)
    expect(old.backendDB().version).toBe(10); old.close()
    const upgraded = repository(name); await upgraded.open()
    expect(upgraded.database.verno).toBe(2); expect(upgraded.database.backendDB().version).toBe(20)
    expect(await sourceRows(upgraded)).toEqual(before)
    expect(await upgraded.database.nativeUpgradeCapsules.count()).toBe(0)
  })
  it('aborts a foreign database appearing after preflight before Dexie normalizes its stores', async () => {
    const name = `native-foreign-schema1-${crypto.randomUUID()}`; names.add(name)
    const foreign = new Dexie(name); foreign.version(1).stores({ ...PROJECT_STORES_V1, resources: 'sha256, foreignIndex', unexpected: 'id' })
    await foreign.open(); await foreign.table('unexpected').add({ id: 'retain', exact: 'external content' }); foreign.close()
    const candidate = new ProjectDatabase(name)
    try { await expect(candidate.open()).rejects.toThrow(/结构/) } finally { candidate.close() }
    const reread = new Dexie(name)
    try {
      await reread.open(); expect(reread.backendDB().version).toBe(10)
      expect(await reread.table('unexpected').get('retain')).toEqual({ id: 'retain', exact: 'external content' })
      expect(reread.table('resources').schema.indexes.map(index => index.name)).toEqual(['foreignIndex'])
    } finally { reread.close() }
  })
  it('preserves current, every history scope, exact originals, journal and bytes, then cold-reads without saving target', async () => {
    const repo = repository(), { source, owner, originalHash } = await seedAllScopes(repo, await imageFixture()), upgraded = target(source)
    const before = await sourceRows(repo), usageBefore = await repo.usage(owner)
    await repo.preserveNativeUpgrade(source, upgraded)
    expect(await repo.load(upgraded.project.document.sceneId)).toBeNull()
    expect(await sourceRows(repo)).toEqual(before)
    const cold = repository(repo.database.name), transfer = await cold.exportNativeUpgradeCapsule(upgraded.project.document.sceneId)
    expect(transfer.capsule).toMatchObject({ sourceSceneId: owner, sourceContentHash: projectContentHash(source.project),
      targetSceneId: upgraded.project.document.sceneId, targetInitialContentHash: projectContentHash(upgraded.project), parentCapsuleIds: [] })
    expect(transfer.capsule.family.automatic.map(row => row.revision)).toEqual([0, 1])
    expect(transfer.capsule.family.snapshots.map(row => row.kind).sort()).toEqual(['named', 'protection'])
    expect(transfer.capsule.family.importedSnapshots.map(row => row.id)).toEqual(['all-imported'])
    expect(transfer.capsule.family.conversionJobs.map(row => row.jobId)).toEqual(['original-conversion-journal'])
    expect(transfer.legacyBlobs.map(row => row.sha256)).toEqual([originalHash])
    expect(transfer.resources.length).toBeGreaterThan(0); expect(transfer.licenses.length).toBeGreaterThan(0)
    expect((await cold.usage(owner)).documentBytes).toBe(usageBefore.documentBytes + encodeUtf8(canonicalJson(transfer.capsule)).length)
    expect(decodeTransactions.length).toBeGreaterThan(0); expect(decodeTransactions.every(value => !value)).toBe(true)
    await repo.preserveNativeUpgrade(source, upgraded)
    expect(await repo.database.nativeUpgradeCapsules.count()).toBe(1)
    await repo.save(upgraded, null)
    expect((await repo.load(upgraded.project.document.sceneId))!.project).toEqual(upgraded.project)
  })
  it('exports/imports exact all-scope original families without installing source or target projects', async () => {
    const sourceRepo = repository(), { source, owner } = await seedAllScopes(sourceRepo, await imageFixture()), upgraded = target(source)
    await sourceRepo.preserveNativeUpgrade(source, upgraded)
    const transfer = await sourceRepo.exportNativeUpgradeCapsule(upgraded.project.document.sceneId), imported = repository()
    await imported.importNativeUpgradeCapsule(transfer)
    expect(await imported.load(owner)).toBeNull(); expect(await imported.load(upgraded.project.document.sceneId)).toBeNull()
    const reopened = repository(imported.database.name)
    expect(await reopened.exportNativeUpgradeCapsule(upgraded.project.document.sceneId)).toEqual(transfer)
    await reopened.importNativeUpgradeCapsule(transfer)
    expect(await reopened.database.nativeUpgradeCapsules.count()).toBe(1)
  })
  it('discovers lightweight originals metadata without resource reads or image decoding', async () => {
    const repo = repository(), { source, owner } = await seedAllScopes(repo, await imageFixture()), upgraded = target(source)
    expect(await repo.listNativeUpgradeSummaries(upgraded.project.document.sceneId)).toEqual([])
    await repo.preserveNativeUpgrade(source, upgraded)
    const beforeDecodes = decodeTransactions.length, summary = (await repo.listNativeUpgradeSummaries(upgraded.project.document.sceneId))[0]
    expect(summary).toEqual({ capsuleId: expect.any(String), sourceSceneId: owner, sourceTitle: source.project.document.title,
      sourceSchemaVersion: 2, sourceRevision: 1, sourceContentHash: projectContentHash(source.project),
      targetSceneId: upgraded.project.document.sceneId, createdAt: NOW, automaticCount: 2, namedCount: 1, protectionCount: 1,
      importedCount: 1, legacyOriginalCount: 1, parentCapsuleCount: 0 })
    expect(decodeTransactions.length).toBe(beforeDecodes)
    // Discovery remains metadata-only even if bytes later become unavailable;
    // full export still refuses to call that incomplete archive successful.
    await repo.database.resources.clear()
    expect(await repo.listNativeUpgradeSummaries(upgraded.project.document.sceneId)).toEqual([summary])
    await expect(repo.exportNativeUpgradeFile(upgraded.project.document.sceneId)).rejects.toThrow(/缺失/)
  })
  it('roundtrips actual ZIP originals with resources, license text and exact legacy bytes through a fresh cold library', async () => {
    const sourceRepo = repository(), { source, owner, originalHash } = await seedAllScopes(sourceRepo, await imageFixture()), upgraded = target(source)
    await sourceRepo.preserveNativeUpgrade(source, upgraded)
    const transfer = await sourceRepo.exportNativeUpgradeCapsule(upgraded.project.document.sceneId)
    const bytes = await sourceRepo.exportNativeUpgradeFile(upgraded.project.document.sceneId), files = unpackZip(bytes)
    expect(files[`legacy/${originalHash}.bin`]).toEqual(transfer.legacyBlobs[0].bytes)
    for (const row of transfer.resources) expect(files[`resources/${row.sha256}.bin`]).toEqual(row.bytes)
    for (const row of transfer.licenses) expect(decodeUtf8(files[`licenses/${row.sha256}.txt`])).toBe(row.text)
    expect(Object.keys(files).some(path => path.startsWith('projects/'))).toBe(true)
    expect(Object.keys(files).some(path => path.startsWith('bindings/'))).toBe(true)
    const imported = repository(), pending = imported.importNativeUpgradeFile(bytes)
    bytes.fill(0) // Decoder captures every caller byte before its first await.
    await pending
    expect(await imported.load(owner)).toBeNull(); expect(await imported.load(upgraded.project.document.sceneId)).toBeNull()
    const reopened = repository(imported.database.name)
    expect(await reopened.exportNativeUpgradeCapsule(upgraded.project.document.sceneId)).toEqual(transfer)
    expect(await reopened.list()).toEqual([])
  })
  it('rejects actual ZIP hash tampering, undeclared entries, traversal and duplicate directory/local paths before any write', async () => {
    const sourceRepo = repository(), { source } = await seedAllScopes(sourceRepo, await imageFixture()), upgraded = target(source)
    await sourceRepo.preserveNativeUpgrade(source, upgraded)
    const bytes = await sourceRepo.exportNativeUpgradeFile(upgraded.project.document.sceneId), imported = repository()
    const corrupt = unpackZip(bytes), resourcePath = Object.keys(corrupt).find(path => path.startsWith('resources/'))!
    corrupt[resourcePath][0] ^= 1
    await expect(imported.importNativeUpgradeFile(repack(corrupt))).rejects.toThrow(/SHA256/)
    const extra = unpackZip(bytes); extra[`resources/${'0'.repeat(64)}.bin`] = new Uint8Array([1])
    await expect(imported.importNativeUpgradeFile(repack(extra))).rejects.toThrow(/未声明/)
    const traversal = unpackZip(bytes); traversal['../capsule.json'] = new Uint8Array([1])
    await expect(imported.importNativeUpgradeFile(repack(traversal))).rejects.toThrow(/路径/)
    const projects = Object.keys(unpackZip(bytes)).filter(path => path.startsWith('projects/'))
    expect(projects.length).toBeGreaterThan(1)
    await expect(imported.importNativeUpgradeFile(duplicateZipPath(bytes, projects[0], projects[1]))).rejects.toThrow(/重复路径/)
    await imported.open(); expect(await imported.database.nativeUpgradeCapsules.count()).toBe(0)
    expect(await imported.list()).toEqual([])
  })
  it('rejects duplicate JSON aliases, unsafe keys and unknown capsule fields in actual ZIP files', async () => {
    const sourceRepo = repository(), source = fixture(), upgraded = target(source)
    await sourceRepo.save(source, null); await sourceRepo.preserveNativeUpgrade(source, upgraded)
    const bytes = await sourceRepo.exportNativeUpgradeFile(upgraded.project.document.sceneId), imported = repository()
    const duplicate = unpackZip(bytes), text = decodeUtf8(duplicate['manifest.json'])
    duplicate['manifest.json'] = encodeUtf8(`{"for\\u006dat":"sceneweave-native-upgrade-file",${text.slice(1)}`)
    await expect(imported.importNativeUpgradeFile(repack(duplicate))).rejects.toThrow(/重复字段/)
    for (const extra of ['"__proto__":{},', '"unexpected":true,']) {
      const files = unpackZip(bytes), capsuleText = decodeUtf8(files['capsule.json'])
      files['capsule.json'] = encodeUtf8(`{${extra}${capsuleText.slice(1)}`); refreshManifest(files)
      await expect(imported.importNativeUpgradeFile(repack(files))).rejects.toThrow(/字段|__proto__/)
    }
    await imported.open(); expect(await imported.database.nativeUpgradeCapsules.count()).toBe(0)
  })
  it('still runs full original-content verification after an attacker recomputes every outer ZIP entry hash', async () => {
    const sourceRepo = repository(), { source } = await seedAllScopes(sourceRepo), upgraded = target(source)
    await sourceRepo.preserveNativeUpgrade(source, upgraded)
    const files = unpackZip(await sourceRepo.exportNativeUpgradeFile(upgraded.project.document.sceneId))
    const capsuleFile = JSON.parse(decodeUtf8(files['capsule.json'])) as { family: { current: { projectPath: string } } }
    const oldPath = capsuleFile.family.current.projectPath, project = JSON.parse(decodeUtf8(files[oldPath])) as ProjectBundle['project']
    project.document.title = 'tampered complete original with refreshed outer hashes'
    const changed = encodeUtf8(canonicalJson(project)), newPath = `projects/${sha256Bytes(changed)}.json`
    files[newPath] = changed; delete files[oldPath]
    for (const path of Object.keys(files).filter(path => path === 'capsule.json' || path.startsWith('ancestors/'))) {
      files[path] = encodeUtf8(decodeUtf8(files[path]).replaceAll(oldPath, newPath))
    }
    const manifest = JSON.parse(decodeUtf8(files['manifest.json'])) as { entries: { path: string }[] }
    for (const row of manifest.entries) if (row.path === oldPath) row.path = newPath
    files['manifest.json'] = encodeUtf8(canonicalJson(manifest)); refreshManifest(files)
    // Container decoding succeeds: this is valid JSON/ZIP with matching entry hashes.
    const decoded = await decodeNativeUpgradeFile(repack(files))
    expect(decoded.capsule.family.current.project.document.title).toBe(project.document.title)
    const imported = repository()
    await expect(imported.importNativeUpgradeFile(repack(files))).rejects.toThrow(/hash/)
    await imported.open(); expect(await imported.database.nativeUpgradeCapsules.count()).toBe(0)
    expect(await imported.list()).toEqual([])
  })
  it('retains pre-existing native upgrade capsules and their source families across the next upgrade', async () => {
    const repo = repository(), source = fixture(), older = fixture()
    older.project.schemaVersion = 1; older.project.document.schemaVersion = 1; delete older.project.document.visual
    await repo.save(older, null); await repo.save(source, null)
    const owner = older.project.document.sceneId
    const prior = capsule({ current: (await repo.database.projects.get(owner))!, automatic: await repo.database.automaticSnapshots.where('ownerSceneId').equals(owner).toArray(),
      snapshots: [], importedSnapshots: [], bindings: await repo.database.resourceBindings.where('ownerSceneId').equals(owner).toArray(),
      metadata: (await repo.database.historyMetadata.get(owner))!, legacySources: [], conversionJobs: [] }, source)
    await repo.importNativeUpgradeCapsule({ format: 'sceneweave-native-upgrade-transfer', version: 1, capsule: prior, ancestors: [], resources: [], legacyBlobs: [], licenses: [] })
    const upgraded = target(source); await repo.preserveNativeUpgrade(source, upgraded)
    const transfer = await repo.exportNativeUpgradeCapsule(upgraded.project.document.sceneId)
    expect(transfer.capsule.parentCapsuleIds).toEqual([prior.capsuleId]); expect(transfer.ancestors).toEqual([prior])
    const file = await repo.exportNativeUpgradeFile(upgraded.project.document.sceneId)
    expect(Object.keys(unpackZip(file)).filter(path => path.startsWith('ancestors/'))).toEqual(['ancestors/00.json'])
    const fresh = repository(); await fresh.importNativeUpgradeFile(file)
    expect(await fresh.exportNativeUpgradeCapsule(upgraded.project.document.sceneId)).toEqual(transfer)
    expect((await fresh.exportNativeUpgradeCapsule(source.project.document.sceneId)).capsule).toEqual(prior)
    expect(await fresh.list()).toEqual([])
  })
  it('preserves all 105 current/history records beyond the selective archive batch of 85', async () => {
    const repo = repository(), source = revision(fixture(), 19), owner = source.project.document.sceneId
    await repo.save(source, null)
    const baseBinding = (await repo.database.resourceBindings.get([owner, 'current', 'current']))!
    for (let i = 0; i < 19; i++) {
      const automatic = revision(source, i)
      await repo.database.automaticSnapshots.add({ ownerSceneId: owner, revision: i, savedAt: NOW, contentHash: projectContentHash(automatic.project), project: automatic.project })
      await repo.database.resourceBindings.add({ ...baseBinding, kind: 'automatic', recordId: String(i) })
    }
    for (const [kind, count] of [['named', 32], ['protection', 32], ['imported-auto', 20]] as const) for (let i = 0; i < count; i++) {
      const id = `${kind}-${i}`, row = { id, ownerSceneId: owner, lineageId: source.project.historyIdentity.lineageId,
        sourceRevision: 19, name: id, kind, createdAt: NOW, contentHash: projectContentHash(source.project), project: source.project }
      await (kind === 'imported-auto' ? repo.database.importedSnapshots : repo.database.snapshots).add(row)
      await repo.database.resourceBindings.add({ ...baseBinding, kind, recordId: id })
    }
    const upgraded = target(source); await repo.preserveNativeUpgrade(source, upgraded)
    const { family } = (await repo.exportNativeUpgradeCapsule(upgraded.project.document.sceneId)).capsule
    expect(1 + family.automatic.length + family.snapshots.length + family.importedSnapshots.length).toBe(105)
    expect(family.bindings).toHaveLength(105)
    const fresh = repository(); await fresh.importNativeUpgradeFile(await repo.exportNativeUpgradeFile(upgraded.project.document.sceneId))
    expect((await fresh.exportNativeUpgradeCapsule(upgraded.project.document.sceneId)).capsule.family).toEqual(family)
  })
  it('rejects incomplete, altered or unknown transfer records before installing any capsule', async () => {
    const repo = repository(), { source } = await seedAllScopes(repo, await imageFixture()), upgraded = target(source)
    await repo.preserveNativeUpgrade(source, upgraded)
    const transfer = await repo.exportNativeUpgradeCapsule(upgraded.project.document.sceneId), fresh = repository()
    const incomplete = copyTransfer(transfer); incomplete.legacyBlobs = []
    await expect(fresh.importNativeUpgradeCapsule(incomplete)).rejects.toThrow(/旧格式原件/)
    const altered = copyTransfer(transfer); altered.capsule.family.current.project.document.title = 'tampered original'
    await expect(fresh.importNativeUpgradeCapsule(altered)).rejects.toThrow(/hash/)
    const corrupt = copyTransfer(transfer); corrupt.resources[0].bytes[0] ^= 1
    await expect(fresh.importNativeUpgradeCapsule(corrupt)).rejects.toThrow(/hash/)
    const unknown = { ...transfer, unexpected: true }
    await expect(fresh.importNativeUpgradeCapsule(unknown)).rejects.toThrow(/字段/)
    let reads = 0
    const accessor = { ...transfer }; Object.defineProperty(accessor, 'resources', { enumerable: true, get() { reads++; return transfer.resources } })
    await expect(fresh.importNativeUpgradeCapsule(accessor)).rejects.toThrow(/字段/); expect(reads).toBe(0)
    await fresh.open(); expect(await fresh.database.nativeUpgradeCapsules.count()).toBe(0)
  })
  it('rejects conflicting actual bytes atomically and cold-read tampering remains an explicit error', async () => {
    const repo = repository(), { source } = await seedAllScopes(repo, await imageFixture()), upgraded = target(source)
    await repo.preserveNativeUpgrade(source, upgraded)
    const transfer = await repo.exportNativeUpgradeCapsule(upgraded.project.document.sceneId), fresh = repository(); await fresh.open()
    await fresh.database.resources.add({ sha256: transfer.resources[0].sha256, bytes: new Uint8Array([1, 2, 3]) })
    await expect(fresh.importNativeUpgradeCapsule(transfer)).rejects.toThrow(/hash/)
    expect(await fresh.database.nativeUpgradeCapsules.count()).toBe(0)
    await repo.database.legacyBlobs.delete(transfer.legacyBlobs[0].sha256)
    await expect(repo.exportNativeUpgradeCapsule(upgraded.project.document.sceneId)).rejects.toThrow(/缺失/)
    expect(await repo.load(upgraded.project.document.sceneId)).toBeNull()
  })
  it('captures metadata and history changes during image validation in its final write CAS', async () => {
    const repo = repository(), { source, owner } = await seedAllScopes(repo, await imageFixture()), upgraded = target(source)
    let decodes = 0
    const validating = repository(repo.database.name, { images: { ...validation.images, async decode(bytes, record, options) {
      decodes++
      // Source+target validate first; family verification begins at the third decode.
      if (decodes === 3) await repo.renameSnapshot(owner, 'all-named', 'changed while preserving', projectContentHash(source.project), 2)
      return validation.images.decode(bytes, record, options)
    } } })
    await expect(validating.preserveNativeUpgrade(source, upgraded)).rejects.toThrow(/已变化/)
    expect(await repo.database.nativeUpgradeCapsules.count()).toBe(0)
    expect(await repo.load(upgraded.project.document.sceneId)).toBeNull()
  })
  it('requires a saved source, complete-v3 fresh target identity, independent lineage and revision0', async () => {
    const repo = repository(), source = fixture(), upgraded = target(source)
    await expect(repo.preserveNativeUpgrade(source, upgraded)).rejects.toThrow(/不存在/)
    await repo.save(source, null)
    await expect(repo.preserveNativeUpgrade(revision(source, 1), upgraded)).rejects.toThrow(/请先保存/)
    const sameIdentity = { project: cloneJson(upgraded.project), resources: upgraded.resources }
    sameIdentity.project.document.sceneId = source.project.document.sceneId
    await expect(repo.preserveNativeUpgrade(source, sameIdentity)).rejects.toThrow(/独立身份/)
    const sameLineage = { project: cloneJson(upgraded.project), resources: upgraded.resources }
    sameLineage.project.historyIdentity.lineageId = source.project.historyIdentity.lineageId
    await expect(repo.preserveNativeUpgrade(source, sameLineage)).rejects.toThrow(/lineage/)
    await repo.save(upgraded, null)
    await expect(repo.preserveNativeUpgrade(source, upgraded)).rejects.toThrow(/占用/)
  })
})
