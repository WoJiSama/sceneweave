import { catalogAdditionCost, CATALOG_ADOPTION_LIMIT } from './catalog-budget.js'
import { assertTaskBudget, measureTaskBudget, parseTaskBudgetProfile, type TaskBudgetProfile } from '../../shared/budget/task-budget.js'
import { detachChangedOutputs } from '../../shared/terrain-generation/integrity.js'
import { pauseChangedCompositionAppearance, pauseChangedCompositions } from '../../shared/terrain-generation/composition-lifecycle.js'
import { detachChangedAppearance } from '../../shared/terrain-generation/appearance-lifecycle.js'
import { assertTerrainBudget, terrainCommandCost } from '../../shared/terrain-generation/cost.js'
import { applyCompositionDraftCommands } from '../../shared/appearance/commands.js'
import { listRequiredVariants, resolveAppearance, syncAppearanceGraph } from '../../shared/appearance/graph.js'
import { topDownPresentation } from '../../shared/appearance/presentation.js'
import { certifyCompositionContent, validateCompositionDraft } from '../../shared/validation/content.js'
import type { CompositionCommand, CompositionContent } from '../../shared/model/appearance.js'
import type { SceneDocument } from '../../shared/model/scene.js'
import { structureTopology } from '../../shared/history/structure-continuity.js'
import type { AssetRecord, LicenseBinding, LicenseSubjectKind, SvgAuthoringSource } from '../../shared/model/project.js'
import type { CompleteValidationOptions, CancellationSignal } from '../../shared/ports/resources.js'
import { checkCancelled, SvgCapabilityError } from '../../shared/ports/resources.js'
import type { PreparationContext } from '../../shared/ports/runtime.js'
import { createMemoryResources, deriveBitmapVariant } from '../../shared/project/resources.js'
import { sha256Bytes } from '../../shared/project/binary.js'
import { PROJECT_DATA_LIMITS } from '../../shared/project/validate.js'
import { canonicalJson, captureJson, encodeUtf8, inspectJsonInput, freezeJson } from '../../shared/validation/json.js'
import { normalizeStaticSvg, STATIC_SVG_LIMITS } from '../../shared/ai/svg.js'
import { inspectImageBytes, normalizePngChunks } from '../../shared/project/image-bytes.js'
import { projectResourceRecords } from '../../shared/project/source-resources.js'
import { normalizeBrowserImage } from '../../platform/browser/images/index.js'
import { adoptLibraryEntries, listCatalogItems, prepareLibraryEntry } from '../../shared/library/content.js'
import type { CatalogSelector, PreparedLibraryEntry } from '../../shared/library/types.js'
import { captureEditableDraft, captureEditableInput, fromBundle, getVerifiedEditableProject, tryDeriveEditableProject, toBundle, validateEditableProject, type EditableProject } from './project.js'

export interface PrepareOptions {
  validation: CompleteValidationOptions
  runtime: PreparationContext
  signal?: CancellationSignal
  /** Exact workspace-owned baseline for composition-only derivation reuse. */
  baseline?: EditableProject
  /** Explicit registered envelope for new task paths; absent keeps legacy256. */
  budget?: TaskBudgetProfile
  /** Internal accounting for fixed sources added in this same transaction. */
  initialOperationCost?: number
  onOperationCost?: (cost: number) => void
  /** Session-only IDs whose structure topology changed between commands. */
  onStructureInvalidations?: (ids: readonly string[]) => void
}
export interface AssetImportRequest {
  file: Blob
  name: string
  kind: 'prop' | 'material'
  widthMm: number
  heightMm: number
  footprintWidthMm?: number
  footprintHeightMm?: number
  /** Image-space root in integer mm from the upper-left corner. Missing keeps the centred legacy default. */
  rootAnchorMm?: { x: number; y: number }
  blocksMovement?: boolean
  blocksSight?: boolean
  tags?: string[]
  licenseText: string
  attribution: string
  canEmbed: true
}
const contentOf = (project: EditableProject): CompositionContent => ({ document: project.document, historyIdentity: project.historyIdentity, appearance: project.appearance })
const collections = { asset: 'assets', material: 'materials', propDefinition: 'propDefinitions', prefabDefinition: 'prefabDefinitions', styleTheme: 'styleThemes' } as const
const validation = (options: PrepareOptions): CompleteValidationOptions => ({ ...options.validation, signal: options.signal ?? options.validation.signal })

