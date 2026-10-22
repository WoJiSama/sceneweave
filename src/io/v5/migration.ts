import { createAppearanceGraphV5 } from '../../core/v5/graph'
import type { HistoryIdentityV5 } from '../../core/v5/types'
import { exportProjectV4, importProjectV4, hashValidatedProjectV4, validateCompleteProjectV4 } from '../v4/project-file'
import { validateMigrationSourceV4 } from '../v4/migration'
import { sha256Bytes } from '../v3/resources'
import type { CompleteProjectV4, MigrationSourceV4 } from '../v4/types'
import { checkCancelled, failV5, hasExactKeys, isSha256, PROJECT_LIMITS_V5 } from './limits'
import { materializeProjectV5 } from './prepare'
import type { CompleteProjectV5, MigrationSourceV5 } from './types'

export const COMPOSITION_MIGRATOR_VERSION_V5 = 'sceneweave-v4-v5@1'
const nonempty = (value: unknown, max = 256): value is string => typeof value === 'string' && value.length > 0 && value.length <= max

export async function validateMigrationSourceV5(input: MigrationSourceV5 | undefined, targetSceneId: string, options: { signal?: AbortSignal } = {}): Promise<void> {
  if (input === undefined) return
  const source = structuredClone(input)
  if (!hasExactKeys(source, ['sourceSchemaVersion', 'sourceSceneId', 'sourceRevision', 'sourceHash', 'migratorVersion', 'migratedAt', 'original'], ['previousSource'])
    || source.sourceSchemaVersion !== 4 || !nonempty(source.sourceSceneId) || source.sourceSceneId === targetSceneId
    || !Number.isSafeInteger(source.sourceRevision) || source.sourceRevision < 0 || !isSha256(source.sourceHash)
    || !nonempty(source.migratorVersion, 100) || !nonempty(source.migratedAt, 100) || !Number.isFinite(Date.parse(source.migratedAt))
    || !(source.original instanceof Blob) || source.original.size < 1 || source.original.size > PROJECT_LIMITS_V5.compressedBytes) failV5('v4迁移原件记录无效。')
  checkCancelled(options.signal)
  if (await sha256Bytes(new Uint8Array(await source.original.arrayBuffer())) !== source.sourceHash) failV5('v4迁移原件SHA-256不匹配。')
  const original = await importProjectV4(source.original, options)
  if (original.document.sceneId !== source.sourceSceneId || original.document.revision !== source.sourceRevision) failV5('v4迁移原件身份或修订不匹配。')
  if (source.previousSource !== undefined) {
    await validateMigrationSourceV4(source.previousSource, source.sourceSceneId, options)
    let prior: MigrationSourceV4 | MigrationSourceV4['previousSource'] | NonNullable<MigrationSourceV4['previousSource']>['previousSource'] = source.previousSource
    while (prior) {
      if (prior.sourceSceneId === targetSceneId) failV5('迁移链必须保留各版本独立场景身份。')
      prior = 'previousSource' in prior ? prior.previousSource : undefined
    }
  }
  checkCancelled(options.signal)
}

/** The source DB/history is untouched; only this complete current project is copied. */
export async function migrateProjectV4ToV5(input: CompleteProjectV4, options: { signal?: AbortSignal; original?: Blob; sceneId?: string; now?: string } = {}): Promise<CompleteProjectV5> {
  checkCancelled(options.signal)
  const captured = structuredClone(input), stamp = options.now ?? new Date().toISOString(), sceneId = options.sceneId ?? crypto.randomUUID()
  await validateCompleteProjectV4(captured, options)
  if (sceneId === captured.document.sceneId) failV5('迁移必须保存为独立场景副本。')
  const original = options.original ?? await exportProjectV4(captured, options), restored = await importProjectV4(original, options)
  if (await hashValidatedProjectV4(captured) !== await hashValidatedProjectV4(restored)) failV5('提供的v4原件与待迁移完整工程内容不一致。')
  const document = structuredClone(captured.document)
  Object.assign(document, { sceneId, revision: 0, createdAt: stamp, updatedAt: stamp })
  const historyIdentity: HistoryIdentityV5 = { ...structuredClone(captured.historyIdentity), version: 2,
    prefabTokens: Object.fromEntries(Object.keys(document.prefabInstances).map(id => [id, crypto.randomUUID()])) }
  const result: CompleteProjectV5 = { document, historyIdentity, appearance: createAppearanceGraphV5(document),
    assets: captured.assets, licenses: captured.licenses, licenseBindings: captured.licenseBindings,
    migrationSource: { sourceSchemaVersion: 4, sourceSceneId: captured.document.sceneId, sourceRevision: captured.document.revision,
      sourceHash: await sha256Bytes(new Uint8Array(await original.arrayBuffer())), migratorVersion: COMPOSITION_MIGRATOR_VERSION_V5, migratedAt: stamp, original,
      ...(captured.migrationSource !== undefined ? { previousSource: captured.migrationSource } : {}) } }
  return materializeProjectV5(result, options)
}

export async function migrationOriginalV5(project: CompleteProjectV5, schema: 1 | 2 | 3 | 4 = 4, options: { signal?: AbortSignal } = {}): Promise<Blob | null> {
  if (![1, 2, 3, 4].includes(schema)) failV5('只支持下载M0/v2/v3/v4迁移原件。')
  const captured = structuredClone(project.migrationSource)
  await validateMigrationSourceV5(captured, project.document.sceneId, options)
  if (schema === 4) return captured?.original ?? null
  if (schema === 3) return captured?.previousSource?.original ?? null
  if (schema === 2) return captured?.previousSource?.previousSource?.original ?? null
  return captured?.previousSource?.previousSource?.previousSource?.original ?? null
}

export { toCompleteProjectV3 } from './project-file'
