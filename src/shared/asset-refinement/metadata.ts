import { z } from 'zod'
import type { AssetRef, Issue } from '../model/scene.js'
import { encodeUtf8 } from '../validation/json.js'
import { vectorStructurePlanSchema } from './structure-plan.js'

const id = z.string().min(1).max(256).refine(value => value !== '__proto__')
const hash = z.string().regex(/^[a-f0-9]{64}$/)
const common = { version: z.literal(1), sourceAssetId: id, originalAssetId: id, sourceSha256: hash, outputSha256: hash, sourcePixelMode: z.enum(['rgba8', 'native']) }
export const assetRefinementMetadataSchema = z.discriminatedUnion('kind', [
  z.discriminatedUnion('algorithm', [
    z.strictObject({ ...common, kind: z.literal('vector'), algorithm: z.enum(['shared-boundary-curves-v1', 'regional-tones-v1']),
      options: z.strictObject({ colors: z.number().int().min(8).max(48), curveTolerancePx: z.number().min(0).max(.49) }) }),
    z.strictObject({ ...common, kind: z.literal('vector'), algorithm: z.literal('structure-plan-v1'), plan: vectorStructurePlanSchema }),
  ]),
  z.strictObject({ ...common, kind: z.literal('model'), model: z.string().min(1).max(200), requestId: z.string().min(1).max(256),
    clientRequestId: z.string().min(1).max(128), inputSha256: hash, prompt: z.string().trim().min(1).max(2000).refine(value => encodeUtf8(value).length <= 8192) }),
])
export type AssetRefinementMetadata = z.infer<typeof assetRefinementMetadataSchema>

export function imageAssetParent(asset: AssetRef) { return asset.imageRefinement ?? asset.imageEnhancement }

/** Refinement is an explicit new appearance; its source, licence and world size remain immutable. */
export function inspectAssetRefinementAssets(assets: Record<string, AssetRef>): Issue[] {
  const errors: Issue[] = []
  const error = (asset: AssetRef, message: string) => errors.push({ code: 'ASSET_REFINEMENT_SOURCE', message, entityId: asset.id })
  for (const asset of Object.values(assets)) {
    const metadata = asset.imageRefinement
    if (!metadata) continue
    const source = Object.hasOwn(assets, metadata.sourceAssetId) ? assets[metadata.sourceAssetId] : undefined
    if (!source || !Object.hasOwn(assets, metadata.originalAssetId)) { error(asset, '图像精修必须保留直接来源与原件。'); continue }
    if (asset.imageEnhancement || metadata.sourceSha256 !== source.sha256 || metadata.outputSha256 !== asset.sha256) error(asset, '精修输出与来源哈希必须确切匹配，不能混用另一处理配方。')
    if (metadata.kind === 'vector' && metadata.algorithm === 'structure-plan-v1'
      && (metadata.plan.source.sha256 !== source.sha256 || metadata.plan.source.width !== source.pixelWidth || metadata.plan.source.height !== source.pixelHeight)) {
      error(asset, '结构重绘计划必须绑定确切来源字节与源图坐标框。')
    }
    if (asset.mimeType !== 'image/png' || Math.max(asset.pixelWidth, asset.pixelHeight) > 4096
      || asset.pixelWidth * asset.pixelHeight > 8_000_000
      || Math.abs(asset.pixelWidth * source.pixelHeight / (asset.pixelHeight * source.pixelWidth) - 1) > .02
      || asset.logicalSizeMm.width !== source.logicalSizeMm.width || asset.logicalSizeMm.height !== source.logicalSizeMm.height) error(asset, '精修需保留原画比例与世界尺寸，并限制输出为4096边长／800万像素内PNG。')
    if (asset.licenseRef !== source.licenseRef || asset.origin.kind !== source.origin.kind || asset.origin.attribution !== source.origin.attribution
      || asset.origin.canEmbed !== source.origin.canEmbed) error(asset, '精修不能改变来源署名或原有许可。')
    let current = asset, depth = 0
    const visited = new Set<string>()
    while (true) {
      if (visited.has(current.id) || ++depth > 16) { error(asset, '精修与基础处理共用来源链，不能循环或超过16层。'); break }
      visited.add(current.id)
      const parent = imageAssetParent(current)
      if (!parent) break
      if (!Object.hasOwn(assets, parent.sourceAssetId)) { error(asset, '精修来源链不完整。'); break }
      current = assets[parent.sourceAssetId]
    }
    if (current.id !== metadata.originalAssetId || imageAssetParent(current)) error(asset, '精修原件必须是完整来源链的真实起点。')
  }
  return errors
}
