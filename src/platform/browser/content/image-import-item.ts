import { z } from 'zod'
import type { EditableProject } from '../../../application/workspace/project.js'
import { toBundle } from '../../../application/workspace/project.js'
import { addPropAppearanceSource } from '../../../shared/appearance/graph.js'
import { definitionPresentation } from '../../../shared/appearance/presentation.js'
import { prepareLibraryEntry } from '../../../shared/library/content.js'
import type { PreparedLibraryEntry } from '../../../shared/library/types.js'
import type { CompleteValidationOptions } from '../../../shared/ports/resources.js'
import type { LicenseBinding, ProjectBundle, ProjectData, ResourceBytePort } from '../../../shared/model/project.js'
import { normalizeStaticSvg, STATIC_SVG_LIMITS } from '../../../shared/ai/svg.js'
import { decodeUtf8 } from '../../../shared/project/binary.js'
import { projectResourceHashes } from '../../../shared/project/source-resources.js'
import { createMemoryResources } from '../../../shared/project/resources.js'
import { canonicalJson, captureJson, cloneJson, encodeUtf8 } from '../../../shared/validation/json.js'
import { positive } from '../../../shared/validation/primitives.js'
import { sha256Bytes } from '../../../shared/validation/hash.js'
import { validation } from '../runtime.js'
import { materializeImageImportSvg } from './image-import-vector.js'

export interface ImageImportSvgChanges {
  sourceSvg?: string
  targetLongEdgePx?: number
}
export interface ImageImportItemChanges extends ImageImportSvgChanges {
  name: string
  widthMm: number
  heightMm: number
  footprintWidthMm: number
  footprintHeightMm: number
  blocksMovement: boolean
  footprintOffsetXmm?: number
  footprintOffsetYmm?: number
  blocksSight?: boolean
}
export interface ImageImportMaterialChanges extends ImageImportSvgChanges { name: string; widthMm: number; heightMm: number }
export interface AssetPrefabChanges { name: string }
const svgChanges = { sourceSvg: z.string().min(1).optional(), targetLongEdgePx: z.number().int().min(1).max(STATIC_SVG_LIMITS.rasterSide).optional() }
const changesSchema = z.object({ name: z.string().trim().min(1).max(120), widthMm: positive, heightMm: positive,
  footprintWidthMm: positive, footprintHeightMm: positive, blocksMovement: z.boolean(), blocksSight: z.boolean().optional(),
  footprintOffsetXmm: z.number().int().optional(), footprintOffsetYmm: z.number().int().optional(), ...svgChanges }).strict()
const materialChangesSchema = z.object({ name: z.string().trim().min(1).max(120), widthMm: positive, heightMm: positive, ...svgChanges }).strict()
const prefabChangesSchema = z.strictObject({ name: z.string().trim().min(1).max(120) })

/** Returns the exact safe source kept in the project; PNG-only items return null. */
export async function readImageImportItemSvg(source: EditableProject, definitionId: string, signal?: AbortSignal): Promise<string | null> {
  signal?.throwIfAborted()
  const prop = source.document.propDefinitions[definitionId], material = source.document.materials[definitionId]
  const assetId = prop?.defaultAppearance.kind === 'image' ? prop.defaultAppearance.assetId : material?.textureAssetId
  if (!assetId) return null
  const proof = source.authoringSources[assetId]
  if (!proof) return null
  const raw = await source.resources.read(proof.sourceSha256)
  signal?.throwIfAborted()
  if (raw.length !== proof.sourceSizeBytes || sha256Bytes(raw) !== proof.sourceSha256) throw new Error('图片素材SVG原始源字节不匹配。')
  const text = decodeUtf8(raw), normalized = normalizeStaticSvg(text)
  if (normalized.sourceSha256 !== proof.sourceSha256 || normalized.normalizedSha256 !== proof.normalizedSha256) throw new Error('图片素材SVG规范源不匹配。')
  const actual = await source.resources.read(proof.normalizedSha256)
  signal?.throwIfAborted()
  if (actual.length !== proof.normalizedSizeBytes || sha256Bytes(actual) !== proof.normalizedSha256 || decodeUtf8(actual) !== normalized.normalizedSource) throw new Error('图片素材SVG规范源字节不匹配。')
  return text
}

