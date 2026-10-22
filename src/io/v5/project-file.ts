import { zipSync } from 'fflate'
import { version as applicationVersion } from '../../../package.json'
import type { SceneDocumentV3 } from '../../core/v3/types'
import type { AppearanceGraphV5, HistoryIdentityV5 } from '../../core/v5/types'
import { parseBoundedJson, utf8Decoder, utf8Encoder } from '../v3/json'
import { validateCompleteProjectV3 } from '../v3/project-file'
import { inspectImageBytes, sha256Bytes } from '../v3/resources'
import type { CompleteProjectV3 } from '../v3/types'
import { mergeHistoryIdentitiesV5, validateHistoryIdentityV5 } from './identity'
import { checkCancelled, failV5, hasExactKeys, isSha256, PROJECT_LIMITS_V5 } from './limits'
import { validateMigrationSourceV5 } from './migration'
import type { AssetBlobRecord, CompleteProjectV5, HistoryArchiveV5, LicenseBinding, NamedSnapshotV5, NamedSnapshotSummaryV5 } from './types'
import { inspectZipV5 } from './zip'
import { validateCompositionContentV5 } from '../../core/v5/schema'
import { validateBitmapVariantsV5 } from './resources'

type RoleV5 = 'scene' | 'identity' | 'appearance' | 'history' | 'snapshot-scene' | 'snapshot-identity' | 'snapshot-appearance' | 'asset' | 'license'
interface ManifestEntryV5 { path: string; role: RoleV5; sha256: string; sizeBytes: number; mimeType: string }
interface ManifestV5 {
  format: 'sceneweave-project'; containerVersion: 5; documentSchemaVersion: 3
  application: 'Sceneweave'; applicationVersion: string; profile: 'm1-composition'; packageMode: 'complete' | 'history'
  sceneId: string; revision: number; entries: ManifestEntryV5[]; licenseBindings: LicenseBinding[]
}
interface ResourceRefsV5 { assetHashes: string[]; licenseHashes: string[] }
interface SnapshotEntryV5 extends ResourceRefsV5 { summary: NamedSnapshotSummaryV5; scenePath: string; identityPath: string; appearancePath: string; licenseBindings: LicenseBinding[] }
interface HistoryIndexV5 { version: 1; current: ResourceRefsV5; snapshots: SnapshotEntryV5[] }
const suffix: Record<AssetBlobRecord['mimeType'], string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }
const nonempty = (value: unknown, max = 256): value is string => typeof value === 'string' && value.length > 0 && value.length <= max

export const canonicalJsonV5 = (value: unknown): string => JSON.stringify(value, (_key, item: unknown) => item !== null && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : item)

/** A fixed source/version has one meaning across a branch and all selected history. */
export function assertFixedCompositionCompatibleV5(left: CompleteProjectV5, right: CompleteProjectV5): void {
  const compare = (a: Record<string, unknown>, b: Record<string, unknown>) => {
    for (const [id, value] of Object.entries(a)) if (Object.hasOwn(b, id) && canonicalJsonV5(value) !== canonicalJsonV5(b[id])) failV5(`固定来源或定义身份冲突：${id}。`)
  }
  for (const key of ['sources', 'variants', 'prefabAppearanceTemplates'] as const) compare(left.appearance[key], right.appearance[key])
  for (const key of ['assets', 'materials', 'propDefinitions', 'prefabDefinitions', 'styleThemes'] as const) compare(left.document[key], right.document[key])
}

/** The exact v3 content view deliberately excludes all local history/provenance fields. */
export function toCompleteProjectV3(project: CompleteProjectV5): CompleteProjectV3 {
  validateCompositionContentV5({ document: project.document, historyIdentity: project.historyIdentity, appearance: project.appearance })
  return nativeContentView(project)
}
function nativeContentView(project: CompleteProjectV5): CompleteProjectV3 {
  return { document: project.document, assets: project.assets, licenses: project.licenses, licenseBindings: project.licenseBindings }
}

