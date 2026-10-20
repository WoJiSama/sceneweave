import { zipSync } from 'fflate'
import { inspectDependenciesV2 } from '../../core/v2/dependencies'
import { sceneSchemaV2, validateSceneV2 } from '../../core/v2/schema'
import { checkCancelled, failV2, hasExactKeys, isSha256, PROJECT_LIMITS_V2 } from './limits'
import { parseBoundedJson, utf8Decoder, utf8Encoder } from './json'
import { inspectImageBytes, sha256Bytes, validateImageAssetRecord } from './resources'
import { inspectZipV2 } from './zip'
import { version as applicationVersion } from '../../../package.json'
import { ProjectValidationErrorV2, projectErrorV2, type ProjectDiagnosticV2, type ProjectDiagnosticsV2 } from './diagnostics'
import type { AssetBlobRecord, CompleteProjectV2, LicenseBinding, LicenseSubject, MigrationSourceV2 } from './types'

export { PROJECT_LIMITS_V2 } from './limits'
export { PROJECT_DIAGNOSTIC_LIMIT_V2, ProjectValidationErrorV2 } from './diagnostics'
export type { ProjectDiagnosticV2, ProjectDiagnosticsV2, ProjectDependencySummaryV2 } from './diagnostics'
interface ManifestEntry { path: string; role: 'scene' | 'asset' | 'license'; sha256: string; sizeBytes: number; mimeType: string }
interface ManifestV2 {
  format: 'sceneweave-project'; containerVersion: 2; documentSchemaVersion: 2
  application: 'Sceneweave'; applicationVersion: string; profile: 'm1-assets'; packageMode: 'complete'
  sceneId: string; revision: number; entries: ManifestEntry[]; licenseBindings: LicenseBinding[]
}
const subjectKinds = ['asset', 'material', 'propDefinition', 'prefabDefinition', 'styleTheme'] as const
const suffix: Record<AssetBlobRecord['mimeType'], string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }
const nonemptyString = (value: unknown, max = 256): value is string => typeof value === 'string' && value.length > 0 && Array.from(value).length <= max
const subjectKey = (subject: Pick<LicenseSubject, 'subjectKind' | 'subjectId'>) => JSON.stringify([subject.subjectKind, subject.subjectId])

function validateBinding(input: unknown): asserts input is LicenseBinding {
  if (!hasExactKeys(input, ['subjectKind', 'subjectId', 'licenseRef', 'licensePath', 'embedding'])
    || !subjectKinds.includes(input.subjectKind as typeof subjectKinds[number]) || !nonemptyString(input.subjectId)
    || !nonemptyString(input.licenseRef) || typeof input.licensePath !== 'string'
    || !/^licenses\/[0-9a-f]{64}\.txt$/.test(input.licensePath) || input.embedding !== 'allowed') failV2('许可绑定字段缺失、未知或无效。')
}

