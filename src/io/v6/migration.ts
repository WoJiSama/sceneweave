import { migrateHistoryIdentityV5ToV6 } from '../../core/v6/identity'
import { exportProjectV5, importProjectV5, hashValidatedProjectV5, validateCompleteProjectV5 } from '../v5/project-file'
import { migrateProjectV4ToV5, validateMigrationSourceV5 } from '../v5/migration'
import { sha256Bytes } from '../v3/resources'
import type { CompleteProjectV4 } from '../v4/types'
import type { CompleteProjectV5 } from '../v5/types'
import { checkCancelled, failV6, hasExactKeys, isSha256, PROJECT_LIMITS_V6 } from './limits'
import { materializeProjectV6 } from './prepare'
import type { CompleteProjectV6, MigrationSourceV6 } from './types'
import { captureOwnedData, freezeOwnedData } from '../v3/owned-data'

export const OUTDOOR_MIGRATOR_VERSION_V6 = 'sceneweave-v5-v6@1'
const nonempty = (value: unknown, max = 256): value is string => typeof value === 'string' && value.length > 0 && value.length <= max
interface MigrationNode { sourceSceneId: string; original: Blob; previousSource?: MigrationNode }
const ownedMigrations = new WeakMap<MigrationSourceV6, string>()
export function getOwnedMigrationV6(source: MigrationSourceV6 | undefined, targetSceneId: string): MigrationSourceV6 | undefined {
  return source && ownedMigrations.get(source) === targetSceneId ? source : undefined
}
/** A successful full import of every original is required before an internal chain can be reused. */
export async function captureValidatedMigrationV6(input: MigrationSourceV6 | undefined, targetSceneId: string, options: { signal?: AbortSignal } = {}): Promise<MigrationSourceV6 | undefined> {
  checkCancelled(options.signal)
  if (input === undefined) return
  const known = getOwnedMigrationV6(input, targetSceneId)
  if (known) return known
  const source = captureOwnedData(input)
  await validateMigrationSourceV6(source, targetSceneId, options)
  checkCancelled(options.signal)
  freezeOwnedData(source)
  ownedMigrations.set(source, targetSceneId)
  return source
}
export async function validateMigrationSourceV6(input: MigrationSourceV6 | undefined, targetSceneId: string, options: { signal?: AbortSignal } = {}): Promise<void> {
  if (input === undefined) return
  const source = structuredClone(input)
  if (!hasExactKeys(source, ['sourceSchemaVersion', 'sourceSceneId', 'sourceRevision', 'sourceHash', 'migratorVersion', 'migratedAt', 'original'], ['previousSource'])
    || source.sourceSchemaVersion !== 5 || !nonempty(source.sourceSceneId) || source.sourceSceneId === targetSceneId
    || !Number.isSafeInteger(source.sourceRevision) || source.sourceRevision < 0 || !isSha256(source.sourceHash)
    || !nonempty(source.migratorVersion, 100) || !nonempty(source.migratedAt, 100) || !Number.isFinite(Date.parse(source.migratedAt))
    || !(source.original instanceof Blob) || source.original.size < 1 || source.original.size > PROJECT_LIMITS_V6.compressedBytes) failV6('v5迁移原件记录无效。')
  checkCancelled(options.signal)
  if (await sha256Bytes(new Uint8Array(await source.original.arrayBuffer())) !== source.sourceHash) failV6('v5迁移原件SHA-256不匹配。')
  const original = await importProjectV5(source.original, options)
  if (original.document.sceneId !== source.sourceSceneId || original.document.revision !== source.sourceRevision) failV6('v5迁移原件身份或修订不匹配。')
  if (source.previousSource !== undefined) {
    await validateMigrationSourceV5(source.previousSource, source.sourceSceneId, options)
    let prior: MigrationNode | undefined = source.previousSource
    const seen = new Set([targetSceneId, source.sourceSceneId])
    while (prior) { if (seen.has(prior.sourceSceneId)) failV6('迁移链必须保留各版本独立场景身份。'); seen.add(prior.sourceSceneId); prior = prior.previousSource }
  }
  checkCancelled(options.signal)
}
/** Only the current V5 revision is migrated. V5 history/DB and exact original bytes remain untouched. */
export async function migrateProjectV5ToV6(input: CompleteProjectV5, options: { signal?: AbortSignal; original?: Blob; sceneId?: string; now?: string } = {}): Promise<CompleteProjectV6> {
  checkCancelled(options.signal)
  const captured = structuredClone(input), stamp = options.now ?? new Date().toISOString(), sceneId = options.sceneId ?? crypto.randomUUID()
  await validateCompleteProjectV5(captured, options)
  if (sceneId === captured.document.sceneId) failV6('迁移必须保存为独立场景副本。')
  const original = options.original ?? await exportProjectV5(captured, options), restored = await importProjectV5(original, options)
  if (await hashValidatedProjectV5(captured) !== await hashValidatedProjectV5(restored)) failV6('提供的v5原件与待迁移完整工程内容不一致。')
  const document = structuredClone(captured.document)
  Object.assign(document, { sceneId, revision: 0, createdAt: stamp, updatedAt: stamp })
  const result: CompleteProjectV6 = { document, historyIdentity: migrateHistoryIdentityV5ToV6(captured.historyIdentity, document), appearance: structuredClone(captured.appearance),
    assets: captured.assets, licenses: captured.licenses, licenseBindings: captured.licenseBindings,
    migrationSource: { sourceSchemaVersion: 5, sourceSceneId: captured.document.sceneId, sourceRevision: captured.document.revision,
      sourceHash: await sha256Bytes(new Uint8Array(await original.arrayBuffer())), migratorVersion: OUTDOOR_MIGRATOR_VERSION_V6, migratedAt: stamp, original,
      ...(captured.migrationSource !== undefined ? { previousSource: captured.migrationSource } : {}) } }
  return materializeProjectV6(result, options)
}
/** Convenience pipeline for older complete projects; every preceding exact original is retained. */
export async function migrateProjectV4ToV6(input: CompleteProjectV4, options: { signal?: AbortSignal; sceneId?: string; now?: string } = {}): Promise<CompleteProjectV6> {
  return migrateProjectV5ToV6(await migrateProjectV4ToV5(input, { signal: options.signal, now: options.now }), options)
}
export async function migrationOriginalV6(project: CompleteProjectV6, schema: 1 | 2 | 3 | 4 | 5 = 5, options: { signal?: AbortSignal } = {}): Promise<Blob | null> {
  if (![1, 2, 3, 4, 5].includes(schema)) failV6('只支持下载M0/v2/v3/v4/v5迁移原件。')
  const captured = structuredClone(project.migrationSource)
  await validateMigrationSourceV6(captured, project.document.sceneId, options)
  let source: MigrationNode | undefined = captured
  for (let version = 5; version > schema && source; version--) source = source.previousSource
  return source?.original ?? null
}
export { toCompleteProjectV3 } from './project-file'
