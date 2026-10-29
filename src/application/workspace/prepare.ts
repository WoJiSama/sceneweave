import { detachChangedOutputs } from '../../shared/terrain-generation/integrity.js'
import { pauseChangedCompositionAppearance, pauseChangedCompositions } from '../../shared/terrain-generation/composition-lifecycle.js'
import { detachChangedAppearance } from '../../shared/terrain-generation/appearance-lifecycle.js'
import { assertTerrainBudget, terrainCommandCost } from '../../shared/terrain-generation/cost.js'
import { applyCompositionDraftCommands } from '../../shared/appearance/commands.js'
import { listRequiredVariants, resolveAppearance, syncAppearanceGraph } from '../../shared/appearance/graph.js'
import { certifyCompositionContent, validateCompositionDraft } from '../../shared/validation/content.js'
import type { CompositionCommand, CompositionContent } from '../../shared/model/appearance.js'
import type { AssetRecord, LicenseBinding, LicenseSubjectKind } from '../../shared/model/project.js'
import type { CompleteValidationOptions, CancellationSignal } from '../../shared/ports/resources.js'
import { checkCancelled } from '../../shared/ports/resources.js'
import type { PreparationContext } from '../../shared/ports/runtime.js'
import { createMemoryResources, deriveBitmapVariant } from '../../shared/project/resources.js'
import { sha256Bytes } from '../../shared/project/binary.js'
import { PROJECT_DATA_LIMITS } from '../../shared/project/validate.js'
import { canonicalJson, captureJson, encodeUtf8, inspectJsonInput } from '../../shared/validation/json.js'
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
  /** Internal accounting for fixed sources added in this same transaction. */
  initialOperationCost?: number
  onOperationCost?: (cost: number) => void
}
export interface AssetImportRequest {
  file: Blob
  name: string
  kind: 'prop' | 'material'
  widthMm: number
  heightMm: number
  footprintWidthMm?: number
  footprintHeightMm?: number
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

/** Real bitmap materialization and complete validation precede candidate adoption. */
export async function materializeProject(input: EditableProject, options: PrepareOptions): Promise<EditableProject> {
  const checked = validation(options)
  checkCancelled(checked.signal)
  const baseline = getVerifiedEditableProject(options.baseline ?? input)
  let captured = captureEditableInput(input)
  if (baseline?.document.schemaVersion === 4 && captured.document.schemaVersion === 4) {
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
    if (derived) { if (baseline.document.schemaVersion >= 3) assertTerrainBudget(baseline.document, derived.document, { before: baseline, after: derived }); return derived }
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
  if(project.document.schemaVersion>=3) {
    detachChangedOutputs(project.document,resolved.document)
    pauseChangedCompositions(project.document,resolved.document)
    pauseChangedCompositionAppearance(contentOf(project),resolved)
  }
  Object.assign(project, certifyCompositionContent(resolved))
  if(baseline && project.document.schemaVersion>=3) assertTerrainBudget(baseline.document,project.document,{before:baseline,after:project})
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
  const draft = applyCompositionDraftCommands(contentOf(project), capturedCommands, options.runtime,
    accounting ? { initialOperationCost: initialCost, onOperationCost: cost => { operationCost = cost } } : undefined)
  const prepared = await materializeProject({ ...project, ...draft, schemaVersion: draft.document.schemaVersion }, { ...options, baseline: project })
  if (accounting) {
    checkCancelled(checked.signal)
    const materializedCost = terrainCommandCost(project.document, prepared.document, { before: project, after: prepared }).total
    const total = initialCost + Math.max(operationCost - initialCost, materializedCost)
    if (total > 256) throw new Error('固定源与完整命令累计展开超过256条操作预算。')
    options.onOperationCost?.(total)
  }
  return prepared
}

function captureImportRequest(input: AssetImportRequest): AssetImportRequest {
  const required = ['file', 'name', 'kind', 'widthMm', 'heightMm', 'licenseText', 'attribution', 'canEmbed'], optional = ['footprintWidthMm', 'footprintHeightMm', 'blocksMovement', 'blocksSight', 'tags']
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
  return captured
}

export async function prepareAssetImport(input: EditableProject, request: AssetImportRequest, options: PrepareOptions): Promise<EditableProject> {
  const captured = captureImportRequest(request), checked = validation(options)
  checkCancelled(checked.signal)
  const project = captureEditableDraft(await validateEditableProject(input, checked))
  const image = await normalizeBrowserImage(new Uint8Array(await captured.file.arrayBuffer()), captured.file.type, checked)
  const licenseHash = sha256Bytes(encodeUtf8(captured.licenseText)), licenseRef = `import-license-${licenseHash}`
  const origin = { kind: 'imported' as const, attribution: captured.attribution.trim(), canEmbed: true }
  const assetId = `import-image-${options.runtime.ids.nextId()}`, definitionId = `import-${captured.kind}-${options.runtime.ids.nextId()}`
  if (Object.hasOwn(project.document.assets, assetId) || Object.hasOwn(project.document.propDefinitions, definitionId) || Object.hasOwn(project.document.materials, definitionId)) throw new Error('新素材ID已存在。')
  project.document.assets[assetId] = { id: assetId, sha256: image.record.sha256, mimeType: image.record.mimeType, pixelWidth: image.record.pixelWidth, pixelHeight: image.record.pixelHeight,
    logicalSizeMm: { width: captured.widthMm, height: captured.heightMm }, licenseRef, origin }
  project.assets[image.record.sha256] = image.record
  const originalResources = project.resources, added = createMemoryResources({ [image.record.sha256]: image.bytes })
  project.resources = Object.freeze({ read: (hash: string) => hash === image.record.sha256 ? added.read(hash) : originalResources.read(hash) })
  project.licenses[licenseHash] = { sha256: licenseHash, text: captured.licenseText }
  const binding = (subjectKind: LicenseBinding['subjectKind'], subjectId: string): LicenseBinding => ({ subjectKind, subjectId, licenseRef, licensePath: `licenses/${licenseHash}.txt`, embedding: 'allowed' })
  project.licenseBindings.push(binding('asset', assetId))
  const base = { id: definitionId, catalogId: definitionId, version: 1, licenseRef, origin, name: captured.name.trim(), tags: captured.tags ?? [] }
  const sourceId = `import-source-${options.runtime.ids.nextId()}`
  if (Object.hasOwn(project.appearance.sources, sourceId)) throw new Error('新外观源ID已存在。')
  if (captured.kind === 'prop') {
    project.document.propDefinitions[definitionId] = { ...base, defaultAppearance: { kind: 'image', assetId, tint: null, opacity: 1 },
      defaultVisualBoundsMm: { x: -Math.floor(captured.widthMm / 2), y: -Math.floor(captured.heightMm / 2), width: captured.widthMm, height: captured.heightMm },
      defaultFootprintMm: { width: captured.footprintWidthMm!, height: captured.footprintHeightMm! }, defaultFootprintOffsetMm: { x: 0, y: 0 },
      defaultBlocksMovement: captured.blocksMovement ?? false, defaultBlocksSight: captured.blocksSight ?? false, defaultRenderLayer: 'object', defaultShadowClass: 'furniture' }
    project.licenseBindings.push(binding('propDefinition', definitionId))
    const definition = project.document.propDefinitions[definitionId]
    project.appearance.sources[sourceId] = { id: sourceId, kind: 'prop', parentSourceId: null, snapshot: {
      definitionRef: { id: definitionId, version: 1 }, appearance: structuredClone(definition.defaultAppearance), visualBoundsMm: structuredClone(definition.defaultVisualBoundsMm), shadowClass: definition.defaultShadowClass, shadowOverride: null } }
  } else {
    project.document.materials[definitionId] = { ...base, textureAssetId: assetId, defaultTileSizeMm: { width: captured.widthMm, height: captured.heightMm }, applicableSurfaces: ['room', 'wall', 'terrain', 'path'] }
    project.licenseBindings.push(binding('material', definitionId))
    project.appearance.sources[sourceId] = { id: sourceId, kind: 'surface', parentSourceId: null, snapshot: { base: { materialRef: { id: definitionId, version: 1 }, tileSizeMm: { width: captured.widthMm, height: captured.heightMm }, rotationDeg: 0,
      alignment: 'world', originMm: { x: 0, y: 0 }, tint: null, opacity: 1 }, overlays: [] } }
  }
  Object.assign(project, syncAppearanceGraph(contentOf(project)))
  return materializeProject(project, options)
}

export const listEditableCatalogItems = (input: EditableProject) => listCatalogItems(toBundle(input))
export const prepareCatalogEntry = (input: EditableProject, selector: CatalogSelector, options: PrepareOptions) => prepareLibraryEntry(toBundle(input), selector, validation(options))
export async function prepareCatalogAdoption(input: EditableProject, entries: PreparedLibraryEntry[], options: PrepareOptions) {
  const adopted = await adoptLibraryEntries(toBundle(input), entries, validation(options))
  return { project: await fromBundle(adopted.bundle, validation(options)), addedDefinitionIds: adopted.addedDefinitionIds, operationCost: adopted.operationCost }
}

export type { AssetRecord }