function readManifest(input: unknown): ManifestV2 {
  if (!hasExactKeys(input, ['format', 'containerVersion', 'documentSchemaVersion', 'application', 'applicationVersion', 'profile', 'packageMode', 'sceneId', 'revision', 'entries', 'licenseBindings'])) failV2('manifest 字段缺失或未知。')
  if (input.format !== 'sceneweave-project' || input.containerVersion !== 2 || input.documentSchemaVersion !== 2
    || input.application !== 'Sceneweave' || input.profile !== 'm1-assets' || input.packageMode !== 'complete') failV2('未知工程版本、profile 或 packageMode；只接受 v2 完整工程。')
  if (!nonemptyString(input.applicationVersion, 100) || !nonemptyString(input.sceneId)
    || !Number.isSafeInteger(input.revision) || Number(input.revision) < 0) failV2('manifest 场景身份或版本无效。')
  if (!Array.isArray(input.entries) || !input.entries.length || input.entries.length >= PROJECT_LIMITS_V2.entries
    || !Array.isArray(input.licenseBindings) || input.licenseBindings.length > 10_000) failV2('manifest 条目或许可数量无效。')
  const paths = new Set<string>()
  let sceneCount = 0
  for (const entry of input.entries) {
    if (!hasExactKeys(entry, ['path', 'role', 'sha256', 'sizeBytes', 'mimeType']) || typeof entry.path !== 'string' || paths.has(entry.path)
      || !isSha256(entry.sha256) || !Number.isSafeInteger(entry.sizeBytes) || Number(entry.sizeBytes) < 1) failV2('manifest 条目字段缺失、重复或无效。')
    paths.add(entry.path)
    let budget: number
    if (entry.role === 'scene' && entry.path === 'scene.json' && entry.mimeType === 'application/json') {
      sceneCount++; budget = PROJECT_LIMITS_V2.sceneBytes
    } else if (entry.role === 'asset' && Object.hasOwn(suffix, String(entry.mimeType))
      && entry.path === `assets/${entry.sha256}.${suffix[entry.mimeType as keyof typeof suffix]}`) budget = PROJECT_LIMITS_V2.imageBytes
    else if (entry.role === 'license' && entry.mimeType === 'text/plain' && entry.path === `licenses/${entry.sha256}.txt`) budget = PROJECT_LIMITS_V2.licenseBytes
    else return failV2('manifest 路径、角色、hash 或 MIME 不匹配。')
    if (Number(entry.sizeBytes) > budget) failV2('manifest 条目超过资源预算。')
  }
  if (sceneCount !== 1) failV2('manifest 必须恰有一个 scene.json。')
  input.licenseBindings.forEach(validateBinding)
  return input as unknown as ManifestV2
}

function bytesOfLicense(text: unknown): Uint8Array {
  if (typeof text !== 'string' || !text.length) failV2('许可文本必须为非空 UTF-8 文本。')
  const bytes = utf8Encoder.encode(text)
  if (bytes.length > PROJECT_LIMITS_V2.licenseBytes || utf8Decoder.decode(bytes) !== text || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text)) failV2('许可文本编码、控制字符或大小无效。')
  if (/(?:\/(?:Users|home|private|var)\/|[A-Za-z]:\\(?:Users|Documents and Settings)\\)/.test(text)
    || /(?:sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,})/.test(text)) failV2('许可文本包含本地系统路径或疑似凭据。')
  return bytes
}

function adoptedSubject(project: CompleteProjectV2, subject: LicenseSubject): { licenseRef: string; origin: { canEmbed: boolean } } | undefined {
  const doc = project.document
  switch (subject.subjectKind) {
    case 'asset': return doc.assets[subject.subjectId]
    case 'material': return doc.materials[subject.subjectId]
    case 'propDefinition': return doc.propDefinitions[subject.subjectId]
    case 'prefabDefinition': return doc.prefabDefinitions[subject.subjectId]
    case 'styleTheme': return doc.styleThemes[subject.subjectId]
  }
}

async function validateMigration(source: MigrationSourceV2, signal?: AbortSignal): Promise<void> {
  if (!hasExactKeys(source, ['sourceSchemaVersion', 'sourceSceneId', 'sourceRevision', 'sourceHash', 'migratorVersion', 'migratedAt', 'original'])
    || source.sourceSchemaVersion !== 1 || !nonemptyString(source.sourceSceneId) || !Number.isSafeInteger(source.sourceRevision) || source.sourceRevision < 0
    || !isSha256(source.sourceHash) || !nonemptyString(source.migratorVersion, 100) || !nonemptyString(source.migratedAt, 100) || !Number.isFinite(Date.parse(source.migratedAt))
    || !(source.original instanceof Blob) || !source.original.size || source.original.size > 10 * 1024 * 1024) failV2('迁移原件记录无效。')
  checkCancelled(signal)
  if (await sha256Bytes(new Uint8Array(await source.original.arrayBuffer())) !== source.sourceHash) failV2('迁移原件 SHA-256 不匹配。')
  checkCancelled(signal)
}

