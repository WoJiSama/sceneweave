import { z } from 'zod'
import { nativeSceneSchema } from '../validation/scene.js'
import { nativeHistoryIdentitySchema } from '../history/identity.js'
import { nativeAppearanceGraphSchema, certifyCompositionContent, getCertifiedCompositionContent, validateCompositionContent } from '../validation/content.js'
import { inspectDependencies } from '../commands/dependencies.js'
import { sha256Text } from '../geometry/scatter.js'
import { canonicalJson, cloneJson, encodeUtf8, freezeJson, inspectJsonInput } from '../validation/json.js'
import type { ProjectData } from '../model/project.js'
import { STATIC_SVG_LIMITS } from '../ai/svg.js'
import { PACKAGE_LIMITS } from './limits.js'
import { projectSourceRecords } from './source-resources.js'
import { legacyTerrainView } from '../terrain-generation/composition-contracts.js'

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
const svgSchema = z.object({ kind: z.literal('svg'), sourceSha256: hash, normalizedSha256: hash, sourceSizeBytes: positive.max(MiB),
  normalizedSizeBytes: positive.max(MiB), rasterSha256: hash, processorId: z.literal('sceneweave-static-svg'), processorVersion: z.literal(1) }).strict()
export const projectDataSchema: z.ZodType<ProjectData> = z.object({ format: z.literal('sceneweave-complete-project'), schemaVersion: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  document: nativeSceneSchema, historyIdentity: nativeHistoryIdentitySchema, appearance: nativeAppearanceGraphSchema,
  assets: z.record(hash, assetRecordSchema), licenses: z.record(hash, z.object({ sha256: hash, text: z.string().min(1) }).strict()),
  licenseBindings: z.array(nativeLicenseBindingSchema).max(PROJECT_DATA_LIMITS.bindings), authoringSources: z.record(id, svgSchema),
}).strict().superRefine((project, ctx) => {
  if(project.historyIdentity.version!==(project.schemaVersion===4?3:project.schemaVersion===3?2:1)||project.appearance.version!==(project.schemaVersion>=3?2:1))ctx.addIssue({code:'custom',message:'完整工程、历史身份和外观图版本须匹配。'})
  if(project.schemaVersion<3&&project.licenseBindings.some(row=>row.subjectKind==='regionalSymbolDefinition'))ctx.addIssue({code:'custom',message:'旧完整版本不接受区域图符许可主体。'})
  if (project.schemaVersion !== project.document.schemaVersion) ctx.addIssue({ code: 'custom', path: ['schemaVersion'], message: '完整工程与场景契约版本必须一致。' })
})
// Keep the exported complete schema unchanged. Runtime validation delegates the
// three domain branches to their strict validators, avoiding recursive parsing
// of the scene and identity in both the envelope and the domain boundary.
const projectEnvelopeSchema = z.object({ format: z.literal('sceneweave-complete-project'), schemaVersion: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  document: z.unknown(), historyIdentity: z.unknown(), appearance: z.unknown(),
  assets: z.record(hash, assetRecordSchema), licenses: z.record(hash, z.object({ sha256: hash, text: z.string().min(1) }).strict()),
  licenseBindings: z.array(nativeLicenseBindingSchema).max(PROJECT_DATA_LIMITS.bindings), authoringSources: z.record(id, svgSchema),
}).strict()

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
  if (project.schemaVersion < 3 && project.licenseBindings.some(binding => binding.subjectKind === 'regionalSymbolDefinition')) throw new Error('旧完整版本不接受区域图符许可主体。')
  const dependencies = inspectDependencies(project.document.schemaVersion === 4 ? legacyTerrainView(project.document) : project.document)
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
    if (record.sha256 !== hash || sha256Text(record.text) !== hash || bytes.length > PROJECT_DATA_LIMITS.licenseBytes
      || /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(record.text)
      || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(record.text)
      || /(?:\/(?:Users|home|private|var)\/|[A-Za-z]:\\(?:Users|Documents and Settings)\\)/.test(record.text)
      || /(?:sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,})/.test(record.text)) throw new Error('许可正文hash、编码、预算或来源信息无效。')
    expanded += bytes.length
  }
  for (const value of [project.document, project.historyIdentity, project.appearance, project.authoringSources]) {
    const size = ownedJsonByteLength(value)
    if (value === project.authoringSources && size > PACKAGE_LIMITS.sourcesBytes) throw new Error('SVG来源JSON超过1MiB。')
    if (size > PROJECT_DATA_LIMITS.jsonBytes) throw new Error('场景、身份或外观JSON超过20MiB。')
    expanded += size
  }
  if (expanded > PROJECT_DATA_LIMITS.expandedBytes) throw new Error('工程声明展开字节超过300MiB。')
  return project
}

/**
 * Internal immutable metadata handoff. This still performs the complete native
 * metadata/dependency/license closure check; it only adds the private
 * composition certificate and deep freeze used by already-owned byte bundles.
 * Resource bytes, SVG pixels and PNG pixels remain the responsibility of the
 * complete resource validator.
 */
export function certifyProjectData(input: unknown): ProjectData {
  return freezeJson(readProjectData(input, true))
}

export const projectContentHash = (input: unknown): string => sha256Text(canonicalJson(validateProjectData(input)))
