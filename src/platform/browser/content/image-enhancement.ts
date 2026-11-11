import { z } from 'zod'
import type { EditableProject } from '../../../application/workspace/project.js'
import { consumeEditableSnapshot, fromBundle, toBundle } from '../../../application/workspace/project.js'
import type { CompositionCommand } from '../../../shared/model/appearance.js'
import type { AssetRef, MaterialRef, PropDefinition } from '../../../shared/model/scene.js'
import type { CompleteValidationOptions } from '../../../shared/ports/resources.js'
import type { ImagePixels } from '../../../shared/image-import/pixels.js'
import { encodeSelectionMask, IMAGE_SELECTION_LIMITS } from '../../../shared/image-import/selection-mask.js'
import { IMAGE_ENHANCEMENT_LIMITS, applyImageEnhancement, parseImageEnhancementRecipe, type ImageEnhancementRecipe } from '../../../shared/image-enhancement/index.js'
import { tryDecodeDecontaminationSource } from '../../../shared/image-enhancement/source-pixels.js'
import type { ImageEnhancementMetadata } from '../../../shared/image-enhancement/metadata.js'
import type { AssetRefinementMetadata } from '../../../shared/asset-refinement/metadata.js'
import type { MaterializedImageImportSvg } from './image-import-vector.js'
import type { CatalogSelector } from '../../../shared/library/types.js'
import { addPropAppearanceSource } from '../../../shared/appearance/graph.js'
import { definitionPresentation } from '../../../shared/appearance/presentation.js'
import { bitmapVariantPixelPipeline, createMemoryResources } from '../../../shared/project/resources.js'
import { decodeCanonicalPng, encodeCanonicalPng } from '../../../shared/project/png-rgba.js'
import { projectResourceHashes } from '../../../shared/project/source-resources.js'
import { canonicalJson, captureJson, cloneJson, freezeJson } from '../../../shared/validation/json.js'
import { sha256Bytes, sha256Text } from '../../../shared/validation/hash.js'
import { validation } from '../runtime.js'

export interface ImageEnhancementTarget { kind: 'prop' | 'room' | 'terrainArea' | 'wall' | 'propDefinition' | 'material'; id: string }
export interface ImageEnhancementTargetInfo { label: string; assetId: string; originalAssetId: string; baseline: string }
export interface ImageEnhancementSource extends ImageEnhancementTargetInfo {
  sourceSha256: string
  target: ImageEnhancementTarget
  basis: 'current' | 'original' | 'savedStructure'
  pixels: ImagePixels
  /** Decode semantics of pixels, independent of the optional small-image copy. */
  pixelMode: 'rgba8' | 'native'
  /** Exact normalized RGBA when available; only the new decontamination recipe consumes it. */
  canonicalPixels?: ImagePixels
}
export interface PreparedImageEnhancement { catalog: EditableProject; commands: CompositionCommand[]; selector?: CatalogSelector; label: string }
const targetSchema = z.strictObject({ kind: z.enum(['prop', 'room', 'terrainArea', 'wall', 'propDefinition', 'material']), id: z.string().min(1).max(256).refine(value => value !== '__proto__') })
const witnesses = new WeakMap<ImageEnhancementSource, ImageEnhancementSource>()

function encodeScope(scope: Uint8Array, image: ImagePixels) {
  let left = image.width, right = -1, top = image.height, bottom = -1
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) if (scope[y * image.width + x]) {
    left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y)
  }
  const width = right - left + 1, height = bottom - top + 1
  if (width * height > IMAGE_SELECTION_LIMITS.pixels) throw new Error('画质局部选区最多100万像素，请收窄范围。')
  const data = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) data.set(scope.subarray((top + y) * image.width + left, (top + y) * image.width + right + 1), y * width)
  return encodeSelectionMask({ width, height, data, boundsPx: { x: left, y: top, width, height } })
}

