import { validateScene } from '../../core/schema'
import { validateSceneV2 } from '../../core/v2/schema'
import { validateSceneV3 } from '../../core/v3/schema'
import { migrateSceneV1 } from '../../core/v2/migration'
import { migrateSceneV2 } from '../../core/v3/migration'
import { inspectDependenciesV2 } from '../../core/v2/dependencies'
import { inspectDependenciesV3 } from '../../core/v3/dependencies'
import type { SceneDocumentV2 } from '../../core/v2/types'
import type { SceneDocumentV3 } from '../../core/v3/types'
import { validateHistoryIdentityV4 } from '../../core/v4/identity'
import { validateCompositionContentV5 } from '../../core/v5/schema'
import { validateCompositionContentV6 } from '../../core/v6/schema'
import { validateMigrationSourceV3 } from '../../io/v3/migration'
import { validateMigrationSourceV4 } from '../../io/v4/migration'
import { validateMigrationSourceV5 } from '../../io/v5/migration'
import { validateMigrationSourceV6 } from '../../io/v6/migration'
import { readProjectV1 } from '../../io/project-file'
import type { AssetBlobRecord } from '../../io/v2/types'
import type { MigrationSourceV3 } from '../../io/v3/types'
import type { MigrationSourceV4 } from '../../io/v4/types'
import type { MigrationSourceV5 } from '../../io/v5/types'
import type { MigrationSourceV6 } from '../../io/v6/types'
import { CONVERTER_VERSION, type ConvertedFamily, type LegacyBlob, type LegacySource } from '../../shared/migration/types.js'
import type { ProjectBundle, ProjectData, AssetRecord, LicenseBinding, LicenseTextRecord } from '../../shared/model/project.js'
import type { SceneDocument } from '../../shared/model/scene.js'
import type { AppearanceGraph } from '../../shared/model/appearance.js'
import type { HistoryIdentity } from '../../shared/model/history.js'
import type { SnapshotBundle } from '../../shared/project/history.js'
import type { PreparationContext } from '../../shared/ports/runtime.js'
import type { CompleteValidationOptions } from '../../shared/ports/resources.js'
import { checkCancelled } from '../../shared/ports/resources.js'
import { createAppearanceGraph } from '../../shared/appearance/graph.js'
import { createHistoryIdentity, outdoorIdentityDescriptors, mergeIdentityRecords, validateHistoryIdentity } from '../../shared/history/identity.js'
import { createMemoryResources, validateProjectBundles } from '../../shared/project/resources.js'
import { inspectImageBytes } from '../../shared/project/image-bytes.js'
import { assertFixedProjectCompatible, validateSnapshotSummary } from '../../shared/project/history.js'
import { validateProjectData, projectContentHash, assetRecordSchema } from '../../shared/project/validate.js'
import { canonicalJson, cloneJson, captureJson, encodeUtf8 } from '../../shared/validation/json.js'
import { sha256Text } from '../../shared/validation/hash.js'
import { sha256Bytes } from '../../shared/project/binary.js'
import { legacyCaptureContents, legacySnapshotKey, type LegacyCapture, type CapturedRow, type LegacyRepository } from './capture.js'
import { deriveLegacyFileFamily, legacyFileCaptureBytes, legacyFileSnapshotSourceKey } from './file.js'