function inheritMissingBindings(project: EditableProject): void {
  for (const [kind, collection] of Object.entries(collections) as [LicenseSubjectKind, typeof collections[keyof typeof collections]][]) {
    for (const subject of Object.values(project.document[collection])) {
      if (project.licenseBindings.some(binding => binding.subjectKind === kind && binding.subjectId === subject.id)) continue
      const matches = project.licenseBindings.filter(binding => binding.licenseRef === subject.licenseRef && binding.embedding === 'allowed')
      if (!matches.length || new Set(matches.map(binding => binding.licensePath)).size !== 1) throw new Error(`新采用对象${subject.id}缺少唯一许可来源。`)
      project.licenseBindings.push({ ...matches[0], subjectKind: kind, subjectId: subject.id })
    }
  }
}
function draftBudgets(project: EditableProject): void {
  for (const value of [project.document, project.historyIdentity, project.appearance, project.authoringSources]) {
    const issue = inspectJsonInput(value)
    if (issue) throw new Error(issue.message)
    if (encodeUtf8(JSON.stringify(value)).length > PROJECT_DATA_LIMITS.jsonBytes) throw new Error('候选文档、身份或外观图超过20MiB。')
  }
  const assets = Object.values(project.assets)
  if (assets.length > PROJECT_DATA_LIMITS.images || assets.reduce((sum, record) => sum + record.pixelWidth * record.pixelHeight, 0) > PROJECT_DATA_LIMITS.totalImagePixels) throw new Error('候选位图数量或累计像素超过保护值。')
}

function assertPreparationBudget(before: EditableProject, after: EditableProject, options: PrepareOptions): void {
  if (options.budget) assertTaskBudget(parseTaskBudgetProfile(options.budget), measureTaskBudget(before.document, after.document, { before, after }))
  else assertTerrainBudget(before.document, after.document, { before, after })
}

