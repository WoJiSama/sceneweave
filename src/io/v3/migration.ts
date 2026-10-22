import { migrateSceneV1 } from '../../core/v2/migration'
import { migrateSceneV2 } from '../../core/v3/migration'
import { readProjectV1 } from '../project-file'
import { exportProjectV2, importProjectV2, validateCompleteProjectV2 } from '../v2/project-file'
import type { CompleteProjectV2, MigrationSourceV2 } from '../v2/types'
import { parseBoundedJson } from './json'
import { checkCancelled, failV3, hasExactKeys, isSha256, PROJECT_LIMITS_V3 } from './limits'
import { validateCompleteProjectV3 } from './project-file'
import { sha256Bytes } from './resources'
import type { CompleteProjectV3, MigrationSourceV3 } from './types'

export const LAYER_MIGRATOR_VERSION_V3 = 'sceneweave-v2-v3@1'
const nonempty = (value: unknown, max = 256): value is string => typeof value === 'string' && value.length > 0 && Array.from(value).length <= max
const canonical = (value: unknown): string => JSON.stringify(value, (_key, item: unknown) => item !== null && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item)

function metadata(source: unknown, schema: 1 | 2, maxBytes: number, previous = false): asserts source is MigrationSourceV2 | MigrationSourceV3 {
  if (!hasExactKeys(source, ['sourceSchemaVersion', 'sourceSceneId', 'sourceRevision', 'sourceHash', 'migratorVersion', 'migratedAt', 'original'], previous ? ['previousSource'] : [])
    || source.sourceSchemaVersion !== schema || !nonempty(source.sourceSceneId) || !Number.isSafeInteger(source.sourceRevision) || Number(source.sourceRevision) < 0
    || !isSha256(source.sourceHash) || !nonempty(source.migratorVersion, 100) || !nonempty(source.migratedAt, 100) || !Number.isFinite(Date.parse(source.migratedAt))
    || !(source.original instanceof Blob) || !source.original.size || source.original.size > maxBytes) failV3('迁移原件记录无效。')
}

async function validatePreviousSource(source: MigrationSourceV2, signal?: AbortSignal): Promise<void> {
  metadata(source, 1, 10 * 1024 * 1024)
  checkCancelled(signal)
  if (await sha256Bytes(new Uint8Array(await source.original.arrayBuffer())) !== source.sourceHash) failV3('M0 迁移原件 SHA-256 不匹配。')
  const prefix = new Uint8Array(await source.original.slice(0, 4).arrayBuffer())
  const original = prefix[0] === 0x50 && prefix[1] === 0x4b
    ? await readProjectV1(source.original)
    : parseBoundedJson(new Uint8Array(await source.original.arrayBuffer()))
  const checked = migrateSceneV1(original, { now: source.migratedAt })
  if (!original || typeof original !== 'object' || !('sceneId' in original) || !('revision' in original)
    || original.sceneId !== source.sourceSceneId || original.revision !== source.sourceRevision || checked.revision !== 0) failV3('M0 迁移原件的场景身份或修订不匹配。')
  checkCancelled(signal)
}

/** Every local read/save verifies the complete strict v2 original, never just its claimed hash. */
export async function validateMigrationSourceV3(source: MigrationSourceV3 | undefined, targetSceneId: string, options: { signal?: AbortSignal } = {}): Promise<void> {
  if (source === undefined) return
  source = structuredClone(source)
  options = { ...options }
  metadata(source, 2, PROJECT_LIMITS_V3.compressedBytes, true)
  if (source.sourceSceneId === targetSceneId) failV3('迁移来源与目标不能使用同一场景身份；请创建新副本。')
  checkCancelled(options.signal)
  if (await sha256Bytes(new Uint8Array(await source.original.arrayBuffer())) !== source.sourceHash) failV3('迁移原件 SHA-256 不匹配。')
  const original = await importProjectV2(source.original, options)
  if (original.document.sceneId !== source.sourceSceneId || original.document.revision !== source.sourceRevision) failV3('迁移来源场景身份或修订与完整原件不匹配。')
  // This validates the migration contract without replacing an edited v3 target.
  migrateSceneV2(original.document, { sceneId: targetSceneId, now: source.migratedAt })
  if (source.previousSource !== undefined) {
    await validatePreviousSource(source.previousSource, options.signal)
    if (source.previousSource.sourceSceneId === source.sourceSceneId || source.previousSource.sourceSceneId === targetSceneId) failV3('迁移链必须保留各版本的独立场景身份。')
  }
  checkCancelled(options.signal)
}

