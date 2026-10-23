import { applyCompositionCommandsV6 } from '../../core/v6/commands'
import { listRequiredVariantsV6, resolveAppearanceV6, syncAppearanceGraphV6 } from '../../core/v6/graph'
import { certifyCompositionContentV6, validateCompositionDraftV6 } from '../../core/v6/schema'
import type { CompositionCommandV6, CompositionContentV6 } from '../../core/v6/types'
import type { LicenseSubjectKind } from '../v3/types'
import { parseBoundedJson, utf8Decoder, utf8Encoder } from '../v3/json'
import { checkCancelled, failV6, hasExactKeys, PROJECT_LIMITS_V6 } from './limits'
import { canonicalJsonV6, captureCompleteProjectV6, captureValidatedProjectV6, validateCompleteProjectV6 } from './project-file'
import { deriveBitmapVariantV6, normalizeImageAsset, sha256Bytes } from './resources'
import type { AssetImportRequestV6, CompleteProjectV6, LicenseBinding } from './types'

const contentOf = (project: CompleteProjectV6): CompositionContentV6 => ({ document: project.document, historyIdentity: project.historyIdentity, appearance: project.appearance })
const collections = { asset: 'assets', material: 'materials', propDefinition: 'propDefinitions', prefabDefinition: 'prefabDefinitions', styleTheme: 'styleThemes' } as const

/** New derived subjects inherit only one already proven license binding; ambiguity is an error. */
function inheritMissingBindings(project: CompleteProjectV6): void {
  for (const [kind, collection] of Object.entries(collections) as [LicenseSubjectKind, typeof collections[LicenseSubjectKind]][]) {
    for (const subject of Object.values(project.document[collection])) {
      if (project.licenseBindings.some(binding => binding.subjectKind === kind && binding.subjectId === subject.id)) continue
      const matches = project.licenseBindings.filter(binding => binding.licenseRef === subject.licenseRef && binding.embedding === 'allowed')
      if (!matches.length || new Set(matches.map(binding => binding.licensePath)).size !== 1) failV6(`新采用对象${subject.id}缺少唯一许可来源，不能自动补许可。`)
      project.licenseBindings.push({ ...matches[0], subjectKind: kind, subjectId: subject.id })
    }
  }
}

function draftBudgets(project: CompleteProjectV6): void {
  if (!hasExactKeys(project, ['document', 'historyIdentity', 'appearance', 'assets', 'licenses', 'licenseBindings'], ['migrationSource'])) failV6('完整候选字段缺失或未知。')
  const budget = { values: 0 }
  for (const value of [project.document, project.historyIdentity, project.appearance]) {
    const bytes = utf8Encoder.encode(JSON.stringify(value))
    if (bytes.length > PROJECT_LIMITS_V6.sceneBytes) failV6('候选文档、身份或外观图超过单件预算。')
    parseBoundedJson(bytes, budget)
  }
  const assets = Object.values(project.assets)
  if (assets.length > PROJECT_LIMITS_V6.uniqueImages || assets.reduce((sum, record) => sum + record.pixelWidth * record.pixelHeight, 0) > PROJECT_LIMITS_V6.totalImagePixels) failV6('候选位图数量或累计像素超过保护值。')
}