/** Real bitmap materialization and complete validation precede candidate adoption. */
export async function materializeProject(input: EditableProject, options: PrepareOptions): Promise<EditableProject> {
  const checked = validation(options)
  checkCancelled(checked.signal)
  const baseline = getVerifiedEditableProject(options.baseline ?? input)
  let captured = captureEditableInput(input)
  if (baseline) {
    // Reconcile manual drafts before strict active-receipt validation. Own the
    // JSON branches first; neither caller data nor the baseline is repairable.
    const owned = captureJson({ document: captured.document, appearance: captured.appearance })
    const draft = { ...owned, historyIdentity: captured.historyIdentity }
    const changed = detachChangedAppearance(contentOf(baseline), draft)
      + pauseChangedCompositionAppearance(contentOf(baseline), draft)
    if (changed) captured = { ...captured, document: draft.document }
  }
  // Ordinary geometry edits already carry a resolved composition. The strict
  // derivation validates that fact and the exact unchanged resource closure;
  // unresolved adjustments or new resource branches continue to materialize.
  if (baseline) {
    const derived = tryDeriveEditableProject(captured, baseline, checked)
    if (derived) { assertPreparationBudget(baseline, derived, options); return derived }
  }
  const project = captureEditableDraft(captured)
  const inputResources = captured.resources
  draftBudgets(project)
  Object.assign(project, validateCompositionDraft(contentOf(project)))
  const added = new Map<string, Uint8Array>(), originalResources = project.resources
  for (const variant of listRequiredVariants(contentOf(project))) {
    checkCancelled(checked.signal)
    const existing = project.appearance.variants[variant.id]
    if (existing) {
      if (canonicalJson(existing) !== canonicalJson(variant)) throw new Error('固定派生变体ID已被不同参数占用。')
      continue
    }
    const sourceAsset = project.document.assets[variant.sourceAssetId], source = sourceAsset && project.assets[sourceAsset.sha256]
    if (!sourceAsset || !source) throw new Error('派生位图缺少固定源字节。')
    const sourceBytes = added.get(source.sha256) ?? await originalResources.read(source.sha256)
    const output = await deriveBitmapVariant(sourceBytes, source, { tint: variant.tint, brightness: variant.brightness }, checked)
    const adopted = { ...structuredClone(sourceAsset), id: variant.outputAssetId, sha256: output.record.sha256, mimeType: output.record.mimeType,
      pixelWidth: output.record.pixelWidth, pixelHeight: output.record.pixelHeight }
    const prior = project.document.assets[variant.outputAssetId]
    if (prior && canonicalJson(prior) !== canonicalJson(adopted)) throw new Error('固定派生资产ID已被不同内容占用。')
    project.document.assets[variant.outputAssetId] = adopted
    project.assets[output.record.sha256] = output.record
    added.set(output.record.sha256, output.bytes)
    project.appearance.variants[variant.id] = structuredClone(variant)
    draftBudgets(project)
  }
  const resolved=resolveAppearance(contentOf(project))
  detachChangedOutputs(project.document,resolved.document)
  pauseChangedCompositions(project.document,resolved.document)
  pauseChangedCompositionAppearance(contentOf(project),resolved)
  Object.assign(project, certifyCompositionContent(resolved))
  if(baseline) assertPreparationBudget(baseline,project,options)
  inheritMissingBindings(project)
  project.resources = Object.freeze({ read: async (hash: string) => added.get(hash)?.slice() ?? originalResources.read(hash) })
  // A composition-only edit on an already certified project cannot change the
  // resource/license closure. Reattach those exact immutable branches and let
  // the private derivation certificate avoid re-reading/decoding every image.
  // Any changed closure branch (imports, new variants, or inherited bindings)
  // deliberately falls back to the complete validator below.
  if (baseline && added.size === 0
    && inputResources === baseline.resources
    && canonicalJson(project.assets) === canonicalJson(baseline.assets)
    && canonicalJson(project.licenses) === canonicalJson(baseline.licenses)
    && canonicalJson(project.licenseBindings) === canonicalJson(baseline.licenseBindings)
    && canonicalJson(project.authoringSources) === canonicalJson(baseline.authoringSources)) {
    const derived = tryDeriveEditableProject({ ...project, assets: baseline.assets, licenses: baseline.licenses,
      licenseBindings: baseline.licenseBindings, authoringSources: baseline.authoringSources, resources: baseline.resources }, baseline, checked)
    if (derived) return derived
  }
  return validateEditableProject(project, checked)
}

/** Preparation changes no current revision; runtime identity is allocated here once. */
export async function prepareCompositionCommands(input: EditableProject, commands: readonly CompositionCommand[], options: PrepareOptions): Promise<EditableProject> {
  const checked = validation(options)
  checkCancelled(checked.signal)
  const capturedCommands = captureJson(commands)
  // Workspace-owned projects carry the validator's exact immutable byte closure.
  // Reuse that certificate for the read-only input side; the materialization
  // below still clones, derives, and fully validates the candidate before it is
  // returned. External or cloned wrappers take the public validation path.
  const project = getVerifiedEditableProject(input) ?? await validateEditableProject(input, checked)
  checkCancelled(checked.signal)
  const accounting = options.initialOperationCost !== undefined || options.onOperationCost !== undefined
  const initialCost = options.initialOperationCost === undefined ? 0 : options.initialOperationCost
  let operationCost = initialCost
  const tracesStructure = capturedCommands.some(command => command.type === 'deleteRoom' || command.type === 'deleteWall' || command.type === 'repairBuildingTopology')
  let previousStructure = tracesStructure ? structureTopology(project.document) : undefined
  const invalidatedStructures = new Set<string>()
  const onSceneDraft = tracesStructure ? (draft: Readonly<SceneDocument>) => {
    const next = structureTopology(draft as SceneDocument)
    for (const id of new Set([...previousStructure!.keys(), ...next.keys()])) {
      if (previousStructure!.get(id) !== next.get(id)) invalidatedStructures.add(id)
    }
    previousStructure = next
    options.onStructureInvalidations?.([...invalidatedStructures])
  } : undefined
  const draft = applyCompositionDraftCommands(contentOf(project), capturedCommands, options.runtime,
    accounting || options.budget || onSceneDraft ? { initialOperationCost: initialCost, budget: options.budget,
      onOperationCost: cost => { operationCost = cost }, ...(onSceneDraft ? { onSceneDraft } : {}) } : undefined)
  const prepared = await materializeProject({ ...project, ...draft, schemaVersion: draft.document.schemaVersion }, { ...options, baseline: project })
  if (accounting) {
    checkCancelled(checked.signal)
    const materializedCost = terrainCommandCost(project.document, prepared.document, { before: project, after: prepared }).total
    const total = initialCost + Math.max(operationCost - initialCost, materializedCost)
    if (!options.budget && total > 256) throw new Error('固定源与完整命令累计展开超过256条操作预算。')
    if (options.budget) assertPreparationBudget(project, prepared, options)
    options.onOperationCost?.(total)
  }
  return prepared
}