export interface LegacyPreparation { sceneId: string; createdAt: string; snapshotIds: Record<string, string>; context: PreparationContext }
type OldDocument = SceneDocumentV2 | SceneDocumentV3
interface LegacyProject {
  document: OldDocument; historyIdentity?: Record<string, unknown>; appearance?: AppearanceGraph
  assets: Record<string, AssetBlobRecord>; licenses: Record<string, LicenseTextRecord>; licenseBindings: LicenseBinding[]
}
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value))
function exact(value: unknown, keys: string[]): asserts value is Record<string, unknown> {
  if (!object(value) || Object.keys(value).sort().join('\0') !== [...keys].sort().join('\0')) throw new Error('旧存档字段缺失或包含未知字段；已保全，转换拒绝。')
}
function integer(value: unknown): value is number { return Number.isSafeInteger(value) && Number(value) >= 0 }
function hash(value: unknown): value is string { return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) }
const legacyCanonical = (value: unknown): string => JSON.stringify(value, (_key, item: unknown) => item !== null && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item)
function contentHash(project: LegacyProject, repository: LegacyRepository): string {
  const assets = Object.fromEntries(Object.entries(project.assets).map(([key, { blob: _blob, ...record }]) => [key, record]))
  return sha256Text(legacyCanonical({ document: project.document,
    ...(Number(repository.slice(1)) >= 4 ? { historyIdentity: project.historyIdentity } : {}),
    ...(Number(repository.slice(1)) >= 5 ? { appearance: project.appearance } : {}), assets, licenses: project.licenses, licenseBindings: project.licenseBindings }))
}
function assertFamilyBudget(projects: LegacyProject[]): void {
  const images = new Map<string, AssetBlobRecord>(), licenses = new Map<string, LicenseTextRecord>()
  let documentBytes = 0
  for (const project of projects) {
    for (const value of [project.document, project.historyIdentity ?? {}, project.appearance ?? {}, {}]) documentBytes += encodeUtf8(canonicalJson(value)).length
    for (const [hash, record] of Object.entries(project.assets)) {
      const previous = images.get(hash), { blob: _blob, ...metadata } = record
      if (previous) { const { blob: _previousBlob, ...priorMetadata } = previous; if (canonicalJson(priorMetadata) !== canonicalJson(metadata)) throw new Error('旧家族同hash图片描述冲突。') }
      images.set(hash, record)
    }
    for (const [hash, record] of Object.entries(project.licenses)) {
      if (licenses.has(hash) && licenses.get(hash)!.text !== record.text) throw new Error('旧家族同hash许可正文冲突。')
      licenses.set(hash, record)
    }
  }
  if (documentBytes > 128 * 1024 * 1024 || images.size > 256 || [...images.values()].reduce((sum, record) => sum + record.pixelWidth * record.pixelHeight, 0) > 64_000_000
    || [...images.values()].reduce((sum, record) => sum + record.sizeBytes, 0) + [...licenses.values()].reduce((sum, record) => sum + encodeUtf8(record.text).length, 0) > 256 * 1024 * 1024) throw new Error('旧家族联合文档、图片像素或资源预算超限；保全后不裁剪转换。')
}
function validateStoredRow(row: CapturedRow, repository: LegacyRepository, ownerSceneId: string): void {
  const value = row.value, named = row.store === 'namedSnapshots' || row.store === 'protectionSnapshots', version = Number(repository.slice(1))
  const base = ['document', ...(version >= 2 ? ['documentSchemaVersion'] : []), ...(version >= 3 ? ['migrationSourceHash'] : []),
    ...(version >= 4 ? ['historyIdentity', 'contentHash'] : []), ...(version >= 5 ? ['appearance'] : [])]
  exact(value, named ? [...base, 'id', 'sceneId', 'lineageId', 'sourceRevision', 'name', 'kind', 'createdAt'] : [...base, 'sceneId', 'revision', 'savedAt'])
  if (value.sceneId !== ownerSceneId || !object(value.document)) throw new Error('旧记录归属或场景内容无效。')
  const document = value.document
  if (version >= 2 && value.documentSchemaVersion !== (version === 2 ? 2 : 3)) throw new Error('旧记录文档版本错误。')
  if (version >= 3 && value.migrationSourceHash !== null && !hash(value.migrationSourceHash)) throw new Error('旧记录原件绑定损坏。')
  if (version >= 4 && !hash(value.contentHash)) throw new Error('旧记录内容hash损坏。')
  if (named) {
    if (value.sourceRevision !== document.revision || value.kind !== (row.store === 'namedSnapshots' ? 'named' : 'protection') || !object(value.historyIdentity)
      || value.lineageId !== value.historyIdentity.lineageId || typeof value.id !== 'string' || !value.id || value.id.length > 256 || value.id === '__proto__'
      || typeof value.name !== 'string' || !value.name.trim() || Array.from(value.name).length > 80 || typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt))) throw new Error('旧命名或保护快照摘要无效。')
  } else if (!integer(value.revision) || value.revision !== document.revision || document.sceneId !== ownerSceneId || !integer(value.savedAt)) throw new Error('旧当前或自动历史身份、时间或修订不匹配。')
}
function validateOldContent(project: LegacyProject, repository: LegacyRepository): void {
  const checked = repository === 'v2' ? validateSceneV2(project.document) : validateSceneV3(project.document)
  if (!checked.ok) throw new Error(`旧场景校验失败：${checked.errors.map(issue => issue.message).join('；')}`)
  if (repository === 'v4') validateHistoryIdentityV4(project.historyIdentity, project.document as SceneDocumentV3)
  if (repository === 'v5') validateCompositionContentV5({ document: project.document as SceneDocumentV3, historyIdentity: project.historyIdentity as never, appearance: project.appearance! })
  if (repository === 'v6') validateCompositionContentV6({ document: project.document as SceneDocumentV3, historyIdentity: project.historyIdentity as never, appearance: project.appearance! })
}
function assemble(row: CapturedRow, rows: CapturedRow[], repository: LegacyRepository, ownerSceneId: string): LegacyProject {
  validateStoredRow(row, repository, ownerSceneId)
  const named = row.store === 'namedSnapshots' || row.store === 'protectionSnapshots'
  const binding = rows.find(candidate => candidate.store === (named ? 'namedResourceBindings' : 'resourceBindings')
    && (named ? candidate.value.snapshotId === row.value.id : candidate.value.revision === row.value.revision))?.value
  exact(binding, ['sceneId', named ? 'snapshotId' : 'revision', 'assetHashes', 'licenseHashes', 'licenseBindings'])
  if (binding.sceneId !== ownerSceneId || !Array.isArray(binding.assetHashes) || !Array.isArray(binding.licenseHashes) || !Array.isArray(binding.licenseBindings)
    || binding.assetHashes.length > 256 || binding.licenseHashes.length > 3000 || binding.licenseBindings.length > 10_000
    || [...binding.assetHashes, ...binding.licenseHashes].some(value => !hash(value)) || new Set(binding.assetHashes).size !== binding.assetHashes.length || new Set(binding.licenseHashes).size !== binding.licenseHashes.length) throw new Error('旧资源绑定缺失或损坏。')
  const assets: Record<string, AssetBlobRecord> = {}, licenses: Record<string, LicenseTextRecord> = {}
  for (const hash of binding.assetHashes) {
    const record = rows.find(row => row.store === 'assetBlobs' && row.key === hash)?.value
    exact(record, ['sha256', 'blob', 'mimeType', 'sizeBytes', 'pixelWidth', 'pixelHeight'])
    if (!(record.blob instanceof Blob) || record.sha256 !== hash || record.blob.size !== record.sizeBytes) throw new Error('旧图片实际字节缺失或元数据损坏。')
    const { blob, ...metadata } = record
    assetRecordSchema.parse(metadata); assets[hash] = { ...metadata, blob } as AssetBlobRecord
  }
  for (const hash of binding.licenseHashes) {
    const record = rows.find(row => row.store === 'licenseTexts' && row.key === hash)?.value
    exact(record, ['sha256', 'text'])
    if (record.sha256 !== hash || typeof record.text !== 'string' || !record.text || sha256Text(record.text) !== hash || encodeUtf8(record.text).length > 256 * 1024
      || /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(record.text)
      || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(record.text)
      || /(?:\/(?:Users|home|private|var)\/|[A-Za-z]:\\(?:Users|Documents and Settings)\\)/.test(record.text)
      || /(?:sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,})/.test(record.text)) throw new Error('旧许可正文缺失、来源信息无效或hash错误。')
    licenses[hash] = { sha256: hash, text: record.text }
  }
  const project: LegacyProject = { document: captureJson(row.value.document) as OldDocument, assets, licenses, licenseBindings: captureJson(binding.licenseBindings) as LicenseBinding[],
    ...(repository >= 'v4' ? { historyIdentity: captureJson(row.value.historyIdentity) as Record<string, unknown> } : {}),
    ...(repository >= 'v5' ? { appearance: captureJson(row.value.appearance) as AppearanceGraph } : {}) }
  validateOldContent(project, repository)
  if (repository >= 'v4' && contentHash(project, repository) !== row.value.contentHash) throw new Error('旧存档完整内容hash不匹配，不能只凭修订号转换。')
  const dependencies = repository === 'v2' ? inspectDependenciesV2(project.document as SceneDocumentV2) : inspectDependenciesV3(project.document as SceneDocumentV3)
  if (dependencies.errors.length) throw new Error('旧固定内容存在缺失依赖。')
  const expectedAssets = new Set(dependencies.assetIds.map(id => project.document.assets[id].sha256))
  if (expectedAssets.size !== Object.keys(assets).length || Object.keys(assets).some(key => !expectedAssets.has(key))) throw new Error('旧资源绑定没有精确覆盖依赖。')
  const subjects = new Map(dependencies.subjects.map(subject => [canonicalJson([subject.subjectKind, subject.subjectId]), subject])), bound = new Set<string>(), usedLicenses = new Set<string>(), licenseRefs = new Map<string, string>()
  const collections = { asset: project.document.assets, material: project.document.materials, propDefinition: project.document.propDefinitions, prefabDefinition: project.document.prefabDefinitions, styleTheme: project.document.styleThemes }
  for (const item of project.licenseBindings) {
    exact(item, ['subjectKind', 'subjectId', 'licenseRef', 'licensePath', 'embedding'])
    const key = canonicalJson([item.subjectKind, item.subjectId]), expected = subjects.get(key)
    if (!expected || bound.has(key) || item.licenseRef !== expected.licenseRef || item.embedding !== 'allowed' || !/^licenses\/[a-f0-9]{64}\.txt$/.test(item.licensePath)
      || !collections[item.subjectKind]?.[item.subjectId]?.origin.canEmbed) throw new Error('旧许可主体绑定无效。')
    const textHash = item.licensePath.slice(9, -4)
    if (!licenses[textHash] || licenseRefs.has(item.licenseRef) && licenseRefs.get(item.licenseRef) !== textHash) throw new Error('旧许可引用或正文不一致。')
    licenseRefs.set(item.licenseRef, textHash); bound.add(key); usedLicenses.add(textHash)
  }
  if (subjects.size !== bound.size || usedLicenses.size !== Object.keys(licenses).length) throw new Error('旧许可绑定不完整或有未引用内容。')
  return project
}
async function readImageBytes(project: LegacyProject, options: CompleteValidationOptions): Promise<Map<string, Uint8Array>> {
  const bytes = new Map<string, Uint8Array>(); let pixels = 0
  for (const [hash, record] of Object.entries(project.assets)) {
    checkCancelled(options.signal)
    if ((pixels += record.pixelWidth * record.pixelHeight) > 64_000_000) throw new Error('旧工程累计图片像素超过保护值。')
    const value = new Uint8Array(await Blob.prototype.arrayBuffer.call(record.blob)), header = inspectImageBytes(value)
    if (sha256Bytes(value) !== hash || value.length !== record.sizeBytes || header.mimeType !== record.mimeType || header.width !== record.pixelWidth || header.height !== record.pixelHeight) throw new Error('旧图片实际hash、格式或尺寸与记录不匹配。')
    const raster = await options.images.decode(value.slice(), { sha256: hash, mimeType: record.mimeType, sizeBytes: record.sizeBytes, pixelWidth: record.pixelWidth, pixelHeight: record.pixelHeight }, { signal: options.signal })
    if (raster.width !== record.pixelWidth || raster.height !== record.pixelHeight || !(raster.rgba instanceof Uint8ClampedArray) || raster.rgba.length !== raster.width * raster.height * 4) throw new Error('旧图片未完成实际解码。')
    bytes.set(hash, value)
  }
  for (const variant of Object.values(project.appearance?.variants ?? {})) {
    const source = project.document.assets[variant.sourceAssetId], output = project.document.assets[variant.outputAssetId]
    const sourceRecord = project.assets[source.sha256], outputRecord = project.assets[output.sha256]
    if (outputRecord.mimeType !== 'image/png' || sourceRecord.pixelWidth !== outputRecord.pixelWidth || sourceRecord.pixelHeight !== outputRecord.pixelHeight) throw new Error('旧派生图片尺寸或格式错误。')
    const before = await options.images.decode(bytes.get(source.sha256)!.slice(), sourceRecord, { signal: options.signal }), expected = await options.images.transform(before, { tint: variant.tint, brightness: variant.brightness }, { signal: options.signal })
    const after = await options.images.decode(bytes.get(output.sha256)!.slice(), outputRecord, { signal: options.signal })
    if (expected.width !== after.width || expected.height !== after.height || expected.rgba.length !== after.rgba.length || expected.rgba.some((channel, i) => channel !== after.rgba[i])) throw new Error('旧派生图片不符合源与固定参数。')
  }
  checkCancelled(options.signal); return bytes
}
function nativeDocument(project: LegacyProject, repository: LegacyRepository, targetSceneId: string | null): SceneDocument {
  let document: SceneDocumentV3
  if (repository === 'v2') {
    const stageId = targetSceneId ?? `legacy-check-${sha256Text(project.document.sceneId)}`
    document = migrateSceneV2(project.document, { sceneId: stageId, now: project.document.createdAt })
    if (targetSceneId === null) Object.assign(document, { sceneId: project.document.sceneId, revision: project.document.revision })
    document.updatedAt = project.document.updatedAt
  } else document = cloneJson(project.document) as SceneDocumentV3
  return { ...document, format: 'sceneweave-scene', schemaVersion: 1, ...(targetSceneId !== null ? { sceneId: targetSceneId, revision: 0 } : {}) }
}
function nativeProject(project: LegacyProject, repository: LegacyRepository, targetSceneId: string | null, context: PreparationContext, bytes: Map<string, Uint8Array>): ProjectBundle {
  const document = nativeDocument(project, repository, targetSceneId)
  let identity: HistoryIdentity
  if (repository === 'v6') identity = { ...cloneJson(project.historyIdentity), version: 1 } as unknown as HistoryIdentity
  else if (repository === 'v4' || repository === 'v5') {
    const previous = cloneJson(project.historyIdentity!)
    identity = { ...previous, version: 1, prefabTokens: repository === 'v5' ? previous.prefabTokens : Object.fromEntries(Object.keys(document.prefabInstances).map(key => [key, context.ids.nextId()])),
      outdoorTokens: Object.fromEntries(Object.entries(outdoorIdentityDescriptors(document)).map(([key, descriptor]) => [key, { ...descriptor, token: context.ids.nextId(), topologyToken: context.ids.nextId() }])) } as HistoryIdentity
  } else identity = createHistoryIdentity(document, context)
  const assets = Object.fromEntries(Object.entries(project.assets).map(([key, { blob: _blob, ...record }]) => [key, record])) as Record<string, AssetRecord>
  const data: ProjectData = { format: 'sceneweave-complete-project', schemaVersion: 1, document, historyIdentity: identity,
    appearance: cloneJson(project.appearance ?? createAppearanceGraph(document)), assets, licenses: cloneJson(project.licenses), licenseBindings: cloneJson(project.licenseBindings), authoringSources: {} }
  return { project: validateProjectData(data), resources: createMemoryResources(bytes) }
}

