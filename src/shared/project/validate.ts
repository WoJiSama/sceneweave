import { z } from 'zod'
import { nativeSceneSchema } from '../validation/scene.js'
import { nativeHistoryIdentitySchema } from '../history/identity.js'
import { nativeAppearanceGraphSchema, certifyCompositionContent, getCertifiedCompositionContent, getPropUpdateCompositionTransaction, getCompositionRevisionTransaction, getCompositionCommitTransaction, validateCompositionContent } from '../validation/content.js'
import { getCompositionTransactionReceipt, isIssuedCompositionTransactionReceipt, releaseCompositionTransactionReceipt } from '../appearance/commands.js'
import { equalTransactionValue, netTransactionWrites, type TransactionReceipt, type TransactionWrite } from '../transaction/receipt.js'
import type { CompositionRevisionTransaction, PropUpdateCompositionTransaction } from '../validation/content.js'
import { inspectDependencies } from '../commands/dependencies.js'
import { sha256Text } from '../geometry/scatter.js'
import { sha256Bytes } from '../validation/hash.js'
import { canonicalJson, cloneJson, encodeUtf8, freezeJson, inspectJsonInput } from '../validation/json.js'
import type { ProjectData } from '../model/project.js'
import { STATIC_SVG_LIMITS, CANONICAL_SVG_PROCESSOR } from '../ai/svg.js'
import { PACKAGE_LIMITS } from './limits.js'
import { projectSourceRecords } from './source-resources.js'
import { legacyTerrainView } from '../terrain-generation/composition-contracts.js'
import { canonicalProjectCoordinates, decodeProjectCoordinates } from '../aggregates/scene-coordinates.js'

const MiB = 1024 * 1024
export const PROJECT_DATA_LIMITS = Object.freeze({ jsonBytes: 20 * MiB, imageBytes: 20 * MiB, imageSide: 8192, imagePixels: 32_000_000,
  totalImagePixels: 64_000_000, images: 256, licenseBytes: 256 * 1024, bindings: 10_000, expandedBytes: 300 * MiB })
const id = z.string().min(1).max(256).refine(value => value !== '__proto__')
const hash = z.string().regex(/^[a-f0-9]{64}$/)
const positive = z.number().finite().refine(value => Number.isSafeInteger(value) && value > 0)
export const assetRecordSchema = z.object({ sha256: hash, mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
  sizeBytes: positive.max(PROJECT_DATA_LIMITS.imageBytes), pixelWidth: positive.max(PROJECT_DATA_LIMITS.imageSide), pixelHeight: positive.max(PROJECT_DATA_LIMITS.imageSide) }).strict()
export const licenseBindingSchema = z.object({ subjectKind: z.enum(['asset', 'material', 'propDefinition', 'prefabDefinition', 'styleTheme']),
  subjectId: id, licenseRef: id, licensePath: z.string().regex(/^licenses\/[a-f0-9]{64}\.txt$/), embedding: z.literal('allowed') }).strict()
export const nativeLicenseBindingSchema = licenseBindingSchema.extend({subjectKind:z.enum(['asset','material','propDefinition','prefabDefinition','styleTheme','regionalSymbolDefinition'])}).strict()
const svgSourceFields = { kind: z.literal('svg'), sourceSha256: hash, normalizedSha256: hash, sourceSizeBytes: positive.max(MiB),
  normalizedSizeBytes: positive.max(MiB), rasterSha256: hash, processorId: z.literal('sceneweave-static-svg') }