function captureImportRequest(input: AssetImportRequest): AssetImportRequest {
  const required = ['file', 'name', 'kind', 'widthMm', 'heightMm', 'licenseText', 'attribution', 'canEmbed'], optional = ['footprintWidthMm', 'footprintHeightMm', 'blocksMovement', 'blocksSight', 'tags', 'rootAnchorMm']
  if (!input || typeof input !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) throw new Error('素材导入参数必须是普通对象。')
  const fields = Object.getOwnPropertyDescriptors(input)
  if (!required.every(key => fields[key]?.enumerable && 'value' in fields[key]) || Reflect.ownKeys(input).some(key => typeof key !== 'string' || !required.includes(key) && !optional.includes(key) || !fields[key].enumerable || !('value' in fields[key]))) throw new Error('素材导入字段缺失、未知或含访问器。')
  const file = fields.file.value
  if (!(file instanceof Blob)) throw new Error('素材导入必须提供实际图片文件。')
  const { file: _file, ...json } = Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, value.value]))
  const size = Object.getOwnPropertyDescriptor(Blob.prototype, 'size')!.get!.call(file) as number
  const mime = Object.getOwnPropertyDescriptor(Blob.prototype, 'type')!.get!.call(file) as string
  const captured = { ...captureJson(json), file: Blob.prototype.slice.call(file, 0, size, mime) } as AssetImportRequest
  if (captured.kind !== 'prop' && captured.kind !== 'material' || typeof captured.name !== 'string' || !captured.name.trim() || Array.from(captured.name).length > 120
    || captured.canEmbed !== true || typeof captured.attribution !== 'string' || !captured.attribution.trim() || Array.from(captured.attribution).length > 500) throw new Error('导入须提供类型、名称、来源署名与允许嵌入声明。')
  for (const size of [captured.widthMm, captured.heightMm, captured.footprintWidthMm ?? captured.widthMm, captured.footprintHeightMm ?? captured.heightMm]) if (!Number.isSafeInteger(size) || size <= 0 || size > 1_000_000) throw new Error('图片及占地尺寸须为正整数毫米。')
  if (captured.kind === 'prop' && (captured.footprintWidthMm === undefined || captured.footprintHeightMm === undefined)) throw new Error('物件必须明确填写实际占地宽高。')
  for (const flag of [captured.blocksMovement, captured.blocksSight]) if (flag !== undefined && typeof flag !== 'boolean') throw new Error('通行及视线参数必须为布尔值。')
  if (captured.tags !== undefined && (!Array.isArray(captured.tags) || captured.tags.length > 50 || captured.tags.some(tag => typeof tag !== 'string' || !tag.trim() || Array.from(tag).length > 80) || new Set(captured.tags).size !== captured.tags.length)) throw new Error('素材标签无效。')
  if (typeof captured.licenseText !== 'string' || !captured.licenseText.trim() || encodeUtf8(captured.licenseText).length > PROJECT_DATA_LIMITS.licenseBytes || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(captured.licenseText)) throw new Error('必须提供有效的完整许可文本。')
  if (captured.rootAnchorMm !== undefined && (!captured.rootAnchorMm || captured.kind !== 'prop' || !Number.isSafeInteger(captured.rootAnchorMm.x) || !Number.isSafeInteger(captured.rootAnchorMm.y)
    || captured.rootAnchorMm.x < 0 || captured.rootAnchorMm.y < 0 || captured.rootAnchorMm.x > captured.widthMm || captured.rootAnchorMm.y > captured.heightMm
    || Object.keys(captured.rootAnchorMm).length !== 2 || !Object.hasOwn(captured.rootAnchorMm, 'x') || !Object.hasOwn(captured.rootAnchorMm, 'y'))) throw new Error('物件根锚须为图像内明确的整数毫米坐标。')
  return captured
}

