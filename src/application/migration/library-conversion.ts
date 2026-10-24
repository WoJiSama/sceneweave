import type { LibrarySnapshot } from '../../shared/library/types.js'
import type { MigrationScope, PreservationRecordInput } from '../../shared/migration/types.js'
import { CONVERTER_VERSION } from '../../shared/migration/types.js'
import { assertBackupReceipt, exportMigrationSet, importMigrationSet, type MigrationSetFiles } from '../../shared/migration/set.js'
import type { CompleteValidationOptions, ResourceOptions } from '../../shared/ports/resources.js'
import { checkCancelled } from '../../shared/ports/resources.js'
import type { PreparationContext } from '../../shared/ports/runtime.js'
import { canonicalJson, captureJson } from '../../shared/validation/json.js'
import type { CaptureOptions } from '../../compat/legacy/capture.js'
import { captureLegacyCatalog, captureLegacyCatalogFile, prepareLegacyCatalog, restoreLegacyCatalogCapture, type LegacyCatalogCapture } from '../../compat/legacy/catalog.js'
import type { LibraryConversionJob, LibraryRepository } from '../../platform/browser/library/index.js'

export interface LibraryConversionEnvironment {
  repository: LibraryRepository
  runtime: PreparationContext
  validation: CompleteValidationOptions
  legacy?: CaptureOptions
}
export type LibraryConversionSourceState = 'unchanged' | 'changed' | 'unavailable' | 'not-checked'
export interface BegunLibraryConversion { job: LibraryConversionJob; backup: MigrationSetFiles | null; reused: LibrarySnapshot | null }
export interface ContinueLibraryConversion {
  jobId: string
  backup?: { index: Uint8Array; volumes: ReadonlyMap<string, Uint8Array> | Record<string, Uint8Array> }
  sourcePolicy?: 'require-unchanged' | 'captured-copy'
  organizationPolicy?: 'keep-local' | 'replace-selected'
}
export interface CompletedLibraryConversion { job: LibraryConversionJob; snapshot: LibrarySnapshot; reused: boolean; sourceState: LibraryConversionSourceState }

export class LibraryConversionSourceChangedError extends Error {
  readonly code = 'library-conversion-source-changed'
  constructor(readonly jobId: string, readonly sourceState: 'changed' | 'unavailable') {
    super('旧素材库在完整捕获后已变化或暂不可读。请重新捕获，或明确选择以已保全内容转换；旧库及当前个人整理保持。')
    this.name = 'LibraryConversionSourceChangedError'
  }
}
function signalOptions(env: LibraryConversionEnvironment, options: ResourceOptions): ResourceOptions {
  return { signal: options.signal ?? env.validation.signal ?? env.legacy?.signal }
}
async function requireJob(env: LibraryConversionEnvironment, jobId: string): Promise<LibraryConversionJob> {
  const job = await env.repository.getJob(jobId)
  if (!job) throw new Error('目录转换记录不存在；不能临时创建另一套映射继续。')
  return job
}
async function resumeStopped(job: LibraryConversionJob, env: LibraryConversionEnvironment, options: ResourceOptions): Promise<LibraryConversionJob> {
  return job.stage === 'failed' || job.stage === 'cancelled' ? env.repository.retryConversion(job.jobId, job.jobVersion, options) : job
}
async function sourceState(job: LibraryConversionJob, env: LibraryConversionEnvironment, options: ResourceOptions): Promise<LibraryConversionSourceState> {
  checkCancelled(options.signal)
  if (job.sourceRepository === 'file-catalog-v1') return 'unchanged'
  if (job.sourceRepository !== 'sceneweave-catalog-v1') return 'unavailable'
  try {
    const latest = await captureLegacyCatalog({ ...env.legacy, ...options })
    return latest.sourceFingerprint === job.sourceFingerprint ? 'unchanged' : 'changed'
  } catch (error) {
    checkCancelled(options.signal)
    if (error instanceof Error && error.name === 'AbortError') throw error
    return 'unavailable'
  }
}
async function stopOwnedJob(job: LibraryConversionJob, env: LibraryConversionEnvironment, error: unknown): Promise<void> {
  try {
    const latest = await env.repository.getJob(job.jobId)
    if (!latest || latest.jobVersion !== job.jobVersion || ['verified', 'failed', 'cancelled'].includes(latest.stage)) return
    const cancelled = error instanceof Error && error.name === 'AbortError'
    await env.repository.advanceConversion(job.jobId, job.jobVersion, cancelled ? 'cancelled' : 'failed', { failure: cancelled ? 'library-conversion-cancelled' : 'library-conversion-failed' })
  } catch { /* Preserve the original failure and durable branches if recording also fails. */ }
}
export async function beginCaptured(capture: LegacyCatalogCapture, env: LibraryConversionEnvironment, options: ResourceOptions): Promise<BegunLibraryConversion> {
  let job = await env.repository.reserveConversion({ sourceRepository: capture.scope.repository, scopeId: 'catalog', sourceFingerprint: capture.sourceFingerprint,
    entryKeys: capture.entryKeys, organizationKeys: capture.organizationKeys, sourceContentHashes: capture.sourceContentHashes }, options)
  try {
    job = await resumeStopped(job, env, options)
    if (job.stage === 'verified') return { job, backup: null, reused: await env.repository.read(options) }
    if (job.stage === 'committed') return { job, backup: null, reused: null }
    const backup = await exportMigrationSet({ setId: job.jobId, createdAt: job.createdAt, converterVersion: CONVERTER_VERSION,
      scope: capture.scope, sourceFingerprint: capture.sourceFingerprint, records: capture.records }, options.signal)
    checkCancelled(options.signal)
    return { job, backup, reused: null }
  } catch (error) { await stopOwnedJob(job, env, error); throw error }
}