const svgSchema = z.discriminatedUnion('processorVersion', [
  z.object({ ...svgSourceFields, processorVersion: z.literal(1) }).strict(),
  z.object({ ...svgSourceFields, processorVersion: z.literal(2),
    rasterizer: z.object({ id: z.literal(CANONICAL_SVG_PROCESSOR.rasterizer.id), version: z.literal(CANONICAL_SVG_PROCESSOR.rasterizer.version),
      moduleSha256: z.literal(CANONICAL_SVG_PROCESSOR.rasterizer.moduleSha256) }).strict(),
    pixelFormat: z.literal(CANONICAL_SVG_PROCESSOR.pixelFormat) }).strict(),
])
export const projectDataSchema: z.ZodType<ProjectData> = z.object({ format: z.literal('sceneweave-complete-project'), schemaVersion: z.literal(1),
  document: nativeSceneSchema, historyIdentity: nativeHistoryIdentitySchema, appearance: nativeAppearanceGraphSchema,
  assets: z.record(hash, assetRecordSchema), licenses: z.record(hash, z.object({ sha256: hash, text: z.string().min(1) }).strict()),
  licenseBindings: z.array(nativeLicenseBindingSchema).max(PROJECT_DATA_LIMITS.bindings), authoringSources: z.record(id, svgSchema),
}).strict().superRefine((project, ctx) => {
  if(project.historyIdentity.version!==5||project.appearance.version!==2)ctx.addIssue({code:'custom',message:'完整工程、历史身份和外观图版本须匹配。'})
  if (project.schemaVersion !== project.document.schemaVersion) ctx.addIssue({ code: 'custom', path: ['schemaVersion'], message: '完整工程与场景契约版本必须一致。' })
})
// Keep the exported complete schema unchanged. Runtime validation delegates the
// three domain branches to their strict validators, avoiding recursive parsing
// of the scene and identity in both the envelope and the domain boundary.
const projectEnvelopeSchema = z.object({ format: z.literal('sceneweave-complete-project'), schemaVersion: z.literal(1),
  document: z.unknown(), historyIdentity: z.unknown(), appearance: z.unknown(),
  assets: z.record(hash, assetRecordSchema), licenses: z.record(hash, z.object({ sha256: hash, text: z.string().min(1) }).strict()),
  licenseBindings: z.array(nativeLicenseBindingSchema).max(PROJECT_DATA_LIMITS.bindings), authoringSources: z.record(id, svgSchema),
}).strict()

interface ProjectSizeProof { documentBytes: number; expandedBytes: number }
const projectSizes = new WeakMap<ProjectData, ProjectSizeProof>()

export interface ProjectTransactionReceipt {
  readonly baseline: ProjectData
  readonly result: ProjectData
  readonly composition: TransactionReceipt
  readonly changes: readonly TransactionWrite[]
  /** The byte validator remains the owner of the immutable resource closure. */
  readonly resources: 'unchanged-metadata'
}
const projectTransactionReceipts = new WeakMap<ProjectData, ProjectTransactionReceipt>()
const receiptsByContent = new WeakMap<object, WeakMap<object, WeakMap<object, ProjectTransactionReceipt>>>()
const projectContent = (project: ProjectData) => ({ document: project.document, historyIdentity: project.historyIdentity, appearance: project.appearance })
const equalProjectContent = (left: ProjectData, right: TransactionReceipt['baseline']) => left.document === right.document && left.historyIdentity === right.historyIdentity && left.appearance === right.appearance
function registerProjectReceipt(receipt: ProjectTransactionReceipt): ProjectTransactionReceipt {
  projectTransactionReceipts.set(receipt.result, receipt)
  let identities = receiptsByContent.get(receipt.result.document)
  if (!identities) { identities = new WeakMap(); receiptsByContent.set(receipt.result.document, identities) }
  let appearances = identities.get(receipt.result.historyIdentity)
  if (!appearances) { appearances = new WeakMap(); identities.set(receipt.result.historyIdentity, appearances) }
  appearances.set(receipt.result.appearance, receipt)
  return receipt
}
export function getProjectTransactionReceipt(input: unknown): ProjectTransactionReceipt | undefined {
  const receipt = input !== null && typeof input === 'object' ? projectTransactionReceipts.get(input as ProjectData) : undefined
  return receipt && isIssuedCompositionTransactionReceipt(receipt.composition) ? receipt : undefined
}
/** A cancellation must supply its exact invocation handle. Persistence may
 * release the receipt owned by the exact snapshot it has just saved. */