export const ASSET_BATCH_PREPARATION_LIMITS = Object.freeze({ items: 64, fileBytes: 20 * 1024 * 1024,
  inputBytes: 64 * 1024 * 1024, outputBytes: 128 * 1024 * 1024, decodedPixels: 64_000_000, svgLongEdgePx: 512 })
export class AssetBatchImportError extends Error {
  readonly itemIndex: number
  readonly assetName: string
  constructor(itemIndex: number, assetName: string, detail: string) {
    super(`第${itemIndex + 1}项素材“${assetName}”未通过，整批未采用：${detail}`)
    this.name = 'AssetBatchImportError'; this.itemIndex = itemIndex; this.assetName = assetName
  }
}
export interface AssetBatchImportItem {
  index: number
  assetId: string
  definitionId: string
  kind: AssetImportRequest['kind']
  sourceKind: 'raster' | 'svg'
  pixelWidth: number
  pixelHeight: number
  sha256: string
  sizeBytes: number
  reusedResource: boolean
  duplicateOf: number | null
}
export interface AssetBatchImportResult {
  project: EditableProject
  items: readonly AssetBatchImportItem[]
  addedDefinitionIds: readonly string[]
  addedAssetIds: readonly string[]
  uniqueImageBytes: number
  decodedPixels: number
  reusedResourceCount: number
  operationCost: number
}

/** Own all request data and Blob handles before the first asynchronous boundary. */
function captureImportBatch(input: readonly AssetImportRequest[]): AssetImportRequest[] {
  if (!Array.isArray(input) || Object.getPrototypeOf(input) !== Array.prototype) throw new Error('素材批次须为明确数组。')
  const fields = Object.getOwnPropertyDescriptors(input), length = (fields as unknown as { length: PropertyDescriptor }).length.value as number
  if (!Number.isSafeInteger(length) || length < 1 || length > ASSET_BATCH_PREPARATION_LIMITS.items
    || Reflect.ownKeys(input).length !== length + 1) throw new Error('一次须明确选中1至64项素材，不支持空洞或额外字段。')
  const captured: AssetImportRequest[] = []; let bytes = 0
  for (let i = 0; i < length; i++) {
    const field = fields[String(i)]
    if (!field?.enumerable || !('value' in field)) throw new Error('素材批次不能含访问器、隐藏项或空洞。')
    let request: AssetImportRequest
    try { request = captureImportRequest(field.value) }
    catch (error) { throw new AssetBatchImportError(i, '所选素材', error instanceof Error ? error.message : String(error)) }
    if (request.file.size < 1 || request.file.size > ASSET_BATCH_PREPARATION_LIMITS.fileBytes) throw new AssetBatchImportError(i, request.name, '单项素材须非空且不超过20MiB。')
    bytes += request.file.size
    if (bytes > ASSET_BATCH_PREPARATION_LIMITS.inputBytes) throw new AssetBatchImportError(i, request.name, '选中原文件累计超过64MiB。')
    captured.push(request)
  }
  return captured
}

interface ImportImage { record: AssetRecord; bytes: Uint8Array; source?: SvgAuthoringSource; sourceBytes?: Map<string, Uint8Array> }
function looksLikeSvg(bytes: Uint8Array, mime: string): boolean {
  if (mime.toLowerCase().split(';')[0].trim() === 'image/svg+xml') return true
  // SVG never reaches an image decoder before strict parsing, even if it was
  // given a raster filename or a generic MIME type.
  let index = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0
  while (index < bytes.length && [9, 10, 13, 32].includes(bytes[index])) index++
  return bytes[index] === 60
}