function targetRecords(project: EditableProject, target: ImageEnhancementTarget) {
  const { document, appearance } = project, { kind, id } = target
  if (kind === 'propDefinition' || kind === 'material') {
    const definition = kind === 'propDefinition' ? document.propDefinitions[id] : undefined
    const material = kind === 'material' ? document.materials[id] : undefined
    const assetId = definition?.defaultAppearance.kind === 'image' ? definition.defaultAppearance.assetId : material?.textureAssetId
    const asset = assetId ? document.assets[assetId] : undefined
    return asset ? { entity: null, source: null, definition, material, asset } : null
  }
  const entity = kind === 'prop' ? document.props[id] : kind === 'room' ? document.rooms[id] : kind === 'wall' ? document.walls[id] : document.terrainAreas[id]
  if (!entity) return null
  const sourceId = kind === 'prop' ? appearance.propSources[id] : appearance.surfaceSources[id], source = appearance.sources[sourceId]
  const definition = source?.kind === 'prop' && source.snapshot.definitionRef ? document.propDefinitions[source.snapshot.definitionRef.id] : undefined
  const material = source?.kind === 'surface' ? document.materials[source.snapshot.base.materialRef.id] : undefined
  const assetId = source?.kind === 'prop' && source.snapshot.appearance.kind === 'image' ? source.snapshot.appearance.assetId : material?.textureAssetId
  const asset = assetId ? document.assets[assetId] : undefined
  if (!asset || !source || kind === 'prop' && !definition) return null
  return { entity, source, definition, material, asset }
}

/** Uses immutable source pixels, not already tinted materialized pixels that would be tinted twice. */
export function inspectImageEnhancementTarget(project: EditableProject, input: ImageEnhancementTarget): ImageEnhancementTargetInfo | null {
  const target = targetSchema.parse(captureJson(input)), records = targetRecords(project, target)
  if (!records) return null
  const { document, appearance, historyIdentity } = project, { id, kind } = target
  const layerId = document.entityLayers[id], layer = layerId ? document.userLayers[layerId] : undefined
  const metadata = records.asset.imageRefinement ?? records.asset.imageEnhancement
  const originalAssetId = metadata?.originalAssetId ?? records.asset.id
  const original = document.assets[originalAssetId]
  if (!original) throw new Error('增强物件缺少保留的原图资产。')
  if (kind === 'propDefinition' || kind === 'material') return {
    label: records.definition?.name ?? records.material!.name, assetId: records.asset.id, originalAssetId,
    baseline: sha256Text(canonicalJson({ target, definition: records.definition ?? null, material: records.material ?? null,
      asset: records.asset, original,
      licenseBindings: project.licenseBindings.filter(binding => binding.subjectId === id || binding.subjectId === records.asset.id || binding.subjectId === original.id) })),
  }
  const structureVertices = kind === 'room' ? document.rooms[id].boundaryVertexIds.map(vertex => document.vertices[vertex])
    : kind === 'wall' ? [document.vertices[document.walls[id].startVertexId], document.vertices[document.walls[id].endVertexId]] : []
  const fingerprint = { sceneId: document.sceneId, lineageId: historyIdentity.lineageId, target, entity: records.entity,
    source: records.source, asset: records.asset, original, definition: records.definition ?? null, material: records.material ?? null,
    layer: layer ?? null, instanceAdjustments: appearance.instanceAdjustments[id] ?? [], layerAdjustments: appearance.layerAdjustments[layerId] ?? [],
    token: kind === 'prop' ? historyIdentity.propTokens[id] ?? null : kind === 'terrainArea' ? historyIdentity.outdoorTokens[id] ?? null : historyIdentity.structureTokens?.[id] ?? null,
    structureVertices }
  return { label: records.definition?.name ?? records.material?.name ?? id, assetId: records.asset.id, originalAssetId,
    baseline: sha256Text(canonicalJson(fingerprint)) }
}

