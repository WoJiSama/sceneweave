import type { AssetRecord, ProjectBundle, ProjectData, ResourceBytePort } from '../model/project.js'
import type { BitmapParameters, CompleteValidationOptions, ImageProcessingPort, RasterImage, ResourceOptions, SvgProcessingPort } from '../ports/resources.js'
import { CancelledOperationError, checkCancelled, ImageCapabilityError, SvgCapabilityError, LegacySvgCapabilityError } from '../ports/resources.js'
import { normalizeStaticSvg, CANONICAL_SVG_PROCESSOR, LEGACY_SVG_PROCESSOR } from '../ai/svg.js'
import { canonicalJson, captureJson, freezeJson, inspectJsonInput } from '../validation/json.js'
import { assetRecordSchema, certifyProjectData, tryCertifyLocalProjectData, validateProjectData } from './validate.js'
import { captureBytes, decodeUtf8, sha256Bytes } from './binary.js'
import { inspectImageBytes } from './image-bytes.js'
import { decodeCanonicalPng, encodeCanonicalPng } from './png-rgba.js'
import { transformRgba } from './pixels.js'
import { createBitmapPixelPipelineLookup, type BitmapPixelPipeline } from './bitmap-pixels.js'
export { bitmapVariantPixelPipeline } from './bitmap-pixels.js'
import { PACKAGE_LIMITS } from './limits.js'
import { projectResourceHashes, projectSourceRecords } from './source-resources.js'
import { WeightedTaskQueue } from './task-queue.js'
import { applyImageEnhancement } from '../image-enhancement/pixels.js'
import { expandImageEnhancementScopeMask } from '../image-enhancement/metadata.js'
import { tryDecodeDecontaminationSource } from '../image-enhancement/source-pixels.js'
import { replayVectorRefinement } from '../asset-refinement/algorithms.js'
import { compileVectorStructurePlan } from '../asset-refinement/structure-plan.js'

const captured = new WeakMap<object, WeakMap<object, VerifiedProjectBundle>>()
interface ValidationCapabilities {
  readonly identity: readonly unknown[]
  readonly imageIdentity: readonly unknown[]
  readonly svgIdentity?: readonly unknown[]
  readonly legacySvgIdentity?: readonly unknown[]
  readonly images: ImageProcessingPort
  readonly svg?: SvgProcessingPort
  readonly legacySvg?: SvgProcessingPort
}
// Facts belong to exact owned metadata/bytes, and describe the actual captured
// adapter methods. Neither an options wrapper nor a caller's hash is evidence.
const capabilityProofs = new WeakMap<VerifiedProjectBundle, readonly ValidationCapabilities[]>()
const maxCapabilityFacts = 4
declare const verifiedBundle: unique symbol
/** Only the private certificate map, never this type assertion, grants reuse. */
export type VerifiedProjectBundle = ProjectBundle & { readonly [verifiedBundle]: true }
const projectFields = ['format', 'schemaVersion', 'document', 'historyIdentity', 'appearance', 'assets', 'licenses', 'licenseBindings', 'authoringSources'] as const
const proofBranches = ['assets', 'licenses', 'licenseBindings', 'authoringSources'] as const
// Shared across simultaneous save/render validations. Weights conservatively
// account for intermediate RGBA arrays; an oversized check runs on its own.
const pixelQueue = new WeightedTaskQueue(2, 32_000_000)
interface PixelTask { weight: number; run(options: ResourceOptions): Promise<void> }

async function validatePixels(tasks: Iterable<PixelTask>, concurrent: boolean, signal?: ResourceOptions['signal']): Promise<void> {
  if (!concurrent) { for (const task of tasks) await task.run({ signal }); return }
  let failed = false, failure: unknown
  const scoped = { get aborted() { return failed || !!signal?.aborted } }
  const pending = tasks[Symbol.iterator]()
  // Pull at most two checks from the captured metadata. Large history batches
  // must not allocate one pending promise/closure for every retained image.
  const work = async () => {
    try {
      while (!failed) {
        checkCancelled(scoped)
        const next = pending.next()
        if (next.done) return
        const task = next.value
        await pixelQueue.run(task.weight, scoped, () => task.run({ signal: scoped }))
      }
    } catch (error) { if (!failed) { failed = true; failure = error } }
  }
  // Drain admitted work before failure escapes. No late callback can issue a
  // certificate, and queued work is skipped after cancellation or failure.
  await Promise.all([work(), work()])
  checkCancelled(signal)
  if (failed) throw failure
}

function dataFields(input: unknown, keys: readonly string[]): Record<string, PropertyDescriptor> {
  if (!input || typeof input !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) throw new Error('完整工程包装必须是普通数据对象。')
  const fields = Object.getOwnPropertyDescriptors(input)
  if (Reflect.ownKeys(input).length !== keys.length || !keys.every(key => fields[key]?.enumerable && 'value' in fields[key])) throw new Error('完整工程包装含未知、访问器、隐藏或Symbol字段。')
  return fields
}

