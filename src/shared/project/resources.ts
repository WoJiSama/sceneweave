import type { AssetRecord, ProjectBundle, ProjectData, ResourceBytePort } from '../model/project.js'
import type { BitmapParameters, CompleteValidationOptions, ImageProcessingPort, RasterImage, ResourceOptions, SvgProcessingPort } from '../ports/resources.js'
import { CancelledOperationError, checkCancelled, ImageCapabilityError, SvgCapabilityError } from '../ports/resources.js'
import { normalizeStaticSvg } from '../ai/svg.js'
import { canonicalJson, captureJson, freezeJson, inspectJsonInput } from '../validation/json.js'
import { assetRecordSchema, certifyProjectData, validateProjectData } from './validate.js'
import { captureBytes, decodeUtf8, sha256Bytes } from './binary.js'
import { inspectImageBytes } from './image-bytes.js'
import { PACKAGE_LIMITS } from './limits.js'
import { projectResourceHashes, projectSourceRecords } from './source-resources.js'

const captured = new WeakMap<object, WeakMap<object, VerifiedProjectBundle>>()
declare const verifiedBundle: unique symbol
/** Only the private certificate map, never this type assertion, grants reuse. */
export type VerifiedProjectBundle = ProjectBundle & { readonly [verifiedBundle]: true }
const projectFields = ['format', 'schemaVersion', 'document', 'historyIdentity', 'appearance', 'assets', 'licenses', 'licenseBindings', 'authoringSources'] as const
const proofBranches = ['assets', 'licenses', 'licenseBindings', 'authoringSources'] as const

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

function registerVerifiedBundle(project: ProjectData, resources: ResourceBytePort): VerifiedProjectBundle {
  const result = Object.freeze({ project: freezeJson(project), resources }) as VerifiedProjectBundle
  let entries = captured.get(result.project)
  if (!entries) { entries = new WeakMap(); captured.set(result.project, entries) }
  entries.set(result.resources, result)
  return result
}

function imageMethods(input: ImageProcessingPort): ImageProcessingPort {
  if (!input || typeof input !== 'object') throw new ImageCapabilityError()
  const fields = Object.getOwnPropertyDescriptors(input)
  for (const key of ['decode', 'transform', 'encodePng']) if (!fields[key] || !('value' in fields[key]) || typeof fields[key].value !== 'function') throw new ImageCapabilityError()
  return { decode: fields.decode.value!.bind(input), transform: fields.transform.value!.bind(input), encodePng: fields.encodePng.value!.bind(input) }
}
function svgMethods(input: SvgProcessingPort | undefined): SvgProcessingPort {
  if (!input || typeof input !== 'object') throw new SvgCapabilityError()
  const method = Object.getOwnPropertyDescriptor(input, 'rasterize')
  if (!method || !('value' in method) || typeof method.value !== 'function') throw new SvgCapabilityError()
  return { rasterize: method.value.bind(input) }
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
  const bundles = inputs.map((_, i) => captureBundle(descriptors[String(i)].value, certifyProjectData)), images = imageMethods(options?.images), signal = options?.signal
  const svg = bundles.some(bundle => Object.keys(bundle.project.authoringSources).length) ? svgMethods(options?.svg) : undefined
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
  for (const bundle of bundles) {
    for (const [hash, record] of Object.entries(bundle.project.assets)) {
      checkCancelled(signal)
      checkedRaster(await images.decode(bytesByHash.get(hash)!.slice(), record, { signal }), record)
      checkCancelled(signal)
    }
    for (const [assetId, source] of Object.entries(bundle.project.authoringSources)) {
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
      const expected = checkedRaster(await svg!.rasterize(normalized, { width: record.pixelWidth, height: record.pixelHeight }, { signal }), record)
      checkCancelled(signal)
      const actual = checkedRaster(await images.decode(bytesByHash.get(record.sha256)!.slice(), record, { signal }), record)
      checkCancelled(signal)
      if (expected.rgba.some((channel, i) => channel !== actual.rgba[i])) throw new Error(`SVG实际栅格像素与PNG不一致：${assetId}。`)
    }
    for (const variant of Object.values(bundle.project.appearance.variants)) {
      const sourceAsset = bundle.project.document.assets[variant.sourceAssetId], outputAsset = bundle.project.document.assets[variant.outputAssetId]
      const source = sourceAsset && bundle.project.assets[sourceAsset.sha256], output = outputAsset && bundle.project.assets[outputAsset.sha256]
      if (!source || !output || output.mimeType !== 'image/png' || source.pixelWidth !== output.pixelWidth || source.pixelHeight !== output.pixelHeight) throw new Error('固定派生源/输出缺失，或PNG尺寸不匹配。')
      if (sourceAsset.licenseRef !== outputAsset.licenseRef || sourceAsset.origin.kind !== outputAsset.origin.kind || sourceAsset.origin.attribution !== outputAsset.origin.attribution || sourceAsset.origin.canEmbed !== outputAsset.origin.canEmbed) throw new Error('固定派生不得改变源许可或来源。')
      const original = checkedRaster(await images.decode(bytesByHash.get(source.sha256)!.slice(), source, { signal }), source)
      checkCancelled(signal)
      const expected = checkedRaster(await images.transform(original, variant, { signal }), source)
      checkCancelled(signal)
      const actual = checkedRaster(await images.decode(bytesByHash.get(output.sha256)!.slice(), output, { signal }), output)
      checkCancelled(signal)
      if (expected.rgba.some((channel, i) => channel !== actual.rgba[i])) throw new Error(`固定派生真实像素与源/参数不一致：${variant.id}。`)
    }
  }
  checkCancelled(signal)
  return bundles.map(bundle => registerVerifiedBundle(bundle.project, scopedResourcePort(bytesByHash, new Set(projectResourceHashes(bundle.project)))))
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
    const certified = certifyProjectData(candidate)
    checkCancelled(options.signal)
    if (canonicalJson(certified.document.assets) !== canonicalJson(base.project.document.assets)
      || canonicalJson(certified.appearance.variants) !== canonicalJson(base.project.appearance.variants)) return undefined

    const candidateHashes = projectResourceHashes(certified), baseHashes = projectResourceHashes(base.project)
    if (candidateHashes.length !== baseHashes.length || candidateHashes.some(hash => !baseHashes.includes(hash))) return undefined
    checkCancelled(options.signal)
    return registerVerifiedBundle(certified, base.resources)
  } catch (error) {
    if (error instanceof CancelledOperationError) throw error
    return undefined
  }
}