export function projectJsonBytesV5(project: Pick<CompleteProjectV5, 'document' | 'historyIdentity' | 'appearance'>): number {
  return utf8Encoder.encode(JSON.stringify(project.document)).length + utf8Encoder.encode(JSON.stringify(project.historyIdentity)).length + utf8Encoder.encode(JSON.stringify(project.appearance)).length
}

async function validateCapturedProject(project: CompleteProjectV5, options: { signal?: AbortSignal }): Promise<void> {
  checkCancelled(options.signal)
  if (!hasExactKeys(project, ['document', 'historyIdentity', 'appearance', 'assets', 'licenses', 'licenseBindings'], ['migrationSource'])) failV5('完整工程字段缺失或未知。')
  validatePackageBudgets({ project, snapshots: [] }, 'complete')
  // Shape and complete closure are checked before identity traversal; no field is silently discarded.
  await validateCompleteProjectV3(nativeContentView(project), options)
  validateHistoryIdentityV5(project.historyIdentity, project.document)
  validateCompositionContentV5({ document: project.document, historyIdentity: project.historyIdentity, appearance: project.appearance })
  await validateBitmapVariantsV5(project, options)
  await validateMigrationSourceV5(project.migrationSource, project.document.sceneId, options)
  checkCancelled(options.signal)
}

export async function validateCompleteProjectV5(project: CompleteProjectV5, options: { signal?: AbortSignal } = {}): Promise<void> {
  checkCancelled(options.signal)
  await validateCapturedProject(structuredClone(project), { ...options })
}

/** Requires a previously validated captured project; performs no image decode and is safe outside a transaction. */
export async function hashValidatedProjectV5(project: CompleteProjectV5): Promise<string> {
  const assets = Object.fromEntries(Object.entries(project.assets).map(([hash, record]) => [hash, {
    sha256: record.sha256, mimeType: record.mimeType, sizeBytes: record.sizeBytes, pixelWidth: record.pixelWidth, pixelHeight: record.pixelHeight,
  }]))
  const value = canonicalJsonV5({ document: project.document, historyIdentity: project.historyIdentity, appearance: project.appearance, assets, licenses: project.licenses, licenseBindings: project.licenseBindings })
  return sha256Bytes(utf8Encoder.encode(value))
}
export async function projectContentHashV5(project: CompleteProjectV5, options: { signal?: AbortSignal } = {}): Promise<string> {
  const captured = structuredClone(project)
  await validateCapturedProject(captured, options)
  return hashValidatedProjectV5(captured)
}

export function validateNamedSnapshotSummaryV5(input: unknown): asserts input is NamedSnapshotSummaryV5 {
  if (!hasExactKeys(input, ['id', 'sceneId', 'lineageId', 'sourceRevision', 'name', 'kind', 'createdAt', 'contentHash'])
    || !nonempty(input.id) || input.id === '__proto__' || !nonempty(input.sceneId) || !nonempty(input.lineageId)
    || !Number.isSafeInteger(input.sourceRevision) || Number(input.sourceRevision) < 0 || typeof input.name !== 'string' || !input.name.trim() || Array.from(input.name).length > 80
    || input.kind !== 'named' && input.kind !== 'protection' || !nonempty(input.createdAt, 100) || !Number.isFinite(Date.parse(input.createdAt))
    || !isSha256(input.contentHash)) failV5('历史快照摘要字段缺失、未知或无效。')
}