/** Capture JSON and the reader method synchronously before awaiting any byte IO. */
export function captureProjectBundleInput(input: unknown): ProjectBundle {
  return captureBundle(input, validateProjectData)
}
function captureBundle(input: unknown, metadataValidator: (input: unknown) => ProjectData): ProjectBundle {
  const fields = dataFields(input, ['project', 'resources'])
  const project = metadataValidator(fields.project.value)
  const source = fields.resources.value, methods = dataFields(source, ['read']), read = methods.read.value
  if (typeof read !== 'function') throw new Error('资源端口必须提供可调用的read。')
  const resources = Object.freeze({ read: (hash: string): Promise<Uint8Array> => read.call(source, hash) })
  return { project, resources }
}

/** Immutable internal byte closure. Every outward read returns a detached copy. */
export function createMemoryResources(input: ReadonlyMap<string, Uint8Array> | Record<string, Uint8Array>): ResourceBytePort {
  let entries: [string, Uint8Array][]
  if (input instanceof Map && Object.getPrototypeOf(input) === Map.prototype) entries = [...Map.prototype.entries.call(input)]
  else {
    if (!input || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) throw new Error('资源字节集合无效。')
    const fields = Object.getOwnPropertyDescriptors(input)
    if (Reflect.ownKeys(input).some(key => typeof key !== 'string' || !fields[key]?.enumerable || !('value' in fields[key]))) throw new Error('资源集合不能包含访问器、隐藏或Symbol字段。')
    entries = Object.entries(fields).map(([key, field]) => [key, field.value])
  }
  if (entries.length > PACKAGE_LIMITS.uniqueImages * 3) throw new Error('图片与SVG源资源集合超过保护数量。')
  const owned = new Map<string, Uint8Array>()
  let total = 0
  for (const [hash, value] of entries) {
    if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('资源hash键无效。')
    const bytes = captureBytes(value, 20 * 1024 * 1024)
    if (bytes.length < 1 || bytes.length > 20 * 1024 * 1024 || (total += bytes.length) > 300 * 1024 * 1024) throw new Error('资源字节集合超过保护预算。')
    owned.set(hash, bytes)
  }
  return scopedResourcePort(owned, new Set(owned.keys()))
}
function scopedResourcePort(owned: ReadonlyMap<string, Uint8Array>, scope: ReadonlySet<string>): ResourceBytePort {
  return Object.freeze({ async read(hash: string) {
    if (!scope.has(hash)) throw new Error(`资源不在本工程闭包内：${hash}。`)
    const bytes = owned.get(hash)
    if (!bytes) throw new Error(`资源字节缺失：${hash}。`)
    return bytes.slice()
  } })
}

function registerVerifiedBundle(project: ProjectData, resources: ResourceBytePort, capabilities: readonly ValidationCapabilities[]): VerifiedProjectBundle {
  const owned = freezeJson(project)
  let entries = captured.get(owned)
  const existing = entries?.get(resources)
  if (existing) { for (const capability of capabilities) rememberCapabilities(existing, capability); return existing }
  const result = Object.freeze({ project: owned, resources }) as VerifiedProjectBundle
  if (!entries) { entries = new WeakMap(); captured.set(owned, entries) }
  entries.set(result.resources, result)
  capabilityProofs.set(result, capabilities.slice(-maxCapabilityFacts))
  return result
}

