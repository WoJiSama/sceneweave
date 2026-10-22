import { createHistoryIdentityV4 } from '../../core/v4/identity'
import { exportProjectV3, importProjectV3, validateCompleteProjectV3 } from '../v3/project-file'
import { validateMigrationSourceV3 } from '../v3/migration'
import { sha256Bytes } from '../v3/resources'
import type { CompleteProjectV3 } from '../v3/types'
import { checkCancelled, failV4, hasExactKeys, isSha256, PROJECT_LIMITS_V4 } from './limits'
import { canonicalJsonV4, toCompleteProjectV3, validateCompleteProjectV4 } from './project-file'
import type { CompleteProjectV4, MigrationSourceV4 } from './types'

export const HISTORY_MIGRATOR_VERSION_V4 = 'sceneweave-v3-v4@1'
const nonempty = (value: unknown, max = 256): value is string => typeof value === 'string' && value.length > 0 && value.length <= max

/** Local provenance is validated byte-for-byte and remains separate from portable packages. */
export async function validateMigrationSourceV4(input: MigrationSourceV4 | undefined, targetSceneId: string, options: { signal?: AbortSignal } = {}): Promise<void> {
  if (input === undefined) return
  const source = structuredClone(input)
  if (!hasExactKeys(source, ['sourceSchemaVersion', 'sourceSceneId', 'sourceRevision', 'sourceHash', 'migratorVersion', 'migratedAt', 'original'], ['previousSource'])
    || source.sourceSchemaVersion !== 3 || !nonempty(source.sourceSceneId) || source.sourceSceneId === targetSceneId
    || !Number.isSafeInteger(source.sourceRevision) || source.sourceRevision < 0 || !isSha256(source.sourceHash)
    || !nonempty(source.migratorVersion, 100) || !nonempty(source.migratedAt, 100) || !Number.isFinite(Date.parse(source.migratedAt))
    || !(source.original instanceof Blob) || source.original.size < 1 || source.original.size > PROJECT_LIMITS_V4.compressedBytes) failV4('v3迁移原件记录无效。')
  checkCancelled(options.signal)
  if (await sha256Bytes(new Uint8Array(await source.original.arrayBuffer())) !== source.sourceHash) failV4('v3迁移原件SHA-256不匹配。')
  const original = await importProjectV3(source.original, options)
  if (original.document.sceneId !== source.sourceSceneId || original.document.revision !== source.sourceRevision) failV4('v3迁移原件场景身份或修订与完整原件不匹配。')
  if (source.previousSource !== undefined) {
    await validateMigrationSourceV3(source.previousSource, source.sourceSceneId, options)
    if (source.previousSource.sourceSceneId === targetSceneId || source.previousSource.previousSource?.sourceSceneId === targetSceneId) failV4('迁移链必须使用各版本独立场景身份。')
  }
  checkCancelled(options.signal)
}

const contentOfV3 = (project: CompleteProjectV3) => ({ document: project.document, licenses: project.licenses, licenseBindings: project.licenseBindings,
  assets: Object.fromEntries(Object.entries(project.assets).map(([hash, record]) => [hash, { sha256: record.sha256, mimeType: record.mimeType,
    sizeBytes: record.sizeBytes, pixelWidth: record.pixelWidth, pixelHeight: record.pixelHeight }])) })

/** Copies the entire strict v3 scene, assigns a new scene identity/r0, and retains exact originals. */
export async function migrateProjectV3ToV4(input: CompleteProjectV3, options: { signal?: AbortSignal; original?: Blob; sceneId?: string; now?: string } = {}): Promise<CompleteProjectV4> {
  checkCancelled(options.signal)
  const captured = structuredClone(input), stamp = options.now ?? new Date().toISOString(), sceneId = options.sceneId ?? crypto.randomUUID()
  await validateCompleteProjectV3(captured, options)
  if (sceneId === captured.document.sceneId) failV4('迁移必须保存为独立场景副本。')
  const original = options.original ?? await exportProjectV3(captured, options), restored = await importProjectV3(original, options)
  if (canonicalJsonV4(contentOfV3(captured)) !== canonicalJsonV4(contentOfV3(restored))) failV4('提供的v3原件与待迁移完整工程内容不一致。')
  const document = structuredClone(captured.document)
  Object.assign(document, { sceneId, revision: 0, createdAt: stamp, updatedAt: stamp })
  const historyIdentity = createHistoryIdentityV4(captured.document)
  const result: CompleteProjectV4 = { document, historyIdentity, assets: captured.assets, licenses: captured.licenses, licenseBindings: captured.licenseBindings,
    migrationSource: { sourceSchemaVersion: 3, sourceSceneId: captured.document.sceneId, sourceRevision: captured.document.revision,
      sourceHash: await sha256Bytes(new Uint8Array(await original.arrayBuffer())), migratorVersion: HISTORY_MIGRATOR_VERSION_V4, migratedAt: stamp, original,
      ...(captured.migrationSource !== undefined ? { previousSource: captured.migrationSource } : {}) } }
  await validateCompleteProjectV4(result, options)
  return result
}

export async function migrationOriginalV4(project: CompleteProjectV4, schema: 1 | 2 | 3 = 3, options: { signal?: AbortSignal } = {}): Promise<Blob | null> {
  if (schema !== 1 && schema !== 2 && schema !== 3) failV4('只支持下载M0/v2/v3迁移原件。')
  const captured = structuredClone(project.migrationSource)
  await validateMigrationSourceV4(captured, project.document.sceneId, options)
  if (schema === 3) return captured?.original ?? null
  if (schema === 2) return captured?.previousSource?.original ?? null
  return captured?.previousSource?.previousSource?.original ?? null
}

/** Public strict view is re-exported for convenient renderer integrations. */
export { toCompleteProjectV3 }