async function prepareImportImage(bytes: Uint8Array, mime: string, checked: CompleteValidationOptions,
  admitPixels: (pixels: number) => void): Promise<ImportImage> {
  checkCancelled(checked.signal)
  if (!looksLikeSvg(bytes, mime)) {
    const header = inspectImageBytes(bytes, false)
    admitPixels(header.width * header.height)
    return normalizeBrowserImage(bytes, mime, checked)
  }
  if (bytes.length > STATIC_SVG_LIMITS.sourceBytes) throw new Error('SVG原始源超过1MiB。')
  let source: string
  try { source = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes) }
  catch { throw new Error('SVG须为完整有效的UTF-8文本。') }
  const normalized = normalizeStaticSvg(source)
  if (normalized.sourceSha256 !== sha256Bytes(bytes) || normalized.sourceSizeBytes !== bytes.length) throw new Error('SVG原始UTF-8字节不可无损保全。')
  if (!checked.svg) throw new SvgCapabilityError()
  const scale = ASSET_BATCH_PREPARATION_LIMITS.svgLongEdgePx / Math.max(normalized.viewBox.width, normalized.viewBox.height)
  const dimensions = { width: Math.max(1, Math.round(normalized.viewBox.width * scale)), height: Math.max(1, Math.round(normalized.viewBox.height * scale)) }
  admitPixels(dimensions.width * dimensions.height)
  const image = await checked.svg.rasterize(normalized, dimensions, checked)
  checkCancelled(checked.signal)
  if (image.width !== dimensions.width || image.height !== dimensions.height || !(image.rgba instanceof Uint8ClampedArray)
    || image.rgba.length !== dimensions.width * dimensions.height * 4) throw new Error('SVG实际像素与固定输出尺寸不符。')
  const png = normalizePngChunks(await checked.images.encodePng(image, checked))
  checkCancelled(checked.signal)
  const header = inspectImageBytes(png)
  if (header.mimeType !== 'image/png' || header.width !== dimensions.width || header.height !== dimensions.height) throw new Error('SVG规范PNG尺寸无效。')
  const hash = sha256Bytes(png)
  return { bytes: png, record: { sha256: hash, mimeType: 'image/png', sizeBytes: png.length, pixelWidth: header.width, pixelHeight: header.height },
    source: { kind: 'svg', sourceSha256: normalized.sourceSha256, normalizedSha256: normalized.normalizedSha256,
      sourceSizeBytes: normalized.sourceSizeBytes, normalizedSizeBytes: normalized.normalizedSizeBytes, rasterSha256: hash,
      processorId: normalized.processorId, processorVersion: normalized.processorVersion },
    sourceBytes: new Map([[normalized.sourceSha256, encodeUtf8(normalized.sourceSvg)], [normalized.normalizedSha256, encodeUtf8(normalized.normalizedSource)]]) }
}

/** A selected batch is one isolated candidate. Any failure discards every new
 * definition/resource in this call; the workspace performs its usual CAS once. */