/** Validate every adopted definition/resource/license before any DB transaction. */
async function validateCompleteProject(project: CompleteProjectV2, options: { signal?: AbortSignal } = {}): Promise<void> {
  checkCancelled(options.signal)
  if (!hasExactKeys(project, ['document', 'assets', 'licenses', 'licenseBindings'], ['migrationSource'])
    || !hasExactKeys(project.assets, [], Object.keys(project.assets ?? {})) || !hasExactKeys(project.licenses, [], Object.keys(project.licenses ?? {}))
    || !Array.isArray(project.licenseBindings) || project.licenseBindings.length > 10_000) failV2('完整工程结构无效。')
  // Reuse the bounded parser for in-memory writers too, before domain traversal.
  let documentBytes: Uint8Array
  try { documentBytes = utf8Encoder.encode(JSON.stringify(project.document)) } catch { return failV2('场景必须为可序列化 JSON。') }
  if (documentBytes.length > PROJECT_LIMITS_V2.sceneBytes) failV2('场景 JSON 超过 20 MiB。')
  const jsonBudget = { values: 0 }
  parseBoundedJson(documentBytes, jsonBudget)
  const checked = validateSceneV2(project.document)
  // A malformed shape must never enter dependency traversal or image decoding.
  const shaped = checked.ok ? { success: true as const, data: checked.document } : sceneSchemaV2.safeParse(project.document)
  if (!shaped.success) throw new ProjectValidationErrorV2(checked.ok ? [] : checked.errors)
  const scene = shaped.data
  const dependencies = inspectDependenciesV2(scene)
  const issues: ProjectDiagnosticV2[] = checked.ok ? [] : [...checked.errors]
  const requiredHashes = new Set<string>()
  for (const id of dependencies.assetIds) {
    const ref = scene.assets[id]
    requiredHashes.add(ref.sha256)
    const record = Object.hasOwn(project.assets, ref.sha256) ? project.assets[ref.sha256] : undefined
    if (!record) issues.push({ code: 'MISSING_BITMAP', entityId: id, dependencyId: id, sha256: ref.sha256,
      message: `资产 ${id} 的字节依赖缺失；请恢复 SHA-256 ${ref.sha256} 的原位图或显式采用可用替代。` })
    else if (record.sha256 !== ref.sha256 || record.mimeType !== ref.mimeType
      || record.pixelWidth !== ref.pixelWidth || record.pixelHeight !== ref.pixelHeight) issues.push({ code: 'ASSET_RECORD_MISMATCH', entityId: id, dependencyId: id, sha256: ref.sha256,
        message: `资产 ${id} 的字节、MIME 或尺寸依赖缺失/不匹配；请恢复与素材记录一致的原位图。` })
  }
  for (const hash of Object.keys(project.assets)) if (!isSha256(hash) || !requiredHashes.has(hash)) issues.push({ code: 'UNUSED_BITMAP',
    ...(isSha256(hash) ? { sha256: hash } : {}), message: '位图资源必须恰好覆盖依赖闭包，不能包含缓存或缺项。' })
  if (requiredHashes.size > PROJECT_LIMITS_V2.uniqueImages) issues.push({ code: 'IMAGE_COUNT_BUDGET', message: '独立位图超过 256 张。' })
  let pixels = 0, expanded = documentBytes.length
  for (const hash of requiredHashes) {
    const record = project.assets[hash]
    if (!record) continue
    const count = record.pixelWidth * record.pixelHeight
    if (!Number.isSafeInteger(count) || count < 1 || (pixels += count) > PROJECT_LIMITS_V2.totalImagePixels) issues.push({ code: 'IMAGE_PIXEL_BUDGET', sha256: hash, message: '累计位图像素超过 64000000。' })
    if (!Number.isSafeInteger(record.sizeBytes) || (expanded += record.sizeBytes) > PROJECT_LIMITS_V2.expandedBytes) issues.push({ code: 'EXPANDED_BYTE_BUDGET', sha256: hash, message: '完整工程展开量超过 300 MiB。' })
  }
  const requiredSubjects = new Map<string, LicenseSubject>(dependencies.subjects.map(subject => [subjectKey(subject), subject]))
  const bindingSubjects = new Set<string>(), usedLicenses = new Set<string>(), refs = new Map<string, string>()
  if (requiredSubjects.size !== dependencies.subjects.length) issues.push({ code: 'DUPLICATE_LICENSE_SUBJECT', message: '重复的许可依赖主体。' })
  for (const [index, binding] of project.licenseBindings.entries()) {
    try { validateBinding(binding) } catch {
      issues.push({ code: 'INVALID_LICENSE_BINDING', path: `licenseBindings[${index}]`, message: '许可绑定字段缺失、未知或无效。' }); continue
    }
    const key = subjectKey(binding), subject = requiredSubjects.get(key)
    if (!subject || bindingSubjects.has(key) || subject.licenseRef !== binding.licenseRef) {
      issues.push({ code: 'INVALID_LICENSE_BINDING', entityId: binding.subjectId, path: `licenseBindings[${index}]`, message: '许可绑定悬空、重复或 licenseRef 不一致。' }); continue
    }
    bindingSubjects.add(key)
    const adopted = adoptedSubject({ ...project, document: scene }, subject)
    if (!adopted || adopted.licenseRef !== binding.licenseRef || adopted.origin.canEmbed !== true) issues.push({ code: 'EMBEDDING_FORBIDDEN', entityId: binding.subjectId,
      message: `主体 ${binding.subjectId} 未获准嵌入；请核对来源或显式采用允许嵌入的替代。` })
    const hash = binding.licensePath.slice(9, -4)
    usedLicenses.add(hash)
    if (!Object.hasOwn(project.licenses, hash)) issues.push({ code: 'MISSING_LICENSE', entityId: binding.subjectId, sha256: hash, path: binding.licensePath,
      message: `主体 ${binding.subjectId} 缺少许可文本；请恢复对应许可及必要署名。` })
    if (refs.has(binding.licenseRef) && refs.get(binding.licenseRef) !== hash) issues.push({ code: 'AMBIGUOUS_LICENSE', entityId: binding.subjectId, message: '同一 licenseRef 不能绑定多份不同文本。' })
    refs.set(binding.licenseRef, hash)
  }
  for (const [key, subject] of requiredSubjects) if (!bindingSubjects.has(key)) issues.push({ code: 'MISSING_LICENSE_BINDING', entityId: subject.subjectId,
    message: `采用对象 ${subject.subjectId} 缺少许可绑定；请恢复来源、许可与允许嵌入记录。` })
  for (const hash of Object.keys(project.licenses)) if (!isSha256(hash) || !usedLicenses.has(hash)) issues.push({ code: 'UNUSED_LICENSE',
    ...(isSha256(hash) ? { sha256: hash } : {}), message: '许可文本必须恰好覆盖依赖闭包。' })
  for (const hash of usedLicenses) {
    checkCancelled(options.signal)
    const record = project.licenses[hash]
    if (!record) continue
    if (!hasExactKeys(record, ['sha256', 'text']) || record.sha256 !== hash) {
      issues.push({ code: 'INVALID_LICENSE', sha256: hash, path: `licenses/${hash}.txt`, message: '许可文本记录无效。' }); continue
    }
    try {
      const bytes = bytesOfLicense(record.text)
      if (await sha256Bytes(bytes) !== hash) issues.push({ code: 'LICENSE_HASH_MISMATCH', sha256: hash, path: `licenses/${hash}.txt`, message: '许可文本 SHA-256 不匹配。' })
      expanded += bytes.length
    } catch { issues.push({ code: 'INVALID_LICENSE', sha256: hash, path: `licenses/${hash}.txt`, message: '许可文本编码、控制字符、大小或来源信息无效；请恢复有效许可文本。' }) }
  }
  if (issues.length) throw new ProjectValidationErrorV2(issues)
  // Local saves must also remain representable by the same complete container.
  const previewEntries: ManifestEntry[] = [{ path: 'scene.json', role: 'scene', sha256: '0'.repeat(64), sizeBytes: documentBytes.length, mimeType: 'application/json' }]
  for (const hash of requiredHashes) {
    const asset = project.assets[hash]
    previewEntries.push({ path: `assets/${hash}.${suffix[asset.mimeType]}`, role: 'asset', sha256: hash, sizeBytes: asset.sizeBytes, mimeType: asset.mimeType })
  }
  for (const hash of usedLicenses) previewEntries.push({ path: `licenses/${hash}.txt`, role: 'license', sha256: hash, sizeBytes: bytesOfLicense(project.licenses[hash].text).length, mimeType: 'text/plain' })
  const manifestBytes = utf8Encoder.encode(JSON.stringify({ format: 'sceneweave-project', containerVersion: 2, documentSchemaVersion: 2,
    application: 'Sceneweave', applicationVersion, profile: 'm1-assets', packageMode: 'complete', sceneId: scene.sceneId, revision: scene.revision,
    entries: previewEntries, licenseBindings: project.licenseBindings } satisfies ManifestV2))
  if (manifestBytes.length > PROJECT_LIMITS_V2.manifestBytes) failV2('manifest 超过 1 MiB。')
  parseBoundedJson(manifestBytes, jsonBudget)
  if (expanded + manifestBytes.length > PROJECT_LIMITS_V2.expandedBytes) failV2('完整工程展开量超过 300 MiB。')
  if (requiredHashes.size + usedLicenses.size + 2 > PROJECT_LIMITS_V2.entries) failV2('完整工程条目超过保护值。')
  // Header/hash/decode only after the entire closure and cumulative pixels pass.
  for (const hash of requiredHashes) await validateImageAssetRecord(project.assets[hash], options)
  if (project.migrationSource) await validateMigration(project.migrationSource, options.signal)
  checkCancelled(options.signal)
}