/** Drafts are never installed. Every missing parameter bitmap is materialized before strict validation. */
export async function materializeProjectV6(input: CompleteProjectV6, options: { signal?: AbortSignal } = {}): Promise<CompleteProjectV6> {
  checkCancelled(options.signal)
  // Content must be mutable while resolving; validated resource/original closures
  // remain shared until an actual addition needs a new closure.
  const project = captureCompleteProjectV6(input)
  Object.assign(project, structuredClone(contentOf(project)))
  let writableResources = false
  const writeResources = () => {
    if (writableResources) return
    project.assets = { ...project.assets }; project.licenses = { ...project.licenses }; project.licenseBindings = [...project.licenseBindings]
    writableResources = true
  }
  draftBudgets(project)
  Object.assign(project, validateCompositionDraftV6(contentOf(project)))
  for (const variant of listRequiredVariantsV6(contentOf(project))) {
    checkCancelled(options.signal)
    const existing = project.appearance.variants[variant.id]
    if (existing) {
      if (canonicalJsonV6(existing) !== canonicalJsonV6(variant)) failV6('固定派生变体ID已被不同参数占用。')
      continue
    }
    const sourceAsset = project.document.assets[variant.sourceAssetId], source = sourceAsset && project.assets[sourceAsset.sha256]
    if (!sourceAsset || !source) failV6('派生位图缺少固定源字节，不能采用占位图。')
    const output = await deriveBitmapVariantV6(source, variant, options)
    const adopted = { ...structuredClone(sourceAsset), id: variant.outputAssetId, sha256: output.sha256, mimeType: output.mimeType,
      pixelWidth: output.pixelWidth, pixelHeight: output.pixelHeight }
    const prior = project.document.assets[variant.outputAssetId]
    if (prior && canonicalJsonV6(prior) !== canonicalJsonV6(adopted)) failV6('固定派生资产ID已被不同内容占用。')
    project.document.assets[variant.outputAssetId] = adopted
    writeResources()
    project.assets[output.sha256] = output
    project.appearance.variants[variant.id] = structuredClone(variant)
    draftBudgets(project)
  }
  const resolved = resolveAppearanceV6(contentOf(project))
  Object.assign(project, certifyCompositionContentV6(resolved))
  if (Object.entries(collections).some(([kind, collection]) => Object.values(project.document[collection]).some(subject =>
    !project.licenseBindings.some(binding => binding.subjectKind === kind && binding.subjectId === subject.id)))) {
    writeResources()
    inheritMissingBindings(project)
  }
  const validated = await captureValidatedProjectV6(project, options)
  checkCancelled(options.signal)
  return validated
}

/** Revision belongs to Workspace adoption, never asynchronous preparation. */
export async function prepareCompositionCommandsV6(input: CompleteProjectV6, commands: readonly CompositionCommandV6[], options: { signal?: AbortSignal } = {}): Promise<CompleteProjectV6> {
  const capturedCommands = structuredClone(commands), project = await captureValidatedProjectV6(input, options)
  checkCancelled(options.signal)
  const draft = applyCompositionCommandsV6(contentOf(project), capturedCommands)
  return materializeProjectV6({ ...project, ...draft }, options)
}

function validateImportRequest(input: AssetImportRequestV6): void {
  if (!hasExactKeys(input, ['file', 'name', 'kind', 'widthMm', 'heightMm', 'licenseText', 'attribution', 'canEmbed'],
    ['footprintWidthMm', 'footprintHeightMm', 'blocksMovement', 'blocksSight', 'tags']) || !(input.file instanceof Blob)
    || input.kind !== 'prop' && input.kind !== 'material' || typeof input.name !== 'string' || !input.name.trim() || Array.from(input.name).length > 120
    || input.canEmbed !== true || typeof input.attribution !== 'string' || !input.attribution.trim() || Array.from(input.attribution).length > 500) failV6('导入须提供素材类型、名称、明确来源署名与允许嵌入声明。')
  for (const size of [input.widthMm, input.heightMm, input.footprintWidthMm ?? input.widthMm, input.footprintHeightMm ?? input.heightMm]) {
    if (!Number.isSafeInteger(size) || size <= 0 || size > 1_000_000) failV6('图片和占地尺寸须为明确的正整数毫米，不能由像素或AI推断。')
  }
  if (input.kind === 'prop' && (input.footprintWidthMm === undefined || input.footprintHeightMm === undefined)) failV6('物件导入必须明确填写实际占地宽高。')
  for (const flag of [input.blocksMovement, input.blocksSight]) if (flag !== undefined && typeof flag !== 'boolean') failV6('通行/视线参数必须为布尔值。')
  if (input.tags !== undefined && (!Array.isArray(input.tags) || input.tags.length > 50 || input.tags.some(tag => typeof tag !== 'string' || !tag.trim() || Array.from(tag).length > 80) || new Set(input.tags).size !== input.tags.length)) failV6('素材标签数量、内容或唯一性无效。')
  if (typeof input.licenseText !== 'string' || !input.licenseText.trim()) failV6('导入必须提供完整许可文本。')
  const bytes = utf8Encoder.encode(input.licenseText)
  if (bytes.length > PROJECT_LIMITS_V6.licenseBytes || utf8Decoder.decode(bytes) !== input.licenseText || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(input.licenseText)) failV6('许可文本编码、控制字符或大小无效。')
}

