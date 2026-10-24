import { readProjectV1 } from '../../io/project-file'
import { importProjectV2 } from '../../io/v2/project-file'
import { importProjectV3 } from '../../io/v3/project-file'
import { importProjectV4, importHistoryArchiveV4, inspectPackageModeV4, hashValidatedProjectV4 } from '../../io/v4/project-file'
import { importProjectV5, importHistoryArchiveV5, inspectPackageModeV5, hashValidatedProjectV5 } from '../../io/v5/project-file'
import { importProjectV6, importHistoryArchiveV6, inspectPackageModeV6, inspectProjectVersionV6, hashValidatedProjectV6 } from '../../io/v6/project-file'
import type { CompleteProjectV2 } from '../../io/v2/types'
import type { CompleteProjectV3 } from '../../io/v3/types'
import type { CompleteProjectV4, NamedSnapshotV4 } from '../../io/v4/types'
import type { CompleteProjectV5, NamedSnapshotV5 } from '../../io/v5/types'
import type { CompleteProjectV6, NamedSnapshotV6 } from '../../io/v6/types'
import type { SceneDocument } from '../../core/types'
import type { PreservationRecordInput, MigrationScope } from '../../shared/migration/types.js'
import { captureBytes, sha256Bytes } from '../../shared/project/binary.js'
import { sha256Text } from '../../shared/validation/hash.js'
import { canonicalJson, captureJson, freezeJson } from '../../shared/validation/json.js'
import { checkCancelled, type CancellationSignal } from '../../shared/ports/resources.js'
import { encodeLegacyRow } from './row-codec.js'
import { restoreLegacyCapture, type LegacyCapture, type LegacyRepository, type CaptureOptions } from './capture.js'

type Complete = CompleteProjectV2 | CompleteProjectV3 | CompleteProjectV4 | CompleteProjectV5 | CompleteProjectV6
type Named = NamedSnapshotV4 | NamedSnapshotV5 | NamedSnapshotV6
interface ReadFile { repository: LegacyRepository; document: SceneDocument | Complete['document']; project: Complete | null; snapshots: Named[] }
interface OwnedFile { bytes: Uint8Array; fingerprint: string; scopeJson: string }
const ownedFiles = new WeakMap<LegacyCapture, OwnedFile>()
const fileSnapshotKey = (repository: LegacyRepository, ownerSceneId: string, kind: 'named' | 'protection', id: string) => canonicalJson({ repository: `file-${repository}`, ownerSceneId, kind, id })
function fingerprint(scope: MigrationScope, records: readonly PreservationRecordInput[]): string {
  return sha256Text(canonicalJson({ scope, records: records.map(record => ({ role: record.role, recordKey: record.recordKey, sourceFormat: record.sourceFormat,
    contentHash: record.contentHash, rawSha256: sha256Bytes(record.bytes) })).sort((a, b) => a.recordKey < b.recordKey ? -1 : a.recordKey > b.recordKey ? 1 : 0) }))
}
async function readFile(bytes: Uint8Array, signal?: CancellationSignal): Promise<ReadFile> {
  checkCancelled(signal)
  const file = new Blob([bytes.slice().buffer]), options = { signal: signal as AbortSignal | undefined }, version = await inspectProjectVersionV6(file, options), repository = `v${version}` as LegacyRepository
  checkCancelled(signal)
  if (version === 1) { const document = await readProjectV1(file); checkCancelled(signal); return { repository, document, project: null, snapshots: [] } }
  if (version === 2 || version === 3) {
    const project = version === 2 ? await importProjectV2(file, options) : await importProjectV3(file, options)
    checkCancelled(signal); return { repository, document: project.document, project, snapshots: [] }
  }
  const mode = version === 4 ? await inspectPackageModeV4(file, options) : version === 5 ? await inspectPackageModeV5(file, options) : await inspectPackageModeV6(file, options)
  if (mode === 'complete') {
    const project = version === 4 ? await importProjectV4(file, options) : version === 5 ? await importProjectV5(file, options) : await importProjectV6(file, options)
    checkCancelled(signal); return { repository, document: project.document, project, snapshots: [] }
  }
  const archive = version === 4 ? await importHistoryArchiveV4(file, options) : version === 5 ? await importHistoryArchiveV5(file, options) : await importHistoryArchiveV6(file, options)
  checkCancelled(signal); return { repository, document: archive.project.document, project: archive.project, snapshots: archive.snapshots }
}
async function semanticHash(project: Complete | null, document: ReadFile['document'], repository: LegacyRepository): Promise<string> {
  if (!project) return sha256Text(canonicalJson(document))
  if (repository === 'v4') return hashValidatedProjectV4(project as CompleteProjectV4)
  if (repository === 'v5') return hashValidatedProjectV5(project as CompleteProjectV5)
  if (repository === 'v6') return hashValidatedProjectV6(project as CompleteProjectV6)
  return sha256Text(canonicalJson({ document, assets: Object.fromEntries(Object.entries(project.assets).map(([key, { blob: _blob, ...record }]) => [key, record])), licenses: project.licenses, licenseBindings: project.licenseBindings }))
}