export function releaseProjectTransactionReceipt(input: unknown, expectedComposition?: TransactionReceipt): void {
  if (input === null || typeof input !== 'object') return
  const receipt = projectTransactionReceipts.get(input as ProjectData)
  if (!receipt || expectedComposition && receipt.composition !== expectedComposition) return
  projectTransactionReceipts.delete(receipt.result)
  const entries = receiptsByContent.get(receipt.result.document)?.get(receipt.result.historyIdentity)
  if (entries?.get(receipt.result.appearance) === receipt) {
    entries.delete(receipt.result.appearance)
    releaseCompositionTransactionReceipt(receipt.composition)
  }
}
const unchangedProjectMetadata = (before: ProjectData, after: ProjectData) => Object.keys(before).length === Object.keys(after).length
  && (Object.keys(before) as (keyof ProjectData)[]).every(key => ['document', 'historyIdentity', 'appearance'].includes(key) || equalTransactionValue(before[key], after[key]))
/** Attach actual command evidence only to fully certified metadata endpoints.
 * The remaining metadata must be exactly unchanged; materialization that adds
 * resources falls back instead of accepting caller-declared write paths. */
export function completeProjectTransactionReceipt(baseline: ProjectData, result: ProjectData, composition: TransactionReceipt): ProjectTransactionReceipt | undefined {
  if (!projectSizes.has(baseline) || !projectSizes.has(result) || !isIssuedCompositionTransactionReceipt(composition)
    || equalProjectContent(baseline, result)
    || !equalProjectContent(baseline, composition.baseline) || !equalProjectContent(result, composition.result) || !unchangedProjectMetadata(baseline, result)) return
  return registerProjectReceipt(freezeJson({ baseline, result, composition, changes: composition.changes, resources: 'unchanged-metadata' as const }))
}
function inheritProjectReceipt(result: ProjectData): void {
  const commit = getCompositionCommitTransaction(projectContent(result))
  if (!commit || commit.result.document.revision !== commit.baseline.document.revision + 1) return
  const previous = receiptsByContent.get(commit.baseline.document)?.get(commit.baseline.historyIdentity)?.get(commit.baseline.appearance)
  if (!previous || previous.result.document.revision !== previous.baseline.document.revision || !unchangedProjectMetadata(previous.result, result)) return
  const composition = getCompositionTransactionReceipt(projectContent(result))
  if (!composition || !equalProjectContent(previous.baseline, composition.baseline)) return
  registerProjectReceipt(freezeJson({ baseline: previous.baseline, result, composition,
    changes: netTransactionWrites(previous.baseline, result, composition.changes), resources: 'unchanged-metadata' as const }))
}

/** Exact, privately issued local derivation. These values describe the domain
 * executor's actual writes; callers cannot register paths or substitute proof. */
export interface ProjectLocalTransaction {
  readonly baseline: ProjectData
  readonly result: ProjectData
  readonly stage: 'prop' | 'revision'
  readonly propChanges: PropUpdateCompositionTransaction['changes']
  readonly revisionChanges?: CompositionRevisionTransaction['changes']
}
const projectLocalTransactions = new WeakMap<ProjectData, ProjectLocalTransaction>()
export function getProjectLocalTransaction(input: unknown): ProjectLocalTransaction | undefined {
  return input !== null && typeof input === 'object' ? projectLocalTransactions.get(input as ProjectData) : undefined
}
/** Release this result only; no validation or proof transfers to another object. */
export function releaseProjectLocalTransaction(input: unknown): void {
  if (input !== null && typeof input === 'object') projectLocalTransactions.delete(input as ProjectData)
}