export async function prepareAssetBatchImport(input: EditableProject, requests: readonly AssetImportRequest[], options: PrepareOptions): Promise<AssetBatchImportResult> {
  const captured = captureImportBatch(requests), checked = validation(options)
  checkCancelled(checked.signal)
  const original = await validateEditableProject(input, checked), project = captureEditableDraft(original)
  checkCancelled(checked.signal)
  const originalResources = project.resources, added = new Map<string, Uint8Array>(), items: AssetBatchImportItem[] = []
  const originalImageHashes = new Set(Object.keys(project.assets)), newImageHashes = new Set<string>(), fingerprints = new Map<string, AssetBatchImportItem>()
  const addedDefinitionIds: string[] = [], addedAssetIds: string[] = []
  let decodedPixels = 0, outputBytes = 0, uniqueImageBytes = 0
  const admitPixels = (pixels: number) => {
    if (!Number.isSafeInteger(pixels) || pixels < 1 || !Number.isSafeInteger(decodedPixels + pixels)
      || decodedPixels + pixels > ASSET_BATCH_PREPARATION_LIMITS.decodedPixels) throw new Error('本批实际解码/栅格化累计超过6400万像素。')
    decodedPixels += pixels
  }
  const addBytes = (hash: string, bytes: Uint8Array) => {
    const previous = added.get(hash)
    if (previous) { if (previous.length !== bytes.length || previous.some((value, i) => value !== bytes[i])) throw new Error('相同资源hash存在不同字节。'); return }
    outputBytes += bytes.length
    if (outputBytes > ASSET_BATCH_PREPARATION_LIMITS.outputBytes) throw new Error('本批规范资源及SVG源累计超过128MiB。')
    added.set(hash, bytes.slice())
  }
  project.resources = Object.freeze({ read: async (hash: string) => added.get(hash)?.slice() ?? originalResources.read(hash) })
  for (const [index, request] of captured.entries()) {
    checkCancelled(checked.signal)
    try {
      const bytes = new Uint8Array(await Blob.prototype.arrayBuffer.call(request.file)), image = await prepareImportImage(bytes, request.file.type, checked, admitPixels)
      checkCancelled(checked.signal)
      const { file: _file, ...metadata } = request
      const fingerprint = canonicalJson({ metadata, sha256: image.record.sha256, source: image.source ?? null })
      const duplicate = fingerprints.get(fingerprint)
      if (duplicate) { items.push({ ...duplicate, index, reusedResource: true, duplicateOf: duplicate.index }); continue }
      const previous = project.assets[image.record.sha256]
      if (previous && canonicalJson(previous) !== canonicalJson(image.record)) throw new Error('同hash规范图片描述冲突。')
      const reusedResource = !!previous
      const licenseHash = sha256Bytes(encodeUtf8(request.licenseText)), licenseRef = `import-license-${licenseHash}`
      const origin = { kind: 'imported' as const, attribution: request.attribution.trim(), canEmbed: true }
      const assetId = `import-image-${options.runtime.ids.nextId()}`, definitionId = `import-${request.kind}-${options.runtime.ids.nextId()}`
      if (Object.hasOwn(project.document.assets, assetId) || Object.hasOwn(project.document.propDefinitions, definitionId) || Object.hasOwn(project.document.materials, definitionId)) throw new Error('新素材ID已存在。')
      project.document.assets[assetId] = { id: assetId, sha256: image.record.sha256, mimeType: image.record.mimeType, pixelWidth: image.record.pixelWidth, pixelHeight: image.record.pixelHeight,
        logicalSizeMm: { width: request.widthMm, height: request.heightMm }, licenseRef, origin }
      project.assets[image.record.sha256] = { ...image.record }; addBytes(image.record.sha256, image.bytes)
      if (!originalImageHashes.has(image.record.sha256) && !newImageHashes.has(image.record.sha256)) { uniqueImageBytes += image.record.sizeBytes; newImageHashes.add(image.record.sha256) }
      if (image.source) { project.authoringSources[assetId] = { ...image.source }; for (const [hash, value] of image.sourceBytes!) addBytes(hash, value) }
      project.licenses[licenseHash] = { sha256: licenseHash, text: request.licenseText }
      const binding = (subjectKind: LicenseBinding['subjectKind'], subjectId: string): LicenseBinding => ({ subjectKind, subjectId, licenseRef, licensePath: `licenses/${licenseHash}.txt`, embedding: 'allowed' })
      project.licenseBindings.push(binding('asset', assetId))
      const base = { id: definitionId, catalogId: definitionId, version: 1, licenseRef, origin, name: request.name.trim(), tags: request.tags ?? [] }
      const sourceId = `import-source-${options.runtime.ids.nextId()}`
      if (Object.hasOwn(project.appearance.sources, sourceId)) throw new Error('新外观源ID已存在。')
      if (request.kind === 'prop') {
        const root = request.rootAnchorMm ?? { x: Math.floor(request.widthMm / 2), y: Math.floor(request.heightMm / 2) }
        const definition = { ...base, defaultAppearance: { kind: 'image' as const, assetId, tint: null, opacity: 1 },
          defaultVisualBoundsMm: { x: -root.x, y: -root.y, width: request.widthMm, height: request.heightMm },
          defaultFootprintMm: { width: request.footprintWidthMm!, height: request.footprintHeightMm! }, defaultFootprintOffsetMm: { x: 0, y: 0 },
          defaultBlocksMovement: request.blocksMovement ?? false, defaultBlocksSight: request.blocksSight ?? false, defaultRenderLayer: 'object' as const, defaultShadowClass: 'furniture' as const }
        project.document.propDefinitions[definitionId] = definition
        project.licenseBindings.push(binding('propDefinition', definitionId))
        project.appearance.sources[sourceId] = { id: sourceId, kind: 'prop', parentSourceId: null, snapshot: {
          definitionRef: { id: definitionId, version: 1 }, appearance: structuredClone(definition.defaultAppearance), visualBoundsMm: structuredClone(definition.defaultVisualBoundsMm), shadowClass: definition.defaultShadowClass, shadowOverride: null } }
        project.appearance.presentations![sourceId] = topDownPresentation()
      } else {
        project.document.materials[definitionId] = { ...base, textureAssetId: assetId, defaultTileSizeMm: { width: request.widthMm, height: request.heightMm }, applicableSurfaces: ['room', 'wall', 'terrain', 'path'] }
        project.licenseBindings.push(binding('material', definitionId))
        project.appearance.sources[sourceId] = { id: sourceId, kind: 'surface', parentSourceId: null, snapshot: { base: { materialRef: { id: definitionId, version: 1 }, tileSizeMm: { width: request.widthMm, height: request.heightMm }, rotationDeg: 0,
          alignment: 'world', originMm: { x: 0, y: 0 }, tint: null, opacity: 1 }, overlays: [] } }
      }
      const records = Object.values(project.assets)
      if (records.length > PROJECT_DATA_LIMITS.images || records.reduce((sum, row) => sum + row.pixelWidth * row.pixelHeight, 0) > PROJECT_DATA_LIMITS.totalImagePixels
        || Object.keys(project.authoringSources).length > PROJECT_DATA_LIMITS.images) throw new Error('完整候选图片、来源数量或累计像素超限。')
      const resourceBytes = [...projectResourceRecords(project).values()].reduce((sum, value) => sum + value, 0)
      if (resourceBytes > PROJECT_DATA_LIMITS.expandedBytes) throw new Error('完整候选资源累计超过展开保护。')
      const item: AssetBatchImportItem = { index, assetId, definitionId, kind: request.kind, sourceKind: image.source ? 'svg' : 'raster', pixelWidth: image.record.pixelWidth, pixelHeight: image.record.pixelHeight,
        sha256: image.record.sha256, sizeBytes: image.record.sizeBytes, reusedResource, duplicateOf: null }
      items.push(item); fingerprints.set(fingerprint, item); addedDefinitionIds.push(definitionId); addedAssetIds.push(assetId)
    } catch (error) {
      checkCancelled(checked.signal)
      throw new AssetBatchImportError(index, request.name, error instanceof Error ? error.message : String(error))
    }
  }
  Object.assign(project, syncAppearanceGraph(contentOf(project)))
  draftBudgets(project)
  const complete = await materializeProject(project, options)
  checkCancelled(checked.signal)
  const operationCost = catalogAdditionCost(original, complete)
  if (operationCost > CATALOG_ADOPTION_LIMIT) throw new Error(`本批固定素材实际新增记录与展开成本${operationCost}超过${CATALOG_ADOPTION_LIMIT}；整批未采用，请减少选择，不会自动拆批。`)
  return { project: complete, items: freezeJson(items), addedDefinitionIds: freezeJson(addedDefinitionIds), addedAssetIds: freezeJson(addedAssetIds),
    uniqueImageBytes, decodedPixels, reusedResourceCount: items.filter(item => item.reusedResource).length, operationCost }
}

export async function prepareAssetImport(input: EditableProject, request: AssetImportRequest, options: PrepareOptions): Promise<EditableProject> {
  return (await prepareAssetBatchImport(input, [request], options)).project
}

export const listEditableCatalogItems = (input: EditableProject) => listCatalogItems(toBundle(input))
export const prepareCatalogEntry = (input: EditableProject, selector: CatalogSelector, options: PrepareOptions) => prepareLibraryEntry(toBundle(input), selector, validation(options))
export async function prepareCatalogAdoption(input: EditableProject, entries: PreparedLibraryEntry[], options: PrepareOptions) {
  const adopted = await adoptLibraryEntries(toBundle(input), entries, validation(options))
  return { project: await fromBundle(adopted.bundle, validation(options)), addedDefinitionIds: adopted.addedDefinitionIds, operationCost: adopted.operationCost }
}

export type { AssetRecord }