function imageMethods(input: ImageProcessingPort, identity?: unknown[]): ImageProcessingPort {
  if (!input || typeof input !== 'object') throw new ImageCapabilityError()
  const fields = Object.getOwnPropertyDescriptors(input)
  for (const key of ['decode', 'transform', 'encodePng']) if (!fields[key] || !('value' in fields[key]) || typeof fields[key].value !== 'function') throw new ImageCapabilityError()
  const concurrency = fields.validationConcurrency
  if (concurrency && (!('value' in concurrency) || concurrency.value !== 1 && concurrency.value !== 2)) throw new ImageCapabilityError()
  identity?.push(input, fields.decode.value, fields.transform.value, fields.encodePng.value, concurrency?.value ?? 1)
  return { decode: fields.decode.value!.bind(input), transform: fields.transform.value!.bind(input), encodePng: fields.encodePng.value!.bind(input),
    validationConcurrency: concurrency?.value ?? 1 }
}
function svgMethods(input: SvgProcessingPort | undefined, version: 1 | 2, identity: unknown[]): SvgProcessingPort {
  const unavailable = () => version === 1 ? new LegacySvgCapabilityError() : new SvgCapabilityError()
  if (!input || typeof input !== 'object') throw unavailable()
  const method = Object.getOwnPropertyDescriptor(input, 'rasterize')
  if (!method || !('value' in method) || typeof method.value !== 'function') throw new SvgCapabilityError()
  const profile = Object.getOwnPropertyDescriptor(input, 'processor')
  if (!profile || !('value' in profile)) throw unavailable()
  const expected = version === 1 ? LEGACY_SVG_PROCESSOR : CANONICAL_SVG_PROCESSOR
  const processor = freezeJson(captureJson(profile.value))
  if (canonicalJson(processor) !== canonicalJson(expected)) throw unavailable()
  const concurrency = Object.getOwnPropertyDescriptor(input, 'validationConcurrency')
  if (concurrency && (!('value' in concurrency) || concurrency.value !== 1 && concurrency.value !== 2)) throw new SvgCapabilityError()
  identity.push(input, method.value, canonicalJson(processor), concurrency?.value ?? 1)
  return { processor: expected, rasterize: method.value.bind(input), validationConcurrency: concurrency?.value ?? 1 }
}
function validationCapabilities(projects: readonly ProjectData[], options: CompleteValidationOptions): ValidationCapabilities {
  const imageIdentity: unknown[] = [], images = imageMethods(options?.images, imageIdentity)
  const sourceVersions = new Set(projects.flatMap(project => Object.values(project.authoringSources).map(source => source.processorVersion)))
  const svgIdentity = sourceVersions.has(2) ? [] as unknown[] : undefined
  const svg = svgIdentity ? svgMethods(options?.svg, 2, svgIdentity) : undefined
  const legacySvgIdentity = sourceVersions.has(1) ? [] as unknown[] : undefined
  const legacySvg = legacySvgIdentity ? svgMethods(options?.legacySvg ?? options?.svg, 1, legacySvgIdentity) : undefined
  const capabilities = { imageIdentity, svgIdentity, legacySvgIdentity, images, svg, legacySvg }
  return { ...capabilities, identity: capabilityIdentity(capabilities) }
}
function capabilityIdentity(capabilities: Pick<ValidationCapabilities, 'imageIdentity' | 'svgIdentity' | 'legacySvgIdentity'>): readonly unknown[] {
  return [...capabilities.imageIdentity, 'svg', ...(capabilities.svgIdentity ?? [undefined]), 'legacySvg', ...(capabilities.legacySvgIdentity ?? [undefined])]
}
function projectCapabilities(capabilities: ValidationCapabilities, project: ProjectData): ValidationCapabilities {
  const versions = new Set(Object.values(project.authoringSources).map(source => source.processorVersion))
  const selected = { ...capabilities, svg: versions.has(2) ? capabilities.svg : undefined, svgIdentity: versions.has(2) ? capabilities.svgIdentity : undefined,
    legacySvg: versions.has(1) ? capabilities.legacySvg : undefined, legacySvgIdentity: versions.has(1) ? capabilities.legacySvgIdentity : undefined }
  return { ...selected, identity: capabilityIdentity(selected) }
}
function sameCapabilities(first: ValidationCapabilities, second: ValidationCapabilities): boolean {
  return first.identity.length === second.identity.length && first.identity.every((entry, i) => entry === second.identity[i])
}
function rememberCapabilities(bundle: VerifiedProjectBundle, capabilities: ValidationCapabilities): void {
  const previous = capabilityProofs.get(bundle) ?? []
  capabilityProofs.set(bundle, [...previous.filter(entry => !sameCapabilities(entry, capabilities)), capabilities].slice(-maxCapabilityFacts))
}
function checkedRaster(image: RasterImage, record: Pick<AssetRecord, 'pixelWidth' | 'pixelHeight'>): RasterImage {
  if (!image || image.width !== record.pixelWidth || image.height !== record.pixelHeight || !(image.rgba instanceof Uint8ClampedArray)
    || image.rgba.length !== image.width * image.height * 4) throw new Error('实际解码像素与资源尺寸不匹配。')
  return image
}
function verifyBytes(bytes: Uint8Array, record: AssetRecord): void {
  if (bytes.length !== record.sizeBytes || sha256Bytes(bytes) !== record.sha256) throw new Error(`图片实际字节长度或SHA256不匹配：${record.sha256}。`)
  const header = inspectImageBytes(bytes)
  if (header.mimeType !== record.mimeType || header.width !== record.pixelWidth || header.height !== record.pixelHeight) throw new Error('实际图片格式/尺寸与元数据不匹配。')
}

/** Public validation always rechecks bytes and pixels, including certified inputs. */
export async function validateProjectBundles(inputs: readonly ProjectBundle[], options: CompleteValidationOptions): Promise<VerifiedProjectBundle[]> {
  if (!Array.isArray(inputs) || Object.getPrototypeOf(inputs) !== Array.prototype || inputs.length < 1 || inputs.length > 85) throw new Error('完整工程批次必须包含1至85份明确工程。')
  const descriptors = Object.getOwnPropertyDescriptors(inputs)
  if (Reflect.ownKeys(inputs).length !== inputs.length + 1 || !Array.from({ length: inputs.length }, (_, i) => descriptors[String(i)]).every(field => field?.enumerable && 'value' in field)) throw new Error('完整工程批次不能含访问器、空洞或额外字段。')
  const bundles = inputs.map((_, i) => captureBundle(descriptors[String(i)].value, certifyProjectData))
  const capabilities = validationCapabilities(bundles.map(bundle => bundle.project), options), signal = options?.signal
  const complete = await verifyCapturedBundles(bundles, capabilities, signal)
  checkCancelled(signal)
  return complete.map(bundle => registerVerifiedBundle(bundle.project, bundle.resources, [projectCapabilities(capabilities, bundle.project)]))
}