/** Only for strict-parser-owned JSON. Key order cannot change its byte length. */
function ownedJsonByteLength(value: unknown): number {
  const text = JSON.stringify(value)
  let length = 0
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (code < 0x80) length++
    else if (code < 0x800) length += 2
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length
      && text.charCodeAt(i + 1) >= 0xdc00 && text.charCodeAt(i + 1) <= 0xdfff) { length += 4; i++ }
    else length += 3
  }
  return length
}

/** Strict native metadata/closure validation. No byte/hash/decode certificate is issued. */
export function validateProjectData(input: unknown): ProjectData {
  return readProjectData(input, false)
}
function readProjectData(input: unknown, certifyContent: boolean): ProjectData {
  const issue = inspectJsonInput(input)
  if (issue) throw new Error(issue.message)
  const parsed = projectEnvelopeSchema.safeParse(input)
  if (!parsed.success) throw new Error(`完整工程字段无效：${parsed.error.issues.map(item => `${item.path.join('.')}: ${item.message}`).join('；')}`)
  const content = (certifyContent ? certifyCompositionContent : validateCompositionContent)({ document: parsed.data.document, historyIdentity: parsed.data.historyIdentity, appearance: parsed.data.appearance })
  // Public validation must return a detached mutable project even when the
  // caller passes an internally certified immutable project. Only the private
  // certification path may retain the exact frozen triad.
  const publicContent = !certifyContent && getCertifiedCompositionContent(content)
    ? { document: cloneJson(content.document), historyIdentity: cloneJson(content.historyIdentity), appearance: cloneJson(content.appearance) }
    : content
  const project: ProjectData = { ...parsed.data, ...publicContent }
  if (project.schemaVersion !== project.document.schemaVersion) throw new Error('完整工程字段无效：schemaVersion: 完整工程与场景契约版本必须一致。')
  const dependencies = inspectDependencies(project.document)
  if (dependencies.errors.length) throw new Error(dependencies.errors.map(item => item.message).join('；'))
  const hashes = new Set<string>()
  for (const id of dependencies.assetIds) {
    const asset = project.document.assets[id], record = project.assets[asset.sha256]
    if (!record || record.sha256 !== asset.sha256 || record.mimeType !== asset.mimeType || record.pixelWidth !== asset.pixelWidth || record.pixelHeight !== asset.pixelHeight) throw new Error(`图片元数据闭包缺失或不匹配：${id}。`)
    hashes.add(asset.sha256)
  }
  if (Object.keys(project.assets).some(key => !hashes.has(key)) || hashes.size > PROJECT_DATA_LIMITS.images) throw new Error('图片元数据必须恰好覆盖依赖闭包，最多256张。')
  let pixels = 0, expanded = 0
  for (const [key, record] of Object.entries(project.assets)) {
    const count = record.pixelWidth * record.pixelHeight
    if (record.sha256 !== key || count > PROJECT_DATA_LIMITS.imagePixels || (pixels += count) > PROJECT_DATA_LIMITS.totalImagePixels) throw new Error('图片元数据hash或累计像素预算无效。')
    expanded += record.sizeBytes
  }
  if (Object.keys(project.authoringSources).length > PROJECT_DATA_LIMITS.images) throw new Error('SVG来源最多256项。')
  const variantOutputs = new Set(Object.values(project.appearance.variants).map(variant => variant.outputAssetId))
  for (const asset of Object.values(project.document.assets)) if (asset.imageEnhancement
    && (Object.hasOwn(project.authoringSources, asset.id) || variantOutputs.has(asset.id))) throw new Error('画质增强输出不能同时属于SVG栅格或外观颜色派生。')
  for (const asset of Object.values(project.document.assets)) if (asset.imageRefinement) {
    if (variantOutputs.has(asset.id) || (asset.imageRefinement.kind === 'vector') !== Object.hasOwn(project.authoringSources, asset.id)) throw new Error('矢量精修必须保留确切SVG源；模型补画不能冒充SVG或颜色派生。')
  }
  for (const [assetId, source] of Object.entries(project.authoringSources)) {
    const asset = project.document.assets[assetId], raster = asset && project.assets[asset.sha256]
    if (!asset || !raster || asset.mimeType !== 'image/png' || source.rasterSha256 !== asset.sha256
      || raster.pixelWidth > STATIC_SVG_LIMITS.rasterSide || raster.pixelHeight > STATIC_SVG_LIMITS.rasterSide
      || raster.pixelWidth * raster.pixelHeight > STATIC_SVG_LIMITS.rasterPixels) throw new Error('SVG源必须绑定闭包内的有效PNG及受限栅格尺寸。')
  }
  for (const [hash, size] of projectSourceRecords(project)) {
    if (Object.hasOwn(project.assets, hash)) throw new Error('SVG源不能与图片共用资源hash。')
    expanded += size
  }
  const subjectKey = (item: {subjectKind: string; subjectId: string}) => canonicalJson([item.subjectKind, item.subjectId])
  const subjects = new Map(dependencies.subjects.map(item => [subjectKey(item), item]))
  const bound = new Set<string>(), licenses = new Set<string>(), references = new Map<string, string>()
  const collections = { asset: project.document.assets, material: project.document.materials, propDefinition: project.document.propDefinitions,
    prefabDefinition: project.document.prefabDefinitions, styleTheme: project.document.styleThemes, regionalSymbolDefinition:project.document.regional?.symbolDefinitions??{} }
  for (const binding of project.licenseBindings) {
    const key = subjectKey(binding), subject = subjects.get(key), definition = collections[binding.subjectKind][binding.subjectId]
    if (!subject || bound.has(key) || subject.licenseRef !== binding.licenseRef || !definition?.origin.canEmbed) throw new Error('许可绑定悬空、重复、不匹配或禁止嵌入。')
    bound.add(key)
    const hash = binding.licensePath.slice(9, -4)
    if (references.has(binding.licenseRef) && references.get(binding.licenseRef) !== hash) throw new Error('同一licenseRef不能绑定不同许可文本。')
    references.set(binding.licenseRef, hash); licenses.add(hash)
    if (!Object.hasOwn(project.licenses, hash)) throw new Error('许可文本缺失。')
  }
  if (bound.size !== subjects.size || Object.keys(project.licenses).some(key => !licenses.has(key))) throw new Error('许可必须恰好覆盖完整主体闭包。')
  for (const [hash, record] of Object.entries(project.licenses)) {
    const bytes = encodeUtf8(record.text)
    if (record.sha256 !== hash || sha256Bytes(bytes) !== hash || bytes.length > PROJECT_DATA_LIMITS.licenseBytes
      || /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(record.text)
      || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(record.text)
      || /(?:\/(?:Users|home|private|var)\/|[A-Za-z]:\\(?:Users|Documents and Settings)\\)/.test(record.text)
      || /(?:sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,})/.test(record.text)) throw new Error('许可正文hash、编码、预算或来源信息无效。')
    expanded += bytes.length
  }
  let documentBytes = 0
  for (const value of [project.document, project.historyIdentity, project.appearance, project.authoringSources]) {
    const size = ownedJsonByteLength(value)
    if (value === project.document) documentBytes = size
    if (value === project.authoringSources && size > PACKAGE_LIMITS.sourcesBytes) throw new Error('SVG来源JSON超过1MiB。')
    if (size > PROJECT_DATA_LIMITS.jsonBytes) throw new Error('场景、身份或外观JSON超过20MiB。')
    expanded += size
  }
  if (expanded > PROJECT_DATA_LIMITS.expandedBytes) throw new Error('工程声明展开字节超过300MiB。')
  if (certifyContent) projectSizes.set(project, { documentBytes, expandedBytes: expanded })
  return project
}

