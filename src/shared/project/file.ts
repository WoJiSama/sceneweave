import { zipSync } from 'fflate'
import type { AssetRecord, LicenseBinding, LicenseTextRecord, ProjectBundle, ProjectData, SnapshotSummary } from '../model/project.js'
import type { CompleteValidationOptions } from '../ports/resources.js'
import { checkCancelled } from '../ports/resources.js'
import { canonicalJson, encodeUtf8 } from '../validation/json.js'
import { assetRecordSchema, licenseBindingSchema, validateProjectData } from './validate.js'
import { projectSourceRecords } from './source-resources.js'
import { createMemoryResources, validateProjectBundle } from './resources.js'
import type { HistoryArchive, SnapshotBundle } from './history.js'
import { validateHistoryArchive } from './history.js'
import { decodeUtf8, sha256Bytes } from './binary.js'
import { parseBoundedJson } from './json.js'
import { failPackage, hasExactKeys, isSha256, PACKAGE_LIMITS } from './limits.js'
import { inspectZip, zipPathBudget } from './zip.js'

export type PackageRole = 'scene' | 'identity' | 'appearance' | 'sources' | 'history'
  | 'snapshot-scene' | 'snapshot-identity' | 'snapshot-appearance' | 'snapshot-sources' | 'asset' | 'license' | 'source'