// Complete verification without publication. Shared snapshot work may lose its
// final consumer while an adapter is draining, so only its owner may publish.
async function verifyCapturedBundles(bundles: readonly ProjectBundle[], capabilities: ValidationCapabilities, signal?: ResourceOptions['signal']): Promise<ProjectBundle[]> {
  const { images, svg, legacySvg } = capabilities
  checkCancelled(signal)
  const records = new Map<string, AssetRecord>()
  let unionPixels = 0, unionBytes = 0
  for (const bundle of bundles) for (const [hash, record] of Object.entries(bundle.project.assets)) {
    const existing = records.get(hash)
    if (existing) {
      if (canonicalJson(existing) !== canonicalJson(record)) throw new Error('同hash图片元数据冲突。')
      continue
    }
    records.set(hash, record)
    unionPixels += record.pixelWidth * record.pixelHeight
    unionBytes += record.sizeBytes
    if (records.size > PACKAGE_LIMITS.uniqueImages || unionPixels > PACKAGE_LIMITS.totalImagePixels || unionBytes > PACKAGE_LIMITS.expandedBytes) throw new Error('联合图片数量、像素或字节超过保护预算。')
  }
  const sourceRecords = new Map<string, number>()
  let sourceBytes = 0
  for (const bundle of bundles) for (const [hash, size] of projectSourceRecords(bundle.project)) {
    if (records.has(hash)) throw new Error('SVG源不能与联合图片共用资源hash。')
    const previous = sourceRecords.get(hash)
    if (previous !== undefined && previous !== size) throw new Error('联合SVG源字节声明冲突。')
    if (previous === undefined) { sourceRecords.set(hash, size); sourceBytes += size }
    if (sourceRecords.size > PACKAGE_LIMITS.uniqueImages * 2 || sourceBytes > PACKAGE_LIMITS.totalSourceBytes
      || unionBytes + sourceBytes > PACKAGE_LIMITS.expandedBytes) throw new Error('联合SVG源累计字节超过保护预算。')
  }
  const bytesByHash = new Map<string, Uint8Array>()
  let storedBytes = 0
  for (const bundle of bundles) {
    for (const [hash, record] of Object.entries(bundle.project.assets)) {
      const bytes = captureBytes(await bundle.resources.read(hash), record.sizeBytes)
      checkCancelled(signal)
      verifyBytes(bytes, record)
      if (!bytesByHash.has(hash)) {
        storedBytes += bytes.length
        if (storedBytes > PACKAGE_LIMITS.expandedBytes) throw new Error('联合实际字节超过保护预算。')
        bytesByHash.set(hash, bytes)
      }
    }
    for (const [hash, size] of projectSourceRecords(bundle.project)) {
      const bytes = captureBytes(await bundle.resources.read(hash), size)
      checkCancelled(signal)
      if (bytes.length !== size || sha256Bytes(bytes) !== hash) throw new Error(`SVG源实际字节长度或SHA256不匹配：${hash}。`)
      if (!bytesByHash.has(hash)) {
        storedBytes += bytes.length
        if (storedBytes > PACKAGE_LIMITS.expandedBytes) throw new Error('联合实际字节超过保护预算。')
        bytesByHash.set(hash, bytes)
      }
    }
  }
  function* pixelChecks(): Generator<PixelTask> {
    for (const bundle of bundles) {
      const bitmapPipeline = createBitmapPixelPipelineLookup(bundle.project)
      for (const [hash, record] of Object.entries(bundle.project.assets)) {
        yield { weight: record.pixelWidth * record.pixelHeight * 2, async run({ signal }) {
          checkCancelled(signal)
          checkedRaster(await images.decode(bytesByHash.get(hash)!.slice(), record, { signal }), record)
          checkCancelled(signal)
        } }
      }
      for (const [assetId, source] of Object.entries(bundle.project.authoringSources)) {
        const record = bundle.project.assets[bundle.project.document.assets[assetId].sha256]
        yield { weight: record.pixelWidth * record.pixelHeight * 4, async run({ signal }) {
          checkCancelled(signal)
          const original = decodeUtf8(bytesByHash.get(source.sourceSha256)!), normalizedSource = decodeUtf8(bytesByHash.get(source.normalizedSha256)!)
          const normalized = normalizeStaticSvg(original), reparsed = normalizeStaticSvg(normalizedSource)
          if (normalized.sourceSha256 !== source.sourceSha256 || normalized.sourceSizeBytes !== source.sourceSizeBytes
            || normalized.normalizedSha256 !== source.normalizedSha256 || normalized.normalizedSizeBytes !== source.normalizedSizeBytes
            || normalized.normalizedSource !== normalizedSource || reparsed.normalizedSource !== normalizedSource) throw new Error('SVG源、规范化源与来源记录不一致。')
          const asset = bundle.project.document.assets[assetId], record = bundle.project.assets[asset.sha256]
          const scale = Math.max(record.pixelWidth, record.pixelHeight) / Math.max(normalized.viewBox.width, normalized.viewBox.height)
          if (Math.max(1, Math.round(normalized.viewBox.width * scale)) !== record.pixelWidth
            || Math.max(1, Math.round(normalized.viewBox.height * scale)) !== record.pixelHeight) throw new Error('SVG PNG尺寸必须保持规范化viewBox比例。')
          const rasterizer = source.processorVersion === 2 ? svg! : legacySvg!
          const expected = checkedRaster(await rasterizer.rasterize(normalized, { width: record.pixelWidth, height: record.pixelHeight }, { signal }), record)
          checkCancelled(signal)
          const pngBytes = bytesByHash.get(record.sha256)!.slice()
          const actual = checkedRaster(source.processorVersion === 2 ? decodeCanonicalPng(pngBytes) : await images.decode(pngBytes, record, { signal }), record)
          checkCancelled(signal)
          if (expected.rgba.some((channel, i) => channel !== actual.rgba[i])) throw new Error(`SVG实际栅格像素与PNG不一致：${assetId}。`)
        } }
      }
      for (const asset of Object.values(bundle.project.document.assets)) {
        const refinement = asset.imageRefinement
        if (!refinement) continue
        const sourceAsset = bundle.project.document.assets[refinement.sourceAssetId], source = bundle.project.assets[sourceAsset.sha256]
        yield { weight: source.pixelWidth * source.pixelHeight * 8, async run({ signal }) {
          checkCancelled(signal)
          const sourceBytes = bytesByHash.get(source.sha256)!.slice()
          const exact = refinement.sourcePixelMode === 'rgba8' ? tryDecodeDecontaminationSource(sourceBytes, source.mimeType) : undefined
          if (refinement.sourcePixelMode === 'rgba8' && !exact) throw new Error('精修源不符合记录的确切RGBA8解码方式。')
          const original = checkedRaster(exact ?? await images.decode(sourceBytes, source, { signal }), source)
          checkCancelled(signal)
          if (refinement.kind === 'vector') {
            const expected = refinement.algorithm === 'structure-plan-v1'
              ? compileVectorStructurePlan(refinement.plan, { sha256: source.sha256, width: original.width, height: original.height })
              : replayVectorRefinement(refinement.algorithm, { width: original.width, height: original.height, data: original.rgba }, refinement.options, signal)
            const normalized = normalizeStaticSvg(expected.sourceSvg), proof = bundle.project.authoringSources[asset.id]
            if (!proof || proof.sourceSha256 !== normalized.sourceSha256) throw new Error('矢量重建源不匹配原件和固定算法。')
          } else {
            const inputHash = sha256Bytes(encodeCanonicalPng(original))
            if (inputHash !== refinement.inputSha256) throw new Error('模型补画输入不匹配所保留的原件像素。')
          }
          checkCancelled(signal)
        } }
      }
      for (const asset of Object.values(bundle.project.document.assets)) {
        const enhancement = asset.imageEnhancement
        if (!enhancement) continue
        const sourceAsset = bundle.project.document.assets[enhancement.sourceAssetId]
        const source = bundle.project.assets[sourceAsset.sha256], output = bundle.project.assets[asset.sha256]
        yield { weight: (source.pixelWidth * source.pixelHeight + output.pixelWidth * output.pixelHeight) * 8, async run({ signal }) {
          checkCancelled(signal)
          const sourceBytes = bytesByHash.get(source.sha256)!.slice()
          const exact = enhancement.recipe.direction === 'decontaminate' || enhancement.recipe.direction === 'contour' ? tryDecodeDecontaminationSource(sourceBytes, source.mimeType) : undefined
          const original = checkedRaster(exact ?? (bitmapPipeline(sourceAsset.id) === 'svg-rgba8-v1' ? decodeCanonicalPng(sourceBytes)
            : await images.decode(sourceBytes, source, { signal })), source)
          checkCancelled(signal)
          const scope = expandImageEnhancementScopeMask(enhancement.scopeMask, original.width, original.height)
          const expected = applyImageEnhancement({ width: original.width, height: original.height, data: original.rgba }, enhancement.recipe, scope, signal)
          const actual = checkedRaster(decodeCanonicalPng(bytesByHash.get(output.sha256)!.slice()), output)
          checkCancelled(signal)
          if (expected.data.some((channel, index) => channel !== actual.rgba[index])) throw new Error(`画质增强真实像素与来源/配方不一致：${asset.id}。`)
        } }
      }
      for (const variant of Object.values(bundle.project.appearance.variants)) {
        const record = bundle.project.assets[bundle.project.document.assets[variant.sourceAssetId].sha256]
        yield { weight: record.pixelWidth * record.pixelHeight * 8, async run({ signal }) {
          const sourceAsset = bundle.project.document.assets[variant.sourceAssetId], outputAsset = bundle.project.document.assets[variant.outputAssetId]
          const source = sourceAsset && bundle.project.assets[sourceAsset.sha256], output = outputAsset && bundle.project.assets[outputAsset.sha256]
          if (!source || !output || output.mimeType !== 'image/png' || source.pixelWidth !== output.pixelWidth || source.pixelHeight !== output.pixelHeight) throw new Error('固定派生源/输出缺失，或PNG尺寸不匹配。')
          if (sourceAsset.licenseRef !== outputAsset.licenseRef || sourceAsset.origin.kind !== outputAsset.origin.kind || sourceAsset.origin.attribution !== outputAsset.origin.attribution || sourceAsset.origin.canEmbed !== outputAsset.origin.canEmbed) throw new Error('固定派生不得改变源许可或来源。')
          const software = bitmapPipeline(variant.sourceAssetId) === 'svg-rgba8-v1'
          const sourceBytes = bytesByHash.get(source.sha256)!.slice()
          const original = checkedRaster(software ? decodeCanonicalPng(sourceBytes) : await images.decode(sourceBytes, source, { signal }), source)
          checkCancelled(signal)
          const expected = checkedRaster(software ? { ...original, rgba: transformRgba(original.rgba, variant.tint, variant.brightness) } : await images.transform(original, variant, { signal }), source)
          checkCancelled(signal)
          const outputBytes = bytesByHash.get(output.sha256)!.slice()
          const actual = checkedRaster(software ? decodeCanonicalPng(outputBytes) : await images.decode(outputBytes, output, { signal }), output)
          checkCancelled(signal)
          if (expected.rgba.some((channel, i) => channel !== actual.rgba[i])) throw new Error(`固定派生真实像素与源/参数不一致：${variant.id}。`)
        } }
      }
    }
  }
  await validatePixels(pixelChecks(), images.validationConcurrency === 2 && (!svg || svg.validationConcurrency === 2) && (!legacySvg || legacySvg.validationConcurrency === 2), signal)
  checkCancelled(signal)
  return bundles.map(bundle => ({ project: bundle.project, resources: scopedResourcePort(bytesByHash, new Set(projectResourceHashes(bundle.project))) }))
}
export async function validateProjectBundle(input: ProjectBundle, options: CompleteValidationOptions): Promise<VerifiedProjectBundle> {
  return (await validateProjectBundles([input], options))[0]
}
export const captureValidatedProjectBundle = validateProjectBundle
/** Exact owned metadata plus an independently captured byte closure only. */
export function getVerifiedProjectBundle(input: unknown): VerifiedProjectBundle | undefined {
  try {
    const fields = dataFields(input, ['project', 'resources'])
    return fields.project.value && fields.resources.value ? captured.get(fields.project.value)?.get(fields.resources.value) : undefined
  } catch { return }
}
/** Exact immutable metadata issued after successful complete validation. This
 * proves JSON provenance only; consumers must still check resource bytes and
 * current licenses. It deliberately retains no resource-port/byte closure. */