/** Captures the exact uploaded bytes. The strict legacy reader determines its version and history. */
export async function captureLegacyFile(input: Uint8Array, options: CaptureOptions = {}): Promise<LegacyCapture> {
  const bytes = captureBytes(input, 100 * 1024 * 1024), read = await readFile(bytes, options.signal), owner = read.document.sceneId
  const hashes: Record<string, string> = { current: await semanticHash(read.project, read.document, read.repository) }, snapshotKeys: string[] = []
  for (const snapshot of read.snapshots) {
    const key = fileSnapshotKey(read.repository, owner, snapshot.kind, snapshot.id)
    snapshotKeys.push(key); hashes[key] = snapshot.contentHash
  }
  const scope: MigrationScope = { kind: 'project-family', repository: `file-${read.repository}`, sourceSceneId: owner }
  const records: PreservationRecordInput[] = [{ role: 'current', recordKey: 'input.sceneweave', sourceFormat: `sceneweave-file-${read.repository}@1`, contentHash: hashes.current, bytes: bytes.slice() }]
  const sourceFingerprint = fingerprint(scope, records)
  const capture: LegacyCapture = { scope: freezeJson(scope), sourceFingerprint, records, snapshotKeys: freezeJson(snapshotKeys.sort()), sourceContentHashes: freezeJson(hashes) }
  Object.freeze(records[0]); Object.freeze(records); Object.freeze(capture)
  checkCancelled(options.signal); ownedFiles.set(capture, { bytes, fingerprint: sourceFingerprint, scopeJson: canonicalJson(scope) }); return capture
}
export async function restoreLegacyFileCapture(scopeInput: MigrationScope, inputs: readonly PreservationRecordInput[], signal?: CancellationSignal): Promise<LegacyCapture> {
  const scope = captureJson(scopeInput)
  if (Object.keys(scope).sort().join(',') !== 'kind,repository,sourceSceneId' || scope.kind !== 'project-family' || !/^file-v[1-6]$/.test(scope.repository)
    || !Array.isArray(inputs) || Object.getPrototypeOf(inputs) !== Array.prototype || Reflect.ownKeys(inputs).length !== 2 || inputs.length !== 1) throw new Error('旧文件保全scope或完整原文件记录无效。')
  const descriptor = Object.getOwnPropertyDescriptor(inputs, '0')
  if (!descriptor?.enumerable || !('value' in descriptor) || !descriptor.value || typeof descriptor.value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(descriptor.value))) throw new Error('旧文件保全记录必须是普通数据。')
  const fields = ['role', 'recordKey', 'sourceFormat', 'contentHash', 'bytes'], descriptors = Object.getOwnPropertyDescriptors(descriptor.value)
  if (Reflect.ownKeys(descriptor.value).length !== fields.length || !fields.every(key => descriptors[key]?.enumerable && 'value' in descriptors[key])) throw new Error('旧文件记录含未知、隐藏、Symbol或访问器字段。')
  const metadata = captureJson(Object.fromEntries(fields.filter(key => key !== 'bytes').map(key => [key, descriptors[key].value])))
  const bytes = captureBytes(descriptors.bytes.value, 100 * 1024 * 1024), captured = await captureLegacyFile(bytes, { signal })
  if (canonicalJson(captured.scope) !== canonicalJson(scope) || canonicalJson({ role: captured.records[0].role, recordKey: captured.records[0].recordKey,
    sourceFormat: captured.records[0].sourceFormat, contentHash: captured.records[0].contentHash }) !== canonicalJson(metadata)) throw new Error('旧文件保全的实际版本、原场景或语义hash不匹配。')
  return captured
}
export function legacyFileCaptureBytes(capture: LegacyCapture): Uint8Array | undefined {
  const file = ownedFiles.get(capture)
  if (!file) return
  if (capture.sourceFingerprint !== file.fingerprint || canonicalJson(capture.scope) !== file.scopeJson || fingerprint(capture.scope, capture.records) !== file.fingerprint) throw new Error('旧文件捕获记录已修改。')
  return file.bytes.slice()
}

/** These normalized rows exist only in memory to reuse conversion rules. They are
 * never exported as original IDB records or written back into a legacy database. */
