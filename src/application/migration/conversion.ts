import type { ProjectBundle } from '../../shared/model/project.js'
import type { ConversionJob, PreservationRecordInput } from '../../shared/migration/types.js'
import { CONVERTER_VERSION } from '../../shared/migration/types.js'
import { assertBackupReceipt, exportMigrationSet, importMigrationSet, type MigrationSetFiles } from '../../shared/migration/set.js'
import type { PreparationContext } from '../../shared/ports/runtime.js'
import type { CompleteValidationOptions, ResourceOptions } from '../../shared/ports/resources.js'
import { checkCancelled } from '../../shared/ports/resources.js'
import { canonicalJson, captureJson } from '../../shared/validation/json.js'
import { sha256Text } from '../../shared/validation/hash.js'
import { captureLegacyFamily, restoreLegacyCapture, LEGACY_DATABASES, type CaptureOptions, type LegacyCapture, type LegacyReference, type LegacyRepository } from '../../compat/legacy/capture.js'
import { captureLegacyFile } from '../../compat/legacy/file.js'
import { prepareLegacyFamily } from '../../compat/legacy/convert.js'
import type { ProjectRepository } from '../../platform/browser/storage/repository.js'

export interface ConversionEnvironment {
  repository: ProjectRepository
  runtime: PreparationContext
  validation: CompleteValidationOptions
  legacy?: CaptureOptions
}
export interface BegunProjectConversion { job: ConversionJob; backup: MigrationSetFiles | null; reused: ProjectBundle | null }
export interface ContinueProjectConversion {
  jobId: string
  backup?: { index: Uint8Array; volumes: ReadonlyMap<string, Uint8Array> | Record<string, Uint8Array> }
  sourcePolicy?: 'require-unchanged' | 'captured-copy'
}
export type ConversionSourceState = 'unchanged' | 'changed' | 'unavailable' | 'not-checked'
export interface CompletedProjectConversion { job: ConversionJob; bundle: ProjectBundle; reused: boolean; sourceState: ConversionSourceState }

export class ConversionSourceChangedError extends Error {
  readonly code = 'conversion-source-changed'
  constructor(readonly jobId: string, readonly sourceState: 'changed' | 'unavailable') {
    super('旧工程在完整捕获后已变化或暂不可读。请重新捕获，或明确选择以已保全内容建立独立副本；现有数据保持。')
    this.name = 'ConversionSourceChangedError'
  }
}
function signalOptions(env: ConversionEnvironment, options: ResourceOptions): ResourceOptions {
  return { signal: options.signal ?? env.validation.signal ?? env.legacy?.signal }
}
function deterministicContext(job: ConversionJob): PreparationContext {
  let sequence = 0
  return { ids: { nextId: () => `m20-${sha256Text(canonicalJson([job.jobId, sequence++]))}` }, clock: { now: () => job.createdAt } }
}
async function requireJob(env: ConversionEnvironment, jobId: string): Promise<ConversionJob> {
  const job = await env.repository.getJob(jobId)
  if (!job) throw new Error('转换记录不存在；不能临时分配另一套目标身份继续。')
  return job
}
async function resumeStopped(job: ConversionJob, env: ConversionEnvironment, options: ResourceOptions): Promise<ConversionJob> {
  return job.stage === 'failed' || job.stage === 'cancelled' ? env.repository.retryJob(job.jobId, job.jobVersion, options) : job
}
async function existingResult(job: ConversionJob, env: ConversionEnvironment, options: ResourceOptions): Promise<CompletedProjectConversion> {
  const bundle = await env.repository.load(job.targetSceneId, options)
  if (!bundle) throw new Error('已发布转换的目标工程缺失；不会按旧候选重建或覆盖。')
  return { job, bundle, reused: true, sourceState: 'not-checked' }
}
async function sourceState(job: ConversionJob, env: ConversionEnvironment, options: ResourceOptions): Promise<ConversionSourceState> {
  // File scopes are immutable uploaded bytes, re-read from the full backup and
  // retained as exact legacy originals; they have no mutable source database.
  if (/^file-v[1-6]$/.test(job.sourceRepository)) { checkCancelled(options.signal); return 'unchanged' }
  if (!Object.hasOwn(LEGACY_DATABASES, job.sourceRepository)) return 'unavailable'
  try {
    const latest = await captureLegacyFamily({ repository: job.sourceRepository as LegacyRepository, sceneId: job.scopeId }, { ...env.legacy, ...options })
    return latest.sourceFingerprint === job.sourceFingerprint ? 'unchanged' : 'changed'
  } catch (error) {
    checkCancelled(options.signal)
    if (error instanceof Error && error.name === 'AbortError') throw error
    return 'unavailable'
  }
}
async function stopOwnedJob(job: ConversionJob, env: ConversionEnvironment, error: unknown): Promise<void> {
  // A losing concurrent operation must not mark another operation's progressed job failed.
  try {
    const latest = await env.repository.getJob(job.jobId)
    if (!latest || latest.jobVersion !== job.jobVersion || ['verified', 'failed', 'cancelled'].includes(latest.stage)) return
    const cancelled = error instanceof Error && error.name === 'AbortError'
    await env.repository.advanceJob(job.jobId, job.jobVersion, cancelled ? 'cancelled' : 'failed', { failure: cancelled ? 'conversion-cancelled' : 'conversion-failed' })
  } catch { /* Preserve the original failure and every durable branch if failure recording also fails. */ }
}