export function isVerifiedProjectData(input: unknown): input is ProjectData {
  return !!input && typeof input === 'object' && captured.has(input)
}

interface SnapshotConsumer {
  readonly signal?: ResourceOptions['signal']
  readonly resolve: (bundle: VerifiedProjectBundle) => void
  readonly reject: (error: unknown) => void
  unsubscribe?: () => void
}
interface SnapshotVerification {
  readonly bundle: VerifiedProjectBundle
  readonly capabilities: ValidationCapabilities
  readonly consumers: Set<SnapshotConsumer>
  cancelled: boolean
  finished: boolean
}
const snapshotVerifications = new WeakMap<VerifiedProjectBundle, SnapshotVerification[]>()
const maxSharedVerifications = 4

function removeSnapshotVerification(task: SnapshotVerification): void {
  for (const consumer of task.consumers) unsubscribeSnapshotConsumer(consumer)
  const entries = snapshotVerifications.get(task.bundle)
  if (!entries) return
  const remaining = entries.filter(entry => entry !== task)
  if (remaining.length) snapshotVerifications.set(task.bundle, remaining)
  else snapshotVerifications.delete(task.bundle)
}
function unsubscribeSnapshotConsumer(consumer: SnapshotConsumer): void {
  const unsubscribe = consumer.unsubscribe
  consumer.unsubscribe = undefined
  // A faulty external signal cannot change another consumer's result or turn
  // an already completed operation into an unhandled cleanup failure.
  try { unsubscribe?.() } catch { /* cancellation adapter cleanup only */ }
}
function refreshSnapshotConsumers(task: SnapshotVerification): void {
  if (task.finished || task.cancelled) return
  for (const consumer of task.consumers) {
    try { checkCancelled(consumer.signal) }
    catch (error) { task.consumers.delete(consumer); unsubscribeSnapshotConsumer(consumer); consumer.reject(error) }
  }
  if (!task.consumers.size) { task.cancelled = true; removeSnapshotVerification(task) }
}
type AbortSubscription = (listener: () => void) => () => void
function captureAbortSubscription(signal?: ResourceOptions['signal']): AbortSubscription | undefined {
  if (!signal) return undefined
  const method = (key: 'addEventListener' | 'removeEventListener') => {
    let owner: object | null = signal
    for (let depth = 0; owner && depth < 32; depth++, owner = Object.getPrototypeOf(owner)) {
      const field = Object.getOwnPropertyDescriptor(owner, key)
      if (!field) continue
      if (!('value' in field) || field.value !== undefined && typeof field.value !== 'function') throw new Error('取消订阅必须为数据方法。')
      return field.value as ((type: 'abort', listener: () => void, options?: { once?: boolean }) => void) | undefined
    }
    if (owner) throw new Error('取消信号原型链超过保护深度。')
    return undefined
  }
  // Capture inherited native AbortSignal methods too, before the first await;
  // never read a caller's subscription getter during completion or cleanup.
  const add = method('addEventListener'), remove = method('removeEventListener')
  if (!add && !remove) return undefined
  if (!add || !remove) throw new Error('取消订阅与清理方法必须成对提供。')
  return listener => {
    add.call(signal, 'abort', listener, { once: true })
    return () => remove.call(signal, 'abort', listener)
  }
}
function watchSnapshotConsumer(task: SnapshotVerification, consumer: SnapshotConsumer, subscribe?: AbortSubscription): void {
  if (subscribe) {
    try {
      consumer.unsubscribe = subscribe(() => refreshSnapshotConsumers(task))
      // A structural subscription is allowed to notify synchronously.
      if (!task.consumers.has(consumer)) unsubscribeSnapshotConsumer(consumer)
    } catch (error) { task.consumers.delete(consumer); unsubscribeSnapshotConsumer(consumer); consumer.reject(error) }
  }
  // Flag-only ports retain their original checkpoint semantics. Subscribable
  // ports also close a cancellation race between the initial check and listen.
  refreshSnapshotConsumers(task)
}
async function runSnapshotVerification(task: SnapshotVerification): Promise<void> {
  const signal = { get aborted() { refreshSnapshotConsumers(task); return task.cancelled } }
  try {
    const bundle = captureBundle(task.bundle, certifyProjectData)
    await verifyCapturedBundles([bundle], task.capabilities, signal)
    refreshSnapshotConsumers(task)
    checkCancelled(signal)
    // This full check used the exact owned bytes of the original snapshot.
    // Keep its identity and record the newly proved capability there, so a
    // future consumer of that same snapshot does not start the full work again.
    rememberCapabilities(task.bundle, task.capabilities)
    task.finished = true
    removeSnapshotVerification(task)
    for (const consumer of task.consumers) consumer.resolve(task.bundle)
  } catch (error) {
    task.finished = true
    removeSnapshotVerification(task)
    for (const consumer of task.consumers) consumer.reject(error)
  } finally { task.consumers.clear() }
}