/** Validation returns a captured archive with the current tombstone union, never mutating its caller. */
export async function validateHistoryArchiveV5(input: HistoryArchiveV5, options: { signal?: AbortSignal } = {}): Promise<HistoryArchiveV5> {
  checkCancelled(options.signal)
  const archive = structuredClone(input)
  if (!hasExactKeys(archive, ['project', 'snapshots']) || !Array.isArray(archive.snapshots) || archive.snapshots.length > PROJECT_LIMITS_V5.archiveSnapshots) failV5('历史归档结构无效或快照超过64份。')
  await validateCapturedProject(archive.project, options)
  const ids = new Set<string>(); let named = 0, protections = 0
  for (const snapshot of archive.snapshots) {
    if (!hasExactKeys(snapshot, ['id', 'sceneId', 'lineageId', 'sourceRevision', 'name', 'kind', 'createdAt', 'contentHash', 'project'])) failV5('快照字段缺失或未知。')
    const { project, ...summary } = snapshot
    validateNamedSnapshotSummaryV5(summary)
    if (snapshot.kind === 'named') named++; else protections++
    if (named > PROJECT_LIMITS_V5.namedPerScene || protections > PROJECT_LIMITS_V5.protectionPerScene) failV5('命名快照或恢复保护点超过各32份的保留上限。')
    if (ids.has(snapshot.id) || snapshot.sceneId !== archive.project.document.sceneId) failV5('快照ID重复或所属工程不匹配。')
    ids.add(snapshot.id)
    await validateCapturedProject(project, options)
    if (snapshot.sourceRevision !== project.document.revision) failV5('快照源修订与完整文档不匹配。')
    if (snapshot.lineageId !== project.historyIdentity.lineageId) failV5('快照lineage与内容不一致。')
    assertFixedCompositionCompatibleV5(archive.project, project)
    for (const previous of archive.snapshots) {
      if (previous === snapshot) break
      assertFixedCompositionCompatibleV5(previous.project, project)
    }
    archive.project.historyIdentity = mergeHistoryIdentitiesV5(archive.project.historyIdentity, [project.historyIdentity])
    if (await hashValidatedProjectV5(project) !== snapshot.contentHash) failV5('快照内容hash不匹配。')
  }
  validateHistoryIdentityV5(archive.project.historyIdentity, archive.project.document)
  // The merged current tombstones and every selected snapshot share the actual package budgets.
  validatePackageBudgets(archive, 'history')
  checkCancelled(options.signal)
  return archive
}