async function editedSvgAsset(source: EditableProject, bundle: ProjectBundle, project: ProjectData, assetId: string,
  definitionId: string, changes: ImageImportSvgChanges & { widthMm: number; heightMm: number }, signal?: AbortSignal): Promise<{ assetId: string; resources: ResourceBytePort }> {
  let text = changes.sourceSvg
  if (text === undefined && changes.targetLongEdgePx !== undefined) {
    text = await readImageImportItemSvg(source, definitionId, signal) ?? undefined
    if (text === undefined) throw new Error('调整矢量精度需要SVG源。')
  }
  if (text === undefined) return { assetId, resources: bundle.resources }
  const output = await materializeImageImportSvg(text, changes.targetLongEdgePx, signal), original = project.document.assets[assetId]
  if (!original) throw new Error('图片素材缺少实际资产。')
  const bindings = project.licenseBindings.filter(row => row.subjectKind === 'asset' && row.subjectId === assetId)
  if (bindings.length !== 1) throw new Error('图片资产缺少唯一许可绑定。')
  const logicalSizeMm = { width: changes.widthMm, height: changes.heightMm }
  const identity = sha256Bytes(encodeUtf8(canonicalJson({ source: output.authoringSource, logicalSizeMm, origin: original.origin, binding: bindings[0] })))
  const newId = `image-import-vector-${identity}`
  if (!Object.hasOwn(project.document.assets, newId)) {
    const { imageEnhancement: previousEnhancement, imageRefinement: previousRefinement, ...base } = original
    project.document.assets[newId] = { ...base, id: newId, sha256: output.sha256, mimeType: 'image/png', pixelWidth: output.pixelWidth, pixelHeight: output.pixelHeight, logicalSizeMm }
    project.licenseBindings.push({ ...bindings[0], subjectId: newId })
  }
  project.assets[output.sha256] = { sha256: output.sha256, mimeType: 'image/png', sizeBytes: output.pngBytes.length, pixelWidth: output.pixelWidth, pixelHeight: output.pixelHeight }
  project.authoringSources[newId] = output.authoringSource
  const bytes = new Map<string, Uint8Array>()
  for (const hash of projectResourceHashes(bundle.project)) { signal?.throwIfAborted(); bytes.set(hash, await bundle.resources.read(hash)) }
  for (const [hash, resource] of output.resourceBytes) bytes.set(hash, resource)
  signal?.throwIfAborted()
  return { assetId: newId, resources: createMemoryResources(bytes) }
}

/** Old raster imports shared a licence alias. An explicit library copy can
 * carry the exact text under its own reference without editing fixed originals. */
function scopeLegacyRasterCopy(project: ProjectData, definitionBinding: LicenseBinding, assetId: string) {
  const asset = project.document.assets[assetId], legacyRef = 'image-import-source'
  const unchanged = { assetId, licenseRef: definitionBinding.licenseRef }
  if (definitionBinding.licenseRef !== legacyRef || asset?.licenseRef !== legacyRef || asset.origin.kind !== 'imported'
    || asset.mimeType !== 'image/png' || asset.imageEnhancement || asset.imageRefinement || Object.hasOwn(project.authoringSources, assetId)) return unchanged
  const binding = project.licenseBindings.find(row => row.subjectKind === 'asset' && row.subjectId === assetId)
  if (binding?.licenseRef !== legacyRef || binding.licensePath !== definitionBinding.licensePath) return unchanged
  const licenseHash = binding.licensePath.slice('licenses/'.length, -'.txt'.length)
  const licenseRef = `image-import-source-${licenseHash}`
  const id = `image-import-raster-copy-${sha256Bytes(encodeUtf8(canonicalJson({ assetId, licenseRef })))}`
  const copy = { ...asset, id, licenseRef }, copyBinding = { ...binding, subjectId: id, licenseRef }
  if (Object.hasOwn(project.document.assets, id)) {
    const existingBinding = project.licenseBindings.find(row => row.subjectKind === 'asset' && row.subjectId === id)
    if (!existingBinding || canonicalJson(project.document.assets[id]) !== canonicalJson(copy) || canonicalJson(existingBinding) !== canonicalJson(copyBinding)) {
      throw new Error('旧图片素材的副本身份与现有固定来源冲突。')
    }
  } else {
    project.document.assets[id] = copy
    project.licenseBindings.push(copyBinding)
  }
  return { assetId: id, licenseRef }
}