/** Internal exact-snapshot consumption; unknown inputs retain full validation. */
export async function validateProjectSnapshot(input: ProjectBundle, options: CompleteValidationOptions): Promise<VerifiedProjectBundle> {
  const bundle = getVerifiedProjectBundle(input)
  if (!bundle) return validateProjectBundle(input, options)
  // Capture actual owner/method/profile before the first await. Options wrapper
  // and consumer cancellation are deliberately absent from the capability key.
  const capabilities = validationCapabilities([bundle.project], options), signal = options?.signal
  checkCancelled(signal)
  if (capabilityProofs.get(bundle)?.some(proof => sameCapabilities(proof, capabilities))) return bundle
  const subscribe = captureAbortSubscription(signal)
  const entries = snapshotVerifications.get(bundle) ?? []
  let task = entries.find(entry => sameCapabilities(entry.capabilities, capabilities))
  if (task) { refreshSnapshotConsumers(task); if (task.cancelled) task = undefined }
  const start = !task
  if (!task) {
    task = { bundle, capabilities, consumers: new Set(), cancelled: false, finished: false }
    // Overflow callers still receive full independent verification. Only this
    // bounded list is discoverable by later consumers for in-flight sharing.
    const active = snapshotVerifications.get(bundle) ?? []
    if (active.length < maxSharedVerifications) snapshotVerifications.set(bundle, [...active, task])
  }
  const pending = new Promise<VerifiedProjectBundle>((resolve, reject) => {
    const consumer = { signal, resolve, reject }
    task!.consumers.add(consumer)
    watchSnapshotConsumer(task!, consumer, subscribe)
  })
  if (start) void runSnapshotVerification(task)
  return pending
}