/** The returned pixels are a review copy; preparation replays a privately owned baseline. */
export async function readImageEnhancementSource(input: EditableProject, targetInput: ImageEnhancementTarget, basis: ImageEnhancementSource['basis'],
  signal?: AbortSignal, capabilities: CompleteValidationOptions = validation): Promise<ImageEnhancementSource> {
  signal?.throwIfAborted()
  if (basis !== 'current' && basis !== 'original' && basis !== 'savedStructure') throw new Error('请选择当前结果、保留原图或已保存结构稿来源。')
  const project = await consumeEditableSnapshot(input, { ...capabilities, signal }), target = targetSchema.parse(captureJson(targetInput))
  const info = inspectImageEnhancementTarget(project, target)
  if (!info) throw new Error('请选择已有图片外观的物件、房间地板、地形或墙面。')
  const refinement = project.document.assets[info.assetId].imageRefinement
  if (basis === 'savedStructure' && (refinement?.kind !== 'vector' || refinement.algorithm !== 'structure-plan-v1')) throw new Error('此素材没有已保存的结构稿来源。')
  // Only the validated current asset can nominate its exact retained parent.
  // Callers cannot supply an arbitrary asset ID or relabel the root source.
  const assetId = basis === 'original' ? info.originalAssetId : basis === 'savedStructure' ? refinement!.sourceAssetId : info.assetId
  const asset = project.document.assets[assetId], record = asset && project.assets[asset.sha256]
  if (!record || !asset.origin.canEmbed) throw new Error('图片源缺少完整资源或嵌入许可。')
  const bytes = await project.resources.read(asset.sha256)
  signal?.throwIfAborted()
  if (bytes.length !== record.sizeBytes || sha256Bytes(bytes) !== asset.sha256) throw new Error('画质处理源字节与固定记录不符。')
  const pixelMode = bitmapVariantPixelPipeline(project, assetId) === 'svg-rgba8-v1' ? 'rgba8' as const : 'native' as const
  const raster = pixelMode === 'rgba8' ? decodeCanonicalPng(bytes)
    : await capabilities.images.decode(bytes, record, { signal })
  signal?.throwIfAborted()
  const pixels = { width: raster.width, height: raster.height, data: raster.rgba.slice() }
  const canonical = raster.width * raster.height <= IMAGE_ENHANCEMENT_LIMITS.inputPixels
    ? tryDecodeDecontaminationSource(bytes, record.mimeType) : undefined
  const canonicalPixels = canonical ? { width: canonical.width, height: canonical.height, data: canonical.rgba.slice() } : undefined
  const result: ImageEnhancementSource = { ...info, assetId, sourceSha256: asset.sha256, target, basis, pixels, pixelMode, ...(canonicalPixels ? { canonicalPixels } : {}) }
  witnesses.set(result, { ...result, target: { ...target }, pixels: { ...pixels, data: pixels.data.slice() },
    ...(canonicalPixels ? { canonicalPixels: { ...canonicalPixels, data: canonicalPixels.data.slice() } } : {}) })
  return result
}

/** Rebase append-only fixed resources on the latest unrelated scene edits, then use ordinary commands. */
export async function prepareImageEnhancementCandidate(input: EditableProject, issued: ImageEnhancementSource, inputRecipe: ImageEnhancementRecipe,
  scopeMask?: Uint8Array, signal?: AbortSignal, capabilities: CompleteValidationOptions = validation): Promise<PreparedImageEnhancement> {
  signal?.throwIfAborted()
  const witness = witnesses.get(issued)
  if (!witness) throw new Error('画质候选缺少本次读取的原图基线，请重新生成。')
  const recipe = parseImageEnhancementRecipe(inputRecipe), scope = scopeMask?.slice()
  const current = await consumeEditableSnapshot(input, { ...capabilities, signal })
  const info = inspectImageEnhancementTarget(current, witness.target)
  if (!info || info.baseline !== witness.baseline) throw new Error('此对象在生成候选后已修改，请保留当前编辑并重新生成。')
  const records = targetRecords(current, witness.target)!
  const layer = records.entity ? current.document.userLayers[current.document.entityLayers[witness.target.id]] : undefined
  if (records.entity?.editLocked || layer?.editLocked) throw new Error('对象或所在图层已锁定，不能采用画质候选。')
  if (witness.pixels.width * recipe.scale > IMAGE_ENHANCEMENT_LIMITS.outputEdge || witness.pixels.height * recipe.scale > IMAGE_ENHANCEMENT_LIMITS.outputEdge) throw new Error('当前画质PNG输出边长最多4096，请降低倍率或缩小范围。')
  const sourcePixels = recipe.direction === 'decontaminate' ? witness.canonicalPixels ?? witness.pixels : witness.pixels
  const output = applyImageEnhancement(sourcePixels, recipe, scope, signal)
  signal?.throwIfAborted()
  const metadata: ImageEnhancementMetadata = { version: 1, sourceAssetId: witness.assetId, originalAssetId: witness.originalAssetId, recipe,
    ...(scope ? { scopeMask: encodeScope(scope, witness.pixels) } : {}) }
  return prepareImageAppearanceCandidate(current, issued, { pngBytes: encodeCanonicalPng({ width: output.width, height: output.height, rgba: output.data }),
    width: output.width, height: output.height, metadata: { imageEnhancement: metadata }, label: '基础处理候选' }, signal, capabilities)
}