export interface ManifestEntry { path: string; role: PackageRole; sha256: string; sizeBytes: number; mimeType: string }
export interface ProjectManifest {
  format: 'sceneweave-complete-project'; schemaVersion: 1 | 2; application: 'Sceneweave'; applicationVersion: string
  packageMode: 'complete' | 'history'; sceneId: string; revision: number; entries: ManifestEntry[]
  assetRecords: Record<string, AssetRecord>; licenseBindings: LicenseBinding[]
}
export interface ProjectReferences {
  scenePath: string; identityPath: string; appearancePath: string; sourcesPath: string
  assetHashes: string[]; licenseHashes: string[]; sourceHashes: string[]; licenseBindings: LicenseBinding[]
}
export interface HistoryIndex { schemaVersion: 1; current: ProjectReferences; snapshots: (ProjectReferences & { summary: SnapshotSummary })[] }
const suffix: Record<AssetRecord['mimeType'], string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }
const rootPaths = { scenePath: 'scene.json', identityPath: 'identity.json', appearancePath: 'appearance.json', sourcesPath: 'sources.json' }
const referenceKeys = ['scenePath', 'identityPath', 'appearancePath', 'sourcesPath', 'assetHashes', 'licenseHashes', 'sourceHashes', 'licenseBindings']
const nonempty = (value: unknown, max = 256): value is string => typeof value === 'string' && value.length > 0 && value.length <= max
const sorted = (values: string[]): string[] => values.sort((a, b) => a < b ? -1 : a > b ? 1 : 0)
const same = (a: unknown, b: unknown): boolean => canonicalJson(a) === canonicalJson(b)
const snapshotPaths = (index: number): typeof rootPaths => {
  const stem = `snapshots/${String(index).padStart(2, '0')}`
  return { scenePath: `${stem}.scene.json`, identityPath: `${stem}.identity.json`, appearancePath: `${stem}.appearance.json`, sourcesPath: `${stem}.sources.json` }
}
function references(project: ProjectData, paths = rootPaths): ProjectReferences {
  const sourceHashes = new Set<string>()
  for (const source of Object.values(project.authoringSources)) { sourceHashes.add(source.sourceSha256); sourceHashes.add(source.normalizedSha256) }
  return { ...paths, assetHashes: sorted(Object.keys(project.assets)), licenseHashes: sorted(Object.keys(project.licenses)), sourceHashes: sorted([...sourceHashes]), licenseBindings: project.licenseBindings }
}
function readBindings(input: unknown): LicenseBinding[] {
  if (!Array.isArray(input) || input.length > 10_000) return failPackage('许可绑定数量无效。')
  const result: LicenseBinding[] = []
  for (const item of input) {
    const parsed = licenseBindingSchema.safeParse(item)
    if (!parsed.success) return failPackage('许可绑定字段缺失、未知或无效。')
    result.push(parsed.data)
  }
  return result
}
function readAssetRecords(input: unknown): Record<string, AssetRecord> {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return failPackage('图片描述必须是hash映射。')
  const records: Record<string, AssetRecord> = Object.create(null)
  let pixels = 0
  for (const [hash, item] of Object.entries(input)) {
    const parsed = assetRecordSchema.safeParse(item)
    if (!isSha256(hash) || !parsed.success || parsed.data.sha256 !== hash) return failPackage('图片描述键/hash/字段无效。')
    const record = parsed.data, count = record.pixelWidth * record.pixelHeight
    if (count > PACKAGE_LIMITS.imagePixels || (pixels += count) > PACKAGE_LIMITS.totalImagePixels) return failPackage('联合图片像素超过保护值。')
    records[hash] = record
  }
  if (Object.keys(records).length > PACKAGE_LIMITS.uniqueImages) return failPackage('联合图片数超过256张。')
  return records
}
function roleFor(path: string, mimeType: string, hash: string, mode: ProjectManifest['packageMode']): PackageRole {
  const budget = zipPathBudget(path)
  if (!budget) return failPackage('未知路径。')
  if (mimeType === 'application/json') {
    const roots: Record<string, PackageRole> = { 'scene.json': 'scene', 'identity.json': 'identity', 'appearance.json': 'appearance', 'sources.json': 'sources' }
    if (Object.hasOwn(roots, path)) return roots[path]
    if (mode === 'history' && path === 'history.json') return 'history'
    const match = /^snapshots\/(?:[0-5][0-9]|6[0-3])\.(scene|identity|appearance|sources)\.json$/.exec(path)
    if (mode === 'history' && match) return `snapshot-${match[1]}` as PackageRole
  }
  if (Object.hasOwn(suffix, mimeType) && path === `assets/${hash}.${suffix[mimeType as keyof typeof suffix]}`) return 'asset'
  if (mimeType === 'text/plain' && path === `licenses/${hash}.txt`) return 'license'
  if (mimeType === 'image/svg+xml' && path === `sources/${hash}.svg`) return 'source'
  return failPackage('路径、角色、hash和MIME不匹配。')
}
function readManifest(input: unknown): ProjectManifest {
  if (!hasExactKeys(input, ['format', 'schemaVersion', 'application', 'applicationVersion', 'packageMode', 'sceneId', 'revision', 'entries', 'assetRecords', 'licenseBindings'])
    || input.format !== 'sceneweave-complete-project' || input.schemaVersion !== 1 && input.schemaVersion !== 2 || input.application !== 'Sceneweave'
    || input.packageMode !== 'complete' && input.packageMode !== 'history'
    || !nonempty(input.applicationVersion, 100) || !nonempty(input.sceneId) || !Number.isSafeInteger(input.revision) || Number(input.revision) < 0
    || !Array.isArray(input.entries) || input.entries.length < 4 || input.entries.length >= PACKAGE_LIMITS.entries) return failPackage('manifest格式、版本、字段或身份无效。')
  const paths = new Set<string>(), entries: ManifestEntry[] = []
  for (const value of input.entries) {
    if (!hasExactKeys(value, ['path', 'role', 'sha256', 'sizeBytes', 'mimeType']) || typeof value.path !== 'string' || paths.has(value.path)
      || !isSha256(value.sha256) || !Number.isSafeInteger(value.sizeBytes) || Number(value.sizeBytes) <= 0 || typeof value.mimeType !== 'string') return failPackage('manifest条目重复、缺失或无效。')
    const role = roleFor(value.path, value.mimeType, value.sha256, input.packageMode)
    if (value.role !== role || Number(value.sizeBytes) > zipPathBudget(value.path)) return failPackage('manifest条目角色或单文件预算不匹配。')
    paths.add(value.path); entries.push(value as unknown as ManifestEntry)
  }
  if (Object.values(rootPaths).some(path => !paths.has(path)) || paths.has('history.json') !== (input.packageMode === 'history')) return failPackage('manifest缺少唯一四份JSON或历史索引。')
  return { format: 'sceneweave-complete-project', schemaVersion: input.schemaVersion, application: 'Sceneweave', applicationVersion: input.applicationVersion,
    packageMode: input.packageMode, sceneId: input.sceneId, revision: Number(input.revision), entries,
    assetRecords: readAssetRecords(input.assetRecords), licenseBindings: readBindings(input.licenseBindings) }
}
function readHashList(input: unknown, maximum: number): string[] {
  if (!Array.isArray(input) || input.length > maximum || input.some(item => !isSha256(item))) return failPackage('历史资源hash列表无效。')
  const values = input as string[]
  if (!same(values, sorted([...new Set(values)]))) return failPackage('历史hash列表须按顺序唯一声明。')
  return values
}
function readReferences(input: unknown, expectedPaths: typeof rootPaths, summary: boolean): ProjectReferences {
  if (!hasExactKeys(input, [...referenceKeys, ...(summary ? ['summary'] : [])])) return failPackage('历史引用字段缺失或未知。')
  for (const key of Object.keys(expectedPaths) as (keyof typeof rootPaths)[]) if (input[key] !== expectedPaths[key]) return failPackage('历史JSON路径和索引序号不匹配。')
  const sourceHashes = readHashList(input.sourceHashes, PACKAGE_LIMITS.uniqueImages * 2)
  return { ...expectedPaths, assetHashes: readHashList(input.assetHashes, PACKAGE_LIMITS.uniqueImages), licenseHashes: readHashList(input.licenseHashes, 10_000), sourceHashes, licenseBindings: readBindings(input.licenseBindings) }
}
function readHistoryIndex(input: unknown): HistoryIndex {
  if (!hasExactKeys(input, ['schemaVersion', 'current', 'snapshots']) || input.schemaVersion !== 1 || !Array.isArray(input.snapshots) || input.snapshots.length > PACKAGE_LIMITS.archiveSnapshots) return failPackage('历史索引字段、版本或数量无效。')
  const current = readReferences(input.current, rootPaths, false)
  const snapshots = input.snapshots.map((item, index) => {
    const refs = readReferences(item, snapshotPaths(index), true)
    return { ...refs, summary: (item as Record<string, unknown>).summary as SnapshotSummary }
  })
  return { schemaVersion: 1, current, snapshots }
}