/** Capture the complete old personal library in one readonly transaction, without publishing any new content. */
export async function beginLibraryConversion(env: LibraryConversionEnvironment, options: ResourceOptions = {}): Promise<BegunLibraryConversion> {
  const capturedOptions = signalOptions(env, options)
  return beginCaptured(await captureLegacyCatalog({ ...env.legacy, ...capturedOptions }), env, capturedOptions)
}
/** The original selected legacy backup is preserved byte for byte, independent of the old browser database. */
export async function beginLibraryFileConversion(bytes: Uint8Array, env: LibraryConversionEnvironment, options: ResourceOptions = {}): Promise<BegunLibraryConversion> {
  const capturedOptions = signalOptions(env, options)
  return beginCaptured(await captureLegacyCatalogFile(bytes, capturedOptions), env, capturedOptions)
}
function requestFields(input: ContinueLibraryConversion): ContinueLibraryConversion & { sourcePolicy: NonNullable<ContinueLibraryConversion['sourcePolicy']> } {
  if (!input || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) throw new Error('目录转换请求须为普通数据对象。')
  const fields = Object.getOwnPropertyDescriptors(input)
  if (!fields.jobId || Reflect.ownKeys(input).some(key => typeof key !== 'string' || !['jobId', 'backup', 'sourcePolicy', 'organizationPolicy'].includes(key)
    || !fields[key]?.enumerable || !('value' in fields[key]))) throw new Error('目录转换请求包含未知、隐藏或访问器字段。')
  const jobId = captureJson(fields.jobId.value), sourcePolicy = fields.sourcePolicy?.value ?? 'require-unchanged', organizationPolicy = fields.organizationPolicy?.value
  if (typeof jobId !== 'string' || !jobId || jobId.length > 256 || jobId === '__proto__' || !['require-unchanged', 'captured-copy'].includes(sourcePolicy)
    || organizationPolicy !== undefined && !['keep-local', 'replace-selected'].includes(organizationPolicy)) throw new Error('目录转换job或冲突策略无效。')
  const request: ReturnType<typeof requestFields> = { jobId, sourcePolicy, ...(organizationPolicy ? { organizationPolicy } : {}) }
  if (!fields.backup) return request
  const backup = fields.backup.value
  if (!backup || ![Object.prototype, null].includes(Object.getPrototypeOf(backup))) throw new Error('重新读取的保全文件须明确提供索引及全部分卷。')
  const parts = Object.getOwnPropertyDescriptors(backup)
  if (Reflect.ownKeys(backup).length !== 2 || !['index', 'volumes'].every(key => parts[key]?.enumerable && 'value' in parts[key])) throw new Error('保全文件包装包含未知、隐藏或访问器字段。')
  request.backup = { index: parts.index!.value!, volumes: parts.volumes!.value! }
  return request
}
function matchesScope(scope: MigrationScope, job: LibraryConversionJob): boolean {
  return scope.kind === 'catalog' && scope.repository === job.sourceRepository && scope.sourceSceneId === null && job.scopeId === 'catalog'
}