/**
 * Re-certify changed composition branches while retaining an already-owned
 * resource closure. A miss is deliberately represented by undefined so the
 * caller can fall back to the public byte/pixel validator.
 */
export function tryDerivedProjectBundle(input: ProjectBundle, baseline: ProjectBundle, options: ResourceOptions = {}): VerifiedProjectBundle | undefined {
  checkCancelled(options.signal)
  const base = getVerifiedProjectBundle(baseline)
  if (!base) return undefined
  try {
    const inputFields = dataFields(input, ['project', 'resources'])
    if (inputFields.resources.value !== base.resources) return undefined
    const candidateFields = dataFields(inputFields.project.value, projectFields)
    const baseFields = dataFields(base.project, projectFields)
    if(candidateFields.schemaVersion.value !== baseFields.schemaVersion.value) return undefined
    for (const key of proofBranches) {
      const candidate = candidateFields[key].value, original = baseFields[key].value
      if (candidate !== original || !Object.isFrozen(original)) return undefined
    }

    // Capture an immutable candidate before any certificate can be registered.
    // This repeats the complete metadata, geometry, dependency, identity,
    // visual, license, and budget checks.
    // Parse the exact descriptor values checked above. A caller-owned wrapper
    // (including a Proxy) must not substitute a different resource branch on a
    // later property read after passing the reference checks.
    const candidate = Object.fromEntries(projectFields.map(key => [key, candidateFields[key].value]))
    const local = tryCertifyLocalProjectData(candidate, base.project)
    if (local) { checkCancelled(options.signal); return registerVerifiedBundle(local, base.resources, capabilityProofs.get(base) ?? []) }
    const certified = certifyProjectData(candidate)
    checkCancelled(options.signal)
    if (canonicalJson(certified.document.assets) !== canonicalJson(base.project.document.assets)
      || canonicalJson(certified.appearance.variants) !== canonicalJson(base.project.appearance.variants)) return undefined

    const candidateHashes = projectResourceHashes(certified), baseHashes = projectResourceHashes(base.project)
    if (candidateHashes.length !== baseHashes.length || candidateHashes.some(hash => !baseHashes.includes(hash))) return undefined
    checkCancelled(options.signal)
    return registerVerifiedBundle(certified, base.resources, capabilityProofs.get(base) ?? [])
  } catch (error) {
    if (error instanceof CancelledOperationError) throw error
    return undefined
  }
}