function snapshotProject(project: CompleteProjectV2): CompleteProjectV2 {
  return {
    document: structuredClone(project.document),
    assets: Object.fromEntries(Object.entries(project.assets).map(([hash, record]) => [hash, { ...record }])),
    licenses: structuredClone(project.licenses), licenseBindings: structuredClone(project.licenseBindings),
    ...(project.migrationSource ? { migrationSource: { ...project.migrationSource } } : {}),
  }
}

/** Version dispatch only. The selected strict reader still validates its profile. */
async function inspectProjectVersion(file: Blob, options: { signal?: AbortSignal } = {}): Promise<1 | 2> {
  const zip = await inspectZipV2(file, options.signal)
  const manifest = parseBoundedJson(await zip.read('manifest.json'))
  if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)
    || !Object.hasOwn(manifest, 'format') || !Object.hasOwn(manifest, 'containerVersion')) failV2('manifest 缺少格式或容器版本。')
  const candidate = manifest as { format: unknown; containerVersion: unknown }
  if (candidate.format !== 'sceneweave-project' || (candidate.containerVersion !== 1 && candidate.containerVersion !== 2)) failV2('未知工程容器版本。')
  checkCancelled(options.signal)
  return candidate.containerVersion
}

async function exportCompleteProject(project: CompleteProjectV2, options: { signal?: AbortSignal } = {}): Promise<Blob> {
  checkCancelled(options.signal)
  const snapshot = snapshotProject(project)
  await validateCompleteProjectV2(snapshot, options)
  const files: Record<string, Uint8Array> = Object.create(null)
  const entries: ManifestEntry[] = []
  const add = async (path: string, role: ManifestEntry['role'], bytes: Uint8Array, mimeType: string) => {
    checkCancelled(options.signal)
    files[path] = bytes
    entries.push({ path, role, sha256: await sha256Bytes(bytes), sizeBytes: bytes.length, mimeType })
  }
  await add('scene.json', 'scene', utf8Encoder.encode(JSON.stringify(snapshot.document)), 'application/json')
  for (const [hash, asset] of Object.entries(snapshot.assets).sort(([a], [b]) => a.localeCompare(b))) {
    await add(`assets/${hash}.${suffix[asset.mimeType]}`, 'asset', new Uint8Array(await asset.blob.arrayBuffer()), asset.mimeType)
  }
  for (const [hash, license] of Object.entries(snapshot.licenses).sort(([a], [b]) => a.localeCompare(b))) await add(`licenses/${hash}.txt`, 'license', bytesOfLicense(license.text), 'text/plain')
  const manifest: ManifestV2 = {
    format: 'sceneweave-project', containerVersion: 2, documentSchemaVersion: 2, application: 'Sceneweave', applicationVersion,
    profile: 'm1-assets', packageMode: 'complete', sceneId: snapshot.document.sceneId, revision: snapshot.document.revision,
    entries, licenseBindings: snapshot.licenseBindings,
  }
  const manifestBytes = utf8Encoder.encode(JSON.stringify(manifest))
  if (manifestBytes.length > PROJECT_LIMITS_V2.manifestBytes) failV2('manifest 超过 1 MiB。')
  files['manifest.json'] = manifestBytes
  checkCancelled(options.signal)
  const bytes = zipSync(files, { level: 6 })
  checkCancelled(options.signal)
  if (bytes.length > PROJECT_LIMITS_V2.compressedBytes) failV2('压缩工程超过 100 MiB。')
  return new Blob([bytes.slice().buffer], { type: 'application/x-sceneweave' })
}

