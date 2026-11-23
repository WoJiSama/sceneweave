import type { EditableProject } from '../../../application/workspace/project.js'
import type { ImagePixels } from '../../../shared/image-import/pixels.js'
import type { CompleteValidationOptions } from '../../../shared/ports/resources.js'
import type { AssetRefinementMetadata } from '../../../shared/asset-refinement/metadata.js'
import { vectorRefinementOptionsSchema, type VectorRefinementOptions } from '../../../shared/asset-refinement/vector.js'
import { CURRENT_VECTOR_ALGORITHM } from '../../../shared/asset-refinement/algorithms.js'
import { compileVectorStructurePlan, type VectorStructurePlan } from '../../../shared/asset-refinement/structure-plan.js'
import { encodeCanonicalPng, decodeCanonicalPng } from '../../../shared/project/png-rgba.js'
import { inspectImageBytes } from '../../../shared/project/image-bytes.js'
import { sha256Bytes, sha256Text } from '../../../shared/validation/hash.js'
import { canonicalJson, cloneJson } from '../../../shared/validation/json.js'
import { captureImageEnhancementSource, prepareImageAppearanceCandidate, type ImageEnhancementSource } from './image-enhancement.js'
import { materializeImageImportSvg, type MaterializedImageImportSvg } from './image-import-vector.js'
import { refineImageToVectorAsync } from './image-refinement-worker.js'
import { getImageEditCapabilities, requestImageEdit, ImageEditClientError, type ImageEditRequestStateEvent } from './image-refinement-model.js'
import { validation } from '../runtime.js'
import { IMAGE_EDIT_LIMITS } from '../../../shared/asset-refinement/model-protocol.js'
import { assertLocalModelPatch, cropModelPatch, mergeModelPatch, modelPatchContext, modelPatchSchema, type ModelPatch } from '../../../shared/asset-refinement/local-model-patch.js'

export interface ImageRefinementCandidate {
  kind: 'vector' | 'model'
  id: string
  label: string
  pixels: ImagePixels
  sourceSvg?: string
  structurePlan?: VectorStructurePlan
  vectorStats?: Record<string, number>
  model?: string
  requestId?: string
}
interface CandidateProof { source: ImageEnhancementSource; pngBytes: Uint8Array; metadata: AssetRefinementMetadata; vector?: MaterializedImageImportSvg }
const candidates = new WeakMap<ImageRefinementCandidate, CandidateProof>()
const pixelsOf = (source: ImageEnhancementSource) => source.canonicalPixels ?? source.pixels
const modeOf = (source: ImageEnhancementSource) => source.canonicalPixels ? 'rgba8' as const : source.pixelMode

export async function generateVectorRefinementCandidate(issued: ImageEnhancementSource, input: VectorRefinementOptions, signal?: AbortSignal): Promise<ImageRefinementCandidate> {
  signal?.throwIfAborted()
  const source = captureImageEnhancementSource(issued), pixels = pixelsOf(source), options = vectorRefinementOptionsSchema.parse(input)
  const result = await refineImageToVectorAsync(pixels, options, signal)
  signal?.throwIfAborted()
  const longEdge = Math.min(4096, Math.max(pixels.width, pixels.height) * 2)
  const vector = await materializeImageImportSvg(result.sourceSvg, longEdge, signal), raster = decodeCanonicalPng(vector.pngBytes)
  signal?.throwIfAborted()
  const metadata: AssetRefinementMetadata = { version: 1, kind: 'vector', algorithm: CURRENT_VECTOR_ALGORITHM, options,
    sourceAssetId: source.assetId, originalAssetId: source.originalAssetId, sourceSha256: '', outputSha256: vector.sha256, sourcePixelMode: modeOf(source) }
  const candidate: ImageRefinementCandidate = { kind: 'vector', id: vector.sha256, label: '矢量色阶重建', sourceSvg: result.sourceSvg,
    pixels: { width: raster.width, height: raster.height, data: raster.rgba.slice() }, vectorStats: { ...result.stats } }
  candidates.set(candidate, { source: issued, pngBytes: vector.pngBytes.slice(), metadata, vector })
  return candidate
}