interface SourceNode { sourceSchemaVersion: number; sourceSceneId: string; sourceRevision: number; sourceHash: string; migratorVersion: string; migratedAt: string; original: Blob; previousSource?: SourceNode }
async function legacySources(rows: CapturedRow[], repository: LegacyRepository, ownerSceneId: string, sourceSceneId: string, options: CompleteValidationOptions): Promise<{ legacySources: LegacySource[]; legacyBlobs: LegacyBlob[] }> {
  const record = rows.find(row => row.store === 'migrationSources')?.value
  if (!record) return { legacySources: [], legacyBlobs: [] }
  const { sceneId, ...input } = record
  if (sceneId !== sourceSceneId) throw new Error('旧原件来源行归属错误。')
  const source = input as unknown as SourceNode
  if (repository === 'v3') await validateMigrationSourceV3(input as unknown as MigrationSourceV3, sourceSceneId)
  else if (repository === 'v4') await validateMigrationSourceV4(input as unknown as MigrationSourceV4, sourceSceneId)
  else if (repository === 'v5') await validateMigrationSourceV5(input as unknown as MigrationSourceV5, sourceSceneId)
  else if (repository === 'v6') await validateMigrationSourceV6(input as unknown as MigrationSourceV6, sourceSceneId)
  else if (repository === 'v2') {
    exact(source, ['sourceSchemaVersion', 'sourceSceneId', 'sourceRevision', 'sourceHash', 'migratorVersion', 'migratedAt', 'original'])
    if (source.sourceSchemaVersion !== 1 || !(source.original instanceof Blob) || source.original.size > 10 * 1024 * 1024 || !source.original.size || source.sourceSceneId === sourceSceneId) throw new Error('旧M0原件记录无效。')
    const bytes = new Uint8Array(await source.original.arrayBuffer()), original = bytes[0] === 0x50 && bytes[1] === 0x4b ? await readProjectV1(source.original) : JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    const checked = validateScene(original)
    if (!checked.ok || checked.document.sceneId !== source.sourceSceneId || checked.document.revision !== source.sourceRevision) throw new Error('旧M0原件身份或修订不匹配。')
  }
  const list: { value: SourceNode; bytes: Uint8Array; id: string }[] = [], seen = new Set<object>()
  let next: SourceNode | undefined = source
  while (next) {
    checkCancelled(options.signal)
    if (seen.has(next) || list.length >= 5) throw new Error('旧原件来源链循环或过长。')
    seen.add(next)
    if (!(next.original instanceof Blob) || !next.original.size || next.original.size > 100 * 1024 * 1024 || !integer(next.sourceRevision) || typeof next.migratorVersion !== 'string' || !next.migratorVersion || typeof next.migratedAt !== 'string' || !Number.isFinite(Date.parse(next.migratedAt))) throw new Error('旧原件来源节点无效。')
    const bytes = new Uint8Array(await next.original.arrayBuffer())
    if (sha256Bytes(bytes) !== next.sourceHash) throw new Error('旧原件字节hash不匹配。')
    const metadata = { sourceSchemaVersion: next.sourceSchemaVersion, sourceSceneId: next.sourceSceneId, sourceRevision: next.sourceRevision, sourceHash: next.sourceHash, migratorVersion: next.migratorVersion, migratedAt: next.migratedAt }
    list.push({ value: next, bytes, id: `legacy-${sha256Text(canonicalJson(metadata))}` }); next = next.previousSource
  }
  return { legacySources: list.map((node, index) => ({ ownerSceneId, nodeId: node.id, previousNodeId: list[index + 1]?.id ?? null,
    sourceSchemaVersion: node.value.sourceSchemaVersion as LegacySource['sourceSchemaVersion'], sourceSceneId: node.value.sourceSceneId, sourceRevision: node.value.sourceRevision,
    sourceHash: node.value.sourceHash, migratorVersion: node.value.migratorVersion, migratedAt: node.value.migratedAt })), legacyBlobs: list.map(node => ({ sha256: node.value.sourceHash, bytes: node.bytes })) }
}

