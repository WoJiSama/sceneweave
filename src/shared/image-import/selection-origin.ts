import { z } from 'zod'
import { imagePointSchema } from './calibration.js'
import { guidedSelectionSchema } from './guided-selection.js'

const bounds = z.strictObject({ x: z.number().int().nonnegative(), y: z.number().int().nonnegative(),
  width: z.number().int().positive().max(8192), height: z.number().int().positive().max(8192) })
const hash = z.string().regex(/^[a-f0-9]{64}$/)
const modelIdentity = z.strictObject({
  provider: z.enum(['self-hosted', 'external']),
  id: z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9_.:/-]+$/),
  revision: z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9_.:/-]+$/),
  responseSha256: hash,
  disclosure: z.enum(['local-no-upload', 'explicit-image-upload']),
})
/** Provenance for a proposed mask. This is a record, never a quality or validation exemption. */
const localSelectionOriginSchema = z.strictObject({
  method: z.literal('local-slimsam'), sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
  inputSha256: z.string().regex(/^[a-f0-9]{64}$/), priorLayersHash: z.string().regex(/^[a-f0-9]{64}$/),
  modelId: z.literal('Xenova/slimsam-77-uniform'), modelRevision: z.string().regex(/^[a-f0-9]{40}$/),
  modelFiles: z.array(z.strictObject({ name: z.enum(['vision_encoder.onnx', 'prompt_encoder_mask_decoder.onnx']),
    sha256: z.string().regex(/^[a-f0-9]{64}$/) })).length(2),
  contextBounds: bounds, targetBounds: bounds,
  points: z.array(imagePointSchema.extend({ label: z.union([z.literal(0), z.literal(1)]) })).min(1).max(32),
  candidateIndex: z.number().int().min(0).max(2),
  cleanup: z.strictObject({ fillHoles: z.number().int().min(0).max(4), removeIslands: z.number().int().min(0).max(4) }),
}).superRefine((value, context) => {
  if (new Set(value.modelFiles.map(file => file.name)).size !== 2) context.addIssue({ code: 'custom', message: '模型来源须分别记录编码器和解码器。' })
  const outer = value.contextBounds, inner = value.targetBounds
  if (outer.width * outer.height > 32_000_000 || inner.width * inner.height > 250_000
    || inner.x < outer.x || inner.y < outer.y || inner.x + inner.width > outer.x + outer.width || inner.y + inner.height > outer.y + outer.height) {
    context.addIssue({ code: 'custom', message: '本机选区目标须在上下文内，且不超过25万像素。' })
  }
  if (!value.points.some(point => point.label === 1)) context.addIssue({ code: 'custom', message: '本机分割至少需要一个前景点。' })
  if (value.points.some(point => point.x < outer.x || point.y < outer.y || point.x >= outer.x + outer.width || point.y >= outer.y + outer.height)) {
    context.addIssue({ code: 'custom', message: '本机分割辅助点超出上下文。' })
  }
})
const visionBoundaryOriginSchema = z.strictObject({
  method: z.literal('vision-boundary-v1'), sourceSha256: hash, inputSha256: hash, priorLayersHash: hash,
  model: modelIdentity, contextBounds: bounds, targetBounds: bounds,
  boundaryPx: z.array(imagePointSchema).min(3).max(256), guide: guidedSelectionSchema,
  proposalId: z.string().trim().min(1).max(80).regex(/^[A-Za-z0-9_.:-]+$/),
  candidateIndex: z.number().int().min(0).max(31), appearanceSource: z.enum(['original', 'working']),
}).superRefine((value, context) => {
  const outer = value.contextBounds, target = value.targetBounds
  if (target.x < outer.x || target.y < outer.y || target.x + target.width > outer.x + outer.width || target.y + target.height > outer.y + outer.height) {
    context.addIssue({ code: 'custom', path: ['targetBounds'], message: '视觉模型目标范围必须位于上下文范围内。' })
  }
  if (value.model.provider === 'external' && value.model.disclosure !== 'explicit-image-upload') {
    context.addIssue({ code: 'custom', path: ['model', 'disclosure'], message: '向外部视觉模型发送图片必须有本次明确授权。' })
  }
  if (value.guide.algorithmVersion !== 2 || !value.guide.boundaryPx) {
    context.addIssue({ code: 'custom', path: ['guide'], message: '视觉模型来源必须保留算法2粗边界和辅助点。' })
  }
  for (const point of value.boundaryPx) if (point.x < outer.x || point.y < outer.y || point.x > outer.x + outer.width || point.y > outer.y + outer.height) {
    context.addIssue({ code: 'custom', path: ['boundaryPx'], message: '视觉模型边界点超出上下文范围。' }); break
  }
})
/** A proposal can be replayed without the model being online. */
export const imageSelectionOriginSchema = z.discriminatedUnion('method', [localSelectionOriginSchema, visionBoundaryOriginSchema])
export type ImageSelectionOrigin = z.infer<typeof imageSelectionOriginSchema>
export type VisionBoundaryModel = z.infer<typeof modelIdentity>
export const visionBoundaryModelSchema = modelIdentity
export const imageSelectionBoundsSchema = bounds

export function assertImageSelectionOrigin(origin: ImageSelectionOrigin, image: { sha256: string; pixelWidth: number; pixelHeight: number },
  mask?: { x: number; y: number; width: number; height: number }): void {
  const bounds = origin.contextBounds, target = origin.targetBounds
  if (origin.sourceSha256 !== image.sha256) throw new Error('候选选区对应另一份原图。')
  if (bounds.x + bounds.width > image.pixelWidth || bounds.y + bounds.height > image.pixelHeight) throw new Error('候选上下文超出原图。')
  if (target.x + target.width > image.pixelWidth || target.y + target.height > image.pixelHeight) throw new Error('候选目标范围超出原图。')
  if (mask && (mask.x < target.x || mask.y < target.y || mask.x + mask.width > target.x + target.width || mask.y + mask.height > target.y + target.height)) {
    throw new Error('候选选区超出记录的目标范围。')
  }
}