/** Rebuilds explicit reviewed geometry; source pixels are provenance, never an alpha mask on the new drawing. */
export async function generateStructuredVectorCandidate(issued: ImageEnhancementSource, planInput: unknown, signal?: AbortSignal): Promise<ImageRefinementCandidate> {
  signal?.throwIfAborted()
  const source = captureImageEnhancementSource(issued), pixels = pixelsOf(source)
  const result = compileVectorStructurePlan(planInput, { sha256: source.sourceSha256, width: pixels.width, height: pixels.height })
  signal?.throwIfAborted()
  const vector = await materializeImageImportSvg(result.sourceSvg, 1024, signal), raster = decodeCanonicalPng(vector.pngBytes)
  signal?.throwIfAborted()
  let visible = false
  for (let offset = 3; offset < raster.rgba.length; offset += 4) if (raster.rgba[offset] > 0) { visible = true; break }
  if (!visible) throw new Error('结构重绘没有可见像素，未生成可采用候选。')
  const metadata: AssetRefinementMetadata = { version: 1, kind: 'vector', algorithm: 'structure-plan-v1', plan: result.plan,
    sourceAssetId: source.assetId, originalAssetId: source.originalAssetId, sourceSha256: source.sourceSha256,
    outputSha256: vector.sha256, sourcePixelMode: modeOf(source) }
  const candidate: ImageRefinementCandidate = { kind: 'vector', id: vector.sha256, label: '结构重绘候选', sourceSvg: result.sourceSvg,
    structurePlan: cloneJson(result.plan), pixels: { width: raster.width, height: raster.height, data: raster.rgba.slice() }, vectorStats: { ...result.stats } }
  candidates.set(candidate, { source: issued, pngBytes: vector.pngBytes.slice(), metadata, vector })
  return candidate
}

export async function generateModelRefinementCandidate(issued: ImageEnhancementSource, connection: { baseUrl: string; token: string }, prompt: string,
  signal?: AbortSignal, capabilities: CompleteValidationOptions = validation, onRequestState?: (event: ImageEditRequestStateEvent) => void,
  region?: ModelPatch): Promise<ImageRefinementCandidate> {
  signal?.throwIfAborted()
  const source = captureImageEnhancementSource(issued), pixels = pixelsOf(source)
  if (!prompt.trim() || prompt.trim().length > IMAGE_EDIT_LIMITS.promptChars || new TextEncoder().encode(prompt.trim()).length > IMAGE_EDIT_LIMITS.promptBytes) throw new Error('请填写1–2000字符、8 KiB内的补画要求。')
  const patch = region && modelPatchSchema.parse(region), context = patch && modelPatchContext(pixels, patch)
  const input = context ? cropModelPatch(pixels, context) : pixels
  const instruction = patch && context
    ? `${prompt.trim()}\n保持画面方向、边缘与坐标对齐。仅补画这张裁片内的像素矩形（左上 ${patch.x - context.x}, ${patch.y - context.y}，宽 ${patch.width}，高 ${patch.height}）。周围像素供颜色和纹理参考。`
    : prompt.trim()
  if (instruction.length > IMAGE_EDIT_LIMITS.promptChars || new TextEncoder().encode(instruction).length > IMAGE_EDIT_LIMITS.promptBytes) throw new Error('请缩短补画要求，为选区坐标留出空间。')
  const service = await getImageEditCapabilities(connection, signal)
  if (!service.available) throw new Error('图像编辑服务尚未配置，请在服务端配置专用图像编辑模型。')
  const pngBytes = encodeCanonicalPng({ width: input.width, height: input.height, rgba: input.data }), inputHash = sha256Bytes(pngBytes)
  const response = await requestImageEdit(connection, { clientRequestId: crypto.randomUUID(), sourceSha256: inputHash, pngBytes, prompt: instruction }, signal, onRequestState)
  try {
    signal?.throwIfAborted()
    if (response.sourceSha256 !== inputHash) throw new Error('补画响应对应另一份原图，未产生可用候选。')
    const header = inspectImageBytes(response.pngBytes)
    if (header.mimeType !== 'image/png' || Math.max(header.width, header.height) > 4096 || header.width * header.height > 8_000_000) throw new Error('模型输出不是预算内PNG。')
    if (Math.abs(header.width * input.height / (header.height * input.width) - 1) > .02) {
      throw new Error(patch ? '模型改变了裁片比例，请检查补画服务尺寸支持。' : '模型改变了原画比例，未自动裁剪或采用，请检查补画服务尺寸支持。')
    }
    const hash = sha256Bytes(response.pngBytes), record = { sha256: hash, mimeType: 'image/png' as const, sizeBytes: response.pngBytes.length, pixelWidth: header.width, pixelHeight: header.height }
    const raster = await capabilities.images.decode(response.pngBytes, record, { signal })
    signal?.throwIfAborted()
    if (raster.width !== header.width || raster.height !== header.height || raster.rgba.length !== header.width * header.height * 4) throw new Error('模型PNG实际像素与声明不符。')
    if (raster.width === input.width && raster.height === input.height && raster.rgba.every((value, index) => value === input.data[index])) throw new Error('模型返回的实际像素与输入相同，没有产生新的补画候选。')
    let sourceHasTransparency = false, outputHasTransparency = false, outputHasVisiblePixels = false
    for (let offset = 3; offset < pixels.data.length; offset += 4) if (pixels.data[offset] < 255) { sourceHasTransparency = true; break }
    for (let offset = 3; offset < raster.rgba.length; offset += 4) {
      if (raster.rgba[offset] < 255) outputHasTransparency = true
      if (raster.rgba[offset] > 0) outputHasVisiblePixels = true
      if (outputHasTransparency && outputHasVisiblePixels) break
    }
    if (!outputHasVisiblePixels) throw new Error('模型返回的图片没有可见像素，未生成可采用候选。')
    if (!patch && sourceHasTransparency && !outputHasTransparency) throw new Error('模型返回了不透明背景，未生成可采用候选；请检查模型透明PNG支持。')
    let result = { width: raster.width, height: raster.height, data: raster.rgba }, output = response.pngBytes
    if (patch && context) {
      result = mergeModelPatch(pixels, result, patch, context, signal)
      assertLocalModelPatch(pixels, result, patch, signal)
      output = encodeCanonicalPng({ width: result.width, height: result.height, rgba: result.data })
    }
    const outputHash = patch ? sha256Bytes(output) : hash
    const metadata: AssetRefinementMetadata = { version: 1, kind: 'model', sourceAssetId: source.assetId, originalAssetId: source.originalAssetId,
      sourceSha256: '', outputSha256: outputHash, sourcePixelMode: modeOf(source), inputSha256: inputHash, model: response.model,
      requestId: response.requestId, clientRequestId: response.clientRequestId, prompt: instruction, ...(patch ? { patch } : {}) }
    const candidate: ImageRefinementCandidate = { kind: 'model', id: outputHash, label: patch ? '局部补画候选' : '模型有限补画',
      model: response.model, requestId: response.requestId, pixels: { ...result, data: result.data.slice() } }
    candidates.set(candidate, { source: issued, pngBytes: output.slice(), metadata })
    return candidate
  } catch (error) {
    throw new ImageEditClientError('image_edit_output_rejected', 'finished', response.clientRequestId,
      error instanceof Error ? error.message : '模型返回图像未通过实际像素检查，未生成可采用候选。')
  }
}

