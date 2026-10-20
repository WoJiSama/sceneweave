import { zipSync } from 'fflate'
import { collectDependenciesV2 } from '../../core/v2/dependencies'
import { validateSceneV2 } from '../../core/v2/schema'
import { checkCancelled, failV2, hasExactKeys, isSha256, PROJECT_LIMITS_V2 } from './limits'
import { parseBoundedJson, utf8Decoder, utf8Encoder } from './json'
import { inspectImageBytes, sha256Bytes, validateImageAssetRecord } from './resources'
import { inspectZipV2 } from './zip'
import type { AssetBlobRecord, CompleteProjectV2, LicenseBinding, LicenseSubject, MigrationSourceV2 } from './types'

export { PROJECT_LIMITS_V2 } from './limits'
interface ManifestEntry { path: string; role: 'scene' | 'asset' | 'license'; sha256: string; sizeBytes: number; mimeType: string }
interface ManifestV2 {
  format: 'sceneweave-project'; containerVersion: 2; documentSchemaVersion: 2
  application: 'Sceneweave'; applicationVersion: string; profile: 'm1-assets'; packageMode: 'complete'
  sceneId: string; revision: number; entries: ManifestEntry[]; licenseBindings: LicenseBinding[]
}
const subjectKinds = ['asset', 'material', 'propDefinition', 'prefabDefinition', 'styleTheme'] as const
const suffix: Record<AssetBlobRecord['mimeType'], string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }
const applicationVersion = '0.2.0-m1-b1'
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
export async function validateCompleteProjectV2(project: CompleteProjectV2, options: { signal?: AbortSignal } = {}): Promise<void> {
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
  if (!checked.ok) failV2(checked.errors.map(issue => issue.message).join('；'))
  const scene = checked.document
  const dependencies = collectDependenciesV2(scene)
  const requiredHashes = new Set<string>()
  for (const id of dependencies.assetIds) {
    const ref = scene.assets[id]
    if (!ref) failV2(`缺少资产 ${id}。`)
    requiredHashes.add(ref.sha256)
    const record = project.assets[ref.sha256]
    if (!record || record.sha256 !== ref.sha256 || record.mimeType !== ref.mimeType
      || record.pixelWidth !== ref.pixelWidth || record.pixelHeight !== ref.pixelHeight) failV2(`资产 ${id} 的字节、MIME 或尺寸依赖缺失/不匹配。`)
  }
  if (requiredHashes.size !== Object.keys(project.assets).length || Object.keys(project.assets).some(hash => !isSha256(hash) || !requiredHashes.has(hash))) failV2('位图资源必须恰好覆盖依赖闭包，不能包含缓存或缺项。')
  if (requiredHashes.size > PROJECT_LIMITS_V2.uniqueImages) failV2('独立位图超过 256 张。')
  let pixels = 0, expanded = documentBytes.length
  for (const hash of requiredHashes) {
    const record = project.assets[hash]
    const count = record.pixelWidth * record.pixelHeight
    if (!Number.isSafeInteger(count) || count < 1 || (pixels += count) > PROJECT_LIMITS_V2.totalImagePixels) failV2('累计位图像素超过 64000000。')
    if (!Number.isSafeInteger(record.sizeBytes) || (expanded += record.sizeBytes) > PROJECT_LIMITS_V2.expandedBytes) failV2('完整工程展开量超过 300 MiB。')
  }
  const requiredSubjects = new Map<string, LicenseSubject>(dependencies.subjects.map(subject => [subjectKey(subject), subject]))
  const bindingSubjects = new Set<string>(), usedLicenses = new Set<string>(), refs = new Map<string, string>()
  if (requiredSubjects.size !== dependencies.subjects.length) failV2('重复的许可依赖主体。')
  for (const binding of project.licenseBindings) {
    validateBinding(binding)
    const key = subjectKey(binding), subject = requiredSubjects.get(key)
    if (!subject || bindingSubjects.has(key) || subject.licenseRef !== binding.licenseRef) failV2('许可绑定悬空、重复或 licenseRef 不一致。')
    const adopted = adoptedSubject({ ...project, document: scene }, subject)
    if (!adopted || adopted.licenseRef !== binding.licenseRef || adopted.origin.canEmbed !== true) failV2(`主体 ${binding.subjectId} 未获准嵌入。`)
    bindingSubjects.add(key)
    const hash = binding.licensePath.slice(9, -4)
    if (!Object.hasOwn(project.licenses, hash)) failV2(`主体 ${binding.subjectId} 缺少许可文本。`)
    if (refs.has(binding.licenseRef) && refs.get(binding.licenseRef) !== hash) failV2('同一 licenseRef 不能绑定多份不同文本。')
    refs.set(binding.licenseRef, hash); usedLicenses.add(hash)
  }
  if (bindingSubjects.size !== requiredSubjects.size) failV2('有实际采用对象缺少许可绑定。')
  if (usedLicenses.size !== Object.keys(project.licenses).length || Object.keys(project.licenses).some(hash => !isSha256(hash) || !usedLicenses.has(hash))) failV2('许可文本必须恰好覆盖依赖闭包。')
  for (const hash of usedLicenses) {
    checkCancelled(options.signal)
    const record = project.licenses[hash]
    if (!hasExactKeys(record, ['sha256', 'text']) || record.sha256 !== hash) failV2('许可文本记录无效。')
    const bytes = bytesOfLicense(record.text)
    if (await sha256Bytes(bytes) !== hash) failV2('许可文本 SHA-256 不匹配。')
    expanded += bytes.length
  }
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
export async function inspectProjectVersionV2(file: Blob, options: { signal?: AbortSignal } = {}): Promise<1 | 2> {
  const zip = await inspectZipV2(file, options.signal)
  const manifest = parseBoundedJson(await zip.read('manifest.json'))
  if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)
    || !Object.hasOwn(manifest, 'format') || !Object.hasOwn(manifest, 'containerVersion')) failV2('manifest 缺少格式或容器版本。')
  const candidate = manifest as { format: unknown; containerVersion: unknown }
  if (candidate.format !== 'sceneweave-project' || (candidate.containerVersion !== 1 && candidate.containerVersion !== 2)) failV2('未知工程容器版本。')
  checkCancelled(options.signal)
  return candidate.containerVersion
}