function resourceRefs(project: CompleteProjectV5): ResourceRefsV5 { return { assetHashes: Object.keys(project.assets).sort(), licenseHashes: Object.keys(project.licenses).sort() } }
function manifestFor(project: CompleteProjectV5, mode: 'complete' | 'history', entries: ManifestEntryV5[]): ManifestV5 {
  return { format: 'sceneweave-project', containerVersion: 5, documentSchemaVersion: 3, application: 'Sceneweave', applicationVersion,
    profile: 'm1-composition', packageMode: mode, sceneId: project.document.sceneId, revision: project.document.revision, entries, licenseBindings: project.licenseBindings }
}
/** A local save/import must remain representable by the same cumulative reader budgets. */
function validatePackageBudgets(archive: HistoryArchiveV5, mode: 'complete' | 'history'): void {
  const entries: ManifestEntryV5[] = [], jsonBudget = { values: 0 }
  let expanded = 0, documentBytes = 0
  const add = (path: string, role: RoleV5, sizeBytes: number, mimeType: string, sha256 = '0'.repeat(64)) => {
    if (role === 'scene' || role === 'identity' || role === 'snapshot-scene' || role === 'snapshot-identity' || role === 'appearance' || role === 'snapshot-appearance') {
      documentBytes += sizeBytes
      if (sizeBytes > PROJECT_LIMITS_V5.sceneBytes || documentBytes > PROJECT_LIMITS_V5.archiveDocumentBytes) failV5('文档或身份超过单件/累计预算。')
    }
    expanded += sizeBytes; entries.push({ path, role, sha256, sizeBytes, mimeType })
  }
  const json = (path: string, role: RoleV5, value: unknown) => {
    const bytes = utf8Encoder.encode(JSON.stringify(value))
    if (role === 'history' && bytes.length > PROJECT_LIMITS_V5.manifestBytes) failV5('历史索引超过1 MiB。')
    parseBoundedJson(bytes, jsonBudget); add(path, role, bytes.length, 'application/json')
  }
  json('scene.json', 'scene', archive.project.document); json('identity.json', 'identity', archive.project.historyIdentity); json('appearance.json', 'appearance', archive.project.appearance)
  if (mode === 'history') {
    const index: HistoryIndexV5 = { version: 1, current: resourceRefs(archive.project), snapshots: [] }
    for (const [i, snapshot] of archive.snapshots.entries()) {
      const stem = `snapshots/${String(i).padStart(2, '0')}`, { project, ...summary } = snapshot
      json(`${stem}.scene.json`, 'snapshot-scene', project.document); json(`${stem}.identity.json`, 'snapshot-identity', project.historyIdentity); json(`${stem}.appearance.json`, 'snapshot-appearance', project.appearance)
      index.snapshots.push({ summary, scenePath: `${stem}.scene.json`, identityPath: `${stem}.identity.json`, appearancePath: `${stem}.appearance.json`, ...resourceRefs(project), licenseBindings: project.licenseBindings })
    }
    json('history.json', 'history', index)
  }
  const assets = new Map<string, AssetBlobRecord>(), licenses = new Map<string, CompleteProjectV5['licenses'][string]>()
  for (const project of [archive.project, ...(mode === 'history' ? archive.snapshots.map(snapshot => snapshot.project) : [])]) {
    for (const [hash, asset] of Object.entries(project.assets)) assets.set(hash, asset)
    for (const [hash, license] of Object.entries(project.licenses)) licenses.set(hash, license)
  }
  if (assets.size > PROJECT_LIMITS_V5.uniqueImages || [...assets.values()].reduce((sum, asset) => sum + asset.pixelWidth * asset.pixelHeight, 0) > PROJECT_LIMITS_V5.totalImagePixels) failV5('历史包联合位图数量或累计像素超过保护值。')
  for (const [hash, asset] of assets) add(`assets/${hash}.${suffix[asset.mimeType]}`, 'asset', asset.sizeBytes, asset.mimeType, hash)
  for (const [hash, license] of licenses) add(`licenses/${hash}.txt`, 'license', utf8Encoder.encode(license.text).length, 'text/plain', hash)
  const manifestBytes = utf8Encoder.encode(JSON.stringify(manifestFor(archive.project, mode, entries)))
  if (manifestBytes.length > PROJECT_LIMITS_V5.manifestBytes || entries.length + 1 > PROJECT_LIMITS_V5.entries
    || expanded + manifestBytes.length > PROJECT_LIMITS_V5.expandedBytes) failV5('manifest、条目或总展开预算超限。')
  parseBoundedJson(manifestBytes, jsonBudget)
}
function readManifest(input: unknown): ManifestV5 {
  if (!hasExactKeys(input, ['format', 'containerVersion', 'documentSchemaVersion', 'application', 'applicationVersion', 'profile', 'packageMode', 'sceneId', 'revision', 'entries', 'licenseBindings'])
    || input.format !== 'sceneweave-project' || input.containerVersion !== 5 || input.documentSchemaVersion !== 3 || input.application !== 'Sceneweave'
    || input.profile !== 'm1-composition' || input.packageMode !== 'complete' && input.packageMode !== 'history') failV5('未知版本、profile、packageMode或manifest字段。')
  if (!nonempty(input.applicationVersion, 100) || !nonempty(input.sceneId) || !Number.isSafeInteger(input.revision) || Number(input.revision) < 0
    || !Array.isArray(input.entries) || !input.entries.length || input.entries.length >= PROJECT_LIMITS_V5.entries
    || !Array.isArray(input.licenseBindings) || input.licenseBindings.length > 10_000) failV5('manifest身份、条目或许可绑定无效。')
  const paths = new Set<string>(); let scenes = 0, identities = 0, appearances = 0, histories = 0
  for (const entry of input.entries) {
    if (!hasExactKeys(entry, ['path', 'role', 'sha256', 'sizeBytes', 'mimeType']) || typeof entry.path !== 'string' || paths.has(entry.path)
      || !isSha256(entry.sha256) || !Number.isSafeInteger(entry.sizeBytes) || Number(entry.sizeBytes) < 1) failV5('manifest条目重复、缺失或无效。')
    paths.add(entry.path)
    let budget: number
    if (entry.role === 'scene' && entry.path === 'scene.json' && entry.mimeType === 'application/json') { scenes++; budget = PROJECT_LIMITS_V5.sceneBytes }
    else if (entry.role === 'identity' && entry.path === 'identity.json' && entry.mimeType === 'application/json') { identities++; budget = PROJECT_LIMITS_V5.sceneBytes }
    else if (entry.role === 'appearance' && entry.path === 'appearance.json' && entry.mimeType === 'application/json') { appearances++; budget = PROJECT_LIMITS_V5.sceneBytes }
    else if (entry.role === 'history' && entry.path === 'history.json' && entry.mimeType === 'application/json' && input.packageMode === 'history') { histories++; budget = PROJECT_LIMITS_V5.manifestBytes }
    else if (input.packageMode === 'history' && entry.mimeType === 'application/json'
      && (entry.role === 'snapshot-scene' && /^snapshots\/(?:[0-5][0-9]|6[0-3])\.scene\.json$/.test(entry.path)
        || entry.role === 'snapshot-identity' && /^snapshots\/(?:[0-5][0-9]|6[0-3])\.identity\.json$/.test(entry.path)
        || entry.role === 'snapshot-appearance' && /^snapshots\/(?:[0-5][0-9]|6[0-3])\.appearance\.json$/.test(entry.path))) budget = PROJECT_LIMITS_V5.sceneBytes
    else if (entry.role === 'asset' && Object.hasOwn(suffix, String(entry.mimeType)) && entry.path === `assets/${entry.sha256}.${suffix[entry.mimeType as keyof typeof suffix]}`) budget = PROJECT_LIMITS_V5.imageBytes
    else if (entry.role === 'license' && entry.mimeType === 'text/plain' && entry.path === `licenses/${entry.sha256}.txt`) budget = PROJECT_LIMITS_V5.licenseBytes
    else return failV5('manifest路径、角色、hash或MIME不匹配。')
    if (Number(entry.sizeBytes) > budget) failV5('manifest条目超过单文件预算。')
  }
  if (scenes !== 1 || identities !== 1 || appearances !== 1 || histories !== (input.packageMode === 'history' ? 1 : 0)) failV5('manifest缺少唯一场景、身份或历史索引。')
  return input as unknown as ManifestV5
}