/** Compatibility spelling for callers that prefer the verb-first form. */
export const tryDeriveProjectBundle = tryDerivedProjectBundle

/** Generates real normalized output; it does not adopt it into a scene. */
export async function deriveBitmapVariant(sourceInput: Uint8Array, source: AssetRecord, parameters: BitmapParameters, options: CompleteValidationOptions): Promise<{ record: AssetRecord; bytes: Uint8Array }> {
  const sourceIssue = inspectJsonInput(source)
  if (sourceIssue) throw new Error(sourceIssue.message)
  const metadata = assetRecordSchema.parse(source), bytes = captureBytes(sourceInput, metadata.sizeBytes), variant = captureJson(parameters), images = imageMethods(options?.images), signal = options?.signal
  if (Object.keys(variant).length !== 2 || !Object.hasOwn(variant, 'tint') || !Object.hasOwn(variant, 'brightness') || variant.tint !== null && !/^#[a-f0-9]{6}$/i.test(variant.tint)
    || !Number.isFinite(variant.brightness) || variant.brightness < .25 || variant.brightness > 2) throw new Error('派生位图参数字段或范围无效。')
  verifyBytes(bytes, metadata); checkCancelled(signal)
  const original = checkedRaster(await images.decode(bytes, metadata, { signal }), metadata)
  checkCancelled(signal)
  const transformed = checkedRaster(await images.transform(original, variant, { signal }), metadata)
  checkCancelled(signal)
  const output = captureBytes(await images.encodePng(transformed, { signal }), 20 * 1024 * 1024)
  checkCancelled(signal)
  const record: AssetRecord = { ...metadata, sha256: sha256Bytes(output), mimeType: 'image/png', sizeBytes: output.length }
  verifyBytes(output, record)
  const actual = checkedRaster(await images.decode(output.slice(), record, { signal }), record)
  checkCancelled(signal)
  if (transformed.rgba.some((channel, i) => channel !== actual.rgba[i])) throw new Error('编码后的固定派生像素不一致。')
  return { record, bytes: output }
}