/** Fixed source and licence closure are retained. Editing creates a fresh immutable definition. */
export async function prepareImageImportItemVariant(source: EditableProject, definitionId: string, input: ImageImportItemChanges,
  signal?: AbortSignal, capabilities: CompleteValidationOptions = validation): Promise<PreparedLibraryEntry> {
  signal?.throwIfAborted()
  const changes = changesSchema.parse(captureJson(input)), bundle = toBundle(source), project = cloneJson(bundle.project)
  const original = project.document.propDefinitions[definitionId]
  if (!original) throw new Error('请选择已有的固定物件素材。')
  const bindings = project.licenseBindings.filter(binding => binding.subjectKind === 'propDefinition' && binding.subjectId === definitionId)
  if (bindings.length !== 1) throw new Error('图片素材缺少唯一许可绑定。')
  if (original.defaultAppearance.kind !== 'image' && (changes.sourceSvg || changes.targetLongEdgePx)) throw new Error('此符号物件没有可替换的图片源；可编辑名称、尺寸与占地。')
  const edited = original.defaultAppearance.kind === 'image'
    ? await editedSvgAsset(source, bundle, project, original.defaultAppearance.assetId, definitionId, changes, signal)
    : { assetId: null, resources: bundle.resources }
  const rasterCopy = edited.assetId && scopeLegacyRasterCopy(project, bindings[0], edited.assetId)
  const assetId = rasterCopy ? rasterCopy.assetId : edited.assetId
  const binding = rasterCopy ? { ...bindings[0], licenseRef: rasterCopy.licenseRef } : bindings[0]
  const presentation = definitionPresentation(source.appearance, { id: original.id, version: original.version })
  if (presentation?.mode === 'nearSide' && ((changes.footprintOffsetXmm ?? original.defaultFootprintOffsetMm.x) !== 0 || (changes.footprintOffsetYmm ?? original.defaultFootprintOffsetMm.y) !== 0)) throw new Error('近侧视物件的占地须以树根为中心，偏移保持为0。')
  const hash = sha256Bytes(encodeUtf8(canonicalJson({ original, changes, assetId, binding, presentation: presentation ?? null }))), id = `asset-copy-prop-${hash}`
  const definition = { ...original, id, catalogId: `prop.edited.${hash}`, version: 1, name: changes.name, licenseRef: binding.licenseRef,
    defaultAppearance: original.defaultAppearance.kind === 'image' ? { ...original.defaultAppearance, assetId: assetId! } : original.defaultAppearance,
    defaultVisualBoundsMm: { x: Math.round(original.defaultVisualBoundsMm.x * changes.widthMm / original.defaultVisualBoundsMm.width),
      y: Math.round(original.defaultVisualBoundsMm.y * changes.heightMm / original.defaultVisualBoundsMm.height), width: changes.widthMm, height: changes.heightMm },
    defaultFootprintMm: { width: changes.footprintWidthMm, height: changes.footprintHeightMm },
    defaultFootprintOffsetMm: { x: changes.footprintOffsetXmm ?? original.defaultFootprintOffsetMm.x, y: changes.footprintOffsetYmm ?? original.defaultFootprintOffsetMm.y },
    defaultBlocksMovement: changes.blocksMovement, defaultBlocksSight: changes.blocksSight ?? original.defaultBlocksSight }
  project.document.propDefinitions[id] = definition
  if (!project.licenseBindings.some(binding => binding.subjectKind === 'propDefinition' && binding.subjectId === id)) project.licenseBindings.push({ ...binding, subjectId: id })
  if (presentation) addPropAppearanceSource(project.appearance, { definitionRef: { id, version: 1 }, appearance: definition.defaultAppearance,
    visualBoundsMm: definition.defaultVisualBoundsMm, shadowClass: definition.defaultShadowClass, shadowOverride: null }, null,
  { ...cloneJson(presentation), rootAnchorMm: { x: Math.round(presentation.rootAnchorMm.x * changes.widthMm / original.defaultVisualBoundsMm.width),
    y: Math.round(presentation.rootAnchorMm.y * changes.heightMm / original.defaultVisualBoundsMm.height) } })
  return prepareLibraryEntry({ project, resources: edited.resources }, { kind: 'prop', definitionId: id }, { ...capabilities, signal })
}