/** Full validators capture all caller JSON and byte-port closures before awaiting. */
async function pack(input: HistoryArchive, mode: ProjectManifest['packageMode'], options: CompleteValidationOptions): Promise<Uint8Array> {
  const archive = mode === 'history' ? await validateHistoryArchive(input, options) : { current: await validateProjectBundle(input.current, options), snapshots: [] }
  checkCancelled(options.signal)
  const files: Record<string, Uint8Array> = Object.create(null), entries: ManifestEntry[] = [], jsonBudget = { values: 0 }
  let expanded = 0, documentBytes = 0
  const add = (path: string, role: PackageRole, bytes: Uint8Array, mimeType: string): void => {
    checkCancelled(options.signal)
    if (Object.hasOwn(files, path) || !bytes.length || bytes.length > zipPathBudget(path)) return failPackage('重复路径或单文件预算超限。')
    if ((expanded += bytes.length) > PACKAGE_LIMITS.expandedBytes) return failPackage('总展开预算超过300MiB。')
    if (Object.values(rootPaths).includes(path) || path.startsWith('snapshots/')) {
      if ((documentBytes += bytes.length) > PACKAGE_LIMITS.archiveDocumentBytes) return failPackage('历史文档累计超过128MiB。')
    }
    if (path.endsWith('.json')) parseBoundedJson(bytes, jsonBudget)
    files[path] = bytes
    entries.push({ path, role, sha256: sha256Bytes(bytes), sizeBytes: bytes.length, mimeType })
  }
  const addJson = (path: string, role: PackageRole, value: unknown) => add(path, role, encodeUtf8(canonicalJson(value)), 'application/json')
  const addParts = (bundle: ProjectBundle, paths: typeof rootPaths, historical: boolean) => {
    const project = bundle.project, prefix = historical ? 'snapshot-' : ''
    addJson(paths.scenePath, `${prefix}scene` as PackageRole, project.document)
    addJson(paths.identityPath, `${prefix}identity` as PackageRole, project.historyIdentity)
    addJson(paths.appearancePath, `${prefix}appearance` as PackageRole, project.appearance)
    addJson(paths.sourcesPath, `${prefix}sources` as PackageRole, project.authoringSources)
  }
  addParts(archive.current, rootPaths, false)
  const index: HistoryIndex = { schemaVersion: 1, current: references(archive.current.project), snapshots: [] }
  for (const [i, snapshot] of archive.snapshots.entries()) {
    const paths = snapshotPaths(i), { bundle, ...summary } = snapshot
    addParts(bundle, paths, true)
    index.snapshots.push({ ...references(bundle.project, paths), summary })
  }
  if (mode === 'history') addJson('history.json', 'history', index)
  const assets: Record<string, AssetRecord> = Object.create(null), licenses: Record<string, LicenseTextRecord> = Object.create(null)
  const resourceBundles = new Map<string, ProjectBundle>(), sources = new Map<string, number>()
  for (const bundle of [archive.current, ...archive.snapshots.map(snapshot => snapshot.bundle)]) {
    for (const [hash, record] of Object.entries(bundle.project.assets)) {
      if (Object.hasOwn(assets, hash) && !same(assets[hash], record)) return failPackage('同hash图片描述冲突。')
      assets[hash] = record; resourceBundles.set(hash, bundle)
    }
    for (const [hash, record] of Object.entries(bundle.project.licenses)) {
      if (Object.hasOwn(licenses, hash) && !same(licenses[hash], record)) return failPackage('同hash许可文本冲突。')
      licenses[hash] = record
    }
    for (const [hash, size] of projectSourceRecords(bundle.project)) {
      if (sources.has(hash) && sources.get(hash) !== size) return failPackage('同hash SVG源字节声明冲突。')
      sources.set(hash, size); resourceBundles.set(hash, bundle)
    }
  }
  readAssetRecords(assets)
  for (const hash of sorted(Object.keys(assets))) {
    const record = assets[hash], bytes = await resourceBundles.get(hash)!.resources.read(hash)
    checkCancelled(options.signal)
    if (bytes.length !== record.sizeBytes || sha256Bytes(bytes) !== hash) return failPackage('导出资源读取与已验证固定字节不一致。')
    add(`assets/${hash}.${suffix[record.mimeType]}`, 'asset', bytes, record.mimeType)
  }
  for (const hash of sorted(Object.keys(licenses))) add(`licenses/${hash}.txt`, 'license', encodeUtf8(licenses[hash].text), 'text/plain')
  let totalSources = 0
  for (const hash of sorted([...sources.keys()])) {
    const size = sources.get(hash)!, bytes = await resourceBundles.get(hash)!.resources.read(hash)
    checkCancelled(options.signal)
    if ((totalSources += bytes.length) > PACKAGE_LIMITS.totalSourceBytes || bytes.length !== size || sha256Bytes(bytes) !== hash) return failPackage('导出SVG源读取与已验证字节不一致或累计超限。')
    add(`sources/${hash}.svg`, 'source', bytes, 'image/svg+xml')
  }
  const manifest: ProjectManifest = { format: 'sceneweave-complete-project', schemaVersion: archive.current.project.schemaVersion, application: 'Sceneweave', applicationVersion: 'development', packageMode: mode,
    sceneId: archive.current.project.document.sceneId, revision: archive.current.project.document.revision, entries, assetRecords: assets, licenseBindings: archive.current.project.licenseBindings }
  const manifestBytes = encodeUtf8(canonicalJson(manifest))
  if (manifestBytes.length > PACKAGE_LIMITS.manifestBytes || entries.length + 1 > PACKAGE_LIMITS.entries || expanded + manifestBytes.length > PACKAGE_LIMITS.expandedBytes) return failPackage('manifest、条目或展开累计预算超限。')
  parseBoundedJson(manifestBytes, jsonBudget); files['manifest.json'] = manifestBytes
  // Fixed time makes equal inputs reproducible; no platform paths or metadata are added.
  const zipped = zipSync(files, { level: 6, mtime: new Date(2000, 0, 1, 0, 0, 0) })
  if (zipped.length > PACKAGE_LIMITS.compressedBytes) return failPackage('压缩工程超过100MiB。')
  checkCancelled(options.signal)
  return zipped
}
export async function exportProject(bundle: ProjectBundle, options: CompleteValidationOptions): Promise<Uint8Array> { return pack({ current: bundle, snapshots: [] }, 'complete', options) }
export async function exportHistoryArchive(archive: HistoryArchive, options: CompleteValidationOptions): Promise<Uint8Array> { return pack(archive, 'history', options) }

