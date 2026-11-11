import { z } from 'zod'
import type { EditableProject } from '../../../application/workspace/project.js'
import { toBundle } from '../../../application/workspace/project.js'
import { createCompositionContent } from '../../../shared/appearance/graph.js'
import { prepareLibraryEntry } from '../../../shared/library/content.js'
import type { PreparedLibraryEntry } from '../../../shared/library/types.js'
import type { CompleteValidationOptions } from '../../../shared/ports/resources.js'
import type { ProjectBundle, ProjectData, ResourceBytePort } from '../../../shared/model/project.js'
import { normalizeStaticSvg, STATIC_SVG_LIMITS } from '../../../shared/ai/svg.js'
import { decodeUtf8 } from '../../../shared/project/binary.js'
import { projectResourceHashes } from '../../../shared/project/source-resources.js'
import { createMemoryResources } from '../../../shared/project/resources.js'
import { canonicalJson, cloneJson, encodeUtf8 } from '../../../shared/validation/json.js'
import { positive } from '../../../shared/validation/primitives.js'
import { sha256Bytes } from '../../../shared/validation/hash.js'
import { runtime, validation } from '../runtime.js'
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
}
export interface ImageImportMaterialChanges extends ImageImportSvgChanges { name: string; widthMm: number; heightMm: number }
const svgChanges = { sourceSvg: z.string().min(1).optional(), targetLongEdgePx: z.number().int().min(1).max(STATIC_SVG_LIMITS.rasterSide).optional() }
const changesSchema = z.object({ name: z.string().trim().min(1).max(120), widthMm: positive, heightMm: positive,
  footprintWidthMm: positive, footprintHeightMm: positive, blocksMovement: z.boolean(), ...svgChanges }).strict()
const materialChangesSchema = z.object({ name: z.string().trim().min(1).max(120), widthMm: positive, heightMm: positive, ...svgChanges }).strict()

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
    project.document.assets[newId] = { ...original, id: newId, sha256: output.sha256, mimeType: 'image/png', pixelWidth: output.pixelWidth, pixelHeight: output.pixelHeight, logicalSizeMm }
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

/** Fixed source and licence closure are retained. Editing creates a fresh immutable definition. */
export async function prepareImageImportItemVariant(source: EditableProject, definitionId: string, input: ImageImportItemChanges,
  signal?: AbortSignal, capabilities: CompleteValidationOptions = validation): Promise<PreparedLibraryEntry> {
  signal?.throwIfAborted()
  const changes = changesSchema.parse(input), bundle = toBundle(source), project = cloneJson(bundle.project)
  const original = project.document.propDefinitions[definitionId]
  if (!original || !original.tags.includes('图片拆解') || original.defaultAppearance.kind !== 'image') throw new Error('请选择图片拆解得到的物件。')
  const bindings = project.licenseBindings.filter(binding => binding.subjectKind === 'propDefinition' && binding.subjectId === definitionId)
  if (bindings.length !== 1) throw new Error('图片素材缺少唯一许可绑定。')
  const edited = await editedSvgAsset(source, bundle, project, original.defaultAppearance.assetId, definitionId, changes, signal)
  const hash = sha256Bytes(encodeUtf8(canonicalJson({ original, changes, assetId: edited.assetId, binding: bindings[0] }))), id = `image-import-edited-${hash}`
  const definition = { ...original, id, catalogId: `prop.image-import.edited.${hash}`, version: 1, name: changes.name,
    defaultAppearance: { ...original.defaultAppearance, assetId: edited.assetId },
    defaultVisualBoundsMm: { x: -Math.round(changes.widthMm / 2), y: -Math.round(changes.heightMm / 2), width: changes.widthMm, height: changes.heightMm },
    defaultFootprintMm: { width: changes.footprintWidthMm, height: changes.footprintHeightMm }, defaultBlocksMovement: changes.blocksMovement }
  project.document.propDefinitions[id] = definition
  if (!project.licenseBindings.some(binding => binding.subjectKind === 'propDefinition' && binding.subjectId === id)) project.licenseBindings.push({ ...bindings[0], subjectId: id })
  Object.assign(project, createCompositionContent(project.document, runtime))
  return prepareLibraryEntry({ project, resources: edited.resources }, { kind: 'prop', definitionId: id }, { ...capabilities, signal })
}

/** Material source edits create a new fixed material and preserve its exact source licence. */
export async function prepareImageImportMaterialVariant(source: EditableProject, definitionId: string, input: ImageImportMaterialChanges,
  signal?: AbortSignal, capabilities: CompleteValidationOptions = validation): Promise<PreparedLibraryEntry> {
  signal?.throwIfAborted()
  const changes = materialChangesSchema.parse(input), bundle = toBundle(source), project = cloneJson(bundle.project)
  const original = project.document.materials[definitionId]
  if (!original || !original.tags.includes('图片拆解')) throw new Error('请选择图片拆解得到的材质。')
  const bindings = project.licenseBindings.filter(binding => binding.subjectKind === 'material' && binding.subjectId === definitionId)
  if (bindings.length !== 1) throw new Error('图片材质缺少唯一许可绑定。')
  const edited = await editedSvgAsset(source, bundle, project, original.textureAssetId, definitionId, changes, signal)
  const hash = sha256Bytes(encodeUtf8(canonicalJson({ original, changes, assetId: edited.assetId, binding: bindings[0] }))), id = `image-import-material-edited-${hash}`
  project.document.materials[id] = { ...original, id, catalogId: `material.image-import.edited.${hash}`, version: 1,
    name: changes.name, textureAssetId: edited.assetId, defaultTileSizeMm: { width: changes.widthMm, height: changes.heightMm } }
  if (!project.licenseBindings.some(binding => binding.subjectKind === 'material' && binding.subjectId === id)) project.licenseBindings.push({ ...bindings[0], subjectId: id })
  Object.assign(project, createCompositionContent(project.document, runtime))
  return prepareLibraryEntry({ project, resources: edited.resources }, { kind: 'material', definitionId: id }, { ...capabilities, signal })
}