function assertSameCompleteSource(candidate: CompleteProjectV2, original: CompleteProjectV2): void {
  const identity = (project: CompleteProjectV2) => ({ document: project.document, licenses: project.licenses, licenseBindings: project.licenseBindings,
    assets: Object.fromEntries(Object.entries(project.assets).map(([hash, record]) => [hash, { sha256: record.sha256, mimeType: record.mimeType,
      sizeBytes: record.sizeBytes, pixelWidth: record.pixelWidth, pixelHeight: record.pixelHeight }])) })
  // Both sides have just passed complete byte/hash/decode validation. Their full
  // documents, definitions, resource metadata and license bindings must agree.
  if (canonical(identity(candidate)) !== canonical(identity(original))) failV3('提供的 v2 原件与待迁移完整工程内容不匹配；不能只凭 sceneId/revision 采用。')
}

/** Explicit independent v2 -> v3 copy. The supplied original is retained byte-for-byte. */
export async function createLayerProject(source: CompleteProjectV2, options: { original?: Blob; sceneId?: string; now?: string; signal?: AbortSignal } = {}): Promise<CompleteProjectV3> {
  options = { ...options }
  checkCancelled(options.signal)
  const snapshot = structuredClone(source), stamp = options.now ?? new Date().toISOString()
  await validateCompleteProjectV2(snapshot, options)
  // Optional means absent/undefined only. A falsy supplied record is corrupt
  // provenance and must not become a successful migration without its source.
  if (snapshot.migrationSource !== undefined) await validatePreviousSource(snapshot.migrationSource, options.signal)
  const original = options.original ?? await exportProjectV2(snapshot, options)
  const restored = await importProjectV2(original, options)
  assertSameCompleteSource(snapshot, restored)
  const document = migrateSceneV2(snapshot.document, { sceneId: options.sceneId, now: stamp })
  const project: CompleteProjectV3 = { document, assets: snapshot.assets, licenses: snapshot.licenses, licenseBindings: snapshot.licenseBindings,
    migrationSource: { sourceSchemaVersion: 2, sourceSceneId: snapshot.document.sceneId, sourceRevision: snapshot.document.revision,
      sourceHash: await sha256Bytes(new Uint8Array(await original.arrayBuffer())), migratorVersion: LAYER_MIGRATOR_VERSION_V3, migratedAt: stamp, original,
      ...(snapshot.migrationSource !== undefined ? { previousSource: snapshot.migrationSource } : {}) } }
  await validateCompleteProjectV3(project, options)
  return project
}

/** Return verified local originals independently; complete v3 ZIPs never embed them. */
export async function migrationOriginalV3(project: CompleteProjectV3, schema: 1 | 2 = 2, options: { signal?: AbortSignal } = {}): Promise<Blob | null> {
  if (schema !== 1 && schema !== 2) failV3('只支持下载 M0/v2 迁移原件。')
  // Return the same captured source that passed validation, even when a caller
  // mutates its project while hashing or decoding is pending.
  const source = structuredClone(project.migrationSource), targetSceneId = project.document.sceneId
  await validateMigrationSourceV3(source, targetSceneId, options)
  return schema === 2 ? source?.original ?? null : source?.previousSource?.original ?? null
}