/** Returns an isolated candidate; caller forks identity and atomically adopts it. */
async function importCompleteProject(file: Blob, options: { signal?: AbortSignal } = {}): Promise<CompleteProjectV2> {
  const zip = await inspectZipV2(file, options.signal)
  const budget = { values: 0 }
  const manifest = readManifest(parseBoundedJson(await zip.read('manifest.json'), budget))
  const declaredPaths = new Set(['manifest.json', ...manifest.entries.map(entry => entry.path)])
  const entryIssues: ProjectDiagnosticV2[] = []
  for (const entry of manifest.entries) if (!zip.entries.has(entry.path)) entryIssues.push({ code: 'MISSING_PACKAGE_ENTRY', path: entry.path, sha256: entry.sha256,
    message: `ZIP 缺少 ${entry.path}；请保留原文件并恢复完整备份。` })
  for (const path of zip.entries.keys()) if (!declaredPaths.has(path)) entryIssues.push({ code: 'UNDECLARED_PACKAGE_ENTRY', path, message: `ZIP 实际条目 ${path} 未在 manifest 声明。` })
  if (entryIssues.length) throw new ProjectValidationErrorV2(entryIssues)
  const files = new Map<string, Uint8Array>()
  for (const entry of manifest.entries) {
    checkCancelled(options.signal)
    if (zip.entries.get(entry.path)!.expanded !== entry.sizeBytes) failV2('manifest 与 ZIP 声明长度不一致。')
    let bytes: Uint8Array
    try { bytes = await zip.read(entry.path) } catch (error) { return projectErrorV2(error, { code: 'ZIP_ENTRY_INVALID', path: entry.path, sha256: entry.sha256 }) }
    if (bytes.length !== entry.sizeBytes || await sha256Bytes(bytes) !== entry.sha256) throw new ProjectValidationErrorV2([{ code: 'PACKAGE_HASH_MISMATCH', path: entry.path, sha256: entry.sha256,
      message: `${entry.path} 的大小或 SHA-256 不匹配；请恢复未经损坏的完整备份。` }])
    files.set(entry.path, bytes)
  }
  const input = parseBoundedJson(files.get('scene.json')!, budget), shaped = sceneSchemaV2.safeParse(input)
  if (!shaped.success) {
    const checked = validateSceneV2(input)
    throw new ProjectValidationErrorV2(checked.ok ? [] : checked.errors)
  }
  if (shaped.data.sceneId !== manifest.sceneId || shaped.data.revision !== manifest.revision) failV2('manifest 场景 ID/revision 与 scene.json 不一致。')
  const project: CompleteProjectV2 = { document: shaped.data, assets: Object.create(null), licenses: Object.create(null), licenseBindings: manifest.licenseBindings }
  for (const entry of manifest.entries) {
    const bytes = files.get(entry.path)!
    if (entry.role === 'asset') {
      if (Object.hasOwn(project.assets, entry.sha256)) failV2('同一位图 hash 不得包含多个文件。')
      let header: ReturnType<typeof inspectImageBytes>
      try { header = inspectImageBytes(bytes) } catch (error) { return projectErrorV2(error, { code: 'IMAGE_ENCODING_INVALID', path: entry.path, sha256: entry.sha256 }) }
      if (header.mimeType !== entry.mimeType) failV2('位图实际 MIME 与 manifest 不一致。')
      project.assets[entry.sha256] = { sha256: entry.sha256, blob: new Blob([bytes.slice().buffer], { type: header.mimeType }), mimeType: header.mimeType, sizeBytes: bytes.length, pixelWidth: header.width, pixelHeight: header.height }
    } else if (entry.role === 'license') {
      let text: string
      try { text = utf8Decoder.decode(bytes) } catch { return failV2('许可文本必须为有效 UTF-8。') }
      bytesOfLicense(text)
      project.licenses[entry.sha256] = { sha256: entry.sha256, text }
    }
  }
  await validateCompleteProjectV2(project, options)
  return project
}