export async function exportProjectV2(project: CompleteProjectV2, options: { signal?: AbortSignal } = {}): Promise<Blob> {
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
export async function importProjectV2(file: Blob, options: { signal?: AbortSignal } = {}): Promise<CompleteProjectV2> {
  const zip = await inspectZipV2(file, options.signal)
  const budget = { values: 0 }
  const manifest = readManifest(parseBoundedJson(await zip.read('manifest.json'), budget))
  if (zip.entries.size !== manifest.entries.length + 1 || manifest.entries.some(entry => !zip.entries.has(entry.path))) failV2('ZIP 实际条目与 manifest 不一致。')
  const files = new Map<string, Uint8Array>()
  for (const entry of manifest.entries) {
    checkCancelled(options.signal)
    if (zip.entries.get(entry.path)!.expanded !== entry.sizeBytes) failV2('manifest 与 ZIP 声明长度不一致。')
    const bytes = await zip.read(entry.path)
    if (bytes.length !== entry.sizeBytes || await sha256Bytes(bytes) !== entry.sha256) failV2(`${entry.path} 的大小或 SHA-256 不匹配。`)
    files.set(entry.path, bytes)
  }
  const checked = validateSceneV2(parseBoundedJson(files.get('scene.json')!, budget))
  if (!checked.ok) failV2(checked.errors.map(issue => issue.message).join('；'))
  if (checked.document.sceneId !== manifest.sceneId || checked.document.revision !== manifest.revision) failV2('manifest 场景 ID/revision 与 scene.json 不一致。')
  const project: CompleteProjectV2 = { document: checked.document, assets: Object.create(null), licenses: Object.create(null), licenseBindings: manifest.licenseBindings }
  for (const entry of manifest.entries) {
    const bytes = files.get(entry.path)!
    if (entry.role === 'asset') {
      if (Object.hasOwn(project.assets, entry.sha256)) failV2('同一位图 hash 不得包含多个文件。')
      const header = inspectImageBytes(bytes)
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