/** Compatibility spelling for callers that prefer the verb-first form. */
export const tryDeriveProjectBundle = tryDerivedProjectBundle

/** Generates real normalized output; it does not adopt it into a scene. */
export async function deriveBitmapVariant(sourceInput: Uint8Array, source: AssetRecord, parameters: BitmapParameters, options: CompleteValidationOptions, pipeline: BitmapPixelPipeline = 'native'): Promise<{ record: AssetRecord; bytes: Uint8Array }> {
  const sourceIssue = inspectJsonInput(source)
  if (sourceIssue) throw new Error(sourceIssue.message)
  const metadata = assetRecordSchema.parse(source), bytes = captureBytes(sourceInput, metadata.sizeBytes), variant = captureJson(parameters), images = imageMethods(options?.images), signal = options?.signal
  if (Object.keys(variant).length !== 2 || !Object.hasOwn(variant, 'tint') || !Object.hasOwn(variant, 'brightness') || variant.tint !== null && !/^#[a-f0-9]{6}$/i.test(variant.tint)
    || !Number.isFinite(variant.brightness) || variant.brightness < .25 || variant.brightness > 2) throw new Error('派生位图参数字段或范围无效。')
  verifyBytes(bytes, metadata); checkCancelled(signal)
  if (pipeline !== 'native' && pipeline !== 'svg-rgba8-v1') throw new Error('固定派生像素算法无效。')
  const software = pipeline === 'svg-rgba8-v1'
  const original = checkedRaster(software ? decodeCanonicalPng(bytes) : await images.decode(bytes, metadata, { signal }), metadata)
  checkCancelled(signal)
  const transformed = checkedRaster(software ? { ...original, rgba: transformRgba(original.rgba, variant.tint, variant.brightness) } : await images.transform(original, variant, { signal }), metadata)
  checkCancelled(signal)
  const output = captureBytes(software ? encodeCanonicalPng(transformed) : await images.encodePng(transformed, { signal }), 20 * 1024 * 1024)
  checkCancelled(signal)
  const record: AssetRecord = { ...metadata, sha256: sha256Bytes(output), mimeType: 'image/png', sizeBytes: output.length }
  verifyBytes(output, record)
  const actual = checkedRaster(software ? decodeCanonicalPng(output) : await images.decode(output.slice(), record, { signal }), record)
  checkCancelled(signal)
  if (transformed.rgba.some((channel, i) => channel !== actual.rgba[i])) throw new Error('编码后的固定派生像素不一致。')
  return { record, bytes: output }
}