export async function validateCompleteProjectV2(project: CompleteProjectV2, options: { signal?: AbortSignal } = {}): Promise<void> {
  try { await validateCompleteProject(project, options) } catch (error) { projectErrorV2(error) }
}

/** A report is diagnostic only; failed reports never produce an adoptable project. */
export async function diagnoseCompleteProjectV2(project: CompleteProjectV2, options: { signal?: AbortSignal } = {}): Promise<ProjectDiagnosticsV2> {
  try {
    await validateCompleteProjectV2(project, options)
    const scene = project.document
    return { complete: true, issues: [], summary: {
      assets: Object.keys(scene.assets).length, bitmapBlobs: Object.keys(project.assets).length,
      materials: Object.keys(scene.materials).length, propDefinitions: Object.keys(scene.propDefinitions).length,
      prefabDefinitions: Object.keys(scene.prefabDefinitions).length, styleThemes: Object.keys(scene.styleThemes).length,
      licenseBindings: project.licenseBindings.length, licenseTexts: Object.keys(project.licenses).length,
      bitmapPixels: Object.values(project.assets).reduce((sum, asset) => sum + asset.pixelWidth * asset.pixelHeight, 0),
    } }
  } catch (error) {
    if (error instanceof ProjectValidationErrorV2) return { complete: false, issues: error.issues, summary: null }
    throw error
  }
}

export async function inspectProjectVersionV2(file: Blob, options: { signal?: AbortSignal } = {}): Promise<1 | 2> {
  try { return await inspectProjectVersion(file, options) } catch (error) { return projectErrorV2(error) }
}

export async function exportProjectV2(project: CompleteProjectV2, options: { signal?: AbortSignal } = {}): Promise<Blob> {
  try { return await exportCompleteProject(project, options) } catch (error) { return projectErrorV2(error) }
}

export async function importProjectV2(file: Blob, options: { signal?: AbortSignal } = {}): Promise<CompleteProjectV2> {
  try { return await importCompleteProject(file, options) } catch (error) { return projectErrorV2(error) }
}