async function pack(input: HistoryArchiveV5, mode: 'complete' | 'history', options: { signal?: AbortSignal }): Promise<Blob> {
  const archive = mode === 'history' ? await validateHistoryArchiveV5(input, options) : structuredClone(input)
  if (mode === 'complete') await validateCapturedProject(archive.project, options)
  const files: Record<string, Uint8Array> = Object.create(null), entries: ManifestEntryV5[] = []
  let expanded = 0, documentBytes = 0
  const add = async (path: string, role: RoleV5, bytes: Uint8Array, mimeType: string) => {
    checkCancelled(options.signal)
    if (files[path]) failV5('不能写入重复路径。')
    expanded += bytes.length
    if (expanded > PROJECT_LIMITS_V5.expandedBytes) failV5('历史包展开量超过300 MiB。')
    if (role === 'scene' || role === 'identity' || role === 'snapshot-scene' || role === 'snapshot-identity' || role === 'appearance' || role === 'snapshot-appearance') {
      documentBytes += bytes.length
      if (documentBytes > PROJECT_LIMITS_V5.archiveDocumentBytes || bytes.length > PROJECT_LIMITS_V5.sceneBytes) failV5('文档或身份超过单件/累计预算。')
    }
    if (role === 'history' && bytes.length > PROJECT_LIMITS_V5.manifestBytes) failV5('历史索引超过1 MiB。')
    files[path] = bytes
    entries.push({ path, role, sha256: await sha256Bytes(bytes), sizeBytes: bytes.length, mimeType })
  }
  const addJson = (path: string, role: RoleV5, value: unknown) => add(path, role, utf8Encoder.encode(JSON.stringify(value)), 'application/json')
  await addJson('scene.json', 'scene', archive.project.document)
  await addJson('identity.json', 'identity', archive.project.historyIdentity); await addJson('appearance.json', 'appearance', archive.project.appearance)
  if (mode === 'history') {
    const index: HistoryIndexV5 = { version: 1, current: resourceRefs(archive.project), snapshots: [] }
    for (const [i, snapshot] of archive.snapshots.entries()) {
      const stem = `snapshots/${String(i).padStart(2, '0')}`, { project, ...summary } = snapshot
      await addJson(`${stem}.scene.json`, 'snapshot-scene', project.document)
      await addJson(`${stem}.identity.json`, 'snapshot-identity', project.historyIdentity); await addJson(`${stem}.appearance.json`, 'snapshot-appearance', project.appearance)
      index.snapshots.push({ summary, scenePath: `${stem}.scene.json`, identityPath: `${stem}.identity.json`, appearancePath: `${stem}.appearance.json`, ...resourceRefs(project), licenseBindings: project.licenseBindings })
    }
    await addJson('history.json', 'history', index)
  }
  const assets = new Map<string, AssetBlobRecord>(), licenses = new Map<string, CompleteProjectV5['licenses'][string]>()
  for (const project of [archive.project, ...(mode === 'history' ? archive.snapshots.map(snapshot => snapshot.project) : [])]) {
    for (const [hash, asset] of Object.entries(project.assets)) {
      const previous = assets.get(hash)
      if (previous && (previous.mimeType !== asset.mimeType || previous.sizeBytes !== asset.sizeBytes || previous.pixelWidth !== asset.pixelWidth || previous.pixelHeight !== asset.pixelHeight)) failV5('同hash位图元数据冲突。')
      assets.set(hash, asset)
    }
    for (const [hash, license] of Object.entries(project.licenses)) {
      if (licenses.has(hash) && licenses.get(hash)!.text !== license.text) failV5('同hash许可文本冲突。')
      licenses.set(hash, license)
    }
  }
  for (const [hash, asset] of [...assets].sort(([a], [b]) => a.localeCompare(b))) await add(`assets/${hash}.${suffix[asset.mimeType]}`, 'asset', new Uint8Array(await asset.blob.arrayBuffer()), asset.mimeType)
  for (const [hash, license] of [...licenses].sort(([a], [b]) => a.localeCompare(b))) await add(`licenses/${hash}.txt`, 'license', utf8Encoder.encode(license.text), 'text/plain')
  const manifest = manifestFor(archive.project, mode, entries)
  const manifestBytes = utf8Encoder.encode(JSON.stringify(manifest))
  if (manifestBytes.length > PROJECT_LIMITS_V5.manifestBytes || entries.length + 1 > PROJECT_LIMITS_V5.entries || expanded + manifestBytes.length > PROJECT_LIMITS_V5.expandedBytes) failV5('manifest、条目或总展开预算超限。')
  files['manifest.json'] = manifestBytes
  // The writer must be accepted by the same bounded parsers as the reader.
  const jsonBudget = { values: 0 }
  for (const [path, bytes] of Object.entries(files)) if (path.endsWith('.json')) parseBoundedJson(bytes, jsonBudget)
  const zipped = zipSync(files, { level: 6 })
  if (zipped.length > PROJECT_LIMITS_V5.compressedBytes) failV5('压缩工程超过100 MiB。')
  checkCancelled(options.signal)
  return new Blob([zipped.slice().buffer], { type: 'application/x-sceneweave' })
}

