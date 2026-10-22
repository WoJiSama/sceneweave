import { applyCompositionCommandsV5 } from '../../core/v5/commands'
import { listRequiredVariantsV5, resolveAppearanceV5, syncAppearanceGraphV5 } from '../../core/v5/graph'
import { validateCompositionDraftV5 } from '../../core/v5/schema'
import type { CompositionCommandV5, CompositionContentV5 } from '../../core/v5/types'
import type { LicenseSubjectKind } from '../v3/types'
import { parseBoundedJson, utf8Decoder, utf8Encoder } from '../v3/json'
import { checkCancelled, failV5, hasExactKeys, PROJECT_LIMITS_V5 } from './limits'
import { canonicalJsonV5, validateCompleteProjectV5 } from './project-file'
import { deriveBitmapVariantV5, normalizeImageAsset, sha256Bytes } from './resources'
import type { AssetImportRequestV5, CompleteProjectV5, LicenseBinding } from './types'

const contentOf = (project: CompleteProjectV5): CompositionContentV5 => ({ document: project.document, historyIdentity: project.historyIdentity, appearance: project.appearance })
const collections = { asset: 'assets', material: 'materials', propDefinition: 'propDefinitions', prefabDefinition: 'prefabDefinitions', styleTheme: 'styleThemes' } as const

/** New derived subjects inherit only one already proven license binding; ambiguity is an error. */
function inheritMissingBindings(project: CompleteProjectV5): void {
  for (const [kind, collection] of Object.entries(collections) as [LicenseSubjectKind, typeof collections[LicenseSubjectKind]][]) {
    for (const subject of Object.values(project.document[collection])) {
      if (project.licenseBindings.some(binding => binding.subjectKind === kind && binding.subjectId === subject.id)) continue
      const matches = project.licenseBindings.filter(binding => binding.licenseRef === subject.licenseRef && binding.embedding === 'allowed')
      if (!matches.length || new Set(matches.map(binding => binding.licensePath)).size !== 1) failV5(`新采用对象${subject.id}缺少唯一许可来源，不能自动补许可。`)
      project.licenseBindings.push({ ...matches[0], subjectKind: kind, subjectId: subject.id })
    }
  }
}

function draftBudgets(project: CompleteProjectV5): void {
  if (!hasExactKeys(project, ['document', 'historyIdentity', 'appearance', 'assets', 'licenses', 'licenseBindings'], ['migrationSource'])) failV5('完整候选字段缺失或未知。')
  const budget = { values: 0 }
  for (const value of [project.document, project.historyIdentity, project.appearance]) {
    const bytes = utf8Encoder.encode(JSON.stringify(value))
    if (bytes.length > PROJECT_LIMITS_V5.sceneBytes) failV5('候选文档、身份或外观图超过单件预算。')
    parseBoundedJson(bytes, budget)
  }
  const assets = Object.values(project.assets)
  if (assets.length > PROJECT_LIMITS_V5.uniqueImages || assets.reduce((sum, record) => sum + record.pixelWidth * record.pixelHeight, 0) > PROJECT_LIMITS_V5.totalImagePixels) failV5('候选位图数量或累计像素超过保护值。')
}

/** Drafts are never installed. Every missing parameter bitmap is materialized before strict validation. */
export async function materializeProjectV5(input: CompleteProjectV5, options: { signal?: AbortSignal } = {}): Promise<CompleteProjectV5> {
  checkCancelled(options.signal)
  const project = structuredClone(input)
  draftBudgets(project)
  Object.assign(project, validateCompositionDraftV5(contentOf(project)))
  for (const variant of listRequiredVariantsV5(contentOf(project))) {
    checkCancelled(options.signal)
    const existing = project.appearance.variants[variant.id]
    if (existing) {
      if (canonicalJsonV5(existing) !== canonicalJsonV5(variant)) failV5('固定派生变体ID已被不同参数占用。')
      continue
    }
    const sourceAsset = project.document.assets[variant.sourceAssetId], source = sourceAsset && project.assets[sourceAsset.sha256]
    if (!sourceAsset || !source) failV5('派生位图缺少固定源字节，不能采用占位图。')
    const output = await deriveBitmapVariantV5(source, variant, options)
    const adopted = { ...structuredClone(sourceAsset), id: variant.outputAssetId, sha256: output.sha256, mimeType: output.mimeType,
      pixelWidth: output.pixelWidth, pixelHeight: output.pixelHeight }
    const prior = project.document.assets[variant.outputAssetId]
    if (prior && canonicalJsonV5(prior) !== canonicalJsonV5(adopted)) failV5('固定派生资产ID已被不同内容占用。')
    project.document.assets[variant.outputAssetId] = adopted
    project.assets[output.sha256] = output
    project.appearance.variants[variant.id] = structuredClone(variant)
    draftBudgets(project)
  }
  const resolved = resolveAppearanceV5(contentOf(project))
  Object.assign(project, resolved)
  inheritMissingBindings(project)
  await validateCompleteProjectV5(project, options)
  checkCancelled(options.signal)
  return project
}