/** Normalization strips metadata and adopts fixed definitions; it never changes existing scene instances. */
export async function prepareAssetImportV6(input: CompleteProjectV6, request: AssetImportRequestV6, options: { signal?: AbortSignal } = {}): Promise<CompleteProjectV6> {
  checkCancelled(options.signal)
  const project = structuredClone(input), captured = structuredClone(request)
  validateImportRequest(captured)
  await validateCompleteProjectV6(project, options)
  const image = await normalizeImageAsset(captured.file, options)
  const licenseHash = await sha256Bytes(utf8Encoder.encode(captured.licenseText)), licenseRef = `import-license-${licenseHash}`
  const origin = { kind: 'imported' as const, attribution: captured.attribution.trim(), canEmbed: true }
  const assetId = `import-image-${crypto.randomUUID()}`, definitionId = `import-${captured.kind}-${crypto.randomUUID()}`
  project.document.assets[assetId] = { id: assetId, sha256: image.sha256, mimeType: image.mimeType, pixelWidth: image.pixelWidth, pixelHeight: image.pixelHeight,
    logicalSizeMm: { width: captured.widthMm, height: captured.heightMm }, licenseRef, origin }
  project.assets[image.sha256] = image
  project.licenses[licenseHash] = { sha256: licenseHash, text: captured.licenseText }
  const binding = (subjectKind: LicenseBinding['subjectKind'], subjectId: string): LicenseBinding => ({ subjectKind, subjectId, licenseRef, licensePath: `licenses/${licenseHash}.txt`, embedding: 'allowed' })
  project.licenseBindings.push(binding('asset', assetId))
  const base = { id: definitionId, catalogId: definitionId, version: 1, licenseRef, origin, name: captured.name.trim(), tags: captured.tags ?? [] }
  if (captured.kind === 'prop') {
    project.document.propDefinitions[definitionId] = { ...base, defaultAppearance: { kind: 'image', assetId, tint: null, opacity: 1 },
      defaultVisualBoundsMm: { x: -Math.floor(captured.widthMm / 2), y: -Math.floor(captured.heightMm / 2), width: captured.widthMm, height: captured.heightMm },
      defaultFootprintMm: { width: captured.footprintWidthMm!, height: captured.footprintHeightMm! }, defaultFootprintOffsetMm: { x: 0, y: 0 },
      defaultBlocksMovement: captured.blocksMovement ?? false, defaultBlocksSight: captured.blocksSight ?? false, defaultRenderLayer: 'object', defaultShadowClass: 'furniture' }
    project.licenseBindings.push(binding('propDefinition', definitionId))
    const definition = project.document.propDefinitions[definitionId], sourceId = `import-source-${crypto.randomUUID()}`
    project.appearance.sources[sourceId] = { id: sourceId, kind: 'prop', parentSourceId: null, snapshot: {
      definitionRef: { id: definitionId, version: 1 }, appearance: structuredClone(definition.defaultAppearance), visualBoundsMm: structuredClone(definition.defaultVisualBoundsMm),
      shadowClass: definition.defaultShadowClass, shadowOverride: null } }
  } else {
    project.document.materials[definitionId] = { ...base, textureAssetId: assetId, defaultTileSizeMm: { width: captured.widthMm, height: captured.heightMm }, applicableSurfaces: ['room', 'wall', 'terrain', 'path'] }
    project.licenseBindings.push(binding('material', definitionId))
    const sourceId = `import-source-${crypto.randomUUID()}`
    project.appearance.sources[sourceId] = { id: sourceId, kind: 'surface', parentSourceId: null, snapshot: {
      base: { materialRef: { id: definitionId, version: 1 }, tileSizeMm: { width: captured.widthMm, height: captured.heightMm }, rotationDeg: 0,
        alignment: 'world', originMm: { x: 0, y: 0 }, tint: null, opacity: 1 }, overlays: [] } }
  }
  Object.assign(project, syncAppearanceGraphV6(contentOf(project)))
  return materializeProjectV6(project, options)
}
