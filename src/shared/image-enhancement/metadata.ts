import { z } from 'zod'
import type { AssetRef, Issue } from '../model/scene.js'
import { imageSelectionMaskSchema, decodeSelectionMask, assertSelectionMaskBudget, type ImageSelectionMask } from '../image-import/selection-mask.js'
import { STATIC_SVG_LIMITS } from '../ai/svg.js'
import { IMAGE_ENHANCEMENT_LIMITS } from './pixels.js'
import { imageEnhancementRecipeSchema } from './schema.js'
import { imageAssetParent } from '../asset-refinement/metadata.js'

const id = z.string().min(1).max(256).refine(value => value !== '__proto__')
export const imageEnhancementMetadataSchema = z.strictObject({
  version: z.literal(1), sourceAssetId: id, originalAssetId: id,
  recipe: imageEnhancementRecipeSchema, scopeMask: imageSelectionMaskSchema.optional(),
})
export type ImageEnhancementMetadata = z.infer<typeof imageEnhancementMetadataSchema>
export const IMAGE_ENHANCEMENT_MAX_DEPTH = 16

/** Masks remain on the immediate source grid, including when the output is enlarged. */
export function expandImageEnhancementScopeMask(mask: ImageSelectionMask | undefined, width: number, height: number): Uint8Array | undefined {
  if (!mask) return undefined
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1
    || width > IMAGE_ENHANCEMENT_LIMITS.inputEdge || height > IMAGE_ENHANCEMENT_LIMITS.inputEdge
    || width * height > IMAGE_ENHANCEMENT_LIMITS.inputPixels) throw new Error('画质选区源尺寸超过保护预算。')
  const decoded = decodeSelectionMask(mask, { width, height }), output = new Uint8Array(width * height)
  for (let row = 0; row < decoded.height; row++) output.set(decoded.data.subarray(row * decoded.width, (row + 1) * decoded.width), (row + mask.y) * width + mask.x)
  return output
}

/** Metadata cannot claim original fidelity or sever an immutable source/license chain. */
export function inspectImageEnhancementAssets(assets: Record<string, AssetRef>): Issue[] {
  const errors: Issue[] = []
  const error = (message: string, entityId?: string) => errors.push({ code: 'IMAGE_ENHANCEMENT_SOURCE', message, ...(entityId ? { entityId } : {}) })
  try { assertSelectionMaskBudget(Object.values(assets).map(asset => asset.imageEnhancement?.scopeMask)) }
  catch (cause) { error(cause instanceof Error ? cause.message : '画质选区累计预算无效。') }
  for (const asset of Object.values(assets)) {
    const metadata = asset.imageEnhancement
    if (!metadata) continue
    const source = Object.hasOwn(assets, metadata.sourceAssetId) ? assets[metadata.sourceAssetId] : undefined
    const original = Object.hasOwn(assets, metadata.originalAssetId) ? assets[metadata.originalAssetId] : undefined
    if (!source || !original) { error('画质增强必须保留直接来源和原始图片。', asset.id); continue }
    if (asset.mimeType !== 'image/png' || asset.pixelWidth !== source.pixelWidth * metadata.recipe.scale
      || asset.pixelHeight !== source.pixelHeight * metadata.recipe.scale
      || source.pixelWidth * source.pixelHeight > IMAGE_ENHANCEMENT_LIMITS.inputPixels
      || Math.max(source.pixelWidth, source.pixelHeight) > IMAGE_ENHANCEMENT_LIMITS.inputEdge
      || asset.pixelWidth * asset.pixelHeight > IMAGE_ENHANCEMENT_LIMITS.outputPixels
      || Math.max(asset.pixelWidth, asset.pixelHeight) > STATIC_SVG_LIMITS.rasterSide
      || asset.logicalSizeMm.width !== source.logicalSizeMm.width || asset.logicalSizeMm.height !== source.logicalSizeMm.height) error('画质增强尺寸必须匹配配方并保留原有世界尺寸，且不得超过像素预算。', asset.id)
    if (asset.licenseRef !== source.licenseRef || asset.origin.kind !== source.origin.kind
      || asset.origin.attribution !== source.origin.attribution || asset.origin.canEmbed !== source.origin.canEmbed) error('画质增强不得改变来源及许可。', asset.id)
    if (metadata.scopeMask && (metadata.scopeMask.x + metadata.scopeMask.width > source.pixelWidth
      || metadata.scopeMask.y + metadata.scopeMask.height > source.pixelHeight)) error('画质增强选区超出直接来源图片。', asset.id)
    let current = asset, depth = 0
    const visited = new Set<string>()
    while (true) {
      if (visited.has(current.id) || ++depth > IMAGE_ENHANCEMENT_MAX_DEPTH) { error('画质增强来源链存在循环或超过16层。', asset.id); break }
      visited.add(current.id)
      const parent = imageAssetParent(current)
      if (!parent) break
      const parentId = parent.sourceAssetId
      if (!Object.hasOwn(assets, parentId)) break
      current = assets[parentId]
    }
    if (current.id !== metadata.originalAssetId || imageAssetParent(original)) error('画质增强原图必须是来源链的真实起点。', asset.id)
  }
  return errors
}