/** Closed internal derivation only. The full metadata validator owns baseline
 * size/closure proofs; the domain executor owns the exact changed values.
 * Public parsing and cold IO continue to run the complete validator. */
export function tryCertifyLocalProjectData(input: unknown, baseline: ProjectData): ProjectData | undefined {
  const sizes = projectSizes.get(baseline)
  if (!sizes || !input || typeof input !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) return
  const fields = Object.getOwnPropertyDescriptors(input), keys = Object.keys(baseline)
  if (Reflect.ownKeys(input).length !== keys.length || !keys.every(key => fields[key]?.enumerable && 'value' in fields[key])) return
  const candidate = Object.fromEntries(keys.map(key => [key, fields[key].value])) as unknown as ProjectData
  for (const key of keys as (keyof ProjectData)[]) {
    if (!['document', 'historyIdentity', 'appearance'].includes(key) && candidate[key] !== baseline[key]) return
  }
  const before = { document: baseline.document, historyIdentity: baseline.historyIdentity, appearance: baseline.appearance }
  const after = { document: candidate.document, historyIdentity: candidate.historyIdentity, appearance: candidate.appearance }
  if (after.document === before.document && after.historyIdentity === before.historyIdentity && after.appearance === before.appearance) return baseline
  const prop = getPropUpdateCompositionTransaction(after, before), revision = getCompositionRevisionTransaction(after, before)
  if (!prop && !revision) return
  let delta = 0
  if (prop) for (const change of prop.changes) delta += ownedJsonByteLength(change.after) - ownedJsonByteLength(change.before)
  if (revision) {
    delta += ownedJsonByteLength(revision.changes.revision.after) - ownedJsonByteLength(revision.changes.revision.before)
      + ownedJsonByteLength(revision.changes.updatedAt.after) - ownedJsonByteLength(revision.changes.updatedAt.before)
  }
  const documentBytes = sizes.documentBytes + delta, expandedBytes = sizes.expandedBytes + delta
  if (documentBytes > PROJECT_DATA_LIMITS.jsonBytes) throw new Error('场景、身份或外观JSON超过20MiB。')
  if (expandedBytes > PROJECT_DATA_LIMITS.expandedBytes) throw new Error('工程声明展开字节超过300MiB。')
  const result = freezeJson(candidate)
  projectSizes.set(result, { documentBytes, expandedBytes })
  inheritProjectReceipt(result)
  if (prop) projectLocalTransactions.set(result, freezeJson({ baseline, result, stage: 'prop', propChanges: prop.changes }))
  else if (revision) {
    const previous = projectLocalTransactions.get(baseline)
    // A Prop stage does not alter revision. Only its immediately following
    // single revision step belongs to the same edit; never concatenate edits.
    const merge = previous?.stage === 'prop' && previous.result === baseline
      && previous.baseline.document.revision === revision.changes.revision.before
      && revision.changes.revision.after === revision.changes.revision.before + 1
    projectLocalTransactions.set(result, freezeJson({ baseline: merge ? previous.baseline : baseline, result, stage: 'revision',
      propChanges: merge ? previous.propChanges : [], revisionChanges: revision.changes }))
  }
  return result
}

/**
 * Internal immutable metadata handoff. This still performs the complete native
 * metadata/dependency/license closure check; it only adds the private
 * composition certificate and deep freeze used by already-owned byte bundles.
 * Resource bytes, SVG pixels and PNG pixels remain the responsibility of the
 * complete resource validator.
 */
export function certifyProjectData(input: unknown): ProjectData {
  const result = freezeJson(readProjectData(input, true))
  inheritProjectReceipt(result)
  return result
}

export const projectContentHash = (input: unknown): string => {
  const issue = inspectJsonInput(input)
  if (issue) throw new Error(issue.message)
  const wire = input as ProjectData
  return sha256Text(canonicalProjectCoordinates(validateProjectData(wire?.document?.aggregateCoordinates?.encoding === 'local' ? decodeProjectCoordinates(wire) : wire)))
}