async function unpack(input: Uint8Array, mode: ProjectManifest['packageMode'], options: CompleteValidationOptions): Promise<HistoryArchive> {
  // inspectZip makes the independent byte capture before this function's first await.
  const zip = inspectZip(input, options.signal), jsonBudget = { values: 0 }
  const manifest = readManifest(parseBoundedJson(await zip.read('manifest.json'), jsonBudget))
  if (manifest.packageMode !== mode) return failPackage(`请使用${mode === 'complete' ? '完整工程' : '历史归档'}入口，不能静默丢弃或补造历史。`)
  const declared = new Set(['manifest.json', ...manifest.entries.map(entry => entry.path)])
  if (declared.size !== zip.entries.size || [...declared].some(path => !zip.entries.has(path))) return failPackage('ZIP存在未声明或缺失路径。')
  const bytes = new Map<string, Uint8Array>(), resourceBytes = new Map<string, Uint8Array>(), licenses: Record<string, LicenseTextRecord> = Object.create(null)
  const assetPaths = new Set<string>(), sourcePaths = new Map<string, number>()
  let totalSourceBytes = 0
  for (const entry of manifest.entries) {
    checkCancelled(options.signal)
    if (zip.entries.get(entry.path)!.expanded !== entry.sizeBytes) return failPackage('manifest与ZIP声明长度不一致。')
    const value = await zip.read(entry.path)
    if (value.length !== entry.sizeBytes || sha256Bytes(value) !== entry.sha256) return failPackage(`${entry.path}的长度或SHA-256不一致。`)
    bytes.set(entry.path, value)
    if (entry.role === 'asset') {
      if (assetPaths.has(entry.sha256)) return failPackage('同hash图片存在多个条目。')
      const record = manifest.assetRecords[entry.sha256]
      if (!record || record.sizeBytes !== value.length || record.mimeType !== entry.mimeType) return failPackage('图片文件和manifest描述不匹配。')
      assetPaths.add(entry.sha256); resourceBytes.set(entry.sha256, value)
    } else if (entry.role === 'license') {
      if (Object.hasOwn(licenses, entry.sha256)) return failPackage('同hash许可存在多个条目。')
      licenses[entry.sha256] = { sha256: entry.sha256, text: decodeUtf8(value) }
    } else if (entry.role === 'source') {
      if (sourcePaths.has(entry.sha256) || resourceBytes.has(entry.sha256)) return failPackage('SVG源资源hash重复或与图片冲突。')
      if ((totalSourceBytes += value.length) > PACKAGE_LIMITS.totalSourceBytes) return failPackage('SVG源累计超过32MiB。')
      sourcePaths.set(entry.sha256, value.length); resourceBytes.set(entry.sha256, value)
    }
  }
  if ([...sourcePaths.keys()].some(hash => assetPaths.has(hash))) return failPackage('SVG源资源hash与图片冲突。')
  if (assetPaths.size !== Object.keys(manifest.assetRecords).length) return failPackage('图片描述必须恰好覆盖实际图片文件。')
  // One independent immutable union closure is shared; rebuilding each snapshot must
  // not duplicate every archived image before its own full validation.
  const resources = createMemoryResources(resourceBytes)
  const consumed = new Set<string>(), usedAssets = new Set<string>(), usedLicenses = new Set<string>(), usedSources = new Set<string>()
  const json = (path: string): unknown => {
    if (consumed.has(path)) return failPackage('历史JSON路径被重复引用。')
    const value = bytes.get(path)
    if (!value) return failPackage(`缺少${path}。`)
    consumed.add(path)
    return parseBoundedJson(value, jsonBudget)
  }
  const bundle = (refs: ProjectReferences): ProjectBundle => {
    const assets: ProjectData['assets'] = Object.create(null), selectedLicenses: ProjectData['licenses'] = Object.create(null)
    for (const hash of refs.assetHashes) {
      if (!Object.hasOwn(manifest.assetRecords, hash)) return failPackage('历史引用缺少图片描述。')
      assets[hash] = manifest.assetRecords[hash]; usedAssets.add(hash)
    }
    for (const hash of refs.licenseHashes) {
      if (!Object.hasOwn(licenses, hash)) return failPackage('历史引用缺少许可正文。')
      selectedLicenses[hash] = licenses[hash]; usedLicenses.add(hash)
    }
    const document = json(refs.scenePath) as ProjectData['document']
    const project = validateProjectData({ format: 'sceneweave-complete-project', schemaVersion: document?.schemaVersion, document,
      historyIdentity: json(refs.identityPath) as ProjectData['historyIdentity'], appearance: json(refs.appearancePath) as ProjectData['appearance'], authoringSources: json(refs.sourcesPath) as ProjectData['authoringSources'],
      assets, licenses: selectedLicenses, licenseBindings: refs.licenseBindings })
    const expectedSources = projectSourceRecords(project)
    if (!same(refs.sourceHashes, sorted([...expectedSources.keys()]))) return failPackage('SVG源引用必须恰好覆盖来源记录。')
    for (const [hash, size] of expectedSources) {
      if (sourcePaths.get(hash) !== size) return failPackage('SVG源文件缺失或长度与来源记录不匹配。')
      usedSources.add(hash)
    }
    return { project, resources }
  }
  let current: ProjectBundle, snapshots: SnapshotBundle[] = []
  if (mode === 'history') {
    const index = readHistoryIndex(json('history.json'))
    if (!same(index.current.licenseBindings, manifest.licenseBindings)) return failPackage('当前许可绑定与历史索引不一致。')
    current = bundle(index.current)
    snapshots = index.snapshots.map(entry => ({ ...entry.summary, bundle: bundle(entry) }))
  } else current = bundle({ ...rootPaths, assetHashes: sorted(Object.keys(manifest.assetRecords)), licenseHashes: sorted(Object.keys(licenses)), sourceHashes: sorted([...sourcePaths.keys()]), licenseBindings: manifest.licenseBindings })
  if (usedAssets.size !== assetPaths.size || usedLicenses.size !== Object.keys(licenses).length || usedSources.size !== sourcePaths.size) return failPackage('归档包含未引用资源或许可。')
  for (const entry of manifest.entries) if (entry.mimeType === 'application/json' && !consumed.has(entry.path)) return failPackage('归档包含未引用历史JSON。')
  if (current.project.schemaVersion !== manifest.schemaVersion || current.project.document?.sceneId !== manifest.sceneId || current.project.document?.revision !== manifest.revision) return failPackage('manifest版本、场景身份与实际文档不一致。')
  checkCancelled(options.signal)
  if (mode === 'history') return validateHistoryArchive({ current, snapshots }, options)
  return { current: await validateProjectBundle(current, options), snapshots: [] }
}
export async function importProject(bytes: Uint8Array, options: CompleteValidationOptions): Promise<ProjectBundle> { return (await unpack(bytes, 'complete', options)).current }
export async function importHistoryArchive(bytes: Uint8Array, options: CompleteValidationOptions): Promise<HistoryArchive> { return unpack(bytes, 'history', options) }