export async function exportProjectV5(project: CompleteProjectV5, options: { signal?: AbortSignal; includeHistory?: boolean; snapshots?: NamedSnapshotV5[] } = {}): Promise<Blob> {
  return pack({ project, snapshots: options.snapshots ?? [] }, options.includeHistory ? 'history' : 'complete', options)
}
export async function exportHistoryArchiveV5(archive: HistoryArchiveV5, options: { signal?: AbortSignal } = {}): Promise<Blob> { return pack(archive, 'history', options) }

async function readPackage(file: Blob, mode: 'complete' | 'history', options: { signal?: AbortSignal }) {
  const zip = await inspectZipV5(file, options.signal), jsonBudget = { values: 0 }
  const manifest = readManifest(parseBoundedJson(await zip.read('manifest.json'), jsonBudget))
  if (manifest.packageMode !== mode) failV5(`请使用${mode === 'complete' ? '完整工程' : '历史备份'}导入入口，不能静默丢弃历史。`)
  const declared = new Set(['manifest.json', ...manifest.entries.map(entry => entry.path)])
  if ([...zip.entries.keys()].some(path => !declared.has(path)) || [...declared].some(path => !zip.entries.has(path))) failV5('ZIP包含未声明或缺失路径。')
  const bytes = new Map<string, Uint8Array>(), assets: CompleteProjectV5['assets'] = Object.create(null), licenses: CompleteProjectV5['licenses'] = Object.create(null)
  for (const entry of manifest.entries) {
    checkCancelled(options.signal)
    if (zip.entries.get(entry.path)!.expanded !== entry.sizeBytes) failV5('manifest与ZIP声明长度不一致。')
    const value = await zip.read(entry.path)
    if (value.length !== entry.sizeBytes || await sha256Bytes(value) !== entry.sha256) failV5(`${entry.path}大小或SHA-256不匹配。`)
    bytes.set(entry.path, value)
    if (entry.role === 'asset') {
      if (Object.hasOwn(assets, entry.sha256)) failV5('同一位图hash包含多个文件。')
      const image = inspectImageBytes(value)
      if (image.mimeType !== entry.mimeType) failV5('位图实际MIME与manifest不一致。')
      assets[entry.sha256] = { sha256: entry.sha256, blob: new Blob([value.slice().buffer], { type: image.mimeType }), mimeType: image.mimeType,
        sizeBytes: value.length, pixelWidth: image.width, pixelHeight: image.height }
    } else if (entry.role === 'license') {
      if (Object.hasOwn(licenses, entry.sha256)) failV5('同一许可hash包含多个文件。')
      licenses[entry.sha256] = { sha256: entry.sha256, text: utf8Decoder.decode(value) }
    }
  }
  const json = (path: string): unknown => { const value = bytes.get(path); if (!value) failV5(`缺少${path}。`); return parseBoundedJson(value, jsonBudget) }
  const document = json('scene.json') as SceneDocumentV3, identity = json('identity.json') as HistoryIdentityV5, appearance = json('appearance.json') as AppearanceGraphV5
  if (document?.sceneId !== manifest.sceneId || document?.revision !== manifest.revision) failV5('manifest场景ID/revision与scene.json不一致。')
  return { manifest, document, identity, appearance, assets, licenses, json, declared }
}