/** Re-read the entire preservation set, stage privately, cold-read, then publish the full scope in one CAS transaction. */
export async function continueLibraryConversion(input: ContinueLibraryConversion, env: LibraryConversionEnvironment, options: ResourceOptions = {}): Promise<CompletedLibraryConversion> {
  const request = requestFields(input), resourceOptions = signalOptions(env, options)
  // Capture supplied bytes before awaiting a database read; immediately settle optional failures.
  const reread = request.backup ? importMigrationSet(request.backup.index, request.backup.volumes, resourceOptions.signal)
    .then(value => ({ value }), (error: unknown) => ({ error })) : undefined
  let job = await requireJob(env, request.jobId)
  try {
    job = await resumeStopped(job, env, resourceOptions)
    if (job.stage === 'verified') return { job, snapshot: await env.repository.read(resourceOptions), reused: true, sourceState: 'not-checked' }
    const organizationPolicy = request.organizationPolicy ?? job.organizationPolicy ?? 'keep-local'
    if (job.organizationPolicy && job.organizationPolicy !== organizationPolicy) throw new Error('转换已冻结个人整理冲突策略，请按原策略续跑。')
    if (job.stage !== 'committed') {
      if (!reread) throw new Error('请重新提供完整目录保全索引及全部分卷；导出不等于已经取回核验。')
      const recovered = await reread
      if ('error' in recovered) throw recovered.error
      const set = recovered.value
      assertBackupReceipt(set.receipt, { setId: job.jobId, sourceFingerprint: job.sourceFingerprint, ...(job.backupReceipt ? { indexHash: job.backupReceipt.indexHash } : {}) })
      if (set.manifest.converterVersion !== CONVERTER_VERSION || !matchesScope(set.manifest.scope, job)) throw new Error('保全scope或转换器与目录journal不匹配。')
      const records: PreservationRecordInput[] = set.records.map(({ role, recordKey, sourceFormat, contentHash, bytes }) => ({ role, recordKey, sourceFormat, contentHash, bytes }))
      const capture = await restoreLegacyCatalogCapture(set.manifest.scope, records, resourceOptions.signal)
      if (capture.sourceFingerprint !== job.sourceFingerprint || canonicalJson(capture.sourceContentHashes) !== canonicalJson(job.sourceContentHashes)
        || canonicalJson([...capture.entryKeys].sort()) !== canonicalJson([...job.entryKeys].sort())
        || canonicalJson([...capture.organizationKeys].sort()) !== canonicalJson([...job.organizationKeys].sort())) throw new Error('实际保全记录与目录指纹、完整键集合或源摘要不符。')
      if (job.stage === 'captured') job = await env.repository.advanceConversion(job.jobId, job.jobVersion, 'backup-verified', { backupReceipt: set.receipt }, resourceOptions)
      const converted = await prepareLegacyCatalog(capture, { ...env.validation, ...resourceOptions })
      const candidate = { ...converted, organizationPolicy }
      if (job.stage === 'backup-verified') job = await env.repository.prepareConversion(job.jobId, job.jobVersion, candidate, resourceOptions)
      if (job.stage !== 'prepared') throw new Error('目录转换不在可提交阶段。')
      const beforeCommit = await sourceState(job, env, resourceOptions)
      if (request.sourcePolicy === 'require-unchanged' && beforeCommit !== 'unchanged') throw new LibraryConversionSourceChangedError(job.jobId, beforeCommit as 'changed' | 'unavailable')
      job = await env.repository.commitConversion(job.jobId, job.jobVersion, candidate, resourceOptions)
    }
    const beforePublish = await sourceState(job, env, resourceOptions)
    if (request.sourcePolicy === 'require-unchanged' && beforePublish !== 'unchanged') throw new LibraryConversionSourceChangedError(job.jobId, beforePublish as 'changed' | 'unavailable')
    const snapshot = await env.repository.publishConversion(job.jobId, job.jobVersion, resourceOptions)
    job = await requireJob(env, job.jobId)
    let afterPublish: LibraryConversionSourceState
    try { afterPublish = await sourceState(job, env, resourceOptions) } catch { afterPublish = 'not-checked' }
    return { job, snapshot, reused: false, sourceState: afterPublish }
  } catch (error) { await stopOwnedJob(job, env, error); throw error }
}

/** Retain private staging on cancellation; a later retry revalidates it against the current public catalog. */
export async function cancelLibraryConversion(jobId: string, env: LibraryConversionEnvironment): Promise<LibraryConversionJob> {
  const job = await requireJob(env, jobId)
  if (['verified', 'failed', 'cancelled'].includes(job.stage)) return job
  return env.repository.advanceConversion(job.jobId, job.jobVersion, 'cancelled')
}