/** Export alone never opens a conversion target. Files must be supplied again to continue. */
export async function beginCapturedConversion(capture: LegacyCapture, env: ConversionEnvironment, resourceOptions: ResourceOptions): Promise<BegunProjectConversion> {
  let job = await env.repository.reserveJob({ sourceRepository: capture.scope.repository, scopeId: capture.scope.sourceSceneId!, sourceFingerprint: capture.sourceFingerprint,
    snapshotKeys: capture.snapshotKeys, sourceContentHashes: capture.sourceContentHashes }, resourceOptions)
  try {
    job = await resumeStopped(job, env, resourceOptions)
    if (job.stage === 'verified') return { job, backup: null, reused: (await existingResult(job, env, resourceOptions)).bundle }
    if (job.stage === 'committed') return { job, backup: null, reused: null }
    const backup = await exportMigrationSet({ setId: job.jobId, createdAt: job.createdAt, converterVersion: CONVERTER_VERSION,
      scope: capture.scope, sourceFingerprint: capture.sourceFingerprint, records: capture.records }, resourceOptions.signal)
    checkCancelled(resourceOptions.signal)
    return { job, backup, reused: null }
  } catch (error) { await stopOwnedJob(job, env, error); throw error }
}

export async function beginProjectConversion(reference: LegacyReference, env: ConversionEnvironment, options: ResourceOptions = {}): Promise<BegunProjectConversion> {
  const resourceOptions = signalOptions(env, options)
  return beginCapturedConversion(await captureLegacyFamily(reference, { ...env.legacy, ...resourceOptions }), env, resourceOptions)
}

/** Strict legacy file input keeps its exact uploaded bytes as a source original. */
export async function beginProjectFileConversion(bytes: Uint8Array, env: ConversionEnvironment, options: ResourceOptions = {}): Promise<BegunProjectConversion> {
  const resourceOptions = signalOptions(env, options)
  return beginCapturedConversion(await captureLegacyFile(bytes, { ...resourceOptions }), env, resourceOptions)
}

function requestFields(input: ContinueProjectConversion): { jobId: string; policy: NonNullable<ContinueProjectConversion['sourcePolicy']>; backup?: ContinueProjectConversion['backup'] } {
  if (!input || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) throw new Error('转换请求须为普通数据对象。')
  const fields = Object.getOwnPropertyDescriptors(input), keys = Reflect.ownKeys(input)
  if (!fields.jobId || keys.some(key => typeof key !== 'string' || !['jobId', 'sourcePolicy', 'backup'].includes(key) || !fields[key]?.enumerable || !('value' in fields[key]))) throw new Error('转换请求包含未知、访问器或隐藏字段。')
  const jobId = captureJson(fields.jobId.value), policy = fields.sourcePolicy?.value ?? 'require-unchanged'
  if (typeof jobId !== 'string' || !jobId || jobId.length > 256 || jobId === '__proto__' || !['require-unchanged', 'captured-copy'].includes(policy)) throw new Error('转换请求的job或源策略无效。')
  if (!fields.backup) return { jobId, policy }
  const backup = fields.backup.value
  if (!backup || ![Object.prototype, null].includes(Object.getPrototypeOf(backup))) throw new Error('重新读取的保全文件须明确提供索引与分卷。')
  const fileFields = Object.getOwnPropertyDescriptors(backup)
  if (Reflect.ownKeys(backup).length !== 2 || !['index', 'volumes'].every(key => fileFields[key]?.enumerable && 'value' in fileFields[key])) throw new Error('保全文件包装包含未知或访问器字段。')
  return { jobId, policy, backup: { index: fileFields.index!.value!, volumes: fileFields.volumes!.value! } }
}