function selectResources(refs: unknown, resources: { assets: CompleteProjectV5['assets']; licenses: CompleteProjectV5['licenses'] }): Pick<CompleteProjectV5, 'assets' | 'licenses'> {
  if (!hasExactKeys(refs, ['assetHashes', 'licenseHashes']) || !Array.isArray(refs.assetHashes) || !Array.isArray(refs.licenseHashes)
    || refs.assetHashes.length > PROJECT_LIMITS_V5.uniqueImages || refs.licenseHashes.length > PROJECT_LIMITS_V5.entries) failV5('资源绑定字段或数量无效。')
  const result: Pick<CompleteProjectV5, 'assets' | 'licenses'> = { assets: Object.create(null), licenses: Object.create(null) }
  for (const hash of refs.assetHashes) {
    if (!isSha256(hash) || !Object.hasOwn(resources.assets, hash) || Object.hasOwn(result.assets, hash)) failV5('快照位图绑定缺失、重复或无效。')
    result.assets[hash] = resources.assets[hash]
  }
  for (const hash of refs.licenseHashes) {
    if (!isSha256(hash) || !Object.hasOwn(resources.licenses, hash) || Object.hasOwn(result.licenses, hash)) failV5('快照许可绑定缺失、重复或无效。')
    result.licenses[hash] = resources.licenses[hash]
  }
  return result
}