/** Revision belongs to Workspace adoption, never asynchronous preparation. */
export async function prepareCompositionCommandsV5(input: CompleteProjectV5, commands: readonly CompositionCommandV5[], options: { signal?: AbortSignal } = {}): Promise<CompleteProjectV5> {
  const project = structuredClone(input), capturedCommands = structuredClone(commands)
  await validateCompleteProjectV5(project, options)
  checkCancelled(options.signal)
  const draft = applyCompositionCommandsV5(contentOf(project), capturedCommands)
  return materializeProjectV5({ ...project, ...draft }, options)
}

function validateImportRequest(input: AssetImportRequestV5): void {
  if (!hasExactKeys(input, ['file', 'name', 'kind', 'widthMm', 'heightMm', 'licenseText', 'attribution', 'canEmbed'],
    ['footprintWidthMm', 'footprintHeightMm', 'blocksMovement', 'blocksSight', 'tags']) || !(input.file instanceof Blob)
    || input.kind !== 'prop' && input.kind !== 'material' || typeof input.name !== 'string' || !input.name.trim() || Array.from(input.name).length > 120
    || input.canEmbed !== true || typeof input.attribution !== 'string' || !input.attribution.trim() || Array.from(input.attribution).length > 500) failV5('导入须提供素材类型、名称、明确来源署名与允许嵌入声明。')
  for (const size of [input.widthMm, input.heightMm, input.footprintWidthMm ?? input.widthMm, input.footprintHeightMm ?? input.heightMm]) {
    if (!Number.isSafeInteger(size) || size <= 0 || size > 1_000_000) failV5('图片和占地尺寸须为明确的正整数毫米，不能由像素或AI推断。')
  }
  if (input.kind === 'prop' && (input.footprintWidthMm === undefined || input.footprintHeightMm === undefined)) failV5('物件导入必须明确填写实际占地宽高。')
  for (const flag of [input.blocksMovement, input.blocksSight]) if (flag !== undefined && typeof flag !== 'boolean') failV5('通行/视线参数必须为布尔值。')
  if (input.tags !== undefined && (!Array.isArray(input.tags) || input.tags.length > 50 || input.tags.some(tag => typeof tag !== 'string' || !tag.trim() || Array.from(tag).length > 80) || new Set(input.tags).size !== input.tags.length)) failV5('素材标签数量、内容或唯一性无效。')
  if (typeof input.licenseText !== 'string' || !input.licenseText.trim()) failV5('导入必须提供完整许可文本。')
  const bytes = utf8Encoder.encode(input.licenseText)
  if (bytes.length > PROJECT_LIMITS_V5.licenseBytes || utf8Decoder.decode(bytes) !== input.licenseText || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(input.licenseText)) failV5('许可文本编码、控制字符或大小无效。')
}

/** Normalization strips metadata and adopts fixed definitions; it never changes existing scene instances. */
export async function prepareAssetImportV5(input: CompleteProjectV5, request: AssetImportRequestV5, options: { signal?: AbortSignal } = {}): Promise<CompleteProjectV5> {
  checkCancelled(options.signal)
  const project = structuredClone(input), captured = structuredClone(request)
  validateImportRequest(captured)
  await validateCompleteProjectV5(project, options)
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
  Object.assign(project, syncAppearanceGraphV5(contentOf(project)))
  return materializeProjectV5(project, options)
}