/** Material source edits create a new fixed material and preserve its exact source licence. */
export async function prepareImageImportMaterialVariant(source: EditableProject, definitionId: string, input: ImageImportMaterialChanges,
  signal?: AbortSignal, capabilities: CompleteValidationOptions = validation): Promise<PreparedLibraryEntry> {
  signal?.throwIfAborted()
  const changes = materialChangesSchema.parse(captureJson(input)), bundle = toBundle(source), project = cloneJson(bundle.project)
  const original = project.document.materials[definitionId]
  if (!original) throw new Error('请选择已有的固定材质。')
  const bindings = project.licenseBindings.filter(binding => binding.subjectKind === 'material' && binding.subjectId === definitionId)
  if (bindings.length !== 1) throw new Error('图片材质缺少唯一许可绑定。')
  const edited = await editedSvgAsset(source, bundle, project, original.textureAssetId, definitionId, changes, signal)
  const { assetId, licenseRef } = scopeLegacyRasterCopy(project, bindings[0], edited.assetId)
  const binding = { ...bindings[0], licenseRef }
  const hash = sha256Bytes(encodeUtf8(canonicalJson({ original, changes, assetId, binding }))), id = `asset-copy-material-${hash}`
  project.document.materials[id] = { ...original, id, catalogId: `material.edited.${hash}`, version: 1,
    name: changes.name, licenseRef, textureAssetId: assetId, defaultTileSizeMm: { width: changes.widthMm, height: changes.heightMm } }
  if (!project.licenseBindings.some(binding => binding.subjectKind === 'material' && binding.subjectId === id)) project.licenseBindings.push({ ...binding, subjectId: id })
  return prepareLibraryEntry({ project, resources: edited.resources }, { kind: 'material', definitionId: id }, { ...capabilities, signal })
}

/** A combination remains its exact member closure; this entry edits only supported metadata. */
export async function prepareAssetPrefabVariant(source: EditableProject, definitionId: string, input: AssetPrefabChanges,
  signal?: AbortSignal, capabilities: CompleteValidationOptions = validation): Promise<PreparedLibraryEntry> {
  signal?.throwIfAborted()
  const changes = prefabChangesSchema.parse(captureJson(input)), bundle = toBundle(source), project = cloneJson(bundle.project)
  const original = project.document.prefabDefinitions[definitionId]
  if (!original) throw new Error('请选择已有的固定组合。')
  const bindings = project.licenseBindings.filter(binding => binding.subjectKind === 'prefabDefinition' && binding.subjectId === definitionId)
  if (bindings.length !== 1) throw new Error('组合素材缺少唯一许可绑定。')
  const hash = sha256Bytes(encodeUtf8(canonicalJson({ original, changes, binding: bindings[0] }))), id = `asset-copy-prefab-${hash}`
  project.document.prefabDefinitions[id] = { ...original, id, catalogId: `prefab.edited.${hash}`, version: 1,
    name: changes.name }
  if (!project.licenseBindings.some(binding => binding.subjectKind === 'prefabDefinition' && binding.subjectId === id)) project.licenseBindings.push({ ...bindings[0], subjectId: id })
  const template = project.appearance.prefabAppearanceTemplates[definitionId]
  if (!template) throw new Error('组合缺少完整的固定成员外观。')
  project.appearance.prefabAppearanceTemplates[id] = { ...cloneJson(template), definitionRef: { id, version: 1 } }
  return prepareLibraryEntry({ project, resources: bundle.resources }, { kind: 'prefab', definitionId: id }, { ...capabilities, signal })
}