/** One explicit family: reread backup → prepare → atomic commit → cold read → ready. */
export async function continueProjectConversion(input: ContinueProjectConversion, env: ConversionEnvironment, options: ResourceOptions = {}): Promise<CompletedProjectConversion> {
  const request = requestFields(input), resourceOptions = signalOptions(env, options)
  // importMigrationSet captures every caller byte before its first await. Settle an
  // optional failure immediately so a slower journal read cannot cause an unhandled rejection.
  const reread = request.backup ? importMigrationSet(request.backup.index, request.backup.volumes, resourceOptions.signal)
    .then(value => ({ value }), (error: unknown) => ({ error })) : undefined
  let job = await requireJob(env, request.jobId)
  try {
    job = await resumeStopped(job, env, resourceOptions)
    if (job.stage === 'verified') return existingResult(job, env, resourceOptions)
    if (job.stage !== 'committed') {
      if (!reread) throw new Error('请重新提供完整保全索引及全部分卷；导出或开始下载不代表备份已核验。')
      const recovered = await reread
      if ('error' in recovered) throw recovered.error
      const set = recovered.value
      const receipt = assertBackupReceipt(set.receipt, { setId: job.jobId, sourceFingerprint: job.sourceFingerprint, ...(job.backupReceipt ? { indexHash: job.backupReceipt.indexHash } : {}) })
      if (set.manifest.converterVersion !== CONVERTER_VERSION || set.manifest.scope.kind !== 'project-family'
        || set.manifest.scope.repository !== job.sourceRepository || set.manifest.scope.sourceSceneId !== job.scopeId) throw new Error('保全文件的scope或转换器与固定journal不匹配。')
      const records: PreservationRecordInput[] = set.records.map(({ role, recordKey, sourceFormat, contentHash, bytes }) => ({ role, recordKey, sourceFormat, contentHash, bytes }))
      const capture = await restoreLegacyCapture(set.manifest.scope, records, resourceOptions.signal)
      if (capture.sourceFingerprint !== job.sourceFingerprint || canonicalJson(capture.sourceContentHashes) !== canonicalJson(job.sourceContentHashes)
        || canonicalJson([...capture.snapshotKeys].sort()) !== canonicalJson(Object.keys(job.snapshotIds).sort())) throw new Error('实际保全行与捕获指纹、历史键或源摘要不符。')
      if (receipt.indexHash !== set.receipt.indexHash) throw new Error('保全索引凭证不匹配。')
      if (job.stage === 'captured') job = await env.repository.advanceJob(job.jobId, job.jobVersion, 'backup-verified', { backupReceipt: set.receipt }, resourceOptions)
      const family = await prepareLegacyFamily(capture, { sceneId: job.targetSceneId, createdAt: job.createdAt, snapshotIds: job.snapshotIds, context: deterministicContext(job) }, { ...env.validation, ...resourceOptions })
      if (job.stage === 'backup-verified') job = await env.repository.prepareConversion(job.jobId, job.jobVersion, family, resourceOptions)
      if (job.stage !== 'prepared') throw new Error('转换记录不在可提交阶段。')
      const beforeCommit = await sourceState(job, env, resourceOptions)
      if (request.policy === 'require-unchanged' && beforeCommit !== 'unchanged') throw new ConversionSourceChangedError(job.jobId, beforeCommit as 'changed' | 'unavailable')
      job = await env.repository.commitConversion(job.jobId, job.jobVersion, family, resourceOptions)
    }
    const beforePublish = await sourceState(job, env, resourceOptions)
    if (request.policy === 'require-unchanged' && beforePublish !== 'unchanged') throw new ConversionSourceChangedError(job.jobId, beforePublish as 'changed' | 'unavailable')
    const bundle = await env.repository.publishConversion(job.jobId, job.jobVersion, resourceOptions)
    job = await requireJob(env, job.jobId)
    // Once ready, a later source change describes the independent copy; never roll
    // it back or rewrite its content in response to an unrelated source edit.
    let afterPublish: ConversionSourceState
    try { afterPublish = await sourceState(job, env, resourceOptions) }
    catch { afterPublish = 'not-checked' }
    return { job, bundle, reused: false, sourceState: afterPublish }
  } catch (error) { await stopOwnedJob(job, env, error); throw error }
}

/** Cancelling a committed job retains its private target for an explicit retry. */
export async function cancelProjectConversion(jobId: string, env: ConversionEnvironment): Promise<ConversionJob> {
  const job = await requireJob(env, jobId)
  if (['verified', 'failed', 'cancelled'].includes(job.stage)) return job
  return env.repository.advanceJob(job.jobId, job.jobVersion, 'cancelled')
}