/** Review pixels can be mutated by views; only an issued private copy is used for processing. */
export function captureImageEnhancementSource(issued: ImageEnhancementSource): ImageEnhancementSource {
  const witness = witnesses.get(issued)
  if (!witness) throw new Error('候选缺少本次读取的原图基线。')
  return { ...witness, target: { ...witness.target }, pixels: { ...witness.pixels, data: witness.pixels.data.slice() },
    ...(witness.canonicalPixels ? { canonicalPixels: { ...witness.canonicalPixels, data: witness.canonicalPixels.data.slice() } } : {}) }
}

/** Shared append-only adoption boundary for local recipes, SVG refinement and reviewed model output. */
export async function prepareImageAppearanceCandidate(input: EditableProject, issued: ImageEnhancementSource,
  output: { pngBytes: Uint8Array; width: number; height: number; metadata: { imageEnhancement?: ImageEnhancementMetadata; imageRefinement?: AssetRefinementMetadata };
    vector?: MaterializedImageImportSvg; label: string }, signal?: AbortSignal, capabilities: CompleteValidationOptions = validation): Promise<PreparedImageEnhancement> {
  signal?.throwIfAborted()
  const witness = witnesses.get(issued)
  if (!witness) throw new Error('图像候选缺少本次读取的原图基线，请重新生成。')
  const current = await consumeEditableSnapshot(input, { ...capabilities, signal }), info = inspectImageEnhancementTarget(current, witness.target)
  if (!info || info.baseline !== witness.baseline) throw new Error('此对象在生成候选后已修改，请重新生成。')
  const records = targetRecords(current, witness.target)!, layer = records.entity ? current.document.userLayers[current.document.entityLayers[witness.target.id]] : undefined
  if (records.entity?.editLocked || layer?.editLocked) throw new Error('对象或所在图层已锁定，不能采用图像候选。')
  const pngBytes = output.pngBytes.slice(), hash = sha256Bytes(pngBytes)
  const bundle = toBundle(current), project = cloneJson(bundle.project), original = project.document.assets[witness.assetId]
  const binding = project.licenseBindings.filter(value => value.subjectKind === 'asset' && value.subjectId === original.id)
  if (binding.length !== 1) throw new Error('画质处理源缺少唯一资产许可。')
  const metadata = output.metadata
  const identity = sha256Text(canonicalJson({ metadata, hash, origin: original.origin, logicalSizeMm: original.logicalSizeMm, license: binding[0] }))
  const assetId = `image-enhancement-${identity}`
  const { imageEnhancement: _oldEnhancement, imageRefinement: _oldRefinement, ...baseAsset } = cloneJson(original)
  const asset: AssetRef = { ...baseAsset, id: assetId, sha256: hash, mimeType: 'image/png', pixelWidth: output.width, pixelHeight: output.height, ...cloneJson(metadata) }
  if (project.document.assets[assetId] && canonicalJson(project.document.assets[assetId]) !== canonicalJson(asset)) throw new Error('画质资产固定身份冲突。')
  project.document.assets[assetId] = asset
  project.assets[hash] = { sha256: hash, mimeType: 'image/png', sizeBytes: pngBytes.length, pixelWidth: output.width, pixelHeight: output.height }
  if (output.vector) project.authoringSources[assetId] = cloneJson(output.vector.authoringSource)
  if (!project.licenseBindings.some(value => value.subjectKind === 'asset' && value.subjectId === assetId)) project.licenseBindings.push({ ...binding[0], subjectId: assetId })
  const commands: CompositionCommand[] = [], id = `image-enhancement-definition-${sha256Text(canonicalJson({ target: witness.target.kind, assetId,
    source: records.definition ?? records.material, appearance: records.source?.kind === 'prop' ? records.source.snapshot.appearance : null }))}`
  let selector: CatalogSelector | undefined
  if (witness.target.kind === 'prop' || witness.target.kind === 'propDefinition') {
    const base = records.definition!, appearance = records.source?.kind === 'prop' ? records.source.snapshot.appearance : base.defaultAppearance
    if (appearance.kind !== 'image') throw new Error('图片物件源已经变化。')
    const definition: PropDefinition = { ...cloneJson(base), id, catalogId: id, version: 1,
      defaultAppearance: { ...cloneJson(appearance), assetId } }
    project.document.propDefinitions[id] = definition
    const presentation = definitionPresentation(current.appearance, { id: base.id, version: base.version })
    if (presentation) addPropAppearanceSource(project.appearance, { definitionRef: { id, version: 1 }, appearance: definition.defaultAppearance,
      visualBoundsMm: definition.defaultVisualBoundsMm, shadowClass: definition.defaultShadowClass, shadowOverride: null }, null, presentation)
    const definitionBinding = project.licenseBindings.filter(value => value.subjectKind === 'propDefinition' && value.subjectId === base.id)
    if (definitionBinding.length !== 1) throw new Error('物件源缺少唯一许可。')
    if (!project.licenseBindings.some(value => value.subjectKind === 'propDefinition' && value.subjectId === id)) project.licenseBindings.push({ ...definitionBinding[0], subjectId: id })
    if (witness.target.kind === 'prop') commands.push({ type: 'replacePropAppearance', id: witness.target.id, definitionRef: { id, version: 1 } })
    else selector = { kind: 'prop', definitionId: id }
  } else {
    const base = records.material!, material: MaterialRef = { ...cloneJson(base), id, catalogId: id, version: 1, textureAssetId: assetId }
    project.document.materials[id] = material
    const materialBinding = project.licenseBindings.filter(value => value.subjectKind === 'material' && value.subjectId === base.id)
    if (materialBinding.length !== 1) throw new Error('材质源缺少唯一许可。')
    if (!project.licenseBindings.some(value => value.subjectKind === 'material' && value.subjectId === id)) project.licenseBindings.push({ ...materialBinding[0], subjectId: id })
    if (witness.target.kind === 'material') selector = { kind: 'material', definitionId: id }
    else commands.push({ type: 'setSurfaceMaterial', kind: witness.target.kind, id: witness.target.id, materialRef: { id, version: 1 } })
  }
  const resources = new Map<string, Uint8Array>()
  for (const sourceHash of projectResourceHashes(bundle.project)) {
    signal?.throwIfAborted(); resources.set(sourceHash, await bundle.resources.read(sourceHash))
  }
  resources.set(hash, pngBytes)
  if (output.vector) for (const [sourceHash, bytes] of output.vector.resourceBytes) resources.set(sourceHash, bytes.slice())
  const catalog = await fromBundle({ project, resources: createMemoryResources(resources) }, { ...capabilities, signal })
  signal?.throwIfAborted()
  return { catalog, commands: freezeJson(commands), ...(selector ? { selector } : {}), label: `${info.label} · ${output.label}` }
}