export async function deriveLegacyFileFamily(bytes: Uint8Array, signal?: CancellationSignal): Promise<{ capture: LegacyCapture; repository: LegacyRepository; sourceSceneId: string; sourceRevision: number; sourceContentHashes: Record<string, string> }> {
  const read = await readFile(bytes, signal), repository = read.repository, owner = read.document.sceneId, rows: { store: string; key: unknown; value: Record<string, unknown> }[] = []
  const stamp = Math.max(0, Date.parse(read.document.updatedAt))
  if (repository === 'v1') rows.push({ store: 'scenes', key: owner, value: { sceneId: owner, revision: read.document.revision, document: read.document, savedAt: stamp } })
  else {
    const project = read.project!, metadata = { documentSchemaVersion: repository === 'v2' ? 2 : 3, document: project.document,
      ...(repository >= 'v3' ? { migrationSourceHash: project.migrationSource?.sourceHash ?? null } : {}),
      ...(repository >= 'v4' ? { historyIdentity: (project as CompleteProjectV4).historyIdentity, contentHash: await semanticHash(project, project.document, repository) } : {}),
      ...(repository >= 'v5' ? { appearance: (project as CompleteProjectV5).appearance } : {}) }
    rows.push({ store: 'scenes', key: owner, value: { ...metadata, sceneId: owner, revision: project.document.revision, savedAt: stamp } })
    const binding = (value: Complete) => ({ assetHashes: Object.keys(value.assets), licenseHashes: Object.keys(value.licenses), licenseBindings: value.licenseBindings })
    rows.push({ store: 'resourceBindings', key: [owner, project.document.revision], value: { sceneId: owner, revision: project.document.revision, ...binding(project) } })
    if (repository >= 'v4') rows.push({ store: 'historyMetadata', key: owner, value: { sceneId: owner, metadataVersion: read.snapshots.length } })
    const allProjects = [project, ...read.snapshots.map(snapshot => snapshot.project)], assetMap = new Map<string, unknown>(), licenseMap = new Map<string, unknown>()
    for (const value of allProjects) {
      Object.entries(value.assets).forEach(([key, record]) => assetMap.set(key, record)); Object.entries(value.licenses).forEach(([key, record]) => licenseMap.set(key, record))
    }
    for (const [key, value] of assetMap) rows.push({ store: 'assetBlobs', key, value: value as Record<string, unknown> })
    for (const [key, value] of licenseMap) rows.push({ store: 'licenseTexts', key, value: value as Record<string, unknown> })
    if (project.migrationSource) rows.push({ store: 'migrationSources', key: owner, value: { sceneId: owner, ...project.migrationSource } })
    for (const snapshot of read.snapshots) {
      const source = snapshot.project, { project: _project, ...summary } = snapshot
      rows.push({ store: snapshot.kind === 'named' ? 'namedSnapshots' : 'protectionSnapshots', key: [owner, snapshot.id], value: { ...summary, sceneId: owner,
        documentSchemaVersion: 3, document: source.document, historyIdentity: source.historyIdentity, contentHash: snapshot.contentHash,
        migrationSourceHash: source.migrationSource?.sourceHash ?? null, ...(repository >= 'v5' ? { appearance: (source as CompleteProjectV5).appearance } : {}) } })
      rows.push({ store: 'namedResourceBindings', key: [owner, snapshot.id], value: { sceneId: owner, snapshotId: snapshot.id, ...binding(source) } })
    }
  }
  const roles: Record<string, PreservationRecordInput['role']> = { scenes: 'current', resourceBindings: 'resource-binding', namedResourceBindings: 'resource-binding', namedSnapshots: 'named', protectionSnapshots: 'protection',
    assetBlobs: 'resource', licenseTexts: 'license', historyMetadata: 'history-metadata', migrationSources: 'legacy-source' }
  const records: PreservationRecordInput[] = []
  for (const row of rows) {
    const raw = await encodeLegacyRow(row.value)
    records.push({ role: roles[row.store], recordKey: canonicalJson([row.store, row.key]), sourceFormat: `sceneweave-idb-${repository}@1`, contentHash: typeof row.value.contentHash === 'string' ? row.value.contentHash : sha256Bytes(raw), bytes: raw })
  }
  const capture = await restoreLegacyCapture({ kind: 'project-family', repository, sourceSceneId: owner }, records, signal)
  const sourceContentHashes: Record<string, string> = { current: await semanticHash(read.project, read.document, repository) }
  for (const snapshot of read.snapshots) sourceContentHashes[fileSnapshotKey(repository, owner, snapshot.kind, snapshot.id)] = snapshot.contentHash
  return { capture, repository, sourceSceneId: owner, sourceRevision: read.document.revision, sourceContentHashes }
}
export const legacyFileSnapshotSourceKey = fileSnapshotKey