function capturePreparation(input: LegacyPreparation): LegacyPreparation {
  if (!object(input) || Reflect.ownKeys(input).length !== 4) throw new Error('转换准备必须包含四个明确字段。')
  const descriptors = Object.getOwnPropertyDescriptors(input), fields = ['sceneId', 'createdAt', 'snapshotIds', 'context']
  if (!fields.every(key => descriptors[key]?.enumerable && 'value' in descriptors[key])) throw new Error('转换准备不接受访问器、隐藏或Symbol字段。')
  const metadata = captureJson({ sceneId: descriptors.sceneId!.value!, createdAt: descriptors.createdAt!.value!, snapshotIds: descriptors.snapshotIds!.value! })
  const runtime = descriptors.context.value as PreparationContext
  return { ...metadata, context: { ids: { nextId: runtime.ids.nextId.bind(runtime.ids) }, clock: { now: runtime.clock.now.bind(runtime.clock) } } }
}
/** Prepares an independent current copy. Only proven v6 history is exposed for recovery. */
export async function prepareLegacyFamily(capture: LegacyCapture, input: LegacyPreparation, options: CompleteValidationOptions): Promise<ConvertedFamily> {
  checkCancelled(options.signal)
  const preparation = capturePreparation(input), file = legacyFileCaptureBytes(capture)
  if (file) {
    const derived = await deriveLegacyFileFamily(file, options.signal), mapped: Record<string, string> = {}
    if (canonicalJson(derived.sourceContentHashes) !== canonicalJson(capture.sourceContentHashes)) throw new Error('旧文件实际语义与捕获映射不匹配。')
    for (const key of derived.capture.snapshotKeys) {
      const source = JSON.parse(key) as { kind: 'named' | 'protection'; id: string }
      const fileKey = legacyFileSnapshotSourceKey(derived.repository, derived.sourceSceneId, source.kind, source.id)
      if (preparation.snapshotIds[fileKey]) mapped[key] = preparation.snapshotIds[fileKey]
    }
    const result = await prepareLegacyFamily(derived.capture, { ...preparation, snapshotIds: mapped }, options)
    const usedAsPrevious = new Set(result.legacySources.map(source => source.previousNodeId)), head = result.legacySources.find(source => !usedAsPrevious.has(source.nodeId))?.nodeId ?? null
    const sourceHash = sha256Bytes(file), metadata = { sourceSchemaVersion: Number(derived.repository.slice(1)) as LegacySource['sourceSchemaVersion'], sourceSceneId: derived.sourceSceneId,
      sourceRevision: derived.sourceRevision, sourceHash, migratorVersion: CONVERTER_VERSION, migratedAt: preparation.createdAt }
    if (file.length + result.legacyBlobs.reduce((sum, value) => sum + value.bytes.length, 0) > 128 * 1024 * 1024) throw new Error('旧文件及已有原件累计超过128MiB，保全后不裁剪转换。')
    checkCancelled(options.signal)
    return { ...result, legacySources: [{ ownerSceneId: preparation.sceneId, nodeId: `legacy-${sha256Text(canonicalJson(metadata))}`, previousNodeId: head, ...metadata }, ...result.legacySources],
      legacyBlobs: [{ sha256: sourceHash, bytes: file }, ...result.legacyBlobs], sourceContentHashes: { ...derived.sourceContentHashes } }
  }
  const contents = legacyCaptureContents(capture)
  const { sceneId: targetSceneId, createdAt, context } = preparation
  if (typeof targetSceneId !== 'string' || !targetSceneId || targetSceneId.length > 256 || targetSceneId === contents.sceneId || targetSceneId === '__proto__' || typeof createdAt !== 'string' || !Number.isFinite(Date.parse(createdAt))) throw new Error('转换目标必须是固定的新工程ID及有效时间。')
  // Reconstruct privately from captured bytes; callers cannot mutate cursor values after capture.
  const rows = contents.rows
  const currentRow = rows.find(row => row.store === 'scenes')!, historyRows = rows.filter(row => ['snapshots', 'namedSnapshots', 'protectionSnapshots'].includes(row.store))
  if (historyRows.filter(row => row.store === 'snapshots').length > 20 || historyRows.filter(row => row.store === 'namedSnapshots').length > 32 || historyRows.filter(row => row.store === 'protectionSnapshots').length > 32) throw new Error('旧历史数量超过已支持保护预算；已完整保全但不裁剪转换。')
  if (contents.repository >= 'v4') {
    const metadata = rows.find(row => row.store === 'historyMetadata')?.value
    exact(metadata, ['sceneId', 'metadataVersion'])
    if (metadata.sceneId !== contents.sceneId || !integer(metadata.metadataVersion)) throw new Error('旧历史元数据损坏。')
  }
  let current: ProjectBundle, oldCurrent: LegacyProject | undefined
  const snapshots: SnapshotBundle[] = [], importedSnapshots: SnapshotBundle[] = []
  if (contents.repository === 'v1') {
    for (const row of [currentRow, ...historyRows]) {
      exact(row.value, ['sceneId', 'revision', 'document', 'savedAt'])
      const checked = validateScene(row.value.document)
      if (!checked.ok || row.value.sceneId !== contents.sceneId || checked.document.sceneId !== contents.sceneId || row.value.revision !== checked.document.revision || !integer(row.value.savedAt)
        || Object.keys(checked.document.assets).length || Object.values(checked.document.props).some(prop => prop.assetId !== null)) throw new Error('旧M0当前或历史记录不合法。')
    }
    const stageId = `legacy-stage-${sha256Text(targetSceneId)}`, doc2 = migrateSceneV1(currentRow.value.document, { sceneId: stageId, now: createdAt })
    const old = currentRow.value.document as { createdAt: string; updatedAt: string }; Object.assign(doc2, old && { createdAt: old.createdAt, updatedAt: old.updatedAt })
    oldCurrent = { document: doc2, assets: {}, licenses: {}, licenseBindings: [] }; current = nativeProject(oldCurrent, 'v2', targetSceneId, context, new Map())
  } else {
    const assembled = [currentRow, ...historyRows].map(row => assemble(row, rows, contents.repository, contents.sceneId))
    // v1–v5 historical rows are retained by the set rather than installed. A v6
    // family is one joint conversion closure, checked before its first decoder.
    assertFamilyBudget(contents.repository === 'v6' ? assembled : assembled.slice(0, 1))
    oldCurrent = assembled[0]
    const chain = rows.find(row => row.store === 'migrationSources')?.value
    for (const row of [currentRow, ...historyRows]) if (contents.repository >= 'v3' && row.value.migrationSourceHash !== (chain?.sourceHash ?? null)) throw new Error('旧快照原件来源绑定缺失或不一致。')
    const currentBytes = await readImageBytes(oldCurrent, options)
    current = nativeProject(oldCurrent, contents.repository, targetSceneId, context, currentBytes)
    for (let index = 0; index < historyRows.length; index++) {
      checkCancelled(options.signal)
      const row = historyRows[index], project = assembled[index + 1], bytes = await readImageBytes(project, options)
      if (contents.repository !== 'v6') continue
      const kind = row.store === 'snapshots' ? 'automatic' : row.store === 'namedSnapshots' ? 'named' : 'protection', sourceId = String(kind === 'automatic' ? row.value.revision : row.value.id)
      const sourceKey = legacySnapshotKey(contents.repository, contents.sceneId, kind, sourceId), id = preparation.snapshotIds[sourceKey]
      if (!id) throw new Error('预留journal缺少固定历史ID映射。')
      const bundle = nativeProject(project, contents.repository, null, context, bytes)
      const summary = validateSnapshotSummary({ id, ownerSceneId: targetSceneId, lineageId: bundle.project.historyIdentity.lineageId, sourceRevision: bundle.project.document.revision,
        name: kind === 'automatic' ? `自动保存 · r${sourceId}` : row.value.name, kind: kind === 'automatic' ? 'imported-auto' : kind,
        createdAt: kind === 'automatic' ? new Date(Number(row.value.savedAt)).toISOString() : new Date(String(row.value.createdAt)).toISOString(), contentHash: projectContentHash(bundle.project) })
      ;(kind === 'automatic' ? importedSnapshots : snapshots).push({ ...summary, bundle })
    }
  }
  const all = [current, ...snapshots.map(snapshot => snapshot.bundle), ...importedSnapshots.map(snapshot => snapshot.bundle)]
  if (new Set([...snapshots, ...importedSnapshots].map(snapshot => snapshot.id)).size !== snapshots.length + importedSnapshots.length) throw new Error('固定历史ID映射冲突，不能合并或覆盖历史。')
  if (contents.repository === 'v6') {
    current.project.historyIdentity = validateHistoryIdentity(mergeIdentityRecords(current.project.historyIdentity, all.slice(1).map(bundle => bundle.project.historyIdentity)), current.project.document)
    for (let i = 0; i < all.length; i++) for (let j = 0; j < i; j++) assertFixedProjectCompatible(all[j].project, all[i].project)
  }
  const verified = await validateProjectBundles(all, options)
  current = verified[0]
  snapshots.forEach((snapshot, index) => { snapshot.bundle = verified[index + 1] })
  importedSnapshots.forEach((snapshot, index) => { snapshot.bundle = verified[index + snapshots.length + 1] })
  const legacy = await legacySources(rows, contents.repository, targetSceneId, contents.sceneId, options)
  checkCancelled(options.signal)
  return { current, snapshots, importedSnapshots, ...legacy, sourceContentHashes: { ...capture.sourceContentHashes } }
}