export async function importProjectV5(file: Blob, options: { signal?: AbortSignal } = {}): Promise<CompleteProjectV5> {
  const read = await readPackage(file, 'complete', options)
  const project: CompleteProjectV5 = { document: read.document, historyIdentity: read.identity, appearance: read.appearance, assets: read.assets, licenses: read.licenses, licenseBindings: read.manifest.licenseBindings }
  await validateCapturedProject(project, options)
  return project
}
export async function importHistoryArchiveV5(file: Blob, options: { signal?: AbortSignal } = {}): Promise<HistoryArchiveV5> {
  const read = await readPackage(file, 'history', options), index = read.json('history.json')
  if (!hasExactKeys(index, ['version', 'current', 'snapshots']) || index.version !== 1 || !Array.isArray(index.snapshots) || index.snapshots.length > PROJECT_LIMITS_V5.archiveSnapshots) failV5('历史索引字段缺失、未知或超过预算。')
  const project: CompleteProjectV5 = { document: read.document, historyIdentity: read.identity, appearance: read.appearance, ...selectResources(index.current, read), licenseBindings: read.manifest.licenseBindings }
  const snapshots: NamedSnapshotV5[] = [], selectedPaths = new Set(['manifest.json', 'scene.json', 'identity.json', 'appearance.json', 'history.json'])
  const usedAssets = new Set(Object.keys(project.assets)), usedLicenses = new Set(Object.keys(project.licenses))
  for (const [i, entry] of index.snapshots.entries()) {
    const stem = `snapshots/${String(i).padStart(2, '0')}`
    if (!hasExactKeys(entry, ['summary', 'scenePath', 'identityPath', 'appearancePath', 'assetHashes', 'licenseHashes', 'licenseBindings'])
      || entry.scenePath !== `${stem}.scene.json` || entry.identityPath !== `${stem}.identity.json` || entry.appearancePath !== `${stem}.appearance.json` || !Array.isArray(entry.licenseBindings)) failV5('历史快照路径、字段或绑定无效。')
    validateNamedSnapshotSummaryV5(entry.summary)
    selectedPaths.add(entry.scenePath); selectedPaths.add(entry.identityPath); selectedPaths.add(entry.appearancePath)
    const resources = selectResources({ assetHashes: entry.assetHashes, licenseHashes: entry.licenseHashes }, read)
    Object.keys(resources.assets).forEach(hash => usedAssets.add(hash)); Object.keys(resources.licenses).forEach(hash => usedLicenses.add(hash))
    snapshots.push({ ...entry.summary, project: { document: read.json(entry.scenePath) as SceneDocumentV3, historyIdentity: read.json(entry.identityPath) as HistoryIdentityV5, appearance: read.json(entry.appearancePath) as AppearanceGraphV5,
      ...resources, licenseBindings: entry.licenseBindings } })
  }
  for (const [hash, asset] of Object.entries(read.assets)) if (usedAssets.has(hash)) selectedPaths.add(`assets/${hash}.${suffix[asset.mimeType]}`)
  for (const hash of Object.keys(read.licenses)) if (usedLicenses.has(hash)) selectedPaths.add(`licenses/${hash}.txt`)
  if (selectedPaths.size !== read.declared.size || [...read.declared].some(path => !selectedPaths.has(path))) failV5('历史归档包含无引用资源或快照条目。')
  return validateHistoryArchiveV5({ project, snapshots }, options)
}

export async function inspectProjectVersionV5(file: Blob, options: { signal?: AbortSignal } = {}): Promise<1 | 2 | 3 | 4 | 5> {
  const zip = await inspectZipV5(file, options.signal), manifest = parseBoundedJson(await zip.read('manifest.json'))
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) failV5('manifest缺少格式或容器版本。')
  const candidate = manifest as { format?: unknown; containerVersion?: unknown }
  if (candidate.format !== 'sceneweave-project' || ![1, 2, 3, 4, 5].includes(Number(candidate.containerVersion)) || typeof candidate.containerVersion !== 'number') failV5('未知工程容器版本。')
  checkCancelled(options.signal)
  return candidate.containerVersion as 1 | 2 | 3 | 4 | 5
}
export async function inspectPackageModeV5(file: Blob, options: { signal?: AbortSignal } = {}): Promise<'complete' | 'history'> {
  const zip = await inspectZipV5(file, options.signal)
  return readManifest(parseBoundedJson(await zip.read('manifest.json'))).packageMode
}

export function forkHistoryArchiveV5(input: HistoryArchiveV5): HistoryArchiveV5 {
  const archive = structuredClone(input), sceneId = crypto.randomUUID(), now = new Date().toISOString()
  Object.assign(archive.project.document, { sceneId, revision: 0, title: `${archive.project.document.title} · 副本`, createdAt: now, updatedAt: now })
  for (const snapshot of archive.snapshots) snapshot.sceneId = sceneId
  return archive
}