/** Only a candidate issued for this exact source can be adopted; views never supply the persisted pixels. */
export async function prepareImageRefinementCandidate(input: EditableProject, source: ImageEnhancementSource, candidate: ImageRefinementCandidate,
  signal?: AbortSignal, capabilities: CompleteValidationOptions = validation) {
  signal?.throwIfAborted()
  const proof = candidates.get(candidate)
  if (!proof || proof.source !== source) throw new Error('精修候选不是从本次原件基线生成的，请重新生成。')
  const witness = captureImageEnhancementSource(source), asset = input.document.assets[witness.assetId]
  if (!asset) throw new Error('精修原件已不可用。')
  if (proof.metadata.kind === 'vector' && proof.metadata.algorithm === 'structure-plan-v1' && proof.metadata.plan.source.sha256 !== asset.sha256) throw new Error('结构重绘计划与本次原件字节不匹配。')
  const metadata = { ...cloneJson(proof.metadata), sourceSha256: asset.sha256 }, header = inspectImageBytes(proof.pngBytes)
  return prepareImageAppearanceCandidate(input, source, { pngBytes: proof.pngBytes, width: header.width, height: header.height,
    metadata: { imageRefinement: metadata }, ...(proof.vector ? { vector: proof.vector } : {}),
    label: metadata.kind === 'vector' ? metadata.algorithm === 'structure-plan-v1' ? '结构重绘候选' : '矢量重建候选'
      : metadata.patch ? '局部补画候选（含推断细节）' : '模型补画候选（含推断细节）' }, signal, capabilities)
}

export function imageRefinementCandidateFingerprint(candidate: ImageRefinementCandidate) {
  return sha256Text(canonicalJson({ kind: candidate.kind, id: candidate.id }))
}
